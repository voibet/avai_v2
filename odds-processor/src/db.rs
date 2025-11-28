use sqlx::{postgres::{PgListener, PgRow}, PgPool, Row};
use crate::types::OddsUpdate;
use serde_json::Value;
use tracing::{info, error, warn};
use tokio::sync::broadcast;
use chrono::NaiveDateTime;

fn row_to_odds_update(row: &PgRow) -> Option<OddsUpdate> {
    let fixture_id: i64 = row.get("fixture_id");
    
    // Skip if bookie_id is NULL
    let bookie_id: Option<i64> = row.get("bookie_id");
    let bookie_id = bookie_id?;
    
    let bookmaker: String = row.get("bookie");
    let decimals: i32 = row.get("decimals");
    // updated_at is stored as TIMESTAMP in the database
    let updated_at: NaiveDateTime = row.get("updated_at");
    let timestamp = updated_at.and_utc().timestamp_millis();  // Unix timestamp in milliseconds
    
    // We normalize everything to 3 decimals as expected by the app
    let target_decimals = 3;
    let mut update = OddsUpdate {
        fixture_id,
        bookie_id,
        bookmaker,
        timestamp,
        start: timestamp,
        decimals: target_decimals,
        ..Default::default()
    };
    
    // Helper to get last element of JSON array
    let get_last = |val: Option<Value>| -> Option<Value> {
        val.and_then(|v| v.as_array().and_then(|arr| arr.last().cloned()))
    };

    // Helper to normalize odds values to target decimals
    let normalize = |val: i64| -> i32 {
        if decimals == target_decimals {
            val as i32
        } else if decimals < target_decimals {
            (val * 10i64.pow((target_decimals - decimals) as u32)) as i32
        } else {
            (val / 10i64.pow((decimals - target_decimals) as u32)) as i32
        }
    };

    // X12
    if let Some(last) = get_last(row.get("odds_x12")) {
        if let Some(arr) = last.get("x12").and_then(|v| v.as_array()) {
            if arr.len() == 3 {
                update.x12 = Some([
                    normalize(arr[0].as_i64().unwrap_or(0)),
                    normalize(arr[1].as_i64().unwrap_or(0)),
                    normalize(arr[2].as_i64().unwrap_or(0)),
                ]);
            }
        }
    }

    // Lines (AH & OU) - these are floats, usually don't need decimal scaling in the same way, 
    // but if they were stored as integers they would. Here they are f64.
    if let Some(last) = get_last(row.get("lines")) {
        if let Some(arr) = last.get("ah").and_then(|v| v.as_array()) {
            update.ah_lines = Some(arr.iter().map(|v| v.as_f64().unwrap_or(0.0)).collect());
        }
        if let Some(arr) = last.get("ou").and_then(|v| v.as_array()) {
            update.ou_lines = Some(arr.iter().map(|v| v.as_f64().unwrap_or(0.0)).collect());
        }
    }

    // AH Odds
    if let Some(last) = get_last(row.get("odds_ah")) {
        if let Some(arr) = last.get("ah_h").and_then(|v| v.as_array()) {
            update.ah_h = Some(arr.iter().map(|v| normalize(v.as_i64().unwrap_or(0))).collect());
        }
        if let Some(arr) = last.get("ah_a").and_then(|v| v.as_array()) {
            update.ah_a = Some(arr.iter().map(|v| normalize(v.as_i64().unwrap_or(0))).collect());
        }
    }

    // OU Odds
    if let Some(last) = get_last(row.get("odds_ou")) {
        if let Some(arr) = last.get("ou_o").and_then(|v| v.as_array()) {
            update.ou_o = Some(arr.iter().map(|v| normalize(v.as_i64().unwrap_or(0))).collect());
        }
        if let Some(arr) = last.get("ou_u").and_then(|v| v.as_array()) {
            update.ou_u = Some(arr.iter().map(|v| normalize(v.as_i64().unwrap_or(0))).collect());
        }
    }

    // Metadata
    if let Some(val) = row.get::<Option<Value>, _>("ids") {
        update.ids = Some(val);
    }
    if let Some(last) = get_last(row.get("max_stakes")) {
        update.max_stakes = Some(last);
    }
    if let Some(val) = row.get::<Option<Value>, _>("latest_t") {
        update.latest_t = Some(val);
    }

    Some(update)
}

pub async fn fetch_initial_odds(pool: &PgPool, limit: i64) -> Result<Vec<OddsUpdate>, sqlx::Error> {
    info!("📥 Fetching initial odds for top {} fixtures...", limit);

    // 1. Get distinct fixture_ids ordered by updated_at DESC
    let fixture_ids_query = r#"
        SELECT fixture_id
        FROM football_odds
        GROUP BY fixture_id
        ORDER BY MAX(updated_at) DESC
        LIMIT $1
    "#;
    
    let rows = sqlx::query(fixture_ids_query)
        .bind(limit)
        .fetch_all(pool)
        .await?;
        
    let fixture_ids: Vec<i64> = rows.iter().map(|r| r.get("fixture_id")).collect();
    
    if fixture_ids.is_empty() {
        info!("No existing fixtures found in database.");
        return Ok(vec![]);
    }
    
    info!("Found {} fixtures. Fetching odds...", fixture_ids.len());

    // 2. Fetch all relevant columns for these fixtures
    let odds_query = r#"
        SELECT 
            fixture_id, bookie_id, bookie, decimals,
            odds_x12, odds_ah, odds_ou, lines, 
            ids, max_stakes, latest_t,
            updated_at
        FROM football_odds
        WHERE fixture_id = ANY($1)
    "#;
    
    let odds_rows = sqlx::query(odds_query)
        .bind(&fixture_ids)
        .fetch_all(pool)
        .await?;
        
    let mut updates = Vec::new();
    
    for row in odds_rows {
        if let Some(update) = row_to_odds_update(&row) {
            updates.push(update);
        }
    }

    info!("✅ Fetched and parsed {} odds updates", updates.len());
    Ok(updates)
}

async fn fetch_single_odds(pool: &PgPool, fixture_id: i64, bookie: &str) -> Result<Option<OddsUpdate>, sqlx::Error> {
    let query = r#"
        SELECT 
            fixture_id, bookie_id, bookie, decimals,
            odds_x12, odds_ah, odds_ou, lines, 
            ids, max_stakes, latest_t,
            updated_at
        FROM football_odds
        WHERE fixture_id = $1 AND bookie = $2
    "#;

    let row = sqlx::query(query)
        .bind(fixture_id)
        .bind(bookie)
        .fetch_optional(pool)
        .await?;

    Ok(row.as_ref().and_then(row_to_odds_update))
}

pub fn start_db_listener(pool: PgPool, tx: broadcast::Sender<OddsUpdate>) {
    tokio::spawn(async move {
        info!("👂 Starting database listener...");
        let mut listener = match PgListener::connect_with(&pool).await {
            Ok(l) => l,
            Err(e) => {
                error!("Failed to connect PgListener: {}", e);
                return;
            }
        };

        if let Err(e) = listener.listen("odds_updates").await {
            error!("Failed to listen to odds_updates: {}", e);
            return;
        }

        info!("✅ Listening for database updates on 'odds_updates'");

        loop {
            match listener.recv().await {
                Ok(notification) => {
                    let payload = notification.payload();
                    // Payload format: fixture_id|bookie
                    let Some((fixture_id_str, bookie)) = payload.split_once('|') else {
                        warn!("Invalid notification payload: {}", payload);
                        continue;
                    };

                    let fixture_id = match fixture_id_str.parse::<i64>() {
                        Ok(id) => id,
                        Err(_) => {
                            warn!("Invalid fixture_id in payload: {}", fixture_id_str);
                            continue;
                        }
                    };

                    // Skip updates from Monaco and Pinnacle as they are handled by odds-engine
                    if bookie == "Monaco" || bookie == "Pinnacle" {
                        continue;
                    }

                    // Fetch the full odds update
                    match fetch_single_odds(&pool, fixture_id, bookie).await {
                        Ok(Some(update)) => {
                            if let Err(e) = tx.send(update) {
                                warn!("Failed to broadcast database update: {}", e);
                            }
                        }
                        Ok(None) => {
                            // This might happen if the row was deleted immediately or transaction isolation issues
                        }
                        Err(e) => {
                            error!("Failed to fetch odds for update: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("Error receiving notification: {}", e);
                    // Add a small delay to avoid tight loop on error
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }
            }
        }
    });
}

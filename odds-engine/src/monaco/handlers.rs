use crate::processor_client::OddsUpdate;
use crate::shared::types::PriceLevel;
use crate::AppState;
use crate::monaco::stream::MonacoWebSocketClient;
use crate::monaco::types::MarketMapping;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::info;
use chrono::{DateTime, Utc};

/// Start the Monaco ingestion engine
pub async fn start_ingestion_engine(state: Arc<AppState>, monaco_ws: MonacoWebSocketClient) {
    info!("🔥 Monaco Ingestion Engine Started");
    
    // Start Monaco WebSocket (authentication already completed during market fetch)
    let ws_client = Arc::new(monaco_ws);
    let ws_client_clone = ws_client.clone();
    tokio::spawn(async move {
        info!("🚀 Launching Monaco WebSocket connection...");
        ws_client_clone.start().await;
    });

    // Subscribe to Monaco messages
    let mut rx = ws_client.subscribe();
    info!("📻 Subscribed to Monaco message stream");

    let mut message_count = 0;
    
    while let Ok(msg) = rx.recv().await {
        message_count += 1;

        // Process messages
        if let Some(msg_type) = msg["type"].as_str() {
            match msg_type {
                "MarketPriceUpdate" => {
                    let state_clone = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_price_update(state_clone, msg).await {
                            tracing::error!("Error handling price update: {}", e);
                        }
                    });
                }
                "MarketStatusUpdate" => {
                    let state_clone = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_market_status_update(state_clone, msg).await {
                            tracing::error!("Error handling market status update: {}", e);
                        }
                    });
                }
                _ => {}
            }
        }
        
        if message_count % 200 == 0 {
            info!("📊 Monaco: Processed {} messages total", message_count);
        }
    }
}

/// Handle Monaco price updates
pub async fn handle_price_update(
    state: Arc<AppState>,
    message: Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Extract message fields
    let market_id = match message["marketId"].as_str() {
        Some(id) => id,
        None => return Ok(()),
    };

    let event_id = match message["eventId"].as_str() {
        Some(id) => id,
        None => return Ok(()),
    };

    // Check if we have prices
    if message["prices"].as_array().map_or(true, |p| p.is_empty()) {
        return Ok(());
    }

    // Lookup market mapping
    let mapping_key = format!("{}-{}", event_id, market_id);
    let market_mapping = match state.market_mapping.get(&mapping_key) {
        Some(mapping) => mapping.clone(),
        None => {
            // Market not yet mapped - need to fetch and process
            // For now, skip
            return Ok(());
        }
    };

    // Get fixture ID
    let fixture_id = match market_mapping.fixture_id {
        Some(id) => id,
        None => return Ok(()),
    };

    // Update OrderBook
    let order_book = {
        let mut ob = state.order_book.lock().await;
        ob.update(
            fixture_id,
            &message,
            &market_mapping.market_type,
            market_mapping.outcome_mappings.as_ref(),
        )
    };

    // Get all market mappings for this fixture (needed for database update)
    let mappings = get_fixture_mappings(&state, fixture_id);

    // Update database with best prices
    super::db::update_database_with_best_prices(
        &state.db,
        fixture_id,
        &market_mapping.market_type,
        &order_book,
        &mappings,
    )
    .await?;

    // Send update to odds-processor
    if let Some(ref client) = state.processor_client {
        // Extract validAt timestamp from Monaco message for latency measurement
        // This represents when Monaco actually published the odds, providing more accurate latency
        let start_timestamp = if let Some(valid_at_str) = message["prices"][0]["validAt"].as_str() {
            // Parse ISO 8601 timestamp from validAt field
            if let Ok(valid_at_dt) = DateTime::parse_from_rfc3339(valid_at_str) {
                valid_at_dt.with_timezone(&Utc).timestamp_millis()
            } else {
                // Fallback to received timestamp if parsing fails
                message["_received_at"]
                    .as_i64()
                    .unwrap_or(chrono::Utc::now().timestamp_millis())
            }
        } else {
            // Fallback to received timestamp if validAt is not available
            message["_received_at"]
                .as_i64()
                .unwrap_or(chrono::Utc::now().timestamp_millis())
        };

        let update = build_odds_update(fixture_id, &market_mapping, &order_book, start_timestamp);
        if let Some(update) = update {
            let _ = client.send(&update).await;
        }
    }

    Ok(())
}

/// Handle Monaco market status updates (close/in-play -> zero out odds)
pub async fn handle_market_status_update(
    state: Arc<AppState>,
    message: Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Extract message fields
    let market_id = match message["marketId"].as_str() {
        Some(id) => id,
        None => return Ok(()),
    };

    let event_id = match message["eventId"].as_str() {
        Some(id) => id,
        None => return Ok(()),
    };

    let status = message["status"].as_str().unwrap_or("Unknown");
    let in_play_status = message["inPlayStatus"].as_str().unwrap_or("NotApplicable");

    // Check if market should be zeroed out
    // Zero out if: status != "Open" OR inPlayStatus == "InPlay"
    let should_zero = status != "Open" || in_play_status == "InPlay";

    if !should_zero {
        return Ok(()); // Market is open and pre-play, nothing to do
    }

    info!("🔒 Market {} closed/in-play (status: {}, inPlay: {}), zeroing odds", market_id, status, in_play_status);

    // Lookup market mapping
    let mapping_key = format!("{}-{}", event_id, market_id);
    let market_mapping = match state.market_mapping.get(&mapping_key) {
        Some(mapping) => mapping.clone(),
        None => {
            // Market not mapped yet, skip
            return Ok(());
        }
    };

    // Get fixture ID
    let fixture_id = match market_mapping.fixture_id {
        Some(id) => id,
        None => return Ok(()),
    };

    // Zero out the order book for this market
    {
        let mut ob = state.order_book.lock().await;
        ob.remove(fixture_id, &market_mapping.market_type);
    }

    // Create empty order book (all outcomes with empty price levels)
    let empty_order_book = {
        let mut book = HashMap::new();
        if let Some(outcome_mappings) = &market_mapping.outcome_mappings {
            for outcome_id in outcome_mappings.keys() {
                book.insert(outcome_id.clone(), vec![]);
            }
        }
        book
    };

    // Get all market mappings for this fixture (needed for database update)
    let mappings = get_fixture_mappings(&state, fixture_id);

    // Update database with zeroed prices
    super::db::update_database_with_best_prices(
        &state.db,
        fixture_id,
        &market_mapping.market_type,
        &empty_order_book,
        &mappings,
    )
    .await?;

    Ok(())
}

// --- Helper Functions ---

/// Get all market mappings for a fixture
fn get_fixture_mappings(state: &AppState, fixture_id: i64) -> HashMap<String, MarketMapping> {
    let mut mappings = HashMap::new();
    for entry in state.market_mapping.iter() {
        if entry.value().fixture_id == Some(fixture_id) {
            mappings.insert(entry.key().clone(), entry.value().clone());
        }
    }
    mappings
}

/// Build OddsUpdate for sending to odds-processor
fn build_odds_update(
    fixture_id: i64,
    market_mapping: &MarketMapping,
    order_book: &HashMap<String, Vec<PriceLevel>>,
    start_timestamp: i64,
) -> Option<OddsUpdate> {
    // Monaco bookie_id = 1, decimals = 3
    let bookie_id = 1i64;
    let decimals = 3i32;
    let timestamp = chrono::Utc::now().timestamp_millis();

    // Build IDs from outcome mappings
    let ids = build_monaco_ids(timestamp, market_mapping, order_book);

    // Build max_stakes from liquidity
    let max_stakes = build_monaco_max_stakes(timestamp, market_mapping, order_book);

    // Build latest_t
    let latest_t = build_latest_t(timestamp, &market_mapping.market_type);

    match market_mapping.market_type.as_str() {
        "x12" => {
            // Extract x12 odds from order book
            let mut x12_odds = [0i32; 3];
            for (outcome_id, price_levels) in order_book {
                if let Some(mappings) = &market_mapping.outcome_mappings {
                    if let Some(&idx) = mappings.get(outcome_id) {
                        if idx < 3 && !price_levels.is_empty() {
                            x12_odds[idx] = super::db::transform_price(price_levels[0].price, 3);
                        }
                    }
                }
            }
            
            Some(OddsUpdate {
                fixture_id,
                bookie_id,
                bookmaker: "Monaco".to_string(),
                timestamp,
                start: start_timestamp,
                decimals,
                x12: Some(x12_odds),
                ids,
                max_stakes,
                latest_t,
                ..Default::default()
            })
        }
        "ah" | "ou" => {
            // For AH/OU, extract odds with line value from mapping
            let mut update = OddsUpdate {
                fixture_id,
                bookie_id,
                bookmaker: "Monaco".to_string(),
                timestamp,
                start: start_timestamp,
                decimals,
                ids,
                max_stakes,
                latest_t,
                ..Default::default()
            };
            
            if let Some(line_val) = market_mapping.line_value {
                let mut home_odds = 0i32;
                let mut away_odds = 0i32;
                
                for (outcome_id, price_levels) in order_book {
                    if let Some(mappings) = &market_mapping.outcome_mappings {
                        if let Some(&idx) = mappings.get(outcome_id) {
                            if !price_levels.is_empty() {
                                let price = super::db::transform_price(price_levels[0].price, 3);
                                if idx % 2 == 0 {
                                    home_odds = price;
                                } else {
                                    away_odds = price;
                                }
                            }
                        }
                    }
                }
                
                if market_mapping.market_type == "ah" {
                    update.ah_lines = Some(vec![line_val]);
                    update.ah_h = Some(vec![home_odds]);
                    update.ah_a = Some(vec![away_odds]);
                } else {
                    update.ou_lines = Some(vec![line_val]);
                    update.ou_o = Some(vec![home_odds]);
                    update.ou_u = Some(vec![away_odds]);
                }
            }
            
            Some(update)
        }
        _ => None,
    }
}

/// Build IDs structure for Monaco
fn build_monaco_ids(
    timestamp: i64,
    market_mapping: &MarketMapping,
    order_book: &HashMap<String, Vec<PriceLevel>>,
) -> Option<serde_json::Value> {
    let mut line_ids = serde_json::Map::new();
    
    if let Some(mappings) = &market_mapping.outcome_mappings {
        let mut outcome_ids: Vec<String> = Vec::new();
        for (outcome_id, _) in order_book {
            if mappings.contains_key(outcome_id) {
                outcome_ids.push(outcome_id.clone());
            }
        }
        
        if !outcome_ids.is_empty() {
            line_ids.insert(market_mapping.market_type.clone(), serde_json::json!(outcome_ids));
        }
    }
    
    if line_ids.is_empty() {
        return None;
    }
    
    Some(serde_json::json!({
        "t": timestamp,
        "line_ids": line_ids
    }))
}

/// Build max_stakes structure for Monaco (from liquidity)
fn build_monaco_max_stakes(
    timestamp: i64,
    market_mapping: &MarketMapping,
    order_book: &HashMap<String, Vec<PriceLevel>>,
) -> Option<serde_json::Value> {
    let mut stake_entry = serde_json::Map::new();
    stake_entry.insert("t".to_string(), serde_json::json!(timestamp));
    
    match market_mapping.market_type.as_str() {
        "x12" => {
            let mut stakes = [0.0f64; 3];
            for (outcome_id, price_levels) in order_book {
                if let Some(mappings) = &market_mapping.outcome_mappings {
                    if let Some(&idx) = mappings.get(outcome_id) {
                        if idx < 3 && !price_levels.is_empty() {
                            stakes[idx] = price_levels[0].liquidity;
                        }
                    }
                }
            }
            stake_entry.insert("max_stake_x12".to_string(), serde_json::json!(stakes));
        }
        "ah" => {
            let mut h_stakes = Vec::new();
            let mut a_stakes = Vec::new();
            for (outcome_id, price_levels) in order_book {
                if let Some(mappings) = &market_mapping.outcome_mappings {
                    if let Some(&idx) = mappings.get(outcome_id) {
                        if !price_levels.is_empty() {
                            if idx % 2 == 0 {
                                h_stakes.push(price_levels[0].liquidity);
                            } else {
                                a_stakes.push(price_levels[0].liquidity);
                            }
                        }
                    }
                }
            }
            stake_entry.insert("max_stake_ah".to_string(), serde_json::json!({
                "h": h_stakes,
                "a": a_stakes
            }));
        }
        "ou" => {
            let mut o_stakes = Vec::new();
            let mut u_stakes = Vec::new();
            for (outcome_id, price_levels) in order_book {
                if let Some(mappings) = &market_mapping.outcome_mappings {
                    if let Some(&idx) = mappings.get(outcome_id) {
                        if !price_levels.is_empty() {
                            if idx % 2 == 0 {
                                o_stakes.push(price_levels[0].liquidity);
                            } else {
                                u_stakes.push(price_levels[0].liquidity);
                            }
                        }
                    }
                }
            }
            stake_entry.insert("max_stake_ou".to_string(), serde_json::json!({
                "o": o_stakes,
                "u": u_stakes
            }));
        }
        _ => return None,
    }
    
    Some(serde_json::Value::Object(stake_entry))
}

/// Build latest_t structure
fn build_latest_t(timestamp: i64, market_type: &str) -> Option<serde_json::Value> {
    let mut latest = serde_json::Map::new();
    
    match market_type {
        "x12" => {
            latest.insert("x12_ts".to_string(), serde_json::json!(timestamp));
        }
        "ah" => {
            latest.insert("ah_ts".to_string(), serde_json::json!(timestamp));
            latest.insert("lines_ts".to_string(), serde_json::json!(timestamp));
        }
        "ou" => {
            latest.insert("ou_ts".to_string(), serde_json::json!(timestamp));
            latest.insert("lines_ts".to_string(), serde_json::json!(timestamp));
        }
        _ => return None,
    }
    
    latest.insert("ids_ts".to_string(), serde_json::json!(timestamp));
    latest.insert("stakes_ts".to_string(), serde_json::json!(timestamp));
    
    Some(serde_json::Value::Object(latest))
}


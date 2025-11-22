pub mod monaco_persistence;

use crate::order_book::OrderBook;
use chrono::Utc;
use serde_json::Value;
use sqlx::PgPool;
use std::collections::HashMap;
use tracing::info;

fn transform_price(price: f64) -> i32 {
    (((price - 1.0) * 0.99 + 1.0) * 1000.0).floor() as i32
}

pub async fn update_database_with_best_prices(
    pool: &PgPool,
    fixture_id: i64,
    market_type: &str,
    order_book: &OrderBook,
    market_mappings: &HashMap<String, crate::monaco::types::MarketMapping>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let timestamp = Utc::now().timestamp();
    let field_name = format!("odds_{}", market_type);

    // Fetch existing data
    let existing = sqlx::query(&format!(
        r#"
        SELECT {}, lines, ids, max_stakes, latest_t
        FROM football_odds
        WHERE fixture_id = $1 AND bookie = $2
        "#,
        field_name
    ))
    .bind(fixture_id)
    .bind("Monaco")
    .fetch_optional(pool)
    .await?;

    if existing.is_none() {
        return Ok(()); // Record doesn't exist yet
    }

    let row = existing.unwrap();
    
    use sqlx::Row;
    let mut odds_array: Vec<Value> = serde_json::from_value(row.get(field_name.as_str())).unwrap_or_default();
    let lines_data: Vec<Value> = serde_json::from_value(row.get("lines")).unwrap_or_default();
    let mut max_stakes_data: Vec<Value> = serde_json::from_value(row.get("max_stakes")).unwrap_or_default();
    let current_latest_t: Value = row.get("latest_t");

    let latest_lines_entry = lines_data.last();

    let mut new_odds_entry = serde_json::json!({ "t": timestamp });

    // Create new max stakes entry from current order book state
    let mut max_stakes_entry = serde_json::json!({ "t": timestamp });

    // Build odds entry based on market type
    match market_type {
        "x12" => {
            let mut x12_prices = vec![0i32; 3];
            let mut x12_stakes = [0.0, 0.0, 0.0];

            for (outcome_id, price_levels) in order_book {
                // Find outcome index
                let mut outcome_index: Option<usize> = None;
                for mapping in market_mappings.values() {
                    if let Some(mappings) = &mapping.outcome_mappings {
                        if let Some(&idx) = mappings.get(outcome_id) {
                            outcome_index = Some(idx);
                            break;
                        }
                    }
                }

                if let Some(idx) = outcome_index {
                    if idx < 3 && !price_levels.is_empty() {
                        let best_level = &price_levels[0];
                        x12_prices[idx] = transform_price(best_level.price);
                        x12_stakes[idx] = best_level.liquidity;
                    }
                }
            }

            new_odds_entry["x12"] = serde_json::json!(x12_prices);
            max_stakes_entry["max_stake_x12"] = serde_json::json!(x12_stakes);
        }
        "ah" | "ou" => {
            // Get line values from latest lines entry
            if let Some(lines) = latest_lines_entry {
                let line_values: Vec<f64> = if market_type == "ah" {
                    serde_json::from_value(lines["ah"].clone()).unwrap_or_default()
                } else {
                    serde_json::from_value(lines["ou"].clone()).unwrap_or_default()
                };

                if !line_values.is_empty() {
                    let line_count = line_values.len();
                    let (home_key, away_key) = if market_type == "ah" {
                        ("ah_h", "ah_a")
                    } else {
                        ("ou_o", "ou_u")
                    };

                    new_odds_entry[home_key] = serde_json::json!(vec![0i32; line_count]);
                    new_odds_entry[away_key] = serde_json::json!(vec![0i32; line_count]);

                    // Initialize max stakes with zeros
                    let stake_key = if market_type == "ah" { "max_stake_ah" } else { "max_stake_ou" };
                    let mut home_stakes = vec![0.0; line_count];
                    let mut away_stakes = vec![0.0; line_count];

                    for (outcome_id, price_levels) in order_book {
                        // Find line value and outcome index for this outcome
                        let mut outcome_line_value: Option<f64> = None;
                        let mut outcome_index: Option<usize> = None;

                        for mapping in market_mappings.values() {
                            if mapping.market_type == market_type {
                                if let Some(mappings) = &mapping.outcome_mappings {
                                    if let Some(&idx) = mappings.get(outcome_id) {
                                        outcome_line_value = mapping.line_value;
                                        outcome_index = Some(idx);
                                        break;
                                    }
                                }
                            }
                        }

                        if let (Some(line_val), Some(out_idx)) = (outcome_line_value, outcome_index) {
                            if let Some(line_index) = line_values.iter().position(|&v| v == line_val) {
                                if !price_levels.is_empty() {
                                    let best_level = &price_levels[0];
                                    let transformed_price = transform_price(best_level.price);
                                    let is_home = out_idx % 2 == 0;

                                    if is_home {
                                        new_odds_entry[home_key][line_index] = serde_json::json!(transformed_price);
                                        home_stakes[line_index] = best_level.liquidity;
                                    } else {
                                        new_odds_entry[away_key][line_index] = serde_json::json!(transformed_price);
                                        away_stakes[line_index] = best_level.liquidity;
                                    }
                                }
                            }
                        }
                    }

                    // Set the calculated max stakes
                    max_stakes_entry[stake_key] = serde_json::json!({
                        "h": home_stakes,
                        "a": away_stakes
                    });
                }
            }
        }
        _ => {}
    }

    // Merge odds entry
    odds_array = merge_odds_entry(odds_array, new_odds_entry.clone());

    // Update latest_t
    let mut updated_latest_t = current_latest_t.as_object().unwrap().clone();
    updated_latest_t.insert(format!("{}_ts", market_type), serde_json::json!(timestamp));
    updated_latest_t.insert("stakes_ts".to_string(), serde_json::json!(timestamp));

    // Update max stakes
    if max_stakes_data.is_empty() {
        max_stakes_data.push(max_stakes_entry);
    } else {
        max_stakes_data[0] = max_stakes_entry; // Overwrite with latest
    }

    // Update database
    sqlx::query(&format!(
        r#"
        UPDATE football_odds
        SET {} = $1, max_stakes = $2, latest_t = $3
        WHERE fixture_id = $4 AND bookie = $5
        "#,
        field_name
    ))
    .bind(serde_json::to_value(&odds_array)?)
    .bind(serde_json::to_value(&max_stakes_data)?)
    .bind(Value::Object(updated_latest_t))
    .bind(fixture_id)
    .bind("Monaco")
    .execute(pool)
    .await?;

    info!("✅ Updated {} odds for fixture_id={}", market_type, fixture_id);
    Ok(())
}

fn merge_odds_entry(mut existing: Vec<Value>, new_entry: Value) -> Vec<Value> {
    let new_t = new_entry["t"].as_i64().unwrap_or(0);
    
    if let Some(index) = existing.iter().position(|entry| entry["t"].as_i64().unwrap_or(0) == new_t) {
        existing[index] = new_entry;
    } else {
        existing.push(new_entry);
    }
    
    existing.sort_by_key(|entry| entry["t"].as_i64().unwrap_or(0));
    existing
}

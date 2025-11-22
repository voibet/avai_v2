use crate::database::monaco_persistence;
use crate::monaco::fixture_mapping;
use crate::monaco::types::{MarketMapping, MonacoMarket};
use dashmap::DashMap;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;

use crate::monaco::order_book::MonacoOrderBook;


pub async fn fetch_and_process_markets(
    api_client: &Arc<Mutex<crate::monaco::client::MonacoApiClient>>,
    pool: &PgPool,
    market_mapping: &DashMap<String, MarketMapping>,
    event_to_fixture: &DashMap<String, i64>,
    order_book: &Arc<Mutex<MonacoOrderBook>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    info!("🔄 Fetching markets from Monaco API...");

    // Fetch all markets (with paging)
    let markets_data = {
        let mut client = api_client.lock().await;
        client.fetch_all_markets(None).await?
    };

    // Parse markets from response
    let markets: Vec<MonacoMarket> = if let Some(markets_val) = markets_data.get("markets") {
        if markets_val.is_array() {
            let mut parsed_markets = Vec::new();
            for market_val in markets_val.as_array().unwrap() {
                match serde_json::from_value::<MonacoMarket>(market_val.clone()) {
                    Ok(market) => parsed_markets.push(market),
                    Err(e) => {
                        tracing::error!("Failed to parse individual market: {}", e);
                    }
                }
            }
            parsed_markets
        } else {
            tracing::error!("markets field is not an array");
            vec![]
        }
    } else {
        tracing::error!("No markets field found in response");
        vec![]
    };

    let events: Vec<serde_json::Value> = if let Some(events_val) = markets_data.get("events") {
        if events_val.is_array() {
            serde_json::from_value(events_val.clone()).unwrap_or_default()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    info!("✅ Fetched {} markets and {} events from Monaco", markets.len(), events.len());

    // Create events map
    let mut events_map: HashMap<String, serde_json::Value> = HashMap::new();
    for event in events {
        if let Some(event_id) = event["id"].as_str() {
            events_map.insert(event_id.to_string(), event);
        }
    }

    // Group markets by event
    let mut markets_by_event: HashMap<String, Vec<MonacoMarket>> = HashMap::new();
    let mut markets_processed = 0;
    let mut markets_skipped_type = 0;

    for market in &markets {
        // Get market type ID from the reference structure
        let market_type_id = market.market_type.ids.first()
            .ok_or("No market type ID found")?
            .clone();

        let market_type = match map_market_type(&market_type_id) {
            Some(mt) => mt,
            None => {
                markets_skipped_type += 1;
                continue;
            }
        };

        markets_processed += 1;

        let line_value = if market_type == "ah" {
            get_handicap_value(market)
        } else if market_type == "ou" {
            get_total_value(market)
        } else {
            None
        };

        // Get event ID from the reference structure
        let event_id = market.event.ids.first()
            .ok_or("No event ID found")?
            .clone();

        // Create outcome mappings from market outcomes references
        let mut outcome_mappings = HashMap::new();
        for (index, outcome_id) in market.market_outcomes.ids.iter().enumerate() {
            outcome_mappings.insert(outcome_id.clone(), index);
        }

        let mapping = MarketMapping {
            event_id: event_id.clone(),
            market_id: market.id.clone(),
            market_type_id: market_type_id.clone(),
            market_type: market_type.clone(),
            name: market.name.clone(),
            line_value,
            line_index: None,
            fixture_id: None, // Will be set when we find fixture
            outcome_mappings: Some(outcome_mappings),
        };

        let mapping_key = format!("{}-{}", event_id, market.id);
        market_mapping.insert(mapping_key, mapping);

        markets_by_event
            .entry(event_id.clone())
            .or_insert_with(Vec::new)
            .push(market.clone());
    }

    info!("📈 Market stats: {} total, {} processed, {} skipped (wrong type)",
    markets.len(), markets_processed, markets_skipped_type);
    info!("📊 Processing {} events to find matching fixtures...", markets_by_event.len());

    // For each event, find matching fixture
    let mut fixtures_found = 0;
    let mut events_without_data = 0;
    let mut events_no_fixture_match = 0;

    for (event_id, event_markets) in markets_by_event {
        // Get event data from events_map
        let event = match events_map.get(&event_id) {
            Some(e) => e.clone(),
            None => {
                events_without_data += 1;
                info!("⚠️  Event {} has no event data, skipping", event_id);
                continue;
            }
        };

        // Try to find matching fixture
        match fixture_mapping::find_fixture_by_event(pool, &event, &event_id).await {
            Ok(Some(fixture_id)) => {
                // Update market mappings with fixture_id
                for market in &event_markets {
                    let mapping_key = format!("{}-{}", event_id, market.id);
                    if let Some(mut mapping) = market_mapping.get_mut(&mapping_key) {
                        mapping.fixture_id = Some(fixture_id);
                    }
                }

                event_to_fixture.insert(event_id.clone(), fixture_id);

                // Initialize database record
                if let Err(e) = monaco_persistence::ensure_fixture_odds_record(pool, fixture_id, event_markets.clone()).await {
                    tracing::error!("Error creating fixture odds record for fixture_id={}: {}", fixture_id, e);
                } else {
                    // Initialize OrderBook
                    let mut ob = order_book.lock().await;
                    ob.initialize(fixture_id, &event_markets, map_market_type);
                    fixtures_found += 1;
                }
            }
            Ok(None) => {
                events_no_fixture_match += 1;
            }
            Err(e) => {
                tracing::error!("Error finding fixture for event {}: {}", event_id, e);
            }
        }
    }

    info!("📊 Fixture matching summary:");
    info!("   ✅ {} fixtures matched and initialized", fixtures_found);
    info!("   ⚠️  {} events had no event data", events_without_data);
    info!("   ⚠️  {} events had no fixture match", events_no_fixture_match);
    info!("✅ Market processing complete. Ready to receive updates!");

    Ok(())
}

fn map_market_type(market_type_id: &str) -> Option<String> {
    match market_type_id {
        "FOOTBALL_FULL_TIME_RESULT" => Some("x12".to_string()),
        "FOOTBALL_FULL_TIME_RESULT_HANDICAP" => Some("ah".to_string()),
        "FOOTBALL_OVER_UNDER_TOTAL_GOALS" => Some("ou".to_string()),
        _ => None,
    }
}

fn get_handicap_value(market: &MonacoMarket) -> Option<f64> {
    // Match: "Goal Handicap +1.5" or similar (same as Next.js)
    let re = regex::Regex::new(r"Goal Handicap ([\+\-\d\.]+)").ok()?;
    re.captures(&market.name)?.get(1)?.as_str().parse().ok()
}

fn get_total_value(market: &MonacoMarket) -> Option<f64> {
    // Try to parse from market_value first, then fall back to name parsing
    if let Some(ref market_value) = market.market_value {
        market_value.parse().ok()
    } else {
        let re = regex::Regex::new(r"Total Goals Over/Under ([\d.]+)").ok()?;
        re.captures(&market.name)?.get(1)?.as_str().parse().ok()
    }
}

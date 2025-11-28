pub mod types;
pub mod client;
pub mod db;

use crate::pinnacle::client::PinnacleApiClient;
use crate::pinnacle::db::PinnacleDbService;
use crate::pinnacle::types::PinnaclePeriod;
use crate::processor_client::{ProcessorClient, OddsUpdate};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, info};

pub struct PinnacleService {
    client: PinnacleApiClient,
    db: PinnacleDbService,
    processor_client: Option<Arc<ProcessorClient>>,
}

impl PinnacleService {
    pub fn new(pool: PgPool, processor_client: Option<Arc<ProcessorClient>>) -> Self {
        Self {
            client: PinnacleApiClient::new(),
            db: PinnacleDbService::new(pool),
            processor_client,
        }
    }

    pub async fn run(&mut self) {
        info!("Starting Pinnacle Odds Service");

        // Load known leagues once at startup
        if let Err(e) = self.db.load_known_leagues().await {
            error!("Failed to load known leagues: {}", e);
        }

        let mut interval = tokio::time::interval(Duration::from_secs(1));

        loop {
            interval.tick().await;

            if let Err(e) = self.process_cycle().await {
                error!("Error in Pinnacle service cycle: {}", e);
            }
        }
    }

    async fn process_cycle(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Record when we start fetching odds for latency measurement
        let fetch_start_time = chrono::Utc::now().timestamp_millis();

        // Fetch odds
        let market_data = match self.client.fetch_odds().await? {
            Some(data) => data,
            None => return Ok(()),
        };

        if market_data.events.is_empty() {
            return Ok(());
        }

        debug!("Fetched {} events from Pinnacle", market_data.events.len());

        // Filter events
        let filtered_events: Vec<_> = market_data.events.into_iter()
            .filter(|e| self.db.is_league_known(e.league_id))
            .collect();

        debug!("{} events remain after filtering by known leagues", filtered_events.len());

        if filtered_events.is_empty() {
            return Ok(());
        }

        // Batch lookup - combined query (one DB call instead of two)
        let event_ids: Vec<i64> = filtered_events.iter().map(|e| e.event_id).collect();
        let existing_odds = self.db.get_existing_odds_combined(&event_ids).await?;

        // Process events
        let mut events_processed = 0;
        let mut fixtures_updated = 0;

        for event in filtered_events {
            let period = match &event.periods {
                Some(p) => match &p.num_0 {
                    Some(num0) => num0,
                    None => {
                        debug!("Skipping event {}: No period 0", event.event_id);
                        continue;
                    },
                },
                None => {
                    debug!("Skipping event {}: No periods", event.event_id);
                    continue;
                },
            };

            // Check market open
            let has_odds = period.money_line.is_some() || period.spreads.is_some() || period.totals.is_some();
            
            // Check if cutoff is in future - Pinnacle uses naive datetime format YYYY-MM-DDTHH:MM:SS (UTC)
            let cutoff_in_future = if let Ok(cutoff_naive) = chrono::NaiveDateTime::parse_from_str(&period.cutoff, "%Y-%m-%dT%H:%M:%S") {
                // Pinnacle UTC timezone
                let cutoff_utc = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(cutoff_naive, chrono::Utc);
                cutoff_utc > chrono::Utc::now()
            } else {
                info!("Event {} failed to parse cutoff: {}", event.event_id, period.cutoff);
                false
            };

            let meta_open = if let Some(meta) = &period.meta {
                meta.open_money_line.unwrap_or(false) || meta.open_spreads.unwrap_or(false) || meta.open_totals.unwrap_or(false)
            } else {
                false
            };

            let is_market_open = period.period_status == 1 && has_odds && cutoff_in_future && meta_open;

            if !is_market_open {
                // Check if we have existing odds for this event
                if let Some(&(fixture_id, ref existing_data)) = existing_odds.get(&event.event_id) {
                    // Market closed but we have existing odds - set all odds to 0
                    let zero_period = self.create_zero_period(period);
                    let db_updated = self.db.create_new_odds_entry(
                        fixture_id,
                        event.event_id,
                        &zero_period,
                        &event.home,
                        &event.away,
                        existing_data.as_ref()
                    ).await?;
                    if db_updated {
                        fixtures_updated += 1;
                    }
                    events_processed += 1;
                } else {
                    debug!("Skipping event {}: Market closed (status={}, has_odds={}, future={}, meta={})",
                        event.event_id, period.period_status, has_odds, cutoff_in_future, meta_open);
                }
                continue;
            }

            events_processed += 1;

            // Determine fixture_id first (without doing DB operations yet)
            let (fixture_id_for_update, existing_data) = if let Some(&(fixture_id, ref existing_data)) = existing_odds.get(&event.event_id) {
                // Existing odds - we have fixture_id
                // existing_data is &Option<Value>, convert to Option<&Value>
                (Some(fixture_id), existing_data.as_ref())
            } else {
                // New entry - find fixture
                let start_time = match chrono::DateTime::parse_from_rfc3339(&event.starts) {
                    Ok(dt) => dt.with_timezone(&chrono::Utc),
                    Err(_) => continue,
                };

                let fixture_id = self.db.find_matching_fixture(
                    start_time,
                    &event.home,
                    &event.away,
                    event.league_id,
                    event.event_id  // Pass event_id for caching
                ).await?;

                if let Some(fid) = fixture_id {
                    (Some(fid), None)
                } else {
                    info!("No matching fixture found for event {} ({} v {}) in league {}", event.event_id, event.home, event.away, event.league_id);
                    (None, None)
                }
            };

            // Perform database operations FIRST
            if let Some(fixture_id) = fixture_id_for_update {
                let db_updated = self.db.create_new_odds_entry(
                    fixture_id,
                    event.event_id,
                    period,
                    &event.home,
                    &event.away,
                    existing_data
                ).await?;
                
                // Only send to processor if odds actually changed (database was updated)
                if db_updated {
                    if let Some(ref client) = self.processor_client {
                        // Use event.last timestamp as start time for latency measurement
                        // This represents when Pinnacle last updated the odds for this event
                        // Convert from seconds to milliseconds to match our timestamp format
                        let start_timestamp = event.last
                            .map(|last| last * 1000) // Convert seconds to milliseconds
                            .unwrap_or(fetch_start_time); // Fallback to fetch start time

                        let update = self.create_processor_update(fixture_id, period, start_timestamp);
                        let _ = client.send(&update).await;
                    }
                    fixtures_updated += 1;
                }
            }
        }

        if events_processed > 0 {
            debug!("Processed {} events, updated {} fixtures", events_processed, fixtures_updated);
        }

        Ok(())
    }

    fn create_zero_period(&self, period: &PinnaclePeriod) -> PinnaclePeriod {
        use crate::pinnacle::types::*;

        PinnaclePeriod {
            line_id: period.line_id,
            number: period.number,
            description: period.description.clone(),
            cutoff: period.cutoff.clone(),
            period_status: period.period_status,
            money_line: period.money_line.as_ref().map(|_| MoneyLine {
                home: 0.0,
                draw: 0.0,
                away: 0.0,
            }),
            spreads: period.spreads.as_ref().map(|spreads| {
                let mut zero_spreads = std::collections::HashMap::new();
                for (key, spread) in spreads {
                    zero_spreads.insert(key.clone(), PinnacleSpread {
                        hdp: spread.hdp,
                        alt_line_id: spread.alt_line_id,
                        home: 0.0,
                        away: 0.0,
                        max: Some(0.0),
                    });
                }
                zero_spreads
            }),
            totals: period.totals.as_ref().map(|totals| {
                let mut zero_totals = std::collections::HashMap::new();
                for (key, total) in totals {
                    zero_totals.insert(key.clone(), PinnacleTotal {
                        points: total.points,
                        alt_line_id: total.alt_line_id,
                        over: 0.0,
                        under: 0.0,
                        max: Some(0.0),
                    });
                }
                zero_totals
            }),
            meta: period.meta.as_ref().map(|meta| Meta {
                number: meta.number,
                max_money_line: meta.max_money_line.map(|_| 0.0),
                max_spread: meta.max_spread.map(|_| 0.0),
                max_total: meta.max_total.map(|_| 0.0),
                max_team_total: meta.max_team_total.map(|_| 0.0),
                open_money_line: Some(false),
                open_spreads: Some(false),
                open_totals: Some(false),
                open_team_total: Some(false),
            }),
        }
    }

    fn create_processor_update(&self, fixture_id: i64, period: &PinnaclePeriod, start_timestamp: i64) -> OddsUpdate {
        // Pinnacle bookie_id = 2, decimals = 3
        let bookie_id = 2i64;
        let decimals = 3i32;
        let timestamp = chrono::Utc::now().timestamp_millis();

        let mut update = OddsUpdate {
            fixture_id,
            bookie_id,
            bookmaker: "Pinnacle".to_string(),
            timestamp,
            start: start_timestamp,
            decimals,
            ..Default::default()
        };

        // Build IDs
        let mut line_ids = serde_json::Map::new();
        let mut max_stakes_entry = serde_json::Map::new();
        max_stakes_entry.insert("t".to_string(), serde_json::json!(timestamp));

        // X12 odds
        if let Some(ref ml) = period.money_line {
            let x12 = [
                self.transform_pinnacle_odds(ml.home),
                self.transform_pinnacle_odds(ml.draw),
                self.transform_pinnacle_odds(ml.away),
            ];
            update.x12 = Some(x12);

            // Max stakes for X12
            if let Some(ref meta) = period.meta {
                if let Some(max_ml) = meta.max_money_line {
                    max_stakes_entry.insert("max_stake_x12".to_string(), serde_json::json!([max_ml, max_ml, max_ml]));
                }
            }
        }

        // AH odds (spreads)
        if let Some(ref spreads) = period.spreads {
            let mut lines: Vec<f64> = Vec::new();
            let mut ah_h: Vec<i32> = Vec::new();
            let mut ah_a: Vec<i32> = Vec::new();
            let mut ah_line_ids: Vec<i64> = Vec::new();

            for spread in spreads.values() {
                lines.push(spread.hdp);
                ah_h.push(self.transform_pinnacle_odds(spread.home));
                ah_a.push(self.transform_pinnacle_odds(spread.away));
                ah_line_ids.push(spread.alt_line_id.unwrap_or(0));
            }

            if !lines.is_empty() {
                update.ah_lines = Some(lines);
                update.ah_h = Some(ah_h);
                update.ah_a = Some(ah_a);
                line_ids.insert("ah".to_string(), serde_json::json!(ah_line_ids));

                // Max stakes for AH
                if let Some(ref meta) = period.meta {
                    if let Some(max_spread) = meta.max_spread {
                        let h_stakes: Vec<f64> = (0..spreads.len()).map(|_| max_spread).collect();
                        let a_stakes = h_stakes.clone();
                        max_stakes_entry.insert("max_stake_ah".to_string(), serde_json::json!({
                            "h": h_stakes,
                            "a": a_stakes
                        }));
                    }
                }
            }
        }

        // OU odds (totals)
        if let Some(ref totals) = period.totals {
            let mut lines: Vec<f64> = Vec::new();
            let mut ou_o: Vec<i32> = Vec::new();
            let mut ou_u: Vec<i32> = Vec::new();
            let mut ou_line_ids: Vec<i64> = Vec::new();

            for total in totals.values() {
                lines.push(total.points);
                ou_o.push(self.transform_pinnacle_odds(total.over));
                ou_u.push(self.transform_pinnacle_odds(total.under));
                ou_line_ids.push(total.alt_line_id.unwrap_or(0));
            }

            if !lines.is_empty() {
                update.ou_lines = Some(lines);
                update.ou_o = Some(ou_o);
                update.ou_u = Some(ou_u);
                line_ids.insert("ou".to_string(), serde_json::json!(ou_line_ids));

                // Max stakes for OU
                if let Some(ref meta) = period.meta {
                    if let Some(max_total) = meta.max_total {
                        let o_stakes: Vec<f64> = (0..totals.len()).map(|_| max_total).collect();
                        let u_stakes = o_stakes.clone();
                        max_stakes_entry.insert("max_stake_ou".to_string(), serde_json::json!({
                            "o": o_stakes,
                            "u": u_stakes
                        }));
                    }
                }
            }
        }

        // Build IDs structure
        if !line_ids.is_empty() {
            update.ids = Some(serde_json::json!({
                "t": timestamp,
                "line_ids": line_ids
            }));
        }

        // Build max_stakes structure
        if max_stakes_entry.len() > 1 {  // More than just "t"
            update.max_stakes = Some(serde_json::Value::Object(max_stakes_entry));
        }

        // Build latest_t
        let mut latest_t = serde_json::Map::new();
        if update.x12.is_some() {
            latest_t.insert("x12_ts".to_string(), serde_json::json!(timestamp));
        }
        if update.ah_lines.is_some() {
            latest_t.insert("ah_ts".to_string(), serde_json::json!(timestamp));
            latest_t.insert("lines_ts".to_string(), serde_json::json!(timestamp));
        }
        if update.ou_lines.is_some() {
            latest_t.insert("ou_ts".to_string(), serde_json::json!(timestamp));
            latest_t.insert("lines_ts".to_string(), serde_json::json!(timestamp));
        }
        if update.ids.is_some() {
            latest_t.insert("ids_ts".to_string(), serde_json::json!(timestamp));
        }
        if update.max_stakes.is_some() {
            latest_t.insert("stakes_ts".to_string(), serde_json::json!(timestamp));
        }
        if !latest_t.is_empty() {
            update.latest_t = Some(serde_json::Value::Object(latest_t));
        }

        update
    }

    fn transform_pinnacle_odds(&self, decimal_odds: f64) -> i32 {
        // Pinnacle returns decimal odds with 3 decimals (e.g., 1.952, 2.105)
        // Convert to basis points with 3 decimals (1952, 2105)
        (decimal_odds * 1000.0).round() as i32
    }
}

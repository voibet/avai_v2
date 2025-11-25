pub mod types;
pub mod client;
pub mod db;

use crate::pinnacle::client::PinnacleApiClient;
use crate::pinnacle::db::PinnacleDbService;
use crate::pinnacle::types::PinnaclePeriod;
use sqlx::PgPool;
use std::time::Duration;
use tracing::{debug, error, info};

pub struct PinnacleService {
    client: PinnacleApiClient,
    db: PinnacleDbService,
}

impl PinnacleService {
    pub fn new(pool: PgPool) -> Self {
        Self {
            client: PinnacleApiClient::new(),
            db: PinnacleDbService::new(pool),
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
                    self.db.create_new_odds_entry(
                        fixture_id,
                        event.event_id,
                        &zero_period,
                        &event.home,
                        &event.away,
                        existing_data.as_ref()
                    ).await?;
                    fixtures_updated += 1;
                    events_processed += 1;
                } else {
                    debug!("Skipping event {}: Market closed (status={}, has_odds={}, future={}, meta={})",
                        event.event_id, period.period_status, has_odds, cutoff_in_future, meta_open);
                }
                continue;
            }

            events_processed += 1;

            if let Some(&(fixture_id, ref existing_data)) = existing_odds.get(&event.event_id) {
                // Update existing odds
                self.db.create_new_odds_entry(
                    fixture_id,
                    event.event_id,
                    period,
                    &event.home,
                    &event.away,
                    existing_data.as_ref()
                ).await?;
                fixtures_updated += 1;
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
                    self.db.create_new_odds_entry(
                        fid,
                        event.event_id,
                        period,
                        &event.home,
                        &event.away,
                        None
                    ).await?;
                    fixtures_updated += 1;
                } else {
                    info!("No matching fixture found for event {} ({} v {}) in league {}", event.event_id, event.home, event.away, event.league_id);
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
}

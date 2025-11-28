use crate::pinnacle::types::PinnaclePeriod;
use serde_json::Value;
use sqlx::{PgPool, Row};
use std::collections::{HashMap, HashSet};
use tracing::info;
use chrono::{DateTime, Utc};

// Constants
const PINNACLE_DECIMALS: i32 = 3;


pub struct PinnacleDbService {
    pool: PgPool,
    known_leagues: HashSet<i32>,
    league_mapping: HashMap<i32, i32>, // pinnacle_league_id -> internal league_id
    event_cache: HashMap<i64, i64>, // event_id (bookie_id) -> fixture_id
}

impl PinnacleDbService {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            known_leagues: HashSet::new(),
            league_mapping: HashMap::new(),
            event_cache: HashMap::new(),
        }
    }

    pub async fn load_known_leagues(&mut self) -> Result<(), sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT id, pinnacle_league_id
            FROM football_leagues
            WHERE pinnacle_league_id IS NOT NULL
            "#
        )
        .fetch_all(&self.pool)
        .await?;

        self.known_leagues.clear();
        self.league_mapping.clear();
        
        for row in rows {
            let internal_id: i32 = row.get("id");
            let pinnacle_id: i32 = row.get("pinnacle_league_id");
            
            self.known_leagues.insert(pinnacle_id);
            self.league_mapping.insert(pinnacle_id, internal_id);
        }

        info!("Loaded {} known Pinnacle league IDs with mappings", self.known_leagues.len());
        Ok(())
    }

    pub fn is_league_known(&self, league_id: i32) -> bool {
        self.known_leagues.contains(&league_id)
    }

    // Combined query: get both fixture_id mapping AND existing odds data in one query
    pub async fn get_existing_odds_combined(&mut self, event_ids: &[i64]) 
        -> Result<HashMap<i64, (i64, Option<Value>)>, sqlx::Error> 
    {
        if event_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let query = r#"
            SELECT 
                bookie_id,
                fixture_id, 
                odds_x12, 
                odds_ah, 
                odds_ou, 
                lines, 
                ids, 
                max_stakes, 
                latest_t
            FROM football_odds
            WHERE bookie_id = ANY($1) AND bookie = 'Pinnacle'
        "#;

        let rows = sqlx::query(query)
            .bind(event_ids)
            .fetch_all(&self.pool)
            .await?;

        let mut map = HashMap::new();
        for row in rows {
            let bookie_id: i64 = row.get("bookie_id");
            let fixture_id: i64 = row.get("fixture_id");
            
            // Cache the event -> fixture mapping
            self.event_cache.insert(bookie_id, fixture_id);
            
            let data = serde_json::json!({
                "fixtureId": fixture_id,
                "oddsX12": row.get::<Option<Value>, _>("odds_x12"),
                "oddsAh": row.get::<Option<Value>, _>("odds_ah"),
                "oddsOu": row.get::<Option<Value>, _>("odds_ou"),
                "lines": row.get::<Option<Value>, _>("lines"),
                "ids": row.get::<Option<Value>, _>("ids"),
                "maxStakes": row.get::<Option<Value>, _>("max_stakes"),
                "latestT": row.get::<Option<Value>, _>("latest_t"),
            });

            map.insert(bookie_id, (fixture_id, Some(data)));
        }

        Ok(map)
    }

    pub async fn find_matching_fixture(
        &mut self,
        start_time: DateTime<Utc>,
        home_team: &str,
        away_team: &str,
        pinnacle_league_id: i32,
        event_id: i64,
    ) -> Result<Option<i64>, sqlx::Error> {
        // Check cache first
        if let Some(&cached_fixture_id) = self.event_cache.get(&event_id) {
            return Ok(Some(cached_fixture_id));
        }

        // Get league_id from in-memory mapping (no DB query!)
        let league_id = match self.league_mapping.get(&pinnacle_league_id) {
            Some(id) => *id,
            None => return Ok(None),
        };

        // Use global fixture matching
        use crate::shared::fixture_matching::{find_matching_fixture, FixtureMatchCriteria};

        let criteria = FixtureMatchCriteria {
            start_time: start_time.naive_utc(),
            home_team: home_team.to_string(),
            away_team: away_team.to_string(),
            league_id,
        };

        // We need to map the generic error from find_matching_fixture to sqlx::Error
        // or just unwrap/map_err since the signature returns sqlx::Error
        let fixture_id = match find_matching_fixture(&self.pool, criteria).await {
            Ok(id) => id,
            Err(e) => {
                tracing::error!("Error in global fixture matching: {}", e);
                return Err(sqlx::Error::Protocol(e.to_string().into()));
            }
        };

        // Cache the result if found
        if let Some(fid) = fixture_id {
            self.event_cache.insert(event_id, fid);
        }

        Ok(fixture_id)
    }

    pub async fn create_new_odds_entry(
        &self,
        fixture_id: i64,
        event_id: i64,
        period: &PinnaclePeriod,
        home_team: &str,
        away_team: &str,
        existing_data: Option<&Value>,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let timestamp = Utc::now().timestamp();

        let transform_odds = |odds: f64| -> i32 {
            (odds * 1000.0).round() as i32
        };

        // Prepare X12
        let mut x12_odds = Vec::new();
        if let Some(ml) = &period.money_line {
            x12_odds.push(serde_json::json!({
                "t": timestamp,
                "x12": [
                    transform_odds(ml.home),
                    transform_odds(ml.draw),
                    transform_odds(ml.away)
                ]
            }));
        }

        // Prepare AH and OU
        let mut ah_odds = Vec::new();
        let mut ou_odds = Vec::new();
        let mut lines = Vec::new();
        let mut ids = Vec::new();

        let mut combined_line_entry = serde_json::Map::new();
        combined_line_entry.insert("t".to_string(), serde_json::json!(timestamp));

        let mut combined_id_entry = serde_json::Map::new();
        combined_id_entry.insert("t".to_string(), serde_json::json!(timestamp));
        combined_id_entry.insert("line_id".to_string(), serde_json::json!(period.line_id));
        let mut line_ids_map = serde_json::Map::new();

        if let Some(spreads) = &period.spreads {
            if !spreads.is_empty() {
                let mut spread_keys: Vec<&String> = spreads.keys().collect();
                spread_keys.sort_by(|a, b| {
                    let fa = a.parse::<f64>().unwrap_or(0.0);
                    let fb = b.parse::<f64>().unwrap_or(0.0);
                    fa.partial_cmp(&fb).unwrap()
                });

                let mut ah_home = Vec::new();
                let mut ah_away = Vec::new();
                let mut ah_line_values = Vec::new();
                let mut ah_alt_line_ids = Vec::new();

                for key in spread_keys {
                    if let Some(spread) = spreads.get(key) {
                        ah_home.push(transform_odds(spread.home));
                        ah_away.push(transform_odds(spread.away));
                        ah_line_values.push(spread.hdp);
                        ah_alt_line_ids.push(spread.alt_line_id.unwrap_or(0));
                    }
                }

                ah_odds.push(serde_json::json!({
                    "t": timestamp,
                    "ah_h": ah_home,
                    "ah_a": ah_away
                }));

                combined_line_entry.insert("ah".to_string(), serde_json::json!(ah_line_values));
                line_ids_map.insert("ah".to_string(), serde_json::json!(ah_alt_line_ids));
            }
        }

        if let Some(totals) = &period.totals {
            if !totals.is_empty() {
                let mut total_keys: Vec<&String> = totals.keys().collect();
                total_keys.sort_by(|a, b| {
                    let fa = a.parse::<f64>().unwrap_or(0.0);
                    let fb = b.parse::<f64>().unwrap_or(0.0);
                    fa.partial_cmp(&fb).unwrap()
                });

                let mut ou_over = Vec::new();
                let mut ou_under = Vec::new();
                let mut ou_line_values = Vec::new();
                let mut ou_alt_line_ids = Vec::new();

                for key in total_keys {
                    if let Some(total) = totals.get(key) {
                        ou_over.push(transform_odds(total.over));
                        ou_under.push(transform_odds(total.under));
                        ou_line_values.push(total.points);
                        ou_alt_line_ids.push(total.alt_line_id.unwrap_or(0));
                    }
                }

                ou_odds.push(serde_json::json!({
                    "t": timestamp,
                    "ou_o": ou_over,
                    "ou_u": ou_under
                }));

                combined_line_entry.insert("ou".to_string(), serde_json::json!(ou_line_values));
                line_ids_map.insert("ou".to_string(), serde_json::json!(ou_alt_line_ids));
            }
        }

        if combined_line_entry.contains_key("ah") || combined_line_entry.contains_key("ou") {
            lines.push(Value::Object(combined_line_entry));
        }

        if !line_ids_map.is_empty() {
            combined_id_entry.insert("line_ids".to_string(), Value::Object(line_ids_map));
            ids.push(Value::Object(combined_id_entry));
        }

        // Prepare max stakes
        let mut max_stakes = Vec::new();
        if let Some(meta) = &period.meta {
            let mut stake_entry = serde_json::Map::new();
            stake_entry.insert("t".to_string(), serde_json::json!(timestamp));
            
            if let Some(max) = meta.max_money_line {
                stake_entry.insert("max_stake_x12".to_string(), serde_json::json!([max]));
            } else {
                stake_entry.insert("max_stake_x12".to_string(), serde_json::json!([]));
            }

            if let Some(max) = meta.max_spread {
                stake_entry.insert("max_stake_ah".to_string(), serde_json::json!({"h": [max], "a": [max]}));
            } else {
                stake_entry.insert("max_stake_ah".to_string(), serde_json::json!({}));
            }

            if let Some(max) = meta.max_total {
                stake_entry.insert("max_stake_ou".to_string(), serde_json::json!({"o": [max], "u": [max]}));
            } else {
                stake_entry.insert("max_stake_ou".to_string(), serde_json::json!({}));
            }

            max_stakes.push(Value::Object(stake_entry));
        }

        // Merge with existing data
        let mut final_x12 = x12_odds;
        let mut final_ah = ah_odds;
        let mut final_ou = ou_odds;
        let mut final_lines = lines;
        let mut final_max_stakes = max_stakes;

        let mut updates = Vec::new();

        if let Some(existing) = existing_data {
            let ex_x12 = existing.get("oddsX12").and_then(|v| v.as_array()).map(|v| v.len()).unwrap_or(0);
            final_x12 = self.merge_history(existing.get("oddsX12"), final_x12);
            if final_x12.len() > ex_x12 { updates.push("X12"); }

            let ex_ah = existing.get("oddsAh").and_then(|v| v.as_array()).map(|v| v.len()).unwrap_or(0);
            final_ah = self.merge_history(existing.get("oddsAh"), final_ah);
            if final_ah.len() > ex_ah { updates.push("AH"); }

            let ex_ou = existing.get("oddsOu").and_then(|v| v.as_array()).map(|v| v.len()).unwrap_or(0);
            final_ou = self.merge_history(existing.get("oddsOu"), final_ou);
            if final_ou.len() > ex_ou { updates.push("OU"); }

            let ex_lines = existing.get("lines").and_then(|v| v.as_array()).map(|v| v.len()).unwrap_or(0);
            final_lines = self.merge_history(existing.get("lines"), final_lines);
            if final_lines.len() > ex_lines { updates.push("Lines"); }

            let ex_stakes = existing.get("maxStakes").and_then(|v| v.as_array()).map(|v| v.len()).unwrap_or(0);
            final_max_stakes = self.merge_history(existing.get("maxStakes"), final_max_stakes);
            if final_max_stakes.len() > ex_stakes { updates.push("Stakes"); }
        } else {
            // New entry
            if !final_x12.is_empty() { updates.push("X12"); }
            if !final_ah.is_empty() { updates.push("AH"); }
            if !final_ou.is_empty() { updates.push("OU"); }
            if !final_lines.is_empty() { updates.push("Lines"); }
            if !final_max_stakes.is_empty() { updates.push("Stakes"); }
        }

        // Latest T
        let mut latest_t = if let Some(existing) = existing_data {
             existing.get("latestT").cloned().unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        if let Some(obj) = latest_t.as_object_mut() {
            if !final_x12.is_empty() { obj.insert("x12_ts".to_string(), serde_json::json!(timestamp)); }
            if !final_ah.is_empty() { obj.insert("ah_ts".to_string(), serde_json::json!(timestamp)); }
            if !final_ou.is_empty() { obj.insert("ou_ts".to_string(), serde_json::json!(timestamp)); }
            if !final_lines.is_empty() { obj.insert("lines_ts".to_string(), serde_json::json!(timestamp)); }
            if !ids.is_empty() { obj.insert("ids_ts".to_string(), serde_json::json!(timestamp)); }
        }

        if !updates.is_empty() {
            let upsert_query = r#"
            INSERT INTO football_odds (
                fixture_id, bookie_id, bookie, decimals,
                odds_x12, odds_ah, odds_ou, lines, ids, max_stakes, latest_t, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (fixture_id, bookie) DO UPDATE SET
                bookie_id = EXCLUDED.bookie_id,
                odds_x12 = EXCLUDED.odds_x12,
                odds_ah = EXCLUDED.odds_ah,
                odds_ou = EXCLUDED.odds_ou,
                lines = EXCLUDED.lines,
                ids = EXCLUDED.ids,
                max_stakes = EXCLUDED.max_stakes,
                latest_t = EXCLUDED.latest_t,
                updated_at = EXCLUDED.updated_at
            "#;

            sqlx::query(upsert_query)
                .bind(fixture_id)
                .bind(event_id)
                .bind("Pinnacle")
                .bind(PINNACLE_DECIMALS)
                .bind(if !final_x12.is_empty() { Some(serde_json::json!(final_x12)) } else { None })
                .bind(if !final_ah.is_empty() { Some(serde_json::json!(final_ah)) } else { None })
                .bind(if !final_ou.is_empty() { Some(serde_json::json!(final_ou)) } else { None })
                .bind(if !final_lines.is_empty() { Some(serde_json::json!(final_lines)) } else { None })
                .bind(if !ids.is_empty() { Some(serde_json::json!(ids)) } else { None })
                .bind(if !final_max_stakes.is_empty() { Some(serde_json::json!(final_max_stakes)) } else { None })
                .bind(latest_t)
                .bind(Utc::now())
                .execute(&self.pool)
                .await?;

            info!("✅ Updated odds for {} v {} (fixture: {}). Changes: {:?}. Database updated.", home_team, away_team, fixture_id, updates);
            Ok(true) // Database was updated
        } else {
            Ok(false) // No changes, database not updated
        }
    }

    fn merge_history(&self, existing: Option<&Value>, new_items: Vec<Value>) -> Vec<Value> {
        if new_items.is_empty() {
            return existing.cloned().unwrap_or(serde_json::json!([])).as_array().cloned().unwrap_or_default();
        }

        let mut result = existing.cloned().unwrap_or(serde_json::json!([])).as_array().cloned().unwrap_or_default();
        
        if !result.is_empty() {
            let last = &result[result.len() - 1];
            let new_item = &new_items[0];
            
            if self.is_different(last, new_item) {
                result.push(new_item.clone());
            }
        } else {
            result.push(new_items[0].clone());
        }

        result
    }

    fn is_different(&self, v1: &Value, v2: &Value) -> bool {
        // Compare without 't' field
        let mut c1 = v1.clone();
        let mut c2 = v2.clone();
        
        if let Some(obj) = c1.as_object_mut() { obj.remove("t"); }
        if let Some(obj) = c2.as_object_mut() { obj.remove("t"); }

        c1 != c2
    }
}

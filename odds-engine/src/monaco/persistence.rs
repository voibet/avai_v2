use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use tracing::info;
use chrono::Utc;

use crate::monaco::types::MonacoMarket;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinesEntry {
    pub t: i64,
    pub ah: Option<Vec<f64>>,
    pub ou: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdsEntry {
    pub t: i64,
    pub line_id: Option<String>,
    pub line_ids: LineIds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineIds {
    pub x12: Vec<String>,
    pub ah: Vec<String>,
    pub ou: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaxStakesEntry {
    pub t: i64,
    pub max_stake_x12: Option<[f64; 3]>,
    pub max_stake_ah: Option<MaxStakeAhOu>,
    pub max_stake_ou: Option<MaxStakeAhOu>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaxStakeAhOu {
    pub h: Vec<f64>, // Home/Over stakes
    pub a: Vec<f64>, // Away/Under stakes
}

#[derive(Debug, Clone)]
pub struct FixtureStructure {
    #[allow(dead_code)]
    pub timestamp: i64,
    pub lines_entry: LinesEntry,
    pub ids_entry: IdsEntry,
    pub max_stakes_entry: MaxStakesEntry,
    pub line_index_map: HashMap<String, usize>,
}

pub async fn ensure_fixture_odds_record(
    pool: &PgPool,
    fixture_id: i64,
    markets: Vec<MonacoMarket>,
) -> Result<HashMap<String, usize>, Box<dyn std::error::Error + Send + Sync>> {
    if markets.is_empty() {
        return Ok(HashMap::new());
    }

    let _event_id = markets[0].event.ids.first().unwrap().clone();
    let timestamp = Utc::now().timestamp();

    // Build the fixture structure
    let structure = build_fixture_structure(&markets, timestamp);

    // Serialize JSON fields
    let lines_json = serde_json::to_value(&vec![structure.lines_entry.clone()])?;
    let ids_json = serde_json::to_value(&vec![structure.ids_entry.clone()])?;
    let max_stakes_json = serde_json::to_value(&vec![structure.max_stakes_entry.clone()])?;
    let latest_t = serde_json::json!({
        "x12_ts": timestamp,
        "ah_ts": timestamp,
        "ou_ts": timestamp,
        "lines_ts": timestamp,
        "ids_ts": timestamp,
        "stakes_ts": timestamp
    });

    // Check if record exists
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT fixture_id FROM football_odds WHERE fixture_id = $1 AND bookie = $2"
    )
    .bind(fixture_id)
    .bind("Monaco")
    .fetch_optional(pool)
    .await?;

    if existing.is_none() {
        // Insert new record
        sqlx::query(
            r#"
            INSERT INTO football_odds (
                fixture_id, bookie_id, bookie, decimals,
                odds_x12, odds_ah, odds_ou, lines, ids, max_stakes, latest_t
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            "#
        )
        .bind(fixture_id)
        .bind(1i64) // Monaco bookie_id
        .bind("Monaco")
        .bind(3)
        .bind(serde_json::json!([]))
        .bind(serde_json::json!([]))
        .bind(serde_json::json!([]))
        .bind(&lines_json)
        .bind(&ids_json)
        .bind(&max_stakes_json)
        .bind(&latest_t)
        .execute(pool)
        .await?;

        info!("✅ Database INSERT completed for fixture_id={}", fixture_id);
    } else {
        // Update existing record
        sqlx::query(
            r#"
            UPDATE football_odds
            SET lines = $1, ids = $2, max_stakes = $3, latest_t = $4, bookie_id = $5, updated_at = NOW()
            WHERE fixture_id = $6 AND bookie = $7
            "#
        )
        .bind(&lines_json)
        .bind(&ids_json)
        .bind(&max_stakes_json)
        .bind(&latest_t)
        .bind(1i64) // Monaco bookie_id
        .bind(fixture_id)
        .bind("Monaco")
        .execute(pool)
        .await?;

        info!("✅ Database UPDATE completed for fixture_id={}", fixture_id);
    }

    Ok(structure.line_index_map)
}

fn build_fixture_structure(markets: &[MonacoMarket], timestamp: i64) -> FixtureStructure {
    let mut lines_entry = LinesEntry {
        t: timestamp,
        ah: None,
        ou: None,
    };

    let mut ids_entry = IdsEntry {
        t: timestamp,
        line_id: None,
        line_ids: LineIds {
            x12: vec![],
            ah: vec![],
            ou: vec![],
        },
    };

    let mut max_stakes_entry = MaxStakesEntry {
        t: timestamp,
        max_stake_x12: None,
        max_stake_ah: None,
        max_stake_ou: None,
    };

    let line_index_map: HashMap<String, usize> = HashMap::new();

    let mut x12_markets = vec![];
    let mut ah_lines = vec![];
    let mut ou_lines = vec![];

    // Categorize markets
    for market in markets {
        let market_type_id = market.market_type.ids.first().unwrap();
        let market_type = map_market_type(market_type_id);
        
        match market_type.as_deref() {
            Some("x12") => x12_markets.push(market.clone()),
            Some("ah") => {
                if let Some(value) = get_handicap_value(market) {
                    ah_lines.push((value, market.clone()));
                }
            }
            Some("ou") => {
                if let Some(value) = get_total_value(market) {
                    ou_lines.push((value, market.clone()));
                }
            }
            _ => {}
        }
    }

    // Sort lines
    ah_lines.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    ou_lines.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    // Process AH lines
    if !ah_lines.is_empty() {
        lines_entry.ah = Some(ah_lines.iter().map(|(v, _)| *v).collect());
        let ah_count = ah_lines.len();
        max_stakes_entry.max_stake_ah = Some(MaxStakeAhOu {
            h: vec![0.0; ah_count],
            a: vec![0.0; ah_count],
        });

        for (line_index, (_, market)) in ah_lines.iter().enumerate() {
            // Create placeholder outcomes from IDs since we don't have full outcome data
            let mut sorted_outcomes: Vec<_> = market.market_outcomes.ids.iter().enumerate()
                .map(|(i, id)| crate::monaco::types::MonacoOutcome {
                    id: id.clone(),
                    title: format!("Outcome {}", i),
                    ordering: i as i32,
                })
                .collect();
            sorted_outcomes.sort_by_key(|o| o.ordering);
            ids_entry.line_ids.ah.extend(sorted_outcomes.iter().map(|o| o.id.clone()));

            if let Some(prices) = &market.prices {
                for price in prices {
                    if price.side == "Against" {
                        if let Some(outcome_index) = market.market_outcomes.ids.iter().position(|id| id == &price.outcome_id) {
                            let is_home = outcome_index % 2 == 0;
                            if let Some(ref mut stakes) = max_stakes_entry.max_stake_ah {
                                if is_home {
                                    stakes.h[line_index] += price.liquidity;
                                } else {
                                    stakes.a[line_index] += price.liquidity;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Process OU lines
    if !ou_lines.is_empty() {
        lines_entry.ou = Some(ou_lines.iter().map(|(v, _)| *v).collect());
        let ou_count = ou_lines.len();
        max_stakes_entry.max_stake_ou = Some(MaxStakeAhOu {
            h: vec![0.0; ou_count], // Over
            a: vec![0.0; ou_count], // Under
        });

        for (line_index, (_, market)) in ou_lines.iter().enumerate() {
            // Create placeholder outcomes from IDs since we don't have full outcome data
            let mut sorted_outcomes: Vec<_> = market.market_outcomes.ids.iter().enumerate()
                .map(|(i, id)| crate::monaco::types::MonacoOutcome {
                    id: id.clone(),
                    title: format!("Outcome {}", i),
                    ordering: i as i32,
                })
                .collect();
            sorted_outcomes.sort_by_key(|o| o.ordering);
            ids_entry.line_ids.ou.extend(sorted_outcomes.iter().map(|o| o.id.clone()));

            if let Some(prices) = &market.prices {
                for price in prices {
                    if price.side == "Against" {
                        if let Some(outcome_index) = market.market_outcomes.ids.iter().position(|id| id == &price.outcome_id) {
                            let is_over = outcome_index % 2 == 0;
                            if let Some(ref mut stakes) = max_stakes_entry.max_stake_ou {
                                if is_over {
                                    stakes.h[line_index] += price.liquidity;
                                } else {
                                    stakes.a[line_index] += price.liquidity;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Process X12 markets
    if !x12_markets.is_empty() {
        let market = &x12_markets[0];
        max_stakes_entry.max_stake_x12 = Some([0.0, 0.0, 0.0]);
        ids_entry.line_id = Some(market.id.clone());

        // Create placeholder outcomes from IDs since we don't have full outcome data
        let mut sorted_outcomes: Vec<_> = market.market_outcomes.ids.iter().enumerate()
            .map(|(i, id)| crate::monaco::types::MonacoOutcome {
                id: id.clone(),
                title: format!("Outcome {}", i),
                ordering: i as i32,
            })
            .collect();
        sorted_outcomes.sort_by_key(|o| o.ordering);
        ids_entry.line_ids.x12 = sorted_outcomes.iter().map(|o| o.id.clone()).collect();

        if let Some(prices) = &market.prices {
            for price in prices {
                if price.side == "Against" {
                    if let Some(outcome_index) = market.market_outcomes.ids.iter().position(|id| id == &price.outcome_id) {
                        if let Some(ref mut stakes) = max_stakes_entry.max_stake_x12 {
                            stakes[outcome_index] += price.liquidity;
                        }
                    }
                }
            }
        }
    }

    FixtureStructure {
        timestamp,
        lines_entry,
        ids_entry,
        max_stakes_entry,
        line_index_map,
    }
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
    // Match: "Goal Handicap +1.5" or similar
    let re = regex::Regex::new(r"Goal Handicap ([+-]?[\d.]+)").ok()?;
    re.captures(&market.name)?.get(1)?.as_str().parse().ok()
}

fn get_total_value(market: &MonacoMarket) -> Option<f64> {
    // Match: "Total Goals Over/Under 2.5" or similar
    let re = regex::Regex::new(r"Total Goals Over/Under ([\d.]+)").ok()?;
    re.captures(&market.name)?.get(1)?.as_str().parse().ok()
}

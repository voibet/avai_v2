use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PinnacleMarket {
    pub sport_id: i32,
    pub sport_name: String,
    pub last: i64,
    pub last_call: Option<i64>,
    pub events: Vec<PinnacleEvent>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PinnacleEvent {
    pub event_id: i64,
    pub sport_id: i32,
    pub league_id: i32,
    pub league_name: Option<String>,
    pub starts: String,
    pub last: Option<i64>,
    pub home: String,
    pub away: String,
    pub event_type: Option<String>,
    pub live_status_id: Option<i32>,
    pub parent_id: Option<i64>,
    pub resulting_unit: Option<String>,
    pub is_actual: Option<bool>,
    pub home_team_type: Option<String>,
    pub is_have_odds: Option<bool>,
    pub is_have_periods: Option<bool>,
    pub is_have_open_markets: Option<bool>,
    pub periods: Option<Periods>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Periods {
    pub num_0: Option<PinnaclePeriod>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PinnaclePeriod {
    pub line_id: i64,
    pub number: i32,
    pub description: Option<String>,
    pub cutoff: String,
    pub period_status: i32,
    pub money_line: Option<MoneyLine>,
    pub spreads: Option<HashMap<String, PinnacleSpread>>,
    pub totals: Option<HashMap<String, PinnacleTotal>>,
    pub meta: Option<Meta>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MoneyLine {
    pub home: f64,
    pub draw: f64,
    pub away: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PinnacleSpread {
    pub hdp: f64,
    pub alt_line_id: Option<i64>,
    pub home: f64,
    pub away: f64,
    pub max: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PinnacleTotal {
    pub points: f64,
    pub alt_line_id: Option<i64>,
    pub over: f64,
    pub under: f64,
    pub max: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Meta {
    pub number: Option<i32>,
    pub max_money_line: Option<f64>,
    pub max_spread: Option<f64>,
    pub max_total: Option<f64>,
    pub max_team_total: Option<f64>,
    pub open_money_line: Option<bool>,
    pub open_spreads: Option<bool>,
    pub open_totals: Option<bool>,
    pub open_team_total: Option<bool>,
}

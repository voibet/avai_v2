use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use crate::filters::{FilterExpr, MatchTrace};

/// Incoming update from odds-engine via TCP
/// Matches the same data format stored in football_odds table
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OddsUpdate {
    pub fixture_id: i64,
    #[serde(default)]
    pub bookie_id: i64,
    pub bookmaker: String,
    pub timestamp: i64,           // Original timestamp
    #[serde(default)]
    pub start: i64,               // First touch - when odds were received from bookmaker API (ms)
    #[serde(default = "default_decimals")]
    pub decimals: i32,

    // X12 odds (optional) - array format from odds-engine: [home, draw, away]
    pub x12: Option<[i32; 3]>,

    // AH odds (optional)
    pub ah_lines: Option<Vec<f64>>,
    pub ah_h: Option<Vec<i32>>,
    pub ah_a: Option<Vec<i32>>,

    // OU odds (optional)
    pub ou_lines: Option<Vec<f64>>,
    pub ou_o: Option<Vec<i32>>,
    pub ou_u: Option<Vec<i32>>,

    // IDs (matches ids column in DB)
    pub ids: Option<Value>,

    // Max stakes (matches max_stakes column in DB)
    pub max_stakes: Option<Value>,

    // Latest timestamps per market type (matches latest_t column in DB)
    pub latest_t: Option<Value>,
}

fn default_decimals() -> i32 {
    3
}

/// Odds for a single bookmaker
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BookmakerOdds {
    pub bookie_id: i64,
    pub decimals: i32,

    // X12 - split into separate outcomes
    pub x12_h: Option<i32>,  // Home
    pub x12_x: Option<i32>,  // Draw
    pub x12_a: Option<i32>,  // Away
    pub fair_x12_h: Option<i32>,
    pub fair_x12_x: Option<i32>,
    pub fair_x12_a: Option<i32>,

    // AH
    pub ah_lines: Vec<f64>,
    pub ah_h: Vec<i32>,
    pub ah_a: Vec<i32>,
    pub fair_ah_h: Vec<i32>,
    pub fair_ah_a: Vec<i32>,

    // OU
    pub ou_lines: Vec<f64>,
    pub ou_o: Vec<i32>,
    pub ou_u: Vec<i32>,
    pub fair_ou_o: Vec<i32>,
    pub fair_ou_u: Vec<i32>,

    // IDs (matches ids column in DB)
    pub ids: Option<Value>,

    // Max stakes (matches max_stakes column in DB)
    pub max_stakes: Option<Value>,

    // Latest timestamps per market type
    pub latest_t: Option<Value>,

    pub timestamp: i64,
}

/// Data for a single fixture
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureData {
    pub fixture_id: i64,
    pub bookmakers: HashMap<String, BookmakerOdds>,
    pub last_update: i64,
}

/// Client state for WebSocket connections with filtering
#[derive(Debug, Clone)]
pub struct ClientState {
    pub filter: Option<FilterExpr>,
    pub matching_fixtures: HashSet<i64>,
}

impl ClientState {
    pub fn new() -> Self {
        Self {
            filter: None,
            matching_fixtures: HashSet::new(),
        }
    }
}

impl FixtureData {
    pub fn new(fixture_id: i64) -> Self {
        Self {
            fixture_id,
            bookmakers: HashMap::new(),
            last_update: 0,
        }
    }

    pub fn to_ws_message(&self, msg_type: &str) -> WsMessage {
        let now = chrono::Utc::now().timestamp_millis();
        WsMessage {
            msg_type: msg_type.to_string(),
            fixture_id: self.fixture_id,
            timestamp: self.last_update,
            start: now,
            end: now,
            bookmakers: self.bookmakers.clone(),
            filter_matches: None,
        }
    }

    pub fn to_ws_message_with_traces(&self, msg_type: &str, traces: Vec<MatchTrace>) -> WsMessage {
        let now = chrono::Utc::now().timestamp_millis();
        WsMessage {
            msg_type: msg_type.to_string(),
            fixture_id: self.fixture_id,
            timestamp: self.last_update,
            start: now,
            end: now,
            bookmakers: self.bookmakers.clone(),
            filter_matches: if traces.is_empty() { None } else { Some(traces) },
        }
    }

    pub fn to_odds_removed_message(&self) -> WsMessage {
        let now = chrono::Utc::now().timestamp_millis();
        WsMessage {
            msg_type: "odds_removed".to_string(),
            fixture_id: self.fixture_id,
            timestamp: now,
            start: now,
            end: now,
            bookmakers: HashMap::new(),
            filter_matches: None,
        }
    }
}

/// WebSocket message to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub fixture_id: i64,
    pub timestamp: i64,           // Original odds-engine timestamp
    pub start: i64,               // First touch - when odds received from bookmaker API (ms)
    pub end: i64,                 // Last touch - when odds-processor sends WebSocket (ms)
    pub bookmakers: HashMap<String, BookmakerOdds>,
    /// Filter match traces - contains details about which calculations matched
    /// Only populated when a filter is active and the fixture matches
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_matches: Option<Vec<MatchTrace>>,
}

/// Stats for monitoring
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProcessorStats {
    pub fixtures_count: usize,
    pub updates_received: u64,
    pub updates_per_second: f64,
    pub ws_clients: usize,
    pub uptime_seconds: u64,
}

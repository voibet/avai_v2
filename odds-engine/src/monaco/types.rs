use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonacoMarket {
    pub id: String,
    pub name: String,
    #[serde(rename = "marketType")]
    pub market_type: MarketReference,
    pub event: MarketReference,
    #[serde(rename = "marketOutcomes")]
    pub market_outcomes: MarketReference,
    pub prices: Option<Vec<MonacoPrice>>,
    pub status: Option<String>,
    pub published: Option<bool>,
    #[serde(rename = "marketValue")]
    pub market_value: Option<String>,
    #[serde(rename = "marketDiscriminator")]
    pub market_discriminator: Option<String>,
    #[serde(rename = "ownerAppId")]
    pub owner_app_id: Option<String>,
    #[serde(rename = "currencyId")]
    pub currency_id: Option<String>,
    #[serde(rename = "inPlayStatus")]
    pub in_play_status: Option<String>,
    #[serde(rename = "inPlayDelay")]
    pub in_play_delay: Option<i32>,
    #[serde(rename = "crossMatchingEnabled")]
    pub cross_matching_enabled: Option<bool>,
    pub suspended: Option<bool>,
    #[serde(rename = "lockAt")]
    pub lock_at: Option<String>,
    #[serde(rename = "settledAt")]
    pub settled_at: Option<String>,
    #[serde(rename = "marketLockAction")]
    pub market_lock_action: Option<String>,
    #[serde(rename = "eventStartAction")]
    pub event_start_action: Option<String>,
    #[serde(rename = "externalReferences")]
    pub external_references: Option<MarketReference>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
    #[serde(rename = "modifiedAt")]
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketReference {
    #[serde(rename = "_ids")]
    pub ids: Vec<String>,
    #[serde(rename = "_ref")]
    pub ref_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonacoOutcome {
    pub id: String,
    pub title: String,
    pub ordering: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonacoPrice {
    pub side: String, // "Back" or "Lay" (or "Against")
    #[serde(rename = "outcomeId")]
    pub outcome_id: String,
    pub price: f64,
    pub liquidity: f64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketMapping {
    pub event_id: String,
    pub market_id: String,
    pub market_type_id: String,
    pub market_type: String, // "x12", "ah", "ou"
    pub name: String,
    pub line_value: Option<f64>,
    pub line_index: Option<usize>,
    pub fixture_id: Option<i64>,
    pub outcome_mappings: Option<HashMap<String, usize>>,
}

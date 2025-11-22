use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: f64,
    pub liquidity: f64,
}

// outcomeId -> Vec<PriceLevel> (sorted by price descending)
pub type OrderBook = HashMap<String, Vec<PriceLevel>>;

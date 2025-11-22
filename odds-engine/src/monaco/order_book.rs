use serde_json::Value;
use std::collections::HashMap;
use std::collections::HashSet;

use crate::order_book::{OrderBook, PriceLevel};

#[derive(Debug, Default)]
pub struct MonacoOrderBook {
    // "fixtureId-marketType" -> OrderBook
    order_books: HashMap<String, OrderBook>,
}

impl MonacoOrderBook {
    pub fn new() -> Self {
        Self {
            order_books: HashMap::new(),
        }
    }

    pub fn clear(&mut self) {
        self.order_books.clear();
    }

    pub fn initialize(
        &mut self,
        fixture_id: i64,
        markets: &[crate::monaco::types::MonacoMarket],
        map_market_type: fn(&str) -> Option<String>,
    ) {
        for market in markets {
            let market_type_id = market.market_type.ids.first().unwrap();
            let market_type = match map_market_type(market_type_id) {
                Some(mt) => mt,
                None => continue,
            };

            let prices = match &market.prices {
                Some(p) => p,
                None => continue,
            };

            let order_book_key = format!("{}-{}", fixture_id, market_type);
            let order_book = self.order_books.entry(order_book_key).or_insert_with(HashMap::new);

            let mut prices_by_outcome: HashMap<String, HashMap<String, f64>> = HashMap::new();

            // Aggregate liquidity by outcome and price
            for price in prices.iter().filter(|p| p.side == "Against") {
                let outcome_prices = prices_by_outcome
                    .entry(price.outcome_id.clone())
                    .or_insert_with(HashMap::new);

                let price_key = price.price.to_string();
                *outcome_prices.entry(price_key).or_insert(0.0) += price.liquidity;
            }

            // Convert to sorted price levels
            for (outcome_id, price_map) in prices_by_outcome {
                let mut levels: Vec<PriceLevel> = price_map
                    .into_iter()
                    .filter_map(|(price_str, liquidity)| {
                        let price: f64 = price_str.parse().ok()?;
                        if liquidity > 0.0 {
                            Some(PriceLevel { price, liquidity })
                        } else {
                            None
                        }
                    })
                    .collect();

                levels.sort_by(|a, b| b.price.partial_cmp(&a.price).unwrap());
                order_book.insert(outcome_id, levels);
            }
        }
    }

    pub fn update(
        &mut self,
        fixture_id: i64,
        message: &Value,
        market_type: &str,
        outcome_mappings: Option<&HashMap<String, usize>>,
    ) -> OrderBook {
        let order_book_key = format!("{}-{}", fixture_id, market_type);

        // Initialize if missing
        if !self.order_books.contains_key(&order_book_key) {
            let mut initial_order_book = OrderBook::new();

            if let Some(mappings) = outcome_mappings {
                for outcome_id in mappings.keys() {
                    initial_order_book.insert(outcome_id.clone(), vec![]);
                }
            } else if let Some(prices) = message["prices"].as_array() {
                for price in prices {
                    if let Some(outcome_id) = price["outcomeId"].as_str() {
                        initial_order_book.entry(outcome_id.to_string()).or_insert_with(Vec::new);
                    }
                }
            }

            self.order_books.insert(order_book_key.clone(), initial_order_book);
        }

        let order_book = self.order_books.get_mut(&order_book_key).unwrap();
        let mut affected_outcomes = HashSet::new();

        // Process price updates
        if let Some(prices) = message["prices"].as_array() {
            for price_update in prices {
                if price_update["side"].as_str() != Some("Against") {
                    continue;
                }

                let outcome_id = match price_update["outcomeId"].as_str() {
                    Some(id) => id.to_string(),
                    None => continue,
                };

                let price = match price_update["price"].as_f64() {
                    Some(p) => p,
                    None => continue,
                };

                let liquidity = price_update["liquidity"].as_f64().unwrap_or(0.0);

                let price_levels = order_book.entry(outcome_id.clone()).or_insert_with(Vec::new);

                // Find existing level
                if let Some(existing_index) = price_levels.iter().position(|level| level.price == price) {
                    if liquidity == 0.0 {
                        price_levels.remove(existing_index);
                    } else {
                        price_levels[existing_index].liquidity = liquidity;
                    }
                } else if liquidity > 0.0 {
                    price_levels.push(PriceLevel { price, liquidity });
                }

                affected_outcomes.insert(outcome_id);
            }
        }

        // Sort affected outcomes
        for outcome_id in affected_outcomes {
            if let Some(levels) = order_book.get_mut(&outcome_id) {
                levels.sort_by(|a, b| b.price.partial_cmp(&a.price).unwrap());
            }
        }

        order_book.clone()
    }

    pub fn get_order_book(&self, fixture_id: i64, market_type: &str) -> Option<&OrderBook> {
        self.order_books.get(&format!("{}-{}", fixture_id, market_type))
    }

    pub fn remove(&mut self, fixture_id: i64, market_type: &str) {
        self.order_books.remove(&format!("{}-{}", fixture_id, market_type));
    }
}

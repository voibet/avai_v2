use crate::types::{BookmakerOdds, FixtureData, OddsUpdate};
use crate::calculations::fair_odds::calculate_fair_odds;
use std::collections::{HashMap, BTreeMap};
use tracing::info;

pub struct Cache {
    pub fixtures: HashMap<i64, FixtureData>,
    // (timestamp, fixture_id) -> ()
    // Ordered by timestamp, so first entry is oldest
    eviction_queue: BTreeMap<(i64, i64), ()>,
    max_fixtures: usize,
}

impl Cache {
    pub fn new(max_fixtures: usize) -> Self {
        Self {
            fixtures: HashMap::new(),
            eviction_queue: BTreeMap::new(),
            max_fixtures,
        }
    }

    /// Apply an odds update and recalculate top odds
    pub fn apply_update(&mut self, update: OddsUpdate) -> Option<&FixtureData> {
        // Check if we need to evict (only if new fixture and at capacity)
        if !self.fixtures.contains_key(&update.fixture_id) && self.fixtures.len() >= self.max_fixtures {
            self.evict_oldest();
        }

        // Get or create fixture
        // If it exists, we need to remove from eviction queue first
        if let Some(fixture) = self.fixtures.get(&update.fixture_id) {
            self.eviction_queue.remove(&(fixture.last_update, fixture.fixture_id));
        }

        let fixture = self.fixtures
            .entry(update.fixture_id)
            .or_insert_with(|| FixtureData::new(update.fixture_id));

        // Get or create bookmaker odds
        let bookie_odds = fixture.bookmakers
            .entry(update.bookmaker.clone())
            .or_insert_with(BookmakerOdds::default);

        // Push current to history if it has data (newest first, max 20 snapshots)
        if bookie_odds.current.timestamp > 0 {
            bookie_odds.history.push_front(bookie_odds.current.clone());
            if bookie_odds.history.len() > 20 {
                bookie_odds.history.pop_back();
            }
        }

        // Apply base fields
        bookie_odds.bookie_id = update.bookie_id;
        bookie_odds.decimals = update.decimals;
        bookie_odds.current.timestamp = update.timestamp;

        // Apply odds (only update fields that are Some)
        if let Some(x12) = update.x12 {
            bookie_odds.current.x12_h = Some(x12[0]);
            bookie_odds.current.x12_x = Some(x12[1]);
            bookie_odds.current.x12_a = Some(x12[2]);
        }
        if let Some(ah_lines) = update.ah_lines {
            bookie_odds.current.ah_lines = ah_lines;
        }
        if let Some(ah_h) = update.ah_h {
            bookie_odds.current.ah_h = ah_h;
        }
        if let Some(ah_a) = update.ah_a {
            bookie_odds.current.ah_a = ah_a;
        }
        if let Some(ou_lines) = update.ou_lines {
            bookie_odds.current.ou_lines = ou_lines;
        }
        if let Some(ou_o) = update.ou_o {
            bookie_odds.current.ou_o = ou_o;
        }
        if let Some(ou_u) = update.ou_u {
            bookie_odds.current.ou_u = ou_u;
        }

        // Apply DB-format fields (ids, max_stakes, latest_t)
        if update.ids.is_some() {
            bookie_odds.current.ids = update.ids;
        }
        if update.max_stakes.is_some() {
            bookie_odds.current.max_stakes = update.max_stakes;
        }
        if update.latest_t.is_some() {
            bookie_odds.current.latest_t = update.latest_t;
        }

        // Update fixture timestamp
        fixture.last_update = update.timestamp;
        
        // Add back to eviction queue with new timestamp
        self.eviction_queue.insert((fixture.last_update, fixture.fixture_id), ());

        // Recalculate fair odds for this bookmaker
        // X12 - calculate fair odds if all three outcomes are present
        if let (Some(h), Some(x), Some(a)) = (bookie_odds.current.x12_h, bookie_odds.current.x12_x, bookie_odds.current.x12_a) {
            let x12_odds = [h, x, a];
            if let Some(fair) = calculate_fair_odds(&x12_odds, bookie_odds.decimals, 3) {
                bookie_odds.current.fair_x12_h = Some(fair[0]);
                bookie_odds.current.fair_x12_x = Some(fair[1]);
                bookie_odds.current.fair_x12_a = Some(fair[2]);
            }
        }

        // AH
        bookie_odds.current.fair_ah_h.clear();
        bookie_odds.current.fair_ah_a.clear();
        for i in 0..bookie_odds.current.ah_lines.len() {
             let h = *bookie_odds.current.ah_h.get(i).unwrap_or(&0);
             let a = *bookie_odds.current.ah_a.get(i).unwrap_or(&0);
             let odds = [h, a];

             if let Some(fair) = calculate_fair_odds(&odds, bookie_odds.decimals, 2) {
                 bookie_odds.current.fair_ah_h.push(fair[0]);
                 bookie_odds.current.fair_ah_a.push(fair[1]);
             } else {
                 bookie_odds.current.fair_ah_h.push(0);
                 bookie_odds.current.fair_ah_a.push(0);
             }
        }

        // OU
        bookie_odds.current.fair_ou_o.clear();
        bookie_odds.current.fair_ou_u.clear();
        for i in 0..bookie_odds.current.ou_lines.len() {
             let o = *bookie_odds.current.ou_o.get(i).unwrap_or(&0);
             let u = *bookie_odds.current.ou_u.get(i).unwrap_or(&0);
             let odds = [o, u];

             if let Some(fair) = calculate_fair_odds(&odds, bookie_odds.decimals, 2) {
                 bookie_odds.current.fair_ou_o.push(fair[0]);
                 bookie_odds.current.fair_ou_u.push(fair[1]);
             } else {
                 bookie_odds.current.fair_ou_o.push(0);
                 bookie_odds.current.fair_ou_u.push(0);
             }
        }


        self.fixtures.get(&update.fixture_id)
    }

    /// Remove oldest fixture by timestamp
    fn evict_oldest(&mut self) {
        // Get the first key (smallest timestamp)
        let oldest_key = self.eviction_queue.keys().next().cloned();
        
        if let Some((_, fixture_id)) = oldest_key {
            info!("🗑️ Evicting fixture {} (cache full)", fixture_id);
            self.fixtures.remove(&fixture_id);
            self.eviction_queue.remove(&oldest_key.unwrap());
        }
    }

    /// Get fixture count
    pub fn len(&self) -> usize {
        self.fixtures.len()
    }

}

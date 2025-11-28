// Fair odds calculation utilities

/// Maximum acceptable margin (12%) - odds with higher margin are unreliable
const MAX_MARGIN: f64 = 0.12;

/// Calculate fair odds using "Margin Weights Proportional to the Odds" method
/// Formula: Of = (n * O) / (n - M * O)
/// Where M is the bookmaker's margin: M = (Sum(1/O) - 1)
/// 
/// Returns None if:
/// - Wrong number of odds provided
/// - Any odds are zero or negative
/// - Margin exceeds 12% (unreliable odds)
pub fn calculate_fair_odds(odds: &[i32], decimals: i32, n: usize) -> Option<Vec<i32>> {
    if odds.len() != n {
        return None;
    }

    // Convert to decimals
    let decimal_odds: Vec<f64> = odds.iter()
        .map(|&o| o as f64 / 10f64.powi(decimals))
        .collect();

    // Check for zeros
    if decimal_odds.iter().any(|&o| o <= 0.0) {
        return None;
    }

    // Calculate margin
    let sum_inv: f64 = decimal_odds.iter().map(|&o| 1.0 / o).sum();
    let margin = sum_inv - 1.0;
    
    // Reject high margin odds (>12%) - unreliable for fair odds calculation
    if margin > MAX_MARGIN {
        return None;
    }
    let mut fair_odds = Vec::with_capacity(n);
    let n_f64 = n as f64;

    for &o in &decimal_odds {
        let denominator = n_f64 - margin * o;
        if denominator <= 0.0 {
            return None; // Invalid state
        }
        let fair = (n_f64 * o) / denominator;
        
        // Convert back to basis points
        let fair_basis = (fair * 10f64.powi(decimals)).round() as i32;
        fair_odds.push(fair_basis);
    }

    Some(fair_odds)
}

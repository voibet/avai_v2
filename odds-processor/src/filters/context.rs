use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use super::types::ResolvedValue;

pub trait HistoryProvider {
    /// Get the oldest historical snapshot for a bookmaker that is still within `max_age_ms`.
    /// Returns None if no snapshot exists within the time window.
    fn get_snapshot(&self, bookmaker: &str, max_age_ms: i64) -> Option<Value>;
}

/// Details about an operand in a computation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperandDetail {
    /// The field path with line info (e.g., "bookmakers.Veikkaus.ah_h[-0.5]")
    pub path: String,
    /// The resolved value at this path
    pub value: Value,
}

/// Captures details about a comparison that matched
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchTrace {
    /// The comparison operator used (gt, gte, lt, lte, eq, etc.)
    pub op: String,
    /// The threshold/comparison value
    pub threshold: Value,
    /// The computed result that was compared against threshold
    pub result: Value,
    /// Whether the comparison matched
    pub matched: bool,
    /// Details about the left operand of the calculation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_operand: Option<OperandDetail>,
    /// Details about the right operand of the calculation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_operand: Option<OperandDetail>,
    /// The arithmetic operation performed (divide, multiply, add, subtract)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calculation_op: Option<String>,
}

/// Detailed result from arithmetic evaluation with line matching info
#[derive(Debug, Clone)]
pub struct ArithmeticResult {
    /// Details for each computation
    pub details: Vec<ArithmeticDetail>,
}

/// Detail about a single arithmetic computation
#[derive(Debug, Clone)]
pub struct ArithmeticDetail {
    /// Left operand path with line
    pub left_path: String,
    /// Left operand value
    pub left_value: f64,
    /// Right operand path with line
    pub right_path: String,
    /// Right operand value
    pub right_value: f64,
    /// The computed result
    pub result: f64,
    /// The operation performed
    pub operation: String,
}

pub struct FilterContext<'a> {
    pub data: &'a Value,
    /// Variables store ResolvedValue to support per-line aggregations
    pub vars: HashMap<String, ResolvedValue>,
    /// Traces of all comparisons that matched during evaluation
    pub match_traces: Vec<MatchTrace>,
    /// Last arithmetic result with details (for capturing in evaluator)
    pub last_arithmetic_result: Option<ArithmeticResult>,
    /// Provider for historical data lookup
    pub history_provider: Option<&'a dyn HistoryProvider>,
}

impl<'a> FilterContext<'a> {
    pub fn new(data: &'a Value) -> Self {
        Self {
            data,
            vars: HashMap::new(),
            match_traces: Vec::new(),
            last_arithmetic_result: None,
            history_provider: None,
        }
    }

    pub fn with_history(data: &'a Value, provider: &'a dyn HistoryProvider) -> Self {
        Self {
            data,
            vars: HashMap::new(),
            match_traces: Vec::new(),
            last_arithmetic_result: None,
            history_provider: Some(provider),
        }
    }

    /// Record a simple match trace (no computation)
    pub fn record_simple_match(
        &mut self,
        field_path: String,
        field_value: Value,
        op: &str,
        threshold: Value,
    ) {
        self.match_traces.push(MatchTrace {
            op: op.to_string(),
            threshold,
            result: field_value.clone(),
            matched: true,
            left_operand: Some(OperandDetail {
                path: field_path,
                value: field_value,
            }),
            right_operand: None,
            calculation_op: None,
        });
    }

    /// Record match traces from arithmetic details
    pub fn record_arithmetic_matches(
        &mut self,
        details: &[ArithmeticDetail],
        matching_indices: &[usize],
        compare_op: &str,
        threshold: Value,
    ) {
        for &idx in matching_indices {
            if let Some(detail) = details.get(idx) {
                self.match_traces.push(MatchTrace {
                    op: compare_op.to_string(),
                    threshold: threshold.clone(),
                    result: serde_json::json!(detail.result),
                    matched: true,
                    left_operand: Some(OperandDetail {
                        path: detail.left_path.clone(),
                        value: serde_json::json!(detail.left_value),
                    }),
                    right_operand: Some(OperandDetail {
                        path: detail.right_path.clone(),
                        value: serde_json::json!(detail.right_value),
                    }),
                    calculation_op: Some(detail.operation.clone()),
                });
            }
        }
    }

    /// Get all match traces
    pub fn get_traces(&self) -> Vec<MatchTrace> {
        self.match_traces.clone()
    }
}

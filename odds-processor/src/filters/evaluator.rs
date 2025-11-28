use std::collections::{HashMap, HashSet};
use super::types::{FilterExpr, CompareExpr, CompareOp, VectorExpr, VectorSource, VectorOp, FieldPath, ResolvedValue};
use super::context::FilterContext;
use super::path::{resolve_value_or_computed, resolve_field, resolve_json_path};
use super::arithmetic::evaluate_arithmetic_with_ctx;

pub fn evaluate(expr: &FilterExpr, ctx: &mut FilterContext) -> bool {
    match expr {
        FilterExpr::And { and } => and.iter().all(|e| evaluate(e, ctx)),
        FilterExpr::Or { or } => or.iter().any(|e| evaluate(e, ctx)),
        FilterExpr::Not { not } => !evaluate(not, ctx),
        FilterExpr::PerLineAnd { per_line_and } => evaluate_per_line_and(per_line_and, ctx),
        FilterExpr::Compare(cmp) => evaluate_compare(cmp, ctx),
        FilterExpr::Vector(vec) => evaluate_vector(vec, ctx),
    }
}

/// Evaluates all conditions and returns true only if at least one LINE satisfies ALL conditions.
/// This is different from regular AND which returns true if ANY line satisfies each condition.
fn evaluate_per_line_and(conditions: &[FilterExpr], ctx: &mut FilterContext) -> bool {
    if conditions.is_empty() {
        return true;
    }
    
    // Track which lines matched for each condition
    let mut condition_line_matches: Vec<HashSet<String>> = Vec::new();
    
    for condition in conditions {
        let matches_before = ctx.match_traces.len();
        let passed = evaluate(condition, ctx);
        
        if !passed {
            return false; // Condition had no matches at all
        }
        
        // Collect lines that matched for this condition
        let mut lines_for_condition = HashSet::new();
        let mut has_line_matches = false;
        
        for match_trace in &ctx.match_traces[matches_before..] {
            if let Some(ref left_op) = match_trace.left_operand {
                if let Some(line) = extract_line_from_match_path(&left_op.path) {
                    // Use formatted string to avoid float comparison issues
                    lines_for_condition.insert(format!("{:.4}", line));
                    has_line_matches = true;
                }
            }
        }
        
        // Only add to line matching if this condition has line-specific matches
        // (scalar conditions like x12 match all lines implicitly)
        if has_line_matches {
            condition_line_matches.push(lines_for_condition);
        }
    }
    
    // If no conditions had line-based matches, all conditions passed (all scalar)
    if condition_line_matches.is_empty() {
        return true;
    }
    
    // Find intersection of all line matches
    let mut common_lines = condition_line_matches[0].clone();
    for lines in &condition_line_matches[1..] {
        common_lines = common_lines.intersection(lines).cloned().collect();
    }
    
    // Return true if at least one line matched all conditions
    !common_lines.is_empty()
}

/// Extract line value from a match path like "bookmakers.Veikkaus.ah_h[-0.5]" or "ah_h[-0.5]"
fn extract_line_from_match_path(path: &str) -> Option<f64> {
    let start = path.rfind('[')?;
    let end = path.rfind(']')?;
    if start >= end { return None; }
    path[start+1..end].parse().ok()
}

fn resolve_field_with_details(field: &FieldPath, ctx: &mut FilterContext) -> Option<ResolvedValue> {
    match field {
        FieldPath::Simple(s) => {
            if s.starts_with('$') {
                let var_name = &s[1..];
                ctx.vars.get(var_name).cloned()
            } else {
                resolve_json_path(ctx.data, s)
            }
        },
        FieldPath::Computed(comp) => evaluate_arithmetic_with_ctx(comp, ctx),
    }
}

fn evaluate_compare(cmp: &CompareExpr, ctx: &mut FilterContext) -> bool {
    let left = match resolve_field_with_details(&cmp.field, ctx) {
        Some(l) => l,
        None => return false,
    };
    
    let arithmetic_details = ctx.last_arithmetic_result.take();
    
    if cmp.op == CompareOp::Exists {
        for (i, val) in left.values.iter().enumerate() {
            ctx.record_simple_match(
                left.paths[i].clone(),
                serde_json::json!(val),
                "exists",
                serde_json::json!(null),
            );
        }
        return true;
    }

    let right = match &cmp.value {
        Some(v) => match resolve_value_or_computed(v, ctx) {
            Some(r) => r,
            None => return false,
        },
        None => return false,
    };
    
    let mut has_match = false;
    
    if cmp.op == CompareOp::In {
        for (i, l_val) in left.values.iter().enumerate() {
            if right.values.iter().any(|r| (l_val - r).abs() < 0.00001) {
                has_match = true;
                ctx.record_simple_match(
                    left.paths[i].clone(),
                    serde_json::json!(l_val),
                    "in",
                    serde_json::json!(right.values.clone()),
                );
            }
        }
        return has_match;
    }
    
    if right.values.len() == 1 {
        let r_val = right.values[0];
        for (i, l_val) in left.values.iter().enumerate() {
            if compare(*l_val, cmp.op, r_val) {
                has_match = true;
                record_match(ctx, &left, i, *l_val, r_val, &cmp.op, &arithmetic_details);
            }
        }
    } else if left.values.len() == right.values.len() {
        for (i, l_val) in left.values.iter().enumerate() {
            let r_val = right.values[i];
            if compare(*l_val, cmp.op, r_val) {
                has_match = true;
                ctx.record_simple_match(
                    left.paths[i].clone(),
                    serde_json::json!(l_val),
                    &format!("{}", cmp.op),
                    serde_json::json!(r_val),
                );
            }
        }
    }
    
    has_match
}

fn compare(l: f64, op: CompareOp, r: f64) -> bool {
    match op {
        CompareOp::Eq => (l - r).abs() < 0.00001,
        CompareOp::Neq => (l - r).abs() >= 0.00001,
        CompareOp::Gt => l > r,
        CompareOp::Gte => l >= r,
        CompareOp::Lt => l < r,
        CompareOp::Lte => l <= r,
        _ => false,
    }
}

fn record_match(
    ctx: &mut FilterContext,
    left: &ResolvedValue,
    idx: usize,
    l_val: f64,
    r_val: f64,
    op: &CompareOp,
    arithmetic_details: &Option<super::context::ArithmeticResult>,
) {
    let path = &left.paths[idx];
    
    if let Some(arith) = arithmetic_details {
        if let Some(detail) = arith.details.iter().find(|d| &d.left_path == path || d.result == l_val) {
            ctx.record_arithmetic_matches(&[detail.clone()], &[0], &format!("{}", op), serde_json::json!(r_val));
            return;
        }
    }
    
    ctx.record_simple_match(path.clone(), serde_json::json!(l_val), &format!("{}", op), serde_json::json!(r_val));
}

fn evaluate_vector(vec: &VectorExpr, ctx: &mut FilterContext) -> bool {
    let sources = match &vec.source {
        VectorSource::Single(path) => vec![path.clone()],
        VectorSource::List(list) => list.clone(),
    };

    // Check if this is a per-line operation
    match vec.function {
        VectorOp::AvgPerLine | VectorOp::MaxPerLine | VectorOp::MinPerLine | 
        VectorOp::SumPerLine | VectorOp::CountPerLine => {
            return evaluate_vector_per_line(vec.function, &sources, &vec.as_var, ctx);
        },
        _ => {}
    }

    // Standard aggregation (flattens all values)
    // Filter out invalid odds: must be > 1.00 (1000 in integer format)
    // Odds of 1.00 or less are impossible
    let values: Vec<f64> = sources.iter()
        .filter_map(|s| resolve_field(s, ctx))
        .flat_map(|r| r.values)
        .filter(|&v| v > 1000.0)  // Filter out odds <= 1.00
        .collect();

    // Fail fast: if no valid values, the filter doesn't match
    if values.is_empty() {
        return false;
    }

    let result = match vec.function {
        VectorOp::Avg => values.iter().sum::<f64>() / values.len() as f64,
        VectorOp::Max => values.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
        VectorOp::Min => values.iter().cloned().fold(f64::INFINITY, f64::min),
        VectorOp::Sum => values.iter().sum(),
        VectorOp::Count => values.len() as f64,
        _ => return true, // per-line ops handled above
    };

    if let Some(var_name) = &vec.as_var {
        ctx.vars.insert(var_name.clone(), ResolvedValue {
            values: vec![result],
            paths: vec![format!("${}", var_name)],
            source_path: format!("${}", var_name),
        });
    }

    true
}

/// Per-line aggregation: groups values by line and applies max/min per line
fn evaluate_vector_per_line(
    op: VectorOp,
    sources: &[FieldPath],
    as_var: &Option<String>,
    ctx: &mut FilterContext,
) -> bool {
    // Collect all resolved values with their paths
    let resolved: Vec<ResolvedValue> = sources.iter()
        .filter_map(|s| resolve_field(s, ctx))
        .collect();
    
    // Fail fast: need at least one source to work with
    if resolved.is_empty() {
        return false;
    }
    
    // Group by line: HashMap<line_value, Vec<(odds_value, path)>>
    // Only include valid odds (> 1.00 = 1000 in integer format)
    let mut by_line: HashMap<i64, Vec<(f64, String)>> = HashMap::new();
    
    for rv in &resolved {
        for (val, path) in rv.values.iter().zip(rv.paths.iter()) {
            // Skip invalid odds (must be > 1.00)
            if *val <= 1000.0 {
                continue;
            }
            if let Some(line) = extract_line_from_path(path) {
                // Use integer key (line * 1000) to avoid float hashing issues
                let line_key = (line * 1000.0).round() as i64;
                by_line.entry(line_key).or_default().push((*val, path.clone()));
            }
        }
    }
    
    // Only keep lines that appear in ALL sources (intersection)
    let source_count = resolved.len();
    let intersection: Vec<_> = by_line.into_iter()
        .filter(|(_, vals)| vals.len() >= source_count)
        .collect();
    
    // Fail fast: no common lines means filter doesn't match
    if intersection.is_empty() {
        return false;
    }
    
    // Sort by line for consistent ordering
    let mut sorted: Vec<_> = intersection.into_iter().collect();
    sorted.sort_by_key(|(line_key, _)| *line_key);
    
    // Apply aggregation per line
    let mut result_values = Vec::new();
    let mut result_paths = Vec::new();
    
    for (line_key, vals) in sorted {
        let line = line_key as f64 / 1000.0;
        let values: Vec<f64> = vals.iter().map(|(v, _)| *v).collect();
        
        let agg_value = match op {
            VectorOp::AvgPerLine => values.iter().sum::<f64>() / values.len() as f64,
            VectorOp::MaxPerLine => values.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
            VectorOp::MinPerLine => values.iter().cloned().fold(f64::INFINITY, f64::min),
            VectorOp::SumPerLine => values.iter().sum(),
            VectorOp::CountPerLine => values.len() as f64,
            _ => continue,
        };
        
        result_values.push(agg_value);
        // Create a generic path indicating this is a per-line aggregate
        let field_base = extract_field_base(&vals[0].1);
        result_paths.push(format!("{}[{}]", field_base, line));
    }
    
    if let Some(var_name) = as_var {
        ctx.vars.insert(var_name.clone(), ResolvedValue {
            values: result_values,
            paths: result_paths,
            source_path: format!("${}", var_name),
        });
    }
    
    true
}

/// Extract line value from path like "bookmakers.Monaco.ah_h[-0.5]"
fn extract_line_from_path(path: &str) -> Option<f64> {
    let start = path.rfind('[')?;
    let end = path.rfind(']')?;
    if start >= end { return None; }
    path[start+1..end].parse().ok()
}

/// Extract field base from path like "bookmakers.Monaco.ah_h[-0.5]" -> "ah_h"
fn extract_field_base(path: &str) -> String {
    // Find the last segment before the bracket
    let without_bracket = if let Some(idx) = path.rfind('[') {
        &path[..idx]
    } else {
        path
    };
    
    // Get the last dot-separated segment
    without_bracket.rsplit('.').next().unwrap_or(without_bracket).to_string()
}

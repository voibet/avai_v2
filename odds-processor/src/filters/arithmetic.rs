use super::types::{ComputedValue, ArithOp, ResolvedValue};
use super::context::{FilterContext, ArithmeticResult, ArithmeticDetail};
use super::path::{resolve_value_or_computed, extract_field_path, resolve_json_path};

// ============================================================================
// PUBLIC API
// ============================================================================

/// Evaluate arithmetic expression and store detailed results in context for tracing.
pub fn evaluate_arithmetic_with_ctx(comp: &ComputedValue, ctx: &mut FilterContext) -> Option<ResolvedValue> {
    let left_path = extract_field_path(&comp.left);
    let right_path = extract_field_path(&comp.right);
    
    // Check if both sides are field paths that need smart line matching
    if let (Some(l_path), Some(r_path)) = (&left_path, &right_path) {
        if should_use_line_matching(l_path, r_path) {
            let (result, details) = evaluate_with_line_matching(comp, ctx.data, l_path, r_path)?;
            ctx.last_arithmetic_result = Some(ArithmeticResult { details });
            return Some(result);
        }
    }
    
    ctx.last_arithmetic_result = None;
    evaluate_standard_arithmetic(comp, ctx)
}

/// Evaluate arithmetic expression without context mutation.
pub fn evaluate_arithmetic(comp: &ComputedValue, ctx: &FilterContext) -> Option<ResolvedValue> {
    let left_path = extract_field_path(&comp.left);
    let right_path = extract_field_path(&comp.right);
    
    if let (Some(l_path), Some(r_path)) = (&left_path, &right_path) {
        if should_use_line_matching(l_path, r_path) {
            let (result, _) = evaluate_with_line_matching(comp, ctx.data, l_path, r_path)?;
            return Some(result);
        }
    }
    
    evaluate_standard_arithmetic(comp, ctx)
}

// ============================================================================
// STANDARD ARITHMETIC
// ============================================================================

fn evaluate_standard_arithmetic(comp: &ComputedValue, ctx: &FilterContext) -> Option<ResolvedValue> {
    let left = resolve_value_or_computed(&comp.left, ctx)?;
    let right = resolve_value_or_computed(&comp.right, ctx)?;

    let mut result_values = Vec::new();
    let mut result_paths = Vec::new();

    // Check if either side has line-based paths
    let left_has_lines = left.paths.iter().any(|p| p.contains('['));
    let right_has_lines = right.paths.iter().any(|p| p.contains('['));
    
    // If BOTH sides have line-based paths, always match by line (even if one side has 1 value)
    if left_has_lines && right_has_lines {
        // Match by line value, not by index!
        for (l_idx, l_path) in left.paths.iter().enumerate() {
            let l_line = extract_line_from_path_str(l_path);
            
            // Find matching line in right side
            for (r_idx, r_path) in right.paths.iter().enumerate() {
                let r_line = extract_line_from_path_str(r_path);
                
                // Match if lines are equal (with float tolerance)
                if let (Some(l), Some(r)) = (l_line, r_line) {
                    if (l - r).abs() < 0.001 {
                        let l_val = left.values[l_idx];
                        let r_val = right.values[r_idx];
                        if let Some(res) = perform_op(comp.op, l_val, r_val) {
                            result_values.push(res);
                            result_paths.push(l_path.clone());
                        }
                        break; // Found match, move to next left value
                    }
                }
            }
        }
    } else {
        // Non-line-based arithmetic (scalars or index-based arrays)
        match (left.values.len(), right.values.len()) {
            (l, r) if l > 1 && r > 1 && l == r => {
                for i in 0..l {
                    if let Some(res) = perform_op(comp.op, left.values[i], right.values[i]) {
                        result_values.push(res);
                        result_paths.push(left.paths[i].clone());
                    }
                }
            },
            (l, 1) if l > 1 => {
                let r_val = right.values[0];
                for i in 0..l {
                    if let Some(res) = perform_op(comp.op, left.values[i], r_val) {
                        result_values.push(res);
                        result_paths.push(left.paths[i].clone());
                    }
                }
            },
            (1, r) if r > 1 => {
                let l_val = left.values[0];
                for i in 0..r {
                    if let Some(res) = perform_op(comp.op, l_val, right.values[i]) {
                        result_values.push(res);
                        result_paths.push(right.paths[i].clone());
                    }
                }
            },
            _ => {
                if let (Some(&l_val), Some(&r_val)) = (left.values.first(), right.values.first()) {
                    if let Some(res) = perform_op(comp.op, l_val, r_val) {
                        result_values.push(res);
                        result_paths.push(left.paths[0].clone());
                    }
                }
            }
        }
    }
    
    if result_values.is_empty() {
        None
    } else {
        Some(ResolvedValue {
            values: result_values,
            paths: result_paths,
            source_path: format!("({})", comp),
        })
    }
}

/// Extract line value from path like "ou_o[2.5]" or "$max_ou_o[2.5]"
fn extract_line_from_path_str(path: &str) -> Option<f64> {
    let start = path.rfind('[')?;
    let end = path.rfind(']')?;
    if start >= end { return None; }
    path[start+1..end].parse().ok()
}

// ============================================================================
// LINE MATCHING ARITHMETIC
// ============================================================================

fn should_use_line_matching(left: &str, right: &str) -> bool {
    is_matchable_field(left) && !left.contains('[') &&
    is_matchable_field(right) && !right.contains('[')
}

fn is_matchable_field(path: &str) -> bool {
    let suffixes = [
        ".ah_h", ".ah_a", ".ou_o", ".ou_u",
        ".fair_ah_h", ".fair_ah_a", ".fair_ou_o", ".fair_ou_u",
        ".x12_h", ".x12_x", ".x12_a",
        ".fair_x12_h", ".fair_x12_x", ".fair_x12_a",
        ".ah", ".ou", ".x12",
        ".fair_ah", ".fair_ou", ".fair_x12",
    ];
    suffixes.iter().any(|s| path.ends_with(s))
}

/// Evaluate with line matching - returns both result and details
fn evaluate_with_line_matching(
    comp: &ComputedValue, 
    data: &serde_json::Value,
    left_path: &str,
    right_path: &str
) -> Option<(ResolvedValue, Vec<ArithmeticDetail>)> {
    let left_expanded = expand_aggregate_path(left_path);
    let right_expanded = expand_aggregate_path(right_path);
    
    let op_str = op_to_string(comp.op);
    let mut all_results = Vec::new();
    let mut all_paths = Vec::new();
    let mut all_details = Vec::new();
    
    for (left_specific_path, left_side) in &left_expanded {
        let (right_specific_path, right_side) = find_matching_right_path(left_side, &right_expanded)?;
        
        // Get parent path (everything before the last segment)
        let left_parent = left_specific_path.rsplit_once('.').map(|(p, _)| p)?;
        let right_parent = right_specific_path.rsplit_once('.').map(|(p, _)| p)?;
        
        // X12 fields are scalars
        if left_side.contains("x12") {
            let left_val = resolve_json_path(data, left_specific_path)?.values.first().copied()?;
            let right_val = resolve_json_path(data, &right_specific_path)?.values.first().copied()?;
            
            if let Some(result) = perform_op(comp.op, left_val, right_val) {
                let left_full = format!("{}.{}", left_parent, left_side);
                let right_full = format!("{}.{}", right_parent, right_side);
                
                all_results.push(result);
                all_paths.push(left_full.clone());
                all_details.push(ArithmeticDetail {
                    left_path: left_full,
                    left_value: left_val,
                    right_path: right_full,
                    right_value: right_val,
                    result,
                    operation: op_str.to_string(),
                });
            }
            continue;
        }
        
        // AH/OU fields - line matching
        // Get raw arrays directly to keep indices aligned (don't use resolve_json_path which filters)
        let lines_key = if left_side.contains("ah") { "ah_lines" } else { "ou_lines" };
        
        let left_lines_arr = get_array_at_path(data, &format!("{}.{}", left_parent, lines_key))?;
        let right_lines_arr = get_array_at_path(data, &format!("{}.{}", right_parent, lines_key))?;
        let left_odds_arr = get_array_at_path(data, left_specific_path)?;
        let right_odds_arr = get_array_at_path(data, &right_specific_path)?;
        
        for (left_idx, left_line_val) in left_lines_arr.iter().enumerate() {
            let left_line = left_line_val.as_f64()?;
            
            // Skip lines that don't exist on the right side
            let right_idx = match right_lines_arr.iter().position(|r| {
                r.as_f64().map(|rv| (rv - left_line).abs() < 0.001).unwrap_or(false)
            }) {
                Some(idx) => idx,
                None => continue,
            };
            
            // Get odds at the same index as the line (arrays are aligned)
            let l_val = match left_odds_arr.get(left_idx).and_then(|v| v.as_f64()) {
                Some(v) if v > 1000.0 => v,  // Must be valid odds > 1.00
                _ => continue,
            };
            let r_val = match right_odds_arr.get(right_idx).and_then(|v| v.as_f64()) {
                Some(v) if v > 1000.0 => v,  // Must be valid odds > 1.00
                _ => continue,
            };
            
            if let Some(result) = perform_op(comp.op, l_val, r_val) {
                let left_path_with_line = format!("{}.{}[{}]", left_parent, left_side, left_line);
                let right_path_with_line = format!("{}.{}[{}]", right_parent, right_side, left_line);
                
                all_results.push(result);
                all_paths.push(left_path_with_line.clone());
                all_details.push(ArithmeticDetail {
                    left_path: left_path_with_line,
                    left_value: l_val,
                    right_path: right_path_with_line,
                    right_value: r_val,
                    result,
                    operation: op_str.to_string(),
                });
            }
        }
    }
    
    if all_results.is_empty() {
        None
    } else {
        Some((
            ResolvedValue {
                values: all_results,
                paths: all_paths,
                source_path: format!("({})", comp),
            },
            all_details
        ))
    }
}

// ============================================================================
// HELPERS
// ============================================================================

fn perform_op(op: ArithOp, l: f64, r: f64) -> Option<f64> {
    match op {
        ArithOp::Add => Some(l + r),
        ArithOp::Subtract => Some(l - r),
        ArithOp::Multiply => Some(l * r),
        ArithOp::Divide => if r != 0.0 { Some(l / r) } else { None },
    }
}

fn op_to_string(op: ArithOp) -> &'static str {
    match op {
        ArithOp::Add => "add",
        ArithOp::Subtract => "subtract",
        ArithOp::Multiply => "multiply",
        ArithOp::Divide => "divide",
    }
}

/// Get raw array at a dot-separated path (keeps indices aligned, no filtering)
fn get_array_at_path<'a>(data: &'a serde_json::Value, path: &str) -> Option<&'a Vec<serde_json::Value>> {
    let mut current = data;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    current.as_array()
}

fn expand_aggregate_path(path: &str) -> Vec<(String, String)> {
    let expansions: &[(&str, &[&str])] = &[
        (".ah", &["ah_h", "ah_a"]),
        (".fair_ah", &["fair_ah_h", "fair_ah_a"]),
        (".ou", &["ou_o", "ou_u"]),
        (".fair_ou", &["fair_ou_o", "fair_ou_u"]),
        (".x12", &["x12_h", "x12_x", "x12_a"]),
        (".fair_x12", &["fair_x12_h", "fair_x12_x", "fair_x12_a"]),
    ];
    
    for (suffix, fields) in expansions {
        if path.ends_with(suffix) {
            let parent = path.strip_suffix(suffix).unwrap();
            return fields.iter()
                .map(|f| (format!("{}.{}", parent, f), f.to_string()))
                .collect();
        }
    }
    
    let field = path.rsplit('.').next().unwrap_or(path);
    vec![(path.to_string(), field.to_string())]
}

/// Find matching right path - maps standard ↔ fair sides
fn find_matching_right_path(left_side: &str, right_expanded: &[(String, String)]) -> Option<(String, String)> {
    let corresponding = match left_side {
        "ah_h" => "fair_ah_h",
        "ah_a" => "fair_ah_a",
        "ou_o" => "fair_ou_o",
        "ou_u" => "fair_ou_u",
        "fair_ah_h" => "ah_h",
        "fair_ah_a" => "ah_a",
        "fair_ou_o" => "ou_o",
        "fair_ou_u" => "ou_u",
        "x12_h" => "fair_x12_h",
        "x12_x" => "fair_x12_x",
        "x12_a" => "fair_x12_a",
        "fair_x12_h" => "x12_h",
        "fair_x12_x" => "x12_x",
        "fair_x12_a" => "x12_a",
        _ => left_side,
    };
    
    // Try to find exact match, or same side if not aggregate
    right_expanded.iter()
        .find(|(_, s)| s == corresponding || s == left_side)
        .map(|(p, s)| (p.clone(), s.clone()))
}

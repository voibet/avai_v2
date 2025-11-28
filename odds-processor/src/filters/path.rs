use serde_json::Value;
use super::types::{FieldPath, ValueOrComputed, ResolvedValue};
use super::context::FilterContext;
use super::arithmetic::evaluate_arithmetic;

// ============================================================================
// PUBLIC API
// ============================================================================

pub fn resolve_field(path: &FieldPath, ctx: &FilterContext) -> Option<ResolvedValue> {
    match path {
        FieldPath::Simple(s) => {
            if s.starts_with('$') {
                let var_name = &s[1..];
                return ctx.vars.get(var_name).cloned();
            }
            resolve_json_path(ctx.data, s)
        },
        FieldPath::Computed(comp) => {
            evaluate_arithmetic(comp, ctx)
        }
    }
}

pub fn resolve_value_or_computed(v: &ValueOrComputed, ctx: &FilterContext) -> Option<ResolvedValue> {
    match v {
        ValueOrComputed::Literal(val) => {
            if let Some(n) = val.as_f64() {
                Some(ResolvedValue {
                    values: vec![n],
                    paths: vec!["literal".to_string()],
                    source_path: "literal".to_string(),
                })
            } else if let Some(arr) = val.as_array() {
                let values: Vec<f64> = arr.iter().filter_map(|v| v.as_f64()).collect();
                if values.is_empty() { return None; }
                Some(ResolvedValue {
                    values,
                    paths: vec!["literal".to_string(); arr.len()],
                    source_path: "literal".to_string(),
                })
            } else {
                None
            }
        },
        ValueOrComputed::Computed(comp) => evaluate_arithmetic(comp, ctx),
        ValueOrComputed::Field(path) => resolve_field(path, ctx),
    }
}

pub fn extract_field_path(v: &ValueOrComputed) -> Option<String> {
    match v {
        ValueOrComputed::Field(path) => {
            match path.as_ref() {
                FieldPath::Simple(s) => Some(s.clone()),
                _ => None,
            }
        },
        _ => None,
    }
}

// ============================================================================
// CORE PATH RESOLUTION
// ============================================================================

pub fn resolve_json_path(data: &Value, path: &str) -> Option<ResolvedValue> {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = data;
    let mut current_path = String::new();
    
    for (idx, part) in parts.iter().enumerate() {
        if idx > 0 {
            current_path.push('.');
        }
        
        // Handle bracket syntax: ou_o[2.5], ah_h[-0.5]
        if let Some(start_bracket) = part.find('[') {
            current = resolve_line_access(data, current, &parts, idx, part, start_bracket, &mut current_path)?;
        } else if let Some(field_value) = current.get(part) {
            current = field_value;
            current_path.push_str(part);
        } else {
            // Check if this is an aggregate request (.ou, .ah, .x12, etc.)
            return resolve_aggregate(current, part, &current_path, path);
        }
    }
    
    // Single scalar value
    if let Some(n) = current.as_f64() {
        return Some(ResolvedValue {
            values: vec![n],
            paths: vec![current_path.clone()],
            source_path: path.to_string(),
        });
    }
    
    // Array value (e.g., ah_h, ou_o) - needs line labels
    if let Some(arr) = current.as_array() {
        // Find parent to get lines array
        let last_part = parts.last()?;
        let mut parent = data;
        for i in 0..parts.len().saturating_sub(1) {
            parent = parent.get(parts[i])?;
        }
        
        // Determine which lines array to use
        let lines_key = if last_part.contains("ah") { "ah_lines" } else { "ou_lines" };
        let lines = parent.get(lines_key).and_then(|v| v.as_array());
        
        let mut values = Vec::new();
        let mut paths = Vec::new();
        
        for (i, v) in arr.iter().enumerate() {
            if let Some(val) = v.as_f64() {
                // Skip zero values for cleaner results
                if val == 0.0 { continue; }
                
                let line_label = lines
                    .and_then(|l| l.get(i))
                    .and_then(|l| l.as_f64())
                    .map(|l| format!("[{}]", l))
                    .unwrap_or_else(|| format!("[{}]", i));
                
                values.push(val);
                paths.push(format!("{}{}", current_path, line_label));
            }
        }
        
        if !values.is_empty() {
            return Some(ResolvedValue {
                values,
                paths,
                source_path: path.to_string(),
            });
        }
    }
    
    None
}

// ============================================================================
// LINE ACCESS (e.g., ou_o[2.5], ah_h[-0.5])
// ============================================================================

fn resolve_line_access<'a>(
    data: &'a Value,
    current: &'a Value,
    parts: &[&str],
    idx: usize,
    part: &str,
    start_bracket: usize,
    current_path: &mut String,
) -> Option<&'a Value> {
    let key = &part[0..start_bracket];
    let end_bracket = part.find(']')?;
    let line_str = &part[start_bracket+1..end_bracket];
    let line_value: f64 = line_str.parse().ok()?;
    
    current_path.push_str(key);
    let current = if !key.is_empty() { current.get(key)? } else { current };
    
    // Get parent to find lines array
    let mut parent = data;
    for i in 0..idx {
        parent = parent.get(parts[i])?;
    }
    
    // Find line index from lines array
    let lines_key = if key.contains("ah") { "ah_lines" } else { "ou_lines" };
    let lines = parent.get(lines_key)?.as_array()?;
    let line_idx = lines.iter().position(|l| {
        l.as_f64().map(|v| (v - line_value).abs() < 0.001).unwrap_or(false)
    })?;
    
    current_path.push_str(&format!("[{}]", line_value));
    current.get(line_idx)
}

// ============================================================================
// AGGREGATE RESOLUTION (.ou, .ah, .x12, .fair_ou, .fair_ah, .fair_x12)
// ============================================================================

fn resolve_aggregate(
    current: &Value,
    part: &str,
    current_path: &str,
    source_path: &str,
) -> Option<ResolvedValue> {
    let prefix = if current_path.is_empty() { 
        String::new() 
    } else { 
        format!("{}.", current_path) 
    };
    
    let (values, paths) = match part {
        "ou" => {
            let lines = current.get("ou_lines")?.as_array()?;
            let mut v = expand_line_array(current, "ou_o", lines, &prefix);
            let u = expand_line_array(current, "ou_u", lines, &prefix);
            v.0.extend(u.0);
            v.1.extend(u.1);
            v
        },
        "ah" => {
            let lines = current.get("ah_lines")?.as_array()?;
            let mut h = expand_line_array(current, "ah_h", lines, &prefix);
            let a = expand_line_array(current, "ah_a", lines, &prefix);
            h.0.extend(a.0);
            h.1.extend(a.1);
            h
        },
        "x12" => {
            expand_x12(current, &prefix, false)
        },
        "fair_ou" => {
            let lines = current.get("ou_lines")?.as_array()?;
            let mut o = expand_line_array(current, "fair_ou_o", lines, &prefix);
            let u = expand_line_array(current, "fair_ou_u", lines, &prefix);
            o.0.extend(u.0);
            o.1.extend(u.1);
            o
        },
        "fair_ah" => {
            let lines = current.get("ah_lines")?.as_array()?;
            let mut h = expand_line_array(current, "fair_ah_h", lines, &prefix);
            let a = expand_line_array(current, "fair_ah_a", lines, &prefix);
            h.0.extend(a.0);
            h.1.extend(a.1);
            h
        },
        "fair_x12" => {
            expand_x12(current, &prefix, true)
        },
        _ => return None,
    };
    
    if values.is_empty() {
        None
    } else {
        Some(ResolvedValue { values, paths, source_path: source_path.to_string() })
    }
}

/// Expand a line-based array (ah_h, ou_o, etc.) with proper line labels
fn expand_line_array(
    current: &Value,
    field: &str,
    lines: &[Value],
    prefix: &str,
) -> (Vec<f64>, Vec<String>) {
    let mut values = Vec::new();
    let mut paths = Vec::new();
    
    if let Some(arr) = current.get(field).and_then(|v| v.as_array()) {
        for (i, v) in arr.iter().enumerate() {
            // Only include if we have both a value and a valid line
            if let (Some(val), Some(line)) = (v.as_f64(), lines.get(i).and_then(|l| l.as_f64())) {
                values.push(val);
                paths.push(format!("{}{}[{}]", prefix, field, line));
            }
        }
    }
    
    (values, paths)
}

/// Expand x12 fields (no lines, just outcomes)
fn expand_x12(current: &Value, prefix: &str, fair: bool) -> (Vec<f64>, Vec<String>) {
    let mut values = Vec::new();
    let mut paths = Vec::new();
    
    let fields = if fair {
        ["fair_x12_h", "fair_x12_x", "fair_x12_a"]
    } else {
        ["x12_h", "x12_x", "x12_a"]
    };
    
    for field in fields {
        if let Some(v) = current.get(field).and_then(|v| v.as_f64()) {
            values.push(v);
            paths.push(format!("{}{}", prefix, field));
        }
    }
    
    (values, paths)
}

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FilterExpr {
    And { and: Vec<FilterExpr> },
    Or { or: Vec<FilterExpr> },
    Not { not: Box<FilterExpr> },
    /// Per-line AND: all conditions must match for the SAME line
    PerLineAnd { per_line_and: Vec<FilterExpr> },
    Compare(CompareExpr),
    Vector(VectorExpr),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareExpr {
    pub field: FieldPath,
    pub op: CompareOp,
    pub value: Option<ValueOrComputed>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CompareOp {
    Eq, Neq, Gt, Gte, Lt, Lte, In, Exists
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FieldPath {
    Simple(String),
    Computed(Box<ComputedValue>),
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ValueOrComputed {
    Computed(Box<ComputedValue>),
    Field(Box<FieldPath>),
    Literal(Value),
}

// Custom deserializer for ValueOrComputed
impl<'de> Deserialize<'de> for ValueOrComputed {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        
        // Try to deserialize as ComputedValue first (has "op" field)
        if value.is_object() && value.get("op").is_some() {
            return serde_json::from_value::<ComputedValue>(value.clone())
                .map(|c| ValueOrComputed::Computed(Box::new(c)))
                .map_err(serde::de::Error::custom);
        }
        
        // If it's a string, it could be a field path or a literal
        if let Some(s) = value.as_str() {
            // If it contains field path indicators, treat as field
            if s.contains('.') || s.contains('[') || s.starts_with('$') {
                return Ok(ValueOrComputed::Field(Box::new(FieldPath::Simple(s.to_string()))));
            }
        }
        
        // Otherwise, treat as literal
        Ok(ValueOrComputed::Literal(value))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputedValue {
    pub op: ArithOp,
    pub left: ValueOrComputed,
    pub right: ValueOrComputed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArithOp {
    Divide, Multiply, Add, Subtract, History
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorExpr {
    pub function: VectorOp,
    pub source: VectorSource,
    pub filter: Option<Box<FilterExpr>>,
    #[serde(rename = "as")]
    pub as_var: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VectorSource {
    Single(FieldPath),
    List(Vec<FieldPath>),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VectorOp {
    Avg, Max, Min, Sum, Count,
    /// Per-line operations (for AH/OU markets)
    AvgPerLine,
    MaxPerLine,
    MinPerLine,
    SumPerLine,
    CountPerLine,
}

// Display implementations for trace formatting
impl std::fmt::Display for FieldPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FieldPath::Simple(s) => write!(f, "{}", s),
            FieldPath::Computed(c) => write!(f, "{}", c),
        }
    }
}

impl std::fmt::Display for ComputedValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let op_str = match self.op {
            ArithOp::Divide => "/",
            ArithOp::Multiply => "*",
            ArithOp::Add => "+",
            ArithOp::Subtract => "-",
            ArithOp::History => "@",
        };
        write!(f, "({} {} {})", self.left, op_str, self.right)
    }
}

impl std::fmt::Display for ValueOrComputed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ValueOrComputed::Computed(c) => write!(f, "{}", c),
            ValueOrComputed::Field(p) => write!(f, "{}", p),
            ValueOrComputed::Literal(v) => write!(f, "{}", v),
        }
    }
}

impl std::fmt::Display for CompareOp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            CompareOp::Eq => "eq",
            CompareOp::Neq => "neq",
            CompareOp::Gt => "gt",
            CompareOp::Gte => "gte",
            CompareOp::Lt => "lt",
            CompareOp::Lte => "lte",
            CompareOp::In => "in",
            CompareOp::Exists => "exists",
        };
        write!(f, "{}", s)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedValue {
    pub values: Vec<f64>,
    pub paths: Vec<String>,
    pub source_path: String,
}
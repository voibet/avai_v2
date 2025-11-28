# Odds Processor

A real-time Rust service that processes odds updates, evaluates client filters, and broadcasts matching data via WebSockets.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   PostgreSQL    │────▶│                  │────▶│  WebSocket      │
│   (DB notify)   │     │  odds-processor  │     │  Clients        │
└─────────────────┘     │                  │     └─────────────────┘
                        │   ┌──────────┐   │
┌─────────────────┐     │   │  Cache   │   │
│   odds-engine   │────▶│   │(fixtures)│   │
│   (TCP)         │     │   └──────────┘   │
└─────────────────┘     └──────────────────┘
```

**Data Sources:**
- **TCP**: Real-time odds from `odds-engine` (Monaco, Pinnacle)
- **PostgreSQL NOTIFY**: Other bookmakers from database

**Output:**
- WebSocket messages with odds updates
- Optional: Filter match traces explaining what matched and why

---

## WebSocket Protocol

### Connect
```
ws://localhost:8081/ws
```

### Messages

**Subscribe** (with optional filter):
```json
{ "type": "subscribe", "filter": { ... } }
```

**Update Filter**:
```json
{ "type": "update_filter", "filter": { ... } }
```

**Remove Filter** (receive all updates):
```json
{ "type": "remove_filter" }
```

### Response Format

When a filter matches, the response includes `filter_matches` explaining what matched:

```json
{
  "msg_type": "odds_update",
  "fixture_id": 12345,
  "bookmakers": { ... },
  "filter_matches": [
    {
      "op": "gt",
      "threshold": 1.03,
      "result": 1.0412,
      "left_operand": {
        "path": "bookmakers.Monaco.ah_h[-0.5]",
        "value": 1920
      },
      "right_operand": {
        "path": "bookmakers.Pinnacle.fair_ah_h[-0.5]",
        "value": 1844
      },
      "calculation_op": "divide"
    }
  ]
}
```

---

## Filter Expression Language

Filters are JSON objects that define what updates you want to receive.

### Expression Types

**Compare Expression** - Compare a field to a value:
```json
{
  "field": "bookmakers.Monaco.x12_h",
  "op": "gt",
  "value": 2000
}
```

**Logic Expressions** - Combine expressions:
```json
{ "and": [ expr1, expr2, ... ] }
{ "or": [ expr1, expr2, ... ] }
{ "not": expr }
{ "per_line_and": [ expr1, expr2, ... ] }
```

> **`per_line_and`**: Unlike regular `and` which passes if ANY line matches each condition, `per_line_and` requires the SAME line to satisfy ALL conditions. Essential for combining value + payout checks on the same line.

**Vector Expression** - Aggregate values and store in variable:
```json
{
  "function": "max",
  "source": ["bookmakers.Pinnacle.x12_h", "bookmakers.Monaco.x12_h"],
  "as": "best_home_odds"
}
```

### Comparison Operators

| Operator | Description |
|----------|-------------|
| `eq` | Equals |
| `neq` | Not equals |
| `gt` | Greater than |
| `gte` | Greater than or equal |
| `lt` | Less than |
| `lte` | Less than or equal |
| `in` | Value exists in array |
| `exists` | Field exists |

### Arithmetic Operators

Used in computed fields: `divide`, `multiply`, `add`, `subtract`

### Vector Functions

`avg`, `max`, `min`, `sum`, `count`

---

## Field Paths

All paths use **lines** (for AH/OU markets) or **outcomes** (for x12), never array indices.

### Markets

| Market | Sides | Lines |
|--------|-------|-------|
| **1X2** | `x12_h`, `x12_x`, `x12_a` | No lines |
| **Asian Handicap** | `ah_h`, `ah_a` | Yes (`ah_lines`) |
| **Over/Under** | `ou_o`, `ou_u` | Yes (`ou_lines`) |

Fair odds use `fair_` prefix: `fair_x12_h`, `fair_ah_h`, `fair_ou_o`, etc.

### Path Levels

**Level 1: Specific Line** (single value)
```
bookmakers.Monaco.ou_o[2.5]     → Over odds for 2.5 line
bookmakers.Monaco.ah_h[-0.5]   → Home handicap for -0.5 line
```

**Level 2: Specific Side** (array of values)
```
bookmakers.Monaco.ou_o         → All Over odds (all lines)
bookmakers.Monaco.ah_h         → All Home handicap odds
bookmakers.Monaco.x12_h        → Home 1X2 odds (single value)
```

**Level 3: Market Type** (combines both sides)
```
bookmakers.Monaco.ou           → ou_o + ou_u (all O/U odds)
bookmakers.Monaco.ah           → ah_h + ah_a (all AH odds)  
bookmakers.Monaco.x12          → x12_h + x12_x + x12_a
```

**Fair Odds** (Pinnacle):
```
bookmakers.Pinnacle.fair_ou    → fair_ou_o + fair_ou_u
bookmakers.Pinnacle.fair_ah    → fair_ah_h + fair_ah_a
bookmakers.Pinnacle.fair_x12   → fair_x12_h + fair_x12_x + fair_x12_a
```

---

## Smart Line Matching

When comparing arrays between bookmakers, the system automatically matches lines.

**Example**: Find value bets where Monaco is >3% better than Pinnacle fair odds:

```json
{
  "field": {
    "op": "divide",
    "left": "bookmakers.Monaco.ah_h",
    "right": "bookmakers.Pinnacle.fair_ah_h"
  },
  "op": "gt",
  "value": 1.03
}
```

**How it works:**
1. Gets `ah_lines` from both Monaco and Pinnacle
2. Finds matching lines (e.g., both have -0.5, 0, +0.5)
3. Divides odds only for matching lines
4. Returns `true` if ANY line satisfies the condition
5. Records which specific line(s) matched in `filter_matches`

**Side matching**: When comparing aggregates, sides are matched automatically:
- `ah_h` ↔ `fair_ah_h`
- `ah_a` ↔ `fair_ah_a`
- `ou_o` ↔ `fair_ou_o`
- `ou_u` ↔ `fair_ou_u`

---

## Examples

### 1. Simple Comparison
Check if Monaco home odds are above 2.0 (2000 in integer format):
```json
{
  "field": "bookmakers.Monaco.x12_h",
  "op": "gt",
  "value": 2000
}
```

### 2. Value Bet Detection
Find any Asian Handicap line where Monaco is >3% better than fair odds:
```json
{
  "field": {
    "op": "divide",
    "left": "bookmakers.Monaco.ah_h",
    "right": "bookmakers.Pinnacle.fair_ah_h"
  },
  "op": "gt",
  "value": 1.03
}
```

### 3. Specific Line Check
Check a specific Over 2.5 line:
```json
{
  "field": {
    "op": "divide",
    "left": "bookmakers.Monaco.ou_o[2.5]",
    "right": "bookmakers.Pinnacle.fair_ou_o[2.5]"
  },
  "op": "gt",
  "value": 1.02
}
```

### 4. Multiple Conditions (AND)
Both 2.5 AND 3.0 Over lines must be value bets:
```json
{
  "and": [
    {
      "field": {
        "op": "divide",
        "left": "bookmakers.Monaco.ou_o[2.5]",
        "right": "bookmakers.Pinnacle.fair_ou_o[2.5]"
      },
      "op": "gt",
      "value": 1.02
    },
    {
      "field": {
        "op": "divide",
        "left": "bookmakers.Monaco.ou_o[3.0]",
        "right": "bookmakers.Pinnacle.fair_ou_o[3.0]"
      },
      "op": "gt",
      "value": 1.02
    }
  ]
}
```

### 5. Check Field Exists
Only receive updates where Monaco has Asian Handicap odds:
```json
{
  "field": "bookmakers.Monaco.ah_h",
  "op": "exists"
}
```

### 6. Vector Aggregation
Calculate best home odds across bookmakers, then compare:
```json
{
  "and": [
    {
      "function": "max",
      "source": ["bookmakers.Pinnacle.x12_h", "bookmakers.Monaco.x12_h"],
      "as": "best_home"
    },
    {
      "field": "$best_home",
      "op": "gt",
      "value": 2500
    }
  ]
}
```

---

## Arbitrage Detection

### X12 Arbitrage
Detect arbitrage opportunities across bookmakers for 1X2 markets:

```json
{
  "and": [
    {
      "function": "max",
      "source": ["bookmakers.Monaco.x12_h", "bookmakers.Pinnacle.x12_h", "bookmakers.Veikkaus.x12_h"],
      "as": "max_h"
    },
    {
      "function": "max",
      "source": ["bookmakers.Monaco.x12_x", "bookmakers.Pinnacle.x12_x", "bookmakers.Veikkaus.x12_x"],
      "as": "max_x"
    },
    {
      "function": "max",
      "source": ["bookmakers.Monaco.x12_a", "bookmakers.Pinnacle.x12_a", "bookmakers.Veikkaus.x12_a"],
      "as": "max_a"
    },
    {
      "field": {
        "op": "add",
        "left": {
          "op": "add",
          "left": { "op": "divide", "left": 1000000, "right": "$max_h" },
          "right": { "op": "divide", "left": 1000000, "right": "$max_x" }
        },
        "right": { "op": "divide", "left": 1000000, "right": "$max_a" }
      },
      "op": "lt",
      "value": 1000
    }
  ]
}
```

**How it works:**
- Gets max odds for each outcome (H/X/A) across all bookmakers
- Calculates margin: `(1M/h) + (1M/x) + (1M/a)`
- If margin < 1000 (i.e., < 100%), arbitrage exists

### AH/OU Arbitrage with Per-Line Aggregation

For Asian Handicap and Over/Under, use `max_per_line` to get the best odds **per line** across bookmakers:

```json
{
  "and": [
    {
      "function": "max_per_line",
      "source": ["bookmakers.Monaco.ah_h", "bookmakers.Pinnacle.ah_h", "bookmakers.Veikkaus.ah_h"],
      "as": "max_ah_h"
    },
    {
      "function": "max_per_line",
      "source": ["bookmakers.Monaco.ah_a", "bookmakers.Pinnacle.ah_a", "bookmakers.Veikkaus.ah_a"],
      "as": "max_ah_a"
    },
    {
      "field": {
        "op": "add",
        "left": { "op": "divide", "left": 1000000, "right": "$max_ah_h" },
        "right": { "op": "divide", "left": 1000000, "right": "$max_ah_a" }
      },
      "op": "lt",
      "value": 1000
    }
  ]
}
```

**How `max_per_line` works:**
1. Resolves each source to its values with line labels
2. Groups values by line (e.g., all -0.5 lines together)
3. Only keeps lines that exist in ALL sources (intersection)
4. Applies `max` (or `min`) per line group
5. Returns an array of results, one per line

The arithmetic then operates element-wise on matching lines, and returns `true` if ANY line has arbitrage.

### Per-Line Vector Functions

For AH/OU markets, per-line functions aggregate values **per line** across sources:

| Function | Description |
|----------|-------------|
| `avg_per_line` | Average value per line across sources (for custom fair odds) |
| `max_per_line` | Maximum value per line across sources (for arbitrage) |
| `min_per_line` | Minimum value per line across sources |
| `sum_per_line` | Sum of values per line across sources |
| `count_per_line` | Count of values per line across sources |

**Example: Custom Fair Odds**

Average Pinnacle and Betfair fair odds to create custom fair reference:

```json
{
  "and": [
    {
      "function": "avg_per_line",
      "source": ["bookmakers.Pinnacle.fair_ah_h", "bookmakers.Betfair.fair_ah_h"],
      "as": "custom_fair_ah_h"
    },
    {
      "field": {
        "op": "divide",
        "left": "bookmakers.Veikkaus.ah_h",
        "right": "$custom_fair_ah_h"
      },
      "op": "gt",
      "value": 1.03
    }
  ]
}
```

---

## Per-Line Conditions

### The Problem with Regular AND

Regular `and` checks if ANY line satisfies each condition. This can cause false positives:

```json
{
  "and": [
    { "field": "value_ratio", "op": "gt", "value": 1.01 },   // Line -0.5 matches
    { "field": "margin", "op": "lt", "value": 1010 }         // Line +0.5 matches
  ]
}
```

This matches because SOME line has value > 1% AND SOME line has payout > 99%, but they could be **different lines**!

### Solution: per_line_and

`per_line_and` requires the **SAME line** to satisfy ALL conditions:

```json
{
  "per_line_and": [
    {
      "field": {
        "op": "divide",
        "left": "bookmakers.Veikkaus.ah",
        "right": "bookmakers.Pinnacle.fair_ah"
      },
      "op": "gt",
      "value": 1.01
    },
    {
      "field": "bookmakers.Veikkaus.ah",
      "op": "lt",
      "value": 5000
    }
  ]
}
```

**How it works:**
1. Evaluates each condition and records which lines matched
2. Finds the **intersection** of matching lines
3. Returns `true` only if at least one line satisfies ALL conditions

### Combining per_line_and with max_per_line

Find AH lines where you have value > 1% AND payout > 99%:

```json
{
  "and": [
    {
      "function": "max_per_line",
      "source": ["bookmakers.Veikkaus.ah_h", "bookmakers.Pinnacle.ah_h"],
      "as": "max_ah_h"
    },
    {
      "function": "max_per_line",
      "source": ["bookmakers.Veikkaus.ah_a", "bookmakers.Pinnacle.ah_a"],
      "as": "max_ah_a"
    },
    {
      "per_line_and": [
        {
          "field": {
            "op": "divide",
            "left": "bookmakers.Veikkaus.ah",
            "right": "bookmakers.Pinnacle.fair_ah"
          },
          "op": "gt",
          "value": 1.01
        },
        {
          "field": {
            "op": "add",
            "left": { "op": "divide", "left": 1000000, "right": "$max_ah_h" },
            "right": { "op": "divide", "left": 1000000, "right": "$max_ah_a" }
          },
          "op": "lt",
          "value": 1010
        }
      ]
    }
  ]
}
```

This finds lines where:
1. Veikkaus AH odds are > 1% above fair odds
2. Best available payout across bookies is > 99%
3. **Both conditions on the SAME line**

---

## Error Handling

The filter system follows a **"fail fast"** principle:

- **Missing data**: If a path doesn't resolve (e.g., bookmaker missing, line doesn't exist), the filter returns `false` - no match
- **Invalid query**: Malformed paths return no results rather than wrong results
- **No fallbacks**: The system never guesses or falls back to indices

This ensures clients can trust that if they receive data, it's correct.

---

## Odds Format

All odds values are integers with 3 decimal places implied:
- `2000` = 2.000 decimal odds
- `1850` = 1.850 decimal odds
- `3500` = 3.500 decimal odds

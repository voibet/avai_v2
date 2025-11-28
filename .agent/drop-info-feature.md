# Drop Information Feature

## Summary
Added drop information display to the trading page that parses and shows:
1. **Drop Time** - The exact timestamp when the odds drop occurred
2. **Dropped Odds** - The current odds value (e.g., x12_a)
3. **Historical Odds** - The previous odds before the drop (calculated using drop amount)
4. **Market** - The specific market that dropped (e.g., x12_a, x12_h, etc.)
5. **Drop Amount** - The multiplier showing the drop magnitude

## Changes Made

### 1. Types (types/index.ts)
- Added `DropInfo` interface to represent parsed drop information

### 2. Utils (utils/index.ts)
- Added `parseDropInfo()` function that:
  - Parses paths like `bookmakers.Pinnacle.x12_a@300000ms(t:1764359568474)`
  - Extracts timestamp, market, and calculates historical odds
  - Returns null if no drop info is found
- Added `formatTimestamp()` to format Unix timestamps to readable format

### 3. UI (ui/FixtureDetails.tsx)
- Added "Drop Information" section that displays when drop data is available
- Shows:
  - Drop Time: Formatted timestamp (e.g., "28.01 14:32:48")
  - Market: The odds market that dropped (e.g., "x12_a")
  - Dropped Odds: Current odds value
  - Historical Odds: Previous odds (current * drop_amount)
  - Drop Amount: The multiplier (e.g., ×1.0043)

## How It Works

When a filter match contains drop information in the format:
```
bookmakers.Pinnacle.x12_a@300000ms(t:1764359568474)
```

The system:
1. Parses the timestamp (1764359568474)
2. Extracts the market (x12_a)
3. Gets the current odds from the match value
4. Calculates historical odds: `current_odds * drop_amount`
   - Example: 2.00 * 1.0043 = 2.0086

The information appears in a highlighted section in the Fixture Details panel on the right side of the trading page.

## Visual Example

```
📉 DROP INFORMATION
Drop Time:     28.01 14:32:48
Market:        x12_a
Dropped Odds:  2.000
Historical Odds: 2.009
Drop Amount:   ×1.0043
```

# Rust Odds Engine

High-performance, low-latency odds ingestion and fair odds calculation engine.

## Prerequisites

- Rust (latest stable): https://rustup.rs/
- PostgreSQL

## Setup

1. Ensure your `.env` file in the root directory has the necessary variables:
   - `PORT`
   - `DATABASE_URL`
   - `RAPID_API_KEY`
   - `PINNACLE_ODDS`
   - `MONACO_ODDS`
   - `MONACO_BASE_URL`
   - `MONACO_STREAM_URL`
   - `MONACO_APP_ID`
   - `MONACO_API_KEY`

2. Navigate to this directory:
   ```bash
   cd odds-engine
   ```

3. Run the engine:
   ```bash
   cargo run --release
   ```

4. Build after changes:
   ```bash
   cargo build
   ```

## Architecture

- **Ingestion**: Connects to Bookmaker APIs/WebSockets (Monaco, Pinnacle).
- **Persistence**: Asynchronously writes updates to PostgreSQL for history.

Subscribe to receive real-time JSON updates:

```json
{
  "fixture_id": 12345,
  "market_type": "x12",
  "bookie_odds": [2.5, 3.2, 2.9],
  "fair_odds": [2.6, 3.3, 3.0],
  "timestamp": 1715000000
}
```

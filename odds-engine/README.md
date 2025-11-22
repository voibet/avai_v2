# Rust Odds Engine

High-performance, low-latency odds ingestion and fair odds calculation engine.

## Prerequisites

- Rust (latest stable): https://rustup.rs/
- PostgreSQL

## Setup

1. Ensure your `.env` file in the root directory has the necessary variables:
   - `DATABASE_URL`
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

## Architecture

- **Ingestion**: Connects to Bookmaker APIs/WebSockets (Monaco, Pinnacle).
- **Calculation**: Calculates fair odds in real-time using "Margin Proportional to Odds" method.
- **Streaming**: Exposes a WebSocket endpoint at `ws://localhost:8080/ws` for the frontend to consume.
- **Persistence**: Asynchronously writes updates to PostgreSQL for history.

## API

### WebSocket `ws://localhost:8080/ws`

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

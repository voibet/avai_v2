# AVAI Football API Documentation

## Overview
This document provides comprehensive documentation for all API endpoints and Stream APIs in the AVAI Football application. The API is built with Next.js 13+ using the App Router and provides access to football data, odds, fixtures, and administrative functions.

## Base URL
All endpoints are relative to the application root. In development, this is typically `http://localhost:3005`.

## Authentication
Most endpoints do not require authentication. Admin endpoints may require proper authentication in production environments.

## Response Format
All responses return JSON unless otherwise specified. Error responses include an appropriate HTTP status code and error message.

---

## Public API Endpoints

### Bookies
**GET** `/api/bookies`

Returns a list of available bookmakers from the odds data.

**Response:**
```json
{
  "bookies": ["Pinnacle", "Betfair", "Sx.Bet", ...]
}
```

### Fixtures

#### List Fixtures
**GET** `/api/fixtures`

Returns a paginated list of football fixtures with optional filtering and search.

**Query Parameters:**
- `page` (number): Page number for pagination (default: 1)
- `limit` (number): Number of items per page (default: server-defined)
- `sort` (string): Sort field and direction, e.g., "date:desc"
- `date` (string): Date filter options:
  - `"yesterday"`: Fixtures from yesterday
  - `"today"`: Today's fixtures
  - `"tomorrow"`: Tomorrow's fixtures
  - `"last{N}"`: Last N days (e.g., "last14", "last30")
  - `"next{N}"`: Next N days (e.g., "next14", "next30")
- `league_id` (number): Filter by league ID
- `league_name` (string): Filter by league name
- `home_team_name` (string): Filter by home team name
- `away_team_name` (string): Filter by away team name
- `status_short` (string): Filter by match status (e.g., "NS", "FT")
- `season` (string): Filter by season
- `search` (string): Search across team names and league names (supports team mappings)

**Response:**
```json
{
  "data": [
    {
      "id": 123,
      "date": "2024-01-15T15:00:00.000Z",
      "home_team_name": "Manchester United",
      "away_team_name": "Liverpool",
      "league_name": "Premier League",
      "status_short": "NS",
      "goals_home": null,
      "goals_away": null,
      "xg_home": 1.5,
      "xg_away": 2.1,
      "home_pred": 0.4,
      "away_pred": 0.6
    }
  ],
  "total": 1250,
  "page": 1,
  "limit": 50,
  "totalPages": 25,
  "hasNextPage": true,
  "hasPrevPage": false
}
```

#### Get Single Fixture
**GET** `/api/fixtures/{id}`

Returns detailed information for a specific fixture.

**Path Parameters:**
- `id` (number): Fixture ID

**Response:**
```json
{
  "fixture": {
    "id": 123,
    "home_team_name": "Manchester United",
    "away_team_name": "Liverpool",
    // ... all fixture fields
  }
}
```

#### Update Fixture (Admin)
**PUT** `/api/fixtures/{id}`

Updates fixture information.

**Path Parameters:**
- `id` (number): Fixture ID

**Body Parameters:**
- `referee`, `timestamp`, `date`, `venue_name`, `status_long`, `status_short`
- `home_team_id`, `home_team_name`, `home_country`
- `away_team_id`, `away_team_name`, `away_country`
- `xg_home`, `xg_away`, `goals_home`, `goals_away`
- `score_halftime_home`, `score_halftime_away`
- `score_fulltime_home`, `score_fulltime_away`
- `score_extratime_home`, `score_extratime_away`
- `score_penalty_home`, `score_penalty_away`
- `league_id`, `league_name`, `league_country`
- `season`, `round`
- `home_team_mappings`, `away_team_mappings`: JSON arrays of team name mappings

#### Delete Fixture (Admin)
**DELETE** `/api/fixtures/{id}`

Deletes a fixture and all related data.

**Path Parameters:**
- `id` (number): Fixture ID

### Fixture Sub-Endpoints

#### Fixture Adjustments
**GET** `/api/fixtures/{id}/adjustments`

Returns adjustment data for a specific fixture.

#### Fixture Coaches
**GET** `/api/fixtures/{id}/coaches`

Returns coach information for a specific fixture.

#### Fixture Injuries
**GET** `/api/fixtures/{id}/injuries`

Returns injury information for a specific fixture.

#### Fixture Lineups
**GET** `/api/fixtures/{id}/lineups`

Returns team lineups for a specific fixture.

#### Fixture Stats
**GET** `/api/fixtures/{id}/stats`

Returns statistics for a specific fixture.

### Leagues

#### List Leagues
**GET** `/api/leagues`

Returns all available leagues.

**Response:**
```json
{
  "success": true,
  "leagues": [
    {
      "id": 39,
      "name": "Premier League",
      "type": "League",
      "country": "England",
      "seasons": {
        "2023": { "start": "2023-08-11", "end": "2024-05-19", "current": true }
      },
      "xg_source": {},
      "pinnacle_league_id": 123,
      "betfair_competition_id": 456
    }
  ]
}
```

#### Get League Details
**GET** `/api/leagues/{id}`

Returns detailed information for a specific league.

#### Get League Seasons and Rounds
**GET** `/api/leagues/{id}/seasons/{season}/rounds`

Returns round information for a specific league season.

### Teams

#### List Teams
**GET** `/api/teams`

Returns all teams with their latest ELO ratings.

**Response:**
```json
{
  "success": true,
  "teams": [
    {
      "id": 33,
      "name": "Manchester United",
      "country": "England",
      "venue": "Old Trafford",
      "mappings": ["Man Utd", "Man United"],
      "elo": 1850.5
    }
  ]
}
```

#### Get Team Details
**GET** `/api/teams/{id}`

Returns detailed information for a specific team including latest ELO rating.

**Path Parameters:**
- `id` (number): Team ID

**Response:**
```json
{
  "success": true,
  "team": {
    "id": 33,
    "name": "Manchester United",
    "country": "England",
    "venue": "Old Trafford",
    "mappings": ["Man Utd", "Man United"],
    "elo": 1850.5
  }
}
```

### Odds

#### Get Odds Data
**GET** `/api/odds`

Returns odds data for fixtures with optional filtering.

**Query Parameters:**
- `fixtureId` (number|string): Single fixture ID or comma-separated list of IDs
- `limit` (number): Maximum number of fixtures to return
- `page` (number): Page number for pagination
- `bookies` (string): Comma-separated list of bookmakers to filter by
- `fair_odds` (boolean): Include fair odds calculations (default: false)
- `latest` (boolean): Return only latest odds for each bookmaker (default: false)

**Response (Multiple Fixtures):**
```json
{
  "fixtures": [
    {
      "fixture_id": 123,
      "home_team": "Manchester United",
      "away_team": "Liverpool",
      "date": "2024-01-15",
      "league": "Premier League",
      "updated_at": 1705324800,
      "odds": [
        {
          "bookie": "Pinnacle",
          "decimals": 2,
          "odds_x12": [2.1, 3.4, 3.2],
          "odds_ah": [/* asian handicap odds */],
          "odds_ou": [/* over/under odds */],
          "lines": [/* handicap and total lines */]
        }
      ]
    }
  ],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 50,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

#### Create/Update Odds (Admin)
**POST** `/api/odds`

Creates or updates odds data for a fixture.

**Query Parameters:**
- `fixtureId` (number): Target fixture ID

**Body Parameters:**
- `bookie` (string, required): Bookmaker name
- `opening_x12_home`, `opening_x12_draw`, `opening_x12_away`: Opening 1X2 odds
- `closing_x12_home`, `closing_x12_draw`, `closing_x12_away`: Closing 1X2 odds
- `opening_ou25_over`, `opening_ou25_under`: Opening Over/Under 2.5 odds
- `closing_ou25_over`, `closing_ou25_under`: Closing Over/Under 2.5 odds
- `fixture_timestamp` (number): Unix timestamp of the match start

### Player Stats

#### Get Player Statistics
**GET** `/api/player-stats`

Fetches player statistics from external API-Football service.

**Query Parameters:**
- `player_id` (number, required): Player ID
- `season` (string, required): Season year (e.g., "2023")
- `team_id` (number, optional): Team ID for filtering
- `league_id` (number, optional): League ID for filtering

**Response:**
```json
{
  "player": {
    "id": 123,
    "name": "Marcus Rashford",
    "age": 26,
    "nationality": "England",
    "height": "180 cm",
    "weight": "70 kg"
  },
  "statistics": {
    // Player statistics object from API-Football
  }
}
```

### Filter Values

#### Get Filter Values
**GET** `/api/fixtures/filter-values`

Returns available values for filtering fixtures.

### XG (Expected Goals)

#### Get XG Data
**GET** `/api/fixtures/xg`

Returns expected goals data for fixtures.

---

## Stream API Endpoints

Stream APIs use Server-Sent Events (SSE) for real-time data updates.

### Fixture Stream
**GET** `/api/fixtures/stream`

Streams real-time fixture updates.

**Query Parameters:**
- `fixtureId` (number|string): Single fixture ID or comma-separated list of IDs (optional - streams all future fixtures if not specified)

**Event Types:**
- `started`: Stream initialization
- `fixture_update`: Fixture data update

**Example Events:**
```json
{
  "type": "started",
  "timestamp": 1705324800000,
  "message": "Fixtures stream started successfully"
}

{
  "type": "fixture_update",
  "timestamp": 1705324800000,
  "fixture_id": 123,
  "fixture": {
    // Complete fixture object
  }
}
```

### Odds Stream
**GET** `/api/odds/stream`

Streams real-time odds updates.

**Query Parameters:**
- `fixtureId` (number|string): Single fixture ID or comma-separated list of IDs (optional)
- `bookies` (string): Comma-separated list of bookmakers to filter by
- `fair_odds` (boolean): Include fair odds in updates

**Event Types:**
- `started`: Stream initialization
- `odds_update`: Odds data update

**Example Events:**
```json
{
  "type": "started",
  "timestamp": 1705324800000,
  "message": "Odds stream started successfully"
}

{
  "type": "odds_update",
  "timestamp": 1705324800000,
  "fixture_id": 123,
  "odds": [
    {
      "bookie": "Bet365",
      "decimals": 2,
      "odds_x12": [2.1, 3.4, 3.2],
      "odds_ah": [/* asian handicap */],
      "odds_ou": [/* over/under */]
    }
  ]
}
```

### Fixture Fetch Stream
**POST** `/api/fixtures/fetch`

Streams progress updates during fixture fetching operations.

**Event Types:**
- `progress`: Fetching progress update
- `complete`: Fetching completed successfully
- `error`: Fetching failed

**Example Events:**
```json
{
  "type": "progress",
  "league": "Premier League",
  "current": 15,
  "total": 38,
  "message": "Fetching Premier League (15/38)"
}

{
  "type": "complete",
  "success": true,
  "message": "Fixtures fetched successfully",
  "updatedCount": 245
}
```

---

## Admin API Endpoints

### League Management

#### Add Leagues
**POST** `/api/admin/add-leagues`

Adds new leagues to the system by fetching from external API.

**Body Parameters:**
```json
{
  "selectedLeagues": [39, 140, 78],
  "selectedSeasons": {
    "39": ["2023", "2024"],
    "140": ["2023"]
  }
}
```

#### Search Leagues
**GET** `/api/admin/search-leagues`

Searches for leagues from external API.

#### Get Leagues (Admin)
**GET** `/api/admin/leagues`

Returns all leagues (admin view).

#### Update League
**PUT** `/api/admin/leagues/{id}`

Updates league information.

#### Delete League
**DELETE** `/api/admin/leagues/{id}`

Deletes a league and all associated data (fixtures, odds, predictions).

**Path Parameters:**
- `id` (number): League ID

**Response:**
```json
{
  "success": true,
  "message": "League and all associated data deleted successfully"
}
```

#### Get League Seasons and Rounds
**GET** `/api/admin/leagues/{id}/seasons/{season}/rounds`

Returns round information for admin management.

### Machine Learning (MLP)

#### Train Model
**POST** `/api/admin/mlp/train`

Starts background training of the prediction model.

**Response:**
```json
{
  "success": true,
  "message": "Training started in background...",
  "trainingSize": 15420,
  "predictionSize": 245
}
```

#### Make Predictions
**POST** `/api/admin/mlp/predict`

Generates predictions for upcoming fixtures.

#### Get Prediction Odds
**GET** `/api/admin/mlp/prediction-odds`

Returns prediction odds data.

#### Simulate Betting
**POST** `/api/admin/mlp/simulate-betting`

Runs betting simulation using historical data.

#### Test Model
**GET** `/api/admin/mlp/test`

Tests the current model performance.

### Fixture Management (Admin)

#### Get Team Mappings
**GET** `/api/admin/fixtures/{id}/mappings`

Returns team name mappings for a fixture.

### XG Source Management

#### Update XG Source
**POST** `/api/admin/update-xg-source`

Updates expected goals source configuration.

### Auto Refresh

#### Trigger Auto Refresh
**POST** `/api/admin/auto-refresh`

Triggers automatic data refresh process.

### Chain Processing

#### Process Chain
**POST** `/api/admin/chain`

Processes data through the processing chain.

---

## Data Types

### Fixture Object
```typescript
{
  id: number;
  referee?: string;
  timestamp: number;
  date: string;
  venue_name?: string;
  status_long: string;
  status_short: string;
  home_team_id: number;
  home_team_name: string;
  home_country: string;
  away_team_id: number;
  away_team_name: string;
  away_country: string;
  xg_home?: number;
  xg_away?: number;
  market_xg_home?: number;
  market_xg_away?: number;
  goals_home?: number;
  goals_away?: number;
  score_halftime_home?: number;
  score_halftime_away?: number;
  score_fulltime_home?: number;
  score_fulltime_away?: number;
  score_extratime_home?: number;
  score_extratime_away?: number;
  score_penalty_home?: number;
  score_penalty_away?: number;
  league_id: number;
  league_name: string;
  league_country: string;
  season: string;
  round: string;
  updated_at: string;
  home_pred?: number;
  away_pred?: number;
}
```

### Odds Object
```typescript
{
  bookie: string;
  decimals: number;
  odds_x12?: number[]; // [home_win, draw, away_win]
  odds_ah?: any[];     // Asian Handicap odds
  odds_ou?: any[];     // Over/Under odds
  lines?: any[];       // Handicap and total lines
  fair_odds_x12?: number[];
  fair_odds_ah?: any[];
  fair_odds_ou?: any[];
  fair_odds_lines?: {
    ah?: any[];
    ou?: any[];
  };
}
```

---

## Error Handling

All endpoints use consistent error handling:

- `400 Bad Request`: Invalid parameters or missing required fields
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server-side errors

Error responses follow this format:
```json
{
  "error": "Error message description"
}
```

---

## Rate Limiting

- Stream endpoints maintain persistent connections
- Admin endpoints may require additional authentication requirements
- External API calls (player stats, league data) respect third-party rate limits

---

## Database Tables

The API interacts with these main database tables:
- `football_fixtures`: Match fixture data
- `football_odds`: Betting odds data
- `football_fair_odds`: Calculated fair odds
- `football_leagues`: League information
- `football_teams`: Team information
- `football_stats`: Match statistics
- `football_predictions`: Model predictions

---

## Environment Variables

Required environment variables:
- `API_KEY`: External football API key
- `API_BASE_URL`: External football API base URL
- `DATABASE_URL`: PostgreSQL connection string

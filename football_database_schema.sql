-- ============================================
-- FOOTBALL DATABASE SCHEMA
-- ============================================
-- 
-- This file contains the complete schema for all football-related tables
-- Generated: September 2025
-- Database: PostgreSQL
--
-- Tables included:
-- - football_fixtures (main fixture data with xG)
-- - football_leagues (league information)
-- - football_teams (team information)
-- - football_odds (bookmaker and predicted odds with history)
-- - football_predictions (ML goals predictions and adjustments)
-- - football_stats (team statistics)
--

-- ============================================
-- CORE TABLES
-- ============================================

-- League Information
--
-- JSONB Format Explanations:
--
-- seasons: Stores season information with year-based keys
-- Format: {
--   "2024": {
--     "end": "2024-10-26",
--     "start": "2024-04-13",
--     "current": false
--   },
--   "2025": {
--     "end": "2025-10-18",
--     "start": "2025-04-21",
--     "current": true
--   }
-- }
-- - Keys are season years as strings (e.g., "2024", "2025")
-- - Each season object contains:
--   * start: ISO date string for season start
--   * end: ISO date string for season end
--   * current: boolean indicating if this is the current active season
--
-- xg_source: Stores expected goals (xG) data source information by season
-- Format: {
--   "2025": {
--     "rounds": {
--       "ALL": {
--         "url": "NATIVE"
--       }
--     }
--   }
-- }
-- - Keys are season years as strings
-- - Each season contains rounds object with round names as keys
-- - "ALL" represents all rounds in the season
-- - Each round contains:
--   * url: Source URL for xG data ("NATIVE" indicates internal/native calculation)
--
CREATE TABLE football_leagues (
    id                      BIGINT PRIMARY KEY,
    name                    VARCHAR(255),
    type                    VARCHAR(100),
    country                 VARCHAR(100),
    seasons                 JSONB,
    xg_source               JSONB,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW(),
    pinnacle_league_id      INTEGER,
    betfair_competition_id  INTEGER,
    veikkaus_league_id      INTEGER
);

-- Team Information  
CREATE TABLE football_teams (
    id                      BIGINT PRIMARY KEY,
    name                    VARCHAR(255) NOT NULL,
    country                 VARCHAR(100),
    venue                   VARCHAR(255),
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

-- Main Fixtures Table (with xG data)
CREATE TABLE football_fixtures (
    id                      BIGINT PRIMARY KEY,
    referee                 VARCHAR(255),
    timestamp               BIGINT,
    date                    TIMESTAMP WITH TIME ZONE,
    venue_name              VARCHAR(255),
    status_long             VARCHAR(50),
    status_short            VARCHAR(10),
    home_team_id            BIGINT,
    home_team_name          VARCHAR(255),
    home_country            VARCHAR(100),
    away_team_id            BIGINT,
    away_team_name          VARCHAR(255),
    away_country            VARCHAR(100),
    xg_home                 DECIMAL(4,2),
    xg_away                 DECIMAL(4,2),
    goals_home              INTEGER,
    goals_away              INTEGER,
    score_halftime_home     INTEGER,
    score_halftime_away     INTEGER,
    score_fulltime_home     INTEGER,
    score_fulltime_away     INTEGER,
    score_extratime_home    INTEGER,
    score_extratime_away    INTEGER,
    score_penalty_home      INTEGER,
    score_penalty_away      INTEGER,
    league_id               BIGINT,
    league_name             VARCHAR(255),
    league_country          VARCHAR(100),
    season                  INTEGER,
    round                   VARCHAR(50),
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW(),
    
    -- Foreign Keys
    FOREIGN KEY (home_team_id) REFERENCES football_teams(id),
    FOREIGN KEY (away_team_id) REFERENCES football_teams(id),
    FOREIGN KEY (league_id) REFERENCES football_leagues(id)
);

-- ============================================
-- ODDS AND PREDICTIONS
-- ============================================

-- Odds
CREATE TABLE IF NOT EXISTS football_odds (
  fixture_id   BIGINT       NOT NULL,
  bookie       VARCHAR(100) NOT NULL,

  -- JSONB array of odds snapshots with complete historical data
  -- Format: [
  --   {
  --     "t": 1758213041,          // timestamp (unix timestamp)
  --     "lines": {
  --       "ah": [-0.25, 0, 0.25], // Asian handicap lines
  --       "ou": [2.0, 2.25, 2.5]  // Over/under goals lines
  --     },
  --     "x12": [165, 395, 480],     // [H, D, A] prices in basis points (1.65->165)
  --     "ah_h": [185, 145, 120],    // Asian handicap home prices (aligns with lines.ah by index)
  --     "ah_a": [185, 290, 530],    // Asian handicap away prices (aligns with lines.ah by index)
  --     "ou_o": [180, 190, 200],    // Over prices (aligns with lines.ou by index)
  --     "ou_u": [200, 190, 180]     // Under prices (aligns with lines.ou by index)
  --   },
  --   {
  --     "t": 1758216120,            // Odds updated and lines changed
  --     "lines": {
  --       "ah": [-0.5, -0.25, 0, 0.25], // Updated Asian handicap lines
  --       "ou": [2.0, 2.25, 2.5]       // Updated Over/under goals lines
  --     },
  --     "x12": [164, 400, 485],      // Updated [H, D, A] prices
  --     "ah_h": [172, 183, 150, 118], // Updated Asian handicap home prices
  --     "ah_a": [228, 187, 285, 540], // Updated Asian handicap away prices
  --     "ou_o": [179, 188, 202],      // Updated Over prices
  --     "ou_u": [201, 192, 178]       // Updated Under prices
  --   }
  -- ]
  --
  -- Field Explanations:
  -- - t: Unix timestamp when these odds were recorded
  -- - lines.ah: Array of Asian handicap lines (handicap values)
  -- - lines.ou: Array of over/under goals lines (goal totals)
  -- - x12: 1X2 (match outcome) prices in basis points (divide by 100 for decimal odds)
  -- - ah_h: Asian handicap prices for home team (indices match lines.ah)
  -- - ah_a: Asian handicap prices for away team (indices match lines.ah)
  -- - ou_o: Over prices (indices match lines.ou)
  -- - ou_u: Under prices (indices match lines.ou)
  --
  -- Price Format: All odds are stored in basis points (e.g., 165 = 1.65 decimal odds)
  odds         JSONB        NOT NULL,
  -- scalar mirror for fast filtering/sorting without peeking into JSON
  latest_t     BIGINT       NOT NULL,

  decimals     INTEGER      NOT NULL DEFAULT 2,
  created_at   TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT now(),

  PRIMARY KEY (fixture_id, bookie),
  FOREIGN KEY (fixture_id) REFERENCES football_fixtures(id) ON DELETE CASCADE,

  -- sanity checks
  CONSTRAINT chk_odds_is_array CHECK (jsonb_typeof(odds) = 'array')
);


-- ML Predictions and Manual Adjustments
CREATE TABLE football_predictions (
    fixture_id              BIGINT PRIMARY KEY,
    home_pred               DECIMAL(5,4),
    away_pred               DECIMAL(5,4),
    home_adjustment         DECIMAL(5,4),
    draw_adjustment         DECIMAL(5,4),
    away_adjustment         DECIMAL(5,4),
    adjustment_reason       TEXT,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    FOREIGN KEY (fixture_id) REFERENCES football_fixtures(id) ON DELETE CASCADE
);

-- Fixture Statistics (expandable)
CREATE TABLE football_stats (
    fixture_id              BIGINT PRIMARY KEY,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    FOREIGN KEY (fixture_id) REFERENCES football_fixtures(id) ON DELETE CASCADE
    
    -- Note: This table is designed to be extended with additional statistical columns
    -- Examples of future columns:
    -- Days_Since_Last_Match_Home           INTEGER,
    -- Days_Since_Last_Match_Away           INTEGER,
    -- Season_Match_Number_Home             INTEGER,
    -- Season_Match_Number_Away             INTEGER,
    -- Table_Mobility_Home                  INTEGER,
    -- Table_Mobility_Away                  INTEGER,
    -- Team_Elo_Rating_Home                 INTEGER,
    -- Team_Elo_Rating_Away                 INTEGER,
    -- League_Elo_Rating                    INTEGER,
    -- Rolling_Market_xG_Home               INTEGER,
    -- Rolling_Market_xGa_Home              INTEGER,
    -- Rolling_Market_xG_Away               INTEGER,  
    -- Rolling_Market_xGa_Away              INTEGER,
    -- Adjusted_Rolling_xG_Home             INTEGER,
    -- Adjusted_Rolling_xGa_Home            INTEGER,
    -- Adjusted_Rolling_xG_Away             INTEGER,
    -- Adjusted_Rolling_xGa_Away            INTEGER,
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- football_fixtures indexes
CREATE INDEX IF NOT EXISTS idx_football_fixtures_home_team_id ON football_fixtures (home_team_id);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_away_team_id ON football_fixtures (away_team_id);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_league_id ON football_fixtures (league_id);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_timestamp ON football_fixtures (timestamp);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_season ON football_fixtures (season);
CREATE INDEX IF NOT EXISTS idx_football_fixtures_status ON football_fixtures (status_short);

-- football_odds indexes
CREATE INDEX IF NOT EXISTS idx_odds_latest      ON football_odds (fixture_id, bookie, latest_t DESC);
CREATE INDEX IF NOT EXISTS idx_odds_latest_t    ON football_odds (latest_t DESC);
CREATE INDEX IF NOT EXISTS idx_odds_fixture     ON football_odds (fixture_id);
CREATE INDEX IF NOT EXISTS idx_odds_bookie      ON football_odds (bookie);

-- football_predictions indexes
CREATE INDEX IF NOT EXISTS idx_football_predictions_created_at ON football_predictions (created_at);

-- football_stats indexes
CREATE INDEX IF NOT EXISTS idx_football_stats_created_at ON football_stats (created_at);

-- Indexes for JSONB fields
CREATE INDEX IF NOT EXISTS idx_football_odds_odds_jsonb ON football_odds USING GIN (odds);
CREATE INDEX IF NOT EXISTS idx_football_leagues_seasons_jsonb ON football_leagues USING GIN (seasons);


-- ============================================
-- TRIGGERS FOR AUTOMATIC TIMESTAMPS
-- ============================================

-- Function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all relevant tables
CREATE TRIGGER update_football_fixtures_updated_at
    BEFORE UPDATE ON football_fixtures
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_football_odds_updated_at
    BEFORE UPDATE ON football_odds
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_football_predictions_updated_at
    BEFORE UPDATE ON football_predictions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_football_stats_updated_at
    BEFORE UPDATE ON football_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


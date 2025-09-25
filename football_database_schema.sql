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
  bookie_id    BIGINT       NOT NULL,
  bookie       VARCHAR(100) NOT NULL,

  -- Price Format: All odds are stored in basis points (e.g., 165 = 1.65 decimal odds)
  -- JSONB array of odds snapshots with complete historical data
  odds_x12     JSONB        NULLABLE,
  -- [ { "t": 1758213041, "x12": [165,395,480] }, { "t": 1758213819, "x12": [169,390,460] }, ... ]
  odds_ah      JSONB        NULLABLE,
  -- [ { "t": 1758213041, "ah_h": [185, 145, 120], "ah_a": [185, 290, 530] }, ... ]
  odds_ou      JSONB        NULLABLE,
  -- [ { "t": 1758213041, "ou_o": [180, 190, 200], "ou_u": [200, 190, 180] }, ... ]
  lines        JSONB        NULLABLE,
  -- [ { "t": 1758213041, "ah": [-0.25, 0, 0.25], "ou": [2.0, 2.25, 2.5] }, ... ]
  ids          JSONB        NULLABLE,
  -- [ { "t": 1758213041, "line_id": 346756, "line_ids": { "x12": "554785", "ah": ["523624", "316974", "964878"], "ou": ["316447", "464879", "649743"] } }, ... ]
  max_stakes   JSONB        NULLABLE,
  -- [ { "t": 1758213041, "max_stake_x12": [500, 500, 500], "max_stake_ah": { "h": [300, 350, 400], "a": [300, 350, 400] }, "max_stake_ou": { "o": [250, 260, 270], "u": [250, 260, 270] } }, ... ]
  latest_t     JSONB        NULLABLE,  
  -- { "x12_ts": 1758213041, "ah_ts": 1758213041, "ou_ts": 1758213041, "ids_ts": 1758213041, "stakes_ts": 1758213041, "lines_ts": 1758213041 },

  decimals     INTEGER      NOT NULL DEFAULT 2,
  created_at   TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT now(),

  PRIMARY KEY (fixture_id, bookie),
  FOREIGN KEY (fixture_id) REFERENCES football_fixtures(id) ON DELETE CASCADE,

  -- sanity checks: ensure arrays
  CONSTRAINT chk_odds_x12_is_array   CHECK (jsonb_typeof(odds_x12)   = 'array'),
  CONSTRAINT chk_odds_ah_is_array    CHECK (jsonb_typeof(odds_ah)    = 'array'),
  CONSTRAINT chk_odds_ou_is_array    CHECK (jsonb_typeof(odds_ou)    = 'array'),
  CONSTRAINT chk_lines_is_array      CHECK (jsonb_typeof(lines)      = 'array'),
  CONSTRAINT chk_ids_is_array        CHECK (jsonb_typeof(ids)        = 'array'),
  CONSTRAINT chk_max_stakes_is_array CHECK (jsonb_typeof(max_stakes) = 'array'),
  CONSTRAINT chk_latest_t_is_object  CHECK (jsonb_typeof(latest_t)   = 'object')
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_odds_fixture ON football_odds (fixture_id);

-- updated_at auto-update
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_updated_at ON football_odds;
CREATE TRIGGER trg_set_updated_at
BEFORE UPDATE ON football_odds
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


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

-- Primary composite index for your main query pattern
CREATE INDEX CONCURRENTLY idx_football_odds_fixture_bookie ON football_odds (fixture_id, bookie);

-- Index for latest_t queries (if you ever filter by timestamp)
CREATE INDEX CONCURRENTLY idx_football_odds_latest_t ON football_odds (latest_t);

-- Index for bookie_id lookups (if used)
CREATE INDEX CONCURRENTLY idx_football_odds_bookie_id ON football_odds (bookie_id);

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


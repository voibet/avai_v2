-- ============================================
-- FOOTBALL DATABASE SCHEMA
-- ============================================
--
-- This database stores comprehensive football (soccer) data for analysis and prediction.
-- It combines match results, expected goals (xG), betting odds, and calculated statistics
-- to support machine learning models and betting analysis.
--
-- KEY CONCEPTS:
-- - xG (Expected Goals): Mathematical prediction of scoring probability per shot
-- - Fair Odds: Odds without bookmaker margin, calculated from market probabilities
-- - Market XG: Expected goals derived from betting market odds using Dixon-Coles Poisson optimization
-- - ELO Ratings: Team strength ratings based on historical performance
-- - MLP: Multi-Layer Perceptron neural network that predicts goals using team statistics
--
-- This file contains the complete schema for all football-related tables
-- Generated: September 2025
-- Database: PostgreSQL
--
-- Tables included:
-- - football_fixtures (main fixture data with xG and actual results)
-- - football_leagues (league information and season data)
-- - football_teams (team information)
-- - football_odds (bookmaker odds with complete historical snapshots)
-- - football_predictions (MLP neural network predictions and manual adjustments)
-- - football_stats (calculated team statistics: ELO, rolling xG, etc.)
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
    market_xg_home          DECIMAL(4,2),
    market_xg_away          DECIMAL(4,2),
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
  odds_x12     JSONB        NULL,
  -- [ { "t": 1758213041, "x12": [165,395,480] }, { "t": 1758213819, "x12": [169,390,460] }, ... ]
  odds_ah      JSONB        NULL,
  -- [ { "t": 1758213041, "ah_h": [185, 145, 120], "ah_a": [185, 290, 530] }, ... ]
  odds_ou      JSONB        NULL,
  -- [ { "t": 1758213041, "ou_o": [180, 190, 200], "ou_u": [200, 190, 180] }, ... ]
  lines        JSONB        NULL,
  -- [ { "t": 1758213041, "ah": [-0.25, 0, 0.25], "ou": [2.0, 2.25, 2.5] }, ... ]
  ids          JSONB        NULL,
  -- [ { "t": 1758213041, "line_id": 346756, "line_ids": { "x12": "554785", "ah": ["523624", "316974", "964878"], "ou": ["316447", "464879", "649743"] } }, ... ]
  max_stakes   JSONB        NULL,
  -- [ { "t": 1758213041, "max_stake_x12": [500, 500, 500], "max_stake_ah": { "h": [300, 350, 400], "a": [300, 350, 400] }, "max_stake_ou": { "o": [250, 260, 270], "u": [250, 260, 270] } }, ... ]
  latest_t     JSONB        NULL,  
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


-- ============================================
-- MACHINE LEARNING PREDICTIONS (MLP)
-- ============================================
--
-- MLP (Multi-Layer Perceptron) Neural Network for Goal Prediction
--
-- HOW IT WORKS:
-- 1. The MLP is a neural network trained on historical fixture data (season >= 2022)
-- 2. It learns patterns from team statistics to predict goals_home and goals_away
-- 3. The model uses TensorFlow.js and is cached in memory for fast predictions
--
-- INPUT FEATURES (10 features):
-- - home_advantage: League-specific home field advantage (goals difference)
-- - adjusted_rolling_xg_home: Home team's adjusted expected goals (rolling average)
-- - adjusted_rolling_xga_home: Home team's adjusted expected goals against
-- - adjusted_rolling_xg_away: Away team's adjusted expected goals
-- - adjusted_rolling_xga_away: Away team's adjusted expected goals against
-- - adjusted_rolling_market_xg_home: Home team's market xG (from odds)
-- - adjusted_rolling_market_xga_home: Home team's market xGA
-- - adjusted_rolling_market_xg_away: Away team's market xG
-- - adjusted_rolling_market_xga_away: Away team's market xGA
-- - avg_goals_league: League average goals per match
--
-- OUTPUT:
-- - home_pred: Predicted goals for home team (DECIMAL)
-- - away_pred: Predicted goals for away team (DECIMAL)
--
-- ADMIN API ENDPOINTS:
-- - POST /api/admin/mlp/train: Train new model on historical data, saves to cache
-- - POST /api/admin/mlp/predict: Generate predictions for all upcoming fixtures (auto-trains if needed)
-- - GET /api/admin/mlp/predict/[id]: Predict single fixture by ID
-- - POST /api/admin/mlp/test: Test model performance on historical data (calculates MAE, RMSE), does not predict
--
-- ADMIN FIXTURES API ENDPOINTS:
-- - POST /api/admin/fixtures/fetch: Start fixture fetching
--   * Body: { type: 'all' } - fetch all current seasons
--   * Body: { type: 'league', leagueId: 123 } - fetch specific league's current season
--
-- ADMIN XG API ENDPOINTS:
-- - POST /api/admin/fetch-xg-data: Start XG data fetching (triggers automatic calculation chain)
--   * Body: { type: 'all' } - fetch XG for all leagues with XG sources
--   * Body: { type: 'league', leagueId: 123 } - fetch XG for specific league
--   * Automatically triggers: /market-xg (for updated fixtures) → /stats → /predict → /prediction-odds (for future fixtures of updated teams)
-- - POST /api/admin/update-xg-source: Configure XG data sources for leagues
--   * Body: { leagueId, season, rounds, xgSource }
--
-- ADMIN CALCULATIONS API ENDPOINTS:
-- - POST /api/admin/market-xg: Calculate market XG for all finished fixtures
-- - POST /api/admin/market-xg/[...ids]: Calculate market XG for specific fixture IDs
--   * URL: /api/admin/market-xg/123,456,789 - comma-separated fixture IDs
-- - POST /api/admin/prediction-odds: Calculate betting odds from all MLP predictions
-- - POST /api/admin/prediction-odds/[...ids]: Calculate betting odds for specific fixture IDs
--   * URL: /api/admin/prediction-odds/123,456,789 - comma-separated fixture IDs
-- - POST /api/admin/stats: Run statistics calculations
--   * Body: { "functions": ["all"], "fixtureIds": [123, 456], "createViews": false }
--
-- MLP Predictions and Manual Adjustments

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

    -- Hours since last match for each team
    hours_since_last_match_home          INTEGER,
    hours_since_last_match_away          INTEGER,

    -- League average goals (past 160 fixtures)
    avg_goals_league                     DECIMAL(4,2),

    -- Team ELO ratings (calculated using xG or actual goals)
    elo_home                            INTEGER,
    elo_away                            INTEGER,
    league_elo                          INTEGER,

    -- Home advantage (average home_xg - away_xg for past 160 matches, capped 0.1-0.6)
    home_advantage                       DECIMAL(3,2),

    -- Weighted adjusted rolling xG and xGA (across past 32 matches)
    adjusted_rolling_xg_home                DECIMAL(4,2),
    adjusted_rolling_xga_home                DECIMAL(4,2),
    adjusted_rolling_xg_away                DECIMAL(4,2),
    adjusted_rolling_xga_away                DECIMAL(4,2),

    -- Weighted adjusted rolling market xG and xGA (across past 32 matches)
    adjusted_rolling_market_xg_home         DECIMAL(4,2),
    adjusted_rolling_market_xga_home         DECIMAL(4,2),
    adjusted_rolling_market_xg_away         DECIMAL(4,2),
    adjusted_rolling_market_xga_away         DECIMAL(4,2),

    -- Constraints
    FOREIGN KEY (fixture_id) REFERENCES football_fixtures(id) ON DELETE CASCADE

    -- Note: This table is designed to be extended with additional statistical columns
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

-- Performance indexes for calculations
CREATE INDEX IF NOT EXISTS idx_football_fixtures_team_date ON football_fixtures (home_team_id, date) WHERE status_short = 'FT';
CREATE INDEX IF NOT EXISTS idx_football_fixtures_team_date_away ON football_fixtures (away_team_id, date) WHERE status_short = 'FT';
CREATE INDEX IF NOT EXISTS idx_football_fixtures_league_date_status ON football_fixtures (league_id, date DESC, status_short) WHERE status_short = 'FT';
CREATE INDEX IF NOT EXISTS idx_football_fixtures_market_xg ON football_fixtures (market_xg_home, market_xg_away) WHERE market_xg_home IS NOT NULL;

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

-- Composite index for market xG calculations (frequently queried columns together)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_football_stats_fixture_elo ON football_stats (fixture_id, elo_home, elo_away, league_elo, home_advantage);

-- Index for ELO-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_football_stats_elos ON football_stats (elo_home, elo_away, league_elo) WHERE elo_home IS NOT NULL AND elo_away IS NOT NULL AND league_elo IS NOT NULL;

-- Index for rolling calculations (team + date filtering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_football_fixtures_team_date_league ON football_fixtures (home_team_id, date DESC, league_id) WHERE status_short = 'FT';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_football_fixtures_away_team_date_league ON football_fixtures (away_team_id, date DESC, league_id) WHERE status_short = 'FT';

-- Indexes for JSONB fields
CREATE INDEX IF NOT EXISTS idx_football_odds_odds_jsonb ON football_odds USING GIN (odds);
CREATE INDEX IF NOT EXISTS idx_football_leagues_seasons_jsonb ON football_leagues USING GIN (seasons);


-- ============================================
-- VIEWS FOR CALCULATED DATA
-- ============================================

-- View to calculate payout percentages (bookmaker margin) from latest odds data
-- Payout shows total implied probability (should be > 1.0 due to margin)
-- For 2-way markets: payout = 1 / ((1/odds1) + (1/odds2))
-- For 3-way markets: payout = 1 / ((1/odds1) + (1/odds2) + (1/odds3))
DROP VIEW IF EXISTS payout_view;
CREATE VIEW payout_view AS
SELECT
    fo.fixture_id,
    fo.bookie,
    fo.decimals,
    -- X12 payout calculation (3-way)
    CASE
        WHEN fo.odds_x12 IS NOT NULL THEN
            ROUND(
                (
                    1.0 / (
                        (1.0 / ((fo.odds_x12->-1->'x12'->>0)::numeric / POWER(10, fo.decimals))) +
                        (1.0 / ((fo.odds_x12->-1->'x12'->>1)::numeric / POWER(10, fo.decimals))) +
                        (1.0 / ((fo.odds_x12->-1->'x12'->>2)::numeric / POWER(10, fo.decimals)))
                    )
                )::numeric,
                4
            )
        ELSE NULL
    END as payout_x12,
    -- AH payout calculation per line (2-way per handicap line)
    CASE
        WHEN fo.odds_ah IS NOT NULL THEN
            (
                SELECT jsonb_agg(
                    ROUND(
                        (
                            1.0 / (
                                (1.0 / (ah_h.elem::numeric / POWER(10, fo.decimals))) +
                                (1.0 / (ah_a.elem::numeric / POWER(10, fo.decimals)))
                            )
                        )::numeric,
                        4
                    )
                )
                FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_h')::jsonb) WITH ORDINALITY ah_h(elem, idx)
                JOIN jsonb_array_elements_text((fo.odds_ah->-1->>'ah_a')::jsonb) WITH ORDINALITY ah_a(elem, idx)
                ON ah_h.idx = ah_a.idx
            )
        ELSE NULL
    END as payout_ah,
    -- OU payout calculation per line (2-way per total line)
    CASE
        WHEN fo.odds_ou IS NOT NULL THEN
            (
                SELECT jsonb_agg(
                    ROUND(
                        (
                            1.0 / (
                                (1.0 / (ou_o.elem::numeric / POWER(10, fo.decimals))) +
                                (1.0 / (ou_u.elem::numeric / POWER(10, fo.decimals)))
                            )
                        )::numeric,
                        4
                    )
                )
                FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_o')::jsonb) WITH ORDINALITY ou_o(elem, idx)
                JOIN jsonb_array_elements_text((fo.odds_ou->-1->>'ou_u')::jsonb) WITH ORDINALITY ou_u(elem, idx)
                ON ou_o.idx = ou_u.idx
            )
        ELSE NULL
    END as payout_ou,
    -- Latest odds data for reference
    fo.odds_x12->-1 as latest_x12,
    fo.odds_ah->-1 as latest_ah,
    fo.odds_ou->-1 as latest_ou
FROM football_odds fo
WHERE fo.odds_x12 IS NOT NULL OR fo.odds_ah IS NOT NULL OR fo.odds_ou IS NOT NULL;

-- View to calculate fair odds (no vig/no margin) from latest odds data
-- Fair odds remove the bookmaker's margin by normalizing implied probabilities
-- For 2-way markets: fair_odds = 1 / (implied_prob / total_implied_prob)
DROP VIEW IF EXISTS fair_odds_view;
CREATE VIEW fair_odds_view AS
SELECT
    fo.fixture_id,
    fo.bookie,
    fo.decimals,
    -- Latest X12 odds data with fair odds calculation
    CASE
        WHEN fo.odds_x12 IS NOT NULL THEN
            jsonb_build_object(
                'original_x12', (fo.odds_x12->-1->>'x12')::jsonb,
                'fair_x12', (
                    SELECT jsonb_agg(
                        ROUND(
                            (
                                1.0 / (
                                    (1.0 / (x12_odds::numeric / POWER(10, fo.decimals))) /
                                    (
                                        SELECT SUM(1.0 / (elem::numeric / POWER(10, fo.decimals)))
                                        FROM jsonb_array_elements_text((fo.odds_x12->-1->>'x12')::jsonb) elem
                                    )
                                )
                            )::numeric,
                            fo.decimals
                        )::text
                        ORDER BY x12_idx
                    )
                    FROM jsonb_array_elements_text((fo.odds_x12->-1->>'x12')::jsonb) WITH ORDINALITY x12(x12_odds, x12_idx)
                    WHERE x12_idx <= 3
                )
            )
        ELSE NULL
    END as fair_odds_x12,
    -- Latest AH odds data with fair odds calculation
    CASE
        WHEN fo.odds_ah IS NOT NULL THEN
            jsonb_build_object(
                'original_ah_h', (fo.odds_ah->-1->>'ah_h')::jsonb,
                'original_ah_a', (fo.odds_ah->-1->>'ah_a')::jsonb,
                'fair_ah_h', (
                    SELECT jsonb_agg(
                        CASE
                            WHEN h_odds::numeric > 0 AND a_odds::numeric > 0 THEN
                                ROUND(
                                    1.0 / (
                                        (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) /
                                        (
                                            (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                            (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                        )
                                    ),
                                    fo.decimals
                                )::text
                            ELSE NULL
                        END
                    )
                    FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_h')::jsonb) WITH ORDINALITY h(h_odds, h_idx)
                    JOIN jsonb_array_elements_text((fo.odds_ah->-1->>'ah_a')::jsonb) WITH ORDINALITY a(a_odds, a_idx)
                    ON h_idx = a_idx
                ),
                'fair_ah_a', (
                    SELECT jsonb_agg(
                        CASE
                            WHEN h_odds::numeric > 0 AND a_odds::numeric > 0 THEN
                                ROUND(
                                    1.0 / (
                                        (1.0 / (a_odds::numeric / POWER(10, fo.decimals))) /
                                        (
                                            (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                            (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                        )
                                    ),
                                    fo.decimals
                                )::text
                            ELSE NULL
                        END
                    )
                    FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_h')::jsonb) WITH ORDINALITY h(h_odds, h_idx)
                    JOIN jsonb_array_elements_text((fo.odds_ah->-1->>'ah_a')::jsonb) WITH ORDINALITY a(a_odds, a_idx)
                    ON h_idx = a_idx
                )
            )
        ELSE NULL
    END as fair_odds_ah,
    -- Latest OU odds data with fair odds calculation
    CASE
        WHEN fo.odds_ou IS NOT NULL THEN
            jsonb_build_object(
                'original_ou_o', (fo.odds_ou->-1->>'ou_o')::jsonb,
                'original_ou_u', (fo.odds_ou->-1->>'ou_u')::jsonb,
                'fair_ou_o', (
                    SELECT jsonb_agg(
                        CASE
                            WHEN o_odds::numeric > 0 AND u_odds::numeric > 0 THEN
                                ROUND(
                                    (
                                        1.0 / (
                                            (1.0 / (o_odds::numeric / POWER(10, fo.decimals))) /
                                            (
                                                (1.0 / (o_odds::numeric / POWER(10, fo.decimals))) +
                                                (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))
                                            )
                                        )
                                    )::numeric,
                                    fo.decimals
                                )::text
                            ELSE NULL
                        END
                    )
                    FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_o')::jsonb) WITH ORDINALITY o(o_odds, o_idx)
                    JOIN jsonb_array_elements_text((fo.odds_ou->-1->>'ou_u')::jsonb) WITH ORDINALITY u(u_odds, u_idx)
                    ON o_idx = u_idx
                ),
                'fair_ou_u', (
                    SELECT jsonb_agg(
                        CASE
                            WHEN o_odds::numeric > 0 AND u_odds::numeric > 0 THEN
                                ROUND(
                                    (
                                        1.0 / (
                                            (1.0 / (u_odds::numeric / POWER(10, fo.decimals))) /
                                            (
                                                (1.0 / (o_odds::numeric / POWER(10, fo.decimals))) +
                                                (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))
                                            )
                                        )
                                    )::numeric,
                                    fo.decimals
                                )::text
                            ELSE NULL
                        END
                    )
                    FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_o')::jsonb) WITH ORDINALITY o(o_odds, o_idx)
                    JOIN jsonb_array_elements_text((fo.odds_ou->-1->>'ou_u')::jsonb) WITH ORDINALITY u(u_odds, u_idx)
                    ON o_idx = u_idx
                )
            )
        ELSE NULL
    END as fair_odds_ou,
    -- Include lines for reference
    fo.lines->-1 as latest_lines
FROM football_odds fo
WHERE fo.odds_x12 IS NOT NULL OR fo.odds_ah IS NOT NULL OR fo.odds_ou IS NOT NULL;

-- ============================================
-- LEAGUE ELO RATINGS
-- ============================================

-- Initial league ELO ratings for all leagues
-- This table stores the base ELO ratings for leagues that are used
-- as starting points for team ELO calculations
CREATE TABLE football_initial_league_elos (
    league_id BIGINT PRIMARY KEY REFERENCES football_leagues(id),
    elo INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for performance
CREATE INDEX idx_football_initial_league_elos_elo ON football_initial_league_elos(elo);

-- Add trigger for updated_at
CREATE TRIGGER update_football_initial_league_elos_updated_at
    BEFORE UPDATE ON football_initial_league_elos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

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


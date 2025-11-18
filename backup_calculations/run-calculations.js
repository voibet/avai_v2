/**
 * Football Statistics Calculator
 *
 * This script populates the football_stats table with calculated metrics for fixtures:
 * - Hours since last match for home and away teams (includes all scheduled matches)
 * - League average goals (rolling average of last 300 matches, min: 50, capped 1.5-4.0, default 2.76)
 * - Home advantage (average home_goals - away_goals for past 300 matches, min: 50, capped 0.1-0.6, default 0.30)
 * - ELO ratings (team ELOs using XG ratio as continuous scores + league ELOs as average of team ELOs)
 * - Rolling xG and xGA (8, 16, 32 match windows averaged, min: 5 matches per team WITH league-specific filtering)
 *
 * DATABASE TABLES CREATED & POPULATED (when --views is used):
 * - football_odds
 * - fair_odds: Stores fair odds calculations per fixture/bookie (auto-updating)
 * - Automatic triggers keep tables updated when odds change
 *
 * USAGE:
 * RUN: $env:DB_USER='postgres'; $env:DB_PASSWORD='NopoONpelle31?'; $env:DB_HOST='172.29.253.202'; $env:DB_PORT='5432'; $env:DB_NAME='mydb'; $env:DB_SSL='false'; npx ts-node run-calculations.js [function] [--fixture-ids=id1,id2,id3] [--views]
 * 
 * OPTIONS:
 *   function: '1' or 'hours', '2' or 'goals', '3' or 'elo', '4' or 'home-advantage', '5' or 'xg' or 'rolling-xg', '6' or 'market-xg', '7' or 'prediction-odds' or 'odds', '8' or 'cleanup-odds', 'all' (default)
 *   Multiple functions can be specified comma-separated, e.g., '2,5' to run goals and rolling-xg calculations
 *   --fixture-ids=id1,id2,id3: Process only specific fixture IDs (comma-separated)
 *   --views: Create & populate auto-updating calculated odds tables (fair_odds) + drop old views
 *
 * LEAGUE-SPECIFIC FILTERING:
 *   - For League matches: Only same-country League matches are used for rolling xG calculations (min: 5 matches)
 *   - For Cup matches: ALL matches from past 365 days are used for rolling xG calculations (min: 5 matches)
 */

import pool from './lib/database/db.ts';
import { calculateMarketXG } from './calculators/market-xg.js';
import { calculateOddsFromPredictions } from './calculators/prediction-odds.js';
import { cleanupPastFixturesOdds } from './calculators/cleanup-odds.js';


async function runCalculations() {
  try {
    console.log('🚀 Running calculations...');

    // Load league ELO data from database table (populate if needed)
    let leagueEloValues = '';
    try {
      // Fetch league ELO data from database
      const result = await pool.query('SELECT league_id, elo FROM football_initial_league_elos ORDER BY league_id');
      leagueEloValues = result.rows
        .map(row => `(${row.league_id}, ${row.elo})`)
        .join(',\n        ');

      console.log(`📊 Loaded ${result.rows.length} league ELO ratings from database`);
    } catch (error) {
      console.error('❌ Error setting up league ELO data:', error.message);
      return;
    }

    const sql = `
    -- Create football_stats table if it doesn't exist
    CREATE TABLE IF NOT EXISTS football_stats (
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
    );

    -- Create indexes for football_stats if they don't exist
    CREATE INDEX IF NOT EXISTS idx_football_stats_created_at ON football_stats (created_at);

    -- Function to populate hours since last match (includes all scheduled matches)
    CREATE OR REPLACE FUNCTION populate_hours_batch(fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
    DECLARE
        updated_count INTEGER;
    BEGIN
        -- Single set-based query with optional fixture filtering
        INSERT INTO football_stats (fixture_id, hours_since_last_match_home, hours_since_last_match_away)
        SELECT
            f.id,
            CASE
                WHEN lm_home.hours_diff IS NULL THEN 168        -- First match ever: 1 week (168 hours)
                WHEN lm_home.hours_diff < 24 THEN 24             -- Under 24 hours: set to 24 hours minimum
                WHEN lm_home.hours_diff > 500 THEN 500
                ELSE lm_home.hours_diff::INTEGER
            END,
            CASE
                WHEN lm_away.hours_diff IS NULL THEN 168        -- First match ever: 1 week (168 hours)
                WHEN lm_away.hours_diff < 24 THEN 24             -- Under 24 hours: set to 24 hours minimum
                WHEN lm_away.hours_diff > 500 THEN 500
                ELSE lm_away.hours_diff::INTEGER
            END
        FROM (
            SELECT * FROM football_fixtures
            WHERE (fixture_ids IS NULL OR id = ANY(fixture_ids))
        ) f
        LEFT JOIN LATERAL (
            SELECT EXTRACT(EPOCH FROM (f.date - MAX(ff.date))) / 3600 as hours_diff
            FROM football_fixtures ff
            WHERE (ff.home_team_id = f.home_team_id OR ff.away_team_id = f.home_team_id)
              AND ff.date < f.date
        ) lm_home ON true
        LEFT JOIN LATERAL (
            SELECT EXTRACT(EPOCH FROM (f.date - MAX(ff.date))) / 3600 as hours_diff
            FROM football_fixtures ff
            WHERE (ff.home_team_id = f.away_team_id OR ff.away_team_id = f.away_team_id)
              AND ff.date < f.date
        ) lm_away ON true
        ON CONFLICT (fixture_id) DO UPDATE SET
            hours_since_last_match_home = EXCLUDED.hours_since_last_match_home,
            hours_since_last_match_away = EXCLUDED.hours_since_last_match_away,
            updated_at = NOW();

        GET DIAGNOSTICS updated_count = ROW_COUNT;
        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to populate league average goals
    CREATE OR REPLACE FUNCTION populate_league_goals_batch(fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
    DECLARE
        updated_count INTEGER;
    BEGIN
        -- Set-based calculation with constraints
        INSERT INTO football_stats (fixture_id, avg_goals_league)
        SELECT 
            f.id,
            CASE
                WHEN lg.fixture_count < 50 THEN 2.76
                WHEN lg.avg_goals IS NULL THEN 2.76
                WHEN lg.avg_goals < 1.5 THEN 1.5
                WHEN lg.avg_goals > 4 THEN 4.0
                ELSE ROUND(lg.avg_goals, 2)
            END
        FROM (
            SELECT * FROM football_fixtures
            WHERE (fixture_ids IS NULL OR id = ANY(fixture_ids))
        ) f
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) as fixture_count,
                AVG(ff.goals_home + ff.goals_away) as avg_goals
            FROM (
                SELECT goals_home, goals_away
                FROM football_fixtures ff
                WHERE ff.league_id = f.league_id
                  AND ff.date < f.date
                  AND LOWER(ff.status_short) IN ('ft', 'aet', 'pen')
                  AND ff.goals_home IS NOT NULL
                  AND ff.goals_away IS NOT NULL
                ORDER BY ff.date DESC
                LIMIT 300
            ) ff
        ) lg ON true
        ON CONFLICT (fixture_id) DO UPDATE SET
            avg_goals_league = EXCLUDED.avg_goals_league,
            updated_at = NOW();

        GET DIAGNOSTICS updated_count = ROW_COUNT;
        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to populate home advantage for each league
    CREATE OR REPLACE FUNCTION populate_home_advantage_batch(fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
    DECLARE
        updated_count INTEGER;
    BEGIN
        -- Set-based calculation of home advantage (home_goals - away_goals average)
        -- Priority order:
        -- 0. Special hardcoded leagues (e.g., league_id = 15) always get home advantage 0
        -- 1. If playing at official home venue (from football_teams.venue), use normal home advantage
        -- 2. If team has never played any of their last 10 home matches at current venue, set to 0
        -- 3. Otherwise use league-wide home advantage
        INSERT INTO football_stats (fixture_id, home_advantage)
        SELECT
            f.id,
            CASE
                -- Special hardcoded leagues that always get home advantage 0
                WHEN f.league_id = 15 THEN 0.0
                -- If current venue matches team's official venue, use normal home advantage
                WHEN ft.venue IS NOT NULL AND f.venue_name IS NOT NULL
                     AND (
                         -- Exact match or one contains the other
                         LOWER(TRIM(ft.venue)) = LOWER(TRIM(f.venue_name))
                         OR LOWER(TRIM(ft.venue)) LIKE '%' || LOWER(TRIM(f.venue_name)) || '%'
                         OR LOWER(TRIM(f.venue_name)) LIKE '%' || LOWER(TRIM(ft.venue)) || '%'
                         -- Or token-based matching (handles "Claudio Fabian Tapia" vs "Estadio Claudio Chiqui Tapia")
                         OR (
                             SELECT COUNT(*) >= 2
                             FROM (
                                 SELECT UNNEST(string_to_array(LOWER(TRIM(ft.venue)), ' ')) INTERSECT
                                        SELECT UNNEST(string_to_array(LOWER(TRIM(f.venue_name)), ' '))
                             ) common_tokens
                         )
                     ) THEN
                    CASE
                        WHEN ha.fixture_count < 50 THEN 0.30
                        WHEN ha.avg_home_advantage IS NULL THEN 0.30
                        WHEN ha.avg_home_advantage < 0.1 THEN 0.10
                        WHEN ha.avg_home_advantage > 0.6 THEN 0.60
                        ELSE ROUND(ha.avg_home_advantage, 2)
                    END
                -- Check if team has played any of their last 10 home matches at current venue
                WHEN f.venue_name IS NOT NULL AND (
                    -- Count how many of their last 10 home matches were at this venue
                    SELECT COUNT(*)
                    FROM (
                        SELECT 1
                        FROM football_fixtures past_f
                        WHERE past_f.home_team_id = f.home_team_id
                          AND past_f.date < f.date
                          AND LOWER(past_f.status_short) IN ('ft', 'aet', 'pen')
                          AND past_f.venue_name IS NOT NULL
                          AND (
                              -- Exact match
                              LOWER(TRIM(past_f.venue_name)) = LOWER(TRIM(f.venue_name))
                              -- Or one contains the other (handles "Estadio Camp Nou" vs "Camp Nou")
                              OR LOWER(TRIM(past_f.venue_name)) LIKE '%' || LOWER(TRIM(f.venue_name)) || '%'
                              OR LOWER(TRIM(f.venue_name)) LIKE '%' || LOWER(TRIM(past_f.venue_name)) || '%'
                              -- Or token-based matching (handles "Claudio Fabian Tapia" vs "Estadio Claudio Chiqui Tapia")
                              OR (
                                  SELECT COUNT(*) >= 2
                                  FROM (
                                      SELECT UNNEST(string_to_array(LOWER(TRIM(past_f.venue_name)), ' ')) INTERSECT
                                             SELECT UNNEST(string_to_array(LOWER(TRIM(f.venue_name)), ' '))
                                  ) common_tokens
                              )
                          )
                        ORDER BY past_f.date DESC
                        LIMIT 10
                    ) last_10_home_at_venue
                ) = 0 THEN 0.0  -- Never played at this venue in last 10 home matches, zero home advantage
                -- Otherwise use league-wide home advantage calculation
                WHEN ha.fixture_count < 50 THEN 0.30
                WHEN ha.avg_home_advantage IS NULL THEN 0.30
                WHEN ha.avg_home_advantage < 0.1 THEN 0.10
                WHEN ha.avg_home_advantage > 0.6 THEN 0.60
                ELSE ROUND(ha.avg_home_advantage, 2)
            END
        FROM (
            SELECT * FROM football_fixtures
            WHERE (fixture_ids IS NULL OR id = ANY(fixture_ids))
        ) f
        LEFT JOIN football_teams ft ON f.home_team_id = ft.id
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) as fixture_count,
                AVG(ff.goals_home - ff.goals_away) as avg_home_advantage
            FROM (
                SELECT goals_home, goals_away
                FROM football_fixtures ff
                WHERE ff.league_id = f.league_id
                  AND ff.date < f.date
                  AND LOWER(ff.status_short) IN ('ft', 'aet', 'pen')
                  AND ff.goals_home IS NOT NULL
                  AND ff.goals_away IS NOT NULL
                ORDER BY ff.date DESC
                LIMIT 300
            ) ff
        ) ha ON true
        ON CONFLICT (fixture_id) DO UPDATE SET
            home_advantage = EXCLUDED.home_advantage,
            updated_at = NOW();

        GET DIAGNOSTICS updated_count = ROW_COUNT;
        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to calculate and update ELO ratings with full recalculation
    -- ELO SYSTEM: Teams start with league base ELO from football_initial_league_elos (except World leagues)
    -- For World leagues: use current league ELO - 100 or 1450 fallback
    -- For other leagues: use football_initial_league_elos, then league ELO - 100, then 1450
    -- Then evolve individually based on match results across all competitions
    -- Always recalculates ALL fixtures from the beginning for complete data consistency
    -- Calculates team ELOs first (each team has one rating that evolves individually)
    -- Then calculates league ELOs (average strength of teams historically in that league)
    -- Uses XG data as continuous scores (XG ratio) to reflect match performance
    -- For matches without data: uses current team ELO ratings
    -- Teams carry their evolved ELO to World leagues, domestic leagues, etc.
    -- Ensures any changes to XG data or calculation logic are fully reflected
    CREATE OR REPLACE FUNCTION calculate_elos_incremental(fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
    DECLARE
        fixture_record RECORD;
        home_elo INTEGER;
        away_elo INTEGER;
        expected_home DECIMAL;
        expected_away DECIMAL;
        actual_home_score DECIMAL;
        actual_away_score DECIMAL;
        total_score DECIMAL;
        k_factor INTEGER := 30;
        updated_count INTEGER := 0;
        last_processed_date TIMESTAMP;
        league_base_elo INTEGER;
        pre_match_home_elo INTEGER;
        pre_match_away_elo INTEGER;
        new_home_elo INTEGER;
        new_away_elo INTEGER;
    BEGIN
        -- CORRECT ELO SYSTEM: Teams start with league base ELO from football_initial_league_elos (except World leagues)
        -- World leagues skip football_initial_league_elos and go directly to league ELO - 100 or 1450 fallback
        -- Then evolve individually based on match results across all competitions

        -- Create temporary table for league ELO ratings
        CREATE TEMP TABLE IF NOT EXISTS league_elo_ratings (
            league_id BIGINT PRIMARY KEY,
            base_elo INTEGER
        );

        -- Clear any existing data
        TRUNCATE league_elo_ratings;

        -- Load league ELO data dynamically
        INSERT INTO league_elo_ratings (league_id, base_elo) VALUES
        ${leagueEloValues};

        -- Create temporary table for team ELO ratings (each team has ONE rating)
        DROP TABLE IF EXISTS temp_team_elo;
        CREATE TEMP TABLE temp_team_elo (
            team_id BIGINT PRIMARY KEY,
            elo_rating INTEGER NOT NULL DEFAULT 1500
        );

        -- Process fixtures in chronological order for complete recalculation
        FOR fixture_record IN
            SELECT f.id, f.home_team_id, f.away_team_id, f.league_id,
                   f.xg_home, f.xg_away, f.goals_home, f.goals_away, f.date, f.status_short
            FROM (
                SELECT * FROM football_fixtures
                WHERE (fixture_ids IS NULL OR id = ANY(fixture_ids))
            ) f
            ORDER BY f.date ASC, f.id ASC
        LOOP
            -- Get league base ELO for initialization of new teams
            -- For World leagues: skip football_initial_league_elos, go directly to league_elo - 100 or 1450
            -- For other leagues: try football_initial_league_elos first, then league_elo - 100, then 1450
            SELECT CASE
                WHEN l.country = 'World' THEN
                    COALESCE(
                        (SELECT GREATEST(league_elo - 100, 1000)
                         FROM football_stats fs
                         JOIN football_fixtures f ON fs.fixture_id = f.id
                         WHERE f.league_id = fixture_record.league_id
                           AND fs.league_elo IS NOT NULL
                         ORDER BY f.date DESC
                         LIMIT 1),
                        1450
                    )
                ELSE
                    COALESCE(
                        ler.base_elo,
                        (SELECT GREATEST(league_elo - 100, 1000)
                         FROM football_stats fs
                         JOIN football_fixtures f ON fs.fixture_id = f.id
                         WHERE f.league_id = fixture_record.league_id
                           AND fs.league_elo IS NOT NULL
                         ORDER BY f.date DESC
                         LIMIT 1),
                        1450
                    )
            END INTO league_base_elo
            FROM football_leagues l
            LEFT JOIN league_elo_ratings ler ON ler.league_id = fixture_record.league_id
            WHERE l.id = fixture_record.league_id;

            -- Set K-factor based on league country
            -- Default K-factor = 30, but "World" leagues get K-factor = 50 for more volatility
            SELECT CASE
                WHEN l.country = 'World' THEN 50
                ELSE 30
            END INTO k_factor
            FROM football_leagues l
            WHERE l.id = fixture_record.league_id;

            -- Get or create home team ELO
            -- When processing specific fixtures (fixture_ids is not NULL), calculate current Elo including last fixture's result
            IF NOT EXISTS (SELECT 1 FROM temp_team_elo WHERE team_id = fixture_record.home_team_id) THEN
                IF fixture_ids IS NOT NULL THEN
                    -- Get the most recent past fixture data for this team
                    SELECT COALESCE(
                        (SELECT
                            -- Calculate the POST-MATCH Elo by applying the fixture result to the pre-match Elo
                            CASE
                                WHEN f.home_team_id = fixture_record.home_team_id THEN
                                    fs.elo_home + ROUND(k_factor * (
                                        CASE
                                            WHEN (COALESCE(f.xg_home, f.goals_home, 0) + COALESCE(f.xg_away, f.goals_away, 0)) > 0 THEN
                                                POWER(COALESCE(f.xg_home, f.goals_home, 0) / (COALESCE(f.xg_home, f.goals_home, 0) + COALESCE(f.xg_away, f.goals_away, 0)), 1.5)
                                            ELSE 0.5
                                        END -
                                        (1.0 / (1.0 + POWER(10, (fs.elo_away - fs.elo_home)::DECIMAL / 400)))
                                    ))::INTEGER
                                ELSE
                                    fs.elo_away + ROUND(k_factor * (
                                        CASE
                                            WHEN (COALESCE(f.xg_home, f.goals_home, 0) + COALESCE(f.xg_away, f.goals_away, 0)) > 0 THEN
                                                1.0 - POWER(COALESCE(f.xg_home, f.goals_home, 0) / (COALESCE(f.xg_home, f.goals_home, 0) + COALESCE(f.xg_away, f.goals_away, 0)), 1.5)
                                            ELSE 0.5
                                        END -
                                        (1.0 - (1.0 / (1.0 + POWER(10, (fs.elo_away - fs.elo_home)::DECIMAL / 400))))
                                    ))::INTEGER
                            END
                        FROM football_fixtures f
                        JOIN football_stats fs ON f.id = fs.fixture_id
                        WHERE (f.home_team_id = fixture_record.home_team_id OR f.away_team_id = fixture_record.home_team_id)
                          AND f.date < fixture_record.date
                          AND fs.elo_home IS NOT NULL
                          AND LOWER(f.status_short) IN ('ft', 'aet', 'pen')
                          AND (f.xg_home IS NOT NULL OR f.goals_home IS NOT NULL)
                        ORDER BY f.date DESC, f.id DESC
                        LIMIT 1),
                        league_base_elo
                    ) INTO home_elo;

                    INSERT INTO temp_team_elo (team_id, elo_rating)
                    VALUES (fixture_record.home_team_id, home_elo);
                ELSE
                    -- Full recalculation mode: use league base ELO
                    INSERT INTO temp_team_elo (team_id, elo_rating)
                    VALUES (fixture_record.home_team_id, league_base_elo);
                END IF;
            END IF;

            -- Get or create away team ELO
            IF NOT EXISTS (SELECT 1 FROM temp_team_elo WHERE team_id = fixture_record.away_team_id) THEN
                IF fixture_ids IS NOT NULL THEN
                    -- Get the most recent past fixture data for this team
                    SELECT COALESCE(
                        (SELECT
                            -- Calculate the POST-MATCH Elo by applying the fixture result to the pre-match Elo
                            CASE
                                WHEN f.home_team_id = fixture_record.away_team_id THEN
                                    fs.elo_home + ROUND(k_factor * (
                                        CASE
                                            WHEN (COALESCE(f.xg_home, f.goals_home, 0) + COALESCE(f.xg_away, f.goals_away, 0)) > 0 THEN
                                                POWER(COALESCE(f.xg_home, f.goals_home, 0) / (COALESCE(f.xg_home, f.goals_home, 0) + COALESCE(f.xg_away, f.goals_away, 0)), 1.5)
                                            ELSE 0.5
                                        END -
                                        (1.0 / (1.0 + POWER(10, (fs.elo_away - fs.elo_home)::DECIMAL / 400)))
                                    ))::INTEGER
                                ELSE
                                    fs.elo_away + ROUND(k_factor * (
                                        CASE
                                            WHEN (COALESCE(f.xg_home, f.goals_home, 0) + COALESCE(f.xg_away, f.goals_away, 0)) > 0 THEN
                                                1.0 - POWER(COALESCE(f.xg_home, f.goals_home, 0) / (COALESCE(f.xg_home, f.goals_home, 0) + COALESCE(f.xg_away, f.goals_away, 0)), 1.5)
                                            ELSE 0.5
                                        END -
                                        (1.0 - (1.0 / (1.0 + POWER(10, (fs.elo_away - fs.elo_home)::DECIMAL / 400))))
                                    ))::INTEGER
                            END
                        FROM football_fixtures f
                        JOIN football_stats fs ON f.id = fs.fixture_id
                        WHERE (f.home_team_id = fixture_record.away_team_id OR f.away_team_id = fixture_record.away_team_id)
                          AND f.date < fixture_record.date
                          AND fs.elo_home IS NOT NULL
                          AND LOWER(f.status_short) IN ('ft', 'aet', 'pen')
                          AND (f.xg_home IS NOT NULL OR f.goals_home IS NOT NULL)
                        ORDER BY f.date DESC, f.id DESC
                        LIMIT 1),
                        league_base_elo
                    ) INTO away_elo;

                    INSERT INTO temp_team_elo (team_id, elo_rating)
                    VALUES (fixture_record.away_team_id, away_elo);
                ELSE
                    -- Full recalculation mode: use league base ELO
                    INSERT INTO temp_team_elo (team_id, elo_rating)
                    VALUES (fixture_record.away_team_id, league_base_elo);
                END IF;
            END IF;

            -- Get current ELO ratings (before this match)
            SELECT elo_rating INTO home_elo FROM temp_team_elo WHERE team_id = fixture_record.home_team_id;
            SELECT elo_rating INTO away_elo FROM temp_team_elo WHERE team_id = fixture_record.away_team_id;

            -- Store pre-match ELO ratings for this fixture
            pre_match_home_elo := home_elo;
            pre_match_away_elo := away_elo;
            BEGIN
                -- Check if we have XG/goals data to calculate ELO changes
                IF (fixture_record.xg_home IS NOT NULL OR fixture_record.goals_home IS NOT NULL) AND LOWER(fixture_record.status_short) IN ('ft', 'aet', 'pen') THEN
                    -- We have match data, calculate ELO changes normally

                    -- Calculate expected scores using ELO formula
                    expected_home := 1.0 / (1.0 + POWER(10, (away_elo - home_elo)::DECIMAL / 400));
                    expected_away := 1.0 - expected_home;

                    -- Use XG if available, otherwise use actual goals
                    -- Convert XG to continuous score (0 to 1 range) with boost for better performance
                    actual_home_score := COALESCE(fixture_record.xg_home, fixture_record.goals_home, 0);
                    actual_away_score := COALESCE(fixture_record.xg_away, fixture_record.goals_away, 0);

                    IF (actual_home_score + actual_away_score) > 0 THEN
                        -- Boost the better team's performance by amplifying raw XG differences
                        -- This makes stronger teams even stronger: 0.9 vs 0.6 becomes 1.1 vs 0.4
                        IF actual_home_score > actual_away_score THEN
                            actual_home_score := POWER(actual_home_score, 1.1);
                            actual_away_score := POWER(actual_away_score, 0.9);
                        ELSIF actual_away_score > actual_home_score THEN
                            actual_away_score := POWER(actual_away_score, 1.1);
                            actual_home_score := POWER(actual_home_score, 0.9);
                        END IF;

                        -- Normalize to 0-1 range
                        total_score := actual_home_score + actual_away_score;
                        actual_home_score := actual_home_score / total_score;
                        actual_away_score := actual_away_score / total_score;
                    ELSE
                        -- Edge case: no XG for either team (treat as draw)
                        actual_home_score := 0.5;
                        actual_away_score := 0.5;
                    END IF;

                    -- Calculate new ELO ratings based on match performance
                    new_home_elo := home_elo + ROUND(k_factor * (actual_home_score - expected_home))::INTEGER;
                    new_away_elo := away_elo + ROUND(k_factor * (actual_away_score - expected_away))::INTEGER;

                    -- Ensure ELO doesn't go below 900 or above 3000
                    new_home_elo := GREATEST(900, LEAST(3000, new_home_elo));
                    new_away_elo := GREATEST(900, LEAST(3000, new_away_elo));

                    -- Update team ELO ratings for future matches
                    UPDATE temp_team_elo SET elo_rating = new_home_elo
                    WHERE team_id = fixture_record.home_team_id;

                    UPDATE temp_team_elo SET elo_rating = new_away_elo
                    WHERE team_id = fixture_record.away_team_id;
                END IF;
            END;

            -- Always store the PRE-MATCH ELO ratings for this fixture
            -- This ensures the stored ELO doesn't include the current match's result
            INSERT INTO football_stats (fixture_id, elo_home, elo_away)
            VALUES (fixture_record.id, pre_match_home_elo, pre_match_away_elo)
            ON CONFLICT (fixture_id) DO UPDATE SET
                elo_home = EXCLUDED.elo_home,
                elo_away = EXCLUDED.elo_away,
                updated_at = NOW();

            updated_count := updated_count + 1;
        END LOOP;

        -- Calculate league ELOs as average of PRE-MATCH team ELOs for each fixture
        -- This represents the average strength of teams that have historically played in this league
        -- Used for adjusting team performance when they move between leagues of different strengths
        RAISE NOTICE 'Calculating league ELOs...';
        UPDATE football_stats
        SET league_elo = (
            SELECT ROUND(AVG(team_elo))::INTEGER
            FROM (
                SELECT fs.elo_home as team_elo
                FROM football_stats fs
                JOIN football_fixtures f ON fs.fixture_id = f.id
                WHERE f.league_id = (
                    SELECT ff.league_id
                    FROM football_fixtures ff
                    WHERE ff.id = football_stats.fixture_id
                )
                AND f.date < (
                    SELECT fff.date
                    FROM football_fixtures fff
                    WHERE fff.id = football_stats.fixture_id
                )
                AND fs.elo_home IS NOT NULL
                UNION ALL
                SELECT fs.elo_away as team_elo
                FROM football_stats fs
                JOIN football_fixtures f ON fs.fixture_id = f.id
                WHERE f.league_id = (
                    SELECT ff.league_id
                    FROM football_fixtures ff
                    WHERE ff.id = football_stats.fixture_id
                )
                AND f.date < (
                    SELECT fff.date
                    FROM football_fixtures fff
                    WHERE fff.id = football_stats.fixture_id
                )
                AND fs.elo_away IS NOT NULL
            ) team_elos
        )
        WHERE (fixture_ids IS NULL OR football_stats.fixture_id = ANY(fixture_ids));

        -- Clean up temporary tables (will be auto-dropped at end of session anyway)
        DROP TABLE IF EXISTS temp_team_elo;

        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to calculate adjusted rolling xG and xGA using rolling windows (8, 16, 32 matches averaged)
    CREATE OR REPLACE FUNCTION populate_adjusted_rolling_xg_batch(fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
    -- Updated to require at least 5 past fixtures WITH league-specific filtering
    -- For League matches: only same-country League matches count toward the 5-match threshold
    -- For Cup matches: ALL matches count toward the 5-match threshold
    DECLARE
        updated_count INTEGER;
    BEGIN
        -- Single batch update using window functions for maximum performance
        -- BOTH teams must individually have at least 5 past fixtures (with filtering) to get adjusted rolling calculations
        WITH fixture_data AS (
        -- First function: populate_adjusted_rolling_xg_batch
            -- Get all fixtures that need calculation
            -- Requires minimum 5 past fixtures for adjusted rolling calculations
            SELECT
                f.id as fixture_id,
                f.home_team_id,
                f.away_team_id,
                f.league_id,
                f.date as fixture_date,
                fl.type as league_type,
                fl.country as league_country,
                fs.elo_home as current_home_elo,
                fs.elo_away as current_away_elo,
                fs.league_elo as current_league_elo,
                fs.home_advantage as league_home_advantage,
                fs.avg_goals_league as current_league_avg_goals
            FROM (
                SELECT * FROM football_fixtures
                WHERE (fixture_ids IS NULL OR id = ANY(fixture_ids))
            ) f
            JOIN football_stats fs ON f.id = fs.fixture_id
            JOIN football_leagues fl ON f.league_id = fl.id
            WHERE fs.elo_home IS NOT NULL AND fs.elo_away IS NOT NULL
                  AND fs.league_elo IS NOT NULL AND fs.home_advantage IS NOT NULL
                  AND fs.avg_goals_league IS NOT NULL
        ),
        team_match_counts AS (
            -- Count past matches for each team WITH league-specific filtering for the 5-match threshold
            -- For League matches: only count same-country League matches
            -- For Cup matches: count ALL matches
            SELECT
                fd.fixture_id,
                fd.home_team_id,
                fd.away_team_id,
                COUNT(DISTINCT CASE WHEN pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id THEN pf.id END) as home_team_total_matches,
                COUNT(DISTINCT CASE WHEN pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id THEN pf.id END) as away_team_total_matches
            FROM fixture_data fd
            CROSS JOIN LATERAL (
                SELECT pf.id, pf.home_team_id, pf.away_team_id
                FROM football_fixtures pf
                LEFT JOIN football_leagues pl ON pf.league_id = pl.id
                WHERE (pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id
                       OR pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id)
                  AND pf.date < fd.fixture_date
                  AND pf.date >= fd.fixture_date - INTERVAL '1 year'
                  AND LOWER(pf.status_short) IN ('ft', 'aet', 'pen', 'live', '1h', 'ht', '2h', 'et', 'bt', 'p', 'susp', 'int')
                  -- Apply league-specific filtering: Cup matches include all, League matches only same-country League
                  AND (fd.league_type != 'League' OR (pl.country = fd.league_country AND pl.type = 'League'))
            ) pf
            GROUP BY fd.fixture_id, fd.home_team_id, fd.away_team_id
        ),
        all_past_matches AS (
            -- Get past matches for XG calculations (with league-specific filtering)
            -- Only include fixtures where both teams have at least 5 total past matches
            -- EARLY FILTERING: Skip fixtures that don't meet threshold to avoid expensive calculations
            SELECT
                fd.fixture_id,
                fd.home_team_id,
                fd.away_team_id,
                fd.fixture_date,
                fd.league_id,
                fd.league_type,
                fd.league_country,
                fd.current_home_elo,
                fd.current_away_elo,
                fd.current_league_elo,
                fd.league_home_advantage,
                fd.current_league_avg_goals,
                -- Past match data
                pm.id as past_match_id,
                pm.date as past_date,
                pm.league_id as past_league_id,
                pm.home_team_id as past_home_team_id,
                pm.away_team_id as past_away_team_id,
                GREATEST(0.1, LEAST(5, COALESCE(pm.xg_home, pm.goals_home, 0))) as past_xg_home,
                GREATEST(0.1, LEAST(5, COALESCE(pm.xg_away, pm.goals_away, 0))) as past_xg_away,
                pms.elo_home as past_elo_home,
                pms.elo_away as past_elo_away,
                pms.league_elo as past_league_elo,
                pms.avg_goals_league as past_league_avg_goals,
                pms.home_advantage as past_league_home_advantage
            FROM fixture_data fd
            JOIN team_match_counts tmc ON fd.fixture_id = tmc.fixture_id
                                       AND tmc.home_team_total_matches >= 5
                                       AND tmc.away_team_total_matches >= 5
            -- Cross join with past matches using league-specific filtering
            CROSS JOIN LATERAL (
                SELECT pf.id, pf.date, pf.league_id, pf.home_team_id, pf.away_team_id, pf.xg_home, pf.xg_away, pf.goals_home, pf.goals_away
                FROM football_fixtures pf
                LEFT JOIN football_leagues pl ON pf.league_id = pl.id
                WHERE (pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id
                       OR pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id)
                  AND pf.date < fd.fixture_date
                  AND pf.date >= fd.fixture_date - INTERVAL '1 year'
                  AND LOWER(pf.status_short) IN ('ft', 'aet', 'pen', 'live', '1h', 'ht', '2h', 'et', 'bt', 'p', 'susp', 'int')
                  -- Conditional filtering based on league type
                  -- For League matches: only include past League matches from same country
                  -- For Cup/other matches: include ALL past matches
                  AND (fd.league_type != 'League' OR (pl.country = fd.league_country AND pl.type = 'League'))
                ORDER BY pf.date DESC
                LIMIT 32
            ) pm
            JOIN football_stats pms ON pm.id = pms.fixture_id
            WHERE pms.elo_home IS NOT NULL AND pms.elo_away IS NOT NULL AND pms.league_elo IS NOT NULL
                  AND pms.avg_goals_league IS NOT NULL
        ),
        calculated_adjustments AS (
            -- Calculate adjusted xG for each past match from both home and away perspectives
            SELECT
                apm.fixture_id,
                apm.past_match_id,
                -- Home team perspective
                CASE
                    WHEN apm.past_home_team_id = apm.home_team_id THEN
                        -- Home team was home in this past match - PENALIZE xG, BENEFIT xGA
                        apm.past_xg_home * (
                        POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                        (GREATEST(apm.past_elo_away, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (apm.league_home_advantage / 2.0)
                    ELSE
                        -- Home team was away in this past match - BENEFIT xG, PENALIZE xGA
                        apm.past_xg_away * (
                        POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                        (GREATEST(apm.past_elo_home, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (apm.league_home_advantage / 2.0)
                END as home_team_adjusted_xg,

                CASE
                    WHEN apm.past_home_team_id = apm.home_team_id THEN
                        -- Home team's xGA when they were home - PENALIZE defense
                        apm.past_xg_away / (
                            POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                            (GREATEST(apm.past_elo_home, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (apm.league_home_advantage / 2.0)
                    ELSE
                        -- Home team's xGA when they were away - BENEFIT defense
                        apm.past_xg_home / (
                            POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                            (GREATEST(apm.past_elo_away, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (apm.league_home_advantage / 2.0)
                END as home_team_adjusted_xga,

                -- Away team perspective
                CASE
                    WHEN apm.past_home_team_id = apm.away_team_id THEN
                        -- Away team was home in this past match - PENALIZE xG, BENEFIT xGA
                        apm.past_xg_home * (
                        POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                        (GREATEST(apm.past_elo_away, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (apm.league_home_advantage / 2.0)
                    ELSE
                        -- Away team was away in this past match - BENEFIT xG, PENALIZE xGA
                        apm.past_xg_away * (
                        POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                        (GREATEST(apm.past_elo_home, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000)) *
                        CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END 
                        ) +
                        (past_league_home_advantage / 2.0)
                END as away_team_adjusted_xg,

                CASE
                    WHEN apm.past_home_team_id = apm.away_team_id THEN
                        -- Away team's xGA when they were home - PENALIZE defense
                        apm.past_xg_away / (
                            POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                            (GREATEST(apm.past_elo_home, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (apm.league_home_advantage / 2.0)
                    ELSE
                        -- Away team's xGA when they were away - BENEFIT defense
                        apm.past_xg_home / (
                            POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                            (GREATEST(apm.past_elo_away, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (apm.league_home_advantage / 2.0)
                END as away_team_adjusted_xga,

                -- Match recency ranking (1 = most recent for this team)
                ROW_NUMBER() OVER (PARTITION BY apm.fixture_id, CASE WHEN apm.past_home_team_id = apm.home_team_id OR apm.past_away_team_id = apm.home_team_id THEN apm.home_team_id ELSE apm.away_team_id END ORDER BY apm.past_date DESC) as match_rank,
                -- Which team this match belongs to
                CASE WHEN apm.past_home_team_id = apm.home_team_id OR apm.past_away_team_id = apm.home_team_id THEN 'home' ELSE 'away' END as team_side
            FROM all_past_matches apm
        ),
        aggregated_xg AS (
            -- Calculate 16-match rolling window
            -- NO default values - if insufficient data, HAVING clause filters out the entire fixture
             SELECT
                fixture_id,
                -- Home team rolling windows averaged (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND((
                    -- 8-match window
                    (SUM(CASE WHEN team_side = 'home' AND match_rank <= 8 THEN home_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 8 THEN 1 END), 0)) +
                    -- 16-match window
                    (SUM(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN home_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN 1 END), 0)) +
                    -- 32-match window
                    (SUM(CASE WHEN team_side = 'home' AND match_rank <= 32 THEN home_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 32 THEN 1 END), 0))
                ) / 3.0, 2))) as home_xg,

                -- Home team rolling windows xGA averaged (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND((
                    -- 8-match window
                    (SUM(CASE WHEN team_side = 'home' AND match_rank <= 8 THEN home_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 8 THEN 1 END), 0)) +
                    -- 16-match window
                    (SUM(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN home_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN 1 END), 0)) +
                    -- 32-match window
                    (SUM(CASE WHEN team_side = 'home' AND match_rank <= 32 THEN home_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 32 THEN 1 END), 0))
                ) / 3.0, 2))) as home_xga,

                -- Away team rolling windows averaged (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND((
                    -- 8-match window
                    (SUM(CASE WHEN team_side = 'away' AND match_rank <= 8 THEN away_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 8 THEN 1 END), 0)) +
                    -- 16-match window
                    (SUM(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN away_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN 1 END), 0)) +
                    -- 32-match window
                    (SUM(CASE WHEN team_side = 'away' AND match_rank <= 32 THEN away_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 32 THEN 1 END), 0))
                ) / 3.0, 2))) as away_xg,

                -- Away team rolling windows xGA averaged (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND((
                    -- 8-match window
                    (SUM(CASE WHEN team_side = 'away' AND match_rank <= 8 THEN away_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 8 THEN 1 END), 0)) +
                    -- 16-match window
                    (SUM(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN away_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN 1 END), 0)) +
                    -- 32-match window
                    (SUM(CASE WHEN team_side = 'away' AND match_rank <= 32 THEN away_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 32 THEN 1 END), 0))
                ) / 3.0, 2))) as away_xga
            FROM calculated_adjustments
            GROUP BY fixture_id
            -- Only include fixtures where both teams have at least 5 past matches
            HAVING COUNT(CASE WHEN team_side = 'home' THEN 1 END) >= 5 
               AND COUNT(CASE WHEN team_side = 'away' THEN 1 END) >= 5
        )
        UPDATE football_stats
        SET
            adjusted_rolling_xg_home = ax.home_xg,
            adjusted_rolling_xga_home = ax.home_xga,
            adjusted_rolling_xg_away = ax.away_xg,
            adjusted_rolling_xga_away = ax.away_xga,
            updated_at = NOW()
        FROM aggregated_xg ax
        WHERE football_stats.fixture_id = ax.fixture_id;

        -- Return count of updated fixtures
        GET DIAGNOSTICS updated_count = ROW_COUNT;
        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to calculate adjusted rolling market xG and xGA using 16 match rolling window
    CREATE OR REPLACE FUNCTION populate_adjusted_rolling_market_xg_batch(fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
    -- Updated to require at least 5 past fixtures WITH league-specific filtering
    -- For League matches: only same-country League matches count toward the 5-match threshold
    -- For Cup matches: ALL matches count toward the 5-match threshold
    DECLARE
        updated_count INTEGER;
    BEGIN
        -- Single batch update using window functions for maximum performance
        -- BOTH teams must individually have at least 5 past fixtures (with filtering) to get adjusted rolling calculations
        WITH fixture_data AS (
            -- Get all fixtures that need calculation
            SELECT
                f.id as fixture_id,
                f.home_team_id,
                f.away_team_id,
                f.league_id,
                f.date as fixture_date,
                fl.type as league_type,
                fl.country as league_country,
                fs.elo_home as current_home_elo,
                fs.elo_away as current_away_elo,
                fs.league_elo as current_league_elo,
                fs.home_advantage as league_home_advantage,
                fs.avg_goals_league as current_league_avg_goals
            FROM (
                SELECT * FROM football_fixtures
                WHERE (fixture_ids IS NULL OR id = ANY(fixture_ids))
            ) f
            JOIN football_stats fs ON f.id = fs.fixture_id
            JOIN football_leagues fl ON f.league_id = fl.id
            WHERE fs.elo_home IS NOT NULL AND fs.elo_away IS NOT NULL
                  AND fs.league_elo IS NOT NULL AND fs.home_advantage IS NOT NULL
                  AND fs.avg_goals_league IS NOT NULL
        ),
        team_match_counts AS (
            -- Count past matches for each team WITH league-specific filtering for the 5-match threshold
            -- For League matches: only count same-country League matches
            -- For Cup matches: count ALL matches
            SELECT
                fd.fixture_id,
                fd.home_team_id,
                fd.away_team_id,
                COUNT(DISTINCT CASE WHEN pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id THEN pf.id END) as home_team_total_matches,
                COUNT(DISTINCT CASE WHEN pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id THEN pf.id END) as away_team_total_matches
            FROM fixture_data fd
            CROSS JOIN LATERAL (
                SELECT pf.id, pf.home_team_id, pf.away_team_id
                FROM football_fixtures pf
                LEFT JOIN football_leagues pl ON pf.league_id = pl.id
                WHERE (pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id
                       OR pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id)
                  AND pf.date < fd.fixture_date
                  AND pf.date >= fd.fixture_date - INTERVAL '1 year'
                  AND LOWER(pf.status_short) IN ('ft', 'aet', 'pen', 'live', '1h', 'ht', '2h', 'et', 'bt', 'p', 'susp', 'int')
                  -- Apply league-specific filtering: Cup matches include all, League matches only same-country League
                  AND (fd.league_type != 'League' OR (pl.country = fd.league_country AND pl.type = 'League'))
            ) pf
            GROUP BY fd.fixture_id, fd.home_team_id, fd.away_team_id
        ),
        all_past_matches AS (
            -- Get past matches for XG calculations (with league-specific filtering)
            -- Only include fixtures where both teams have at least 5 total past matches
            SELECT
                fd.fixture_id,
                fd.home_team_id,
                fd.away_team_id,
                fd.fixture_date,
                fd.league_id,
                fd.league_type,
                fd.league_country,
                fd.current_home_elo,
                fd.current_away_elo,
                fd.current_league_elo,
                fd.league_home_advantage,
                fd.current_league_avg_goals,
                -- Past match data
                pm.id as past_match_id,
                pm.date as past_date,
                pm.league_id as past_league_id,
                pm.home_team_id as past_home_team_id,
                pm.away_team_id as past_away_team_id,
                GREATEST(0.1, LEAST(5, COALESCE(pm.market_xg_home, pm.xg_home, pm.goals_home, 0))) as past_xg_home,
                GREATEST(0.1, LEAST(5, COALESCE(pm.market_xg_away, pm.xg_away, pm.goals_away, 0))) as past_xg_away,
                pms.elo_home as past_elo_home,
                pms.elo_away as past_elo_away,
                pms.league_elo as past_league_elo,
                pms.avg_goals_league as past_league_avg_goals,
                pms.home_advantage as past_league_home_advantage
            FROM fixture_data fd
            JOIN team_match_counts tmc ON fd.fixture_id = tmc.fixture_id
                                       AND tmc.home_team_total_matches >= 5
                                       AND tmc.away_team_total_matches >= 5
            -- Cross join with past matches using league-specific filtering
            CROSS JOIN LATERAL (
                SELECT pf.id, pf.date, pf.league_id, pf.home_team_id, pf.away_team_id, pf.xg_home, pf.xg_away, pf.goals_home, pf.goals_away, pf.market_xg_home, pf.market_xg_away
                FROM football_fixtures pf
                LEFT JOIN football_leagues pl ON pf.league_id = pl.id
                WHERE (pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id
                       OR pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id)
                  AND pf.date < fd.fixture_date
                  AND pf.date >= fd.fixture_date - INTERVAL '1 year'
                  AND LOWER(pf.status_short) IN ('ft', 'aet', 'pen', 'live', '1h', 'ht', '2h', 'et', 'bt', 'p', 'susp', 'int')
                  -- Conditional filtering based on league type
                  -- For League matches: only include past League matches from same country
                  -- For Cup/other matches: include ALL past matches
                  AND (fd.league_type != 'League' OR (pl.country = fd.league_country AND pl.type = 'League'))
                ORDER BY pf.date DESC
                LIMIT 32
            ) pm
            JOIN football_stats pms ON pm.id = pms.fixture_id
            WHERE pms.elo_home IS NOT NULL AND pms.elo_away IS NOT NULL AND pms.league_elo IS NOT NULL
                  AND pms.avg_goals_league IS NOT NULL
        ),
        calculated_adjustments AS (
            -- Calculate adjusted xG for each past match from both home and away perspectives
            SELECT
                apm.fixture_id,
                apm.past_match_id,
                -- Home team perspective
                CASE
                    WHEN apm.past_home_team_id = apm.home_team_id THEN
                        -- Home team was home in this past match - PENALIZE xG, BENEFIT xGA
                        apm.past_xg_home * (
                        POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                        (GREATEST(apm.past_elo_away, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (apm.league_home_advantage / 2.0)
                    ELSE
                        -- Home team was away in this past match - BENEFIT xG, PENALIZE xGA
                        apm.past_xg_away * (
                        POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                        (GREATEST(apm.past_elo_home, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (apm.league_home_advantage / 2.0)
                END as home_team_adjusted_xg,

                CASE
                    WHEN apm.past_home_team_id = apm.home_team_id THEN
                        -- Home team's xGA when they were home - PENALIZE defense
                        apm.past_xg_away / (
                            POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                            (GREATEST(apm.past_elo_home, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (apm.league_home_advantage / 2.0)
                    ELSE
                        -- Home team's xGA when they were away - BENEFIT defense
                        apm.past_xg_home / (
                            POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                            (GREATEST(apm.past_elo_away, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (apm.league_home_advantage / 2.0)
                END as home_team_adjusted_xga,

                -- Away team perspective
                CASE
                    WHEN apm.past_home_team_id = apm.away_team_id THEN
                        -- Away team was home in this past match - PENALIZE xG, BENEFIT xGA
                        apm.past_xg_home * (
                        POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                        (GREATEST(apm.past_elo_away, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (apm.league_home_advantage / 2.0)
                    ELSE
                        -- Away team was away in this past match - BENEFIT xG, PENALIZE xGA
                        apm.past_xg_away * (
                        POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                        (GREATEST(apm.past_elo_home, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000)) *
                        CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END 
                        ) +
                        (past_league_home_advantage / 2.0)
                END as away_team_adjusted_xg,

                CASE
                    WHEN apm.past_home_team_id = apm.away_team_id THEN
                        -- Away team's xGA when they were home - PENALIZE defense
                        apm.past_xg_away / (
                            POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                            (GREATEST(apm.past_elo_home, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (apm.league_home_advantage / 2.0)
                    ELSE
                        -- Away team's xGA when they were away - BENEFIT defense
                        apm.past_xg_home / (
                            POWER((GREATEST(apm.past_league_elo, 1000)::DECIMAL / GREATEST(apm.current_league_elo, 1000)), 2) *
                            (GREATEST(apm.past_elo_away, 1000)::DECIMAL / GREATEST(apm.past_league_elo, 1000))
                        ) * CASE WHEN apm.past_league_id != apm.league_id THEN (apm.current_league_avg_goals / GREATEST(apm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (apm.league_home_advantage / 2.0)
                END as away_team_adjusted_xga,

                -- Match recency ranking (1 = most recent for this team)
                ROW_NUMBER() OVER (PARTITION BY apm.fixture_id, CASE WHEN apm.past_home_team_id = apm.home_team_id OR apm.past_away_team_id = apm.home_team_id THEN apm.home_team_id ELSE apm.away_team_id END ORDER BY apm.past_date DESC) as match_rank,
                -- Which team this match belongs to
                CASE WHEN apm.past_home_team_id = apm.home_team_id OR apm.past_away_team_id = apm.home_team_id THEN 'home' ELSE 'away' END as team_side
            FROM all_past_matches apm
        ),
        aggregated_xg AS (
            -- Calculate 16-match rolling window
            -- NO default values - if insufficient data, HAVING clause filters out the entire fixture
            SELECT
                fixture_id,
                -- Home team 16-match rolling window (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND(
                    SUM(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN home_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN 1 END), 0), 2))) as home_xg,

                -- Home team 16-match rolling window xGA (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND(
                    SUM(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN home_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN 1 END), 0), 2))) as home_xga,

                -- Away team 16-match rolling window (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND(
                    SUM(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN away_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN 1 END), 0), 2))) as away_xg,

                -- Away team 16-match rolling window xGA (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND(
                    SUM(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN away_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN 1 END), 0), 2))) as away_xga
            FROM calculated_adjustments
            GROUP BY fixture_id
            -- Only include fixtures where both teams have at least 5 past matches
            HAVING COUNT(CASE WHEN team_side = 'home' THEN 1 END) >= 5
               AND COUNT(CASE WHEN team_side = 'away' THEN 1 END) >= 5
        )
        UPDATE football_stats
        SET
            adjusted_rolling_market_xg_home = ax.home_xg,
            adjusted_rolling_market_xga_home = ax.home_xga,
            adjusted_rolling_market_xg_away = ax.away_xg,
            adjusted_rolling_market_xga_away = ax.away_xga,
            updated_at = NOW()
        FROM aggregated_xg ax
        WHERE football_stats.fixture_id = ax.fixture_id;

        -- Return count of updated fixtures
        GET DIAGNOSTICS updated_count = ROW_COUNT;
        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;


    -- Main function to populate all fixture statistics
    CREATE OR REPLACE FUNCTION populate_all_fixture_stats(calc_num INTEGER DEFAULT 0, fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
    DECLARE
        total_count INTEGER := 0;
        hours_count INTEGER;
        goals_count INTEGER;
        home_advantage_count INTEGER;
        elo_count INTEGER;
        xg_count INTEGER;
        market_xg_count INTEGER;
    BEGIN
        -- Set statement timeout to prevent infinite execution (5 minutes max)
        PERFORM set_config('statement_timeout', '300000', true);

        -- Calculate all statistics
        RAISE NOTICE 'Starting hours calculation...';
        SELECT populate_hours_batch(fixture_ids) INTO hours_count;
        RAISE NOTICE 'Hours calculation completed: %', hours_count;

        RAISE NOTICE 'Starting goals calculation...';
        SELECT populate_league_goals_batch(fixture_ids) INTO goals_count;
        RAISE NOTICE 'Goals calculation completed: %', goals_count;

        RAISE NOTICE 'Starting home advantage calculation...';
        SELECT populate_home_advantage_batch(fixture_ids) INTO home_advantage_count;
        RAISE NOTICE 'Home advantage calculation completed: %', home_advantage_count;

        RAISE NOTICE 'Starting ELO calculations (team + league)...';
        SELECT calculate_elos_incremental(fixture_ids) INTO elo_count;
        RAISE NOTICE 'ELO calculations completed: %', elo_count;

        RAISE NOTICE 'Starting rolling windows xG calculations...';
        SELECT populate_adjusted_rolling_xg_batch(fixture_ids) INTO xg_count;
        RAISE NOTICE 'Rolling windows xG calculations completed: %', xg_count;

        -- Note: Base market XG (Dixon-Coles) is calculated in JavaScript before this function is called
        -- This only calculates rolling windows of market XG
        RAISE NOTICE 'Starting rolling windows market xG calculations...';
        SELECT populate_adjusted_rolling_market_xg_batch(fixture_ids) INTO market_xg_count;
        RAISE NOTICE 'Rolling windows market xG calculations completed: %', market_xg_count;


        RETURN GREATEST(hours_count, goals_count, home_advantage_count, elo_count, xg_count, market_xg_count);
    END;
    $$ LANGUAGE plpgsql;

    -- ============================================
    -- TRIGGERS FOR AUTOMATIC TIMESTAMPS AND NOTIFICATIONS
    -- ============================================

    -- Function to update updated_at column for football_odds
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_set_updated_at ON football_odds;
    CREATE TRIGGER trg_set_updated_at
    BEFORE UPDATE ON football_odds
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Function to notify SSE listeners when odds are updated
    CREATE OR REPLACE FUNCTION notify_odds_update() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('odds_updates', NEW.fixture_id::text);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_notify_odds_update ON football_odds;
    CREATE TRIGGER trg_notify_odds_update
    AFTER INSERT OR UPDATE ON football_odds
    FOR EACH ROW EXECUTE FUNCTION notify_odds_update();

    -- Function to notify SSE listeners when fixtures are updated
    CREATE OR REPLACE FUNCTION notify_fixture_update() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('fixture_update_' || NEW.id::text, '');
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_notify_fixture_update ON football_fixtures;
    CREATE TRIGGER trg_notify_fixture_update
    AFTER INSERT OR UPDATE ON football_fixtures
    FOR EACH ROW EXECUTE FUNCTION notify_fixture_update();

    -- Function to update updated_at column
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ language 'plpgsql';

    -- Apply updated_at triggers to all relevant tables
    DROP TRIGGER IF EXISTS update_football_fixtures_updated_at ON football_fixtures;
    CREATE TRIGGER update_football_fixtures_updated_at
        BEFORE UPDATE ON football_fixtures
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_football_odds_updated_at ON football_odds;
    CREATE TRIGGER update_football_odds_updated_at
        BEFORE UPDATE ON football_odds
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    -- Trigger for football_predictions will be created after table creation

    DROP TRIGGER IF EXISTS update_football_stats_updated_at ON football_stats;
    CREATE TRIGGER update_football_stats_updated_at
        BEFORE UPDATE ON football_stats
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_football_initial_league_elos_updated_at ON football_initial_league_elos;
    CREATE TRIGGER update_football_initial_league_elos_updated_at
        BEFORE UPDATE ON football_initial_league_elos
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    -- Trigger to update all calculated odds tables when odds change
    CREATE OR REPLACE FUNCTION update_calculated_odds_data() RETURNS TRIGGER AS $$
    DECLARE
        fixture_id BIGINT;
    BEGIN
        -- Handle INSERT/UPDATE vs DELETE operations
        fixture_id := COALESCE(NEW.fixture_id, OLD.fixture_id);

        -- Update all calculated tables for this fixture
        PERFORM update_fair_odds_for_fixture(fixture_id);

        -- Return appropriate value for AFTER trigger
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_update_calculated_odds ON football_odds;
    CREATE TRIGGER trg_update_calculated_odds
        AFTER INSERT OR UPDATE OR DELETE ON football_odds
        FOR EACH ROW EXECUTE FUNCTION update_calculated_odds_data();
    `;

    await pool.query(sql);

    // Parse command line arguments
    const args = process.argv.slice(2);
    let functionsToRun = ['all']; // default to all
    let fixtureIds = null;
    let createViews = false;

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--fixture-ids' || arg === '--fixtures') {
        fixtureIds = args[i + 1]?.split(/[,\s]+/).map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        i++; // skip next arg
      } else if (arg.startsWith('--fixture-ids=') || arg.startsWith('--fixtures=')) {
        const value = arg.split('=')[1];
        // Handle both comma-separated and space-separated values
        fixtureIds = value?.split(/[,\s]+/).map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      } else if (arg === '--views') {
        createViews = true;
      } else if (!arg.startsWith('--')) {
        // Support comma-separated function numbers like "2,5,6"
        functionsToRun = arg.split(',').map(f => f.trim());
      }
    }

    // Validate fixture IDs if provided
    if (fixtureIds && fixtureIds.length === 0) {
      console.error('❌ Error: --fixture-ids requires valid fixture ID numbers');
      process.exit(1);
    }

    if (fixtureIds && fixtureIds.length > 0) {
      console.log(`🎯 Processing ${fixtureIds.length} specific fixture(s): ${fixtureIds.join(', ')}`);
    } else {
      console.log('📊 Processing all fixtures');
    }

    if (createViews) {
        // Create football_predictions table if it doesn't exist
        console.log('📝 Creating football_predictions table if needed...');
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS football_predictions (
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

                -- Create indexes for football_predictions table
                CREATE INDEX IF NOT EXISTS idx_football_predictions_created_at ON football_predictions (created_at);

                -- Create trigger for football_predictions
                DROP TRIGGER IF EXISTS update_football_predictions_updated_at ON football_predictions;
                CREATE TRIGGER update_football_predictions_updated_at
                    BEFORE UPDATE ON football_predictions
                    FOR EACH ROW
                    EXECUTE FUNCTION update_updated_at_column();
            `);
            console.log('✅ football_predictions table created/verified');
        } catch (predictionsError) {
            console.error('❌ Error creating football_predictions table:', predictionsError.message);
            throw predictionsError;
        }

        // Create football_stats table if it doesn't exist
        console.log('📝 Creating football_stats table if needed...');
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS football_stats (
                    fixture_id BIGINT PRIMARY KEY,

                    -- Hours since last match
                    hours_since_last_match_home INTEGER,
                    hours_since_last_match_away INTEGER,

                    -- League statistics
                    avg_goals_league DECIMAL(4,2),
                    home_advantage DECIMAL(3,2),

                    -- ELO ratings
                    elo_home INTEGER,
                    elo_away INTEGER,
                    league_elo INTEGER,

                    -- Adjusted rolling xG and xGA columns (average of 8, 16, 32 match rolling windows)
                    adjusted_rolling_xg_home DECIMAL(4,2),
                    adjusted_rolling_xga_home DECIMAL(4,2),
                    adjusted_rolling_xg_away DECIMAL(4,2),
                    adjusted_rolling_xga_away DECIMAL(4,2),
                    adjusted_rolling_market_xg_home DECIMAL(4,2),
                    adjusted_rolling_market_xga_home DECIMAL(4,2),
                    adjusted_rolling_market_xg_away DECIMAL(4,2),
                    adjusted_rolling_market_xga_away DECIMAL(4,2),

                    -- Metadata
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),

                    FOREIGN KEY (fixture_id) REFERENCES football_fixtures(id) ON DELETE CASCADE
                );

                -- Create indexes for football_stats table
                CREATE INDEX IF NOT EXISTS idx_football_stats_elos ON football_stats (elo_home, elo_away, league_elo);
                CREATE INDEX IF NOT EXISTS idx_football_stats_xg ON football_stats (adjusted_rolling_xg_home, adjusted_rolling_xga_home, adjusted_rolling_xg_away, adjusted_rolling_xga_away);
            `);
            console.log('✅ football_stats table created/verified');
        } catch (createError) {
            console.error('❌ Error creating football_stats table:', createError.message);
            throw createError;
        }

        // Check if columns exist, if not add them
        console.log('🔍 Checking table structure...');
        try {
            await pool.query('SELECT hours_since_last_match_home, avg_goals_league, elo_home, elo_away, league_elo, home_advantage, adjusted_rolling_xg_home, adjusted_rolling_market_xg_home FROM football_stats LIMIT 1');
            console.log('✅ All columns exist');
        } catch (error) {
            console.log('📝 Adding missing columns...');
            try {
                await pool.query(`
                    ALTER TABLE football_stats
                    ADD COLUMN IF NOT EXISTS hours_since_last_match_home INTEGER,
                    ADD COLUMN IF NOT EXISTS hours_since_last_match_away INTEGER,
                    ADD COLUMN IF NOT EXISTS avg_goals_league DECIMAL(4,2),
                    ADD COLUMN IF NOT EXISTS elo_home INTEGER,
                    ADD COLUMN IF NOT EXISTS elo_away INTEGER,
                    ADD COLUMN IF NOT EXISTS league_elo INTEGER,
                    ADD COLUMN IF NOT EXISTS home_advantage DECIMAL(3,2),

                    -- Adjusted rolling xG and xGA columns (average of 8, 16, 32 match rolling windows)
                    ADD COLUMN IF NOT EXISTS adjusted_rolling_xg_home DECIMAL(4,2),
                    ADD COLUMN IF NOT EXISTS adjusted_rolling_xga_home DECIMAL(4,2),
                    ADD COLUMN IF NOT EXISTS adjusted_rolling_xg_away DECIMAL(4,2),
                    ADD COLUMN IF NOT EXISTS adjusted_rolling_xga_away DECIMAL(4,2),
                    ADD COLUMN IF NOT EXISTS adjusted_rolling_market_xg_home DECIMAL(4,2),
                    ADD COLUMN IF NOT EXISTS adjusted_rolling_market_xga_home DECIMAL(4,2),
                    ADD COLUMN IF NOT EXISTS adjusted_rolling_market_xg_away DECIMAL(4,2),
                    ADD COLUMN IF NOT EXISTS adjusted_rolling_market_xga_away DECIMAL(4,2)
                `);
                console.log('✅ Columns added successfully');
            } catch (alterError) {
                console.error('❌ Error adding columns:', alterError.message);
                throw alterError;
            }

        }

        // Create calculated odds tables
        console.log('📝 Creating calculated odds tables...');
        try {
            const tablesSQL = `

                -- Fair odds table - stores fair odds calculations per fixture/bookie combination
                CREATE TABLE IF NOT EXISTS football_fair_odds (
                    fixture_id BIGINT,
                    bookie VARCHAR(100),
                    decimals INTEGER,

                    fair_odds_x12 JSONB,
                    fair_odds_ah JSONB,
                    fair_odds_ou JSONB,
                    lines JSONB,
                    latest_t JSONB,

                    updated_at TIMESTAMP DEFAULT NOW(),

                    PRIMARY KEY (fixture_id, bookie),
                    FOREIGN KEY (fixture_id) REFERENCES football_fixtures(id) ON DELETE CASCADE
                );
            `;
            await pool.query(tablesSQL);
            console.log('✅ Calculated odds tables created');
        } catch (error) {
            console.error('❌ Error creating tables:', error.message);
            throw error;
        }

        // Create update functions
        console.log('📝 Creating update functions...');
        try {
            const functionsSQL = `


                -- Function to update fair odds for a fixture (only update when odds are available and valid)
                CREATE OR REPLACE FUNCTION update_fair_odds_for_fixture(p_fixture_id BIGINT) RETURNS VOID AS $$
                BEGIN
                    -- Insert or update fair odds only when odds data is available and valid
                    -- This preserves existing fair odds when bookmaker odds become empty/unavailable
                    INSERT INTO football_fair_odds (fixture_id, bookie, decimals, fair_odds_x12, fair_odds_ah, fair_odds_ou, lines, latest_t)
                    SELECT
                        fo.fixture_id,
                        fo.bookie,
                        fo.decimals,

                        -- Fair X12 odds - uses most recent valid historical odds (looks past 3 odds)
                        CASE
                            WHEN fo.odds_x12 IS NOT NULL THEN
                                -- Find most recent valid X12 odds (checking last 3 entries)
                                (
                                    SELECT
                                        CASE
                                            WHEN valid_odds.x12_array IS NOT NULL THEN
                                                CASE
                                                    WHEN 1.0 / (
                                                        SELECT SUM(1.0 / (elem::numeric / POWER(10, fo.decimals)))
                                                        FROM jsonb_array_elements_text(valid_odds.x12_array) elem
                                                        WHERE elem::numeric > 0
                                                    ) >= 0.92 THEN
                                                        (
                                                            SELECT jsonb_agg(
                                                                ROUND(
                                                                    (
                                                                        3.0 * (x12_odds::numeric / POWER(10, fo.decimals)) /
                                                                        (
                                                                            3.0 - (
                                                                                (
                                                                                    SELECT SUM(1.0 / (elem::numeric / POWER(10, fo.decimals)))
                                                                                    FROM jsonb_array_elements_text(valid_odds.x12_array) elem
                                                                                    WHERE elem::numeric > 0
                                                                                ) - 1.0
                                                                            ) * (x12_odds::numeric / POWER(10, fo.decimals))
                                                                        )
                                                                    ) * POWER(10, fo.decimals)
                                                                )::integer
                                                                ORDER BY x12_idx
                                                            )
                                                            FROM jsonb_array_elements_text(valid_odds.x12_array) WITH ORDINALITY x12(x12_odds, x12_idx)
                                                            WHERE x12_idx <= 3 AND x12_odds::numeric > 0
                                                        )
                                                    ELSE NULL
                                                END
                                            ELSE NULL
                                        END
                                    FROM (
                                        SELECT
                                            CASE
                                                WHEN jsonb_array_length((fo.odds_x12->-1)->'x12') > 0 AND
                                                     EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_x12->-1->>'x12')::jsonb) elem WHERE elem::numeric > 0)
                                                THEN (fo.odds_x12->-1->>'x12')::jsonb
                                                WHEN jsonb_array_length((fo.odds_x12->-2)->'x12') > 0 AND
                                                     EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_x12->-2->>'x12')::jsonb) elem WHERE elem::numeric > 0)
                                                THEN (fo.odds_x12->-2->>'x12')::jsonb
                                                WHEN jsonb_array_length((fo.odds_x12->-3)->'x12') > 0 AND
                                                     EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_x12->-3->>'x12')::jsonb) elem WHERE elem::numeric > 0)
                                                THEN (fo.odds_x12->-3->>'x12')::jsonb
                                                ELSE NULL
                                            END as x12_array
                                    ) valid_odds
                                )
                            ELSE NULL
                        END as fair_odds_x12,

                        -- Fair AH odds - uses most recent valid historical odds (looks past 3 odds)
                        CASE
                            WHEN fo.odds_ah IS NOT NULL THEN
                                -- Find most recent valid AH odds (checking last 3 entries)
                                (
                                    SELECT
                                        CASE
                                            WHEN valid_odds.ah_h_array IS NOT NULL AND valid_odds.ah_a_array IS NOT NULL THEN
                                                jsonb_build_object(
                                                    'fair_ah_h', (
                                                        SELECT jsonb_agg(
                                                            CASE
                                                                WHEN h_odds::numeric > 100 AND a_odds::numeric > 100 AND
                                                                     1.0 / ((1.0 / (h_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                                    ROUND(
                                                                        (
                                                                            2.0 * (h_odds::numeric / POWER(10, fo.decimals)) /
                                                                            (
                                                                                2.0 - (
                                                                                    (
                                                                                        (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                                                                        (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                                                                    ) - 1.0
                                                                                ) * (h_odds::numeric / POWER(10, fo.decimals))
                                                                            )
                                                                        ) * POWER(10, fo.decimals)
                                                                    )::integer
                                                                ELSE NULL
                                                            END ORDER BY h_idx
                                                        )
                                                        FROM jsonb_array_elements_text(valid_odds.ah_h_array) WITH ORDINALITY h(h_odds, h_idx)
                                                        JOIN jsonb_array_elements_text(valid_odds.ah_a_array) WITH ORDINALITY a(a_odds, a_idx)
                                                        ON h_idx = a_idx
                                                    ),
                                                    'fair_ah_a', (
                                                        SELECT jsonb_agg(
                                                            CASE
                                                                WHEN h_odds::numeric > 100 AND a_odds::numeric > 100 AND
                                                                     1.0 / ((1.0 / (h_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                                    ROUND(
                                                                        (
                                                                            2.0 * (a_odds::numeric / POWER(10, fo.decimals)) /
                                                                            (
                                                                                2.0 - (
                                                                                    (
                                                                                        (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                                                                        (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                                                                    ) - 1.0
                                                                                ) * (a_odds::numeric / POWER(10, fo.decimals))
                                                                            )
                                                                        ) * POWER(10, fo.decimals)
                                                                    )::integer
                                                                ELSE NULL
                                                            END ORDER BY h_idx
                                                        )
                                                        FROM jsonb_array_elements_text(valid_odds.ah_h_array) WITH ORDINALITY h(h_odds, h_idx)
                                                        JOIN jsonb_array_elements_text(valid_odds.ah_a_array) WITH ORDINALITY a(a_odds, a_idx)
                                                        ON h_idx = a_idx
                                                    )
                                                )
                                            ELSE NULL
                                        END
                                    FROM (
                                            SELECT
                                                CASE
                                                    WHEN jsonb_array_length((fo.odds_ah->-1)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-1)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-1->>'ah_h')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ah->-2)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-2)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-2->>'ah_h')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ah->-3)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-3)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-3->>'ah_h')::jsonb
                                                    ELSE NULL
                                                END as ah_h_array,
                                                CASE
                                                    WHEN jsonb_array_length((fo.odds_ah->-1)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-1)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-1->>'ah_a')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ah->-2)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-2)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-2->>'ah_a')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ah->-3)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-3)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-3->>'ah_a')::jsonb
                                                    ELSE NULL
                                                END as ah_a_array
                                    ) valid_odds
                                )
                            ELSE NULL
                        END as fair_odds_ah,

                        -- Fair OU odds - uses most recent valid historical odds (looks past 3 odds)
                        CASE
                            WHEN fo.odds_ou IS NOT NULL THEN
                                -- Find most recent valid OU odds (checking last 3 entries)
                                (
                                    SELECT
                                        CASE
                                            WHEN valid_odds.ou_o_array IS NOT NULL AND valid_odds.ou_u_array IS NOT NULL THEN
                                                jsonb_build_object(
                                                    'fair_ou_o', (
                                                        SELECT jsonb_agg(
                                                            CASE
                                                                WHEN o_odds::numeric > 100 AND u_odds::numeric > 100 AND
                                                                     1.0 / ((1.0 / (o_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                                    ROUND(
                                                                        (
                                                                            2.0 * (o_odds::numeric / POWER(10, fo.decimals)) /
                                                                            (
                                                                                2.0 - (
                                                                                    (
                                                                                        (1.0 / (o_odds::numeric / POWER(10, fo.decimals))) +
                                                                                        (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))
                                                                                    ) - 1.0
                                                                                ) * (o_odds::numeric / POWER(10, fo.decimals))
                                                                            )
                                                                        ) * POWER(10, fo.decimals)
                                                                    )::integer
                                                                ELSE NULL
                                                            END ORDER BY o_idx
                                                        )
                                                        FROM jsonb_array_elements_text(valid_odds.ou_o_array) WITH ORDINALITY o(o_odds, o_idx)
                                                        JOIN jsonb_array_elements_text(valid_odds.ou_u_array) WITH ORDINALITY u(u_odds, u_idx)
                                                        ON o_idx = u_idx
                                                    ),
                                                    'fair_ou_u', (
                                                        SELECT jsonb_agg(
                                                            CASE
                                                                WHEN o_odds::numeric > 100 AND u_odds::numeric > 100 AND
                                                                     1.0 / ((1.0 / (o_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                                    ROUND(
                                                                        (
                                                                            2.0 * (u_odds::numeric / POWER(10, fo.decimals)) /
                                                                            (
                                                                                2.0 - (
                                                                                    (
                                                                                        (1.0 / (o_odds::numeric / POWER(10, fo.decimals))) +
                                                                                        (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))
                                                                                    ) - 1.0
                                                                                ) * (u_odds::numeric / POWER(10, fo.decimals))
                                                                            )
                                                                        ) * POWER(10, fo.decimals)
                                                                    )::integer
                                                                ELSE NULL
                                                            END ORDER BY o_idx
                                                        )
                                                        FROM jsonb_array_elements_text(valid_odds.ou_o_array) WITH ORDINALITY o(o_odds, o_idx)
                                                        JOIN jsonb_array_elements_text(valid_odds.ou_u_array) WITH ORDINALITY u(u_odds, u_idx)
                                                        ON o_idx = u_idx
                                                    )
                                                )
                                            ELSE NULL
                                        END
                                    FROM (
                                            SELECT
                                                CASE
                                                    WHEN jsonb_array_length((fo.odds_ou->-1)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-1)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-1->>'ou_o')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ou->-2)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-2)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-2->>'ou_o')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ou->-3)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-3)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-3->>'ou_o')::jsonb
                                                    ELSE NULL
                                                END as ou_o_array,
                                                CASE
                                                    WHEN jsonb_array_length((fo.odds_ou->-1)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-1)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-1->>'ou_u')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ou->-2)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-2)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-2->>'ou_u')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ou->-3)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-3)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-3->>'ou_u')::jsonb
                                                    ELSE NULL
                                                END as ou_u_array
                                    ) valid_odds
                                )
                            ELSE NULL
                        END as fair_odds_ou,

                        -- Latest lines from bookmaker data
                        (fo.lines->-1) as lines,

                        -- Latest timestamps from the odds data used for fair odds calculation
                        fo.latest_t as latest_t

                    FROM (
                        SELECT DISTINCT ON (fixture_id, bookie)
                            fixture_id,
                            bookie,
                            decimals,
                            odds_x12,
                            odds_ah,
                            odds_ou,
                            lines,
                            latest_t,
                            updated_at
                        FROM football_odds
                        WHERE fixture_id = p_fixture_id
                          AND bookie != 'Prediction'
                          AND (odds_x12 IS NOT NULL OR odds_ah IS NOT NULL OR odds_ou IS NOT NULL)
                        ORDER BY fixture_id, bookie, updated_at DESC
                    ) fo
                    ON CONFLICT (fixture_id, bookie) DO UPDATE SET
                        fair_odds_x12 = CASE WHEN EXCLUDED.fair_odds_x12 IS NOT NULL THEN EXCLUDED.fair_odds_x12 ELSE football_fair_odds.fair_odds_x12 END,
                        fair_odds_ah = CASE WHEN EXCLUDED.fair_odds_ah IS NOT NULL THEN EXCLUDED.fair_odds_ah ELSE football_fair_odds.fair_odds_ah END,
                        fair_odds_ou = CASE WHEN EXCLUDED.fair_odds_ou IS NOT NULL THEN EXCLUDED.fair_odds_ou ELSE football_fair_odds.fair_odds_ou END,
                        lines = EXCLUDED.lines,
                        latest_t = CASE WHEN EXCLUDED.fair_odds_x12 IS NOT NULL OR EXCLUDED.fair_odds_ah IS NOT NULL OR EXCLUDED.fair_odds_ou IS NOT NULL THEN EXCLUDED.latest_t ELSE football_fair_odds.latest_t END,
                        updated_at = CASE WHEN EXCLUDED.fair_odds_x12 IS NOT NULL OR EXCLUDED.fair_odds_ah IS NOT NULL OR EXCLUDED.fair_odds_ou IS NOT NULL THEN NOW() ELSE football_fair_odds.updated_at END
                    WHERE (EXCLUDED.fair_odds_x12 IS NOT NULL AND football_fair_odds.fair_odds_x12 IS DISTINCT FROM EXCLUDED.fair_odds_x12)
                       OR (EXCLUDED.fair_odds_ah IS NOT NULL AND football_fair_odds.fair_odds_ah IS DISTINCT FROM EXCLUDED.fair_odds_ah)
                       OR (EXCLUDED.fair_odds_ou IS NOT NULL AND football_fair_odds.fair_odds_ou IS DISTINCT FROM EXCLUDED.fair_odds_ou)
                       OR football_fair_odds.lines IS DISTINCT FROM EXCLUDED.lines
                       OR ((EXCLUDED.fair_odds_x12 IS NOT NULL OR EXCLUDED.fair_odds_ah IS NOT NULL OR EXCLUDED.fair_odds_ou IS NOT NULL) AND football_fair_odds.latest_t IS DISTINCT FROM EXCLUDED.latest_t);
                END;
                $$ LANGUAGE plpgsql;

            `;
            await pool.query(functionsSQL);
            console.log('✅ Update functions created');
        } catch (error) {
            console.error('❌ Error creating functions and triggers:', error.message);
            throw error;
        }

    if (createViews) {
        // Populate calculated odds tables
        console.log('Populating calculated odds tables...');

        // Get all fixtures that have odds
        const fixturesResult = await pool.query(`
            SELECT DISTINCT f.id as fixture_id
            FROM football_fixtures f
            JOIN football_odds fo ON f.id = fo.fixture_id
            WHERE fo.bookie != 'Prediction'
                    AND (fo.odds_x12 IS NOT NULL OR fo.odds_ah IS NOT NULL OR fo.odds_ou IS NOT NULL)
        `);

        const fixtureIds = fixturesResult.rows.map(row => parseInt(row.fixture_id));
        console.log(`📊 Found ${fixtureIds.length} fixtures with odds data`);

        if (fixtureIds.length > 0) {
            // Populate fair_odds table
            console.log('Populating fair_odds table...');
            for (let i = 0; i < fixtureIds.length; i += 50) {
                const batch = fixtureIds.slice(i, i + 50);
                const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(',');
                try {
                    await pool.query(`
                        INSERT INTO football_fair_odds (fixture_id, bookie, decimals, fair_odds_x12, fair_odds_ah, fair_odds_ou, lines, latest_t)
                        SELECT DISTINCT ON (fo.fixture_id, fo.bookie)
                            fo.fixture_id,
                            fo.bookie,
                            fo.decimals,

                            -- Fair X12 odds (Margin Proportional to Odds method) - uses most recent valid odds (looks past 3 odds)
                            CASE
                                WHEN fo.odds_x12 IS NOT NULL THEN
                                    -- Find most recent valid X12 odds (checking last 3 entries)
                                    (
                                        SELECT
                                            CASE
                                                WHEN valid_odds.x12_array IS NOT NULL THEN
                                                    CASE
                                                        WHEN 1.0 / (
                                                            SELECT SUM(1.0 / (elem::numeric / POWER(10, fo.decimals)))
                                                            FROM jsonb_array_elements_text(valid_odds.x12_array) elem
                                                            WHERE elem::numeric > 0
                                                        ) >= 0.92 THEN
                                                            (
                                                                SELECT jsonb_agg(
                                                                    ROUND(
                                                                        (
                                                                            3.0 * (x12_odds::numeric / POWER(10, fo.decimals)) /
                                                                            (
                                                                                3.0 - (
                                                                                    (
                                                                                        SELECT SUM(1.0 / (elem::numeric / POWER(10, fo.decimals)))
                                                                                        FROM jsonb_array_elements_text(valid_odds.x12_array) elem
                                                                                        WHERE elem::numeric > 0
                                                                                    ) - 1.0
                                                                                ) * (x12_odds::numeric / POWER(10, fo.decimals))
                                                                            )
                                                                        ) * POWER(10, fo.decimals)
                                                                    )::integer
                                                                    ORDER BY x12_idx
                                                                )
                                                                FROM jsonb_array_elements_text(valid_odds.x12_array) WITH ORDINALITY x12(x12_odds, x12_idx)
                                                                WHERE x12_idx <= 3 AND x12_odds::numeric > 0
                                                            )
                                                        ELSE NULL
                                                    END
                                                ELSE NULL
                                            END
                                        FROM (
                                            SELECT
                                                CASE
                                                    WHEN jsonb_array_length((fo.odds_x12->-1)->'x12') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_x12->-1->>'x12')::jsonb) elem WHERE elem::numeric > 0)
                                                    THEN (fo.odds_x12->-1->>'x12')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_x12->-2)->'x12') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_x12->-2->>'x12')::jsonb) elem WHERE elem::numeric > 0)
                                                    THEN (fo.odds_x12->-2->>'x12')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_x12->-3)->'x12') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_x12->-3->>'x12')::jsonb) elem WHERE elem::numeric > 0)
                                                    THEN (fo.odds_x12->-3->>'x12')::jsonb
                                                    ELSE NULL
                                                END as x12_array
                                        ) valid_odds
                                    )
                                ELSE NULL
                            END as fair_odds_x12,

                            -- Fair AH odds - uses most recent valid historical odds (looks past 3 odds)
                            CASE
                                WHEN fo.odds_ah IS NOT NULL THEN
                                    -- Find most recent valid AH odds (checking last 3 entries)
                                    (
                                        SELECT
                                            CASE
                                                WHEN valid_odds.ah_h_array IS NOT NULL AND valid_odds.ah_a_array IS NOT NULL THEN
                                                    jsonb_build_object(
                                                        'fair_ah_h', (
                                                            SELECT jsonb_agg(
                                                                CASE
                                                                    WHEN h_odds::numeric > 100 AND a_odds::numeric > 100 AND
                                                                         1.0 / ((1.0 / (h_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                                        ROUND(
                                                                            (
                                                                                2.0 * (h_odds::numeric / POWER(10, fo.decimals)) /
                                                                                (
                                                                                    2.0 - (
                                                                                        (
                                                                                            (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                                                                            (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                                                                        ) - 1.0
                                                                                    ) * (h_odds::numeric / POWER(10, fo.decimals))
                                                                                )
                                                                            ) * POWER(10, fo.decimals)
                                                                        )::integer
                                                                    ELSE NULL
                                                                END ORDER BY h_idx
                                                            )
                                                            FROM jsonb_array_elements_text(valid_odds.ah_h_array) WITH ORDINALITY h(h_odds, h_idx)
                                                            JOIN jsonb_array_elements_text(valid_odds.ah_a_array) WITH ORDINALITY a(a_odds, a_idx)
                                                            ON h_idx = a_idx
                                                        ),
                                                        'fair_ah_a', (
                                                            SELECT jsonb_agg(
                                                                CASE
                                                                    WHEN h_odds::numeric > 100 AND a_odds::numeric > 100 AND
                                                                         1.0 / ((1.0 / (h_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                                        ROUND(
                                                                            (
                                                                                2.0 * (a_odds::numeric / POWER(10, fo.decimals)) /
                                                                                (
                                                                                    2.0 - (
                                                                                        (
                                                                                            (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                                                                            (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                                                                        ) - 1.0
                                                                                    ) * (a_odds::numeric / POWER(10, fo.decimals))
                                                                                )
                                                                            ) * POWER(10, fo.decimals)
                                                                        )::integer
                                                                    ELSE NULL
                                                                END ORDER BY h_idx
                                                            )
                                                            FROM jsonb_array_elements_text(valid_odds.ah_h_array) WITH ORDINALITY h(h_odds, h_idx)
                                                            JOIN jsonb_array_elements_text(valid_odds.ah_a_array) WITH ORDINALITY a(a_odds, a_idx)
                                                            ON h_idx = a_idx
                                                        )
                                                    )
                                                ELSE NULL
                                            END
                                        FROM (
                                            SELECT
                                                CASE
                                                    WHEN jsonb_array_length((fo.odds_ah->-1)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-1)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-1->>'ah_h')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ah->-2)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-2)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-2->>'ah_h')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ah->-3)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-3)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-3->>'ah_h')::jsonb
                                                    ELSE NULL
                                                END as ah_h_array,
                                                CASE
                                                    WHEN jsonb_array_length((fo.odds_ah->-1)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-1)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-1->>'ah_a')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ah->-2)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-2)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-2->>'ah_a')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ah->-3)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-3)->'ah_a') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                                    THEN (fo.odds_ah->-3->>'ah_a')::jsonb
                                                    ELSE NULL
                                                END as ah_a_array
                                        ) valid_odds
                                    )
                                ELSE NULL
                            END as fair_odds_ah,

                            -- Fair OU odds - uses most recent valid historical odds (looks past 3 odds)
                            CASE
                                WHEN fo.odds_ou IS NOT NULL THEN
                                    -- Find most recent valid OU odds (checking last 3 entries)
                                    (
                                        SELECT
                                            CASE
                                                WHEN valid_odds.ou_o_array IS NOT NULL AND valid_odds.ou_u_array IS NOT NULL THEN
                                                    jsonb_build_object(
                                                        'fair_ou_o', (
                                                            SELECT jsonb_agg(
                                                                CASE
                                                                    WHEN o_odds::numeric > 100 AND u_odds::numeric > 100 AND
                                                                         1.0 / ((1.0 / (o_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                                        ROUND(
                                                                            (
                                                                                2.0 * (o_odds::numeric / POWER(10, fo.decimals)) /
                                                                                (
                                                                                    2.0 - (
                                                                                        (
                                                                                            (1.0 / (o_odds::numeric / POWER(10, fo.decimals))) +
                                                                                            (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))
                                                                                        ) - 1.0
                                                                                    ) * (o_odds::numeric / POWER(10, fo.decimals))
                                                                                )
                                                                            ) * POWER(10, fo.decimals)
                                                                        )::integer
                                                                    ELSE NULL
                                                                END ORDER BY o_idx
                                                            )
                                                            FROM jsonb_array_elements_text(valid_odds.ou_o_array) WITH ORDINALITY o(o_odds, o_idx)
                                                            JOIN jsonb_array_elements_text(valid_odds.ou_u_array) WITH ORDINALITY u(u_odds, u_idx)
                                                            ON o_idx = u_idx
                                                        ),
                                                        'fair_ou_u', (
                                                            SELECT jsonb_agg(
                                                                CASE
                                                                    WHEN o_odds::numeric > 100 AND u_odds::numeric > 100 AND
                                                                         1.0 / ((1.0 / (o_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                                        ROUND(
                                                                            (
                                                                                2.0 * (u_odds::numeric / POWER(10, fo.decimals)) /
                                                                                (
                                                                                    2.0 - (
                                                                                        (
                                                                                            (1.0 / (o_odds::numeric / POWER(10, fo.decimals))) +
                                                                                            (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))
                                                                                        ) - 1.0
                                                                                    ) * (u_odds::numeric / POWER(10, fo.decimals))
                                                                                )
                                                                            ) * POWER(10, fo.decimals)
                                                                        )::integer
                                                                    ELSE NULL
                                                                END ORDER BY o_idx
                                                            )
                                                            FROM jsonb_array_elements_text(valid_odds.ou_o_array) WITH ORDINALITY o(o_odds, o_idx)
                                                            JOIN jsonb_array_elements_text(valid_odds.ou_u_array) WITH ORDINALITY u(u_odds, u_idx)
                                                            ON o_idx = u_idx
                                                        )
                                                    )
                                                ELSE NULL
                                            END
                                        FROM (
                                            SELECT
                                                CASE
                                                    WHEN jsonb_array_length((fo.odds_ou->-1)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-1)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-1->>'ou_o')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ou->-2)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-2)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-2->>'ou_o')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ou->-3)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-3)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-3->>'ou_o')::jsonb
                                                    ELSE NULL
                                                END as ou_o_array,
                                                CASE
                                                    WHEN jsonb_array_length((fo.odds_ou->-1)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-1)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-1->>'ou_u')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ou->-2)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-2)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-2->>'ou_u')::jsonb
                                                    WHEN jsonb_array_length((fo.odds_ou->-3)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-3)->'ou_u') > 0 AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                                    THEN (fo.odds_ou->-3->>'ou_u')::jsonb
                                                    ELSE NULL
                                                END as ou_u_array
                                        ) valid_odds
                                    )
                                ELSE NULL
                            END as fair_odds_ou,

                            -- Latest lines from bookmaker data
                            (fo.lines->-1) as lines,

                            -- Latest timestamps from the odds data used for fair odds calculation
                            fo.latest_t as latest_t

                        FROM football_odds fo
                        WHERE fo.fixture_id = ANY(ARRAY[${placeholders}]::BIGINT[])
                          AND fo.bookie != 'Prediction'
                          AND (fo.odds_x12 IS NOT NULL OR fo.odds_ah IS NOT NULL OR fo.odds_ou IS NOT NULL)
                        ORDER BY fo.fixture_id, fo.bookie, fo.latest_t DESC
                        ON CONFLICT (fixture_id, bookie) DO UPDATE SET
                            fair_odds_x12 = CASE WHEN EXCLUDED.fair_odds_x12 IS NOT NULL THEN EXCLUDED.fair_odds_x12 ELSE football_fair_odds.fair_odds_x12 END,
                            fair_odds_ah = CASE WHEN EXCLUDED.fair_odds_ah IS NOT NULL THEN EXCLUDED.fair_odds_ah ELSE football_fair_odds.fair_odds_ah END,
                            fair_odds_ou = CASE WHEN EXCLUDED.fair_odds_ou IS NOT NULL THEN EXCLUDED.fair_odds_ou ELSE football_fair_odds.fair_odds_ou END,
                            lines = EXCLUDED.lines,
                            latest_t = CASE WHEN EXCLUDED.fair_odds_x12 IS NOT NULL OR EXCLUDED.fair_odds_ah IS NOT NULL OR EXCLUDED.fair_odds_ou IS NOT NULL THEN EXCLUDED.latest_t ELSE football_fair_odds.latest_t END,
                            updated_at = CASE WHEN EXCLUDED.fair_odds_x12 IS NOT NULL OR EXCLUDED.fair_odds_ah IS NOT NULL OR EXCLUDED.fair_odds_ou IS NOT NULL THEN NOW() ELSE football_fair_odds.updated_at END
                        WHERE (EXCLUDED.fair_odds_x12 IS NOT NULL AND football_fair_odds.fair_odds_x12 IS DISTINCT FROM EXCLUDED.fair_odds_x12)
                           OR (EXCLUDED.fair_odds_ah IS NOT NULL AND football_fair_odds.fair_odds_ah IS DISTINCT FROM EXCLUDED.fair_odds_ah)
                           OR (EXCLUDED.fair_odds_ou IS NOT NULL AND football_fair_odds.fair_odds_ou IS DISTINCT FROM EXCLUDED.fair_odds_ou)
                           OR football_fair_odds.lines IS DISTINCT FROM EXCLUDED.lines
                           OR ((EXCLUDED.fair_odds_x12 IS NOT NULL OR EXCLUDED.fair_odds_ah IS NOT NULL OR EXCLUDED.fair_odds_ou IS NOT NULL) AND football_fair_odds.latest_t IS DISTINCT FROM EXCLUDED.latest_t)
                    `, batch);
                } catch (error) {
                    console.error(`❌ Error populating fair_odds batch ${Math.floor(i/50) + 1}:`, error.message);
                }
            }
            console.log('✅ Fair odds table populated successfully');
        } else {
            console.log('⚠️  No fixtures with odds data found');
        }

    } else {
      console.log('⏭️  Skipping calculated odds table population (use --views to enable)');
    }
    } else {
        console.log('⏭️  Skipping database setup (use --views to enable)');
    }


    // Create all statistical functions (needed regardless of --views flag)
    console.log('Creating database functions...');
    await pool.query(sql);

    // Create concurrent indexes separately (cannot run inside transaction)
    console.log('Creating concurrent indexes...');
    try {
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_football_stats_fixture_elo ON football_stats (fixture_id, elo_home, elo_away, league_elo, home_advantage)');
    } catch (error) {
        console.error('⚠️  Error creating idx_football_stats_fixture_elo index:', error.message);
    }

    try {
        await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_football_stats_elos ON football_stats (elo_home, elo_away, league_elo) WHERE elo_home IS NOT NULL AND elo_away IS NOT NULL AND league_elo IS NOT NULL');
    } catch (error) {
        console.error('⚠️  Error creating idx_football_stats_elos index:', error.message);
    }

    const startTime = Date.now();
    let totalCount = 0;
    const isAll = functionsToRun.includes('all') || functionsToRun.length === 0;

    if (isAll) {
        console.log('Running all calculations...');

        // Calculate market XG first (uses betting odds)
        console.log('Running market XG calculations...');
        const marketXgCount = await calculateMarketXG(fixtureIds);
        console.log(`✅ Market XG calculations completed: ${marketXgCount} fixtures processed`);

        // Run all SQL-based calculations
        console.log('Running all fixture stats calculations...');
        const result = await pool.query('SELECT populate_all_fixture_stats(0, $1) as count', [fixtureIds]);
        totalCount = result.rows[0].count;
        console.log(`✅ All fixture stats calculations completed: ${totalCount} fixtures processed`);

        // Calculate prediction odds last (uses MLP predictions)
        console.log('Running prediction odds calculations...');
        const predictionOddsCount = await calculateOddsFromPredictions(fixtureIds);
        console.log(`✅ Prediction odds calculations completed: ${predictionOddsCount} fixtures processed`);

        console.log(`✅ All calculations completed: ${totalCount} fixtures processed total`);
    } else {
        // Run selected functions individually
        if (functionsToRun.includes('1') || functionsToRun.includes('hours')) {
            console.log('Running hours calculation...');
            const result = await pool.query('SELECT populate_hours_batch($1) as count', [fixtureIds]);
            const count = result.rows[0].count;
            totalCount += count;
            console.log(`✅ Hours calculation completed: ${count} fixtures processed`);
        }

        if (functionsToRun.includes('2') || functionsToRun.includes('goals')) {
            console.log('Running league goals calculation...');
            const result = await pool.query('SELECT populate_league_goals_batch($1) as count', [fixtureIds]);
            const count = result.rows[0].count;
            totalCount += count;
            console.log(`✅ Goals calculation completed: ${count} fixtures processed`);
        }

        if (functionsToRun.includes('3') || functionsToRun.includes('elo')) {
            console.log('Running ELO calculations (team + league)...');
            const result = await pool.query('SELECT calculate_elos_incremental($1) as count', [fixtureIds]);
            const count = result.rows[0].count;
            totalCount += count;
            console.log(`✅ ELO calculations completed: ${count} fixtures processed`);
        }

        if (functionsToRun.includes('4') || functionsToRun.includes('home-advantage')) {
            console.log('Running home advantage calculation...');
            const result = await pool.query('SELECT populate_home_advantage_batch($1) as count', [fixtureIds]);
            const count = result.rows[0].count;
            totalCount += count;
            console.log(`✅ Home advantage calculation completed: ${count} fixtures processed`);
        }

        if (functionsToRun.includes('5') || functionsToRun.includes('xg') || functionsToRun.includes('rolling-xg')) {
            console.log('Running rolling windows xG calculations...');
            const result = await pool.query('SELECT populate_adjusted_rolling_xg_batch($1) as count', [fixtureIds]);
            const count = result.rows[0].count;
            totalCount += count;
            console.log(`✅ Rolling windows xG calculations completed: ${count} fixtures processed`);
        }

        if (functionsToRun.includes('6') || functionsToRun.includes('market-xg')) {
            console.log('Running market XG calculations...');
            const count = await calculateMarketXG(fixtureIds);
            totalCount += count;
            console.log(`✅ Market XG calculations completed: ${count} fixtures processed`);
        }

        if (functionsToRun.includes('7') || functionsToRun.includes('prediction-odds') || functionsToRun.includes('odds')) {
            console.log('Running prediction odds calculations...');
            const count = await calculateOddsFromPredictions(fixtureIds);
            totalCount += count;
            console.log(`✅ Prediction odds calculations completed: ${count} fixtures processed`);
        }

        if (functionsToRun.includes('8') || functionsToRun.includes('cleanup-odds')) {
            console.log('Running odds cleanup for past fixtures...');
            const result = await cleanupPastFixturesOdds();
            totalCount += result.cleanedRecords;
            console.log(`✅ Odds cleanup completed: ${result.processedFixtures} fixtures processed, ${result.cleanedRecords} records cleaned`);
        }

        console.log(`✅ Selected calculations completed: ${totalCount} fixtures processed total`);
    }

    const executionTime = (Date.now() - startTime) / 1000;
    console.log(`⏱️  Total execution time: ${executionTime}s`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

runCalculations();


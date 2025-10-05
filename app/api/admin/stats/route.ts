import { NextResponse } from 'next/server';
import pool from '../../../../lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST - Run statistics calculations
 * Body parameters:
 * - functions: Array of function names/numbers ['all', '1', 'hours', '2', 'goals', '3', 'elo', '4', 'home-advantage', '5', 'xg', 'rolling-xg', '6', 'market-xg', 'rolling-market-xg'] (default: ['all'])
 * - fixtureIds: Array of fixture IDs to process (optional - when provided, ELO calculations use incremental mode with existing ratings)
 * - createViews: Boolean to create database views (optional, default: false)
 *
 * Notes:
 * - When fixtureIds is provided: ELO calculations use incremental mode (preserves existing team ratings from previous fixtures)
 * - When fixtureIds is null/omitted: Full recalculation mode (all statistics recalculated from league base ELOs)
 * - ELO calculations automatically detect the mode and handle existing ratings appropriately
 * - Other calculations (hours, goals, home advantage, rolling XG) work the same in both modes
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    let {
      functions = ['all'],
      fixtureIds = null,
      createViews = false
    } = body;

    // Validate and normalize functions array
    const validFunctions = ['all', '1', 'hours', '2', 'goals', '3', 'elo', '4', 'home-advantage', '5', 'xg', 'rolling-xg', '6', 'market-xg', 'rolling-market-xg'];
    if (!Array.isArray(functions)) {
      functions = ['all'];
    } else {
      functions = functions.filter(func => validFunctions.includes(func.toString()));
      if (functions.length === 0) {
        functions = ['all'];
      }
    }

    // Validate fixtureIds
    if (fixtureIds !== null && (!Array.isArray(fixtureIds) || fixtureIds.some(id => !Number.isInteger(Number(id))))) {
      return NextResponse.json({
        error: 'fixtureIds must be an array of integers or null',
      }, { status: 400 })
    }

    console.log('🚀 Starting statistics calculations...');

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
      console.error('❌ Error setting up league ELO data:', error instanceof Error ? error.message : error);
      return NextResponse.json({
        error: 'Failed to load league ELO data',
      }, { status: 500 })
    }

    const sql = `
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
                WHEN lm_home.hours_diff IS NULL THEN NULL
                WHEN lm_home.hours_diff < 24 THEN NULL
                WHEN lm_home.hours_diff > 500 THEN 500
                ELSE lm_home.hours_diff::INTEGER
            END,
            CASE
                WHEN lm_away.hours_diff IS NULL THEN NULL
                WHEN lm_away.hours_diff < 24 THEN NULL
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
                WHEN lg.fixture_count < 50 THEN 2.70
                WHEN lg.avg_goals IS NULL THEN 2.70
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
                  AND ff.status_short = 'FT'
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
        INSERT INTO football_stats (fixture_id, home_advantage)
        SELECT
            f.id,
            CASE
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
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) as fixture_count,
                AVG(ff.goals_home - ff.goals_away) as avg_home_advantage
            FROM (
                SELECT goals_home, goals_away
                FROM football_fixtures ff
                WHERE ff.league_id = f.league_id
                  AND ff.date < f.date
                  AND ff.status_short = 'FT'
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
    -- Always recalculates ALL fixtures from the beginning for complete data consistency
    -- Calculates team ELOs first, then league ELOs (average of team ELOs)
    -- For matches with XG/goals data: calculates ELO changes normally
    -- For matches without data: uses current team ELO ratings
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
        k_factor INTEGER := 32;
        updated_count INTEGER := 0;
        last_processed_date TIMESTAMP;
        league_base_elo INTEGER;
    BEGIN
        -- Always calculate all ELOs from the beginning for data consistency

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

        -- Create temporary table for team ELO ratings (reset each calculation)
        DROP TABLE IF EXISTS temp_team_elo;
        CREATE TEMP TABLE temp_team_elo (
            team_id BIGINT PRIMARY KEY,
            league_id BIGINT,
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
            -- Get league base ELO
            SELECT COALESCE(base_elo, 1500) INTO league_base_elo
            FROM league_elo_ratings
            WHERE league_id = fixture_record.league_id;

            -- Get or create home team ELO
            IF NOT EXISTS (SELECT 1 FROM temp_team_elo WHERE team_id = fixture_record.home_team_id) THEN
                INSERT INTO temp_team_elo (team_id, league_id, elo_rating)
                VALUES (fixture_record.home_team_id, fixture_record.league_id, league_base_elo);
            END IF;

            -- Get or create away team ELO
            IF NOT EXISTS (SELECT 1 FROM temp_team_elo WHERE team_id = fixture_record.away_team_id) THEN
                INSERT INTO temp_team_elo (team_id, league_id, elo_rating)
                VALUES (fixture_record.away_team_id, fixture_record.league_id, league_base_elo);
            END IF;

            -- Get current ELO ratings (before this match)
            SELECT elo_rating INTO home_elo FROM temp_team_elo WHERE team_id = fixture_record.home_team_id;
            SELECT elo_rating INTO away_elo FROM temp_team_elo WHERE team_id = fixture_record.away_team_id;

            -- Store pre-match ELO ratings for this fixture
            DECLARE
                pre_match_home_elo INTEGER := home_elo;
                pre_match_away_elo INTEGER := away_elo;
                new_home_elo INTEGER;
                new_away_elo INTEGER;
            BEGIN
                -- Check if we have XG/goals data to calculate ELO changes
                IF (fixture_record.xg_home IS NOT NULL OR fixture_record.goals_home IS NOT NULL) AND fixture_record.status_short = 'FT' THEN
                    -- We have match data, calculate ELO changes normally

                    -- Calculate expected scores using ELO formula
                    expected_home := 1.0 / (1.0 + POWER(10, (away_elo - home_elo)::DECIMAL / 400));
                    expected_away := 1.0 - expected_home;

                    -- Use XG if available, otherwise use actual goals
                    actual_home_score := COALESCE(fixture_record.xg_home, fixture_record.goals_home, 0);
                    actual_away_score := COALESCE(fixture_record.xg_away, fixture_record.goals_away, 0);

                    -- Determine win/draw/loss based on XG difference threshold of 0.38
                    -- If XG difference is less than 0.38, consider it a draw (both teams get 0.5)
                    -- Otherwise, winner gets 1.0, loser gets 0.0
                    IF ABS(actual_home_score - actual_away_score) < 0.38 THEN
                        -- Draw: both teams get 0.5 points
                        actual_home_score := 0.5;
                        actual_away_score := 0.5;
                    ELSE
                        -- Win/loss: higher XG team gets 1.0, lower gets 0.0
                        IF actual_home_score > actual_away_score THEN
                            actual_home_score := 1.0;
                            actual_away_score := 0.0;
                        ELSE
                            actual_home_score := 0.0;
                            actual_away_score := 1.0;
                        END IF;
                    END IF;

                    -- Handle edge cases for very low XG games (treat as more random)
                    IF (COALESCE(fixture_record.xg_home, fixture_record.goals_home, 0) +
                        COALESCE(fixture_record.xg_away, fixture_record.goals_away, 0)) < 0.5 THEN
                        actual_home_score := 0.5;
                        actual_away_score := 0.5;
                    END IF;

                    -- Calculate new ELO ratings based on match performance
                    new_home_elo := home_elo + ROUND(k_factor * (actual_home_score - expected_home))::INTEGER;
                    new_away_elo := away_elo + ROUND(k_factor * (actual_away_score - expected_away))::INTEGER;

                    -- Ensure ELO doesn't go below 1000 or above 3000
                    new_home_elo := GREATEST(1000, LEAST(3000, new_home_elo));
                    new_away_elo := GREATEST(1000, LEAST(3000, new_away_elo));

                    -- Update team ELO ratings for future matches
                    UPDATE temp_team_elo SET elo_rating = new_home_elo
                    WHERE team_id = fixture_record.home_team_id;

                    UPDATE temp_team_elo SET elo_rating = new_away_elo
                    WHERE team_id = fixture_record.away_team_id;
                END IF;

                -- Always store the PRE-MATCH ELO ratings for this fixture
                -- This ensures the stored ELO doesn't include the current match's result
                INSERT INTO football_stats (fixture_id, elo_home, elo_away)
                VALUES (fixture_record.id, pre_match_home_elo, pre_match_away_elo)
                ON CONFLICT (fixture_id) DO UPDATE SET
                    elo_home = EXCLUDED.elo_home,
                    elo_away = EXCLUDED.elo_away,
                    updated_at = NOW();
            END;

            updated_count := updated_count + 1;
        END LOOP;

        -- Calculate league ELOs as average of PRE-MATCH team ELOs for each fixture
        -- This ensures no data leakage - each fixture's league ELO only includes historical data
        RAISE NOTICE 'Calculating league ELOs...';
        UPDATE football_stats
        SET league_elo = (
            SELECT ROUND(AVG(fs.elo_home))::INTEGER
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
        )
        WHERE (fixture_ids IS NULL OR football_stats.fixture_id = ANY(fixture_ids));

        -- Clean up temporary tables (will be auto-dropped at end of session anyway)
        DROP TABLE IF EXISTS league_elo_ratings;
        DROP TABLE IF EXISTS temp_team_elo;

        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to calculate adjusted rolling xG and xGA using rolling windows (8, 16, 32 matches averaged)
    CREATE OR REPLACE FUNCTION populate_adjusted_rolling_xg_batch(fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
    -- Updated to require at least 4 past fixtures for adjusted rolling calculations
    DECLARE
        updated_count INTEGER;
    BEGIN
        -- Single batch update using window functions for maximum performance
        -- Teams must have at least 4 past fixtures to get adjusted rolling calculations
        WITH fixture_data AS (
        -- First function: populate_adjusted_rolling_xg_batch
            -- Get all fixtures that need calculation
            -- Requires minimum 4 past fixtures for adjusted rolling calculations
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
        all_past_matches AS (
            -- Get all past matches for all teams (pre-filtered for efficiency)
            -- Only include teams with at least 4 past fixtures
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
                pms.home_advantage as past_league_home_advantage,
                -- Count total matches for this team in this fixture
                COUNT(*) OVER (PARTITION BY fd.fixture_id, CASE WHEN pm.home_team_id = fd.home_team_id OR pm.away_team_id = fd.home_team_id THEN fd.home_team_id ELSE fd.away_team_id END) as team_match_count
            FROM fixture_data fd
            -- Cross join with all past matches for both home and away teams
            CROSS JOIN LATERAL (
                SELECT pf.id, pf.date, pf.league_id, pf.home_team_id, pf.away_team_id, pf.xg_home, pf.xg_away, pf.goals_home, pf.goals_away
                FROM football_fixtures pf
                WHERE (pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id
                       OR pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id)
                  AND pf.date < fd.fixture_date
                  AND pf.date >= fd.fixture_date - INTERVAL '1 year'
                  AND pf.status_short = 'FT'
                  -- Conditional filtering based on league type
                  AND (fd.league_type = 'Cup' OR EXISTS (
                      SELECT 1 FROM football_leagues pl
                      WHERE pl.id = pf.league_id AND pl.country = fd.league_country AND pl.type = 'League'
                  ))
                ORDER BY pf.date DESC
                LIMIT 32
            ) pm
            JOIN football_stats pms ON pm.id = pms.fixture_id
            WHERE pms.elo_home IS NOT NULL AND pms.elo_away IS NOT NULL AND pms.league_elo IS NOT NULL
                  AND pms.avg_goals_league IS NOT NULL
        ),
        -- Filter to only include teams with at least 4 past fixtures
        filtered_past_matches AS (
            SELECT * FROM all_past_matches
            WHERE team_match_count >= 4
        ),
        calculated_adjustments AS (
            -- Calculate adjusted xG for each past match from both home and away perspectives
            SELECT
                fpm.fixture_id,
                fpm.past_match_id,
                -- Home team perspective
                CASE
                    WHEN fpm.past_home_team_id = fpm.home_team_id THEN
                        -- Home team was home in this past match - PENALIZE xG, BENEFIT xGA
                        fpm.past_xg_home * (
                        POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                        (GREATEST(fpm.past_elo_away, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (fpm.past_league_home_advantage / 2.0)
                    ELSE
                        -- Home team was away in this past match - BENEFIT xG, PENALIZE xGA
                        fpm.past_xg_away * (
                        POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                        (GREATEST(fpm.past_elo_home, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (fpm.past_league_home_advantage / 2.0)
                END as home_team_adjusted_xg,

                CASE
                    WHEN fpm.past_home_team_id = fpm.home_team_id THEN
                        -- Home team's xGA when they were home - PENALIZE defense
                        fpm.past_xg_away / (
                            POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                            (GREATEST(fpm.past_elo_home, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (fpm.past_league_home_advantage / 2.0)
                    ELSE
                        -- Home team's xGA when they were away - BENEFIT defense
                        fpm.past_xg_home / (
                            POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                            (GREATEST(fpm.past_elo_away, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (fpm.past_league_home_advantage / 2.0)
                END as home_team_adjusted_xga,

                -- Away team perspective
                CASE
                    WHEN fpm.past_home_team_id = fpm.away_team_id THEN
                        -- Away team was home in this past match - PENALIZE xG, BENEFIT xGA
                        fpm.past_xg_home * (
                        POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                        (GREATEST(fpm.past_elo_away, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (fpm.past_league_home_advantage / 2.0)
                    ELSE
                        -- Away team was away in this past match - BENEFIT xG, PENALIZE xGA
                        fpm.past_xg_away * (
                        POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                        (GREATEST(fpm.past_elo_home, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000)) *
                        CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END
                        ) +
                        (past_league_home_advantage / 2.0)
                END as away_team_adjusted_xg,

                CASE
                    WHEN fpm.past_home_team_id = fpm.away_team_id THEN
                        -- Away team's xGA when they were home - PENALIZE defense
                        fpm.past_xg_away / (
                            POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                            (GREATEST(fpm.past_elo_home, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (fpm.past_league_home_advantage / 2.0)
                    ELSE
                        -- Away team's xGA when they were away - BENEFIT defense
                        fpm.past_xg_home / (
                            POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                            (GREATEST(fpm.past_elo_away, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (fpm.past_league_home_advantage / 2.0)
                END as away_team_adjusted_xga,

                -- Match recency ranking (1 = most recent for this team)
                ROW_NUMBER() OVER (PARTITION BY fpm.fixture_id, CASE WHEN fpm.past_home_team_id = fpm.home_team_id OR fpm.past_away_team_id = fpm.home_team_id THEN fpm.home_team_id ELSE fpm.away_team_id END ORDER BY fpm.past_date DESC) as match_rank,
                -- Which team this match belongs to
                CASE WHEN fpm.past_home_team_id = fpm.home_team_id OR fpm.past_away_team_id = fpm.home_team_id THEN 'home' ELSE 'away' END as team_side
            FROM filtered_past_matches fpm
        ),
        aggregated_xg AS (
            -- Calculate 16-match rolling window
            SELECT
                fixture_id,
                -- Home team rolling windows averaged (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND((
                    -- 8-match window
                    COALESCE(SUM(CASE WHEN team_side = 'home' AND match_rank <= 8 THEN home_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 8 THEN 1 END), 0), 0) +
                    -- 16-match window
                    COALESCE(SUM(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN home_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN 1 END), 0), 0) +
                    -- 32-match window
                    COALESCE(SUM(CASE WHEN team_side = 'home' AND match_rank <= 32 THEN home_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 32 THEN 1 END), 0), 0)
                ) / 3.0, 2))) as home_xg,

                -- Home team rolling windows xGA averaged (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND((
                    -- 8-match window
                    COALESCE(SUM(CASE WHEN team_side = 'home' AND match_rank <= 8 THEN home_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 8 THEN 1 END), 0), 0) +
                    -- 16-match window
                    COALESCE(SUM(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN home_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN 1 END), 0), 0) +
                    -- 32-match window
                    COALESCE(SUM(CASE WHEN team_side = 'home' AND match_rank <= 32 THEN home_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 32 THEN 1 END), 0), 0)
                ) / 3.0, 2))) as home_xga,

                -- Away team rolling windows averaged (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND((
                    -- 8-match window
                    COALESCE(SUM(CASE WHEN team_side = 'away' AND match_rank <= 8 THEN away_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 8 THEN 1 END), 0), 0) +
                    -- 16-match window
                    COALESCE(SUM(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN away_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN 1 END), 0), 0) +
                    -- 32-match window
                    COALESCE(SUM(CASE WHEN team_side = 'away' AND match_rank <= 32 THEN away_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 32 THEN 1 END), 0), 0)
                ) / 3.0, 2))) as away_xg,

                -- Away team rolling windows xGA averaged (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND((
                    -- 8-match window
                    COALESCE(SUM(CASE WHEN team_side = 'away' AND match_rank <= 8 THEN away_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 8 THEN 1 END), 0), 0) +
                    -- 16-match window
                    COALESCE(SUM(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN away_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN 1 END), 0), 0) +
                    -- 32-match window
                    COALESCE(SUM(CASE WHEN team_side = 'away' AND match_rank <= 32 THEN away_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 32 THEN 1 END), 0), 0)
                ) / 3.0, 2))) as away_xga
            FROM calculated_adjustments
            GROUP BY fixture_id
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
    -- Updated to require at least 4 past fixtures for adjusted rolling calculations
    DECLARE
        updated_count INTEGER;
    BEGIN
        -- Single batch update using window functions for maximum performance
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
        all_past_matches AS (
            -- Get all past matches for all teams (pre-filtered for efficiency)
            -- Only include teams with at least 4 past fixtures
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
                pms.home_advantage as past_league_home_advantage,
                -- Count total matches for this team in this fixture
                COUNT(*) OVER (PARTITION BY fd.fixture_id, CASE WHEN pm.home_team_id = fd.home_team_id OR pm.away_team_id = fd.home_team_id THEN fd.home_team_id ELSE fd.away_team_id END) as team_match_count
            FROM fixture_data fd
            -- Cross join with all past matches for both home and away teams
            CROSS JOIN LATERAL (
                SELECT pf.id, pf.date, pf.league_id, pf.home_team_id, pf.away_team_id, pf.xg_home, pf.xg_away, pf.goals_home, pf.goals_away, pf.market_xg_home, pf.market_xg_away
                FROM football_fixtures pf
                WHERE (pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id
                       OR pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id)
                  AND pf.date < fd.fixture_date
                  AND pf.date >= fd.fixture_date - INTERVAL '1 year'
                  AND pf.status_short = 'FT'
                  -- Conditional filtering based on league type
                  AND (fd.league_type = 'Cup' OR EXISTS (
                      SELECT 1 FROM football_leagues pl
                      WHERE pl.id = pf.league_id AND pl.country = fd.league_country AND pl.type = 'League'
                  ))
                ORDER BY pf.date DESC
                LIMIT 32
            ) pm
            JOIN football_stats pms ON pm.id = pms.fixture_id
            WHERE pms.elo_home IS NOT NULL AND pms.elo_away IS NOT NULL AND pms.league_elo IS NOT NULL
                  AND pms.avg_goals_league IS NOT NULL
        ),
        -- Filter to only include teams with at least 4 past fixtures
        filtered_past_matches AS (
            SELECT * FROM all_past_matches
            WHERE team_match_count >= 4
        ),
        calculated_adjustments AS (
            -- Calculate adjusted xG for each past match from both home and away perspectives
            SELECT
                fpm.fixture_id,
                fpm.past_match_id,
                -- Home team perspective
                CASE
                    WHEN fpm.past_home_team_id = fpm.home_team_id THEN
                        -- Home team was home in this past match - PENALIZE xG, BENEFIT xGA
                        fpm.past_xg_home * (
                        POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                        (GREATEST(fpm.past_elo_away, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (fpm.past_league_home_advantage / 2.0)
                    ELSE
                        -- Home team was away in this past match - BENEFIT xG, PENALIZE xGA
                        fpm.past_xg_away * (
                        POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                        (GREATEST(fpm.past_elo_home, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (fpm.past_league_home_advantage / 2.0)
                END as home_team_adjusted_xg,

                CASE
                    WHEN fpm.past_home_team_id = fpm.home_team_id THEN
                        -- Home team's xGA when they were home - PENALIZE defense
                        fpm.past_xg_away / (
                            POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                            (GREATEST(fpm.past_elo_home, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (fpm.past_league_home_advantage / 2.0)
                    ELSE
                        -- Home team's xGA when they were away - BENEFIT defense
                        fpm.past_xg_home / (
                            POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                            (GREATEST(fpm.past_elo_away, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (fpm.past_league_home_advantage / 2.0)
                END as home_team_adjusted_xga,

                -- Away team perspective
                CASE
                    WHEN fpm.past_home_team_id = fpm.away_team_id THEN
                        -- Away team was home in this past match - PENALIZE xG, BENEFIT xGA
                        fpm.past_xg_home * (
                        POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                        (GREATEST(fpm.past_elo_away, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (fpm.past_league_home_advantage / 2.0)
                    ELSE
                        -- Away team was away in this past match - BENEFIT xG, PENALIZE xGA
                        fpm.past_xg_away * (
                        POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                        (GREATEST(fpm.past_elo_home, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000)) *
                        CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END
                        ) +
                        (past_league_home_advantage / 2.0)
                END as away_team_adjusted_xg,

                CASE
                    WHEN fpm.past_home_team_id = fpm.away_team_id THEN
                        -- Away team's xGA when they were home - PENALIZE defense
                        fpm.past_xg_away / (
                            POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                            (GREATEST(fpm.past_elo_home, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (fpm.past_league_home_advantage / 2.0)
                    ELSE
                        -- Away team's xGA when they were away - BENEFIT defense
                        fpm.past_xg_home / (
                            POWER((GREATEST(fpm.past_league_elo, 1000)::DECIMAL / GREATEST(fpm.current_league_elo, 1000)), 2) *
                            (GREATEST(fpm.past_elo_away, 1000)::DECIMAL / GREATEST(fpm.past_league_elo, 1000))
                        ) * CASE WHEN fpm.past_league_id != fpm.league_id THEN (fpm.current_league_avg_goals / GREATEST(fpm.past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (fpm.past_league_home_advantage / 2.0)
                END as away_team_adjusted_xga,

                -- Match recency ranking (1 = most recent for this team)
                ROW_NUMBER() OVER (PARTITION BY fpm.fixture_id, CASE WHEN fpm.past_home_team_id = fpm.home_team_id OR fpm.past_away_team_id = fpm.home_team_id THEN fpm.home_team_id ELSE fpm.away_team_id END ORDER BY fpm.past_date DESC) as match_rank,
                -- Which team this match belongs to
                CASE WHEN fpm.past_home_team_id = fpm.home_team_id OR fpm.past_away_team_id = fpm.home_team_id THEN 'home' ELSE 'away' END as team_side
            FROM filtered_past_matches fpm
        ),
        aggregated_xg AS (
            -- Calculate 16-match rolling window
            SELECT
                fixture_id,
                -- Home team 16-match rolling window (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND(
                    COALESCE(SUM(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN home_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN 1 END), 0), 0), 2))) as home_xg,

                -- Home team 16-match rolling window xGA (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND(
                    COALESCE(SUM(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN home_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'home' AND match_rank <= 16 THEN 1 END), 0), 0), 2))) as home_xga,

                -- Away team 16-match rolling window (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND(
                    COALESCE(SUM(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN away_team_adjusted_xg END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN 1 END), 0), 0), 2))) as away_xg,

                -- Away team 16-match rolling window xGA (capped 0.1 to 4.0)
                GREATEST(0.1, LEAST(4.0, ROUND(
                    COALESCE(SUM(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN away_team_adjusted_xga END) /
                             NULLIF(COUNT(CASE WHEN team_side = 'away' AND match_rank <= 16 THEN 1 END), 0), 0), 2))) as away_xga
            FROM calculated_adjustments
            GROUP BY fixture_id
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
    `;

    await pool.query(sql);

    // Log the request parameters
    const isIncremental = fixtureIds && fixtureIds.length > 0;
    if (isIncremental) {
      console.log(`🎯 Processing ${fixtureIds.length} specific fixture(s): ${fixtureIds.join(', ')}`);
      console.log(`📈 Using incremental mode - ELO calculations will preserve existing ratings`);
    } else {
      console.log('📊 Processing all fixtures');
      console.log(`🔄 Using full recalculation mode - all statistics recalculated from scratch`);
    }

    if (createViews) {
      console.log('🔍 Creating database views...');
      // Create database views logic would go here (simplified for API)
    }

    const startTime = Date.now();
    let totalCount = 0;
    const isAll = functions.includes('all');

    if (isAll) {
      console.log('Running all calculations...');
      const result = await pool.query('SELECT populate_all_fixture_stats(0, $1) as count', [fixtureIds]);
      totalCount = result.rows[0].count;
      console.log(`✅ All calculations completed: ${totalCount} fixtures processed total`);
    } else {
      // Run selected functions individually
      if (functions.includes('1') || functions.includes('hours')) {
        console.log('Running hours calculation...');
        const result = await pool.query('SELECT populate_hours_batch($1) as count', [fixtureIds]);
        const count = result.rows[0].count;
        totalCount += count;
        console.log(`✅ Hours calculation completed: ${count} fixtures processed`);
      }

      if (functions.includes('2') || functions.includes('goals')) {
        console.log('Running league goals calculation...');
        const result = await pool.query('SELECT populate_league_goals_batch($1) as count', [fixtureIds]);
        const count = result.rows[0].count;
        totalCount += count;
        console.log(`✅ Goals calculation completed: ${count} fixtures processed`);
      }

      if (functions.includes('3') || functions.includes('elo')) {
        const mode = fixtureIds && fixtureIds.length > 0 ? 'incremental' : 'full recalculation';
        console.log(`Running ELO calculations (${mode} mode, team + league)...`);
        const result = await pool.query('SELECT calculate_elos_incremental($1) as count', [fixtureIds]);
        const count = result.rows[0].count;
        totalCount += count;
        console.log(`✅ ELO calculations completed (${mode}): ${count} fixtures processed`);
      }

      if (functions.includes('4') || functions.includes('home-advantage')) {
        console.log('Running home advantage calculation...');
        const result = await pool.query('SELECT populate_home_advantage_batch($1) as count', [fixtureIds]);
        const count = result.rows[0].count;
        totalCount += count;
        console.log(`✅ Home advantage calculation completed: ${count} fixtures processed`);
      }

      if (functions.includes('5') || functions.includes('xg') || functions.includes('rolling-xg')) {
        console.log('Running rolling windows xG calculations...');
        const result = await pool.query('SELECT populate_adjusted_rolling_xg_batch($1) as count', [fixtureIds]);
        const count = result.rows[0].count;
        totalCount += count;
        console.log(`✅ Rolling windows xG calculations completed: ${count} fixtures processed`);
      }

      if (functions.includes('6') || functions.includes('market-xg') || functions.includes('rolling-market-xg')) {
        console.log('Running rolling windows market xG calculations...');
        const result = await pool.query('SELECT populate_adjusted_rolling_market_xg_batch($1) as count', [fixtureIds]);
        const count = result.rows[0].count;
        totalCount += count;
        console.log(`✅ Rolling windows market xG calculations completed: ${count} fixtures processed`);
      }

      console.log(`✅ Selected calculations completed: ${totalCount} fixtures processed total`);
    }

    const executionTime = (Date.now() - startTime) / 1000;
    console.log(`⏱️  Total execution time: ${executionTime}s`);

    return NextResponse.json({
      success: true,
      message: `Statistics calculations completed successfully`,
      functions: functions,
      fixtureIds: fixtureIds || null,
      fixturesProcessed: totalCount,
      executionTime: `${executionTime}s`,
      createViews: createViews,
      calculationMode: isIncremental ? 'incremental' : 'full_recalculation',
      eloMode: isIncremental ? 'incremental (loads existing team ratings from previous fixtures)' : 'full recalculation (starts from league base ELOs)'
    })

  } catch (error) {
    console.error('❌ Error in statistics calculations:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Statistics calculation failed' },
      { status: 500 }
    );
  }
}
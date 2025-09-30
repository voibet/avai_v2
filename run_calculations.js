/**
 * Football Statistics Calculator
 *
 * This script populates the football_stats table with calculated metrics for fixtures:
 * - Hours since last match for home and away teams (includes all scheduled matches)
 * - League average goals (rolling average of last 300 matches)
 * - Home advantage (average home_goals - away_goals for past 300 matches, capped 0.1-0.6)
 * - ELO ratings (team ELOs + league ELOs as average of team ELOs)
 * - Rolling xG and xGA (8, 16, 32 match windows averaged)
 * - Rolling market xG and xGA (8, 16, 32 match windows averaged using market odds)
 *
 * Uses team IDs for all database operations and calculations.
 * Designed for batch processing of large datasets with performance optimization.
 *
 * USAGE:
 * RUN: $env:DB_USER='postgres'; $env:DB_PASSWORD='NopoONpelle31?'; $env:DB_HOST='172.29.253.202'; $env:DB_PORT='5432'; $env:DB_NAME='mydb'; $env:DB_SSL='false'; npx ts-node run_calculations.js [function] [--fixture-ids=id1,id2,id3] [--skip-views]
 *
 * OPTIONS:
 *   function: '1' or 'hours', '2' or 'goals', '3' or 'elo', '4' or 'home-advantage', '5' or 'xg' or 'rolling-xg', '6' or 'market-xg' or 'rolling-market-xg', 'all' (default)
 *   Multiple functions can be specified comma-separated, e.g., '2,5,6' to run goals, rolling-xg, and market-xg calculations
 *   --fixture-ids=id1,id2,id3: Process only specific fixture IDs (comma-separated)
 *   --skip-views: Skip creating database views (faster execution)
 */

import pool from './lib/db.ts';
import fs from 'fs';


async function runCalculations() {
  try {
    console.log('🚀 Running calculations...');

    // Load league ELO data from JSON file
    let leagueEloData;
    try {
      const leagueEloJson = fs.readFileSync('./leagues_elo.json', 'utf8');
      leagueEloData = JSON.parse(leagueEloJson);
      console.log(`📊 Loaded ${leagueEloData.length} league ELO ratings`);
    } catch (error) {
      console.error('❌ Error loading leagues_elo.json:', error.message);
      return;
    }

    // Create dynamic INSERT statement for league ELO data
    const leagueEloValues = leagueEloData
      .filter(league => league.elo !== null)
      .map(league => `(${league.league_id}, ${league.elo})`)
      .join(',\n        ');

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
                WHEN lg.fixture_count < 15 THEN 2.70
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
                WHEN ha.fixture_count < 15 THEN 0.30
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

    -- Create team ELO table if it doesn't exist
    CREATE TABLE IF NOT EXISTS team_elo (
        team_id BIGINT PRIMARY KEY,
        league_id BIGINT,
        elo_rating INTEGER NOT NULL DEFAULT 1500,
        last_updated TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (team_id) REFERENCES football_teams(id),
        FOREIGN KEY (league_id) REFERENCES football_leagues(id)
    );

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
        CREATE TEMP TABLE league_elo_ratings (
            league_id BIGINT PRIMARY KEY,
            base_elo INTEGER
        );

        -- Load league ELO data dynamically
        INSERT INTO league_elo_ratings (league_id, base_elo) VALUES
        ${leagueEloValues};

        -- Reset team ELOs to initial league-based state (will be recalculated)
        UPDATE team_elo SET elo_rating = (
            SELECT COALESCE(base_elo, 1500)
            FROM league_elo_ratings
            WHERE league_elo_ratings.league_id = team_elo.league_id
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
            IF NOT EXISTS (SELECT 1 FROM team_elo WHERE team_id = fixture_record.home_team_id) THEN
                INSERT INTO team_elo (team_id, league_id, elo_rating)
                VALUES (fixture_record.home_team_id, fixture_record.league_id, league_base_elo);
            END IF;

            -- Get or create away team ELO
            IF NOT EXISTS (SELECT 1 FROM team_elo WHERE team_id = fixture_record.away_team_id) THEN
                INSERT INTO team_elo (team_id, league_id, elo_rating)
                VALUES (fixture_record.away_team_id, fixture_record.league_id, league_base_elo);
            END IF;

            -- Get current ELO ratings (before this match)
            SELECT elo_rating INTO home_elo FROM team_elo WHERE team_id = fixture_record.home_team_id;
            SELECT elo_rating INTO away_elo FROM team_elo WHERE team_id = fixture_record.away_team_id;

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

                    -- Convert XG results to ELO score using sigmoid function
                    -- This gives a smooth transition from 0 to 1 based on XG difference
                    -- Small differences (0.9 vs 0.8) give scores close to 0.5
                    -- Large differences (2.0 vs 0.5) give scores close to 1.0 or 0.0

                    -- Use sigmoid function to convert XG difference to ELO score
                    -- Formula: score = 1 / (1 + e^(-diff * scaling_factor))
                    -- Scaling factor of 2 makes reasonable transitions for XG differences
                    actual_home_score := 1.0 / (1.0 + EXP(-(actual_home_score - actual_away_score) * 2.0));
                    actual_away_score := 1.0 - actual_home_score;

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
                    UPDATE team_elo SET elo_rating = new_home_elo, last_updated = NOW()
                    WHERE team_id = fixture_record.home_team_id;

                    UPDATE team_elo SET elo_rating = new_away_elo, last_updated = NOW()
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

        -- Clean up
        DROP TABLE league_elo_ratings;

        RETURN updated_count;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to calculate adjusted rolling xG and xGA using rolling windows (8, 16, 32 matches averaged)
    CREATE OR REPLACE FUNCTION populate_adjusted_rolling_xg_batch(fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
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
            -- Cross join with all past matches for both home and away teams
            CROSS JOIN LATERAL (
                SELECT pf.id, pf.date, pf.league_id, pf.home_team_id, pf.away_team_id, pf.xg_home, pf.xg_away, pf.goals_home, pf.goals_away
                FROM football_fixtures pf
                WHERE (pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id
                       OR pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id)
                  AND pf.date < fd.fixture_date
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
        calculated_adjustments AS (
            -- Calculate adjusted xG for each past match from both home and away perspectives
            SELECT
                fixture_id,
                past_match_id,
                -- Home team perspective
                CASE
                    WHEN past_home_team_id = home_team_id THEN
                        -- Home team was home in this past match - PENALIZE xG, BENEFIT xGA
                        past_xg_home * (
                        POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                        (GREATEST(past_elo_away, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (past_league_home_advantage / 2.0)
                    ELSE
                        -- Home team was away in this past match - BENEFIT xG, PENALIZE xGA
                        past_xg_away * (
                        POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                        (GREATEST(past_elo_home, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (past_league_home_advantage / 2.0)
                END as home_team_adjusted_xg,

                CASE
                    WHEN past_home_team_id = home_team_id THEN
                        -- Home team's xGA when they were home - PENALIZE defense
                        past_xg_away / (
                            POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                            (GREATEST(past_elo_home, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (past_league_home_advantage / 2.0)
                    ELSE
                        -- Home team's xGA when they were away - BENEFIT defense
                        past_xg_home / (
                            POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                            (GREATEST(past_elo_away, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (past_league_home_advantage / 2.0)
                END as home_team_adjusted_xga,

                -- Away team perspective
                CASE
                    WHEN past_home_team_id = away_team_id THEN
                        -- Away team was home in this past match - PENALIZE xG, BENEFIT xGA
                        past_xg_home * (
                        POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                        (GREATEST(past_elo_away, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (past_league_home_advantage / 2.0)
                    ELSE
                        -- Away team was away in this past match - BENEFIT xG, PENALIZE xGA
                        past_xg_away * (
                        POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                        (GREATEST(past_elo_home, 1000)::DECIMAL / GREATEST(past_league_elo, 1000)) *
                        CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END 
                        ) +
                        (past_league_home_advantage / 2.0)
                END as away_team_adjusted_xg,

                CASE
                    WHEN past_home_team_id = away_team_id THEN
                        -- Away team's xGA when they were home - PENALIZE defense
                        past_xg_away / (
                            POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                            (GREATEST(past_elo_home, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (past_league_home_advantage / 2.0)
                    ELSE
                        -- Away team's xGA when they were away - BENEFIT defense
                        past_xg_home / (
                            POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                            (GREATEST(past_elo_away, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (past_league_home_advantage / 2.0)
                END as away_team_adjusted_xga,

                -- Match recency ranking (1 = most recent for this team)
                ROW_NUMBER() OVER (PARTITION BY fixture_id, CASE WHEN past_home_team_id = home_team_id OR past_away_team_id = home_team_id THEN home_team_id ELSE away_team_id END ORDER BY past_date DESC) as match_rank,
                -- Which team this match belongs to
                CASE WHEN past_home_team_id = home_team_id OR past_away_team_id = home_team_id THEN 'home' ELSE 'away' END as team_side
            FROM all_past_matches
        ),
        aggregated_xg AS (
            -- Calculate rolling windows (8, 16, 32 matches) then average them
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

    -- Function to calculate adjusted rolling market xG and xGA using rolling windows (8, 16, 32 matches averaged)
    CREATE OR REPLACE FUNCTION populate_adjusted_rolling_market_xg_batch(fixture_ids BIGINT[] DEFAULT NULL) RETURNS INTEGER AS $$
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
                GREATEST(0.1, LEAST(5, COALESCE(mxgv.home_market_xg, pm.xg_home, pm.goals_home, 0))) as past_xg_home,
                GREATEST(0.1, LEAST(5, COALESCE(mxgv.away_market_xg, pm.xg_away, pm.goals_away, 0))) as past_xg_away,
                pms.elo_home as past_elo_home,
                pms.elo_away as past_elo_away,
                pms.league_elo as past_league_elo,
                pms.avg_goals_league as past_league_avg_goals,
                pms.home_advantage as past_league_home_advantage
            FROM fixture_data fd
            -- Cross join with all past matches for both home and away teams
            CROSS JOIN LATERAL (
                SELECT pf.id, pf.date, pf.league_id, pf.home_team_id, pf.away_team_id, pf.xg_home, pf.xg_away, pf.goals_home, pf.goals_away
                FROM football_fixtures pf
                WHERE (pf.home_team_id = fd.home_team_id OR pf.away_team_id = fd.home_team_id
                       OR pf.home_team_id = fd.away_team_id OR pf.away_team_id = fd.away_team_id)
                  AND pf.date < fd.fixture_date
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
            LEFT JOIN market_xg_view mxgv ON pm.id = mxgv.fixture_id
            WHERE pms.elo_home IS NOT NULL AND pms.elo_away IS NOT NULL AND pms.league_elo IS NOT NULL
                  AND pms.avg_goals_league IS NOT NULL
        ),
        calculated_adjustments AS (
            -- Calculate adjusted xG for each past match from both home and away perspectives
            SELECT
                fixture_id,
                past_match_id,
                -- Home team perspective
                CASE
                    WHEN past_home_team_id = home_team_id THEN
                        -- Home team was home in this past match - PENALIZE xG, BENEFIT xGA
                        past_xg_home * (
                        POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                        (GREATEST(past_elo_away, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (past_league_home_advantage / 2.0)
                    ELSE
                        -- Home team was away in this past match - BENEFIT xG, PENALIZE xGA
                        past_xg_away * (
                        POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                        (GREATEST(past_elo_home, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (past_league_home_advantage / 2.0)
                END as home_team_adjusted_xg,

                CASE
                    WHEN past_home_team_id = home_team_id THEN
                        -- Home team's xGA when they were home - PENALIZE defense
                        past_xg_away / (
                            POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                            (GREATEST(past_elo_home, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (past_league_home_advantage / 2.0)
                    ELSE
                        -- Home team's xGA when they were away - BENEFIT defense
                        past_xg_home / (
                            POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                            (GREATEST(past_elo_away, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (past_league_home_advantage / 2.0)
                END as home_team_adjusted_xga,

                -- Away team perspective
                CASE
                    WHEN past_home_team_id = away_team_id THEN
                        -- Away team was home in this past match - PENALIZE xG, BENEFIT xGA
                        past_xg_home * (
                        POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                        (GREATEST(past_elo_away, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (past_league_home_advantage / 2.0)
                    ELSE
                        -- Away team was away in this past match - BENEFIT xG, PENALIZE xGA
                        past_xg_away * (
                        POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                        (GREATEST(past_elo_home, 1000)::DECIMAL / GREATEST(past_league_elo, 1000)) *
                        CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END 
                        ) +
                        (past_league_home_advantage / 2.0)
                END as away_team_adjusted_xg,

                CASE
                    WHEN past_home_team_id = away_team_id THEN
                        -- Away team's xGA when they were home - PENALIZE defense
                        past_xg_away / (
                            POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                            (GREATEST(past_elo_home, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END +
                        (past_league_home_advantage / 2.0)
                    ELSE
                        -- Away team's xGA when they were away - BENEFIT defense
                        past_xg_home / (
                            POWER((GREATEST(past_league_elo, 1000)::DECIMAL / GREATEST(current_league_elo, 1000)), 2) *
                            (GREATEST(past_elo_away, 1000)::DECIMAL / GREATEST(past_league_elo, 1000))
                        ) * CASE WHEN past_league_id != league_id THEN (current_league_avg_goals / GREATEST(past_league_avg_goals, 1.0)) ELSE 1.0 END -
                        (past_league_home_advantage / 2.0)
                END as away_team_adjusted_xga,

                -- Match recency ranking (1 = most recent for this team)
                ROW_NUMBER() OVER (PARTITION BY fixture_id, CASE WHEN past_home_team_id = home_team_id OR past_away_team_id = home_team_id THEN home_team_id ELSE away_team_id END ORDER BY past_date DESC) as match_rank,
                -- Which team this match belongs to
                CASE WHEN past_home_team_id = home_team_id OR past_away_team_id = home_team_id THEN 'home' ELSE 'away' END as team_side
            FROM all_past_matches
        ),
        aggregated_xg AS (
            -- Calculate rolling windows (8, 16, 32 matches) then average them
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

        RAISE NOTICE 'Starting rolling windows market xG calculations...';
        SELECT populate_adjusted_rolling_market_xg_batch(fixture_ids) INTO market_xg_count;
        RAISE NOTICE 'Rolling windows market xG calculations completed: %', market_xg_count;

        RETURN GREATEST(hours_count, goals_count, home_advantage_count, elo_count, xg_count, market_xg_count);
    END;
    $$ LANGUAGE plpgsql;
    `;
    await pool.query(sql);

    // Parse command line arguments
    const args = process.argv.slice(2);
    let functionsToRun = ['all']; // default to all
    let fixtureIds = null;
    let skipViews = false;

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
      } else if (arg === '--skip-views') {
        skipViews = true;
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

    // Drop existing functions first to avoid conflicts
    console.log('Dropping existing functions...');
    try {
        // Get all functions with our names and drop them
        const existingFunctions = await pool.query(`
            SELECT proname, pg_get_function_identity_arguments(oid) as args
            FROM pg_proc
            WHERE proname IN ('populate_hours_batch', 'populate_league_goals_batch',
                            'populate_home_advantage_batch', 'calculate_elos_incremental',
                            'populate_adjusted_rolling_xg_batch', 'populate_all_fixture_stats')
            AND pg_function_is_visible(oid);
        `);

        for (const func of existingFunctions.rows) {
            try {
                await pool.query(`DROP FUNCTION ${func.proname}(${func.args}) CASCADE`);
            } catch (e) {
            }
        }
    } catch (error) {
    }

    if (!skipViews) {
      // Drop dependent views first to avoid dependency conflicts
      console.log('Dropping dependent views...');
    try {
      await pool.query('DROP VIEW IF EXISTS fair_odds_view CASCADE');
      await pool.query('DROP VIEW IF EXISTS market_xg_view CASCADE');
      await pool.query('DROP VIEW IF EXISTS predicted_xg_view CASCADE');
      await pool.query('DROP VIEW IF EXISTS predicted_market_xg_view CASCADE');
      await pool.query('DROP VIEW IF EXISTS payout_view CASCADE');
      console.log('✅ Dependent views dropped successfully');
    } catch (error) {
      console.log('⚠️  Some views may not exist, continuing...');
    }

    // Create payout view
    console.log('Creating payout view...');
    try {
      const payoutViewSQL = `
      -- View to calculate payout percentages (bookmaker margin) from latest odds data
      -- Payout shows total implied probability (should be > 1.0 due to margin)
      -- For 2-way markets: payout = 1 / ((1/odds1) + (1/odds2))
      -- For 3-way markets: payout = 1 / ((1/odds1) + (1/odds2) + (1/odds3))
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
      `;
      await pool.query(payoutViewSQL);
      console.log('✅ Payout view created successfully');
    } catch (error) {
      console.error('❌ Error creating payout view:', error.message);
    }

    // Create fair odds view
    console.log('Creating fair odds view...');
    try {
      const fairOddsViewSQL = `
        -- View to calculate fair odds (no vig/no margin) from latest odds data
        -- Fair odds remove the bookmaker's margin by normalizing implied probabilities
        -- For 2-way markets: fair_odds = 1 / (implied_prob / total_implied_prob)
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
                                    (
                                        1.0 / (
                                            (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) /
                                            (
                                                (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                                (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                            )
                                        )
                                    )::numeric,
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
                                    (
                                        1.0 / (
                                            (1.0 / (a_odds::numeric / POWER(10, fo.decimals))) /
                                            (
                                                (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                                (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                            )
                                        )
                                    )::numeric,
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
        `;
      await pool.query(fairOddsViewSQL);
      console.log('✅ Fair odds view created successfully');
    } catch (error) {
      console.error('❌ Error creating fair odds view:', error.message);
    }

    // Create market XG view
    console.log('Creating market XG view...');
    try {
      const marketXGViewSQL = `
        -- View to calculate market expected goals (XG) from fair odds
        -- Matches the calculation logic from market_xg_calculator.py exactly
        CREATE VIEW market_xg_view AS
        WITH poisson_lookup AS (
            -- Pre-computed Poisson lookup table for fast total goals estimation
            -- Lambda values from 1.50 to 3.50 in 0.01 increments
            SELECT
                lambda_val / 100.0 as lambda_val,
                -- Calculate cumulative probabilities P(X <= 2)
                -- P(X <= 0) = e^(-λ)
                -- P(X <= 1) = P(X <= 0) + λ * P(X <= 0)
                -- P(X <= 2) = P(X <= 1) + (λ²/2) * P(X <= 0)
                -- P(X > 2.5) = 1 - P(X <= 2)
                ROUND(EXP(-lambda_val / 100.0)::numeric, 6) as p_le_0,
                ROUND((EXP(-lambda_val / 100.0) + (lambda_val / 100.0) * EXP(-lambda_val / 100.0))::numeric, 6) as p_le_1,
                ROUND((EXP(-lambda_val / 100.0) + (lambda_val / 100.0) * EXP(-lambda_val / 100.0) + POWER(lambda_val / 100.0, 2) / 2 * EXP(-lambda_val / 100.0))::numeric, 6) as p_le_2,
                ROUND((1.0 - (EXP(-lambda_val / 100.0) + (lambda_val / 100.0) * EXP(-lambda_val / 100.0) + POWER(lambda_val / 100.0, 2) / 2 * EXP(-lambda_val / 100.0)))::numeric, 6) as p_over_25
            FROM generate_series(150, 350) as lambda_val
        ),
        fixture_odds AS (
            -- Get fixtures with fair odds and league average goals
            SELECT
                f.id as fixture_id,
                f.league_id,
                fs.avg_goals_league,
                -- Extract X12 fair odds
                CASE
                    WHEN fov.fair_odds_x12 IS NOT NULL THEN
                        (fov.fair_odds_x12->'fair_x12'->>0)::numeric / POWER(10, fov.decimals)
                    ELSE NULL
                END as x12_home_fair,
                CASE
                    WHEN fov.fair_odds_x12 IS NOT NULL THEN
                        (fov.fair_odds_x12->'fair_x12'->>1)::numeric / POWER(10, fov.decimals)
                    ELSE NULL
                END as x12_draw_fair,
                CASE
                    WHEN fov.fair_odds_x12 IS NOT NULL THEN
                        (fov.fair_odds_x12->'fair_x12'->>2)::numeric / POWER(10, fov.decimals)
                    ELSE NULL
                END as x12_away_fair,
                -- Extract OU 2.5 fair odds by finding the correct index in lines
                CASE
                    WHEN fov.fair_odds_ou IS NOT NULL AND fov.latest_lines IS NOT NULL THEN
                        (fov.fair_odds_ou->'fair_ou_o'->>(array_position((fov.latest_lines->'ou')::numeric[], 2.5) - 1))::numeric / POWER(10, fov.decimals)
                    ELSE NULL
                END as ou25_fair
            FROM football_fixtures f
            LEFT JOIN football_stats fs ON f.id = fs.fixture_id
            LEFT JOIN fair_odds_view fov ON f.id = fov.fixture_id
            WHERE fov.fair_odds_x12 IS NOT NULL
        )
        SELECT
            fo.fixture_id,
            -- Convert fair odds to probabilities
            CASE WHEN fo.x12_home_fair > 0 THEN ROUND((1.0 / fo.x12_home_fair)::numeric, 3) ELSE NULL END as home_win_prob,
            CASE WHEN fo.x12_draw_fair > 0 THEN ROUND((1.0 / fo.x12_draw_fair)::numeric, 3) ELSE NULL END as draw_prob,
            CASE WHEN fo.x12_away_fair > 0 THEN ROUND((1.0 / fo.x12_away_fair)::numeric, 3) ELSE NULL END as away_win_prob,

            -- Estimate total goals using OU 2.5 odds or league average
            CASE
                WHEN fo.ou25_fair IS NOT NULL AND fo.ou25_fair > 0 THEN
                    -- Use Poisson lookup to estimate total goals from Over 2.5 probability
                    (
                        SELECT ROUND(pl.lambda_val::numeric, 2)
                        FROM poisson_lookup pl
                        WHERE pl.p_over_25 = (
                            SELECT pl2.p_over_25
                            FROM poisson_lookup pl2
                            ORDER BY ABS(pl2.p_over_25 - (1.0 / fo.ou25_fair))
                            LIMIT 1
                        )
                        LIMIT 1
                    )
                ELSE COALESCE(fo.avg_goals_league, 2.70)
            END as total_goals,

            -- Goals source for transparency
            CASE
                WHEN fo.ou25_fair IS NOT NULL AND fo.ou25_fair > 0 THEN
                    'OU ' || ROUND(fo.ou25_fair::numeric, 3) || ' (prob: ' || ROUND((1.0 / fo.ou25_fair)::numeric, 3) || ')'
                ELSE 'League avg ' || COALESCE(ROUND(fo.avg_goals_league::numeric, 2), 2.70)
            END as goals_source,

            -- Calculate team strengths
            CASE
                WHEN fo.x12_home_fair > 0 AND fo.x12_draw_fair > 0 THEN
                    ROUND(
                        (
                            (1.0 / fo.x12_home_fair) /
                            ((1.0 / fo.x12_home_fair) + (1.0 / fo.x12_draw_fair) / 0.5)
                        )::numeric,
                        3
                    )
                ELSE NULL
            END as home_strength,

            CASE
                WHEN fo.x12_away_fair > 0 AND fo.x12_draw_fair > 0 THEN
                    ROUND(
                        (
                            (1.0 / fo.x12_away_fair) /
                            ((1.0 / fo.x12_away_fair) + (1.0 / fo.x12_draw_fair) / 0.5)
                        )::numeric,
                        3
                    )
                ELSE NULL
            END as away_strength,

            -- Calculate market XG
            CASE
                WHEN fo.x12_home_fair > 0 AND fo.x12_draw_fair > 0 THEN
                    ROUND(
                        (
                            (
                                CASE
                                    WHEN fo.ou25_fair IS NOT NULL AND fo.ou25_fair > 0 THEN
                                        (
                                            SELECT pl.lambda_val
                                            FROM poisson_lookup pl
                                            WHERE pl.p_over_25 = (
                                                SELECT pl2.p_over_25
                                                FROM poisson_lookup pl2
                                                ORDER BY ABS(pl2.p_over_25 - (1.0 / fo.ou25_fair))
                                                LIMIT 1
                                            )
                                            LIMIT 1
                                        )
                                    ELSE COALESCE(fo.avg_goals_league, 2.70)
                                END
                            ) * (
                                (1.0 / fo.x12_home_fair) /
                                ((1.0 / fo.x12_home_fair) + (1.0 / fo.x12_draw_fair) / 0.5)
                            )
                        )::numeric,
                        2
                    )
                ELSE NULL
            END as home_market_xg,

            CASE
                WHEN fo.x12_away_fair > 0 AND fo.x12_draw_fair > 0 THEN
                    ROUND(
                        (
                            (
                                CASE
                                    WHEN fo.ou25_fair IS NOT NULL AND fo.ou25_fair > 0 THEN
                                        (
                                            SELECT pl.lambda_val
                                            FROM poisson_lookup pl
                                            WHERE pl.p_over_25 = (
                                                SELECT pl2.p_over_25
                                                FROM poisson_lookup pl2
                                                ORDER BY ABS(pl2.p_over_25 - (1.0 / fo.ou25_fair))
                                                LIMIT 1
                                            )
                                            LIMIT 1
                                        )
                                    ELSE COALESCE(fo.avg_goals_league, 2.70)
                                END
                            ) * (
                                (1.0 / fo.x12_away_fair) /
                                ((1.0 / fo.x12_away_fair) + (1.0 / fo.x12_draw_fair) / 0.5)
                            )
                        )::numeric,
                        2
                    )
                ELSE NULL
            END as away_market_xg,

            -- Total market XG
            CASE
                WHEN fo.x12_home_fair > 0 AND fo.x12_draw_fair > 0 AND fo.x12_away_fair > 0 THEN
                    ROUND(
                        (
                            (
                                CASE
                                    WHEN fo.ou25_fair IS NOT NULL AND fo.ou25_fair > 0 THEN
                                        (
                                            SELECT pl.lambda_val
                                            FROM poisson_lookup pl
                                            WHERE pl.p_over_25 = (
                                                SELECT pl2.p_over_25
                                                FROM poisson_lookup pl2
                                                ORDER BY ABS(pl2.p_over_25 - (1.0 / fo.ou25_fair))
                                                LIMIT 1
                                            )
                                            LIMIT 1
                                        )
                                    ELSE COALESCE(fo.avg_goals_league, 2.70)
                                END
                            ) * (
                                (
                                    (1.0 / fo.x12_home_fair) /
                                    ((1.0 / fo.x12_home_fair) + (1.0 / fo.x12_draw_fair) / 0.5)
                                ) + (
                                    (1.0 / fo.x12_away_fair) /
                                    ((1.0 / fo.x12_away_fair) + (1.0 / fo.x12_draw_fair) / 0.5)
                                )
                            )
                        )::numeric,
                        2
                    )
                ELSE NULL
            END as total_market_xg

        FROM fixture_odds fo
        WHERE fo.x12_home_fair IS NOT NULL
          AND fo.x12_draw_fair IS NOT NULL
          AND fo.x12_away_fair IS NOT NULL;
      `;
      await pool.query(marketXGViewSQL);
      console.log('✅ Market XG view created successfully');
    } catch (error) {
      console.error('❌ Error creating market XG view:', error.message);
    }

    // Create predicted XG view
    console.log('Creating predicted XG view...');
    try {
      const predictedXGViewSQL = `
        -- View to calculate predicted XG using rolling XG and rolling market XG/XGA
        -- Home predicted: home rolling xg / (league avg goals / 2) * away rolling xga + (home advantage / 2)
        -- Away predicted: away rolling xg / (league avg goals / 2) * home rolling xga - (home advantage / 2)
        CREATE VIEW predicted_xg_view AS
        SELECT
            f.id as fixture_id,
            f.home_team_name,
            f.away_team_name,
            f.league_id,
            fs.avg_goals_league,
            fs.home_advantage,
            fs.adjusted_rolling_xg_home,
            fs.adjusted_rolling_xga_home,
            fs.adjusted_rolling_xg_away,
            fs.adjusted_rolling_xga_away,
            -- Home predicted XG
            ROUND(
                (
                    fs.adjusted_rolling_xg_home / (fs.avg_goals_league / 2.0)
                    * fs.adjusted_rolling_xga_away + (fs.home_advantage / 2.0)
                )::numeric,
                2
            ) as home_predicted_xg,
            -- Away predicted XG
            ROUND(
                (
                    fs.adjusted_rolling_xg_away / (fs.avg_goals_league / 2.0)
                    * fs.adjusted_rolling_xga_home - (fs.home_advantage / 2.0)
                )::numeric,
                2
            ) as away_predicted_xg,
            -- Total predicted XG
            ROUND(
                (
                    (
                        fs.adjusted_rolling_xg_home / (fs.avg_goals_league / 2.0)
                        * fs.adjusted_rolling_xga_away + (fs.home_advantage / 2.0)
                    ) + (
                        fs.adjusted_rolling_xg_away / (fs.avg_goals_league / 2.0)
                        * fs.adjusted_rolling_xga_home - (fs.home_advantage / 2.0)
                    )
                )::numeric,
                2
            ) as total_predicted_xg
        FROM football_fixtures f
        JOIN football_stats fs ON f.id = fs.fixture_id
        WHERE fs.adjusted_rolling_xg_home IS NOT NULL
          AND fs.adjusted_rolling_xga_home IS NOT NULL
          AND fs.adjusted_rolling_xg_away IS NOT NULL
          AND fs.adjusted_rolling_xga_away IS NOT NULL
          AND fs.avg_goals_league IS NOT NULL
          AND fs.home_advantage IS NOT NULL;
      `;
      await pool.query(predictedXGViewSQL);
      console.log('✅ Predicted XG view created successfully');
    } catch (error) {
      console.error('❌ Error creating predicted XG view:', error.message);
    }

    // Create predicted market XG view
    console.log('Creating predicted market XG view...');
    try {
      const predictedMarketXGViewSQL = `
        -- View to calculate predicted XG using rolling market XG and rolling market XG/XGA
        -- Home predicted: home rolling market xg / (league avg goals / 2) * away rolling market xga + (home advantage / 2)
        -- Away predicted: away rolling market xg / (league avg goals / 2) * home rolling market xga - (home advantage / 2)
        CREATE VIEW predicted_market_xg_view AS
        SELECT
            f.id as fixture_id,
            f.home_team_name,
            f.away_team_name,
            f.league_id,
            fs.avg_goals_league,
            fs.home_advantage,
            fs.adjusted_rolling_market_xg_home,
            fs.adjusted_rolling_market_xga_home,
            fs.adjusted_rolling_market_xg_away,
            fs.adjusted_rolling_market_xga_away,
            -- Home predicted market XG
            ROUND(
                (
                    fs.adjusted_rolling_market_xg_home / (fs.avg_goals_league / 2.0)
                    * fs.adjusted_rolling_market_xga_away + (fs.home_advantage / 2.0)
                )::numeric,
                2
            ) as home_predicted_market_xg,
            -- Away predicted market XG
            ROUND(
                (
                    fs.adjusted_rolling_market_xg_away / (fs.avg_goals_league / 2.0)
                    * fs.adjusted_rolling_market_xga_home - (fs.home_advantage / 2.0)
                )::numeric,
                2
            ) as away_predicted_market_xg,
            -- Total predicted market XG
            ROUND(
                (
                    (
                        fs.adjusted_rolling_market_xg_home / (fs.avg_goals_league / 2.0)
                        * fs.adjusted_rolling_market_xga_away + (fs.home_advantage / 2.0)
                    ) + (
                        fs.adjusted_rolling_market_xg_away / (fs.avg_goals_league / 2.0)
                        * fs.adjusted_rolling_market_xga_home - (fs.home_advantage / 2.0)
                    )
                )::numeric,
                2
            ) as total_predicted_market_xg
        FROM football_fixtures f
        JOIN football_stats fs ON f.id = fs.fixture_id
        WHERE fs.adjusted_rolling_market_xg_home IS NOT NULL
          AND fs.adjusted_rolling_market_xga_home IS NOT NULL
          AND fs.adjusted_rolling_market_xg_away IS NOT NULL
          AND fs.adjusted_rolling_market_xga_away IS NOT NULL
          AND fs.avg_goals_league IS NOT NULL
          AND fs.home_advantage IS NOT NULL;
      `;
      await pool.query(predictedMarketXGViewSQL);
      console.log('✅ Predicted market XG view created successfully');
    } catch (error) {
      console.error('❌ Error creating predicted market XG view:', error.message);
    }
    } else {
      console.log('⏭️  Skipping view creation as requested (--skip-views)');
    }

    // Create all functions
    console.log('Creating database functions...');
    await pool.query(sql);

    const startTime = Date.now();
    let totalCount = 0;
    const isAll = functionsToRun.includes('all') || functionsToRun.length === 0;

    if (isAll) {
        console.log('Running all calculations...');
        const result = await pool.query('SELECT populate_all_fixture_stats(0, $1) as count', [fixtureIds]);
        totalCount = result.rows[0].count;
        console.log(`✅ All calculations completed: ${totalCount} fixtures processed`);
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

        if (functionsToRun.includes('6') || functionsToRun.includes('market-xg') || functionsToRun.includes('rolling-market-xg')) {
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

    // Show relevant summaries based on what was run
    if (functionsToRun.includes('1') || functionsToRun.includes('hours') || isAll) {
        const hoursSummary = await pool.query(`
          SELECT
            COUNT(*) as total_fixtures,
            COUNT(CASE WHEN hours_since_last_match_home IS NOT NULL THEN 1 END) as with_home_hours,
            COUNT(CASE WHEN hours_since_last_match_away IS NOT NULL THEN 1 END) as with_away_hours,
            ROUND(AVG(hours_since_last_match_home), 1) as avg_home_hours,
            ROUND(AVG(hours_since_last_match_away), 1) as avg_away_hours
          FROM football_stats
        `);

        console.log('\n⏰ HOURS SINCE LAST MATCH SUMMARY:');
        console.table(hoursSummary.rows);
    }

    if (functionsToRun.includes('2') || functionsToRun.includes('goals') || isAll) {
        const goalsSummary = await pool.query(`
          SELECT
            COUNT(*) as fixtures_with_avg_goals,
            ROUND(AVG(avg_goals_league), 2) as overall_avg_goals,
            MIN(avg_goals_league) as min_league_goals,
            MAX(avg_goals_league) as max_league_goals
          FROM football_stats
          WHERE avg_goals_league IS NOT NULL
        `);

        console.log('\n🎯 LEAGUE GOALS SUMMARY:');
        console.table(goalsSummary.rows);
    }
    
    if (functionsToRun.includes('3') || functionsToRun.includes('elo') || isAll) {
        const eloSummary = await pool.query(`
          SELECT
            COUNT(*) as fixtures_with_team_elo,
            ROUND(AVG(elo_home), 0) as avg_home_elo,
            ROUND(AVG(elo_away), 0) as avg_away_elo,
            MIN(LEAST(elo_home, elo_away)) as min_team_elo,
            MAX(GREATEST(elo_home, elo_away)) as max_team_elo
          FROM football_stats
          WHERE elo_home IS NOT NULL AND elo_away IS NOT NULL
        `);

        console.log('\n🏆 TEAM ELO RATINGS SUMMARY:');
        console.table(eloSummary.rows);

        const leagueEloSummary = await pool.query(`
          SELECT
            COUNT(*) as fixtures_with_league_elo,
            ROUND(AVG(league_elo), 0) as avg_league_elo,
            MIN(league_elo) as min_league_elo,
            MAX(league_elo) as max_league_elo
          FROM football_stats
          WHERE league_elo IS NOT NULL
        `);

        console.log('\n🏟️ LEAGUE ELO SUMMARY:');
        console.table(leagueEloSummary.rows);

        const topTeams = await pool.query(`
          SELECT t.name, te.elo_rating, l.name as league_name
          FROM team_elo te
          JOIN football_teams t ON te.team_id = t.id
          JOIN football_leagues l ON te.league_id = l.id
          ORDER BY te.elo_rating DESC
          LIMIT 10
        `);

        console.log('\n⭐ TOP 10 TEAM ELO RATINGS:');
        console.table(topTeams.rows);
    }

    if (functionsToRun.includes('4') || functionsToRun.includes('home-advantage') || isAll) {
      const homeAdvantageSummary = await pool.query(`
        SELECT
          COUNT(*) as fixtures_with_home_advantage,
          ROUND(AVG(home_advantage), 2) as overall_avg_home_advantage,
          MIN(home_advantage) as min_home_advantage,
          MAX(home_advantage) as max_home_advantage
        FROM football_stats
        WHERE home_advantage IS NOT NULL
      `);

      console.log('\n🏠 HOME ADVANTAGE SUMMARY:');
      console.table(homeAdvantageSummary.rows);
    }

    if (functionsToRun.includes('5') || functionsToRun.includes('xg') || functionsToRun.includes('rolling-xg') || isAll) {
        const xgSummary = await pool.query(`
          SELECT
            COUNT(*) as fixtures_with_adjusted_xg,
            ROUND(AVG(adjusted_rolling_xg_home), 2) as avg_home_xg,
            ROUND(AVG(adjusted_rolling_xga_home), 2) as avg_home_xga,
            ROUND(AVG(adjusted_rolling_xg_away), 2) as avg_away_xg,
            ROUND(AVG(adjusted_rolling_xga_away), 2) as avg_away_xga,
            ROUND(MIN(adjusted_rolling_xg_home), 2) as min_home_xg,
            ROUND(MAX(adjusted_rolling_xg_home), 2) as max_home_xg,
            ROUND(MIN(adjusted_rolling_xga_home), 2) as min_home_xga,
            ROUND(MAX(adjusted_rolling_xga_home), 2) as max_home_xga
          FROM football_stats
          WHERE adjusted_rolling_xg_home IS NOT NULL
        `);

        console.log('\n⚽ ROLLING WINDOWS XG SUMMARY:');
        console.log('Note: Average of three rolling windows: 8, 16, and 32 match averages');
        console.table(xgSummary.rows);
    }

    if (functionsToRun.includes('6') || functionsToRun.includes('market-xg') || functionsToRun.includes('rolling-market-xg') || isAll) {
        const marketXgSummary = await pool.query(`
          SELECT
            COUNT(*) as fixtures_with_adjusted_market_xg,
            ROUND(AVG(adjusted_rolling_market_xg_home), 2) as avg_home_market_xg,
            ROUND(AVG(adjusted_rolling_market_xga_home), 2) as avg_home_market_xga,
            ROUND(AVG(adjusted_rolling_market_xg_away), 2) as avg_away_market_xg,
            ROUND(AVG(adjusted_rolling_market_xga_away), 2) as avg_away_market_xga,
            ROUND(MIN(adjusted_rolling_market_xg_home), 2) as min_home_market_xg,
            ROUND(MAX(adjusted_rolling_market_xg_home), 2) as max_home_market_xg,
            ROUND(MIN(adjusted_rolling_market_xga_home), 2) as min_home_market_xga,
            ROUND(MAX(adjusted_rolling_market_xga_home), 2) as max_home_market_xga
          FROM football_stats
          WHERE adjusted_rolling_market_xg_home IS NOT NULL
        `);

        console.log('\n💰 ROLLING WINDOWS MARKET XG SUMMARY:');
        console.log('Note: Average of three rolling windows: 8, 16, and 32 match averages using market odds');
        console.table(marketXgSummary.rows);
    }

    // Show sample results for completed calculations
    if (isAll || !functionsToRun.includes('3') && !functionsToRun.includes('elo')) {
        let sampleQuery = `
          SELECT f.id as fixture_id, f.home_team_name, f.away_team_name,
                 s.hours_since_last_match_home, s.hours_since_last_match_away,
                 s.league_elo, s.avg_goals_league, s.elo_home, s.elo_away,
                 s.home_advantage`;

        // Add xG columns if they exist and were calculated
        if (functionsToRun.includes('5') || functionsToRun.includes('xg') || functionsToRun.includes('rolling-xg') || isAll) {
            sampleQuery += `,
                 s.adjusted_rolling_xg_home, s.adjusted_rolling_xga_home,
                 s.adjusted_rolling_xg_away, s.adjusted_rolling_xga_away`;
        }

        // Add market xG columns if they exist and were calculated
        if (functionsToRun.includes('6') || functionsToRun.includes('market-xg') || functionsToRun.includes('rolling-market-xg') || isAll) {
            sampleQuery += `,
                 s.adjusted_rolling_market_xg_home, s.adjusted_rolling_market_xga_home,
                 s.adjusted_rolling_market_xg_away, s.adjusted_rolling_market_xga_away`;
        }

        sampleQuery += `
          FROM football_fixtures f
          JOIN football_stats s ON f.id = s.fixture_id
          WHERE s.avg_goals_league IS NOT NULL
          ORDER BY f.date DESC
          LIMIT 5`;

        const sample = await pool.query(sampleQuery);

        console.log('\n📅 SAMPLE RESULTS:');
        console.table(sample.rows);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

runCalculations();

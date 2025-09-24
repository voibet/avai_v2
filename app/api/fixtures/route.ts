import { NextResponse } from 'next/server';
import { withErrorHandler } from '../../../lib/db-utils';
import { createTableApiHandler } from '../../../lib/server-table-utils';
import { Fixture } from '../../../types/database';


export const dynamic = 'force-dynamic';

// Base query for fixtures
const FIXTURES_BASE_QUERY = `
  SELECT 
    id, referee, timestamp, date, venue_name, status_long, status_short,
    home_team_id, home_team_name, home_country,
    away_team_id, away_team_name, away_country,
    xg_home, xg_away, goals_home, goals_away,
    score_halftime_home, score_halftime_away,
    score_fulltime_home, score_fulltime_away,
    score_extratime_home, score_extratime_away,
    score_penalty_home, score_penalty_away,
    league_id, league_name, league_country, season, round,
    updated_at
  FROM football_fixtures
`;

// Column mapping
const COLUMN_MAPPING = {
  id: 'id', date: 'date', timestamp: 'timestamp', status_short: 'status_short',
  home_team_name: 'home_team_name', away_team_name: 'away_team_name', 
  league_name: 'league_name', season: 'season', round: 'round', 
  goals_home: 'goals_home', goals_away: 'goals_away',
  xg_home: 'xg_home', xg_away: 'xg_away', venue_name: 'venue_name', referee: 'referee'
};

// Searchable columns
const SEARCH_COLUMNS = ['home_team_name', 'away_team_name', 'league_name', 'venue_name', 'referee'];

// Create server-side handler
const fixturesHandler = createTableApiHandler<Fixture>(
  FIXTURES_BASE_QUERY, COLUMN_MAPPING, { column: 'date', direction: 'desc' }, SEARCH_COLUMNS
);

async function getFixtures(request: Request) {
  const result = await fixturesHandler(request);
  return NextResponse.json(result);
}

export const GET = withErrorHandler(getFixtures);

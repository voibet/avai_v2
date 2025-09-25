import { NextResponse } from 'next/server';
import { withErrorHandler } from '../../../lib/db-utils';
import { parseTableParams, executeTableQuery } from '../../../lib/server-table-utils';
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

// Custom handler to support date filters
async function getFixtures(request: Request) {
  const url = new URL(request.url);
  const params = parseTableParams(url.searchParams);
  
  // Add search columns
  params.searchColumns = SEARCH_COLUMNS;
  
  // Handle custom date filter
  const dateFilter = url.searchParams.get('date');
  if (dateFilter) {
    const now = new Date();
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    
    if (dateFilter === 'yesterday') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (dateFilter === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    } else if (dateFilter === 'tomorrow') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    } else if (dateFilter === 'last_7_days') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    } else if (dateFilter === 'next_7_days') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    }
    
    if (startDate && endDate) {
      // Add date range filter to params
      params.filters.push({
        column: 'date',
        value: startDate.toISOString(),
        operator: 'gte'
      });
      params.filters.push({
        column: 'date',
        value: endDate.toISOString(),
        operator: 'lt'
      });
    }
  }
  
  const result = await executeTableQuery<Fixture>(
    FIXTURES_BASE_QUERY,
    params,
    COLUMN_MAPPING,
    { column: 'date', direction: 'desc' }
  );
  
  return NextResponse.json(result);
}

export const GET = withErrorHandler(getFixtures);

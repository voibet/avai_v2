import { NextResponse } from 'next/server';
import { withErrorHandler, executeQuery } from '../../../lib/database/db-utils';
import { parseTableParams, executeTableQuery } from '../../../lib/utils/server-table-utils';
import { Fixture } from '@/types';


export const dynamic = 'force-dynamic';

// Base query for fixtures
const FIXTURES_BASE_QUERY = `
  SELECT
    f.id, f.referee, f.timestamp, f.date, f.venue_name, f.status_long, f.status_short,
    f.home_team_id, f.home_team_name, f.home_country,
    f.away_team_id, f.away_team_name, f.away_country,
    f.xg_home, f.xg_away, f.market_xg_home, f.market_xg_away, f.goals_home, f.goals_away,
    f.score_halftime_home, f.score_halftime_away,
    f.score_fulltime_home, f.score_fulltime_away,
    f.score_extratime_home, f.score_extratime_away,
    f.score_penalty_home, f.score_penalty_away,
    f.league_id, f.league_name, f.league_country, f.season, f.round,
    f.updated_at,
    p.home_pred, p.away_pred,
    fs.avg_goals_league, fs.home_advantage, fs.elo_home, fs.elo_away, fs.league_elo
  FROM football_fixtures f
  LEFT JOIN football_predictions p ON f.id = p.fixture_id
  LEFT JOIN football_stats fs ON f.id = fs.fixture_id
`;

// Column mapping
const COLUMN_MAPPING = {
  id: 'id', date: 'date', timestamp: 'timestamp', status_short: 'status_short',
  home_team_name: 'home_team_name', away_team_name: 'away_team_name',
  league_name: 'league_name', season: 'season', round: 'round',
  goals_home: 'goals_home', goals_away: 'goals_away',
  xg_home: 'xg_home', xg_away: 'xg_away', market_xg_home: 'market_xg_home', market_xg_away: 'market_xg_away',
  venue_name: 'venue_name', referee: 'referee',
  home_pred: 'home_pred', away_pred: 'away_pred',
  avg_goals_league: 'avg_goals_league', home_advantage: 'home_advantage',
  elo_home: 'elo_home', elo_away: 'elo_away', league_elo: 'league_elo'
};

// Searchable columns
const SEARCH_COLUMNS = ['home_team_name', 'away_team_name', 'league_name', 'venue_name', 'referee'];

// Custom handler to support date filters and odds ratio filters
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
    } else if (dateFilter.startsWith('last')) {
      // Handle 'last{day_number}' pattern (e.g., 'last14', 'last30')
      const dayMatch = dateFilter.match(/^last(\d+)$/);
      if (dayMatch) {
        const days = parseInt(dayMatch[1], 10);
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      }
    } else if (dateFilter.startsWith('next')) {
      // Handle 'next{day_number}' pattern (e.g., 'next14', 'next30')
      const dayMatch = dateFilter.match(/^next(\d+)$/);
      if (dayMatch) {
        const days = parseInt(dayMatch[1], 10);
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
      }
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

  // Handle direct filter parameters (league_name, home_team_name, etc.)
  const filterMappings: Record<string, string> = {
    league_id: 'league_id',
    league_name: 'league_name',
    home_team_name: 'home_team_name',
    away_team_name: 'away_team_name',
    status_short: 'status_short',
    season: 'season'
  };

  Object.entries(filterMappings).forEach(([param, column]) => {
    const value = url.searchParams.get(param);
    if (value) {
      params.filters.push({
        column: column,
        value: value,
        operator: 'eq'
      });
    }
  });

  // Handle search parameter (teams, leagues, and team mappings)
  const searchTerm = url.searchParams.get('search');
  if (searchTerm && searchTerm.trim()) {
    const searchValue = `%${searchTerm.trim().toLowerCase()}%`;

    // Create a custom query for search that includes team mappings
    const searchQuery = `
      SELECT
        f.id, f.referee, f.timestamp, f.date, f.venue_name, f.status_long, f.status_short,
        f.home_team_id, f.home_team_name, f.home_country,
        f.away_team_id, f.away_team_name, f.away_country,
        f.xg_home, f.xg_away, f.market_xg_home, f.market_xg_away, f.goals_home, f.goals_away,
        f.score_halftime_home, f.score_halftime_away,
        f.score_fulltime_home, f.score_fulltime_away,
        f.score_extratime_home, f.score_extratime_away,
        f.score_penalty_home, f.score_penalty_away,
        f.league_id, f.league_name, f.league_country, f.season, f.round,
        f.updated_at
      FROM football_fixtures f
      LEFT JOIN football_teams ht ON f.home_team_id = ht.id
      LEFT JOIN football_teams at ON f.away_team_id = at.id
      WHERE (
        LOWER(f.home_team_name) LIKE $1 OR
        LOWER(f.away_team_name) LIKE $2 OR
        LOWER(f.league_name) LIKE $3 OR
        f.id::text LIKE $4 OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ht.mappings, '[]'::jsonb)) AS mapping
          WHERE LOWER(mapping) LIKE $1
        ) OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(at.mappings, '[]'::jsonb)) AS mapping
          WHERE LOWER(mapping) LIKE $2
        )
      )
      ORDER BY f.date DESC
      LIMIT $${5} OFFSET $${6}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM football_fixtures f
      LEFT JOIN football_teams ht ON f.home_team_id = ht.id
      LEFT JOIN football_teams at ON f.away_team_id = at.id
      WHERE (
        LOWER(f.home_team_name) LIKE $1 OR
        LOWER(f.away_team_name) LIKE $2 OR
        LOWER(f.league_name) LIKE $3 OR
        f.id::text LIKE $4 OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ht.mappings, '[]'::jsonb)) AS mapping
          WHERE LOWER(mapping) LIKE $1
        ) OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(at.mappings, '[]'::jsonb)) AS mapping
          WHERE LOWER(mapping) LIKE $2
        )
      )
    `;

    const offset = (params.page - 1) * params.limit;
    const queryParams = [searchValue, searchValue, searchValue, `%${searchTerm.trim()}%`, params.limit, offset];

    try {
      const [countResult, dataResult] = await Promise.all([
        executeQuery<{ total: string }>(countQuery, queryParams.slice(0, 4)),
        executeQuery<Fixture>(searchQuery, queryParams)
      ]);

      const total = parseInt(countResult.rows[0]?.total || '0');
      const totalPages = Math.ceil(total / params.limit);

      return NextResponse.json({
        data: dataResult.rows,
        total,
        page: params.page,
        limit: params.limit,
        totalPages,
        hasNextPage: params.page < totalPages,
        hasPrevPage: params.page > 1
      });
    } catch (error) {
      console.error('Search query error:', error);
      throw error;
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

import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../lib/db-utils';
import { Fixture } from '../../../types/database';


async function getFixtures(request: Request) {
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get('league_id');
  const season = searchParams.get('season');
  const teamId = searchParams.get('team_id');
  const status = searchParams.get('status');
  const sortBy = searchParams.get('sort_by') || 'date';
  const sortDirection = searchParams.get('sort_direction') || 'desc';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const offset = (page - 1) * limit;

  // Server-side filtering parameters
  const leagueNameFilter = searchParams.get('league_name');
  const homeTeamFilter = searchParams.get('home_team_name');
  const awayTeamFilter = searchParams.get('away_team_name');
  const statusFilter = searchParams.get('status_short');
  const seasonFilter = searchParams.get('season');

  // Build the WHERE clause
  let whereClause = 'WHERE 1=1';
  const queryParams: any[] = [];
  let paramIndex = 1;

  if (leagueId) {
    whereClause += ` AND league_id = $${paramIndex}`;
    queryParams.push(leagueId);
    paramIndex++;
  }

  if (season) {
    whereClause += ` AND season = $${paramIndex}`;
    queryParams.push(season);
    paramIndex++;
  }

  if (teamId) {
    whereClause += ` AND (home_team_id = $${paramIndex} OR away_team_id = $${paramIndex})`;
    queryParams.push(teamId);
    paramIndex++;
  }

  if (status) {
    whereClause += ` AND status_short = $${paramIndex}`;
    queryParams.push(status);
    paramIndex++;
  }

  // Server-side filtering conditions
  if (leagueNameFilter) {
    whereClause += ` AND league_name = $${paramIndex}`;
    queryParams.push(leagueNameFilter);
    paramIndex++;
  }

  if (homeTeamFilter) {
    whereClause += ` AND home_team_name = $${paramIndex}`;
    queryParams.push(homeTeamFilter);
    paramIndex++;
  }

  if (awayTeamFilter) {
    whereClause += ` AND away_team_name = $${paramIndex}`;
    queryParams.push(awayTeamFilter);
    paramIndex++;
  }

  if (statusFilter) {
    whereClause += ` AND status_short = $${paramIndex}`;
    queryParams.push(statusFilter);
    paramIndex++;
  }

  if (seasonFilter) {
    whereClause += ` AND season = $${paramIndex}`;
    queryParams.push(parseInt(seasonFilter));
    paramIndex++;
  }

  // Get total count for pagination
  const countQuery = `SELECT COUNT(*) FROM football_fixtures ${whereClause}`;
  const countResult = await executeQuery(countQuery, queryParams);
  const totalCount = parseInt(countResult.rows[0].count);

  // Validate sort parameters
  const allowedSortColumns = ['date', 'season', 'league_name', 'home_team_name', 'away_team_name', 'status_short', 'goals_home', 'goals_away', 'xg_home', 'xg_away'];
  const validSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'date';
  const validSortDirection = sortDirection === 'asc' ? 'ASC' : 'DESC';

  // Get paginated results
  const dataQuery = `SELECT * FROM football_fixtures ${whereClause} ORDER BY ${validSortBy} ${validSortDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  queryParams.push(limit, offset);

  const result = await executeQuery(dataQuery, queryParams);

  const fixtures: Fixture[] = result.rows;
  const totalPages = Math.ceil(totalCount / limit);

  return NextResponse.json({
    fixtures,
    pagination: {
      currentPage: page,
      totalPages,
      totalCount,
      limit,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  });
}

export const GET = withErrorHandler(getFixtures);

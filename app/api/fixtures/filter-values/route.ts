import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../lib/database/db-utils';


export const dynamic = 'force-dynamic';

async function getFilterValues(request: Request) {
  const { searchParams } = new URL(request.url);
  const field = searchParams.get('field');

  if (!field) {
    return NextResponse.json({ error: 'Field parameter is required' }, { status: 400 });
  }

  // Define allowed fields for security
  const allowedFields = [
    'league_name',
    'home_team_name',
    'away_team_name',
    'season',
    'status_short',
    'odds_bookies',
    'fair_odds_bookies'
  ];

  if (!allowedFields.includes(field)) {
    return NextResponse.json({ error: 'Invalid field parameter' }, { status: 400 });
  }

  try {
    let query;
    let values;

    if (field === 'league_name') {
      // Special handling for league_name to include country
      query = `SELECT DISTINCT league_name, league_country FROM football_fixtures WHERE league_name IS NOT NULL AND league_country IS NOT NULL ORDER BY league_country, league_name`;
      const result = await executeQuery(query);
      values = result.rows.map(row => `${row.league_name} (${row.league_country})`).filter(value => value !== null && value !== undefined && value !== '');
    } else if (field === 'fair_odds_bookies') {
      // Get available fair odds bookmakers from football_fair_odds table
      query = `SELECT DISTINCT bookie FROM football_fair_odds WHERE fair_odds_x12 IS NOT NULL ORDER BY bookie`;
      const result = await executeQuery(query);
      values = result.rows.map(row => row.bookie).filter(value => value !== null && value !== undefined && value !== '');
    } else {
      // Default behavior for other fields
      query = `SELECT DISTINCT ${field} FROM football_fixtures WHERE ${field} IS NOT NULL ORDER BY ${field}`;
      const result = await executeQuery(query);
      values = result.rows.map(row => row[field]).filter(value => value !== null && value !== undefined && value !== '');
    }

    return NextResponse.json({ values });
  } catch (error) {
    console.error('Error fetching filter values:', error);
    return NextResponse.json({ error: 'Failed to fetch filter values' }, { status: 500 });
  }
}

export const GET = withErrorHandler(getFilterValues);

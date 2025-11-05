import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../lib/database/db-utils';
import { IN_FUTURE } from '../../../lib/constants';

// Helper function to filter odds arrays to only include latest timestamp entries
function filterLatestOdds(oddsArray: any[] | null, latestTimestamp: number | null): any[] | null {
  if (!oddsArray || !Array.isArray(oddsArray) || latestTimestamp === null) {
    return oddsArray;
  }
  return oddsArray.filter((item: any) => item && item.t === latestTimestamp);
}

async function getFixtureOdds(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureIdParam = searchParams.get('fixtureId');
  const limit = searchParams.get('limit');
  const page = searchParams.get('page');
  const bookiesParam = searchParams.get('bookies');
  const fairOddsParam = searchParams.get('fair_odds');
  const latestParam = searchParams.get('latest');

  // Parse fixture IDs - support both single ID and comma-separated IDs
  let fixtureIds: number[];
  if (fixtureIdParam) {
    if (fixtureIdParam.includes(',')) {
      // Multiple IDs separated by comma
      fixtureIds = fixtureIdParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    } else {
      // Single ID
      const fixtureId = parseInt(fixtureIdParam);
      fixtureIds = !isNaN(fixtureId) ? [fixtureId] : [];
    }
  } else {
    // Default: return all upcoming fixtures
    fixtureIds = [];
  }

  if (fixtureIdParam && fixtureIds.length === 0) {
    return NextResponse.json({ error: 'Invalid fixture ID(s)' }, { status: 400 });
  }

  // Parse pagination parameters
  const limitNum = limit ? parseInt(limit) : null;
  const pageNum = page ? parseInt(page) : 1;
  const offset = limitNum && pageNum > 1 ? (pageNum - 1) * limitNum : 0;

  // Build query parameters array in correct order
  let queryParams: any[] = [];
  let paramIndex = 1;

  // Add status array first if checking future fixtures
  if (fixtureIds.length === 0) {
    queryParams.push(IN_FUTURE);
    paramIndex += 1;
  }

  // Parse fair_odds parameter
  const useFairOdds = fairOddsParam === 'true' || fairOddsParam === '1';
  
  // Parse latest parameter
  const useLatest = latestParam === 'true' || latestParam === '1';

  // Add bookie parameters next
  let bookiePlaceholders = '';
  let bookieFilter = '';
  if (bookiesParam) {
    const bookies = bookiesParam.split(',').map(b => b.trim()).filter(b => b.length > 0);
    if (bookies.length > 0) {
      bookiePlaceholders = bookies.map((_, i) => `$${paramIndex + i}`).join(',');
      bookieFilter = `AND fo.bookie IN (${bookiePlaceholders})`;
      queryParams.push(...bookies);
      paramIndex += bookies.length;
    }
  }

  // Add fixture IDs next
  let fixturePlaceholders = '';
  if (fixtureIds.length > 0) {
    fixturePlaceholders = fixtureIds.map((_, i) => `$${paramIndex + i}`).join(',');
    queryParams.push(...fixtureIds);
    paramIndex += fixtureIds.length;
  }

  // Build count query for pagination
  let countQuery;
  if (useFairOdds) {
    // When fair_odds=true, count fixtures that have data in either table
    countQuery = `
      SELECT COUNT(DISTINCT ff.id) as total
      FROM football_fixtures ff
      LEFT JOIN football_odds fo ON ff.id = fo.fixture_id
      LEFT JOIN football_fair_odds ffo ON ff.id = ffo.fixture_id
      WHERE 1=1
        ${fixtureIds.length > 0 ? `AND ff.id IN (${fixturePlaceholders})` : ''}
        ${fixtureIds.length === 0 ? `AND LOWER(ff.status_short) = ANY($1) AND ff.date >= CURRENT_DATE` : ''}
        ${bookiesParam && bookieFilter ? `AND (fo.bookie IN (${bookiePlaceholders}) OR ffo.bookie IN (${bookiePlaceholders}))` : ''}
    `;
  } else {
    // Regular odds only
    countQuery = `
      SELECT COUNT(DISTINCT ff.id) as total
      FROM football_fixtures ff
      LEFT JOIN football_odds fo ON ff.id = fo.fixture_id
      WHERE 1=1
        ${fixtureIds.length > 0 ? `AND ff.id IN (${fixturePlaceholders})` : ''}
        ${fixtureIds.length === 0 ? `AND LOWER(ff.status_short) = ANY($1) AND ff.date >= CURRENT_DATE` : ''}
        ${bookiesParam && bookieFilter ? `AND fo.bookie IN (${bookiePlaceholders})` : ''}
    `;
  }

  const countResult = await executeQuery(countQuery, queryParams);
  const totalCount = parseInt(countResult.rows[0].total) || 0;

  // Build main query
  let query;
  if (useFairOdds) {
    // When fair_odds=true, join both tables and return both regular and fair odds
    query = `
      SELECT
        ff.id as fixture_id,
        ff.home_team_id,
        ff.home_team_name,
        ff.away_team_id,
        ff.away_team_name,
        ff.date,
        ff.league_id,
        ff.league_name,
        ff.season,
        ff.status_short,
        ff.round,
        COALESCE(fo.bookie, ffo.bookie) as bookie,
        COALESCE(fo.decimals, ffo.decimals) as decimals,
        -- Regular odds from football_odds table
        fo.odds_x12,
        fo.odds_ah,
        fo.odds_ou,
        fo.lines,
        fo.latest_t,
        -- Fair odds from football_fair_odds table
        ffo.fair_odds_x12,
        ffo.fair_odds_ah,
        ffo.fair_odds_ou,
        jsonb_build_object('ah', ffo.latest_lines->'ah', 'ou', ffo.latest_lines->'ou') as fair_odds_lines
      FROM football_fixtures ff
      LEFT JOIN football_odds fo ON ff.id = fo.fixture_id
      LEFT JOIN football_fair_odds ffo ON ff.id = ffo.fixture_id AND fo.bookie = ffo.bookie
      WHERE 1=1
        ${fixtureIds.length > 0 ? `AND ff.id IN (${fixturePlaceholders})` : ''}
        ${fixtureIds.length === 0 ? `AND LOWER(ff.status_short) = ANY($1) AND ff.date >= CURRENT_DATE` : ''}
        ${bookiesParam && bookieFilter ? `AND (fo.bookie IN (${bookiePlaceholders}) OR ffo.bookie IN (${bookiePlaceholders}))` : ''}
        AND (ffo.bookie IS NULL OR ffo.bookie != 'Prediction')
      ORDER BY ff.date, ff.id, COALESCE(fo.bookie, ffo.bookie)
    `;
  } else {
    // Regular odds only
    query = `
      SELECT
        ff.id as fixture_id,
        ff.home_team_id,
        ff.home_team_name,
        ff.away_team_id,
        ff.away_team_name,
        ff.date,
        ff.league_id,
        ff.league_name,
        ff.season,
        ff.status_short,
        ff.round,
        fo.bookie,
        fo.decimals,
        -- Return full X12 odds array
        fo.odds_x12,
        -- Return full AH odds array
        fo.odds_ah,
        -- Return full OU odds array
        fo.odds_ou,
        -- Return full lines array
        fo.lines,
        fo.latest_t
      FROM football_fixtures ff
      LEFT JOIN football_odds fo ON ff.id = fo.fixture_id
      WHERE 1=1
        ${fixtureIds.length > 0 ? `AND ff.id IN (${fixturePlaceholders})` : ''}
        ${fixtureIds.length === 0 ? `AND LOWER(ff.status_short) = ANY($1) AND ff.date >= CURRENT_DATE` : ''}
        ${bookiesParam && bookieFilter ? `AND fo.bookie IN (${bookiePlaceholders})` : ''}
      ORDER BY ff.date, ff.id, fo.bookie
    `;
  }

  // Add pagination parameters and clauses
  if (limitNum && limitNum > 0) {
    query += ` LIMIT $${paramIndex}`;
    queryParams.push(limitNum);
    paramIndex++;

    if (offset > 0) {
      query += ` OFFSET $${paramIndex}`;
      queryParams.push(offset);
    }
  }

  const result = await executeQuery(query, queryParams);

  // Group by fixture for cleaner response
  const fixturesMap = new Map();

  result.rows.forEach(row => {
    const fixtureId = row.fixture_id;

    if (!fixturesMap.has(fixtureId)) {
      fixturesMap.set(fixtureId, {
        fixture_id: fixtureId,
        home_team_id: row.home_team_id,
        home_team: row.home_team_name,
        away_team_id: row.away_team_id,
        away_team: row.away_team_name,
        date: row.date,
        league_id: row.league_id,
        league: row.league_name,
        season: row.season,
        status_short: row.status_short,
        round: row.round,
        odds: []
      });
    }

    // Only add odds if they exist (regular odds or fair odds)
    if (row.odds_x12 || row.odds_ah || row.odds_ou || row.fair_odds_x12 || row.fair_odds_ah || row.fair_odds_ou) {
      // Parse latest_t if available and filtering is enabled
      let latestT: any = null;
      if (useLatest && row.latest_t) {
        try {
          latestT = typeof row.latest_t === 'string' ? JSON.parse(row.latest_t) : row.latest_t;
        } catch (e) {
          latestT = null;
        }
      }

      // Parse odds arrays from JSONB if they're strings
      let oddsX12 = row.odds_x12 || null;
      let oddsAh = row.odds_ah || null;
      let oddsOu = row.odds_ou || null;
      let lines = row.lines || null;

      // Parse JSONB strings to arrays if needed
      if (oddsX12 && typeof oddsX12 === 'string') {
        try {
          oddsX12 = JSON.parse(oddsX12);
        } catch (e) {
          oddsX12 = null;
        }
      }
      if (oddsAh && typeof oddsAh === 'string') {
        try {
          oddsAh = JSON.parse(oddsAh);
        } catch (e) {
          oddsAh = null;
        }
      }
      if (oddsOu && typeof oddsOu === 'string') {
        try {
          oddsOu = JSON.parse(oddsOu);
        } catch (e) {
          oddsOu = null;
        }
      }
      if (lines && typeof lines === 'string') {
        try {
          lines = JSON.parse(lines);
        } catch (e) {
          lines = null;
        }
      }

      // Filter odds arrays if latest=true
      if (useLatest && latestT) {
        if (oddsX12 && latestT.x12_ts !== undefined) {
          oddsX12 = filterLatestOdds(oddsX12, latestT.x12_ts);
        }
        if (oddsAh && latestT.ah_ts !== undefined) {
          oddsAh = filterLatestOdds(oddsAh, latestT.ah_ts);
        }
        if (oddsOu && latestT.ou_ts !== undefined) {
          oddsOu = filterLatestOdds(oddsOu, latestT.ou_ts);
        }
        if (lines && latestT.lines_ts !== undefined) {
          lines = filterLatestOdds(lines, latestT.lines_ts);
        }
      }

      const oddsObj: any = {
        bookie: row.bookie,
        decimals: row.decimals,
        odds_x12: oddsX12,
        odds_ah: oddsAh,
        odds_ou: oddsOu,
        lines: lines
      };

      // Add fair odds fields when fair_odds=true
      if (useFairOdds) {
        if (row.bookie === 'Prediction') {
          // For Prediction, use latest regular odds as fair odds (without timestamps) since they're already calculated without margins
          oddsObj.fair_odds_x12 = oddsX12 && oddsX12.length > 0 ? oddsX12[oddsX12.length - 1].x12 : null;

          // Transform AH odds from regular format to fair odds format
          const latestAh = oddsAh && oddsAh.length > 0 ? oddsAh[oddsAh.length - 1] : null;
          oddsObj.fair_odds_ah = latestAh ? {
            fair_ah_a: latestAh.ah_a || null,
            fair_ah_h: latestAh.ah_h || null
          } : null;

          // Transform OU odds from regular format to fair odds format
          const latestOu = oddsOu && oddsOu.length > 0 ? oddsOu[oddsOu.length - 1] : null;
          oddsObj.fair_odds_ou = latestOu ? {
            fair_ou_o: latestOu.ou_o || null,
            fair_ou_u: latestOu.ou_u || null
          } : null;

          oddsObj.fair_odds_lines = lines && lines.length > 0 ? {
            ah: lines[lines.length - 1].ah || null,
            ou: lines[lines.length - 1].ou || null
          } : null;
        } else {
          // For other bookmakers, use calculated fair odds
          oddsObj.fair_odds_x12 = row.fair_odds_x12 || null;
          oddsObj.fair_odds_ah = row.fair_odds_ah || null;
          oddsObj.fair_odds_ou = row.fair_odds_ou || null;
          oddsObj.fair_odds_lines = row.fair_odds_lines || null;
        }
      }

      fixturesMap.get(fixtureId).odds.push(oddsObj);
    }
  });

  const fixtures = Array.from(fixturesMap.values());

  // Calculate pagination metadata
  const totalPages = limitNum ? Math.ceil(totalCount / limitNum) : 1;
  const hasNextPage = limitNum ? pageNum < totalPages : false;
  const hasPrevPage = pageNum > 1;

  const pagination = {
    total: totalCount,
    page: pageNum,
    limit: limitNum || totalCount,
    totalPages,
    hasNextPage,
    hasPrevPage
  };

  // For single fixture requests, return just the odds array directly
  if (fixtureIds.length === 1 && fixtures.length === 1) {
    return NextResponse.json({
      odds: fixtures[0].odds,
      pagination
    });
  }

  // For multiple fixtures, return the full fixtures array with pagination
  return NextResponse.json({
    fixtures,
    pagination
  });
}

async function createFixtureOdds(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureIdParam = searchParams.get('fixtureId');

  if (!fixtureIdParam) {
    return NextResponse.json({ error: 'fixtureId parameter is required' }, { status: 400 });
  }

  const fixtureId = parseInt(fixtureIdParam);
  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  const body = await request.json();
  const {
    bookie,
    opening_x12_home,
    opening_x12_draw,
    opening_x12_away,
    opening_ou25_over,
    opening_ou25_under,
    closing_x12_home,
    closing_x12_draw,
    closing_x12_away,
    closing_ou25_over,
    closing_ou25_under,
    fixture_timestamp
  } = body;

  if (!bookie) {
    return NextResponse.json({ error: 'Bookie is required' }, { status: 400 });
  }

  // Convert decimal odds to basis points (multiply by 100)
  const toBasisPoints = (decimal: string | number | null | undefined) => {
    if (!decimal || decimal === '') return null;
    const num = parseFloat(decimal.toString());
    return isNaN(num) ? null : Math.round(num * 100);
  };

  // Calculate timestamps
  const matchStart = fixture_timestamp ? new Date(fixture_timestamp * 1000) : new Date();
  const openingTime = new Date(matchStart.getTime() - (5 * 24 * 60 * 60 * 1000)); // 5 days before
  const closingTime = matchStart;

  const openingTimestamp = Math.floor(openingTime.getTime() / 1000);
  const closingTimestamp = Math.floor(closingTime.getTime() / 1000);

  // Prepare odds data
  const oddsData = {
    bookie_id: 1, // Default bookie_id, can be updated later if needed
    bookie,
    decimals: 2
  };

  // Build X12 odds array
  const x12Odds = [];
  if (opening_x12_home || opening_x12_draw || opening_x12_away) {
    x12Odds.push({
      t: openingTimestamp,
      x12: [
        toBasisPoints(opening_x12_home),
        toBasisPoints(opening_x12_draw),
        toBasisPoints(opening_x12_away)
      ].filter(odds => odds !== null)
    });
  }
  if (closing_x12_home || closing_x12_draw || closing_x12_away) {
    x12Odds.push({
      t: closingTimestamp,
      x12: [
        toBasisPoints(closing_x12_home),
        toBasisPoints(closing_x12_draw),
        toBasisPoints(closing_x12_away)
      ].filter(odds => odds !== null)
    });
  }

  // Build OU odds array (with line 2.5)
  const ouOdds = [];
  if (opening_ou25_over || opening_ou25_under) {
    ouOdds.push({
      t: openingTimestamp,
      ou_o: [toBasisPoints(opening_ou25_over)].filter(odds => odds !== null),
      ou_u: [toBasisPoints(opening_ou25_under)].filter(odds => odds !== null)
    });
  }
  if (closing_ou25_over || closing_ou25_under) {
    ouOdds.push({
      t: closingTimestamp,
      ou_o: [toBasisPoints(closing_ou25_over)].filter(odds => odds !== null),
      ou_u: [toBasisPoints(closing_ou25_under)].filter(odds => odds !== null)
    });
  }

  // Build lines array (for OU 2.5 line)
  const lines = [];
  if (opening_ou25_over || opening_ou25_under) {
    lines.push({
      t: openingTimestamp,
      ou: [2.5] // 2.5 as decimal (not basis points)
    });
  }
  if (closing_ou25_over || closing_ou25_under) {
    lines.push({
      t: closingTimestamp,
      ou: [2.5] // 2.5 as decimal (not basis points)
    });
  }

  // Build latest_t object
  const latestT: any = {};
  if (x12Odds.length > 0) {
    latestT.x12_ts = Math.max(...x12Odds.map(odd => odd.t));
  }
  if (ouOdds.length > 0) {
    latestT.ou_ts = Math.max(...ouOdds.map(odd => odd.t));
  }
  if (lines.length > 0) {
    latestT.lines_ts = Math.max(...lines.map(line => line.t));
  }

  // Check if odds record exists
  const existingQuery = `
    SELECT odds_x12, odds_ou, lines, latest_t FROM football_odds
    WHERE fixture_id = $1 AND bookie = $2
  `;
  const existingResult = await executeQuery(existingQuery, [fixtureId, oddsData.bookie]);

  let finalX12Odds = x12Odds;
  let finalOuOdds = ouOdds;
  let finalLines = lines;
  let finalLatestT: any = latestT;

  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0];

    // Merge existing odds with new odds, avoiding duplicates by timestamp
    if (existing.odds_x12) {
      const existingX12 = JSON.parse(existing.odds_x12);
      const mergedX12 = [...existingX12];

      // Add new odds that don't already exist for the same timestamp
      x12Odds.forEach(newOdd => {
        const existingIndex = mergedX12.findIndex(existingOdd => existingOdd.t === newOdd.t);
        if (existingIndex >= 0) {
          mergedX12[existingIndex] = newOdd; // Replace if same timestamp
        } else {
          mergedX12.push(newOdd); // Add if new timestamp
        }
      });

      finalX12Odds = mergedX12;
    }

    if (existing.odds_ou) {
      const existingOu = JSON.parse(existing.odds_ou);
      const mergedOu = [...existingOu];

      // Add new odds that don't already exist for the same timestamp
      ouOdds.forEach(newOdd => {
        const existingIndex = mergedOu.findIndex(existingOdd => existingOdd.t === newOdd.t);
        if (existingIndex >= 0) {
          mergedOu[existingIndex] = newOdd; // Replace if same timestamp
        } else {
          mergedOu.push(newOdd); // Add if new timestamp
        }
      });

      finalOuOdds = mergedOu;
    }

    if (existing.lines) {
      const existingLines = JSON.parse(existing.lines);
      const mergedLines = [...existingLines];

      // Add new lines that don't already exist for the same timestamp
      lines.forEach(newLine => {
        const existingIndex = mergedLines.findIndex(existingLine => existingLine.t === newLine.t);
        if (existingIndex >= 0) {
          mergedLines[existingIndex] = newLine; // Replace if same timestamp
        } else {
          mergedLines.push(newLine); // Add if new timestamp
        }
      });

      finalLines = mergedLines;
    }

    // Merge latest_t
    if (existing.latest_t) {
      const existingLatestT = JSON.parse(existing.latest_t);
      finalLatestT = { ...existingLatestT, ...latestT };
    }
  }

  // Insert or update odds
  const upsertQuery = `
    INSERT INTO football_odds (
      fixture_id,
      bookie_id,
      bookie,
      odds_x12,
      odds_ou,
      lines,
      latest_t,
      decimals
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (fixture_id, bookie)
    DO UPDATE SET
      odds_x12 = EXCLUDED.odds_x12,
      odds_ou = EXCLUDED.odds_ou,
      lines = EXCLUDED.lines,
      latest_t = EXCLUDED.latest_t,
      updated_at = now()
  `;

  await executeQuery(upsertQuery, [
    fixtureId,
    oddsData.bookie_id,
    oddsData.bookie,
    finalX12Odds.length > 0 ? JSON.stringify(finalX12Odds) : null,
    finalOuOdds.length > 0 ? JSON.stringify(finalOuOdds) : null,
    finalLines.length > 0 ? JSON.stringify(finalLines) : null,
    Object.keys(finalLatestT).length > 0 ? JSON.stringify(finalLatestT) : null,
    oddsData.decimals
  ]);

  return NextResponse.json({ success: true, message: 'Odds data saved successfully' });
}

export const GET = withErrorHandler(getFixtureOdds);
export const POST = withErrorHandler(createFixtureOdds);

import { NextResponse } from 'next/server';
import { withErrorHandler, executeQuery } from '../../../lib/database/db-utils';
import { parseTableParams, executeTableQuery } from '../../../lib/utils/server-table-utils';
import { Fixture } from '../../../types/database';


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
    f.updated_at
  FROM football_fixtures f
`;

// Column mapping
const COLUMN_MAPPING = {
  id: 'id', date: 'date', timestamp: 'timestamp', status_short: 'status_short',
  home_team_name: 'home_team_name', away_team_name: 'away_team_name',
  league_name: 'league_name', season: 'season', round: 'round',
  goals_home: 'goals_home', goals_away: 'goals_away',
  xg_home: 'xg_home', xg_away: 'xg_away', market_xg_home: 'market_xg_home', market_xg_away: 'market_xg_away',
  venue_name: 'venue_name', referee: 'referee'
};

// Searchable columns
const SEARCH_COLUMNS = ['home_team_name', 'away_team_name', 'league_name', 'venue_name', 'referee'];

// Custom handler to support date filters and odds ratio filters
async function getFixtures(request: Request) {
  const url = new URL(request.url);
  const params = parseTableParams(url.searchParams);

  // Add search columns
  params.searchColumns = SEARCH_COLUMNS;

  // Handle odds ratio filter
  const oddsBookie = url.searchParams.get('odds_bookie');
  const fairOddsBookie = url.searchParams.get('fair_odds_bookie');
  const oddsRatioThreshold = url.searchParams.get('odds_ratio_threshold');
  const maxOdds = url.searchParams.get('max_odds');

  if (oddsBookie && fairOddsBookie && oddsRatioThreshold) {
    // Custom query for odds ratio filtering
    const threshold = parseFloat(oddsRatioThreshold);
    if (isNaN(threshold)) {
      return NextResponse.json({ error: 'Invalid odds ratio threshold' }, { status: 400 });
    }

    let maxOddsValue: number | null = null;
    if (maxOdds) {
      maxOddsValue = parseFloat(maxOdds);
      if (isNaN(maxOddsValue)) {
        return NextResponse.json({ error: 'Invalid max odds value' }, { status: 400 });
      }
    }

    // Build the base query with odds ratio filtering and calculation
    const maxOddsCondition = maxOddsValue !== null ? 'AND (bookmaker_odd::numeric / POWER(10, o.decimals)) < $4::numeric' : '';
    const maxOddsConditionOU = maxOddsValue !== null ? 'AND ((o.odds_ou->-1->\'ou_o\'->>((bookmaker_ou_line.idx - 1)::int))::numeric / POWER(10, o.decimals)) < $4::numeric' : '';
    const maxOddsConditionOU_U = maxOddsValue !== null ? 'AND ((o.odds_ou->-1->\'ou_u\'->>((bookmaker_ou_line.idx - 1)::int))::numeric / POWER(10, o.decimals)) < $4::numeric' : '';
    const maxOddsConditionAH_H = maxOddsValue !== null ? 'AND ((o.odds_ah->-1->\'ah_h\'->>((bookmaker_ah_line.idx - 1)::int))::numeric / POWER(10, o.decimals)) < $4::numeric' : '';
    const maxOddsConditionAH_A = maxOddsValue !== null ? 'AND ((o.odds_ah->-1->\'ah_a\'->>((bookmaker_ah_line.idx - 1)::int))::numeric / POWER(10, o.decimals)) < $4::numeric' : '';

    const oddsRatioQuery = `
      SELECT f.*,
        -- Calculate odds ratios for each X12 outcome (Home, Draw, Away)
        ARRAY[
          CASE WHEN fo.fair_odds_x12->'fair_x12'->>0 IS NOT NULL AND (o.odds_x12->-1->'x12'->>0)::numeric > 0
            THEN jsonb_build_object(
              'ratio', ROUND(
                CAST(
                  ((o.odds_x12->-1->'x12'->>0)::numeric / POWER(10, o.decimals)) /
                  ((fo.fair_odds_x12->'fair_x12'->>0)::numeric / POWER(10, fo.decimals))
                  AS numeric
                ),
                3
              ),
              'odds', ROUND(((o.odds_x12->-1->'x12'->>0)::numeric / POWER(10, o.decimals))::numeric, 2)
            )
            ELSE NULL END,
          CASE WHEN fo.fair_odds_x12->'fair_x12'->>1 IS NOT NULL AND (o.odds_x12->-1->'x12'->>1)::numeric > 0
            THEN jsonb_build_object(
              'ratio', ROUND(
                CAST(
                  ((o.odds_x12->-1->'x12'->>1)::numeric / POWER(10, o.decimals)) /
                  ((fo.fair_odds_x12->'fair_x12'->>1)::numeric / POWER(10, fo.decimals))
                  AS numeric
                ),
                3
              ),
              'odds', ROUND(((o.odds_x12->-1->'x12'->>1)::numeric / POWER(10, o.decimals))::numeric, 2)
            )
            ELSE NULL END,
          CASE WHEN fo.fair_odds_x12->'fair_x12'->>2 IS NOT NULL AND (o.odds_x12->-1->'x12'->>2)::numeric > 0
            THEN jsonb_build_object(
              'ratio', ROUND(
                CAST(
                  ((o.odds_x12->-1->'x12'->>2)::numeric / POWER(10, o.decimals)) /
                  ((fo.fair_odds_x12->'fair_x12'->>2)::numeric / POWER(10, fo.decimals))
                  AS numeric
                ),
                3
              ),
              'odds', ROUND(((o.odds_x12->-1->'x12'->>2)::numeric / POWER(10, o.decimals))::numeric, 2)
            )
            ELSE NULL END
        ] as odds_ratios_x12,
        -- Calculate odds ratios for OU outcomes (Over and Under for each matching line)
        -- We iterate through fair odds lines (ou) and find matching lines in regular odds
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'line', fair_line,
              'over_ratio',
                CASE
                  WHEN fair_over_odd::numeric > 0 AND bookmaker_over_odd::numeric > 0 THEN
                    jsonb_build_object(
                      'ratio', ROUND(
                        CAST(
                          (bookmaker_over_odd::numeric / POWER(10, o.decimals)) /
                          (fair_over_odd::numeric / POWER(10, fo.decimals))
                          AS numeric
                        ),
                        3
                      ),
                      'odds', ROUND((bookmaker_over_odd::numeric / POWER(10, o.decimals))::numeric, 2)
                    )
                  ELSE NULL
                END,
              'under_ratio',
                CASE
                  WHEN fair_under_odd::numeric > 0 AND bookmaker_under_odd::numeric > 0 THEN
                    jsonb_build_object(
                      'ratio', ROUND(
                        CAST(
                          (bookmaker_under_odd::numeric / POWER(10, o.decimals)) /
                          (fair_under_odd::numeric / POWER(10, fo.decimals))
                          AS numeric
                        ),
                        3
                      ),
                      'odds', ROUND((bookmaker_under_odd::numeric / POWER(10, o.decimals))::numeric, 2)
                    )
                  ELSE NULL
                END
            )
          )
          FROM (
            SELECT 
              fair_ou_line.value::numeric as fair_line,
              (fair_ou_line.idx - 1)::int as fair_idx,
              (fo.fair_odds_ou->'fair_ou_o'->>((fair_ou_line.idx - 1)::int))::numeric as fair_over_odd,
              (fo.fair_odds_ou->'fair_ou_u'->>((fair_ou_line.idx - 1)::int))::numeric as fair_under_odd,
              -- Find matching line in bookmaker data
              (bookmaker_ou_line.idx - 1)::int as bookmaker_idx,
              (o.odds_ou->-1->'ou_o'->>((bookmaker_ou_line.idx - 1)::int))::numeric as bookmaker_over_odd,
              (o.odds_ou->-1->'ou_u'->>((bookmaker_ou_line.idx - 1)::int))::numeric as bookmaker_under_odd
            FROM jsonb_array_elements_text((fo.latest_lines->'ou')::jsonb) WITH ORDINALITY fair_ou_line(value, idx)
            LEFT JOIN LATERAL (
              SELECT idx, value
              FROM jsonb_array_elements_text((o.lines->-1->'ou')::jsonb) WITH ORDINALITY bookmaker_line(value, idx)
              WHERE bookmaker_line.value::numeric = fair_ou_line.value::numeric
              LIMIT 1
            ) bookmaker_ou_line ON true
          ) matched_lines
          WHERE fair_over_odd IS NOT NULL OR fair_under_odd IS NOT NULL
        ) as odds_ratios_ou,
        -- Calculate odds ratios for AH outcomes (Home and Away for each matching line)
        -- We iterate through fair odds lines (ah) and find matching lines in regular odds
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'line', fair_line,
              'home_ratio',
                CASE
                  WHEN fair_home_odd::numeric > 0 AND bookmaker_home_odd::numeric > 0 THEN
                    jsonb_build_object(
                      'ratio', ROUND(
                        CAST(
                          (bookmaker_home_odd::numeric / POWER(10, o.decimals)) /
                          (fair_home_odd::numeric / POWER(10, fo.decimals))
                          AS numeric
                        ),
                        3
                      ),
                      'odds', ROUND((bookmaker_home_odd::numeric / POWER(10, o.decimals))::numeric, 2)
                    )
                  ELSE NULL
                END,
              'away_ratio',
                CASE
                  WHEN fair_away_odd::numeric > 0 AND bookmaker_away_odd::numeric > 0 THEN
                    jsonb_build_object(
                      'ratio', ROUND(
                        CAST(
                          (bookmaker_away_odd::numeric / POWER(10, o.decimals)) /
                          (fair_away_odd::numeric / POWER(10, fo.decimals))
                          AS numeric
                        ),
                        3
                      ),
                      'odds', ROUND((bookmaker_away_odd::numeric / POWER(10, o.decimals))::numeric, 2)
                    )
                  ELSE NULL
                END
            )
          )
          FROM (
            SELECT 
              fair_ah_line.value::numeric as fair_line,
              (fair_ah_line.idx - 1)::int as fair_idx,
              (fo.fair_odds_ah->'fair_ah_h'->>((fair_ah_line.idx - 1)::int))::numeric as fair_home_odd,
              (fo.fair_odds_ah->'fair_ah_a'->>((fair_ah_line.idx - 1)::int))::numeric as fair_away_odd,
              -- Find matching line in bookmaker data
              (bookmaker_ah_line.idx - 1)::int as bookmaker_idx,
              (o.odds_ah->-1->'ah_h'->>((bookmaker_ah_line.idx - 1)::int))::numeric as bookmaker_home_odd,
              (o.odds_ah->-1->'ah_a'->>((bookmaker_ah_line.idx - 1)::int))::numeric as bookmaker_away_odd
            FROM jsonb_array_elements_text((fo.latest_lines->'ah')::jsonb) WITH ORDINALITY fair_ah_line(value, idx)
            LEFT JOIN LATERAL (
              SELECT idx, value
              FROM jsonb_array_elements_text((o.lines->-1->'ah')::jsonb) WITH ORDINALITY bookmaker_line(value, idx)
              WHERE bookmaker_line.value::numeric = fair_ah_line.value::numeric
              LIMIT 1
            ) bookmaker_ah_line ON true
          ) matched_lines
          WHERE fair_home_odd IS NOT NULL OR fair_away_odd IS NOT NULL
        ) as odds_ratios_ah,
        -- Store the bookie names used for the ratio calculation
        $1 as odds_bookie_used,
        $2 as fair_odds_bookie_used
      FROM football_fixtures f
      INNER JOIN football_odds o ON f.id = o.fixture_id AND o.bookie = $1
      INNER JOIN football_fair_odds fo ON f.id = fo.fixture_id AND fo.bookie = $2
      WHERE (
        -- X12 odds ratio filter
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text((o.odds_x12->-1->>'x12')::jsonb) WITH ORDINALITY bookmaker(bookmaker_odd, idx)
          JOIN jsonb_array_elements_text((fo.fair_odds_x12->'fair_x12')::jsonb) WITH ORDINALITY fair(fair_odd, idx_fair)
          ON bookmaker.idx = fair.idx_fair
          WHERE (bookmaker_odd::numeric / POWER(10, o.decimals)) / (fair_odd::numeric / POWER(10, fo.decimals)) > $3::numeric
          ${maxOddsCondition}
        )
        OR
        -- OU odds ratio filter (check if any line has ratio above threshold)
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text((fo.latest_lines->'ou')::jsonb) WITH ORDINALITY fair_ou_line(value, idx)
          LEFT JOIN LATERAL (
            SELECT idx, value
            FROM jsonb_array_elements_text((o.lines->-1->'ou')::jsonb) WITH ORDINALITY bookmaker_line(value, idx)
            WHERE bookmaker_line.value::numeric = fair_ou_line.value::numeric
            LIMIT 1
          ) bookmaker_ou_line ON true
          WHERE (
            (
              (o.odds_ou->-1->'ou_o'->>((bookmaker_ou_line.idx - 1)::int))::numeric > 0 AND
              (fo.fair_odds_ou->'fair_ou_o'->>((fair_ou_line.idx - 1)::int))::numeric > 0 AND
              (((o.odds_ou->-1->'ou_o'->>((bookmaker_ou_line.idx - 1)::int))::numeric / POWER(10, o.decimals)) /
              ((fo.fair_odds_ou->'fair_ou_o'->>((fair_ou_line.idx - 1)::int))::numeric / POWER(10, fo.decimals))) > $3::numeric
              ${maxOddsConditionOU}
            )
            OR
            (
              (o.odds_ou->-1->'ou_u'->>((bookmaker_ou_line.idx - 1)::int))::numeric > 0 AND
              (fo.fair_odds_ou->'fair_ou_u'->>((fair_ou_line.idx - 1)::int))::numeric > 0 AND
              (((o.odds_ou->-1->'ou_u'->>((bookmaker_ou_line.idx - 1)::int))::numeric / POWER(10, o.decimals)) /
              ((fo.fair_odds_ou->'fair_ou_u'->>((fair_ou_line.idx - 1)::int))::numeric / POWER(10, fo.decimals))) > $3::numeric
              ${maxOddsConditionOU_U}
            )
          )
        )
        OR
        -- AH odds ratio filter (check if any line has ratio above threshold)
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text((fo.latest_lines->'ah')::jsonb) WITH ORDINALITY fair_ah_line(value, idx)
          LEFT JOIN LATERAL (
            SELECT idx, value
            FROM jsonb_array_elements_text((o.lines->-1->'ah')::jsonb) WITH ORDINALITY bookmaker_line(value, idx)
            WHERE bookmaker_line.value::numeric = fair_ah_line.value::numeric
            LIMIT 1
          ) bookmaker_ah_line ON true
          WHERE (
            (
              (o.odds_ah->-1->'ah_h'->>((bookmaker_ah_line.idx - 1)::int))::numeric > 0 AND
              (fo.fair_odds_ah->'fair_ah_h'->>((fair_ah_line.idx - 1)::int))::numeric > 0 AND
              (((o.odds_ah->-1->'ah_h'->>((bookmaker_ah_line.idx - 1)::int))::numeric / POWER(10, o.decimals)) /
              ((fo.fair_odds_ah->'fair_ah_h'->>((fair_ah_line.idx - 1)::int))::numeric / POWER(10, fo.decimals))) > $3::numeric
              ${maxOddsConditionAH_H}
            )
            OR
            (
              (o.odds_ah->-1->'ah_a'->>((bookmaker_ah_line.idx - 1)::int))::numeric > 0 AND
              (fo.fair_odds_ah->'fair_ah_a'->>((fair_ah_line.idx - 1)::int))::numeric > 0 AND
              (((o.odds_ah->-1->'ah_a'->>((bookmaker_ah_line.idx - 1)::int))::numeric / POWER(10, o.decimals)) /
              ((fo.fair_odds_ah->'fair_ah_a'->>((fair_ah_line.idx - 1)::int))::numeric / POWER(10, fo.decimals))) > $3::numeric
              ${maxOddsConditionAH_A}
            )
          )
        )
      )
    `;

    const oddsRatioParams = [oddsBookie, fairOddsBookie, threshold];
    if (maxOddsValue !== null) {
      oddsRatioParams.push(maxOddsValue);
    }
    let query = oddsRatioQuery;
    let queryParams = [...oddsRatioParams];

    // Add other filters if they exist
    let paramIndex = maxOddsValue !== null ? 5 : 4; // Start after the odds ratio parameters

    // Add date filter if present
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
        const dayMatch = dateFilter.match(/^last(\d+)$/);
        if (dayMatch) {
          const days = parseInt(dayMatch[1], 10);
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        }
      } else if (dateFilter.startsWith('next')) {
        const dayMatch = dateFilter.match(/^next(\d+)$/);
        if (dayMatch) {
          const days = parseInt(dayMatch[1], 10);
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
        }
      }

      if (startDate && endDate) {
        query += ` AND f.date >= $${paramIndex} AND f.date < $${paramIndex + 1}`;
        queryParams.push(startDate.toISOString(), endDate.toISOString());
        paramIndex += 2;
      }
    }

    // Add other standard filters
    const filterMappings: Record<string, string> = {
      league_name: 'f.league_name',
      home_team_name: 'f.home_team_name',
      away_team_name: 'f.away_team_name',
      status_short: 'f.status_short',
      season: 'f.season'
    };

    Object.entries(filterMappings).forEach(([param, column]) => {
      const value = url.searchParams.get(param);
      if (value) {
        query += ` AND ${column} = $${paramIndex}`;
        queryParams.push(value);
        paramIndex++;
      }
    });

    // Add sorting
    const sortBy = url.searchParams.get('sort_by');
    const sortDirection = url.searchParams.get('sort_direction');

    if (sortBy && (sortDirection === 'asc' || sortDirection === 'desc')) {
      const dbColumn = COLUMN_MAPPING[sortBy as keyof typeof COLUMN_MAPPING] || sortBy;
      query += ` ORDER BY ${dbColumn} ${sortDirection.toUpperCase()}`;
    } else {
      query += ` ORDER BY f.date DESC`; // Default sort
    }

    // Add pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(params.limit, (params.page - 1) * params.limit);

    // Execute the custom query
    const dataResult = await executeQuery<Fixture>(query, queryParams);

    // Get total count for pagination
    const countQuery = query
      .replace(/SELECT f\.\*,[\s\S]*?FROM football_fixtures f/, 'SELECT COUNT(DISTINCT f.id) as total FROM football_fixtures f')
      .replace(/ ORDER BY .*/, '')
      .replace(/ LIMIT .*/, '');
    const countResult = await executeQuery<{ total: string }>(countQuery, queryParams.slice(0, -2)); // Remove limit and offset

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
  }

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
      LIMIT $${4} OFFSET $${5}
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
    const queryParams = [searchValue, searchValue, searchValue, params.limit, offset];

    try {
      const [countResult, dataResult] = await Promise.all([
        executeQuery<{ total: string }>(countQuery, queryParams.slice(0, 3)),
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

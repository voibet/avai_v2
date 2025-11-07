import { NextResponse } from 'next/server';
import axios from 'axios';
import { executeQuery, withErrorHandler } from '@/lib/database/db-utils';
import { IN_PAST } from '@/lib/constants';
import { calculateExpectedPoints, calculatePositionPercentagesFromProjectedPoints } from '../../../../calculators/market-xg.js';

export const dynamic = 'force-dynamic';

interface ApiFootballStanding {
  rank: number;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  points: number;
  goalsDiff: number;
  group: string;
  form: string;
  status: string;
  description: string;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: {
      for: number;
      against: number;
    };
  };
  home: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: {
      for: number;
      against: number;
    };
  };
  away: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: {
      for: number;
      against: number;
    };
  };
}

interface ApiFootballStandingsResponse {
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
    standings: ApiFootballStanding[][];
  };
}

interface Fixture {
  id: string;
  referee: string;
  timestamp: string;
  date: string;
  venue_name: string;
  status_long: string;
  status_short: string;
  home_team_id: string;
  home_team_name: string;
  home_country: string;
  away_team_id: string;
  away_team_name: string;
  away_country: string;
  xg_home: string;
  xg_away: string;
  market_xg_home: string;
  market_xg_away: string;
  home_pred: number | null;
  away_pred: number | null;
  goals_home: number;
  goals_away: number;
  score_halftime_home: number;
  score_halftime_away: number;
  score_fulltime_home: number;
  score_fulltime_away: number;
  score_extratime_home: number | null;
  score_extratime_away: number | null;
  score_penalty_home: number | null;
  score_penalty_away: number | null;
  league_id: string;
  league_name: string;
  league_country: string;
  season: number;
  round: string;
  updated_at: string;
}

interface ExpectedPointsResult {
  homeExpectedPoints: number;
  awayExpectedPoints: number;
  probabilities: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
}

interface TeamXGStats {
  [teamId: string]: {
    all: {
      played: number;
      xg_for: number;
      xg_against: number;
    };
    home: {
      played: number;
      xg_for: number;
      xg_against: number;
    };
    away: {
      played: number;
      xg_for: number;
      xg_against: number;
    };
    expected_points_total: number;
    expected_points_projected: number;
    fixtures_remaining: number;
  };
}

interface League {
  id: number;
  name: string;
  type: string;
  country: string;
  seasons: Record<string, any>;
  xg_source: Record<string, any>;
  updated_at: string;
  pinnacle_league_id?: number;
  betfair_competition_id?: number;
  veikkaus_league_id?: number;
}

async function getLeagueWithStandings(request: Request, { params }: { params: { id: string } }) {
  const leagueId = parseInt(params.id);
  const url = new URL(request.url);
  const requestedSeason = url.searchParams.get('season');

  if (isNaN(leagueId)) {
    return NextResponse.json(
      { success: false, message: 'Invalid league ID' },
      { status: 400 }
    );
  }

  try {
    // Fetch league info from database
    const leagueResult = await executeQuery<League>(
      'SELECT * FROM football_leagues WHERE id = $1',
      [leagueId]
    );

    if (leagueResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'League not found' },
        { status: 404 }
      );
    }

    const league = leagueResult.rows[0];
    const seasons = league.seasons as Record<string, any>;

    let seasonToUse: string;

    if (requestedSeason) {
      // Check if the requested season exists for this league
      if (!seasons[requestedSeason]) {
        return NextResponse.json(
          { success: false, message: `Season ${requestedSeason} not found for this league` },
          { status: 404 }
        );
      }
      seasonToUse = requestedSeason;
    } else {
      // Get current season from league data
      const currentSeason = Object.entries(seasons)
        .find(([_, seasonData]) => seasonData.current)?.[0];

      if (!currentSeason) {
        return NextResponse.json(
          { success: false, message: 'No current season found for this league' },
          { status: 404 }
        );
      }
      seasonToUse = currentSeason;
    }

    // Fetch standings from API-Football
    const apiKey = process.env.API_KEY;
    const apiBaseUrl = process.env.API_BASE_URL;

    if (!apiKey || !apiBaseUrl) {
      return NextResponse.json(
        { success: false, message: 'API credentials not configured' },
        { status: 500 }
      );
    }

    const standingsResponse = await axios.get(`${apiBaseUrl}/standings`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      },
      params: {
        league: leagueId,
        season: seasonToUse
      }
    });

    const apiResponse: ApiFootballStandingsResponse[] = standingsResponse.data.response || [];

    if (apiResponse.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No standings data available for this league' },
        { status: 404 }
      );
    }

    const leagueData = apiResponse[0];
    const standings = leagueData.league.standings.flat();

    // Fetch fixtures for xG calculations
    let teamXGStats: TeamXGStats = {};
    let shouldCalculateWinPercentage = true;
    let lastFixtureDate: string | null = null;

    try {
      const fixturesUrl = new URL(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005'}/api/fixtures`);
      fixturesUrl.searchParams.set('league_id', leagueId.toString());
      fixturesUrl.searchParams.set('season', seasonToUse);
      fixturesUrl.searchParams.set('limit', '1000');

      const fixturesResponse = await fetch(fixturesUrl.toString());
      if (fixturesResponse.ok) {
        const fixturesData = await fixturesResponse.json();
        const fixtures: Fixture[] = fixturesData.data || [];

        // Find the latest fixture date (including scheduled fixtures)
        const allFixtures = fixtures;
        const latestFixtureDate = allFixtures.length > 0
          ? allFixtures.reduce((latest, fixture) =>
              new Date(fixture.date) > new Date(latest) ? fixture.date : latest,
              allFixtures[0].date
            )
          : null;

        // Use the latest fixture date (including future ones) for season end comparison
        lastFixtureDate = latestFixtureDate;

        // Calculate xG statistics and expected points for each team
        const teamStats: TeamXGStats & { [teamId: string]: any } = {};

        // Process all fixtures for expected points calculations
        fixtures.forEach(fixture => {
          const homeTeamId = fixture.home_team_id;
          const awayTeamId = fixture.away_team_id;
          const isPastFixture = IN_PAST.includes(fixture.status_short.toLowerCase());

          // Determine which xG values to use for expected points calculation
          let homeXg: number;
          let awayXg: number;

          if (isPastFixture && fixture.xg_home && fixture.xg_away) {
            // Use actual xG for past fixtures
            homeXg = parseFloat(fixture.xg_home);
            awayXg = parseFloat(fixture.xg_away);
          } else if (!isPastFixture && fixture.home_pred !== null && fixture.away_pred !== null) {
            // Use predictions for future fixtures
            homeXg = fixture.home_pred;
            awayXg = fixture.away_pred;
          } else {
            // Skip if we don't have the required data
            return;
          }

          // Calculate expected points
          const expectedPoints = calculateExpectedPoints(homeXg, awayXg) as ExpectedPointsResult;

          // Initialize team stats if not exists
          if (!teamStats[homeTeamId]) {
            teamStats[homeTeamId] = {
              all: { played: 0, xg_for: 0, xg_against: 0 },
              home: { played: 0, xg_for: 0, xg_against: 0 },
              away: { played: 0, xg_for: 0, xg_against: 0 },
              expected_points_total: 0,
              expected_points_projected: 0,
              fixtures_remaining: 0
            };
          }
          if (!teamStats[awayTeamId]) {
            teamStats[awayTeamId] = {
              all: { played: 0, xg_for: 0, xg_against: 0 },
              home: { played: 0, xg_for: 0, xg_against: 0 },
              away: { played: 0, xg_for: 0, xg_against: 0 },
              expected_points_total: 0,
              expected_points_projected: 0,
              fixtures_remaining: 0
            };
          }

          // Count fixtures remaining for future games
          if (!isPastFixture) {
            teamStats[homeTeamId].fixtures_remaining++;
            teamStats[awayTeamId].fixtures_remaining++;
          }

          if (isPastFixture) {
            teamStats[homeTeamId].expected_points_total += expectedPoints.homeExpectedPoints;
            teamStats[awayTeamId].expected_points_total += expectedPoints.awayExpectedPoints;
          } else {
            // For future fixtures, add expected points to projected total
            teamStats[homeTeamId].expected_points_projected += expectedPoints.homeExpectedPoints;
            teamStats[awayTeamId].expected_points_projected += expectedPoints.awayExpectedPoints;
          }

          // Update xG stats for past fixtures only
          if (isPastFixture) {
            const xgHome = parseFloat(fixture.xg_home) || 0;
            const xgAway = parseFloat(fixture.xg_away) || 0;

            // Update home team stats
            teamStats[homeTeamId].all.played++;
            teamStats[homeTeamId].all.xg_for += xgHome;
            teamStats[homeTeamId].all.xg_against += xgAway;
            teamStats[homeTeamId].home.played++;
            teamStats[homeTeamId].home.xg_for += xgHome;
            teamStats[homeTeamId].home.xg_against += xgAway;

            // Update away team stats
            teamStats[awayTeamId].all.played++;
            teamStats[awayTeamId].all.xg_for += xgAway;
            teamStats[awayTeamId].all.xg_against += xgHome;
            teamStats[awayTeamId].away.played++;
            teamStats[awayTeamId].away.xg_for += xgAway;
            teamStats[awayTeamId].away.xg_against += xgHome;
          }
        });

        teamXGStats = teamStats;
      }

      // Determine if we should calculate win percentage
      // If season end date is much further away than last scheduled fixture date, don't calculate
      if (lastFixtureDate) {
        const seasonEndDate = seasons[seasonToUse]?.end;
        if (seasonEndDate) {
          const lastFixture = new Date(lastFixtureDate);
          const seasonEnd = new Date(seasonEndDate);
          const daysDifference = Math.ceil((seasonEnd.getTime() - lastFixture.getTime()) / (1000 * 60 * 60 * 24));

          // If season end is more than 30 days after last scheduled fixture, don't calculate win percentage
          // This indicates there are likely playoffs, promotion/relegation playoffs, or other
          // post-season tournaments that haven't been played yet and could change final standings
          if (daysDifference > 30) {
            shouldCalculateWinPercentage = false;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to fetch fixtures for xG calculations:', error);
      // Continue without xG stats if fixtures fetch fails
    }

    return NextResponse.json({
      success: true,
      league: {
        id: league.id,
        name: league.name,
        type: league.type,
        country: league.country,
        seasons: league.seasons,
        xg_source: league.xg_source,
        updated_at: league.updated_at,
        pinnacle_league_id: league.pinnacle_league_id,
        betfair_competition_id: league.betfair_competition_id,
        veikkaus_league_id: league.veikkaus_league_id,
        requested_season: requestedSeason,
        season_used: seasonToUse
      },
        standings: {
        league_info: {
          id: leagueData.league.id,
          name: leagueData.league.name,
          country: leagueData.league.country,
          logo: leagueData.league.logo,
          flag: leagueData.league.flag,
          season: leagueData.league.season
        },
        descriptions: (() => {
          // Group descriptions by unique groups with all ranks for each description
          const groupDescriptions: { [group: string]: Array<{ description: string; ranks: number[] }> } = {};

          standings.forEach(team => {
            const group = team.group || 'Regular Season';
            if (!groupDescriptions[group]) {
              groupDescriptions[group] = [];
            }

            const description = team.description || 'Mid-Table';
            let descriptionItem = groupDescriptions[group].find(item => item.description === description);
            if (!descriptionItem) {
              descriptionItem = {
                description: description,
                ranks: []
              };
              groupDescriptions[group].push(descriptionItem);
            }
            if (!descriptionItem.ranks.includes(team.rank)) {
              descriptionItem.ranks.push(team.rank);
            }
          });

          return groupDescriptions;
        })(),
        standings: (() => {
          // First pass: calculate projected points for all teams
          const teamsWithProjected = standings.map(team => {
            const teamStats = teamXGStats[team.team.id.toString()] || {
              all: { played: 0, xg_for: 0, xg_against: 0 },
              home: { played: 0, xg_for: 0, xg_against: 0 },
              away: { played: 0, xg_for: 0, xg_against: 0 },
              expected_points_total: 0,
              expected_points_projected: 0,
              fixtures_remaining: 0
            };

            // Calculate projected points (current + future expected)
            const futureExpectedPoints = teamStats.expected_points_projected;
            const projectedTotal = team.points + futureExpectedPoints;

            return {
              ...team,
              xg_stats: {
                ...teamStats,
                expected_points_projected: projectedTotal
              }
            };
          });

          // Calculate position percentages for all teams
          const positionPercentages = calculatePositionPercentagesFromProjectedPoints(teamsWithProjected);

          // Pre-calculate group descriptions for reuse
          const groupDescriptions: { [group: string]: Array<{ description: string; ranks: number[] }> } = {};

          standings.forEach(team => {
            const group = team.group || 'default';
            if (!groupDescriptions[group]) {
              groupDescriptions[group] = [];
            }

            const description = team.description || 'Mid-Table';
            let descriptionItem = groupDescriptions[group].find(item => item.description === description);
            if (!descriptionItem) {
              descriptionItem = {
                description: description,
                ranks: []
              };
              groupDescriptions[group].push(descriptionItem);
            }
            if (!descriptionItem.ranks.includes(team.rank)) {
              descriptionItem.ranks.push(team.rank);
            }
          });

          // Add win percentages and description percentages to teams
          return teamsWithProjected.map(team => {
            const teamPositionData = positionPercentages.find((pp: any) => pp.teamId === team.team.id);
            const group = team.group || 'default';

            // Create an object with percentages for all descriptions in this group
            const descriptionPercentages: { [description: string]: number } = {};

            if (groupDescriptions[group]) {
              groupDescriptions[group].forEach(desc => {
                let totalProbability = 0;

                if (team.xg_stats?.fixtures_remaining === 0) {
                  // Season is over - team has 100% probability for their current rank
                  if (desc.ranks.includes(team.rank)) {
                    totalProbability = 100;
                  }
                } else if (teamPositionData) {
                  // Season in progress - use calculated position probabilities
                  desc.ranks.forEach(rank => {
                    // rank is 1-indexed, positionProbabilities is 0-indexed
                    const positionIndex = rank - 1;
                    if (positionIndex < teamPositionData.positionProbabilities.length) {
                      totalProbability += teamPositionData.positionProbabilities[positionIndex];
                    }
                  });
                }

                descriptionPercentages[desc.description] = totalProbability;
              });
            }

            const winPercentage = !shouldCalculateWinPercentage
              ? null  // Don't calculate win percentage if season end is too far away
              : team.xg_stats?.fixtures_remaining === 0
              ? (team.rank === 1 ? 100 : 0)  // 100% if rank 1, 0% otherwise
              : (teamPositionData?.positionProbabilities[0] || 0); // Position 0 = 1st place

            return {
              ...team,
              win_percentage: winPercentage,
              description_percentages: descriptionPercentages
            };
          });
        })()
      }
    });

  } catch (error) {
    console.error('Failed to fetch league with standings:', error);

    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        {
          success: false,
          message: `API request failed: ${error.response?.data?.message || error.message}`
        },
        { status: error.response?.status || 500 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: `Failed to fetch league data: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getLeagueWithStandings);

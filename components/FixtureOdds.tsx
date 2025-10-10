import React, { useState, useEffect } from 'react';
import { OddsChart } from './OddsChart';

interface FixtureOddsProps {
  fixtureId: string | null;
}

interface OddsData {
  odds: Array<{
    fixture_id: number;
    bookie_id: number;
    bookie: string;
    odds_x12: Array<{ t: number; x12: number[] }>;
    odds_ah: Array<{ t: number; ah_h: number[]; ah_a: number[] }>;
    odds_ou: Array<{ t: number; ou_o: number[]; ou_u: number[] }>;
    lines: Array<{ t: number; ah: number[]; ou: number[] }>;
    ids: Array<{ t: number; line_id: number; line_ids: { x12: string; ah: string[]; ou: string[] } }>;
    max_stakes: Array<{ t: number; max_stake_x12: number[]; max_stake_ah: { h: number[]; a: number[] }; max_stake_ou: { o: number[]; u: number[] } }>;
    latest_t: { x12_ts: number; ah_ts: number; ou_ts: number; ids_ts: number; stakes_ts: number; lines_ts: number };
    decimals: number;
    created_at: string;
    updated_at: string;
    fair_odds_x12?: any;
    fair_odds_ah?: any;
    fair_odds_ou?: any;
    latest_lines?: any;
    payout_x12?: number;
    payout_ah?: number[];
    payout_ou?: number[];
  }>;
}

interface TopOddsData {
  topOdds: {
    fixture_id: number;
    home_team_name: string;
    away_team_name: string;
    league_name: string;
    fixture_date: string;
    top_x12_odds: number[];
    top_x12_bookies: string[];
    top_ah_odds?: { ah_h: number[]; ah_a: number[] };
    top_ah_lines?: number[];
    top_ah_bookies?: { ah_h: string[]; ah_a: string[] };
    top_ou_odds?: { ou_o: number[]; ou_u: number[] };
    top_ou_lines?: number[];
    top_ou_bookies?: { ou_o: string[]; ou_u: string[] };
  };
}

export function FixtureOdds({ fixtureId }: FixtureOddsProps) {
  const [oddsData, setOddsData] = useState<OddsData | null>(null);
  const [oddsLoading, setOddsLoading] = useState(true);
  const [oddsError, setOddsError] = useState<string | null>(null);
  const [topOddsData, setTopOddsData] = useState<TopOddsData | null>(null);
  const [topOddsLoading, setTopOddsLoading] = useState(true);

  // Track which cells have flashed and their direction: 'up' (green) or 'down' (red)
  // Key format: "bookie:market:outcome[:line]"
  const [flashingCells, setFlashingCells] = useState<Record<string, 'up' | 'down'>>({});

  // Use ref to track previous odds without causing re-renders
  const previousOddsRef = React.useRef<OddsData | null>(null);

  // Subscribe to SSE stream for real-time updates
  useEffect(() => {
    if (!fixtureId) {
      setOddsLoading(false);
      setOddsData(null);
      previousOddsRef.current = null;
      return;
    }

    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource(`/api/fixtures/${fixtureId}/odds/stream`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            setOddsError(data.error);
            setOddsLoading(false);
          } else {
            // Compare with previous odds to detect changes
            if (previousOddsRef.current) {
              const changes = detectOddsChanges(previousOddsRef.current, data);
              if (Object.keys(changes).length > 0) {
                setFlashingCells(changes);
                // Clear flashing after animation completes (2s to match CSS)
                setTimeout(() => setFlashingCells({}), 2000);
              }
            }

            previousOddsRef.current = data;
            setOddsData(data);
            setOddsLoading(false);
            setOddsError(null);
          }
        } catch (e) {
          console.error('Error parsing SSE data:', e);
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        setOddsError('Connection error');
        setOddsLoading(false);

        // Close the connection on error
        if (eventSource) {
          eventSource.close();
        }
      };
    } catch (error) {
      console.error('Failed to connect to SSE:', error);
      setOddsError('Failed to connect');
      setOddsLoading(false);
    }

    // Cleanup function: close EventSource when component unmounts or fixtureId changes
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [fixtureId]); // Only depend on fixtureId!

  // Helper function to detect odds changes
  const detectOddsChanges = (oldData: OddsData, newData: OddsData): Record<string, 'up' | 'down'> => {
    const changes: Record<string, 'up' | 'down'> = {};
    
    newData.odds.forEach(newBookie => {
      const oldBookie = oldData.odds.find(b => b.bookie === newBookie.bookie);
      if (!oldBookie) return;

      // Compare 1X2 odds
      const oldX12 = oldBookie.odds_x12?.[oldBookie.odds_x12.length - 1];
      const newX12 = newBookie.odds_x12?.[newBookie.odds_x12.length - 1];
      if (oldX12 && newX12) {
        ['Home', 'Draw', 'Away'].forEach((outcome, idx) => {
          if (oldX12.x12[idx] !== newX12.x12[idx]) {
            const key = `${newBookie.bookie}:1X2:${outcome}`;
            changes[key] = newX12.x12[idx] > oldX12.x12[idx] ? 'up' : 'down';
          }
        });
      }

      // Compare Asian Handicap odds
      const oldAH = oldBookie.odds_ah?.[oldBookie.odds_ah.length - 1];
      const newAH = newBookie.odds_ah?.[newBookie.odds_ah.length - 1];
      const oldLines = oldBookie.lines?.[oldBookie.lines.length - 1];
      const newLines = newBookie.lines?.[newBookie.lines.length - 1];
      
      if (oldAH && newAH && oldLines && newLines) {
        newLines.ah?.forEach((line, newLineIdx) => {
          // Find the same line in old lines by value, not by index
          const oldLineIdx = oldLines.ah?.indexOf(line);
          
          if (oldLineIdx !== undefined && oldLineIdx >= 0) {
            if (oldAH.ah_h?.[oldLineIdx] !== newAH.ah_h?.[newLineIdx]) {
              const key = `${newBookie.bookie}:Asian Handicap:Home:${line}`;
              changes[key] = newAH.ah_h[newLineIdx] > oldAH.ah_h[oldLineIdx] ? 'up' : 'down';
            }
            if (oldAH.ah_a?.[oldLineIdx] !== newAH.ah_a?.[newLineIdx]) {
              const key = `${newBookie.bookie}:Asian Handicap:Away:${line}`;
              changes[key] = newAH.ah_a[newLineIdx] > oldAH.ah_a[oldLineIdx] ? 'up' : 'down';
            }
          }
        });
      }

      // Compare Over/Under odds
      const oldOU = oldBookie.odds_ou?.[oldBookie.odds_ou.length - 1];
      const newOU = newBookie.odds_ou?.[newBookie.odds_ou.length - 1];
      
      if (oldOU && newOU && oldLines && newLines) {
        newLines.ou?.forEach((line, newLineIdx) => {
          // Find the same line in old lines by value, not by index
          const oldLineIdx = oldLines.ou?.indexOf(line);
          
          if (oldLineIdx !== undefined && oldLineIdx >= 0) {
            if (oldOU.ou_o?.[oldLineIdx] !== newOU.ou_o?.[newLineIdx]) {
              const key = `${newBookie.bookie}:Over/Under:Over:${line}`;
              changes[key] = newOU.ou_o[newLineIdx] > oldOU.ou_o[oldLineIdx] ? 'up' : 'down';
            }
            if (oldOU.ou_u?.[oldLineIdx] !== newOU.ou_u?.[newLineIdx]) {
              const key = `${newBookie.bookie}:Over/Under:Under:${line}`;
              changes[key] = newOU.ou_u[newLineIdx] > oldOU.ou_u[oldLineIdx] ? 'up' : 'down';
            }
          }
        });
      }
    });

    return changes;
  };
  
  // State for odds chart
  const [chartData, setChartData] = useState<{
    isOpen: boolean;
    title: string;
    bookie: string;
    oddsHistory: Array<{ t: number; value: number }>;
    decimals: number;
    position: { x: number; y: number };
  } | null>(null);

  // Helper function to handle odds click
  const handleOddsClick = (
    event: React.MouseEvent,
    bookie: string,
    marketType: string,
    outcome: string,
    line?: number,
    decimals: number = 2
  ) => {
    // Find the bookmaker data
    const bookmakerData = oddsData?.odds.find(bm => bm.bookie === bookie);
    if (!bookmakerData) return;

    // Extract historical odds for this specific outcome
    let history: Array<{ t: number; value: number }> = [];

    // Based on market type and outcome, extract the appropriate odds
    if (marketType === '1X2') {
      const index = outcome === 'Home' ? 0 : outcome === 'Draw' ? 1 : 2;
      bookmakerData.odds_x12?.forEach(oddsEntry => {
        const value = oddsEntry.x12?.[index] || null;
        if (value !== null && value > 0) {
          history.push({
            t: oddsEntry.t,
            value: value
          });
        }
      });
    } else if (marketType === 'Asian Handicap' && line !== undefined) {
      // For each historical odds entry, find the line index at that timestamp
      bookmakerData.odds_ah?.forEach((oddsEntry, oddsIndex) => {
        // Find the lines data at this timestamp (or the latest available before this timestamp)
        let linesAtTime = null;
        for (let i = 0; i < (bookmakerData.lines?.length || 0); i++) {
          if (bookmakerData.lines![i].t <= oddsEntry.t) {
            linesAtTime = bookmakerData.lines![i];
          } else {
            break;
          }
        }

        // Find the line index at this specific timestamp
        const lineIndex = linesAtTime?.ah?.indexOf(line);
        
        if (lineIndex !== undefined && lineIndex >= 0) {
          let value: number | null = null;
          if (outcome === 'Home') {
            value = oddsEntry.ah_h?.[lineIndex] || null;
          } else if (outcome === 'Away') {
            value = oddsEntry.ah_a?.[lineIndex] || null;
          }
          if (value !== null && value > 0) {
            history.push({
              t: oddsEntry.t,
              value: value
            });
          }
        }
      });
    } else if (marketType === 'Over/Under' && line !== undefined) {
      // For each historical odds entry, find the line index at that timestamp
      bookmakerData.odds_ou?.forEach((oddsEntry, oddsIndex) => {
        // Find the lines data at this timestamp (or the latest available before this timestamp)
        let linesAtTime = null;
        for (let i = 0; i < (bookmakerData.lines?.length || 0); i++) {
          if (bookmakerData.lines![i].t <= oddsEntry.t) {
            linesAtTime = bookmakerData.lines![i];
          } else {
            break;
          }
        }

        // Find the line index at this specific timestamp
        const lineIndex = linesAtTime?.ou?.indexOf(line);
        
        if (lineIndex !== undefined && lineIndex >= 0) {
          let value: number | null = null;
          if (outcome === 'Over') {
            value = oddsEntry.ou_o?.[lineIndex] || null;
          } else if (outcome === 'Under') {
            value = oddsEntry.ou_u?.[lineIndex] || null;
          }
          if (value !== null && value > 0) {
            history.push({
              t: oddsEntry.t,
              value: value
            });
          }
        }
      });
    }

    // Create title
    let title = `${marketType} - ${outcome}`;
    if (line !== undefined) {
      if (marketType === 'Asian Handicap') {
        const formattedLine = outcome === 'Home' ?
          (line > 0 ? `+${line}` : `${line}`) :
          (line < 0 ? `+${Math.abs(line)}` : line === 0 ? `${line}` : `-${line}`);
        title = `${marketType} ${formattedLine} - ${outcome}`;
      } else if (marketType === 'Over/Under') {
        title = `${marketType} ${line} - ${outcome}`;
      }
    }

    setChartData({
      isOpen: true,
      title,
      bookie,
      oddsHistory: history,
      decimals,
      position: { x: event.clientX, y: event.clientY }
    });
  };

  const closeChart = () => {
    setChartData(null);
  };

  if (oddsLoading) {
    return (
      <div className="px-2 py-4">
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-gray-300"></div>
          <span className="ml-2 text-gray-400 text-sm font-mono">Loading odds...</span>
        </div>
      </div>
    );
  }

  if (oddsError) {
    return (
      <div className="px-2 py-4">
        <div className="text-center py-4">
          <span className="text-red-400 text-sm font-mono">Failed to load odds: {oddsError}</span>
        </div>
      </div>
    );
  }

  if (!oddsData || !oddsData.odds || oddsData.odds.length === 0) {
    return (
      <div className="px-2 py-4">
        <div className="text-center py-4">
          <span className="text-gray-400 text-sm font-mono">No odds available</span>
        </div>
      </div>
    );
  }

  // Transform data to group by market type
  const transformedData = oddsData.odds.reduce((acc, bookmaker) => {
    // Handle fair odds bookmaker specially
    if (bookmaker.bookie === 'PINNACLE_FAIR_ODDS') {
      if (!acc[bookmaker.bookie]) {
        acc[bookmaker.bookie] = {
          bookie: bookmaker.bookie,
          odds: {
            x12: bookmaker.fair_odds_x12?.fair_x12 || null,
            ah_h: bookmaker.fair_odds_ah?.fair_ah_h || null,
            ah_a: bookmaker.fair_odds_ah?.fair_ah_a || null,
            ou_o: bookmaker.fair_odds_ou?.fair_ou_o || null,
            ou_u: bookmaker.fair_odds_ou?.fair_ou_u || null,
            lines: bookmaker.latest_lines ? {
              ah: bookmaker.latest_lines.ah,
              ou: bookmaker.latest_lines.ou
            } : null
          },
          decimals: bookmaker.decimals,
          isFairOdds: true,
          payout: {
            x12: null,
            ah: null,
            ou: null
          }
        };
      }
      return acc;
    }

    // Get the latest data from each array for regular bookmakers
    const latestX12 = bookmaker.odds_x12?.[bookmaker.odds_x12.length - 1];
    const latestAH = bookmaker.odds_ah?.[bookmaker.odds_ah.length - 1];
    const latestOU = bookmaker.odds_ou?.[bookmaker.odds_ou.length - 1];
    const latestLines = bookmaker.lines?.[bookmaker.lines.length - 1];

    if (!acc[bookmaker.bookie]) {
      acc[bookmaker.bookie] = {
        bookie: bookmaker.bookie,
        odds: {
          x12: latestX12?.x12 || null,
          ah_h: latestAH?.ah_h || null,
          ah_a: latestAH?.ah_a || null,
          ou_o: latestOU?.ou_o || null,
          ou_u: latestOU?.ou_u || null,
          lines: latestLines ? {
            ah: latestLines.ah,
            ou: latestLines.ou
          } : null
        },
        decimals: bookmaker.decimals,
        isFairOdds: false,
        payout: {
          x12: bookmaker.payout_x12 || null,
          ah: bookmaker.payout_ah || null,  // An array of payout values per line
          ou: bookmaker.payout_ou || null   // An array of payout values per line
        }
      };
    }

    return acc;
  }, {} as Record<string, { bookie: string; odds: any; decimals: number; isFairOdds?: boolean; isTopOdds?: boolean; payout?: { x12: number | null; ah: number[] | null; ou: number[] | null } }>);

  // Add top odds as a special bookmaker if data is available
  if (topOddsData?.topOdds) {
    const topOdds = topOddsData.topOdds;

    // Transform top odds data into the bookmaker format
    const topOddsBookmaker = {
      bookie: 'TOP_ODDS',
      odds: {
        x12: topOdds.top_x12_odds || null,
        ah_h: topOdds.top_ah_odds?.ah_h || null,
        ah_a: topOdds.top_ah_odds?.ah_a || null,
        ou_o: topOdds.top_ou_odds?.ou_o || null,
        ou_u: topOdds.top_ou_odds?.ou_u || null,
        lines: topOdds.top_ah_lines && topOdds.top_ou_lines ? {
          ah: topOdds.top_ah_lines,
          ou: topOdds.top_ou_lines
        } : null
      },
      decimals: 2, // Top odds are already in decimal format
      isFairOdds: false,
    };

    transformedData['TOP_ODDS'] = topOddsBookmaker;
  }

  const bookmakers = Object.values(transformedData);

  // Helper function to get divisor based on decimals
  const getDivisor = (decimals: number) => Math.pow(10, decimals);

  // Helper to get flash class for a cell
  const getFlashClass = (bookie: string, market: string, outcome: string, line?: number): string => {
    const key = line !== undefined
      ? `${bookie}:${market}:${outcome}:${line}`
      : `${bookie}:${market}:${outcome}`;

    const direction = flashingCells[key];
    if (!direction) return '';

    return direction === 'up' ? 'odds-flash-up' : 'odds-flash-down';
  };

  // Helper to get background color class for a bookmaker
  const getBookieColorClass = (bookie: string, isFairOdds?: boolean, isTopOdds?: boolean, market?: string, side?: string, lineIndex?: number): string => {
    if (isFairOdds) {
      return 'bg-gray-700'; // Dark gray for Fair Odds
    }
    if (isTopOdds) {
      // For Top Odds, get the color based on the actual bookie that provided this specific odds
      if (!topOddsData?.topOdds) {
        return 'bg-black'; // Fallback
      }

      let bookieName = '';
      if (market === '1X2' && side) {
        // For 1X2, lineIndex represents the outcome index (0=Home, 1=Draw, 2=Away)
        const outcomeIndex = side === 'Home' ? 0 : side === 'Draw' ? 1 : 2;
        if (topOddsData.topOdds.top_x12_bookies?.[outcomeIndex]) {
          bookieName = topOddsData.topOdds.top_x12_bookies[outcomeIndex];
        }
      } else if (market === 'Asian Handicap' && side && lineIndex !== undefined) {
        if (side === 'Home' && topOddsData.topOdds.top_ah_bookies?.ah_h?.[lineIndex]) {
          bookieName = topOddsData.topOdds.top_ah_bookies.ah_h[lineIndex];
        } else if (side === 'Away' && topOddsData.topOdds.top_ah_bookies?.ah_a?.[lineIndex]) {
          bookieName = topOddsData.topOdds.top_ah_bookies.ah_a[lineIndex];
        }
      } else if (market === 'Over/Under' && side && lineIndex !== undefined) {
        if (side === 'Over' && topOddsData.topOdds.top_ou_bookies?.ou_o?.[lineIndex]) {
          bookieName = topOddsData.topOdds.top_ou_bookies.ou_o[lineIndex];
        } else if (side === 'Under' && topOddsData.topOdds.top_ou_bookies?.ou_u?.[lineIndex]) {
          bookieName = topOddsData.topOdds.top_ou_bookies.ou_u[lineIndex];
        }
      }

      // Now get color for this specific bookie
      return getBookieColorFromName(bookieName);
    }

    const bookieName = bookie.toLowerCase();
    if (bookieName.includes('veikkaus')) {
      return 'bg-blue-900'; // Dark blue for Veikkaus
    }
    if (bookieName.includes('betfair')) {
      return 'bg-yellow-800'; // Dark yellow for Betfair
    }
    if (bookieName.includes('pinnacle')) {
      return 'bg-gray-900'; // Very dark gray/black for Pinnacle
    }

    return 'bg-gray-800'; // Dark background for other bookies
  };

  // Helper to get color class from bookie name (used for Top Odds)
  const getBookieColorFromName = (bookieName: string): string => {
    const name = bookieName.toLowerCase();
    if (name.includes('veikkaus')) {
      return 'bg-blue-900'; // Dark blue for Veikkaus
    }
    if (name.includes('betfair')) {
      return 'bg-yellow-800'; // Dark yellow for Betfair
    }
    if (name.includes('pinnacle')) {
      return 'bg-gray-900'; // Very dark gray/black for Pinnacle
    }
    return 'bg-black'; // Default dark background
  };

  // Helper to get payout background color class based on payout percentage
  const getPayoutBgColorClass = (payoutPercentage: number): string => {
    // Clamp values for better color transitions
    const clamped = Math.max(90, Math.min(105, payoutPercentage));

    if (clamped < 90) {
      // Reddish background for values under 90%
      return 'bg-red-900';
    } else if (clamped >= 90 && clamped <= 103) {
      // Transition from red to green background between 90% and 103%
      const ratio = (clamped - 90) / (103 - 90); // 0 to 1
      if (ratio < 0.33) {
        // Dark red
        return 'bg-red-800';
      } else if (ratio < 0.66) {
        // Orange/red
        return 'bg-orange-900';
      } else {
        // Dark green
        return 'bg-green-900';
      }
    } else {
      // Bright green background for values over 103%
      return 'bg-green-800';
    }
  };

  // Generic helper function for simple markets (1X2)
  const renderSimpleTable = (marketName: string, outcomes: { label: string; getValue: (odds: any, bm?: any) => string | null }[]) => {
    const hasData = bookmakers.some(bm => outcomes.some(outcome => outcome.getValue(bm.odds, bm) !== null));
    if (!hasData) return null;

    return (
      <div className="mb-4">
        <h4 className="text-xs font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-black">
                <th className="px-2 py-1 text-left text-gray-300 border border-gray-600"></th>
                {bookmakers.map(bm => (
                  <th key={bm.bookie} className="px-2 py-1 text-center text-gray-300 border border-gray-600 min-w-[60px]">
                    {bm.isFairOdds ? 'Fair Odds' : bm.bookie === 'predictions' ? 'Prediction' : bm.isTopOdds ? 'Top Odds' : bm.bookie}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {outcomes.map((outcome, index) => (
                <tr key={index}>
                  <td className="px-2 py-1 text-bg-black border border-gray-600 font-medium">
                    {outcome.label}
                  </td>
                  {bookmakers.map(bm => {
                    const value = outcome.getValue(bm.odds, bm);
                    const flashClass = getFlashClass(bm.bookie, marketName, outcome.label);
                    // For 1X2, pass the outcome index (0=Home, 1=Draw, 2=Away)
                    const outcomeIndex = outcome.label === 'Home' ? 0 : outcome.label === 'Draw' ? 1 : 2;
                    const bgColorClass = getBookieColorClass(bm.bookie, bm.isFairOdds, bm.isTopOdds, marketName, outcome.label, outcomeIndex);
                    return (
                      <td key={bm.bookie} className={`px-2 py-1 text-center border border-gray-600 ${bgColorClass}`}>
                        {value ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, outcome.label, undefined, bm.decimals)}
                            className={`text-white hover:text-gray-300 px-1 py-0.5 rounded transition-colors cursor-pointer ${flashClass}`}
                          >
                            {value}
                          </button>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Add payout row for X12 market */}
              {marketName === '1X2' && (
                <tr>
                  <td className="px-2 py-1 text-white border border-gray-600 font-medium text-xs">
                    Payout
                  </td>
                  {bookmakers.map(bm => {
                    const payoutValue = bm.payout?.x12;
                    const payoutPercentage = payoutValue ? payoutValue * 100 : 0;
                    const payoutBgColorClass = payoutValue ? getPayoutBgColorClass(payoutPercentage) : '';
                    return (
                      <td key={`${bm.bookie}-payout`} className={`px-2 py-1 text-center border border-gray-600 ${payoutBgColorClass}`}>
                        {payoutValue ? (
                          <span className="text-white text-xs font-mono">
                            {(payoutValue * 100).toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Generic helper function for split markets (AH and OU)
  const renderSplitTable = (
    marketName: string,
    linesKey: 'ah' | 'ou',
    side1: { label: string; oddsKey: string; lineFormatter: (line: number) => string },
    side2: { label: string; oddsKey: string; lineFormatter: (line: number) => string }
  ) => {
    // Get all unique lines from the bookmaker data
    const allLines = new Set<number>();
    oddsData.odds.forEach(bm => {
      const linesData = bm.lines?.[bm.lines.length - 1];
      if (linesData?.[linesKey]) {
        linesData[linesKey].forEach((line: number) => allLines.add(line));
      }
      // Also check fair odds lines
      if (bm.bookie === 'PINNACLE_FAIR_ODDS' && bm.latest_lines?.[linesKey]) {
        bm.latest_lines[linesKey].forEach((line: number) => allLines.add(line));
      }
    });
    // Also check top odds lines
    if (topOddsData?.topOdds) {
      const topOddsLines = linesKey === 'ah' ? topOddsData.topOdds.top_ah_lines : topOddsData.topOdds.top_ou_lines;
      if (topOddsLines) {
        topOddsLines.forEach((line: number) => allLines.add(line));
      }
    }
    const sortedLines = Array.from(allLines).sort((a, b) => a - b);

    // Filter out lines that have no odds from any bookmaker
    const linesWithOdds = sortedLines.filter(line =>
      bookmakers.some(bm => {
        if (bm.isFairOdds || bm.isTopOdds) {
          // For fair odds and top odds, check if the odds array exists and has data at this line index
          const lineIndex = bm.odds.lines?.[linesKey]?.indexOf(line);
          return lineIndex !== undefined && lineIndex >= 0 &&
                 (bm.odds[side1.oddsKey]?.[lineIndex] || bm.odds[side2.oddsKey]?.[lineIndex]);
        } else {
          const lineIndex = bm.odds.lines?.[linesKey]?.indexOf(line);
          return lineIndex !== undefined && lineIndex >= 0 &&
                 (bm.odds[side1.oddsKey]?.[lineIndex] || bm.odds[side2.oddsKey]?.[lineIndex]);
        }
      })
    );

    // Check if we have any data
    const hasData = linesWithOdds.length > 0;
    if (!hasData) return null;

    // Helper to get odds for a specific line and side
    const getOdds = (bm: any, line: number, oddsKey: string) => {
      const lineIndex = bm.odds.lines?.[linesKey]?.indexOf(line);
      if (lineIndex !== undefined && lineIndex >= 0 && bm.odds[oddsKey]?.[lineIndex]) {
        if (bm.isFairOdds || bm.isTopOdds) {
          // Fair odds and top odds are already in decimal format, just return as string
          return bm.odds[oddsKey][lineIndex]?.toString() || null;
        } else {
          // Regular odds are in basis points, convert to decimal
          return (bm.odds[oddsKey][lineIndex] / getDivisor(bm.decimals)).toString();
        }
      }
      return null;
    };

    return (
      <div className="mb-4">
        <h4 className="text-xs font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-black">
                <th className="px-2 py-1 text-left text-bg-black border border-gray-600">{side1.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side1.label}-${bm.bookie}`} className="px-2 py-1 text-center text-bg-black border border-gray-600 min-w-[60px]">
                    {bm.isFairOdds ? 'Fair Odds' : bm.bookie === 'predictions' ? 'Prediction' : bm.isTopOdds ? 'Top Odds' : bm.bookie}
                  </th>
                ))}
                <th className="px-2 py-1 text-left text-bg-black border border-gray-600">{side2.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side2.label}-${bm.bookie}`} className="px-2 py-1 text-center text-bg-black border border-gray-600 min-w-[60px]">
                    {bm.isFairOdds ? 'Fair Odds' : bm.bookie === 'predictions' ? 'Prediction' : bm.isTopOdds ? 'Top Odds' : bm.bookie}
                  </th>
                ))}
                <th className="px-2 py-1 text-center text-white border border-gray-600 min-w-[60px]">
                  Payout
                </th>
              </tr>
            </thead>
            <tbody>
              {linesWithOdds.map((line, index) => (
                <tr key={line}>
                  <td className="px-2 py-1 text-bg-black border border-gray-600 font-medium">
                    {side1.lineFormatter(line)}
                  </td>
                  {bookmakers.map(bm => {
                    const odds = getOdds(bm, line, side1.oddsKey);
                    const flashClass = getFlashClass(bm.bookie, marketName, side1.label, line);
                    const lineIndex = bm.odds.lines?.[linesKey]?.indexOf(line);
                    const bgColorClass = getBookieColorClass(bm.bookie, bm.isFairOdds, bm.isTopOdds, marketName, side1.label, lineIndex);
                    return (
                      <td key={`${side1.label}-${bm.bookie}`} className={`px-2 py-1 text-center border border-gray-600 ${bgColorClass}`}>
                        {odds ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side1.label, line, bm.decimals)}
                            className={`text-white hover:text-gray-300 px-1 py-0.5 rounded transition-colors cursor-pointer ${flashClass}`}
                          >
                            {odds}
                          </button>
                        ) : (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side1.label, line, bm.decimals)}
                            className={`text-gray-500 hover:text-gray-700 px-1 py-0.5 rounded transition-colors cursor-pointer`}
                          >
                            -
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-gray-300 border border-gray-600 font-medium">
                    {side2.lineFormatter(line)}
                  </td>
                  {bookmakers.map(bm => {
                    const odds = getOdds(bm, line, side2.oddsKey);
                    const flashClass = getFlashClass(bm.bookie, marketName, side2.label, line);
                    const lineIndex = bm.odds.lines?.[linesKey]?.indexOf(line);
                    const bgColorClass = getBookieColorClass(bm.bookie, bm.isFairOdds, bm.isTopOdds, marketName, side2.label, lineIndex);
                    return (
                      <td key={`${side2.label}-${bm.bookie}`} className={`px-2 py-1 text-center border border-gray-600 ${bgColorClass}`}>
                        {odds ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side2.label, line, bm.decimals)}
                            className={`text-white hover:text-gray-300 px-1 py-0.5 rounded transition-colors cursor-pointer ${flashClass}`}
                          >
                            {odds}
                          </button>
                        ) : (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side2.label, line, bm.decimals)}
                            className={`text-gray-500 hover:text-gray-700 px-1 py-0.5 rounded transition-colors cursor-pointer`}
                          >
                            -
                          </button>
                        )}
                      </td>
                    );
                  })}
                  {/* Payout column on the far right */}
                  {(() => {
                    // Find the line index (should be the same across all bookmakers for this line)
                    const sampleBookmaker = bookmakers.find(bm => bm.odds.lines?.[linesKey]?.includes(line));
                    if (!sampleBookmaker) return <td className="px-2 py-1 text-center border border-gray-600"><span className="text-gray-500">-</span></td>;

                    const lineIndex = sampleBookmaker.odds.lines?.[linesKey]?.indexOf(line);
                    if (lineIndex === undefined || lineIndex < 0) return <td className="px-2 py-1 text-center border border-gray-600"><span className="text-gray-500">-</span></td>;

                    let payoutValue: number | null = null;
                    let displayText = '';

                    // Use top odds payout if available, otherwise fall back to averaging
                    const topOddsBookmaker = bookmakers.find(bm => bm.isTopOdds);
                    if (topOddsBookmaker) {
                      const topOddsPayoutArray = linesKey === 'ah' ? topOddsBookmaker.payout?.ah : topOddsBookmaker.payout?.ou;
                      const topOddsPayout = topOddsPayoutArray?.[lineIndex];
                      if (topOddsPayout !== null && topOddsPayout !== undefined) {
                        payoutValue = topOddsPayout;
                        displayText = (topOddsPayout * 100).toFixed(1) + '%';
                      }
                    }

                    // Fall back to averaging individual bookmaker payouts
                    if (payoutValue === null) {
                      const payoutValues = bookmakers
                        .filter(bm => !bm.isTopOdds) // Exclude top odds from averaging
                        .map(bm => {
                          const payoutArray = linesKey === 'ah' ? bm.payout?.ah : bm.payout?.ou;
                          return payoutArray?.[lineIndex] || null;
                        })
                        .filter((p): p is number => p !== null);

                      if (payoutValues.length === 0) return <td className="px-2 py-1 text-center border border-gray-600"><span className="text-gray-500">-</span></td>;

                      // Calculate average payout across all bookmakers for this line
                      payoutValue = payoutValues.reduce((sum, p) => sum + p, 0) / payoutValues.length;
                      displayText = (payoutValue * 100).toFixed(1) + '%';
                    }

                    const payoutBgColorClass = getPayoutBgColorClass(payoutValue * 100);
                    return (
                      <td className={`px-2 py-1 text-center border border-gray-600 ${payoutBgColorClass}`}>
                        <span className="text-white text-xs font-mono">{displayText}</span>
                      </td>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="px-0 py-0">

      {/* 1X2 Market */}
      {renderSimpleTable('1X2', [
        {
          label: 'Home',
          getValue: (odds: any, bm?: any) => {
            if (bm?.isFairOdds || bm?.isTopOdds) {
              // Fair odds and top odds are already in decimal format
              return odds.x12?.[0]?.toString() || null;
            } else {
              // Regular odds are in basis points
              return odds.x12?.[0] ? (odds.x12[0] / getDivisor(bm?.decimals || 2)).toString() : null;
            }
          }
        },
        {
          label: 'Draw',
          getValue: (odds: any, bm?: any) => {
            if (bm?.isFairOdds || bm?.isTopOdds) {
              // Fair odds and top odds are already in decimal format
              return odds.x12?.[1]?.toString() || null;
            } else {
              // Regular odds are in basis points
              return odds.x12?.[1] ? (odds.x12[1] / getDivisor(bm?.decimals || 2)).toString() : null;
            }
          }
        },
        {
          label: 'Away',
          getValue: (odds: any, bm?: any) => {
            if (bm?.isFairOdds || bm?.isTopOdds) {
              // Fair odds and top odds are already in decimal format
              return odds.x12?.[2]?.toString() || null;
            } else {
              // Regular odds are in basis points
              return odds.x12?.[2] ? (odds.x12[2] / getDivisor(bm?.decimals || 2)).toString() : null;
            }
          }
        }
      ])}

      {/* Asian Handicap Market */}
      {renderSplitTable(
        'Asian Handicap',
        'ah',
        {
          label: 'Home',
          oddsKey: 'ah_h',
          lineFormatter: (line: number) => line > 0 ? `+${line}` : `${line}`
        },
        {
          label: 'Away',
          oddsKey: 'ah_a',
          lineFormatter: (line: number) => line < 0 ? `+${Math.abs(line)}` : line === 0 ? `${line}` : `-${line}`
        }
      )}

      {/* Over/Under Market */}
      {renderSplitTable(
        'Over/Under',
        'ou',
        {
          label: 'Over',
          oddsKey: 'ou_o',
          lineFormatter: (line: number) => `${line}`
        },
        {
          label: 'Under',
          oddsKey: 'ou_u',
          lineFormatter: (line: number) => `${line}`
        }
      )}

      {/* Odds Chart */}
      {chartData && (
        <OddsChart
          isOpen={chartData.isOpen}
          onClose={closeChart}
          title={chartData.title}
          bookie={chartData.bookie}
          oddsHistory={chartData.oddsHistory}
          decimals={chartData.decimals}
          position={chartData.position}
        />
      )}
    </div>
  );
}

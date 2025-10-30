import React, { useState, useEffect } from 'react';
import { OddsChart } from './OddsChart';


interface FixtureOddsProps {
  fixtureId: string | null;
  fixture?: {
    odds_bookie_used?: string;
    fair_odds_bookie_used?: string;
  };
}

interface OddsData {
  odds: Array<{
    fixture_id: number;
    bookie_id: number;
    bookie: string;
    odds_x12: Array<{ t: number; x12: number[] }> | { t: number; x12: number[] };
    odds_ah: Array<{ t: number; ah_h: number[]; ah_a: number[] }> | { t: number; ah_h: number[]; ah_a: number[] };
    odds_ou: Array<{ t: number; ou_o: number[]; ou_u: number[] }> | { t: number; ou_o: number[]; ou_u: number[] };
    lines: Array<{ t: number; ah: number[]; ou: number[] }> | { t: number; ah: number[]; ou: number[] };
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


export function FixtureOdds({ fixtureId, fixture }: FixtureOddsProps) {
  const [oddsData, setOddsData] = useState<OddsData | null>(null);
  const [oddsLoading, setOddsLoading] = useState(true);
  const [oddsError, setOddsError] = useState<string | null>(null);

  // Track which cells have flashed and their direction: 'up' (green) or 'down' (red)
  // Key format: "bookie:market:outcome[:line]"
  const [flashingCells, setFlashingCells] = useState<Record<string, 'up' | 'down'>>({});

  // Use ref to track previous odds without causing re-renders
  const previousOddsRef = React.useRef<OddsData | null>(null);

  // Subscribe to SSE stream for real-time updates
  useEffect(() => {
    if (!fixtureId) {
      setOddsLoading(true);
      setOddsData(null);
      previousOddsRef.current = null;
      return;
    }

    let eventSource: EventSource | null = null;
    let isMounted = true;

    const setupOdds = async () => {
      try {
        // Fetch current odds data
        const response = await fetch(`/api/odds?fixtureId=${fixtureId}`);
        if (response.ok && isMounted) {
          const data = await response.json();
          if (data.odds && data.odds.length > 0) {
            const initialData: OddsData = { odds: data.odds };
            setOddsData(initialData);
            previousOddsRef.current = initialData;
          }
        }
      } catch (error) {
        console.warn('Failed to fetch initial odds data:', error);
      }

      // Set up the stream for real-time updates
      if (isMounted) {
        eventSource = new EventSource(`/api/odds/stream?fixtureId=${fixtureId}`);

        eventSource.onmessage = (event) => {
          if (!isMounted) return;

          try {
            const data = JSON.parse(event.data);

            if (data.error) {
              console.warn('SSE error received:', data.error);
              setOddsError(data.error);
            } else if (data.type !== 'started') {
              // Handle odds update
              const normalizedData: OddsData = { odds: data.odds || [] };

              // Validate the data structure
              if (!Array.isArray(normalizedData.odds)) {
                console.error('Invalid odds data structure - odds is not an array:', normalizedData);
                setOddsError('Invalid odds data structure');
                return;
              }

              // Compare with previous odds to detect changes
              if (previousOddsRef.current) {
                const changes = detectOddsChanges(previousOddsRef.current, normalizedData);
                if (Object.keys(changes).length > 0) {
                  setFlashingCells(changes);
                  setTimeout(() => setFlashingCells({}), 2000);
                }
              }

              previousOddsRef.current = normalizedData;
              setOddsData(normalizedData);
              setOddsError(null);
            }
          } catch (e) {
            console.error('Error parsing SSE data:', e);
            setOddsError('Failed to parse odds update');
          }
        };

        eventSource.onerror = (error) => {
          if (!isMounted) return;
          console.error('SSE error:', error);
          setOddsError('Connection error');
        };

        // Mark as loaded once stream is set up
        setOddsLoading(false);
      }
    };

    setupOdds();

    // Cleanup
    return () => {
      isMounted = false;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [fixtureId]);

  // Helper function to detect odds changes
  const detectOddsChanges = (oldData: OddsData, newData: OddsData): Record<string, 'up' | 'down'> => {
    const changes: Record<string, 'up' | 'down'> = {};
    
    newData.odds.forEach(newBookie => {
      const oldBookie = oldData.odds.find(b => b.bookie === newBookie.bookie);
      if (!oldBookie) return;

      // Compare 1X2 odds
      const oldX12 = Array.isArray(oldBookie.odds_x12)
        ? oldBookie.odds_x12?.[oldBookie.odds_x12.length - 1]
        : oldBookie.odds_x12;
      const newX12 = Array.isArray(newBookie.odds_x12)
        ? newBookie.odds_x12?.[newBookie.odds_x12.length - 1]
        : newBookie.odds_x12;
      if (oldX12 && newX12) {
        ['Home', 'Draw', 'Away'].forEach((outcome, idx) => {
          if (oldX12.x12[idx] !== newX12.x12[idx]) {
            const key = `${newBookie.bookie}:1X2:${outcome}`;
            changes[key] = newX12.x12[idx] > oldX12.x12[idx] ? 'up' : 'down';
          }
        });
      }

      // Compare Asian Handicap odds
      const oldAH = Array.isArray(oldBookie.odds_ah)
        ? oldBookie.odds_ah?.[oldBookie.odds_ah.length - 1]
        : oldBookie.odds_ah;
      const newAH = Array.isArray(newBookie.odds_ah)
        ? newBookie.odds_ah?.[newBookie.odds_ah.length - 1]
        : newBookie.odds_ah;
      const oldLines = Array.isArray(oldBookie.lines)
        ? oldBookie.lines?.[oldBookie.lines.length - 1]
        : oldBookie.lines;
      const newLines = Array.isArray(newBookie.lines)
        ? newBookie.lines?.[newBookie.lines.length - 1]
        : newBookie.lines;
      
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
      const oldOU = Array.isArray(oldBookie.odds_ou)
        ? oldBookie.odds_ou?.[oldBookie.odds_ou.length - 1]
        : oldBookie.odds_ou;
      const newOU = Array.isArray(newBookie.odds_ou)
        ? newBookie.odds_ou?.[newBookie.odds_ou.length - 1]
        : newBookie.odds_ou;
      
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

      // Handle both array format (historical) and single object format (latest only)
      if (Array.isArray(bookmakerData.odds_x12)) {
        bookmakerData.odds_x12?.forEach(oddsEntry => {
          const value = oddsEntry.x12?.[index] || null;
          if (value !== null && value > 0) {
            history.push({
              t: oddsEntry.t,
              value: value
            });
          }
        });
      } else if (bookmakerData.odds_x12) {
        // Single object format - just add the latest value
        const value = bookmakerData.odds_x12.x12?.[index] || null;
        if (value !== null && value > 0) {
          history.push({
            t: bookmakerData.odds_x12.t,
            value: value
          });
        }
      }
    } else if (marketType === 'Asian Handicap' && line !== undefined) {
      // Handle both array format (historical) and single object format (latest only)
      if (Array.isArray(bookmakerData.odds_ah) && Array.isArray(bookmakerData.lines)) {
        // Historical format
        const linesArray = bookmakerData.lines as Array<{ t: number; ah: number[]; ou: number[] }>;
        bookmakerData.odds_ah?.forEach((oddsEntry, oddsIndex) => {
          // Find the lines data at this timestamp (or the latest available before this timestamp)
          let linesAtTime = null;
          for (let i = 0; i < linesArray.length; i++) {
            if (linesArray[i].t <= oddsEntry.t) {
              linesAtTime = linesArray[i];
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
      } else if (bookmakerData.odds_ah && bookmakerData.lines) {
        // Single object format - find the line index in the latest lines
        const linesObj = bookmakerData.lines as { t: number; ah: number[]; ou: number[] };
        const oddsAhObj = bookmakerData.odds_ah as { t: number; ah_h: number[]; ah_a: number[] };
        const lineIndex = linesObj.ah?.indexOf(line);

        if (lineIndex !== undefined && lineIndex >= 0) {
          let value: number | null = null;
          if (outcome === 'Home') {
            value = oddsAhObj.ah_h?.[lineIndex] || null;
          } else if (outcome === 'Away') {
            value = oddsAhObj.ah_a?.[lineIndex] || null;
          }
          if (value !== null && value > 0) {
            history.push({
              t: oddsAhObj.t,
              value: value
            });
          }
        }
      }
    } else if (marketType === 'Over/Under' && line !== undefined) {
      // Handle both array format (historical) and single object format (latest only)
      if (Array.isArray(bookmakerData.odds_ou) && Array.isArray(bookmakerData.lines)) {
        // Historical format
        const linesArray = bookmakerData.lines as Array<{ t: number; ah: number[]; ou: number[] }>;
        bookmakerData.odds_ou?.forEach((oddsEntry, oddsIndex) => {
          // Find the lines data at this timestamp (or the latest available before this timestamp)
          let linesAtTime = null;
          for (let i = 0; i < linesArray.length; i++) {
            if (linesArray[i].t <= oddsEntry.t) {
              linesAtTime = linesArray[i];
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
      } else if (bookmakerData.odds_ou && bookmakerData.lines) {
        // Single object format - find the line index in the latest lines
        const linesObj = bookmakerData.lines as { t: number; ah: number[]; ou: number[] };
        const oddsOuObj = bookmakerData.odds_ou as { t: number; ou_o: number[]; ou_u: number[] };
        const lineIndex = linesObj.ou?.indexOf(line);

        if (lineIndex !== undefined && lineIndex >= 0) {
          let value: number | null = null;
          if (outcome === 'Over') {
            value = oddsOuObj.ou_o?.[lineIndex] || null;
          } else if (outcome === 'Under') {
            value = oddsOuObj.ou_u?.[lineIndex] || null;
          }
          if (value !== null && value > 0) {
            history.push({
              t: oddsOuObj.t,
              value: value
            });
          }
        }
      }
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

    // Get the latest data from each array for regular bookmakers
    // Handle both old format (array of objects) and new format (single object)
    const latestX12 = Array.isArray(bookmaker.odds_x12)
      ? bookmaker.odds_x12?.[bookmaker.odds_x12.length - 1]
      : bookmaker.odds_x12;
    const latestAH = Array.isArray(bookmaker.odds_ah)
      ? bookmaker.odds_ah?.[bookmaker.odds_ah.length - 1]
      : bookmaker.odds_ah;
    const latestOU = Array.isArray(bookmaker.odds_ou)
      ? bookmaker.odds_ou?.[bookmaker.odds_ou.length - 1]
      : bookmaker.odds_ou;
    const latestLines = Array.isArray(bookmaker.lines)
      ? bookmaker.lines?.[bookmaker.lines.length - 1]
      : bookmaker.lines;

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
        payout: bookmaker.bookie === 'Prediction' ? {
          x12: null,
          ah: null,
          ou: null
        } : {
          x12: bookmaker.payout_x12 || null,
          ah: bookmaker.payout_ah || null,  // An array of payout values per line
          ou: bookmaker.payout_ou || null   // An array of payout values per line
        }
      };
    }

    return acc;
  }, {} as Record<string, { bookie: string; odds: any; decimals: number; isFairOdds?: boolean; payout?: { x12: number | null; ah: number[] | null; ou: number[] | null } }>);


  const bookmakers = Object.values(transformedData).sort((a, b) => {
    // Prediction always comes first
    if (a.bookie === 'Prediction') return -1;
    if (b.bookie === 'Prediction') return 1;
    // For all other bookmakers, sort alphabetically
    return a.bookie.localeCompare(b.bookie);
  });


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
  const getBookieColorClass = (bookie: string, isFairOdds?: boolean): string => {
    const bookieName = bookie.toLowerCase();
    if (bookieName === 'prediction') {
      return 'bg-gray-900'; // Dark gray for Prediction
    }
    if (bookieName.includes('veikkaus')) {
      return 'bg-blue-900'; // Dark blue for Veikkaus
    }
    if (bookieName.includes('betfair')) {
      return 'bg-yellow-800'; // Dark yellow for Betfair
    }
    if (bookieName.includes('pinnacle')) {
      return 'bg-black'; // Black for Pinnacle
    }

    return 'bg-black'; // Dark background for other bookies
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
      <div className="mb-3">
        <h4 className="text-xs font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-black">
                <th className="px-1 py-0.5 text-left text-gray-300 border border-gray-600"></th>
                {bookmakers.map(bm => (
                  <th key={bm.bookie} className="px-1 py-0.5 text-center text-gray-300 border border-gray-600 min-w-[60px]">
                    {bm.bookie === 'Prediction' ? 'Prediction' : bm.bookie}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {outcomes.map((outcome, index) => (
                <tr key={index}>
                  <td className="px-1 py-0.5 text-bg-black border border-gray-600 font-medium">
                    {outcome.label}
                  </td>
                  {bookmakers.map(bm => {
                    const value = outcome.getValue(bm.odds, bm);
                    const flashClass = getFlashClass(bm.bookie, marketName, outcome.label);
                    const bgColorClass = getBookieColorClass(bm.bookie, bm.isFairOdds);
                    return (
                      <td key={bm.bookie} className={`px-1 py-0.5 text-center border border-gray-600 ${bgColorClass}`}>
                        {value ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, outcome.label, undefined, bm.decimals)}
                            className={`text-white hover:text-gray-300 px-1 py-0 rounded transition-colors cursor-pointer ${flashClass}`}
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
      let linesData = null;
      if (Array.isArray(bm.lines)) {
        linesData = bm.lines[bm.lines.length - 1];
      } else {
        linesData = bm.lines;
      }
      if (linesData?.[linesKey]) {
        linesData[linesKey].forEach((line: number) => allLines.add(line));
      }
    });

    const sortedLines = Array.from(allLines).sort((a, b) => a - b);

    // Filter out lines that have no odds from any bookmaker
    const linesWithOdds = sortedLines.filter(line =>
      bookmakers.some(bm => {
        const lineIndex = bm.odds.lines?.[linesKey]?.indexOf(line);
        return lineIndex !== undefined && lineIndex >= 0 &&
               (bm.odds[side1.oddsKey]?.[lineIndex] || bm.odds[side2.oddsKey]?.[lineIndex]);
      })
    );

    // Check if we have any data
    const hasData = linesWithOdds.length > 0;
    if (!hasData) return null;

    // Helper to get odds for a specific line and side
    const getOdds = (bm: any, line: number, oddsKey: string) => {
      let linesData = null;
      if (Array.isArray(bm.odds.lines)) {
        linesData = bm.odds.lines[bm.odds.lines.length - 1];
      } else {
        linesData = bm.odds.lines;
      }
      const lineIndex = linesData?.[linesKey]?.indexOf(line);
      if (lineIndex !== undefined && lineIndex >= 0 && bm.odds[oddsKey]?.[lineIndex]) {
        // Odds are in basis points, convert to decimal
        return (bm.odds[oddsKey][lineIndex] / getDivisor(bm.decimals)).toString();
      }
      return null;
    };

    return (
      <div className="mb-3">
        <h4 className="text-xs font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-black">
                <th className="px-1 py-0.5 text-left text-bg-black border border-gray-600">{side1.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side1.label}-${bm.bookie}`} className="px-1 py-0.5 text-center text-bg-black border border-gray-600 min-w-[60px]">
                    {bm.bookie === 'Prediction' ? 'Prediction' : bm.bookie}
                  </th>
                ))}
                <th className="px-1 py-0.5 text-left text-bg-black border border-gray-600">{side2.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side2.label}-${bm.bookie}`} className="px-1 py-0.5 text-center text-bg-black border border-gray-600 min-w-[60px]">
                    {bm.bookie === 'Prediction' ? 'Prediction' : bm.bookie}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linesWithOdds.map((line, index) => (
                <tr key={line}>
                  <td className="px-1 py-0.5 text-bg-black border border-gray-600 font-medium">
                    {side1.lineFormatter(line)}
                  </td>
                  {bookmakers.map(bm => {
                    const odds = getOdds(bm, line, side1.oddsKey);
                    const flashClass = getFlashClass(bm.bookie, marketName, side1.label, line);
                    const bgColorClass = getBookieColorClass(bm.bookie, bm.isFairOdds);
                    return (
                      <td key={`${side1.label}-${bm.bookie}`} className={`px-1 py-0.5 text-center border border-gray-600 ${bgColorClass}`}>
                        {odds ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side1.label, line, bm.decimals)}
                            className={`text-white hover:text-gray-300 px-1 py-0 rounded transition-colors cursor-pointer ${flashClass}`}
                          >
                            {odds}
                          </button>
                        ) : (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side1.label, line, bm.decimals)}
                            className={`text-gray-500 hover:text-gray-700 px-1 py-0 rounded transition-colors cursor-pointer`}
                          >
                            -
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 py-0.5 text-gray-300 border border-gray-600 font-medium">
                    {side2.lineFormatter(line)}
                  </td>
                  {bookmakers.map(bm => {
                    const odds = getOdds(bm, line, side2.oddsKey);
                    const flashClass = getFlashClass(bm.bookie, marketName, side2.label, line);
                    const bgColorClass = getBookieColorClass(bm.bookie, bm.isFairOdds);
                    return (
                      <td key={`${side2.label}-${bm.bookie}`} className={`px-1 py-0.5 text-center border border-gray-600 ${bgColorClass}`}>
                        {odds ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side2.label, line, bm.decimals)}
                            className={`text-white hover:text-gray-300 px-1 py-0 rounded transition-colors cursor-pointer ${flashClass}`}
                          >
                            {odds}
                          </button>
                        ) : (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side2.label, line, bm.decimals)}
                            className={`text-gray-500 hover:text-gray-700 px-1 py-0 rounded transition-colors cursor-pointer`}
                          >
                            -
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="px-1 py-0.5">

      {/* 1X2 Market */}
      {renderSimpleTable('1X2', [
        {
          label: 'Home',
          getValue: (odds: any, bm?: any) => {
            // Odds are in basis points
            const oddsValue = odds.x12?.[0] ? (odds.x12[0] / getDivisor(bm?.decimals || 2)) : null;
            return oddsValue?.toString() || null;
          }
        },
        {
          label: 'Draw',
          getValue: (odds: any, bm?: any) => {
            // Odds are in basis points
            const oddsValue = odds.x12?.[1] ? (odds.x12[1] / getDivisor(bm?.decimals || 2)) : null;
            return oddsValue?.toString() || null;
          }
        },
        {
          label: 'Away',
          getValue: (odds: any, bm?: any) => {
            // Regular odds are in basis points
            const oddsValue = odds.x12?.[2] ? (odds.x12[2] / getDivisor(bm?.decimals || 2)) : null;
            return oddsValue?.toString() || null;
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

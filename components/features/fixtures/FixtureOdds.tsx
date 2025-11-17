import React, { useState, useEffect } from 'react';
import { OddsChart } from './OddsChart';
import { LoadingState } from '../../shared/LoadingState';
import { ErrorState } from '../../shared/ErrorState';
import { calculateWeightedAverageFairOdds, getOddsDivisor, getFairOddsValueForOutcome } from '@/lib/utils/value-calculations';
import type { BookieOdds } from '@/lib/utils/value-analysis';

/**
 * Checks if all values in an array are valid (not null and greater than 1)
 * @param values Array of numbers to validate
 * @returns true if all values are valid, false otherwise
 */
function areAllOddsValid(values: number[]): boolean {
  return values.every(value => value != null && value > 1)
}


interface FixtureOddsProps {
  fixture?: any; // Made flexible to support different fixture formats
  oddsData?: OddsData | null;
  ratios?: any[]; // For value opportunities that have ratios data
  minRatio?: number;
  fairOddsBookies?: Array<{bookie: string, required: boolean, multiplier: number}>;
  filterMethod?: 'above_all' | 'average';
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
  }>;
}

interface RatioData {
  fair_odds_bookie: string;
  odds_bookie: string;
  ratios_x12?: number[];
  ratios_ah?: {
    ratios_ah_a?: number[];
    ratios_ah_h?: number[];
  };
  ratios_ou?: {
    ratios_ou_o?: number[];
    ratios_ou_u?: number[];
  };
  ratios_lines?: {
    ah?: number[];
    ou?: number[];
  };
}


export function FixtureOdds({
  fixture,
  oddsData: propOddsData,
  ratios: propRatios,
  minRatio = 1.0,
  fairOddsBookies = [{bookie: 'Pinnacle', required: false, multiplier: 1}],
  filterMethod = 'above_all'
}: FixtureOddsProps) {
  const [oddsData, setOddsData] = useState<OddsData | null>(propOddsData || null);
  const [oddsLoading, setOddsLoading] = useState(!propOddsData);
  const [oddsError, setOddsError] = useState<string | null>(null);

  // Track which cells have flashed and their direction: 'up' (green) or 'down' (red)
  // Key format: "bookie:market:outcome[:line]"
  const [flashingCells, setFlashingCells] = useState<Record<string, 'up' | 'down'>>({});

  // Use ref to track previous odds without causing re-renders
  const previousOddsRef = React.useRef<OddsData | null>(propOddsData || null);

  // EventSource ref for streaming
  const eventSourceRef = React.useRef<EventSource | null>(null);

  // Use propRatios if provided, otherwise fall back to fixture.ratios
  const ratios = propRatios || fixture?.ratios || [];

  // Handle odds data updates from props
  useEffect(() => {
    if (propOddsData !== undefined) { // Check for undefined to allow null values
      // Compare with previous odds to detect changes for flashing
      if (previousOddsRef.current && propOddsData) {
        const changes = detectOddsChanges(previousOddsRef.current, propOddsData);
        if (Object.keys(changes).length > 0) {
          setFlashingCells(changes);
          setTimeout(() => setFlashingCells({}), 2000);
        }
      }

      // Update local state
      setOddsData(propOddsData);
      previousOddsRef.current = propOddsData;
      setOddsLoading(false);
      setOddsError(null);
    }
  }, [propOddsData]);

  // Update previous odds ref whenever oddsData changes
  useEffect(() => {
    if (oddsData) {
      previousOddsRef.current = oddsData;
    }
  }, [oddsData]);

  // Fetch odds data when fixture is provided but oddsData prop is not
  useEffect(() => {
    if (fixture && propOddsData === undefined) {
      const fixtureId = fixture.id || fixture.fixture_id;
      if (fixtureId) {
        setOddsLoading(true);
        setOddsError(null);

        fetch(`/api/odds?fixtureId=${fixtureId}&fair_odds=true`)
          .then(response => {
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
          })
          .then(data => {
            if (data.odds && data.odds.length > 0) {
              setOddsData(data);
              previousOddsRef.current = data;
            } else {
              setOddsData(null);
            }
            setOddsLoading(false);
          })
          .catch(error => {
            console.error('Failed to fetch odds:', error);
            setOddsError(error.message);
            setOddsData(null);
            setOddsLoading(false);
          });
      }
    }
  }, [fixture, propOddsData]);

  // Start streaming odds updates when fixture is provided
  useEffect(() => {
    // Always close any existing stream first
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Only start a new stream if we have a fixture and no propOddsData
    if (fixture && propOddsData === undefined) {
      const fixtureId = fixture.id || fixture.fixture_id;
      if (fixtureId) {
        // Start new stream for this fixture
        const streamUrl = `/api/odds/stream?fixtureId=${fixtureId}&fair_odds=true`;
        const eventSource = new EventSource(streamUrl);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Handle odds updates
            if (data.type === 'odds_update' && data.odds && data.odds.length > 0) {
              // Merge stream updates with existing historical data
              setOddsData(prevData => {
                if (!prevData || !prevData.odds) return data;

                const mergedData = {
                  ...data,
                  odds: data.odds.map((newBookie: any) => {
                    const existingBookie = prevData.odds.find(b => b.bookie === newBookie.bookie);
                    if (!existingBookie) return newBookie;

                    // Helper function to merge and deduplicate arrays by timestamp
                    const mergeArraysByTimestamp = (existing: any[] | any, incoming: any[] | any) => {
                      const existingArray = Array.isArray(existing) ? existing : (existing ? [existing] : []);
                      const incomingArray = Array.isArray(incoming) ? incoming : (incoming ? [incoming] : []);
                      if (existingArray.length === 0 && incomingArray.length === 0) return incoming || existing || [];

                      const combined = [...existingArray, ...incomingArray];
                      // Deduplicate by timestamp, keeping the latest for each timestamp
                      const seen = new Set();
                      return combined.filter(item => {
                        if (seen.has(item.t)) return false;
                        seen.add(item.t);
                        return true;
                      }).sort((a, b) => a.t - b.t);
                    };

                    // Merge historical arrays
                    const mergedBookie = {
                      ...newBookie,
                      odds_x12: mergeArraysByTimestamp(existingBookie.odds_x12, newBookie.odds_x12),
                      odds_ah: mergeArraysByTimestamp(existingBookie.odds_ah, newBookie.odds_ah),
                      odds_ou: mergeArraysByTimestamp(existingBookie.odds_ou, newBookie.odds_ou),
                      lines: mergeArraysByTimestamp(existingBookie.lines, newBookie.lines),
                      ids: mergeArraysByTimestamp(existingBookie.ids, newBookie.ids),
                      max_stakes: mergeArraysByTimestamp(existingBookie.max_stakes, newBookie.max_stakes)
                    };

                    return mergedBookie;
                  })
                };

                // Compare with current odds for flashing
                if (prevData) {
                  const changes = detectOddsChanges(prevData, mergedData);
                  if (Object.keys(changes).length > 0) {
                    setFlashingCells(changes);
                    setTimeout(() => setFlashingCells({}), 2000);
                  }
                }

                return mergedData;
              });

              setOddsLoading(false);
              setOddsError(null);
            }
          } catch (error) {
            console.error('Error parsing streaming odds data:', error);
          }
        };

        eventSource.onerror = (error) => {
          console.error('EventSource error:', error);
          setOddsError('Streaming connection failed');
        };
      }
    }

    // Always return a cleanup function that closes any existing stream
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [fixture, propOddsData]);

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
      if (oldX12 && newX12 && oldX12.x12 && newX12.x12) {
        ['Home', 'Draw', 'Away'].forEach((outcome, idx) => {
          if (oldX12.x12[idx] !== undefined && newX12.x12[idx] !== undefined &&
              oldX12.x12[idx] !== newX12.x12[idx]) {
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
      
      if (oldAH && newAH && oldLines && newLines && oldLines.ah && newLines.ah &&
          oldAH.ah_h && oldAH.ah_a && newAH.ah_h && newAH.ah_a) {
        newLines.ah.forEach((line, newLineIdx) => {
          // Find the same line in old lines by value, not by index
          const oldLineIdx = oldLines.ah.indexOf(line);

          if (oldLineIdx !== undefined && oldLineIdx >= 0 &&
              oldAH.ah_h[oldLineIdx] !== undefined && newAH.ah_h[newLineIdx] !== undefined &&
              oldAH.ah_h[oldLineIdx] !== newAH.ah_h[newLineIdx]) {
            const key = `${newBookie.bookie}:Asian Handicap:Home:${line}`;
            changes[key] = newAH.ah_h[newLineIdx] > oldAH.ah_h[oldLineIdx] ? 'up' : 'down';
          }
          if (oldLineIdx !== undefined && oldLineIdx >= 0 &&
              oldAH.ah_a[oldLineIdx] !== undefined && newAH.ah_a[newLineIdx] !== undefined &&
              oldAH.ah_a[oldLineIdx] !== newAH.ah_a[newLineIdx]) {
            const key = `${newBookie.bookie}:Asian Handicap:Away:${line}`;
            changes[key] = newAH.ah_a[newLineIdx] > oldAH.ah_a[oldLineIdx] ? 'up' : 'down';
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
      
      if (oldOU && newOU && oldLines && newLines && oldLines.ou && newLines.ou &&
          oldOU.ou_o && oldOU.ou_u && newOU.ou_o && newOU.ou_u) {
        newLines.ou.forEach((line, newLineIdx) => {
          // Find the same line in old lines by value, not by index
          const oldLineIdx = oldLines.ou.indexOf(line);

          if (oldLineIdx !== undefined && oldLineIdx >= 0 &&
              oldOU.ou_o[oldLineIdx] !== undefined && newOU.ou_o[newLineIdx] !== undefined &&
              oldOU.ou_o[oldLineIdx] !== newOU.ou_o[newLineIdx]) {
            const key = `${newBookie.bookie}:Over/Under:Over:${line}`;
            changes[key] = newOU.ou_o[newLineIdx] > oldOU.ou_o[oldLineIdx] ? 'up' : 'down';
          }
          if (oldLineIdx !== undefined && oldLineIdx >= 0 &&
              oldOU.ou_u[oldLineIdx] !== undefined && newOU.ou_u[newLineIdx] !== undefined &&
              oldOU.ou_u[oldLineIdx] !== newOU.ou_u[newLineIdx]) {
            const key = `${newBookie.bookie}:Over/Under:Under:${line}`;
            changes[key] = newOU.ou_u[newLineIdx] > oldOU.ou_u[oldLineIdx] ? 'up' : 'down';
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
        bookmakerData.odds_ah?.forEach((oddsEntry, _oddsIndex) => {
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
        bookmakerData.odds_ou?.forEach((oddsEntry, _oddsIndex) => {
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
    return <LoadingState message="Loading odds..." size="sm" className="px-2 py-4" />;
  }

  if (oddsError) {
    return <ErrorState message={`odds: ${oddsError}`} className="px-2 py-4" />;
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
        isFairOdds: false
      };
    }

    return acc;
  }, {} as Record<string, { bookie: string; odds: any; decimals: number; isFairOdds?: boolean }>);


  const bookmakers = Object.values(transformedData).sort((a, b) => {
    // Prediction always comes first
    if (a.bookie === 'Prediction') return -1;
    if (b.bookie === 'Prediction') return 1;
    // For all other bookmakers, sort alphabetically
    return a.bookie.localeCompare(b.bookie);
  });


  // Helper function to get divisor based on decimals

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
  const getBookieColorClass = (bookie: string, _isFairOdds?: boolean): string => {
    const bookieName = bookie.toLowerCase();
    if (bookieName === 'prediction') {
      return 'bg-gray-900'; // Dark gray for Prediction
    }
    if (bookieName.includes('veikkaus')) {
      return 'bg-blue-900'; // Dark blue for Veikkaus
    }
    if (bookieName.includes('betfair')) {
      return 'bg-yellow-600'; // Yellow for Betfair
    }
    if (bookieName.includes('monaco')) {
      return 'bg-orange-600'; // Orange for Monaco
    }
    if (bookieName.includes('pinnacle')) {
      return 'bg-black'; // Black for Pinnacle
    }

    return 'bg-black'; // Dark background for other bookies
  };

  // Helper to get text color class for ratio based on value and filter
  const getRatioTextColorClass = (ratio: number): string => {
    // Use small epsilon for floating point comparison
    const epsilon = 0.0001;

    if (ratio >= (minRatio - epsilon)) {
      return 'text-green-400'; // Green if above or equal to filter
    } else if (ratio >= (1.0 - epsilon)) {
      return 'text-yellow-400'; // Yellow if above or equal to 1.0 but below filter
    } else {
      return 'text-red-400'; // Red if below filter and below 1.0
    }
  };


  // Generic helper function for simple markets (1X2)
  const renderSimpleTable = (marketName: string, outcomes: { label: string; getValue: (odds: any, bm?: any) => string | null }[]) => {
    const hasData = bookmakers.some(bm => outcomes.some(outcome => outcome.getValue(bm.odds, bm) !== null));
    if (!hasData) return null;

    // Get ratio for X12 outcomes using Top odds / Fair odds
    const getTopRatio = (outcomeIndex: number) => {
      if (!fixture?.fair_odds) return null;

      // Find the bookie with the top odds for this outcome
      const topOddsData = getTopOdds(outcomeIndex);
      if (!topOddsData) return null;

      // Calculate fair odds for each selected fair odds bookie
      const availableFairOdds: Array<{fairBookie: string, fairOdds: number}> = [];

      fixture.fair_odds.forEach((fairOddsData: BookieOdds) => {
        // Only consider selected fair odds bookies
        const isSelectedFairBookie = fairOddsBookies.some(config => config.bookie === fairOddsData.bookie);
        if (!isSelectedFairBookie) return;

        // Validate fair odds data
        if (fairOddsData.fair_odds_x12 && areAllOddsValid(fairOddsData.fair_odds_x12.x12) &&
            (!fairOddsData.odds_x12 || fairOddsData.fair_odds_x12.t === fairOddsData.odds_x12[0].t) &&
            (!fairOddsData.odds_x12 || areAllOddsValid(fairOddsData.odds_x12[0].x12))) {

          // Get the fair odds for this outcome
          if (fairOddsData.fair_odds_x12.x12[outcomeIndex] > 0) {
            const fairOddsDecimal = fairOddsData.fair_odds_x12.x12[outcomeIndex] / Math.pow(10, fairOddsData.decimals);

            availableFairOdds.push({
              fairBookie: fairOddsData.bookie,
              fairOdds: fairOddsDecimal
            });
          }
        }
      });

      if (availableFairOdds.length === 0) return null;

      // Check required bookies criterion
      const requiredFairBookies = fairOddsBookies.filter(config => config.required).map(config => config.bookie);
      if (requiredFairBookies.length > 0) {
        const hasRequiredBookie = requiredFairBookies.some(requiredBookie =>
          availableFairOdds.some(f => f.fairBookie === requiredBookie)
        );
        if (!hasRequiredBookie) return null;
      }

      // Apply filter method - calculate average fair odds first, then divide by top odds
      let avgFairOdds = 0;

      if (filterMethod === 'average') {
        avgFairOdds = calculateWeightedAverageFairOdds(availableFairOdds, fairOddsBookies);
      } else if (filterMethod === 'above_all') {
        // For above_all, use the highest fair odds (most conservative)
        avgFairOdds = Math.max(...availableFairOdds.map(f => f.fairOdds));
      } else {
        // Individual - use the lowest fair odds (least conservative)
        avgFairOdds = Math.min(...availableFairOdds.map(f => f.fairOdds));
      }

      const topOddsDecimal = topOddsData.odds;
      const displayRatio = avgFairOdds > 0 ? topOddsDecimal / avgFairOdds : 0;

      return displayRatio > 0 ? { ratio: displayRatio, bookie: '' } : null;
    };

    // Get top odds
    const getTopOdds = (outcomeIndex: number) => {
      let topOdds = 0;
      let topBookie = '';
      for (const bm of bookmakers) {
        if (bm.bookie === 'Prediction') continue; // Exclude Prediction bookie
        const value = outcomes[outcomeIndex].getValue(bm.odds, bm);
        if (value && parseFloat(value) > topOdds) {
          topOdds = parseFloat(value);
          topBookie = bm.bookie;
        }
      }
      return topOdds > 0 ? { odds: topOdds, bookie: topBookie } : null;
    };

    return (
      <div className="mb-3">
        <h4 className="text-xs font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="bg-black">
                <th className="px-1 py-0.5 text-left text-gray-300 border border-gray-600"></th>
                {bookmakers.map(bm => (
                  <th key={bm.bookie} className="px-1 py-0.5 text-center text-gray-300 border border-gray-600 min-w-[60px]">
                    {bm.bookie === 'Prediction' ? 'Prediction' : bm.bookie}
                  </th>
                ))}
                <th className="px-1 py-0.5 text-center text-white border border-gray-600 min-w-[60px] font-bold">
                  Top
                </th>
                {ratios && ratios.length > 0 && (
                  <th className="px-1 py-0.5 text-center text-white border border-gray-600 min-w-[60px] font-bold">
                    Ratios
                  </th>
                )}
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
                  <td className={`px-1 py-0.5 text-center border border-gray-600 ${(() => {
                    const topOddsData = getTopOdds(index);
                    return topOddsData ? getBookieColorClass(topOddsData.bookie) : 'bg-black';
                  })()}`}>
                    {(() => {
                      const topOddsData = getTopOdds(index);
                      if (!topOddsData) return <span className="text-gray-500">-</span>;

                      return (
                        <span className="font-mono text-xs px-1 text-white">
                          {topOddsData.odds.toFixed(3)}
                        </span>
                      );
                    })()}
                  </td>
                  {ratios && ratios.length > 0 && (
                    <td className={`px-1 py-0.5 text-center border border-gray-600 ${(() => {
                      const topRatioData = getTopRatio(index);
                      if (!topRatioData) return 'bg-black';

                      const ratioColorClass = getRatioTextColorClass(topRatioData.ratio);
                      // Convert text color classes to background color classes
                      if (ratioColorClass === 'text-green-400') return 'bg-green-600';
                      if (ratioColorClass === 'text-yellow-400') return 'bg-yellow-700';
                      if (ratioColorClass === 'text-red-400') return 'bg-red-600';
                      return 'bg-black';
                    })()}`}>
                      {(() => {
                        const topRatioData = getTopRatio(index);
                        if (!topRatioData) return <span className="text-gray-500">-</span>;

                        return (
                          <span className="font-mono text-xs px-1 rounded text-white">
                            {topRatioData.ratio.toFixed(3)}
                          </span>
                        );
                      })()}
                    </td>
                  )}
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

    // Also include lines from ratios data
    if (ratios) {
      ratios.forEach((ratioData: RatioData) => {
        if (ratioData.ratios_lines?.[linesKey]) {
          ratioData.ratios_lines[linesKey].forEach((line: number) => allLines.add(line));
        }
      });
    }

    const sortedLines = Array.from(allLines).sort((a, b) => a - b);

    // Filter out lines that have no odds available (odds must be > 0) from any bookmaker
    const linesWithData = sortedLines.filter(line =>
      bookmakers.some(bm => {
        const lineIndex = bm.odds.lines?.[linesKey]?.indexOf(line);
        return lineIndex !== undefined && lineIndex >= 0 &&
               ((bm.odds[side1.oddsKey]?.[lineIndex] && bm.odds[side1.oddsKey][lineIndex] > 0) ||
                (bm.odds[side2.oddsKey]?.[lineIndex] && bm.odds[side2.oddsKey][lineIndex] > 0));
      })
    );

    // Check if we have any data
    const hasData = linesWithData.length > 0;
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
        return (bm.odds[oddsKey][lineIndex] / getOddsDivisor(bm.decimals)).toString();
      }
      return null;
    };

    // Helper to get the ratio for a specific line and side using Top odds / Fair odds
    const getTopRatio = (line: number, sideKey: 'ratios_ah_a' | 'ratios_ah_h' | 'ratios_ou_o' | 'ratios_ou_u') => {
      if (!fixture?.fair_odds) return null;

      // Find the bookie with the top odds for this line and side
      const oddsKey = linesKey === 'ah'
        ? (sideKey === 'ratios_ah_h' ? 'ah_h' : 'ah_a')
        : (sideKey === 'ratios_ou_o' ? 'ou_o' : 'ou_u');
      const topOddsData = getTopOdds(line, oddsKey);
      if (!topOddsData) return null;

      // Calculate fair odds for each selected fair odds bookie
      const availableFairOdds: Array<{fairBookie: string, fairOdds: number}> = [];

      fixture.fair_odds.forEach((fairOddsData: BookieOdds) => {
        // Only consider selected fair odds bookies
        const isSelectedFairBookie = fairOddsBookies.some(config => config.bookie === fairOddsData.bookie);
        if (!isSelectedFairBookie) return;

        // Validate fair odds data for AH/OU markets
        let isValidFairOdds = false;
        if (linesKey === 'ah' && fairOddsData.fair_odds_ah) {
          isValidFairOdds = fairOddsData.fair_odds_ah.fair_ah_a && fairOddsData.fair_odds_ah.fair_ah_h &&
                           (!fairOddsData.odds_ah || fairOddsData.fair_odds_ah.t === fairOddsData.odds_ah[0].t);
        } else if (linesKey === 'ou' && fairOddsData.fair_odds_ou) {
          isValidFairOdds = fairOddsData.fair_odds_ou.fair_ou_o && fairOddsData.fair_odds_ou.fair_ou_u &&
                           (!fairOddsData.odds_ou || fairOddsData.fair_odds_ou.t === fairOddsData.odds_ou[0].t);
        }

        if (!isValidFairOdds) return;

        // Get the fair odds for this line and side
        const fairLinesObj = fairOddsData.fair_odds_lines?.[0];
        const fairOddsLines = fairLinesObj?.[linesKey] || [];
        const lineIndex = fairOddsLines.findIndex((l: number) => Math.abs(l - line) < 0.0001);

        if (lineIndex >= 0) {
          const fairOddsValue = getFairOddsValueForOutcome(fairOddsData, linesKey, sideKey === 'ratios_ah_a' || sideKey === 'ratios_ou_o' ? 0 : 1, line, fairLinesObj);

          if (fairOddsValue > 1) {
            availableFairOdds.push({
              fairBookie: fairOddsData.bookie,
              fairOdds: fairOddsValue
            });
          }
        }
      });

      if (availableFairOdds.length === 0) return null;

      // Check required bookies criterion
      const requiredFairBookies = fairOddsBookies.filter(config => config.required).map(config => config.bookie);
      if (requiredFairBookies.length > 0) {
        const hasRequiredBookie = requiredFairBookies.some(requiredBookie =>
          availableFairOdds.some(f => f.fairBookie === requiredBookie)
        );
        if (!hasRequiredBookie) return null;
      }

      // Apply filter method - calculate average fair odds first, then divide by top odds
      let avgFairOdds = 0;

      if (filterMethod === 'average') {
        avgFairOdds = calculateWeightedAverageFairOdds(availableFairOdds, fairOddsBookies);
      } else if (filterMethod === 'above_all') {
        // For above_all, use the highest fair odds (most conservative)
        avgFairOdds = Math.max(...availableFairOdds.map(f => f.fairOdds));
      } else {
        // Individual - use the lowest fair odds (least conservative)
        avgFairOdds = Math.min(...availableFairOdds.map(f => f.fairOdds));
      }

      const topOddsDecimal = topOddsData.odds;
      const displayRatio = avgFairOdds > 0 ? topOddsDecimal / avgFairOdds : 0;

      return displayRatio > 0 ? { ratio: displayRatio, bookie: '' } : null;
    };

    // Helper to get top odds for a specific line and side (excluding Prediction)
    const getTopOdds = (line: number, oddsKey: string) => {
      let topOdds = 0;
      let topBookie = '';
      for (const bm of bookmakers) {
        if (bm.bookie === 'Prediction') continue; // Exclude Prediction bookie
        const odds = getOdds(bm, line, oddsKey);
        if (odds && parseFloat(odds) > topOdds) {
          topOdds = parseFloat(odds);
          topBookie = bm.bookie;
        }
      }
      return topOdds > 0 ? { odds: topOdds, bookie: topBookie } : null;
    };

    return (
      <div className="mb-3">
        <h4 className="text-xs font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="bg-black">
                <th className="px-1 py-0.5 text-left text-bg-black border border-gray-600">{side1.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side1.label}-${bm.bookie}`} className="px-1 py-0.5 text-center text-bg-black border border-gray-600 min-w-[60px]">
                    {bm.bookie === 'Prediction' ? 'Prediction' : bm.bookie}
                  </th>
                ))}
                <th className="px-1 py-0.5 text-center text-white border border-gray-600 min-w-[60px] font-bold">
                  Top
                </th>
                {ratios && ratios.length > 0 && (
                  <th className="px-1 py-0.5 text-center text-white border border-gray-600 min-w-[80px] font-bold">
                    Ratios
                  </th>
                )}
                <th className="px-1 py-0.5 text-left text-bg-black border border-gray-600">{side2.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side2.label}-${bm.bookie}`} className="px-1 py-0.5 text-center text-bg-black border border-gray-600 min-w-[60px]">
                    {bm.bookie === 'Prediction' ? 'Prediction' : bm.bookie}
                  </th>
                ))}
                <th className="px-1 py-0.5 text-center text-white border border-gray-600 min-w-[60px] font-bold">
                  Top
                </th>
                {ratios && ratios.length > 0 && (
                  <th className="px-1 py-0.5 text-center text-white border border-gray-600 min-w-[80px] font-bold">
                    Ratios
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {linesWithData.map((line, _index) => {
                const side1TopRatio = getTopRatio(line, linesKey === 'ah' ? 'ratios_ah_h' : 'ratios_ou_o');
                const side2TopRatio = getTopRatio(line, linesKey === 'ah' ? 'ratios_ah_a' : 'ratios_ou_u');

                return (
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
                    <td className={`px-1 py-0.5 text-center border border-gray-600 ${(() => {
                      const topOddsData = getTopOdds(line, side1.oddsKey);
                      return topOddsData ? getBookieColorClass(topOddsData.bookie) : 'bg-black';
                    })()}`}>
                      {(() => {
                        const topOddsData = getTopOdds(line, side1.oddsKey);
                        if (!topOddsData) return <span className="text-gray-500">-</span>;

                        return (
                          <span className="font-mono text-xs px-1 text-white">
                            {topOddsData.odds.toFixed(3)}
                          </span>
                        );
                      })()}
                    </td>
                    {ratios && ratios.length > 0 && (
                      <td className={`px-1 py-0.5 text-center border border-gray-600 ${(() => {
                        if (!side1TopRatio) return 'bg-black';

                        const ratioColorClass = getRatioTextColorClass(side1TopRatio.ratio);
                        // Convert text color classes to background color classes
                        if (ratioColorClass === 'text-green-400') return 'bg-green-600';
                        if (ratioColorClass === 'text-yellow-400') return 'bg-yellow-700';
                        if (ratioColorClass === 'text-red-400') return 'bg-red-600';
                        return 'bg-black';
                      })()}`}>
                        {(() => {
                          if (!side1TopRatio) return <span className="text-gray-500">-</span>;

                          return (
                            <span className="font-mono text-xs px-1 rounded text-white">
                              {side1TopRatio.ratio.toFixed(3)}
                            </span>
                          );
                        })()}
                      </td>
                    )}
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
                    <td className={`px-1 py-0.5 text-center border border-gray-600 ${(() => {
                      const topOddsData = getTopOdds(line, side2.oddsKey);
                      return topOddsData ? getBookieColorClass(topOddsData.bookie) : 'bg-black';
                    })()}`}>
                      {(() => {
                        const topOddsData = getTopOdds(line, side2.oddsKey);
                        if (!topOddsData) return <span className="text-gray-500">-</span>;

                        return (
                          <span className="font-mono text-xs px-1 text-white">
                            {topOddsData.odds.toFixed(3)}
                          </span>
                        );
                      })()}
                    </td>
                    {ratios && ratios.length > 0 && (
                      <td className={`px-1 py-0.5 text-center border border-gray-600 ${(() => {
                        if (!side2TopRatio) return 'bg-black';

                        const ratioColorClass = getRatioTextColorClass(side2TopRatio.ratio);
                        // Convert text color classes to background color classes
                        if (ratioColorClass === 'text-green-400') return 'bg-green-600';
                        if (ratioColorClass === 'text-yellow-400') return 'bg-yellow-700';
                        if (ratioColorClass === 'text-red-400') return 'bg-red-600';
                        return 'bg-black';
                      })()}`}>
                        {(() => {
                          if (!side2TopRatio) return <span className="text-gray-500">-</span>;

                          return (
                            <span className="font-mono text-xs px-1 rounded text-white">
                              {side2TopRatio.ratio.toFixed(3)}
                            </span>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                );
              })}
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
            const oddsValue = odds.x12?.[0] ? (odds.x12[0] / getOddsDivisor(bm?.decimals || 2)) : null;
            return oddsValue?.toString() || null;
          }
        },
        {
          label: 'Draw',
          getValue: (odds: any, bm?: any) => {
            // Odds are in basis points
            const oddsValue = odds.x12?.[1] ? (odds.x12[1] / getOddsDivisor(bm?.decimals || 2)) : null;
            return oddsValue?.toString() || null;
          }
        },
        {
          label: 'Away',
          getValue: (odds: any, bm?: any) => {
            // Regular odds are in basis points
            const oddsValue = odds.x12?.[2] ? (odds.x12[2] / getOddsDivisor(bm?.decimals || 2)) : null;
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

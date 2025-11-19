import React, { useState, useEffect } from 'react';
import { OddsChart } from '../../shared/OddsChart';
import { LoadingState } from '../../shared/LoadingState';
import { ErrorState } from '../../shared/ErrorState';
import { getOddsDivisor } from '@/lib/utils/value-calculations';

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
  fairOddsBookies?: Array<{ bookie: string, required: boolean, multiplier: number }>;
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



export function FixtureOdds({
  fixture,
  oddsData: propOddsData,
  fairOddsBookies = [{ bookie: 'Pinnacle', required: false, multiplier: 1 }],
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


  // Handle odds data updates from props
  useEffect(() => {
    if (propOddsData !== undefined) { // Check for undefined to allow null values
      // Compare with previous odds to detect changes for flashing
      if (previousOddsRef.current && propOddsData) {
        const changes = detectOddsChanges(previousOddsRef.current, propOddsData);
        if (Object.keys(changes).length > 0) {
          setFlashingCells(changes);
          setTimeout(() => setFlashingCells({}), 2500);
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
                    setTimeout(() => setFlashingCells({}), 2500);
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
            const key = `${newBookie.bookie}:Odds 1X2:${outcome}`;
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
    if (marketType === 'Odds 1X2') {
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
    // For future fixtures, find the odds entry that matches the latest timestamp
    const latestX12 = Array.isArray(bookmaker.odds_x12)
      ? bookmaker.odds_x12?.find(entry => entry.t === bookmaker.latest_t?.x12_ts) || bookmaker.odds_x12?.[bookmaker.odds_x12.length - 1]
      : bookmaker.odds_x12;
    const latestAH = Array.isArray(bookmaker.odds_ah)
      ? bookmaker.odds_ah?.find(entry => entry.t === bookmaker.latest_t?.ah_ts) || bookmaker.odds_ah?.[bookmaker.odds_ah.length - 1]
      : bookmaker.odds_ah;
    const latestOU = Array.isArray(bookmaker.odds_ou)
      ? bookmaker.odds_ou?.find(entry => entry.t === bookmaker.latest_t?.ou_ts) || bookmaker.odds_ou?.[bookmaker.odds_ou.length - 1]
      : bookmaker.odds_ou;

    // Find lines entry that matches the latest odds timestamps
    // For OU and AH, we need to find lines that correspond to when those odds were last updated
    let latestLines = null;
    if (Array.isArray(bookmaker.lines)) {
      // If OU odds exist, find the lines entry with OU lines at or before the OU odds timestamp
      if (latestOU?.t) {
        // First try exact match
        let ouLinesEntry = bookmaker.lines.find(entry => entry.t === latestOU.t);
        // If no exact match or empty OU array, find the most recent lines entry with OU lines before/at this timestamp
        if (!ouLinesEntry || !ouLinesEntry.ou || ouLinesEntry.ou.length === 0) {
          ouLinesEntry = bookmaker.lines
            .filter(entry => entry.t <= latestOU.t && entry.ou && entry.ou.length > 0)
            .sort((a, b) => b.t - a.t)[0];
        }
        if (ouLinesEntry && ouLinesEntry.ou && ouLinesEntry.ou.length > 0) {
          latestLines = ouLinesEntry;
        }
      }
      // If no OU match, try AH odds timestamp
      if (!latestLines && latestAH?.t) {
        let ahLinesEntry = bookmaker.lines.find(entry => entry.t === latestAH.t);
        if (!ahLinesEntry || !ahLinesEntry.ah || ahLinesEntry.ah.length === 0) {
          ahLinesEntry = bookmaker.lines
            .filter(entry => entry.t <= latestAH.t && entry.ah && entry.ah.length > 0)
            .sort((a, b) => b.t - a.t)[0];
        }
        if (ahLinesEntry) {
          latestLines = ahLinesEntry;
        }
      }
      // Fallback to latest_t.lines_ts or last entry
      if (!latestLines) {
        latestLines = bookmaker.lines?.find(entry => entry.t === bookmaker.latest_t?.lines_ts) || bookmaker.lines?.[bookmaker.lines.length - 1];
      }
    } else {
      latestLines = bookmaker.lines;
    }

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

  const ArrowUp = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 4l-8 8h16l-8-8z" />
    </svg>
  );

  const ArrowDown = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 20l8-8H4l8 8z" />
    </svg>
  );

  const ArrowAdded = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );

  const ArrowRemoved = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19 13H5v-2h14v2z" />
    </svg>
  );

  // Helper function to get odds movement from history
  const getOddsMovement = (bookie: string, market: string, outcome: string, line?: number): 'up' | 'down' | 'added' | 'removed' | null => {
    const bookmakerData = oddsData?.odds.find(bm => bm.bookie === bookie);
    if (!bookmakerData) return null;

    const nowSeconds = Date.now() / 1000;
    const TIME_WINDOW = 300; // 300 seconds

    // Helper to check change in history
    const checkHistoryForChange = (history: Array<{ t: number; value: number | null }>) => {
      if (history.length < 2) return null;

      const latest = history[history.length - 1];

      // Check if the latest update is within the time window
      if (nowSeconds - latest.t > TIME_WINDOW) return null;

      // Find the last value that was different
      for (let i = history.length - 2; i >= 0; i--) {
        const prev = history[i];
        const latestVal = latest.value;
        const prevVal = prev.value;

        // Check if values are different
        // We consider them different if one is null and other is not, or if both are numbers and differ by > 0.001
        const isLatestValid = latestVal !== null && latestVal > 0;
        const isPrevValid = prevVal !== null && prevVal > 0;

        if (isLatestValid !== isPrevValid) {
          if (isLatestValid) return 'added';
          return 'removed';
        }

        if (isLatestValid && isPrevValid && latestVal && prevVal && Math.abs(latestVal - prevVal) > 0.001) {
          return latestVal > prevVal ? 'up' : 'down';
        }
      }
      return null;
    };

    // Extract history based on market type (reusing logic similar to handleOddsClick but optimized)
    let history: Array<{ t: number; value: number | null }> = [];

    if (market === 'Odds 1X2') {
      const index = outcome === 'Home' ? 0 : outcome === 'Draw' ? 1 : 2;
      if (Array.isArray(bookmakerData.odds_x12)) {
        bookmakerData.odds_x12.forEach(oddsEntry => {
          const value = oddsEntry.x12?.[index];
          const isValid = value !== undefined && value !== null && value > 0;
          history.push({ t: oddsEntry.t, value: isValid ? value : null });
        });
      }
    } else if ((market === 'Asian Handicap' || market === 'Over/Under') && line !== undefined) {
      const isAH = market === 'Asian Handicap';
      const oddsArr = isAH ? bookmakerData.odds_ah : bookmakerData.odds_ou;
      const linesArr = bookmakerData.lines;

      if (Array.isArray(oddsArr) && Array.isArray(linesArr)) {
        const linesArray = linesArr as Array<{ t: number; ah: number[]; ou: number[] }>;
        const oddsArray = oddsArr as Array<any>;

        oddsArray.forEach(oddsEntry => {
          // Find lines active at this timestamp
          let linesAtTime = null;
          for (let i = 0; i < linesArray.length; i++) {
            if (linesArray[i].t <= oddsEntry.t) {
              linesAtTime = linesArray[i];
            } else {
              break;
            }
          }

          const lineKey = isAH ? 'ah' : 'ou';
          const lineIndex = linesAtTime?.[lineKey]?.indexOf(line);

          if (lineIndex !== undefined && lineIndex >= 0) {
            let value = null;
            if (isAH) {
              value = outcome === 'Home' ? oddsEntry.ah_h?.[lineIndex] : oddsEntry.ah_a?.[lineIndex];
            } else {
              value = outcome === 'Over' ? oddsEntry.ou_o?.[lineIndex] : oddsEntry.ou_u?.[lineIndex];
            }

            const isValid = value !== undefined && value !== null && value > 0;
            history.push({ t: oddsEntry.t, value: isValid ? value : null });
          } else {
            history.push({ t: oddsEntry.t, value: null });
          }
        });
      }
    }

    return checkHistoryForChange(history);
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



  // Generic helper function for simple markets (1X2)
  const renderSimpleTable = (marketName: string, outcomes: { label: string; getValue: (odds: any, bm?: any) => string | null }[]) => {
    const hasData = bookmakers.some(bm => outcomes.some(outcome => outcome.getValue(bm.odds, bm) !== null));
    if (!hasData) return null;

    // Get ratio for X12 outcomes using Top odds / Fair odds

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
      <div className="mb-2">
        <h4 className="text-xs font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono border-separate border-spacing-y-0.5 border-spacing-x-0.5">
            <thead>
              <tr className="bg-transparent">
                <th className="px-1 py-0.5 text-left text-gray-400 rounded-sm font-bold uppercase tracking-wider bg-gray-900/80 backdrop-blur-sm"></th>
                {bookmakers.map(bm => (
                  <th key={bm.bookie} className="px-1 py-0.5 text-center text-gray-400 rounded-sm min-w-[40px] font-bold uppercase tracking-wider bg-gray-900/80 backdrop-blur-sm">
                    {bm.bookie === 'Prediction' ? 'Pred' : bm.bookie}
                  </th>
                ))}
                <th className="px-1 py-0.5 text-center text-white rounded-sm min-w-[40px] font-bold uppercase tracking-wider bg-blue-900/40 backdrop-blur-sm">
                  Top
                </th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((outcome, index) => (
                <tr key={index} className="group">
                  <td className="px-2 py-0.5 text-gray-300 rounded-l-md font-medium bg-gray-900/40">
                    {outcome.label}
                  </td>
                  {bookmakers.map(bm => {
                    const value = outcome.getValue(bm.odds, bm);
                    const flashClass = getFlashClass(bm.bookie, marketName, outcome.label);
                    const bgColorClass = getBookieColorClass(bm.bookie, bm.isFairOdds);
                    const movement = getOddsMovement(bm.bookie, marketName, outcome.label);
                    const isUp = movement === 'up';
                    const isDown = movement === 'down';
                    const isAdded = movement === 'added';
                    const isRemoved = movement === 'removed';

                    return (
                      <td key={bm.bookie} className={`p-0 text-center rounded-sm overflow-hidden ${bgColorClass}`}>
                        {value ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, outcome.label, undefined, bm.decimals)}
                            className={`relative text-white hover:text-gray-300 w-full h-full py-0.5 flex items-center justify-center gap-1 transition-colors cursor-pointer ${flashClass}`}
                          >
                            {value}
                            {isUp && <ArrowUp className="w-3 h-3 text-green-500" />}
                            {isDown && <ArrowDown className="w-3 h-3 text-red-500" />}
                            {isAdded && <ArrowAdded className="w-3 h-3 text-yellow-500" />}
                          </button>
                        ) : (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, outcome.label, undefined, bm.decimals)}
                            className={`text-gray-500 hover:text-gray-700 w-full h-full py-0.5 flex items-center justify-center transition-colors cursor-pointer`}
                          >
                            {isRemoved ? <ArrowRemoved className="w-3 h-3 text-blue-500" /> : '-'}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className={`p-0 text-center rounded-r-md overflow-hidden ${(() => {
                    const topOddsData = getTopOdds(index);
                    return topOddsData ? getBookieColorClass(topOddsData.bookie) : 'bg-gray-900/30';
                  })()}`}>
                    {(() => {
                      const topOddsData = getTopOdds(index);
                      if (!topOddsData) return <div className="w-full h-full py-0.5 flex items-center justify-center text-gray-500">-</div>;

                      return (
                        <div className="w-full h-full py-0.5 flex items-center justify-center font-mono text-white">
                          {topOddsData.odds.toFixed(3)}
                        </div>
                      );
                    })()}
                  </td>
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

    // Filter out lines where only one side has valid odds - require both sides to have valid odds from at least one bookmaker
    const linesWithData = sortedLines.filter(line =>
      bookmakers.some(bm => {
        const lineIndex = bm.odds.lines?.[linesKey]?.indexOf(line);
        if (lineIndex === undefined || lineIndex < 0) return false;

        const side1Odds = bm.odds[side1.oddsKey]?.[lineIndex];
        const side2Odds = bm.odds[side2.oddsKey]?.[lineIndex];

        // Both sides must have valid odds (> 0)
        return side1Odds && side1Odds > 0 && side2Odds && side2Odds > 0;
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
      <div className="mb-2">
        <h4 className="text-xs font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono border-separate border-spacing-y-0.5 border-spacing-x-0.5">
            <thead>
              <tr className="bg-transparent">
                <th className="px-1 py-0.5 text-left text-gray-400 rounded-sm font-bold uppercase tracking-wider bg-gray-900/80 backdrop-blur-sm">{side1.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side1.label}-${bm.bookie}`} className="px-1 py-0.5 text-center text-gray-400 rounded-sm min-w-[40px] font-bold uppercase tracking-wider bg-gray-900/80 backdrop-blur-sm">
                    {bm.bookie === 'Prediction' ? 'Pred' : bm.bookie}
                  </th>
                ))}
                <th className="px-1 py-0.5 text-center text-white rounded-sm min-w-[40px] font-bold uppercase tracking-wider bg-blue-900/40 backdrop-blur-sm">
                  Top
                </th>
                <th className="px-1 py-0.5 text-left text-gray-400 rounded-sm font-bold uppercase tracking-wider bg-gray-900/80 backdrop-blur-sm">{side2.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side2.label}-${bm.bookie}`} className="px-1 py-0.5 text-center text-gray-400 rounded-sm min-w-[40px] font-bold uppercase tracking-wider bg-gray-900/80 backdrop-blur-sm">
                    {bm.bookie === 'Prediction' ? 'Pred' : bm.bookie}
                  </th>
                ))}
                <th className="px-1 py-0.5 text-center text-white rounded-sm min-w-[40px] font-bold uppercase tracking-wider bg-blue-900/40 backdrop-blur-sm">
                  Top
                </th>
              </tr>
            </thead>
            <tbody>
              {linesWithData.map((line, _index) => {

                return (
                  <tr key={line} className="group">
                    <td className="px-2 py-0.5 text-gray-300 rounded-l-md font-medium bg-gray-900/40">
                      {side1.lineFormatter(line)}
                    </td>
                    {bookmakers.map(bm => {
                      const odds = getOdds(bm, line, side1.oddsKey);
                      const flashClass = getFlashClass(bm.bookie, marketName, side1.label, line);
                      const bgColorClass = getBookieColorClass(bm.bookie, bm.isFairOdds);
                      const movement = getOddsMovement(bm.bookie, marketName, side1.label, line);
                      const isUp = movement === 'up';
                      const isDown = movement === 'down';
                      const isAdded = movement === 'added';
                      const isRemoved = movement === 'removed';

                      return (
                        <td key={`${side1.label}-${bm.bookie}`} className={`p-0 text-center rounded-sm overflow-hidden ${bgColorClass}`}>
                          {odds ? (
                            <button
                              onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side1.label, line, bm.decimals)}
                              className={`relative text-white hover:text-gray-300 w-full h-full py-0.5 flex items-center justify-center gap-1 transition-colors cursor-pointer ${flashClass}`}
                            >
                              {odds}
                              {isUp && <ArrowUp className="w-3 h-3 text-green-500" />}
                              {isDown && <ArrowDown className="w-3 h-3 text-red-500" />}
                              {isAdded && <ArrowAdded className="w-3 h-3 text-yellow-500" />}
                            </button>
                          ) : (
                            <button
                              onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side1.label, line, bm.decimals)}
                              className={`text-gray-500 hover:text-gray-700 w-full h-full py-0.5 flex items-center justify-center transition-colors cursor-pointer`}
                            >
                              {isRemoved ? <ArrowRemoved className="w-3 h-3 text-blue-500" /> : '-'}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className={`p-0 text-center rounded-sm overflow-hidden ${(() => {
                      const topOddsData = getTopOdds(line, side1.oddsKey);
                      return topOddsData ? getBookieColorClass(topOddsData.bookie) : 'bg-gray-900/30';
                    })()}`}>
                      {(() => {
                        const topOddsData = getTopOdds(line, side1.oddsKey);
                        if (!topOddsData) return <div className="w-full h-full py-0.5 flex items-center justify-center text-gray-500">-</div>;

                        return (
                          <div className="w-full h-full py-0.5 flex items-center justify-center font-mono text-white">
                            {topOddsData.odds.toFixed(3)}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-0.5 text-gray-300 rounded-sm font-medium bg-gray-900/40">
                      {side2.lineFormatter(line)}
                    </td>
                    {bookmakers.map(bm => {
                      const odds = getOdds(bm, line, side2.oddsKey);
                      const flashClass = getFlashClass(bm.bookie, marketName, side2.label, line);
                      const bgColorClass = getBookieColorClass(bm.bookie, bm.isFairOdds);
                      const movement = getOddsMovement(bm.bookie, marketName, side2.label, line);
                      const isUp = movement === 'up';
                      const isDown = movement === 'down';
                      const isAdded = movement === 'added';
                      const isRemoved = movement === 'removed';

                      return (
                        <td key={`${side2.label}-${bm.bookie}`} className={`p-0 text-center rounded-sm overflow-hidden ${bgColorClass}`}>
                          {odds ? (
                            <button
                              onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side2.label, line, bm.decimals)}
                              className={`relative text-white hover:text-gray-300 w-full h-full py-0.5 flex items-center justify-center gap-1 transition-colors cursor-pointer ${flashClass}`}
                            >
                              {odds}
                              {isUp && <ArrowUp className="w-3 h-3 text-green-500" />}
                              {isDown && <ArrowDown className="w-3 h-3 text-red-500" />}
                              {isAdded && <ArrowAdded className="w-3 h-3 text-yellow-500" />}
                            </button>
                          ) : (
                            <button
                              onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side2.label, line, bm.decimals)}
                              className={`text-gray-500 hover:text-gray-700 w-full h-full py-0.5 flex items-center justify-center transition-colors cursor-pointer`}
                            >
                              {isRemoved ? <ArrowRemoved className="w-3 h-3 text-blue-500" /> : '-'}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className={`p-0 text-center rounded-r-md overflow-hidden ${(() => {
                      const topOddsData = getTopOdds(line, side2.oddsKey);
                      return topOddsData ? getBookieColorClass(topOddsData.bookie) : 'bg-gray-900/30';
                    })()}`}>
                      {(() => {
                        const topOddsData = getTopOdds(line, side2.oddsKey);
                        if (!topOddsData) return <div className="w-full h-full py-0.5 flex items-center justify-center text-gray-500">-</div>;

                        return (
                          <div className="w-full h-full py-0.5 flex items-center justify-center font-mono text-white">
                            {topOddsData.odds.toFixed(3)}
                          </div>
                        );
                      })()}
                    </td>
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
      <div className="mt-1">
        {renderSimpleTable('Odds 1X2', [
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
      </div>

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

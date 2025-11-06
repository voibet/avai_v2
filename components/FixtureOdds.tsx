import React, { useState, useEffect } from 'react';
import { OddsChart } from './OddsChart';
import { BookieOdds } from '@/lib/utils/value-analysis';


interface FixtureOddsProps {
  fixture?: any; // Made flexible to support different fixture formats
  oddsData?: OddsData | null;
  minRatio?: number;
  fairOddsBookies?: Array<{bookie: string, required: boolean, multiplier: number}>;
  filterMethod?: 'individual' | 'above_all' | 'average';
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
  minRatio = 1.0,
  fairOddsBookies = [{bookie: 'Pinnacle', required: false, multiplier: 1}],
  filterMethod = 'individual'
}: FixtureOddsProps) {
  const [oddsData, setOddsData] = useState<OddsData | null>(propOddsData || null);
  const [oddsLoading, setOddsLoading] = useState(!propOddsData);
  const [oddsError, setOddsError] = useState<string | null>(null);

  // Helper: Calculate weighted average ratio based on multipliers (same as values page)
  const calculateWeightedAverage = (availableRatios: Array<{fairBookie: string, ratio: number}>): number => {
    let totalWeightedSum = 0;
    let totalWeight = 0;

    availableRatios.forEach(({fairBookie, ratio}) => {
      const bookieConfig = fairOddsBookies.find(config => config.bookie === fairBookie);
      const multiplier = bookieConfig?.multiplier || 1;
      totalWeightedSum += ratio * multiplier;
      totalWeight += multiplier;
    });

    return totalWeight > 0 ? totalWeightedSum / totalWeight : 0;
  };

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

  // Fetch odds data when fixture is provided but oddsData prop is not
  useEffect(() => {
    if (fixture && propOddsData === undefined) {
      const fixtureId = fixture.id || fixture.fixture_id;
      if (fixtureId) {
        setOddsLoading(true);
        setOddsError(null);

        fetch(`/api/odds?fixtureId=${fixtureId}e&fair_odds=true`)
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
    if (fixture && propOddsData === undefined) {
      const fixtureId = fixture.id || fixture.fixture_id;
      if (fixtureId) {
        // Close any existing stream
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }

        // Start new stream for this fixture
        const streamUrl = `/api/odds/stream?fixtureId=${fixtureId}&fair_odds=true`;
        const eventSource = new EventSource(streamUrl);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Handle odds updates
            if (data.type === 'odds_update' && data.odds && data.odds.length > 0) {
              // Compare with current odds for flashing
              if (oddsData) {
                const changes = detectOddsChanges(oddsData, data);
                if (Object.keys(changes).length > 0) {
                  setFlashingCells(changes);
                  setTimeout(() => setFlashingCells({}), 2000);
                }
              }

              // Update odds data
              setOddsData(data);
              previousOddsRef.current = data;
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

        return () => {
          eventSource.close();
          eventSourceRef.current = null;
        };
      }
    }

    // Cleanup when fixture changes or component unmounts
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [fixture, propOddsData, oddsData]);

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
      return 'bg-yellow-600'; // Yellow for Betfair
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

    // Get ratio for X12 outcomes - using the exact same logic as Values page filtering
    const getTopRatio = (outcomeIndex: number) => {
      if (!fixture?.ratios) return null;

      // Use the same logic as values page: pick the odds bookie with the best odds for this outcome
      // Find which odds bookie has the best odds for this outcome
      let bestOddsBookie = '';
      let bestOdds = 0;

      fixture.odds.forEach((oddsData: BookieOdds) => {
        if (oddsData.odds_x12 && oddsData.odds_x12[0]?.x12?.[outcomeIndex]) {
          const odds = oddsData.odds_x12[0].x12[outcomeIndex] / Math.pow(10, oddsData.decimals);
          if (odds > bestOdds) {
            bestOdds = odds;
            bestOddsBookie = oddsData.bookie;
          }
        }
      });

      if (!bestOddsBookie) return null;

      // Now get ratios for this specific odds bookie using the same logic as values page
      const availableRatios: Array<{fairBookie: string, ratio: number}> = [];

      fixture.ratios.forEach((ratioData: RatioData) => {
        // Only consider ratios for the best odds bookie
        if (ratioData.odds_bookie !== bestOddsBookie) return;

        // Only consider selected fair odds bookies
        const isSelectedFairBookie = fairOddsBookies.some(config => config.bookie === ratioData.fair_odds_bookie);
        if (!isSelectedFairBookie) return;

        if (ratioData.ratios_x12 && ratioData.ratios_x12[outcomeIndex] > 0) {
          availableRatios.push({
            fairBookie: ratioData.fair_odds_bookie,
            ratio: ratioData.ratios_x12[outcomeIndex]
          });
        }
      });

      if (availableRatios.length === 0) return null;

      // Check required bookies criterion
      const requiredFairBookies = fairOddsBookies.filter(config => config.required).map(config => config.bookie);
      if (requiredFairBookies.length > 0) {
        const hasRequiredBookie = requiredFairBookies.some(requiredBookie =>
          availableRatios.some(r => r.fairBookie === requiredBookie)
        );
        if (!hasRequiredBookie) return null;
      }

      // Apply filter method - same as values page
      let displayRatio = 0;

      if (filterMethod === 'average') {
        displayRatio = calculateWeightedAverage(availableRatios);
      } else if (filterMethod === 'above_all') {
        displayRatio = Math.min(...availableRatios.map(r => r.ratio));
      } else {
        // Individual - show the highest
        displayRatio = Math.max(...availableRatios.map(r => r.ratio));
      }

      return displayRatio > 0 ? { ratio: displayRatio, bookie: bestOddsBookie } : null;
    };

    // Get top odds for X12 outcomes (excluding Prediction)
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
          <table className="w-full text-xs font-mono">
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
                {fixture?.ratios && fixture.ratios.length > 0 && (
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
                          {topOddsData.odds.toFixed(2)}
                        </span>
                      );
                    })()}
                  </td>
                  {fixture?.ratios && fixture.ratios.length > 0 && (
                    <td className={`px-1 py-0.5 text-center border border-gray-600 ${(() => {
                      const topRatioData = getTopRatio(index);
                      return topRatioData ? getBookieColorClass(topRatioData.bookie) : 'bg-black';
                    })()}`}>
                      {(() => {
                        const topRatioData = getTopRatio(index);
                        if (!topRatioData) return <span className="text-gray-500">-</span>;

                        const textColorClass = getRatioTextColorClass(topRatioData.ratio);
                        return (
                          <span className={`font-mono text-xs px-1 rounded ${textColorClass}`}>
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
    if (fixture?.ratios) {
      fixture.ratios.forEach((ratioData: RatioData) => {
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
        return (bm.odds[oddsKey][lineIndex] / getDivisor(bm.decimals)).toString();
      }
      return null;
    };

    // Helper to get the ratio for a specific line and side - using the exact same logic as Values page filtering
    const getTopRatio = (line: number, sideKey: 'ratios_ah_a' | 'ratios_ah_h' | 'ratios_ou_o' | 'ratios_ou_u') => {
      if (!fixture?.ratios) return null;

      // Use the same logic as values page: pick the odds bookie with the best odds for this line/side
      // Find which odds bookie has the best odds for this line and side
      let bestOddsBookie = '';
      let bestOdds = 0;

      fixture.odds.forEach((oddsData: BookieOdds) => {
        let odds = 0;
        if (linesKey === 'ah') {
          const ahData = oddsData.odds_ah?.[0];
          if (ahData) {
            const lines = oddsData.lines?.[0]?.ah || [];
            const lineIndex = lines.indexOf(line);
            if (lineIndex !== -1) {
              if (sideKey === 'ratios_ah_a' && ahData.ah_a?.[lineIndex]) {
                odds = ahData.ah_a[lineIndex] / Math.pow(10, oddsData.decimals);
              } else if (sideKey === 'ratios_ah_h' && ahData.ah_h?.[lineIndex]) {
                odds = ahData.ah_h[lineIndex] / Math.pow(10, oddsData.decimals);
              }
            }
          }
        } else if (linesKey === 'ou') {
          const ouData = oddsData.odds_ou?.[0];
          if (ouData) {
            const lines = oddsData.lines?.[0]?.ou || [];
            const lineIndex = lines.indexOf(line);
            if (lineIndex !== -1) {
              if (sideKey === 'ratios_ou_o' && ouData.ou_o?.[lineIndex]) {
                odds = ouData.ou_o[lineIndex] / Math.pow(10, oddsData.decimals);
              } else if (sideKey === 'ratios_ou_u' && ouData.ou_u?.[lineIndex]) {
                odds = ouData.ou_u[lineIndex] / Math.pow(10, oddsData.decimals);
              }
            }
          }
        }

        if (odds > bestOdds) {
          bestOdds = odds;
          bestOddsBookie = oddsData.bookie;
        }
      });

      if (!bestOddsBookie) return null;

      // Now get ratios for this specific odds bookie using the same logic as values page
      const availableRatios: Array<{fairBookie: string, ratio: number}> = [];

      fixture.ratios.forEach((ratioData: RatioData) => {
        // Only consider ratios for the best odds bookie
        if (ratioData.odds_bookie !== bestOddsBookie) return;

        // Only consider selected fair odds bookies
        const isSelectedFairBookie = fairOddsBookies.some(config => config.bookie === ratioData.fair_odds_bookie);
        if (!isSelectedFairBookie) return;

        const ratioLines = ratioData.ratios_lines?.[linesKey] || [];
        const lineIndex = ratioLines.indexOf(line);

        if (lineIndex >= 0) {
          let ratioValue = 0;
          if (linesKey === 'ah' && ratioData.ratios_ah) {
            const sideRatios = ratioData.ratios_ah[sideKey as keyof typeof ratioData.ratios_ah];
            if (Array.isArray(sideRatios) && sideRatios[lineIndex]) {
              ratioValue = sideRatios[lineIndex];
            }
          } else if (linesKey === 'ou' && ratioData.ratios_ou) {
            const sideRatios = ratioData.ratios_ou[sideKey as keyof typeof ratioData.ratios_ou];
            if (Array.isArray(sideRatios) && sideRatios[lineIndex]) {
              ratioValue = sideRatios[lineIndex];
            }
          }

          if (ratioValue > 0) {
            availableRatios.push({
              fairBookie: ratioData.fair_odds_bookie,
              ratio: ratioValue
            });
          }
        }
      });

      if (availableRatios.length === 0) return null;

      // Check required bookies criterion
      const requiredFairBookies = fairOddsBookies.filter(config => config.required).map(config => config.bookie);
      if (requiredFairBookies.length > 0) {
        const hasRequiredBookie = requiredFairBookies.some(requiredBookie =>
          availableRatios.some(r => r.fairBookie === requiredBookie)
        );
        if (!hasRequiredBookie) return null;
      }

      // Apply filter method - same as values page
      let displayRatio = 0;

      if (filterMethod === 'average') {
        displayRatio = calculateWeightedAverage(availableRatios);
      } else if (filterMethod === 'above_all') {
        displayRatio = Math.min(...availableRatios.map(r => r.ratio));
      } else {
        // Individual - show the highest
        displayRatio = Math.max(...availableRatios.map(r => r.ratio));
      }

      return displayRatio > 0 ? { ratio: displayRatio, bookie: bestOddsBookie } : null;
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
          <table className="w-full text-xs font-mono">
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
                {fixture?.ratios && fixture.ratios.length > 0 && (
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
                {fixture?.ratios && fixture.ratios.length > 0 && (
                  <th className="px-1 py-0.5 text-center text-white border border-gray-600 min-w-[80px] font-bold">
                    Ratios
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {linesWithData.map((line, index) => {
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
                            {topOddsData.odds.toFixed(2)}
                          </span>
                        );
                      })()}
                    </td>
                    {fixture?.ratios && fixture.ratios.length > 0 && (
                      <td className={`px-1 py-0.5 text-center border border-gray-600 ${(() => {
                        return side1TopRatio ? getBookieColorClass(side1TopRatio.bookie) : 'bg-black';
                      })()}`}>
                        {(() => {
                          if (!side1TopRatio) return <span className="text-gray-500">-</span>;

                          const textColorClass = getRatioTextColorClass(side1TopRatio.ratio);
                          return (
                            <span className={`font-mono text-xs px-1 rounded ${textColorClass}`}>
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
                            {topOddsData.odds.toFixed(2)}
                          </span>
                        );
                      })()}
                    </td>
                    {fixture?.ratios && fixture.ratios.length > 0 && (
                      <td className={`px-1 py-0.5 text-center border border-gray-600 ${(() => {
                        return side2TopRatio ? getBookieColorClass(side2TopRatio.bookie) : 'bg-black';
                      })()}`}>
                        {(() => {
                          if (!side2TopRatio) return <span className="text-gray-500">-</span>;

                          const textColorClass = getRatioTextColorClass(side2TopRatio.ratio);
                          return (
                            <span className={`font-mono text-xs px-1 rounded ${textColorClass}`}>
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

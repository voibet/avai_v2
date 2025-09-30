import React, { useState } from 'react';
import { useFixtureOdds } from '../lib/hooks/use-football-data';
import { OddsChart } from './OddsChart';

interface FixtureOddsProps {
  fixtureId: string | null;
}

export function FixtureOdds({ fixtureId }: FixtureOddsProps) {
  const { data: oddsData, loading: oddsLoading, error: oddsError } = useFixtureOdds(fixtureId);
  
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
      // Find the line index in the latest lines data
      const latestLines = bookmakerData.lines?.[bookmakerData.lines.length - 1];
      const lineIndex = latestLines?.ah?.indexOf(line);

      if (lineIndex !== undefined && lineIndex >= 0) {
        bookmakerData.odds_ah?.forEach(oddsEntry => {
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
        });
      }
    } else if (marketType === 'Over/Under' && line !== undefined) {
      // Find the line index in the latest lines data
      const latestLines = bookmakerData.lines?.[bookmakerData.lines.length - 1];
      const lineIndex = latestLines?.ou?.indexOf(line);

      if (lineIndex !== undefined && lineIndex >= 0) {
        bookmakerData.odds_ou?.forEach(oddsEntry => {
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
        });
      }
    }

    // Create title
    let title = `${marketType} - ${outcome}`;
    if (line !== undefined) {
      if (marketType === 'Asian Handicap') {
        const formattedLine = outcome === 'Home' ? 
          (line > 0 ? `+${line}` : `${line}`) : 
          (line < 0 ? `+${Math.abs(line)}` : `-${line}`);
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
  }, {} as Record<string, { bookie: string; odds: any; decimals: number; isFairOdds?: boolean; payout?: { x12: number | null; ah: number[] | null; ou: number[] | null } }>);

  const bookmakers = Object.values(transformedData);

  // Helper function to get divisor based on decimals
  const getDivisor = (decimals: number) => Math.pow(10, decimals);

  // Generic helper function for simple markets (1X2)
  const renderSimpleTable = (marketName: string, outcomes: { label: string; getValue: (odds: any, bm?: any) => string | null }[]) => {
    const hasData = bookmakers.some(bm => outcomes.some(outcome => outcome.getValue(bm.odds, bm) !== null));
    if (!hasData) return null;

    return (
      <div className="mb-4">
        <h4 className="text-base font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-black">
                <th className="px-2 py-1 text-left text-gray-300 border border-gray-600"></th>
                {bookmakers.map(bm => (
                  <th key={bm.bookie} className="px-2 py-1 text-center text-gray-300 border border-gray-600 min-w-[60px]">
                    {bm.isFairOdds ? 'Fair Odds' : bm.bookie}
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
                    return (
                      <td key={bm.bookie} className="px-2 py-1 text-center border border-gray-600">
                        {value ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, outcome.label, undefined, bm.decimals)}
                            className="text-white hover:text-gray-300 hover:bg-gray-700 px-1 py-0.5 rounded transition-colors cursor-pointer"
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
                    PAYOUT
                  </td>
                  {bookmakers.map(bm => {
                    const payoutValue = bm.payout?.x12;
                    return (
                      <td key={`${bm.bookie}-payout`} className="px-2 py-1 text-center border border-gray-600">
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
    const sortedLines = Array.from(allLines).sort((a, b) => a - b);

    // Filter out lines that have no odds from any bookmaker
    const linesWithOdds = sortedLines.filter(line =>
      bookmakers.some(bm => {
        if (bm.isFairOdds) {
          // For fair odds, check if the odds array exists and has data at this line index
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
        if (bm.isFairOdds) {
          // Fair odds are already in decimal format, just return as string
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
        <h4 className="text-base font-bold text-white font-mono mb-2">{marketName}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-black">
                <th className="px-2 py-1 text-left text-bg-black border border-gray-600">{side1.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side1.label}-${bm.bookie}`} className="px-2 py-1 text-center text-bg-black border border-gray-600 min-w-[60px]">
                    {bm.isFairOdds ? 'Fair Odds' : bm.bookie}
                  </th>
                ))}
                <th className="px-2 py-1 text-left text-bg-black border border-gray-600">{side2.label}</th>
                {bookmakers.map(bm => (
                  <th key={`${side2.label}-${bm.bookie}`} className="px-2 py-1 text-center text-bg-black border border-gray-600 min-w-[60px]">
                    {bm.isFairOdds ? 'Fair Odds' : bm.bookie}
                  </th>
                ))}
                <th className="px-2 py-1 text-center text-white border border-gray-600 min-w-[60px]">
                  PAYOUT
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
                    return (
                      <td key={`${side1.label}-${bm.bookie}`} className="px-2 py-1 text-center border border-gray-600">
                        {odds ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side1.label, line, bm.decimals)}
                            className="text-white hover:text-gray-300 hover:bg-gray-700 px-1 py-0.5 rounded transition-colors cursor-pointer"
                          >
                            {odds}
                          </button>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-gray-300 border border-gray-600 font-medium">
                    {side2.lineFormatter(line)}
                  </td>
                  {bookmakers.map(bm => {
                    const odds = getOdds(bm, line, side2.oddsKey);
                    return (
                      <td key={`${side2.label}-${bm.bookie}`} className="px-2 py-1 text-center border border-gray-600">
                        {odds ? (
                          <button
                            onClick={(e) => handleOddsClick(e, bm.bookie, marketName, side2.label, line, bm.decimals)}
                            className="text-white hover:text-gray-300 hover:bg-gray-700 px-1 py-0.5 rounded transition-colors cursor-pointer"
                          >
                            {odds}
                          </button>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                    );
                  })}
                  {/* Payout column on the far right */}
                  <td className="px-2 py-1 text-center border border-gray-600">
                    <span className="text-white text-xs font-mono">
                      {(() => {
                        // Find the line index (should be the same across all bookmakers for this line)
                        const sampleBookmaker = bookmakers.find(bm => bm.odds.lines?.[linesKey]?.includes(line));
                        if (!sampleBookmaker) return '-';

                        const lineIndex = sampleBookmaker.odds.lines?.[linesKey]?.indexOf(line);
                        if (lineIndex === undefined || lineIndex < 0) return '-';

                        // Get payout values from all bookmakers for this line
                        const payoutValues = bookmakers
                          .map(bm => {
                            const payoutArray = linesKey === 'ah' ? bm.payout?.ah : bm.payout?.ou;
                            return payoutArray?.[lineIndex] || null;
                          })
                          .filter((p): p is number => p !== null);

                        if (payoutValues.length === 0) return '-';

                        // Calculate average payout across all bookmakers for this line
                        const avgPayout = payoutValues.reduce((sum, p) => sum + p, 0) / payoutValues.length;
                        return (avgPayout * 100).toFixed(1) + '%';
                      })()}
                    </span>
                  </td>
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
            if (bm?.isFairOdds) {
              // Fair odds are already in decimal format
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
            if (bm?.isFairOdds) {
              // Fair odds are already in decimal format
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
            if (bm?.isFairOdds) {
              // Fair odds are already in decimal format
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
          lineFormatter: (line: number) => line < 0 ? `+${Math.abs(line)}` : `-${line}`
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

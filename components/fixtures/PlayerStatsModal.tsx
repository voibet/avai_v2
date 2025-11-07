'use client'

import { usePlayerStats } from '../../lib/hooks/use-football-data'

interface PlayerStatsModalProps {
  playerId: number | null
  playerName: string | null
  season: string | null
  teamId?: string | null
  leagueId?: string | null
  onClose: () => void
}

export default function PlayerStatsModal({
  playerId,
  playerName,
  season,
  teamId,
  leagueId,
  onClose
}: PlayerStatsModalProps) {
  const playerIdStr = playerId?.toString() || null
  const { data: playerStatsData, loading, error } = usePlayerStats(playerIdStr, season, teamId, leagueId)

  if (!playerId || !season) return null

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="bg-black border border-gray-700 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-black border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {playerStatsData?.player?.photo && (
              <img
                src={playerStatsData.player.photo}
                alt={playerName || 'Player photo'}
                className="w-10 h-10 rounded-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.style.display = 'none'
                }}
              />
            )}
            <div>
              <h2 className="text-white font-bold text-lg font-mono">{playerName}</h2>
              {playerStatsData?.player && (
                <p className="text-gray-400 text-xs font-mono">
                  {playerStatsData.player.age && `Age: ${playerStatsData.player.age} | `}
                  {playerStatsData.player.nationality} | ID: {playerStatsData.player.id}
                  {playerStatsData.statistics?.games?.number && ` | Number: ${playerStatsData.statistics.games.number}`}
                  {playerStatsData.statistics?.games?.position && ` | Position: ${playerStatsData.statistics.games.position}`}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {loading && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-400"></div>
              <p className="text-gray-400 text-sm font-mono mt-2">Loading player statistics...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-red-400 text-sm font-mono">Failed to load player statistics: {error}</p>
            </div>
          )}

          {!loading && !error && !playerStatsData && (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm font-mono">No statistics available for this player</p>
            </div>
          )}

          {!loading && !error && playerStatsData && (
            <div className="space-y-6">
              {/* Player Info */}
              <div>
                <h3 className="text-xs font-bold text-gray-200 font-mono mb-3 border-b border-gray-700 pb-2">
                  PLAYER INFORMATION
                </h3>
                <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                  {playerStatsData.player?.height && (
                    <div className="bg-black p-2 rounded border border-gray-700">
                      <div className="text-gray-400">HEIGHT</div>
                      <div className="text-white font-bold">{playerStatsData.player.height}</div>
                    </div>
                  )}
                  {playerStatsData.player?.weight && (
                    <div className="bg-black p-2 rounded border border-gray-700">
                      <div className="text-gray-400">WEIGHT</div>
                      <div className="text-white font-bold">{playerStatsData.player.weight}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Match Statistics */}
              {playerStatsData.statistics && (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-gray-600">
                          <th className="text-left text-gray-400 font-bold py-2 px-3">STATISTIC</th>
                          <th className="text-right text-gray-400 font-bold py-2 px-3">TOTAL</th>
                          <th className="text-right text-gray-400 font-bold py-2 px-3">PER/90</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {(() => {
                          const statsRows: Array<{name: string; value: string | number; per90: string; colorClass: string}> = [];

                          // Get minutes played for per-90 calculations
                          const getMinutes = (stats: any): number => {
                            return stats.games?.minutes || 0;
                          };

                          const minutes = getMinutes(playerStatsData.statistics);

                          // Helper function to format stat name
                          const formatStatName = (key: string, parentKey?: string) => {
                            const formatted = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                            return parentKey ? `${parentKey} ${formatted}` : formatted;
                          };

                          // Helper function to get color class (all white now)
                          const getValueColor = () => 'text-white';

                          // Recursive function to flatten nested objects
                          const flattenStats = (obj: any, parentKey?: string, depth = 0) => {
                            if (!obj || typeof obj !== 'object') return;

                            Object.entries(obj).forEach(([key, value]) => {
                              if (value === null || value === undefined) return;

                              // Skip nested objects beyond reasonable depth to avoid infinite loops
                              if (typeof value === 'object' && depth < 2) {
                                flattenStats(value, key, depth + 1);
                              } else if (typeof value === 'number' || typeof value === 'string') {
                                const displayName = formatStatName(key, parentKey);

                                // Filter out league, team, player related stats, and games number/position (shown in header)
                                const lowerName = displayName.toLowerCase();
                                if (lowerName.includes('league') || lowerName.includes('team') || lowerName.includes('player') ||
                                    lowerName === 'games number' || lowerName === 'games position') {
                                  return;
                                }

                                const displayValue = typeof value === 'number' && key !== 'percentage' ? value.toLocaleString() : value;

                                // Calculate per-90 for numeric stats (but not percentages, IDs, or minutes themselves)
                                let per90Value = '-';
                                if (typeof value === 'number' && key !== 'percentage' && key !== 'minutes' && minutes > 0) {
                                  const per90 = (value / minutes) * 90;
                                  per90Value = per90.toFixed(2);
                                  // Handle cases where per-90 might be very high (like for players with very few minutes)
                                  if (per90 > 999) per90Value = '>999';
                                }

                                const colorClass = getValueColor();

                                statsRows.push({
                                  name: displayName,
                                  value: displayValue,
                                  per90: per90Value,
                                  colorClass
                                });
                              }
                            });
                          };

                          // Flatten all statistics
                          flattenStats(playerStatsData.statistics);

                          // Sort alphabetically
                          statsRows.sort((a, b) => a.name.localeCompare(b.name));

                          // Render rows
                          return statsRows.map((stat, index) => (
                            <tr key={index} className="hover:bg-gray-900/50">
                              <td className="py-2 px-3 text-gray-300 capitalize">{stat.name}</td>
                              <td className={`py-2 px-3 text-right ${stat.colorClass}`}>
                                {stat.value}
                              </td>
                              <td className={`py-2 px-3 text-right ${stat.colorClass}`}>
                                {stat.per90}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

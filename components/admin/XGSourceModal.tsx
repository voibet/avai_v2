import { League } from '../../types/database';


interface XGSourceModalProps {
  isOpen: boolean;
  league: League | null;
  selectedSeason: string;
  availableRounds: string[];
  selectedRounds: Set<string>;
  customRoundName: string;
  xgSourceUrl: string;
  onClose: () => void;
  onToggleRound: (roundName: string) => void;
  onSelectAllRounds: () => void;
  onClearAllRounds: () => void;
  onCustomRoundChange: (value: string) => void;
  onXGSourceUrlChange: (value: string) => void;
  onSubmit: () => void;
  onClearConfiguration?: () => void; // New prop to clear entire configuration
  roundMapping?: Record<string, string[]>; // Maps base round name to array of original rounds
}

export default function XGSourceModal({
  isOpen,
  league,
  selectedSeason,
  availableRounds,
  selectedRounds,
  customRoundName,
  xgSourceUrl,
  onClose,
  onToggleRound,
  onSelectAllRounds,
  onClearAllRounds,
  onCustomRoundChange,
  onXGSourceUrlChange,
  onSubmit,
  onClearConfiguration,
  roundMapping = {}
}: XGSourceModalProps) {
  if (!isOpen || !league) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-red-400 font-mono">
            Manage XG Source - {league.name}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        <div className="mb-4">
          <div className="text-sm text-gray-400 mb-2">
            Season: <span className="text-white font-mono">{selectedSeason}</span>
          </div>

          {/* Current XG Source Status */}
          {selectedRounds.size > 0 && (
            <div className="mb-4 p-3 bg-gray-800 border border-gray-600 rounded">
              <div className="text-sm text-gray-300 mb-1">
                <span className="text-green-400 font-bold">Current Configuration:</span>
              </div>
              <div className="text-xs text-gray-400">
                URL: <span className="text-white font-mono">{xgSourceUrl || 'Not set'}</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Configured Rounds: <span className="text-white font-mono">{Array.from(selectedRounds).join(', ')}</span>
              </div>
            </div>
          )}

          {/* XG Source URL Input */}
          <div className="mb-4">
            <label className="block text-sm text-gray-300 mb-2">
              XG Source URL
            </label>
            <input
              type="text"
              value={xgSourceUrl}
              onChange={(e) => onXGSourceUrlChange(e.target.value)}
              placeholder="Enter XG source, for example 'NATIVE' or 'e5d37f97'"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-red-600"
            />
          </div>

          {/* Available Rounds */}
          {availableRounds.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm text-gray-300">
                  Select Rounds from Fixtures
                </label>
                <div className="flex space-x-2">
                  <button
                    onClick={onSelectAllRounds}
                    className="text-xs bg-blue-800 hover:bg-blue-900 text-white px-2 py-1 font-mono"
                  >
                    Select All
                  </button>
                  <button
                    onClick={onClearAllRounds}
                    className="text-xs bg-gray-700 hover:bg-gray-800 text-white px-2 py-1 font-mono"
                  >
                    Clear All
                  </button>
                  {selectedRounds.size > 0 && onClearConfiguration && (
                    <button
                      onClick={onClearConfiguration}
                      className="text-xs bg-red-800 hover:bg-red-900 text-white px-2 py-1 font-mono"
                      title="Clear all configuration for this season"
                    >
                      Clear Config
                    </button>
                  )}
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto bg-gray-800 border border-gray-600 rounded p-2">
                {availableRounds.map(round => {
                  const originalRounds = roundMapping[round];
                  const count = originalRounds ? originalRounds.length : 1;
                  const countText = count > 1 ? ` (${count} rounds)` : '';

                  return (
                    <label key={round} className="flex items-center space-x-2 mb-1">
                      <input
                        type="checkbox"
                        checked={selectedRounds.has(round)}
                        onChange={() => onToggleRound(round)}
                        className="rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-600"
                      />
                      <span className="text-sm text-gray-300">
                        {round}
                        <span className="text-xs text-gray-500">{countText}</span>
                        {selectedRounds.has(round) && (
                          <span className="text-xs text-green-400 ml-2">✓ Configured</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom Round Input */}
          <div className="mb-4">
            <label className="block text-sm text-gray-300 mb-2">
              Or Add Custom Round (e.g., "ALL")
            </label>
            <input
              type="text"
              value={customRoundName}
              onChange={(e) => onCustomRoundChange(e.target.value)}
              placeholder="Enter custom round name"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-red-600"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white font-mono text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white font-mono text-sm transition-colors"
            >
              Update XG Source
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

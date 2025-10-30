'use client'

interface TeamStandingsModalProps {
  team: {
    id: number;
    name: string;
    logo: string;
  } | null;
  descriptionPercentages: { [description: string]: number } | null;
  winPercentage: number | null;
  onClose: () => void;
}

export default function TeamStandingsModal({
  team,
  descriptionPercentages,
  winPercentage,
  onClose
}: TeamStandingsModalProps) {
  if (!team || !descriptionPercentages) return null;

  // Sort descriptions by percentage (highest first)
  // Add league title if winPercentage exists
  const allProbabilities = { ...descriptionPercentages };
  if (winPercentage !== null && winPercentage > 0) {
    allProbabilities['League Title'] = winPercentage;
  }

  const sortedDescriptions = Object.entries(allProbabilities)
    .sort(([descA, percentA], [descB, percentB]) => {
      // League Title always comes first
      if (descA === 'League Title') return -1;
      if (descB === 'League Title') return 1;
      // Otherwise sort by percentage (highest first)
      return percentB - percentA;
    })
    .filter(([, percentage]) => percentage > 0); // Only show descriptions with > 0% chance



  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-black border border-gray-700 rounded-lg max-w-lg w-full max-h-[70vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-black border-b border-gray-700 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {team.logo && (
              <img
                src={team.logo}
                alt={team.name}
                className="w-8 h-8 object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            )}
            <div>
              <h2 className="text-white font-bold text-base font-mono">{team.name}</h2>
              <p className="text-gray-400 text-xs font-mono">ID: {team.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          <div>
            <h3 className="text-xs font-bold text-gray-200 font-mono mb-3 border-b border-gray-700 pb-1">
              SEASON END PROBABILITIES
            </h3>

            {sortedDescriptions.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 text-sm font-mono">No probabilities available or team has nothing to play for</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedDescriptions.map(([description, percentage]) => (
                  <div key={description} className="bg-gray-900 border border-gray-700 rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-200 font-bold font-mono text-xs">
                        {description}
                      </span>
                      <span className="text-white font-mono font-bold text-sm">
                        {percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-1">
                      <div
                        className="h-1 bg-gray-400 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

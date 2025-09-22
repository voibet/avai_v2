import React from 'react';

interface ProgressPanelProps {
  league: string;
  current: number;
  total: number;
  message: string;
}

export default function ProgressPanel({ league, current, total, message }: ProgressPanelProps) {
  const progressPercentage = (current / total) * 100;

  return (
    <div className="mt-4 border border-blue-600 bg-blue-900/20 rounded-lg p-4">
      <div className="flex items-center space-x-3 mb-2">
        <div className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold animate-pulse">
          ⟳
        </div>
        <h3 className="text-sm font-semibold font-mono text-blue-400">
          Fetching Fixtures
        </h3>
      </div>
      <p className="text-gray-300 font-mono text-sm mb-2">
        {message}
      </p>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progressPercentage}%` }}
        ></div>
      </div>
      <p className="text-gray-400 font-mono text-xs mt-1">
        {current} / {total} leagues processed
      </p>
    </div>
  );
}

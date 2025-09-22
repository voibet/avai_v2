import React from 'react';

interface ResultsPanelProps {
  success: boolean;
  message: string;
}

export default function ResultsPanel({ success, message }: ResultsPanelProps) {
  return (
    <div className={`
      mt-4 border rounded-lg p-4
      ${success
        ? 'border-green-600 bg-green-900/20'
        : 'border-red-600 bg-red-900/20'
      }
    `}>
      <div className="flex items-center space-x-3 mb-2">
        <div className={`
          w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold
          ${success ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}
        `}>
          {success ? '✓' : '✗'}
        </div>
        <h3 className="text-sm font-semibold font-mono">
          {success ? 'Success' : 'Error'}
        </h3>
      </div>
      <p className="text-gray-300 font-mono text-sm">
        {message}
      </p>
    </div>
  );
}

import React from 'react';

interface EmptyStateProps {
  message?: string;
  className?: string;
}

export function EmptyState({
  message = 'No data available',
  className = 'px-2 py-4'
}: EmptyStateProps) {
  return (
    <div className={className}>
      <div className="text-center py-4">
        <span className="text-gray-500 text-sm font-mono">{message}</span>
      </div>
    </div>
  );
}





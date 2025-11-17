import React from 'react';

interface ErrorStateProps {
  message: string;
  className?: string;
}

export function ErrorState({ message, className = 'px-2 py-4' }: ErrorStateProps) {
  return (
    <div className={className}>
      <div className="text-center py-4">
        <span className="text-red-400 text-sm font-mono">Failed to load: {message}</span>
      </div>
    </div>
  );
}





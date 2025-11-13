import React from 'react';

interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LoadingState({
  message = 'Loading...',
  size = 'md',
  className = 'px-2 py-4'
}: LoadingStateProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8'
  };

  return (
    <div className={className}>
      <div className="text-center py-4">
        <div className={`inline-block animate-spin rounded-full ${sizeClasses[size]} border-b-2 border-green-400`}></div>
        <span className="ml-2 text-gray-400 text-sm font-mono">{message}</span>
      </div>
    </div>
  );
}

interface LoadingSpinnerProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function LoadingSpinner({ message = 'Loading...', size = 'md' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  return (
    <div className="flex flex-col items-center justify-center py-4">
      <div className={`${sizeClasses[size]} border-2 border-gray-600 border-t-green-400 rounded-full animate-spin mb-2`}></div>
      <p className="text-gray-400 text-xs font-mono">{message}</p>
    </div>
  );
}

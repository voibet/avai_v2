interface ErrorMessageProps {
  message: string;
  className?: string;
}

export default function ErrorMessage({ message, className = '' }: ErrorMessageProps) {
  return (
    <div className={`bg-red-900/20 border border-red-600 text-red-400 px-2 py-1 text-xs font-mono ${className}`}>
      ERROR: {message}
    </div>
  );
}

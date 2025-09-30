import { useState, useEffect } from 'react';


export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApi<T>(
  url: string | null,
  options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: any;
    enabled?: boolean;
  }
): ApiState<T> & { refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = options?.enabled ?? true;

  const fetchData = async () => {
    if (!url || !enabled) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await fetch(url, {
        method: options?.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [url, enabled, options?.method, options?.body]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}

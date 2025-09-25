import React, { useEffect, useRef, useCallback } from 'react';


interface OddsChartData {
  t: number; // timestamp
  value: number; // odds value
}

interface OddsChartProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  bookie: string;
  oddsHistory: OddsChartData[];
  decimals: number;
  position: { x: number; y: number };
}

export function OddsChart({
  isOpen,
  onClose,
  title,
  bookie,
  oddsHistory,
  decimals,
  position
}: OddsChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = useCallback((event: React.MouseEvent) => {
    if (event.target === overlayRef.current) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  // Helper function to format odds value
  const formatOdds = (value: number) => {
    const divisor = Math.pow(10, decimals);
    return (value / divisor).toFixed(2);
  };

  // Sort by timestamp (oldest first) to properly filter changes
  const sortedHistoryOldest = [...oddsHistory].sort((a, b) => a.t - b.t);
  
  // Filter to only show odds that are different from the previous value
  const filteredHistory = sortedHistoryOldest.filter((entry, index) => {
    if (index === 0) return true; // Always include the first entry
    const prevEntry = sortedHistoryOldest[index - 1];
    return entry.value !== prevEntry.value; // Only include if value changed
  });

  // Position the chart (needed for both cases)
  const chartWidth = 200;
  const chartHeight = 120;
  const smallChartHeight = 60; // Smaller height for "no history" message
  const chartStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x + 10, window.innerWidth - chartWidth - 20),
    top: Math.min(position.y - smallChartHeight / 2, window.innerHeight - smallChartHeight - 20),
    zIndex: 1000,
  };

  if (filteredHistory.length < 2) {
    return (
      <>
        {/* Invisible overlay to catch clicks outside */}
        <div
          ref={overlayRef}
          className="fixed inset-0 z-[999]"
          onClick={handleOverlayClick}
        />
        <div
          ref={chartRef}
          className="bg-gray-900 border border-gray-600 rounded shadow-lg p-3"
          style={{ ...chartStyle, zIndex: 1000 }}
        >
          <div className="text-xs text-gray-400 font-mono">
            {title}
          </div>
          <div className="text-sm text-gray-500 font-mono mt-1">
            No history available
          </div>
        </div>
      </>
    );
  }

  // Chart dimensions
  const padding = 15;
  const bottomPadding = 25; // Extra space for time axis labels
  const actualWidth = chartWidth - 2 * padding;
  const actualHeight = chartHeight - padding - bottomPadding;

  // Calculate min/max values for scaling
  const values = filteredHistory.map(d => d.value / Math.pow(10, decimals));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue;

  // Add some padding to the range
  const rangePadding = valueRange * 0.1;
  const displayMin = minValue - rangePadding;
  const displayMax = maxValue + rangePadding;
  const displayRange = displayMax - displayMin;

  // Generate path for line chart
  const points = filteredHistory.map((d, i) => {
    const x = padding + (i / (filteredHistory.length - 1)) * actualWidth;
    const normalizedValue = (d.value / Math.pow(10, decimals) - displayMin) / displayRange;
    const y = padding + (1 - normalizedValue) * actualHeight;
    return { x, y, value: d.value, timestamp: d.t };
  });

  const pathData = points.map((point, i) =>
    `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
  ).join(' ');

  // Generate time axis labels (max 6)
  const maxLabels = 6;
  const labelInterval = Math.max(1, Math.floor(filteredHistory.length / maxLabels));
  const timeLabels = [];

  for (let i = 0; i < filteredHistory.length; i += labelInterval) {
    const entry = filteredHistory[i];
    const now = Date.now() / 1000;
    const diff = now - entry.t;

    let timeStr = '';
    if (diff < 60) {
      timeStr = `${Math.floor(diff)}s`;
    } else if (diff < 3600) {
      timeStr = `${Math.floor(diff / 60)}m`;
    } else if (diff < 86400) {
      timeStr = `${Math.floor(diff / 3600)}h`;
    } else {
      timeStr = `${Math.floor(diff / 86400)}d`;
    }

    timeLabels.push({
      x: padding + (i / (filteredHistory.length - 1)) * actualWidth,
      label: timeStr,
      timestamp: entry.t
    });
  }

  // Always include the most recent if not already included
  if (timeLabels.length > 0 && timeLabels[timeLabels.length - 1].timestamp !== filteredHistory[filteredHistory.length - 1].t) {
    const lastEntry = filteredHistory[filteredHistory.length - 1];
    const now = Date.now() / 1000;
    const diff = now - lastEntry.t;

    let timeStr = '';
    if (diff < 60) {
      timeStr = `${Math.floor(diff)}s`;
    } else if (diff < 3600) {
      timeStr = `${Math.floor(diff / 60)}m`;
    } else if (diff < 86400) {
      timeStr = `${Math.floor(diff / 3600)}h`;
    } else {
      timeStr = `${Math.floor(diff / 86400)}d`;
    }

    timeLabels.push({
      x: padding + actualWidth,
      label: timeStr,
      timestamp: lastEntry.t
    });
  }

  return (
    <>
      {/* Invisible overlay to catch clicks outside */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[999]"
        onClick={handleOverlayClick}
      />
      <div
        ref={chartRef}
        className="bg-gray-900 border border-gray-600 rounded shadow-lg p-2"
        style={{
          ...chartStyle,
          top: Math.min(position.y - chartHeight / 2, window.innerHeight - chartHeight - 20),
          zIndex: 1000
        }}
      >
      {/* Header */}
      <div className="mb-2">
        <div className="text-xs text-white font-mono font-bold truncate">
          {title}
        </div>
        <div className="text-xs text-gray-400 truncate">
          {bookie}
        </div>
      </div>

      {/* Chart */}
      <svg width={chartWidth} height={chartHeight} className="bg-black rounded">
        {/* Grid lines */}
        <defs>
          <pattern id="grid" width="20" height="15" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 15" fill="none" stroke="#374151" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        
        {/* Chart line */}
        <path
          d={pathData}
          fill="none"
          stroke="#ef4444"
          strokeWidth="2"
          className="opacity-90"
        />
        
        {/* Data points */}
        {points.map((point, i) => (
          <g key={i}>
            <circle
              cx={point.x}
              cy={point.y}
              r="3"
              fill="#ef4444"
              className="opacity-90"
            />
            {/* Tooltip on hover */}
            <circle
              cx={point.x}
              cy={point.y}
              r="8"
              fill="transparent"
              className="cursor-pointer"
            >
              <title>
                {formatOdds(point.value)} @ {new Date(point.timestamp * 1000).toLocaleString()}
              </title>
            </circle>
          </g>
        ))}

        {/* Y-axis labels (max 5) */}
        {(() => {
          const numLabels = Math.min(5, Math.max(2, filteredHistory.length));
          const labels = [];

          for (let i = 0; i < numLabels; i++) {
            const value = displayMax - (i / (numLabels - 1)) * (displayMax - displayMin);
            const y = padding + (i / (numLabels - 1)) * actualHeight;

            labels.push(
              <text
                key={i}
                x="5"
                y={y + 3}
                fontSize="9"
                fill="#9ca3af"
                className="font-mono"
                textAnchor="start"
              >
                {value.toFixed(2)}
              </text>
            );
          }

          return labels;
        })()}

        {/* X-axis time labels */}
        {timeLabels.map((label, i) => (
          <text
            key={i}
            x={label.x}
            y={chartHeight - 8}
            fontSize="9"
            fill="#9ca3af"
            className="font-mono"
            textAnchor="middle"
          >
            {label.label}
          </text>
        ))}
      </svg>

      {/* Current value */}
      <div className="mt-1 text-center">
        <span className="text-sm text-white font-mono font-bold">
          {formatOdds(filteredHistory[filteredHistory.length - 1].value)}
        </span>
        <span className="text-xs text-gray-400 ml-1">
          ({filteredHistory.length} changes)
        </span>
      </div>
      </div>
    </>
  );
}

import React, { useRef, useCallback, useState, useEffect } from 'react';

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

    // Zoom and Pan state
    const [scale, setScale] = useState(1);
    const [offsetX, setOffsetX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStartX, setDragStartX] = useState(0);
    const [dragStartOffsetX, setDragStartOffsetX] = useState(0);

    // Reset state when opening new chart
    useEffect(() => {
        if (isOpen) {
            setScale(1);
            setOffsetX(0);
        }
    }, [isOpen, title, bookie]);

    const handleOverlayClick = useCallback((event: React.MouseEvent) => {
        if (event.target === overlayRef.current) {
            onClose();
        }
    }, [onClose]);

    // Handle Wheel Zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        const newScale = Math.max(1, Math.min(20, scale * (1 + delta))); // Limit zoom 1x to 20x

        // Calculate center of zoom (mouse position relative to chart)
        // For simplicity, zooming to center or keeping left alignment
        // A better zoom feels like zooming towards the mouse, but let's start with simple center zoom or just scaling

        // Adjust offset to keep relative position? 
        // Simple approach: Zoom keeps the current view centered-ish or just clamps

        // Let's try to keep the center point stable
        // oldCenter = (viewWidth / 2 - offsetX) / oldScale
        // newOffsetX = viewWidth / 2 - oldCenter * newScale

        // Simplified: just clamp offset after scale
        const chartWidth = 200;
        const padding = 15;
        const actualWidth = chartWidth - 2 * padding;
        const maxOffsetX = 0;
        const minOffsetX = actualWidth - (actualWidth * newScale);

        let newOffsetX = offsetX * (newScale / scale);
        newOffsetX = Math.max(minOffsetX, Math.min(maxOffsetX, newOffsetX));

        setScale(newScale);
        setOffsetX(newOffsetX);
    }, [scale, offsetX]);

    // Handle Drag Pan
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStartX(e.clientX);
        setDragStartOffsetX(offsetX);
    }, [offsetX]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging) return;

        const deltaX = e.clientX - dragStartX;
        const newOffsetX = dragStartOffsetX + deltaX;

        const chartWidth = 200;
        const padding = 15;
        const actualWidth = chartWidth - 2 * padding;
        const maxOffsetX = 0;
        const minOffsetX = actualWidth - (actualWidth * scale);

        setOffsetX(Math.max(minOffsetX, Math.min(maxOffsetX, newOffsetX)));
    }, [isDragging, dragStartX, dragStartOffsetX, scale]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleMouseLeave = useCallback(() => {
        setIsDragging(false);
    }, []);

    if (!isOpen) return null;

    // Helper function to format odds value
    const formatOdds = (value: number) => {
        const divisor = Math.pow(10, decimals);
        return (value / divisor).toFixed(3);
    };

    // Sort by timestamp (oldest first)
    const sortedHistoryOldest = [...oddsHistory].sort((a, b) => a.t - b.t);

    // Filter to only show odds that are different from the previous value
    const filteredHistory = sortedHistoryOldest.filter((entry, index) => {
        if (index === 0) return true;
        const prevEntry = sortedHistoryOldest[index - 1];
        return entry.value !== prevEntry.value;
    });

    // Position the chart
    const chartWidth = 200;
    const chartHeight = 120;
    const smallChartHeight = 60;
    const chartStyle: React.CSSProperties = {
        position: 'fixed',
        left: Math.min(position.x + 10, window.innerWidth - chartWidth - 20),
        top: Math.min(position.y - smallChartHeight / 2, window.innerHeight - smallChartHeight - 20),
        zIndex: 1000,
    };

    if (filteredHistory.length < 2) {
        const singleEntry = filteredHistory[0];
        return (
            <>
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
                    <div className="text-xs text-gray-400 font-mono">{title}</div>
                    <div className="text-xs text-gray-300 font-mono mt-1">Opening odds</div>
                    <div className="text-xs text-white font-mono font-bold mt-1">
                        {singleEntry ? formatOdds(singleEntry.value) : 'N/A'}
                    </div>
                    {singleEntry && (
                        <div className="text-xs text-gray-400 font-mono mt-1">
                            {new Date(singleEntry.t * 1000).toLocaleString()}
                        </div>
                    )}
                </div>
            </>
        );
    }

    // Chart dimensions
    const padding = 15;
    const bottomPadding = 25;
    const actualWidth = chartWidth - 2 * padding;
    const actualHeight = chartHeight - padding - bottomPadding;

    // Calculate min/max values for scaling
    const values = filteredHistory.map(d => d.value / Math.pow(10, decimals));
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue;

    const rangePadding = valueRange * 0.1;
    const displayMin = minValue - rangePadding;
    const displayMax = maxValue + rangePadding;
    const displayRange = displayMax - displayMin;

    // Generate path for line chart
    const points = filteredHistory.map((d, i) => {
        // X coordinate calculation with zoom and pan
        const normalizedIndex = i / (filteredHistory.length - 1);
        const x = padding + (normalizedIndex * actualWidth * scale) + offsetX;

        const normalizedValue = (d.value / Math.pow(10, decimals) - displayMin) / displayRange;
        const y = padding + (1 - normalizedValue) * actualHeight;
        return { x, y, value: d.value, timestamp: d.t };
    });

    // Filter points that are visible (for optimization if needed, but mainly for path generation)
    // We draw all points but clip them
    const pathData = points.map((point, i) =>
        `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
    ).join(' ');

    // Generate time axis labels
    // We need to determine which labels are visible based on the current view
    const visibleLabels = [];
    // ... (Logic to generate labels based on visible range could be complex)
    // For now, let's stick to the original logic but adjust X positions, and let clipping hide them?
    // Or better, generate labels dynamically based on the visible time range.

    // Let's stick to simple labels for now, but maybe just show start/end of visible area?
    // Or just render all and let them clip (might look messy).

    // Let's try to render a fixed number of labels distributed across the *visible* area.
    const numLabels = 4;
    const visibleStartRatio = -offsetX / (actualWidth * scale);
    const visibleEndRatio = (actualWidth - offsetX) / (actualWidth * scale);

    const startIdx = Math.max(0, Math.floor(visibleStartRatio * (filteredHistory.length - 1)));
    const endIdx = Math.min(filteredHistory.length - 1, Math.ceil(visibleEndRatio * (filteredHistory.length - 1)));

    const labelIndices: number[] = [];
    if (endIdx - startIdx > 0) {
        for (let i = 0; i < numLabels; i++) {
            const idx = Math.round(startIdx + (i / (numLabels - 1)) * (endIdx - startIdx));
            if (!labelIndices.includes(idx)) labelIndices.push(idx);
        }
    } else {
        labelIndices.push(startIdx);
    }

    const timeLabels = labelIndices.map(idx => {
        const entry = filteredHistory[idx];
        const now = Date.now() / 1000;
        const diff = now - entry.t;
        let timeStr = '';
        if (diff < 60) timeStr = `${Math.floor(diff)}s`;
        else if (diff < 3600) timeStr = `${Math.floor(diff / 60)}m`;
        else if (diff < 86400) timeStr = `${Math.floor(diff / 3600)}h`;
        else timeStr = `${Math.floor(diff / 86400)}d`;

        const normalizedIndex = idx / (filteredHistory.length - 1);
        const x = padding + (normalizedIndex * actualWidth * scale) + offsetX;

        return { x, label: timeStr, timestamp: entry.t };
    });

    return (
        <>
            <div
                ref={overlayRef}
                className="fixed inset-0 z-[999]"
                onClick={handleOverlayClick}
            />
            <div
                ref={chartRef}
                className="bg-gray-900 border border-gray-600 rounded shadow-lg p-2 select-none"
                style={{
                    ...chartStyle,
                    top: Math.min(position.y - chartHeight / 2, window.innerHeight - chartHeight - 20),
                    zIndex: 1000
                }}
            >
                <div className="mb-2">
                    <div className="text-xs text-white font-mono font-bold truncate">{title}</div>
                    <div className="text-xs text-gray-400 truncate">
                        {bookie === 'Prediction' ? 'Prediction' : bookie}
                    </div>
                </div>

                <div
                    className="relative overflow-hidden"
                    style={{ width: chartWidth, height: chartHeight }}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                >
                    <svg width={chartWidth} height={chartHeight} className="bg-black rounded cursor-move">
                        <defs>
                            <pattern id="grid" width="20" height="15" patternUnits="userSpaceOnUse">
                                <path d="M 20 0 L 0 0 0 15" fill="none" stroke="#374151" strokeWidth="0.5" />
                            </pattern>
                            <clipPath id="chart-area">
                                <rect x={padding} y={padding} width={actualWidth} height={actualHeight} />
                            </clipPath>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#grid)" />

                        <g clipPath="url(#chart-area)">
                            <path
                                d={pathData}
                                fill="none"
                                stroke="#ef4444"
                                strokeWidth="2"
                                className="opacity-90"
                            />
                            {points.map((point, i) => (
                                <g key={i}>
                                    <circle
                                        cx={point.x}
                                        cy={point.y}
                                        r="3"
                                        fill="#ef4444"
                                        className="opacity-90"
                                    />
                                    {/* Larger hit area for tooltip */}
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
                        </g>

                        {/* Y-axis labels */}
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
                                        {value.toFixed(3)}
                                    </text>
                                );
                            }
                            return labels;
                        })()}

                        {/* X-axis time labels */}
                        {timeLabels.map((label, i) => (
                            <text
                                key={i}
                                x={Math.max(padding, Math.min(chartWidth - padding, label.x))}
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

                    {/* Zoom indicator */}
                    {scale > 1 && (
                        <div className="absolute top-1 right-1 bg-black/50 text-white text-[9px] px-1 rounded pointer-events-none">
                            {scale.toFixed(1)}x
                        </div>
                    )}
                </div>

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

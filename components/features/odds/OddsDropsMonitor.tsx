'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';

// --- Types ---

interface OddsSnapshot {
    t: number;
    x12: number[]; // [home, draw, away] in basis points
}

interface FairOdds {
    t: number;
    x12: number[];
}

interface BookieOdds {
    bookie: string;
    decimals: number;
    odds_x12: OddsSnapshot[] | null;
    fair_odds_x12: FairOdds | null;
}

interface Fixture {
    fixture_id: number;
    home_team: string;
    away_team: string;
    date: string;
    league: string;
    status_short: string;
    odds: BookieOdds[];
}

interface DropEvent {
    fixtureId: number;
    bookie: string;
    selection: 'Home' | 'Draw' | 'Away';
    currentOdds: number;
    previousOdds: number;
    dropPercent: number;
    timestamp: number; // Time of the drop (current odds time)
    fairOdds: number | null;
    predictionOdds: number | null;
    decimals: number;
}

// --- Helper Functions ---

const formatOdds = (basisPoints: number, decimals: number = 2) => {
    const divisor = Math.pow(10, decimals);
    return (basisPoints / divisor).toFixed(2);
};

const getTimeString = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// --- Component ---

export default function OddsDropsMonitor() {
    // State
    const [fixtures, setFixtures] = useState<Map<number, Fixture>>(new Map());
    const [loading, setLoading] = useState(true);
    const [connected, setConnected] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

    // Filters
    const [selectedBookies, setSelectedBookies] = useState<string[]>([]);
    const [availableBookies, setAvailableBookies] = useState<string[]>([]);
    const [minDrop, setMinDrop] = useState<number>(5);
    const [maxDrop, setMaxDrop] = useState<number>(100);
    const [minOdds, setMinOdds] = useState<number>(1.0);
    const [maxOdds, setMaxOdds] = useState<number>(100.0);

    // Stream Ref
    const eventSourceRef = useRef<EventSource | null>(null);

    // 1. Initial Load
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                setLoading(true);
                const res = await fetch('/api/odds?limit=3000&fair_odds=true');
                const data = await res.json();

                if (data.fixtures) {
                    const newFixtures = new Map<number, Fixture>();
                    const bookiesSet = new Set<string>();

                    data.fixtures.forEach((f: Fixture) => {
                        newFixtures.set(f.fixture_id, f);
                        f.odds.forEach(o => {
                            if (o.bookie !== 'Prediction') {
                                bookiesSet.add(o.bookie);
                            }
                        });
                    });

                    setFixtures(newFixtures);
                    setAvailableBookies(Array.from(bookiesSet).sort());
                    // Default select all bookies if none selected
                    if (selectedBookies.length === 0) {
                        // Optional: Select top bookies by default? Or all?
                        // Let's select all for now
                        setSelectedBookies(Array.from(bookiesSet));
                    }
                }
            } catch (err) {
                console.error('Failed to load initial odds:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchInitialData();
    }, []);

    // 2. SSE Connection
    useEffect(() => {
        // Close existing connection
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        // Connect to stream
        // We pass fair_odds=true to get fair odds in updates
        const url = `/api/odds/stream?fair_odds=true`;
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
            setConnected(true);
            console.log('Odds stream connected');
        };

        eventSource.onmessage = (event) => {
            // Keep-alive
            if (event.data === ': keep-alive') return;

            try {
                const data = JSON.parse(event.data);

                if (data.type === 'odds_update') {
                    setFixtures(prev => {
                        const next = new Map(prev);
                        const existing = next.get(data.fixture_id);

                        if (existing) {
                            // Merge odds
                            const updatedOdds = [...existing.odds];

                            data.odds.forEach((newOdd: BookieOdds) => {
                                const idx = updatedOdds.findIndex(o => o.bookie === newOdd.bookie);
                                if (idx >= 0) {
                                    // Update existing bookie entry
                                    // Note: Stream returns arrays for odds_x12 but they might be single updates
                                    // We need to append to history if we want to track history locally, 
                                    // but for "drops in last 5 mins" we rely on the history we have.
                                    // The stream sends the *latest* update. 
                                    // Ideally we should append this new snapshot to our history.

                                    const existingBookie = updatedOdds[idx];
                                    let newX12History = existingBookie.odds_x12 || [];

                                    if (newOdd.odds_x12 && newOdd.odds_x12.length > 0) {
                                        // Append new snapshots
                                        // Check for duplicates by timestamp
                                        newOdd.odds_x12.forEach(snap => {
                                            if (!newX12History.some(h => h.t === snap.t)) {
                                                newX12History.push(snap);
                                            }
                                        });
                                        // Sort by time
                                        newX12History.sort((a, b) => a.t - b.t);
                                    }

                                    updatedOdds[idx] = {
                                        ...existingBookie,
                                        odds_x12: newX12History,
                                        fair_odds_x12: newOdd.fair_odds_x12 || existingBookie.fair_odds_x12
                                    };
                                } else {
                                    // Add new bookie entry
                                    updatedOdds.push(newOdd);
                                }
                            });

                            next.set(data.fixture_id, {
                                ...existing,
                                odds: updatedOdds
                            });
                        } else {
                            // New fixture?
                            // For now, we might ignore new fixtures if they weren't in initial load, 
                            // or we can add them. Let's add them.
                            next.set(data.fixture_id, {
                                fixture_id: data.fixture_id,
                                home_team: data.home_team_name,
                                away_team: data.away_team_name,
                                date: data.date,
                                league: data.league_name,
                                status_short: data.status_short,
                                odds: data.odds
                            });
                        }
                        return next;
                    });
                    setLastUpdate(Date.now());
                }
            } catch (e) {
                console.error('Error parsing stream message:', e);
            }
        };

        eventSource.onerror = (err) => {
            console.error('Stream error:', err);
            setConnected(false);
            eventSource.close();
            // Reconnect logic could go here (e.g. setTimeout)
        };

        return () => {
            eventSource.close();
        };
    }, []);

    // 3. Calculate Drops
    const drops = useMemo(() => {
        const calculatedDrops: DropEvent[] = [];
        const now = Date.now() / 1000;
        const fiveMinsAgo = now - 5 * 60;

        fixtures.forEach(fixture => {
            let bestDropForFixture: DropEvent | null = null;

            fixture.odds.forEach(bookieData => {
                if (bookieData.bookie === 'Prediction') return;
                if (!selectedBookies.includes(bookieData.bookie)) return;
                if (!bookieData.odds_x12 || bookieData.odds_x12.length < 2) return;

                // Get history sorted by time
                const history = bookieData.odds_x12;
                const current = history[history.length - 1];

                // Check if current data is stale (older than 1 hour? maybe not relevant for "drops")
                // But we only care about drops that *happened* in the last 5 minutes.
                // So current.t must be > fiveMinsAgo.
                if (current.t < fiveMinsAgo) return;

                // Find the reference odd (max odd in the last 5 minutes window, or the odd just before the window)
                // Actually, simpler: Find the odd at ~5 mins ago.
                // We look for the snapshot that was active 5 mins ago.
                // That is the last snapshot with t <= fiveMinsAgo.
                // If no such snapshot, we take the first available snapshot (if it's within the window).

                // Let's find the "start price" for the drop calculation.
                // We want the price that was valid 5 minutes ago.
                let startSnapshot = null;
                for (let i = history.length - 1; i >= 0; i--) {
                    if (history[i].t <= fiveMinsAgo) {
                        startSnapshot = history[i];
                        break;
                    }
                }
                // If we didn't find one before 5 mins ago, it means all history is within 5 mins.
                // So we take the oldest one in history as the start.
                if (!startSnapshot && history.length > 0) {
                    startSnapshot = history[0];
                }

                if (!startSnapshot) return;

                // Compare current vs start for Home, Draw, Away
                const outcomes = ['Home', 'Draw', 'Away'] as const;
                const decimals = bookieData.decimals || 2;
                const divisor = Math.pow(10, decimals);

                outcomes.forEach((outcome, idx) => {
                    const currentPrice = current.x12[idx];
                    const startPrice = startSnapshot!.x12[idx];

                    if (!currentPrice || !startPrice) return;

                    // Check min/max odds filter on CURRENT odds
                    const currentDec = currentPrice / divisor;
                    if (currentDec < minOdds || currentDec > maxOdds) return;

                    if (currentPrice < startPrice) {
                        const dropPercent = ((startPrice - currentPrice) / startPrice) * 100;

                        if (dropPercent >= minDrop && dropPercent <= maxDrop) {
                            const dropEvent: DropEvent = {
                                fixtureId: fixture.fixture_id,
                                bookie: bookieData.bookie,
                                selection: outcome,
                                currentOdds: currentPrice,
                                previousOdds: startPrice,
                                dropPercent,
                                timestamp: current.t,
                                fairOdds: bookieData.fair_odds_x12 ? bookieData.fair_odds_x12.x12[idx] : null,
                                predictionOdds: null, // Will fill later
                                decimals: decimals
                            };

                            // Find prediction odds
                            const predictionBookie = fixture.odds.find(o => o.bookie === 'Prediction');
                            if (predictionBookie && predictionBookie.odds_x12 && predictionBookie.odds_x12.length > 0) {
                                // Use latest prediction
                                const latestPred = predictionBookie.odds_x12[predictionBookie.odds_x12.length - 1];
                                dropEvent.predictionOdds = latestPred.x12[idx];
                            }

                            // Keep only the "best" drop per fixture (highest %)
                            if (!bestDropForFixture || dropPercent > bestDropForFixture.dropPercent) {
                                bestDropForFixture = dropEvent;
                            }
                        }
                    }
                });
            });

            if (bestDropForFixture) {
                calculatedDrops.push(bestDropForFixture);
            }
        });

        // Sort drops by magnitude (descending)
        return calculatedDrops.sort((a, b) => b.dropPercent - a.dropPercent);
    }, [fixtures, selectedBookies, minDrop, maxDrop, minOdds, maxOdds, lastUpdate]);

    // --- Render ---

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
            {/* Header */}
            <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                        Odds Drop Monitor
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm">
                        Tracking significant market movements in real-time
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`} />
                    <span className="text-sm font-medium text-slate-300">
                        {connected ? 'Live Stream Active' : 'Disconnected'}
                    </span>
                </div>
            </header>

            {/* Controls */}
            {/* Controls */}
            <div className="mb-8 bg-slate-900/50 p-4 rounded-xl border border-slate-800/50 backdrop-blur-sm flex flex-col gap-4">

                {/* Bookies */}
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Bookmakers</label>
                        <button
                            onClick={() => selectedBookies.length === availableBookies.length ? setSelectedBookies([]) : setSelectedBookies(availableBookies)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 font-medium transition-colors"
                        >
                            {selectedBookies.length === availableBookies.length ? 'Deselect All' : 'Select All'}
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {availableBookies.map(b => (
                            <button
                                key={b}
                                onClick={() => setSelectedBookies(prev => prev.includes(b) ? prev.filter(i => i !== b) : [...prev, b])}
                                className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-all ${selectedBookies.includes(b)
                                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/50 hover:bg-blue-500/30'
                                    : 'bg-slate-900 text-slate-500 border-slate-800 hover:border-slate-600 hover:text-slate-400'
                                    }`}
                            >
                                {b}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="h-px bg-slate-800/50" />

                {/* Filters Row */}
                <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">

                    {/* Drop % */}
                    <div className="flex items-center gap-3">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider min-w-[60px]">Drop %</label>
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <input
                                    type="number"
                                    value={minDrop}
                                    onChange={(e) => setMinDrop(Number(e.target.value))}
                                    className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center focus:ring-1 focus:ring-blue-500 outline-none"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 pointer-events-none">%</span>
                            </div>
                            <span className="text-slate-600 text-xs">-</span>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={maxDrop}
                                    onChange={(e) => setMaxDrop(Number(e.target.value))}
                                    className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center focus:ring-1 focus:ring-blue-500 outline-none"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 pointer-events-none">%</span>
                            </div>
                        </div>
                    </div>

                    {/* Odds Range */}
                    <div className="flex items-center gap-3">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider min-w-[60px]">Odds</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                step="0.01"
                                value={minOdds}
                                onChange={(e) => setMinOdds(Number(e.target.value))}
                                className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                            <span className="text-slate-600 text-xs">-</span>
                            <input
                                type="number"
                                step="0.01"
                                value={maxOdds}
                                onChange={(e) => setMaxOdds(Number(e.target.value))}
                                className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>

                    <div className="flex-1 hidden md:block" />

                    {/* Stats */}
                    <div className="flex items-center gap-2 bg-slate-800/30 px-3 py-1 rounded border border-slate-800/50">
                        <span className="text-emerald-400 font-bold font-mono">{drops.length}</span>
                        <span className="text-xs text-slate-400">Active Drops</span>
                    </div>

                </div>
            </div>

            {/* Results Grid */}
            {loading ? (
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                </div>
            ) : drops.length === 0 ? (
                <div className="text-center py-20 bg-slate-900/30 rounded-2xl border border-slate-800 border-dashed">
                    <div className="text-slate-500 text-lg">No drops matching your criteria</div>
                    <p className="text-slate-600 text-sm mt-2">Try adjusting your filters or wait for market activity</p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {drops.map((drop) => {
                        const fixture = fixtures.get(drop.fixtureId);
                        if (!fixture) return null;

                        return (
                            <div key={`${drop.fixtureId}-${drop.bookie}`} className="group relative bg-slate-900 rounded-lg border border-slate-800 overflow-hidden hover:border-blue-500/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                                {/* Left accent bar */}
                                <div className="absolute top-0 left-0 h-full w-1 bg-gradient-to-b from-blue-500 to-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />

                                <div className="p-4 grid grid-cols-12 gap-4 items-center">

                                    {/* 1. Time & League (Cols 1-2) */}
                                    <div className="col-span-12 md:col-span-2 flex flex-col gap-1">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                            <span className="text-xs font-bold text-amber-400">
                                                {Math.floor((Date.now() / 1000 - drop.timestamp) / 60)}m ago
                                            </span>
                                        </div>
                                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate" title={fixture.league}>
                                            {fixture.league}
                                        </div>
                                        <div className="text-[10px] text-slate-600 font-mono">
                                            {getTimeString(fixture.date)}
                                        </div>
                                    </div>

                                    {/* 2. Teams (Cols 3-5) */}
                                    <div className="col-span-12 md:col-span-3 flex flex-col justify-center">
                                        <div className="text-sm font-bold text-slate-200 truncate">{fixture.home_team}</div>
                                        <div className="text-sm font-bold text-slate-200 truncate">{fixture.away_team}</div>
                                    </div>

                                    {/* 3. Drop Info (Cols 6-9) */}
                                    <div className="col-span-12 md:col-span-4 bg-slate-950/50 rounded-lg p-3 border border-slate-800/50 flex items-center justify-between gap-4">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-slate-400 uppercase">{drop.bookie}</span>
                                            <span className="text-sm font-bold text-blue-400">{drop.selection}</span>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <div className="flex flex-col items-end">
                                                <span className="text-xl font-bold text-white leading-none">{formatOdds(drop.currentOdds, drop.decimals)}</span>
                                                <span className="text-xs text-slate-500 line-through decoration-slate-600">{formatOdds(drop.previousOdds, drop.decimals)}</span>
                                            </div>
                                            <div className="flex items-center gap-1 text-emerald-400 font-bold bg-emerald-500/10 px-2 py-1 rounded text-xs">
                                                <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 12 12">
                                                    <path d="M6 9L2 5h8L6 9z" />
                                                </svg>
                                                {drop.dropPercent.toFixed(1)}%
                                            </div>
                                        </div>
                                    </div>

                                    {/* 4. Context (Cols 10-12) */}
                                    <div className="col-span-12 md:col-span-3 flex gap-2 justify-end">
                                        <div className="flex flex-col items-end bg-slate-800/30 rounded px-3 py-2 border border-slate-800/50 min-w-[80px]">
                                            <span className="text-[9px] text-slate-500 uppercase mb-0.5">Fair</span>
                                            <span className="font-mono text-sm text-slate-300">
                                                {drop.fairOdds ? formatOdds(drop.fairOdds, drop.decimals) : '-'}
                                            </span>
                                        </div>
                                        <div className="flex flex-col items-end bg-slate-800/30 rounded px-3 py-2 border border-slate-800/50 min-w-[80px]">
                                            <span className="text-[9px] text-slate-500 uppercase mb-0.5">Pred</span>
                                            <span className="font-mono text-sm text-blue-300">
                                                {drop.predictionOdds ? formatOdds(drop.predictionOdds, drop.decimals) : '-'}
                                            </span>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div >
    );
}

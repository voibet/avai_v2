
'use client'

import { useState } from 'react'
import {
  useFixtures,
  useWebSocket,
  useStats,
  useFilter,
  useFixturesHistory,
  useComputedValues,
} from './hooks'
import {
  StatsPanel,
  FilterPanel,
  RecentUpdatesPanel,
  FixturesList,
  OddsTable,
  FixtureDetails,
} from './ui'

export default function TradingPage() {
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(null)
  const [showRecentUpdates, setShowRecentUpdates] = useState(true)

  // Custom hooks
  const { fixtures, setFixtures, loading } = useFixtures()
  const { connected, ws } = useWebSocket(fixtures, setFixtures, loading)
  const { stats } = useStats()
  const {
    showFilter,
    setShowFilter,
    filterInput,
    setFilterInput,
    filterError,
    applyFilter,
    clearFilter,
  } = useFilter(ws, setFixtures)
  const {
    fixturesHistory,
    setFixturesHistory,
    showFixturesHistory,
    setShowFixturesHistory,
  } = useFixturesHistory()

  const {
    now,
    sortedFixtures,
    recentlyUpdated,
    selectedFixture,
    selectedBookmakers,
  } = useComputedValues(fixtures, fixturesHistory, selectedFixtureId)

  return (
    <div className="fixed inset-0 bg-[#0a0a0f] text-[#e0e0e0] font-mono text-[11px] overflow-hidden p-3 flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#1a1a2e]">
      </div>

      <StatsPanel
        connected={connected}
        stats={stats}
        recentlyUpdatedCount={recentlyUpdated.length}
      />

      {/* Main Grid */}
      <div className="grid gap-3 flex-1"
           style={{
             gridTemplateColumns: '280px 1fr 320px',
             gridTemplateRows: '1fr 2fr',
             gridTemplateAreas: `
               "filters fixtures details"
               "filters odds details"
             `
           }}>
        <div className="bg-[#12121a] rounded flex flex-col"
             style={{ gridArea: 'filters' }}>
          <FilterPanel
            showFilter={showFilter}
            setShowFilter={setShowFilter}
            filterInput={filterInput}
            setFilterInput={setFilterInput}
            filterError={filterError}
            applyFilter={applyFilter}
            clearFilter={clearFilter}
          />

          <RecentUpdatesPanel
            showRecentUpdates={showRecentUpdates}
            setShowRecentUpdates={setShowRecentUpdates}
            recentlyUpdated={recentlyUpdated}
            loading={loading}
            selectedFixtureId={selectedFixtureId}
            setSelectedFixtureId={setSelectedFixtureId}
            showFixturesHistory={showFixturesHistory}
            setShowFixturesHistory={setShowFixturesHistory}
            fixturesHistory={fixturesHistory}
            now={now}
          />
        </div>

        <FixturesList
          sortedFixtures={sortedFixtures}
          loading={loading}
          selectedFixtureId={selectedFixtureId}
          setSelectedFixtureId={setSelectedFixtureId}
          now={now}
        />

        {selectedFixture && selectedBookmakers.length > 0 && (
          <OddsTable
            selectedFixture={selectedFixture}
            selectedBookmakers={selectedBookmakers}
          />
        )}

        <FixtureDetails
          selectedFixture={selectedFixture || null}
        />
      </div>

      {/* Custom scrollbar styles */}
      <style jsx global>{`
        .overflow-y-auto::-webkit-scrollbar {
          width: 4px;
        }
        .overflow-y-auto::-webkit-scrollbar-track {
          background: #0a0a0f;
        }
        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 2px;
        }
      `}</style>
    </div>
  )
}

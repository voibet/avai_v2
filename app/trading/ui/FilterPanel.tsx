import type { FixtureWithOdds } from '../types'
import { VALUE_FILTER, ARBITRAGE_FILTER, PINNACLE_DROP, DEFAULT_VALUE_FILTER, getFilterJson } from '../filters/presets'

interface FilterPanelProps {
  showFilter: boolean
  setShowFilter: (show: boolean) => void
  filterInput: string
  setFilterInput: (input: string) => void
  filterError: string | null
  applyFilter: () => void
  clearFilter: () => void
}

export function FilterPanel({
  showFilter,
  setShowFilter,
  filterInput,
  setFilterInput,
  filterError,
  applyFilter,
  clearFilter,
}: FilterPanelProps) {
  return (
    <div className="border-b border-[#1a1a2e]">
      <div
        className="px-2.5 py-2 bg-[#1a1a2e] text-[10px] font-semibold flex justify-between items-center cursor-pointer hover:bg-[#252540] transition-colors"
        onClick={() => setShowFilter(!showFilter)}
      >
        <div className="flex items-center gap-2">
          <span>Filter Configuration</span>
          {filterError && <span className="text-[#ff4444] text-[9px]">({filterError})</span>}
        </div>
        <span>{showFilter ? '▼' : '▶'}</span>
      </div>

      {showFilter && (
        <div className="p-2 bg-[#0a0a0f]">
          <div className="flex gap-1 mb-2">
            <button
              onClick={() => setFilterInput(getFilterJson(DEFAULT_VALUE_FILTER))}
              className="px-2 py-1 bg-[#1a1a2e] text-[#2196F3] rounded text-[9px] hover:bg-[#252540] border border-[#2196F3]/20"
            >
              Default
            </button>
            <button
              onClick={() => setFilterInput(getFilterJson(VALUE_FILTER))}
              className="px-2 py-1 bg-[#1a1a2e] text-[#00ff88] rounded text-[9px] hover:bg-[#252540] border border-[#00ff88]/20"
            >
              Value
            </button>
            <button
              onClick={() => setFilterInput(getFilterJson(ARBITRAGE_FILTER))}
              className="px-2 py-1 bg-[#1a1a2e] text-[#ff9500] rounded text-[9px] hover:bg-[#252540] border border-[#ff9500]/20"
            >
              Arb
            </button>
            <button
              onClick={() => setFilterInput(getFilterJson(PINNACLE_DROP))}
              className="px-2 py-1 bg-[#1a1a2e] text-[#ff4444] rounded text-[9px] hover:bg-[#252540] border border-[#ff4444]/20"
            >
              Drop
            </button>
          </div>

          <textarea
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            className="w-full h-64 bg-[#12121a] border border-[#1a1a2e] rounded p-2 text-[#e0e0e0] font-mono text-[9px] focus:border-[#00ff88] outline-none mb-2 resize-y"
            placeholder="Enter filter JSON..."
            spellCheck={false}
          />

          <div className="flex gap-2">
            <button
              onClick={applyFilter}
              className="flex-1 py-1.5 bg-[#00ff88] text-[#0a0a0f] rounded text-[10px] font-bold hover:bg-[#00cc6a] transition-colors"
            >
              Apply Filter
            </button>
            <button
              onClick={clearFilter}
              className="flex-1 py-1.5 bg-[#1a1a2e] text-white rounded text-[10px] font-medium hover:bg-[#252540] transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

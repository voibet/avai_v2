import { formatUptime } from '../utils'

interface StatsPanelProps {
  connected: boolean
  stats: {
    fixturesCount: number
    updatesReceived: number
    rate: number
    wsClients: number
    uptime: number
  }
  recentlyUpdatedCount: number
}

export function StatsPanel({ connected, stats, recentlyUpdatedCount }: StatsPanelProps) {
  return (
    <div className="flex gap-3 flex-wrap mb-3 p-2.5 bg-[#12121a] rounded">
      <div className="flex gap-1 items-center">
        <span className="text-[#666]">Status:</span>
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-[#00ff88]' : 'bg-[#ff4444]'}`} />
          <span className="text-[#00ff88] font-semibold text-[10px]">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
      <div className="flex gap-1">
        <span className="text-[#666]">Fixtures:</span>
        <span className="text-[#00ff88] font-semibold">{stats.fixturesCount}</span>
      </div>
      <div className="flex gap-1">
        <span className="text-[#666]">Updates:</span>
        <span className="text-[#00ff88] font-semibold">{stats.updatesReceived}</span>
      </div>
      <div className="flex gap-1">
        <span className="text-[#666]">Rate:</span>
        <span className="text-[#00ff88] font-semibold">{stats.rate.toFixed(1)}/s</span>
      </div>
      <div className="flex gap-1">
        <span className="text-[#666]">Clients:</span>
        <span className="text-[#00ff88] font-semibold">{stats.wsClients}</span>
      </div>
      <div className="flex gap-1">
        <span className="text-[#666]">Uptime:</span>
        <span className="text-[#00ff88] font-semibold">{formatUptime(stats.uptime)}</span>
      </div>
      <div className="flex gap-1">
        <span className="text-[#666]">Active Fixtures:</span>
        <span className="text-[#00ff88] font-semibold">{recentlyUpdatedCount}</span>
      </div>
    </div>
  )
}

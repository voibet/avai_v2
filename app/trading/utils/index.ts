import type { BookmakerOdds, FixtureWithOdds } from '../types'

// Format helpers
export const formatOdds = (odds: number | null | undefined): string => {
  if (odds === undefined || odds === null || odds === 0) return '-'
  return (odds / 1000).toFixed(3)
}

export const formatDateShort = (dateString: string): string => {
  const date = new Date(dateString)
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}`
}

export const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

export const getLatencyClass = (ms: number | undefined): string => {
  if (ms === undefined) return 'text-[#666]'
  if (ms < 1000) return 'text-[#00ff88]'
  if (ms < 2000) return 'text-[#ff9500]'
  return 'text-[#ff4444]'
}

export const calculateBestOdds = (bookmakers?: Record<string, BookmakerOdds>): { bestHome: number; bestDraw: number; bestAway: number } => {
  let bestHome = 0
  let bestDraw = 0
  let bestAway = 0
  if (bookmakers) {
    for (const bookie of Object.values(bookmakers)) {
      if (bookie.x12_h && bookie.x12_h > bestHome) bestHome = bookie.x12_h
      if (bookie.x12_x && bookie.x12_x > bestDraw) bestDraw = bookie.x12_x
      if (bookie.x12_a && bookie.x12_a > bestAway) bestAway = bookie.x12_a
    }
  }
  return { bestHome, bestDraw, bestAway }
}

export const parseFilterPath = (path: string): { bookmaker: string; market: string; line?: number } | null => {
  // Parse paths like: bookmakers.Monaco.x12_a, bookmakers.Pinnacle.fair_x12_a, bookmakers.Veikkaus.ah_a[-1.5]
  const match = path.match(/^bookmakers\.([^.]+)\.(.+)$/)
  if (!match) return null

  const [, bookmaker, marketPath] = match
  let market = marketPath

  // Check for array notation like ah_a[-1.5]
  const lineMatch = marketPath.match(/^(.+)\[([+-]?\d*\.?\d+)\]$/)
  if (lineMatch) {
    const [, marketName, lineStr] = lineMatch
    market = marketName
    return { bookmaker, market, line: parseFloat(lineStr) }
  }

  return { bookmaker, market }
}

export const shouldHighlightOdds = (
  bookmaker: string,
  market: string,
  line?: number,
  filterMatches?: Array<{
    left_operand?: { path: string; value: number }
    right_operand?: { path: string; value: number }
  }>
): boolean => {
  if (!filterMatches) return false

  // Check if any filter match path matches this bookmaker/market/line combination
  return filterMatches.some(match => {
    const leftPath = match.left_operand?.path
    const rightPath = match.right_operand?.path

    const checkPath = (path: string) => {
      const parsed = parseFilterPath(path)
      if (!parsed) return false

      const lineMatch = parsed.line === undefined || line === undefined || Math.abs(parsed.line - line) < 0.01
      return parsed.bookmaker === bookmaker && parsed.market === market && lineMatch
    }

    return (leftPath && checkPath(leftPath)) || (rightPath && checkPath(rightPath))
  })
}

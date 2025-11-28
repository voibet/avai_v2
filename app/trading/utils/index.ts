import type { BookmakerOdds, FixtureWithOdds, ValueInfo, ArbInfo } from '../types'

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

export const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp)
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}:${seconds}`
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

export const parseDropInfo = (
  filterMatches?: Array<{
    left_operand?: { path: string; value: number }
    right_operand?: { path: string; value: number }
    result: number
  }>,
  fixture?: any
): { timestamp: number; market: string; bookmaker: string; droppedOdds: number; historicalOdds: number; dropRatio: number } | null => {
  if (!filterMatches || filterMatches.length === 0 || !fixture) return null

  // Look for a path with drop information (format: bookmakers.Bookie.market@300000ms(t:timestamp))
  for (const match of filterMatches) {
    const leftPath = match.left_operand?.path
    const rightPath = match.right_operand?.path

    // The historical value path has @ 
    const pathWithDrop = leftPath?.includes('@') ? leftPath : rightPath?.includes('@') ? rightPath : null

    if (!pathWithDrop) continue

    // Match pattern: bookmakers.Bookmaker.market@Xms(t:timestamp)
    const dropMatch = pathWithDrop.match(/bookmakers\.([^.]+)\.([^@]+)@\d+ms\(t:(\d+)\)/)
    if (dropMatch) {
      const [, bookmaker, market, timestampStr] = dropMatch
      const timestamp = parseInt(timestampStr, 10)

      // The result is the ratio (historical / current)
      // Note: The operand values contain the ratio, not the actual odds!
      const dropRatio = match.result

      // Get current odds from the fixture
      if (fixture.bookmakers?.[bookmaker]) {
        const bookieData = fixture.bookmakers[bookmaker]
        const currentOdds = bookieData[market]

        if (currentOdds) {
          // Calculate historical odds: historical = current * ratio
          const historicalOdds = currentOdds * dropRatio

          return {
            timestamp,
            market,
            bookmaker,
            droppedOdds: currentOdds,
            historicalOdds,
            dropRatio
          }
        }
      }
    }
  }

  return null
}

export const parseValueInfo = (
  filterMatches?: Array<{
    left_operand?: { path: string; value: number }
    right_operand?: { path: string; value: number }
    result: number
    op: string
  }>,
  fixture?: any
): ValueInfo | null => {
  if (!filterMatches || filterMatches.length === 0 || !fixture) return null

  // Look for a match that indicates value (result > 1.00, no drop info)
  for (const match of filterMatches) {
    const leftPath = match.left_operand?.path
    const rightPath = match.right_operand?.path

    // Skip if it's a drop (has @)
    if (leftPath?.includes('@') || rightPath?.includes('@')) continue

    // Check if result indicates value (e.g. > 1.00)
    // We assume value bets are typically ratios like 1.05, not raw odds like 2000
    if (match.result > 1.00 && match.result < 2.0) {
      const path = leftPath || rightPath
      if (!path) continue

      const parsed = parseFilterPath(path)
      if (parsed) {
        const { bookmaker, market } = parsed

        // Get current odds from fixture
        let currentOdds = 0
        if (fixture.bookmakers?.[bookmaker]) {
          const bookieData = fixture.bookmakers[bookmaker]

          // Check if we have a specific line
          if (parsed.line !== undefined) {
            // Determine lines key (ah_lines or ou_lines)
            const isAh = market.includes('ah')
            const isOu = market.includes('ou')

            if (isAh || isOu) {
              const linesKey = isAh ? 'ah_lines' : 'ou_lines'
              const lines = bookieData[linesKey]

              if (Array.isArray(lines)) {
                // Find index of the line (allow small float tolerance)
                const index = lines.findIndex((l: number) => Math.abs(l - parsed.line!) < 0.01)

                if (index !== -1) {
                  const oddsArray = bookieData[market]
                  if (Array.isArray(oddsArray)) {
                    currentOdds = oddsArray[index]
                  }
                }
              }
            } else {
              // Fallback for non-array markets or if logic fails
              currentOdds = bookieData[market]
            }
          } else {
            // Scalar market (x12)
            currentOdds = bookieData[market]
          }
        }

        // If we extracted an array instead of a number (shouldn't happen with above logic but safety check)
        if (Array.isArray(currentOdds)) {
          // Try to use the value from the match trace if available and valid
          if (match.left_operand?.value && match.left_operand.value > 100) {
            currentOdds = match.left_operand.value
          } else {
            currentOdds = 0 // Invalid
          }
        }


        // Calculate fair odds if we have current odds and ratio
        // Ratio = Odds / FairOdds  =>  FairOdds = Odds / Ratio
        const fairOdds = currentOdds > 0 ? currentOdds / match.result : undefined

        return {
          market,
          bookmaker,
          line: parsed.line,
          valueRatio: match.result,
          odds: currentOdds,
          fairOdds
        }
      }
    }
  }

  return null
}

export const parseArbInfo = (
  filterMatches?: Array<{
    left_operand?: { path: string; value: number }
    right_operand?: { path: string; value: number }
    result: number
    op: string
    threshold?: number
  }>
): ArbInfo | null => {
  if (!filterMatches || filterMatches.length === 0) return null

  // Look for arb match (op: lt, threshold: 1000)
  for (const match of filterMatches) {
    if (match.op === 'lt' && match.threshold === 1000) {
      const result = match.result
      // Calculate profit: (1000 - result) / result * 100
      const profit = ((1000 - result) / result) * 100

      let market = 'x12' // Default to 1x2 if literal
      let line: number | undefined

      const path = match.left_operand?.path

      if (path && path !== 'literal') {
        // Try to parse market and line from path like "ah_h[0.5]"
        // Note: The path here might be simplified compared to full bookmaker paths
        const lineMatch = path.match(/^([a-z_]+)\[([+-]?\d*\.?\d+)\]$/)
        if (lineMatch) {
          const [, marketName, lineStr] = lineMatch
          // If market is ah_h or ah_a, just call it 'ah'
          market = marketName.replace(/_[haou]$/, '')
          line = parseFloat(lineStr)
        } else {
          market = path
        }
      }

      return {
        market,
        line,
        profit,
        probabilitySum: result
      }
    }
  }

  return null
}



export interface Fixture {
  id: number
  home_team_id: number
  home_team_name: string
  away_team_id: number
  away_team_name: string
  date: string
  league_id: number
  league_name: string
  league_country: string
  season: number
  round: string
  status_short: string
}

export interface BookmakerOdds {
  bookie_id: number
  decimals: number
  x12_h: number | null
  x12_x: number | null
  x12_a: number | null
  fair_x12_h: number | null
  fair_x12_x: number | null
  fair_x12_a: number | null
  ah_lines: number[]
  ah_h: number[]
  ah_a: number[]
  fair_ah_h: number[]
  fair_ah_a: number[]
  ou_lines: number[]
  ou_o: number[]
  ou_u: number[]
  fair_ou_o: number[]
  fair_ou_u: number[]
  timestamp: number
}

export interface WsMessage {
  type: string
  fixture_id: number
  timestamp: number
  start: number
  end: number
  bookmakers: Record<string, BookmakerOdds>
  filter_matches?: Array<{
    op: string
    threshold: number
    result: number
    matched: boolean
    calculation_op?: string
    left_operand?: { path: string; value: number }
    right_operand?: { path: string; value: number }
  }>
}

export interface FixtureWithOdds extends Fixture {
  bookmakers?: Record<string, BookmakerOdds>
  lastUpdate?: number
  latency?: number
  bestHome?: number
  bestDraw?: number
  bestAway?: number
  filter_matches?: Array<{
    op: string
    threshold: number
    result: number
    matched: boolean
    calculation_op?: string
    left_operand?: { path: string; value: number }
    right_operand?: { path: string; value: number }
  }>
}

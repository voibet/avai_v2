'use client'

import React, { useState, useEffect } from 'react'

interface FixtureEditModalProps {
  fixture: any
  onClose: () => void
  onUpdate: () => void
  onDelete?: () => void
}

export default function FixtureEditModal({ fixture, onClose, onUpdate, onDelete }: FixtureEditModalProps) {
  const [formData, setFormData] = useState<any>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [bookies, setBookies] = useState<string[]>([])
  const [oddsData, setOddsData] = useState({
    bookie: '',
    opening_x12_home: '',
    opening_x12_draw: '',
    opening_x12_away: '',
    opening_ou25_over: '',
    opening_ou25_under: '',
    closing_x12_home: '',
    closing_x12_draw: '',
    closing_x12_away: '',
    closing_ou25_over: '',
    closing_ou25_under: ''
  })
  const [adjustmentData, setAdjustmentData] = useState({
    homeAdjustment: '',
    drawAdjustment: '',
    awayAdjustment: '',
    reason: ''
  })

  useEffect(() => {
    // Fetch team mappings for both teams
    const fetchTeamMappings = async () => {
      try {
        const response = await fetch(`/api/admin/fixtures/${fixture.id}/mappings`)
        if (response.ok) {
          const data = await response.json()
          setFormData((prev: any) => ({
            ...prev,
            home_team_mappings: JSON.stringify(data.home_mappings || [], null, 2),
            away_team_mappings: JSON.stringify(data.away_mappings || [], null, 2)
          }))
        }
      } catch (error) {
        console.error('Failed to fetch team mappings:', error)
      }
    }

    // Fetch prediction adjustments
    const fetchAdjustments = async () => {
      try {
        const response = await fetch(`/api/fixtures/${fixture.id}/adjustments`)
        if (response.ok) {
          const data = await response.json()
          if (data.adjustments) {
            setAdjustmentData({
              homeAdjustment: data.adjustments.home_adjustment ?? '',
              drawAdjustment: data.adjustments.draw_adjustment ?? '',
              awayAdjustment: data.adjustments.away_adjustment ?? '',
              reason: data.adjustments.adjustment_reason ?? ''
            })
          }
        }
      } catch (error) {
        console.error('Failed to fetch adjustments:', error)
      }
    }

    // Initialize form data with fixture data
    // Use null check instead of falsy check to preserve 0 values
    setFormData({
      referee: fixture.referee ?? '',
      timestamp: fixture.timestamp ?? '',
      date: fixture.date ? (() => {
        // Convert UTC date from database to local datetime-local format
        // fixture.date is stored as UTC, datetime-local input expects local time
        const utcDate = new Date(fixture.date);
        // Format as local time for datetime-local input (YYYY-MM-DDTHH:MM)
        const year = utcDate.getFullYear();
        const month = String(utcDate.getMonth() + 1).padStart(2, '0');
        const day = String(utcDate.getDate()).padStart(2, '0');
        const hours = String(utcDate.getHours()).padStart(2, '0');
        const minutes = String(utcDate.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
      })() : '',
      venue_name: fixture.venue_name ?? '',
      status_long: fixture.status_long ?? '',
      status_short: fixture.status_short ?? '',
      home_team_id: fixture.home_team_id ?? '',
      home_team_name: fixture.home_team_name ?? '',
      home_country: fixture.home_country ?? '',
      away_team_id: fixture.away_team_id ?? '',
      away_team_name: fixture.away_team_name ?? '',
      away_country: fixture.away_country ?? '',
      xg_home: fixture.xg_home ?? '',
      xg_away: fixture.xg_away ?? '',
      goals_home: fixture.goals_home ?? '',
      goals_away: fixture.goals_away ?? '',
      score_halftime_home: fixture.score_halftime_home ?? '',
      score_halftime_away: fixture.score_halftime_away ?? '',
      score_fulltime_home: fixture.score_fulltime_home ?? '',
      score_fulltime_away: fixture.score_fulltime_away ?? '',
      score_extratime_home: fixture.score_extratime_home ?? '',
      score_extratime_away: fixture.score_extratime_away ?? '',
      score_penalty_home: fixture.score_penalty_home ?? '',
      score_penalty_away: fixture.score_penalty_away ?? '',
      league_id: fixture.league_id ?? '',
      league_name: fixture.league_name ?? '',
      league_country: fixture.league_country ?? '',
      season: fixture.season ?? '',
      round: fixture.round ?? '',
      home_team_mappings: '[]',
      away_team_mappings: '[]'
    })

    // Fetch available bookies
    const fetchBookies = async () => {
      try {
        const response = await fetch('/api/bookies')
        if (response.ok) {
          const data = await response.json()
          setBookies(data.bookies || [])
        }
      } catch (error) {
        console.error('Failed to fetch bookies:', error)
      }
    }

    fetchTeamMappings()
    fetchBookies()
    fetchAdjustments()
  }, [fixture])

  // Helper function to convert line-by-line text to JSON array
  const textToJsonArray = (text: string): string => {
    if (!text.trim()) return '[]'
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
    return JSON.stringify(lines, null, 2)
  }

  // Helper function to convert JSON array to line-by-line text
  const jsonArrayToText = (jsonString: string): string => {
    try {
      const array = JSON.parse(jsonString)
      if (Array.isArray(array)) {
        return array.join('\n')
      }
      return ''
    } catch {
      return ''
    }
  }

  const handleInputChange = (field: string, value: any) => {
    // Special handling for team mappings - convert line-by-line input to JSON array
    if (field === 'home_team_mappings' || field === 'away_team_mappings') {
      value = textToJsonArray(value)
    }

    setFormData((prev: any) => ({
      ...prev,
      [field]: value
    }))
  }

  const handleOddsChange = (field: string, value: any) => {
    setOddsData((prev: any) => ({
      ...prev,
      [field]: value
    }))
  }

  const hasOddsData = (odds: typeof oddsData) => {
    return Object.entries(odds).some(([key, value]) =>
      key !== 'bookie' && value !== '' && value !== null && value !== undefined
    )
  }

  const handleAdjustmentChange = (field: string, value: any) => {
    setAdjustmentData((prev: any) => ({
      ...prev,
      [field]: value
    }))
  }

  const hasAdjustmentData = (adjustments: typeof adjustmentData) => {
    return Object.entries(adjustments).some(([key, value]) =>
      key !== 'reason' && value !== '' && value !== null && value !== undefined
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      // Convert empty strings to null for nullable fields, and convert numeric strings to numbers
      const submitData = Object.entries(formData).reduce((acc, [key, value]) => {
        if (value === '') {
          acc[key] = null
        } else if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
          // Convert numeric strings to numbers, but keep '0' as 0, not null
          acc[key] = Number(value)
        } else {
          acc[key] = value
        }
        return acc
      }, {} as any)

      const response = await fetch(`/api/fixtures/${fixture.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(submitData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update fixture')
      }

      // Submit odds data if provided
      if (oddsData.bookie && (hasOddsData(oddsData))) {
        try {
          const oddsResponse = await fetch(`/api/odds?fixtureId=${fixture.id}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              ...oddsData,
              fixture_timestamp: fixture.timestamp
            })
          })

          if (!oddsResponse.ok) {
            const oddsErrorData = await oddsResponse.json()
            console.warn('Failed to save odds data:', oddsErrorData.error)
            // Don't throw error for odds - fixture update succeeded
          }
        } catch (oddsError) {
          console.warn('Failed to save odds data:', oddsError)
          // Don't throw error for odds - fixture update succeeded
        }
      }

      // Submit adjustment data if provided
      if (hasAdjustmentData(adjustmentData)) {
        try {
          const adjustmentResponse = await fetch(`/api/fixtures/${fixture.id}/adjustments`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              ...adjustmentData,
              fixture_timestamp: fixture.timestamp
            })
          })

          if (!adjustmentResponse.ok) {
            const adjustmentErrorData = await adjustmentResponse.json()
            console.warn('Failed to save adjustment data:', adjustmentErrorData.error)
            // Don't throw error for adjustments - fixture update succeeded
          }
        } catch (adjustmentError) {
          console.warn('Failed to save adjustment data:', adjustmentError)
          // Don't throw error for adjustments - fixture update succeeded
        }
      }

      setSuccess(true)
      setTimeout(() => {
        onUpdate()
        onClose()
      }, 1500)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`/api/fixtures/${fixture.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete fixture')
      }

      setSuccess(true)
      setTimeout(() => {
        if (onDelete) onDelete()
        onUpdate()
        onClose()
      }, 1500)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
      setShowDeleteConfirm(false)
    }
  }

  const inputClasses = "w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white text-sm font-mono rounded focus:outline-none focus:border-blue-400"
  const labelClasses = "block text-sm font-mono text-gray-300 mb-1"

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-600 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-bold text-white font-mono">
                EDIT FIXTURE: {fixture.home_team_name} vs {fixture.away_team_name}
              </h2>
              <p className="text-sm text-gray-400 font-mono mt-1">
                Fixture ID: {fixture.id}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>

          {error && (
            <div className="mb-3 p-3 bg-red-900/50 border border-red-600 rounded text-red-200 text-sm font-mono">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-3 p-3 bg-green-900/50 border border-green-600 rounded text-green-200 text-sm font-mono">
              Fixture updated successfully! Refreshing...
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClasses}>Date & Time</label>
                <input
                  type="datetime-local"
                  value={formData.date}
                  onChange={(e) => handleInputChange('date', e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className={labelClasses}>Timestamp</label>
                <input
                  type="number"
                  value={formData.timestamp}
                  onChange={(e) => handleInputChange('timestamp', e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>

            {/* Venue and Referee */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClasses}>Venue</label>
                <input
                  type="text"
                  value={formData.venue_name}
                  onChange={(e) => handleInputChange('venue_name', e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className={labelClasses}>Referee</label>
                <input
                  type="text"
                  value={formData.referee}
                  onChange={(e) => handleInputChange('referee', e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>

            {/* Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClasses}>Status Short</label>
                <input
                  type="text"
                  value={formData.status_short}
                  onChange={(e) => handleInputChange('status_short', e.target.value)}
                  className={inputClasses}
                  placeholder="FT, HT, LIVE, etc."
                />
              </div>
              <div>
                <label className={labelClasses}>Status Long</label>
                <input
                  type="text"
                  value={formData.status_long}
                  onChange={(e) => handleInputChange('status_long', e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>

            {/* League Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelClasses}>League ID</label>
                <input
                  type="number"
                  value={formData.league_id}
                  onChange={(e) => handleInputChange('league_id', e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className={labelClasses}>League Name</label>
                <input
                  type="text"
                  value={formData.league_name}
                  onChange={(e) => handleInputChange('league_name', e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className={labelClasses}>League Country</label>
                <input
                  type="text"
                  value={formData.league_country}
                  onChange={(e) => handleInputChange('league_country', e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>

            {/* Season and Round */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClasses}>Season</label>
                <input
                  type="number"
                  value={formData.season}
                  onChange={(e) => handleInputChange('season', e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className={labelClasses}>Round</label>
                <input
                  type="text"
                  value={formData.round}
                  onChange={(e) => handleInputChange('round', e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>

            {/* Teams */}
            <div className="border-t border-gray-600 pt-3">
              <h3 className="text-lg font-bold text-white font-mono mb-3">TEAMS</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Home Team */}
                <div>
                  <h4 className="text-md font-bold text-white font-mono mb-2">HOME TEAM</h4>
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className={labelClasses}>Team ID</label>
                        <input
                          type="number"
                          value={formData.home_team_id}
                          onChange={(e) => handleInputChange('home_team_id', e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                      <div>
                        <label className={labelClasses}>Team Name</label>
                        <input
                          type="text"
                          value={formData.home_team_name}
                          onChange={(e) => handleInputChange('home_team_name', e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                      <div>
                        <label className={labelClasses}>Country</label>
                        <input
                          type="text"
                          value={formData.home_country}
                          onChange={(e) => handleInputChange('home_country', e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClasses}>Team Mappings (one per line)</label>
                      <textarea
                        value={jsonArrayToText(formData.home_team_mappings)}
                        onChange={(e) => handleInputChange('home_team_mappings', e.target.value)}
                        className={`${inputClasses} font-mono text-xs h-24 resize-none`}
                        placeholder={`Real Madrid${'\n'}Real Madrid CF${'\n'}Real Madrid Club de Fútbol`}
                      />
                    </div>
                  </div>
                </div>

                {/* Away Team */}
                <div>
                  <h4 className="text-md font-bold text-white font-mono mb-2">AWAY TEAM</h4>
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className={labelClasses}>Team ID</label>
                        <input
                          type="number"
                          value={formData.away_team_id}
                          onChange={(e) => handleInputChange('away_team_id', e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                      <div>
                        <label className={labelClasses}>Team Name</label>
                        <input
                          type="text"
                          value={formData.away_team_name}
                          onChange={(e) => handleInputChange('away_team_name', e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                      <div>
                        <label className={labelClasses}>Country</label>
                        <input
                          type="text"
                          value={formData.away_country}
                          onChange={(e) => handleInputChange('away_country', e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClasses}>Team Mappings (one per line)</label>
                      <textarea
                        value={jsonArrayToText(formData.away_team_mappings)}
                        onChange={(e) => handleInputChange('away_team_mappings', e.target.value)}
                        className={`${inputClasses} font-mono text-xs h-24 resize-none`}
                        placeholder={`Real Madrid${'\n'}Real Madrid CF${'\n'}Real Madrid Club de Fútbol`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Scores */}
            <div className="border-t border-gray-600 pt-3">
              <h3 className="text-lg font-bold text-white font-mono mb-3">SCORES</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className={labelClasses}>Home Goals</label>
                  <input
                    type="number"
                    value={formData.goals_home}
                    onChange={(e) => handleInputChange('goals_home', e.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label className={labelClasses}>Away Goals</label>
                  <input
                    type="number"
                    value={formData.goals_away}
                    onChange={(e) => handleInputChange('goals_away', e.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label className={labelClasses}>Home XG</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.xg_home}
                    onChange={(e) => handleInputChange('xg_home', e.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label className={labelClasses}>Away XG</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.xg_away}
                    onChange={(e) => handleInputChange('xg_away', e.target.value)}
                    className={inputClasses}
                  />
                </div>
              </div>
            </div>

            {/* Half Time and Full Time Scores */}
            <div className="border-t border-gray-600 pt-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Half Time Scores */}
                <div>
                  <h3 className="text-lg font-bold text-white font-mono mb-3">HALF TIME SCORES</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClasses}>Home Half Time</label>
                      <input
                        type="number"
                        value={formData.score_halftime_home}
                        onChange={(e) => handleInputChange('score_halftime_home', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Away Half Time</label>
                      <input
                        type="number"
                        value={formData.score_halftime_away}
                        onChange={(e) => handleInputChange('score_halftime_away', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                  </div>
                </div>

                {/* Full Time Scores */}
                <div>
                  <h3 className="text-lg font-bold text-white font-mono mb-3">FULL TIME SCORES</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClasses}>Home Full Time</label>
                      <input
                        type="number"
                        value={formData.score_fulltime_home}
                        onChange={(e) => handleInputChange('score_fulltime_home', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Away Full Time</label>
                      <input
                        type="number"
                        value={formData.score_fulltime_away}
                        onChange={(e) => handleInputChange('score_fulltime_away', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Extra Time and Penalty Scores */}
            <div className="border-t border-gray-600 pt-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Extra Time Scores */}
                <div>
                  <h3 className="text-lg font-bold text-white font-mono mb-3">EXTRA TIME SCORES</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClasses}>Home Extra Time</label>
                      <input
                        type="number"
                        value={formData.score_extratime_home}
                        onChange={(e) => handleInputChange('score_extratime_home', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Away Extra Time</label>
                      <input
                        type="number"
                        value={formData.score_extratime_away}
                        onChange={(e) => handleInputChange('score_extratime_away', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                  </div>
                </div>

                {/* Penalty Scores */}
                <div>
                  <h3 className="text-lg font-bold text-white font-mono mb-3">PENALTY SCORES</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClasses}>Home Penalties</label>
                      <input
                        type="number"
                        value={formData.score_penalty_home}
                        onChange={(e) => handleInputChange('score_penalty_home', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Away Penalties</label>
                      <input
                        type="number"
                        value={formData.score_penalty_away}
                        onChange={(e) => handleInputChange('score_penalty_away', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Prediction Adjustments */}
            <div className="border-t border-gray-600 pt-3">
              <h3 className="text-lg font-bold text-white font-mono mb-3">PREDICTION ADJUSTMENTS</h3>
              <p className="text-xs text-gray-400 font-mono mb-4">
                Adjust model predictions. Triggers MLP prediction chain when saved.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className={labelClasses}>Home Adjustment</label>
                  <input
                    type="number"
                    step="0.01"
                    value={adjustmentData.homeAdjustment}
                    onChange={(e) => handleAdjustmentChange('homeAdjustment', e.target.value)}
                    className={inputClasses}
                    placeholder="e.g., 1.1 for +10% boost"
                  />
                  <p className="text-xs text-gray-500 font-mono mt-1">Multiplier (default: 1.0)</p>
                </div>
                <div>
                  <label className={labelClasses}>Draw/Rho Adjustment</label>
                  <input
                    type="number"
                    step="0.01"
                    value={adjustmentData.drawAdjustment}
                    onChange={(e) => handleAdjustmentChange('drawAdjustment', e.target.value)}
                    className={inputClasses}
                    placeholder="e.g., -0.05 for rho adjustment"
                  />
                  <p className="text-xs text-gray-500 font-mono mt-1">Rho adjustment (higher = less correlation)</p>
                </div>
                <div>
                  <label className={labelClasses}>Away Adjustment</label>
                  <input
                    type="number"
                    step="0.01"
                    value={adjustmentData.awayAdjustment}
                    onChange={(e) => handleAdjustmentChange('awayAdjustment', e.target.value)}
                    className={inputClasses}
                    placeholder="e.g., 0.95 for -5% penalty"
                  />
                  <p className="text-xs text-gray-500 font-mono mt-1">Multiplier (default: 1.0)</p>
                </div>
              </div>
              <div>
                <label className={labelClasses}>Adjustment Reason</label>
                <textarea
                  value={adjustmentData.reason}
                  onChange={(e) => handleAdjustmentChange('reason', e.target.value)}
                  className={`${inputClasses} font-mono text-xs h-20 resize-none`}
                  placeholder="Explain why you're adjusting these values (e.g., key player injuries, weather conditions, etc.)"
                />
              </div>
            </div>

            {/* Odds Data */}
            <div className="border-t border-gray-600 pt-3">
              <h3 className="text-lg font-bold text-white font-mono mb-3">ADD ODDS DATA</h3>

              {/* Bookie Selector */}
              <div className="mb-3">
                <label className={labelClasses}>Bookie</label>
                <select
                  value={oddsData.bookie}
                  onChange={(e) => handleOddsChange('bookie', e.target.value)}
                  className={inputClasses}
                >
                  <option value="">Select a bookie...</option>
                  {bookies.map((bookie) => (
                    <option key={bookie} value={bookie}>
                      {bookie}
                    </option>
                  ))}
                </select>
                {!oddsData.bookie && (
                  <p className="text-xs text-gray-400 font-mono mt-1">
                    Please select a bookie first to enable odds input
                  </p>
                )}
              </div>

              {/* Opening Odds */}
              <div className="mb-4">
                <h4 className="text-md font-bold text-white font-mono mb-2">OPENING ODDS (5 days before match)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* X12 Opening */}
                  <div>
                    <h5 className="text-sm font-bold text-gray-300 font-mono mb-1">X12 Odds</h5>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Home</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.opening_x12_home}
                          onChange={(e) => handleOddsChange('opening_x12_home', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="1.65"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Draw</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.opening_x12_draw}
                          onChange={(e) => handleOddsChange('opening_x12_draw', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="3.95"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Away</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.opening_x12_away}
                          onChange={(e) => handleOddsChange('opening_x12_away', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="4.80"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                    </div>
                  </div>

                  {/* OU25 Opening */}
                  <div>
                    <h5 className="text-sm font-bold text-gray-300 font-mono mb-1">OU 2.5 Odds</h5>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Over</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.opening_ou25_over}
                          onChange={(e) => handleOddsChange('opening_ou25_over', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="1.80"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Under</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.opening_ou25_under}
                          onChange={(e) => handleOddsChange('opening_ou25_under', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="2.00"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Closing Odds */}
              <div>
                <h4 className="text-md font-bold text-white font-mono mb-2">CLOSING ODDS (match start time)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* X12 Closing */}
                  <div>
                    <h5 className="text-sm font-bold text-gray-300 font-mono mb-1">X12 Odds</h5>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Home</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.closing_x12_home}
                          onChange={(e) => handleOddsChange('closing_x12_home', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="1.69"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Draw</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.closing_x12_draw}
                          onChange={(e) => handleOddsChange('closing_x12_draw', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="3.90"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Away</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.closing_x12_away}
                          onChange={(e) => handleOddsChange('closing_x12_away', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="4.60"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                    </div>
                  </div>

                  {/* OU25 Closing */}
                  <div>
                    <h5 className="text-sm font-bold text-gray-300 font-mono mb-1">OU 2.5 Odds</h5>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Over</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.closing_ou25_over}
                          onChange={(e) => handleOddsChange('closing_ou25_over', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="1.85"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">Under</label>
                        <input
                          type="number"
                          step="0.01"
                          value={oddsData.closing_ou25_under}
                          onChange={(e) => handleOddsChange('closing_ou25_under', e.target.value)}
                          className={`${inputClasses} text-xs ${!oddsData.bookie ? 'opacity-50 cursor-not-allowed' : ''}`}
                          placeholder="1.95"
                          disabled={!oddsData.bookie}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-between pt-4 border-t border-gray-600">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-mono rounded transition-colors"
                disabled={loading}
              >
                DELETE FIXTURE
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white text-sm font-mono rounded transition-colors"
                  disabled={loading}
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono rounded transition-colors disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? 'UPDATING...' : 'UPDATE FIXTURE'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-60">
          <div className="bg-gray-800 border-2 border-red-600 rounded-lg p-4 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-red-400 font-mono mb-3">
              CONFIRM DELETION
            </h3>
            <p className="text-gray-300 text-sm font-mono mb-3">
              Are you sure you want to delete this fixture?
            </p>
            <p className="text-yellow-400 text-xs font-mono mb-4">
              This will permanently delete:
              <br />• The fixture: {fixture.home_team_name} vs {fixture.away_team_name}
              <br />• All associated odds data
              <br />• All associated stats data
              <br />
              <br />This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white text-sm font-mono rounded transition-colors"
                disabled={loading}
              >
                CANCEL
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-mono rounded transition-colors disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'DELETING...' : 'DELETE FIXTURE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import React, { useState, useEffect } from 'react'
import { Fixture } from '../../types/database'

interface FixtureEditModalProps {
  fixture: any
  onClose: () => void
  onUpdate: () => void
}

export default function FixtureEditModal({ fixture, onClose, onUpdate }: FixtureEditModalProps) {
  const [formData, setFormData] = useState<any>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    // Initialize form data with fixture data
    setFormData({
      referee: fixture.referee || '',
      timestamp: fixture.timestamp || '',
      date: fixture.date ? new Date(fixture.date).toISOString().slice(0, 16) : '',
      venue_name: fixture.venue_name || '',
      status_long: fixture.status_long || '',
      status_short: fixture.status_short || '',
      home_team_id: fixture.home_team_id || '',
      home_team_name: fixture.home_team_name || '',
      home_country: fixture.home_country || '',
      away_team_id: fixture.away_team_id || '',
      away_team_name: fixture.away_team_name || '',
      away_country: fixture.away_country || '',
      xg_home: fixture.xg_home || '',
      xg_away: fixture.xg_away || '',
      goals_home: fixture.goals_home || '',
      goals_away: fixture.goals_away || '',
      score_halftime_home: fixture.score_halftime_home || '',
      score_halftime_away: fixture.score_halftime_away || '',
      score_fulltime_home: fixture.score_fulltime_home || '',
      score_fulltime_away: fixture.score_fulltime_away || '',
      score_extratime_home: fixture.score_extratime_home || '',
      score_extratime_away: fixture.score_extratime_away || '',
      score_penalty_home: fixture.score_penalty_home || '',
      score_penalty_away: fixture.score_penalty_away || '',
      league_id: fixture.league_id || '',
      league_name: fixture.league_name || '',
      league_country: fixture.league_country || '',
      season: fixture.season || '',
      round: fixture.round || ''
    })
  }, [fixture])

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev: any) => ({
      ...prev,
      [field]: value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      // Convert empty strings to null for nullable fields
      const submitData = Object.entries(formData).reduce((acc, [key, value]) => {
        if (value === '') {
          acc[key] = null
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

  const inputClasses = "w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white text-sm font-mono rounded focus:outline-none focus:border-blue-400"
  const labelClasses = "block text-sm font-mono text-gray-300 mb-1"

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-600 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white font-mono">
              EDIT FIXTURE: {fixture.home_team_name} vs {fixture.away_team_name}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-xl"
            >
              ×
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-600 rounded text-red-200 text-sm font-mono">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-900/50 border border-green-600 rounded text-green-200 text-sm font-mono">
              Fixture updated successfully! Refreshing...
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            {/* Home Team */}
            <div className="border-t border-gray-600 pt-4">
              <h3 className="text-lg font-bold text-white font-mono mb-4">HOME TEAM</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            </div>

            {/* Away Team */}
            <div className="border-t border-gray-600 pt-4">
              <h3 className="text-lg font-bold text-white font-mono mb-4">AWAY TEAM</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            </div>

            {/* Scores */}
            <div className="border-t border-gray-600 pt-4">
              <h3 className="text-lg font-bold text-white font-mono mb-4">SCORES</h3>
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

            {/* Half Time Scores */}
            <div className="border-t border-gray-600 pt-4">
              <h3 className="text-lg font-bold text-white font-mono mb-4">HALF TIME SCORES</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="border-t border-gray-600 pt-4">
              <h3 className="text-lg font-bold text-white font-mono mb-4">FULL TIME SCORES</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            {/* Extra Time Scores */}
            <div className="border-t border-gray-600 pt-4">
              <h3 className="text-lg font-bold text-white font-mono mb-4">EXTRA TIME SCORES</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="border-t border-gray-600 pt-4">
              <h3 className="text-lg font-bold text-white font-mono mb-4">PENALTY SCORES</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            {/* Action Buttons */}
            <div className="flex justify-end gap-4 pt-6 border-t border-gray-600">
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
          </form>
        </div>
      </div>
    </div>
  )
}

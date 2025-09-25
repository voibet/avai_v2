'use client';

import { useState, useEffect } from 'react';
import DataTable, { Column } from '../../components/ui/data-table';
import {
  TabNavigation,
  SearchBar,
  XGSourceModal,
  DeleteConfirmationModal,
  ProgressPanel,
  ResultsPanel
} from '../../components/admin';
import { League } from '../../types/database';


type AdminTab = 'fetch-fixtures' | 'add-leagues';

interface AvailableLeague {
  id: number;
  name: string;
  country: string;
  seasons: string[];
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('fetch-fixtures');
  const [leagues, setLeagues] = useState<League[]>([]);
  const [availableLeagues, setAvailableLeagues] = useState<AvailableLeague[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<Record<string, Set<string>>>({});
  const [selectedLeagues, setSelectedLeagues] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<{ league: string; current: number; total: number; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [xgSourceModal, setXGSourceModal] = useState<{
    isOpen: boolean;
    league: League | null;
    selectedSeason: string;
    availableRounds: string[];
    selectedRounds: Set<string>;
    customRoundName: string;
    xgSourceUrl: string;
  }>({
    isOpen: false,
    league: null,
    selectedSeason: '',
    availableRounds: [],
    selectedRounds: new Set(),
    customRoundName: '',
    xgSourceUrl: 'NATIVE'
  });

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    league: League | null;
  }>({
    isOpen: false,
    league: null
  });

  // Load leagues data
  useEffect(() => {
    if (activeTab === 'fetch-fixtures') {
      loadExistingLeagues();
      } else {
        loadAvailableLeagues();
        // Clear selections when switching tabs
        setSelectedSeasons({});
        setSelectedLeagues(new Set());
      }
    // Clear search when switching tabs
    setSearchQuery('');
  }, [activeTab]);

  const loadExistingLeagues = async () => {
    try {
      const response = await fetch('/api/admin/leagues');
      if (response.ok) {
        const data = await response.json();
        setLeagues(data.leagues || []);

        // Initialize selected seasons with current seasons
        const initialSelected: Record<string, Set<string>> = {};
        data.leagues?.forEach((league: League) => {
          const currentSeasons = Object.entries(league.seasons)
            .filter(([, seasonData]) => seasonData.current)
            .map(([season]) => season);
          if (currentSeasons.length > 0) {
            initialSelected[league.id] = new Set(currentSeasons);
          }
        });
        setSelectedSeasons(initialSelected);
      }
    } catch (error) {
      console.error('Failed to load leagues:', error);
    }
  };

  const loadAvailableLeagues = async () => {
    try {
      const response = await fetch('/api/admin/search-leagues');
      if (response.ok) {
        const data = await response.json();
        setAvailableLeagues(data.leagues || []);
      }
    } catch (error) {
      console.error('Failed to load available leagues:', error);
    }
  };

  // Note: League expansion is now handled by the DataTable component's expandable functionality

  const toggleSeasonSelection = (leagueId: number, season: string) => {
    const key = `${leagueId}`;
    const newSelected = { ...selectedSeasons };
    if (!newSelected[key]) {
      newSelected[key] = new Set();
    }

    if (newSelected[key].has(season)) {
      newSelected[key].delete(season);
    } else {
      newSelected[key].add(season);
    }

    setSelectedSeasons(newSelected);
  };


  const fetchXGForLeague = async (leagueId: number, leagueName: string) => {
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      const response = await fetch('/api/admin/fetch-xg-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'league', leagueId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle Server-Sent Events stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix

              if (data.type === 'progress') {
                setProgress({
                  league: leagueName,
                  current: data.current,
                  total: data.total,
                  message: data.message
                });
              } else if (data.type === 'complete') {
                setResult({
                  success: data.success !== false,
                  message: data.message || 'XG fetch completed successfully'
                });
                setProgress(null);
              } else if (data.type === 'error') {
                setResult({
                  success: false,
                  message: data.message
                });
                setProgress(null);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', line, parseError);
            }
          }
        }
      }

    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred'
      });
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchXGForAllLeagues = async () => {
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      const response = await fetch('/api/admin/fetch-xg-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'all' }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle Server-Sent Events stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix

              if (data.type === 'progress') {
                setProgress({
                  league: data.message,
                  current: data.current,
                  total: data.total,
                  message: data.message
                });
              } else if (data.type === 'complete') {
                setResult({
                  success: data.success !== false,
                  message: data.message || 'XG fetch completed successfully'
                });
                setProgress(null);
              } else if (data.type === 'error') {
                setResult({
                  success: false,
                  message: data.message
                });
                setProgress(null);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', line, parseError);
            }
          }
        }
      }

    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred'
      });
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  };

  const executeAction = async () => {
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      let endpoint = '';
      let body = {};

      if (activeTab === 'fetch-fixtures') {
        endpoint = '/api/admin/fetch-fixtures';
        // Convert selectedSeasons from Sets to arrays for the API
        const seasonsToSend: Record<string, string[]> = {};
        Object.entries(selectedSeasons).forEach(([leagueId, seasons]) => {
          seasonsToSend[leagueId] = Array.from(seasons);
        });
        body = { selectedSeasons: seasonsToSend };
      } else {
        endpoint = '/api/admin/add-leagues';
        // For add-leagues, we need both selected leagues and their seasons
        const selectedLeagueIds = Array.from(selectedLeagues);
        const seasonsToSend: Record<string, string[]> = {};

        // For selected leagues, if no specific seasons are selected, select all seasons
        selectedLeagueIds.forEach(leagueId => {
          const leagueIdStr = leagueId.toString();
          if (selectedSeasons[leagueIdStr] && selectedSeasons[leagueIdStr].size > 0) {
            // Use specifically selected seasons
            seasonsToSend[leagueIdStr] = Array.from(selectedSeasons[leagueIdStr]);
          } else {
            // Select all seasons for this league
            const league = availableLeagues.find(l => l.id === leagueId);
            if (league) {
              seasonsToSend[leagueIdStr] = league.seasons;
            }
          }
        });

        body = { selectedLeagues: selectedLeagueIds, selectedSeasons: seasonsToSend };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (activeTab === 'fetch-fixtures') {
        // Handle Server-Sent Events stream for fetch-fixtures
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('Failed to get response reader');
        }

        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix

                if (data.type === 'progress') {
                  setProgress({
                    league: data.league,
                    current: data.current,
                    total: data.total,
                    message: data.message
                  });
                } else if (data.type === 'complete') {
                  setResult({
                    success: data.success !== false,
                    message: data.message || 'Action completed successfully'
                  });
                  setProgress(null);
                } else if (data.type === 'error') {
                  setResult({
                    success: false,
                    message: data.message
                  });
                  setProgress(null);
                }
              } catch (parseError) {
                console.error('Failed to parse SSE data:', line, parseError);
              }
            }
          }
        }
      } else {
        // Handle JSON response for add-leagues
        const data = await response.json();
        setResult({
          success: data.success !== false,
          message: data.message || 'Action completed successfully'
        });
      }

    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred'
      });
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  };

  const openXGSourceModal = async (league: League) => {
    const currentSeason = Object.keys(league.seasons).find(season =>
      league.seasons[season].current
    );

    if (!currentSeason) {
      setResult({
        success: false,
        message: 'No current season found for this league'
      });
      return;
    }

    // Fetch available rounds for the current season
    try {
      const response = await fetch(`/api/admin/leagues/${league.id}/seasons/${currentSeason}/rounds`);
      const data = await response.json();

      // Extract round names from the response
      const roundNames = data.map((item: any) => item.round_name || item);

      // Get existing XG source data
      const existingXGSource = league.xg_source && league.xg_source[currentSeason];
      let existingUrl = '';
      let existingRounds = new Set<string>();

      if (existingXGSource && existingXGSource.rounds) {
        // Get the URL from the first round (all rounds should have the same URL)
        const firstRound = Object.keys(existingXGSource.rounds)[0];
        if (firstRound) {
          existingUrl = existingXGSource.rounds[firstRound].url || '';
        }
        // Pre-select rounds that already have XG sources
        existingRounds = new Set(Object.keys(existingXGSource.rounds));
      }

      setXGSourceModal({
        isOpen: true,
        league,
        selectedSeason: currentSeason,
        availableRounds: roundNames,
        selectedRounds: existingRounds,
        customRoundName: '',
        xgSourceUrl: existingUrl
      });
    } catch (error) {
      console.error('Failed to fetch rounds:', error);
      setXGSourceModal({
        isOpen: true,
        league,
        selectedSeason: currentSeason,
        availableRounds: [],
        selectedRounds: new Set(),
        customRoundName: '',
        xgSourceUrl: ''
      });
    }
  };

  const closeXGSourceModal = () => {
    setXGSourceModal(prev => ({ ...prev, isOpen: false }));
  };

  const clearXGSourceConfiguration = () => {
    setXGSourceModal(prev => ({
      ...prev,
      selectedRounds: new Set(),
      customRoundName: '',
      xgSourceUrl: ''
    }));
  };

  const toggleRoundSelection = (roundName: string) => {
    setXGSourceModal(prev => {
      const newSelected = new Set(prev.selectedRounds);
      if (newSelected.has(roundName)) {
        newSelected.delete(roundName);
      } else {
        newSelected.add(roundName);
      }
      return { ...prev, selectedRounds: newSelected };
    });
  };

  const selectAllRounds = () => {
    setXGSourceModal(prev => ({
      ...prev,
      selectedRounds: new Set(prev.availableRounds)
    }));
  };

  const clearAllRounds = () => {
    setXGSourceModal(prev => ({
      ...prev,
      selectedRounds: new Set()
    }));
  };

  const handleDeleteLeague = (league: League) => {
    setDeleteModal({
      isOpen: true,
      league
    });
  };

  const confirmDeleteLeague = async () => {
    if (!deleteModal.league) return;

    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch(`/api/admin/leagues/${deleteModal.league.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        setResult({
          success: true,
          message: data.message
        });
        // Reload leagues to refresh the list
        loadExistingLeagues();
        closeDeleteModal();
      } else {
        setResult({
          success: false,
          message: data.message || 'Failed to delete league'
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete league'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, league: null });
  };

  const handleXGSourceSubmit = async () => {
    if (!xgSourceModal.league || !xgSourceModal.selectedSeason) return;

    const roundsToUpdate: string[] = [];

    // Add selected existing rounds
    roundsToUpdate.push(...Array.from(xgSourceModal.selectedRounds));

    // Add custom round if provided
    if (xgSourceModal.customRoundName.trim()) {
      roundsToUpdate.push(xgSourceModal.customRoundName.trim());
    }

    // Allow submitting with no rounds selected to clear the configuration
    // Only require validation if a URL is provided but no rounds are selected
    if (roundsToUpdate.length === 0 && xgSourceModal.xgSourceUrl.trim()) {
      setResult({
        success: false,
        message: 'Please select at least one round or enter a custom round name when providing a URL'
      });
      return;
    }

    try {
      const response = await fetch('/api/admin/update-xg-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: xgSourceModal.league.id,
          season: xgSourceModal.selectedSeason,
          rounds: roundsToUpdate,
          xgSource: roundsToUpdate.length > 0 ? xgSourceModal.xgSourceUrl : '' // Clear URL if no rounds selected
        })
      });

      const data = await response.json();

      if (data.success) {
        setResult({
          success: true,
          message: data.message
        });
        // Reload leagues to refresh xg_source data
        loadExistingLeagues();
        closeXGSourceModal();
      } else {
        setResult({
          success: false,
          message: data.message || 'Failed to update xg_source'
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: 'Failed to update xg_source'
      });
    }
  };

  // Filter leagues based on search query
  const filteredLeagues = activeTab === 'fetch-fixtures'
    ? leagues.filter(league =>
        league.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        league.country.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : availableLeagues.filter(league =>
        league.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        league.country.toLowerCase().includes(searchQuery.toLowerCase())
      );

  const selectedCount = selectedLeagues.size + Object.values(selectedSeasons).reduce((total, seasons) => total + seasons.size, 0);

  // Column definitions for Fetch Fixtures tab
  const fetchFixturesColumns: Column<League>[] = [
    {
      key: 'id',
      header: 'ID',
      span: 1,
      sortType: 'number',
      render: (league) => (
        <div className="text-gray-500 text-xs font-mono">
          {league.id}
        </div>
      )
    },
    {
      key: 'name',
      header: 'League Name',
      span: 3,
      render: (league) => (
        <div className="text-white truncate">
          {league.name}
        </div>
      )
    },
    {
      key: 'country',
      header: 'Country',
      span: 2,
      render: (league) => (
        <div className="text-gray-400 truncate">
          {league.country}
        </div>
      )
    },
    {
      key: 'seasons',
      header: 'Seasons',
      span: 1,
      sortType: 'number',
      render: (league) => (
        <div className="text-blue-400">
          {Object.keys(league.seasons).length}
        </div>
      )
    },
    {
      key: 'xg_source',
      header: 'XG',
      span: 1,
      render: (league) => {
        const currentSeason = Object.keys(league.seasons).find(season =>
          league.seasons[season].current
        );

        if (!currentSeason || !league.xg_source || !league.xg_source[currentSeason]) {
          return (
            <div className="text-red-400 text-xs">
              No xG
            </div>
          );
        }

        const currentXGSource = league.xg_source[currentSeason];
        const roundsCount = Object.keys(currentXGSource.rounds || {}).length;

        return (
          <div className="text-green-400 text-xs">
            {roundsCount} round{roundsCount !== 1 ? 's' : ''}
          </div>
        );
      }
    },
    {
      key: 'actions',
      header: 'Actions',
      span: 3,
      render: (league) => (
        <div className="flex items-center space-x-1">
          <button
            onClick={() => fetchXGForLeague(league.id, league.name)}
            disabled={isLoading}
            className="bg-green-800 hover:bg-green-900 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-2 py-1 text-xs font-mono transition-colors"
          >
            Fetch xG
          </button>
          <button
            onClick={() => openXGSourceModal(league)}
            className="bg-blue-800 hover:bg-blue-900 text-white px-2 py-1 text-xs font-mono transition-colors"
          >
            Manage xG
          </button>
          <button
            onClick={() => handleDeleteLeague(league)}
            className="bg-red-800 hover:bg-red-900 text-white px-2 py-1 text-xs font-mono transition-colors"
          >
            Delete
          </button>
        </div>
      )
    }
  ];

  // Column definitions for Add Leagues tab
  const addLeaguesColumns: Column<AvailableLeague>[] = [
    {
      key: 'name',
      header: 'League Name',
      span: 4,
      render: (league) => (
        <div className="text-white truncate">
          {league.name}
        </div>
      )
    },
    {
      key: 'country',
      header: 'Country',
      span: 2,
      render: (league) => (
        <div className="text-gray-400 truncate">
          {league.country}
        </div>
      )
    },
    {
      key: 'seasons',
      header: 'Seasons',
      span: 2,
      sortType: 'number',
      render: (league) => (
        <div className="text-blue-400">
          {league.seasons.length}
        </div>
      )
    },
    {
      key: 'actions',
      header: 'Actions',
      span: 3,
      render: () => (
        <div className="flex items-center space-x-1">
          {/* Expand/collapse handled by DataTable's expandable feature */}
        </div>
      )
    }
  ];

  // Render expanded content for seasons
  const renderExpandedSeasons = (league: League | AvailableLeague, isAvailableLeague = false) => {
    if (isAvailableLeague) {
      const availableLeague = league as AvailableLeague;
      return availableLeague.seasons.map((season) => (
        <div
          key={season}
          className="grid grid-cols-12 gap-1 py-1 border-b border-gray-800 last:border-b-0 text-xs font-mono hover:bg-gray-800"
        >
          <div className="col-span-1 flex items-center justify-center">
            <input
              type="checkbox"
              checked={selectedSeasons[league.id]?.has(season) || false}
              onChange={() => toggleSeasonSelection(league.id, season)}
              className="rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-600 scale-75"
            />
          </div>
          <div className="col-span-4">
            <span className="text-white ml-4">└─ {season}</span>
          </div>
          <div className="col-span-2"></div>
          <div className="col-span-2"></div>
          <div className="col-span-3"></div>
        </div>
      ));
    } else {
      const existingLeague = league as League;
      return Object.entries(existingLeague.seasons).map(([season, seasonData]) => (
        <div
          key={season}
          className="grid grid-cols-11 gap-1 py-1 border-b border-gray-800 last:border-b-0 text-xs font-mono hover:bg-gray-800"
        >
          <div className="col-span-1 flex items-center justify-center">
            <input
              type="checkbox"
              checked={selectedSeasons[league.id]?.has(season) || false}
              onChange={() => toggleSeasonSelection(league.id, season)}
              className="rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-600 scale-75"
            />
          </div>
          <div className="col-span-1"></div> {/* Empty space for ID column */}
          <div className="col-span-3">
            <span className="text-white ml-4">└─ {season}</span>
            {seasonData.current && (
              <span className="text-xs bg-green-600 text-white px-1 ml-2 rounded font-mono">
                CURRENT
              </span>
            )}
          </div>
          <div className="col-span-2"></div>
          <div className="col-span-1"></div>
          <div className="col-span-1"></div> {/* XG Source column */}
          <div className="col-span-2">
            <span className="text-gray-400">
              {seasonData.start.split('-').slice(1).join('/')} → {seasonData.end.split('-').slice(1).join('/')}
            </span>
          </div>
          <div className="col-span-0"></div> {/* Actions column - empty for expanded rows */}
        </div>
      ));
    }
  };

  return (
    <div className="text-gray-100">
      <div className="py-6">
      {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-red-400 font-mono">ADMIN</h1>
          </div>
        </div>

        {/* Tab Navigation */}
        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Search */}
        <SearchBar value={searchQuery} onChange={setSearchQuery} />

        {/* Universal DataTable */}
        {activeTab === 'fetch-fixtures' ? (
          <DataTable<League>
            title="Existing Leagues"
            subtitle={`${filteredLeagues.length} leagues`}
            data={filteredLeagues as League[]}
            columns={fetchFixturesColumns}
            getItemId={(league) => league.id}
            emptyMessage={searchQuery ? 'No leagues match your search.' : 'No leagues found.'}
            expandable={true}
            renderExpandedContent={(league) => renderExpandedSeasons(league, false)}
            getExpandedRowClassName={() => 'bg-gray-850'}
            selectable={true}
            selectedIds={selectedLeagues}
            onSelectionChange={(selectedIds) => {
              // Handle league-level selection changes (independent of season selection)
              setSelectedLeagues(new Set(Array.from(selectedIds).map(id => Number(id))));
            }}
            actions={
              <div className="flex items-center gap-4">
                <button
                  onClick={executeAction}
                  disabled={isLoading || selectedCount === 0}
                  className="bg-red-800 hover:bg-red-900 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-3 py-1.5 font-mono text-xs transition-colors"
                >
                  {isLoading ? 'Processing...' : 'Execute Fetch'}
                </button>
                <button
                  onClick={fetchXGForAllLeagues}
                  disabled={isLoading}
                  className="bg-green-800 hover:bg-green-900 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-3 py-1.5 font-mono text-xs transition-colors"
                >
                  {isLoading ? 'Processing...' : 'Fetch All XG'}
                </button>
              </div>
            }
          />
        ) : (
          <DataTable<AvailableLeague>
            title="Available Leagues"
            subtitle={`${filteredLeagues.length} leagues`}
            data={filteredLeagues as AvailableLeague[]}
            columns={addLeaguesColumns}
            getItemId={(league) => league.id}
            emptyMessage={searchQuery ? 'No leagues match your search.' : 'No leagues found.'}
            expandable={true}
            renderExpandedContent={(league) => renderExpandedSeasons(league, true)}
            getExpandedRowClassName={() => 'bg-gray-850'}
            selectable={true}
            selectedIds={selectedLeagues}
            onSelectionChange={(selectedIds) => {
              // Handle league-level selection changes (independent of season selection)
              setSelectedLeagues(new Set(Array.from(selectedIds).map(id => Number(id))));
            }}
            actions={
              <div className="flex items-center gap-4">
                <button
                  onClick={executeAction}
                  disabled={isLoading || selectedCount === 0}
                  className="bg-red-800 hover:bg-red-900 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-3 py-1.5 font-mono text-xs transition-colors"
                >
                  {isLoading ? 'Processing...' : 'Execute Add'}
                </button>
              </div>
            }
          />
        )}

        {/* Progress Panel */}
        {progress && (
          <ProgressPanel
            current={progress.current}
            total={progress.total}
            message={progress.message}
          />
        )}

        {/* Results Panel */}
        {result && (
          <ResultsPanel success={result.success} message={result.message} />
        )}

        {/* XG Source Modal */}
        <XGSourceModal
          isOpen={xgSourceModal.isOpen}
          league={xgSourceModal.league}
          selectedSeason={xgSourceModal.selectedSeason}
          availableRounds={xgSourceModal.availableRounds}
          selectedRounds={xgSourceModal.selectedRounds}
          customRoundName={xgSourceModal.customRoundName}
          xgSourceUrl={xgSourceModal.xgSourceUrl}
          onClose={closeXGSourceModal}
          onToggleRound={toggleRoundSelection}
          onSelectAllRounds={selectAllRounds}
          onClearAllRounds={clearAllRounds}
          onCustomRoundChange={(value) => setXGSourceModal(prev => ({ ...prev, customRoundName: value }))}
          onXGSourceUrlChange={(value) => setXGSourceModal(prev => ({ ...prev, xgSourceUrl: value }))}
          onSubmit={handleXGSourceSubmit}
          onClearConfiguration={clearXGSourceConfiguration}
        />

        {/* Delete Confirmation Modal */}
        <DeleteConfirmationModal
          isOpen={deleteModal.isOpen}
          league={deleteModal.league}
          isLoading={isLoading}
          onClose={closeDeleteModal}
          onConfirm={confirmDeleteLeague}
        />
      </div>
    </div>
  );
}

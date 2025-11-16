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
import { AdminTab } from '../../types/admin';

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

  // Test tab state
  const [isTesting, setIsTesting] = useState(false);
  const [testProgress, setTestProgress] = useState<string>('');
  const [testConfig, setTestConfig] = useState<{
    selectedFeatures: string[];
    selectAll: boolean;
    epochs: number;
    batchSize: number;
  }>({
    selectedFeatures: [],
    selectAll: true, // true means all features selected
    epochs: 150,
    batchSize: 1024
  });
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    config?: {
      features: string[];
      epochs: number;
      batchSize: number;
    };
    metrics?: any; // Comprehensive metrics from ml-evaluation
    data?: {
      totalFixtures: number;
      trainFixtures: number;
      testFixtures: number;
      predictionsSaved: number;
    };
    modelStats?: any;
  } | null>(null);

  // Simulation tab state
  const [simulationResult, setSimulationResult] = useState<{
    success: boolean;
    message: string;
    summary?: {
      totalBetsPlaced: number;
      totalStake: number;
      totalReturn: number;
      profitLoss: number;
      profitPercentage: number;
      averageOdds: number;
    };
    bets?: any[];
  } | null>(null);

  // Monitor tab state
  const [monitorData, setMonitorData] = useState<{
    timestamp: string;
    connections: { total: number; active: number; idle: number; idle_in_transaction: number; waiting: number; };
    performance: {
      active_queries: number;
      cache_hit_ratio: number;
      recent_queries: any[];
      database_stats: any[];
    };
    locks: any[];
  } | null>(null);


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


  const executeAction = async () => {
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      const endpoint = '/api/admin/add-leagues';
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

      const body = { selectedLeagues: selectedLeagueIds, selectedSeasons: seasonsToSend };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle JSON response for add-leagues
      const data = await response.json();
      setResult({
        success: data.success !== false,
        message: data.message || 'Action completed successfully'
      });

      // Reload available leagues if we're on the add-leagues tab and operation was successful
      if (activeTab === 'add-leagues' && data.success !== false) {
        loadAvailableLeagues();
        // Clear selections after successful addition
        setSelectedSeasons({});
        setSelectedLeagues(new Set());
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

  const runChainForLeague = async (leagueId: number, leagueName: string) => {
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      // Show initial progress
      setProgress({
        league: leagueName,
        current: 1,
        total: 3,
        message: 'Running chain calculations...'
      });

      const response = await fetch('/api/admin/chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'league', leagueId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle JSON response
      const data = await response.json();

      if (data.success !== false) {
        setResult({
          success: true,
          message: data.message || 'Chain completed successfully'
        });
      } else {
        setResult({
          success: false,
          message: data.message || 'Chain failed'
        });
      }

    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred'
      });
    } finally {
      setIsLoading(false);
      setProgress(null);
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
      
      // Add any configured rounds that aren't in the fixtures list (like custom rounds: "ALL", etc.)
      if (existingXGSource && existingXGSource.rounds) {
        const configuredRounds = Object.keys(existingXGSource.rounds);
        configuredRounds.forEach(round => {
          if (!roundNames.includes(round)) {
            roundNames.push(round);
          }
        });
        // Sort the rounds for better UX
        roundNames.sort((a: string, b: string) => {
          // Custom rounds (like "ALL") go to the top
          if (a === 'ALL') return -1;
          if (b === 'ALL') return 1;
          return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });
      }

      setXGSourceModal({
        isOpen: true,
        league,
        selectedSeason: currentSeason,
        availableRounds: roundNames,
        selectedRounds: new Set<string>(),
        customRoundName: '',
        xgSourceUrl: ''
      });
    } catch (error) {
      console.error('Failed to fetch rounds:', error);
      
      // Even if fetching rounds fails, show any existing configured rounds
      const existingXGSource = league.xg_source && league.xg_source[currentSeason];
      const configuredRounds = existingXGSource && existingXGSource.rounds 
        ? Object.keys(existingXGSource.rounds).sort((a: string, b: string) => {
            if (a === 'ALL') return -1;
            if (b === 'ALL') return 1;
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
          })
        : [];
      
      setXGSourceModal({
        isOpen: true,
        league,
        selectedSeason: currentSeason,
        availableRounds: configuredRounds,
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

  // Monitor tab handlers
  const loadMonitorData = async () => {
    try {
      const response = await fetch('/api/admin/database-monitor');
      if (response.ok) {
        const data = await response.json();
        setMonitorData(data);
      }
    } catch (error) {
      console.error('Monitor error:', error);
    }
  };

  const handleVacuumAnalyze = async () => {
    // Ask user which tables to maintain
    const maintenanceOptions = [
      'football_odds (recommended - fixes current lock issues)',
      'All frequently updated tables (football_odds, football_fixtures, football_stats, football_predictions)',
      'All football_ tables'
    ];

    const choice = prompt(
      'Choose maintenance scope:\n\n1. football_odds (recommended - fixes current lock issues)\n2. All frequently updated tables (football_odds, football_fixtures, football_stats, football_predictions)\n3. All football_ tables\n\nEnter 1, 2, or 3:',
      '1'
    );

    if (!choice || !['1', '2', '3'].includes(choice)) {
      return;
    }

    let tablesToProcess: string[] = [];
    switch (choice) {
      case '1':
        tablesToProcess = ['football_odds'];
        break;
      case '2':
        tablesToProcess = ['football_odds', 'football_fixtures', 'football_stats', 'football_predictions'];
        break;
      case '3':
        tablesToProcess = [
          'football_leagues', 'football_teams', 'football_fixtures', 'football_odds',
          'football_fair_odds', 'football_predictions', 'football_stats'
        ];
        break;
    }

    if (!confirm(`This will run VACUUM ANALYZE on: ${tablesToProcess.join(', ')}\n\nContinue?`)) {
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/admin/vacuum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'vacuum_analyze',
          tables: tablesToProcess
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const details = data.details ? '\n' + data.details.join('\n') : '';
        setResult({
          success: true,
          message: `${data.message}${details}`
        });
        // Refresh monitor data to see updated stats
        loadMonitorData();
      } else {
        setResult({
          success: false,
          message: data.error || 'VACUUM ANALYZE failed'
        });
      }
    } catch (error: any) {
      console.error('VACUUM error:', error);
      setResult({
        success: false,
        message: `Network error: ${error.message}`
      });
    } finally {
      setIsLoading(false);
    }
  };


  // Auto-start monitoring when monitor tab is activated
  useEffect(() => {
    if (activeTab === 'monitor') {
      loadMonitorData();
      const interval = setInterval(loadMonitorData, 1000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);



  // MLP handlers
  const handleTrainModel = async () => {
    console.log('[Admin] Train button clicked');
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      console.log('[Admin] Sending request to /api/admin/mlp/train');
      const response = await fetch('/api/admin/mlp/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      console.log('[Admin] Response status:', response.status);
      const data = await response.json();
      console.log('[Admin] Response data:', data);

      if (data.success !== false) {
        setResult({
          success: true,
          message: data.message || 'Model trained successfully'
        });
      } else {
        setResult({
          success: false,
          message: data.message || 'Failed to train model'
        });
      }
    } catch (error) {
      console.error('[Admin] Train error:', error);
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to train model'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGeneratePredictions = async () => {
    console.log('[Admin] Predict button clicked');
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      console.log('[Admin] Sending request to /api/admin/mlp/predict');
      const response = await fetch('/api/admin/mlp/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      console.log('[Admin] Response status:', response.status);
      const data = await response.json();
      console.log('[Admin] Response data:', data);

      if (data.success !== false) {
        setResult({
          success: true,
          message: data.message || 'Predictions generated successfully'
        });
      } else {
        setResult({
          success: false,
          message: data.message || 'Failed to generate predictions'
        });
      }
    } catch (error) {
      console.error('[Admin] Predict error:', error);
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to generate predictions'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCalculatePredictionOdds = async () => {
    console.log('[Admin] Odds button clicked');
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      console.log('[Admin] Sending request to /api/admin/mlp/prediction-odds');
      const response = await fetch('/api/admin/mlp/prediction-odds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      console.log('[Admin] Odds response status:', response.status);
      const data = await response.json();
      console.log('[Admin] Odds response data:', data);

      if (data.success !== false) {
        setResult({
          success: true,
          message: data.message || 'Prediction odds calculated successfully'
        });
      } else {
        setResult({
          success: false,
          message: data.error || 'Failed to calculate prediction odds'
        });
      }
    } catch (error) {
      console.error('[Admin] Odds error:', error);
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to calculate prediction odds'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSimulateBetting = async () => {
    console.log('[Admin] Simulate betting clicked');
    setIsLoading(true);
    setResult(null);
    setProgress(null);

    try {
      console.log('[Admin] Sending request to /api/admin/mlp/simulate-betting');
      const response = await fetch('/api/admin/mlp/simulate-betting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      console.log('[Admin] Simulate response status:', response.status);
      const data = await response.json();
      console.log('[Admin] Simulate response data:', data);

      if (data.success !== false) {
        setSimulationResult({
          success: true,
          message: data.message || 'Betting simulation completed successfully',
          summary: data.summary,
          bets: data.bets
        });
        setResult({
          success: true,
          message: data.message || 'Betting simulation completed successfully'
        });
      } else {
        setSimulationResult({
          success: false,
          message: data.error || 'Failed to run betting simulation'
        });
        setResult({
          success: false,
          message: data.error || 'Failed to run betting simulation'
        });
      }
    } catch (error) {
      console.error('[Admin] Simulate error:', error);
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to run betting simulation'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunTest = async () => {
    console.log('[Admin] Test button clicked');
    setIsTesting(true);
    setTestProgress('Starting model performance test...');
    setTestResult(null);

    try {
      // Build query parameters
      const params = new URLSearchParams();
      if (!testConfig.selectAll && testConfig.selectedFeatures.length > 0) {
        params.append('selectedFeatures', testConfig.selectedFeatures.join(','));
      }
      params.append('epochs', testConfig.epochs.toString());
      params.append('batchSize', testConfig.batchSize.toString());

      const url = `/api/admin/mlp/test?${params.toString()}`;
      console.log('[Admin] Sending request to:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      console.log('[Admin] Test response status:', response.status);
      const data = await response.json();
      console.log('[Admin] Test response data:', data);

      setTestProgress('Test completed');
      setTestResult({
        success: data.success !== false,
        message: data.message || (data.success !== false ? 'Test completed successfully' : 'Test failed'),
        metrics: data.metrics,
        data: data.data,
        modelStats: data.modelStats
      });
    } catch (error) {
      console.error('[Admin] Test error:', error);
      setTestProgress('Test failed');
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Test failed'
      });
    } finally {
      setIsTesting(false);
    }
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

    // Require both URL and rounds to be provided
    if (roundsToUpdate.length === 0 || !xgSourceModal.xgSourceUrl.trim()) {
      setResult({
        success: false,
        message: 'Please select at least one round and enter an xG source URL'
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
          xgSource: xgSourceModal.xgSourceUrl
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

  const handleRemoveRounds = async () => {
    if (!xgSourceModal.league || !xgSourceModal.selectedSeason) return;

    const roundsToRemove: string[] = [];

    // Add selected existing rounds
    roundsToRemove.push(...Array.from(xgSourceModal.selectedRounds));

    // Add custom round if provided
    if (xgSourceModal.customRoundName.trim()) {
      roundsToRemove.push(xgSourceModal.customRoundName.trim());
    }

    if (roundsToRemove.length === 0) {
      setResult({
        success: false,
        message: 'Please select at least one round to remove'
      });
      return;
    }

    try {
      const response = await fetch('/api/admin/update-xg-source', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: xgSourceModal.league.id,
          season: xgSourceModal.selectedSeason,
          rounds: roundsToRemove
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
          message: data.message || 'Failed to remove rounds'
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: 'Failed to remove rounds'
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
        <div className="text-gray-600 text-xs font-mono">
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
        <div className="text-gray-500 truncate">
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
            onClick={() => runChainForLeague(league.id, league.name)}
            disabled={isLoading}
            className="bg-green-900 hover:bg-black disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-1.5 py-0.5 text-xs font-mono"
            title="Run full chain: fixtures → xG → calculations"
          >
            CHN
          </button>
          <button
            onClick={() => openXGSourceModal(league)}
            className="bg-blue-800 hover:bg-blue-900 text-white px-1.5 py-0.5 text-xs font-mono"
          >
            MG
          </button>
          <button
            onClick={() => handleDeleteLeague(league)}
            className="bg-red-800 hover:bg-red-900 text-white px-1.5 py-0.5 text-xs font-mono"
          >
            DEL
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
        <div className="text-gray-500 truncate">
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
          className="grid grid-cols-12 gap-1 py-1 border-b border-gray-800 last:border-b-0 text-xs font-mono hover:bg-gray-900"
        >
          <div className="col-span-1 flex items-center justify-center">
            <input
              type="checkbox"
              checked={selectedSeasons[league.id]?.has(season) || false}
              onChange={() => toggleSeasonSelection(league.id, season)}
              className="rounded border-gray-600 bg-gray-800 text-red-600 focus:ring-red-600 scale-75"
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
          className="grid grid-cols-11 gap-1 py-1 border-b border-gray-800 last:border-b-0 text-xs font-mono hover:bg-gray-900"
        >
          <div className="col-span-1 flex items-center justify-center">
            <input
              type="checkbox"
              checked={selectedSeasons[league.id]?.has(season) || false}
              onChange={() => toggleSeasonSelection(league.id, season)}
              className="rounded border-gray-600 bg-gray-800 text-red-600 focus:ring-red-600 scale-75"
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

        {/* Search - hide on test, simulate, and monitor tabs */}
        {activeTab !== 'test' && activeTab !== 'simulate' && activeTab !== 'monitor' && (
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
        )}

        {/* Universal DataTable */}
        {activeTab === 'monitor' ? (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-red-400 font-mono">DATABASE MONITOR</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleVacuumAnalyze}
                  disabled={isLoading}
                  className="px-3 py-1 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 text-white text-xs font-mono rounded transition-colors"
                >
                  {isLoading ? 'VACUUMING...' : 'VACUUM ANALYZE'}
                </button>
                {monitorData && (
                  <span className="text-xs text-gray-500 font-mono">
                    {new Date(monitorData.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>

            {monitorData ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Cache & Performance */}
                <div className="bg-gray-800 p-4 border border-gray-700">
                  <h3 className="text-sm font-semibold text-white mb-3">Cache & Performance</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Cache Hit Ratio:</span>
                      <span className={`font-mono ${
                        monitorData.performance.cache_hit_ratio > 90 ? 'text-green-400' :
                        monitorData.performance.cache_hit_ratio > 70 ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>
                        {monitorData.performance.cache_hit_ratio.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Active Queries:</span>
                      <span className="text-white font-mono">{monitorData.performance.active_queries}</span>
                    </div>
                  </div>
                </div>

                {/* Connection Stats */}
                <div className="bg-gray-800 p-4 border border-gray-700">
                  <h3 className="text-sm font-semibold text-white mb-3">Connections</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Total:</span>
                      <span className="text-white font-mono">{monitorData.connections.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Active:</span>
                      <span className="text-green-400 font-mono">{monitorData.connections.active}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Idle:</span>
                      <span className="text-blue-400 font-mono">{monitorData.connections.idle}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Idle in TX:</span>
                      <span className={`font-mono ${
                        monitorData.connections.idle_in_transaction > 0 ? 'text-red-400' : 'text-gray-500'
                      }`}>
                        {monitorData.connections.idle_in_transaction}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Waiting:</span>
                      <span className={`font-mono ${
                        monitorData.connections.waiting > 0 ? 'text-red-400' : 'text-gray-500'
                      }`}>
                        {monitorData.connections.waiting}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Recent Queries */}
                <div className="bg-gray-800 p-4 border border-gray-700">
                  <h3 className="text-sm font-semibold text-white mb-3">Recent Queries</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {monitorData.performance.recent_queries.length > 0 ? (
                      monitorData.performance.recent_queries.map((query, index) => (
                        <div key={index} className="text-xs bg-gray-900 p-2 border border-gray-600">
                          <div className="flex justify-between mb-1">
                            <span className="text-gray-400 font-mono">PID: {query.pid}</span>
                            <span className={`font-mono ${
                              (query.duration_ms || 0) < 5 ? 'text-emerald-400' :
                              (query.duration_ms || 0) < 100 ? 'text-green-400' : 'text-yellow-400'
                            }`}>
                              {Number(query.duration_ms || 0).toFixed(1)}ms
                            </span>
                          </div>
                          <div className="text-gray-300 font-mono text-xs break-all">
                            {query.query.length > 60 ? `${query.query.substring(0, 60)}...` : query.query}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4">
                        <div className="text-emerald-400 text-sm">⚡ Lightning Fast!</div>
                        <div className="text-gray-500 text-xs">Queries complete too quickly to capture</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Database Stats & Locks */}
                <div className="space-y-4">
                  {/* Database Stats */}
                  <div className="bg-gray-800 p-4 border border-gray-700">
                    <h3 className="text-sm font-semibold text-white mb-3">Database Stats</h3>
                    {monitorData.performance.database_stats.map((stat, index) => (
                      <div key={index} className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Database:</span>
                          <span className="text-white font-mono">{stat.datname}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Transactions:</span>
                          <span className="text-white font-mono">{stat.xact_commit} / {stat.xact_rollback}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Active Locks */}
                  <div className="bg-gray-800 p-4 border border-gray-700">
                    <h3 className="text-sm font-semibold text-white mb-3">Active Locks ({monitorData.locks.length})</h3>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {monitorData.locks.length > 0 ? (
                        monitorData.locks.map((lock, index) => (
                          <div key={index} className="text-xs bg-gray-900 p-2 border border-gray-600">
                            <div className="flex justify-between">
                              <span className="text-blue-400 font-mono">{lock.locktype}</span>
                              <span className={`font-mono ${lock.granted ? 'text-green-400' : 'text-red-400'}`}>
                                {lock.granted ? 'GRANTED' : 'WAITING'}
                              </span>
                            </div>
                            <div className="text-gray-400 font-mono text-xs mt-1">
                              {lock.relation} | PID: {lock.pid}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-gray-500 text-xs">No active locks</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="text-gray-400">Loading...</div>
              </div>
            )}
          </div>
        ) : activeTab === 'test' ? (
          <div className="bg-gray-900 border border-gray-700 p-6">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white mb-2">MLP Model Performance Test</h2>
              <p className="text-gray-400 text-sm">
                Test the MLP model's performance on historical data. Uses 80% of past fixtures for training and 20% for testing.
              </p>
            </div>

            {/* Configuration Section */}
            <div className="mb-6 p-4 bg-gray-800 border border-gray-600">
              <h3 className="text-sm font-semibold text-white mb-3">Configuration</h3>

              {/* MLP Parameters */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Epochs</label>
                  <input
                    type="number"
                    value={testConfig.epochs}
                    onChange={(e) => setTestConfig(prev => ({ ...prev, epochs: parseInt(e.target.value) || 150 }))}
                    className="w-full bg-gray-700 border border-gray-600 text-white px-2 py-1 text-sm font-mono"
                    min="10"
                    max="500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Batch Size</label>
                  <input
                    type="number"
                    value={testConfig.batchSize}
                    onChange={(e) => setTestConfig(prev => ({ ...prev, batchSize: parseInt(e.target.value) || 1024 }))}
                    className="w-full bg-gray-700 border border-gray-600 text-white px-2 py-1 text-sm font-mono"
                    min="32"
                    max="4096"
                  />
                </div>
              </div>

              {/* Feature Selection */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-400 mb-2">Features (leave empty for all)</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {[
                    'home_advantage',
                    'adjusted_rolling_xg_home', 'adjusted_rolling_xga_home',
                    'adjusted_rolling_xg_away', 'adjusted_rolling_xga_away',
                    'adjusted_rolling_market_xg_home', 'adjusted_rolling_market_xga_home',
                    'adjusted_rolling_market_xg_away', 'adjusted_rolling_market_xga_away',
                    'avg_goals_league', 'hours_since_last_match_home', 'hours_since_last_match_away',
                    'elo_home', 'elo_away', 'league_elo'
                  ].map(feature => (
                    <label key={feature} className="flex items-center space-x-1">
                      <input
                        type="checkbox"
                        checked={testConfig.selectAll || testConfig.selectedFeatures.includes(feature)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (testConfig.selectAll) {
                              // Switching from "all selected" to specific selection
                              setTestConfig(prev => ({
                                ...prev,
                                selectAll: false,
                                selectedFeatures: [feature]
                              }));
                            } else {
                              setTestConfig(prev => ({
                                ...prev,
                                selectedFeatures: [...prev.selectedFeatures.filter(f => f !== feature), feature]
                              }));
                            }
                          } else {
                            if (testConfig.selectAll) {
                              // Unchecking when all were selected - select all except this one
                              const allFeatures = [
                                'home_advantage',
                                'adjusted_rolling_xg_home', 'adjusted_rolling_xga_home',
                                'adjusted_rolling_xg_away', 'adjusted_rolling_xga_away',
                                'adjusted_rolling_market_xg_home', 'adjusted_rolling_market_xga_home',
                                'adjusted_rolling_market_xg_away', 'adjusted_rolling_market_xga_away',
                                'avg_goals_league', 'hours_since_last_match_home', 'hours_since_last_match_away',
                                'elo_home', 'elo_away', 'league_elo'
                              ];
                              setTestConfig(prev => ({
                                ...prev,
                                selectAll: false,
                                selectedFeatures: allFeatures.filter(f => f !== feature)
                              }));
                            } else {
                              setTestConfig(prev => ({
                                ...prev,
                                selectedFeatures: prev.selectedFeatures.filter(f => f !== feature)
                              }));
                            }
                          }
                        }}
                        className="bg-gray-700 border-gray-600 text-green-500"
                      />
                      <span className="text-gray-300 font-mono text-xs">{feature}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setTestConfig(prev => ({ ...prev, selectAll: true, selectedFeatures: [] }))}
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 font-mono"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setTestConfig(prev => ({ ...prev, selectAll: false, selectedFeatures: [] }))}
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 font-mono"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <button
                onClick={handleRunTest}
                disabled={isTesting}
                className="bg-green-800 hover:bg-green-900 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-4 py-2 font-mono text-sm transition-colors"
                title="Run MLP model performance test"
              >
                {isTesting ? 'Running Test...' : 'Run Test'}
              </button>
            </div>

            {/* Progress */}
            {isTesting && (
              <div className="mb-6 p-4 bg-gray-800 border border-gray-600">
                <h3 className="text-sm font-semibold text-white mb-2">Progress</h3>
                <div className="text-gray-300 text-sm font-mono">
                  {testProgress}
                </div>
              </div>
            )}

            {/* Results */}
            {testResult && (
              <div className="space-y-4">
                <div className={`p-4 border ${testResult.success ? 'bg-green-900/20 border-green-700' : 'bg-red-900/20 border-red-700'}`}>
                  <h3 className="text-sm font-semibold text-white mb-2">
                    {testResult.success ? 'Test Completed Successfully' : 'Test Failed'}
                  </h3>
                  <div className="text-gray-300 text-sm">
                    {testResult.message}
                  </div>
                </div>

                {testResult.metrics && (
                  <div className="space-y-4">
                    {/* Configuration Used */}
                    {testResult.config && (
                      <div className="p-4 bg-gray-800 border border-gray-600 mb-4">
                        <h3 className="text-sm font-semibold text-white mb-3">Configuration Used</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-400">Epochs:</span>
                            <span className="text-white font-mono ml-2">{testResult.config.epochs}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Batch Size:</span>
                            <span className="text-white font-mono ml-2">{testResult.config.batchSize}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Features:</span>
                            <span className="text-white font-mono ml-2">{testResult.config.features.length} selected</span>
                          </div>
                        </div>
                        <div className="mt-2">
                          <span className="text-gray-400 text-xs">Features:</span>
                          <div className="text-xs text-gray-300 font-mono mt-1 break-words">
                            {testResult.config.features.join(', ')}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Data Stats */}
                    <div className="p-4 bg-gray-800 border border-gray-600">
                      <h3 className="text-sm font-semibold text-white mb-3">Test Overview</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-300">Total Fixtures:</span>
                            <span className="text-white font-mono">{testResult.data?.totalFixtures || 0}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-300">Train Fixtures:</span>
                            <span className="text-white font-mono">{testResult.data?.trainFixtures || 0}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-300">Test Fixtures:</span>
                            <span className="text-white font-mono">{testResult.data?.testFixtures || 0}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-300">Test Size:</span>
                            <span className="text-white font-mono">{testResult.metrics.test_size || 0}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-300">Predictions Saved:</span>
                            <span className="text-white font-mono">{testResult.data?.predictionsSaved || 0}</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-xs font-semibold text-gray-400 mb-2">Average Scores</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-400">Predicted:</span>
                              <span className="text-white font-mono">{testResult.metrics.avg_predicted_home?.toFixed(2)} - {testResult.metrics.avg_predicted_away?.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Actual:</span>
                              <span className="text-white font-mono">{testResult.metrics.avg_actual_home?.toFixed(2)} - {testResult.metrics.avg_actual_away?.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">XG:</span>
                              <span className="text-white font-mono">{testResult.metrics.avg_xg_home?.toFixed(2) || 'N/A'} - {testResult.metrics.avg_xg_away?.toFixed(2) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Market XG:</span>
                              <span className="text-white font-mono">{testResult.metrics.avg_market_xg_home?.toFixed(2) || 'N/A'} - {testResult.metrics.avg_market_xg_away?.toFixed(2) || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* MLP Model Errors */}
                    <div className="p-4 bg-gray-800 border border-gray-600">
                      <h3 className="text-sm font-semibold text-white mb-3">MLP Model Performance (MAE)</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="text-xs font-semibold text-blue-400 mb-2">vs Actual Scores</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-300">Home:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_home_actual?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Away:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_away_actual?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Total:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_total_actual?.toFixed(3) || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-green-400 mb-2">vs XG</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-300">Home:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_home_xg?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Away:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_away_xg?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Total:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_total_xg?.toFixed(3) || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-purple-400 mb-2">vs Market XG</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-300">Home:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_home_market_xg?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Away:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_away_market_xg?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Total:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_total_market_xg?.toFixed(3) || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Market XG Errors */}
                    <div className="p-4 bg-gray-800 border border-gray-600">
                      <h3 className="text-sm font-semibold text-white mb-3">Market XG Performance (MAE)</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="text-xs font-semibold text-orange-400 mb-2">vs Actual Scores</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-300">Home:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_market_xg_home_actual?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Away:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_market_xg_away_actual?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Total:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_market_xg_total_actual?.toFixed(3) || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-yellow-400 mb-2">vs XG</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-300">Home:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_market_xg_home_xg?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Away:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_market_xg_away_xg?.toFixed(3) || 'N/A'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-300">Total:</span>
                              <span className="text-white font-mono">{testResult.metrics.mae_market_xg_total_xg?.toFixed(3) || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {testResult.modelStats && (
                  <div className="p-4 bg-gray-800 border border-gray-600">
                    <h3 className="text-sm font-semibold text-white mb-2">Model Statistics</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-300">Train Size:</span>
                        <span className="text-white font-mono ml-2">{testResult.modelStats.trainSize}</span>
                      </div>
                      <div>
                        <span className="text-gray-300">Final Loss:</span>
                        <span className="text-white font-mono ml-2">{testResult.modelStats.finalLoss?.toFixed(4)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'simulate' ? (
          <div className="bg-gray-900 border border-gray-700 p-6">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white mb-2">Betting Simulation</h2>
              <p className="text-gray-400 text-sm">
                Simulate betting using Pinnacle vs Prediction odds. Compares X12 and OU 2.5 markets with 1 unit stakes.
              </p>
            </div>

            <div className="mb-6 flex gap-4">
              <button
                onClick={handleCalculatePredictionOdds}
                disabled={isLoading}
                className="bg-green-800 hover:bg-green-900 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-4 py-2 font-mono text-sm transition-colors"
                title="Calculate odds from saved predictions"
              >
                {isLoading ? 'Calculating Odds...' : 'Calculate Odds'}
              </button>
              <button
                onClick={handleSimulateBetting}
                disabled={isLoading}
                className="bg-red-800 hover:bg-red-900 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-4 py-2 font-mono text-sm transition-colors"
                title="Run betting simulation"
              >
                {isLoading ? 'Running Simulation...' : 'Run Simulation'}
              </button>
            </div>

            {/* Simulation Results */}
            {simulationResult && (
              <div className="space-y-4">
                <div className={`p-4 border ${simulationResult.success ? 'bg-green-900/20 border-green-700' : 'bg-red-900/20 border-red-700'}`}>
                  <h3 className="text-sm font-semibold text-white mb-2">
                    {simulationResult.success ? 'Simulation Completed' : 'Simulation Failed'}
                  </h3>
                  <div className="text-gray-300 text-sm">
                    {simulationResult.message}
                  </div>
                </div>

                {simulationResult.summary && (
                  <div className="p-4 bg-gray-800 border border-gray-600">
                    <h3 className="text-sm font-semibold text-white mb-3">Simulation Summary</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-300">Bets Placed:</span>
                          <span className="text-white font-mono">{simulationResult.summary.totalBetsPlaced}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-300">Total Stake:</span>
                          <span className="text-white font-mono">{simulationResult.summary.totalStake.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-300">Total Return:</span>
                          <span className="text-white font-mono">{simulationResult.summary.totalReturn.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-300">Profit/Loss:</span>
                          <span className={`font-mono ${simulationResult.summary.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {simulationResult.summary.profitLoss >= 0 ? '+' : ''}{simulationResult.summary.profitLoss.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-300">Profit %:</span>
                          <span className={`font-mono ${simulationResult.summary.profitPercentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {simulationResult.summary.profitPercentage >= 0 ? '+' : ''}{simulationResult.summary.profitPercentage.toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-300">Avg Odds:</span>
                          <span className="text-white font-mono">{simulationResult.summary.averageOdds.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {simulationResult.bets && simulationResult.bets.length > 0 && (
                  <div className="p-4 bg-gray-800 border border-gray-600">
                    <h3 className="text-sm font-semibold text-white mb-3">Recent Bets (Last 50)</h3>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {simulationResult.bets.map((bet, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-gray-700 border border-gray-600 text-xs">
                          <div className="flex-1">
                            <span className="text-gray-300">
                              {bet.home_team} vs {bet.away_team}
                            </span>
                            <span className="text-gray-500 ml-2">
                              {new Date(bet.fixture_date).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-blue-400 font-mono">
                              {bet.bet.type} {bet.bet.outcome}
                            </span>
                            <span className="text-yellow-400 font-mono">
                              {bet.bet.pinnacleOdds.toFixed(2)}
                            </span>
                            <span className={`font-mono ${bet.won ? 'text-green-400' : 'text-red-400'}`}>
                              {bet.won ? '+' : '-'}{bet.return.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'fetch-fixtures' ? (
          <DataTable<League>
            title="Existing Leagues"
            subtitle={`${filteredLeagues.length} leagues`}
            data={filteredLeagues as League[]}
            columns={fetchFixturesColumns}
            getItemId={(league) => league.id || `${league.name}-${league.country}`}
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
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs font-mono">MLP:</span>
                  <button
                    onClick={handleTrainModel}
                    disabled={isLoading}
                    className="bg-blue-800 hover:bg-blue-900 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-2 py-1 font-mono text-xs transition-colors"
                    title="Train MLP model"
                  >
                    Train
                  </button>
                  <button
                    onClick={handleGeneratePredictions}
                    disabled={isLoading}
                    className="bg-purple-800 hover:bg-purple-900 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-2 py-1 font-mono text-xs transition-colors"
                    title="Generate predictions using saved MLP model"
                  >
                    Predict
                  </button>
                </div>
              </div>
            }
          />
        ) : (
          <DataTable<AvailableLeague>
            title="Available Leagues"
            subtitle={`${filteredLeagues.length} leagues`}
            data={filteredLeagues as AvailableLeague[]}
            columns={addLeaguesColumns}
            getItemId={(league) => league.id || `${league.name}-${league.country}`}
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
                  className="bg-red-800 hover:bg-red-900 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-3 py-1.5 font-mono text-xs transition-colors"
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
          onRemoveRounds={handleRemoveRounds}
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

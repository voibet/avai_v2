/**
 * Football Statistics Calculations
 * Modular calculation system for football data processing
 */

import { calculateHours } from './hours';
import { calculateLeagueGoals } from './league-goals';
import { calculateElo } from './elo';
import { calculateHomeAdvantage } from './home-advantage';
import { calculateRollingXG } from './rolling-xg';
import { calculateMarketXG } from './market-xg';
import { calculateOddsFromPredictions } from './prediction-odds';
import { calculateFairOdds } from './fair-odds';
import { cleanupPastFixturesOdds } from './cleanup-odds';

export type CalculationFunction =
  | 'hours'
  | 'goals'
  | 'elo'
  | 'home-advantage'
  | 'xg'
  | 'rolling-xg'
  | 'market-xg'
  | 'prediction-odds'
  | 'odds'
  | 'fair-odds'
  | 'cleanup-odds'
  | 'all';

export interface CalculationResult {
  function: string;
  count: number;
  message: string;
  error?: string;
}

/**
 * Run football statistics calculations
 * @param functions - Array of functions to run, or 'all' for all functions
 * @param fixtureIds - Optional array of fixture IDs to process
 * @returns Promise<CalculationResult[]>
 */
export async function runCalculations(
  functions: CalculationFunction[] | CalculationFunction = 'all',
  fixtureIds: number[] | null = null
): Promise<CalculationResult[]> {
  const functionList = Array.isArray(functions) ? functions : [functions];
  const isAll = functionList.includes('all') || functionList.length === 0;

  console.log('🚀 Running calculations...');

  const results: CalculationResult[] = [];
  let totalCount = 0;

  const runFunction = async (func: CalculationFunction, name: string): Promise<void> => {
    try {
      let count: number;

      switch (func) {
        case 'hours':
          count = await calculateHours(fixtureIds);
          break;
        case 'goals':
          count = await calculateLeagueGoals(fixtureIds);
          break;
        case 'elo':
          count = await calculateElo(fixtureIds);
          break;
        case 'home-advantage':
          count = await calculateHomeAdvantage(fixtureIds);
          break;
        case 'rolling-xg':
        case 'xg':
          count = await calculateRollingXG(fixtureIds);
          break;
        case 'market-xg':
          count = await calculateMarketXG(fixtureIds);
          break;
        case 'prediction-odds':
        case 'odds':
          count = await calculateOddsFromPredictions(fixtureIds);
          break;
        case 'fair-odds':
          count = await calculateFairOdds(fixtureIds);
          break;
        case 'cleanup-odds':
          const cleanupResult = await cleanupPastFixturesOdds();
          count = cleanupResult.cleanedRecords;
          break;
        default:
          throw new Error(`Unknown calculation function: ${func}`);
      }

      totalCount += count;
      results.push({
        function: func,
        count,
        message: `${name} completed: ${count} fixtures processed`
      });

    } catch (error: any) {
      console.error(`❌ Error in ${name}:`, error.message);
      results.push({
        function: func,
        count: 0,
        message: `${name} failed`,
        error: error.message
      });
    }
  };

  if (isAll) {
    console.log('Running all calculations...');

    // Run calculations in dependency order
    await runFunction('hours', 'Hours calculation');
    await runFunction('goals', 'League goals calculation');
    await runFunction('elo', 'ELO calculations');
    await runFunction('home-advantage', 'Home advantage calculation');
    await runFunction('rolling-xg', 'Rolling windows xG calculations');
    await runFunction('market-xg', 'Market XG calculations');
    await runFunction('prediction-odds', 'Prediction odds calculations');
    await runFunction('fair-odds', 'Fair odds calculations');
    await runFunction('cleanup-odds', 'Odds cleanup');

    console.log(`✅ All calculations completed: ${totalCount} fixtures processed total`);
  } else {
    // Run selected functions
    for (const func of functionList) {
      if (func === 'all') continue;

      const funcNames: Record<CalculationFunction, string> = {
        'hours': 'Hours calculation',
        'goals': 'Goals calculation',
        'elo': 'ELO calculations',
        'home-advantage': 'Home advantage calculation',
        'rolling-xg': 'Rolling windows xG calculations',
        'xg': 'Rolling windows xG calculations',
        'market-xg': 'Market XG calculations',
        'prediction-odds': 'Prediction odds calculations',
        'odds': 'Prediction odds calculations',
        'fair-odds': 'Fair odds calculations',
        'cleanup-odds': 'Odds cleanup',
        'all': 'All calculations'
      };

      await runFunction(func, funcNames[func]);
    }

    console.log(`✅ Selected calculations completed: ${totalCount} fixtures processed total`);
  }

  return results;
}

// Export individual functions for direct use
export {
  calculateHours,
  calculateLeagueGoals,
  calculateElo,
  calculateHomeAdvantage,
  calculateRollingXG,
  calculateMarketXG,
  calculateOddsFromPredictions,
  calculateFairOdds,
  cleanupPastFixturesOdds
};


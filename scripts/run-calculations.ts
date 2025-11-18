/**
 * Football Statistics Calculator (TypeScript Version)
 *
 * This script populates the football_stats table with calculated metrics for fixtures:
 * - Hours since last match for home and away teams (includes all scheduled matches)
 * - League average goals (rolling average of last 300 matches, min: 50, capped 1.5-4.0, default 2.76)
 * - Home advantage (average home_goals - away_goals for past 300 matches, min: 50, capped 0.1-0.6, default 0.30)
 * - ELO ratings (team ELOs using XG ratio as continuous scores + league ELOs as average of team ELOs)
 * - Rolling xG and xGA (8, 16, 32 match windows averaged, min: 5 matches per team WITH league-specific filtering)
 *

 * USAGE:
 * RUN: $env:DB_USER='postgres'; $env:DB_PASSWORD='NopoONpelle31?'; $env:DB_HOST='172.29.253.202'; $env:DB_PORT='5432'; $env:DB_NAME='mydb'; $env:DB_SSL='false'; npx tsx scripts/run-calculations.ts [function] [--fixture-ids=id1,id2,id3]
 *
 * OPTIONS:
 *   function: '1' or 'hours', '2' or 'goals', '3' or 'elo', '4' or 'home-advantage', '5' or 'xg' or 'rolling-xg', '6' or 'market-xg', '7' or 'prediction-odds' or 'odds', '8' or 'fair-odds', '9' or 'cleanup-odds', 'all' (default)
 *   Multiple functions can be specified comma-separated, e.g., '2,5' to run goals and rolling-xg calculations
 *   --fixture-ids=id1,id2,id3: Process only specific fixture IDs (comma-separated)
 *
 * LEAGUE-SPECIFIC FILTERING:
 *   - For League matches: Only same-country League matches are used for rolling xG calculations (min: 5 matches)
 *   - For Cup matches: ALL matches from past 365 days are used for rolling xG calculations (min: 5 matches)
 */

import { runCalculations, CalculationFunction } from '../lib/calculations/index.ts';

// Parse command line arguments
const args = process.argv.slice(2);

// Check for --fixture-ids=id1,id2,id3 format
let fixtureIds: number[] | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--fixture-ids=')) {
    const fixtureIdsArg = args[i].split('=')[1];
    fixtureIds = fixtureIdsArg.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    if (fixtureIds.length === 0) {
      fixtureIds = null; // Reset if no valid IDs found
    }
    args.splice(i, 1); // Remove the flag
    break;
  }
}


// Parse function arguments
const functionMap: Record<string, CalculationFunction> = {
  '1': 'hours',
  'hours': 'hours',
  '2': 'goals',
  'goals': 'goals',
  '3': 'elo',
  'elo': 'elo',
  '4': 'home-advantage',
  'home-advantage': 'home-advantage',
  '5': 'rolling-xg',
  'xg': 'rolling-xg',
  'rolling-xg': 'rolling-xg',
  '6': 'market-xg',
  'market-xg': 'market-xg',
  '7': 'prediction-odds',
  'prediction-odds': 'prediction-odds',
  'odds': 'odds',
  '8': 'fair-odds',
  'fair-odds': 'fair-odds',
  '9': 'cleanup-odds',
  'cleanup-odds': 'cleanup-odds',
  'all': 'all'
};

const functions: CalculationFunction[] = args.length === 0
  ? ['all']
  : args.flatMap(arg => {
      const funcs = arg.split(',').map(f => f.trim());
      return funcs.map(f => functionMap[f]).filter(Boolean) as CalculationFunction[];
    });

async function main() {
  console.log('Starting calculation runner...');
  console.log(`Functions to run: ${functions.join(', ')}`);
  if (fixtureIds) {
    console.log(`Fixture IDs to process: ${fixtureIds.join(', ')}`);
  }

  const results = await runCalculations(functions, fixtureIds);

  // Print summary
  console.log('\n📊 Calculation Summary:');
  results.forEach(result => {
    if (result.error) {
      console.log(`❌ ${result.function}: ${result.error}`);
    } else {
      console.log(`✅ ${result.function}: ${result.count} items processed`);
    }
  });

  const totalProcessed = results.reduce((sum, result) => sum + (result.error ? 0 : result.count), 0);
  console.log(`\n🎯 Total processed: ${totalProcessed} items`);
}

// Run the script
main().catch(error => {
  console.error('❌ Calculation runner failed:', error);
  process.exit(1);
});


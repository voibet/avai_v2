
import 'dotenv/config';
import pool from '@/lib/database/db';

async function checkXGSources() {
    try {
        const result = await pool.query(`
      SELECT id, name, xg_source, seasons 
      FROM football_leagues 
      WHERE id IN (62, 242, 344)
    `);

        console.log('Found leagues with XG source:', result.rows.length);

        for (const row of result.rows) {
            console.log(`\nLeague: ${row.name} (ID: ${row.id})`);
            console.log('XG Source:', JSON.stringify(row.xg_source, null, 2));

            // Check seasons format
            let seasons = row.seasons;
            if (typeof seasons === 'string') {
                try {
                    seasons = JSON.parse(seasons);
                } catch (e) {
                    console.log('Error parsing seasons JSON');
                }
            }

            // Find current season
            let currentSeason = null;
            if (seasons) {
                for (const [year, data] of Object.entries(seasons as any)) {
                    if ((data as any).current) {
                        currentSeason = year;
                        break;
                    }
                }
            }
            console.log('Current Season:', currentSeason);
        }

        console.log('\n--- Checking Fixtures for League 62 ---');
        const fixtureResult = await pool.query(`
      SELECT id, league_id, season, round, status_short, date, xg_home, xg_away 
      FROM football_fixtures 
      WHERE league_id = 62 AND date < NOW()
      ORDER BY date DESC 
      LIMIT 1
    `);

        if (fixtureResult.rows.length > 0) {
            const f = fixtureResult.rows[0];
            console.log(`Fixture ID: ${f.id}`);
            console.log(`League: ${f.league_id}`);
            console.log(`Season: ${f.season} (Type: ${typeof f.season})`);
            console.log(`Round: "${f.round}"`);
            console.log(`Date: ${f.date}`);
            console.log(`XG: Home=${f.xg_home}, Away=${f.xg_away}`);

            // Simulate lookup
            const leagueRow = result.rows.find(r => r.id === 62);
            if (leagueRow) {
                const seasonKey = f.season.toString();
                const xgSource = leagueRow.xg_source;
                console.log(`Looking up config for season "${seasonKey}" in`, JSON.stringify(xgSource));

                if (xgSource) {
                    const seasonConfig = xgSource[seasonKey];
                    if (seasonConfig) {
                        console.log('Season config found');
                        if (seasonConfig.rounds['ALL']) {
                            console.log('ALL round config:', seasonConfig.rounds['ALL']);
                        } else {
                            console.log('ALL round config NOT found');
                            console.log('Available rounds:', Object.keys(seasonConfig.rounds));
                        }
                    } else {
                        console.log('Season config NOT found');
                    }
                } else {
                    console.log('xg_source is null/undefined');
                }
            } else {
                console.log('League 62 not found in initial fetch (might need to update initial query)');
            }
        } else {
            console.log('No fixtures found for league 62');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await pool.end();
    }
}

checkXGSources();

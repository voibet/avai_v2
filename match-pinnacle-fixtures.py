#!/usr/bin/env python3
"""
Script to match pinnacle_odds_history fixtures with football_fixtures
using timestamp (+-6 hours) and team name mappings.
"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from datetime import datetime, timedelta
import json
import sys
import unicodedata
import re

def get_db_connection():
    """Connect to PostgreSQL database using environment variables"""
    DB_USER='postgres'
    DB_PASSWORD='NopoONpelle31?'
    DB_HOST='172.29.253.202'
    DB_PORT='5432'
    DB_NAME='mydb'
    DB_SSL='false'

    try:
        return psycopg2.connect(
            host=DB_HOST,
            port=int(DB_PORT),
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            sslmode='require' if DB_SSL == 'true' else 'disable'
        )
    except psycopg2.Error as e:
        print(f"Database connection failed: {e}")
        sys.exit(1)

def process_team_name(team_name):
    """Process team name by normalizing characters, removing punctuation, removing numbers, removing words 2 letters or less and converting to lowercase"""
    if not team_name:
        return ""
    # Normalize characters (remove accents/diacritics)
    normalized = unicodedata.normalize('NFD', team_name)
    # Remove combining characters (accents)
    normalized = ''.join(char for char in normalized if unicodedata.category(char) != 'Mn')
    # Remove punctuation and special characters
    normalized = re.sub(r'[.,/\\\-_()[\]{}+*=|<>?!@#$%^&*~`\'":;]', '', normalized)
    # Remove digits
    normalized = re.sub(r'\d+', '', normalized)
    # Convert to lowercase and split into words
    words = normalized.lower().strip().split()
    # Filter out words with 2 or fewer letters, and common abbreviations like "AFC"
    filtered_words = [word for word in words if len(word) > 2 and word not in ['afc']]
    # Join back into a string
    return ' '.join(filtered_words)

def find_team_mapping(team_name, cursor):
    """Find team ID by checking the mappings JSONB field in football_teams with normalization"""
    # Normalize the input team name
    normalized_team = process_team_name(team_name)

    # First try exact match on normalized team name
    cursor.execute("""
        SELECT id, name, mappings
        FROM football_teams
        WHERE LOWER(name) = LOWER(%s)
    """, (team_name,))

    result = cursor.fetchone()
    if result:
        return result['id']

    # Try match on normalized team name
    if normalized_team:
        cursor.execute("""
            SELECT id, name, mappings
            FROM football_teams
            WHERE LOWER(name) = %s
        """, (normalized_team,))

        result = cursor.fetchone()
        if result:
            return result['id']

    # Check mappings JSONB array with exact match
    cursor.execute("""
        SELECT id, name, mappings
        FROM football_teams
        WHERE mappings::jsonb ? %s
    """, (team_name,))

    result = cursor.fetchone()
    if result:
        return result['id']

    # Check mappings with normalized comparison
    if normalized_team:
        cursor.execute("""
            SELECT id, name, mappings
            FROM football_teams
            WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(mappings) AS elem
                WHERE LOWER(elem) = LOWER(%s)
            )
        """, (team_name,))

        result = cursor.fetchone()
        if result:
            return result['id']

        # Check mappings with normalized team name - compare normalized versions
        # First get all teams and check their mappings after normalization
        cursor.execute("""
            SELECT id, name, mappings
            FROM football_teams
        """)

        for row in cursor.fetchall():
            if row['mappings']:
                # Check if any mapping matches the normalized team name
                for mapping in row['mappings']:
                    if process_team_name(mapping) == normalized_team:
                        return row['id']

    return None

def find_fixture_match(home_team, away_team, timestamp, cursor):
    """Find matching fixture in football_fixtures within 6-hour window"""
    # Convert timestamp to datetime and create time window
    match_time = datetime.fromtimestamp(timestamp)
    time_window_start = match_time - timedelta(hours=6)
    time_window_end = match_time + timedelta(hours=6)

    # Find home team ID
    home_team_id = find_team_mapping(home_team, cursor)
    if not home_team_id:
        return None

    # Find away team ID
    away_team_id = find_team_mapping(away_team, cursor)
    if not away_team_id:
        return None

    # Find fixture within time window with matching teams
    cursor.execute("""
        SELECT id, home_team_name, away_team_name, date, timestamp
        FROM football_fixtures
        WHERE home_team_id = %s
          AND away_team_id = %s
          AND date >= %s
          AND date <= %s
        ORDER BY ABS(EXTRACT(epoch FROM (date - %s))) ASC
        LIMIT 1
    """, (home_team_id, away_team_id, time_window_start, time_window_end, match_time))

    result = cursor.fetchone()
    return result

def convert_pinnacle_odds_to_football_format(binned_odds_data):
    """Convert Pinnacle binned_odds JSON to football_odds table format"""
    if not binned_odds_data or 'bins' not in binned_odds_data:
        return None, None, None, None, None, None, None

    bins = binned_odds_data['bins']
    if not bins:
        return None, None, None, None, None, None, None

    # Initialize arrays for different odds types
    odds_x12 = []
    odds_ah = []
    odds_ou = []
    lines = []
    ids = []  # Pinnacle doesn't provide IDs, so use empty array
    max_stakes = []

    # Track latest timestamps
    latest_x12_ts = None
    latest_ah_ts = None
    latest_ou_ts = None

    for bin_data in bins:
        # Skip if bin_data is None or doesn't have timestamp
        if not bin_data or 'ts' not in bin_data:
            continue
            
        ts = bin_data['ts']

        # Initialize objects for this timestamp
        current_lines = {}
        current_max_stakes = {}

        # Process moneyline (X12)
        if 'moneyline' in bin_data and bin_data['moneyline']:
            moneyline = bin_data['moneyline']
            # Check that all required keys exist and are not None
            if (all(key in moneyline for key in ['home', 'draw', 'away']) and
                moneyline['home'] and moneyline['draw'] and moneyline['away'] and
                'price' in moneyline['home'] and 'price' in moneyline['draw'] and 'price' in moneyline['away']):
                
                try:
                    # Convert decimal odds to basis points (multiply by 100), round to nearest int
                    home_price = round(float(moneyline['home']['price']) * 100)
                    draw_price = round(float(moneyline['draw']['price']) * 100)
                    away_price = round(float(moneyline['away']['price']) * 100)

                    odds_x12.append({
                        't': ts,
                        'x12': [home_price, draw_price, away_price]
                    })

                    # Add max stakes for X12
                    current_max_stakes['max_stake_x12'] = [
                        moneyline['home'].get('max_stake', 0),
                        moneyline['draw'].get('max_stake', 0),
                        moneyline['away'].get('max_stake', 0)
                    ]

                    latest_x12_ts = ts
                except (ValueError, TypeError, KeyError) as e:
                    # Skip this bin if there's an error converting odds
                    pass

        # Process spreads (Asian Handicap)
        if 'spreads' in bin_data and bin_data['spreads']:
            spreads = bin_data['spreads']
            ah_h_odds = []
            ah_a_odds = []
            ah_lines = []
            ah_max_stakes = []

            # Sort spreads by line value for consistency
            sorted_spreads = sorted(spreads.items(), key=lambda x: float(x[0]))
            
            for line_key, spread_data in sorted_spreads:
                if (spread_data and spread_data.get('home') and spread_data.get('away') and
                    'price' in spread_data['home'] and 'price' in spread_data['away']):
                    
                    try:
                        # Convert line key to float
                        line_value = float(line_key)
                        ah_lines.append(line_value)

                        # Convert decimal odds to basis points, round to nearest int
                        home_price = round(float(spread_data['home']['price']) * 100)
                        away_price = round(float(spread_data['away']['price']) * 100)

                        ah_h_odds.append(home_price)
                        ah_a_odds.append(away_price)
                        
                        # Add max stake for this line
                        max_stake = spread_data['home'].get('max_stake', 0)
                        ah_max_stakes.append(max_stake)
                    except (ValueError, TypeError, KeyError) as e:
                        # Skip this line if there's an error
                        continue

            if ah_h_odds and ah_a_odds and ah_lines:
                odds_ah.append({
                    't': ts,
                    'ah_h': ah_h_odds,
                    'ah_a': ah_a_odds
                })

                current_lines['ah'] = ah_lines

                # Add max stakes for AH
                current_max_stakes['max_stake_ah'] = {
                    'h': ah_max_stakes,
                    'a': ah_max_stakes  # Same max stakes for both sides
                }

                latest_ah_ts = ts

        # Process totals (Over/Under)
        if 'totals_2_5' in bin_data and bin_data['totals_2_5']:
            totals = bin_data['totals_2_5']
            if (totals.get('over') and totals.get('under') and
                'price' in totals['over'] and 'price' in totals['under']):
                
                try:
                    # Convert decimal odds to basis points, round to nearest int
                    over_price = round(float(totals['over']['price']) * 100)
                    under_price = round(float(totals['under']['price']) * 100)

                    odds_ou.append({
                        't': ts,
                        'ou_o': [over_price],
                        'ou_u': [under_price]
                    })

                    current_lines['ou'] = [2.5]  # Fixed line of 2.5

                    # Add max stakes for OU
                    current_max_stakes['max_stake_ou'] = {
                        'o': [totals['over'].get('max_stake', 0)],
                        'u': [totals['under'].get('max_stake', 0)]
                    }

                    latest_ou_ts = ts
                except (ValueError, TypeError, KeyError) as e:
                    # Skip this bin if there's an error
                    pass

        # Add consolidated lines and max_stakes for this timestamp
        if current_lines:
            lines.append({'t': ts, **current_lines})
        if current_max_stakes:
            max_stakes.append({'t': ts, **current_max_stakes})

    # Create latest_t object
    latest_t = {}
    timestamps = []
    if latest_x12_ts:
        latest_t['x12_ts'] = latest_x12_ts
        timestamps.append(latest_x12_ts)
    if latest_ah_ts:
        latest_t['ah_ts'] = latest_ah_ts
        timestamps.append(latest_ah_ts)
    if latest_ou_ts:
        latest_t['ou_ts'] = latest_ou_ts
        timestamps.append(latest_ou_ts)
    if timestamps:
        max_ts = max(timestamps)
        latest_t['ids_ts'] = max_ts
        latest_t['stakes_ts'] = max_ts
        latest_t['lines_ts'] = max_ts

    return odds_x12, odds_ah, odds_ou, lines, ids, max_stakes, latest_t

def check_and_add_pinnacle_odds(fixture_id, binned_odds_data, cursor):
    """Check if Pinnacle odds exist for fixture, add or update them"""
    try:
        # Check if Pinnacle odds already exist
        cursor.execute("""
            SELECT fixture_id FROM football_odds
            WHERE fixture_id = %s AND bookie = 'Pinnacle'
        """, (fixture_id,))

        odds_exist = cursor.fetchone() is not None

        # Handle binned_odds (can be dict, string, or None)
        if not binned_odds_data:
            return False

        # If it's a string, parse it as JSON; if it's already a dict, use it directly
        if isinstance(binned_odds_data, str):
            try:
                binned_odds_data = json.loads(binned_odds_data)
            except json.JSONDecodeError as e:
                print(f"Error parsing binned_odds JSON for fixture {fixture_id}: {e}")
                return False
        elif not isinstance(binned_odds_data, dict):
            print(f"Invalid binned_odds type for fixture {fixture_id}: {type(binned_odds_data)}")
            return False

        odds_x12, odds_ah, odds_ou, lines, ids, max_stakes, latest_t = convert_pinnacle_odds_to_football_format(binned_odds_data)

        # Only insert/update if we have some odds data
        if not odds_x12 and not odds_ah and not odds_ou:
            return False

        if odds_exist:
            # Update existing Pinnacle odds
            cursor.execute("""
                UPDATE football_odds
                SET bookie_id = 1,
                    decimals = 2,
                    odds_x12 = %s,
                    odds_ah = %s,
                    odds_ou = %s,
                    lines = %s,
                    max_stakes = %s,
                    latest_t = %s,
                    updated_at = NOW()
                WHERE fixture_id = %s AND bookie = 'Pinnacle'
            """, (
                Json(odds_x12) if odds_x12 else None,
                Json(odds_ah) if odds_ah else None,
                Json(odds_ou) if odds_ou else None,
                Json(lines) if lines else None,
                Json(max_stakes) if max_stakes else None,
                Json(latest_t) if latest_t else None,
                fixture_id
            ))
        else:
            # Insert new Pinnacle odds using psycopg2 Json wrapper
            cursor.execute("""
                INSERT INTO football_odds (
                    fixture_id, bookie, bookie_id, decimals,
                    odds_x12, odds_ah, odds_ou, lines, max_stakes, latest_t,
                    created_at, updated_at
                ) VALUES (
                    %s, 'Pinnacle', 1, 2,
                    %s, %s, %s, %s, %s, %s,
                    NOW(), NOW()
                )
            """, (
                fixture_id,
                Json(odds_x12) if odds_x12 else None,
                Json(odds_ah) if odds_ah else None,
                Json(odds_ou) if odds_ou else None,
                Json(lines) if lines else None,
                Json(max_stakes) if max_stakes else None,
                Json(latest_t) if latest_t else None
            ))

        return True

    except Exception as e:
        print(f"Error adding/updating Pinnacle odds for fixture {fixture_id}: {e}")
        return False

def main():
    """Main function to match pinnacle fixtures with football fixtures"""
    # Check for dry-run mode
    dry_run = '--dry-run' in sys.argv
    if dry_run:
        print("DRY RUN MODE: No data will be inserted into the database")
        print("=" * 60)
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Check if pinnacle_odds_history table exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'pinnacle_odds_history'
            )
        """)

        if not cursor.fetchone()['exists']:
            print("Error: pinnacle_odds_history table does not exist in the database")
            print("Please ensure the table exists with columns: home, away, start_timestamp")
            sys.exit(1)

        # Get total count of pinnacle fixtures
        try:
            cursor.execute("SELECT COUNT(*) as total FROM pinnacle_odds_history")
            total_fixtures = cursor.fetchone()['total']
        except psycopg2.Error as e:
            print(f"Error querying pinnacle_odds_history table: {e}")
            print("Please ensure the table has the correct structure")
            sys.exit(1)

        if total_fixtures == 0:
            print("No fixtures found in pinnacle_odds_history table")
            return

        print(f"Processing {total_fixtures} pinnacle fixtures...")

        # Process each pinnacle fixture
        cursor.execute("""
            SELECT home, away, start_timestamp, binned_odds
            FROM pinnacle_odds_history
            ORDER BY start_timestamp
        """)

        matches_found = 0
        processed = 0
        odds_modified = 0

        for row in cursor.fetchall():
            home_team = row['home']
            away_team = row['away']
            timestamp = row['start_timestamp']
            binned_odds = row.get('binned_odds')

            # Find matching fixture
            match = find_fixture_match(home_team, away_team, timestamp, cursor)

            if match:
                matches_found += 1
                fixture_id = match['id']
                
                try:
                    # Check and add/update Pinnacle odds
                    if dry_run:
                        # In dry-run mode, just check if odds would be modified
                        if binned_odds:
                            odds_modified += 1
                            if odds_modified <= 5:  # Show first 5 matches in dry-run
                                print(f"Would add/update odds for: {home_team} vs {away_team} (fixture {fixture_id})")
                    else:
                        if check_and_add_pinnacle_odds(fixture_id, binned_odds, cursor):
                            odds_modified += 1
                            conn.commit()  # Commit after each successful insert/update
                            if odds_modified % 10 == 0:
                                print(f"Added/updated odds for {odds_modified} fixtures so far...")
                except Exception as e:
                    print(f"Error processing fixture {fixture_id} ({home_team} vs {away_team}): {e}")
                    if not dry_run:
                        conn.rollback()

            processed += 1

            # Progress indicator every 100 fixtures
            if processed % 100 == 0:
                print(f"Processed {processed}/{total_fixtures} fixtures... (Matched: {matches_found}, Odds added/updated: {odds_modified})")

        # Calculate match percentage
        match_percentage = (matches_found / total_fixtures * 100) if total_fixtures > 0 else 0

        # Print results
        print(f"\n{'DRY RUN ' if dry_run else ''}Results:")
        print(f"Total pinnacle fixtures: {total_fixtures}")
        print(f"Matches found: {matches_found}")
        print(f"Match percentage: {match_percentage:.2f}%")
        print(f"Pinnacle odds {'would be added/updated' if dry_run else 'added/updated'}: {odds_modified}")
        
        if dry_run:
            print("\nTo actually insert the data, run the script without --dry-run flag")

    except psycopg2.Error as e:
        print(f"Database error: {e}")
        sys.exit(1)
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    main()

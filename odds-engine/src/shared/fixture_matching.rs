use chrono::NaiveDateTime;
use regex::Regex;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};

/// Process team name by normalizing characters, removing punctuation, removing numbers,
/// removing words 2 letters or less and converting to lowercase
pub fn normalize_team_name(team_name: &str) -> String {
    if team_name.is_empty() {
        return String::new();
    }

    // 1. Normalize characters (remove accents/diacritics)
    let mut normalized = team_name.to_lowercase();

    // 2. Remove punctuation and special characters
    // Regex: [.,/\\\-_()[\]{}+*=|<>?!@#$%^&*~`'":;]
    let re_punct = Regex::new(r#"[.,/\\\-_()\[\]{}+*=|<>?!@#$%^&*~`'":;]"#).unwrap();
    normalized = re_punct.replace_all(&normalized, "").to_string();

    // 3. Remove digits
    let re_digits = Regex::new(r"\d+").unwrap();
    normalized = re_digits.replace_all(&normalized, "").to_string();

    // 4. Split into words, filter, and join
    let words: Vec<&str> = normalized.split_whitespace().collect();
    
    let filtered_words: Vec<&str> = words.into_iter()
        .filter(|w| w.len() > 2 && *w != "afc")
        .collect();

    filtered_words.join(" ")
}

/// Get team mappings from football_teams table for the given team IDs
async fn get_team_mappings(pool: &PgPool, team_ids: &[i32]) -> Result<HashMap<i32, Vec<String>>, sqlx::Error> {
    if team_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT id, name, mappings
        FROM football_teams
        WHERE id = ANY($1)
        "#,
        team_ids
    )
    .fetch_all(pool)
    .await?;

    let mut mappings_map = HashMap::new();

    for row in rows {
        let mut names = Vec::new();
        
        // Add canonical name
        names.push(row.name);

        // Add mappings from JSONB
        if let Some(mappings_val) = row.mappings {
            if let Some(mappings_array) = mappings_val.as_array() {
                for m in mappings_array {
                    if let Some(s) = m.as_str() {
                        names.push(s.to_string());
                    }
                }
            }
        }

        mappings_map.insert(row.id, names);
    }

    Ok(mappings_map)
}

pub struct FixtureMatchCriteria {
    pub start_time: NaiveDateTime,
    pub home_team: String,
    pub away_team: String,
    pub league_id: i32,
}

/// Global helper function to find fixtures that match given criteria
/// Looks for fixtures within +/- 12 hours with matching team names and league
pub async fn find_matching_fixture(
    pool: &PgPool,
    criteria: FixtureMatchCriteria,
) -> Result<Option<i64>, Box<dyn std::error::Error + Send + Sync>> {
    let FixtureMatchCriteria { start_time, home_team, away_team, league_id } = criteria;

    // 1. Find fixtures within +/- 12 hours that match league
    // Note: We select status_short to filter, similar to TS logic
    let fixtures = sqlx::query!(
        r#"
        SELECT id, home_team_name, away_team_name, home_team_id, away_team_id, date
        FROM football_fixtures
        WHERE league_id = $1
          AND date >= $2::timestamp - INTERVAL '12 hours'
          AND date <= $2::timestamp + INTERVAL '12 hours'
          AND LOWER(status_short) IN ('ns', 'tbd', 'pst')
        "#,
        league_id as i64,
        start_time
    )
    .fetch_all(pool)
    .await?;

    if fixtures.is_empty() {
        return Ok(None);
    }

    // 2. Collect unique team IDs to fetch mappings
    let mut team_ids = HashSet::new();
    for f in &fixtures {
        if let Some(id) = f.home_team_id { team_ids.insert(id as i32); }
        if let Some(id) = f.away_team_id { team_ids.insert(id as i32); }
    }
    let team_ids_vec: Vec<i32> = team_ids.into_iter().collect();

    // 3. Load team mappings
    let team_mappings = get_team_mappings(pool, &team_ids_vec).await?;

    // 4. Normalize input names
    let norm_home_input = normalize_team_name(&home_team);
    let norm_away_input = normalize_team_name(&away_team);

    // 5. Check for matches
    for fixture in fixtures {
        // Get all possible names for home team
        let mut home_candidates = vec![];
        if let Some(name) = &fixture.home_team_name {
            home_candidates.push(name.clone());
        }
        if let Some(id) = fixture.home_team_id {
            if let Some(mappings) = team_mappings.get(&(id as i32)) {
                home_candidates.extend(mappings.clone());
            }
        }

        // Get all possible names for away team
        let mut away_candidates = vec![];
        if let Some(name) = &fixture.away_team_name {
            away_candidates.push(name.clone());
        }
        if let Some(id) = fixture.away_team_id {
            if let Some(mappings) = team_mappings.get(&(id as i32)) {
                away_candidates.extend(mappings.clone());
            }
        }

        // Check home match
        let home_match = home_candidates.iter().any(|candidate| {
            let norm_candidate = normalize_team_name(candidate);
            !norm_home_input.is_empty() && !norm_candidate.is_empty() &&
            (norm_candidate.contains(&norm_home_input) || norm_home_input.contains(&norm_candidate))
        });

        // Check away match
        let away_match = away_candidates.iter().any(|candidate| {
            let norm_candidate = normalize_team_name(candidate);
            !norm_away_input.is_empty() && !norm_candidate.is_empty() &&
            (norm_candidate.contains(&norm_away_input) || norm_away_input.contains(&norm_candidate))
        });

        if home_match && away_match {
            return Ok(Some(fixture.id));
        }
    }

    Ok(None)
}

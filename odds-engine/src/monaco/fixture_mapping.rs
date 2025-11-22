use serde_json::Value;
use sqlx::PgPool;
use tracing::info;

pub async fn find_fixture_by_event(
    pool: &PgPool,
    event: &Value,
    event_id: &str,
) -> Result<Option<i64>, Box<dyn std::error::Error + Send + Sync>> {
    // Parse team names from event name (e.g., "Manchester United v Liverpool")
    let event_name = match event["name"].as_str() {
        Some(name) => name,
        None => return Ok(None),
    };

    let teams: Vec<&str> = event_name.split(" v ").collect();
    if teams.len() != 2 {
        return Ok(None);
    }

    let home_team = teams[0].trim();
    let away_team = teams[1].trim();

    // Parse expected start time
    let expected_start_time = match event["expectedStartTime"].as_str() {
        Some(time_str) => match chrono::DateTime::parse_from_rfc3339(time_str) {
            Ok(dt) => dt.naive_utc(),
            Err(_) => return Ok(None),
        },
        None => return Ok(None),
    };

    // Get event group ID
    let event_group_id = match event["eventGroup"]["_ids"][0].as_str() {
        Some(id) => id,
        None => return Ok(None),
    };

    // Find league by Monaco event group
    let league_result = sqlx::query_scalar::<_, i32>(
        r#"
        SELECT id FROM football_leagues
        WHERE "monaco_eventGroup" = $1
           OR "monaco_eventGroup" LIKE $2
           OR "monaco_eventGroup" LIKE $3
           OR "monaco_eventGroup" LIKE $4
        LIMIT 1
        "#
    )
    .bind(event_group_id)
    .bind(format!("{},%", event_group_id))
    .bind(format!("%,{}", event_group_id))
    .bind(format!("%,{},%", event_group_id))
    .fetch_optional(pool)
    .await?;

    let league_id = match league_result {
        Some(id) => id,
        None => {
            info!("No league found for event_group={}", event_group_id);
            return Ok(None);
        }
    };

    // Find matching fixture
    // Allow 24 hour window for start time matching
    let fixture_result = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT id FROM football_fixtures
        WHERE league_id = $1
          AND (
              (LOWER(home_team_name) LIKE LOWER($2) AND LOWER(away_team_name) LIKE LOWER($3))
              OR (similarity(home_team_name, $4) > 0.6 AND similarity(away_team_name, $5) > 0.6)
          )
          AND date BETWEEN $6 - INTERVAL '24 hours' AND $6 + INTERVAL '24 hours'
        ORDER BY date
        LIMIT 1
        "#
    )
    .bind(league_id)
    .bind(format!("%{}%", home_team))
    .bind(format!("%{}%", away_team))
    .bind(home_team)
    .bind(away_team)
    .bind(expected_start_time)
    .fetch_optional(pool)
    .await?;

    if let Some(fixture_id) = fixture_result {
        info!("✅ Mapped event_id={} to fixture_id={} ({} v {})", event_id, fixture_id, home_team, away_team);
    }

    Ok(fixture_result)
}

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::sync::broadcast;
use tokio::task;
use tracing::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionResponse {
    sessions: Vec<MonacoSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonacoSession {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
    #[serde(rename = "accessExpiresAt")]
    pub access_expires_at: String,
    #[serde(rename = "refreshExpiresAt")]
    pub refresh_expires_at: String,
}

#[derive(Clone)]
pub struct MonacoApiClient {
    base_url: String,
    app_id: String,
    api_key: String,
    client: Client,
    access_token: Option<String>,
    refresh_token: Option<String>,
    access_expires_at: Option<SystemTime>,
    refresh_expires_at: Option<SystemTime>,
    api_request_timestamps: Vec<u128>,
    token_refresh_tx: Arc<broadcast::Sender<String>>,
}

impl MonacoApiClient {
    pub fn new(base_url: String, app_id: String, api_key: String) -> Self {
        let (tx, _) = broadcast::channel(10);
        Self {
            base_url,
            app_id,
            api_key,
            client: Client::new(),
            access_token: None,
            refresh_token: None,
            access_expires_at: None,
            refresh_expires_at: None,
            api_request_timestamps: Vec::new(),
            token_refresh_tx: Arc::new(tx),
        }
    }

    pub fn subscribe_token_refresh(&self) -> broadcast::Receiver<String> {
        self.token_refresh_tx.subscribe()
    }

    pub fn get_access_token(&self) -> Option<String> {
        self.access_token.clone()
    }

    async fn check_api_rate_limit(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis();

        let one_second_ago = now - 1000;
        self.api_request_timestamps.retain(|&timestamp| timestamp > one_second_ago);

        if self.api_request_timestamps.len() >= 1 {
            if let Some(&oldest_timestamp) = self.api_request_timestamps.iter().min() {
                let wait_time = 1000u128.saturating_sub(now - oldest_timestamp);
                if wait_time > 0 {
                    info!("Rate limit: waiting {}ms before API request", wait_time);
                    tokio::time::sleep(std::time::Duration::from_millis(wait_time as u64)).await;
                }
            }
        }

        self.api_request_timestamps.push(now);
        Ok(())
    }

    pub async fn authenticate(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Authenticating with Monaco API...");

        self.check_api_rate_limit().await?;

        let url = format!("{}/sessions", self.base_url);
        let body = serde_json::json!({
            "appId": self.app_id,
            "apiKey": self.api_key
        });

        let response = self.client.post(&url)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Authentication failed: {}", error_text).into());
        }

        let session_response: SessionResponse = response.json().await?;
        if let Some(session) = session_response.sessions.first() {
            self.update_session(session);
            info!("Authentication successful");
        } else {
            return Err("No session returned".into());
        }

        Ok(())
    }

    fn update_session(&mut self, session: &MonacoSession) {
        self.access_token = Some(session.access_token.clone());
        self.refresh_token = Some(session.refresh_token.clone());

        // Parse timestamps (assuming ISO 8601)
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&session.access_expires_at) {
            self.access_expires_at = Some(SystemTime::from(dt));
        }
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&session.refresh_expires_at) {
            self.refresh_expires_at = Some(SystemTime::from(dt));
        }

        // Schedule automatic token refresh
        self.schedule_token_refresh();

        // Notify listeners of token refresh
        if let Some(ref token) = self.access_token {
            let _ = self.token_refresh_tx.send(token.clone());
        }
    }

    fn schedule_token_refresh(&self) {
        if let Some(expires_at) = self.access_expires_at {
            let client_clone = self.clone();

            task::spawn(async move {
                // Refresh 2 minutes before expiration
                let refresh_time = expires_at
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or(Duration::from_secs(0))
                    .saturating_sub(Duration::from_secs(120));

                let now = SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or(Duration::from_secs(0));

                if refresh_time > now {
                    let delay = refresh_time - now;
                    info!("Scheduling token refresh in {} seconds", delay.as_secs());
                    tokio::time::sleep(delay).await;

                    // Perform the refresh
                    let mut client = client_clone;
                    if let Err(e) = client.refresh_access_token().await {
                        error!("Scheduled token refresh failed: {}", e);
                    }
                }
            });
        }
    }

    pub async fn ensure_authenticated(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if self.access_token.is_none() {
            return self.authenticate().await;
        }

        if let Some(expires_at) = self.access_expires_at {
            if SystemTime::now() > expires_at {
                return self.refresh_token_if_needed().await;
            }
        }

        Ok(())
    }

    async fn refresh_token_if_needed(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if self.refresh_token.is_none() || self.refresh_expires_at.is_none() {
            return self.authenticate().await;
        }

        // Check if refresh token is expired
        if let Some(refresh_expires) = self.refresh_expires_at {
            if SystemTime::now() > refresh_expires {
                return self.authenticate().await;
            }
        }

        // Refresh the access token
        self.refresh_access_token().await
    }

    async fn refresh_access_token(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Refreshing Monaco access token...");

        self.check_api_rate_limit().await?;

        let refresh_token = self.refresh_token.as_ref().unwrap();

        let url = format!("{}/sessions/refresh", self.base_url);
        let body = serde_json::json!({
            "refreshToken": refresh_token
        });

        let response = self.client.post(&url)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("Token refresh failed: {}", error_text).into());
        }

        let session_response: SessionResponse = response.json().await?;
        if let Some(session) = session_response.sessions.first() {
            self.update_session(session);
            info!("✅ Access token refreshed successfully");
            Ok(())
        } else {
            Err("Token refresh failed: No session returned".into())
        }
    }

    pub async fn fetch_markets(
        &mut self,
        page: u32,
        event_ids: Option<Vec<String>>,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        self.ensure_authenticated().await?;
        self.check_api_rate_limit().await?;

        let mut params = vec![
            ("marketTypeIds", "FOOTBALL_OVER_UNDER_TOTAL_GOALS,FOOTBALL_FULL_TIME_RESULT_HANDICAP,FOOTBALL_FULL_TIME_RESULT"),
            ("inPlayStatuses", "PrePlay,NotApplicable"),
            ("statuses", "Initializing,Open,Locked,Closed"),
            ("size", "2000"),
        ];

        let page_str = page.to_string();
        params.push(("page", &page_str));

        let event_ids_str;
        if let Some(ids) = event_ids {
            event_ids_str = ids.join(",");
            params.push(("eventIds", &event_ids_str));
        }

        info!("🔍 Fetching markets with params: {:?}", params);

        let response = self
            .client
            .get(&format!("{}/markets", self.base_url))
            .header("Authorization", format!("Bearer {}", self.access_token.as_ref().unwrap()))
            .query(&params)
            .send()
            .await?;

        let data: serde_json::Value = response.json().await?;
        Ok(data)
    }

    pub async fn fetch_all_markets(
        &mut self,
        event_ids: Option<Vec<String>>,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let mut page = 0;
        let mut all_markets = Vec::new();
        let mut all_events = Vec::new();
        let mut all_event_groups = Vec::new();

        loop {
            let data = self.fetch_markets(page, event_ids.clone()).await?;

            // Extract markets from this page
            if let Some(markets) = data.get("markets") {
                if let Some(markets_array) = markets.as_array() {
                    all_markets.extend(markets_array.clone());
                }
            }

            // Extract events from this page
            if let Some(events) = data.get("events") {
                if let Some(events_array) = events.as_array() {
                    all_events.extend(events_array.clone());
                }
            }

            // Extract event groups from this page
            if let Some(event_groups) = data.get("eventGroups") {
                if let Some(event_groups_array) = event_groups.as_array() {
                    all_event_groups.extend(event_groups_array.clone());
                }
            }

            // Check if we got less than 2000 markets (page size), indicating this is the last page
            if let Some(markets) = data.get("markets") {
                if let Some(markets_array) = markets.as_array() {
                    if markets_array.len() < 2000 {
                        break;
                    }
                } else {
                    // If markets is not an array, we've likely got all data
                    break;
                }
            } else {
                // If no markets field, we've likely got all data
                break;
            }

            page += 1;
            info!("Fetched page {} ({} markets so far), continuing to next page...", page, all_markets.len());
        }

        // Return combined data in the same format as individual fetch_markets calls
        let result = serde_json::json!({
            "markets": all_markets,
            "events": all_events,
            "eventGroups": all_event_groups
        });

        info!("✅ Fetched all markets: {} markets, {} events, {} event groups across {} pages",
              all_markets.len(), all_events.len(), all_event_groups.len(), page + 1);

        Ok(result)
    }
}

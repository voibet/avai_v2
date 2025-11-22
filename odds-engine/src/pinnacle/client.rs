use crate::pinnacle::types::PinnacleMarket;
use reqwest::Client;
use std::env;
use std::error::Error;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tracing::error;

pub struct PinnacleApiClient {
    client: Client,
    base_url: String,
    api_key: String,
    last_timestamp: Option<i64>,
    last_request_time: Option<Instant>,
}

impl PinnacleApiClient {
    pub fn new() -> Self {
        let api_key = env::var("RAPID_API_KEY").unwrap_or_default();
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self {
            client,
            base_url: "https://pinnacle-odds.p.rapidapi.com".to_string(),
            api_key,
            last_timestamp: None,
            last_request_time: None,
        }
    }

    pub async fn fetch_odds(&mut self) -> Result<Option<PinnacleMarket>, Box<dyn Error + Send + Sync>> {
        if self.api_key.is_empty() {
            error!("RAPID_API_KEY not set");
            return Ok(None);
        }

        // Rate limiting: ensure at least 1 second between requests (MEGA plan limit)
        if let Some(last_time) = self.last_request_time {
            let elapsed = last_time.elapsed();
            if elapsed < Duration::from_secs(1) {
                let sleep_duration = Duration::from_secs(1) - elapsed;
                sleep(sleep_duration).await;
            }
        }

        self.last_request_time = Some(Instant::now());

        let mut params = vec![
            ("event_type", "prematch"),
            ("sport_id", "1"), // Football
        ];

        let since_str = if let Some(ts) = self.last_timestamp {
            ts.to_string()
        } else {
            (chrono::Utc::now().timestamp()).to_string()
        };
        
        params.push(("since", &since_str));

        let url = format!("{}/kit/v1/markets", self.base_url);
        
        let response = self.client
            .get(&url)
            .header("x-rapidapi-key", &self.api_key)
            .header("x-rapidapi-host", "pinnacle-odds.p.rapidapi.com")
            .query(&params)
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;

        if !status.is_success() {
            error!("Pinnacle API error: {} - Body: {}", status, text);
            return Ok(None);
        }

        // info!("Pinnacle API response: {}", text); // Uncomment for verbose debugging

        let market_data: PinnacleMarket = match serde_json::from_str(&text) {
            Ok(data) => data,
            Err(e) => {
                error!("Failed to parse Pinnacle API response: {} - Body: {}", e, text);
                return Ok(None);
            }
        };

        // Update last timestamp
        self.last_timestamp = Some(market_data.last);

        Ok(Some(market_data))
    }
}

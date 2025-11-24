use futures::{SinkExt, StreamExt};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tracing::{info, error};
use url::Url;

use crate::monaco::client::MonacoApiClient;

pub struct MonacoWebSocketClient {
    stream_url: String,
    api_client: Arc<Mutex<MonacoApiClient>>,
    tx: tokio::sync::broadcast::Sender<Value>, // Broadcast raw JSON messages to internal handlers
}

impl MonacoWebSocketClient {
    pub fn new(stream_url: String, api_client: Arc<Mutex<MonacoApiClient>>) -> Self {
        let (tx, _) = tokio::sync::broadcast::channel(100);
        Self {
            stream_url,
            api_client,
            tx,
        }
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<Value> {
        self.tx.subscribe()
    }

    pub async fn subscribe_token_refresh(&self) -> tokio::sync::broadcast::Receiver<String> {
        let client = self.api_client.lock().await;
        client.subscribe_token_refresh()
    }


    pub async fn start(&self) {
        let mut token_refresh_rx = self.subscribe_token_refresh().await;
        let mut retry_count: u32 = 0;
        let max_backoff_secs = 60; // Cap at 1 minute

        loop {
            // Calculate backoff with exponential strategy (2^n seconds, capped at max)
            let backoff_secs = if retry_count == 0 {
                0
            } else {
                std::cmp::min(2u64.pow(retry_count.saturating_sub(1)), max_backoff_secs)
            };

            if backoff_secs > 0 {
                info!("⏳ Waiting {}s before reconnecting (attempt {})...", backoff_secs, retry_count + 1);
                sleep(Duration::from_secs(backoff_secs)).await;
            }

            // Start WebSocket connection
            let connect_task = self.connect_and_listen();

            tokio::select! {
                result = connect_task => {
                    match result {
                        Ok(_) => {
                            info!("✅ WebSocket connection closed gracefully");
                            retry_count = 0; // Reset on successful connection
                        }
                        Err(e) => {
                            retry_count = retry_count.saturating_add(1);
                            error!("❌ WebSocket error (attempt {}): {}", retry_count, e);
                        }
                    }
                }
                // Listen for token refresh notifications
                Ok(_) = token_refresh_rx.recv() => {
                    info!("🔄 Token refreshed, reconnecting WebSocket...");
                    retry_count = 0; // Reset retry counter on token refresh
                    // Resubscribe to token refresh notifications after reconnection
                    token_refresh_rx = self.subscribe_token_refresh().await;
                }
            }
        }
    }

    async fn connect_and_listen(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("🔌 Connecting to Monaco WebSocket: {}", self.stream_url);
        
        let url = Url::parse(&self.stream_url)?;
        let (ws_stream, _) = connect_async(url).await?;
        info!("✅ WebSocket connected to Monaco");

        let (mut write, mut read) = ws_stream.split();

        // Authenticate
        let access_token = {
            let mut client = self.api_client.lock().await;
            client.ensure_authenticated().await?;
            client.get_access_token().ok_or("No access token available")?
        };

        let auth_msg = serde_json::json!({
            "action": "authenticate",
            "accessToken": access_token
        });

        write.send(Message::Text(auth_msg.to_string())).await?;
        info!("🔐 Sent authentication message to Monaco");

        while let Some(msg) = read.next().await {
            let msg = msg?;
            if let Message::Text(text) = msg {
                let data: Value = serde_json::from_str(&text)?;
                
                // Handle Authentication Confirmation
                if data["type"] == "AuthenticationUpdate" {
                    info!("✅ Monaco Authentication Confirmed. Subscribing to updates...");
                    
                    // Only subscribe to price and status updates (EventUpdate handled by periodic refresh)
                    let subscriptions = vec![
                        ("MarketPriceUpdate", vec!["*"]),
                        ("MarketStatusUpdate", vec!["*"]),
                    ];

                    for (sub_type, ids) in subscriptions {
                        let sub_msg = serde_json::json!({
                            "action": "subscribe",
                            "subscriptionType": sub_type,
                            "subscriptionIds": ids
                        });
                        write.send(Message::Text(sub_msg.to_string())).await?;
                        info!("📡 Subscribed to {}", sub_type);
                        sleep(Duration::from_millis(100)).await; // Rate limit protection
                    }
                } else {
                    // Log received message type
                    if let Some(msg_type) = data["type"].as_str() {
                        info!("📨 Received: {} (broadcasting to {} subscribers)", msg_type, self.tx.receiver_count());
                    }
                    // Forward other messages
                    let _ = self.tx.send(data);
                }
            }
        }

        Ok(())
    }
}

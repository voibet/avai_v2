use futures::{SinkExt, StreamExt};
use futures::stream::SplitSink;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration, interval};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message, WebSocketStream, MaybeTlsStream};
use tokio::net::TcpStream;
use tracing::{info, error, debug};
use url::Url;

/// Keepalive ping interval in seconds
const PING_INTERVAL_SECS: u64 = 60;

use crate::monaco::client::MonacoApiClient;

type WsWriter = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

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
            match self.connect_and_listen().await {
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
    }

    /// Send authentication message on WebSocket
    async fn send_auth(&self, write: &Arc<Mutex<WsWriter>>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let access_token = {
            let mut client = self.api_client.lock().await;
            client.ensure_authenticated().await?;
            client.get_access_token().ok_or("No access token available")?
        };

        let auth_msg = serde_json::json!({
            "action": "authenticate",
            "accessToken": access_token
        });

        let mut writer = write.lock().await;
        writer.send(Message::Text(auth_msg.to_string())).await?;
        info!("🔐 Sent authentication message to Monaco");
        Ok(())
    }

    /// Send subscription messages on WebSocket
    async fn send_subscriptions(&self, write: &Arc<Mutex<WsWriter>>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let subscriptions = vec![
            ("MarketPriceUpdate", vec!["*"]),
            ("MarketStatusUpdate", vec!["*"]),
        ];

        let mut writer = write.lock().await;
        for (sub_type, ids) in subscriptions {
            let sub_msg = serde_json::json!({
                "action": "subscribe",
                "subscriptionType": sub_type,
                "subscriptionIds": ids
            });
            writer.send(Message::Text(sub_msg.to_string())).await?;
            info!("📡 Subscribed to {}", sub_type);
            sleep(Duration::from_millis(100)).await; // Rate limit protection
        }
        Ok(())
    }

    async fn connect_and_listen(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("🔌 Connecting to Monaco WebSocket: {}", self.stream_url);
        
        let url = Url::parse(&self.stream_url)?;
        let (ws_stream, _) = connect_async(url).await?;
        info!("✅ WebSocket connected to Monaco");

        let (write, mut read) = ws_stream.split();
        let write = Arc::new(Mutex::new(write));

        // Initial authentication
        self.send_auth(&write).await?;

        // Track if we've subscribed (only subscribe once per connection)
        let mut subscribed = false;

        // Subscribe to token refresh notifications
        let mut token_refresh_rx = self.subscribe_token_refresh().await;

        // Keepalive ping interval
        let mut ping_interval = interval(Duration::from_secs(PING_INTERVAL_SECS));

        loop {
            tokio::select! {
                // Handle incoming WebSocket messages
                msg_result = read.next() => {
                    match msg_result {
                        Some(Ok(Message::Text(text))) => {
                            let mut data: Value = serde_json::from_str(&text)?;

                            // Handle Authentication Confirmation
                            if data["type"] == "AuthenticationUpdate" {
                                if !subscribed {
                                    info!("✅ Monaco Authentication Confirmed. Subscribing to updates...");
                                    self.send_subscriptions(&write).await?;
                                    subscribed = true;
                                } else {
                                    info!("✅ Monaco Re-Authentication Confirmed (subscriptions preserved)");
                                }
                            } else {
                                // Add received timestamp for latency measurement
                                let received_at = chrono::Utc::now().timestamp_millis();
                                data["_received_at"] = serde_json::json!(received_at);

                                // Log received message type
                                if let Some(msg_type) = data["type"].as_str() {
                                    debug!("📨 Received: {} (broadcasting to {} subscribers)", msg_type, self.tx.receiver_count());
                                }
                                // Forward other messages
                                let _ = self.tx.send(data);
                            }
                        }
                        Some(Ok(Message::Ping(data))) => {
                            // Respond to ping with pong
                            let mut writer = write.lock().await;
                            let _ = writer.send(Message::Pong(data)).await;
                        }
                        Some(Ok(Message::Close(_))) => {
                            info!("🔌 Monaco WebSocket closed by server");
                            return Ok(());
                        }
                        Some(Ok(_)) => {
                            // Ignore other message types (Binary, Pong, etc.)
                        }
                        Some(Err(e)) => {
                            return Err(e.into());
                        }
                        None => {
                            // Stream ended
                            info!("🔌 Monaco WebSocket stream ended");
                            return Ok(());
                        }
                    }
                }

                // Handle token refresh - re-authenticate on existing connection
                Ok(new_token) = token_refresh_rx.recv() => {
                    info!("🔄 Token refreshed, re-authenticating on existing connection...");
                    
                    // Send new authentication with refreshed token
                    let auth_msg = serde_json::json!({
                        "action": "authenticate",
                        "accessToken": new_token
                    });
                    
                    let mut writer = write.lock().await;
                    if let Err(e) = writer.send(Message::Text(auth_msg.to_string())).await {
                        error!("❌ Failed to send re-authentication: {}", e);
                        return Err(e.into());
                    }
                    info!("🔐 Sent re-authentication message (no reconnection needed)");
                }

                // Send periodic ping to keep connection alive
                _ = ping_interval.tick() => {
                    let mut writer = write.lock().await;
                    if let Err(e) = writer.send(Message::Ping(vec![])).await {
                        error!("❌ Failed to send keepalive ping: {}", e);
                        return Err(e.into());
                    }
                    debug!("💓 Sent keepalive ping");
                }
            }
        }
    }
}

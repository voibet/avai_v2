use serde::Serialize;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tracing::{info, warn};

/// Update to send to odds-processor
/// Matches the same data format stored in football_odds table
#[derive(Debug, Clone, Serialize)]
pub struct OddsUpdate {
    pub fixture_id: i64,
    pub bookie_id: i64,
    pub bookmaker: String,
    pub timestamp: i64,
    #[serde(default)]
    pub start: i64,               // First touch - when odds were received from bookmaker API (ms)
    pub decimals: i32,

    // X12 odds (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x12: Option<[i32; 3]>,

    // AH odds (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ah_lines: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ah_h: Option<Vec<i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ah_a: Option<Vec<i32>>,

    // OU odds (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ou_lines: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ou_o: Option<Vec<i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ou_u: Option<Vec<i32>>,

    // IDs (matches ids column in DB)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<serde_json::Value>,

    // Max stakes (matches max_stakes column in DB)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_stakes: Option<serde_json::Value>,

    // Latest timestamps per market type (matches latest_t column in DB)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_t: Option<serde_json::Value>,
}

impl Default for OddsUpdate {
    fn default() -> Self {
        Self {
            fixture_id: 0,
            bookie_id: 0,
            bookmaker: String::new(),
            timestamp: 0,
            start: 0,
            decimals: 3,
            x12: None,
            ah_lines: None,
            ah_h: None,
            ah_a: None,
            ou_lines: None,
            ou_o: None,
            ou_u: None,
            ids: None,
            max_stakes: None,
            latest_t: None,
        }
    }
}

/// Client for sending updates to odds-processor
pub struct ProcessorClient {
    addr: String,
    stream: Mutex<Option<TcpStream>>,
}

impl ProcessorClient {
    pub fn new(addr: &str) -> Self {
        Self {
            addr: addr.to_string(),
            stream: Mutex::new(None),
        }
    }

    /// Connect to odds-processor
    async fn connect(&self) -> Result<(), std::io::Error> {
        let mut stream_guard = self.stream.lock().await;
        
        if stream_guard.is_some() {
            return Ok(());
        }

        info!("🔌 Connecting to odds-processor at {}...", self.addr);
        match TcpStream::connect(&self.addr).await {
            Ok(stream) => {
                info!("✅ Connected to odds-processor at {}", self.addr);
                *stream_guard = Some(stream);
                Ok(())
            }
            Err(e) => {
                warn!("❌ Failed to connect to odds-processor at {}: {}", self.addr, e);
                Err(e)
            }
        }
    }

    /// Send an update to odds-processor
    pub async fn send(&self, update: &OddsUpdate) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Try to connect if not connected
        if let Err(e) = self.connect().await {
            // We return the error here so the caller knows the update wasn't sent.
            // In the main loop, we can decide whether to log this as error or warn.
            return Err(Box::new(e));
        }

        let mut stream_guard = self.stream.lock().await;
        
        if let Some(ref mut stream) = *stream_guard {
            let json = serde_json::to_string(update)?;
            let line = format!("{}\n", json);
            
            match stream.write_all(line.as_bytes()).await {
                Ok(_) => {
                    // debug!("📤 Sent update to odds-processor: fixture_id={}", update.fixture_id);
                    Ok(())
                }
                Err(e) => {
                    warn!("⚠️ Failed to send to odds-processor: {}. Dropping connection.", e);
                    *stream_guard = None;
                    Err(Box::new(e))
                }
            }
        } else {
            // This should theoretically not happen if connect() succeeded, 
            // but if the lock was released and re-acquired (not possible here as we hold it),
            // or if logic changes.
            Err("No connection available".into())
        }
    }
}

/// Create a shared processor client
pub fn create_processor_client(enabled: bool, port: u16) -> Option<Arc<ProcessorClient>> {
    if enabled {
        let addr = format!("127.0.0.1:{}", port);
        info!("🔗 Processor client will connect to {}", addr);
        Some(Arc::new(ProcessorClient::new(&addr)))
    } else {
        info!("📡 Processor client disabled");
        None
    }
}


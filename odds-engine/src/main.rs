mod config;
mod shared;
mod monaco;
mod pinnacle;
mod processor_client;

use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    response::IntoResponse,
    routing::get,
    Router,
};
use config::Config;
use dashmap::DashMap;
use monaco::{client::MonacoApiClient, stream::MonacoWebSocketClient, types::MarketMapping};
use monaco::order_book::MonacoOrderBook;
use processor_client::ProcessorClient;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::sync::{broadcast, Mutex};
use tracing::info;

// --- Types ---

// Shared state accessible by all parts of the app
pub struct AppState {
    pub config: Config,
    pub tx: broadcast::Sender<Value>,
    pub db: sqlx::PgPool,
    // Market mapping: "eventId-marketId" -> MarketMapping
    pub market_mapping: DashMap<String, MarketMapping>,
    // Event to fixture: eventId -> fixtureId
    pub event_to_fixture: DashMap<String, i64>,
    // OrderBook tracker
    pub order_book: Arc<Mutex<MonacoOrderBook>>,
    // Processor client for sending updates
    pub processor_client: Option<Arc<ProcessorClient>>,
}

// --- Main ---

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    dotenvy::dotenv().ok();

    info!("🚀 Starting Rust Odds Engine...");

    let config = Config::from_env();
    info!("📋 Configuration loaded");

    // Connect to Postgres with proper pool configuration
    info!("🔌 Connecting to Postgres...");
    let pool = PgPoolOptions::new()
        .max_connections(DB_MAX_CONNECTIONS)
        .min_connections(DB_MIN_CONNECTIONS)
        .acquire_timeout(Duration::from_secs(DB_ACQUIRE_TIMEOUT_SECS))
        .idle_timeout(Duration::from_secs(DB_IDLE_TIMEOUT_SECS))
        .max_lifetime(Duration::from_secs(DB_MAX_LIFETIME_SECS))
        .connect(&config.database_url)
        .await?;
    
    info!("✅ Connected to Postgres");

    // Initialize processor client
    let processor_client = processor_client::create_processor_client(
        config.processor_enabled,
        config.processor_port,
    );

    // Initialize State
    let (tx, _rx) = broadcast::channel(BROADCAST_CHANNEL_CAPACITY);
    let state = Arc::new(AppState {
        config: config.clone(),
        tx: tx.clone(),
        db: pool.clone(),
        market_mapping: DashMap::new(),
        event_to_fixture: DashMap::new(),
        order_book: Arc::new(Mutex::new(MonacoOrderBook::new())),
        processor_client,
    });

    // Initialize Monaco Client & Ingestion
    if state.config.monaco_odds_enabled {
        info!("🎰 Initializing Monaco API client...");
        let monaco_api = Arc::new(Mutex::new(MonacoApiClient::new(
            config.monaco_base_url.clone(),
            config.monaco_app_id.clone(),
            config.monaco_api_key.clone(),
        )));
        
        let monaco_ws = MonacoWebSocketClient::new(
            config.monaco_stream_url.clone(),
            monaco_api.clone()
        );

        // Initialize markets and mappings with retry
        info!("🔄 Fetching and processing markets...");
        let mut retry_count = 0;
        let max_retries = 3;
        
        loop {
            match crate::monaco::market_init::fetch_and_process_markets(
                &monaco_api,
                &state.db,
                &state.market_mapping,
                &state.event_to_fixture,
                &state.order_book,
            )
            .await
            {
                Ok(_) => {
                    info!("✅ Markets initialized successfully");
                    break;
                }
                Err(e) => {
                    retry_count += 1;
                    if retry_count >= max_retries {
                        tracing::error!("❌ Failed to initialize markets after {} attempts: {}", max_retries, e);
                        tracing::error!("❌ Monaco service will continue but may not have initial market data");
                        break;
                    }
                    let wait_secs = 2u64.pow(retry_count);
                    tracing::warn!("⚠️ Market initialization failed (attempt {}/{}): {}. Retrying in {}s...", 
                        retry_count, max_retries, e, wait_secs);
                    tokio::time::sleep(Duration::from_secs(wait_secs)).await;
                }
            }
        }

        // Spawn Ingestion Task
        info!("📡 Starting Monaco ingestion engine...");
        let ingestion_state = state.clone();
        tokio::spawn(async move {
            monaco::handlers::start_ingestion_engine(ingestion_state, monaco_ws).await;
        });

        // Spawn Periodic Market Refresh Task (every 60 minutes)
        info!("🔄 Starting periodic market refresh (every 60 minutes)...");
        let refresh_state = state.clone();
        let refresh_api = monaco_api.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(MARKET_REFRESH_INTERVAL_SECS));
            loop {
                interval.tick().await;
                info!("🔄 Refreshing markets for new events...");
                if let Err(e) = crate::monaco::market_init::fetch_and_process_markets(
                    &refresh_api,
                    &refresh_state.db,
                    &refresh_state.market_mapping,
                    &refresh_state.event_to_fixture,
                    &refresh_state.order_book,
                )
                .await
                {
                    tracing::error!("Error during periodic market refresh: {}", e);
                }
            }
        });
    } else {
        info!("📡 Monaco services disabled (MONACO_ODDS != true)");
    }

    // Start Pinnacle Service
    if state.config.pinnacle_odds_enabled {
        info!("🏔️ Starting Pinnacle Service...");
        let pinnacle_pool = pool.clone();
        let pinnacle_processor_client = state.processor_client.clone();
        tokio::spawn(async move {
            let mut pinnacle_service = crate::pinnacle::PinnacleService::new(pinnacle_pool, pinnacle_processor_client);
            pinnacle_service.run().await;
        });
    } else {
        info!("🏔️ Pinnacle Service disabled (PINNACLE_ODDS != true)");
    }

    // Start API Server
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/ws", get(ws_handler))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.server_port));
    info!("🌐 WebSocket server starting on {}", addr);
    info!("✅ Rust Odds Engine is ready!");
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    
    // Graceful shutdown handler
    let shutdown_signal = async {
        let _ = tokio::signal::ctrl_c().await;
        info!("🛑 Shutdown signal received, stopping server...");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await?;

    info!("👋 Rust Odds Engine stopped gracefully");

    Ok(())
}

// --- Constants ---
const BROADCAST_CHANNEL_CAPACITY: usize = 1000;
const DB_MAX_CONNECTIONS: u32 = 20;
const DB_MIN_CONNECTIONS: u32 = 2;
const DB_ACQUIRE_TIMEOUT_SECS: u64 = 5;
const DB_IDLE_TIMEOUT_SECS: u64 = 600;
const DB_MAX_LIFETIME_SECS: u64 = 1800;
const MARKET_REFRESH_INTERVAL_SECS: u64 = 3600;

// --- Handlers ---

async fn health_check() -> &'static str {
    "OK"
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    info!("👤 New WebSocket client connecting...");
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    info!("✅ WebSocket client connected");
    let mut rx = state.tx.subscribe();
    
    while let Ok(msg) = rx.recv().await {
        if let Ok(json) = serde_json::to_string(&msg) {
            if socket.send(Message::Text(json)).await.is_err() {
                info!("❌ WebSocket client disconnected");
                break;
            }
        }
    }
}


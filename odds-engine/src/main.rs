mod config;
mod shared;
mod monaco;

mod pinnacle;

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
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Duration};
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
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(600))  // 10 minutes
        .max_lifetime(Duration::from_secs(1800))  // 30 minutes
        .connect(&config.database_url)
        .await?;
    
    info!("✅ Connected to Postgres");

    // Initialize State
    let (tx, _rx) = broadcast::channel(1000);
    let state = Arc::new(AppState {
        config: config.clone(),
        tx: tx.clone(),
        db: pool.clone(),
        market_mapping: DashMap::new(),
        event_to_fixture: DashMap::new(),
        order_book: Arc::new(Mutex::new(MonacoOrderBook::new())),
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
        info!("📡 Starting ingestion engine...");
        let ingestion_state = state.clone();
        tokio::spawn(async move {
            start_ingestion_engine(ingestion_state, monaco_ws).await;
        });

        // Spawn Periodic Market Refresh Task (every 60 minutes)
        info!("🔄 Starting periodic market refresh (every 60 minutes)...");
        let refresh_state = state.clone();
        let refresh_api = monaco_api.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(3600)); // 60 minutes
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
        tokio::spawn(async move {
            let mut pinnacle_service = crate::pinnacle::PinnacleService::new(pinnacle_pool);
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
    axum::serve(listener, app).await?;

    Ok(())
}

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

// --- Ingestion Engine ---

async fn start_ingestion_engine(state: Arc<AppState>, monaco_ws: MonacoWebSocketClient) {
    info!("🔥 Ingestion Engine Started");
    
    // Start Monaco WebSocket (authentication already completed during market fetch)
    let ws_client = Arc::new(monaco_ws);
    let ws_client_clone = ws_client.clone();
    tokio::spawn(async move {
        info!("🚀 Launching Monaco WebSocket connection...");
        ws_client_clone.start().await;
    });

    // Subscribe to Monaco messages
    let mut rx = ws_client.subscribe();
    info!("📻 Subscribed to Monaco message stream");

    let mut message_count = 0;
    
    while let Ok(msg) = rx.recv().await {
        message_count += 1;
        
        // Forward to frontend clients immediately
        let _ = state.tx.send(msg.clone());
        
        // Process messages
        if let Some(msg_type) = msg["type"].as_str() {
            match msg_type {
                "MarketPriceUpdate" => {
                    let state_clone = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_price_update(state_clone, msg).await {
                            tracing::error!("Error handling price update: {}", e);
                        }
                    });
                }
                "MarketStatusUpdate" => {
                    let state_clone = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_market_status_update(state_clone, msg).await {
                            tracing::error!("Error handling market status update: {}", e);
                        }
                    });
                }
                _ => {}
            }
        }
        
        if message_count % 200 == 0 {
            info!("📊 Processed {} messages total", message_count);
        }
    }
}

async fn handle_price_update(
    state: Arc<AppState>,
    message: Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Extract message fields
    let market_id = match message["marketId"].as_str() {
        Some(id) => id,
        None => return Ok(()),
    };

    let event_id = match message["eventId"].as_str() {
        Some(id) => id,
        None => return Ok(()),
    };

    // Check if we have prices
    if message["prices"].as_array().map_or(true, |p| p.is_empty()) {
        return Ok(());
    }

    // Lookup market mapping
    let mapping_key = format!("{}-{}", event_id, market_id);
    let market_mapping = match state.market_mapping.get(&mapping_key) {
        Some(mapping) => mapping.clone(),
        None => {
            // Market not yet mapped - need to fetch and process
            // For now, skip
            return Ok(());
        }
    };

    // Get fixture ID
    let fixture_id = match market_mapping.fixture_id {
        Some(id) => id,
        None => return Ok(()),
    };

    // Update OrderBook
    let order_book = {
        let mut ob = state.order_book.lock().await;
        ob.update(
            fixture_id,
            &message,
            &market_mapping.market_type,
            market_mapping.outcome_mappings.as_ref(),
        )
    };

    // Get all market mappings for this fixture (needed for database update)
    let mut mappings = HashMap::new();
    for entry in state.market_mapping.iter() {
        if entry.value().fixture_id == Some(fixture_id) {
            mappings.insert(entry.key().clone(), entry.value().clone());
        }
    }

    // Update database with best prices
    shared::db::update_database_with_best_prices(
        &state.db,
        fixture_id,
        &market_mapping.market_type,
        &order_book,
        &mappings,
    )
    .await?;

    Ok(())
}

async fn handle_market_status_update(
    state: Arc<AppState>,
    message: Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Extract message fields
    let market_id = match message["marketId"].as_str() {
        Some(id) => id,
        None => return Ok(()),
    };

    let event_id = match message["eventId"].as_str() {
        Some(id) => id,
        None => return Ok(()),
    };

    let status = message["status"].as_str().unwrap_or("Unknown");
    let in_play_status = message["inPlayStatus"].as_str().unwrap_or("NotApplicable");

    // Check if market should be zeroed out
    // Zero out if: status != "Open" OR inPlayStatus == "InPlay"
    let should_zero = status != "Open" || in_play_status == "InPlay";

    if !should_zero {
        return Ok(()); // Market is open and pre-play, nothing to do
    }

    info!("🔒 Market {} closed/in-play (status: {}, inPlay: {}), zeroing odds", market_id, status, in_play_status);

    // Lookup market mapping
    let mapping_key = format!("{}-{}", event_id, market_id);
    let market_mapping = match state.market_mapping.get(&mapping_key) {
        Some(mapping) => mapping.clone(),
        None => {
            // Market not mapped yet, skip
            return Ok(());
        }
    };

    // Get fixture ID
    let fixture_id = match market_mapping.fixture_id {
        Some(id) => id,
        None => return Ok(()),
    };

    // Zero out the order book for this market
    {
        let mut ob = state.order_book.lock().await;
        ob.remove(fixture_id, &market_mapping.market_type);
    }

    // Create empty order book (all outcomes with empty price levels)
    let empty_order_book = {
        let mut book = HashMap::new();
        if let Some(outcome_mappings) = &market_mapping.outcome_mappings {
            for outcome_id in outcome_mappings.keys() {
                book.insert(outcome_id.clone(), vec![]);
            }
        }
        book
    };

    // Get all market mappings for this fixture (needed for database update)
    let mut mappings = HashMap::new();
    for entry in state.market_mapping.iter() {
        if entry.value().fixture_id == Some(fixture_id) {
            mappings.insert(entry.key().clone(), entry.value().clone());
        }
    }

    // Update database with zeroed prices
    shared::db::update_database_with_best_prices(
        &state.db,
        fixture_id,
        &market_mapping.market_type,
        &empty_order_book,
        &mappings,
    )
    .await?;

    Ok(())
}

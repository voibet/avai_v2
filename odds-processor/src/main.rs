mod config;
mod cache;
mod calculations;
mod network;
mod types;
mod db;
mod filters;

use axum::{routing::get, Router};
use cache::Cache;
use chrono;
use config::Config;
use network::stream::{get_stats, ws_handler, AppState, SharedState};
use network::tcp;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{info, warn};
use types::{OddsUpdate, WsMessage};
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    dotenvy::dotenv().ok();

    info!("🚀 Starting odds-processor...");

    let config = Config::from_env();
    let start_time = Instant::now();

    // Connect to database
    info!("Connecting to database...");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;
    info!("✅ Connected to database");

    // Create channels
    let (update_tx, _) = broadcast::channel::<OddsUpdate>(1000);
    let (ws_tx, _) = broadcast::channel::<WsMessage>(1000);

    // Create cache
    let cache = Arc::new(RwLock::new(Cache::new(config.max_fixtures)));

    // Hydrate cache from database
    match db::fetch_initial_odds(&pool, config.max_fixtures as i64).await {
        Ok(updates) => {
            let mut cache_guard = cache.write().await;
            for update in updates {
                cache_guard.apply_update(update);
            }
            info!("✅ Cache hydrated with {} fixtures", cache_guard.len());
        }
        Err(e) => {
            warn!("Failed to hydrate cache from database: {}", e);
        }
    }

    // Create app state
    let state: SharedState = Arc::new(AppState::new(ws_tx.clone(), cache.clone()));

    // Start database listener
    db::start_db_listener(pool.clone(), update_tx.clone());

    // Start TCP listener for odds-engine
    let tcp_tx = update_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = tcp::start_tcp_listener(config.tcp_port, tcp_tx).await {
            tracing::error!("TCP listener error: {}", e);
        }
    });

    // Process updates
    let process_cache = cache.clone();
    let process_ws_tx = ws_tx.clone();
    let process_state = state.clone();
    let mut update_rx = update_tx.subscribe();
    
    tokio::spawn(async move {
        let mut updates_count: u64 = 0;
        let mut last_updates_count: u64 = 0;
        let mut last_stats_update = Instant::now();

        while let Ok(update) = update_rx.recv().await {
            updates_count += 1;

            // Apply update to cache
            let fixture = {
                let mut cache = process_cache.write().await;
                cache.apply_update(update.clone()).cloned()
            };

            // Broadcast to WebSocket clients
            if let Some(fixture) = fixture {
                let ws_msg = WsMessage {
                    msg_type: "odds_update".to_string(),
                    fixture_id: fixture.fixture_id,
                    timestamp: update.timestamp,
                    start: update.start,
                    end: chrono::Utc::now().timestamp_millis(),
                    bookmakers: fixture.bookmakers.clone(),
                    filter_matches: None,
                };

                let _ = process_ws_tx.send(ws_msg);
            }

            // Update stats every second
            if last_stats_update.elapsed().as_secs() >= 1 {
                let cache = process_cache.read().await;
                let mut stats = process_state.stats.write().await;
                
                let now = Instant::now();
                let elapsed = now.duration_since(last_stats_update).as_secs_f64();
                let current_updates_count = updates_count;
                let updates_delta = current_updates_count - last_updates_count;
                
                stats.fixtures_count = cache.len();
                stats.updates_received = current_updates_count;
                stats.updates_per_second = updates_delta as f64 / elapsed;
                stats.uptime_seconds = start_time.elapsed().as_secs();
                
                last_stats_update = now;
                last_updates_count = current_updates_count;
            }
        }
    });

    // Start HTTP/WebSocket server
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/stats", get(get_stats))
        .nest_service("/", ServeDir::new("static"))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.ws_port);
    info!("🌐 WebSocket server starting on {}", addr);
    info!("📊 Monitor at http://localhost:{}/", config.ws_port);
    info!("✅ odds-processor ready!");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}


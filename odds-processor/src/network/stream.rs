use crate::types::{ProcessorStats, WsMessage, ClientState};
use crate::cache::Cache;
use crate::filters::{FilterExpr, evaluate, FilterContext};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};
use serde::Deserialize;

pub type SharedState = Arc<AppState>;

pub struct AppState {
    pub tx: broadcast::Sender<WsMessage>,
    pub cache: Arc<RwLock<Cache>>,
    pub stats: RwLock<ProcessorStats>,
    pub client_count: RwLock<usize>,
}

impl AppState {
    pub fn new(tx: broadcast::Sender<WsMessage>, cache: Arc<RwLock<Cache>>) -> Self {
        Self {
            tx,
            cache,
            stats: RwLock::new(ProcessorStats::default()),
            client_count: RwLock::new(0),
        }
    }

    pub async fn increment_clients(&self) {
        let mut count = self.client_count.write().await;
        *count += 1;
        let mut stats = self.stats.write().await;
        stats.ws_clients = *count;
    }

    pub async fn decrement_clients(&self) {
        let mut count = self.client_count.write().await;
        *count = count.saturating_sub(1);
        let mut stats = self.stats.write().await;
        stats.ws_clients = *count;
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientRequest {
    Subscribe { filter: Option<FilterExpr> },
    UpdateFilter { filter: FilterExpr },
    RemoveFilter,
}

type WsSender = Arc<tokio::sync::Mutex<futures::stream::SplitSink<WebSocket, Message>>>;

/// WebSocket upgrade handler
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handle individual WebSocket connection
async fn handle_socket(socket: WebSocket, state: SharedState) {
    let (sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    state.increment_clients().await;
    info!("👤 WebSocket client connected");

    let sender: WsSender = std::sync::Arc::new(tokio::sync::Mutex::new(sender));
    let sender_clone = sender.clone();

    // Shared client state
    let client_state: Arc<RwLock<ClientState>> = Arc::new(RwLock::new(ClientState::new()));
    let client_state_clone = client_state.clone();

    // Send initial snapshot (no filter)
    send_filtered_snapshot(&state.cache, &sender, None).await;

    let cache_clone = state.cache.clone();
    let send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                result = rx.recv() => {
                    match result {
                        Ok(mut msg) => {
                            let fixture_id = msg.fixture_id;

                            // Check filter and collect traces, track state transitions
                            let (should_send, traces, send_removal) = {
                                let mut state = client_state_clone.write().await;
                                if let Some(expr) = &state.filter {
                                    if let Ok(value) = serde_json::to_value(&msg) {
                                        let mut ctx = FilterContext::new(&value);
                                        let matches_now = evaluate(expr, &mut ctx);
                                        let was_matching = state.matching_fixtures.contains(&fixture_id);
                                        let traces = ctx.get_traces();

                                        match (matches_now, was_matching) {
                                            (true, false) => {
                                                // Started matching - send snapshot
                                                state.matching_fixtures.insert(fixture_id);
                                                (true, traces, false)
                                            }
                                            (true, true) => {
                                                // Still matching - send update
                                                (true, traces, false)
                                            }
                                            (false, true) => {
                                                // Stopped matching - send removal
                                                state.matching_fixtures.remove(&fixture_id);
                                                (false, vec![], true)
                                            }
                                            (false, false) => {
                                                // Still not matching - do nothing
                                                (false, vec![], false)
                                            }
                                        }
                                    } else {
                                        warn!("Failed to serialize message for filter evaluation");
                                        (true, vec![], false)
                                    }
                                } else {
                                    // No filter - send everything, but don't track state
                                    (true, vec![], false)
                                }
                            };

                            if should_send {
                                // Add filter match traces to message if any
                                if !traces.is_empty() {
                                    msg.filter_matches = Some(traces);
                                }
                                if let Ok(json) = serde_json::to_string(&msg) {
                                    let mut s = sender_clone.lock().await;
                                    if s.send(Message::Text(json)).await.is_err() {
                                        break;
                                    }
                                }
                            }

                            // Send removal message if needed
                            if send_removal {
                                let cache = cache_clone.read().await;
                                if let Some(fixture) = cache.fixtures.get(&fixture_id) {
                                    let removal_msg = fixture.to_odds_removed_message();
                                    if let Ok(json) = serde_json::to_string(&removal_msg) {
                                        let mut s = sender_clone.lock().await;
                                        if s.send(Message::Text(json)).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(30)) => {
                    // Send ping to keep connection alive
                    let mut s = sender_clone.lock().await;
                    if s.send(Message::Ping(vec![])).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Handle incoming messages
    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            match serde_json::from_str::<ClientRequest>(&text) {
                Ok(req) => {
                    let mut client_state_guard = client_state.write().await;
                    match req {
                        ClientRequest::Subscribe { filter: new_filter } => {
                            client_state_guard.filter = new_filter;
                            client_state_guard.matching_fixtures.clear(); // Clear tracking when subscribing
                            info!("✅ Client subscribed with filter");
                            // Send snapshot with new filter
                            send_filtered_snapshot(&state.cache, &sender, Some(&mut client_state_guard)).await;
                        },
                        ClientRequest::UpdateFilter { filter: new_filter } => {
                            client_state_guard.filter = Some(new_filter);
                            client_state_guard.matching_fixtures.clear(); // Clear tracking when updating filter
                            info!("🔄 Client updated filter");
                            send_filtered_snapshot(&state.cache, &sender, Some(&mut client_state_guard)).await;
                        },
                        ClientRequest::RemoveFilter => {
                            client_state_guard.filter = None;
                            client_state_guard.matching_fixtures.clear(); // Clear tracking when removing filter
                            info!("❌ Client removed filter");
                            send_filtered_snapshot(&state.cache, &sender, Some(&mut client_state_guard)).await;
                        }
                    }
                },
                Err(e) => {
                    warn!("Failed to parse client request: {}", e);
                }
            }
        }
    }

    send_task.abort();
    state.decrement_clients().await;
    info!("👤 WebSocket client disconnected");
}

async fn send_filtered_snapshot<'a>(
    cache: &Arc<RwLock<Cache>>,
    sender: &WsSender,
    mut client_state: Option<&mut tokio::sync::RwLockWriteGuard<'a, ClientState>>
) {
    let cache = cache.read().await;
    let count = cache.fixtures.len();
    info!("📤 Processing snapshot of {} fixtures...", count);
    
    let mut s = sender.lock().await;
    let mut sent_count = 0;

    for fixture in cache.fixtures.values() {
        let base_msg = fixture.to_ws_message("odds_snapshot");

        let filter_ref = client_state.as_ref().and_then(|cs| cs.filter.as_ref());
        let (should_send, traces) = if let Some(expr) = filter_ref {
            if let Ok(value) = serde_json::to_value(&base_msg) {
                let mut ctx = FilterContext::new(&value);
                let result = evaluate(expr, &mut ctx);

                (result, ctx.get_traces())
            } else {
                warn!("Failed to serialize message for filter evaluation");
                (true, vec![])
            }
        } else {
            (true, vec![])
        };

        if should_send {
            // Track this fixture as matching for the client
            if let Some(ref mut state) = client_state {
                state.matching_fixtures.insert(fixture.fixture_id);
            }

            // Create message with traces if filter matched
            let msg = if !traces.is_empty() {
                fixture.to_ws_message_with_traces("odds_snapshot", traces)
            } else {
                base_msg
            };

            if let Ok(json) = serde_json::to_string(&msg) {
                if s.send(Message::Text(json)).await.is_err() {
                    break;
                }
                sent_count += 1;
            }
        }
    }
    info!("✅ Sent {}/{} fixtures in snapshot", sent_count, count);
}


/// Get current stats
pub async fn get_stats(State(state): State<SharedState>) -> impl IntoResponse {
    let stats = state.stats.read().await;
    axum::Json(stats.clone())
}


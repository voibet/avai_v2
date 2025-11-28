use crate::types::OddsUpdate;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tracing::{error, info};

/// Start TCP listener for odds-engine updates
pub async fn start_tcp_listener(
    port: u16,
    tx: broadcast::Sender<OddsUpdate>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr).await?;
    info!("📡 TCP listener started on {}", addr);

    loop {
        match listener.accept().await {
            Ok((socket, addr)) => {
                info!("🔗 New connection from odds-engine: {}", addr);
                let tx = tx.clone();
                
                tokio::spawn(async move {
                    let reader = BufReader::new(socket);
                    let mut lines = reader.lines();

                    while let Ok(Some(line)) = lines.next_line().await {
                        match serde_json::from_str::<OddsUpdate>(&line) {
                            Ok(update) => {
                                let _ = tx.send(update);
                            }
                            Err(e) => {
                                error!("Failed to parse update: {}", e);
                            }
                        }
                    }

                    info!("🔌 Connection closed: {}", addr);
                });
            }
            Err(e) => {
                error!("Failed to accept connection: {}", e);
            }
        }
    }
}



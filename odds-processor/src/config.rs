pub struct Config {
    pub tcp_port: u16,
    pub ws_port: u16,
    pub max_fixtures: usize,
    pub database_url: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            tcp_port: std::env::var("TCP_PORT")
                .unwrap_or_else(|_| "9000".to_string())
                .parse()
                .unwrap_or(9000),
            ws_port: std::env::var("WS_PORT")
                .unwrap_or_else(|_| "8081".to_string())
                .parse()
                .unwrap_or(8081),
            max_fixtures: std::env::var("MAX_FIXTURES")
                .unwrap_or_else(|_| "1000".to_string())
                .parse()
                .unwrap_or(1000),
            database_url: std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
        }
    }
}

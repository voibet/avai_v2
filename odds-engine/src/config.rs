use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub monaco_base_url: String,
    pub monaco_stream_url: String,
    pub monaco_app_id: String,
    pub monaco_api_key: String,

    pub server_port: u16,
    pub monaco_odds_enabled: bool,
    pub pinnacle_odds_enabled: bool,
}

impl Config {
    pub fn from_env() -> Self {
        let port_str = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
        let server_port = port_str.parse().unwrap_or_else(|_| {
            eprintln!("Warning: Invalid PORT '{}', defaulting to 8080", port_str);
            8080
        });

        Self {
            database_url: env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            monaco_base_url: env::var("MONACO_BASE_URL").unwrap_or_default(),
            monaco_stream_url: env::var("MONACO_STREAM_URL").unwrap_or_default(),
            monaco_app_id: env::var("MONACO_APP_ID").unwrap_or_default(),
            monaco_api_key: env::var("MONACO_API_KEY").unwrap_or_default(),

            server_port,
            monaco_odds_enabled: env::var("MONACO_ODDS").map(|v| v == "true").unwrap_or(true),
            pinnacle_odds_enabled: env::var("PINNACLE_ODDS").map(|v| v == "true").unwrap_or(true),
        }
    }
}

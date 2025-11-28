@echo off

echo Building and running Rust Odds Engine...
set RUST_LOG=info
cargo run --release
pause

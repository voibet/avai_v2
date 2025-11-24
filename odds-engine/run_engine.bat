@echo off

echo Building and running Rust Odds Engine...
set RUST_LOG=debug
cargo run --release
pause

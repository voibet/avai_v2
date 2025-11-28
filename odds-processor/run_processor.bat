@echo off
cd /d "%~dp0"
set RUST_LOG=info
cargo run --release


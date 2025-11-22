@echo off
echo Copying .env from parent directory...
copy ..\.env .env >nul

echo Checking for Visual C++ Build Tools...
where link.exe >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Visual Studio C++ Build Tools are missing!
    echo Rust requires the MSVC linker to compile on Windows.
    echo.
    echo Please download and install "Build Tools for Visual Studio 2022":
    echo https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo.
    echo During installation, select the "Desktop development with C++" workload.
    echo.
    pause
    exit /b 1
)

echo Building and running Rust Odds Engine...
cargo run --release
pause

@echo off
REM Kovanica Protocol — Quick Windows Installer (Batch)
REM Downloads and runs the PowerShell installer.
REM
REM Usage: Double-click this file, or run in CMD:
REM   install.bat [download|native|wsl2|msys2]

setlocal enabledelayedexpansion

set MODE=%1
if "%MODE%"=="" set MODE=download

echo.
echo   ╔═══════════════════════════════════════╗
echo   ║   Kovanica Protocol Installer          ║
echo   ║   BlockDAG Node · GHOSTDAG Consensus  ║
echo   ╚═══════════════════════════════════════╝
echo.

REM Check PowerShell is available
where powershell >nul 2>&1
if %errorlevel% neq 0 (
    echo [error] PowerShell not found. Please run this from a normal Windows terminal.
    pause
    exit /b 1
)

REM Download and run the PowerShell installer
echo [info] Launching PowerShell installer...
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Mode %MODE%

if %errorlevel% neq 0 (
    echo.
    echo [error] Installation failed. Try a different mode:
    echo   install.bat native
    echo   install.bat wsl2
    echo   install.bat msys2
    echo.
)

pause

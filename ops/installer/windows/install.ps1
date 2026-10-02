#Requires -Version 5.1
<#
.SYNOPSIS
    Kovanica Protocol — Windows Installer (PowerShell)

.DESCRIPTION
    Installs kovanica-node on Windows via:
    1. MSYS2/MinGW64 (recommended — native Linux-like build)
    2. WSL2 Ubuntu (recommended — full compatibility)
    3. Native Windows build via Rust MSVC toolchain
    4. Pre-built binary download (fastest)

.EXAMPLE
    .\install.ps1
    .\install.ps1 -Mode WSL2
    .\install.ps1 -Mode MSYS2
    .\install.ps1 -Mode Native
    .\install.ps1 -Mode Download
#>

param(
    [ValidateSet("Auto", "Download", "Native", "WSL2", "MSYS2")]
    [string]$Mode = "Auto",

    [string]$DataDir = "$env:USERPROFILE\.kovanica-data",
    [int]$P2PPort = 9000,
    [int]$HTTPPort = 8080,
    [string]$Peers = "seed.kovanica.online:9000,seed2.kovanica.online:9000",
    [switch]$Mine,
    [int]$MineSecs = 60,
    [switch]$Explorer,
    [switch]$NoService
)

$ErrorActionPreference = "Stop"

$ScriptVersion = "0.2.0"
$Repo = "KovanicaDAG/kovanica-protocol"
$RepoUrl = "https://github.com/$Repo"
$Binary = "kovanica-node"

# ─── Helpers ──────────────────────────────────────────────────────────────────

function Write-Info    { param($msg) Write-Host "[info]  $msg" -ForegroundColor Blue }
function Write-Ok      { param($msg) Write-Host "[ok]    $msg" -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "[warn]  $msg" -ForegroundColor Yellow }
function Write-Err     { param($msg) Write-Host "[error] $msg" -ForegroundColor Red }

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Add-ToPath {
    param([string]$Dir)
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$Dir*") {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$Dir", "User")
        $env:Path = "$env:Path;$Dir"
        Write-Ok "Added $Dir to PATH"
    }
}

# ─── Platform Detection ──────────────────────────────────────────────────────

function Get-ArchName {
    $arch = $env:PROCESSOR_ARCHITECTURE
    switch ($arch) {
        "AMD64"   { return "x86_64" }
        "ARM64"   { return "aarch64" }
        default   { Write-Err "Unsupported architecture: $arch"; exit 1 }
    }
}

# ─── Method 1: WSL2 ──────────────────────────────────────────────────────────

function Install-WSL2 {
    Write-Info "Installing via WSL2 Ubuntu..."

    # Check WSL is enabled
    $wslStatus = wsl --status 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "WSL2 not available. Enable it:"
        Write-Host "  dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart" -ForegroundColor Yellow
        Write-Host "  dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart" -ForegroundColor Yellow
        Write-Host "  wsl --set-default-version 2" -ForegroundColor Yellow
        Write-Host "  Then restart and install Ubuntu from Microsoft Store." -ForegroundColor Yellow
        return $false
    }

    # Check Ubuntu is installed
    $distros = wsl --list --quiet 2>&1
    if ($distros -notmatch "Ubuntu") {
        Write-Info "Installing Ubuntu distribution..."
        wsl --install -d Ubuntu
        Write-Warn "After Ubuntu installs, re-run this script."
        return $false
    }

    # Install in WSL
    $installScript = @"
set -euo pipefail
curl -fsSL https://raw.githubusercontent.com/$Repo/main/kovanica-install/install.sh | bash -s -- \
    --download --data-dir /mnt/c/Users/$($env:USERNAME)/.kovanica-data \
    --p2p-port $P2PPort --http-port $HTTPPort --peers "$Peers" \
    $(if ($Mine) { "--mine --mine-secs $MineSecs" }) \
    $(if ($Explorer) { "--explorer" })
"@

    wsl -d Ubuntu -- bash -c $installScript
    Write-Ok "Kovanica node installed in WSL2 Ubuntu"
    Write-Host ""
    Write-Host "Run from WSL:" -ForegroundColor Cyan
    Write-Host "  wsl -d Ubuntu -- kovanica-node demo" -ForegroundColor White
    Write-Host "  wsl -d Ubuntu -- kovanica-node serve" -ForegroundColor White
    return $true
}

# ─── Method 2: MSYS2/MinGW ──────────────────────────────────────────────────

function Install-MSYS2 {
    Write-Info "Installing via MSYS2 MinGW64..."

    $msys2Path = "C:\msys64"
    if (-not (Test-Path "$msys2Path\msys2.exe")) {
        Write-Warn "MSYS2 not found at $msys2Path"
        Write-Info "Download from: https://www.msys2.org/"
        Write-Info "After installing MSYS2, re-run this script."
        return $false
    }

    $mingw64 = "$msys2Path\mingw64\bin"
    $bash = "$msys2Path\usr\bin\bash.exe"

    # Update MSYS2 and install deps
    & "$msys2Path\usr\bin\pacman.exe" -Syu --noconfirm 2>&1 | Out-Null
    & "$msys2Path\usr\bin\pacman.exe" -S --noconfirm --needed base-devel mingw-w64-x86_64-toolchain mingw-w64-x86_64-curl git 2>&1 | Out-Null

    $installScript = @"
export PATH="$mingw64/`$PATH"
curl -fsSL https://raw.githubusercontent.com/$Repo/main/kovanica-install/install.sh | bash -s -- --build --data-dir "$DataDir" --p2p-port $P2PPort --http-port $HTTPPort --peers "$Peers" $(if ($Mine) { "--mine --mine-secs $MineSecs" }) $(if ($Explorer) { "--explorer" })
"@

    & "$bash" -c $installScript
    Add-ToPath $mingw64
    Write-Ok "Kovanica node installed via MSYS2 MinGW64"
    return $true
}

# ─── Method 3: Native Windows (Rust MSVC) ───────────────────────────────────

function Install-Native {
    Write-Info "Installing via native Windows build (Rust MSVC)..."

    # Check/install Rust
    if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
        Write-Info "Installing Rust toolchain..."
        Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "$env:TEMP\rustup-init.exe"
        & "$env:TEMP\rustup-init.exe" -y
        $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
    }

    # Check Visual C++ Build Tools
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWhere) {
        $installPath = & $vsWhere -latest -property installationPath
        if (-not $installPath) {
            Write-Warn "Visual C++ Build Tools not found."
            Write-Info "Install from: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
            Write-Info "Select 'Desktop development with C++'."
            return $false
        }
    } else {
        Write-Warn "vswhere not found. Ensure Visual C++ Build Tools are installed."
        return $false
    }

    # Clone and build
    $tmpdir = Join-Path $env:TEMP "kovanica-build"
    if (Test-Path $tmpdir) { Remove-Item -Recurse -Force $tmpdir }

    Write-Info "Cloning repository..."
    git clone --depth 1 "$RepoUrl.git" "$tmpdir\kovanica-protocol"

    Write-Info "Building release binary (this may take 5-10 minutes)..."
    Push-Location "$tmpdir\kovanica-protocol"
    cargo build --release -p kovanica-node
    Pop-Location

    $bin = "$tmpdir\kovanica-protocol\target\release\$Binary.exe"
    if (-not (Test-Path $bin)) {
        Write-Err "Build failed — binary not found"
        return $false
    }

    $installDir = "$env:LOCALAPPDATA\KovanicaNode"
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    Copy-Item $bin "$installDir\$Binary.exe"
    Add-ToPath $installDir

    Remove-Item -Recurse -Force $tmpdir
    Write-Ok "Kovanica node installed to $installDir"
    return $true
}

# ─── Method 4: Download Pre-built ───────────────────────────────────────────

function Install-Download {
    Write-Info "Downloading pre-built binary..."

    $arch = Get-ArchName
    $url = "$RepoUrl/releases/download/v$ScriptVersion/kovanica-node-windows-$arch.zip"
    $tmpdir = Join-Path $env:TEMP "kovanica-download"
    $zip = "$tmpdir\kovanica-node.zip"

    New-Item -ItemType Directory -Force -Path $tmpdir | Out-Null

    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -ErrorAction Stop
    } catch {
        Write-Warn "Pre-built binary not available at $url"
        Remove-Item -Recurse -Force $tmpdir -ErrorAction SilentlyContinue
        return $false
    }

    Expand-Archive -Path $zip -DestinationPath $tmpdir -Force
    $bin = Get-ChildItem -Path $tmpdir -Recurse -Filter "$Binary.exe" | Select-Object -First 1

    if (-not $bin) {
        Write-Err "Binary not found in archive"
        Remove-Item -Recurse -Force $tmpdir
        return $false
    }

    $installDir = "$env:LOCALAPPDATA\KovanicaNode"
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    Copy-Item $bin.FullName "$installDir\$Binary.exe"
    Add-ToPath $installDir

    Remove-Item -Recurse -Force $tmpdir
    Write-Ok "Kovanica node installed to $installDir"
    return $true
}

# ─── Windows Service ────────────────────────────────────────────────────────

function Install-WindowsService {
    if ($NoService) { return }

    $installDir = "$env:LOCALAPPDATA\KovanicaNode"
    $exe = "$installDir\$Binary.exe"
    if (-not (Test-Path $exe)) { return }

    Write-Info "Creating Windows service..."

    $serviceName = "KovanicaNode"
    $dataDirPath = $DataDir

    # Create a wrapper script for the service
    $wrapperScript = @"
@echo off
set KOVANICA_DATA=$dataDirPath
set KOVANICA_P2P_PORT=$P2PPort
set KOVANICA_HTTP_PORT=$HTTPPort
set KOVANICA_PEERS=$Peers
$(if ($Mine) { "set KOVANICA_MINE=1" })
$(if ($Mine) { "set KOVANICA_MINE_SECS=$MineSecs" })
$(if ($Explorer) { "set KOVANICA_EXPLORER=1" })
"$exe" serve
"@

    $wrapperPath = "$installDir\start-node.bat"
    Set-Content -Path $wrapperPath -Value $wrapperScript

    # Register as scheduled task (runs at startup)
    $action = New-ScheduledTaskAction -Execute $wrapperPath
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    try {
        Register-ScheduledTask -TaskName $serviceName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
        Write-Ok "Scheduled task '$serviceName' created (runs at startup)"
        Write-Host "  Start:   Start-ScheduledTask -TaskName '$serviceName'" -ForegroundColor Cyan
        Write-Host "  Stop:    Stop-ScheduledTask -TaskName '$serviceName'" -ForegroundColor Cyan
        Write-Host "  Logs:    Get-EventLog -LogName Application -Source '$serviceName'" -ForegroundColor Cyan
    } catch {
        Write-Warn "Could not create scheduled task: $_"
        Write-Info "Run manually: $wrapperPath"
    }
}

# ─── Desktop Shortcut ───────────────────────────────────────────────────────

function New-DesktopShortcut {
    $installDir = "$env:LOCALAPPDATA\KovanicaNode"
    $exe = "$installDir\$Binary.exe"
    if (-not (Test-Path $exe)) { return }

    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = "$desktop\Kovanica Node.lnk"

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "$installDir\start-node.bat"
    $shortcut.WorkingDirectory = $installDir
    $shortcut.Description = "Kovanica BlockDAG Node"
    $shortcut.Save()

    Write-Ok "Desktop shortcut created: $shortcutPath"
}

# ─── Main ────────────────────────────────────────────────────────────────────

function Main {
    Write-Host ""
    Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║   Kovanica Protocol Installer v$ScriptVersion  ║" -ForegroundColor Cyan
    Write-Host "  ║   BlockDAG Node · GHOSTDAG Consensus  ║" -ForegroundColor Cyan
    Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    # Create data directory
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    Write-Ok "Data directory: $DataDir"

    $installed = $false

    switch ($Mode) {
        "Download" { $installed = Install-Download }
        "Native"   { $installed = Install-Native }
        "WSL2"     { $installed = Install-WSL2 }
        "MSYS2"    { $installed = Install-MSYS2 }
        "Auto" {
            # Try methods in order of preference
            $installed = Install-Download
            if (-not $installed) {
                Write-Info "Trying native build..."
                $installed = Install-Native
            }
            if (-not $installed) {
                Write-Info "Trying MSYS2..."
                $installed = Install-MSYS2
            }
            if (-not $installed) {
                Write-Info "Trying WSL2..."
                $installed = Install-WSL2
            }
        }
    }

    if (-not $installed) {
        Write-Err "Installation failed. Try a different mode:"
        Write-Host "  .\install.ps1 -Mode WSL2" -ForegroundColor Yellow
        Write-Host "  .\install.ps1 -Mode Native" -ForegroundColor Yellow
        Write-Host "  .\install.ps1 -Mode MSYS2" -ForegroundColor Yellow
        exit 1
    }

    Install-WindowsService
    New-DesktopShortcut

    Write-Host ""
    Write-Host "  ═══════════════════════════════════════" -ForegroundColor Green
    Write-Host "  Installation complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Quick start:" -ForegroundColor White
    Write-Host "    kovanica-node demo          # Run scripted demo" -ForegroundColor Cyan
    Write-Host "    kovanica-node serve         # Start interactive REPL" -ForegroundColor Cyan
    Write-Host "    kovanica-node explorer      # Start with web explorer" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Testnet explorer: https://explorer.kovanica.online" -ForegroundColor Blue
    Write-Host "  Documentation:    $RepoUrl#readme" -ForegroundColor Blue
    Write-Host ""
}

Main

# GradiumOS v3 — Daily Marquee Test Runner
# BC 180 gate: marquee must be green 7 consecutive days (Day 1 = 2026-04-30)
#
# Usage: Run this script each morning from 2026-05-01 to 2026-05-06.
#   powershell -ExecutionPolicy Bypass -File runbooks/daily-marquee-run.ps1
#
# Requirements: Docker Desktop must be running.

$BackendDir = Split-Path -Parent $PSScriptRoot
$TrackingFile = Join-Path $PSScriptRoot "marquee-7day-tracker.md"
$RunDate = Get-Date -Format "yyyy-MM-dd"
$RunTime = Get-Date -Format "HH:mm IST"

Write-Host "`n=== GradiumOS v3 Marquee Run — $RunDate ===" -ForegroundColor Cyan

# Check Docker is up
$dockerPs = docker ps 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker is not running. Start Docker Desktop and retry." -ForegroundColor Red
    $entry = "`n| $RunDate | $RunTime | ❌ BLOCKED | Docker not running — run manually | - |"
    Add-Content -Path $TrackingFile -Value $entry
    exit 1
}

Write-Host "Docker is running. Starting marquee test..." -ForegroundColor Green

# Run the test and capture output + timing
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$output = & npm --prefix $BackendDir run test:e2e 2>&1
$exitCode = $LASTEXITCODE
$stopwatch.Stop()
$durationSec = [math]::Round($stopwatch.Elapsed.TotalSeconds, 1)

$result = if ($exitCode -eq 0) { "✅ PASS" } else { "❌ FAIL" }
$color  = if ($exitCode -eq 0) { "Green" } else { "Red" }

Write-Host "`nResult: $result  (${durationSec}s)" -ForegroundColor $color

# Append to tracker
$safeOutput = ($output | Select-String "✓|×|PASS|FAIL|Step" | Select-Object -First 10) -join "; "
$entry = "| $RunDate | $RunTime | $result | ${durationSec}s | $safeOutput |"
Add-Content -Path $TrackingFile -Value $entry

Write-Host "`nTracking file updated: $TrackingFile" -ForegroundColor Cyan
Write-Host "Full output saved above. Re-open Claude Code and paste the result for the BC 180 sign-off log.`n"

exit $exitCode

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = [System.IO.Path]::Combine($root, "application", "src-tauri")
$cargo = [System.IO.Path]::Combine($src, "Cargo.toml")
$conf = [System.IO.Path]::Combine($src, "tauri.conf.json")
$md = [System.IO.Path]::Combine($root, "mdviewer.html")
$frontend = [System.IO.Path]::Combine($root, "application", "frontend", "index.html")

Write-Host "==> Reading version ..." -ForegroundColor Cyan
$content = Get-Content $cargo -Raw
$verMatch = [regex]::Match($content, 'version = "(\d+)\.(\d+)\.(\d+)"')
if (-not $verMatch.Success) { throw "Failed to parse version in Cargo.toml" }
$major = [int]$verMatch.Groups[1].Value
$minor = [int]$verMatch.Groups[2].Value
$patch = [int]$verMatch.Groups[3].Value + 1
$newVer = "$major.$minor.$patch"
Write-Host "    New version: $newVer" -ForegroundColor Green

Write-Host "==> Updating version numbers ..." -ForegroundColor Cyan
$content = $content -replace 'version = "\d+\.\d+\.\d+"', "version = `"$newVer`""
Set-Content $cargo -Value $content -NoNewline

$confContent = Get-Content $conf -Raw
$confContent = $confContent -replace '"version": "\d+\.\d+\.\d+"', "`"version`": `"$newVer`""
Set-Content $conf -Value $confContent -NoNewline

Write-Host "==> Syncing frontend ..." -ForegroundColor Cyan
Copy-Item -LiteralPath $md -Destination $frontend -Force
Write-Host "    Copied to: $frontend" -ForegroundColor Green

Write-Host "==> Building v$newVer ..." -ForegroundColor Cyan
$env:Path = "C:\Program Files (x86)\NSIS;" + $env:Path
$env:Path = $env:Path + ";$env:USERPROFILE\.cargo\bin"

Push-Location $src
try {
    cargo tauri build
    if ($LASTEXITCODE -ne 0) { throw "Build failed (exit code: $LASTEXITCODE)" }
} finally {
    Pop-Location
}

$nsisDir = [System.IO.Path]::Combine($src, "target", "release", "bundle", "nsis")
$installer = Get-ChildItem -Path $nsisDir -Filter "*.exe" | Select-Object -First 1
if ($installer) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Build succeeded: $($installer.Name)" -ForegroundColor Green
    Write-Host "  Version: v$newVer" -ForegroundColor Green
    Write-Host "  Size: $("{0:N1}" -f ($installer.Length / 1MB)) MB" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Cyan
}

param(
  [string]$Version = '',
  [switch]$NoBump,
  [switch]$SyncOnly,
  [switch]$Android
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = [System.IO.Path]::Combine($root, "application", "src-tauri")
$cargo = [System.IO.Path]::Combine($src, "Cargo.toml")
$conf = [System.IO.Path]::Combine($src, "tauri.conf.json")
$props = [System.IO.Path]::Combine($src, "gen", "android", "app", "tauri.properties")
$md = [System.IO.Path]::Combine($root, "mdviewer.html")
$frontend = [System.IO.Path]::Combine($root, "application", "frontend", "index.html")

# ---- version ----
Write-Host "==> Reading version ..." -ForegroundColor Cyan
$content = Get-Content $cargo -Raw
$verMatch = [regex]::Match($content, 'version = "(\d+)\.(\d+)\.(\d+)"')
if (-not $verMatch.Success) { throw "Failed to parse version in Cargo.toml" }

if ($Version) {
  $v = [regex]::Match($Version, '^(\d+)\.(\d+)\.(\d+)$')
  if (-not $v.Success) { throw "Version must be X.Y.Z, got: $Version" }
  $major = [int]$v.Groups[1].Value
  $minor = [int]$v.Groups[2].Value
  $patch = [int]$v.Groups[3].Value
} elseif ($NoBump) {
  $major = [int]$verMatch.Groups[1].Value
  $minor = [int]$verMatch.Groups[2].Value
  $patch = [int]$verMatch.Groups[3].Value
} else {
  $major = [int]$verMatch.Groups[1].Value
  $minor = [int]$verMatch.Groups[2].Value
  $patch = [int]$verMatch.Groups[3].Value + 1
}
$newVer = "$major.$minor.$patch"

# Android versionCode = yyMMddHHmm (e.g. 2607242030)
$versionCode = Get-Date -Format "yyMMddHHmm"
Write-Host "    App version: v$newVer" -ForegroundColor Green
Write-Host "    Android versionCode: $versionCode" -ForegroundColor Green

Write-Host "==> Updating Cargo.toml ..." -ForegroundColor Cyan
$content = $content -replace 'version = "\d+\.\d+\.\d+"', "version = `"$newVer`""
Set-Content $cargo -Value $content -NoNewline

Write-Host "==> Updating tauri.conf.json ..." -ForegroundColor Cyan
$confContent = Get-Content $conf -Raw
$confContent = $confContent -replace '"version": "\d+\.\d+\.\d+"', "`"version`": `"$newVer`""
Set-Content $conf -Value $confContent -NoNewline

Write-Host "==> Updating tauri.properties ..." -ForegroundColor Cyan
if (Test-Path $props) {
  $p = Get-Content $props -Raw
  $p = $p -replace 'tauri\.android\.versionName=[\d\.]+', "tauri.android.versionName=$newVer"
  $p = $p -replace 'tauri\.android\.versionCode=\d+', "tauri.android.versionCode=$versionCode"
  Set-Content $props -Value $p -NoNewline
} else {
  Write-Host "    (gen/android/app/tauri.properties not found — skipping)" -ForegroundColor Yellow
}

Write-Host "==> Updating mdviewer.html display version ..." -ForegroundColor Cyan
$mdContent = Get-Content $md -Raw
$mdContent = $mdContent -replace '(class="version">)v[\d\.]+', "`$1v$newVer"
Set-Content $md -Value $mdContent -NoNewline

Write-Host "==> Syncing frontend ..." -ForegroundColor Cyan
Copy-Item -LiteralPath $md -Destination $frontend -Force
Write-Host "    Copied to: $frontend" -ForegroundColor Green

if (-not $SyncOnly) {
  if ($Android) {
    Write-Host "==> Building Android APK v$newVer ..." -ForegroundColor Cyan
    Push-Location $src
    try {
        cargo tauri android build --apk
        if ($LASTEXITCODE -ne 0) { throw "Android build failed (exit code: $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
  } else {
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
  }
}

# ---- summary ----
$builtSomething = $false
if (-not $SyncOnly -and -not $Android) {
  $nsisDir = [System.IO.Path]::Combine($src, "target", "release", "bundle", "nsis")
  $installer = Get-ChildItem -Path $nsisDir -Filter "*.exe" | Select-Object -First 1
  if ($installer) {
      $builtSomething = $true
      Write-Host ""
      Write-Host "============================================" -ForegroundColor Cyan
      Write-Host "  Version: v$newVer" -ForegroundColor Green
      Write-Host "  Android versionCode: $versionCode" -ForegroundColor Green
      Write-Host "  NSIS: $($installer.Name)" -ForegroundColor Green
      Write-Host "  Size: $("{0:N1}" -f ($installer.Length / 1MB)) MB" -ForegroundColor Green
      Write-Host "============================================" -ForegroundColor Cyan
  }
}

# MSI via WiX v7
$wixDir = "C:\Program Files\WiX Toolset v7.0\bin"
$wix = [System.IO.Path]::Combine($wixDir, "wix.exe")
$wxs = [System.IO.Path]::Combine($root, "application", "mdviewer.wxs")
$msiOut = [System.IO.Path]::Combine($src, "target", "release", "bundle", "msi", "mdviewer_$newVer`_x64.msi")
if (Test-Path $wix) {
    Write-Host "==> Building MSI with WiX v7 ..." -ForegroundColor Cyan
    $env:Path = "$wixDir;" + $env:Path
    $msiDir = [System.IO.Path]::GetDirectoryName($msiOut)
    New-Item -ItemType Directory -Path $msiDir -Force | Out-Null
    Push-Location (Join-Path $root "application")
    try {
        & $wix build $wxs -d Version="$newVer" -o $msiOut -arch x64
        if ($LASTEXITCODE -eq 0) {
            $msiFile = Get-Item -LiteralPath $msiOut
            Write-Host "  MSI: $($msiFile.Name)" -ForegroundColor Green
            Write-Host "  Size: $("{0:N1}" -f ($msiFile.Length / 1MB)) MB" -ForegroundColor Green
        } else {
            Write-Host "  MSI build failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "==> Skipping MSI: WiX v7 not found at $wixDir" -ForegroundColor Yellow
}

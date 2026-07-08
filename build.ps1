$ErrorActionPreference = "Stop"

# 根目录
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. 读取当前版本号（从 Cargo.toml）
$cargo = Join-Path $root "application" "src-tauri" "Cargo.toml"
$conf = Join-Path $root "application" "src-tauri" "tauri.conf.json"
$md = Join-Path $root "mdviewer.html"
$frontend = Join-Path $root "application" "frontend" "index.html"

Write-Host "==> 读取版本号 ..." -ForegroundColor Cyan
$content = Get-Content $cargo -Raw
$verMatch = [regex]::Match($content, 'version = "(\d+)\.(\d+)\.(\d+)"')
if (-not $verMatch.Success) { throw "无法解析版本号" }
$major = [int]$verMatch.Groups[1].Value
$minor = [int]$verMatch.Groups[2].Value
$patch = [int]$verMatch.Groups[3].Value + 1
$newVer = "${major}.${minor}.${patch}"
Write-Host "    新版本: $newVer" -ForegroundColor Green

# 2. 更新版本号
Write-Host "==> 更新版本号 ..." -ForegroundColor Cyan
$content = $content -replace 'version = "\d+\.\d+\.\d+"', "version = `"$newVer`""
Set-Content $cargo -Value $content -NoNewline

$confContent = Get-Content $conf -Raw
$confContent = $confContent -replace '"version": "\d+\.\d+\.\d+"', "`"version`": `"$newVer`""
Set-Content $conf -Value $confContent -NoNewline

# 3. 同步前端文件
Write-Host "==> 同步前端文件 ..." -ForegroundColor Cyan
Copy-Item -LiteralPath $md -Destination $frontend -Force
Write-Host "    已复制: $frontend" -ForegroundColor Green

# 4. 构建
Write-Host "==> 开始构建 v${newVer} ..." -ForegroundColor Cyan
$env:Path = "C:\Program Files (x86)\NSIS;" + $env:Path
$env:Path += ";$env:USERPROFILE\.cargo\bin"

Push-Location (Join-Path $root "application" "src-tauri")
try {
    cargo tauri build 2>&1 | ForEach-Object {
        if ($_ -match "error|Error") {
            Write-Host $_ -ForegroundColor Red
        } elseif ($_ -match "Finished|bundle at|Bundle at|Running makensis") {
            Write-Host $_ -ForegroundColor Green
        } elseif ($_ -match "warning|Warning") {
            Write-Host $_ -ForegroundColor Yellow
        } else {
            Write-Host $_
        }
    }
    if ($LASTEXITCODE -ne 0) { throw "构建失败 (exit code: $LASTEXITCODE)" }
} finally {
    Pop-Location
}

# 5. 打印产物
$nsisDir = Join-Path $root "application" "src-tauri" "target" "release" "bundle" "nsis"
$installer = Get-ChildItem -Path $nsisDir -Filter "*.exe" | Select-Object -First 1
if ($installer) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  构建成功: $($installer.Name)" -ForegroundColor Green
    Write-Host "  版本: v${newVer}" -ForegroundColor Green
    Write-Host "  大小: $("{0:N1}" -f ($installer.Length / 1MB)) MB" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Cyan
}

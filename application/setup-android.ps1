# mdviewer Android 构建环境设置脚本
# 运行前请确保已安装：
#   1. Rust (https://rustup.rs)
#   2. Android Studio + Android SDK + NDK
#   3. Java JDK 17+

$ErrorActionPreference = "Stop"

# 检查 cargo
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "未找到 cargo，请先安装 Rust: https://rustup.rs"
    exit 1
}

# 检查 Android SDK 环境变量
$androidHome = $env:ANDROID_HOME
if (-not $androidHome) {
    $androidHome = $env:ANDROID_SDK_ROOT
}
if (-not $androidHome) {
    Write-Warning "ANDROID_HOME 未设置，请设置后重试"
    Write-Warning "例如: `$env:ANDROID_HOME = 'C:\Users\$env:USERNAME\AppData\Local\Android\Sdk'"
}

Write-Host "初始化 Android 平台..."
npx tauri android init

Write-Host "完成！现在可以运行以下命令构建:"
Write-Host "  cd application"
Write-Host "  npx tauri android build"

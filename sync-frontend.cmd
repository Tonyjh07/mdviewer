@echo off
REM 将根目录的 mdviewer.html 同步到 Tauri 前端目录
copy /Y "C:\mdviewer\mdviewer.html" "C:\mdviewer\application\frontend\index.html"
echo Synced mdviewer.html -> application/frontend/index.html
echo.
echo 如果修改了 Rust 代码或前端文件，构建前需要：
echo 1. del target\aarch64-linux-android\release\libmdviewer_lib.so
echo 2. npx tauri android build --target aarch64

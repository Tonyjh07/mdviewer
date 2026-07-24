@echo off
chcp 65001 >nul
cd /d "C:\mdviewer"

REM 步骤1：同步前端文件
copy /Y "mdviewer.html" "application\frontend\index.html" >nul
echo [1/6] 前端已同步

REM 步骤2：删除旧 .so 强制 Rust 重新编译
if exist "application\src-tauri\target\aarch64-linux-android\release\libmdviewer_lib.so" (
    del /f "application\src-tauri\target\aarch64-linux-android\release\libmdviewer_lib.so"
)
echo [2/6] 已清除旧 .so

REM 步骤3：编译 Rust（含前端嵌入）
cd application\src-tauri
call npx tauri android build --target aarch64
if %errorlevel% neq 0 (
    echo Rust 编译失败，但 .so 可能已生成，继续...
)
echo [3/6] Rust 编译完成

REM 步骤4：复制 .so 到 jniLibs
copy /Y "target\aarch64-linux-android\release\libmdviewer_lib.so" "gen\android\app\src\main\jniLibs\arm64-v8a\libmdviewer_lib.so" >nul
echo [4/6] .so 已复制

REM 步骤5：构建 APK
cd gen\android
call .\gradlew assembleRelease --quiet
echo [5/6] APK 构建完成

REM 步骤6：签名
set ANDROID_HOME=C:\Users\杨\AppData\Local\Android\Sdk
for /f %%v in ('dir /b "%ANDROID_HOME%\build-tools"') do set BTVER=%%v& goto :found
:found
"%ANDROID_HOME%\build-tools\%BTVER%\apksigner.bat" sign ^
    --ks "%USERPROFILE%\.android\debug.keystore" ^
    --ks-pass pass:android ^
    --ks-key-alias androiddebugkey ^
    --key-pass pass:android ^
    --out "C:\mdviewer\mdviewer-arm64-release.apk" ^
    "app\build\outputs\apk\arm64\release\app-arm64-release-unsigned.apk"
echo [6/6] APK 已签名: C:\mdviewer\mdviewer-arm64-release.apk

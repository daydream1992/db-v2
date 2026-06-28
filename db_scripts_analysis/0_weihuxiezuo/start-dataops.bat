@echo off
chcp 65001 >nul 2>&1
title DataOps 管理台

echo.
echo   DataOps 管理台 · DB数据库_v2
echo   独立UI · 无需端口/服务器
echo.

set "UI_DIR=%~dp0dataops-ui"

if not exist "%UI_DIR%\index.html" (
    echo [!] 未找到 UI 文件
    echo     请先在项目根目录运行: bun run build:static
    echo     然后将 out/ 复制到 0_weihuxiezuo\dataops-ui\
    echo.
    pause
    exit /b 1
)

echo [*] 正在打开...
start "" "%UI_DIR%\index.html"

echo [√] 已在浏览器中打开
echo.
echo   如页面空白(Chrome限制)，改用:
echo   cd dataops-ui ^&^& python -m http.server 8080
echo   然后浏览器访问 http://localhost:8080
echo.
pause

@echo off
chcp 65001 >nul 2>&1
title DataOps 管理台 - 本地启动器

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║       DataOps 管理台  ·  DB数据库_v2               ║
echo   ║       独立 UI 界面  ·  无需端口/服务器              ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

set "UI_DIR=%~dp0dataops-ui"

:: 检查 dataops-ui 目录是否存在
if not exist "%UI_DIR%\index.html" (
    echo [!] 未找到 UI 文件，请先运行构建：
    echo     cd 项目根目录
    echo     bun run build:static
    echo     然后将 out/ 目录复制到 0_weihuxiezuo/dataops-ui/
    echo.
    pause
    exit /b 1
)

echo [*] 正在打开 DataOps 管理台...
echo.

:: 方式1：直接用浏览器打开 HTML 文件（file:// 协议）
start "" "%UI_DIR%\index.html"

echo [√] 已在浏览器中打开！
echo.
echo   ┌─────────────────────────────────────────────────┐
echo   │  打开方式说明：                                  │
echo   │                                                  │
echo   │  ✅ 方式1（当前）：双击 index.html               │
echo   │     → 浏览器直接打开，无需任何服务器/端口         │
echo   │     → 如页面空白，请用方式2                      │
echo   │                                                  │
echo   │  ✅ 方式2（推荐）：本地 HTTP 服务                │
echo   │     → 在此目录运行：                             │
echo   │       python -m http.server 8080                 │
echo   │     → 浏览器访问 http://localhost:8080            │
echo   │                                                  │
echo   │  📁 UI 文件位置：                                │
echo   │     %UI_DIR%                                     │
echo   └─────────────────────────────────────────────────┘
echo.
echo [提示] 关闭此窗口不影响已打开的页面
echo.
pause

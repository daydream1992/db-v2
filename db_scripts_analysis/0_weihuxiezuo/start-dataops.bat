@echo off
chcp 65001 >nul 2>&1
title DataOps 管理台 - 本地启动器

echo ╔══════════════════════════════════════════════════════╗
echo ║          DataOps 管理台 · DB数据库_v2               ║
echo ║          本地启动器 (无需端口/服务器)                ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: 检查 out 目录是否存在
if not exist "%~dp0out\index.html" (
    echo [!] 未找到静态导出文件，正在构建...
    echo.
    cd /d "%~dp0.."
    set BUILD_MODE=export
    call npx next build
    echo.
    echo [√] 构建完成！
    echo.
)

:: 尝试直接用默认浏览器打开 index.html
echo [*] 正在打开 DataOps 管理台...
start "" "%~dp0out\index.html"

echo.
echo [√] 已在浏览器中打开！
echo     如浏览器未自动打开，请手动双击以下文件：
echo     %~dp0out\index.html
echo.
echo [提示] 按 Ctrl+C 关闭此窗口不影响已打开的页面
echo.
pause

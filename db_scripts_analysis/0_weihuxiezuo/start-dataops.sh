#!/usr/bin/env bash
# DataOps 管理台 · DB数据库_v2 — 独立 UI 启动器
# 用法: bash start-dataops.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$SCRIPT_DIR/dataops-ui"

echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║       DataOps 管理台  ·  DB数据库_v2               ║"
echo "  ║       独立 UI 界面  ·  无需端口/服务器              ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""

# 检查 dataops-ui 目录是否存在
if [ ! -f "$UI_DIR/index.html" ]; then
    echo "[!] 未找到 UI 文件，请先运行构建："
    echo "    cd 项目根目录"
    echo "    bun run build:static"
    echo "    然后将 out/ 目录复制到 0_weihuxiezuo/dataops-ui/"
    exit 1
fi

echo "[*] 正在打开 DataOps 管理台..."
echo ""

# 尝试用默认浏览器打开 index.html
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$UI_DIR/index.html"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$UI_DIR/index.html" 2>/dev/null || echo "[!] 无法自动打开浏览器"
fi

echo "[√] 已在浏览器中打开！"
echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  打开方式说明：                                  │"
echo "  │                                                  │"
echo "  │  ✅ 方式1（当前）：双击 index.html               │"
echo "  │     → 浏览器直接打开，无需任何服务器/端口         │"
echo "  │     → 如页面空白，请用方式2                      │"
echo "  │                                                  │"
echo "  │  ✅ 方式2（推荐）：本地 HTTP 服务                │"
echo "  │     → 在此目录运行：                             │"
echo "  │       cd $UI_DIR"
echo "  │       python3 -m http.server 8080                │"
echo "  │     → 浏览器访问 http://localhost:8080            │"
echo "  │                                                  │"
echo "  │  📁 UI 文件位置：                                │"
echo "  │     $UI_DIR"
echo "  └─────────────────────────────────────────────────┘"
echo ""

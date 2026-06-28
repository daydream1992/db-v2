#!/usr/bin/env bash
# DataOps 管理台 · DB数据库_v2 — 本地启动器
# 用法: bash start-dataops.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔══════════════════════════════════════════════════════╗"
echo "║          DataOps 管理台 · DB数据库_v2               ║"
echo "║          本地启动器 (无需端口/服务器)                ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# 检查 out 目录是否存在
if [ ! -f "$PROJECT_DIR/out/index.html" ]; then
    echo "[!] 未找到静态导出文件，正在构建..."
    echo ""
    cd "$PROJECT_DIR"
    BUILD_MODE=export npx next build
    echo ""
    echo "[√] 构建完成！"
    echo ""
fi

# 尝试用默认浏览器打开 index.html
echo "[*] 正在打开 DataOps 管理台..."

if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$PROJECT_DIR/out/index.html"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$PROJECT_DIR/out/index.html" 2>/dev/null || echo "[!] 无法自动打开浏览器，请手动打开: $PROJECT_DIR/out/index.html"
else
    echo "[!] 未知系统，请手动打开: $PROJECT_DIR/out/index.html"
fi

echo ""
echo "[√] 已在浏览器中打开！"
echo "    如浏览器未自动打开，请手动打开以下文件："
echo "    $PROJECT_DIR/out/index.html"
echo ""

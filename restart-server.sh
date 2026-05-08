#!/bin/bash

# Restart Game Server Script
# 殺掉佔用 port 3000 的程序並重新啟動伺服器

echo "========================================"
echo "🔄 重開遊戲伺服器"
echo "========================================"

# 查找並殺掉佔用 port 3000 的程序
PORT_PID=$(lsof -ti :3000)

if [ -n "$PORT_PID" ]; then
    echo "🔍 發現佔用 port 3000 的程序 (PID: $PORT_PID)"
    echo "⚡ 正在終止程序..."
    kill -9 $PORT_PID
    sleep 1
    echo "✅ 程序已終止"
else
    echo "ℹ️  Port 3000 沒有被佔用"
fi

# 等待一下確保 port 被釋放
sleep 1

# 啟動伺服器
echo "🚀 正在啟動遊戲伺服器..."
cd "$(dirname "$0")"
node server/index.js &
SERVER_PID=$!

# 等待伺服器啟動
sleep 2

# 檢查伺服器是否成功啟動
if lsof -i :3000 > /dev/null 2>&1; then
    echo "✅ 伺服器啟動成功！"
    echo ""
    echo "📡 伺服器資訊:"
    echo "   Local   → http://localhost:3000"
    echo "   Mobile  → http://localhost:3000/mobile"
    echo "   Display → http://localhost:3000/display"
    echo "   Host    → http://localhost:3000/host"
    echo ""
    echo "📝 伺服器 PID: $SERVER_PID"
    echo "💡 查看日誌: tail -f /dev/null"
    echo "⚠️  按 Ctrl+C 停止伺服器"
    echo "========================================"

    # 持續運行直到用戶按 Ctrl+C
    wait $SERVER_PID
else
    echo "❌ 伺服器啟動失敗！"
    echo "💡 檢查錯誤日誌"
    exit 1
fi

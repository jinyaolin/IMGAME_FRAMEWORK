#!/bin/bash

# Kill Game Server Script
# 殺掉佔用 port 3000 的所有程序

echo "🔍 查找佔用 port 3000 的程序..."

# 查找所有佔用 port 3000 的 PIDs
PIDS=$(lsof -ti :3000)

if [ -n "$PIDS" ]; then
    echo "⚡ 發現以下程序:"
    lsof -i :3000 | tail -n +2
    echo ""
    echo "🛑 正在終止程序..."
    kill -9 $PIDS
    sleep 1
    echo "✅ 已終止 " $(echo $PIDS | wc -w) " 個程序"
else
    echo "ℹ️  Port 3000 沒有被佔用"
fi

echo "✅ 完成"

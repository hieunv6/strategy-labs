#!/bin/bash
# ========================================
# EMA Strategy — Script tắt server
# Chạy: bash stop.sh
# ========================================

PORT=8765

if lsof -ti:$PORT > /dev/null 2>&1; then
  lsof -ti:$PORT | xargs kill -9
  echo "🛑 Server port $PORT đã tắt"
else
  echo "ℹ️  Không có server nào đang chạy ở port $PORT"
fi

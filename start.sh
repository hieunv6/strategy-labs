#!/usr/bin/env bash
# start.sh — Khởi động EMA Strategy Server

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8765
PID_FILE="$DIR/.server.pid"

echo ""
echo "  🚀 EMA Strategy — Local Server"
echo "  ─────────────────────────────────────"

# Dừng server cũ nếu đang chạy
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "  🛑 Dừng server cũ (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null
    sleep 0.5
  fi
  rm -f "$PID_FILE"
fi

# Kiểm tra port còn bị chiếm không
if lsof -ti:$PORT > /dev/null 2>&1; then
  echo "  🛑 Port $PORT đang bị chiếm, đang giải phóng..."
  lsof -ti:$PORT | xargs kill -9 2>/dev/null
  sleep 0.5
fi

# Tạo thư mục db nếu chưa có
mkdir -p "$DIR/db"

# Kiểm tra DB
if [ ! -f "$DIR/db/market_data.db" ]; then
  echo ""
  echo "  ⚠️  Chưa có dữ liệu! Hãy chạy lệnh sau để tải dữ liệu:"
  echo ""
  echo "      python3 $DIR/download.py"
  echo ""
  echo "  Sau đó chạy lại start.sh"
  echo ""
  echo "  Hoặc khởi động server trước để xem giao diện:"
fi

# Khởi động server
python3 "$DIR/server.py" &
SERVER_PID=$!
echo $SERVER_PID > "$PID_FILE"

sleep 0.8

# Kiểm tra server đã lên chưa
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "  ❌ Server khởi động thất bại"
  exit 1
fi

echo "  ✅ Server đang chạy (PID $SERVER_PID)"
echo ""
echo "  🌐 http://localhost:$PORT"
echo "  📊 http://localhost:$PORT/backtest.html"
echo ""

# Mở trình duyệt
if command -v open &>/dev/null; then
  open "http://localhost:$PORT/backtest.html"
elif command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:$PORT/backtest.html"
fi

echo "  Dùng ./stop.sh để dừng server"
echo ""

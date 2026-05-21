# 📈 Strategy Lab

> **Hệ thống backtest chiến lược giao dịch EMA 20/50** — Phân tích dữ liệu lịch sử Binance, backtest đơn lẻ và danh mục, báo cáo chi tiết với Sharpe Ratio, Monthly Heatmap và ATR Stop Loss.

![Strategy Lab Screenshot](https://img.shields.io/badge/status-active-00d4a0?style=flat-square) ![Python](https://img.shields.io/badge/python-3.9+-3776ab?style=flat-square&logo=python&logoColor=white) ![Vanilla JS](https://img.shields.io/badge/JS-vanilla-f7df1e?style=flat-square&logo=javascript&logoColor=black) ![SQLite](https://img.shields.io/badge/SQLite-local--db-003b57?style=flat-square&logo=sqlite)

---

## ✨ Tính năng

### 📊 Backtest Engine
- **Chiến lược EMA 20/50** — Crossover + Retest + Reversal Pattern
- **Chế độ đơn lẻ** — Backtest 1 coin với mọi tham số tùy chỉnh
- **Chế độ danh mục** — Backtest đồng thời BTC, ETH, BNB, SOL... với báo cáo tổng hợp

### 🛡️ Stop Loss
| Loại | Mô tả |
|------|-------|
| **Fixed %** | SL cố định theo % (1% – 5%) |
| **ATR ×** | SL tự động theo ATR(14) × hệ số (Wilder RMA) |

### 📋 Báo cáo chi tiết
- **Core metrics**: Win Rate, Profit Factor, Tổng PnL, Vốn cuối, Max Drawdown
- **Advanced metrics**: Sharpe Ratio, Sortino, Recovery Factor, Expectancy/lệnh, Avg Hold
- **Monthly Heatmap**: Lưới tháng × năm với màu lãi/lỗ
- **Pattern Table**: Hiệu suất từng mô hình nến (Hammer, Engulfing, Pin Bar, Doji...)
- **Equity Curve**: Đường vốn có phân màu WIN/LOSS
- **Symbol Breakdown**: So sánh hiệu suất từng coin trong danh mục

### 🔍 Tìm kiếm & Dữ liệu
- Search autocomplete 599+ cặp USDT trên Binance
- Tự động tải và lưu dữ liệu vào **SQLite local** (lần sau chạy tức thì)
- Hỗ trợ tối đa **10 năm** dữ liệu lịch sử
- Real-time download progress (SSE streaming)

### 📈 Live Chart
- TradingView-style chart (Canvas, tự render)
- EMA 20/50 overlay, Volume bars
- Zoom & Pan

---

## 🚀 Cài đặt & Chạy

### Yêu cầu
- Python 3.9+
- Kết nối internet (lần đầu tải dữ liệu)

### Khởi động

```bash
git clone git@github.com:hieunv6/strategy-labs.git
cd strategy-labs

# Chạy server (không cần cài thêm thư viện — chỉ dùng stdlib)
python3 server.py

# Mở trình duyệt
open http://localhost:8765
```

Hoặc dùng script:

```bash
chmod +x start.sh stop.sh
./start.sh        # Khởi động server + mở browser
./stop.sh         # Dừng server
```

---

## 🗂️ Cấu trúc thư mục

```
strategy-labs/
├── index.html          # Live chart
├── style.css           # Global styles
├── chart.js            # Canvas chart engine
│
├── backtest.html       # Backtest UI
├── backtest.css        # Backtest styles
├── backtest.js         # Backtest engine (EMA, ATR, metrics)
├── data-cache.js       # Data manager UI helper
│
├── server.py           # Python API server (stdlib only)
├── download.py         # Binance historical data downloader
│
├── start.sh / stop.sh  # Helper scripts
│
└── db/
    └── market_data.db  # SQLite database (gitignored)
```

---

## ⚙️ Tham số Backtest

| Tham số | Mô tả | Mặc định |
|---------|-------|---------|
| Symbol | Cặp USDT (BTC, ETH...) | BTCUSDT |
| Timeframe | 15m / 1h / 4h / 1D | 4h |
| Khoảng thời gian | 1 tháng → 10 năm | 3 năm |
| SL Mode | Fixed % hoặc ATR× | Fixed 1.5% |
| ATR Period | Chu kỳ ATR (Wilder) | 14 |
| ATR Multiplier | Hệ số nhân ATR | 1.5 |
| R:R Ratio | Risk:Reward | 1:2 |
| Vốn ban đầu | USD | $10,000 |

---

## 📐 Chiến lược EMA 20/50

```
1. EMA 20 cắt EMA 50 từ dưới lên (Bullish Cross) → Tìm điểm BUY
   EMA 20 cắt EMA 50 từ trên xuống (Bearish Cross) → Tìm điểm SELL

2. Chờ giá Retest về vùng EMA 20 hoặc EMA 50

3. Xác nhận bằng Candle Reversal Pattern:
   - Hammer / Hanging Man
   - Bullish/Bearish Engulfing
   - Pin Bar
   - Shooting Star
   - Doji

4. Vào lệnh tại nến tiếp theo sau pattern
5. SL: dưới EMA theo Fixed% hoặc ATR×
6. TP: theo R:R Ratio
```

---

## 📊 Metrics giải thích

| Metric | Ý nghĩa | Ngưỡng tốt |
|--------|---------|-----------|
| **Win Rate** | % lệnh thắng | > 50% |
| **Profit Factor** | Tổng lãi / Tổng lỗ | > 1.5 |
| **Sharpe Ratio** | Lợi nhuận / Rủi ro (annualized) | > 1.0 |
| **Sortino** | Như Sharpe nhưng chỉ tính downside risk | > 1.5 |
| **Recovery Factor** | PnL / Max Drawdown amount | > 2.0 |
| **Expectancy** | Kỳ vọng lợi nhuận trung bình mỗi lệnh | > $0 |
| **Max Drawdown** | Mức giảm vốn lớn nhất từ đỉnh | < 20% |

---

## 🗺️ Quy trình Backtest → Live

```
[1] Thiết kế  →  [2] Backtest  →  [3] Forward Test  →  [4] Live nhỏ  →  [5] Scale up
   Chiến lược      ≥ 3 năm, đa     3–6 tháng             1–5% vốn         Sau 3 tháng
   rõ ràng         coin, WF split   paper trading          real money        proven
```

**Ngưỡng tối thiểu để đi live:**
- ✅ Win Rate > 50%, PF > 1.3, Sharpe > 0.5, Max DD < 30%
- ✅ Đã paper trade ≥ 50 lệnh real-time
- ✅ Live Win Rate ≥ Backtest × 0.85

---

## 🔧 API Endpoints (server.py)

| Endpoint | Mô tả |
|----------|-------|
| `GET /api/klines?symbol=BTCUSDT&interval=4h` | Lấy dữ liệu nến từ DB |
| `GET /api/meta` | Danh sách datasets đã tải |
| `GET /api/symbols` | 599+ cặp USDT từ Binance |
| `GET /api/download?symbol=X&interval=Y` | Tải dữ liệu (SSE streaming) |
| `GET /api/status` | Trạng thái server & tổng số nến |

---

## 📝 License

MIT — Dùng tự do, không bảo đảm kết quả giao dịch thực tế.

> ⚠️ **Disclaimer**: Tool này chỉ phục vụ mục đích nghiên cứu và học tập. Kết quả backtest không đảm bảo hiệu suất trong tương lai. Giao dịch tài chính có rủi ro mất vốn.

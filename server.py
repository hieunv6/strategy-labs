#!/usr/bin/env python3
"""
server.py — HTTP server phục vụ static files + API từ SQLite

Endpoints:
    GET  /api/klines?symbol=BTCUSDT&interval=4h[&startTime=ms&endTime=ms]
    GET  /api/meta                 → danh sách dữ liệu trong DB
    GET  /api/status               → trạng thái server
    GET  /api/symbols              → danh sách tất cả USDT pairs trên Binance
    GET  /api/download?symbol=X&interval=Y  → tải + lưu vào DB (SSE streaming)
"""

import sqlite3, json, os, sys, signal, time, threading
from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen
from urllib.error import URLError
from datetime import datetime

PORT    = 8765
DB_PATH = os.path.join(os.path.dirname(__file__), "db", "market_data.db")
STATIC  = os.path.dirname(__file__)

INTERVAL_MS = {
    "1m":60_000,"3m":180_000,"5m":300_000,"15m":900_000,"30m":1_800_000,
    "1h":3_600_000,"2h":7_200_000,"4h":14_400_000,"6h":21_600_000,
    "8h":28_800_000,"12h":43_200_000,"1d":86_400_000,"3d":259_200_000,"1w":604_800_000,
}

INCEPTION = {
    "BTCUSDT":"2017-08-17","ETHUSDT":"2017-08-17","BNBUSDT":"2017-11-06",
    "XRPUSDT":"2018-05-04","ADAUSDT":"2018-04-17","SOLUSDT":"2020-08-11",
    "DOGEUSDT":"2019-07-05","AVAXUSDT":"2020-09-22","DOTUSDT":"2020-08-19",
    "MATICUSDT":"2019-04-26","LINKUSDT":"2019-01-16","UNIUSDT":"2020-09-17",
    "ATOMUSDT":"2019-04-29","LTCUSDT":"2017-12-13","NEARUSDT":"2020-11-18",
    "AAVEUSDT":"2020-10-05","APTUSDT":"2022-10-19","ARBUSDT":"2023-03-23",
    "OPUSDT":"2022-06-02","SUIUSDT":"2023-05-03",
}

BATCH = 1000
DELAY = 0.08

# ─── Download helpers ────────────────────────────────────────────────────────

def init_db(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS klines (
            symbol TEXT NOT NULL, interval TEXT NOT NULL, time INTEGER NOT NULL,
            open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
            close REAL NOT NULL, volume REAL NOT NULL,
            PRIMARY KEY (symbol, interval, time))""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sym_int_time ON klines(symbol,interval,time)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
            symbol TEXT NOT NULL, interval TEXT NOT NULL,
            last_time INTEGER, count INTEGER, updated_at TEXT,
            PRIMARY KEY (symbol, interval))""")
    conn.commit()

def parse_inception_ms(symbol):
    from datetime import datetime as dt
    date_str = INCEPTION.get(symbol, "2017-01-01")
    return int(dt.strptime(date_str, "%Y-%m-%d").timestamp() * 1000)

def get_last_time_db(conn, symbol, interval):
    row = conn.execute(
        "SELECT MAX(time) FROM klines WHERE symbol=? AND interval=?",
        (symbol, interval)).fetchone()
    return row[0] if row and row[0] else None

def fetch_batch_binance(symbol, interval, start_ms=None, end_ms=None):
    params = f"symbol={symbol}&interval={interval}&limit={BATCH}"
    if start_ms: params += f"&startTime={int(start_ms)}"
    if end_ms:   params += f"&endTime={int(end_ms)}"
    url = f"https://api.binance.com/api/v3/klines?{params}"
    with urlopen(url, timeout=20) as r:
        data = json.load(r)
    return [(int(k[0]),float(k[1]),float(k[2]),float(k[3]),float(k[4]),float(k[5])) for k in data]

def download_to_db(conn, symbol, interval, send_event):
    """Tải dữ liệu + lưu vào DB. Gọi send_event(type, data) để stream progress."""
    now_ms   = int(time.time() * 1000)
    last_t   = get_last_time_db(conn, symbol, interval)
    ims      = INTERVAL_MS.get(interval, 14_400_000)
    start_ms = (last_t + 1) if last_t else parse_inception_ms(symbol)
    is_update = bool(last_t)

    if last_t and (now_ms - last_t) < ims * 2:
        total = conn.execute(
            "SELECT COUNT(*) FROM klines WHERE symbol=? AND interval=?",
            (symbol, interval)).fetchone()[0]
        send_event("done", {"candles": total, "new": 0, "msg": "Dữ liệu đã mới"})
        return

    total_ms  = now_ms - start_ms
    est_batch = max(1, total_ms // (ims * BATCH))
    mode = "Cập nhật" if is_update else "Tải mới"
    send_event("start", {"symbol": symbol, "interval": interval,
                          "mode": mode, "estBatches": est_batch})

    inserted = 0
    current  = start_ms
    batch_n  = 0
    errors   = 0

    while current < now_ms:
        try:
            rows = fetch_batch_binance(symbol, interval, start_ms=current, end_ms=now_ms)
        except URLError as e:
            errors += 1
            if errors > 3:
                send_event("error", {"msg": f"Lỗi Binance: {e}"})
                return
            time.sleep(1)
            continue

        if not rows: break

        # Bỏ nến đang mở
        if rows[-1][0] + ims > now_ms:
            rows = rows[:-1]
        if not rows: break

        conn.executemany(
            "INSERT OR IGNORE INTO klines VALUES (?,?,?,?,?,?,?,?)",
            [(symbol, interval, t, o, h, l, c, v) for t,o,h,l,c,v in rows])
        conn.commit()

        inserted += len(rows)
        current   = rows[-1][0] + 1
        batch_n  += 1

        pct = min(95, int((current - start_ms) / max(1, now_ms - start_ms) * 100))
        send_event("progress", {"pct": pct, "candles": inserted, "batch": batch_n, "total": est_batch})

        if len(rows) < BATCH: break
        time.sleep(DELAY)

    # Cập nhật meta
    total_count = conn.execute(
        "SELECT COUNT(*) FROM klines WHERE symbol=? AND interval=?",
        (symbol, interval)).fetchone()[0]
    last_saved = get_last_time_db(conn, symbol, interval)
    conn.execute("INSERT OR REPLACE INTO meta VALUES (?,?,?,?,?)",
        (symbol, interval, last_saved, total_count, datetime.now().isoformat()))
    conn.commit()

    send_event("done", {"candles": total_count, "new": inserted,
                         "msg": f"✅ {total_count:,} nến ({'+'+str(inserted) if inserted else 'đã mới'})"})


# ─── HTTP Handler ─────────────────────────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed)
        else:
            if parsed.path == "/":
                self.path = "/index.html"
            super().do_GET()

    def handle_api(self, parsed):
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        try:
            params = parse_qs(parsed.query)

            if parsed.path == "/api/download":
                self.api_download(params)
                return
            if parsed.path == "/api/symbols":
                self.api_symbols(params)
                return
            if parsed.path == "/api/top100":
                self.api_top100(params)
                return

            if not os.path.exists(DB_PATH):
                self.json_error(503, "DB chưa có. Hãy chạy: python3 download.py")
                return

            conn = sqlite3.connect(DB_PATH)
            conn.execute("PRAGMA journal_mode=WAL")

            if   parsed.path == "/api/klines":  self.api_klines(conn, params)
            elif parsed.path == "/api/meta":    self.api_meta(conn)
            elif parsed.path == "/api/status":  self.api_status(conn)
            elif parsed.path == "/api/clear":   self.api_clear(conn)
            else: self.json_error(404, "Endpoint không tồn tại")

            conn.close()
        except Exception as e:
            import traceback; traceback.print_exc()
            self.json_error(500, str(e))

    # ── /api/klines ───────────────────────────────────────────────────
    def api_klines(self, conn, params):
        symbol   = params.get("symbol",   ["BTCUSDT"])[0].upper()
        interval = params.get("interval", ["4h"])[0]
        start    = params.get("startTime", [None])[0]
        end      = params.get("endTime",   [None])[0]
        limit    = int(params.get("limit", [0])[0])

        where, args = "symbol=? AND interval=?", [symbol, interval]
        if start: where += " AND time >= ?"; args.append(int(start))
        if end:   where += " AND time <= ?"; args.append(int(end))
        order = f"ORDER BY time ASC{f' LIMIT {int(limit)}' if limit else ''}"

        rows = conn.execute(
            f"SELECT time,open,high,low,close,volume FROM klines WHERE {where} {order}",
            args).fetchall()

        if not rows:
            exists = conn.execute(
                "SELECT COUNT(*) FROM klines WHERE symbol=? AND interval=?",
                (symbol, interval)).fetchone()[0]
            if exists == 0:
                self.json_error(404, f"NO_DATA:{symbol}:{interval}")
                return

        self.json_ok([{"time":r[0],"open":r[1],"high":r[2],"low":r[3],"close":r[4],"volume":r[5]}
                      for r in rows])

    # ── /api/meta ─────────────────────────────────────────────────────
    def api_meta(self, conn):
        rows = conn.execute(
            "SELECT symbol,interval,count,last_time,updated_at FROM meta ORDER BY symbol,interval"
        ).fetchall()
        self.json_ok([{"symbol":r[0],"interval":r[1],"count":r[2],
                        "lastTime":r[3],"updatedAt":r[4]} for r in rows])

    # ── /api/status ────────────────────────────────────────────────
    def api_status(self, conn):
        count = conn.execute("SELECT COUNT(*) FROM klines").fetchone()[0]
        size  = os.path.getsize(DB_PATH) / 1024 / 1024
        self.json_ok({"status":"ok","totalCandles":count,"dbSizeMB":round(size,2),
                       "time":datetime.now().isoformat()})

    # ── /api/clear ────────────────────────────────────────────────
    def api_clear(self, conn):
        conn.execute("DELETE FROM klines")
        conn.execute("DELETE FROM meta")
        conn.commit()
        count = conn.execute("SELECT COUNT(*) FROM klines").fetchone()[0]
        self.json_ok({"status":"ok","deleted":True,"remaining":count})

    # ── /api/symbols ──────────────────────────────────────────────────
    def api_symbols(self, params):
        """Trả về danh sách tất cả USDT pairs từ Binance, kèm volume 24h"""
        try:
            with urlopen("https://api.binance.com/api/v3/ticker/24hr", timeout=10) as r:
                tickers = json.load(r)
            usdt = [
                {"symbol": t["symbol"],
                 "base": t["symbol"].replace("USDT",""),
                 "volume": float(t["quoteVolume"]),
                 "price": float(t["lastPrice"]),
                 "change": float(t["priceChangePercent"])}
                for t in tickers
                if t["symbol"].endswith("USDT") and float(t["quoteVolume"]) > 0
            ]
            usdt.sort(key=lambda x: x["volume"], reverse=True)
            self.json_ok(usdt)
        except Exception as e:
            self.json_error(502, f"Không thể lấy danh sách từ Binance: {e}")

    # ── /api/top100 ───────────────────────────────────────────────────
    def api_top100(self, params):
        """Trả về danh sách 100 coin có vốn hóa lớn nhất hỗ trợ USDT trên Binance"""
        try:
            with urlopen("https://api.binance.com/api/v3/ticker/24hr", timeout=10) as r:
                tickers = json.load(r)
            binance_map = {
                t["symbol"]: {
                    "symbol": t["symbol"],
                    "base": t["symbol"].replace("USDT",""),
                    "volume": float(t["quoteVolume"]),
                    "price": float(t["lastPrice"]),
                    "change": float(t["priceChangePercent"])
                }
                for t in tickers
                if t["symbol"].endswith("USDT") and float(t["quoteVolume"]) > 0
            }
        except Exception as e:
            self.json_error(502, f"Không thể lấy danh sách từ Binance: {e}")
            return

        fallback_used = False
        top100 = []

        try:
            from urllib.request import Request
            req = Request(
                "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1",
                headers={"User-Agent": "Mozilla/5.0"}
            )
            with urlopen(req, timeout=8) as r:
                gecko_data = json.load(r)
            
            for coin in gecko_data:
                coingecko_symbol = coin.get("symbol", "").upper()
                binance_sym = coingecko_symbol + "USDT"
                if binance_sym in binance_map:
                    ticker_info = binance_map[binance_sym]
                    ticker_info["name"] = coin.get("name", coin.get("id", ""))
                    ticker_info["market_cap"] = coin.get("market_cap", 0)
                    ticker_info["rank"] = coin.get("market_cap_rank", 999)
                    top100.append(ticker_info)
                    if len(top100) >= 100:
                        break
            
            if len(top100) < 100:
                existing_symbols = {c["symbol"] for c in top100}
                FALLBACK_TOP100 = [
                    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "SHIB", "AVAX", "DOT",
                    "LINK", "TRX", "NEAR", "MATIC", "LTC", "BCH", "UNI", "ICP", "APT", "FIL",
                    "ATOM", "STX", "RNDR", "SUI", "FTM", "OP", "INJ", "IMX", "LDO", "THETA",
                    "TIA", "VET", "MKR", "ETC", "RUNE", "PEPE", "WIF", "ARB", "JUP", "FLOKI",
                    "BONK", "FET", "EGLD", "FLOW", "SEI", "GALA", "DYDX", "ENS", "CRV", "BEAM",
                    "PYTH", "JTO", "ORDI", "WLD", "AXS", "MANA", "SAND", "AGIX", "AAVE", "QNT",
                    "ALGO", "MINA", "KAS", "CHZ", "ZIL", "EOS", "IOTA", "KLAY", "LRC", "GMT",
                    "WOO", "TWT", "CAKE", "BAT", "HOT", "QTUM", "WAVES", "ONE", "SUSHI", "1INCH",
                    "ZRX", "ANKR", "MASK", "LPT", "BAND", "API3", "CELO", "ENJ", "RVN", "JASMY",
                    "IOST", "STORJ", "OMG", "ONT", "HBAR", "KAVA", "BTT", "VTHO", "GRT", "RSR"
                ]
                rank = len(top100) + 1
                for base in FALLBACK_TOP100:
                    binance_sym = base + "USDT"
                    if binance_sym not in existing_symbols and binance_sym in binance_map:
                        ticker_info = binance_map[binance_sym]
                        ticker_info["name"] = base
                        ticker_info["market_cap"] = 0
                        ticker_info["rank"] = 900 + rank
                        top100.append(ticker_info)
                        rank += 1
                        if len(top100) >= 100:
                            break
        except Exception as e:
            fallback_used = True
            print(f"  [Warning] CoinGecko API error: {e}. Sử dụng danh sách fallback.")

        if len(top100) < 50:
            top100 = []
            fallback_used = True
            FALLBACK_TOP100 = [
                "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "SHIB", "AVAX", "DOT",
                "LINK", "TRX", "NEAR", "MATIC", "LTC", "BCH", "UNI", "ICP", "APT", "FIL",
                "ATOM", "STX", "RNDR", "SUI", "FTM", "OP", "INJ", "IMX", "LDO", "THETA",
                "TIA", "VET", "MKR", "ETC", "RUNE", "PEPE", "WIF", "ARB", "JUP", "FLOKI",
                "BONK", "FET", "EGLD", "FLOW", "SEI", "GALA", "DYDX", "ENS", "CRV", "BEAM",
                "PYTH", "JTO", "ORDI", "WLD", "AXS", "MANA", "SAND", "AGIX", "AAVE", "QNT",
                "ALGO", "MINA", "KAS", "CHZ", "ZIL", "EOS", "IOTA", "KLAY", "LRC", "GMT",
                "WOO", "TWT", "CAKE", "BAT", "HOT", "QTUM", "WAVES", "ONE", "SUSHI", "1INCH",
                "ZRX", "ANKR", "MASK", "LPT", "BAND", "API3", "CELO", "ENJ", "RVN", "JASMY",
                "IOST", "STORJ", "OMG", "ONT", "HBAR", "KAVA", "BTT", "VTHO", "GRT", "RSR"
            ]
            rank = 1
            for base in FALLBACK_TOP100:
                binance_sym = base + "USDT"
                if binance_sym in binance_map:
                    ticker_info = binance_map[binance_sym]
                    ticker_info["name"] = base
                    ticker_info["market_cap"] = 0
                    ticker_info["rank"] = rank
                    top100.append(ticker_info)
                    rank += 1
                    if len(top100) >= 100:
                        break

        top100.sort(key=lambda x: x.get("rank", 999))
        self.json_ok({"coins": top100, "fallback": fallback_used})

    # ── /api/download (SSE) ───────────────────────────────────────────
    def api_download(self, params):
        """Stream-download dữ liệu Binance vào DB, trả về SSE events"""
        symbol   = params.get("symbol",   ["BTCUSDT"])[0].upper()
        interval = params.get("interval", ["4h"])[0]

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        def send_event(evt_type, data):
            try:
                line = f"data: {json.dumps({'type': evt_type, **data})}\n\n"
                self.wfile.write(line.encode())
                self.wfile.flush()
            except Exception:
                pass

        try:
            os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
            conn = sqlite3.connect(DB_PATH)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            init_db(conn)
            download_to_db(conn, symbol, interval, send_event)
            conn.close()
        except Exception as e:
            send_event("error", {"msg": str(e)})

    # ── Helpers ───────────────────────────────────────────────────────
    def json_ok(self, data):
        body = json.dumps(data, separators=(",",":")).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def json_error(self, code, msg):
        body = json.dumps({"error": msg}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if args and isinstance(args[0], str) and "/api/" in args[0]:
            now = datetime.now().strftime("%H:%M:%S")
            print(f"  [{now}] {args[0][:60]} → {args[1]}")

    # Accept both GET and POST for /api/clear
    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/clear":
            os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
            if not os.path.exists(DB_PATH):
                self.json_ok({"status":"ok","deleted":True,"remaining":0})
                return
            try:
                conn = sqlite3.connect(DB_PATH)
                conn.execute("PRAGMA journal_mode=WAL")
                self.api_clear(conn)
                conn.close()
            except Exception as e:
                self.json_error(500, str(e))
        else:
            self.send_response(405)
            self.end_headers()


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(os.path.join(STATIC, "db"), exist_ok=True)
    # Khởi tạo DB nếu chưa có
    if not os.path.exists(DB_PATH):
        conn = sqlite3.connect(DB_PATH)
        init_db(conn)
        conn.close()

    # Thông tin DB
    db_info = ""
    try:
        conn = sqlite3.connect(DB_PATH)
        count = conn.execute("SELECT COUNT(*) FROM klines").fetchone()[0]
        pairs = conn.execute("SELECT COUNT(*) FROM meta").fetchone()[0]
        size  = os.path.getsize(DB_PATH) / 1024 / 1024
        conn.close()
        db_info = f"  💾 DB: {count:,} nến · {pairs} dataset · {size:.1f} MB\n"
    except: pass

    server = ThreadingHTTPServer(("", PORT), Handler)

    print(f"""
╔══════════════════════════════════════════╗
║   EMA Strategy Server — port {PORT}      ║
╠══════════════════════════════════════════╣
║  http://localhost:{PORT}/                  ║
║  http://localhost:{PORT}/backtest.html    ║
╚══════════════════════════════════════════╝
{db_info}
  API:
    /api/klines?symbol=BTCUSDT&interval=4h
    /api/symbols        ← tất cả USDT pairs
    /api/download?symbol=BTCUSDT&interval=4h  ← auto-download
    /api/clear  (POST)  ← xóa toàn bộ dữ liệu DB
    /api/meta · /api/status
  [Threading] Mỗi request chạy trong thread riêng

  Ctrl+C để dừng
""")

    def handle_exit(sig, frame):
        print("\n\n  👋 Server đã dừng\n")
        sys.exit(0)

    signal.signal(signal.SIGINT,  handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)
    server.serve_forever()


if __name__ == "__main__":
    main()

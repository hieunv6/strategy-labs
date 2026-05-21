#!/usr/bin/env python3
"""
download.py — Tải dữ liệu OHLCV từ Binance và lưu vào SQLite
Chạy 1 lần để lấy toàn bộ lịch sử. Chạy lại để cập nhật nến mới.

Usage:
    python3 download.py                    # Tải mặc định
    python3 download.py --symbols BTC ETH  # Chỉ tải BTC, ETH
    python3 download.py --intervals 1h 4h  # Chỉ tải 1h và 4h
    python3 download.py --update           # Chỉ cập nhật nến mới
"""

import sqlite3, time, json, argparse, sys, os
from urllib.request import urlopen
from urllib.parse import urlencode
from datetime import datetime

# ── Cấu hình ──────────────────────────────────────────────────────────
DB_PATH   = os.path.join(os.path.dirname(__file__), "db", "market_data.db")

SYMBOLS   = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
             "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT"]

INTERVALS = ["4h", "1d"]           # Thêm "1h" nếu muốn, sẽ mất ~12s/symbol

# Binance inception dates (tránh request thời gian quá xa)
INCEPTION = {
    "BTCUSDT":  "2017-08-17",
    "ETHUSDT":  "2017-08-17",
    "BNBUSDT":  "2017-11-06",
    "XRPUSDT":  "2018-05-04",
    "ADAUSDT":  "2018-04-17",
    "SOLUSDT":  "2020-08-11",
    "DOGEUSDT": "2019-07-05",
    "AVAXUSDT": "2020-09-22",
    "DOTUSDT":  "2020-08-19",
    "MATICUSDT":"2019-04-26",
}

BATCH     = 1000   # Max candles per Binance request
DELAY     = 0.08   # 80ms between requests → ~750 req/min (limit 1200)
# ─────────────────────────────────────────────────────────────────────


def init_db(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS klines (
            symbol   TEXT    NOT NULL,
            interval TEXT    NOT NULL,
            time     INTEGER NOT NULL,
            open     REAL    NOT NULL,
            high     REAL    NOT NULL,
            low      REAL    NOT NULL,
            close    REAL    NOT NULL,
            volume   REAL    NOT NULL,
            PRIMARY KEY (symbol, interval, time)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sym_int_time ON klines(symbol, interval, time)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
            symbol   TEXT NOT NULL,
            interval TEXT NOT NULL,
            last_time INTEGER,
            count     INTEGER,
            updated_at TEXT,
            PRIMARY KEY (symbol, interval)
        )
    """)
    conn.commit()


def fetch_batch(symbol, interval, start_ms=None, end_ms=None):
    """Gọi Binance API lấy tối đa 1000 nến"""
    params = {"symbol": symbol, "interval": interval, "limit": BATCH}
    if start_ms: params["startTime"] = int(start_ms)
    if end_ms:   params["endTime"]   = int(end_ms)
    url = "https://api.binance.com/api/v3/klines?" + urlencode(params)
    try:
        with urlopen(url, timeout=15) as r:
            data = json.load(r)
        return [(int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]))
                for k in data]
    except Exception as e:
        print(f"\n  ⚠️  Lỗi fetch: {e}")
        return []


def get_last_time(conn, symbol, interval):
    row = conn.execute(
        "SELECT MAX(time) FROM klines WHERE symbol=? AND interval=?",
        (symbol, interval)
    ).fetchone()
    return row[0] if row and row[0] else None


def parse_inception(symbol):
    date_str = INCEPTION.get(symbol, "2017-01-01")
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return int(dt.timestamp() * 1000)


INTERVAL_MS = {
    "1m":60_000,"3m":180_000,"5m":300_000,"15m":900_000,"30m":1_800_000,
    "1h":3_600_000,"2h":7_200_000,"4h":14_400_000,"6h":21_600_000,
    "8h":28_800_000,"12h":43_200_000,"1d":86_400_000,"3d":259_200_000,"1w":604_800_000,
}


def download_symbol(conn, symbol, interval, update_only=False):
    now_ms = int(time.time() * 1000)
    last   = get_last_time(conn, symbol, interval)
    ims    = INTERVAL_MS.get(interval, 14_400_000)

    if last and (now_ms - last) < ims * 2:
        print(f"  ✅ {symbol} {interval}: đã mới ({ts_str(last)})")
        return 0

    start_ms = (last + 1) if last else parse_inception(symbol)
    if update_only and not last:
        print(f"  ⏭  {symbol} {interval}: chưa có dữ liệu, bỏ qua (dùng --full)")
        return 0

    total_ms  = now_ms - start_ms
    est_batch = max(1, total_ms // (ims * BATCH))
    mode      = "cập nhật" if last else "tải mới"
    print(f"  ⬇  {symbol} {interval}: {mode} từ {ts_str(start_ms)} "
          f"(ước tính ~{est_batch} batch)...")

    inserted = 0
    current  = start_ms
    batch_n  = 0

    while current < now_ms:
        rows = fetch_batch(symbol, interval, start_ms=current, end_ms=now_ms)
        if not rows:
            break

        # Bỏ nến cuối (đang mở)
        if rows[-1][0] + ims > now_ms:
            rows = rows[:-1]
        if not rows:
            break

        conn.executemany(
            "INSERT OR IGNORE INTO klines VALUES (?,?,?,?,?,?,?,?)",
            [(symbol, interval, t, o, h, l, c, v) for t,o,h,l,c,v in rows]
        )
        conn.commit()

        inserted += len(rows)
        current   = rows[-1][0] + 1
        batch_n  += 1

        pct  = min(99, int((current - start_ms) / max(1, now_ms - start_ms) * 100))
        bar  = "█" * (pct // 5) + "░" * (20 - pct // 5)
        print(f"\r    [{bar}] {pct:3d}%  {inserted:,} nến  batch {batch_n}", end="", flush=True)

        if len(rows) < BATCH:
            break
        time.sleep(DELAY)

    print(f"\r    ✅ Xong: +{inserted:,} nến mới lưu vào DB{' ' * 20}")

    # Cập nhật meta
    total_count = conn.execute(
        "SELECT COUNT(*) FROM klines WHERE symbol=? AND interval=?",
        (symbol, interval)
    ).fetchone()[0]
    conn.execute(
        "INSERT OR REPLACE INTO meta VALUES (?,?,?,?,?)",
        (symbol, interval, get_last_time(conn, symbol, interval),
         total_count, datetime.now().isoformat())
    )
    conn.commit()
    return inserted


def ts_str(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%d/%m/%Y") if ms else "—"


def print_summary(conn):
    print("\n📊 Tóm tắt dữ liệu trong DB:\n")
    rows = conn.execute("""
        SELECT symbol, interval, count, last_time, updated_at
        FROM meta ORDER BY symbol, interval
    """).fetchall()
    if not rows:
        print("  (Chưa có dữ liệu)")
        return
    print(f"  {'Symbol':<14} {'Interval':<10} {'Nến':>8}  {'Đến ngày':<14}  Cập nhật")
    print("  " + "─" * 70)
    total = 0
    for r in rows:
        sym, intv, cnt, lt, ua = r
        cnt  = cnt or 0
        ua   = ua[:16] if ua else "—"
        total += cnt
        print(f"  {sym:<14} {intv:<10} {cnt:>8,}  {ts_str(lt):<14}  {ua}")
    print("  " + "─" * 70)
    print(f"  {'TỔNG':<14} {'':<10} {total:>8,}")

    # Kích thước DB
    db_size = os.path.getsize(DB_PATH) / 1024 / 1024
    print(f"\n  💾 Kích thước DB: {db_size:.1f} MB\n")


def main():
    parser = argparse.ArgumentParser(description="Tải dữ liệu Binance vào SQLite")
    parser.add_argument("--symbols",   nargs="+", default=SYMBOLS,   metavar="SYM",  help="Danh sách symbol")
    parser.add_argument("--intervals", nargs="+", default=INTERVALS, metavar="INT",  help="Danh sách interval")
    parser.add_argument("--update",    action="store_true", help="Chỉ cập nhật nến mới")
    parser.add_argument("--summary",   action="store_true", help="Chỉ xem tóm tắt DB")
    args = parser.parse_args()

    # Tạo thư mục db nếu chưa có
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    init_db(conn)

    if args.summary:
        print_summary(conn)
        conn.close()
        return

    total_pairs = len(args.symbols) * len(args.intervals)
    print(f"\n🚀 Bắt đầu {'cập nhật' if args.update else 'tải'} "
          f"{len(args.symbols)} symbol × {len(args.intervals)} interval = {total_pairs} cặp\n")

    t0 = time.time()
    total_new = 0
    for sym in args.symbols:
        for intv in args.intervals:
            total_new += download_symbol(conn, sym, intv, update_only=args.update)

    elapsed = time.time() - t0
    print(f"\n✅ Hoàn tất trong {elapsed:.1f}s. Tổng +{total_new:,} nến mới\n")
    print_summary(conn)
    conn.close()


if __name__ == "__main__":
    main()

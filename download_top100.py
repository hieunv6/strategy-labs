#!/usr/bin/env python3
"""
download_top100.py — Tải dữ liệu lịch sử OHLCV cho Top 100 Coin (đã lọc Stablecoins)
ở khung thời gian H4 và Daily lưu vào SQLite.
"""

import sqlite3
import time
import json
import urllib.request
import os
import sys

# Import cấu hình và hàm từ download.py
from download import download_symbol, init_db, print_summary, DB_PATH

# Danh sách lọc stablecoins phổ biến
STABLECOINS = {"USDT", "USDC", "BUSD", "TUSD", "FDUSD", "USDP", "DAI", "EUR", "AEUR", "FDUSD", "USDE"}

def get_top100_symbols():
    try:
        url = "http://localhost:8765/api/top100"
        print(f"Fetching coin list from local server: {url}...")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            res = json.loads(r.read().decode())
        coins = res.get("coins", [])
        
        symbols = []
        for c in coins:
            base = c.get("base", "").upper()
            sym = c.get("symbol", "").upper()
            if base in STABLECOINS:
                print(f"  🚫 Bỏ qua stablecoin: {sym}")
                continue
            symbols.append(sym)
        return symbols
    except Exception as e:
        print(f"⚠️ Không thể lấy danh sách từ API: {e}. Sử dụng danh sách tĩnh mặc định.")
        # Fallback list if API fails
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
        return [f"{base}USDT" for base in FALLBACK_TOP100 if base not in STABLECOINS]

def main():
    symbols = get_top100_symbols()
    print(f"\n🚀 Bắt đầu tải dữ liệu cho {len(symbols)} đồng coin (đã lọc stablecoins) trên H4 và Daily...\n")
    
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    init_db(conn)
    
    intervals = ["4h", "1d"]
    total_pairs = len(symbols) * len(intervals)
    
    t0 = time.time()
    total_new = 0
    
    for i, sym in enumerate(symbols):
        print(f"\n[{i+1}/{len(symbols)}] ─────────── {sym} ───────────")
        for intv in intervals:
            try:
                total_new += download_symbol(conn, sym, intv, update_only=False)
            except Exception as e:
                print(f"  ❌ Lỗi khi tải {sym} {intv}: {e}")
                
    elapsed = time.time() - t0
    print(f"\n✅ Hoàn tất tải dữ liệu trong {elapsed/60:.1f} phút. Tổng cộng +{total_new:,} nến mới đã lưu.")
    print_summary(conn)
    conn.close()

if __name__ == "__main__":
    main()

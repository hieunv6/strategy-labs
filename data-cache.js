// ===================================================
// DATA CACHE — IndexedDB Engine
// Lưu OHLCV data vào local browser storage.
// Không cần fetch lại từ Binance API mỗi lần test.
// ===================================================

const DataCache = (() => {
  const DB_NAME    = 'ema-strategy-db';
  const DB_VERSION = 2;
  const STORE      = 'klines';
  let _db = null;

  // ----------------------------------------
  // INIT — mở IndexedDB
  // ----------------------------------------
  function init() {
    return new Promise((resolve, reject) => {
      if (_db) { resolve(_db); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ----------------------------------------
  // KEY
  // ----------------------------------------
  function makeKey(symbol, interval) {
    return `${symbol}_${interval}`;
  }

  // ----------------------------------------
  // GET — lấy dataset từ cache
  // Returns: { candles, updatedAt, symbol, interval } | null
  // ----------------------------------------
  async function get(symbol, interval) {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(makeKey(symbol, interval));
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ----------------------------------------
  // SAVE — ghi dataset vào cache
  // ----------------------------------------
  async function save(symbol, interval, candles) {
    const db = await init();
    const record = {
      id:        makeKey(symbol, interval),
      symbol, interval,
      candles,
      count:     candles.length,
      startTime: candles[0]?.time,
      endTime:   candles[candles.length - 1]?.time,
      updatedAt: Date.now(),
      sizeBytes: JSON.stringify(candles).length,
    };
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put(record);
      req.onsuccess = () => resolve(record);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ----------------------------------------
  // LIST — danh sách tất cả datasets
  // ----------------------------------------
  async function list() {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = e => {
        // Trả về metadata (không kèm candles để nhẹ)
        const items = (e.target.result || []).map(r => ({
          id: r.id, symbol: r.symbol, interval: r.interval,
          count: r.count, startTime: r.startTime, endTime: r.endTime,
          updatedAt: r.updatedAt, sizeBytes: r.sizeBytes,
        }));
        resolve(items);
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  // ----------------------------------------
  // DELETE — xoá 1 dataset
  // ----------------------------------------
  async function del(symbol, interval) {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).delete(makeKey(symbol, interval));
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ----------------------------------------
  // CLEAR — xoá toàn bộ
  // ----------------------------------------
  async function clear() {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ----------------------------------------
  // IS_FRESH — kiểm tra cache có cần cập nhật không
  // Dataset được coi là "fresh" nếu nến cuối < 2 interval cũ
  // ----------------------------------------
  const INTERVAL_MS = {
    '1m':60_000,'3m':180_000,'5m':300_000,'15m':900_000,'30m':1_800_000,
    '1h':3_600_000,'2h':7_200_000,'4h':14_400_000,'6h':21_600_000,
    '8h':28_800_000,'12h':43_200_000,'1d':86_400_000,'3d':259_200_000,
    '1w':604_800_000,
  };

  function isFresh(record, interval) {
    if (!record) return false;
    const ims   = INTERVAL_MS[interval] || 14_400_000;
    const now   = Date.now();
    const lastC = record.endTime || 0;
    // Fresh nếu nến mới nhất chưa đóng xong (chưa có thêm nến mới)
    return (now - lastC) < ims * 2;
  }

  // ----------------------------------------
  // UPDATE — chỉ fetch nến mới hơn endTime cache
  // và append vào record hiện có
  // ----------------------------------------
  async function update(symbol, interval, fetchFn, onProgress) {
    const record = await get(symbol, interval);
    if (!record || record.candles.length === 0) return null; // cần tải từ đầu

    const lastTime   = record.endTime;
    const newCandles = await fetchFn(symbol, interval, lastTime + 1, Date.now(), onProgress);

    if (newCandles.length <= 1) {
      // Không có nến mới (nến đang mở chưa đóng)
      return record;
    }

    // Bỏ nến đang mở (nến cuối chưa đóng)
    newCandles.pop();

    const merged = [...record.candles, ...newCandles];
    const updated = await save(symbol, interval, merged);
    return updated;
  }

  // ----------------------------------------
  // EXPORT
  // ----------------------------------------
  return { init, get, save, list, del, clear, isFresh, update, INTERVAL_MS };
})();

// 查 zai_studio 的使用者名冊(唯讀),用來把 email 換成帳號 id。
//
// 為什麼需要:imgame 的 session token 只帶 `u=<uid>`,它從來不知道使用者的 email
// (見 server/auth.js)。但「分享給某人共編」最自然的輸入就是 email,所以要有個對應。
// zai_studio 與 imgame 跑在同一台、本來就共用 AUTH_COOKIE_SECRET 與 LOGIN_URL,
// 再加一條唯讀的名冊查詢是同一類耦合;唯讀所以不可能弄壞主站的資料。
//
// ⚠ 刻意不用 better-sqlite3:那是原生模組,這台沒有 make/g++ 編不起來,
// 而為了一個查詢在正式機裝 build-essential 不值得。改用系統的 sqlite3 CLI。
//
// ⭐ 安全性:**使用者輸入永遠不進 SQL**。整個名冊只有幾十筆,所以一次把
// (id, email) 全撈出來、在 JS 裡比對 —— 從根本上沒有 SQL 注入面,
// 不必依賴「我有沒有把引號轉義乾淨」這種容易寫錯的防線。

const { execFile } = require('child_process');
const fs = require('fs');

const DB_PATH = process.env.ZAI_USERS_DB || '/root/zai_studio-main/data/index.db';
const SQLITE = process.env.SQLITE_BIN || '/usr/bin/sqlite3';
const CACHE_MS = 20_000;      // 名冊變動很慢;加一點快取避免每次讀清單都 spawn 一個行程
const TIMEOUT_MS = 5_000;

let cache = { at: 0, rows: null, error: null };

function loadRoster() {
  return new Promise((resolve) => {
    if (cache.rows && Date.now() - cache.at < CACHE_MS) return resolve(cache);
    if (!fs.existsSync(DB_PATH)) {
      cache = { at: Date.now(), rows: [], error: `找不到使用者資料庫(${DB_PATH})` };
      return resolve(cache);
    }
    if (!fs.existsSync(SQLITE)) {
      cache = { at: Date.now(), rows: [], error: `這台機器沒有 sqlite3(${SQLITE})` };
      return resolve(cache);
    }
    // 固定字串查詢,沒有任何參數拼接
    const SQL = 'SELECT id, email, display_name, handle FROM users;';
    execFile(SQLITE, ['-readonly', '-json', DB_PATH, SQL], { timeout: TIMEOUT_MS, maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err) {
        cache = { at: Date.now(), rows: cache.rows || [], error: `讀使用者資料庫失敗:${err.message}` };
        return resolve(cache);
      }
      let rows = [];
      try { rows = JSON.parse(stdout || '[]'); } catch (e) { /* 空表時 sqlite3 會輸出空字串 */ }
      cache = { at: Date.now(), rows: Array.isArray(rows) ? rows : [], error: null };
      resolve(cache);
    });
  });
}

const norm = (e) => String(e || '').trim().toLowerCase();

/** email → { userId, email, name } ;查不到回 null(可能是還沒註冊) */
async function findByEmail(email) {
  const want = norm(email);
  if (!want) return null;
  const { rows } = await loadRoster();
  const u = rows.find((r) => norm(r.email) === want);
  return u ? { userId: u.id, email: u.email, name: u.display_name || u.handle || null } : null;
}

/** userId → { userId, email, name };查不到回 null */
async function findById(userId) {
  if (!userId) return null;
  const { rows } = await loadRoster();
  const u = rows.find((r) => r.id === userId);
  return u ? { userId: u.id, email: u.email, name: u.display_name || u.handle || null } : null;
}

/** 名冊是否可用(給 UI 顯示「查不到名冊」而不是假裝 email 不存在) */
async function rosterStatus() {
  const { rows, error } = await loadRoster();
  return { ok: !error, count: rows.length, error: error || null, dbPath: DB_PATH };
}

const looksLikeEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

module.exports = { findByEmail, findById, rosterStatus, looksLikeEmail, normEmail: norm };

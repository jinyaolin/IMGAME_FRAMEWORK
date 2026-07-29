'use strict';

// ── zaistudio.tw 單一登入驗證 ──────────────────────────────────────
// 驗證主站(zai_studio-main,Next.js)簽發的 `zai_session` cookie。
// Token 格式與 zai_studio-main/lib/auth/token.ts 一致:
//   `u=<userId>;exp=<expiresAtMs>.<hmac-sha256-hex>`(HMAC 涵蓋整個 `u=...;exp=...` 前綴)
// 兩個服務共用同一把 AUTH_COOKIE_SECRET;cookie 由主站登入流程寫入(httpOnly, path=/)。
//
// 未設定 AUTH_COOKIE_SECRET 時(本機開發 npm run dev)驗證停用、全部放行,
// 讓開發不必先登入;正式環境(systemd imgame.service)會載入 .env 提供密鑰。

const crypto = require('crypto');

const SECRET = process.env.AUTH_COOKIE_SECRET || null;
const LOGIN_URL = process.env.LOGIN_URL || 'https://zaistudio.tw/studio/login';
const COOKIE_NAME = 'zai_session';

const enabled = !!SECRET;
if (!enabled) {
  console.warn('[Auth] AUTH_COOKIE_SECRET 未設定 — 登入檢查停用(開發模式,全部放行)');
}

function hmac(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex');
}

function timingEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

// 回傳 { userId, expiresAt } 或 null
function verifyToken(token) {
  if (!enabled || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingEqualHex(sig, hmac(payload))) return null;
  const m = payload.match(/^u=([^;]+);exp=(\d+)$/);
  if (!m) return null;
  const expiresAt = Number(m[2]);
  if (!m[1] || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;
  return { userId: m[1], expiresAt };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); }
    catch { out[key] = part.slice(i + 1).trim(); }
  }
  return out;
}

function userFromCookieHeader(header) {
  return verifyToken(parseCookies(header)[COOKIE_NAME]);
}

// 本機直連(無 X-Forwarded-For)視為內部呼叫,免登入 — AI playtest 用 loopback 建房/主持。
// 安全依據:Caddy 反代一定會加 X-Forwarded-For;外部直連 :3000 的請求來源 IP 不是 loopback。
function isLoopbackDirect(ip, headers) {
  const h = headers || {};
  if (h['x-forwarded-for'] || h['x-real-ip']) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// 頁面路由用:未登入 → 302 到主站登入頁(帶 next 回原網址)
function requireAuthPage(req, res, next) {
  if (!enabled) return next();
  if (isLoopbackDirect(req.ip, req.headers)) return next();
  if (userFromCookieHeader(req.headers.cookie)) return next();
  res.redirect(`${LOGIN_URL}?next=${encodeURIComponent(req.originalUrl)}`);
}

// API 用:未登入 → 401 JSON
function requireAuthAPI(req, res, next) {
  if (!enabled) return next();
  if (isLoopbackDirect(req.ip, req.headers)) return next();
  if (userFromCookieHeader(req.headers.cookie)) return next();
  res.status(401).json({ error: '需要登入', loginUrl: LOGIN_URL });
}

// 只擋「寫入」的方法,GET/HEAD 放行(玩家/顯示端不需登入)
function requireAuthForWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  return requireAuthAPI(req, res, next);
}

// Socket.IO 用:讀 handshake 的 cookie(同源連線會自動帶上)
function socketAuthOk(socket) {
  if (!enabled) return true;
  if (isLoopbackDirect(socket.handshake?.address, socket.handshake?.headers)) return true;
  return !!userFromCookieHeader(socket.handshake?.headers?.cookie);
}

// ── 使用者身分(房間擁有權用)─────────────────────────────────────
// 回傳 userId 字串;未登入回 null。loopback 內部呼叫與 dev(未設密鑰)一律視為 'local'。
function getUserIdFromReq(req) {
  if (!enabled) return 'local';
  if (isLoopbackDirect(req.ip, req.headers)) return 'local';
  return userFromCookieHeader(req.headers.cookie)?.userId || null;
}

function socketUserId(socket) {
  if (!enabled) return 'local';
  if (isLoopbackDirect(socket.handshake?.address, socket.handshake?.headers)) return 'local';
  return userFromCookieHeader(socket.handshake?.headers?.cookie)?.userId || null;
}

// ── Superuser(模組「開放」旗標的例外)──────────────────────────────
// SUPERUSERS env:逗號分隔 email(不分大小寫)。auth 關閉(本地開發)或 loopback 內部呼叫('local')
// 一律視為 superuser → 本地開發與 AI playtest 不受模組開放旗標影響。
const SUPERUSERS = (process.env.SUPERUSERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function isSuperUserId(uid) {
  if (!enabled) return true;
  if (uid === 'local') return true;
  return !!uid && SUPERUSERS.includes(String(uid).toLowerCase());
}
function reqIsSuper(req) { return isSuperUserId(getUserIdFromReq(req)); }
function socketIsSuper(socket) { return isSuperUserId(socketUserId(socket)); }

module.exports = { enabled, LOGIN_URL, requireAuthPage, requireAuthAPI, requireAuthForWrites, socketAuthOk, getUserIdFromReq, socketUserId, isSuperUserId, reqIsSuper, socketIsSuper };

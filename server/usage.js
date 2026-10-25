'use strict';

// 使用紀錄:誰、什麼時候、對哪個模組做了什麼。給老師看學生的使用率。
//
// 存法:data/usage/YYYY-MM.jsonl,一行一個事件 {t, ev, uid, mod?, ...}。只追加、不改寫。
// 事件種類見 EVENTS。存檔類事件同一人同一模組 30 秒內只記一次(編輯器連按儲存不灌爆)。
// 名字:imgame 只知道 uid,報表時從主站 zai_studio 的 SQLite 讀 handle(唯讀、只取 handle)。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = process.env.USAGE_DIR || path.join(__dirname, '..', 'data', 'usage');
const ZAI_DB = process.env.ZAI_DB_PATH || '/root/zai_studio-main/data/index.db';

const EVENTS = {
  editor_open: '開編輯器',
  module_create: '建立模組',
  module_clone: '複製模組',
  module_save: '儲存模組',
  engine_save: '儲存引擎碼',
  module_delete: '刪除模組',
  module_publish: '切換開放',
  asset_upload: '上傳素材',
  ai_chat: '問 AI 助手',
  ai_save: 'AI 存檔',
  room_create: '開房',
  game_start: '開始遊戲',
};

const COALESCE_MS = 30_000;
const COALESCE = new Set(['module_save', 'engine_save', 'ai_save', 'editor_open']);
const lastSeen = new Map(); // `${ev}|${uid}|${mod}` → ms

try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

function fileFor(d) {
  return path.join(DIR, `${d.toISOString().slice(0, 7)}.jsonl`);
}

/** 記一筆。不會丟例外(紀錄壞掉不能影響遊戲)。 */
function log(ev, uid, extra = {}) {
  try {
    if (!EVENTS[ev]) return;
    if (uid === 'local') return; // 本機迴圈請求 = AI playtest 機器人,不算人
    const now = Date.now();
    const mod = extra.mod || '';
    if (COALESCE.has(ev)) {
      const k = `${ev}|${uid || ''}|${mod}`;
      if (now - (lastSeen.get(k) || 0) < COALESCE_MS) return;
      lastSeen.set(k, now);
      if (lastSeen.size > 5000) lastSeen.clear();
    }
    const d = new Date(now);
    const row = { t: d.toISOString(), ev, uid: uid || null, ...extra };
    fs.appendFile(fileFor(d), JSON.stringify(row) + '\n', () => {});
  } catch {}
}

// ── HTTP:回應成功(2xx)後依路由記事件 ─────────────────────────────
// 用 res.on('finish') 統一掛,不必改每個 handler;失敗的請求不記。
function middleware(base, getUid, modulesDir) {
  const p = (s) => new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + s + '$');
  const R = {
    editor: p('/editor/?(index\\.html)?'),
    manifest: p('/api/modules/([^/]+)/manifest'),
    engine: p('/api/modules/([^/]+)/server'),
    clone: p('/api/modules/([^/]+)/clone'),
    publish: p('/api/modules/([^/]+)/publish'),
    del: p('/api/modules/([^/]+)'),
    rooms: p('/api/rooms'),
    assets: p('/api/assets'),
  };
  return (req, res, next) => {
    const url = req.path;
    const m = req.method;
    let hit = null;
    let x;
    if (m === 'GET' && R.editor.test(url)) hit = () => ['editor_open', {}];
    else if (m === 'PUT' && (x = url.match(R.manifest))) {
      const mod = decodeURIComponent(x[1]);
      // 新舊要在 handler 寫檔「之前」判斷
      const isNew = !fs.existsSync(path.join(modulesDir, mod, 'manifest.json'));
      hit = () => [isNew ? 'module_create' : 'module_save', { mod }];
    } else if (m === 'POST' && (x = url.match(R.engine))) hit = () => ['engine_save', { mod: decodeURIComponent(x[1]) }];
    else if (m === 'POST' && (x = url.match(R.clone))) hit = () => ['module_clone', { mod: String(req.body?.newId || ''), from: decodeURIComponent(x[1]) }];
    else if (m === 'POST' && (x = url.match(R.publish))) hit = () => ['module_publish', { mod: decodeURIComponent(x[1]) }];
    else if (m === 'DELETE' && (x = url.match(R.del))) hit = () => ['module_delete', { mod: decodeURIComponent(x[1]) }];
    else if (m === 'POST' && R.rooms.test(url)) hit = () => ['room_create', req.body?.moduleId ? { mod: String(req.body.moduleId) } : {}];
    else if (m === 'POST' && R.assets.test(url)) hit = () => ['asset_upload', { n: Array.isArray(req.files) ? req.files.length : undefined }];
    if (hit) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const [ev, extra] = hit();
          log(ev, getUid(req), extra);
        }
      });
    }
    next();
  };
}

// ── 報表 ────────────────────────────────────────────────────────
function readRange(days) {
  const since = Date.now() - days * 86400_000;
  const rows = [];
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort(); } catch {}
  const firstMonth = new Date(since).toISOString().slice(0, 7);
  for (const f of files) {
    if (f.slice(0, 7) < firstMonth) continue;
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (Date.parse(r.t) >= since) rows.push(r);
      } catch {}
    }
  }
  return rows;
}

let nameCache = { at: 0, map: {} };
function handles(uids) {
  const want = uids.filter((u) => u && u.startsWith('u_'));
  if (Date.now() - nameCache.at > 60_000) nameCache = { at: Date.now(), map: {} };
  const missing = want.filter((u) => !(u in nameCache.map));
  if (missing.length && fs.existsSync(ZAI_DB)) {
    try {
      const py = 'import sqlite3,sys,json\n' +
        'db=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)\n' +
        'ids=json.loads(sys.argv[2])\n' +
        'q="select id,coalesce(display_name,handle) from users where id in (%s)"%",".join("?"*len(ids))\n' +
        'print(json.dumps(dict(db.execute(q,ids).fetchall())))';
      const out = execFileSync('python3', ['-c', py, ZAI_DB, JSON.stringify(missing)], { timeout: 5000 }).toString();
      Object.assign(nameCache.map, JSON.parse(out));
    } catch {}
    for (const u of missing) if (!(u in nameCache.map)) nameCache.map[u] = null;
  }
  return Object.fromEntries(want.map((u) => [u, nameCache.map[u] || null]));
}

const tpeDay = (iso) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);

function summary(days = 30) {
  const rows = readRange(days);
  const users = new Map();
  const mods = new Map();
  const byDay = new Map();
  for (const r of rows) {
    const day = tpeDay(r.t);
    const u = r.uid || '(未登入)';
    if (!users.has(u)) users.set(u, { uid: u, counts: {}, modules: new Set(), days: new Set(), first: r.t, last: r.t });
    const U = users.get(u);
    U.counts[r.ev] = (U.counts[r.ev] || 0) + 1;
    if (r.mod) U.modules.add(r.mod);
    U.days.add(day);
    U.last = r.t;
    if (r.mod) {
      if (!mods.has(r.mod)) mods.set(r.mod, { mod: r.mod, counts: {}, users: new Set(), last: r.t });
      const M = mods.get(r.mod);
      M.counts[r.ev] = (M.counts[r.ev] || 0) + 1;
      if (r.uid) M.users.add(r.uid);
      M.last = r.t;
    }
    if (!byDay.has(day)) byDay.set(day, { day, users: new Set(), events: 0, counts: {} });
    const D = byDay.get(day);
    if (r.uid) D.users.add(r.uid);
    D.events++;
    D.counts[r.ev] = (D.counts[r.ev] || 0) + 1;
  }
  const names = handles([...users.keys(), ...[...mods.values()].flatMap((m) => [...m.users])]);
  return {
    days,
    since: new Date(Date.now() - days * 86400_000).toISOString(),
    total: rows.length,
    events: EVENTS,
    users: [...users.values()]
      .map((U) => ({ uid: U.uid, name: names[U.uid] || null, counts: U.counts, modules: [...U.modules], activeDays: U.days.size, first: U.first, last: U.last }))
      .sort((a, b) => b.last.localeCompare(a.last)),
    modules: [...mods.values()]
      .map((M) => ({ mod: M.mod, counts: M.counts, users: [...M.users].map((u) => ({ uid: u, name: names[u] || null })), last: M.last }))
      .sort((a, b) => b.last.localeCompare(a.last)),
    byDay: [...byDay.values()]
      .map((D) => ({ day: D.day, activeUsers: D.users.size, events: D.events, counts: D.counts }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    recent: rows.slice(-150).reverse().map((r) => ({ ...r, name: names[r.uid] || null })),
  };
}

module.exports = { log, middleware, summary, EVENTS, DIR };

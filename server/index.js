'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const GameSession = require('./core/GameSession');
const ModuleLoader = require('./core/ModuleLoader');

const app = express();
const server = http.createServer(app);

// ── 子路徑部署（zaistudio.tw/labs/game）────────────────────────────
// BASE_PATH：所有路由/靜態檔/socket.io 掛在此前綴下；本機開發留空（掛根路徑）。
// PUBLIC_ORIGIN：QR code 與分享連結使用的對外網域（https），未設則依請求 Host 推測。
const BASE = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '') || null;
const auth = require('./auth');

const io = new Server(server, {
  path: BASE + '/socket.io',
  cors: { origin: '*' },
  maxHttpBufferSize: 8e6,   // 允許 AI 聊天貼圖（base64 縮圖，預設 1MB 不夠）
});

const PORT        = process.env.PORT || 3000;
const PUBLIC_HOST = process.env.HOST || null;  // e.g. HOST=192.168.1.100
const sessions = new Map();       // roomId → GameSession

// DeckManager (global deck library) and ModuleLoader (game modules) — initialised by startServer()
const DeckManager = require('./core/DeckManager');
const deckManager = new DeckManager(path.join(__dirname, 'decks'));
const { ActionsAPI, createRouter: createActionsRouter } = require('./api/actions');
const actionsAPI = new ActionsAPI(path.join(__dirname, 'actions'));
let moduleLoader;

async function initializeServer() {
  await deckManager.initialize().catch(err => {
    console.error('[Server] Failed to initialize DeckManager:', err);
  });
  moduleLoader = new ModuleLoader(path.join(__dirname, 'modules'), deckManager);
  console.log('[Server] DeckManager and ModuleLoader initialized');
}

// ── Static files ─────────────────────────────────────────────────
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));

// 合併式主持頁（host+display 合一）— zaistudio.tw/labs/game 的入口，需登入
app.get(BASE + '/', auth.requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/labs/index.html'));
});

// 玩家/顯示端免登入；host / editor / decks / actions 等管理頁需登入
app.use(BASE + '/mobile',  express.static(path.join(__dirname, '../client/mobile')));
app.use(BASE + '/display', express.static(path.join(__dirname, '../client/display')));
app.use(BASE + '/host',    auth.requireAuthPage, express.static(path.join(__dirname, '../client/host')));
app.use(BASE + '/editor',  auth.requireAuthPage, express.static(path.join(__dirname, '../client/editor')));
app.use(BASE + '/reports', auth.requireAuthPage, express.static(path.join(__dirname, '../docs/reports')));
app.use(BASE + '/decks',   auth.requireAuthPage, express.static(path.join(__dirname, '../client/decks')));
app.use(BASE + '/actions', auth.requireAuthPage, express.static(path.join(__dirname, '../client/actions')));
app.use(BASE + '/shared',  express.static(path.join(__dirname, '../client/shared')));
// Phase 2:把核心引擎(3 個 class)以純文字供 host 瀏覽器載入,讓 GameSession 在 host 端當 server 跑。
// 白名單、非機密(就是遊戲狀態機邏輯);瀏覽器用 engine-loader.js 的 micro-CommonJS 執行。
const ENGINE_WHITELIST = new Set(['PlayerManager.js', 'BaseModule.js', 'GameSession.js', 'NetKitHost.js']);
app.get(BASE + '/engine/:file', (req, res) => {
  if (!ENGINE_WHITELIST.has(req.params.file)) return res.status(404).end();
  res.type('application/javascript').sendFile(path.join(__dirname, 'core', req.params.file));
});
app.use(BASE + '/uploads', express.static(path.join(__dirname, '../public/uploads')));
// 相容:模組 gameCode / 牌面 HTML 內寫死的 /uploads 根路徑(Caddy 也會把 /uploads/* 導過來)
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// ── Decks API ───────────────────────────────────────────────────────
const { router: decksRouter } = require('./api/decks');
// Attach deckManager to app for API access
app.deckManager = deckManager;
// Attach deckManager to request for API routes（寫入需登入,讀取開放）
app.use(BASE + '/api/decks', auth.requireAuthForWrites, (req, res, next) => {
  req.deckManager = deckManager;
  next();
}, decksRouter);

// ── Actions API ─────────────────────────────────────────────────────
const actionsRouter = createActionsRouter(actionsAPI);
app.use(BASE + '/api/actions', auth.requireAuthForWrites, (req, res, next) => {
  req.actionsAPI = actionsAPI;
  next();
}, actionsRouter);

// 模組/素材 API：寫入（POST/PUT/DELETE）需登入；讀取開放給顯示端與玩家
app.use(BASE + '/api/modules', auth.requireAuthForWrites);
app.use(BASE + '/api/assets', auth.requireAuthForWrites);

// ── HTTP API ──────────────────────────────────────────────────────

// Create a new room (called by host) — 需登入;房間歸開房者所有,只有本人能主持
app.post(BASE + '/api/rooms', auth.requireAuthAPI, (req, res) => {
  const { moduleId } = req.body || {};
  const roomId = generateRoomCode();
  const session = new GameSession(roomId, io);   // Phase 0:io 即 transport(socket.io 原生符合 to(id).emit 契約);Phase 2 P2P 房會改餵 P2PRouter
  session.ownerUserId = auth.getUserIdFromReq(req);

  if (moduleId) {
    const manifest = moduleLoader.getManifest(moduleId);
    if (!manifest) return res.status(400).json({ error: `Module "${moduleId}" not found` });
    // Fork: deep-clone manifest so this session is isolated from future editor saves
    session.manifest = JSON.parse(JSON.stringify(manifest));
    session.moduleName = moduleId;
    // Snapshot server.js source at room creation so edits don't affect this session
    session.engineCode = moduleLoader.readEngineCode(moduleId);
  }

  sessions.set(roomId, session);
  console.log(`[Room] Created: ${roomId}${moduleId ? ` (module: ${moduleId})` : ''}`);
  res.json({ roomId, manifest: session.manifest });
});

// List my active rooms — 需登入;每個人只看得到自己開的房
app.get(BASE + '/api/rooms', auth.requireAuthAPI, (req, res) => {
  const uid = auth.getUserIdFromReq(req);
  const rooms = Array.from(sessions.values())
    .filter(s => !s.ownerUserId || s.ownerUserId === uid)
    .map(session => session.toSummary());
  res.json(rooms);
});

// Room info（玩家/顯示端免登入 — 用房代碼當能力憑證）
app.get(BASE + '/api/rooms/:roomId', (req, res) => {
  const session = sessions.get(req.params.roomId.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Room not found' });
  res.json(session.toSummary());
});

// Available modules (summary list)
app.get(BASE + '/api/modules', (req, res) => {
  res.json(moduleLoader.listModules());
});

// ── 動作手勢庫(Gesture Lab 產出;遊戲端可全量載入當內建動作)──
const gestureStore = require('./gestures');
app.get(BASE + '/api/gestures', (req, res) => res.json(gestureStore.list()));
app.post(BASE + '/api/gestures', auth.requireAuthAPI, (req, res) => {
  const v = gestureStore.save(req.body);
  if (!v.ok) return res.status(400).json({ error: v.errors.join(';') });
  res.json({ ok: true, warnings: v.warnings || [] });
});
app.delete(BASE + '/api/gestures/:name', auth.requireAuthAPI, (req, res) => {
  res.json({ ok: gestureStore.remove(req.params.name) });
});

// P2P 的 ICE 設定:STUN 一律有;TURN 只在 env 有設時加(憑證留伺服器、不進 client 原始碼庫)。
// env:STUN_URLS(逗號分隔,可覆蓋預設)、TURN_URLS(逗號分隔)、TURN_USERNAME、TURN_CREDENTIAL。
// 沒設 TURN → 只回 STUN(等同現況,零 regression)。無 isolation 場地走直連;酒店等隔離場地才用得到 TURN。
function buildIceServers() {
  const ice = [];
  const stun = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const u of stun) ice.push({ urls: u });
  const turnUrls = (process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (turnUrls.length) {
    if (process.env.TURN_SECRET) {
      // coturn REST API(use-auth-secret):username=到期時間戳,credential=HMAC-SHA1(secret,username) base64。
      // 短效(預設 12h)→ 公開的 /api/ice 不會外洩「永久」open relay,防止中繼被盜用。
      const ttl = parseInt(process.env.TURN_TTL || '43200', 10);
      const username = String(Math.floor(Date.now() / 1000) + ttl) + ':imgame';
      const credential = require('crypto').createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
      ice.push({ urls: turnUrls, username, credential });
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      ice.push({ urls: turnUrls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    }
  }
  return ice;
}
// Cloudflare Realtime TURN(全球 anycast,就近節點;免費 1TB/月)。設了 CF_TURN_KEY_ID + CF_TURN_API_TOKEN
// 就優先用它,伺服器代取 iceServers(含 TURN over TLS 443)。憑證 24h 有效 → 快取 20 分鐘,不每次打 CF。
let _cfIce = null, _cfIceAt = 0;
async function cloudflareIce() {
  const now = Date.now();
  if (_cfIce && (now - _cfIceAt) < 20 * 60 * 1000) return _cfIce;
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.CF_TURN_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 }),
  });
  if (!r.ok) throw new Error('Cloudflare TURN ' + r.status);
  const d = await r.json();
  if (!d.iceServers || !d.iceServers.length) throw new Error('Cloudflare TURN 回應無 iceServers');
  _cfIce = d.iceServers; _cfIceAt = now; return _cfIce;
}
app.get(BASE + '/api/ice', async (req, res) => {
  res.set('Cache-Control', 'no-store');   // TURN 憑證會輪替 → 不快取
  if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) {
    try { return res.json({ iceServers: await cloudflareIce() }); }
    catch (e) { console.warn('[ice] Cloudflare TURN 取用失敗,退回本機 coturn/STUN:', e && e.message); }
  }
  res.json({ iceServers: buildIceServers() });   // 退回:本機 coturn(有 env)或純 STUN
});

// ── 素材庫（圖片/音效，供遊戲程式引用；Kimi 可整理成多層目錄）────
const multer = require('multer');
const ASSETS_ROOT = path.join(__dirname, '../public/uploads/assets');
fs.mkdirSync(ASSETS_ROOT, { recursive: true });

// 安全的素材相對路徑（允許多層目錄與中文檔名，擋 .. 與絕對路徑）
function safeAssetPath(rel) {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return null;
  if (!/^[\w\-./一-鿿（）()]+$/.test(clean)) return null;
  return path.join(ASSETS_ROOT, clean);
}

function listAssetsRecursive(dir = ASSETS_ROOT, out = []) {
  if (!fs.existsSync(dir) || out.length >= 300) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listAssetsRecursive(full, out);
    else if (out.length < 300) {
      const rel = path.relative(ASSETS_ROOT, full).replace(/\\/g, '/');
      out.push({ path: rel, url: '/uploads/assets/' + rel, sizeKB: Math.round(fs.statSync(full).size / 1024) });
    }
  }
  return out;
}

const assetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
app.post(BASE + '/api/assets', assetUpload.array('files', 6), (req, res) => {
  const dir = String(req.body?.dir || '').trim();
  const saved = [];
  for (const f of req.files || []) {
    if (!/^(image|audio)\//.test(f.mimetype)) continue;
    const base = (f.originalname || 'file').replace(/[^\w\-.一-鿿（）()]/g, '_');
    let target = safeAssetPath((dir ? dir + '/' : '') + base);
    if (!target) continue;
    if (fs.existsSync(target)) target = safeAssetPath((dir ? dir + '/' : '') + Date.now().toString(36) + '-' + base);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.buffer);
    const rel = path.relative(ASSETS_ROOT, target).replace(/\\/g, '/');
    saved.push({ path: rel, url: '/uploads/assets/' + rel, sizeKB: Math.round(f.size / 1024), type: f.mimetype });
    console.log(`[Assets] Uploaded: ${rel} (${Math.round(f.size / 1024)}KB)`);
  }
  res.json({ files: saved });
});
app.get(BASE + '/api/assets', (req, res) => res.json(listAssetsRecursive()));

// Kimi 的模組長期筆記（KIMI.md）
app.get(BASE + '/api/modules/:id/notes', (req, res) => {
  const id = req.params.id;
  if (!isValidModuleId(id)) return res.status(400).json({ error: '模組 ID 格式錯誤' });
  const p = path.join(__dirname, 'modules', id, 'KIMI.md');
  if (!fs.existsSync(p)) return res.status(404).json({ error: '尚無筆記' });
  res.type('text/plain').send(fs.readFileSync(p, 'utf8'));
});

// 遊戲執行 log 讀取(debug):GET → 最近 N 筆(GameAPI.log / 自動錯誤回報聚合);?clear=1 清空
app.get(BASE + '/api/modules/:id/gamelogs', (req, res) => {
  const gl = require('./ai/gamelogs');
  if (req.query.clear) { gl.clearLogs(req.params.id); return res.json({ cleared: true }); }
  res.json(gl.getLogs(req.params.id, Number(req.query.limit) || 200));
});

// Get module's server.js content（引擎原始碼 — 需登入）
app.get(BASE + '/api/modules/:id/server', auth.requireAuthAPI, (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidModuleId(id)) return res.status(400).json({ error: '模組 ID 格式錯誤' });

    const serverJsPath = path.join(__dirname, 'modules', id, 'server.js');
    if (!fs.existsSync(serverJsPath)) {
      return res.status(404).json({ error: 'server.js 不存在' });
    }

    const code = fs.readFileSync(serverJsPath, 'utf-8');
    res.type('text/plain').send(code);
  } catch (err) {
    console.error('[Module] Failed to load server.js:', err);
    res.status(500).json({ error: err.message });
  }
});

// Save or update module's server.js
app.post(BASE + '/api/modules/:id/server', (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidModuleId(id)) return res.status(400).json({ error: '模組 ID 格式錯誤' });
    // No in-use lock: sessions hold forked snapshots so disk edits are safe

    const moduleDir = path.join(__dirname, 'modules', id);
    const serverJsPath = path.join(moduleDir, 'server.js');

    // Validate server.js content
    const code = req.body;
    try {
      // Syntax check using acorn or simple parsing
      // For Node.js modules, we'll check for balanced braces and basic structure
      // instead of using new Function() which doesn't understand require/module.exports

      if (code.trim()) {
        // Check for balanced braces
        let openBraces = 0;
        let openBrackets = 0;
        let openParens = 0;
        let inString = false;
        let inComment = false;
        let escapeNext = false;

        for (let i = 0; i < code.length; i++) {
          const char = code[i];
          const prevChar = i > 0 ? code[i - 1] : '';

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\' && inString) {
            escapeNext = true;
            continue;
          }

          // Handle comments
          if (!inString && !inComment) {
            if (char === '/' && prevChar === '/') {
              inComment = 'line';
              continue;
            }
            if (char === '*' && prevChar === '/') {
              inComment = 'block';
              continue;
            }
          }

          if (inComment === 'line' && char === '\n') {
            inComment = false;
            continue;
          }
          if (inComment === 'block' && char === '/' && prevChar === '*') {
            inComment = false;
            continue;
          }

          if (inComment) continue;

          // Handle strings
          if (char === '"' || char === '\'' || char === '`') {
            inString = !inString;
            continue;
          }

          if (inString) continue;

          // Count brackets
          if (char === '{') openBraces++;
          if (char === '}') openBraces--;
          if (char === '[') openBrackets++;
          if (char === ']') openBrackets--;
          if (char === '(') openParens++;
          if (char === ')') openParens--;
        }

        if (openBraces !== 0) {
          return res.status(400).json({ error: `語法錯誤：大括號不平衡 (open: ${openBraces})` });
        }
        if (openBrackets !== 0) {
          return res.status(400).json({ error: `語法錯誤：中括號不平衡 (open: ${openBrackets})` });
        }
        if (openParens !== 0) {
          return res.status(400).json({ error: `語法錯誤：圓括號不平衡 (open: ${openParens})` });
        }

        // Check for BaseModule inheritance
        if (!code.includes('BaseModule')) {
          return res.status(400).json({ error: 'server.js 必須繼承 BaseModule' });
        }

        // Check for module.exports
        if (!code.includes('module.exports')) {
          return res.status(400).json({ error: 'server.js 必須導出模組類' });
        }
      }
    } catch (e) {
      return res.status(400).json({ error: `驗證失敗：${e.message}` });
    }

    // Write server.js
    fs.writeFileSync(serverJsPath, code, 'utf-8');

    console.log(`[Module] Saved server.js: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[Module] Failed to save server.js:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete module's server.js
app.delete(BASE + '/api/modules/:id/server', (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidModuleId(id)) return res.status(400).json({ error: '模組 ID 格式錯誤' });
    // No in-use lock: sessions hold forked snapshots so deleting server.js won't affect them

    const serverJsPath = path.join(__dirname, 'modules', id, 'server.js');
    if (!fs.existsSync(serverJsPath)) {
      return res.status(404).json({ error: 'server.js 不存在' });
    }

    fs.unlinkSync(serverJsPath);

    console.log(`[Module] Deleted server.js: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[Module] Failed to delete server.js:', err);
    res.status(500).json({ error: err.message });
  }
});

// Full manifest for one module (for editor to load)
app.get(BASE + '/api/modules/:id', (req, res) => {
  const id = req.params.id;
  const manifestPath = path.join(__dirname, 'modules', id, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: '模組不存在' });
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: 'manifest 解析失敗：' + err.message });
  }
});

// Helper: validate module id (filesystem-safe)
function isValidModuleId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(id);
}

// Helper: check if any active session is currently using this module
function moduleInUse(id) {
  for (const session of sessions.values()) {
    if (session.moduleName === id) return true;
  }
  return false;
}

// Validate a manifest object. Returns array of error objects: { path, msg }.
function validateManifest(m) {
  const errors = [];
  const push = (path, msg) => errors.push({ path, msg });

  if (!m || typeof m !== 'object') { push('', 'manifest 不是物件'); return errors; }
  if (!m.name || typeof m.name !== 'string' || !m.name.trim()) push('name', '顯示名稱不可空白');
  const minP = Number(m.minPlayers), maxP = Number(m.maxPlayers);
  if (!Number.isFinite(minP) || minP < 1 || minP > 50) push('minPlayers', '最少人數需在 1–50 之間');
  if (!Number.isFinite(maxP) || maxP < 1 || maxP > 50) push('maxPlayers', '最多人數需在 1–50 之間');
  if (Number.isFinite(minP) && Number.isFinite(maxP) && minP > maxP) push('maxPlayers', '最多人數不可小於最少人數');

  // fieldConfig
  if (m.fieldConfig && typeof m.fieldConfig === 'object') {
    Object.entries(m.fieldConfig).forEach(([k, def]) => {
      if (!def || typeof def !== 'object') { push(`fieldConfig.${k}`, '欄位定義錯誤'); return; }
      if (!def.label) push(`fieldConfig.${k}.label`, '欄位需要 label');
      if (!['number','select'].includes(def.type)) push(`fieldConfig.${k}.type`, 'type 只支援 number 或 select');
      if (def.type === 'select' && (!Array.isArray(def.options) || !def.options.length))
        push(`fieldConfig.${k}.options`, 'select 類型需至少一個選項');
    });
  }

  // 🆕 globalParams 驗證
  if (m.globalParams && Array.isArray(m.globalParams)) {
    const paramIds = new Set();
    m.globalParams.forEach((p, i) => {
      if (!p.id) push(`globalParams[${i}].id`, '全局參數需要 id');
      else if (paramIds.has(p.id)) push(`globalParams[${i}].id`, `參數 id 重複：${p.id}`);
      else paramIds.add(p.id);

      if (!p.label) push(`globalParams[${i}].label`, '全局參數需要 label');
      if (!p.type) push(`globalParams[${i}].type`, '全局參數需要 type');

      // 驗證 type
      const validTypes = ['number', 'string', 'boolean', 'player', 'card', 'array'];
      if (p.type && !validTypes.includes(p.type)) {
        push(`globalParams[${i}].type`, `type 必須是 ${validTypes.join(', ')}`);
      }

      // number 類型驗證
      if (p.type === 'number') {
        if (p.subType && !['integer', 'float'].includes(p.subType)) {
          push(`globalParams[${i}].subType`, 'subType 必須是 integer 或 float');
        }
        if (p.min !== undefined && typeof p.min !== 'number') {
          push(`globalParams[${i}].min`, 'min 必須是數字');
        }
        if (p.max !== undefined && typeof p.max !== 'number') {
          push(`globalParams[${i}].max`, 'max 必須是數字');
        }
        if (p.min !== undefined && p.max !== undefined && p.min > p.max) {
          push(`globalParams[${i}].min`, 'min 不可大於 max');
        }
      }

      // array 類型驗證
      if (p.type === 'array' && !p.itemType) {
        push(`globalParams[${i}].itemType`, 'array 類型需要 itemType');
      }
    });
  }

  // 🆕 playerAttributes 擴展驗證（支援新類型）
  if (m.playerAttributes && Array.isArray(m.playerAttributes)) {
    const attrIds = new Set();
    m.playerAttributes.forEach((attr, i) => {
      if (!attr.id) push(`playerAttributes[${i}].id`, '玩家屬性需要 id');
      else if (attrIds.has(attr.id)) push(`playerAttributes[${i}].id`, `屬性 id 重複：${attr.id}`);
      else attrIds.add(attr.id);

      if (!attr.label) push(`playerAttributes[${i}].label`, '玩家屬性需要 label');
      if (!attr.type) push(`playerAttributes[${i}].type`, '玩家屬性需要 type');

      // 驗證 type（擴展支援）
      const validTypes = ['select', 'number', 'string', 'boolean', 'player', 'card', 'array'];
      if (attr.type && !validTypes.includes(attr.type)) {
        push(`playerAttributes[${i}].type`, `type 必須是 ${validTypes.join(', ')}`);
      }

      // select 類型需要 options
      if (attr.type === 'select' && (!Array.isArray(attr.options) || !attr.options.length)) {
        push(`playerAttributes[${i}].options`, 'select 類型需至少一個選項');
      }

      // number 類型驗證
      if (attr.type === 'number') {
        if (attr.subType && !['integer', 'float'].includes(attr.subType)) {
          push(`playerAttributes[${i}].subType`, 'subType 必須是 integer 或 float');
        }
        if (attr.min !== undefined && typeof attr.min !== 'number') {
          push(`playerAttributes[${i}].min`, 'min 必須是數字');
        }
        if (attr.max !== undefined && typeof attr.max !== 'number') {
          push(`playerAttributes[${i}].max`, 'max 必須是數字');
        }
        if (attr.min !== undefined && attr.max !== undefined && attr.min > attr.max) {
          push(`playerAttributes[${i}].min`, 'min 不可大於 max');
        }
      }

      // array 類型驗證
      if (attr.type === 'array' && !attr.itemType) {
        push(`playerAttributes[${i}].itemType`, 'array 類型需要 itemType');
      }
    });
  }

  // Decks
  const deckIds = new Set();
  if (Array.isArray(m.decks)) {
    m.decks.forEach((d, di) => {
      if (!d.id) push(`decks[${di}].id`, '牌組需要 id');
      else if (deckIds.has(d.id)) push(`decks[${di}].id`, `牌組 id 重複：${d.id}`);
      else deckIds.add(d.id);
      if (!d.name) push(`decks[${di}].name`, '牌組需要名稱');

      // For global deck references, skip cards validation (will be loaded from global deck)
      if (d.ref) {
        // Global deck reference - cards will be loaded at runtime
        return;
      }

      if (!Array.isArray(d.cards)) push(`decks[${di}].cards`, '牌組必須有 cards 陣列');
      else if (d.enabled !== false && d.cards.length === 0)
        push(`decks[${di}].cards`, `啟用中的牌組「${d.name}」不可為空（會發不出牌）`);
      const cardIds = new Set();
      (d.cards || []).forEach((c, ci) => {
        if (!c.name || !String(c.name).trim()) push(`decks[${di}].cards[${ci}].name`, '卡牌名稱不可空白');
        if (c.id) {
          if (cardIds.has(c.id)) push(`decks[${di}].cards[${ci}].id`, `卡牌 id 重複：${c.id}`);
          else cardIds.add(c.id);
        }
      });
    });
  }

  // Stages
  if (Array.isArray(m.stages)) {
    const enabledCount = m.stages.filter(s => s.enabled).length;
    if (enabledCount === 0) push('stages', '至少需有一個啟用的階段');
    const enabledDeckIds = new Set((m.decks || []).filter(d => d.enabled !== false).map(d => d.id));
    m.stages.forEach((s, si) => {
      if (!s.id)   push(`stages[${si}].id`,   '階段需要 id');
      if (!s.name) push(`stages[${si}].name`, '階段需要名稱');
      if (!s.type) push(`stages[${si}].type`, '階段需要 type');
      if (s.deckId && !deckIds.has(s.deckId))
        push(`stages[${si}].deckId`, `引用的牌組「${s.deckId}」不存在`);
      else if (s.enabled && s.deckId && !enabledDeckIds.has(s.deckId))
        push(`stages[${si}].deckId`, `階段「${s.name}」引用了已停用的牌組「${s.deckId}」`);
      // advance config sanity
      const checkAdv = (adv, label) => {
        if (!adv) return;
        const validTriggers = ['host','all_played','all_confirmed','all_voted','all_submitted','all_ready',
                               'auto','timer','identity_timer','play_timer','generic_timer',
                               'auto_restart','restart_timer',
                               'host_reveal','auto_next','round_timer','vote_ended'];
        if (adv.trigger && !validTriggers.includes(adv.trigger))
          push(`stages[${si}].${label}.trigger`, `不支援的 trigger：${adv.trigger}`);
        // Check duration requirement for timer-based triggers
        const timerTriggers = ['auto','timer','identity_timer','play_timer','generic_timer','restart_timer','round_timer'];
        if (timerTriggers.includes(adv.trigger) &&
            (!Number.isFinite(Number(adv.duration)) || Number(adv.duration) < 0))
          push(`stages[${si}].${label}.duration`, `${label} 使用 ${adv.trigger} 時需提供 duration（秒數）`);
      };
      checkAdv(s.advance,           'advance');
      checkAdv(s.revealTrigger,     'revealTrigger');
      checkAdv(s.nextRoundTrigger,  'nextRoundTrigger');

      // Validate stage-level round parameters (for card_play stages)
      if (s.type === 'card_play') {
        if (s.maxRounds != null) {
          if (!Number.isFinite(Number(s.maxRounds)) || Number(s.maxRounds) < 1 || Number(s.maxRounds) > 20) {
            push(`stages[${si}].maxRounds`, '總回合數必須是 1-20 之間的數字');
          }
        }
        if (s.refillMode && !['none', 'per_round', 'threshold'].includes(s.refillMode)) {
          push(`stages[${si}].refillMode`, '補牌模式必須是 none、per_round 或 threshold');
        }
        if (s.refillMode === 'per_round') {
          if (s.refillAmount == null) {
            push(`stages[${si}].refillAmount`, '每回合補牌模式需要設定 refillAmount');
          } else if (!Number.isFinite(Number(s.refillAmount)) || Number(s.refillAmount) < 1 || Number(s.refillAmount) > 10) {
            push(`stages[${si}].refillAmount`, '每回合補幾張必須是 1-10 之間的數字');
          }
        }
        if (s.refillMode === 'threshold') {
          if (s.refillThreshold == null) {
            push(`stages[${si}].refillThreshold`, '門檻補牌模式需要設定 refillThreshold');
          } else if (!Number.isFinite(Number(s.refillThreshold)) || Number(s.refillThreshold) < 1 || Number(s.refillThreshold) > 10) {
            push(`stages[${si}].refillThreshold`, '補牌門檻必須是 1-10 之間的數字');
          }
          if (s.refillTo == null) {
            push(`stages[${si}].refillTo`, '門檻補牌模式需要設定 refillTo');
          } else if (!Number.isFinite(Number(s.refillTo)) || Number(s.refillTo) < 1 || Number(s.refillTo) > 20) {
            push(`stages[${si}].refillTo`, '補到幾張必須是 1-20 之間的數字');
          }
          if (s.refillThreshold >= s.refillTo) {
            push(`stages[${si}].refillThreshold`, '補牌門檻必須小於補到幾張');
          }
        }
      }

      // 🆕 驗證 paramActions
      if (s.paramActions && Array.isArray(s.paramActions)) {
        s.paramActions.forEach((pa, pai) => {
          if (!pa.trigger) push(`stages[${si}].paramActions[${pai}].trigger`, '需要 trigger');
          if (!pa.action) push(`stages[${si}].paramActions[${pai}].action`, '需要 action');

          // 驗證 trigger
          const validTriggers = ['onStageStart', 'onStageEnd'];
          if (pa.trigger && !validTriggers.includes(pa.trigger)) {
            push(`stages[${si}].paramActions[${pai}].trigger`, `trigger 必須是 ${validTriggers.join(', ')}`);
          }

          // 驗證 action
          const validActions = ['setValue', 'addValue', 'subtractValue', 'multiplyValue', 'resetParam', 'storeVoteWinner', 'eliminatePlayer'];
          if (pa.action && !validActions.includes(pa.action)) {
            push(`stages[${si}].paramActions[${pai}].action`, `action 必須是 ${validActions.join(', ')}`);
          }

          // 驗證特定 action 的必需欄位
          if (pa.action === 'storeVoteWinner' || pa.action === 'eliminatePlayer') {
            if (!pa.targetParam && !pa.targetPlayerParam) {
              push(`stages[${si}].paramActions[${pai}]`, `${pa.action} 需要 targetParam 或 targetPlayerParam`);
            }
          }

          if (['setValue', 'addValue', 'subtractValue', 'multiplyValue'].includes(pa.action)) {
            if (!pa.targetParam) {
              push(`stages[${si}].paramActions[${pai}]`, `${pa.action} 需要 targetParam`);
            }
          }

          if (pa.action === 'resetParam' && !pa.targetParam) {
            push(`stages[${si}].paramActions[${pai}]`, 'resetParam 需要 targetParam');
          }
        });
      }

      // 🆕 gameConfig 驗證：library 白名單 + gameCode 語法檢查（只編譯不執行）
      const checkGameConfig = (st, pathPrefix) => {
        const gc = st.gameConfig;
        if (gc) {
          if (gc.library && !['three', 'babylon', 'p5'].includes(gc.library)) {
            push(`${pathPrefix}.gameConfig.library`, 'library 必須是 three、babylon 或 p5');
          }
          if (gc.aspectRatio && !['16:9', '4:3', '1:1'].includes(gc.aspectRatio)) {
            push(`${pathPrefix}.gameConfig.aspectRatio`, 'aspectRatio 必須是 16:9、4:3 或 1:1');
          }
          if (gc.gameCode) {
            try { new Function('GameAPI', gc.gameCode); }
            catch (e) { push(`${pathPrefix}.gameConfig.gameCode`, `gameCode 語法錯誤：${e.message}`); }
          }
          if (gc.mobileCode) {
            try { new Function('GameAPI', gc.mobileCode); }
            catch (e) { push(`${pathPrefix}.gameConfig.mobileCode`, `mobileCode 語法錯誤：${e.message}`); }
          }
          if (Array.isArray(gc.files)) {
            const fnames = new Set();
            gc.files.forEach((f, fi) => {
              const fp = `${pathPrefix}.gameConfig.files[${fi}]`;
              if (!f.name || !String(f.name).trim()) push(`${fp}.name`, '程式檔需要名稱');
              else if (fnames.has(f.name)) push(`${fp}.name`, `程式檔名重複：${f.name}`);
              else fnames.add(f.name);
              if (!['shared', 'display', 'mobile'].includes(f.target))
                push(`${fp}.target`, 'target 必須是 shared、display 或 mobile');
              if (typeof f.code !== 'string') push(`${fp}.code`, '程式檔需要 code 字串');
              else if (f.code) {
                try { new Function('GameAPI', f.code); }
                catch (e) { push(`${fp}.code`, `「${f.name}」語法錯誤：${e.message}`); }
              }
            });
          }
        }
        (st.children || st.stages || []).forEach((c, ci) => checkGameConfig(c, `${pathPrefix}.children[${ci}]`));
      };
      checkGameConfig(s, `stages[${si}]`);
    });
  }

  return errors;
}

// Atomic write: write to .tmp first, then rename
function atomicWriteJSON(filePath, obj) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

// Overwrite an existing module's manifest. Accepts the full manifest object
// (from /editor) OR legacy patch shape (from older clients).
// Body: { manifest: {...full...} }  OR  { name, description, fieldValues, decks, stages }
app.put(BASE + '/api/modules/:id/manifest', (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidModuleId(id)) return res.status(400).json({ error: '模組 ID 格式錯誤' });
    // No in-use lock: each session holds a forked snapshot so disk edits are safe

    const moduleDir = path.join(__dirname, 'modules', id);
    const manifestPath = path.join(moduleDir, 'manifest.json');
    const serverJsPath = path.join(moduleDir, 'server.js');

    // Create module directory if it doesn't exist (for new modules)
    const isNewModule = !fs.existsSync(moduleDir);
    if (isNewModule) {
      fs.mkdirSync(moduleDir, { recursive: true });
    }

    // Load existing manifest or use empty object for new modules
    let current;
    if (fs.existsSync(manifestPath)) {
      current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } else {
      current = { id };
    }

    let next;

    if (req.body && req.body.manifest && typeof req.body.manifest === 'object') {
      // Full-replace mode (preferred). Force id to match URL.
      next = { ...req.body.manifest, id };
    } else {
      // Legacy patch shape
      next = { ...current };
      const { name, description, minPlayers, maxPlayers, version, fieldConfig, fieldValues, decks, stages } = req.body || {};
      if (typeof name === 'string' && name.trim()) next.name = name.trim();
      if (typeof description === 'string')         next.description = description;
      if (Number.isFinite(Number(minPlayers)))     next.minPlayers = Number(minPlayers);
      if (Number.isFinite(Number(maxPlayers)))     next.maxPlayers = Number(maxPlayers);
      if (typeof version === 'string')             next.version = version;
      if (fieldConfig && typeof fieldConfig === 'object') next.fieldConfig = fieldConfig;
      if (fieldValues && next.fieldConfig) {
        Object.entries(fieldValues).forEach(([k, v]) => {
          if (next.fieldConfig[k]) next.fieldConfig[k].default = v;
        });
      }
      if (Array.isArray(decks))  next.decks  = decks;
      if (Array.isArray(stages)) next.stages = stages;
    }

    // Validate
    const errors = validateManifest(next);
    if (errors.length) return res.status(400).json({ error: '驗證失敗', errors });

    atomicWriteJSON(manifestPath, next);

    moduleLoader._scanModules();

    const updatedList = moduleLoader.listModules();
    for (const session of sessions.values()) {
      if (session.hostSocketId) io.to(session.hostSocketId).emit('modules_updated', { modules: updatedList });
    }

    console.log(`[Module] Saved: ${id}`);
    res.json({ id, name: next.name, modules: updatedList });
  } catch (err) {
    console.error('[Module] Save failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a module directory
app.delete(BASE + '/api/modules/:id', (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidModuleId(id)) return res.status(400).json({ error: '模組 ID 格式錯誤' });
    if (moduleInUse(id))      return res.status(409).json({ error: '此模組正在遊戲中，無法刪除' });

    const moduleDir = path.join(__dirname, 'modules', id);
    if (!fs.existsSync(moduleDir)) return res.status(404).json({ error: '模組不存在' });

    // Refuse to delete if it's the only remaining module
    if (moduleLoader.listModules().length <= 1) {
      return res.status(409).json({ error: '至少需保留一個模組' });
    }

    fs.rmSync(moduleDir, { recursive: true, force: true });
    moduleLoader._scanModules();

    const updatedList = moduleLoader.listModules();
    for (const session of sessions.values()) {
      if (session.hostSocketId) io.to(session.hostSocketId).emit('modules_updated', { modules: updatedList });
    }

    console.log(`[Module] Deleted: ${id}`);
    res.json({ id, modules: updatedList });
  } catch (err) {
    console.error('[Module] Delete failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Clone a module: copy <sourceId>/ → <newId>/ with edited manifest baked in.
// Body: { newId, newName, description?, fieldValues?, decks?, stages? }
// fieldValues are merged into fieldConfig[k].default; decks/stages replace wholesale.
app.post(BASE + '/api/modules/:sourceId/clone', (req, res) => {
  try {
    const sourceId = req.params.sourceId;
    const { newId, newName, description, fieldValues, decks, stages } = req.body || {};

    if (!newId || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(newId)) {
      return res.status(400).json({ error: '新模組 ID 必須以英數開頭，只能包含英數、底線、連字號（最長 40 字元）' });
    }
    if (newId === sourceId) {
      return res.status(400).json({ error: '新模組 ID 不能與來源相同' });
    }

    const modulesDir = path.join(__dirname, 'modules');
    const srcDir     = path.join(modulesDir, sourceId);
    const dstDir     = path.join(modulesDir, newId);

    if (!fs.existsSync(path.join(srcDir, 'manifest.json'))) {
      return res.status(404).json({ error: '來源模組不存在' });
    }
    if (fs.existsSync(dstDir)) {
      return res.status(409).json({ error: `模組 ID "${newId}" 已存在` });
    }

    const sourceManifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));

    // Build new manifest: clone source, then patch
    const newManifest = JSON.parse(JSON.stringify(sourceManifest));
    newManifest.id   = newId;
    newManifest.name = newName || newId;
    // Point the new module at the source's engine so future engine updates apply
    newManifest.engine = sourceManifest.engine || sourceId;
    if (typeof description === 'string') newManifest.description = description;

    // Bake fieldValues into fieldConfig defaults so they become the new defaults
    if (fieldValues && newManifest.fieldConfig) {
      Object.entries(fieldValues).forEach(([k, v]) => {
        if (newManifest.fieldConfig[k]) newManifest.fieldConfig[k].default = v;
      });
    }
    if (Array.isArray(decks))  newManifest.decks  = decks;
    if (Array.isArray(stages)) newManifest.stages = stages;

    // Validate before creating files
    const errors = validateManifest(newManifest);
    if (errors.length) return res.status(400).json({ error: '驗證失敗', errors });

    // Create destination dir. We DO NOT copy server.js — the new module
    // points back to the source via manifest.engine and shares its engine code.
    // This way, fixes to the engine automatically apply to all derived modules.
    fs.mkdirSync(dstDir);
    atomicWriteJSON(path.join(dstDir, 'manifest.json'), newManifest);

    // Re-scan so the new module is immediately loadable
    moduleLoader._scanModules();

    // Notify all connected hosts so their module lists refresh
    const updatedList = moduleLoader.listModules();
    for (const session of sessions.values()) {
      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('modules_updated', { modules: updatedList });
      }
    }

    console.log(`[Module] Cloned: ${sourceId} → ${newId}`);
    res.json({ id: newId, name: newManifest.name, modules: updatedList });
  } catch (err) {
    console.error('[Module] Clone failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// QR code for a room (returns PNG)
app.get(BASE + '/api/rooms/:roomId/qr', async (req, res) => {
  const roomId = req.params.roomId.toUpperCase();
  const overrideHost = req.query.host;
  // ?path= 覆蓋(same-origin,必須以 / 開頭)—— 讓 P2P host 頁對自訂 mobile 路徑(/mobile/p2p.html?room=)出 QR。
  let suffix = `/mobile?room=${roomId}`;
  if (req.query.path) { const p = String(req.query.path); suffix = p.startsWith('/') ? p : '/' + p; }
  let url;
  if (PUBLIC_ORIGIN && !overrideHost) {
    url = `${PUBLIC_ORIGIN}${BASE}${suffix}`;
  } else {
    const host = overrideHost ? `${overrideHost}:${PORT}` : (PUBLIC_HOST ? `${PUBLIC_HOST}:${PORT}` : req.headers.host);
    url = `http://${host}${BASE}${suffix}`;
  }
  const png = await QRCode.toBuffer(url);
  res.set('Content-Type', 'image/png').send(png);
});

// ── WebSocket ─────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── Join as player ──────────────────────────────────────────
  socket.on('join_room', ({ roomId, playerId, playerName }) => {
    const session = getSession(socket, roomId);
    if (!session) return;

    // Enforce maxPlayers if manifest is pre-loaded (skip for reconnects)
    const isExisting = session.players.get(playerId);
    if (!isExisting && session.manifest?.maxPlayers) {
      const connected = session.players.all().filter(p => p.isConnected).length;
      if (connected >= session.manifest.maxPlayers) {
        socket.emit('error', { message: `房間已滿，最多 ${session.manifest.maxPlayers} 人` });
        return;
      }
    }

    // Use uppercase roomId for socket.io room to match session room
    const upperRoomId = roomId.toUpperCase();
    socket.join(upperRoomId);
    const player = session.addPlayer(playerId, playerName, socket.id);

    const currentStage = (session.phase === 'playing' && session.currentModule)
      ? session.currentModule.getCurrentStageInfo?.() ?? null
      : null;
    const inCurrentGame = (session.phase === 'playing' && session.currentModule)
      ? session.currentModule.players.some(p => p.id === player.id)
      : false;
    socket.emit('room_joined', {
      roomId,
      playerId: player.id,
      phase: session.phase,
      moduleName: session.moduleName,
      players: session.players.publicList(),
      sharedState: session.sharedState,
      playerState: player.toPrivate(),
      currentStage,
      inCurrentGame,
    });

    console.log(`[Room:${roomId}] Player joined: ${playerName} (${playerId})`);
  });

  // ── Join as display ─────────────────────────────────────────
  socket.on('join_display', ({ roomId }) => {
    const session = getSession(socket, roomId);
    if (!session) return;

    socket.join(roomId);
    session.displaySocketIds.add(socket.id);
    const currentStage = (session.phase === 'playing' && session.currentModule)
      ? session.currentModule.getCurrentStageInfo?.() ?? null
      : null;
    socket.emit('display_joined', {
      roomId,
      phase: session.phase,
      moduleName: session.moduleName,
      players: session.players.publicList(),
      sharedState: session.sharedState,
      currentStage,
    });
    console.log(`[Room:${roomId}] Display connected`);
  });

  // ── Join as host ────────────────────────────────────────────
  socket.on('join_host', ({ roomId }) => {
    if (!auth.socketAuthOk(socket)) {
      socket.emit('error', { message: '需要登入才能主持', code: 'AUTH_REQUIRED' });
      return;
    }
    const session = getSession(socket, roomId);
    if (!session) return;

    // 只有開房者本人能主持;別人的房只能以玩家(join_room)/觀眾(join_display)身分加入
    if (session.ownerUserId && session.ownerUserId !== auth.socketUserId(socket)) {
      socket.emit('error', { message: '這是別人開的房間,你只能以玩家身分加入', code: 'ROOM_FORBIDDEN' });
      return;
    }

    socket.join(roomId);
    session.hostSocketId = socket.id;
    socket.emit('host_joined', {
      roomId,
      phase: session.phase,
      moduleName: session.moduleName,
      manifest: session.manifest,
      players: session.players.publicList(),
      availableModules: moduleLoader.listModules(),
      sharedState: session.sharedState,
    });
    console.log(`[Room:${roomId}] Host connected`);

    // 🆕 如果遊戲已經開始，發送當前遊戲狀態給重連的host
    if (session.phase === 'playing' && session.currentModule) {
      console.log(`[Room:${roomId}] Sending current game state to reconnected host`);
      session.sendHostGameState();
    }
  });

  // ── Host: toggle QR display ──────────────────────────────────
  socket.on('host_toggle_qr', ({ roomId, visible }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    session.broadcastDisplay('qr_toggled', { visible });
    console.log(`[Room:${roomId}] QR toggled: ${visible ? 'SHOW' : 'HIDE'}`);
  });

  // ── Player ready ────────────────────────────────────────────
  socket.on('player_ready', ({ roomId, playerId, isReady }) => {
    const session = sessions.get(roomId);
    if (!session) return;
    const player = session.players.get(playerId);
    if (player) {
      // Update business logic flag
      player.isReady = !!isReady;
      // Sync display status
      player.status = isReady ? 'ready' : 'waiting';
      // Broadcast both old event (for compatibility) and new status update
      session.broadcastAll('player_ready', { playerId, players: session.players.publicList() });
      session.broadcastAll('player_status_updated', {
        playerId: playerId,
        status: player.status
      });
    }
  });

  // ── Play a card ─────────────────────────────────────────────
  socket.on('play_card', ({ roomId, playerId, cardId, target }) => {
    const session = sessions.get(roomId);
    if (!session) return;
    session.handlePlayerAction(playerId, 'play_card', { cardId, target });
  });

  // ── Generic player action ───────────────────────────────────
  socket.on('player_action', ({ roomId, playerId, action, data }) => {
    const session = sessions.get(roomId);
    if (!session) return;
    session.handlePlayerAction(playerId, action, data);
  });

  // ── Player submit data (forms) ──────────────────────────────
  socket.on('player_submit', ({ roomId, playerId, data }) => {
    const session = sessions.get(roomId);
    if (!session) return;
    session.handlePlayerSubmit(playerId, data);
  });

  // ── Host: load module ───────────────────────────────────────
  socket.on('host_load_module', async ({ roomId, moduleName, config }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    try {
      // 若要載入的模組跟房間目前快照不同（更換模組後、或建房時未指定模組），
      // 重新從登錄表 fork 一份新鮮快照，讓真的換得成遊戲（而非沿用開房時那份）。
      const snapshotId = session.manifest && session.manifest.id;
      if (moduleName && moduleName !== snapshotId) {
        const fresh = moduleLoader.getManifest(moduleName);
        if (!fresh) { socket.emit('error', { message: `Module "${moduleName}" not found` }); return; }
        session.manifest   = JSON.parse(JSON.stringify(fresh));   // 深拷貝：與日後編輯器存檔隔離
        session.moduleName = moduleName;
        session.engineCode = moduleLoader.readEngineCode(moduleName);
      }
      // Use the session's forked snapshot; fall back to live registry only if no snapshot
      const manifest = session.manifest || moduleLoader.registry.get(moduleName);
      if (manifest) {
        const readyCount = session.players.all().filter(p => p.isReady).length;
        if (readyCount < manifest.minPlayers) {
          socket.emit('error', { message: `玩家準備人數不足，至少需要 ${manifest.minPlayers} 人（目前 ${readyCount} 人）` });
          return;
        }
        if (readyCount > manifest.maxPlayers) {
          socket.emit('error', { message: `準備人數超過上限，最多 ${manifest.maxPlayers} 人（目前 ${readyCount} 人）` });
          return;
        }
      }
      const moduleInstance = await moduleLoader.load(moduleName, session, config, {
        manifest: session.manifest,
        engineCode: session.engineCode,
      });
      await session.startModule(moduleInstance, moduleName);
    } catch (err) {
      socket.emit('error', { message: err.message });
      console.error(`[Module] Load failed: ${err.message}`);
    }
  });

  // ── Host: 選定模組（只載入快照、留在 lobby，不啟動）──────────────
  // 對應 labs 頁的「載入遊戲」;之後 host_load_module 用同一個 moduleName 啟動時
  // 會沿用這份快照,不再重新 fork。
  socket.on('host_select_module', ({ roomId, moduleName }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    if (session.phase !== 'lobby') return;
    const fresh = moduleLoader.getManifest(moduleName);
    if (!fresh) { socket.emit('error', { message: `Module "${moduleName}" not found` }); return; }
    session.manifest   = JSON.parse(JSON.stringify(fresh));   // 深拷貝：與日後編輯器存檔隔離
    session.moduleName = moduleName;
    session.engineCode = moduleLoader.readEngineCode(moduleName);
    session.broadcastAll('module_selected', { moduleId: moduleName, manifest: session.manifest });
    console.log(`[Room:${roomId}] Module selected (not started): ${moduleName}`);
  });

  // ── Host: 更換遊戲模組 ────────────────────────────────────────
  // 從任何階段（遊戲進行中 / 結算 / 大廳）強制把全部人踢回大廳，並丟掉房間的模組快照，
  // 讓主持人重新挑一個模組直接開新局（不必關房重掃）。玩家的「準備」狀態保留。
  socket.on('host_change_module', ({ roomId }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    session.resetToLobby();          // dispose 模組計時器、清空狀態、廣播 back_to_lobby + player_ready
    session.manifest   = null;       // 丟掉快照，下次 host_load_module 會 fork 新選的模組
    session.moduleName = null;
    session.engineCode = null;
    // 通知主持人重新打開模組選擇器（附上最新模組清單，順便反映期間的編輯器新增）
    session.sendToHost('module_picker_reopen', { availableModules: moduleLoader.listModules() });
    console.log(`[Room:${roomId}] Module change requested → back to lobby, picker reopened`);
  });

  // ── Host: close room ────────────────────────────────────────
  // ── 遊戲執行 log 回報（display / mobile / 編輯器預覽）→ 依模組聚合，給 AI debug ──
  socket.on('game_log', ({ roomId, moduleId, entries }) => {
    if (!Array.isArray(entries) || !entries.length) return;
    let mid = null;
    if (typeof moduleId === 'string' && isValidModuleId(moduleId)) mid = moduleId;
    else if (roomId && sessions.get(roomId)) mid = sessions.get(roomId).moduleName;
    if (!mid) return;
    require('./ai/gamelogs').addLogs(mid, entries.slice(0, 50));
  });

  // ── Display → 全體手機：自訂互動遊戲的廣播（開始倒數、名次更新等）──
  socket.on('display_game_broadcast', ({ roomId, data }) => {
    const session = sessions.get(roomId);
    if (!session || !session.displaySocketIds.has(socket.id)) return;
    session.broadcastPlayers('game_broadcast', { data });
  });

  socket.on('host_close_room', ({ roomId }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    session.broadcastAll('room_closed', {});
    sessions.delete(roomId);
    console.log(`[Room] Closed by host: ${roomId}`);
  });

  // ── Host: next phase ────────────────────────────────────────
  socket.on('host_next_phase', ({ roomId, data }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    session.handleHostNextPhase(data || {});
  });

  // ── Host: kick player ───────────────────────────────────────
  socket.on('host_kick_player', ({ roomId, playerId }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    session.players.remove(playerId);
    session.broadcastAll('player_left', { playerId, players: session.players.publicList() });
  });

  // ── Host: broadcast player display order to display clients ─
  socket.on('host_set_player_order', ({ roomId, order }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    session.broadcastDisplay('player_order_changed', { order });
  });

  // ── Host: broadcast player number updates to all clients ────────
  socket.on('player_numbers_updated', ({ roomId, players }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    // Update player numbers in the session
    for (const [playerId, playerNumber] of Object.entries(players)) {
      const player = session.players.get(playerId);
      if (player) {
        player.playerNumber = playerNumber;
      }
    }
    // Broadcast to all clients (mobile, display, and host)
    session.broadcastAll('player_numbers_updated', { players });
  });

  // ── Host: set a module-defined attribute on a player ────────
  socket.on('host_set_player_attribute', ({ roomId, playerId, attrId, value }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    const player = session.players.get(playerId);
    if (!player) return;
    player.attributes[attrId] = value;
    if (session.currentModule?.players) {
      const mp = session.currentModule.players.find(p => p.id === playerId);
      if (mp) mp.attributes = player.attributes;
    }
    session.broadcastAll('player_attribute_changed', {
      playerId,
      attrId,
      value,
      attributes: player.attributes,
    });
    session.sendHostGameState();
  });

  // ── Host: manually set player alive/eliminated ──────────────
  socket.on('host_set_player_alive', ({ roomId, playerId, isAlive }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    const player = session.players.get(playerId);
    if (!player) return;
    player.isAlive = isAlive;
    player.isEliminated = !isAlive;
    // Sync display status
    player.status = isAlive ? 'thinking' : 'eliminated';
    // Also update the reference in the active module's players array
    if (session.currentModule?.players) {
      const mp = session.currentModule.players.find(p => p.id === playerId);
      if (mp) {
        mp.isAlive = isAlive;
        mp.isEliminated = !isAlive;
        mp.status = player.status;
      }
    }
    session.broadcastAll('player_alive_changed', { playerId, isAlive, playerName: player.name });
    session.broadcastAll('player_status_updated', { playerId, status: player.status });
    session.sendHostGameState();
  });

  // ── Host: rename player ───────────────────────────────────────
  socket.on('host_rename_player', ({ roomId, playerId, newName }) => {
    const session = sessions.get(roomId);
    if (!session || session.hostSocketId !== socket.id) return;
    const player = session.players.get(playerId);
    if (!player) return;
    if (!newName || newName.trim().length === 0) return;

    const oldName = player.name;
    player.name = newName.trim();

    // Also update the reference in the active module's players array
    if (session.currentModule?.players) {
      const mp = session.currentModule.players.find(p => p.id === playerId);
      if (mp) mp.name = newName.trim();
    }

    console.log(`[Room:${roomId}] Player renamed: ${oldName} → ${newName}`);
    session.broadcastAll('player_renamed', { playerId, oldName, newName: player.name });
    session.sendHostGameState();
  });

  // ── Actions API (Creator Hub) ─────────────────────────────────
  socket.on('actions:list', async () => {
    try {
      const configs = await actionsAPI.listActions();
      socket.emit('actions:list', configs);
    } catch (err) {
      socket.emit('error', { message: 'Failed to list actions: ' + err.message });
    }
  });

  socket.on('actions:get', async ({ id }) => {
    try {
      const config = await actionsAPI.getAction(id);
      if (!config) {
        socket.emit('error', { message: 'Action config not found' });
        return;
      }
      socket.emit('actions:get', config);
    } catch (err) {
      socket.emit('error', { message: 'Failed to get action: ' + err.message });
    }
  });

  socket.on('actions:create', async (config) => {
    try {
      const newConfig = await actionsAPI.createAction(config);
      socket.emit('actions:created', newConfig);
    } catch (err) {
      socket.emit('error', { message: 'Failed to create action: ' + err.message });
    }
  });

  socket.on('actions:update', async ({ id, ...updates }) => {
    try {
      const updatedConfig = await actionsAPI.updateAction(id, updates);
      socket.emit('actions:updated', updatedConfig);
    } catch (err) {
      socket.emit('error', { message: 'Failed to update action: ' + err.message });
    }
  });

  socket.on('actions:delete', async ({ id }) => {
    try {
      await actionsAPI.deleteAction(id);
      socket.emit('actions:deleted', id);
    } catch (err) {
      socket.emit('error', { message: 'Failed to delete action: ' + err.message });
    }
  });

  // ── Disconnect ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    for (const session of sessions.values()) {
      session.displaySocketIds.delete(socket.id);
      if (session.hostSocketId === socket.id) session.hostSocketId = null;
      session.disconnectPlayer(socket.id);
    }
  });
});

// ── Helpers ────────────────────────────────────────────────────────

function getSession(socket, roomId) {
  if (!roomId) { socket.emit('error', { message: 'roomId required' }); return null; }
  const session = sessions.get(roomId.toUpperCase());
  if (!session) { socket.emit('error', { message: 'Room not found' }); return null; }
  return session;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (sessions.has(code));
  return code;
}

// ── Start ──────────────────────────────────────────────────────────
async function startServer() {
  await initializeServer();

  // Phase 1:WebRTC 信令中繼(P2P 房建連用;建連後遊戲流量走 DataChannel 不經此)
  require('./p2p-signal').attach(io);

  // AI 核心（Kimi 編輯核心 + AI 主持）— 需在 moduleLoader 初始化後接線
  require('./ai').attach({
    app, io, sessions, moduleLoader, validateManifest, atomicWriteJSON,
    modulesDir: path.join(__dirname, 'modules'),
    decksDir: path.join(__dirname, 'decks'),
    assetsRoot: ASSETS_ROOT,
    port: PORT,
    base: BASE,
    auth,
  });

  server.listen(PORT, () => {
    const publicBase = PUBLIC_ORIGIN || (PUBLIC_HOST ? `http://${PUBLIC_HOST}:${PORT}` : `http://localhost:${PORT}`);
    console.log(`\n🎮 Immersive Game Server`);
    console.log(`   Local   → http://localhost:${PORT}${BASE || ''}`);
    if (PUBLIC_ORIGIN) console.log(`   Public  → ${PUBLIC_ORIGIN}${BASE}  ← 分享連結/QR 用這個`);
    else if (PUBLIC_HOST) console.log(`   Public  → ${publicBase}  ← QR codes use this`);
    console.log(`   Labs    → ${publicBase}${BASE}/  （合併主持頁${auth.enabled ? ',需登入' : ',登入停用'}）`);
    console.log(`   Mobile  → ${publicBase}${BASE}/mobile`);
    console.log(`   Display → ${publicBase}${BASE}/display`);
    console.log(`   Editor  → ${publicBase}${BASE}/editor`);
    if (BASE) console.log(`   (子路徑模式 BASE_PATH=${BASE},根路徑不再提供頁面)`);
    console.log('');
  });
}

startServer();

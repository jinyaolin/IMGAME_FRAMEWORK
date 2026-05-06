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
const io = new Server(server, { cors: { origin: '*' } });

const PORT        = process.env.PORT || 3000;
const PUBLIC_HOST = process.env.HOST || null;  // e.g. HOST=192.168.1.100
const sessions = new Map();       // roomId → GameSession

// DeckManager (global deck library) and ModuleLoader (game modules) — initialised by startServer()
const DeckManager = require('./core/DeckManager');
const deckManager = new DeckManager(path.join(__dirname, 'decks'));
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
app.use('/mobile',  express.static(path.join(__dirname, '../client/mobile')));
app.use('/display', express.static(path.join(__dirname, '../client/display')));
app.use('/host',    express.static(path.join(__dirname, '../client/host')));
app.use('/editor',  express.static(path.join(__dirname, '../client/editor')));
app.use('/decks',   express.static(path.join(__dirname, '../client/decks')));
app.use('/shared',  express.static(path.join(__dirname, '../client/shared')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// ── Decks API ───────────────────────────────────────────────────────
const { router: decksRouter } = require('./api/decks');
// Attach deckManager to app for API access
app.deckManager = deckManager;
// Attach deckManager to request for API routes
app.use('/api/decks', (req, res, next) => {
  req.deckManager = deckManager;
  next();
}, decksRouter);

// ── HTTP API ──────────────────────────────────────────────────────

// Create a new room (called by host)
app.post('/api/rooms', (req, res) => {
  const { moduleId } = req.body || {};
  const roomId = generateRoomCode();
  const session = new GameSession(roomId, io);

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

// List all active rooms
app.get('/api/rooms', (req, res) => {
  const rooms = Array.from(sessions.values()).map(session => session.toSummary());
  res.json(rooms);
});

// Room info
app.get('/api/rooms/:roomId', (req, res) => {
  const session = sessions.get(req.params.roomId.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Room not found' });
  res.json(session.toSummary());
});

// Available modules (summary list)
app.get('/api/modules', (req, res) => {
  res.json(moduleLoader.listModules());
});

// Get module's server.js content
app.get('/api/modules/:id/server', (req, res) => {
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
app.post('/api/modules/:id/server', (req, res) => {
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
app.delete('/api/modules/:id/server', (req, res) => {
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
app.get('/api/modules/:id', (req, res) => {
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
                               'host_reveal','auto_next','round_timer'];
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
app.put('/api/modules/:id/manifest', (req, res) => {
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
app.delete('/api/modules/:id', (req, res) => {
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
app.post('/api/modules/:sourceId/clone', (req, res) => {
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
app.get('/api/rooms/:roomId/qr', async (req, res) => {
  const roomId = req.params.roomId.toUpperCase();
  const overrideHost = req.query.host;
  const host = overrideHost ? `${overrideHost}:${PORT}` : (PUBLIC_HOST ? `${PUBLIC_HOST}:${PORT}` : req.headers.host);
  const url = `http://${host}/mobile?room=${roomId}`;
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
    const session = getSession(socket, roomId);
    if (!session) return;

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

  // ── Host: close room ────────────────────────────────────────
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

  server.listen(PORT, () => {
    const publicBase = PUBLIC_HOST ? `http://${PUBLIC_HOST}:${PORT}` : `http://localhost:${PORT}`;
    console.log(`\n🎮 Immersive Game Server`);
    console.log(`   Local   → http://localhost:${PORT}`);
    if (PUBLIC_HOST) console.log(`   Public  → ${publicBase}  ← QR codes use this`);
    console.log(`   Mobile  → ${publicBase}/mobile`);
    console.log(`   Display → ${publicBase}/display`);
    console.log(`   Host    → ${publicBase}/host`);
    console.log(`   Editor  → ${publicBase}/editor`);
    console.log(`   Decks   → ${publicBase}/decks\n`);
  });
}

startServer();

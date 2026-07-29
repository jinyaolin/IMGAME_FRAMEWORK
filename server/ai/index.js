'use strict';

// AI 核心接線：Socket.IO 事件、REST 狀態、GM 自動主持觸發
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { createTools } = require('./tools');
const { runAgent, compactSession } = require('./agent');
const { editorSystemPrompt, gmSystemPrompt, GESTURE_DOC } = require('./prompts');
const { chat: llmChat } = require('./llm');
const GestureKit = require('../../client/shared/gesture-kit.js');

function attach(deps) {
  const { app, io, sessions, moduleLoader } = deps;
  const tools = createTools(deps);
  const BASE = deps.base || '';
  const auth = deps.auth || { socketAuthOk: () => true };

  // 編輯器對話以「持久 chatId」為鍵（瀏覽器 sessionStorage 產生），事件用 room 廣播
  // → socket 閃斷重連後進度不會消失（舊實作綁 socket.id，重連就收不到了）
  const editorSessions = new Map(); // chatId → { messages: [], busy, lastActive }
  const gmSessions = new Map();     // roomId → { messages: [], autoPilot, busy, pendingEvents, debounceTimer }
  const EDITOR_SESSION_TTL = 2 * 60 * 60 * 1000;
  const chatRoom = (chatId) => 'ai:' + chatId;

  // ── REST：前端查 AI 是否已設定 ─────────────────────────────
  app.get(BASE + '/api/ai/status', (req, res) => {
    const cfg = loadConfig();
    res.json({ configured: !!cfg.apiKey, model: cfg.model });
  });

  // ── Gesture Lab:LLM 寫動作(工具迴圈:讀庫/讀單一動作/存檔;save 帶驗證回饋讓 Kimi 自我修正)──
  // 回傳 {text, saved:[names], specs:[…fallback]}:saved = 本輪存進動作庫的名稱,頁面重載庫並播最後一個。
  const gestureStore = require('../gestures');
  const gfn = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters } });
  const GESTURE_TOOLS = [
    gfn('list_gestures', '列出動作庫中所有動作(名稱/標籤/類型)', { type: 'object', properties: {} }),
    gfn('get_gesture', '讀取某動作的完整規格 JSON(修改前先讀原版)', {
      type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
    gfn('save_gesture', '驗證並把動作規格存進動作庫(通過才存;失敗回傳錯誤請修正後重存)', {
      type: 'object', properties: { spec: { type: 'object', description: '完整手勢規格 {name,label,type,dur,tracks}' } }, required: ['spec'] }),
  ];
  const gestureGate = (auth && auth.requireAuthAPI) ? auth.requireAuthAPI : (req, res, next) => next();
  app.post(BASE + '/api/ai/gesture', gestureGate, async (req, res) => {
    const cfg = loadConfig();
    if (!cfg.apiKey) return res.status(503).json({ error: '未設定 AI(server/ai/ai-config.json)' });
    const hist = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages = [{ role: 'system', content: GESTURE_DOC }];
    for (const m of hist.slice(-20)) {
      if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length < 20000) {
        messages.push({ role: m.role, content: m.content });
      }
    }
    const saved = [];
    const runTool = (name, args) => {
      try {
        if (name === 'list_gestures') return { gestures: gestureStore.list().map(s => ({ name: s.name, label: s.label, type: s.type, dur: s.dur })) };
        if (name === 'get_gesture') { const s = gestureStore.get(args.name); return s ? { spec: s } : { error: '找不到 ' + args.name }; }
        if (name === 'save_gesture') {
          const v = gestureStore.save(args.spec);
          if (v.ok) { saved.push(args.spec.name); return { ok: true, warnings: v.warnings || [] }; }
          return { ok: false, errors: v.errors };
        }
        return { error: '未知工具 ' + name };
      } catch (e) { return { error: e.message }; }
    };
    try {
      let text = '';
      for (let round = 0; round < 6; round++) {
        const out = await llmChat(messages, GESTURE_TOOLS);
        const msg = out.message;
        messages.push(msg);
        if (!msg.tool_calls || !msg.tool_calls.length) { text = msg.content || ''; break; }
        for (const tc of msg.tool_calls) {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          const result = runTool(tc.function.name, args);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        text = msg.content || text;   // 迴圈耗盡時保底
      }
      // 後備:沒用工具、只回了 ```json 圍欄 → 伺服器代存(維持舊行為可用)
      const specs = [];
      if (!saved.length) {
        for (const f of [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1])) {
          try {
            const parsed = JSON.parse(f);
            for (const spec of (Array.isArray(parsed) ? parsed : [parsed])) {
              const v = gestureStore.save(spec);
              if (v.ok) saved.push(spec.name);
              specs.push({ spec, ok: v.ok, errors: v.errors, warnings: v.warnings || [] });
            }
          } catch (e) { specs.push({ spec: null, ok: false, errors: ['JSON 解析失敗: ' + e.message], warnings: [] }); }
        }
      }
      res.json({ text, saved, specs });
    } catch (e) {
      console.error('[AI gesture]', e && e.message);
      res.status(502).json({ error: 'LLM 呼叫失敗: ' + (e && e.message) });
    }
  });

  // ── GM 對話輔助 ───────────────────────────────────────────
  function getGmSession(roomId) {
    if (!gmSessions.has(roomId)) {
      gmSessions.set(roomId, { messages: [], autoPilot: false, busy: false, pendingEvents: [], debounceTimer: null });
    }
    return gmSessions.get(roomId);
  }

  function gmEmitFactory(roomId) {
    return (evt) => {
      const session = sessions.get(roomId);
      if (session) session.sendToHost('ai_gm_update', evt);
    };
  }

  async function runGmAgent(roomId, userText) {
    const gm = getGmSession(roomId);
    if (gm.busy) {
      gmEmitFactory(roomId)({ type: 'error', message: 'AI 主持正在處理中，請稍候' });
      return;
    }
    gm.busy = true;
    const session = sessions.get(roomId);
    try {
      await runAgent({
        session: gm,
        systemPrompt: gmSystemPrompt(roomId, session?.moduleName),
        userText,
        toolDefs: tools.gmDefs,
        runTool: tools.runGmTool,
        toolCtx: { roomId },
        emit: gmEmitFactory(roomId),
      });
    } finally {
      gm.busy = false;
      // 忙碌期間累積的事件補跑一次
      if (gm.pendingEvents.length && gm.autoPilot) {
        const events = gm.pendingEvents.splice(0);
        setTimeout(() => notifyGmEvents(roomId, events), 500);
      }
    }
  }

  function notifyGmEvents(roomId, events) {
    const gm = gmSessions.get(roomId);
    if (!gm || !gm.autoPilot) return;
    if (gm.busy) { gm.pendingEvents.push(...events); return; }
    const lines = events.map(e => `- ${e}`).join('\n');
    runGmAgent(roomId, `[遊戲事件通知]\n${lines}\n（若流程會自動推進就不必動作，簡短回報觀察即可；卡住才用 host_action。）`);
  }

  // GM 自動主持觀察者：掛在 GameSession 上（見 GameSession.broadcastAll）
  const WATCHED_EVENTS = ['stage_started', 'vote_ended', 'round_result', 'game_ended', 'players_eliminated', 'module_error'];
  function makeObserver(roomId) {
    return (event, data) => {
      const gm = gmSessions.get(roomId);
      if (!gm || !gm.autoPilot) return;
      if (!WATCHED_EVENTS.includes(event)) return;
      let line = event;
      if (event === 'stage_started') line = `stage_started: ${data.stageName}（${data.stageType}）`;
      else if (event === 'game_ended') line = 'game_ended: 遊戲結束';
      else if (event === 'module_error') line = `module_error: ${data.message}`;
      gm.pendingEvents.push(line);
      clearTimeout(gm.debounceTimer);
      gm.debounceTimer = setTimeout(() => {
        const events = gm.pendingEvents.splice(0);
        if (events.length) notifyGmEvents(roomId, events);
      }, 2500);
    };
  }

  // ── Socket.IO ─────────────────────────────────────────────
  io.on('connection', (socket) => {
    // 編輯器（重）連線時加入自己的對話 room — 重連後進度事件自動續上
    socket.on('ai_join', ({ chatId }) => {
      if (typeof chatId === 'string' && chatId.length <= 64) {
        socket.join(chatRoom(chatId));
        const ed = editorSessions.get(chatId);
        if (ed?.busy) socket.emit('ai_update', { type: 'status', message: 'Kimi 正在處理中（重連已續上進度）…' });
      }
    });

    // 編輯器 vibe coding 對話（text 可附 images：使用者貼上的截圖，給 Kimi 視覺分析）
    socket.on('ai_chat', async ({ chatId, text, moduleId, images }) => {
      if (!auth.socketAuthOk(socket)) { socket.emit('ai_update', { type: 'error', message: '需要登入' }); return; }
      const validImages = (Array.isArray(images) ? images : [])
        .filter(u => typeof u === 'string' && u.startsWith('data:image/') && u.length < 2500000)
        .slice(0, 3);
      if (typeof text !== 'string') text = '';
      if (!text.trim() && !validImages.length) return;
      if (!text.trim()) text = '請分析附圖中的問題。';
      const key = (typeof chatId === 'string' && chatId) ? chatId : socket.id;
      socket.join(chatRoom(key));
      if (!editorSessions.has(key)) editorSessions.set(key, { messages: [] });
      const ed = editorSessions.get(key);
      ed.lastActive = Date.now();
      if (ed.busy) { socket.emit('ai_update', { type: 'error', message: 'AI 正在處理上一則訊息，請稍候' }); return; }

      // /compact：手動壓縮對話記憶
      if (text.trim() === '/compact') {
        ed.busy = true;
        try {
          const did = await compactSession(ed, evt => io.to(chatRoom(key)).emit('ai_update', evt), { force: true });
          io.to(chatRoom(key)).emit('ai_update', { type: 'assistant', text: did ? '🗜 已壓縮對話記憶：舊對話摘要成工作備忘錄，最近的對話保留原文。' : '目前對話還很短，不需要壓縮。' });
          io.to(chatRoom(key)).emit('ai_update', { type: 'done' });
        } finally { ed.busy = false; }
        return;
      }

      ed.busy = true;
      const moduleList = moduleLoader.listModules()
        .map(m => `- ${m.id}：${m.name}（${m.minPlayers}-${m.maxPlayers} 人）`).join('\n');
      let contextNote = moduleId ? `\n\n（設計師目前在編輯器選取的模組：${moduleId}）` : '';
      // 自動注入該模組的長期筆記（KIMI.md）— Kimi 的跨對話記憶
      if (moduleId && /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(moduleId)) {
        try {
          const notesPath = path.join(deps.modulesDir, moduleId, 'KIMI.md');
          if (fs.existsSync(notesPath)) {
            const notes = fs.readFileSync(notesPath, 'utf8').slice(0, 8000);
            contextNote += `\n\n（此模組的長期筆記 KIMI.md — 你之前記下的，重要脈絡在此）：\n${notes}`;
          }
        } catch {}
      }
      // 有附圖 → 組成 vision 多模態訊息
      const userContent = validImages.length
        ? [{ type: 'text', text }, ...validImages.map(u => ({ type: 'image_url', image_url: { url: u } }))]
        : text;
      try {
        await runAgent({
          session: ed,
          systemPrompt: editorSystemPrompt(moduleList) + contextNote,
          userText: userContent,
          toolDefs: tools.editorDefs,
          runTool: tools.runEditorTool,
          toolCtx: {},
          emit: (evt) => io.to(chatRoom(key)).emit('ai_update', evt),   // room 廣播：斷線重連不漏事件
        });
      } finally {
        ed.busy = false;
        ed.lastActive = Date.now();
      }
    });

    // 中斷進行中的編輯器任務
    socket.on('ai_stop', ({ chatId } = {}) => {
      const key = (typeof chatId === 'string' && chatId) ? chatId : socket.id;
      const ed = editorSessions.get(key);
      if (!ed || !ed.busy) return;
      ed.abortRequested = true;
      try { ed._abortCtl?.abort(); } catch {}
      console.log(`[AI] 使用者中斷編輯器任務: ${key}`);
    });

    socket.on('ai_reset', ({ chatId } = {}) => {
      const key = (typeof chatId === 'string' && chatId) ? chatId : socket.id;
      editorSessions.delete(key);
      socket.emit('ai_update', { type: 'reset_done' });
    });

    // AI 主持（GM）
    socket.on('ai_gm_chat', ({ roomId, text }) => {
      const session = sessions.get(roomId);
      if (!session || session.hostSocketId !== socket.id) return;
      if (typeof text !== 'string' || !text.trim()) return;
      runGmAgent(roomId, text);
    });

    // 中斷進行中的 GM 任務
    socket.on('ai_gm_stop', ({ roomId }) => {
      const session = sessions.get(roomId);
      if (!session || session.hostSocketId !== socket.id) return;
      const gm = gmSessions.get(roomId);
      if (!gm || !gm.busy) return;
      gm.abortRequested = true;
      try { gm._abortCtl?.abort(); } catch {}
      console.log(`[AI-GM] 使用者中斷 GM 任務: ${roomId}`);
    });

    socket.on('ai_gm_toggle', ({ roomId, enabled }) => {
      const session = sessions.get(roomId);
      if (!session || session.hostSocketId !== socket.id) return;
      const gm = getGmSession(roomId);
      gm.autoPilot = !!enabled;
      session.aiObserver = gm.autoPilot ? makeObserver(roomId) : null;
      console.log(`[AI-GM] 房間 ${roomId} 自動主持: ${gm.autoPilot ? 'ON' : 'OFF'}`);
      session.sendToHost('ai_gm_update', { type: 'autopilot', enabled: gm.autoPilot });
      if (gm.autoPilot && gm.messages.length === 0) {
        runGmAgent(roomId, '你剛接手這個房間的自動主持。get_game_state 看一下現況，然後用一句話跟真人主持人打個招呼。');
      }
    });

  });

  // 定期回收：關閉的房間 GM 對話 + 閒置超過 TTL 的編輯器對話
  setInterval(() => {
    for (const roomId of gmSessions.keys()) {
      if (!sessions.has(roomId)) gmSessions.delete(roomId);
    }
    const now = Date.now();
    for (const [key, ed] of editorSessions) {
      if (!ed.busy && ed.lastActive && now - ed.lastActive > EDITOR_SESSION_TTL) editorSessions.delete(key);
    }
  }, 60000).unref();

  const cfg = loadConfig();
  console.log(`🤖 AI 核心已載入：${cfg.apiKey ? `model=${cfg.model}` : '⚠️ 未設定 API key（server/ai/ai-config.json）'}`);
}

module.exports = { attach };

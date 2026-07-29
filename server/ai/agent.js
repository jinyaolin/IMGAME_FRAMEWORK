'use strict';

// Agent 迴圈：對話 → 模型 → 工具呼叫 → 回填結果 → 直到產出最終回覆
const { chat } = require('./llm');

const MAX_TOOL_ROUNDS = 120;  // 多檔案大型程式任務需要較多輪（計畫→逐檔寫入→測試）
const WRAPUP_MARGIN = 10;     // 剩這麼多輪時注入一次「收尾存檔」提示，給 Kimi 跑道 checkpoint（B 方案）
// 收尾提示：快到上限時推進歷史，讓 Kimi 先把進度存下來再收工，而非被硬砍整包遺失
const WRAPUP_PROMPT = `[系統] ⚠️ 工具回合快用完了（大約再 ${WRAPUP_MARGIN} 輪就會被強制中止）。請立刻收尾，不要再開新的大型工作或大改：\n1. 先用 save_module 把目前進度存檔（即使還不完美也要存，避免整包遺失）。\n2. 做一次必要的最小驗證（存檔本身已含 validateManifest）。\n3. 直接給我最終總結：已完成什麼、還差什麼、下一步該做什麼（我可以之後說「繼續」接著做）。`;
const MAX_HISTORY_MESSAGES = 120;
const MAX_TOOL_RESULT_CHARS = 20000;
const COMPACT_THRESHOLD = 150000;  // 歷史 JSON 總字元數超過此值 → 自動壓縮
const COMPACT_KEEP_TAIL = 10;      // 壓縮時保留最近幾則原文

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + `\n…（已截斷，共 ${str.length} 字）` : str;
}

// 舊回合的思考內容（reasoning_content）只在當回合的工具鏈中有用，
// 跨回合保留只會讓每次請求膨脹 — 新回合開始時剝除
function stripOldReasoning(session) {
  for (const m of session.messages) {
    if (m.role === 'assistant' && m.reasoning_content) delete m.reasoning_content;
  }
}

// 防禦：確保每個 assistant.tool_calls 都有對應的 tool 結果訊息。
// 孤兒 tool_call（結果因序列化例外/中斷沒接上）會被 Kimi API 400 拒絕、卡死整個對話。
// 歷史有孤兒就自動補合成結果 → 自癒。每輪發 API 前呼叫。
function sanitizeHistory(session) {
  const msgs = session.messages;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const have = new Set();
      for (let j = i + 1; j < msgs.length && msgs[j].role === 'tool'; j++) have.add(msgs[j].tool_call_id);
      const missing = m.tool_calls.filter(tc => tc.id && !have.has(tc.id));
      if (missing.length) {
        const inject = missing.map(tc => ({ role: 'tool', tool_call_id: tc.id, content: '{"recovered":"此工具結果在歷史中遺失（可能是序列化例外或中斷），已補合成結果維持對話一致。請依需要重新呼叫。"}' }));
        msgs.splice(i + 1, 0, ...inject);   // 緊接該 assistant 補上
        i += inject.length;                  // 跳過剛插入的
      }
    }
  }
}

// 對話壓縮（/compact 或超過門檻自動觸發）：舊對話 → LLM 摘要成工作備忘錄，保留最近原文
async function compactSession(session, emit, { force = false } = {}) {
  stripOldReasoning(session);
  const size = JSON.stringify(session.messages).length;
  if (!force && size < COMPACT_THRESHOLD) return false;
  if (session.messages.length < 6) return false;
  emit({ type: 'status', message: `🗜 對話記憶 ${Math.round(size / 1000)}K 字，壓縮中…` });

  // 保留尾端最近對話，邊界必須落在 user 訊息上（避免孤兒 tool 結果）
  let keepFrom = Math.max(session.messages.length - COMPACT_KEEP_TAIL, 1);
  while (keepFrom > 0 && session.messages[keepFrom]?.role !== 'user') keepFrom--;
  if (keepFrom < 2) return false;

  const lines = session.messages.slice(0, keepFrom).map(m => {
    if (m.role === 'user') {
      const c = typeof m.content === 'string' ? m.content : '（含截圖的訊息）';
      return '[設計師] ' + c.slice(0, 2000);
    }
    if (m.role === 'assistant') {
      let s = '[Kimi] ' + String(m.content || '').slice(0, 2000);
      if (m.tool_calls) s += ' [呼叫: ' + m.tool_calls.map(t => t.function?.name).join(', ') + ']';
      return s;
    }
    if (m.role === 'tool') return '[工具結果] ' + String(m.content || '').slice(0, 500);
    return '';
  }).filter(Boolean).join('\n');

  try {
    const res = await chat([
      { role: 'system', content: '你是工作對話壓縮器。把對話壓成 600 字內的工作備忘錄，必須保留：設計師的需求與偏好、已完成事項、目前模組與檔案結構、關鍵決策及原因、尚未解決的問題與 TODO。省略過程細節與寒暄。' },
      { role: 'user', content: lines.slice(0, 250000) },
    ], null);
    const summary = (res.message.content || '').trim();
    if (!summary) return false;
    session.messages = [
      { role: 'user', content: '[對話壓縮摘要 — 之前工作的備忘錄]\n' + summary },
      { role: 'assistant', content: '收到，我已掌握之前的脈絡，繼續工作。' },
      ...session.messages.slice(keepFrom),
    ];
    emit({ type: 'status', message: '🗜 記憶壓縮完成（工作備忘錄 + 最近對話）' });
    return true;
  } catch (e) {
    emit({ type: 'status', message: '（記憶壓縮失敗：' + e.message + '，維持原狀）' });
    return false;
  }
}

// session: { messages: [] }（不含 system）；emit(evt) 把進度推給 UI
// 中斷：外部把 session.abortRequested 設 true 並 abort session._abortCtl → 立即停止
async function runAgent({ session, systemPrompt, userText, toolDefs, runTool, toolCtx, emit }) {
  session.abortRequested = false;
  const finishAborted = () => {
    emit({ type: 'assistant', text: '⏹ 已依你的要求中斷。已完成的變更（存檔的檔案）都保留著，可以直接下新指令。' });
    emit({ type: 'done' });
  };

  await compactSession(session, emit);   // 超過門檻時自動壓縮（含剝除舊 reasoning）
  session.messages.push({ role: 'user', content: userText });

  let wrapupInjected = false;   // B：接近上限時只提醒一次
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (session.abortRequested) return finishAborted();

    // B：快到工具回合上限 → 注入一次「收尾存檔」提示，讓 Kimi 有跑道把進度存下來
    // 再收工，而不是做到一半被硬砍、整包心血遺失。（放在發 API 前，模型下一輪就會看到）
    if (!wrapupInjected && MAX_TOOL_ROUNDS - round <= WRAPUP_MARGIN) {
      wrapupInjected = true;
      session.messages.push({ role: 'user', content: WRAPUP_PROMPT });
      emit({ type: 'progress', message: '⚠️ 接近工具回合上限，提醒 Kimi 先存檔收尾…' });
    }
    // 裁掉太舊的歷史（保留最近 N 則），避免無限膨脹
    if (session.messages.length > MAX_HISTORY_MESSAGES) {
      session.messages = session.messages.slice(-MAX_HISTORY_MESSAGES);
      // 開頭必須是 user 訊息，且不能以孤兒 tool 結果開頭
      while (session.messages.length && session.messages[0].role !== 'user') session.messages.shift();
    }
    sanitizeHistory(session);   // 孤兒 tool_call 補合成結果（防 API 400 卡死對話）

    const messages = [{ role: 'system', content: systemPrompt }, ...session.messages];

    // 生成期間的即時進度（節流 1.2s）：思考片段 / 正在草擬哪個工具 / 撰寫回覆
    let lastProg = 0;
    const onProgress = (p) => {
      const now = Date.now();
      if (now - lastProg < 1200) return;
      lastProg = now;
      let message;
      if (p.kind === 'thinking') {
        const tail = (p.tail || '').replace(/\s+/g, ' ').trim().slice(-42);
        message = `🧠 思考中…${tail ? '「' + tail + '」' : ''}`;
      } else if (p.kind === 'tool_building') {
        message = `${TOOL_VERBS[p.name] || '🔧 準備 ' + (p.name || '工具')}中…（${p.chars} 字）`;
      } else {
        message = `✍️ 撰寫回覆中…（${p.chars} 字）`;
      }
      emit({ type: 'progress', message });
    };

    let result;
    session._abortCtl = new AbortController();
    try {
      result = await chat(messages, toolDefs, onProgress, session._abortCtl.signal);
    } catch (e) {
      if (e.name === 'UserAbort' || session.abortRequested) return finishAborted();
      emit({ type: 'error', message: e.message });
      // 失敗時把這輪 user 訊息留在歷史，使用者可以重試
      return;
    } finally {
      session._abortCtl = null;
    }

    const msg = result.message;
    // 原樣保留（含 reasoning_content / tool_calls），Kimi 多輪工具鏈需要
    session.messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length) {
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name;
        // 已要求中斷 → 剩餘工具不執行，補合成結果保持歷史一致（tool_calls 必須有對應 tool 訊息）
        if (session.abortRequested) {
          session.messages.push({ role: 'tool', tool_call_id: tc.id, content: '{"aborted":"使用者中斷，此工具未執行"}' });
          continue;
        }
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* 壞參數照樣執行，工具會回錯 */ }
        // tool_start 的 label/args 失敗也不能中斷(否則 tool 結果沒接上 → 歷史孤兒)
        let startLabel = name, startArgs = {};
        try { startLabel = toolLabel(name, args); startArgs = summarizeArgs(name, args); } catch {}
        try { emit({ type: 'tool_start', name, label: startLabel, args: startArgs }); } catch {}
        let toolResult;
        try {
          toolResult = await runTool(name, args, toolCtx);
        } catch (e) {
          toolResult = { error: e.message };
        }
        // 截圖（run_visual_test）：從工具結果抽出，改以 vision 訊息附上
        let images = null;
        try {
          if (toolResult && Array.isArray(toolResult._images)) { images = toolResult._images; delete toolResult._images; }
        } catch {}

        // ★ 先確保歷史一致：tool 結果必須推進去(每個 tool_call 都要有對應 tool 訊息,否則 Kimi API 400)。
        // 序列化失敗(循環參考/特殊型別)用摘要替代,絕不跳過 push。emit/圖片放在 push 之後(非關鍵)。
        let resultStr;
        try { resultStr = truncate(JSON.stringify(toolResult ?? null), MAX_TOOL_RESULT_CHARS); }
        catch { resultStr = '{"error":"工具結果無法序列化（循環參考或特殊型別），已省略明細"}'; }
        session.messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });

        try { emit({ type: 'tool_done', name, label: startLabel, ok: !(toolResult && toolResult.error), brief: briefResult(name, toolResult) }); } catch {}
        try { if (name === 'submit_plan') emit({ type: 'plan', plan: args }); } catch {}

        if (images && images.length) {
          try {
            // 舊截圖從歷史汰換成文字佔位（避免每輪請求都重送大量 base64）
            for (const msg of session.messages) {
              if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.some(p => p.type === 'image_url')) {
                msg.content = [{ type: 'text', text: '[舊的視覺測試截圖已移除，只保留最新一組]' }];
              }
            }
            const caption = toolResult.timepoints
              ? `[系統] 視覺測試截圖（時間點：${toolResult.timepoints.join(' / ')}）。請逐張仔細檢視：畫面有沒有全黑/物件位置/文字/配色是否正確，並回報你實際看到什麼。`
              : `[系統] 附上圖片，請仔細檢視內容並據此判斷／回報。`;
            session.messages.push({
              role: 'user',
              content: [
                { type: 'text', text: caption },
                ...images.map(b64 => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } })),
              ],
            });
            emit({ type: 'screenshots', images: images.map(b64 => 'data:image/jpeg;base64,' + b64) });
          } catch (e) { /* 截圖附加失敗不影響對話歷史(工具結果已在上一步推入) */ }
        }
      }
      if (session.abortRequested) return finishAborted();
      continue; // 回到模型，讓它看工具結果
    }

    // 沒有工具呼叫 → 最終回覆
    const text = (msg.content || '').trim() || '（完成）';
    emit({ type: 'assistant', text });
    emit({ type: 'done' });
    return;
  }

  emit({ type: 'error', message: `工具呼叫超過 ${MAX_TOOL_ROUNDS} 輪上限，已中止。剛剛已提醒它先存檔，進度多半已保存在模組裡；可直接說「繼續」接著做，或把需求拆小一點再試。` });
}

// 工具動作 → 白話中文（tool_building 串流用動詞、tool_start/done 用完整描述）
const TOOL_VERBS = {
  save_module: '💾 草擬模組設定', save_engine_code: '⚙️ 撰寫引擎程式',
  write_game_file: '📝 撰寫程式檔案', submit_plan: '📋 規劃工作流程',
  edit_game_file: '✏️ 修改程式檔案',
};

function toolLabel(name, args = {}) {
  switch (name) {
    case 'list_modules':      return '📚 瀏覽模組清單';
    case 'get_module':        return `📖 讀取模組 ${args.id || ''}`;
    case 'save_module':       return `💾 儲存模組 ${args.id || ''}`;
    case 'clone_module':      return `📦 複製模組 ${args.sourceId || ''} → ${args.newId || ''}`;
    case 'list_global_decks': return '🎴 瀏覽全域牌組';
    case 'get_global_deck':   return `🎴 讀取牌組 ${args.id || ''}`;
    case 'get_engine_code':   return `⚙️ 讀取引擎 ${args.id || ''}/server.js`;
    case 'save_engine_code':  return `⚙️ 寫入引擎 ${args.id || ''}/server.js`;
    case 'run_playtest':      return `🧪 模擬測試 ${args.moduleId || ''}（${args.playerCount || 4} 位機器人）`;
    case 'submit_plan':       return '📋 規劃工作流程';
    case 'list_game_files':   return `📁 瀏覽 ${args.moduleId || ''} 的程式檔案`;
    case 'read_game_file':    return `📖 讀取檔案 ${args.name || ''}`;
    case 'write_game_file':   return `📝 寫入檔案 ${args.name || ''}`;
    case 'edit_game_file':    return `✏️ 修改檔案 ${args.name || ''}`;
    case 'delete_game_file':  return `🗑 刪除檔案 ${args.name || ''}`;
    case 'read_game_logs':    return `🔍 讀取遊戲 log（${args.moduleId || ''}）`;
    case 'run_visual_test':   return `📸 視覺測試 ${args.moduleId || ''}（無頭瀏覽器截圖）`;
    case 'generate_characters': return `🎭 生成童話角色素材`;
    case 'read_module_notes':  return `📓 讀取模組筆記 ${args.moduleId || ''}`;
    case 'write_module_notes': return `📓 更新模組筆記 ${args.moduleId || ''}`;
    case 'list_assets':        return '🖼 瀏覽素材庫';
    case 'move_asset':         return `🗂 整理素材 ${args.from || ''} → ${args.to || ''}`;
    case 'delete_asset':       return `🗑 刪除素材 ${args.path || ''}`;
    case 'process_asset':      return `✂️ 加工素材 ${args.src || ''}`;
    case 'get_game_state':    return '👀 查看遊戲狀態';
    case 'host_action':       return `🎬 執行主持操作 ${args.action || ''}`;
    default:                  return `⚙️ ${name}`;
  }
}

// 給 UI 看的工具參數摘要（避免把整份 manifest 塞進聊天視窗）
function summarizeArgs(name, args) {
  if (name === 'save_module') return { id: args.id, manifest: `（${JSON.stringify(args.manifest || {}).length} 字）` };
  if (name === 'save_engine_code') return { id: args.id, code: `（${(args.code || '').length} 字）` };
  if (name === 'write_game_file') return { moduleId: args.moduleId, name: args.name, target: args.target, code: `（${(args.code || '').length} 字）` };
  if (name === 'write_module_notes') return { moduleId: args.moduleId, content: `（${(args.content || '').length} 字）` };
  if (name === 'submit_plan') return { goal: args.goal, steps: `（${(args.steps || []).length} 步）` };
  return args;
}

function briefResult(name, r) {
  if (!r) return '';
  if (r.error) return String(r.error).slice(0, 200);
  if (name === 'save_module') return r.ok ? `已儲存 ${r.id}` : `驗證失敗 ${(r.errors || []).length} 項`;
  if (name === 'write_game_file') return r.ok ? `已寫入 ${r.name}（${r.chars} 字）` : `驗證失敗`;
  if (name === 'edit_game_file') return r.ok ? `已修改 ${r.name}（${r.replaced} 處）` : '';
  if (name === 'delete_game_file') return r.ok ? `已刪除 ${r.deleted}` : '';
  if (name === 'read_game_logs') return r.count != null ? `${r.count} 筆` : '';
  if (name === 'run_visual_test') return r.ok ? `${(r.timepoints || []).length} 張截圖${r.harnessErrors?.length ? '，' + r.harnessErrors.length + ' 個執行錯誤' : ''}` : '';
  if (name === 'generate_characters') return r.ok ? `${(r.saved || []).length} 個角色` : '';
  if (name === 'run_playtest') return r.ok ? `通過（${r.elapsedSeconds}s，強制推進 ${r.forcedAdvances} 次）` : `失敗: ${r.error || ''}`.slice(0, 200);
  if (name === 'host_action') return r.ok ? `已執行 ${r.executed}` : '';
  return '';
}

module.exports = { runAgent, compactSession };

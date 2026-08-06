'use strict';

// AI 工具集：編輯器工具（讀寫模組）與 GM 工具（控制遊戲進行）
const fs = require('fs');
const path = require('path');
const { runPlaytest } = require('./playtest');

function isValidModuleId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(id);
}

const fn = (name, description, parameters) => ({
  type: 'function',
  function: { name, description, parameters },
});

function createTools(deps) {
  const { moduleLoader, sessions, validateManifest, atomicWriteJSON, io, modulesDir, decksDir, port, assetsRoot, modVisible, filterModules } = deps;
  // 可見性 fallback(deps 未提供時 = 全可見,維持舊行為)
  const canSee = modVisible || (() => true);
  const seeList = filterModules || ((list) => list);

  // 素材路徑安全檢查（允許多層目錄與中文，擋 .. 與絕對路徑）
  const safeAsset = (rel) => {
    if (typeof rel !== 'string' || !rel.trim()) return null;
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (clean.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return null;
    if (!/^[\w\-./一-鿿（）()]+$/.test(clean)) return null;
    return path.join(assetsRoot, clean);
  };
  const assetRel = (abs) => path.relative(assetsRoot, abs).replace(/\\/g, '/');

  const notifyHostsModulesUpdated = () => {
    const updatedList = moduleLoader.listModules();
    for (const session of sessions.values()) {
      if (session.hostSocketId) io.to(session.hostSocketId).emit('modules_updated', { modules: seeList(updatedList, session.ownerUserId) });
    }
  };

  const saveManifest = (id, manifest, uid) => {
    if (!isValidModuleId(id)) return { ok: false, errors: [{ path: 'id', msg: '模組 ID 格式錯誤（英數/底線/連字號，1-40 字）' }] };
    const next = { ...manifest, id };
    const moduleDir = path.join(modulesDir, id);
    const manifestPath = path.join(moduleDir, 'manifest.json');
    // 作者記錄:新模組寫入建立者;既有模組以磁碟值為準(與 REST 路徑同規則,AI 也不能改作者)
    let diskCreatedBy = null;
    if (fs.existsSync(manifestPath)) {
      try { diskCreatedBy = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).createdBy || null; } catch {}
      if (diskCreatedBy) next.createdBy = diskCreatedBy; else delete next.createdBy;
    } else if (uid && uid !== 'local') {
      next.createdBy = uid;
    } else {
      delete next.createdBy;
    }
    const errors = validateManifest(next);
    if (errors.length) return { ok: false, errors };
    if (!fs.existsSync(moduleDir)) fs.mkdirSync(moduleDir, { recursive: true });
    atomicWriteJSON(manifestPath, next);
    moduleLoader._scanModules();
    notifyHostsModulesUpdated();
    console.log(`[AI] 模組已儲存: ${id}`);
    return { ok: true, id, name: next.name };
  };

  // ── 編輯器工具 ─────────────────────────────────────────────
  const editorDefs = [
    fn('list_modules', '列出伺服器上所有遊戲模組（id、名稱、人數）', { type: 'object', properties: {} }),
    fn('get_module', '讀取一個模組的完整 manifest', {
      type: 'object', properties: { id: { type: 'string', description: '模組 ID' } }, required: ['id'],
    }),
    fn('save_module', '儲存（全量覆寫）模組的 manifest。會自動驗證，回傳 errors 時請修正後重存。id 不存在時等同建立新模組。', {
      type: 'object',
      properties: {
        id: { type: 'string', description: '模組 ID' },
        manifest: { type: 'object', description: '完整 manifest 物件（會覆寫整份檔案）' },
      },
      required: ['id', 'manifest'],
    }),
    fn('clone_module', '複製現有模組為新模組（自動掛 engine 共用引擎，不複製 server.js）', {
      type: 'object',
      properties: {
        sourceId: { type: 'string' },
        newId: { type: 'string', description: '新模組 ID（英數/底線/連字號）' },
        newName: { type: 'string', description: '新模組顯示名稱' },
      },
      required: ['sourceId', 'newId', 'newName'],
    }),
    fn('list_global_decks', '列出全域共用牌組（供 manifest 以 {ref} 引用）', { type: 'object', properties: {} }),
    fn('get_global_deck', '讀取一副全域牌組的完整卡牌內容', {
      type: 'object', properties: { id: { type: 'string' } }, required: ['id'],
    }),
    fn('get_engine_code', '讀取模組的自訂引擎 server.js（不存在則回報使用 BaseModule）', {
      type: 'object', properties: { id: { type: 'string' } }, required: ['id'],
    }),
    fn('save_engine_code', '儲存模組的自訂引擎 server.js（需繼承 BaseModule；僅在 manifest 做不到時使用）', {
      type: 'object',
      properties: { id: { type: 'string' }, code: { type: 'string', description: '完整 server.js 內容' } },
      required: ['id', 'code'],
    }),
    fn('run_playtest', '用機器人玩家實際跑一輪遊戲（無頭模擬），回傳事件時間軸。重大修改後務必執行。機器人會自動：抽身份/出牌/投票、select 階段選角按確定、NetKit 即時遊戲送隨機移動+按鍵輸入（時間軸含快照摘要，可看實體有沒有動）。', {
      type: 'object',
      properties: {
        moduleId: { type: 'string' },
        playerCount: { type: 'number', description: '機器人數量（預設 4）' },
        maxSeconds: { type: 'number', description: '最長等待秒數（預設 60）' },
      },
      required: ['moduleId'],
    }),
    fn('submit_plan', '執行任何非小型的程式任務前，先提交執行計畫給設計師看（會顯示成卡片）。步驟或檔案結構有變時也用它更新。', {
      type: 'object',
      properties: {
        goal:  { type: 'string', description: '一句話目標' },
        steps: { type: 'array', items: { type: 'string' }, description: '依序的執行步驟' },
        files: { type: 'array', items: { type: 'string' }, description: '預計的程式檔案清單（如 shared/track.js、mobile/car.js）' },
      },
      required: ['goal', 'steps'],
    }),
    fn('list_game_files', '列出某 game 階段的遊戲程式檔案（名稱、執行端、大小），不含程式內容', {
      type: 'object',
      properties: {
        moduleId: { type: 'string' },
        stageId: { type: 'string', description: '階段 id；省略 = 第一個 game 階段' },
      },
      required: ['moduleId'],
    }),
    fn('read_game_file', '讀取一個遊戲程式檔案的內容', {
      type: 'object',
      properties: {
        moduleId: { type: 'string' },
        stageId: { type: 'string', description: '省略 = 第一個 game 階段' },
        name: { type: 'string', description: '檔名；也接受舊格式 gameCode / mobileCode' },
      },
      required: ['moduleId', 'name'],
    }),
    fn('write_game_file', '建立或覆寫「單一」遊戲程式檔案（自動語法檢查與驗證）。大型程式請逐檔寫入，不要把整包塞進 save_module。', {
      type: 'object',
      properties: {
        moduleId: { type: 'string' },
        stageId: { type: 'string', description: '省略 = 第一個 game 階段' },
        name: { type: 'string', description: '檔名（NetKit 建議 shared/config、sim/game、render/game；舊式建議 display/xx.js、mobile/xx.js）' },
        target: { type: 'string', enum: ['shared', 'display', 'mobile', 'sim', 'render'], description: '執行端（新檔必填）。即時遊戲用 NetKit：sim=主機權威邏輯、render=手機+大螢幕共用畫面、shared=共用常數。非即時的舊式為 display / mobile。' },
        code: { type: 'string', description: '完整檔案內容' },
      },
      required: ['moduleId', 'name', 'code'],
    }),
    fn('delete_game_file', '刪除一個遊戲程式檔案', {
      type: 'object',
      properties: {
        moduleId: { type: 'string' },
        stageId: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['moduleId', 'name'],
    }),
    fn('edit_game_file', '局部修改遊戲程式檔案（精確字串替換）— 修 bug、調參數的「首選」，比整檔重寫快很多。old_string 必須與檔案內容逐字一致（含縮排與換行）且唯一；不唯一時加更多上下文，或設 replace_all。', {
      type: 'object',
      properties: {
        moduleId: { type: 'string' },
        stageId: { type: 'string', description: '省略 = 第一個 game 階段' },
        name: { type: 'string', description: '檔名；也接受舊格式 gameCode / mobileCode' },
        old_string: { type: 'string', description: '要被取代的原文（逐字一致，含縮排）' },
        new_string: { type: 'string', description: '替換後的內容' },
        replace_all: { type: 'boolean', description: '取代所有出現處（預設 false = 必須唯一）' },
      },
      required: ['moduleId', 'name', 'old_string', 'new_string'],
    }),
    fn('read_game_logs', '讀取遊戲執行 log（display / 手機 / 編輯器預覽回報的 GameAPI.log 與自動捕捉的執行錯誤）。debug 的重要依據 — 沒 log 時請設計師先用預覽或實機重現一次。', {
      type: 'object',
      properties: {
        moduleId: { type: 'string' },
        limit: { type: 'number', description: '最近幾筆（預設 120）' },
        clear: { type: 'boolean', description: '讀取後清空（重測前建議 true）' },
      },
      required: ['moduleId'],
    }),
    fn('read_module_notes', '讀取模組的長期筆記（KIMI.md）：設計決策、已知問題、TODO。接手不熟的模組時先讀。（目前選取模組的筆記會自動附在對話開頭，不必重複讀）', {
      type: 'object',
      properties: { moduleId: { type: 'string' } },
      required: ['moduleId'],
    }),
    fn('write_module_notes', '覆寫模組的長期筆記（KIMI.md）。完成重要工作後，把「設計決策與原因、檔案結構說明、已知問題、TODO」精簡記下 — 之後任何對話（即使重開）都會看到。不要記 manifest 本身就看得出來的東西。', {
      type: 'object',
      properties: {
        moduleId: { type: 'string' },
        content: { type: 'string', description: '完整筆記內容（Markdown，覆寫整份，上限 24000 字）' },
      },
      required: ['moduleId', 'content'],
    }),
    fn('list_assets', '列出素材庫（public/uploads/assets，含多層目錄）：設計師上傳的圖片/音效。遊戲程式直接用 url 引用。', {
      type: 'object', properties: {},
    }),
    fn('move_asset', '移動/改名素材（可移進新目錄，目錄自動建立）。用來把素材整理成清楚的結構，例如 racing/cars/red.png。', {
      type: 'object',
      properties: {
        from: { type: 'string', description: '目前相對路徑（如 abc.png）' },
        to:   { type: 'string', description: '新相對路徑（如 racing/cars/red.png）' },
      },
      required: ['from', 'to'],
    }),
    fn('delete_asset', '刪除一個素材檔案', {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    }),
    fn('process_asset', '加工圖片素材（裁切→縮放，輸出 PNG 保留透明度）成適合遊戲用的尺寸，例如大照片 → 256px sprite。輸出路徑可含新目錄。', {
      type: 'object',
      properties: {
        src: { type: 'string', description: '來源素材相對路徑' },
        out: { type: 'string', description: '輸出相對路徑（省略 = 原名加 -edit.png）' },
        crop: { type: 'object', description: '先裁切（來源像素座標）', properties: {
          x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } },
        resize: { type: 'object', description: '再縮放（等比，不放大）', properties: {
          maxWidth: { type: 'number' }, maxHeight: { type: 'number' } } },
      },
      required: ['src'],
    }),
    fn('generate_characters', '生成「可愛低多邊形童話角色」素材：每個渲成透明去背 sprite PNG 存進素材庫，並回傳一張標籤預覽總表讓你檢視挑選。角色種類：knight(騎士)/witch(女巫)/fairy(仙子)/prince(王子)/princess(公主)/wizard(巫師)/elf(精靈)/dwarf(矮人)/frog(青蛙王子)/hood(小紅帽)/robin(俠盜)/troll(巨怪)。同一個 role+seed 永遠得到同一個角色。💡 若是 three.js 3D 遊戲，通常「不用」存 PNG，直接在 gameCode 裡 LowPoly.character({role,seed}) 即時生成可動角色更好用。', {
      type: 'object',
      properties: {
        count: { type: 'number', description: '隨機生成幾個（1-12），與 characters 二選一' },
        roles: { type: 'array', items: { type: 'string' }, description: '隨機時限定的角色種類（省略=全部）' },
        characters: { type: 'array', description: '指定角色與 seed（可重現）', items: { type: 'object', properties: {
          role: { type: 'string' }, seed: { type: 'number' } } } },
        dir: { type: 'string', description: '存到素材庫的子目錄（預設 characters）' },
      },
    }),
    fn('run_visual_test', '在伺服器的無頭瀏覽器「真正執行」遊戲畫面（display + 模擬手機、隨機輸入），拍三張截圖讓你「親眼檢視」渲染結果，並收集 console 錯誤。黑畫面、位置錯誤、圖層蓋住等視覺 bug 靠這個抓。寫完/改完遊戲程式後建議都跑一次。', {
      type: 'object',
      properties: {
        moduleId: { type: 'string' },
        stageId: { type: 'string', description: '省略 = 第一個 game 階段' },
        players: { type: 'number', description: '模擬玩家數（預設 3）' },
        seconds: { type: 'number', description: '觀察秒數 3-15（預設 6，截圖取 1s/中點/結尾）' },
      },
      required: ['moduleId'],
    }),
  ];

  // 在 stages（含 loop children）中找階段；stageId 省略時找第一個 game 階段
  const findGameStage = (stages, stageId) => {
    for (const s of stages || []) {
      if (stageId ? s.id === stageId : s.type === 'game') return s;
      const hit = findGameStage(s.children || s.stages, stageId);
      if (hit) return hit;
    }
    return null;
  };

  const loadManifestFor = (moduleId) => {
    const p = path.join(modulesDir, moduleId, 'manifest.json');
    if (!isValidModuleId(moduleId) || !fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  };

  async function runEditorTool(name, args, ctx) {
    const uid = ctx && ctx.userId;
    switch (name) {
      case 'list_modules':
        return seeList(moduleLoader.listModules(), uid);
      case 'get_module': {
        const p = path.join(modulesDir, args.id, 'manifest.json');
        if (!isValidModuleId(args.id) || !fs.existsSync(p)) return { error: `模組 ${args.id} 不存在` };
        const m = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!canSee(m, uid)) return { error: `模組 ${args.id} 尚未開放` };
        return m;
      }
      case 'save_module':
        return saveManifest(args.id, args.manifest, uid);
      case 'clone_module': {
        const { sourceId, newId, newName } = args;
        const srcPath = path.join(modulesDir, sourceId, 'manifest.json');
        if (!fs.existsSync(srcPath)) return { error: `來源模組 ${sourceId} 不存在` };
        if (!isValidModuleId(newId)) return { error: '新模組 ID 格式錯誤' };
        if (fs.existsSync(path.join(modulesDir, newId))) return { error: `模組 ${newId} 已存在` };
        const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
        if (!canSee(src, uid)) return { error: `模組 ${sourceId} 尚未開放` };
        const engine = src.engine || (fs.existsSync(path.join(modulesDir, sourceId, 'server.js')) ? sourceId : undefined);
        const cloned = { ...src, id: newId, name: newName, ...(engine ? { engine } : {}) };
        delete cloned.published;   // clone 是新草稿:published 不繼承(saveManifest 會記 clone 者為作者)
        delete cloned.createdBy;
        const result = saveManifest(newId, cloned, uid);
        // 長期筆記跟著複製（衍生模組通常繼承來源的設計脈絡）
        const notesSrc = path.join(modulesDir, sourceId, 'KIMI.md');
        if (result.ok && fs.existsSync(notesSrc)) {
          try { fs.copyFileSync(notesSrc, path.join(modulesDir, newId, 'KIMI.md')); } catch {}
        }
        return result;
      }
      case 'list_global_decks': {
        if (!fs.existsSync(decksDir)) return [];
        return fs.readdirSync(decksDir).filter(f => f.endsWith('.json')).map(f => {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(decksDir, f), 'utf8'));
            return { id: d.id || f.replace(/\.json$/, ''), name: d.name, cardCount: (d.cards || []).length };
          } catch { return { id: f, error: '讀取失敗' }; }
        });
      }
      case 'get_global_deck': {
        const p = path.join(decksDir, `${args.id}.json`);
        if (!/^[a-z0-9_-]+$/i.test(args.id || '') || !fs.existsSync(p)) return { error: `全域牌組 ${args.id} 不存在` };
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
      case 'get_engine_code': {
        const p = path.join(modulesDir, args.id, 'server.js');
        if (!isValidModuleId(args.id)) return { error: '模組 ID 格式錯誤' };
        if (!fs.existsSync(p)) return { info: '此模組沒有自訂 server.js，使用 BaseModule 通用引擎' };
        return { code: fs.readFileSync(p, 'utf8') };
      }
      case 'save_engine_code': {
        if (!isValidModuleId(args.id)) return { error: '模組 ID 格式錯誤' };
        const dir = path.join(modulesDir, args.id);
        if (!fs.existsSync(dir)) return { error: `模組 ${args.id} 不存在，請先建立 manifest` };
        if (typeof args.code !== 'string' || !args.code.includes('BaseModule')) {
          return { error: 'server.js 必須繼承 BaseModule（require ../../core/BaseModule）' };
        }
        fs.writeFileSync(path.join(dir, 'server.js'), args.code);
        moduleLoader._scanModules();
        console.log(`[AI] 引擎已儲存: ${args.id}/server.js`);
        return { ok: true };
      }
      case 'run_playtest': {
        const count = Math.min(Math.max(Number(args.playerCount) || 4, 1), 8);
        const maxSeconds = Math.min(Math.max(Number(args.maxSeconds) || 60, 15), 120);
        return await runPlaytest({ moduleId: args.moduleId, playerCount: count, port, basePath: deps.base || '', maxSeconds });
      }
      case 'submit_plan':
        return { ok: true, note: '計畫已顯示給設計師。開始逐步執行，每完成一步簡短回報。' };
      case 'list_game_files': {
        const m = loadManifestFor(args.moduleId);
        if (!m) return { error: `模組 ${args.moduleId} 不存在` };
        const stage = findGameStage(m.stages, args.stageId);
        if (!stage) return { error: args.stageId ? `找不到階段 ${args.stageId}` : '此模組沒有 game 階段' };
        const gc = stage.gameConfig || {};
        return {
          stageId: stage.id,
          layout: gc.layout, library: gc.library,
          files: (gc.files || []).map(f => ({ name: f.name, target: f.target, chars: (f.code || '').length })),
          legacy: {
            gameCode: (gc.gameCode || '').length || undefined,
            mobileCode: (gc.mobileCode || '').length || undefined,
          },
        };
      }
      case 'read_game_file': {
        const m = loadManifestFor(args.moduleId);
        if (!m) return { error: `模組 ${args.moduleId} 不存在` };
        const stage = findGameStage(m.stages, args.stageId);
        if (!stage) return { error: '找不到 game 階段' };
        const gc = stage.gameConfig || {};
        if (args.name === 'gameCode' || args.name === 'mobileCode') {
          return gc[args.name] ? { name: args.name, code: gc[args.name] } : { error: `舊格式欄位 ${args.name} 是空的` };
        }
        const f = (gc.files || []).find(f => f.name === args.name);
        return f ? { name: f.name, target: f.target, code: f.code } : { error: `檔案 ${args.name} 不存在` };
      }
      case 'write_game_file': {
        const m = loadManifestFor(args.moduleId);
        if (!m) return { error: `模組 ${args.moduleId} 不存在` };
        const stage = findGameStage(m.stages, args.stageId);
        if (!stage) return { error: '找不到 game 階段（先用 save_module 建好階段）' };
        stage.gameConfig = stage.gameConfig || {};
        const gc = stage.gameConfig;
        if (args.name === 'gameCode' || args.name === 'mobileCode') {
          gc[args.name] = args.code;   // 舊格式相容
        } else {
          gc.files = gc.files || [];
          const existing = gc.files.find(f => f.name === args.name);
          if (existing) {
            existing.code = args.code;
            if (args.target) existing.target = args.target;
          } else {
            if (!['shared', 'display', 'mobile', 'sim', 'render'].includes(args.target)) {
              return { error: '新檔案必須指定 target（NetKit：sim / render / shared；舊式：display / mobile）' };
            }
            gc.files.push({ name: args.name, target: args.target, code: args.code });
          }
        }
        const result = saveManifest(args.moduleId, m);
        return result.ok ? { ok: true, name: args.name, chars: args.code.length } : result;
      }
      case 'delete_game_file': {
        const m = loadManifestFor(args.moduleId);
        if (!m) return { error: `模組 ${args.moduleId} 不存在` };
        const stage = findGameStage(m.stages, args.stageId);
        if (!stage?.gameConfig?.files) return { error: '找不到檔案' };
        const before = stage.gameConfig.files.length;
        stage.gameConfig.files = stage.gameConfig.files.filter(f => f.name !== args.name);
        if (stage.gameConfig.files.length === before) return { error: `檔案 ${args.name} 不存在` };
        const result = saveManifest(args.moduleId, m);
        return result.ok ? { ok: true, deleted: args.name } : result;
      }
      case 'edit_game_file': {
        const m = loadManifestFor(args.moduleId);
        if (!m) return { error: `模組 ${args.moduleId} 不存在` };
        const stage = findGameStage(m.stages, args.stageId);
        if (!stage) return { error: '找不到 game 階段' };
        const gc = stage.gameConfig || {};
        const isLegacy = args.name === 'gameCode' || args.name === 'mobileCode';
        const file = isLegacy ? null : (gc.files || []).find(f => f.name === args.name);
        const code = isLegacy ? gc[args.name] : file?.code;
        if (typeof code !== 'string') return { error: `檔案 ${args.name} 不存在` };
        const { old_string: oldStr, new_string: newStr } = args;
        if (!oldStr) return { error: 'old_string 不可為空' };
        if (oldStr === newStr) return { error: 'old_string 與 new_string 相同' };
        const count = code.split(oldStr).length - 1;
        if (count === 0) return { error: '找不到 old_string — 必須與檔案內容逐字一致（含縮排與換行）。先 read_game_file 確認原文。' };
        if (count > 1 && !args.replace_all) return { error: `old_string 出現 ${count} 次，不唯一 — 加入更多上下文，或設 replace_all: true` };
        const newCode = args.replace_all ? code.split(oldStr).join(newStr) : code.replace(oldStr, newStr);
        if (isLegacy) gc[args.name] = newCode;
        else file.code = newCode;
        const result = saveManifest(args.moduleId, m);
        return result.ok ? { ok: true, name: args.name, replaced: count, chars: newCode.length } : result;
      }
      case 'read_module_notes': {
        if (!isValidModuleId(args.moduleId)) return { error: '模組 ID 格式錯誤' };
        const p = path.join(modulesDir, args.moduleId, 'KIMI.md');
        if (!fs.existsSync(p)) return { info: '此模組尚無筆記（KIMI.md）' };
        return { content: fs.readFileSync(p, 'utf8').slice(0, 24000) };
      }
      case 'write_module_notes': {
        if (!isValidModuleId(args.moduleId)) return { error: '模組 ID 格式錯誤' };
        const dir = path.join(modulesDir, args.moduleId);
        if (!fs.existsSync(dir)) return { error: `模組 ${args.moduleId} 不存在` };
        if (typeof args.content !== 'string') return { error: 'content 必須是字串' };
        fs.writeFileSync(path.join(dir, 'KIMI.md'), args.content.slice(0, 24000));
        console.log(`[AI] 筆記已更新: ${args.moduleId}/KIMI.md`);
        return { ok: true, chars: Math.min(args.content.length, 24000) };
      }
      case 'list_assets': {
        const walk = (dir, out = []) => {
          if (!fs.existsSync(dir) || out.length >= 300) return out;
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full, out);
            else if (out.length < 300) out.push({
              path: assetRel(full),
              url: '/uploads/assets/' + assetRel(full),
              sizeKB: Math.round(fs.statSync(full).size / 1024),
            });
          }
          return out;
        };
        const files = walk(assetsRoot);
        return files.length ? { count: files.length, files } : { count: 0, note: '素材庫是空的 — 請設計師用聊天框的 📎 按鈕上傳' };
      }
      case 'move_asset': {
        const from = safeAsset(args.from), to = safeAsset(args.to);
        if (!from || !to) return { error: '路徑不合法（不可含 ..，僅限英數/中文/-_./）' };
        if (!fs.existsSync(from)) return { error: `素材 ${args.from} 不存在` };
        if (fs.existsSync(to)) return { error: `目標 ${args.to} 已存在` };
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        return { ok: true, from: args.from, to: assetRel(to), url: '/uploads/assets/' + assetRel(to) };
      }
      case 'delete_asset': {
        const p = safeAsset(args.path);
        if (!p) return { error: '路徑不合法' };
        if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return { error: `素材 ${args.path} 不存在` };
        fs.unlinkSync(p);
        return { ok: true, deleted: args.path };
      }
      case 'process_asset': {
        const src = safeAsset(args.src);
        if (!src || !fs.existsSync(src)) return { error: `素材 ${args.src} 不存在` };
        const outRel = args.out || args.src.replace(/\.[^.]+$/, '') + '-edit.png';
        const out = safeAsset(outRel);
        if (!out) return { error: '輸出路徑不合法' };
        const { transformImage } = require('./assets');
        try {
          const r = await transformImage({
            srcUrl: `http://127.0.0.1:${port}/uploads/assets/${assetRel(src)}`,
            crop: args.crop, resize: args.resize,
          });
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, Buffer.from(r.dataUrl.split(',')[1], 'base64'));
          return { ok: true, path: assetRel(out), url: '/uploads/assets/' + assetRel(out), width: r.width, height: r.height };
        } catch (e) {
          return { error: '加工失敗: ' + e.message };
        }
      }
      case 'generate_characters': {
        const ROLES = ['knight', 'witch', 'fairy', 'prince', 'princess', 'wizard', 'elf', 'dwarf', 'frog', 'hood', 'robin', 'troll'];
        let specs = [];
        if (Array.isArray(args.characters) && args.characters.length) {
          specs = args.characters
            .filter(c => c && ROLES.includes(c.role))
            .map(c => ({ role: c.role, seed: (c.seed == null ? Math.floor(Math.random() * 100000) : c.seed | 0) }))
            .slice(0, 12);
        } else {
          const pool = (Array.isArray(args.roles) && args.roles.length ? args.roles.filter(r => ROLES.includes(r)) : ROLES);
          if (!pool.length) return { error: 'roles 沒有有效的角色種類' };
          const n = Math.min(Math.max(Number(args.count) || 6, 1), 12);
          for (let i = 0; i < n; i++) specs.push({ role: pool[Math.floor(Math.random() * pool.length)], seed: Math.floor(Math.random() * 100000) });
        }
        if (!specs.length) return { error: '沒有有效的角色規格（role 需在支援清單內）' };
        const { renderCharacters } = require('./charactergen');
        const r = await renderCharacters({ specs, port, basePath: deps.base || '' });
        if (!r.ok) return r;
        const dir = (typeof args.dir === 'string' && args.dir.trim()) ? args.dir.trim() : 'characters';
        const saved = [];
        for (const s of r.sprites) {
          const rel = `${dir}/${s.role}-${s.seed}.png`;
          const target = safeAsset(rel);
          if (!target) continue;
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, Buffer.from(s.dataUrl.split(',')[1], 'base64'));
          saved.push({ path: rel, url: '/uploads/assets/' + rel, role: s.role, roleName: s.roleName, seed: s.seed });
        }
        return {
          ok: true,
          note: '角色已生成並存進素材庫（透明去背 PNG），預覽總表已附上。3D 遊戲建議改在 gameCode 用 LowPoly.character({role,seed}) 即時生成可動角色（同 role+seed = 同角色）。',
          saved,
          _images: [r.gallery.split(',')[1]],
        };
      }
      case 'run_visual_test': {
        const { runVisualTest } = require('./visualtest');
        return await runVisualTest({ ...args, port, basePath: deps.base || '' });
      }
      case 'read_game_logs': {
        const gameLogs = require('./gamelogs');
        if (!isValidModuleId(args.moduleId)) return { error: '模組 ID 格式錯誤' };
        const logs = gameLogs.getLogs(args.moduleId, args.limit || 120);
        if (args.clear) gameLogs.clearLogs(args.moduleId);
        if (!logs.length) return { count: 0, note: '目前沒有 log。GameAPI.log() 的輸出與執行錯誤會在「編輯器預覽」或「實機遊玩」時自動回報 — 請設計師先重現一次問題。' };
        const lines = logs.map(e => `${new Date(e.ts).toISOString().slice(11, 19)} [${e.src}]${e.level === 'error' ? ' ❌' : ''} ${e.msg}`);
        return { count: logs.length, cleared: !!args.clear, logs: lines };
      }
      default:
        return { error: `未知工具: ${name}` };
    }
  }

  // ── GM 工具（綁定房間）─────────────────────────────────────
  const GM_ACTIONS = ['advance_identity', 'next_round', 'force_reveal', 'next_stage', 'end_vote', 'end_game', 'restart', 'back_to_lobby'];
  const gmDefs = [
    fn('get_game_state', '取得目前房間的遊戲狀態（階段、玩家、可用操作、共享參數）', { type: 'object', properties: {} }),
    fn('host_action', '執行主持人操作推進遊戲。action 必須在 get_game_state 的 availableActions 內。', {
      type: 'object',
      properties: { action: { type: 'string', enum: GM_ACTIONS } },
      required: ['action'],
    }),
  ];

  async function runGmTool(name, args, ctx) {
    const session = sessions.get(ctx.roomId);
    if (!session) return { error: `房間 ${ctx.roomId} 不存在（可能已關閉）` };
    switch (name) {
      case 'get_game_state': {
        const summary = session.toSummary();
        const hostState = session.currentModule?.getHostState ? session.currentModule.getHostState() : null;
        return { ...summary, hostState, sharedState: session.sharedState };
      }
      case 'host_action': {
        if (!GM_ACTIONS.includes(args.action)) return { error: `不允許的 action: ${args.action}` };
        if (!session.currentModule) return { error: '遊戲尚未開始，沒有可推進的階段' };
        console.log(`[AI-GM] 房間 ${ctx.roomId} 執行: ${args.action}`);
        await session.handleHostNextPhase({ action: args.action });
        session.sendHostGameState();
        return { ok: true, executed: args.action };
      }
      default:
        return { error: `未知工具: ${name}` };
    }
  }

  return { editorDefs, runEditorTool, gmDefs, runGmTool };
}

module.exports = { createTools };

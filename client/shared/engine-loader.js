// ── Phase 2:在瀏覽器載入 Node 版核心引擎(不需打包工具)──
// 三個 CommonJS 檔(PlayerManager / BaseModule / GameSession)以文字 fetch 進來,用 new Function 包成
// (module, exports, require) 執行 —— 一個極小的 CommonJS loader。require 只解析:
//   'fs'/'path' → 瀏覽器 shim(fs 永不被呼叫,因為 deck 走注入的 session.deckLoader);
//   './PlayerManager' → 已載入的 exports。
// 回傳 { GameSession, BaseModule, PlayerManager, PlayerState }。與伺服器完全同一份原始碼,無漂移。
(function (global) {
  'use strict';

  const PATH_SHIM = { join: function () { return Array.prototype.slice.call(arguments).join('/'); } };
  const FS_SHIM = {
    readFileSync: function () { throw new Error('[engine] fs 在瀏覽器不可用 —— 請注入 session.deckLoader 提供牌組'); },
    existsSync: function () { return false; },
  };

  async function loadGameEngine(base) {
    base = (base != null) ? base : (global.IMGAME_BASE || '');
    const cache = {};   // moduleKey → { exports }

    function requireFor() {
      return function req(id) {
        if (id === 'fs') return FS_SHIM;
        if (id === 'path') return PATH_SHIM;
        const key = id.replace(/^\.\//, '');
        if (cache[key]) return cache[key].exports;
        throw new Error('[engine] require 未預載:' + id);
      };
    }

    async function load(name) {
      if (cache[name]) return cache[name].exports;
      const res = await fetch(base + '/engine/' + name + '.js', { cache: 'no-store' });
      if (!res.ok) throw new Error('[engine] 取不到 ' + name + '.js:HTTP ' + res.status);
      const text = await res.text();
      const module = { exports: {} };
      cache[name] = module;
      // sourceURL 讓 devtools 可除錯到正確檔名
      const fn = new Function('module', 'exports', 'require', text + '\n//# sourceURL=engine/' + name + '.js');
      // 載入中拋錯 → 刪掉快取佔位,避免留下空 exports 讓後續 require 誤拿到 {}(NetKit 選配時的優雅降級關鍵)
      try { fn(module, module.exports, requireFor()); } catch (e) { delete cache[name]; throw e; }
      return module.exports;
    }

    // 依賴順序:PlayerManager 先(GameSession 依賴它);NetKitHost 先於 BaseModule(BaseModule require 它)。
    // NetKitHost 需 window.NetSim(host 頁預先以 <script> 載 netcore.js/netsim.js);未載則其 require 拋錯 →
    // 這裡容錯:NetKit 載不起來就跳過(BaseModule 的 require 已改為 try/catch,會優雅降級為舊路徑)。
    await load('PlayerManager');
    try { await load('NetKitHost'); } catch (e) { console.warn('[engine] NetKitHost 未載(缺 window.NetSim?):', e && e.message); }
    const BaseModule = await load('BaseModule');
    const GameSession = await load('GameSession');
    const pm = cache['PlayerManager'].exports;
    return { GameSession: GameSession, BaseModule: BaseModule, PlayerManager: pm.PlayerManager, PlayerState: pm.PlayerState };
  }

  global.loadGameEngine = loadGameEngine;
})(typeof window !== 'undefined' ? window : this);

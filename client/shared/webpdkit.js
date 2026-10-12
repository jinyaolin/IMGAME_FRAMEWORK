// WebPdKit —— 把學生的 Pure Data patch 接進遊戲的那層包裝
//
// 為什麼要包一層(跟 netphys.js 同樣的理由):WebPd 的執行期 API 是
//   webpdNode.port.postMessage({ type:'io:messageReceiver', payload:{ nodeId:'n_0_13', portletId:'0', message:[60] } })
// nodeId 是編譯器指派的不透明字串,每次改 patch 都可能變,而且送到沒宣告的 nodeId
// 會在 AudioWorklet 裡直接 throw。遊戲作者不該碰這些 —— 這裡用伺服器編譯時產出的
// 「名字 → nodeId」對應表,對外只提供以名字為準的 PD.send('hit', [60])。
//
// ⚠ Pd 的方向跟直覺相反:
//   patch 裡的 [s 名字] = 遊戲「送訊息進去」的入口(不用接任何線)
//   patch 裡的 [r 名字] = patch「通知遊戲」的出口
//
// AudioContext 一定要惰性建立並等使用者手勢:手機的 autoplay policy 會讓
// 提早建立的 context 停在 suspended,而且不會自己醒過來。

(function (global) {
  'use strict';

  const isPd = (name) => typeof name === 'string' && name.trim().toLowerCase().endsWith('.pd');

  /** 這一端(display / mobile)要載哪些 .pd:target 是自己或 shared */
  function pdFilesFor(cfg, target) {
    return (cfg && Array.isArray(cfg.files) ? cfg.files : [])
      .filter((f) => f && isPd(f.name) && (f.target === 'shared' || f.target === target))
      .map((f) => f.name);
  }

  function hasPd(cfg, target) {
    return pdFilesFor(cfg, target).length > 0;
  }

  let runtimeLoading = null;
  function loadRuntime(url) {
    if (global.WebPdRuntime) return Promise.resolve(true);
    if (runtimeLoading) return runtimeLoading;
    runtimeLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => resolve(!!global.WebPdRuntime);
      s.onerror = () => { console.error('[PD] webpd-runtime 載不起來:', url); resolve(false); };
      document.head.appendChild(s);
    });
    return runtimeLoading;
  }

  /**
   * 啟動這一端的所有 patch。
   * opts: { moduleId, cfg, target, apiBase, runtimeUrl, log, destination? }
   * destination 可以把輸出導到別的節點(測試時掛 analyser 量波形;日後要錄音或做總線也從這裡接)。
   * 回傳 Promise<PD|null> —— 沒有 .pd、或全部編譯失敗時回 null(遊戲照跑,只是沒聲音)。
   */
  async function boot(opts) {
    const { moduleId, cfg, target } = opts;
    const log = opts.log || function () {};
    const wanted = pdFilesFor(cfg, target);
    if (!wanted.length) return null;

    // 1. 問伺服器編譯狀態 + 拿名字對應表
    let payload;
    try {
      const res = await fetch(`${opts.apiBase}/api/modules/${encodeURIComponent(moduleId)}/pd`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      payload = await res.json();
    } catch (e) {
      log('error', '拿不到聲音 patch 的編譯狀態:' + e.message);
      return null;
    }

    const mine = (payload.patches || []).filter((p) => wanted.indexOf(p.name) >= 0);
    const usable = mine.filter((p) => p.status === 'ok' && p.wasmUrl);

    // 把伺服器端的診斷搬到遊戲的 log(作者/學生在編輯器就看得到)
    mine.forEach((p) => {
      if (p.status === 'pending') log('log', `[PD] ${p.name} 還在編譯,這一輪沒有聲音(稍後重開關卡即可)`);
      else if (p.status !== 'ok') (p.hints || ['編譯失敗']).forEach((h) => log('error', `[PD] ${p.name}:${h}`));
      (p.warnings || []).forEach((w) => log('log', `[PD] ${p.name} 提醒:${w}`));
    });
    if (!usable.length) return null;

    if (!(await loadRuntime(opts.runtimeUrl))) return null;
    const RT = global.WebPdRuntime;

    // 2. AudioContext(惰性 + 等手勢)
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { log('error', '[PD] 這個瀏覽器沒有 Web Audio'); return null; }
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(opts.destination || ctx.destination);
    await RT.initialize(ctx);

    // 3. 逐個載入 patch,建立雙向名字對應
    const inRoutes = {};     // 名字 → [{ node, nodeId, portletId }]
    const outNames = {};     // "patchIdx:nodeId:portletId" → 名字
    const handlers = {};     // 名字 → [cb]
    const nodes = [];

    for (let i = 0; i < usable.length; i++) {
      const p = usable[i];
      try {
        const buf = await (await fetch(p.wasmUrl, { cache: 'force-cache' })).arrayBuffer();
        const node = await RT.run(ctx, buf, RT.defaultSettingsForRun(p.wasmUrl, (nodeId, portletId, message) => {
          const name = outNames[i + ':' + nodeId + ':' + portletId];
          if (!name) return;
          (handlers[name] || []).forEach((cb) => { try { cb(message); } catch (e) { log('error', `[PD] on('${name}') 出錯:` + e.message); } });
        }));
        node.connect(master);
        nodes.push(node);
        Object.keys((p.io && p.io.in) || {}).forEach((name) => {
          const [nodeId, portletId] = p.io.in[name];
          (inRoutes[name] = inRoutes[name] || []).push({ node, nodeId, portletId });
        });
        Object.keys((p.io && p.io.out) || {}).forEach((name) => {
          const [nodeId, portletId] = p.io.out[name];
          outNames[i + ':' + nodeId + ':' + portletId] = name;
        });
        log('log', `[PD] ${p.name} 已載入(可呼叫:${Object.keys((p.io && p.io.in) || {}).join(', ') || '無'})`);
      } catch (e) {
        log('error', `[PD] ${p.name} 載入失敗:${e.message}`);
      }
    }
    if (!nodes.length) { try { ctx.close(); } catch (e) {} return null; }

    // 4. 手勢解鎖。display 在 iframe 裡常常拿不到使用者啟用,所以文件層級攔一次就好。
    let unlockBound = false;
    const tryResume = () => ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : Promise.resolve();
    const bindUnlock = () => {
      if (unlockBound || ctx.state !== 'suspended') return;
      unlockBound = true;
      const once = () => { tryResume(); off(); };
      const off = () => ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => document.removeEventListener(ev, once, true));
      ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, once, true));
    };
    await tryResume();
    bindUnlock();
    if (ctx.state === 'suspended') log('log', '[PD] 聲音等使用者點一下才會開始(瀏覽器的 autoplay 限制)');

    // ⚠ AudioWorklet 裡的引擎是「非同步」建立的(worklet 收到 code:WASM 後才 createEngine),
    // 而 worklet **不會回報就緒**。在那之前送進去的訊息會在 worklet 內部 throw 然後無聲消失 ——
    // 症狀是「遊戲一開場的第一個音效莫名其妙不見了」,極難追。
    // 所以開場的 send 一律排進佇列,閘門開了才依序送出(只是延後,不會掉)。
    // 閘門值:這台桌機實測 20ms 就緒,但學生的手機 wasm 實例化可能慢十倍以上,所以給足餘裕。
    // 關卡剛開始延後 0.4 秒聽不出來,掉一個音效卻會讓人以為功能壞了。
    const READY_GATE_MS = 400;
    let engineReady = false;
    const pending = [];
    const deliver = (name, message) => {
      inRoutes[name].forEach((r) => {
        try {
          r.node.port.postMessage({ type: 'io:messageReceiver', payload: { nodeId: r.nodeId, portletId: r.portletId, message } });
        } catch (e) { log('error', `[PD] send('${name}') 失敗:` + e.message); }
      });
    };
    const readyPromise = new Promise((resolve) => setTimeout(() => {
      engineReady = true;
      while (pending.length) { const [n, m] = pending.shift(); deliver(n, m); }
      resolve(PD);
    }, READY_GATE_MS));

    let disposed = false;
    const PD = {
      /** 送訊息給 patch 裡的 [s 名字]。args 是數字/字串陣列,送 bang 用 ['bang'] 或不給。 */
      send(name, args) {
        if (disposed) return false;
        const routes = inRoutes[name];
        if (!routes) { log('error', `[PD] send('${name}') 沒有對應的 [s ${name}] —— 這個 patch 的入口有:${Object.keys(inRoutes).join(', ') || '無'}`); return false; }
        const message = (args === undefined || args === null) ? ['bang']
          : (Array.isArray(args) ? args : [args]);
        if (ctx.state === 'suspended') { tryResume(); bindUnlock(); }
        if (!engineReady) { pending.push([name, message]); return true; }
        deliver(name, message);
        return true;
      },
      /** 想確定引擎真的開始跑了再動作時 await 它(一般不需要:send 會自己排隊) */
      get ready() { return readyPromise; },
      /** 聽 patch 裡的 [r 名字] 發出來的訊息 */
      on(name, cb) {
        if (typeof cb !== 'function') return;
        (handlers[name] = handlers[name] || []).push(cb);
      },
      /** 主音量 0..1 */
      volume(v) {
        if (disposed) return;
        const g = Math.max(0, Math.min(1, Number(v)));
        if (!isNaN(g)) master.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
      },
      get names() { return { in: Object.keys(inRoutes), out: Object.values(outNames) }; },
      get suspended() { return ctx.state === 'suspended'; },
      get ctx() { return ctx; },
      resume: tryResume,
      /** 關卡結束時由框架呼叫 —— 作者不需要自己寫 */
      dispose() {
        if (disposed) return;
        disposed = true;
        pending.length = 0;          // 關卡已切走,還沒送出的音效不要再送
        nodes.forEach((n) => { try { n.port.postMessage({ type: 'destroy' }); } catch (e) {} try { n.disconnect(); } catch (e) {} });
        try { master.disconnect(); } catch (e) {}
        try { ctx.close(); } catch (e) {}
      },
    };
    return PD;
  }

  const api = { boot, hasPd, pdFilesFor, isPdFileName: isPd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.WebPdKit = api;
})(typeof window !== 'undefined' ? window : globalThis);

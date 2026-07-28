// ============================================================
// NetKit — 伺服器端權威 sim 執行器。把遊戲的 sim 程式(manifest gameConfig.files
// 內 target:'shared'|'sim')組合起來在 Node 跑,定頻 tick,經 session 廣播 net_snapshot。
// 伺服器時鐘穩定、不受瀏覽器背景節流 → 最穩的權威來源。SimHost 程式與瀏覽器 Worker 版相同,
// 日後要搬到 host 瀏覽器(P2P)可整段移植。
// ============================================================
// netsim 取得:Node 走 require(檔案路徑);瀏覽器 engine-loader 沒有 __dirname/檔案系統,
// 改用 host 頁預先以 <script> 載入的 window.NetSim。兩邊同一份 SimHost 邏輯。
let NetSim = null;
try { const path = require('path'); NetSim = require(path.join(__dirname, '../../client/shared/netsim.js')); }
catch (e) { NetSim = (typeof window !== 'undefined' && window.NetSim) || (typeof globalThis !== 'undefined' && globalThis.NetSim) || null; }
if (!NetSim) throw new Error('[NetKit] netsim 不可用(Node 需檔案、瀏覽器需先載 netsim.js)');

function simFiles(gameConfig) {
  const files = (gameConfig && gameConfig.files) || [];
  return files.filter(f => f && (f.target === 'shared' || f.target === 'sim'));
}
function hasSim(gameConfig) { return (gameConfig && gameConfig.files || []).some(f => f && f.target === 'sim'); }
function composeSim(gameConfig) {
  return simFiles(gameConfig).map(f => `// ═══ ${f.name || 'file'} ═══\n${f.code || ''}`).join('\n\n');
}

class NetKitHost {
  constructor(session, stage) {
    this.session = session;
    const code = composeSim(stage.gameConfig);
    // 先驗證 sim 能編譯 + 有 step/snapshot(Worker 版也靠這裡擋掉壞碼)
    const test = {}; (new Function('Sim', code))(test);
    if (typeof test.step !== 'function' || typeof test.snapshot !== 'function') throw new Error('NetKit sim 缺少 step/snapshot');
    const seed = (Math.floor(Date.now() / 1000) >>> 0);
    const bcast = (pkt) => { session.broadcastPlayers('net_snapshot', pkt); session.broadcastDisplay('net_snapshot', pkt); };

    // 每位玩家的公開資訊 + 參數(playerAttributes)一併帶進 sim.init 的 world → sim 可用前面 stage 寫入的參數
    // (如選角階段的 role/seed)。通用:框架只轉發,由各遊戲 sim 決定怎麼用。快照於遊戲階段開始時取,參數已定案。
    const pinfo = {};
    for (const p of session.players.all()) pinfo[String(p.id)] = { attrs: p.attributes || {}, name: p.name, num: p.playerNumber };
    const world = { seed, players: pinfo };

    // 瀏覽器(P2P host)→ 把 sim 丟進 Web Worker 背景執行緒,主執行緒(算大螢幕 + WebRTC)才不被搶 → 大螢幕順。
    // Node → 沒有 window/Worker,直接主執行緒跑(伺服器沒在算圖,無競爭)。?sw=0 可關掉 Worker 做 A/B。
    const useWorker = (typeof window !== 'undefined') && (typeof Worker !== 'undefined') && !window.__noSimWorker;
    if (useWorker) {
      const base = (window.IMGAME_BASE || '');
      this._worker = new Worker(base + '/shared/netsim-worker.js');
      this._worker.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'snap') bcast(m.pkt);
        else if (m.type === 'err') console.error('[NetKit] worker:', m.msg);
      };
      this._worker.onerror = (err) => console.error('[NetKit] worker onerror:', err && err.message);
      this._worker.postMessage({ type: 'init', simCode: code, dt: 1 / 60, netEvery: 2, world: world, players: session.players.all().map(p => String(p.id)) });
      console.log('[NetKit] host sim in Web Worker; players=' + session.players.count());
      return;
    }

    // 主執行緒 SimHost(Node,或瀏覽器 ?sw=0)
    const Sim = {}; (new Function('Sim', code))(Sim);
    this.host = new NetSim.SimHost({ sim: Sim, dt: 1 / 60, netEvery: 2, now: () => Date.now(), send: bcast, world: world });
    for (const p of session.players.all()) this.host.join(p.id);
    this._last = Date.now();
    this._timer = setInterval(() => {
      const now = Date.now(); let dt = (now - this._last) / 1000; this._last = now;
      if (dt > 0.1) dt = 0.1;
      try { this.host.advance(dt); } catch (e) { console.error('[NetKit] step error:', e && e.message); }
    }, 1000 / 60);
    console.log('[NetKit] host sim started (main thread); players=' + session.players.count());
  }
  input(pid, input) { if (this._worker) this._worker.postMessage({ type: 'input', pid: String(pid), input }); else if (this.host) { try { this.host.input(pid, input); } catch (e) {} } }
  join(pid) { if (this._worker) this._worker.postMessage({ type: 'join', pid: String(pid) }); else if (this.host) { try { this.host.join(pid); } catch (e) {} } }
  leave(pid) { if (this._worker) this._worker.postMessage({ type: 'leave', pid: String(pid) }); else if (this.host) { try { this.host.leave(pid); } catch (e) {} } }
  dispose() {
    if (this._worker) { try { this._worker.postMessage({ type: 'stop' }); this._worker.terminate(); } catch (e) {} this._worker = null; }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    console.log('[NetKit] host sim stopped');
  }
}

module.exports = { NetKitHost, hasSim, composeSim };

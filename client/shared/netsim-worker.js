// ============================================================
// NetKit — 權威 sim 的 Web Worker 宿主。把「跑物理 + 打包快照」放到背景執行緒,
// 讓 host 主執行緒(算大螢幕的圖 + WebRTC)不被模擬搶 CPU → 大螢幕順。
// 主頁(NetKitHost 瀏覽器路徑)用 postMessage 對接:
//   → init {simCode, dt, netEvery, world, players}   建 sim + 開 60Hz 迴圈
//   → input {pid, input} / join {pid} / leave {pid}
//   ← snap {pkt}   每次打包好的快照(主頁負責廣播)
// ============================================================
/* eslint-env worker */
importScripts('netcore.js', 'netsim.js');   // 相對 worker 位置 → /…/shared/netcore.js, netsim.js

let simHost = null, timer = null;

self.onmessage = function (e) {
  const m = e.data || {};
  if (m.type === 'init') {
    try {
      const Sim = {};
      (new Function('Sim', m.simCode))(Sim);
      if (typeof Sim.step !== 'function' || typeof Sim.snapshot !== 'function') { self.postMessage({ type: 'err', msg: 'sim 缺 step/snapshot' }); return; }
      simHost = new self.NetSim.SimHost({
        sim: Sim, dt: m.dt || (1 / 60), netEvery: m.netEvery || 2, now: () => Date.now(),
        world: m.world || {},
        send: (pkt) => self.postMessage({ type: 'snap', pkt: pkt }),
      });
      for (const pid of (m.players || [])) simHost.join(pid);
      let last = Date.now();
      timer = setInterval(() => {
        const now = Date.now(); let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1;
        try { simHost.advance(dt); } catch (err) { self.postMessage({ type: 'err', msg: 'step: ' + (err && err.message) }); }
      }, 1000 / 60);
      self.postMessage({ type: 'ready' });
    } catch (err) { self.postMessage({ type: 'err', msg: 'init: ' + (err && err.message) }); }
  } else if (m.type === 'input') { if (simHost) simHost.input(m.pid, m.input); }
  else if (m.type === 'join') { if (simHost) simHost.join(m.pid); }
  else if (m.type === 'leave') { if (simHost) simHost.leave(m.pid); }
  else if (m.type === 'stop') { if (timer) { clearInterval(timer); timer = null; } }
};

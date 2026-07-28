// ============================================================
// NetKit — HOST 端模擬迴圈(權威)。純 JS,無 DOM → 瀏覽器 Worker 與 node 測試共用。
// 固定時間步進 sim,定頻打包 snapshot 經 transport 廣播;離散事件由 sim.emit 排入下個快照。
//
// 一個遊戲的 sim 模組(target:'sim')需提供:
//   init(world)         初始化世界(可選)
//   spawn(pid)/despawn(pid)  玩家加入/離開 → 建/刪實體(可選)
//   input(pid, input)   收到某玩家最新輸入(可選)
//   step(dt)            以固定 dt(秒)推進權威狀態(必要)
//   snapshot()          回傳 { ents:{id:{p:[..],s:{..}}}, world:{..} }(必要)
//   sim.emit(type,data,{to})  ← 由框架注入,排入離散事件
//
// 迴圈驅動注入(advance(realDtSec)):瀏覽器由 Worker 計時器呼叫(不受背景分頁節流),
// node 測試由 harness 以確定性步長呼叫 → 同一份 sim 兩邊行為一致。
// ============================================================
(function (root) {
  'use strict';
  const NetCore = (typeof require !== 'undefined') ? require('./netcore.js')
    : (root.NetCore || (typeof window !== 'undefined' && window.NetCore));

  function SimHost(opts) {
    opts = opts || {};
    this.sim = opts.sim;
    this.dt = opts.dt || (1 / 30);              // 固定 sim 步長(秒)
    this.netEvery = opts.netEvery || 2;         // 每 N 個 sim step 打包一次(30Hz/2 = 15Hz 網路)
    this.maxCatchup = opts.maxCatchup || 6;     // 單次 advance 最多補幾步(防螺旋)
    this.host = new NetCore.NetHost({ now: opts.now });
    this.send = opts.send || function () {};    // (packet) => 廣播給所有 client
    this._acc = 0; this._steps = 0;
    this._simMs = 0;                             // 累積 sim 時間(ms,固定步進 → 規律)→ 快照 t,client 以此內插(免疫送達抖動)
    this._ack = {};                              // pid -> 最近消化的 input seq(給該玩家 client 端預測對帳)
    const self = this;
    this.sim.emit = function (type, data, o) { self.host.emit(type, data, o); };  // sim 事件 → host
    if (this.sim.init) this.sim.init(opts.world || {});
  }
  SimHost.prototype.input = function (pid, input) {
    pid = String(pid);
    if (input && input.seq != null) this._ack[pid] = input.seq;   // 記錄 ack(client 對帳用)
    if (this.sim.input) this.sim.input(pid, input);
  };
  SimHost.prototype.join = function (pid) { if (this.sim.spawn) this.sim.spawn(String(pid)); };
  SimHost.prototype.leave = function (pid) { if (this.sim.despawn) this.sim.despawn(String(pid)); };
  // realDtSec:自上次呼叫的真實經過秒數。固定步進 + 累加器 → 網路/幀率無關的確定性。
  SimHost.prototype.advance = function (realDtSec) {
    this._acc += realDtSec;
    let n = 0;
    while (this._acc >= this.dt && n < this.maxCatchup) {
      this.sim.step(this.dt);
      this._acc -= this.dt; this._steps++; n++; this._simMs += this.dt * 1000;   // 規律 sim 時鐘
      if (this._steps % this.netEvery === 0) this._pack();
    }
    if (n === this.maxCatchup) this._acc = 0;   // 落後太多:丟棄積欠,不追死
  };
  SimHost.prototype._pack = function () {
    const snap = this.sim.snapshot() || { ents: {}, world: {} };
    // 為每個實體注入 ack(該玩家最近被消化的 input seq)→ client 端預測用它丟棄已確認輸入
    if (snap.ents) for (const id in snap.ents) { if (this._ack[id] != null) { (snap.ents[id].s = snap.ents[id].s || {}).ack = this._ack[id]; } }
    this.send(this.host.pack(snap, this._simMs));   // t = 規律 sim 時間 → client server-time 內插
  };
  SimHost.prototype.forcePack = function () { this._pack(); };

  const NetSim = { SimHost: SimHost };
  if (typeof module !== 'undefined' && module.exports) module.exports = NetSim;
  if (typeof window !== 'undefined') window.NetSim = NetSim;
  else if (typeof globalThis !== 'undefined') globalThis.NetSim = NetSim;
})(typeof globalThis !== 'undefined' ? globalThis : this);

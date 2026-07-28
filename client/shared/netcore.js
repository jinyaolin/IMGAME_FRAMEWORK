// ============================================================
// NetKit — 純 JS 同步核心(host-authoritative)。無 DOM/THREE 依賴 →
// 瀏覽器與 node 測試跑同一份碼。這是整個即時同步框架唯一的插值/事件/交握實作。
//
// 契約:
//   HOST 端跑權威模擬,定頻產生 snapshot 廣播給所有 client。
//   CLIENT(手機/大螢幕)只收 snapshot,由 NetClient 做「實體插值」——
//   在 now−delay 時刻於兩個「真實」快照間線性內插,永不外推 → 結構上不可能過衝/瞬移。
//   離散事件走獨立的可靠通道(eseq 去重、依序),絕不與連續狀態混用。
//
// snapshot 格式(host→client):
//   { seq:int, t:number, ents:{ [id]:{ p:[..數值..], s:{..離散狀態..} } },
//     world:{..離散全域..}, evts:[ {eseq:int, type, data, to} ] }
//   p = 連續向量(位置等)→ 內插;s = 離散狀態(anim/hp/dir)→ 階梯(取 ≤rt 的最新)。
// ============================================================
(function (root) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // 兩個等長數值向量線性內插(長度不齊時以較短者為準,容忍缺欄位)
  function lerpVec(A, B, u) {
    const n = Math.min(A.length, B.length);
    const out = new Array(A.length);
    for (let i = 0; i < A.length; i++) out[i] = i < n ? A[i] + (B[i] - A[i]) * u : A[i];
    return out;
  }

  // 由到達時間緩衝 buf(遞增排序的 {at,p,s})取 rt 時刻的內插狀態。
  // 永不外推:rt 超過最新 → 停最新;rt 早於最舊 → 停最舊。
  function interpFromBuffer(buf, rt) {
    if (!buf.length) return null;
    let a = null, b = null;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].st <= rt) { a = buf[i]; b = buf[i + 1] || null; break; }   // st = 時間鍵(server 時間;無則退回送達時間)
    }
    if (a && b) {
      const u = clamp((rt - a.st) / ((b.st - a.st) || 1), 0, 1);
      return { p: lerpVec(a.p, b.p, u), s: a.s };   // 離散狀態用 ≤rt 的那格,跨越 b 才切
    }
    if (a) return { p: a.p.slice(), s: a.s };        // 緩衝用盡:停最新真實點
    return { p: buf[0].p.slice(), s: buf[0].s };     // rt 比最舊還舊:停最舊
  }

  // ---------------- CLIENT ----------------
  // 收 snapshot → 每個 render frame 呼叫 sample() 取「已內插」的實體集。
  // 遊戲程式永遠只讀 sample() 的結果,絕不碰原始快照,也不自己寫插值。
  function NetClient(opts) {
    opts = opts || {};
    this.now = opts.now || (typeof performance !== 'undefined' ? function () { return performance.now(); } : Date.now);
    this.delay = opts.delay != null ? opts.delay : 100;   // ms 渲染延遲(≥ 送出間隔 + 抖動)
    this.maxBuf = opts.maxBuf || 120;
    this.onEvent = opts.onEvent || null;         // (ev) => {}
    this.onEntityAdd = opts.onEntityAdd || null; // (id, st) => {}
    this.onEntityRemove = opts.onEntityRemove || null; // (id) => {}
    this.removeGrace = opts.removeGrace != null ? opts.removeGrace : 700; // ms:host 完全停送後多久收掉
    this.selfId = opts.selfId || null;
    this._ents = new Map();      // id -> { buf:[{at,st,p,s}], present, lastAt, lastSt }
    this._world = {};
    this._seq = -1;
    this._lastEseq = 0;
    this._pending = [];          // 待派發事件
    this._visible = new Set();   // 目前 sample 可見的 id(add/remove 判斷)
    // server-time 播放時鐘:內插用「快照的規律 server 時間」而非「送達時間」→ 免疫送達抖動(跑步不再抖/回彈)。
    this._useServerTime = false;
    this._latestSt = null;
    this._playT = null;          // 目前播放到的 server 時間
    this._lastNow = null;
  }
  NetClient.prototype.pushSnapshot = function (snap) {
    if (!snap || (snap.seq != null && snap.seq <= this._seq)) return; // 舊/亂序(TCP 有序,仍防呆)
    if (snap.seq != null) this._seq = snap.seq;
    const at = this.now();
    const st = (snap.t != null) ? snap.t : at;   // 時間鍵:server 時間優先,否則退回送達時間
    if (snap.t != null) this._useServerTime = true;
    if (this._latestSt == null || st > this._latestSt) this._latestSt = st;
    if (snap.world) this._world = snap.world;
    const ents = snap.ents || {};
    // 標記本次快照在場的 id(→ 用於移除偵測)
    for (const [, e] of this._ents) e.present = false;
    for (const id in ents) {
      let e = this._ents.get(id);
      if (!e) { e = { buf: [], present: true }; this._ents.set(id, e); }
      e.present = true;
      e.buf.push({ at: at, st: st, p: (ents[id].p || []).slice(), s: ents[id].s || {} });
      e.lastAt = at; e.lastSt = st;
      if (e.buf.length > this.maxBuf) e.buf.shift();
    }
    if (snap.evts) for (let i = 0; i < snap.evts.length; i++) {
      const ev = snap.evts[i];
      if (ev.eseq > this._lastEseq) { this._lastEseq = ev.eseq; this._pending.push(ev); }
    }
  };
  // 每 render frame 呼叫:回傳 { entities:{id:{p,s}}, world },並觸發 add/remove/event 回呼。
  NetClient.prototype.sample = function () {
    const nowT = this.now();
    // 播放時鐘(server 時間):隨真實時間前進 + 慢速校正,維持 delay 落後;絕不外推。
    let rt;
    if (this._useServerTime && this._latestSt != null) {
      const target = this._latestSt - this.delay;
      if (this._playT == null) { this._playT = target; }
      else {
        this._playT += (nowT - this._lastNow);              // 隨真實時間前進(等速 → 平順)
        this._playT += (target - this._playT) * 0.02;       // 慢速校正時鐘漂移(≈±1% 速度,不可感)
        if (this._playT > this._latestSt) this._playT = this._latestSt;   // 不超過最新真實資料 → 不外推
      }
      this._lastNow = nowT;
      rt = this._playT;
    } else {
      rt = nowT - this.delay;   // 無 server 時間的舊路徑:退回送達時間
    }
    const out = {};
    const nowVisible = new Set();
    const toDelete = [];
    for (const [id, e] of this._ents) {
      const stt = interpFromBuffer(e.buf, rt);
      const drained = (e.lastSt != null) ? (rt >= e.lastSt) : true;   // 播放已到/越過該實體最後狀態
      // 收掉條件:資料流乾,且(host 明確移除 present=false)或(完全停送超過 removeGrace)
      const gone = drained && (e.present === false || (nowT - (e.lastAt || 0)) > this.removeGrace);
      if (gone) { toDelete.push(id); continue; }
      if (stt) { out[id] = stt; nowVisible.add(id); }
    }
    // add / remove 回呼(remove 只對「曾經可見」的實體觸發)
    if (this.onEntityAdd) for (const id of nowVisible) if (!this._visible.has(id)) this.onEntityAdd(id, out[id]);
    if (this.onEntityRemove) for (const id of this._visible) if (!nowVisible.has(id)) this.onEntityRemove(id);
    for (let i = 0; i < toDelete.length; i++) this._ents.delete(toDelete[i]);
    this._visible = nowVisible;
    // 事件派發(可靠、依序、去重已由 eseq 完成)
    if (this._pending.length) {
      const evs = this._pending; this._pending = [];
      if (this.onEvent) for (let i = 0; i < evs.length; i++) this.onEvent(evs[i]);
    }
    return { entities: out, world: this._world };
  };
  NetClient.prototype.entity = function (id) { const e = this._ents.get(id); const rt = (this._playT != null) ? this._playT : (this.now() - this.delay); return e ? interpFromBuffer(e.buf, rt) : null; };
  // 最新一筆權威快照(遠端預測用:從這裡的真實狀態往前積分到現在)。回 { st, p, s } 或 null。
  NetClient.prototype.latest = function (id) { const e = this._ents.get(id); if (!e || !e.buf.length) return null; const b = e.buf[e.buf.length - 1]; return { st: b.st, p: b.p, s: b.s }; };
  NetClient.prototype.latestSt = function () { return this._latestSt; };

  // ---------------- HOST ----------------
  // 收集 sim 的 snapshot() + 事件,指派 seq/eseq/t,產生要廣播的封包。
  function NetHost(opts) {
    opts = opts || {};
    this.now = opts.now || (typeof performance !== 'undefined' ? function () { return performance.now(); } : Date.now);
    this._seq = 0;
    this._eseq = 0;
    this._events = [];   // 尚未併入快照的事件
  }
  // sim 端呼叫:排入一個離散事件(下次 snapshot 帶出)
  NetHost.prototype.emit = function (type, data, opts) {
    this._eseq++;
    this._events.push({ eseq: this._eseq, type: type, data: data, to: (opts && opts.to) || null });
  };
  // 由 sim.snapshot() 的 {ents, world} 組出要廣播的封包。tMs = 規律 sim 時間(給 client server-time 內插);
  // 省略時退回 now()(牆鐘,受抖動影響 → 只在無 SimHost 的舊路徑用)。
  NetHost.prototype.pack = function (sim, tMs) {
    this._seq++;
    const evts = this._events; this._events = [];
    return { seq: this._seq, t: (tMs != null ? tMs : this.now()), ents: sim.ents || {}, world: sim.world || {}, evts: evts };
  };

  const NetCore = { NetClient: NetClient, NetHost: NetHost, interpFromBuffer: interpFromBuffer, lerpVec: lerpVec, clamp: clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = NetCore;
  if (typeof window !== 'undefined') window.NetCore = NetCore;
  else if (typeof globalThis !== 'undefined') globalThis.NetCore = NetCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);

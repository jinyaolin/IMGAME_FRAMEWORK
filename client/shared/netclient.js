// ============================================================
// NetKit — CLIENT 執行期(手機 + 大螢幕共用)。把 NetCore.NetClient 包成遊戲 render 程式
// 直接使用的 `Net` 物件。遊戲永遠只讀 Net.entities(已內插)/ Net.world,絕不碰原始快照。
//
// render 程式(target:'render')可用:
//   Net.surface     'mobile' | 'display'
//   Net.self        自己的實體 id(手機端 = 自己的 playerId;大螢幕 = null)
//   Net.entities    {id:{p:[..], s:{..}}} 每幀更新(已內插,無瞬移)
//   Net.world       離散全域狀態
//   Net.on(type,cb) 離散事件(hit/cast/land…)
//   Net.onAdd(cb) / Net.onRemove(cb)   實體出現/消失
//   Net.input(obj)  只有手機:送出本幀輸入給 host(host-authoritative)
//   Net.frame()     由執行期每幀呼叫一次,回傳 {entities, world}
// ============================================================
(function (root) {
  'use strict';
  const NetCore = (typeof require !== 'undefined') ? require('./netcore.js')
    : (root.NetCore || (typeof window !== 'undefined' && window.NetCore));

  function NetSurface(opts) {
    opts = opts || {};
    this.surface = opts.surface || 'mobile';
    this.self = opts.selfId != null ? String(opts.selfId) : null;
    this.entities = {};
    this.world = {};
    this._evH = {};
    this._addH = [];
    this._remH = [];
    this._sendInput = opts.sendInput || function () {};
    this.now = opts.now || (typeof performance !== 'undefined' ? function () { return performance.now(); } : Date.now);
    const self = this;
    this.client = new NetCore.NetClient({
      now: this.now,
      // 內插延遲:server-time 播放時鐘已免疫送達抖動,故可降到 ~2 個快照間隔(30Hz→~66ms)。
      // 降延遲 → 內插視角(大螢幕/別的手機)更貼近「現在」,縮小與預測自己的落差(host↔mobile 更一致)。
      delay: opts.delay != null ? opts.delay : 66,
      selfId: this.self,
      onEvent: function (ev) { const hs = self._evH[ev.type]; if (hs) for (let i = 0; i < hs.length; i++) try { hs[i](ev.data, ev); } catch (e) {} },
      onEntityAdd: function (id, st) { for (let i = 0; i < self._addH.length; i++) try { self._addH[i](id, st); } catch (e) {} },
      onEntityRemove: function (id) { for (let i = 0; i < self._remH.length; i++) try { self._remH[i](id); } catch (e) {} },
    });

    // ── 客戶端預測(自己角色,mobile only)──
    // 手機在本地跑「同一份遊戲 sim」推進自己的實體 → 輸入零延遲;每收到權威 snapshot 就
    // 「重設到權威狀態 + 重播尚未確認的輸入」對帳(input replay)→ 不會被過去的權威位置往回拉。
    // 遠端實體預測(A/B flag):非自己的角色也用 sim 往前推到「現在」而非內插在過去 →
    // 大螢幕/別的手機 與「自己預測」一致。需遊戲提供純運動學 predictStep(state,input,dt)。
    this.remotePredict = !!(opts.remotePredict && opts.predictStep);
    this.predictStep = opts.predictStep || null;
    this._rpLastNow = null; this._rpLastSt = null;
    this._rpState = new Map();   // id -> 增量前進的預測狀態(逐幀 predictStep,收快照時對帳)

    this.predict = !!(opts.sim && this.surface === 'mobile' && this.self);
    if (this.predict) {
      this.sim = opts.sim;
      this.predictDt = opts.predictDt || (1 / 60);   // 須與 host sim dt 一致(對帳 replay 一步一輸入)
      this._seq = 0;
      this._pending = [];              // 未確認輸入 [{seq, input}]
      this._curMx = 0; this._pendEdges = {};   // mx=連續量;其餘皆視為邊緣輸入(jump/atk/kick/skill…)通用黏著 → 下個 tick 一起送
      this._pacc = 0; this._plast = null;
      this._spawned = false;
      this._authS = null;              // 最近權威 self 的離散狀態(hp/ko/inv/idx)
      this._prevP = null; this._currP = null;   // 前/後兩次 tick 的位置 → 用累加器分數在其間插值(消除固定步長取樣鋸齒)
      this._errX = 0; this._errY = 0; this._rlast = null;   // 對帳修正的衰減偏移(時間常數化開,取代逐幀指數平滑)
      this._corrTau = opts.correctionTau || 0.13;   // 修正化開時間常數(秒):越長越順、代價是糾正稍慢(對帳仍即時、只是視覺過渡拉長)
    }
  }
  NetSurface.prototype.on = function (type, cb) { (this._evH[type] = this._evH[type] || []).push(cb); return this; };
  NetSurface.prototype.onAdd = function (cb) { this._addH.push(cb); return this; };
  NetSurface.prototype.onRemove = function (cb) { this._remH.push(cb); return this; };
  NetSurface.prototype.input = function (obj) {
    if (this.surface !== 'mobile') return;
    if (this.predict) { // 併入當前輸入:mx 覆寫;其餘任意真值欄位當邊緣黏著到下個預測 tick(通用,不綁特定遊戲的按鈕名)
      if (typeof obj.mx === 'number') this._curMx = Math.max(-1, Math.min(1, obj.mx));
      for (const k in obj) { if (k !== 'mx' && obj[k]) this._pendEdges[k] = true; }
    } else { this._sendInput(obj); }   // 無預測:直接送(舊行為)
  };
  NetSurface.prototype.pushSnapshot = function (snap) {
    this.client.pushSnapshot(snap);
    if (this.predict && snap && snap.ents && snap.ents[this.self]) this._reconcile(snap.ents[this.self]);
  };
  // 對帳:把本地 sim 的自己重設成權威狀態,再重播 ack 之後的輸入 → 得到「present 時刻」的修正預測。
  NetSurface.prototype._reconcile = function (authEnt) {
    const s = authEnt.s || {}, p = authEnt.p || [0, 0];
    this._authS = s;
    if (!this._spawned) { if (this.sim.spawn) this.sim.spawn(this.self); this._spawned = true; }
    // 對帳前的預測「當下」位置 → 用來算修正量,注入 _err 讓渲染連續(修正在時間常數內化開,不當幀跳)
    let beforeP = null;
    if (this.sim.snapshot) { const bp = this.sim.snapshot().ents[this.self]; if (bp) beforeP = [bp.p[0], bp.p[1] || 0]; }
    // ko/respawn 由伺服器主導 → ko 期間不預測,直接吃權威
    if (this.sim.reset) this.sim.reset(this.self, { x: p[0], y: p[1] || 0, vx: s.vx || 0, vy: s.vy || 0, grounded: !!s.gr, jumps: s.jm || 0, stun: s.st, dir: s.dir });
    const ack = s.ack;
    if (ack != null) { let i = 0; while (i < this._pending.length && this._pending[i].seq <= ack) i++; if (i) this._pending.splice(0, i); }
    // 重播未確認輸入(每個一步,與伺服器同 dt)
    for (let k = 0; k < this._pending.length; k++) {
      if (this.sim.input) this.sim.input(this.self, this._pending[k].input);
      if (this.sim.step) this.sim.step(this.predictDt);
    }
    // 對帳後把插值端點對齊到新的預測「當下」;修正量(before→after)灌進 _err → 渲染位置不跳、隨後衰減化開
    if (this.sim.snapshot) {
      const sp = this.sim.snapshot().ents[this.self];
      if (sp) {
        const afterP = [sp.p[0], sp.p[1] || 0];
        if (beforeP) { this._errX = (this._errX || 0) + (beforeP[0] - afterP[0]); this._errY = (this._errY || 0) + (beforeP[1] - afterP[1]); }
        this._prevP = this._currP = afterP;
      }
    }
  };
  NetSurface.prototype._predictTick = function () {
    if (!this._spawned) return;
    this._seq++;
    const edges = this._pendEdges; this._pendEdges = {};
    const inputBody = Object.assign({ mx: this._curMx }, edges);   // mx + 本 tick 所有邊緣(jump/atk/kick/skill…)
    const input = Object.assign({ seq: this._seq }, inputBody);
    this._pending.push({ seq: this._seq, input: inputBody });
    if (this._pending.length > 240) this._pending.shift();
    this._sendInput(input);                 // 送給伺服器(含 seq)
    if (this.sim.input) this.sim.input(this.self, inputBody);
    if (this.sim.step) this.sim.step(this.predictDt);
    // 記錄這一步結束的位置:_currP=新、_prevP=上一步 → frame() 在兩者間依累加器分數插值,免固定步長鋸齒
    if (this.sim.snapshot) { const sp = this.sim.snapshot().ents[this.self]; if (sp) { this._prevP = this._currP || [sp.p[0], sp.p[1] || 0]; this._currP = [sp.p[0], sp.p[1] || 0]; } }
  };
  // 執行期每 render frame 呼叫:推進預測 + 內插取樣 + 用預測覆寫自己(零延遲)
  NetSurface.prototype.frame = function () {
    const r = this.client.sample();
    this.entities = r.entities; this.world = r.world;
    if (this.predict && this._spawned) {
      // 固定步長推進預測(真實 dt 累加,幀率無關)
      const t = this.now();
      if (this._plast == null) this._plast = t;
      this._pacc += (t - this._plast) / 1000; this._plast = t;
      let n = 0; while (this._pacc >= this.predictDt && n < 6) { this._predictTick(); this._pacc -= this.predictDt; n++; }
      if (n === 6) this._pacc = 0;
      // 用預測結果覆寫「自己」的實體(ko 時吃權威插值)
      const authS = this._authS || {};
      if (!authS.ko && this.sim.snapshot) {
        const ss = this.sim.snapshot().ents[this.self];
        if (ss) {
          // 渲染插值:在最後兩次 tick 位置間依累加器剩餘分數 alpha 內插 → 幀率無關、無固定步長鋸齒(遠端已用同理增量前進而順)
          const cp = this._currP || [ss.p[0], ss.p[1] || 0];
          const pp = this._prevP || cp;
          const alpha = Math.max(0, Math.min(1, this._pacc / this.predictDt));
          const px = pp[0] + (cp[0] - pp[0]) * alpha;
          const py = pp[1] + (cp[1] - pp[1]) * alpha;
          // 對帳修正以「誤差偏移」按真實時間常數衰減來攤掉(不用逐幀指數平滑 —— 那在變動幀長下反而抖)。
          // 插值後的 px/py 本身已平順(等速時每幀等距),直接渲染;_err 只吸收快照對帳的位置跳變。
          const rdt = this._rlast != null ? Math.max(0, (t - this._rlast) / 1000) : 0; this._rlast = t;
          const decay = Math.exp(-rdt / this._corrTau);   // 時間常數化開修正,幀率無關
          this._errX = (this._errX || 0) * decay; this._errY = (this._errY || 0) * decay;
          // 自己實體 s = 權威離散狀態(role/seed/skn/scd/hp/inv/buff… 全帶)+ 本地預測的運動學欄位覆寫。
          // 通用做法(不手挑遊戲欄位):否則自己角色會用錯 role、HUD 的技能冷卻/buff 也讀不到。
          this.entities[this.self] = { p: [px + this._errX, py + this._errY],
            s: Object.assign({}, authS, { dir: ss.s.dir, anim: ss.s.anim, vx: ss.s.vx, vy: ss.s.vy, gr: ss.s.gr, ko: 0 }) };
        }
      }
    }
    // ── 遠端實體預測:每幀用 predictStep 增量前進(逐幀 dt 恆正 → 移動中恆前進,免疫幀時間抖動);
    //    只在「收到新快照」時對帳(把快照往前推 LEAD≈現在,朝它 blend)→ 修正漂移但不引入每幀回彈。──
    if (this.remotePredict) {
      const now = this.now();
      const fdt = (this._rpLastNow != null) ? Math.min(0.1, (now - this._rpLastNow) / 1000) : 1 / 60;
      this._rpLastNow = now;
      const nowSt = this.client.latestSt();
      const isNew = (nowSt !== this._rpLastSt); this._rpLastSt = nowSt;
      const LEAD = 0.033, HH = 1 / 120;   // 把快照往前推 ~一個間隔到「現在」
      const fwd = (base, mx, amt) => { let o = base; let rem = amt; while (rem > 1e-6) { const dt = Math.min(HH, rem); o = this.predictStep(o, { mx: mx }, dt); rem -= dt; } return o; };
      for (const id in this.entities) {
        if (id === this.self) continue;
        const L = this.client.latest(id); if (!L) continue;
        const s = L.s || {};
        if (s.ko) { this._rpState.delete(id); continue; }   // KO/倒地:交給權威內插(不預測)
        const snap = { x: L.p[0], y: L.p[1] || 0, vx: s.vx || 0, vy: s.vy || 0, grounded: !!s.gr, jumps: s.jm || 0, stun: s.st || 0, dir: s.dir };
        let ps = this._rpState.get(id);
        if (!ps) { ps = fwd(snap, s.mx || 0, LEAD); ps.mx = s.mx || 0; this._rpState.set(id, ps); }
        else if (isNew) {
          const af = fwd(snap, s.mx || 0, LEAD);   // 快照→現在的權威估計
          // 水平對帳前進偏置(往前修得快、往後修得慢)→ 過衝回彈不外顯;真正轉向由 predictStep(mx) 主導,不受影響
          const dxK = (af.x >= ps.x) ? 0.4 : 0.15;
          ps.x += (af.x - ps.x) * dxK; ps.y += (af.y - ps.y) * 0.35; ps.vx += (af.vx - ps.vx) * 0.35; ps.vy += (af.vy - ps.vy) * 0.35;
          ps.grounded = af.grounded; ps.jumps = af.jumps; ps.stun = af.stun; ps.dir = af.dir; ps.mx = s.mx || 0;
        }
        const adv = this.predictStep(ps, { mx: ps.mx }, fdt);   // 增量前進一幀
        ps.x = adv.x; ps.y = adv.y; ps.vx = adv.vx; ps.vy = adv.vy; ps.grounded = adv.grounded; ps.jumps = adv.jumps; ps.stun = adv.stun; ps.dir = adv.dir;
        this.entities[id] = { p: [ps.x, ps.y], s: Object.assign({}, s, { dir: ps.dir, anim: adv.anim }) };
      }
    }
    return { entities: this.entities, world: this.world };
  };

  const NetClientKit = { NetSurface: NetSurface };
  if (typeof module !== 'undefined' && module.exports) module.exports = NetClientKit;
  if (typeof window !== 'undefined') window.NetClientKit = NetClientKit;
  else if (typeof globalThis !== 'undefined') globalThis.NetClientKit = NetClientKit;
})(typeof globalThis !== 'undefined' ? globalThis : this);

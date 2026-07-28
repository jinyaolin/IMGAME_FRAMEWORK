// NetKit 核心回歸(純 node,確定性虛擬時鐘,不需伺服器/瀏覽器)
//   node test/netkit/test-netcore.js
// 驗:實體插值結構上不會瞬移、事件可靠依序不重複、交握 add/remove、緩衝用盡不炸。
// 對照組:故意的「速度外推」client(本 session 的舊 bug)必須被同一組資料抓到瞬移,
//         證明這個 harness 真的能擋回歸(不是永遠綠)。
const NetCore = require('../../client/shared/netcore.js');

let pass = 0, fail = 0;
function check(name, cond, detail) { console.log(`  ${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); cond ? pass++ : fail++; }

// 虛擬時鐘
function mkClock() { const c = { t: 0 }; c.now = () => c.t; return c; }

// 送端真實軌跡:等速向右 + 一次跳躍弧(單調前進 → 任何負向位移都是瞬移 bug)
function truePos(t) {
  const x = t * 0.008;                                   // 一路向右,x 單調遞增
  let y = 0; if (t > 300 && t < 800) { const u = (t - 300) / 500; y = Math.sin(Math.PI * u) * 3; }
  return [x, y];
}

// 跑一個 client 通過「host 20Hz 送、含抖動延遲」的通道,回傳每 16ms 的渲染位置
function runChannel(makeClient, opts) {
  opts = opts || {};
  const SEND = opts.send || 50, LAT = opts.lat || 30, DUR = opts.dur || 2000, FRAME = 16;
  const clock = mkClock();
  const client = makeClient(clock);
  // 預先產生 host 快照(seq,送出時刻,內容),含抖動到達時間
  const outbox = []; let seq = 0;
  for (let ts = 0; ts <= DUR; ts += SEND) {
    const jitter = opts.jitter ? ((seq % 3) - 1) * opts.jitter : 0;   // 確定性抖動 -j,0,+j
    const gap = (opts.dropRange && ts >= opts.dropRange[0] && ts < opts.dropRange[1]);   // 模擬斷流
    if (!gap) { seq++; outbox.push({ arriveAt: ts + LAT + jitter, snap: { seq: seq, t: ts, ents: { A: { p: truePos(ts), s: {} } }, world: {} } }); }
  }
  outbox.sort((a, b) => a.arriveAt - b.arriveAt);
  const samples = []; let oi = 0;
  for (let t = 0; t <= DUR + 200; t += FRAME) {
    clock.t = t;
    while (oi < outbox.length && outbox[oi].arriveAt <= t) { client.push(outbox[oi].snap); oi++; }
    const p = client.render();
    if (p) samples.push({ t: t, x: p[0], y: p[1] });
  }
  return samples;
}

// 用 NetClient 包一個統一介面
function netClientFactory(delay) {
  return (clock) => {
    const c = new NetCore.NetClient({ now: clock.now, delay: delay || 100 });
    return { push: s => c.pushSnapshot(s), render: () => { const r = c.sample(); return r.entities.A ? r.entities.A.p : null; } };
  };
}

// 對照組:舊的「速度外推」實作(到達時間估速 → 外推到 now)。本 session 的 bug 來源。
function badExtrapFactory() {
  return () => {
    let last = null, prev = null;
    return {
      push: s => { prev = last; last = { at: null, p: s.ents.A.p }; },
      render: () => last ? last.p : null,   // 佔位;真正外推版見下方 badExtrap2
    };
  };
}
// 更貼近舊碼:存 tx + 用「送端速度概念」但以到達間隔估速外推(會在變速/抖動時過衝)
function badExtrap2Factory() {
  return (clock) => {
    let cur = [0, 0], tx = null, vel = [0, 0], lastAt = 0, prevP = null;
    return {
      push: s => { const at = clock.now(); const p = s.ents.A.p; if (tx) { const dt = Math.max(1, at - lastAt); vel = [(p[0] - tx[0]) / dt, (p[1] - tx[1]) / dt]; } tx = p.slice(); lastAt = at; },
      render: () => {
        if (!tx) return null;
        const e = Math.min(clock.now() - lastAt, 150);          // 外推最多 150ms(=舊碼上限)
        const target = [tx[0] + vel[0] * e, tx[1] + vel[1] * e];
        cur = [cur[0] + (target[0] - cur[0]) * 0.33, cur[1] + (target[1] - cur[1]) * 0.33];
        return cur.slice();
      },
    };
  };
}

// 逆行偵測:真實軌跡一路向右 → 渲染 x 出現明顯負向位移即為瞬移 bug
function backwardEvents(samples) {
  let ev = 0, worst = 0;
  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i].x - samples[i - 1].x;
    if (dx < -0.02) { ev++; worst = Math.min(worst, dx); }
  }
  return { ev, worst };
}

console.log('CHECK 1: 規則 20Hz + 抖動下,NetClient 不逆行(結構性無瞬移)');
{
  const s = runChannel(netClientFactory(100), { jitter: 12, dur: 2000 });
  const be = backwardEvents(s, 130);   // 130ms 延遲位移容忍
  check('NetClient 抖動下 0 逆行事件', be.ev === 0, `逆行=${be.ev} 最糟=${be.worst.toFixed(3)}`);
  // 落地(y 回 0)不下探到負值(舊外推會把 y 外推到地下再彈上)
  const minY = Math.min(...s.map(p => p.y));
  check('NetClient y 不穿地(≥ -0.05)', minY >= -0.05, `minY=${minY.toFixed(3)}`);
}

console.log('CHECK 2: 對照組(速度外推)在同資料下必須逆行/瞬移(證明 harness 抓得到)');
{
  const s = runChannel(badExtrap2Factory(), { jitter: 12, dur: 2000 });
  const be = backwardEvents(s, 130);
  check('外推版有逆行事件(harness 有鑑別力)', be.ev > 0, `逆行=${be.ev} 最糟=${be.worst.toFixed(3)}`);
}

console.log('CHECK 3: 斷流(緩衝用盡)→ 停最新、不瞬移,恢復後續走');
{
  const s = runChannel(netClientFactory(100), { dur: 2000, dropRange: [600, 950] });   // 斷 350ms
  const be = backwardEvents(s, 130);
  check('斷流期間 0 逆行', be.ev === 0, `逆行=${be.ev}`);
}

console.log('CHECK 4: 事件可靠、依序、去重(重送同一快照不重複派發)');
{
  const clock = mkClock();
  const got = [];
  const c = new NetCore.NetClient({ now: clock.now, delay: 0, onEvent: e => got.push(e.type) });
  const host = new NetCore.NetHost({ now: clock.now });
  host.emit('hit', { a: 1 }); host.emit('cast', { b: 2 });
  const snapA = host.pack({ ents: {}, world: {} });
  c.pushSnapshot(snapA); c.pushSnapshot(snapA);   // 故意重送
  clock.t = 1; c.sample();
  host.emit('die', {});
  const snapB = host.pack({ ents: {}, world: {} });
  c.pushSnapshot(snapB);
  clock.t = 2; c.sample();
  check('事件依序且不重複', JSON.stringify(got) === JSON.stringify(['hit', 'cast', 'die']), JSON.stringify(got));
}

console.log('CHECK 5: 交握 add/remove(實體出現觸發一次 add;host 移除且緩衝流乾觸發 remove)');
{
  const clock = mkClock();
  const adds = [], rems = [];
  const c = new NetCore.NetClient({ now: clock.now, delay: 100, onEntityAdd: id => adds.push(id), onEntityRemove: id => rems.push(id) });
  // 送 A 幾幀
  for (let ts = 0; ts <= 300; ts += 50) { clock.t = ts; c.pushSnapshot({ seq: ts / 50 + 1, ents: { A: { p: [ts * 0.01, 0], s: {} } }, world: {} }); }
  for (let t = 0; t <= 500; t += 16) { clock.t = t; c.sample(); }
  check('A 觸發一次 add', adds.filter(x => x === 'A').length === 1, JSON.stringify(adds));
  // host 停送 A(移除),續跑到緩衝流乾
  for (let t = 500; t <= 1200; t += 16) { clock.t = t; c.sample(); }
  check('A 觸發 remove', rems.filter(x => x === 'A').length === 1, JSON.stringify(rems));
}

console.log('CHECK 6: 渲染落後真實約 delay(插值不領先 → 不需外推)');
{
  const s = runChannel(netClientFactory(100), { dur: 1000 });
  // 取 t=600ms 的渲染 x 與 (600 - lat - delay) 的真實 x 比較(粗略)
  const at600 = s.find(p => p.t >= 600);
  const trueBehind = truePos(600 - 30 - 100)[0];
  check('渲染位置落後真實(延遲換平滑)', at600 && Math.abs(at600.x - trueBehind) < 0.6, at600 ? `render=${at600.x.toFixed(2)} trueBehind≈${trueBehind.toFixed(2)}` : 'no sample');
}

console.log('CHECK 7: 送達抖動下,server-time 內插的速度平順度(播放不隨送達忽快忽慢)');
{
  // host 規律 30Hz(server t 規律),送達含抖動;量渲染速度的變異(越小越順 → 跑步不抖/回彈)
  const clock = mkClock();
  const c = new NetCore.NetClient({ now: clock.now, delay: 100 });
  const SEND = 1000 / 30, DUR = 2000, LAT = 30;
  const box = []; let seq = 0;
  for (let ts = 0; ts <= DUR; ts += SEND) { seq++; const jit = (seq % 4 === 0 ? 22 : seq % 4 === 2 ? -14 : 0);
    box.push({ arrive: ts + LAT + jit, snap: { seq, t: ts, ents: { A: { p: [8 * ts / 1000, 0], s: {} } } } }); }
  box.sort((a, b) => a.arrive - b.arrive);
  const xs = []; let oi = 0;
  for (let t = 0; t <= DUR + 200; t += 1000 / 60) { clock.t = t; while (oi < box.length && box[oi].arrive <= t) { c.pushSnapshot(box[oi].snap); oi++; } const r = c.sample(); if (r.entities.A) xs.push(r.entities.A.p[0]); }
  const d = []; for (let i = 1; i < xs.length; i++) d.push(xs[i] - xs[i - 1]);
  const m = d.reduce((a, b) => a + b, 0) / d.length; const std = Math.sqrt(d.reduce((a, b) => a + (b - m) * (b - m), 0) / d.length);
  check('抖動下速度平順(std < 0.05,即 <40% 均速)', std < 0.05, `速度std=${std.toFixed(4)} 均速=${m.toFixed(4)}`);
}

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

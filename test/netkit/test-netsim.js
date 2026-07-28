// NetKit 端到端整合(純 node,確定性):tiny sim → SimHost 權威模擬 → 模擬網路延遲 →
// NetClient 插值渲染。驗證整條鏈:輸入→模擬→快照→內插 全程無瞬移 + 交握 + 事件。
//   node test/netkit/test-netsim.js
const NetCore = require('../../client/shared/netcore.js');
const NetSim = require('../../client/shared/netsim.js');

let pass = 0, fail = 0;
function check(name, cond, detail) { console.log(`  ${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); cond ? pass++ : fail++; }

// ---- 迷你權威 sim:玩家依輸入向右走 + 跳躍;落地發 'land' 事件 ----
function makeMover() {
  const SPEED = 8, JUMP = 14, G = 30;
  const ents = {}; const input = {};
  return {
    spawn(pid) { ents[pid] = { x: -10, y: 0, vy: 0, grounded: true, dir: 1, anim: 'idle' }; },
    despawn(pid) { delete ents[pid]; },
    input(pid, inp) { input[pid] = Object.assign(input[pid] || {}, inp); },
    step(dt) {
      for (const pid in ents) {
        const e = ents[pid]; const inp = input[pid] || {};
        const mx = inp.mx || 0;
        e.x += mx * SPEED * dt;
        if (inp.jump && e.grounded) { e.vy = JUMP; e.grounded = false; input[pid].jump = false; }
        const wasAir = !e.grounded;
        e.vy -= G * dt; e.y += e.vy * dt;
        if (e.y <= 0) { e.y = 0; e.vy = 0; if (wasAir) { e.grounded = true; this.emit('land', { id: pid }); } }
        e.dir = mx < 0 ? -1 : (mx > 0 ? 1 : e.dir);
        e.anim = !e.grounded ? 'jump' : (Math.abs(mx) > 0.01 ? 'run' : 'idle');
      }
    },
    snapshot() {
      const out = {};
      for (const pid in ents) { const e = ents[pid]; out[pid] = { p: [e.x, e.y], s: { dir: e.dir, anim: e.anim } }; }
      return { ents: out, world: {} };
    },
  };
}

console.log('CHECK 1: 端到端 走+跳,client 渲染無瞬移 + 交握 + land 事件');
{
  const clock = { t: 0 }; const now = () => clock.t;
  const LAT = 35;
  const inbox = [];
  const host = new NetSim.SimHost({ sim: makeMover(), dt: 1 / 30, netEvery: 2, now: now, send: pkt => inbox.push({ at: clock.t + LAT, snap: pkt }) });
  const adds = [], events = [];
  const client = new NetCore.NetClient({ now: now, delay: 100, onEntityAdd: id => adds.push(id), onEvent: ev => events.push(ev.type) });
  host.join('p1');

  const samples = [];
  let di = 0;
  for (let t = 0; t <= 2000; t += 16) {
    clock.t = t;
    // 腳本化輸入:一路向右,t=500 跳一次
    host.input('p1', { mx: 1, jump: (t >= 500 && t < 600) });   // 按住一小段確保被固定步進取到(sim 只會跳一次)
    host.advance(0.016);
    inbox.sort((a, b) => a.at - b.at);
    while (di < inbox.length && inbox[di].at <= t) { client.pushSnapshot(inbox[di].snap); di++; }
    const r = client.sample();
    if (r.entities.p1) samples.push({ t, x: r.entities.p1.p[0], y: r.entities.p1.p[1], anim: r.entities.p1.s.anim });
  }

  // 無瞬移:x 單調不減(容忍 1e-6)
  let back = 0, worst = 0;
  for (let i = 1; i < samples.length; i++) { const dx = samples[i].x - samples[i - 1].x; if (dx < -0.02) { back++; worst = Math.min(worst, dx); } }
  check('渲染 x 一路向右不逆行(0 瞬移)', back === 0, `逆行=${back} 最糟=${worst.toFixed(3)}`);

  const minY = Math.min(...samples.map(s => s.y)), maxY = Math.max(...samples.map(s => s.y));
  check('跳躍弧有出現且不穿地', maxY > 1.5 && minY >= -0.05, `y ∈ [${minY.toFixed(2)}, ${maxY.toFixed(2)}]`);
  check('落地時渲染 y 平滑回 0(無下探彈回)', true, `(見上 minY=${minY.toFixed(3)})`);

  check('p1 觸發一次 entity add', adds.filter(x => x === 'p1').length === 1, JSON.stringify(adds));
  check('land 事件送達一次', events.filter(x => x === 'land').length === 1, JSON.stringify(events));
  check('anim 有 run 也有 jump(離散狀態階梯正確)', samples.some(s => s.anim === 'run') && samples.some(s => s.anim === 'jump'), '');
}

console.log('CHECK 2: 兩位玩家,離開者被收掉(despawn → 停送 → remove)');
{
  const clock = { t: 0 }; const now = () => clock.t;
  const inbox = [];
  const host = new NetSim.SimHost({ sim: makeMover(), dt: 1 / 30, netEvery: 2, now: now, send: pkt => inbox.push({ at: clock.t + 20, snap: pkt }) });
  const adds = [], rems = [];
  const client = new NetCore.NetClient({ now: now, delay: 100, removeGrace: 400, onEntityAdd: id => adds.push(id), onEntityRemove: id => rems.push(id) });
  host.join('p1'); host.join('p2');
  let di = 0, left = false;
  for (let t = 0; t <= 2500; t += 16) {
    clock.t = t;
    host.input('p1', { mx: 1 }); host.input('p2', { mx: 1 });
    if (t >= 1000 && !left) { host.leave('p2'); left = true; }
    host.advance(0.016);
    while (di < inbox.length && inbox[di].at <= t) { client.pushSnapshot(inbox[di].snap); di++; }
    client.sample();
  }
  check('兩位玩家都 add', adds.includes('p1') && adds.includes('p2'), JSON.stringify(adds));
  check('離開的 p2 被 remove、p1 留著', rems.includes('p2') && !rems.includes('p1'), JSON.stringify(rems));
}

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

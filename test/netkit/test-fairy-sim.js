// 童話大亂鬥 NetKit sim 端到端(node,確定性 60fps):走/跳/落地無瞬移 + 揮拳命中 + 事件 + HP。
//   node test/netkit/test-fairy-sim.js
const NetCore = require('../../client/shared/netcore.js');
const NetSim = require('../../client/shared/netsim.js');
const { buildFairySim, FAIRY_CFG } = require('./fairy-sim.js');

let pass = 0, fail = 0;
function check(name, cond, detail) { console.log(`  ${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); cond ? pass++ : fail++; }

const clock = { t: 0 }; const now = () => clock.t;
const Sim = buildFairySim({}, FAIRY_CFG);
const inbox = [];
const host = new NetSim.SimHost({ sim: Sim, dt: 1 / 30, netEvery: 2, now, send: pkt => inbox.push({ at: clock.t + 30, snap: pkt }) });
const events = [];
const client = new NetCore.NetClient({ now, delay: 100, onEvent: ev => events.push(ev.type) });
host.join('p1'); host.join('p2');   // p1 spawn -12, p2 spawn -6

const sByFrame = [];
let di = 0;
for (let t = 0; t <= 4000; t += 16) {
  clock.t = t;
  // p1:走近 p2 後停下(mx→0),t=300 跳一次,t=2200 揮拳(避開 p2 開場 2s 無敵)
  host.input('p1', { mx: (t < 650 ? 1 : 0), jump: (t >= 300 && t < 360), atk: (t >= 2200 && t < 2220) });
  host.input('p2', { mx: 0 });
  host.advance(0.016);
  inbox.sort((a, b) => a.at - b.at);
  while (di < inbox.length && inbox[di].at <= t) { client.pushSnapshot(inbox[di].snap); di++; }
  const r = client.sample();
  if (r.entities.p1 && r.entities.p2) sByFrame.push({ t, p1x: r.entities.p1.p[0], p1y: r.entities.p1.p[1], p1anim: r.entities.p1.s.anim, p2hp: r.entities.p2.s.hp });
}

// 1) p1 渲染:向右段不逆行(靠近 p2 前一路向右)
let back = 0, worst = 0;
for (let i = 1; i < sByFrame.length; i++) { const dx = sByFrame[i].p1x - sByFrame[i - 1].p1x; if (dx < -0.02) { back++; worst = Math.min(worst, dx); } }
check('p1 渲染 x 不逆行(0 瞬移)', back === 0, `逆行=${back} 最糟=${worst.toFixed(3)}`);

// 2) 跳躍弧 + 不穿地
const minY = Math.min(...sByFrame.map(s => s.p1y)), maxY = Math.max(...sByFrame.map(s => s.p1y));
check('跳躍弧出現且不穿地', maxY > 1.5 && minY >= -0.05, `y ∈ [${minY.toFixed(2)}, ${maxY.toFixed(2)}]`);

// 3) locomotion 動作階梯(idle/run/jump 都有)
check('anim 有 run 與 jump', sByFrame.some(s => s.p1anim === 'run') && sByFrame.some(s => s.p1anim === 'jump'), '');

// 4) 揮拳命中:atk 事件 + hit 事件送達;p2 HP 掉
check('atk + hit 事件送達', events.includes('atk') && events.includes('hit'), JSON.stringify([...new Set(events)]));
const p2hpEnd = sByFrame[sByFrame.length - 1].p2hp;
check('p2 HP 被打掉(< 100)', p2hpEnd < 100, `p2hp=${p2hpEnd}`);

// 5) sim 權威狀態自檢:p1 真的走到 p2 附近才打得到
check('命中距離合理(p1 有走近 p2)', Sim._ents.p1.x > -8, `p1.x=${Sim._ents.p1.x.toFixed(2)}`);

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

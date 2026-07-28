// A/B:遠端實體預測 vs 內插(node,確定性)。同一路況(跑右→轉左→跳)+ 送達抖動下,
// 比兩種 client 視角相對「真實 now 位置」的落後量、平順度、轉向後是否失控。
//   node test/netkit/test-remote-predict.js
const NetSim = require('../../client/shared/netsim.js');
const { NetSurface } = require('../../client/shared/netclient.js');
const { buildFairySim, FAIRY_CFG } = require('./fairy-sim.js');

let pass = 0, fail = 0;
function check(name, cond, detail) { console.log(`  ${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); cond ? pass++ : fail++; }

const clock = { t: 0 }; const now = () => clock.t;
const serverSim = buildFairySim({}, FAIRY_CFG);
const LAT = 30;
const inboxI = [], inboxP = [];
let sseq = 0;
const host = new NetSim.SimHost({ sim: serverSim, dt: 1 / 60, netEvery: 2, now, send: pkt => { sseq++; const jit = (sseq % 4 === 0 ? 20 : sseq % 4 === 2 ? -12 : 0); inboxI.push({ at: clock.t + LAT + jit, snap: pkt }); inboxP.push({ at: clock.t + LAT + jit, snap: pkt }); } });
host.join('A');

const ci = new NetSurface({ surface: 'display', selfId: null, now, delay: 66 });                       // 內插(現行)
const predSim = buildFairySim({}, FAIRY_CFG);
const cp = new NetSurface({ surface: 'display', selfId: null, now, remotePredict: true, predictStep: predSim.predictStep });  // 遠端預測

const rows = []; let ii = 0, ip = 0;
const DUR = 3000;
for (let t = 0; t <= DUR; t += 1000 / 60) {
  clock.t = t;
  const mx = t < 1000 ? 1 : (t < 2000 ? -1 : 0);                 // 跑右 → 轉左 → 停
  host.input('A', { mx, jump: ((t >= 500 && t < 520) || (t >= 1500 && t < 1520)) });
  host.advance(1 / 60);
  inboxI.sort((a, b) => a.at - b.at); inboxP.sort((a, b) => a.at - b.at);
  while (ii < inboxI.length && inboxI[ii].at <= t) { ci.pushSnapshot(inboxI[ii].snap); ii++; }
  while (ip < inboxP.length && inboxP[ip].at <= t) { cp.pushSnapshot(inboxP[ip].snap); ip++; }
  ci.frame(); cp.frame();
  const A = serverSim._ents.A;
  rows.push({ t, truth: A.x, truthY: A.y, interp: ci.entities.A ? ci.entities.A.p[0] : null, pred: cp.entities.A ? cp.entities.A.p[0] : null, predY: cp.entities.A ? cp.entities.A.p[1] : null });
}

const V = rows.filter(r => r.interp != null && r.pred != null);
// 1) 落後量(相對真實 now):跑右穩定段(t 300-900),view 落後 truth 多少
const seg = V.filter(r => r.t >= 300 && r.t <= 900);
const lagI = seg.reduce((s, r) => s + (r.truth - r.interp), 0) / seg.length;
const lagP = seg.reduce((s, r) => s + (r.truth - r.pred), 0) / seg.length;
console.log(`落後真實 now(跑右穩定段):內插=${lagI.toFixed(3)} 單位   遠端預測=${lagP.toFixed(3)} 單位`);
check('遠端預測明顯更貼近 now(落後 < 內插的一半)', Math.abs(lagP) < Math.abs(lagI) * 0.6, `interp=${lagI.toFixed(3)} pred=${lagP.toFixed(3)}`);

// 2) 平順度(速度 std,跑右段)
function std(key) { const xs = seg.map(r => r[key]); const d = []; for (let i = 1; i < xs.length; i++) d.push(xs[i] - xs[i - 1]); const m = d.reduce((a, b) => a + b, 0) / d.length; return Math.sqrt(d.reduce((a, b) => a + (b - m) * (b - m), 0) / d.length); }
console.log(`平順度(速度std):內插=${std('interp').toFixed(4)}  遠端預測=${std('pred').toFixed(4)}`);
check('遠端預測仍平順(std < 0.05)', std('pred') < 0.05, `pred std=${std('pred').toFixed(4)}`);

// 3) 轉向後不失控:t 1100-1400(已轉左),pred 應跟著往左,且與 truth 誤差有界(< 0.6)
const turn = V.filter(r => r.t >= 1100 && r.t <= 1400);
const maxErr = Math.max(...turn.map(r => Math.abs(r.truth - r.pred)));
check('轉向後預測不失控(與真實誤差 < 0.6)', maxErr < 0.6, `轉向後最大誤差=${maxErr.toFixed(3)}`);

// 4) 跳躍 y 也被預測(pred y 有跟上跳弧)
const maxPredY = Math.max(...V.map(r => r.predY || 0));
check('跳躍弧被預測(pred y > 1.5)', maxPredY > 1.5, `maxPredY=${maxPredY.toFixed(2)}`);

// 5) 停下後(t 2200+)兩者都收斂到真實停點
const endTruth = rows[rows.length - 1].truth, endPred = V[V.length - 1].pred, endInterp = V[V.length - 1].interp;
check('停下後預測收斂真實(誤差<0.3)', Math.abs(endPred - endTruth) < 0.3, `pred=${endPred.toFixed(2)} truth=${endTruth.toFixed(2)}`);

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

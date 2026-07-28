// NetKit 客戶端預測(node,確定性):比較「預測自己」vs「純內插(別人視角)」的輸入延遲,
// 並驗證預測 + 對帳(input replay)不逆行、與伺服器收斂、外力(擊退)能被對帳修正。
//   node test/netkit/test-netpredict.js
const NetSim = require('../../client/shared/netsim.js');
const { NetSurface } = require('../../client/shared/netclient.js');
const { buildFairySim, FAIRY_CFG } = require('./fairy-sim.js');

let pass = 0, fail = 0;
function check(name, cond, detail) { console.log(`  ${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); cond ? pass++ : fail++; }

const clock = { t: 0 }; const now = () => clock.t;
const LAT = 25;   // 單程延遲(ms)
const serverInbox = [], clientInbox = [], obsInbox = [];

const serverSim = buildFairySim({}, FAIRY_CFG);
const host = new NetSim.SimHost({ sim: serverSim, dt: 1 / 60, netEvery: 2, now, send: pkt => { clientInbox.push({ at: clock.t + LAT, snap: pkt }); obsInbox.push({ at: clock.t + LAT, snap: pkt }); } });
host.join('me'); host.join('foe');

const clientSim = buildFairySim({}, FAIRY_CFG);
const net = new NetSurface({ surface: 'mobile', selfId: 'me', now, sim: clientSim, delay: 100, sendInput: inp => serverInbox.push({ at: clock.t + LAT, pid: 'me', input: inp }) });
// 對照:別人怎麼看「me」(純內插,無預測)
const obs = new NetSurface({ surface: 'display', selfId: null, now, delay: 100 });

const rec = [];
let si = 0, ci = 0, oi = 0;
let knocked = false;
for (let t = 0; t <= 3000; t += 16) {
  clock.t = t;
  serverInbox.sort((a, b) => a.at - b.at);
  while (si < serverInbox.length && serverInbox[si].at <= t) { host.input(serverInbox[si].pid, serverInbox[si].input); si++; }
  // 外力:t=2000 伺服器端給 me 一記擊退 + 硬直(模擬被 foe 打)→ 測對帳能否修正
  if (t >= 2000 && !knocked) { const m = serverSim._ents.me; m.vx = -14; m.vy = 6; m.grounded = false; m.stun = 0.4; knocked = true; }
  host.advance(0.016);
  while (ci < clientInbox.length && clientInbox[ci].at <= t) { net.pushSnapshot(clientInbox[ci].snap); ci++; }
  while (oi < obsInbox.length && obsInbox[oi].at <= t) { obs.pushSnapshot(obsInbox[oi].snap); oi++; }

  // 輸入:t=500 起按住右,t=1500 放開
  net.input({ mx: (t >= 500 && t < 1500) ? 1 : 0 });

  const rf = net.frame(); obs.frame();
  const meP = rf.entities.me ? rf.entities.me.p[0] : null;
  const meO = obs.entities.me ? obs.entities.me.p[0] : null;
  rec.push({ t, pred: meP, obs: meO, srv: serverSim._ents.me ? serverSim._ents.me.x : null });
}

// 起始 x
const x0 = rec.find(r => r.pred != null).pred;
// 首次移動時間(預測 vs 內插)
function firstMove(key) { const r = rec.find(r => r[key] != null && Math.abs(r[key] - x0) > 0.1 && r.t >= 500); return r ? r.t - 500 : Infinity; }
const latPred = firstMove('pred'), latObs = firstMove('obs');
console.log(`  首次反應延遲:預測=${latPred}ms  純內插(別人視角)=${latObs}ms`);
check('預測反應遠快於內插(≥80ms 差)', latPred + 80 <= latObs, `pred=${latPred} obs=${latObs}`);
check('預測幾乎零延遲(≤50ms)', latPred <= 50, `${latPred}ms`);

// 走右段(t 600~1400)預測不逆行
let back = 0; const seg = rec.filter(r => r.t >= 600 && r.t <= 1400 && r.pred != null);
for (let i = 1; i < seg.length; i++) { if (seg[i].pred - seg[i - 1].pred < -0.03) back++; }
check('預測走路不逆行(0 瞬移)', back === 0, `逆行=${back}`);

// 收斂:走路穩定後(t=1400)預測與伺服器接近
const at1400 = rec.find(r => r.t >= 1400);
check('預測與伺服器收斂(誤差<0.6)', at1400 && Math.abs(at1400.pred - at1400.srv) < 0.6, `pred=${at1400.pred.toFixed(2)} srv=${at1400.srv.toFixed(2)}`);

// 對帳:外力擊退後(t=2000→2400),預測有被拉回(反映伺服器權威),最終與伺服器一致
const before = rec.find(r => r.t >= 1950).pred;
const after = rec.find(r => r.t >= 2450).pred;
check('外力擊退被對帳修正(預測往左移)', after < before - 0.5, `before=${before.toFixed(2)} after=${after.toFixed(2)}`);
const endD = rec[rec.length - 1];
check('對帳後預測與伺服器一致(誤差<0.6)', Math.abs(endD.pred - endD.srv) < 0.6, `pred=${endD.pred.toFixed(2)} srv=${endD.srv.toFixed(2)}`);

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

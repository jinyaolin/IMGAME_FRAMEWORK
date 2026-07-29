// GestureKit 單元 + 與真 LowPoly animator 整合(node,免伺服器)。node test-gesture-kit.js
global.THREE = require('./client/shared/vendor/three.min.js');
const LP = require('./client/shared/vendor/lowpoly.js');
const GK = require('./client/shared/gesture-kit.js');

let pass = 0, fail = 0;
const check = (n, c, d) => { console.log(`  ${c ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`); c ? pass++ : fail++; };

// 1) 驗證器擋壞規格
check('擋:未知通道', !GK.validate({ name: 'x', type: 'oneshot', dur: 1, tracks: { 'foo.x': [[0, 0], [1, 0]] } }).ok);
check('擋:u 不遞增', !GK.validate({ name: 'x', type: 'oneshot', dur: 1, tracks: { 'armR.x': [[0.5, 0], [0.2, 1]] } }).ok);
check('擋:超出安全幅度', !GK.validate({ name: 'x', type: 'oneshot', dur: 1, tracks: { 'armR.x': [[0, 0], [1, 9]] } }).ok);
check('擋:壞 easing', !GK.validate({ name: 'x', type: 'oneshot', dur: 1, tracks: { 'armR.x': [[0, 0], [1, 1, 'bounce']] } }).ok);
const wLoop = GK.validate({ name: 'x', type: 'loop', dur: 1, tracks: { 'armR.x': [[0, 0], [1, 0.5]] } });
check('警告:loop 首尾不同', wLoop.ok && wLoop.warnings.length === 1, JSON.stringify(wLoop.warnings));

// 2) oneshot:掛上真 animator → 通道動 → 播完自動回 idle
const ac = LP.animatedCharacter({ role: 'knight', seed: 7 });
const A = ac.animator;
const wave = { name: 'wave', type: 'oneshot', dur: 0.8, tracks: {
  'armR.z': [[0, 0], [0.2, 0.9, 'outQ'], [0.5, 0.5], [0.8, 0.95], [1, 0, 'ioQ']],
  'head.z': [[0, 0], [0.3, 0.15], [1, 0]] } };
const r1 = GK.compile(wave);
check('oneshot 編譯', r1.ok && r1.clip.oneShot && r1.clip.mask.length === 2);
A.clips.wave = r1.clip;
A.play('idle'); A.play('wave');
let maxArm = 0;
for (let i = 0; i < 30; i++) { A.update(1 / 60); const j = ac.char.getObjectByName('armR'); if (j) maxArm = Math.max(maxArm, Math.abs(j.rotation.z)); }
check('播放中 armR.z 有動(>0.3)', maxArm > 0.3, 'max=' + maxArm.toFixed(2));
for (let i = 0; i < 40; i++) A.update(1 / 60);   // 超過 dur
check('播完自動回落 idle', A.current === 'idle', 'current=' + A.current);

// 3) loop:成為當前動作、循環連續
const sway = { name: 'sway', type: 'loop', dur: 1.2, tracks: {
  'armL.x': [[0, 0], [0.25, 0.9], [0.75, -0.9], [1, 0]],
  'bob': [[0, 0], [0.5, 0.05], [1, 0]] } };
const r2 = GK.compile(sway);
check('loop 編譯', r2.ok && !r2.clip.oneShot);
A.clips.sway = r2.clip;
A.play('sway');
let ok = true, maxL = 0;
for (let i = 0; i < 200; i++) {
  A.update(1 / 60);
  if (A.current !== 'sway') ok = false;
  const j = ac.char.getObjectByName('armL'); if (j) maxL = Math.max(maxL, Math.abs(j.rotation.x));
}
check('loop 持續播放不被踢回', ok, 'current=' + A.current);
check('loop 期間角色真的在動(armL.x>0.4)', maxL > 0.4, 'max=' + maxL.toFixed(2));   // 修 _lastBase bug 前這裡會是 ~0
A.play('idle');
for (let i = 0; i < 30; i++) A.update(1 / 60);
check('loop 後可回 idle', A.current === 'idle');
// 循環邊界連續(u=0.999 與 u=0.001 取樣值接近)
const p1 = { tilt: 0 }, p2 = { tilt: 0 };
r2.clip.sample({ t: 1.199 }, Object.assign({ bob: 0 }, p1));
r2.clip.sample({ t: 1.201 }, Object.assign({ bob: 0 }, p2));
check('循環邊界連續', Math.abs(p1.tilt - p2.tilt) < 0.05, `${p1.tilt.toFixed(3)} vs ${p2.tilt.toFixed(3)}`);

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

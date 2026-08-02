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

// 4) 怪物 rig:驗證分流 + 掛上真 LowMonster animator(clips 插槽)
const LM = require('./client/shared/vendor/lowmonster.js');
check('擋:humanoid 用怪物通道', !GK.validate({ name: 'x', type: 'oneshot', dur: 1, tracks: { 'legFL.x': [[0, 0], [1, 0]] } }).ok);
check('擋:怪物 rig 用 humanoid 標量', !GK.validate({ name: 'x', type: 'oneshot', dur: 1, rig: 'monster_biped', tracks: { bob: [[0, 0], [1, 0]] } }).ok);
check('擋:未知 rig', !GK.validate({ name: 'x', type: 'oneshot', dur: 1, rig: 'monster_dragon', tracks: { 'torso.x': [[0, 0], [1, 0]] } }).ok);
check('過:quadruped 通道 + posY', GK.validate({ name: 'x', type: 'oneshot', dur: 1, rig: 'monster_quadruped', tracks: { 'legFL.x': [[0, 0], [1, 0]], posY: [[0, 0], [1, 0]] } }).ok);
check('monsterRig 對映(含 code 型無 skeleton)', GK.monsterRig('quadruped') === 'monster_quadruped' && GK.monsterRig(undefined) === 'monster_blob');

// oneshot:四足撲擊(腿/尾/posY 都動,播完自動退場回 idle)
const wolf = LM.build({ name: 'w', skeleton: 'quadruped', extras: [{ type: 'tail', count: 1, pos: 'rear', size: 0.7 }] }, { seed: 3 });
check('quadruped animator.rig', wolf.animator.rig === 'monster_quadruped');
check('第一條尾巴具名 tail(手勢通道可搖)', !!wolf.char.getObjectByName('tail'));
const pounce = { name: 'pounce', type: 'oneshot', dur: 0.6, rig: 'monster_quadruped', tracks: {
  'legFL.x': [[0, 0], [0.5, -1.1, 'outCubic'], [1, 0, 'ioQ']],
  'tail.z': [[0, 0], [0.3, 0.5], [0.6, -0.5], [1, 0]],
  posY: [[0, 0], [0.55, 0.32], [1, 0]] } };
const rp = GK.compile(pounce);
check('怪物 oneshot 編譯', rp.ok, JSON.stringify(rp.errors));
wolf.animator.clips.pounce = rp.clip;
wolf.animator.play('pounce');
check('play 後 current=pounce', wolf.animator.current === 'pounce');
const wolfY0 = wolf.char.position.y, tailRest = wolf.char.getObjectByName('tail').rotation.z;
let maxLeg = 0, maxTail = 0, maxUp = 0;
for (let i = 0; i < 30; i++) {
  wolf.animator.update(1 / 60);
  maxLeg = Math.max(maxLeg, Math.abs(wolf.char.getObjectByName('legFL').rotation.x));
  maxTail = Math.max(maxTail, Math.abs(wolf.char.getObjectByName('tail').rotation.z - tailRest));
  maxUp = Math.max(maxUp, wolf.char.position.y - wolfY0);
}
check('撲擊中前腿在動(>0.5)', maxLeg > 0.5, maxLeg.toFixed(2));
check('尾巴在甩(>0.3)', maxTail > 0.3, maxTail.toFixed(2));
check('posY 有騰空(>0.15)', maxUp > 0.15, maxUp.toFixed(2));
for (let i = 0; i < 20; i++) wolf.animator.update(1 / 60);   // 超過 dur
check('怪物 oneshot 播完回 idle', wolf.animator.current === 'idle' && wolf.animator.progress === 1);
check('腿/位置回 base', Math.abs(wolf.char.getObjectByName('legFL').rotation.x) < 0.05 && Math.abs(wolf.char.position.y - wolfY0) < 0.01);

// loop:blob 彈跳(縮放語言;play('idle') 收掉)
const slime = LM.build({ name: 's', skeleton: 'blob' }, { seed: 2 });
const bounce = { name: 'bounce', type: 'loop', dur: 0.9, rig: 'monster_blob', tracks: {
  sy: [[0, 1], [0.3, 0.8], [0.6, 1.2], [1, 1]], posY: [[0, 0], [0.5, 0.25], [1, 0]] } };
const rb = GK.compile(bounce);
check('怪物 loop 編譯', rb.ok, JSON.stringify(rb.errors));
slime.animator.clips.bounce = rb.clip;
slime.animator.play('bounce');
const slimeSy0 = slime.char.scale.y;
let minSy = 9, okCur = true;
for (let i = 0; i < 120; i++) {
  slime.animator.update(1 / 60);
  minSy = Math.min(minSy, slime.char.scale.y);
  if (slime.animator.current !== 'bounce') okCur = false;
}
check('loop 持續播放不被踢回', okCur, 'current=' + slime.animator.current);
check('sy 擠壓有生效(<0.9×base)', minSy < slimeSy0 * 0.9, (minSy / slimeSy0).toFixed(2));
slime.animator.play('idle');
for (let i = 0; i < 30; i++) slime.animator.update(1 / 60);
check('play(idle) 收掉 loop、縮放回 base(±6%)', slime.animator.current === 'idle' && Math.abs(slime.char.scale.y / slimeSy0 - 1) < 0.06);

// 缺件容忍:biped 手勢(armL)掛到四足/blob 不炸,共通通道照樣動
const armSwing = { name: 'swing', type: 'oneshot', dur: 0.5, rig: 'monster_biped', tracks: {
  'armL.x': [[0, 0], [0.5, -1.2], [1, 0]], 'torso.x': [[0, 0], [0.5, 0.4], [1, 0]] } };
slime.animator.clips.swing = GK.compile(armSwing).clip;
let torsoMax = 0, threw = false;
try {
  slime.animator.play('swing');
  for (let i = 0; i < 20; i++) { slime.animator.update(1 / 60); torsoMax = Math.max(torsoMax, Math.abs(slime.char.getObjectByName('torso').rotation.x)); }
} catch (e) { threw = true; }
check('缺件通道靜默忽略(不炸)', !threw);
check('共通通道(torso)照樣動', torsoMax > 0.2, torsoMax.toFixed(2));

// 內建 attack/hit 不受 clips 影響(回歸)
wolf.animator.play('attack');
for (let i = 0; i < 40; i++) wolf.animator.update(1 / 60);
check('內建 attack 播完回 idle(回歸)', wolf.animator.current === 'idle');

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

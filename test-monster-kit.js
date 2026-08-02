// test-monster-kit.js — LowMonster 怪物產生器單元回歸(不需啟動伺服器)
// 跑法:  node test-monster-kit.js
// 依賴:  真 THREE(vendor r149 可直接 require)→ 幾何/bbox 都是真值
//
// 契約:
//   C1 validate:壞 spec 給明確錯誤(骨架/enum/範圍),好 spec 通過
//   C2 三種骨架都能 build:落地(min.y≈0)、高度≈size 量級、具名部件齊
//   C3 決定性:同 spec+seed 完全一致;不同 seed 有差異(jitter 生效)
//   C4 動畫:walk 隨速度動(腿擺/blob 彈跳)、attack one-shot progress 0→1 回落、hit busy
//   C5 眼睛數/extras 如實生成;palette 有套用
//   C6 examples 全部可 build

global.THREE = require('./client/shared/vendor/three.min.js');
const LM = require('./client/shared/vendor/lowmonster.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\nCHECK ' + t); }

// ── C1 驗證 ──
section('1 validate');
check('缺 name 被擋', !LM.validate({ skeleton: 'biped' }).ok);
check('壞骨架被擋', !LM.validate({ name: 'x', skeleton: 'dragon' }).ok);
check('壞 enum 被擋(body.shape)', !LM.validate({ name: 'x', skeleton: 'biped', body: { shape: 'star' } }).ok);
check('超範圍被擋(size=9)', !LM.validate({ name: 'x', skeleton: 'biped', size: 9 }).ok);
check('壞色碼被擋', !LM.validate({ name: 'x', skeleton: 'biped', palette: { body: 'green' } }).ok);
check('extras 壞 type 被擋', !LM.validate({ name: 'x', skeleton: 'biped', extras: [{ type: 'laser' }] }).ok);
const vOK = LM.validate(LM.examples.goblin);
check('範例 goblin 通過驗證', vOK.ok, JSON.stringify(vOK.errors));

// ── C2 三骨架 build ──
section('2 build 三種骨架');
function bboxOf(char) { char.updateMatrixWorld(true); return new global.THREE.Box3().setFromObject(char); }
for (const skel of LM.skeletons) {
  const spec = { name: 't_' + skel, skeleton: skel, size: 1 };
  const r = LM.build(spec, { seed: 7 });
  const box = bboxOf(r.char);
  check(skel + ' 落地(|min.y|<0.02)', Math.abs(box.min.y) < 0.02, 'min.y=' + box.min.y.toFixed(3));
  check(skel + ' 高度合理(0.4–2.2)', box.max.y > 0.4 && box.max.y < 2.2, 'h=' + box.max.y.toFixed(2));
  check(skel + ' stats.parts>3', r.stats.parts > 3, 'parts=' + r.stats.parts);
}
const biped = LM.build({ name: 'b', skeleton: 'biped' }, { seed: 3 });
const namesB = []; biped.char.traverse(o => { if (o.name) namesB.push(o.name); });
check('biped 具名部件齊(torso/head/legL/legR/armL/armR)',
  ['torso', 'head', 'legL', 'legR', 'armL', 'armR'].every(n => namesB.includes(n)), namesB.join(','));
const quad = LM.build({ name: 'q', skeleton: 'quadruped' }, { seed: 3 });
const namesQ = []; quad.char.traverse(o => { if (o.name) namesQ.push(o.name); });
check('quadruped 四腿具名(legFL/FR/BL/BR)',
  ['legFL', 'legFR', 'legBL', 'legBR'].every(n => namesQ.includes(n)));

// ── C3 決定性 ──
section('3 seed 決定性');
function shapeSig(char) {
  const sig = []; char.updateMatrixWorld(true);
  char.traverse(o => { if (o.isMesh) sig.push(o.name + ':' + o.position.x.toFixed(4) + ',' + o.position.y.toFixed(4) + ',' + (o.scale.y).toFixed(4)); });
  return sig.join('|');
}
const g1 = LM.build(LM.examples.goblin, { seed: 42 });
const g2 = LM.build(LM.examples.goblin, { seed: 42 });
const g3 = LM.build(LM.examples.goblin, { seed: 43 });
check('同 seed 完全一致', shapeSig(g1.char) === shapeSig(g2.char));
check('不同 seed 有變異(jitter 生效)', shapeSig(g1.char) !== shapeSig(g3.char));

// ── C4 動畫 ──
section('4 animator');
function legRot(r, name) { let v = null; r.char.traverse(o => { if (o.name === name) v = o.rotation.x; }); return v; }
{
  const r = LM.build({ name: 'w', skeleton: 'biped' }, { seed: 1 });
  const rest = legRot(r, 'legL');
  r.animator.setSpeed(2);
  let maxDev = 0;
  for (let i = 0; i < 60; i++) { r.animator.update(1 / 60); maxDev = Math.max(maxDev, Math.abs(legRot(r, 'legL') - rest)); }
  check('biped walk 腿在擺(maxDev>0.2)', maxDev > 0.2, maxDev.toFixed(3));
  check('walk 狀態正確', r.animator.current === 'walk');
  r.animator.setSpeed(0);
  for (let i = 0; i < 30; i++) r.animator.update(1 / 60);
  check('停下回 idle 且腿回 base(<0.05)', r.animator.current === 'idle' && Math.abs(legRot(r, 'legL') - rest) < 0.05);
}
{
  const r = LM.build({ name: 'bl', skeleton: 'blob' }, { seed: 1 });
  const y0 = r.char.position.y;
  r.animator.setSpeed(2);
  let maxUp = 0;
  for (let i = 0; i < 90; i++) { r.animator.update(1 / 60); maxUp = Math.max(maxUp, r.char.position.y - y0); }
  check('blob walk 有彈跳(y 上升>0.05)', maxUp > 0.05, maxUp.toFixed(3));
}
{
  const r = LM.build({ name: 'atk', skeleton: 'quadruped' }, { seed: 1 });
  r.animator.play('attack');
  check('attack 開始 progress=0', r.animator.progress === 0);
  let mid = null;
  for (let i = 0; i < 40; i++) { r.animator.update(1 / 60); if (i === 12) mid = r.animator.progress; }
  check('attack 中段 progress∈(0,1)', mid > 0 && mid < 1, String(mid));
  check('attack 播完回 idle、progress=1', r.animator.current === 'idle' && r.animator.progress === 1);
  r.animator.play('hit');
  check('hit 期間 busy=true', r.animator.busy === true);
  for (let i = 0; i < 40; i++) r.animator.update(1 / 60);
  check('hit 播完 busy=false', r.animator.busy === false);
}

// ── C4b 遊戲控制面向不被動畫器吃掉(手機轉不動 bug 的回歸)──
section('4b 外部面向控制');
{
  const r = LM.build({ name: 'rot', skeleton: 'biped' }, { seed: 1 });
  r.char.rotation.y = 1.23;                      // 遊戲/lab 設定面向
  r.animator.setSpeed(2);
  for (let i = 0; i < 30; i++) r.animator.update(1 / 60);
  check('char.rotation.y 不被 update 重設', Math.abs(r.char.rotation.y - 1.23) < 1e-9, String(r.char.rotation.y));
  r.animator.play('attack');
  for (let i = 0; i < 40; i++) r.animator.update(1 / 60);
  check('one-shot 後仍保持面向', Math.abs(r.char.rotation.y - 1.23) < 1e-9);
}

// ── C5 五官/extras/配色 ──
section('5 五官與配色');
{
  const r = LM.build({ name: 'e3', skeleton: 'blob', eyes: { count: 3 }, extras: [{ type: 'tentacle', count: 4 }, { type: 'horn', count: 2 }] }, { seed: 5 });
  let eyes = 0, horns = 0; r.char.traverse(o => { if (/^eye\d/.test(o.name)) eyes++; if (/^horn/.test(o.name)) horns++; });
  check('三顆眼睛如實生成', eyes === 3, 'eyes=' + eyes);
  check('extras 有生成(horn×2)', horns === 2, 'horns=' + horns);
  check('stats.extras 記錄型別', r.stats.extras.join(',') === 'tentacle,horn');
}
{
  const r = LM.build({ name: 'c', skeleton: 'biped', palette: { body: '#ff0000', belly: '#00ff00', accent: '#0000ff', eye: '#ffffff' } }, { seed: 5 });
  let torsoHex = null; r.char.traverse(o => { if (o.name === 'torso') torsoHex = '#' + o.material.color.getHexString(); });
  check('palette.body 套用到軀幹', torsoHex === '#ff0000', torsoHex);
}

// ── C5b noise 頂點位移 ──
section('5b noise 頂點位移');
{
  const flat = LM.build({ name: 'n0', skeleton: 'biped', jitter: 0 }, { seed: 5 });
  const bump = LM.build({ name: 'n1', skeleton: 'biped', jitter: 0, noise: 0.3 }, { seed: 5 });
  const posOf = (r) => { let p = null; r.char.traverse(o => { if (o.name === 'torso') p = o.geometry.attributes.position; }); return p; };
  const a = posOf(flat), b = posOf(bump);
  let diff = 0; for (let i = 0; i < a.count; i++) diff = Math.max(diff, Math.abs(a.getX(i) - b.getX(i)));
  check('noise 有位移(maxΔx>0.01)', diff > 0.01, diff.toFixed(3));
  const bump2 = LM.build({ name: 'n1', skeleton: 'biped', jitter: 0, noise: 0.3 }, { seed: 5 });
  const c = posOf(bump2);
  let same = true; for (let i = 0; i < b.count; i++) if (b.getX(i) !== c.getX(i)) { same = false; break; }
  check('同 seed noise 決定性', same);
  const bump3 = LM.build({ name: 'n1', skeleton: 'biped', jitter: 0, noise: 0.3 }, { seed: 6 });
  const d = posOf(bump3);
  let anyDiff = false; for (let i = 0; i < b.count; i++) if (b.getX(i) !== d.getX(i)) { anyDiff = true; break; }
  check('不同 seed noise 不同(個體胖瘦有別)', anyDiff);
  check('noise 超範圍被擋', !LM.validate({ name: 'x', skeleton: 'biped', noise: 0.9 }).ok);
}

// ── C7 code 型怪物(img2three:自由 procedural builder)──
section('7 code 型');
{
  check('缺 code 被擋', !LM.validate({ name: 'c1', type: 'code' }).ok);
  check('code 語法錯誤被擋', !LM.validate({ name: 'c1', type: 'code', code: 'return (((' }).ok);
  check('code 型不要求 skeleton', LM.validate({ name: 'c1', type: 'code', code: 'const g = new THREE.Group(); return g; // pad to 30 chars' }).ok);
  const CODE = `
    const g = new THREE.Group();
    const M = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    let s = (seed >>> 0) || 1; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5 + rnd() * 0.1, 8, 6), M(0x884422)); torso.name = 'torso';
    torso.position.y = 0.8; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), M(0x996633)); head.name = 'head';
    head.position.y = 1.4 + rnd() * 0.15; g.add(head);
    for (const [nm, sx] of [['legL', -1], ['legR', 1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 6), M(0x663311));
      leg.geometry.translate(0, -0.25, 0); leg.name = nm; leg.position.set(sx * 0.22, 0.55, 0); g.add(leg);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), M(0xffcc00)); eye.name = 'eye0';
    eye.position.set(0.1, 1.5, 0.2); g.add(eye);
    return g;`;
  const spec = { name: 'codemon', type: 'code', skeleton: 'biped', code: CODE };
  check('code 型通過驗證', LM.validate(spec).ok, JSON.stringify(LM.validate(spec).errors));
  const r = LM.build(spec, { seed: 5 });
  const box = bboxOf(r.char); // char 在 root 內已接地
  check('code 型接地(|min.y|<0.02)', Math.abs(box.min.y) < 0.02, 'min.y=' + box.min.y.toFixed(3));
  check('stats 齊(height/parts/eyes)', r.stats.height > 1 && r.stats.parts === 5 && r.stats.eyes === 1, JSON.stringify(r.stats));
  const r2 = LM.build(spec, { seed: 5 });
  check('同 seed 決定性', shapeSig(r.char) === shapeSig(r2.char));
  const r3 = LM.build(spec, { seed: 9 });
  check('不同 seed 有變異(code 內 rnd 生效)', shapeSig(r.char) !== shapeSig(r3.char));
  // 命名對齊 → biped 動畫器可用;外部面向不被吃掉(C4b 同款)
  const rest = legRot(r, 'legL');
  r.char.rotation.y = 0.77;
  r.animator.setSpeed(2);
  let maxDev = 0;
  for (let i = 0; i < 60; i++) { r.animator.update(1 / 60); maxDev = Math.max(maxDev, Math.abs(legRot(r, 'legL') - rest)); }
  check('code 型 walk 腿在擺(部件命名對齊)', maxDev > 0.2, maxDev.toFixed(3));
  check('code 型面向不被動畫器重設', Math.abs(r.char.rotation.y - 0.77) < 1e-9);
  // 執行期錯誤 → 帶 errors 的例外(給 Kimi 修正)
  let threw = null;
  try { LM.build({ name: 'bad', type: 'code', code: 'return notDefinedVar; // pad pad pad' }, { seed: 1 }); } catch (e) { threw = e; }
  check('code 執行錯誤帶 errors 回饋', !!threw && Array.isArray(threw.errors), threw && threw.message);
}

// ── C6 examples ──
section('6 examples');
for (const k of Object.keys(LM.examples)) {
  let ok = true, err = '';
  try { LM.build(LM.examples[k], { seed: 9 }); } catch (e) { ok = false; err = e.message; }
  check('example ' + k + ' 可 build', ok, err);
}

console.log('\n' + (fail === 0 ? `ALL PASS (${pass}/${pass})` : `FAIL ${fail} / ${pass + fail}`));
process.exit(fail === 0 ? 0 : 1);

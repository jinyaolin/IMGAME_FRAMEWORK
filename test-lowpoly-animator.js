// test-lowpoly-animator.js — LowPoly.animator 的單元回歸測試（不需啟動伺服器）
// 跑法:  node test-lowpoly-animator.js
// 依賴:  無（THREE 用 stub；createAnimator 路徑不碰全域 THREE）
//
// 涵蓋 2026-07 動畫層改版（gaze 審視 R1-R8）的行為契約：
//   R1 body base 合成（遊戲預設縮放/傾斜不被蓋掉）
//   R2 一次性動作播完自動回落最近迴圈狀態
//   R3 play() 觸發 vs 鏡像語義（連段不吞招、網路重送不重播）
//   R6 步態頻率 ∝ 水平速度（不滑步）
//   R7 vv 漏鬥平滑（10Hz 階梯輸入不頻閃）
//   R8 progress getter（一次性動作進度 0..1）

const LOWPOLY_PATH = process.env.LOWPOLY || __dirname + '/client/shared/vendor/lowpoly.js';
require(LOWPOLY_PATH);
try { require(LOWPOLY_PATH.replace('lowpoly.js', 'lowphysical.js')); } catch {}   // 物理孿生獨立檔(physical)
const LowPoly = globalThis.LowPoly;
if (!LowPoly || !LowPoly.createAnimator) { console.error('FATAL: createAnimator 未載入'); process.exit(1); }

// ---- 最小 THREE stub ----
function v3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
    clone() { return v3(this.x, this.y, this.z); },
  };
}
function fakePart(name) { return { name, position: v3(), rotation: v3() }; }
function fakeChar() {
  const parts = {};
  for (const n of ['torso', 'head', 'armL', 'armR', 'legL', 'legR']) parts[n] = fakePart(n);
  return { getObjectByName: (n) => parts[n] || null, _parts: parts };
}
function newAnimator(configure) {
  const char = fakeChar();
  const body = { position: v3(), rotation: v3(), scale: v3(1, 1, 1) };
  const root = { position: v3() };
  if (configure) configure(body, root);          // 建立前先設定（base 快照的合法入口）
  const A = LowPoly.createAnimator(char, { body, root });
  return { A, char, body, root };
}
function step(A, dt, n = 1) { for (let i = 0; i < n; i++) A.update(dt); }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log(`  ${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
}

// ============================================================
// 1. R3 觸發 vs 鏡像：連段同名不吞招；網路已解析名字同名不重播
// ============================================================
{
  console.log('CHECK 1: play() 觸發/鏡像語義');
  // 觸發：combo 鏈連續回傳 attackR，第二次 play('attack') 必須重播（curT 歸零）
  const { A } = newAnimator();
  A.setCombo('punch', ['attackR', 'attackR']);
  A.play('attack');
  step(A, 0.05, 2);                              // curT = 0.10
  A.play('attack');
  check('連段同名觸發重播（curT 歸零）', A.curT === 0, `curT=${A.curT}`);
  // 鏡像：遠端送來的已解析名字，同名重送不重播
  const { A: A2 } = newAnimator();
  A2.play('attackR');
  step(A2, 0.05, 2);                             // curT = 0.10
  A2.play('attackR');
  check('鏡像同名不重播（網路語義）', Math.abs(A2.curT - 0.10) < 1e-9, `curT=${A2.curT.toFixed(2)}`);
  // 觸發：連續 'hit' 重播 hurt
  const { A: A3 } = newAnimator();
  A3.play('hit');
  step(A3, 0.05, 2);
  A3.play('hit');
  check('連續受擊重播 hurt', A3.current === 'hurt' && A3.curT === 0);
}

// ============================================================
// 2. R2 一次性動作播完自動回落最近迴圈狀態（不凍結死姿態）
// ============================================================
{
  console.log('CHECK 2: 自動回落 _lastBase');
  const { A, char } = newAnimator();
  A.play('run');                                 // _lastBase = 'run'
  A.play('attack');
  step(A, 1 / 60, 40);                           // 0.67s > dur 0.28
  check('播完自動回落', A.current === 'run', `current='${A.current}'`);
  // 回落 run 但 spd=0 → 站定包絡淡出到中立站姿（不凍結半跨步雕像）
  step(A, 1 / 60, 40);
  check('站定淡出到中立（非雕像）', Math.abs(char._parts.legL.rotation.x) < 0.05, `legL.x=${char._parts.legL.rotation.x.toFixed(3)}`);
  // 預設回落 idle（沒播過迴圈時）→ 呼吸恢復（姿態不凍結）
  const { A: A2, char: char2 } = newAnimator();
  A2.play('attack');
  step(A2, 1 / 60, 40);
  check('預設回落 idle', A2.current === 'idle');
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 30; i++) { A2.update(1 / 60); const y = char2._parts.torso.position.y; lo = Math.min(lo, y); hi = Math.max(hi, y); }
  check('回落 idle 後呼吸恢復（非死姿態）', hi - lo > 1e-4, `torso.y 振幅=${(hi - lo).toFixed(5)}`);
}

// ============================================================
// 3. R1 body base 合成：建立前設在 body 的 scale/傾斜/y 不被蓋掉
// ============================================================
{
  console.log('CHECK 3: body base 合成（建立前配置）');
  const { A, body } = newAnimator((b) => { b.scale.set(1.5, 1.5, 1.5); b.position.y = 0.3; b.rotation.x = 0.1; });
  step(A, 1 / 60, 10);
  check('scale 保留（與呼吸合成）', Math.abs(body.scale.x - 1.5) < 0.01, `scale.x=${body.scale.x.toFixed(4)}`);
  check('position.y 保留', Math.abs(body.position.y - 0.3) < 1e-9, `y=${body.position.y}`);
  check('rotation.x 保留（idle lean=0）', Math.abs(body.rotation.x - 0.1) < 1e-9, `rx=${body.rotation.x}`);
  // lean 疊加在 base 之上：播 run 並以 8u/s 移動（站定包絡滿載 → lean 0.12）
  A.play('run');
  let x = 0;
  for (let i = 0; i < 40; i++) { x += 8 / 60; A.root.position.x = x; A.update(1 / 60); }
  check('run lean 疊加在 base 上', Math.abs(body.rotation.x - 0.22) < 0.01, `rx=${body.rotation.x.toFixed(3)}`);
}

// ============================================================
// 4. R7 vv 漏鬥平滑：10Hz 階梯輸入（display 直設）跳姿不頻閃
//    模擬跳躍拋物線 y=max(0,14t-15t²)（JUMP_VEL=14, GRAVITY=30）
// ============================================================
{
  console.log('CHECK 4: 平滑 vs 10Hz 階梯 root.y（各 1s @60fps）');
  const jumpY = (t) => Math.max(0, 14 * t - 15 * t * t);
  function flickers(sampleFn) {
    const { A, root } = newAnimator();
    A.play('jump');
    const dt = 1 / 60;
    let flick = 0, wasHigh = false;
    for (let f = 0; f <= 60; f++) {
      const t = f * dt;
      root.position.y = sampleFn(t);
      A.update(f === 0 ? 0 : dt);
      const rise = clamp(A.vv / 9, 0, 1) * A._ctx.air;
      if (t > 0.45) break;
      if (rise > 0.5) wasHigh = true;
      if (wasHigh && rise < 0.05) { flick++; wasHigh = false; }
    }
    return flick;
  }
  const fSmooth = flickers(jumpY);
  const fStepped = flickers((t) => jumpY(Math.floor(t * 10) / 10));
  check('平滑輸入零頻閃', fSmooth === 0, `flick=${fSmooth}`);
  check('階梯輸入頻閃 ≤1（改版前為 4）', fStepped <= 1, `flick=${fStepped}`);
}

// ============================================================
// 5. R6 步態頻率 ∝ 水平速度（不滑步）；ref 速度維持原手感
// ============================================================
{
  console.log('CHECK 5: run 步頻 vs root 水平速度');
  function crossings(speed) {
    const { A, char, root } = newAnimator();
    A.play('run');
    let n = 0, prev = -1, x = 0;
    for (let f = 1; f <= 120; f++) {
      x += speed / 60;
      root.position.x = x;
      A.update(1 / 60);
      const v = char._parts.legL.rotation.x;
      if (prev <= 0 && v > 0) n++;
      prev = v;
    }
    return n;
  }
  const slow = crossings(2), fast = crossings(8);
  check('步頻隨速度增加', fast > slow, `2u/s=${slow} 次, 8u/s=${fast} 次`);
  check('8u/s（=ref）維持原手感（≈4-5 次/2s）', fast >= 3 && fast <= 6, `fast=${fast}`);
  check('速度比 ≈ 步頻比（允許 ramp 誤差）', fast >= slow * 2, `${fast} >= ${slow}*2`);
}

// ============================================================
// 6. R8 progress getter：一次性動作 0..1；迴圈恆 0
// ============================================================
{
  console.log('CHECK 6: progress getter');
  const { A } = newAnimator();
  A.play('attack');
  step(A, 0.05, 2);                              // curT = 0.10 / dur 0.28
  check('一次性動作進度 0..1', A.progress > 0.3 && A.progress < 0.4, `progress=${A.progress.toFixed(3)}`);
  step(A, 1 / 60, 40);                           // 播完 → 自動回落 idle
  check('回落迴圈後 progress=0', A.progress === 0, `progress=${A.progress}`);
}

// ============================================================
// 7. 披風飄動(hood/robin):主擺彈簧 + 行進波 + 落地回擺湧現
// ============================================================
function fakeCapeMesh() {
  // 迷你披風:領口兩點(y=1.08,應釘死)+ 下擺兩點(y=0.14,全開),lathe 局部座標(背 = -z)
  const arr = new Float32Array([
    -0.20, 1.08, -0.02,   0.20, 1.08, -0.02,    // 領口(左/右)
    -0.45, 0.14, -0.40,   0.45, 0.14, -0.40,    // 下擺(左/右,後方)
  ]);
  return { name: 'cape', position: v3(), rotation: v3(),
    geometry: { attributes: { position: { array: arr, needsUpdate: false } },
                boundingSphere: { radius: 1 }, computeBoundingSphere() {} } };
}
function newCapeAnimator() {
  const char = fakeChar();
  const cape = fakeCapeMesh();
  char._parts.cape = cape;
  const body = { position: v3(), rotation: v3(), scale: v3(1, 1, 1) };
  const root = { position: v3() };
  const A = LowPoly.createAnimator(char, { body, root });
  return { A, char, body, root, cape };
}
const HEM_Z = [8, 11], HEM_Y = [7, 10], HEM_X = [6, 9];   // 兩個下擺頂點在 array 裡的偏移
{
  console.log('CHECK 7: 披風飄動');
  const capeOf = A => A._flutter.find(f => f.name === 'cape');
  const { A, cape, root } = newCapeAnimator();
  const ft = capeOf(A), base = ft.base;

  check('boundingSphere 擴張(+0.35 防誤剔除)', Math.abs(cape.geometry.boundingSphere.radius - 1.35) < 1e-9, `r=${cape.geometry.boundingSphere.radius}`);
  check('無披風角色安全(無 cape 目標)', !capeOf(newAnimator().A));

  // 領口釘死不變式:劇烈運動後領口頂點仍 == base
  A.play('run');
  let x = 0;
  for (let f = 0; f < 60; f++) { x += 8 / 60; root.position.x = x; A.update(1 / 60); }
  const collarDrift = Math.max(Math.abs(cape.geometry.attributes.position.array[0] - base[0]),
                               Math.abs(cape.geometry.attributes.position.array[4] - base[4]));
  check('領口釘死(w=0 頂點不動)', collarDrift < 1e-6, `drift=${collarDrift}`);

  // spd 後擺:8u/s 的下擺 z 明顯比站定更往後(-z)
  const hemZ = (cap) => (cap.geometry.attributes.position.array[8] + cap.geometry.attributes.position.array[11]) / 2;
  const stand = newCapeAnimator();
  stand.A.play('run');
  for (let f = 0; f < 60; f++) stand.A.update(1 / 60);
  check('spd 後擺(8u/s 下擺明顯拖後)', hemZ(cape) < hemZ(stand.cape) - 0.1, `fast=${hemZ(cape).toFixed(3)} vs stand=${hemZ(stand.cape).toFixed(3)}`);

  // 下落上掀:root.y 持續下降 → 下擺 y 被掀起
  const fall = newCapeAnimator();
  let fy = 3;
  for (let f = 0; f < 30; f++) { fy -= 8 / 60; fall.root.position.y = fy; fall.A.update(1 / 60); }
  const hemY = (cap) => (cap.geometry.attributes.position.array[7] + cap.geometry.attributes.position.array[10]) / 2;
  check('下落上掀(下擺 y 抬升)', hemY(fall.cape) > 0.14 + 0.05, `hemY=${hemY(fall.cape).toFixed(3)} (base 0.14)`);

  // 落地回擺(湧現):落地後 θ 過衝到負值(不用任何落地事件)
  let minTheta = Infinity;
  for (let f = 0; f < 60; f++) { fall.A.update(1 / 60); minTheta = Math.min(minTheta, capeOf(fall.A).theta); }
  check('落地回擺(θ 過衝 < 0)', minTheta < -0.01, `minθ=${minTheta.toFixed(3)}`);

  // 行走左右晃 vs 站定消
  const walk = newCapeAnimator();
  walk.A.play('walk');
  let wx = 0, maxSway = 0;
  for (let f = 0; f < 120; f++) { wx += 4 / 60; walk.root.position.x = wx; walk.A.update(1 / 60); maxSway = Math.max(maxSway, Math.abs(capeOf(walk.A).s.sway)); }
  check('行走左右晃(sway 有擺盪)', maxSway > 0.03, `max|sway|=${maxSway.toFixed(3)}`);
  const idleC = newCapeAnimator();
  for (let f = 0; f < 120; f++) idleC.A.update(1 / 60);
  check('站定不晃(gaitAmp=0 → sway=0)', capeOf(idleC.A).s.sway === 0);

  // 每幀 needsUpdate
  cape.geometry.attributes.position.needsUpdate = false;
  A.update(1 / 60);
  check('每幀 needsUpdate', cape.geometry.attributes.position.needsUpdate === true);

  // 確定性(同流同形):兩個 animator 吃同一串 root 流 → 頂點陣列完全一致
  function scriptedRun() {
    const r = newCapeAnimator();
    let px = 0;
    for (let f = 0; f < 100; f++) {
      if (f < 30) { px += 4 / 60; r.root.position.x = px; }
      else if (f < 70) { const t = (f - 30) / 60; px += 8 / 60; r.root.position.x = px; r.root.position.y = Math.max(0, 14 * t - 15 * t * t); }
      else { px += 8 / 60; r.root.position.x = px; r.root.position.y = 0; }
      r.A.update(1 / 60);
    }
    return r;
  }
  const d1 = scriptedRun(), d2 = scriptedRun();
  let maxDiff = 0;
  for (let i = 0; i < 12; i++) maxDiff = Math.max(maxDiff, Math.abs(d1.cape.geometry.attributes.position.array[i] - d2.cape.geometry.attributes.position.array[i]));
  check('同流同形(三端確定性)', maxDiff === 0 && capeOf(d1.A).theta === capeOf(d2.A).theta, `maxDiff=${maxDiff}`);

  // 大 dt 有界(卡幀不炸)
  const big = newCapeAnimator();
  let bx = 0;
  for (let f = 0; f < 10; f++) { bx += 0.8; big.root.position.x = bx; big.A.update(0.1); }
  let allFinite = true;
  for (let i = 0; i < 12; i++) if (!Number.isFinite(big.cape.geometry.attributes.position.array[i])) allFinite = false;
  const bigFt = capeOf(big.A);
  check('大 dt 有界(頂點有限、θ 在保護界內)', allFinite && Math.abs(bigFt.theta) <= 1.4 + 1e-9 && Number.isFinite(bigFt.v), `θ=${bigFt.theta.toFixed(3)}`);
}

// ============================================================
// 8. 角色披風配置(真 THREE 無頭生成):五個新角色、顏色規則、舊角色不受影響
// ============================================================
{
  console.log('CHECK 8: 角色披風配置(真生成器)');
  globalThis.THREE = require(__dirname + '/client/shared/vendor/three.min.js');
  const hexOf = (mesh) => '#' + mesh.material.color.getHexString();
  const specs = [
    ['witch',  'body'], ['wizard', 'body'],
    ['prince', '#e74c3c'], ['frog', '#e74c3c'],
    ['elf',    '#145a32'],
  ];
  for (const [role, want] of specs) {
    const ch = LowPoly.character({ role, seed: 42 });
    const cape = ch.getObjectByName('cape');
    if (!cape) { check(`${role} 有披風`, false, '找不到 cape 部件'); continue; }
    const got = hexOf(cape);
    const expected = want === 'body' ? hexOf(ch.getObjectByName('torso')) : want;
    check(`${role} 披風顏色正確`, got === expected, `${got} (期望 ${expected}${want === 'body' ? '=上衣' : ''})`);
  }
  // 舊角色不受影響:knight 無披風;hood 披風仍與上衣同色
  const knight = LowPoly.character({ role: 'knight', seed: 42 });
  check('knight 無披風(未指定角色不受影響)', !knight.getObjectByName('cape'));
  const hoodCh = LowPoly.character({ role: 'hood', seed: 42 });
  check('hood 披風仍與上衣同色', hexOf(hoodCh.getObjectByName('cape')) === hexOf(hoodCh.getObjectByName('torso')));
  // 端到端:真生成器產出的披風能被動畫層註冊(_flutter 有 cape 目標)
  const witchCh = LowPoly.character({ role: 'witch', seed: 7 });
  const Aw = LowPoly.createAnimator(witchCh, { body: witchCh, root: witchCh });
  const wCape = Aw._flutter.find(f => f.name === 'cape');
  check('真披風被動畫層註冊(_flutter)', !!wCape);
  const vBefore = wCape.attr.version;   // 真 THREE 的 needsUpdate 是 setter(觸發 version++),不是可讀旗標
  Aw.update(1 / 60);
  check('真披風變形後頂點有限且已上傳(version++)', Number.isFinite(wCape.attr.array[0]) && wCape.attr.version > vBefore);
}

// ============================================================
// 9. 雲朵鬍子(模組化 beard 群組:BEARD_TBL 球串、鬍色=髮色、seed 抖動半徑)
// ============================================================
{
  console.log('CHECK 9: 雲朵鬍子(beard 群組)');
  const beardOf = (ch) => ch.getObjectByName('beard');
  const puffsOf = (g) => g ? g.children.filter(c => c.geometry && c.geometry.type === 'SphereGeometry') : [];
  const hexOf2 = (m) => '#' + m.material.color.getHexString();

  const wiz = LowPoly.character({ role: 'wizard', seed: 42 });
  const wizPuffs = puffsOf(beardOf(wiz));
  check('巫師雲朵鬍(long,≥9 顆)', wizPuffs.length >= 9, `${wizPuffs.length} 顆`);
  const wizHex = wizPuffs.length ? hexOf2(wizPuffs[0]) : '?';
  check('巫師鬍色全組一致', wizPuffs.length > 0 && wizPuffs.every(p => hexOf2(p) === wizHex), wizHex);

  const dwarfCh = LowPoly.character({ role: 'dwarf', seed: 42 });
  const dwPuffs = puffsOf(beardOf(dwarfCh));
  check('矮人炸鬍(bushy,≥11 顆)', dwPuffs.length >= 11, `${dwPuffs.length} 顆`);
  const dwShell = dwarfCh.getObjectByName('hairShell');
  check('矮人鬍色 = 髮色(與髮殼同色)', !!dwShell && dwPuffs.every(p => hexOf2(p) === hexOf2(dwShell)),
    dwPuffs.length ? hexOf2(dwPuffs[0]) : '?');

  // 確定性:位置由表格+頭型固定,半徑由 seed 抖動 → 同 seed 同半徑序列、換 seed 微差
  const radii = (ps) => JSON.stringify(ps.map(p => +p.geometry.parameters.radius.toFixed(6)));
  check('同 seed 同一把鬍(半徑序列一致)', radii(puffsOf(beardOf(LowPoly.character({ role: 'wizard', seed: 42 })))) === radii(wizPuffs));
  check('換 seed 鬍型微差', radii(puffsOf(beardOf(LowPoly.character({ role: 'wizard', seed: 43 })))) !== radii(wizPuffs));

  // 炸鬍比長鬍寬(BEARD_TBL:bushy 最大 |x| 0.24 vs long 0.18)
  const maxAbsX = (ps) => Math.max(...ps.map(p => Math.abs(p.position.x)));
  check('矮人炸鬍比巫師長鬍寬', maxAbsX(dwPuffs) > maxAbsX(wizPuffs), `${maxAbsX(dwPuffs).toFixed(2)} > ${maxAbsX(wizPuffs).toFixed(2)}`);
  check('騎士無鬍(角色隔離)', !beardOf(LowPoly.character({ role: 'knight', seed: 42 })));
}

// ============================================================
// 10. 髮型系統(模組化:單一 offset 髮殼 hairShell + userData.hairFall 垂片鉸點 /
//     仙子 hairBuns / 小紅帽 hairTwin + hood cowl;determinism + 角色隔離)
// ============================================================
{
  console.log('CHECK 10: 髮型系統(hairShell/hairFall/buns/twin)');
  const shellOf = (ch) => ch.getObjectByName('hairShell');

  // 公主:長髮 → 髮殼 + 垂片鉸點標記,垂片真的長
  const princess = LowPoly.character({ role: 'princess', seed: 42 });
  const pShell = shellOf(princess);
  check('公主有髮殼 hairShell', !!pShell);
  check('公主長髮標記垂片鉸點(userData.hairFall.pinY)', !!(pShell && pShell.userData.hairFall && isFinite(pShell.userData.hairFall.pinY)));
  pShell.geometry.computeBoundingBox();
  const pDrop = pShell.userData.hairFall.pinY - pShell.geometry.boundingBox.min.y;
  check('公主垂片夠長(鉸點下 ≥0.5)', pDrop >= 0.5, `drop=${pDrop.toFixed(2)}`);

  // 女巫:長髮同款
  const witchCh2 = LowPoly.character({ role: 'witch', seed: 42 });
  check('女巫髮殼 + 垂片標記', !!(shellOf(witchCh2) && shellOf(witchCh2).userData.hairFall));

  // 仙子:雙丸子 + 短殼(無垂片)
  const fairyCh = LowPoly.character({ role: 'fairy', seed: 42 });
  const fBuns = fairyCh.getObjectByName('hairBuns');
  check('仙子雙丸子 hairBuns(2 顆)', !!fBuns && fBuns.children.filter(c => c.geometry).length === 2);
  check('仙子短髮無垂片標記', !!shellOf(fairyCh) && !shellOf(fairyCh).userData.hairFall);

  // 小紅帽:雙辮 hairTwin(左右各一串)+ 兜帽 cowl 帶垂布標記;俠盜不連坐
  const hoodCh = LowPoly.character({ role: 'hood', seed: 42 });
  const twin = hoodCh.getObjectByName('hairTwin');
  check('小紅帽有雙辮 hairTwin', !!twin);
  const twinPuffs = twin ? twin.children.filter(c => c.isMesh) : [];
  const twinL = twinPuffs.filter(p => p.position.x < 0).length, twinR = twinPuffs.length - twinL;
  check('雙辮左右各一串(各 ≥5 顆)', twinL >= 5 && twinR >= 5, `L=${twinL} R=${twinR}`);
  const cowl = hoodCh.getObjectByName('hood');
  check('兜帽 cowl 帶垂布標記(跟長髮同機制)', !!(cowl && cowl.userData && cowl.userData.hairFall));
  check('俠盜不受 hood 連坐(無 hairTwin)', !LowPoly.character({ role: 'robin', seed: 42 }).getObjectByName('hairTwin'));

  // 短髮:殼存在無垂片;bald:無殼
  const princeCh = LowPoly.character({ role: 'prince', seed: 42 });
  check('王子短髮殼無垂片', !!shellOf(princeCh) && !shellOf(princeCh).userData.hairFall);
  check('騎士(bald)無髮殼', !shellOf(LowPoly.character({ role: 'knight', seed: 42 })));

  // 確定性:同 seed 髮殼幾何一致
  const p2 = LowPoly.character({ role: 'princess', seed: 42 });
  const ga = pShell.geometry.attributes.position.array, gb = shellOf(p2).geometry.attributes.position.array;
  let same = ga.length === gb.length;
  if (same) for (let i = 0; i < ga.length; i++) if (Math.abs(ga[i] - gb[i]) > 1e-9) { same = false; break; }
  check('同 seed 髮殼幾何一致', same);
}


// ============================================================
// 11. 髮飄動(髮殼垂片 mesh 變形 + 辮子 puff 串→巢狀鏈擺盪)— 與披風同訊號機制
// ============================================================
{
  console.log('CHECK 11: 髮飄動(垂片 + 辮子鏈)');
  const hairOf = (A, name) => A._flutter.find(f => f.name === name);
  const makeAnim = (role, seed) => {
    const ch = LowPoly.character({ role, seed });
    return { ch, A: LowPoly.createAnimator(ch, { body: ch, root: ch }) };
  };

  // 公主垂片:mesh 變形,spd 驅動 theta;垂片頂點動、頭皮(pinY 上)全剛
  const { ch: princess, A: Ap } = makeAnim('princess', 42);
  const pHair = hairOf(Ap, 'hairShell');
  check('公主髮殼垂片已註冊飄動', !!pHair);
  Ap.play('run');
  for (let f = 0; f < 60; f++) { princess.position.x += 8 / 60; Ap.update(1 / 60); }
  check('跑步後擺(theta>0.05)', pHair.theta > 0.05, `θ=${pHair.theta.toFixed(3)}`);
  const pinY = princess.getObjectByName('hairShell').userData.hairFall.pinY;
  let tipDrift = 0, scalpDrift = 0; const pArr = pHair.attr.array;
  for (let i = 0; i < pArr.length; i += 3) {
    const d = Math.hypot(pArr[i] - pHair.base[i], pArr[i + 1] - pHair.base[i + 1], pArr[i + 2] - pHair.base[i + 2]);
    if (pHair.base[i + 1] > pinY + 0.03) scalpDrift = Math.max(scalpDrift, d);
    else tipDrift = Math.max(tipDrift, d);
  }
  check('垂片頂點實際變形(>0.01)', tipDrift > 0.01, `max=${tipDrift.toFixed(3)}`);
  check('頭皮頂點剛性(pinY 上不動)', scalpDrift < 1e-4, `max=${scalpDrift.toFixed(5)}`);

  // 下落上掀:root.y 持續下降 → theta 比站定大
  const { ch: pFall, A: Apf } = makeAnim('princess', 42);
  const pFallHair = hairOf(Apf, 'hairShell');
  let fy = 3;
  for (let f = 0; f < 30; f++) { fy -= 8 / 60; pFall.position.y = fy; Apf.update(1 / 60); }
  check('下落上掀(theta 比站定大)', pFallHair.theta > hairOf(makeAnim('princess', 42).A, 'hairShell').theta + 0.05, `fall θ=${pFallHair.theta.toFixed(3)}`);

  check('女巫垂片已註冊', !!hairOf(makeAnim('witch', 42).A, 'hairShell'));

  // 小紅帽:puff 串 → 巢狀鏈 hairTwinL/R;跑步擺盪;兜帽垂布也柔軟
  const { ch: hood, A: Ah } = makeAnim('hood', 42);
  const bL = hairOf(Ah, 'hairTwinL'), bR = hairOf(Ah, 'hairTwinR');
  check('小紅帽雙辮已註冊(hairTwinL/R)', !!bL && !!bR);
  check('兜帽垂布(hood)已註冊', !!hairOf(Ah, 'hood'));
  check('辮鏈重掛為巢狀(segs≥5)', !!bL && bL.segs.length >= 5, bL ? `segs=${bL.segs.length}` : '');
  Ah.play('run');
  for (let f = 0; f < 60; f++) { hood.position.x += 8 / 60; Ah.update(1 / 60); }
  check('辮子跑步擺盪(theta>0.05)', bL.theta > 0.05, `θ=${bL.theta.toFixed(3)}`);
  check('辮根 rotation.x 已寫入', Math.abs(bL.segs[0].rotation.x - (bL.baseRot[0].x + bL.th[0])) < 1e-9, `rot.x=${bL.segs[0].rotation.x.toFixed(3)}`);

  // 串聯鏈:剛性段隨根(貼身不彎)、鞭狀末端 lag 根部 — 用匯出純函式驗(語義不變)
  const bs = LowPoly.animator._braidStep, BK = LowPoly.animator._knobs.braid;
  check('辮子串聯鏈已匯出(_braidStep)', typeof bs === 'function' && BK.joints >= 1);
  const bth = new Array(BK.joints + 1).fill(0), bvv = new Array(BK.joints + 1).fill(0);
  for (let f = 0; f < 3; f++) bs(bth, bvv, 0.30, BK, 1 / 60);
  const rigid = Math.max(0, Math.min((BK.rigidJoints | 0) || 0, BK.joints - 1));
  let rigidOK = true; for (let j = 1; j <= rigid; j++) if (Math.abs(bth[j] - bth[0]) > 1e-9) rigidOK = false;
  check('剛性段隨根部不彎(th[1..rigid]≈th[0])', rigidOK, bth.map(t => t.toFixed(4)).join(','));
  check('鞭狀末端 lag 根部(th[N]<th[0])', bth[BK.joints] < bth[0] - 0.005, `th[0]=${bth[0].toFixed(4)} th[N]=${bth[BK.joints].toFixed(4)}`);
  // 穩態收斂:長跑後全鏈一致(末端追上根部)
  const bth2 = new Array(BK.joints + 1).fill(0), bvv2 = new Array(BK.joints + 1).fill(0);
  for (let f = 0; f < 600; f++) bs(bth2, bvv2, 0.30, BK, 1 / 60);
  let bDev = 0; for (let j = 1; j <= BK.joints; j++) bDev = Math.max(bDev, Math.abs(bth2[j] - bth2[0]));
  check('辮子穩態末端追上根部(maxDev<0.02)', bDev < 0.02, `maxDev=${bDev.toFixed(4)}`);

  // 無長髮/辮子角色(knight)無對應目標
  const Ak = makeAnim('knight', 42).A;
  check('knight 無垂片/辮子飄動目標', !hairOf(Ak, 'hairShell') && !hairOf(Ak, 'hairTwinL'));
}

// ============================================================
// 12. rig v2 骨架(Phase 1):17 關節齊全、metadata 契約、剪影不變(bbox 對基線)、
//     同 seed 決定性(零新增 rnd)、'torso' 名解析、舊動畫路徑不變
// ============================================================
{
  console.log('CHECK 12: rig v2 骨架');
  const RIG_JOINTS = ['pelvis', 'spine', 'chest', 'neck', 'head',
    'armL', 'armR', 'elbowL', 'elbowR', 'legL', 'legR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];
  const bboxBaseline = require(__dirname + '/test/rig-baseline-bbox.json');

  // 12a. 全角色全關節 + rig metadata
  let jointsOK = true, metaOK = true;
  for (const role of LowPoly.roles) {
    const ch = LowPoly.character({ role, seed: 42 });
    const missing = RIG_JOINTS.filter(j => !ch.getObjectByName(j));
    if (missing.length) { jointsOK = false; console.log('  缺關節', role, missing); }
    const rig = ch.userData.rig;
    if (!rig || rig.version !== 2 || !rig.joints || !rig.seg || !rig.limits || !rig.colliders || !rig.masses) metaOK = false;
  }
  check('全角色 15 個 rig 關節齊全', jointsOK);
  check('全角色 userData.rig 契約完整(joints/seg/limits/colliders/masses)', metaOK);

  // 12b. 休息姿態剪影不變:世界 Box3 對改版前基線(torso 腰剖、四肢分段 → 容差 0.02)
  let maxDelta = 0, worstKey = '';
  for (const role of LowPoly.roles) {
    for (const seed of [42, 7]) {
      const key = `${role}/${seed}`;
      const ch = LowPoly.character({ role, seed });
      ch.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(ch);
      const b = bboxBaseline[key];
      const d = Math.max(
        ...box.min.toArray().map((v, i) => Math.abs(v - b.min[i])),
        ...box.max.toArray().map((v, i) => Math.abs(v - b.max[i])));
      if (d > maxDelta) { maxDelta = d; worstKey = key; }
    }
  }
  check('休息姿態 Box3 與基線一致(Δ≤0.02)', maxDelta <= 0.02, `maxΔ=${maxDelta.toFixed(4)} @ ${worstKey}`);

  // 12c. 同 seed 決定性:頭/髮/軀幹頂點陣列逐位元一致(零新增 rnd 的直接證據)
  const geoSig = (ch) => {
    const parts = [];
    ch.traverse(o => { if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) parts.push(Float32Array.from(o.geometry.attributes.position.array)); });
    return parts;
  };
  const sigA = geoSig(LowPoly.character({ role: 'princess', seed: 99 }));
  const sigB = geoSig(LowPoly.character({ role: 'princess', seed: 99 }));
  let detOK = sigA.length === sigB.length;
  if (detOK) for (let i = 0; i < sigA.length && detOK; i++) {
    const a = sigA[i], b = sigB[i];
    if (a.length !== b.length) { detOK = false; break; }
    for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) { detOK = false; break; }
  }
  check('同 seed 生成逐頂點位元一致(零新增 rnd)', detOK, `meshes=${sigA.length}`);

  // 12d. 'torso' 名解析到單一整塊膠囊(cape 比色/CHECK 8 依賴);torsoHi 已併入,不再獨立存在
  const chT = LowPoly.character({ role: 'witch', seed: 42 });
  const torso = chT.getObjectByName('torso'), torsoHi = chT.getObjectByName('torsoHi');
  chT.updateMatrixWorld(true);
  const torsoBox = new THREE.Box3().setFromObject(torso);
  check("'torso' 名解析為單一整塊(torsoHi 已併入),涵蓋全軀幹高度",
    !!torso && !torsoHi && (torsoBox.max.y - torsoBox.min.y) > 0.55 * chT.scale.x,
    `torsoHi=${torsoHi ? '仍在' : '已併'} h=${((torsoBox.max.y - torsoBox.min.y) / chT.scale.x).toFixed(2)}`);

  // 12e. 關節世界位置抽查(腳底 y=0 不變式):肩 1.02、膝 .25、踝 .06、腳掌底 ≈0
  const chJ = LowPoly.character({ role: 'knight', seed: 42 });
  chJ.updateMatrixWorld(true);
  const wpos = (n) => chJ.getObjectByName(n).getWorldPosition(new THREE.Vector3());
  check('肩關節高度(含縮放)= 1.02×scale', Math.abs(wpos('armL').y - 1.02 * chJ.scale.x) < 0.01, `y=${(wpos('armL').y / chJ.scale.x).toFixed(3)}`);
  check('膝關節高度(含縮放)= 0.25×scale', Math.abs(wpos('kneeL').y - 0.25 * chJ.scale.x) < 0.01, `y=${(wpos('kneeL').y / chJ.scale.x).toFixed(3)}`);
  check('踝關節高度(含縮放)= 0.06×scale', Math.abs(wpos('ankleL').y - 0.06 * chJ.scale.x) < 0.01, `y=${(wpos('ankleL').y / chJ.scale.x).toFixed(3)}`);
  // 腳掌底貼地:腳 mesh 世界 bbox 底 ≈ 0
  const footMesh = chJ.getObjectByName('ankleL').children.find(o => o.geometry);
  const fb = new THREE.Box3().setFromObject(footMesh);
  check('腳掌底貼地(bbox.min.y≈0)', Math.abs(fb.min.y) < 0.01, `min.y=${fb.min.y.toFixed(4)}`);

  // 12f. 舊動畫路徑在 rig 角色上仍走 v1:animator 找得到 torso/armL/legL/head/cape
  const chA = LowPoly.character({ role: 'witch', seed: 7 });
  const AA = LowPoly.createAnimator(chA, { body: chA, root: chA });
  check('animator v1 部件查找在 rig 角色上完整',
    !!(AA.parts.torso && AA.parts.armL && AA.parts.legL && AA.parts.head && AA.parts.cape));
  const tsk = AA._torsoSkin;
  check('軀幹彈性蒙皮已註冊(_torsoSkin,權重下 0→上 1)',
    !!(tsk && Math.min(...tsk.w) < 0.05 && Math.max(...tsk.w) > 0.9),
    tsk ? `wMin=${Math.min(...tsk.w).toFixed(2)} wMax=${Math.max(...tsk.w).toFixed(2)}` : 'null');
}

// ============================================================
// 13. SkeletonDriver + IK(Phase 2):ikSolve 精確、過伸鉗制、膝方向;
//     rig 角色走 v2 骨骼驅動(chest 吸收 torso.*、骨盆 bob、落地屈膝)
// ============================================================
{
  console.log('CHECK 13: SkeletonDriver + IK');
  const ik = LowPoly.animator._ikSolve, fk = LowPoly.animator._fkLeg;
  const L1 = 0.21, L2 = 0.19;

  // 13a. 可及目標 FK 一致性:IK 解代回 FK == 原目標(±1e-9)
  let fkOK = true, worst = 0;
  for (const [fx, fy] of [[0, 0.10], [0.12, 0.20], [-0.06, 0.30], [0.02, 0.15], [0.18, 0.25]]) {
    const hip = [0, 0.46, 0], foot = [0, fy, fx];
    const s = ik(hip, foot, L1, L2);
    const got = fk(hip, s.hipX, s.kneeX, L1, L2).foot;
    const err = Math.hypot(got[0] - foot[0], got[1] - foot[1], got[2] - foot[2]);
    worst = Math.max(worst, err);
    if (err > 1e-9) fkOK = false;
  }
  check('ikSolve 可及目標 FK 一致(err<1e-9)', fkOK, `worst=${worst.toExponential(2)}`);

  // 13b. 過伸鉗制:目標超出腿長 → clamped,且解停在膝保留可及距離
  {
    const hip = [0, 0.46, 0], foot = [0, 0.46 - (L1 + L2) * 1.3, 0.2];   // 遠得碰不到
    const s = ik(hip, foot, L1, L2);
    const got = fk(hip, s.hipX, s.kneeX, L1, L2).foot;
    const d = Math.hypot(got[2] - hip[2], hip[1] - got[1]);
    const maxD = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(0.09));
    check('過伸目標被鉗制(clamped)', s.clamped === true);
    check('鉗制後落點=膝保留可及距離', Math.abs(d - maxD) < 1e-9, `d=${d.toFixed(6)} maxD=${maxD.toFixed(6)}`);
    check('膝保留角 ≈ reserve', Math.abs(s.kneeX - 0.09) < 0.02, `kneeX=${s.kneeX.toFixed(4)}`);
  }

  // 13c. 膝方向:前下方目標 → 膝屈曲為正(向後勾,不反折)
  {
    const s = ik([0, 0.46, 0], [0, 0.10, 0.15], L1, L2);
    check('膝屈曲為正(向後勾)', s.kneeX > 0, `kneeX=${s.kneeX.toFixed(4)}`);
    const kn = fk([0, 0.46, 0], s.hipX, s.kneeX, L1, L2).knee;
    const lineZ = 0.15 * (0.46 - kn[1]) / 0.36;   // 髖(0.46,0)→腳(0.10,0.15) 連線在膝高度的 z
    check('膝蓋前凸(在髖→腳連線前側,人腿彎法)', kn[2] > lineZ, `kneeZ=${kn[2].toFixed(3)} lineZ=${lineZ.toFixed(3)}`);
  }

  // 13d. rig 角色偵測走 v2;落地屈膝(kneeL.x>0.3)且 dropY 與 v1 完全相同
  {
    const rigCh = LowPoly.character({ role: 'knight', seed: 42 });
    const rA = LowPoly.createAnimator(rigCh, { body: rigCh, root: rigCh });
    check('rig 角色偵測為 v2(rig/joints 就緒)', !!rA.rig && !!rA.joints.kneeL && !!rA.jrest.pelvis);
    const { A: v1A } = newAnimator();            // stub 角色(無 rig)→ v1
    v1A.play('land'); rA.play('land');
    for (let i = 0; i < 3; i++) { v1A.update(0.01); rA.update(0.01); }   // t=0.03(u≈0.14,屈膝近峰值)
    const kneeFlex = rA.joints.kneeL.rotation.x;
    check('v2 落地屈膝(kneeL.x>0.3)', kneeFlex > 0.3, `kneeL.x=${kneeFlex.toFixed(3)}`);
    check('落地 dropY 與 v1 完全相同', Math.abs(v1A.pose.dropY - rA.pose.dropY) < 1e-9,
      `v1=${v1A.pose.dropY.toFixed(5)} v2=${rA.pose.dropY.toFixed(5)}`);
    // 落地結束膝蓋回直
    for (let i = 0; i < 30; i++) rA.update(0.01);
    check('落地後膝蓋回直(|x|<0.05)', Math.abs(rA.joints.kneeL.rotation.x) < 0.05, `x=${rA.joints.kneeL.rotation.x.toFixed(3)}`);
  }

  // 13e. 舊 clip 的 torso.* 由 chest 吸收,torsoLo mesh 不轉(腰縫不開)
  {
    const rigCh = LowPoly.character({ role: 'knight', seed: 42 });
    const rA = LowPoly.createAnimator(rigCh, { body: rigCh, root: rigCh });
    rA.play('attackR');
    for (let i = 0; i < 12; i++) rA.update(0.01);   // t=0.12(u≈0.43,扭腰峰值)
    check('chest 吸收 torso.y(扭腰)', rA.joints.chest.rotation.y > 0.15, `chest.y=${rA.joints.chest.rotation.y.toFixed(3)}`);
    check('torsoLo mesh 不跟著轉(腰縫不開)', Math.abs(rigCh.getObjectByName('torso').rotation.y) < 1e-9,
      `torso.y=${rigCh.getObjectByName('torso').rotation.y}`);
  }

  // 13f. bob 走骨盆(v2):idle 呼吸 → pelvis.y 隨 bob 偏離 rest
  {
    const rigCh = LowPoly.character({ role: 'knight', seed: 42 });
    const rA = LowPoly.createAnimator(rigCh, { body: rigCh, root: rigCh });
    for (let i = 0; i < 10; i++) rA.update(0.05);   // t=0.5 → sin(1.5)≈0.997 → bob≈0.0199
    const dy = rA.joints.pelvis.position.y - rA.jrest.pelvis.pos.y;
    check('v2 bob 寫入骨盆(≈+0.02)', dy > 0.01 && dy < 0.03, `dy=${dy.toFixed(4)}`);
    check('v1 路徑不動骨盆(stub 無 rig)', !newAnimator().A.rig);
  }
}

// ============================================================
// 14. GaitSolver(Phase 3):支撐腳世界座標不動(不滑步)、步頻 ∝ 速度、
//     骨盆硬約束、起步半步、煞車收腳、決定性、原地轉身步
// ============================================================
{
  console.log('CHECK 14: GaitSolver');

  // 驅動器:等速直線跑 root,記錄每幀狀態(真 THREE,rig 角色)
  function drive(clip, speed, secs, opts) {
    opts = opts || {};
    const ch = LowPoly.character({ role: opts.role || 'knight', seed: opts.seed || 42 });
    const root = new THREE.Group(); root.add(ch);
    const A = LowPoly.createAnimator(ch, { body: ch, root });
    A.play(clip);
    const dt = 1 / 60, rec = { frames: [], steps: null, A, firstW: null };
    for (let t = 0; t < secs; t += dt) {
      root.position.z = t * speed;
      A.update(dt);
      if (rec.firstW == null && A._gait.steps.length) { rec.firstW = A._gait.steps[0].w.slice(); rec.firstRootZ = root.position.z; }
      rec.frames.push({
        modeL: A._gait.feet.L.mode, modeR: A._gait.feet.R.mode,
        wL: A._gait.out.footWL && A._gait.out.footWL.slice(),
        wR: A._gait.out.footWR && A._gait.out.footWR.slice(),
        py: A._gait.pelvis[1], amp: A._ctx.gaitAmp,
      });
    }
    rec.steps = A._gait.steps.slice();
    return rec;
  }

  // 14a. 不滑步:walk 4 u/s 與 run 8 u/s,支撐期腳世界座標幀間 |Δ| < 1e-6
  for (const [clip, spd, name] of [['walk', 4, 'walk 4u/s'], ['run', 8, 'run 8u/s']]) {
    const rec = drive(clip, spd, 2.0);
    let maxD = 0, stanceFrames = 0;
    for (let i = 1; i < rec.frames.length; i++) {
      for (const m of ['L', 'R']) {
        const mode = m === 'L' ? rec.frames[i].modeL : rec.frames[i].modeR;
        const prevMode = m === 'L' ? rec.frames[i - 1].modeL : rec.frames[i - 1].modeR;
        if (mode !== 'stance' || prevMode !== 'stance') continue;   // 只比「連續支撐」幀
        const w0 = m === 'L' ? rec.frames[i - 1].wL : rec.frames[i - 1].wR;
        const w1 = m === 'L' ? rec.frames[i].wL : rec.frames[i].wR;
        if (w0 && w1) {
          stanceFrames++;
          maxD = Math.max(maxD, Math.hypot(w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]));
        }
      }
    }
    check(`${name} 支撐腳世界定點(|Δ|<1e-6,${stanceFrames} 幀)`, maxD < 1e-6, `maxΔ=${maxD.toExponential(2)}`);
  }

  // 14b. 步頻 ∝ 速度(步長夾限 → 高頻碎步):run 步數明顯多於 walk
  {
    const s4 = drive('walk', 4, 2.0).A._gait.stepCount;
    const s8 = drive('run', 8, 2.0).A._gait.stepCount;
    check('步頻隨速度提高(run > 1.3×walk)', s8 > s4 * 1.3, `walk=${s4} run=${s8}`);
    check('walk 4u/s 有穩定步頻(≥8 步/2s)', s4 >= 8, `steps=${s4}`);
  }

  // 14c. 骨盆硬約束:任何一幀 pelvis.y ≤ 腳踝 + 膝保留可及長
  {
    const rec = drive('walk', 4, 2.0);
    const maxD = Math.sqrt(0.21 * 0.21 + 0.19 * 0.19 + 2 * 0.21 * 0.19 * Math.cos(0.09));
    let worst = -1;
    for (const f of rec.frames) worst = Math.max(worst, f.py);
    check('骨盆高度受腿長硬約束', worst <= 0.06 + maxD + 1e-6, `maxPy=${worst.toFixed(4)} 上限=${(0.06 + maxD).toFixed(4)}`);
    // 且不懸浮:走路時 pelvis.y 明顯低於站高(有 crouch)
    let minPy = 9;
    for (const f of rec.frames) if (f.amp > 0.8) minPy = Math.min(minPy, f.py);
    check('步態中有蹲伏(pelvis.y < 站高−0.005)', minPy < 0.46 - 0.005, `minPy=${minPy.toFixed(4)}`);
  }

  // 14d. 起步半步:第一步「觸地點 − 當時骨盆」的前進距離 < 穩態步距的 60%
  {
    const rec = drive('walk', 4, 2.5);
    if (rec.firstW && rec.A._gait.stepCount >= 3) {
      const firstD = Math.abs(rec.firstW[2] - rec.firstRootZ);           // 相對當時骨盆的前置量
      const n = rec.steps.length;
      const steady = Math.abs(rec.steps[n - 1].w[2] - rec.steps[n - 2].w[2]);   // 末段相鄰步距
      check('起步半步(<穩態 60%)', firstD < steady * 0.6, `first=${firstD.toFixed(3)} steady=${steady.toFixed(3)}`);
    } else {
      check('起步半步(步數足夠)', false, `steps=${rec.A._gait.stepCount}`);
    }
  }

  // 14e. 煞車收腳:急停後雙腳回骨盆正下、amp 歸零
  {
    const ch = LowPoly.character({ role: 'knight', seed: 42 });
    const root = new THREE.Group(); root.add(ch);
    const A = LowPoly.createAnimator(ch, { body: ch, root });
    A.play('run');
    const dt = 1 / 60;
    let z = 0;
    for (let t = 0; t < 1.2; t += dt) { z += 8 * dt; root.position.z = z; A.update(dt); }   // 全速
    for (let t = 0; t < 0.4; t += dt) { A.update(dt); }                                     // 急停(root 不動)
    for (let t = 0; t < 1.2; t += dt) A.update(dt);
    const fL = A._gait.footL, fR = A._gait.footR;
    const midX = (fL[0] + fR[0]) / 2, midZ = (fL[2] + fR[2]) / 2;   // 與 solver 同例:以雙腳中點量收攏
    const dL = Math.hypot(fL[0] - midX, fL[2] - midZ), dR = Math.hypot(fR[0] - midX, fR[2] - midZ);
    check('急停後雙腳收攏(距中點 <0.24)', dL < 0.24 && dR < 0.24, `L=${dL.toFixed(3)} R=${dR.toFixed(3)}`);
    check('急停後步態淡出(amp<0.05)', A._ctx.gaitAmp < 0.05, `amp=${A._ctx.gaitAmp.toFixed(3)}`);
  }

  // 14f. 決定性:同一 root 流跑兩次,骨盆軌跡逐位元一致
  {
    const run1 = drive('walk', 4, 1.5), run2 = drive('walk', 4, 1.5);
    let detOK = run1.frames.length === run2.frames.length;
    if (detOK) for (let i = 0; i < run1.frames.length; i++) {
      if (run1.frames[i].py !== run2.frames[i].py) { detOK = false; break; }
    }
    check('同輸入串骨盆軌跡逐位元一致', detOK);
  }

  // 14g. 原地轉身步:spd≈0 + 持續轉向 → 有換步
  {
    const ch = LowPoly.character({ role: 'knight', seed: 42 });
    const root = new THREE.Group(); root.add(ch);
    const A = LowPoly.createAnimator(ch, { body: ch, root });
    A.play('walk');
    const dt = 1 / 60;
    // 先走一小段讓 amp 起來
    for (let t = 0; t < 0.6; t += dt) { root.position.z = t * 2; A.update(dt); }
    const before = A._gait.steps.length;
    // 停下但持續轉身
    for (let t = 0; t < 1.2; t += dt) { ch.rotation.y += 2.2 * dt; A.update(dt); }
    check('原地轉身產生換步', A._gait.steps.length > before, `+${A._gait.steps.length - before} 步`);
  }
}

// ============================================================
// 15. 混合器(Phase 4):loop cross-fade 連續、one-shot 遮罩疊加(邊走邊揮拳)、
//     語義不變、起步無半步、彎肘隨速度
// ============================================================
{
  console.log('CHECK 15: 混合器');
  const mkRig = (clip) => {
    const ch = LowPoly.character({ role: 'knight', seed: 42 });
    const root = new THREE.Group(); root.add(ch);
    const A = LowPoly.createAnimator(ch, { body: ch, root });
    if (clip) A.play(clip);
    return { A, root, ch };
  };
  const driveAt = (root, A, spd, secs, dt = 1 / 60) => {
    for (let t = 0; t < secs; t += dt) { root.position.z += spd * dt; A.update(dt); }
  };

  // 15a. idle→walk cross-fade:_prevW 從 1 遞減到 0;fade 期間 pose 振幅不超過穩態走(無跳變)
  {
    const { A, root } = mkRig('idle');
    driveAt(root, A, 4, 0.4);
    A.play('walk');
    check('cross-fade 啟動(_prevW=1)', A._prevW === 1 && A._prevLoop === 'idle');
    const maxD = (frames) => {
      let m = 0, prev = A.pose.armL.x;
      for (let i = 0; i < frames; i++) { driveAt(root, A, 4, 1 / 60); m = Math.max(m, Math.abs(A.pose.armL.x - prev)); prev = A.pose.armL.x; }
      return m;
    };
    const fadeD = maxD(30);       // fade 0.5s 內
    const steadyD = maxD(30);     // 穩態 0.5s
    check('fade 期間振幅 ≤ 穩態(無額外跳變)', fadeD <= steadyD + 0.02, `fade=${fadeD.toFixed(3)} steady=${steadyD.toFixed(3)}`);
    driveAt(root, A, 4, 0.2);
    check('fade 於 ~fadeTime 結束(_prevW→0)', A._prevW === 0, `prevW=${A._prevW}`);
  }

  // 15b. 邊走邊揮拳:one-shot 疊加中雙腿繼續走、拳通道主導
  {
    const { A, root } = mkRig('walk');
    driveAt(root, A, 4, 1.0);
    const steps0 = A._gait.stepCount;
    A.play('attackR');
    check('疊加中 current=attackR 且 busy', A.current === 'attackR' && A.busy);
    // 揮拳峰值(u≈0.42)
    for (let i = 0; i < 7; i++) driveAt(root, A, 4, 1 / 60);
    check('拳通道主導(|armR.x|>0.8)', Math.abs(A.pose.armR.x) > 0.8, `armR.x=${A.pose.armR.x.toFixed(2)}`);
    let kneeVar = 0, prevK = A.pose.kneeL.x;
    for (let i = 0; i < 14; i++) { driveAt(root, A, 4, 1 / 60); kneeVar = Math.max(kneeVar, Math.abs(A.pose.kneeL.x - prevK)); prevK = A.pose.kneeL.x; }
    check('出拳中雙腿繼續走(kneeL 持續變化)', kneeVar > 0.05, `kneeVar=${kneeVar.toFixed(3)}`);
    A.play('attack');   // 第二拳(觸發重播)
    driveAt(root, A, 4, 0.4);
    check('連續兩拳期間仍有新步', A._gait.stepCount > steps0, `+${A._gait.stepCount - steps0} 步`);
  }

  // 15c. 一拳播完自動回 walk,busy 解除,步態繼續
  {
    const { A, root } = mkRig('walk');
    driveAt(root, A, 4, 0.8);
    A.play('attackR');
    driveAt(root, A, 4, 0.35);
    check('播完回 base loop(current=walk)', A.current === 'walk', `current=${A.current}`);
    check('busy 解除', !A.busy);
    const s0 = A._gait.stepCount;
    driveAt(root, A, 4, 0.5);
    check('回落後步態繼續', A._gait.stepCount > s0);
  }

  // 15d. 觸發/鏡像/progress 語義在 rig 角色上不變
  {
    const { A, root } = mkRig('idle');
    A.setCombo('punch', ['attackR', 'attackR']);
    A.play('attack');
    driveAt(root, A, 0, 0.10);
    A.play('attack');
    check('觸發同名重播(curT 歸零)', A.curT < 0.05, `curT=${A.curT.toFixed(3)}`);
    const { A: A2, root: r2 } = mkRig('idle');
    A2.play('attackR');
    driveAt(r2, A2, 0, 0.10);
    A2.play('attackR');
    check('鏡像同名不重播', A2.curT >= 0.09, `curT=${A2.curT.toFixed(3)}`);
    check('progress 於 [0,1] 且 ≈curT/dur', A2.progress > 0 && A2.progress < 1 &&
      Math.abs(A2.progress - A2.curT / A2.clips.attackR.dur) < 1e-6, `progress=${A2.progress.toFixed(3)}`);
  }

  // 15e. idle→walk 起步無半步:fade 初期(amp 未過 0.5)不出步
  {
    const { A, root } = mkRig('idle');
    driveAt(root, A, 4, 0.3);
    A.play('walk');
    driveAt(root, A, 4, 0.15);
    check('fade 初期不出步(amp 未達門檻)', A._gait.stepCount === 0, `steps=${A._gait.stepCount}`);
    driveAt(root, A, 4, 0.6);
    check('amp 達標後正常出步', A._gait.stepCount > 0, `steps=${A._gait.stepCount}`);
  }

  // 15f. 彎肘隨速度:run 明顯大於 walk 且單調(肘 .x 負=前臂往前抬,取絕對值量深度)
  {
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const elbowAt = (clip, spd) => {
      const { A, root } = mkRig(clip);
      const vals = [];
      for (let t = 0; t < 1.0; t += 1 / 60) { root.position.z += spd / 60; A.update(1 / 60); if (t > 0.4) vals.push(-A.pose.elbowL.x); }
      return mean(vals);
    };
    const e4 = elbowAt('walk', 4), e65 = elbowAt('run', 6.5), e9 = elbowAt('run', 9);
    check('彎肘深度單調隨速度(walk<中速<高速)', e4 < e65 && e65 < e9,
      `4u/s=${e4.toFixed(2)} 6.5=${e65.toFixed(2)} 9=${e9.toFixed(2)}`);
    check('高速彎肘達短跑梯度(>0.7 rad 前抬)', e9 > 0.7, `e9=${e9.toFixed(2)}`);
    check('彎肘方向為前抬(elbowL.x 為負)', e4 > 0 && e9 > 0);
  }
}

// CHECK 16(物理孿生/RL agent)需要真 THREE + RAPIER(ESM)→ 動態載入,跑完才 exit
(async () => {
  {
    console.log('CHECK 16: 物理孿生 / RL agent API');
    const THREE = require(__dirname + '/client/shared/vendor/three.min.js');
    globalThis.THREE = THREE;
    const RAPIER = (await import(__dirname + '/client/shared/vendor/rapier3d-compat.mjs')).default;
    await RAPIER.init();

    // 16a kinematic 跟隨:動畫驅動,物理體貼著視覺骨盆走
    {
      const p = LowPoly.physical({ role: 'knight', seed: 42, mode: 'kinematic', RAPIER });
      p.animator.play('walk');
      let maxErr = 0;
      const vw = new THREE.Vector3();
      for (let i = 0; i < 120; i++) {
        p.animator.update(1 / 60);
        p.agent.step(1 / 60);
        p.char.getObjectByName('pelvis').getWorldPosition(vw);
        const bp = p.twin.bodies.pelvis.translation();
        maxErr = Math.max(maxErr, Math.hypot(vw.x - bp.x, vw.y - bp.y, vw.z - bp.z));
      }
      check('kinematic 跟隨誤差 < 1e-2', maxErr < 1e-2, `maxErr=${maxErr.toExponential(2)}`);
    }

    // 16b dynamic PD 站立:不跌倒(全程 pelY>0.35)、腳掌栽植成形、漂移有界
    {
      const p = LowPoly.physical({ role: 'knight', seed: 42, mode: 'dynamic', RAPIER });
      let minY = 9;
      for (let i = 0; i < 240; i++) { p.agent.step(1 / 60); if (i > 30) minY = Math.min(minY, p.twin.bodies.pelvis.translation().y); }
      const p1 = p.twin.bodies.pelvis.translation();
      check('dynamic 站立 4s 不倒(minY>0.25=沒躺下;會蹲-回復搖擺)', minY > 0.25, `minY=${minY.toFixed(3)}`);
      // 零驅動平衡深蹲:純 PD 無重力補償必然下沉(人類靠主動肌力=policy 的活);
      // 質量再平衡(頭 6%+底盤加重,使用者指定)後平衡點 ≈0.31-0.34,門檻從 0.36 校到 0.30;
      // 站立品質的真門檻是 policy 評估(S0h pelY 0.48)與 check-physics 驅動相(全相持 0.48)
      check('4s 末仍站著(endPelY>0.30)', p1.y > 0.30, `endPelY=${p1.y.toFixed(3)}`);
      check('腳掌栽植成形(weld)', !!(p.twin.plants.footL && p.twin.plants.footR));
      check('站立漂移有界(|pelZ|<0.35)', Math.abs(p1.z) < 0.35, `pelZ=${p1.z.toFixed(3)}`);
    }

    // 16c obs 維度 + 內容合理
    {
      const p = LowPoly.physical({ role: 'knight', seed: 42, mode: 'dynamic', RAPIER });
      for (let i = 0; i < 30; i++) p.agent.step(1 / 60);
      // 先驗 v1 舊佈局仍相容(S2 前的策略靠這條;預設不啟用 v2)
      check('obs v1 維度 = 53(相容)', p.agent.observe().length === 53, `len=${p.agent.observe().length}`);
      p.agent.act(new Array(18).fill(0));   // v1 的 prevAct 段只在 act 後附加
      check('obs v1+prevAct = 71(相容)', p.agent.observe({ prevAct: true }).length === 71);
      // S2 v2:base 76(含 52–75 指令區塊 24 維),prevAct 108(76–107 完整 32 維動作)
      p.agent.obsV2 = true;
      const o = p.agent.observe();
      check('obs 維度 = 76', o.length === 76, `len=${o.length}`);
      check('obs 骨盆高度合理(0.3..0.6)', o[0] > 0.3 && o[0] < 0.6, `pelH=${o[0].toFixed(3)}`);
      // 指令區塊預設值(observe 從 agent.cmd 讀,預設站立):cmdVz/vx/yaw=0、skill=none(one-hot 62=1)
      check('指令區塊 cmdVz 預設 0', o[52] === 0, `o52=${o[52]}`);
      check('指令區塊 skill=none one-hot', o[62] === 1 && o[63] === 0, `o62=${o[62]} o63=${o[63]}`);
      // 74–75(S1):dCP 向量(heading frame,±0.5 clamp)。剛沉降靜站 → CP≈支撐中點 → 接近 0 但不再恆 0。
      check('指令區塊 74–75 = dCP 向量(有界 ±0.5)', o[74] >= -0.5 && o[74] <= 0.5 && o[75] >= -0.5 && o[75] <= 0.5, `o74=${o[74].toFixed(3)} o75=${o[75].toFixed(3)}`);
      p.agent.act(new Array(18).fill(0.5), undefined, new Array(7).fill(0.3), new Array(7).fill(-0.2));
      const o2 = p.agent.observe({ prevAct: true });
      check('obs+prevAct 維度 = 108', o2.length === 108, `len=${o2.length}`);
      check('prevAct 關節段寫入 action', Math.abs(o2[76] - 0.5) < 1e-6);
      check('prevAct 阻抗段寫入 kd/kp(SMOOTH_W 可見)', Math.abs(o2[76 + 18] - 0.3) < 1e-6 && Math.abs(o2[76 + 25] - (-0.2)) < 1e-6);
    }

    // 16d act 夾限位:超界輸入被夾進 [-1,1] 並映射進關節限位
    {
      const p = LowPoly.physical({ role: 'knight', seed: 42, mode: 'dynamic', RAPIER });
      p.agent.act(new Array(18).fill(99));
      check('act 輸入夾 [-1,1]', p.agent._lastAct.every(v => v === 1));
      for (let i = 0; i < 60; i++) p.agent.step(1 / 60);
      check('act 後 ragdoll 不爆炸(pelY 有界)', Math.abs(p.twin.bodies.pelvis.translation().y) < 3);
    }

    // 16e reset:回沉降平衡位、速度歸零
    {
      const p = LowPoly.physical({ role: 'knight', seed: 42, mode: 'dynamic', RAPIER });
      for (let i = 0; i < 60; i++) p.agent.step(1 / 60);
      p.twin.bodies.pelvis.setLinvel({ x: 2, y: 3, z: 1 }, true);
      for (let i = 0; i < 30; i++) p.agent.step(1 / 60);
      p.agent.reset();
      const t = p.twin.bodies.pelvis.translation(), v = p.twin.bodies.pelvis.linvel();
      const s = p.twin.settledPose.bodies.pelvis.t;
      const dp = Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z);
      check('reset 回沉降位(<1e-3)', dp < 1e-3, `dp=${dp.toExponential(2)}`);
      check('reset 速度歸零', Math.hypot(v.x, v.y, v.z) < 1e-6);
    }

    // 16f 站立接觸:雙腳著地
    {
      const p = LowPoly.physical({ role: 'knight', seed: 42, mode: 'dynamic', RAPIER });
      for (let i = 0; i < 60; i++) p.agent.step(1 / 60);
      const c = p.agent.contacts();
      check('雙腳接觸(L&R)', c.L && c.R, `L=${c.L} R=${c.R}`);
    }
  }

  console.log(`\n結果: ${pass} 項通過, ${fail} 項失敗。`);
  process.exit(fail ? 1 : 0);
})();

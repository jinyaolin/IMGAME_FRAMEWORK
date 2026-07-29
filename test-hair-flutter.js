// 模組化髮型 × 柔軟系統(_flutter)整合測試。node test-hair-flutter.js
global.THREE = require('./client/shared/vendor/three.min.js');
const LP = require('./client/shared/vendor/lowpoly.js');

let pass = 0, fail = 0;
const check = (n, c, d) => { console.log(`  ${c ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`); c ? pass++ : fail++; };
const names = (A) => A._flutter.map(f => f.name);

// 跑一段:play run + root 前進(觸發 spd → 飄動目標)
function drive(ac, secs) {
  const A = ac.animator;
  A.play('run');
  for (let i = 0; i < secs * 60; i++) { ac.root.position.x += 6 / 60; A.update(1 / 60); }
}

// 1) 公主:長髮垂片(hairShell)註冊 + 頭皮剛性 + 垂片會動
{
  const ac = LP.animatedCharacter({ role: 'princess', seed: 3 });
  const A = ac.animator;
  check('公主 hairShell 進 _flutter', names(A).includes('hairShell'), names(A).join(','));
  const ft = A._flutter.find(f => f.name === 'hairShell');
  const shell = ac.char.getObjectByName('hairShell');
  const pinY = shell.userData.hairFall.pinY;
  check('pinY 有標記(垂片鉸點)', typeof pinY === 'number' && isFinite(pinY), 'pinY=' + (pinY && pinY.toFixed(3)));
  if (ft) {
    const base = ft.base, arr = ft.attr.array;
    // 挑一個頭皮頂點(y > pinY)與一個垂片末端頂點(y 最低)
    let scalpI = -1, tipI = -1, tipY = Infinity;
    for (let i = 1; i < base.length; i += 3) {
      if (base[i] > pinY + 0.05 && scalpI < 0) scalpI = i - 1;
      if (base[i] < tipY) { tipY = base[i]; tipI = i - 1; }
    }
    drive(ac, 1.5);
    const d3 = (a, b, i) => Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
    const scalpMove = d3(arr, base, scalpI), tipMove = d3(arr, base, tipI);
    check('頭皮頂點剛性(位移≈0)', scalpMove < 1e-4, 'move=' + scalpMove.toFixed(5));
    check('垂片末端會飄(位移>0.02)', tipMove > 0.02, 'move=' + tipMove.toFixed(3));
  }
}

// 2) 女巫:長髮同樣柔軟
{
  const ac = LP.animatedCharacter({ role: 'witch', seed: 5 });
  check('女巫 hairShell 進 _flutter', names(ac.animator).includes('hairShell'), names(ac.animator).join(','));
}

// 3) 小紅帽:雙辮拆左右兩條鏈 + 兜帽垂布柔軟 + 跑動時辮子會擺
{
  const ac = LP.animatedCharacter({ role: 'hood', seed: 7 });
  const A = ac.animator;
  const n = names(A);
  check('雙辮拆成 hairTwinL/R 兩條鏈', n.includes('hairTwinL') && n.includes('hairTwinR'), n.join(','));
  check('兜帽垂布(hood)也柔軟', n.includes('hood'), '');
  const ftL = A._flutter.find(f => f.name === 'hairTwinL');
  if (ftL) {
    check('鏈為巢狀關節段(segs≥2)', ftL.segs.length >= 2, 'segs=' + ftL.segs.length);
    drive(ac, 1.5);
    const rot = Math.abs(ftL.segs[0].rotation.x - ftL.baseRot[0].x);
    check('跑動時辮根擺動(|Δrot|>0.05)', rot > 0.05, 'Δ=' + rot.toFixed(3));
    // 重掛後世界位置合理:鏈尾 puff 世界 y 低於鏈根(垂下)
    ac.char.updateMatrixWorld(true);
    const w0 = new THREE.Vector3(), w1 = new THREE.Vector3();
    ftL.segs[0].getWorldPosition(w0); ftL.segs[ftL.segs.length - 1].getWorldPosition(w1);
    check('鏈尾在鏈根下方(結構沒被重掛弄壞)', w1.y < w0.y, `root=${w0.y.toFixed(2)} tip=${w1.y.toFixed(2)}`);
  }
}

// 4) 短髮/無髮角色:不註冊、不報錯
{
  const ac = LP.animatedCharacter({ role: 'knight', seed: 1 });
  const n = names(ac.animator);
  check('騎士(短髮)無 hairShell 註冊', !n.includes('hairShell'), n.join(',') || '(只有 cape 類)');
}

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

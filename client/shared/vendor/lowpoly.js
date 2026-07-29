/* LowPoly — 程序化生成「可愛低多邊形童話角色」的可復用素材庫（依賴全域 THREE）
 *
 * 用法（在遊戲 gameCode 內，library:"three" 時全域已有 THREE 與 LowPoly）：
 *   LowPoly.addLights(scene);                         // 角色用 Lambert 材質，需要燈光
 *   const hero = LowPoly.character({ role:'knight', seed:42 });   // → THREE.Group（腳底在 y=0）
 *   scene.add(hero);
 *   hero.getObjectByName('armR').rotation.x = -1.2;   // 具名部件可直接擺 pose / 做動畫
 *
 * 每個 (role, seed) 組合都會生成「固定且可重現」的角色 —— seed 就是這個素材的配方。
 * 可用角色：LowPoly.roles（knight/witch/fairy/prince/princess/wizard/elf/dwarf/frog/hood/robin/troll）
 */
(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const SKIN = ['#ffd9b3', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd'];
  const HAIR = ['#3b2417', '#6b4423', '#a55b28', '#d9b45b', '#2b2b2b', '#e8e8e8', '#c0392b'];

  // 每個童話角色：主色、輔色、面板配色、配件旗標
  const ROLES = {
    knight:   { name: '騎士',   body: ['#6c7a89', '#95a5a6'], accent: ['#c0392b', '#2980b9'], skin: SKIN, hair: HAIR, helmet: true },
    witch:    { name: '女巫',   body: ['#3d2c5a', '#4a3070'], accent: ['#7d5fb2', '#5b3a8c'], skin: ['#e8d3b0', '#d9c39a'], hair: ['#2b2b2b', '#4a2b1a'], witchHat: true, cape: 'body', hairStyle: 'witch' },
    fairy:    { name: '仙子',   body: ['#ff8fc7', '#ffb3d9', '#a0e7e5'], accent: ['#ffd166', '#b5ead7'], skin: SKIN, hair: ['#ffd9ec', '#fff1a8', '#c8b6ff'], wings: true, hairStyle: 'fairy' },
    prince:   { name: '王子',   body: ['#2e86de', '#54a0ff'], accent: ['#feca57', '#ee5253'], skin: SKIN, hair: HAIR, crown: true, cape: '#e74c3c' },
    princess: { name: '公主',   body: ['#ff9ff3', '#f368e0'], accent: ['#feca57', '#ffffff'], skin: SKIN, hair: ['#f6b93b', '#e58e26', '#6b4423'], crown: true, skirt: true, hairStyle: 'princess' },
    wizard:   { name: '巫師',   body: ['#34495e', '#2c3e50'], accent: ['#f1c40f', '#3498db'], skin: ['#e8d3b0'], hair: ['#e8e8e8'], wizHat: true, beard: 'long', cape: 'body' },
    elf:      { name: '精靈',   body: ['#2ecc71', '#27ae60'], accent: ['#a9dfbf', '#795548'], skin: ['#ffe0bd', '#f1c27d'], hair: ['#d9b45b', '#a55b28', '#6b4423'], ears: true, cape: '#145a32' },
    dwarf:    { name: '矮人',   body: ['#8e5a2b', '#a0522d'], accent: ['#c0392b', '#7f8c8d'], skin: SKIN, hair: ['#c0392b', '#a55b28', '#e8e8e8'], beard: 'bushy', short: true },
    frog:     { name: '青蛙王子', body: ['#7bed9f', '#2ed573'], accent: ['#feca57', '#eccc68'], skin: ['#7bed9f', '#5fd67f'], hair: null, frog: true, crown: true, cape: '#e74c3c' },
    hood:     { name: '小紅帽', body: ['#e74c3c', '#c0392b'], accent: ['#ffffff', '#f6e58d'], skin: SKIN, hair: ['#6b4423', '#3b2417'], hood: true, hairStyle: 'hood' },
    robin:    { name: '俠盜',   body: ['#27ae60', '#1e8449'], accent: ['#8d6e63', '#f1c40f'], skin: SKIN, hair: ['#6b4423', '#a55b28'], hood: true, feather: true },
    troll:    { name: '巨怪',   body: ['#95a5a6', '#7f8c8d'], accent: ['#57606f', '#dfe4ea'], skin: ['#a4b0be', '#8d9aa8'], hair: null, big: true, tusks: true },
  };

  function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

  // ── 橢球 Q 頭曲面原語(facelab 移植)──
  // 體積正規化 a·b·c=1 → r_eqv(= cbrt(rx·ry·rz))永遠 == headR → 物理 head collider(ball r=headR)不動。
  // 臉型(lowBias 下墜加肉、chin 收尖、cheek 前頰凸)純視覺,不進 rig。
  const CHIN_SPAN = 0.42, CHEEK_Y = -0.28, CHEEK_W = 0.34;
  const FACE_DEFAULT = { aspect: [1, 1, 1], lowBias: 0.18, chin: 0.24, cheek: 0.09,
    eyeLine: -0.12, eyeR: 0.085, eyeSpread: 0.42, eyeBulge: 0.18, eyeFlat: 0.65, eyeStyle: 'normal' };
  function fsmooth(a, b, x) { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); }
  function profileK(face, t) {                          // 正規化高度 t∈[-1,1] 的半徑係數
    const tw = t + face.lowBias * (1 - t * t);          // 最寬帶下移 → Q 版嬰兒肥;兩極固定(1-t²=0)
    const k = Math.sqrt(Math.max(0, 1 - tw * tw));
    const chinReduce = face.chin * (1 - fsmooth(-1, -1 + CHIN_SPAN, t));   // 只收底部 → 小圓下巴
    return k * (1 - chinReduce);
  }
  function faceAspect(face, r0) {                        // a·b·c 正規化 → r_eqv == r0
    const a = face.aspect[0], b = face.aspect[1], c = face.aspect[2], g = Math.cbrt(a * b * c);
    return { rx: r0 * a / g, ry: r0 * b / g, rz: r0 * c / g };
  }
  function surfacePoint(THREE, face, rx, ry, rz, phi, t) {   // phi:+z(臉)→+x(右);t:高度
    const s = Math.sin(phi), co = Math.cos(phi);
    const ellipRho = rx * rz / Math.sqrt(rz * rz * s * s + rx * rx * co * co);
    let r = ellipRho * profileK(face, t);
    const bump = Math.exp(-Math.pow((t - CHEEK_Y) / CHEEK_W, 2));
    r += face.cheek * bump * Math.max(0, 0.5 + 0.5 * co) * rx;               // 前向加權臉頰
    return new THREE.Vector3(r * s, ry * t, r * co);
  }
  function surfaceNormal(THREE, face, rx, ry, rz, phi, t) {  // 真外法線(數值)—— 五官貼合非徑向
    const e = 0.012, p0 = surfacePoint(THREE, face, rx, ry, rz, phi, t);
    const tu = surfacePoint(THREE, face, rx, ry, rz, phi + e, t).sub(p0);
    const tv = surfacePoint(THREE, face, rx, ry, rz, phi, Math.min(0.995, t + e)).sub(p0);
    const n = tu.cross(tv).normalize();
    if (n.dot(p0) < 0) n.multiplyScalar(-1);
    return n;
  }
  // 每角色臉型覆寫(其餘用 FACE_DEFAULT);Phase 4 再逐一微調
  const ROLE_FACE = {
    frog:  { eyeStyle: 'frog', aspect: [1.06, 0.92, 1.0], lowBias: 0.28, chin: 0.10, cheek: 0.10 },
    troll: { aspect: [1.10, 0.96, 1.04], lowBias: 0.10, chin: 0.34, cheek: 0.02, eyeR: 0.06, eyeSpread: 0.46 },
    dwarf: { aspect: [1.02, 0.98, 1.0], lowBias: 0.22, chin: 0.14, cheek: 0.08 },
  };

  // ── 頭髮系統(facelab 移植):單一 offset 曲面 + 結構加件(辮/丸子/鬍),全錨在頭型曲面 ──
  const HAIR_DEFAULT = { style: 'short', thick: 0.05, curl: 0, faceOpen: 1.05, hairLen: 0.18,
    hairline: 0.15, hairLow: -0.6, braid: false, twin: false, buns: false, beard: '' };
  function buildHairSurface(THREE, face, mat, hair, rx, ry, rz) {
    const nU = 24, nLat = 15, latJaw = 0.60;         // 粗面 + flat shading → 塊狀低多邊形捲髮
    const crownT = 1.0, jawT = -0.52;
    const uOpen = hair.faceOpen, thick = hair.thick, fallLen = hair.hairLen, hairlineT = hair.hairline, hairLow = hair.hairLow;
    let fallTopT = 0, wr = -1;                        // 長髮在後腦最寬處脫離、沿切線垂下(不內縮)
    for (let t = 0.2; t >= -0.5; t -= 0.02) { const p = surfacePoint(THREE, face, rx, ry, rz, Math.PI, t); const r = Math.hypot(p.x, p.z); if (r > wr) { wr = r; fallTopT = t; } }
    const longHair = fallLen > 0.4;                  // 只有真長髮才垂;短髮直接貼頭到下顎、不多一片垂髮
    const clingBotT = longHair ? fallTopT : jawT;
    const useLat = longHair ? latJaw : 1.0;          // 短髮:全部 row 都貼頭(無 fall 垂片)
    const fw = 0.45, vw = 0.12;
    const faceMask = (phi, t) => {
      const front = 1 - fsmooth(uOpen - fw * 0.5, uOpen + fw * 0.5, Math.abs(phi));
      const below = 1 - fsmooth(hairlineT - vw, hairlineT + vw, t);
      const bottomBare = 1 - fsmooth(hairLow, hairLow + 0.14, t);
      return Math.max(front * below, bottomBare);
    };
    const hash = (i, j) => { const x = Math.sin((((i % nU) + nU) % nU) * 12.9898 + j * 78.233) * 43758.5453; return x - Math.floor(x); };
    const bumpAt = (ui, li) => hair.curl * Math.max(0, hash(ui, li) * 1.7 - 0.5);
    let fallPinY = -Infinity;   // 垂片錨環最高 y(mesh-local)→ 動畫層柔軟系統的鉸點(其上全剛性貼頭)
    const nodes = [];
    for (let li = 0; li <= nLat; li++) {
      const lf = li / nLat, onHead = lf <= useLat, row = [];
      for (let ui = 0; ui <= nU; ui++) {
        const phi = -Math.PI + 2 * Math.PI * (ui / nU);
        let v, present;
        if (onHead) {
          const t = crownT + (clingBotT - crownT) * (lf / useLat);
          const base = surfacePoint(THREE, face, rx, ry, rz, phi, t);
          const th = thick * (1 - faceMask(phi, t));
          present = th > 0.006;
          const off = present ? th + bumpAt(ui, li) : 0;
          v = base.clone().addScaledVector(base.clone().normalize(), off);
        } else {
          const s = (lf - latJaw) / (1 - latJaw);
          const anchor = surfacePoint(THREE, face, rx, ry, rz, phi, clingBotT);
          const th = thick * (1 - faceMask(phi, clingBotT));
          present = th > 0.006;
          const off = present ? th + bumpAt(ui, li) : 0;
          const outer = anchor.clone().addScaledVector(anchor.clone().normalize(), off);
          if (present && outer.y > fallPinY) fallPinY = outer.y;
          const taper = 1 + 0.05 * s;
          v = new THREE.Vector3(outer.x * taper, outer.y - fallLen * s, outer.z * taper);
        }
        row.push({ v, on: present });
      }
      nodes.push(row);
    }
    const positions = [], indices = [], id = nodes.map(r => r.map(() => -1));
    const vid = (li, ui) => { if (id[li][ui] >= 0) return id[li][ui]; const v = nodes[li][ui].v; id[li][ui] = positions.length / 3; positions.push(v.x, v.y, v.z); return id[li][ui]; };
    for (let li = 0; li < nLat; li++) for (let ui = 0; ui < nU; ui++) {
      const q = [nodes[li][ui], nodes[li][ui + 1], nodes[li + 1][ui + 1], nodes[li + 1][ui]];
      if (q.filter(n => n.on).length < 3) continue;
      const a = vid(li, ui), b = vid(li, ui + 1), c = vid(li + 1, ui + 1), d = vid(li + 1, ui);
      indices.push(a, b, d, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat(hair.col, { side: THREE.DoubleSide }));
    m.name = 'hairShell';
    // 長髮:標記垂片鉸點 → 動畫層以此註冊柔軟(pinY 以上剛性貼頭、以下隨速度/落下飄動)
    if (longHair && fallPinY > -Infinity) m.userData.hairFall = { pinY: fallPinY };
    return m;
  }
  function braidChain(THREE, mat, col, grp, anchor, opts) {
    const n = opts.n || 9, len = opts.len, r0 = opts.r0 || 0.075, side = opts.side || 0;
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1), r = r0 * (1 - 0.55 * s);
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat(col));
      const wob = 0.03 * Math.sin(s * 7 + side);
      puff.position.set(anchor.x + side * 0.02 + wob, anchor.y - 0.06 - len * s, anchor.z + (opts.fwd || 0) * s);
      grp.add(puff);
    }
  }
  function buildBraid(THREE, face, mat, hair, rx, ry, rz) {
    const g = new THREE.Group(); g.name = 'hairBraid';
    braidChain(THREE, mat, hair.col, g, surfacePoint(THREE, face, rx, ry, rz, Math.PI, -0.34), { len: 0.30 + hair.hairLen * 0.9, fwd: -0.05 });
    return g;
  }
  function buildTwinBraid(THREE, face, mat, hair, rx, ry, rz) {
    const g = new THREE.Group(); g.name = 'hairTwin';
    for (const side of [-1, 1]) braidChain(THREE, mat, hair.col, g, surfacePoint(THREE, face, rx, ry, rz, side * 1.15, -0.12), { len: 0.24 + hair.hairLen * 0.7, side, fwd: 0.10, r0: 0.07 });
    return g;
  }
  function buildBuns(THREE, face, mat, hair, rx, ry, rz) {
    const g = new THREE.Group(); g.name = 'hairBuns';
    for (const side of [-1, 1]) {
      const a = surfacePoint(THREE, face, rx, ry, rz, side * 1.45, 0.28);
      const bun = new THREE.Mesh(new THREE.IcosahedronGeometry(0.135, 1), mat(hair.col));
      bun.scale.set(1, 0.9, 1); bun.position.copy(a).addScaledVector(a.clone().normalize(), 0.09); g.add(bun);
    }
    return g;
  }
  const BEARD_TBL = {
    long: [[-0.09,-0.12,0.34,0.055],[0.09,-0.12,0.34,0.055],[-0.18,-0.20,0.24,0.09],[0.18,-0.20,0.24,0.09],[-0.10,-0.24,0.30,0.10],[0.10,-0.24,0.30,0.10],[0,-0.32,0.30,0.11],[-0.07,-0.44,0.24,0.085],[0.07,-0.44,0.24,0.085],[0,-0.56,0.17,0.075]],
    bushy: [[-0.09,-0.12,0.34,0.06],[0.09,-0.12,0.34,0.06],[-0.24,-0.18,0.20,0.11],[0.24,-0.18,0.20,0.11],[-0.12,-0.22,0.28,0.11],[0.12,-0.22,0.28,0.11],[0,-0.28,0.31,0.12],[-0.13,-0.38,0.24,0.10],[0.13,-0.38,0.24,0.10],[0,-0.42,0.26,0.10],[-0.06,-0.50,0.20,0.085],[0.06,-0.50,0.20,0.085]],
  };
  function buildBeard(THREE, face, mat, col, kind, rx, ry, rz, rnd) {
    const g = new THREE.Group(); g.name = 'beard';
    for (const p of (BEARD_TBL[kind] || BEARD_TBL.long)) {
      const phi = Math.atan2(p[0], p[2]), t = Math.max(-0.98, p[1] / ry - 0.13);   // 整把下移露出嘴(微調:0.22→0.15→0.13,再上去一點點)
      const base = surfacePoint(THREE, face, rx, ry, rz, phi, t);
      const pr = p[3] * (0.88 + rnd() * 0.24);
      const puff = new THREE.Mesh(new THREE.SphereGeometry(pr, 8, 6), mat(col));
      puff.position.copy(base).addScaledVector(base.clone().normalize(), pr * 0.4); g.add(puff);
    }
    return g;
  }
  // 每角色髮型(色彩在 makeCharacter 內注入 .col)
  const ROLE_HAIR = {
    knight:   { style: 'bald' },                                          // 頭盔蓋住
    witch:    { style: 'long', hairLen: 0.58, hairline: 0.12, faceOpen: 1.0 },
    fairy:    { style: 'buns', buns: true, hairLen: 0.15 },
    prince:   { style: 'short', hairLen: 0.18 },
    princess: { style: 'long', hairLen: 0.85, hairline: 0.16 },
    wizard:   { style: 'bald', beard: 'long' },                           // 帽蓋髮 + 長鬍
    elf:      { style: 'short', hairLen: 0.16 },
    dwarf:    { style: 'short', hairLen: 0.14, beard: 'bushy' },
    frog:     { style: 'bald' },
    hood:     { style: 'twin', twin: true, hairLen: 0.30, hairline: 0.12 }, // 小紅帽雙辮
    robin:    { style: 'short', hairLen: 0.16 },
    troll:    { style: 'bald' },
  };

  // ── 配件系統(facelab 移植):頭飾坐在頭髮上(dims 已含 hairPad)、耳朵錨在頭型 ──
  function buildHat(THREE, mat, type, colBody, colAccent, rx, ry, rz) {
    const g = new THREE.Group(); g.name = 'hat';
    if (type === 'helmet') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(colBody));
      dome.scale.set(rx * 1.07, ry * 1.08, rz * 1.07); dome.position.y = ry * 0.05; g.add(dome);
      const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.055, 0.26, 6), mat(colBody));
      nose.position.set(0, -ry * 0.1, rz * 1.02); g.add(nose);
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.30, 6), mat(colAccent));
      plume.position.set(0, ry * 1.12 + 0.12, -rz * 0.1); g.add(plume);
    } else if (type === 'wizardHat' || type === 'witchHat') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(rx * 1.28, rx * 1.28, 0.045, 18), mat(colAccent));
      brim.position.y = ry * 0.72; g.add(brim);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rx * 0.82, type === 'wizardHat' ? 0.95 : 0.82, 16), mat(colBody));
      cone.position.y = ry * 0.72 + (type === 'wizardHat' ? 0.50 : 0.44);
      if (type === 'witchHat') cone.rotation.z = 0.14; g.add(cone);
      const star = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), mat(colAccent));
      star.position.set(0, ry * 0.72 + 0.30, rz * 0.9); g.add(star);
    } else if (type === 'hood') {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), mat(colBody));
      hood.scale.set(rx * 1.16, ry * 1.20, rz * 1.14); hood.position.set(0, ry * 0.14, -rz * 0.24); g.add(hood);
    } else if (type === 'crown') {
      const cy = ry * 0.68, cr = rx * 0.80;                        // 下移套到頭上
      const band = new THREE.Mesh(new THREE.CylinderGeometry(cr, cr, 0.14, 16, 1, true), mat('#f1c40f', { side: THREE.DoubleSide }));  // openEnded → 簍空環
      band.position.y = cy; g.add(band);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 4), mat('#f1c40f')); spike.position.set(Math.cos(a) * cr, cy + 0.13, Math.sin(a) * cr); g.add(spike); }
      const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), mat(colAccent));
      gem.position.set(0, cy, cr); g.add(gem);
    }
    return g;
  }
  function buildEars(THREE, face, mat, type, skin, rx, ry, rz) {
    const g = new THREE.Group(); g.name = 'ears';
    for (const side of [-1, 1]) {
      if (type === 'elf') {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.34, 5), mat(skin));
        const a = surfacePoint(THREE, face, rx, ry, rz, side * Math.asin(0.9), 0.05);
        ear.position.copy(a).addScaledVector(a.clone().normalize(), 0.02);
        ear.rotation.z = side * -0.7; ear.rotation.x = -0.15; g.add(ear);
      } else if (type === 'cat' || type === 'rabbit') {
        const rabbit = type === 'rabbit';
        const base = surfacePoint(THREE, face, rx, ry, rz, side * Math.asin(rabbit ? 0.40 : 0.55), 0.80);
        const rad = rabbit ? 0.075 : 0.12, ht = rabbit ? 0.50 : 0.26, splay = rabbit ? 0.50 : 0.44, zf = 0.40;
        const ear = new THREE.Mesh(new THREE.ConeGeometry(rad, ht, rabbit ? 5 : 4), mat(skin));
        ear.scale.set(1, 1, zf); ear.position.copy(base).addScaledVector(base.clone().normalize(), 0.035); if (rabbit) ear.position.y += 0.22;
        ear.rotation.z = side * -splay; g.add(ear);
        const inner = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.5, ht * 0.7, rabbit ? 5 : 4), mat(rabbit ? '#ffb3c6' : '#ff9aa2'));
        inner.scale.set(1, 1, zf * 0.5);
        inner.position.copy(ear.position).addScaledVector(new THREE.Vector3(0, 0, 1), rad * zf * 0.5); inner.position.y += ht * 0.04;
        inner.rotation.z = side * -splay; g.add(inner);
      }
    }
    return g;
  }
  const ROLE_ACC = {
    knight: { hat: 'helmet' }, witch: { hat: 'witchHat' }, prince: { hat: 'crown' }, princess: { hat: 'crown' },
    wizard: { hat: 'wizardHat' }, elf: { ears: 'elf' }, frog: { hat: 'crown' }, hood: { hat: 'hood' }, robin: { hat: 'hood' },
  };

  // ── 關節限位表(rad;x=pitch、y=yaw、z=roll;髖.x 負=前擺、膝/肘.x 正=屈曲)──
  // userData.rig.limits 與未來物理孿生 revolute 限位共用同一份。
  const JOINT_LIMITS = {
    hip:    { x: [-1.8, 1.2],  y: [-0.5, 0.5], z: [-0.35, 0.35] },
    knee:   { x: [0, 2.4],     y: [0, 0],      z: [0, 0] },
    ankle:  { x: [-0.6, 0.8],  y: [0, 0],      z: [-0.2, 0.2] },
    shoulder: { x: [-1.75, 1.75], y: [-0.8, 0.8], z: [-1.75, 1.75] },   // 使用者指定:肩總轉角 200°(±100°/軸),球關節屏障力矩強制(lowphysical LIM_JOINTS)
    elbow:  { x: [-2.4, 0.1],  y: [0, 0],      z: [0, 0] },   // 負=前抬(與步態同符號;原 [0,2.5] 只能往後折且 rest 卡邊界)
    spine:  { x: [-0.5, 0.6],  y: [-0.6, 0.6], z: [-0.4, 0.4] },
    chest:  { x: [-1.4, 1.4],  y: [-0.6, 0.6], z: [-0.4, 0.4] },   // x 對齊腰腹屏障 ±80°(使用者指定骨盆-腹鏈 160°);spine revolute 已由 solver 限得更緊
    neck:   { x: [-0.5, 0.6],  y: [-0.9, 0.9], z: [-0.4, 0.4] },
  };

  function makeCharacter(THREE, opts) {
    opts = opts || {};
    const roleKey = opts.role && ROLES[opts.role] ? opts.role : pick(Math.random, Object.keys(ROLES));
    const R = ROLES[roleKey];
    const seed = (opts.seed == null) ? Math.floor(Math.random() * 1e9) : (opts.seed | 0);
    const rnd = mulberry32((seed * 2654435761) >>> 0);

    const mat = (color, opt) => new THREE.MeshLambertMaterial(Object.assign({ color: new THREE.Color(color), flatShading: true }, opt || {}));
    const part = (geo, color, name, o) => { const m = new THREE.Mesh(geo, mat(color, o)); if (name) m.name = name; return m; };

    const skin = R.skin ? pick(rnd, R.skin) : '#7bed9f';
    const bodyCol = pick(rnd, R.body);
    const accent = pick(rnd, R.accent);
    const hairCol = R.hair ? pick(rnd, R.hair) : bodyCol;

    const scale = R.big ? 1.28 : (R.short ? 0.82 : (0.94 + rnd() * 0.16));
    const group = new THREE.Group();
    group.name = 'character';
    group.userData = { role: roleKey, roleName: R.name, seed };

    // 比例（單位，腳底 y=0）：大頭 = 可愛
    const legH = 0.46, torsoH = 0.62, headR = 0.42;
    // 橢球 Q 頭:每角色臉型覆寫 default;體積正規化 → r_eqv == headR(collider/rig 不變)
    const face = Object.assign({}, FACE_DEFAULT, ROLE_FACE[roleKey] || {});
    // seed 微調臉型 —— 骰子每個 seed 給不同的臉(雙頰/下巴/眼睛大小…);aspect 仍體積正規化 → r_eqv 不變、物理不動
    const jf = (v, amp) => v + (rnd() - 0.5) * 2 * amp;
    face.aspect = [jf(face.aspect[0], 0.08), jf(face.aspect[1], 0.07), jf(face.aspect[2], 0.06)];
    face.lowBias = Math.max(0, jf(face.lowBias, 0.05));
    face.chin = Math.max(0, jf(face.chin, 0.07));
    face.cheek = Math.max(0, jf(face.cheek, 0.03));
    face.eyeR = Math.max(0.05, jf(face.eyeR, 0.014));
    face.eyeSpread = Math.min(0.55, Math.max(0.30, jf(face.eyeSpread, 0.04)));
    face.eyeBulge = Math.min(1, Math.max(0, jf(face.eyeBulge, 0.07)));
    face.eyeFlat = Math.min(1, Math.max(0, jf(face.eyeFlat, 0.10)));
    const hd = faceAspect(face, headR), hx = hd.rx, hy = hd.ry, hz = hd.rz;

    // ── 骨架關節鏈(v2 rig):pelvis → spine → chest → neck → head ──
    // 關節本身為中立 THREE.Group(具名);A-pose 照舊烘焙在內層 group →
    // 具名關節可直接寫 rotation 擺 pose(既有玩法不變),也供 animator v2 / 物理孿生對接。
    // 世界 Y 常數:骨盆 .46、腰 .48、胸 .79、頸關節 1.01 —— 與舊剪影一致。
    const PELVIS_Y = legH;
    const SPINE_Y  = PELVIS_Y + 0.02;
    const CHEST_Y  = SPINE_Y + 0.31;
    const NECK_Y   = CHEST_Y + 0.22;
    const pelvis = new THREE.Group(); pelvis.name = 'pelvis'; pelvis.position.y = PELVIS_Y;
    const spine  = new THREE.Group(); spine.name  = 'spine';  spine.position.y  = SPINE_Y - PELVIS_Y;
    const chest  = new THREE.Group(); chest.name  = 'chest';  chest.position.y  = CHEST_Y - SPINE_Y;
    const neckJ  = new THREE.Group(); neckJ.name  = 'neck';   neckJ.position.y  = NECK_Y - CHEST_Y;
    group.add(pelvis); pelvis.add(spine); spine.add(chest); chest.add(neckJ);

    // 腿(髖 → 膝 → 踝三段;髖掛骨盆,世界位置與舊版相同)
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.name = side < 0 ? 'legL' : 'legR';
      hip.position.set(side * 0.16, 0, 0);                       // pelvis 局部 = 世界 .46
      const thigh = part(new THREE.CapsuleGeometry(0.135, 0.08, 4, 8), accent);
      thigh.position.y = -0.105;                                 // 大腿(上段與骨盆重疊藏縫)
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.name = side < 0 ? 'kneeL' : 'kneeR';
      knee.position.y = -0.21;                                   // 世界 .25
      hip.add(knee);
      const shin = part(new THREE.CapsuleGeometry(0.095, 0.08, 4, 8), accent);
      shin.position.y = -0.085;                                  // 小腿:瘦身 0.12→0.095 且上抬,底部 y≈0.03 → 不再戳穿平底腳(物理小腿本就 r0.07 離地,此為視覺對齊)
      knee.add(shin);
      const ankle = new THREE.Group();
      ankle.name = side < 0 ? 'ankleL' : 'ankleR';
      ankle.position.y = -0.19;                                  // 世界 .06
      knee.add(ankle);
      // 皮鞋:單一橢球把下半切平(上半橢圓穹頂 + 平底,一塊 mesh,不另接方塊)。flatShading 自算面法線,免重算。
      const shoeG = new THREE.SphereGeometry(1, 14, 8);
      const _sp = shoeG.attributes && shoeG.attributes.position;
      if (_sp && _sp.array) {                                    // 真 THREE:壓平下半球頂點到 y=0 → 切面即平底
        const a = _sp.array;
        for (let i = 0; i < a.length; i += 3) { a[i] *= 0.09; a[i + 1] = Math.max(0, a[i + 1]) * 0.08; a[i + 2] *= 0.155; }
        _sp.needsUpdate = true;
      } else if (shoeG.scale) { shoeG.scale(0.09, 0.08, 0.155); } // stub 退化路徑
      const foot = part(shoeG, '#5a4a3a');
      foot.position.set(0, -0.06, 0.05);                         // 切平面 → 世界 y=0;整體後移(z .075→.05)讓腳跟退到小腿後緣之後
      ankle.add(foot);
      pelvis.add(hip);
    }

    // 軀幹(Lathe 圓潤蛋形)—— 單一整塊膠囊(使用者:「整個身體應該是一塊膠囊,轉彎不該上下切開」)。
    // 舊版腰線剖成 torsoLo/torsoHi 兩塊分掛 spine/chest,脊椎彎時接縫剪開;現在合成一條完整 profile、
    // 整塊掛 spine,由動畫器 skinTorso() 每幀把上半頂點按權重 w(下 0→上 1)朝 chest 關節姿態彈性彎折
    // (2-bone 線性混皮的解析版,與 cape/hair 的 _flutter 頂點變形同idiom);物理體仍是兩剛體,RL 不變。
    const torsoProfile = [[0, -0.31], [0.15, -0.28], [0.25, -0.20], [0.29, -0.08], [0.30, 0.04],
      [0.30, 0.16], [0.27, 0.25], [0.18, 0.30], [0, 0.31]]
      .map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    const torso = part(new THREE.LatheGeometry(torsoProfile, 12), bodyCol, 'torso');
    torso.position.y = (legH + torsoH / 2) - SPINE_Y;            // .29 → 世界 .77(頂點絕對 Y,與舊版同形)
    spine.add(torso);

    // 脖子(膚色短錐柱,補頭與軀幹之間的空隙)— 掛 chest
    const neck = part(new THREE.CylinderGeometry(0.12, 0.17, 0.16, 8), skin);
    neck.position.y = (legH + torsoH - 0.04) - CHEST_Y;          // .25 → 世界 1.04
    chest.add(neck);

    // 髖部(腿色扁球,連接軀幹底與雙腿、消除浮空感 = 短褲感)— 掛 pelvis
    const hips = part(new THREE.SphereGeometry(0.26, 10, 6), accent);
    hips.scale.set(1, 0.55, 0.85);
    hips.position.y = 0.03;                                      // 世界 .49
    pelvis.add(hips);
    if (R.skirt) {
      const skirt = part(new THREE.ConeGeometry(0.5, 0.5, 8), accent);
      skirt.position.y = 0.12;                                   // 世界 .58
      pelvis.add(skirt);
    }

    // 手臂(肩掛 chest;肩樞紐保持中性,休息張角放內層 group;肘關節中立具名)
    const shoulderY = legH + torsoH - 0.06;
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.name = side < 0 ? 'armL' : 'armR';
      sh.position.set(side * 0.30, shoulderY - CHEST_Y, 0);      // .23 → 世界 1.02
      const limb = new THREE.Group();
      limb.rotation.z = side * 0.16;                             // A-pose 外張 ~9°
      limb.rotation.x = -0.05;                                   // 微前擺，脫離貼身平面
      const upperArm = part(new THREE.CapsuleGeometry(0.10, 0.10, 3, 8), bodyCol);
      upperArm.position.y = -0.13;                               // 上臂(下段與肘重疊藏縫)
      limb.add(upperArm);
      const elbow = new THREE.Group();
      elbow.name = side < 0 ? 'elbowL' : 'elbowR';
      elbow.position.y = -0.24;                                  // 世界 .78
      limb.add(elbow);
      const foreArm = part(new THREE.CapsuleGeometry(0.09, 0.10, 3, 8), bodyCol);
      foreArm.position.y = -0.13;                                // 前臂
      elbow.add(foreArm);
      const hand = part(new THREE.IcosahedronGeometry(0.13, 0), skin);
      hand.position.y = -0.28;                                   // 世界 .50(同舊版)
      elbow.add(hand);
      sh.add(limb);
      chest.add(sh);
    }

    // 頭(橢球 Q 頭:位移 icosphere 到 chibi 曲面;頭原點與舊版相同 → rig joint 'head' / 動畫器不動)
    const head = new THREE.Group();
    head.name = 'head';
    head.position.y = legH + torsoH + headR * 0.72;
    const headGeo = new THREE.IcosahedronGeometry(1, 1);
    const hpos = headGeo.attributes.position;
    for (let i = 0; i < hpos.count; i++) {
      const dx = hpos.getX(i), dy = hpos.getY(i), dz = hpos.getZ(i);
      const t = Math.max(-1, Math.min(1, dy)), phi = Math.atan2(dx, dz);
      const p = surfacePoint(THREE, face, hx, hy, hz, phi, t);
      hpos.setXYZ(i, p.x, p.y, p.z);
    }
    headGeo.computeVertexNormals();
    head.add(part(headGeo, skin));

    // 五官:anchor 貼合真法線;frog = 高處凸大眼
    const eyeR = face.eyeR, frogEye = face.eyeStyle === 'frog';
    const ZAX = new THREE.Vector3(0, 0, 1);
    for (const side of [-1, 1]) {
      if (frogEye) {
        const phi = side * Math.asin(0.5), t = 0.26;
        const base = surfacePoint(THREE, face, hx, hy, hz, phi, t), n = surfaceNormal(THREE, face, hx, hy, hz, phi, t);
        const lid = part(new THREE.SphereGeometry(eyeR * 1.7, 10, 10), skin);
        lid.position.copy(base).addScaledVector(n, eyeR * 1.0); head.add(lid);
        const white = part(new THREE.SphereGeometry(eyeR * 1.15, 10, 10), '#ffffff');
        white.position.copy(base).addScaledVector(n, eyeR * 1.85); head.add(white);
        const pupil = part(new THREE.SphereGeometry(eyeR * 0.7, 8, 8), '#111');
        pupil.position.copy(base).addScaledVector(n, eyeR * 2.35); head.add(pupil);
      } else {
        const phi = side * Math.asin(Math.min(0.95, face.eyeSpread)), t = face.eyeLine;
        const base = surfacePoint(THREE, face, hx, hy, hz, phi, t), n = surfaceNormal(THREE, face, hx, hy, hz, phi, t);
        const flat = 1 - face.eyeFlat * 0.78, depth = eyeR * flat;
        const eq = new THREE.Quaternion().setFromUnitVectors(ZAX, n);
        const wc = base.clone().addScaledVector(n, depth * (2 * face.eyeBulge - 1) * 0.9);
        const white = part(new THREE.SphereGeometry(eyeR, 10, 10), '#ffffff');
        white.position.copy(wc); white.quaternion.copy(eq); white.scale.set(1, 1, flat); head.add(white);
        const pupil = part(new THREE.SphereGeometry(eyeR * 0.58, 8, 8), '#20120a');
        pupil.position.copy(wc).addScaledVector(n, depth * 0.82); pupil.quaternion.copy(eq); pupil.scale.set(1, 1, flat); head.add(pupil);
      }
    }
    // 腮紅(anchor 貼臉;frog/troll 無;保留一次 rnd → seed 變化)
    const wantBlush = rnd() > 0.35;
    if (!R.troll && !frogEye && wantBlush) {
      for (const side of [-1, 1]) {
        const bphi = side * Math.asin(0.60), bt = face.eyeLine - 0.24;   // 再往下,不打到眼睛
        const bb = surfacePoint(THREE, face, hx, hy, hz, bphi, bt), bn = surfaceNormal(THREE, face, hx, hy, hz, bphi, bt);
        const blush = part(new THREE.CircleGeometry(0.06, 10), '#ff9aa2', { transparent: true, opacity: 0.7, side: THREE.DoubleSide });
        blush.position.copy(bb).addScaledVector(bn, 0.004); blush.lookAt(bb.clone().add(bn)); head.add(blush);
      }
    }
    // 嘴(anchor;frog 寬綠;鬍子角色也畫 → 鬍子已下移露出嘴)
    {
      const mt = face.eyeLine - 0.30, mp = surfacePoint(THREE, face, hx, hy, hz, 0, mt), mn = surfaceNormal(THREE, face, hx, hy, hz, 0, mt);
      const mouth = part(new THREE.TorusGeometry(frogEye ? 0.11 : 0.07, 0.015, 6, 14, Math.PI), frogEye ? '#1f7a3f' : '#7a4a3a');
      mouth.position.copy(mp).addScaledVector(mn, 0.004);
      mouth.lookAt(mp.clone().add(mn)); mouth.rotateZ(Math.PI); head.add(mouth);
    }

    // 頭髮(新系統:單一 offset 曲面 + 辮/丸子加件;色彩注入;鬍子在配件階段)
    const hairCfg = Object.assign({}, HAIR_DEFAULT, ROLE_HAIR[roleKey] || {}, { col: hairCol });
    const hairPad = (hairCfg.style !== 'bald') ? hairCfg.thick + hairCfg.curl * 0.6 : 0;   // 供帽子座落
    const acc = ROLE_ACC[roleKey] || {};
    if (hairCfg.style !== 'bald') {
      head.add(buildHairSurface(THREE, face, mat, hairCfg, hx, hy, hz));
      if (hairCfg.braid) head.add(buildBraid(THREE, face, mat, hairCfg, hx, hy, hz));
      if (hairCfg.twin)  head.add(buildTwinBraid(THREE, face, mat, hairCfg, hx, hy, hz));
      if (hairCfg.buns)  head.add(buildBuns(THREE, face, mat, hairCfg, hx, hy, hz));
    }
    // 耳朵(配件:精靈/貓/兔)
    if (acc.ears) head.add(buildEars(THREE, face, mat, acc.ears, skin, hx, hy, hz));
    // 巨怪獠牙（從下顎往上、長在嘴巴兩側）
    if (R.tusks) for (const side of [-1, 1]) {
      const tusk = part(new THREE.ConeGeometry(0.045, 0.17, 4), '#f5f6fa');
      tusk.position.set(side * 0.13, -0.08, headR * 0.82);
      head.add(tusk);
    }
    // 鬍子(配件毛髮:巫師 long / 矮人 bushy)
    if (hairCfg.beard) head.add(buildBeard(THREE, face, mat, hairCol, hairCfg.beard, hx, hy, hz, rnd));

    // 頭飾:兜帽用髮殼式「開面」cowl(從耳朵前露臉,不再罩住臉);其餘用 buildHat。全坐在頭髮上(+hairPad)。
    if (acc.hat === 'hood') {
      const hoodCfg = { thick: 0.10, curl: 0, faceOpen: 1.30, hairLen: 0.45, hairline: 0.24, hairLow: -0.6, col: bodyCol };
      const hood = buildHairSurface(THREE, face, mat, hoodCfg, hx + hairPad, hy + hairPad, hz + hairPad);
      hood.name = 'hood'; head.add(hood);
    } else if (acc.hat) {
      head.add(buildHat(THREE, mat, acc.hat, bodyCol, accent, hx + hairPad, hy + hairPad, hz + hairPad));
    }
    // 披風：從後領鑽出 → 披過肩、順著軀幹外弧 → 往下垂墜、下擺微外張。
    // 用「只車背面一段弧」的 Lathe 曲面貼著身體，兩側收在手臂後方不打架。
    // 領口 y=1.10 正好是脖子根（脖子 y≈1.04、軀幹頂 1.08）→ 兜帽/非兜帽角色都合用。
    // 動畫層依 'cape' 名註冊飄動變形（主擺彈簧 + 行進波，見檔尾）。
    function makeCape(color) {
      const capeProfile = [
        [0.20, 1.10], [0.27, 1.03], [0.33, 0.92],   // 領口貼後頸 → 越過肩背
        [0.365, 0.78], [0.385, 0.62],               // 順著軀幹弧線（軀幹最寬 0.30，留 0.06 貼身間隙）
        [0.41, 0.44], [0.45, 0.28], [0.50, 0.14],   // 垂墜、下擺外張
      ].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      const cape = new THREE.Mesh(
        new THREE.LatheGeometry(capeProfile, 10, Math.PI * 0.68, Math.PI * 0.64),  // 只有背面弧段，開口朝前
        mat(color, { side: THREE.DoubleSide })
      );
      cape.name = 'cape';
      cape.position.set(0, -CHEST_Y, -0.02);   // 頂點為絕對 Y,chest 局部 −.79 補回世界高度
      chest.add(cape);
    }
    // 披風(costume 不變):兜帽角色與上衣同色;其餘用 R.cape。兜帽殼已由 buildHat('hood') 建。
    if (R.hood) makeCape(bodyCol);
    else if (R.cape) makeCape(R.cape === 'body' ? bodyCol : R.cape);
    // 俠盜羽毛(帽側)
    if (R.feather) {
      const f = part(new THREE.ConeGeometry(0.05, 0.44, 4), accent);
      f.position.set(0.26, 0.48, 0.02); f.rotation.z = 0.7; f.rotation.x = -0.2; head.add(f);
    }
    neckJ.add(head);
    head.position.y -= NECK_Y;   // 世界 1.382 − 頸關節 1.01 = 局部 .372

    // 仙子翅膀（具名 Group 保持中性給拍動動畫；內層承載休息張角、雙瓣、翼面朝相機）
    if (R.wings) for (const side of [-1, 1]) {
      const wg = new THREE.Group();
      wg.name = side < 0 ? 'wingL' : 'wingR';
      wg.position.set(side * 0.14, (shoulderY - 0.14) - CHEST_Y, -0.05);   // .09 → 世界 .88,背中段
      const inner = new THREE.Group();
      inner.rotation.y = side * 0.6;                 // 翼面朝前外 → 正面看得到
      inner.rotation.z = side * 0.38;                // 上外張如蝴蝶（略降斜度）
      const up = part(new THREE.CircleGeometry(0.64, 10), '#ffffff', null, { transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      up.scale.set(0.72, 1, 1); up.position.set(side * 0.50, 0.18, 0);
      const lo = part(new THREE.CircleGeometry(0.44, 10), '#ffffff', null, { transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      lo.scale.set(0.66, 1, 1); lo.position.set(side * 0.38, -0.22, 0);
      inner.add(up); inner.add(lo); wg.add(inner); chest.add(wg);
    }

    // ── rig metadata:生成器 ↔ 動畫器 ↔ 物理孿生的三方契約 ──
    // 關節世界位置(未縮放、腳底 y=0 前向 +z)、肢段長、限位、collider、質量全從
    // 實際幾何參數記錄 —— 物理體不需要猜。角色整體 scale 由物理體建立時 ×scale³ 處理。
    group.userData.rig = {
      version: 2,
      headE: [hx, hy, hz],   // 橢球臉半軸(純資訊;collider 仍 ball r=headR,r_eqv==headR)——今無人讀

      joints: {
        pelvis: { parent: null,     pos: [0, PELVIS_Y, 0] },
        spine:  { parent: 'pelvis', pos: [0, SPINE_Y - PELVIS_Y, 0] },
        chest:  { parent: 'spine',  pos: [0, CHEST_Y - SPINE_Y, 0] },
        neck:   { parent: 'chest',  pos: [0, NECK_Y - CHEST_Y, 0] },
        head:   { parent: 'neck',   pos: [0, (legH + torsoH + headR * 0.72) - NECK_Y, 0] },
        armL:   { parent: 'chest',  pos: [-0.30, shoulderY - CHEST_Y, 0] },
        elbowL: { parent: 'armL',   pos: [0, -0.24, 0] },
        armR:   { parent: 'chest',  pos: [0.30, shoulderY - CHEST_Y, 0] },
        elbowR: { parent: 'armR',   pos: [0, -0.24, 0] },
        legL:   { parent: 'pelvis', pos: [-0.16, 0, 0] },
        kneeL:  { parent: 'legL',   pos: [0, -0.21, 0] },
        ankleL: { parent: 'kneeL',  pos: [0, -0.19, 0] },
        legR:   { parent: 'pelvis', pos: [0.16, 0, 0] },
        kneeR:  { parent: 'legR',   pos: [0, -0.21, 0] },
        ankleR: { parent: 'kneeR',  pos: [0, -0.19, 0] },
      },
      seg: { thighLen: 0.21, shinLen: 0.19, ankleH: 0.06, upperArmLen: 0.24, foreArmLen: 0.24,
             hipHalf: 0.16, shoulderHalf: 0.30, pelvisH: PELVIS_Y, standH: PELVIS_Y },
      // 軀幹彈性膠囊蒙皮:整塊 torso 掛 spine,上半頂點按 w 朝 chest 關節彎;
      // torsoY = torso mesh 在 spine-local 的 y 偏移;pivotY = chest 關節在 spine-local 的 y(彎折樞紐);
      // w0/w1 = spine-local y 的權重斜坡起訖(下 0 → 肩高 1),頂點 y_spine=(meshLocalY+torsoY)
      torsoSkin: { torsoY: (legH + torsoH / 2) - SPINE_Y, pivotY: CHEST_Y - SPINE_Y,
                   w0: 0, w1: (shoulderY - SPINE_Y) },
      limits: JOINT_LIMITS,
      colliders: {
        pelvis:  { t: 'capsule', r: 0.26, h: 0.10, off: [0, 0.03, 0], axis: 'y' },
        torsoLo: { t: 'capsule', r: 0.17, h: 0.10, off: [0, -0.10, 0], axis: 'y' },   // 原 r=0.29 巨蛋底蓋插進地面 46mm 被彈飛(全身浮空 bug 元凶);物理體窄於視覺是常態
        chest:   { t: 'capsule', r: 0.28, h: 0.10, off: [0, 0.10, 0], axis: 'y' },
        head:    { t: 'ball', r: headR, off: [0, 0, 0] },
        thighL:  { t: 'capsule', r: 0.135, h: 0.08, off: [0, -0.105, 0], axis: 'y' },
        shinL:   { t: 'capsule', r: 0.07, h: 0.05, off: [0, -0.105, 0], axis: 'y' },   // r=0.12 的胖膠囊底蓋會插進地面 13mm,被接觸穩定器彈飛(浮空 bug);物理用細小腿
        footL:   { t: 'box', hx: 0.075, hy: 0.035, hz: 0.125, off: [0, -0.025, 0.075] },   // 平底鞋底,腳尖往前延(0.15→0.20,腳跟不動)加大前向支撐/踝力矩;圓膠囊=搖馬必倒(實測)
        upperArmL: { t: 'capsule', r: 0.10, h: 0.10, off: [0, -0.13, 0], axis: 'y' },
        foreArmL:  { t: 'capsule', r: 0.09, h: 0.10, off: [0, -0.13, 0], axis: 'y' },
      },
      masses: { head: 1.7, chest: 6.0, torsoLo: 2.0, pelvis: 4.2, thigh: 1.8, shin: 1.3,
                foot: 1.1, upperArm: 0.6, foreArm: 0.9 },   // 頭 6% + 胸減補骨盆手腳(使用者指定)
    };

    group.scale.setScalar(scale);
    return group;
  }

  function addLights(THREE, scene) {
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x9a8fb0, 0.9);   // 暖天光 + 暖紫地光反彈
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff0d8, 0.68);            // 暖 key
    key.position.set(3, 6, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdce8ff, 0.30);           // 冷色正面補光 → 陰面不死黑
    fill.position.set(-2.5, 2, 4);
    scene.add(fill);
    return { hemi, dir: key, key: key, fill: fill };                  // dir 別名向後相容
  }

  const api = {
    character: function (opts) { return makeCharacter(global.THREE, opts || {}); },
    addLights: function (scene) { return addLights(global.THREE, scene); },
    roles: Object.keys(ROLES),
    ROLES: ROLES,
    rig: { JOINT_LIMITS: JOINT_LIMITS },
    _build: makeCharacter,   // 供無頭素材產生器注入 THREE
    // 一次拿到「已綁定動畫」的角色：{ root, char, body, animator }
    //   root  → 遊戲設定「位移 / 面向」的節點（每幀 root.position.set(...)，跳躍抬 root.position.y）
    //   char  → 角色本體（腳底 y=0；面向請設 char.rotation.y）
    //   animator → 每幀 animator.update(dt)；狀態切換 animator.play('run'|'attack'|...)
    // 詳見檔尾 createAnimator。非動畫需求仍可直接用 character()。
    animatedCharacter: function (opts) {
      const THREE = global.THREE;
      const char = makeCharacter(THREE, opts || {});
      const root = new THREE.Group();
      root.name = 'lp-root';
      root.add(char);
      const animator = api.createAnimator(char, { body: char, root: root });
      return { root: root, char: char, body: char, animator: animator };
    },
  };
  global.LowPoly = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================================
 * LowPoly.animator — 可復用、純程序化的角色動畫層（可選模組；依賴同檔的 LowPoly + 全域 THREE）
 * ----------------------------------------------------------------------------
 * 設計定位：lowpoly.js 只建模、產生具名部件(head/torso/armL/armR/legL/legR/wingL/wingR)。
 *   本層把「怎麼動」抽出來，與遊戲的『面向/位移/相機』控制完全分離：
 *   - base-snapshot：createAnimator 內部一次性快照每個具名部件的休息 transform，
 *     每幀 reset→base→疊加 delta（＝格鬥遊戲 updateFighter 的既有模式）。
 *     body 的 rot.x/z、scale、position.y 也是 base 相對「合成」，不蓋掉遊戲預設
 *     （身高正規化縮放放 body 或更下層都可以，沒有「base scale 必須是 1」的咒語）。
 *   - 單一字串狀態：animator.current 是可序列化字串（idle/run/attackR…），
 *     與 sendState({anim}) → 遠端 setAnim 的網路模型 100% 相容（左右已烘進字串）。
 *   - 訊號推導：vv（垂直速度）、air（騰空 0..1）、spd（水平速度）都由 root 幀差推導，
 *     本端物理、遠端插值、display 直設同一份碼；walk/run 步頻 ∝ spd（不滑步）。
 *     ⚠ display 直設快照請先插值再移動 root，否則微分器看到階梯輸入（跳姿會閃）。
 *   - 披風（ROLES 有 cape 旗標的角色：hood/robin/witch/wizard/prince/frog/elf）：主擺彈簧 + 行進波
 *     全由上述訊號驅動 —— 走路後擺、跳躍上掀、落地回拍（彈簧湧現，免事件）；
 *     零新增網路欄位。手感旋鈕表 CAPE 見檔尾；新角色要披風就在 ROLES 加 cape:'body'|色碼。
 *   - 不碰面向：body 節點只寫 rotation.x/z / scale / position.y，絕不動 rotation.y
 *     （那是遊戲的面向）與 root.position（那是遊戲的位移）。
 *   - 不變式：腳是錨 —— bob 只動 torso+head；整隻位移（dropY/scale）只用於
 *     刻意且短暫的破例（落地壓縮、歡呼彈跳）。
 *
 * play() 兩種語義（看名字有沒有被內部轉換）：
 *   觸發：'attack'/'punch'/'kick'/'hit' → 同名也重播（連段、連續受擊不會被吞）；
 *   鏡像：'attackR'/'hurt'/'run' 等已解析名字（＝網路送來的）→ 同名不重播（setAnim 語義）。
 * 一次性動作播完會自動回落最近的迴圈狀態（遊戲忘了接手不會凍結死姿態；
 * 遊戲仍可隨時 play() 覆寫，例如攻擊中接手跑步）。
 *
 * 一行接上（自帶綁定）：
 *   const { root, char, animator } = LowPoly.animatedCharacter({ role:'knight' });
 *   scene.add(root); root.position.set(x, 0, z); char.rotation.y = facing;
 *   animator.play('run'); animator.update(dt);   // 每幀
 *   animator.play('attack');                      // 一次性、自動左右輪替 → 回傳 'attackR'/'attackL'
 *   if (animator.busy) { ... }                    // 動作播放中（攻擊硬直/命中判定閘門）
 *   animator.progress                             // 一次性動作進度 0..1（命中幀/相位 polling 用）
 *
 * 低階（遊戲已有自己的 root/inner 骨架，如 fighter.js）：
 *   const animator = LowPoly.createAnimator(charGroup, { body: innerNode, root: rootNode });
 * 非格鬥遊戲：不呼叫 attack/kick 即可；也能 animator.register('cast', clip) 加自訂動作。
 * ========================================================================== */
(function (global) {
  'use strict';

  const E = {
    lin:    u => u,
    inQ:    u => u * u,
    outQ:   u => 1 - (1 - u) * (1 - u),
    ioQ:    u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
    outCubic: u => 1 - Math.pow(1 - u, 3),
    outBack: u => { const c1 = 1.70158, c3 = c1 + 1; const x = u - 1; return 1 + c3 * x * x * x + c1 * x * x; },
  };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // 逐段 easing 的關鍵影格取樣：keys = [[time, value, easeName], ...]（time 昇冪，0..1）
  function kf(u, keys) {
    if (u <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (u >= last[0]) return last[1];
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (u >= a[0] && u <= b[0]) {
        const span = (b[0] - a[0]) || 1e-6;
        const e = (E[b[2]] || E.lin)((u - a[0]) / span);
        return a[1] + (b[1] - a[1]) * e;
      }
    }
    return last[1];
  }

  const ROT_PARTS = ['torso', 'head', 'armL', 'armR', 'legL', 'legR'];
  // rig v2 關節寫入清單(torso 是 mesh 不是關節 → 不在此;舊 clip 的 torso.* 由 chest 吸收)
  const ROT_PARTS_V2 = ['pelvis', 'spine', 'chest', 'neck', 'head',
    'armL', 'elbowL', 'armR', 'elbowR', 'legL', 'kneeL', 'ankleL', 'legR', 'kneeR', 'ankleR'];
  // pose 通道全表(v1+v2;applyCh 對未知通道本來就靜默略過,舊 clip 零修改)
  const POSE_ROT = ROT_PARTS.concat(['pelvis', 'spine', 'chest', 'neck', 'elbowL', 'elbowR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']);
  function newPose() {
    const p = { bob: 0, lean: 0, tilt: 0, dropY: 0, crouch: 0, sx: 1, sy: 1, sz: 1 };
    for (const n of POSE_ROT) p[n] = { x: 0, y: 0, z: 0 };
    return p;
  }
  function resetPose(p) {
    for (const n of POSE_ROT) { p[n].x = 0; p[n].y = 0; p[n].z = 0; }
    p.bob = 0; p.lean = 0; p.tilt = 0; p.dropY = 0; p.crouch = 0; p.sx = 1; p.sy = 1; p.sz = 1;
  }
  function applyCh(p, ch, v) {
    if (ch === 'sx' || ch === 'sy' || ch === 'sz') { p[ch] *= v; return; }
    if (ch === 'bob' || ch === 'lean' || ch === 'tilt' || ch === 'dropY' || ch === 'crouch') { p[ch] += v; return; }
    const d = ch.indexOf('.');
    const part = ch.slice(0, d), ax = ch.slice(d + 1);
    if (p[part]) p[part][ax] += v;
  }

  function swapLR(part) {
    if (part === 'armL') return 'armR'; if (part === 'armR') return 'armL';
    if (part === 'legL') return 'legR'; if (part === 'legR') return 'legL';
    return part;
  }
  function mirrorTracks(tracks) {
    const out = {};
    for (const ch in tracks) {
      const keys = tracks[ch].map(k => k.slice());
      if (ch === 'tilt') { for (const k of keys) k[1] = -k[1]; out[ch] = keys; continue; }
      if (ch === 'lean' || ch === 'bob' || ch === 'dropY' || ch === 'sx' || ch === 'sy' || ch === 'sz') { out[ch] = keys; continue; }
      const d = ch.indexOf('.'); const part = ch.slice(0, d), ax = ch.slice(d + 1);
      if (ax === 'y' || ax === 'z') for (const k of keys) k[1] = -k[1];
      out[swapLR(part) + '.' + ax] = keys;
    }
    return out;
  }

  function dataClip(dur, tracks) {
    return {
      oneShot: true, dur,
      mask: Object.keys(tracks),   // 疊加遮罩:one-shot 只主導自己寫的通道,其餘讓底層 loop 通過
      sample(c, p) { const u = clamp(c.t / dur, 0, 1); for (const ch in tracks) applyCh(p, ch, kf(u, tracks[ch])); },
    };
  }
  function loopClip(fn) { return { oneShot: false, dur: 0, sample: fn }; }

  // pose 混合:B 以 wB、P 以 wP 線性混合回 P(scalar 同樣插值;scale 亦取插值)
  function blendPose(P, B, wP, wB) {
    for (const n of POSE_ROT) {
      P[n].x = P[n].x * wP + B[n].x * wB;
      P[n].y = P[n].y * wP + B[n].y * wB;
      P[n].z = P[n].z * wP + B[n].z * wB;
    }
    P.bob = P.bob * wP + B.bob * wB; P.lean = P.lean * wP + B.lean * wB;
    P.tilt = P.tilt * wP + B.tilt * wB; P.dropY = P.dropY * wP + B.dropY * wB;
    P.crouch = P.crouch * wP + B.crouch * wB;
    P.sx = P.sx * wP + B.sx * wB; P.sy = P.sy * wP + B.sy * wB; P.sz = P.sz * wP + B.sz * wB;
  }
  // 單通道向 B 插值 w(one-shot 疊加用;與 applyCh 同結構)
  function lerpCh(P, ch, B, w) {
    if (ch === 'sx' || ch === 'sy' || ch === 'sz' || ch === 'bob' || ch === 'lean' || ch === 'tilt' || ch === 'dropY' || ch === 'crouch') {
      P[ch] += (B[ch] - P[ch]) * w; return;
    }
    const d = ch.indexOf('.');
    const part = ch.slice(0, d), ax = ch.slice(d + 1);
    if (P[part]) P[part][ax] += (B[part][ax] - P[part][ax]) * w;
  }
  /* --------------------------------------------------------------------------
   * 兩段式 IK(矢狀面解析解;純函式無 THREE,node 可測)
   * 慣例與骨架一致:角色面向 +z;回傳關節 rotation.x(髖:負=前擺;膝:正=向後屈曲)。
   * hip/foot = [x,y,z](同一座標系,通常 char 局部);L1=大腿長、L2=小腿長。
   * reserve = 膝保留角(rad,預設 0.09≈5°)→ 最大可及略小於腿全長,腿不鎖死。
   * -------------------------------------------------------------------------- */
  function ikSolve(hip, foot, L1, L2, opts) {
    opts = opts || {};
    const eps = 1e-6;
    const reserve = opts.reserve == null ? 0.09 : opts.reserve;
    const f = foot[2] - hip[2];              // 前向距離(含符號,+z 為前)
    const dy = hip[1] - foot[1];             // 向下距離(正=腳在髖之下)
    const rawD = Math.hypot(f, dy);
    const maxD = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(reserve));
    const minD = Math.abs(L1 - L2) + eps;
    const d = clamp(rawD, minD, maxD);
    const phi = Math.atan2(f, dy);           // 髖→腳向量與正下方夾角(正=前)
    const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const A = Math.acos(cosA);               // 髖三角角(大腿與髖→腳向量)
    const hipPitch = phi + A;                // 大腿前傾角(正=前;膝蓋前凸、小腿向後勾的人腿解)
    const cosK = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
    const kneeFlex = Math.PI - Math.acos(cosK);   // 膝屈曲(正=小腿相對大腿向後)
    return { hipX: -hipPitch, kneeX: kneeFlex, d: d, clamped: rawD > maxD || rawD < minD };
  }
  // FK 驗證用:由髖/膝角回推腳位置(與 ikSolve 同慣例)
  function fkLeg(hip, hipX, kneeX, L1, L2) {
    const a1 = -hipX;                        // 大腿前傾角(正=前)
    const a2 = a1 - kneeX;                   // 小腿方向 = 大腿方向 − 屈曲
    const knee = [hip[0], hip[1] - L1 * Math.cos(a1), hip[2] + L1 * Math.sin(a1)];
    const foot = [knee[0], knee[1] - L2 * Math.cos(a2), knee[2] + L2 * Math.sin(a2)];
    return { knee: knee, foot: foot };
  }

  /* --------------------------------------------------------------------------
   * GaitSolver(rig v2 walk/run 的底層):velocity-driven 步態
   * - 腳掌 world-anchor 定點:觸地記世界座標,支撐期每幀反解回 char-local → 不滑步
   * - 腳步規劃:步長 L=spd·T(構造上支撐腳後移速度=地面速度)+ 速度前饋 + 轉彎側向
   * - 兩段式踝 IK;骨盆高度=standH−crouch(φ) 且受雙腿可及硬約束;脊椎反向補償
   * - 起步半步 / 煞車收腳(anticipation,全連續函數);決定性:同輸入串 → 同輸出
   * -------------------------------------------------------------------------- */
  const GAIT_K = {
    walk: { clear: 0.045, crouch: 0.015, armK: 0.45 },
    run:  { clear: 0.075, crouch: 0.035, armK: 0.70 },
  };
  // loop 間 cross-fade 時間表(rig v2 混合器;idle↔walk 0.18、→jump 0.10、→ko 0.25)
  const FADES = { default: 0.15, 'idle|walk': 0.18, 'walk|idle': 0.18, 'walk|run': 0.15, 'run|walk': 0.15,
    'idle|run': 0.18, 'run|idle': 0.18, 'idle|jump': 0.10, 'walk|jump': 0.10, 'run|jump': 0.10,
    'idle|ko': 0.25, 'walk|ko': 0.25, 'run|ko': 0.25, 'ko|idle': 0.30, 'ko|walk': 0.30, 'ko|run': 0.30 };
  // 步態頻率表(模組層:gaitStep 與 createAnimator 共用)
  // spd=ref 時維持原本手感(walk 8rad/s@4u/s、run 13rad/s@8u/s),上限 2 倍避免殘影
  const GAIT = { walk: { f: 8, ref: 4 }, run: { f: 13, ref: 8 } };

  // root 平移 + char yaw(+等比) 的雙向變換(純函式;與 THREE 的 rotation.y 同向)
  function makeFrame(rootPos, yaw, s) {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    return {
      toLocal(w, out) {
        const dx = w[0] - rootPos[0], dy = w[1] - rootPos[1], dz = w[2] - rootPos[2];
        out[0] = (c * dx - sn * dz) / s;
        out[1] = dy / s;
        out[2] = (sn * dx + c * dz) / s;
        return out;
      },
      toWorld(l, out) {
        out[0] = rootPos[0] + (c * l[0] + sn * l[2]) * s;
        out[1] = rootPos[1] + l[1] * s;
        out[2] = rootPos[2] + (-sn * l[0] + c * l[2]) * s;
        return out;
      },
    };
  }

  function createGaitState() {
    return {
      feet: {
        L: { mode: 'stance', anchorW: null, from: [0, 0, 0], to: [0, 0, 0], u: 1, T: 0.3 },
        R: { mode: 'stance', anchorW: null, from: [0, 0, 0], to: [0, 0, 0], u: 1, T: 0.3 },
      },
      pelvis: [0, 0.46, 0], pelvisYV: 0,
      prevSinL: 0, prevSinR: 0, prevSpd: 0, acc: 0, stepL: 0, stepCount: 0,
      steps: [],      // footfall 記錄 {foot, t, w:[x,y,z]}(測試/腳印貼花用)
      footL: [-0.16, 0, 0], footR: [0.16, 0, 0],   // 當前腳 char-local(每幀輸出)
      out: { px: 0, py: 0.46, pz: 0, yaw: 0, roll: 0, hipLX: 0, kneeLX: 0, ankleLX: 0, hipRX: 0, kneeRX: 0, ankleRX: 0,
             footWL: null, footWR: null },          // 腳世界座標輸出(測試/harness)
      firstStep: true,
    };
  }

  function gaitFootTarget(A, F, side, T, forceBrake) {
    // lift-off:規劃下一步落點(世界座標)
    const G = A._gait, frame = A._frame, seg = A.rig.seg;
    const spd = A.spd, vel = A._velVec;
    frame.toWorld(G[side === 'L' ? 'footL' : 'footR'], F.from);
    const moving = spd > 0.05;
    const L = G.stepL;                                     // 步長(已在 gaitStep 夾過上限)
    const first = G.firstStep ? 0.5 : 1;                   // 起步半步
    const brake = forceBrake || (G.acc < -1 && moving);    // 煞車/收攏 → 收回骨盆正下
    const dir = moving ? [vel[0] / spd, vel[1] / spd] : [Math.sin(A._yaw), Math.cos(A._yaw)];
    const perp = [-dir[1], dir[0]];                        // 身體左側
    const stepL = brake ? 0.02 : L * first;
    const lat = A._yawRate * T * seg.hipHalf * 0.6 + (side === 'L' ? 1 : -1) * seg.hipHalf * A._charScale;   // perp=−x=L 側(對齊 rig 慣例 legL@−x)
    // 落點以「運動中心(root 地面投影)」為錨 — 不能用骨盆位置(骨盆追腳、腳追骨盆會倒退漂移)
    const centerW = frame.toWorld([0, G.pelvis[1], 0], [0, 0, 0]);
    const groundY = A._groundY;
    if (brake) {
      F.to[0] = centerW[0] + perp[0] * lat; F.to[2] = centerW[2] + perp[1] * lat;
    } else {
      // 落點 = 運動中心 + 觸地前的前進量 + 前向半步 + 轉彎側向
      F.to[0] = centerW[0] + dir[0] * (spd * T * 0.55 + stepL / 2) + perp[0] * lat;
      F.to[2] = centerW[2] + dir[1] * (spd * T * 0.55 + stepL / 2) + perp[1] * lat;
    }
    F.to[1] = groundY;
    F.T = Math.max(0.07, T * 0.55);                        // 擺盪時間(須 < 抬腳窗口,否則高速掉步)
    F.u = 0;
    G.firstStep = false;
  }

  function gaitStep(A, dtC) {
    const G = A._gait, c = A._ctx, rig = A.rig, seg = rig.seg, P = A.pose;
    const K = GAIT_K[A._lastBase] || GAIT_K.walk;
    const frame = A._frame, spd = A.spd, amp = c.gaitAmp;
    const g = GAIT[A._lastBase] || GAIT.walk;
    // 步長夾上限(腿可及內)→ 相位率隨速度提高;與 update 的表頻率互斥(solver 自推相位)。
    // 頻率再夾上限 55 rad/s(60fps 混疊保護;超速時改放長步長,IK 以膝保留收邊)。
    const LMAX = Math.min(0.34, (seg.thighLen + seg.shinLen) * 0.85);
    const WMAX = 55;
    let L = Math.min(spd * Math.PI / (g.f * clamp(spd / g.ref, 0, 2)), LMAX);
    let omega = spd > 1e-3 ? spd * Math.PI / Math.max(L, 1e-4) : 0;
    if (omega > WMAX) { omega = WMAX; L = spd * Math.PI / omega; }
    const T = omega > 1e-3 ? Math.PI / omega : 0.4;        // 半週期(一步)
    G.stepL = L;
    A._gaitPhase += dtC * omega;
    c.phase = A._gaitPhase;
    const maxD = Math.sqrt(seg.thighLen * seg.thighLen + seg.shinLen * seg.shinLen
      + 2 * seg.thighLen * seg.shinLen * Math.cos(0.09));  // 膝保留可及長(同 ikSolve)
    const tmpW = [0, 0, 0];

    // 加速度(煞車偵測;漏斗平滑)
    G.acc += (((spd - G.prevSpd) / Math.max(dtC, 1e-4)) - G.acc) * 0.35;
    G.prevSpd = spd;

    // ── 雙腳狀態機:擺盪期=sin 正半波;負→正過零=抬腳 ──
    for (const side of ['L', 'R']) {
      const F = G.feet[side];
      const off = side === 'L' ? 0 : Math.PI;
      const sn = Math.sin(c.phase + off);
      const prev = side === 'L' ? G.prevSinL : G.prevSinR;
      if (F.mode === 'stance' && prev <= 0 && sn > 0 && amp > 0.5) {
        gaitFootTarget(A, F, side, T);
        F.mode = 'swing';
      }
      if (F.mode === 'swing') {
        F.u += dtC / F.T;
        if (F.u >= 1) {
          F.u = 1; F.mode = 'stance';
          F.anchorW = F.to.slice();
          G.stepCount++;
          G.steps.push({ foot: side, t: A.t, w: F.to.slice() });
          if (G.steps.length > 16) G.steps.shift();
        }
      }
      // 支撐腳落後異常(急轉/被拖)→ 提前換步(閾值隨步長,正常支撐不誤觸)
      if (F.mode === 'stance' && F.anchorW && amp > 0.5) {
        frame.toLocal(F.anchorW, tmpW);
        const lagX = tmpW[0] - G.pelvis[0], lagZ = tmpW[2] - G.pelvis[2];
        if (Math.hypot(lagX, lagZ) > Math.max(0.5, G.stepL * 1.3 + 0.1)) { gaitFootTarget(A, F, side, T); F.mode = 'swing'; }
      }
      if (side === 'L') G.prevSinL = sn; else G.prevSinR = sn;
    }

    // ── 收攏/原地轉身:速度≈0 但腳未收攏、或原地持續轉向 → 輪流強制換步(相位已凍結)──
    {
      // 距離量測以「雙腳中點」為準(骨盆刻意配重偏向支撐腳,對它量距離會永遠收不完)
      const midX = (G.footL[0] + G.footR[0]) / 2, midZ = (G.footL[2] + G.footR[2]) / 2;
      const farL = Math.hypot(G.footL[0] - midX, G.footL[2] - midZ);
      const farR = Math.hypot(G.footR[0] - midX, G.footR[2] - midZ);
      const turning = amp > 0.1 && Math.abs(A._yawRate) > 1.0 && spd < 0.6;
      // 收攏自限:距離 >0.24 才觸發,收好就停(不掛 amp — 否則 amp 先衰減,腳永遠收不完)
      const needGather = spd < 0.4 && Math.max(farL, farR) > 0.24;
      if (needGather || turning) {
        const side = farL >= farR ? 'L' : 'R';
        const F = G.feet[side], FO = G.feet[side === 'L' ? 'R' : 'L'];
        if (F.mode === 'stance' && FO.mode === 'stance') {   // 一次只擺一腳
          gaitFootTarget(A, F, side, 0.3, true);
          F.mode = 'swing';
        }
      }
    }

    // ── 腳 char-local 目標(支撐=anchor 反解[定點不滑];擺盪=軌跡插值)──
    const footTgt = { L: G.footL, R: G.footR };
    for (const side of ['L', 'R']) {
      const F = G.feet[side], tgt = footTgt[side];
      if (F.mode === 'stance' && F.anchorW) {
        frame.toLocal(F.anchorW, tgt);
      } else {
        const u = clamp(F.u, 0, 1), e = E.ioQ(u);
        tmpW[0] = F.from[0] + (F.to[0] - F.from[0]) * e;
        tmpW[1] = F.from[1] + (F.to[1] - F.from[1]) * e + Math.sin(Math.PI * u) * K.clear;
        tmpW[2] = F.from[2] + (F.to[2] - F.from[2]) * e;
        frame.toLocal(tmpW, tgt);
      }
      // 腳世界座標輸出(測試不滑步/harness 腳印)
      G.out[side === 'L' ? 'footWL' : 'footWR'] = frame.toWorld(tgt, [0, 0, 0]);
    }

    // ── 骨盆解:XZ=雙腳中點偏支撐腳;Y=standH−crouch(φ) 受腿長硬約束 ──
    const stanceF = G.feet.L.mode === 'stance' ? footTgt.L : (G.feet.R.mode === 'stance' ? footTgt.R : null);
    const midX = (footTgt.L[0] + footTgt.R[0]) / 2, midZ = (footTgt.L[2] + footTgt.R[2]) / 2;
    // 騰空(跳躍)保護:支撐腳定點是為了「站在地上身體移過去、腳不滑」,但騰空時腳離地。
    // 若還把腳釘在起跳點,骨盆(→ 脊椎→頭,整個上半身)會被拖回起跳前的位置,落地再重新定錨彈回,
    // 造成明顯的「落地被拉回起跳點再瞬移回來」。騰空時改讓骨盆回到 root 正下方並清掉舊錨點
    // (落地時於落點重新定錨)。air=0 的地面步態完全不受影響。
    const airborne = (c.air || 0) > 0.12;
    if (airborne) {
      G.feet.L.anchorW = null; G.feet.R.anchorW = null;
      G.pelvis[0] += (0 - G.pelvis[0]) * Math.min(1, dtC * 12);
      G.pelvis[2] += (0 - G.pelvis[2]) * Math.min(1, dtC * 12);
    } else {
      const tgtPX = stanceF ? midX * 0.65 + stanceF[0] * 0.35 : midX;
      const tgtPZ = stanceF ? midZ * 0.65 + stanceF[2] * 0.35 : midZ;
      G.pelvis[0] += (tgtPX - G.pelvis[0]) * Math.min(1, dtC * 10);
      G.pelvis[2] += (tgtPZ - G.pelvis[2]) * Math.min(1, dtC * 10);
    }
    const crouch = K.crouch * (1 - Math.cos(2 * c.phase)) / 2 * amp + P.crouch;
    let py = seg.standH - crouch;
    for (const side of ['L', 'R']) {
      if (G.feet[side].mode === 'stance') py = Math.min(py, footTgt[side][1] + maxD);
    }
    // 骨盆高度彈簧(ω=12 ζ=.9,過渡軟)
    G.pelvisYV += ((py - G.pelvis[1]) * 144 - G.pelvisYV * 21.6) * dtC;
    G.pelvis[1] += G.pelvisYV * dtC;

    // 骨盆 yaw/roll(向擺盪側旋/傾)
    const s0 = Math.sin(c.phase) * amp;
    const pelvisYaw = 0.12 * s0, pelvisRoll = 0.06 * s0;

    // ── 雙腿 IK(髖位置含骨盆 yaw 微擾)──
    const cy = Math.cos(pelvisYaw), sy = Math.sin(pelvisYaw);
    for (const side of ['L', 'R']) {
      const sgn = side === 'L' ? -1 : 1;
      const hipPos = [
        G.pelvis[0] + cy * sgn * seg.hipHalf,
        G.pelvis[1],
        G.pelvis[2] - sy * sgn * seg.hipHalf,
      ];
      const s = ikSolve(hipPos, footTgt[side], seg.thighLen, seg.shinLen, {});
      const F = G.feet[side];
      const toe = F.mode === 'swing' ? 0.35 * Math.sin(Math.PI * clamp(F.u, 0, 1)) : 0;
      if (side === 'L') { G.out.hipLX = s.hipX; G.out.kneeLX = s.kneeX; G.out.ankleLX = -(s.hipX + s.kneeX) + toe; }
      else { G.out.hipRX = s.hipX; G.out.kneeRX = s.kneeX; G.out.ankleRX = -(s.hipX + s.kneeX) + toe; }
    }
    G.out.px = G.pelvis[0]; G.out.py = G.pelvis[1]; G.out.pz = G.pelvis[2];
    G.out.yaw = pelvisYaw; G.out.roll = pelvisRoll;

    // ── 寫進 pose 通道(幅度隨 amp 縮放,起步/停頓平滑)──
    const stepL = Math.hypot(footTgt.L[2] - footTgt.R[2], footTgt.L[0] - footTgt.R[0]);
    const armSwing = clamp(stepL / seg.thighLen * 0.5, 0, 1) * K.armK * amp;
    P.legL.x = G.out.hipLX * amp; P.kneeL.x = G.out.kneeLX * amp; P.ankleL.x = G.out.ankleLX * amp;
    P.legR.x = G.out.hipRX * amp; P.kneeR.x = G.out.kneeRX * amp; P.ankleR.x = G.out.ankleRX * amp;
    P.armL.x += s0 * armSwing; P.armR.x += -s0 * armSwing;      // 反相擺臂:L 腿前擺(s0>0)→ 左臂後擺(solver 相位語義;舊 clip 相位相反勿混用)
    // 彎肘隨速度連續(文獻梯度:walk 微屈 ~0.2 rad → 衝刺 ~1.2 rad)+ 前甩動態微收
    // 方向:肘 .x 負 = 前臂「往前」抬(跑步手在身前);正值會往身後勾,勿用
    const elbowBase = 0.2 + clamp((spd - 4) / 5, 0, 1) * 1.0;
    const sPh = Math.sin(c.phase);
    P.elbowL.x += -(elbowBase + 0.15 * clamp(-sPh, 0, 1)) * amp;   // 左臂前擺(sPh<0)時稍收
    P.elbowR.x += -(elbowBase + 0.15 * clamp(sPh, 0, 1)) * amp;
    P.pelvis.y = pelvisYaw * amp; P.pelvis.z = pelvisRoll * amp;
    // 脊椎鏈:前傾跟速度/加速度,反向補償骨盆旋轉 → 視線水平
    const leanBase = clamp(spd * 0.03, 0, 0.25) + clamp(G.acc * 0.02, -0.1, 0.15);
    P.spine.x += leanBase * 0.4 * amp;
    P.chest.x += leanBase * 0.4 * amp;
    P.chest.y += -pelvisYaw * 0.7 * amp; P.chest.z += -pelvisRoll * 0.5 * amp;
    P.neck.z += -pelvisRoll * 0.8 * amp; P.neck.y += -pelvisYaw * 0.3 * amp;
    if (G.acc < -1) P.spine.x += -0.05 * clamp(-G.acc / 6, 0, 1) * amp;   // 煞車後仰
    if (amp < 0.01) G.firstStep = true;                                    // 停定 → 下次起步重新半步
  }

  // 慣例：arm/leg .x 為負 = 往前擺
  const PUNCH_TRACKS = {
    'armR.x': [[0, 0], [0.18, 0.55, 'outQ'], [0.42, -1.75, 'outCubic'], [1, 0, 'ioQ']],
    'torso.y': [[0, 0], [0.18, -0.20, 'outQ'], [0.42, 0.30, 'outCubic'], [1, 0, 'ioQ']],
    'lean':   [[0, 0], [0.18, -0.06, 'outQ'], [0.42, 0.22, 'outCubic'], [1, 0, 'ioQ']],
    'legL.x': [[0, 0], [0.42, 0.22, 'outQ'], [1, 0, 'ioQ']],
    'legR.x': [[0, 0], [0.42, -0.22, 'outQ'], [1, 0, 'ioQ']],
  };
  const KICK_TRACKS = {
    'legR.x': [[0, 0], [0.16, 0.45, 'outQ'], [0.4, -1.65, 'outCubic'], [1, 0, 'ioQ']],
    'lean':   [[0, 0], [0.16, 0.12, 'outQ'], [0.4, -0.22, 'outCubic'], [1, 0, 'ioQ']],
    'armL.z': [[0, 0], [0.4, 0.5, 'outQ'], [1, 0, 'ioQ']],
    'armR.z': [[0, 0], [0.4, -0.35, 'outQ'], [1, 0, 'ioQ']],
    'armR.x': [[0, 0], [0.4, -0.4, 'outQ'], [1, 0, 'ioQ']],
  };
  const HURT_TRACKS = {
    'lean':   [[0, -0.5, 'outQ'], [1, 0, 'ioQ']],
    'tilt':   [[0, 0.2, 'outQ'], [1, 0, 'ioQ']],
    'head.x': [[0, 0.3, 'outQ'], [1, 0, 'ioQ']],
    'armL.z': [[0, 0.7, 'outQ'], [1, 0, 'ioQ']],
    'armR.z': [[0, -0.7, 'outQ'], [1, 0, 'ioQ']],
  };
  const LAND_TRACKS = {
    'sy':     [[0, 0.80], [0.45, 1.06, 'outBack'], [1, 1, 'outQ']],
    'sx':     [[0, 1.14], [0.45, 0.97, 'outBack'], [1, 1, 'outQ']],
    'sz':     [[0, 1.14], [0.45, 0.97, 'outBack'], [1, 1, 'outQ']],
    'dropY':  [[0, -0.12, 'outQ'], [0.5, 0, 'outQ']],
    'lean':   [[0, 0.10, 'outQ'], [0.4, 0, 'outQ']],
    'legL.x': [[0, 0.5, 'outQ'], [0.5, 0, 'outQ']],
    'legR.x': [[0, 0.5, 'outQ'], [0.5, 0, 'outQ']],
    // rig v2:落地屈膝吸震(v1 pose 靜默略過,畫面與舊版一致)
    'kneeL.x': [[0, 0.55, 'outQ'], [0.5, 0, 'ioQ']],
    'kneeR.x': [[0, 0.55, 'outQ'], [0.5, 0, 'ioQ']],
    'crouch':  [[0, 0.10, 'outQ'], [0.5, 0, 'ioQ']],
  };
  const EMOTE_TRACKS = {   // 歡呼：雙手「往外往上」舉成 V（armL 負 z＝往外，別搞反）+ 抬頭 + 兩下小彈跳
    'armL.z': [[0, 0], [0.22, -2.25, 'outBack'], [0.75, -2.05], [1, 0, 'ioQ']],
    'armR.z': [[0, 0], [0.22, 2.25, 'outBack'], [0.75, 2.05], [1, 0, 'ioQ']],
    'head.x': [[0, 0], [0.30, -0.18, 'outQ'], [0.80, -0.12], [1, 0, 'ioQ']],
    'dropY':  [[0, 0], [0.25, 0.16, 'outQ'], [0.50, 0, 'inQ'], [0.72, 0.12, 'outQ'], [0.95, 0, 'inQ'], [1, 0]],
    'sy':     [[0, 1], [0.25, 1.06, 'outQ'], [0.5, 1, 'inQ'], [1, 1]],
  };

  const BUILTIN = {
    idle: loopClip((c, p) => {   // 呼吸幅度刻意小 —— 只是「活著」的感覺，不是在動
      p.bob += Math.sin(c.t * 3) * 0.02;
      p.armL.x += Math.sin(c.t * 2.2) * 0.09;
      p.armR.x += -Math.sin(c.t * 2.2) * 0.09;
      const br = Math.sin(c.t * 3) * 0.006; p.sy *= 1 + br; p.sx *= 1 - br * 0.5; p.sz *= 1 - br * 0.5;
    }),
    // walk/run 的擺動相位用 c.phase（update() 依 spd 累加，頻率 ∝ 速度 → 不滑步），
    // 幅度乘 c.gaitAmp 站定包絡（速度歸零 → 淡出到中立站姿，不凍結半跨步）。
    walk: loopClip((c, p) => {
      const a = c.gaitAmp, s = Math.sin(c.phase) * a;
      p.legL.x += s * 0.55; p.legR.x += -s * 0.55;
      p.armL.x += -s * 0.45; p.armR.x += s * 0.45;
      p.bob += Math.abs(Math.cos(c.phase)) * 0.035 * a; p.lean += 0.06 * a;
    }),
    run: loopClip((c, p) => {
      const a = c.gaitAmp, s = Math.sin(c.phase) * a;
      p.legL.x += s * 0.85; p.legR.x += -s * 0.85;
      p.armL.x += -s * 0.7; p.armR.x += s * 0.7;
      p.bob += Math.abs(Math.cos(c.phase)) * 0.05 * a; p.lean += 0.12 * a;
    }),
    // jump：由「垂直速度 vv + 是否騰空 air」自動驅動（起跳伸展 → 空中一腳前一腳後 → 下落伸腿）。
    // vv/air 由 root.y 幀差自算 → 本端 + 遠端插值皆可用。
    // 落地後 air 平滑歸零 → 跳姿「自然」滑回站姿（不加額外壓縮彈跳）。
    jump: loopClip((c, p) => {
      const air = c.air;
      const rise = clamp(c.vv / 9, 0, 1) * air;
      const fall = clamp(-c.vv / 12, 0, 1) * air;
      const mid = air * (1 - Math.max(rise * 0.6, fall));   // 騰空感（頂點最強）
      // 一腳前、一腳後（跨步跳，後腳膝蓋後勾）
      p.legL.x += -0.95 * mid - 0.25 * rise + 0.40 * fall;
      p.legR.x +=  0.65 * mid + 0.15 * rise + 0.40 * fall;
      // 手臂往外往上張開
      const armUp = 0.85 * rise + 0.50 * mid + 0.30 * fall;
      p.armL.z += -armUp; p.armR.z += armUp;
      p.armL.x += -0.35 * rise; p.armR.x += -0.35 * rise;
      const h = 1 - 0.08 * rise + 0.03 * fall;
      p.sx *= h; p.sz *= h; p.sy *= 1 + 0.12 * rise - 0.04 * fall;
      p.lean += 0.05 * mid - 0.04 * rise + 0.10 * fall;
    }),
    ko: loopClip((c, p) => {
      const k = clamp(c.bt / 0.4, 0, 1);
      p.lean += -Math.PI / 2 * k; p.dropY += 0.45 * k;
    }),
    attackR: dataClip(0.28, PUNCH_TRACKS),
    attackL: dataClip(0.28, mirrorTracks(PUNCH_TRACKS)),
    kickR:   dataClip(0.40, KICK_TRACKS),
    kickL:   dataClip(0.40, mirrorTracks(KICK_TRACKS)),
    hurt:    dataClip(0.32, HURT_TRACKS),
    land:    dataClip(0.22, LAND_TRACKS),
    emote:   dataClip(0.80, EMOTE_TRACKS),
  };
  const BASE_NAMES = { idle: 1, walk: 1, run: 1, jump: 1, ko: 1 };

  /* --------------------------------------------------------------------------
   * 飄動系統(披風/背髮簾/辮子)— 與翅膀同例:_write 末尾的 _flutter 通道。
   * mesh 類(披風 cape、背髮簾 hairBack)走 deformMesh 頂點變形;group 類(辮子 hairBraidL/R)
   * 走巢狀 kinematic chain —— 根部 θ[0] 剛體擺 + 串聯鏈 θ[1..N] 追上一節(末端 lag 根部,柔性不像棍子)。
   * 主擺 = 1-DOF 欠阻尼彈簧(目標角由 spd/vv/air 決定;落地時目標塌掉
   * → 過衝自然是一記下拍,免落地事件 —— 事件是離散狀態,會破壞三端確定性);
   * mesh 抖動 = 解析行進波(相位累加,頻率跟速度走,不跳)。全部只吃 ctx 訊號 + 時鐘,
   * 三端(權威/插值/直設)同形,零新增網路欄位。手感旋鈕:CAPE(披風)/HAIR(背髮)/BRAID(辮子)。
   * ------------------------------------------------------------------------ */
  // 飄動旋鈕表 — 披風/背髮簾共用同一個變形函式 deformMesh,差別只在旋鈕。
  // topY/botY(領口釘死/下擺全開的變形權重兩端)不在表裡,註冊時從各 mesh 的 bbox 算 → 換造型自適應。
  const CAPE = {   // 披風:面積大、阻尼重
    neckZ: 0, spdSwing: 0.055, maxSwing: 0.55, fallLift: 0.50, riseLift: 0.10,
    springW: 8, springZ: 0.5, waveK: 7, waveFreq: 1.9, waveFreqSpd: 5.5,
    waveAmp: 0.025, waveAmpSpd: 0.05, waveAmpAir: 0.06, azimPhase: 0.8,
    gaitSway: 0.05, thetaMin: -0.35, thetaMax: 1.4,
  };
  const HAIR = {   // 背髮簾(公主/仙子):較輕、較短 → 擺幅小、彈簧稍快、阻尼輕(更會回彈)
    neckZ: 0, spdSwing: 0.030, maxSwing: 0.30, fallLift: 0.28, riseLift: 0.06,
    springW: 9, springZ: 0.42, waveK: 6, waveFreq: 2.4, waveFreqSpd: 4.0,
    waveAmp: 0.015, waveAmpSpd: 0.03, waveAmpAir: 0.04, azimPhase: 0.8,
    gaitSway: 0.04, thetaMin: -0.22, thetaMax: 0.9,
  };
  const BRAID = {  // 辮子(小紅帽):根部剛體擺 + 串聯鏈(貼身剛性、末端鞭狀)
    springW: 7,                 // 根部角頻率 ω ≈ 自然頻率 √(g/L)≈7.48 → 不動,降了變遲鈍
    springZ: 0.5,
    leanK: 0.045, maxLean: 0.34, fallLean: 0.30, leanMin: -0.45, leanMax: 0.45,  // 根 lean 收小:貼身段不大幅撞身體
    joints: 5,                  // 串聯關節數 = N−1(puff0 錨定不計);註冊時 clamp 到實際段數
    rigidJoints: 2,             // 前幾關節剛性隨根(貼身上半段,不彎進身體);其後才鞭狀(自由末端 lag)
    jointW: 10,                 // 鞭狀段 ω:低 → 末端 lag 更明顯(柔性)
    jointZ: 0.45,               // 鞭狀段阻尼:低 → 變速時 ring/甩鞭(貼身段剛性已防撞身體,這裡可放膽甩)
  };

  // 變形場:以「頂點位置」為鍵(y→高度權重、atan2→方位角),與 LatheGeometry
  // 頂點排布/段數/profile 完全無關 —— 改造型不用動這裡,stub 測試可吃任意頂點陣列。
  // 純函式:同 base + 同 S → 同 out(三端確定性);S 各項為 0 時還原 base。
  // flat shading 的法線在 fragment shader 算 → 變形後不用重算法線,只下 needsUpdate。
  function deformMesh(base, out, S, K) {
    const topY = K.topY, span = (K.topY - K.botY) || 1e-6;
    for (let i = 0; i < out.length; i += 3) {
      const x = base[i], y = base[i + 1], z = base[i + 2];
      let w = clamp((topY - y) / span, 0, 1); w = w * w * (3 - 2 * w);   // 領口 0(釘死)→ 下擺 1
      const a = S.theta * w;                                             // 主擺:繞樞紐轉 θ·w
      const dy = y - topY, dz = z - K.neckZ;
      const ca = Math.cos(a), sa = Math.sin(a);
      let nx = x, ny = topY + dy * ca - dz * sa, nz = K.neckZ + dy * sa + dz * ca;
      const wave = S.waveAmp * Math.sin(K.waveK * (topY - y) - S.wavePhase + K.azimPhase * Math.atan2(x, z)) * w;
      const rl = Math.sqrt(x * x + z * z) || 1e-6;
      nx += (x / rl) * wave + S.sway * w;   // sway = 步態左右晃(char 局部 x)
      nz += (z / rl) * wave;
      out[i] = nx; out[i + 1] = ny; out[i + 2] = nz;
    }
  }

  // 辮子串聯鏈積分(純函式,無 THREE):th[0]=根部(追 target0);前 rigidJoints 節「剛性隨根」
  // (貼身部分不各自彎進身體),其後才串聯 lag(自由末端鞭狀,末端 lag 根部)。
  // 同 th/vv/target0 + 同 K/dtC → 同結果(三端 bit-exact 確定性)。回傳即輸入 th(原地更新)。
  function braidStep(th, vv, target0, K, dtC) {
    const a0 = K.springW * K.springW * (target0 - th[0]) - 2 * K.springZ * K.springW * vv[0];
    vv[0] += a0 * dtC;
    th[0] = clamp(th[0] + vv[0] * dtC, K.leanMin, K.leanMax);
    const rigid = Math.max(0, Math.min((K.rigidJoints | 0) || 0, th.length - 2));  // 剛性段數(clamp;留至少 1 節鞭)
    for (let j = 1; j < th.length; j++) {
      if (j <= rigid) { th[j] = th[0]; vv[j] = vv[0]; }   // 剛性:隨根部(碰到身體的部分不彎進身體)
      else {
        const aj = K.jointW * K.jointW * (th[j - 1] - th[j]) - 2 * K.jointZ * K.jointW * vv[j];
        vv[j] += aj * dtC;
        th[j] = clamp(th[j] + vv[j] * dtC, K.leanMin, K.leanMax);
      }
    }
    return th;
  }

  // 軀幹彈性膠囊蒙皮(純函式,無 THREE):整塊 torso 掛 spine,上半頂點按 w 繞 chest 樞紐彈性彎折。
  // 每頂點 slerp(identity, chestQuat, w)(rest=identity;w 下 0→肩高 1),再繞 pivotY 旋轉 → 2-bone 線性混皮的解析版。
  // 同 base+同 q+同 w → 同 out(三端確定性);q=identity 時還原 base。flat shading 免重算法線,只下 needsUpdate。
  function skinTorsoMesh(base, out, w, q, pivotY, nV) {
    let Qx = q.x, Qy = q.y, Qz = q.z, Qw = q.w;
    if (Qw < 0) { Qx = -Qx; Qy = -Qy; Qz = -Qz; Qw = -Qw; }   // 走短弧(identity→q)
    const dot = Math.min(1, Qw), th = dot > 0.9995 ? 0 : Math.acos(dot), s = Math.sin(th);
    for (let i = 0; i < nV; i++) {
      const wi = w[i];
      let rx, ry, rz, rw;
      if (th === 0) { rx = Qx * wi; ry = Qy * wi; rz = Qz * wi; rw = (1 - wi) + Qw * wi; }   // nlerp(近 identity)
      else { const a = Math.sin((1 - wi) * th) / s, b = Math.sin(wi * th) / s;
             rx = b * Qx; ry = b * Qy; rz = b * Qz; rw = a + b * Qw; }
      const inv = 1 / (Math.hypot(rx, ry, rz, rw) || 1e-9); rx *= inv; ry *= inv; rz *= inv; rw *= inv;
      // v' = pivot + R·(v − pivot);pivot = [0, pivotY, 0]。旋轉用 t=2·(r.xyz × v);v'=v+rw·t+r.xyz×t
      const vx = base[i * 3], vy = base[i * 3 + 1] - pivotY, vz = base[i * 3 + 2];
      const tx = 2 * (ry * vz - rz * vy), ty = 2 * (rz * vx - rx * vz), tz = 2 * (rx * vy - ry * vx);
      out[i * 3]     = vx + rw * tx + (ry * tz - rz * ty);
      out[i * 3 + 1] = vy + rw * ty + (rz * tx - rx * tz) + pivotY;
      out[i * 3 + 2] = vz + rw * tz + (rx * ty - ry * tx);
    }
  }


  // 簡單模式罐頭運動:網路角色用。照狀態(idle/walk/run/jump)寫一個固定循環(髖/膝/踝/臂/肘/身),
  // 相位由外部速度推(不從位置反推)、不貼地、不 IK。膝肘會彎 → 比木偶自然,又不會在網路抖動下出怪。
  function simpleLoco(A, P) {
    const state = A._lastBase, ph = A._gaitPhase, amp = A._gaitAmp;
    if (state === 'walk' || state === 'run') {
      const run = state === 'run';
      const s = Math.sin(ph), cc = Math.cos(ph);
      const hipA = run ? 0.72 : 0.48, kneeA = run ? 0.95 : 0.6, armA = run ? 0.7 : 0.5;
      P.legL.x += s * hipA * amp; P.legR.x += -s * hipA * amp;               // 髖前後擺
      P.kneeL.x += (Math.max(0, -s) * kneeA + (run ? 0.18 : 0.1)) * amp;     // 後擺/抬腿時彎膝 + 微常態屈膝
      P.kneeR.x += (Math.max(0, s) * kneeA + (run ? 0.18 : 0.1)) * amp;
      P.ankleL.x += -s * 0.22 * amp; P.ankleR.x += s * 0.22 * amp;           // 腳踝順勢
      P.armL.x += -s * armA * amp; P.armR.x += s * armA * amp;               // 手臂反相擺
      P.elbowL.x += -(0.3 + (run ? 0.4 : 0.12)) * amp; P.elbowR.x += -(0.3 + (run ? 0.4 : 0.12)) * amp;  // 微彎肘
      P.bob += Math.abs(cc) * (run ? 0.05 : 0.035) * amp;                    // 上下起伏
      P.lean += (run ? 0.1 : 0.05) * amp;                                    // 前傾
      P.spine.x += (run ? 0.05 : 0.03) * amp; P.chest.x += (run ? 0.05 : 0.03) * amp;
    } else if (state === 'jump') {
      P.legL.x += -0.5; P.legR.x += 0.28; P.kneeL.x += 0.7; P.kneeR.x += 0.5;   // 屈膝抬腿(不依賴 vv/air)
      P.armL.z += -0.5; P.armR.z += 0.5; P.lean += 0.05;
    } else {   // idle:輕呼吸 + 手臂自然垂放微彎
      P.bob += Math.sin(A.baseT * 2) * 0.01;
      P.elbowL.x += -0.15; P.elbowR.x += -0.15;
    }
  }

  function createAnimator(char, opts) {
    opts = opts || {};
    const parts = {};
    const base = {};
    const src = opts.parts || char;
    for (const n of ['torso', 'head', 'armL', 'armR', 'legL', 'legR', 'wingL', 'wingR', 'cape']) {
      const p = (src.getObjectByName ? src.getObjectByName(n) : null) || null;
      parts[n] = p;
      if (p) base[n] = { pos: p.position.clone(), rot: p.rotation.clone() };
    }
    // ── rig v2 偵測:有 userData.rig → 骨骼驅動寫入;無 → v1 部件直寫(原路徑)──
    const rig = (char.userData && char.userData.rig) || null;
    const joints = {}, jrest = {};
    if (rig) {
      for (const n of Object.keys(rig.joints)) {
        const j = char.getObjectByName ? char.getObjectByName(n) : null;
        if (j) { joints[n] = j; jrest[n] = { pos: j.position.clone(), rot: j.rotation.clone() }; }
      }
    }
    // 軀幹彈性膠囊蒙皮:整塊 torso 掛 spine,skinTorso() 每幀把上半頂點朝 chest 關節姿態彎折。
    // 逐頂點權重 w(下 0→肩高 1)由 rig.torsoSkin 斜坡定;base = 靜止頂點快照(每幀從 base 重算不累積)。
    let torsoSkin = null;
    if (rig && rig.torsoSkin && parts.torso && parts.torso.geometry) {
      const ts = rig.torsoSkin, attr = parts.torso.geometry.attributes.position;
      const baseP = Float32Array.from(attr.array), nV = attr.count, w = new Float32Array(nV);
      for (let i = 0; i < nV; i++) {
        const ySpine = baseP[i * 3 + 1] + ts.torsoY;                 // 頂點在 spine-local 的 y
        w[i] = Math.max(0, Math.min(1, (ySpine - ts.w0) / (ts.w1 - ts.w0)));
      }
      torsoSkin = { mesh: parts.torso, attr, base: baseP, w, nV, pivotML: ts.pivotY - ts.torsoY };
    }
    const body = opts.body || char;

    const A = {
      parts, base, body,
      root: opts.root || char,
      rig, joints, jrest,   // rig=null → v1 路徑;rig 存在 → v2 骨骼驅動
      _torsoSkin: torsoSkin,   // 軀幹彈性膠囊蒙皮(null=舊角色);skinTorso() 每幀用
      // body base 全量快照：_write 用「合成」寫回（base+delta、base×pose scale），
      // 遊戲預設在 body 上的傾斜/縮放（如身高正規化）不會被每幀蓋掉。
      bodyBase: { y: body.position.y, rx: body.rotation.x, rz: body.rotation.z,
                  sx: body.scale.x, sy: body.scale.y, sz: body.scale.z },
      clips: Object.assign({}, BUILTIN),
      pose: newPose(),
      current: 'idle', curT: 0, _lastBase: 'idle',
      t: 0, baseT: 0,
      vv: 0, spd: 0, _lastX: null, _lastY: null, _lastZ: null, _groundT: 9, _gaitPhase: 0, _gaitAmp: 0,
      _flutter: [],   // 飄動目標清單:每項 {kind:'mesh'|'group', K, theta, v, ...} 由 update/_write 驅動
      _side: { punch: 1, kick: 1 },
      combos: { punch: null, kick: null }, _cIdx: { punch: 0, kick: 0 }, _cLeft: { punch: 0, kick: 0 },
      _ctx: { t: 0, bt: 0, vv: 0, air: 0, spd: 0, phase: 0, gaitAmp: 0 },
      _velVec: [0, 0], _yawRate: 0, _yaw: 0, _lastYaw: null,
      _charScale: 1, _groundY: 0, _frame: null,
      _gait: null,   // rig 存在時於下方建立
      _prevLoop: null, _prevW: 0, _prevFade: 0.15, _pose2: null, _pose3: null,   // v2 混合器
      simple: !!opts.simple, _extSpeed: 0,   // 簡單模式:網路角色用罐頭循環,相位靠外部速度推(setSpeed),不從位置反推、不貼地
    };
    A.setSpeed = function (s) { this._extSpeed = Math.max(0, +s || 0); };
    if (rig) {
      A._gait = createGaitState();
      A._gait.pelvis[1] = rig.seg.standH;
      A._gait.out.py = rig.seg.standH;
    }

    // 飄動目標註冊:mesh 類(披風/背髮簾)走 deformMesh 頂點變形;group 類(辮子)走剛體擺盪。
    // topY/botY 從各 mesh bbox 算(領口釘死/下擺全開),換造型自適應。
    // 擴包围球 +0.35:變形會超出原範圍,不擴會被 frustum culling 誤剔除(飄出螢幕邊緣消失)
    function regMesh(mesh, K, name, pinY) {
      if (!mesh || !mesh.geometry || !mesh.geometry.attributes) return;
      const geo = mesh.geometry, attr = geo.attributes.position, arr = attr.array;
      // topY/botY(領口釘死/下擺全開)直接從頂點 array 掃 → 不依賴 computeBoundingBox,真假 mesh 都穩
      let topY = -Infinity, botY = Infinity;
      for (let i = 1; i < arr.length; i += 3) { if (arr[i] > topY) topY = arr[i]; if (arr[i] < botY) botY = arr[i]; }
      // pinY 覆蓋(模組化髮殼:垂片錨環以上是貼頭剛性區,鉸點在錨環而非 mesh 頂):
      // deform 權重 clamp(topY-y) → 高於 pinY 的頂點 w=0 全剛性,deform 碼零改動。
      if (pinY != null) topY = pinY;
      A._flutter.push({ kind: 'mesh', name, attr, base: Float32Array.from(arr),
        K: Object.assign({}, K, { topY: topY, botY: botY }),
        theta: 0, v: 0, wave: 0, s: { theta: 0, wavePhase: 0, waveAmp: 0, sway: 0 } });
      if (typeof geo.computeBoundingSphere === 'function') geo.computeBoundingSphere();
      if (geo.boundingSphere) geo.boundingSphere.radius += 0.35;
    }
    function regBraid(grp, side, name) {
      if (!grp) return;
      const segs = [];                       // segs[0]=pivot(根); segs[1..N]=巢狀關節段
      for (let n = grp, i = 0; n && n.type === 'Group' && i < 64; i++) {
        segs.push(n);
        n = n.children.find(c => c.type === 'Group');
      }
      const NJ = Math.max(0, Math.min((BRAID.joints | 0) || 0, segs.length - 1));  // clamp 到實際段數;0=純剛體
      A._flutter.push({ kind: 'group', name, group: grp, side, segs, NJ, K: BRAID,
        th: new Array(NJ + 1).fill(0), vv: new Array(NJ + 1).fill(0),   // th[0]=根; th[1..NJ]=串聯 lag(絕對角)
        baseRot: segs.map(n => ({ x: n.rotation.x, y: n.rotation.y, z: n.rotation.z })),
        theta: 0, v: 0 });                  // 既有欄位:每幀同步 = th[0]/vv[0](測試/外掛相容)
    }
    // 扁平 puff 串(模組化辮子:一群獨立小球)→ 重掛成巢狀關節鏈,之後與舊辮子同一套 braidStep 積分。
    // side=null(hairTwin)→ 依 x 正負拆成左右兩條。重掛只做一次(標 _flutterized 防重複)。
    function regPuffChain(grp, side, name) {
      if (!grp || !grp.children || grp.userData._flutterized) return;
      grp.userData._flutterized = true;
      const puffs = grp.children.filter(c => c.isMesh).slice();
      if (puffs.length < 2) return;
      const chains = side == null
        ? [[puffs.filter(p => p.position.x < 0), -1, name + 'L'], [puffs.filter(p => p.position.x >= 0), 1, name + 'R']]
        : [[puffs, side, name]];
      for (const [list, sd, nm] of chains) {
        if (list.length < 2) continue;
        list.sort((a, b) => b.position.y - a.position.y);   // 由上(根)到下(尾)
        const segs = [];
        let parent = grp, prev = null;
        for (const p of list) {
          const g = new THREE.Group();
          const wp = p.position.clone();
          g.position.copy(prev ? wp.clone().sub(prev) : wp);
          prev = wp;
          parent.add(g);
          p.position.set(0, 0, 0); g.add(p);   // add() 自動從原 parent 移出
          parent = g; segs.push(g);
        }
        const NJ = Math.max(0, Math.min((BRAID.joints | 0) || 0, segs.length - 1));
        A._flutter.push({ kind: 'group', name: nm, group: segs[0], side: sd, segs, NJ, K: BRAID,
          th: new Array(NJ + 1).fill(0), vv: new Array(NJ + 1).fill(0),
          baseRot: segs.map(n => ({ x: n.rotation.x, y: n.rotation.y, z: n.rotation.z })),
          theta: 0, v: 0 });
      }
    }
    regMesh(parts.cape, CAPE, 'cape');
    regMesh(src.getObjectByName ? src.getObjectByName('hairBack') : null, HAIR, 'hairBack');
    regBraid(src.getObjectByName ? src.getObjectByName('hairBraidL') : null, -1, 'hairBraidL');
    regBraid(src.getObjectByName ? src.getObjectByName('hairBraidR') : null, 1, 'hairBraidR');
    // 模組化髮型:長髮垂片(hairShell 的 userData.hairFall 鉸點)+ 兜帽垂布 + 辮子 puff 串
    const _shell = src.getObjectByName ? src.getObjectByName('hairShell') : null;
    if (_shell && _shell.userData && _shell.userData.hairFall) regMesh(_shell, HAIR, 'hairShell', _shell.userData.hairFall.pinY);
    const _hood = src.getObjectByName ? src.getObjectByName('hood') : null;
    if (_hood && _hood.userData && _hood.userData.hairFall) regMesh(_hood, HAIR, 'hood', _hood.userData.hairFall.pinY);
    regPuffChain(src.getObjectByName ? src.getObjectByName('hairBraid') : null, 0, 'hairBraid');
    regPuffChain(src.getObjectByName ? src.getObjectByName('hairTwin') : null, null, 'hairTwin');

    A.register = function (name, clip) { this.clips[name] = clip; return this; };
    A.setCombo = function (family, chain) { this.combos[family] = chain; this._cIdx[family] = 0; return this; };

    A._resolve = function (name) {
      switch (name) {
        case 'attack': case 'punch': return this._chain('punch');
        case 'kick':                 return this._chain('kick');
        case 'hit':                  return 'hurt';
        case 'attackR': this._side.punch = -1; return 'attackR';
        case 'attackL': this._side.punch = 1;  return 'attackL';
        case 'kickR':   this._side.kick = -1;  return 'kickR';
        case 'kickL':   this._side.kick = 1;   return 'kickL';
        default: return name;
      }
    };
    A._chain = function (family) {
      const chain = this.combos[family];
      if (chain && chain.length) {
        if (this._cLeft[family] > 0) this._cIdx[family] = (this._cIdx[family] + 1) % chain.length;
        else this._cIdx[family] = 0;
        const clip = this.clips[chain[this._cIdx[family]]] || this.clips.attackR;
        this._cLeft[family] = (clip.dur || 0.3) + 0.35;
        return chain[this._cIdx[family]];
      }
      const s = this._side[family]; this._side[family] = -s;
      return family === 'punch' ? (s > 0 ? 'attackR' : 'attackL') : (s > 0 ? 'kickR' : 'kickL');
    };

    // 兩種語義，看名字有沒有被 _resolve 轉換：
    //   觸發（'attack'/'punch'/'kick'/'hit' 等會轉換的名字）→ 同名也重播
    //     （連段鏈回傳同一 clip、連續受擊，都不會被「同名不重播」吞掉）；
    //   鏡像（'attackR'/'hurt'/'run' 等已解析名字，＝網路 sendState 送來的）→ 同名不重播
    //     （原 setAnim 語義：遠端每包重送同字串不該重啟動作）。
    A.play = function (name, o) {
      const resolved = this._resolve(name);
      const triggered = (resolved !== name);
      if (resolved === this.current && !triggered && !(o && o.restart)) return resolved;
      const prevLoop = this._lastBase;
      // 自訂 loop clip(如 GestureKit 註冊的循環手勢)同樣是 base:v2 混合器底層採樣 _lastBase,
      // 不更新的話 current 換了但畫面仍播舊 base → 循環手勢完全不動。內建非 oneShot 全在 BASE_NAMES,行為不變。
      const isCustomLoop = this.clips[resolved] && !this.clips[resolved].oneShot;
      if (BASE_NAMES[resolved] || isCustomLoop) {
        // rig v2:loop 切換啟動 cross-fade(回同一 loop 或 one-shot 結束回落不觸發)
        if (this.rig && resolved !== prevLoop) {
          this._prevLoop = prevLoop; this._prevW = 1;
          this._prevFade = FADES[prevLoop + '|' + resolved] || FADES.default;
        }
        this._lastBase = resolved;
        if (resolved !== this.current || (o && o.restart)) this.baseT = 0;
      }
      this.current = resolved; this.curT = 0;
      return resolved;
    };

    // 步態頻率 ∝ 水平速度（表已上移至模組層 GAIT,與 gaitStep 共用）:spd=ref 時維持
    // 原本寫死的手感（walk 8rad/s@4u/s、run 13rad/s@8u/s）,上限 2 倍避免高速遊戲腿部殘影。
    // spd=0 時相位凍結＝站定（播 walk/run 還是 idle 仍是遊戲的決定）。

    // 每幀更新（在遊戲設好 root.position 與 body.rotation.y 之後呼叫）
    A.update = function (dt) {
      this.t += dt; this.baseT += dt; this.curT += dt;
      if (this._cLeft.punch > 0) this._cLeft.punch -= dt;
      if (this._cLeft.kick > 0) this._cLeft.kick -= dt;
      if (this._prevW > 0) this._prevW = Math.max(0, this._prevW - dt / (this._prevFade || 0.15));   // cross-fade 衰減

      // vv（垂直速度）與 spd（水平速度）都由 root 幀差推導 —— 本端物理、遠端插值、
      // display 直設都餵同樣的 root，三端同一份碼。漏鬥平滑 k=0.5：平滑輸入只 lag
      // 約一幀，10Hz 階梯輸入（display 直設快照）被攤平、跳姿不頻閃。
      // 單幀位移 > 2.5（≈150 u/s，遠超跳躍 14 u/s）視為傳送/重生，不餵給微分器。
      const rp = this.root.position;
      const hadPrev = this._lastY != null && dt > 0;
      const dy = hadPrev ? rp.y - this._lastY : 0;
      const dx = hadPrev ? rp.x - this._lastX : 0;
      const dz = hadPrev ? rp.z - this._lastZ : 0;
      if (!hadPrev) { this.vv = 0; this.spd = 0; }
      else {
        const instV = Math.abs(dy) > 2.5 ? 0 : clamp(dy / dt, -30, 30);
        const dh = Math.sqrt(dx * dx + dz * dz);
        const instS = dh > 2.5 ? 0 : clamp(dh / dt, 0, 60);
        this.vv += (instV - this.vv) * 0.5;
        this.spd += (instS - this.spd) * 0.5;
      }
      this._lastX = rp.x; this._lastY = rp.y; this._lastZ = rp.z;

      // 速度向量與轉向速率(步態規劃用;與 spd 同套漏斗平滑與傳送保護)
      if (!hadPrev) { this._velVec[0] = 0; this._velVec[1] = 0; }
      else {
        const dh2 = Math.sqrt(dx * dx + dz * dz);
        const ivx = dh2 > 2.5 ? 0 : clamp(dx / dt, -60, 60);
        const ivz = dh2 > 2.5 ? 0 : clamp(dz / dt, -60, 60);
        this._velVec[0] += (ivx - this._velVec[0]) * 0.5;
        this._velVec[1] += (ivz - this._velVec[1]) * 0.5;
      }
      const yawNow = this.body.rotation.y;
      if (this._lastYaw == null) this._lastYaw = yawNow;
      const dyaw = Math.atan2(Math.sin(yawNow - this._lastYaw), Math.cos(yawNow - this._lastYaw));
      const instYR = dt > 0 ? clamp(dyaw / dt, -12, 12) : 0;
      this._yawRate += (instYR - this._yawRate) * 0.5;
      this._lastYaw = yawNow;
      this._yaw = yawNow;

      // 騰空判定：|vv| 明顯 → 在空中；歸零一小段時間（含頂點的短暫低速）後 → 判定落地。
      // air 0..1 平滑過渡 → 落地後跳姿「自然」滑回站姿（不加額外的壓縮彈跳）。
      if (Math.abs(this.vv) > 2.2) this._groundT = 0; else this._groundT += dt;
      const air = clamp(1 - (this._groundT - 0.05) / 0.14, 0, 1);

      // 步態相位累加（walk/run 專用）：頻率跟速度走 → 腳尖貼地不滑步；
      // 相位是累加器而非絕對時鐘 → 速度變化時腿部動作連續不跳。
      // _gaitAmp 站定包絡：速度歸零時步態淡出到中立站姿（不凍結半跨步雕像），
      // 起步/煞車的擺臂幅度也自然淡入淡出（≈0.3s 時間常數）。
      // solver 啟動時(rig walk/run)相位改由 gaitStep 以「步長夾限後」的頻率推進。
      // 簡單模式:用外部餵入的速度推相位(不從 root 反推),solver 一律關掉 → 罐頭循環、不貼地。
      if (this.simple) this.spd = this._extSpeed;
      const solverWanted = !this.simple && !!(this.rig && this._gait && (this.current === 'walk' || this.current === 'run'));
      const g = GAIT[this.current];
      if (g && !solverWanted) {
        this._gaitPhase += dt * g.f * clamp(this.spd / g.ref, 0, 2);
        this._gaitAmp += (clamp(this.spd / (g.ref * 0.35), 0, 1) - this._gaitAmp) * Math.min(1, dt * 10);
      } else if (g) {
        this._gaitAmp += (clamp(this.spd / (g.ref * 0.35), 0, 1) - this._gaitAmp) * Math.min(1, dt * 10);
      }

      // 飄動目標(披風/背髮簾/辮子):主擺彈簧積分 + mesh 類的行進波相位。
      // 目標角 = 風阻後擺(spd) + 下落上掀/上升微提(vv·air);落地時目標塌掉,
      // 欠阻尼過衝 → 落地回拍「湧現」,免落地事件。dt clamp 1/30 防卡幀爆炸。
      const spd01 = clamp(this.spd / 8, 0, 1);
      const dtC = Math.min(dt, 1 / 30);
      const vvAbs01 = clamp(Math.abs(this.vv) / 12, 0, 1);
      for (let fi = 0; fi < this._flutter.length; fi++) {
        const ft = this._flutter[fi], K = ft.K;
        if (ft.kind === 'mesh') {
          const target = clamp(this.spd * K.spdSwing, 0, K.maxSwing)
            + air * clamp(-this.vv / 12, 0, 1) * K.fallLift
            + air * clamp(this.vv / 14, 0, 1) * K.riseLift;
          const acc = K.springW * K.springW * (target - ft.theta) - 2 * K.springZ * K.springW * ft.v;
          ft.v += acc * dtC;
          ft.theta = clamp(ft.theta + ft.v * dtC, K.thetaMin, K.thetaMax);
          ft.wave += dtC * (K.waveFreq + K.waveFreqSpd * spd01);
          ft.s.theta = ft.theta; ft.s.wavePhase = ft.wave;
          ft.s.waveAmp = K.waveAmp + K.waveAmpSpd * spd01 + K.waveAmpAir * air * vvAbs01;
          ft.s.sway = K.gaitSway * Math.sin(this._gaitPhase) * this._gaitAmp * (1 - air);
        } else {   // 辮子:根部 θ[0] 剛體擺 + 串聯鏈 θ[1..NJ] lag(末端拖根部,柔性不像棍子)
          const target0 = clamp(this.spd * K.leanK, 0, K.maxLean) + air * clamp(-this.vv / 12, 0, 1) * K.fallLean;
          braidStep(ft.th, ft.vv, target0, K, dtC);
          ft.theta = ft.th[0]; ft.v = ft.vv[0];   // 同步既有欄位(測試/外掛讀 ft.theta)
        }
      }

      const c = this._ctx;
      c.bt = this.baseT; c.vv = this.vv; c.air = air; c.spd = this.spd; c.phase = this._gaitPhase; c.gaitAmp = this._gaitAmp;
      if (!this.clips[this.current]) this.current = 'idle';
      let clip = this.clips[this.current];
      // 一次性動作播完自動回落最近的迴圈狀態：遊戲忘記接手不再凍結死姿態
      // （遊戲仍可隨時 play() 覆寫，例如攻擊中接跑步；回落前 busy 語義不變）
      if (clip.oneShot && this.curT >= clip.dur) { this.play(this._lastBase); clip = this.clips[this.current]; }
      const P = this.pose; resetPose(P);
      if (this.rig) {
        // ── v2 混合器:base loop(solver 或 clip)→ prev loop 淡出 → one-shot 遮罩疊加 ──
        const solverActive = !this.simple && !!(this._gait && (this._lastBase === 'walk' || this._lastBase === 'run'));
        if (this.simple) {
          simpleLoco(this, P);   // 罐頭運動(含彎膝彎肘),base 由外部速度驅動
        } else if (solverActive) {
          this._charScale = this.body.scale.x || 1;
          this._groundY = this.root.position.y;
          this._frame = makeFrame([rp.x, rp.y, rp.z], yawNow, this._charScale);
          gaitStep(this, dtC);
        } else {
          const lc = this.clips[this._lastBase] || this.clips.idle;
          c.t = this._lastBase === 'ko' ? this.baseT : this.t;
          lc.sample(c, P);
        }
        // prev loop cross-fade(prev 用 clip 正弦淡出;步態規劃由新 base 接管;簡單模式狀態切換直接生效,不淡)
        if (!this.simple && this._prevW > 0 && this._prevLoop) {
          const P2 = this._pose2 || (this._pose2 = newPose());
          resetPose(P2);
          const pc = this.clips[this._prevLoop];
          if (pc) { c.t = this._prevLoop === 'ko' ? this.baseT : this.t; pc.sample(c, P2); }
          blendPose(P, P2, 1 - this._prevW, this._prevW);
        }
        // one-shot 以遮罩疊加在 base 之上(自己的通道主導,其餘讓 base 通過 → 邊走邊揮拳)
        if (clip.oneShot) {
          const P3 = this._pose3 || (this._pose3 = newPose());
          resetPose(P3);
          c.t = this.curT; clip.sample(c, P3);
          const w = clamp(this.curT / 0.03, 0, 1) * clamp((clip.dur - this.curT) / 0.10, 0, 1);
          for (const ch of clip.mask || []) lerpCh(P, ch, P3, w);
        }
      } else {
        // ── v1 原路徑(行為不變)──
        if (clip.oneShot) { c.t = this.curT; clip.sample(c, P); }
        else { c.t = this.current === 'ko' ? this.baseT : this.t; clip.sample(c, P); }
      }

      this._write();
      return this.current;
    };

    A._write = function () {
      const b = this.base, P = this.pose, parts = this.parts;
      if (this.rig) {
        // ── v2 骨骼驅動:關節 rest+delta;舊 clip 的 torso.* 由 chest 吸收(torsoLo 不轉,
        //    腰縫不開);bob 走骨盆(腳暫由 Phase 3 IK 定錨,目前幅度小、與 v1 視感一致)──
        const J = this.joints, JR = this.jrest;
        for (const n of ROT_PARTS_V2) {
          const j = J[n]; if (!j) continue;
          const r = JR[n], d = P[n];
          j.rotation.set(r.rot.x + d.x, r.rot.y + d.y, r.rot.z + d.z);
          j.position.copy(r.pos);
        }
        if (J.chest) {
          J.chest.rotation.x += P.torso.x; J.chest.rotation.y += P.torso.y; J.chest.rotation.z += P.torso.z;
        }
        if (J.pelvis) {
          // 步態求解中:骨盆 XZ/Y 由 solver 驅動(依 amp 與 rest+bob 混合,停頓平滑歸位)
          const sol = this._gait && (this._lastBase === 'walk' || this._lastBase === 'run');
          if (sol) {
            const g = this._ctx.gaitAmp, o = this._gait.out;
            J.pelvis.position.set(
              JR.pelvis.pos.x + (o.px - JR.pelvis.pos.x) * g,
              JR.pelvis.pos.y + P.bob * (1 - g) + (o.py - JR.pelvis.pos.y) * g,
              JR.pelvis.pos.z + (o.pz - JR.pelvis.pos.z) * g);
          } else {
            J.pelvis.position.y = JR.pelvis.pos.y + P.bob;
          }
        }
      } else {
        // ── v1 部件直寫(無 rig 的舊角色/自訂 rig;行為與舊版完全一致)──
        for (const n of ROT_PARTS) {
          const p = parts[n]; if (!p) continue; const bb = b[n];
          p.rotation.set(bb.rot.x + P[n].x, bb.rot.y + P[n].y, bb.rot.z + P[n].z);
          p.position.copy(bb.pos);
        }
        // 呼吸/跑步起伏只動 torso+head —— 腳踩死地面，不然整隻上下=漂浮
        // （不變式：腳是錨。整隻位移只允許刻意且短暫的破例：dropY 落地/歡呼、squash 縮放）
        if (parts.torso) parts.torso.position.y += P.bob;
        if (parts.head)  parts.head.position.y += P.bob;
      }
      const body = this.body, BB = this.bodyBase;
      body.rotation.x = BB.rx + P.lean;   // 只寫 x/z 且 base 相對 → 不動 rotation.y（面向由遊戲控制）
      body.rotation.z = BB.rz + P.tilt;
      body.scale.set(BB.sx * P.sx, BB.sy * P.sy, BB.sz * P.sz);   // 與 base 相乘：遊戲預設縮放（如身高正規化）不被蓋掉
      body.position.y = BB.y + P.dropY;   // dropY = 落地下沉 / 歡呼小彈跳（整隻位移是刻意的）
      if (parts.wingL) parts.wingL.rotation.z = b.wingL.rot.z + Math.sin(this.t * 8) * 0.4;
      if (parts.wingR) parts.wingR.rotation.z = b.wingR.rot.z - Math.sin(this.t * 8) * 0.4;
      // 飄動目標:mesh 類(披風/背髮簾)頂點變形 + needsUpdate;group 類(辮子)剛體擺盪。
      // 每幀從 base 重寫不累積;訊號已在 update 備好。
      for (let fi = 0; fi < this._flutter.length; fi++) {
        const ft = this._flutter[fi];
        if (ft.kind === 'mesh') { deformMesh(ft.base, ft.attr.array, ft.s, ft.K); ft.attr.needsUpdate = true; }
        else {   // 辮子:根 pivot 寫 θ[0];關節段寫增量 θ[j]−θ[j-1] → 末端世界角=θ[NJ] 滯後根部
          ft.segs[0].rotation.x = ft.baseRot[0].x + ft.th[0];
          for (let j = 1; j <= ft.NJ; j++) ft.segs[j].rotation.x = ft.baseRot[j].x + (ft.th[j] - ft.th[j - 1]);
        }
      }
      this.skinTorso();   // 軀幹彈性膠囊:上半頂點朝 chest 關節姿態彎(_write 末尾,關節已就位)
    };

    // 軀幹彈性蒙皮:讀 chest 關節的實際 local 旋轉(rest=identity),把整塊 torso 上半頂點彈性彎折。
    // 與 _write 分離成獨立方法 → 物理 dynamic 模式的 writeBackToVisual 設完 chest.quaternion 後也能直接呼叫。
    A.skinTorso = function () {
      const ts = this._torsoSkin, cj = this.joints && this.joints.chest;
      if (!ts || !cj) return;
      skinTorsoMesh(ts.base, ts.attr.array, ts.w, cj.quaternion, ts.pivotML, ts.nV);
      ts.attr.needsUpdate = true;
    };

    Object.defineProperty(A, 'busy', { get() { const c = this.clips[this.current]; return !!(c && c.oneShot && this.curT < c.dur); } });
    // 一次性動作的播放進度 0..1（命中幀/相位 polling 用，與 busy 同語義、不引事件；迴圈狀態恆 0）
    Object.defineProperty(A, 'progress', { get() { const c = this.clips[this.current]; return (c && c.oneShot && c.dur) ? clamp(this.curT / c.dur, 0, 1) : 0; } });

    return A;
  }

  const animApi = { createAnimator, easing: E, clips: BUILTIN, _kf: kf, _mirror: mirrorTracks, _deformMesh: deformMesh, _skinTorsoMesh: skinTorsoMesh, _braidStep: braidStep, _ikSolve: ikSolve, _fkLeg: fkLeg, _knobs: { cape: CAPE, hair: HAIR, braid: BRAID } };


  if (global.LowPoly) { global.LowPoly.animator = animApi; global.LowPoly.createAnimator = createAnimator; }
  else global.LowPoly = { animator: animApi, createAnimator };
  if (typeof module !== 'undefined' && module.exports) module.exports.animator = animApi;
})(typeof window !== 'undefined' ? window : globalThis);

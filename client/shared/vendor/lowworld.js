/* ============================================================================
 * LowWorld — 低多邊形「場景 / 物件」程序化產生庫（LowPoly 的姊妹庫）
 * 用法（three 遊戲，全域已自動附掛；沿用 LowPoly 的慣例）：
 *   LowPoly.addLights(scene);                       // 一樣用 Lambert 材質，需要燈光
 *   const house = LowWorld.house({ seed: 7 });      // → THREE.Group（底部在 y=0）
 *   const oak   = LowWorld.tree({ seed: 3, kind:'round' });
 *   scene.add(house); scene.add(oak);
 *   // 讓草木隨風擺動（可選，一行搞定）：每幀呼叫一次即可
 *   LowWorld.wind(scene, clock.getElapsedTime());
 *
 * 設計（刻意對齊 lowpoly.js，讓兩者無縫混用）：
 * - 每個產生器都吃 { seed, ... }，同 seed → 同物件；不給 seed 就隨機。
 * - 一律回傳 THREE.Group，**底部貼齊 y=0**（跟角色腳底 y=0 同一地平面，直接並排擺放）。
 * - 材質＝flat-shaded MeshLambertMaterial（跟角色一致，配 LowPoly.addLights 的暖光最好看）。
 * - 只用 three 內建幾何（Box/Cone/Cylinder/Sphere/Icosahedron/Dodecahedron/Torus/Circle），無外部貼圖。
 * - 風吹：產生器把會擺動的枝葉節點打上 userData.lwSway；LowWorld.wind(scene, t) 掃過整個
 *   場景套用（純三角函數擺動，無需逐物件登記；房子/石頭等硬物不受影響）。
 * 相依：全域 THREE（本檔一律在 three.min.js 之後載入）。若同頁有 LowPoly，addLights 直接沿用它。
 * ========================================================================== */
(function (global) {
  'use strict';

  // ---- 決定性亂數（與 lowpoly.js 同款 mulberry32）----
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function rr(rnd, a, b) { return a + rnd() * (b - a); }
  function seededRnd(seed) {
    const s = (seed == null) ? Math.floor(Math.random() * 1e9) : (seed | 0);
    return mulberry32((s * 2654435761) >>> 0);
  }

  // ---- 材質 / 部件（flat Lambert，需要燈光）----
  function mat(THREE, color, opt) {
    return new THREE.MeshLambertMaterial(Object.assign({ color: new THREE.Color(color), flatShading: true }, opt || {}));
  }
  function part(THREE, geo, color, name, o) {
    const m = new THREE.Mesh(geo, mat(THREE, color, o));
    if (name) m.name = name;
    return m;
  }

  // ---- 配色盤 ----
  const PAL = {
    trunk:   ['#8a5a34', '#7a4a2a', '#9a6b3f', '#6e4a2e'],
    leaf:    ['#5bbf5b', '#49a94a', '#6fd06a', '#3f9b52', '#7cc86b', '#57b36a'],
    leafDark:['#2f7d3f', '#357a45', '#2b6b3a'],
    blossom: ['#ff8fb3', '#ff5d7a', '#ffd24d', '#ff9a3d', '#c792ff', '#7fb8ff', '#ffffff', '#ff6f61'],
    core:    ['#ffe066', '#ffd24d', '#fff2b0'],
    wall:    ['#f4e2c4', '#efd6b0', '#e8c9a0', '#f0ded0', '#dfe6ef', '#f7ecd6'],
    timber:  ['#efdcbe', '#e7cfa6', '#dec69a', '#f2e6cf'],   // 茅草屋的暖色灰泥牆
    roof:    ['#c8503c', '#b5432f', '#5a86b8', '#4f9a6a', '#8a5bb0', '#c77f3a'],
    straw:   ['#d8b45b', '#cfa544', '#e0c46e', '#c99a3f', '#d9bb6a'],   // 茅草
    beam:    ['#7a5236', '#6b4526', '#83603a'],               // 木樑 / 屋脊
    door:    ['#7a4a2a', '#5a3a22', '#8a5a34'],
    windowC: ['#bfe6ff', '#dff2ff', '#ffe9a8'],
    rock:    ['#9a9aa2', '#8a8a92', '#adadb6', '#7f8a8f'],
    stone:   ['#b8b2a6', '#a7a196', '#c2bcae', '#9c968b'],   // 石屋牆
    slate:   ['#5b606a', '#666b74', '#4f545c', '#5e5a55'],   // 石屋板岩/木瓦頂
    berry:   ['#ff5d7a', '#ff3d5a', '#c792ff', '#7fb8ff'],
  };

  // ---- 落地：把整個 Group 上移，讓 bbox 底部剛好貼齊 y=0（保證所有物件同一地平面）----
  // 不規則/旋轉過的形狀（石頭）也能精準對齊；對 Box3 不可用的環境（如純 stub）安全略過。
  function ground(THREE, g) {
    if (!THREE.Box3 || !g) return g;
    const box = new THREE.Box3().setFromObject(g);
    if (isFinite(box.min.y) && Math.abs(box.min.y) > 1e-4) {
      for (const c of g.children) c.position.y -= box.min.y;
    }
    return g;
  }

  // ---- 風吹標記：把節點登記成「會擺動」，供 LowWorld.wind 掃描 ----
  function tagSway(node, rnd, amp, freq) {
    node.userData.lwSway = {
      amp: amp, freq: freq, phase: rnd() * Math.PI * 2,
      baseX: node.rotation.x, baseZ: node.rotation.z,
    };
  }

  // ============================================================
  // 樹：kind = 'round'（圓球冠）/ 'pine'（松/杉，疊錐）/ 'fruit'（結果實）
  // ============================================================
  function makeTree(THREE, o) {
    const rnd = seededRnd(o.seed);
    const kind = o.kind || pick(rnd, ['round', 'round', 'pine', 'fruit']);
    const g = new THREE.Group();
    const trunkCol = pick(rnd, PAL.trunk);
    const h = rr(rnd, 0.9, 1.5);                                  // 樹幹高
    const trunk = part(THREE, new THREE.CylinderGeometry(0.13, 0.19, h, 6), trunkCol, 'trunk');
    trunk.position.y = h / 2;
    g.add(trunk);

    const crown = new THREE.Group();                             // 樹冠（擺動的節點）
    crown.position.y = h;
    g.add(crown);

    if (kind === 'pine') {
      const col = pick(rnd, PAL.leafDark);
      const tiers = 3 + Math.floor(rnd() * 2);
      let r = rr(rnd, 0.7, 0.95), ch = rr(rnd, 0.7, 0.9), y = 0;
      for (let i = 0; i < tiers; i++) {
        const cone = part(THREE, new THREE.ConeGeometry(r, ch, 7), col);
        cone.position.y = y + ch / 2 - 0.1;
        crown.add(cone);
        y += ch * 0.62; r *= 0.72; ch *= 0.85;
      }
    } else {
      const col = pick(rnd, PAL.leaf);
      const blobs = 3 + Math.floor(rnd() * 3);
      const R = rr(rnd, 0.75, 1.05);
      for (let i = 0; i < blobs; i++) {
        const br = R * rr(rnd, 0.55, 0.85);
        const blob = part(THREE, new THREE.IcosahedronGeometry(br, 1), col);
        const a = rnd() * Math.PI * 2, rad = i === 0 ? 0 : rr(rnd, 0.2, 0.5);
        blob.position.set(Math.cos(a) * rad, rr(rnd, 0.2, 0.7), Math.sin(a) * rad);
        crown.add(blob);
      }
      if (kind === 'fruit') {                                    // 點綴果實
        const fc = pick(rnd, PAL.berry);
        const n = 4 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const fruit = part(THREE, new THREE.SphereGeometry(0.08, 6, 5), fc);
          const a = rnd() * Math.PI * 2;
          fruit.position.set(Math.cos(a) * R * 0.7, rr(rnd, 0.1, 0.7), Math.sin(a) * R * 0.7);
          crown.add(fruit);
        }
      }
    }
    tagSway(crown, rnd, 0.05, rr(rnd, 0.8, 1.3));                // 樹冠輕搖
    g.userData.lwKind = 'tree';
    return g;
  }

  // ============================================================
  // 草叢 / 灌木：一坨重疊的綠色球塊，貼地
  // ============================================================
  function makeBush(THREE, o) {
    const rnd = seededRnd(o.seed);
    const g = new THREE.Group();
    const foliage = new THREE.Group();
    g.add(foliage);
    const col = pick(rnd, PAL.leaf);
    const n = 3 + Math.floor(rnd() * 3);
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const r = rr(rnd, 0.28, 0.46);
      const blob = part(THREE, new THREE.IcosahedronGeometry(r, 1), col);
      const a = rnd() * Math.PI * 2, rad = i === 0 ? 0 : rr(rnd, 0.15, 0.4);
      blob.position.set(Math.cos(a) * rad, r * rr(rnd, 0.7, 1.0), Math.sin(a) * rad);
      foliage.add(blob);
      maxR = Math.max(maxR, rad + r);
    }
    if (rnd() < 0.5) {                                           // 偶爾綴幾朵小花
      const bc = pick(rnd, PAL.blossom);
      for (let i = 0; i < 3; i++) {
        const dot = part(THREE, new THREE.SphereGeometry(0.06, 6, 5), bc);
        const a = rnd() * Math.PI * 2;
        dot.position.set(Math.cos(a) * maxR * 0.7, rr(rnd, 0.35, 0.6), Math.sin(a) * maxR * 0.7);
        foliage.add(dot);
      }
    }
    tagSway(foliage, rnd, 0.04, rr(rnd, 1.2, 1.8));
    g.userData.lwKind = 'bush';
    return g;
  }

  // ============================================================
  // 花叢：一片細莖 + 花朵（花瓣環 + 花心），顏色隨機
  // ============================================================
  function makeFlowers(THREE, o) {
    const rnd = seededRnd(o.seed);
    const g = new THREE.Group();
    const count = o.count || (4 + Math.floor(rnd() * 4));
    const stemCol = pick(rnd, PAL.leafDark);
    for (let i = 0; i < count; i++) {
      const stalk = new THREE.Group();                          // 每朵一根莖（各自擺動）
      const hh = rr(rnd, 0.35, 0.6);
      const stem = part(THREE, new THREE.CylinderGeometry(0.02, 0.03, hh, 4), stemCol);
      stem.position.y = hh / 2;
      stalk.add(stem);
      const head = new THREE.Group();
      head.position.y = hh;
      const petalCol = pick(rnd, PAL.blossom);
      const petals = 5 + Math.floor(rnd() * 2);
      const pr = rr(rnd, 0.09, 0.14);
      for (let k = 0; k < petals; k++) {
        const petal = part(THREE, new THREE.SphereGeometry(pr * 0.55, 6, 5), petalCol, null, { side: THREE.DoubleSide });
        const a = (k / petals) * Math.PI * 2;
        petal.position.set(Math.cos(a) * pr, 0, Math.sin(a) * pr);
        petal.scale.set(1, 0.5, 1);
        head.add(petal);
      }
      head.add(part(THREE, new THREE.SphereGeometry(pr * 0.5, 6, 5), pick(rnd, PAL.core)));
      stalk.add(head);
      const a = rnd() * Math.PI * 2, rad = rr(rnd, 0, 0.4);
      stalk.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      stalk.rotation.z = rr(rnd, -0.12, 0.12);
      tagSway(stalk, rnd, 0.10, rr(rnd, 1.4, 2.2));             // 花莖搖曳幅度大一點
      g.add(stalk);
    }
    g.userData.lwKind = 'flowers';
    return g;
  }

  // ============================================================
  // 草：一撮細葉，扇形散開
  // ============================================================
  function makeGrass(THREE, o) {
    const rnd = seededRnd(o.seed);
    const g = new THREE.Group();
    const tuft = new THREE.Group();
    g.add(tuft);
    const col = pick(rnd, PAL.leaf);
    const n = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const hh = rr(rnd, 0.25, 0.5);
      const blade = part(THREE, new THREE.ConeGeometry(0.035, hh, 4), col);
      blade.position.y = hh / 2;
      const a = rnd() * Math.PI * 2, rad = rr(rnd, 0, 0.14);
      blade.position.x = Math.cos(a) * rad; blade.position.z = Math.sin(a) * rad;
      blade.rotation.z = rr(rnd, -0.35, 0.35);
      blade.rotation.x = rr(rnd, -0.25, 0.25);
      tuft.add(blade);
    }
    tagSway(tuft, rnd, 0.06, rr(rnd, 1.6, 2.4));
    g.userData.lwKind = 'grass';
    return g;
  }

  // ---- 凸屋頂：LatheGeometry + 凸曲線 profile（中段半徑 > 直線 → 鼓起），底部半徑放大做大出簷 ----
  // sides=4 → 方形四坡（轉 45° 對齊方屋）；sides=8 → 圓潤（茅草屋）。droop = 屋簷向下垂。
  function convexRoof(THREE, o) {
    const Re = o.eave, h = o.h, sides = o.sides || 4, droop = o.droop || 0;
    const prof = [
      [Re,        -droop],        // 屋簷最外緣（可向下垂）
      [Re,         h * 0.06],     // 一小段近乎垂直的簷口
      [Re * 0.90,  h * 0.34],     // ↓ 以下半徑都「高於直線內插」→ 凸起
      [Re * 0.64,  h * 0.62],
      [Re * 0.36,  h * 0.85],
      [0.02,       h],            // 屋脊尖端
    ].map(p => new THREE.Vector2(Math.max(0.001, p[0]), p[1]));
    return new THREE.Mesh(new THREE.LatheGeometry(prof, sides), mat(THREE, o.col, o.matOpt));
  }

  // ---- 斜牆量體：底寬頂窄的梯形盒（依高度把頂點往中心收，taper=頂部內縮比例）----
  // flat shading 由 shader 逐面算法線 → 移動頂點後不需重算法線。回傳的盒仍以原點為中心（同 BoxGeometry）。
  function taperedBox(THREE, W, H, D, taper, col, name) {
    const geo = new THREE.BoxGeometry(W, H, D);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + H / 2) / H;   // 0=底 → 1=頂
      const f = 1 - taper * t;
      pos.setX(i, pos.getX(i) * f);
      pos.setZ(i, pos.getZ(i) * f);
    }
    pos.needsUpdate = true;
    return part(THREE, geo, col, name);
  }

  // ============================================================
  // 房子：牆體 + 凸屋頂（大出簷）+ 門 + 窗 + 煙囪
  //   kind = 'cottage'（灰泥牆 + 瓦頂，方形四坡）/ 'thatch'（木樑暖牆 + 圓潤茅草頂）
  // ============================================================
  function makeHouse(THREE, o) {
    const rnd = seededRnd(o.seed);
    const kind = o.kind || pick(rnd, ['cottage', 'cottage', 'thatch', 'stone', 'mushroom', 'twostory']);
    const g = new THREE.Group();

    // ── 共用零件（門 / 窗 / 煙囪 / 凸屋頂）──
    const addDoor = function (x, z, col) {
      const door = part(THREE, new THREE.BoxGeometry(0.36, 0.62, 0.08), col || pick(rnd, PAL.door), 'door');
      door.position.set(x, 0.31, z + 0.001); g.add(door);
      const knob = part(THREE, new THREE.SphereGeometry(0.03, 6, 5), '#ffd24d');
      knob.position.set(x + 0.11, 0.34, z + 0.05); g.add(knob);
    };
    const addWindow = function (x, y, z, round, frameCol) {
      const winCol = pick(rnd, PAL.windowC);
      const glow = { emissive: new THREE.Color(winCol), emissiveIntensity: 0.35 };
      if (round) {
        const win = part(THREE, new THREE.CircleGeometry(0.16, 14), winCol, null, Object.assign({ side: THREE.DoubleSide }, glow));
        win.position.set(x, y, z + 0.02); g.add(win);
        const ring = part(THREE, new THREE.TorusGeometry(0.17, 0.03, 6, 16), frameCol || '#ffffff');
        ring.position.set(x, y, z + 0.01); g.add(ring);
      } else {
        const win = part(THREE, new THREE.BoxGeometry(0.3, 0.3, 0.06), winCol, null, glow);
        win.position.set(x, y, z + 0.001); g.add(win);
        const frame = part(THREE, new THREE.BoxGeometry(0.37, 0.37, 0.03), frameCol || '#ffffff');
        frame.position.set(x, y, z - 0.01); g.add(frame);
      }
    };
    const addRoof = function (wallTop, footHalf, sides, ov, droop, col) {
      const eave = (footHalf + ov) / Math.cos(Math.PI / sides);
      const roofH = rr(rnd, 0.88, 1.12);
      const roof = convexRoof(THREE, { eave: eave, h: roofH, sides: sides, col: col, droop: droop });
      roof.name = 'roof';
      roof.position.y = wallTop - 0.05;                    // 簷口壓在牆頂
      if (sides === 4) roof.rotation.y = Math.PI / 4;      // 四坡對齊方牆
      g.add(roof);
      return { top: wallTop + roofH, h: roofH };
    };

    // ── 蘑菇屋：胖莖 + 紅傘蓋（白點）+ 圓窗（無煙囪）──
    if (kind === 'mushroom') {
      const stemH = rr(rnd, 1.0, 1.3), stemR = rr(rnd, 0.62, 0.78);
      const stem = part(THREE, new THREE.CylinderGeometry(stemR * 0.94, stemR, stemH, 12), '#f3ead4', 'body');
      stem.position.y = stemH / 2; g.add(stem);
      const capR = stemR + rr(rnd, 0.5, 0.7), capH = rr(rnd, 0.9, 1.15);
      const capCol = o.roof || pick(rnd, ['#d94f4f', '#e0663a', '#c74fb0', '#e0b23a', '#8a5bb0']);
      const cap = part(THREE, new THREE.SphereGeometry(capR, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.52), capCol, 'roof');
      cap.scale.y = capH / capR; cap.position.y = stemH - 0.05; g.add(cap);           // 半球壓扁 → 凸且大出簷
      const dots = 5 + Math.floor(rnd() * 4);                                          // 白點
      for (let i = 0; i < dots; i++) {
        const dot = part(THREE, new THREE.CircleGeometry(capR * rr(rnd, 0.13, 0.2), 8), '#fff6ea', null, { side: THREE.DoubleSide });
        const a = rnd() * Math.PI * 2, pol = rr(rnd, 0.2, 1.0), rad = Math.sin(pol) * capR * 0.98;
        dot.position.set(Math.cos(a) * rad, stemH - 0.05 + Math.cos(pol) * capH * 0.96, Math.sin(a) * rad);
        dot.lookAt(dot.position.x * 3, dot.position.y + 1.5, dot.position.z * 3);
        g.add(dot);
      }
      addDoor(0, stemR * 0.99);
      addWindow(-stemR * 0.58, stemH * 0.62, stemR * 0.82, true);
      addWindow(stemR * 0.58, stemH * 0.62, stemR * 0.82, true);
      g.userData.lwKind = 'house';
      return g;
    }

    // ── 方形量體：cottage / thatch / stone / twostory ──
    const thatch = kind === 'thatch', stone = kind === 'stone', two = kind === 'twostory';
    const W = rr(rnd, 1.4, 1.9), D = rr(rnd, 1.3, 1.7);
    const wallCol = o.wall || pick(rnd, thatch ? PAL.timber : stone ? PAL.stone : PAL.wall);
    const H1 = two ? rr(rnd, 1.0, 1.2) : rr(rnd, 1.0, 1.35);
    // 童話牆身斜度：底寬頂窄（依 seed 隨機；o.taper 可強制，0=直牆）。頂寬 = 底寬 ×(1−taper)
    const taper = o.taper != null ? o.taper : rr(rnd, 0.08, 0.24);
    const frontZ = function (y, Dd, Hh, y0) { return (Dd / 2) * (1 - taper * ((y - y0) / Hh)); }; // 該高度的前牆面 z（貼門窗用）

    const body = taperedBox(THREE, W, H1, D, taper, wallCol, 'body');
    body.position.y = H1 / 2; g.add(body);

    let wallTop = H1, roofHalf = Math.max(W, D) / 2;

    if (stone) {                                            // 石砌地基（略寬矮座）
      const foot = part(THREE, new THREE.BoxGeometry(W + 0.14, 0.22, D + 0.14), pick(rnd, ['#8f897d', '#847e72']));
      foot.position.y = 0.11; g.add(foot);
    }
    if (thatch) {                                           // 木柱（隨牆斜）+ 前橫樑
      const beamCol = pick(rnd, PAL.beam);
      const leanZ = Math.atan((W * taper) / (2 * H1)), leanX = Math.atan((D * taper) / (2 * H1));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const post = part(THREE, new THREE.BoxGeometry(0.1, H1 * 1.02, 0.1), beamCol);
        post.position.set(sx * (W / 2) * (1 - taper / 2), H1 / 2, sz * (D / 2) * (1 - taper / 2));
        post.rotation.z = -sx * leanZ; post.rotation.x = sz * leanX;      // 貼著斜牆傾斜
        g.add(post);
      }
      const fb = part(THREE, new THREE.BoxGeometry(W * (1 - taper * 0.52), 0.11, 0.03), beamCol);
      fb.position.set(0, H1 * 0.52, frontZ(H1 * 0.52, D, H1, 0) + 0.02); g.add(fb);
    }
    if (two) {                                              // 二樓：略寬懸挑上層 + 樓層分隔樑
      const H2 = rr(rnd, 0.85, 1.05), upW = W + 0.16, upD = D + 0.16;
      const beam = part(THREE, new THREE.BoxGeometry(W + 0.04, 0.12, D + 0.04), pick(rnd, PAL.beam));
      beam.position.y = H1 + 0.06; g.add(beam);
      const upper = taperedBox(THREE, upW, H2, upD, taper, o.wall2 || pick(rnd, PAL.wall), null);
      upper.position.y = H1 + 0.12 + H2 / 2; g.add(upper);
      const uy = H1 + 0.12 + H2 * 0.55, uz = frontZ(uy, upD, H2, H1 + 0.12);
      addWindow(-upW * 0.26, uy, uz, false);
      addWindow(upW * 0.26, uy, uz, false);
      wallTop = H1 + 0.12 + H2; roofHalf = Math.max(upW, upD) / 2;
    }

    // 凸屋頂 + 大出簷
    const roofCol = o.roof || (thatch ? pick(rnd, PAL.straw) : stone ? pick(rnd, PAL.slate) : pick(rnd, PAL.roof));
    const sides = thatch ? 8 : 4;
    const ov = thatch ? 0.52 : stone ? 0.34 : 0.4;
    const droop = thatch ? 0.2 : stone ? 0.05 : 0.07;
    const r = addRoof(wallTop, roofHalf, sides, ov, droop, roofCol);
    if (thatch) {                                           // 茅草脊蓋
      const ridge = part(THREE, new THREE.CylinderGeometry(0.11, 0.11, W * 0.55, 6), pick(rnd, PAL.beam));
      ridge.rotation.z = Math.PI / 2; ridge.position.y = r.top - 0.06; g.add(ridge);
    }

    // 門 + 一樓窗 + 煙囪
    const winFrame = stone ? '#9a948a' : '#ffffff';
    addDoor(rr(rnd, -0.15, 0.15), frontZ(0.31, D, H1, 0));
    const wy = H1 * 0.6, wz = frontZ(wy, D, H1, 0);
    addWindow(-W * 0.28, wy, wz, false, winFrame);
    if (rnd() < 0.88) addWindow(W * 0.28, wy, wz, false, winFrame);
    if (rnd() < 0.82) {
      const chY = wallTop + r.h * 0.4;
      const ch = part(THREE, new THREE.BoxGeometry(0.2, rr(rnd, 0.4, 0.6), 0.2),
        thatch ? pick(rnd, PAL.beam) : stone ? '#8f897d' : pick(rnd, PAL.roof));
      ch.position.set(W * 0.26, chY, -D * 0.18); g.add(ch);
    }
    g.userData.lwKind = 'house';
    return g;
  }

  // ============================================================
  // 石頭：1~3 顆矮胖多面體疊在一起
  // ============================================================
  function makeRock(THREE, o) {
    const rnd = seededRnd(o.seed);
    const g = new THREE.Group();
    const col = pick(rnd, PAL.rock);
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const r = rr(rnd, 0.22, 0.42);
      const rock = part(THREE, new THREE.DodecahedronGeometry(r, 0), col);
      const a = rnd() * Math.PI * 2, rad = i === 0 ? 0 : rr(rnd, 0.2, 0.4);
      rock.position.set(Math.cos(a) * rad, r * 0.55, Math.sin(a) * rad);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.scale.y = rr(rnd, 0.6, 0.85);
      g.add(rock);
    }
    g.userData.lwKind = 'rock';
    return g;
  }

  // ============================================================
  // 蘑菇：莖 + 圓帽（白點），童話感
  // ============================================================
  function makeMushroom(THREE, o) {
    const rnd = seededRnd(o.seed);
    const g = new THREE.Group();
    const hh = rr(rnd, 0.22, 0.4);
    const stem = part(THREE, new THREE.CylinderGeometry(0.07, 0.1, hh, 7), '#f5ecd6', 'stem');
    stem.position.y = hh / 2;
    g.add(stem);
    const capCol = pick(rnd, ['#d94f4f', '#e0663a', '#c74fb0', '#4f86c7', '#e0b23a']);
    const capR = rr(rnd, 0.18, 0.28);
    const cap = part(THREE, new THREE.SphereGeometry(capR, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), capCol, 'cap');
    cap.position.y = hh;
    cap.scale.y = rr(rnd, 0.7, 0.95);
    g.add(cap);
    const dots = 3 + Math.floor(rnd() * 4);                     // 白點
    for (let i = 0; i < dots; i++) {
      const dot = part(THREE, new THREE.CircleGeometry(capR * rr(rnd, 0.12, 0.2), 7), '#fff8f0', null, { side: THREE.DoubleSide });
      const a = rnd() * Math.PI * 2, pol = rr(rnd, 0.15, 0.9);
      const rr2 = Math.sin(pol) * capR * 0.98;
      dot.position.set(Math.cos(a) * rr2, hh + Math.cos(pol) * capR * 0.9 * cap.scale.y, Math.sin(a) * rr2);
      dot.lookAt(dot.position.x * 3, dot.position.y + 2, dot.position.z * 3);
      g.add(dot);
    }
    g.userData.lwKind = 'mushroom';
    return g;
  }

  // ============================================================
  // 圍籬：等距柱子 + 兩條橫桿，沿 x 排開；length = 幾格
  // ============================================================
  function makeFence(THREE, o) {
    const rnd = seededRnd(o.seed);
    const g = new THREE.Group();
    const col = pick(rnd, PAL.trunk);
    const span = o.length || (3 + Math.floor(rnd() * 3));
    const gap = 0.7;
    for (let i = 0; i <= span; i++) {
      const post = part(THREE, new THREE.BoxGeometry(0.1, 0.62, 0.1), col);
      post.position.set((i - span / 2) * gap, 0.31, 0);
      g.add(post);
    }
    for (const y of [0.24, 0.46]) {
      const rail = part(THREE, new THREE.BoxGeometry(span * gap + 0.1, 0.07, 0.06), col);
      rail.position.set(0, y, 0);
      g.add(rail);
    }
    g.userData.lwKind = 'fence';
    return g;
  }

  // ============================================================
  // 雲：一坨壓扁的白球（給天空用；底部一樣在 y=0，遊戲自行抬高擺放）
  // ============================================================
  function makeCloud(THREE, o) {
    const rnd = seededRnd(o.seed);
    const g = new THREE.Group();
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const r = rr(rnd, 0.35, 0.6);
      const puff = part(THREE, new THREE.IcosahedronGeometry(r, 1), '#ffffff', null,
        { transparent: true, opacity: 0.95 });
      puff.position.set((i - n / 2) * rr(rnd, 0.4, 0.6), r * 0.6 + rr(rnd, -0.05, 0.1), rr(rnd, -0.15, 0.15));
      puff.scale.y = 0.7;
      g.add(puff);
    }
    g.userData.lwKind = 'cloud';
    return g;
  }

  // ---- 燈光：沿用 LowPoly 的暖光；沒有 LowPoly 時自帶一份等價的 ----
  function addLights(THREE, scene) {
    if (global.LowPoly && global.LowPoly.addLights && global.LowPoly._lwOwnLights !== true) {
      return global.LowPoly.addLights(scene);
    }
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x9a8fb0, 0.9); scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff0d8, 0.68); key.position.set(3, 6, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xdce8ff, 0.30); fill.position.set(-2.5, 2, 4); scene.add(fill);
    return { hemi, key, fill };
  }

  const BUILDERS = {
    tree: makeTree, bush: makeBush, flowers: makeFlowers, grass: makeGrass,
    house: makeHouse, rock: makeRock, mushroom: makeMushroom, fence: makeFence, cloud: makeCloud,
  };

  // ---- 風吹：掃過場景，套用被 tagSway 標記的節點（每幀呼叫一次；t = 秒）----
  function wind(root, t, strength) {
    if (!root || !root.traverse) return;
    const k = strength == null ? 1 : strength;
    root.traverse(function (n) {
      const s = n.userData && n.userData.lwSway;
      if (!s) return;
      n.rotation.z = s.baseZ + Math.sin(t * s.freq + s.phase) * s.amp * k;
      n.rotation.x = s.baseX + Math.cos(t * s.freq * 0.8 + s.phase * 1.3) * s.amp * 0.6 * k;
    });
  }

  // 統一建造入口：產生 → 落地（bbox 底部貼 y=0）。所有對外方法都走這裡。
  function build(THREE, kind, o) {
    const b = BUILDERS[kind];
    if (!b) return null;
    return ground(THREE, b(THREE, o || {}));
  }

  const api = {
    // 各產生器：opts = { seed, ...kind 專屬 }，回傳 THREE.Group（底部 y=0）
    tree:     function (o) { return build(global.THREE, 'tree', o); },
    bush:     function (o) { return build(global.THREE, 'bush', o); },
    flowers:  function (o) { return build(global.THREE, 'flowers', o); },
    grass:    function (o) { return build(global.THREE, 'grass', o); },
    house:    function (o) { return build(global.THREE, 'house', o); },
    rock:     function (o) { return build(global.THREE, 'rock', o); },
    mushroom: function (o) { return build(global.THREE, 'mushroom', o); },
    fence:    function (o) { return build(global.THREE, 'fence', o); },
    cloud:    function (o) { return build(global.THREE, 'cloud', o); },
    // 通用分派：LowWorld.create('tree', { seed }) — 方便迴圈批量產生
    create:   function (kind, o) { return build(global.THREE, kind, o); },
    kinds:    Object.keys(BUILDERS),
    wind:     wind,
    addLights: function (scene) { return addLights(global.THREE, scene); },
    palettes: PAL,
    _build:   function (THREE, kind, o) { return build(THREE, kind, o); }, // 無頭素材產生器注入 THREE
  };
  global.LowWorld = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

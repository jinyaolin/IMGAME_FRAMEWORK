/* ============================================================
 * LowMonster — 宣告式怪物產生器(lowpoly 美術語言的怪物分支)
 *
 *   LowMonster.validate(spec)            → { ok, errors, warnings }
 *   LowMonster.build(spec, { seed })     → { root, char, animator, stats }
 *     root:THREE.Group(遊戲移動它;腳底/著地點在 y=0)
 *     char:具名部件 Group(torso/head/legL…,biped 對齊 lowpoly 命名)
 *     animator:{ play(name), current, busy, progress, setSpeed(v), update(dt),
 *                clips:{}, rig }
 *       clips = GestureKit clip 插槽(與 lowpoly animator 同介面):
 *         animator.clips[spec.name] = GestureKit.compile(spec).clip; animator.play(spec.name)
 *       手勢規格的 rig 需為 animator.rig('monster_'+骨架);oneshot 疊在 idle/walk 上播完自動退場,
 *       loop 持續疊加直到 play('idle'|'walk')。不存在的部件通道(如 head:"none")靜默忽略。
 *
 * 設計:「骨架模板決定動畫,JSON 參數決定外觀」。Kimi/設計者只寫純 JSON spec,
 * 同一 spec + 不同 seed = 同物種的個體變體(jitter 控制變異幅度)。
 * P1 骨架:biped(二足)/ quadruped(四足)/ blob(無腿彈跳)。
 * 依賴:全域 THREE(瀏覽器 <script> 或 node require 皆可)。不在自動載入鏈上,
 * 遊戲要用需自行載入(monster-lab / SCHEMA_DOC 會教)。
 * ============================================================ */
(function (global) {
  'use strict';

  // ── 種子隨機(與 lowpoly 同款 mulberry32)──────────────────
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SKELETONS = ['biped', 'quadruped', 'blob'];
  const BODY_SHAPES = ['ball', 'pear', 'egg', 'bean', 'slab'];
  const HEAD_SHAPES = ['ball', 'cone', 'cube', 'none'];
  const EYE_STYLES = ['dot', 'oval', 'glow'];
  const MOUTH_STYLES = ['none', 'flat', 'fangs', 'tusks', 'beak'];
  const EXTRA_TYPES = ['horn', 'spike', 'tail', 'fin', 'antenna', 'shell', 'wing', 'tentacle'];
  const EXTRA_POS = ['head', 'back', 'rear', 'side'];

  // ── 驗證(給 Kimi 的回饋迴路:錯在哪、合法值是什麼)─────────
  function inRange(v, a, b) { return typeof v === 'number' && isFinite(v) && v >= a && v <= b; }
  function isHex(s) { return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s); }

  function validate(spec) {
    const errors = [], warnings = [];
    const E = (m) => errors.push(m);
    if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec 必須是物件'], warnings };
    if (typeof spec.name !== 'string' || !/^[a-z0-9_\-]{1,40}$/.test(spec.name)) E('name 必填:小寫英數/底線/連字號(1-40 字)');
    // ── code 型(img2three):自由 procedural three.js builder,獨立驗證路徑 ──
    if (spec.type === 'code') {
      if (typeof spec.code !== 'string' || spec.code.length < 30) E('type:"code" 需要 code 字串(function body,參數 THREE, seed,必須 return THREE.Group)');
      else if (spec.code.length > 100000) E('code 過長(上限 100KB)');
      else { try { new Function('THREE', 'seed', spec.code); } catch (e) { E('code 語法錯誤:' + e.message); } }
      if (spec.skeleton != null && SKELETONS.indexOf(spec.skeleton) < 0) E('skeleton(code 型選填,決定動畫器)必須是 ' + SKELETONS.join('/'));
      if (spec.size != null && !inRange(spec.size, 0.3, 3)) E('size 範圍 0.3–3(整體縮放)');
      return { ok: errors.length === 0, errors, warnings };
    }
    if (SKELETONS.indexOf(spec.skeleton) < 0) E('skeleton 必須是 ' + SKELETONS.join('/'));
    if (spec.size != null && !inRange(spec.size, 0.3, 3)) E('size 範圍 0.3–3');
    const pal = spec.palette || {};
    for (const k of ['body', 'belly', 'accent', 'eye']) {
      if (pal[k] != null && !isHex(pal[k])) E('palette.' + k + ' 必須是 #rrggbb');
    }
    const b = spec.body || {};
    if (b.shape != null && BODY_SHAPES.indexOf(b.shape) < 0) E('body.shape 必須是 ' + BODY_SHAPES.join('/'));
    for (const k of ['w', 'h', 'd']) if (b[k] != null && !inRange(b[k], 0.4, 2.5)) E('body.' + k + ' 範圍 0.4–2.5');
    if (b.squash != null && !inRange(b.squash, 0, 0.6)) E('body.squash 範圍 0–0.6');
    const h = spec.head || {};
    if (h.shape != null && HEAD_SHAPES.indexOf(h.shape) < 0) E('head.shape 必須是 ' + HEAD_SHAPES.join('/'));
    if (h.size != null && !inRange(h.size, 0, 1.5)) E('head.size 範圍 0–1.5');
    const ey = spec.eyes || {};
    if (ey.count != null && !(Number.isInteger(ey.count) && ey.count >= 0 && ey.count <= 6)) E('eyes.count 整數 0–6');
    if (ey.size != null && !inRange(ey.size, 0.05, 0.5)) E('eyes.size 範圍 0.05–0.5');
    if (ey.spread != null && !inRange(ey.spread, 0, 1)) E('eyes.spread 範圍 0–1');
    if (ey.y != null && !inRange(ey.y, 0, 1)) E('eyes.y 範圍 0–1');
    if (ey.style != null && EYE_STYLES.indexOf(ey.style) < 0) E('eyes.style 必須是 ' + EYE_STYLES.join('/'));
    const mo = spec.mouth || {};
    if (mo.style != null && MOUTH_STYLES.indexOf(mo.style) < 0) E('mouth.style 必須是 ' + MOUTH_STYLES.join('/'));
    if (mo.size != null && !inRange(mo.size, 0.2, 1.2)) E('mouth.size 範圍 0.2–1.2');
    const li = spec.limbs || {};
    const legs = li.legs || {};
    if (legs.len != null && !inRange(legs.len, 0.15, 1.2)) E('limbs.legs.len 範圍 0.15–1.2');
    if (legs.thick != null && !inRange(legs.thick, 0.1, 0.6)) E('limbs.legs.thick 範圍 0.1–0.6');
    const arms = li.arms || {};
    if (arms.count != null && arms.count !== 0 && arms.count !== 2) E('limbs.arms.count 只能 0 或 2');
    if (arms.len != null && !inRange(arms.len, 0.15, 1.2)) E('limbs.arms.len 範圍 0.15–1.2');
    if (spec.skeleton === 'blob' && legs.count) warnings.push('blob 骨架沒有腿,limbs.legs 會被忽略');
    if (Array.isArray(spec.extras)) {
      if (spec.extras.length > 6) E('extras 最多 6 組');
      spec.extras.forEach((ex, i) => {
        if (!ex || EXTRA_TYPES.indexOf(ex.type) < 0) E('extras[' + i + '].type 必須是 ' + EXTRA_TYPES.join('/'));
        if (ex.count != null && !(Number.isInteger(ex.count) && ex.count >= 1 && ex.count <= 8)) E('extras[' + i + '].count 整數 1–8');
        if (ex.pos != null && EXTRA_POS.indexOf(ex.pos) < 0) E('extras[' + i + '].pos 必須是 ' + EXTRA_POS.join('/'));
        if (ex.size != null && !inRange(ex.size, 0.1, 1.5)) E('extras[' + i + '].size 範圍 0.1–1.5');
      });
    } else if (spec.extras != null) E('extras 必須是陣列');
    if (spec.jitter != null && !inRange(spec.jitter, 0, 0.5)) E('jitter 範圍 0–0.5');
    if (spec.noise != null && !inRange(spec.noise, 0, 0.4)) E('noise 範圍 0–0.4');
    return { ok: errors.length === 0, errors, warnings };
  }

  // ── 幾何工具 ────────────────────────────────────────────────
  function mat(THREE, hex) { return new THREE.MeshLambertMaterial({ color: hex, flatShading: true }); }

  // 身體輪廓:t∈[0,1](底→頂)回傳半徑係數(lathe 旋轉體;w/d 用 scale 拉出橢圓截面)
  const PROFILES = {
    ball: (t) => Math.sin(Math.PI * t),
    pear: (t) => Math.sin(Math.PI * t) * (1.25 - 0.5 * t),          // 下寬上窄
    egg:  (t) => Math.sin(Math.PI * t) * (0.78 + 0.48 * t * (1.6 - t)), // 中上最寬
    bean: (t) => Math.sin(Math.PI * t) * (1 - 0.18 * Math.sin(2 * Math.PI * t)), // 腰身內凹
  };

  function buildBody(THREE, shape, r, hh, matBody) {
    if (shape === 'slab') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(r * 2, hh * 2, r * 1.6), matBody);
      return m;
    }
    const prof = PROFILES[shape] || PROFILES.ball;
    const pts = [];
    const N = 9;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push(new THREE.Vector2(Math.max(0.001, prof(t) * r), (t - 0.5) * hh * 2));
    }
    return new THREE.Mesh(new THREE.LatheGeometry(pts, 9), matBody);
  }

  function coneMesh(THREE, m, r, len, seg) {
    const g = new THREE.ConeGeometry(r, len, seg || 5);
    g.translate(0, len / 2, 0);           // 原點在底(方便從表面長出去)
    return new THREE.Mesh(g, m);
  }
  function limbMesh(THREE, m, rTop, rBot, len) {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, 6);
    g.translate(0, -len / 2, 0);          // 原點在頂端 = 關節樞紐(rotation 從髖/肩擺動)
    return new THREE.Mesh(g, m);
  }

  // ── 主建構 ──────────────────────────────────────────────────
  function build(spec, opts) {
    const THREE = global.THREE;
    if (!THREE) throw new Error('[LowMonster] 需要全域 THREE');
    const v = validate(spec);
    if (!v.ok) { const e = new Error('[LowMonster] spec 無效: ' + v.errors.join('; ')); e.errors = v.errors; throw e; }
    opts = opts || {};
    if (spec.type === 'code') return buildCode(THREE, spec, (opts.seed == null ? 1 : opts.seed) >>> 0, v);
    const seed = (opts.seed == null ? 1 : opts.seed) >>> 0;
    const rnd = mulberry32(seed || 1);
    const jitter = spec.jitter == null ? 0.12 : spec.jitter;
    const J = (x) => x * (1 + (rnd() * 2 - 1) * jitter);    // 個體變異

    const pal = Object.assign({ body: '#8f9d5c', belly: '#d9e3b1', accent: '#5b4a68', eye: '#141414' }, spec.palette || {});
    const M = { body: mat(THREE, pal.body), belly: mat(THREE, pal.belly), accent: mat(THREE, pal.accent), eye: mat(THREE, pal.eye), white: mat(THREE, '#f3efe4') };

    const skel = spec.skeleton;
    const B = Object.assign({ shape: skel === 'blob' ? 'pear' : 'egg', w: 1, h: 1, d: 1, squash: skel === 'blob' ? 0.2 : 0 }, spec.body || {});
    const H = Object.assign({ shape: skel === 'blob' ? 'none' : 'ball', size: 0.8 }, spec.head || {});
    const EY = Object.assign({ count: 2, size: 0.16, spread: 0.5, y: 0.55, style: 'dot' }, spec.eyes || {});
    const MO = Object.assign({ style: skel === 'blob' ? 'flat' : 'fangs', size: 0.6 }, spec.mouth || {});
    const LI = spec.limbs || {};
    const LEG = Object.assign({ len: skel === 'quadruped' ? 0.42 : 0.5, thick: 0.26 }, LI.legs || {});
    const ARM = Object.assign({ count: skel === 'biped' ? 2 : 0, len: 0.55, thick: 0.2, claw: false }, LI.arms || {});

    const root = new THREE.Group(); root.name = 'monsterRoot';
    const char = new THREE.Group(); char.name = 'monster';
    root.add(char);

    // — 身體(quadruped 不旋轉 lathe,直接沿 z 拉長 → 軸向直觀、頭尾定位好算)—
    const bodyR = J(0.55 * B.w), bodyH = J(0.55 * B.h);
    const torso = buildBody(THREE, B.shape, bodyR, bodyH, M.body);
    torso.name = 'torso';
    const sq = B.squash * 0.7;
    const elong = skel === 'quadruped' ? J(1.7) : 1;                  // 四足:長軸沿 z、身幅收窄(膠囊感,不是飛盤)
    torso.scale.set((1 + sq * 0.5) * (skel === 'quadruped' ? 0.72 : 1), (1 - sq) * (skel === 'quadruped' ? 0.9 : 1), (B.d / B.w) * (1 + sq * 0.5) * elong);
    // 頂點位移(程序化變體):身體頂點依「位置雜湊」沿徑向位移 — 同位置同值,lathe 縫不裂;
    // 雜湊摻 seed → 每個個體的胖瘦凹凸都不同(比部件級 jitter 更有機)。flat shading 免重算法線。
    const noiseAmp = spec.noise == null ? 0 : spec.noise;
    if (noiseAmp > 0 && torso.geometry.attributes && torso.geometry.attributes.position) {
      const posA = torso.geometry.attributes.position;
      const soff = (seed % 9973) * 0.618;
      for (let i = 0; i < posA.count; i++) {
        const x = posA.getX(i), y = posA.getY(i), z = posA.getZ(i);
        const hsh = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + soff) * 43758.5453;
        const f = (hsh - Math.floor(hsh)) * 2 - 1;   // -1..1
        posA.setXYZ(i, x * (1 + f * noiseAmp * 0.35), y * (1 + f * noiseAmp * 0.15), z * (1 + f * noiseAmp * 0.35));
      }
      posA.needsUpdate = true;
    }

    const legLen = J(LEG.len);
    // 身體沉入係數:圓形輪廓下緣內收可與腿重疊(0.72);slab 是全寬方塊,得整個坐在腿上(0.98)
    const sink = B.shape === 'slab' ? 0.98 : 0.72;
    const torsoY = (skel === 'blob') ? bodyH * (1 - sq) : legLen + bodyH * torso.scale.y * (skel === 'quadruped' ? 0.55 : sink);
    torso.position.y = torsoY;
    char.add(torso);
    const bodyHalfZ = bodyR * torso.scale.z;                          // 身體前後半長(頭/尾/腿定位用)
    const bodyTopY = torsoY + bodyH * torso.scale.y * 0.95;           // 身體頂(extras 定位用)

    // 肚皮(前側淺色橢圓貼片,加可讀性;blob 身體即臉,不貼)
    if (skel === 'biped' && B.shape !== 'slab') {
      const belly = new THREE.Mesh(new THREE.SphereGeometry(bodyR * 0.72, 8, 6), M.belly);
      belly.name = 'belly';
      belly.scale.set(0.9, bodyH / bodyR * 0.75, 0.42);
      belly.position.set(0, torsoY - bodyH * 0.12, bodyR * 0.62);
      char.add(belly);
    }

    // — 頭(四足:球頭 + 前伸;cone 當吻部朝前 → 讀得出是「有鼻子的獸」)—
    let head = null;
    const headR = J(0.34 * H.size + 0.12);
    if (H.shape !== 'none') {
      let hg;
      const quadSnout = skel === 'quadruped' && H.shape === 'cone';    // 四足錐頭 → 球頭+錐吻部(獸臉)
      if (H.shape === 'cone' && !quadSnout) hg = new THREE.ConeGeometry(headR, headR * 2, 6);
      else if (H.shape === 'cube') hg = new THREE.BoxGeometry(headR * 1.7, headR * 1.6, headR * 1.7);
      else hg = new THREE.SphereGeometry(headR * (quadSnout ? 0.9 : 1), 8, 6);
      head = new THREE.Mesh(hg, M.body);
      head.name = 'head';
      if (skel === 'quadruped') {
        head.position.set(0, torsoY + bodyH * 0.8, bodyHalfZ * 0.85 + headR * 0.5);
        if (quadSnout) {
          const snout = new THREE.Mesh(new THREE.ConeGeometry(headR * 0.42, headR * 1.1, 5), M.body);
          snout.rotation.x = Math.PI / 2; snout.position.set(0, -headR * 0.18, headR * 0.85);
          snout.name = 'snout'; head.add(snout);
          const nose = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.14, 5, 4), M.accent);
          nose.position.set(0, -headR * 0.18, headR * 1.42); nose.name = 'nose'; head.add(nose);
        }
      } else {
        head.position.set(0, torsoY + bodyH * torso.scale.y * 0.88 + headR * 0.6, 0);
      }
      char.add(head);
    }
    // 五官掛載面(blob/none 直接長在身體前側;四足臉朝 +z 前方)
    const faceAnchor = new THREE.Group(); faceAnchor.name = 'face';
    // cube 頭是方盒(前面在 0.85R),錨點要貼到盒面外,不然五官埋在頭裡
    const faceZ = H.shape === 'cube' ? headR * 0.88 : headR * 0.62;
    if (head) { faceAnchor.position.set(0, headR * 0.05, faceZ); head.add(faceAnchor); }
    else { faceAnchor.position.set(0, torsoY + bodyH * torso.scale.y * (EY.y - 0.5) * 1.3, bodyR * torso.scale.x * 0.82); char.add(faceAnchor); }

    // — 眼睛(奇數置中、偶數對稱;橫向間距夾在載體輪廓內避免懸空)—
    const eyeHost = head ? headR : bodyR;
    const eyeR = J(EY.size) * eyeHost * 2.0;
    const halfSpan = Math.min(EY.spread * eyeHost * 0.8, eyeHost * 0.62);
    for (let i = 0; i < EY.count; i++) {
      const g = new THREE.SphereGeometry(eyeR * 0.5, 6, 5);
      const eye = new THREE.Mesh(g, M.eye);   // palette.eye = 虹膜色(dot 深色、glow 亮色都由調色盤決定)
      const k = EY.count === 1 ? 0 : (i / (EY.count - 1)) * 2 - 1;    // -1..1 均分
      eye.position.set(k * halfSpan, eyeHost * (EY.y - 0.45) * 0.7, eyeR * 0.15);
      if (EY.style === 'oval') eye.scale.set(0.75, 1.35, 0.6);
      if (EY.style === 'glow') {
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.24, 5, 4), mat(THREE, '#141414'));
        pupil.position.z = eyeR * 0.32; eye.add(pupil);
      }
      eye.name = 'eye' + i;
      faceAnchor.add(eye);
    }

    // — 嘴 —
    if (MO.style !== 'none') {
      const mw = J(MO.size) * (head ? headR : bodyR * 0.8);
      const mouthY = -(head ? headR : bodyH * 0.2) * 0.42;
      if (MO.style === 'flat') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(mw * 1.1, mw * 0.16, 0.02), M.eye);
        m.position.set(0, mouthY, 0.02); m.name = 'mouth'; faceAnchor.add(m);
      } else if (MO.style === 'beak') {
        const m = coneMesh(THREE, M.accent, mw * 0.42, mw * 1.1, 4);
        m.rotation.x = Math.PI / 2 - 0.25; m.position.set(0, mouthY, 0); m.name = 'mouth'; faceAnchor.add(m);
      } else { // fangs / tusks:上排 or 下排小白牙
        const n = MO.style === 'fangs' ? 2 : 2;
        for (let i = 0; i < n; i++) {
          const tooth = coneMesh(THREE, M.white, mw * 0.14, mw * (MO.style === 'tusks' ? 0.6 : 0.38), 4);
          tooth.rotation.x = MO.style === 'tusks' ? -Math.PI : Math.PI; // tusks 朝上、fangs 朝下
          tooth.position.set((i - 0.5) * mw * (MO.style === 'tusks' ? 0.9 : 0.55), mouthY + (MO.style === 'tusks' ? -mw * 0.15 : mw * 0.12), 0.02);
          tooth.name = 'tooth' + i; faceAnchor.add(tooth);
        }
      }
    }

    // — 腿 —
    const legT = J(LEG.thick);
    function addLeg(name, x, z) {
      const leg = limbMesh(THREE, M.body, legT * 0.32, legT * 0.42, legLen);
      leg.name = name;
      leg.position.set(x, legLen, z);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(legT * 0.5, 6, 4), M.accent);
      foot.scale.set(1.15, 0.55, 1.35); foot.position.set(0, -legLen, legT * 0.12);
      foot.name = name.replace('leg', 'foot'); leg.add(foot);
      char.add(leg); return leg;
    }
    if (skel === 'biped') {
      addLeg('legL', -bodyR * 0.45, 0); addLeg('legR', bodyR * 0.45, 0);
    } else if (skel === 'quadruped') {
      const zF = bodyR * torso.scale.z * 0.55, xW = bodyR * 0.5;
      addLeg('legFL', -xW, zF); addLeg('legFR', xW, zF);
      addLeg('legBL', -xW, -zF); addLeg('legBR', xW, -zF);
    }

    // — 手(biped 選配)—
    if (skel === 'biped' && ARM.count === 2) {
      const armLen = J(ARM.len), armT = J(ARM.thick);
      for (const s of [-1, 1]) {
        const arm = limbMesh(THREE, M.body, armT * 0.3, armT * 0.36, armLen);
        arm.name = s < 0 ? 'armL' : 'armR';
        arm.position.set(s * (bodyR * torso.scale.x * 0.95), torsoY + bodyH * 0.35, 0);
        arm.rotation.z = -s * 0.25;
        if (ARM.claw) for (let c = 0; c < 3; c++) {
          const claw = coneMesh(THREE, M.white, armT * 0.1, armT * 0.5, 4);
          claw.rotation.x = Math.PI; claw.position.set((c - 1) * armT * 0.22, -armLen, armT * 0.1);
          arm.add(claw);
        }
        char.add(arm);
      }
    }

    // — extras —
    const extras = Array.isArray(spec.extras) ? spec.extras : [];
    extras.forEach((ex, xi) => {
      const cnt = ex.count || 1, size = J(ex.size || 0.5);
      const host = (ex.pos === 'head' && head) ? head : char;
      const topY = head && ex.pos === 'head' ? headR * 0.8 : bodyTopY;
      for (let i = 0; i < cnt; i++) {
        const k = cnt === 1 ? 0 : i - (cnt - 1) / 2;
        let mesh = null;
        if (ex.type === 'horn') {
          mesh = coneMesh(THREE, M.white, size * 0.16, size * 0.7, 5);
          mesh.position.set(k * (head ? headR : bodyR) * 0.7, ex.pos === 'head' ? headR * 0.55 : topY, 0);
          mesh.rotation.z = -k * 0.45; mesh.rotation.x = -0.15;
        } else if (ex.type === 'antenna') {
          mesh = new THREE.Group();
          const stem = limbMesh(THREE, M.accent, size * 0.07, size * 0.09, size * 0.8); stem.rotation.x = Math.PI;
          const tip = new THREE.Mesh(new THREE.SphereGeometry(size * 0.18, 5, 4), M.accent); tip.position.y = size * 0.8;
          mesh.add(stem); mesh.add(tip);
          mesh.position.set(k * (head ? headR : bodyR) * 0.5, (head && ex.pos === 'head') ? headR * 0.7 : topY + size * 0.15, 0);
          mesh.rotation.z = -k * 0.3;
        } else if (ex.type === 'spike') {
          mesh = coneMesh(THREE, M.accent, size * 0.14, size * 0.5, 4);
          const zi = cnt === 1 ? 0 : (i / (cnt - 1) - 0.5);
          if (skel === 'quadruped') mesh.position.set(0, bodyTopY - bodyH * 0.05, zi * bodyHalfZ * 1.1);
          else { mesh.position.set(0, torsoY + bodyH * (0.9 - Math.abs(zi) * 0.5), -bodyR * 0.55 - zi * 0.1); mesh.rotation.x = -0.6; }
        } else if (ex.type === 'tail') {
          mesh = coneMesh(THREE, M.body, size * 0.2, size * 1.2, 5);
          mesh.position.set(0, torsoY + bodyH * 0.1, skel === 'quadruped' ? -bodyHalfZ * 0.9 : -bodyR * 0.8);
          mesh.rotation.x = 2.45;
        } else if (ex.type === 'fin') {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(size * 0.08, size * 0.7, size * 0.9), M.accent);
          mesh.position.set(0, torsoY + bodyH * 0.95, -bodyR * 0.15);
          mesh.rotation.x = -0.35;
        } else if (ex.type === 'shell') {
          mesh = new THREE.Mesh(new THREE.SphereGeometry(bodyR * 1.05, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.accent);
          mesh.scale.y = 0.8 * size + 0.4;
          mesh.position.set(0, torsoY, skel === 'quadruped' ? 0 : -bodyR * 0.1);
          if (skel !== 'quadruped') mesh.rotation.x = -0.5;
        } else if (ex.type === 'wing') {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(size * 1.3, size * 0.55, size * 0.06), M.belly);
          const s = i % 2 === 0 ? -1 : 1;
          mesh.position.set(s * (bodyR + size * 0.55), torsoY + bodyH * 0.45, -bodyR * 0.2);
          mesh.rotation.z = s * 0.5; mesh.rotation.y = s * 0.35;
          mesh.name = s < 0 ? 'wingL' : 'wingR';
        } else if (ex.type === 'tentacle') {
          mesh = new THREE.Group();
          let py = 0;
          for (let sgm = 0; sgm < 3; sgm++) {
            const r0 = size * (0.14 - sgm * 0.035);
            const seg = limbMesh(THREE, M.body, r0 * 0.7, r0, size * 0.4);
            seg.position.y = py; py -= size * 0.38; mesh.add(seg);
          }
          const ang = (i / cnt) * Math.PI * 2;
          mesh.position.set(Math.cos(ang) * bodyR * 0.7, torsoY - bodyH * 0.45, Math.sin(ang) * bodyR * 0.7);
        }
        // 第一條尾巴具名 'tail' → 手勢通道(tail.x/y/z)能搖它;其餘沿用流水號
        if (mesh) { if (!mesh.name) mesh.name = (ex.type === 'tail' && !char.getObjectByName('tail')) ? 'tail' : ex.type + xi + '_' + i; host.add(mesh); }
      }
    });

    // — 落地 + 整體尺寸 —
    const size = spec.size == null ? 1 : spec.size;
    char.scale.setScalar(size);
    char.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(char);
    char.position.y = -box.min.y;
    char.updateMatrixWorld(true);

    const animator = createMonsterAnimator(char, skel, { torsoY: torsoY, blobH: bodyH * 2 });
    const stats = {
      skeleton: skel, parts: countMeshes(char), height: +(box.max.y - box.min.y).toFixed(2),
      width: +(box.max.x - box.min.x).toFixed(2), depth: +(box.max.z - box.min.z).toFixed(2),
      eyes: EY.count, extras: extras.map(e => e.type),
    };
    return { root, char, animator, stats, warnings: v.warnings };
  }

  function countMeshes(g) { let n = 0; g.traverse(o => { if (o.isMesh) n++; }); return n; }

  // ── code 型建構(img2three):執行 procedural builder → 接地 + root 包裝 + 動畫器 ──
  // 契約:code 是 function body(參數 THREE, seed),return THREE.Group(或 {root});
  // 框架自動接地(bbox min.y 貼 0),部件命名對齊(torso/head/legL/R/armL/R 或 legFL…)
  // 則獲得對應骨架動畫器,否則 skeleton:"blob"(整體彈跳)。
  function buildCode(THREE, spec, seed, v) {
    const fn = new Function('THREE', 'seed', spec.code);
    let out;
    try { out = fn(THREE, seed); }
    catch (e) { const err = new Error('[LowMonster] code 執行錯誤: ' + e.message); err.errors = ['code 執行錯誤:' + e.message]; throw err; }
    const char = (out && out.isObject3D) ? out : (out && out.root && out.root.isObject3D ? out.root : null);
    if (!char) { const err = new Error('[LowMonster] code 必須 return THREE.Group(或 {root})'); err.errors = ['code 必須 return THREE.Group(或 {root})']; throw err; }
    const size = spec.size == null ? 1 : spec.size;
    char.scale.multiplyScalar(size);
    char.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(char);
    char.position.y += -box.min.y;   // 接地(累加:code 可能已擺過位置)
    char.updateMatrixWorld(true);
    const root = new THREE.Group(); root.add(char);
    const skel = SKELETONS.indexOf(spec.skeleton) >= 0 ? spec.skeleton : 'blob';
    const h = box.max.y - box.min.y;
    const animator = createMonsterAnimator(char, skel, { torsoY: h * 0.45, blobH: h * 0.5 });
    let eyes = 0; char.traverse(o => { if (/^eye\d*$/.test(o.name || '')) eyes++; });
    const stats = {
      skeleton: skel + '+code', parts: countMeshes(char), height: +h.toFixed(2),
      width: +(box.max.x - box.min.x).toFixed(2), depth: +(box.max.z - box.min.z).toFixed(2),
      eyes: eyes, extras: ['code'],
    };
    return { root, char, animator, stats, warnings: (v && v.warnings) || [] };
  }

  // ── 怪物動畫器(骨架內建:idle/walk/attack/hit;外部速度驅動,不滑步)──
  function createMonsterAnimator(char, skel, dims) {
    const parts = {};
    // 注意:char 群組本身不能進快照 — 遊戲用 char.rotation.y 控制面向,
    // 進了快照會被每幀 resetAll 重設回 0(= 轉不動)。
    char.traverse(o => { if (o.name && o !== char) parts[o.name] = o; });
    // base-snapshot(與 lowpoly 同思路:動畫寫「相對 base 的偏移」,不吃掉遊戲的擺放)
    const base = {};
    for (const k in parts) {
      const p = parts[k];
      base[k] = { px: p.position.x, py: p.position.y, pz: p.position.z, rx: p.rotation.x, ry: p.rotation.y, rz: p.rotation.z, sx: p.scale.x, sy: p.scale.y, sz: p.scale.z };
    }
    const baseChar = { y: char.position.y, sy: char.scale.y, sx: char.scale.x, sz: char.scale.z };
    const LEGS = skel === 'quadruped' ? ['legFL', 'legFR', 'legBL', 'legBR'] : ['legL', 'legR'];
    // 相位:biped 左右反相;quadruped 對角同相(FL+BR / FR+BL)
    const PHASE = skel === 'quadruped' ? { legFL: 0, legBR: 0, legFR: Math.PI, legBL: Math.PI } : { legL: 0, legR: Math.PI };

    const A = {
      current: 'idle', busy: false, progress: 1,
      rig: 'monster_' + skel,   // GestureKit 手勢規格對應的 rig 名
      clips: {},                // GestureKit.compile(spec).clip 掛這裡(與 lowpoly animator 同介面)
      _speed: 0, _phase: 0, _t: 0, _one: null,   // _one = { name, t, dur }
      _gest: null, _gestLoop: null,              // 自訂手勢:oneshot / loop 各一槽
      setSpeed(v) { this._speed = Math.max(0, v || 0); },
      play(name) {
        const c = this.clips[name];
        if (c) {
          if (c.oneShot) { this._gest = { name, clip: c, t: 0, dur: c.dur || 1 }; this.progress = 0; }
          else { this._gestLoop = { name, clip: c, t: 0 }; }
          this.current = name; return;
        }
        if (name === 'attack' || name === 'hit') { this._one = { name, t: 0, dur: name === 'attack' ? 0.45 : 0.35 }; this.current = name; this.busy = name === 'hit'; this.progress = 0; return; }
        if (name === 'idle' || name === 'walk') { this._gestLoop = null; this.current = name; }
      },
      update(dt) {
        dt = Math.min(0.1, Math.max(0, dt || 0));
        this._t += dt;
        const spd = this._speed;
        const walking = spd > 0.05;
        // 步頻 ∝ 速度(blob 跳頻也是)
        this._phase += dt * (skel === 'blob' ? (2.2 + spd * 1.6) : (4 + spd * 3.2)) * (walking ? 1 : 0);
        resetAll();
        if (walking) sampleWalk(this._phase, Math.min(1, spd)); else sampleIdle(this._t);
        if (this._one) {
          const o = this._one; o.t += dt;
          const u = Math.min(1, o.t / o.dur);
          this.progress = u;
          if (o.name === 'attack') sampleAttack(u); else sampleHit(u);
          if (u >= 1) { this._one = null; this.busy = false; }
        }
        // 自訂手勢 clip(GestureKit)疊加在 idle/walk 上:loop 持續、oneshot 播完自動退場
        const gl = this._gestLoop, go = this._gest;
        if (gl || go) {
          const p = makePose();
          if (gl) { gl.t += dt; gl.clip.sample({ t: gl.t }, p); }
          if (go) {
            go.t += dt;
            const u = Math.min(1, go.t / go.dur);
            this.progress = u;
            go.clip.sample({ t: go.t }, p);
            if (u >= 1) this._gest = null;
          }
          applyPose(p);
        }
        this.current = this._one ? this._one.name
          : this._gest ? this._gest.name
          : this._gestLoop ? this._gestLoop.name
          : (walking ? 'walk' : 'idle');
      },
    };
    // 手勢姿勢物件:部件旋轉偏移(相加)+ posY 升降(公尺,相加)+ 整體縮放(相乘)
    function makePose() {
      const p = { posY: 0, sx: 1, sy: 1, sz: 1 };
      for (const k in parts) p[k] = { x: 0, y: 0, z: 0 };
      return p;
    }
    function applyPose(p) {
      for (const k in parts) {
        const o = p[k]; if (!o) continue;
        if (o.x) parts[k].rotation.x += o.x;
        if (o.y) parts[k].rotation.y += o.y;
        if (o.z) parts[k].rotation.z += o.z;
      }
      if (p.posY) char.position.y += p.posY;
      if (p.sx !== 1) char.scale.x *= p.sx;
      if (p.sy !== 1) char.scale.y *= p.sy;
      if (p.sz !== 1) char.scale.z *= p.sz;
    }

    function R(name, ch, v) { const p = parts[name]; if (!p) return; p.rotation[ch] = base[name]['r' + ch] + v; }
    function S(name, ch, v) { const p = parts[name]; if (!p) return; p.scale[ch] = base[name]['s' + ch] * v; }
    function resetAll() {
      for (const k in parts) {
        const p = parts[k], b = base[k];
        p.rotation.x = b.rx; p.rotation.y = b.ry; p.rotation.z = b.rz;
        p.scale.x = b.sx; p.scale.y = b.sy; p.scale.z = b.sz;
        p.position.y = b.py;
      }
      char.position.y = baseChar.y;
      char.scale.y = baseChar.sy; char.scale.x = baseChar.sx; char.scale.z = baseChar.sz;
    }
    function sampleIdle(t) {
      const br = Math.sin(t * 2.1) * 0.03;
      S('torso', 'y', 1 + br); S('torso', 'x', 1 - br * 0.6);
      R('head', 'y', Math.sin(t * 0.7) * 0.08);
      if (skel === 'blob') { char.scale.y = baseChar.sy * (1 + br * 1.6); char.scale.x = baseChar.sx * (1 - br); char.scale.z = baseChar.sz * (1 - br); }
    }
    function sampleWalk(ph, k) {
      if (skel === 'blob') {
        // 彈跳位移:squash(觸地)→ stretch(騰空)
        const c = Math.sin(ph);
        const up = Math.max(0, c);
        char.position.y = baseChar.y + up * 0.22 * k * (dims.blobH || 1);
        const sq = 1 - Math.max(0, -c) * 0.25 * k + up * 0.12 * k;
        char.scale.y = baseChar.sy * sq;
        char.scale.x = baseChar.sx * (2 - sq); char.scale.z = baseChar.sz * (2 - sq);
        R('torso', 'x', up * 0.1 * k);
        return;
      }
      for (const ln of LEGS) R(ln, 'x', Math.sin(ph + PHASE[ln]) * 0.7 * k);
      R('armL', 'x', Math.sin(ph + Math.PI) * 0.5 * k);
      R('armR', 'x', Math.sin(ph) * 0.5 * k);
      char.position.y = baseChar.y + Math.abs(Math.sin(ph)) * 0.04 * k;
      R('torso', 'x', 0.06 * k);
      R('head', 'x', -0.04 * k);
    }
    function sampleAttack(u) {
      const w = Math.sin(u * Math.PI);
      R('torso', 'x', w * 0.45);            // 前撲
      R('head', 'x', w * 0.3);
      R('armL', 'x', -w * 1.6); R('armR', 'x', -w * 1.6);
      if (skel === 'blob') { char.scale.y = baseChar.sy * (1 - w * 0.2); char.scale.z = baseChar.sz * (1 + w * 0.3); }
    }
    function sampleHit(u) {
      const w = Math.sin(u * Math.PI);
      R('torso', 'x', -w * 0.3); R('torso', 'z', Math.sin(u * Math.PI * 4) * 0.12 * (1 - u));
      R('head', 'x', -w * 0.25);
      if (skel === 'blob') char.scale.y = baseChar.sy * (1 - w * 0.3);
    }
    return A;
  }

  // ── 內建範例(monster-lab few-shot 與測試共用)──────────────
  const EXAMPLES = {
    slime: { name: 'slime', label: '史萊姆', skeleton: 'blob', size: 0.9,
      palette: { body: '#6fc276', belly: '#c9efc5', accent: '#2e6b3a', eye: '#15251a' },
      body: { shape: 'pear', w: 1.0, h: 1.15, squash: 0.18 }, head: { shape: 'none' },
      eyes: { count: 2, size: 0.2, spread: 0.45, y: 0.62, style: 'dot' }, mouth: { style: 'flat', size: 0.5 },
      extras: [{ type: 'antenna', count: 1, pos: 'head', size: 0.5 }], jitter: 0.18 },
    goblin: { name: 'goblin', label: '哥布林', skeleton: 'biped', size: 1.0,
      palette: { body: '#7d9b4e', belly: '#cbd8a2', accent: '#4a3b56', eye: '#1a0f0f' },
      body: { shape: 'pear', w: 1, h: 1, squash: 0.05 }, head: { shape: 'ball', size: 1.0 },
      eyes: { count: 2, size: 0.18, spread: 0.55, y: 0.55, style: 'oval' }, mouth: { style: 'fangs', size: 0.7 },
      limbs: { legs: { len: 0.42, thick: 0.28 }, arms: { count: 2, len: 0.6, claw: true } },
      extras: [{ type: 'horn', count: 2, pos: 'head', size: 0.45 }], jitter: 0.15 },
    wolf: { name: 'wolf', label: '野狼', skeleton: 'quadruped', size: 1.1,
      palette: { body: '#6b6f7e', belly: '#c7c9d1', accent: '#2c2f3a', eye: '#d8b23a' },
      body: { shape: 'egg', w: 0.9, h: 0.85 }, head: { shape: 'cone', size: 0.9 },
      eyes: { count: 2, size: 0.15, spread: 0.6, y: 0.6, style: 'glow' }, mouth: { style: 'fangs', size: 0.8 },
      limbs: { legs: { len: 0.5, thick: 0.22 } },
      extras: [{ type: 'tail', count: 1, pos: 'rear', size: 0.7 }, { type: 'spike', count: 3, pos: 'back', size: 0.35 }], jitter: 0.12 },
  };

  const api = {
    SPEC_VERSION: 1,
    skeletons: SKELETONS.slice(),
    bodyShapes: BODY_SHAPES.slice(), headShapes: HEAD_SHAPES.slice(),
    eyeStyles: EYE_STYLES.slice(), mouthStyles: MOUTH_STYLES.slice(),
    extraTypes: EXTRA_TYPES.slice(), extraPositions: EXTRA_POS.slice(),
    validate, build, examples: EXAMPLES,
  };
  global.LowMonster = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

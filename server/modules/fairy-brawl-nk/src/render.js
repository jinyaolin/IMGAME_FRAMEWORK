// ═══════════════════════════════════════════════════════════════
// 童話大亂鬥 (NetKit) — 畫面 + 輸入(target: 'render')。手機+大螢幕共用,靠 Net.surface 分支。
// 只讀 Net.entities(已內插/預測);手機另外送 Net.input。不含任何權威邏輯。
// ═══════════════════════════════════════════════════════════════
try { if (typeof window !== 'undefined') window.__NET = Net; } catch (e) {}   // 測試/除錯掛鉤
const THREE = window.THREE;
const W = GameAPI.width, H = GameAPI.height;
const renderer = new THREE.WebGLRenderer({ canvas: GameAPI.canvas, antialias: true });
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ecbff);
scene.fog = new THREE.Fog(0x8ecbff, 36, 100);   // 遠景霧化 → 景深、藏場景邊界
scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8fbf, 1.05));
const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(6, 14, 8); sun.castShadow = true;
sun.shadow.camera.left = -22; sun.shadow.camera.right = 22; sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -10; scene.add(sun);
const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 200); camera.position.set(0, 7, 26);

// ── 童話天空:太陽 + 雲 + 彩虹(背景,z 遠)──
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(2.4, 18, 14), new THREE.MeshBasicMaterial({ color: 0xfff2a8 }));
sunBall.position.set(-17, 15, -24); scene.add(sunBall);
for (const c of [[-12, 12, -20, 1.5], [10, 14, -24, 2.0], [1, 18, -28, 1.3], [-6, 9, -18, 1.1]]) {
  const cl = LowWorld.cloud({ seed: (c[0] * 7 + 31) | 0 }); cl.position.set(c[0], c[1], c[2]); cl.scale.setScalar(c[3]); scene.add(cl);
}
const rainbow = new THREE.Group();
[0xff6b6b, 0xffa94d, 0xffe14d, 0x63d66b, 0x5bb8ff, 0x9b7bff].forEach((col, i) => {
  const t = new THREE.Mesh(new THREE.TorusGeometry(12 - i * 0.62, 0.3, 8, 44, Math.PI), new THREE.MeshBasicMaterial({ color: col }));
  rainbow.add(t);
}); rainbow.position.set(12, 1.0, -30); scene.add(rainbow);

// ── 浮島:草皮頂 + 岩石倒錐底 ──
// 效能:只有角色投射陰影;場景/裝飾一律不投不受(避免 shadow pass 掃上百顆裝飾 mesh → 開場卡頓)
function noShadow(o) { o.traverse(n => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } }); return o; }
// 不規則岩尖(seeded 抖動的低面錐):浮島底、大地底共用 → 鋸齒感、每處不同
function spikeMesh(radius, height, seed, color) {
  const geo = new THREE.ConeGeometry(radius, height, 6, 2);
  const pos = geo.attributes.position; let s = (seed | 0) || 1; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < height * 0.45) {   // 頂環(接地面處)不抖 → 貼合;越往尖端越亂
      pos.setX(i, pos.getX(i) + (rnd() - 0.5) * radius * 0.6);
      pos.setZ(i, pos.getZ(i) + (rnd() - 0.5) * radius * 0.6);
      if (y > -height * 0.48) pos.setY(i, y + (rnd() - 0.5) * height * 0.22);
    }
  }
  // flatShading 用面法線,免 computeVertexNormals(省開場成本)
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  m.rotation.x = Math.PI; return m;   // 尖端朝下
}
function island(cx, halfW, depth, topY, grass, rockCol) {
  const g = new THREE.Group(); g.position.set(cx, 0, 0);
  const top = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, 0.7, depth), new THREE.MeshLambertMaterial({ color: grass }));
  top.position.y = topY - 0.35; top.receiveShadow = true; g.add(top);
  // 小且不規則的底:比島面窄很多,再掛一兩顆偏心小尖 → 不對稱
  const r0 = halfW * 0.5, h0 = halfW * 0.95;
  const sp = spikeMesh(r0, h0, (cx * 7 + 3) | 0, rockCol); sp.position.set(-halfW * 0.1, topY - 0.7 - h0 * 0.42, 0); g.add(noShadow(sp));
  const sp2 = spikeMesh(halfW * 0.28, halfW * 0.6, (cx * 13 + 5) | 0, rockCol); sp2.position.set(halfW * 0.32, topY - 0.85 - halfW * 0.3, 0.3); g.add(noShadow(sp2));
  scene.add(g); return g;
}
// 主島:草皮頂 + 一排不規則岩尖 → 浮空大陸的鋸齒底(大小/深淺/前後各異)
const mainTop = new THREE.Mesh(new THREE.BoxGeometry(42, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0x63c74d }));
mainTop.position.y = -0.4; mainTop.receiveShadow = true; scene.add(mainTop);
for (let i = 0; i < 8; i++) {
  const x = -18 + i * 5.1, r = 2.0 + ((i * 37) % 5) * 0.5, h = 3.2 + ((i * 53) % 6) * 0.9;
  const col = (i % 3) ? 0x8a7360 : 0x796152;
  const sp = spikeMesh(r, h, (x * 11 + 7) | 0, col); sp.position.set(x, -0.8 - h * 0.4, -0.3 + ((i % 2) ? 0.7 : -0.5)); scene.add(noShadow(sp));
}
// 三座浮島
for (const p of CFG.PLATFORMS) island(p.x, p.w, 4, p.y, 0x63c74d, 0x8a7360);

// ── 場景裝飾(固定 seed → 每局一致;放背景 z<0 當框景,不擋 z=0 的戰鬥)──
function deco(kind, opts, x, y, z, s) { const o = noShadow(LowWorld.create(kind, opts)); o.position.set(x, y, z); if (s) o.scale.setScalar(s); scene.add(o); return o; }
deco('tree', { seed: 3, kind: 'round' }, -16, 0, -2.6, 1.05);
deco('tree', { seed: 8, kind: 'fruit' }, 15, 0, -2.8, 1.0);
deco('mushroom', { seed: 2 }, -10, 0, -1.8, 1.2);
deco('bush', { seed: 4 }, -4, 0, -1.6, 1.1);
deco('flowers', { seed: 1 }, -12.5, 0, 2.4, 1.0);
deco('flowers', { seed: 9 }, 11, 0, 2.6, 1.0);
deco('grass', { seed: 7 }, -2, 0, 2.8, 1.2);
// 浮島頂上各擺一朵
deco('mushroom', { seed: 21 }, CFG.PLATFORMS[0].x - 0.6, CFG.PLATFORMS[0].y, -1.2, 0.8);
deco('flowers', { seed: 22 }, CFG.PLATFORMS[1].x + 0.4, CFG.PLATFORMS[1].y, -1.0, 0.8);

// ── FX(命中/KO 火花)──
const fxm = new FX.Manager(scene);

// ── 投射物(火球/冰柱/箭/泡泡環):讀 Net.world.projs,依 id 建/更新/移除 mesh ──
const projMeshes = new Map();   // id -> mesh
function makeProjMesh(kind, type) {
  if (type === 'ring') {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.14, 8, 28), new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.75 }));
    m.rotation.x = Math.PI / 2; return m;   // 環躺在 xy 面(側視看得到整圈)
  }
  const col = kind === 'wizard' ? 0xaef0ff : (kind === 'elf' ? 0xd8b26a : 0xff8a3d);   // 冰藍 / 箭木 / 火橘
  if (kind === 'elf') { const a = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.8, 6), new THREE.MeshBasicMaterial({ color: col })); a.rotation.z = -Math.PI / 2; return a; }
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: col }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35 }));
  g.add(core); g.add(glow); return g;
}
function syncProjectiles() {
  const list = (Net.world && Net.world.projs) || [];
  const seen = new Set();
  for (const pr of list) {
    seen.add(pr.id);
    let m = projMeshes.get(pr.id);
    if (!m) { m = makeProjMesh(pr.k, pr.t); projMeshes.set(pr.id, m); scene.add(m); }
    m.position.set(pr.x, pr.y, 0);
    if (pr.t === 'ring') m.scale.setScalar(Math.max(0.15, pr.r));
  }
  for (const [id, m] of projMeshes) if (!seen.has(id)) { scene.remove(m); projMeshes.delete(id); }
}

// ── 角色 ──
const fighters = new Map();   // id -> { root, inner, lp, animator, mats, bar, barFg, dir, flashT, idx }
function buildFighter(idx, colorCss, role, seed) {
  const root = new THREE.Group(); const inner = new THREE.Group(); root.add(inner);
  const spec = role ? { role: role, seed: (seed | 0) || (1000 + idx * 137) } : specForIdx(idx);   // 選好的角色/外觀,否則 idx 預設
  const lp = LowPoly.character({ role: spec.role, seed: spec.seed });
  const bbox = new THREE.Box3().setFromObject(lp);
  const k = CFG.CHAR_H / Math.max(0.001, bbox.max.y - bbox.min.y);
  lp.scale.setScalar(k); lp.position.y = -bbox.min.y * k; inner.add(lp);
  const mats = []; const seen = new Set();
  lp.traverse(n => { if (n.isMesh) { n.castShadow = true; const a = Array.isArray(n.material) ? n.material : [n.material]; a.forEach(m => { if (m && !seen.has(m)) { seen.add(m); mats.push(m); } }); } });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1.05, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(colorCss || '#fff'), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; root.add(ring);
  const bar = new THREE.Group(); bar.position.y = 2.8;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.2), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.7 })); bar.add(bg);
  const barFg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.13), new THREE.MeshBasicMaterial({ color: 0x52e05a })); barFg.position.z = 0.01; bar.add(barFg); root.add(bar);
  // simple:true → 罐頭運動循環(含彎膝),靠 setSpeed 餵入的速度推進、不從 root 位置反推、不貼地。
  // 網路角色的 root 位置是插值/預測來的(可能抖),用權威 vx 當速度 → 走跑動作穩、不隨位置抖動。
  const animator = LowPoly.createAnimator(lp, { body: inner, root, simple: true });
  const f = { root, inner, lp, animator, mats, bar, barFg, dir: null, flashT: 0, idx };   // null → 首次快照必套 setDir(否則 spawn 朝向沒被旋轉)
  return f;
}
function setDir(f, dir) { f.dir = dir; f.inner.rotation.y = dir > 0 ? Math.PI / 2 : (dir < 0 ? -Math.PI / 2 : 0); }
function setFlash(f, hex) { for (const m of f.mats) if (m.emissive) m.emissive.setHex(hex); }
function setHp(f, r) { r = Math.max(0, Math.min(1, r)); f.barFg.scale.x = Math.max(0.001, r); f.barFg.position.x = -0.8 * (1 - r); f.barFg.material.color.setHex(r > 0.5 ? 0x52e05a : (r > 0.25 ? 0xffc93d : 0xff5252)); }

// ── 事件 → 一次性動作 + 火花 ──
Net.on('atk', d => { const f = fighters.get(String(d.by)); if (f) f.animator.play(d.kind === 'kick' ? 'kick' : 'punch'); });
Net.on('hit', d => {
  const f = fighters.get(String(d.target)); if (!f) return;
  setFlash(f, 0xcc2222); f.flashT = 0.15; f.animator.play('hit');
  fxm.spawn('puff', { x: f.root.position.x, y: (f.root.position.y || 0) + 0.6 });   // 命中白煙
});
Net.on('ko',  d => {
  const f = fighters.get(String(d.target)); if (!f) return;
  f.animator.play('ko');
  fxm.spawn('burst', { x: f.root.position.x, y: f.root.position.y || 0 });   // KO 爆碎
});
// 技能施放 → 施法動作 + 特效。瞬發類放完整範圍/治療特效;投射類只放小槍口 puff(飛行體由 projMeshes 畫)
const CAST_FX = { aoe: 'burst', statusAoe: 'sleepwave', cone: 'cone', heal: 'heal', dodge: 'puff', blink: 'puff', stone: 'stonecast', proj: 'puff', multi: 'puff', ring: 'puff' };
Net.on('cast', d => {
  const f = fighters.get(String(d.by)); if (!f) return;
  f.animator.play('emote');
  let fx = CAST_FX[d.type] || 'burst';
  if (d.role === 'knight') fx = 'whirl';
  fxm.spawn(fx, { x: f.root.position.x, y: (f.root.position.y || 0) + (d.type === 'proj' || d.type === 'multi' ? 1.2 : 0), dir: f.dir });
});
Net.onRemove(id => { const f = fighters.get(id); if (f) { scene.remove(f.root); fighters.delete(id); } });

// ── 手機輸入:可見 DOM HUD(左搖桿 + 右 拳/腳/技 按鈕)。掛在 GameAPI.container 上,覆在 canvas 之上 ──
let inMx = 0, jumpEdge = false, atkEdge = false, kickEdge = false, skillEdge = false, lastMx = 0, lastSent = 0;
let skillHud = null, mobileInfo = null;   // 技能冷卻/名稱、自己血條+buff HUD
const ROLE_CN = { knight: '騎士', witch: '女巫', troll: '巨魔', frog: '青蛙', princess: '公主', wizard: '巫師', dwarf: '矮人', robin: '小紅帽', fairy: '仙女', elf: '精靈', hood: '小紅帽', prince: '王子' };
if (Net.surface === 'mobile') {
  const hud = document.createElement('div');
  hud.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;font-family:system-ui,sans-serif;user-select:none;-webkit-user-select:none;';
  GameAPI.container.appendChild(hud);
  GameAPI.onEnd(() => { try { hud.remove(); } catch (e) {} });

  // 搖桿(左下,固定底座 + 跟手球):左右→mx,上推→跳
  const joy = document.createElement('div');
  joy.style.cssText = 'position:absolute;left:5%;bottom:7%;width:33vmin;height:33vmin;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.4);pointer-events:auto;touch-action:none;';
  const knob = document.createElement('div');
  knob.style.cssText = 'position:absolute;left:50%;top:50%;width:44%;height:44%;border-radius:50%;background:rgba(255,255,255,.55);transform:translate(-50%,-50%);transition:none;';
  joy.appendChild(knob); hud.appendChild(joy);
  let jid = null, jcx = 0, jcy = 0, jR = 1, jumpArmed = true;
  const setKnob = (dx, dy) => { knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))'; };
  const jStart = (px, py, id) => { jid = id; const r = joy.getBoundingClientRect(); jcx = r.left + r.width / 2; jcy = r.top + r.height / 2; jR = r.width / 2; jMove(px, py); };
  const jMove = (px, py) => { if (jid == null) return; let dx = px - jcx, dy = py - jcy; const d = Math.hypot(dx, dy) || 1; if (d > jR) { dx = dx / d * jR; dy = dy / d * jR; } setKnob(dx, dy); inMx = Math.max(-1, Math.min(1, (px - jcx) / jR)); if (dy < -jR * 0.5 && jumpArmed) { jumpEdge = true; jumpArmed = false; } if (dy > -jR * 0.3) jumpArmed = true; };
  const jEnd = () => { jid = null; inMx = 0; jumpArmed = true; setKnob(0, 0); };
  joy.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; jStart(t.clientX, t.clientY, t.identifier); }, { passive: false });
  window.addEventListener('touchmove', e => { if (jid == null) return; for (const t of e.changedTouches) if (t.identifier === jid) { e.preventDefault(); jMove(t.clientX, t.clientY); } }, { passive: false });
  window.addEventListener('touchend', e => { for (const t of e.changedTouches) if (t.identifier === jid) jEnd(); });
  window.addEventListener('touchcancel', () => jEnd());
  joy.addEventListener('mousedown', e => { jStart(e.clientX, e.clientY, 'm'); });
  window.addEventListener('mousemove', e => { if (jid === 'm') jMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (jid === 'm') jEnd(); });

  // 按鈕(右下):拳(快)/腳(重)/技
  function mkBtn(label, css, onDown) {
    const b = document.createElement('div');
    b.textContent = label;
    b.style.cssText = 'position:absolute;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;pointer-events:auto;touch-action:none;box-shadow:0 3px 9px rgba(0,0,0,.35);text-shadow:0 1px 3px rgba(0,0,0,.5);' + css;
    const press = e => { e.preventDefault(); onDown(); b.style.filter = 'brightness(1.35)'; setTimeout(() => { b.style.filter = ''; }, 90); };
    b.addEventListener('touchstart', press, { passive: false }); b.addEventListener('mousedown', press);
    hud.appendChild(b); return b;
  }
  mkBtn('拳', 'right:5%;bottom:8%;width:17vmin;height:17vmin;font-size:6vmin;background:rgba(255,110,110,.9);', () => { atkEdge = true; });
  mkBtn('腳', 'right:22%;bottom:22%;width:17vmin;height:17vmin;font-size:6vmin;background:rgba(110,150,255,.9);', () => { kickEdge = true; });
  const skillBtn = mkBtn('技', 'right:6%;bottom:30%;width:15vmin;height:15vmin;font-size:4vmin;background:rgba(180,110,255,.92);', () => { skillEdge = true; });
  skillBtn.style.overflow = 'hidden';
  // 冷卻:圓形 conic 掃(剩越多越暗)+ 剩餘秒數
  const cdArc = document.createElement('div');
  cdArc.style.cssText = 'position:absolute;inset:0;border-radius:50%;pointer-events:none;';
  skillBtn.appendChild(cdArc);
  const cdNum = document.createElement('div');
  cdNum.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:5vmin;font-weight:800;pointer-events:none;text-shadow:0 1px 3px #000;';
  skillBtn.appendChild(cdNum);
  const skillTag = document.createElement('div');
  skillTag.style.cssText = 'position:absolute;right:6%;bottom:47%;color:#fff;font-size:3vmin;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.6);pointer-events:none;text-align:right;';
  hud.appendChild(skillTag);
  skillHud = {
    setCd: (r, secs) => {
      cdArc.style.background = r > 0.001 ? 'conic-gradient(rgba(0,0,0,.55) ' + (r * 360).toFixed(0) + 'deg, transparent 0deg)' : 'none';
      cdNum.textContent = (r > 0.001 && secs > 0) ? Math.ceil(secs) : '';
    },
    setName: s => { skillTag.textContent = s || ''; },
  };

  // 自己血條 + 名字/角色 + buff(左上)
  const info = document.createElement('div');
  info.style.cssText = 'position:absolute;left:3%;top:3%;width:46%;pointer-events:none;color:#fff;text-shadow:0 1px 2px #000;';
  const nameEl = document.createElement('div'); nameEl.style.cssText = 'font-weight:700;font-size:3.4vmin;margin-bottom:3px;';
  const hpWrap = document.createElement('div'); hpWrap.style.cssText = 'height:2.6vmin;border-radius:4px;background:rgba(0,0,0,.45);overflow:hidden;border:1px solid rgba(255,255,255,.45);';
  const hpFill = document.createElement('div'); hpFill.style.cssText = 'height:100%;width:100%;background:#52e05a;transition:width .12s;'; hpWrap.appendChild(hpFill);
  const buffRow = document.createElement('div'); buffRow.style.cssText = 'margin-top:3px;font-size:2.9vmin;font-weight:600;min-height:3vmin;';
  info.appendChild(nameEl); info.appendChild(hpWrap); info.appendChild(buffRow); hud.appendChild(info);
  mobileInfo = {
    _hp: -1, _nm: '', _bf: '',
    setHp(r) { r = Math.max(0, Math.min(1, r)); if (Math.abs(r - this._hp) < 0.005) return; this._hp = r; hpFill.style.width = r * 100 + '%'; hpFill.style.background = r > 0.5 ? '#52e05a' : (r > 0.25 ? '#ffc93d' : '#ff5252'); },
    setName(t) { if (t === this._nm) return; this._nm = t; nameEl.textContent = t; },
    setBuffs(t) { if (t === this._bf) return; this._bf = t; buffRow.textContent = t; },
  };
}

// ── 回合倒數 + 天災紅暈(所有端;大螢幕大、手機小)。掛 GameAPI.container(退回 body)──
const hudRoot = GameAPI.container || document.body;
const big = Net.surface !== 'mobile';
const timerEl = document.createElement('div');
timerEl.style.cssText = 'position:absolute;top:2.5%;left:50%;transform:translateX(-50%);color:#fff;font-weight:800;text-shadow:0 2px 6px rgba(0,0,0,.6);pointer-events:none;font-variant-numeric:tabular-nums;z-index:11;font-size:' + (big ? '6vmin' : '4.4vmin') + ';';
hudRoot.appendChild(timerEl);
const rainVig = document.createElement('div');
rainVig.style.cssText = 'position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 18vmin rgba(190,40,20,0);transition:box-shadow .3s;z-index:9;';
hudRoot.appendChild(rainVig);
GameAPI.onEnd(() => { try { timerEl.remove(); rainVig.remove(); } catch (e) {} });
let _lastTimerTxt = '', _lastRain = -1;
function updateWorldHud() {
  const w = Net.world || {};
  const tl = w.timeLeft || 0;
  const txt = Math.floor(tl / 60) + ':' + String(Math.floor(tl % 60)).padStart(2, '0');
  if (txt !== _lastTimerTxt) { timerEl.textContent = txt; timerEl.style.color = tl <= 10 ? '#ff6b6b' : '#fff'; _lastTimerTxt = txt; }
  // 天災紅暈:全螢幕大模糊陰影,只在狀態切換時改一次(每幀重繪會癱瘓效能)
  const rain = w.rain ? 1 : 0;
  if (rain !== _lastRain) { rainVig.style.boxShadow = 'inset 0 0 18vmin rgba(190,40,20,' + (rain ? 0.5 : 0) + ')'; _lastRain = rain; }
}

// ── 道具(藥水/天災)mesh ──
const itemMeshes = new Map();
function makeItemMesh(kind) {
  const col = { red: 0xff5252, blue: 0x4d9bff, agi: 0x52e05a, pow: 0xff9f43, dis: 0x992222 }[kind] || 0xffffff;
  const g = new THREE.Group();
  if (kind === 'dis') { g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshBasicMaterial({ color: col }))); }
  else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.7, 10), new THREE.MeshLambertMaterial({ color: col }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 8), new THREE.MeshLambertMaterial({ color: 0x8a5a2a })); cap.position.y = 0.44;
    g.add(body); g.add(cap);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 6, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
  halo.rotation.x = Math.PI / 2; halo.position.y = 0.1; g.add(halo);
  return g;
}
function syncItems(ts) {
  const list = (Net.world && Net.world.items) || [];
  const seen = new Set();
  for (const it of list) {
    seen.add(it.id);
    let m = itemMeshes.get(it.id);
    if (!m) { m = makeItemMesh(it.k); itemMeshes.set(it.id, m); scene.add(m); }
    m.position.set(it.x, it.y + 0.7 + Math.sin(ts / 320) * 0.12, 0); m.rotation.y = ts / 500;
  }
  for (const [id, m] of itemMeshes) if (!seen.has(id)) { scene.remove(m); itemMeshes.delete(id); }
}

let lastTs = 0;
GameAPI.update(ts => {
  const dt = Math.min(0.05, ((ts - lastTs) || 16) / 1000); lastTs = ts;
  // 手機:送 input(mx 變動或有邊緣才送 → 省流量)
  if (Net.surface === 'mobile') {
    if (inMx !== lastMx || jumpEdge || atkEdge || kickEdge || skillEdge || (ts - lastSent > 100)) {
      Net.input({ mx: inMx, jump: jumpEdge, atk: atkEdge, kick: kickEdge, skill: skillEdge }); lastMx = inMx; lastSent = ts; jumpEdge = false; atkEdge = false; kickEdge = false; skillEdge = false;
    }
    // 技能冷卻/名稱 + 自己血條/buff HUD(讀自己快照)
    if (Net.self && Net.entities[Net.self]) {
      const s = Net.entities[Net.self].s || {};
      if (skillHud) { skillHud.setCd(s.scd || 0, s.scds || 0); skillHud.setName(s.skn || ''); }
      if (mobileInfo) {
        mobileInfo.setHp((s.hp != null ? s.hp : CFG.HP_MAX) / CFG.HP_MAX);
        mobileInfo.setName((GameAPI.playerName || '你') + (s.role ? ' · ' + (ROLE_CN[s.role] || s.role) : ''));
        const b = []; if (s.bcd) b.push('🔵技速'); if (s.bspd) b.push('🟢敏捷'); if (s.bpow) b.push('🟠強化');
        if (s.ice) b.push('❄冰凍'); if (s.stn) b.push('🪨石化'); if (s.slp) b.push('💤睡眠');
        mobileInfo.setBuffs(b.join('  '));
      }
    }
  }
  updateWorldHud();                  // 回合倒數 + 天災紅暈(所有端)
  LowWorld.wind(scene, ts / 1000);   // 花草樹梢隨風擺(硬物不動)
  fxm.update(dt);                    // 火花生命週期
  syncProjectiles();                 // 投射物 mesh 依快照建/更新/移除
  syncItems(ts);                     // 道具 mesh 依快照建/更新/移除
  // 依 Net.entities 同步角色
  let builtThisFrame = 0;   // 一幀最多建一隻(LowPoly 程式生成較重)→ 攤平開場卡頓,自己角色第一幀不被別人建構拖累
  for (const id in Net.entities) {
    const e = Net.entities[id]; const s = e.s || {};
    let f = fighters.get(id);
    if (!f) {
      if (builtThisFrame >= 1 && id !== Net.self) continue;   // 別人的延到後續幀建;自己一定先建
      f = buildFighter(s.idx || 0, PLAYER_COLORS[(s.idx || 0) % PLAYER_COLORS.length], s.role, s.seed); fighters.set(id, f); scene.add(f.root); builtThisFrame++;
    }
    f.root.position.set(e.p[0], e.p[1] || 0, 0);
    if (typeof s.dir === 'number' && f.dir !== s.dir) setDir(f, s.dir);
    if (!f.animator.busy) f.animator.play(s.ko ? 'ko' : (s.anim || 'idle'));
    f.animator.setSpeed(Math.abs(s.vx || 0));   // 用權威水平速度推走跑循環(位置抖也穩)
    f.animator.update(dt);
    setHp(f, (s.hp != null ? s.hp : CFG.HP_MAX) / CFG.HP_MAX);
    f.root.visible = s.inv ? (Math.floor(ts / 100) % 2 === 0) : true;
    f.bar.quaternion.copy(camera.quaternion);
    // 命中紅閃(最優先),否則依狀態染色:冰=藍、石化=灰、睡=紫,無則清除。只在色變時寫 emissive(省每幀迴圈)
    const tint = s.ice ? 0x2a5cff : (s.stn ? 0x777777 : (s.slp ? 0x7a4dff : 0x000000));
    if (f.flashT > 0) { f.flashT -= dt; if (f.flashT <= 0) { setFlash(f, tint); f._tint = tint; } }
    else if (f._tint !== tint) { setFlash(f, tint); f._tint = tint; }
  }
  // 相機:手機跟自己;大螢幕看全景
  if (Net.surface === 'mobile' && Net.self && Net.entities[Net.self]) {
    const me = Net.entities[Net.self];
    camera.position.x += (me.p[0] * 0.9 - camera.position.x) * Math.min(1, dt * 6);
    camera.position.y += ((5 + (me.p[1] || 0) * 0.3) - camera.position.y) * Math.min(1, dt * 6);
    camera.position.z += (16 - camera.position.z) * Math.min(1, dt * 4);
    camera.lookAt(camera.position.x, 2.4, 0);
  } else {
    camera.position.set(0, 8, 26); camera.lookAt(0, 3, 0);
  }
  renderer.render(scene, camera);
});
GameAPI.onEnd(() => { try { renderer.dispose(); } catch (e) {} });

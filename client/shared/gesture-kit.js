// ============================================================
// GestureKit — 「LLM 寫動作」的手勢規格 → LowPoly animator clip 編譯器。
// 規格是純 JSON(不 eval 程式碼):關鍵格 + easing,與 lowpoly.js dataClip 同構。
//   spec = { name, label?, type:'oneshot'|'loop', dur, tracks:{ 'part.axis'|scalar: [[u,val,easing?],...] } }
//     oneshot:dur=總長秒,u∈0..1;播完自動回底層 loop(靠 mask 疊加,只主導自己寫的通道)
//     loop:dur=一個週期秒,u 循環;首尾值需相同才不跳(驗證會警告)
//   easing: lin | outQ | ioQ | outCubic(與 lowpoly.js 內建同款)
// 用法:const r = GestureKit.compile(spec); if (r.ok) { animator.clips[spec.name] = r.clip; animator.play(spec.name); }
// 雙模式:瀏覽器掛 window.GestureKit;node 直接 require(單元測試/伺服器驗證共用)。
// ============================================================
(function (global) {
  'use strict';

  const E = {
    lin: u => u,
    outQ: u => 1 - (1 - u) * (1 - u),
    ioQ: u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
    outCubic: u => 1 - Math.pow(1 - u, 3),
  };
  const PARTS = ['pelvis', 'spine', 'chest', 'neck', 'head', 'torso',
    'armL', 'elbowL', 'armR', 'elbowR', 'legL', 'kneeL', 'ankleL', 'legR', 'kneeR', 'ankleR'];
  const SCALARS = ['bob', 'lean', 'tilt', 'dropY', 'crouch'];
  const SCALES = ['sx', 'sy', 'sz'];

  function validChannel(ch) {
    if (SCALARS.includes(ch) || SCALES.includes(ch)) return true;
    const d = ch.indexOf('.');
    if (d < 0) return false;
    return PARTS.includes(ch.slice(0, d)) && ['x', 'y', 'z'].includes(ch.slice(d + 1));
  }

  // 與 lowpoly.js kf() 同款:區段線性 + 每段目標鍵的 easing
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
  // 與 lowpoly.js applyCh() 同款:旋轉/標量相加、縮放相乘
  function applyCh(p, ch, v) {
    if (ch === 'sx' || ch === 'sy' || ch === 'sz') { p[ch] *= v; return; }
    if (ch === 'bob' || ch === 'lean' || ch === 'tilt' || ch === 'dropY' || ch === 'crouch') { p[ch] += v; return; }
    const d = ch.indexOf('.');
    const part = ch.slice(0, d), ax = ch.slice(d + 1);
    if (p[part]) p[part][ax] += v;
  }

  function validate(spec) {
    const errs = [], warns = [];
    if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec 不是物件'] };
    if (typeof spec.name !== 'string' || !/^[a-z][a-z0-9_-]{0,30}$/i.test(spec.name)) errs.push('name 需為英數字串(字母開頭,≤31 字)');
    if (spec.type !== 'oneshot' && spec.type !== 'loop') errs.push("type 需為 'oneshot' 或 'loop'");
    const dur = +spec.dur;
    if (!(dur >= 0.1 && dur <= 10)) errs.push('dur 需在 0.1–10 秒');
    if (!spec.tracks || typeof spec.tracks !== 'object' || !Object.keys(spec.tracks).length) errs.push('tracks 不可為空');
    else for (const ch in spec.tracks) {
      if (!validChannel(ch)) { errs.push(`未知通道:${ch}`); continue; }
      const keys = spec.tracks[ch];
      if (!Array.isArray(keys) || keys.length < 2) { errs.push(`${ch}:至少 2 個關鍵格`); continue; }
      let prev = -1;
      for (const k of keys) {
        if (!Array.isArray(k) || k.length < 2 || typeof k[0] !== 'number' || typeof k[1] !== 'number') { errs.push(`${ch}:關鍵格需為 [u, 值, easing?]`); break; }
        if (k[0] < 0 || k[0] > 1 || k[0] < prev) { errs.push(`${ch}:u 需在 0–1 且遞增`); break; }
        prev = k[0];
        const lim = SCALES.includes(ch) ? [0.3, 2.5] : (SCALARS.includes(ch) ? [-1.5, 1.5] : [-3.2, 3.2]);
        if (k[1] < lim[0] || k[1] > lim[1]) { errs.push(`${ch}:值 ${k[1]} 超出安全範圍 ${lim[0]}..${lim[1]}`); break; }
        if (k[2] != null && !E[k[2]]) { errs.push(`${ch}:未知 easing '${k[2]}'(可用 lin/outQ/ioQ/outCubic)`); break; }
      }
      if (spec.type === 'loop' && keys.length >= 2) {
        const a = keys[0], b = keys[keys.length - 1];
        if (Math.abs(a[1] - b[1]) > 1e-6) warns.push(`${ch}:loop 首尾值不同(${a[1]} vs ${b[1]}),循環時會跳`);
      }
    }
    return { ok: errs.length === 0, errors: errs, warnings: warns };
  }

  function compile(spec) {
    const v = validate(spec);
    if (!v.ok) return v;
    const dur = +spec.dur, tracks = spec.tracks;
    let clip;
    if (spec.type === 'oneshot') {
      clip = {
        oneShot: true, dur,
        mask: Object.keys(tracks),   // 疊加遮罩:只主導自己寫的通道,其餘讓底層 loop 通過
        sample(c, p) { const u = Math.max(0, Math.min(1, c.t / dur)); for (const ch in tracks) applyCh(p, ch, kf(u, tracks[ch])); },
      };
    } else {
      clip = {
        oneShot: false, dur: 0,
        sample(c, p) { const u = ((c.t % dur) + dur) % dur / dur; for (const ch in tracks) applyCh(p, ch, kf(u, tracks[ch])); },
      };
    }
    return { ok: true, errors: [], warnings: v.warnings, clip };
  }

  const api = { validate, compile, PARTS, SCALARS, SCALES, EASINGS: Object.keys(E) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.GestureKit = api;
})(typeof window !== 'undefined' ? window : globalThis);

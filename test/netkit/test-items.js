// P3 道具/buff/天災/回合時鐘 單元測試。node test/netkit/test-items.js
const { buildFairySim } = require('../../server/modules/fairy-brawl-nk/src/sim.js');
const { CFG, SKILLS, ROLES } = require('../../server/modules/fairy-brawl-nk/src/config.js');
const IT = CFG.ITEMS;
let pass = 0, fail = 0;
const check = (n, c, d) => { console.log(`  ${c ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`); c ? pass++ : fail++; };
function mk() { const S = { emit() {} }; buildFairySim(S, CFG, SKILLS, ROLES); return S; }
function role(S, pid, ri, x) { S.spawn(pid); const e = S._ents[pid]; e.idx = ri; e.role = ROLES[ri]; e.inv = 0; if (x != null) e.x = x; return e; }
const RI = {}; ROLES.forEach((r, i) => RI[r] = i);
// 用固定 Math.random 讓 pickKind 決定性:c=0.2→red,0.3→blue,0.6→agi,0.8→pow,0.1→dis
function forceItem(S, c) { const old = Math.random; Math.random = () => c; for (let i = 0; i < 60 * 7 && S.snapshot().world.items.length === 0; i++) S.step(1 / 60); Math.random = old; return S.snapshot().world.items[0]; }
function pickBy(S, e) { e.x = IT.ISLAND_X; e.y = IT.ISLAND_Y; S.step(1 / 60); }   // 站上中央島 → 拾取

// 1) 首刷:約 FIRST 秒後場上出現道具
let S = mk(); role(S, 'a', RI.knight, -12); const it = forceItem(S, 0.6);
check('約 6s 首刷道具(kind=agi)', !!it && it.k === 'agi', it ? 'kind=' + it.k : '無');

// 2) 紅藥水治療
S = mk(); let A = role(S, 'a', RI.knight); A.hp = 20; forceItem(S, 0.2); pickBy(S, A);
check('紅藥水 +67%HP', A.hp === 20 + Math.round(CFG.HP_MAX * IT.HEAL_RATIO) || Math.abs(A.hp - (20 + CFG.HP_MAX * IT.HEAL_RATIO)) < 1, 'hp=' + A.hp);

// 3) 藍藥水:技能冷卻 ×0.5
S = mk(); let B = role(S, 'b', RI.knight); forceItem(S, 0.3); pickBy(S, B);
check('藍藥水 → bCd>0', B.bCd > 0, 'bCd=' + B.bCd.toFixed(0));
B.scd = 0; B.castT = 0; S.input('b', { skill: true }); S.step(1 / 60);
check('藍 buff 下 knight 冷卻減半(≈6)', Math.abs(B.scd - SKILLS.knight.cd * IT.CD_MUL) < 0.2, 'scd=' + B.scd.toFixed(1));

// 4) 敏捷藥水:移速 ×1.25
S = mk(); let G = role(S, 'g', RI.knight); forceItem(S, 0.6); pickBy(S, G);
check('敏捷藥水 → bSpd>0', G.bSpd > 0, 'bSpd=' + G.bSpd.toFixed(0));
S.input('g', { mx: 1 }); S.step(1 / 60);
check('敏 buff 下移速 ≈10', Math.abs(Math.abs(G.vx) - CFG.MOVE_SPEED * IT.SPD_MUL) < 0.1, 'vx=' + G.vx.toFixed(1));

// 5) 強化藥水:傷害 ×2
S = mk(); let P = role(S, 'p', RI.knight); forceItem(S, 0.8); pickBy(S, P);
check('強化藥水 → bPow>0', P.bPow > 0, 'bPow=' + P.bPow.toFixed(0));
let V = role(S, 'v', RI.witch, P.x + 1); V.y = P.y; V.inv = 0; V.hp = 100; P.cd = 0; P.dir = (V.x > P.x ? 1 : -1);
S.input('p', { atk: true }); S.step(1 / 60);
check('強 buff 下拳傷害 ×2(16)', V.hp === 100 - CFG.PUNCH.dmg * IT.ATK_MUL, 'hp=' + V.hp);

// 6) 天災火雨:非撿取者持續掉血,撿取者免疫
S = mk(); let D = role(S, 'd', RI.knight, -6); let E = role(S, 'e', RI.witch, 6); E.inv = 0;
forceItem(S, 0.1); pickBy(S, D); const eh0 = E.hp, dh0 = D.hp;
for (let i = 0; i < 60; i++) S.step(1 / 60);   // 1 秒火雨
check('天災 → 他人掉血', E.hp < eh0, `E ${eh0}→${E.hp.toFixed(0)}`);
check('天災 → 撿取者免疫', D.hp === dh0, `D ${dh0}→${D.hp.toFixed(0)}`);

// 7) 回合時鐘倒數
S = mk(); role(S, 'a', RI.knight); const t0 = S.snapshot().world.timeLeft;
for (let i = 0; i < 120; i++) S.step(1 / 60);
const t1 = S.snapshot().world.timeLeft;
check('回合倒數(timeLeft 遞減 ≈2s)', t0 === CFG.FIGHT_SECONDS && (t0 - t1) >= 1 && (t0 - t1) <= 3, `${t0}→${t1}`);

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

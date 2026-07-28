// P2 技能系統(瞬發類 + 狀態)單元測試。node test/netkit/test-skills.js
const { buildFairySim } = require('../../server/modules/fairy-brawl-nk/src/sim.js');
const { CFG, SKILLS, ROLES } = require('../../server/modules/fairy-brawl-nk/src/config.js');

let pass = 0, fail = 0;
const check = (n, c, d) => { console.log(`  ${c ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`); c ? pass++ : fail++; };
function mk() { const S = { _ev: [], emit(t, d) { this._ev.push({ t, d }); } }; buildFairySim(S, CFG, SKILLS, ROLES); return S; }
// 指定角色(idx→role);清 inv 讓可被命中;放定位置
function role(S, pid, ri, x) { S.spawn(pid); const e = S._ents[pid]; e.idx = ri; e.role = ROLES[ri]; e.inv = 0; if (x != null) e.x = x; return e; }
const RI = {}; ROLES.forEach((r, i) => RI[r] = i);

// 1) 治療(fairy)
let S = mk(); let A = role(S, 'a', RI.fairy); A.hp = 50; S.input('a', { skill: true }); S.step(1 / 60);
check('fairy 治療 +34%HP', A.hp === 50 + CFG.HP_MAX * SKILLS.fairy.ratio, 'hp=' + A.hp);

// 2) 範圍(knight)兩側都打到
S = mk(); let K = role(S, 'k', RI.knight, 0); let L = role(S, 'l', RI.robin, -2); let R = role(S, 'r', RI.prince, 2);
S.input('k', { skill: true }); S.step(1 / 60);
check('knight 旋風斬 全向命中(左右都掉血)', L.hp < 100 && R.hp < 100, `L=${L.hp} R=${R.hp}`);

// 3) 錐形(hood)只打前方
S = mk(); let H = role(S, 'h', RI.hood, 0); H.dir = 1; let Fr = role(S, 'fr', RI.knight, 3); let Bk = role(S, 'bk', RI.witch, -3);
S.input('h', { skill: true }); S.step(1 / 60);
check('hood 音波 只打前方', Fr.hp < 100 && Bk.hp === 100, `前=${Fr.hp} 後=${Bk.hp}`);

// 4) 狀態範圍(princess)施睡 + 睡眠定身
S = mk(); let P = role(S, 'p', RI.princess, 0); let T = role(S, 't', RI.knight, 2);
S.input('p', { skill: true }); S.step(1 / 60);
check('princess 催眠 → 目標 slp>0', T.slp > 0, 'slp=' + T.slp.toFixed(2));
const tx = T.x; S.input('t', { mx: 1 }); S.step(1 / 60);
check('睡眠中不吃移動輸入(x 不變)', Math.abs(T.x - tx) < 1e-6, 'dx=' + (T.x - tx).toFixed(3));

// 5) 閃避(prince)位移 + 無敵
S = mk(); let D = role(S, 'd', RI.prince, 0); S.input('d', { skill: true }); S.step(1 / 60);
check('prince 閃避 位移≈6 + 無敵', Math.abs(Math.abs(D.x) - SKILLS.prince.dist) < 0.2 && D.inv > 0, `x=${D.x.toFixed(1)} inv=${D.inv.toFixed(1)}`);

// 6) 閃現(robin)瞬移到離眾人最遠處
S = mk(); let Rb = role(S, 'rb', RI.robin, 0); role(S, 'e1', RI.knight, -13); role(S, 'e2', RI.witch, 13);
S.input('rb', { skill: true }); S.step(1 / 60);
check('robin 閃現 → 遠離所有人(|x|<6 的中間帶)', Math.abs(Rb.x) < 6, 'x=' + Rb.x.toFixed(1));

// 7) 石化(dwarf)自身無敵 + 免傷
S = mk(); let W = role(S, 'w', RI.dwarf, 0); S.input('w', { skill: true }); S.step(1 / 60);
check('dwarf 石化 → stone>0 + 無敵', W.stone > 0 && W.inv > 0, `stone=${W.stone.toFixed(1)}`);
let AT = role(S, 'at', RI.knight, W.x - 1); AT.dir = 1; AT.cd = 0; W.hp = 100;
S.input('at', { atk: true }); S.step(1 / 60);
check('石化中免疫近戰(hp 不掉)', W.hp === 100, 'hp=' + W.hp);

// 8) 冷卻:施法後不可立即再施
S = mk(); let KC = role(S, 'kc', RI.knight, 0); S.input('kc', { skill: true }); S.step(1 / 60);
const casts1 = S._ev.filter(e => e.t === 'cast').length;
S.input('kc', { skill: true }); S.step(1 / 60);
const casts2 = S._ev.filter(e => e.t === 'cast').length;
check('冷卻中不可再施(cast 事件不增加)', KC.scd > 0 && casts2 === casts1, `scd=${KC.scd.toFixed(1)} casts=${casts2}`);

// 9) 施法鎖:castTime 期間不能出拳
S = mk(); let KL = role(S, 'kl', RI.knight, 0); let V = role(S, 'v', RI.witch, 12); // V 在 aoe 範圍外
S.input('kl', { skill: true }); S.step(1 / 60);
check('knight 施法後 castT>0', KL.castT > 0, 'castT=' + KL.castT.toFixed(2));
KL.cd = 0; const atk1 = S._ev.filter(e => e.t === 'atk').length;
S.input('kl', { atk: true }); S.step(1 / 60);
check('施法鎖期間出拳無效(atk 事件不增加)', S._ev.filter(e => e.t === 'atk').length === atk1, '');

// 10) 投射物:火球(witch proj)飛行命中
S = mk(); let Wi = role(S, 'wi', RI.witch, 0); Wi.dir = 1; let Tg = role(S, 'tg', RI.knight, 5); Tg.y = 0;
S.input('wi', { skill: true });
let hitProj = false; for (let i = 0; i < 60 && !hitProj; i++) { S.step(1 / 60); if (Tg.hp < 100) hitProj = true; }
check('witch 火球 飛行命中(dmg16)', Tg.hp === 100 - SKILLS.witch.dmg, 'hp=' + Tg.hp);

// 11) 冰柱(wizard proj)命中 → 施冰
S = mk(); let Wz = role(S, 'wz', RI.wizard, 0); Wz.dir = 1; let Ti = role(S, 'ti', RI.knight, 5); Ti.y = 0;
S.input('wz', { skill: true });
for (let i = 0; i < 60 && Ti.hp === 100; i++) S.step(1 / 60);
check('wizard 冰柱 命中 → 傷害 + 冰凍', Ti.hp < 100 && Ti.ice > 0, `hp=${Ti.hp} ice=${Ti.ice.toFixed(1)}`);

// 12) 三重箭(elf multi)射出 3 支
S = mk(); let El = role(S, 'el', RI.elf, 0); El.dir = 1; S.input('el', { skill: true }); S.step(1 / 60);
let np = S.snapshot().world.projs.length;
check('elf 三重箭 射出 3 支投射物', np === 3, 'projs=' + np);

// 13) 泡泡環(frog ring)擴張命中
S = mk(); let Fg = role(S, 'fg', RI.frog, 0); let Tr = role(S, 'tr', RI.knight, 3); Tr.y = 0;
S.input('fg', { skill: true });
for (let i = 0; i < 90 && Tr.hp === 100; i++) S.step(1 / 60);
check('frog 泡泡環 擴張命中(dmg10)', Tr.hp === 100 - SKILLS.frog.dmg, 'hp=' + Tr.hp);

console.log(`\n結果:${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);

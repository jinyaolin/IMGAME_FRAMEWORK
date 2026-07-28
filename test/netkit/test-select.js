// 選角參數 → sim 生成 用選定角色/外觀。node test/netkit/test-select.js
const { buildFairySim } = require('../../server/modules/fairy-brawl-nk/src/sim.js');
const { CFG, SKILLS, ROLES } = require('../../server/modules/fairy-brawl-nk/src/config.js');
let pass = 0, fail = 0; const check = (n, c, d) => { console.log(`  ${c ? '✔' : '✘'} ${n}${d ? ' — ' + d : ''}`); c ? pass++ : fail++; };
function mk(world) { const S = { emit() {} }; buildFairySim(S, CFG, SKILLS, ROLES); if (S.init) S.init(world); return S; }

let S = mk({ players: { p1: { attrs: { ready: true, role: 'wizard', seed: 42 } } } });
S.spawn('p1'); const e = S._ents.p1;
check('選定 role/seed 生效', e.role === 'wizard' && e.seed === 42, `role=${e.role} seed=${e.seed}`);
const s = S.snapshot().ents.p1.s;
check('技能對應 wizard 冰柱術', s.skn === SKILLS.wizard.name, 'skn=' + s.skn);
check('快照帶 role/seed 給 render', s.role === 'wizard' && s.seed === 42, `${s.role}/${s.seed}`);

S = mk({ players: { p1: { attrs: { role: 'wizard', seed: 42 } } } });   // ready 未設 → 不採用
S.spawn('p1'); check('未確定 → 退回 idx 預設(knight)', S._ents.p1.role === ROLES[0], S._ents.p1.role);

S = mk({}); S.spawn('a'); S.spawn('b');   // 無 world 玩家資料 → 舊行為(idx 輪替)
check('無選角資料 → idx 輪替不破壞', S._ents.a.role === ROLES[0] && S._ents.b.role === ROLES[1], `${S._ents.a.role},${S._ents.b.role}`);
console.log(`\n結果:${pass} 通過,${fail} 失敗`); process.exit(fail ? 1 : 0);

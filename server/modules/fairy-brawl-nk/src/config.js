// ═══════════════════════════════════════════════════════════════
// 童話大亂鬥 (NetKit) — 共用常數/資料(target: 'shared')
// 雙模式:瀏覽器端這份檔的頂層宣告會併入 sim+render 的共用作用域;
//         node 端(單元測試/組裝腳本)則走底部的 module.exports。
// 這是 CFG 的「單一真相來源」——sim(權威)、render(畫面)、node 測試全讀同一份,
// 不再有 fairy-sim.js 與組裝腳本各自一份 CFG 而數值打架的問題。
// ═══════════════════════════════════════════════════════════════
const CFG = {
  GRAVITY: 30, MOVE_SPEED: 8, AIR_SPEED: 6.5, JUMP_VEL: 14, JUMP2_VEL: 13.5,
  HP_MAX: 100, RESPAWN_TIME: 3, INVINCIBLE_TIME: 2, HIT_STUN: 0.32,
  // 近戰(對齊原版 fairy-brawl):拳快輕、腳慢重
  PUNCH: { range: 1.9, vrange: 2.8, dmg: 8, cd: 0.35, knock: 4.5, lift: 2 },
  KICK: { range: 2.5, vrange: 3.5, dmg: 15, cd: 0.62, knock: 9, lift: 4 },
  X_MIN: -16.5, X_MAX: 16.5,
  SPAWN: [-12, -6, 0, 6, 12, -9, 3, 9],
  PLATFORMS: [{ x: -8.5, y: 4.6, w: 2.3 }, { x: 8.5, y: 4.6, w: 2.3 }, { x: 0, y: 7.2, w: 2.0 }],
  CHAR_H: 2.35,
  FIGHT_SECONDS: 180,
  // 道具(中央浮島刷新;host 權威):藥水 buff 30s,天災下火雨
  ITEMS: {
    FIRST: 6, SPAWN_MIN: 14, SPAWN_MAX: 22,     // 首刷 6s,之後 14~22s(場上有道具則暫停)
    ISLAND_X: 0, ISLAND_Y: 7.2, PICK_DX: 1.4, PICK_DY: 1.7,   // 站中央島撿
    BUFF_SECS: 30, CD_MUL: 0.5, SPD_MUL: 1.25, ATK_MUL: 2, HEAL_RATIO: 0.67,
    DISASTER_W: 0.18, RAIN_SECS: 10, RAIN_DPS: 4,
  },
};
const ROLES = ['knight', 'witch', 'troll', 'frog', 'princess', 'wizard', 'dwarf', 'robin', 'fairy', 'elf', 'hood', 'prince'];
// 每角一技(對齊原版 fairy-brawl)。type 決定 sim 的處理路徑;instant 類(aoe/statusAoe/cone/heal/dodge/blink/stone)
// 當步結算;proj/multi/ring 為投射物(P2 下一階段實作),目前先觸發冷卻 + cast 特效。
const SKILLS = {
  knight:   { name: '旋風斬', cd: 12, type: 'aoe',       range: 3.4, vrange: 3.0, dmg: 14, knock: 8,  lift: 4, cast: 0.55 },
  troll:    { name: '爆炸術', cd: 18, type: 'aoe',       range: 4.6, vrange: 3.4, dmg: 20, knock: 12, lift: 7, cast: 0.40 },
  witch:    { name: '火球術', cd: 9,  type: 'proj',      speed: 15, dmg: 16, knock: 6, lift: 3 },
  wizard:   { name: '冰柱術', cd: 16, type: 'proj',      speed: 11, dmg: 6,  knock: 2, lift: 1, status: 'ice', dur: 5 },
  elf:      { name: '三重箭', cd: 10, type: 'multi',     n: 3, speed: 19, dmg: 8, knock: 3, lift: 1, vspread: 2.5 },
  frog:     { name: '泡泡術', cd: 12, type: 'ring',      maxR: 4.8, dur: 1.0, vrange: 2.8, dmg: 10, knock: 6, lift: 3 },
  hood:     { name: '音波攻擊', cd: 10, type: 'cone',    range: 5.5, widen: 0.55, dmg: 12, knock: 7, lift: 2 },
  princess: { name: '催眠術', cd: 18, type: 'statusAoe', range: 4.5, vrange: 3.2, status: 'slp', dur: 3, cast: 0.6 },
  fairy:    { name: '治療術', cd: 15, type: 'heal',      ratio: 0.34, cast: 0.40 },
  prince:   { name: '閃避術', cd: 8,  type: 'dodge',     dist: 6, invuln: 0.7 },
  robin:    { name: '閃現術', cd: 12, type: 'blink',     invuln: 0.4 },
  dwarf:    { name: '石化術', cd: 25, type: 'stone',     dur: 10, moveMul: 0.5 },
};
function skillForRole(role) { return SKILLS[role] || SKILLS.knight; }
const PLAYER_COLORS = ['#ff5252', '#4d9bff', '#52e05a', '#ffc93d', '#c77dff', '#ff9f43', '#2bcbba', '#fd79a8'];
// idx → 角色+造型 seed(所有端一致:同 idx 永遠同角色同造型)
function specForIdx(idx) { idx = idx | 0; return { role: ROLES[idx % ROLES.length], seed: 1000 + idx * 137 }; }

if (typeof module !== 'undefined' && module.exports) module.exports = { CFG, ROLES, PLAYER_COLORS, specForIdx, SKILLS, skillForRole };

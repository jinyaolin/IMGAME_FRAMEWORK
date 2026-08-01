// ============================================================
// 怪物庫 — Monster Lab 產出的怪物規格(LowMonster JSON)持久化,
// 存 server/monsters/<name>.json,一檔一物種。遊戲端 GET /api/monsters
// 全量載入 + LowMonster.build(spec,{seed}) 生成個體 → 當遊戲怪物用。
// save 除了 validate 還會「真的 build 一次」(node 直接跑 vendored THREE),
// 回傳 bbox/部件數等數值 stats — 給 Kimi 的數值回饋迴路(它看不到畫面)。
// ============================================================
const fs = require('fs');
const path = require('path');
const LowMonster = require('../client/shared/vendor/lowmonster.js');

const DIR = path.join(__dirname, 'monsters');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const SAFE = /^[a-z][a-z0-9_-]{0,39}$/;   // 與 LowMonster name 規則一致(兼防路徑跳脫)

function atomicWrite(fp, obj) {
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, fp);
}

// build 需要 THREE;lazy 載一次(r149 UMD 可直接 require)
function ensureThree() {
  if (!globalThis.THREE) {
    try { globalThis.THREE = require('../client/shared/vendor/three.min.js'); } catch (e) {}
  }
  return !!globalThis.THREE;
}

function list() {
  const out = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))); } catch (e) {}
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
}
function get(name) {
  if (!SAFE.test(String(name))) return null;
  const fp = path.join(DIR, name + '.json');
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return null; }
}
// 存檔:validate + 實際 build 一次拿 stats;回 {ok, errors, warnings, stats}
function save(spec) {
  const v = LowMonster.validate(spec);
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings };
  if (!SAFE.test(spec.name)) return { ok: false, errors: ['name 不合法(小寫開頭英數/底線/連字號)'], warnings: [] };
  let stats = null;
  if (ensureThree()) {
    try { stats = LowMonster.build(spec, { seed: 1 }).stats; }
    catch (e) { return { ok: false, errors: ['build 失敗:' + e.message], warnings: v.warnings }; }
  }
  atomicWrite(path.join(DIR, spec.name + '.json'), spec);
  return { ok: true, errors: [], warnings: v.warnings, stats };
}
function remove(name) {
  if (!SAFE.test(String(name))) return false;
  const fp = path.join(DIR, name + '.json');
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  return true;
}

// ── 概念圖(img2three 流程):server/monsters/concepts/<name>.png,與怪物同名綁定 ──
const CONCEPT_DIR = path.join(DIR, 'concepts');
if (!fs.existsSync(CONCEPT_DIR)) fs.mkdirSync(CONCEPT_DIR, { recursive: true });

function saveConcept(name, pngBuf) {
  if (!SAFE.test(String(name))) throw new Error('概念圖名稱不合法(小寫英數/底線/連字號,字母開頭):' + name);
  const fp = path.join(CONCEPT_DIR, name + '.png');
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, pngBuf);
  fs.renameSync(tmp, fp);
  return fp;
}
function conceptFile(name) {
  if (!SAFE.test(String(name))) return null;
  const fp = path.join(CONCEPT_DIR, name + '.png');
  return fs.existsSync(fp) ? fp : null;
}

// ── 三視角渲染圖(render_monster 產出,驗證迴圈用)──
const RENDER_DIR = path.join(DIR, 'renders');
if (!fs.existsSync(RENDER_DIR)) fs.mkdirSync(RENDER_DIR, { recursive: true });
function saveRender(name, pngBuf) {
  if (!SAFE.test(String(name))) throw new Error('名稱不合法:' + name);
  const fp = path.join(RENDER_DIR, name + '.png');
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, pngBuf);
  fs.renameSync(tmp, fp);
  return fp;
}
function renderFile(name) {
  if (!SAFE.test(String(name))) return null;
  const fp = path.join(RENDER_DIR, name + '.png');
  return fs.existsSync(fp) ? fp : null;
}

module.exports = { list, get, save, remove, DIR, saveConcept, conceptFile, saveRender, renderFile };

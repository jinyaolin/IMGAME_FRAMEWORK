// ============================================================
// 動作手勢庫 — Gesture Lab 產出的動作規格(GestureKit JSON)持久化,
// 存 server/gestures/<name>.json,一檔一動作。遊戲端可 GET /api/gestures
// 全量載入 + GestureKit.compile 註冊到 animator → 當遊戲內建動作用。
// 寫入走 tmp+rename(與 manifest 同款 atomic 慣例)。
// ============================================================
const fs = require('fs');
const path = require('path');
const GestureKit = require('../client/shared/gesture-kit.js');

const DIR = path.join(__dirname, 'gestures');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const SAFE = /^[a-z][a-z0-9_-]{0,30}$/i;   // 與 GestureKit name 規則一致(兼防路徑跳脫)

function atomicWrite(fp, obj) {
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, fp);
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
// 存檔(先過 GestureKit 驗證);回 {ok, errors, warnings}
function save(spec) {
  const v = GestureKit.validate(spec);
  if (!v.ok) return v;
  if (!SAFE.test(spec.name)) return { ok: false, errors: ['name 不合法'], warnings: [] };
  atomicWrite(path.join(DIR, spec.name + '.json'), spec);
  return v;
}
function remove(name) {
  if (!SAFE.test(String(name))) return false;
  const fp = path.join(DIR, name + '.json');
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  return true;
}

module.exports = { list, get, save, remove, DIR };

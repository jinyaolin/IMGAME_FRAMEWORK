'use strict';
// 模組作者可見性驗證:createdBy 記錄 + 非 superuser 作者可見自己的未開放模組
// 用法:先起測試伺服器(BASE_PATH=/labs/game、auth 開),再:
//   ORIGIN=http://127.0.0.1:3100 node test-module-author.js
//
// 伺服器對本機直連放行(loopback bypass),所以全部請求帶 X-Forwarded-For 模擬反代,
// 才會走 cookie 驗證、拿到真實 userId。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:3123';
const BASE = '/labs/game';
const XFF = { 'X-Forwarded-For': '203.0.113.9' };
const MODULES_DIR = path.join(__dirname, 'server', 'modules');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

function mintCookie(userId) {
  const env = fs.readFileSync('/root/imgame/.env', 'utf8');
  const secret = env.match(/^AUTH_COOKIE_SECRET=(.+)$/m)[1].trim();
  const payload = `u=${userId};exp=${Date.now() + 3600e3}`;
  const sig = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `zai_session=${encodeURIComponent(payload + '.' + sig)}`;
}

const hdr = (cookie) => ({ 'Content-Type': 'application/json', Cookie: cookie, ...XFF });
const api = (p, opts = {}) => fetch(ORIGIN + BASE + '/api' + p, opts);

const TEST_ID = 'authvis-test';
const CLONE_ID = 'authvis-clone';
const MINI_MANIFEST = {
  id: TEST_ID, name: '作者可見性測試', description: 'test', version: '1.0',
  minPlayers: 1, maxPlayers: 4,
  stages: [{ id: 's1', type: 'result', name: '結果', enabled: true }],
};

(async () => {
  const A = mintCookie('author-a@example.com');       // 一般使用者 A(作者)
  const B = mintCookie('other-b@example.com');        // 一般使用者 B
  const S = mintCookie('jinyao.lin@gmail.com');       // superuser

  // 殘留清理(前次失敗留下的)
  for (const id of [TEST_ID, CLONE_ID]) fs.rmSync(path.join(MODULES_DIR, id), { recursive: true, force: true });

  // 測試基準:先由 superuser 開放 unogame(測試伺服器的模組目錄與正式環境隔離)
  let r0 = await api('/modules/unogame/publish', { method: 'POST', headers: hdr(S), body: JSON.stringify({ published: true }) });
  if (r0.status !== 200) { console.error('前置 publish unogame 失敗', r0.status); process.exit(1); }

  console.log('— A(非 superuser)建立新模組 —');
  let r = await api(`/modules/${TEST_ID}/manifest`, { method: 'PUT', headers: hdr(A), body: JSON.stringify({ manifest: MINI_MANIFEST }) });

  let d = await r.json();
  check('PUT 新模組 200', r.status === 200, `status=${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  const onDisk = JSON.parse(fs.readFileSync(path.join(MODULES_DIR, TEST_ID, 'manifest.json'), 'utf8'));
  check('磁碟 manifest 記 createdBy=A', onDisk.createdBy === 'author-a@example.com', `createdBy=${onDisk.createdBy}`);
  check('回傳 modules 清單含自己的模組', (d.modules || []).some(m => m.id === TEST_ID));

  console.log('— 清單可見性 —');
  const listAs = async (c) => (await (await api('/modules', { headers: hdr(c) })).json()).map(m => m.id);
  check('A 的清單看得到', (await listAs(A)).includes(TEST_ID));
  check('B 的清單看不到', !(await listAs(B)).includes(TEST_ID));
  check('superuser 清單看得到', (await listAs(S)).includes(TEST_ID));
  check('B 的清單仍有已開放模組', (await listAs(B)).includes('unogame'));

  console.log('— 單一模組讀取/開房 —');
  r = await api(`/modules/${TEST_ID}`, { headers: hdr(A) });
  check('A 讀 manifest 200', r.status === 200);
  r = await api(`/modules/${TEST_ID}`, { headers: hdr(B) });
  check('B 讀 manifest 403', r.status === 403, `status=${r.status}`);
  r = await api('/rooms', { method: 'POST', headers: hdr(A), body: JSON.stringify({ moduleId: TEST_ID }) });
  check('A 可用自己的模組開房', r.status === 200, `status=${r.status}`);
  r = await api('/rooms', { method: 'POST', headers: hdr(B), body: JSON.stringify({ moduleId: TEST_ID }) });
  check('B 用該模組開房 403', r.status === 403, `status=${r.status}`);

  console.log('— 作者欄位不可冒名 —');
  r = await api(`/modules/${TEST_ID}/manifest`, { method: 'PUT', headers: hdr(B), body: JSON.stringify({ manifest: { ...MINI_MANIFEST, createdBy: 'other-b@example.com' } }) });
  d = await r.json();
  const after = JSON.parse(fs.readFileSync(path.join(MODULES_DIR, TEST_ID, 'manifest.json'), 'utf8'));
  check('他人覆寫存檔後 createdBy 仍是 A', after.createdBy === 'author-a@example.com', `createdBy=${after.createdBy}`);

  console.log('— clone:作者 = clone 者、published 不繼承 —');
  r = await api('/modules/unogame/clone', { method: 'POST', headers: hdr(B), body: JSON.stringify({ newId: CLONE_ID, newName: 'B 的複製' }) });
  d = await r.json();
  check('B clone 已開放模組 200', r.status === 200, `status=${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  const cloneDisk = JSON.parse(fs.readFileSync(path.join(MODULES_DIR, CLONE_ID, 'manifest.json'), 'utf8'));
  check('clone createdBy=B', cloneDisk.createdBy === 'other-b@example.com', `createdBy=${cloneDisk.createdBy}`);
  check('clone 不繼承 published', cloneDisk.published !== true, `published=${cloneDisk.published}`);
  check('B 清單看得到自己的 clone', (await listAs(B)).includes(CLONE_ID));
  check('A 清單看不到 B 的 clone', !(await listAs(A)).includes(CLONE_ID));
  r = await api(`/modules/${TEST_ID}/clone`, { method: 'POST', headers: hdr(B), body: JSON.stringify({ newId: 'authvis-x', newName: 'x' }) });
  check('B 不能 clone 看不到的模組(403)', r.status === 403, `status=${r.status}`);

  console.log('— superuser publish 後 B 可見 —');
  r = await api(`/modules/${TEST_ID}/publish`, { method: 'POST', headers: hdr(S), body: JSON.stringify({ published: true }) });
  check('superuser 開放 200', r.status === 200, `status=${r.status}`);
  check('開放後 B 清單看得到', (await listAs(B)).includes(TEST_ID));

  // 清理
  for (const id of [TEST_ID, CLONE_ID, 'authvis-x']) fs.rmSync(path.join(MODULES_DIR, id), { recursive: true, force: true });

  console.log(`\n結果:${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

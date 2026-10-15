// 分享 / 共編 / 複製 的瀏覽器端回歸測試(真的開 Chrome 點按鈕)
//   node test-share-flow.js        # 需要 server 在跑
//
// 它會從主站的使用者名冊借三個真實帳號(A 主編 / B 共編 / C 外人),建兩個 zz- 開頭的
// 暫時模組,跑完自己刪掉。預期 27/27。
//
// ⚠ 寫這類測試踩過、值得記住的四個坑:
//   1. puppeteer 的 cookie 是**整個瀏覽器共用**的,不是每頁一份 → 多使用者一定要
//      每人一個 browser context,否則後開的頁面會蓋掉先前的登入(會得到假的 403)。
//   2. 不帶 X-Forwarded-For 的 loopback 請求被當成內部呼叫 → 一律 superuser,測試全白做。
//   3. 第一個帳號是 superuser,看得到一切 → 拿它當「原作者」測隔離永遠是假陽性。
//   4. 上一輪若中途失敗會留下 zz- 殘骸,接著 clone 回 409,而「副本建立成功」會讀到
//      舊檔變成假陽性 → 前置清理要用兩個身分各刪一次,並在殘骸還在時直接中止。
//
const puppeteer = require('/root/imgame/node_modules/puppeteer');
const crypto = require('crypto'), fs = require('fs');
const { execFileSync } = require('child_process');

const ORIGIN = 'http://127.0.0.1:3000';
const BASE = ORIGIN + '/labs/game';
const SECRET = fs.readFileSync('/root/imgame/.env', 'utf8').match(/^AUTH_COOKIE_SECRET=(.+)$/m)[1].trim();
const tok = (u) => { const p = `u=${u};exp=${Date.now() + 3600e3}`;
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p, 'utf8').digest('hex'); };

const users = JSON.parse(execFileSync('/usr/bin/sqlite3',
  ['-readonly', '-json', '/root/zai_studio-main/data/index.db',
   'SELECT id, email FROM users ORDER BY created_at LIMIT 4;'], { encoding: 'utf8' }));
const [, A, B, C] = users;                 // 跳過第一個(superuser)
const mask = (e) => String(e).replace(/(.{2})[^@]*(@.*)/, '$1***$2');
const SRC = 'zz-ui-src', CP = 'zz-ui-copy';
const rd = (id) => { try { return JSON.parse(fs.readFileSync(`/root/imgame/server/modules/${id}/manifest.json`, 'utf8')); } catch { return null; } };

const results = [];
const check = (label, pass, detail) => {
  results.push({ label, pass });
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
};

async function openEditor(browser, uid, label) {
  process.stdout.write(`    (開 ${label} 的編輯器…)\n`);
  // ⚠ cookie 在 puppeteer 裡是**整個瀏覽器共用**的,不是每頁一份 ——
  // 多使用者測試必須每人一個 browser context,否則後開的頁面會蓋掉先前的登入,
  // 先前那頁之後的請求就帶著別人的身分(會得到看起來像權限 bug 的假 403)。
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.ctx = ctx;
  page.setDefaultTimeout(15000);
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push('pageerror: ' + e.message));
  page.on('dialog', async (d) => {   // prompt 問 ID 給 ID、問名稱給名稱;confirm 一律同意
    const m = d.message();
    await d.accept(m.includes('ID') ? CP : (/名稱/.test(m) ? 'B 自己的專案' : undefined));
  });
  // console 的 404 訊息不含 URL,所以改從 response 判斷,才濾得掉既有的無害 404
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon\.ico|\/api\/modules\/[^/]+\/(server|notes)$/.test(r.url())) page.errs.push(`${r.status()} ${r.url()}`);
  });
  await page.setCookie({ name: 'zai_session', value: encodeURIComponent(tok(uid)), domain: '127.0.0.1', path: '/' });
  // 不帶 X-Forwarded-For 的 loopback 會被當成內部呼叫 → 一律 superuser,測試就白做了
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '203.0.113.9' });
  await page.goto(BASE + '/editor/', { waitUntil: 'networkidle0' });
  page.label = label;
  return page;
}

// 用文字找按鈕來點(模擬使用者真的看到字才按)
async function clickByText(page, selector, text, opts = {}) {
  const found = await page.evaluate((sel, t) => !![...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t)), selector, text);
  if (!found) throw new Error(`點不到「${text}」(${selector})`);
  const click = page.evaluate((sel, t) => {
    [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t)).click();
  }, selector, text);
  // prompt()/confirm() 在頁面裡是**同步阻塞**的 → 這種按鈕不能 await evaluate,
  // 不然 evaluate 要等對話框處理完才回來,期間所有 evaluate(含 waitFor 的輪詢)都排在後面。
  await click;
  await new Promise((r) => setTimeout(r, opts.wait || 600));
}


// 等某個條件在頁面上成立(固定 sleep 會隨機失敗)
async function waitFor(page, fn, what, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`等不到:${what}`);
}

const sidebarIds = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.mod-item')].map((e) => e.querySelector('.mi-id')?.textContent.trim()).filter(Boolean));

const shareText = (page) => page.evaluate(() => document.getElementById('cfgShare').innerText.replace(/\n+/g, ' | '));

// 保險:卡住的話自己中斷,不要無限掛著
const GUARD = setTimeout(() => { console.error('\n⏱ 100 秒還沒跑完,自己中斷'); process.exit(3); }, 100000);

(async () => {
  // ── 前置:用 API 建一個屬於 A 的模組(建立流程本身已另外測過)
  const H = (u) => ({ 'Content-Type': 'application/json',
    Cookie: `zai_session=${encodeURIComponent(tok(u))}`, 'X-Forwarded-For': '203.0.113.9' });
  for (const id of [SRC, CP]) for (const who of [A, B])
    await fetch(`${BASE}/api/modules/${id}`, { method: 'DELETE', headers: H(who.id) }).catch(() => {});
  for (const id of [SRC, CP]) if (fs.existsSync(`/root/imgame/server/modules/${id}`))
    throw new Error(`前一輪的殘骸沒清掉:${id} —— 不清掉的話 clone 會 409,而「副本建立成功」會讀到舊檔變成假陽性`);
  await fetch(`${BASE}/api/modules/${SRC}/manifest`, { method: 'PUT', headers: H(A.id),
    body: JSON.stringify({ manifest: { id: SRC, name: 'A 的課堂專案', version: '1.0.0', minPlayers: 1, maxPlayers: 4,
      stages: [{ id: 's1', name: '玩', type: 'result', enabled: true, advance: { trigger: 'host' } }] } }) });

  console.log(`帳號:A(主編)=${mask(A.email)}  B(共編)=${mask(B.email)}  C(外人)=${mask(C.email)}`);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  // ═══ 1. A 在瀏覽器裡把 B 加進共編 ═══
  console.log('\n【1】A 開編輯器 → 點模組 → 點「🤝 分享」→ 打 B 的 email → 按「加入共編」');
  const pa = await openEditor(browser, A.id, 'A');
  check('A 不是 superuser', !(await pa.evaluate(() => fetch('/labs/game/api/me').then((r) => r.json()).then((d) => d.superuser))));
  check('A 的側邊欄看得到自己的模組', (await sidebarIds(pa)).includes(SRC));
  await clickByText(pa, '.mod-item', SRC);
  await clickByText(pa, '.cfg-tab', '分享');
  check('分享分頁打開了', await pa.evaluate(() => document.getElementById('cfgShare').classList.contains('active')));
  check('A 看得到加入輸入框', await pa.evaluate(() => !!document.getElementById('shareEmail')));
  await pa.type('#shareEmail', B.email);
  await clickByText(pa, 'button', '加入共編');
  const t1 = await shareText(pa);
  check('名單出現 B', t1.includes(B.email), mask(t1).slice(0, 150));
  check('磁碟上也寫進去了', (rd(SRC).collaborators || []).some((c) => c.userId === B.id));
  check('沒有 pageerror', pa.errs.length === 0, pa.errs.join(' | '));

  // ═══ 2. B 看得到、改得動,但不能管名單 ═══
  console.log('\n【2】B 開編輯器:模組應該出現在清單、可以改並儲存、但分享分頁沒有控制項');
  const pb = await openEditor(browser, B.id, 'B');
  check('B 的側邊欄出現 A 分享的模組', (await sidebarIds(pb)).includes(SRC));
  await clickByText(pb, '.mod-item', SRC);
  await clickByText(pb, '.cfg-tab', '分享');
  check('B 看得到名單但沒有輸入框', await pb.evaluate(() => !document.getElementById('shareEmail')));
  check('B 沒有「移除」鈕', !(await shareText(pb)).includes('移除'));
  check('UI 有說明只有作者能管理', (await shareText(pb)).includes('只有作者能管理'));
  // B 真的改內容並儲存
  await pb.evaluate(() => { onMetaChange('name', 'B 改過的名字'); });
  await new Promise((r) => setTimeout(r, 300));
  await clickByText(pb, 'button', '儲存（覆寫原檔）');
  await new Promise((r) => setTimeout(r, 900));
  check('B 儲存成功(磁碟上的名稱變了)', rd(SRC).name === 'B 改過的名字', rd(SRC).name);
  check('B 存檔沒有把自己加進共編名單以外的東西', (rd(SRC).collaborators || []).length === 1);

  // ═══ 3. B 用「另存為新模組」開自己的專案 ═══
  console.log('\n【3】B 按「📦 另存為新模組」→ 副本該完全屬於 B');
  await clickByText(pb, 'button', '另存為新模組', { dialogs: true, wait: 2500 });
  console.log(`    B 的狀態:currentId=${await pb.evaluate(() => currentId)} edIdTag="${await pb.evaluate(() => document.getElementById('edIdTag')?.textContent)}" isDirty=${await pb.evaluate(() => isDirty())}`);
  const toastTxt = await pb.evaluate(() => [...document.querySelectorAll('*')].map(e => e.className).filter(c => typeof c === 'string' && c.includes('toast')).join(','));
  console.log(`    toast 類別:${toastTxt || '(無)'}  錯誤:${pb.errs.slice(-2).join(' | ') || '無'}`);
  await waitFor(pb, () => document.getElementById('edIdTag')?.textContent.trim() === 'zz-ui-copy',
                '編輯器切到副本', 10000).catch((e) => console.log('    (' + e.message + ')'));
  const cp = rd(CP);
  check('副本建立成功(且是這一輪建的)', !!cp && cp.name === 'B 自己的專案', cp ? cp.name : '(沒建出來)');
  if (cp) {
    check('副本作者 = B', cp.createdBy === B.id, cp.createdBy);
    check('副本沒有繼承共編名單', !cp.collaborators || cp.collaborators.length === 0, JSON.stringify(cp.collaborators || []));
    check('副本沒有繼承 published', cp.published === undefined);
  }
  await clickByText(pb, '.cfg-tab', '分享');
  const ownCopy = await waitFor(pb, () => !!document.getElementById('shareEmail'), '副本的分享輸入框').then(() => true).catch(() => false);
  check('B 在自己的副本上變成可管理分享', ownCopy,
        ownCopy ? '' : await shareText(pb).then((t) => t.slice(0, 120)));
  const ownerLine = await pb.evaluate(() => {
    const t = document.getElementById('cfgShare').innerText;
    const i = t.indexOf('作者');
    return i < 0 ? '' : t.slice(i, i + 80).split('\n').slice(0, 2).join(' ');
  });
  check('副本的「作者」那一行是 B 自己', ownerLine.includes(B.email), mask(ownerLine));

  // ═══ 4. B 不能刪除 A 的模組 ═══
  console.log('\n【4】B 回到 A 的模組按「🗑 刪除模組」→ 應該被擋');
  await clickByText(pb, '.mod-item', SRC);
  await new Promise((r) => setTimeout(r, 400));
  await clickByText(pb, 'button', '刪除模組', { dialogs: true, wait: 1500 });
  await new Promise((r) => setTimeout(r, 1200));
  check('A 的模組還在', !!rd(SRC));
  const toast = await pb.evaluate(() => document.body.innerText.includes('共編者') || document.body.innerText.includes('不能刪除'));
  check('畫面有說明為什麼不能刪', toast);

  // ═══ 5. 外人 C 什麼都看不到 ═══
  console.log('\n【5】外人 C 開編輯器');
  const pc = await openEditor(browser, C.id, 'C');
  const cIds = await sidebarIds(pc);
  check('C 看不到 A 的模組', !cIds.includes(SRC));
  check('C 看不到 B 的副本', !cIds.includes(CP));

  // ═══ 6. A 移除 B → B 立刻失去權限 ═══
  console.log('\n【6】A 按「移除」把 B 踢出共編');
  await clickByText(pa, '.mod-item', SRC);
  await clickByText(pa, '.cfg-tab', '分享');
  console.log(`    A 的狀態:currentId=${await pa.evaluate(() => currentId)} activeTab=${await pa.evaluate(() => activeTab)}`);
  console.log(`    A 的面板:${mask(await shareText(pa)).slice(0, 180)}`);
  if (pa.errs.length) console.log(`    A 的錯誤:${pa.errs.slice(-3).join(' | ')}`);
  await waitFor(pa, () => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('移除')), 'A 的移除鈕');
  await clickByText(pa, 'button', '移除', { dialogs: true, wait: 1200 });
  console.log(`    移除後面板:${mask(await shareText(pa)).slice(0, 160)}`);
  console.log(`    磁碟名單:${JSON.stringify((rd(SRC).collaborators || []).map((c) => mask(c.email)))}  錯誤:${pa.errs.slice(-2).join(' | ') || '無'}`);
  const emptied = await waitFor(pa, () => /已加入的人（0）/.test(document.getElementById('cfgShare').innerText)
                                          && /還沒有人/.test(document.getElementById('cfgShare').innerText),
                                '名單重畫成 0 人').then(() => true).catch(() => false);
  check('名單重畫成 0 人', emptied, mask(await shareText(pa)).slice(0, 120));
  check('磁碟上也移除了', !rd(SRC).collaborators || rd(SRC).collaborators.length === 0);
  const pb2 = await openEditor(browser, B.id, 'B2');
  const b2 = await sidebarIds(pb2);
  check('B 重新整理後看不到 A 的模組了', !b2.includes(SRC));
  check('B 自己的副本還在', b2.includes(CP));

  await browser.close();
  // 清理
  await fetch(`${BASE}/api/modules/${SRC}`, { method: 'DELETE', headers: H(A.id) });
  await fetch(`${BASE}/api/modules/${CP}`, { method: 'DELETE', headers: H(B.id) });
  const left = [SRC, CP].filter((i) => fs.existsSync(`/root/imgame/server/modules/${i}`));

  const bad = results.filter((r) => !r.pass);
  console.log(`\n${'═'.repeat(58)}\n通過 ${results.length - bad.length}/${results.length}   殘留:${left.length ? left.join(', ') : '無'}`);
  if (bad.length) { console.log('失敗:'); bad.forEach((b) => console.log('  ✗ ' + b.label)); process.exitCode = 1; }
  clearTimeout(GUARD);
})().catch((e) => { console.error('腳本自己炸了:', e.message, '\n', e.stack?.split('\n')[1]); clearTimeout(GUARD); process.exit(2); });

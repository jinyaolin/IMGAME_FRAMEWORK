// ============================================================
// 怪物三視角渲染 — render_monster 工具的 server 端(img2three 驗證迴圈)。
// headless puppeteer 開 client/editor/monster-render.html(swiftshader 軟渲染),
// 截 1536×512 contact sheet(正面/側面/3/4)回 base64。
// 瀏覽器常駐共用(冷啟 ~2s,之後每張 ~2-4s);loopback 直連 → auth 免登入(同 AI playtest)。
// ============================================================
const puppeteer = require('puppeteer');

const GL = ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'];
let _browser = null;

async function browser() {
  if (_browser) {
    try { if (_browser.connected !== false) return _browser; } catch (e) {}
  }
  _browser = await puppeteer.launch({ headless: 'new', args: GL, protocolTimeout: 60000 });
  return _browser;
}

// 渲染怪物庫中的怪物 → { b64 }(PNG)。失敗擲錯(訊息給 Kimi 修正用)。
async function render(name, opts) {
  opts = opts || {};
  const seed = opts.seed == null ? 7 : (opts.seed | 0);
  const base = process.env.BASE_PATH || '';
  const port = process.env.PORT || 3000;
  const url = 'http://127.0.0.1:' + port + base + '/editor/monster-render.html?name=' + encodeURIComponent(name) + '&seed=' + seed;
  const b = await browser();
  const pg = await b.newPage();
  try {
    await pg.setViewport({ width: 1560, height: 540 });
    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // polling 用固定間隔:headless(swiftshader)頁面 RAF 可能不跳,預設 raf 輪詢會在條件已成立時仍逾時
    await pg.waitForFunction('window.__done === true || !!window.__error', { timeout: 25000, polling: 300 });
    const err = await pg.evaluate(() => window.__error || null);
    if (err) throw new Error('渲染失敗:' + err);
    const cv = await pg.$('#cv');
    const b64 = await cv.screenshot({ encoding: 'base64', type: 'png' });
    const stats = await pg.evaluate(() => window.__stats || null);
    return { b64, stats };
  } finally {
    try { await pg.close(); } catch (e) {}
  }
}

async function dispose() { if (_browser) { try { await _browser.close(); } catch (e) {} _browser = null; } }

module.exports = { render, dispose };

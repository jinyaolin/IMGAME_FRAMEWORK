'use strict';

// 視覺測試：無頭 Chrome（SwiftShader WebGL）真正執行遊戲畫面並截圖
// 截圖以 base64 回傳，由 agent 以 vision 訊息餵給 Kimi「親眼檢視」
const puppeteer = require('puppeteer');

let busy = false;

async function runVisualTest({ moduleId, stageId, players = 3, seconds = 6, port = 3000, basePath = '' }) {
  if (busy) return { error: '已有視覺測試進行中，請稍後再試' };
  busy = true;
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-dev-shm-usage',
        '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 880 });

    const consoleLogs = [];
    page.on('console', msg => {
      const t = msg.type();
      if ((t === 'error' || t === 'warn' || t === 'log') && consoleLogs.length < 60) {
        consoleLogs.push(`${t}: ${msg.text().slice(0, 300)}`);
      }
    });
    page.on('pageerror', e => { if (consoleLogs.length < 60) consoleLogs.push('pageerror: ' + e.message.slice(0, 300)); });

    const n = Math.min(Math.max(Number(players) || 3, 1), 6);
    const url = `http://127.0.0.1:${port}${basePath}/editor/harness.html?module=${encodeURIComponent(moduleId)}` +
      (stageId ? `&stage=${encodeURIComponent(stageId)}` : '') + `&players=${n}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction('window.__harnessReady !== false', { timeout: 15000 }).catch(() => {});
    const ready = await page.evaluate('window.__harnessReady');
    if (ready === 'no-module') return { error: `模組 ${moduleId} 不存在` };
    if (ready === 'no-stage')  return { error: '此模組沒有 game 階段' };
    if (ready !== true) return { error: 'harness 載入失敗', consoleLogs };

    const clampSec = Math.min(Math.max(Number(seconds) || 6, 3), 15);
    const times = [1000, Math.floor(clampSec * 500), clampSec * 1000];
    const shots = [];
    let prev = 0;
    for (const t of times) {
      await new Promise(r => setTimeout(r, t - prev));
      prev = t;
      shots.push(await page.screenshot({ type: 'jpeg', quality: 72, encoding: 'base64' }));
    }
    const harnessErrors = await page.evaluate('window.__harnessErrors || []');

    return {
      ok: true,
      timepoints: times.map(t => (t / 1000) + 's'),
      harnessErrors: harnessErrors.slice(0, 20),
      consoleLogs: consoleLogs.slice(0, 40),
      note: '截圖已以圖片訊息附上（上方大圖=大螢幕 display；下排小直圖=各模擬手機）。請逐張檢視畫面是否正確。',
      _images: shots,
    };
  } catch (e) {
    return { error: '視覺測試失敗: ' + e.message };
  } finally {
    busy = false;
    if (browser) { try { await browser.close(); } catch {} }
  }
}

module.exports = { runVisualTest };

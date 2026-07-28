'use strict';
// 合併主持頁(labs)P2P 端到端:labs 頁按「區網主持(P2P)」→ 瀏覽器當 server,
// 兩支手機 P2P 直連,大螢幕 display iframe 也 P2P 直連。驗證整條在主持台裡跑起來。
//   node test-labs-p2p-smoke.js
const puppeteer = require('puppeteer');
const O = 'http://127.0.0.1:3000', BASE = '/labs/game';
const wait = ms => new Promise(r => setTimeout(r, ms));
const GL = ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];

(async () => {
  const ok = [];
  const ck = (n, c, d) => { console.log((c ? '✓ ' : '✗ ') + n + (d ? ' — ' + d : '')); if (!c) ok.push(n); };
  const browsers = [];
  async function open(url, name) {
    const b = await puppeteer.launch({ headless: 'new', args: GL }); browsers.push(b);
    const pg = (await b.pages())[0];
    pg.on('pageerror', e => console.log(`  [${name} err] ${e.message}`));
    pg.on('console', m => { const t = m.text(); if (/error|Error|錯誤|fail/i.test(t) && !/favicon|404/.test(t)) console.log(`  [${name}] ${t}`); });
    await pg.evaluateOnNewDocument(() => { window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); window.cancelAnimationFrame = id => clearTimeout(id); });
    await pg.goto(url, { waitUntil: 'domcontentloaded' });
    return pg;
  }

  // 1) 主持台開「區網主持(P2P)」
  const labs = await open(`${O}${BASE}/`, 'LABS');
  await wait(1000);
  await labs.evaluate(() => window.__labs.createP2P());
  const room = await labs.waitForFunction("window.__labs.roomId && window.__labs.p2p === true", { timeout: 20000 }).then(() => labs.evaluate(() => window.__labs.roomId)).catch(() => null);
  ck('labs 頁 P2P 主持啟動(瀏覽器當 server)', !!room, 'room=' + room);
  if (!room) { for (const b of browsers) await b.close().catch(() => {}); process.exit(2); }

  // 2) 兩支手機 P2P 直連
  const RP = process.env.RP === '1' ? '&rp=1' : ''; const M1 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1${RP}&name=P1`, 'P1');
  const M2 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1${RP}&name=P2`, 'P2');
  const joined = await labs.waitForFunction("window.__gameHost && window.__gameHost.session.players.count() >= 2", { timeout: 30000 }).then(() => true).catch(() => false);
  ck('兩支手機 P2P 連上主持台(session 2 人)', joined, joined ? await labs.evaluate(() => window.__gameHost.session.players.count()) + ' 人' : 'timeout');
  if (!joined) { for (const b of browsers) await b.close().catch(() => {}); process.exit(2); }

  // 3) host_joined 讓主持台初始化(phase=lobby、控制列 render)
  ck('主持台收到 host_joined 初始化', await labs.evaluate(() => window.__labs.phase === 'lobby'));

  // 4) 選模組(走真 UI 事件流:selectModule → module_selected → 啟用啟動鈕)
  await labs.evaluate(() => window.__labs.select('fairy-brawl-nk'));
  const selOK = await labs.waitForFunction("window.__labs.selected === 'fairy-brawl-nk'", { timeout: 8000 }).then(() => true).catch(() => false);
  ck('選模組生效(host_select_module → module_selected)', selOK, 'selected=' + await labs.evaluate(() => window.__labs.selected));

  // 兩人準備 → 啟動 → 推進到 game
  for (const pg of [M1, M2]) { try { await pg.evaluate(() => typeof toggleReady === 'function' && toggleReady()); } catch (e) {} }
  await labs.waitForFunction("window.__gameHost.session.players.all().filter(p=>p.isReady).length >= 2", { timeout: 10000 }).catch(() => {});
  await labs.evaluate(() => window.__labs.load('fairy-brawl-nk'));
  await labs.waitForFunction("window.__gameHost.session.phase === 'playing'", { timeout: 15000 }).then(() => true).catch(() => false);
  await wait(600);
  await labs.evaluate(() => window.__labs.next('next_stage'));   // intermission → game
  ck('主持台載入 fairy-brawl-nk 並進入 game', true);

  // 大螢幕加入連結要帶 &p2p=1(手機才會走 P2P)
  const joinUrl = await labs.evaluate(() => { const f = document.getElementById('displayFrame'); const d = f && f.contentDocument; const el = d && d.getElementById('joinUrl'); return el ? el.textContent : null; }).catch(() => null);
  ck('大螢幕加入連結帶 &p2p=1', !!joinUrl && joinUrl.includes('p2p=1'), joinUrl || '(讀不到)');

  // 5) 手機 NetKit render 起來
  async function waitNet(pg, nm) { for (let i = 0; i < 80; i++) { if (await pg.evaluate(() => !!(window.__NET && window.__NET.self && window.__NET.entities[window.__NET.self])).catch(() => false)) return true; await wait(250); } return false; }
  const n1 = await waitNet(M1), n2 = await waitNet(M2);
  ck('兩支手機 NetKit render 生效', n1 && n2);
  if (!n1 || !n2) { for (const b of browsers) await b.close().catch(() => {}); process.exit(1); }
  await wait(1000);

  const seq = await M1.evaluate(() => window.__NET.client._seq);
  ck('net_snapshot 經 P2P 直達(seq 前進)', seq > 0, 'seq=' + seq);

  // 大螢幕 display iframe:overlay 應已關(收到 display_joined),不卡在「加入顯示端…」轉圈
  const dispOK = await labs.evaluate(() => {
    const f = document.getElementById('displayFrame');
    const doc = f && f.contentDocument; if (!doc) return { err: 'no iframe doc' };
    const ov = doc.getElementById('connectOverlay');
    return { hidden: ov ? ov.classList.contains('hidden') : 'no overlay', hasNet: !!(f.contentWindow && f.contentWindow.__NET) };
  }).catch(e => ({ err: e.message }));
  ck('大螢幕 display 已就緒(overlay 關閉)', dispOK.hidden === true, JSON.stringify(dispOK));

  // 6) 自己預測即時
  const lat = await M1.evaluate(async () => { const N = window.__NET; const s = ms => new Promise(r => setTimeout(r, ms)); const x0 = N.entities[N.self].p[0]; const t0 = performance.now(); N.input({ mx: 1 }); for (let i = 0; i < 30; i++) { await s(16); if (Math.abs(N.entities[N.self].p[0] - x0) > 0.05) return performance.now() - t0; } return 9999; });
  ck('自己角色預測即時(<60ms)', lat < 60, Math.round(lat) + 'ms');

  // 7) 觀察者無瞬移
  await M2.evaluate(() => { window.__samp = []; window.__on = true; const N = window.__NET; (function l() { if (!window.__on) return; const o = Object.keys(N.entities).filter(id => id !== N.self); if (o.length) window.__samp.push(N.entities[o[0]].p[0]); setTimeout(l, 16); })(); });
  await M1.evaluate(async () => { const N = window.__NET; const s = ms => new Promise(r => setTimeout(r, ms)); for (let k = 0; k < 6; k++) { N.input({ mx: 1 }); await s(300); N.input({ mx: 1, jump: true }); await s(300); } N.input({ mx: 0 }); });
  await wait(300); await M2.evaluate(() => { window.__on = false; });
  const samp = await M2.evaluate(() => window.__samp || []);
  let back = 0; for (let i = 1; i < samp.length; i++) if (samp[i] - samp[i - 1] < -0.05) back++;
  ck('觀察者看對方無瞬移(0 逆行)', samp.length > 20 && back === 0, `樣本=${samp.length} 逆行=${back}`);

  for (const b of browsers) await b.close().catch(() => {});
  console.log(ok.length === 0 ? '\nLABS P2P SMOKE PASS' : '\nLABS P2P SMOKE FAIL: ' + ok.join(', '));
  process.exit(ok.length === 0 ? 0 : 1);
})().catch(e => { console.error('EXCEPTION', e); process.exit(1); });

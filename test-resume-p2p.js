'use strict';
// 手機 resume(P2P):重整同身份重連、不生幽靈玩家、room_joined 帶 currentStage。需先啟動伺服器:node test-resume-p2p.js:P2P 模式手機重整 → localStorage 同身份 → GameHost room_joined 同形回覆
const puppeteer = require('puppeteer');
const O = 'http://127.0.0.1:3000', BASE = '/labs/game';
const wait = ms => new Promise(r => setTimeout(r, ms));
const GL = ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
(async () => {
  const fails = [];
  const ck = (n, c, d) => { console.log((c ? '✓ ' : '✗ ') + n + (d ? ' — ' + d : '')); if (!c) fails.push(n); };
  const browsers = [];
  async function open(url, name) {
    const b = await puppeteer.launch({ headless: 'new', args: GL }); browsers.push(b);
    const pg = (await b.pages())[0];
    pg.on('pageerror', e => console.log(`  [${name} err] ${e.message}`));
    await pg.evaluateOnNewDocument(() => { window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); window.cancelAnimationFrame = id => clearTimeout(id); });
    await pg.goto(url, { waitUntil: 'domcontentloaded' });
    return pg;
  }
  const labs = await open(`${O}${BASE}/`, 'LABS');
  await wait(1000);
  await labs.evaluate(() => window.__labs.createP2P());
  const room = await labs.waitForFunction("window.__labs.roomId && window.__labs.p2p === true", { timeout: 20000 }).then(() => labs.evaluate(() => window.__labs.roomId)).catch(() => null);
  ck('P2P 主持啟動', !!room, 'room=' + room);
  if (!room) process.exit(2);

  const M1 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1&name=P1`, 'P1');
  const M2 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1&name=P2`, 'P2');
  const joined = await labs.waitForFunction("window.__gameHost && window.__gameHost.session.players.count() >= 2", { timeout: 30000 }).then(() => true).catch(() => false);
  ck('兩機 P2P 連上', joined);
  if (!joined) process.exit(2);

  const pid1a = await M1.evaluate(() => playerId);
  ck('P1 playerId 已產生', !!pid1a, pid1a);
  const storKey = await M1.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('imgame.pid.')));
  ck('playerId 存進 localStorage(按房+名)', !!storKey, storKey);

  // 開局進 game 階段
  for (const pg of [M1, M2]) { try { await pg.evaluate(() => typeof toggleReady === 'function' && toggleReady()); } catch (e) {} }
  await labs.waitForFunction("window.__gameHost.session.players.all().filter(p=>p.isReady).length >= 2", { timeout: 10000 }).catch(() => {});
  await labs.evaluate(() => window.__labs.load('unogame'));
  await labs.waitForFunction("window.__gameHost.session.phase === 'playing'", { timeout: 15000 }).catch(() => {});
  await labs.evaluate(() => window.__labs.next('next_stage'));   // rules → uno_game
  await wait(2000);

  // ── 重整 P1 手機頁(模擬手機瀏覽器重載)──
  await M1.reload({ waitUntil: 'domcontentloaded' });
  const rejoined = await M1.waitForFunction("typeof phase !== 'undefined' && phase === 'playing'", { timeout: 25000 }).then(() => true).catch(() => false);
  ck('重整後重新連上且 phase=playing(room_joined 同形回覆)', rejoined);
  const pid1b = await M1.evaluate(() => playerId).catch(() => null);
  ck('重整後 playerId 不變(localStorage resume)', pid1b === pid1a, pid1a + ' → ' + pid1b);
  await wait(1500);
  const roster = await labs.evaluate(() => window.__gameHost.session.players.all().map(p => ({ id: String(p.id), conn: p.isConnected })));
  console.log('  session 名單:', JSON.stringify(roster));
  ck('沒有幽靈玩家(仍 2 人)', roster.length === 2);
  ck('P1 重連後 isConnected', roster.find(r => r.id === pid1a)?.conn === true);

  // room 滿房檢查不擋重連:unogame maxPlayers=8,略過;改驗第三個「新」玩家還能加(容量內)
  const M3 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1&name=P3`, 'P3');
  const j3 = await labs.waitForFunction("window.__gameHost.session.players.count() >= 3", { timeout: 30000 }).then(() => true).catch(() => false);
  const c3 = await labs.evaluate(() => window.__gameHost.session.players.count());
  ck('新玩家仍可加入(容量內,count=3)', j3 && c3 === 3, 'count=' + c3);

  for (const b of browsers) await b.close().catch(() => {});
  console.log(fails.length ? `\n✗ FAIL: ${fails.join(', ')}` : '\n✅ P2P resume 第一步全通');
  process.exit(fails.length ? 1 : 0);
})();

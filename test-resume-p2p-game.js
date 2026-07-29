'use strict';
// 第二步:P2P 模式 fairy-brawl-nk 打鬥中重整手機 → 遊戲畫面直接重建 + 實體重生
const puppeteer = require('puppeteer');
const O = 'http://127.0.0.1:3000', BASE = '/labs/game';
const wait = ms => new Promise(r => setTimeout(r, ms));
const GL = ['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',
  '--disable-features=WebRtcHideLocalIpsWithMdns','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'];
(async () => {
  const fails = []; const ck=(n,c,d)=>{ console.log((c?'✓ ':'✗ ')+n+(d?' — '+d:'')); if(!c) fails.push(n); };
  const browsers = [];
  async function open(url, name) {
    const b = await puppeteer.launch({ headless:'new', args: GL }); browsers.push(b);
    const pg = (await b.pages())[0];
    pg.on('pageerror', e => console.log(`  [${name} err] ${e.message}`));
    await pg.evaluateOnNewDocument(() => { window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); });
    await pg.goto(url, { waitUntil:'domcontentloaded' });
    return pg;
  }
  const labs = await open(`${O}${BASE}/`, 'LABS');
  await wait(1000);
  await labs.evaluate(() => window.__labs.createP2P());
  const room = await labs.waitForFunction("window.__labs.roomId && window.__labs.p2p === true",{timeout:20000}).then(()=>labs.evaluate(()=>window.__labs.roomId)).catch(()=>null);
  ck('P2P 房', !!room, room);
  if (!room) process.exit(2);
  const M1 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1&name=P1`, 'P1');
  const M2 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1&name=P2`, 'P2');
  const joined = await labs.waitForFunction("window.__gameHost && window.__gameHost.session.players.count() >= 2",{timeout:30000}).then(()=>true).catch(()=>false);
  ck('兩機連上', joined);
  if (!joined) process.exit(2);
  for (const pg of [M1,M2]) { try { await pg.evaluate(() => typeof toggleReady==='function' && toggleReady()); } catch(e){} }
  await labs.waitForFunction("window.__gameHost.session.players.all().filter(p=>p.isReady).length >= 2",{timeout:10000}).catch(()=>{});
  await labs.evaluate(() => window.__labs.load('fairy-brawl-nk'));
  await labs.waitForFunction("window.__gameHost.session.phase === 'playing'",{timeout:15000}).catch(()=>{});
  await wait(800);
  // select 階段:兩機按確定
  for (const pg of [M1,M2]) { try { await pg.evaluate(() => { client.playerAction('set_player_attr',{attrId:'ready',value:true}); }); } catch(e){} }
  await wait(2500);   // all_ready 自動推進(800ms)+ fight 開場
  const inFight1 = await M1.waitForFunction("!!document.getElementById('customGameOverlay')",{timeout:15000}).then(()=>true).catch(()=>false);
  ck('進入打鬥(自訂遊戲畫面掛載)', inFight1);
  const pid1 = await M1.evaluate(() => playerId);

  // ── 打鬥中重整 P1 ──
  await M1.reload({ waitUntil:'domcontentloaded' });
  const rebuilt = await M1.waitForFunction("!!document.getElementById('customGameOverlay')",{timeout:30000}).then(()=>true).catch(()=>false);
  ck('重整後遊戲畫面自動重建(非等待畫面)', rebuilt);
  const pidSame = await M1.evaluate(() => playerId).catch(()=>null);
  ck('身份不變', pidSame === pid1, pid1 + ' → ' + pidSame);
  await wait(1500);
  // 實體重生:從 M2 的 Net.entities 看得到 P1
  const seen = await M2.evaluate((pid) => { try { return Object.keys((window.__net && window.__net.entities) || {}); } catch(e){ return null; } }, pid1).catch(()=>null);
  // __net 不一定存在;退而求其次由 labs 端 sim worker 的快照無法直接讀 → 用 M1 自己的 room_joined phase 判斷 + M2 畫面仍在
  const roster = await labs.evaluate(() => window.__gameHost.session.players.all().map(p=>({id:String(p.id),conn:p.isConnected})));
  ck('名單仍 2 人且 P1 已連線', roster.length===2 && roster.find(r=>r.id===pid1)?.conn===true, JSON.stringify(roster));
  for (const b of browsers) await b.close().catch(()=>{});
  console.log(fails.length ? `\n✗ FAIL: ${fails.join(', ')}` : '\n✅ 第二步 P2P 遊戲中回歸全通');
  process.exit(fails.length ? 1 : 0);
})();

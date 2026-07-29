'use strict';
// P2P 斷線自動重連:殺掉 mobile 的 P2P → 4s 重試迴圈 → 同身份歸隊
const puppeteer = require('puppeteer');
const O = 'http://127.0.0.1:3000', BASE = '/labs/game';
const wait = ms => new Promise(r => setTimeout(r, ms));
const GL = ['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader',
  '--disable-features=WebRtcHideLocalIpsWithMdns','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'];
(async () => {
  const fails=[]; const ck=(n,c,d)=>{ console.log((c?'✓ ':'✗ ')+n+(d?' — '+d:'')); if(!c) fails.push(n); };
  const browsers=[];
  async function open(url,name){ const b=await puppeteer.launch({headless:'new',args:GL}); browsers.push(b);
    const pg=(await b.pages())[0]; pg.on('pageerror',e=>console.log(`  [${name} err] ${e.message}`));
    await pg.evaluateOnNewDocument(()=>{ window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16); });
    await pg.goto(url,{waitUntil:'domcontentloaded'}); return pg; }
  const labs = await open(`${O}${BASE}/`,'LABS');
  await wait(1000);
  await labs.evaluate(()=>window.__labs.createP2P());
  const room = await labs.waitForFunction("window.__labs.roomId && window.__labs.p2p === true",{timeout:20000}).then(()=>labs.evaluate(()=>window.__labs.roomId)).catch(()=>null);
  ck('P2P 房', !!room, room);
  if (!room) process.exit(2);
  const M1 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1&name=P1`,'P1');
  const joined = await labs.waitForFunction("window.__gameHost && window.__gameHost.session.players.count() >= 1",{timeout:30000}).then(()=>true).catch(()=>false);
  ck('P1 連上', joined);
  const pidA = await M1.evaluate(() => playerId);

  // 硬殺 P2P 連線(模擬背景凍結後真斷)
  await M1.evaluate(() => { try { client.p2p.close(); } catch(e){} });
  await wait(1500);
  const disc = await labs.evaluate((pid) => { const p = window.__gameHost.session.players.get(pid); return p ? p.isConnected : null; }, pidA);
  ck('host 端偵測到斷線(isConnected=false)', disc === false, String(disc));

  // 等自動重連(4s 週期)
  const back = await labs.waitForFunction(
    (pid) => { const p = window.__gameHost.session.players.get(pid); return p && p.isConnected === true; },
    { timeout: 20000 }, pidA
  ).then(()=>true).catch(()=>false);
  ck('自動重連歸隊(同身份 isConnected=true)', back);
  const count = await labs.evaluate(() => window.__gameHost.session.players.count());
  ck('沒有幽靈玩家(仍 1 人)', count === 1, 'count='+count);
  for (const b of browsers) await b.close().catch(()=>{});
  console.log(fails.length ? `\n✗ FAIL: ${fails.join(', ')}` : '\n✅ P2P 自動重連全通');
  process.exit(fails.length?1:0);
})();

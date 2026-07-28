'use strict';
// 選角端到端(P2P):select 階段 P1 選 wizard 並確定 → 驗證 host 參數、display 看板、fight sim 用該角色。
const puppeteer = require('puppeteer');
const O = 'http://127.0.0.1:3000', BASE = '/labs/game';
const wait = ms => new Promise(r => setTimeout(r, ms));
const GL = ['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--disable-features=WebRtcHideLocalIpsWithMdns','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'];
(async () => {
  const ok = []; const ck = (n,c,d)=>{ console.log((c?'✓ ':'✗ ')+n+(d?' — '+d:'')); if(!c) ok.push(n); };
  const browsers = [];
  async function open(url,name){ const b=await puppeteer.launch({headless:'new',args:GL}); browsers.push(b); const pg=(await b.pages())[0];
    pg.on('pageerror',e=>console.log(`  [${name} err] ${e.message}`));
    await pg.evaluateOnNewDocument(()=>{ window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16); window.cancelAnimationFrame=id=>clearTimeout(id); });
    await pg.goto(url,{waitUntil:'domcontentloaded'}); return pg; }
  const labs = await open(`${O}${BASE}/`,'LABS'); await wait(1000);
  await labs.evaluate(()=>window.__labs.createP2P());
  const room = await labs.waitForFunction("window.__labs.roomId && window.__labs.p2p===true",{timeout:20000}).then(()=>labs.evaluate(()=>window.__labs.roomId)).catch(()=>null);
  if(!room){ console.log('no room'); for(const b of browsers) await b.close().catch(()=>{}); process.exit(2); }
  const M1 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1&name=P1`,'P1');
  const M2 = await open(`${O}${BASE}/mobile/game.html?room=${room}&p2p=1&name=P2`,'P2');
  await labs.waitForFunction("window.__gameHost && window.__gameHost.session.players.count()>=2",{timeout:30000}).catch(()=>{});
  await labs.evaluate(()=>window.__labs.select('fairy-brawl-nk'));
  await labs.waitForFunction("window.__labs.selected==='fairy-brawl-nk'",{timeout:8000}).catch(()=>{});
  for(const pg of [M1,M2]){ try{ await pg.evaluate(()=>typeof toggleReady==='function'&&toggleReady()); }catch(e){} }
  await labs.waitForFunction("window.__gameHost.session.players.all().filter(p=>p.isReady).length>=2",{timeout:10000}).catch(()=>{});
  await labs.evaluate(()=>window.__labs.load('fairy-brawl-nk'));
  await labs.waitForFunction("window.__gameHost.session.phase==='playing'",{timeout:15000}).catch(()=>{});
  await wait(800);
  // 現在在 select 階段。取得 P1 的 pid
  const p1id = await labs.evaluate(()=>{ const ps=window.__gameHost.session.players.all(); const p=ps.find(x=>x.name==='P1'); return p?p.id:null; });
  ck('進入 select 階段 + 取得 P1 id', !!p1id, 'pid='+p1id);
  // P1 選 wizard + seed 777 + 確定(模擬選角介面送出的 player_action)
  await M1.evaluate(()=>{ window.__mgClient.playerAction('set_player_attr',{attrId:'role',value:'wizard'}); window.__mgClient.playerAction('set_player_attr',{attrId:'seed',value:777}); });
  await wait(300);
  await M1.evaluate(()=>window.__mgClient.playerAction('set_player_attr',{attrId:'ready',value:true}));
  await wait(400);
  // P2 也選 + 確定 → 應觸發 all_ready 自動推進
  await M2.evaluate(()=>{ window.__mgClient.playerAction('set_player_attr',{attrId:'role',value:'troll'}); window.__mgClient.playerAction('set_player_attr',{attrId:'ready',value:true}); });
  await wait(400);
  // host 端參數寫入?
  const attrs = await labs.evaluate(pid=>{ const p=window.__gameHost.session.players.get(pid); return p?p.attributes:null; }, p1id);
  ck('host 端寫入 P1.role=wizard / ready', attrs && attrs.role==='wizard' && attrs.ready===true && attrs.seed===777, JSON.stringify(attrs));
  // display 看板反映?(找大螢幕 iframe 的 moduleDisplay 內含 巫師)
  const boardTxt = await labs.evaluate(()=>{ const f=document.querySelector('iframe'); try{ const el=f.contentDocument.getElementById('moduleDisplay'); return el?el.textContent:''; }catch(e){ return 'ERR:'+e.message; } });
  ck('display 看板顯示 P1 選了 巫師', boardTxt.includes('巫師') && boardTxt.includes('已確定'), boardTxt.replace(/\s+/g,' ').slice(0,90));
  // 全員確定 → 應「自動」推進到 fight(不手動 next)
  const advanced = await labs.waitForFunction("window.__gameHost.session.currentModule && window.__gameHost.session.currentModule.currentStageId==='fight'",{timeout:8000}).then(()=>true).catch(()=>false);
  ck('全員確定 → 自動進入 fight 階段', advanced);
  await wait(1500);
  const role = await M2.evaluate(pid=>{ const N=window.__NET; if(!N||!N.entities[pid]) return null; return (N.entities[pid].s||{}).role; }, p1id);
  ck('fight sim 用選好的角色生成 P1=wizard', role==='wizard', 'role='+role);
  // ── 重啟一局:onStart 應清 ready、保留 role/seed ──
  await labs.evaluate(()=>window.__labs.load('fairy-brawl-nk'));
  await wait(1800);
  const after = await labs.evaluate(pid=>{ const s=window.__gameHost.session; const p=s.players.get(pid); const st=s.currentModule&&s.currentModule.currentStageId; return {stage:st, attrs:p?p.attributes:null}; }, p1id);
  ck('重啟後停在 select(ready 已清、不自動跳過)', after.stage==='select' && after.attrs && after.attrs.ready===false, JSON.stringify(after));
  ck('重啟後記住上次角色(role=wizard/seed=777 保留)', after.attrs && after.attrs.role==='wizard' && after.attrs.seed===777, JSON.stringify(after.attrs));
  for(const b of browsers) await b.close().catch(()=>{});
  console.log(ok.length===0?'\nSELECT E2E PASS':'\nSELECT E2E FAIL: '+ok.join(', '));
  process.exit(ok.length===0?0:1);
})().catch(e=>{ console.error('EXCEPTION',e); process.exit(1); });

'use strict';
// 手機 resume(Node 模式):重整 localStorage 同身份 → server reconnectPlayer。需先啟動伺服器:node test-resume-node.js resume:localStorage 同身份 → server reconnectPlayer
const puppeteer = require('puppeteer');
const { io } = require('socket.io-client');
const O = 'http://127.0.0.1:3000', BASE = '/labs/game';
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const fails = []; const ck = (n,c,d)=>{ console.log((c?'✓ ':'✗ ')+n+(d?' — '+d:'')); if(!c) fails.push(n); };
  const r = await fetch(`${O}${BASE}/api/rooms`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ moduleId:'unogame' }) });
  const { roomId } = await r.json();
  const host = io(O, { path: BASE + '/socket.io', transports:['websocket'] });
  host.on('connect', () => host.emit('join_host', { roomId }));
  let reconnectedEvt = null;
  host.on('player_reconnected', d => { reconnectedEvt = d; });

  const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox'] });
  const pg = (await b.pages())[0];
  await pg.goto(`${O}${BASE}/mobile/game.html?room=${roomId}&name=RP1`, { waitUntil:'domcontentloaded' });
  await pg.waitForFunction("typeof playerId !== 'undefined' && playerId", { timeout: 10000 });
  const pidA = await pg.evaluate(() => playerId);
  await wait(800);
  await pg.evaluate(() => typeof toggleReady === 'function' && toggleReady());
  // 第二個玩家(socket 假人)讓遊戲能開
  const p2 = io(O, { path: BASE + '/socket.io', transports:['websocket'] });
  p2.on('connect', () => { p2.emit('join_room', { roomId, playerId:'sock-2', playerName:'乙' }); setTimeout(()=>p2.emit('player_ready',{roomId,playerId:'sock-2',isReady:true}),150); });
  await wait(800);
  host.emit('host_load_module', { roomId, moduleName:'unogame', config:null });
  await wait(1200);   // rules 階段(playing)

  await pg.reload({ waitUntil:'domcontentloaded' });
  const back = await pg.waitForFunction("typeof phase !== 'undefined' && phase === 'playing'", { timeout: 10000 }).then(()=>true).catch(()=>false);
  const pidB = await pg.evaluate(() => playerId).catch(()=>null);
  ck('重整後 playerId 不變', pidA === pidB, pidA + ' → ' + pidB);
  ck('重整後 room_joined phase=playing', back);
  await wait(500);
  ck('server 發出 player_reconnected(走重連而非新玩家)', reconnectedEvt && reconnectedEvt.playerId === pidA, JSON.stringify(reconnectedEvt));
  await b.close(); host.disconnect(); p2.disconnect();
  console.log(fails.length ? `✗ FAIL: ${fails.join(', ')}` : '✅ Node 模式 resume 通過');
  process.exit(fails.length ? 1 : 0);
})();

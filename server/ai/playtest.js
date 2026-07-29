'use strict';

// 無頭模擬測試：機器人玩家自動玩一輪模組，回傳事件時間軸摘要。
// 給 AI 編輯核心當「測試工具」用；也可單獨 require 使用。
const { io: ioClient } = require('socket.io-client');

const BOT_NAMES = ['小明', '小華', '小美', '阿強', '小芳', '大雄', '靜香', '胖虎'];

function runPlaytest({ moduleId, playerCount = 4, port = 3000, basePath = '', maxSeconds = 60 }) {
  const base = `http://127.0.0.1:${port}`;
  const timeline = [];
  const sockets = [];
  const bots = [];
  let lastEventAt = Date.now();
  let forcedAdvances = 0;
  let hostState = null;
  let done = false;

  const log = (line) => {
    if (timeline.length >= 150) return;
    lastEventAt = Date.now();
    timeline.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`);
  };
  const t0 = Date.now();

  return new Promise(async (resolve) => {
    let roomId;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      clearTimeout(hardStop);
      for (const b of bots) { if (b.state && b.state.nkTimer) { clearInterval(b.state.nkTimer); b.state.nkTimer = null; } }
      try { if (host && roomId) host.emit('host_close_room', { roomId }); } catch {}
      setTimeout(() => { for (const s of sockets) { try { s.disconnect(); } catch {} } }, 300);
      resolve({ ...result, timeline, forcedAdvances, elapsedSeconds: +((Date.now() - t0) / 1000).toFixed(1) });
    };

    // 1) 建房
    let host;
    try {
      const res = await fetch(`${base}${basePath}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId }),
      });
      const json = await res.json();
      if (!res.ok || !json.roomId) return finish({ ok: false, error: `建房失敗: ${JSON.stringify(json).slice(0, 200)}` });
      roomId = json.roomId;
      log(`建房成功 ${roomId}（模組 ${moduleId}）`);
    } catch (e) {
      return finish({ ok: false, error: `無法連到伺服器: ${e.message}` });
    }

    const hardStop = setTimeout(() => {
      finish({ ok: false, endedNaturally: false, error: `超過 ${maxSeconds}s 上限，遊戲未自然結束（可能流程卡住）` });
    }, maxSeconds * 1000);

    // 2) Host 連線
    host = ioClient(base, { path: basePath + '/socket.io', transports: ['websocket'] });
    sockets.push(host);
    host.on('connect', () => host.emit('join_host', { roomId }));
    host.on('host_game_state', (s) => { hostState = s; });
    host.on('stage_started', (d) => log(`階段開始: ${d.stageName}（${d.stageType}）回合 ${d.roundNumber || 1}`));
    host.on('loop_started', (d) => log(`迴圈開始: ${d.loopName}（最多 ${d.maxIterations || '∞'} 次）`));
    host.on('round_result', (d) => log(`回合結果: 第 ${d.round} 回合，贏家 ${JSON.stringify(d.winnerNames || [])}`));
    host.on('vote_ended', (d) => log(`投票結束: ${JSON.stringify(d.results || d.winner || '').slice(0, 120)}`));
    host.on('players_eliminated', (d) => log(`玩家淘汰: ${JSON.stringify(d.playerIds || d.playerId || '').slice(0, 80)}`));
    host.on('module_error', (d) => { log(`❌ 模組錯誤: ${d.message}`); finish({ ok: false, endedNaturally: false, error: `module_error: ${d.message}` }); });
    host.on('game_ended', (d) => {
      log(`遊戲結束 🏁 名次: ${JSON.stringify(d.ranked || d.champions || d.scores || '').slice(0, 200)}`);
      finish({ ok: true, endedNaturally: true });
    });
    host.on('back_to_lobby', () => {
      log('回到大廳');
      finish({ ok: true, endedNaturally: true });
    });

    // 3) 機器人玩家
    for (let i = 0; i < playerCount; i++) {
      const bot = ioClient(base, { path: basePath + '/socket.io', transports: ['websocket'] });
      sockets.push(bot);
      const pid = `bot-${i + 1}`;
      const name = BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? `#${i}` : '');
      const state = { hand: [], voted: false };
      bots.push({ socket: bot, pid, name, state });

      bot.on('connect', () => {
        bot.emit('join_room', { roomId, playerId: pid, playerName: name });
        setTimeout(() => bot.emit('player_ready', { roomId, playerId: pid, isReady: true }), 200);
      });
      bot.on('identity_assigned', (d) => {
        log(`${name} 收到身份: ${d.card?.name || '?'}`);
        setTimeout(() => bot.emit('player_action', { roomId, playerId: pid, action: 'confirm_identity', data: {} }), 250 + i * 100);
      });
      bot.on('cards_drawn', (d) => {
        state.hand = d.hand || [];
        setTimeout(() => playIfPossible(), 300 + i * 150);
      });
      bot.on('card_accepted', (d) => { if (d.hand) state.hand = d.hand; });
      bot.on('round_started', () => setTimeout(() => playIfPossible(), 300 + i * 150));
      bot.on('stage_started', (d) => {
        state.voted = false;
        stopNetkit();   // 換階段 → 停掉上一個 NetKit 輸入迴圈
        if (d.stageType === 'game') {
          // 舊式遊戲:亂按幾下搖桿(NetKit 遊戲另走 net_snapshot 觸發的輸入迴圈)
          for (let k = 0; k < 3; k++) {
            setTimeout(() => {
              bot.emit('player_action', { roomId, playerId: pid, action: 'game', data: { key: 'btn1', state: 'down', seq: k } });
              setTimeout(() => bot.emit('player_action', { roomId, playerId: pid, action: 'game', data: { key: 'btn1', state: 'up', seq: k } }), 120);
            }, 400 + k * 500 + i * 80);
          }
        }
        // select 階段:選個角色+按確定(用框架通用的 set_player_attr)
        if (d.stageType === 'select') {
          setTimeout(() => {
            bot.emit('player_action', { roomId, playerId: pid, action: 'set_player_attr', data: { attrId: 'seed', value: i + 1 } });
            bot.emit('player_action', { roomId, playerId: pid, action: 'set_player_attr', data: { attrId: 'ready', value: true } });
            log(`${name} 選角完成按下確定`);
          }, 500 + i * 200);
        }
      });
      // NetKit 即時遊戲:收到 net_snapshot = 主機權威 sim 在跑 → 以 10Hz 送隨機移動+偶發按鍵
      bot.on('net_snapshot', (pkt) => {
        if (done) return;
        if (!state.nkTimer) {
          if (i === 0) log(`NetKit 即時遊戲開始(快照含 ${Object.keys(pkt.ents || {}).length} 實體)`);
          state.nkSeq = 0;
          state.nkTimer = setInterval(() => {
            state.nkSeq++;
            const input = { seq: state.nkSeq, mx: Math.sin((Date.now() - t0) / 900 + i * 2) > 0 ? 1 : -1 };
            if (Math.random() < 0.15) input.jump = true;
            if (Math.random() < 0.10) input.atk = true;
            if (Math.random() < 0.06) input.kick = true;
            if (Math.random() < 0.06) input.skill = true;
            bot.emit('player_action', { roomId, playerId: pid, action: 'net_input', data: input });
          }, 100);
        }
        // 第 0 隻 bot 每 4 秒摘要實體位置/狀態(給 AI 看遊戲有沒有真的在動),
        // 最多 5 張後停止 → 讓看門狗接手推進,長回合的即時遊戲才不會拖滿 maxSeconds
        if (i === 0 && (state.nkLogCount || 0) < 5 && Date.now() - (state.nkLastLog || 0) > 4000) {
          state.nkLastLog = Date.now();
          state.nkLogCount = (state.nkLogCount || 0) + 1;
          const ids = Object.keys(pkt.ents || {});
          const summary = ids.slice(0, 4).map(id => {
            const e = pkt.ents[id];
            const pos = (e.p || []).map(v => Math.round(v)).join(',');
            const hp = e.s && e.s.hp != null ? ` hp${e.s.hp}` : '';
            return `${id}@(${pos})${hp}`;
          }).join(' ');
          log(`NetKit 快照: ${summary}`);
        }
      });
      function stopNetkit() { if (state.nkTimer) { clearInterval(state.nkTimer); state.nkTimer = null; } state.nkLogCount = 0; state.nkLastLog = 0; }
      bot.on('vote_started', (d) => {
        if (state.voted) return;
        const opts = (d.options || []).filter(o => o.id !== pid || d.voteConfig?.allowSelfVote);
        const pick = opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
        if (pick) {
          state.voted = true;
          setTimeout(() => {
            bot.emit('player_action', { roomId, playerId: pid, action: 'cast_vote', data: { targetId: pick.id } });
            log(`${name} 投給 ${pick.label || pick.name || pick.id}`);
          }, 400 + i * 200);
        }
      });

      function playIfPossible() {
        if (done || !state.hand.length) return;
        const card = state.hand[0];
        bot.emit('play_card', { roomId, playerId: pid, cardId: card.id });
        log(`${name} 出牌: ${card.name}`);
      }
    }

    // 4) 啟動遊戲（等大家 ready）
    setTimeout(() => {
      if (done) return;
      log(`Host 啟動模組（${playerCount} 位機器人）`);
      host.emit('host_load_module', { roomId, moduleName: moduleId, config: null });
    }, 1500);

    // 5) 卡住看門狗：6 秒沒有任何事件 → host 依 availableActions 強制推進
    const watchdog = setInterval(() => {
      if (done) return;
      if (Date.now() - lastEventAt < 6000) return;
      const actions = hostState?.availableActions || [];
      const prefer = ['end_vote', 'force_reveal', 'advance_identity', 'next_stage', 'next_round', 'back_to_lobby', 'end_game'];
      const action = prefer.find(a => actions.includes(a));
      if (!action) return;
      forcedAdvances++;
      log(`⚠️ 6 秒無進展，host 強制推進: ${action}（第 ${forcedAdvances} 次）`);
      lastEventAt = Date.now();
      if (forcedAdvances > 8) {
        return finish({ ok: false, endedNaturally: false, error: '強制推進超過 8 次仍未結束，流程疑似卡死' });
      }
      host.emit('host_next_phase', { roomId, data: { action } });
    }, 2000);
  });
}

module.exports = { runPlaytest };

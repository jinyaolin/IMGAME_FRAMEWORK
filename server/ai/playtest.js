'use strict';

// 無頭模擬測試：機器人玩家自動玩一輪模組，回傳事件時間軸摘要。
// 給 AI 編輯核心當「測試工具」用；也可單獨 require 使用。
const { io: ioClient } = require('socket.io-client');

const BOT_NAMES = ['小明', '小華', '小美', '阿強', '小芳', '大雄', '靜香', '胖虎'];

function runPlaytest({ moduleId, playerCount = 4, port = 3000, basePath = '', maxSeconds = 60 }) {
  const base = `http://127.0.0.1:${port}`;
  const timeline = [];
  const sockets = [];
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
    const bots = [];
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
        if (d.stageType === 'game') {
          // 亂按幾下搖桿
          for (let k = 0; k < 3; k++) {
            setTimeout(() => {
              bot.emit('player_action', { roomId, playerId: pid, action: 'game', data: { key: 'btn1', state: 'down', seq: k } });
              setTimeout(() => bot.emit('player_action', { roomId, playerId: pid, action: 'game', data: { key: 'btn1', state: 'up', seq: k } }), 120);
            }, 400 + k * 500 + i * 80);
          }
        }
      });
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

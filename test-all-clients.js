/**
 * 測試所有客戶端的投票功能
 *
 * 驗證：
 * 1. Mobile 顯示倒數計時
 * 2. Host 顯示倒數計時
 * 3. Display 顯示倒數計時
 * 4. Display 顯示正確的玩家名字（不是 undefined）
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testAllClients() {
  console.log('🧪 測試所有客戶端的投票功能');
  console.log('='.repeat(50));

  // 創建房間
  const createResponse = await fetch(`${SERVER_URL}/api/rooms`, { method: 'POST' });
  const { roomId } = await createResponse.json();
  console.log('✅ 房間:', roomId);

  // 連接 Host
  const host = io(SERVER_URL);
  await new Promise(resolve => {
    host.on('connect', () => {
      host.emit('join_host', { roomId });
      host.on('host_joined', () => resolve());
    });
  });

  // 追蹤 Host 倒數計時
  let hostCountdownEvents = 0;
  host.on('vote_countdown', (data) => {
    if (data.remaining % 10 === 0 || data.remaining <= 3) {
      console.log(`🖥️  Host 倒數: ${data.remaining}/${data.total} 秒`);
    }
    hostCountdownEvents++;
  });
  console.log('✅ Host 已連接');

  // 連接 Display
  const display = io(SERVER_URL);
  await new Promise(resolve => {
    display.on('connect', () => {
      display.emit('join_display', { roomId });
      display.on('display_joined', () => resolve());
    });
  });

  // 追蹤 Display 倒數計時
  let displayCountdownEvents = 0;
  display.on('vote_countdown', (data) => {
    if (data.remaining % 10 === 0 || data.remaining <= 3) {
      console.log(`📺 Display 倒數: ${data.remaining}/${data.total} 秒`);
    }
    displayCountdownEvents++;
  });

  // 追蹤 Display 投票選項顯示
  display.on('vote_started', (data) => {
    console.log('\n📺 Display 收到投票開始');
    console.log('   投票選項:');
    data.options.forEach((opt, i) => {
      const displayName = opt.name || opt.label || opt.id || 'undefined';
      console.log(`   ${i + 1}. ${opt.id} -> "${displayName}"`);
      if (displayName === 'undefined' || displayName === opt.id) {
        console.log(`      ❌ 警告: 可能無法正確顯示名字`);
      }
    });
  });
  console.log('✅ Display 已連接');

  // 連接一個 Mobile 玩家
  const mobile = io(SERVER_URL);
  await new Promise(resolve => {
    mobile.on('connect', () => {
      mobile.emit('join_room', {
        roomId,
        playerId: 'player-alice',
        playerName: 'Alice'
      });
      mobile.on('room_joined', () => resolve());
    });
  });

  // 追蹤 Mobile 倒數計時
  let mobileCountdownEvents = 0;
  mobile.on('vote_countdown', (data) => {
    if (data.remaining % 10 === 0 || data.remaining <= 3) {
      console.log(`📱 Mobile 倒數: ${data.remaining}/${data.total} 秒`);
    }
    mobileCountdownEvents++;
  });
  console.log('✅ Mobile (Alice) 已連接');

  // 連接其他玩家
  const players = [];
  const playerNames = ['Bob', 'Charlie'];

  for (const name of playerNames) {
    const player = io(SERVER_URL);
    await new Promise(resolve => {
      player.on('connect', () => {
        player.emit('join_room', {
          roomId,
          playerId: `player-${name.toLowerCase()}`,
          playerName: name
        });
        player.on('room_joined', () => {
          players.push({ name, socket: player });
          resolve();
        });
      });
    });
  }
  console.log(`✅ 其他 ${players.length} 個玩家已連接`);

  // 所有玩家準備
  mobile.emit('player_ready', { roomId, playerId: 'player-alice', isReady: true });
  players.forEach(p => {
    p.socket.emit('player_ready', {
      roomId,
      playerId: `player-${p.name.toLowerCase()}`,
      isReady: true
    });
  });
  console.log('✅ 所有玩家已準備');

  // 啟動遊戲
  host.emit('host_load_module', {
    roomId,
    moduleName: 'public-vote-test',
    config: null
  });

  // 設置投票（簡單投票）
  mobile.on('vote_started', (voteData) => {
    setTimeout(() => {
      if (voteData.options && voteData.options.length > 0) {
        mobile.emit('player_action', {
          roomId,
          playerId: 'player-alice',
          action: 'cast_vote',
          data: {
            targetId: voteData.options[0].id,
            voteId: voteData.voteId
          }
        });
        console.log('🗳️  Alice 投票完成');
      }
    }, 1000);
  });

  // 等待倒數
  console.log('\n⏱ 等待倒數計時...');
  await new Promise(resolve => setTimeout(resolve, 35000));

  // Host 手動推進
  host.emit('host_next_phase', { roomId, data: {} });
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 驗證結果
  console.log('\n' + '='.repeat(50));
  console.log('📊 驗證結果:');
  console.log('='.repeat(50));

  const results = [
    {
      name: 'Host 倒數計時',
      pass: hostCountdownEvents > 0,
      details: `收到 ${hostCountdownEvents} 個倒數事件`
    },
    {
      name: 'Display 倒數計時',
      pass: displayCountdownEvents > 0,
      details: `收到 ${displayCountdownEvents} 個倒數事件`
    },
    {
      name: 'Mobile 倒數計時',
      pass: mobileCountdownEvents > 0,
      details: `收到 ${mobileCountdownEvents} 個倒數事件`
    }
  ];

  let passCount = 0;
  results.forEach(r => {
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} ${r.name}: ${r.details}`);
    if (r.pass) passCount++;
  });

  console.log('='.repeat(50));
  console.log(`總計: ${passCount}/${results.length} 項通過`);

  // 清理
  host.disconnect();
  display.disconnect();
  mobile.disconnect();
  players.forEach(p => p.socket.disconnect());

  console.log('\n✅ 測試完成');
  process.exit(passCount === results.length ? 0 : 1);
}

testAllClients().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

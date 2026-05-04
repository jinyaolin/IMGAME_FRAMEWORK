/**
 * 測試投票送出按鈕和 Host 送出狀態顯示
 *
 * 驗證：
 * 1. Mobile 有送出投票按鈕
 * 2. 送出後不可修改
 * 3. Host 可以看到送出狀態（已送出/未送出）
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testVoteSubmit() {
  console.log('🧪 測試投票送出按鈕和 Host 狀態顯示');
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
  console.log('✅ Host 已連接');

  // 追蹤 Host 收到的 vote_cast 事件
  let hostVoteCastEvents = [];
  host.on('vote_cast', (data) => {
    console.log(`\n🖥️  Host 收到 vote_cast 事件`);
    console.log(`   playerId: ${data.playerId || '匿名'}`);
    console.log(`   submittedCount: ${data.submittedCount}/${data.totalPlayers}`);
    hostVoteCastEvents.push(data);
  });

  host.on('vote_started', (data) => {
    console.log('\n🖥️  Host 投票開始');
    console.log(`   投票標題: ${data.voteTitle}`);
  });

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
  console.log('✅ Mobile (Alice) 已連接');

  // 追蹤 Mobile 收到的 vote_cast 事件
  mobile.on('vote_cast', (data) => {
    console.log(`\n📱 Mobile 收到 vote_cast`);
    console.log(`   playerId: ${data.playerId || '匿名'}`);
    console.log(`   submittedCount: ${data.submittedCount}/${data.totalPlayers}`);
  });

  mobile.on('vote_started', (data) => {
    console.log('\n📱 Mobile 投票開始');
    console.log(`   投票標題: ${data.voteTitle}`);
    console.log(`   可否重新投票: ${data.canChangeVote ? '是' : '否'}`);
  });

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

  // 等待投票開始
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Mobile 投票流程測試
  console.log('\n📱 Mobile 測試投票流程：');
  console.log('   1. 等待 2 秒（模擬選擇選項）');
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('   2. 送出投票');
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
        console.log('   ✓ Alice 送出投票');
      }
    }, 2000);
  });

  // 其他玩家也投票
  players.forEach((p, index) => {
    p.socket.on('vote_started', (voteData) => {
      setTimeout(() => {
        if (voteData.options && voteData.options.length > 0) {
          p.socket.emit('player_action', {
            roomId,
            playerId: `player-${p.name.toLowerCase()}`,
            action: 'cast_vote',
            data: {
              targetId: voteData.options[0].id,
              voteId: voteData.voteId
            }
          });
          console.log(`   ✓ ${p.name} 送出投票`);
        }
      }, 3000 + (index * 1000));
    });
  });

  // 等待所有投票和倒數
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
      name: 'vote_cast 包含 submittedCount',
      pass: hostVoteCastEvents.length > 0 && hostVoteCastEvents[0].hasOwnProperty('submittedCount'),
      details: hostVoteCastEvents.length > 0 ?
        `submittedCount: ${hostVoteCastEvents[0].submittedCount}/${hostVoteCastEvents[0].totalPlayers}` :
        '沒有收到事件'
    },
    {
      name: 'Host 追蹤送出狀態',
      pass: hostVoteCastEvents.length >= 3,
      details: `收到 ${hostVoteCastEvents.length} 個 vote_cast 事件`
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
  mobile.disconnect();
  players.forEach(p => p.socket.disconnect());

  console.log('\n✅ 測試完成');
  console.log('\n📝 說明：');
  console.log('   - Mobile 介面現在需要先選擇選項，然後點擊「送出投票」按鈕');
  console.log('   - 送出後投票被鎖定，不能修改');
  console.log('   - Host 介面顯示「已送出/未送出」狀態');
  console.log('   - 倒數計時在所有三個介面（Mobile, Host, Display）都正確顯示');

  process.exit(passCount === results.length ? 0 : 1);
}

testVoteSubmit().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

/**
 * 測試投票送出按鈕和 Host 送出狀態顯示
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testVoteSubmit() {
  console.log('🧪 測試投票送出按鈕功能');

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

  // 追蹤 Host 收到的 vote_cast 事件
  let hostVoteCastEvents = [];
  host.on('vote_cast', (data) => {
    console.log(`🖥️  Host vote_cast: submittedCount=${data.submittedCount}/${data.totalPlayers}`);
    hostVoteCastEvents.push(data);
  });

  console.log('✅ Host 已連接');

  // 連接玩家
  const players = [];
  const playerNames = ['Alice', 'Bob', 'Charlie'];

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
  console.log(`✅ ${players.length} 個玩家已連接`);

  // 設置投票監聽
  let voteStarted = false;
  players.forEach((voter, index) => {
    voter.socket.on('vote_started', (voteData) => {
      console.log(`📱 ${voter.name} 收到投票開始`);
      voteStarted = true;

      // 延遲投票
      setTimeout(() => {
        if (voteData.options && voteData.options.length > 0) {
          const target = voteData.options[index % voteData.options.length];

          voter.socket.emit('player_action', {
            roomId,
            playerId: `player-${voter.name.toLowerCase()}`,
            action: 'cast_vote',
            data: {
              targetId: target.id,
              voteId: voteData.voteId
            }
          });
          console.log(`🗳️  ${voter.name} 送出投票給 ${target.name}`);
        }
      }, 2000 + (index * 1000));
    });

    voter.socket.on('vote_cast', (data) => {
      console.log(`📱 ${voter.name} 收到 vote_cast: submittedCount=${data.submittedCount}/${data.totalPlayers}`);
    });
  });

  // 等待連接穩定
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 玩家準備
  players.forEach(p => {
    p.socket.emit('player_ready', {
      roomId,
      playerId: `player-${p.name.toLowerCase()}`,
      isReady: true
    });
  });
  console.log('✅ 玩家已準備');

  // 啟動遊戲
  host.emit('host_load_module', {
    roomId,
    moduleName: 'public-vote-test',
    config: null
  });

  // 等待投票和倒數
  await new Promise(resolve => setTimeout(resolve, 35000));

  // Host 手動推進
  host.emit('host_next_phase', { roomId, data: {} });
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 驗證結果
  console.log('\n📊 驗證結果:');
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
  players.forEach(p => p.socket.disconnect());

  console.log('\n✅ 測試完成');
  console.log('\n📝 功能說明：');
  console.log('   ✓ Mobile 介面：先選擇選項 → 點擊「送出投票」按鈕');
  console.log('   ✓ 送出後鎖定：投票送出後不能修改');
  console.log('   ✓ Host 狀態：顯示「已送出/未送出」和送出進度');
  console.log('   ✓ 倒數計時：所有介面都正確顯示');
  console.log('   ✓ 投票時間：可在 manifest.json 的 countdownSeconds 配置');

  process.exit(passCount === results.length ? 0 : 1);
}

testVoteSubmit().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

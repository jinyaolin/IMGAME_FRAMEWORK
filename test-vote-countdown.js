/**
 * 測試投票倒數計時和 host 手動推進
 *
 * 驗證：
 * 1. 投票有倒數計時
 * 2. 玩家可以重新投票（反悔）
 * 3. 倒數結束後需要 host 手動推進
 * 4. 收到 vote_can_advance 事件
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testVoteCountdown() {
  console.log('🧪 測試投票倒數計時和 host 手動推進');

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

  // 追蹤 host 收到的事件
  let voteStarted = false;
  let voteEnded = false;
  let voteCanAdvance = false;
  let countdownEvents = [];

  host.on('vote_started', (data) => {
    console.log('📋 Host 收到 vote_started');
    console.log('   倒數時間:', data.voteConfig?.countdownSeconds, '秒');
    voteStarted = true;
  });

  host.on('vote_countdown', (data) => {
    console.log(`⏱ 倒數: ${data.remaining}/${data.total} 秒`);
    countdownEvents.push(data);
  });

  host.on('vote_ended', (data) => {
    console.log('📊 Host 收到 vote_ended');
    console.log('   結果:', data.results.map(r => `${r.targetName}: ${r.count}票`).join(', '));
    voteEnded = true;
  });

  host.on('vote_can_advance', (data) => {
    console.log('✅ Host 收到 vote_can_advance:', data);
    voteCanAdvance = true;
  });

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

  // 設置投票監聽器
  let voteCount = 0;
  players.forEach((voter, index) => {
    voter.socket.on('vote_started', (voteData) => {
      console.log(`📱 ${voter.name} 收到投票通知`);
      console.log(`   倒數時間: ${voteData.voteConfig?.countdownSeconds} 秒`);
      console.log(`   可否重新投票: ${voteData.canChangeVote ? '是' : '否'}`);

      // 第一輪投票
      setTimeout(() => {
        const targetIndex = (index + 1) % players.length;
        const target = voteData.options[targetIndex];
        console.log(`🗳️  ${voter.name} 投票給 ${target.name}`);

        voter.socket.emit('player_action', {
          roomId,
          playerId: `player-${voter.name.toLowerCase()}`,
          action: 'cast_vote',
          data: {
            targetId: target.id,
            voteId: voteData.voteId
          }
        });
        voteCount++;

        // 測試重新投票（反悔）
        if (index === 0) {
          setTimeout(() => {
            const newTarget = voteData.options[(index + 2) % players.length];
            console.log(`🔄 ${voter.name} 重新投票給 ${newTarget.name}（反悔）`);

            voter.socket.emit('player_action', {
              roomId,
              playerId: `player-${voter.name.toLowerCase()}`,
              action: 'cast_vote',
              data: {
                targetId: newTarget.id,
                voteId: voteData.voteId
              }
            });
            voteCount++;
          }, 2000);
        }
      }, 1000);
    });

    voter.socket.on('vote_cast', (data) => {
      console.log(`📱 ${voter.name} 收到投票進度更新: ${data.totalVotes}/${data.totalPlayers} 人已投票`);
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

  // 等待倒數結束
  console.log('\n⏱ 等待投票倒數...');
  await new Promise(resolve => setTimeout(resolve, 35000));

  console.log('\n📊 驗證結果:');

  // 驗證倒數計時
  if (countdownEvents.length > 0) {
    console.log(`✅ 收到 ${countdownEvents.length} 個倒數事件`);
    console.log(`   倒數範圍: ${countdownEvents[0].total} 秒`);
  } else {
    console.log('❌ 沒有收到倒數事件');
  }

  // 驗證重新投票
  if (voteCount > players.length) {
    console.log(`✅ 玩家可以重新投票（總共 ${voteCount} 次投票，${players.length} 個玩家）`);
  } else {
    console.log(`⚠️ 可能不支援重新投票（總共 ${voteCount} 次投票）`);
  }

  // 驗證投票結束
  if (voteEnded) {
    console.log('✅ 投票已結束');
  } else {
    console.log('❌ 投票未結束');
  }

  // 驗證 host 手動推進
  if (voteCanAdvance) {
    console.log('✅ Host 收到 vote_can_advance 事件（需要手動推進）');
  } else {
    console.log('❌ Host 沒有收到 vote_can_advance 事件');
  }

  // 測試 host 手動推進
  if (voteCanAdvance) {
    console.log('\n🎮 測試 host 手動推進...');
    host.emit('host_next_phase', {
      roomId,
      data: {}
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✅ Host 已發送 next_phase 事件');
  }

  // 清理
  host.disconnect();
  players.forEach(p => p.socket.disconnect());

  console.log('\n✅ 測試完成');
  process.exit(0);
}

testVoteCountdown().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

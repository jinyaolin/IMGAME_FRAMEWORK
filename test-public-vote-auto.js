/**
 * 測試公開投票功能（自動投票版本）
 *
 * 驗證：
 * 1. 投票結果正確顯示玩家名字（不是 undefined）
 * 2. 公開投票顯示誰投了誰
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testPublicVoteAuto() {
  console.log('🧪 測試公開投票功能（自動投票）');

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

  // 設置投票監聽器（在連接後立即設置）
  players.forEach((voter, index) => {
    voter.socket.on('vote_started', (voteData) => {
      console.log(`📱 ${voter.name} 收到投票通知`);
      console.log(`   投票類型: ${voteData.anonymous ? '匿名' : '公開'}`);

      if (voteData.options && voteData.options.length > 0) {
        const targetIndex = (index + 1) % players.length;
        const target = voteData.options[targetIndex];
        console.log(`🗳️  ${voter.name} 投票給 ${target.name}`);

        // 發送投票
        voter.socket.emit('player_action', {
          roomId,
          playerId: `player-${voter.name.toLowerCase()}`,
          action: 'cast_vote',
          data: {
            targetId: target.id,
            voteId: voteData.voteId
          }
        });
        console.log(`✓ ${voter.name} 投票已發送`);
      }
    });

    voter.socket.on('vote_ended', (data) => {
      console.log(`📱 ${voter.name} 收到投票結果`);
      if (data.results) {
        data.results.forEach((result) => {
          console.log(`   ${result.targetName}: ${result.count} 票`);
          if (result.voters && result.voters.length > 0) {
            console.log(`      投票者: ${result.voters.join(', ')}`);
          }
        });

        // 檢查是否有 undefined
        const hasUndefined = data.results.some(r => !r.targetName || r.targetName === 'undefined');
        if (hasUndefined) {
          console.log('❌ 錯誤: 發現 undefined 名字！');
        } else {
          console.log('✅ 名字顯示正確');
        }
      }
    });
  });

  // Host 監聽投票結果
  let hostVoteResults = null;
  host.on('vote_ended', (data) => {
    console.log('📊 Host 收到投票結果:', data);
    hostVoteResults = data.results;
  });

  // Host 監聽遊戲完成
  let gameCompleted = false;
  host.on('game_complete', (data) => {
    console.log('🎉 遊戲完成！');
    gameCompleted = true;
  });

  // 等待玩家連接穩定
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

  // Host 啟動遊戲（使用公開投票測試模組）
  host.emit('host_load_module', {
    roomId,
    moduleName: 'public-vote-test',
    config: null
  });

  // 等待投票完成
  await new Promise(resolve => setTimeout(resolve, 15000));

  if (hostVoteResults) {
    console.log('\n📊 最終投票結果驗證:');
    hostVoteResults.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.targetName}: ${result.count} 票`);
      if (result.voters && result.voters.length > 0) {
        console.log(`      🗳️  投票者: ${result.voters.join(', ')}`);
      } else if (result.voters === null) {
        console.log(`      🔒 匿名投票`);
      }
    });

    // 驗證功能
    const hasUndefinedNames = hostVoteResults.some(r => !r.targetName || r.targetName === 'undefined');
    const hasVotersData = hostVoteResults.some(r => r.voters && r.voters.length > 0);

    if (!hasUndefinedNames) {
      console.log('✅ 投票結果名字顯示正確（無 undefined）');
    } else {
      console.log('❌ 投票結果中有 undefined 名字');
    }

    if (hasVotersData) {
      console.log('✅ 公開投票功能正常（顯示投票者）');
    } else {
      console.log('⚠️  可能不是公開投票或沒有投票者資料');
    }
  }

  // 驗證遊戲自動完成
  if (gameCompleted) {
    console.log('✅ 遊戲正確自動完成（投票後自動進入下一步）');
  } else {
    console.log('⚠️  遊戲未自動完成（可能需要手動點擊下一步）');
  }

  // 清理
  host.disconnect();
  players.forEach(p => p.socket.disconnect());

  console.log('\n✅ 測試完成');
  process.exit(0);
}

testPublicVoteAuto().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

/**
 * 測試 Display 介面的投票結果顯示
 *
 * 驗證：
 * 1. 投票結果中 targetName 正確
 * 2. 投票結果中 voters 顯示玩家名字（不是 undefined 或 playerId）
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testDisplayVote() {
  console.log('🧪 測試 Display 投票結果顯示');

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

  // 連接 Display
  const display = io(SERVER_URL);
  await new Promise(resolve => {
    display.on('connect', () => {
      display.emit('join_display', { roomId });
      display.on('display_joined', () => {
        console.log('✅ Display 已連接');
        resolve();
      });
    });
  });

  // 追蹤 Display 收到的事件
  let displayVoteResults = null;

  display.on('vote_started', (data) => {
    console.log('\n📺 Display 收到 vote_started');
    console.log('   投票標題:', data.voteTitle);
    console.log('   投票類型:', data.anonymous ? '匿名' : '公開');
    console.log('   投票選項:', data.options.map(o => o.name).join(', '));
  });

  display.on('vote_ended', (data) => {
    console.log('\n📺 Display 收到 vote_ended');
    console.log('   結果數量:', data.results.length);
    console.log('   匿名投票:', data.anonymous);

    displayVoteResults = data.results;

    data.results.forEach((result, index) => {
      console.log(`\n   結果 ${index + 1}:`);
      console.log(`      targetId: ${result.targetId}`);
      console.log(`      targetName: ${result.targetName}`);
      console.log(`      票數: ${result.count}`);
      console.log(`      voters: ${JSON.stringify(result.voters)}`);

      // 檢查是否有 undefined
      if (!result.targetName || result.targetName === result.targetId) {
        console.log(`      ❌ 警告: targetName 可能是 undefined 或使用了 targetId`);
      }
      if (result.voters && result.voters.length > 0) {
        const hasUndefined = result.voters.some(v => !v || v === 'undefined');
        const hasPlayerIdFormat = result.voters.some(v => v && v.startsWith('player-'));
        if (hasUndefined) {
          console.log(`      ❌ 警告: voters 中包含 undefined`);
        }
        if (hasPlayerIdFormat) {
          console.log(`      ❌ 警告: voters 中包含 playerId 而不是玩家名字`);
        }
      }
    });
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
  players.forEach((voter, index) => {
    voter.socket.on('vote_started', (voteData) => {
      setTimeout(() => {
        const targetIndex = (index + 1) % players.length;
        const target = voteData.options[targetIndex];

        voter.socket.emit('player_action', {
          roomId,
          playerId: `player-${voter.name.toLowerCase()}`,
          action: 'cast_vote',
          data: {
            targetId: target.id,
            voteId: voteData.voteId
          }
        });
        console.log(`🗳️  ${voter.name} 投票給 ${target.name}`);
      }, 500);
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

  // 等待投票結束
  await new Promise(resolve => setTimeout(resolve, 35000));

  // Host 手動推進
  host.emit('host_next_phase', { roomId, data: {} });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // 驗證結果
  console.log('\n' + '='.repeat(50));
  console.log('📊 驗證結果:');
  console.log('='.repeat(50));

  if (!displayVoteResults) {
    console.log('❌ Display 沒有收到投票結果');
    host.disconnect();
    display.disconnect();
    players.forEach(p => p.socket.disconnect());
    process.exit(1);
  }

  let allPass = true;

  // 檢查 targetName
  const hasBadTargetNames = displayVoteResults.some(r =>
    !r.targetName || r.targetName === r.targetId || r.targetName === 'undefined'
  );

  if (hasBadTargetNames) {
    console.log('❌ targetName 有問題（可能是 undefined 或使用了 targetId）');
    allPass = false;
  } else {
    console.log('✅ targetName 正確顯示玩家名字');
  }

  // 檢查 voters
  const hasBadVoters = displayVoteResults.some(r => {
    if (!r.voters || r.voters.length === 0) return false;
    return r.voters.some(v =>
      !v || v === 'undefined' || v.startsWith('player-')
    );
  });

  if (hasBadVoters) {
    console.log('❌ voters 有問題（可能是 undefined 或使用了 playerId）');
    allPass = false;
  } else {
    console.log('✅ voters 正確顯示玩家名字');
  }

  // 清理
  host.disconnect();
  display.disconnect();
  players.forEach(p => p.socket.disconnect());

  console.log('\n' + '='.repeat(50));
  if (allPass) {
    console.log('✅ 所有測試通過');
    process.exit(0);
  } else {
    console.log('❌ 部分測試失敗');
    process.exit(1);
  }
}

testDisplayVote().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

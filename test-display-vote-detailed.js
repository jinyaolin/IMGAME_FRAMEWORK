/**
 * 詳細測試 Display 投票結果
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testDisplayVoteDetails() {
  console.log('🧪 詳細測試 Display 投票結果');

  // 創建房間
  const createResponse = await fetch(`${SERVER_URL}/api/rooms`, { method: 'POST' });
  const { roomId } = await createResponse.json();
  console.log('✅ 房間:', roomId);

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

  // 連接 Host
  const host = io(SERVER_URL);
  await new Promise(resolve => {
    host.on('connect', () => {
      host.emit('join_host', { roomId });
      host.on('host_joined', () => {
        console.log('✅ Host 已連接');
        resolve();
      });
    });
  });

  // 詳細追蹤 vote_ended
  display.on('vote_ended', (data) => {
    console.log('\n📺 Display 收到 vote_ended');
    console.log('   完整資料:', JSON.stringify(data, null, 2));

    console.log('\n📊 分析結果:');
    data.results.forEach((result, i) => {
      console.log(`\n   結果 ${i+1}:`);
      console.log(`      targetId: "${result.targetId}"`);
      console.log(`      targetName: "${result.targetName}"`);
      console.log(`      count: ${result.count}`);
      console.log(`      voters:`, result.voters);
      console.log(`      anonymous: ${data.anonymous}`);

      // 檢查問題
      if (!result.targetName || result.targetName === 'undefined' || result.targetName === result.targetId) {
        console.log(`      ❌ targetName 有問題！`);
      } else {
        console.log(`      ✅ targetName 正確`);
      }

      if (data.anonymous === false) {
        if (!result.voters || result.voters.length === 0) {
          console.log(`      ❌ 應該是公開投票但沒有 voters 資料！`);
        } else if (typeof result.voters[0] === 'string') {
          console.log(`      ✅ voters 正確（名字陣列）`);
        } else {
          console.log(`      ❌ voters 格式錯誤：`, typeof result.voters[0]);
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

  // 設置投票
  players.forEach((voter, index) => {
    voter.socket.on('vote_started', (voteData) => {
      console.log(`\n📱 ${voter.name} 收到投票`);
      console.log(`   anonymous: ${voteData.anonymous}`);
      console.log(`   canChangeVote: ${voteData.canChangeVote}`);

      setTimeout(() => {
        if (voteData.options && voteData.options.length > 0) {
          const target = voteData.options[(index + 1) % voteData.options.length];
          voter.socket.emit('player_action', {
            roomId,
            playerId: `player-${voter.name.toLowerCase()}`,
            action: 'cast_vote',
            data: {
              targetId: target.id,
              voteId: voteData.voteId
            }
          });
          console.log(`🗳️  ${voter.name} 投票給 ${target.name || target.id}`);
        }
      }, 1000);
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

  // 等待投票完成
  await new Promise(resolve => setTimeout(resolve, 35000));

  // Host 手動推進
  host.emit('host_next_phase', { roomId, data: {} });
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 清理
  host.disconnect();
  display.disconnect();
  players.forEach(p => p.socket.disconnect());

  console.log('\n✅ 測試完成');
  process.exit(0);
}

testDisplayVoteDetails().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

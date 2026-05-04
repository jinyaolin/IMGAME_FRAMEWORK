/**
 * 測試 Display 投票結果顯示
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testDisplayVote() {
  console.log('🧪 測試 Display 投票結果顯示');

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

  // 追蹤 vote_started
  display.on('vote_started', (data) => {
    console.log('\n📺 Display 收到 vote_started');
    console.log('   options:', data.options.map(o => ({
      id: o.id,
      name: o.name,
      label: o.label
    })));
  });

  // 追蹤 vote_ended
  display.on('vote_ended', (data) => {
    console.log('\n📺 Display 收到 vote_ended');
    console.log('   results:', data.results.map(r => ({
      targetId: r.targetId,
      targetName: r.targetName,
      count: r.count,
      voters: r.voters
    })));

    // 檢查是否有 undefined
    const hasUndefinedNames = data.results.some(r => 
      !r.targetName || r.targetName === 'undefined' || r.targetName === r.targetId
    );
    
    if (hasUndefinedNames) {
      console.log('\n❌ 發現 undefined 名字！');
      data.results.forEach((r, i) => {
        if (!r.targetName || r.targetName === 'undefined') {
          console.log(`   結果 ${i+1}: targetName="${r.targetName}", targetId="${r.targetId}"`);
        }
      });
    } else {
      console.log('\n✅ 所有名字都正確');
    }
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
          console.log(`🗳️  ${voter.name} 投票給 ${target.name || target.id}`);
        }
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

testDisplayVote().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

/**
 * 測試公開投票功能
 *
 * 驗證：
 * 1. 投票結果正確顯示玩家名字
 * 2. 公開投票顯示誰投了誰
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testPublicVote() {
  console.log('🧪 測試公開投票功能');

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

  // 等待一下
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

  // Host 啟動遊戲
  host.emit('host_load_module', {
    roomId,
    moduleName: 'vote-demo',
    config: null
  });

  // 監聽投票結果
  let voteResults = null;
  host.on('vote_ended', (data) => {
    console.log('📊 Host 收到投票結果:', data);
    voteResults = data.results;
  });

  players.forEach(p => {
    p.socket.on('vote_ended', (data) => {
      console.log(`📱 ${p.name} 收到投票結果:`, data);
    });
  });

  // 等待測試完成
  await new Promise(resolve => setTimeout(resolve, 10000));

  if (voteResults) {
    console.log('\n📊 最終投票結果:');
    voteResults.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.targetName}: ${result.count} 票`);
      if (result.voters && result.voters.length > 0) {
        console.log(`      投票者: ${result.voters.join(', ')}`);
      } else {
        console.log(`      投票者: 匿名`);
      }
    });

    // 驗證名字不是 undefined
    const hasUndefinedNames = voteResults.some(r => !r.targetName || r.targetName === 'undefined');
    if (hasUndefinedNames) {
      console.log('❌ 錯誤: 投票結果中有 undefined 名字');
    } else {
      console.log('✅ 投票結果名字顯示正確');
    }
  }

  // 清理
  host.disconnect();
  players.forEach(p => p.socket.disconnect());

  console.log('\n✅ 測試完成');
  process.exit(0);
}

testPublicVote().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

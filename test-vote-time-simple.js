/**
 * 測試投票時間配置功能
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testVoteTimeConfig() {
  console.log('🧪 測試投票時間配置功能');

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

  // 連接 3 個玩家
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

  // 追蹤倒數計時
  let countdownTotalTime = null;
  players[0].socket.on('vote_countdown', (data) => {
    if (data.remaining === data.total && countdownTotalTime === null) {
      countdownTotalTime = data.total;
      console.log(`\n⏱ 投票倒數開始`);
      console.log(`   總時間: ${data.total} 秒`);
      console.log(`   預期: 20 秒（自定義時間）`);
    }
  });

  // 玩家準備
  players.forEach(p => {
    p.socket.emit('player_ready', {
      roomId,
      playerId: `player-${p.name.toLowerCase()}`,
      isReady: true
    });
  });
  console.log('✅ 玩家已準備');

  // 載入模組，設置自定義投票時間 20 秒
  console.log('\n📝 設置投票時間為 20 秒');
  host.emit('host_load_module', {
    roomId,
    moduleName: 'public-vote-test',
    config: {
      voteTimeOverride: 20  // 自定義投票時間 20 秒
    }
  });

  // 等待倒數
  await new Promise(resolve => setTimeout(resolve, 25000));

  // 驗證結果
  console.log('\n📊 驗證結果:');
  console.log('='.repeat(50));

  if (countdownTotalTime !== null) {
    const result = countdownTotalTime === 20;

    console.log(`${result ? '✅' : '❌'} 投票時間配置`);
    console.log(`   預期: 20 秒`);
    console.log(`   實際: ${countdownTotalTime} 秒`);
    console.log(`   結果: ${result ? '通過' : '失敗'}`);

    // 清理
    host.disconnect();
    players.forEach(p => p.socket.disconnect());

    console.log('\n✅ 測試完成');

    process.exit(result ? 0 : 1);
  } else {
    console.log('❌ 沒有收到倒數計時事件');

    // 清理
    host.disconnect();
    players.forEach(p => p.socket.disconnect());

    process.exit(1);
  }
}

testVoteTimeConfig().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

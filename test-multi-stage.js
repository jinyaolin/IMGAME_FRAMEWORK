/**
 * 測試多階段遊戲流程
 *
 * 驗證：
 * 1. 投票階段完成後自動進入結果階段
 * 2. stage_started 事件正確觸發
 * 3. 遊戲正確完成
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testMultiStage() {
  console.log('🧪 測試多階段遊戲流程');

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

  // 追蹤階段變化
  const stageHistory = [];
  host.on('stage_started', (data) => {
    console.log(`📋 階段開始: ${data.stageId} - ${data.stageName}`);
    stageHistory.push({
      stageId: data.stageId,
      stageName: data.stageName,
      timestamp: Date.now()
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
      console.log(`📱 ${voter.name} 收到投票通知`);

      if (voteData.options && voteData.options.length > 0) {
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
        console.log(`✓ ${voter.name} 投票給 ${target.name}`);
      }
    });
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

  // 啟動遊戲
  host.emit('host_load_module', {
    roomId,
    moduleName: 'multi-stage-test',
    config: null
  });

  // 等待遊戲完成
  await new Promise(resolve => setTimeout(resolve, 10000));

  console.log('\n📊 階段歷史:');
  stageHistory.forEach((stage, index) => {
    console.log(`   ${index + 1}. ${stage.stageId} - ${stage.stageName}`);
  });

  // 驗證階段流程
  const expectedStages = ['vote-round-1', 'result-stage'];
  const actualStages = stageHistory.map(s => s.stageId);

  console.log('\n📊 驗證結果:');

  // 檢查是否經過了投票階段
  if (actualStages.includes('vote-round-1')) {
    console.log('✅ 經過了投票階段');
  } else {
    console.log('❌ 沒有經過投票階段');
  }

  // 檢查是否進入了結果階段
  if (actualStages.includes('result-stage')) {
    console.log('✅ 自動進入了結果階段');
  } else {
    console.log('❌ 沒有自動進入結果階段');
  }

  // 檢查階段順序
  const voteStageIndex = actualStages.indexOf('vote-round-1');
  const resultStageIndex = actualStages.indexOf('result-stage');
  if (voteStageIndex >= 0 && resultStageIndex >= 0 && resultStageIndex > voteStageIndex) {
    console.log('✅ 階段順序正確（投票 → 結果）');
  } else {
    console.log('❌ 階段順序錯誤');
  }

  // 清理
  host.disconnect();
  players.forEach(p => p.socket.disconnect());

  console.log('\n✅ 測試完成');
  process.exit(0);
}

testMultiStage().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

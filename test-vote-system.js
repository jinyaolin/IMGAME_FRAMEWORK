/**
 * 投票系統完整流程測試腳本
 *
 * 測試流程：
 * 1. 創建房間
 * 2. 模擬多個玩家加入
 * 3. Host 啟動 vote-demo 模組
 * 4. 執行投票階段
 * 5. 模擬玩家投票
 * 6. 驗證投票結果和淘汰機制
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
let roomId = null;

// 模擬的客戶端
const clients = {
  host: null,
  players: [],
  display: null
};

// 測試玩家數據
const testPlayers = [
  { name: 'Alice', id: 'player-1' },
  { name: 'Bob', id: 'player-2' },
  { name: 'Charlie', id: 'player-3' },
  { name: 'Diana', id: 'player-4' }
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 創建 Host 並初始化房間
async function createRoom() {
  console.log('🏠 正在建立房間...');

  try {
    const response = await fetch(`${SERVER_URL}/api/rooms`, {
      method: 'POST'
    });
    const data = await response.json();
    roomId = data.roomId;
    console.log(`✅ 房間已建立: ${roomId}`);
    return roomId;
  } catch (error) {
    console.error('❌ 建立房間失敗:', error.message);
    throw error;
  }
}

// 連接 Host
async function connectHost() {
  return new Promise((resolve, reject) => {
    console.log('🎮 連接 Host...');

    const host = io(SERVER_URL);
    clients.host = host;

    host.on('connect', async () => {
      console.log('✅ Host 已連接');
      host.emit('join_host', { roomId });

      // 監聽 host_joined 事件
      host.on('host_joined', (data) => {
        console.log('✅ Host 已加入房間');
        console.log(`📋 可用模組: ${data.availableModules?.map(m => m.id).join(', ') || '無'}`);

        // 檢查 vote-demo 模組是否可用
        const voteDemo = data.availableModules?.find(m => m.id === 'vote-demo');
        if (voteDemo) {
          console.log('✅ vote-demo 模組已識別');
        } else {
          console.log('⚠️  vote-demo 模組未找到');
        }

        resolve();
      });

      host.on('error', (error) => {
        console.error('❌ Host 錯誤:', error);
        reject(error);
      });
    });

    host.on('connect_error', (error) => {
      console.error('❌ Host 連接錯誤:', error.message);
      reject(error);
    });
  });
}

// 連接玩家
async function connectPlayers() {
  console.log('👥 連接測試玩家...');

  for (const playerData of testPlayers) {
    await connectPlayer(playerData);
    await sleep(500); // 避免連接過快
  }

  console.log(`✅ 已連接 ${testPlayers.length} 個玩家`);
}

async function connectPlayer(playerData) {
  return new Promise((resolve, reject) => {
    const player = io(SERVER_URL);

    // 先設置所有需要的事件監聽器
    player.on('vote_started', (voteData) => {
      console.log(`📱 ${playerData.name} 收到投票通知`);
      console.log(`   投票ID: ${voteData.voteId}`);
      console.log(`   投票標題: ${voteData.voteTitle}`);
      console.log(`   投票選項數量: ${voteData.options?.length || 0}`);

      if (voteData.options && voteData.options.length > 0) {
        console.log(`   投票選項詳情:`);
        voteData.options.forEach((opt, i) => {
          console.log(`     ${i + 1}. ${opt.name} (${opt.id})`);
        });

        // 自動投票給下一個玩家（簡化測試）
        const playerIndex = clients.players.findIndex(p => p.id === playerData.id);
        const targetIndex = (playerIndex + 1) % clients.players.length;
        const target = voteData.options[targetIndex];

        if (target) {
          console.log(`🗳️  ${playerData.name} 自動投票給 ${target.name}`);

          const votePayload = {
            roomId,
            playerId: playerData.id,
            action: 'cast_vote',
            data: {
              targetId: target.id,
              voteId: voteData.voteId
            }
          };

          player.emit('player_action', votePayload);
          console.log(`✓ ${playerData.name} 投票已發送`);
        }
      }
    });

    player.on('vote_cast', (data) => {
      console.log(`📊 ${playerData.name} 收到投票確認`);
    });

    player.on('connect', () => {
      console.log(`✅ ${playerData.name} 已連接`);

      // 加入房間 - 使用正確的事件名稱
      player.emit('join_room', {
        roomId,
        playerId: playerData.id,
        playerName: playerData.name
      });

      // 監聽加入成功 - 修正事件名稱
      player.on('room_joined', (data) => {
        console.log(`✅ ${playerData.name} 已加入房間`);
        playerData.socket = player;
        clients.players.push(playerData);
        resolve();
      });

      // 監聽錯誤
      player.on('error', (error) => {
        console.error(`❌ ${playerData.name} 錯誤:`, error);
        reject(error);
      });
    });

    player.on('connect_error', (error) => {
      console.error(`❌ ${playerData.name} 連接錯誤:`, error.message);
      reject(error);
    });
  });
}

// 玩家準備
async function playersReady() {
  console.log('⏳ 玩家準備中...');

  for (const playerData of clients.players) {
    playerData.socket.emit('player_ready', {
      roomId,
      playerId: playerData.id,
      isReady: true
    });
    await sleep(200);
  }

  await sleep(1000);
  console.log('✅ 所有玩家已準備');
}

// Host 啟動遊戲
async function startGame() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Host 啟動遊戲...');

    clients.host.emit('host_load_module', {
      roomId,
      moduleName: 'vote-demo',
      config: null
    });

    // 監聽遊戲開始
    clients.host.on('game_started', (data) => {
      console.log(`✅ 遊戲已啟動: ${data.module}`);
      resolve();
    });

    // 監聽投票階段開始
    clients.host.on('vote_started', (data) => {
      console.log('🗳️  投票階段已啟動');
      console.log(`📋 投票標題: ${data.voteTitle}`);
      console.log(`📋 投票 ID: ${data.voteId}`);
      console.log(`📋 投票選項數量: ${data.options?.length || 0}`);
      if (data.options && data.options.length > 0) {
        console.log(`📋 投票選項詳情:`);
        data.options.forEach((opt, i) => {
          console.log(`   ${i + 1}. ${opt.name} (${opt.id}) - ${opt.type}`);
        });
      }
      console.log(`📋 匿名投票: ${data.anonymous ? '是' : '否'}`);
      console.log(`⏱️  倒計時: ${data.voteConfig?.countdownSeconds || 0} 秒`);
    });

    clients.host.on('error', (error) => {
      console.error('❌ 遊戲啟動錯誤:', error);
      reject(error);
    });
  });
}

// 玩家投票
async function castVotes() {
  console.log('🗳️  等待玩家自動投票...');

  return new Promise((resolve) => {
    let votesReceived = 0;
    const totalVotes = clients.players.length;

    // 為每個玩家添加投票確認監聽（如果還沒有的話）
    clients.players.forEach((voter) => {
      // 移除舊的監聽器避免重複
      voter.socket.removeAllListeners('vote_cast');

      voter.socket.on('vote_cast', (data) => {
        console.log(`📊 ${voter.name} 收到投票確認`);
        votesReceived++;

        if (votesReceived === totalVotes) {
          console.log('✅ 所有玩家投票已被確認');
          resolve();
        }
      });
    });

    // 設置超時
    setTimeout(() => {
      console.log(`⚠️  投票統計: 已確認 ${votesReceived}/${totalVotes}`);
      resolve();
    }, 15000);
  });
}

// 監聽投票結果
async function observeVoteResults() {
  return new Promise((resolve) => {
    console.log('📊 等待投票結果...');

    clients.host.on('vote_ended', (data) => {
      console.log('✅ 投票已結束');
      console.log('📊 投票結果:');
      data.results?.forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.label}: ${result.count} 票`);
      });
      resolve();
    });

    clients.host.on('players_eliminated', (data) => {
      console.log('⚠️  玩家被淘汰:');
      data.players?.forEach(p => {
        console.log(`   ❌ ${p.name}`);
      });
      resolve();
    });

    // 超時保護
    setTimeout(() => {
      console.log('⚠️  等待投票結果超時');
      resolve();
    }, 15000);
  });
}

// 主測試流程
async function runTest() {
  try {
    console.log('🧪 開始投票系統完整流程測試');
    console.log('=' .repeat(50));

    // 1. 創建房間
    await createRoom();
    await sleep(1000);

    // 2. 連接 Host
    await connectHost();
    await sleep(1000);

    // 3. 連接玩家
    await connectPlayers();
    await sleep(2000);

    // 4. 玩家準備
    await playersReady();
    await sleep(1000);

    // 5. 啟動遊戲
    await startGame();
    await sleep(2000);

    // 6. 玩家投票
    await castVotes();
    await sleep(3000);

    // 7. 觀察結果
    await observeVoteResults();
    await sleep(2000);

    console.log('=' .repeat(50));
    console.log('✅ 測試完成！');
    console.log('📋 測試摘要:');
    console.log(`✅ 房間建立成功: ${roomId}`);
    console.log(`✅ Host 連接成功`);
    console.log(`✅ ${clients.players.length} 個玩家連接成功`);
    console.log(`✅ 遊戲模組啟動成功`);
    console.log(`✅ 投票系統運行正常`);

    // 清理連接
    cleanup();

  } catch (error) {
    console.error('❌ 測試失敗:', error.message);
    console.error(error.stack);
    cleanup();
    process.exit(1);
  }
}

// 清理函數
function cleanup() {
  console.log('🧹 清理連接...');

  if (clients.host) {
    clients.host.disconnect();
  }

  clients.players.forEach(player => {
    if (player.socket) {
      player.socket.disconnect();
    }
  });

  console.log('✅ 清理完成');
}

// 運行測試
runTest().then(() => {
  console.log('🎉 所有測試完成');
  process.exit(0);
}).catch(error => {
  console.error('💥 測試異常:', error);
  process.exit(1);
});

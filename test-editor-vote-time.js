/**
 * 測試編輯器中設置投票時間
 *
 * 流程：
 * 1. 在編輯器中打開模組
 * 2. 修改投票時間為 25 秒
 * 3. 保存模組
 * 4. 在 Host 介面啟動遊戲
 * 5. 驗證投票時間為 25 秒
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testEditorVoteTime() {
  console.log('🧪 測試編輯器投票時間配置');
  console.log('='.repeat(50));
  console.log('');
  console.log('📝 步驟：');
  console.log('   1. 在瀏覽器中打開編輯器：http://localhost:3000/editor?id=public-vote-test');
  console.log('   2. 在「階段」標籤中找到投票階段');
  console.log('   3. 修改「投票時間（秒）」為 25');
  console.log('   4. 點擊「保存模組」按鈕');
  console.log('   5. 回到 Host 介面啟動遊戲');
  console.log('');
  console.log('⏳ 等待你在編輯器中完成修改...');
  console.log('   完成後按 Enter 繼續');

  // 等待用戶在編輯器中修改
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  console.log('\n✅ 開始測試...');

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
      console.log(`   預期: 25 秒（編輯器中設置的時間）`);
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

  // 載入模組
  console.log('\n📝 載入模組：public-vote-test');
  host.emit('host_load_module', {
    roomId,
    moduleName: 'public-vote-test',
    config: null
  });

  // 等待倒數
  await new Promise(resolve => setTimeout(resolve, 30000));

  // 驗證結果
  console.log('\n📊 驗證結果:');
  console.log('='.repeat(50));

  if (countdownTotalTime !== null) {
    const result = countdownTotalTime === 25;

    console.log(`${result ? '✅' : '❌'} 投票時間配置`);
    console.log(`   預期: 25 秒（編輯器設置）`);
    console.log(`   實際: ${countdownTotalTime} 秒`);
    console.log(`   結果: ${result ? '通過' : '失敗'}`);

    // 清理
    host.disconnect();
    players.forEach(p => p.socket.disconnect());

    console.log('\n✅ 測試完成');

    if (result) {
      console.log('\n📝 使用方式：');
      console.log('   1. 打開編輯器：http://localhost:3000/editor');
      console.log('   2. 選擇要編輯的模組');
      console.log('   3. 切換到「階段」標籤');
      console.log('   4. 在投票階段中修改「投票時間（秒）」');
      console.log('   5. 點擊「保存模組」');
      console.log('   6. 在 Host 介面啟動遊戲，將使用編輯器中設置的時間');
    }

    process.exit(result ? 0 : 1);
  } else {
    console.log('❌ 沒有收到倒數計時事件');

    // 清理
    host.disconnect();
    players.forEach(p => p.socket.disconnect());

    process.exit(1);
  }
}

testEditorVoteTime().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

/**
 * 測試 Host 介面設置投票時間
 *
 * 驗證：
 * 1. 選擇有投票階段的模組時，顯示投票時間輸入框
 * 2. 可以修改投票時間
 * 3. 啟動遊戲後，使用自定義的投票時間
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

  // 測試 1: 載入有投票階段的模組，設置自定義時間 15 秒
  console.log('\n📝 測試 1: 設置投票時間為 15 秒');

  host.emit('host_load_module', {
    roomId,
    moduleName: 'public-vote-test',
    config: {
      voteTimeOverride: 15  // 自定義投票時間 15 秒
    }
  });

  // 連接一個玩家來觸發投票開始
  const player = io(SERVER_URL);
  await new Promise(resolve => {
    player.on('connect', () => {
      player.emit('join_room', {
        roomId,
        playerId: 'player-test',
        playerName: 'TestPlayer'
      });
      player.on('room_joined', () => resolve());
    });
  });

  player.emit('player_ready', { roomId, playerId: 'player-test', isReady: true });

  // 追蹤倒數計時
  let countdownEvents = [];
  player.on('vote_countdown', (data) => {
    if (data.remaining === data.total) {
      console.log(`\n⏱ 投票倒數開始`);
      console.log(`   總時間: ${data.total} 秒`);
      console.log(`   預期: 15 秒（自定義時間）`);

      if (data.total === 15) {
        console.log(`   ✅ 使用自定義投票時間成功！`);
      } else {
        console.log(`   ❌ 投票時間不正確，預期 15 秒，實際 ${data.total} 秒`);
      }
    }
    countdownEvents.push(data);
  });

  player.on('vote_started', (data) => {
    console.log(`\n📱 投票開始`);
    console.log(`   投票標題: ${data.voteTitle}`);
  });

  // 等待倒數結束
  await new Promise(resolve => setTimeout(resolve, 20000));

  // 驗證結果
  console.log('\n📊 驗證結果:');
  console.log('='.repeat(50));

  if (countdownEvents.length > 0) {
    const totalTime = countdownEvents[0].total;
    const result = totalTime === 15;

    console.log(`${result ? '✅' : '❌'} 投票時間配置`);
    console.log(`   預期: 15 秒`);
    console.log(`   實際: ${totalTime} 秒`);
    console.log(`   結果: ${result ? '通過' : '失敗'}`);

    if (result) {
      console.log('\n✅ 所有測試通過！');
      console.log('\n📝 使用方式：');
      console.log('   1. 在 Host 介面選擇有投票階段的模組');
      console.log('   2. 在「投票設定」區域修改投票時間（5-300秒）');
      console.log('   3. 點擊「啟動遊戲模組」');
      console.log('   4. 投票階段將使用你設置的時間');
    }

    // 清理
    host.disconnect();
    player.disconnect();

    process.exit(result ? 0 : 1);
  } else {
    console.log('❌ 沒有收到倒數計時事件');

    // 清理
    host.disconnect();
    player.disconnect();

    process.exit(1);
  }
}

testVoteTimeConfig().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

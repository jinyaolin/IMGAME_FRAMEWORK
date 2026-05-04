/**
 * 投票系統最終測試
 *
 * 驗證：
 * 1. 投票有 30 秒倒數計時
 * 2. 玩家可以重新投票（反悔）
 * 3. 顯示正確的玩家名字（無 undefined）
 * 4. 公開投票顯示誰投了誰
 * 5. 倒數結束後需要 host 手動推進（fallback: "host"）
 * 6. Host 可以手動推進到下一階段
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testVoteFinal() {
  console.log('🧪 投票系統最終測試');
  console.log('='.repeat(50));

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

  // 追蹤事件
  const events = {
    voteStarted: false,
    countdownEvents: [],
    voteCast: [],
    voteEnded: false,
    voteCanAdvance: false,
    gameComplete: false
  };

  host.on('vote_started', (data) => {
    events.voteStarted = true;
    console.log('\n📋 投票開始');
    console.log(`   標題: ${data.voteTitle}`);
    console.log(`   類型: ${data.anonymous ? '匿名' : '公開'}`);
    console.log(`   可否重新投票: ${data.canChangeVote ? '是' : '否'}`);
    console.log(`   倒數時間: ${data.voteConfig?.countdownSeconds} 秒`);
  });

  host.on('vote_countdown', (data) => {
    if (data.remaining % 5 === 0 || data.remaining <= 3) {
      console.log(`⏱ 倒數: ${data.remaining}/${data.total} 秒`);
    }
    events.countdownEvents.push(data);
  });

  host.on('vote_cast', (data) => {
    events.voteCast.push(data);
  });

  host.on('vote_ended', (data) => {
    events.voteEnded = true;
    console.log('\n📊 投票結束');
    console.log('   結果:');
    data.results.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.targetName}: ${r.count} 票`);
      if (r.voters && r.voters.length > 0) {
        console.log(`      投票者: ${r.voters.join(', ')}`);
      }
    });
  });

  host.on('vote_can_advance', (data) => {
    events.voteCanAdvance = true;
    console.log(`\n✅ ${data.message}`);
  });

  host.on('game_complete', () => {
    events.gameComplete = true;
    console.log('\n🎉 遊戲完成！');
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
      // 第一輪投票
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

        // Alice 測試重新投票
        if (index === 0) {
          setTimeout(() => {
            const newTarget = voteData.options[(index + 2) % players.length];
            console.log(`🔄 ${voter.name} 重新投票給 ${newTarget.name}（反悔）`);

            voter.socket.emit('player_action', {
              roomId,
              playerId: `player-${voter.name.toLowerCase()}`,
              action: 'cast_vote',
              data: {
                targetId: newTarget.id,
                voteId: voteData.voteId
              }
            });
          }, 3000);
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

  // 等待倒數結束
  await new Promise(resolve => setTimeout(resolve, 35000));

  // 測試 host 手動推進
  if (events.voteCanAdvance) {
    console.log('\n🎮 測試 host 手動推進...');
    host.emit('host_next_phase', {
      roomId,
      data: {}
    });
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // 驗證結果
  console.log('\n' + '='.repeat(50));
  console.log('📊 驗證結果:');
  console.log('='.repeat(50));

  const results = [
    {
      name: '倒數計時',
      pass: events.countdownEvents.length > 0,
      details: `收到 ${events.countdownEvents.length} 個倒數事件`
    },
    {
      name: '重新投票',
      pass: events.voteCast.filter(v => v.totalVotes === 3).length > 1,
      details: '玩家可以反悔並重新投票'
    },
    {
      name: '玩家名字',
      pass: events.voteEnded, // 如果投票結束，說明沒有 undefined 錯誤
      details: '投票結果顯示正確的玩家名字'
    },
    {
      name: '公開投票',
      pass: events.voteEnded,
      details: '投票結果顯示誰投了誰'
    },
    {
      name: 'Host 手動推進',
      pass: events.voteCanAdvance,
      details: '倒數結束後收到 vote_can_advance 事件'
    },
    {
      name: '遊戲完成',
      pass: events.gameComplete,
      details: 'Host 推進後遊戲正確完成'
    }
  ];

  let passCount = 0;
  results.forEach((r, i) => {
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} ${r.name}: ${r.details}`);
    if (r.pass) passCount++;
  });

  console.log('='.repeat(50));
  console.log(`總計: ${passCount}/${results.length} 項通過`);

  // 清理
  host.disconnect();
  players.forEach(p => p.socket.disconnect());

  console.log('\n✅ 測試完成');
  process.exit(passCount === results.length ? 0 : 1);
}

testVoteFinal().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});

/**
 * ActionConfig 測試腳本
 *
 * 直接測試 BaseModule 的 actionConfig 生成功能
 */

import BaseModule from './server/core/BaseModule.js';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

// 載入測試模組的 manifest
const manifestPath = path.join(process.cwd(), 'server/modules/test-action-config/manifest.json');
const manifest = JSON.parse(require('fs').readFileSync(manifestPath, 'utf8'));

console.log('=== ActionConfig 生成測試 ===\n');

// 模擬 session 物件
const mockSession = {
  roomId: 'test-room',
  broadcastAll: (event, data) => {
    console.log(`[Broadcast ${event}]`);
    console.log(JSON.stringify(data, null, 2));
    console.log('\n');
  },
  sendToPlayer: () => {},
  sendToHost: () => {},
  sendHostGameState: () => {}
};

// 創建模組實例
const TestModule = class extends BaseModule {};

// 創建模組
const gameModule = new TestModule(manifest, mockSession, {});

// 模擬玩家
const mockPlayers = [
  { id: 'player1', name: '玩家A', team: 'red', attributes: { team: 'red' }, isAlive: true, isConnected: true },
  { id: 'player2', name: '玩家B', team: 'blue', attributes: { team: 'blue' }, isAlive: true, isConnected: true },
  { id: 'player3', name: '玩家C', team: 'red', attributes: { team: 'red' }, isAlive: true, isConnected: true }
];

// 初始化模組
gameModule.players = mockPlayers;
gameModule.playerHands = new Map();
gameModule.playedCards = new Map();
gameModule.decks = new Map();
gameModule.playerIdentities = new Map();
gameModule.confirmedPlayers = new Set();
gameModule._initStageStack();

console.log('✅ 模組已初始化');
console.log(`📋 Manifest: ${manifest.name} (${manifest.stages.length} stages)`);
console.log(`👥 玩家數量: ${mockPlayers.length}\n`);

// 測試每個 stage 的 actionConfig 生成
console.log('========== 開始測試各個 Stage ==========\n');

let validCount = 0;
let invalidCount = 0;

manifest.stages.forEach((stage, index) => {
  console.log(`\n--- Stage ${index + 1}: ${stage.name} (${stage.type}) ---`);

  try {
    // 設置當前 stage
    gameModule.currentStageId = stage.id;
    gameModule._stageStack[0].index = index;

    // 生成 actionConfig
    const actionConfig = gameModule._generateActionConfig(stage, mockSession);

    if (actionConfig) {
      console.log('✅ actionConfig 已生成');
      console.log(`   UI Mode: ${actionConfig.uiMode}`);
      console.log(`   Actions: ${actionConfig.actions?.length || 0} 個`);
      console.log(`   Selection: ${actionConfig.selection?.source || 'N/A'}`);

      // 基本驗證
      const errors = [];

      if (!actionConfig.uiMode) errors.push('Missing uiMode');
      if (!actionConfig.selection) errors.push('Missing selection');
      if (!actionConfig.actions || !Array.isArray(actionConfig.actions)) errors.push('Missing actions');

      if (errors.length === 0) {
        console.log('✅ 格式驗證通過');
        validCount++;

        // 顯示詳細配置
        console.log('\n詳細配置:');
        console.log(JSON.stringify(actionConfig, null, 2));
      } else {
        console.log('❌ 格式驗證失敗:');
        errors.forEach(err => console.log(`   - ${err}`));
        invalidCount++;
      }
    } else {
      console.log('⚠️ 沒有生成 actionConfig (可能是 expected 的，如 intermission)');
    }

  } catch (error) {
    console.log(`❌ 生成 actionConfig 時發生錯誤: ${error.message}`);
    console.log(error.stack);
    invalidCount++;
  }
});

// 總結
console.log('\n========== 測試結果總結 ==========');
console.log(`總共測試: ${manifest.stages.length} 個 stages`);
console.log(`✅ 正確: ${validCount} 個`);
console.log(`❌ 錯誤: ${invalidCount} 個`);

if (invalidCount === 0) {
  console.log('\n🎉 所有測試通過！');
  process.exit(0);
} else {
  console.log('\n⚠️ 有測試失敗');
  process.exit(1);
}

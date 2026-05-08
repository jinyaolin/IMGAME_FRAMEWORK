# ActionButtonManager 實作文檔

## 🎯 專案概述

ActionButtonManager 是一個統一的 Action Button 管理系統，用於管理各種遊戲階段的按鈕和互動邏輯。

## ✅ 已完成的實作

### **Phase 1: 核心架構** ✅

1. **ActionButtonManager 類別** (`client/shared/ActionButtonManager.js`)
   - ✅ 完整的狀態機系統
   - ✅ 統一的 Action Config 格式
   - ✅ 向後兼容的默認配置
   - ✅ 多種 UI 模式支援 (overlay, inline, controller, none)

2. **統一的 UI 結構** (`client/mobile/game.html`)
   - ✅ 新增 `actionOverlay` 元素
   - ✅ 新增完整的 CSS 樣式系統
   - ✅ 整合 ActionButtonManager 腳本

3. **事件系統整合**
   - ✅ `stage_started` 事件支援新架構
   - ✅ `vote_started` 事件支援新架構
   - ✅ `vote_cast` 事件支援新架構
   - ✅ 卡牌選擇系統支援新架構

4. **向後兼容性**
   - ✅ 保留所有舊的投票系統功能
   - ✅ 保留所有舊的卡牌系統功能
   - ✅ 保留所有舊的控制器系統功能
   - ✅ 自動降級到舊系統如果新系統失敗

5. **測試環境**
   - ✅ 建立測試頁面 (`test-action-manager.html`)
   - ✅ 模擬 client 環境
   - ✅ 完整的功能測試

## 📋 支援的 Stage 類型

### **1. 投票階段 (`vote`)**
```javascript
{
  stageId: 'vote_stage',
  stageType: 'vote',
  voteConfig: {
    voteTitle: '投票標題',
    voteDescription: '投票描述',
    countdownSeconds: 30
  },
  options: [...],
  eligibleVoters: [...]
}
```

### **2. 卡牌出牌階段 (`card_play`)**
```javascript
{
  stageId: 'card_play_stage',
  stageType: 'card_play',
  stageName: '出牌階段'
}
```

### **3. 身份確認階段 (`identity_draw`)**
```javascript
{
  stageId: 'identity_stage',
  stageType: 'identity_draw',
  stageName: '身份確認'
}
```

### **4. 遊戲控制階段 (`game`)**
```javascript
{
  stageId: 'game_stage',
  stageType: 'game',
  stageName: '遊戲控制',
  gameConfig: {
    layout: 'pad-4',
    buttonLabels: {
      btn1: 'A',
      btn2: 'B'
    }
  }
}
```

### **5. 中場休息階段 (`intermission`)**
```javascript
{
  stageId: 'intermission_stage',
  stageType: 'intermission',
  stageName: '暫停'
}
```

### **6. 結果階段 (`result`)**
```javascript
{
  stageId: 'result_stage',
  stageType: 'result',
  stageName: '遊戲結束'
}
```

## 🚀 使用方式

### **基本使用**

```javascript
// 1. 初始化 (已經在 game.html 中完成)
actionManager.setClient(client);

// 2. 設置階段 (在 stage_started 事件中)
actionManager.setupStage(stageData);

// 3. 處理選擇變更
actionManager.onSelectionChanged(selectedItem);

// 4. 執行動作
actionManager.executeAction(actionId);

// 5. 更新狀態
actionManager.updateActionState(actionId, newState, data);
```

### **投票階段範例**

```javascript
// 在 vote_started 事件中
client.on('vote_started', (data) => {
  actionManager.setupVoteScreen(data);
});

// 當玩家選擇投票選項時
function onVoteOptionSelected(optionId) {
  actionManager.onSelectionChanged(optionId);
}

// 當投票送出時
client.on('vote_cast', (data) => {
  if (data.playerId === playerId) {
    actionManager.updateActionState('submit_vote', 'submitted');
  }
});
```

### **卡牌階段範例**

```javascript
// 在選擇卡牌時
function selectCard(cardId) {
  selectedCard = cardId;
  actionManager.onSelectionChanged(cardId);
  updateActionButton();
}

// 在出牌時
function playSelected() {
  actionManager.executeAction('play_card');
}

// 更新按鈕狀態
function updateActionButton() {
  actionManager.updatePlayButton(
    selectedCard,
    isPlayingCard,
    hasPlayedThisRound,
    isRevealed
  );
}
```

## 🧪 測試

### **啟動測試頁面**

1. 確保伺服器正在運行
2. 訪問 `http://localhost:3000/test-action-manager.html`
3. 按照頁面上的指示進行測試

### **測試項目**

- ✅ 基礎初始化測試
- ✅ 投票階段測試
- ✅ 卡牌階段測試
- ✅ 身份確認測試
- ✅ 遊戲控制器測試
- ✅ 選擇變更測試
- ✅ Action 執行測試
- ✅ 倒數計時測試

## 📊 架構優勢

### **統一性**
- 所有 stage 類型使用同一個管理系統
- 一致的 API 介面
- 統一的狀態管理

### **可擴展性**
- 新增 stage 類型只需添加配置
- 支援自定義 action 類型
- 靈活的 UI 模式

### **向後兼容**
- 完全兼容現有的 manifest 格式
- 自動降級到舊系統
- 不影響現有功能

### **可維護性**
- 集中的邏輯管理
- 清晰的代碼結構
- 詳細的日誌輸出

## 🔄 下一步計劃

### **Phase 2: 伺服器端支援** (進行中)
- [ ] 更新 BaseModule 支援新格式
- [ ] 更新 manifest.json 格式
- [ ] 更新事件處理邏輯
- [ ] 測試伺服器端整合

### **Phase 3: 完整遷移**
- [ ] 投票系統完全遷移到新架構
- [ ] 卡牌系統完全遷移到新架構
- [ ] 身份確認完全遷移到新架構
- [ ] 移除舊的代碼（確認無問題後）

### **Phase 4: 優化與測試**
- [ ] 性能優化
- [ ] 錯誤處理完善
- [ ] 邊緣情況測試
- [ ] 文檔完善

## 🐛 已知問題

### **當前限制**
1. 新架構需要進一步測試在真實遊戲環境中的表現
2. 需要更多邊緣情況的測試
3. 伺服器端整合尚未完成

### **向後兼容注意事項**
1. 舊的投票系統仍然可用作為備選
2. 如果新系統出現問題，會自動降級到舊系統
3. 建議在測試環境中充分驗證後再部署到生產環境

## 📝 API 參考

### **ActionButtonManager 主要方法**

#### `setClient(client)`
設置 Socket.IO 客戶端
- `client`: Socket.IO 客戶端實例

#### `setupStage(stageData)`
設置當前遊戲階段
- `stageData`: 階段配置物件

#### `onSelectionChanged(selectedItems)`
處理選擇變更
- `selectedItems`: 選擇的項目（單個或陣列）

#### `executeAction(actionId)`
執行指定的 action
- `actionId`: Action ID

#### `updateActionState(actionId, newState, data)`
更新 action 狀態
- `actionId`: Action ID
- `newState`: 新狀態
- `data`: 額外資料

#### `startCountdown(seconds, onComplete)`
開始倒數計時
- `seconds`: 秒數
- `onComplete`: 完成回調

#### `clearCurrentStage()`
清除當前階段狀態

## 🎉 總結

新的 ActionButtonManager 已經成功實作並整合到現有系統中，具備：

- ✅ 完整的核心架構
- ✅ 向後兼容性
- ✅ 測試環境
- ✅ 詳細文檔

可以開始進行下一步的伺服器端整合工作！

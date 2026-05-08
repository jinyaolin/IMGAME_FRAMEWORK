# ParamActions 系統文檔

## 概述

ParamActions 系統允許遊戲設計者在 stage 中定義參數動作，實現「投票結果→存參數→淘汰玩家」等遊戲邏輯，無需編寫程式碼。

## 基本語法

在 manifest.json 的 stage 中定義 paramActions：

```json
{
  "type": "vote",
  "name": "投票階段",
  "voteConfig": {...},
  "paramActions": [
    {
      "trigger": "onVoteEnd",
      "action": "storeVoteWinner",
      "targetParam": "voteWinner",
      "description": "將投票勝者存入全局參數"
    }
  ]
}
```

## 支援的 Trigger（觸發時機）

| Trigger | 說明 | 可用 context |
|---------|------|--------------|
| `onStageStart` | 階段開始時 | - |
| `onStageEnd` | 階段結束時 | - |
| `onVoteEnd` | 投票結束時 | `voteResults` |
| `onAllPlayed` | 所有人都出牌後 | `currentPlayer` |

## 支援的 Action（動作類型）

### 1. setValue - 設定參數值

```json
{
  "trigger": "onStageStart",
  "action": "setValue",
  "targetParam": "roundCount",
  "value": 1
}
```

**支援的變數**：
- `${playerId}` - 當前玩家ID
- `${voteWinner}` - 投票勝者ID

**範例**：
```json
{
  "action": "setValue",
  "targetParam": "currentPlayer",
  "value": "${playerId}"
}
```

### 2. addValue - 加值

```json
{
  "trigger": "onStageEnd",
  "action": "addValue",
  "targetParam": "roundCount",
  "value": 1
}
```

### 3. subtractValue - 減值

```json
{
  "trigger": "onCardPlay",
  "action": "subtractValue",
  "targetParam": "player.score",
  "value": 10
}
```

### 4. multiplyValue - 乘值

```json
{
  "trigger": "onStageEnd",
  "action": "multiplyValue",
  "targetParam": "scoreMultiplier",
  "value": 2
}
```

### 5. resetParam - 重置參數

將參數重置為 manifest 中定義的 initialValue。

```json
{
  "trigger": "onStageStart",
  "action": "resetParam",
  "targetParam": "playerHP"
}
```

### 6. storeVoteWinner - 存儲投票勝者

將投票結果的第一名（最高票）存入全局參數。

```json
{
  "trigger": "onVoteEnd",
  "action": "storeVoteWinner",
  "targetParam": "voteWinner"
}
```

**需要 context**：`voteResults`

### 7. eliminatePlayer - 淘汰玩家

根據全局參數中的玩家ID淘汰玩家。

```json
{
  "trigger": "onVoteEnd",
  "action": "eliminatePlayer",
  "targetPlayerParam": "voteWinner"
}
```

## targetParam 格式

### 全局參數
```json
{
  "targetParam": "roundCount"
}
```

### 玩家參數
```json
{
  "targetParam": "player.score"
}
```

或使用變數：
```json
{
  "targetParam": "${playerId}.score"
}
```

## 實際範例

### 範例 1: 投票→淘汰

```json
{
  "type": "vote",
  "name": "淘汰投票",
  "voteConfig": {
    "voteTitle": "投票淘汰一名玩家",
    "optionSource": "players"
  },
  "paramActions": [
    {
      "trigger": "onVoteEnd",
      "action": "storeVoteWinner",
      "targetParam": "voteWinner"
    },
    {
      "trigger": "onVoteEnd",
      "action": "eliminatePlayer",
      "targetPlayerParam": "voteWinner"
    }
  ]
}
```

### 範例 2: 回合計數

```json
{
  "type": "intermission",
  "name": "回合開始",
  "paramActions": [
    {
      "trigger": "onStageStart",
      "action": "setValue",
      "targetParam": "roundCount",
      "value": 1
    }
  ]
}
```

下一階段增加回合數：
```json
{
  "type": "intermission",
  "name": "下一回合",
  "paramActions": [
    {
      "trigger": "onStageStart",
      "action": "addValue",
      "targetParam": "roundCount",
      "value": 1
    }
  ]
}
```

### 範例 3: 出牌扣分

```json
{
  "type": "card_play",
  "name": "出牌階段",
  "paramActions": [
    {
      "trigger": "onCardPlay",
      "action": "subtractValue",
      "targetParam": "player.score",
      "value": 5
    }
  ]
}
```

### 範例 4: 複合動作

```json
{
  "type": "vote",
  "name": "特殊投票",
  "voteConfig": {...},
  "paramActions": [
    {
      "trigger": "onVoteEnd",
      "action": "storeVoteWinner",
      "targetParam": "voteWinner",
      "description": "1. 存儲投票勝者"
    },
    {
      "trigger": "onVoteEnd",
      "action": "setValue",
      "targetParam": "targetPlayer",
      "value": "${voteWinner}",
      "description": "2. 設定目標玩家"
    },
    {
      "trigger": "onVoteEnd",
      "action": "eliminatePlayer",
      "targetPlayerParam": "targetPlayer",
      "description": "3. 淘汰目標玩家"
    },
    {
      "trigger": "onVoteEnd",
      "action": "setValue",
      "targetParam": "roundCount",
      "value": 2,
      "description": "4. 進入第二回合"
    }
  ]
}
```

## Context 變數

不同的 trigger 提供不同的 context 變數：

### onVoteEnd context
```javascript
{
  voteResults: [
    { playerId: "player-abc", count: 5 },
    { playerId: "player-def", count: 3 }
  ]
}
```

使用 `${voteWinner}` 取得 `voteResults[0].playerId`。

### onCardPlay context
```javascript
{
  currentPlayer: "player-abc"
}
```

使用 `${playerId}` 或 `context.currentPlayer`。

## 驗證規則

伺服器會自動驗證 paramActions：

1. **trigger 必須有效** - 只能使用支援的 trigger
2. **action 必須有效** - 只能使用支援的 action
3. **targetParam 必需性** - 某些 action 需要 targetParam
4. **targetPlayerParam 必需性** - eliminatePlayer 需要 targetPlayerParam

## 測試模組

已有測試模組 `test-paramactions` 展示所有功能：

```bash
# 啟動伺服器
npm start

# 在 Host 頁面選擇 "ParamActions 測試" 模組
```

## 與 server.js 的關係

ParamActions 是在 BaseModule 層級執行的，在自定義的 server.js 之前執行。這樣設計是為了：

1. **常見邏輯不需要寫程式碼** - 大部分遊戲邏輯可用 paramActions 完成
2. **server.js 處理特殊邏輯** - 複雜的遊戲邏輯仍可覆寫 onPlayerAction 等方法

執行順序：
```
1. paramActions (onStageStart)
2. server.js.onStart (如果有覆寫)
3. ... 遊戲進行 ...
4. paramActions (onVoteEnd)
5. server.js 自訂邏輯
```

## 調試技巧

查看 paramActions 執行日誌：

```bash
# 伺服器端會輸出
[BaseModule] Executing onVoteEnd paramActions: 3 actions
[BaseModule] Executing action: storeVoteWinner
[BaseModule] Stored vote winner: player-abc123 → voteWinner
```

## 限制與注意事項

1. **參數必須存在** - targetParam 必須在 globalParams 或 playerAttributes 中定義
2. **類型匹配** - setValue 的 value 類型必須與參數定義的類型匹配
3. **玩家範圍** - player.xxx 需要確保有 context.playerId
4. **執行順序** - paramActions 按照定義順序依序執行

## 未來擴展

計畫中的功能：

1. **更多 trigger** - onPlayerJoin, onTimerEnd, onPlayerDisconnect
2. **更多 action** - transferCards, shuffleCards, revealCards
3. **條件執行** - if/else 邏輯
4. **迴圈動作** - 對所有玩家執行動作

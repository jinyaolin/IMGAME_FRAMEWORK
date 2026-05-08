# 遊戲參數系統 (Game Parameters System)

## 概述

新的參數系統擴展了現有的 `playerAttributes`，新增 `globalParams` 和更豐富的資料類型，讓遊戲設計更靈活。

## 架構設計

### 向後相容整合

新系統完全整合到現有架構：

```
manifest.globalParams     → session.sharedState (全局參數)
manifest.playerAttributes → player.attributes (玩家參數)
```

## Manifest 定義

### globalParams（全局參數）

```json
{
  "globalParams": [
    {
      "id": "voteWinner",
      "label": "投票獲勝者",
      "type": "player",
      "description": "儲存投票最高票的玩家ID",
      "initialValue": null
    },
    {
      "id": "cardPool",
      "label": "公共牌池",
      "type": "card",
      "description": "玩家丟棄的卡片會進入這裡",
      "initialValue": []
    },
    {
      "id": "roundCount",
      "label": "回合數",
      "type": "number",
      "subType": "integer",
      "min": 0,
      "max": 99,
      "initialValue": 1,
      "description": "當前遊戲回合"
    },
    {
      "id": "gameStatus",
      "label": "遊戲狀態",
      "type": "string",
      "initialValue": "waiting",
      "description": "遊戲當前狀態"
    },
    {
      "id": "isPaused",
      "label": "是否暫停",
      "type": "boolean",
      "initialValue": false,
      "description": "遊戲是否暫停"
    },
    {
      "id": "votedPlayers",
      "label": "被投票玩家列表",
      "type": "array",
      "itemType": "player",
      "initialValue": [],
      "description": "所有被投票的玩家ID"
    }
  ]
}
```

### playerAttributes（玩家屬性 - 擴展）

```json
{
  "playerAttributes": [
    {
      "id": "team",
      "label": "隊伍",
      "type": "select",
      "options": [
        { "value": "red",  "label": "紅隊", "icon": "🔴" },
        { "value": "blue", "label": "藍隊", "icon": "🔵" }
      ]
    },
    {
      "id": "playerHP",
      "label": "生命值",
      "type": "number",
      "subType": "integer",
      "min": 0,
      "max": 100,
      "initialValue": 100,
      "description": "每個玩家的生命值"
    },
    {
      "id": "score",
      "label": "分數",
      "type": "number",
      "subType": "float",
      "min": 0,
      "max": 9999.99,
      "initialValue": 0,
      "description": "玩家分數"
    },
    {
      "id": "isProtected",
      "label": "是否受保護",
      "type": "boolean",
      "initialValue": false,
      "description": "玩家本回合是否受保護"
    },
    {
      "id": "playerRole",
      "label": "角色",
      "type": "string",
      "initialValue": "villager",
      "description": "玩家的角色身份"
    },
    {
      "id": "handCards",
      "label": "手牌",
      "type": "array",
      "itemType": "card",
      "initialValue": [],
      "description": "玩家手牌列表"
    }
  ]
}
```

## 支援的資料類型

| 類型 | 說明 | 適用範圍 | 額外欄位 |
|------|------|----------|----------|
| `number` | 數值 | global, player | `subType`: integer/float, `min`, `max` |
| `string` | 字串 | global, player | 無 |
| `boolean` | 布林值 | global, player | 無 |
| `player` | 玩家ID | global | 無 |
| `card` | 卡片資料 | global | 無 |
| `array` | 陣列 | global, player | `itemType`: player/card/string/number |
| `select` | 選項（舊有） | player | `options`: [{value, label, icon}] |

## API 使用方法

### GameSession 方法

#### 全局參數操作

```javascript
// 設定全局參數
session.setGlobalParam("voteWinner", "player-abc123")
session.setGlobalParam("roundCount", 2)
session.setGlobalParam("isPaused", true)

// 取得全局參數
const winner = session.getGlobalParam("voteWinner")
const round = session.getGlobalParam("roundCount")

// 全局參數會自動同步到 sharedState
console.log(session.sharedState.voteWinner) // "player-abc123"
```

#### 玩家參數操作

```javascript
// 設定玩家參數
session.setPlayerParam("player-abc123", "playerHP", 80)
session.setPlayerParam("player-abc123", "isProtected", true)

// 取得玩家參數
const hp = session.getPlayerParam("player-abc123", "playerHP")
const protected = session.getPlayerParam("player-abc123", "isProtected")

// 取得所有玩家的某個參數
const allHP = session.getAllPlayerParams("playerHP")
// 回傳: { "player-abc123": 100, "player-def456": 80, ... }
```

### 參數初始化

遊戲開始時自動初始化：

```javascript
// globalParams → session.sharedState
session.sharedState.voteWinner = null
session.sharedState.cardPool = []
session.sharedState.roundCount = 1

// playerAttributes → player.attributes
player.attributes.team = "red"      // 從第一個選項
player.attributes.playerHP = 100    // 從 initialValue
player.attributes.isProtected = false
```

## 使用範例

### 範例 1: 投票結果存入參數

```javascript
// 在投票階段結束時
async function onVoteEnd(results, session) {
  const winner = results[0].playerId  // 最高票玩家
  session.setGlobalParam("voteWinner", winner)
}
```

### 範例 2: 根據參數淘汰玩家

```javascript
// 在下一階段開始時
async function onStart(players, session) {
  const winner = session.getGlobalParam("voteWinner")
  if (winner) {
    const player = session.players.get(winner)
    if (player) {
      player.isAlive = false  // 淘汰玩家
    }
  }
}
```

### 範例 3: 玩家 HP 變化

```javascript
// 玩家出牌時扣除 HP
async function onPlayerAction(playerId, action, data, session) {
  if (action === 'play_card') {
    const currentHP = session.getPlayerParam(playerId, "playerHP")
    session.setPlayerParam(playerId, "playerHP", currentHP - 10)

    // 檢查是否死亡
    if (currentHP - 10 <= 0) {
      const player = session.players.get(playerId)
      player.isAlive = false
    }
  }
}
```

### 範例 4: 使用 sharedState 向後相容

```javascript
// 原本的程式碼還是能運作
session.updateSharedState({
  roundCount: 2,
  gameStatus: "playing"
})

// 全局參數會自動同步
console.log(session.getGlobalParam("roundCount")) // 2
```

## 驗證規則

伺服器會自動驗證參數定義：

1. **ID 必須唯一** - globalParams 和 playerAttributes 的 id 不能重複
2. **Type 必須有效** - 只能使用支援的類型
3. **Number 類型** - min/max 必須是數字，且 min ≤ max
4. **Array 類型** - 必須指定 itemType
5. **Select 類型** - 必須有至少一個選項

## 整合優勢

1. **向後相容** - 現有的 `sharedState` 和 `player.attributes` 繼續運作
2. **統一 API** - 新的 API 提供一致的操作方式
3. **型別安全** - 自動驗證和型別檢查
4. **自動初始化** - 玩家加入時自動設定初始值
5. **即時同步** - 參數更新自動廣播給所有客戶端

## 測試模組

已有測試模組 `test-params` 展示所有功能：

```bash
# 啟動伺服器
npm start

# 在 Host 頁面選擇 "參數系統測試" 模組
```

## 未來擴展

接下來可以實作的功能：

1. **paramActions** - 在 stage 中定義參數動作
2. **Editor UI** - 在 editor 中視覺化編輯參數
3. **更多類型** - 如 object, date 等
4. **參數監聽** - 監聽參數變化並觸發事件

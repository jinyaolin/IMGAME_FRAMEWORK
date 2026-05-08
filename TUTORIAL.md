# Immersive Game Framework 完整教學

> 從零開始學習使用 Immersive Game Framework 開發多人互動遊戲

---

## 目錄

1. [簡介與架構概覽](#1-簡介與架構概覽)
2. [快速開始：五分鐘建立第一個遊戲模組](#2-快速開始)
3. [核心概念詳解](#3-核心概念詳解)
4. [遊戲控制器與 gameCode](#4-遊戲控制器與-gamecode)
5. [進階：server.js 自訂邏輯](#5-進階serverjs-自訂邏輯)
6. [進階功能](#6-進階功能)
7. [除錯與部署](#7-除錯與部署)
8. [附錄](#8-附錄)

---

## 1. 簡介與架構概覽

### 什麼是 Immersive Game Framework？

Immersive Game Framework 是一套**多人互動遊戲框架**，設計用於沉浸式空間（如密室逃脱、展覽、派對）。玩家用手機作為私人介面，大螢幕作為共享視覺場景，由主持人控制遊戲流程。

### 四個角色端

```
                        ┌─────────────────┐
                        │   Display       │
                        │   (大螢幕)      │
                        │   /display      │
                        └────────▲────────┘
                                 │
   📱 Mobile ──┐              Socket.IO
   (玩家手機) ─┤  ←──────────► Server  ←─────────► 🎛 Host
   /mobile  ──┘              :3000                  (主持人)
                                                     /host

                          📝 Editor (遊戲編輯器)
                          /editor
```

| 端 | URL | 角色 | 裝置 |
|---|---|---|---|
| **Host** | `/host` | 建立房間、選擇模組、推進階段、管理玩家 | 桌面/平板 |
| **Display** | `/display` | 大螢幕公開資訊、遊戲畫面、投票結果 | 投影機/大螢幕 |
| **Mobile** | `/mobile` | 玩家手機介面、查看私人卡牌、投票、控制器 | 手機 |
| **Editor** | `/editor` | 設計遊戲模組（卡牌內容、階段、規則） | 桌面 |

### 遊戲基本流程

```
1. Host 在 /host 選擇模組 → 建立房間 → 取得房號 + QR Code
2. 玩家掃描 QR Code 進入 /mobile?room=ABCDEF，輸入名字
3. Display 打開 /display?room=ABCDEF
4. Host 確認所有人都準備好了 → 開始遊戲
5. 遊戲依照模組定義的 stages 依序執行
6. 遊戲結束後，Host 可以重開或關閉房間
```

### 啟動伺服器

```bash
npm install
npm start                    # localhost:3000
npm run start:lan            # 自動取得 LAN IP（方便手機掃 QR Code）
npm run dev                  # nodemon 開發模式
```

---

## 2. 快速開始

### 五分鐘建立一個投票淘汰遊戲

不需要寫任何程式碼，完全用 Editor 完成。

#### Step 1：建立全域牌組（選用）

打開 `/decks`，建立一個「奇幻角色」牌組，加入幾張角色卡（例如：法師、戰士、盜賊）。牌組會自動存入 `server/decks/` 目錄。

#### Step 2：在 Editor 建立模組

1. 打開 `/editor`
2. 左側選「➕ 新增模組」，輸入 ID（如 `my-vote-game`）和名稱
3. 設定基本參數：
   - 最少人數：3
   - 最多人數：10

#### Step 3：設定牌組

切到「牌組 Decks」分頁：

1. 新增一個牌組，ID 設為 `roles`，類型選 `role`（角色牌）
2. 引用全域牌組 `fantasy-roles`
3. 抽牌數設為 1（每人抽 1 張身份）
4. 勾選 `啟用`

#### Step 4：設定階段

切到「階段 Stages」分頁，依序加入：

**階段 1：身份抽取**
- 名稱：`身份分配`
- 類型：`identity_draw`
- 牌組：選 `roles`
- 推進條件：`all_confirmed`（全部確認後自動推進），fallback `host`

**階段 2：投票淘汰**
- 名稱：`投票淘汰`
- 類型：`vote`
- 投票設定：
  - 標題：`請投票淘汰一名玩家`
  - 倒數秒數：30
  - 匿名投票：開啟
  - 可投自己：關閉
- 推進條件：`vote_ended`，fallback `host`

**階段 3：結果**
- 名稱：`最終結果`
- 類型：`result`
- 推進條件：`restart_timer`，持續 5 秒

#### Step 5：儲存並測試

按 `⌘S` 儲存。到 `/host` 建立新房間，選擇你的模組，用多支手機掃碼加入，測試遊戲流程。

---

## 3. 核心概念詳解

### Module（模組）

每個遊戲模組是一個資料夾，位於 `server/modules/<id>/`，核心是 `manifest.json`：

```json
{
  "id": "my-game",
  "name": "我的遊戲",
  "version": "1.0.0",
  "description": "遊戲描述",
  "minPlayers": 2,
  "maxPlayers": 8,
  "stages": [ /* 階段定義 */ ],
  "decks": [ /* 牌組定義 */ ]
}
```

可選檔案：
- `server.js` — 自訂伺服器端邏輯（繼承 BaseModule）

### Stages（階段）

階段是遊戲流程的骨架。所有啟用的階段會依序執行。

#### 階段類型一覽

| 類型 | 用途 | 說明 |
|---|---|---|
| `identity_draw` | 身份抽牌 | 從指定牌組抽牌，私密發給每位玩家作為身份/角色 |
| `card_play` | 卡牌出牌 | 多回合制出牌 → 揭牌 → 結算 → 下一回合 |
| `vote` | 投票 | 公開或匿名投票，支援倒數、單/多選 |
| `game` | 控制器遊戲 | 手機變成搖桿/按鈕控制器，按鍵即時傳到大螢幕 Canvas |
| `intermission` | 暫停 | 顯示說明文字，不觸發遊戲邏輯 |
| `result` | 結算 | 計算最終排名，廣播 `game_ended` |
| `loop` | 迴圈 | 將子階段重複執行 N 次（用於多回合投票等） |

#### Advance Triggers（推進觸發條件）

每個階段可以設定推進條件，決定何時進入下一階段：

```json
"advance": {
  "trigger": "host",
  "duration": 5,
  "fallback": "host"
}
```

| 觸發條件 | 說明 |
|---|---|
| `host` | Host 點按鈕手動推進（預設） |
| `all_played` | 所有玩家都出牌後自動推進 |
| `all_confirmed` | 所有玩家確認身份後自動推進 |
| `vote_ended` | 投票結果出爐後自動推進 |
| `all_voted` | 所有玩家都投票後自動推進 |
| `auto` | 立即推進（無倒數） |
| `timer` | 倒數結束後自動推進 |
| `restart_timer` | 倒數結束後自動重開遊戲 |
| `identity_timer` | 全部確認後開始倒數 |
| `auto_next` | 揭牌後立即推進 |
| `round_timer` | 揭牌後倒數推進到下一階段 |
| `host_reveal` | Host 手動揭牌 |

> **`fallback: "host"`** 表示即使設了自動推進，Host 仍然保留強制推進按鈕。

### Decks（牌組）

牌組有兩種來源：

#### 引用全域牌組（推薦）

```json
{
  "id": "roles",
  "name": "角色牌組",
  "type": "role",
  "visibility": "private",
  "drawCount": 1,
  "allowDuplicate": false,
  "enabled": true,
  "ref": "fantasy-roles"
}
```

全域牌組在 `/decks` 管理，多個模組可以共用。

#### 選牌機制

可以用 `selectedCards` 指定要使用的卡牌及數量：

```json
"selectedCards": {
  "warrior": 2,
  "mage": 1,
  "rogue": 1
}
```

---

## 4. 遊戲控制器與 gameCode

`game` 階段可以把手機變成**即時遊戲控制器**。按鍵事件透過 Socket.IO 即時傳到大螢幕的 Canvas。

### 控制器佈局

在 manifest 的 `gameConfig.layout` 中設定：

| 佈局 | 外觀 | 按鍵 |
|---|---|---|
| `dpad-2btn` | 左邊方向鍵 + 右邊 A/B 兩顆按鈕 | `up`, `down`, `left`, `right`, `btn1`, `btn2` |
| `dpad-dpad` | 雙方向鍵 | `up`, `down`, `left`, `right`, `up2`, `down2`, `left2`, `right2` |
| `pad-4` | 2×2 四顆按鈕 | `btn1`, `btn2`, `btn3`, `btn4` |
| `pad-8` | 2×4 八顆按鈕 | `btn1` ~ `btn8` |
| `pad-2` | 左右兩顆大按鈕 | `btn1`, `btn2` |

按鈕標籤可用 `btnLabels` 自訂：

```json
"gameConfig": {
  "layout": "dpad-2btn",
  "btnLabels": { "btn1": "發射", "btn2": "炸彈" }
}
```

### 輸入事件格式

每次按下或放開按鍵，Display 會收到 `player_input` 事件：

```json
{ "playerId": "p_abc123", "playerName": "小明", "key": "btn1", "state": "down", "seq": 42 }
```

- `state`: `"down"`（按下）或 `"up"`（放開）
- `seq`: 序號，用於防止亂序問題

方向鍵會發出對角線組合鍵：`up-left`, `up-right`, `down-left`, `down-right`。

### GameAPI

在 `gameConfig.gameCode` 中，可以透過 `GameAPI` 物件自訂大螢幕畫面：

```javascript
// GameAPI 提供的屬性和方法：
GameAPI.canvas   // HTMLCanvasElement（全螢幕）
GameAPI.ctx      // CanvasRenderingContext2D
GameAPI.players  // Map<playerId, { name, color, inputs: Set<key>, lastSeq: Map }>
GameAPI.onInput(fn)  // 註冊輸入回呼 fn(playerId, key, state, playerObj)
GameAPI.update(fn)   // 註冊每帧渲染回呼 fn(timestamp)
```

- `onInput`：每當任何玩家按下/放開按鍵時呼叫
- `update`：每個動畫帧呼叫（requestAnimationFrame，約 60fps）。如果沒有呼叫 `update()`，會顯示預設的按鍵視覺化
- `players` Map 中的 `inputs` Set 會自動追蹤目前按住的按鍵

### 範例 1：多人搶答器

一個簡單的搶答遊戲 — Host 出題，玩家搶按按鈕，最快按到的得分。

在 Editor 的「Display 遊戲程式碼（選填）」欄位輸入：

```javascript
// ── 多人搶答器 ──
const ctx = GameAPI.ctx;
const canvas = GameAPI.canvas;
const players = GameAPI.players;

let buzzer = null; // { playerId, name, color, time }
let round = 0;

// 監聽按鍵
GameAPI.onInput((playerId, key, state, p) => {
  if (state !== 'down') return;
  if (key === 'btn1' && !buzzer) {
    buzzer = { playerId, name: p.name, color: p.color, time: Date.now() };
  }
});

// 每帧渲染
GameAPI.update(ts => {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#0a0a2a';
  ctx.fillRect(0, 0, W, H);

  // 標題
  ctx.fillStyle = '#ffdd44';
  ctx.font = `700 ${Math.min(W * 0.06, 48)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('搶答器', W / 2, H * 0.15);

  // 顯示搶答結果
  if (buzzer) {
    ctx.save();
    ctx.shadowColor = buzzer.color;
    ctx.shadowBlur = 30;
    ctx.fillStyle = buzzer.color;
    ctx.font = `900 ${Math.min(W * 0.08, 64)}px sans-serif`;
    ctx.fillText(`${buzzer.name} 搶到了！`, W / 2, H * 0.5);
    ctx.restore();
  } else {
    ctx.fillStyle = '#5555aa';
    ctx.font = `600 ${Math.min(W * 0.04, 32)}px sans-serif`;
    ctx.fillText('等待搶答...', W / 2, H * 0.5);
  }

  // 底部顯示玩家列表
  const pArr = [...players.values()];
  ctx.font = `600 ${Math.min(W * 0.025, 20)}px sans-serif`;
  const startY = H * 0.75;
  pArr.forEach((p, i) => {
    const x = W * 0.2 + (i % 4) * W * 0.2;
    const y = startY + Math.floor(i / 4) * 30;
    ctx.fillStyle = p.color;
    ctx.fillText(p.name, x, y);
  });
});
```

對應的 manifest 階段設定：

```json
{
  "id": "buzzer",
  "name": "搶答",
  "type": "game",
  "enabled": true,
  "gameConfig": {
    "layout": "pad-2",
    "btnLabels": { "btn1": "搶！" },
    "gameCode": "<上面這段程式碼>"
  },
  "advance": { "trigger": "host" }
}
```

### 範例 2：小蜜蜂射擊遊戲

完整的多人合作小蜜蜂遊戲，包含：
- 每位玩家各自控制一艘太空船
- 敵人方陣移動與射擊
- 碰撞偵測與計分
- 共享生命值

核心結構如下（完整程式碼見 `server/modules/space-invaders/manifest.json` 的 `gameCode`）：

```javascript
const ctx = GameAPI.ctx;
const canvas = GameAPI.canvas;
const players = GameAPI.players;

// ── 遊戲常數 ──
const PLAYER_SPD_SEC = 30;   // 玩家移動速度（單位/秒）
const BULLET_SPEED = 4;       // 子彈速度（單位/tick）
const TICK_MS = 67;           // 遊戲邏輯刷新率（~15fps）
const PLAYER_Y = 88;          // 玩家 Y 位置（%）

// ── 遊戲狀態 ──
let score = 0, lives = 5;
let bullets = [], ebullets = [], enemies = [];
let active = true, over = false, won = false;

// 每位玩家各自的太空船
const ships = new Map(); // playerId → { x, dir, cooldown, emoji }

// 取得或建立太空船
function getShip(playerId) {
  if (!ships.has(playerId)) {
    ships.set(playerId, { x: 50, dir: 0, cooldown: 0, emoji: '🚀' });
  }
  return ships.get(playerId);
}

// ── 輸入處理 ──
GameAPI.onInput((playerId, key, state, p) => {
  if (!active) return;
  const ship = getShip(playerId);
  if (state === 'down') {
    if (key === 'left' || key === 'up-left' || key === 'down-left') ship.dir = -1;
    else if (key === 'right' || key === 'up-right' || key === 'down-right') ship.dir = 1;
    else if (key === 'btn1' && ship.cooldown <= 0) {
      bullets.push({ x: ship.x, y: PLAYER_Y - 3 });
      ship.cooldown = 10;
    }
  } else {
    if ((key.includes('left') && ship.dir === -1) ||
        (key.includes('right') && ship.dir === 1)) ship.dir = 0;
  }
});

// ── 渲染迴圈 ──
let tickAcc = 0, lastTs = 0, tick = 0;

GameAPI.update(ts => {
  // 玩家移動：每帧用 delta time 平滑移動
  const dt = lastTs ? (ts - lastTs) / 1000 : 0;
  for (const ship of ships.values()) {
    ship.x += ship.dir * PLAYER_SPD_SEC * dt;
    ship.x = Math.max(5, Math.min(95, ship.x));
  }

  // 遊戲邏輯：固定 tick rate
  if (lastTs) tickAcc += ts - lastTs;
  lastTs = ts;
  while (tickAcc >= TICK_MS) {
    tickAcc -= TICK_MS;
    tick++;
    // 移動子彈、敵人、碰撞偵測...
  }

  // 繪製畫面...
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#05051a';
  ctx.fillRect(0, 0, W, H);
  // 繪製星空、敵人、子彈、玩家太空船...
});
```

### gameCode 注意事項

1. **使用 delta time**：玩家移動應用 `dt`（時間差）而非固定值，確保不同帧率下行為一致
2. **遊戲邏輯用 tick 累計器**：物理、碰撞等邏輯建議用固定頻率（如 15fps），避免高速設備上遊戲變太快
3. **避免無限迴圈**：`update` 回呼每帧都會執行，確保不會卡住
4. **遊戲結束後停止更新**：設定 `active = false` 後應在 `update` 開頭檢查並跳過
5. **字串內容**：gameCode 存在 JSON 字串中，避免使用反斜線（除非是 JSON 跳脫）
6. **沒有 DOM 存取**：gameCode 只能使用 Canvas API，不能操作 HTML DOM

---

## 5. 進階：server.js 自訂邏輯

### 何時需要 server.js？

大多數遊戲可以用**純 manifest**（加上 gameCode）完成。以下情況需要 server.js：

- 需要自訂投票結果處理邏輯
- 需要複雜的計分或規則判定
- 需要伺服器端遊戲迴圈（不依賴 client 端 Canvas）
- 需要與外部 API 互動

### BaseModule 生命週期

```
建構式 → onStart() → _enterStageOrLoop()
                          ↓
                   _startCurrentStage() ← 每個階段重複
                          ↓
                   _advanceStage() → 下一階段 或 resetToLobby()
```

#### 可覆寫的方法

| 方法 | 觸發時機 | 用途 |
|---|---|---|
| `onStart(players, session)` | 遊戲開始時 | 初始化遊戲狀態 |
| `onPlayerAction(playerId, action, data, session)` | 玩家操作時 | 處理自訂動作 |
| `onVoteEnded(results, session)` | 投票結束時 | 自訂投票結果處理 |
| `onPlayerEliminated(playerId, session)` | 玩家被淘汰時 | 淘汰後處理 |
| `onReconnect(playerId, session)` | 玩家重連時 | 恢復玩家狀態 |

### 基本模式

```javascript
// server/modules/my-game/server.js
const BaseModule = require('../../core/BaseModule');

class MyGameModule extends BaseModule {
  constructor(manifest, session, config) {
    super(manifest, session, config);
    // 自訂初始化
  }

  async onStart(players, session) {
    await super.onStart(players, session);
    // 遊戲開始時的邏輯
  }

  async onPlayerAction(playerId, action, data, session) {
    // 處理自訂動作（注意：記得 await super 處理預設行為）
    if (action === 'game' && this._currentStage()?.type === 'game') {
      // 自訂遊戲邏輯...
      return; // 已處理，不傳給 display
    }
    await super.onPlayerAction(playerId, action, data, session);
  }

  async onVoteEnded(results, session) {
    // 自訂投票結果處理
    console.log('投票結果:', results);
    await super.onVoteEnded(results, session);
  }
}

module.exports = MyGameModule;
```

### 共享狀態

`sharedState` 是一個同步到所有客戶端的共享物件：

```javascript
// 在模組中更新共享狀態
this.sharedState.displayHtml = '<div>大螢幕內容</div>';
this.session.updateSharedState({ displayHtml: this.sharedState.displayHtml });
```

Display 端會收到 `state_update` 事件，並將 `displayHtml` 設定到 `#moduleDisplay` 元素的 innerHTML。

> **注意**：`displayHtml` 是純 HTML，不會執行 `<script>` 標籤。如果需要互動式遊戲，請使用 `gameCode`。

### 範例：自訂投票結果處理

參考 `server/modules/vote-demo/server.js`：

```javascript
const BaseModule = require('../../core/BaseModule');

class VoteDemoModule extends BaseModule {
  async onVoteEnded(voteData, session) {
    const { results, eliminated } = voteData;

    // 發送通知給所有玩家
    if (eliminated && eliminated.length > 0) {
      const eliminatedNames = eliminated.map(p => p.name).join(', ');
      session.broadcastAll('toast', {
        message: `${eliminatedNames} 被淘汰了！`
      });
    }

    await super.onVoteEnded(voteData, session);
  }

  async onPlayerEliminated(playerId, session) {
    const player = this.players.find(p => p.id === playerId);
    console.log(`玩家 ${player?.name} 被淘汰`);
    await super.onPlayerEliminated(playerId, session);
  }
}

module.exports = VoteDemoModule;
```

---

## 6. 進階功能

### Loop 階段

`loop` 階段可以將子階段重複執行，適合多回合遊戲（如狼人殺）：

```json
{
  "id": "game-loop",
  "name": "遊戲主迴圈",
  "type": "loop",
  "maxIterations": 5,
  "exitCondition": {
    "type": "alivePlayers",
    "operator": "lte",
    "value": 1,
    "checkAfter": "each_iteration"
  },
  "stages": [
    { "id": "night-vote", "type": "vote", "name": "夜晚投票", ... },
    { "id": "day-intermission", "type": "intermission", "name": "白天討論", ... },
    { "id": "day-vote", "type": "vote", "name": "白天投票", ... }
  ]
}
```

#### 退出條件

| 欄位 | 說明 |
|---|---|
| `type` | `iterations`（迭代次數）或 `alivePlayers`（存活玩家數） |
| `operator` | `lt`, `lte`, `gt`, `gte`, `eq`, `neq` |
| `value` | 比較值 |
| `checkAfter` | `each_stage`（每個子階段後）或 `each_iteration`（每次完整迭代後） |

### ParamActions 系統

`paramActions` 允許在階段開始或結束時自動操作參數：

```json
{
  "id": "init-stage",
  "type": "intermission",
  "paramActions": [
    {
      "trigger": "onStageStart",
      "action": "setValue",
      "targetGlobalParam": "roundCount",
      "value": 1
    },
    {
      "trigger": "onStageEnd",
      "action": "storeVoteWinner",
      "targetGlobalParam": "voteWinner"
    }
  ]
}
```

支援的 action：
- `setValue` — 設定參數值
- `addValue` / `subtractValue` / `multiplyValue` — 數值運算
- `resetParam` — 重設參數為初始值
- `storeVoteWinner` — 將投票勝者存入參數
- `eliminatePlayer` — 淘汰指定玩家

### 全域參數與玩家屬性

在 manifest 中定義，可在遊戲中透過 `session.setGlobalParam()` 和 `session.setPlayerParam()` 操作：

```json
{
  "globalParams": [
    { "id": "roundCount", "label": "回合數", "type": "number", "default": 1 }
  ],
  "playerAttributes": [
    { "id": "score", "label": "分數", "type": "number", "default": 0 },
    { "id": "team", "label": "隊伍", "type": "select", "options": ["red", "blue"] }
  ]
}
```

### 模組快照隔離

建立房間時，伺服器會對 manifest 和 server.js 做**深層複製**：

- Editor 可以在遊戲進行中自由修改，不影響已建立的房間
- 同一模組的多個房間完全獨立
- 修改只對**新建立的房間**生效

---

## 7. 除錯與部署

### 常見問題

**Q: Display 沒有顯示 gameCode 的遊戲畫面？**

確認你已經**重新建立新房間**。Manifest 在建房間時被複製，舊房間不會拿到新的 gameCode。

**Q: gameCode 有錯誤但沒看到報錯？**

打開 Display 的瀏覽器 Console，搜尋 `[Display] gameCode error:`。gameCode 的錯誤會被 catch 但會 console.error。

**Q: 玩家手機斷線後重連？**

框架自動處理重連恢復，包括：手牌、身份、投票狀態、當前階段。恢復窗口為 30 秒。

**Q: 方向鍵移動太快/太慢？**

在 gameCode 中使用 `delta time` 而非固定值來計算移動量：
```javascript
const dt = lastTs ? (ts - lastTs) / 1000 : 0;
ship.x += ship.dir * SPEED_PER_SEC * dt;
```

### LAN 測試

```bash
npm run start:lan
```

或在 Host 頁面點擊 ⚙️ 設定自訂 IP。

### TouchDesigner / Web Render TOP 整合

將 `/display?room=ABCDEF` 餵給 Web Render TOP。Display 持續接收 `state_update` 事件。

---

## 8. 附錄

### Manifest 完整欄位參考

```jsonc
{
  // ── 基本資訊 ──
  "id": "my-game",           // 模組 ID（英文、數字、底線、連字號）
  "name": "我的遊戲",         // 顯示名稱
  "version": "1.0.0",        // 版本號
  "description": "遊戲描述",
  "minPlayers": 2,           // 最少玩家數（1-50）
  "maxPlayers": 8,           // 最多玩家數（1-50）
  "engine": "other-module",  // 可選：引用其他模組的 server.js

  // ── 場地設定 ──
  "fieldConfig": {
    "handSize": {
      "label": "手牌數",
      "type": "number",
      "default": 5,
      "min": 1,
      "max": 10
    }
  },

  // ── 牌組 ──
  "decks": [
    {
      "id": "roles",
      "name": "角色牌",
      "type": "role",           // role | action
      "visibility": "private",  // private | public
      "drawCount": 1,
      "allowDuplicate": false,
      "enabled": true,
      "ref": "fantasy-roles",   // 引用全域牌組
      "selectedCards": {}       // 選牌：{ cardId: count }
    }
  ],

  // ── 階段 ──
  "stages": [
    {
      "id": "stage-1",
      "name": "階段名稱",
      "type": "game",           // 階段類型
      "enabled": true,
      "description": "階段說明文字",

      // ── 遊戲控制器設定（type: "game"） ──
      "gameConfig": {
        "layout": "dpad-2btn",
        "btnLabels": { "btn1": "A" },
        "gameCode": "JavaScript 程式碼"
      },

      // ── 投票設定（type: "vote"） ──
      "voteConfig": {
        "title": "投票標題",
        "target": "players",
        "options": [],
        "countdownSeconds": 30,
        "anonymous": false,
        "allowSelfVote": false,
        "multiSelect": false,
        "maxSelections": 1,
        "canChangeVote": true,
        "revealDelay": 2
      },

      // ── 推進條件 ──
      "advance": {
        "trigger": "host",
        "duration": 5,
        "fallback": "host"
      },

      // ── 牌組關聯 ──
      "deckId": "roles",

      // ── 回合設定（type: "card_play"） ──
      "maxRounds": 5,
      "refillMode": "none",

      // ── 迴圈設定（type: "loop"） ──
      "maxIterations": 3,
      "exitCondition": {
        "type": "alivePlayers",
        "operator": "lte",
        "value": 1,
        "checkAfter": "each_iteration"
      },

      // ── 參數操作 ──
      "paramActions": []

      // ── 迴圈子階段（type: "loop"） ──
      // "stages": [ /* 子階段 */ ]
    }
  ],

  // ── 全域參數 ──
  "globalParams": [
    { "id": "roundCount", "label": "回合數", "type": "number", "default": 1 }
  ],

  // ── 玩家屬性 ──
  "playerAttributes": [
    { "id": "score", "label": "分數", "type": "number", "default": 0 }
  ]
}
```

### Socket 事件清單

#### Server → All
| 事件 | 說明 |
|---|---|
| `stage_started` | 階段開始（含 gameConfig） |
| `game_started` | 遊戲開始 |
| `game_ended` | 遊戲結束（含排名） |
| `state_update` | 共享狀態更新 |
| `loop_started` | 迴圈開始 |
| `loop_iteration` | 迴圈新一輪 |
| `back_to_lobby` | 回到大廳 |

#### Server → Display
| 事件 | 說明 |
|---|---|
| `player_input` | 玩家控制器輸入 |
| `cards_revealed` | 揭牌（含 displayHtml） |

#### Server → Player
| 事件 | 說明 |
|---|---|
| `identity_assigned` | 身份分配 |
| `cards_drawn` | 抽牌結果 |
| `vote_started` | 投票開始 |
| `vote_cast` | 投票成功 |
| `vote_countdown` | 投票倒數 |
| `vote_ended` | 投票結束（含結果） |
| `players_eliminated` | 玩家被淘汰 |

#### Player → Server
| 事件 | 說明 |
|---|---|
| `player_action` | 玩家操作（action + data） |
| `cast_vote` | 投票 |
| `confirm_identity` | 確認身份 |
| `play_card` | 出牌 |

### 控制器按鍵對照表

| 佈局 | 按鍵 |
|---|---|
| `dpad-2btn` | `up`, `down`, `left`, `right`, `up-left`, `up-right`, `down-left`, `down-right`, `btn1`, `btn2` |
| `dpad-dpad` | `up`, `down`, `left`, `right`, `up-left`, `up-right`, `down-left`, `down-right`, `up2`, `down2`, `left2`, `right2`, `up2-left2`, `up2-right2`, `down2-left2`, `down2-right2` |
| `pad-4` | `btn1`, `btn2`, `btn3`, `btn4` |
| `pad-8` | `btn1` ~ `btn8` |
| `pad-2` | `btn1`, `btn2` |

### 檔案結構

```
immersive-game/
├── server/
│   ├── index.js                  ← Express + Socket.IO 入口
│   ├── core/
│   │   ├── BaseModule.js        ← 通用遊戲引擎
│   │   ├── ModuleLoader.js      ← 模組載入器
│   │   ├── DeckManager.js       ← 全域牌組管理
│   │   ├── GameSession.js       ← 房間狀態機
│   │   └── PlayerManager.js     ← 玩家管理
│   ├── modules/
│   │   └── <module-id>/
│   │       ├── manifest.json    ← 模組定義（必要）
│   │       └── server.js        ← 自訂邏輯（選用）
│   └── decks/                   ← 全域牌組 JSON
├── client/
│   ├── mobile/game.html         ← 玩家手機介面
│   ├── host/index.html          ← 主持人控制台
│   ├── display/index.html       ← 大螢幕介面
│   ├── editor/index.html        ← 模組編輯器
│   ├── decks/                   ← 牌組管理介面
│   └── shared/
│       ├── socket.js            ← Socket.IO 封裝
│       └── config.js            ← 語言切換 + IP 設定
└── public/uploads/              ← 卡牌圖片
```

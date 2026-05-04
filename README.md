# Immersive Game

多人手機 + 大螢幕互動的沉浸式遊戲框架。設計目的是讓沉浸式空間裡的觀眾，用手機當作私人介面（手牌、身份卡、按鈕），同時搭配一個大螢幕作為共同視覺場景，由一位 host／GM 控制流程。

```
                        ┌─────────────────┐
                        │   大螢幕 / TD    │
                        │   (display)     │
                        └────────▲────────┘
                                 │
   📱 手機 ──┐              Socket.IO
   📱 手機 ──┤  ←──────────►  Server  ←─────────► 🎛 Host 控制台
   📱 手機 ──┤                                    (host UI)
   📱 手機 ──┘
```

設定一份遊戲不用寫程式 — 用內建 **編輯器** 做出新模組（卡牌內容、階段、推進規則、計時器、投票設定、循環邏輯），存檔即可開玩。

---

## Quick start

```bash
npm install
npm start                                 # localhost:3000
npm run start:lan                         # 用本機 en0 IP 開放 LAN（手機掃 QR code 用）
npm run dev                               # nodemon
```

啟動後會看到：

```
🎮 Immersive Game Server
   Local   → http://localhost:3000
   Mobile  → http://localhost:3000/mobile
   Display → http://localhost:3000/display
   Host    → http://localhost:3000/host
   Editor  → http://localhost:3000/editor
   Decks   → http://localhost:3000/decks
```

| URL | 角色 | 設備 |
|-----|------|------|
| `/host` | 主持人 — 開房、選模組、推進階段、踢人 | 桌機／平板 |
| `/mobile` | 玩家 — 看私人手牌、出牌、確認身份、投票 | 手機 |
| `/display` | 大螢幕公共資訊 — 進度、投票結果、視覺 | 投影機／TD Web Render |
| `/editor` | 設計師 — 建立／修改／刪除遊戲模組 | 桌機 |
| `/decks` | 設計師 — 管理共用牌組（卡牌內容＋圖片） | 桌機 |

---

## 一場遊戲的流程

1. **Host** 打開 `/host` → 選擇模組 → 「建立房間」拿到房號 + QR code
2. **玩家** 用手機掃 QR 進到 `/mobile?room=ABCDEF`，輸入名稱
3. **大螢幕** 打開 `/display?room=ABCDEF`
4. **Host** 確認人數準備齊全 → 啟動遊戲
5. 遊戲依模組階段流程跑
6. 結束後 host 可重新開始或關閉房間

玩家斷線給 30 秒寬限重連，重連後手牌、身份、投票狀態、目前階段全部自動還原。

---

## 框架核心概念

### 1. 模組 (Module)
一個 `manifest.json` 就是一個遊戲，位於 `server/modules/<id>/`。

```jsonc
{
  "id": "card-battle",
  "name": "卡牌對戰",
  "minPlayers": 2,
  "maxPlayers": 8,
  "version": "2.0.0",
  "decks":  [ /* 牌組 */ ],
  "stages": [ /* 階段流程 */ ]
}
```

### 2. 階段 (Stages)

階段是遊戲流程的骨架。目前支援以下 type：

| Type | 行為 |
|------|------|
| `identity_draw` | 從指定牌組抽牌，私下發給每位玩家當身份／角色 |
| `card_play` | 多回合出牌 → 翻牌 → 結算 → 下一回合 |
| `vote` | 公開或匿名投票，支援倒數計時、單選／多選、換票 |
| `intermission` | 暫停等待，僅顯示說明文字，不觸發任何遊戲邏輯 |
| `loop` | 循環執行一組子階段 N 次（可用於多輪投票、多輪劇情等） |
| `result` | 計算最終排名、廣播 `game_ended` |

#### 推進條件 (advance)

```jsonc
"advance": {
  "trigger": "all_played",   // 見下表
  "duration": 5,             // timer/auto 用（秒）
  "fallback": "host"         // 任何 trigger 都可加，host 保留強制推進鈕
}
```

| Trigger | 意義 |
|---------|------|
| `host` | Host 按按鈕（預設） |
| `all_played` | 全員出牌後自動 |
| `all_confirmed` | 全員確認身份後自動 |
| `vote_ended` | 投票結果出來後自動 |
| `auto` | 固定延遲後自動（不顯示倒數） |
| `timer` | 倒數結束後自動，三端都看到秒數 |

`fallback: 'host'` 表示就算是自動推進，host 仍保留強制推進按鈕。

#### vote 階段設定

```jsonc
{
  "type": "vote",
  "name": "淘汰投票",
  "voteConfig": {
    "title": "請投票淘汰一位玩家",
    "target": "players",          // players | options
    "options": [],                // target=options 時手動填選項
    "countdownSeconds": 30,       // 0 = 不計時
    "anonymous": false,           // 匿名投票
    "allowSelfVote": false,
    "multiSelect": false,
    "maxSelections": 1,
    "canChangeVote": true,
    "revealDelay": 2              // 結果公布延遲秒數
  },
  "advance": { "trigger": "vote_ended", "fallback": "host" }
}
```

#### loop 階段設定

```jsonc
{
  "type": "loop",
  "name": "多輪投票",
  "loopConfig": { "iterations": 3 },
  "childStages": [
    { "type": "intermission", "name": "說明", "advance": { "trigger": "host" } },
    { "type": "vote", "name": "投票", "voteConfig": { ... }, "advance": { "trigger": "vote_ended" } }
  ]
}
```

### 3. 牌組 (Decks)
兩種來源：

**內嵌**（manifest 自帶）：
```jsonc
{ "id": "action", "name": "行動牌組", "type": "action",
  "drawCount": 5, "allowDuplicate": true, "enabled": true,
  "cards": [
    { "id": "c1", "name": "火球術", "value": 9, "description": "強攻" }
  ]
}
```

**引用全域**（多模組共用）：
```jsonc
{ "ref": "fantasy-roles" }
```

全域牌組存在 `server/decks/*.json`，用 `/decks` UI 管理（含卡牌圖片上傳）。

### 4. 引擎 (Engine)
所有模組共用 `server/core/BaseModule.js` 通用引擎。若需客製邏輯，在模組目錄放 `server.js` 繼承 `BaseModule`：

```js
const BaseModule = require('../../core/BaseModule');
class MyGame extends BaseModule {
  async onPlayerAction(playerId, action, data, session) {
    // 自訂行為
  }
}
module.exports = MyGame;
```

---

## 重連恢復 (Reconnect Recovery)

玩家斷線後重連，server 會自動推送完整狀態還原封包：

| 事件 | 內容 |
|------|------|
| `identity_assigned` | 身份牌（含 `alreadyConfirmed` 旗標，已確認者不彈確認 overlay） |
| `cards_drawn` | 目前手牌 |
| `stage_started` | 目前所在階段（含 loop context） |
| `vote_started` | 如果正在投票中，補發完整投票資訊 |
| `vote_countdown` | 投票剩餘秒數 |
| `vote_cast` | 如果玩家已投票，恢復「已投票」狀態 |
| `players_eliminated` | 如果玩家已被淘汰 |

---

## 目錄結構

```
immersive-game/
├── README.md
├── server/
│   ├── index.js                    ← Express + Socket.IO 主入口
│   ├── core/
│   │   ├── BaseModule.js           ← 通用遊戲引擎（stage traversal、vote、loop、reconnect）
│   │   ├── ModuleLoader.js         ← 掃描／載入 manifest
│   │   ├── DeckManager.js          ← 全域牌組 CRUD
│   │   ├── GameSession.js          ← 房間狀態機
│   │   └── PlayerManager.js        ← 玩家管理
│   ├── api/
│   │   └── decks.js                ← /api/decks REST 路由
│   ├── modules/
│   │   ├── card-battle/            ← 內建範例：卡牌對戰
│   │   ├── multi-stage-test/       ← 測試：多階段流程
│   │   ├── public-vote-test/       ← 測試：公開投票
│   │   └── vote-demo/             ← 測試：投票示範
│   └── decks/                      ← 全域牌組 JSON
├── client/
│   ├── mobile/game.html            ← 玩家手機端
│   ├── host/index.html             ← Host 控制台
│   ├── display/index.html          ← 大螢幕公共介面
│   ├── editor/index.html           ← 模組編輯器
│   ├── decks/                      ← 全域牌組管理
│   └── shared/socket.js            ← 共用 socket wrapper
└── public/uploads/                 ← 卡牌圖片（不進 git）
```

---

## 內建模組

### `card-battle` — 卡牌對戰
2–8 人，每人手牌 5 張，依設定回合數出牌比點數，最高 value 者得 1 分，最後總分高者勝。支援身份抽取、補牌模式設定。

---

## 開發

### LAN 模式（手機真機測試）
```bash
npm run start:lan
```
自動抓 `en0` IP，QR code 讓同 WiFi 手機直接連。

### TouchDesigner / Web Render TOP
把 `/display?room=ABCDEF` 餵給 Web Render TOP 即可。Display 端持續收到 `state_update`。

### 環境變數
| 變數 | 說明 |
|------|------|
| `PORT` | 服務 port（預設 3000） |
| `HOST` | QR code 內嵌的 IP（預設用 request Host header） |

---

## 授權
TBD

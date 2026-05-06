# Immersive Game

中文版 | **[English](README.md)**

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
| `/editor` | 設計師 — 建立／修改／刪除遊戲模組，支援卡牌挑選 | 桌機 |
| `/decks` | 設計師 — 管理共用牌組（卡牌內容＋圖片上傳） | 桌機 |

### 自訂 IP / LAN 設定

Host 頁面有 ⚙️ 設定按鈕，可以輸入自訂 IP，讓 QR code 和 mobile 連結指向正確的 LAN 位址 — 適合 server 跑在不同機器上的場景。

---

## 一場遊戲的流程

1. **Host** 打開 `/host` → 選擇模組 → 「建立房間」拿到房號 + QR code
2. **玩家** 用手機掃 QR 進到 `/mobile?room=ABCDEF`，輸入名稱
3. **大螢幕** 打開 `/display?room=ABCDEF`
4. **Host** 確認人數準備齊全 → 啟動遊戲
5. 遊戲依模組階段流程跑
6. 結束後 host 可重新開始或關閉房間

玩家斷線給 30 秒寬限重連，重連後手牌、身份、投票狀態、目前階段全部自動還原。

**中途加入**：如果玩家在 `game` 階段進行中才加入房間，手機會顯示「遊戲進行中，請等待下一輪」提示。遊戲重新開始時，該玩家會自動加入成為正式玩家。

---

## 主要功能

### 🎴 自訂牌組組合
在編輯器中建立遊戲模組時，可以從全域牌組中挑選特定卡牌來建立自訂牌組：

**使用步驟**：
1. 在編輯器中選擇一個模組
2. 切換到「牌組」分頁
3. 新增一個牌組或編輯現有牌組
4. 從下拉選單選擇一個全域牌組
5. 展開牌組後會看到該牌組的所有卡牌列表
6. 勾選想要的卡牌，並在右側輸入框設定張數
7. 使用「全選」快速選取所有卡牌，或「清除」取消所有選擇
8. 儲存模組後，遊戲將只使用選中的卡牌和指定張數

**應用場景**：
- 從大型角色牌組中挑選特定角色給新手局
- 調整行動牌的強度分佈（減少高點數卡牌）
- 建立主題變體（例如：只用魔法類卡牌）
- 測試用小牌組（加快遊戲節奏）

**技術細節**：
- 卡牌選擇資訊儲存在模組 manifest 的 `selectedCards` 欄位
- 格式：`{ "cardId": count, ... }`
- 未選擇任何卡牌時，使用完整牌組
- 切換全域牌組時會自動清空已選擇的卡牌

### 🔒 模組快照隔離

建立房間時，server 會對模組的 manifest 和引擎程式碼做深層複製（deep-clone snapshot）。效果：

- 遊戲進行中可以自由修改編輯器內容，不影響進行中的房間
- 多個房間使用同一個模組時完全獨立互不干擾
- 在編輯器儲存的變更只對之後新建的房間生效

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
| `game` | 將 mobile 變成即時遊戲控制器，按鍵訊號即時傳送到 display canvas；支援自訂 `gameCode` 打造完整 canvas 互動遊戲 |
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
| `identity_timer` | 全員確認後倒數 |
| `auto_next` | 翻牌後立即推進下一階段 |
| `round_timer` | 翻牌後倒數推進 |
| `host_reveal` | Host 手動翻牌 |
| `play_timer` | 全員出牌後倒數翻牌 |
| `all_submitted` | 全員提交後自動 |
| `auto_restart` | 立即重新開始遊戲 |
| `restart_timer` | 倒數後重新開始 |

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

#### game 階段設定

```jsonc
{
  "type": "game",
  "name": "多人控制器",
  "gameConfig": {
    "layout": "dpad-2btn",     // 見下表
    "buttonLabels": {          // 各按鍵自訂標籤（選填）
      "btn1": "A",
      "btn2": "B"
    },
    "gameCode": "..."          // display canvas 遊戲邏輯 JS（選填）
  },
  "advance": { "trigger": "host" }
}
```

**控制器樣式 (`layout`)**：

| 值 | 外觀 |
|----|------|
| `pad-8` | 2×4 八按鈕格狀（btn1–btn8） |
| `pad-4` | 2×2 四按鈕格狀（btn1–btn4） |
| `pad-2` | 左右兩個大按鈕（btn1, btn2） |
| `dpad-2btn` | 左側十字鍵（up/down/left/right）＋右側 A/B 兩鍵 |
| `dpad-dpad` | 雙十字鍵（左 up/down/left/right，右 up2/down2/left2/right2） |

每次玩家按下或放開按鍵，server 都會以 `player_input` 事件即時廣播到 display：

```json
{ "playerId": "p1", "playerName": "Alice", "key": "btn1", "state": "down" }
```

**`gameCode` — 自訂 display 遊戲**

`gameCode` 是一段 JavaScript，在 display 端執行，可透過 `GameAPI` 物件接收玩家輸入並自訂畫面：

```js
// GameAPI 提供：
// GameAPI.canvas   — HTMLCanvasElement（全畫面）
// GameAPI.ctx      — CanvasRenderingContext2D
// GameAPI.players  — Map<playerId, { name, color, inputs: Set<key> }>
// GameAPI.onInput(fn)  — 每次有按鍵事件時呼叫 fn(playerId, key, state, player)
// GameAPI.update(fn)   — 每個動畫影格呼叫 fn(timestamp)，取代預設視覺化

GameAPI.onInput((playerId, key, state, p) => {
  // 即時響應按鍵
});
GameAPI.update(ts => {
  const ctx = GameAPI.ctx;
  // 自訂繪圖邏輯
});
```

若未提供 `gameCode`，display 顯示預設視覺化：每個玩家有彩色區塊，按下的按鍵以發光圓圈呈現。

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
{
  "ref": "fantasy-roles",
  "id": "my-custom-deck",
  "name": "自訂奇幻牌組",
  "drawCount": 3,
  "allowDuplicate": false,
  "selectedCards": {
    "warrior": 2,
    "mage": 1,
    "rogue": 1
  }
}
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

Display 端如果在 `game` 階段進行中重新整理或後來才開，canvas 程式碼會從目前階段狀態自動重新啟動。

---

## 目錄結構

```
immersive-game/
├── README.md
├── server/
│   ├── index.js                    ← Express + Socket.IO 主入口
│   ├── core/
│   │   ├── BaseModule.js           ← 通用遊戲引擎（stage traversal、vote、loop、reconnect）
│   │   ├── ModuleLoader.js         ← 掃描／載入 manifest；支援快照載入
│   │   ├── DeckManager.js          ← 全域牌組 CRUD
│   │   ├── GameSession.js          ← 房間狀態機
│   │   └── PlayerManager.js        ← 玩家管理
│   ├── api/
│   │   └── decks.js                ← /api/decks REST 路由
│   ├── modules/
│   │   ├── card-battle/            ← 內建範例：卡牌對戰
│   │   ├── input-test/             ← 測試：遊戲控制器（pad-4 佈局）
│   │   ├── multiuser-game/         ← 範例：多人即時卡牌遊戲
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
│   └── shared/
│       ├── socket.js               ← 共用 socket wrapper
│       └── config.js               ← 語言切換 + IP 設定（zh/en i18n）
└── public/uploads/                 ← 卡牌圖片（不進 git）
```

---

## 內建模組

### `card-battle` — 卡牌對戰
2–8 人，每人手牌 5 張，依設定回合數出牌比點數，最高 value 者得 1 分，最後總分高者勝。支援身份抽取、補牌模式設定。

### `input-test` — 控制器測試
1–8 人，單一 `game` 階段搭配 `pad-4` 佈局，用來驗證控制器輸入與 display 接收是否正常。

### `multiuser-game` — 多人即時遊戲
2–8 人。包含身份抽取階段，接著進入一個帶有自訂 `gameCode` canvas 的 `game` 階段 — 按鍵時會有飄字動畫，每個玩家有自己的彩色格子區域。示範如何在框架上打造完整的即時互動遊戲。

---

## 開發

### LAN 模式（手機真機測試）
```bash
npm run start:lan
```
自動抓 `en0` IP，QR code 讓同 WiFi 手機直接連。

也可以用 `npm start` 啟動，在 host 頁面的設定（⚙️）手動填入 IP。

### 編輯器使用指南
`/editor` 提供視覺化介面來設計遊戲模組，無需手動編輯 JSON：

1. **基本參數**分頁：設定模組名稱、說明、人數限制、版本等資訊
2. **牌組**分頁：
   - 新增牌組並引用全域牌組
   - 從引用的牌組中挑選特定卡牌
   - 設定每張卡牌的張數
   - 調整預設抽牌數和是否允許重複
3. **階段**分頁：
   - 新增不同類型的階段（身份抽取、出牌回合、投票、暫停、遊戲控制器、循環、結算）
   - 設定階段推進條件（手動、自動、倒數）
   - 配置投票參數（匿名、可否投自己、多選等）
   - 設定出牌回合的補牌模式和回合數
   - 設定 `game` 階段的佈局與 `gameCode`
4. **進階**分頁：
   - 直接編輯 manifest JSON 和 fieldConfig 結構描述
   - **編輯 server.js**：繼承 BaseModule 來實現自訂遊戲邏輯
     - 點擊「➕ 新增 server.js」或「📝 編輯 server.js」按鈕
     - 編輯器會自動驗證語法和基本結構
     - 必須繼承 BaseModule 並導出模組類
     - 範例：
       ```javascript
       const BaseModule = require('../../core/BaseModule');

       class MyModule extends BaseModule {
         async onPlayerAction(playerId, action, data, session) {
           // 自訂行為
         }
       }

       module.exports = MyModule;
       ```
     - 可刪除 server.js 來使用預設的 BaseModule 行為

**快捷鍵**：
- `⌘S` / `Ctrl+S`：儲存目前模組
- `⌘Z` / `Ctrl+Z`：還原上一步修改

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

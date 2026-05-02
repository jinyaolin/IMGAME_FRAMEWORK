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

設定一份遊戲不用寫程式 — 用內建 **編輯器** 做出新模組（卡牌內容、階段、推進規則、計時器、補牌邏輯），存檔即可開玩。

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
   Mobile  → http://localhost:3000/mobile      ← 玩家進房畫面
   Display → http://localhost:3000/display     ← 大螢幕 / TouchDesigner Web Render
   Host    → http://localhost:3000/host        ← Host／GM 控制台
   Editor  → http://localhost:3000/editor      ← 模組編輯器
   Decks   → http://localhost:3000/decks       ← 全域牌組管理
```

四個 UI 各自用途：

| URL | 角色 | 設備 |
|-----|------|------|
| `/host` | 主持人 — 開房、選模組、推進階段、踢人 | 桌機／平板 |
| `/mobile` | 玩家 — 看私人手牌、出牌、確認身份 | 手機 |
| `/display` | 大螢幕公共資訊 — 進度、結果、視覺特效 | 投影機／TD Web Render |
| `/editor` | 設計師 — 建立／修改／刪除遊戲模組 | 桌機 |
| `/decks` | 設計師 — 管理共用牌組（卡牌內容＋圖片） | 桌機 |

---

## 一場遊戲的流程

1. **Host** 打開 `/host` → 「建立房間」拿到房號 + QR code
2. **玩家** 用手機掃 QR 進到 `/mobile?room=ABCDEF`，輸入名稱 → 顯示在 host 畫面
3. **大螢幕** 打開 `/display?room=ABCDEF` 顯示房內狀態
4. **Host** 選一個遊戲模組 → 看人數準備齊全 → 啟動
5. 遊戲依模組設定的階段流程跑（身份抽取 → 出牌回合 → 結算…）
6. 結束後 host 可以：重新開始 / 換模組 / 回到大廳

每位玩家斷線會給 30 秒寬限重連，重連後手牌、身份、分數都還在。

---

## 框架核心概念

### 1. 模組 (Module)
一個 `manifest.json` 就是一個遊戲。位於 `server/modules/<id>/`。

```jsonc
{
  "id": "card-battle",
  "name": "卡牌對戰",
  "description": "比點數，最高分贏",
  "minPlayers": 2,
  "maxPlayers": 8,
  "version": "2.0.0",
  "engine": "card-battle",          // 可選：指向另一模組共用 server.js（衍生模組用）
  "fieldConfig": { /* 可調參數 */ },
  "decks":  [ /* 牌組（內嵌或 ref 全域） */ ],
  "stages": [ /* 階段流程 */ ]
}
```

### 2. 階段 (Stages)
階段是遊戲流程的骨架。每個階段有 type、是否啟用、推進條件。內建支援：

| Type | 行為 |
|------|------|
| `identity_draw` | 從指定牌組抽牌、私下發給每位玩家當身份／角色 |
| `card_play` | 多回合的出牌 → 翻牌 → 結算 → 下一回合 |
| `result` | 計算最終排名、廣播 `game_ended` |

每個階段用 `advance: { trigger, duration, fallback }` 控制何時進到下一階段：

| Trigger | 意義 |
|---------|------|
| `host` | host 按按鈕（預設） |
| `all_played` | 全員出牌後自動 |
| `all_confirmed` | 全員確認身份後自動 |
| `auto` | 固定延遲後自動（不顯示倒數） |
| `timer` | 倒數結束後自動，三端都看到秒數 |

`fallback: 'host'` 表示就算自動推進，host 仍然有強制按鈕。

`card_play` 階段內可額外設 `roundAdvance` 控制**回合間**的推進（reveal → 下一回合），格式跟 `advance` 完全一樣。

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
所有模組預設共用 `server/core/BaseModule.js` 這個通用引擎。Manifest 不需要 `engine` 欄位除非：
- 衍生模組（透過編輯器「另存為新模組」）會自動設 `engine: <source>`，繼承上游引擎更新
- 想寫客製邏輯：在模組目錄放 `server.js` 覆寫 `BaseModule` 的方法

```js
// server/modules/my-game/server.js
const BaseModule = require('../../core/BaseModule');
class MyGame extends BaseModule {
  async onPlayerAction(playerId, action, data, session) {
    // 自訂行為
  }
}
module.exports = MyGame;
```

---

## 目錄結構

```
immersive-game/
├── README.md                       ← 你正在看的
├── docs/
│   ├── architecture.md             ← 技術深入：核心類別、事件、資料流
│   └── module-authoring.md         ← 怎麼做新遊戲（給設計師）
├── package.json
├── server/
│   ├── index.js                    ← Express + Socket.IO 主入口
│   ├── core/
│   │   ├── BaseModule.js           ← 通用遊戲引擎
│   │   ├── ModuleLoader.js         ← 掃描 / 載入 manifest，解析 engine 與 deck ref
│   │   ├── DeckManager.js          ← 全域牌組 CRUD
│   │   ├── GameSession.js          ← 一個房間的狀態機
│   │   └── PlayerManager.js        ← 玩家管理（公開／私人狀態分離）
│   ├── api/
│   │   └── decks.js                ← /api/decks REST 路由
│   ├── modules/
│   │   └── card-battle/
│   │       └── manifest.json       ← 內建範例模組
│   └── decks/
│       ├── example-actions.json    ← 內建範例牌組
│       └── fantasy-roles.json
├── client/
│   ├── mobile/                     ← 玩家手機端
│   ├── host/                       ← Host 控制台
│   ├── display/                    ← 大螢幕公共介面
│   ├── editor/                     ← 模組編輯器
│   ├── decks/                      ← 全域牌組管理
│   └── shared/socket.js            ← 共用 socket wrapper
└── public/uploads/                 ← 卡牌圖片上傳目錄（不進 git）
```

---

## 內建模組

### `card-battle` — 卡牌對戰
2–8 人，每人手牌 5 張，依設定回合數出牌比點數，每回合最高 value 的人得 1 分，最後總分高者勝。

預設啟用「出牌回合 → 結算」兩個階段；可透過編輯器啟用「身份抽取」加入隊伍／角色機制，或調整補牌模式（不補牌／每回合補 N 張／低於門檻時補到 N 張）。

---

## 開發 / 部署

### 本機 LAN 模式（手機真機測試）
```bash
npm run start:lan
```
腳本會自動抓 `en0` 的 IP 寫進 `HOST` 環境變數，QR code 會用這個 IP，手機可在同 WiFi 連到。

### TouchDesigner / Web Render TOP
把 `/display?room=ABCDEF` 餵給 Web Render TOP 即可。Display 端會收到 `displayHtml` 事件包含完整 HTML，也會持續收到 `state_update` 用來做 GLSL/視覺反應。

### 環境變數
| 變數 | 說明 |
|------|------|
| `PORT` | 服務 port（預設 3000） |
| `HOST` | QR code 內嵌的 host／IP（預設用 request `Host` header） |

---

## 文件

- `docs/architecture.md` — 程式架構、核心類別、事件協議、資料流
- `docs/module-authoring.md` — 怎麼用編輯器做出新遊戲、什麼時候需要寫 server.js

---

## 授權
TBD（依 metaphysics 主專案）

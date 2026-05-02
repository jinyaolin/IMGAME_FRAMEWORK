# 怎麼做新遊戲

這份給設計師看 — 怎麼用既有的卡牌引擎做出不同玩法的遊戲。需要寫 JS 的進階情境放在最後一節。

---

## 路線一：純編輯器（不寫程式）

90% 的卡牌類玩法可以這樣做。

### 1. 開 `/editor`，從 `card-battle` 起步
1. 左側選 `card-battle`
2. 右上「📦 另存為新模組」→ 輸入新 ID（英數，例如 `mythology-cards`）跟顯示名稱
3. 自動切到新模組，現在可以盡情編輯，**原本的 card-battle 不會被動到**

### 2. 改基本參數（基本參數 tab）
- `初始手牌數`、`回合數`、`補牌模式` …
- 想新增可調參數？切「進階」tab → 「新增可調參數」

### 3. 改卡牌（牌組 tab）
- 點開牌組可改名稱、類型、抽牌數、是否允許重複
- 內嵌卡牌：直接改 name / value / description / 陣營
- 想用全域牌組：到 `/decks` 建好，然後在 manifest（用「進階 → Raw JSON」模式）把牌組改成 `{ "ref": "<deck-id>" }`

### 4. 改流程（階段 tab）
每個階段可：
- 改名稱、type（identity_draw / card_play / result）
- 引用哪個牌組
- **階段結束時推進** — 怎麼進下一階段
- **回合間推進**（card_play 才有）— reveal 後怎麼進下一回合

範例設定：

| 想要 | 怎麼設 |
|------|-------|
| 全員確認身份後自動發牌 | identity_draw 的「階段結束推進」→ 觸發條件「全員確認後」|
| 翻牌後 5 秒自動進下一回合 | card_play 的「回合間推進」→「倒數結束後自動」、秒數 5 |
| 倒數中 host 仍可手動跳過 | 勾「Host 仍可強制推進」|
| 全部回合結束 3 秒進結算 | card_play 的「階段結束推進」→「固定延遲後自動」、3 秒 |

### 5. 存檔
- 💾 **儲存** — 覆寫原檔（適合一直編輯同一個遊戲）
- 📦 **另存為新模組** — 又開一份新的（不會動到原本）

### 6. 試玩
打開 `/host`、選你的新模組、開遊戲。覺得不對就回編輯器繼續改 — `/host` 的模組清單會自動同步。

---

## 路線二：要超出引擎能力的玩法

如果你的玩法不能用現有 stage type / advance trigger 表達（例如「比點數低的贏」「分隊計分」「按按鈕跑分」之類），需要寫 JS。

### 在模組目錄放 `server.js`
```js
// server/modules/my-low-card/server.js
'use strict';
const BaseModule = require('../../core/BaseModule');

class MyLowCardModule extends BaseModule {
  // 覆寫翻牌計分邏輯
  async _revealRound(session) {
    // 自己實作或部分復用 super._revealRound
    // ...
  }
}

module.exports = MyLowCardModule;
```

### Manifest 不用 `engine` 欄位
留空就會找自己目錄的 `server.js`。

```json
{
  "id": "my-low-card",
  "name": "比小遊戲",
  ...
}
```

### 可以覆寫的鉤子

| 方法 | 用途 |
|------|------|
| `onStart(players, session)` | 遊戲開始（重設狀態、初始化 deck）|
| `onPlayerAction(pid, action, data, session)` | 玩家自訂 action |
| `onPlayerSubmit(pid, data, session)` | 玩家送表單資料 |
| `onPlayerDisconnected(pid, session)` | 玩家斷線（重檢推進條件）|
| `onHostNextPhase(data, session)` | host 推進按鈕 |
| `getGameState()` / `getHostState()` | 廣播時的序列化 |
| `_revealRound(session)` | （card_play）翻牌與計分 |
| `_dealCards(session, stage)` | （card_play）發牌 |
| `_assignIdentities(session, stage)` | （identity_draw）分配身份 |
| `_scheduleAdvance(key, advance, session, callback)` | 自動推進排程（含倒數）|

`session` 提供的廣播工具：
```js
session.broadcastAll(event, data);            // 房內所有人
session.broadcastDisplay(event, data);        // 只有大螢幕
session.sendToHost(event, data);              // 只有 host
session.sendToPlayer(playerId, event, data);  // 私訊某玩家
session.updateSharedState(patch);             // 自動廣播 sharedState 變動
session.sendHostGameState();                  // 把 getHostState() 結果送給 host
```

### 共用引擎（衍生模組指向上游）
如果好幾個模組共用同一份 server.js，把它們的 manifest 加上 `engine`：

```json
{ "id": "low-card-fantasy", "engine": "my-low-card", ... }
{ "id": "low-card-sci-fi",  "engine": "my-low-card", ... }
```

這兩個都會用 `my-low-card/server.js`，只是 manifest 裡的卡牌、階段、欄位不同。

> 💡 編輯器「另存為新模組」會自動設 `engine` 指回原模組，所以衍生出來的版本永遠繼承上游的 server.js 更新。

---

## 路線三：完全新的引擎類別

如果你的玩法跟卡牌一點關係都沒有（例如純文字 RPG、按鈕互動藝術裝置），可以**不繼承 BaseModule**，直接 export 一個有同樣 interface 的類別：

```js
class MyArtInstallation {
  constructor(manifest, session, config) { /* ... */ }

  async onStart(players, session) { /* ... */ }
  async onPlayerAction(pid, action, data, session) { /* ... */ }
  async onHostNextPhase(data, session) { /* ... */ }

  getGameState()  { return { /* for display */ }; }
  getHostState()  { return { /* for host */ }; }
}

module.exports = MyArtInstallation;
```

需要實作的最少 interface 在 `server/core/GameSession.js` 的 `handlePlayerAction`、`startModule`、`sendHostGameState` 看得到。

---

## Manifest 完整範例

```jsonc
{
  "id": "card-battle",
  "name": "卡牌對戰",
  "description": "比點數",
  "version": "2.0.0",
  "minPlayers": 2,
  "maxPlayers": 8,

  // 可調參數定義（host 開遊戲時可改、editor 也可調 default）
  "fieldConfig": {
    "handSize": {
      "label": "初始手牌數",
      "type":  "number",
      "default": 5, "min": 1, "max": 10
    },
    "maxRounds": {
      "label": "回合數",
      "type":  "number",
      "default": 5, "min": 1, "max": 20
    },
    "refillMode": {
      "label": "補牌模式",
      "type":  "select",
      "default": "none",
      "options": [
        { "value": "none",      "label": "不補牌" },
        { "value": "per_round", "label": "每回合補固定張數" }
      ]
    },
    "refillAmount": {
      "label": "每回合補幾張",
      "type":  "number",
      "default": 1, "min": 1, "max": 10,
      "showWhen": { "field": "refillMode", "value": "per_round" }   // ← 條件式顯示
    }
  },

  "decks": [
    { "id": "identity", "name": "身份牌組", "type": "role",
      "drawCount": 1, "allowDuplicate": false, "enabled": true,
      "cards": [
        { "id": "r1", "name": "戰士", "team": "red",  "description": "勇猛" },
        { "id": "r2", "name": "法師", "team": "blue", "description": "智慧" }
      ]
    },
    { "ref": "example-actions" }                                    // ← 引用全域牌組
  ],

  "stages": [
    { "id": "identity_draw", "name": "身份抽取", "type": "identity_draw",
      "deckId": "identity", "enabled": false,
      "advance": { "trigger": "all_confirmed", "fallback": "host" }
    },
    { "id": "card_play", "name": "出牌回合", "type": "card_play",
      "deckId": "action", "enabled": true,
      "advance":      { "trigger": "auto", "duration": 3 },          // 最後一回合進結算
      "roundAdvance": { "trigger": "timer", "duration": 8, "fallback": "host" } // 回合間倒數
    },
    { "id": "result", "name": "最終結果", "type": "result",
      "enabled": true,
      "advance": { "trigger": "host" }
    }
  ]
}
```

---

## 常見問題

**Q：編輯器存了，host 那邊看不到變更？**
A：host 應該收到 `modules_updated` 事件自動 refresh。手動的話 host 頁重新整理一次即可。

**Q：模組「正在遊戲中」存不了？**
A：故意的。先讓 host 結束那場遊戲（或 back_to_lobby）再存。

**Q：刪除模組失敗？**
A：①只剩一個模組無法刪、②正在被某房間使用無法刪。兩種情況前端都會顯示明確錯誤。

**Q：如何讓三端（host / display / player）顯示同一個 HTML？**
A：自訂模組裡 `session.updateSharedState({ displayHtml: '<div>…</div>' })`，display 端會收到並 render。

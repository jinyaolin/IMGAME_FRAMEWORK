# 架構文件

這份文件給開發者：解釋程式架構、核心類別、Socket 事件協議、資料流。對於設計師（怎麼用編輯器做新遊戲），請看 `module-authoring.md`。

---

## 1. 系統角色

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Node.js Server                                │
│                                                                      │
│   Express ────┬── /api/rooms       (REST：建房、模組、牌組)           │
│               ├── /api/modules                                       │
│               └── /api/decks                                         │
│                                                                      │
│   Socket.IO ──┬── 'join_host'      (Host 連線)                       │
│               ├── 'join_room'      (Player 連線)                     │
│               ├── 'join_display'   (大螢幕連線)                      │
│               └── …                                                  │
│                                                                      │
│   ┌────────────────────────────────────────────────────────────┐     │
│   │ GameSession (one per room)                                 │     │
│   │   ├── PlayerManager (玩家清單、公開／私人狀態)               │     │
│   │   ├── currentModule: BaseModule | CustomModule              │     │
│   │   ├── sharedState: any (廣播給 display + all)               │     │
│   │   └── 三組 socket id：host / display(set) / players(by id)   │     │
│   └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
        ▲                          ▲                          ▲
        │                          │                          │
   ┌────┴────┐              ┌──────┴──────┐            ┌─────┴──────┐
   │  Host   │              │   Player    │            │   Display  │
   │ /host   │              │  /mobile    │            │  /display  │
   └─────────┘              └─────────────┘            └────────────┘

        + 兩個離線管理 UI （不參與 runtime）：
          /editor   ── 模組設計器（manifest CRUD）
          /decks    ── 全域牌組設計器（DeckManager CRUD）
```

---

## 2. 主要類別

### `GameSession` (`server/core/GameSession.js`)
一個房間 = 一個 GameSession。負責：
- 維護該房間的 `players`、`hostSocketId`、`displaySocketIds`、`sharedState`、目前載入的 `currentModule`
- 玩家的進房／斷線／重連（30 秒寬限，斷線時通知 module）
- 廣播分流：`broadcastAll` (玩家+display+host)、`broadcastDisplay` (僅大螢幕)、`sendToPlayer`、`sendToHost`
- 當收到 host／玩家事件時，轉發給 module：`handlePlayerAction`、`handlePlayerSubmit`、`handleHostNextPhase`

### `PlayerManager` (`server/core/PlayerManager.js`)
玩家清單。每個 `PlayerState` 有：
- 公開欄位：`id`、`name`、`isReady`、`isConnected`、`score`、`handCount`
- 私人欄位：`hand`、`moduleData`（給 module 自由塞，例如 identity card）

`toPublic()` 過濾掉私人資料 — 廣播用；`toPrivate()` 全部資訊 — 只發給該玩家本人。

### `ModuleLoader` (`server/core/ModuleLoader.js`)
- 啟動時掃 `server/modules/*/manifest.json`，建 registry
- `load(moduleName, session, hostConfig)` 流程：
  1. 找到 manifest
  2. 解析 `engine` 欄位 → 決定用哪個目錄的 `server.js`，否則用 `BaseModule`
  3. 解析 `decks[]` 中的 `{ ref }` 引用 → 從 DeckManager 取卡牌資料填入
  4. 把 fieldValues / decks / stages 從 manifest 預設值合進 `config`，host 端可以再 override
  5. `delete require.cache` 後 `require()` 自訂 server.js（每次重載最新代碼）
- `_scanModules()` 每次都先 `clear()` registry，刪掉的模組不會殘留

### `BaseModule` (`server/core/BaseModule.js`)
通用遊戲引擎。內部狀態：
```
playerHands       Map<playerId, Card[]>      私人手牌
playedCards       Map<playerId, Card|null>   本回合出的牌
decks             Map<deckId, Card[]>        洗好的抽牌堆
playerIdentities  Map<playerId, Card>        身份卡
confirmedPlayers  Set<playerId>              已確認身份的玩家
roundNumber, stageIndex, currentStageId
_countdownTimer, _autoAdvanceTimer           timer 管理
```

主要方法：
| 方法 | 何時調用 | 預設行為 |
|------|---------|---------|
| `onStart(players, session)` | `GameSession.startModule` | 重設狀態、洗牌、廣播 `game_started`、進第一個階段 |
| `onPlayerAction(pid, action, data, session)` | 玩家送 `player_action` | 認得 `confirm_identity`、`play_card`，依目前 stage type 處理 |
| `onPlayerSubmit(pid, data, session)` | 玩家送 `player_submit` | 預設 no-op（給 form-style 模組用） |
| `onPlayerDisconnected(pid, session)` | 玩家斷線時 | 重檢推進條件（剩餘玩家是否已全部出牌） |
| `onHostNextPhase(data, session)` | host 按推進按鈕 | 處理 `end_game`、`restart`、`back_to_lobby` 等 action |
| `getGameState()` / `getHostState()` | 廣播時 | 序列化目前狀態給對應 UI |

要做不同玩法，繼承 `BaseModule` 覆寫上述方法就好。

### `DeckManager` (`server/core/DeckManager.js`)
管理 `server/decks/*.json` 的全域牌組（多模組共用）。提供 CRUD、卡牌圖片上傳。
模組要引用全域牌組時，在 manifest 寫 `{ "ref": "<deck-id>" }`。

---

## 3. 完整生命週期（一場遊戲）

```
┌─────────────┐
│ Host 開房    │  POST /api/rooms          → roomId
└──────┬──────┘
       │ socket.emit('join_host', { roomId })
       ▼
┌─────────────┐
│ Lobby 階段   │  各端用 join_room / join_display 加入
└──────┬──────┘
       │ players setReady → host 看到準備人數
       │ host.emit('host_load_module', { roomId, moduleName, config: null })
       ▼
┌─────────────┐
│ ModuleLoader │  load() → 解析 engine + decks → new BaseModule(...)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ startModule │  GameSession 廣播 'game_started'
└──────┬──────┘  await module.onStart() → 進第一個 enabled stage
       │
       ▼ ┌─── 階段循環 (依 manifest.stages 順序) ────┐
         │                                          │
         │  identity_draw                           │
         │   ├─ 抽牌 → 私下發給玩家 ('identity_assigned')│
         │   ├─ 玩家 confirm → confirmedPlayers      │
         │   └─ advance.trigger 滿足 → 進下一階段      │
         │                                          │
         │  card_play  (內含回合迴圈)                  │
         │   ├─ deal hand → 'cards_drawn'           │
         │   ├─ 回合：玩家 play_card                  │
         │   ├─ 全員出牌 → reveal → 'round_result'   │
         │   ├─ roundAdvance → 下一回合               │
         │   └─ maxRounds 達 → advance → 進下一階段    │
         │                                          │
         │  result                                  │
         │   ├─ 算排名、廣播 'game_ended'             │
         │   └─ host 可選 restart / back_to_lobby     │
         └──────────────────────────────────────────┘
```

---

## 4. Socket 事件協議

### Player → Server
| 事件 | payload | 用途 |
|------|---------|------|
| `join_room` | `{ roomId, playerId, playerName }` | 進房（重複 ID 視為重連）|
| `player_ready` | `{ roomId, playerId, isReady }` | toggle 準備狀態 |
| `play_card` | `{ roomId, playerId, cardId, target? }` | 出牌 |
| `player_action` | `{ roomId, playerId, action, data }` | 通用 action（如 `confirm_identity`）|
| `player_submit` | `{ roomId, playerId, data }` | 表單送出（form-style 模組用）|

### Host → Server
| 事件 | payload | 用途 |
|------|---------|------|
| `join_host` | `{ roomId }` | 取得 host 控制權 |
| `host_load_module` | `{ roomId, moduleName, config }` | 啟動遊戲 |
| `host_next_phase` | `{ roomId, data: { action } }` | 推進階段／回合 |
| `host_kick_player` | `{ roomId, playerId }` | 踢人 |

### Display → Server
| 事件 | payload |
|------|---------|
| `join_display` | `{ roomId }` |

### Server → Client
| 事件 | 主要對象 | 內容 |
|------|----------|------|
| `room_joined` | player | 房間摘要 + 自身 player state |
| `host_joined` | host | 房間摘要 + 可用模組列表 |
| `display_joined` | display | 房間摘要 |
| `player_joined` / `player_left` / `player_ready` | all | 玩家清單變動 |
| `player_disconnected` / `player_reconnected` | all | 玩家斷線狀態 |
| `game_started` | all | 模組已載入 |
| `stage_started` | all | 進入新階段（含 stageId、stageType、roundNumber）|
| `phase_changed` | all | 階段內 phase 改變（如 waiting → reveal）|
| `cards_drawn` | player | 私人手牌更新（**全手牌**，client 替換）|
| `card_accepted` | player | 出牌確認 + 更新後手牌 |
| `identity_assigned` | player | 私人身份卡 |
| `identity_progress` | all | `{ confirmed, total }` |
| `round_result` | all | `{ round, reveals[], winnerNames, scores }` |
| `score_update` | player | 個人分數更新 |
| `countdown` | all | `{ key, remaining, total }` 倒數秒數廣播 |
| `state_update` | all + display | sharedState 變動 |
| `host_game_state` | host | 完整 host 視角狀態（玩家進度、可用 action、自動推進狀態）|
| `game_ended` | all | `{ scores, champions, ranked }` |
| `back_to_lobby` | all | 重設 UI 到大廳 |
| `modules_updated` | host | 模組清單變動（編輯器存檔／刪除後）|

---

## 5. 推進條件 (advance trigger)

設計師在 manifest 的 `stages[*].advance` 跟 `stages[*].roundAdvance`（card_play 階段才用）配置：

```jsonc
"advance": {
  "trigger":  "host" | "all_played" | "all_confirmed" | "auto" | "timer",
  "duration": 30,                  // 秒，僅 auto / timer 用
  "fallback": "host"               // 出現此欄位 → host 仍可強制
}
```

| trigger | 行為 | 適用階段 |
|---------|------|----------|
| `host` | host 按按鈕 | 所有 |
| `all_played` | 全員出牌後自動 | card_play 內部 reveal |
| `all_confirmed` | 全員確認身份後自動 | identity_draw |
| `auto` | 固定延遲後自動，**不**廣播 countdown | 任何 |
| `timer` | 固定延遲後自動，**廣播** `countdown` 事件，三端顯示秒數 | 任何 |

實作位置：`BaseModule._scheduleAdvance` / `_maybeAutoAdvanceIdentity`、`_revealRound` 結尾、`_handlePlayCard` 全員出牌時。

`getHostState()` 會回 `advance: { trigger, autoPending, hostCanForce }`，host UI 用這個決定要不要顯示「自動推進中…」 badge 跟按鈕是否 enable。

---

## 6. 配置覆寫鏈

manifest 是 source of truth，但兩個地方可以 override：

```
manifest.json               ← 最底層，磁碟上的設定
    │
    ▼
ModuleLoader._resolveConfig
    │  fieldValues = { ...manifest 預設值, ...host 傳入的 fieldValues }
    │  decks       = host.decks  ?? manifest.decks
    │  stages      = host.stages ?? manifest.stages
    ▼
BaseModule constructor       ← runtime 真正讀的 config
```

目前 host UI 只當作模組 viewer，不會 override（傳 `config: null`）。所有編輯都走 `/editor` 直接寫 manifest.json。當初的「臨時修改本場遊戲」設計能力保留在 protocol 上，留待未來。

---

## 7. 引擎共享機制

衍生模組（編輯器「另存為新模組」產生）在 manifest 加上：

```json
{ "engine": "card-battle" }
```

`ModuleLoader.load()` 解析：

```
manifest.engine = "card-battle"
  └─→ serverPath = server/modules/card-battle/server.js
       │
       ├─ 存在  → 用該檔
       └─ 不存在 → 用 BaseModule
```

這個機制避免「克隆當下複製 server.js」造成 stale code 問題 — 修了 `card-battle` 引擎，所有衍生模組自動繼承。`/api/modules/:id/clone` 端點建新模組時不會複製 server.js，只寫 manifest。

---

## 8. 驗證 (Validation)

`server/index.js` 的 `validateManifest()` 在 PUT / clone manifest 時擋下：

- name、minPlayers、maxPlayers 必填且 1–50
- fieldConfig 每條需有 label、type；select 需有 options
- decks id／cards id 在各自範圍內唯一；啟用中的牌組不可空
- 卡牌名稱不可空
- 至少要有一個 enabled stage
- stage.deckId 必須引用存在且 enabled 的牌組
- advance.trigger 在合法清單內；`auto`/`timer` 必須有 duration

editor client 端有同款驗證（mirror），錯誤即時顯示 banner，存檔按鈕 disable。

---

## 9. 檔案安全寫入

`atomicWriteJSON(filePath, obj)`：寫入 `.tmp` → `rename`。避免寫到一半 crash 留下半損的 manifest。

---

## 10. 已知限制 / 未來方向

| 項目 | 現況 | 目標 |
|------|------|------|
| 勝負規則 | 寫死「最高 value 贏」 | 抽成 `winCondition` DSL |
| 計分規則 | 寫死「贏家 +1」 | 抽成 `scoring` DSL |
| Stage type 擴充 | identity_draw / card_play / result 三種 | 加 `vote`、`input`、`intermission` |
| 多回合間補牌延遲 | 寫死 3 秒 | 設計成 manifest 欄位 |
| 重連時拿不到正在進行的 countdown | 不會看到剩餘秒數 | session 應該記住 active timer 並重送 |
| 模組相依檢查 | 刪除全域牌組時不檢查是否被引用 | 加引用反查表 |

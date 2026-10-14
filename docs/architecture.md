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
| `join_host` | `{ roomId }` | 取得 host 控制權（正式環境需登入 cookie）|
| `host_select_module` | `{ roomId, moduleName }` | 只載入模組快照、留在大廳（labs 頁「載入遊戲」）;廣播 `module_selected` |
| `host_load_module` | `{ roomId, moduleName, config }` | 啟動遊戲；`moduleName` 與房間快照不同時會自動 fork 新模組快照（可換遊戲）|
| `host_change_module` | `{ roomId }` | 更換模組：任何階段強制全員回大廳、丟掉房間模組快照，重開選擇器（保留玩家準備狀態）|
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
| `module_picker_reopen` | host | 更換模組後重開模組選擇器（附最新 `availableModules`）|
| `module_selected` | all | 大廳中選定模組（未啟動）;`{ moduleId, manifest }`,display 顯示「已載入…」|
| `modules_updated` | host | 模組清單變動（編輯器存檔／刪除後）|

**斷線重連（resume）**：手機 playerId 以「房間+名字」為 key 存 localStorage（`getOrCreatePlayerId(roomId, name)`，24h 過期；
同瀏覽器多分頁測試用不同 `?name=` 即為不同玩家）。重整/重開瀏覽器以同 playerId 重連 → `GameSession.reconnectPlayer`
（30s 寬限內）復原私有狀態並由 `BaseModule.onReconnect` 補發手牌/身份；`join_room` 回覆 `room_joined` 帶
`currentStage`/`inCurrentGame`（Node 與 P2P `game-host.js` 同形；P2P 另保留 `room_state` 供舊測試頁）。
遊戲階段中回歸：`onReconnect` 補發 `stage_started`（isReconnect + gameConfig）→ 手機重建遊戲畫面（`room_joined` 只對
「不在本局名單」者顯示觀戰；斷線瞬回且畫面仍掛載時跳過重建）；NetKit 由 `onPlayerJoinedGame` 重生實體（斷線時
`onPlayerDisconnected` 已 despawn）。寬限（30s）過期後回歸：模組開局名單仍在 → `addPlayer` 視同重連補發＋重生。
同名玩家自動編號（小明→小明②，`requestedName` 保重連識別）。
P2P 斷線韌性：WebRTC `connectionState:'disconnected'` 是暫態（背景分頁節流/凍結常見）——p2p.js 給 25s 寬限等自行恢復，
只有 `failed`/`closed` 立即踢；手機端 P2P 斷線後每 4s 自動重連（背景分頁不重試，回前景才連），join 走 resume 同身份接回。
迴歸：`node test-resume-node.js` / `node test-resume-p2p.js` / `node test-resume-p2p-game.js` / `node test-resume-p2p-reconnect.js`。

**保留事件（遊戲 → 框架計分/參數）**：兩條權威來源都在轉發層被攔截寫回框架玩家資料 —
NetKit sim 的 `Sim.emit('score', {pid, add|score})` / `Sim.emit('set_attr', {pid, attrId, value})`（`NetKitHost` bcast 前攔截），
與舊式遊戲 display 端的 `GameAPI.broadcast({t:'score', ...})` / `({t:'set_attr', ...})`（`display_game_broadcast` 轉發前經
`GameSession.applyReservedGameEvent`，Node 與 P2P `game-host.js` 兩路同形）。`score` 寫 `player.score`（result 階段排名依據）、
`set_attr` 走 `setPlayerParam`（驗 manifest `playerAttributes` 宣告，跨階段保留）。手機端 `sendEvent` 不在攔截範圍（防自報分數）。

**玩法物理（`gameConfig.physics:'rapier'`，NetKit sim 專用）**：宣告後框架在「權威端」載入 vendored Rapier 並把
`NetPhys.wrap(RAPIER)`（`client/shared/netphys.js` 薄包裝：world/幾何工廠/ray/contacts，density 質量、collision group 組裝、
step 內建速度封頂等引擎坑全封在包裝裡）以 `PHYS` 注入 sim 作用域（`new Function('Sim','PHYS',code)`）。載入路徑：
Node `NetKitHost` 走 async `import()` 後啟動主執行緒 SimHost；瀏覽器（P2P host）worker 內 dynamic import（載入空窗的
input/join 排隊重放），classic worker 不支援 import 的瀏覽器（Firefox）由 worker 回報 `physfail` → `NetKitHost` 回退主執行緒。
render/手機**永遠不載物理引擎** — 物理遊戲無客戶端預測（mobile/display 跳過本地 sim 建構），純內插快照。
示範模組 `sumo-nk`（相撲推擠）；迴歸 `node test/netkit/test-netphys.js`、`node test/netkit/test-sumo-sim.js`、
E2E `node test-sumo-smoke.js`（需伺服器）。

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

- `gameConfig.files[].code` 會過 `new Function` 做語法檢查 —— **但檔名以 `.pd` 結尾的除外**
  （那是 Pure Data patch、不是 JS）。`.pd` 只檢查「開頭是不是 `#N canvas`」與「不能放 `target:'sim'`」，
  物件支援度與「有沒有真的發出聲音」由 `server/pd-compile.js` 背景編譯時檢查（見 §11）。

editor client 端有同款驗證（mirror），錯誤即時顯示 banner，存檔按鈕 disable。
⚠ 新增驗證規則時**兩邊都要改**（`server/index.js` 的 `validateManifest` 與 `client/editor/index.html` 的 `validateStage`），
否則會出現「伺服器收但編輯器不給存」或反之。

---

## 9. 檔案安全寫入

`atomicWriteJSON(filePath, obj)`：寫入 `.tmp` → `rename`。避免寫到一半 crash 留下半損的 manifest。

---

## 9.5 子路徑部署與登入（zaistudio.tw/labs/game）

正式環境整個 app 掛在 `https://zaistudio.tw/labs/game` 下，由 Caddy 反代（不剝前綴）到 imgame :3000：

- **`BASE_PATH`**（env，如 `/labs/game`）：所有靜態頁面、REST API、socket.io（`path = BASE + '/socket.io'`）都掛在前綴下；本機開發留空 = 掛根路徑，行為不變。客戶端由各頁 inline snippet 從 `location.pathname` 推導 `window.IMGAME_BASE`,`config.js` 再把絕對路徑 `fetch` 自動補前綴（`Config.url()` 給動態載入的腳本/QR/分享連結用）。
- **`PUBLIC_ORIGIN`**（env，如 `https://zaistudio.tw`）:QR code 與分享連結的對外網域。
- **登入**(`server/auth.js`)：驗證主站（zai_studio）簽發的 `zai_session` cookie(HMAC-SHA256，與主站共用 `AUTH_COOKIE_SECRET`，置於 `/root/imgame/.env`)。未登入訪問頁面 → 302 到 `/studio/login?next=…`;API → 401。規則:
  - 需登入：合併主持頁 `BASE + '/'`、`/host` `/editor` `/decks` `/actions` 頁面、`POST /api/rooms`、`GET /api/rooms`、所有 `/api/modules|decks|actions|assets` 的**寫入**、`join_host` 與 `ai_chat` socket 事件。
  - **房間擁有權**:建房時記下 `session.ownerUserId`(cookie 的 userId;loopback/dev 為 `'local'`)。`GET /api/rooms` 只回傳自己開的房;`join_host` 非擁有者 → `error { code: 'ROOM_FORBIDDEN' }`(labs 頁收到會退回大廳）。別人的房只能 `join_room` 當玩家或 `join_display` 旁觀。
  - 免登入：`/mobile`、`/display`、模組/房間資訊 GET、`join_room` / `join_display`（玩家掃碼即玩）。
  - 本機直連 loopback（無 `X-Forwarded-For`）視為內部呼叫放行 — AI playtest / Puppeteer 測試用;Caddy 反代一定帶 XFF,外部直連 :3000 也不是 loopback。
  - 未設 `AUTH_COOKIE_SECRET`（本機 dev)→ 全部放行。
- **合併主持頁**(`client/labs/index.html`，掛在 `BASE + '/'`):display 用 iframe 內嵌於上半部（自己的 socket 走 `join_display`)，下半部是精簡 host 控制列：載入遊戲（模組 modal → `host_select_module`，留在大廳）→ 啟動遊戲（`host_load_module`)→ 遊戲中依 `host_game_state.availableActions` 顯示操作按鈕；分享 modal(QR + 複製手機連結 + 大螢幕 QR 開關）。
- **Caddy**(`/var/snap/caddy/common/Caddyfile`):`redir /labs/game → /labs/game/`、`handle /labs/game/* → :3000`、`handle /uploads/* → :3000`（模組產生的牌面 HTML 內以根路徑引用素材）。
- **systemd**:`/etc/systemd/system/imgame.service.d/labs.conf` 注入 `BASE_PATH` / `PUBLIC_ORIGIN` / `LOGIN_URL` + `EnvironmentFile=/root/imgame/.env`。

---

## 9.6 P2P 的 ICE / TURN 設定

P2P 主持模式(host 瀏覽器當權威、WebRTC DataChannel 直連手機/大螢幕)靠 ICE 建連。ICE 候選有三種路徑,自動依序退避、同一次協商裡並行嘗試:

| 階 | 路徑 | 何時用 | 同區網+client isolation(酒店) |
|---|---|---|---|
| host | 區網 IP 直連 | 一般區網(無隔離)| ✗ 被 L2 擋 |
| srflx | STUN 查到的公網 IP + hairpin 折返 | 跨 NAT | ✗ 同一條路,一樣被擋 |
| relay | TURN 中繼(雙方各自 outbound 到公網中繼)| 直連全失敗 | ✓ 唯一能通 |

**重點:** 同區網沒隔離時靠 **host candidate(區網 IP)直連,STUN 根本用不到**;酒店那種 **client isolation** 會把 host 直連和 STUN hairpin **同時擋掉**,只有 **TURN** 能穿(因為是各自往外連公網中繼,不走被封的 client-to-client 路徑)。

**設定機制(憑證不進 git):**
- 前端 `p2p.js` 的 iceServers 來自 `window.IMGAME_ICE`;`config.js` 一載入就抓 `GET {BASE}/api/ice` 填入(P2P 連線在使用者開房時才建,遠晚於此)。
- 伺服器 `GET /api/ice`(`server/index.js`)依 env 組 iceServers,優先序:**Cloudflare > 本機 coturn > 純 STUN**。沒設 TURN → 只回 STUN(零 regression)。env 見 `.env.example`。

**方案 A(推薦,生產用):Cloudflare Realtime TURN** — 全球 anycast 就近中繼、含 **TURN over TLS 443**(穿透最強)、免費 1TB/月。
1. dash.cloudflare.com → **Realtime(Calls)→ TURN Key** → 取得 **Key ID** + **API Token**(⚠ 不是 Cloudflare **Tunnel**,那是別的產品)。
2. drop-in 設 `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN` → `/api/ice` 伺服器端代取 iceServers(24h 短效憑證,快取 20 分鐘),Token 只留伺服器、client 拿短效憑證。

**方案 B(備援/自架):本機 coturn**（單點中繼,離客戶端遠則慢)。`/api/ice` 在 Cloudflare 取用失敗時退回此。
- 裝 `coturn`,`/etc/turnserver.conf`:`use-auth-secret` + `static-auth-secret=<秘密>` + `external-ip=<公網IPv4>` + `min-port/max-port`(中繼埠範圍)+ `denied-peer-ip`(禁中繼進私網,防 SSRF)。`/etc/default/coturn` 設 `TURNSERVER_ENABLED=1`,`systemctl enable --now coturn`。
- drop-in 設 `TURN_URLS`(逗號分隔,含 `?transport=tcp`)+ `TURN_SECRET`(= static-auth-secret)→ `/api/ice` 用 coturn REST API 演算法產生短效憑證(username=到期時間戳、credential=HMAC-SHA1)。
- **雲端防火牆**要放行 UDP 3478 + 中繼埠範圍(+ TCP 3478 給只擋 UDP 的網路)。機器內部只能驗到「relay 分配成功」;外網可達性要從**行動網路**用 Trickle ICE 測試頁驗(貼 `/api/ice` 內容 → 看有無 `relay` 候選)。

驗證:`iceTransportPolicy:'relay'` 強制只收 relay 候選,有出現即代表 TURN 可用。

---

## 10. NetKit 的輸入通道語意（`Net.input`）

**非物理 NetKit 遊戲會開客戶端預測**（`mobile/game.html` 在 `!cfg.physics` 且有 `sim` 檔時於手機本地建一份 sim），
這時 `Net.input(obj)` **不是把 obj 原封不動送出**，而是拆成兩條語意不同的通道
（`client/shared/netclient.js` 的 `NetSurface.prototype.input`）：

| 欄位 | 語意 |
|---|---|
| `mx` | 連續量。夾到 −1..1、最後一次覆寫，**每個 predict tick 都送**（即使是 0） |
| 其他所有欄位 | 「邊緣」。**只有真值**會黏著到下個 predict tick（保留原值），送出後 `_pendEdges` 清空 |

推論出來的三條規則：

1. **`0` / `false` / `""` 不會上線。** sim 端讀到 `undefined`（`inp[k] ? 1 : 0` 結果與 0 相同，所以
   「下一幀送 0 來解除黏著」仍然有效）。但要傳**可能為 0 的數值**（例如選項索引）必須改成 1 起算。
2. **離散指令最保險的寫法**：按下設 `1`、下一幀歸零，sim 偵測 `0→1` 邊緣後把狀態黏在 1，
   等下一幀的 0（或缺少該欄位）解除。`fairy-brawl-nk` / `teacher-stonks` 都是這個形狀。
3. **物理遊戲不受上述限制** —— 手機不建本地 sim（不載物理引擎）→ `predict` 為 false →
   `Net.input` 走 `_sendInput(obj)` 原封不動送出。`sumo-nk` 因此能傳 `my` 這種非 `mx` 的連續量。

⚠ **2026-10-13 修掉的坑（f51dded）**：這一行原本寫 `this._pendEdges[k] = true`，把值壓成布林。
sim 若用「遞增計數器 + `inp[k] > prev[k]` 差分」當輸入，第一次 `true > 0` 觸發、`prev` 變成 `true`，
之後 `true > true` 永遠為假 → **每個按鈕一輩子只能按一次**。症狀看起來像上行通道阻塞，
但 `_pending` 其實是客戶端預測的未確認輸入緩衝、收到快照帶 `ack` 就會裁掉（卡在個位數是正常的 RTT 緩衝），
而遊戲自報的 `ack` 若是「當下有幾個鍵還黏著」的瞬時總和，也不能用來判斷訊息有沒有送達。
**診斷這類問題最快的方法**：`netcore.js` / `netsim.js` / `netclient.js` 都是 UMD，
直接 `require` 進 Node 接起來跑，點 N 次數「sim 觸發幾次」，還能 A/B 新舊版。

---

## 11. Pure Data 聲音 patch（`shared/*.pd`）

學生在 Pure Data 做好的聲音存成 `.pd`，當成遊戲檔案放進 `gameConfig.files`，伺服器自動編譯成
AudioWorklet 能跑的 wasm，遊戲程式用注入的第三個參數 `PD` 發聲。學生只交 `.pd`，接線由遊戲程式（或 AI）負責。

```json
{ "name": "shared/synth.pd", "target": "display", "code": "<Pd patch 原始文字>" }
```

**契約（反直覺，務必照抄給作者/AI）**：

| patch 裡的物件 | 角色 |
|---|---|
| `[s 名字]` | 遊戲**送訊息進去**的入口。**不用接任何線**（不會被圖最佳化剪掉，已驗證） |
| `[r 名字]` | patch **通知遊戲**的出口 |

`target` 決定從哪個喇叭出來：`display` 大螢幕（教室共用）/ `mobile` 每支手機 / `shared` 兩邊；
**`sim` 會被驗證擋掉**（伺服器端沒有喇叭）。

| 元件 | 位置 | 職責 |
|---|---|---|
| 編譯管線 | `server/pd-compile.js` | 背景編譯（約 6–7 秒），以**內容 hash** 當快取鍵；產物 `server/modules/<id>/pd/<hash>.{wasm,json}`（已 gitignore，隨時可重建） |
| 名稱轉譯層 | `client/shared/webpdkit.js` | WebPd 的執行期 API 吃編譯器指派的不透明 `nodeId`（改 patch 就會變，送到沒宣告的 nodeId 會在 worklet 裡 throw）→ 這層讓遊戲只認名字 |
| WebPd runtime | `client/shared/vendor/webpd-runtime.js` | 98KB，**所有 patch 共用**；沒有 `.pd` 的關卡不會下載 |
| 狀態/產物端點 | `GET /api/modules/:id/pd`、`/api/modules/:id/pd/<hash>.wasm` | 免登入（大螢幕與玩家手機都沒有 cookie） |

**遊戲端 API**：`PD.send(名字, [值])`（不給值 = 送 bang）、`PD.on(名字, cb)`、`PD.names`、`PD.volume(0..1)`、`PD.ready`。
`PD` 可能是 `null`（沒有 `.pd`、或編譯失敗）→ 一律 `if (PD)`，**聲音壞掉不可以讓遊戲掛掉**。
AudioContext 的惰性建立與手勢解鎖、關卡結束的 dispose 都由框架負責，作者不必寫 `onEnd`。

編譯時除了產 wasm 還做兩件對教學有用的事：把 WebPd 的 `not implemented` 換成可行動的中文提示
（含教材第 7 章那幾個不存在的物件名 `delay~`/`reverb~`/`button`/`toggle`/`slider`/`number` 的正名），
以及**在 Node 裡真的跑一遍 patch 量波形**，判斷「送訊息進去到底有沒有發出聲音」。
⚠ 判準是「**所有**入口都不發聲才算壞」—— 控制用入口（設音量/速度）本來就不該發聲，逐個報警會讓人學會忽略警告。

⚠ **`boot()` 回來時 worklet 的引擎還沒建好，而 worklet 不回報就緒** —— 開場第一個 `send` 會在 worklet 內部
throw 然後無聲消失。`webpdkit` 用 400ms 閘門把開場的 send 排隊（桌機實測 20ms 就緒，手機可能慢十倍；
掉一個音效比延後 0.4 秒嚴重得多）。

⚠ WebPd 是 **alpha 且上游低度維護**，授權 **LGPL-3.0**（原封不動 vendor，別編進自己的 bundle）。
真相永遠是 manifest 裡的 `.pd` 原始文字，換引擎不會丟作品。
教材用到但 WebPd 不支援的：`rev1~`/`rev2~`/`rev3~`（殘響，沒有替代物件）、`tabosc4~`、`ezdac~`（改 `dac~`）、`env~`、`threshold~`。
示範模組 `pd-sound-demo`。

---

## 11.5 模組的擁有權與分享（共編）

| 欄位（manifest） | 意義 |
|---|---|
| `createdBy` | 作者的**帳號 id**（`u_…`）。由伺服器在「第一次寫入 manifest.json」時記下，客戶端傳入的值一律被磁碟值覆蓋 |
| `collaborators` | `[{ email, userId }]`。共編名單；`userId` 可能是 `null`（邀了還沒註冊的 email） |
| `published` | superuser 才能切；開放後一般使用者在 `/labs/game` 選得到 |

三層權限（`server/index.js`）：

| 判斷 | 誰 | 能做什麼 |
|---|---|---|
| `modVisible` | 作者、共編者、superuser、或已 `published`、或**無主** | 看到／載入模組 |
| `modEditable` | 同上但不含「已 published 就給過」 | 改 manifest／server.js |
| `canManageShare` | **只有作者與 superuser** | 管理分享名單、**刪除整個模組** |

- **「無主」（沒有 `createdBy`）一律視為可見且可編輯。** 原本把無主當私密，結果是功能上線前就存在的模組
  連作者自己都看不到（實測 19 個模組 0 個有 `createdBy`，13 個因此被鎖死）。沒有記錄作者的模組不屬於任何人。
- **共編者可以改內容，但不能再分享給別人、也不能刪除模組。** 刪除走 `canManageShare` 再擋一層，
  因為 `modEditable` 已經包含共編者了。
- ⚠ **`collaborators` 與 `createdBy` 一樣是伺服器權威、只能經 `/share` 端點修改。**
  PUT manifest 時一律以磁碟值覆蓋 —— 否則任何能存檔的人（包含共編者）只要在 manifest 裡塞一筆
  就把自己或別人加進來，直接繞過 `canManageShare`。

### email → 帳號 id 的解析（`server/zai-users.js`）

imgame 的 session token 只帶 `u=<uid>`，**它從來不知道使用者的 email**（見 §9.5），
但「分享給某人」最自然的輸入就是 email。做法是在「加入的那一刻」查 zai_studio 的使用者名冊
換成帳號 id 存起來，**之後一律用 uid 比對**（對方改 email 不影響權限）。

- 唯讀查 `ZAI_USERS_DB`（預設 `/root/zai_studio-main/data/index.db`）的 `users` 表。
  imgame 本來就共用主站的 `AUTH_COOKIE_SECRET` 與 `LOGIN_URL`，這是同一類耦合再加一條，而且唯讀。
- ⚠ **刻意不用 better-sqlite3**：那是原生模組，這台沒有 `make`/`g++` 編不起來，
  為一個查詢在正式機裝 build-essential 不值得 → 改用系統的 `sqlite3` CLI。
- ⭐ **使用者輸入永遠不進 SQL**：名冊只有幾十筆，所以一次把 `(id, email)` 全撈出來在 JS 比對
  （20 秒快取）。從根本上沒有 SQL 注入面，不必依賴「引號有沒有轉義乾淨」這種容易寫錯的防線。
- 查不到的 email 存成 `userId: null`（UI 標「待註冊」），**每次讀分享清單時重試解析** ——
  學生之後註冊就會自動生效，不需要重新邀請。

**共編者不能再分享，但可以「複製一份當自己的新專案」** —— clone 只需 `modVisible`，
所以共編者複製得動；副本的 `createdBy` = 複製的人，而且 **`published` 與 `collaborators` 都不繼承**
（兩條 clone 路徑都要清：`/api/modules/:sourceId/clone` 與 AI 的 `clone_module`）。
⚠ 不清 `collaborators` 的話，「自己的新專案」會帶著一群沒邀請過的人，
複製者自己還同時是副本的擁有者兼共編者。已實測兩個普通帳號之間真的互相看不到副本
（測這個要避開 superuser —— 它看得到一切，會讓隔離測試變成假陽性）。


端點：`GET/POST/DELETE /api/modules/:id/share`（`POST`/`DELETE` 需 `canManageShare`）。
UI：編輯器的「🤝 分享」分頁（`renderShareTab`）；共編者看得到名單但沒有加入／移除的控制項。

---

## 12. 已知限制 / 未來方向

| 項目 | 現況 | 目標 |
|------|------|------|
| 勝負規則 | 寫死「最高 value 贏」 | 抽成 `winCondition` DSL |
| 計分規則 | 寫死「贏家 +1」 | 抽成 `scoring` DSL |
| Stage type 擴充 | identity_draw / card_play / result 三種 | 加 `vote`、`input`、`intermission` |
| 多回合間補牌延遲 | 寫死 3 秒 | 設計成 manifest 欄位 |
| 重連時拿不到正在進行的 countdown | 不會看到剩餘秒數 | session 應該記住 active timer 並重送 |
| 模組相依檢查 | 刪除全域牌組時不檢查是否被引用 | 加引用反查表 |

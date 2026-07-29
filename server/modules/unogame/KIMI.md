# UNO 模組筆記

## 架構（重要設計決策）
- **大螢幕 = 權威主機**：UNO 是回合制、有私密手牌，BaseModule 的牌組階段做不到，又沒寫自訂 server.js，所以用 game 階段 `layout:"custom"`，由 **display 端持有全部遊戲狀態**（牌庫/各家手牌/輪次/方向），手機只送意圖事件（play/draw/pass/uno/color/hello），display 驗證後 `broadcast` 完整狀態（含所有手牌，手機只渲染自己的）。
- 手機晚加入/重整會收不到狀態 → 雙保險：手機進場送 `hello` 且每 2s 重送直到收到 state；display 每 1s 心跳廣播（uTick 內）。
- 勝利後由主持人手動推進到 result 階段（advance 都是 host）。
- **視覺風格 = 明亮卡通手遊風**（2024 改版）：柔和漸層背景、奶油色面板、毛玻璃座位牌、扇形手牌、動畫+WebAudio 音效。
- **跨局記分**：`U.scores[pid]` 存在 display 端（game 階段內跨局保留），勝利 +1，勝利畫面顯示「🏆 累計勝場」排行榜。

## 分數寫回框架（✅ 已生效，E2E 驗證過）
- 框架在 `display_game_broadcast` 轉發層攔截保留事件（`GameSession.applyReservedGameEvent`，Node 與 P2P 兩路同形）：
  display `GameAPI.broadcast({t:'score',pid,score|add})` → 寫 `player.score`（result 階段排名依據）；
  `{t:'set_attr',pid,attrId,value}` → setPlayerParam（驗 manifest 宣告的 playerAttribute）。
- `uWin` → `uReportScores()` 送這兩種事件（score=累計勝場「絕對值」，冪等）。
- **必須重送，不能只在 uWin 發一次**（2026-07-29 修的掉分 bug）：display socket 瞬斷時（旅館 Wi-Fi 常見），
  斷線中發出的事件會在重連後、`join_display` 重新註冊前抵達伺服器而被 `displaySocketIds` 守衛丟棄 —
  遊戲狀態靠 1s 心跳自癒所以看不出異常，但一次性分數事件永遠消失（症狀：結算少了最後一局）。
  自癒作法：`uTick` 在 phase=over 期間每秒隨心跳 `uReportScores()`（絕對值冪等），`uRestart` 開新局時再補送一次。
- **只有 display 端有效**：手機 sendEvent 不被攔截（防玩家自報分數），舊的手機 self-write 已移除。
- manifest 宣告 playerAttribute `score`（整數 0-999，resetOnStart）供 set_attr 合法寫入（跨階段可讀，非排名依據）。
- 注意：manifest 的 uno_game 階段 name 與 result 階段是 2026 重建的（原版名稱可能略有差異，純外觀）。

## 再來一局（✅ 2026 新增）
- `uWin` 排程 `U.rematchAt = now + 10s`；`uTick` 在 over 且到時後 `uRestart()`：
  重建座位（**納入中途加入的玩家**）、保留 `U.scores`/names、上局贏家先手、`U.round++`、重新發牌。
  人數 <2 時每 5 秒重試。`uRestart` 必清 `U.unoWindow`（上局殘留窗口會在新局誤罰）。
- 廣播 state 新欄位：`round`、`rematchLeftMs`（over 時的倒數，其他時候 null）；兩端勝利畫面顯示倒數。
- 主持人隨時可推進到 result 結束整場（依累計 player.score 排名）。

## 檔案結構（uno_game 階段，多檔案）
- `shared/cards.js`：108 張標準牌庫、洗牌、`unoCanPlay`（含 wild4 限制）、**卡通牌繪製**（陰影浮起、漸層橢圓、圓角加大）、動畫工具（UAnim ease 函數、UFlyingCard 飛牌）、WebAudio 音效（USound）。
- `display/logic.js`：狀態機 `U`（phase: playing/colorPick/drawn/drawwait/over）、出牌/抽牌/選色/UNO 窗口/超時處理、`uBroadcast`、**動畫事件鉤子 `uFx(type, data)`**、**記分 `U.scores` + 寫回框架 `uReportScores()`**。
- `display/render.js`：大螢幕 1920×1080 **明亮卡通風**（座位牌含勝場徽章、飛牌動畫、大字效果快閃、顏色切換光暈、勝利彩帶、**勝利畫面顯示累計勝場榜**）。
- `mobile/ui.js`：手機 720×1280 **手遊風**（扇形手牌、膠囊按鈕、圓形選色盤、UNO 脈動警告、頂部顯示我的勝場、勝利畫面累計勝場榜、**over 時 self-write 分數回框架**）。

## 規則實作（採用標準規則，民間玩法未做）
- 抽二/抽四**不可疊加**；wild4 只能在手無同顏色牌時出（伺服端強制，未做「質疑」機制）。
- 兩人局反轉 = 跳過（steps=2）。
- 抽牌後只能出「抽到的那張」或跳過（phase drawn）；抽到不能出 → 亮 1.5s 後自動換人（drawwait）。
- UNO：剩 1 張時若未事先按 UNO!，有 3 秒窗口（unoWindow），超時罰抽 2 張；可提前按（unoArmed）。
- 起始牌重翻到數字牌為止；牌庫抽空時棄牌堆（留頂牌）洗回。
- 每回合 45 秒（fieldConfig turnSeconds 可調 10-120），超時自動抽 1 張換人。
- fieldConfig: handSize 起始手牌（預設 7）。
- **記分：勝利 +1 分，跨局累積，勝利畫面顯示排行榜。**

## 已知限制 / TODO
- 手牌經 broadcast 全量發給所有手機（技術上可偷看原始訊息，派對情境可接受）。
- 中途加入的玩家本局觀戰（顯示「本局已開始」），**下一局自動入座**（uRestart 重建座位）；中途離線靠回合超時自動推進。
- run_playtest 機器人不會跑 display gameCode，驗證靠 run_visual_test（規則邏輯另有 node 假 GameAPI 單元測試法：組 shared+logic 兩檔、假 performance.now，可直接驅動 uPlay/uTick）。
- 視覺測試有 404 錯誤（資源缺失），不影響遊戲運作，待查。

## 音效說明
- USound 用 WebAudio 合成（無外部檔案）：card（出牌 600Hz）、draw（抽牌 300Hz）、uno（雙音 800→1000Hz）、win（四音階 C-E-G-C）、error（錯誤 200Hz）。
- 手機端需 user gesture 才能 init AudioContext（第一次 pointerdown 時 init）。

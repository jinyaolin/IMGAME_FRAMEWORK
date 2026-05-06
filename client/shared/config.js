// ── Config ────────────────────────────────────────────────────────────────
const Config = {
  get lang() { return localStorage.getItem('cfg_lang') || 'zh'; },
  set lang(v) { localStorage.setItem('cfg_lang', v); },
  get ip()   { return localStorage.getItem('cfg_ip') || ''; },
  set ip(v)  { v ? localStorage.setItem('cfg_ip', v) : localStorage.removeItem('cfg_ip'); },

  mobileUrl(roomId) {
    const port = location.port ? ':' + location.port : '';
    const base = this.ip ? `http://${this.ip}${port}` : location.origin;
    return `${base}/mobile?room=${roomId}`;
  },
  qrSrc(roomId) {
    return this.ip
      ? `/api/rooms/${roomId}/qr?host=${encodeURIComponent(this.ip)}`
      : `/api/rooms/${roomId}/qr`;
  }
};

// ── Translations ──────────────────────────────────────────────────────────
const TRANSLATIONS = {
  zh: {
    // Config UI
    'cfg.title':          '⚙️ 設定',
    'cfg.ip.label':       '本機 IP 位址',
    'cfg.ip.placeholder': '例：192.168.1.100',
    'cfg.ip.hint':        '留空則使用 localhost（手機掃 QR 時需填真實 IP）',
    'cfg.lang.label':     '語言',
    'cfg.save':           '儲存',
    'cfg.cancel':         '取消',

    // Stage types
    'stage.identity_draw': '身份抽取',
    'stage.card_play':     '出牌回合',
    'stage.vote':          '投票',
    'stage.game':         '🎮 遊戲',
    'stage.intermission':  '暫停',
    'stage.loop':          '🔁 循環',
    'stage.result':        '結算',

    // Advance triggers (short form for dropdowns)
    'trigger.host':           '🎮 Host 手動推進',
    'trigger.all_confirmed':  '✅ 全員確認後自動',
    'trigger.identity_timer': '⏱️ 全員確認後倒數',
    'trigger.auto_next':      '⏭️ 翻牌後立即進下一階段',
    'trigger.round_timer':    '⏱️ 翻牌後倒數進下一階段',
    'trigger.host_reveal':    '🎮 Host 手動翻牌',
    'trigger.all_played':     '🃏 全員出牌後立即翻牌',
    'trigger.play_timer':     '⏱️ 全員出牌後倒數翻牌',
    'trigger.auto_restart':   '🔄 立即重啟遊戲',
    'trigger.restart_timer':  '🔄 倒數後重啟遊戲',
    'trigger.all_submitted':  '📝 全員提交後自動',
    'trigger.auto':           '⏭️ 立即自動推進',
    'trigger.timer':          '⏱️ 倒數後自動推進',
    'trigger.vote_ended':     '🗳️ 投票結束後自動',

    // Editor tabs & sections
    'tab.basic':    '基本參數',
    'tab.decks':    '牌組',
    'tab.stages':   '階段',
    'tab.advanced': '進階',

    // Editor field labels
    'field.name':        '名稱',
    'field.description': '說明',
    'field.min_players': '最少玩家',
    'field.max_players': '最多玩家',
    'field.version':     '版本',
    'field.stage_name':  '階段名稱',
    'field.stage_type':  '類型',
    'field.enabled':     '啟用',

    // Editor misc
    'editor.search_placeholder': '🔍 搜尋模組…',

    // Editor buttons
    'btn.save':        '儲存',
    'btn.new_module':  '➕ 新增模組',
    'btn.add_stage':   '+ 新增階段',
    'btn.delete':      '刪除',
    'btn.duplicate':   '複製',
    'btn.export':      '匯出 JSON',
    'btn.import':      '匯入 JSON',

    // Editor advance block labels
    'advance.label':          '推進條件',
    'advance.duration':       '倒數秒數',
    'advance.fallback':       '保留 Host 強制推進按鈕',
    'advance.reveal_label':   '翻牌條件',
    'advance.next_rnd_label': '進下一回合條件',

    // Display
    'display.paused':       '遊戲暫停中',
    'display.game_over':    '遊戲結束',
    'display.connecting':   '連線中…',
    'display.reconnecting': '連線中斷，重新連線…',
    'display.players':      '玩家',

    // Host — header
    'host.title':             '🎮 HOST 控制台',
    'host.editor_link':       '📝 模組編輯器',
    'host.qr_btn':            '📱 玩家加入 QR',
    'host.qr_hide_btn':       '📱 隱藏 QR',
    'host.room_badge':        '房間',
    'host.connected':         'Host 已連線',

    // Host — setup screen
    'host.room_section':      '🎮 遊戲房間',
    'host.room_desc':         '選擇現有房間或建立新遊戲房間',
    'host.existing_rooms':    '現有房間',
    'host.create_section':    '建立新房間 — 選擇遊戲模組',
    'host.loading':           '載入中…',
    'host.no_rooms':          '沒有現有房間',
    'host.load_failed':       '載入失敗',
    'host.create_room_btn':   '➕ 建立新房間',
    'host.refresh':           '🔄 重新整理',
    'host.waiting_module':    '等待選擇模組',

    // Host — lobby
    'host.players':           '玩家',
    'host.waiting_players':   '等待玩家加入…',
    'host.sort_join':         '登入順序',
    'host.sort_name_asc':     '名字 A → Z',
    'host.sort_name_desc':    '名字 Z → A',
    'host.sort_manual':       '手動排列（可拖曳）',
    'host.module_select':     '選擇遊戲模組',
    'host.module_selected':   '遊戲模組',
    'host.md_basic':          '基本參數',
    'host.md_decks':          '牌組',
    'host.md_stages':         '啟用階段',
    'host.md_editor_link':    '→ 在編輯器中開啟',
    'host.start_game':        '啟動遊戲模組',
    'host.close_room':        '關閉房間',

    // Host — game panel
    'host.round':             '回合',
    'host.player_status':     '玩家狀態',
    'host.this_round':        '本回合出牌',
    'host.auto_advancing':    '⏱ 自動推進中…',

    // Host — result panel
    'host.game_over':         '遊戲結束',
    'host.restart':           '重新開始（同模組）',
    'host.end_room':          '結束房間',

    // Host — vote panel
    'host.vote_stage':        '🗳️ 投票階段',
    'host.voting':            '投票中',
    'host.vote_progress':     '投票進度',
    'host.vote_live':         '即時票數',
    'host.waiting_vote':      '等待投票…',

    // Host — event log
    'host.events':            '事件記錄',
    'host.log.player_ready':  '玩家準備完成',
    'host.log.player_disconnected': '玩家斷線',
    'host.log.player_reconnected': '玩家重連',

    // Host — action buttons
    'host.action.advance_identity': '▶ 全員確認，開始發牌',
    'host.action.force_reveal':     '⚡ 強制翻牌',
    'host.action.next_round':       '▶ 下一回合',
    'host.action.next_stage':       '▶ 下一階段',
    'host.action.end_game':         '✕ 結束遊戲',
    'host.action.restart':          '↺ 重新開始',
    'host.action.back_to_lobby':    '← 返回 Lobby',
    'host.action.end_vote':         '▶ 結束投票',

    // Host — player status labels (full)
    'status.waiting':     '⏳ 等待準備',
    'status.ready':       '✓ 已準備',
    'status.viewing':     '👁️ 查看中',
    'status.confirmed':   '✓ 已確認',
    'status.thinking':    '🤔 思考中',
    'status.played':      '✓ 已出牌',
    'status.voting':      '🗳️ 投票中',
    'status.voted':       '✓ 已投票',
    'status.completed':   '✓ 已完成',
    'status.eliminated':  '❌ 已淘汰',
    'status.disconnected':'🔴 已斷線',
    'status.unknown':     '未知',

    // Host — compact player status
    'pstatus.disconnected': '斷線',
    'pstatus.confirmed':    '已確認',
    'pstatus.viewing':      '查看中',
    'pstatus.played':       '已出牌',
    'pstatus.waiting':      '等待中',

    // Host — advance badge trigger labels
    'adv.all_played':    '全員出牌後自動推進',
    'adv.all_confirmed': '全員確認後自動推進',
    'adv.all_ready':     '全員準備後自動推進',
    'adv.auto':          '固定延遲後自動推進',
    'adv.timer':         '倒數結束後自動推進',
    'adv.host_force':    '（host 仍可強制）',

    // Host — sort labels map
    'sort.join':      '登入順序',
    'sort.name_asc':  '名字 A→Z',
    'sort.name_desc': '名字 Z→A',
    'sort.manual':    '手動排列',

    // Host — deck/stage type labels
    'deck_type.role':   '身份',
    'deck_type.action': '行動',
    'deck_type.event':  '事件',
    'deck_type.item':   '道具',
    'stage_type.identity_draw': '身份抽取',
    'stage_type.card_play':     '出牌回合',
    'stage_type.vote':          '投票',
    'stage_type.reveal':        '翻牌',
    'stage_type.result':        '結算',
    'stage_type.game':         '遊戲',
    'stage_type.intermission':  '暫停',
    'stage_type.loop':          '循環',

    // Host — score/results
    'score.cards':         '張',
    'score.round_winner':  '本回合勝者：',
    'score.champion':      '勝者：',

    // Host — alerts & confirms
    'alert.room_not_found':   '房間不存在',
    'alert.join_failed':      '無法加入房間',
    'alert.no_room':          '請先建立房間',
    'alert.close_room':       '確定要關閉房間嗎？所有玩家將被踢出。',
    'alert.rename_player':    '修改玩家名稱',
    'alert.empty_name':       '名稱不能為空',
    'alert.kick_confirm':     '確定踢除玩家「{name}」？',
    'alert.min_players':      '至少需要 {n} 人準備（目前 {now} 人）',
    'alert.max_players':      '最多 {n} 人（目前 {now} 人）',

    // Editor — header & static
    'editor.title':           '📝 模組編輯器',
    'editor.host_link':       '→ Host 控制台',
    'editor.empty_state':     '從左側選擇一個模組開始編輯',
    'editor.validation_err':  '⚠ 需修正才能儲存',
    'editor.save_btn':        '💾 儲存（覆寫原檔）',
    'editor.save_as_btn':     '📦 另存為新模組…',
    'editor.discard_btn':     '↺ 放棄修改',
    'editor.delete_btn':      '🗑 刪除模組',
    'editor.display_name':    '顯示名稱',
    'editor.description':     '說明',
    'editor.min_players':     '最少人數',
    'editor.max_players':     '最多人數',
    'editor.version':         '版本',
    'editor.no_params':       '這個模組沒有可調參數。',
    'editor.no_modules':      '沒有可用模組',
    'editor.no_match':        '沒有符合的模組',
    'editor.players_range':   '人',
    'editor.version_prefix':  'v',

    // Editor — deck section
    'editor.deck_type_label':    '全局牌組',
    'editor.deck_select_global': '— 請選擇全局牌組 —',
    'editor.deck_id_label':      '牌組 ID（stage 引用用）',
    'editor.deck_name_label':    '顯示名稱',
    'editor.deck_draw_label':    '預設抽牌數',
    'editor.deck_dup_label':     '允許重複',
    'editor.deck_delete':        '刪除牌組',
    'editor.deck_add':           '+ 新增牌組',
    'editor.deck_unnamed':       '未命名',
    'editor.deck_not_selected':  '⚠ 未選擇',
    'editor.deck_select_cards':  '🃏 選擇卡牌',
    'editor.deck_select_all':    '全選',
    'editor.deck_deselect_all':  '清除',
    'editor.deck_no_cards':      '此牌組沒有卡牌',
    'editor.deck_no_selection':  '尚未選擇任何卡牌（將使用完整牌組）',
    'editor.deck_no_global':     '請從上方選擇一個全局牌組',
    'editor.deck_value_prefix':  '點數:',
    'editor.deck_team_prefix':   '陣營:',
    'editor.deck_count_suffix':  '張',
    'editor.deck_card_count':    '{count} 張卡牌',
    'editor.deck_selected':      '已選 {count} 張',
    'editor.deck_selection_summary': '已選 {types} 種卡牌，共 {total} 張',
    'editor.deck_card_count_label': '張數',

    // Editor — stage section
    'editor.stage_no_children':  '尚無子階段',
    'editor.stage_add_child':    '+ 新增子階段',
    'editor.child_stages_title': '📋 子階段（每次循環依序執行）',

    // Editor — loop section
    'loop.alive_players': '存活玩家數',
    'loop.team_players':  '特定陣營玩家數',
    'loop.iterations':    '已執行次數',

    // Editor — confirms & alerts
    'confirm.unsaved':      '有未儲存的修改，確定要捨棄並切換？',
    'confirm.reload':       '放棄所有未儲存的修改，重新從伺服器載入？',
    'confirm.delete_deck':  '確定要刪除「{name}」這個牌組嗎？\n（會同時影響引用此牌組的階段）',

    // Host
    'host.create_room':   '建立房間',
    'host.next_phase':    '下一步 →',
    'host.end_game':      '結束遊戲',
    'host.select_module': '選擇模組',
    'host.room_code':     '房間代碼',
    'host.kick':          '踢除',
    'host.ready':         '準備',
    'host.waiting':       '等待',

    // Mobile
    'mobile.waiting':          '等待遊戲…',
    'mobile.ready':            '我準備好了',
    'mobile.ready_done':       '✓ 已準備',
    'mobile.confirm_identity': '確認身份',
    'mobile.identity_label':   '你的身份',
    'mobile.waiting_identity': '等待身份分配...',
    'mobile.vote_title':       '🗳️ 投票階段',
    'mobile.vote_waiting':     '等待投票…',
    'mobile.vote_cast':        '✓ 已投票',
    'mobile.vote_submit':      '送出投票',
    'mobile.eliminated_title': '你已被淘汰',
    'mobile.eliminated_sub':   '遊戲繼續進行中，你可以繼續觀看。',
    'mobile.eliminated_watch': '觀戰模式',
    'mobile.waiting_game':     '⏳ 遊戲進行中，請等待下一輪…',

    // Decks — general
    'decks.title':             '🃏 卡牌管理器',
    'decks.subtitle':          '管理所有遊戲模組共享的卡牌',
    'decks.loading':           '載入中…',
    'decks.empty':             '還沒有卡牌組',
    'decks.empty_hint':        '點擊「新增卡牌組」開始建立',
    'decks.add_deck':          '+ 新增卡牌組',

    // Deck types
    'decks.type.action':       '行動牌',
    'decks.type.role':         '角色牌',
    'decks.type.item':         '物品牌',
    'decks.type.event':        '事件牌',

    // Deck form
    'decks.form.id_label':     '卡牌組 ID',
    'decks.form.id_hint':      '只能使用小寫字母、數字、底線和連字號',
    'decks.form.id_placeholder': '例如: basic-actions',
    'decks.form.name_label':   '名稱',
    'decks.form.name_placeholder': '例如: 基礎行動牌',
    'decks.form.type_label':   '類型',
    'decks.form.desc_label':   '描述',
    'decks.form.desc_placeholder': '卡牌組的用途說明…',
    'decks.form.save':         '儲存',
    'decks.form.cancel':       '取消',

    // Deck cards
    'decks.cards.title':       '卡牌列表',
    'decks.cards.empty':       '這個卡牌組還沒有任何卡牌',
    'decks.cards.add_first':   '+ 新增第一張卡牌',
    'decks.cards.add':         '+ 新增卡牌',
    'decks.cards.count':       '張卡牌',
    'decks.cards.updated':     '更新於',

    // Deck actions
    'decks.action.edit':       '✏️ 編輯',
    'decks.action.view':       '👁️ 查看',
    'decks.action.delete':     '🗑️ 刪除',
    'decks.action.edit_cards': '✏️ 編輯卡牌組',

    // Card form
    'decks.card.add_title':    '新增卡牌',
    'decks.card.edit_title':   '編輯卡牌',
    'decks.card.id_label':     '卡牌 ID',
    'decks.card.id_placeholder': '例如: fire-punch',
    'decks.card.name_label':   '名稱',
    'decks.card.name_placeholder': '例如: 火焰拳',
    'decks.card.desc_label':   '說明',
    'decks.card.desc_placeholder': '卡牌效果描述…',
    'decks.card.image_label':  '卡牌圖片',
    'decks.card.image_upload': '📷 點擊上傳圖片',
    'decks.card.image_hint':   '支援 JPG、PNG、GIF、WebP (最大 5MB)',

    // Card specific fields
    'decks.card.team_label':   '陣營',
    'decks.card.team_none':    '無',
    'decks.card.value_label':  '點數',
    'decks.card.value_placeholder': '例如: 9',

    // Teams
    'decks.team.red':          '紅色',
    'decks.team.blue':         '藍色',
    'decks.team.green':        '綠色',
    'decks.team.yellow':       '黃色',
    'decks.team.purple':       '紫色',
    'decks.team.gold':         '金色',

    // Deck details
    'decks.view.title':        '卡牌組詳情',
    'decks.view.edit_title':   '卡牌編輯',
    'decks.view.stats_type':   '類型',
    'decks.view.stats_updated': '更新於',

    // Deck editor
    'decks.editor.name_label': '卡牌組名稱',
    'decks.editor.desc_label': '描述',
    'decks.editor.back_image': '卡牌背面圖片',
    'decks.editor.back_change': '更換背面圖片',
    'decks.editor.back_upload': '上傳背面圖片',
    'decks.editor.back_remove': '移除',
    'decks.editor.back_hint':  '建議尺寸：80x112px，最大 5MB',
    'decks.editor.no_back':    '無背面圖片',

    // Toast messages
    'decks.toast.uploading':   '上傳中…',
    'decks.toast.upload_success': '背面圖片已上傳',
    'decks.toast.upload_fail': '上傳失敗',
    'decks.toast.remove_success': '背面圖片已移除',
    'decks.toast.remove_fail': '移除失敗',
    'decks.toast.name_updated': '名稱已更新',
    'decks.toast.desc_updated': '描述已更新',
    'decks.toast.create_success': '建立成功！',
    'decks.toast.update_success': '更新成功！',
    'decks.toast.delete_success': '刪除成功！',
    'decks.toast.save_fail':    '儲存失敗',
    'decks.toast.card_saved':   '卡牌已新增！',
    'decks.toast.card_updated': '卡牌已更新！',
    'decks.toast.card_deleted': '卡牌已刪除',
    'decks.toast.card_image_success': '圖片上傳成功！',
    'decks.toast.card_image_partial': '卡牌已儲存，但圖片上傳失敗：',

    // Confirm dialogs
    'decks.confirm.delete_deck': '確定要刪除這個卡牌組嗎？此操作無法復原。',
    'decks.confirm.delete_card': '確定要刪除這張卡牌嗎？',
    'decks.confirm.remove_back_image': '確定要移除卡牌背面圖片嗎？',

    // Errors
    'decks.error.load_fail':    '載入失敗：',
    'decks.error.too_large':    '圖片大小不能超過 5MB',
    'decks.error.invalid_file': '請上傳圖片文件',
    'decks.error.operation_fail': '操作失敗：',

    // Mobile Join (mobile/index.html)
    'mobile.join.title':         '🎮 進入遊戲',
    'mobile.join.subtitle':      '輸入房間代碼和你的名稱',
    'mobile.join.room_label':    '房間代碼',
    'mobile.join.name_label':    '玩家名稱',
    'mobile.join.room_ph':       'XXXXXX',
    'mobile.join.name_ph':       '你的名字',
    'mobile.join.btn':           '加入遊戲',
    'mobile.join.error_room':    '請輸入正確的房間代碼',
    'mobile.join.error_name':    '請輸入名稱',
  },
  en: {
    // Config UI
    'cfg.title':          '⚙️ Settings',
    'cfg.ip.label':       'Local IP Address',
    'cfg.ip.placeholder': 'e.g. 192.168.1.100',
    'cfg.ip.hint':        'Leave empty for localhost (required for mobile QR scanning)',
    'cfg.lang.label':     'Language',
    'cfg.save':           'Save',
    'cfg.cancel':         'Cancel',

    // Stage types
    'stage.identity_draw': 'Identity Draw',
    'stage.card_play':     'Card Play',
    'stage.vote':          'Vote',
    'stage.game':         '🎮 Game',
    'stage.intermission':  'Intermission',
    'stage.loop':          '🔁 Loop',
    'stage.result':        'Result',

    // Advance triggers
    'trigger.host':           '🎮 Host manual',
    'trigger.all_confirmed':  '✅ Auto when all confirmed',
    'trigger.identity_timer': '⏱️ Countdown after all confirmed',
    'trigger.auto_next':      '⏭️ Auto advance after reveal',
    'trigger.round_timer':    '⏱️ Countdown after reveal',
    'trigger.host_reveal':    '🎮 Host manual reveal',
    'trigger.all_played':     '🃏 Auto reveal when all played',
    'trigger.play_timer':     '⏱️ Countdown after all played',
    'trigger.auto_restart':   '🔄 Restart immediately',
    'trigger.restart_timer':  '🔄 Restart after countdown',
    'trigger.all_submitted':  '📝 Auto when all submitted',
    'trigger.auto':           '⏭️ Auto advance instantly',
    'trigger.timer':          '⏱️ Auto after countdown',
    'trigger.vote_ended':     '🗳️ Auto when vote ends',

    // Editor tabs & sections
    'tab.basic':    'Basic',
    'tab.decks':    'Decks',
    'tab.stages':   'Stages',
    'tab.advanced': 'Advanced',

    // Editor field labels
    'field.name':        'Name',
    'field.description': 'Description',
    'field.min_players': 'Min Players',
    'field.max_players': 'Max Players',
    'field.version':     'Version',
    'field.stage_name':  'Stage Name',
    'field.stage_type':  'Type',
    'field.enabled':     'Enabled',

    // Editor misc
    'editor.search_placeholder': '🔍 Search modules…',

    // Editor buttons
    'btn.save':        'Save',
    'btn.new_module':  '➕ New Module',
    'btn.add_stage':   '+ Add Stage',
    'btn.delete':      'Delete',
    'btn.duplicate':   'Duplicate',
    'btn.export':      'Export JSON',
    'btn.import':      'Import JSON',

    // Editor advance block labels
    'advance.label':          'Advance Condition',
    'advance.duration':       'Duration (sec)',
    'advance.fallback':       'Keep host override button',
    'advance.reveal_label':   'Reveal Condition',
    'advance.next_rnd_label': 'Next Round Condition',

    // Display
    'display.paused':       'Game Paused',
    'display.game_over':    'Game Over',
    'display.connecting':   'Connecting…',
    'display.reconnecting': 'Connection lost, reconnecting…',
    'display.players':      'Players',

    // Host — header
    'host.title':             '🎮 HOST Console',
    'host.editor_link':       '📝 Module Editor',
    'host.qr_btn':            '📱 Player Join QR',
    'host.qr_hide_btn':       '📱 Hide QR',
    'host.room_badge':        'Room',
    'host.connected':         'Host connected',

    // Host — setup screen
    'host.room_section':      '🎮 Game Room',
    'host.room_desc':         'Select an existing room or create a new one',
    'host.existing_rooms':    'Existing Rooms',
    'host.create_section':    'Create Room — Select Module',
    'host.loading':           'Loading…',
    'host.no_rooms':          'No existing rooms',
    'host.load_failed':       'Load failed',
    'host.create_room_btn':   '➕ Create Room',
    'host.refresh':           '🔄 Refresh',
    'host.waiting_module':    'Waiting for module',

    // Host — lobby
    'host.players':           'Players',
    'host.waiting_players':   'Waiting for players…',
    'host.sort_join':         'Join Order',
    'host.sort_name_asc':     'Name A → Z',
    'host.sort_name_desc':    'Name Z → A',
    'host.sort_manual':       'Manual (drag to reorder)',
    'host.module_select':     'Select Game Module',
    'host.module_selected':   'Game Module',
    'host.md_basic':          'Basic',
    'host.md_decks':          'Decks',
    'host.md_stages':         'Active Stages',
    'host.md_editor_link':    '→ Open in Editor',
    'host.start_game':        'Start Game',
    'host.close_room':        'Close Room',

    // Host — game panel
    'host.round':             'Round',
    'host.player_status':     'Player Status',
    'host.this_round':        'This Round Plays',
    'host.auto_advancing':    '⏱ Auto-advancing…',

    // Host — result panel
    'host.game_over':         'Game Over',
    'host.restart':           'Restart (same module)',
    'host.end_room':          'End Room',

    // Host — vote panel
    'host.vote_stage':        '🗳️ Vote',
    'host.voting':            'Voting',
    'host.vote_progress':     'Vote Progress',
    'host.vote_live':         'Live Votes',
    'host.waiting_vote':      'Waiting for votes…',

    // Host — event log
    'host.events':            'Event Log',
    'host.log.player_ready':  'Player ready',
    'host.log.player_disconnected': 'Player disconnected',
    'host.log.player_reconnected': 'Player reconnected',

    // Host — action buttons
    'host.action.advance_identity': '▶ Confirm All, Deal Cards',
    'host.action.force_reveal':     '⚡ Force Reveal',
    'host.action.next_round':       '▶ Next Round',
    'host.action.next_stage':       '▶ Next Stage',
    'host.action.end_game':         '✕ End Game',
    'host.action.restart':          '↺ Restart',
    'host.action.back_to_lobby':    '← Back to Lobby',
    'host.action.end_vote':         '▶ End Vote',

    // Host — player status labels (full)
    'status.waiting':     '⏳ Waiting',
    'status.ready':       '✓ Ready',
    'status.viewing':     '👁️ Viewing',
    'status.confirmed':   '✓ Confirmed',
    'status.thinking':    '🤔 Thinking',
    'status.played':      '✓ Played',
    'status.voting':      '🗳️ Voting',
    'status.voted':       '✓ Voted',
    'status.completed':   '✓ Done',
    'status.eliminated':  '❌ Eliminated',
    'status.disconnected':'🔴 Disconnected',
    'status.unknown':     'Unknown',

    // Host — compact player status
    'pstatus.disconnected': 'Disconnected',
    'pstatus.confirmed':    'Confirmed',
    'pstatus.viewing':      'Viewing',
    'pstatus.played':       'Played',
    'pstatus.waiting':      'Waiting',

    // Host — advance badge trigger labels
    'adv.all_played':    'Auto-advance when all played',
    'adv.all_confirmed': 'Auto-advance when all confirmed',
    'adv.all_ready':     'Auto-advance when all ready',
    'adv.auto':          'Auto-advance after delay',
    'adv.timer':         'Auto-advance after countdown',
    'adv.host_force':    '(host override enabled)',

    // Host — sort labels map
    'sort.join':      'Join Order',
    'sort.name_asc':  'Name A→Z',
    'sort.name_desc': 'Name Z→A',
    'sort.manual':    'Manual',

    // Host — deck/stage type labels
    'deck_type.role':   'Role',
    'deck_type.action': 'Action',
    'deck_type.event':  'Event',
    'deck_type.item':   'Item',
    'stage_type.identity_draw': 'Identity Draw',
    'stage_type.card_play':     'Card Play',
    'stage_type.vote':          'Vote',
    'stage_type.reveal':        'Reveal',
    'stage_type.result':        'Result',
    'stage_type.game':         'Game',
    'stage_type.intermission':  'Intermission',
    'stage_type.loop':          'Loop',

    // Host — score/results
    'score.cards':         'card(s)',
    'score.round_winner':  'Round winner: ',
    'score.champion':      'Winner: ',

    // Host — alerts & confirms
    'alert.room_not_found':   'Room not found',
    'alert.join_failed':      'Failed to join room',
    'alert.no_room':          'Please create a room first',
    'alert.close_room':       'Close this room? All players will be kicked.',
    'alert.rename_player':    'Rename player',
    'alert.empty_name':       'Name cannot be empty',
    'alert.kick_confirm':     'Kick player "{name}"?',
    'alert.min_players':      'Need at least {n} ready players (currently {now})',
    'alert.max_players':      'Maximum {n} players (currently {now})',

    // Editor — header & static
    'editor.title':           '📝 Module Editor',
    'editor.host_link':       '→ Host Console',
    'editor.empty_state':     'Select a module on the left to start editing',
    'editor.validation_err':  '⚠ Fix errors before saving',
    'editor.save_btn':        '💾 Save (overwrite)',
    'editor.save_as_btn':     '📦 Save as New…',
    'editor.discard_btn':     '↺ Discard Changes',
    'editor.delete_btn':      '🗑 Delete Module',
    'editor.display_name':    'Display Name',
    'editor.description':     'Description',
    'editor.min_players':     'Min Players',
    'editor.max_players':     'Max Players',
    'editor.version':         'Version',
    'editor.no_params':       'This module has no configurable parameters.',
    'editor.no_modules':      'No modules available',
    'editor.no_match':        'No matching modules',
    'editor.players_range':   'players',
    'editor.version_prefix':  'v',

    // Editor — deck section
    'editor.deck_type_label':    'Global Deck',
    'editor.deck_select_global': '— Select global deck —',
    'editor.deck_id_label':      'Deck ID (used by stages)',
    'editor.deck_name_label':    'Display Name',
    'editor.deck_draw_label':    'Default Draw Count',
    'editor.deck_dup_label':     'Allow Duplicates',
    'editor.deck_delete':        'Delete Deck',
    'editor.deck_add':           '+ Add Deck',
    'editor.deck_unnamed':       'Unnamed',
    'editor.deck_not_selected':  '⚠ Not selected',
    'editor.deck_select_cards':  '🃏 Select Cards',
    'editor.deck_select_all':    'Select All',
    'editor.deck_deselect_all':  'Clear',
    'editor.deck_no_cards':      'This deck has no cards',
    'editor.deck_no_selection':  'No cards selected (full deck will be used)',
    'editor.deck_no_global':     'Please select a global deck above',
    'editor.deck_value_prefix':  'Value:',
    'editor.deck_team_prefix':   'Team:',
    'editor.deck_count_suffix':  'card(s)',
    'editor.deck_card_count':    '{count} card(s)',
    'editor.deck_selected':      '{count} selected',
    'editor.deck_selection_summary': '{types} card types selected, {total} cards total',
    'editor.deck_card_count_label': 'Count',

    // Editor — stage section
    'editor.stage_no_children':  'No child stages yet',
    'editor.stage_add_child':    '+ Add Child Stage',
    'editor.child_stages_title': '📋 Child Stages (run in order each loop)',

    // Editor — loop section
    'loop.alive_players': 'Alive Players',
    'loop.team_players':  'Team Players',
    'loop.iterations':    'Iteration Count',

    // Editor — confirms & alerts
    'confirm.unsaved':      'Unsaved changes — discard and switch?',
    'confirm.reload':       'Discard all unsaved changes and reload from server?',
    'confirm.delete_deck':  'Delete deck "{name}"?\n(Stages referencing this deck will be affected)',

    // Host (legacy keys kept for compatibility)
    'host.create_room':   'Create Room',
    'host.next_phase':    'Next →',
    'host.end_game':      'End Game',
    'host.select_module': 'Select Module',
    'host.room_code':     'Room Code',
    'host.kick':          'Kick',
    'host.ready':         'Ready',
    'host.waiting':       'Waiting',

    // Mobile
    'mobile.waiting':          'Waiting for game…',
    'mobile.ready':            "I'm Ready",
    'mobile.ready_done':       '✓ Ready',
    'mobile.confirm_identity': 'Confirm Identity',
    'mobile.identity_label':   'Your Identity',
    'mobile.waiting_identity': 'Waiting for identity…',
    'mobile.vote_title':       '🗳️ Vote',
    'mobile.vote_waiting':     'Waiting…',
    'mobile.vote_cast':        '✓ Voted',
    'mobile.vote_submit':      'Submit Vote',
    'mobile.eliminated_title': 'You have been eliminated',
    'mobile.eliminated_sub':   'The game continues. You can keep watching.',
    'mobile.eliminated_watch': 'Spectator Mode',
    'mobile.waiting_game':     '⏳ Game in progress — please wait for the next round…',

    // Decks — general
    'decks.title':             '🃏 Card Manager',
    'decks.subtitle':          'Manage shared cards for all game modules',
    'decks.loading':           'Loading…',
    'decks.empty':             'No decks yet',
    'decks.empty_hint':        'Click "Add Deck" to create your first deck',
    'decks.add_deck':          '+ Add Deck',

    // Deck types
    'decks.type.action':       'Action Card',
    'decks.type.role':         'Role Card',
    'decks.type.item':         'Item Card',
    'decks.type.event':        'Event Card',

    // Deck form
    'decks.form.id_label':     'Deck ID',
    'decks.form.id_hint':      'Only lowercase letters, numbers, underscores and hyphens',
    'decks.form.id_placeholder': 'e.g. basic-actions',
    'decks.form.name_label':   'Name',
    'decks.form.name_placeholder': 'e.g. Basic Actions',
    'decks.form.type_label':   'Type',
    'decks.form.desc_label':   'Description',
    'decks.form.desc_placeholder': 'Deck usage description…',
    'decks.form.save':         'Save',
    'decks.form.cancel':       'Cancel',

    // Deck cards
    'decks.cards.title':       'Cards',
    'decks.cards.empty':       'This deck has no cards yet',
    'decks.cards.add_first':   '+ Add First Card',
    'decks.cards.add':         '+ Add Card',
    'decks.cards.count':       'card(s)',
    'decks.cards.updated':     'Updated',

    // Deck actions
    'decks.action.edit':       '✏️ Edit',
    'decks.action.view':       '👁️ View',
    'decks.action.delete':     '🗑️ Delete',
    'decks.action.edit_cards': '✏️ Edit Deck',

    // Card form
    'decks.card.add_title':    'Add Card',
    'decks.card.edit_title':   'Edit Card',
    'decks.card.id_label':     'Card ID',
    'decks.card.id_placeholder': 'e.g. fire-punch',
    'decks.card.name_label':   'Name',
    'decks.card.name_placeholder': 'e.g. Fire Punch',
    'decks.card.desc_label':   'Description',
    'decks.card.desc_placeholder': 'Card effect description…',
    'decks.card.image_label':  'Card Image',
    'decks.card.image_upload': '📷 Click to upload image',
    'decks.card.image_hint':   'Supports JPG, PNG, GIF, WebP (max 5MB)',

    // Card specific fields
    'decks.card.team_label':   'Team',
    'decks.card.team_none':    'None',
    'decks.card.value_label':  'Value',
    'decks.card.value_placeholder': 'e.g. 9',

    // Teams
    'decks.team.red':          'Red',
    'decks.team.blue':         'Blue',
    'decks.team.green':        'Green',
    'decks.team.yellow':       'Yellow',
    'decks.team.purple':       'Purple',
    'decks.team.gold':         'Gold',

    // Deck details
    'decks.view.title':        'Deck Details',
    'decks.view.edit_title':   'Card Editor',
    'decks.view.stats_type':   'Type',
    'decks.view.stats_updated': 'Updated',

    // Deck editor
    'decks.editor.name_label': 'Deck Name',
    'decks.editor.desc_label': 'Description',
    'decks.editor.back_image': 'Card Back Image',
    'decks.editor.back_change': 'Change Back Image',
    'decks.editor.back_upload': 'Upload Back Image',
    'decks.editor.back_remove': 'Remove',
    'decks.editor.back_hint':  'Recommended size: 80x112px, max 5MB',
    'decks.editor.no_back':    'No back image',

    // Toast messages
    'decks.toast.uploading':   'Uploading…',
    'decks.toast.upload_success': 'Back image uploaded',
    'decks.toast.upload_fail': 'Upload failed',
    'decks.toast.remove_success': 'Back image removed',
    'decks.toast.remove_fail': 'Remove failed',
    'decks.toast.name_updated': 'Name updated',
    'decks.toast.desc_updated': 'Description updated',
    'decks.toast.create_success': 'Created successfully!',
    'decks.toast.update_success': 'Updated successfully!',
    'decks.toast.delete_success': 'Deleted successfully!',
    'decks.toast.save_fail':    'Save failed',
    'decks.toast.card_saved':   'Card added!',
    'decks.toast.card_updated': 'Card updated!',
    'decks.toast.card_deleted': 'Card deleted',
    'decks.toast.card_image_success': 'Image uploaded successfully!',
    'decks.toast.card_image_partial': 'Card saved, but image upload failed: ',

    // Confirm dialogs
    'decks.confirm.delete_deck': 'Are you sure you want to delete this deck? This cannot be undone.',
    'decks.confirm.delete_card': 'Are you sure you want to delete this card?',
    'decks.confirm.remove_back_image': 'Are you sure you want to remove the card back image?',

    // Errors
    'decks.error.load_fail':    'Load failed: ',
    'decks.error.too_large':    'Image size cannot exceed 5MB',
    'decks.error.invalid_file': 'Please upload an image file',
    'decks.error.operation_fail': 'Operation failed: ',

    // Mobile Join (mobile/index.html)
    'mobile.join.title':         '🎮 Join Game',
    'mobile.join.subtitle':      'Enter room code and your name',
    'mobile.join.room_label':    'Room Code',
    'mobile.join.name_label':    'Player Name',
    'mobile.join.room_ph':       'XXXXXX',
    'mobile.join.name_ph':       'Your name',
    'mobile.join.btn':           'Join Game',
    'mobile.join.error_room':    'Please enter a valid room code',
    'mobile.join.error_name':    'Please enter your name',
  }
};

function t(key, params = {}) {
  let text = TRANSLATIONS[Config.lang]?.[key] ?? TRANSLATIONS.zh[key] ?? key;
  // Replace parameters like {n}, {now}, {name}
  Object.keys(params).forEach(param => {
    text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
  });
  return text;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}

// ── Config UI (injected into every page) ─────────────────────────────────
let _cfgPendingLang = null;

function _initCfgUI() {
  const style = document.createElement('style');
  style.textContent = `
    #appcfg-btn {
      position: fixed; top: 10px; right: 14px; z-index: 9000;
      background: rgba(20,20,50,.85); border: 1px solid #3a3a7a;
      color: #8888cc; border-radius: 8px; padding: 5px 10px;
      font-size: .85rem; cursor: pointer; backdrop-filter: blur(4px);
      transition: color .15s, border-color .15s;
    }
    #appcfg-btn:hover { color: #aaaaff; border-color: #6666cc; }
    #appcfg-overlay {
      position: fixed; inset: 0; z-index: 9001;
      background: rgba(0,0,20,.7); display: flex;
      align-items: center; justify-content: center;
    }
    #appcfg-overlay.hidden { display: none; }
    #appcfg-modal {
      background: #12122a; border: 1px solid #3a3a7a;
      border-radius: 14px; padding: 28px 32px; width: 360px;
      max-width: 92vw; display: flex; flex-direction: column; gap: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,.6);
    }
    #appcfg-modal h3 { margin: 0; font-size: 1rem; color: #aaaaff; }
    .appcfg-field { display: flex; flex-direction: column; gap: 5px; }
    .appcfg-field label { font-size: .78rem; color: #7777aa; }
    .appcfg-field input {
      background: #0a0a1a; border: 1px solid #3a3a6a; border-radius: 7px;
      color: #ddddf0; padding: 7px 10px; font-size: .88rem; outline: none;
    }
    .appcfg-field input:focus { border-color: #5555ff; }
    .appcfg-hint { font-size: .7rem; color: #5555aa; }
    .appcfg-lang-row { display: flex; gap: 8px; }
    .appcfg-lang-btn {
      flex: 1; padding: 8px; border-radius: 8px;
      background: #1a1a3a; border: 1px solid #3a3a6a;
      color: #8888cc; font-size: .85rem; cursor: pointer;
      transition: all .15s;
    }
    .appcfg-lang-btn.active {
      background: #2a2a6a; border-color: #6666ff; color: #aaaaff; font-weight: 700;
    }
    .appcfg-actions { display: flex; gap: 8px; margin-top: 4px; }
    .appcfg-actions button {
      flex: 1; padding: 9px; border-radius: 8px; font-size: .88rem;
      cursor: pointer; border: 1px solid #3a3a6a;
    }
    .appcfg-actions .appcfg-save { background: #2a2a7a; color: #aaaaff; border-color: #5555cc; }
    .appcfg-actions .appcfg-save:hover { background: #3a3a9a; }
    .appcfg-actions .appcfg-cancel { background: #1a1a3a; color: #7777aa; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.innerHTML = `
    <button id="appcfg-btn" onclick="_openCfg()">⚙️</button>
    <div id="appcfg-overlay" class="hidden" onclick="_closeCfg()">
      <div id="appcfg-modal" onclick="event.stopPropagation()">
        <h3 data-i18n="cfg.title">⚙️ 設定</h3>
        <div class="appcfg-field">
          <label data-i18n="cfg.ip.label">本機 IP 位址</label>
          <input id="appcfg-ip" type="text" data-i18n-ph="cfg.ip.placeholder" placeholder="例：192.168.1.100">
          <div class="appcfg-hint" data-i18n="cfg.ip.hint">留空則使用 localhost</div>
        </div>
        <div class="appcfg-field">
          <label data-i18n="cfg.lang.label">語言</label>
          <div class="appcfg-lang-row">
            <button class="appcfg-lang-btn" data-lang="zh" onclick="_setCfgLang('zh')">中文</button>
            <button class="appcfg-lang-btn" data-lang="en" onclick="_setCfgLang('en')">English</button>
          </div>
        </div>
        <div class="appcfg-actions">
          <button class="appcfg-save"   onclick="_saveCfg()"  data-i18n="cfg.save">儲存</button>
          <button class="appcfg-cancel" onclick="_closeCfg()" data-i18n="cfg.cancel">取消</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  document.getElementById('appcfg-ip').value = Config.ip;
  _updateCfgLangBtns(Config.lang);
  applyTranslations();
}

function _openCfg() {
  _cfgPendingLang = Config.lang;
  document.getElementById('appcfg-ip').value = Config.ip;
  _updateCfgLangBtns(_cfgPendingLang);
  document.getElementById('appcfg-overlay').classList.remove('hidden');
}

function _closeCfg() {
  _cfgPendingLang = null;
  document.getElementById('appcfg-overlay').classList.add('hidden');
}

function _setCfgLang(lang) {
  _cfgPendingLang = lang;
  _updateCfgLangBtns(lang);
}

function _updateCfgLangBtns(lang) {
  document.querySelectorAll('.appcfg-lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

function _saveCfg() {
  const newIp   = document.getElementById('appcfg-ip').value.trim();
  const newLang = _cfgPendingLang || Config.lang;
  const langChanged = newLang !== Config.lang;
  const ipChanged   = newIp   !== Config.ip;

  Config.ip   = newIp;
  Config.lang = newLang;
  _closeCfg();

  if (langChanged) {
    applyTranslations();
    if (typeof onLangChange === 'function') onLangChange();
    else location.reload();
  }
  if (ipChanged && typeof onIpChange === 'function') onIpChange();
}

// Pages that want the gear button call Config.initUI() explicitly
Config.initUI = function() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initCfgUI);
  } else {
    _initCfgUI();
  }
};

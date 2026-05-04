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
    'stage.input':         '🎮 控制器',
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
    'display.players':      '玩家',

    // Host
    'host.create_room':   '建立房間',
    'host.start_game':    '開始遊戲',
    'host.next_phase':    '下一步 →',
    'host.end_game':      '結束遊戲',
    'host.select_module': '選擇模組',
    'host.room_code':     '房間代碼',
    'host.players':       '玩家',
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
    'stage.input':         '🎮 Controller',
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
    'display.players':      'Players',

    // Host
    'host.create_room':   'Create Room',
    'host.start_game':    'Start Game',
    'host.next_phase':    'Next →',
    'host.end_game':      'End Game',
    'host.select_module': 'Select Module',
    'host.room_code':     'Room Code',
    'host.players':       'Players',
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
  }
};

function t(key) {
  return TRANSLATIONS[Config.lang]?.[key] ?? TRANSLATIONS.zh[key] ?? key;
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

document.addEventListener('DOMContentLoaded', _initCfgUI);

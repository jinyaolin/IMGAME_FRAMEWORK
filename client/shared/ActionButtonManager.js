/**
 * ActionButtonManager - 統一的 Action Button 管理系統
 *
 * 這是一個統一的架構，用於管理各種遊戲階段的 action buttons，
 * 包括投票、卡牌出牌、身份確認、遊戲控制等。
 *
 * 核心概念：
 * - 統一的 Action Config 格式
 * - 標準化的 Button State Machine
 * - 一致的 UI 顯示模式
 * - 向後兼容現有 manifest 格式
 */

// ═══════════════════════════════════════════════════════════
//   CONSTANTS & ENUMS
// ═══════════════════════════════════════════════════════════

// 標準 Action Types
const ACTION_TYPES = {
  PRIMARY: {
    id: 'primary',
    label: '確認',
    style: 'primary',
    position: 'bottom'
  },
  SECONDARY: {
    id: 'secondary',
    label: '取消',
    style: 'secondary',
    position: 'bottom'
  },
  DANGER: {
    id: 'danger',
    label: '淘汰',
    style: 'danger',
    position: 'bottom'
  },
  CANCEL: {
    id: 'cancel',
    label: '取消',
    style: 'secondary',
    position: 'bottom'
  }
};

// 標準 UI Modes
const UI_MODES = {
  OVERLAY: 'overlay',         // 全螢幕覆蓋（投票、身份確認）
  INLINE: 'inline',           // 內嵌在 action bar（卡牌出牌）
  CONTROLLER: 'controller',   // 遊戲控制器（按鈕陣列）
  NONE: 'none'                // 無 UI（中場休息）
};

// 標準 Button States
const BUTTON_STATES = {
  IDLE: 'idle',               // 等待用戶操作
  READY: 'ready',             // 可以執行動作
  SUBMITTING: 'submitting',   // 提交中
  SUBMITTED: 'submitted',     // 已提交
  SUCCESS: 'success',         // 成功完成
  ERROR: 'error',             // 錯誤狀態
  DISABLED: 'disabled',       // 禁用狀態
  HIDDEN: 'hidden'            // 隱藏
};

// ═══════════════════════════════════════════════════════════
//   DEFAULT STAGE CONFIGURATIONS (向後兼容)
// ═══════════════════════════════════════════════════════════

const DEFAULT_STAGE_CONFIGS = {
  vote: {
    uiMode: UI_MODES.OVERLAY,
    selection: {
      source: 'players',
      multiSelect: false,
      minSelect: 1,
      maxSelect: 1
    },
    actions: [
      {
        id: 'submit_vote',
        type: 'primary',
        label: '送出投票',
        position: 'bottom',
        behavior: {
          action: 'cast_vote',
          requireSelection: true,
          serverEvent: 'player_action'
        },
        states: {
          idle: { text: '請選擇投票對象', disabled: true },
          ready: { text: '送出投票', disabled: false },
          submitting: { text: '送出中…', disabled: true },
          submitted: { text: '已送出 ✓', disabled: true }
        }
      }
    ]
  },

  card_play: {
    uiMode: UI_MODES.INLINE,
    selection: {
      source: 'cards',
      multiSelect: false,
      minSelect: 1,
      maxSelect: 1
    },
    actions: [
      {
        id: 'play_card',
        type: 'primary',
        label: '出牌',
        position: 'inline',
        behavior: {
          action: 'play_card',
          requireSelection: true,
          serverEvent: 'play_card'
        },
        states: {
          idle: { text: '請選擇一張牌', disabled: true },
          ready: { text: '出牌', disabled: false },
          submitting: { text: '出牌中…', disabled: true },
          submitted: { text: '已出牌', disabled: true }
        }
      }
    ]
  },

  identity_draw: {
    uiMode: UI_MODES.OVERLAY,
    selection: {
      source: 'none',
      multiSelect: false
    },
    actions: [
      {
        id: 'confirm_identity',
        type: 'primary',
        label: '確認身份',
        position: 'bottom',
        behavior: {
          action: 'confirm_identity',
          requireSelection: false,
          serverEvent: 'player_action'
        },
        states: {
          idle: { text: '確認身份', disabled: false },
          submitting: { text: '確認中…', disabled: true },
          submitted: { text: '已確認 ✓', disabled: true }
        }
      }
    ]
  },

  game: {
    uiMode: UI_MODES.CONTROLLER,
    controllerLayout: 'pad-4',
    selection: {
      source: 'none',
      multiSelect: false
    },
    actions: [
      {
        id: 'btn1',
        type: 'primary',
        label: 'A',
        position: 'controller',
        behavior: {
          action: 'game',
          serverEvent: 'player_action'
        },
        states: {
          idle: { text: 'A', disabled: false }
        }
      },
      {
        id: 'btn2',
        type: 'secondary',
        label: 'B',
        position: 'controller',
        behavior: {
          action: 'game',
          serverEvent: 'player_action'
        },
        states: {
          idle: { text: 'B', disabled: false }
        }
      }
    ]
  },

  intermission: {
    uiMode: UI_MODES.NONE,
    selection: {
      source: 'none',
      multiSelect: false
    },
    actions: []
  },

  result: {
    uiMode: UI_MODES.OVERLAY,
    selection: {
      source: 'none',
      multiSelect: false
    },
    actions: [
      {
        id: 'leave_room',
        type: 'secondary',
        label: '離開房間',
        position: 'bottom',
        behavior: {
          action: 'leave_room',
          requireSelection: false,
          serverEvent: 'leave_room'
        },
        states: {
          idle: { text: '離開房間', disabled: false }
        }
      }
    ]
  }
};

// ═══════════════════════════════════════════════════════════
//   ACTION BUTTON MANAGER CLASS
// ═══════════════════════════════════════════════════════════

class ActionButtonManager {
  constructor() {
    this.currentConfig = null;
    this.currentStageType = null;
    this.actions = new Map();           // actionId -> action config
    this.currentStates = new Map();     // actionId -> current state
    this.selection = new Set();         // 目前選擇的項目
    this.uiMode = UI_MODES.NONE;
    this.countdownTimer = null;
    this.countdownRemaining = 0;
    this.client = null;                 // Socket client reference

    console.log('[ActionButtonManager] Initialized');
  }

  // ═══════════════════════════════════════════════════════════
  //   初始化與設置
  // ═══════════════════════════════════════════════════════════

  setClient(client) {
    this.client = client;
  }

  setupStage(stageData) {
    console.log('[ActionButtonManager] Setting up stage:', stageData.stageId, 'type:', stageData.stageType);

    this.clearCurrentStage();

    this.currentStageType = stageData.stageType;

    // 檢查是否有新的 actionConfig 格式
    if (stageData.actionConfig) {
      console.log('[ActionButtonManager] Using new actionConfig format');
      this.currentConfig = stageData.actionConfig;
      this.uiMode = this.currentConfig.uiMode || UI_MODES.OVERLAY;

      // 註冊所有 actions
      if (this.currentConfig.actions) {
        this.currentConfig.actions.forEach(action => {
          this.registerAction(action);
        });
      }
    } else {
      // 使用向後兼容的默認配置
      console.log('[ActionButtonManager] Using default config for stage type:', stageData.stageType);
      this.setupDefaultConfig(stageData.stageType, stageData);
    }

    this.renderUI();
  }

  setupDefaultConfig(stageType, stageData) {
    const defaults = DEFAULT_STAGE_CONFIGS[stageType];
    if (!defaults) {
      console.warn('[ActionButtonManager] No default config for stage type:', stageType);
      this.currentConfig = { uiMode: UI_MODES.NONE, actions: [] };
      this.uiMode = UI_MODES.NONE;
      return;
    }

    // 深拷貝默認配置
    this.currentConfig = JSON.parse(JSON.stringify(defaults));
    this.uiMode = this.currentConfig.uiMode;

    // 對於特殊情況，合併額外的 stageData
    if (stageType === 'game' && stageData.gameConfig) {
      this.currentConfig.controllerLayout = stageData.gameConfig.layout || 'pad-4';
      if (stageData.gameConfig.buttonLabels) {
        this.currentConfig.actions.forEach(action => {
          if (stageData.gameConfig.buttonLabels[action.id]) {
            action.label = stageData.gameConfig.buttonLabels[action.id];
            action.states.idle.text = stageData.gameConfig.buttonLabels[action.id];
          }
        });
      }
    }

    // 對於投票階段，合併 voteConfig
    if (stageType === 'vote' && stageData.voteConfig) {
      this.currentConfig.voteConfig = stageData.voteConfig;
      this.currentConfig.voteOptions = stageData.options;
      this.currentConfig.eligibleVoters = stageData.eligibleVoters;
    }

    // 註冊所有 actions
    if (this.currentConfig.actions) {
      this.currentConfig.actions.forEach(action => {
        this.registerAction(action);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //   Action 註冊與管理
  // ═══════════════════════════════════════════════════════════

  registerAction(actionConfig) {
    const actionId = actionConfig.id;
    console.log('[ActionButtonManager] Registering action:', actionId);

    this.actions.set(actionId, {
      ...actionConfig,
      currentState: 'idle',
      element: null
    });

    this.currentStates.set(actionId, 'idle');
  }

  getAction(actionId) {
    return this.actions.get(actionId);
  }

  // ═══════════════════════════════════════════════════════════
  //   狀態管理
  // ═══════════════════════════════════════════════════════════

  updateActionState(actionId, newState, data = {}) {
    console.log(`[ActionButtonManager] Updating ${actionId} to ${newState}:`, data);

    const action = this.actions.get(actionId);
    if (!action) {
      console.warn(`[ActionButtonManager] Unknown action: ${actionId}`);
      return;
    }

    const stateConfig = action.states[newState];
    if (!stateConfig) {
      console.warn(`[ActionButtonManager] Unknown state: ${newState} for action: ${actionId}`);
      return;
    }

    // 更新狀態
    action.currentState = newState;
    this.currentStates.set(actionId, newState);

    // 更新 UI
    this.updateActionUI(actionId, stateConfig, data);

    // 觸發條件檢查
    this.checkConditions(actionId, newState);
  }

  // ═══════════════════════════════════════════════════════════
  //   選擇管理
  // ═══════════════════════════════════════════════════════════

  onSelectionChanged(selectedItems) {
    console.log('[ActionButtonManager] Selection changed:', selectedItems);

    this.selection.clear();
    if (Array.isArray(selectedItems)) {
      selectedItems.forEach(item => this.selection.add(item));
    } else if (selectedItems) {
      this.selection.add(selectedItems);
    }

    // 更新依賴選擇的 actions
    this.actions.forEach((action, actionId) => {
      if (action.behavior?.requireSelection) {
        const isValid = this.validateSelection(actionId);
        const newState = isValid ? 'ready' : 'idle';

        this.updateActionState(actionId, newState, {
          selectedCount: this.selection.size,
          selectedItems: Array.from(this.selection)
        });
      }
    });
  }

  validateSelection(actionId) {
    const action = this.actions.get(actionId);
    const config = this.currentConfig?.selection;

    if (!config) return this.selection.size > 0;

    const count = this.selection.size;

    if (config.minSelect !== undefined && count < config.minSelect) {
      return false;
    }

    if (config.maxSelect !== undefined && count > config.maxSelect) {
      return false;
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════
  //   Action 執行
  // ═══════════════════════════════════════════════════════════

  async executeAction(actionId) {
    const action = this.actions.get(actionId);
    const currentState = this.currentStates.get(actionId);

    console.log(`[ActionButtonManager] Executing ${actionId}, current state: ${currentState}`);

    if (currentState === 'submitting' || currentState === 'submitted') {
      console.log('[ActionButtonManager] Action already submitted, ignoring');
      return;
    }

    // 更新為 submitting 狀態
    this.updateActionState(actionId, 'submitting');

    try {
      // 執行對應的動作
      const result = await this.performAction(action);

      // 成功 - 更新為 submitted 狀態
      this.updateActionState(actionId, 'submitted', { result });

      // 通知外部（向後兼容）
      if (this.onActionPerformed) {
        this.onActionPerformed(actionId, result);
      }

    } catch (error) {
      console.error('[ActionButtonManager] Action execution failed:', error);
      this.updateActionState(actionId, 'error', { error: error.message });
    }
  }

  async performAction(action) {
    if (!this.client) {
      throw new Error('No client set');
    }

    const serverEvent = action.behavior?.serverEvent || 'player_action';
    const actionType = action.behavior?.action || action.id;

    // 準備發送到伺服器的資料
    let payload = {
      action: actionType,
      actionId: action.id,
      timestamp: Date.now()
    };

    // 根據不同的 action type 準備不同的 payload
    if (actionType === 'cast_vote') {
      payload.targetId = Array.from(this.selection)[0];
      payload.voteId = this.currentConfig.voteConfig?.voteId;
    } else if (actionType === 'play_card') {
      payload.cardInstanceId = Array.from(this.selection)[0];
    } else if (actionType === 'game') {
      // 遊戲控制器輸入在 controller 按鈕按下時直接發送
      return { success: true };
    } else {
      payload.selection = Array.from(this.selection);
    }

    console.log('[ActionButtonManager] Sending action to server:', serverEvent, payload);

    // 透過 client 發送到伺服器
    return new Promise((resolve, reject) => {
      this.client.socket.emit(serverEvent, payload, (response) => {
        if (response?.success !== false) {
          resolve(response || { success: true });
        } else {
          reject(new Error(response?.error || 'Action failed'));
        }
      });

      // 設置超時
      setTimeout(() => {
        reject(new Error('Action timeout'));
      }, 10000);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //   UI 渲染與更新
  // ═══════════════════════════════════════════════════════════

  renderUI() {
    console.log('[ActionButtonManager] Rendering UI, mode:', this.uiMode);

    // 隱藏所有 UI 模式
    this.hideAllUIModes();

    switch (this.uiMode) {
      case UI_MODES.OVERLAY:
        this.renderOverlayUI();
        break;
      case UI_MODES.INLINE:
        this.renderInlineUI();
        break;
      case UI_MODES.CONTROLLER:
        this.renderControllerUI();
        break;
      case UI_MODES.NONE:
        // 不渲染任何 UI
        break;
    }
  }

  hideAllUIModes() {
    // 隱藏所有可能的 UI 容器
    const overlay = document.getElementById('actionOverlay');
    if (overlay) overlay.classList.add('hidden');

    const actionbar = document.getElementById('actionbar');
    if (actionbar) actionbar.style.display = 'none';

    const controllerZone = document.getElementById('controllerZone');
    if (controllerZone) controllerZone.classList.remove('active');

    // 隱藏舊的 UI 元素（向後兼容）
    const oldVoteOverlay = document.getElementById('voteOverlay');
    if (oldVoteOverlay) oldVoteOverlay.classList.add('hidden');

    const oldIdentityOverlay = document.getElementById('identityOverlay');
    if (oldIdentityOverlay) oldIdentityOverlay.classList.remove('show');
  }

  renderOverlayUI() {
    const overlay = document.getElementById('actionOverlay');
    if (!overlay) {
      console.error('[ActionButtonManager] actionOverlay element not found');
      return;
    }

    overlay.classList.remove('hidden');

    // 渲染標題和描述
    this.renderHeader(overlay);

    // 渲染選項區域
    this.renderOptions(overlay);

    // 渲染 action buttons
    this.renderActionButtons(overlay);
  }

  renderHeader(container) {
    const titleEl = container.querySelector('#actionTitle');
    const descEl = container.querySelector('#actionDescription');

    if (titleEl) {
      // 對於投票階段，使用 voteTitle
      if (this.currentStageType === 'vote' && this.currentConfig.voteConfig?.voteTitle) {
        titleEl.textContent = this.currentConfig.voteConfig.voteTitle;
      } else {
        titleEl.textContent = '請確認';
      }
    }

    if (descEl) {
      // 對於投票階段，使用 voteDescription
      if (this.currentStageType === 'vote' && this.currentConfig.voteConfig?.voteDescription) {
        descEl.textContent = this.currentConfig.voteConfig.voteDescription;
      } else {
        descEl.textContent = '請選擇選項並確認';
      }
    }
  }

  renderOptions(container) {
    const optionsContainer = container.querySelector('#actionOptions');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    // 如果是投票階段，渲染投票選項
    if (this.currentStageType === 'vote' && this.currentConfig.voteOptions) {
      this.currentConfig.voteOptions.forEach(option => {
        const optionEl = this.createOptionElement(option);
        optionsContainer.appendChild(optionEl);
      });
    }
    // 如果是卡牌階段，不在此處渲染（使用既有的 card zone）
    // 如果是身份確認階段，不在此處渲染（使用既有的 identity system）
  }

  createOptionElement(option) {
    const div = document.createElement('div');
    div.className = 'action-option';
    div.dataset.optionId = option.id;
    div.onclick = () => this.selectOption(option.id, div);

    if (option.type === 'player') {
      div.innerHTML = `
        <div class="action-option-icon">👤</div>
        <div class="action-option-name">${option.name}</div>
      `;
    } else {
      div.innerHTML = `
        ${option.icon ? `<div class="action-option-icon">${option.icon}</div>` : ''}
        <div class="action-option-name">${option.name}</div>
        ${option.type ? `<div class="action-option-type">${option.type}</div>` : ''}
      `;
    }

    return div;
  }

  selectOption(optionId, element) {
    const actionId = 'submit_vote';
    const action = this.actions.get(actionId);
    const currentState = this.currentStates.get(actionId);

    if (currentState === 'submitted' || currentState === 'submitting') {
      return; // 已提交，不能更改
    }

    // 清除之前的選擇
    document.querySelectorAll('.action-option').forEach(el => {
      el.classList.remove('selected');
      el.dataset.selected = 'false';
    });

    // 設置新選擇
    element.classList.add('selected');
    element.dataset.selected = 'true';

    // 通知選擇變更
    this.onSelectionChanged(optionId);
  }

  renderActionButtons(container) {
    const buttonsContainer = container.querySelector('#actionButtons');
    if (!buttonsContainer) return;

    buttonsContainer.innerHTML = '';

    // 過濾出應該在底部顯示的 actions
    const bottomActions = Array.from(this.actions.values())
      .filter(action => action.position === 'bottom' || !action.position);

    bottomActions.forEach(action => {
      const button = this.createActionButton(action);
      buttonsContainer.appendChild(button);
      action.element = button;
    });
  }

  renderInlineUI() {
    const actionbar = document.getElementById('actionbar');
    if (!actionbar) return;

    actionbar.style.display = 'flex';
    actionbar.innerHTML = '';

    // 只渲染 inline 位置的 buttons
    const inlineActions = Array.from(this.actions.values())
      .filter(action => action.position === 'inline');

    if (inlineActions.length === 0) {
      // 向後兼容：對於卡牌階段，使用既有的 playBtn
      const playBtn = document.getElementById('playBtn');
      if (playBtn) {
        playBtn.style.display = 'block';
        const action = this.actions.get('play_card');
        if (action) {
          action.element = playBtn;
          // 綁定事件
          playBtn.onclick = () => {
            const selectedCard = window.selectedCard; // 使用全局變數（向後兼容）
            if (selectedCard) {
              this.onSelectionChanged(selectedCard);
              this.executeAction('play_card');
            }
          };
        }
      }
    } else {
      inlineActions.forEach(action => {
        const button = this.createActionButton(action);
        actionbar.appendChild(button);
        action.element = button;
      });
    }
  }

  renderControllerUI() {
    const controllerZone = document.getElementById('controllerZone');
    if (!controllerZone) return;

    controllerZone.classList.add('active');

    const layout = this.currentConfig.controllerLayout || 'pad-4';
    const container = document.getElementById('controllerLayout');
    if (!container) return;

    container.innerHTML = '';

    // 根據 layout 類型渲染控制器
    this.renderControllerLayout(container, layout);
  }

  renderControllerLayout(container, layout) {
    // 清空容器
    container.innerHTML = '';
    container.className = 'ctrl-layout';

    const labels = {};
    this.actions.forEach((action, actionId) => {
      labels[actionId] = action.label;
    });

    if (layout === 'pad-8') {
      container.appendChild(this.buildPadGrid(
        ['btn1','btn2','btn3','btn4','btn5','btn6','btn7','btn8'], labels, 4));
    } else if (layout === 'pad-4') {
      container.appendChild(this.buildPadGrid(['btn1','btn2','btn3','btn4'], labels, 2));
    } else if (layout === 'pad-2') {
      container.classList.add('layout-pad-2');
      container.appendChild(this.buildPadGrid(['btn1','btn2'], labels, 2));
    } else if (layout === 'dpad-2btn') {
      container.appendChild(this.buildDpad(''));
      const col = document.createElement('div');
      col.className = 'ctrl-action-col';
      col.appendChild(this.buildCtrlBtn('btn1', labels['btn1'] || 'A'));
      col.appendChild(this.buildCtrlBtn('btn2', labels['btn2'] || 'B'));
      container.appendChild(col);
    } else if (layout === 'dpad-dpad') {
      container.appendChild(this.buildDpad(''));
      container.appendChild(this.buildDpad('2'));
    }
  }

  buildPadGrid(keys, labels, cols) {
    const grid = document.createElement('div');
    grid.className = `pad-grid cols-${cols}`;
    keys.forEach(k => grid.appendChild(this.buildCtrlBtn(k, labels[k] || k.replace('btn',''))));
    return grid;
  }

  buildCtrlBtn(key, label) {
    const btn = document.createElement('div');
    btn.className = 'ctrl-btn';
    btn.textContent = label;

    // 綁定 ActionButtonManager 的 action
    btn.onmousedown = (e) => {
      e.preventDefault();
      this.executeControllerAction(key, 'down');
    };
    btn.onmouseup = (e) => {
      e.preventDefault();
      this.executeControllerAction(key, 'up');
    };
    btn.ontouchstart = (e) => {
      e.preventDefault();
      this.executeControllerAction(key, 'down');
    };
    btn.ontouchend = (e) => {
      e.preventDefault();
      this.executeControllerAction(key, 'up');
    };

    return btn;
  }

  buildDpad(suffix) {
    const wrap = document.createElement('div');
    wrap.className = 'dpad-wrap';
    [['up','▲'],['down','▼'],['left','◀'],['right','►']].forEach(([dir, sym]) => {
      const seg = document.createElement('div');
      seg.className = `dpad-segment dpad-${dir}`;
      seg.textContent = sym;

      const key = dir + suffix;
      seg.onmousedown = (e) => {
        e.preventDefault();
        this.executeControllerAction(key, 'down');
      };
      seg.onmouseup = (e) => {
        e.preventDefault();
        this.executeControllerAction(key, 'up');
      };
      seg.ontouchstart = (e) => {
        e.preventDefault();
        this.executeControllerAction(key, 'down');
      };
      seg.ontouchend = (e) => {
        e.preventDefault();
        this.executeControllerAction(key, 'up');
      };

      wrap.appendChild(seg);
    });
    const center = document.createElement('div');
    center.className = 'dpad-center';
    wrap.appendChild(center);
    return wrap;
  }

  executeControllerAction(key, state) {
    if (!this.client) return;

    this.client.playerAction('game', {
      key: key,
      state: state,
      seq: Date.now()
    });
  }

  createActionButton(action) {
    const button = document.createElement('button');
    button.id = `action-${action.id}`;
    button.className = `action-btn action-${action.type || 'primary'}`;

    const stateConfig = action.states[action.currentState] || action.states.idle;
    button.textContent = stateConfig.text || action.label;
    button.disabled = stateConfig.disabled !== false;

    button.onclick = () => this.executeAction(action.id);

    return button;
  }

  updateActionUI(actionId, stateConfig, data) {
    const action = this.actions.get(actionId);
    if (!action?.element) return;

    const button = action.element;

    // 更新文字
    if (stateConfig.text) {
      button.textContent = stateConfig.text;
    }

    // 更新 disabled 狀態
    button.disabled = stateConfig.disabled !== false;

    // 更新樣式
    const styleClass = stateConfig.style || action.currentState;
    button.className = `action-btn action-${action.type || 'primary'} action-${styleClass}`;

    // 更新顯示/隱藏
    if (action.currentState === 'hidden' || stateConfig.style === 'hidden') {
      button.style.display = 'none';
    } else {
      button.style.display = '';
    }
  }

  // ═══════════════════════════════════════════════════════════
  //   條件檢查
  // ═══════════════════════════════════════════════════════════

  checkConditions(actionId, newState) {
    const action = this.actions.get(actionId);
    if (!action?.conditions) return;

    const conditions = action.conditions;

    // 檢查 hideWhen 條件
    if (conditions.hideWhen === newState) {
      this.updateActionState(actionId, 'hidden');
      return;
    }

    // 其他條件檢查可以在此添加
  }

  // ═══════════════════════════════════════════════════════════
  //   倒數計時
  // ═══════════════════════════════════════════════════════════

  startCountdown(seconds, onComplete) {
    console.log('[ActionButtonManager] Starting countdown:', seconds);

    this.countdownRemaining = seconds;
    const total = seconds;

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }

    const timerEl = document.getElementById('actionTimer');
    if (!timerEl) return;

    const updateTimer = () => {
      if (this.countdownRemaining > 0) {
        timerEl.textContent = `⏱ ${this.countdownRemaining}s / ${total}s`;
        this.countdownRemaining--;
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        timerEl.textContent = '';

        if (onComplete) {
          onComplete();
        }
      }
    };

    updateTimer();
    this.countdownTimer = setInterval(updateTimer, 1000);
  }

  stopCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    const timerEl = document.getElementById('actionTimer');
    if (timerEl) {
      timerEl.textContent = '';
    }

    this.countdownRemaining = 0;
  }

  // ═══════════════════════════════════════════════════════════
  //   清理
  // ═══════════════════════════════════════════════════════════

  clearCurrentStage() {
    console.log('[ActionButtonManager] Clearing current stage');

    this.hideAllUIModes();
    this.actions.clear();
    this.currentStates.clear();
    this.selection.clear();
    this.currentConfig = null;
    this.currentStageType = null;

    this.stopCountdown();
  }

  // ═══════════════════════════════════════════════════════════
  //   向後兼容方法
  // ═══════════════════════════════════════════════════════════

  // 舊的投票系統相容方法
  setupVoteScreen(voteData) {
    console.log('[ActionButtonManager] setupVoteScreen (backward compat):', voteData);

    this.setupStage({
      stageId: voteData.stageId,
      stageType: 'vote',
      voteConfig: voteData.voteConfig,
      options: voteData.options,
      eligibleVoters: voteData.eligibleVoters
    });
  }

  // 舊的卡牌系統相容方法
  updatePlayButton(selectedCard, isPlayingCard, hasPlayedThisRound, isRevealed) {
    const action = this.actions.get('play_card');
    if (!action) return;

    let newState = 'idle';
    let stateText = '請選擇一張牌';

    if (!selectedCard) {
      newState = 'idle';
      stateText = '請選擇一張牌';
    } else if (isPlayingCard) {
      newState = 'submitting';
      stateText = '出牌中…';
    } else if (hasPlayedThisRound) {
      newState = 'submitted';
      stateText = '已出牌';
    } else if (isRevealed) {
      newState = 'disabled';
      stateText = '等待下一回合';
    } else {
      newState = 'ready';
      stateText = '出牌';
    }

    this.updateActionState('play_card', newState, { text: stateText });
  }
}

// 導出單例實例
const actionManager = new ActionButtonManager();

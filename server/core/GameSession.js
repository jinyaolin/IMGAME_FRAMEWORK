'use strict';

const { PlayerManager } = require('./PlayerManager');

/**
 * Transport 契約(Phase 0 傳輸抽象):GameSession 對外只透過 `transport.to(id).emit(event, data)` 送訊息。
 *   id = this.roomId → 廣播給房內全部;id = 某 socket/peer id → 定向。無 ack/回呼、無 socket.io 專屬特性。
 * - Node(現行):直接餵 socket.io 的 `io`,`io.to(roomId|socketId).emit()` 原生符合此介面 → 行為零變。
 * - 瀏覽器(Phase 2 P2P):餵一個 P2PRouter,to(roomId)=送全部 DataChannel、to(peerId)=送單一 peer。
 * GameSession / BaseModule 感知不到傳輸差別;所有出口都經下方 6 個 broadcast/send helper。
 */
class GameSession {
  constructor(roomId, transport) {
    this.roomId = roomId;
    this.transport = transport;
    this.players = new PlayerManager();
    this.displaySocketIds = new Set();
    this.hostSocketId = null;
    this.currentModule = null;
    this.moduleName = null;
    this.manifest = null;     // set at room creation when moduleId is provided
    this.phase = 'lobby';           // lobby | playing | result
    this.ownerUserId = null;        // 開房者(zai_session userId;'local'=本機);非擁有者不能主持
    this.sharedState = {};
    this.globalParams = {};         // 🆕 全局參數定義
    this.createdAt = Date.now();
    this.reconnectWindow = 30000;   // 30s reconnect grace period
    this._disconnectTimers = new Map();
  }

  // ── Player lifecycle ──────────────────────────────────────────

  addPlayer(playerId, name, socketId) {
    const existing = this.players.get(playerId);
    // Same ID but different name = collision (same-device tabs before sessionStorage fix)
    // Assign a new unique ID so they become a separate player
    if (existing && existing.name !== name) {
      playerId = 'p_' + Math.random().toString(36).slice(2, 10);
    } else if (existing) {
      return this.reconnectPlayer(playerId, socketId);
    }

    const player = this.players.add(playerId, name, socketId);

    // 🆕 初始化玩家屬性（支援新類型）
    if (this.manifest?.playerAttributes) {
      for (const def of this.manifest.playerAttributes) {
        if (!(def.id in player.attributes)) {
          player.attributes[def.id] = this._getPlayerAttributeInitialValue(def);
        }
      }
    }

    this.transport.to(this.roomId).emit('player_joined', { player: player.toPublic(), players: this.players.publicList() });
    return player;
  }

  // 🆕 取得玩家屬性初始值
  _getPlayerAttributeInitialValue(attrDef) {
    // select 類型：用第一個選項
    if (attrDef.type === 'select' && attrDef.options?.length > 0) {
      return attrDef.options[0].value;
    }

    // 其他類型：用 initialValue 或預設值
    if (attrDef.initialValue !== undefined) {
      return attrDef.initialValue;
    }

    switch (attrDef.type) {
      case 'number':
        return attrDef.subType === 'float' ? 0.0 : 0;
      case 'boolean':
        return false;
      case 'string':
        return '';
      case 'array':
        return [];
      case 'player':
      case 'card':
        return null;
      default:
        return '';
    }
  }

  reconnectPlayer(playerId, newSocketId) {
    const timer = this._disconnectTimers.get(playerId);
    if (timer) { clearTimeout(timer); this._disconnectTimers.delete(playerId); }
    const player = this.players.reconnect(playerId, newSocketId);
    if (player && this.currentModule) {
      const inCurrentGame = this.currentModule
        ? this.currentModule.players.some(p => p.id === playerId)
        : false;
      this.sendToPlayer(playerId, 'reconnected', {
        phase: this.phase,
        sharedState: this.sharedState,
        playerState: player.toPrivate(),
        inCurrentGame,
      });
      // Re-send module private state (hand, identity) held in BaseModule maps
      if (typeof this.currentModule.onReconnect === 'function') {
        this.currentModule.onReconnect(playerId, this);
      }
    }
    this.broadcastAll('player_reconnected', { playerId });
    return player;
  }

  disconnectPlayer(socketId) {
    const player = this.players.getBySocketId(socketId);
    if (!player) return;

    player.isConnected = false;
    this.broadcastAll('player_disconnected', { playerId: player.id });

    // Let the active module re-check its advance conditions (e.g. all-played)
    if (this.currentModule?.onPlayerDisconnected) {
      try { this.currentModule.onPlayerDisconnected(player.id, this); }
      catch (e) { console.error('[Module] onPlayerDisconnected error:', e); }
    }

    const timer = setTimeout(() => {
      this.players.remove(player.id);
      this.broadcastAll('player_left', { playerId: player.id });
      this._disconnectTimers.delete(player.id);
    }, this.reconnectWindow);
    this._disconnectTimers.set(player.id, timer);
  }

  // ── Module management ─────────────────────────────────────────

  async startModule(moduleInstance, moduleName) {
    this.currentModule = moduleInstance;
    this.moduleName = moduleName;
    this.phase = 'playing';

    // 🆕 初始化全局參數
    this.initializeGlobalParams();

    this.broadcastDisplay('module_loaded', { module: moduleName });

    try {
      const readyPlayers = this.players.all().filter(p => p.isReady);
      await this.currentModule.onStart(readyPlayers, this);
    } catch (e) {
      console.error('[GameSession] onStart error:', e);
      this.broadcastAll('module_error', { message: e.message });
      this.currentModule = null;
      this.phase = 'lobby';
      return;
    }

    this.sendHostGameState();
  }

  async handlePlayerAction(playerId, action, data) {
    if (!this.currentModule) return;
    try {
      await this.currentModule.onPlayerAction(playerId, action, data, this);
    } catch (e) {
      console.error('[GameSession] handlePlayerAction error:', e);
    }
  }

  async handlePlayerSubmit(playerId, data) {
    if (!this.currentModule) return;
    try {
      await this.currentModule.onPlayerSubmit(playerId, data, this);
    } catch (e) {
      console.error('[GameSession] handlePlayerSubmit error:', e);
    }
  }

  async handleHostNextPhase(data) {
    if (!this.currentModule) return;
    try {
      await this.currentModule.onHostNextPhase(data, this);
    } catch (e) {
      console.error('[GameSession] handleHostNextPhase error:', e);
    }
  }

  // ── State updates ─────────────────────────────────────────────

  updateSharedState(patch) {
    Object.assign(this.sharedState, patch);
    this.broadcastDisplay('state_update', { sharedState: this.sharedState });
    this.broadcastAll('state_update', { sharedState: this.sharedState });
  }

  // 🆕 初始化全局參數（從 manifest.globalParams）
  initializeGlobalParams() {
    if (!this.manifest?.globalParams) return;

    for (const param of this.manifest.globalParams) {
      const initialValue = this._getParamInitialValue(param);

      // 存入 sharedState（向後相容）
      this.sharedState[param.id] = initialValue;

      // 同時存入 globalParams 定義映射
      this.globalParams[param.id] = {
        ...param,
        currentValue: initialValue
      };
    }

    console.log('[GameSession] Initialized globalParams:', Object.keys(this.globalParams).length);
  }

  // 🆕 取得參數初始值（處理不同類型）
  _getParamInitialValue(param) {
    if (param.initialValue !== undefined) {
      return param.initialValue;
    }

    // 根據類型給預設值
    switch (param.type) {
      case 'number':
        return param.subType === 'float' ? 0.0 : 0;
      case 'boolean':
        return false;
      case 'string':
        return '';
      case 'array':
        return [];
      case 'player':
      case 'card':
        return null;
      default:
        return null;
    }
  }

  // 🆕 全局參數 API
  setGlobalParam(paramId, value) {
    if (!(paramId in this.globalParams)) {
      console.warn(`[GameSession] Unknown globalParam: ${paramId}`);
      return;
    }

    const param = this.globalParams[paramId];

    // 驗證
    if (param.type === 'number') {
      if (param.min !== undefined && value < param.min) {
        console.warn(`[GameSession] Value ${value} below min ${param.min}`);
        value = param.min;
      }
      if (param.max !== undefined && value > param.max) {
        console.warn(`[GameSession] Value ${value} above max ${param.max}`);
        value = param.max;
      }
    }

    // 更新
    this.globalParams[paramId].currentValue = value;
    this.sharedState[paramId] = value;  // 同步到 sharedState

    // 廣播更新
    this.updateSharedState({ [paramId]: value });
  }

  getGlobalParam(paramId) {
    if (!(paramId in this.globalParams)) {
      console.warn(`[GameSession] Unknown globalParam: ${paramId}`);
      return undefined;
    }
    return this.globalParams[paramId].currentValue;
  }

  // 🆕 玩家參數 API
  setPlayerParam(playerId, paramId, value) {
    const player = this.players.get(playerId);
    if (!player) {
      console.warn(`[GameSession] Player not found: ${playerId}`);
      return;
    }

    const paramDef = this.manifest?.playerAttributes?.find(p => p.id === paramId);
    if (!paramDef) {
      console.warn(`[GameSession] Unknown playerAttribute: ${paramId}`);
      return;
    }

    // 驗證
    if (paramDef.type === 'number') {
      if (paramDef.min !== undefined && value < paramDef.min) {
        console.warn(`[GameSession] Value ${value} below min ${paramDef.min}`);
        value = paramDef.min;
      }
      if (paramDef.max !== undefined && value > paramDef.max) {
        console.warn(`[GameSession] Value ${value} above max ${paramDef.max}`);
        value = paramDef.max;
      }
    }

    // 更新玩家屬性
    player.attributes[paramId] = value;

    // 廣播更新
    this.broadcastAll('player_param_updated', {
      playerId,
      paramId,
      value,
      attributes: player.attributes
    });
  }

  // 舊式(非 NetKit)遊戲的保留事件:display gameCode broadcast({ t:'score'|'set_attr', ... })
  // 在轉發層攔截寫回框架玩家資料(對齊 NetKitHost applyReserved 的語意;NetKit 走 Sim.emit)。
  // 只認 display(權威端)來源 — 呼叫端負責驗證 socket 是已註冊的 display,手機 game_event 不走這裡
  // (否則任何玩家手機都能自報分數)。回傳 true = 是保留事件(已處理;照常轉發無妨,手機會忽略)。
  //   { t:'score', pid, score }        → 設絕對分數;{ t:'score', pid, add } → 累加(result 階段排名用)
  //   { t:'set_attr', pid, attrId, value } → setPlayerParam(驗 manifest 宣告,跨階段保留)
  applyReservedGameEvent(d) {
    try {
      if (!d || typeof d !== 'object') return false;
      if (d.t === 'score') {
        const p = this.players.get(String(d.pid));
        if (p) {
          if (typeof d.score === 'number') p.score = d.score;
          else if (typeof d.add === 'number') p.score = (p.score || 0) + d.add;
        }
        return true;
      }
      if (d.t === 'set_attr' && d.attrId) {
        this.setPlayerParam(String(d.pid), d.attrId, d.value);
        return true;
      }
    } catch (e) { console.warn('[GameSession] 保留事件失敗:', d && d.t, e && e.message); }
    return false;
  }

  getPlayerParam(playerId, paramId) {
    const player = this.players.get(playerId);
    if (!player) {
      console.warn(`[GameSession] Player not found: ${playerId}`);
      return undefined;
    }

    if (!(paramId in player.attributes)) {
      console.warn(`[GameSession] Player ${playerId} has no attribute ${paramId}`);
      return undefined;
    }

    return player.attributes[paramId];
  }

  // 🆕 取得所有玩家的某個參數值
  getAllPlayerParams(paramId) {
    const result = {};
    for (const player of this.players.all()) {
      if (paramId in player.attributes) {
        result[player.id] = player.attributes[paramId];
      }
    }
    return result;
  }

  // Push detailed game state to host only (called by modules after every change)
  sendHostGameState() {
    if (!this.hostSocketId || !this.currentModule?.getHostState) return;
    const state = this.currentModule.getHostState();
    this.sendToHost('host_game_state', { module: this.moduleName, ...state });
  }

  // Reset back to lobby (e.g. after game ends and host picks new module)
  resetToLobby() {
    // 先讓模組清掉自己的計時器（中途中止時尤其重要，否則殘留的自動推進會打到已卸下的模組）
    if (this.currentModule && typeof this.currentModule.dispose === 'function') {
      try { this.currentModule.dispose(); }
      catch (e) { console.error('[GameSession] module dispose error:', e.message); }
    }
    this.currentModule = null;
    this.moduleName    = null;
    this.phase         = 'lobby';
    this.sharedState   = {};
    this.globalParams  = {};  // 🆕 清空全局參數
    // Keep player ready states - players can quickly start next game
    // for (const p of this.players.all()) {
    //   p.isReady = false;
    // }
    this.broadcastAll('back_to_lobby', {});
	    // Broadcast current player states so clients can sync ready status
	    this.broadcastAll('player_ready', { players: this.players.publicList() });
  }

  // ── Broadcast helpers ─────────────────────────────────────────

  broadcastAll(event, data) {
    this.transport.to(this.roomId).emit(event, { roomId: this.roomId, ...data });
    // AI 主持觀察者（server/ai）：訂閱遊戲事件以決定是否介入
    if (this.aiObserver) {
      try { this.aiObserver(event, data); } catch (e) { console.error('[AI] observer error:', e.message); }
    }
  }

  broadcastDisplay(event, data) {
    for (const sid of this.displaySocketIds) {
      this.transport.to(sid).emit(event, { roomId: this.roomId, ...data });
    }
  }

  broadcastPlayers(event, data) {
    for (const player of this.players.all()) {
      if (player.isConnected) {
        this.transport.to(player.socketId).emit(event, { roomId: this.roomId, ...data });
      }
    }
  }

  sendToPlayer(playerId, event, data) {
    const player = this.players.get(playerId);
    if (player && player.isConnected) {
      this.transport.to(player.socketId).emit(event, { roomId: this.roomId, ...data });
    }
  }

  sendToHost(event, data) {
    if (this.hostSocketId) {
      this.transport.to(this.hostSocketId).emit(event, { roomId: this.roomId, ...data });
    }
  }

  // ── Serialization ─────────────────────────────────────────────

  toSummary() {
    return {
      roomId: this.roomId,
      phase: this.phase,
      moduleName: this.moduleName,
      playerCount: this.players.count(),
      players: this.players.publicList(),
    };
  }
}

module.exports = GameSession;

'use strict';

const { PlayerManager } = require('./PlayerManager');

class GameSession {
  constructor(roomId, io) {
    this.roomId = roomId;
    this.io = io;
    this.players = new PlayerManager();
    this.displaySocketIds = new Set();
    this.hostSocketId = null;
    this.currentModule = null;
    this.moduleName = null;
    this.phase = 'lobby';           // lobby | playing | result
    this.sharedState = {};
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
    this.io.to(this.roomId).emit('player_joined', { player: player.toPublic(), players: this.players.publicList() });
    return player;
  }

  reconnectPlayer(playerId, newSocketId) {
    const timer = this._disconnectTimers.get(playerId);
    if (timer) { clearTimeout(timer); this._disconnectTimers.delete(playerId); }
    const player = this.players.reconnect(playerId, newSocketId);
    if (player && this.currentModule) {
      // Re-send their private state
      this.sendToPlayer(playerId, 'reconnected', {
        phase: this.phase,
        sharedState: this.sharedState,
        playerState: player.toPrivate(),
      });
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

    // Broadcast game_started FIRST so clients reset UI to a clean state
    // before stage-specific events (identity_assigned / cards_drawn) arrive.
    // This matches the restart flow in card-battle's onHostNextPhase.
    this.broadcastAll('game_started', {
      module: moduleName,
      sharedState: this.sharedState,
    });
    this.broadcastDisplay('module_loaded', { module: moduleName });

    await this.currentModule.onStart(this.players.all(), this);

    this.sendHostGameState();
  }

  async handlePlayerAction(playerId, action, data) {
    if (!this.currentModule) return;
    await this.currentModule.onPlayerAction(playerId, action, data, this);
  }

  async handlePlayerSubmit(playerId, data) {
    if (!this.currentModule) return;
    await this.currentModule.onPlayerSubmit(playerId, data, this);
  }

  async handleHostNextPhase(data) {
    if (!this.currentModule) return;
    await this.currentModule.onHostNextPhase(data, this);
  }

  // ── State updates ─────────────────────────────────────────────

  updateSharedState(patch) {
    Object.assign(this.sharedState, patch);
    this.broadcastDisplay('state_update', { sharedState: this.sharedState });
    this.broadcastAll('state_update', { sharedState: this.sharedState });
  }

  // Push detailed game state to host only (called by modules after every change)
  sendHostGameState() {
    if (!this.hostSocketId || !this.currentModule?.getHostState) return;
    const state = this.currentModule.getHostState();
    this.sendToHost('host_game_state', { module: this.moduleName, ...state });
  }

  // Reset back to lobby (e.g. after game ends and host picks new module)
  resetToLobby() {
    this.currentModule = null;
    this.moduleName    = null;
    this.phase         = 'lobby';
    this.sharedState   = {};
    this.broadcastAll('back_to_lobby', {});
  }

  // ── Broadcast helpers ─────────────────────────────────────────

  broadcastAll(event, data) {
    this.io.to(this.roomId).emit(event, { roomId: this.roomId, ...data });
  }

  broadcastDisplay(event, data) {
    for (const sid of this.displaySocketIds) {
      this.io.to(sid).emit(event, { roomId: this.roomId, ...data });
    }
  }

  broadcastPlayers(event, data) {
    for (const player of this.players.all()) {
      if (player.isConnected) {
        this.io.to(player.socketId).emit(event, { roomId: this.roomId, ...data });
      }
    }
  }

  sendToPlayer(playerId, event, data) {
    const player = this.players.get(playerId);
    if (player && player.isConnected) {
      this.io.to(player.socketId).emit(event, { roomId: this.roomId, ...data });
    }
  }

  sendToHost(event, data) {
    if (this.hostSocketId) {
      this.io.to(this.hostSocketId).emit(event, { roomId: this.roomId, ...data });
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

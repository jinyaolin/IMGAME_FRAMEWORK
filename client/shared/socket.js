// Shared WebSocket client wrapper
class GameClient {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.roomId = null;
    this.role = null;
    this._handlers = {};
  }

  connect(serverUrl) {
    this.socket = io(serverUrl || window.location.origin);
    this.socket.on('connect', () => this._emit('connect'));
    this.socket.on('disconnect', () => this._emit('disconnect'));
    this.socket.on('error', (d) => this._emit('error', d));
    return this;
  }

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    if (this.socket) this.socket.on(event, fn);
    return this;
  }

  _emit(event, data) {
    (this._handlers[event] || []).forEach(fn => fn(data));
  }

  // ── Player API ──────────────────────────────────────────────
  joinRoom(roomId, playerId, playerName) {
    this.roomId = roomId.toUpperCase();
    this.playerId = playerId;
    this.role = 'player';
    this.socket.emit('join_room', { roomId: this.roomId, playerId, playerName });
  }

  setReady(isReady) {
    this.socket.emit('player_ready', { roomId: this.roomId, playerId: this.playerId, isReady });
  }

  playCard(cardId, target) {
    this.socket.emit('play_card', { roomId: this.roomId, playerId: this.playerId, cardId, target });
  }

  playerAction(action, data) {
    this.socket.emit('player_action', { roomId: this.roomId, playerId: this.playerId, action, data });
  }

  submitData(data) {
    this.socket.emit('player_submit', { roomId: this.roomId, playerId: this.playerId, data });
  }

  // ── Display API ─────────────────────────────────────────────
  joinDisplay(roomId) {
    this.roomId = roomId.toUpperCase();
    this.role = 'display';
    this.socket.emit('join_display', { roomId: this.roomId });
  }

  // ── Host API ────────────────────────────────────────────────
  joinHost(roomId) {
    this.roomId = roomId.toUpperCase();
    this.role = 'host';
    this.socket.emit('join_host', { roomId: this.roomId });
  }

  loadModule(moduleName, config) {
    this.socket.emit('host_load_module', { roomId: this.roomId, moduleName, config });
  }

  nextPhase(data) {
    this.socket.emit('host_next_phase', { roomId: this.roomId, data });
  }

  kickPlayer(playerId) {
    this.socket.emit('host_kick_player', { roomId: this.roomId, playerId });
  }
}

// Per-tab player ID — sessionStorage so each browser tab is a separate player
function getOrCreatePlayerId() {
  let id = sessionStorage.getItem('playerId');
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('playerId', id);
  }
  return id;
}

function getRoomFromUrl() {
  return new URLSearchParams(window.location.search).get('room') || '';
}

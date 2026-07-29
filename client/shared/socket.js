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
    // 子路徑部署時 socket.io 也在前綴之下(伺服器端 path = BASE + '/socket.io')
    const path = (window.IMGAME_BASE || '') + '/socket.io';
    this.socket = io(serverUrl || window.location.origin, { path });
    // connect 前註冊的 handler 要補掛到新 socket(支援離房重連後再 connect)
    for (const [event, fns] of Object.entries(this._handlers)) {
      fns.forEach(fn => this.socket.on(event, fn));
    }
    this.socket.on('connect', () => this._emit('connect'));
    this.socket.on('disconnect', () => this._emit('disconnect'));
    this.socket.on('error', (d) => this._emit('error', d));
    return this;
  }

  // Phase 3:P2P 模式 —— 改連到 host 瀏覽器(GameSession 跑在那)而非 Node 伺服器。
  // this.socket 換成 P2PNode(其 emit/on 與 socket.io 同介面),所以下方所有 semantic 方法零改動就走 DataChannel。
  // 需先載入 client/shared/p2p.js。回傳 Promise,DataChannel 開了才 resolve。
  async connectP2P(roomId, opts) {
    opts = opts || {};
    if (roomId) this.roomId = String(roomId).toUpperCase();
    const path = (window.IMGAME_BASE || '') + '/socket.io';
    const sig = io(opts.origin || window.location.origin, { path });   // socket.io 只當信令
    await new Promise((res) => { sig.connected ? res() : sig.on('connect', res); });
    const p2p = new P2PNode(sig, { roomId: this.roomId, role: opts.role || 'client', iceServers: opts.iceServers });
    this.p2p = p2p;
    this._signalSocket = sig;
    // 已註冊的 handler 補掛到 p2p(與 connect() 對稱)
    for (const [event, fns] of Object.entries(this._handlers)) fns.forEach((fn) => p2p.on(event, fn));
    p2p.onPeerOpen(() => this._emit('connect'));
    p2p.onPeerClose(() => this._emit('disconnect'));
    this.socket = p2p;                    // ★ 讓 semantic 方法的 this.socket.emit 走 P2P
    await p2p.join();
    await new Promise((res, rej) => {
      const t0 = Date.now();
      (function w() { if (p2p.openPeers() >= 1) return res(); if (Date.now() - t0 > 15000) return rej(new Error('P2P 連線逾時')); setTimeout(w, 80); })();
    });
    return this;
  }

  // Phase 3:host#1 自己的畫面(display/console)走「本機 loopback」——不經任何網路,直接接同頁的 GameHost。
  // this.socket 換成 gameHost.hostBackend()(emit→灌進 session、on→訂閱本機廣播),GameClient 全部方法零改動。
  connectLocal(gameHost) {
    const backend = gameHost.hostBackend();
    for (const [event, fns] of Object.entries(this._handlers)) fns.forEach((fn) => backend.on(event, fn));
    this.socket = backend;
    this._emit('connect');
    return this;
  }

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    if (this._handlers[event].includes(fn)) return this;  // 避免重複掛載
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

  // 選定模組(只載入快照、留在大廳,不啟動)— labs 頁「載入遊戲」
  selectModule(moduleName) {
    this.socket.emit('host_select_module', { roomId: this.roomId, moduleName });
  }

  // 更換遊戲模組：把全部人踢回大廳並清掉房間快照，讓主持人重新挑模組開新局
  changeModule() {
    this.socket.emit('host_change_module', { roomId: this.roomId });
  }

  nextPhase(data) {
    this.socket.emit('host_next_phase', { roomId: this.roomId, data });
  }

  closeRoom() {
    this.socket.emit('host_close_room', { roomId: this.roomId });
  }

  kickPlayer(playerId) {
    this.socket.emit('host_kick_player', { roomId: this.roomId, playerId });
  }

  setPlayerAlive(playerId, isAlive) {
    this.socket.emit('host_set_player_alive', { roomId: this.roomId, playerId, isAlive });
  }

  setPlayerAttribute(playerId, attrId, value) {
    this.socket.emit('host_set_player_attribute', { roomId: this.roomId, playerId, attrId, value });
  }

  setPlayerOrder(order) {
    this.socket.emit('host_set_player_order', { roomId: this.roomId, order });
  }

  renamePlayer(playerId, newName) {
    this.socket.emit('host_rename_player', { roomId: this.roomId, playerId, newName });
  }
}

// Per-tab player ID — sessionStorage so each browser tab is a separate player
// 玩家身份持久化(resume 用):帶 roomId 時同「房間+名字」→ 同 playerId,存 localStorage
// (跨分頁、重開瀏覽器都能以同身份重連,吃 GameSession 的重連復原);24h 過期惰性清理。
// key 含名字 → 同一瀏覽器開多個分頁測試時,用不同 ?name= 就是不同玩家,互不搶身份。
// 不帶 roomId = 舊行為(sessionStorage,分頁隔離);localStorage 不可用(隱私模式)也退回舊行為。
function getOrCreatePlayerId(roomId, name) {
  const fallback = () => {
    let id = sessionStorage.getItem('playerId');
    if (!id) {
      id = 'p_' + Math.random().toString(36).slice(2, 10);
      try { sessionStorage.setItem('playerId', id); } catch (e) {}
    }
    return id;
  };
  if (!roomId) return fallback();
  const PRE = 'imgame.pid.', TTL = 24 * 3600 * 1000;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {   // 惰性清過期房間
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PRE)) continue;
      try { const v = JSON.parse(localStorage.getItem(k)); if (!v || Date.now() - (v.ts || 0) > TTL) localStorage.removeItem(k); }
      catch (e) { localStorage.removeItem(k); }
    }
    const key = PRE + String(roomId).toUpperCase() + '.' + (name || '');
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(key)); } catch (e) {}
    if (!rec || !rec.id) rec = { id: 'p_' + Math.random().toString(36).slice(2, 10) };
    rec.ts = Date.now();
    localStorage.setItem(key, JSON.stringify(rec));
    return rec.id;
  } catch (e) { return fallback(); }
}

function getRoomFromUrl() {
  return new URLSearchParams(window.location.search).get('room') || '';
}

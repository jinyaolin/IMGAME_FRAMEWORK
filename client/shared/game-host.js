// ── Phase 2/3:host 瀏覽器把 GameSession 當 server 跑 ──
// GameHost 把「遠端 peer(P2P)」與「host 本機 UI(loopback)」的入站事件統一 dispatch 到 GameSession,
// payload 形狀與 server/index.js 的 socket.on handlers 相同。
//
// transport 是「複合」:session 廣播(to(roomId))或送給本機 host id(LOCAL)時,同時送 P2P peers + 本機 sink,
// 讓 host#1 自己的 display/console 也收得到(它不是 P2P peer)。peerId 取代 socketId;LOCAL 代表 host 本機 UI。
(function (global) {
  'use strict';

  const LOCAL = '__local_host__';

  class GameHost {
    // engine = loadGameEngine() 回傳;p2p = 已建立的 host 端 P2PNode
    constructor(p2p, engine, opts) {
      opts = opts || {};
      this.p2p = p2p;
      this.engine = engine;
      this.roomId = opts.roomId;
      this.LOCAL = LOCAL;
      this._localHandlers = new Map();          // event → Set(cb)   host 本機 UI 的 on()

      const self = this;
      // 複合 transport:遠端 peers 走 P2P;roomId(廣播)或 LOCAL(定向給本機 host)時也餵本機 sink
      const transport = {
        to(id) {
          return {
            emit(event, data) {
              self.p2p.to(id).emit(event, data);
              if (id === self.roomId || id === LOCAL) self._emitLocal(event, data);
            },
          };
        },
      };
      this.session = new engine.GameSession(this.roomId, transport);
      this.session.deckLoader = opts.deckLoader || null;
      if (opts.manifest) this.session.manifest = opts.manifest;

      // 遠端 peer 的入站事件 → 統一 dispatch(from = peerId)
      const EVENTS = ['join_room', 'join_display', 'join_host', 'player_ready', 'player_action',
        'player_submit', 'play_card', 'host_load_module', 'host_select_module', 'host_next_phase', 'host_change_module',
        'display_game_broadcast'];
      for (const ev of EVENTS) p2p.on(ev, (d, from) => self._dispatch(ev, d, from));
      p2p.onPeerClose((peerId) => { try { self.session.disconnectPlayer(peerId); } catch (e) {} });
    }

    _emitLocal(event, data) { const s = this._localHandlers.get(event); if (s) for (const cb of s) { try { cb(data); } catch (e) {} } }
    // 送給某來源(遠端 peer 走 P2P;本機 host UI 走 local sink)
    _sendTo(from, event, data) { if (from === LOCAL) this._emitLocal(event, data); else this.p2p.to(from).emit(event, data); }

    // 統一入站處理(遠端 peer 與本機 loopback 共用)。from = peerId 或 LOCAL。
    async _dispatch(event, d, from) {
      d = d || {};
      const s = this.session;
      switch (event) {
        case 'join_room':
          s.addPlayer(d.playerId, d.playerName, from);
          this._sendTo(from, 'room_state', { phase: s.phase, sharedState: s.sharedState, players: s.players.publicList() });
          break;
        case 'join_display': {
          s.displaySocketIds.add(from);
          // 回 display_joined(與 server/index.js 同形)→ 大螢幕才會關掉「加入顯示端…」轉圈 overlay
          const cur = (s.phase === 'playing' && s.currentModule && s.currentModule.getCurrentStageInfo)
            ? s.currentModule.getCurrentStageInfo() : null;
          this._sendTo(from, 'display_joined', { roomId: this.roomId, phase: s.phase, moduleName: s.moduleName || null,
            players: s.players.publicList(), sharedState: s.sharedState, currentStage: cur });
          break;
        }
        case 'join_host':
          s.hostSocketId = from;   // 本機 host UI 用 LOCAL 註冊 → sendToHost 會餵本機 sink
          // 回 host_joined(與 server/index.js 同形),讓主持台初始化控制列(availableModules 由 host 頁自行 fetch)
          this._sendTo(from, 'host_joined', { roomId: this.roomId, phase: s.phase, moduleName: s.moduleName || null,
            manifest: s.manifest || null, players: s.players.publicList(), availableModules: [], sharedState: s.sharedState });
          break;
        case 'player_ready': {
          const pl = s.players.get(d.playerId);
          if (pl) { pl.isReady = !!d.isReady; pl.status = d.isReady ? 'ready' : 'waiting'; s.broadcastAll('player_ready', { players: s.players.publicList() }); }
          break;
        }
        case 'player_action': s.handlePlayerAction(d.playerId, d.action, d.data); break;
        // 舊 netcode(未遷 NetKit 的遊戲):display gameCode 的 broadcast() → 全體手機 onMessage。
        // 與 server/index.js 同形:僅接受已註冊的 display peer;保留事件({t:'score'|'set_attr'})先寫回框架。
        case 'display_game_broadcast':
          if (s.displaySocketIds.has(from)) {
            if (s.applyReservedGameEvent) s.applyReservedGameEvent(d.data);
            s.broadcastPlayers('game_broadcast', { data: d.data });
          }
          break;
        case 'player_submit': s.handlePlayerSubmit(d.playerId, d.data); break;
        case 'play_card': s.handlePlayerAction(d.playerId, 'play_card', { cardId: d.cardId, target: d.target }); break;
        case 'host_next_phase': s.handleHostNextPhase(d.data || {}); break;
        case 'host_change_module': s.resetToLobby(); break;
        case 'host_load_module': await this._loadModuleByName(d.moduleName, d.config); break;
        case 'host_select_module': await this._selectModuleByName(d.moduleName); break;
      }
    }

    async _loadModuleByName(moduleName, config) {
      const base = (global.IMGAME_BASE || '');
      const r = await fetch(base + '/api/modules/' + moduleName);
      if (!r.ok) throw new Error('取模組 manifest 失敗:HTTP ' + r.status);
      const j = await r.json();
      await this.loadManifest(j.manifest || j, moduleName, config);
    }

    // 選模組(留在大廳、不啟動):設快照 + 廣播 module_selected → 主持台啟用「啟動遊戲」按鈕(對齊 server)
    async _selectModuleByName(moduleName) {
      const base = (global.IMGAME_BASE || '');
      const r = await fetch(base + '/api/modules/' + moduleName);
      if (!r.ok) { this._sendTo(LOCAL, 'error', { message: '取模組失敗:HTTP ' + r.status }); return; }
      const j = await r.json();
      const manifest = j.manifest || j;
      this.session.manifest = manifest;
      this.session.moduleName = moduleName;
      this.session.broadcastAll('module_selected', { moduleId: moduleName, manifest });
    }

    // 純 manifest 模組:host 端直接 new BaseModule + startModule(與 server 同一份引擎碼)
    async loadManifest(manifest, moduleName, config) {
      this.session.manifest = manifest;
      const inst = new this.engine.BaseModule(manifest, this.session, config || {});
      await this.session.startModule(inst, moduleName || manifest.id || 'module');
      return inst;
    }

    // host 本機 UI 的 loopback backend:給 GameClient.connectLocal() 用。
    // emit → 灌進 session(from=LOCAL);on → 訂閱本機廣播 sink。介面與 socket.io 相同。
    hostBackend() {
      const self = this;
      return {
        emit(event, data) { self._dispatch(event, data, LOCAL); },
        on(event, cb) { let s = self._localHandlers.get(event); if (!s) { s = new Set(); self._localHandlers.set(event, s); } s.add(cb); },
      };
    }
  }

  global.GameHost = GameHost;
})(typeof window !== 'undefined' ? window : this);

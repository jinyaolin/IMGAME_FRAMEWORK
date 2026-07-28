// ── Phase 1:瀏覽器端 WebRTC 傳輸包裝(純 STUN;TURN 之後補)──
// P2PNode 對外提供 Transport 契約 `to(id).emit(event, data)` + `on(event, cb)`,
// 可直接當 Phase 0 抽象出的 GameSession.transport 用(Phase 2)。
// 用傳入的 socket.io 連線當「信令通道」交換 offer/answer/ICE;建連後遊戲流量走 DataChannel 直連,不再經 Node。
// 拓撲:host = 樞紐,對每個進房的 peer 主動發 offer;client 只等 offer 並回 answer。
(function (global) {
  'use strict';

  const DEFAULT_ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  class P2PNode {
    constructor(socket, opts) {
      opts = opts || {};
      this.socket = socket;
      this.roomId = opts.roomId;
      this.role = opts.role || 'client';         // 'host' | 'client'
      // 優先序:呼叫端明給 > 伺服器注入的 window.IMGAME_ICE(含 TURN)> 純 STUN 預設。
      // 連線在使用者動作(開房/加入)時才建,遠晚於 config.js 抓 /api/ice,所以 window.IMGAME_ICE 早就就位。
      this.iceServers = opts.iceServers || (typeof window !== 'undefined' && window.IMGAME_ICE) || DEFAULT_ICE;
      try { if (typeof window !== 'undefined' && window.IMGAME_ICE) console.log('[P2P] iceServers(含 TURN?):', this.iceServers.map(s => s.urls).join(' | ')); } catch (e) {}
      this.peerId = null;
      this.isHost = false;
      this.hostPeerId = null;
      this.peers = new Map();                     // peerId → { pc, channel, open, pending:[] }
      this._handlers = new Map();                 // event → Set<cb(data, fromPeerId)>
      this._openCbs = [];                         // (peerId) => …  DataChannel 開
      this._closeCbs = [];                        // (peerId) => …  DataChannel 關
      this._bindSignal();
    }

    // ── 對外 API ────────────────────────────────────────────────
    on(event, cb) { let s = this._handlers.get(event); if (!s) { s = new Set(); this._handlers.set(event, s); } s.add(cb); return this; }
    off(event, cb) { const s = this._handlers.get(event); if (s) s.delete(cb); return this; }
    onPeerOpen(cb) { this._openCbs.push(cb); return this; }
    onPeerClose(cb) { this._closeCbs.push(cb); return this; }

    // Transport 契約:to(id).emit(event,data)。id=roomId/'*' → 廣播;id=peerId → 定向。
    to(id) { const self = this; return { emit(event, data) { self._send(id, event, data); } }; }
    // client 便利:直接送給權威 host
    emit(event, data) { this._send(this.hostPeerId, event, data); return this; }

    openPeers() { let n = 0; for (const [, p] of this.peers) if (p.open) n++; return n; }

    // 向 Node 註冊進房,取得 peerId / isHost / hostPeerId。回傳 reply。
    join() {
      return new Promise((resolve) => {
        this.socket.emit('p2p_join', { roomId: this.roomId, role: this.role }, (reply) => {
          reply = reply || {};
          this.peerId = reply.peerId;
          this.isHost = !!reply.isHost;
          this.hostPeerId = reply.hostPeerId || null;
          resolve(reply);
        });
      });
    }

    close() {
      try { this.socket.emit('p2p_leave', { roomId: this.roomId }); } catch (e) {}
      for (const [, p] of this.peers) { try { p.pc.close(); } catch (e) {} }
      this.peers.clear();
    }

    // ── 內部:信令 ──────────────────────────────────────────────
    _bindSignal() {
      // host:有新 peer 進來 → 主動建連 + 發 offer
      this.socket.on('p2p_peer_joined', (m) => { if (this.isHost && m && m.peerId) this._hostConnect(m.peerId); });
      // 收到 offer/answer/candidate
      this.socket.on('p2p_signal', (m) => { if (m) this._onSignal(m.fromPeerId, m.data); });
      // 對方離開
      this.socket.on('p2p_peer_left', (m) => { if (m) this._dropPeer(m.peerId); });
    }

    _signal(toPeerId, data) { this.socket.emit('p2p_signal', { toPeerId: toPeerId, data: data }); }

    _newPC(peerId) {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      pc.onicecandidate = (e) => { if (e.candidate) this._signal(peerId, { candidate: e.candidate }); };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'failed' || st === 'closed' || st === 'disconnected') this._dropPeer(peerId);
      };
      return pc;
    }

    // host 端:對新 peer 建 pc + DataChannel + offer
    async _hostConnect(peerId) {
      if (this.peers.has(peerId)) return;
      const pc = this._newPC(peerId);
      const channel = pc.createDataChannel('game', { ordered: true });
      const entry = { pc, channel, open: false, pending: [] };
      this.peers.set(peerId, entry);
      this._wireChannel(peerId, channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this._signal(peerId, { sdp: pc.localDescription });
    }

    async _onSignal(fromPeerId, data) {
      if (!data) return;
      let entry = this.peers.get(fromPeerId);
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          // client 端:收到 host 的 offer → 建 pc、setRemote、answer;DataChannel 由對方 createDataChannel 帶來
          const pc = this._newPC(fromPeerId);
          entry = { pc, channel: null, open: false, pending: [] };
          this.peers.set(fromPeerId, entry);
          this.hostPeerId = fromPeerId;                     // 對 client 而言,發 offer 的就是 host
          pc.ondatachannel = (e) => this._wireChannel(fromPeerId, e.channel);
          await pc.setRemoteDescription(data.sdp);
          await this._flushPending(fromPeerId);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this._signal(fromPeerId, { sdp: pc.localDescription });
        } else if (data.sdp.type === 'answer' && entry) {
          await entry.pc.setRemoteDescription(data.sdp);
          await this._flushPending(fromPeerId);
        }
      } else if (data.candidate) {
        if (entry && entry.pc && entry.pc.remoteDescription && entry.pc.remoteDescription.type) {
          try { await entry.pc.addIceCandidate(data.candidate); } catch (e) {}
        } else {
          // remoteDescription 還沒設好 → 先排隊,設好後再補
          if (!entry) { entry = { pc: null, channel: null, open: false, pending: [] }; this.peers.set(fromPeerId, entry); }
          entry.pending.push(data.candidate);
        }
      }
    }

    async _flushPending(peerId) {
      const entry = this.peers.get(peerId);
      if (!entry || !entry.pc || !entry.pending.length) return;
      const q = entry.pending.splice(0);
      for (const c of q) { try { await entry.pc.addIceCandidate(c); } catch (e) {} }
    }

    _wireChannel(peerId, channel) {
      const entry = this.peers.get(peerId) || { pc: null, open: false, pending: [] };
      entry.channel = channel;
      this.peers.set(peerId, entry);
      channel.onopen = () => { entry.open = true; for (const cb of this._openCbs) try { cb(peerId); } catch (e) {} };
      channel.onclose = () => { entry.open = false; for (const cb of this._closeCbs) try { cb(peerId); } catch (e) {} };
      channel.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
        const s = this._handlers.get(msg.event);
        if (s) for (const cb of s) { try { cb(msg.data, peerId); } catch (err) {} }
      };
    }

    _dropPeer(peerId) {
      const p = this.peers.get(peerId);
      if (!p) return;
      try { p.pc && p.pc.close(); } catch (e) {}
      this.peers.delete(peerId);
      for (const cb of this._closeCbs) try { cb(peerId); } catch (e) {}
    }

    _send(id, event, data) {
      const payload = JSON.stringify({ event: event, data: data });
      const sendTo = (p) => { if (p && p.open && p.channel && p.channel.readyState === 'open') { try { p.channel.send(payload); } catch (e) {} } };
      if (id === this.roomId || id === '*' || id == null) {
        for (const [, p] of this.peers) sendTo(p);       // 廣播給全部已連 peer
      } else {
        sendTo(this.peers.get(id));                       // 定向
      }
    }
  }

  global.P2PNode = P2PNode;
})(typeof window !== 'undefined' ? window : this);

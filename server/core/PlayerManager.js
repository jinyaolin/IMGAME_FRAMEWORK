'use strict';

class PlayerState {
  constructor(playerId, name, socketId) {
    this.id = playerId;
    this.name = name;
    this.socketId = socketId;
    this.role = 'player';
    this.playerNumber = null;   // Assigned by module when game starts
    this.hand = [];
    this.score = 0;
    this.isReady = false;      // 業務邏輯：判斷遊戲是否能開始
    this.isConnected = true;   // 業務邏輯：判斷玩家是否在線
    this.isAlive = true;       // 業務邏輯：判斷玩家是否存活
    this.moduleData = {};
    this.attributes = {}; // host-settable key/value pairs from module's playerAttributes
    this.status = 'waiting';    // 顯示用：統一的狀態欄位
    this.joinedAt = Date.now();
  }

  toPublic() {
    const publicData = {
      id: this.id,
      name: this.name,
      playerNumber: this.playerNumber,
      score: this.score,
      isReady: this.isReady,           // 保留業務邏輯 flag
      isConnected: this.isConnected,   // 保留業務邏輯 flag
      isAlive: this.isAlive,          // 保留業務邏輯 flag
      handCount: this.hand.length,
      status: this.status,            // 顯示用統一狀態
      attributes: this.attributes,
    };
    console.log(`[PlayerManager] toPublic for ${this.name}: playerNumber=${this.playerNumber}`);
    return publicData;
  }

  toPrivate() {
    return {
      id: this.id,
      name: this.name,
      score: this.score,
      isReady: this.isReady,
      hand: this.hand,
      moduleData: this.moduleData,
    };
  }
}

class PlayerManager {
  constructor() {
    this.players = new Map();
  }

  add(playerId, name, socketId) {
    const player = new PlayerState(playerId, name, socketId);
    this.players.set(playerId, player);
    return player;
  }

  get(playerId) {
    return this.players.get(playerId);
  }

  getBySocketId(socketId) {
    for (const player of this.players.values()) {
      if (player.socketId === socketId) return player;
    }
    return null;
  }

  remove(playerId) {
    this.players.delete(playerId);
  }

  reconnect(playerId, newSocketId) {
    const player = this.players.get(playerId);
    if (player) {
      player.socketId = newSocketId;
      player.isConnected = true;
    }
    return player;
  }

  disconnect(playerId) {
    const player = this.players.get(playerId);
    if (player) player.isConnected = false;
    return player;
  }

  all() {
    return Array.from(this.players.values());
  }

  count() {
    return this.players.size;
  }

  publicList() {
    return this.all().map(p => p.toPublic());
  }
}

module.exports = { PlayerManager, PlayerState };

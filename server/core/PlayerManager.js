'use strict';

class PlayerState {
  constructor(playerId, name, socketId) {
    this.id = playerId;
    this.name = name;
    this.socketId = socketId;
    this.role = 'player';
    this.hand = [];
    this.score = 0;
    this.isReady = false;
    this.isConnected = true;
    this.moduleData = {};
    this.joinedAt = Date.now();
  }

  toPublic() {
    return {
      id: this.id,
      name: this.name,
      score: this.score,
      isReady: this.isReady,
      isConnected: this.isConnected,
      handCount: this.hand.length,
    };
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

/**
 * VoteDemoModule - 投票系統演示模組
 *
 * 此模組展示了如何使用 BaseModule 的內置投票系統進行玩家淘汰
 * 這是一個簡化的實作，依賴 BaseModule 的階段管理和投票功能
 */

const BaseModule = require('../core/BaseModule');

class VoteDemoModule extends BaseModule {
  constructor(manifest, session, config) {
    super(manifest, session, config);
    // 構造函數不需要額外邏輯，BaseModule 會處理所有初始化
  }

  /**
   * 當投票結束時的回調
   * 這個方法會被 BaseModule 自動調用
   */
  async onVoteEnded(session, results, voteConfig) {
    console.log('[VoteDemo] Vote ended:', results);

    // 檢查是否還有足夠的玩家繼續
    const alivePlayers = this.players.filter(p => p.isAlive !== false);
    console.log('[VoteDemo] Alive players:', alivePlayers.length);

    if (alivePlayers.length <= 1) {
      // 遊戲結束，只有一個或少於一個玩家存活
      console.log('[VoteDemo] Game should end - not enough players');
      // BaseModule 會自動處理遊戲結束邏輯
      return;
    }

    console.log('[VoteDemo] Game continues - enough players');
  }

  /**
   * 當玩家被淘汰時的回調
   * 這個方法會被 BaseModule 自動調用
   */
  async onPlayerEliminated(session, playerId) {
    console.log('[VoteDemo] Player eliminated:', playerId);
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      session.broadcastAll('toast', {
        message: `${player.name} 被淘汰了！`
      });
    }
  }
}

module.exports = VoteDemoModule;

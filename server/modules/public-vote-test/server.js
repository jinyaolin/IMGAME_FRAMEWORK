/**
 * PublicVoteTestModule - 公開投票測試模組
 *
 * 測試公開投票功能，驗證投票結果顯示正確
 */

const BaseModule = require('../core/BaseModule');

class PublicVoteTestModule extends BaseModule {
  constructor(manifest, session, config) {
    super(manifest, session, config);
  }

  /**
   * 當投票結束時的回調
   */
  async onVoteEnded(session, results, voteConfig) {
    console.log('[PublicVoteTest] Vote ended:', results);

    // 檢查是否還有足夠的玩家繼續
    const alivePlayers = this.players.filter(p => p.isAlive !== false);
    console.log('[PublicVoteTest] Alive players:', alivePlayers.length);

    if (alivePlayers.length <= 1) {
      console.log('[PublicVoteTest] Game should end - not enough players');
      return;
    }
  }

  /**
   * 當玩家被淘汰時的回調
   */
  async onPlayerEliminated(session, playerId) {
    console.log('[PublicVoteTest] Player eliminated:', playerId);
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      session.broadcastAll('toast', {
        message: `${player.name} 被淘汰了！`
      });
    }
  }
}

module.exports = PublicVoteTestModule;

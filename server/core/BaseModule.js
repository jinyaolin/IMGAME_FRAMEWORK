'use strict';

/**
 * Base Game Module
 * 一個完整的遊戲模組引擎，支援卡牌遊戲、回合制、階段推進等功能
 *
 * 使用說明：
 * 1. 在 manifest.json 中定義 stages 和 decks
 * 2. 覆寫 onPlayerAction 處理特定遊戲邏輯
 * 3. 覆寫其他方法來自定義行為
 */

class BaseModule {
  constructor(manifest, session, config) {
    this.manifest = manifest;
    this.session = session;
    this.config = config;
    this.cfg = config; // alias for convenience

    // Get enabled stages from manifest
    this.enabledStages = (manifest.stages || []).filter(s => s.enabled);
    this.stageIndex = 0;
    this.currentStageId = null;

    // Card game state
    this.playerHands = new Map(); // playerId -> array of cards
    this.playedCards = new Map();  // playerId -> played card (or null)
    this.decks = new Map();        // deckId -> array of cards

    // Identity/Role state
    this.playerIdentities = new Map(); // playerId -> identity card
    this.confirmedPlayers = new Set(); // players who confirmed identity

    // Round management
    this.roundNumber = 1;
    this._isRevealed = false; // Tracks if cards have been revealed this round

    // Timers
    this._countdownTimer = null;
    this._autoAdvanceTimer = null;

    console.log('[BaseModule] Initialized with', this.enabledStages.length, 'stages');
  }

  async onStart(players, session) {
    console.log('[BaseModule] Game started with', players.length, 'players');
    this.players = players;
    this.stageIndex = 0;
    this.roundNumber = 1;
    this.playerHands.clear();
    this.playedCards.clear();
    this.decks.clear();
    this.playerIdentities.clear();
    this.confirmedPlayers.clear();

    // Initialize decks from manifest
    if (this.manifest.decks) {
      for (const deck of this.manifest.decks) {
        if (deck.enabled) {
          this.decks.set(deck.id, this._shuffleDeck([...deck.cards]));
        }
      }
    }

    // Send game_started event to notify clients
    session.broadcastAll('game_started', {
      module: this.manifest.id,
      sharedState: {}
    });

    await this._startCurrentStage(session);
  }

  async _startCurrentStage(session) {
    if (this.stageIndex >= this.enabledStages.length) {
      console.log('[BaseModule] All stages completed');
      session.broadcastAll('game_complete', {});
      return;
    }

    const stage = this.enabledStages[this.stageIndex];
    this.currentStageId = stage.id;

    console.log('[BaseModule] Starting stage:', stage.id, '-', stage.name, '(' + stage.type + ')');

    // Reset playedCards for new stage (set to null for each player, not clear)
    for (const player of this.players) {
      this.playedCards.set(player.id, null);
    }

    // Reset round number if starting a new card_play stage
    if (stage.type === 'card_play') {
      this.roundNumber = 1;
    }

    // Notify all clients that stage started
    session.broadcastAll('stage_started', {
      stageId: stage.id,
      stageName: stage.name,
      stageType: stage.type,
      stageIndex: this.stageIndex,
      roundNumber: this.roundNumber
    });

    // Handle identity_draw stage - assign identities
    if (stage.type === 'identity_draw' && stage.deckId) {
      await this._assignIdentities(session, stage);
    }

    // Handle card_play stage - deal cards
    if (stage.type === 'card_play' && stage.deckId) {
      await this._dealCards(session, stage);
    }

    // If it's a result stage, send game_ended event
    if (stage.type === 'result') {
      // Calculate rankings
      const ranked = (this.players || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
      const maxScore = ranked.length > 0 ? (ranked[0].score || 0) : 0;
      const champions = ranked.filter(p => (p.score || 0) === maxScore).map(p => p.name);

      session.broadcastAll('game_ended', {
        champions: champions,
        ranked: ranked.map(p => ({
          id: p.id,
          name: p.name,
          score: p.score || 0
        }))
      });

      // Send to display with formatted HTML
      session.broadcastDisplay('game_ended', {
        displayHtml: this._formatResultsForDisplay(champions, ranked)
      });

      // Handle restart_timer if present
      if (stage.advance && stage.advance.trigger === 'restart_timer') {
        const duration = stage.advance.duration || 5;
        console.log('[BaseModule] Starting restart timer:', duration, 'seconds');

        this._startCountdown(session, duration, async () => {
          console.log('[BaseModule] Restart timer ended, restarting game');
          await this._restartGame(session);
        });
      }
    }

    // Update host with current state
    session.sendHostGameState();
  }

  async onPlayerAction(playerId, action, data, session) {
    console.log('[BaseModule] Player action:', playerId, action, data);

    // Handle identity confirmation for identity_draw stages
    if (action === 'confirm_identity' && this.currentStageId) {
      const stage = this.enabledStages[this.stageIndex];
      if (stage && stage.type === 'identity_draw') {
        this._confirmIdentity(playerId, session);
      }
    }

    // Handle card playing for card_play stages
    if (action === 'play_card' && this.currentStageId) {
      const stage = this.enabledStages[this.stageIndex];
      if (stage && stage.type === 'card_play') {
        await this._handleCardPlay(playerId, data, session);
      }
    }

    // Override this method to handle custom actions
  }

  _startCountdown(session, duration, onComplete) {
    // Clear any existing countdown timer
    if (this._countdownTimer) {
      clearTimeout(this._countdownTimer);
      this._countdownTimer = null;
      console.log('[BaseModule] Cleared previous countdown timer');
    }

    let remaining = duration;
    const total = duration;

    const broadcast = () => {
      // Always broadcast, including when remaining = 0 to clear the countdown display
      session.broadcastAll('countdown', { remaining, total });

      if (remaining > 0) {
        remaining--;
        this._countdownTimer = setTimeout(broadcast, 1000);
      } else {
        // Countdown reached 0, execute completion callback
        if (onComplete) {
          onComplete();
        }
      }
    };

    broadcast();
  }

  async _restartGame(session) {
    console.log('[BaseModule] Restarting game with same module');
    console.log('[BaseModule] Current state:', {
      stageIndex: this.stageIndex,
      roundNumber: this.roundNumber,
      hasCountdown: !!this._countdownTimer,
      hasAutoAdvance: !!this._autoAdvanceTimer
    });

    // Clear any pending timers
    if (this._countdownTimer) {
      clearTimeout(this._countdownTimer);
      this._countdownTimer = null;
      console.log('[BaseModule] Cleared countdown timer');
    }
    if (this._autoAdvanceTimer) {
      // If it's a timeout, clear it
      if (typeof this._autoAdvanceTimer === 'object') {
        clearTimeout(this._autoAdvanceTimer);
      }
      this._autoAdvanceTimer = null;
      console.log('[BaseModule] Cleared auto-advance timer');
    }

    // Reset all game state
    this.stageIndex = 0;
    this.roundNumber = 1;
    this.playerHands.clear();
    this.playedCards.clear();
    this.playerIdentities.clear();
    this.confirmedPlayers.clear();

    // Reset player scores
    for (const p of this.players) {
      p.score = 0;
    }

    console.log('[BaseModule] Game state reset, starting from stage 0');

    // Broadcast game_started to notify clients (especially Host to switch panels)
    session.broadcastAll('game_started', {
      module: this.manifest.id,
      sharedState: {}
    });

    // Start first stage
    await this._startCurrentStage(session);
  }

  async _nextRound(session) {
    const stage = this.enabledStages[this.stageIndex];
    if (!stage) return;

    const roundConfig = {
      maxRounds: stage.maxRounds || 5
    };

    console.log('[BaseModule] Starting next round');

    // Reset revealed flag to allow card plays in new round
    this._isRevealed = false;

    // Clear countdown timer
    if (this._countdownTimer) {
      clearTimeout(this._countdownTimer);
      this._countdownTimer = null;
    }

    // Clear auto-advance flag
    if (this._autoAdvanceTimer) {
      if (typeof this._autoAdvanceTimer === 'object') {
        clearTimeout(this._autoAdvanceTimer);
      }
      this._autoAdvanceTimer = null;
    }

    // Clear played cards
    for (const p of this.players) {
      this.playedCards.set(p.id, null);
    }

    this.roundNumber++;

    // Check if game should end
    if (this.roundNumber > roundConfig.maxRounds) {
      console.log('[BaseModule] Max rounds reached, ending stage');
      await this.onHostNextStage(session);
      return;
    }

    // TODO: Implement refillHands if needed (refillMode)

    // Notify players
    session.broadcastAll('round_started', {
      roundNumber: this.roundNumber,
      totalRounds: roundConfig.maxRounds
    });

    console.log('[BaseModule] Started round', this.roundNumber, 'of', roundConfig.maxRounds);

    // Update host
    session.sendHostGameState();
  }

  async onHostNextStage(session) {
    console.log('[BaseModule] Host requested next stage');

    // Check if current stage can be advanced
    const currentStage = this.enabledStages[this.stageIndex];
    if (!currentStage) return;

    // Move to next stage
    this.stageIndex++;

    if (this.stageIndex >= this.enabledStages.length) {
      console.log('[BaseModule] Game complete');
      session.broadcastAll('game_complete', {});
      return;
    }

    await this._startCurrentStage(session);
  }

  onPlayerDisconnected(playerId, session) {
    console.log('[BaseModule] Player disconnected:', playerId);
    // Override this method to handle player disconnect
  }

  getGameState() {
    return {
      stageIndex: this.stageIndex,
      currentStageId: this.currentStageId,
      roundNumber: this.roundNumber,
      totalStages: this.enabledStages.length
    };
  }

  getHostState() {
    const stage = this.enabledStages[this.stageIndex];
    const players = this.players || [];

    return {
      module: this.manifest.id,
      phase: stage?.type || 'unknown',
      phaseLabel: stage?.name || 'Unknown',
      round: this.roundNumber,
      maxRounds: stage?.maxRounds || 1,
      playerStates: players.map(p => ({
        id: p.id,
        name: p.name,
        isConnected: p.isConnected !== false,
        score: p.score || 0,
        handCount: this.playerHands.get(p.id)?.length || 0,
        hasPlayed: this.playedCards.get(p.id) !== null
      })),
      availableActions: ['end_game', 'restart']
    };
  }

  async onHostNextPhase(data, session) {
    const action = data?.action;
    console.log('[BaseModule] Host action:', action);

    if (action === 'end_game') {
      // Jump to result stage
      const resultIndex = this.enabledStages.findIndex(s => s.type === 'result');
      if (resultIndex >= 0) {
        this.stageIndex = resultIndex;
        await this._startCurrentStage(session);
      }
    } else if (action === 'restart') {
      // Restart game from the beginning
      console.log('[BaseModule] Restarting game');
      this.stageIndex = 0;
      this.roundNumber = 1;
      this.playerHands.clear();
      this.playedCards.clear();
      // Broadcast game_started to notify clients
      session.broadcastAll('game_started', {
        module: this.manifest.id,
        sharedState: {}
      });
      await this._startCurrentStage(session);
    } else if (action === 'back_to_lobby') {
      session.resetToLobby();
    }
  }

  // ── Card Game Helper Methods ────────────────────────────────────────

  async _assignIdentities(session, stage) {
    const deckId = stage.deckId;
    const deckConfig = this.manifest.decks?.find(d => d.id === deckId);

    if (!deckConfig) {
      console.error('[BaseModule] Deck config not found:', deckId);
      return;
    }

    const originalCards = deckConfig.cards || [];
    const allowDuplicate = deckConfig.allowDuplicate !== false;

    console.log('[BaseModule] Assigning identities from deck:', deckId);

    // Assign identity to each player
    for (const player of this.players) {
      let identity;

      if (allowDuplicate) {
        // With duplicates: randomly pick from original cards
        const randomIndex = Math.floor(Math.random() * originalCards.length);
        identity = { ...originalCards[randomIndex] }; // Clone to avoid mutation
      } else {
        // Without duplicates: use deck from storage
        let deck = this.decks.get(deckId);
        if (!deck || deck.length === 0) {
          console.error('[BaseModule] No cards left in deck for identities');
          return;
        }
        identity = deck.pop();
        this.decks.set(deckId, deck);
      }

      // Add unique instance ID
      identity._instanceId = player.id + '-identity-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

      // Map image field to imagePath for mobile compatibility
      if (identity.image && !identity.imagePath) {
        identity.imagePath = identity.image;
      }

      this.playerIdentities.set(player.id, identity);

      // Send identity to player
      session.sendToPlayer(player.id, 'identity_assigned', {
        card: identity
      });
    }

    console.log('[BaseModule] Identities assigned to', this.players.length, 'players');
  }

  _confirmIdentity(playerId, session) {
    console.log('[BaseModule] Player confirmed identity:', playerId);
    this.confirmedPlayers.add(playerId);

    // Check if all players have confirmed
    const stage = this.enabledStages[this.stageIndex];
    if (stage?.advance?.trigger === 'all_confirmed') {
      const allConfirmed = this.players.every(p => this.confirmedPlayers.has(p.id));
      if (allConfirmed) {
        console.log('[BaseModule] All players confirmed identity, auto-advancing');
        setTimeout(() => {
          this.onHostNextStage(session);
        }, 1000);
      }
    }

    // Update host state
    session.sendHostGameState();
  }

  _shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  async _dealCards(session, stage) {
    // Reset revealed flag when dealing new cards
    this._isRevealed = false;

    const deckId = stage.deckId;
    const deckConfig = this.manifest.decks?.find(d => d.id === deckId);

    if (!deckConfig) {
      console.error('[BaseModule] Deck config not found:', deckId);
      return;
    }

    const originalCards = deckConfig.cards || [];
    const allowDuplicate = deckConfig.allowDuplicate !== false;
    const drawCount = deckConfig.drawCount || 1;

    console.log('[BaseModule] Dealing cards from deck:', deckId, 'count:', drawCount);

    // Build a deck pool large enough for all players
    const totalCardsNeeded = this.players.length * drawCount;
    let deckCards = [];

    if (allowDuplicate || originalCards.length >= totalCardsNeeded) {
      // Create a large enough pool by duplicating the deck if needed
      const copiesNeeded = Math.ceil(totalCardsNeeded / originalCards.length);
      for (let i = 0; i < copiesNeeded; i++) {
        deckCards = deckCards.concat(originalCards.map(c => ({...c})));
      }
      deckCards = this._shuffleDeck(deckCards);
    } else {
      // No duplicates allowed and not enough cards - use what we have
      deckCards = this._shuffleDeck([...originalCards]);
    }

    // Deal cards to each player
    for (const player of this.players) {
      const hand = [];

      for (let i = 0; i < drawCount; i++) {
        if (deckCards.length > 0) {
          const card = deckCards.pop();
          // Add unique instance ID
          card._instanceId = `${player.id}-${i}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          // Map image field to imagePath for mobile compatibility
          if (card.image && !card.imagePath) {
            card.imagePath = card.image;
          }
          hand.push(card);
        }
      }

      this.playerHands.set(player.id, hand);
      this.playedCards.set(player.id, null);

      // Send cards to player
      session.sendToPlayer(player.id, 'cards_drawn', {
        hand: hand
      });

      console.log('[BaseModule] Dealt', hand.length, 'cards to', player.id);
    }

    // Notify host
    session.sendHostGameState();
  }

  async _handleCardPlay(playerId, data, session) {
    // Prevent playing cards after reveal (during countdown)
    if (this._isRevealed) {
      console.log('[BaseModule] Rejecting card play - cards already revealed');
      session.sendToPlayer(playerId, 'card_rejected', {
        reason: 'cards_already_revealed',
        message: '已翻牌，等待下一回合'
      });
      return;
    }

    // Prevent playing more than one card per round
    const alreadyPlayed = this.playedCards.get(playerId);
    if (alreadyPlayed !== null && alreadyPlayed !== undefined) {
      console.log('[BaseModule] Rejecting card play - player already played this round');
      session.sendToPlayer(playerId, 'card_rejected', {
        reason: 'already_played',
        message: '本回合已出牌'
      });
      return;
    }

    // Support both cardId and instanceId
    const instanceId = data?.cardId || data?.instanceId;

    if (!instanceId) {
      console.error('[BaseModule] play_card missing cardId/instanceId');
      return;
    }

    const hand = this.playerHands.get(playerId);
    if (!hand) {
      console.error('[BaseModule] No hand found for player:', playerId);
      return;
    }

    // Find card in hand
    const cardIndex = hand.findIndex(c => c._instanceId === instanceId);
    if (cardIndex === -1) {
      console.error('[BaseModule] Card not found in hand:', instanceId);
      return;
    }

    const card = hand[cardIndex];

    // Remove from hand
    hand.splice(cardIndex, 1);
    this.playerHands.set(playerId, hand);

    // Record played card
    this.playedCards.set(playerId, card);

    // Send acceptance to player
    session.sendToPlayer(playerId, 'card_accepted', {
      instanceId: instanceId
    });

    // Broadcast card played (without revealing card content)
    session.broadcastAll('card_played', {
      playerId: playerId,
      cardIndex: cardIndex
    });

    console.log('[BaseModule] Player', playerId, 'played card', card.name);

    // Get current stage configuration
    const stage = this.enabledStages[this.stageIndex];

    // Check revealTrigger for automatic reveal
    const revealTrigger = stage?.revealTrigger;
    const trigger = revealTrigger?.trigger;

    if (trigger === 'all_played') {
      // Auto-reveal when all players have played
      const allPlayed = this.players.every(p => this.playedCards.get(p.id) !== null);
      if (allPlayed) {
        console.log('[BaseModule] All players played, auto-revealing');
        setTimeout(() => {
          this._revealCards(session);
        }, 1000); // Small delay for visual effect
      }
    } else if (trigger === 'host') {
      // Notify host to trigger reveal
      const allPlayed = this.players.every(p => this.playedCards.get(p.id) !== null);
      if (allPlayed) {
        console.log('[BaseModule] All played, waiting for host to reveal');
        session.broadcastDisplay('all_played', {
          canReveal: true
        });
      }
    }

    // Check if all players have played (for auto-advance)
    if (stage?.advance?.trigger === 'all_played') {
      const allPlayed = this.players.every(p => this.playedCards.get(p.id) !== null);
      if (allPlayed) {
        console.log('[BaseModule] All players played, scheduling auto-advance');
        // Auto-advance will be handled after reveal
      }
    }

    // Update host state
    session.sendHostGameState();
  }

  async _revealCards(session) {
    // Mark as revealed to prevent further card plays during countdown
    this._isRevealed = true;

    const cards = [];
    for (const [playerId, card] of this.playedCards) {
      if (card) {
        // Ensure imagePath is set for mobile compatibility
        if (card.image && !card.imagePath) {
          card.imagePath = card.image;
        }
        cards.push({
          playerId: playerId,
          card: card
        });
      }
    }

    // Calculate scores if cards have value
    const cardsWithValue = cards.filter(c => c.card.value !== undefined);
    if (cardsWithValue.length > 0) {
      const maxValue = Math.max(...cardsWithValue.map(c => c.card.value));
      console.log('[BaseModule] Scoring: maxValue =', maxValue, 'from', cardsWithValue.length, 'cards');
      // Award points to winners
      for (const item of cardsWithValue) {
        if (item.card.value === maxValue) {
          const player = this.players.find(p => p.id === item.playerId);
          if (player) {
            player.score = (player.score || 0) + 1;
            console.log('[BaseModule]', player.name, 'wins point, score:', player.score);
          }
        }
      }
    }

    session.broadcastAll('cards_revealed', {
      cards: cards
    });

    // Send to display with formatted HTML
    session.broadcastDisplay('cards_revealed', {
      displayHtml: this._formatCardsForDisplay(cards)
    });

    console.log('[BaseModule] Revealed', cards.length, 'cards');

    // Get current stage configuration
    const stage = this.enabledStages[this.stageIndex];

    // Check nextRoundTrigger for auto-advance to next round
    if (stage?.nextRoundTrigger && !this._autoAdvanceTimer) {
      const trigger = stage.nextRoundTrigger.trigger;
      const duration = stage.nextRoundTrigger.duration || 3;

      if (trigger === 'round_timer') {
        // Auto-advance after timer
        console.log('[BaseModule] Will auto-advance to next round in', duration, 'seconds');

        // Set flag to prevent multiple countdowns
        this._autoAdvanceTimer = true;

        // Start countdown and auto-advance when done
        this._startCountdown(session, duration, async () => {
          console.log('[BaseModule] Countdown ended, auto-advancing to next round');
          this._autoAdvanceTimer = null;
          await this._nextRound(session);
        });
      } else if (trigger === 'host') {
        // Wait for host to advance
        console.log('[BaseModule] Waiting for host to advance to next round');
        session.broadcastDisplay('round_end', {
          roundNumber: this.roundNumber,
          canAdvance: true
        });
      }
    }

    // Check if should auto-advance to next stage (fallback)
    if (stage?.advance?.trigger === 'all_played') {
      const autoAdvance = stage.advance.autoAdvance !== false;
      const delay = stage.advance.delay || 2000;

      if (autoAdvance && !this._autoAdvanceTimer) {
        console.log('[BaseModule] Auto-advancing to next stage in', delay, 'ms');
        this._autoAdvanceTimer = setTimeout(() => {
          this._autoAdvanceTimer = null;
          this.onHostNextStage(session);
        }, delay);
      }
    }
  }

  _formatCardsForDisplay(cards) {
    if (!cards || cards.length === 0) {
      return '<div style="color:#8888aa;text-align:center;padding:40px;">沒有卡牌</div>';
    }

    const playerNames = {};
    for (const card of cards) {
      const player = this.players?.find(p => p.id === card.playerId);
      playerNames[card.playerId] = player ? player.name : card.playerId;
    }

    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;padding:40px;align-items:center;">';

    for (const item of cards) {
      const playerName = playerNames[item.playerId] || item.playerId;
      const card = item.card;

      // Check if card has an image (support both image and imagePath fields)
      const cardImage = (card.imagePath || card.image) ?
        `<img src="${card.imagePath || card.image}" alt="${card.name}" style="width:100%;height:180px;object-fit:cover;border-radius:8px;margin-bottom:12px;">` :
        `<div style="font-size:3rem;margin-bottom:16px;">🎴</div>`;

      html += `
        <div style="background:#14142a;border:2px solid #5555ff;border-radius:16px;padding:24px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
          ${cardImage}
          <div style="font-size:1.2rem;color:#8888bb;margin-bottom:8px;">${playerName}</div>
          <div style="font-size:1.8rem;font-weight:700;color:#fff;margin-bottom:8px;">${card.name || '—'}</div>
          ${card.value !== undefined ? `<div style="font-size:1.4rem;color:#ffdd44;margin-bottom:8px;">⭐ ${card.value}</div>` : ''}
          ${card.team ? `<div style="font-size:0.9rem;color:#aaaacc;padding:4px 12px;background:#333355;border-radius:12px;display:inline-block;">${card.team}</div>` : ''}
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  _formatResultsForDisplay(champions, ranked) {
    if (!ranked || ranked.length === 0) {
      return '<div style="color:#8888aa;text-align:center;padding:40px;">沒有排名數據</div>';
    }

    let html = '<div style="padding:40px;text-align:center;">';

    // Champions
    if (champions && champions.length > 0) {
      html += '<div style="margin-bottom:32px;">';
      html += '<div style="font-size:1rem;color:#8888bb;margin-bottom:12px;">🏆 冠軍</div>';
      html += '<div style="font-size:2.5rem;font-weight:700;color:#ffdd44;">' + champions.join('、') + '</div>';
      html += '</div>';
    }

    // Rankings
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;max-width:800px;margin:0 auto;">';

    for (let i = 0; i < ranked.length; i++) {
      const player = ranked[i];
      const isChampion = champions && champions.includes(player.name);
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

      html += `
        <div style="background:${isChampion ? 'linear-gradient(135deg,#1a1a3a 0%,#2a2a5a 100%)' : '#14142a'};border:${isChampion ? '2px solid #ffdd44' : '1px solid #3a3a6a'};border-radius:16px;padding:20px;text-align:center;">
          <div style="font-size:1.5rem;margin-bottom:8px;">${medal}</div>
          <div style="font-size:1.1rem;font-weight:700;color:#fff;margin-bottom:8px;">${player.name}</div>
          <div style="font-size:1.4rem;color:#ffdd44;font-weight:700;">${player.score || 0} 分</div>
        </div>
      `;
    }

    html += '</div></div>';
    return html;
  }
}

module.exports = BaseModule;

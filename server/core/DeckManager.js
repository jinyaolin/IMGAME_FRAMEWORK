const fs = require('fs').promises;
const path = require('path');

/**
 * 全局卡牌管理器
 * 管理所有遊戲模組共享的卡牌數據
 */
class DeckManager {
  constructor(decksDir) {
    this.decksDir = decksDir;
    this.decks = new Map(); // deckId -> deck data
    this.initialized = false;
  }

  /**
   * 初始化卡牌管理器，載入所有卡牌
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.decksDir, { recursive: true });

      const files = await fs.readdir(this.decksDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.decksDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const deck = JSON.parse(content);
          this.decks.set(deck.id, deck);
        } catch (err) {
          console.error(`[DeckManager] Failed to load deck ${file}:`, err.message);
        }
      }

      this.initialized = true;
      console.log(`[DeckManager] Loaded ${this.decks.size} shared decks`);
    } catch (err) {
      console.error('[DeckManager] Initialization failed:', err);
      throw err;
    }
  }

  /**
   * 獲取所有卡牌列表
   */
  getAllDecks() {
    return Array.from(this.decks.values());
  }

  /**
   * 根據 ID 獲取卡牌
   */
  getDeck(deckId) {
    return this.decks.get(deckId);
  }

  /**
   * 創建新卡牌
   */
  async createDeck(deckData) {
    if (!deckData.id) {
      throw new Error('Deck ID is required');
    }

    if (this.decks.has(deckData.id)) {
      throw new Error(`Deck ${deckData.id} already exists`);
    }

    // 驗證卡牌數據
    this._validateDeck(deckData);

    // 添加時間戳
    deckData.createdAt = new Date().toISOString();
    deckData.updatedAt = new Date().toISOString();

    // 保存到文件
    await this._saveDeck(deckData);

    // 加入內存
    this.decks.set(deckData.id, deckData);

    console.log(`[DeckManager] Created deck: ${deckData.id}`);
    return deckData;
  }

  /**
   * 更新卡牌
   */
  async updateDeck(deckId, updates) {
    const deck = this.decks.get(deckId);
    if (!deck) {
      throw new Error(`Deck ${deckId} not found`);
    }

    // 合併更新
    const updated = { ...deck, ...updates, id: deckId };
    updated.updatedAt = new Date().toISOString();

    // 驗證
    this._validateDeck(updated);

    // 保存
    await this._saveDeck(updated);

    // 更新內存
    this.decks.set(deckId, updated);

    console.log(`[DeckManager] Updated deck: ${deckId}`);
    return updated;
  }

  /**
   * 刪除卡牌
   */
  async deleteDeck(deckId) {
    if (!this.decks.has(deckId)) {
      throw new Error(`Deck ${deckId} not found`);
    }

    // 刪除文件
    const filePath = path.join(this.decksDir, `${deckId}.json`);
    await fs.unlink(filePath);

    // 從內存移除
    this.decks.delete(deckId);

    console.log(`[DeckManager] Deleted deck: ${deckId}`);
  }

  /**
   * 保存卡牌到文件
   */
  async _saveDeck(deck) {
    const filePath = path.join(this.decksDir, `${deck.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(deck, null, 2), 'utf-8');
  }

  /**
   * 驗證卡牌數據
   */
  _validateDeck(deck) {
    if (!deck.name) {
      throw new Error('Deck name is required');
    }

    if (!deck.type) {
      throw new Error('Deck type is required');
    }

    // Skip cards validation for deck references (they don't have local cards)
    if (deck.ref) {
      return;
    }

    if (!Array.isArray(deck.cards)) {
      throw new Error('Deck cards must be an array');
    }

    // 驗證每張卡牌
    const cardIds = new Set();
    for (const card of deck.cards) {
      if (!card.id) {
        throw new Error('Card must have an id');
      }

      if (cardIds.has(card.id)) {
        throw new Error(`Duplicate card id: ${card.id}`);
      }

      cardIds.add(card.id);
    }
  }

  /**
   * 獲取模組需要的所有卡牌
   * 根據模組 manifest 中的 deck 引用，返回完整的卡牌數據
   */
  getDecksForModule(moduleManifest) {
    if (!moduleManifest.decks) {
      return [];
    }

    return moduleManifest.decks
      .map(deckRef => {
        // 如果是引用，從全局載入
        if (deckRef.ref) {
          const globalDeck = this.getDeck(deckRef.ref);
          if (!globalDeck) {
            console.warn(`[DeckManager] Referenced deck not found: ${deckRef.ref}`);
            return null;
          }

          // 合併引用設置和全局卡牌
          return {
            ...globalDeck,
            ...deckRef,
            cards: globalDeck.cards
          };
        }

        // 如果是內聯卡牌，直接返回
        return deckRef;
      })
      .filter(deck => deck !== null);
  }

  /**
   * 將模組的內聯卡牌導出為全局卡牌
   */
  async exportDeckFromModule(moduleId, deckId) {
    const modulePath = path.join(__dirname, '../modules', moduleId);
    const manifestPath = path.join(modulePath, 'manifest.json');

    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    const deck = manifest.decks?.find(d => d.id === deckId);

    if (!deck) {
      throw new Error(`Deck ${deckId} not found in module ${moduleId}`);
    }

    // 創建全局卡牌副本
    const globalDeckId = `${moduleId}-${deckId}`;
    await this.createDeck({
      id: globalDeckId,
      name: deck.name,
      type: deck.type,
      description: `Exported from ${moduleId}`,
      ...deck,
      id: globalDeckId
    });

    return globalDeckId;
  }
}

module.exports = DeckManager;

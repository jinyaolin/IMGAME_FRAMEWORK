const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

const router = express.Router();

// 配置圖片上傳
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/cards');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 使用時間戳和原始檔名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `card-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB 限制
  },
  fileFilter: (req, file, cb) => {
    // 只允許圖片
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('只允許上傳圖片檔案 (jpeg, jpg, png, gif, webp)'));
    }
  }
});

/**
 * 初始化 DeckManager
 */
function setupDeckManager(server) {
  const DeckManager = require('../core/DeckManager');
  const decksDir = path.join(__dirname, '../decks');

  server.deckManager = new DeckManager(decksDir);
  server.deckManager.initialize().catch(err => {
    console.error('[API] Failed to initialize DeckManager:', err);
  });

  // 將 deckManager 掛載到路由
  router.use((req, res, next) => {
    req.deckManager = server.deckManager;
    next();
  });
}

/**
 * GET /api/decks
 * 獲取所有卡牌列表
 */
router.get('/', async (req, res) => {
  try {
    const decks = req.deckManager.getAllDecks();
    res.json({ success: true, decks });
  } catch (err) {
    console.error('[API] Failed to get decks:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/decks/:deckId
 * 獲取單個卡牌詳情
 */
router.get('/:deckId', async (req, res) => {
  try {
    const deck = req.deckManager.getDeck(req.params.deckId);

    if (!deck) {
      return res.status(404).json({ success: false, error: 'Deck not found' });
    }

    res.json({ success: true, deck });
  } catch (err) {
    console.error('[API] Failed to get deck:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/decks
 * 創建新卡牌
 */
router.post('/', async (req, res) => {
  try {
    const deck = await req.deckManager.createDeck(req.body);
    res.json({ success: true, deck });
  } catch (err) {
    console.error('[API] Failed to create deck:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/decks/:deckId
 * 更新卡牌
 */
router.put('/:deckId', async (req, res) => {
  try {
    const deck = await req.deckManager.updateDeck(req.params.deckId, req.body);
    res.json({ success: true, deck });
  } catch (err) {
    console.error('[API] Failed to update deck:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/decks/:deckId
 * 刪除卡牌
 */
router.delete('/:deckId', async (req, res) => {
  try {
    await req.deckManager.deleteDeck(req.params.deckId);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Failed to delete deck:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/decks/:deckId/cards
 * 添加卡牌到卡牌組
 */
router.post('/:deckId/cards', async (req, res) => {
  try {
    const deck = req.deckManager.getDeck(req.params.deckId);

    if (!deck) {
      return res.status(404).json({ success: false, error: 'Deck not found' });
    }

    // 檢查卡牌 ID 是否重複
    if (deck.cards.some(c => c.id === req.body.id)) {
      return res.status(400).json({ success: false, error: 'Card ID already exists' });
    }

    deck.cards.push(req.body);
    await req.deckManager.updateDeck(req.params.deckId, deck);

    res.json({ success: true, deck });
  } catch (err) {
    console.error('[API] Failed to add card:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/decks/:deckId/cards/:cardId
 * 更新卡牌
 */
router.put('/:deckId/cards/:cardId', async (req, res) => {
  try {
    const deck = req.deckManager.getDeck(req.params.deckId);

    if (!deck) {
      return res.status(404).json({ success: false, error: 'Deck not found' });
    }

    const cardIndex = deck.cards.findIndex(c => c.id === req.params.cardId);

    if (cardIndex === -1) {
      return res.status(404).json({ success: false, error: 'Card not found' });
    }

    deck.cards[cardIndex] = { ...deck.cards[cardIndex], ...req.body, id: req.params.cardId };
    await req.deckManager.updateDeck(req.params.deckId, deck);

    res.json({ success: true, deck });
  } catch (err) {
    console.error('[API] Failed to update card:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/decks/:deckId/cards/:cardId
 * 刪除卡牌
 */
router.delete('/:deckId/cards/:cardId', async (req, res) => {
  try {
    const deck = req.deckManager.getDeck(req.params.deckId);

    if (!deck) {
      return res.status(404).json({ success: false, error: 'Deck not found' });
    }

    deck.cards = deck.cards.filter(c => c.id !== req.params.cardId);
    await req.deckManager.updateDeck(req.params.deckId, deck);

    res.json({ success: true, deck });
  } catch (err) {
    console.error('[API] Failed to delete card:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/decks/:deckId/cards/:cardId/image
 * 上傳卡牌圖片
 */
router.post('/:deckId/cards/:cardId/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }

    const deck = req.deckManager.getDeck(req.params.deckId);

    if (!deck) {
      // 刪除已上傳的檔案
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ success: false, error: 'Deck not found' });
    }

    const card = deck.cards.find(c => c.id === req.params.cardId);

    if (!card) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ success: false, error: 'Card not found' });
    }

    // 如果已有圖片，刪除舊圖片
    if (card.image) {
      const oldImagePath = path.join(__dirname, '../../public', card.image);
      await fs.unlink(oldImagePath).catch(() => {});
    }

    // 保存圖片路徑 (相對於 public 目錄)
    card.image = `/uploads/cards/${req.file.filename}`;

    await req.deckManager.updateDeck(req.params.deckId, deck);

    res.json({
      success: true,
      card: {
        ...card,
        imageUrl: `${req.protocol}://${req.get('host')}${card.image}`
      }
    });
  } catch (err) {
    console.error('[API] Failed to upload image:', err);

    // 嘗試刪除已上傳的檔案
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/decks/export/:moduleId/:deckId
 * 從模組導出卡牌到全局
 */
router.post('/export/:moduleId/:deckId', async (req, res) => {
  try {
    const globalDeckId = await req.deckManager.exportDeckFromModule(
      req.params.moduleId,
      req.params.deckId
    );

    const deck = req.deckManager.getDeck(globalDeckId);

    res.json({ success: true, deck });
  } catch (err) {
    console.error('[API] Failed to export deck:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/decks/:deckId/back-image
 * 上傳卡牌背面圖片
 */
router.post('/:deckId/back-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }

    const deck = req.deckManager.getDeck(req.params.deckId);

    if (!deck) {
      // 刪除已上傳的檔案
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ success: false, error: 'Deck not found' });
    }

    // 如果已有背面圖片，刪除舊圖片
    if (deck.backImage) {
      const oldImagePath = path.join(__dirname, '../../public', deck.backImage);
      await fs.unlink(oldImagePath).catch(() => {});
    }

    // 保存背面圖片路徑 (相對於 public 目錄)
    deck.backImage = `/uploads/cards/${req.file.filename}`;

    await req.deckManager.updateDeck(req.params.deckId, deck);

    res.json({
      success: true,
      backImage: deck.backImage,
      backImageUrl: `${req.protocol}://${req.get('host')}${deck.backImage}`
    });
  } catch (err) {
    console.error('[API] Failed to upload back image:', err);

    // 嘗試刪除已上傳的檔案
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/decks/:deckId/back-image
 * 刪除卡牌背面圖片
 */
router.delete('/:deckId/back-image', async (req, res) => {
  try {
    const deck = req.deckManager.getDeck(req.params.deckId);

    if (!deck) {
      return res.status(404).json({ success: false, error: 'Deck not found' });
    }

    // 刪除背面圖片檔案
    if (deck.backImage) {
      const imagePath = path.join(__dirname, '../../public', deck.backImage);
      await fs.unlink(imagePath).catch(() => {});
    }

    // 移除背面圖片路徑
    deck.backImage = null;

    await req.deckManager.updateDeck(req.params.deckId, deck);

    res.json({ success: true });
  } catch (err) {
    console.error('[API] Failed to delete back image:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = { router, setupDeckManager };

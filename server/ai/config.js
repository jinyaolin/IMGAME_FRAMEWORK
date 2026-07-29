'use strict';

// AI 設定：讀 server/ai/ai-config.json（gitignored），環境變數可覆寫
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'ai-config.json');

function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* 沒設定檔 → 未配置 */ }
  return {
    apiKey:    process.env.KIMI_API_KEY    || file.apiKey    || '',
    baseUrl:   process.env.KIMI_BASE_URL   || file.baseUrl   || 'https://api.kimi.com/coding/v1',
    model:     process.env.KIMI_MODEL      || file.model     || 'k3',
    maxTokens: Number(process.env.KIMI_MAX_TOKENS || file.maxTokens || 32768),
  };
}

module.exports = { loadConfig, CONFIG_PATH };

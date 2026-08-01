// ============================================================
// 概念圖生成 — OpenAI Images API(gpt-image-2)薄封裝。
// Monster Lab 的 img2three 流程第一步:文字 → 概念參考圖。
// 金鑰:process.env.OPENAI_API_KEY 優先,否則讀 /root/codex/mock-image-api/.env
// (與既有 mock-image-api 代理共用同一把鑰,不另存一份)。
// ============================================================
const fs = require('fs');
const path = require('path');

const ENV_FALLBACK = '/root/codex/mock-image-api/.env';

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const txt = fs.readFileSync(ENV_FALLBACK, 'utf8');
    const m = txt.match(/^\s*OPENAI_API_KEY\s*=\s*['"]?([^'"\s]+)/m);
    if (m) return m[1];
  } catch (e) {}
  return null;
}

// 生成一張圖,回傳 { b64 }(PNG base64)。gpt-image-* 一律回 b64_json。
async function generateImage(opts) {
  const key = apiKey();
  if (!key) throw new Error('未設定 OPENAI_API_KEY(env 或 ' + ENV_FALLBACK + ')');
  const body = {
    model: opts.model || 'gpt-image-2',
    prompt: String(opts.prompt || '').trim(),
    n: 1,
    size: opts.size || '1024x1024',
    quality: opts.quality || 'medium',
  };
  if (!body.prompt) throw new Error('prompt 不可為空');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs || 180000);
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ('HTTP ' + r.status);
      throw new Error('圖片生成失敗:' + msg);
    }
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) throw new Error('圖片生成回應缺 b64_json');
    return { b64 };
  } finally { clearTimeout(timer); }
}

module.exports = { generateImage, apiKey };

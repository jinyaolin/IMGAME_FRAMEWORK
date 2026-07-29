'use strict';

// OpenAI 相容 chat completions 客戶端（Kimi coding endpoint）— 串流版
// 支援 tool calling；onProgress 回報生成進度（思考/工具參數/回覆內容）
// 回傳 message 結構與非串流版相同（含 reasoning_content / tool_calls）
const { loadConfig } = require('./config');

const TOTAL_TIMEOUT_MS = 900000;   // 單次請求總上限 15 分鐘（深度分析/長程式生成）
const IDLE_TIMEOUT_MS  = 150000;   // 串流靜默上限：150 秒沒有任何 chunk 才視為斷線
                                   // （k3 思考時 reasoning_content chunk 持續到達，不會誤觸）

async function chat(messages, tools, onProgress, abortSignal) {
  const cfg = loadConfig();
  if (!cfg.apiKey) throw new Error('尚未設定 Kimi API key（server/ai/ai-config.json）');
  if (abortSignal?.aborted) { const e = new Error('已中斷'); e.name = 'AbortError'; throw e; }

  const body = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    messages,
    stream: true,
  };
  if (tools && tools.length) body.tools = tools;

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TOTAL_TIMEOUT_MS);
    let idleTimer = null;
    const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => ac.abort(), IDLE_TIMEOUT_MS); };
    const onExternalAbort = () => ac.abort();
    if (abortSignal) abortSignal.addEventListener('abort', onExternalAbort, { once: true });
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          lastErr = new Error(`Kimi API ${res.status}: ${text.slice(0, 300)}`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw new Error(`Kimi API ${res.status}: ${text.slice(0, 300)}`);
      }

      // ── SSE 串流解析 ────────────────────────────────────────
      const msg = { role: 'assistant', content: '' };
      let reasoning = '';
      let finishReason = null;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      resetIdle();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch { continue; }
          const ch = json.choices && json.choices[0];
          if (!ch) continue;
          if (ch.finish_reason) finishReason = ch.finish_reason;
          const d = ch.delta || {};
          if (d.reasoning_content) {
            reasoning += d.reasoning_content;
            if (onProgress) onProgress({ kind: 'thinking', chars: reasoning.length, tail: reasoning.slice(-80) });
          }
          if (d.content) {
            msg.content += d.content;
            if (onProgress) onProgress({ kind: 'text', chars: msg.content.length });
          }
          if (Array.isArray(d.tool_calls)) {
            msg.tool_calls = msg.tool_calls || [];
            for (const tc of d.tool_calls) {
              const i = tc.index ?? 0;
              if (!msg.tool_calls[i]) msg.tool_calls[i] = { id: tc.id || `call_${i}`, type: 'function', function: { name: '', arguments: '' } };
              if (tc.id) msg.tool_calls[i].id = tc.id;
              if (tc.function?.name) msg.tool_calls[i].function.name += tc.function.name;
              if (tc.function?.arguments) msg.tool_calls[i].function.arguments += tc.function.arguments;
              if (onProgress) onProgress({
                kind: 'tool_building',
                name: msg.tool_calls[i].function.name,
                chars: msg.tool_calls[i].function.arguments.length,
              });
            }
          }
        }
      }

      if (reasoning) msg.reasoning_content = reasoning;
      if (msg.tool_calls) msg.tool_calls = msg.tool_calls.filter(Boolean);
      if (!msg.content && !msg.tool_calls && !reasoning) throw new Error('Kimi API 串流回應為空');
      return { message: msg, finishReason };
    } catch (e) {
      // 使用者主動中斷 → 直接拋出可辨識的錯誤，不重試
      if (abortSignal?.aborted) {
        const err = new Error('使用者中斷');
        err.name = 'UserAbort';
        throw err;
      }
      console.error('[AI] chat attempt', attempt, 'error:', e.name, e.message, e.cause || '');
      const isHttpErr = (e.message || '').startsWith('Kimi API');
      // DOMException（AbortError）的 message 是唯讀 → 一律包成新 Error，不可直接改
      let err = e;
      if (e.name === 'AbortError') err = new Error(`Kimi API 逾時（串流靜默 ${IDLE_TIMEOUT_MS / 1000}s 或總時長超過 ${TOTAL_TIMEOUT_MS / 60000} 分鐘）`);
      else if (!isHttpErr) err = new Error(`Kimi API 連線錯誤：${e.message || e.name || e}`);
      lastErr = err;
      // 逾時與網路層錯誤重試一次；HTTP 錯誤已在 try 內決定過（429/5xx 才 continue）
      if (attempt === 0 && !isHttpErr) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      clearTimeout(idleTimer);
      if (abortSignal) abortSignal.removeEventListener('abort', onExternalAbort);
    }
  }
  throw lastErr;
}

module.exports = { chat };

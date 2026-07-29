'use strict';

// 遊戲執行 log：display / mobile / 編輯器預覽回報，依模組聚合（ring buffer）
// 給 Kimi debug 用（read_game_logs 工具）
const buffers = new Map();   // moduleId → [{ts, src, level, msg}]
const CAP = 600;

function addLogs(moduleId, entries) {
  if (!buffers.has(moduleId)) buffers.set(moduleId, []);
  const buf = buffers.get(moduleId);
  for (const e of entries) {
    if (!e) continue;
    buf.push({
      ts: Number(e.ts) || Date.now(),
      src: String(e.src || '?').slice(0, 40),
      level: e.level === 'error' ? 'error' : 'log',
      msg: String(e.msg || '').slice(0, 500),
    });
  }
  if (buf.length > CAP) buf.splice(0, buf.length - CAP);
}

function getLogs(moduleId, limit = 120) {
  const buf = buffers.get(moduleId) || [];
  return buf.slice(-Math.min(Math.max(limit, 1), CAP));
}

function clearLogs(moduleId) {
  buffers.delete(moduleId);
}

module.exports = { addLogs, getLogs, clearLogs };

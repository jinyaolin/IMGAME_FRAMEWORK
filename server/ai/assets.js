'use strict';

// 素材加工：用無頭 Chrome 的 canvas 做裁切/縮放（保留 PNG 透明度）
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// srcUrl: http://127.0.0.1:port/uploads/assets/<rel>；回傳 { dataUrl, width, height }
async function transformImage({ srcUrl, crop, resize }) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    // 必須先導航到與圖片同源的頁面，否則 about:blank（opaque origin）載圖會污染 canvas，toDataURL 會拋 SecurityError
    await page.goto(new URL(srcUrl).origin + '/api/ai/status', { waitUntil: 'domcontentloaded', timeout: 10000 });
    const result = await page.evaluate(async (src, cropOpt, resizeOpt) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('圖片載入失敗'));
        i.src = src;
      });
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (cropOpt) {
        sx = Math.max(0, cropOpt.x | 0);
        sy = Math.max(0, cropOpt.y | 0);
        sw = Math.min(img.naturalWidth - sx, cropOpt.w | 0 || img.naturalWidth);
        sh = Math.min(img.naturalHeight - sy, cropOpt.h | 0 || img.naturalHeight);
        if (sw <= 0 || sh <= 0) throw new Error('crop 範圍超出圖片');
      }
      let dw = sw, dh = sh;
      if (resizeOpt) {
        const s = Math.min(
          resizeOpt.maxWidth ? resizeOpt.maxWidth / sw : 1,
          resizeOpt.maxHeight ? resizeOpt.maxHeight / sh : 1,
          1
        );
        dw = Math.max(1, Math.round(sw * s));
        dh = Math.max(1, Math.round(sh * s));
      }
      const c = document.createElement('canvas');
      c.width = dw; c.height = dh;
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
      return { dataUrl: c.toDataURL('image/png'), width: dw, height: dh };
    }, srcUrl, crop || null, resize || null);
    return result;
  } finally {
    try { await browser.close(); } catch {}
  }
}

module.exports = { transformImage };

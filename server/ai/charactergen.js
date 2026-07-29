'use strict';

// 低多邊形童話角色素材產生器：無頭 Chrome + three + LowPoly →
// 每個角色渲成透明去背 sprite PNG，另組一張有標籤的預覽總表（給 Kimi/設計師挑）
const puppeteer = require('puppeteer');

let busy = false;

// specs: [{ role, seed }]（已解析）。回傳 { sprites:[{role,seed,dataUrl}], gallery:dataUrl }
async function renderCharacters({ specs, port, basePath = '' }) {
  if (busy) return { error: '角色產生器忙碌中，請稍後再試' };
  busy = true;
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    const origin = `http://127.0.0.1:${port}${basePath}`;
    await page.goto(origin + '/api/ai/status', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.addScriptTag({ url: origin + '/shared/vendor/three.min.js' });
    await page.addScriptTag({ url: origin + '/shared/vendor/lowpoly.js' });

    const out = await page.evaluate((specs) => {
      const SW = 400, SH = 520;
      const cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
      const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x000000, 0);
      const cam = new THREE.PerspectiveCamera(32, SW / SH, 0.1, 100);

      function renderOne(role, seed) {
        const scene = new THREE.Scene();
        LowPoly.addLights(scene);
        const g = LowPoly.character({ role, seed });
        g.rotation.y = 0.5;                 // 3/4 視角比較有立體感
        scene.add(g);
        const box = new THREE.Box3().setFromObject(g);
        const cy = (box.min.y + box.max.y) / 2;
        cam.position.set(1.1, cy + 0.5, 4.2);
        cam.lookAt(0, cy, 0);
        renderer.render(scene, cam);
        return { dataUrl: cv.toDataURL('image/png'), role: g.userData.roleName };
      }

      const sprites = specs.map(s => {
        const r = renderOne(s.role, s.seed);
        return { role: s.role, roleName: r.role, seed: s.seed, dataUrl: r.dataUrl };
      });

      // 標籤預覽總表（2D 合成）
      const cols = Math.min(4, sprites.length);
      const rows = Math.ceil(sprites.length / cols);
      const CW = 240, CH = 300, LH = 30, PAD = 10;
      const gc = document.createElement('canvas');
      gc.width = cols * CW + PAD * 2;
      gc.height = rows * (CH + LH) + PAD * 2;
      const ctx = gc.getContext('2d');
      ctx.fillStyle = '#14142a'; ctx.fillRect(0, 0, gc.width, gc.height);
      ctx.textAlign = 'center'; ctx.font = 'bold 16px sans-serif';
      const imgs = sprites.map(s => { const im = new Image(); im.src = s.dataUrl; return im; });
      return Promise.all(imgs.map(im => im.decode().catch(() => {}))).then(() => {
        sprites.forEach((s, i) => {
          const cxi = i % cols, ryi = Math.floor(i / cols);
          const x = PAD + cxi * CW, y = PAD + ryi * (CH + LH);
          ctx.drawImage(imgs[i], x + (CW - CH * 400 / 520) / 2, y, CH * 400 / 520, CH);
          ctx.fillStyle = '#aaccff';
          ctx.fillText(`${s.roleName} · seed ${s.seed}`, x + CW / 2, y + CH + 20);
        });
        return { sprites, gallery: gc.toDataURL('image/jpeg', 0.85) };
      });
    }, specs);

    return { ok: true, sprites: out.sprites, gallery: out.gallery };
  } catch (e) {
    return { error: '角色渲染失敗: ' + e.message };
  } finally {
    busy = false;
    if (browser) { try { await browser.close(); } catch {} }
  }
}

module.exports = { renderCharacters };

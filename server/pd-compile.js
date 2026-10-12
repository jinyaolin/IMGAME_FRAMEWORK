// Pure Data patch → 可在瀏覽器發聲的 wasm(WebPd 編譯管線)
//
// 學生把 .pd 當遊戲檔案存進 manifest(gameConfig.files 裡名稱以 .pd 結尾的那些),
// 這裡負責把那段文字編成 AudioWorklet 能跑的 wasm,並產出「名字 → nodeId」對應表。
//
// 為什麼需要對應表:WebPd 的執行期 API 是 sendMsgToWebPd(nodeId, portletId, msg),
// nodeId 是編譯器指派的不透明字串(n_0_13),每次改 patch 都可能變。遊戲程式不該碰它。
// 編譯後從 wasm 的 metadata 把 [s 名字] / [r 名字] 的 nodeId 抽出來存成 io 表,
// 前端的 webpdkit 就能提供 PD.send('hit', [60]) 這種以名字為準的 API。
//
// ⚠ WebPd 的方向跟直覺相反(實測確認):
//   [s 名字] → messageReceivers = JS 可以「推訊息進去」的入口(進 bus,patch 內 [r 名字] 收到)
//   [r 名字] → messageSenders   = patch 發生事情時「通知 JS」
// 所以學生要讓遊戲能呼叫他的聲音,patch 裡要放一對 [s hit](不用接線)+ [r hit](接聲音鏈)。
//
// 編譯要 6-7 秒,所以一律背景跑、用內容 hash 當快取鍵:patch 沒改就不重編。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');

const CLI = path.join(__dirname, '..', 'node_modules', 'webpd', 'bin', 'cli.mjs');
const COMPILE_TIMEOUT_MS = 60_000;
const SMOKE_TIMEOUT_MS = 10_000;

// 教材 chapters/07-puredata-objects.md 列了幾個不存在的物件名(第 8 章 :484 有正名表)。
// 學生照第 7 章抄就會打出這些,錯誤訊息直接給正解比「not implemented」有用得多。
const RENAMES = {
  'delay~':  '[delay~] 不存在。延遲要用 [delwrite~ 名稱 長度ms] 寫入 + [delread~ 名稱 延遲ms] 讀取。',
  'reverb~': '[reverb~] 不存在,而且 WebPd 也不支援 [rev1~]/[rev2~]/[rev3~]。殘響請用 [delwrite~]/[delread~] 自己搭。',
  'button':  '[button] 不存在,點擊鈕是 [bng]。',
  'toggle':  '[toggle] 不存在,開關是 [tgl]。',
  'slider':  '[slider] 不存在,滑桿是 [hsl](橫)或 [vsl](縱)。',
  'number':  '[number] 不存在,數字框是 [nbx](或選單的 floatatom)。',
  'ezdac~':  '[ezdac~] WebPd 不支援,直接用 [dac~]。',
  'rev1~':   'WebPd 不支援殘響 [rev1~]。請用 [delwrite~]/[delread~] 自己搭。',
  'rev2~':   'WebPd 不支援殘響 [rev2~]。請用 [delwrite~]/[delread~] 自己搭。',
  'rev3~':   'WebPd 不支援殘響 [rev3~]。請用 [delwrite~]/[delread~] 自己搭(教材第 8 章練習 6 要改寫)。',
  'tabosc4~': 'WebPd 不支援 [tabosc4~]。波表可用 [phasor~] → [tabread4~] 組出來。',
  'env~':    'WebPd 不支援 [env~]。音量追蹤可用 [snapshot~]。',
  'threshold~': 'WebPd 不支援 [threshold~]。',
};

const isPdFile = (name) => typeof name === 'string' && name.trim().toLowerCase().endsWith('.pd');

/** manifest 的 gameConfig.files 裡挑出 .pd 檔(遞迴進 loop 的 children,跟 validateManifest 一致) */
function collectPdFiles(manifest) {
  const out = [];
  const walk = (stages) => {
    (stages || []).forEach((st) => {
      (st?.gameConfig?.files || []).forEach((f) => {
        if (f && isPdFile(f.name) && typeof f.code === 'string' && f.code.trim()) {
          out.push({ name: f.name, target: f.target || 'shared', code: f.code });
        }
      });
      walk(st?.children || st?.stages);
    });
  };
  walk(manifest?.stages);
  return out;
}

const hashOf = (code) => crypto.createHash('sha256').update(code, 'utf8').digest('hex').slice(0, 16);
const pdDir = (moduleId) => path.join(__dirname, 'modules', moduleId, 'pd');

function run(args, timeout) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { timeout, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      // CLI 的訊息帶 ANSI 色碼,存進 JSON 前先剝掉
      const clean = (s) => String(s || '').replace(/\[[0-9;]*m/g, '');
      resolve({ code: err ? (err.code ?? 1) : 0, out: clean(stdout), err: clean(stderr), timedOut: !!err?.killed });
    });
  });
}

/** 問 WebPd 支援度;不支援時把物件名換成可行動的中文提示 */
async function checkSupport(pdPath) {
  const r = await run(['-i', pdPath, '--check-support'], COMPILE_TIMEOUT_MS);
  const text = r.out + r.err;
  const m = text.match(/not implemented\s*:\s*(.+)/);
  if (!m) {
    if (/\(supported\)/.test(text)) return { ok: true, missing: [], hints: [] };
    // 連 parse 都失敗(括號不平衡、不是 Pd 檔…)
    const errLine = (text.match(/error:\s*(.+)/) || [])[1];
    return { ok: false, missing: [], hints: [errLine ? `讀不懂這個 patch:${errLine.trim()}` : '這個檔案不是有效的 Pure Data patch。'] };
  }
  const missing = m[1].split(',').map((s) => s.trim().replace(/^\[|\]$/g, '')).filter(Boolean);
  const hints = missing.map((o) => RENAMES[o] || `WebPd 不支援 [${o}]。`);
  return { ok: false, missing, hints };
}

/** 從編譯好的 wasm 讀出 [s]/[r] 的名字 → nodeId 對應 */
async function readIoMap(wasmPath) {
  const { readMetadata } = await import(
    '../node_modules/webpd/dist/node_modules/@webpd/compiler/dist/src/engine-assemblyscript/run/metadata.js'
  );
  const md = await readMetadata(fs.readFileSync(wasmPath));
  const graph = md.customMetadata?.graph || {};
  const pick = (which) => {
    const map = {};
    for (const [nodeId, portlets] of Object.entries(md.settings?.io?.[which] || {})) {
      const node = graph[nodeId];
      const bus = node?.args?.busName;
      if (!bus) continue;                       // GUI 物件沒有 busName,phase 1 不處理
      const portletId = Array.isArray(portlets) ? portlets[0] : Object.keys(portlets)[0];
      map[bus] = [nodeId, String(portletId ?? '0')];
    }
    return map;
  };
  return { in: pick('messageReceivers'), out: pick('messageSenders') };
}

/**
 * 煙霧測試:在 Node 裡真的跑這個 patch,對每個入口送一個訊息,看有沒有輸出波形。
 * 目的是在學生還在編輯器裡的時候就告訴他「收到 hit 但沒有發出聲音」,
 * 而不是等他把遊戲跑起來才發現沒聲音。
 * ⚠ [until] 無界迴圈編譯得過、會在 runtime 卡死,所以整段包 timeout。
 */
async function smokeTest(wasmPath, ioIn) {
  const names = Object.keys(ioIn);
  const work = (async () => {
    const { createEngine } = await import(
      '../node_modules/webpd/dist/node_modules/@webpd/compiler/dist/src/engine-assemblyscript/run/index.js'
    );
    const BS = 128, SR = 44100;

    // 三個獨立指標。只看 RMS 會誤判:[osc~] 沒給頻率時輸出 0Hz = DC 常數 1,
    // 靜置 RMS(0.2)反而比觸發後的正弦(0.141)大;而「音高變了但音量一樣」的 drone
    // RMS 完全相同,要靠零交越率(zcr)才看得出來。
    const measure = (engine, blocks) => {
      const out = [new Float32Array(BS), new Float32Array(BS)];
      const inp = [new Float32Array(BS)];
      let sum = 0, n = 0, peak = 0, cross = 0, prev = 0;
      for (let b = 0; b < blocks; b++) {
        engine.dspLoop(inp, out);
        for (const v of out[0]) {
          sum += v * v; n++;
          if (Math.abs(v) > peak) peak = Math.abs(v);
          if ((v >= 0) !== (prev >= 0)) cross++;
          prev = v;
        }
      }
      return { rms: Math.sqrt(sum / Math.max(1, n)), peak, zcr: cross / Math.max(1, n) };
    };
    const fresh = async () => {
      const e = await createEngine(fs.readFileSync(wasmPath));
      e.initialize(SR, BS);
      measure(e, 10);                       // 先跑一下讓 loadbang 之類的發生
      return e;
    };

    // 靜置基準:有些 patch 本來就一直在響(環境音),有些輸出 DC
    const idle = measure(await fresh(), 90);

    // 不知道學生的入口期望什麼型別,幾種都試一次取反應最大的
    const PROBES = [[60], [1], ['bang']];
    const results = {};
    for (const name of names) {
      const [nodeId, portletId] = ioIn[name];
      let best = null;
      for (const probe of PROBES) {
        const engine = await fresh();
        try { engine.io.messageReceivers[nodeId][portletId](probe); }
        catch { continue; }                  // 這個型別送不進去就換下一個
        const m = measure(engine, 90);
        // 跟靜置差多少(三個指標各自相對變化,取最大)
        const rel = (a, b) => Math.abs(a - b) / Math.max(1e-6, Math.abs(a), Math.abs(b));
        const change = Math.max(rel(m.rms, idle.rms), rel(m.peak, idle.peak), rel(m.zcr, idle.zcr));
        if (!best || change > best.change) best = { ...m, change, probe: JSON.stringify(probe) };
      }
      results[name] = best
        ? {
            rms: Number(best.rms.toFixed(5)),
            peak: Number(best.peak.toFixed(5)),
            probe: best.probe,
            silent: best.peak < 1e-3,                  // 完全沒有輸出
            responded: best.change > 0.02,             // 訊息有造成變化
          }
        : { error: '這個入口收不進任何訊息' };
    }
    return {
      idle: { rms: Number(idle.rms.toFixed(5)), peak: Number(idle.peak.toFixed(5)) },
      inputs: results,
    };
  })();

  let timer;
  const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), SMOKE_TIMEOUT_MS); });
  try {
    return await Promise.race([work, guard]);
  } catch (e) {
    return { error: e.message === 'timeout'
      ? '測試逾時 —— patch 裡可能有無界迴圈(例如沒有上限的 [until]),瀏覽器會整個卡住。'
      : `測試失敗:${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 編一個 patch。回傳要寫進 <hash>.json 的報告。 */
async function compileOne(moduleId, file) {
  const hash = hashOf(file.code);
  const dir = pdDir(moduleId);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${hash}.json`);
  const wasmPath = path.join(dir, `${hash}.wasm`);

  if (fs.existsSync(jsonPath)) {                       // 內容沒變 → 沿用
    try { return JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { /* 壞掉就重編 */ }
  }

  const tmp = path.join(os.tmpdir(), `imgame-pd-${hash}.pd`);
  fs.writeFileSync(tmp, file.code, 'utf8');
  const report = { hash, name: file.name, target: file.target, status: 'error', at: new Date().toISOString() };

  try {
    const sup = await checkSupport(tmp);
    if (!sup.ok) {
      report.status = 'unsupported';
      report.missing = sup.missing;
      report.hints = sup.hints;
      return finish();
    }
    const c = await run(['-i', tmp, '-o', wasmPath, '-f', 'wasm'], COMPILE_TIMEOUT_MS);
    if (c.code !== 0 || !fs.existsSync(wasmPath)) {
      report.hints = [((c.err + c.out).match(/error:\s*(.+)/) || [, '編譯失敗'])[1].trim()];
      return finish();
    }
    report.io = await readIoMap(wasmPath);
    report.smoke = await smokeTest(wasmPath, report.io.in);
    report.status = 'ok';
    report.bytes = fs.statSync(wasmPath).size;

    // 把「編得過但大概不會發聲」的情形講出來 —— 這是學生最常卡的地方
    const warn = [];
    if (!Object.keys(report.io.in).length) {
      warn.push('這個 patch 沒有任何 [s 名字] 物件,遊戲沒辦法呼叫它。放一個 [s hit](不用接線),再用 [r hit] 接你的聲音鏈。');
    }
    // 「哪些入口會發聲」只在「一個都不會」的時候才是問題。
    // 控制用的入口(設速度、設音量、純控制匯流排)本來就不該發出聲音 ——
    // 逐個入口報警等於天天喊狼來了,學生會學會忽略所有警告。
    const ins = Object.entries(report.smoke?.inputs || {});
    const sounding = ins.filter(([, r]) => !r.error && !r.silent && r.responded);
    if (ins.length && !sounding.length) {
      warn.push('對每個入口送訊息都沒有聽到聲音 —— 檢查聲音鏈最後有沒有接到 [dac~]'
        + '(而且 [dac~] 左右兩個 inlet 都要接才有雙聲道),以及 [r 名字] 有沒有真的接上去。');
    }
    ins.filter(([, r]) => r.error).forEach(([n, r]) => warn.push(`[s ${n}] ${r.error}`));
    report.sounding = sounding.map(([n]) => n);   // 編輯器可以顯示「這些入口會發聲」
    if (report.smoke?.error) warn.push(report.smoke.error);
    if (warn.length) report.warnings = warn;
    return finish();
  } catch (e) {
    report.hints = [`編譯時出錯:${e.message}`];
    return finish();
  }

  function finish() {
    try {
      fs.writeFileSync(jsonPath + '.tmp', JSON.stringify(report, null, 2));
      fs.renameSync(jsonPath + '.tmp', jsonPath);
    } catch (e) { console.error('[PD] 寫報告失敗:', e.message); }
    try { fs.unlinkSync(tmp); } catch {}
    return report;
  }
}

// 同一個模組同時只跑一條編譯鏈(編譯很吃 CPU,存檔連點不該疊起來)
const chains = new Map();

/**
 * 存 manifest 後呼叫。背景編譯所有 .pd 檔,不阻塞存檔。
 * 回傳 Promise 方便測試;正常路徑不 await。
 */
function compileModulePatches(moduleId, manifest) {
  const files = collectPdFiles(manifest);
  if (!files.length) return Promise.resolve([]);
  const prev = chains.get(moduleId) || Promise.resolve();
  const next = prev.then(async () => {
    const reports = [];
    for (const f of files) {
      try {
        const r = await compileOne(moduleId, f);
        reports.push(r);
        const tag = r.status === 'ok' ? (r.warnings ? '有提醒' : 'ok') : r.status;
        console.log(`[PD] ${moduleId}/${f.name} → ${tag}`);
      } catch (e) {
        console.error(`[PD] ${moduleId}/${f.name} 編譯爆掉:`, e.message);
      }
    }
    return reports;
  }).catch((e) => { console.error('[PD] 編譯鏈出錯:', e.message); return []; });
  chains.set(moduleId, next.then(() => {}, () => {}));
  return next;
}

/**
 * 給前端用:這個模組某一端要載哪些 patch,各自的狀態與 io 表。
 * status='pending' = 還在編(或還沒編),前端可以稍後重試。
 */
function describeModulePatches(moduleId, manifest) {
  return collectPdFiles(manifest).map((f) => {
    const hash = hashOf(f.code);
    const jsonPath = path.join(pdDir(moduleId), `${hash}.json`);
    let report = null;
    if (fs.existsSync(jsonPath)) { try { report = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {} }
    return report
      ? { ...report, name: f.name, target: f.target }
      : { name: f.name, target: f.target, hash, status: 'pending' };
  });
}

/** 刪掉這個模組已經沒在用的 hash 產物 */
function pruneModulePatches(moduleId, manifest) {
  const dir = pdDir(moduleId);
  if (!fs.existsSync(dir)) return;
  const keep = new Set(collectPdFiles(manifest).map((f) => hashOf(f.code)));
  for (const fname of fs.readdirSync(dir)) {
    const h = fname.replace(/\.(wasm|json)$/, '');
    if (!keep.has(h)) { try { fs.unlinkSync(path.join(dir, fname)); } catch {} }
  }
}

module.exports = {
  isPdFile, collectPdFiles, compileModulePatches, describeModulePatches, pruneModulePatches,
  pdDir, hashOf, RENAMES,
};

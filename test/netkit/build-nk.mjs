// ═══════════════════════════════════════════════════════════════
// 通用 NetKit 遊戲組裝器。把某模組的 src/*.js(真原始檔)組進 manifest.json。
//   node test/netkit/build-nk.mjs <moduleDir>   (預設 fairy-brawl-nk)
//
// 讀 <moduleDir>/game.json(metadata + gameStage.files[{name,target,src}])+ 逐檔載入 src,
// 塞進 game-type stage 的 gameConfig.files,atomic 寫出 manifest.json。
// 順帶把 sim/render 各自 new Function 編一次擋壞碼(target:'render' 需 THREE/GameAPI/Net stub)。
// 這是「NetKit 遊戲」的標準結構:config.js(shared)+sim.js(sim)+render.js(render)+game.json。
// ═══════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.resolve(__dirname, '../../server/modules', process.argv[2] || 'fairy-brawl-nk');
const game = JSON.parse(fs.readFileSync(path.join(moduleDir, 'game.json'), 'utf8'));

// 逐檔載入 src → gameConfig.files(name/target/code)
const files = (game.gameStage.files || []).map(f => ({
  name: f.name, target: f.target,
  code: fs.readFileSync(path.join(moduleDir, 'src', f.src), 'utf8'),
}));

// 組 manifest:把 gameStage 的 gameConfig 塞進 type:'game' 的 stage
const stages = game.stages.map(st => {
  if (st.type !== 'game') return st;
  return { ...st, gameConfig: { layout: 'custom', library: game.gameStage.library || 'three', files } };
});
const manifest = {
  id: game.id, name: game.name, description: game.description, version: game.version,
  minPlayers: game.minPlayers, maxPlayers: game.maxPlayers, decks: game.decks || [], stages,
  playerAttributes: game.playerAttributes || [], globalParams: game.globalParams || [],
};

// 編譯檢查(依 target 分組;同端 shared+target 併作用域,與執行期一致)
const codeOf = t => files.filter(f => f.target === 'shared' || f.target === t).map(f => `// ═══ ${f.name} ═══\n${f.code}`).join('\n\n');
try { new Function('Sim', codeOf('sim')); console.log('sim  compiles OK'); }
catch (e) { console.error('SIM COMPILE FAIL:', e.message); process.exit(1); }
try { new Function('GameAPI', 'Net', 'window', 'LowPoly', codeOf('render')); console.log('render compiles OK'); }
catch (e) { console.error('RENDER COMPILE FAIL:', e.message); process.exit(1); }

const tmp = path.join(moduleDir, 'manifest.json.tmp');
fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
fs.renameSync(tmp, path.join(moduleDir, 'manifest.json'));
console.log('wrote', path.join(moduleDir, 'manifest.json'));

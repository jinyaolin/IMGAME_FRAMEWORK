// 相容 shim:sim 與 CFG 的單一真相來源已移到 server/modules/fairy-brawl-nk/src/。
// 舊測試(test-fairy-sim / test-netpredict / test-remote-predict / test-netsim)沿用這裡的匯出。
const { buildFairySim } = require('../../server/modules/fairy-brawl-nk/src/sim.js');
const { CFG } = require('../../server/modules/fairy-brawl-nk/src/config.js');
module.exports = { buildFairySim, FAIRY_CFG: CFG };

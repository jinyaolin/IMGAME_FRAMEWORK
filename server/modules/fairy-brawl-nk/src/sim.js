// ═══════════════════════════════════════════════════════════════
// 童話大亂鬥 (NetKit) — 權威 sim(target: 'sim')。純 JS,無 THREE/DOM。
// host 端(Node 或瀏覽器 Worker)跑;render 端只讀快照。
// 雙模式:瀏覽器 sim target 由 new Function('Sim', code) 執行 → 底部自動 buildFairySim(Sim, CFG);
//         node 端 require 取 buildFairySim(Sim 未定義 → 不自動執行),測試自帶 CFG 呼叫。
// CFG 一律來自 shared 的 config.js(瀏覽器同作用域;node 測試由 harness 傳入)。
// ═══════════════════════════════════════════════════════════════
function buildFairySim(Sim, CFG, SKILLS, ROLES) {
  SKILLS = SKILLS || {}; ROLES = ROLES || [];   // 缺省 → 無技能(舊測試以 2 參呼叫時仍可跑)
  // 由 idx 穩定分配重生點(避免重疊)
  function spawnX(pid, idx) { const spots = CFG.SPAWN; return spots[(idx | 0) % spots.length]; }
  function roleOf(idx) { return ROLES.length ? ROLES[(idx | 0) % ROLES.length] : null; }
  function skillOf(idx) { const r = roleOf(idx); return r ? (SKILLS[r] || null) : null; }
  const clampX = x => Math.max(CFG.X_MIN, Math.min(CFG.X_MAX, x));
  // 落地判定:主島(y=0)或浮島頂面;回傳落腳 y 或 null
  function landY(x, prevY, y) {
    if (y <= 0) return 0;
    for (const p of CFG.PLATFORMS) {
      if (Math.abs(x - p.x) <= p.w && prevY >= p.y - 0.01 && y <= p.y) return p.y;
    }
    return null;
  }

  const ents = {};      // pid -> 狀態
  const input = {};     // pid -> 最新輸入 {mx,jump,atk}
  let order = 0;
  let WORLD = {};       // init 傳入:{seed, players:{pid:{attrs,name,num}}} → 選角階段寫的 role/seed 從這來
  Sim.init = function (w) { WORLD = w || {}; };
  // 玩家在選角階段選好的 role/seed(attrs.ready 才採用),否則退回 idx 預設 → 不破壞既有變化
  function pickSpec(pid, idx) {
    const pi = WORLD.players && WORLD.players[String(pid)];
    const a = (pi && pi.attrs) || {};
    const role = (a.ready && a.role) ? a.role : roleOf(idx);
    const seed = (a.ready && a.seed) ? (a.seed | 0) : (1000 + idx * 137);
    return { role: role, seed: seed };
  }
  function skillOfRole(role) { return (role && SKILLS[role]) || null; }
  const projs = [];     // 投射物(火球/冰柱/箭/泡泡環):host 權威,client 只讀快照畫,不預測
  let projId = 0;
  // 道具 / 天災 / 回合時鐘
  const IT = CFG.ITEMS || {};
  const items = [];     // 場上道具(最多 1){id,kind,x,y}
  let itemId = 0, itemTimer = IT.FIRST || 6, rainT = 0, rainOwner = null, roundT = 0;
  const POTIONS = ['red', 'blue', 'agi', 'pow'];
  function powMul(e) { return e.bPow > 0 ? (IT.ATK_MUL || 1) : 1; }
  function pickKind() { return Math.random() < (IT.DISASTER_W || 0) ? 'dis' : POTIONS[(Math.random() * POTIONS.length) | 0]; }
  function spawnItem() { items.push({ id: itemId++, kind: pickKind(), x: IT.ISLAND_X || 0, y: IT.ISLAND_Y || 7.2 }); }
  function applyItem(pid, e, kind) {
    if (kind === 'red') e.hp = Math.min(CFG.HP_MAX, e.hp + CFG.HP_MAX * (IT.HEAL_RATIO || 0.5));
    else if (kind === 'blue') e.bCd = IT.BUFF_SECS;
    else if (kind === 'agi') e.bSpd = IT.BUFF_SECS;
    else if (kind === 'pow') e.bPow = IT.BUFF_SECS;
    else if (kind === 'dis') { rainT = IT.RAIN_SECS; rainOwner = pid; }   // 撿天災者免疫,對其他人下火雨
    Sim.emit('item', { by: pid, kind: kind });
  }

  // 套一次傷害/擊退/KO(近戰與範圍技共用)
  function applyHit(pid, oid, o, dmg, knockDir, knock, lift, fromSkill) {
    o.hp -= dmg;
    o.vx = knockDir * knock; o.vy = Math.max(o.vy, lift); o.grounded = false;
    o.stun = CFG.HIT_STUN;
    if (o.hp <= 0) {
      o.ko = true; o.respawn = CFG.RESPAWN_TIME; o.hp = 0; o.slp = 0; o.ice = 0; o.stone = 0; o.castT = 0;
      Sim.emit('ko', { by: pid, target: oid });
      Sim.emit('score', { pid: pid, add: 1 });   // 擊殺 +1 → 框架 player.score(result 階段自動排名)
    }
    else Sim.emit('hit', { by: pid, target: oid, skill: !!fromSkill });
  }
  // 瞬發技結算(範圍/錐/狀態/治療/位移/石化)。proj/multi/ring 為投射物 → 下一階段,目前僅冷卻+cast 特效。
  function castSkill(pid, e, sk) {
    const T = sk.type, pm = powMul(e);   // pm:強化 buff 傷害倍率
    if (T === 'heal') { e.hp = Math.min(CFG.HP_MAX, e.hp + CFG.HP_MAX * sk.ratio); return; }
    if (T === 'stone') { e.stone = sk.dur; e.inv = Math.max(e.inv, sk.dur); return; }
    if (T === 'dodge') { const dir = Math.random() < 0.5 ? -1 : 1; e.x = clampX(e.x + dir * sk.dist); e.vx = 0; e.inv = Math.max(e.inv, sk.invuln); return; }
    if (T === 'blink') {
      let best = e.x, bestD = -1;
      for (let cx = -14; cx <= 14; cx += 2) { let md = 1e9; for (const oid in ents) { if (oid === pid) continue; md = Math.min(md, Math.abs(ents[oid].x - cx)); } if (md > bestD) { bestD = md; best = cx; } }
      e.x = clampX(best); e.vx = 0; e.inv = Math.max(e.inv, sk.invuln); return;
    }
    if (T === 'aoe' || T === 'cone' || T === 'statusAoe') {
      for (const oid in ents) {
        if (oid === pid) continue;
        const o = ents[oid];
        if (o.ko || o.inv > 0 || o.stone > 0) continue;
        const dx = o.x - e.x, dy = o.y - e.y;
        let hit;
        if (T === 'cone') hit = Math.sign(dx || e.dir) === e.dir && Math.abs(dx) <= sk.range && Math.abs(dy) <= (sk.widen * Math.abs(dx) + 1.2);
        else hit = Math.abs(dx) <= sk.range && Math.abs(dy) <= sk.vrange;   // aoe/statusAoe 全向
        if (!hit) continue;
        if (T === 'statusAoe') { o[sk.status] = Math.max(o[sk.status] || 0, sk.dur); o.vx = 0; }
        else applyHit(pid, oid, o, sk.dmg * pm, Math.sign(dx || 1), sk.knock, sk.lift, true);
      }
      return;
    }
    // 投射物:直線(proj 單發 / multi 多發帶垂直散射)或擴張環(ring)
    if (T === 'proj') { spawnProj(pid, e, sk, 0, pm); return; }
    if (T === 'multi') { const n = sk.n || 3; for (let i = 0; i < n; i++) spawnProj(pid, e, sk, (i - (n - 1) / 2) * sk.vspread, pm); return; }
    if (T === 'ring') {
      projs.push({ id: projId++, type: 'ring', owner: pid, kind: e.role, x: e.x, y: e.y + 1.0, r: 0, maxR: sk.maxR,
        life: sk.dur, dmg: sk.dmg * pm, knock: sk.knock, lift: sk.lift, hit: {} });
      return;
    }
  }
  // 直線投射物:自施法者身前射出。multi 亦走 'proj' 直線,只是帶垂直分量做扇形。
  function spawnProj(pid, e, sk, vyOff, pm) {
    projs.push({ id: projId++, type: 'proj', owner: pid, kind: e.role,
      x: e.x + e.dir * 1.0, y: e.y + 1.2, vx: e.dir * sk.speed, vy: vyOff || 0,
      dmg: sk.dmg * (pm || 1), knock: sk.knock, lift: sk.lift, status: sk.status || null, sdur: sk.dur || 0, life: 2.0 });
  }
  // 每步推進投射物 + 命中結算(在實體迴圈之後呼叫)
  function stepProjectiles(dt) {
    for (let i = projs.length - 1; i >= 0; i--) {
      const pr = projs[i];
      pr.life -= dt;
      if (pr.type === 'ring') {
        pr.r = Math.min(pr.maxR, pr.r + pr.maxR * dt);   // dur≈1s 由 0 擴張到 maxR
        for (const oid in ents) {
          if (oid === pr.owner || pr.hit[oid]) continue;
          const o = ents[oid]; if (o.ko || o.inv > 0 || o.stone > 0) continue;
          const dist = Math.hypot(o.x - pr.x, o.y - pr.y);
          if (dist <= pr.maxR + 0.4 && Math.abs(dist - pr.r) < 0.7) { pr.hit[oid] = 1; applyHit(pr.owner, oid, o, pr.dmg, Math.sign(o.x - pr.x || 1), pr.knock, pr.lift, true); }
        }
        if (pr.life <= 0) { projs.splice(i, 1); Sim.emit('projend', { id: pr.id }); }
      } else {
        pr.x += pr.vx * dt; pr.y += pr.vy * dt;
        let done = false;
        for (const oid in ents) {
          if (oid === pr.owner) continue;
          const o = ents[oid]; if (o.ko || o.inv > 0 || o.stone > 0) continue;
          if (Math.abs(o.x - pr.x) < 0.9 && Math.abs((o.y + 0.9) - pr.y) < 1.2) {
            applyHit(pr.owner, oid, o, pr.dmg, Math.sign(pr.vx || 1), pr.knock, pr.lift, true);
            if (pr.status) o[pr.status] = Math.max(o[pr.status] || 0, pr.sdur);
            done = true; break;
          }
        }
        if (done || pr.life <= 0 || pr.x < CFG.X_MIN - 2 || pr.x > CFG.X_MAX + 2) { projs.splice(i, 1); Sim.emit('projend', { id: pr.id }); }
      }
    }
  }
  // 道具刷新/拾取 + 天災火雨(每步一次)
  function stepItems(dt) {
    if (rainT > 0) {
      rainT -= dt;
      for (const pid in ents) {
        const o = ents[pid]; if (pid === rainOwner || o.ko || o.inv > 0 || o.stone > 0) continue;
        o.hp -= (IT.RAIN_DPS || 0) * dt;
        if (o.hp <= 0) { o.ko = true; o.respawn = CFG.RESPAWN_TIME; o.hp = 0; o.slp = 0; o.ice = 0; o.stone = 0; o.castT = 0; Sim.emit('ko', { by: rainOwner, target: pid }); Sim.emit('score', { pid: rainOwner, add: 1 }); }
      }
    }
    if (items.length === 0) {
      itemTimer -= dt;
      if (itemTimer <= 0) { spawnItem(); itemTimer = (IT.SPAWN_MIN || 14) + Math.random() * ((IT.SPAWN_MAX || 22) - (IT.SPAWN_MIN || 14)); }
    } else {
      const it = items[0];
      for (const pid in ents) {
        const e = ents[pid]; if (e.ko) continue;
        if (Math.abs(e.x - it.x) <= (IT.PICK_DX || 1.4) && Math.abs(e.y - it.y) <= (IT.PICK_DY || 1.7)) {
          applyItem(pid, e, it.kind); items.shift(); itemTimer = (IT.SPAWN_MIN || 14) + Math.random() * ((IT.SPAWN_MAX || 22) - (IT.SPAWN_MIN || 14)); break;
        }
      }
    }
  }

  Sim.spawn = function (pid) {
    if (ents[pid]) return;
    const idx = order++;
    const spec = pickSpec(pid, idx);   // 選好的角色/外觀(或 idx 預設)
    ents[pid] = { x: spawnX(pid, idx), y: 0, vx: 0, vy: 0, grounded: true, jumps: 0,
      dir: 0, hp: CFG.HP_MAX, ko: false, respawn: 0, inv: CFG.INVINCIBLE_TIME, cd: 0, stun: 0, idx: idx, anim: 'idle',
      role: spec.role, seed: spec.seed, scd: 0, castT: 0, slp: 0, ice: 0, stone: 0,   // 技能 + 狀態
      bCd: 0, bSpd: 0, bPow: 0 };                                       // buff 剩餘秒(藍/敏/強)
    input[pid] = { mx: 0, jump: false, atk: false, kick: false, skill: false };
  };
  Sim.despawn = function (pid) { delete ents[pid]; delete input[pid]; };
  Sim.input = function (pid, inp) {
    const cur = input[pid] || (input[pid] = { mx: 0, jump: false, atk: false });
    if (typeof inp.mx === 'number') cur.mx = Math.max(-1, Math.min(1, inp.mx));
    if (inp.jump) cur.jump = true;   // edge:設 true,step 消費
    if (inp.atk) cur.atk = true;     // 拳
    if (inp.kick) cur.kick = true;   // 腳
    if (inp.skill) cur.skill = true; // 技
  };

  Sim.step = function (dt) {
    for (const pid in ents) {
      const e = ents[pid], inp = input[pid] || {};
      // 計時器
      e.cd = Math.max(0, e.cd - dt);
      e.inv = Math.max(0, e.inv - dt);
      e.stun = Math.max(0, e.stun - dt);
      e.scd = Math.max(0, e.scd - dt);
      e.castT = Math.max(0, e.castT - dt);
      e.slp = Math.max(0, e.slp - dt);
      e.ice = Math.max(0, e.ice - dt);
      e.stone = Math.max(0, e.stone - dt);
      e.bCd = Math.max(0, e.bCd - dt);
      e.bSpd = Math.max(0, e.bSpd - dt);
      e.bPow = Math.max(0, e.bPow - dt);

      if (e.ko) {
        e.respawn -= dt;
        if (e.respawn <= 0) {
          const sp = spawnX(pid, e.idx);
          e.x = sp; e.y = 0.5; e.vx = 0; e.vy = 0; e.jumps = 0; e.grounded = false;
          e.hp = CFG.HP_MAX; e.ko = false; e.inv = CFG.INVINCIBLE_TIME;
          e.slp = 0; e.ice = 0; e.stone = 0; e.castT = 0;
        }
        e.anim = 'ko';
        continue;
      }

      const sk = skillOfRole(e.role);
      // 鎖定:硬直/睡/冰 → 不吃輸入。硬直保留擊退動量;睡/冰定住。
      const locked = e.stun > 0 || e.slp > 0 || e.ice > 0;
      if (locked) {
        if (e.stun > 0) e.vx *= Math.pow(0.02, dt); else e.vx = 0;   // 睡/冰:定住
        input[pid] && (input[pid].jump = false, input[pid].atk = false, input[pid].kick = false, input[pid].skill = false);
      } else {
      // 移動(石化中移速 ×0.5;敏捷 buff ×1.25)
      const spd = (e.grounded ? CFG.MOVE_SPEED : CFG.AIR_SPEED) * (e.stone > 0 ? 0.5 : 1) * (e.bSpd > 0 ? (IT.SPD_MUL || 1) : 1);
      e.vx = (inp.mx || 0) * spd;
      if (inp.mx > 0.01) e.dir = 1; else if (inp.mx < -0.01) e.dir = -1;
      // 跳(邊緣)
      if (inp.jump) {
        if (e.grounded) { e.vy = CFG.JUMP_VEL; e.grounded = false; e.jumps = 1; }
        else if (e.jumps < 2) { e.vy = CFG.JUMP2_VEL; e.jumps = 2; }
        input[pid].jump = false;
      }
      // 技能(邊緣;施法鎖 castT 期間與冷卻中不可再施;藍 buff 冷卻 ×0.5)
      if (inp.skill && sk && e.scd <= 0 && e.castT <= 0) {
        e.scd = sk.cd * (e.bCd > 0 ? (IT.CD_MUL || 1) : 1);
        if (sk.cast) e.castT = sk.cast;
        Sim.emit('cast', { by: pid, role: e.role, type: sk.type });
        castSkill(pid, e, sk);
      }
      // 近戰(邊緣;施法鎖期間不可攻擊)。拳/腳共用冷卻閘,各自的射程/傷害/擊退;拳優先。
      let spec = null, kind = null;
      if (e.cd <= 0 && e.castT <= 0) {
        if (inp.atk) { spec = CFG.PUNCH; kind = 'punch'; }
        else if (inp.kick) { spec = CFG.KICK; kind = 'kick'; }
      }
      if (spec) {
        e.cd = spec.cd;
        Sim.emit('atk', { by: pid, kind: kind });     // render 播對應近戰動作
        for (const oid in ents) {
          if (oid === pid) continue;
          const o = ents[oid];
          if (o.ko || o.inv > 0 || o.stone > 0) continue;
          const dx = o.x - e.x, dy = o.y - e.y;
          const face = e.dir || (dx >= 0 ? 1 : -1);   // 未轉身(dir=0)→ 朝目標,等於雙向可打(對齊原版)
          if ((e.dir === 0 || Math.sign(dx || face) === e.dir) && Math.abs(dx) <= spec.range && Math.abs(dy) <= spec.vrange) {
            applyHit(pid, oid, o, spec.dmg * powMul(e), face, spec.knock, spec.lift, false);
          }
        }
      }
      input[pid].atk = false; input[pid].kick = false; input[pid].skill = false;
      }   // end !locked

      // 重力 + 位移 + 落地
      e.vy -= CFG.GRAVITY * dt;
      const prevY = e.y;
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.x = Math.max(CFG.X_MIN, Math.min(CFG.X_MAX, e.x));
      if (e.vy <= 0) {
        const ly = landY(e.x, prevY, e.y);
        if (ly != null) { e.y = ly; e.vy = 0; e.grounded = true; e.jumps = 0; }
        else e.grounded = false;
      } else e.grounded = false;

      // 動作(locomotion;攻擊/受擊/ko 走事件)
      e.anim = !e.grounded ? 'jump' : (Math.abs(e.vx) > 0.5 ? 'run' : 'idle');
    }
    stepProjectiles(dt);   // 投射物在實體結算之後推進 + 命中
    stepItems(dt);         // 道具刷新/拾取 + 火雨
    roundT += dt;          // 回合時鐘
  };

  Sim.snapshot = function () {
    const out = {};
    for (const pid in ents) {
      const e = ents[pid];
      const sk = skillOfRole(e.role);
      // s 內 vx/vy/gr/jm 是「預測欄位」:只有該實體的擁有者 client 用來對帳(reset+replay);渲染忽略。
      out[pid] = { p: [e.x, e.y], s: { dir: e.dir, anim: e.anim, hp: e.hp, ko: e.ko ? 1 : 0, inv: e.inv > 0 ? 1 : 0, idx: e.idx,
        vx: +e.vx.toFixed(3), vy: +e.vy.toFixed(3), gr: e.grounded ? 1 : 0, jm: e.jumps, st: +e.stun.toFixed(3),
        mx: +((input[pid] && input[pid].mx) || 0).toFixed(2),   // 目前水平輸入 → 遠端實體預測用
        role: e.role || '', seed: e.seed || 0, skn: (sk && sk.name) || '',    // 選好的角色/外觀 + 技能名(HUD)
        scd: (sk && sk.cd) ? +Math.max(0, Math.min(1, e.scd / sk.cd)).toFixed(2) : 0,   // 冷卻 0..1
        slp: e.slp > 0 ? 1 : 0, ice: e.ice > 0 ? 1 : 0, stn: e.stone > 0 ? 1 : 0, cast: e.castT > 0 ? 1 : 0,
        scds: +e.scd.toFixed(1),                                              // 冷卻剩餘秒(HUD 數字)
        bcd: e.bCd > 0 ? 1 : 0, bspd: e.bSpd > 0 ? 1 : 0, bpow: e.bPow > 0 ? 1 : 0 } };   // buff 狀態(HUD)
    }
    // 投射物給 render 畫(id 追蹤 mesh、k=角色決定外觀、t=直線/環、r=環半徑)
    const pj = projs.map(pr => ({ id: pr.id, k: pr.kind || '', t: pr.type, x: +pr.x.toFixed(2), y: +pr.y.toFixed(2), r: pr.type === 'ring' ? +pr.r.toFixed(2) : 0 }));
    const im = items.map(it => ({ id: it.id, k: it.kind, x: it.x, y: it.y }));
    return { ents: out, world: { projs: pj, items: im, rain: rainT > 0 ? 1 : 0, timeLeft: Math.max(0, Math.round((CFG.FIGHT_SECONDS || 180) - roundT)) } };
  };

  // 遠端實體預測:純運動學前進一步(不含戰鬥/事件)。client 由權威快照狀態 + 傳來的 mx,
  // 每幀從快照重新積分到「現在」→ 遠端角色顯示在 now 而非過去(host↔mobile 一致)。不 mutate 輸入。
  Sim.predictStep = function (e, inp, dt) {
    const o = { x: e.x, y: e.y, vx: e.vx, vy: e.vy, grounded: e.grounded, jumps: e.jumps, stun: e.stun || 0, dir: e.dir };
    o.stun = Math.max(0, o.stun - dt);
    if (o.stun > 0) { o.vx *= Math.pow(0.02, dt); }        // 硬直:動量衰減,不吃輸入
    else {
      const spd = o.grounded ? CFG.MOVE_SPEED : CFG.AIR_SPEED;
      o.vx = (inp.mx || 0) * spd;
      if (inp.mx > 0.01) o.dir = 1; else if (inp.mx < -0.01) o.dir = -1;
    }
    o.vy -= CFG.GRAVITY * dt;
    const prevY = o.y;
    o.x += o.vx * dt; o.y += o.vy * dt;
    o.x = Math.max(CFG.X_MIN, Math.min(CFG.X_MAX, o.x));
    if (o.vy <= 0) { const ly = landY(o.x, prevY, o.y); if (ly != null) { o.y = ly; o.vy = 0; o.grounded = true; o.jumps = 0; } else o.grounded = false; } else o.grounded = false;
    o.anim = !o.grounded ? 'jump' : (Math.abs(o.vx) > 0.5 ? 'run' : 'idle');
    return o;
  };

  // 預測對帳:把本地預測 sim 的某實體重設成權威狀態(client 端收 snapshot 後呼叫,再 replay 未確認輸入)
  Sim.reset = function (pid, f) {
    let e = ents[pid]; if (!e) { Sim.spawn(pid); e = ents[pid]; }
    e.x = f.x; e.y = f.y; e.vx = f.vx || 0; e.vy = f.vy || 0; e.grounded = !!f.grounded; e.jumps = f.jumps || 0;
    if (f.stun != null) e.stun = f.stun;
    if (typeof f.dir === 'number') e.dir = f.dir;
  };

  Sim._ents = ents;  // 測試用
  return Sim;
}

// 瀏覽器 sim target:Sim 由 new Function('Sim', …) 傳入 → 自動裝配(CFG/SKILLS/ROLES 來自 shared 同作用域)
if (typeof Sim !== 'undefined' && typeof CFG !== 'undefined') buildFairySim(Sim, CFG, typeof SKILLS !== 'undefined' ? SKILLS : {}, typeof ROLES !== 'undefined' ? ROLES : []);
// node:供單元測試/組裝腳本 require
if (typeof module !== 'undefined' && module.exports) module.exports = { buildFairySim };

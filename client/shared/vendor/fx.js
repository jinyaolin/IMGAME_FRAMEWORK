// ============================================================
// FX — 通用 THREE.js 輕量特效系統（vendor 全域庫）
// 由 fairy-brawl 的 shared/fx.js 抽出「引擎 + 特效庫」而來，供所有 three 遊戲共用。
// three 遊戲載入時由 display/mobile 的 loadGameLibrary 自動附掛（緊鄰 lowpoly.js），
// 暴露全域 FX：
//   const fx = new FX.Manager(scene);
//   fx.spawn('fireball', { x, y, dir, speed, life, key });  // 建立特效
//   fx.update(dt);                                           // 每幀推進（自動回收）
//   fx.kill(key);                                            // 投射物命中時提前消掉
//   FX.register('myfx', o => ({ obj, life, tick(dt, p) {} }));// 註冊自訂特效
//
// 設計：
// - 特效 = 短生命 THREE.Group；死亡自動從場景移除，材質隨特效拋棄（量小，不共用池）。
// - 發光類（火球/冰柱/治癒/音波…）用 AdditiveBlending（FX.glowMat）；
//   實體類（石塊/箭/泡泡）用一般材質（FX.flatMat）。
// - builder(opts) 回傳 { obj, life, tick(dt, p) }：tick 回傳 false 可提前結束，p = 進度 0..1。
// - 內建 12 種特效（fireball/ice/arrow/whirl/heal/puff/ring/cone/burst/sleepwave/stonecast/zzz），
//   視覺泛用；要客製外觀的遊戲用 FX.register 疊加自己的 builder。
// 相依：全域 THREE（本檔一律在 three.min.js 之後載入）+ document。遊戲專屬的 spawn 規則
//       （投射物起點、技能→特效對照、狀態染色）留在各遊戲的模組層，不放這裡。
// ============================================================
(function (global) {
  'use strict';

  // ---- 材質小工具 ----
  function glowMat(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: opacity == null ? 0.9 : opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }
  function flatMat(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: opacity == null ? 1 : opacity, depthWrite: false,
    });
  }

  // ---- 文字貼圖（描邊 + 填色，回傳 CanvasTexture）----
  function textTexture(text, opt) {
    opt = opt || {};
    var size = opt.size || 64;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    g.font = opt.font || 'bold 48px "PingFang TC","Microsoft JhengHei",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var cx = size / 2, cy = size / 2 + 2;
    if (opt.stroke) {
      g.lineWidth = opt.strokeWidth || 8;
      g.strokeStyle = opt.stroke;
      g.strokeText(text, cx, cy);
    }
    g.fillStyle = opt.fill || '#ffffff';
    g.fillText(text, cx, cy);
    return new THREE.CanvasTexture(c);
  }

  // ---- zzz 的「Z」字貼圖（全域共用一張）----
  var _zzzTex = null;
  function zzzTexture() {
    if (!_zzzTex) _zzzTex = textTexture('Z', { stroke: 'rgba(30,40,90,0.9)', fill: '#cfe4ff' });
    return _zzzTex;
  }

  // ============================================================
  // 特效建造表：kind -> function(opts) 回傳 { obj, life, tick(dt, p) }
  // tick 回傳 false 可提前結束；p = 進度 0..1。
  // ============================================================
  var builders = {

    // 火球：橘光核心 + 光暈 + 尾焰粒子，直線前進
    fireball: function (o) {
      var g = new THREE.Group();
      var core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glowMat(0xffdd66, 0.95));
      var glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), glowMat(0xff7722, 0.5));
      g.add(core); g.add(glow);
      var tails = [];
      for (var i = 0; i < 6; i++) {
        var m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), glowMat(0xff9933, 0.5));
        g.add(m); tails.push(m);
      }
      g.position.set(o.x, o.y, 0);
      var dir = o.dir || 1, speed = o.speed || 15;
      var tt = 0;
      return {
        obj: g, life: o.life || 2,
        tick: function (dt, p) {
          tt += dt;
          g.position.x += dir * speed * dt;
          core.scale.setScalar(1 + Math.sin(tt * 18) * 0.1);
          glow.material.opacity = 0.42 + Math.sin(tt * 24) * 0.08;
          for (var i = 0; i < tails.length; i++) {
            var k = (i + 1) / tails.length;
            tails[i].position.set(-dir * k * 1.1, Math.sin(tt * 9 + i * 1.7) * 0.12, 0);
            tails[i].material.opacity = 0.5 * (1 - k);
          }
        },
      };
    },

    // 冰柱：一排翻滾的冰錐，緩慢前進、上下漂浮
    ice: function (o) {
      var g = new THREE.Group();
      var spikes = [];
      for (var i = 0; i < 5; i++) {
        var m = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.95, 6), glowMat(0x9fdcff, 0.85));
        m.rotation.z = (o.dir || 1) > 0 ? -Math.PI / 2 : Math.PI / 2;
        m.position.set((i - 2) * 0.45, (i % 2) * 0.5 - 0.2, 0);
        g.add(m); spikes.push(m);
      }
      g.position.set(o.x, o.y, 0);
      var dir = o.dir || 1, speed = o.speed || 11;
      var tt = 0;
      return {
        obj: g, life: o.life || 2.5,
        tick: function (dt) {
          tt += dt;
          g.position.x += dir * speed * dt;
          g.position.y = o.y + Math.sin(tt * 7) * 0.15;
          for (var i = 0; i < spikes.length; i++) spikes[i].rotation.x = tt * 5 + i;
        },
      };
    },

    // 箭：木桿 + 金屬箭頭，可帶垂直速度（散佈用）
    arrow: function (o) {
      var g = new THREE.Group();
      var dir = o.dir || 1;
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 5), flatMat(0xd8c49a));
      shaft.rotation.z = Math.PI / 2;
      g.add(shaft);
      var tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 6), flatMat(0xf2f2f2));
      tip.rotation.z = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      tip.position.x = dir * 0.68;
      g.add(tip);
      var trail = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.1), glowMat(0xcfe8ff, 0.35));
      trail.position.x = -dir * 0.9;
      g.add(trail);
      g.position.set(o.x, o.y, 0);
      var speed = o.speed || 19, vy = o.vy || 0;
      return {
        obj: g, life: o.life || 1.5,
        tick: function (dt) {
          g.position.x += dir * speed * dt;
          g.position.y += vy * dt;
          g.rotation.z = Math.atan2(vy, dir * speed);
        },
      };
    },

    // 旋風：三圈反向旋轉的環，擴散淡出
    whirl: function (o) {
      var g = new THREE.Group();
      var rings = [];
      for (var i = 0; i < 3; i++) {
        var r = new THREE.Mesh(
          new THREE.TorusGeometry(1.2 + i * 0.55, 0.09, 6, 28, Math.PI * 1.4),
          glowMat(0xbfe8ff, 0.85)
        );
        r.rotation.x = -Math.PI / 2;
        r.position.y = 0.6 + i * 0.55;
        g.add(r); rings.push(r);
      }
      g.position.set(o.x, o.y, 0);
      var tt = 0;
      return {
        obj: g, life: 0.6,
        tick: function (dt, p) {
          tt += dt;
          for (var i = 0; i < rings.length; i++) {
            rings[i].rotation.z = tt * (14 - i * 3) * (i % 2 ? -1 : 1);
            rings[i].scale.setScalar(0.6 + p * 1.15);
            rings[i].material.opacity = 0.85 * (1 - p);
          }
        },
      };
    },

    // 治療：綠光點螺旋上升 + 發光十字
    heal: function (o) {
      var g = new THREE.Group();
      var ps = [];
      for (var i = 0; i < 12; i++) {
        var m = new THREE.Mesh(new THREE.SphereGeometry(0.09 + Math.random() * 0.08, 6, 5), glowMat(0x7dff9a, 0.9));
        m.userData = { a: Math.random() * Math.PI * 2, r: 0.4 + Math.random() * 0.7, v: 1.6 + Math.random() * 1.2, y0: Math.random() * 0.6 };
        g.add(m); ps.push(m);
      }
      var crossMat = glowMat(0x9dffb0, 0.8);
      var crossH = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.26, 0.05), crossMat);
      var crossV = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.9, 0.05), crossMat);
      crossH.position.y = 2.6; crossV.position.y = 2.6;
      g.add(crossH); g.add(crossV);
      g.position.set(o.x, o.y, 0);
      var tt = 0;
      return {
        obj: g, life: 1.1,
        tick: function (dt, p) {
          tt += dt;
          for (var i = 0; i < ps.length; i++) {
            var u = ps[i].userData;
            u.a += dt * 2.2;
            var y = u.y0 + tt * u.v;
            ps[i].position.set(Math.cos(u.a) * u.r, y, Math.sin(u.a) * u.r * 0.4);
            ps[i].material.opacity = 0.9 * Math.max(0, 1 - y / 2.6);
          }
          crossMat.opacity = 0.8 * (1 - p);
          var s = 1 + p * 0.6;
          crossH.scale.setScalar(s); crossV.scale.setScalar(s);
        },
      };
    },

    // 煙霧（閃避/閃現 的起點與落點）
    puff: function (o) {
      var g = new THREE.Group();
      var mat = flatMat(0xf0f0f0, 0.75);
      var ps = [];
      for (var i = 0; i < 7; i++) {
        var m = new THREE.Mesh(new THREE.SphereGeometry(0.28 + Math.random() * 0.2, 7, 6), mat);
        var a = (i / 7) * Math.PI * 2;
        m.userData = { vx: Math.cos(a) * (1 + Math.random()), vy: Math.random() * 1.6 + 0.4, vz: (Math.random() - 0.5) * 0.6 };
        g.add(m); ps.push(m);
      }
      g.position.set(o.x, (o.y || 0) + 0.9, 0);
      return {
        obj: g, life: 0.55,
        tick: function (dt, p) {
          for (var i = 0; i < ps.length; i++) {
            var u = ps[i].userData;
            ps[i].position.x += u.vx * dt;
            ps[i].position.y += u.vy * dt;
            ps[i].position.z += u.vz * dt;
            ps[i].scale.setScalar(1 + p * 1.6);
          }
          mat.opacity = 0.75 * (1 - p);
        },
      };
    },

    // 泡泡：一圈泡泡向外擴散、輕輕上浮、尾聲破掉
    ring: function (o) {
      var g = new THREE.Group();
      var n = 14;
      var bs = [];
      for (var i = 0; i < n; i++) {
        var m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glowMat(0xaee9ff, 0.65));
        m.userData = { a: (i / n) * Math.PI * 2, ph: Math.random() * 6 };
        g.add(m); bs.push(m);
      }
      g.position.set(o.x, (o.y || 0) + 1.0, 0);
      var maxR = o.maxR || 4.8;
      var tt = 0;
      return {
        obj: g, life: o.dur || 1.0,
        tick: function (dt, p) {
          tt += dt;
          var r = 0.4 + p * maxR;
          for (var i = 0; i < bs.length; i++) {
            var u = bs[i].userData;
            bs[i].position.set(Math.cos(u.a) * r, Math.sin(tt * 5 + u.ph) * 0.25 + p * 0.5, Math.sin(u.a) * r * 0.25);
            bs[i].scale.setScalar(0.6 + p * 0.9);
            bs[i].material.opacity = 0.65 * (1 - p * p);
          }
        },
      };
    },

    // 音波：三道扇形波紋向前擴散
    cone: function (o) {
      var g = new THREE.Group();
      var dir = o.dir || 1;
      var waves = [];
      for (var i = 0; i < 3; i++) {
        var w = new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.12, 6, 20, Math.PI * 0.7),
          glowMat(0xffe28a, 0.75)
        );
        // Torus 弧從 +x 軸逆時針畫；旋到「開口朝正前方」
        w.rotation.z = dir > 0 ? -Math.PI * 0.35 : Math.PI * 0.65;
        g.add(w); waves.push(w);
      }
      g.position.set(o.x, (o.y || 0) + 1.2, 0);
      var range = o.range || 5.5;
      return {
        obj: g, life: 0.6,
        tick: function (dt, p) {
          for (var i = 0; i < waves.length; i++) {
            var k = Math.max(0, p * 1.35 - i * 0.16);
            waves[i].scale.setScalar(Math.max(0.01, 0.3 + k * range));
            waves[i].material.opacity = 0.75 * Math.max(0, 1 - k * 1.2);
          }
        },
      };
    },

    // 爆炸：橘色閃光 + 石塊噴發（重力、落地反彈）
    burst: function (o) {
      var g = new THREE.Group();
      var flash = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 10), glowMat(0xffb347, 0.9));
      flash.position.y = 1.1;
      g.add(flash);
      var rocks = [];
      for (var i = 0; i < 12; i++) {
        var m = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.22, 0),
          new THREE.MeshLambertMaterial({ color: i % 3 ? 0x8a6b4a : 0x6e5638 })
        );
        var a = Math.random() * Math.PI * 2;
        m.userData = {
          vx: Math.cos(a) * (2 + Math.random() * 4.5), vy: 4 + Math.random() * 6,
          vz: (Math.random() - 0.5) * 2, rx: (Math.random() - 0.5) * 10, ry: (Math.random() - 0.5) * 10,
        };
        m.position.set(0, 1.1, 0);
        g.add(m); rocks.push(m);
      }
      g.position.set(o.x, o.y || 0, 0);
      return {
        obj: g, life: 1.15,
        tick: function (dt, p) {
          flash.scale.setScalar(1 + p * 3.2);
          flash.material.opacity = 0.9 * Math.max(0, 1 - p * 2.2);
          for (var i = 0; i < rocks.length; i++) {
            var u = rocks[i].userData;
            u.vy -= 22 * dt;
            rocks[i].position.x += u.vx * dt;
            rocks[i].position.y += u.vy * dt;
            rocks[i].position.z += u.vz * dt;
            if (rocks[i].position.y < 0.1) { rocks[i].position.y = 0.1; u.vy *= -0.35; u.vx *= 0.7; }
            rocks[i].rotation.x += u.rx * dt;
            rocks[i].rotation.y += u.ry * dt;
          }
        },
      };
    },

    // 催眠波：紫色圓環一波波向外擴散
    sleepwave: function (o) {
      var g = new THREE.Group();
      var rings = [];
      for (var i = 0; i < 3; i++) {
        var r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 6, 32), glowMat(0xc99fff, 0.7));
        r.rotation.x = -Math.PI / 2;
        r.position.y = 1.0;
        g.add(r); rings.push(r);
      }
      g.position.set(o.x, o.y || 0, 0);
      var maxR = o.maxR || 4.5;
      return {
        obj: g, life: 0.8,
        tick: function (dt, p) {
          for (var i = 0; i < rings.length; i++) {
            var k = Math.max(0, p * 1.4 - i * 0.18);
            rings[i].scale.setScalar(Math.max(0.01, 0.3 + k * maxR));
            rings[i].material.opacity = 0.7 * Math.max(0, 1 - k);
          }
        },
      };
    },

    // 石化：灰色衝擊環 + 石屑
    stonecast: function (o) {
      var g = new THREE.Group();
      var ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.14, 6, 24), flatMat(0xb0b0b0, 0.8));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.15;
      g.add(ring);
      var mat = flatMat(0x9a9a9a, 0.8);
      var ps = [];
      for (var i = 0; i < 8; i++) {
        var m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.12, 0), mat);
        var a = (i / 8) * Math.PI * 2;
        m.userData = { vx: Math.cos(a) * 2.2, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) };
        m.position.y = 0.8;
        g.add(m); ps.push(m);
      }
      g.position.set(o.x, o.y || 0, 0);
      return {
        obj: g, life: 0.7,
        tick: function (dt, p) {
          ring.scale.setScalar(0.4 + p * 2.6);
          ring.material.opacity = 0.8 * (1 - p);
          for (var i = 0; i < ps.length; i++) {
            var u = ps[i].userData;
            u.vy -= 14 * dt;
            ps[i].position.x += u.vx * dt;
            ps[i].position.y = Math.max(0.1, ps[i].position.y + u.vy * dt);
            ps[i].position.z += u.vz * dt;
          }
          mat.opacity = 0.8 * (1 - p);
        },
      };
    },

    // 睡眠「Z」：上浮飄動淡出（由狀態機定期 spawn）
    zzz: function (o) {
      var g = new THREE.Group();
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: zzzTexture(), transparent: true, opacity: 0.95 }));
      sp.scale.set(0.7, 0.7, 1);
      g.add(sp);
      g.position.set(o.x, (o.y || 0) + 2.6, 0);
      var tt = 0;
      return {
        obj: g, life: 1.3,
        tick: function (dt, p) {
          tt += dt;
          sp.position.y = tt * 0.9;
          sp.position.x = Math.sin(tt * 3) * 0.2;
          var s = 0.5 + p * 0.6;
          sp.scale.set(s, s, 1);
          sp.material.opacity = 0.95 * (1 - p);
        },
      };
    },
  };

  // ============================================================
  // Manager：特效生命週期管理。每個場景各持一份：new FX.Manager(scene)。
  // ============================================================
  function Manager(scene) {
    this.scene = scene;
    this.items = [];
    this._keyed = new Map(); // key -> item（投射物類，供 kill 提前消掉）
  }
  Manager.prototype.spawn = function (kind, opts) {
    var fn = builders[kind];
    if (!fn) return null;
    opts = opts || {};
    var it = fn(opts);
    if (!it) return null;
    it.kind = kind;
    it.t = 0;
    it.dead = false;
    if (opts.key) { it.key = opts.key; this._keyed.set(opts.key, it); }
    this.scene.add(it.obj);
    this.items.push(it);
    return it;
  };
  Manager.prototype.kill = function (key) {
    var it = this._keyed.get(key);
    if (it) it.dead = true;
  };
  Manager.prototype.update = function (dt) {
    for (var i = this.items.length - 1; i >= 0; i--) {
      var it = this.items[i];
      it.t += dt;
      var p = Math.min(1, it.t / it.life);
      if (it.tick && !it.dead) it.tick(dt, p);
      if (it.dead || it.t >= it.life) {
        this.scene.remove(it.obj);
        if (it.key) this._keyed.delete(it.key);
        this.items.splice(i, 1);
      }
    }
  };
  // 一次清掉全部（階段結束時可呼叫）。
  Manager.prototype.clear = function () {
    for (var i = 0; i < this.items.length; i++) this.scene.remove(this.items[i].obj);
    this.items.length = 0;
    this._keyed.clear();
  };

  global.FX = {
    Manager: Manager,
    builders: builders,
    register: function (name, fn) { builders[name] = fn; return this; },
    glowMat: glowMat,
    flatMat: flatMat,
    textTexture: textTexture,
  };
})(typeof window !== 'undefined' ? window : this);

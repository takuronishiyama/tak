/* =========================================================
   レース観戦ビュー（Canvasでドット絵の車が周回する）
   ========================================================= */
window.GP = window.GP || {};

GP.raceview = (function () {
  'use strict';

  let cv, ctx, res, poly, trackArt = null, raf = null;
  let vt = 0, speed = 40, running = false, onEnd = null, lastTs = 0, lights = 0, duration = 1;
  let shownEvents = 0;

  /* ---------- コース形状（geom.js と共有）---------- */
  function buildPoly(path, w, h, pad) { return GP.geom.buildPoly(path, w, h, pad); }

  /* コース上の距離割合 f (0..1) から座標と進行方向を得る */
  function pointAt(f) {
    f = f - Math.floor(f);
    const target = f * poly.len;
    let lo = 0, hi = poly.n;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (poly.cum[m] <= target) lo = m; else hi = m; }
    return interp(lo, (target - poly.cum[lo]) / (poly.ds[lo] || 1));
  }

  /* 折れ線の index 番目から t だけ進んだ位置 */
  function interp(i, t) {
    const a = poly.pts[i % poly.n], b = poly.pts[(i + 1) % poly.n];
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), i: i };
  }

  /* ---------- 1周の中での位置 ----------
     各車の速度プロファイル（コーナーで減速し直線で伸びる）に沿って
     時間 → コース上の位置 を引く。プロファイルはマシンの3性能で変わるので、
     ダウンフォース型はコーナーで、パワー型は直線で前に出る。            */
  function placeInLap(e, frac) {
    const prof = e._prof;
    if (!prof) return pointAt(frac);
    frac = frac - Math.floor(frac);
    const cumT = prof.cumT;
    let lo = 0, hi = prof.n;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cumT[m] <= frac) lo = m; else hi = m; }
    const span = cumT[lo + 1] - cumT[lo] || 1;
    const r = interp(lo, (frac - cumT[lo]) / span);
    r.v = prof.v[lo] / prof.vmax;      // 0..1 の現在速度（描画に使う）
    return r;
  }

  /* ---------- 各車の周回進捗 ---------- */
  function progress(e, t) {
    if (e.dnf && e.dnfLap > 0 && t >= (e.cum[e.dnfLap - 1] || 0)) {
      return { done: true, p: e.dnfLap };
    }
    const n = e.cum.length;
    if (t >= e.cum[n - 1]) return { done: true, p: n };
    let lap = 0;
    while (lap < n && e.cum[lap] <= t) lap++;
    const prev = lap === 0 ? 0 : e.cum[lap - 1];
    const lt = e.lapTimes[lap] || 1;
    return { done: false, p: lap + (t - prev) / lt };
  }

  function orderAt(t) {
    return res.entries.slice().map(e => {
      const pr = progress(e, t);
      return { e, p: pr.p, done: pr.done, out: e.dnf && t >= (e.cum[e.dnfLap - 1] || 0) };
    }).sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;
      return b.p - a.p;
    });
  }

  /* =========================================================
     コースの描き込み（背景・縁石・グリッド・ピット・DRS区間）
     静止物なので一度だけ裏画面に描き、毎フレームはコピーするだけにする
     ========================================================= */
  function normalAt(i) {
    const a = poly.pts[i % poly.n], b = poly.pts[(i + 1) % poly.n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    return { nx: -dy / L, ny: dx / L, x: a[0], y: a[1], dx: dx / L, dy: dy / L };
  }

  function strokeOn(g, width, color, dash) {
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
    g.setLineDash(dash || []);
    g.beginPath();
    g.moveTo(poly.pts[0][0], poly.pts[0][1]);
    for (let i = 1; i < poly.n; i++) g.lineTo(poly.pts[i][0], poly.pts[i][1]);
    g.closePath(); g.stroke();
    g.setLineDash([]);
  }

  function buildTrackArt() {
    const th = GP.data.THEMES[GP.data.TRACK_THEME[res.track.name] || 'grass'];
    const wet = res.weather.key === 'rain' || res.weather.key === 'storm';
    const c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d');

    // 地面
    g.fillStyle = wet && !th.night ? shade(th.sky, -0.22) : th.sky;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = wet && !th.night ? shade(th.dot, -0.22) : th.dot;
    for (let y = 0; y < c.height; y += 8) for (let x = (y % 16 ? 0 : 4); x < c.width; x += 16) g.fillRect(x, y, 4, 4);

    // コースの外に景色を置く
    drawScenery(g, GP.data.TRACK_THEME[res.track.name] || 'grass', c.width, c.height);

    // ランオフ／コース
    strokeOn(g, 30, th.edge);
    strokeOn(g, 22, wet ? shade(th.road, -0.18) : th.road);
    strokeOn(g, 2, 'rgba(255,255,255,.30)', [6, 10]);

    // 縁石（コーナー区間の内外両側）
    (res.geo.corners || []).forEach(cn => {
      let i = cn.from, steps = 0;
      const span = (cn.to - cn.from + poly.n) % poly.n;
      while (steps <= span && steps < poly.n) {
        const nm = normalAt(i);
        g.fillStyle = (steps >> 1) % 2 === 0 ? '#e8402c' : '#f4f0e0';
        for (const sgn of [1, -1]) {
          g.save();
          g.translate(nm.x + nm.nx * sgn * 12, nm.y + nm.ny * sgn * 12);
          g.rotate(Math.atan2(nm.dy, nm.dx));
          g.fillRect(-1.5, -2.5, 4, 5);
          g.restore();
        }
        i = (i + 1) % poly.n; steps++;
      }
    });

    // DRS区間（最長ストレート）の路面表示
    const L = res.geo.longest;
    if (L && L.len > 0) {
      let i = L.from, steps = 0;
      const span = (L.to - L.from + poly.n) % poly.n;
      while (steps <= span && steps < poly.n) {
        if (steps % 6 < 3) {
          const nm = normalAt(i);
          g.fillStyle = 'rgba(90,190,255,.45)';
          g.fillRect(nm.x + nm.nx * 8 - 1, nm.y + nm.ny * 8 - 1, 2, 2);
          g.fillRect(nm.x - nm.nx * 8 - 1, nm.y - nm.ny * 8 - 1, 2, 2);
        }
        i = (i + 1) % poly.n; steps++;
      }
      const s0 = normalAt(L.from);
      g.fillStyle = '#5abeff'; g.strokeStyle = '#1a3a5a'; g.lineWidth = 1;
      g.save();
      g.translate(s0.x + s0.nx * 20, s0.y + s0.ny * 20);
      g.fillRect(-7, -4, 14, 8); g.strokeRect(-7, -4, 14, 8);
      g.fillStyle = '#0a2036'; g.font = 'bold 6px sans-serif'; g.textAlign = 'center';
      g.fillText('DRS', 0, 2);
      g.restore();
    }

    // ピットレーン：スタート地点を含む最長ストレートの内側に収める
    const pit = pitSpan();
    if (pit) {
      g.strokeStyle = '#6d7078'; g.lineWidth = 9; g.lineCap = 'butt';
      g.beginPath();
      for (let k = 0; k <= pit.len; k++) {
        const nm = normalAt((pit.from + k) % poly.n);
        const x = nm.x + nm.nx * pit.side * 20, y = nm.y + nm.ny * pit.side * 20;
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      for (let k = 5; k < pit.len - 4; k += 7) {
        const nm = normalAt((pit.from + k) % poly.n);
        g.save();
        g.translate(nm.x + nm.nx * pit.side * 28, nm.y + nm.ny * pit.side * 28);
        g.rotate(Math.atan2(nm.dy, nm.dx));
        g.fillStyle = '#efe6cc'; g.fillRect(-3, -4, 6, 8);
        g.fillStyle = '#4a2f1a'; g.fillRect(-3, -4, 6, 1);
        g.restore();
      }
    }

    // スタートグリッド（スタートラインの手前に千鳥で並べる）
    for (let n = 0; n < 22; n++) {
      const back = 6 + Math.floor(n / 2) * 7;
      const idx = (poly.n - back) % poly.n;
      const nm = normalAt(idx);
      const sgn = n % 2 === 0 ? 1 : -1;
      g.save();
      g.translate(nm.x + nm.nx * sgn * 5.5, nm.y + nm.ny * sgn * 5.5);
      g.rotate(Math.atan2(nm.dy, nm.dx));
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1;
      g.strokeRect(-2.5, -2, 5, 4);
      g.restore();
    }

    // セクター標識
    (res.geo.sectors || []).forEach((sc, si) => {
      const nm = normalAt(sc.from % poly.n);
      const col = ['#f0a020', '#4ea63f', '#3a7ad9'][si];
      g.save();
      g.translate(nm.x, nm.y); g.rotate(Math.atan2(nm.dy, nm.dx));
      g.fillStyle = col; g.fillRect(-1.5, -13, 3, 26);
      g.fillStyle = '#fffdf3'; g.strokeStyle = '#4a2f1a'; g.lineWidth = 1;
      g.fillRect(-6, -21, 12, 8); g.strokeRect(-6, -21, 12, 8);
      g.fillStyle = col; g.font = 'bold 7px sans-serif'; g.textAlign = 'center';
      g.fillText('S' + (si + 1), 0, -15);
      g.restore();
    });

    // 名物コーナーの表示（曲率の急なコーナーから順に名前を割り当てる）
    const marks = (res.geo.corners || []).slice().sort((a, b) => b.peak - a.peak)
      .slice(0, (res.track.landmarks || []).length);
    marks.forEach((cn, mi) => {
      const nm = normalAt(Math.round((cn.from + ((cn.to - cn.from + poly.n) % poly.n) / 2)) % poly.n);
      const label = res.track.landmarks[mi];
      const cxm = nm.x + nm.nx * 26, cym = nm.y + nm.ny * 26;
      if (cxm < 4 || cym < 4 || cxm > c.width - 4 || cym > c.height - 4) return;
      g.font = 'bold 8px sans-serif'; g.textAlign = 'center';
      const w2 = g.measureText(label).width + 8;
      g.fillStyle = 'rgba(74,47,26,.82)';
      g.fillRect(cxm - w2 / 2, cym - 6, w2, 11);
      g.fillStyle = '#ffeec4';
      g.fillText(label, cxm, cym + 2);
    });

    // スタート／フィニッシュライン
    const sf = normalAt(0);
    g.save();
    g.translate(sf.x, sf.y); g.rotate(Math.atan2(sf.dy, sf.dx));
    for (let i = -12; i < 12; i += 4) {
      g.fillStyle = ((i / 4) % 2 === 0) ? '#fff' : '#333';
      g.fillRect(-3, i, 6, 4);
    }
    g.restore();

    return c;
  }

  /* ---------- コース外の景色 ---------- */
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h = (h * 1103515245 + 12345) >>> 0; return h / 4294967296; };
  }

  function distToTrack(x, y) {
    let m = Infinity;
    for (let i = 0; i < poly.n; i += 2) {
      const dx = poly.pts[i][0] - x, dy = poly.pts[i][1] - y;
      const d = dx * dx + dy * dy;
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  }

  function drawScenery(g, theme, W, H) {
    const rnd = seeded(res.track.name);
    const pit = pitSpan();
    // 観客席（メインストレートの、ピットと反対側）
    if (pit) {
      for (let k = 2; k < pit.len - 2; k += 9) {
        const nm = normalAt((pit.from + k) % poly.n);
        const sx = nm.x - nm.nx * pit.side * 30, sy = nm.y - nm.ny * pit.side * 30;
        if (sx < 8 || sy < 8 || sx > W - 8 || sy > H - 8) continue;
        g.save();
        g.translate(sx, sy); g.rotate(Math.atan2(nm.dy, nm.dx));
        g.fillStyle = '#b8b2a4'; g.fillRect(-5, -8, 10, 16);
        g.fillStyle = '#8f8a7e'; g.fillRect(-5, -8, 10, 2);
        for (let r = -6; r < 7; r += 3) {          // 観客のドット
          g.fillStyle = ['#e04a3f', '#3a7ad9', '#f0a020', '#4ea63f'][(r + 6) % 4];
          g.fillRect(-3, r, 2, 2); g.fillRect(1, r, 2, 2);
        }
        g.restore();
      }
    }
    // 木・建物・岩など
    for (let i = 0; i < poly.n; i += 11) {
      for (const side of [1, -1]) {
        if (rnd() > 0.62) continue;
        const nm = normalAt(i);
        const d = 38 + rnd() * 34;
        const x = nm.x + nm.nx * side * d, y = nm.y + nm.ny * side * d;
        if (x < 10 || y < 10 || x > W - 10 || y > H - 10) continue;
        if (distToTrack(x, y) < 30) continue;
        drawProp(g, theme, x, y, rnd);
      }
    }
  }

  function drawProp(g, theme, x, y, rnd) {
    x = Math.round(x); y = Math.round(y);
    const box = (bx, by, bw, bh, fill, line) => {
      g.fillStyle = line; g.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      g.fillStyle = fill; g.fillRect(bx, by, bw, bh);
    };
    if (theme === 'street') {
      const w = 14 + Math.round(rnd() * 12), h = 16 + Math.round(rnd() * 18);
      box(x - w / 2, y - h, w, h, ['#8e94a0', '#7c828e', '#9aa0ac'][Math.floor(rnd() * 3)], '#4a4f58');
      g.fillStyle = 'rgba(255,240,180,.6)';
      for (let a = 3; a < w - 3; a += 5) for (let b = 4; b < h - 3; b += 6) g.fillRect(x - w / 2 + a, y - h + b, 3, 3);
      g.fillStyle = '#5c626c'; g.fillRect(x - w / 2, y - h, w, 3);
    } else if (theme === 'neon') {
      const w = 12 + Math.round(rnd() * 12), h = 20 + Math.round(rnd() * 22);
      box(x - w / 2, y - h, w, h, '#2a3050', '#151a2e');
      const nc = ['#ff4fa0', '#4fd8ff', '#ffe14f', '#8cff6a'][Math.floor(rnd() * 4)];
      g.fillStyle = nc;
      g.fillRect(x - w / 2 + 2, y - h + 3, w - 4, 3);
      g.fillRect(x - w / 2 + 2, y - h + 9, Math.max(3, w - 8), 3);
      g.fillStyle = 'rgba(255,255,255,.25)';
      for (let b = 16; b < h - 3; b += 6) g.fillRect(x - w / 2 + 3, y - h + b, w - 6, 2);
    } else if (theme === 'desert') {
      if (rnd() < 0.5) {                       // ヤシの木
        g.fillStyle = '#5a4426'; g.fillRect(x - 2, y - 18, 4, 18);
        g.fillStyle = '#8a6a3a'; g.fillRect(x - 1, y - 18, 2, 18);
        g.fillStyle = '#2f6b38';
        g.fillRect(x - 11, y - 21, 9, 3); g.fillRect(x + 2, y - 21, 9, 3);
        g.fillRect(x - 8, y - 24, 6, 3);  g.fillRect(x + 2, y - 24, 6, 3);
        g.fillStyle = '#3f8a4a'; g.fillRect(x - 3, y - 23, 6, 3);
      } else {                                  // 岩
        box(x - 7, y - 9, 14, 9, '#a08860', '#6e5a3c');
        g.fillStyle = '#c0a880'; g.fillRect(x - 5, y - 8, 6, 3);
      }
    } else {                                    // 木（芝・森・高原）
      const dark = theme === 'forest';
      g.fillStyle = '#4a3218'; g.fillRect(x - 2, y - 7, 4, 7);
      g.fillStyle = '#6a4a2a'; g.fillRect(x - 1, y - 7, 2, 7);
      const c1 = dark ? '#245a28' : '#317031', c2 = dark ? '#3d8340' : '#54a84e';
      g.fillStyle = '#1c4420';
      g.fillRect(x - 9, y - 17, 18, 11); g.fillRect(x - 6, y - 21, 12, 5);
      g.fillStyle = c1;
      g.fillRect(x - 8, y - 16, 16, 9); g.fillRect(x - 5, y - 20, 10, 4);
      g.fillStyle = c2;
      g.fillRect(x - 6, y - 15, 7, 4); g.fillRect(x - 3, y - 19, 5, 3);
    }
  }

  /* ピットレーンを敷く区間。最長ストレートの内側に収め、外向きの法線を選ぶ */
  function pitSpan() {
    const L = res.geo.longest;
    if (!L || L.len <= 0) return null;
    const span = (L.to - L.from + poly.n) % poly.n;
    if (span < 14) return null;
    const from = (L.from + 3) % poly.n;
    const len = Math.min(span - 6, Math.round(poly.n * 0.22));
    // コース全体の重心から見て外を向くほうへ寄せる
    let cx = 0, cy = 0;
    for (let i = 0; i < poly.n; i++) { cx += poly.pts[i][0]; cy += poly.pts[i][1]; }
    cx /= poly.n; cy /= poly.n;
    const mid = normalAt((from + (len >> 1)) % poly.n);
    const side = ((mid.x - cx) * mid.nx + (mid.y - cy) * mid.ny) >= 0 ? 1 : -1;
    return { from: from, len: len, side: side };
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return 'rgb(' + f((n >> 16) & 255) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }

  /* ---------- 毎フレームの描画 ---------- */
  function draw(t) {
    const w = cv.width, h = cv.height;
    const wet = res.weather.key === 'rain' || res.weather.key === 'storm';

    if (trackArt) ctx.drawImage(trackArt, 0, 0); else { ctx.fillStyle = '#7fbf5a'; ctx.fillRect(0, 0, w, h); }

    // 雨演出
    if (wet) {
      ctx.strokeStyle = 'rgba(180,210,255,.45)'; ctx.lineWidth = 1;
      for (let i = 0; i < 60; i++) {
        const x = (i * 97 + t * 260) % w, y = (i * 53 + t * 900) % h;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 9); ctx.stroke();
      }
    }

    // 車
    const ord = orderAt(t);
    for (let i = ord.length - 1; i >= 0; i--) {
      const o = ord[i], e = o.e;
      const pt = placeInLap(e, o.p);
      drawCar(pt.x, pt.y, pt.ang, e.color, e.isPlayer, o.out, e.gen || 0, pt.v == null ? 1 : pt.v);
    }
  }

  function drawCar(x, y, ang, color, isPlayer, out, gen, vel) {
    gen = Math.max(0, Math.min(5, gen | 0));
    vel = vel == null ? 1 : vel;
    const len = 15 + gen;                  // ボディ長
    const rw = 3 + (gen >= 2 ? 1 : 0);     // リアウイング幅
    const rh = 8 + (gen >= 3 ? 2 : 0);     // リアウイング高
    const fh = 6 + (gen >= 2 ? 1 : 0);     // フロントウイング高
    const nose = 7 + Math.floor(gen / 2);

    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(ang);
    ctx.globalAlpha = out ? 0.28 : 1;
    if (!out) {
      if (vel > 0.82) {
        // 高速域はスピードラインを引いて伸びを見せる
        ctx.strokeStyle = 'rgba(255,255,255,' + ((vel - 0.82) * 2.2).toFixed(2) + ')';
        ctx.lineWidth = 1;
        const tail = 6 + (vel - 0.82) * 50;
        ctx.beginPath();
        ctx.moveTo(-9, -2); ctx.lineTo(-9 - tail, -2);
        ctx.moveTo(-9, 2);  ctx.lineTo(-9 - tail, 2);
        ctx.stroke();
      } else if (vel < 0.52) {
        // 減速中はブレーキランプを灯す
        ctx.fillStyle = 'rgba(255,60,40,' + (0.5 + (0.52 - vel)).toFixed(2) + ')';
        ctx.fillRect(-10, -2, 2, 4);
      }
    }
    // 影
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-6, -3, len - 1, 8);
    // タイヤ
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-6, -5, 4, 3); ctx.fillRect(-6, 2, 4, 3);
    ctx.fillRect(3, -5, 4, 3);  ctx.fillRect(3, 2, 4, 3);
    // サイドポッド（第3世代以降）
    if (gen >= 3) { ctx.fillStyle = color; ctx.fillRect(-3, -5, 6, 2); ctx.fillRect(-3, 3, 6, 2); }
    // ボディ
    ctx.fillStyle = color;
    ctx.fillRect(-7, -2, len, 4);
    ctx.fillRect(-8, -rh / 2, rw, rh);      // リアウイング
    ctx.fillRect(nose, -fh / 2, 3, fh);     // フロントウイング
    // エンジンカバーのフィン（第4世代以降）
    if (gen >= 4) { ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.fillRect(-6, -1, 5, 2); }
    // ハイライト
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(-4, -2, 8, 1);
    // コクピット（第5世代はハロ付き）
    ctx.fillStyle = '#222'; ctx.fillRect(-1, -1, 3, 2);
    if (gen >= 5) { ctx.fillStyle = '#555'; ctx.fillRect(2, -2, 1, 4); }
    ctx.restore();

    if (isPlayer && !out) {
      // 自チームは矢印マーカー付き
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y) - 14);
      const bob = Math.sin(vt * 6) * 1.5;
      ctx.fillStyle = '#fff34d'; ctx.strokeStyle = '#4a2f1a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 8 + bob); ctx.lineTo(-5, 1 + bob); ctx.lineTo(5, 1 + bob); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- ループ ---------- */
  function tick(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    if (lights < 1) {
      lights = Math.min(1, lights + dt / 2.4);
      draw(0); drawLights(lights); updateHud();
      raf = requestAnimationFrame(tick);
      return;
    }
    // speed は「レース全体を何秒で見せるか」。実時間に対する倍率をそこから出す
    vt += dt * (duration / speed);
    if (vt >= duration) { vt = duration; running = false; draw(vt); updateHud(); flushEvents(true); finish(); return; }
    draw(vt);
    updateHud();
    raf = requestAnimationFrame(tick);
  }

  /* ---------- HUD（順位・ラップ・実況）---------- */
  function updateHud() {
    const ord = orderAt(vt);
    const leader = ord[0];
    const lap = Math.min(res.laps, Math.floor(leader.p) + 1);
    document.getElementById('rvLap').textContent = 'LAP ' + lap + ' / ' + res.laps;

    const box = document.getElementById('rvOrder');
    let html = '';
    ord.forEach((o, i) => {
      const e = o.e;
      const gapNum = leader.p - o.p;
      const gap = o.out ? 'DNF' : (i === 0 ? '先頭' : '-' + (gapNum * res.track.base).toFixed(1) + 's');
      html += '<div class="rv-row' + (e.isPlayer ? ' me' : '') + (o.out ? ' out' : '') + '">' +
        '<span class="rv-pos">' + (i + 1) + '</span>' +
        '<span class="rv-chip" style="background:' + e.color + '"></span>' +
        '<span class="rv-name">' + e.driver.name + '</span>' +
        '<span class="rv-gap">' + gap + '</span></div>';
    });
    box.innerHTML = html;
    advanceSectors(vt);
    renderSectors();
    flushEvents(false);
  }

  function flushEvents(all) {
    const lapNow = vt / (res.track.base) + 1;
    const log = document.getElementById('rvLog');
    while (shownEvents < res.events.length) {
      const ev = res.events[shownEvents];
      if (!all && ev.lap > lapNow) break;
      const div = document.createElement('div');
      div.className = 'rv-ev rv-' + ev.type;
      div.textContent = 'L' + ev.lap + ' ' + ev.text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      shownEvents++;
    }
  }

  /* =========================================================
     区間タイム
     各車の各セクター完了時刻を並べておき、再生の進行に合わせて
     セッション最速（紫）と自己ベスト（緑）を更新していく
     ========================================================= */
  let secTimeline = [], secPtr = 0, liveBest = [Infinity, Infinity, Infinity], liveCar = {};

  function buildSectorTimeline() {
    secTimeline = []; secPtr = 0;
    liveBest = [Infinity, Infinity, Infinity]; liveCar = {};
    res.entries.forEach(e => {
      liveCar[e.id] = { best: [Infinity, Infinity, Infinity], cur: [null, null, null],
                        at: [0, 0, 0], lastLap: null, lap: 0 };
      const laps = e.dnf && e.dnfLap > 0 ? e.dnfLap - 1 : e.sectors.length;
      for (let l = 0; l < laps; l++) {
        const sec = e.sectors[l];
        if (!sec) continue;
        const lapStart = l === 0 ? 0 : e.cum[l - 1];
        let acc = lapStart;
        for (let k = 0; k < 3; k++) {
          acc += sec[k];
          secTimeline.push({ t: acc, id: e.id, lap: l + 1, k: k, v: sec[k], lapTime: k === 2 ? e.lapTimes[l] : 0 });
        }
      }
    });
    secTimeline.sort((a, b) => a.t - b.t);
  }

  function advanceSectors(t) {
    while (secPtr < secTimeline.length && secTimeline[secPtr].t <= t) {
      const s = secTimeline[secPtr++];
      const c = liveCar[s.id];
      if (!c) continue;
      // 前周のタイムは消さずに残し、今周のぶんだけ上書きしていく
      c.cur[s.k] = s.v;
      c.at[s.k] = s.lap;
      c.lap = s.lap;
      // 1周目はスタート進行ぶんで大きくブレるのでベスト判定から外す
      if (s.lap > 1) {
        if (s.v < c.best[s.k]) c.best[s.k] = s.v;
        if (s.v < liveBest[s.k]) liveBest[s.k] = s.v;
      }
      if (s.k === 2) c.lastLap = s.lapTime;
    }
  }

  function fmtSec(v) {
    if (v == null) return '--.---';
    return v.toFixed(3);
  }
  function fmtLap(v) {
    if (v == null) return '--:--.---';
    const m = Math.floor(v / 60), r = v - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
  }

  function renderSectors() {
    const box = document.getElementById('rvSectors');
    if (!box) return;
    const mine = res.entries.filter(e => e.isPlayer);
    let h = '';
    mine.forEach(e => {
      const c = liveCar[e.id];
      h += '<div class="sc-row"><span class="sc-nm">' +
        '<i style="background:' + e.color + '"></i>' + e.driver.name + '</span>';
      for (let k = 0; k < 3; k++) {
        const v = c.cur[k];
        let cls = '';
        if (v != null && liveBest[k] !== Infinity) {
          if (v <= liveBest[k] + 1e-9) cls = ' purple';
          else if (c.best[k] !== Infinity && v <= c.best[k] + 1e-9) cls = ' green';
        }
        // 今周に出したタイムかどうかで濃さを変える
        if (v != null && c.at[k] !== c.lap) cls += ' old';
        h += '<span class="sc-t' + cls + '">' + fmtSec(v) + '</span>';
      }
      h += '<span class="sc-lap">' + fmtLap(c.lastLap) + '</span></div>';
    });
    h += '<div class="sc-row best"><span class="sc-nm">セッション最速</span>' +
      [0, 1, 2].map(k => '<span class="sc-t purple">' +
        (liveBest[k] === Infinity ? '--.---' : fmtSec(liveBest[k])) + '</span>').join('') +
      '<span class="sc-lap"></span></div>';
    box.innerHTML = h;
  }

  function finish() { if (onEnd) { const f = onEnd; onEnd = null; f(); } }

  /* ---------- 公開API ---------- */
  function start(canvas, result, endCb) {
    cv = canvas; ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    res = result; onEnd = endCb;
    poly = buildPoly(res.track.path, cv.width, cv.height, 34);
    res.entries.forEach(e => { e._prof = e.prof; });
    buildSectorTimeline();
    trackArt = buildTrackArt();
    duration = Math.max(1, Math.max.apply(null, res.entries.map(e => e.cum[e.cum.length - 1])));
    vt = 0; shownEvents = 0; running = true; lastTs = performance.now(); speed = 40; lights = 0;
    document.getElementById('rvLog').innerHTML = '';
    raf = requestAnimationFrame(tick);
  }
  function setSpeed(s) { speed = s; }
  function skip() {
    running = false; lights = 1;
    if (raf) cancelAnimationFrame(raf);
    vt = duration;
    draw(vt); updateHud(); flushEvents(true); finish();
  }

  /* ---------- スタートシグナル ---------- */
  function drawLights(p) {
    const w = cv.width;
    const cxl = w / 2, cy = 46;
    const on = Math.min(5, Math.floor(p * 6.2));      // 5つ順に点灯
    const out = p > 0.86;                              // 一斉消灯＝スタート
    ctx.fillStyle = 'rgba(20,12,6,.82)';
    ctx.fillRect(cxl - 72, cy - 20, 144, 40);
    ctx.strokeStyle = '#4a2f1a'; ctx.lineWidth = 3;
    ctx.strokeRect(cxl - 72, cy - 20, 144, 40);
    for (let i = 0; i < 5; i++) {
      const x = cxl - 56 + i * 28;
      ctx.fillStyle = '#241a12';
      ctx.fillRect(x - 10, cy - 12, 20, 24);
      const lit = !out && i < on;
      ctx.fillStyle = lit ? '#ff2a1a' : '#3a2a22';
      ctx.beginPath(); ctx.arc(x, cy, 7, 0, Math.PI * 2); ctx.fill();
      if (lit) {
        ctx.fillStyle = 'rgba(255,80,50,.35)';
        ctx.beginPath(); ctx.arc(x, cy, 11, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (out) {
      ctx.fillStyle = '#fff34d';
      ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
      ctx.strokeStyle = '#4a2f1a'; ctx.lineWidth = 4;
      ctx.strokeText('GO!', cxl, cy + 46);
      ctx.fillText('GO!', cxl, cy + 46);
    }
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); onEnd = null; }

  /* コース形状の平滑化をミニコース図と共有する */
  function smoothPath(path, w, h, pad) { return buildPoly(path, w, h, pad).pts; }

  return { start, setSpeed, skip, stop, smoothPath };
})();

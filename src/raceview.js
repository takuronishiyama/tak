/* =========================================================
   レース観戦ビュー（Canvasでドット絵の車が周回する）
   ========================================================= */
window.GP = window.GP || {};

GP.raceview = (function () {
  'use strict';

  let cv, ctx, res, poly, trackArt = null, raf = null;
  let vt = 0, speed = 4, running = false, onEnd = null, lastTs = 0;
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
    vt += dt * speed * (res.laps * res.track.base / 22);
    const end = Math.max.apply(null, res.entries.map(e => e.cum[e.cum.length - 1]));
    if (vt >= end) { vt = end; running = false; draw(vt); flushEvents(true); finish(); return; }
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

  function finish() { if (onEnd) { const f = onEnd; onEnd = null; f(); } }

  /* ---------- 公開API ---------- */
  function start(canvas, result, endCb) {
    cv = canvas; ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    res = result; onEnd = endCb;
    poly = buildPoly(res.track.path, cv.width, cv.height, 34);
    // マシンの3性能から、コース上の速度の出方を1台ずつ作る
    res.entries.forEach(e => {
      e._prof = GP.geom.speedProfile(res.track, e.stats || { speed: 1, corner: 1, accel: 1 });
    });
    trackArt = buildTrackArt();
    vt = 0; shownEvents = 0; running = true; lastTs = performance.now(); speed = 4;
    document.getElementById('rvLog').innerHTML = '';
    raf = requestAnimationFrame(tick);
  }
  function setSpeed(s) { speed = s; }
  function skip() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    vt = Math.max.apply(null, res.entries.map(e => e.cum[e.cum.length - 1]));
    draw(vt); updateHud(); flushEvents(true); finish();
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); onEnd = null; }

  /* コース形状の平滑化をミニコース図と共有する */
  function smoothPath(path, w, h, pad) { return buildPoly(path, w, h, pad).pts; }

  return { start, setSpeed, skip, stop, smoothPath };
})();

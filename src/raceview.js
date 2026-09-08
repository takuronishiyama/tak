/* =========================================================
   レース観戦ビュー（Canvasでドット絵の車が周回する）
   ========================================================= */
window.GP = window.GP || {};

GP.raceview = (function () {
  'use strict';

  let cv, ctx, res, poly, trackArt = null, raf = null;
  let emissive = [];        // ネオンなど、明示的に光らせたいもの（世界座標）
  let vt = 0, speed = 95, running = false, onEnd = null, lastTs = 0, lights = 0, chequer = 0, duration = 1;
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

  /* いま何周目のどのあたりを走っているか */
  function lapInfo(e, t) {
    const n = e.cum.length;
    let lap = 0;
    while (lap < n && e.cum[lap] <= t) lap++;
    if (lap >= n) lap = n - 1;
    const prev = lap === 0 ? 0 : e.cum[lap - 1];
    return { lap: lap + 1, into: t - prev, lapTime: e.lapTimes[lap] || 1 };
  }

  /* ピット作業中か（その周のピット停止時間ぶんを、周の終わりに割り当てている） */
  function inPit(e, t) {
    if (e.dnf && t >= (e.cum[e.dnfLap - 1] || 0)) return false;
    const li = lapInfo(e, t);
    const pt = (e.pitTime || [])[li.lap - 1] || 0;
    if (pt <= 0) return false;
    return li.into > li.lapTime - pt;
  }

  /* いま履いているタイヤ */
  function tyreNow(e, t) {
    const li = lapInfo(e, t);
    return (e.lapTyre || [])[li.lap - 1] || (e.lapTyre || [])[0] || null;
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

  /* 彩度と明度をいじる（HD-2Dは地面を深く沈めて、光った所を際立たせる） */
  function grade(hex, satMul, valMul) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16 & 255) / 255, g2 = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), l = (mx + mn) / 2;
    r = l + (r - l) * satMul; g2 = l + (g2 - l) * satMul; b = l + (b - l) * satMul;
    const cl = v => Math.max(0, Math.min(255, Math.round(v * valMul * 255)));
    return '#' + ((1 << 24) + (cl(r) << 16) + (cl(g2) << 8) + cl(b)).toString(16).slice(1);
  }

  /* レース画面用に色を作り直す。メニュー側のテーマ色はそのまま使う */
  function hdTheme(base) {
    return {
      sky:  grade(base.sky,  1.35, base.night ? 0.92 : 0.80),
      dot:  grade(base.dot,  1.45, base.night ? 0.86 : 0.72),
      edge: grade(base.edge, 1.9,  0.80),      // 白いランオフは光りすぎるので暖色に落とす
      road: grade(base.road, 1.25, 0.68),      // 路面を深く沈めて明暗差を作る
      night: base.night
    };
  }

  /* 世界座標へ移すカメラ変換。描画と発光レイヤーで同じものを使う */
  function camTransform(g) {
    g.translate(cv.width / 2, cv.height / 2);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);
  }

  function buildTrackArt() {
    emissive = [];
    const th = hdTheme(GP.data.THEMES[GP.data.TRACK_THEME[res.track.name] || 'grass']);
    const wet = res.weather.key === 'rain' || res.weather.key === 'storm';
    const c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d');

    // 地面
    g.fillStyle = wet && !th.night ? shade(th.sky, -0.22) : th.sky;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = wet && !th.night ? shade(th.dot, -0.22) : th.dot;
    for (let y = 0; y < c.height; y += 8) for (let x = (y % 16 ? 0 : 4); x < c.width; x += 16) g.fillRect(x, y, 4, 4);

    // コースの外に景色を置く。
    // 影を実際のシルエットから作りたいので、いったん別レイヤーに描く。
    const pl = document.createElement('canvas');
    pl.width = c.width; pl.height = c.height;
    const pg = pl.getContext('2d');
    pg.imageSmoothingEnabled = false;
    drawScenery(pg, GP.data.TRACK_THEME[res.track.name] || 'grass', c.width, c.height);

    // 落ち影：同じ絵を真っ黒にして、光の向きへ少しずつずらして重ねる。
    // 一枚ずつは薄いが、重なって奥に伸びる影になる（HD-2Dらしさの要）。
    if (GP.fx.supportsBlur()) {
      const sil = document.createElement('canvas');
      sil.width = c.width; sil.height = c.height;
      const sg = sil.getContext('2d');
      sg.filter = 'brightness(0)';
      sg.drawImage(pl, 0, 0);
      sg.filter = 'none';
      g.save();
      g.globalAlpha = 0.10;
      for (let k = 1; k <= 6; k++) g.drawImage(sil, k * 2.4, k * 1.5);
      g.restore();
      // 景色そのものは彩度を上げ、明度を落として地面になじませる
      g.save();
      g.filter = 'saturate(1.3) brightness(0.86)';
      g.drawImage(pl, 0, 0);
      g.filter = 'none';
      g.restore();
    } else {
      g.save();
      g.globalAlpha = 0.16;
      for (let k = 1; k <= 4; k++) { g.globalAlpha = 0.055; g.drawImage(pl, k * 2.4, k * 1.5); }
      g.restore();
      g.drawImage(pl, 0, 0);
    }

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
    // 夜のコースには照明を立てる。路面を照らす円と、光源そのもの
    if (GP.data.THEMES[theme].night) {
      for (let i = 0; i < poly.n; i += 26) {
        const nm = normalAt(i);
        const lx = nm.x + nm.nx * 20, ly = nm.y + nm.ny * 20;
        if (lx < 6 || ly < 6 || lx > W - 6 || ly > H - 6) continue;
        const pool = g.createRadialGradient(lx, ly, 1, lx, ly, 34);
        pool.addColorStop(0, 'rgba(255,236,190,.30)');
        pool.addColorStop(1, 'rgba(255,236,190,0)');
        g.fillStyle = pool; g.beginPath(); g.arc(lx, ly, 34, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3a3f52'; g.fillRect(lx - 1, ly - 9, 2, 9);
        g.fillStyle = '#fff2c8'; g.fillRect(lx - 2, ly - 12, 5, 3);
        emissive.push({ x: lx - 2, y: ly - 12, w: 5, h: 3, c: '#fff2c8' });
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
      // 看板は光源として登録し、あとでにじませる
      emissive.push({ x: x - w / 2 + 2, y: y - h + 3, w: w - 4, h: 3, c: nc });
      emissive.push({ x: x - w / 2 + 2, y: y - h + 9, w: Math.max(3, w - 8), h: 3, c: nc });
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

  /* =========================================================
     カメラ
     全体を見せるモードと、注目している車に寄るモードを持ち、
     切り替えは滑らかに補間する
     ========================================================= */
  let cam = { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1, mode: 'auto', focusId: null, label: '' };

  function setCamMode(m) {
    cam.mode = m;
    const bar = document.getElementById('rvCam');
    if (bar) Array.prototype.forEach.call(bar.children, b => b.classList.toggle('on', b.dataset.cam === m));
  }

  /* いま寄るべき相手を決める */
  function pickFocus(t) {
    const ord = orderAt(t);
    const alive = ord.filter(o => !o.out);
    if (!alive.length) return null;
    const mine = alive.filter(o => o.e.isPlayer);

    if (cam.mode === 'wide') return null;
    if (cam.mode === 'mine') return mine.length ? { list: mine.slice(0, 2), label: 'マイチーム' } : null;

    // auto：自チームが誰かと接近していればそのバトル、いなければ先頭争い
    for (let i = 0; i < alive.length; i++) {
      if (!alive[i].e.isPlayer) continue;
      const near = [];
      if (i > 0) near.push(alive[i - 1]);
      near.push(alive[i]);
      if (i < alive.length - 1) near.push(alive[i + 1]);
      const spread = Math.abs(near[0].p - near[near.length - 1].p) * res.track.base;
      if (near.length > 1 && spread < 2.2) {
        return { list: near, label: '⚔️ ' + alive[i].e.driver.name + ' のバトル' };
      }
    }
    const lead = alive.slice(0, 2);
    const gap = lead.length > 1 ? Math.abs(lead[0].p - lead[1].p) * res.track.base : 99;
    if (gap < 2.0) return { list: lead, label: '⚔️ 首位争い' };
    return mine.length ? { list: mine.slice(0, 1), label: mine[0].e.driver.name } : { list: lead.slice(0, 1), label: '先頭' };
  }

  /* カメラの目標位置を更新する */
  function updateCam(t) {
    const f = pickFocus(t);
    cam.label = f ? f.label : '';
    if (!f) { cam.tx = cv.width / 2; cam.ty = cv.height / 2; cam.tz = 1; }
    else {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      f.list.forEach(o => {
        const pt = placeInLap(o.e, o.p);
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
      });
      const pad = 90;
      const w = Math.max(160, maxX - minX + pad * 2), h = Math.max(120, maxY - minY + pad * 2);
      cam.tx = (minX + maxX) / 2; cam.ty = (minY + maxY) / 2;
      cam.tz = Math.max(1, Math.min(2.6, Math.min(cv.width / w, cv.height / h)));
    }
    // 滑らかに追従する
    const k = 0.07;
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.z += (cam.tz - cam.z) * k;
    // 画面の外が映らないように寄せる
    const halfW = cv.width / (2 * cam.z), halfH = cv.height / (2 * cam.z);
    cam.x = Math.max(halfW, Math.min(cv.width - halfW, cam.x));
    cam.y = Math.max(halfH, Math.min(cv.height - halfH, cam.y));
  }

  /* ---------- 毎フレームの描画 ---------- */
  function draw(t) {
    const w = cv.width, h = cv.height;
    const wet = res.weather.key === 'rain' || res.weather.key === 'storm';
    const night = !!(GP.data.THEMES[GP.data.TRACK_THEME[res.track.name] || 'grass'] || {}).night;

    updateCam(t);

    // 世界はいったん裏画面に描き、あとから光と色を乗せて画面に出す
    const out = ctx;
    const buf = GP.fx.begin();
    if (buf) ctx = buf;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);

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
    const pit = pitSpan();
    let pitSlot = 0;
    for (let i = ord.length - 1; i >= 0; i--) {
      const o = ord[i], e = o.e;
      if (!o.out && pit && inPit(e, t)) {
        // ピット作業中はガレージ前に停めて、作業中と分かるようにする
        const idx = (pit.from + 6 + (pitSlot++ % 5) * 7) % poly.n;
        const nm = normalAt(idx);
        const px = nm.x + nm.nx * pit.side * 20, py = nm.y + nm.ny * pit.side * 20;
        const ang = Math.atan2(nm.dy, nm.dx);
        drawCar(px, py, ang, e.color, e.isPlayer, false, e.gen || 0, 0);
        // 作業中のクルーと、残り時間
        const li = lapInfo(e, t);
        const pt = (e.pitTime || [])[li.lap - 1] || 1;
        const left = Math.max(0, li.lapTime - li.into);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        // タイヤを換えるクルー（4隅で動く）
        for (let c2 = 0; c2 < 4; c2++) {
          const sx = (c2 < 2 ? -5 : 5), sy = (c2 % 2 ? 7 : -7);
          const bob = Math.sin(t * 14 + c2) * 1.4;
          ctx.fillStyle = '#2b2b33'; ctx.fillRect(sx - 2, sy + bob - 2, 4, 5);
          ctx.fillStyle = e.color; ctx.fillRect(sx - 2, sy + bob - 4, 4, 2);
        }
        ctx.fillStyle = '#2b2b33'; ctx.fillRect(-11, -3, 4, 6);   // ジャッキ担当
        ctx.restore();
        ctx.save();
        ctx.translate(px, py - 13);
        ctx.fillStyle = '#fff34d'; ctx.strokeStyle = '#4a2f1a'; ctx.lineWidth = 2;
        ctx.fillRect(-13, -7, 26, 12); ctx.strokeRect(-13, -7, 26, 12);
        ctx.fillStyle = '#4a2f1a'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('PIT ' + left.toFixed(1), 0, 2);
        ctx.restore();
        continue;
      }
      const pt2 = placeInLap(e, o.p);
      const vel = pt2.v == null ? 1 : pt2.v;
      emit(e, pt2, vel, o.out, wet);
      drawCar(pt2.x, pt2.y, pt2.ang, e.color, e.isPlayer, o.out, e.gen || 0, vel);
    }
    GP.fx.drawParticles(ctx);
    ctx.restore();

    // 光・被写界深度・色調をまとめて乗せる
    ctx = out;
    if (buf) {
      // ネオンや照明は、明るさだけでは足りないので光源として別に足す
      if (emissive.length) {
        GP.fx.addLight(function (lg) {
          lg.save();
          camTransform(lg);
          for (let i = 0; i < emissive.length; i++) {
            const em = emissive[i];
            lg.fillStyle = em.c;
            lg.fillRect(em.x, em.y, em.w, em.h);
          }
          lg.restore();
        });
      }
      // カメラが寄っているときほど、周りをぼかしてジオラマらしく見せる
      const dof = Math.max(0, Math.min(1, (cam.z - 1) / 1.5));
      GP.fx.composite(out, {
        focus: { x: w / 2, y: h / 2 },
        focusR: w * (0.46 - dof * 0.14),
        dof: dof,
        bloom: night ? 1.15 : (wet ? 0.85 : 0.72),
        warm: night ? 1.1 : 0.85,
        vignette: 0.9,
        night: night
      });
    }
    drawOverlay(t);
  }

  /* ---------- 走行にともなう粒子 ----------
     火花はコーナー立ち上がりの底打ち、砂ぼこりはコースアウト、
     水しぶきは雨のときの後輪から。走っている車だけが出す。        */
  function emit(e, pt, vel, out, wet) {
    if (out) {
      if (Math.random() < 0.35) GP.fx.spawn(pt.x, pt.y, 'dust', Math.random() * 6.283, 0.6);
      return;
    }
    const back = pt.ang + Math.PI;
    if (wet && Math.random() < 0.5) {
      GP.fx.spawn(pt.x - Math.cos(pt.ang) * 7, pt.y - Math.sin(pt.ang) * 7, 'spray', back, 0.5 + vel);
    }
    // 速度が乗った状態＝路面を強く押しつけている所で火花が散る
    if (vel > 0.88 && Math.random() < 0.16) {
      GP.fx.spawn(pt.x - Math.cos(pt.ang) * 8, pt.y - Math.sin(pt.ang) * 8, 'spark', back, 1);
    }
  }

  /* ---------- 画面に重ねる情報 ---------- */
  function drawOverlay(t) {
    const w = cv.width;
    // いま何を映しているか
    if (cam.label) {
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
      const tw = ctx.measureText(cam.label).width + 14;
      ctx.fillStyle = 'rgba(40,24,10,.78)';
      ctx.fillRect(8, 8, tw, 20);
      ctx.fillStyle = '#ffeec4';
      ctx.fillText(cam.label, 15, 22);
    }
    // 最終ラップ
    const leader = orderAt(t).filter(o => !o.out)[0];
    if (leader) {
      const lap = Math.min(res.laps, Math.floor(leader.p) + 1);
      if (lap >= res.laps) {
        const a = 0.65 + Math.sin(t * 4) * 0.35;
        ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(40,24,10,.7)';
        ctx.fillRect(w / 2 - 82, 6, 164, 28);
        ctx.fillStyle = 'rgba(255,243,77,' + a.toFixed(2) + ')';
        ctx.fillText('FINAL LAP', w / 2, 28);
      }
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
    GP.fx.stepParticles(dt);
    if (lights < 1) {
      lights = Math.min(1, lights + dt / 2.4);
      draw(0); drawLights(lights); updateHud();
      raf = requestAnimationFrame(tick);
      return;
    }
    // speed は「レース全体を何秒で見せるか」。実時間に対する倍率をそこから出す
    vt += dt * (duration / speed);
    if (vt >= duration) {
      vt = duration; draw(vt); updateHud(); flushEvents(true);
      // チェッカーフラッグの演出をひと呼吸だけ見せる
      if (chequer < 1) {
        chequer = Math.min(1, chequer + dt / 1.6);
        drawChequer(chequer);
        raf = requestAnimationFrame(tick);
        return;
      }
      running = false; finish(); return;
    }
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
      const pitting = !o.out && inPit(e, vt);
      const gap = o.out ? 'DNF' : pitting ? 'PIT' : (i === 0 ? '先頭' : '-' + (gapNum * res.track.base).toFixed(1) + 's');
      const ty = tyreNow(e, vt);
      let chip = '<span class="rv-ty">–</span>';
      if (ty) {
        const td = GP.data.TYRES.find(x => x.key === ty.key) || GP.data.TYRES[1];
        const worn = ty.age > td.life ? ' worn' : ty.age > td.life * 0.75 ? ' old' : '';
        chip = '<span class="rv-ty' + worn + '" style="background:' + td.color + ';color:' + td.text +
          '" title="' + td.name + '／' + ty.age + '周使用（寿命' + td.life + '周）">' + td.short +
          '<em>' + ty.age + '</em></span>';
      }
      html += '<div class="rv-row' + (e.isPlayer ? ' me' : '') + (o.out ? ' out' : '') + (pitting ? ' pitting' : '') + '">' +
        '<span class="rv-pos">' + (i + 1) + '</span>' +
        '<span class="rv-chip" style="background:' + e.color + '"></span>' +
        '<span class="rv-name">' + e.driver.name + '</span>' +
        chip +
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
      if (!all) {
        if (ev.type === 'pass') GP.sound.play('pass', 140);
        else if (ev.type === 'pit') GP.sound.play('pit', 140);
        else if (ev.type === 'dnf') GP.sound.play('dnf', 300);
      }
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
      const ty = tyreNow(e, vt);
      let tychip = '';
      if (ty) {
        const td = GP.data.TYRES.find(x => x.key === ty.key) || GP.data.TYRES[1];
        const leftPct = Math.max(0, Math.min(100, (1 - ty.age / td.life) * 100));
        const cls = leftPct < 12 ? ' worn' : leftPct < 35 ? ' old' : '';
        tychip = '<span class="sc-ty' + cls + '" title="' + td.name + '／' + ty.age + '周使用（寿命の目安 ' + td.life + '周）">' +
          '<b style="background:' + td.color + ';color:' + td.text + '">' + td.short + '</b>' +
          '<i><u style="width:' + leftPct.toFixed(0) + '%;background:' + td.color + '"></u></i>' +
          '<em>' + ty.age + '周</em></span>';
      }
      // バッテリー残量
      const li2 = lapInfo(e, vt);
      const er = (e.lapErs || [])[li2.lap - 1] || (e.lapErs || [])[0];
      let erchip = '<span class="sc-ers"></span>';
      if (er) {
        const pct = Math.max(0, Math.min(100, er.level / er.cap * 100));
        const cls = pct < 20 ? ' low' : pct < 45 ? ' mid' : '';
        erchip = '<span class="sc-ers' + cls + '" title="バッテリー ' + er.level + ' / ' + er.cap + '">' +
          '🔋<i><u style="width:' + pct.toFixed(0) + '%"></u></i></span>';
      }
      h += '<div class="sc-row"><span class="sc-nm">' +
        '<i style="background:' + e.color + '"></i>' + e.driver.name + '</span>' + tychip + erchip;
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
    h += '<div class="sc-row best"><span class="sc-nm">セッション最速</span><span class="sc-ty"></span><span class="sc-ers"></span>' +
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
    GP.fx.init(cv.width, cv.height);
    cam = { x: cv.width / 2, y: cv.height / 2, z: 1, tx: cv.width / 2, ty: cv.height / 2, tz: 1,
            mode: 'auto', focusId: null, label: '' };
    duration = Math.max(1, Math.max.apply(null, res.entries.map(e => e.cum[e.cum.length - 1])));
    vt = 0; shownEvents = 0; lightBeeps = 0; running = true; lastTs = performance.now(); speed = 95; lights = 0; chequer = 0;
    document.getElementById('rvLog').innerHTML = '';
    raf = requestAnimationFrame(tick);
  }
  function setSpeed(s) { speed = s; }
  function skip() {
    running = false; lights = 1; chequer = 1;
    if (raf) cancelAnimationFrame(raf);
    vt = duration;
    draw(vt); updateHud(); flushEvents(true); finish();
  }

  /* ---------- チェッカーフラッグ ---------- */
  function drawChequer(p) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const w = cv.width, h = cv.height;
    ctx.fillStyle = 'rgba(20,12,6,' + (0.35 * Math.min(1, p * 3)).toFixed(2) + ')';
    ctx.fillRect(0, 0, w, h);
    // 旗が振られる
    const sway = Math.sin(p * 22) * 6;
    const cx = w / 2, cy = h / 2 - 10;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sway * Math.PI / 180);
    const sq = 11;
    for (let r = 0; r < 5; r++) for (let c2 = 0; c2 < 7; c2++) {
      ctx.fillStyle = ((r + c2) % 2) ? '#2b1c0e' : '#fffdf3';
      ctx.fillRect(-7 * sq / 2 + c2 * sq, -5 * sq / 2 + r * sq + Math.sin(p * 18 + c2) * 2, sq, sq);
    }
    ctx.restore();
    ctx.fillStyle = '#7a6a52'; ctx.fillRect(cx - 7 * sq / 2 - 4, cy - 5 * sq / 2, 4, 5 * sq + 22);
    if (p > 0.35) {
      ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
      ctx.strokeStyle = '#4a2f1a'; ctx.lineWidth = 4;
      ctx.strokeText('FINISH!', cx, cy + 5 * sq / 2 + 40);
      ctx.fillStyle = '#fff34d';
      ctx.fillText('FINISH!', cx, cy + 5 * sq / 2 + 40);
    }
  }

  /* ---------- スタートシグナル ---------- */
  let lightBeeps = 0;
  function drawLights(p) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const w = cv.width;
    const cxl = w / 2, cy = 46;
    const on = Math.min(5, Math.floor(p * 6.2));      // 5つ順に点灯
    const out = p > 0.86;                              // 一斉消灯＝スタート
    if (!out && on > lightBeeps) { lightBeeps = on; GP.sound.play('light'); }
    if (out && lightBeeps < 6) { lightBeeps = 6; GP.sound.play('go'); }
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

  return { start, setSpeed, skip, stop, setCamMode };
})();

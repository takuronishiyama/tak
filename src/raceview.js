/* =========================================================
   レース観戦ビュー（Canvasでドット絵の車が周回する）
   ========================================================= */
window.GP = window.GP || {};

GP.raceview = (function () {
  'use strict';

  let cv, ctx, res, poly, total, raf = null;
  let vt = 0, speed = 4, running = false, onEnd = null, lastTs = 0;
  let shownEvents = 0;

  /* ---------- Catmull-Rom でパスを滑らかに再サンプル ---------- */
  function buildPoly(path, w, h, pad) {
    const p = path.map(pt => [pad + pt[0] * (w - pad * 2), pad + pt[1] * (h - pad * 2)]);
    const n = p.length, out = [];
    const at = i => p[(i % n + n) % n];
    for (let i = 0; i < n; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let s = 0; s < 14; s++) {
        const t = s / 14, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    // 累積長
    let len = 0; const cum = [0];
    for (let i = 1; i <= out.length; i++) {
      const a = out[i - 1], b = out[i % out.length];
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
      cum.push(len);
    }
    return { pts: out, cum: cum, len: len };
  }

  function pointAt(f) {
    f = f - Math.floor(f);
    const target = f * poly.len;
    let lo = 0, hi = poly.cum.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (poly.cum[m] <= target) lo = m; else hi = m; }
    const a = poly.pts[lo % poly.pts.length], b = poly.pts[(lo + 1) % poly.pts.length];
    const seg = poly.cum[lo + 1] - poly.cum[lo] || 1;
    const t = (target - poly.cum[lo]) / seg;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
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

  /* ---------- 描画 ---------- */
  function draw(t) {
    const w = cv.width, h = cv.height;
    const night = res.track.name.indexOf('ネオン') >= 0 || res.track.name.indexOf('デザート') >= 0;
    const wet = res.weather.key === 'rain' || res.weather.key === 'storm';

    // 背景（芝／夜／濡れ）
    ctx.fillStyle = night ? '#1b2038' : (wet ? '#5d7a63' : '#7fbf5a');
    ctx.fillRect(0, 0, w, h);
    // 芝のドット模様
    ctx.fillStyle = night ? '#232a4a' : (wet ? '#54705a' : '#76b552');
    for (let y = 0; y < h; y += 8) for (let x = (y % 16 ? 0 : 4); x < w; x += 16) ctx.fillRect(x, y, 4, 4);

    // コース（縁石→アスファルト）
    strokePath(28, night ? '#4a4f6a' : '#e8e0c8');
    strokePath(22, wet ? '#3a3d46' : '#55585f');
    // センターライン
    ctx.setLineDash([6, 10]);
    strokePath(2, 'rgba(255,255,255,.35)');
    ctx.setLineDash([]);

    // スタート/フィニッシュライン
    const sf = pointAt(0);
    ctx.save(); ctx.translate(sf.x, sf.y); ctx.rotate(sf.ang);
    for (let i = -14; i < 14; i += 4) {
      ctx.fillStyle = ((i / 4) % 2 === 0) ? '#fff' : '#333';
      ctx.fillRect(-3, i, 6, 4);
    }
    ctx.restore();

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
      const pt = pointAt(o.p);
      drawCar(pt.x, pt.y, pt.ang, e.color, e.isPlayer, o.out, e.gen || 0);
    }
  }

  function strokePath(width, color) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(poly.pts[0][0], poly.pts[0][1]);
    for (let i = 1; i < poly.pts.length; i++) ctx.lineTo(poly.pts[i][0], poly.pts[i][1]);
    ctx.closePath(); ctx.stroke();
  }

  /* マシン世代が上がるほど車体が長く、ウイングが立派になる */
  function drawCar(x, y, ang, color, isPlayer, out, gen) {
    gen = Math.max(0, Math.min(5, gen | 0));
    const len = 15 + gen;                  // ボディ長
    const rw = 3 + (gen >= 2 ? 1 : 0);     // リアウイング幅
    const rh = 8 + (gen >= 3 ? 2 : 0);     // リアウイング高
    const fh = 6 + (gen >= 2 ? 1 : 0);     // フロントウイング高
    const nose = 7 + Math.floor(gen / 2);

    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(ang);
    ctx.globalAlpha = out ? 0.28 : 1;
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

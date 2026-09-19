/* =========================================================
   SSを走っているところを見せる

   サーキットの中継と違って、映すのは1台だけ。
   ラリーは「並んで走らない競技」なので、緊張の出どころが違う。
     ・次に何が来るかは、右席の読み上げだけが教えてくれる
     ・タイムは、誰かと並んでいなくても、刻一刻と削られている
   だから画面の主役は、道と、ペースノートと、時計になる。

   走りそのものは rally.js がもう決めてある（区間タイムも、
   どこで何が起きたかも）。ここでやるのは、その再生だけ。
   ========================================================= */
window.GP = window.GP || {};

GP.rallyview = (function () {
  'use strict';

  const VW = 560, VH = 400;
  let PX = 1;
  let cv, ctx, raf = null;
  let S = null;          // いまの走り
  let onEnd = null;
  let rate = 1;          // 見せる速さ（実時間の何倍か）
  let lastTs = 0;

  const RD = () => GP.rallydata;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  /* 地面の目を、進んだぶんだけずらすための現在地 */
  function p0X() { return S && S.road ? S.road.pts[S.i][0] : 0; }
  function p0Y() { return S && S.road ? S.road.pts[S.i][1] : 0; }

  /* ---------- 時間の割り振り ----------
     道の「速さの形」から、各点までに何秒かかるかを積む。
     最後に、実際の区間タイムに合うよう、まるごと伸び縮みさせる  */
  function buildTimeline(road, totalS) {
    const N = road.n;
    const t = new Float64Array(N);
    let acc = 0;
    for (let i = 1; i < N; i++) {
      const d = road.cum[i] - road.cum[i - 1];
      const k = Math.max(0.15, (road.keep[i] + road.keep[i - 1]) / 2);
      acc += d / k;
      t[i] = acc;
    }
    const sc = totalS / Math.max(0.001, acc);
    for (let i = 0; i < N; i++) t[i] *= sc;
    return t;
  }

  /* ---------- 始める ---------- */
  function start(canvas, spec, endCb) {
    cv = canvas; ctx = cv.getContext('2d');
    PX = GP.gfx.fit(cv, VW, VH, { max: 2 });
    onEnd = endCb || null;
    const road = spec.road;
    S = {
      spec: spec, road: road,
      time: buildTimeline(road, spec.timeS),
      i: 0,                 // いま道のどの点にいるか
      t: 0,                 // 経過（秒）
      done: false,
      holdUntil: 0,         // 何かが起きて止まっているあいだ
      said: 0,              // どこまで読み上げたか
      notes: [],            // 出ている読み上げ
      logs: [],
      moments: (spec.moments || []).slice().sort((a, b) => a.at - b.at),
      fired: 0,
      shake: 0,
      dust: []
    };
    rate = spec.rate || 12;
    lastTs = performance.now();
    GP.fx.init(VW * PX, VH * PX);
    paintNote();
    paintLog();
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }

  function setRate(v) { rate = v; }

  function skip() {
    if (!S) return;
    S.t = S.time[S.road.n - 1];
    S.i = S.road.n - 1;
    finish();
  }

  function finish() {
    if (!S || S.done) return;
    S.done = true;
    stop();
    if (onEnd) { const f = onEnd; onEnd = null; f(); }
  }

  /* ---------- 毎フレーム ---------- */
  function tick(ts) {
    if (!S) return;
    const dt = Math.min(0.15, (ts - lastTs) / 1000);
    lastTs = ts;
    const N = S.road.n;

    if (S.holdUntil > 0) {
      S.holdUntil -= dt * rate;
      if (S.holdUntil < 0) S.holdUntil = 0;
    } else {
      S.t += dt * rate;
    }
    // いまの位置を時間から引く
    while (S.i < N - 1 && S.time[S.i + 1] <= S.t) S.i++;
    const f = S.road.cum[S.i] / Math.max(1, S.road.len);

    // 読み上げ。曲がりの少し手前で言う
    const ns = S.road.notes;
    while (S.said < ns.length && ns[S.said].f - 0.012 <= f) {
      const nt = ns[S.said];
      S.notes.unshift({ say: GP.rally.noteSay(nt, ns[S.said + 1]), sev: nt.sev, dir: nt.dir });
      if (S.notes.length > 3) S.notes.pop();
      S.said++;
      paintNote();
    }
    // 起きたこと
    while (S.fired < S.moments.length && S.moments[S.fired].at <= f) {
      const m = S.moments[S.fired++];
      S.logs.unshift(m);
      if (S.logs.length > 4) S.logs.pop();
      S.shake = 1;
      S.holdUntil = Math.min(6, (m.loss || 3) * 0.25);
      if (m.out) { paintLog(); draw(f); setTimeout(finish, 900); return; }
      paintLog();
    }
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 3);
    if (S.holdUntil <= 0 && S.i > 0) {
      const q = S.road.pts[S.i], q0 = S.road.pts[Math.max(0, S.i - 1)];
      pushDust(q, Math.atan2(q[1] - q0[1], q[0] - q0[0]));
    }

    draw(f);
    if (S.i >= N - 1) { finish(); return; }
    raf = requestAnimationFrame(tick);
  }

  /* ---------- 絵 ---------- */
  function draw(f) {
    const road = S.road, i = S.i;
    const k = GP.gfx.fit(cv, VW, VH, { max: 2 });
    if (Math.abs(k - PX) > 0.01) { PX = k; GP.fx.init(VW * PX, VH * PX); }
    const dusk = document.body.getAttribute('data-skin') === 'hd';
    const out = ctx;
    const g = dusk ? GP.fx.begin() : out;
    GP.gfx.begin(g, PX);
    g.clearRect(0, 0, VW, VH);

    const sf = (RD().SURFACES[S.spec.surface] || RD().SURFACES.gravel);
    const night = !!S.spec.night;

    // 地面。一色だと「止まっている面」に見えるので、目を入れる
    g.fillStyle = groundOf(S.spec.surface, night);
    g.fillRect(0, 0, VW, VH);
    g.fillStyle = 'rgba(0,0,0,.07)';
    const ox = ((p0X() * 0.5) % 16 + 16) % 16, oy = ((p0Y() * 0.5) % 16 + 16) % 16;
    for (let y = -16; y < VH + 16; y += 8) {
      for (let x = ((y / 8) % 2 ? -16 : -8); x < VW + 16; x += 16) {
        g.fillRect(x - ox, y - oy, 4, 4);
      }
    }

    // カメラ：自車を下寄りに置いて、進む向きを上にする
    const p = road.pts[i], p2 = road.pts[Math.min(road.n - 1, i + 2)];
    const ang = Math.atan2(p2[1] - p[1], p2[0] - p[0]);
    const zoom = 1.35;
    g.save();
    g.translate(VW / 2, VH * 0.74);
    if (S.shake > 0) {
      g.translate((Math.random() - 0.5) * 7 * S.shake, (Math.random() - 0.5) * 7 * S.shake);
    }
    g.scale(zoom, zoom);
    g.rotate(-ang - Math.PI / 2);
    g.translate(-p[0], -p[1]);

    /* 道ばたのものは、カメラの中（世界の座標）で置く。
       外で置くと、車がどこへ行っても同じところに出てしまう */
    scatter(g, road, i, night);
    drawRoad(g, road, i, sf, night);
    drawDust(g);
    drawCar(g, p, ang);

    g.restore();
    overlay(g, f);

    if (dusk) {
      GP.fx.composite(out, {
        dof: 0.25, focus: { x: VW * PX / 2, y: VH * PX * 0.70 }, focusR: VW * PX * 0.42,
        bloom: night ? 1.2 : 0.8, warm: 0.95, vignette: 0.9, night: night
      });
    }
  }

  function groundOf(surface, night) {
    /* 路面より地面を暗くしておかないと、道がどこにあるか分からない */
    if (surface === 'snow') return night ? '#1a1b33' : '#6d7aa8';
    if (surface === 'tarmac') return night ? '#0f2a18' : '#1b3a1c';
    return night ? '#2e1d10' : '#4a3018';
  }

  /* 道ばた。路面ごとに置くものを変える。
     形が決まっていないと、走っている感じが出ない              */
  function scatter(g, road, i, night) {
    const surface = S.spec.surface;
    const from = Math.max(0, i - 40), to = Math.min(road.n - 1, i + 260);
    for (let k = from; k < to; k += 7) {
      const q = road.pts[k];
      const h = ((k * 2654435761) >>> 0) / 4294967296;
      const side = h < 0.5 ? -1 : 1;
      const q2 = road.pts[Math.min(road.n - 1, k + 1)];
      const a = Math.atan2(q2[1] - q[1], q2[0] - q[0]) + Math.PI / 2 * side;
      const d = 19 + h * 17;          // 道のすぐ脇。離すと、ただ浮いて見える
      const x = q[0] + Math.cos(a) * d, y = q[1] + Math.sin(a) * d;
      if (surface === 'snow') {
        // 雪の壁。路肩に積み上がっているほど、はみ出せない
        g.fillStyle = night ? '#6d7aa8' : '#fff8e6';
        g.fillRect(x - 5, y - 6, 10, 9);
        g.fillStyle = night ? '#445078' : '#b5aabb';
        g.fillRect(x - 5, y + 1, 10, 2);
        if (h > 0.8) {
          g.fillStyle = night ? '#0f2a18' : '#1b3a1c';
          g.fillRect(x - 3, y - 15, 6, 10);
        }
      } else {
        const tall = h > 0.72;
        g.fillStyle = night ? '#0f2a18' : '#1b3a1c';
        g.fillRect(x - 4, y - (tall ? 11 : 7), 8, tall ? 11 : 7);
        g.fillStyle = night ? '#1b3a1c' : '#2f5c26';
        g.fillRect(x - 3, y - (tall ? 10 : 6), 5, tall ? 8 : 5);
        g.fillStyle = '#2e1d10';
        g.fillRect(x - 1, y, 2, 3);
      }
    }
  }

  function drawRoad(g, road, i, sf, night) {
    const from = Math.max(0, i - 30), to = Math.min(road.n - 1, i + 240);
    const w = 22;
    g.lineCap = 'round'; g.lineJoin = 'round';
    // 路肩。路面ごとに色を変える（雪の道に茶色い縁は出ない）
    g.strokeStyle = S.spec.surface === 'snow' ? (night ? '#445078' : '#b5aabb')
                  : S.spec.surface === 'tarmac' ? (night ? '#12101a' : '#23222c')
                  : (night ? '#12101a' : '#2e1d10');
    g.lineWidth = w + 7;
    line(g, road, from, to);
    // 路面
    g.strokeStyle = roadColor(S.spec.surface, night);
    g.lineWidth = w;
    line(g, road, from, to);
    // わだち
    g.strokeStyle = 'rgba(0,0,0,.13)';
    g.lineWidth = 3;
    line(g, road, from, to);
    // ゴール
    if (to >= road.n - 2) {
      const q = road.pts[road.n - 1];
      for (let c = 0; c < 6; c++) {
        g.fillStyle = (c % 2) ? '#fff8e6' : '#12101a';
        g.fillRect(q[0] - 15 + c * 5, q[1] - 4, 5, 8);
      }
    }
  }
  function roadColor(surface, night) {
    if (surface === 'snow') return night ? '#6d7aa8' : '#e8dfd2';
    if (surface === 'tarmac') return night ? '#33313e' : '#5d5a6b';
    return night ? '#4a3018' : '#96683a';
  }
  function line(g, road, from, to) {
    g.beginPath();
    g.moveTo(road.pts[from][0], road.pts[from][1]);
    for (let k = from + 1; k <= to; k++) g.lineTo(road.pts[k][0], road.pts[k][1]);
    g.stroke();
  }

  /* 砂煙。路面ごとに色と量が変わる。
     舗装ではほとんど立たず、砂利と雪では派手に舞う          */
  function pushDust(p, ang) {
    const surface = S.spec.surface;
    const n = surface === 'tarmac' ? 1 : 3;
    for (let k = 0; k < n; k++) {
      S.dust.push({
        x: p[0] - Math.cos(ang) * (9 + Math.random() * 6) + (Math.random() - 0.5) * 8,
        y: p[1] - Math.sin(ang) * (9 + Math.random() * 6) + (Math.random() - 0.5) * 8,
        r: 3 + Math.random() * 5, a: 1,
        vx: -Math.cos(ang) * (0.5 + Math.random()), vy: -Math.sin(ang) * (0.5 + Math.random())
      });
    }
    if (S.dust.length > 90) S.dust.splice(0, S.dust.length - 90);
  }
  function drawDust(g) {
    const surface = S.spec.surface;
    const col = surface === 'snow' ? '232,223,210'
              : surface === 'tarmac' ? '120,110,100' : '150,104,58';
    for (let k = 0; k < S.dust.length; k++) {
      const d = S.dust[k];
      d.x += d.vx; d.y += d.vy; d.r += 0.35; d.a -= 0.035;
      if (d.a <= 0) continue;
      g.fillStyle = 'rgba(' + col + ',' + (d.a * 0.5).toFixed(2) + ')';
      g.beginPath(); g.arc(d.x, d.y, d.r, 0, Math.PI * 2); g.fill();
    }
    S.dust = S.dust.filter(d => d.a > 0);
  }

  function drawCar(g, p, ang) {
    g.save();
    g.translate(p[0], p[1]);
    g.rotate(ang + Math.PI / 2);
    const col = S.spec.color || '#c23a2e';
    // 影
    g.fillStyle = 'rgba(0,0,0,.34)';
    g.beginPath(); g.ellipse(0, 3, 9, 5, 0, 0, Math.PI * 2); g.fill();
    // 車体（上から見た形）
    g.fillStyle = GP.gfx.shade(col, -0.34);
    g.fillRect(-8, -12, 16, 24);
    g.fillStyle = col;
    g.fillRect(-7, -11, 14, 22);
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.fillRect(-7, -11, 14, 4);
    // 窓
    g.fillStyle = '#15161b';
    g.fillRect(-5, -6, 10, 8);
    // タイヤ
    g.fillStyle = '#12101a';
    g.fillRect(-10, -9, 4, 6); g.fillRect(6, -9, 4, 6);
    g.fillRect(-10, 4, 4, 6);  g.fillRect(6, 4, 4, 6);
    // ライト
    if (S.spec.night) {
      const gl = g.createRadialGradient(0, -14, 2, 0, -14, 60);
      gl.addColorStop(0, 'rgba(255,240,190,.55)');
      gl.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = gl; g.fillRect(-60, -74, 120, 74);
    }
    g.restore();
  }

  /* ---------- 画面に重ねるもの ---------- */
  function overlay(g, f) {
    const km = (S.spec.km * f);
    const t = S.t;
    // 上の帯
    g.fillStyle = 'rgba(18,16,26,.72)';
    g.fillRect(0, 0, VW, 26);
    g.font = 'bold 13px sans-serif'; g.textAlign = 'left';
    g.fillStyle = '#fff8e6';
    g.fillText('SS' + S.spec.n + ' ' + S.spec.name, 8, 18);
    g.textAlign = 'right';
    g.fillStyle = '#ffd98a';
    g.fillText(fmt(t), VW - 8, 18);
    g.textAlign = 'center';
    g.fillStyle = '#b5aabb'; g.font = 'bold 11px sans-serif';
    g.fillText(km.toFixed(1) + ' / ' + S.spec.km.toFixed(1) + ' km', VW / 2, 17);
    // 先頭との開き。まだ全員が走り終えていないので「いまのペースなら」の話
    if (S.spec.leadTime) {
      const d = t - S.spec.leadTime * f;
      const good = d <= 0;
      g.font = 'bold 15px sans-serif'; g.textAlign = 'center';
      const w = 96, x0 = VW / 2 - w / 2;
      g.fillStyle = good ? 'rgba(45,107,50,.86)' : 'rgba(143,42,36,.86)';
      g.fillRect(x0, 30, w, 20);
      g.fillStyle = '#fff8e6';
      g.fillText((d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1), VW / 2, 45);
      g.font = 'bold 9px sans-serif';
      g.fillStyle = 'rgba(255,248,230,.75)';
      g.fillText('ベストとの差', VW / 2, 58);
    }
    // 進み具合の帯
    g.fillStyle = 'rgba(255,248,230,.20)'; g.fillRect(0, 26, VW, 3);
    g.fillStyle = '#e0ae3c'; g.fillRect(0, 26, VW * f, 3);
  }

  function fmt(t) {
    const m = Math.floor(t / 60), s2 = t - m * 60;
    return m + ':' + (s2 < 10 ? '0' : '') + s2.toFixed(1);
  }

  /* ---------- 画面下のふたつ（HTML側） ---------- */
  function paintNote() {
    const el = document.getElementById('ryNote');
    if (!el || !S) return;
    /* 出すのは2つまで。いま読まれたものを大きく、
       直前のものを小さく残す（それ以上はただの帯になる）   */
    el.innerHTML = S.notes.slice(0, 2).map((n, i2) =>
      '<b class="ry-say' + (i2 === 0 ? ' now' : '') + ' s' + n.sev + '">' +
      n.say + '</b>').join('');
  }
  function paintLog() {
    const el = document.getElementById('ryLog');
    if (!el || !S) return;
    el.innerHTML = S.logs.map(m =>
      '<div class="ry-ev' + (m.out ? ' out' : '') + '">' +
      '<i>' + m.icon + '</i><b>' + m.name + '</b>' +
      '<span>' + m.line + '</span>' +
      (m.loss ? '<em>+' + m.loss + '秒</em>' : '') + '</div>').join('');
  }

  return { start, stop, skip, setRate };
})();

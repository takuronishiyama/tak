/* =========================================================
   カートのミニゲーム
   実際に運転して走る、小さなレース。

   車の状態は「コース上のどこか（s）」と「中心線からどれだけ横に
   ずれているか（off）」で持つ。曲がりどころでは速度の二乗に比例して
   外へ押し出され、それをステアリングで押し戻す。
   タイヤの許容を超えると滑り、コースの外に出れば急に遅くなる。
   内側を通ったぶんだけ距離が短くなるのも、そのまま式に入っている。

   操作は「左・右・アクセル・ブレーキ」の4つだけ。
   指2本で足りるように、画面のボタンでもキーボードでも動く。
   ========================================================= */
window.GP = window.GP || {};

GP.kart = (function () {
  'use strict';

  const W = 620, H = 380;              // 描画の基準サイズ
  const HALF = 26;                     // コース幅の半分（中心線からの距離）
  const LAPS = 3;

  /* ---- 走りの手ざわり ---- */
  const LOADK = 0.0001;   // 横荷重の係数（k * v^2 * LOADK が、タイヤにかかる力）
  const P = {
    acc:    98,      // アクセルの加速（px/s^2）。抵抗と釣り合うのが最高速
    brk:    170,     // ブレーキ
    drag:   0.42,    // 速度に比例する抵抗（98/0.42 ≒ 233 が上限になる）
    vmax:   225,     // 出せる速さの上限
    steer:  1.20,    // ステアリングの効き（速度に比例）
    out:    3.00,    // 曲がりどころで外へ押される強さ（速度の二乗に比例）
    grip:   0.0155,  // これを超えると滑る（k * v^2 * LOADK のしきい）
    slip:   1.60,    // 滑ったときに、さらに外へ流れる量
    slipDrag: 0.65,  // 滑っているあいだ、速さも失う
    dirt:   0.955,   // コースの外に出ているあいだ、毎フレーム掛かる減速
    dirtMax: 96,     // 外に出ているときの上限速度
    bump:   0.55     // 前の車に詰まったときの、横へのよけ
  };
  /* その曲がり具合で、タイヤが耐えられる速さ */
  function safeV(k, skill) {
    return Math.sqrt(P.grip * skill / Math.max(1e-7, LOADK * Math.abs(k)));
  }

  /* ---- カート場のかたち ----
     小さくて、切り返しが多く、ストレートは短い。
     一周が短いので、1つのミスがそのまま順位になる           */
  const SHAPE = [
    [ 78, 300], [ 60, 232], [ 74, 168], [126, 130], [188, 132],
    [230, 168], [246, 214], [286, 238], [330, 214], [338, 160],
    [372,  96], [446,  78], [520,  96], [556, 150], [548, 214],
    [500, 252], [452, 236], [420, 262], [438, 306], [396, 336],
    [300, 342], [190, 338], [118, 330]
  ];

  /* ---------- 中心線を細かく取り直す ----------
     角の丸い閉じた線にして、各点での「曲がり具合」まで持たせる  */
  let PATH = null;
  function buildPath() {
    if (PATH) return PATH;
    const src = SHAPE;
    const n = src.length;
    const pts = [];
    const at = i => src[((i % n) + n) % n];
    // カトマル・ロムで、角を丸めながら細かく打ち直す
    for (let i = 0; i < n; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let t = 0; t < 1; t += 1 / 14) {
        const t2 = t * t, t3 = t2 * t;
        pts.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
                 (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                 (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
                 (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                 (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    // 累積距離と、進む向き
    const m = pts.length;
    const cum = [0];
    for (let i = 1; i <= m; i++) {
      const a = pts[i - 1], b = pts[i % m];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const len = cum[m];
    // 曲がり具合（符号つき）。左に曲がるほど正
    const curv = [];
    for (let i = 0; i < m; i++) {
      const a = pts[(i - 1 + m) % m], b = pts[i], c = pts[(i + 1) % m];
      const v1x = b[0] - a[0], v1y = b[1] - a[1];
      const v2x = c[0] - b[0], v2y = c[1] - b[1];
      const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
      const cross = (v1x * v2y - v1y * v2x) / (l1 * l2);
      const seg = (l1 + l2) / 2;
      curv.push(Math.asin(Math.max(-1, Math.min(1, cross))) / (seg || 1));
    }
    // 少しならして、角のとがりを消す
    const sm = curv.map((_, i) => {
      let a = 0;
      for (let k = -3; k <= 3; k++) a += curv[(i + k + m) % m];
      return a / 7;
    });
    PATH = { pts: pts, cum: cum, len: len, curv: sm, n: m };
    return PATH;
  }

  /* s（距離）から、その地点の情報を取り出す */
  function atS(s) {
    const p = buildPath();
    let d = s % p.len; if (d < 0) d += p.len;
    // 二分探索
    let lo = 0, hi = p.n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (p.cum[mid] <= d) lo = mid + 1; else hi = mid; }
    const i = Math.max(0, lo - 1);
    const a = p.pts[i], b = p.pts[(i + 1) % p.n];
    const segLen = Math.max(0.0001, p.cum[i + 1] - p.cum[i]);
    const t = (d - p.cum[i]) / segLen;
    const dx = (b[0] - a[0]) / segLen, dy = (b[1] - a[1]) / segLen;
    return {
      x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t,
      dx: dx, dy: dy,
      // 左向きの法線
      nx: dy, ny: -dx,
      k: p.curv[i] * (1 - t) + p.curv[(i + 1) % p.n] * t
    };
  }
  /* 少し先の曲がり具合を覗く。AIが「そろそろ緩める」判断に使う */
  function lookAhead(s, dist) {
    let worst = 0;
    for (let d = 8; d <= dist; d += 10) {
      const k = Math.abs(atS(s + d).k);
      if (k > worst) worst = k;
    }
    return worst;
  }

  /* ---------- 1台ぶん ---------- */
  function makeKart(o) {
    return {
      name: o.name, color: o.color, mine: !!o.mine, you: !!o.you,
      youth: o.youth || null, star: !!o.star,
      skill: o.skill,              // 0.80〜1.15 くらい
      s: o.s, s0: o.s, off: o.off, v: 0,
      lap: 0, done: false, time: 0, spun: 0, offTrack: 0,
      prevS: o.s, slip: 0, nudge: 0,
      // その日の勢いと、好んで通るライン。同じ腕でも、走りは同じにならない
      dash: o.dash == null ? Math.random() : o.dash,
      line: o.line == null ? (Math.random() * 2 - 1) : o.line
    };
  }

  /* AIの操作を決める。
     先の曲がり具合に合わせて速度を作り、内側を狙って寄せていく */
  function driveAI(k, dt) {
    const here = atS(k.s);
    // 先を見て、いちばんきつい曲がりに合わせて速さを作る。
    // 速く走っている子ほど遠くまで見る（＝手前から緩める）
    const ahead = lookAhead(k.s, 45 + k.v * 0.55);
    const want = Math.min(P.vmax * k.skill, safeV(ahead, k.skill) * (0.84 + k.dash * 0.13));
    const th = k.v < want ? 1 : 0;
    const br = k.v > want * 1.06 ? Math.min(1, (k.v - want) / 24) : 0;
    // 曲がりの内側へ寄る。腕のある子ほど、きれいに縁石まで使う
    const target = here.k > 0.004 ? HALF * 0.55 * k.skill
                 : here.k < -0.004 ? -HALF * 0.55 * k.skill : k.line * HALF * 0.3;
    const st = Math.max(-1, Math.min(1, (target - k.off) * 0.085 + k.nudge));
    k.nudge *= 0.86;
    return { steer: st, throttle: th, brake: br };
  }

  /* 前の車に追いついたら、そのままでは抜けない。
     少し横へ出し、出られなければペースを落とす           */
  function traffic(list, dt) {
    const p = buildPath();
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.done) continue;
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const b = list[j];
        let ds = b.s - a.s;
        while (ds < -p.len / 2) ds += p.len;
        while (ds > p.len / 2) ds -= p.len;
        if (ds <= 0 || ds > 15) continue;                 // 前にいる車だけ
        if (Math.abs(b.off - a.off) > 11) continue;       // 横にずれていれば通れる
        // 外側へ逃がす（内側に詰めると壁になるので、空いているほうへ）
        const dir = a.off >= b.off ? 1 : -1;
        a.nudge = (a.nudge || 0) + dir * 0.70;
        b.nudge = (b.nudge || 0) - dir * 0.18;
        // 詰まるのは「追いついているとき」だけ。
        // 同じ速さで続いているのに落とし続けると、後ろが永久に離される
        if (a.v > b.v) a.v -= (a.v - b.v) * P.bump * dt * 6;
      }
    }
  }

  /* 1台を1フレーム進める */
  function step(k, inp, dt) {
    const here = atS(k.s);
    // ---- 速さ ----
    k.v += (P.acc * inp.throttle - P.brk * inp.brake - P.drag * k.v) * dt;
    if (k.slip > 0) k.v -= P.slipDrag * k.v * dt;
    if (Math.abs(k.off) > HALF) {
      k.v *= Math.pow(P.dirt, dt * 60);
      if (k.v > P.dirtMax) k.v = P.dirtMax;
      k.offTrack += dt;
    }
    k.v = Math.max(0, Math.min(P.vmax * 1.15, k.v));

    // ---- 横方向 ----
    // 曲がりどころでは、速度の二乗に比例して外へ押し出される
    const push = -here.k * k.v * k.v * P.out * 0.0016;
    let move = push + inp.steer * k.v * P.steer * 0.012;
    // タイヤの許容を超えたら滑る
    const load = Math.abs(here.k) * k.v * k.v * LOADK;
    if (load > P.grip * k.skill) {
      k.slip = 0.25;
      move += push * P.slip;
      k.spun += dt;      // 滑っていた時間。あとで「スピンした」の判定に使う
    } else if (k.slip > 0) k.slip = Math.max(0, k.slip - dt);
    k.off += move * dt * 60 * 0.5;
    // 縁石の外へ大きく出ると、はじかれて戻る
    if (Math.abs(k.off) > HALF * 1.9) {
      k.off = Math.sign(k.off) * HALF * 1.9;
      k.v *= 0.86;
    }

    // ---- 進む ----
    // 内側を通れば、そのぶん距離が短い（曲率と横位置から出る）
    const gain = 1 / Math.max(0.55, 1 - here.k * k.off);
    k.prevS = k.s;
    k.s += k.v * dt * gain;
    /* 周回は「スタートした地点からの距離」で数える。
       グリッドの位置で走る距離が変わってしまわないように       */
    const p = buildPath();
    k.run = k.s - k.s0;
    k.lap = Math.floor(k.run / p.len);
    k.time += dt;
  }

  /* ---------- 走らせる ---------- */
  let st = null;      // いま動いているレース

  function start(opts) {
    buildPath();
    const p = PATH;
    const list = (opts.field || []).map((e, i) => makeKart({
      name: e.name, color: e.color, mine: e.mine, you: e.you,
      youth: e.youth, star: e.star, skill: e.skill,
      // スタートは縦に並べる。前のほうが少しだけ有利
      s: p.len - i * 20, off: (i % 2 ? 1 : -1) * HALF * 0.55
    }));
    st = {
      karts: list, t: 0, laps: opts.laps || LAPS,
      inp: { steer: 0, throttle: 0, brake: 0 },
      over: false, count: 3.2, best: Infinity
    };
    return st;
  }

  function tick(dt) {
    if (!st || st.over) return st;
    if (st.count > 0) {          // カウントダウン
      st.count -= dt;
      return st;
    }
    st.t += dt;
    traffic(st.karts, dt);
    st.karts.forEach(k => {
      if (k.done) return;
      const inp = k.you ? st.inp : driveAI(k, dt);
      step(k, inp, dt);
      if (k.lap >= st.laps) { k.done = true; k.finish = st.t; }
    });
    // 順位
    const order = st.karts.slice().sort((a, b) =>
      (a.done && b.done) ? a.finish - b.finish : (b.run || 0) - (a.run || 0));
    order.forEach((k, i) => { k.pos = i + 1; });
    st.order = order;
    // 自分がゴールし、上位がだいたい終わったら締める
    const you = st.karts.filter(k => k.you)[0];
    if ((you && you.done) || st.karts.every(k => k.done) || st.t > 240) {
      if (st.karts.filter(k => !k.done).length === 0 || (you && you.done)) st.over = true;
    }
    return st;
  }

  /* 走り終えていない車も、いまの位置から推して着順を決める */
  function finish() {
    if (!st) return [];
    const order = st.karts.slice().sort((a, b) =>
      (a.done && b.done) ? a.finish - b.finish
      : a.done ? -1 : b.done ? 1
      : (b.run || 0) - (a.run || 0));
    order.forEach((k, i) => { k.pos = i + 1; });
    return order;
  }

  /* ---------- 描画 ---------- */
  function draw(cv, opts) {
    if (!st || !cv) return;
    const g = cv.getContext('2d');
    const p = buildPath();
    const sc = cv.width / W;
    g.save();
    g.scale(sc, sc);
    g.imageSmoothingEnabled = false;

    // 地面
    g.fillStyle = opts && opts.dusk ? '#20301e' : '#3f6b35';
    g.fillRect(0, 0, W, H);
    // 芝の斑
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 90; i++) {
      const x = (i * 137) % W, y = (i * 211) % H;
      g.fillRect(x, y, 3, 2);
    }

    // コース（外→内の順に塗る）
    const edge = (w, style) => {
      g.beginPath();
      for (let i = 0; i <= p.n; i++) {
        const a = atS(p.cum[i % p.n]);
        const x = a.x + a.nx * w, y = a.y + a.ny * w;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.strokeStyle = style; g.stroke();
    };
    g.lineWidth = HALF * 2 + 6; g.lineJoin = 'round'; g.lineCap = 'round';
    edge(0, '#b9a98d');                       // 縁石まわりの砂
    g.lineWidth = HALF * 2;
    edge(0, opts && opts.dusk ? '#2e2e33' : '#4a4a50');   // 路面
    // 縁石（赤白）
    g.lineWidth = 3;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < p.n; i += 6) {
        const a = atS(p.cum[i]);
        if (Math.abs(a.k) < 0.006) continue;
        g.beginPath();
        const w = side * (HALF - 1);
        g.moveTo(a.x + a.nx * w, a.y + a.ny * w);
        const b = atS(p.cum[i] + 8);
        g.lineTo(b.x + b.nx * w, b.y + b.ny * w);
        g.strokeStyle = ((i / 6) | 0) % 2 ? '#e05a4a' : '#f2ece2';
        g.stroke();
      }
    }
    // 中央の破線
    g.lineWidth = 1.5; g.setLineDash([6, 10]);
    edge(0, 'rgba(255,255,255,0.18)');
    g.setLineDash([]);
    // スタートライン
    {
      const a = atS(0);
      g.save();
      g.translate(a.x, a.y);
      g.rotate(Math.atan2(a.dy, a.dx));
      for (let i = -HALF; i < HALF; i += 6) {
        g.fillStyle = ((i / 6) | 0) % 2 ? '#f2ece2' : '#2a2a2e';
        g.fillRect(-2, i, 4, 6);
      }
      g.restore();
    }

    // 車
    st.karts.slice().sort((a, b) => (a.you ? 1 : 0) - (b.you ? 1 : 0)).forEach(k => {
      const a = atS(k.s);
      const x = a.x + a.nx * k.off, y = a.y + a.ny * k.off;
      const ang = Math.atan2(a.dy, a.dx) + (k.slip > 0 ? (Math.random() - 0.5) * 0.5 : 0);
      g.save();
      g.translate(x, y); g.rotate(ang);
      // 影
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(-6, -3, 13, 7);
      // 車体
      g.fillStyle = k.color; g.fillRect(-6, -4, 12, 8);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-6, -4, 3, 8);
      // タイヤ
      g.fillStyle = '#22201e';
      g.fillRect(-5, -6, 3, 2); g.fillRect(-5, 4, 3, 2);
      g.fillRect(2, -6, 3, 2);  g.fillRect(2, 4, 3, 2);
      if (k.you) {                                   // 自分の車には矢印
        g.fillStyle = '#ffe066';
        g.fillRect(-1, -10, 2, 3);
        g.fillRect(-3, -8, 6, 2);
      }
      g.restore();
      // 名前
      if (k.you || k.mine) {
        g.font = '7px system-ui, sans-serif';
        g.textAlign = 'center';
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.65)';
        g.strokeText(k.name, x, y - 11);
        g.fillStyle = k.you ? '#ffe066' : '#d8ffd0';
        g.fillText(k.name, x, y - 11);
      }
    });
    g.restore();
  }

  return { start, tick, draw, finish, buildPath, W, H, LAPS,
           get state() { return st; } };
})();

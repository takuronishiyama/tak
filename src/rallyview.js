/* =========================================================
   SSを走っているところを見せる

   サーキットの中継と違って、映すのは1台だけ。
   ラリーは「並んで走らない競技」なので、緊張の出どころが違う。
     ・次に何が来るかは、右席の読み上げだけが教えてくれる
     ・タイムは、誰かと並んでいなくても、刻一刻と削られている
   だから画面の主役は、道と、ペースノートと、時計になる。

   走りそのものは rally.js がもう決めてある（区間タイムも、
   どこで何が起きたかも）。ここでやるのは、その再生だけ。

   ただし「どう走って見えるか」はここで決める。
     ・道の真ん中は走らない。外から入って、内をかすめて、外へ出る
     ・曲がりでは車は横を向く。路面が食わないほど、深く向く
     ・向いたぶんだけ、前輪は逆を向き、土煙は外へ飛び、轍が残る
   ========================================================= */
window.GP = window.GP || {};

GP.rallyview = (function () {
  'use strict';

  const VW = 560, VH = 400;
  const ZOOM = 1.45;
  const EYE = 0.74;              // 自車を画面のどのへんに置くか
  let PX = 1;
  let cv, ctx, raf = null;
  let S = null;                  // いまの走り
  let onEnd = null;
  let rate = 1;                  // 見せる速さ（実時間の何倍か）
  let lastTs = 0;

  const RD = () => GP.rallydata;
  const TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

  /* 路面ごとの、流れやすさ（ラジアン）と流れ出しの強さ */
  const SLIP_MAX = { gravel: 0.50, tarmac: 0.27, snow: 0.62 };
  const SLIP_K   = { gravel: 2.70, tarmac: 1.95, snow: 3.15 };
  /* 攻めかたでも変わる。振り切れば深く向く */
  const PACE_K   = { safe: 0.80, std: 1.00, push: 1.16, max: 1.30 };

  /* ---------- ならし ---------- */
  function blur(a, rad) {
    const N = a.length, out = new Float64Array(N);
    const sum = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) sum[i + 1] = sum[i] + a[i];
    for (let i = 0; i < N; i++) {
      const lo = Math.max(0, i - rad), hi = Math.min(N, i + rad + 1);
      out[i] = (sum[hi] - sum[lo]) / (hi - lo);
    }
    return out;
  }

  /* ---------- 走る線 ----------
     道の真ん中をなぞるのではなく、「そこをどう走るか」を作る。
       lat  … 道の中のどこを通るか（外→内→外）
       slip … 車体が進行方向からどれだけ横を向いているか
     lat は「狭いならし − 広いならし」で作る。曲がりの真ん中では
     正（内側）、その手前と出口では負（外側）になる。          */
  function buildLine(road, spec) {
    const N = road.n, P = road.pts;
    const ang = new Float64Array(N);
    for (let i = 0; i < N - 1; i++) {
      ang[i] = Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]);
    }
    ang[N - 1] = N > 1 ? ang[N - 2] : 0;

    const dk = new Float64Array(N);
    for (let i = 0; i < N - 1; i++) dk[i] = wrap(ang[i + 1] - ang[i]);

    const nar = blur(dk, 4), wide = blur(dk, 26), dks = blur(dk, 3);

    // 通る位置（道の中心からの横ずれ）
    const maxLat = 6.6;
    const latR = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      latR[i] = clamp((nar[i] - wide[i] * 0.72) * 32, -maxLat, maxLat);
    }
    const lat = blur(latR, 6);

    const x = new Float64Array(N), y = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      x[i] = P[i][0] - Math.sin(ang[i]) * lat[i];
      y[i] = P[i][1] + Math.cos(ang[i]) * lat[i];
    }
    // 実際に進んでいる向き
    const drv = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const j = Math.min(N - 1, i + 2), i0 = Math.max(0, i - 1);
      drv[i] = Math.atan2(y[j] - y[i0], x[j] - x[i0]);
    }

    /* 横を向く角。曲がりのきつさ × そのときの速さ。
       路面が食わないほど深く、攻めるほど深く                */
    const sfc = spec.surface;
    let mx = SLIP_MAX[sfc] || 0.50, kk = SLIP_K[sfc] || 2.7;
    const pk = PACE_K[spec.pace || 'std'] || 1;
    mx *= pk; kk *= pk;
    if (spec.wet) { mx *= 1.12; kk *= 1.15; }
    const slip = new Float64Array(N);
    let cur = 0;
    for (let i = 0; i < N; i++) {
      const sp = road.keep[i];
      const t = clamp(dks[i] * kk * (0.42 + 0.58 * sp), -mx, mx);
      /* 流れ出しは速く、戻りは遅い。
         だから立ち上がりでも、しばらく横を向いたまま出ていく */
      cur += (t - cur) * (Math.abs(t) > Math.abs(cur) ? 0.38 : 0.21);
      slip[i] = cur;
    }
    return { x: x, y: y, drv: drv, slip: slip, lat: lat, ang: ang };
  }

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

  /* =========================================================
     道ばた

     ここが寂しいと、速さが出ない。まわりに何も無い道は、
     どれだけ飛ばしても「止まっている絵」に見えてしまう。
     だから、置くものは三層に分ける。
       far  … 森・岩肌・畑。遠くを埋めて、地面を地面でなくす
       near … 路肩の草・標識・ポール。通り過ぎる速さを作る
       over … ギャラリー・横断幕。人の気配を入れる
     ======================================================= */

  function normAt(road, i) {
    const P = road.pts, j = Math.min(road.n - 1, i + 1), i0 = Math.max(0, i - 1);
    return Math.atan2(P[j][1] - P[i0][1], P[j][0] - P[i0][0]);
  }

  /* そのラリーの土地柄。同じグラベルでも、森と乾いた大地では別の絵になる */
  function flavorOf(spec) {
    const ral = spec.rally || {};
    const k = ral.key || '';
    if (spec.surface === 'snow') return 'snow';
    if (ral.heat || k === 'savanna' || k === 'sierra') return 'dry';
    if (spec.surface === 'tarmac') {
      return (k === 'vigna' || k === 'mixto' || k === 'olive') ? 'med' : 'alp';
    }
    return 'forest';
  }

  function buildProps(road, spec) {
    const far = [], near = [], over = [];
    const fl = flavorOf(spec);
    const N = road.n;
    let h = (((spec.n | 0) + 1) * 374761393 + 668265263) >>> 0;
    const r = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };

    /* 道は折り返す。ある区間の路肩に置いたものが、
       戻ってきた別の区間の路面の真ん中に立っていることがある。
       近くの道から離れているものだけを置く                      */
    const clearOf = (px, py, i) => {
      const lo = Math.max(0, i - 90), hi = Math.min(N - 1, i + 90);
      for (let k = lo; k <= hi; k++) {
        if (Math.abs(k - i) < 8) continue;
        const dx = road.pts[k][0] - px, dy = road.pts[k][1] - py;
        if (dx * dx + dy * dy < 210) return false;      // 14.5 の二乗
      }
      return true;
    };

    const add = (arr, i, d, side, t, s, c, c2) => {
      const a = normAt(road, i);
      const px = road.pts[i][0] - Math.sin(a) * d * side;
      const py = road.pts[i][1] + Math.cos(a) * d * side;
      if (arr !== far && !clearOf(px, py, i)) return;
      arr.push({
        i: i, a: a, t: t, s: s == null ? r() : s, side: side, c: c || null, c2: c2 || null,
        x: px, y: py
      });
    };

    /* ---- 地面のむら。一色の面に、うっすら別の色を置く ---- */
    for (let i = 0; i < N; i += 11) {
      if (r() > 0.55) continue;
      const side = r() < 0.5 ? -1 : 1;
      add(far, i, 24 + r() * 90, side, 'patch', r());
    }

    /* ---- 遠景 ---- */
    const farStep = fl === 'dry' ? 3 : 2;
    const farP = fl === 'dry' ? 0.46 : fl === 'med' ? 0.64 : 0.80;
    for (let i = 0; i < N; i += farStep) {
      for (const side of [-1, 1]) {
        if (r() > farP) continue;
        const d = 30 + Math.pow(r(), 0.8) * 92;
        const q = r();
        if (fl === 'snow')        add(far, i, d, side, q < 0.86 ? 'pine' : 'rock', r());
        else if (fl === 'forest') add(far, i, d, side, q < 0.66 ? 'pine' : q < 0.92 ? 'tree' : 'rock', r());
        else if (fl === 'dry')    add(far, i, d, side, q < 0.45 ? 'acacia' : q < 0.80 ? 'scrub' : 'rock', r());
        else if (fl === 'med')    add(far, i, d, side, q < 0.42 ? 'cypress' : q < 0.86 ? 'olive' : 'rock', r());
        else                      add(far, i, d, side, q < 0.70 ? 'pine' : q < 0.88 ? 'rock' : 'tree', r());
      }
    }

    /* ---- 切れ目なく続くもの ----
       雪の壁・石垣・ガードレールは、とびとびに置くと
       「積まれた壁」ではなく「落ちている石」に見える。
       だから1点ごとに置いて、隣とわずかに重ねる              */
    if (fl === 'snow' || fl === 'med' || fl === 'alp') {
      const kind = fl === 'snow' ? 'bank' : fl === 'med' ? 'wall' : 'guard';
      const dd = fl === 'alp' ? 16 : 15.5;
      let on = [true, true], run = [0, 0];
      for (let i = 0; i < N; i++) {
        for (let sj = 0; sj < 2; sj++) {
          if (--run[sj] <= 0) {
            /* 続いたり、途切れたりする。ずっと続くと、こんどは壁が主役になる */
            on[sj] = fl === 'snow' ? true : r() < (fl === 'alp' ? 0.44 : 0.66);
            run[sj] = 8 + Math.floor(r() * 26);
          }
          /* 高さは隣とつなげる。1点ごとにばらばらだと、
             積もった雪ではなく、並べた箱になる                 */
          const hh = 0.5 + 0.30 * Math.sin(i * 0.31) + 0.16 * Math.sin(i * 0.107 + 2);
          if (on[sj]) add(near, i, dd, sj ? 1 : -1, kind, hh);
        }
      }
    }

    /* ---- 路肩 ---- */
    for (let i = 0; i < N; i += 2) {
      for (const side of [-1, 1]) {
        const q = r();
        const d = 15 + r() * 12;
        if (fl === 'snow') {
          if (q < 0.10) add(near, i, d + 4, side, 'fir', r());
        } else if (fl === 'dry') {
          if (q < 0.52) add(near, i, d, side, 'tuftdry', r());
          else if (q < 0.64) add(near, i, d, side, 'stone', r());
          else if (q < 0.70) add(near, i, d + 4, side, 'scrub', r());
        } else if (fl === 'med') {
          if (q < 0.30) add(near, i, d + 3, side, 'tuft', r());
        } else if (fl === 'alp') {
          if (q < 0.26) add(near, i, d + 3, side, 'stone', r());
          else if (q < 0.44) add(near, i, d + 3, side, 'tuft', r());
        } else {
          if (q < 0.54) add(near, i, d, side, 'tuft', r());
          else if (q < 0.64) add(near, i, d, side, 'fern', r());
          else if (q < 0.70) add(near, i, d, side, 'stone', r());
        }
      }
    }

    /* ---- 目印。等間隔に並ぶものがあると、速さが読める ---- */
    const poleEvery = fl === 'snow' ? 9 : 16;
    for (let i = 6; i < N; i += poleEvery) {
      const side = ((i / poleEvery) | 0) % 2 ? 1 : -1;
      add(near, i, 16.5, side, fl === 'snow' ? 'pole' : 'post', 0.5);
    }

    /* ---- ギャラリー ----
       人が立つのは、きつい曲がりの外側。そこがいちばんよく見える。
       ラリーで沿道に人がいるのは、その曲がりが見どころだという印になる */
    const FANC = ['#c23a2e', '#2a5aa8', '#e0ae3c', '#2d6b32', '#7a4fc0', '#d8d2c4', '#c85a8a'];
    (road.notes || []).forEach((nt, k) => {
      if (nt.sev > 3) return;
      if (r() > (nt.sev === 1 ? 0.88 : nt.sev === 2 ? 0.62 : 0.34)) return;
      const outside = nt.dir === 'R' ? -1 : 1;     // 曲がりの外側
      const at = Math.min(N - 3, (nt.out || nt.at) + 2);
      const cnt = 3 + Math.floor(r() * 7);
      for (let m = 0; m < cnt; m++) {
        const off = Math.round((r() - 0.5) * 22);
        const i2 = clamp(at + off, 1, N - 2);
        add(over, i2, 22 + r() * 16, outside, 'fan', r(),
            FANC[Math.floor(r() * FANC.length)], FANC[Math.floor(r() * FANC.length)]);
      }
      if (r() < 0.34) add(near, clamp(at + 14, 1, N - 2), 34 + r() * 18, outside, 'parked', r(),
                          FANC[Math.floor(r() * FANC.length)]);
      if (r() < 0.30) add(near, clamp(at - 12, 1, N - 2), 18 + r() * 5, outside, 'hay', r());
    });

    /* ---- 注意の看板。曲がりの手前に立つ ---- */
    (road.notes || []).forEach(nt => {
      if (!nt.tag || (nt.tag.key !== 'care' && nt.tag.key !== 'jump' && nt.tag.key !== 'crest')) return;
      const i2 = clamp(nt.at - 9, 1, N - 2);
      add(near, i2, 17, r() < 0.5 ? -1 : 1, nt.tag.key === 'care' ? 'warn' : 'jumpsign', 0.5);
    });

    /* ---- 出発と到着 ---- */
    over.push({ i: 3, a: normAt(road, 3), t: 'arch', s: 0, side: 1,
                x: road.pts[3][0], y: road.pts[3][1], c: 'START' });
    over.push({ i: N - 2, a: normAt(road, N - 2), t: 'arch', s: 1, side: 1,
                x: road.pts[N - 2][0], y: road.pts[N - 2][1], c: 'FINISH' });

    const by = (a, b) => a.i - b.i;
    far.sort(by); near.sort(by); over.sort(by);
    return { far: far, near: near, over: over, flavor: fl };
  }

  /* ---------- 始める ---------- */
  function start(canvas, spec, endCb) {
    cv = canvas; ctx = cv.getContext('2d');
    PX = GP.gfx.fit(cv, VW, VH, { max: 2 });
    onEnd = endCb || null;
    const road = spec.road;
    S = {
      spec: spec, road: road,
      line: buildLine(road, spec),
      props: buildProps(road, spec),
      time: buildTimeline(road, spec.timeS),
      i: 0,                 // いま道のどの点にいるか
      t: 0,                 // 経過（秒）
      done: false,
      holdUntil: 0,         // 何かが起きて止まっているあいだ
      holdAll: 0,
      inc: null,            // いま起きていること
      said: 0,              // どこまで読み上げたか
      notes: [],            // 出ている読み上げ
      logs: [],
      moments: (spec.moments || []).slice().sort((a, b) => a.at - b.at),
      fired: 0,
      shake: 0,
      dust: [],
      marks: [],
      mprev: [null, null]
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
      if (S.holdUntil <= 0) { S.holdUntil = 0; S.inc = null; }
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
      S.holdAll = S.holdUntil;
      S.inc = { key: m.key || '', out: !!m.out };
      if (m.out) { paintLog(); draw(f); setTimeout(finish, 900); return; }
      paintLog();
    }
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 3);

    // 轍と土煙。横を向いているぶんだけ、派手になる
    if (S.holdUntil <= 0 && S.i > 0) {
      const L = S.line, i = S.i;
      const sl = L.slip[i], head = L.drv[i] + sl;
      pushMark([L.x[i], L.y[i]], head, sl);
      pushDust([L.x[i], L.y[i]], head, sl, S.road.keep[i]);
    }

    draw(f);
    if (S.i >= N - 1) { finish(); return; }
    raf = requestAnimationFrame(tick);
  }

  /* =========================================================
     絵
     ======================================================= */

  /* カメラ。道ばたのものは「立って」見えてほしいので、
     地面に寝ているもの（道・轍・土煙）だけを回した座標で描き、
     立っているものは、いったん画面の座標に落としてから描く    */
  const CAM = { px: 0, py: 0, t: 0, ct: 1, st: 0, ox: 0, oy: 0 };
  function project(wx, wy) {
    const dx = wx - CAM.px, dy = wy - CAM.py;
    return [VW / 2 + CAM.ox + (dx * CAM.ct - dy * CAM.st) * ZOOM,
            VH * EYE + CAM.oy + (dx * CAM.st + dy * CAM.ct) * ZOOM];
  }
  function camera(g) {
    g.translate(VW / 2 + CAM.ox, VH * EYE + CAM.oy);
    g.scale(ZOOM, ZOOM);
    g.rotate(CAM.t);
    g.translate(-CAM.px, -CAM.py);
  }

  function draw(f) {
    const road = S.road, L = S.line, i = S.i;
    const k = GP.gfx.fit(cv, VW, VH, { max: 2 });
    if (Math.abs(k - PX) > 0.01) { PX = k; GP.fx.init(VW * PX, VH * PX); }
    const dusk = document.body.getAttribute('data-skin') === 'hd';
    const out = ctx;
    const g = dusk ? GP.fx.begin() : out;
    GP.gfx.begin(g, PX);
    g.clearRect(0, 0, VW, VH);

    const sf = (RD().SURFACES[S.spec.surface] || RD().SURFACES.gravel);
    const night = !!S.spec.night;

    // カメラの置き場所
    const inc = incOffset();
    CAM.px = L.x[i]; CAM.py = L.y[i];
    CAM.t = -L.drv[i] - Math.PI / 2;
    CAM.ct = Math.cos(CAM.t); CAM.st = Math.sin(CAM.t);
    CAM.ox = S.shake > 0 ? (Math.random() - 0.5) * 7 * S.shake : 0;
    CAM.oy = S.shake > 0 ? (Math.random() - 0.5) * 7 * S.shake : 0;

    // 地面。一色だと「止まっている面」に見えるので、目を入れる
    g.fillStyle = groundOf(S.props.flavor, night);
    g.fillRect(0, 0, VW, VH);
    g.fillStyle = 'rgba(0,0,0,.07)';
    const ox = ((L.x[i] * 0.5) % 16 + 16) % 16, oy = ((L.y[i] * 0.5) % 16 + 16) % 16;
    for (let y = -16; y < VH + 16; y += 8) {
      for (let x = ((y / 8) % 2 ? -16 : -8); x < VW + 16; x += 16) {
        g.fillRect(x - ox, y - oy, 4, 4);
      }
    }

    const lo = Math.max(0, i - 70), hi = Math.min(road.n - 1, i + 130);

    drawProps(g, S.props.far, lo, hi, night);

    g.save(); camera(g);
    drawRoad(g, road, i, sf, night);
    drawMarks(g);
    drawDust(g);
    g.restore();

    drawProps(g, S.props.near, lo, hi, night);

    g.save(); camera(g);
    drawCar(g, L, i, inc);
    g.restore();

    drawProps(g, S.props.over, lo, hi, night);
    overlay(g, f);

    if (dusk) {
      GP.fx.composite(out, {
        dof: 0.25, focus: { x: VW * PX / 2, y: VH * PX * 0.70 }, focusR: VW * PX * 0.42,
        bloom: night ? 1.2 : 0.8, warm: 0.95, vignette: 0.9, night: night
      });
    }
  }

  /* 何かが起きたときの、車のふるまい */
  function incOffset() {
    if (!S.inc || S.holdAll <= 0) return null;
    const p = clamp(1 - S.holdUntil / S.holdAll, 0, 1);
    if (S.inc.key === 'spin') return { rot: TAU * 1.5 * (1 - Math.pow(1 - p, 2.2)), lat: 0 };
    if (S.inc.key === 'off' || S.inc.key === 'crash') {
      return { rot: 0.5 * Math.sin(p * Math.PI), lat: 26 * Math.sin(p * Math.PI) };
    }
    return { rot: 0, lat: 0 };
  }

  /* 地面の色。路面と同じ系統だと、道がどこにあるのか分からなくなる。
     土の道なら地面は草、乾いた大地なら枯れ草、雪なら影の青       */
  const GROUND = {
    snow:   ['#6d7aa8', '#1a1b33'],
    forest: ['#1b3a1c', '#0d2413'],
    alp:    ['#26472a', '#0f2a18'],
    med:    ['#3d4a26', '#1a2a14'],
    dry:    ['#4d452c', '#2a2418']
  };
  function groundOf(flavor, night) {
    const c = GROUND[flavor] || GROUND.forest;
    return c[night ? 1 : 0];
  }

  function drawRoad(g, road, i, sf, night) {
    const from = Math.max(0, i - 60), to = Math.min(road.n - 1, i + 120);
    const surface = S.spec.surface;
    const w = 22;
    g.lineCap = 'round'; g.lineJoin = 'round';
    // 路肩の外。道と地面のあいだに一段はさむと、道が浮かなくなる
    g.strokeStyle = surface === 'snow' ? (night ? '#2c3357' : '#8e9ac4')
                  : surface === 'tarmac' ? (night ? '#152e1c' : '#2f5c26')
                  : (night ? '#241708' : '#6b4724');
    g.lineWidth = w + 21;
    line(g, road, from, to);
    // 路肩
    g.strokeStyle = surface === 'snow' ? (night ? '#445078' : '#b5aabb')
                  : surface === 'tarmac' ? (night ? '#12101a' : '#23222c')
                  : (night ? '#12101a' : '#2e1d10');
    g.lineWidth = w + 7;
    line(g, road, from, to);
    // 路面
    g.strokeStyle = roadColor(surface, night);
    g.lineWidth = w;
    line(g, road, from, to);
    // 路面の目。砂利はまだら、舗装は継ぎ目、雪は掘れたところ
    roadGrain(g, road, from, to, surface, night);
    // わだち
    g.strokeStyle = surface === 'tarmac' ? 'rgba(0,0,0,.09)' : 'rgba(0,0,0,.15)';
    g.lineWidth = 3;
    line(g, road, from, to);
    if (S.spec.wet) {
      g.strokeStyle = 'rgba(150,180,220,.13)';
      g.lineWidth = w - 4;
      line(g, road, from, to);
    }
    // ゴール
    if (to >= road.n - 2) {
      const q = road.pts[road.n - 1];
      for (let c = 0; c < 6; c++) {
        g.fillStyle = (c % 2) ? '#fff8e6' : '#12101a';
        g.fillRect(q[0] - 15 + c * 5, q[1] - 4, 5, 8);
      }
    }
  }

  /* 路面そのものの模様。無地のままだと、道が一本のテープに見える */
  function roadGrain(g, road, from, to, surface, night) {
    if (surface === 'tarmac') {
      g.strokeStyle = night ? 'rgba(255,248,230,.16)' : 'rgba(255,248,230,.34)';
      g.lineWidth = 1.2;
      for (const side of [-1, 1]) {
        g.beginPath();
        for (let k = from; k <= to; k++) {
          const a = normAt(road, k);
          const px = road.pts[k][0] - Math.sin(a) * 9.2 * side;
          const py = road.pts[k][1] + Math.cos(a) * 9.2 * side;
          if (k === from) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      }
      return;
    }
    g.fillStyle = surface === 'snow' ? 'rgba(120,132,170,.30)'
                                     : (night ? 'rgba(255,248,230,.07)' : 'rgba(46,29,16,.24)');
    for (let k = from; k <= to; k++) {
      const hs = ((k * 2654435761) >>> 0) / 4294967296;
      if (hs > 0.48) continue;
      const a = normAt(road, k);
      const d = (hs * 2 - 0.5) * 18;
      const px = road.pts[k][0] - Math.sin(a) * d;
      const py = road.pts[k][1] + Math.cos(a) * d;
      const s = 1.2 + hs * 3.4;
      g.fillRect(px - s / 2, py - s / 2, s, s);
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

  /* ---------- 轍 ----------
     横を向いて走ったところにだけ残る。
     「いま滑った」ことを、あとから目で確かめられるようにする  */
  function pushMark(p, head, slip) {
    const sl = Math.abs(slip);
    if (sl < 0.15) { S.mprev[0] = S.mprev[1] = null; return; }
    const th = head + Math.PI / 2;
    const c = Math.cos(th), s = Math.sin(th);
    for (let w = 0; w < 2; w++) {
      const lx = (w ? 8 : -8), ly = 7;
      const wx = p[0] + lx * c - ly * s;
      const wy = p[1] + lx * s + ly * c;
      const pv = S.mprev[w];
      if (pv) S.marks.push({ x0: pv[0], y0: pv[1], x1: wx, y1: wy, a: Math.min(1, sl / 0.4) });
      S.mprev[w] = [wx, wy];
    }
    if (S.marks.length > 560) S.marks.splice(0, S.marks.length - 560);
  }
  function drawMarks(g) {
    if (!S.marks.length) return;
    const surface = S.spec.surface;
    const col = surface === 'tarmac' ? '14,12,18' : surface === 'snow' ? '108,122,168' : '46,29,16';
    g.lineCap = 'round';
    for (let band = 0; band < 2; band++) {
      const a0 = surface === 'tarmac' ? 0.72 : 0.62, a1 = surface === 'tarmac' ? 0.36 : 0.34;
      g.strokeStyle = 'rgba(' + col + ',' + (band ? a0 : a1) + ')';
      g.lineWidth = band ? 3 : 6.4;
      g.beginPath();
      for (let k = 0; k < S.marks.length; k++) {
        const m = S.marks[k];
        if (band && m.a < 0.5) continue;
        g.moveTo(m.x0, m.y0); g.lineTo(m.x1, m.y1);
      }
      g.stroke();
    }
  }

  /* 砂煙。路面ごとに色と量が変わり、横を向くほど外へ飛ぶ。
     出どころは後ろの2輪。1点から出すと、煙が車の真後ろに一本立つ */
  function pushDust(p, head, slip, spd) {
    const surface = S.spec.surface;
    const sl = Math.abs(slip);
    const sg = slip >= 0 ? -1 : 1;                 // 流れている向きと反対へ飛ぶ
    const base = surface === 'tarmac' ? 0.4 : 2.4;
    const n = Math.round(base + sl * (surface === 'tarmac' ? 3.2 : 14) * (0.4 + spd));
    const nx = -Math.sin(head), ny = Math.cos(head);
    for (let k = 0; k < n; k++) {
      const w = (k % 2) ? 8 : -8;
      const back = 7 + Math.random() * 7;
      const out2 = sl * 11 * Math.random();
      S.dust.push({
        x: p[0] - Math.cos(head) * back + nx * (w * 0.7 + sg * out2) + (Math.random() - 0.5) * 6,
        y: p[1] - Math.sin(head) * back + ny * (w * 0.7 + sg * out2) + (Math.random() - 0.5) * 6,
        r: 2.4 + Math.random() * (3.2 + sl * 6), a: 1,
        vx: -Math.cos(head) * (0.5 + Math.random()) + nx * sg * (0.3 + sl * 4.2) * Math.random(),
        vy: -Math.sin(head) * (0.5 + Math.random()) + ny * sg * (0.3 + sl * 4.2) * Math.random()
      });
    }
    if (S.dust.length > 190) S.dust.splice(0, S.dust.length - 190);
  }
  function drawDust(g) {
    const surface = S.spec.surface;
    const col = surface === 'snow' ? '232,223,210'
              : surface === 'tarmac' ? '120,110,100' : '150,104,58';
    for (let k = 0; k < S.dust.length; k++) {
      const d = S.dust[k];
      d.x += d.vx; d.y += d.vy; d.r += 0.26; d.a -= 0.040;
      d.vx *= 0.96; d.vy *= 0.96;
      if (d.a <= 0) continue;
      g.fillStyle = 'rgba(' + col + ',' + (d.a * (surface === 'snow' ? 0.42 : 0.52)).toFixed(2) + ')';
      g.beginPath(); g.arc(d.x, d.y, d.r, 0, TAU); g.fill();
    }
    S.dust = S.dust.filter(d => d.a > 0);
  }

  /* ---------- 自車 ----------
     進んでいる向きと、車が向いている向きは別もの。
     そのずれが「流れている」ということで、
     前輪はそのずれを打ち消す側（＝逆ハンドル）を向く       */
  function drawCar(g, L, i, inc) {
    const slip = L.slip[i] + (inc ? inc.rot : 0);
    const drv = L.drv[i];
    let px = L.x[i], py = L.y[i];
    if (inc && inc.lat) {
      px += -Math.sin(drv) * inc.lat * (L.slip[i] >= 0 ? -1 : 1);
      py += Math.cos(drv) * inc.lat * (L.slip[i] >= 0 ? -1 : 1);
    }
    g.save();
    g.translate(px, py);
    g.rotate(drv + slip + Math.PI / 2);
    const col = S.spec.color || '#c23a2e';
    const sl = L.slip[i];
    // 影。流れている側へずれる
    g.fillStyle = 'rgba(0,0,0,.34)';
    g.beginPath(); g.ellipse(sl * 5, 3, 9, 5, 0, 0, TAU); g.fill();
    // タイヤ。後ろは車体なり、前は逆ハンドル
    const steer = clamp(-sl * 0.85, -0.5, 0.5);
    g.fillStyle = '#12101a';
    g.fillRect(-10, 4, 4, 6); g.fillRect(6, 4, 4, 6);
    wheel(g, -8, -6, steer); wheel(g, 8, -6, steer);
    // 車体（上から見た形）
    g.fillStyle = GP.gfx.shade(col, -0.34);
    g.fillRect(-8, -12, 16, 24);
    g.fillStyle = col;
    g.fillRect(-7, -11, 14, 22);
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.fillRect(-7, -11, 14, 4);
    g.fillStyle = GP.gfx.shade(col, -0.18);
    g.fillRect(-7, 5, 14, 6);
    // 窓
    g.fillStyle = '#15161b';
    g.fillRect(-5, -6, 10, 8);
    g.fillStyle = 'rgba(255,248,230,.16)';
    g.fillRect(-5, -6, 10, 2);
    // ルーフの番号板
    g.fillStyle = '#fff8e6';
    g.fillRect(-3, 1, 6, 4);
    // ライト
    if (S.spec.night) {
      /* 光は四角く出ない。前照灯の形に切っておく */
      g.save(); g.rotate(steer * 0.5);
      const gl = g.createRadialGradient(0, -12, 3, 0, -12, 72);
      gl.addColorStop(0, 'rgba(255,240,190,.52)');
      gl.addColorStop(0.5, 'rgba(255,240,190,.20)');
      gl.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = gl;
      g.beginPath();
      g.moveTo(-6, -12); g.lineTo(-34, -80); g.lineTo(34, -80); g.lineTo(6, -12);
      g.closePath(); g.fill();
      g.restore();
    }
    g.restore();
  }
  function wheel(g, x, y, a) {
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#12101a'; g.fillRect(-2, -3, 4, 6);
    g.restore();
  }

  /* =========================================================
     道ばたのものを描く
     ======================================================= */

  function lowerBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].i < v) lo = m + 1; else hi = m; }
    return lo;
  }

  function drawProps(g, arr, lo, hi, night) {
    let k = lowerBound(arr, lo);
    for (; k < arr.length && arr[k].i <= hi; k++) {
      const o = arr[k];
      const s = project(o.x, o.y);
      if (s[0] < -90 || s[0] > VW + 90 || s[1] < -140 || s[1] > VH + 70) continue;
      const fn = PROP[o.t];
      if (fn) fn(g, s[0], s[1], ZOOM, o, night);
    }
  }

  /* 立っているものの足もとに、必ず影を置く。
     これが無いと、絵が地面から浮いて、どこにあるのか読めない */
  function foot(g, x, y, w, z) {
    g.fillStyle = 'rgba(0,0,0,.22)';
    g.beginPath(); g.ellipse(x, y, w * z, w * z * 0.34, 0, 0, TAU); g.fill();
  }

  /* 岩肌の色。乾いた大地では砂の色、それ以外は灰 */
  function rockC(night, lit) {
    const dry = S.props && S.props.flavor === 'dry';
    if (dry) return night ? (lit ? '#4a3c28' : '#33291c') : (lit ? '#9a8358' : '#6e5a3c');
    return night ? (lit ? '#3a3648' : '#2a2733') : (lit ? '#7d7a8c' : '#5a5462');
  }

  const PROP = {
    /* ---- 地面のむら ---- */
    patch: function (g, x, y, z, o, night) {
      const R = (14 + o.s * 30) * z;
      g.fillStyle = night ? 'rgba(0,0,0,.10)' : 'rgba(0,0,0,.07)';
      g.beginPath(); g.ellipse(x, y, R, R * 0.66, o.s * 3, 0, TAU); g.fill();
    },

    /* ---- 針葉樹 ---- */
    pine: function (g, x, y, z, o, night) {
      const H = (17 + o.s * 19) * z, W = H * 0.50;
      foot(g, x, y, 3.2 + o.s * 2, z);
      g.fillStyle = '#2e1d10';
      g.fillRect(x - 1.3 * z, y - H * 0.20, 2.6 * z, H * 0.20);
      const dk = night ? '#0d2416' : '#1f4a24', lt = night ? '#153a1e' : '#2f6b2e';
      const snowy = S.spec.surface === 'snow';
      for (let k = 0; k < 3; k++) {
        const t = 1 - k * 0.27, base = y - H * (0.16 + k * 0.27), ww = W * t;
        g.fillStyle = dk;
        g.beginPath();
        g.moveTo(x, base - H * 0.44 * t); g.lineTo(x - ww / 2, base); g.lineTo(x + ww / 2, base);
        g.closePath(); g.fill();
        g.fillStyle = lt;
        g.beginPath();
        g.moveTo(x, base - H * 0.40 * t); g.lineTo(x - ww * 0.30, base - H * 0.03);
        g.lineTo(x + ww * 0.14, base - H * 0.03); g.closePath(); g.fill();
        if (snowy) {
          g.fillStyle = night ? 'rgba(160,178,220,.70)' : 'rgba(255,248,230,.86)';
          g.beginPath();
          g.moveTo(x, base - H * 0.44 * t); g.lineTo(x - ww * 0.30, base - H * 0.14);
          g.lineTo(x + ww * 0.30, base - H * 0.14); g.closePath(); g.fill();
        }
      }
    },

    /* ---- 広葉樹 ---- */
    tree: function (g, x, y, z, o, night) {
      const H = (14 + o.s * 14) * z, R = H * 0.42;
      foot(g, x, y, 3.4 + o.s * 2, z);
      g.fillStyle = '#4a3018';
      g.fillRect(x - 1.4 * z, y - H * 0.34, 2.8 * z, H * 0.34);
      g.fillStyle = night ? '#153a1e' : '#2f5c26';
      g.beginPath(); g.ellipse(x, y - H * 0.56, R, R * 0.92, 0, 0, TAU); g.fill();
      g.fillStyle = night ? '#1f4a24' : '#4d8433';
      g.beginPath(); g.ellipse(x - R * 0.22, y - H * 0.66, R * 0.60, R * 0.54, 0, 0, TAU); g.fill();
    },

    /* ---- 糸杉。細く高く、地中海の道の景色をつくる ---- */
    cypress: function (g, x, y, z, o, night) {
      const H = (20 + o.s * 18) * z, W = H * 0.20;
      foot(g, x, y, 2.4, z);
      g.fillStyle = night ? '#102c18' : '#1f4a24';
      g.beginPath();
      g.moveTo(x, y - H); g.lineTo(x - W, y - H * 0.10);
      g.lineTo(x + W, y - H * 0.10); g.closePath(); g.fill();
      g.fillStyle = night ? '#173a1e' : '#2f5c26';
      g.beginPath();
      g.moveTo(x - W * 0.15, y - H * 0.94); g.lineTo(x - W * 0.75, y - H * 0.12);
      g.lineTo(x, y - H * 0.12); g.closePath(); g.fill();
    },

    /* ---- オリーヴ。低く、ねじれて、銀色がかる ---- */
    olive: function (g, x, y, z, o, night) {
      const H = (11 + o.s * 8) * z, R = H * 0.60;
      foot(g, x, y, 3.6, z);
      g.fillStyle = '#4a3018';
      g.fillRect(x - 1.6 * z, y - H * 0.40, 3.2 * z, H * 0.40);
      g.fillStyle = night ? '#25402a' : '#4a6b42';
      g.beginPath(); g.ellipse(x, y - H * 0.62, R, R * 0.70, 0, 0, TAU); g.fill();
      g.fillStyle = night ? '#35543a' : '#6f8d5e';
      g.beginPath(); g.ellipse(x - R * 0.26, y - H * 0.74, R * 0.52, R * 0.40, 0, 0, TAU); g.fill();
    },

    /* ---- アカシア。乾いた大地は、傘のかたちの木がぽつぽつ立つ ---- */
    acacia: function (g, x, y, z, o, night) {
      const H = (13 + o.s * 11) * z, R = H * 0.86;
      foot(g, x, y, 3.8, z);
      g.strokeStyle = '#4a3018'; g.lineWidth = 2.6 * z; g.lineCap = 'round';
      const lean = (o.s - 0.5) * 5 * z;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + lean, y - H * 0.58); g.stroke();
      g.lineWidth = 1.3 * z;
      g.beginPath();
      g.moveTo(x + lean * 0.7, y - H * 0.42);
      g.lineTo(x + lean - H * 0.22, y - H * 0.60);
      g.moveTo(x + lean * 0.7, y - H * 0.46);
      g.lineTo(x + lean + H * 0.22, y - H * 0.60);
      g.stroke();
      g.fillStyle = night ? '#25402a' : '#4a6b42';
      g.beginPath(); g.ellipse(x + lean, y - H * 0.64, R * 0.54, R * 0.19, 0, 0, TAU); g.fill();
      g.fillStyle = night ? '#35543a' : '#6f8d5e';
      g.beginPath(); g.ellipse(x + lean - R * 0.10, y - H * 0.70, R * 0.38, R * 0.12, 0, 0, TAU); g.fill();
    },

    /* ---- 低木・草 ---- */
    scrub: function (g, x, y, z, o, night) {
      const R = (4 + o.s * 5) * z;
      g.fillStyle = night ? '#3a3a24' : '#6e5a3c';
      g.beginPath(); g.ellipse(x, y - R * 0.4, R, R * 0.66, 0, 0, TAU); g.fill();
      g.fillStyle = night ? '#4a4a2e' : '#9a8358';
      g.beginPath(); g.ellipse(x - R * 0.2, y - R * 0.6, R * 0.5, R * 0.36, 0, 0, TAU); g.fill();
    },
    tuft: function (g, x, y, z, o, night) {
      const H = (4 + o.s * 4) * z;
      g.strokeStyle = night ? '#1f4a24' : '#4d8433';
      g.lineWidth = 1.1 * z;
      g.beginPath();
      for (let k = -2; k <= 2; k++) {
        g.moveTo(x + k * 1.1 * z, y);
        g.lineTo(x + k * 2.1 * z, y - H * (1 - Math.abs(k) * 0.16));
      }
      g.stroke();
    },
    tuftdry: function (g, x, y, z, o, night) {
      const H = (4 + o.s * 4) * z;
      g.strokeStyle = night ? '#6e5a3c' : '#c2ab7c';
      g.lineWidth = 1.1 * z;
      g.beginPath();
      for (let k = -2; k <= 2; k++) {
        g.moveTo(x + k * 1.1 * z, y);
        g.lineTo(x + k * 2.3 * z, y - H * (1 - Math.abs(k) * 0.2));
      }
      g.stroke();
    },
    fern: function (g, x, y, z, o, night) {
      const R = (4 + o.s * 3) * z;
      g.fillStyle = night ? '#153a1e' : '#2f5c26';
      g.beginPath(); g.ellipse(x, y - R * 0.5, R, R * 0.8, 0, 0, TAU); g.fill();
      g.fillStyle = night ? '#1f4a24' : '#4d8433';
      g.beginPath(); g.ellipse(x - R * 0.25, y - R * 0.75, R * 0.5, R * 0.45, 0, 0, TAU); g.fill();
    },
    fir: function (g, x, y, z, o, night) {
      PROP.pine(g, x, y, z * 0.62, o, night);
    },

    /* ---- 岩 ---- */
    rock: function (g, x, y, z, o, night) {
      const R = (5 + o.s * 9) * z;
      foot(g, x, y, R / z * 0.5, z);
      g.fillStyle = rockC(night, false);
      g.beginPath();
      g.moveTo(x - R, y); g.lineTo(x - R * 0.7, y - R * 0.9);
      g.lineTo(x + R * 0.2, y - R * 1.05); g.lineTo(x + R, y - R * 0.5);
      g.lineTo(x + R * 0.8, y); g.closePath(); g.fill();
      g.fillStyle = rockC(night, true);
      g.beginPath();
      g.moveTo(x - R * 0.6, y - R * 0.78); g.lineTo(x + R * 0.15, y - R * 0.92);
      g.lineTo(x + R * 0.3, y - R * 0.55); g.lineTo(x - R * 0.4, y - R * 0.5);
      g.closePath(); g.fill();
    },
    stone: function (g, x, y, z, o, night) {
      const R = (2.4 + o.s * 3.2) * z;
      g.fillStyle = rockC(night, false);
      g.beginPath(); g.ellipse(x, y - R * 0.4, R, R * 0.68, 0, 0, TAU); g.fill();
      g.fillStyle = rockC(night, true);
      g.beginPath(); g.ellipse(x - R * 0.2, y - R * 0.6, R * 0.5, R * 0.34, 0, 0, TAU); g.fill();
    },

    /* ---- 雪の壁。路肩に積み上がっているほど、はみ出せない ---- */
    bank: function (g, x, y, z, o, night) {
      const H = (5 + o.s * 6) * z;
      g.fillStyle = night ? '#6d7aa8' : '#fff8e6';
      g.fillRect(x - 5 * z, y - H, 10 * z, H);
      g.fillStyle = night ? '#445078' : '#c9c0cf';
      g.fillRect(x - 5 * z, y - 1.5 * z, 10 * z, 1.5 * z);
    },
    pole: function (g, x, y, z, o, night) {
      const H = 13 * z;
      g.fillStyle = night ? '#8e9ac4' : '#3a3648';
      g.fillRect(x - 0.8 * z, y - H, 1.6 * z, H);
      g.fillStyle = '#e0602c';
      g.fillRect(x - 1.2 * z, y - H, 2.4 * z, H * 0.26);
    },

    /* ---- 標識・ポール ---- */
    post: function (g, x, y, z, o, night) {
      const H = 9 * z;
      foot(g, x, y, 1.6, z);
      g.fillStyle = '#fff8e6'; g.fillRect(x - 0.9 * z, y - H, 1.8 * z, H);
      g.fillStyle = '#c23a2e'; g.fillRect(x - 0.9 * z, y - H, 1.8 * z, H * 0.3);
    },
    warn: function (g, x, y, z, o, night) {
      const H = 12 * z, W = 6 * z;
      foot(g, x, y, 1.8, z);
      g.fillStyle = '#5a5462'; g.fillRect(x - 0.7 * z, y - H, 1.4 * z, H);
      g.fillStyle = '#e0ae3c';
      g.beginPath();
      g.moveTo(x, y - H - W * 0.5); g.lineTo(x - W * 0.55, y - H + W * 0.28);
      g.lineTo(x + W * 0.55, y - H + W * 0.28); g.closePath(); g.fill();
      g.fillStyle = '#12101a';
      g.fillRect(x - 0.5 * z, y - H - W * 0.12, 1 * z, W * 0.22);
    },
    jumpsign: function (g, x, y, z, o, night) {
      const H = 12 * z, W = 6 * z;
      foot(g, x, y, 1.8, z);
      g.fillStyle = '#5a5462'; g.fillRect(x - 0.7 * z, y - H, 1.4 * z, H);
      g.fillStyle = '#fff8e6';
      g.fillRect(x - W * 0.5, y - H - W * 0.5, W, W * 0.72);
      g.strokeStyle = '#12101a'; g.lineWidth = 1.1 * z;
      g.beginPath();
      g.moveTo(x - W * 0.34, y - H - W * 0.02);
      g.quadraticCurveTo(x, y - H - W * 0.62, x + W * 0.34, y - H - W * 0.02);
      g.stroke();
    },
    hay: function (g, x, y, z, o, night) {
      const W = 8 * z, H = 6 * z;
      foot(g, x, y, 4, z);
      g.fillStyle = night ? '#6e5a3c' : '#c2ab7c';
      g.fillRect(x - W / 2, y - H, W, H);
      g.fillStyle = night ? '#4a3c28' : '#9a8358';
      g.fillRect(x - W / 2, y - H * 0.34, W, H * 0.34);
      g.strokeStyle = 'rgba(46,29,16,.35)'; g.lineWidth = 0.9 * z;
      g.beginPath(); g.moveTo(x - W * 0.2, y - H); g.lineTo(x - W * 0.2, y); g.stroke();
    },

    /* ---- 石垣・ガードレール ---- */
    wall: function (g, x, y, z, o, night) {
      const H = (5 + o.s * 2.5) * z;
      g.fillStyle = night ? '#3a3648' : '#8d8798';
      g.fillRect(x - 5 * z, y - H, 10 * z, H);
      g.fillStyle = night ? '#2a2733' : '#6b6474';
      g.fillRect(x - 5 * z, y - H * 0.34, 10 * z, H * 0.34);
      g.fillStyle = night ? '#4a4658' : '#a8a2b2';
      g.fillRect(x - 5 * z, y - H, 10 * z, 1.2 * z);
    },
    guard: function (g, x, y, z, o, night) {
      const H = 7 * z;
      g.fillStyle = night ? '#3a3648' : '#5a5462';
      g.fillRect(x - 0.9 * z, y - H, 1.8 * z, H);
      g.fillStyle = night ? '#4e4858' : '#9d95a8';
      g.fillRect(x - 5.5 * z, y - H, 11 * z, 2.4 * z);
      g.fillStyle = night ? '#4a4658' : '#8d8798';
      g.fillRect(x - 5.5 * z, y - H + 1.6 * z, 11 * z, 0.9 * z);
    },

    /* ---- ギャラリーの車 ---- */
    parked: function (g, x, y, z, o, night) {
      const W = 9 * z, H = 6 * z;
      foot(g, x, y, 5, z);
      g.fillStyle = GP.gfx.shade(o.c || '#5a5462', -0.35);
      g.fillRect(x - W / 2, y - H, W, H);
      g.fillStyle = o.c || '#5a5462';
      g.fillRect(x - W / 2 + 0.8 * z, y - H + 0.8 * z, W - 1.6 * z, H - 1.6 * z);
      g.fillStyle = '#15161b';
      g.fillRect(x - W * 0.26, y - H * 0.86, W * 0.52, H * 0.34);
    },

    /* ---- 人 ----
       ラリーで沿道に人がいるのは、そこが見どころだという印。
       腕を上げているのと、旗を振っているのを混ぜる          */
    fan: function (g, x, y, z, o, night) {
      const H = (9 + o.s * 2.5) * z;
      foot(g, x, y, 2.2, z);
      const c = o.c || '#c23a2e';
      g.fillStyle = '#2a2430';
      g.fillRect(x - 2.0 * z, y - H * 0.36, 1.6 * z, H * 0.36);
      g.fillRect(x + 0.4 * z, y - H * 0.36, 1.6 * z, H * 0.36);
      g.fillStyle = c;
      g.fillRect(x - 2.2 * z, y - H * 0.80, 4.4 * z, H * 0.48);
      g.fillStyle = GP.gfx.pal.skin[2 + (o.s > 0.5 ? 1 : 0)];
      g.fillRect(x - 1.5 * z, y - H, 3.0 * z, H * 0.22);
      g.fillStyle = GP.gfx.shade(c, -0.3);
      g.fillRect(x - 1.7 * z, y - H - 0.6 * z, 3.4 * z, 1.4 * z);
      if (o.s > 0.66) {
        // 旗
        g.fillStyle = '#6b4724';
        g.fillRect(x + 2.0 * z, y - H * 1.45, 0.9 * z, H * 0.78);
        g.fillStyle = o.c2 || '#e0ae3c';
        g.fillRect(x + 2.7 * z, y - H * 1.45, 5.2 * z, 3.2 * z);
      } else if (o.s > 0.34) {
        // 両手を上げている
        g.fillStyle = GP.gfx.pal.skin[3];
        g.fillRect(x - 3.2 * z, y - H * 1.02, 1.1 * z, H * 0.30);
        g.fillRect(x + 2.1 * z, y - H * 1.02, 1.1 * z, H * 0.30);
      }
    },

    /* ---- 道をまたぐ横断幕 ---- */
    arch: function (g, x, y, z, o, night) {
      g.save();
      g.translate(x, y);
      g.rotate(o.a + CAM.t + Math.PI / 2);
      const W = 34 * z, H = 15 * z;
      g.fillStyle = '#4a3018';
      g.fillRect(-W / 2, -H, 2.6 * z, H);
      g.fillRect(W / 2 - 2.6 * z, -H, 2.6 * z, H);
      g.fillStyle = o.s ? '#2d6b32' : '#c23a2e';
      g.fillRect(-W / 2, -H, W, 6.4 * z);
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.fillRect(-W / 2, -H, W, 1.8 * z);
      g.fillStyle = '#fff8e6';
      g.font = 'bold ' + (4.4 * z).toFixed(1) + 'px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(o.c || '', 0, -H + 3.4 * z);
      g.textBaseline = 'alphabetic';
      g.restore();
    }
  };

  /* ---------- 画面に重ねるもの ---------- */
  function overlay(g, f) {
    const km = (S.spec.km * f);
    const t = S.t;
    // 上の帯
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(18,16,26,.72)';
    g.fillRect(0, 0, VW, 26);
    g.font = 'bold 13px sans-serif';
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

  return { start, stop, skip, setRate, dbg: () => S };
})();

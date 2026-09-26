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
    return { x: x, y: y, drv: drv, slip: slip, lat: lat, ang: ang, curv: dks };
  }

  /* ハンドルの切れ角。曲がりの向きに切って、流れたぶんだけ戻す。
     前は「逆ハンドル」だけを描いていて、右の曲がりでハンドルが
     左を向いていた。走っている本人には正しくても、外から見れば
     「車と反対を向いている」としか読めない。
     まず曲がる側へ切る。そのうえで、流れているぶんだけ戻す       */
  function steerOf(L, i) {
    return clamp(L.curv[i] * 3.6 - L.slip[i] * 0.95, -0.62, 0.62);
  }
  function steerOfC(c) {
    return clamp(c.curv * 3.6 - c.slip * 0.95, -0.62, 0.62);
  }
  /* いまの位置。道の点は 1 秒に 10 個ほど進むので、点ごとに置くと
     車がカクカク進む。次の点との間を、時間で埋める                */
  function cur() {
    const L = S.line, i = S.i, N = S.road.n;
    const j = Math.min(N - 1, i + 1);
    const t0 = S.time[i], t1 = S.time[j];
    const fr = (j > i && t1 > t0) ? clamp((S.t - t0) / (t1 - t0), 0, 1) : 0;
    const lerp = (a, b) => a + (b - a) * fr;
    return {
      i: i, fr: fr,
      x: lerp(L.x[i], L.x[j]), y: lerp(L.y[i], L.y[j]),
      drv: L.drv[i] + wrap(L.drv[j] - L.drv[i]) * fr,
      slip: lerp(L.slip[i], L.slip[j]), curv: lerp(L.curv[i], L.curv[j]),
      dist: lerp(S.road.cum[i], S.road.cum[j])
    };
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
          if (q < 0.20) add(near, i, d + 4, side, 'fir', r());
          else if (q < 0.30) add(near, i, d, side, 'stone', r());
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
      mprev: [null, null],
      pre: 0,               // 走り出すまでの数え（実時間・秒）
      go: 0,                // GO! の残り
      split: null,          // 出ているスプリットの札
      splitN: 0,            // 何本目まで出したか
      fin: 0,               // ゴールしてから結果へ行くまでの余韻
      outAt: null           // 止まってから結果へ行くまで
    };
    rate = spec.rate || 12;
    /* 飛ばしているときは待たせない。じっくりのときだけ、数えてから出る */
    S.pre = rate <= 20 ? 3.5 : rate <= 45 ? 1.6 : 0;
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
    if (!S || S.done) return;
    S.t = S.time[S.road.n - 1];
    S.i = S.road.n - 1;
    S.pre = 0; S.outAt = null;
    finish();
    S.fin = 0.9;
  }

  function finish() {
    if (!S || S.done) return;
    S.done = true;
    S.fin = (S.inc && S.inc.out) ? 1.6 : 1.7;
    if (!(S.inc && S.inc.out)) GP.sound.play('confirm');
  }
  function leave() {
    stop();
    if (onEnd) { const f = onEnd; onEnd = null; f(); }
  }

  /* ---------- 毎フレーム ---------- */
  function tick(ts) {
    if (!S) return;
    const dt = Math.min(0.15, (ts - lastTs) / 1000);
    lastTs = ts;
    S.dt = dt;
    const N = S.road.n;

    // ゴールしたあとの余韻。板を出してから結果へ
    if (S.done) {
      S.fin -= dt;
      try { draw(S.road.cum[S.i] / Math.max(1, S.road.len)); } catch (e) {}
      if (S.fin <= 0) { leave(); return; }
      raf = requestAnimationFrame(tick); return;
    }
    // 止まってしまったあと。少し見せてから
    if (S.outAt != null) {
      S.outAt -= dt;
      try { draw(S.road.cum[S.i] / Math.max(1, S.road.len)); } catch (e) {}
      if (S.outAt <= 0) { S.outAt = null; finish(); return; }
      raf = requestAnimationFrame(tick); return;
    }
    // 走り出す前の数え。実時間で数える
    if (S.pre > 0) {
      const before = Math.ceil(S.pre);
      S.pre -= dt;
      const after = Math.ceil(S.pre);
      if (after < before && after > 0) GP.sound.play('light');
      if (S.pre <= 0) {
        S.pre = 0; S.go = 1.0; GP.sound.play('go');
        // 出だしの土煙。後輪が空転する
        const c0 = cur();
        for (let k = 0; k < 5; k++) pushDust([c0.x, c0.y], c0.drv, 0.25 * (k % 2 ? 1 : -1), 1);
      }
      try { draw(0); } catch (e) {}
      raf = requestAnimationFrame(tick); return;
    }
    if (S.go > 0) S.go -= dt;
    if (S.split) { S.split.left -= dt; if (S.split.left <= 0) S.split = null; }

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
      if (m.out) { paintLog(); S.outAt = 1.0; GP.sound.play('dnf'); break; }
      paintLog();
    }
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 3);
    // スプリット。道の 1/3 と 2/3 で、いまの差を札にする
    if (S.spec.leadTime && S.splitN < 2 && f >= (S.splitN + 1) / 3) {
      S.splitN++;
      S.split = { n: S.splitN, d: S.t - S.spec.leadTime * f, left: 2.6 };
      GP.sound.play('tap');
    }

    // 轍と土煙。横を向いているぶんだけ、派手になる
    if (S.holdUntil <= 0 && S.i > 0) {
      const c = cur();
      const sl = c.slip, head = c.drv + sl;
      pushMark([c.x, c.y], head, sl);
      pushDust([c.x, c.y], head, sl, S.road.keep[S.i]);
    }

    /* 一枚の絵で転んでも、走りは止めない。
       止まると「次のSSから動かない」に見えるのが、いちばん困る  */
    try { draw(f); } catch (e) {
      if (!S.drawErr) { S.drawErr = true; try { console.error('rallyview draw', e); } catch (e2) {} }
    }
    if (S.i >= N - 1) finish();
    raf = requestAnimationFrame(tick);
  }

  /* =========================================================
     絵
     ======================================================= */

  /* カメラ。道ばたのものは「立って」見えてほしいので、
     地面に寝ているもの（道・轍・土煙）だけを回した座標で描き、
     立っているものは、いったん画面の座標に落としてから描く    */
  const CAM = { mode: 'top', px: 0, py: 0, t: 0, ct: 1, st: 0, ox: 0, oy: 0,
                a: 0, fc: 1, fs: 0, h: 20, ay: 0.5 };

  /* ---------- 見かた ----------
     同じ走りを、3つの高さから見る。

       鳥瞰     … 道の形と、次に来る曲がりが読める。
                  ただし「速い」とは感じない
       オンボード … 車の後ろ。自分の車が横を向いているのが、外から見える
       車内     … フロントガラス越し。次に何が来るかは、
                  右席の読み上げでしか分からない

     ラリーで人が見ているのは、たいてい真ん中のやつで、
     ラリーで走っている人が見ているのは、いちばん下のやつ       */
  const VIEWS = ['top', 'chase', 'cab'];
  const HORIZON = VH * 0.355;
  function OB_H() { return HORIZON; }
  const FOCAL = 330;
  const BACK = { chase: 62, cab: 6 };      // 車からどれだけ後ろに目を置くか
  const HIGH = { chase: 28, cab: 18 };     // 目の高さ
  /* 道ばたのものは、鳥瞰で見て気持ちのいい大きさに描いてある。
     奥行きのある絵にそのまま置くと、草が人の背丈になる      */
  const PROPK = 0.60;
  let view = 'top';

  function setView(v) {
    if (VIEWS.indexOf(v) < 0) return;
    view = v;
    if (S) { S.dust.length = 0; S.cam = null; }
  }
  function getView() { return view; }

  /* 画面の座標へ落とす。戻り値は [x, y, 倍率]。
     手前すぎる・後ろすぎるものは null                        */
  function project(wx, wy) {
    const dx = wx - CAM.px, dy = wy - CAM.py;
    if (CAM.mode === 'top') {
      return [VW / 2 + CAM.ox + (dx * CAM.ct - dy * CAM.st) * ZOOM,
              VH * CAM.ay + CAM.oy + (dx * CAM.st + dy * CAM.ct) * ZOOM, ZOOM];
    }
    const fz = dx * CAM.fc + dy * CAM.fs;
    if (fz < 7) return null;
    const fx = -dx * CAM.fs + dy * CAM.fc;
    const sc = FOCAL / fz;
    return [VW / 2 + CAM.ox + fx * sc, HORIZON + CAM.oy + CAM.h * sc, sc, fz];
  }
  function camera(g) {
    g.translate(VW / 2 + CAM.ox, VH * CAM.ay + CAM.oy);
    g.scale(ZOOM, ZOOM);
    g.rotate(CAM.t);
    g.translate(-CAM.px, -CAM.py);
  }

  /* 道の左右の縁を、画面の座標で返す */
  function edgeAt(road, k, half) {
    const a = normAt(road, k);
    const nx = -Math.sin(a), ny = Math.cos(a);
    const px = road.pts[k][0], py = road.pts[k][1];
    const l = project(px - nx * half, py - ny * half);
    const r = project(px + nx * half, py + ny * half);
    if (!l || !r) return null;
    return [l, r];
  }

  function draw(f) {
    const road = S.road, L = S.line, i = S.i;
    S.f = f;
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
    setCam(L, i, inc);
    if (view === 'top') drawTop(g, L, i, sf, night, inc);
    else drawPersp(g, L, i, sf, night, inc);
    overlay(g, f);

    if (dusk) {
      GP.fx.composite(out, {
        dof: 0.25, focus: { x: VW * PX / 2, y: VH * PX * 0.70 }, focusR: VW * PX * 0.42,
        bloom: night ? 1.2 : 0.8, warm: 0.95, vignette: 0.9, night: night
      });
    }
  }

  /* ---------- カメラを置く ---------- */
  function setCam(L, i, inc) {
    const c = cur();
    const sl = c.slip;
    const dt = S.dt || 0.016;
    CAM.mode = (view === 'top') ? 'top' : 'persp';
    CAM.ox = S.shake > 0 ? (Math.random() - 0.5) * 7 * S.shake : 0;
    CAM.oy = S.shake > 0 ? (Math.random() - 0.5) * 7 * S.shake : 0;
    if (view === 'top') {
      /* 地図は回さない。回すと道の形が読めなくなり、
         「いまどこを走っているか」が分からなくなる。
         動くのは車のほうで、地図は北を上に置いたまま。
         目は車の少し先に置き、これから走る道が多めに見えるようにする */
      /* 目は少し遅れて追いかける。だから曲がると車のほうが画面の中で動く */
      const ahead = 34;
      const tx = c.x + Math.cos(c.drv) * ahead, ty = c.y + Math.sin(c.drv) * ahead;
      if (!S.cam) S.cam = { x: tx, y: ty, a: c.drv };
      const k = 1 - Math.exp(-dt * 3.2);
      S.cam.x += (tx - S.cam.x) * k; S.cam.y += (ty - S.cam.y) * k;
      CAM.px = S.cam.x; CAM.py = S.cam.y;
      CAM.t = 0; CAM.ct = 1; CAM.st = 0;
      CAM.ay = 0.5;
      return;
    }
    CAM.ay = EYE;
    /* 後ろから見るときは、進んでいる向きに構える。
       だから車が流れると、車だけが横を向いて見える。
       車内から見るときは、鼻の向いている先を見ている。
       だから車が流れると、道のほうが斜めから飛んでくる        */
    const want = (view === 'cab') ? c.drv + sl * 0.82 : c.drv + sl * 0.16;
    /* 後ろから見る目は、向きの変わりに少し遅れる。
       だから曲がりの入りで、車が画面の中で外へ振れる          */
    if (!S.cam) S.cam = { x: c.x, y: c.y, a: want };
    if (S.cam.a == null) S.cam.a = want;
    const ka = 1 - Math.exp(-dt * (view === 'cab' ? 14 : 5.5));
    S.cam.a += wrap(want - S.cam.a) * ka;
    const a = S.cam.a;
    CAM.a = a;
    CAM.fc = Math.cos(a); CAM.fs = Math.sin(a);
    CAM.h = HIGH[view] || 26;
    const back = BACK[view] || 40;
    let px = c.x - Math.cos(a) * back;
    let py = c.y - Math.sin(a) * back;
    if (inc && inc.lat) {
      const sg = sl >= 0 ? -1 : 1;
      px += -Math.sin(a) * inc.lat * sg;
      py += Math.cos(a) * inc.lat * sg;
    }
    CAM.px = px; CAM.py = py;
    if (view === 'cab' && inc) CAM.oy += inc.rot * 3;
  }

  /* =========================================================
     鳥瞰
     ======================================================= */
  function drawTop(g, L, i, sf, night, inc) {
    const road = S.road;
    // 地面。一色だと「止まっている面」に見えるので、目を入れる
    g.fillStyle = groundOf(S.props.flavor, night);
    g.fillRect(0, 0, VW, VH);
    g.fillStyle = 'rgba(0,0,0,.07)';
    const ox = ((CAM.px * ZOOM) % 16 + 16) % 16, oy = ((CAM.py * ZOOM) % 16 + 16) % 16;
    for (let y = -16; y < VH + 16; y += 8) {
      for (let x = ((y / 8) % 2 ? -16 : -8); x < VW + 16; x += 16) {
        g.fillRect(x - ox, y - oy, 4, 4);
      }
    }
    /* 車が真ん中にいるので、前も後ろも同じだけ見える */
    const lo = Math.max(0, i - 95), hi = Math.min(road.n - 1, i + 95);
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
  }

  /* =========================================================
     オンボードと車内

     奥から手前へ、道を台形でつないでいく。
     遠いものから描くので、折り返してきた道が
     手前の道を隠してしまうことがない。
     ======================================================= */
  const FAR_K = 150;

  function drawPersp(g, L, i, sf, night, inc) {
    const road = S.road;
    sky(g, night);
    const lo = Math.max(0, i - 6), hi = Math.min(road.n - 1, i + FAR_K);
    drawPropsP(g, S.props.far, lo, hi, night);
    drawRoadP(g, road, lo, hi, night);
    drawMarksP(g);
    drawPropsP(g, S.props.near, lo, hi, night);
    drawDustP(g);
    drawPropsP(g, S.props.over, lo, hi, night);
    if (view === 'chase') drawCarBack(g, L, i, inc);
    else cabin(g, L, i, night);
  }

  /* ---------- 空と、地平線の向こう ----------
     土地柄で空の色が変わり、太陽は世界の決まった向きにある。
     車が向きを変えると、山なみと木立が横へ流れる。
     遠いものほどゆっくり動く。それだけで、奥行きが出る          */
  const SCENE = {
    forest: { top: '#5f86c4', bot: '#c6d3e2', far: '#4d6a86', hill: '#2f5a3c', tree: '#1f4426', haze: '198,211,226', sun: '#fff3c4', kind: 'pine' },
    alp:    { top: '#5b82c2', bot: '#cad6e6', far: '#6f7f9a', hill: '#3a5d44', tree: '#244a2c', haze: '202,214,230', sun: '#fff3c4', kind: 'pine', cap: true },
    med:    { top: '#6e93c9', bot: '#e0d6c2', far: '#8c7f6c', hill: '#5d6a3b', tree: '#3f5a2c', haze: '224,214,194', sun: '#fff0b0', kind: 'round' },
    dry:    { top: '#7a86a8', bot: '#d6c49a', far: '#a08660', hill: '#7a6a48', tree: '#5c5230', haze: '214,196,154', sun: '#ffd48a', kind: 'flat' },
    snow:   { top: '#8ea0c8', bot: '#dfe4f2', far: '#b8c4dc', hill: '#9aa6c4', tree: '#3a5a4a', haze: '223,228,242', sun: '#fff8e6', kind: 'pine', cap: true }
  };
  const SUN_DIR = 0.9;                       // 太陽のある向き（世界の角）
  function hsh(n) {
    let h = Math.imul(n | 0, 2654435761) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  function sky(g, night) {
    const fl = S.props.flavor;
    const sc = SCENE[fl] || SCENE.forest;
    const wet = !!S.spec.wet;
    const head = CAM.a;
    const top = night ? '#0f1430' : wet ? '#7d8797' : sc.top;
    const bot = night ? '#26304d' : wet ? '#b7bdc6' : sc.bot;
    const gr = g.createLinearGradient(0, 0, 0, HORIZON);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    g.fillStyle = gr; g.fillRect(0, 0, VW, HORIZON + 1);

    // 星。夜だけ。向きを変えると空も回る
    if (night) {
      g.fillStyle = 'rgba(255,248,230,.8)';
      for (let k = 0; k < 70; k++) {
        const sx = ((hsh(k * 7 + 1) * VW * 2.4 - head * 300) % (VW * 2.4) + VW * 2.4) % (VW * 2.4) - VW * 0.7;
        if (sx < -2 || sx > VW + 2) continue;
        const sy = hsh(k * 7 + 3) * HORIZON * 0.8;
        const tw = 0.5 + hsh(k * 7 + 5) * 0.9 * (0.6 + 0.4 * Math.sin(S.t * 3 + k));
        g.fillRect(sx, sy, tw, tw);
      }
    }

    // 太陽か月。世界の決まった向きにあるので、車が向きを変えると動く
    {
      const rel = wrap(SUN_DIR - head);
      if (Math.abs(rel) < 1.3) {
        const sx = VW / 2 + rel * 300, sy = HORIZON * (night ? 0.30 : fl === 'dry' ? 0.52 : 0.42);
        if (night) {
          g.fillStyle = '#e8e6d8';
          g.beginPath(); g.arc(sx, sy, 11, 0, TAU); g.fill();
          g.fillStyle = top;
          g.beginPath(); g.arc(sx + 5, sy - 3, 9.5, 0, TAU); g.fill();
        } else if (!wet) {
          const glow = g.createRadialGradient(sx, sy, 4, sx, sy, fl === 'dry' ? 90 : 60);
          glow.addColorStop(0, 'rgba(255,244,200,.55)'); glow.addColorStop(1, 'rgba(255,244,200,0)');
          g.fillStyle = glow; g.fillRect(sx - 100, sy - 100, 200, 200);
          g.fillStyle = sc.sun;
          g.beginPath(); g.arc(sx, sy, fl === 'dry' ? 15 : 11, 0, TAU); g.fill();
        }
      }
    }

    // 雲。ゆっくり流れ、向きを変えると横へ動く
    {
      const n = wet ? 9 : night ? 3 : 6;
      g.fillStyle = night ? 'rgba(60,70,110,.55)' : wet ? 'rgba(150,158,170,.85)' : 'rgba(255,255,255,.82)';
      for (let k = 0; k < n; k++) {
        const per = VW * 2.6;
        let cx = (hsh(k * 11 + 2) * per + S.t * (2 + hsh(k * 11 + 4) * 3) - head * 90) % per;
        if (cx < 0) cx += per;
        cx -= VW * 0.8;
        if (cx < -90 || cx > VW + 90) continue;
        const cy = HORIZON * (0.16 + hsh(k * 11 + 6) * 0.42);
        const w = 26 + hsh(k * 11 + 8) * 40;
        g.beginPath();
        g.ellipse(cx, cy, w, w * 0.30, 0, 0, TAU);
        g.ellipse(cx - w * 0.4, cy + 2, w * 0.55, w * 0.24, 0, 0, TAU);
        g.ellipse(cx + w * 0.35, cy + 1, w * 0.6, w * 0.27, 0, 0, TAU);
        g.fill();
      }
    }

    // 遠い山。二層。奥はゆっくり、手前は少し速く流れる
    const layer = (col, amp, base, k1, k2, shift, cap) => {
      const path = () => {
        g.beginPath(); g.moveTo(0, HORIZON + 1);
        for (let x = 0; x <= VW; x += 10) {
          const u = x + shift;
          const h = base + Math.sin(u * k1 + 1.2) * amp + Math.sin(u * k2) * amp * 0.9 + Math.sin(u * k1 * 3.1) * amp * 0.25;
          g.lineTo(x, HORIZON - Math.max(0, h));
        }
        g.lineTo(VW, HORIZON + 1); g.closePath();
      };
      if (cap) {
        path(); g.fillStyle = night ? '#4a5470' : '#e9eef8'; g.fill();
        // 雪は峰にだけ残る。低いところは岩
        g.beginPath(); g.moveTo(0, HORIZON + 1);
        for (let x = 0; x <= VW; x += 10) {
          const u = x + shift;
          const h = base + Math.sin(u * k1 + 1.2) * amp + Math.sin(u * k2) * amp * 0.9 + Math.sin(u * k1 * 3.1) * amp * 0.25;
          g.lineTo(x, HORIZON - Math.max(0, Math.min(h, base * 0.9 + (h - base * 0.9) * 0.35)));
        }
        g.lineTo(VW, HORIZON + 1); g.closePath(); g.fillStyle = col; g.fill();
      } else { path(); g.fillStyle = col; g.fill(); }
    };
    const farC = night ? '#1b2340' : wet ? '#6f7a8a' : sc.far;
    const hillC = night ? '#141c34' : wet ? '#4b5a4a' : sc.hill;
    layer(farC, 13, 26, 0.021, 0.0093, head * 70, !!sc.cap);
    layer(hillC, 7, 11, 0.037, 0.016, head * 150, false);

    // 地平の木立。近いので、いちばん速く流れる
    {
      const treeC = night ? '#0e1526' : wet ? '#2c3a2c' : sc.tree;
      g.fillStyle = treeC;
      const step = sc.kind === 'flat' ? 13 : 7;
      const shift = head * 240;
      for (let x = -20; x <= VW + 20; x += step) {
        const idx = Math.floor((x + shift) / step);
        const r = hsh(idx);
        if (sc.kind === 'flat' && r > 0.45) continue;
        const sx = x - ((shift % step) + step) % step;
        const hh = (sc.kind === 'pine' ? 5 : 4) + r * (sc.kind === 'pine' ? 9 : 6);
        const w = sc.kind === 'pine' ? 3 + r * 3 : 5 + r * 5;
        g.beginPath();
        if (sc.kind === 'pine') {
          g.moveTo(sx - w, HORIZON + 1); g.lineTo(sx, HORIZON - hh); g.lineTo(sx + w, HORIZON + 1);
        } else if (sc.kind === 'flat') {
          g.rect(sx - 0.8, HORIZON - hh * 0.7, 1.6, hh);
          g.ellipse(sx, HORIZON - hh * 0.75, w, hh * 0.32, 0, 0, TAU);
        } else {
          g.ellipse(sx, HORIZON - hh * 0.55, w * 0.8, hh * 0.6, 0, 0, TAU);
        }
        g.closePath(); g.fill();
      }
    }

    // 地面
    g.fillStyle = groundOf(S.props.flavor, night);
    g.fillRect(0, HORIZON, VW, VH - HORIZON);
    // 遠くの地面は空気に溶ける（遠くほど白く霞む）
    {
      const hz = g.createLinearGradient(0, HORIZON, 0, HORIZON + 80);
      hz.addColorStop(0, 'rgba(' + (night ? '38,48,77' : sc.haze) + ',' + (night ? '.55' : wet ? '.72' : '.60') + ')');
      hz.addColorStop(1, 'rgba(' + (night ? '38,48,77' : sc.haze) + ',0)');
      g.fillStyle = hz; g.fillRect(0, HORIZON, VW, 80);
    }
    /* 地面にも目を入れる。無地だと、どれだけ飛ばしても動いて見えない。
       遠いほど細かく、手前ほど粗く                              */
    const off = (S.road.cum[S.i] * 0.5) % 40;
    g.fillStyle = 'rgba(0,0,0,.09)';
    for (let k = 1; k < 26; k++) {
      const fz = 24 + k * k * 2.6 + off;
      const sc2 = FOCAL / fz;
      const y = HORIZON + CAM.h * sc2;
      if (y > VH) break;
      g.fillRect(0, y, VW, Math.max(0.6, sc2 * 0.9));
    }
  }

  function drawRoadP(g, road, lo, hi, night) {
    const surface = S.spec.surface;
    const verge = 21.5, shoulder = 14.5, half = 11;
    const cVerge = surface === 'snow' ? (night ? '#2c3357' : '#8e9ac4')
                 : surface === 'tarmac' ? (night ? '#152e1c' : '#2f5c26')
                 : (night ? '#241708' : '#6b4724');
    const cShoulder = surface === 'snow' ? (night ? '#445078' : '#b5aabb')
                 : surface === 'tarmac' ? (night ? '#12101a' : '#23222c')
                 : (night ? '#12101a' : '#2e1d10');
    const cRoad = roadColor(surface, night);
    /* 台形をつなぐと、辺のところに髪の毛ほどの隙間が出る。
       同じ色で縁をなぞって埋める                            */
    const quad = (A, B, col) => {
      g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(A[0][0], A[0][1]); g.lineTo(A[1][0], A[1][1]);
      g.lineTo(B[1][0], B[1][1]); g.lineTo(B[0][0], B[0][1]);
      g.closePath(); g.fill(); g.stroke();
    };
    /* 奥から手前へ。近いものが後から乗るので、
       ヘアピンで折り返してきた道も正しく重なる                */
    for (let k = hi; k > lo; k--) {
      const av = edgeAt(road, k, verge), bv = edgeAt(road, k - 1, verge);
      if (!av || !bv) continue;
      quad(av, bv, cVerge);
      const as = edgeAt(road, k, shoulder), bs = edgeAt(road, k - 1, shoulder);
      if (as && bs) quad(as, bs, cShoulder);
      const ar = edgeAt(road, k, half), br = edgeAt(road, k - 1, half);
      if (!ar || !br) continue;
      quad(ar, br, cRoad);
      // 路面の目。1点おきに、濃淡の帯を置く
      if (k % 2 === 0) {
        quad(ar, br, surface === 'tarmac' ? 'rgba(255,255,255,.028)' : 'rgba(0,0,0,.055)');
      }
      // わだち
      const aw = edgeAt(road, k, 2.2), bw = edgeAt(road, k - 1, 2.2);
      if (aw && bw) quad(aw, bw, surface === 'tarmac' ? 'rgba(0,0,0,.07)' : 'rgba(0,0,0,.13)');
      // ターマックの外側線
      if (surface === 'tarmac') {
        [-1, 1].forEach(sg => {
          const a2 = edgeAt(road, k, half - 1.6), b2 = edgeAt(road, k - 1, half - 1.6);
          if (!a2 || !b2) return;
          const j = sg > 0 ? 1 : 0;
          g.strokeStyle = night ? 'rgba(255,248,230,.18)' : 'rgba(255,248,230,.40)';
          g.lineWidth = Math.max(0.6, (a2[j][2] + b2[j][2]) * 0.7);
          g.beginPath(); g.moveTo(a2[j][0], a2[j][1]); g.lineTo(b2[j][0], b2[j][1]); g.stroke();
        });
      }
    }
    // ゴールの市松
    if (hi >= road.n - 2) {
      const e = edgeAt(road, road.n - 2, half);
      const e2 = edgeAt(road, road.n - 4, half);
      if (e && e2) {
        for (let c = 0; c < 8; c++) {
          const t0 = c / 8, t1 = (c + 1) / 8;
          const p0 = [e[0][0] + (e[1][0] - e[0][0]) * t0, e[0][1] + (e[1][1] - e[0][1]) * t0];
          const p1 = [e[0][0] + (e[1][0] - e[0][0]) * t1, e[0][1] + (e[1][1] - e[0][1]) * t1];
          const q0 = [e2[0][0] + (e2[1][0] - e2[0][0]) * t0, e2[0][1] + (e2[1][1] - e2[0][1]) * t0];
          const q1 = [e2[0][0] + (e2[1][0] - e2[0][0]) * t1, e2[0][1] + (e2[1][1] - e2[0][1]) * t1];
          g.fillStyle = (c % 2) ? '#fff8e6' : '#12101a';
          g.beginPath();
          g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]);
          g.lineTo(q1[0], q1[1]); g.lineTo(q0[0], q0[1]);
          g.closePath(); g.fill();
        }
      }
    }
  }

  function drawMarksP(g) {
    if (!S.marks.length) return;
    const surface = S.spec.surface;
    const col = surface === 'tarmac' ? '14,12,18' : surface === 'snow' ? '108,122,168' : '46,29,16';
    g.lineCap = 'round';
    for (let k = Math.max(0, S.marks.length - 260); k < S.marks.length; k++) {
      const m = S.marks[k];
      const a = project(m.x0, m.y0), b2 = project(m.x1, m.y1);
      if (!a || !b2) continue;
      g.strokeStyle = 'rgba(' + col + ',' + (0.30 + m.a * 0.28).toFixed(2) + ')';
      g.lineWidth = Math.max(0.6, (a[2] + b2[2]) * 1.5);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b2[0], b2[1]); g.stroke();
    }
  }

  function drawDustP(g) {
    const surface = S.spec.surface;
    const col = surface === 'snow' ? '232,223,210'
              : surface === 'tarmac' ? '120,110,100' : '150,104,58';
    for (let k = 0; k < S.dust.length; k++) {
      const d = S.dust[k];
      d.x += d.vx; d.y += d.vy; d.r += 0.26; d.a -= 0.040;
      d.vx *= 0.96; d.vy *= 0.96;
      if (d.a <= 0) continue;
      const q = project(d.x, d.y);
      if (!q || q[3] < 26) continue;      // カメラの鼻先の土埃は、ただの染みになる
      /* 土埃は地面より上に立ち上がる。目の高さより上へ持ち上げる */
      const rr = d.r * q[2] * PROPK * 0.8;
      if (rr < 0.5 || rr > 90) continue;
      g.fillStyle = 'rgba(' + col + ',' + (d.a * (surface === 'snow' ? 0.26 : 0.34)).toFixed(2) + ')';
      g.beginPath(); g.arc(q[0], q[1] - rr * 0.55, rr, 0, TAU); g.fill();
    }
    S.dust = S.dust.filter(d => d.a > 0);
  }

  /* 奥のものから描く。手前のものが、あとから上に乗る */
  function drawPropsP(g, arr, lo, hi, night) {
    let k = lowerBound(arr, hi);
    if (k >= arr.length) k = arr.length - 1;
    for (; k >= 0; k--) {
      const o = arr[k];
      if (o.i > hi) continue;
      if (o.i < lo) break;
      const q = project(o.x, o.y);
      if (!q) continue;
      if (q[2] > 8 || q[2] < 0.08) continue;
      const z = q[2] * PROPK;
      if (q[0] < -180 * z || q[0] > VW + 180 * z) continue;
      if (q[1] < HORIZON - 4 || q[1] > VH + 200) continue;
      const fn = PROP[o.t];
      if (fn) fn(g, q[0], q[1], z, o, night);
    }
  }

  /* ---------- 後ろから見た自車 ----------
     流れているぶんだけ、横っ腹が見えてくる。
     真後ろから見ているのに車の側面が見える、というのが
     「流れている」ということの、いちばん分かりやすい形。
     車輪は車体の外に出ていて、荒れた道では車体だけが上下する。
     減速でブレーキ灯が点き、走るほど泥が乗る                 */
  function braking(i) {
    const kp = S.road.keep;
    const j = Math.min(S.road.n - 1, i + 3);
    return kp[j] < kp[i] - 0.012 || (S.inc && S.holdUntil > 0);
  }
  function drawCarBack(g, L, i, inc) {
    const c = cur();
    const q = project(c.x, c.y);
    if (!q) return;
    /* 道の幅は 22。車は 16 くらい。それより大きく描くと道からはみ出す */
    const z = q[2] * 0.46;
    const sl = c.slip + (inc ? inc.rot : 0);
    const col = S.spec.color || '#c23a2e';
    const night = !!S.spec.night;
    const surface = S.spec.surface;
    const x = q[0], y = q[1];
    const sn = Math.sin(sl), cs = Math.abs(Math.cos(sl));
    const bw = 34 * z * cs + 6 * z;             // 後ろ姿の幅
    const side = 44 * z * sn;                   // 横っ腹の見えかた（符号つき）
    const rough = surface === 'tarmac' ? 0.35 : 1;
    const brake = braking(i);
    /* サスの動き。荒れた道で車体が上下し、減速で尻が持ち上がる。
       走り出す前はアイドリングで小さく震える                   */
    const bob = (Math.sin(S.t * 9.3) * 1.3 + Math.sin(S.t * 17.7) * 0.7) * z * rough * 0.6
              + (S.shake > 0 ? (Math.random() - 0.5) * 3 * z * S.shake : 0)
              + (S.pre > 0 ? (Math.random() - 0.5) * 0.7 * z : 0)
              - (brake ? 1.1 * z : 0);
    const dark = GP.gfx.shade(col, -0.34), darker = GP.gfx.shade(col, -0.50), lit = GP.gfx.shade(col, 0.14);
    const ink = '#12101a';
    const phase = (c.dist * 0.035) % 1;

    g.save();
    // 前照灯。夜は道の先が明るい。車より先に描く
    if (night) {
      const ax = c.x + Math.cos(c.drv + sl) * 34, ay = c.y + Math.sin(c.drv + sl) * 34;
      const q2 = project(ax, ay);
      if (q2) {
        const R = 44 * q2[2];
        const lg = g.createRadialGradient(q2[0], q2[1], 2, q2[0], q2[1], R);
        lg.addColorStop(0, 'rgba(255,240,190,.42)'); lg.addColorStop(1, 'rgba(255,240,190,0)');
        g.fillStyle = lg;
        g.beginPath(); g.ellipse(q2[0], q2[1], R, R * 0.45, 0, 0, TAU); g.fill();
      }
    }
    // 影。流れている側へ伸びる
    g.fillStyle = 'rgba(0,0,0,.34)';
    g.beginPath(); g.ellipse(x + side * 0.3, y + 0.5 * z, bw * 0.62 + Math.abs(side) * 0.5, 3.2 * z, 0, 0, TAU); g.fill();

    // 車輪。転がる目が、下から上へ流れる
    const tire = (wx, wy, k, steer) => {
      const w = 5.5 * z * k, h = 9 * z * k;
      g.fillStyle = ink;
      g.fillRect(wx - w / 2, wy - h, w, h);
      g.fillStyle = 'rgba(255,255,255,.13)';
      const band = ((phase + (wx > x ? 0.5 : 0)) % 1) * h;
      g.fillRect(wx - w / 2, wy - h + band, w, Math.max(1, h * 0.16));
      g.fillStyle = '#3a3846';
      g.fillRect(wx - w * 0.22, wy - h * 0.66, w * 0.44, h * 0.34);
    };
    // 横っ腹（流れている側と反対に見える）
    const edge = side > 0 ? x + bw / 2 : x - bw / 2;
    const fy = -3 * z * Math.abs(sn);          // 車の先は少し遠いので、少し上
    if (Math.abs(side) > 1.5) {
      // 前輪。横を向いているときだけ見える
      tire(edge + side * 0.82, y + fy, 0.9);
      const by = y + bob;
      g.fillStyle = dark;
      g.beginPath();
      g.moveTo(edge, by - 3 * z); g.lineTo(edge + side, by + fy - 2.6 * z);
      g.lineTo(edge + side, by + fy - 21 * z); g.lineTo(edge, by - 24 * z);
      g.closePath(); g.fill();
      // 横のガラス
      g.fillStyle = '#15161b';
      g.beginPath();
      g.moveTo(edge + side * 0.08, by - 16 * z); g.lineTo(edge + side * 0.88, by + fy - 14.5 * z);
      g.lineTo(edge + side * 0.88, by + fy - 20 * z); g.lineTo(edge + side * 0.08, by - 22.5 * z);
      g.closePath(); g.fill();
      // 腰のライン
      g.fillStyle = 'rgba(255,255,255,.20)';
      g.beginPath();
      g.moveTo(edge, by - 14 * z); g.lineTo(edge + side, by + fy - 12.8 * z);
      g.lineTo(edge + side, by + fy - 11.6 * z); g.lineTo(edge, by - 12.6 * z);
      g.closePath(); g.fill();
      // 下は影
      g.fillStyle = 'rgba(0,0,0,.28)';
      g.beginPath();
      g.moveTo(edge, by - 7 * z); g.lineTo(edge + side, by + fy - 6.5 * z);
      g.lineTo(edge + side, by + fy - 2.6 * z); g.lineTo(edge, by - 3 * z);
      g.closePath(); g.fill();
    }
    // 後輪
    tire(x - bw / 2 - 1.2 * z, y, 1);
    tire(x + bw / 2 + 1.2 * z, y, 1);
    // マッドフラップ
    g.fillStyle = darker;
    g.fillRect(x - bw / 2 - 2 * z, y - 6 * z + bob, 4 * z, 5 * z);
    g.fillRect(x + bw / 2 - 2 * z, y - 6 * z + bob, 4 * z, 5 * z);

    /* ---- 後ろ姿。車体だけが上下し、車輪は道に残る ---- */
    g.translate(0, bob);
    g.translate(x, y); g.rotate(-sl * 0.09); g.translate(-x, -y);
    // バンパー
    g.fillStyle = darker;
    g.fillRect(x - bw / 2, y - 8 * z, bw, 5 * z);
    // 車体
    g.fillStyle = dark;
    g.fillRect(x - bw / 2 - 0.8 * z, y - 17 * z, bw + 1.6 * z, 9.6 * z);
    g.fillStyle = col;
    g.fillRect(x - bw / 2, y - 16.5 * z, bw, 8.5 * z);
    // ナンバー
    g.fillStyle = '#fff8e6';
    g.fillRect(x - 4 * z, y - 12 * z, 8 * z, 3 * z);
    // 尾灯。減速で光る。夜はいつも薄く点く
    const lamp = (lx) => {
      if (brake || night) {
        const gl = g.createRadialGradient(lx, y - 13.5 * z, 1, lx, y - 13.5 * z, (brake ? 10 : 6) * z);
        gl.addColorStop(0, brake ? 'rgba(255,90,60,.55)' : 'rgba(255,90,60,.28)'); gl.addColorStop(1, 'rgba(255,90,60,0)');
        g.fillStyle = gl; g.fillRect(lx - 10 * z, y - 24 * z, 20 * z, 20 * z);
      }
      g.fillStyle = brake ? '#ff6a3c' : night ? '#d84a34' : '#a8342a';
      g.fillRect(lx - 3 * z, y - 15 * z, 6 * z, 3 * z);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(lx - 3 * z, y - 15 * z, 6 * z, 0.8 * z);
    };
    lamp(x - bw / 2 + 4.5 * z); lamp(x + bw / 2 - 4.5 * z);
    // 上半分。窓と屋根
    const gw = bw * 0.84;
    g.fillStyle = dark;
    g.fillRect(x - gw / 2 - 0.8 * z, y - 26 * z, gw + 1.6 * z, 9.5 * z);
    g.fillStyle = '#15161b';
    g.fillRect(x - gw / 2, y - 25 * z, gw, 8 * z);
    g.fillStyle = 'rgba(255,248,230,.16)';
    g.fillRect(x - gw / 2, y - 25 * z, gw, 1.6 * z);
    // 窓の中に、ふたつのヘルメットの後ろ
    g.fillStyle = 'rgba(255,255,255,.10)';
    g.fillRect(x - gw * 0.30, y - 23.5 * z, gw * 0.18, 4.5 * z);
    g.fillRect(x + gw * 0.12, y - 23 * z, gw * 0.18, 4 * z);
    // 屋根。上を向いた面は明るい
    g.fillStyle = lit;
    g.fillRect(x - gw / 2, y - 28 * z, gw, 3 * z);
    g.fillStyle = '#23222c';
    g.fillRect(x - 3 * z, y - 28.4 * z, 6 * z, 1.8 * z);             // 屋根の空気取り
    g.strokeStyle = ink; g.lineWidth = Math.max(0.6, 0.5 * z);
    g.beginPath(); g.moveTo(x - gw * 0.4, y - 28 * z); g.lineTo(x - gw * 0.42, y - 36 * z); g.stroke();   // アンテナ
    // 翼。柱・板・端板
    g.fillStyle = dark;
    g.fillRect(x - bw * 0.30, y - 34 * z, 2 * z, 7 * z);
    g.fillRect(x + bw * 0.30 - 2 * z, y - 34 * z, 2 * z, 7 * z);
    g.fillStyle = '#23222c';
    g.fillRect(x - bw * 0.54, y - 36.5 * z, bw * 1.08, 3 * z);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fillRect(x - bw * 0.54, y - 36.5 * z, bw * 1.08, 0.9 * z);
    g.fillStyle = col;
    g.fillRect(x - bw * 0.54 - 1.2 * z, y - 39 * z, 1.8 * z, 6 * z);
    g.fillRect(x + bw * 0.54 - 0.6 * z, y - 39 * z, 1.8 * z, 6 * z);
    // 泥。走った距離ぶんだけ、下半分に乗る
    if (surface !== 'tarmac' || S.spec.wet) {
      const f = S.f || 0;
      const a = Math.min(0.55, 0.08 + f * 0.62);
      g.fillStyle = surface === 'snow' ? 'rgba(236,240,248,' + a + ')'
                  : S.spec.wet && surface === 'tarmac' ? 'rgba(40,36,44,' + a * 0.7 + ')'
                  : 'rgba(78,52,26,' + a + ')';
      for (let k = 0; k < 9; k++) {
        const hh = (2 + hsh(k * 3 + 11) * 5 + f * 4) * z;
        const sx = x - bw / 2 + (k / 9) * bw;
        g.fillRect(sx, y - 3 * z - hh, bw / 9 + 0.5, hh);
      }
    }
    // 排気。減速で、ときどき火を吹く
    g.fillStyle = ink;
    g.beginPath(); g.arc(x + bw * 0.34, y - 4.5 * z, 1.7 * z, 0, TAU); g.fill();
    if (brake && Math.random() < 0.35 && !night) {
      g.fillStyle = 'rgba(255,170,60,.85)';
      g.beginPath(); g.arc(x + bw * 0.34, y - 4.5 * z, 1.3 * z, 0, TAU); g.fill();
    } else if (brake && night && Math.random() < 0.35) {
      g.fillStyle = 'rgba(255,190,80,.95)';
      g.beginPath(); g.arc(x + bw * 0.34, y - 4.5 * z, 2.2 * z, 0, TAU); g.fill();
    }
    g.restore();
  }

  /* ---------- 車内 ----------
     後席に据えたオンボードカメラの構図。
     ラリーの車内映像といえばこれで、ふたつのヘルメットの向こうに
     道が飛んでくる。見えるのは、いま目の前にある道だけ。
     次に何が来るかは、右席の読み上げでしか分からない。

     ドライバーはハンドルの向きに腕を回し、横Gで外へ振られる。
     右席はノートに目を落とし、読むたびに小さくうなずく。          */
  function cabin(g, L, i, night) {
    const col = S.spec.color || '#c23a2e';
    const c = cur();
    const sl = c.slip;
    const steer = clamp(steerOfC(c) * 1.9, -1.15, 1.15);
    const rough = S.spec.surface === 'tarmac' ? 0.6 : 1.3;
    const bob = Math.sin(S.t * 5.5) * 1.4 * rough + Math.sin(S.t * 13.1) * 0.6 * rough
              + (S.shake > 0 ? (Math.random() - 0.5) * 6 * S.shake : 0);
    const lean = -sl * 15;                         // 横Gで身体が外へ振られる
    const dashY = VH * 0.60 + bob;
    const ink = '#15161b';
    const suit = GP.gfx.shade(col, -0.42);
    const skin = GP.gfx.pal.skin;

    // フロントガラスの枠（屋根とAピラー）
    g.fillStyle = ink;
    g.fillRect(0, 0, VW, VH * 0.085 + bob);
    const pillar = (x0, x1, x2, x3) => {
      g.fillStyle = GP.gfx.shade(col, -0.52);
      g.beginPath();
      g.moveTo(x0, VH * 0.05 + bob); g.lineTo(x1, VH * 0.05 + bob);
      g.lineTo(x3, dashY + 10); g.lineTo(x2, dashY + 10);
      g.closePath(); g.fill();
    };
    pillar(-40, 44, 6, -60);
    pillar(VW - 44, VW + 40, VW + 60, VW - 6);
    // ロールケージ。窓の内側を縦に2本、上を1本
    g.fillStyle = '#5a5462';
    g.fillRect(50, VH * 0.085 + bob, 8, dashY - VH * 0.085 + 10);
    g.fillRect(VW - 58, VH * 0.085 + bob, 8, dashY - VH * 0.085 + 10);
    g.fillRect(0, VH * 0.085 + bob, VW, 6);
    // 雨。ガラスに粒が付いて、下へ流れる
    const wet = !!S.spec.wet;
    const wipe = wet ? Math.abs(Math.sin(S.t * 2.4)) : 0;      // ワイパーの振り（0..1）
    if (wet) {
      const top = VH * 0.085 + bob, hgt = dashY - top;
      g.fillStyle = 'rgba(220,232,250,.34)';
      for (let k = 0; k < 46; k++) {
        const px = hsh(k * 9 + 1) * VW;
        const py = top + ((hsh(k * 9 + 2) * hgt + performance.now() * 0.001 * (12 + hsh(k * 9 + 3) * 30)) % hgt);
        const r = 1 + hsh(k * 9 + 4) * 1.8;
        g.beginPath(); g.ellipse(px, py, r, r * 1.6, 0, 0, TAU); g.fill();
      }
    }
    // ワイパー。雨なら振る。晴れなら窓の下端に寝ている
    g.strokeStyle = 'rgba(18,16,26,.72)'; g.lineWidth = 2.6; g.lineCap = 'round';
    [[VW * 0.24, -0.30], [VW * 0.58, -0.30]].forEach(w => {
      const ang = w[1] - wipe * 1.35;                       // 寝た位置から左へ振る
      g.beginPath();
      g.moveTo(w[0], dashY - 3);
      g.lineTo(w[0] + Math.cos(ang) * 60, dashY - 3 + Math.sin(ang) * 60);
      g.stroke();
    });

    if (night) {
      // 前照灯。まず道の先を暖かく照らし、そのまわりを落とす
      const lt = g.createRadialGradient(VW / 2, dashY - 10, 10, VW / 2, dashY - 10, VW * 0.30);
      lt.addColorStop(0, 'rgba(255,236,170,.22)');
      lt.addColorStop(1, 'rgba(255,236,170,0)');
      g.fillStyle = lt; g.fillRect(0, OB_H(), VW, dashY - OB_H());
      // 前照灯の届く範囲。外は、ほんとうに何も見えない
      const gl = g.createRadialGradient(VW / 2, dashY, 20, VW / 2, dashY, VW * 0.62);
      gl.addColorStop(0, 'rgba(0,0,0,0)');
      gl.addColorStop(0.55, 'rgba(0,0,0,.18)');
      gl.addColorStop(1, 'rgba(0,0,0,.72)');
      g.fillStyle = gl; g.fillRect(0, 0, VW, dashY);
    }

    // ダッシュボード。薄い帯。手前の人に隠れる
    g.fillStyle = '#23222c';
    g.fillRect(0, dashY, VW, VH - dashY);
    g.fillStyle = '#33313e';
    g.fillRect(0, dashY, VW, 3);
    // 計器と切り替え。ふたつの席のあいだに置く
    const gx = VW * 0.47, gy = dashY + 22;
    g.fillStyle = '#12101a';
    g.beginPath(); g.arc(gx, gy, 14, 0, TAU); g.fill();
    g.strokeStyle = '#8d8798'; g.lineWidth = 1.3;
    g.beginPath(); g.arc(gx, gy, 11.5, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
    const rev = 0.26 + S.road.keep[i] * 0.66;
    g.strokeStyle = rev > 0.82 ? '#e2664a' : '#e0ae3c'; g.lineWidth = 2.8;
    g.beginPath();
    g.arc(gx, gy, 9, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * rev); g.stroke();
    g.font = 'bold 9px sans-serif'; g.textAlign = 'center';
    g.fillStyle = '#fff0b0';
    g.fillText(Math.round(S.spec.km / Math.max(1, S.spec.timeS) * 3600 * (0.45 + rev * 0.75)), gx, gy + 3);
    g.textAlign = 'left';
    g.fillStyle = '#15161b';
    g.fillRect(VW * 0.51, dashY + 10, 46, 18);
    g.fillStyle = '#2d6b32'; g.fillRect(VW * 0.51 + 3, dashY + 13, 18, 5);
    g.fillStyle = '#e0ae3c'; g.fillRect(VW * 0.51 + 24, dashY + 13, 18, 5);
    g.fillStyle = '#5a5462';
    for (let k = 0; k < 4; k++) g.fillRect(VW * 0.51 + 4 + k * 11, dashY + 21, 7, 4);
    // ルームミラー
    g.fillStyle = ink;
    g.fillRect(VW * 0.44, VH * 0.085 + bob + 6, 70, 16);
    g.fillStyle = night ? '#1a1b33' : '#6d7aa8';
    g.fillRect(VW * 0.44 + 3, VH * 0.085 + bob + 9, 64, 10);

    /* ---- ハンドル。ドライバーの頭の向こうに、上半分だけ見える ---- */
    const WX = VW * 0.31 + lean * 0.35, WY = dashY + 34;
    const WR = 36;
    g.save();
    g.translate(WX, WY);
    g.rotate(steer);
    g.strokeStyle = ink; g.lineWidth = 7;
    g.beginPath(); g.arc(0, 0, WR, 0, TAU); g.stroke();
    g.strokeStyle = '#2a2430'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(-WR, 0); g.lineTo(WR, 0); g.moveTo(0, 0); g.lineTo(0, WR); g.stroke();
    g.fillStyle = col; g.fillRect(-9, -4, 18, 8);
    g.fillStyle = '#fff8e6'; g.fillRect(-2, -WR - 3, 4, 6);
    g.restore();

    /* ---- ドライバー ----
       頭は左の席。横Gで外へ振られ、荒れた路面で上下する      */
    const DX = VW * 0.31 + lean, DY = VH * 0.815 + bob * 0.8;
    const DR = 34;
    // 腕。肩からハンドルの縁まで。縁の位置はハンドルと一緒に回る
    const grip = (ang) => [WX + Math.cos(ang + steer) * (WR - 1), WY + Math.sin(ang + steer) * (WR - 1)];
    const lh = grip(Math.PI + 0.32), rh = grip(-0.32);
    g.strokeStyle = suit; g.lineWidth = 13; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(DX - 30, DY + 16); g.lineTo(DX - 34, DY - 4); g.lineTo(lh[0], lh[1]);
    g.moveTo(DX + 30, DY + 16); g.lineTo(DX + 34, DY - 4); g.lineTo(rh[0], rh[1]);
    g.stroke();
    // 手（グローブ）
    g.fillStyle = GP.gfx.shade(col, -0.20);
    g.beginPath(); g.arc(lh[0], lh[1], 6.5, 0, TAU); g.fill();
    g.beginPath(); g.arc(rh[0], rh[1], 6.5, 0, TAU); g.fill();
    helmetBack(g, DX, DY, DR, col, 0);

    /* ---- 右席。ノートに目を落として、読むたびに小さくうなずく ---- */
    const nod = Math.max(0, Math.sin(S.t * 2.6)) * 4;
    const CX = VW * 0.70 + lean * 0.9, CY = VH * 0.835 + bob * 0.8 + nod;
    const CR = 32;
    // ノートを持つ手と、ノート
    g.save();
    g.translate(VW * 0.60 + lean * 0.7, VH * 0.70 + bob * 0.6 + nod * 0.5);
    g.rotate(-0.18);
    g.fillStyle = '#4a3018'; g.fillRect(-3, -3, 64, 46);
    g.fillStyle = '#e6d6ae'; g.fillRect(0, 0, 58, 40);
    g.fillStyle = 'rgba(0,0,0,.34)';
    for (let k = 0; k < 5; k++) g.fillRect(5, 6 + k * 7, 46 - (k % 2) * 16, 2);
    const cur = Math.min(4, Math.floor(S.said % 5));
    g.fillStyle = '#c23a2e'; g.fillRect(5, 5 + cur * 7, 3, 4);
    g.restore();
    g.fillStyle = skin[3];
    g.beginPath(); g.arc(VW * 0.575 + lean * 0.7, VH * 0.80 + bob * 0.6, 7, 0, TAU); g.fill();
    g.strokeStyle = suit; g.lineWidth = 12;
    g.beginPath();
    g.moveTo(CX - 28, CY + 18); g.lineTo(VW * 0.585 + lean * 0.7, VH * 0.80 + bob * 0.6);
    g.stroke();
    helmetBack(g, CX, CY, CR, col, 0.10);

    /* ---- 席の背もたれ。カメラはこれの後ろにあるので、頭の下を隠す ---- */
    const seat = (x, y, w) => {
      g.fillStyle = '#1d1a26';
      g.beginPath();
      g.moveTo(x - w, VH + 10); g.lineTo(x - w + 4, y);
      g.quadraticCurveTo(x, y - 10, x + w - 4, y);
      g.lineTo(x + w, VH + 10); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.06)';
      g.fillRect(x - w + 10, y + 6, w * 2 - 20, 3);
      // ベルトの通し口
      g.fillStyle = col;
      g.fillRect(x - 14, y + 10, 8, 14); g.fillRect(x + 6, y + 10, 8, 14);
    };
    seat(DX, DY + DR * 0.55, 62);
    seat(CX, CY + CR * 0.55, 58);
  }

  /* 後ろから見たヘルメット。丸い殻に、上の光と、背中側の帯。
     襟元のHANSと無線の線が、それを「人」にする                 */
  function helmetBack(g, x, y, r, col, tilt) {
    g.save();
    g.translate(x, y);
    g.rotate(tilt);
    // 首と襟
    g.fillStyle = '#2a2430';
    g.fillRect(-r * 0.42, r * 0.55, r * 0.84, r * 0.6);
    g.fillStyle = GP.gfx.shade(col, -0.42);
    g.fillRect(-r * 0.75, r * 0.72, r * 1.5, r * 0.5);
    // 殻
    g.fillStyle = GP.gfx.shade(col, -0.30);
    g.beginPath(); g.arc(0, 0, r + 1.5, 0, TAU); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.beginPath(); g.arc(-r * 0.15, -r * 0.28, r * 0.62, 0, TAU); g.fill();
    // ストライプ。上から後頭部へ一本
    g.fillStyle = '#fff8e6';
    g.fillRect(-r * 0.11, -r, r * 0.22, r * 1.55);
    // 後頭部の空気抜きと、無線の線
    g.fillStyle = '#12101a';
    g.fillRect(-r * 0.36, -r * 0.42, r * 0.72, r * 0.09);
    g.fillRect(-r * 0.30, -r * 0.20, r * 0.60, r * 0.09);
    g.strokeStyle = '#12101a'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(r * 0.55, r * 0.6); g.quadraticCurveTo(r * 0.9, r * 1.1, r * 0.7, r * 1.5); g.stroke();
    g.restore();
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
    const from = Math.max(0, i - 95), to = Math.min(road.n - 1, i + 95);
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
    const c = cur();
    const slip = c.slip + (inc ? inc.rot : 0);
    const drv = c.drv;
    let px = c.x, py = c.y;
    if (inc && inc.lat) {
      px += -Math.sin(drv) * inc.lat * (c.slip >= 0 ? -1 : 1);
      py += Math.cos(drv) * inc.lat * (c.slip >= 0 ? -1 : 1);
    }
    g.save();
    g.translate(px, py);
    g.rotate(drv + slip + Math.PI / 2);
    const col = S.spec.color || '#c23a2e';
    const dark = GP.gfx.shade(col, -0.34), lit = GP.gfx.shade(col, 0.16);
    const sl = c.slip;
    const phase = (c.dist * 0.035) % 1;
    const brake = braking(i);
    const surface = S.spec.surface;
    // 影。流れている側へずれる
    g.fillStyle = 'rgba(0,0,0,.34)';
    g.beginPath(); g.ellipse(sl * 5, 3, 10, 6, 0, 0, TAU); g.fill();
    // 前照灯の光（夜）。車体より先に、道に落とす
    if (S.spec.night) {
      const steer0 = steerOfC(c);
      g.save(); g.rotate(steer0 * 0.5);
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
    // タイヤ。車体の外に出ている。後ろは車体なり、前はハンドルなり
    const steer = steerOfC(c);
    wheel(g, -8.5, 7.2, 0, phase); wheel(g, 8.5, 7.2, 0, phase);
    wheel(g, -8.5, -6.5, steer, phase); wheel(g, 8.5, -6.5, steer, phase);
    // マッドフラップ
    g.fillStyle = GP.gfx.shade(col, -0.5);
    g.fillRect(-10, 10, 4, 1.6); g.fillRect(6, 10, 4, 1.6);
    /* 車体。横Gで、車輪の上を少しだけ外へ寄る（ロール） */
    g.save();
    g.translate(-sl * 1.6, 0);
    g.fillStyle = dark;
    g.fillRect(-8, -12.5, 16, 25);
    g.fillStyle = col;
    g.fillRect(-7, -11.5, 14, 23);
    // ボンネット（前）は明るく、後ろ（トランク）は少し暗い
    g.fillStyle = lit;
    g.fillRect(-7, -11.5, 14, 5);
    g.fillStyle = GP.gfx.shade(col, -0.16);
    g.fillRect(-7, 6.5, 14, 5);
    // 前照灯
    g.fillStyle = S.spec.night ? '#fff6c8' : '#e8e2c8';
    g.fillRect(-6.5, -12, 3, 1.6); g.fillRect(3.5, -12, 3, 1.6);
    // フロントガラスと屋根、リアガラス
    g.fillStyle = '#15161b';
    g.fillRect(-5.5, -6.5, 11, 4);
    g.fillStyle = 'rgba(255,248,230,.18)';
    g.fillRect(-5.5, -6.5, 11, 1.2);
    g.fillStyle = GP.gfx.shade(col, 0.06);
    g.fillRect(-5.5, -2.5, 11, 6);
    g.fillStyle = '#15161b';
    g.fillRect(-5, 3.5, 10, 2.6);
    // 屋根の空気取りと番号板
    g.fillStyle = '#23222c';
    g.fillRect(-1.5, -2.2, 3, 1.4);
    g.fillStyle = '#fff8e6';
    g.fillRect(-2.5, 0, 5, 3);
    // 腰の帯（ラリーカーらしい一本）
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.fillRect(-7, -7.5, 1.4, 19); g.fillRect(5.6, -7.5, 1.4, 19);
    // 尾灯。減速で明るく、夜は薄く
    g.fillStyle = brake ? '#ff6a3c' : S.spec.night ? '#d84a34' : '#a8342a';
    g.fillRect(-6.5, 10.4, 3, 1.4); g.fillRect(3.5, 10.4, 3, 1.4);
    if (brake) {
      const gl2 = g.createRadialGradient(0, 12, 1, 0, 12, 9);
      gl2.addColorStop(0, 'rgba(255,90,60,.45)'); gl2.addColorStop(1, 'rgba(255,90,60,0)');
      g.fillStyle = gl2; g.fillRect(-10, 8, 20, 10);
    }
    // 翼。車体より広く、いちばん上に載る
    g.fillStyle = '#23222c';
    g.fillRect(-9, 8.5, 18, 2.2);
    g.fillStyle = col;
    g.fillRect(-9.5, 7.6, 1.6, 4); g.fillRect(7.9, 7.6, 1.6, 4);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fillRect(-9, 8.5, 18, 0.7);
    // 泥。走った距離ぶんだけ、車体の後ろ半分に乗る
    if (surface !== 'tarmac' || S.spec.wet) {
      const f = S.f || 0;
      const a = Math.min(0.5, 0.05 + f * 0.55);
      g.fillStyle = surface === 'snow' ? 'rgba(236,240,248,' + a + ')' : 'rgba(78,52,26,' + a + ')';
      for (let k = 0; k < 6; k++) {
        const hh = 1 + hsh(k * 5 + 21) * 3 + f * 3;
        g.fillRect(-7 + k * 2.33, 11.5 - hh, 2.4, hh);
      }
    }
    g.restore();
    g.restore();
  }
  function wheel(g, x, y, a, phase) {
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#12101a'; g.fillRect(-2, -3.3, 4, 6.6);
    // 転がる目。走った距離で流れる
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.fillRect(-2, -3.3 + ((phase || 0) % 1) * 5.6, 4, 1);
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
      if (CAM.mode !== 'top') return;        // 奥行きのある絵では、帯のほうが効く
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
      foot(g, x, y, 5, z);
      g.fillStyle = night ? '#445078' : '#c9c0cf';
      g.fillRect(x - 5.4 * z, y - H * 0.42, 10.8 * z, H * 0.42);
      g.fillStyle = night ? '#6d7aa8' : '#fff8e6';
      g.beginPath();
      g.moveTo(x - 5.4 * z, y - H * 0.40); g.lineTo(x - 4.2 * z, y - H);
      g.lineTo(x + 4.2 * z, y - H); g.lineTo(x + 5.4 * z, y - H * 0.40);
      g.closePath(); g.fill();
      g.fillStyle = night ? '#8ea0c8' : '#ffffff';
      g.fillRect(x - 4.2 * z, y - H, 8.4 * z, 1.2 * z);
    },
    pole: function (g, x, y, z, o, night) {
      const H = 13 * z;
      foot(g, x, y, 1.4, z);
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
      foot(g, x, y, 5, z);
      g.fillStyle = night ? '#3a3648' : '#8d8798';
      g.fillRect(x - 5 * z, y - H, 10 * z, H);
      g.fillStyle = night ? '#2a2733' : '#6b6474';
      g.fillRect(x - 5 * z, y - H * 0.34, 10 * z, H * 0.34);
      g.fillStyle = night ? '#4a4658' : '#a8a2b2';
      g.fillRect(x - 5 * z, y - H, 10 * z, 1.2 * z);
    },
    guard: function (g, x, y, z, o, night) {
      const H = 7 * z;
      foot(g, x, y, 2.4, z);
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
      /* 鳥瞰では道に対して直角に架ける。
         奥行きのある絵では、もう画面と平行に見えている */
      if (CAM.mode === 'top') g.rotate(o.a + CAM.t + Math.PI / 2);
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
    // 速さ。車内では計器が言うので出さない
    if (view !== 'cab') {
      g.font = 'bold 15px sans-serif'; g.textAlign = 'right';
      g.fillStyle = 'rgba(18,16,26,.62)';
      g.fillRect(VW - 78, VH - 28, 70, 22);
      g.fillStyle = '#fff8e6';
      g.fillText(speedNow() + '', VW - 30, VH - 11);
      g.font = 'bold 9px sans-serif'; g.fillStyle = '#b5aabb';
      g.fillText('km/h', VW - 12, VH - 11);
    }
    // 雨。外から見ているときは、画面に筋が走る
    if (S.spec.wet && view !== 'cab') rain(g);
    // スプリットの札
    if (S.split) {
      const sp = S.split, good = sp.d <= 0;
      const a = Math.min(1, sp.left / 0.4);
      g.globalAlpha = a;
      const w = 150, x0 = VW / 2 - w / 2, y0 = 64;
      g.fillStyle = 'rgba(18,16,26,.84)'; g.fillRect(x0, y0, w, 30);
      g.fillStyle = good ? '#5fbf62' : '#e2664a'; g.fillRect(x0, y0, 5, 30);
      g.font = 'bold 10px sans-serif'; g.textAlign = 'left'; g.fillStyle = '#b5aabb';
      g.fillText('スプリット ' + sp.n, x0 + 12, y0 + 12);
      g.font = 'bold 16px sans-serif'; g.fillStyle = good ? '#9be08a' : '#ffb09a';
      g.fillText((sp.d >= 0 ? '+' : '−') + Math.abs(sp.d).toFixed(1), x0 + 12, y0 + 27);
      g.font = 'bold 9px sans-serif'; g.textAlign = 'right'; g.fillStyle = '#b5aabb';
      g.fillText(good ? 'ベストより速い' : 'ベストより遅い', x0 + w - 8, y0 + 27);
      g.globalAlpha = 1;
    }
    // 走り出す前の数え
    if (S.pre > 0 || S.go > 0) {
      const n = Math.ceil(S.pre);
      const txt = S.pre > 0 ? String(n) : 'GO!';
      const frac = S.pre > 0 ? (S.pre - Math.floor(S.pre)) : S.go;
      const k = S.pre > 0 ? 1 + (1 - frac) * 0.25 : 1 + clamp(1 - S.go, 0, 1) * 0.4;
      g.save();
      g.translate(VW / 2, VH * 0.46);
      g.scale(k, k);
      g.globalAlpha = S.pre > 0 ? 0.95 : Math.min(1, S.go * 2);
      g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 8; g.strokeStyle = '#12101a'; g.strokeText(txt, 0, 0);
      g.fillStyle = S.pre > 0 ? '#ffd98a' : '#9be08a'; g.fillText(txt, 0, 0);
      g.restore();
      g.textBaseline = 'alphabetic';
      if (S.pre > 0) {
        const cap = S.spec.km.toFixed(1) + ' km　' + (S.spec.watch ? '' : 'スタート待ち');
        g.font = 'bold 11px sans-serif'; g.textAlign = 'center';
        const cw = g.measureText(cap).width + 20;
        g.fillStyle = 'rgba(18,16,26,.72)';
        g.fillRect(VW / 2 - cw / 2, VH * 0.46 - 58, cw, 20);
        g.fillStyle = '#fff8e6';
        g.fillText(cap, VW / 2, VH * 0.46 - 44);
      }
    }
    // ゴールの板
    if (S.done && S.fin > 0) {
      const out = !!(S.inc && S.inc.out);
      const a = Math.min(1, (1.7 - S.fin) / 0.25);
      g.globalAlpha = a;
      g.fillStyle = 'rgba(18,16,26,.80)';
      g.fillRect(VW / 2 - 130, VH * 0.34, 260, 84);
      g.fillStyle = out ? '#e2664a' : '#e0ae3c';
      g.fillRect(VW / 2 - 130, VH * 0.34, 260, 5);
      g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
      g.fillStyle = '#fff8e6';
      g.fillText(out ? 'リタイア' : 'FINISH', VW / 2, VH * 0.34 + 38);
      g.font = 'bold 15px sans-serif'; g.fillStyle = '#ffd98a';
      if (out) {
        const m = S.logs[0];
        g.fillText(m ? (m.icon + ' ' + m.name) : '', VW / 2, VH * 0.34 + 64);
      } else {
        const d = S.t - S.spec.leadTime;
        g.fillText(fmt(S.t) + (S.spec.leadTime ? '　' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) : ''), VW / 2, VH * 0.34 + 64);
      }
      g.globalAlpha = 1;
    }
    // 見物しているとき。自分の車でないことは、はっきり言う
    if (S.spec.watch) {
      g.font = 'bold 11px sans-serif'; g.textAlign = 'center';
      const tw = g.measureText(S.spec.watch).width + 18;
      g.fillStyle = 'rgba(18,16,26,.78)';
      g.fillRect(VW / 2 - tw / 2, VH - 24, tw, 18);
      g.fillStyle = '#ffd98a';
      g.fillText(S.spec.watch, VW / 2, VH - 11);
    }
    // 進み具合の帯
    g.fillStyle = 'rgba(255,248,230,.20)'; g.fillRect(0, 26, VW, 3);
    g.fillStyle = '#e0ae3c'; g.fillRect(0, 26, VW * f, 3);
  }

  /* いまの速さ。区間の平均に、道の速さの形を掛ける */
  function speedNow() {
    const i = S.i;
    const rev = 0.26 + S.road.keep[i] * 0.66;
    return Math.round(S.spec.km / Math.max(1, S.spec.timeS) * 3600 * (0.45 + rev * 0.75));
  }
  /* 雨の筋。走っている向きに流れる */
  function rain(g) {
    g.strokeStyle = 'rgba(210,225,245,.28)'; g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k < 42; k++) {
      const spd = 260 + hsh(k * 5 + 2) * 200;
      const x = (hsh(k * 5 + 1) * (VW + 60) + S.t * rate * 0.03 * spd * 0.05) % (VW + 60) - 30;
      const y = (hsh(k * 5 + 3) * (VH + 40) + performance.now() * 0.001 * spd) % (VH + 40) - 20;
      const len = 8 + hsh(k * 5 + 4) * 10;
      g.moveTo(x, y); g.lineTo(x - len * 0.25, y + len);
    }
    g.stroke();
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

  return { start, stop, skip, setRate, setView, getView, dbg: () => S };
})();

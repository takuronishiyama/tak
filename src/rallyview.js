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
  const BACK = { chase: 100, cab: 6 };     // 車からどれだけ後ろに目を置くか
  const HIGH = { chase: 40, cab: 18 };     // 目の高さ
  /* 道ばたのものは、鳥瞰で見て気持ちのいい大きさに描いてある。
     奥行きのある絵にそのまま置くと、草が人の背丈になる      */
  const PROPK = 0.60;
  let view = 'top';

  function setView(v) {
    if (VIEWS.indexOf(v) < 0) return;
    view = v;
    if (S) { S.dust.length = 0; }
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
    const sl = L.slip[i];
    CAM.mode = (view === 'top') ? 'top' : 'persp';
    CAM.ox = S.shake > 0 ? (Math.random() - 0.5) * 7 * S.shake : 0;
    CAM.oy = S.shake > 0 ? (Math.random() - 0.5) * 7 * S.shake : 0;
    if (view === 'top') {
      /* 地図は回さない。回すと道の形が読めなくなり、
         「いまどこを走っているか」が分からなくなる。
         動くのは車のほうで、地図は北を上に置いたまま。
         目は車の少し先に置き、これから走る道が多めに見えるようにする */
      const ahead = 34;
      CAM.px = L.x[i] + Math.cos(L.drv[i]) * ahead;
      CAM.py = L.y[i] + Math.sin(L.drv[i]) * ahead;
      CAM.t = 0; CAM.ct = 1; CAM.st = 0;
      CAM.ay = 0.5;
      return;
    }
    CAM.ay = EYE;
    /* 後ろから見るときは、進んでいる向きに構える。
       だから車が流れると、車だけが横を向いて見える。
       車内から見るときは、鼻の向いている先を見ている。
       だから車が流れると、道のほうが斜めから飛んでくる        */
    const a = (view === 'cab') ? L.drv[i] + sl * 0.82 : L.drv[i] + sl * 0.16;
    CAM.a = a;
    CAM.fc = Math.cos(a); CAM.fs = Math.sin(a);
    CAM.h = HIGH[view] || 26;
    const back = BACK[view] || 40;
    let px = L.x[i] - Math.cos(a) * back;
    let py = L.y[i] - Math.sin(a) * back;
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

  /* 空と、地平線の向こう。地面と空の境目が無いと、
     どこまでが走れる場所なのかが読めない                      */
  function sky(g, night) {
    const fl = S.props.flavor;
    const top = night ? '#141a33' : (fl === 'dry' ? '#7a86a8' : fl === 'snow' ? '#8ea0c8' : '#6f8ec0');
    const bot = night ? '#26304d' : (fl === 'dry' ? '#d6c49a' : fl === 'snow' ? '#dfe4f2' : '#bcc9dd');
    const gr = g.createLinearGradient(0, 0, 0, HORIZON);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    g.fillStyle = gr; g.fillRect(0, 0, VW, HORIZON + 1);
    // 遠くの山なみ
    g.fillStyle = night ? '#1b2340' : (fl === 'dry' ? '#8d7a58' : '#3d5266');
    g.beginPath(); g.moveTo(0, HORIZON);
    for (let x = 0; x <= VW; x += 28) {
      const h = 10 + Math.sin(x * 0.031 + 1.2) * 7 + Math.sin(x * 0.0121) * 9;
      g.lineTo(x, HORIZON - Math.max(0, h));
    }
    g.lineTo(VW, HORIZON); g.closePath(); g.fill();
    // 地面
    g.fillStyle = groundOf(S.props.flavor, night);
    g.fillRect(0, HORIZON, VW, VH - HORIZON);
    /* 地面にも目を入れる。無地だと、どれだけ飛ばしても動いて見えない。
       遠いほど細かく、手前ほど粗く                              */
    const off = (S.road.cum[S.i] * 0.5) % 40;
    g.fillStyle = 'rgba(0,0,0,.06)';
    for (let k = 1; k < 26; k++) {
      const fz = 24 + k * k * 2.6 + off;
      const sc = FOCAL / fz;
      const y = HORIZON + CAM.h * sc;
      if (y > VH) break;
      g.fillRect(0, y, VW, Math.max(0.6, sc * 0.9));
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
     「流れている」ということの、いちばん分かりやすい形     */
  function drawCarBack(g, L, i, inc) {
    const q = project(L.x[i], L.y[i]);
    if (!q) return;
    const z = q[2];
    const sl = L.slip[i] + (inc ? inc.rot : 0);
    const col = S.spec.color || '#c23a2e';
    const W2 = 19 * z, H2 = 12.5 * z;
    const x = q[0], y = q[1];
    const sn = Math.sin(sl), cs = Math.abs(Math.cos(sl));
    const sideW = 30 * z * sn;                 // 横っ腹の見えかた（符号つき）
    g.save();
    // 影
    g.fillStyle = 'rgba(0,0,0,.34)';
    g.beginPath(); g.ellipse(x, y, W2 * 0.8 + Math.abs(sideW) * 0.4, H2 * 0.16, 0, 0, TAU); g.fill();
    // 横っ腹（流れている側と反対に見える）
    if (Math.abs(sideW) > 1) {
      const sx = x + (sideW > 0 ? W2 * cs / 2 : -W2 * cs / 2);
      g.fillStyle = GP.gfx.shade(col, -0.30);
      g.beginPath();
      g.moveTo(sx, y); g.lineTo(sx + sideW, y - H2 * 0.10);
      g.lineTo(sx + sideW, y - H2 * 0.72); g.lineTo(sx, y - H2 * 0.92);
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,.20)';
      g.beginPath();
      g.moveTo(sx, y - H2 * 0.36); g.lineTo(sx + sideW, y - H2 * 0.34);
      g.lineTo(sx + sideW, y - H2 * 0.10); g.lineTo(sx, y);
      g.closePath(); g.fill();
      // 横のガラス
      g.fillStyle = '#15161b';
      g.beginPath();
      g.moveTo(sx + sideW * 0.10, y - H2 * 0.60); g.lineTo(sx + sideW * 0.86, y - H2 * 0.52);
      g.lineTo(sx + sideW * 0.86, y - H2 * 0.70); g.lineTo(sx + sideW * 0.10, y - H2 * 0.82);
      g.closePath(); g.fill();
    }
    // 後ろ姿
    const bw = W2 * cs;
    g.fillStyle = GP.gfx.shade(col, -0.36);
    g.fillRect(x - bw / 2 - 1.2 * z, y - H2, bw + 2.4 * z, H2);
    g.fillStyle = col;
    g.fillRect(x - bw / 2, y - H2 * 0.96, bw, H2 * 0.92);
    g.fillStyle = 'rgba(0,0,0,.24)';
    g.fillRect(x - bw / 2, y - H2 * 0.26, bw, H2 * 0.26);
    // リアガラス
    g.fillStyle = '#15161b';
    g.fillRect(x - bw * 0.34, y - H2 * 0.88, bw * 0.68, H2 * 0.30);
    // 尾灯
    g.fillStyle = '#e2664a';
    g.fillRect(x - bw * 0.46, y - H2 * 0.48, bw * 0.16, H2 * 0.13);
    g.fillRect(x + bw * 0.30, y - H2 * 0.48, bw * 0.16, H2 * 0.13);
    // 屋根の翼
    g.fillStyle = GP.gfx.shade(col, -0.30);
    g.fillRect(x - bw * 0.40, y - H2 * 1.12, bw * 0.09, H2 * 0.17);
    g.fillRect(x + bw * 0.31, y - H2 * 1.12, bw * 0.09, H2 * 0.17);
    g.fillStyle = '#23222c';
    g.fillRect(x - bw * 0.54, y - H2 * 1.24, bw * 1.08, H2 * 0.13);
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.fillRect(x - bw * 0.54, y - H2 * 1.24, bw * 1.08, H2 * 0.04);
    // タイヤ
    g.fillStyle = '#12101a';
    g.fillRect(x - bw / 2 - 2.6 * z, y - H2 * 0.42, 3.4 * z, H2 * 0.42);
    g.fillRect(x + bw / 2 - 0.8 * z, y - H2 * 0.42, 3.4 * z, H2 * 0.42);
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
    const sl = L.slip[i];
    const steer = clamp(steerOf(L, i) * 1.9, -1.15, 1.15);
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
    // ワイパー。窓の下端に寝ている
    g.strokeStyle = 'rgba(18,16,26,.62)'; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(VW * 0.24, dashY - 3); g.lineTo(VW * 0.40, dashY - 52);
    g.moveTo(VW * 0.58, dashY - 3); g.lineTo(VW * 0.74, dashY - 52);
    g.stroke();

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
    // タイヤ。後ろは車体なり、前はハンドルなり
    const steer = steerOf(L, i);
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

  return { start, stop, skip, setRate, setView, getView, dbg: () => S };
})();

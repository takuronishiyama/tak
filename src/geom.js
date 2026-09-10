/* =========================================================
   コース幾何の解析
   サーキット形状から曲率・コーナー・ストレートを求め、
   描画（raceview）とレース計算（race）の両方で共有する
   ========================================================= */
window.GP = window.GP || {};

GP.geom = (function () {
  'use strict';

  const SUB = 14;              // 制御点あたりの分割数
  const cache = {};
  const polyCache = {};

  /* 解析用の正規化ポリライン（1000x1000）。形状だけで決まるので使い回す */
  function polyOf(track) {
    if (!polyCache[track.name]) polyCache[track.name] = buildPoly(track.path, 1000, 1000, 0);
    return polyCache[track.name];
  }

  /* ---------- Catmull-Rom で閉ループを滑らかに再サンプル ---------- */
  function buildPoly(path, w, h, pad) {
    const p = path.map(pt => [pad + pt[0] * (w - pad * 2), pad + pt[1] * (h - pad * 2)]);
    const n = p.length, out = [];
    const at = i => p[(i % n + n) % n];
    for (let i = 0; i < n; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let s = 0; s < SUB; s++) {
        const t = s / SUB, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    const N = out.length;
    const ds = new Float64Array(N);   // 各点から次の点までの長さ
    const cum = new Float64Array(N + 1);
    let len = 0;
    for (let i = 0; i < N; i++) {
      const a = out[i], b = out[(i + 1) % N];
      ds[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
      cum[i] = len;
      len += ds[i];
    }
    cum[N] = len;
    return { pts: out, ds: ds, cum: cum, len: len, n: N };
  }

  /* ---------- 曲率（進行方向の変化量／距離）---------- */
  function curvature(poly) {
    const N = poly.n, k = new Float64Array(N);
    const ang = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = poly.pts[i], b = poly.pts[(i + 1) % N];
      ang[i] = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
    for (let i = 0; i < N; i++) {
      let d = ang[(i + 1) % N] - ang[i];
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      k[i] = Math.abs(d) / Math.max(0.5, poly.ds[i]);
    }
    // 前後にならして、分割の粗さによるギザつきを消す
    const sm = new Float64Array(N);
    const W = 3;
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let j = -W; j <= W; j++) acc += k[(i + j + N * 2) % N];
      sm[i] = acc / (W * 2 + 1);
    }
    return sm;
  }

  /* ---------- コース解析（コーナー・ストレート・DRS区間）---------- */
  function analyze(track) {
    if (cache[track.name]) return cache[track.name];
    const poly = polyOf(track);
    const k = curvature(poly);
    const N = poly.n;

    // 全コースで同じ基準になるよう、絶対値で正規化する
    // （1000x1000で描いたときの実測レンジ 0.000〜0.032 が根拠）
    const K_REF = 0.030;
    const norm = new Float64Array(N);
    for (let i = 0; i < N; i++) norm[i] = Math.min(1, k[i] / K_REF);

    // 曲率がしきい値を超える区間をコーナーとしてまとめる
    const CORNER = 0.0085 / K_REF;
    const corners = [];
    let i = 0, guard = 0;
    while (norm[i] > CORNER && guard++ < N) i = (i + 1) % N;   // 直線から数え始める
    const start = i;
    let run = null;
    for (let step = 0; step < N; step++) {
      const idx = (start + step) % N;
      if (norm[idx] > CORNER) {
        if (!run) run = { from: idx, to: idx, peak: norm[idx], len: poly.ds[idx] };
        else { run.to = idx; run.peak = Math.max(run.peak, norm[idx]); run.len += poly.ds[idx]; }
      } else if (run) { corners.push(run); run = null; }
    }
    if (run) corners.push(run);

    // ストレート（コーナーとコーナーの間）
    const straights = [];
    for (let c = 0; c < corners.length; c++) {
      const a = corners[c], b = corners[(c + 1) % corners.length];
      let from = (a.to + 1) % N, len = 0, idx = from, steps = 0;
      while (idx !== b.from && steps++ < N) { len += poly.ds[idx]; idx = (idx + 1) % N; }
      straights.push({ from: from, to: b.from, len: len });
    }
    straights.sort((x, y) => y.len - x.len);
    const longest = straights[0] || { from: 0, to: 0, len: 0 };

    let straightLen = 0;
    for (let j = 0; j < N; j++) if (norm[j] <= CORNER) straightLen += poly.ds[j];

    // セクター境界：1/3・2/3 地点にいちばん近い「直線上の点」に置く
    const bound = [0, 0];
    [1 / 3, 2 / 3].forEach((frac, bi) => {
      const target = poly.len * frac;
      let idx = 0;
      while (idx < N && poly.cum[idx] < target) idx++;
      // コーナーの途中を避け、前後を探して直線に寄せる
      let best = idx, bestK = norm[idx % N];
      for (let d = 1; d <= Math.round(N * 0.06); d++) {
        [(idx + d) % N, (idx - d + N) % N].forEach(j => {
          if (norm[j] < bestK - 0.02) { bestK = norm[j]; best = j; }
        });
      }
      bound[bi] = best;
    });
    const sectors = [
      { from: 0, to: bound[0] },
      { from: bound[0], to: bound[1] },
      { from: bound[1], to: N }
    ];

    /* ---- セクターごとの地形 ----
       同じコースでも区間によって求められるものが違う。
       S1 は立ち上がりの連続、S2 は曲がりどころ、S3 は長い直線……というように。
       曲がっている割合・直線の割合・立ち上がりの数を数えておく。     */
    const secGeo = sectors.map(sc => {
      let dist = 0, cornerLen = 0, exits = 0, prevC = null, longStr = 0, run2 = 0;
      const to = Math.min(N, sc.to);
      for (let idx = sc.from; idx < to; idx++) {
        const isC = norm[idx] > CORNER;
        dist += poly.ds[idx];
        if (isC) { cornerLen += poly.ds[idx]; run2 = 0; }
        else { run2 += poly.ds[idx]; if (run2 > longStr) longStr = run2; }
        if (prevC === true && !isC) exits++;      // コーナーから立ち上がった回数
        prevC = isC;
      }
      return { dist: dist, cornerLen: cornerLen, exits: exits, longStr: longStr };
    });

    /* その地形から、区間ごとに何が要るかの重みを作る。
       あとで「コース全体の重み」に合わせて割り戻すので、
       ここでは互いの比だけが意味を持つ                        */
    const gw = secGeo.map(sg => {
      const d = Math.max(1e-6, sg.dist);
      const cs = sg.cornerLen / d;                       // 曲がっている割合
      const ss = 1 - cs;                                 // 直線の割合
      const ls = sg.longStr / d;                         // いちばん長い直線の割合
      const ex = sg.exits / Math.max(1e-6, d / (poly.len / 10));   // 立ち上がりの密度
      const w = { speed:  0.10 + ss * 0.70 + ls * 1.15,
                  corner: 0.10 + cs * 2.10,
                  accel:  0.10 + Math.min(1.4, ex) * 0.85 };
      const tot = w.speed + w.corner + w.accel;
      return { speed: w.speed / tot, corner: w.corner / tot, accel: w.accel / tot };
    });

    const info = {
      kappa: norm,
      n: N,
      sectors: sectors,
      secGeo: secGeo,
      gw: gw,
      bounds: bound,
      corners: corners,
      straights: straights,
      longest: longest,
      // 全長に占める最長ストレートの割合。追い抜きやすさの根拠になる
      longestShare: poly.len > 0 ? longest.len / poly.len : 0,
      straightShare: poly.len > 0 ? straightLen / poly.len : 0,
      cornerCount: corners.length
    };
    cache[track.name] = info;
    return info;
  }

  /* ---------- 車ごとの速度プロファイル ----------
     コーナーでは曲率と「コーナー性能」で頭打ちになり、
     立ち上がりは「加速性能」、直線の伸びは「最高速性能」で決まる。
     戻り値は各点の通過時刻（1周を 1.0 に正規化した累積）。          */
  function speedProfile(track, stats) {
    const info = analyze(track);
    const poly = polyOf(track);
    const N = poly.n, k = info.kappa;

    const tot = Math.max(1, stats.speed + stats.corner + stats.accel);
    const sp = stats.speed / tot, co = stats.corner / tot, ac = stats.accel / tot;

    // コーナリング上限速度
    const v = new Float64Array(N);
    const vmax = 1 + sp * 1.30;
    for (let i = 0; i < N; i++) {
      v[i] = vmax / (1 + k[i] * (3.4 - co * 2.4));
    }
    // 加速・減速の制限（閉ループなので2周ぶん回して収束させる）
    const accel = 0.055 + ac * 0.075;     // 立ち上がりの鋭さ
    const brake = 0.150 + co * 0.060;     // ブレーキング性能
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const p = (i - 1 + N) % N;
        v[i] = Math.min(v[i], v[p] + accel * poly.ds[p]);
      }
      for (let i = N - 1; i >= 0; i--) {
        const nx = (i + 1) % N;
        v[i] = Math.min(v[i], v[nx] + brake * poly.ds[i]);
      }
    }
    // 通過時刻の累積（1周＝1.0に正規化）
    const cumT = new Float64Array(N + 1);
    let t = 0;
    for (let i = 0; i < N; i++) { cumT[i] = t; t += poly.ds[i] / Math.max(0.05, v[i]); }
    cumT[N] = t;
    for (let i = 0; i <= N; i++) cumT[i] /= t;
    // このマシンが1周のうち各セクターに費やす時間の割合。
    // コーナーの多いセクターはダウンフォース型ほど短くなる。
    const b = info.bounds;
    const share = [cumT[b[0]], cumT[b[1]] - cumT[b[0]], 1 - cumT[b[1]]];
    return { cumT: cumT, v: v, n: N, vmax: vmax, share: share };
  }

  /* ---------- 区間ごとのコース重み ----------
     TRACKS が持っている weight は1周ぶんの性格。
     それを、区間の地形の偏りに応じて振り分け直す。
     基準の車（速さ・曲がり・加速が同じ）の時間配分で足し戻すと
     元の weight に戻るので、コース全体の性格は変わらない。      */
  const secWCache = {};
  function sectorWeights(track) {
    if (secWCache[track.name]) return secWCache[track.name];
    const info = analyze(track);
    const sh0 = speedProfile(track, { speed: 1, corner: 1, accel: 1 }).share;
    const avg = { speed: 0, corner: 0, accel: 0 };
    info.gw.forEach((w, k) => {
      avg.speed += w.speed * sh0[k];
      avg.corner += w.corner * sh0[k];
      avg.accel += w.accel * sh0[k];
    });
    const tw = track.weight;
    /* 区間の性格をどれだけ際立たせるか。
       1 だと地形どおり。大きくするほど「ここは曲がりどころ」
       「ここは直線勝負」の色が濃くなり、区間タイムに差が出る    */
    const EX = 2.0;
    const amp = (a, b) => Math.pow(a / Math.max(1e-6, b), EX);
    const out = info.gw.map(w => {
      const v = { speed:  tw.speed  * amp(w.speed,  avg.speed),
                  corner: tw.corner * amp(w.corner, avg.corner),
                  accel:  tw.accel  * amp(w.accel,  avg.accel) };
      const tot = v.speed + v.corner + v.accel;
      return { speed: v.speed / tot, corner: v.corner / tot, accel: v.accel / tot };
    });
    const res = { w: out, share0: sh0, geo: info.secGeo };
    secWCache[track.name] = res;
    return res;
  }

  return { buildPoly, polyOf, curvature, analyze, speedProfile, sectorWeights };
})();

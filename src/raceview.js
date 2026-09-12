/* =========================================================
   レース観戦ビュー（Canvasでドット絵の車が周回する）
   ========================================================= */
window.GP = window.GP || {};

GP.raceview = (function () {
  'use strict';

  let cv, ctx, res, poly, trackArt = null, raf = null;
  let emissive = [];        // ネオンなど、明示的に光らせたいもの（世界座標）
  let standalone = false;   // レース外で1台だけ描いているとき（カメラが無い）
  /* 観戦の速さ（レース全体を何秒で見せるか）。
     じっくり見るのを基準にして、そこから3段だけ速くできる    */
  const DEFAULT_SPEED = 200;
  let vt = 0, speed = DEFAULT_SPEED, running = false, onEnd = null, lastTs = 0, lights = 0, chequer = 0, duration = 1;
  let shownEvents = 0;
  /* チーム無線。実況の下に流れる文字とは別に、短い言葉を数秒だけ出す */
  let shownRadio = 0, radioQueue = [], radioTimer = 0;
  let wetNow = false;        // いま雨が降っているか（途中で変わる）

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
    // 少し先の向きとの差＝ハンドルの切れ角。前輪を曲げて描くのに使う
    const ah = interp((lo + 3) % prof.n, 0).ang;
    let d = ah - r.ang;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    r.steer = Math.max(-0.5, Math.min(0.5, d * 1.6));
    return r;
  }

  /* ---------- 各車の周回進捗 ----------
     ピットに入っている間、車はコース上を進んでいない。
     ここで停止時間を差し引かないと、止まっているのに順位が落ちず、
     出てきた瞬間に一気に入れ替わる、という妙な見え方になる        */
  /* ピットが1周のうちどのあたりにあるか（0..1）。
     ピットレーンは最長ストレートに沿って描いているので、
     作業中の車もそこで止まっていなければ、出入りが飛んで見える  */
  let pitFracCache = null;
  function pitFrac() {
    if (pitFracCache != null) return pitFracCache;
    const sp = pitSpan();
    if (!sp || !poly) { pitFracCache = 0.92; return pitFracCache; }
    const mid = (sp.from + (sp.len >> 1)) % poly.n;
    pitFracCache = Math.max(0.02, Math.min(0.96, poly.cum[mid] / poly.len));
    return pitFracCache;
  }

  /* その周をどこまで進んだか（0..1）。
     ピットに入る周は「ピットまで走る → 止まる → 出て残りを走る」の
     三段に分ける。ここを周の終わりにまとめていたため、
     ピットの位置と、出てくる位置が食い違って見えていた            */
  function lapFrac(into, drive, pt) {
    if (pt <= 0) return into / drive;
    const pf = pitFrac();
    const toPit = drive * pf;
    if (into <= toPit) return into / drive;
    if (into <= toPit + pt) return pf;
    return (into - pt) / drive;
  }

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
    const pt = (e.pitTime || [])[lap] || 0;      // その周のピット停止時間
    const drive = Math.max(0.1, lt - pt);        // 実際に走っている時間
    return { done: false, p: lap + Math.min(0.999, lapFrac(t - prev, drive, pt)) };
  }

  /* その車が、コース上の位置 p（周＋周内の割合）に居たのは何秒の時点か。
     順位表の「◯秒差」を、周回数の差ではなく本当の時間差で出すために使う */
  function timeAt(e, p) {
    const n = e.cum.length;
    const lap = Math.max(0, Math.min(n - 1, Math.floor(p)));
    const f = Math.max(0, Math.min(1, p - lap));
    const prev = lap === 0 ? 0 : e.cum[lap - 1];
    const pt = (e.pitTime || [])[lap] || 0;
    const drive = Math.max(0.1, (e.lapTimes[lap] || 1) - pt);
    // ピットを通り過ぎたあとの位置なら、作業ぶんの時間も足す
    let dt = f * drive;
    if (pt > 0 && f > pitFrac()) dt += pt;
    return prev + dt;
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
    const toPit = Math.max(0.1, li.lapTime - pt) * pitFrac();
    return li.into > toPit && li.into <= toPit + pt;
  }
  /* 作業の残り時間 */
  function pitLeft(e, t) {
    const li = lapInfo(e, t);
    const pt = (e.pitTime || [])[li.lap - 1] || 0;
    const toPit = Math.max(0.1, li.lapTime - pt) * pitFrac();
    return { left: Math.max(0, toPit + pt - li.into), pt: pt };
  }

  /* いま履いているタイヤ */
  function tyreNow(e, t) {
    const li = lapInfo(e, t);
    return (e.lapTyre || [])[li.lap - 1] || (e.lapTyre || [])[0] || null;
  }
  /* いまのタイヤ温度と、作動域に対する位置（-1 冷え / 0 ちょうど / +1 熱すぎ） */
  function tempNow(e, t, td) {
    const li = lapInfo(e, t);
    const v = (e.lapTemp || [])[li.lap - 1];
    if (v == null || !td || td.tLo == null) return null;
    const S2 = GP.state;
    const vf = (e.lapTempF || [])[li.lap - 1];
    const vr = (e.lapTempR || [])[li.lap - 1];
    /* 印に出すのは、たちの悪いほう。
       前が焼けていても後ろが冷えていても、困っているのは同じなので */
    const offF = vf == null ? null : S2.tyreOff(td, vf);
    const offR = vr == null ? null : S2.tyreOff(td, vr);
    const bad = (offF == null || offR == null) ? v
              : (Math.abs(offF) >= Math.abs(offR) ? vf : vr);
    const off = S2.tyreOff(td, bad);
    const tier = S2.tempTier(td, bad);
    const axle = (offF == null || offR == null) ? null
               : (Math.abs(offF) >= Math.abs(offR) ? 'フロント' : 'リア');
    return { temp: v, tempF: vf, tempR: vr, off: off, tier: tier, axle: axle,
             // 帯の中での位置（0..1）。外れているぶんは端に張りつく
             pos: Math.max(0, Math.min(1, (bad - td.tLo) / Math.max(1, td.tHi - td.tLo))) };
  }

  function orderAt(t) {
    return res.entries.slice().map(e => {
      const pr = progress(e, t);
      const n = e.cum.length;
      // ゴールした車は「周回数」ではなく「ゴールした時刻」で並べる。
      // 走り切った車はみな p が最終周ちょうどで並ぶため、これをしないと
      // ラインを通過した瞬間に順位が入れ替わって見えてしまう
      return { e, p: pr.p, done: pr.done,
               // !! を外すと、dnf が undefined の車と false の車で
               // a.out !== b.out が成り立ってしまい、並びが毎フレーム暴れる
               out: !!(e.dnf && t >= (e.cum[e.dnfLap - 1] || 0)),
               fin: (pr.done && !e.dnf && n) ? (e.cum[n - 1] || 0) : 0 };
    }).sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;
      // まず進んだ周回数。同じ周回数までのゴールどうしは、早く着いた順。
      // 周回数を先に見ないと、周回遅れのゴールとまだ走っている車のあいだで
      // 順序が循環してしまう
      if (a.p !== b.p) return b.p - a.p;
      if (a.fin && b.fin) return a.fin - b.fin;
      return 0;
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

    // ---- ランオフ ----
    strokeOn(g, 34, shade(th.edge, -0.06));
    strokeOn(g, 30, th.edge);
    // ランオフの砂利／アスファルトの粒
    g.save();
    g.beginPath();
    g.lineWidth = 30; g.lineJoin = 'round'; g.lineCap = 'round';
    g.moveTo(poly.pts[0][0], poly.pts[0][1]);
    for (let i = 1; i < poly.n; i++) g.lineTo(poly.pts[i][0], poly.pts[i][1]);
    g.closePath();
    g.clip();
    const rn2 = seeded(res.track.name + 'runoff');
    for (let i = 0; i < 900; i++) {
      const x = rn2() * c.width, y = rn2() * c.height;
      g.fillStyle = rn2() > 0.5 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)';
      g.fillRect(x, y, 2, 2);
    }
    g.restore();

    // ---- 路面 ----
    strokeOn(g, 24, shade(th.road, -0.22));                 // 路肩の締まり
    strokeOn(g, 22, wet ? shade(th.road, -0.18) : th.road);
    // コース幅を示す白線。ここで先に引いておく
    // （レーシングラインより後に引くと、路面色で塗り潰してしまう）
    strokeOn(g, 20.5, 'rgba(255,255,255,.40)');
    strokeOn(g, 19, wet ? shade(th.road, -0.18) : th.road);

    // アスファルトの粒。同じ模様が続かないよう、路面の内側だけに散らす
    g.save();
    g.beginPath();
    g.lineWidth = 21; g.lineJoin = 'round'; g.lineCap = 'round';
    g.moveTo(poly.pts[0][0], poly.pts[0][1]);
    for (let i = 1; i < poly.n; i++) g.lineTo(poly.pts[i][0], poly.pts[i][1]);
    g.closePath();
    g.clip();
    const rn3 = seeded(res.track.name + 'asphalt');
    for (let i = 0; i < 2600; i++) {
      const x = rn3() * c.width, y = rn3() * c.height;
      const v = rn3();
      g.fillStyle = v > 0.62 ? 'rgba(255,255,255,.055)'
                 : v > 0.30 ? 'rgba(0,0,0,.07)' : 'rgba(120,130,150,.05)';
      g.fillRect(x, y, 2, 2);
    }
    // 補修跡（つぎはぎ）
    for (let i = 0; i < 14; i++) {
      const t = rn3(), idx = Math.floor(t * poly.n), nm = normalAt(idx);
      g.save();
      g.translate(nm.x, nm.y); g.rotate(Math.atan2(nm.dy, nm.dx));
      g.fillStyle = 'rgba(20,22,28,.16)';
      g.fillRect(-6 - rn3() * 10, -9, 12 + rn3() * 20, 18);
      g.restore();
    }
    g.restore();

    // ---- レーシングライン ----
    // 何周も走ると、走行ラインにタイヤのゴムが乗って黒い筋になる。
    // コーナーではイン側へ寄るので、旋回の向きに合わせて線をずらす。
    const off = new Array(poly.n);
    for (let i = 0; i < poly.n; i++) {
      const a = poly.pts[(i - 3 + poly.n) % poly.n], b = poly.pts[i], d = poly.pts[(i + 3) % poly.n];
      const cross = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]);
      const k = (res.geo.kappa && res.geo.kappa[i]) || 0;
      off[i] = (cross > 0 ? -1 : 1) * Math.min(6.5, k * 9);
    }
    // 実際の走行ラインは滑らかなので、前後をならす
    const soff = new Array(poly.n);
    for (let i = 0; i < poly.n; i++) {
      let sum = 0;
      for (let d = -14; d <= 14; d++) sum += off[(i + d + poly.n) % poly.n];
      soff[i] = sum / 29;
    }
    for (const [w, alpha] of [[10, 0.13], [6, 0.17], [3, 0.14]]) {
      g.strokeStyle = 'rgba(24,22,26,' + alpha + ')';
      g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i <= poly.n; i++) {
        const j = i % poly.n, nm = normalAt(j);
        const x = nm.x + nm.nx * soff[j], y = nm.y + nm.ny * soff[j];
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.stroke();
    }

    // ---- 中央の破線 ----
    strokeOn(g, 2, 'rgba(255,255,255,.24)', [6, 10]);

    // ---- 縁石（コーナー区間の内外両側）----
    // 平らな赤白だと板に見えるので、下に影・内側に段差・上面に照りを入れて
    // 「路面から盛り上がっている」ように見せる。
    (res.geo.corners || []).forEach(cn => {
      let i = cn.from, steps = 0;
      const span = (cn.to - cn.from + poly.n) % poly.n;
      while (steps <= span && steps < poly.n) {
        const nm = normalAt(i);
        const red = (steps >> 1) % 2 === 0;
        for (const sgn of [1, -1]) {
          g.save();
          g.translate(nm.x + nm.nx * sgn * 12, nm.y + nm.ny * sgn * 12);
          g.rotate(Math.atan2(nm.dy, nm.dx));
          g.fillStyle = 'rgba(0,0,0,.34)';                     // 落ち影
          g.fillRect(-1.5, -2.8 + sgn * 0.8, 4.4, 6);
          g.fillStyle = red ? '#b32b1c' : '#c9c2ad';           // 側面（段差）
          g.fillRect(-1.5, -2.8, 4.2, 6);
          g.fillStyle = red ? '#e8402c' : '#f6f2e4';           // 上面
          g.fillRect(-1.5, -2.8, 4.2, 4.4);
          g.fillStyle = red ? 'rgba(255,150,120,.55)'          // 上面の照り
                            : 'rgba(255,255,255,.65)';
          g.fillRect(-1.5, -2.8, 4.2, 1.2);
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
      // ピットレーンに沿った線を引くための道具
      const lane = (dist, width, color, dash) => {
        g.strokeStyle = color; g.lineWidth = width;
        g.lineJoin = 'round'; g.lineCap = 'butt';
        g.setLineDash(dash || []);
        g.beginPath();
        for (let k = 0; k <= pit.len; k++) {
          const nm = normalAt((pit.from + k) % poly.n);
          const x = nm.x + nm.nx * pit.side * dist, y = nm.y + nm.ny * pit.side * dist;
          if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        g.setLineDash([]);
      };

      lane(20, 13, '#4c4f56');                       // 縁の締まり
      lane(20, 11, '#6d7078');                       // 路面
      lane(20, 11.5, 'rgba(255,255,255,.42)');       // いったん白で塗り
      lane(20, 10, '#6d7078');                       //   中を戻して両端に白線を残す
      lane(20, 1.2, 'rgba(255,255,255,.30)', [4, 5]);// 中央の破線

      // ピットボックス（各チームの作業区画）
      for (let k = 4; k < pit.len - 3; k += 7) {
        const nm = normalAt((pit.from + k) % poly.n);
        g.save();
        g.translate(nm.x + nm.nx * pit.side * 25, nm.y + nm.ny * pit.side * 25);
        g.rotate(Math.atan2(nm.dy, nm.dx));
        g.fillStyle = 'rgba(255,255,255,.34)';       // 区画の枠線
        g.fillRect(-3.4, -4.5, 6.8, 0.9);
        g.fillRect(-3.4, 3.6, 6.8, 0.9);
        g.fillRect(-3.4, -4.5, 0.9, 9);
        g.restore();
      }

      // ピットウォール（コース側の壁）。上面に照りを入れて立たせる
      lane(14, 2.6, '#8d8578');
      lane(13.4, 1.2, '#d8d2c0');

      // 入口と出口の白線
      [0, pit.len].forEach(k => {
        const nm = normalAt((pit.from + k) % poly.n);
        g.save();
        g.translate(nm.x + nm.nx * pit.side * 20, nm.y + nm.ny * pit.side * 20);
        g.rotate(Math.atan2(nm.dy, nm.dx));
        g.fillStyle = 'rgba(255,255,255,.60)';
        g.fillRect(-1, -5.5, 2, 11);
        g.restore();
      });
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
    // コース側から順に、最前列→段々に高くなる座席→屋根、と重ねる。
    if (pit) {
      for (let k = 2; k < pit.len - 2; k += 9) {
        const nm = normalAt((pit.from + k) % poly.n);
        const sx = nm.x - nm.nx * pit.side * 31, sy = nm.y - nm.ny * pit.side * 31;
        if (sx < 10 || sy < 10 || sx > W - 10 || sy > H - 10) continue;
        g.save();
        g.translate(sx, sy);
        g.rotate(Math.atan2(nm.dy, nm.dx));
        g.scale(1, -pit.side);            // コース側がつねに手前になるように向きを揃える
        const CROWD = ['#e8564a', '#4a86e0', '#f5aa2a', '#58b84a', '#d0d0d8', '#c060c8'];
        g.fillStyle = '#3a352c'; g.fillRect(-6, -10, 12, 20);      // 土台の影
        // 段。奥へ行くほど明るくして、せり上がって見せる
        for (let t = 0; t < 4; t++) {
          const yy = -9 + t * 4.6;
          g.fillStyle = ['#6e6a5e', '#7c786a', '#8a8576', '#989282'][t];
          g.fillRect(-5, yy, 10, 4.4);
          g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(-5, yy, 10, 0.9);  // 段の影
          for (let c2 = 0; c2 < 4; c2++) {                                // 観客
            if (((t * 7 + c2 * 3) % 5) === 0) continue;                   // ところどころ空席
            g.fillStyle = CROWD[(t * 3 + c2 * 2) % CROWD.length];
            g.fillRect(-4.2 + c2 * 2.4, yy + 1.4, 1.6, 2.2);
          }
        }
        // 屋根と、それを支える柱
        g.fillStyle = '#4a4a52'; g.fillRect(-6.5, 6.4, 1.3, 3.4); g.fillRect(5.2, 6.4, 1.3, 3.4);
        g.fillStyle = '#5e5f68'; g.fillRect(-7, 8.6, 14, 3.2);
        g.fillStyle = '#767781'; g.fillRect(-7, 8.6, 14, 1.1);
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
    // 縁取り付きの箱。ドット絵は輪郭があると形が締まる
    const box = (bx, by, bw, bh, fill, line) => {
      g.fillStyle = line; g.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      g.fillStyle = fill; g.fillRect(bx, by, bw, bh);
    };

    if (theme === 'street') {
      // ---- 街の建物：屋上のパラペットと設備、階ごとの窓 ----
      const w = 15 + Math.round(rnd() * 13), h = 18 + Math.round(rnd() * 20);
      const wall = ['#8e94a0', '#7c828e', '#9aa0ac', '#87909e'][Math.floor(rnd() * 4)];
      box(x - w / 2, y - h, w, h, wall, '#3f444c');
      g.fillStyle = 'rgba(255,255,255,.10)';                    // 左側に光を当てる
      g.fillRect(x - w / 2, y - h, Math.max(2, w * 0.28), h);
      for (let a = 2; a < w - 3; a += 5) {                      // 窓
        for (let b = 5; b < h - 3; b += 6) {
          g.fillStyle = ((a + b) % 3) ? 'rgba(255,240,180,.62)' : 'rgba(120,150,180,.55)';
          g.fillRect(x - w / 2 + a, y - h + b, 3, 3);
          g.fillStyle = 'rgba(0,0,0,.22)';
          g.fillRect(x - w / 2 + a, y - h + b + 3, 3, 1);       // 窓の下の影
        }
      }
      g.fillStyle = '#5c626c'; g.fillRect(x - w / 2, y - h, w, 2.5);          // 屋上
      g.fillStyle = '#6e7580'; g.fillRect(x - w / 2 - 1, y - h - 1.5, w + 2, 1.8);  // パラペット
      if (rnd() < 0.6) {                                                     // 屋上の設備
        g.fillStyle = '#4e545e'; g.fillRect(x - 2, y - h - 3.5, 5, 3);
        g.fillStyle = '#666d78'; g.fillRect(x - 2, y - h - 3.5, 5, 1);
      }

    } else if (theme === 'neon') {
      // ---- 夜の街：高い塔と、光る看板 ----
      const w = 12 + Math.round(rnd() * 12), h = 22 + Math.round(rnd() * 26);
      box(x - w / 2, y - h, w, h, '#2a3050', '#141931');
      g.fillStyle = 'rgba(120,150,220,.12)';
      g.fillRect(x - w / 2, y - h, Math.max(2, w * 0.3), h);
      const nc = ['#ff4fa0', '#4fd8ff', '#ffe14f', '#8cff6a', '#c66aff'][Math.floor(rnd() * 5)];
      // 縦看板と横看板
      g.fillStyle = nc;
      g.fillRect(x - w / 2 + 2, y - h + 3, w - 4, 3);
      emissive.push({ x: x - w / 2 + 2, y: y - h + 3, w: w - 4, h: 3, c: nc });
      if (rnd() < 0.5) {
        g.fillRect(x + w / 2 - 3.5, y - h + 8, 2.5, h * 0.4);
        emissive.push({ x: x + w / 2 - 3.5, y: y - h + 8, w: 2.5, h: h * 0.4, c: nc });
      } else {
        g.fillRect(x - w / 2 + 2, y - h + 9, Math.max(3, w - 8), 2.5);
        emissive.push({ x: x - w / 2 + 2, y: y - h + 9, w: Math.max(3, w - 8), h: 2.5, c: nc });
      }
      for (let b = 15; b < h - 3; b += 5) {                     // 灯りのついた窓
        for (let a = 2; a < w - 3; a += 4) {
          if (((a + b) % 3) === 0) continue;
          g.fillStyle = 'rgba(255,236,180,.42)';
          g.fillRect(x - w / 2 + a, y - h + b, 2, 2);
        }
      }
      g.fillStyle = '#3b4266'; g.fillRect(x - w / 2, y - h, w, 2);
      if (rnd() < 0.45) {                                       // 塔の頂の航空障害灯
        g.fillStyle = '#ff5a4a'; g.fillRect(x - 0.8, y - h - 3, 1.6, 3);
        emissive.push({ x: x - 0.8, y: y - h - 3, w: 1.6, h: 3, c: '#ff5a4a' });
      }

    } else if (theme === 'desert') {
      const k = rnd();
      if (k < 0.42) {
        // ヤシの木：幹に節を入れ、葉を左右に垂らす
        const th2 = 16 + Math.round(rnd() * 8);
        g.fillStyle = '#4a3620'; g.fillRect(x - 2, y - th2, 4, th2);
        g.fillStyle = '#7a5c32'; g.fillRect(x - 1, y - th2, 2, th2);
        g.fillStyle = '#5c4526';
        for (let b = 3; b < th2; b += 4) g.fillRect(x - 2, y - th2 + b, 4, 1);
        const leaf = (dx, dy, lw, lh, c) => { g.fillStyle = c; g.fillRect(x + dx, y - th2 + dy, lw, lh); };
        leaf(-12, -1, 10, 3, '#255c2e'); leaf(2, -1, 10, 3, '#255c2e');
        leaf(-9, -4, 8, 3, '#2f6b38');   leaf(1, -4, 8, 3, '#2f6b38');
        leaf(-6, -7, 5, 3, '#3f8a4a');   leaf(1, -7, 5, 3, '#3f8a4a');
        leaf(-2, -9, 4, 3, '#4a9a55');
        g.fillStyle = '#8a6a3a'; g.fillRect(x - 2, y - th2 - 1, 4, 2);   // 実
      } else if (k < 0.72) {
        // 岩：面ごとに明るさを変えて塊に見せる
        const w = 13 + Math.round(rnd() * 8), h = 8 + Math.round(rnd() * 5);
        box(x - w / 2, y - h, w, h, '#9a8358', '#635033');
        g.fillStyle = '#b9a077'; g.fillRect(x - w / 2 + 1, y - h + 1, w * 0.55, h * 0.45);
        g.fillStyle = '#c8b189'; g.fillRect(x - w / 2 + 2, y - h + 1, w * 0.3, 2);
        g.fillStyle = '#7a6544'; g.fillRect(x - w / 2, y - 2, w, 2);
      } else {
        // サボテン
        const h = 12 + Math.round(rnd() * 8);
        g.fillStyle = '#2f6b38'; g.fillRect(x - 2.5, y - h, 5, h);
        g.fillStyle = '#3f8a4a'; g.fillRect(x - 1.5, y - h, 2, h);
        g.fillStyle = '#2f6b38';
        g.fillRect(x - 7, y - h * 0.7, 4.5, 3); g.fillRect(x - 7, y - h * 0.7, 3, 7);
        g.fillRect(x + 2.5, y - h * 0.55, 4.5, 3); g.fillRect(x + 4, y - h * 0.55, 3, 6);
      }

    } else if (theme === 'alpine') {
      // ---- 針葉樹：三角を重ねて円錐にする ----
      const h = 20 + Math.round(rnd() * 10);
      g.fillStyle = '#43301a'; g.fillRect(x - 1.5, y - 5, 3, 5);
      for (let t = 0; t < 4; t++) {
        const yy = y - 5 - t * (h / 5.2), hw = 8 - t * 1.7;
        g.fillStyle = '#123a1c'; g.fillRect(x - hw - 1, yy - h / 4.4, hw * 2 + 2, h / 4.4 + 1);
        g.fillStyle = ['#1d5228', '#236030', '#2a6d37', '#31793d'][t];
        g.fillRect(x - hw, yy - h / 4.4, hw * 2, h / 4.4);
        g.fillStyle = 'rgba(210,235,255,.30)';                   // 左肩の雪
        g.fillRect(x - hw, yy - h / 4.4, hw * 0.7, 1.6);
      }

    } else {
      // ---- 広葉樹（芝・森）：幹・影の葉・本体・光の葉 の4層 ----
      const dark = theme === 'forest';
      const sc = 0.85 + rnd() * 0.5;
      const cw = Math.round(9 * sc), ch = Math.round(11 * sc);
      g.fillStyle = '#3a2712'; g.fillRect(x - 2, y - 8, 4, 8);          // 幹
      g.fillStyle = '#6a4a2a'; g.fillRect(x - 1, y - 8, 2, 8);
      const c0 = dark ? '#0f2d14' : '#173a1a';
      const c1 = dark ? '#1f5024' : '#2a6b2b';
      const c2 = dark ? '#2e6e33' : '#3f8c3c';
      const c3 = dark ? '#3f8543' : '#59a94f';
      g.fillStyle = c0;                                                 // 輪郭
      g.fillRect(x - cw - 1, y - 7 - ch, cw * 2 + 2, ch + 1);
      g.fillRect(x - cw * 0.6, y - 10 - ch, cw * 1.2, 4);
      g.fillStyle = c1;                                                 // 本体
      g.fillRect(x - cw, y - 7 - ch, cw * 2, ch);
      g.fillRect(x - cw * 0.55, y - 9.5 - ch, cw * 1.1, 3.5);
      g.fillStyle = c2;                                                 // 中間の葉
      g.fillRect(x - cw + 1, y - 6 - ch, cw * 1.2, ch * 0.55);
      g.fillStyle = c3;                                                 // 光の当たる葉
      g.fillRect(x - cw + 1.5, y - 5.5 - ch, cw * 0.7, ch * 0.3);
      g.fillRect(x - cw * 0.4, y - 9 - ch, cw * 0.5, 2.5);
      if (!dark && rnd() < 0.25) {                                      // たまに花や実
        g.fillStyle = '#f0d84a';
        g.fillRect(x - cw * 0.2, y - 4 - ch, 1.6, 1.6);
        g.fillRect(x + cw * 0.4, y - 6 - ch, 1.6, 1.6);
      }
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
    const wet = wetNow;
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
        const pl = pitLeft(e, t);
        const left = pl.left;
        // 作業の進み具合 0..1。これで手順のどこにいるかを決める
        const prog = Math.max(0, Math.min(1, 1 - left / Math.max(0.1, pl.pt)));
        drawPitCrew(px, py, ang, e, prog, t, tyreNow(e, t));
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
      drawCar(pt2.x, pt2.y, pt2.ang, e.color, e.isPlayer, o.out, e.gen || 0, vel, pt2.steer);
    }
    // ---- セーフティカー本体 ----
    // 実車が出ているあいだだけ、隊列の先頭のさらに前を走らせる
    const sc = res.safetyCar;
    if (sc && !sc.virtual) {
      const lead = ord.filter(o => !o.out)[0];
      if (lead) {
        const lLap = lapInfo(lead.e, t).lap;
        if (lLap >= sc.from && lLap < sc.from + sc.laps) {
          const p2 = placeInLap(lead.e, lead.p + 0.014);
          // 引き上げる周は回転灯を消す。現実でもこれが「今周で入る」の合図
          drawSafetyCar(p2.x, p2.y, p2.ang, t, lLap === sc.from + sc.laps - 1);
        }
      }
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

  /* ---------- マシンのドット絵 ----------
     上から見たF1の形をそのまま組む。寸法は実車比（全長5.6m×全幅2.0m）を
     1m≒5.5px で置いたもの。世代が上がるほど部品が増えていく。
     前方が +x、車体の右が +y。光は車体の前左（-y側）から当たっている前提。   */
  /* セーフティカー。市販車然としたシルエットに、屋根の回転灯 */
  function drawSafetyCar(x, y, ang, t, lightsOff) {
    const on = !lightsOff && ((t * 5) | 0) % 2 === 0;   // 回転灯の明滅
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    // 影
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.fillRect(-13, -6, 27, 14);
    // タイヤ
    ctx.fillStyle = '#15151a';
    ctx.fillRect(-10, -9, 6, 3); ctx.fillRect(-10, 6, 6, 3);
    ctx.fillRect(5, -9, 6, 3);   ctx.fillRect(5, 6, 6, 3);
    // 車体（黒い縁取りをつけて、路面から浮かせる）
    ctx.fillStyle = '#15151a'; ctx.fillRect(-14, -8, 28, 16);
    ctx.fillStyle = '#e8e8ec'; ctx.fillRect(-13, -7, 26, 14);
    ctx.fillStyle = '#fbfbfd'; ctx.fillRect(-13, -7, 26, 4);
    ctx.fillStyle = '#c2c2ca'; ctx.fillRect(-13, 4, 26, 3);
    // 側面の帯（赤／黄のツートン）
    ctx.fillStyle = '#e04a3f'; ctx.fillRect(-13, -1, 26, 2);
    ctx.fillStyle = '#ffc93c'; ctx.fillRect(-13, 1, 26, 1);
    // 窓（前後）と屋根
    ctx.fillStyle = '#243040'; ctx.fillRect(3, -5, 6, 10);      // フロントガラス
    ctx.fillStyle = '#3d5068'; ctx.fillRect(3, -5, 6, 3);
    ctx.fillStyle = '#c6c6ce'; ctx.fillRect(-13, -6, 4, 12);    // トランク
    ctx.fillStyle = '#d2d2da'; ctx.fillRect(-5, -6, 8, 12);     // ルーフ
    // ルーフの回転灯。小さく映っても分かるように、屋根の幅いっぱいに置く
    ctx.fillStyle = '#2a2410'; ctx.fillRect(-3, -6, 5, 12);
    ctx.fillStyle = on ? '#ffe14a' : '#6e6018'; ctx.fillRect(-3, -6, 5, 6);
    ctx.fillStyle = on ? '#6e6018' : '#ffe14a'; ctx.fillRect(-3, 0, 5, 6);
    // 前後の識別灯
    ctx.fillStyle = on ? '#fff6c8' : '#8a7a20';
    ctx.fillRect(12, -6, 2, 3); ctx.fillRect(12, 3, 2, 3);
    // ボンネットの SC
    ctx.fillStyle = '#15151a'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
    ctx.fillText('SC', -9, 2);
    ctx.textAlign = 'left';
    ctx.restore();
    // 回転灯の光を、あとから乗せる光にも登録する
    emissive.push({ x: x - 6, y: y - 6 + (on ? 0 : 6), w: 12, h: 6,
                    c: 'rgba(255,225,74,0.60)' });
  }

  function drawCar(x, y, ang, color, isPlayer, out, gen, vel, steer) {
    gen = Math.max(0, Math.min(5, gen | 0));
    vel = vel == null ? 1 : vel;
    steer = steer || 0;

    const dark = shade(color, -0.16);      // 影になる面
    const lite = shade(color, 0.18);       // 光が当たる面
    const CARBON = '#22232a', CARBON2 = '#3a3c45', TYRE = '#15161a';

    // 世代ごとの寸法。新しいほど長く低く、ウイングが大きくなる
    const nose  = 15.0 + gen * 0.45;                // ノーズの先端
    const fwX   = nose - 2.6;                       // フロントウイング（前輪より前）
    const fwH   = 7.2 + gen * 0.26;                 // フロントウイングの半幅（車体最大幅）
    const rwX   = -12.0 - gen * 0.28;               // リアウイングの位置
    const rwH   = 5.6 + gen * 0.24;                 // リアウイングの半幅
    const podH  = 3.2 + (gen >= 3 ? 0.4 : 0);       // サイドポッドの張り出し
    const trk   = 5.1 + gen * 0.06;                 // タイヤ中心までの距離
    const tyL   = 5.0 + gen * 0.16, tyH = 1.95;     // タイヤの長さ／半分の太さ
    const frontAx = 8.2, rearAx = -7.4;             // 前後の車軸
    const S = 0.80;                                 // 路面幅との釣り合いを取る全体倍率

    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(ang);
    ctx.scale(S, S);
    ctx.globalAlpha = out ? 0.3 : 1;

    const r = (rx, ry, rw, rh, c) => { ctx.fillStyle = c; ctx.fillRect(rx, ry, rw, rh); };

    if (!out && vel > 0.82) {
      // 高速域はスピードラインを引いて伸びを見せる
      ctx.strokeStyle = 'rgba(255,255,255,' + ((vel - 0.82) * 2.0).toFixed(2) + ')';
      ctx.lineWidth = 1;
      const tail = 7 + (vel - 0.82) * 52;
      ctx.beginPath();
      ctx.moveTo(rwX - 1, -2.4); ctx.lineTo(rwX - 1 - tail, -2.4);
      ctx.moveTo(rwX - 1, 2.4);  ctx.lineTo(rwX - 1 - tail, 2.4);
      ctx.stroke();
    }

    // ---- 影（車体の下だけに、光と反対へ少しずらして落とす）----
    r(rwX + 1.5, -1.8, nose - rwX - 2, 5.0, 'rgba(0,0,0,.30)');

    // ---- タイヤ（後輪は固定、前輪は切れ角ぶん回す）----
    const tyre = (tx, ty, rot) => {
      ctx.save();
      ctx.translate(tx, ty);
      if (rot) ctx.rotate(rot);
      r(-tyL / 2, -tyH, tyL, tyH * 2, TYRE);
      r(-tyL / 2, -tyH, tyL, 0.9, '#4e515c');                        // 上面の照り
      r(-tyL / 2, tyH - 0.6, tyL, 0.6, '#0c0d10');                   // 下側の締まり
      if (gen >= 2) r(-1.1, -tyH + 0.5, 2.2, tyH * 2 - 1.0, '#5c606c');  // ホイール
      else r(-0.9, -tyH + 0.6, 1.8, tyH * 2 - 1.2, '#3d404a');
      ctx.restore();
    };
    tyre(rearAx, -trk, 0);  tyre(rearAx, trk, 0);
    tyre(frontAx, -trk, steer); tyre(frontAx, trk, steer);

    // ---- サスペンションアーム（車体とタイヤをつなぐ）----
    r(rearAx - 0.5, -trk + 1.4, 1.1, trk - 3.0, CARBON2);
    r(rearAx - 0.5, 1.6, 1.1, trk - 3.0, CARBON2);
    r(frontAx - 0.5, -trk + 1.4, 1.1, trk - 2.6, CARBON2);
    r(frontAx - 0.5, 1.2, 1.1, trk - 2.6, CARBON2);

    // ---- フロア／バージボード（第3世代以降）----
    if (gen >= 3) {
      r(rearAx, -podH - 0.8, frontAx - rearAx - 2, 0.8, CARBON2);
      r(rearAx, podH, frontAx - rearAx - 2, 0.8, CARBON2);
    }

    // ---- サイドポッド ----
    r(-5.5, -podH, 9.5, podH - 1.7, dark);
    r(-5.5, 1.7, 9.5, podH - 1.7, dark);
    r(-5.5, -podH, 9.5, 0.8, lite);                     // 上端の照り
    if (gen >= 2) {                                      // 冷却の吸気口
      r(3.4, -podH + 0.4, 1.3, podH - 2.1, CARBON);
      r(3.4, 1.7, 1.3, podH - 2.1, CARBON);
    }

    // ---- 車体 ----
    // 後ろへ向かって絞り込む（コークボトル）。段ごとに幅を変えて形を出す。
    const seg = (x0, x1, half, c) => {
      r(x0, -half, x1 - x0, half * 2, c);
      r(x0, -half, x1 - x0, Math.max(0.7, half * 0.42), lite);   // 光の当たる上面
      r(x0, half - Math.max(0.6, half * 0.34), x1 - x0, Math.max(0.6, half * 0.34), dark);
    };
    seg(rwX + 2.0, -6.0, 1.5, color);       // リアデッキ（いちばん細い）
    seg(-6.0, -1.8, 2.4, color);            // エンジンカバー（いちばん太い）
    seg(-1.8, 3.4, 2.0, color);             // コクピット
    seg(3.4, nose - 3.0, 1.3, color);       // ノーズ
    seg(nose - 3.0, nose, 0.85, color);     // 先端
    // 中央のストライプ。小さくてもチームを見分けやすくする
    r(rwX + 2.0, -0.45, nose - rwX - 2.0, 0.9, shade(color, 0.30));

    // ---- コクピットと乗員 ----
    r(-0.6, -1.4, 3.6, 2.8, CARBON);                    // 開口部
    r(0.2, -0.9, 2.0, 1.8, shade(color, 0.36));         // ヘルメット
    r(0.2, -0.9, 2.0, 0.7, '#f4f4f4');                  // ヘルメットの照り
    if (gen >= 5) {                                      // ハロ
      r(3.1, -1.9, 0.8, 3.8, '#61646e');
      r(-0.8, -2.0, 4.0, 0.7, '#61646e');
      r(-0.8, 1.3, 4.0, 0.7, '#61646e');
    }
    if (gen >= 4) r(rwX + 3, -0.4, 6.5, 0.9, '#eeeeee');  // エンジンカバーのフィン

    // ---- リアウイング ----
    r(rwX + 1.2, -1.8, 1.5, 3.6, '#2c2e34');            // ディフューザー
    r(rwX, -rwH, 2.6, rwH * 2, CARBON);
    r(rwX, -rwH, 2.6, 0.9, CARBON2);
    if (gen >= 1) {                                      // 翼端板
      r(rwX - 0.5, -rwH - 1.1, 3.8, 1.1, dark);
      r(rwX - 0.5, rwH, 3.8, 1.1, dark);
    }
    if (gen >= 4) r(rwX + 2.2, -rwH + 0.7, 1.0, rwH * 2 - 1.4, CARBON2);  // DRSの上段

    // ---- フロントウイング ----
    r(fwX, -fwH, 2.4, fwH * 2, CARBON);
    r(fwX, -fwH, 2.4, 0.9, CARBON2);
    if (gen >= 1) {
      r(fwX - 0.4, -fwH - 1.1, 3.2, 1.1, dark);          // 翼端板
      r(fwX - 0.4, fwH, 3.2, 1.1, dark);
    }
    if (gen >= 2) r(fwX + 1.9, -fwH + 0.9, 0.9, fwH * 2 - 1.8, CARBON2);  // 2段目

    // ---- ブレーキランプ ----
    if (!out && vel < 0.52) {
      const a = (0.55 + (0.52 - vel)).toFixed(2);
      r(rwX + 1.0, -1.4, 1.2, 2.8, 'rgba(255,60,40,' + a + ')');
      if (!standalone) GP.fx.addLight(function (lg) {
        lg.save(); camTransform(lg); lg.translate(x, y); lg.rotate(ang);
        lg.fillStyle = 'rgba(255,70,50,.95)';
        lg.fillRect(rwX + 1.0, -1.4, 1.2, 2.8);
        lg.restore();
      });
    }
    ctx.restore();

    if (isPlayer && !out) {
      // 自チームは矢印マーカー付き
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y) - 16);
      const bob = Math.sin(vt * 6) * 1.5;
      ctx.fillStyle = '#fff34d'; ctx.strokeStyle = '#4a2f1a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 8 + bob); ctx.lineTo(-5, 1 + bob); ctx.lineTo(5, 1 + bob); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- ピット作業 ----------
     実際の手順どおりに進める。
       0.00-0.18  車が停まり、ジャッキが入る
       0.18-0.45  ホイールガンでナットを外し、古いタイヤを引き抜く
       0.45-0.72  新しいタイヤを差し込んで締める
       0.72-0.90  ジャッキを下ろす
       0.90-1.00  ロリポップが上がり、発進を待つ
     クルーはチームカラーのつなぎを着ている。                        */
  function drawPitCrew(px, py, ang, e, prog, t, tyre) {
    const col = e.color;
    const dark = shade(col, -0.18);
    const SUIT = col, HELM = shade(col, 0.28), SKIN = '#e8b98e';
    const jackUp = prog > 0.16 && prog < 0.86;          // 車が持ち上がっている区間
    const off = prog < 0.45 ? Math.min(1, (prog - 0.18) / 0.27)     // 旧タイヤを外す進み
              : 0;
    const on = prog >= 0.45 && prog < 0.72 ? (prog - 0.45) / 0.27 : (prog >= 0.72 ? 1 : 0);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);

    // 持ち上がっているあいだは、車の下に隙間の影を落とす。
    // 車体そのものは drawCar が先に描いているので、ここで覆わないよう細くする。
    if (jackUp) {
      ctx.fillStyle = 'rgba(0,0,0,.34)';
      ctx.fillRect(-8, 2.6, 18, 1.8);
    }

    const person = (x, y, face, busy) => {
      const bob = busy ? Math.sin(t * 22 + x * 3 + y) * 0.9 : 0;
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x - 2.4, y + 2.6, 5, 1.6);
      ctx.fillStyle = dark;  ctx.fillRect(x - 2.4, y - 2.4 + bob, 5, 5.2);   // つなぎ
      ctx.fillStyle = SUIT;  ctx.fillRect(x - 2.4, y - 2.4 + bob, 5, 2.4);
      ctx.fillStyle = SKIN;  ctx.fillRect(x - 1, y + 0.4 + bob, 2, 1.4);     // 手
      ctx.fillStyle = HELM;  ctx.fillRect(x - 2, y - 4.6 + bob, 4.2, 2.4);   // ヘルメット
      ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(x - 2, y - 4.6 + bob, 4.2, 0.8);
      if (face) {                                                            // ホイールガン
        ctx.fillStyle = '#2b2e36';
        ctx.fillRect(x + face * 2.2, y - 0.6 + bob, 2.6 * face, 1.6);
        if (prog > 0.18 && prog < 0.72) {                                    // 回転の火花
          ctx.fillStyle = 'rgba(255,210,120,' + (0.4 + Math.random() * 0.5).toFixed(2) + ')';
          ctx.fillRect(x + face * 4.6, y - 1.4 + bob + Math.random() * 3, 1.2, 1.2);
        }
      }
    };

    // 4輪それぞれに、ガン担当とタイヤ担当が付く
    const CORNERS = [[7.4, -6.6, -1], [7.4, 6.6, -1], [-6.6, -6.6, 1], [-6.6, 6.6, 1]];
    CORNERS.forEach((c2, i) => {
      const [cx, cy, face] = c2;
      const sy = cy < 0 ? -1 : 1;
      // 外したタイヤを地面に置く／新品を運んでくる
      const tc = tyre ? (GP.data.TYRES[tyre] || {}).color : null;
      if (off > 0) {                                    // 外した古いタイヤ
        ctx.fillStyle = '#17181c';
        ctx.fillRect(cx - 2, cy + sy * (4 + off * 5), 4, 2.6);
      }
      if (on > 0 && on < 1) {                           // 運んでくる新品
        ctx.fillStyle = '#17181c';
        ctx.fillRect(cx - 2, cy + sy * (9 - on * 5), 4, 2.6);
        if (tc) { ctx.fillStyle = tc; ctx.fillRect(cx - 2, cy + sy * (9 - on * 5), 4, 0.9); }
      }
      person(cx, cy + sy * 4.4, face, prog > 0.18 && prog < 0.72);     // ガン担当
      person(cx + face * 3.4, cy + sy * 7.6, 0, prog < 0.72);          // タイヤ担当
    });

    // 前後のジャッキ担当
    ctx.fillStyle = '#3a3d46';
    if (jackUp) {
      ctx.fillRect(12.5, -1.6, 4.5, 3.2);      // 前ジャッキ
      ctx.fillRect(-13, -1.6, 4.5, 3.2);       // 後ジャッキ
    }
    person(16.5, 0, 0, false);
    person(-16, 0, 0, false);

    // ロリポップ（発進の合図）。最後に上がって緑になる
    const goSign = prog >= 0.9;
    ctx.save();
    ctx.translate(0, -12 - (goSign ? 5 : 0));
    ctx.fillStyle = '#6a6a72'; ctx.fillRect(-0.7, 0, 1.4, 9);
    ctx.fillStyle = goSign ? '#3fd44a' : '#e8402c';
    ctx.beginPath(); ctx.arc(0, -1.5, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.arc(-1, -2.6, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (goSign) {
      if (!standalone) GP.fx.addLight(function (lg) {
        lg.save(); camTransform(lg); lg.translate(px, py); lg.rotate(ang);
        lg.fillStyle = '#3fd44a';
        lg.beginPath(); lg.arc(0, -18.5, 3.4, 0, Math.PI * 2); lg.fill();
        lg.restore();
      });
    }
    ctx.restore();
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
    // セーフティカーが出ている間は、ずっと分かるようにしておく
    const badge = document.getElementById('rvBadge');
    if (badge) {
      const sc = res.safetyCar;
      const on = !!sc && lap >= sc.from && lap < sc.from + sc.laps;
      badge.textContent = sc && sc.virtual ? '🟡 VIRTUAL SC' : '🚨 SAFETY CAR';
      badge.className = 'rv-badge' + (on ? ' show' : '') + (sc && sc.virtual ? ' vsc' : '');
    }

    // 路面に乗ったゴム。走るほど乗り、雨で流れる
    const rb = document.getElementById('rvRubber');
    if (rb) {
      const rv = (res.rubberLog || [])[Math.max(0, lap - 1)];
      if (rv == null) { rb.innerHTML = ''; }
      else {
        const R = GP.data.RUBBER;
        const lv = (R.LEVELS || []).filter(x => rv < x.at)[0] || R.LEVELS[R.LEVELS.length - 1];
        rb.innerHTML = '<i class="rvw-h">ラバー</i>' +
          '<span class="rvrub" title="走るほどゴムが乗ってグリップが上がる。雨が降ると流れる" ' +
          'style="border-color:' + lv.color + '"><u style="width:' + Math.round(rv * 100) +
          '%;background:' + lv.color + '"></u></span>' +
          '<i class="rvw-h">' + lv.name + '</i>';
      }
    }

    /* ---- 空模様：過去・いま・この先 ----
       いま何が起きているかだけでなく、何周か前がどうだったか、
       この先どうなりそうかを並べる。この先は「％」で出るので、
       賭けに出るかどうかを自分で決められる                    */
    const fb = document.getElementById('rvFore');
    if (fb) {
      const wl2 = res.wetLog || [];
      const avgAt = l => {
        const a = wl2[Math.max(0, Math.min(wl2.length - 1, l - 1))];
        return a ? (a[0] + a[1] + a[2]) / 3 : 0;
      };
      const lvOf = v => (GP.data.WET_LEVELS || []).filter(x => v < x.at)[0] ||
                        (GP.data.WET_LEVELS || [])[0];
      const back = Math.max(1, lap - 4);
      const past = lvOf(avgAt(back)), now = lvOf(avgAt(lap));
      const f = (res.foreLog || [])[Math.max(0, lap - 1)];
      const wx = res.weather || {};
      const cell = (ttl, icon, name, cls, tip) =>
        '<i class="fc' + (cls || '') + '" title="' + rvEsc(tip || '') + '">' +
        '<u>' + ttl + '</u><b>' + icon + '</b><span>' + rvEsc(name) + '</span></i>';
      let h = cell('L' + back, '', past.name, ' past',
                   back + '周目の路面：' + past.name);
      h += cell('いま', wx.icon || '', now.name, ' now',
                '第' + lap + '周の路面：' + now.name);
      if (f) {
        const pc = Math.round(f.p * 100);
        const cls = pc >= 65 ? ' hi' : pc >= 35 ? ' mid' : ' lo';
        const when = f.in != null && f.p >= 0.35
          ? '約' + Math.max(1, f.in) + '周後' : 'この先';
        h += cell(when, f.to.icon, pc + '%', ' next' + cls,
          'この先 ' + f.to.name + ' になる見込み ' + pc + '%。' +
          '読みの力（ストラテジストと天気の設備）が高いほど、この数字は当たります');
      }
      fb.innerHTML = h;
    }

    // 路面の濡れ具合。セクターごとに違うので、そのまま3つ並べる
    const wb = document.getElementById('rvWet');
    if (wb) {
      const wl = (res.wetLog || [])[Math.max(0, lap - 1)];
      if (wl && Math.max(wl[0], wl[1], wl[2]) >= 0.08) {
        const lv = v => (GP.data.WET_LEVELS || []).find(x => v < x.at) ||
                        (GP.data.WET_LEVELS || [])[0];
        // いまの濡れ具合が、どのタイヤの担当なのかも一緒に出す。
        // 「ウェットと出ているのにインターのまま」が起きないように
        const avg = (wl[0] + wl[1] + wl[2]) / 3;
        const want = GP.data.TYRES.filter(t => t.key === lv(avg).tyre)[0];
        wb.innerHTML = '<i class="rvw-h">路面</i>' + wl.map((v, k) => {
          const l = lv(v);
          return '<i class="rvw" style="background:' + l.color + '" title="セクター' + (k + 1) +
            '：' + l.name + '（' + Math.round(v * 100) + '%）">S' + (k + 1) + ' ' + l.name + '</i>';
        }).join('') +
        (want ? '<i class="rvw want" style="background:' + want.color + ';color:' + want.text +
          '" title="いまの路面でいちばん速い銘柄">→ ' + want.name + '</i>' : '');
      } else { wb.innerHTML = ''; }
    }

    /* ---- 区間イエロー ----
       どの区間で旗が振られているか。出ていなければ何も置かない。
       ここが出ていないと、遅くなった理由も、
       その区間で仕掛けられない理由も分からない            */
    const yb = document.getElementById('rvYel');
    if (yb) {
      const now = (res.yellows || []).filter(y => lap >= y.from && lap < y.from + y.laps)[0];
      yb.innerHTML = now
        ? '<i class="rvy" title="' + String(now.why || '').replace(/[<>&"]/g, '') +
          'のため、この区間だけ速度を落として通ります。' +
          '追い越しはできません">🟨 S' + (now.sec + 1) + ' イエロー' +
          '<em>あと' + Math.max(1, now.from + now.laps - lap) + '周</em></i>'
        : '';
    }

    // いまピットウォールが出している指示。無線で言っていることと同じもの
    const ob = document.getElementById('rvOrders');
    if (ob) {
      const li = res.entries.filter(e => e.isPlayer && !e.out);
      ob.innerHTML = li.map(e => {
        if (e.dnf && vt >= (e.cum[e.dnfLap - 1] || 0)) return '';
        const l = lapInfo(e, vt).lap;
        const k = (e.lapOrder || [])[l - 1] || 'hold';
        const o = (GP.data.ORDERS || []).find(x => x.key === k) || { icon: '⚙️', name: '通常' };
        // いま、そのクルマがどれだけ際どいところに居るか（環境係数）
        const h = (e.lapHarsh || [])[l - 1] || 0;
        const lv = h >= 1.30 ? { c: 'bad',  t: '限界' }
                 : h >= 0.90 ? { c: 'warn', t: '際どい' }
                 : h >= 0.50 ? { c: 'mid',  t: '負担' } : null;
        return '<i class="rvo ' + k + '" title="' + (o.note || '') + '">' +
          o.icon + ' ' + e.driver.name.split('・')[0] + ' ' + o.name + '</i>' +
          (lv ? '<i class="rvo grip ' + lv.c + '" title="路面と銘柄のずれ・タイヤの残り・攻めの度合いから見た、いまの余裕">'
                + '🫱 ' + lv.t + '</i>' : '');
      }).join('');
    }

    const box = document.getElementById('rvOrder');
    let html = '';
    ord.forEach((o, i) => {
      const e = o.e;
      const pitting = !o.out && inPit(e, vt);
      // 先頭がこの位置を通過したのは何秒前か＝本当の意味での差
      const behind = i === 0 ? 0
                   : (o.fin && leader.fin) ? Math.max(0, o.fin - leader.fin)
                   : Math.max(0, vt - timeAt(leader.e, o.p));
      // 走った距離が1周ぶん以上離れていたら、秒ではなく周で言う
      const dn = i === 0 ? 0 : Math.max(0, Math.floor(leader.p - o.p + 1e-9));
      const gap = o.out ? 'DNF' : pitting ? 'PIT'
                : i === 0 ? '先頭'
                : dn > 0 ? '+' + dn + '周'
                : '-' + behind.toFixed(1) + 's';
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
    pumpRadio(false);
  }

  /* レース中の急変を、画面いっぱいの帯で数秒だけ知らせる */
  let flashTimer = 0;
  function flash(text, wet) {
    const el = document.getElementById('rvFlash');
    if (!el) return;
    el.textContent = text;
    el.className = 'rv-flash show' + (wet ? ' wet' : '');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.className = 'rv-flash' + (wet ? ' wet' : ''); }, 2600);
  }

  /* =========================================================
     チーム無線
     ピットとドライバーのやりとりを、会話らしく少し間を置いて出す
     ========================================================= */
  const rvEsc = t => String(t).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function pumpRadio(all) {
    const list = res.radio || [];
    const leadP = all ? Infinity : leaderProgress();
    while (shownRadio < list.length) {
      const r = list[shownRadio];
      if (!all) {
        // チェッカー後のやりとりは、その車がラインを通過してから。
        // 周回数から出したおおよそのラップで出すと、ファイナルラップの頭で
        // 「よくやった」が流れてしまう
        if (r.end) {
          const e = res.entries.filter(x => x.id === r.id)[0];
          const ft = e && e.cum.length ? e.cum[e.cum.length - 1] : duration;
          if (vt < ft) break;
        } else {
          // 無線は、その車がその周に入ってから流す
          const car = res.entries.filter(x => x.id === r.id)[0];
          if (!reachedLap(car, r.lap, leadP)) break;
        }
        radioQueue.push(r);
      }
      shownRadio++;
    }
    if (!all) drainRadio();
  }
  /* いま画面のその車が何周目を走っているか（小数） */
  function lapNowOf(id) {
    const c = res.entries.filter(x => x.id === id)[0];
    return c ? progress(c, vt).p + 1 : 0;
  }

  function drainRadio() {
    if (radioTimer || !radioQueue.length) return;
    // 溜まりすぎたら古いものは捨てる（早送り中に一気に流れないように）。
    // ただしスタート前のやりとりは、後ろの無線に押し出されないよう残す
    if (radioQueue.length > 6) {
      const keep = radioQueue.filter(r => r.lap === 0);
      radioQueue = keep.concat(radioQueue.filter(r => r.lap !== 0).slice(-6 + keep.length));
    }
    /* 無線が画面の周回からどれだけ遅れているか。
       「次の周でボックス」と言い終わる前に入ってしまうと、
       何の話だったのか分からなくなる。遅れているぶんは間を詰める   */
    const head = radioQueue[0];
    const behind = head && head.lap > 0 ? lapNowOf(head.id) - head.lap : 0;
    showRadio(radioQueue.shift());
    const wait = behind >= 1.2 ? 240
               : behind >= 0.55 ? 480
               : radioQueue.length >= 3 ? 640 : 1150;
    radioTimer = setTimeout(() => { radioTimer = 0; drainRadio(); }, wait);
  }
  function showRadio(r) {
    const box = document.getElementById('rvRadio');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'rvr ' + (r.from === 'pit' ? 'pit' : 'drv');
    d.innerHTML = '<b>' + (r.from === 'pit' ? '📻 ピット → ' + rvEsc(r.name)
                                            : '🗣️ ' + rvEsc(r.name)) + '</b>' +
                  '<span>' + rvEsc(r.text) + '</span>';
    box.appendChild(d);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    GP.sound.play('radio', 300);
    setTimeout(() => {
      d.className += ' out';
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 500);
    }, 5000);
  }
  function clearRadio() {
    clearTimeout(radioTimer); radioTimer = 0; radioQueue = [];
    const box = document.getElementById('rvRadio');
    if (box) box.innerHTML = '';
  }

  /* その出来事が、もう画面上で起きたか。
     以前は「基準ラップタイム × 周回数」で概算していたが、実際のラップは
     それより遅いので、実況が走っている車より先に出てしまっていた。
     出来事に車が紐づいていればその車の、なければ先頭の進み具合で見る   */
  function leaderProgress() {
    let best = 0;
    res.entries.forEach(e => {
      if (e.dnf && vt >= (e.cum[e.dnfLap - 1] || 0)) return;
      const pr = progress(e, vt);
      if (pr.p > best) best = pr.p;
    });
    return best;
  }
  function reachedLap(car, lap, leadP) {
    if (car && car.cum) return progress(car, vt).p >= lap - 1;
    return leadP >= lap - 1;
  }

  function flushEvents(all) {
    const leadP = all ? Infinity : leaderProgress();
    const log = document.getElementById('rvLog');
    while (shownEvents < res.events.length) {
      const ev = res.events[shownEvents];
      if (!all && !reachedLap(ev.car, ev.lap, leadP)) break;
      if (ev.type === 'weather' && res.weatherChange) {
        // 早送りでも、いまの天候はそろえておく
        wetNow = res.weatherChange.to === '雨' || res.weatherChange.to === '大雨';
      }
      if (!all) {
        if (ev.type === 'pass') GP.sound.play('pass', 140);
        else if (ev.type === 'pit') GP.sound.play('pit', 140);
        else if (ev.type === 'dnf') GP.sound.play('dnf', 300);
        else if (ev.type === 'sc') {
          const v = res.safetyCar && res.safetyCar.virtual;
          GP.sound.play('dnf', 260);
          flash(v ? '🟡 VIRTUAL SAFETY CAR' : '🚨 SAFETY CAR', false);
        }
        else if (ev.type === 'restart') {
          GP.sound.play('pass', 220);
          flash('🟢 レース再開！', false);
        }
        else if (ev.type === 'weather') {
          GP.sound.play('pit', 240);
          const wet = res.weatherChange && (res.weatherChange.to === '雨' || res.weatherChange.to === '大雨');
          wetNow = !!wet;
          flash((res.weatherChange ? res.weatherChange.icon + ' ' : '') + '天候が変わった！ '
                + (res.weatherChange ? res.weatherChange.to : ''), wet);
          const wl = document.getElementById('rvWeather');
          if (wl && res.weatherChange) wl.textContent = res.weatherChange.icon + ' ' + res.weatherChange.to;
        }
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
  let liveBestLap = Infinity;
  let timingAll = false;        // タイミングモニター（全車）を出しているか

  function buildSectorTimeline() {
    secTimeline = []; secPtr = 0;
    liveBest = [Infinity, Infinity, Infinity]; liveCar = {}; liveBestLap = Infinity;
    res.entries.forEach(e => {
      liveCar[e.id] = { best: [Infinity, Infinity, Infinity], cur: [null, null, null],
                        at: [0, 0, 0], lastLap: null, bestLap: null, lap: 0 };
      const laps = e.dnf && e.dnfLap > 0 ? e.dnfLap - 1 : e.sectors.length;
      for (let l = 0; l < laps; l++) {
        const sec = e.sectors[l];
        if (!sec) continue;
        const lapStart = l === 0 ? 0 : e.cum[l - 1];
        let acc = lapStart;
        for (let k = 0; k < 3; k++) {
          acc += sec[k];
          secTimeline.push({ t: acc, id: e.id, lap: l + 1, k: k, v: sec[k],
                             // 隊列で詰め直された周は、記録としては数えない
                             rec: !(e.noRec || [])[l],
                             lapTime: k === 2 ? e.lapTimes[l] : 0 });
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
      const rec = s.lap > 1 && s.rec !== false;
      if (rec) {
        if (s.v < c.best[s.k]) c.best[s.k] = s.v;
        if (s.v < liveBest[s.k]) liveBest[s.k] = s.v;
      }
      if (s.k === 2) {
        c.lastLap = s.lapTime;
        // 1周目はスタート進行ぶんが乗るので、ベストからは外す
        if (rec && (c.bestLap == null || s.lapTime < c.bestLap)) c.bestLap = s.lapTime;
        if (rec && s.lapTime < liveBestLap) liveBestLap = s.lapTime;
      }
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
    box.classList.toggle('board', timingAll);
    if (timingAll) return renderTimingBoard(box);
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

  /* ---------- タイミングモニター（全車）----------
     ピットウォールで見ている画面。全車のセクタータイム、いまの周、
     ベストラップ、前の車とのギャップを、そのまま並べる。          */
  /* いまの路面の濡れ具合（3セクターの平均）。タイヤが合っているかの判定に使う */
  function wetLevelAt(lap) {
    const wl = (res.wetLog || [])[Math.max(0, Math.min((res.wetLog || []).length - 1, lap - 1))];
    if (!wl) return 0;
    return (wl[0] + wl[1] + wl[2]) / 3;
  }
  /* モニターの一番上に、いまのコンディションを1行だけ置いておく。
     画面が低いと上のヘッダが送られて見えなくなるので、
     周回・天候・路面・ラバーだけはここでも読めるようにする      */
  function condStripHTML(lap) {
    const wx = res.weather || {};
    const wl = (res.wetLog || [])[Math.max(0, lap - 1)];
    const lv = v => (GP.data.WET_LEVELS || []).filter(x => v < x.at)[0] ||
                    (GP.data.WET_LEVELS || [])[0];
    let wet = '';
    if (wl && Math.max(wl[0], wl[1], wl[2]) >= 0.08) {
      wet = wl.map((v, k) => {
        const l = lv(v);
        return '<i class="tbw" style="background:' + l.color + '" title="セクター' + (k + 1) +
               '：' + l.name + '（' + Math.round(v * 100) + '%）">S' + (k + 1) + ' ' + l.name + '</i>';
      }).join('');
      const avg2 = (wl[0] + wl[1] + wl[2]) / 3;
      const w2 = GP.data.TYRES.filter(t => t.key === lv(avg2).tyre)[0];
      if (w2) wet += '<i class="tbw" style="background:' + w2.color + ';color:' + w2.text +
        '" title="いまの路面でいちばん速い銘柄">→ ' + w2.name + '</i>';
    } else {
      wet = '<i class="tbw dry">路面ドライ</i>';
    }
    let rub = '';
    const rv = (res.rubberLog || [])[Math.max(0, lap - 1)];
    if (rv != null) {
      const R = GP.data.RUBBER;
      const rl = (R.LEVELS || []).filter(x => rv < x.at)[0] || R.LEVELS[R.LEVELS.length - 1];
      rub = '<span class="tbrub" title="路面に乗ったゴム" style="border-color:' + rl.color + '">' +
            '<u style="width:' + Math.round(rv * 100) + '%;background:' + rl.color + '"></u></span>' +
            '<i class="tbh">' + rl.name + '</i>';
    }
    const sc = res.safetyCar;
    const scOn = !!sc && lap >= sc.from && lap < sc.from + sc.laps;
    return '<div class="tb-cond">' +
      '<b class="tbl">LAP ' + lap + ' / ' + res.laps + '</b>' +
      '<i class="tbh">' + (wx.icon || '') + ' ' + rvEsc(wx.name || '') + '</i>' +
      wet + rub +
      (scOn ? '<i class="tbsc">' + (sc.virtual ? '🟡 VSC' : '🚨 SC') + '</i>' : '') +
      '</div>';
  }

  /* ---- トラックリミットの回数 ----
     100 を足してあるのは「5秒の加算を抱えている」印。
     払うまでは、回数ではなくそちらを出す                  */
  function tlChip(e, lap) {
    if (!e.tlLap) return '';
    const i = Math.max(0, Math.min(res.laps, lap || 1) - 1);
    const v2 = e.tlLap[i];
    if (v2 == null) return '';
    if (v2 >= 100) return '<b class="tb-tl pen" title="5秒の加算を抱えている">⚖️5s</b>';
    if (!v2) return '';
    const TL = GP.data.TRACK_LIMITS;
    const near = v2 >= TL.strike - 1;
    return '<b class="tb-tl' + (near ? ' near' : '') +
      '" title="トラックリミット ' + v2 + '回（' + TL.strike + '回で ' + TL.sec + '秒）">🚧' + v2 + '</b>';
  }

  function renderTimingBoard(box) {
    const ord = orderAt(vt);
    const leader = ord[0];
    /* ---- 先頭との差 ----
       走っているあいだは「先頭が同じ地点を通った時刻」との差でよい。
       ただしゴールしたあとは、時計（vt）だけが進んでいくので、
       そのままだと着順が決まったあとも差が開きつづけてしまう。
       着いた車どうしは、着いた時刻の差で止めておく。            */
    const behind = ord.map((o, i) => {
      if (o.out) return null;
      if (i === 0) return 0;
      if (o.fin && leader.fin) return Math.max(0, o.fin - leader.fin);
      return Math.max(0, vt - timeAt(leader.e, o.p));
    });
    /* 何周遅れているか。1周以上離れたら、秒ではなく周で出す
       （実際の中継と同じで、そのほうが差の大きさが伝わる）

       周回カウンタどうしの引き算にしてはいけない。
       先頭がコントロールラインを通った瞬間、
       まだ通っていない車はみな「1周少ない」ことになるので、
       0.02周しか離れていない2位まで +1周 と出てしまう。
       数えるのは、あくまで走った距離の差のほう。            */
    const lapsDown = ord.map(o => Math.max(0, Math.floor(leader.p - o.p + 1e-9)));
    /* すぐ上のヘッダーが LAP・天気・路面・ゴムを出しているので、
       同じ帯をもう一段置かない。狭い画面では、そのぶん表が2行増える。
       濡れているときだけは、セクターごとの濡れ具合という
       ヘッダーに無いものが乗るので、そこは残す                   */
    const lapNow = Math.min(res.laps, Math.floor(leader.p) + 1);
    const wl0 = (res.wetLog || [])[Math.max(0, lapNow - 1)];
    const wetNow = wl0 && Math.max(wl0[0], wl0[1], wl0[2]) >= 0.08;
    let h = (wetNow ? condStripHTML(lapNow) : '') +
      '<div class="tb-row tb-head">' +
      '<span class="tb-p">P</span>' +
      '<span class="tb-nm"><i></i><b class="tb-tm">車</b><b class="tb-dv">選手</b>' +
      '<b class="tb-tl" title="トラックリミットの回数">🚧</b></span>' +
      '<span class="tb-lap">周</span><span class="tb-ty">タイヤ</span>' +
      '<span class="tb-g">前と</span><span class="tb-g">先頭と</span>' +
      '<span class="tb-br"></span>' +
      '<span class="tb-s">S1</span><span class="tb-s">S2</span><span class="tb-s">S3</span>' +
      '<span class="tb-t">ラップ</span><span class="tb-t">ベスト</span></div>';
    ord.forEach((o, i) => {
      const e = o.e;
      const c = liveCar[e.id] || { cur: [null, null, null], best: [Infinity, Infinity, Infinity],
                                   at: [0, 0, 0], lap: 0, lastLap: null, bestLap: null };
      const pitting = !o.out && inPit(e, vt);
      const li = lapInfo(e, vt);
      const ty = tyreNow(e, vt);
      let tychip = '<span class="tb-ty">–</span>';
      if (ty) {
        const td = GP.data.TYRES.filter(x => x.key === ty.key)[0] || GP.data.TYRES[1];
        const worn = ty.age > td.life ? ' worn' : ty.age > td.life * 0.7 ? ' old' : '';
        // 溝のないタイヤで濡れた路面に居る車は、ひと目で分かるようにする
        const dry = !td.wet && wetLevelAt(li.lap) > (GP.data.ENV || {}).dryWetFrom;
        const tp = tempNow(e, vt, td);
        /* 温度は細い帯で重ねる。銘柄の色を隠さずに、
           冷えているか・ちょうどか・熱すぎるかが一目で分かる     */
        const heat = tp
          ? '<i class="rv-heat" style="background:' + tp.tier.color +
            ';left:' + Math.round(tp.pos * 100) + '%"></i>'
          : '';
        const ttl = tp
          ? (tp.tempF != null
              ? 'フロント ' + tp.tempF + '℃／リア ' + tp.tempR + '℃' +
                '（作動域 ' + td.tLo + '〜' + td.tHi + '℃）\n' +
                (tp.axle ? tp.axle + 'が' : '') + tp.tier.name
              : 'タイヤ ' + tp.temp + '℃／' + tp.tier.name) +
            (tp.off < 0 ? '（作動域まで あと' + Math.round(-tp.off) + '℃）'
                        : tp.off > 0 ? '（作動域を ' + Math.round(tp.off) + '℃ 超過）' : '')
          : (dry ? '路面に対して溝がない。いつ失ってもおかしくない' : '');
        tychip = '<span class="tb-ty"><b class="rv-ty' + worn + (dry ? ' aqua' : '') +
          (tp ? ' has-heat ' + tp.tier.key : '') +
          '" style="background:' + td.color + ';color:' + td.text + '"' +
          (ttl ? ' title="' + rvEsc(ttl) + '"' : '') + '>' +
          td.short + '<em>' + ty.age + '</em>' + heat + '</b></span>';
      }
      const dLap = i === 0 ? 0 : Math.max(0, Math.floor(ord[i - 1].p - o.p + 1e-9));
      const gapA = (o.out || i === 0 || behind[i] == null || behind[i - 1] == null) ? '—'
                 : dLap > 0 ? '+' + dLap + '周'
                 : '+' + (behind[i] - behind[i - 1]).toFixed(1);
      const gapL = o.out ? 'DNF' : pitting ? 'PIT'
                 : i === 0 ? '先頭'
                 : lapsDown[i] > 0 ? '+' + lapsDown[i] + '周'
                 : '+' + behind[i].toFixed(1);
      let secs = '';
      for (let k = 0; k < 3; k++) {
        const v = c.cur[k];
        let cls = '';
        if (v != null && liveBest[k] !== Infinity) {
          if (v <= liveBest[k] + 1e-9) cls = ' purple';
          else if (c.best[k] !== Infinity && v <= c.best[k] + 1e-9) cls = ' green';
        }
        if (v != null && c.at[k] !== c.lap) cls += ' old';
        secs += '<span class="tb-s' + cls + '">' + fmtSec(v) + '</span>';
      }
      const bl = c.bestLap;
      const blCls = (bl != null && liveBestLap !== Infinity && bl <= liveBestLap + 1e-9) ? ' purple' : '';
      h += '<div class="tb-row' + (e.isPlayer ? ' me' : '') + (o.out ? ' out' : '') +
        (pitting ? ' pit' : '') + '">' +
        '<span class="tb-p">' + (i + 1) + '</span>' +
        '<span class="tb-nm" title="' + rvEsc(e.team.name + '／' + e.driver.name) + '">' +
          '<i style="background:' + e.color + '"></i>' +
          '<b class="tb-tm">' + rvEsc(GP.data.abbr3(e.team.name)) + '</b>' +
          '<b class="tb-dv">' + rvEsc(GP.data.abbr3(e.driver.name, true)) + '</b>' +
          tlChip(e, li.lap) + '</span>' +
        '<span class="tb-lap">' + Math.min(res.laps, li.lap) + '</span>' +
        tychip +
        '<span class="tb-g">' + gapA + '</span>' +
        '<span class="tb-g' + (i === 0 ? ' lead' : '') + '">' + gapL + '</span>' +
        '<span class="tb-br"></span>' + secs +
        '<span class="tb-t">' + fmtLap(c.lastLap) + '</span>' +
        '<span class="tb-t' + blCls + '">' + fmtLap(bl) + '</span></div>';
    });
    h += '<div class="tb-row tb-head"><span class="tb-p"></span>' +
      '<span class="tb-nm sess">セッション最速</span>' +
      '<span class="tb-lap"></span><span class="tb-ty"></span>' +
      '<span class="tb-g"></span><span class="tb-g"></span>' +
      '<span class="tb-br"></span>' +
      [0, 1, 2].map(k => '<span class="tb-s purple">' +
        (liveBest[k] === Infinity ? '--.---' : fmtSec(liveBest[k])) + '</span>').join('') +
      '<span class="tb-t"></span><span class="tb-t purple">' +
      (liveBestLap === Infinity ? '--:--.---' : fmtLap(liveBestLap)) + '</span></div>';
    box.innerHTML = h;
  }

  /* タイミングモニターの表示切り替え。止まっていても、すぐ描き直す */
  function setTiming(on) {
    timingAll = !!on;
    // 出しているあいだは順位パネルを畳む（モニターに順位も入っている）
    const wrap = document.querySelector('.rv-wrap');
    if (wrap) wrap.classList.toggle('timing', timingAll);
    advanceSectors(vt);
    renderSectors();
    return timingAll;
  }

  function finish() { if (onEnd) { const f = onEnd; onEnd = null; f(); } }

  /* ---------- 公開API ---------- */
  function start(canvas, result, endCb) {
    cv = canvas; ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    res = result; onEnd = endCb;
    poly = buildPoly(res.track.path, cv.width, cv.height, 34);
    pitFracCache = null;
    res.entries.forEach(e => { e._prof = e.prof; });
    buildSectorTimeline();
    trackArt = buildTrackArt();
    GP.fx.init(cv.width, cv.height);
    cam = { x: cv.width / 2, y: cv.height / 2, z: 1, tx: cv.width / 2, ty: cv.height / 2, tz: 1,
            mode: 'auto', focusId: null, label: '' };
    duration = Math.max(1, Math.max.apply(null, res.entries.map(e => e.cum[e.cum.length - 1])));
    vt = 0; shownEvents = 0; shownRadio = 0; lightBeeps = 0; running = true; lastTs = performance.now(); speed = DEFAULT_SPEED; lights = 0; chequer = 0;
    wetNow = res.weather.key === 'rain' || res.weather.key === 'storm';
    clearTimeout(flashTimer);
    const fl = document.getElementById('rvFlash'); if (fl) fl.className = 'rv-flash';
    const bd = document.getElementById('rvBadge'); if (bd) bd.className = 'rv-badge';
    document.getElementById('rvLog').innerHTML = '';
    clearRadio();
    raf = requestAnimationFrame(tick);
  }
  function setSpeed(s) { speed = s; }
  /* 実時間モード。レースの所要時間そのものを再生時間にする＝等速 */
  function setRealtime() { speed = duration; return duration; }
  function raceDuration() { return duration; }
  function skip() {
    running = false; lights = 1; chequer = 1;
    if (raf) cancelAnimationFrame(raf);
    vt = duration;
    draw(vt); updateHud(); flushEvents(true); pumpRadio(true); clearRadio(); finish();
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
  function stop() {
    running = false; if (raf) cancelAnimationFrame(raf); onEnd = null; clearRadio();
  }

  /* レース以外の画面でもマシンを描けるようにする。
     drawCar はこのモジュール内の ctx に描くので、一時的に差し替える。 */
  function paintCar(target, x, y, ang, color, gen, vel) {
    const keep = ctx;
    ctx = target; standalone = true;
    try { drawCar(x, y, ang, color, false, false, gen, vel == null ? 0.7 : vel, 0); }
    finally { ctx = keep; standalone = false; }
  }

  /* コース形状の平滑化をミニコース図と共有する */
  function smoothPath(path, w, h, pad) { return buildPoly(path, w, h, pad).pts; }

  return { start, setSpeed, setRealtime, raceDuration, skip, stop, setCamMode, setTiming, paintCar,
           _drawCar: drawCar, _drawPitCrew: drawPitCrew, _drawSafetyCar: drawSafetyCar };
})();

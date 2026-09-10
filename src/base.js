/* =========================================================
   チームの本拠地
   施設レベルで建物が実際に大きく・立派になり、
   ファン数とタイトル数で敷地の賑わいが変わる。
   ========================================================= */
window.GP = window.GP || {};

GP.base = (function () {
  'use strict';

  const W = 780, H = 340;

  /* ---------- 敷地は円（楕円）に組む ----------
     周回路をぐるりと1本通し、その外側に建物を並べる。
     真ん中は中庭。奥（画面の上）にある建物ほど小さく描くので、
     一枚の絵で見下ろしているように見える。
     ang は輪の上の角度（度）。0が右、90が手前、180が左、270が奥。 */
  const RING = { cx: 390, cy: 192, rx: 300, ry: 82, w: 22 };
  /* ---------- 輪の上を、見た目の距離で等間隔に割る ----------
     角度で等分すると、平たい楕円では左右の端に建物が固まってしまう。
     （端は角度が大きく動いても、画面上の距離はほとんど動かない）
     そこで周の長さで割り、どこを見ても同じ間隔に見えるようにする。 */
  function ringSpread(n, fromDeg, toDeg) {
    const STEP = 0.5;
    const pts = [];
    let len = 0, px = null, py = null;
    for (let d = fromDeg; d <= toDeg + 0.001; d += STEP) {
      const a = d * Math.PI / 180;
      const x = Math.cos(a) * RING.rx, y = Math.sin(a) * RING.ry;
      if (px !== null) len += Math.hypot(x - px, y - py);
      pts.push({ d: d, len: len });
      px = x; py = y;
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const want = len * (i + 0.5) / n;
      let j = 0;
      while (j < pts.length - 1 && pts[j].len < want) j++;
      out.push(((pts[j].d % 360) + 360) % 360);
    }
    return out;
  }
  /* 手前のまん中（90度）は正門なので空けておく。
     残りを周の長さで9等分し、そこへ順に建物を置く            */
  const PLOT_KEYS = [
    { key: 'market',  label: 'マーケ室' },
    { key: 'meeting', label: 'ミーティングルーム' },
    { key: 'pit',     label: 'ピット設備' },
    { key: 'factory', label: 'ファクトリー' },
    { key: 'depot',   label: '物流倉庫' },
    { key: 'mission', label: 'ミッションコントロール' },
    { key: 'tunnel',  label: '風洞' },
    { key: 'sim',     label: 'シミュレーター' },
    { key: 'youth',   label: 'ユース' }
  ];
  const PLOTS = (function () {
    const angs = ringSpread(PLOT_KEYS.length, 108, 432);
    return PLOT_KEYS.map((p, i) => ({ key: p.key, label: p.label, ang: angs[i] }));
  })();
  /* 輪の上の点。out は輪からどれだけ外へ出すか（建物は外側に建つ） */
  function ringAt(ang, out) {
    const a = ang * Math.PI / 180;
    const k = 1 + (out || 0);
    return { x: RING.cx + Math.cos(a) * RING.rx * k,
             y: RING.cy + Math.sin(a) * RING.ry * k, a: a };
  }
  /* 奥ほど小さく。手前ほど大きく（見下ろしの遠近） */
  function depthScale(y) {
    const t = (y - (RING.cy - RING.ry * 1.3)) / (RING.ry * 2.6);
    return 0.56 + Math.max(0, Math.min(1, t)) * 0.52;
  }
  /* その建物の立ち位置と縮尺（描画にも当たり判定にも使う） */
  function plotSpot(p, g2) {
    const q = ringAt(p.ang, 0.22);
    const sc = depthScale(q.y);
    const s2 = tierOf(g2.facilities[p.key] || 1);
    return { x: q.x - s2.w * sc / 2, y: q.y, sc: sc };
  }

  let hitBoxes = [];
  let dusk = false;          // HD-2Dスキンのときは夕景で描く
  let off = false;           // オフ期間（建物は閉まり、人が敷地に出ている）

  /* 歩ける範囲。建物の手前の敷地を左右に移動する。
     建物より奥へは行けないので、キャラは常に建物より手前に描けばよい。 */
  const WALK = { x0: 18, x1: W - 18, y0: 298, y1: 330 };

  /* 平常週に敷地へ出ている人の立ち位置。建物のあいだの空きに立たせる */
  const YARD_X = [40, 108, 176, 244, 312, 380, 448, 516, 584, 652];
  let yard = [];             // [{key,label,color,hair,face,hat,done}]
  function setYard(list) { yard = (list || []).slice(0, YARD_X.length); }

  /* オフ期間に敷地へ出ている人。x は立っている位置 */
  const OFF_SPOTS = [
    { key: 'off:drv0',    x: 50,  kind: 'person' },
    { key: 'off:drv1',    x: 122, kind: 'person' },
    { key: 'off:staff',   x: 194, kind: 'person' },
    { key: 'off:youth',   x: 266, kind: 'person' },
    { key: 'off:mgr',     x: 338, kind: 'person' },
    { key: 'off:test',    x: 412, kind: 'prop' },    // 合同テスト
    { key: 'off:plan',    x: 486, kind: 'prop' },    // 来季のマシン方針
    { key: 'off:sponsor', x: 560, kind: 'prop' },    // スポンサー交渉
    { key: 'off:scout',   x: 634, kind: 'prop' },    // 若手のスカウト
    { key: 'off:next',    x: 724, kind: 'gate' }     // 来季への出発
  ];

  /* その x に入口がある建物を返す（建物の真下に立つと入れる）*/
  function doorOf(x, y, g2) {
    // オフ期間は建物が閉まっていて、代わりに人が相手になる
    if (g2 && g2.offseason) {
      let best = null, bd = 1e9;
      OFF_SPOTS.forEach(s2 => {
        const d = Math.abs(x - s2.x);
        if (d < 24 && d < bd) { bd = d; best = { key: s2.key, x: s2.x }; }
      });
      return best;
    }
    let best = null, bd = 1e9;
    // 敷地に出ている人。手前寄りに立っているので、下側にいるときだけ拾う
    if (y > WALK.y0 + 20) {
      yard.forEach((q, i) => {
        const d = Math.abs(x - YARD_X[i]);
        if (d < 22 && d < bd) { bd = d; best = { key: q.key, x: YARD_X[i] }; }
      });
      if (best) return best;
    }
    PLOTS.forEach(p => {
      const sp = plotSpot(p, g2);
      const s = tierOf(g2.facilities[p.key] || 1);
      const cx = sp.x + s.w * sp.sc / 2;
      const d = Math.abs(x - cx);
      if (d < 22 && d < bd) { bd = d; best = { key: p.key, x: cx, y: sp.y }; }
    });
    return best;
  }

  /* 入口の位置（キャラをそこへ歩かせるのに使う）*/
  function doorPos(key, g2) {
    if (key && key.indexOf('off:') === 0) {
      const s2 = OFF_SPOTS.find(q => q.key === key);
      return s2 ? { x: s2.x, y: WALK.y1 - 6 } : null;
    }
    const yi = yard.findIndex(q => q.key === key);
    if (yi >= 0) return { x: YARD_X[yi], y: WALK.y1 - 6 };
    const p = PLOTS.find(q => q.key === key);
    if (!p) return null;
    const sp = plotSpot(g2 ? { key: key, ang: p.ang } : p, g2);
    const s = tierOf(g2.facilities[key] || 1);
    // 外からも使えるようにしておく（パドックやグリッドで共用する）
  return { x: sp.x + s.w * sp.sc / 2, y: WALK.y0 + 6 };
  }

  function clampWalk(x, y) {
    return { x: Math.max(WALK.x0, Math.min(WALK.x1, x)),
             y: Math.max(WALK.y0, Math.min(WALK.y1, y)) };
  }

  /* ---------- 歩く人 ----------
     チームプリンシパル（プレイヤー）。12×20くらいの大きさで、
     向き4方向 × 歩行3コマ。足の運びを左右で入れ替えて歩いて見せる。   */
  const ACTOR_SCALE = 1.4;      // 建物と並べたときに見える大きさ

  function drawActor(g, a) {
    const x = Math.round(a.x), y = Math.round(a.y);   // y は足元
    const dir = a.dir || 'down';
    const fr = a.moving ? (a.frame | 0) % 4 : 0;      // 0,1,2,3 → 立ち,右足,立ち,左足
    const step = fr === 1 ? 1 : (fr === 3 ? -1 : 0);
    const col = a.color || '#e04a3f';
    const mix = (hex, amt) => {
      const n = parseInt(hex.slice(1), 16);
      const c = v => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
      return 'rgb(' + c((n >> 16) & 255) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
    };
    const colD = mix(col, -0.16), colL = mix(col, 0.16);
    const SKIN = '#f0c49a', SKIN_D = '#d8a479', HAIR = '#3a2718';
    const r = (rx, ry, rw, rh, c) => { g.fillStyle = c; g.fillRect(x + rx, y + ry, rw, rh); };

    // 影（倍率をかける前の座標で描く）
    g.fillStyle = 'rgba(0,0,0,.32)';
    g.beginPath(); g.ellipse(x, y - 1, 6 * ACTOR_SCALE, 2.6 * ACTOR_SCALE, 0, 0, Math.PI * 2); g.fill();

    g.save();
    g.translate(x, y);
    g.scale(ACTOR_SCALE, ACTOR_SCALE);
    g.translate(-x, -y);

    // 脚（歩くと前後にずれる）
    r(-4, -7, 3, 7, '#2c3140');
    r(1, -7, 3, 7, '#2c3140');
    if (step) { r(-4, -7 + step, 3, 7, '#2c3140'); r(1, -7 - step, 3, 7, '#343a4c'); }
    r(-5, -1, 4, 2, '#1a1d26');            // 靴
    r(1, -1, 4, 2, '#1a1d26');

    // 胴（チームカラーのジャケット）
    r(-5, -16, 10, 9, colD);
    r(-4, -16, 8, 9, col);
    r(-4, -16, 8, 2, colL);                // 肩の照り
    r(-1, -15, 2, 8, mix(col, -0.28));     // 前合わせ
    // 腕
    const sw = a.moving ? step : 0;
    r(-6, -15 + sw, 2, 7, colD);
    r(4, -15 - sw, 2, 7, colD);
    r(-6, -9 + sw, 2, 2, SKIN);            // 手
    r(4, -9 - sw, 2, 2, SKIN);

    // 頭
    r(-4, -24, 8, 8, SKIN);
    r(2, -24, 2, 8, SKIN_D);               // 右側は影
    if (dir === 'up') {
      r(-4, -25, 8, 6, HAIR);              // 後ろ姿は髪だけ
    } else if (dir === 'left') {
      r(-4, -25, 8, 4, HAIR);
      r(-5, -24, 1, 4, HAIR);              // 顔の向きに合わせて髪を寄せる
      r(-3, -21, 2, 2, '#2a2028');         // 横顔の目
    } else if (dir === 'right') {
      r(-4, -25, 8, 4, HAIR);
      r(4, -24, 1, 4, HAIR);
      r(1, -21, 2, 2, '#2a2028');
    } else {
      r(-4, -25, 8, 4, HAIR);              // 前髪
      r(-4, -24, 1, 3, HAIR); r(3, -24, 1, 3, HAIR);
      r(-3, -21, 2, 2, '#2a2028');         // 目
      r(1, -21, 2, 2, '#2a2028');
      r(-1, -18, 2, 1, '#a8564a');         // 口
    }
    // 首元
    r(-2, -17, 4, 1, SKIN_D);
    g.restore();
  }



  /* レベルから建物の大きさと段階を決める */
  function tierOf(lv) {
    return { t: Math.min(4, Math.floor((lv - 1) / 2.5)), w: 40 + lv * 3.6, h: 26 + lv * 3.6 };
  }

  function seeded(n) {
    let h = (n * 2654435761) >>> 0;
    return function () { h = (h * 1103515245 + 12345) >>> 0; return h / 4294967296; };
  }

  /* ---------- 部品 ---------- */
  /* 建物の箱。輪郭・壁の陰影・屋根・地面際の締まりまでを一度に描く。
     ここを厚くすると、どの施設もまとめて立体的になる。               */
  function box(g, x, y, w, h, fill, top) {
    g.fillStyle = '#3a2413';                                  // 輪郭
    g.fillRect(x - 2, y - h - 2, w + 4, h + 4);
    g.fillStyle = fill;                                       // 壁
    g.fillRect(x, y - h, w, h);
    // 左から光が当たっている想定。左を明るく、右を暗く
    g.fillStyle = 'rgba(255,246,220,.18)';
    g.fillRect(x, y - h, Math.max(2, w * 0.26), h);
    g.fillStyle = 'rgba(40,24,10,.20)';
    g.fillRect(x + w - Math.max(2, w * 0.22), y - h, Math.max(2, w * 0.22), h);
    // 地面際は影で締める
    g.fillStyle = 'rgba(40,24,10,.30)';
    g.fillRect(x, y - 3, w, 3);
    // 屋根はチームカラーの帯。庇を少し張り出させて、縁に光を入れる
    const rh = Math.max(4, h * 0.20);
    g.fillStyle = top;
    g.fillRect(x, y - h, w, rh);
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.fillRect(x, y - h, w, 1.4);                             // 屋根の縁の照り
    g.fillStyle = 'rgba(40,24,10,.35)';
    g.fillRect(x, y - h + rh - 1.2, w, 1.2);                  // 帯の下の影
    g.fillStyle = '#3a2413';
    g.fillRect(x - 2.5, y - h - 2.5, w + 5, 2.5);             // 庇
    g.fillStyle = shadeHex(top, 0.22);
    g.fillRect(x - 2.5, y - h - 2.5, w + 5, 1.2);
  }

  /* 色を明るく／暗くする */
  function shadeHex(hex, amt) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return 'rgb(' + f((n >> 16) & 255) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }

  function windows(g, x, y, w, h, cols, rows, lit) {
    const mw = Math.max(4, (w - 8) / cols - 3), mh = Math.max(4, (h - 12) / rows - 3);
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const wx = x + 5 + c * (mw + 3), wy = y - h + 9 + r * (mh + 3);
      g.fillStyle = 'rgba(50,36,20,.55)';                     // 窓枠
      g.fillRect(wx - 1, wy - 1, mw + 2, mh + 2);
      // 日が落ちていれば、どの窓にも明かりが入る。ところどころ消しておく
      const on = (lit || dusk) && ((c * 3 + r * 5) % 7) !== 0;
      g.fillStyle = on ? 'rgba(255,238,170,.95)'
                       : (dusk ? 'rgba(70,86,110,.85)' : 'rgba(150,200,230,.85)');
      g.fillRect(wx, wy, mw, mh);
      g.fillStyle = on ? 'rgba(255,252,225,.85)' : 'rgba(255,255,255,.30)';
      g.fillRect(wx, wy, mw, Math.max(1, mh * 0.3));          // ガラスの照り
      g.fillStyle = 'rgba(255,255,255,.22)';                  // 窓台
      g.fillRect(wx - 1, wy + mh + 1, mw + 2, 1);
    }
  }

  function sign(g, x, y, text, color) {
    g.font = 'bold 9px sans-serif'; g.textAlign = 'center';
    const w = g.measureText(text).width + 10;
    // 端の施設でも文字が切れないよう、看板を画面内に収める
    x = Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, x));
    g.fillStyle = '#3a2413'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 13);
    g.fillStyle = color; g.fillRect(x - w / 2, y, w, 11);
    g.fillStyle = '#fff8e3'; g.fillText(text, x, y + 8);
  }

  /* ---------- 各施設 ---------- */
  function drawFactory(g, p, lv, color) {
    const s = tierOf(lv);
    box(g, p.x, p.y, s.w, s.h, '#cdb894', color);
    windows(g, p.x, p.y, s.w, s.h, Math.min(5, 2 + s.t), Math.min(3, 1 + Math.floor(s.t / 2)), false);
    // 煙突（レベルが上がるほど増える）
    const stacks = Math.min(4, Math.floor(lv / 2.2));
    for (let i = 0; i < stacks; i++) {
      const cx = p.x + 10 + i * 12;
      g.fillStyle = '#8f7a5c'; g.fillRect(cx, p.y - s.h - 14, 6, 14);
      g.fillStyle = '#e8e0cc';
      g.fillRect(cx + 1, p.y - s.h - 20, 4, 4);
      g.fillRect(cx + 2, p.y - s.h - 25, 5, 4);
    }
    // シャッター
    g.fillStyle = '#6d7078'; g.fillRect(p.x + s.w * 0.32, p.y - 16, s.w * 0.36, 16);
    for (let yy = p.y - 15; yy < p.y; yy += 3) { g.fillStyle = '#878b94'; g.fillRect(p.x + s.w * 0.32, yy, s.w * 0.36, 1); }
    return { x: p.x - 2, y: p.y - s.h - 2, w: s.w + 4, h: s.h + 4 };
  }

  function drawTunnel(g, p, lv, color) {
    const s = tierOf(lv);
    box(g, p.x, p.y, s.w, s.h * 0.8, '#b8c4cc', color);
    // 送風管
    const r = 9 + lv * 1.1;
    g.fillStyle = '#3a2413';
    g.beginPath(); g.arc(p.x + s.w + r - 4, p.y - s.h * 0.45, r + 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9aa6b0';
    g.beginPath(); g.arc(p.x + s.w + r - 4, p.y - s.h * 0.45, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6b7680';
    g.beginPath(); g.arc(p.x + s.w + r - 4, p.y - s.h * 0.45, r * 0.5, 0, Math.PI * 2); g.fill();
    // ファンの羽根
    g.strokeStyle = '#dfe6ec'; g.lineWidth = 2;
    for (let a = 0; a < 4; a++) {
      const t = a * Math.PI / 2 + lv * 0.3;
      g.beginPath();
      g.moveTo(p.x + s.w + r - 4, p.y - s.h * 0.45);
      g.lineTo(p.x + s.w + r - 4 + Math.cos(t) * r * 0.8, p.y - s.h * 0.45 + Math.sin(t) * r * 0.8);
      g.stroke();
    }
    windows(g, p.x, p.y, s.w, s.h * 0.8, 3, 1, false);
    return { x: p.x - 2, y: p.y - s.h * 0.8 - 2, w: s.w + r * 2 + 4, h: s.h * 0.8 + 4 };
  }

  function drawSim(g, p, lv, color) {
    const s = tierOf(lv);
    box(g, p.x, p.y, s.w, s.h, '#c4c0d4', color);
    // ドーム屋根
    g.fillStyle = '#3a2413';
    g.beginPath(); g.ellipse(p.x + s.w / 2, p.y - s.h, s.w / 2 + 2, 12 + lv, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#8f88b8';
    g.beginPath(); g.ellipse(p.x + s.w / 2, p.y - s.h, s.w / 2, 10 + lv, 0, Math.PI, 0); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath(); g.ellipse(p.x + s.w * 0.35, p.y - s.h - 3, s.w * 0.16, 4 + lv * 0.4, 0, Math.PI, 0); g.fill();
    // モニターの光
    windows(g, p.x, p.y, s.w, s.h, Math.min(4, 2 + s.t), 2, true);
    return { x: p.x - 2, y: p.y - s.h - 14 - lv, w: s.w + 4, h: s.h + 16 + lv };
  }

  function drawMarket(g, p, lv, color) {
    const s = tierOf(lv);
    const h = s.h * 1.15;
    box(g, p.x, p.y, s.w * 0.8, h, '#d8cbb0', color);
    windows(g, p.x, p.y, s.w * 0.8, h, 3, Math.min(4, 2 + s.t), true);
    // 看板（レベルで大きくなる）
    const bw = 20 + lv * 3.4, bh = 12 + lv * 1.6;
    g.fillStyle = '#3a2413'; g.fillRect(p.x - 2, p.y - h - bh - 8, bw + 4, bh + 4);
    g.fillStyle = color; g.fillRect(p.x, p.y - h - bh - 6, bw, bh);
    g.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 3; i++) g.fillRect(p.x + 4, p.y - h - bh - 2 + i * 4, bw - 8, 2);
    g.fillStyle = '#8f7a5c';
    g.fillRect(p.x + 3, p.y - h - 8, 3, 8); g.fillRect(p.x + bw - 6, p.y - h - 8, 3, 8);
    return { x: p.x - 2, y: p.y - h - bh - 10, w: s.w * 0.8 + 4, h: h + bh + 12 };
  }

  function drawPit(g, p, lv, color) {
    const s = tierOf(lv);
    const bays = Math.min(3, 1 + Math.floor(lv / 4));
    const bw = 22, w = bays * bw + 8;
    box(g, p.x, p.y, w, s.h * 0.72, '#c8c2b4', color);
    for (let i = 0; i < bays; i++) {
      const bx = p.x + 4 + i * bw;
      g.fillStyle = '#5f636b'; g.fillRect(bx + 2, p.y - s.h * 0.62, bw - 6, s.h * 0.62);
      g.fillStyle = '#7c828c';
      for (let yy = 0; yy < s.h * 0.62; yy += 3) g.fillRect(bx + 2, p.y - s.h * 0.62 + yy, bw - 6, 1);
      g.fillStyle = color; g.fillRect(bx + 2, p.y - s.h * 0.62, bw - 6, 3);
    }
    return { x: p.x - 2, y: p.y - s.h * 0.72 - 2, w: w + 4, h: s.h * 0.72 + 4 };
  }

  function drawYouth(g, p, lv, color) {
    const s = tierOf(lv);
    const w = s.w * 0.82, h = s.h * 0.9;
    box(g, p.x, p.y, w, h, '#e0d0a8', color);
    windows(g, p.x, p.y, w, h, 3, Math.min(3, 1 + Math.floor(lv / 4)), true);
    // 時計塔（レベルで伸びる）
    const th = 8 + lv * 1.8;
    g.fillStyle = '#3a2413'; g.fillRect(p.x + w / 2 - 7, p.y - h - th - 2, 14, th + 2);
    g.fillStyle = '#d8c8a0'; g.fillRect(p.x + w / 2 - 6, p.y - h - th, 12, th);
    g.fillStyle = color; g.fillRect(p.x + w / 2 - 7, p.y - h - th - 4, 14, 4);
    g.fillStyle = '#fff8e3';
    g.beginPath(); g.arc(p.x + w / 2, p.y - h - th * 0.55, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2413'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(p.x + w / 2, p.y - h - th * 0.55);
    g.lineTo(p.x + w / 2 + 2, p.y - h - th * 0.55 - 2); g.stroke();
    // 練習用カート（在籍する若手のぶん）
    const karts = Math.min(4, 1 + Math.floor(lv / 3));
    for (let i = 0; i < karts; i++) {
      const kx = p.x + 2 + i * 12, ky = p.y + 14;
      g.fillStyle = '#3a2413'; g.fillRect(kx - 1, ky - 1, 10, 7);
      g.fillStyle = ['#e04a3f', '#3a7ad9', '#4ea63f', '#f0a020'][i % 4];
      g.fillRect(kx, ky, 8, 5);
      g.fillStyle = '#1a1a1a'; g.fillRect(kx, ky + 4, 2, 2); g.fillRect(kx + 6, ky + 4, 2, 2);
    }
    return { x: p.x - 2, y: p.y - h - th - 6, w: w + 4, h: h + th + 8 };
  }

  /* ミッションコントロール：低い箱に、パラボラと大きな画面 */
  function drawMission(g, p, lv, color) {
    const s = tierOf(lv);
    const w = s.w * 0.86, h = s.h * 0.78;
    box(g, p.x, p.y, w, h, '#cfd4dc', color);
    // 正面の大画面（レベルで大きく、明るくなる）
    const sw = Math.min(w - 10, 16 + lv * 2.6), sh = Math.min(h - 8, 10 + lv * 1.5);
    g.fillStyle = '#1b2430'; g.fillRect(p.x + (w - sw) / 2, p.y - h + 5, sw, sh);
    g.fillStyle = 'rgba(120,200,255,' + (0.25 + lv * 0.06).toFixed(2) + ')';
    for (let i = 0; i < 3; i++) {
      g.fillRect(p.x + (w - sw) / 2 + 2, p.y - h + 7 + i * (sh / 3), sw - 4, Math.max(1, sh / 5));
    }
    // 屋根のパラボラ
    const dr = 5 + lv * 0.9;
    g.fillStyle = '#8f9aa6';
    g.fillRect(p.x + w - dr * 2 - 6, p.y - h - 4, 3, 6);
    g.beginPath();
    g.arc(p.x + w - dr - 5, p.y - h - dr - 3, dr, Math.PI * 0.15, Math.PI * 1.15);
    g.closePath(); g.fill();
    g.fillStyle = color; g.fillRect(p.x + w - dr - 6, p.y - h - dr - 4, 2, 2);
    // アンテナ塔
    const th = 6 + lv * 1.5;
    g.fillStyle = '#7c828e'; g.fillRect(p.x + 5, p.y - h - th, 2, th);
    g.fillStyle = '#e04a3f'; g.fillRect(p.x + 4, p.y - h - th - 3, 4, 3);
    return { x: p.x - 2, y: p.y - h - th - 6, w: w + 4, h: h + th + 8 };
  }

  /* 物流倉庫：横長の切妻屋根に、シャッターとコンテナ */
  function drawWarehouse(g, p, lv, color) {
    const s = tierOf(lv);
    const w = s.w * 1.02, h = s.h * 0.62;
    box(g, p.x, p.y, w, h, '#c6bfae', color);
    // シャッター（レベルで増える）
    const doors = Math.min(4, 1 + Math.floor(lv / 3));
    const dw = Math.min(16, (w - 8) / doors - 3);
    for (let i = 0; i < doors; i++) {
      const dx = p.x + 4 + i * (dw + 3);
      g.fillStyle = '#6b7078'; g.fillRect(dx, p.y - h * 0.72, dw, h * 0.72);
      g.fillStyle = '#858c96';
      for (let yy = 0; yy < h * 0.72; yy += 3) g.fillRect(dx, p.y - h * 0.72 + yy, dw, 1);
      g.fillStyle = color; g.fillRect(dx, p.y - h * 0.72, dw, 2);
    }
    // 積んであるコンテナ
    const cn = Math.min(5, Math.floor(lv / 2));
    for (let i = 0; i < cn; i++) {
      const cx = p.x + w + 3, cy = p.y - 7 - Math.floor(i / 2) * 8;
      const off2 = (i % 2) * 9;
      g.fillStyle = '#3a2413'; g.fillRect(cx + off2 - 1, cy - 1, 10, 8);
      g.fillStyle = ['#c85040', '#4070c0', '#50a050', '#d0a030'][i % 4];
      g.fillRect(cx + off2, cy, 8, 6);
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.fillRect(cx + off2 + 2, cy, 1, 6); g.fillRect(cx + off2 + 5, cy, 1, 6);
    }
    return { x: p.x - 2, y: p.y - h - 4, w: w + (cn ? 22 : 4), h: h + 6 };
  }

  /* ミーティングルーム：低い平屋。大きな窓が並び、
     中に長机とホワイトボードが見える。レベルが上がると窓が増え、
     屋根に小さな会議塔（ガラスの箱）が載る                        */
  function drawMeeting(g, p, lv, color) {
    const s = tierOf(lv);
    const w = s.w * 0.92, h = s.h * 0.56;
    box(g, p.x, p.y, w, h, '#d8cfc0', color);
    // 横に長い窓。中で人が向かい合っているのが透けて見える
    const n = Math.min(5, 2 + Math.floor(lv / 2.4));
    const gw = Math.min(15, (w - 10) / n - 3);
    for (let i = 0; i < n; i++) {
      const x = p.x + 5 + i * (gw + 3);
      g.fillStyle = '#3c4a58'; g.fillRect(x, p.y - h + 6, gw, h * 0.46);
      g.fillStyle = 'rgba(255,226,160,' + (0.30 + lv * 0.05).toFixed(2) + ')';
      g.fillRect(x + 1, p.y - h + 7, gw - 2, h * 0.46 - 2);
      // 机に向かう人影
      g.fillStyle = 'rgba(40,34,28,0.55)';
      g.fillRect(x + 2, p.y - h + 9 + h * 0.16, 2, 3);
      g.fillRect(x + gw - 5, p.y - h + 9 + h * 0.16, 2, 3);
      g.fillStyle = 'rgba(40,34,28,0.35)';
      g.fillRect(x + 1, p.y - h + 12 + h * 0.16, gw - 2, 1);
    }
    // 入口の庇
    g.fillStyle = color;
    g.fillRect(p.x + w * 0.42, p.y - 8, w * 0.20, 2);
    // 屋根の上のガラス会議室（レベルが上がると現れる）
    if (lv >= 4) {
      const cw = 10 + lv, ch = 5 + lv * 0.6;
      g.fillStyle = '#b9c6cf'; g.fillRect(p.x + w - cw - 6, p.y - h - ch, cw, ch);
      g.fillStyle = 'rgba(150,215,255,0.55)';
      g.fillRect(p.x + w - cw - 5, p.y - h - ch + 1, cw - 2, ch - 2);
      g.fillStyle = color; g.fillRect(p.x + w - cw - 6, p.y - h - ch - 2, cw, 2);
      return { x: p.x - 2, y: p.y - h - ch - 6, w: w + 4, h: h + ch + 8 };
    }
    return { x: p.x - 2, y: p.y - h - 4, w: w + 4, h: h + 6 };
  }

  const DRAW = { factory: drawFactory, tunnel: drawTunnel, sim: drawSim,
                 market: drawMarket, pit: drawPit, youth: drawYouth,
                 mission: drawMission, depot: drawWarehouse,
                 meeting: drawMeeting };

  /* ---------- 賑わい（ファン数・タイトル）---------- */
  function drawCrowd(g, fans, titles, color, rnd) {
    // 来場者。正面の広場と中庭に散らばる
    const people = Math.min(46, Math.floor(Math.log10(Math.max(10, fans)) * 12) - 8);
    for (let i = 0; i < people; i++) {
      const back = rnd() < 0.34;
      const x = 20 + rnd() * (W - 40);
      const y = back ? 148 + rnd() * 84 : 296 + rnd() * 40;
      g.fillStyle = ['#e04a3f', '#3a7ad9', '#4ea63f', '#f0a020', '#b06fd0'][Math.floor(rnd() * 5)];
      g.fillRect(x, y, 3, 4);
      g.fillStyle = '#f2c9a0'; g.fillRect(x, y - 3, 3, 3);
    }
    // トロフィー像。池のほとりに並べる
    for (let i = 0; i < Math.min(6, titles); i++) {
      const x = 352 + i * 22, y = 224;
      g.fillStyle = '#8f7a5c'; g.fillRect(x, y, 12, 8);
      g.fillStyle = '#f0c040'; g.fillRect(x + 3, y - 10, 6, 10);
      g.fillRect(x + 1, y - 13, 10, 3);
      g.fillStyle = '#fff0a0'; g.fillRect(x + 4, y - 9, 2, 7);
    }
  }

  /* ---------- 全体 ---------- */
  function layer() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return { c: c, g: g };
  }

  /* ---------- 背景のキャッシュ ----------
     人が歩くと毎フレーム描き直すことになるが、背景は変わらない。
     一度描いたものを取っておき、キャラだけを上に重ねる。            */
  let cache = null, cacheKey = '';

  function keyOf(g2, sel) {
    return [document.body.getAttribute('data-skin'), sel || '', g2.offseason ? 'off' : '',
            Math.floor(g2.fans), g2.season, g2.titles.teams, g2.titles.drivers, g2.color,
            PLOTS.map(p => g2.facilities[p.key]).join('-')].join('|');
  }

  /* 背景（キャラなし）を得る。中身が変わっていなければ作り直さない */
  function scene(g2, sel) {
    const k = keyOf(g2, sel);
    if (cache && cacheKey === k) return cache;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    render(c, g2, sel);
    cache = c; cacheKey = k;
    return cache;
  }

  function invalidate() { cache = null; cacheKey = ''; }

  /* 背景＋歩いている人を、表の画面へ描く */
  function drawWith(cv, g2, sel, actor) {
    const out = cv.getContext('2d');
    out.imageSmoothingEnabled = false;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.clearRect(0, 0, W, H);
    out.drawImage(scene(g2, sel), 0, 0);
    if (actor) drawActor(out, actor);
  }

  function render(cv, g2, sel) {
    dusk = document.body.getAttribute('data-skin') === 'hd';
    off = !!g2.offseason;
    const out = cv.getContext('2d');
    out.imageSmoothingEnabled = false;
    // 夕景では、いったん裏画面に描いてから光と色を乗せる
    if (dusk) GP.fx.init(W, H);
    const ctx = dusk ? GP.fx.begin() : out;
    ctx.imageSmoothingEnabled = false;
    hitBoxes = [];
    const D = GP.data;
    const rnd = seeded(Math.floor(g2.fans) + g2.season * 7 + g2.titles.teams * 13);

    // 芝（夕景では日が落ちた色にする）
    ctx.fillStyle = dusk ? '#2f4a2a' : '#8fbf62'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = dusk ? '#2a4325' : '#86b658';
    for (let y = 0; y < H; y += 8) for (let x = (y % 16 ? 0 : 4); x < W; x += 16) ctx.fillRect(x, y, 4, 4);
    // 奥の木立。幹・輪郭・本体・光の葉 の4層で、遠景でも立体に見せる
    for (let x = 4; x < W; x += 19) {
      const ty = 36 + Math.floor(rnd() * 10);
      const sc = 0.8 + rnd() * 0.55;
      const cw = Math.round(8 * sc), ch = Math.round(12 * sc);
      ctx.fillStyle = '#3a2712'; ctx.fillRect(x + 6, ty - 6, 3, 7);          // 幹
      ctx.fillStyle = '#5c421f'; ctx.fillRect(x + 6, ty - 6, 1.5, 7);
      const c0 = dusk ? '#0d2412' : '#173a1a';
      const c1 = dusk ? '#173a1e' : '#256026';
      const c2 = dusk ? '#1f4d27' : '#347a33';
      const c3 = dusk ? '#2a6033' : '#4e9b46';
      ctx.fillStyle = c0;                                                    // 輪郭
      ctx.fillRect(x + 7 - cw, ty - 5 - ch, cw * 2, ch);
      ctx.fillRect(x + 7 - cw * 0.6, ty - 8 - ch, cw * 1.2, 4);
      ctx.fillStyle = c1;                                                    // 本体
      ctx.fillRect(x + 8 - cw, ty - 4 - ch, cw * 2 - 2, ch - 1);
      ctx.fillRect(x + 8 - cw * 0.6, ty - 7 - ch, cw * 1.1, 3.5);
      ctx.fillStyle = c2;                                                    // 中間
      ctx.fillRect(x + 8 - cw, ty - 3.5 - ch, cw * 1.1, ch * 0.5);
      ctx.fillStyle = c3;                                                    // 光の葉
      ctx.fillRect(x + 8.5 - cw, ty - 3 - ch, cw * 0.6, ch * 0.28);
      ctx.fillRect(x + 8 - cw * 0.5, ty - 6.5 - ch, cw * 0.5, 2.4);
    }
    /* ---- 敷地（円形のキャンパス）----
       周回路を1本ぐるりと通し、その外側に建物を並べる。
       真ん中は中庭。奥（画面の上）にある建物ほど小さく描くので、
       一枚の絵で見下ろしているように見える。                */
    const ell = (ex, ey, rx, ry, fill) => {
      ctx.fillStyle = fill; ctx.beginPath();
      ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    };

    // 外周の生垣とフェンス
    ctx.fillStyle = dusk ? '#1d3320' : '#4e7a34'; ctx.fillRect(0, 46, W, 9);
    ctx.fillStyle = dusk ? '#26402a' : '#5e8f3e';
    for (let x = 0; x < W; x += 12) ctx.fillRect(x, 46, 7, 4);
    ctx.fillStyle = dusk ? '#3a3442' : '#7a6a52';
    for (let x = 5; x < W; x += 11) ctx.fillRect(x, 48, 2, 9);

    // 敷地の芝
    ctx.fillStyle = dusk ? '#2a4527' : '#83b95a'; ctx.fillRect(0, 55, W, H - 55);
    ctx.fillStyle = dusk ? '#264022' : '#7bb052';
    for (let y = 58; y < H; y += 8) for (let x = (y % 16 ? 0 : 4); x < W; x += 16) ctx.fillRect(x, y, 4, 4);

    // 建物が建つ帯（輪の外側の舗装）
    ell(RING.cx, RING.cy, RING.rx * 1.38, RING.ry * 1.42, dusk ? '#463f4c' : '#b0a898');
    ell(RING.cx, RING.cy, RING.rx * 1.30, RING.ry * 1.32, dusk ? '#4a4450' : '#b8b0a0');

    // 周回路
    ctx.strokeStyle = dusk ? '#22242c' : '#5b5e66';
    ctx.lineWidth = RING.w + 5;
    ctx.beginPath(); ctx.ellipse(RING.cx, RING.cy, RING.rx, RING.ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = dusk ? '#2f313a' : '#6d7078';
    ctx.lineWidth = RING.w;
    ctx.beginPath(); ctx.ellipse(RING.cx, RING.cy, RING.rx, RING.ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.50)';
    ctx.lineWidth = 2.4; ctx.setLineDash([9, 13]);
    ctx.beginPath(); ctx.ellipse(RING.cx, RING.cy, RING.rx, RING.ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // 中庭（輪の内側）
    ell(RING.cx, RING.cy, RING.rx - RING.w * 0.7, RING.ry - RING.w * 0.7,
        dusk ? '#264022' : '#7fb457');

    /* ---- 正門と引き込み路 ----
       手前のまん中で輪とつながる。遠征のトラックはここから出ていく */
    const gate = ringAt(90, 0);
    ctx.fillStyle = dusk ? '#2f313a' : '#6d7078';
    ctx.fillRect(gate.x - 22, gate.y - 4, 44, H - gate.y + 4);
    ctx.fillStyle = 'rgba(255,255,255,.50)';
    for (let y = gate.y + 12; y < H; y += 18) ctx.fillRect(gate.x - 2, y, 4, 9);
    ctx.fillStyle = dusk ? '#4a4250' : '#8a8578';
    ctx.fillRect(gate.x - 28, H - 46, 4, 18); ctx.fillRect(gate.x + 24, H - 46, 4, 18);
    ctx.fillStyle = '#e8e2d4'; ctx.fillRect(gate.x - 24, H - 41, 48, 4);
    ctx.fillStyle = '#c8503f';
    for (let x = gate.x - 22; x < gate.x + 20; x += 13) ctx.fillRect(x, H - 41, 6, 4);

    /* ---- 中庭の池 ---- */
    const pond = (cx2, cy2, rx2, ry2) => {
      ell(cx2, cy2, rx2 + 9, ry2 + 7, dusk ? '#1d3320' : '#6da247');
      ell(cx2, cy2, rx2 + 5, ry2 + 4, dusk ? '#3c3742' : '#a89e8c');
      ell(cx2, cy2, rx2, ry2, dusk ? '#0e2a3c' : '#2f6a97');
      ell(cx2, cy2 - ry2 * 0.16, rx2 * 0.9, ry2 * 0.6, dusk ? '#173d55' : '#3f86b8');
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      for (let i = 0; i < 4; i++) {
        const lw = rx2 * (0.46 - i * 0.07);
        ctx.fillRect(cx2 - lw / 2 + (i % 2 ? 6 : -5), cy2 - ry2 * 0.4 + i * 5, lw, 1.5);
      }
    };
    pond(RING.cx + 78, RING.cy + 2, 52, 19);

    /* ---- 中庭の駐車場 ---- */
    const CARC = ['#c8503f', '#3a6fb0', '#e0e0e0', '#4f5560', '#4e9b46', '#d8a832', '#7a5a9a'];
    const parkRow = (px, py2, cols, fill) => {
      const pw = cols * 17 + 4;
      ctx.fillStyle = dusk ? '#3f3947' : '#9d9687'; ctx.fillRect(px, py2 - 15, pw, 18);
      ctx.fillStyle = dusk ? 'rgba(230,224,200,.14)' : 'rgba(255,255,255,.34)';
      for (let i = 0; i <= cols; i++) ctx.fillRect(px + 2 + i * 17, py2 - 15, 1, 18);
      for (let i = 0; i < cols; i++) {
        if (rnd() > fill) continue;
        const x = px + 4 + i * 17;
        const c = CARC[Math.floor(rnd() * CARC.length)];
        ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x - 1, py2 - 1, 16, 3);
        ctx.fillStyle = shadeHex(c, -0.16); ctx.fillRect(x, py2 - 12, 14, 12);
        ctx.fillStyle = c;                  ctx.fillRect(x, py2 - 12, 14, 5);
        ctx.fillStyle = dusk ? 'rgba(120,150,180,.75)' : 'rgba(190,220,240,.88)';
        ctx.fillRect(x + 2, py2 - 10, 10, 3);
        ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x, py2 - 12, 14, 1);
        ctx.fillStyle = '#15161a';
        ctx.fillRect(x + 1, py2 - 2, 3, 2); ctx.fillRect(x + 10, py2 - 2, 3, 2);
      }
    };
    const parkFill = Math.min(0.92, 0.22 + g2.fans / 11000);
    parkRow(RING.cx - 250, RING.cy - 18, 9, parkFill);
    parkRow(RING.cx - 250, RING.cy + 10, 9, parkFill * 0.85);
    parkRow(RING.cx - 250, RING.cy + 38, 9, parkFill * 0.7);

    // ヘリポート（中庭の左寄り）
    const heli = (hx, hy, r2) => {
      ell(hx, hy, r2, r2 * 0.5, dusk ? '#3c3742' : '#a89e8c');
      ctx.strokeStyle = dusk ? 'rgba(230,224,200,.55)' : 'rgba(255,255,255,.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(hx, hy, r2 - 4, r2 * 0.5 - 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = dusk ? 'rgba(230,224,200,.75)' : 'rgba(255,255,255,.95)';
      ctx.fillRect(hx - 6, hy - 5, 3, 10); ctx.fillRect(hx + 3, hy - 5, 3, 10);
      ctx.fillRect(hx - 4, hy - 1.5, 8, 3);
    };
    heli(RING.cx - 74, RING.cy - 44, 20);

    // 入口の旗ざお
    for (let i = 0; i < 3; i++) {
      const fx = RING.cx - 14 + i * 10;
      ctx.fillStyle = dusk ? '#4a4250' : '#8a8578'; ctx.fillRect(fx, RING.cy + 28, 2, 28);
      ctx.fillStyle = i === 1 ? g2.color : shadeHex(g2.color, i ? 0.18 : -0.14);
      ctx.fillRect(fx + 2, RING.cy + 28, 9, 7);
      ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(fx + 2, RING.cy + 29, 8, 1.5);
    }

    /* ---- 正面の広場（輪の手前）---- */
    const GY = 336;
    const tyreStack = (tx, ty, n) => {
      for (let i = 0; i < n; i++) {
        const yy = ty - i * 5;
        ctx.fillStyle = '#15161a'; ctx.fillRect(tx - 8, yy - 5, 16, 6);
        ctx.fillStyle = i % 2 ? '#2a2c33' : '#22242a'; ctx.fillRect(tx - 8, yy - 5, 16, 2);
      }
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(tx - 8, ty - n * 5 - 5, 16, 1);
    };
    const pitLv = g2.facilities.pit || 1;
    tyreStack(74, GY, Math.min(7, 3 + Math.floor(pitLv / 2.5)));
    tyreStack(92, GY, Math.min(5, 2 + Math.floor(pitLv / 3.5)));
    tyreStack(620, GY - 2, 2);

    const crate = (cx2, cy2, cw, ch2, c) => {
      ctx.fillStyle = '#2a2015'; ctx.fillRect(cx2 - 1, cy2 - ch2 - 1, cw + 2, ch2 + 2);
      ctx.fillStyle = c; ctx.fillRect(cx2, cy2 - ch2, cw, ch2);
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(cx2, cy2 - ch2, cw, 2);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(cx2, cy2 - 3, cw, 3);
    };
    const depLv = g2.facilities.depot || 1;
    crate(136, GY, 22, 13, g2.color);
    crate(206, GY, 16, 10, '#6a7078');
    crate(478, GY, 20, 12, '#6a7078');
    if (depLv >= 3) crate(502, GY, 14, 9, g2.color);
    if (depLv >= 5) crate(546, GY, 12, 15, '#6a7078');

    const drum = (dx, dy, c) => {
      ctx.fillStyle = '#2a2015'; ctx.fillRect(dx - 1, dy - 13, 10, 13);
      ctx.fillStyle = c; ctx.fillRect(dx, dy - 12, 8, 12);
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(dx, dy - 12, 8, 2);
      ctx.fillStyle = 'rgba(0,0,0,.20)';
      ctx.fillRect(dx, dy - 8, 8, 1); ctx.fillRect(dx, dy - 5, 8, 1);
    };
    drum(276, GY, '#c05a30'); drum(287, GY, '#4a6f9a');

    /* ---- チームのトランスポーター ---- */
    const hauler = (hx, hy, c, len) => {
      const bh = 20, top = hy - 6 - bh;
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(hx - 2, hy - 1, len + 20, 3);
      ctx.fillStyle = '#2a2015'; ctx.fillRect(hx - 1, top - 1, len + 2, bh + 2);
      ctx.fillStyle = c;         ctx.fillRect(hx, top, len, bh);
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(hx, top, len, 3);
      ctx.fillStyle = 'rgba(0,0,0,.20)';       ctx.fillRect(hx, top + bh - 5, len, 5);
      ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.fillRect(hx + 3, top + 7, len - 6, 4);
      const cx2 = hx + len + 1, ctop = hy - 21;
      ctx.fillStyle = '#2a2015'; ctx.fillRect(cx2 - 1, ctop - 1, 16, 16);
      ctx.fillStyle = shadeHex(c, -0.12); ctx.fillRect(cx2, ctop, 14, 15);
      ctx.fillStyle = dusk ? 'rgba(255,238,170,.90)' : 'rgba(150,200,230,.90)';
      ctx.fillRect(cx2 + 7, ctop + 2, 6, 6);
      ctx.fillStyle = '#ffe9a8'; ctx.fillRect(cx2 + 13, ctop + 11, 2, 3);
      [hx + 7, hx + 17, hx + len - 18, hx + len - 8, cx2 + 8].forEach(wx => {
        ctx.fillStyle = '#15161a'; ctx.fillRect(wx - 4, hy - 6, 8, 6);
        ctx.fillStyle = '#4a4d55'; ctx.fillRect(wx - 2, hy - 4, 4, 2);
      });
    };
    const hlen = 44 + Math.min(3, Math.floor(depLv / 2.5)) * 8;
    hauler(W - 18 - hlen - 16, GY, g2.color, hlen);

    // 照明塔。輪のまわりに立てる
    const lamp = (lx, ly, h2) => {
      ctx.fillStyle = dusk ? '#3a3442' : '#7d786c'; ctx.fillRect(lx, ly - h2, 3, h2);
      ctx.fillStyle = dusk ? '#4a4250' : '#5a5448'; ctx.fillRect(lx - 5, ly - h2 - 5, 13, 5);
      ctx.fillStyle = dusk ? 'rgba(255,238,170,.95)' : 'rgba(255,255,240,.85)';
      ctx.fillRect(lx - 4, ly - h2 - 4, 11, 3);
      if (dusk) {
        const gr = ctx.createLinearGradient(lx - 20, 0, lx + 23, 0);
        gr.addColorStop(0, 'rgba(255,236,170,0)');
        gr.addColorStop(0.5, 'rgba(255,236,170,.15)');
        gr.addColorStop(1, 'rgba(255,236,170,0)');
        ctx.fillStyle = gr; ctx.fillRect(lx - 20, ly - h2, 43, h2 + 30);
      }
    };
    [30, 150, 340].forEach(ang2 => {
      const q = ringAt(ang2, 0.10);
      lamp(q.x, q.y, 22 + depthScale(q.y) * 14);
    });

    // 建物より手前は別レイヤーに描く。シルエットから影を作りたいので
    const bl = dusk ? layer() : null;
    const bg = bl ? bl.g : ctx;

    /* ---- 建物（輪の外側にぐるりと）----
       奥にあるものほど小さく描く。同じ絵のまま縮めるだけで、
       見下ろしている一枚の絵として奥行きが出る。
       奥から手前へ順に描くので、手前の建物が奥を隠す。         */
    const signs = [];
    PLOTS.map(p => ({ p: p, sp: plotSpot(p, g2) }))
         .sort((a2, b2) => a2.sp.y - b2.sp.y)
         .forEach((it, pi) => {
      const p = it.p, sc = it.sp.sc;
      const lv = g2.facilities[p.key] || 1;
      // 足元の舗装。輪の外側に、建物ぶんだけ面を作る
      const s3 = tierOf(lv);
      bg.fillStyle = dusk ? '#3c3742' : '#a89e8c';
      bg.beginPath();
      bg.ellipse(it.sp.x + s3.w * sc / 2, it.sp.y - 1, s3.w * sc * 0.72, 7 * sc, 0, 0, Math.PI * 2);
      bg.fill();
      // 縮めた座標系で描き、当たり判定は元の縮尺へ戻す
      bg.save(); bg.scale(sc, sc);
      const raw = DRAW[p.key](bg, { key: p.key, x: it.sp.x / sc, y: it.sp.y / sc, label: p.label },
                              lv, g2.color);
      bg.restore();
      const bb = { x: raw.x * sc, y: raw.y * sc, w: raw.w * sc, h: raw.h * sc };
      hitBoxes.push({ key: p.key, x: bb.x, y: bb.y, w: bb.w, h: bb.h });
      if (sel === p.key) {
        bg.strokeStyle = '#fff34d'; bg.lineWidth = 3;
        bg.setLineDash([5, 4]);
        bg.strokeRect(bb.x - 3, bb.y - 3, bb.w + 6, bb.h + 6);
        bg.setLineDash([]);
      }
      // 看板は建物の上。隣とぶつからないよう一段ずつずらす
      signs.push({ x: bb.x + bb.w / 2, y: Math.max(2, bb.y - 14 - (pi % 2) * 12),
                   text: p.label + ' Lv.' + lv, sel: sel === p.key });
    });
    signs.forEach(sg => sign(bg, sg.x, sg.y, sg.text, sg.sel ? '#e04a3f' : '#4a2f1a'));

    drawCrowd(bg, g2.fans, g2.titles.teams + g2.titles.drivers, g2.color, rnd);

    // ---- 平常週に敷地へ出ている人 ----
    if (!off && yard.length) {
      const py = WALK.y1 - 2;
      yard.forEach((q, i) => {
        const x = YARD_X[i];
        if (q.prop === 'brief') { briefStand(bg, x, py, q.color, q.done); }
        else person(bg, x, py, q.color, q.hair || '#2b1d12', q.face || '#eec49a', q.hat, q.done);
        hitBoxes.push({ key: q.key, x: x - 14, y: py - 34, w: 28, h: 36 });
        // 名札を全員ぶん出すと建物が隠れてしまう。
        // 名前は下のタイルに並んでいるので、ここでは選んだ人だけ出す
        if (sel === q.key) sign(bg, x, py - 42, q.label, '#e04a3f');
      });
    }

    /* ---- オフ期間 ----
       建物は閉まっていて、人が敷地に出ている。歩いて話しかけて回る。 */
    if (off) {
      // オフ期間は建物に入れないので、建物の当たり判定は捨てて人に差し替える
      hitBoxes = [];
      const py = WALK.y1 - 4;
      const stand = (x, suit, hair, faceC, hat) => {
        bg.fillStyle = 'rgba(0,0,0,.30)';
        bg.beginPath(); bg.ellipse(x, py, 7, 2.6, 0, 0, Math.PI * 2); bg.fill();
        bg.fillStyle = shadeHex(suit, -0.20); bg.fillRect(x - 5, py - 21, 10, 21);
        bg.fillStyle = suit;                  bg.fillRect(x - 5, py - 21, 10, 8);
        bg.fillStyle = 'rgba(255,255,255,.24)'; bg.fillRect(x - 5, py - 21, 10, 2);
        bg.fillStyle = '#2c3140'; bg.fillRect(x - 5, py - 9, 4, 9);
        bg.fillRect(x + 1, py - 9, 4, 9);
        bg.fillStyle = faceC; bg.fillRect(x - 4, py - 29, 8, 8);
        bg.fillStyle = hair;  bg.fillRect(x - 4, py - 30, 8, 4);
        bg.fillStyle = '#2a2028'; bg.fillRect(x - 3, py - 26, 2, 2);
        bg.fillRect(x + 1, py - 26, 2, 2);
        if (hat) { bg.fillStyle = hat; bg.fillRect(x - 5, py - 31, 10, 3); }
      };
      const names = [];
      const box = (i) => hitBoxes.push({ key: OFF_SPOTS[i].key,
        x: OFF_SPOTS[i].x - 14, y: py - 34, w: 28, h: 36 });
      (g2.drivers || []).slice(0, 2).forEach((d, i) => {
        stand(OFF_SPOTS[i].x, g2.color, '#3a2718', '#f0c49a', null);
        names.push([OFF_SPOTS[i].x, d.name]);
        box(i);
      });
      stand(OFF_SPOTS[2].x, '#5a6270', '#2b1d12', '#e8bd94', null);           // スタッフ
      names.push([OFF_SPOTS[2].x, 'スタッフのみんな']); box(2);
      stand(OFF_SPOTS[3].x, '#3f8a4a', '#4a3018', '#f2cba4', '#e8c24a');      // ユース
      names.push([OFF_SPOTS[3].x, '下部組織の若手']); box(3);
      stand(OFF_SPOTS[4].x, '#3a3f52', '#241c14', '#e2b48e', null);           // 首脳陣
      names.push([OFF_SPOTS[4].x, '首脳陣']); box(4);

      // ---- オフにしかできないこと ----
      // 合同テスト：テスト用のマシンが1台停まっている
      (function () {
        const x = OFF_SPOTS[5].x, y = py;
        bg.fillStyle = 'rgba(0,0,0,.30)'; bg.fillRect(x - 15, y - 4, 30, 4);
        bg.fillStyle = shadeHex(g2.color, -0.20); bg.fillRect(x - 15, y - 14, 30, 10);
        bg.fillStyle = g2.color; bg.fillRect(x - 13, y - 14, 26, 7);
        bg.fillStyle = 'rgba(255,255,255,.30)'; bg.fillRect(x - 13, y - 14, 26, 2);
        bg.fillStyle = '#17181c';
        bg.fillRect(x - 14, y - 8, 7, 5); bg.fillRect(x + 7, y - 8, 7, 5);
        bg.fillStyle = '#2b2e36'; bg.fillRect(x - 18, y - 12, 4, 3);
        bg.fillRect(x + 14, y - 13, 5, 4);
        // 計測用のパイロン
        bg.fillStyle = '#e88a2a'; bg.fillRect(x - 24, y - 5, 4, 5);
        bg.fillRect(x + 20, y - 5, 4, 5);
        names.push([x, '合同テスト']); box(5);
      })();
      // 来季の方針：ホワイトボード
      (function () {
        const x = OFF_SPOTS[6].x, y = py;
        bg.fillStyle = '#241a10'; bg.fillRect(x - 17, y - 40, 34, 32);
        bg.fillStyle = dusk ? '#dcd6c4' : '#f6f2e4'; bg.fillRect(x - 15, y - 38, 30, 28);
        bg.fillStyle = '#3a7ad9'; bg.fillRect(x - 12, y - 34, 20, 2);
        bg.fillStyle = '#e04a3f'; bg.fillRect(x - 12, y - 29, 14, 2);
        bg.fillStyle = '#4ea63f'; bg.fillRect(x - 12, y - 24, 22, 2);
        bg.fillStyle = '#5c5548'; bg.fillRect(x - 3, y - 10, 6, 10);
        bg.fillRect(x - 12, y - 2, 24, 2);
        names.push([x, '来季の方針']); box(6);
      })();
      // スポンサー交渉：応接のテーブル
      (function () {
        const x = OFF_SPOTS[7].x, y = py;
        bg.fillStyle = 'rgba(0,0,0,.28)'; bg.fillRect(x - 14, y - 3, 28, 3);
        bg.fillStyle = '#4a4034'; bg.fillRect(x - 14, y - 14, 28, 11);
        bg.fillStyle = '#5e5344'; bg.fillRect(x - 14, y - 14, 28, 3);
        // 書類とペン
        bg.fillStyle = '#f6f2e4'; bg.fillRect(x - 9, y - 18, 10, 5);
        bg.fillStyle = '#c8a53a'; bg.fillRect(x + 3, y - 17, 7, 3);
        bg.fillStyle = '#2b2e36'; bg.fillRect(x + 4, y - 20, 2, 4);
        names.push([x, 'スポンサー交渉']); box(7);
      })();
      // 若手のスカウト：カートと看板
      (function () {
        const x = OFF_SPOTS[8].x, y = py;
        bg.fillStyle = 'rgba(0,0,0,.28)'; bg.fillRect(x - 12, y - 3, 24, 3);
        bg.fillStyle = '#17181c';
        bg.fillRect(x - 12, y - 10, 6, 6); bg.fillRect(x + 6, y - 10, 6, 6);
        bg.fillStyle = '#3f8a4a'; bg.fillRect(x - 9, y - 15, 18, 7);
        bg.fillStyle = 'rgba(255,255,255,.30)'; bg.fillRect(x - 9, y - 15, 18, 2);
        bg.fillStyle = '#2b2e36'; bg.fillRect(x - 3, y - 19, 6, 5);
        names.push([x, '若手のスカウト']); box(8);
      })();

      // 来季への出発地点
      const nx = OFF_SPOTS[9].x;
      bg.fillStyle = '#241a10'; bg.fillRect(nx - 24, py - 62, 48, 14);
      bg.fillStyle = dusk ? '#5c4a24' : '#e8dcc0'; bg.fillRect(nx - 23, py - 61, 46, 12);
      bg.font = 'bold 9px sans-serif'; bg.textAlign = 'center';
      bg.fillStyle = dusk ? '#ffe9b0' : '#3a2f1a';
      bg.fillText('NEXT SEASON', nx, py - 52);
      bg.fillStyle = '#8d8578'; bg.fillRect(nx - 22, py - 48, 3, 48);
      bg.fillRect(nx + 19, py - 48, 3, 48);
      bg.fillStyle = 'rgba(255,255,255,.40)';
      for (let k = 0; k < 3; k++) bg.fillRect(nx - 8, py - 30 + k * 9, 16, 3);
      names.push([nx, '来季へ']);
      hitBoxes.push({ key: OFF_SPOTS[9].key, x: nx - 26, y: py - 64, w: 52, h: 66 });

      // 名札
      names.forEach((n, i) => sign(bg, n[0], py - 44 - (i % 2) * 12, n[1],
        sel === OFF_SPOTS[i].key ? '#e04a3f' : '#3f3a30'));

      // 祝いの垂れ幕
      bg.fillStyle = '#241a10'; bg.fillRect(140, 118, 320, 18);
      bg.fillStyle = g2.color;  bg.fillRect(142, 120, 316, 14);
      bg.fillStyle = 'rgba(255,255,255,.30)'; bg.fillRect(142, 120, 316, 3);
      bg.font = 'bold 11px sans-serif'; bg.textAlign = 'center';
      bg.fillStyle = '#fff8e3';
      bg.fillText('シーズン ' + g2.season + ' おつかれさま！', 300, 131);
    }

    if (!dusk) return;

    // 建物の落ち影。同じ絵を黒くして、光の向きへずらして重ねる
    if (GP.fx.supportsBlur()) {
      const sil = layer();
      sil.g.filter = 'brightness(0)';
      sil.g.drawImage(bl.c, 0, 0);
      sil.g.filter = 'none';
      ctx.save();
      ctx.globalAlpha = 0.11;
      for (let k = 1; k <= 7; k++) ctx.drawImage(sil.c, k * 2.8, k * 1.1);
      ctx.restore();
    }
    ctx.drawImage(bl.c, 0, 0);

    // 夕暮れの空気。地平線あたりに橙、手前に紫を落とす
    const air = ctx.createLinearGradient(0, 60, 0, H);
    air.addColorStop(0, 'rgba(255,168,86,.22)');
    air.addColorStop(0.45, 'rgba(150,110,190,.10)');
    air.addColorStop(1, 'rgba(40,26,64,.30)');
    ctx.fillStyle = air; ctx.fillRect(0, 0, W, H);

    GP.fx.composite(out, { dof: 0, bloom: 1.0, warm: 1.0, vignette: 1.0, night: true });
  }

  function hit(x, y) {
    for (let i = hitBoxes.length - 1; i >= 0; i--) {
      const b = hitBoxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.key;
    }
    return null;
  }

  /* 合同デブリーフィングの場。ホワイトボードを囲んで数人が立っている */
  function briefStand(bg, x, py, color, done) {
    bg.globalAlpha = done ? 0.45 : 1;
    bg.fillStyle = 'rgba(0,0,0,.30)';
    bg.beginPath(); bg.ellipse(x, py, 16, 3.4, 0, 0, Math.PI * 2); bg.fill();
    // ホワイトボード
    bg.fillStyle = '#6b5a44'; bg.fillRect(x - 2, py - 12, 3, 12);
    bg.fillStyle = '#3a3428'; bg.fillRect(x - 14, py - 34, 28, 22);
    bg.fillStyle = '#e8e2d0'; bg.fillRect(x - 12, py - 32, 24, 18);
    bg.fillStyle = '#3a7ad9'; bg.fillRect(x - 9, py - 29, 14, 2);
    bg.fillRect(x - 9, py - 25, 10, 2);
    bg.fillStyle = '#e04a3f'; bg.fillRect(x - 9, py - 21, 17, 2);
    // 囲んでいる人（小さめに2人）
    const mini = (mx, suit) => {
      bg.fillStyle = shadeHex(suit, -0.20); bg.fillRect(mx - 4, py - 17, 8, 17);
      bg.fillStyle = suit;                  bg.fillRect(mx - 4, py - 17, 8, 6);
      bg.fillStyle = '#2c3140'; bg.fillRect(mx - 4, py - 7, 3, 7);
      bg.fillRect(mx + 1, py - 7, 3, 7);
      bg.fillStyle = '#eec49a'; bg.fillRect(mx - 3, py - 24, 6, 7);
      bg.fillStyle = '#2b1d12'; bg.fillRect(mx - 3, py - 25, 6, 3);
    };
    mini(x - 17, color);
    mini(x + 17, '#5a6270');
    bg.globalAlpha = 1;
    if (done) doneMark(bg, x + 22, py - 24);
  }

  /* 敷地に立っている人。オフ期間の描き方と同じ形にそろえてある */
  /* 用事を済ませた相手の頭の上に出す印。
     「誰にまだ声をかけていないか」が、ひと目で分かるようにする */
  function doneMark(bg, x, y) {
    bg.globalAlpha = 1;
    bg.fillStyle = '#1c3a1c';
    bg.beginPath(); bg.arc(x, y, 7, 0, Math.PI * 2); bg.fill();
    bg.fillStyle = '#8ef08e';
    bg.beginPath(); bg.arc(x, y, 5.6, 0, Math.PI * 2); bg.fill();
    bg.strokeStyle = '#12310f'; bg.lineWidth = 2; bg.lineJoin = 'round';
    bg.beginPath();
    bg.moveTo(x - 3, y); bg.lineTo(x - 1, y + 2.6); bg.lineTo(x + 3.2, y - 2.6);
    bg.stroke();
  }

  function person(bg, x, py, suit, hair, faceC, hat, done) {
    bg.globalAlpha = done ? 0.45 : 1;
    bg.fillStyle = 'rgba(0,0,0,.30)';
    bg.beginPath(); bg.ellipse(x, py, 7, 2.6, 0, 0, Math.PI * 2); bg.fill();
    bg.fillStyle = shadeHex(suit, -0.20); bg.fillRect(x - 5, py - 21, 10, 21);
    bg.fillStyle = suit;                  bg.fillRect(x - 5, py - 21, 10, 8);
    bg.fillStyle = 'rgba(255,255,255,.24)'; bg.fillRect(x - 5, py - 21, 10, 2);
    bg.fillStyle = '#2c3140'; bg.fillRect(x - 5, py - 9, 4, 9);
    bg.fillRect(x + 1, py - 9, 4, 9);
    bg.fillStyle = faceC; bg.fillRect(x - 4, py - 29, 8, 8);
    bg.fillStyle = hair;  bg.fillRect(x - 4, py - 30, 8, 4);
    bg.fillStyle = '#2a2028'; bg.fillRect(x - 3, py - 26, 2, 2);
    bg.fillRect(x + 1, py - 26, 2, 2);
    if (hat) { bg.fillStyle = hat; bg.fillRect(x - 5, py - 31, 10, 3); }
    bg.globalAlpha = 1;
    if (done) doneMark(bg, x + 12, py - 24);
  }

  /* チームの規模（施設・ファン・タイトルの総合）*/
  function scale(g2) {
    const fac = GP.data.FACILITIES.reduce((a, f) => a + (g2.facilities[f.key] || 1), 0);
    const fanPt = Math.max(0, (Math.log10(Math.max(10, g2.fans)) - 2.4) * 12);
    // タイトルは効くが、積み上げるだけで頂点に届かないよう頭打ちにする
    const t = Math.min(40, (g2.titles.teams + g2.titles.drivers) * 5);
    const v = fac + fanPt + t;
    const RANKS = [
      [14, 'ガレージチーム'], [28, '弱小プライベーター'], [44, '中堅コンストラクター'],
      [62, '有力チーム'], [82, 'トップチーム'], [104, '強豪ワークス'], [9999, '伝説のチーム']
    ];
    const r = RANKS.find(x => v < x[0]);
    return { value: Math.round(v), rank: r ? r[1] : '伝説のチーム' };
  }

  return { render, scene, drawWith, invalidate, hit, scale, setYard,
           drawActor, doneMark, doorOf, doorPos, clampWalk, WALK, W, H };
})();

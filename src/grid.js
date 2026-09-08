/* =========================================================
   スターティンググリッド
   予選を終えたマシンが並ぶコース上。本拠地・パドックと同じ
   「歩いて近づく」仕組みで、自分のマシンとドライバー、
   前後に並ぶライバル、グリッドに降りてくる関係者を回る。
   ========================================================= */
window.GP = window.GP || {};

GP.grid = (function () {
  'use strict';

  const W = 600, H = 340;

  /* 画面の奥行き。
     真上から見下ろすのではなく、グリッドの脇に立って
     並んだマシンを横から見ている、という絵にしている。
     奥ほど小さく、かすんで、暗くなる                            */
  const HORIZON = 96;                       // 空と路面の境
  const FAR = { y: 182, s: 0.72 };          // 偶数グリッド（奥の列）
  const NEAR = { y: 238, s: 1.00 };         // 奇数グリッド（手前の列）

  /* 歩けるのは、並んだマシンの手前を横切る帯 */
  const WALK = { x0: 24, x1: W - 24, y0: 274, y1: 318 };

  /* 立ち止まれる場所（通路上のx） */
  const SPOTS = [
    { key: 'gd:mine0', x: 74,  label: '' },     // 自チームのマシン1
    { key: 'gd:mine1', x: 172, label: '' },     // 自チームのマシン2
    { key: 'gd:look',  x: 286, label: '並んだマシン' },
    { key: 'gd:guest', x: 398, label: '' },     // その週の来客
    { key: 'gd:go',    x: 522, label: 'スタート進行' }
  ];

  let cache = null, cacheKey = '';
  let people = [];      // [{key,label,color,done}] main.js から渡す
  function setPeople(list) { people = list || []; }

  const keyOf = (g2, sel) =>
    [g2.season, g2.nextRace, g2.color, sel || '',
     people.map(p => p.key + (p.done ? '1' : '0')).join(','),
     (g2.gridOrder || []).map(o => o.color).join('')].join('|');

  function doorOf(x, y, g2) {
    let best = null, bd = 1e9;
    SPOTS.forEach((s, i) => {
      if (!people[i]) return;
      const d = Math.abs(x - s.x);
      if (d < 26 && d < bd) { bd = d; best = { key: s.key, x: s.x }; }
    });
    return best;
  }
  function doorPos(key) {
    const i = SPOTS.findIndex(s => s.key === key);
    return i < 0 ? null : { x: SPOTS[i].x, y: WALK.y1 - 8 };
  }
  function clampWalk(x, y) {
    return { x: Math.max(WALK.x0, Math.min(WALK.x1, x)),
             y: Math.max(WALK.y0, Math.min(WALK.y1, y)) };
  }
  let hitBoxes = [];
  function hit(x, y) {
    for (let i = hitBoxes.length - 1; i >= 0; i--) {
      const b = hitBoxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.key;
    }
    return null;
  }

  /* ---------- 小物 ---------- */
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return 'rgb(' + f((n >> 16) & 255) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }

  /* タイヤウォーマーを巻いた予備タイヤの山 */
  function tyreStack(c, x, y, col) {
    for (let k = 0; k < 3; k++) {
      const yy = y - k * 5;
      c.fillStyle = '#1c1c20'; c.fillRect(x - 7, yy - 4, 14, 5);
      c.fillStyle = col;       c.fillRect(x - 7, yy - 4, 14, 2);
      c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(x - 6, yy - 4, 12, 1);
    }
  }

  /* ピットボードを持つスタッフ */
  function boardMan(c, x, y, suit, txt) {
    c.fillStyle = 'rgba(0,0,0,.30)';
    c.beginPath(); c.ellipse(x, y, 6, 2.4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = shade(suit, -0.20); c.fillRect(x - 4, y - 18, 8, 18);
    c.fillStyle = suit;               c.fillRect(x - 4, y - 18, 8, 6);
    c.fillStyle = '#2c3140'; c.fillRect(x - 4, y - 7, 3, 7); c.fillRect(x + 1, y - 7, 3, 7);
    c.fillStyle = '#eec49a'; c.fillRect(x - 3, y - 25, 6, 7);
    c.fillStyle = '#2b1d12'; c.fillRect(x - 3, y - 26, 6, 3);
    // 手に持つボード
    c.fillStyle = '#241a10'; c.fillRect(x + 5, y - 22, 13, 11);
    c.fillStyle = '#f0e6c8'; c.fillRect(x + 6, y - 21, 11, 9);
    c.fillStyle = '#3a2413'; c.font = 'bold 7px monospace';
    c.fillText(txt || 'P1', x + 7, y - 13);
  }

  /* しゃがんで作業するメカニック */
  function crouchMech(c, x, y, suit) {
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath(); c.ellipse(x, y, 7, 2.4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = shade(suit, -0.22); c.fillRect(x - 5, y - 11, 10, 11);
    c.fillStyle = suit;               c.fillRect(x - 5, y - 11, 10, 4);
    c.fillStyle = '#eec49a'; c.fillRect(x - 3, y - 17, 6, 6);
    c.fillStyle = '#e8c24a'; c.fillRect(x - 4, y - 18, 8, 3);   // キャップ
    c.fillStyle = '#2c3140'; c.fillRect(x + 4, y - 6, 4, 3);    // 伸ばした腕
  }

  /* 傘（グリッドの日除け） */
  function parasol(c, x, y, col) {
    c.fillStyle = '#7a6a52'; c.fillRect(x - 1, y - 28, 2, 28);
    c.fillStyle = col; c.beginPath();
    c.moveTo(x - 14, y - 28); c.lineTo(x + 14, y - 28); c.lineTo(x, y - 38); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.30)'; c.fillRect(x - 13, y - 29, 26, 2);
  }

  /* テレビカメラ */
  function tvCrew(c, x, y) {
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath(); c.ellipse(x, y, 6, 2.4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2b3a4a'; c.fillRect(x - 4, y - 18, 8, 18);
    c.fillStyle = '#eec49a'; c.fillRect(x - 3, y - 25, 6, 7);
    c.fillStyle = '#1a1a20'; c.fillRect(x - 2, y - 32, 14, 9);   // カメラ本体
    c.fillStyle = '#3a3a44'; c.fillRect(x + 12, y - 30, 4, 5);   // レンズ
    c.fillStyle = '#e04a3f'; c.fillRect(x + 10, y - 32, 2, 2);   // 録画ランプ
  }

  /* =========================================================
     横から見たフォーミュラカー
     真上からの絵（raceview）とは別に、立って眺めたときの姿を描く。
     y は接地線、x は車体の中心。s で奥行きぶんの大きさを変える
     ========================================================= */
  function sideCar(c, x, y, s, color, gen, dim) {
    const L = 78 * s, hub = 9 * s;            // 全長とタイヤ半径
    const x0 = x - L / 2, x1 = x + L / 2;     // 後端・前端
    const dark = shade(color, -0.24), lite = shade(color, 0.18);
    const ink = dim ? 'rgba(24,22,30,.55)' : '#15151a';
    c.save();
    // 影。近いものほど長く、濃く落ちる
    c.fillStyle = 'rgba(0,0,0,' + (0.16 + 0.16 * s).toFixed(2) + ')';
    c.beginPath();
    c.ellipse(x, y + 1, L * 0.52, 4 * s, 0, 0, Math.PI * 2);
    c.fill();

    const R = (rx, ry, rw, rh, col) => {
      c.fillStyle = col;
      c.fillRect(x0 + rx * s, y - ry * s, rw * s, rh * s);
    };
    // リアウイング（世代が進むほど立派になる）
    const wingH = 20 + gen * 0.8;
    R(2, wingH, 3, wingH - 9, ink);
    R(-1, wingH, 13, 4, dark);
    R(-1, wingH, 13, 1.6, lite);
    // フロア〜サイドポンツーン
    R(8, 11, 46, 8, color);
    R(8, 11, 46, 2.4, lite);
    R(8, 4, 46, 3, ink);
    // エンジンカバーからノーズへ、なだらかに落ちる
    R(16, 17, 20, 6, color);
    R(16, 17, 20, 2, lite);
    R(34, 14, 16, 4, color);
    R(48, 11, 22, 4, color);      // ノーズ
    R(48, 11, 22, 1.4, lite);
    // エアボックス
    R(20, 22, 8, 5, dark);
    R(20, 22, 8, 1.6, lite);
    // コクピットとヘルメット
    R(28, 18, 10, 3, ink);
    c.fillStyle = dim ? '#6a6070' : '#f0e6c8';
    c.fillRect(x0 + 30 * s, y - 22 * s, 7 * s, 5 * s);
    c.fillStyle = ink;
    c.fillRect(x0 + 31 * s, y - 20.5 * s, 5 * s, 2 * s);
    // ハロ
    c.strokeStyle = ink; c.lineWidth = Math.max(1, 1.6 * s);
    c.beginPath();
    c.moveTo(x0 + 27 * s, y - 19 * s);
    c.quadraticCurveTo(x0 + 34 * s, y - 27 * s, x0 + 41 * s, y - 18 * s);
    c.stroke();
    // フロントウイング
    R(66, 6, 12, 3, dark);
    R(66, 6, 12, 1.2, lite);
    R(74, 4, 4, 4, ink);
    // タイヤ（後・前）
    const tyre = (tx) => {
      c.fillStyle = ink;
      c.beginPath(); c.arc(x0 + tx * s, y - hub, hub, 0, Math.PI * 2); c.fill();
      c.fillStyle = dim ? '#4a4550' : '#2e2e36';
      c.beginPath(); c.arc(x0 + tx * s, y - hub, hub * 0.62, 0, Math.PI * 2); c.fill();
      c.fillStyle = dim ? '#6a6070' : '#b8b8c0';
      c.beginPath(); c.arc(x0 + tx * s, y - hub, hub * 0.26, 0, Math.PI * 2); c.fill();
    };
    tyre(11); tyre(60);
    c.restore();
  }

  /* 小物を、その列の大きさで描く */
  function atScale(c, x, y, s, fn) {
    c.save(); c.translate(x, y); c.scale(s, s); c.translate(-x, -y);
    fn(); c.restore();
  }

  /* 奥のスタンドと、そこを埋める観客 */
  function grandstand(c) {
    // 空
    const sky = c.createLinearGradient(0, 0, 0, HORIZON);
    sky.addColorStop(0, '#7fb0da');
    sky.addColorStop(0.62, '#b9d2e4');
    sky.addColorStop(1, '#dfe6ea');
    c.fillStyle = sky; c.fillRect(0, 0, W, HORIZON);
    // 遠くのビルと木立
    c.fillStyle = 'rgba(126,146,166,.40)';
    for (let x = -10; x < W; x += 37) {
      const h = 12 + ((x * 7919) % 17);
      c.fillRect(x, HORIZON - 42 - h, 26, h + 12);
    }
    // スタンドの屋根
    c.fillStyle = '#4a4f5c'; c.fillRect(0, HORIZON - 44, W, 7);
    c.fillStyle = '#5c6270'; c.fillRect(0, HORIZON - 44, W, 2);
    // 観客席。段ごとに人の点を打つ
    for (let r = 0; r < 4; r++) {
      const y = HORIZON - 36 + r * 8;
      c.fillStyle = r % 2 ? '#3c4250' : '#454b59';
      c.fillRect(0, y, W, 8);
      for (let x = 3 + (r % 2) * 4; x < W; x += 8) {
        const n = (x * 31 + r * 977) % 7;
        c.fillStyle = ['#e0b48a', '#d8d2c4', '#c86a5a', '#6a86b0', '#d8c05a', '#8ab07a', '#b090c8'][n];
        c.fillRect(x, y + 1, 3, 4);
      }
    }
    // ピットウォールの広告帯
    c.fillStyle = '#20242c'; c.fillRect(0, HORIZON - 6, W, 8);
    for (let x = 0; x < W; x += 60) {
      c.fillStyle = ['#b8443c', '#3a6ab0', '#4a8a44', '#c8a340'][(x / 60) % 4];
      c.fillRect(x + 4, HORIZON - 5, 52, 6);
    }
  }

  /* 陽の当たりかた。
     手前の列と通路にだけ光を落として、そこに視線が行くようにする */
  function lighting(c) {
    const pool = c.createRadialGradient(300, NEAR.y + 20, 30, 300, NEAR.y + 20, 330);
    pool.addColorStop(0, 'rgba(255,226,168,.20)');
    pool.addColorStop(0.55, 'rgba(255,214,150,.07)');
    pool.addColorStop(1, 'rgba(255,214,150,0)');
    c.fillStyle = pool; c.fillRect(0, HORIZON, W, H - HORIZON);
    // 奥は青く沈ませる
    const cool = c.createLinearGradient(0, HORIZON, 0, NEAR.y - 20);
    cool.addColorStop(0, 'rgba(70,96,132,.30)');
    cool.addColorStop(1, 'rgba(70,96,132,0)');
    c.fillStyle = cool; c.fillRect(0, HORIZON, W, NEAR.y - 20 - HORIZON);
  }

  /* 画面の手前。ピントの外にあるものを大きく暗く置いて、奥行きを作る */
  function foreground(c) {
    // すぐ目の前にもう1台。画面の外まではみ出した黒い塊として置くと、
    // 「並んだマシンの間に立っている」という距離感が出る
    c.save();
    c.globalAlpha = 0.94;
    sideCar(c, 118, H + 6, 1.55, '#1b1b24', 3, true);
    c.restore();
    // 縁にだけ光を乗せて、黒い塊が「マシン」だと分かるようにする
    c.fillStyle = 'rgba(255,226,168,.22)';
    c.fillRect(48, H - 24, 142, 2);
    // 手前に積まれたタイヤ（大きく、影だけの塊として）
    c.fillStyle = 'rgba(10,9,14,.88)';
    for (let k = 0; k < 4; k++) c.fillRect(W - 96, H - 34 + k * 9, 58, 8);
    // ケーブルドラム
    c.beginPath(); c.arc(W - 178, H - 2, 24, Math.PI, Math.PI * 2); c.fill();
    // 画面のふちを落として、視線を中央に集める
    const v = c.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(10,8,16,.14)');
    v.addColorStop(0.45, 'rgba(10,8,16,0)');
    v.addColorStop(1, 'rgba(10,8,16,.34)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
    const h = c.createLinearGradient(0, 0, W, 0);
    h.addColorStop(0, 'rgba(10,8,16,.34)');
    h.addColorStop(0.2, 'rgba(10,8,16,0)');
    h.addColorStop(0.8, 'rgba(10,8,16,0)');
    h.addColorStop(1, 'rgba(10,8,16,.34)');
    c.fillStyle = h; c.fillRect(0, 0, W, H);
  }

  /* ---------- 全体を描く ---------- */
  function render(cv, g2, sel) {
    const out = cv.getContext('2d');
    out.imageSmoothingEnabled = false;
    hitBoxes = [];
    const order = g2.gridOrder || [];

    grandstand(out);

    // ---- 路面。奥ほど暗く、手前ほど明るい ----
    const road = out.createLinearGradient(0, HORIZON, 0, H);
    road.addColorStop(0, '#3a3a44');
    road.addColorStop(0.5, '#4e4e5a');
    road.addColorStop(1, '#57575f');
    out.fillStyle = road; out.fillRect(0, HORIZON, W, H - HORIZON);
    // 路面のムラ
    for (let y = HORIZON; y < H; y += 5) {
      out.fillStyle = ((y / 5) | 0) % 2 ? 'rgba(255,255,255,.016)' : 'rgba(0,0,0,.020)';
      out.fillRect(0, y, W, 3);
    }

    // ---- グリッドの白線。奥へ向かうほど細く、間隔も詰まる ----
    const gridMark = (gy, sc, x, num, mine) => {
      const w = 52 * sc, h = 8 * sc;
      out.fillStyle = mine ? 'rgba(255,210,58,.85)' : 'rgba(255,255,255,.55)';
      out.fillRect(x - w / 2, gy + 2, w, Math.max(1, h * 0.22));
      out.fillRect(x - w / 2, gy + 2, Math.max(1, h * 0.22), h);
      out.fillStyle = mine ? '#ffd23a' : 'rgba(255,255,255,.72)';
      out.font = 'bold ' + Math.round(11 * sc) + 'px monospace';
      out.fillText(String(num), x - w / 2 + 3, gy + 2 + h + 9 * sc);
    };

    // ---- 並んだマシン ----
    // 自分のマシンが必ず視界に入るように、順位のまわりを切り取って見せる
    const SHOW = 6;
    let from = 0;
    const mi = order.findIndex(o => o && o.mine);
    if (mi >= 0) from = Math.max(0, Math.min(Math.max(0, order.length - SHOW), mi - 2));
    // 自分のマシンが手前の列（大きく描かれるほう）に来るように、
    // 切り取りの開始位置の偶奇をそろえる
    if (mi >= 0 && ((mi - from) % 2)) from = Math.max(0, from - 1);
    const NEAR_X = [470, 300, 130], FAR_X = [548, 378, 208];

    // ---- いちばん奥。グリッドの続きと、スタートの門 ----
    // 細かく描かず「まだ先まで車が並んでいる」ことだけ伝える
    (function () {
      const dy = 142, ds = 0.42;
      // 門
      out.fillStyle = 'rgba(42,42,52,.75)';
      out.fillRect(96, HORIZON + 2, 5, 26); out.fillRect(494, HORIZON + 2, 5, 26);
      out.fillRect(94, HORIZON, 408, 8);
      for (let k = 0; k < 5; k++) {
        out.fillStyle = 'rgba(180,60,50,.45)';
        out.fillRect(150 + k * 60, HORIZON + 2, 14, 4);
      }
      // 奥に続くマシン
      const far2 = [70, 200, 330, 460, 560];
      far2.forEach((x, k) => {
        const e = order[from + 6 + k];
        sideCar(out, x, dy, ds, e ? e.color : '#6a6a76', e ? (e.gen || 0) : 0, true);
      });
      // スタートライン
      for (let x = 40; x < W - 40; x += 10) {
        out.fillStyle = ((x / 10) | 0) % 2 ? 'rgba(240,239,232,.55)' : 'rgba(40,40,50,.45)';
        out.fillRect(x, HORIZON + 30, 10, 4);
      }
    })();


    // 奥の列（偶数グリッド）を先に描く
    for (let j = 0; j < 3; j++) {
      const i = from + j * 2 + 1;
      const e = order[i];
      if (!e) continue;
      sideCar(out, FAR_X[j], FAR.y, FAR.s, e.color, e.gen || 0, true);
      gridMark(FAR.y, FAR.s, FAR_X[j], i + 1, !!e.mine);
      if (e.mine) atScale(out, FAR_X[j], FAR.y, FAR.s, () => parasol(out, FAR_X[j] - 36, FAR.y - 2, e.color));
      else if (j === 1) atScale(out, FAR_X[j], FAR.y, FAR.s,
        () => boardMan(out, FAR_X[j] + 44, FAR.y, e.color, 'P' + (i + 1)));
    }
    // 奥にうっすら空気の層をかけて、距離を感じさせる
    const haze = out.createLinearGradient(0, HORIZON, 0, NEAR.y - 10);
    haze.addColorStop(0, 'rgba(176,196,214,.34)');
    haze.addColorStop(1, 'rgba(176,196,214,0)');
    out.fillStyle = haze; out.fillRect(0, HORIZON, W, NEAR.y - 10 - HORIZON);

    // 手前の列（奇数グリッド）
    for (let j = 0; j < 3; j++) {
      const i = from + j * 2;
      const e = order[i];
      if (!e) continue;
      sideCar(out, NEAR_X[j], NEAR.y, NEAR.s, e.color, e.gen || 0, false);
      gridMark(NEAR.y, NEAR.s, NEAR_X[j], i + 1, !!e.mine);
      // マシンのまわりの人と小物
      if (e.mine) {
        parasol(out, NEAR_X[j] - 44, NEAR.y - 2, e.color);
        crouchMech(out, NEAR_X[j] + 30, NEAR.y, e.color);
        tyreStack(out, NEAR_X[j] - 52, NEAR.y, e.color);
      } else if (j === 0) {
        tvCrew(out, NEAR_X[j] + 52, NEAR.y);
      } else {
        crouchMech(out, NEAR_X[j] + 34, NEAR.y, e.color);
      }
    }

    // ---- 歩ける通路 ----
    out.fillStyle = 'rgba(255,255,255,.30)'; out.fillRect(0, WALK.y0 - 10, W, 2);
    const lane = out.createLinearGradient(0, WALK.y0 - 8, 0, H);
    lane.addColorStop(0, '#5c5a62');
    lane.addColorStop(1, '#454250');
    out.fillStyle = lane; out.fillRect(0, WALK.y0 - 8, W, H - WALK.y0 + 8);
    for (let x = 0; x < W; x += 24) {
      out.fillStyle = 'rgba(255,255,255,.045)';
      out.fillRect(x, WALK.y0 - 8, 12, H - WALK.y0 + 8);
    }

    // ---- 立ち止まれる場所 ----
    const py = WALK.y1 - 2;
    people.forEach((q, i) => {
      const s2 = SPOTS[i];
      if (!s2) return;
      if (q.kind === 'gate') {
        out.fillStyle = '#241a10'; out.fillRect(s2.x - 22, py - 48, 44, 28);
        out.fillStyle = '#f0e6c8'; out.fillRect(s2.x - 20, py - 46, 40, 24);
        out.fillStyle = '#3a2413'; out.font = 'bold 10px monospace';
        out.fillText('START', s2.x - 17, py - 30);
      } else if (q.kind === 'look') {
        parasol(out, s2.x, py, '#6a7a8a');
      }
      person(out, s2.x, py, q.color || '#8a5a2a', q.done);
      hitBoxes.push({ key: s2.key, x: s2.x - 17, y: py - 42, w: 34, h: 44 });
      sign(out, s2.x, py - 40 - (i % 2) * 12, q.label, sel === s2.key ? '#e04a3f' : '#3f3a30');
    });

    lighting(out);
    foreground(out);
  }

  function person(c, x, py, suit, done) {
    c.globalAlpha = done ? 0.45 : 1;
    c.fillStyle = 'rgba(0,0,0,.32)';
    c.beginPath(); c.ellipse(x, py, 7, 2.6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = shade(suit, -0.20); c.fillRect(x - 5, py - 21, 10, 21);
    c.fillStyle = suit;               c.fillRect(x - 5, py - 21, 10, 8);
    c.fillStyle = 'rgba(255,255,255,.24)'; c.fillRect(x - 5, py - 21, 10, 2);
    c.fillStyle = '#2c3140'; c.fillRect(x - 5, py - 9, 4, 9); c.fillRect(x + 1, py - 9, 4, 9);
    c.fillStyle = '#eec49a'; c.fillRect(x - 4, py - 29, 8, 8);
    c.fillStyle = '#2b1d12'; c.fillRect(x - 4, py - 30, 8, 4);
    c.fillStyle = '#2a2028'; c.fillRect(x - 3, py - 26, 2, 2); c.fillRect(x + 1, py - 26, 2, 2);
    c.globalAlpha = 1;
  }

  /* 名札 */
  function sign(c, x, y, text, color) {
    if (!text) return;
    c.font = '9px system-ui, sans-serif';
    const w = c.measureText(text).width + 10;
    c.fillStyle = 'rgba(20,16,12,.82)';
    c.fillRect(x - w / 2, y - 9, w, 13);
    c.fillStyle = color === '#e04a3f' ? '#ffd23a' : '#efe4cf';
    c.fillText(text, x - w / 2 + 5, y + 1);
  }

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

  function drawWith(cv, g2, sel, actor) {
    const out = cv.getContext('2d');
    out.imageSmoothingEnabled = false;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.clearRect(0, 0, W, H);
    out.drawImage(scene(g2, sel), 0, 0);
    if (actor) GP.base.drawActor(out, actor);
  }

  return { render, scene, drawWith, invalidate, hit, setPeople, sideCar,
           doorOf, doorPos, clampWalk, WALK, SPOTS, W, H };
})();

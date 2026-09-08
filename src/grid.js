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

  /* 歩けるのは、グリッドの脇の細い帯 */
  const WALK = { x0: 22, x1: W - 22, y0: 250, y1: 316 };

  /* グリッドの枠。左右2列を互い違いに置く。i は予選順（0始まり） */
  const SLOT_W = 44, SLOT_H = 26;
  const COL_X = [176, 300];              // 左列・右列の中心
  const ROW_Y = 44, ROW_STEP = 40;       // 先頭列のy と 1列ぶんの間隔
  const ROWS = 5;                        // 描くのは10番手まで（通路に被らない範囲）
  function slotPos(i) {
    const r = Math.floor(i / 2), c = i % 2;
    return { x: COL_X[c] + (c ? 0 : 0), y: ROW_Y + r * ROW_STEP + (c ? 18 : 0) };
  }

  /* 通路側で立ち止まれる場所 */
  const SPOTS = [
    { key: 'gd:mine0', x: 92,  label: '' },     // 自チームのマシン1
    { key: 'gd:mine1', x: 168, label: '' },     // 自チームのマシン2
    { key: 'gd:look',  x: 262, label: '並んだマシン' },
    { key: 'gd:guest', x: 372, label: '' },     // その週の来客
    { key: 'gd:go',    x: 508, label: 'スタート進行' }
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
    c.fillStyle = '#7a6a52'; c.fillRect(x - 1, y - 30, 2, 30);
    c.fillStyle = col; c.beginPath();
    c.moveTo(x - 18, y - 30); c.lineTo(x + 18, y - 30); c.lineTo(x, y - 42); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.30)'; c.fillRect(x - 17, y - 31, 34, 2);
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

  /* スタートシグナルの門 */
  function gantry(c) {
    c.fillStyle = '#3a3a42'; c.fillRect(120, 6, 8, 34); c.fillRect(348, 6, 8, 34);
    c.fillStyle = '#2a2a32'; c.fillRect(118, 4, 240, 16);
    c.fillStyle = '#15151a'; c.fillRect(126, 7, 224, 10);
    for (let k = 0; k < 5; k++) {
      c.fillStyle = '#3a1a18';
      c.fillRect(140 + k * 42, 9, 12, 6);
      c.fillStyle = 'rgba(224,74,63,.35)';
      c.fillRect(141 + k * 42, 10, 10, 4);
    }
  }

  /* ---------- 全体を描く ---------- */
  function render(cv, g2, sel) {
    const out = cv.getContext('2d');
    out.imageSmoothingEnabled = false;
    hitBoxes = [];
    const RV = GP.raceview;
    const order = g2.gridOrder || [];

    // 路面
    out.fillStyle = '#3c3c44'; out.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 6) {
      out.fillStyle = y % 12 ? '#3a3a42' : '#38383f';
      out.fillRect(0, y, W, 3);
    }
    // 縁石（左右）
    for (let y = 0; y < H; y += 16) {
      out.fillStyle = (y / 16) % 2 ? '#d94a3a' : '#f0efe8';
      out.fillRect(0, y, 14, 16); out.fillRect(W - 14, y, 14, 16);
    }
    // ピットウォール側の白線
    out.fillStyle = 'rgba(255,255,255,.55)';
    out.fillRect(18, 0, 3, H); out.fillRect(W - 21, 0, 3, H);

    // スタートライン
    for (let x = 22; x < W - 22; x += 12) {
      out.fillStyle = ((x / 12) | 0) % 2 ? '#f0efe8' : '#2a2a32';
      out.fillRect(x, 26, 12, 8);
    }
    gantry(out);

    // グリッドの枠と、並んだマシン
    for (let i = 0; i < ROWS * 2; i++) {
      const p = slotPos(i);
      out.strokeStyle = 'rgba(255,255,255,.60)'; out.lineWidth = 2;
      out.strokeRect(p.x - SLOT_W / 2, p.y - SLOT_H / 2, SLOT_W, SLOT_H);
      const e = order[i];
      if (!e) continue;
      if (RV && RV.paintCar) RV.paintCar(out, p.x, p.y, -Math.PI / 2, e.color, e.gen || 0, 0.18);
      if (e.mine) {
        out.strokeStyle = '#fff34d'; out.lineWidth = 2;
        out.setLineDash([5, 4]);
        out.strokeRect(p.x - SLOT_W / 2 - 3, p.y - SLOT_H / 2 - 3, SLOT_W + 6, SLOT_H + 6);
        out.setLineDash([]);
      }
      // マシンのまわりの小物
      if (i % 2 === 0) tyreStack(out, p.x - 30, p.y + 10, e.color);
      else crouchMech(out, p.x + 28, p.y + 9, e.color);
      if (e.mine) parasol(out, p.x - 34, p.y - 2, e.color);
    }
    // グリッド番号は、小物より上に出す
    for (let i = 0; i < ROWS * 2; i++) {
      const p = slotPos(i);
      const lx = (i % 2 === 0) ? p.x + SLOT_W / 2 + 6 : p.x - SLOT_W / 2 - 16;
      out.fillStyle = 'rgba(20,16,12,.72)';
      out.fillRect(lx - 3, p.y - 8, 18, 14);
      out.fillStyle = order[i] && order[i].mine ? '#ffd23a' : 'rgba(255,255,255,.85)';
      out.font = 'bold 10px monospace';
      out.fillText(String(i + 1), lx, p.y + 3);
    }

    // 観客とTVクルーで、通路の奥を埋める
    tvCrew(out, 452, 236);
    boardMan(out, 76, 240, g2.color, 'P' + (order.findIndex(o => o && o.mine) + 1 || 1));

    // 通路（歩ける帯）
    out.fillStyle = '#43434c'; out.fillRect(0, WALK.y0 - 8, W, H - WALK.y0 + 8);
    for (let x = 0; x < W; x += 18) {
      out.fillStyle = 'rgba(255,255,255,.05)';
      out.fillRect(x, WALK.y0 - 8, 9, H - WALK.y0 + 8);
    }
    out.fillStyle = 'rgba(255,255,255,.35)'; out.fillRect(0, WALK.y0 - 9, W, 2);

    // 立ち止まれる場所
    const py = WALK.y1 - 2;
    people.forEach((q, i) => {
      const s = SPOTS[i];
      if (!s) return;
      if (q.kind === 'car') {
        // 自分のマシンの脇に立つドライバー
        if (RV && RV.paintCar) RV.paintCar(out, s.x, py - 26, -Math.PI / 2, q.color, q.gen || 0, 0.1);
        person(out, s.x + 22, py, q.color, q.done);
      } else if (q.kind === 'gate') {
        out.fillStyle = '#241a10'; out.fillRect(s.x - 20, py - 44, 40, 26);
        out.fillStyle = '#f0e6c8'; out.fillRect(s.x - 18, py - 42, 36, 22);
        out.fillStyle = '#3a2413'; out.font = 'bold 9px monospace';
        out.fillText('START', s.x - 15, py - 27);
        person(out, s.x, py, '#e04a3f', q.done);
      } else if (q.kind === 'look') {
        parasol(out, s.x, py, '#6a7a8a');
        person(out, s.x, py, q.color || '#5a6270', q.done);
      } else {
        person(out, s.x, py, q.color || '#8a5a2a', q.done);
      }
      hitBoxes.push({ key: s.key, x: s.x - 16, y: py - 40, w: 32, h: 42 });
      sign(out, s.x, py - 50 - (i % 2) * 12, q.label, sel === s.key ? '#e04a3f' : '#3f3a30');
    });
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

  return { render, scene, drawWith, invalidate, hit, setPeople,
           doorOf, doorPos, clampWalk, WALK, SPOTS, W, H };
})();

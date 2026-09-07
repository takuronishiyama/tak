/* =========================================================
   チームの本拠地
   施設レベルで建物が実際に大きく・立派になり、
   ファン数とタイトル数で敷地の賑わいが変わる。
   ========================================================= */
window.GP = window.GP || {};

GP.base = (function () {
  'use strict';

  const W = 520, H = 340;

  /* 建物の区画。x,y は左下（正面）を基準にする */
  const PLOTS = [
    { key: 'pit',     x: 20,  y: 238, label: 'ピット設備' },
    { key: 'factory', x: 126, y: 246, label: 'ファクトリー' },
    { key: 'tunnel',  x: 214, y: 238, label: '風洞' },
    { key: 'sim',     x: 326, y: 246, label: 'シミュレーター' },
    { key: 'market',  x: 414, y: 234, label: 'マーケ室' }
  ];

  let hitBoxes = [];

  /* レベルから建物の大きさと段階を決める */
  function tierOf(lv) {
    return { t: Math.min(4, Math.floor((lv - 1) / 2.5)), w: 40 + lv * 3.6, h: 26 + lv * 3.6 };
  }

  function seeded(n) {
    let h = (n * 2654435761) >>> 0;
    return function () { h = (h * 1103515245 + 12345) >>> 0; return h / 4294967296; };
  }

  /* ---------- 部品 ---------- */
  function box(g, x, y, w, h, fill, top) {
    g.fillStyle = '#3a2413';
    g.fillRect(x - 2, y - h - 2, w + 4, h + 4);
    g.fillStyle = fill;
    g.fillRect(x, y - h, w, h);
    g.fillStyle = top;
    g.fillRect(x, y - h, w, Math.max(4, h * 0.20));
  }

  function windows(g, x, y, w, h, cols, rows, lit) {
    const mw = Math.max(4, (w - 8) / cols - 3), mh = Math.max(4, (h - 12) / rows - 3);
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      g.fillStyle = lit ? 'rgba(255,238,170,.92)' : 'rgba(150,200,230,.85)';
      g.fillRect(x + 5 + c * (mw + 3), y - h + 9 + r * (mh + 3), mw, mh);
    }
  }

  function sign(g, x, y, text, color) {
    g.font = 'bold 9px sans-serif'; g.textAlign = 'center';
    const w = g.measureText(text).width + 10;
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
    const bays = Math.min(4, 1 + Math.floor(lv / 3));
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

  const DRAW = { factory: drawFactory, tunnel: drawTunnel, sim: drawSim, market: drawMarket, pit: drawPit };

  /* ---------- 賑わい（ファン数・タイトル）---------- */
  function drawCrowd(g, fans, titles, color, rnd) {
    // 来場者
    const people = Math.min(46, Math.floor(Math.log10(Math.max(10, fans)) * 12) - 8);
    for (let i = 0; i < people; i++) {
      const x = 20 + rnd() * (W - 40), y = 262 + rnd() * 62;
      g.fillStyle = ['#e04a3f', '#3a7ad9', '#4ea63f', '#f0a020', '#b06fd0'][Math.floor(rnd() * 5)];
      g.fillRect(x, y, 3, 4);
      g.fillStyle = '#f2c9a0'; g.fillRect(x, y - 3, 3, 3);
    }
    // 駐車場の車
    const cars = Math.min(10, Math.floor(fans / 2500));
    for (let i = 0; i < cars; i++) {
      const x = 24 + (i % 5) * 24, y = 292 + Math.floor(i / 5) * 16;
      g.fillStyle = '#3a2413'; g.fillRect(x - 1, y - 1, 18, 10);
      g.fillStyle = ['#c85040', '#4070c0', '#50a050', '#d0a030'][i % 4];
      g.fillRect(x, y, 16, 8);
      g.fillStyle = '#bcd8e8'; g.fillRect(x + 4, y + 1, 8, 3);
    }
    // トロフィー像
    for (let i = 0; i < Math.min(6, titles); i++) {
      const x = 320 + i * 24, y = 320;
      g.fillStyle = '#8f7a5c'; g.fillRect(x, y, 12, 8);
      g.fillStyle = '#f0c040'; g.fillRect(x + 3, y - 10, 6, 10);
      g.fillRect(x + 1, y - 13, 10, 3);
      g.fillStyle = '#fff0a0'; g.fillRect(x + 4, y - 9, 2, 7);
    }
  }

  /* ---------- 全体 ---------- */
  function render(cv, g2, sel) {
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    hitBoxes = [];
    const D = GP.data;
    const rnd = seeded(Math.floor(g2.fans) + g2.season * 7 + g2.titles.teams * 13);

    // 芝
    ctx.fillStyle = '#8fbf62'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#86b658';
    for (let y = 0; y < H; y += 8) for (let x = (y % 16 ? 0 : 4); x < W; x += 16) ctx.fillRect(x, y, 4, 4);
    // 奥の木立
    for (let x = 8; x < W; x += 26) {
      const ty = 74 + Math.floor(rnd() * 10);
      ctx.fillStyle = '#4a3218'; ctx.fillRect(x + 6, ty - 5, 3, 6);
      ctx.fillStyle = '#1c4420'; ctx.fillRect(x, ty - 17, 15, 12); ctx.fillRect(x + 3, ty - 21, 9, 5);
      ctx.fillStyle = '#317031'; ctx.fillRect(x + 1, ty - 16, 13, 10); ctx.fillRect(x + 4, ty - 20, 7, 4);
    }
    // 敷地の舗装（建物が建つ面）
    ctx.fillStyle = '#b8b0a0'; ctx.fillRect(10, 108, W - 20, H - 128);
    ctx.fillStyle = '#c4bcac';
    for (let x = 10; x < W - 10; x += 24) ctx.fillRect(x, 108, 22, H - 128);
    ctx.fillStyle = '#a89e8c'; ctx.fillRect(10, 108, W - 20, 3);
    // 引き込み路
    ctx.fillStyle = '#6d7078'; ctx.fillRect(W / 2 - 22, 252, 44, H - 252);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    for (let y = 262; y < H; y += 16) ctx.fillRect(W / 2 - 2, y, 4, 8);
    // フェンス（敷地の奥側）
    ctx.fillStyle = '#7a6a52';
    for (let x = 10; x < W - 8; x += 10) ctx.fillRect(x, 100, 3, 10);
    ctx.fillRect(10, 100, W - 20, 3);

    // 建物（奥から手前へ）
    const signs = [];
    PLOTS.forEach(p => {
      const lv = g2.facilities[p.key] || 1;
      const bb = DRAW[p.key](ctx, p, lv, g2.color);
      hitBoxes.push({ key: p.key, x: bb.x, y: bb.y, w: bb.w, h: bb.h });
      if (sel === p.key) {
        ctx.strokeStyle = '#fff34d'; ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(bb.x - 3, bb.y - 3, bb.w + 6, bb.h + 6);
        ctx.setLineDash([]);
      }
      signs.push({ x: p.x + bb.w / 2 - 2, y: p.y + 8, text: p.label + ' Lv.' + lv, sel: sel === p.key });
    });
    signs.forEach(sg => sign(ctx, sg.x, sg.y, sg.text, sg.sel ? '#e04a3f' : '#4a2f1a'));

    drawCrowd(ctx, g2.fans, g2.titles.teams + g2.titles.drivers, g2.color, rnd);

    // チーム旗
    ctx.fillStyle = '#7a6a52'; ctx.fillRect(24, 116, 3, 54);
    ctx.fillStyle = g2.color; ctx.fillRect(27, 116, 26, 16);
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(29, 119, 22, 3);
  }

  function hit(x, y) {
    for (let i = hitBoxes.length - 1; i >= 0; i--) {
      const b = hitBoxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.key;
    }
    return null;
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

  return { render, hit, scale, W, H };
})();

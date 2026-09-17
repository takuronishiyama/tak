/* =========================================================
   絵の解像度あわせ

   canvas は「裏の大きさ（width/height）」と「表に出る大きさ（CSS）」が
   別々に決まる。これまでは裏を 780×340 に固定したまま、
   表では 352px まで縮めて出していた。つまり絵を 0.45 倍に間引いて
   見せていたことになる。線は飛び、看板の字はつぶれる。
   逆に広い画面では裏のほうが小さく、引き伸ばしてぼやける。

   ここでは、表に出る大きさ（×端末の画素比）にあわせて裏の大きさを決め、
   絵のほうを同じ倍率で拡大して描く。どの画面でも、実際の画素の数だけ
   描くことになるので、縮んでも伸びてもいちばん綺麗なところに来る。

   使う側は、これまでどおり「絵の座標」で描けばいい。
   fit() が返す倍率を setTransform に入れるだけ。
   ========================================================= */
window.GP = window.GP || {};

GP.gfx = (function () {
  'use strict';

  /* 端末の画素比。3倍より上は、描く量のわりに見た目が変わらない */
  function dpr() {
    const d = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return Math.max(1, Math.min(3, d));
  }

  /* 表に出ている幅から、絵をどれだけ拡大して描くかを決める。
     裏の大きさもここで合わせる。返り値をそのまま setTransform に渡す */
  function fit(cv, artW, artH, opt) {
    opt = opt || {};
    let cssW = 0;
    try { cssW = cv.getBoundingClientRect().width; } catch (e) { cssW = 0; }
    /* まだ表に出ていない（幅が取れない）ときは、等倍で用意しておく。
       出たあとの描き直しで、ちゃんとした倍率に入れ替わる        */
    if (!cssW) cssW = artW;
    let k = (cssW / artW) * dpr();
    // 上限を決めないと、4Kの窓で1枚の絵に何百万画素も塗ることになる
    k = Math.max(opt.min || 0.2, Math.min(opt.max || 3, k));
    const w = Math.max(1, Math.round(artW * k));
    const h = Math.max(1, Math.round(artH * k));
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    return k;
  }

  /* 裏の大きさだけ合わせた、別紙（合成用の下敷き） */
  function sheet(artW, artH, k) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(artW * k));
    c.height = Math.max(1, Math.round(artH * k));
    return c;
  }

  /* 絵の座標で描き始める。倍率を入れて、にじみ止めを切る */
  function begin(ctx, k) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    return ctx;
  }

  /* 小さい字は、倍率で縮むと読めなくなる。
     実際の画素で何px になるかを見て、下限を切る（絵の座標での大きさを返す） */
  function fontAt(px, k, min) {
    const real = px * k;
    const need = min == null ? 10 : min;
    return real >= need ? px : need / k;
  }

  /* ---------- 描きかたの共通部品 ----------
     実画素で描くようになったら、今度は「ただの四角」が目立つようになった。
     そこで、置くものはぜんぶ同じ約束で描く：
       ・上から光が当たる（上の辺は明るく、下の辺は暗い）
       ・輪郭は下地より暗い線で締める
       ・床に触れているものは、足もとに影を落とす
     この3つを揃えるだけで、絵がばらばらに見えなくなる        */
  function shade(hex, amt) {
    if (!hex || hex[0] !== '#') return hex;
    let h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    const c = v => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return 'rgb(' + c((n >> 16) & 255) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
  }

  /* 置きもの。輪郭・上の光・下の影を、いつも同じ向きで付ける */
  function prop(g, x, y, w, h, fill, opt) {
    opt = opt || {};
    const line = opt.line || shade(fill, -0.30);
    const lit = opt.lit || shade(fill, 0.16);
    const dim = opt.dim || shade(fill, -0.14);
    g.fillStyle = line; g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = fill; g.fillRect(x, y, w, h);
    if (h > 3) {
      g.fillStyle = lit; g.fillRect(x, y, w, Math.max(1, Math.min(3, h * 0.22)));
      g.fillStyle = dim; g.fillRect(x, y + h - Math.max(1, h * 0.16), w, Math.max(1, h * 0.16));
    }
    if (w > 3 && h > 5) {
      g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x, y, Math.max(1, w * 0.10), h);
      g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x + w - Math.max(1, w * 0.10), y, Math.max(1, w * 0.10), h);
    }
  }

  /* 床に落ちる影。楕円ひとつ。濃さは大きさで決める */
  function shadow(g, cx, y, w, alpha) {
    g.save();
    g.fillStyle = 'rgba(0,0,0,' + (alpha == null ? 0.26 : alpha) + ')';
    g.beginPath();
    /* 平たく。丸に近いと、床ではなく壁に貼った染みに見える */
    g.ellipse(cx, y, w / 2, Math.max(1.1, w * 0.075), 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /* ---------- 色見本 ----------
     絵のなかの色は、以前は 442 種類あった。その場その場で
     16進数を決めていたので、同じ「暗い茶色」が何通りもあり、
     部屋ごと・画面ごとに色の調子がばらついていた。

     ここに並べたのが、絵で使ってよい色のすべて。
     組ごとに 暗い→明るい の5段で、段の番号がそのまま奥行きになる
     （0 が影、2 が地の色、4 が光）。迷ったら 2 を使う。         */
  const pal = {
    n:      ['#12101a', '#1e1b28', '#2b2637', '#3a3348', '#4d455c',
             '#6b6178', '#8e8399', '#b5aabb', '#e8dfd2', '#fff8e6'],
    red:    ['#5c1a1c', '#8f2a24', '#c23a2e', '#e2664a', '#ff9c78'],
    amber:  ['#5e3a12', '#92601c', '#c98a22', '#edb44a', '#ffd98a'],
    green:  ['#0f2a18', '#1d3d22', '#2e6b33', '#47a046', '#78c96a', '#b2e79a'],
    cyan:   ['#123a44', '#1d6272', '#2e96ab', '#5cc4d6', '#9ee8f2'],
    blue:   ['#17284e', '#26417d', '#3a67b8', '#6b9ae0', '#a8c8f2'],
    violet: ['#2a1c46', '#452c72', '#6b47ab', '#9a7ad8', '#c8aef0'],
    pink:   ['#4a1838', '#7a2a5c', '#b03f86', '#d873b0', '#f2aed6'],
    gold:   ['#7a5a18', '#b08424', '#e0ae3c', '#f5cf70', '#fff0b0'],
    grass:  ['#0e2614', '#1b3a1c', '#2f5c26', '#4d8433', '#79ad4a', '#a8cf72'],
    road:   ['#23222c', '#33313e', '#464351', '#5d5a6b', '#7d7a8c'],
    skin:   ['#8a5a3a', '#b07a52', '#d49a70', '#edbb90', '#ffd9b8'],
    sky:    ['#1a1b33', '#2b2c50', '#445078', '#6d7aa8', '#a3aed0'],
    sand:   ['#4a3c28', '#6e5a3c', '#9a8358', '#c2ab7c', '#e6d6ae'],
    brown:  ['#2e1d10', '#4a3018', '#6b4724', '#96683a', '#c08f5c']
  };
  /* 組と段で引く。pal('brown', 2) のように使う */
  function col(name, step) {
    const v = pal[name] || pal.n;
    return v[Math.max(0, Math.min(v.length - 1, step | 0))];
  }

  return { fit, sheet, begin, dpr, fontAt, prop, shadow, shade, pal, col };
})();

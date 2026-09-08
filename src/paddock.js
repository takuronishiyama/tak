/* =========================================================
   レースウィークのパドック
   本拠地と同じ「歩いて入る」仕組みで、
   ガレージ・ドライバーの控え・タイミングブース・コースへの出口を回る。
   絵の作りは本拠地と揃えてあるが、こちらはサーキットの裏側。
   ========================================================= */
window.GP = window.GP || {};

GP.paddock = (function () {
  'use strict';

  const W = 600, H = 340;

  /* 歩ける範囲。ガレージの手前の通路を左右に移動する */
  const WALK = { x0: 20, x1: W - 20, y0: 264, y1: 320 };

  /* ガレージの並び。i=4 が自チーム */
  const GW = 52, GSTEP = 53, MINE_AT = 4;
  const garageX = i => 4 + i * GSTEP + GW / 2;

  /* 通路側で立ち寄れる場所。x は入口の中心 */
  const SPOTS = [
    { key: 'drivers', x: 92,  label: 'ドライバーの控え' },
    { key: 'timing',  x: 400, label: 'タイミングブース' },
    { key: 'gate',    x: 530, label: 'スターティンググリッド' }
  ];

  /* パドックにいる人。通路側に立っていて、話しかけられる */
  const PEOPLE = [
    { key: 'drv0',  x: 168, label: '' },   // 自チームのドライバー1
    { key: 'drv1',  x: 200, label: '' },   // 自チームのドライバー2
    { key: 'press', x: 320, label: '記者たち' }
  ];

  /* ライバルのドライバーが立っている場所。毎戦ちがう顔ぶれが来る */
  const VISIT = [
    { key: 'poach0', x: 252 },
    { key: 'poach1', x: 372 },
    { key: 'poach2', x: 462 }
  ];

  /* この週にパドックへ来ているライバルのドライバー（3人）
     一度でも接触した相手は来続ける。そうでないと心証を積み上げられない。
     残りの枠は、毎戦ちがう顔ぶれで埋める。                          */
  function visitors(g2) {
    const rv = g2.rivals || [];
    if (!rv.length) return [];
    const picked = [];
    const seen = {};
    const add = (t, d) => {
      if (!t || !d || seen[d.name] || picked.length >= VISIT.length) return;
      seen[d.name] = 1;
      picked.push({ team: t, driver: d });
    };
    // 話をした相手を優先して呼ぶ
    rv.forEach(t => (t.drivers || []).forEach(d => { if (d.interest > 0) add(t, d); }));
    // 残りは毎戦入れ替わる
    const base = (g2.nextRace || 0) * 2;
    for (let k = 0; k < rv.length * 2 && picked.length < VISIT.length; k++) {
      const t = rv[(base + k) % rv.length];
      if (!t || !t.drivers || !t.drivers.length) continue;
      add(t, t.drivers[(base + k) % t.drivers.length]);
    }
    return picked.map((v, i) => ({ spot: VISIT[i], team: v.team, driver: v.driver }));
  }

  /* ガレージ寄りに立っているか（上半分）。ここでは建物を相手にする */
  const NEAR_GARAGE = y => y < WALK.y0 + 26;

  let hitBoxes = [];
  let dusk = false;

  function seeded(n) {
    let h = (n * 2654435761) >>> 0;
    return function () { h = (h * 1103515245 + 12345) >>> 0; return h / 4294967296; };
  }

  function mix(hex, amt) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const c = v => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return 'rgb(' + c((n >> 16) & 255) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
  }

  function mixDark(hex) { return mix(hex, -0.20); }

  /* いま立っている場所から手が届く相手を返す。
     ガレージ寄りならガレージ（自チーム＝入る／他チーム＝覗く）、
     通路側なら人やブースが相手になる。                          */
  function doorOf(x, y, g2) {
    const near = NEAR_GARAGE(y == null ? WALK.y0 : y);
    const cands = [];
    if (near) {
      for (let i = 0; i < 11; i++) {
        cands.push({ key: i === MINE_AT ? 'garage' : ('scout' + i), x: garageX(i) });
      }
    } else {
      SPOTS.forEach(s => cands.push({ key: s.key, x: s.x }));
      PEOPLE.forEach(s => cands.push({ key: s.key, x: s.x }));
      VISIT.forEach(s => cands.push({ key: s.key, x: s.x }));
    }
    let best = null, bd = 1e9;
    cands.forEach(c => {
      const d = Math.abs(x - c.x);
      if (d < 24 && d < bd) { bd = d; best = c; }
    });
    return best;
  }

  function doorPos(key) {
    if (key === 'garage') return { x: garageX(MINE_AT), y: WALK.y0 + 6 };
    if (/^scout(\d+)$/.test(key)) return { x: garageX(parseInt(RegExp.$1, 10)), y: WALK.y0 + 6 };
    const s = SPOTS.concat(PEOPLE).concat(VISIT).find(q => q.key === key);
    return s ? { x: s.x, y: WALK.y0 + 40 } : null;
  }

  function clampWalk(x, y) {
    return { x: Math.max(WALK.x0, Math.min(WALK.x1, x)),
             y: Math.max(WALK.y0, Math.min(WALK.y1, y)) };
  }

  function hit(x, y) {
    for (let i = hitBoxes.length - 1; i >= 0; i--) {
      const b = hitBoxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.key;
    }
    return null;
  }

  /* ---------- 部品 ---------- */
  function sign(g, x, y, text, color) {
    g.font = 'bold 9px sans-serif'; g.textAlign = 'center';
    const w = g.measureText(text).width + 10;
    x = Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, x));
    g.fillStyle = '#241a10'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 13);
    g.fillStyle = color; g.fillRect(x - w / 2, y, w, 11);
    g.fillStyle = '#fff8e3'; g.fillText(text, x, y + 8);
  }

  /* ---------- 全体 ---------- */
  function render(cv, g2, sel) {
    dusk = document.body.getAttribute('data-skin') === 'hd';
    const out = cv.getContext('2d');
    out.imageSmoothingEnabled = false;
    if (dusk) GP.fx.init(W, H);
    const ctx = dusk ? GP.fx.begin() : out;
    ctx.imageSmoothingEnabled = false;
    hitBoxes = [];
    const rnd = seeded(Math.floor(g2.fans) + g2.season * 11 + g2.nextRace * 7);
    // 名前と色しか使わないので、allTeams（コースが要る）は呼ばない。
    // 自チームのガレージは真ん中あたりに固定して、入口の位置を一定にする。
    const rivals = (g2.rivals || []).map(r => ({ name: r.name, color: r.color }));
    const scouted = g2.scouted || [];
    const teams = [];
    for (let i = 0, k = 0; i < 11; i++) {
      if (i === MINE_AT) teams.push({ name: g2.team, color: g2.color, mine: true });
      else teams.push(rivals[k++] || { name: '', color: '#8a8578' });
    }

    /* ---- 奥：コース ---- */
    ctx.fillStyle = dusk ? '#242830' : '#4c5057'; ctx.fillRect(0, 0, W, 62);
    ctx.fillStyle = dusk ? '#2b303a' : '#585d66'; ctx.fillRect(0, 0, W, 4);
    ctx.fillStyle = 'rgba(255,255,255,.30)';                       // コース脇の白線
    ctx.fillRect(0, 52, W, 2);
    ctx.fillStyle = 'rgba(255,255,255,.22)';                       // 中央の破線
    for (let x = 0; x < W; x += 26) ctx.fillRect(x, 28, 14, 2);
    // 路面の粒
    for (let i = 0; i < 420; i++) {
      const x = rnd() * W, y = rnd() * 60;
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.07)';
      ctx.fillRect(x, y, 2, 2);
    }

    /* ---- ピットウォール ---- */
    ctx.fillStyle = dusk ? '#3a3540' : '#8d8578'; ctx.fillRect(0, 62, W, 14);
    ctx.fillStyle = dusk ? '#4a4450' : '#a8a094'; ctx.fillRect(0, 62, W, 4);
    // 壁のスポンサーボード（チームカラーで賑やかす）
    for (let x = 6, i = 0; x < W - 20; x += 44, i++) {
      const t = teams[i % Math.max(1, teams.length)];
      ctx.fillStyle = t ? t.color : '#c0c0c8';
      ctx.fillRect(x, 65, 36, 8);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x, 65, 36, 2);
    }

    /* ---- ピットレーン ---- */
    ctx.fillStyle = dusk ? '#2f333c' : '#6d7078'; ctx.fillRect(0, 76, W, 52);
    ctx.fillStyle = 'rgba(255,255,255,.34)'; ctx.fillRect(0, 78, W, 2);      // 外側の白線
    ctx.fillRect(0, 124, W, 2);                                              // 内側の白線
    ctx.fillStyle = 'rgba(255,255,255,.20)';
    for (let x = 0; x < W; x += 18) ctx.fillRect(x, 100, 9, 1.5);            // 中央の破線
    for (let i = 0; i < 320; i++) {
      const x = rnd() * W, y = 78 + rnd() * 48;
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.07)';
      ctx.fillRect(x, y, 2, 2);
    }

    /* ---- ピットレーンを移動していくマシン ----
       奥のほうなので小さく、かすませて置く                        */
    if (GP.grid && GP.grid.sideCar) {
      [[128, 0.44], [352, 0.44], [520, 0.40]].forEach((v, k) => {
        const t2 = teams[(k * 4 + 2) % teams.length];
        GP.grid.sideCar(ctx, v[0], 118, v[1], (t2 && t2.color) || '#8a8578', 1, false);
      });
      // 奥はうっすら空気の層をかけて距離を出す（かけすぎると車が消える）
      ctx.fillStyle = dusk ? 'rgba(46,50,68,.16)' : 'rgba(186,200,216,.14)';
      ctx.fillRect(0, 76, W, 52);
    }

    /* ---- ガレージ（チームごとに1つ並ぶ）---- */
    const gw = GW, gy = 246;
    for (let i = 0; i < 11; i++) {
      const gx = 4 + i * GSTEP;
      const t = teams[i];
      const mine = !!(t && t.mine);
      const wall = dusk ? '#2f2b38' : '#b8b2a4';
      // 本体
      ctx.fillStyle = '#241a10'; ctx.fillRect(gx - 1, 128 - 1, gw + 2, gy - 128 + 2);
      ctx.fillStyle = wall; ctx.fillRect(gx, 128, gw, gy - 128);
      ctx.fillStyle = 'rgba(255,246,220,.14)'; ctx.fillRect(gx, 128, gw * 0.3, gy - 128);
      ctx.fillStyle = 'rgba(40,24,10,.20)'; ctx.fillRect(gx + gw * 0.76, 128, gw * 0.24, gy - 128);
      // 屋根の帯（チームカラー）
      ctx.fillStyle = t ? t.color : '#8a8578'; ctx.fillRect(gx, 128, gw, 12);
      ctx.fillStyle = 'rgba(255,255,255,.30)'; ctx.fillRect(gx, 128, gw, 3);
      // シャッター（自チームだけ開いていて、中が見える）
      const sx = gx + 7, sw = gw - 14;
      ctx.fillStyle = '#2a2d34'; ctx.fillRect(sx - 1, 152, sw + 2, gy - 156);
      if (mine) {
        ctx.fillStyle = dusk ? '#514634' : '#7c7462';                        // ガレージの中
        ctx.fillRect(sx, 156, sw, gy - 162);
        ctx.fillStyle = 'rgba(255,236,180,.42)';                             // 天井の照明
        ctx.fillRect(sx, 156, sw, 8);
        ctx.fillStyle = 'rgba(255,236,180,.16)';
        ctx.fillRect(sx, 164, sw, gy - 170);
        // 整備中のマシン（上から見た形を簡略化）
        ctx.fillStyle = mix(t.color, -0.18); ctx.fillRect(sx + 7, 196, sw - 14, 26);
        ctx.fillStyle = t.color; ctx.fillRect(sx + 9, 196, sw - 18, 26);
        ctx.fillStyle = '#17181c';
        ctx.fillRect(sx + 3, 200, 5, 8); ctx.fillRect(sx + sw - 8, 200, 5, 8);
        ctx.fillRect(sx + 3, 214, 5, 8); ctx.fillRect(sx + sw - 8, 214, 5, 8);
        ctx.fillStyle = '#2b2e36'; ctx.fillRect(sx + 5, 192, sw - 10, 3);    // フロントウイング
        ctx.fillRect(sx + 6, 224, sw - 12, 3);                               // リアウイング
      } else if ((i * 7 + 3) % 11 < 6) {
        // 半分ほどのガレージは開いていて、中で仕上げているマシンが見える。
        // 「他所の車の間を歩いている」という感じは、ここで作られる
        ctx.fillStyle = dusk ? '#3b3346' : '#5f5a52';
        ctx.fillRect(sx, 156, sw, gy - 162);
        ctx.fillStyle = 'rgba(255,236,180,.30)';                             // 天井の照明
        ctx.fillRect(sx, 156, sw, 6);
        ctx.fillStyle = 'rgba(255,236,180,.10)';
        ctx.fillRect(sx, 162, sw, gy - 172);
        // 横から見たマシン。奥まっているので少し暗く小さく
        if (GP.grid && GP.grid.sideCar) {
          ctx.save();
          ctx.beginPath(); ctx.rect(sx, 156, sw, gy - 162); ctx.clip();
          GP.grid.sideCar(ctx, gx + gw / 2, gy - 16, 0.62,
                          t ? t.color : '#8a8578', 1, true);
          ctx.restore();
        }
        // シャッターは上まで上がっている
        ctx.fillStyle = dusk ? '#2a2530' : '#8a9098';
        ctx.fillRect(sx, 152, sw, 6);
      } else {
        ctx.fillStyle = dusk ? '#3a3f4a' : '#9aa0a8';                        // 閉じたシャッター
        ctx.fillRect(sx, 156, sw, gy - 162);
        ctx.fillStyle = 'rgba(0,0,0,.16)';
        for (let yy = 158; yy < gy - 8; yy += 4) ctx.fillRect(sx, yy, sw, 1.5);
      }
      // チーム名の板。屋根帯の下に敷いて読めるようにする
      if (t && t.name) {
        ctx.fillStyle = 'rgba(20,14,8,.62)';
        ctx.fillRect(gx + 3, 141, gw - 6, 11);
        ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = mine ? '#ffe9b0' : '#e2dccc';
        ctx.fillText(t.name.slice(0, 5), gx + gw / 2, 149.5);
      }

      // ガレージ前の機材と人。並びが単調にならないよう、区画ごとに変える
      const r2 = seeded(i * 977 + 31);
      if (r2() < 0.75) {                                   // 積んだタイヤ
        const tx = gx + 8 + r2() * (gw - 20);
        for (let k = 0; k < 2 + Math.floor(r2() * 2); k++) {
          ctx.fillStyle = '#15161a'; ctx.fillRect(tx, gy - 8 - k * 4, 13, 5);
          ctx.fillStyle = k % 2 ? '#2a2c33' : '#22242a'; ctx.fillRect(tx, gy - 8 - k * 4, 13, 1.6);
        }
      }
      if (r2() < 0.6) {                                    // 工具箱
        const bx2 = gx + 6 + r2() * (gw - 22);
        ctx.fillStyle = '#241a10'; ctx.fillRect(bx2 - 1, gy - 12, 13, 10);
        ctx.fillStyle = t ? t.color : '#7a8088'; ctx.fillRect(bx2, gy - 11, 11, 8);
        ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(bx2, gy - 11, 11, 2);
      }
      if (r2() < 0.7) {                                    // 立っているクルー
        const cx2 = gx + 10 + r2() * (gw - 24), cy2 = gy - 4;
        const cc = t ? t.color : '#7a8088';
        ctx.fillStyle = 'rgba(0,0,0,.26)'; ctx.fillRect(cx2 - 3, cy2 + 1, 6, 2);
        ctx.fillStyle = mixDark(cc); ctx.fillRect(cx2 - 3, cy2 - 8, 6, 8);
        ctx.fillStyle = cc; ctx.fillRect(cx2 - 3, cy2 - 8, 6, 3.5);
        ctx.fillStyle = '#e8b98e'; ctx.fillRect(cx2 - 2.4, cy2 - 12, 5, 4);   // 顔
        ctx.fillStyle = '#3a2718'; ctx.fillRect(cx2 - 2.4, cy2 - 12.6, 5, 2); // 髪
      }
      if (mine) {
        hitBoxes.push({ key: 'garage', x: gx - 2, y: 126, w: gw + 4, h: gy - 124 });
      } else {
        hitBoxes.push({ key: 'scout' + i, x: gx - 2, y: 126, w: gw + 4, h: gy - 124 });
        // すでに覗いたガレージには印を出す（同じ週に何度も稼げないので）
        if (scouted.indexOf(t && t.name) >= 0) {
          ctx.fillStyle = 'rgba(20,14,8,.55)';
          ctx.fillRect(gx + gw / 2 - 11, 156, 22, 16);
          ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
          ctx.fillStyle = '#8fe08a';
          ctx.fillText('✓', gx + gw / 2, 168);
        }
      }
    }

    /* ---- 手前：パドックの通路 ---- */
    ctx.fillStyle = dusk ? '#3e3948' : '#a8a294'; ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = dusk ? '#443f50' : '#b2ac9e';
    for (let x = 0; x < W; x += 26) ctx.fillRect(x, gy, 24, H - gy);
    ctx.fillStyle = 'rgba(40,24,10,.28)'; ctx.fillRect(0, gy, W, 3);

    /* ---- ドライバーの控え（モーターホーム）---- */
    (function () {
      const x = 58, y = 262, w = 70, h = 42;
      ctx.fillStyle = '#241a10'; ctx.fillRect(x - 1, y - h - 1, w + 2, h + 2);
      ctx.fillStyle = dusk ? '#3a3646' : '#e4dccc'; ctx.fillRect(x, y - h, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(x, y - h, w * 0.3, h);
      ctx.fillStyle = g2.color; ctx.fillRect(x, y - h, w, 9);
      ctx.fillStyle = 'rgba(255,255,255,.30)'; ctx.fillRect(x, y - h, w, 2.5);
      for (let a = 5; a < w - 8; a += 15) {                                  // 窓
        ctx.fillStyle = 'rgba(50,36,20,.5)'; ctx.fillRect(x + a - 1, y - h + 13, 11, 11);
        ctx.fillStyle = dusk ? 'rgba(255,238,170,.9)' : 'rgba(150,200,230,.85)';
        ctx.fillRect(x + a, y - h + 14, 9, 9);
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x + a, y - h + 14, 9, 3);
      }
      ctx.fillStyle = '#5c5548'; ctx.fillRect(x + w - 18, y - 16, 12, 16);   // 入口
      ctx.fillStyle = '#7a7264'; ctx.fillRect(x + w - 18, y - 16, 12, 2);
      hitBoxes.push({ key: 'drivers', x: x - 2, y: y - h - 2, w: w + 4, h: h + 4 });
    })();

    /* ---- タイミングブース ---- */
    (function () {
      const x = 376, y = 258, w = 48, h = 34;
      ctx.fillStyle = '#241a10'; ctx.fillRect(x - 1, y - h - 1, w + 2, h + 2);
      ctx.fillStyle = dusk ? '#2e3a44' : '#9ab0bc'; ctx.fillRect(x, y - h, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(x, y - h, w * 0.3, h);
      ctx.fillStyle = '#3a4650'; ctx.fillRect(x, y - h, w, 8);
      // モニター（順位表が流れている）
      ctx.fillStyle = '#12161c'; ctx.fillRect(x + 5, y - h + 12, w - 10, 16);
      for (let r = 0; r < 4; r++) {
        ctx.fillStyle = r === 0 ? '#ffd24a' : 'rgba(120,220,255,.75)';
        ctx.fillRect(x + 7, y - h + 14 + r * 4, 6 + (r * 7) % 18, 2);
      }
      hitBoxes.push({ key: 'timing', x: x - 2, y: y - h - 2, w: w + 4, h: h + 4 });
    })();

    /* ---- コースへの出口 ---- */
    (function () {
      const x = 512, y = 254;
      ctx.fillStyle = '#241a10'; ctx.fillRect(x - 1, y - 44 - 1, 5, 46);
      ctx.fillStyle = '#8d8578'; ctx.fillRect(x, y - 44, 3, 44);            // 支柱
      ctx.fillRect(x + 34, y - 44, 3, 44);
      ctx.fillStyle = '#241a10'; ctx.fillRect(x - 2, y - 48, 41, 12);
      ctx.fillStyle = dusk ? '#4a3f2a' : '#d8d2c0'; ctx.fillRect(x - 1, y - 47, 39, 10);
      ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = dusk ? '#ffe9b0' : '#3a2f1a';
      ctx.fillText('PIT OUT', x + 18, y - 39);
      // 路面の矢印
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      for (let k = 0; k < 3; k++) ctx.fillRect(x + 10, y + 4 + k * 7, 16, 3);
      hitBoxes.push({ key: 'gate', x: x - 4, y: y - 50, w: 46, h: 56 });
    })();

    /* ---- 通路の小物 ---- */
    const tyreStack = (tx, ty, n) => {
      for (let i = 0; i < n; i++) {
        const yy = ty - i * 5;
        ctx.fillStyle = '#15161a'; ctx.fillRect(tx - 8, yy - 5, 16, 6);
        ctx.fillStyle = i % 2 ? '#2a2c33' : '#22242a'; ctx.fillRect(tx - 8, yy - 5, 16, 2);
      }
    };
    tyreStack(160, 318, 4); tyreStack(182, 318, 3);
    tyreStack(330, 316, 3); tyreStack(468, 318, 4);
    const crate = (cx, cy, cw, ch, c) => {
      ctx.fillStyle = '#241a10'; ctx.fillRect(cx - 1, cy - ch - 1, cw + 2, ch + 2);
      ctx.fillStyle = c; ctx.fillRect(cx, cy - ch, cw, ch);
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(cx, cy - ch, cw, 2);
    };
    crate(276, 320, 22, 13, g2.color);
    crate(302, 320, 16, 10, '#6a7078');
    crate(432, 320, 18, 11, '#6a7078');

    /* ---- パドックにいる人 ----
       自チームのドライバーは通路にいて、話しかけると気持ちが聞ける。
       記者は取材を待っている。                                     */
    const person = (x, y, suit, hair, face) => {
      ctx.fillStyle = 'rgba(0,0,0,.30)';
      ctx.beginPath(); ctx.ellipse(x, y, 7, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = mix(suit, -0.20); ctx.fillRect(x - 5, y - 21, 10, 21);
      ctx.fillStyle = suit;             ctx.fillRect(x - 5, y - 21, 10, 8);
      ctx.fillStyle = 'rgba(255,255,255,.24)'; ctx.fillRect(x - 5, y - 21, 10, 2);
      ctx.fillStyle = '#2c3140'; ctx.fillRect(x - 5, y - 9, 4, 9);    // 脚
      ctx.fillRect(x + 1, y - 9, 4, 9);
      ctx.fillStyle = face;  ctx.fillRect(x - 4, y - 29, 8, 8);       // 顔
      ctx.fillStyle = hair;  ctx.fillRect(x - 4, y - 30, 8, 4);       // 髪
      ctx.fillStyle = '#2a2028'; ctx.fillRect(x - 3, y - 26, 2, 2);
      ctx.fillStyle = '#2a2028'; ctx.fillRect(x + 1, y - 26, 2, 2);
    };
    const py = WALK.y1 - 4;
    const spoke = k => (g2.talked || []).indexOf(k) >= 0;
    const mark = (x, y) => { if (GP.base && GP.base.doneMark) GP.base.doneMark(ctx, x, y); };
    (g2.drivers || []).slice(0, 2).forEach((d, i) => {
      person(PEOPLE[i].x, py, g2.color, '#3a2718', '#f0c49a');
      if (spoke('talk:' + d.id)) mark(PEOPLE[i].x + 12, py - 24);
      hitBoxes.push({ key: PEOPLE[i].key, x: PEOPLE[i].x - 12, y: py - 32, w: 24, h: 34 });
      // ヘルメットを小脇に抱えている
      ctx.fillStyle = mix(g2.color, 0.18);
      ctx.fillRect(PEOPLE[i].x + 5, py - 15, 7, 7);
      ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(PEOPLE[i].x + 5, py - 15, 7, 2);
    });
    // ライバルのドライバー。自チームの色ではなく、その人のチームの色を着ている
    visitors(g2).forEach(v => {
      person(v.spot.x, py, v.team.color, '#2b1d12', '#ecc196');
      if (spoke('poach:' + v.team.name + ':' + v.driver.name)) mark(v.spot.x + 12, py - 24);
      // 胸元にチームカラーの識別帯
      ctx.fillStyle = mix(v.team.color, 0.28);
      ctx.fillRect(v.spot.x - 5, py - 14, 10, 2);
      hitBoxes.push({ key: v.spot.key, x: v.spot.x - 12, y: py - 32, w: 24, h: 34 });
      // 誰なのか分かるように名札を出す
      sign(ctx, v.spot.x, py - 46, v.driver.name,
           sel === v.spot.key ? '#e04a3f' : '#3f3a30');
    });

    // 記者たち（カメラを持っている）
    if (spoke('press')) mark(PEOPLE[2].x + 24, py - 24);
    hitBoxes.push({ key: 'press', x: PEOPLE[2].x - 24, y: py - 34, w: 48, h: 36 });
    [0, 1, 2].forEach(k => {
      const x = PEOPLE[2].x - 14 + k * 14;
      person(x, py + (k === 1 ? 0 : 2), ['#4a5060', '#3f4652', '#55505e'][k], '#241c14', '#e8bd94');
      if (k === 1) {
        ctx.fillStyle = '#1b1e26'; ctx.fillRect(x - 6, py - 26, 12, 7);
        ctx.fillStyle = '#3a4048'; ctx.fillRect(x + 4, py - 25, 4, 5);
        ctx.fillStyle = 'rgba(200,230,255,.7)'; ctx.fillRect(x + 6, py - 24, 2, 3);
      }
    });

    /* ---- 看板 ---- */
    sign(ctx, garageX(MINE_AT), 110, '自チームのガレージ',
         sel === 'garage' ? '#e04a3f' : '#4a2f1a');
    SPOTS.forEach((sp, i) => {
      sign(ctx, sp.x, [198, 202, 184][i], sp.label, sel === sp.key ? '#e04a3f' : '#4a2f1a');
    });
    sign(ctx, PEOPLE[2].x, WALK.y1 - 40, '記者たち', sel === 'press' ? '#e04a3f' : '#4a2f1a');
    if (sel && /^scout(\d+)$/.test(sel)) {
      const i = parseInt(RegExp.$1, 10);
      const t = teams[i];
      sign(ctx, garageX(i), 110, (t && t.name ? t.name : 'ライバル') + ' を覗く', '#e04a3f');
    }

    /* ---- 選択中の場所を囲む ---- */
    if (sel) {
      const b = hitBoxes.find(h2 => h2.key === sel);
      if (b) {
        ctx.strokeStyle = '#fff34d'; ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
        ctx.setLineDash([]);
      }
    }

    /* ---- 光と、手前の抜け ----
       通路に光を落とし、画面の縁を落として視線を集める。
       いちばん手前には、ピントの外にある機材を大きく置く       */
    (function () {
      const pool = ctx.createRadialGradient(300, WALK.y1 - 6, 40, 300, WALK.y1 - 6, 340);
      pool.addColorStop(0, 'rgba(255,226,168,' + (dusk ? '.16' : '.20') + ')');
      pool.addColorStop(0.6, 'rgba(255,214,150,.05)');
      pool.addColorStop(1, 'rgba(255,214,150,0)');
      ctx.fillStyle = pool; ctx.fillRect(0, 120, W, H - 120);
      // 手前のタイヤの山（形だけの黒い塊）
      ctx.fillStyle = 'rgba(10,9,14,.80)';
      for (let k = 0; k < 4; k++) ctx.fillRect(6, H - 30 + k * 8, 52, 7);
      ctx.fillRect(W - 74, H - 22, 60, 22);
      const v2 = ctx.createLinearGradient(0, 0, 0, H);
      v2.addColorStop(0, 'rgba(10,8,16,.22)');
      v2.addColorStop(0.5, 'rgba(10,8,16,0)');
      v2.addColorStop(1, 'rgba(10,8,16,.30)');
      ctx.fillStyle = v2; ctx.fillRect(0, 0, W, H);
      const h2 = ctx.createLinearGradient(0, 0, W, 0);
      h2.addColorStop(0, 'rgba(10,8,16,.30)');
      h2.addColorStop(0.22, 'rgba(10,8,16,0)');
      h2.addColorStop(0.78, 'rgba(10,8,16,0)');
      h2.addColorStop(1, 'rgba(10,8,16,.30)');
      ctx.fillStyle = h2; ctx.fillRect(0, 0, W, H);
    })();

    if (!dusk) return;
    // 夕暮れの空気
    const air = ctx.createLinearGradient(0, 40, 0, H);
    air.addColorStop(0, 'rgba(255,168,86,.20)');
    air.addColorStop(0.5, 'rgba(150,110,190,.10)');
    air.addColorStop(1, 'rgba(40,26,64,.28)');
    ctx.fillStyle = air; ctx.fillRect(0, 0, W, H);
    GP.fx.composite(out, { dof: 0, bloom: 1.0, warm: 1.0, vignette: 1.0, night: true });
  }

  /* ---------- 背景のキャッシュ（本拠地と同じ考え方）---------- */
  let cache = null, cacheKey = '';

  function keyOf(g2, sel) {
    return [document.body.getAttribute('data-skin'), sel || '',
            Math.floor(g2.fans), g2.season, g2.nextRace, g2.color, g2.team,
            (g2.scouted || []).join(','),
            (g2.talked || []).join(','),
            visitors(g2).map(v => v.driver.name).join(',')].join('|');
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

  return { render, scene, drawWith, invalidate, hit, visitors,
           doorOf, doorPos, clampWalk, WALK, SPOTS, PEOPLE, VISIT, MINE_AT, garageX, W, H };
})();

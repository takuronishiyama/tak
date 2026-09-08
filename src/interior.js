/* =========================================================
   施設の内装
   拠点の建物に入ったときに見える部屋。
   施設レベルが上がると、機材が増え、人が増え、部屋そのものが広がる。
   横から見た絵で、いちばん手前に自分（チームプリンシパル）が立つ。
   ========================================================= */
window.GP = window.GP || {};

GP.interior = (function () {
  'use strict';

  const W = 520, H = 190;

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

  /* 働いている人。レベルが上がるほど増える */
  function worker(g, x, y, col, phase) {
    const bob = Math.sin(phase) * 0.8;
    g.fillStyle = 'rgba(0,0,0,.26)'; g.fillRect(x - 4, y + 1, 8, 2);
    g.fillStyle = mix(col, -0.20); g.fillRect(x - 4, y - 13 + bob, 8, 13);
    g.fillStyle = col;             g.fillRect(x - 4, y - 13 + bob, 8, 5);
    g.fillStyle = '#e8b98e';       g.fillRect(x - 3, y - 19 + bob, 6, 6);   // 顔
    g.fillStyle = '#3a2718';       g.fillRect(x - 3, y - 20 + bob, 6, 3);   // 髪
  }

  /* 部屋の枠。レベルが上がるほど天井が高く、明かりが増える */
  function room(g, lv, tint, dusk) {
    const grow = Math.min(1, (lv - 1) / 9);
    const floorY = H - 22;
    // 奥の壁
    g.fillStyle = dusk ? '#2a2436' : '#cfc6b2';
    g.fillRect(0, 0, W, floorY);
    g.fillStyle = dusk ? '#312b3e' : '#d8cfbb';
    g.fillRect(0, 0, W, 16 + grow * 10);                       // 天井
    // 壁の帯（チームカラー）
    g.fillStyle = tint;
    g.fillRect(0, 22 + grow * 10, W, 5);
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.fillRect(0, 22 + grow * 10, W, 1.5);
    // 天井の照明。レベルで数が増える
    const lamps = 2 + Math.round(grow * 4);
    for (let i = 0; i < lamps; i++) {
      const x = (i + 0.5) * (W / lamps);
      g.fillStyle = '#5c5648'; g.fillRect(x - 1, 0, 2, 6);
      g.fillStyle = '#fff6d8'; g.fillRect(x - 9, 6, 18, 4);
      const gl = g.createRadialGradient(x, 10, 2, x, 10, 46);
      gl.addColorStop(0, 'rgba(255,240,190,.28)');
      gl.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = gl; g.fillRect(x - 46, 6, 92, 70);
    }
    // 床
    g.fillStyle = dusk ? '#3a3346' : '#9a9384';
    g.fillRect(0, floorY, W, H - floorY);
    g.fillStyle = dusk ? '#413a4e' : '#a49d8c';
    for (let x = 0; x < W; x += 30) g.fillRect(x, floorY, 28, H - floorY);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, floorY, W, 2);
    return floorY;
  }

  /* ---------- 施設ごとの中身 ---------- */
  const ROOMS = {
    /* ファクトリー：作業台とマシン、レベルが上がると設備が並ぶ */
    factory: function (g, lv, col, fy, rnd) {
      const n = Math.min(5, 1 + Math.floor(lv / 2.2));
      for (let i = 0; i < n; i++) {                     // 部品棚
        const x = 14 + i * 42;
        g.fillStyle = '#4a4034'; g.fillRect(x, fy - 46, 34, 46);
        g.fillStyle = '#5e5344'; g.fillRect(x + 1, fy - 45, 32, 44);
        for (let r = 0; r < 3; r++) {
          g.fillStyle = '#3a3229'; g.fillRect(x + 2, fy - 42 + r * 14, 30, 2);
          for (let c = 0; c < 3; c++) {
            if (((i + r + c) % 4) === 0) continue;
            g.fillStyle = ['#8d94a0', col, '#a08860'][(i + c) % 3];
            g.fillRect(x + 4 + c * 10, fy - 40 + r * 14, 7, 8);
          }
        }
      }
      // 組み立て中のマシン
      const cx = W - 150, cy = fy - 8;
      g.fillStyle = '#3a3d46'; g.fillRect(cx - 4, cy - 4, 118, 6);          // 作業台
      g.fillRect(cx + 4, cy + 2, 6, 6); g.fillRect(cx + 96, cy + 2, 6, 6);
      g.fillStyle = mix(col, -0.18); g.fillRect(cx + 10, cy - 20, 86, 16);
      g.fillStyle = col; g.fillRect(cx + 14, cy - 20, 78, 12);
      g.fillStyle = 'rgba(255,255,255,.30)'; g.fillRect(cx + 14, cy - 20, 78, 3);
      g.fillStyle = '#17181c';
      g.fillRect(cx + 16, cy - 10, 14, 8); g.fillRect(cx + 76, cy - 10, 14, 8);
      g.fillStyle = '#2b2e36'; g.fillRect(cx + 4, cy - 24, 14, 4);          // ウイング
      g.fillRect(cx + 92, cy - 26, 16, 5);
      if (lv >= 5) {                                                        // ロボットアーム
        g.fillStyle = '#f0a020'; g.fillRect(cx + 44, fy - 74, 6, 30);
        g.fillRect(cx + 44, fy - 76, 26, 6);
        g.fillStyle = '#8d94a0'; g.fillRect(cx + 66, fy - 74, 5, 14);
      }
      return [30, 100, W - 60].slice(0, 1 + Math.floor(lv / 3));
    },

    /* 風洞：送風管と、模型を載せた台 */
    tunnel: function (g, lv, col, fy, rnd) {
      const r = 30 + lv * 2.2;
      const cx = 96, cy = fy - r - 6;
      g.fillStyle = '#3a3f48';
      g.beginPath(); g.arc(cx, cy, r + 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#8d959e';
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5f6870';
      g.beginPath(); g.arc(cx, cy, r * 0.42, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#dfe6ec'; g.lineWidth = 3;                           // 羽根
      for (let a = 0; a < 5; a++) {
        const t = a * Math.PI * 2 / 5 + lv * 0.4;
        g.beginPath(); g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(t) * r * 0.8, cy + Math.sin(t) * r * 0.8); g.stroke();
      }
      // 風の筋。レベルが上がるほど本数が増える
      const lines = 3 + Math.floor(lv * 0.7);
      for (let i = 0; i < lines; i++) {
        const y = cy - r + (i + 0.5) * (r * 2 / lines);
        g.fillStyle = 'rgba(200,230,255,' + (0.16 + (i % 3) * 0.06).toFixed(2) + ')';
        g.fillRect(cx + r + 8, y, 130 + (i % 4) * 26, 2);
      }
      // 模型を載せた台
      const mx = W - 150;
      g.fillStyle = '#3a3d46'; g.fillRect(mx, fy - 10, 110, 10);
      g.fillStyle = mix(col, -0.16); g.fillRect(mx + 18, fy - 24, 70, 12);
      g.fillStyle = col; g.fillRect(mx + 22, fy - 24, 62, 9);
      g.fillStyle = '#17181c';
      g.fillRect(mx + 24, fy - 16, 11, 6); g.fillRect(mx + 72, fy - 16, 11, 6);
      if (lv >= 4) {                                                        // 計測モニター
        g.fillStyle = '#241a10'; g.fillRect(W - 62, fy - 74, 52, 36);
        g.fillStyle = '#12202c'; g.fillRect(W - 60, fy - 72, 48, 32);
        for (let i = 0; i < 4; i++) {
          g.fillStyle = 'rgba(120,220,255,.7)';
          g.fillRect(W - 56, fy - 66 + i * 7, 10 + (i * 11) % 30, 3);
        }
      }
      return [200, 300, 380].slice(0, 1 + Math.floor(lv / 4));
    },

    /* シミュレーター：ドーム型の機体と画面 */
    sim: function (g, lv, col, fy, rnd) {
      const n = lv >= 7 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const x = 70 + i * 170;
        g.fillStyle = '#3a3d46'; g.fillRect(x - 44, fy - 12, 88, 12);       // 土台
        g.fillStyle = '#4e535e';
        for (let k = 0; k < 3; k++) g.fillRect(x - 34 + k * 30, fy - 30, 8, 20);  // 脚
        g.fillStyle = mix(col, -0.22);
        g.beginPath(); g.ellipse(x, fy - 34, 42, 26, 0, Math.PI, 0); g.fill();
        g.fillStyle = col;
        g.beginPath(); g.ellipse(x, fy - 34, 38, 22, 0, Math.PI, 0); g.fill();
        g.fillStyle = 'rgba(255,255,255,.28)';
        g.beginPath(); g.ellipse(x - 10, fy - 42, 16, 8, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#12202c'; g.fillRect(x - 26, fy - 36, 52, 14);        // 画面
        g.fillStyle = 'rgba(120,220,255,.55)';
        g.fillRect(x - 22, fy - 32, 44, 2); g.fillRect(x - 18, fy - 28, 30, 2);
      }
      if (lv >= 3) {                                                         // 解析席
        const dx = W - 130;
        g.fillStyle = '#4a4034'; g.fillRect(dx, fy - 22, 96, 22);
        g.fillStyle = '#241a10'; g.fillRect(dx + 8, fy - 52, 36, 30);
        g.fillStyle = '#12202c'; g.fillRect(dx + 10, fy - 50, 32, 26);
        g.fillStyle = '#241a10'; g.fillRect(dx + 52, fy - 46, 36, 24);
        g.fillStyle = '#12202c'; g.fillRect(dx + 54, fy - 44, 32, 20);
        for (let i = 0; i < 3; i++) {
          g.fillStyle = 'rgba(120,220,255,.6)';
          g.fillRect(dx + 13, fy - 46 + i * 7, 8 + (i * 9) % 20, 2);
        }
      }
      return [150, 250, 340].slice(0, 1 + Math.floor(lv / 4));
    },

    /* マーケティング室：机とスポンサーの壁、トロフィー */
    market: function (g, lv, col, fy, rnd) {
      const desks = Math.min(4, 1 + Math.floor(lv / 2.6));
      for (let i = 0; i < desks; i++) {
        const x = 24 + i * 74;
        g.fillStyle = '#4a4034'; g.fillRect(x, fy - 20, 58, 20);
        g.fillStyle = '#5e5344'; g.fillRect(x + 1, fy - 19, 56, 6);
        g.fillStyle = '#241a10'; g.fillRect(x + 12, fy - 40, 26, 20);        // 画面
        g.fillStyle = '#12202c'; g.fillRect(x + 14, fy - 38, 22, 16);
        g.fillStyle = 'rgba(120,220,255,.55)'; g.fillRect(x + 16, fy - 34, 14, 2);
      }
      // スポンサーの壁
      const cols = 3 + Math.floor(lv * 0.6);
      for (let i = 0; i < cols; i++) {
        const x = W - 180 + (i % 4) * 44, y = 40 + Math.floor(i / 4) * 22;
        if (x > W - 12) continue;
        g.fillStyle = ['#e04a3f', '#3a7ad9', '#4ea63f', '#ffc93c', '#b06fd0'][i % 5];
        g.fillRect(x, y, 38, 16);
        g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, y, 38, 4);
      }
      if (lv >= 4) {                                                         // トロフィー棚
        const tx = W - 96;
        g.fillStyle = '#4a4034'; g.fillRect(tx, fy - 46, 84, 46);
        g.fillStyle = '#3a3229'; g.fillRect(tx + 2, fy - 30, 80, 2);
        for (let i = 0; i < Math.min(6, lv - 2); i++) {
          const x = tx + 8 + (i % 3) * 26, y = fy - (i < 3 ? 32 : 4);
          g.fillStyle = '#e8c24a'; g.fillRect(x, y - 12, 10, 8);
          g.fillRect(x + 3, y - 5, 4, 4); g.fillRect(x, y - 2, 10, 2);
          g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(x + 1, y - 11, 3, 6);
        }
      }
      return [60, 140, 220].slice(0, 1 + Math.floor(lv / 3));
    },

    /* ユース：カートと黒板 */
    youth: function (g, lv, col, fy, rnd) {
      g.fillStyle = '#241a10'; g.fillRect(20, 40, 130, 62);                  // 黒板
      g.fillStyle = '#26463a'; g.fillRect(23, 43, 124, 56);
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.fillRect(32, 54, 60, 2); g.fillRect(32, 62, 88, 2); g.fillRect(32, 70, 44, 2);
      // コースの見取り図らしきもの
      g.strokeStyle = 'rgba(255,220,120,.7)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(36, 88); g.lineTo(70, 80); g.lineTo(104, 92); g.lineTo(134, 82); g.stroke();
      // カート。レベルで台数が増える
      const karts = Math.min(4, 1 + Math.floor(lv / 2.6));
      for (let i = 0; i < karts; i++) {
        const x = 190 + i * 78, y = fy - 4;
        g.fillStyle = '#17181c';
        g.fillRect(x - 18, y - 8, 8, 8); g.fillRect(x + 10, y - 8, 8, 8);
        g.fillStyle = mix(col, -0.18); g.fillRect(x - 14, y - 16, 30, 9);
        g.fillStyle = ['#e04a3f', '#3a7ad9', '#4ea63f', '#ffc93c'][i % 4];
        g.fillRect(x - 12, y - 16, 26, 6);
        g.fillStyle = '#2b2e36'; g.fillRect(x - 4, y - 22, 8, 6);            // シート
        g.fillStyle = 'rgba(255,255,255,.30)'; g.fillRect(x - 12, y - 16, 26, 2);
      }
      return [170, 260, 350].slice(0, 1 + Math.floor(lv / 3));
    },

    /* ピット設備：ジャッキに載ったマシンと工具棚 */
    pit: function (g, lv, col, fy, rnd) {
      const cx = 150, cy = fy - 16;
      g.fillStyle = '#3a3d46'; g.fillRect(cx - 66, cy + 8, 132, 8);          // ジャッキ
      g.fillRect(cx - 58, cy + 2, 10, 8); g.fillRect(cx + 48, cy + 2, 10, 8);
      g.fillStyle = mix(col, -0.18); g.fillRect(cx - 56, cy - 16, 112, 18);
      g.fillStyle = col; g.fillRect(cx - 52, cy - 16, 104, 13);
      g.fillStyle = 'rgba(255,255,255,.30)'; g.fillRect(cx - 52, cy - 16, 104, 3);
      g.fillStyle = '#2b2e36'; g.fillRect(cx - 66, cy - 20, 16, 5);
      g.fillRect(cx + 50, cy - 22, 18, 6);
      // 外したタイヤ
      for (let i = 0; i < 4; i++) {
        const x = cx - 40 + i * 26;
        g.fillStyle = '#17181c'; g.fillRect(x, fy - 8, 18, 8);
        g.fillStyle = '#2a2c33'; g.fillRect(x, fy - 8, 18, 2);
      }
      // 工具棚。レベルで増える
      const cab = Math.min(4, 1 + Math.floor(lv / 2.6));
      for (let i = 0; i < cab; i++) {
        const x = W - 40 - i * 46;
        g.fillStyle = '#241a10'; g.fillRect(x - 1, fy - 43, 38, 43);
        g.fillStyle = mix(col, -0.05); g.fillRect(x, fy - 42, 36, 42);
        for (let r = 0; r < 4; r++) {
          g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(x + 2, fy - 38 + r * 10, 32, 2);
          g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x + 14, fy - 35 + r * 10, 8, 2);
        }
      }
      return [70, 240, 330].slice(0, 1 + Math.floor(lv / 3));
    }
  };

  /* ---------- 描画 ---------- */
  function render(cv, g2, key) {
    const dusk = document.body.getAttribute('data-skin') === 'hd';
    const lv = Math.max(1, Math.min(10, (g2.facilities && g2.facilities[key]) || 1));
    const out = cv.getContext('2d');
    out.imageSmoothingEnabled = false;
    if (dusk) GP.fx.init(W, H);
    const g = dusk ? GP.fx.begin() : out;
    g.imageSmoothingEnabled = false;
    const rnd = seeded(lv * 31 + key.length * 7);
    const col = g2.color || '#e04a3f';

    const fy = room(g, lv, col, dusk);
    const spots = (ROOMS[key] || ROOMS.factory)(g, lv, col, fy, rnd);

    // 働いている人。レベルが上がるほど増える
    (spots || []).forEach((x, i) => worker(g, x, fy, col, i * 1.7 + lv));

    // いちばん手前に自分が立つ
    if (GP.base && GP.base.drawActor) {
      GP.base.drawActor(g, { x: W - 34, y: H - 6, dir: 'left', frame: 0,
                             moving: false, color: col });
    }

    // レベルの表示
    g.font = 'bold 10px sans-serif'; g.textAlign = 'left';
    g.fillStyle = 'rgba(20,14,8,.62)'; g.fillRect(6, 6, 62, 14);
    g.fillStyle = '#ffe9b0'; g.fillText('Lv.' + lv + ' / 10', 11, 16);

    if (!dusk) return;
    GP.fx.composite(out, { dof: 0, bloom: 0.9, warm: 1.0, vignette: 0.85, night: true });
  }

  return { render, W, H };
})();

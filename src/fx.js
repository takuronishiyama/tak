/* =========================================================
   HD-2D風のポストエフェクト
   ドット絵はドット絵のまま、上から光と空気を足して立体感を出す。
     1. ブルーム   明るい色だけがにじんで光る
     2. 被写界深度 カメラが見ていない所がぼける（ジオラマ感）
     3. 色調      ハイライトを暖色に、影を寒色に寄せる
     4. 周辺減光   画面の四隅を落として中央に目を向けさせる
     5. 粒子      火花・砂ぼこり・水しぶき
   canvas 2D の filter と合成モードだけで作れるので、追加ライブラリは要らない。
   ========================================================= */
window.GP = window.GP || {};

GP.fx = (function () {
  'use strict';

  let W = 0, H = 0;
  let scene = null, sctx = null;      // 世界を一度描き込む場所
  let half = null, hctx = null;       // ブルーム抽出用（半分の解像度）
  let half2 = null, h2ctx = null;
  let mask = null, mctx = null;       // 被写界深度の合焦マスク
  let ready = false;

  function make(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }

  /* 端末が canvas の filter に対応しているか（Safari 14 未満などは非対応） */
  let blurOK = null;
  function supportsBlur() {
    if (blurOK !== null) return blurOK;
    try {
      const g = make(2, 2).getContext('2d');
      g.filter = 'blur(1px)';
      blurOK = g.filter === 'blur(1px)';
    } catch (e) { blurOK = false; }
    return blurOK;
  }

  function init(w, h) {
    W = w; H = h;
    scene = make(W, H); sctx = scene.getContext('2d');
    half = make(W / 2, H / 2); hctx = half.getContext('2d');
    half2 = make(W / 2, H / 2); h2ctx = half2.getContext('2d');
    mask = make(W, H); mctx = mask.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    ready = true;
    parts.length = 0;
    return sctx;
  }

  /* 世界を描き込む先。raceview はここに今まで通り描くだけでよい */
  function begin() {
    if (!ready) return null;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, W, H);
    return sctx;
  }

  /* ---------- 明るい所だけを取り出す ----------
     同じ絵を multiply で重ねると色が2乗される。暗い色は急速に沈み、
     白や黄色だけが残るので、しきい値処理の代わりになる。          */
  function extract(strength) {
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.globalCompositeOperation = 'source-over';
    hctx.globalAlpha = 1;
    hctx.clearRect(0, 0, half.width, half.height);
    hctx.drawImage(scene, 0, 0, half.width, half.height);
    hctx.globalCompositeOperation = 'multiply';
    hctx.drawImage(half, 0, 0);          // 2乗
    hctx.drawImage(half, 0, 0);          // 4乗（中間色はほぼ黒に落ちる）
    hctx.globalCompositeOperation = 'source-over';
    // 光らせたいものを明示的に足す（ブレーキ灯やシグナルなど）
    if (adds.length) {
      hctx.save();
      hctx.scale(0.5, 0.5);
      for (let i = 0; i < adds.length; i++) adds[i](hctx);
      hctx.restore();
    }
    return strength;
  }

  /* 追加で光らせたいものを毎フレーム登録する */
  const adds = [];
  function addLight(fn) { if (ready) adds.push(fn); }

  /* ---------- 被写界深度 ----------
     focus が指す一点のまわりだけを鮮明に残し、外側をぼかす。
     ぼけた絵を敷いてから、鮮明な絵を円形マスクで抜いて重ねる。   */
  function depthOfField(out, focus, radius, blurPx) {
    out.save();
    out.filter = 'blur(' + blurPx.toFixed(1) + 'px)';
    out.drawImage(scene, 0, 0);
    out.filter = 'none';
    out.restore();

    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = 'source-over';
    mctx.clearRect(0, 0, W, H);
    mctx.drawImage(scene, 0, 0);
    mctx.globalCompositeOperation = 'destination-in';
    const g = mctx.createRadialGradient(focus.x, focus.y, radius * 0.25, focus.x, focus.y, radius);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.62, 'rgba(0,0,0,.92)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    mctx.fillStyle = g;
    mctx.fillRect(0, 0, W, H);
    mctx.globalCompositeOperation = 'source-over';
    out.drawImage(mask, 0, 0);
  }

  /* ---------- 仕上げ ----------
     opt = { focus:{x,y}, dof:0..1, bloom:0..1, warm:0..1, vignette:0..1, night:bool } */
  function composite(out, opt) {
    if (!ready) return;
    opt = opt || {};
    const soft = supportsBlur();
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
    out.clearRect(0, 0, W, H);

    // 1. 本体（必要なら被写界深度つき）
    const dof = opt.dof || 0;
    if (soft && dof > 0.01 && opt.focus) {
      depthOfField(out, opt.focus, opt.focusR || W * 0.34, 1.2 + dof * 2.6);
    } else {
      out.drawImage(scene, 0, 0);
    }

    // 2. ブルーム（広いにじみ＋狭い芯の二段）
    const bl = opt.bloom == null ? 1 : opt.bloom;
    if (bl > 0.01) {
      extract();
      if (soft) {
        h2ctx.setTransform(1, 0, 0, 1, 0, 0);
        h2ctx.globalCompositeOperation = 'source-over';
        h2ctx.clearRect(0, 0, half2.width, half2.height);
        h2ctx.filter = 'blur(6px)';
        h2ctx.drawImage(half, 0, 0);
        h2ctx.filter = 'none';
        out.globalCompositeOperation = 'lighter';
        out.globalAlpha = 0.30 * bl;
        out.drawImage(half2, 0, 0, W, H);
        out.globalAlpha = 0.18 * bl;
        h2ctx.clearRect(0, 0, half2.width, half2.height);
        h2ctx.filter = 'blur(2px)';
        h2ctx.drawImage(half, 0, 0);
        h2ctx.filter = 'none';
        out.drawImage(half2, 0, 0, W, H);
      } else {
        // filter が使えない端末は、拡大縮小のにじみで代用する
        out.globalCompositeOperation = 'lighter';
        out.globalAlpha = 0.24 * bl;
        out.imageSmoothingEnabled = true;
        out.drawImage(half, -3, -3, W + 6, H + 6);
        out.imageSmoothingEnabled = false;
      }
      out.globalAlpha = 1;
      out.globalCompositeOperation = 'source-over';
    }

    // 3. 色調
    //    影側を色のついた暗さで沈め（multiply）、そのうえで明暗差を立てる（overlay）。
    //    soft-light だと全体が眠くなるので使わない。
    const warm = opt.warm == null ? 1 : opt.warm;
    if (warm > 0.01) {
      const sh = out.createLinearGradient(W * 0.75, 0, W * 0.15, H);
      if (opt.night) {
        sh.addColorStop(0, 'rgba(255,255,255,0)');
        sh.addColorStop(1, 'rgba(96,110,190,' + (0.30 * warm).toFixed(3) + ')');
      } else {
        sh.addColorStop(0, 'rgba(255,255,255,0)');
        sh.addColorStop(1, 'rgba(104,96,168,' + (0.26 * warm).toFixed(3) + ')');
      }
      out.globalCompositeOperation = 'multiply';
      out.fillStyle = sh;
      out.fillRect(0, 0, W, H);

      const hi = out.createLinearGradient(0, 0, W * 0.7, H);
      hi.addColorStop(0, 'rgba(255,206,132,' + (0.30 * warm).toFixed(3) + ')');
      hi.addColorStop(0.5, 'rgba(128,128,128,0)');
      hi.addColorStop(1, 'rgba(52,86,166,' + (0.26 * warm).toFixed(3) + ')');
      out.globalCompositeOperation = 'overlay';
      out.fillStyle = hi;
      out.fillRect(0, 0, W, H);
      out.globalCompositeOperation = 'source-over';
    }

    // 4. 周辺減光
    const vg = opt.vignette == null ? 1 : opt.vignette;
    if (vg > 0.01) {
      const r = out.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.30, W / 2, H / 2, Math.max(W, H) * 0.72);
      r.addColorStop(0, 'rgba(0,0,0,0)');
      r.addColorStop(1, 'rgba(24,12,30,' + (0.46 * vg).toFixed(3) + ')');
      out.fillStyle = r;
      out.fillRect(0, 0, W, H);
    }
    adds.length = 0;
  }

  /* =========================================================
     粒子（火花・砂ぼこり・水しぶき）
     ========================================================= */
  const parts = [];
  const MAX = 220;

  function spawn(x, y, kind, ang, power) {
    if (!ready || parts.length >= MAX) return;
    power = power == null ? 1 : power;
    const n = kind === 'spark' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const sp = (kind === 'spark' ? 26 : 12) * (0.5 + Math.random()) * power;
      const a = ang + (Math.random() - 0.5) * (kind === 'spark' ? 0.9 : 1.9);
      parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: kind === 'spark' ? 0.30 + Math.random() * 0.22
            : kind === 'spray' ? 0.44 + Math.random() * 0.3
            : 0.6 + Math.random() * 0.4,
        age: 0, kind: kind,
        sz: kind === 'dust' ? 1.6 + Math.random() * 2.2 : 1 + Math.random()
      });
    }
  }

  function stepParticles(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const drag = p.kind === 'spark' ? 0.90 : 0.94;
      p.vx *= drag; p.vy *= drag;
      if (p.kind === 'dust') { p.sz += dt * 5; }
    }
  }

  /* 粒子はカメラ変換の中で描く（世界座標） */
  function drawParticles(g) {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const k = 1 - p.age / p.life;
      if (p.kind === 'spark') {
        g.fillStyle = 'rgba(255,' + Math.round(150 + 105 * k) + ',80,' + (0.9 * k).toFixed(2) + ')';
        g.fillRect(Math.round(p.x), Math.round(p.y), p.sz, p.sz);
      } else if (p.kind === 'spray') {
        g.fillStyle = 'rgba(215,235,255,' + (0.5 * k).toFixed(2) + ')';
        g.fillRect(Math.round(p.x), Math.round(p.y), p.sz, p.sz);
      } else {
        g.fillStyle = 'rgba(206,186,150,' + (0.42 * k).toFixed(2) + ')';
        g.fillRect(Math.round(p.x), Math.round(p.y), p.sz, p.sz);
      }
    }
  }

  function clearParticles() { parts.length = 0; }
  function count() { return parts.length; }

  return { init, begin, composite, addLight, spawn, stepParticles, drawParticles,
           clearParticles, count, supportsBlur };
})();

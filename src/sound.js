/* =========================================================
   効果音
   音声ファイルを持たず、Web Audio でその場で合成する。
   オフラインでもそのまま鳴り、リポジトリも軽いままにできる。
   ========================================================= */
window.GP = window.GP || {};

GP.sound = (function () {
  'use strict';
  const KEY = 'gp_sound_on';
  let ctx = null, master = null, on = true, last = 0;

  try { on = localStorage.getItem(KEY) !== '0'; } catch (e) {}

  /* ブラウザの制限で、最初の操作があるまで音は出せない */
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    return ctx;
  }

  /* 単音。fromからtoへ滑らかに動かせる */
  function tone(opt) {
    if (!on) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (opt.at || 0);
    const dur = opt.dur || 0.09;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = opt.type || 'square';
    osc.frequency.setValueAtTime(opt.from, t0);
    if (opt.to && opt.to !== opt.from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t0 + dur);
    const vol = (opt.vol == null ? 1 : opt.vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  /* ノイズ（かすれた音・走行音）*/
  function noise(opt) {
    if (!on) return;
    const c = ensure();
    if (!c) return;
    const dur = opt.dur || 0.15;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(opt.from || 800, c.currentTime);
    if (opt.to) f.frequency.exponentialRampToValueAtTime(opt.to, c.currentTime + dur);
    f.Q.value = opt.q || 1.2;
    const g = c.createGain();
    g.gain.value = opt.vol == null ? 0.6 : opt.vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  const N = { C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392.0, A4: 440.0, B4: 493.9,
              C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784.0, A5: 880.0, B5: 987.8,
              C6: 1046.5, E6: 1318.5, G6: 1568.0 };

  /* ---------- 効果音の定義 ---------- */
  const SFX = {
    click:   () => tone({ from: N.E5, dur: 0.05, vol: 0.5 }),
    tap:     () => tone({ from: N.C5, dur: 0.04, vol: 0.4 }),
    cancel:  () => { tone({ from: N.G4, dur: 0.07, vol: 0.5 }); tone({ from: N.C4, dur: 0.09, vol: 0.5, at: 0.06 }); },
    confirm: () => { tone({ from: N.C5, dur: 0.06, vol: 0.6 }); tone({ from: N.G5, dur: 0.10, vol: 0.6, at: 0.055 }); },
    coin:    () => { tone({ from: N.B5, dur: 0.05, vol: 0.5 }); tone({ from: N.E6, dur: 0.12, vol: 0.5, at: 0.05 }); },
    levelup: () => [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone({ from: f, dur: 0.11, vol: 0.55, at: i * 0.065 })),
    crit:    () => { [N.G5, N.C6, N.E6, N.G6].forEach((f, i) => tone({ from: f, dur: 0.13, vol: 0.6, at: i * 0.055 }));
                     tone({ from: N.G6, to: N.C6, dur: 0.25, vol: 0.4, at: 0.24, type: 'triangle' }); },
    build:   () => { noise({ from: 300, to: 120, dur: 0.22, vol: 0.5, q: 0.8 });
                     tone({ from: N.C4, to: N.C5, dur: 0.28, vol: 0.5, type: 'triangle' }); },
    upgrade: () => { [N.E5, N.G5, N.C6].forEach((f, i) => tone({ from: f, dur: 0.12, vol: 0.55, at: i * 0.07 }));
                     noise({ from: 900, to: 300, dur: 0.3, vol: 0.35 }); },
    light:   () => tone({ from: N.A4, dur: 0.14, vol: 0.7, type: 'square' }),
    go:      () => { tone({ from: N.A5, dur: 0.30, vol: 0.8 });
                     noise({ from: 500, to: 2200, dur: 0.45, vol: 0.5, q: 0.7 }); },
    pass:    () => noise({ from: 1600, to: 400, dur: 0.20, vol: 0.45, q: 2.2 }),
    pit:     () => { noise({ from: 2400, to: 2400, dur: 0.18, vol: 0.35, q: 6 });
                     tone({ from: N.E4, dur: 0.08, vol: 0.4, type: 'sawtooth', at: 0.16 }); },
    dnf:     () => { tone({ from: N.E4, to: N.C4 * 0.6, dur: 0.45, vol: 0.6, type: 'sawtooth' });
                     noise({ from: 600, to: 100, dur: 0.4, vol: 0.4 }); },
    win:     () => { [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6].forEach((f, i) =>
                       tone({ from: f, dur: i === 5 ? 0.45 : 0.14, vol: 0.65, at: i * 0.13 })); },
    podium:  () => [N.G4, N.C5, N.E5].forEach((f, i) => tone({ from: f, dur: 0.16, vol: 0.6, at: i * 0.1 })),
    bad:     () => { tone({ from: N.D4, dur: 0.16, vol: 0.5, type: 'triangle' });
                     tone({ from: N.B4 * 0.5, dur: 0.24, vol: 0.5, type: 'triangle', at: 0.14 }); },
    warn:    () => { tone({ from: N.A4, dur: 0.09, vol: 0.5 }); tone({ from: N.A4, dur: 0.09, vol: 0.5, at: 0.13 }); },
    /* 無線が入るときの、短いかすれ音 */
    radio:   () => { noise({ from: 2600, to: 1300, dur: 0.05, vol: 0.30, q: 5 });
                     tone({ from: N.E5, dur: 0.04, vol: 0.22, type: 'square', at: 0.05 }); }
  };

  /* 連打で音が団子にならないよう間引く */
  function play(name, minGap) {
    if (!on || !SFX[name]) return;
    const now = performance.now();
    if (minGap && now - last < minGap) return;
    last = now;
    try { SFX[name](); } catch (e) {}
  }

  function setOn(v) {
    on = !!v;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    if (on) { ensure(); play('click'); }
  }
  function isOn() { return on; }
  function unlock() { if (on) ensure(); }

  return { play, setOn, isOn, unlock };
})();

/* =========================================================
   ラリーを走らせる

   サーキットと違って、並んで走らない。1台ずつ間隔をあけて出て、
   SS（スペシャルステージ）ごとのタイムを足していく。
   だから「抜く」も「ブロックする」も無い。あるのは
     ・自分のタイムをどれだけ削れるか
     ・削りにいって、どれだけ外さずにいられるか
   のふたつだけ。この二択がラリーの全部といっていい。

   タイムの出しかた
     区間タイム ＝ 距離 ÷ 平均速度
     平均速度   ＝ 路面の素の速さ
                  × 車（その路面・曲がり具合での出来）
                  × ドライバー（腕・調子・その路面の得手）
                  × ペースノート（読みの精度）
                  × 攻めかた（確実に〜振り切る）
                  × 走行順（グラベルの掃き掃除）
                  × 天気・夜
   ========================================================= */
window.GP = window.GP || {};

GP.rally = (function () {
  'use strict';

  const D = () => GP.data;
  const RD = () => GP.rallydata;
  const S = () => GP.state;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function rint(a, b) { return Math.floor(rnd(a, b + 1)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /* ---------- SSの組み立て ----------
     ラリーごとの素性（平均の長さ・曲がり具合・荒さ）から、
     その年のSSを組む。日ごとに顔つきを変えて、
     「二日目がいちばん長い」という当たり前を作る            */
  function buildStages(rally, seed) {
    let h = (seed * 2654435761) >>> 0;
    const r = () => { h = (h * 1103515245 + 12345) >>> 0; return h / 4294967296; };
    const out = [];
    const names = rally.places || ['ステージ'];
    rally.days.forEach((n, day) => {
      // 二日目は長く、最終日は短く締める
      const dayKm = [0.92, 1.10, 0.80][day] || 1;
      for (let i = 0; i < n; i++) {
        const nm = names[(day * 3 + i) % names.length];
        /* 同じ道を午前と午後に二度通る。二度目は路面が荒れる */
        const second = i >= Math.ceil(n / 2);
        const km = Math.round(rally.km * dayKm * (0.7 + r() * 0.7) * 10) / 10;
        out.push({
          day: day,
          n: out.length + 1,
          name: nm + (second ? '（2回目）' : ''),
          km: Math.max(3, km),
          twisty: clamp(rally.twisty + (r() - 0.5) * 0.24, 0.12, 0.95),
          rough: clamp(rally.rough * (second ? 1.22 : 1) + (r() - 0.5) * 0.18, 0.05, 1.15),
          /* 路面の混ざりかたは2通り。
             mixByDay … 初日は砂利、翌日から舗装（一晩で車を作り替える）
             mix      … 同じ日のなかに、ときどき別の路面のSSが挟まる    */
          surface: rally.mixByDay ? (day >= 1 ? rally.mix : rally.surface)
                 : (rally.mix && r() < 0.30) ? rally.mix : rally.surface,
          night: !!rally.night && day === 0 && i >= n - 1,
          second: second
        });
      }
    });
    // 最終SSがパワーステージ
    if (out.length) out[out.length - 1].power = true;
    return out;
  }

  /* =======================================================
     道そのものを作る

     SSは一本道で、行って戻らない。だから周回コースのように
     閉じた輪ではなく、始まりと終わりのある線を引く。

     引きかたは「コーナーの並び」から。先にペースノート
     （右3 ロング、100、左5 …）を作り、そのとおりに曲げていく。
     こうしておくと、右席が読み上げたものと、画面に見えている
     曲がりが必ず一致する。ここがずれると、ラリーではなくなる。
     ======================================================= */

  /* コーナーのきつさ。1がいちばん曲がっていて、6でほぼ直線 */
  const SEV = [
    { n: 1, turn: 155, keep: 0.30, name: 'ヘアピン' },
    { n: 2, turn: 112, keep: 0.44, name: '' },
    { n: 3, turn: 82,  keep: 0.57, name: '' },
    { n: 4, turn: 58,  keep: 0.69, name: '' },
    { n: 5, turn: 38,  keep: 0.81, name: '' },
    { n: 6, turn: 22,  keep: 0.92, name: '' }
  ];
  /* 曲がりに付く但し書き。読み上げの味であり、走りかたも変える */
  const TAGS = [
    { key: 'long',  w: 0.16, say: 'ロング',       keep: -0.04 },
    { key: 'tight', w: 0.10, say: '締まる',       keep: -0.10 },
    { key: 'open',  w: 0.10, say: '開く',         keep: +0.06 },
    { key: 'crest', w: 0.09, say: 'クレスト',     keep: -0.05 },
    { key: 'jump',  w: 0.06, say: 'ジャンプ',     keep: -0.02 },
    { key: 'care',  w: 0.08, say: '注意',         keep: -0.12 },
    { key: 'dont',  w: 0.05, say: '切るな',       keep: -0.08 },
    { key: 'over',  w: 0.07, say: '飛び込める',   keep: +0.05 }
  ];

  function buildRoad(st, seed) {
    let h = ((seed | 0) * 2246822519 + 3266489917) >>> 0;
    const r = () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };

    /* 1kmあたりのコーナーの数。曲がりどころの多い道ほど密になる */
    const perKm = 1.1 + st.twisty * 3.2;
    const n = Math.max(6, Math.round(st.km * perKm));
    const notes = [];
    for (let i = 0; i < n; i++) {
      /* きつさは道の性格で寄る。twisty が高いほど小さい番号（＝きつい）が出る */
      const bias = 1 - st.twisty;
      let sev = 1 + Math.floor(Math.pow(r(), 1.6 - bias * 0.7) * 6);
      sev = Math.max(1, Math.min(6, sev));
      /* 向きは五分五分では決めない。
         同じ側へ曲がり続けると道が輪になって自分と交差する。
         いまどれだけ元の進行方向から振れているかを見て、
         振れているほど戻る側へ曲がりやすくする                */
      const dir = null;   // ここでは決めず、線を引くときに決める
      // 但し書き
      let tag = null;
      const roll = r();
      let acc = 0;
      for (const t of TAGS) { acc += t.w; if (roll < acc) { tag = t; break; } }
      // 次の曲がりまでの直線（m）。粗い道ほど詰まっている
      /* 読み上げは10m刻みで言う。1m単位で言う人はいない */
      const straight = Math.round((30 + Math.pow(r(), 1.8) * 420) * (1.25 - st.twisty * 0.5) / 10) * 10;
      notes.push({ sev: sev, dir: dir, tag: tag, straight: straight,
                   jump: !!(tag && (tag.key === 'jump' || tag.key === 'crest')) });
    }

    /* ---- ノートのとおりに線を引く ---- */
    const pts = [];
    let x = 0, y = 0, ang = -Math.PI / 2;      // 上向きに出発
    const step = 9;                            // 1点あたりの長さ（見た目の単位）
    const put = () => pts.push([x, y]);
    put();
    const fwd = (dist) => {
      const k = Math.max(1, Math.round(dist / step));
      for (let i = 0; i < k; i++) { x += Math.cos(ang) * step; y += Math.sin(ang) * step; put(); }
    };
    /* きつい曲がりほど小さく回る。
       どの曲がりも同じ半径で回っていたころは、ヘアピンも高速コーナーも
       「長さが違うだけの同じ弧」で、見ても走っても区別がつかなかった   */
    const turn = (deg, dir2, sev) => {
      const perStep = (3 + (7 - sev) * 2.2) * Math.PI / 180;   // 1点あたり何度回るか
      const rad = deg * Math.PI / 180 * (dir2 === 'L' ? -1 : 1);
      const k = Math.max(3, Math.round(Math.abs(rad) / perStep));
      for (let i = 0; i < k; i++) {
        ang += rad / k;
        x += Math.cos(ang) * step; y += Math.sin(ang) * step; put();
      }
    };
    /* 進んでいく「おおよその向き」。ゆっくり振れていく。
       各コーナーの向きは、ここからのずれを見て決める          */
    let base = ang;
    notes.forEach((nt, i) => {
      /* 見た目の縮尺。曲がりは弧の長さぶん点を使うので、
         直線を詰めすぎると、道が端から端まで曲がりだらけになる */
      fwd(nt.straight * 0.40);
      nt.at = pts.length;                      // この曲がりが始まる点
      base += (r() - 0.5) * 0.22;              // 道は少しずつ向きを変えていく
      const off = Math.atan2(Math.sin(ang - base), Math.cos(ang - base));
      const deg = SEV[nt.sev - 1].turn * (0.8 + r() * 0.4);
      /* ずれが大きいほど、戻る側へ曲がる。
         ±60度を超えたら必ず戻す（これで道が自分と交差しなくなる） */
      const back = off > 0 ? 'L' : 'R';
      const away = off > 0 ? 'R' : 'L';
      const hard = Math.abs(off) > 1.05;
      nt.dir = hard ? back : (r() < 0.5 + Math.abs(off) * 0.42 ? back : away);
      turn(deg, nt.dir, nt.sev);
      nt.out = pts.length - 1;                 // この曲がりが終わる点
    });
    fwd(140);

    /* 長さと、各点までの累積 */
    const N = pts.length;
    const cum = new Float64Array(N);
    let len = 0;
    for (let i = 1; i < N; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      cum[i] = len;
    }
    notes.forEach(nt => { nt.f = cum[Math.min(N - 1, nt.at)] / Math.max(1, len); });

    /* ---- 速度の形 ----
       コーナーでは SEV.keep まで落ち、直線で戻る。
       あとで実際の区間タイムに合うよう、まるごと伸び縮みさせる  */
    const keepAt = new Float64Array(N).fill(1);
    notes.forEach(nt => {
      const sv = SEV[nt.sev - 1];
      const keep = Math.max(0.18, sv.keep + (nt.tag ? nt.tag.keep : 0));
      const half = Math.max(4, Math.round(26 - nt.sev * 3));
      for (let k = -half; k <= half; k++) {
        const i = nt.at + k;
        if (i < 0 || i >= N) continue;
        const w = 1 - Math.abs(k) / (half + 1);
        keepAt[i] = Math.min(keepAt[i], 1 - (1 - keep) * w);
      }
    });
    return { pts: pts, n: N, cum: cum, len: len, notes: notes, keep: keepAt };
  }

  /* 読み上げの文句。「右3 ロング 100」の形にする */
  function noteSay(nt, next) {
    const d = nt.dir === 'L' ? '左' : '右';
    let s = d + nt.sev;
    if (nt.tag) s += ' ' + nt.tag.say;
    if (next) s += '　' + (next.straight >= 200 ? 'ロングストレート' : next.straight + '');
    return s;
  }

  /* サービスパークが入る場所。日の変わり目と、二日目の真ん中 */
  function serviceAfter(stages) {
    const set = {};
    for (let i = 1; i < stages.length; i++) {
      if (stages[i].day !== stages[i - 1].day) set[i - 1] = true;
    }
    // 一日のなかほどにも一度戻る（本数の多い日だけ）
    const byDay = {};
    stages.forEach((s, i) => { (byDay[s.day] = byDay[s.day] || []).push(i); });
    Object.keys(byDay).forEach(d => {
      const list = byDay[d];
      if (list.length >= 5) set[list[Math.floor(list.length / 2) - 1]] = true;
    });
    return set;
  }

  /* ---------- 路面の素の速さ ----------
     曲がりどころが多いほど遅い。荒れているほど遅い。
     単位は km/h                                            */
  function baseSpeed(st) {
    const sf = RD().SURFACES[st.surface] || RD().SURFACES.gravel;
    /* 実際のSSの平均速度は 90〜125km/h あたり。
       曲がりどころが多いほど、荒れているほど落ちる          */
    const v = 148 - st.twisty * 44 - st.rough * 11;
    return v * (0.88 + sf.grip * 0.12) / 0.985;
  }

  /* ---------- 走行順による損得 ----------
     グラベルの初日は、前を走るほど砂利を掃いて損をする。
     舗装ではほとんど効かない                               */
  function roadFactor(st, order) {
    const sf = RD().SURFACES[st.surface] || RD().SURFACES.gravel;
    const RO = RD().ROAD;
    if (order == null) return 1;
    const k = Math.pow(RO.decay, Math.max(0, order - 1));
    const lose = RO.sweepMax * sf.sweep * (order >= RO.cleanFrom ? 0 : k);
    // 二度目に通るときは、もう掃き終わっている
    return 1 - (st.second ? lose * 0.35 : lose);
  }

  /* その走行順が背負う「掃き掃除」の割合（0〜）。
     画面に出すためのもので、計算はしていない                 */
  function roadLoss(surface, order, second) {
    return 1 - roadFactor({ surface: surface, second: !!second }, order);
  }

  /* ---------- 初日の走行順の見込み ----------
     初日は選手権の上位から出る。つまり、勝っている者ほど
     まだ誰も掃いていない砂利の上を走らされる。
     これが「ラリーでは、勝つほど次が苦しくなる」の正体       */
  function orderPreview(g, rally) {
    const St = S();
    const teams = St.allTeams(g, rally);
    const all = [];
    teams.forEach(t => {
      (t.drivers || []).forEach(d => {
        all.push({ name: d.name, team: t.name, color: t.color,
                   isPlayer: !!t.isPlayer, pts: d.seasonPoints || 0,
                   rate: St.driverRating(d) || 50 });
      });
    });
    /* 点が並んだら格で分ける。開幕戦は全員0点なので、
       ここを決めておかないと「無名のチームが先頭で出る」ことになる */
    all.sort((a, b) => (b.pts - a.pts) || (b.rate - a.rate));
    all.forEach((x, i) => {
      x.order = i + 1;
      x.loss = roadLoss(rally.surface, x.order, false);
    });
    return all;
  }

  /* ---------- ペースノートの精度 ---------- */
  function notesOf(g, crew) {
    const N = RD().NOTES;
    const co = crew && crew.co ? (crew.co.skill || 40) / 100 : 0.30;
    const rc = crew && crew.recce != null ? crew.recce : 0;
    const bond = crew && crew.bond != null ? crew.bond : 0.5;
    return clamp(N.base + co * N.coNote + rc * N.recce + bond * N.bond, 0.2, 1.25);
  }

  /* ---------- 1本ぶんのタイム ---------- */
  function stageTime(e, st, opt) {
    opt = opt || {};
    const sf = RD().SURFACES[st.surface] || RD().SURFACES.gravel;
    const N = RD().NOTES;
    let v = baseSpeed(st);

    /* 車。基準（その週いちばん良い車）からの差で効かせる。
       ここの係数がそのまま「トップと10番手の差」になる。
       実際のラリーは 1位と10位で4分ほど＝3%なので、小さく取る   */
    v *= 1 + (e.car - opt.ref) / Math.max(1, opt.ref) * 0.115;
    // 路面の得手不得手。車の作りかたが合っているか
    v *= 1 + (e.surfaceFit || 0) * 0.020;
    // ドライバー
    v *= 0.982 + (e.drvPace || 0.5) * 0.036;
    // ペースノート
    v *= 1 + (e.notes - 0.75) * N.paceAt;
    // 攻めかた
    v *= (e.paceDef || RD().PACES[1]).pace;
    // 走行順
    v *= roadFactor(st, e.order);
    // 夜と天気
    if (st.night) v *= 0.955;
    if (opt.wet) v *= 0.93 - st.rough * 0.02;
    // その日の当たり外れ
    v *= rnd(0.9975, 1.0025);

    return st.km / Math.max(20, v) * 3600;
  }

  /* ---------- 何かが起きるか ---------- */
  function rollTrouble(e, st, opt) {
    const N = RD().NOTES;
    const rally = opt.rally;
    let base = 0.055 * (rally.risk || 1) * (0.55 + st.rough * 0.75);
    base *= (e.paceDef || RD().PACES[1]).risk;
    // ノートが甘いほど外す
    base *= 1 + (0.85 - e.notes) * N.riskAt;
    // 車の壊れにくさ
    base *= 1 + (100 - (e.rel || 90)) / 100 * 1.2;
    if (opt.wet) base *= 1.25;
    if (st.night) base *= 1.20;
    if (Math.random() > base) return null;

    // どれが起きたか。荒れた路面ならパンクと足まわり、曲がりどころならスピンと飛び出し
    const list = RD().TROUBLES.map(t => {
      let w = t.w;
      if (t.rough) w *= 1 + st.rough * (t.rough - 1);
      if (t.twist) w *= 1 + st.twisty * (t.twist - 1);
      return { t: t, w: w };
    });
    const sum = list.reduce((a, x) => a + x.w, 0);
    let r = Math.random() * sum;
    for (const x of list) { r -= x.w; if (r <= 0) return x.t; }
    return list[0].t;
  }

  /* ---------- 出走する面々をつくる ---------- */
  function buildEntries(g, rally, plan) {
    const St = S();
    const teams = St.allTeams(g, rally);
    const sf = RD().SURFACES[rally.surface] || RD().SURFACES.gravel;
    const out = [];
    let id = 0;
    teams.forEach(t => {
      (t.drivers || []).forEach(d => {
        const mine = !!t.isPlayer;
        /* 路面の得手。曲がる車は舗装で、蹴り出す車は砂利で強い。
           自分の車は実際の作りから、ライバルは持ち味から出す      */
        const st = t.stats || {};
        const tot = Math.max(1, (st.speed || 30) + (st.corner || 30) + (st.accel || 30));
        const corner = (st.corner || 30) / tot, accel = (st.accel || 30) / tot;
        const fit = rally.surface === 'tarmac' ? (corner - 0.34) * 3.2
                  : rally.surface === 'snow'   ? (accel - 0.33) * 2.4
                                               : (accel - 0.33) * 3.0;
        const drv = clamp(((St.driverRating(d) || 50) / 100) * 0.82
                          + ((d.form || 100) - 100) / 100 * 0.6
                          + (St.hasSkill && St.hasSkill(d, 'rain') ? 0.04 : 0), 0.05, 1.3);
        const crew = mine ? (plan.crew && plan.crew[d.id]) || {} : null;
        out.push({
          id: 'e' + (id++),
          driver: d, team: t, isPlayer: mine,
          name: d.name, color: t.color, teamName: t.name,
          car: t.car, rel: mine ? (t.rel || 90) : clamp(88 + (t.level || 0) * 2, 70, 97),
          surfaceFit: fit,
          drvPace: drv,
          notes: mine ? notesOf(g, crew)
                      : clamp(0.62 + ((t.level || 3) / 10) * 0.45 + rnd(-0.05, 0.05), 0.3, 1.2),
          paceDef: mine ? (RD().PACES.filter(p => p.key === (plan.pace || 'std'))[0] || RD().PACES[1])
                        : pick(RD().PACES.slice(0, 3)),
          co: crew && crew.co ? crew.co : null,
          total: 0, done: [], out: false, outAt: 0, outWhy: '',
          damage: 0, spares: mine ? (plan.spares == null ? 2 : plan.spares) : 2
        });
      });
    });
    return out;
  }

  /* 走行順。初日は選手権の順位の逆、二日目からは前日の順位の逆 */
  function orderFor(list, day, standings) {
    const live = list.filter(e => !e.out);
    if (day === 0) {
      /* 選手権で上にいるほど先に出る＝グラベルでは損をする。
         点が並んだら格で分ける。開幕戦は全員0点なので、
         ここを決めておかないと順番がその場の runtime 次第になる */
      live.sort((a, b) => ((standings[b.id] || 0) - (standings[a.id] || 0))
                          || ((b.drvPace || 0) - (a.drvPace || 0)));
    } else {
      live.sort((a, b) => a.total - b.total);
    }
    live.forEach((e, i) => { e.order = i + 1; });
  }

  /* ---------- まるごと1ラリー ---------- */
  function run(g, roundIdx, plan) {
    plan = plan || {};
    const St = S();
    const rally = venueAt(g, roundIdx);
    const stages = buildStages(rally, (g.season || 1) * 97 + roundIdx * 13);
    const svc = serviceAfter(stages);
    const list = buildEntries(g, rally, plan);
    const ref = Math.max.apply(null, list.map(e => e.car));
    const wet = Math.random() < (rally.wetRate == null ? 0.22 : rally.wetRate);

    // 選手権での立ち位置（初日の走行順に使う）
    const standings = {};
    list.forEach(e => { standings[e.id] = e.driver.seasonPoints || 0; });

    const log = [];
    let curDay = -1;
    stages.forEach((st, i) => {
      if (st.day !== curDay) { curDay = st.day; orderFor(list, curDay, standings); }
      const board = [];
      list.forEach(e => {
        if (e.out) return;
        let t = stageTime(e, st, { ref: ref, wet: wet, rally: rally });
        // 前のSSで負ったダメージを引きずる
        t *= 1 + e.damage * 0.035;
        const tr = rollTrouble(e, st, { wet: wet, rally: rally });
        let note = null;
        if (tr) {
          if (tr.out) {
            e.out = true; e.outAt = i + 1; e.outWhy = tr.name;
            note = { key: tr.key, icon: tr.icon, name: tr.name, line: tr.line, out: true,
                     at: rnd(0.10, 0.90) };
          } else {
            let loss = rnd(tr.lossS[0], tr.lossS[1]);
            if (tr.key === 'punc') {
              if (e.spares > 0) { e.spares--; loss *= 0.55; }
              else loss *= 1.8;                       // 替えが無ければ引きずる
            }
            t += loss;
            e.damage += tr.key === 'susp' ? 1.4 : tr.key === 'off' ? 0.5 : 0.2;
            note = { key: tr.key, icon: tr.icon, name: tr.name, line: tr.line,
                     loss: Math.round(loss), at: rnd(0.08, 0.92) };
          }
        }
        if (!e.out) { e.total += t; e.done.push(t); }
        board.push({ e: e, t: t, note: note, order: e.order,
                     road: roadFactor(st, e.order) });
      });
      board.sort((a, b) => a.t - b.t);
      const win = board[0];
      log.push({
        st: st, i: i, service: !!svc[i], wet: wet,
        board: board.map((x, k) => ({
          id: x.e.id, name: x.e.name, team: x.e.teamName, color: x.e.color,
          isPlayer: x.e.isPlayer, t: x.t, gap: x.t - (win ? win.t : x.t),
          pos: k + 1, note: x.note, out: x.e.out,
          order: x.order, road: x.road
        }))
      });
      // パワーステージの点
      if (st.power) {
        board.filter(x => !x.e.out).slice(0, RD().POWER_STAGE.length)
          .forEach((x, k) => { x.e.power = RD().POWER_STAGE[k]; });
      }
    });

    // 総合順位
    const fin = list.filter(e => !e.out).sort((a, b) => a.total - b.total);
    const dnf = list.filter(e => e.out).sort((a, b) => b.outAt - a.outAt);
    const classified = fin.concat(dnf).map((e, i) => ({
      id: e.id, pos: i + 1, dnf: e.out, driver: e.driver, team: e.team,
      isPlayer: e.isPlayer, name: e.name, color: e.color, teamName: e.teamName,
      grid: 0, total: e.total, gap: e.total - (fin[0] ? fin[0].total : 0),
      power: e.power || 0, outWhy: e.outWhy, outAt: e.outAt, spares: e.spares
    }));
    return {
      rally: rally, round: roundIdx, stages: stages, log: log, wet: wet,
      pace: plan.pace || 'std',
      classified: classified, service: svc,
      winner: classified[0] || null
    };
  }

  /* いまの大会（シリーズによって、サーキットかラリーか） */
  function venueAt(g, round) {
    const St = S();
    if (St.venueAt) return St.venueAt(g, round);
    return RD().RALLIES[round % RD().RALLIES.length];
  }

  return { run, buildStages, serviceAfter, notesOf, baseSpeed, roadFactor, stageTime,
           buildRoad, noteSay, roadLoss, orderPreview, SEV, TAGS };
})();

/* =========================================================
   レースシミュレーション（予選＋決勝）
   ラップ単位で全車のタイムを積み上げ、結果とドラマを生成する
   ========================================================= */
window.GP = window.GP || {};

GP.race = (function () {
  'use strict';
  const D = GP.data, S = GP.state;

  const STRATEGIES = {
    safe:    { name: '安全第一', icon: '🛡️', pace: -0.006, risk: 0.55, tyre: 0.80 },
    balance: { name: 'バランス', icon: '⚖️', pace: 0.000,  risk: 1.00, tyre: 1.00 },
    attack:  { name: '攻める',   icon: '🔥', pace: 0.009,  risk: 1.85, tyre: 1.25 }
  };

  /* ---------- エントリーリスト作成 ---------- */
  function buildEntries(g, track, weather, strategy) {
    const teams = S.allTeams(g, track);
    // 週ごとの調子。金曜のセットアップがはまったかどうかで、チームごとに少し上下する。
    // そして毎レース、どこか1チームが「当たり週」を引いて前に出てくる
    const form = teams.map(t => t.isPlayer ? 1 : 1 + S.rnd(-0.014, 0.014));
    const ri = [];
    teams.forEach((t, i) => { if (!t.isPlayer) ri.push(i); });
    let hot = -1;
    if (ri.length) { hot = ri[S.rint(0, ri.length - 1)]; form[hot] += 0.052; }
    const list = [];
    list.hotTeam = hot >= 0 ? teams[hot].name : '';
    teams.forEach((t, ti) => {
      t.drivers.forEach((d, di) => {
        const strat = t.isPlayer ? (strategy[d.id] || 'balance') : autoStrategy(t, track);
        const st = STRATEGIES[strat];
        const sk = k => S.hasSkill(d, k);
        let drv = S.driverRating(d);
        // スキルによる補正
        if (sk('rain') && (weather.key === 'rain' || weather.key === 'storm')) drv *= 1.18;
        const perf = (t.car * 0.60 + drv * 0.40) * form[ti];

        const stats = t.stats || { speed: 1, corner: 1, accel: 1 };
        list.push({
          id: t.isPlayer ? d.id : (t.name + di),
          driver: d, team: t, color: t.color, isPlayer: !!t.isPlayer,
          num: list.length + 1,
          stats: stats,
          // このマシンがコース上でどう速度を出すか。区間タイムの配分もここから来る
          prof: GP.geom.speedProfile(track, stats),
          gen: t.isPlayer ? g.carGen : Math.min(D.CAR_GENS.length - 1, Math.round((t.car - 12) / 26)),
          perf: perf, strat: strat, st: st, sk: sk, hot: ti === hot,
          startTyre: t.isPlayer ? (strategy['tyre_' + d.id] || null) : null,
          // 作戦の性格（ライバル）と、プレイヤーが選んだピット回数・タイヤの狙い
          style: t.style || 'balanced',
          stopPlan: t.isPlayer ? (strategy['stops_' + d.id] || 'auto') : null,
          tyrePlan: t.isPlayer ? (strategy['tbias_' + d.id] == null ? 1
                                  : parseInt(strategy['tbias_' + d.id], 10)) : null,
          rel: t.rel,
          tyreSkill: (sk('tyre') ? 0.55 : 1) * (1 - d.technique / 420),
          lapTimes: [], cum: [], pits: [], sectors: [], bestSec: [Infinity, Infinity, Infinity],
          dnf: false, dnfLap: -1, dnfReason: '',
          grid: 0, pos: 0, fastest: Infinity
        });
      });
    });
    return list;
  }

  const tyreOf = key => D.TYRES.find(t => t.key === key) || D.TYRES[1];

  /* このスティント（区間）を走りきるのに向いたタイヤを選ぶ。
     攻めるチームは寿命ぎりぎりの速いタイヤを、
     堅実なチームは余裕のある硬いタイヤを選ぶ                        */
  function pickTyre(stintLaps, weather, prefer, bias) {
    if (weather.key === 'storm') return 'wet';
    if (weather.key === 'rain') return 'inter';
    if (prefer && D.DRY_TYRES.indexOf(prefer) >= 0) return prefer;
    const fit = D.DRY_TYRES.map(k => tyreOf(k)).filter(t => t.life >= stintLaps * 0.9);
    if (!fit.length) return 'hard';
    // bias 0=攻め（寿命ぎりぎりの速いタイヤ） 1=バランス 2=堅実（余裕のある硬いタイヤ）
    const i = bias >= 2 ? fit.length - 1 : bias === 1 ? Math.floor((fit.length - 1) / 2) : 0;
    return fit[i].key;
  }

  function autoStrategy(team, track) {
    const r = Math.random();
    if (r < 0.2) return 'safe';
    if (r < 0.75) return 'balance';
    return 'attack';
  }

  /* ---------- 天候抽選 ---------- */
  function rollWeather(track) {
    const r = Math.random() * (0.9 + track.tyre * 0.1);
    if (r < 0.52) return D.WEATHER[0];
    if (r < 0.78) return D.WEATHER[1];
    if (r < 0.94) return D.WEATHER[2];
    return D.WEATHER[3];
  }

  /* ---------- 予選 ---------- */
  function qualify(entries, track, weather) {
    entries.forEach(e => {
      let q = e.perf;
      if (e.sk('qualify')) q *= 1.07;
      q *= (0.94 + Math.random() * 0.12) * weather.grip;
      q *= (1 - (1 - e.driver.mental / 260) * (weather.chaos - 1) * 0.08);
      e.qScore = q;
      e.qTime = track.base * (1 + (0.02 + (140 - q) * 0.0009));
    });
    entries.sort((a, b) => b.qScore - a.qScore);
    entries.forEach((e, i) => { e.grid = i + 1; });
    return entries.slice();
  }

  /* ---------- 決勝シミュレーション ---------- */
  function simulate(g, trackIndex, strategy, special) {
    const track = D.TRACKS[trackIndex];
    // 途中で書き換えるので、天気表そのものではなく複製を持つ
    const weather = Object.assign({}, special && special.force
      ? (D.WEATHER.find(w => w.key === special.force) || rollWeather(track))
      : rollWeather(track));
    weather.wetTyres = (weather.key === 'rain' || weather.key === 'storm');
    const entries = buildEntries(g, track, weather, strategy);
    const grid = qualify(entries, track, weather);
    const laps = Math.max(4, Math.round(track.laps * (special ? special.lapMul : 1)));
    const events = [];
    const bestSector = [Infinity, Infinity, Infinity];   // セッション最速（紫）
    let scLaps = 0, scFrom = 0, scPending = false, scDone = false;   // セーフティカー
    const bestSectorBy = [null, null, null];
    const scInfo = { from: 0, laps: 0 };
    // 天候の急変。降り出す／上がるで、履いているタイヤの正解が入れ替わる
    let wx = { key: weather.key, grip: weather.grip, chaos: weather.chaos, wet: weather.wetTyres };
    let wxTo = null, wxAt = 0;
    const wxInfo = { at: 0, from: weather.name, to: '', icon: '' };
    // 追い抜きやすさ：最長ストレートの長さ（実際の形状）と、コースの速度特性から決める
    const geo = GP.geom.analyze(track);
    const passEase = 0.25 + geo.longestShare * 1.1 + track.weight.speed * 0.5;
    const E = D.ERS;
    // ストレートが長いコースほど、放電を速さに変えやすい
    const ersScale = 0.7 + geo.longestShare * 1.6;
    const refPerf = Math.max.apply(null, entries.map(e => e.perf)) + 4;
    const pitLoss = 20.5 - g.facilities.pit * 0.7 - S.staffBonus(g, 'mechanic') * 0.4
                  - S.mgr(g, 'pitchief') * 0.06 - S.osk(g, 'call') * 0.5;   // 采配
    const strategist = S.staffBonus(g, 'strategist');

    // ピット戦略とタイヤの割り当て
    entries.forEach(e => {
      const wear = track.tyre * e.st.tyre * e.tyreSkill;
      // コースとマシンから決まる「素直な」ストップ回数
      const natural = (wear > 1.05 || laps > 28) ? 2 : 1;
      let stops = natural;
      e.tyreBias = 1;
      e.react = 0.45;                     // アンダーカットを仕掛ける積極性

      if (e.isPlayer) {
        // プレイヤーは自分で選べる。'auto' ならコース任せ
        const want = e.stopPlan;
        if (want === '1' || want === '2' || want === '3') stops = parseInt(want, 10);
        e.tyreBias = e.tyrePlan == null ? 1 : e.tyrePlan;
        e.react = 0.5 + strategist * 0.12 + S.osk(g, 'call') * 0.06;
      } else {
        // ライバルはチームごとの性格に従う。性格はシーズンを通して変わらない
        const st = D.STRAT_STYLES[e.style] || D.STRAT_STYLES.balanced;
        if (st.random) {                  // 型破りなチームだけは毎回読めない
          stops = S.clamp(natural + S.rint(-1, 1), 1, 3);
          e.tyreBias = S.rint(0, 2);
        } else {
          stops = S.clamp(natural + st.stopBias, 1, 3);
          e.tyreBias = st.tyreBias;
        }
        e.react = st.react;
        e.pitShift = st.random ? S.rnd(-0.1, 0.1) : st.pitShift;
      }
      e.stops = stops;

      const blur = e.isPlayer ? Math.max(0, 1.6 - strategist * 0.5) : 1.4;
      const shift = e.pitShift || 0;
      e.pitPlan = [];
      for (let i = 1; i <= stops; i++) {
        // 等分だと毎回同じ周回になるので、性格ぶんの前倒し／引っ張りを乗せる
        const frac = i / (stops + 1) * (1 + shift);
        e.pitPlan.push(S.clamp(Math.round(laps * frac + S.rnd(-blur, blur)), 2, laps - 2));
      }
      e.pitPlan.sort((a, b) => a - b);
      e.pitLoss = pitLoss - (e.isPlayer ? strategist * 0.5 : 0);
      e.tyreAge = 0;
      e.startBoost = (e.sk('start') ? 2.2 : 0) + e.driver.technique / 200;

      // 各スティントの長さから履くタイヤを決める。最初のスティントだけは指定できる
      const bounds = [0].concat(e.pitPlan, [laps]);
      e.stints = [];
      for (let i = 0; i < bounds.length - 1; i++) {
        const len = bounds[i + 1] - bounds[i];
        const prefer = (i === 0 && e.isPlayer) ? e.startTyre : null;
        e.stints.push({ from: bounds[i] + 1, to: bounds[i + 1],
                        key: pickTyre(len, weather, prefer, e.tyreBias), laps: len });
      }
      // ドライレースでは2種類以上のタイヤを使わなければならない（実際のF1のルール）
      if (!weather.wetTyres && e.stints.length >= 2) {
        const keys = e.stints.map(x => x.key);
        if (keys.every(k => k === keys[0])) {
          // いちばん短いスティントを、別の銘柄に差し替える
          let si = 0;
          for (let i = 1; i < e.stints.length; i++) if (e.stints[i].laps < e.stints[si].laps) si = i;
          const st2 = e.stints[si];
          const alt = D.DRY_TYRES.map(k => tyreOf(k))
            .filter(t => t.key !== keys[0] && t.life >= st2.laps * 0.85);
          st2.key = alt.length ? alt[0].key
            : (keys[0] === 'hard' ? 'medium' : 'hard');
          st2.forced = true;
        }
      }
      e.tyreKey = e.stints[0].key;
      e.stintIdx = 0;
      e.lapTyre = [];       // 各周のタイヤと使用周回数（観戦画面の表示に使う）
      e.pitTime = [];       // 各周のピット停止時間
      e.lapErs = [];        // 各周のバッテリー残量
      // ERS：エレクトロニクスの性能が高いほど容量も回生量も大きい
      const elecPower = e.isPlayer
        ? S.ersOf(g).power
        : (e.stats.accel * 0.42 + e.stats.speed * 0.12);
      const ers = S.ersFrom(elecPower);
      e.ersCap = ers.capacity;
      e.ersRecover = ers.recover;
      e.ersDeploy = ers.deploy;
      e.battery = ers.capacity;   // 満充電でスタート
    });

    let order = grid.slice();
    const posHistory = [];

    // 途中で天気が変わるかどうかを先に決めておく（実況では出さない）
    if (!special && laps >= 12 && Math.random() < 0.30) {
      wxTo = weather.wetTyres
        ? D.WEATHER[Math.random() < 0.55 ? 1 : 0]                    // 雨が上がる
        : D.WEATHER[Math.random() < 0.30 ? 3 : 2];                   // 降り出す
      wxAt = S.rint(Math.round(laps * 0.22), Math.round(laps * 0.74));
    }

    for (let lap = 1; lap <= laps; lap++) {
      // 天候の急変。全車があわててタイヤを替えに来る
      if (wxTo && lap === wxAt) {
        wx = { key: wxTo.key, grip: wxTo.grip, chaos: wxTo.chaos,
               wet: wxTo.key === 'rain' || wxTo.key === 'storm' };
        wxInfo.at = lap; wxInfo.to = wxTo.name; wxInfo.icon = wxTo.icon;
        events.push({ lap, type: 'weather',
          text: wxTo.icon + ' 天候が変わった！ ' + weather.name + ' → ' + wxTo.name
              + '（' + (wx.wet ? 'ウェットタイヤへ' : 'ドライタイヤへ') + '）' });
        order.forEach(e => {
          if (e.dnf || lap >= laps - 1) return;
          // 読みの速いチームほど早く動ける
          const delay = S.clamp(Math.round(3.4 - e.react * 2.8 + S.rnd(-0.5, 1.4)), 1, 6);
          const at = Math.min(laps - 1, lap + delay);
          e.pitPlan = e.pitPlan.filter(p => p > at + 3);
          e.pitPlan.push(at);
          e.pitPlan.sort((a, b) => a - b);
        });
        wxTo = null;
      }
      order.forEach(e => {
        if (e.dnf) return;

        // 基準ラップタイム
        let t = track.base * (1 + (refPerf - e.perf) * 0.00092);
        t *= (1 - e.st.pace);
        t /= wx.grip;

        // タイヤの銘柄によるペース差
        const ty = tyreOf(e.tyreKey);
        t *= ty.pace;

        // 路面と銘柄が噛み合っていないと、とたんに走れなくなる
        if (wx.wet && !ty.wet) t *= (wx.key === 'storm' ? 1.175 : 1.105);
        else if (!wx.wet && ty.wet) t *= (ty.key === 'wet' ? 1.135 : 1.055);

        // タイヤ摩耗。寿命を超えると急激にタレる
        e.tyreAge++;
        t += track.base * e.tyreAge * 0.00075 * track.tyre * e.tyreSkill * e.st.tyre * ty.wear;
        const over = e.tyreAge - ty.life;
        if (over > 0) t += track.base * over * over * 0.0006 * e.tyreSkill;
        e.lapTyre[lap - 1] = { key: e.tyreKey, age: Math.round(e.tyreAge), life: ty.life };

        // スタミナ低下（終盤）— アイアンマンは影響を受けない
        if (lap > laps * 0.6 && !e.sk('stamina')) {
          t += track.base * 0.0006 * (1 - e.driver.stamina / 200) * (lap - laps * 0.6);
        }

        // ラストスパート
        if (e.sk('spurt') && lap > laps * 0.8) t *= 0.994;

        // ERS：溜まっている電気を放電して速さに変える。
        // 前の車に迫っているときは多めに使う（前周の差で判定）
        const want = e.ersDeploy * (e.chasing ? E.attackMul : 1);
        const use = Math.min(e.battery, want);
        e.battery = Math.min(e.ersCap, e.battery - use + e.ersRecover);
        t *= (1 - use * E.gainPerUnit * ersScale);
        e.lapErs[lap - 1] = { level: Math.round(e.battery), cap: e.ersCap, used: Math.round(use) };

        // ランダム（精密機械はブレが小さい）
        const jitter = e.sk('precise') ? 0.45 : 1;
        t += track.base * S.rnd(-0.0035, 0.0045) * jitter * wx.chaos * (1 - e.driver.mental / 400);

        // スタート（1周目）
        if (lap === 1) t += e.grid * 0.42 - e.startBoost + track.base * 0.10;

        // セーフティカー中は全車そろって流す。差はほとんど開かない
        const underSC = scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps;
        if (underSC) {
          t = track.base * 1.34 + S.rnd(-0.15, 0.15);
          e.tyreAge = Math.max(0, e.tyreAge - 0.35);      // 流している間はタイヤも保つ
        }

        // ピットイン（新しいタイヤに履き替える）
        let pitAdd = 0;
        if (e.pitPlan.indexOf(lap) >= 0) {
          // セーフティカー中は隊列が遅いので、失う時間が小さい
          const scCheap = underSC ? 0.42 : 1;
          const loss = (e.pitLoss + S.rnd(-0.8, 2.2) + (Math.random() < 0.035 ? S.rnd(3, 9) : 0)) * scCheap;
          t += loss;
          pitAdd = loss;
          e.tyreAge = 0;
          e.pits.push(lap);
          e.stintIdx = Math.min(e.stints.length - 1, e.stintIdx + 1);
          e.tyreKey = e.stints[e.stintIdx].key;
          // 路面が変わっていたら、履くタイヤもそれに合わせる
          if (wx.wet !== tyreOf(e.tyreKey).wet) {
            e.tyreKey = wx.wet ? (wx.key === 'storm' ? 'wet' : 'inter')
                               : pickTyre(laps - lap, { key: 'sunny' }, null, e.tyreBias);
          }
          if (e.isPlayer) {
            const nt = tyreOf(e.tyreKey);
            events.push({ lap, type: 'pit', car: e,
              text: e.driver.name + ' ピットイン！ ' + nt.name + 'に交換 (' + loss.toFixed(1) + '秒)' });
          }
        }
        e.pitTime[lap - 1] = pitAdd;

        e.lapTimes[lap - 1] = t;
        const prev = lap === 1 ? 0 : e.cum[lap - 2];
        e.cum[lap - 1] = prev + t;
        if (lap > 1 && t < e.fastest) e.fastest = t;

        // 区間タイム：走行ぶんはマシンの速度プロファイルの配分で割り、
        // ピットでの停止時間は最終セクターにまとめて足す
        const sh = e.prof.share;
        const drive = t - pitAdd;
        const sec = [drive * sh[0], drive * sh[1], drive * sh[2] + pitAdd];
        e.sectors[lap - 1] = sec;
        for (let k = 0; k < 3; k++) {
          if (lap > 1 && sec[k] < e.bestSec[k]) e.bestSec[k] = sec[k];
          if (lap > 1 && sec[k] < bestSector[k]) { bestSector[k] = sec[k]; bestSectorBy[k] = e.id; }
        }
      });

      // ブロッキング（前車に詰まると遅くなる＝抜きにくいコースほど顕著）
      const running = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
      running.forEach(e => { e.chasing = false; });
      for (let i = 1; i < running.length; i++) {
        const gap = running[i].cum[lap - 1] - running[i - 1].cum[lap - 1];
        // 2秒以内なら次の周はERSを多めに使って仕掛ける
        if (gap > 0 && gap < 2.0) running[i].chasing = true;
        // ---- 追い抜きの攻防 ----
        // 0.8秒以内まで詰めたら仕掛ける。コースの性格で、
        // 「ストレートで刺す」か「コーナーで飛び込む」かが変わる。
        const scNow = scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps;
        if (!scNow && gap > 0 && gap < 0.55) {
          const atk = running[i], def = running[i - 1];
          // ストレートが長いコースほど、直線勝負になりやすい
          const onStraight = Math.random() < Math.min(0.88, 0.15 + passEase * 0.85);
          const batt = atk.ersCap ? atk.battery / atk.ersCap : 0;

          let p = 0.035 + (atk.perf - def.perf) * 0.007 + (0.55 - gap) * 0.22;
          if (onStraight) {
            // 直線：電気が残っているほど伸びる。スリップストリームも効く
            p += 0.07 + batt * 0.16 + geo.longestShare * 0.46;
          } else {
            // コーナー：腕とマシンのコーナー性能がものを言う
            p += (atk.driver.technique - def.driver.technique) * 0.004
               + (atk.stats.corner - def.stats.corner) * 0.0012;
          }
          if (atk.sk('passer')) p += 0.12;
          if (def.sk('heart')) p -= 0.08;             // 勝負強い相手は簡単には譲らない
          if (atk.st && atk.st.push) p += (atk.st.push - 1) * 0.10;
          if (atk.isPlayer) p += S.osk(g, 'call') * 0.08;    // 采配
          // コースの抜きやすさで全体を大きく上下させる。
          // 市街地では滅多に抜けず、直線の長いコースでは何度も入れ替わる。
          p *= 0.18 + passEase * 1.24;
          p = S.clamp(p, 0.01, 0.80);

          if (Math.random() < p) {
            // 成功：前に出る。詰まっていた時間もここで解ける
            atk.cum[lap - 1] = def.cum[lap - 1] - S.rnd(0.08, 0.28);
            atk.passes = (atk.passes || 0) + 1;
            if (atk.isPlayer || def.isPlayer) {
              events.push({ lap: lap, type: 'pass', car: atk,
                text: atk.driver.name + (onStraight
                  ? ' ストレートで ' + def.driver.name + ' を刺した！'
                  : ' コーナーで ' + def.driver.name + ' の内に飛び込んだ！') });
            }
          } else {
            // 失敗：抜けずに詰まる。コーナーで無理をすると足を痛める
            let stuck = (0.55 - gap) * (2.1 - passEase * 0.8);
            if (atk.sk('passer')) stuck *= 0.55;
            atk.cum[lap - 1] += stuck;
            if (!onStraight && Math.random() < 0.05 + (atk.st ? (atk.st.push - 1) * 0.05 : 0)) {
              const miss = S.rnd(0.7, 2.3);
              atk.cum[lap - 1] += miss;
              atk.tyreAge += 0.6;                     // 無理をするとタイヤも傷む
              if (atk.isPlayer) {
                events.push({ lap: lap, type: 'miss', car: atk,
                  text: atk.driver.name + ' 仕掛けきれずにコースを外れかけた…（-' +
                        miss.toFixed(1) + '秒）' });
              }
            }
          }
        }

        // ---- アンダーカット ----
        // 前の車に詰まっていて、抜きにくいコースで、自分のピット予定が近いなら、
        // 1周早く入って新しいタイヤで前に出ることを狙う。
        // 逆に前の車が先に入ったら、こちらは引っ張って（オーバーカット）応じる。
        const me = running[i], ahead = running[i - 1];
        if (!me.dnf && me.pitPlan.length && gap > 0 && gap < 2.6 && passEase < 0.95) {
          const next = me.pitPlan.find(l => l > lap);
          if (next != null && next - lap <= 3 && next > lap + 1 &&
              Math.random() < me.react * 0.34) {
            me.pitPlan[me.pitPlan.indexOf(next)] = lap + 1;
            me.pitPlan.sort((a, b) => a - b);
            me.undercut = (me.undercut || 0) + 1;
            if (me.isPlayer || ahead.isPlayer) {
              events.push({ lap: lap + 1, type: 'pit', car: me,
                text: me.driver.name + ' アンダーカットを狙って1周早くピットへ！' });
            }
          }
        }
      }

      // リタイア判定
      order.forEach(e => {
        if (e.dnf || lap < 2) return;
        const mech = (100 - e.rel) / 100 * 0.0022 * track.risk * (e.sk('feeler') ? 0.55 : 1);
        const crash = (1 - e.driver.mental / 230) * 0.0011 * track.risk * wx.chaos * e.st.risk
                      * (e.sk('heart') ? 0.40 : 1);
        const r = Math.random();
        if (r < mech) {
          e.dnf = true; e.dnfLap = lap; e.dnfReason = S.pick(['エンジンブロー', 'ギアボックストラブル', '油圧系トラブル', 'MGU-K故障', 'ブレーキトラブル']);
          events.push({ lap, type: 'dnf', car: e, text: e.driver.name + ' が' + e.dnfReason + 'でリタイア…' });
        } else if (r < mech + crash) {
          e.dnf = true; e.dnfLap = lap; e.dnfReason = S.pick(['クラッシュ', 'コースアウト', '接触']);
          events.push({ lap, type: 'dnf', car: e, text: e.driver.name + ' が' + e.dnfReason + '！ ここでレースを終える…' });
          // マシンがコース上に止まると、セーフティカーが入ることがある
          if (scLaps <= 0 && lap < laps - 2 && e.dnfReason !== 'コースアウト' &&
              Math.random() < 0.62 + track.risk * 0.18) {
            scPending = true;
          }
        }
      });

      // ---- セーフティカー ----
      // 隊列が詰まるので、大きなリードも一度リセットされる。
      // ここで入るか引っ張るかが、レースの分かれ目になる。
      if (scPending && !scDone) {
        scPending = false; scDone = true;
        scLaps = S.rint(3, 5);
        scFrom = lap + 1;
        scInfo.from = scFrom; scInfo.laps = scLaps;
        const run = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
        const lead = run.length ? run[0].cum[lap - 1] : 0;
        run.forEach((e, i) => {
          // 先頭のすぐ後ろに一列に並び直す
          e.cum[lap - 1] = lead + i * S.rnd(0.55, 0.95);
          e.scBunched = true;
        });
        events.push({ lap: lap, type: 'sc',
          text: '🚨 セーフティカー！ 隊列が一列に詰まる（' + scLaps + '周）' });
        // セーフティカー中はピットの損失が小さい。作戦が動く
        run.forEach(e => {
          const next = e.pitPlan.find(l => l > lap);
          if (next == null) return;
          // 予定が遠くても、安いピットなら前倒しする価値がある
          const worth = (next - lap) <= Math.round(laps * 0.45);
          if (worth && Math.random() < 0.55 + (e.react || 0.4) * 0.4) {
            e.pitPlan[e.pitPlan.indexOf(next)] = lap + 1;
            e.pitPlan.sort((a, b) => a - b);
            e.scPit = true;
            if (e.isPlayer) {
              events.push({ lap: lap + 1, type: 'pit', car: e,
                text: e.driver.name + ' セーフティカー中にピットへ！ ロスが小さい' });
            }
          }
        });
      }

      // 順位変動の記録
      const newOrder = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
      if (lap > 1) {
        newOrder.forEach((e, i) => {
          const prevIdx = posHistory[posHistory.length - 1].indexOf(e.id);
          if (prevIdx >= 0 && prevIdx > i && e.isPlayer) {
            const victim = newOrder[i + 1];
            if (victim) events.push({ lap, type: 'pass', car: e, text: e.driver.name + ' が ' + victim.driver.name + ' をオーバーテイク！ → ' + (i + 1) + '位' });
          }
        });
      }
      posHistory.push(newOrder.map(e => e.id));
      order = newOrder.concat(order.filter(e => e.dnf));
    }

    // 最終結果
    const finishers = entries.filter(e => !e.dnf).sort((a, b) => a.cum[laps - 1] - b.cum[laps - 1]);
    const retired = entries.filter(e => e.dnf).sort((a, b) => b.dnfLap - a.dnfLap);
    const classified = finishers.concat(retired);
    classified.forEach((e, i) => { e.pos = i + 1; });

    let fl = null;
    finishers.forEach(e => { if (!fl || e.fastest < fl.fastest) fl = e; });

    return {
      track, trackIndex, weather, laps, grid, entries, classified, finishers,
      events, fastestLap: fl, geo: geo, passEase: passEase, special: special || null,
      bestSector: bestSector, bestSectorBy: bestSectorBy,
      safetyCar: scInfo.laps ? scInfo : null,
      hotTeam: entries.hotTeam || '',
      weatherChange: wxInfo.at ? wxInfo : null,
      totalTime: laps * track.base * 1.05
    };
  }

  /* ---------- レース結果をゲームに反映 ---------- */
  function applyResult(g, res) {
    const notes = [];
    const sp = res.special;
    const diff = S.diffOf(g);
    let prize = 0, fanDelta = 0;

    // ファステストラップは10位以内で完走した場合のみ1点（実際のF1と同じ扱い）
    const flCar = res.fastestLap;
    const flScores = !!(flCar && !flCar.dnf && flCar.pos <= D.POINTS.length);

    res.classified.forEach(e => {
      let pts = (!e.dnf && e.pos <= D.POINTS.length) ? D.POINTS[e.pos - 1] : 0;
      const gotFL = flCar && e.id === flCar.id;
      if (gotFL && flScores) pts += D.FASTEST_LAP_POINT;
      // 特別戦は選手権とは無関係。ポイントも通算成績も動かない
      e.points = sp ? 0 : pts;
      e.flPoint = !sp && gotFL && flScores;
      if (!sp) {
        e.driver.seasonPoints += pts;
        e.driver.races++;
        if (e.grid === 1) e.driver.poles = (e.driver.poles || 0) + 1;
        if (gotFL) e.driver.fastestLaps = (e.driver.fastestLaps || 0) + 1;
        if (e.dnf) e.driver.dnfs = (e.driver.dnfs || 0) + 1;
        else {
          if (e.pos === 1) e.driver.wins++;
          if (e.pos <= 3) e.driver.podiums++;
          if (e.pos < (e.driver.best || 99)) e.driver.best = e.pos;
        }
      }
      // 結果を受けての調子の変化は全ドライバーに等しく起きる
      S.reactToResult(e.driver, e.pos, e.dnf);
      if (e.isPlayer) {
        if (!sp) g.points += pts;
        const base = (800 + pts * 470 + (e.dnf ? 0 : Math.max(0, 1300 - e.pos * 50))) * diff.prize;
        prize += sp ? base * sp.prize : base;
        let gain = 12 + Math.max(0, 22 - e.pos) + (e.dnf ? 0 : 8);
        if (sp) gain = Math.round(gain * sp.lapMul) + (sp.exp || 0);
        e.driver.exp += Math.round(gain * (S.hasSkill(e.driver, 'grower') ? 1.5 : 1));
      } else if (!sp) {
        e.team.points += pts;
      }
    });

    // ファン増減
    const best = res.classified.filter(e => e.isPlayer).sort((a, b) => a.pos - b.pos)[0];
    if (best) {
      if (best.pos === 1)      { fanDelta = Math.round(600 + g.fans * 0.16); notes.push('🏆 優勝！ 街中が歓喜に包まれた！'); }
      else if (best.pos <= 3)  { fanDelta = Math.round(300 + g.fans * 0.09); notes.push('🥉 表彰台！ ファンが増えた！'); }
      else if (best.pos <= 10) { fanDelta = Math.round(120 + g.fans * 0.04); notes.push(sp ? '完走。手応えは残った。' : 'ポイント獲得。着実にファンが増えている。'); }
      else                     { fanDelta = -Math.round(30 + g.fans * 0.02); notes.push(sp ? '結果は振るわなかった…' : 'ノーポイント…ファンが少し離れてしまった。'); }
      if (sp) fanDelta = Math.round(Math.max(0, fanDelta) * sp.fans + 60 * sp.fans);
    }

    // ---- 注目度（露出）----
    // 入賞できなくても、より上位でゴールすれば話題にはなる
    let hypeDelta = 0;
    res.classified.filter(e => e.isPlayer).forEach(e => {
      if (e.dnf) { hypeDelta -= 2; return; }
      hypeDelta += (D.HYPE_BY_POS[e.pos - 1] || 0.2);
      if (e.grid === 1) hypeDelta += 3;                       // ポールポジション
      if (e.flPoint || (res.fastestLap && res.fastestLap.id === e.id)) hypeDelta += 3;
      const gained = e.grid - e.pos;
      if (gained > 0) hypeDelta += Math.min(6, gained * 0.4); // 追い上げも評価される
    });
    if (sp) hypeDelta *= 0.6;                                  // 特別戦は選手権より扱いが小さい
    hypeDelta *= (1 + S.mgr(g, 'principal') * 0.004);          // 発信力のあるプリンシパルほど話題になる
    const beforeTier = S.hypeTier(g).name;
    S.addHype(g, hypeDelta);
    const afterTier = S.hypeTier(g).name;
    if (afterTier !== beforeTier) {
      notes.push('📣 メディアでの扱いが「' + afterTier + '」に変わった！ スポンサー収入が伸びる。');
      res.hypeUp = afterTier;
    }
    res.hypeDelta = hypeDelta;

    // スポンサー報酬（種別によって資金・研究P・ファンのどれが入るかが変わる）
    const hb = S.hypeBonus(g) * (1 + S.mgr(g, 'principal') * 0.006);
    const spScale = (1 + g.facilities.market * 0.07) * hb * (sp ? 0.4 : 1) * diff.sponsor;
    let sponsorIncome = 0, sponsorRp = 0, sponsorFans = 0;
    g.sponsors.forEach(s2 => {
      sponsorIncome += (s2.per || 0) * spScale;
      sponsorRp     += (s2.rp || 0) * spScale;
      sponsorFans   += (s2.fan || 0) * spScale;
      // 達成ボーナスは契約上、シーズンあたりの回数に上限がある
      const hits = s2.hits || 0;
      if (!sp && best && !best.dnf && best.pos <= s2.need && hits < D.SPONSOR_BONUS_CAP) {
        s2.hits = hits + 1;
        sponsorIncome += (s2.bonus || 0);
        sponsorRp += (s2.bonusRp || 0);
        const kind = D.SPONSOR_KINDS[s2.kind] || D.SPONSOR_KINDS.cash;
        notes.push(kind.icon + ' ' + s2.name + ' の目標達成ボーナス！ +' +
          Math.round(s2.bonus || 0) + '万' + (s2.bonusRp ? ' / 研究P +' + s2.bonusRp : '') +
          '（今季 ' + s2.hits + '/' + D.SPONSOR_BONUS_CAP + '回目）');
      }
    });
    sponsorIncome = Math.round(sponsorIncome);
    sponsorRp = Math.round(sponsorRp);
    sponsorFans = Math.round(sponsorFans);
    fanDelta += sponsorFans;

    // パーツの消耗
    S.wearParts(g, S.rnd(1.5, 4.5) * res.track.risk * (sp ? sp.wear : 1));

    // 入賞できない状態が続いたら、開発チケットが届く（選手権のみ）
    if (!sp) {
      const scored = res.classified.some(e => e.isPlayer && !e.dnf && e.points > 0);
      if (scored) {
        g.dryStreak = 0;
      } else {
        g.dryStreak = (g.dryStreak || 0) + 1;
        if (g.dryStreak >= diff.ticket) {
          g.dryStreak = 0;
          g.tickets = (g.tickets || 0) + 1;
          notes.push('🎫 苦戦が続いたチームに開発チケットが届いた！（開発・設計を1回無料で行える）');
          res.gotTicket = true;
        }
      }
    }

    // 初優勝フラグ
    if (!sp && best && best.pos === 1 && !g.flags.firstWin) {
      g.flags.firstWin = true;
      notes.push('🎉 チーム初優勝！ 記念すべき一勝が刻まれた！');
    }

    g.funds += prize + sponsorIncome;
    // 知名度の高いオーナーのチームは、同じ結果でもファンが増えやすい
    if (fanDelta > 0) fanDelta = Math.round(fanDelta * (1 + S.osk(g, 'fame') * 0.08));
    g.fans = Math.max(0, g.fans + fanDelta);
    g.rp += (sp ? sp.rp : 8) + Math.round(S.staffBonus(g, 'analyst') * 2) + sponsorRp;

    res.reward = { prize, sponsorIncome, sponsorRp, sponsorFans, fanDelta, notes };
    if (!sp) g.results.push({
      season: g.season, round: res.trackIndex + 1, track: res.track.name,
      weather: res.weather.name,
      rows: res.classified.slice(0, 22).map(e => ({
        pos: e.pos, name: e.driver.name, team: e.team.name, color: e.color,
        grid: e.grid, pts: e.points, dnf: e.dnf, isPlayer: e.isPlayer,
        fl: !!e.flPoint || !!(res.fastestLap && res.fastestLap.id === e.id)
      }))
    });
    return res.reward;
  }

  return { simulate, applyResult, STRATEGIES, rollWeather };
})();

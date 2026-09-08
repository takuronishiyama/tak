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
    const list = [];
    teams.forEach((t, ti) => {
      t.drivers.forEach((d, di) => {
        const strat = t.isPlayer ? (strategy[d.id] || 'balance') : autoStrategy(t, track);
        const st = STRATEGIES[strat];
        const sk = k => S.hasSkill(d, k);
        let drv = S.driverRating(d);
        // スキルによる補正
        if (sk('rain') && (weather.key === 'rain' || weather.key === 'storm')) drv *= 1.18;
        const perf = t.car * 0.60 + drv * 0.40;

        const stats = t.stats || { speed: 1, corner: 1, accel: 1 };
        list.push({
          id: t.isPlayer ? d.id : (t.name + di),
          driver: d, team: t, color: t.color, isPlayer: !!t.isPlayer,
          num: list.length + 1,
          stats: stats,
          // このマシンがコース上でどう速度を出すか。区間タイムの配分もここから来る
          prof: GP.geom.speedProfile(track, stats),
          gen: t.isPlayer ? g.carGen : Math.min(D.CAR_GENS.length - 1, Math.round((t.car - 12) / 26)),
          perf: perf, strat: strat, st: st, sk: sk,
          startTyre: t.isPlayer ? (strategy['tyre_' + d.id] || null) : null,
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
    const weather = special && special.force
      ? (D.WEATHER.find(w => w.key === special.force) || rollWeather(track))
      : rollWeather(track);
    const entries = buildEntries(g, track, weather, strategy);
    const grid = qualify(entries, track, weather);
    const laps = Math.max(4, Math.round(track.laps * (special ? special.lapMul : 1)));
    const events = [];
    const bestSector = [Infinity, Infinity, Infinity];   // セッション最速（紫）
    const bestSectorBy = [null, null, null];
    // 追い抜きやすさ：最長ストレートの長さ（実際の形状）と、コースの速度特性から決める
    const geo = GP.geom.analyze(track);
    const passEase = 0.25 + geo.longestShare * 1.1 + track.weight.speed * 0.5;
    const refPerf = Math.max.apply(null, entries.map(e => e.perf)) + 4;
    const pitLoss = 20.5 - g.facilities.pit * 0.7 - S.staffBonus(g, 'mechanic') * 0.4;
    const strategist = S.staffBonus(g, 'strategist');

    // ピット戦略とタイヤの割り当て
    entries.forEach(e => {
      const wear = track.tyre * e.st.tyre * e.tyreSkill;
      let stops = (wear > 1.05 || laps > 28) ? 2 : 1;
      // ライバルはチームごとに作戦を変える。少ないストップなら硬いタイヤで長く走る
      e.tyreBias = 1;                     // 自チームの2本目以降はバランス型
      if (!e.isPlayer) {
        const r = Math.random();
        if (r < 0.26) { stops = Math.max(1, stops - 1); e.tyreBias = 2; }
        else if (r < 0.48) { stops = Math.min(3, stops + 1); e.tyreBias = 0; }
        else { e.tyreBias = S.rint(0, 2); }
      }
      const blur = e.isPlayer ? Math.max(0, 1.6 - strategist * 0.5) : 1.2;
      e.pitPlan = [];
      for (let i = 1; i <= stops; i++) {
        e.pitPlan.push(Math.max(2, Math.round(laps * i / (stops + 1) + S.rnd(-blur, blur))));
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
      e.tyreKey = e.stints[0].key;
      e.stintIdx = 0;
      e.lapTyre = [];       // 各周のタイヤと使用周回数（観戦画面の表示に使う）
      e.pitTime = [];       // 各周のピット停止時間
    });

    let order = grid.slice();
    const posHistory = [];

    for (let lap = 1; lap <= laps; lap++) {
      order.forEach(e => {
        if (e.dnf) return;

        // 基準ラップタイム
        let t = track.base * (1 + (refPerf - e.perf) * 0.00092);
        t *= (1 - e.st.pace);
        t /= weather.grip;

        // タイヤの銘柄によるペース差
        const ty = tyreOf(e.tyreKey);
        t *= ty.pace;

        // タイヤ摩耗。寿命を超えると急激にタレる
        e.tyreAge++;
        t += track.base * e.tyreAge * 0.00075 * track.tyre * e.tyreSkill * e.st.tyre * ty.wear;
        const over = e.tyreAge - ty.life;
        if (over > 0) t += track.base * over * over * 0.0006 * e.tyreSkill;
        e.lapTyre[lap - 1] = { key: e.tyreKey, age: e.tyreAge, life: ty.life };

        // スタミナ低下（終盤）— アイアンマンは影響を受けない
        if (lap > laps * 0.6 && !e.sk('stamina')) {
          t += track.base * 0.0006 * (1 - e.driver.stamina / 200) * (lap - laps * 0.6);
        }

        // ラストスパート
        if (e.sk('spurt') && lap > laps * 0.8) t *= 0.994;

        // ランダム（精密機械はブレが小さい）
        const jitter = e.sk('precise') ? 0.45 : 1;
        t += track.base * S.rnd(-0.0035, 0.0045) * jitter * weather.chaos * (1 - e.driver.mental / 400);

        // スタート（1周目）
        if (lap === 1) t += e.grid * 0.42 - e.startBoost + track.base * 0.10;

        // ピットイン（新しいタイヤに履き替える）
        let pitAdd = 0;
        if (e.pitPlan.indexOf(lap) >= 0) {
          const loss = e.pitLoss + S.rnd(-0.8, 2.2) + (Math.random() < 0.035 ? S.rnd(3, 9) : 0);
          t += loss;
          pitAdd = loss;
          e.tyreAge = 0;
          e.pits.push(lap);
          e.stintIdx = Math.min(e.stints.length - 1, e.stintIdx + 1);
          e.tyreKey = e.stints[e.stintIdx].key;
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
      for (let i = 1; i < running.length; i++) {
        const gap = running[i].cum[lap - 1] - running[i - 1].cum[lap - 1];
        if (gap > 0 && gap < 0.9) {
          let stuck = (0.9 - gap) * (1.5 - passEase * 0.6);
          if (running[i].sk('passer')) stuck *= 0.45;
          running[i].cum[lap - 1] += stuck;
        }
      }

      // リタイア判定
      order.forEach(e => {
        if (e.dnf || lap < 2) return;
        const mech = (100 - e.rel) / 100 * 0.0022 * track.risk * (e.sk('feeler') ? 0.55 : 1);
        const crash = (1 - e.driver.mental / 230) * 0.0011 * track.risk * weather.chaos * e.st.risk
                      * (e.sk('heart') ? 0.40 : 1);
        const r = Math.random();
        if (r < mech) {
          e.dnf = true; e.dnfLap = lap; e.dnfReason = S.pick(['エンジンブロー', 'ギアボックストラブル', '油圧系トラブル', 'MGU-K故障', 'ブレーキトラブル']);
          events.push({ lap, type: 'dnf', car: e, text: e.driver.name + ' が' + e.dnfReason + 'でリタイア…' });
        } else if (r < mech + crash) {
          e.dnf = true; e.dnfLap = lap; e.dnfReason = S.pick(['クラッシュ', 'コースアウト', '接触']);
          events.push({ lap, type: 'dnf', car: e, text: e.driver.name + ' が' + e.dnfReason + '！ ここでレースを終える…' });
        }
      });

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
    const beforeTier = S.hypeTier(g).name;
    S.addHype(g, hypeDelta);
    const afterTier = S.hypeTier(g).name;
    if (afterTier !== beforeTier) {
      notes.push('📣 メディアでの扱いが「' + afterTier + '」に変わった！ スポンサー収入が伸びる。');
      res.hypeUp = afterTier;
    }
    res.hypeDelta = hypeDelta;

    // スポンサー収入（注目度が高いほど増える。特別戦は選手権外なので基本給のみ）
    const hb = S.hypeBonus(g);
    let sponsorIncome = 0;
    g.sponsors.forEach(s2 => {
      sponsorIncome += s2.per * (1 + g.facilities.market * 0.12) * hb * (sp ? 0.4 : 1) * diff.sponsor;
      if (!sp && best && !best.dnf && best.pos <= s2.need) {
        sponsorIncome += s2.bonus;
        notes.push('📣 ' + s2.name + ' の目標達成ボーナス！ +' + Math.round(s2.bonus) + '万');
      }
    });
    sponsorIncome = Math.round(sponsorIncome);

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
    g.fans = Math.max(0, g.fans + fanDelta);
    g.rp += (sp ? sp.rp : 8) + Math.round(S.staffBonus(g, 'analyst') * 2);

    res.reward = { prize, sponsorIncome, fanDelta, notes };
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

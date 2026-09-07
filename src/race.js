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
        let drv = S.driverRating(d);
        // 個性による補正
        if (d.trait === '雨マスター' && (weather.key === 'rain' || weather.key === 'storm')) drv *= 1.16;
        if (d.trait === 'タイヤに優しい') drv *= 1.02;
        const perf = t.car * 0.60 + drv * 0.40;

        list.push({
          id: t.isPlayer ? d.id : (t.name + di),
          driver: d, team: t, color: t.color, isPlayer: !!t.isPlayer,
          num: list.length + 1,
          perf: perf, strat: strat, st: st,
          rel: t.rel,
          tyreSkill: (d.trait === 'タイヤに優しい' ? 0.55 : 1) * (1 - d.technique / 420),
          lapTimes: [], cum: [], pits: [],
          dnf: false, dnfLap: -1, dnfReason: '',
          grid: 0, pos: 0, fastest: Infinity
        });
      });
    });
    return list;
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
      if (e.driver.trait === '予選番長') q *= 1.06;
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
  function simulate(g, trackIndex, strategy) {
    const track = D.TRACKS[trackIndex];
    const weather = rollWeather(track);
    const entries = buildEntries(g, track, weather, strategy);
    const grid = qualify(entries, track, weather);
    const laps = track.laps;
    const events = [];
    const passEase = 0.35 + track.weight.speed;
    const refPerf = Math.max.apply(null, entries.map(e => e.perf)) + 4;
    const pitLoss = 20.5 - g.facilities.pit * 0.7 - S.staffBonus(g, 'mechanic') * 0.4;

    // ピット戦略決定
    entries.forEach(e => {
      const stops = (track.tyre * e.st.tyre > 1.18 || laps > 28) ? 2 : 1;
      e.pitPlan = [];
      for (let i = 1; i <= stops; i++) {
        e.pitPlan.push(Math.round(laps * i / (stops + 1)) + S.rint(-1, 1));
      }
      e.tyreAge = 0;
      e.startBoost = (e.driver.trait === 'スタート職人' ? 1.6 : 0) + e.driver.technique / 200;
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

        // タイヤ摩耗
        e.tyreAge++;
        t += track.base * e.tyreAge * 0.00075 * track.tyre * e.tyreSkill * e.st.tyre;

        // スタミナ低下（終盤）
        if (lap > laps * 0.6) t += track.base * 0.0006 * (1 - e.driver.stamina / 200) * (lap - laps * 0.6);

        // ランダム
        t += track.base * S.rnd(-0.0035, 0.0045) * weather.chaos * (1 - e.driver.mental / 400);

        // スタート（1周目）
        if (lap === 1) t += e.grid * 0.42 - e.startBoost + track.base * 0.10;

        // ピットイン
        if (e.pitPlan.indexOf(lap) >= 0) {
          const loss = pitLoss + S.rnd(-0.8, 2.2) + (Math.random() < 0.035 ? S.rnd(3, 9) : 0);
          t += loss;
          e.tyreAge = 0;
          e.pits.push(lap);
          if (e.isPlayer) events.push({ lap, type: 'pit', car: e, text: e.driver.name + ' ピットイン！ (' + loss.toFixed(1) + '秒)' });
        }

        e.lapTimes[lap - 1] = t;
        const prev = lap === 1 ? 0 : e.cum[lap - 2];
        e.cum[lap - 1] = prev + t;
        if (lap > 1 && t < e.fastest) e.fastest = t;
      });

      // ブロッキング（前車に詰まると遅くなる＝抜きにくいコースほど顕著）
      const running = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
      for (let i = 1; i < running.length; i++) {
        const gap = running[i].cum[lap - 1] - running[i - 1].cum[lap - 1];
        if (gap > 0 && gap < 0.9) {
          const stuck = (0.9 - gap) * (1.5 - passEase * 0.6);
          running[i].cum[lap - 1] += stuck;
        }
      }

      // リタイア判定
      order.forEach(e => {
        if (e.dnf || lap < 2) return;
        const mech = (100 - e.rel) / 100 * 0.0022 * track.risk;
        const crash = (1 - e.driver.mental / 230) * 0.0011 * track.risk * weather.chaos * e.st.risk;
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
      events, fastestLap: fl,
      totalTime: laps * track.base * 1.05
    };
  }

  /* ---------- レース結果をゲームに反映 ---------- */
  function applyResult(g, res) {
    const notes = [];
    let prize = 0, fanDelta = 0;

    res.classified.forEach(e => {
      const pts = (!e.dnf && e.pos <= D.POINTS.length) ? D.POINTS[e.pos - 1] : 0;
      e.points = pts;
      e.driver.seasonPoints += pts;
      e.driver.races++;
      if (!e.dnf) {
        if (e.pos === 1) e.driver.wins++;
        if (e.pos <= 3) e.driver.podiums++;
      }
      if (e.isPlayer) {
        g.points += pts;
        prize += 620 + pts * 420 + (e.dnf ? 0 : Math.max(0, 1100 - e.pos * 45));
        e.driver.exp += 12 + Math.max(0, 22 - e.pos) + (e.dnf ? 0 : 8);
      } else {
        e.team.points += pts;
      }
    });

    // ファン増減
    const best = res.classified.filter(e => e.isPlayer).sort((a, b) => a.pos - b.pos)[0];
    if (best) {
      if (best.pos === 1)      { fanDelta = Math.round(600 + g.fans * 0.16); notes.push('🏆 優勝！ 街中が歓喜に包まれた！'); }
      else if (best.pos <= 3)  { fanDelta = Math.round(300 + g.fans * 0.09); notes.push('🥉 表彰台！ ファンが増えた！'); }
      else if (best.pos <= 10) { fanDelta = Math.round(120 + g.fans * 0.04); notes.push('ポイント獲得。着実にファンが増えている。'); }
      else                     { fanDelta = -Math.round(30 + g.fans * 0.02); notes.push('ノーポイント…ファンが少し離れてしまった。'); }
    }

    // スポンサー収入
    let sponsorIncome = 0;
    g.sponsors.forEach(sp => {
      sponsorIncome += sp.per * (1 + g.facilities.market * 0.12);
      if (best && !best.dnf && best.pos <= sp.need) {
        sponsorIncome += sp.bonus;
        notes.push('📣 ' + sp.name + ' の目標達成ボーナス！ +' + Math.round(sp.bonus) + '万');
      }
    });
    sponsorIncome = Math.round(sponsorIncome);

    // パーツの消耗
    D.PART_CATS.forEach(c => {
      g.parts[c.key].cond = S.clamp(g.parts[c.key].cond - S.rnd(1.5, 4.5) * res.track.risk, 20, 100);
    });

    // 初優勝フラグ
    if (best && best.pos === 1 && !g.flags.firstWin) {
      g.flags.firstWin = true;
      notes.push('🎉 チーム初優勝！ 記念すべき一勝が刻まれた！');
    }

    g.funds += prize + sponsorIncome;
    g.fans = Math.max(0, g.fans + fanDelta);
    g.rp += 8 + Math.round(S.staffBonus(g, 'analyst') * 2);

    res.reward = { prize, sponsorIncome, fanDelta, notes };
    g.results.push({
      season: g.season, round: res.trackIndex + 1, track: res.track.name,
      weather: res.weather.name,
      rows: res.classified.slice(0, 22).map(e => ({
        pos: e.pos, name: e.driver.name, team: e.team.name, color: e.color,
        grid: e.grid, pts: e.points, dnf: e.dnf, isPlayer: e.isPlayer
      }))
    });
    return res.reward;
  }

  return { simulate, applyResult, STRATEGIES, rollWeather };
})();

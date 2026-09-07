/* =========================================================
   ゲーム状態・ルール計算
   ========================================================= */
window.GP = window.GP || {};

GP.state = (function () {
  'use strict';
  const D = GP.data;
  const SAVE_KEY = 'gp_monogatari_save_v2';

  /* ---------- 乱数ユーティリティ ---------- */
  const rnd  = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* =======================================================
     パーツ（アイテム）
     ======================================================= */
  let partSeq = 0;
  function makePart(catKey, gen, rarity, opts) {
    opts = opts || {};
    const cat = D.PART_CATS.find(c => c.key === catKey);
    const rr = D.RARITY[rarity - 1];
    const power = opts.power != null ? opts.power
      : Math.round((10 + gen * 13) * rr.mult * rnd(0.92, 1.10) * 10) / 10;
    const traits = [];
    if (opts.traits) traits.push.apply(traits, opts.traits);
    else {
      // レアリティが高いほど追加効果が付きやすい
      if (Math.random() < 0.10 + rarity * 0.07) traits.push(pick(D.PART_TRAITS).key);
      if (rarity >= 4 && Math.random() < 0.30) {
        const t = pick(D.PART_TRAITS).key;
        if (traits.indexOf(t) < 0) traits.push(t);
      }
    }
    return {
      id: 'p' + (++partSeq) + Math.random().toString(36).slice(2, 6),
      cat: catKey,
      name: cat.names[Math.min(cat.names.length - 1, gen)],
      gen: gen, rarity: rarity,
      power: power,
      cond: opts.cond != null ? opts.cond : 100,
      traits: traits
    };
  }

  const hasT = (p, k) => p.traits && p.traits.indexOf(k) >= 0;

  /* パーツ1つが生む3性能 */
  function partStats(p) {
    const cat = D.PART_CATS.find(c => c.key === p.cat);
    const st = {
      speed:  p.power * cat.gain.speed,
      corner: p.power * cat.gain.corner,
      accel:  p.power * cat.gain.accel
    };
    if (hasT(p, 'boost')) st.speed  *= 1.14;
    if (hasT(p, 'sharp')) st.corner *= 1.14;
    if (hasT(p, 'light')) st.accel  *= 1.16;
    return st;
  }

  /* 改良の上限（マシン世代 × レアリティ） */
  function partCap(g, p) {
    return Math.round(D.CAR_GENS[g.carGen].cap * D.RARITY[p.rarity - 1].capMult);
  }

  /* パーツの総合評価（表示用） */
  function partScore(p) {
    const st = partStats(p);
    return Math.round(st.speed + st.corner + st.accel);
  }

  /* 設計時のレアリティ抽選（デザイナーの腕で上振れする） */
  function rollRarity(g) {
    const dz = staffBonus(g, 'designer') + g.facilities.factory * 0.35;
    const w = [
      Math.max(6, 58 - dz * 5),
      26 + dz * 0.6,
      11 + dz * 2.0,
      4 + dz * 1.7,
      1 + dz * 0.8
    ];
    const total = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i + 1; }
    return 1;
  }

  /* ---------- 名前生成（同じ姓が並ばないようにする）---------- */
  let takenLast = new Set();
  const surnameOf = n => String(n).split('・').slice(1).join('・') || n;
  function resetNames(keepNames) {
    takenLast = new Set((keepNames || []).map(surnameOf));
  }
  function freshName() {
    for (let i = 0; i < 80; i++) {
      const last = pick(D.LAST);
      if (!takenLast.has(last)) { takenLast.add(last); return pick(D.FIRST) + '・' + last; }
    }
    return pick(D.FIRST) + '・' + pick(D.LAST);
  }

  /* ---------- ドライバー生成 ---------- */
  function makeDriver(level, opts) {
    opts = opts || {};
    const base = 18 + level * 9;
    const sp = (v) => clamp(Math.round(v + rnd(-7, 7)), 5, 190);
    const d = {
      id: 'd' + Math.random().toString(36).slice(2, 9),
      name: opts.name || freshName(),
      age: opts.age || rint(19, 34),
      speed: sp(base), technique: sp(base), stamina: sp(base), mental: sp(base),
      exp: 0, expLv: 1,
      form: 100,             // コンディション 60-120
      salary: 0,
      seasonPoints: 0, wins: 0, podiums: 0, races: 0,
      nation: opts.nation || rint(0, D.NATIONS.length - 1),
      pers: opts.pers || pick(D.PERSONALITIES).key,
      face: rint(0, 999999),          // 顔の見た目を決める種
      skills: opts.skills || rollSkills(level)
    };
    d.salary = Math.round((d.speed + d.technique + d.stamina + d.mental) / 4 * 0.95 + 18);
    return d;
  }

  /* ---------- スキル抽選 ---------- */
  const SKILL_MAX = 5;
  function rollSkills(level) {
    const n = level >= 6 ? 2 : (level >= 3 && Math.random() < 0.5 ? 2 : 1);
    const out = [];
    while (out.length < n) {
      const k = pick(D.SKILLS).key;
      if (out.indexOf(k) < 0) out.push(k);
    }
    return out;
  }
  const hasSkill = (d, k) => d.skills && d.skills.indexOf(k) >= 0;
  const persOf = d => D.PERSONALITIES.find(x => x.key === d.pers) || D.PERSONALITIES[0];
  const nationOf = d => D.NATIONS[d.nation] || D.NATIONS[0];

  /* レース結果を受けての調子の変化。性格で振れ幅が変わる */
  function reactToResult(d, pos, dnf) {
    const p = persOf(d);
    let delta;
    if (dnf) delta = -rnd(6, 12) * p.down;
    else if (pos === 1) delta = rnd(9, 16) * p.up;
    else if (pos <= 3) delta = rnd(5, 11) * p.up;
    else if (pos <= 10) delta = rnd(-1, 4) * (pos <= 6 ? p.up : p.down);
    else delta = -rnd(2, 6) * p.down;
    d.form = clamp(d.form + delta, 62, 122);
    return delta;
  }

  /* レース後のひとこと */
  function quoteFor(d, pos, dnf, avoid) {
    const set = D.QUOTES[d.pers] || D.QUOTES.cool;
    const bucket = (!dnf && pos === 1) ? 'win' : (!dnf && pos <= 10) ? 'ok' : 'bad';
    const lines = set[bucket].filter(l => !avoid || avoid.indexOf(l) < 0);
    return pick(lines.length ? lines : set[bucket]);
  }
  function learnableSkills(d) {
    return D.SKILLS.filter(s => !hasSkill(d, s.key));
  }
  function teachSkill(d, key) {
    if (!d.skills) d.skills = [];
    if (d.skills.length >= SKILL_MAX || hasSkill(d, key)) return false;
    d.skills.push(key);
    return true;
  }

  /* ---------- ドライバー総合力 ---------- */
  function driverRating(d) {
    let r = (d.speed * 0.34 + d.technique * 0.30 + d.stamina * 0.18 + d.mental * 0.18) * (d.form / 100);
    if (hasSkill(d, 'genius')) r *= 1.08;
    return r;
  }

  /* ---------- マシン性能の導出（装着パーツ＋マシン世代のベース）---------- */
  function carStats(g) {
    const s = { speed: 0, corner: 0, accel: 0 };
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) return;
      const ps = partStats(p);
      // コンディションが落ちたパーツは本来の性能を出しきれない
      const f = 0.82 + p.cond / 100 * 0.18;
      s.speed += ps.speed * f;
      s.corner += ps.corner * f;
      s.accel += ps.accel * f;
    });
    const base = D.CAR_GENS[g.carGen].base;
    s.speed += base; s.corner += base; s.accel += base;
    return s;
  }

  /* ---------- マシン信頼性（0-100）---------- */
  function reliability(g) {
    let sum = 0, bonus = 0, n = 0;
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) { sum += 40; n++; return; }
      sum += p.cond; n++;
      if (hasT(p, 'cool')) bonus += 4;
      if (hasT(p, 'tough')) bonus += 2;
    });
    const avg = sum / Math.max(1, n);
    return clamp(avg + bonus + g.facilities.pit * 2.5 + staffBonus(g, 'mechanic') * 1.2, 5, 99);
  }

  /* ---------- パーツの消耗（レース後）---------- */
  function wearParts(g, amount) {
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) return;
      const w = amount * (hasT(p, 'tough') ? 0.55 : 1);
      p.cond = clamp(p.cond - w, 5, 100);
    });
  }

  /* ---------- 3性能とコース適性からマシンスコアを出す ---------- */
  function carScoreOf(s, track) {
    return s.speed * track.weight.speed + s.corner * track.weight.corner + s.accel * track.weight.accel;
  }
  function carScore(g, track) { return carScoreOf(carStats(g), track); }

  /* ---------- スタッフ効果 ---------- */
  function staffBonus(g, key) {
    return g.staff.filter(s => s.type === key).reduce((a, s) => a + s.skill, 0) / 20;
  }

  /* ---------- 週あたりの固定費 ---------- */
  function weeklyCost(g) {
    const staff = g.staff.reduce((a, s) => a + s.salary, 0);
    const drv = g.drivers.reduce((a, d) => a + d.salary, 0);
    const fac = D.FACILITIES.reduce((a, f) => a + g.facilities[f.key] * 12, 0);
    return Math.round(staff + drv + fac + 150);
  }

  /* ---------- ライバルチーム生成 ---------- */
  function makeRivals(season, keepNames) {
    resetNames(keepNames);
    return D.RIVALS.map((r, i) => {
      const lv = (3 + season * 2.1) * r.power;
      const base = 18 * r.power + season * 10 * r.power + rnd(-4, 4);
      const t = {
        name: r.name, color: r.color, isPlayer: false, char: r.char,
        // 3性能の絶対値。コース適性込みの速さは carScoreOf() で算出する
        stats: {
          speed:  base * 3 * r.bias.speed,
          corner: base * 3 * r.bias.corner,
          accel:  base * 3 * r.bias.accel
        },
        rel: clamp(72 + r.power * 18 + season * 1.2 + rnd(-8, 8), 40, 97),
        points: 0,
        drivers: [makeDriver(lv), makeDriver(lv * 0.92)]
      };
      t.drivers.forEach(d => { d.team = t.name; });
      return t;
    });
  }

  /* ---------- カレンダー ---------- */
  const PREP_WEEKS = 3;      // レース間の準備週
  function raceWeek(i) { return (i + 1) * (PREP_WEEKS + 1); }   // 第i戦(0-index)の週
  const SEASON_WEEKS = D.TRACKS.length * (PREP_WEEKS + 1);

  /* ---------- 新規ゲーム ---------- */
  function newGame(teamName, color) {
    const g = {
      version: 2,
      team: teamName || 'ニューカマーGP',
      color: color || '#e04a3f',
      season: 1,
      week: 1,
      funds: 17000,
      fans: 500,
      rp: 20,                       // 研究ポイント
      nextRace: 0,                  // 次のレースのindex
      points: 0,                    // 今季コンストラクターズポイント
      titles: { drivers: 0, teams: 0 },
      history: [],
      carGen: 0,
      equipped: {}, inventory: [], facilities: {}, staff: [], drivers: [], sponsors: [],
      standings: [], results: [],
      log: [],
      flags: { firstWin: false, tutorial: true },
      trainedThisWeek: false
    };
    D.PART_CATS.forEach(c => { g.equipped[c.key] = makePart(c.key, 0, 1, { power: 10, cond: 92, traits: [] }); });
    D.FACILITIES.forEach(f => { g.facilities[f.key] = 1; });

    resetNames([]);
    g.drivers = [makeDriver(2.2, { age: rint(22, 27) }), makeDriver(1.6, { age: rint(20, 25) })];
    // 開始時の2人はスキルも性格も別々にする
    if (g.drivers[0].skills[0] === g.drivers[1].skills[0]) {
      g.drivers[1].skills = [pick(D.SKILLS.filter(x => x.key !== g.drivers[0].skills[0])).key];
    }
    if (g.drivers[0].pers === g.drivers[1].pers) {
      g.drivers[1].pers = pick(D.PERSONALITIES.filter(x => x.key !== g.drivers[0].pers)).key;
    }
    g.drivers.forEach(d => { d.team = g.team; });

    g.staff = [makeStaff('engineer'), makeStaff('mechanic'), makeStaff('designer')];
    g.sponsors = [Object.assign({}, D.SPONSORS[0])];

    g.rivals = makeRivals(1, g.drivers.map(d => d.name));
    return g;
  }

  function makeStaff(type) {
    const t = D.STAFF_TYPES.find(s => s.key === type);
    const skill = rint(8, 22);
    return {
      id: 's' + Math.random().toString(36).slice(2, 8),
      type: type, name: pick(D.FIRST) + '・' + pick(D.LAST),
      skill: skill, salary: Math.round(t.salary * (0.6 + skill / 30))
    };
  }

  /* ---------- スタッフの成長（シーズン明け）---------- */
  function growStaff(g) {
    const grown = [];
    g.staff.forEach(st => {
      if (Math.random() < 0.55) {
        const up = rint(1, 3);
        st.skill += up;
        const t = D.STAFF_TYPES.find(x => x.key === st.type);
        st.salary = Math.round(t.salary * (0.6 + st.skill / 30));
        grown.push(st.name + '（技能 ' + st.skill + '）');
      }
    });
    return grown;
  }

  /* ---------- 全チーム（自分＋ライバル）---------- */
  function allTeams(g, track) {
    const mine = carStats(g);
    const me = {
      name: g.team, color: g.color, isPlayer: true, char: machineChar(mine),
      stats: mine, car: carScoreOf(mine, track), rel: reliability(g),
      points: g.points, drivers: g.drivers
    };
    // ライバルのマシン評価はコースとの相性でその都度変わる
    const rivals = g.rivals.map(r => {
      r.car = carScoreOf(r.stats, track);
      return r;
    });
    return [me].concat(rivals);
  }

  /* 自チームのマシンがどの型かを判定する（表示用） */
  function machineChar(s) {
    const tot = Math.max(1, s.speed + s.corner + s.accel);
    const sp = s.speed / tot, co = s.corner / tot, ac = s.accel / tot;
    if (sp > 0.38) return 'パワー型';
    if (co > 0.38) return 'ダウンフォース型';
    if (ac > 0.38) return 'トラクション型';
    if (sp > co && sp > ac) return 'ロードラッグ寄り';
    if (co > ac) return 'コーナー重視';
    return 'オールラウンド';
  }

  /* ---------- コンストラクターズ順位表 ---------- */
  function constructorTable(g) {
    const rows = [{ name: g.team, color: g.color, points: g.points, isPlayer: true }]
      .concat(g.rivals.map(r => ({ name: r.name, color: r.color, points: r.points, isPlayer: false })));
    rows.sort((a, b) => b.points - a.points);
    return rows;
  }

  /* ---------- ドライバーズ順位表 ---------- */
  function driverTable(g) {
    let rows = [];
    g.drivers.forEach(d => rows.push({ name: d.name, team: g.team, color: g.color, points: d.seasonPoints, isPlayer: true }));
    g.rivals.forEach(t => t.drivers.forEach(d =>
      rows.push({ name: d.name, team: t.name, color: t.color, points: d.seasonPoints, isPlayer: false })));
    rows.sort((a, b) => b.points - a.points);
    return rows;
  }

  /* ---------- セーブ・ロード ---------- */
  function save(g) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(g)); return true; }
    catch (e) { return false; }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const g = JSON.parse(raw);
      return (g && g.version === 2) ? g : null;
    } catch (e) { return null; }
  }
  function wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  return {
    rnd, rint, pick, clamp,
    makeDriver, makeStaff, makeRivals, driverRating, resetNames, growStaff,
    makePart, partStats, partCap, partScore, rollRarity, wearParts, hasT,
    rollSkills, hasSkill, learnableSkills, teachSkill, SKILL_MAX,
    persOf, nationOf, reactToResult, quoteFor,
    carStats, carScore, carScoreOf, machineChar, reliability, staffBonus, weeklyCost,
    newGame, allTeams, constructorTable, driverTable,
    raceWeek, SEASON_WEEKS, PREP_WEEKS,
    save, load, wipe
  };
})();

/* =========================================================
   ゲーム状態・ルール計算
   ========================================================= */
window.GP = window.GP || {};

GP.state = (function () {
  'use strict';
  const D = GP.data;
  const SAVE_KEY = 'gp_monogatari_save_v1';

  /* ---------- 乱数ユーティリティ ---------- */
  const rnd  = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const TRAITS = ['雨マスター', '予選番長', 'スタート職人', 'タイヤに優しい', 'マシン愛好家', '大器晩成', 'ムラっ気', '鉄の心臓'];

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
      trait: pick(TRAITS)
    };
    d.salary = Math.round((d.speed + d.technique + d.stamina + d.mental) / 4 * 0.95 + 18);
    return d;
  }

  /* ---------- ドライバー総合力 ---------- */
  function driverRating(d) {
    return (d.speed * 0.34 + d.technique * 0.30 + d.stamina * 0.18 + d.mental * 0.18) * (d.form / 100);
  }

  /* ---------- マシン性能の導出 ---------- */
  function carStats(g) {
    const s = { speed: 0, corner: 0, accel: 0 };
    D.PART_CATS.forEach(c => {
      const p = g.parts[c.key];
      s.speed  += p.level * c.gain.speed;
      s.corner += p.level * c.gain.corner;
      s.accel  += p.level * c.gain.accel;
    });
    return s;
  }

  /* ---------- マシン信頼性（0-100）---------- */
  function reliability(g) {
    let sum = 0;
    D.PART_CATS.forEach(c => { sum += g.parts[c.key].cond; });
    const avg = sum / D.PART_CATS.length;
    return clamp(avg + g.facilities.pit * 2.5 + staffBonus(g, 'mechanic') * 1.2, 5, 99);
  }

  /* ---------- コース適性を加味したマシンスコア ---------- */
  function carScore(g, track) {
    const s = carStats(g);
    return s.speed * track.weight.speed + s.corner * track.weight.corner + s.accel * track.weight.accel;
  }

  /* ---------- スタッフ効果 ---------- */
  function staffBonus(g, key) {
    return g.staff.filter(s => s.type === key).reduce((a, s) => a + s.skill, 0) / 20;
  }

  /* ---------- 週あたりの固定費 ---------- */
  function weeklyCost(g) {
    const staff = g.staff.reduce((a, s) => a + s.salary, 0);
    const drv = g.drivers.reduce((a, d) => a + d.salary, 0);
    const fac = D.FACILITIES.reduce((a, f) => a + g.facilities[f.key] * 20, 0);
    return Math.round(staff + drv + fac + 150);
  }

  /* ---------- ライバルチーム生成 ---------- */
  function makeRivals(season, keepNames) {
    resetNames(keepNames);
    return D.RIVALS.map((r, i) => {
      const lv = (3 + season * 2.1) * r.power;
      const t = {
        name: r.name, color: r.color, isPlayer: false,
        car: 18 * r.power + season * 10 * r.power + rnd(-4, 4),
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
      version: 1,
      team: teamName || 'ニューカマーGP',
      color: color || '#e04a3f',
      season: 1,
      week: 1,
      funds: 15000,
      fans: 500,
      rp: 20,                       // 研究ポイント
      nextRace: 0,                  // 次のレースのindex
      points: 0,                    // 今季コンストラクターズポイント
      titles: { drivers: 0, teams: 0 },
      history: [],
      parts: {}, facilities: {}, staff: [], drivers: [], sponsors: [],
      standings: [], results: [],
      log: [],
      flags: { firstWin: false, tutorial: true },
      trainedThisWeek: false
    };
    D.PART_CATS.forEach(c => { g.parts[c.key] = { level: 10, tier: 0, cond: 90 }; });
    D.FACILITIES.forEach(f => { g.facilities[f.key] = 1; });

    resetNames([]);
    g.drivers = [makeDriver(2.2), makeDriver(1.6)];
    while (g.drivers[1].trait === g.drivers[0].trait) g.drivers[1].trait = pick(TRAITS);
    g.drivers.forEach(d => { d.team = g.team; });

    g.staff = [makeStaff('engineer'), makeStaff('mechanic')];
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

  /* ---------- 全チーム（自分＋ライバル）---------- */
  function allTeams(g, track) {
    const me = {
      name: g.team, color: g.color, isPlayer: true,
      car: carScore(g, track), rel: reliability(g),
      points: g.points, drivers: g.drivers
    };
    return [me].concat(g.rivals);
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
      return (g && g.version === 1) ? g : null;
    } catch (e) { return null; }
  }
  function wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  return {
    rnd, rint, pick, clamp,
    makeDriver, makeStaff, makeRivals, driverRating, resetNames,
    carStats, carScore, reliability, staffBonus, weeklyCost,
    newGame, allTeams, constructorTable, driverTable,
    raceWeek, SEASON_WEEKS, PREP_WEEKS,
    save, load, wipe
  };
})();

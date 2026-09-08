/* =========================================================
   ゲーム状態・ルール計算
   ========================================================= */
window.GP = window.GP || {};

GP.state = (function () {
  'use strict';
  const D = GP.data;
  const SAVE_KEY = 'gp_monogatari_save_v6';

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
    const dz = staffBonus(g, 'designer') + g.facilities.factory * 0.35 + mgr(g, 'technical') * 0.06;
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

  /* 才能の抽選。若手ほど当たり外れが大きい */
  function rollPotential(youth) {
    const r = Math.random();
    if (youth) {
      if (r < 0.34) return 1;
      if (r < 0.64) return 2;
      if (r < 0.86) return 3;
      if (r < 0.97) return 4;
      return 5;
    }
    if (r < 0.42) return 1;
    if (r < 0.76) return 2;
    if (r < 0.93) return 3;
    if (r < 0.99) return 4;
    return 5;
  }
  const potOf = d => D.POTENTIAL[(d.pot || 2) - 1] || D.POTENTIAL[1];

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
      poles: 0, fastestLaps: 0, dnfs: 0, best: 99,
      nation: opts.nation || rint(0, D.NATIONS.length - 1),
      pot: opts.pot || rollPotential(opts.youth),
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
    // 空力コンセプトが良いほど、エアロパーツの効きも上がる
    const aeroBoost = 1 + bodyRatio(g, 'aeroBody') * 0.14;
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) return;
      const ps = partStats(p);
      // コンディションが落ちたパーツは本来の性能を出しきれない
      const f = (0.82 + p.cond / 100 * 0.18) * (c.key === 'aero' ? aeroBoost : 1);
      s.speed += ps.speed * f;
      s.corner += ps.corner * f;
      s.accel += ps.accel * f;
    });
    // 車体そのものが生む性能
    const bs = bodyStats(g);
    s.speed += bs.speed; s.corner += bs.corner; s.accel += bs.accel;
    return s;
  }

  /* =======================================================
     車体（マシン本体）
     ======================================================= */
  function bodyCap(g2) {
    return Math.round(D.CAR_GENS[g2.carGen].cap * D.BODY_CAP_RATIO);
  }
  /* いまの世代でどれだけ煮詰まっているか（0..1）。
     ここが満ちると、マシンは次の世代へ自動的に進む            */
  function genProgress(g2) {
    const parts = D.PART_CATS.map(c => g2.equipped[c.key]).filter(Boolean);
    if (!parts.length) return 0;
    const avg = parts.reduce((a, p) => a + Math.min(1, p.power / partCap(g2, p)), 0) / parts.length;
    return clamp(avg, 0, 1);
  }
  const GEN_STEP_AT = 0.86;          // ここまで煮詰まったら次の世代へ
  /* パーツを煮詰めきると、マシンそのものが新しい世代に更新される。
     買い忘れて置いていかれる、ということが起きないようにしている  */
  function tryAdvanceGen(g2) {
    if (g2.carGen >= D.CAR_GENS.length - 1) return null;
    if (genProgress(g2) < GEN_STEP_AT) return null;
    const from = D.CAR_GENS[g2.carGen];
    g2.carGen++;
    const to = D.CAR_GENS[g2.carGen];
    // 車体は新造される。前の知見と、来季ぶんの仕込みを引き継ぐ
    const stock = g2.nextCar || 0;
    g2.body = makeBody(g2, g2.body, stock);
    g2.nextCar = 0;
    // パーツのコンディションもシェイクダウンで整う
    D.PART_CATS.forEach(c => {
      const p = g2.equipped[c.key];
      if (p) p.cond = clamp(p.cond + 15, 10, 100);
    });
    return { from: from.name, to: to.name, cap: to.cap, bodyCap: bodyCap(g2) };
  }

  /* 新しい車体を作る。前の知見を一部引き継ぐ */
  function makeBody(g2, prev, stock) {
    const cap = Math.round(D.CAR_GENS[g2.carGen].cap * D.BODY_CAP_RATIO);
    const b = { cond: 100 };
    // 事前に積み上げてあった「来季ぶんの開発」を4項目に振り分ける
    const advance = (stock || 0) * D.CARRY_TO_NEXT / D.BODY_ATTRS.length;
    D.BODY_ATTRS.forEach(a => {
      const carried = prev ? prev[a.key] * D.BODY_CARRY : 0;
      b[a.key] = Math.round(Math.min(cap, Math.max(cap * 0.15, carried) + advance) * 10) / 10;
    });
    return b;
  }
  /* 車体が生む3性能 */
  function bodyStats(g2) {
    const s = { speed: 0, corner: 0, accel: 0 };
    const b = g2.body || {};
    D.BODY_ATTRS.forEach(a => {
      const v = b[a.key] || 0;
      s.speed += v * a.gain.speed;
      s.corner += v * a.gain.corner;
      s.accel += v * a.gain.accel;
    });
    return s;
  }
  const bodyVal = (g2, key) => (g2.body && g2.body[key]) || 0;
  /* 車体の熟成度（0..1）。今のマシンの上限に対する割合で、効果はここから決まる。
     世代が上がっても「どれだけ煮詰めたか」で効くので、いつでも意味がある */
  function bodyRatio(g2, key) {
    const cap = bodyCap(g2);
    return cap > 0 ? clamp(bodyVal(g2, key) / cap, 0, 1) : 0;
  }

  /* 開発リソースの配分 */
  function focusOf(g2) {
    return D.FOCUS_LEVELS.find(f => f.key === (g2.focus || 'now')) || D.FOCUS_LEVELS[0];
  }
  /* 新型に乗り換えたとき、車体がどこから始まるか。
     「仕込み」が何を買っているのかを、そのまま数字で見せるために使う */
  function nextCarPreview(g2) {
    const gi = Math.min(D.CAR_GENS.length - 1, g2.carGen + 1);
    const cap = Math.round(D.CAR_GENS[gi].cap * D.BODY_CAP_RATIO);
    const prev = g2.body || {};
    const n = D.BODY_ATTRS.length;
    const carried = D.BODY_ATTRS.reduce((a, x) => a + (prev[x.key] || 0), 0) / n * D.BODY_CARRY;
    const advance = (g2.nextCar || 0) * D.CARRY_TO_NEXT / n;
    const floor = Math.max(cap * 0.15, carried);
    const without = Math.min(cap, floor);
    const withStock = Math.min(cap, floor + advance);
    return {
      cap: cap,
      isLast: g2.carGen >= D.CAR_GENS.length - 1,
      without: Math.round(without * 10) / 10,
      withStock: Math.round(withStock * 10) / 10,
      gain: Math.round((withStock - without) * 10) / 10
    };
  }

  /* 来季マシンの仕上がり具合（0-100%）。次の車体の初期値に乗る */
  function nextCarProgress(g2) {
    const cap = Math.round(D.CAR_GENS[Math.min(D.CAR_GENS.length - 1, g2.carGen + 1)].cap * D.BODY_CAP_RATIO);
    return Math.max(0, Math.min(1, (g2.nextCar || 0) / (cap * 4)));
  }

  /* ---------- ERS（バッテリー）----------
     エレクトロニクスの性能と世代から、容量と1周あたりの回生量が決まる  */
  function ersOf(g2) {
    const p = g2.equipped && g2.equipped.elec;
    const pw = p ? p.power * (0.82 + p.cond / 100 * 0.18) : 10;
    // 冷却が良いほど電気を多く回せる。バッテリー開発はそれより直接効く
    return ersFrom(pw + bodyVal(g2, 'cooling') * 0.45 + bodyVal(g2, 'battery') * 0.95);
  }
  function ersFrom(power) {
    const E = D.ERS;
    return {
      capacity: Math.round(E.baseCapacity + power * E.capPerPower),
      recover: Math.round((E.recoverBase + power * E.recoverPerPower) * 10) / 10,
      deploy: Math.round((E.deployBase + power * E.deployPerPower) * 10) / 10,
      power: Math.round(power * 10) / 10
    };
  }

  /* =======================================================
     オーナー（プレイヤー自身）
     実績で名声が貯まり、ランクが上がるとスキルポイントが手に入る。
     スキルは各系統0..5で、ゲームのあちこちに効く。
     ======================================================= */
  function makeOwner(name, pastKey) {
    const past = D.OWNER_PASTS.find(p => p.key === pastKey) || D.OWNER_PASTS[1];
    const sk = {};
    D.OWNER_SKILLS.forEach(s2 => { sk[s2.key] = 0; });
    Object.keys(past.skills || {}).forEach(k => { sk[k] = past.skills[k]; });
    return {
      name: name || 'あなた',
      past: past.key,
      fame: 0,          // 名声（ランクの元）
      rank: 0,
      sp: 0,            // 未使用のスキルポイント
      skills: sk
    };
  }

  /* スキルの段位。保存が古くてオーナーが無い場合でも 0 を返す */
  function osk(g2, key) {
    return (g2 && g2.owner && g2.owner.skills && g2.owner.skills[key]) || 0;
  }

  function ownerRank(g2) {
    const f = (g2 && g2.owner ? g2.owner.fame : 0) || 0;
    let i = 0;
    for (let k = 0; k < D.OWNER_RANKS.length; k++) if (f >= D.OWNER_RANKS[k].need) i = k;
    return i;
  }

  /* 次のランクまでの進み具合（表示用） */
  function ownerProgress(g2) {
    const i = ownerRank(g2);
    const cur = D.OWNER_RANKS[i], nx = D.OWNER_RANKS[i + 1];
    const f = (g2.owner ? g2.owner.fame : 0) || 0;
    if (!nx) return { i: i, cur: cur, next: null, pct: 100, need: 0 };
    const span = nx.need - cur.need;
    return { i: i, cur: cur, next: nx,
             pct: Math.max(0, Math.min(100, Math.round((f - cur.need) / span * 100))),
             need: nx.need - f };
  }

  /* 名声を足す。ランクが上がったらスキルポイントを配る。
     上がった段数を返すので、呼び出し側で演出できる。              */
  function addFame(g2, n) {
    if (!g2.owner) g2.owner = makeOwner();
    const before = ownerRank(g2);
    g2.owner.fame = Math.max(0, Math.round((g2.owner.fame || 0) + n));
    const after = ownerRank(g2);
    if (after > before) {
      g2.owner.sp += (after - before) * 2;      // 1段につき2ポイント
      g2.owner.rank = after;
      return after - before;
    }
    g2.owner.rank = after;
    return 0;
  }

  function learnOwnerSkill(g2, key) {
    if (!g2.owner || g2.owner.sp <= 0) return false;
    const cur = g2.owner.skills[key] || 0;
    if (cur >= D.OWNER_SKILL_MAX) return false;
    // 上の段ほど、解放にランクが要る
    if (cur + 1 > ownerRank(g2) + 1) return false;
    g2.owner.skills[key] = cur + 1;
    g2.owner.sp--;
    return true;
  }

  /* ---------- レギュレーション変更 ----------
     4シーズンに一度、マシンの規則が変わる。パーツと車体は白紙に戻り、
     マシン世代も最初から。ただし施設・スタッフ・ファン・資金・オーナーは残るので、
     積み上げてきたチーム力そのものは無駄にならない。
     ライバルも同じだけ戻るので、上位と下位の差が一度リセットされる。       */
  const REG_EVERY = 4;

  function regulationDue(g2) {
    return g2.season > 1 && ((g2.season - 1) % REG_EVERY === 0);
  }

  function applyRegulation(g2) {
    g2.reg = (g2.reg || 0) + 1;
    // 自チーム：パーツと車体を新規則のものに置き換える
    g2.carGen = 0;
    D.PART_CATS.forEach(c => {
      const old2 = g2.equipped[c.key];
      // 積んできた知見のぶんだけ、ゼロよりは良いところから始まる
      const carry = old2 ? Math.min(14, old2.power * 0.18) : 0;
      g2.equipped[c.key] = makePart(c.key, 0, 1, { power: 10 + carry });
    });
    g2.stock = [];
    g2.body = makeBody(g2, null);
    g2.nextCar = 0;
    // 供給を受けていたエンジンも新規則では使えない
    g2.engine = null;
    g2.engineStash = null;
    // ライバルも同じところまで戻す。
    // プレイヤーだけが白紙になって、ライバルが前の水準を持ち越すと、
    // 規則変更のたびに一方的に置いていかれることになる
    (g2.rivals || []).forEach(r => {
      const src = D.RIVALS.find(x => x.name === r.name) || { power: 1, bias: { speed: 1, corner: 1, accel: 1 } };
      const power = src.power;
      // 世代0のマシンで、いまのシーズンに見合った水準
      const base = 18 * power + g2.season * 4 * power + rnd(-3, 3);
      ['speed', 'corner', 'accel'].forEach(k => {
        // 強豪はやはり強い、ぶんだけ少し上乗せする
        r.stats[k] = base * 3 * ((src.bias && src.bias[k]) || 1) * 0.94 + r.stats[k] * 0.05;
      });
      r.base0 = null;
    });
    return g2.reg;
  }

  /* ---------- ライバルのシーズン中の開発 ----------
     これが無いと、プレイヤーだけが毎週伸びて途中から一方的になる。
     強いチームほど開発が速く、下位はゆっくり。難易度でも変わる。
     ただしプレイヤーほどは伸びないので、手を入れただけ前に出られる。 */
  /* ---------- 風洞・CFDの使用時間 ----------
     前年の順位で決まる開発の伸びの倍率。1年を通して変わらない       */
  function atrOf(g2) {
    const r = g2.lastRank || 0;
    if (!r) return 1;                                  // 1年目は傾斜なし
    return D.ATR[Math.min(D.ATR.length - 1, r - 1)];
  }
  function atrLabel(g2) {
    const v = atrOf(g2);
    return D.ATR_LABEL.find(x => v <= x.max) || D.ATR_LABEL[1];
  }

  /* ---------- 選手権の重み ----------
     いまの順位が賞金にしていくらなのか。1つ上げると／落とすといくら動くのか */
  function championshipStake(g2) {
    const table = constructorTable(g2);
    const i = table.findIndex(r => r.isPlayer);
    const rank = i < 0 ? table.length : i + 1;
    const prize = k => Math.round(D.PRIZE[Math.min(D.PRIZE.length - 1, k - 1)]
                                  * (1 + osk(g2, 'money') * 0.05));
    const left = Math.max(0, D.TRACKS.length - (g2.nextRace || 0));
    const maxGain = left * (D.POINTS[0] + D.POINTS[1] + D.FASTEST_LAP_POINT);
    const me = table[i] || { points: 0 };
    const ahead = i > 0 ? table[i - 1] : null;
    const behind = (i >= 0 && i < table.length - 1) ? table[i + 1] : null;
    return {
      rank: rank, of: table.length, points: me.points || 0,
      racesLeft: left, maxGain: maxGain,
      prizeNow: prize(rank),
      upGain: rank > 1 ? prize(rank - 1) - prize(rank) : 0,
      downLoss: rank < table.length ? prize(rank) - prize(rank + 1) : 0,
      ahead: ahead ? { name: ahead.name, color: ahead.color, gap: (ahead.points || 0) - (me.points || 0) } : null,
      behind: behind ? { name: behind.name, color: behind.color, gap: (me.points || 0) - (behind.points || 0) } : null,
      titleAlive: left > 0 && ((table[0].points || 0) - (me.points || 0)) <= maxGain,
      titleGap: (table[0].points || 0) - (me.points || 0)
    };
  }

  function developRivals(g2) {
    const diff = diffOf(g2);
    // いまの選手権順位。上位のチームほど開発に使える時間が少ない
    const rivalRank = {};
    constructorTable(g2).forEach((t, i) => { rivalRank[t.name] = i + 1; });
    (g2.rivals || []).forEach(r => {
      // シーズン開始時の水準を覚えておく（どれだけ伸びたかを見せるため）
      if (!r.base0) r.base0 = { speed: r.stats.speed, corner: r.stats.corner, accel: r.stats.accel };
      const power = (D.RIVALS.find(x => x.name === r.name) || { power: 1 }).power;
      // 1週あたりの伸び。season が進むほど全体の水準も上がる。
      // 掃引して決めた値。これより速いとプレイヤーが永久に追いつけず、
      // 遅いとシーズン半ばで一方的になる。
      const atr = D.ATR[Math.min(D.ATR.length - 1, (rivalRank[r.name] || 6) - 1)];
      const step = (0.055 + power * 0.075) * (diff.rivalGrow || 1) * atr
                 * (1 + g2.season * 0.04 + (g2.carGen || 0) * 0.09);
      ['speed', 'corner', 'accel'].forEach(k => {
        r.stats[k] = r.stats[k] + step * (0.8 + Math.random() * 0.5);
      });
      // 信頼性も少しずつ上がる
      r.rel = clamp(r.rel + 0.012 * (diff.rivalGrow || 1), 40, 98);
    });
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
    const bodyRel = bodyRatio(g, 'rigidity') * 9 + bodyRatio(g, 'cooling') * 7;
    return clamp(avg + bonus + bodyRel - crewPenalty(g).rel
               + g.facilities.pit * 2.5 + staffBonus(g, 'mechanic') * 1.2 + mgr(g, 'pitchief') * 0.15, 5, 99);
  }

  /* =======================================================
     ロジスティクス
     世界を転戦するサーカスをどう運ぶか。安く運べば金は浮くが、
     クルーが消耗し、現地でのセットアップ時間も足りなくなる。
     ======================================================= */
  function logiPlan(g2) {
    const k = (g2.logi && g2.logi.plan) || 'std';
    return D.LOGI_PLANS.find(p => p.key === k) || D.LOGI_PLANS[1];
  }
  /* 1戦ぶんの輸送費。遠いコースほど高い */
  function logiCost(g2, track) {
    const far = (track && track.far) || 1;
    const cut = Math.min(0.45, mgr(g2, 'logistics') * 0.012 + osk(g2, 'money') * 0.03);
    return Math.round(D.LOGI_BASE * far * logiPlan(g2).cost * (1 - cut));
  }
  /* クルーの疲労（0..100） */
  const crew = g2 => clamp((g2.logi && g2.logi.crew) || 0, 0, 100);
  /* 疲労が生む悪影響。ロジ責任者が付いていれば効きが小さい */
  function crewPenalty(g2) {
    const r = crew(g2) / 100 * (1 - Math.min(0.4, mgr(g2, 'logistics') * 0.008));
    return { pit: r * D.CREW_FULL.pit, rel: r * D.CREW_FULL.rel,
             mistake: r * D.CREW_FULL.mistake, level: crew(g2) };
  }
  /* レースを1戦こなしたぶんの消耗。輸送手段で増減する */
  function tireCrew(g2) {
    if (!g2.logi) g2.logi = { plan: 'std', crew: 0 };
    const soft = 1 - Math.min(0.5, mgr(g2, 'logistics') * 0.010);
    const d = logiPlan(g2).fatigue - 2;      // レースの合間にいくらかは休める
    g2.logi.crew = clamp(crew(g2) + (d > 0 ? d * soft : d), 0, 100);
  }
  /* 休養・オフシーズンでの回復 */
  function restCrew(g2, amount) {
    if (!g2.logi) g2.logi = { plan: 'std', crew: 0 };
    g2.logi.crew = clamp(crew(g2) - amount, 0, 100);
  }

  /* ---------- パワーユニットの使用基数 ---------- */
  function puOf(g2) {
    if (!g2.pu) g2.pu = { used: 1, life: 100, grid: 0, over: 0 };
    return g2.pu;
  }
  /* 1戦でどれだけ削れるか。冷却の効いた車体と、腕の良いメカニックほど保つ */
  function puWear(g2, track, pushMul) {
    const laps = (track && track.laps) || 26;
    const cool = 1 - bodyRatio(g2, 'cooling') * 0.30;
    const care = 1 - Math.min(0.28, staffBonus(g2, 'mechanic') * 0.06 + g2.facilities.pit * 0.015);
    return D.PU_BASE_WEAR * (laps / 26) * (pushMul || 1) * cool * care;
  }
  /* レースを走り終えたときの処理。使い切ったら次の基数へ */
  function usePU(g2, track, pushMul) {
    const pu = puOf(g2);
    pu.life = Math.max(0, pu.life - puWear(g2, track, pushMul));
    const out = { swapped: false, used: pu.used, over: false, grid: 0 };
    if (pu.life <= 0) {
      pu.used++;
      pu.life = 100;
      out.swapped = true;
      out.used = pu.used;
      if (pu.used > D.PU_LIMIT) {
        pu.over++;
        pu.grid += D.PU_PENALTY;
        out.over = true;
        out.grid = D.PU_PENALTY;
      }
    }
    return out;
  }
  /* 整備コマンドで少しだけ延命できる */
  function nursePU(g2, amount) {
    const pu = puOf(g2);
    const before = pu.life;
    pu.life = clamp(pu.life + amount, 0, 100);
    return Math.round(pu.life - before);
  }
  function puReset(g2) { g2.pu = { used: 1, life: 100, grid: 0, over: 0 }; }

  /* ---------- パーツの消耗（レース後）---------- */
  function wearParts(g, amount) {
    // 整備性が高い車体は、同じ距離を走ってもパーツが傷まない
    const svc = 1 - bodyRatio(g, 'service') * 0.35;
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) return;
      const w = amount * (hasT(p, 'tough') ? 0.55 : 1) * svc;
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
    let sum = 0;
    g.staff.forEach(s => {
      if (s.type === key) { sum += s.skill; return; }
      // 「肩書きは違うが、あの人はそこも見られる」ぶん
      (s.traits || []).forEach(tk => {
        const t = D.STAFF_TRAITS.find(x => x.key === tk);
        if (t && t.cross === key) sum += s.skill * D.STAFF_TRAIT_CROSS;
      });
    });
    return sum / 20;
  }

  /* =======================================================
     注目度（メディア露出）
     良い結果を出すほど話題になり、スポンサー収入が増え、
     大手が声を掛けてくるようになる。放っておくと少しずつ忘れられる。
     ======================================================= */
  function hypeTier(g2) {
    const h = g2.hype || 0;
    return D.HYPE_TIERS.find(t => h < t.max) || D.HYPE_TIERS[D.HYPE_TIERS.length - 1];
  }

  /* スポンサー収入にかかる倍率 */
  /* ---------- ファン ---------- */
  const fanTier = g2 => D.FAN_TIERS.find(t => (g2.fans || 0) < t.max) || D.FAN_TIERS[D.FAN_TIERS.length - 1];
  /* 毎戦のグッズ・入場料収入。ファンが増えるほど伸びるが、
     平方根なので終盤に爆発はしない */
  function fanIncome(g2) {
    const mult = (1 + g2.facilities.market * 0.08) * (1 + osk(g2, 'money') * 0.05)
               * (1 + (g2.hype || 0) / 100 * 0.35);
    return Math.round(D.FAN_INCOME * Math.sqrt(Math.max(0, g2.fans || 0)) * mult);
  }
  /* ファンが「これくらいはやるだろう」と思っている順位。
     選手権での立ち位置から決まる。ここを上回るほどファンは増える */
  function fanExpectation(g2) {
    const tbl = constructorTable(g2);
    const i = tbl.findIndex(r => r.isPlayer);
    const rank = i < 0 ? tbl.length : i + 1;
    return clamp(Math.round(rank * 1.6 - 0.6), 1, 20);
  }

  function hypeBonus(g2) {
    return 1 + (g2.hype || 0) / 100 * 0.6;
  }

  function addHype(g2, v) {
    // 知名度が高いオーナーほど、同じ結果でも話題になりやすい
    if (v > 0) {
      // 名の知れたスタッフを抱えていると、それだけで話題になる
      const stars = (g2.staff || []).filter(s2 => stTrait(s2, 'star')).length;
      v = v * (1 + osk(g2, 'fame') * 0.20) * (1 + stars * 0.07);
    }
    g2.hype = clamp((g2.hype || 0) + v, 0, 100);
    return g2.hype;
  }

  /* 契約できるスポンサーか（ファン数と注目度の両方が要る） */
  function sponsorOpen(g2, sp) {
    return g2.fans >= sp.fans && (g2.hype || 0) >= (sp.hype || 0);
  }

  /* =======================================================
     マネジメント層
     ======================================================= */
  function makeManager(key, quality) {
    const m = D.MANAGERS.find(x => x.key === key) || D.MANAGERS[0];
    const skill = clamp(Math.round(10 + (quality || 0) * 0.32 + rnd(-5, 9)), 5, 60);
    return {
      id: 'm' + Math.random().toString(36).slice(2, 8),
      role: key, name: pick(D.FIRST) + '・' + pick(D.LAST),
      skill: skill,
      salary: Math.round(m.salary * (0.5 + skill / 46))
    };
  }
  /* 役職に就いている人の技能。空席なら0 */
  function mgr(g2, key) {
    const m = g2.managers && g2.managers[key];
    return m ? m.skill : 0;
  }

  /* ---------- 収支の内訳 ---------- */
  function finances(g2) {
    const staff = g2.staff.reduce((a, s) => a + s.salary, 0);
    const mgrs = D.MANAGERS.reduce((a, m) => a + (g2.managers && g2.managers[m.key] ? g2.managers[m.key].salary : 0), 0);
    const drivers = g2.drivers.reduce((a, d) => a + d.salary, 0);
    const youth = (g2.youth || []).reduce((a, d) => a + d.salary, 0);
    const facilities = D.FACILITIES.reduce((a, f) => a + g2.facilities[f.key] * 12, 0);
    // パワーユニットの供給料。1戦ぶんを週あたりにならす
    const engine = g2.engine ? Math.round(g2.engine.fee / raceWeek(0)) : 0;
    const other = 150;
    const raw = staff + mgrs + drivers + youth + facilities + engine + other;
    // ロジスティクス責任者は運営全体の費用を下げる
    // ロジスティクス責任者に加えて、オーナーの商才も運営費を下げる
    const cut = Math.min(0.45, mgr(g2, 'logistics') * 0.010 + osk(g2, 'money') * 0.03);
    const weekly = Math.round(raw * (1 - cut));

    // 1戦あたりのスポンサー収入（注目度・マーケ室・プリンシパル・難易度込み）
    const diff = diffOf(g2);
    const boost = hypeBonus(g2) * (1 + mgr(g2, 'principal') * 0.006);
    const scale = (1 + g2.facilities.market * 0.07) * boost * diff.sponsor
                * (1 + osk(g2, 'money') * 0.06);   // 商才
    const perRace = Math.round(g2.sponsors.reduce((a, sp) => a + (sp.per || 0) * scale, 0));
    const merch = fanIncome(g2);           // グッズ・入場料
    const rpRace = Math.round(g2.sponsors.reduce((a, sp) => a + (sp.rp || 0) * scale, 0));

    const PREP = raceWeek(0);                       // レース1回あたりの週数
    // 次のレースへの輸送費（コースの遠さで変わる）
    const shipping = logiCost(g2, D.TRACKS[g2.nextRace] || D.TRACKS[0]);
    return {
      staff: staff, managers: mgrs, drivers: drivers, youth: youth,
      facilities: facilities, engine: engine, other: other, cut: cut,
      weekly: weekly,
      sponsorPerRace: perRace,
      sponsorRpPerRace: rpRace,
      // レース1回ぶん（準備週＋レース週）の収支
      shipping: shipping,
      merch: merch,
      cycleCost: weekly * PREP + shipping,
      cycleIncome: perRace + merch,
      net: perRace + merch - weekly * PREP - shipping
    };
  }

  /* ---------- 週あたりの固定費 ---------- */
  function weeklyCost(g) { return finances(g).weekly; }

  /* ---------- ライバルチーム生成 ---------- */
  /* 技術の世代は業界全体で進む。自分だけが新しいマシンに乗るわけではない。
     ここが無いと、世代を上げた瞬間に永久に一方的な展開になる            */
  function makeRivals(season, keepNames, diff, era) {
    resetNames(keepNames);
    const dp = diff ? diff.rivalPower : 1;
    const dg = diff ? diff.rivalGrow : 1;
    const ep = (era || 0) * D.ERA_STEP;
    return D.RIVALS.map((r, i) => {
      const lv = (3 + season * 2.1 * dg) * r.power * dp;
      const base = (18 * r.power + (season * 4 + ep) * r.power * dg) * dp + rnd(-4, 4);
      const t = {
        name: r.name, color: r.color, isPlayer: false, char: r.char,
        // 3性能の絶対値。コース適性込みの速さは carScoreOf() で算出する
        stats: {
          speed:  base * 3 * r.bias.speed,
          corner: base * 3 * r.bias.corner,
          accel:  base * 3 * r.bias.accel
        },
        rel: clamp(72 + r.power * 18 + season * 1.2 + rnd(-8, 8), 40, 97),
        // 作戦の性格。チームごとに固定なので、対戦を重ねると読めるようになる
        style: D.STRAT_STYLE_KEYS[(i + season) % D.STRAT_STYLE_KEYS.length],
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
  const diffOf = g2 => D.DIFFICULTIES.find(x => x.key === (g2 && g2.mode)) || D.DIFFICULTIES[1];

  function newGame(teamName, color, mode) {
    const diff = D.DIFFICULTIES.find(x => x.key === mode) || D.DIFFICULTIES[1];
    const g = {
      version: 6,
      team: teamName || 'ニューカマーGP',
      color: color || '#e04a3f',
      season: 1,
      week: 1,
      mode: diff.key,
      funds: Math.round(17000 * diff.funds),
      tickets: 0,           // 開発チケット
      hype: 4,              // 注目度（メディア露出）0-100
      dryStreak: 0,         // 入賞できていないレース数
      youth: [],            // 下部組織の若手
      managers: {},         // 役職（空席から始まる）
      fans: 500,
      rp: 20,                       // 研究ポイント
      nextRace: 0,                  // 次のレースのindex
      points: 0,                    // 今季コンストラクターズポイント
      titles: { drivers: 0, teams: 0 },
      // オーナー（プレイヤー自身）。元ドライバーの経歴で初期スキルが変わる
      owner: null,
      reg: 0,                       // レギュレーション世代（4シーズンごとに変わる）
      history: [],
      carGen: 0,
      body: null,
      logi: { plan: 'std', crew: 0 },   // 輸送手段とクルーの疲労
      focus: 'now',         // 開発リソースの配分
      nextCar: 0,           // 来季マシンに積み上げた開発量
      lastRank: 0,          // 前年のコンストラクターズ順位（風洞時間の傾斜に使う）
      pu: { used: 1, life: 100, grid: 0, over: 0 },   // パワーユニットの基数と残り
      equipped: {}, inventory: [], facilities: {}, staff: [], drivers: [], sponsors: [],
      standings: [], results: [],
      log: [],
      flags: { firstWin: false, tutorial: true },
      trainedThisWeek: false
    };
    D.PART_CATS.forEach(c => { g.equipped[c.key] = makePart(c.key, 0, 1, { power: 10, cond: 92, traits: [] }); });
    g.owner = makeOwner(null, pick(D.OWNER_PASTS).key);
    g.body = makeBody(g, null);
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
    // イージーは産油国の大口スポンサーが最初から付く
    if (diff.oilSponsor) g.sponsors.push(Object.assign({}, D.OIL_SPONSOR));

    g.rivals = makeRivals(1, g.drivers.map(d => d.name), diff, 0);
    // 最初から若手を1人抱えている
    g.youth = [makeYouth(1)];
    return g;
  }

  function makeStaff(type, quality, opts) {
    opts = opts || {};
    const t = D.STAFF_TYPES.find(s => s.key === type);
    // 若い人ほど伸びしろの当たり外れが大きい。ベテランは伸びないが即戦力
    const age = opts.age || rint(24, 52);
    const pot = opts.pot || rollPotential(age < 32);
    // チームの規模が大きいほど、良い人材が応募してくる
    const base = rint(8, 22) + (quality || 0) * 0.28 + (opts.bonus || 0);
    // 歳を重ねているぶんは、すでに腕になっている
    const st = {
      id: 's' + Math.random().toString(36).slice(2, 8),
      type: type, name: pick(D.FIRST) + '・' + pick(D.LAST),
      age: age, pot: pot,
      exp: 0, expLv: 1,
      traits: rollStaffTraits(type, opts.traitBonus || 0), salary: 0,
      years: 0                    // 在籍年数
    };
    st.skill = clamp(Math.round(base + Math.max(0, age - 30) * 0.55), 5, staffCap(st));
    st.salary = staffSalary(st);
    return st;
  }
  /* この人がどこまで伸びるか。才能で決まる */
  const staffCap = st => 34 + (st.pot || 2) * 8;
  const staffNeed = st => Math.round(36 * (st.expLv || 1));
  /* 歳を取るほど伸びは鈍る */
  function staffGrowMul(st) {
    const p = D.POTENTIAL[(st.pot || 2) - 1] || D.POTENTIAL[1];
    const a = st.age || 34;
    const ageMul = a < 30 ? 1.15 : a < 40 ? 1.0 : a < 50 ? 0.72 : 0.45;
    return p.growth * ageMul;
  }

  /* ---------- スタッフの経験値 ----------
     チームが何をしたかが、そのまま関わった人の経験になる。
     専門外へ効く固有スキルを持っている人は、その仕事からも学ぶ。   */
  function addStaffExp(g2, typeKey, amount) {
    const ups = [];
    (g2.staff || []).forEach(st => {
      let a = 0;
      if (st.type === typeKey) a = amount;
      else if ((st.traits || []).some(k => {
        const t = D.STAFF_TRAITS.find(x => x.key === k);
        return t && t.cross === typeKey;
      })) a = amount * D.STAFF_TRAIT_CROSS;
      if (a <= 0) return;
      const u = giveStaffExp(st, a * staffGrowMul(st));
      if (u) ups.push(u);
    });
    return ups;
  }
  /* 全員に少しずつ（レースを1戦こなした、など） */
  function addStaffExpAll(g2, amount) {
    const ups = [];
    (g2.staff || []).forEach(st => {
      const u = giveStaffExp(st, amount * staffGrowMul(st));
      if (u) ups.push(u);
    });
    return ups;
  }
  function giveStaffExp(st, amount) {
    if (st.exp == null) { st.exp = 0; st.expLv = 1; }
    if (st.pot == null) st.pot = 2;
    if (st.age == null) st.age = 34;
    st.exp += amount;
    const cap = staffCap(st);
    let gained = 0, lv = 0, learned = null;
    while (st.exp >= staffNeed(st)) {
      st.exp -= staffNeed(st);
      st.expLv++;
      lv = st.expLv;
      if (st.skill < cap) {
        const up = Math.max(1, Math.round(rint(1, 3) * staffGrowMul(st)));
        st.skill = clamp(st.skill + up, 1, cap);
        gained += up;
      }
      // 現場で覚える。専門外へ効く固有スキルが増えていく
      if (!learned && (st.traits || []).length < 3 && Math.random() < 0.26) {
        const pool = D.STAFF_TRAITS.filter(x => x.cross !== st.type &&
          (st.traits || []).indexOf(x.key) < 0);
        if (pool.length) { learned = pick(pool); st.traits = (st.traits || []).concat([learned.key]); }
      }
    }
    if (!lv) return null;
    st.salary = staffSalary(st);
    return { name: st.name, lv: lv, skill: st.skill, gained: gained, learned: learned, capped: st.skill >= cap };
  }
  /* 固有スキルの抽選。専門外へ効くものは、自分の職能とは違うものだけ選ぶ */
  function rollStaffTraits(type, bonus) {
    const pool = D.STAFF_TRAITS.filter(x => x.cross !== type);
    const out = [];
    const n = Math.random() < 0.30 + bonus ? 2 : (Math.random() < 0.72 + bonus ? 1 : 0);
    while (out.length < n && out.length < pool.length) {
      const k = pick(pool).key;
      if (out.indexOf(k) < 0) out.push(k);
    }
    return out;
  }
  const stTrait = (st, k) => !!(st && st.traits && st.traits.indexOf(k) >= 0);
  const traitOf = k => D.STAFF_TRAITS.find(x => x.key === k);
  function staffSalary(st) {
    const t = D.STAFF_TYPES.find(x => x.key === st.type) || D.STAFF_TYPES[0];
    let v = t.salary * (0.6 + st.skill / 30);
    if (stTrait(st, 'cheap')) v *= 0.80;
    if (stTrait(st, 'star'))  v *= 1.30;
    return Math.round(v * (st.raise || 1));
  }
  /* この人が就ける首脳陣の役職。技能が足りていることが条件 */
  const PROMOTE_MIN = 38;
  function promotableRoles(g2, st) {
    if (!st || st.skill < PROMOTE_MIN) return [];
    const t = D.STAFF_TYPES.find(x => x.key === st.type);
    return (t && t.promote ? t.promote : []).filter(r => !(g2.managers && g2.managers[r]));
  }
  /* 現場から首脳陣へ。技能は少し目減りするが、効き方が変わる */
  function promoteStaff(g2, id, role) {
    const i = g2.staff.findIndex(x => x.id === id);
    if (i < 0) return null;
    const st = g2.staff[i];
    if (promotableRoles(g2, st).indexOf(role) < 0) return null;
    const m = D.MANAGERS.find(x => x.key === role);
    const skill = Math.max(10, Math.round(st.skill * 0.85));
    g2.staff.splice(i, 1);
    g2.managers = g2.managers || {};
    g2.managers[role] = {
      name: st.name, role: role, skill: skill,
      salary: Math.round(m.salary * (0.6 + skill / 30)),
      fromStaff: true
    };
    return { name: st.name, role: role, skill: skill, salary: g2.managers[role].salary };
  }

  /* ---------- 引き抜き ----------
     人はチームの間を行き来する。こちらから抜くこともあれば、抜かれることもある。 */

  /* よそのチームで働いている人。市場より腕は良いが、その代わり高い */
  function makeRivalStaff(g2, quality) {
    const names = (g2.rivals || []).map(r => r.name);
    const st = makeStaff(pick(D.STAFF_TYPES).key, quality, { bonus: rint(4, 14), traitBonus: 0.18 });
    st.team = names.length ? pick(names) : 'よそのチーム';
    return st;
  }
  /* 引き抜きにかかる金。一途な人ほど高く、腕が良いほど高い */
  function poachFee(g2, st) {
    let v = st.salary * 14 + st.skill * 90;
    if (stTrait(st, 'loyal')) v *= 1.9;
    if (stTrait(st, 'star'))  v *= 1.35;
    v *= Math.max(0.55, 1 - osk(g2, 'nego') * 0.05);      // 交渉術
    return Math.round(v);
  }

  /* よそのチームが、うちの誰かに声をかけてくる。
     腕の立つ人ほど狙われ、「一途」は靡きにくく、「名うて」はよく狙われる */
  function poachAttempt(g2) {
    const pool = (g2.staff || []).filter(s => s.skill >= 24);
    if (!pool.length) return null;
    const cand = pool.slice().sort((a, b) => b.skill - a.skill)[rint(0, Math.min(2, pool.length - 1))];
    let p = 0.10 + (cand.skill - 24) / 220;
    if (stTrait(cand, 'loyal')) p *= 0.35;
    if (stTrait(cand, 'star'))  p *= 1.8;
    p *= Math.max(0.5, 1 - osk(g2, 'nego') * 0.04);       // 交渉術で引き止めやすい
    if (Math.random() > Math.min(0.34, p)) return null;
    const names = (g2.rivals || []).map(r => r.name);
    return {
      id: cand.id, name: cand.name, skill: cand.skill, type: cand.type,
      from: names.length ? pick(names) : 'よそのチーム',
      keep: Math.round(cand.salary * 16),                 // 引き止めに要る金
      raise: 1.20                                          // 引き止めると給料が上がる
    };
  }
  function keepStaff(g2, id, raise) {
    const st = (g2.staff || []).find(x => x.id === id);
    if (!st) return false;
    st.raise = (st.raise || 1) * raise;
    st.salary = staffSalary(st);
    return true;
  }
  function loseStaff(g2, id) {
    const i = (g2.staff || []).findIndex(x => x.id === id);
    if (i < 0) return false;
    g2.staff.splice(i, 1);
    return true;
  }

  /* =======================================================
     下部組織（ユースアカデミー）
     ======================================================= */
  function makeYouth(level) {
    const d = makeDriver(Math.max(0.3, level * 0.55), {
      age: rint(16, 20), youth: true
    });
    d.isYouth = true;
    d.trained = 0;                       // 育成を受けた週数
    d.salary = Math.round(d.salary * 0.35);
    return d;
  }

  /* 抱えられる若手の人数 */
  function youthSlots(g2) {
    return 1 + Math.floor(((g2.facilities && g2.facilities.youth) || 1) / 2);
  }

  /* 毎週の成長。才能とアカデミーのレベルで伸びが変わる */
  function growYouth(g2) {
    const lv = (g2.facilities && g2.facilities.youth) || 1;
    const trainer = staffBonus(g2, 'trainer');
    const grown = [];
    (g2.youth || []).forEach(d => {
      // 若いうちほど伸びる。24歳を過ぎるとほとんど伸びなくなる
      const ageMul = d.age <= 21 ? 1 : d.age <= 23 ? 0.55 : 0.12;
      const rate = potOf(d).growth * (0.55 + lv * 0.16 + trainer * 0.05) * ageMul;
      ['speed', 'technique', 'stamina', 'mental'].forEach(k => {
        d[k] = clamp(d[k] + rnd(0.15, 0.75) * rate * (1 - d[k] / 300), 1, 199);
      });
      d.trained++;
      d.exp += Math.round(3 * rate);
      d.salary = Math.round(((d.speed + d.technique + d.stamina + d.mental) / 4 * 0.95 + 18) * 0.35);
      grown.push(d);
    });
    return grown;
  }

  /* トップチームへ昇格 */
  function promoteYouth(g2, id) {
    const d = (g2.youth || []).find(x => x.id === id);
    if (!d || g2.drivers.length >= 2) return null;
    g2.youth = g2.youth.filter(x => x.id !== id);
    d.isYouth = false;
    d.team = g2.team;
    d.salary = Math.round((d.speed + d.technique + d.stamina + d.mental) / 4 * 0.95 + 18);
    g2.drivers.push(d);
    return d;
  }

  /* ---------- 契約更改（シーズン明け）----------
     活躍した人ほど報酬を要求する。強くなるほど維持費が重くなり、
     勝ち続けても資金が無限には積み上がらないようにする              */
  function renegotiate(g2, rank) {
    const scale = D.FACILITIES.reduce((a, f) => a + (g2.facilities[f.key] || 1), 0);
    // チームが大きく、順位が良いほど要求は強くなる
    let teamPull = 1 + Math.max(0, (11 - rank)) * 0.018 + scale * 0.004
                     + Math.max(0, Math.log10(Math.max(10, g2.fans)) - 3) * 0.05;
    // 交渉術のあるオーナーは、上げ幅を抑えられる
    teamPull = 1 + (teamPull - 1) * Math.max(0.4, 1 - osk(g2, 'nego') * 0.04 * 4);
    const notes = [];
    g2.drivers.forEach(d => {
      // 本人の成績ぶん
      const own = 1 + Math.min(0.45, d.seasonPoints * 0.0022) + d.wins * 0.03;
      const before = d.salary;
      d.salary = Math.round(d.salary * Math.min(1.65, teamPull * own));
      if (d.salary > before) notes.push(d.name + ' ' + before + '→' + d.salary + '万');
    });
    g2.staff.forEach(st => { st.salary = Math.round(st.salary * Math.min(1.35, teamPull)); });
    D.MANAGERS.forEach(m => {
      const cur = g2.managers && g2.managers[m.key];
      if (cur) cur.salary = Math.round(cur.salary * Math.min(1.40, teamPull));
    });
    return notes;
  }

  /* ---------- スタッフの成長（シーズン明け）---------- */
  /* シーズン明け。1年ぶんの経験と、加齢 */
  function growStaff(g) {
    const grown = [];
    // 指導者がいるチームは、全体の伸びが良くなる
    const mentors = g.staff.filter(s => stTrait(s, 'mentor')).length;
    g.staff.forEach(st => {
      st.years = (st.years || 0) + 1;
      st.age = (st.age || 34) + 1;
      const off = rnd(26, 44) * (1 + mentors * 0.14) * (stTrait(st, 'grower') ? 1.35 : 1);
      const u = giveStaffExp(st, off * staffGrowMul(st));
      if (u) grown.push(st.name + '（技能 ' + st.skill + '／Lv.' + st.expLv + '）');
    });
    return grown;
  }
  /* 歳を取りすぎた人は引退する（シーズン明け） */
  function retireStaff(g) {
    const out = [];
    g.staff = (g.staff || []).filter(st => {
      const a = st.age || 34;
      if (a >= 58 && Math.random() < (a - 57) * 0.22) { out.push(st); return false; }
      return true;
    });
    return out;
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
      if (!g || g.version !== 6) return null;
      // 車体に項目が増えたセーブを読んだときは、下限まで埋めておく
      if (!g.logi) g.logi = { plan: 'std', crew: 0 };
      if (!g.pu) g.pu = { used: 1, life: 100, grid: 0, over: 0 };
      if (g.body) {
        const min = Math.round(D.CAR_GENS[g.carGen].cap * D.BODY_CAP_RATIO * 0.15 * 10) / 10;
        D.BODY_ATTRS.forEach(a => { if (g.body[a.key] == null) g.body[a.key] = min; });
      }
      return g;
    } catch (e) { return null; }
  }
  function wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  return {
    rnd, rint, pick, clamp,
    makeDriver, makeStaff, staffSalary, staffCap, staffNeed, staffGrowMul,
    addStaffExp, addStaffExpAll, retireStaff, stTrait, traitOf, rollStaffTraits,
    promotableRoles, promoteStaff, PROMOTE_MIN,
    makeRivalStaff, poachFee, poachAttempt, keepStaff, loseStaff, makeRivals, developRivals, driverRating, resetNames, growStaff,
    diffOf, potOf, rollPotential, renegotiate, makeYouth, youthSlots, growYouth, promoteYouth,
    hypeTier, hypeBonus, addHype, sponsorOpen, atrOf, atrLabel, championshipStake,
    fanTier, fanIncome, fanExpectation,
    makeOwner, osk, ownerRank, ownerProgress, addFame, learnOwnerSkill,
    REG_EVERY, regulationDue, applyRegulation,
    makeManager, mgr, finances, ersOf, ersFrom,
    puOf, puWear, usePU, nursePU, puReset,
    bodyCap, makeBody, bodyStats, bodyVal, bodyRatio, genProgress, tryAdvanceGen, GEN_STEP_AT, focusOf, nextCarProgress, nextCarPreview,
    logiPlan, logiCost, crewPenalty, tireCrew, restCrew,
    makePart, partStats, partCap, partScore, rollRarity, wearParts, hasT,
    rollSkills, hasSkill, learnableSkills, teachSkill, SKILL_MAX,
    persOf, nationOf, reactToResult, quoteFor,
    carStats, carScore, carScoreOf, machineChar, reliability, staffBonus, weeklyCost,
    newGame, allTeams, constructorTable, driverTable,
    raceWeek, SEASON_WEEKS, PREP_WEEKS,
    save, load, wipe
  };
})();

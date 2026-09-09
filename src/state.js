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
    // 追加効果はチームの技術（📐 開発）が受け持つので、
    // パーツ個体には付かない。運ではなく、積み上げで手に入れる
    const traits = opts.traits ? opts.traits.slice() : [];
    return {
      id: 'p' + (++partSeq) + Math.random().toString(36).slice(2, 6),
      cat: catKey,
      // 型式名の頭に世代の印。保管庫に古い世代が混ざっても一目で分かる
      name: (D.CAR_GENS[Math.min(D.CAR_GENS.length - 1, gen)] || {}).name + ' ' +
            cat.names[Math.min(cat.names.length - 1, gen)],
      gen: gen, rarity: rarity,
      polish: 0,            // 改良で溜まる熟成。満ちるとレアリティが上がる
      power: power,
      cond: opts.cond != null ? opts.cond : 100,
      traits: traits
    };
  }

  /* その世代で何が変わったのか。前の世代との差だけを書いてある */
  function partNote(catKey, gen) {
    const c = D.PART_CATS.find(x => x.key === catKey);
    if (!c || !c.notes) return '';
    return c.notes[Math.min(c.notes.length - 1, gen || 0)] || '';
  }
  /* 世代の印つきの型式名（これから作るものの名前を先に見せたいとき） */
  function partModel(catKey, gen) {
    const c = D.PART_CATS.find(x => x.key === catKey);
    const gn = (D.CAR_GENS[Math.min(D.CAR_GENS.length - 1, gen || 0)] || {}).name || '';
    return gn + ' ' + (c ? c.names[Math.min(c.names.length - 1, gen || 0)] : '');
  }

  const hasT = (p, k) => p.traits && p.traits.indexOf(k) >= 0;

  /* ---------- 開発技術（タグ）----------
     チームが積み上げるもので、パーツを載せ替えても失われない。
     g.techs = { light: { lv: 2, p: 0.35 }, ... }                */
  function techLv(g2, key)   { const t = g2 && g2.techs && g2.techs[key]; return (t && t.lv) || 0; }
  function techProg(g2, key) { const t = g2 && g2.techs && g2.techs[key]; return (t && t.p) || 0; }
  function techDef(key)      { return D.PART_TRAITS.filter(x => x.key === key)[0] || null; }
  /* いま持っている技術（レベル1以上）を、表示しやすい形で */
  function techList(g2) {
    return D.PART_TRAITS.map(t => ({
      key: t.key, name: t.name, icon: t.icon, color: t.color,
      desc: t.desc, eff: t.eff, note: t.note, per: t.per,
      lv: techLv(g2, t.key), p: techProg(g2, t.key), max: D.TECH.max
    }));
  }
  /* 1回の開発で、どれだけ進むか（0..1でレベルが1つ上がる） */
  function techStep(g2) {
    return D.TECH.step
         * (1 + designPower(g2) * D.TECH.designer + (g2.facilities.factory || 1) * D.TECH.factory)
         * devRate(g2);
  }
  function techCost(g2, key) {
    const lv = techLv(g2, key);
    return { money: Math.round(D.TECH.cost * (1 + lv * D.TECH.costLv)),
             rp:    Math.round(D.TECH.rp   * (1 + lv * D.TECH.rpLv)) };
  }
  /* 技術をひとつ進める。レベルが上がったら、その番号を返す */
  function advanceTech(g2, key) {
    g2.techs = g2.techs || {};
    const t = g2.techs[key] || (g2.techs[key] = { lv: 0, p: 0 });
    if (t.lv >= D.TECH.max) return { lv: t.lv, up: false, gain: 0 };
    const gain = techStep(g2);
    t.p += gain;
    let up = false;
    while (t.p >= 1 && t.lv < D.TECH.max) { t.p -= 1; t.lv++; up = true; }
    if (t.lv >= D.TECH.max) t.p = 0;
    return { lv: t.lv, up: up, gain: Math.round(gain * 100) / 100 };
  }

  /* パーツ1つが生む3性能。技術のレベルぶんだけ上に乗る */
  function partStats(p, g2) {
    const cat = D.PART_CATS.find(c => c.key === p.cat);
    const st = {
      speed:  p.power * cat.gain.speed,
      corner: p.power * cat.gain.corner,
      accel:  p.power * cat.gain.accel
    };
    const lv = k => techLv(g2, k);
    st.speed  *= 1 + lv('boost') * (techDef('boost').per);
    st.corner *= 1 + lv('sharp') * (techDef('sharp').per);
    st.accel  *= 1 + lv('light') * (techDef('light').per);
    return st;
  }

  /* ---------- 熟成（改良でレアリティが上がる）----------
     1回の改良でどれだけ熟成が進むか。格が上がるほど、次は遠い    */
  function polishStep(g2, p) {
    const eng = devPower(g2);
    return D.POLISH.step
         * (1 + eng * D.POLISH.eng + (g2.facilities.factory || 1) * D.POLISH.factory)
         * D.POLISH.rarStep(p.rarity);
  }
  /* あと何回の改良で格が上がるか（表示用） */
  function polishLeft(g2, p) {
    if (p.rarity >= D.RARITY.length) return 0;
    const st = polishStep(g2, p);
    return Math.max(1, Math.ceil((1 - (p.polish || 0)) / Math.max(0.001, st)));
  }

  /* 改良の上限（マシン世代 × レアリティ） */
  function partCap(g, p) {
    return Math.round(D.CAR_GENS[g.carGen].cap * D.RARITY[p.rarity - 1].capMult);
  }

  /* パーツの総合評価（表示用） */
  function partScore(p, g2) {
    const st = partStats(p, g2);
    return Math.round(st.speed + st.corner + st.accel);
  }

  /* いま何でパーツを作っているか。ファクトリーのレベルがそのまま世代になる */
  function workshopOf(g2) {
    const lv = (g2.facilities && g2.facilities.factory) || 1;
    let w = D.WORKSHOP[0];
    D.WORKSHOP.forEach(x => { if (lv >= x.at) w = x; });
    return w;
  }
  function workshopNext(g2) {
    const lv = (g2.facilities && g2.facilities.factory) || 1;
    return D.WORKSHOP.filter(x => x.at > lv)[0] || null;
  }

  /* 設計時のレアリティ抽選（デザイナーの腕と、工作機械の世代で上振れする） */
  function rollRarity(g) {
    // グリッドで他所のマシンを間近に見てきたぶんは、次の設計に効く
    const dz = designPower(g) + workshopOf(g).rar
             + (g.designEdge || 0) * 1.4;
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
      const ps = partStats(p, g);
      // コンディションが落ちたパーツは本来の性能を出しきれない
      const f = (0.82 + p.cond / 100 * 0.18) * (c.key === 'aero' ? aeroBoost : 1)
              * (c.key === 'pu' ? puForm(g) : 1);
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
    // 供給を受けているパワーユニットは自分では開発できない。
    // これを勘定に入れていたため、世代が上がって上限だけが伸びると
    // 進み具合が永久に閾値へ届かず、バーが途中で止まってしまっていた
    const parts = D.PART_CATS.map(c => g2.equipped[c.key])
      .filter(p => p && !p.supplied);
    if (!parts.length) return 0;
    const avg = parts.reduce((a, p) => a + Math.min(1, p.power / partCap(g2, p)), 0) / parts.length;
    return clamp(avg, 0, 1);
  }
  /* 世代を進めるのに、あとどのパーツが足りていないか（画面で言うために使う） */
  function genLagging(g2) {
    return D.PART_CATS.map(c => {
      const p = g2.equipped[c.key];
      if (!p || p.supplied) return null;
      return { key: c.key, name: c.name, ratio: Math.min(1, p.power / partCap(g2, p)) };
    }).filter(x => x && x.ratio < 1).sort((a, b) => a.ratio - b.ratio);
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
    // 供給を受けているパワーユニットは、供給元の最新型に載せ替わる。
    // 契約した年の性能のまま取り残されると、買った意味がなくなってしまう
    const spu = g2.equipped.pu;
    if (g2.engine && spu && spu.supplied) {
      const ratio = g2.engine.ratio != null ? g2.engine.ratio
                  : (g2.engine.power || spu.power) / Math.max(1, from.cap);
      g2.engine.ratio = ratio;
      spu.power = Math.round(to.cap * ratio * 10) / 10;
      g2.engine.power = spu.power;
      spu.gen = g2.carGen;
    }
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

  /* 積み上げた「来季ぶんの開発」を、いまのマシンに落とし込む。
     オフに方針を決めたときと、規則が変わって作り直すときに使う。
     dir を渡すと、その方向のパーツに厚く配る                        */
  function applyStock(g2, dir) {
    const stock = g2.nextCar || 0;
    if (stock <= 0) return null;
    const total = stock * D.CARRY_TO_NEXT;
    const out = { parts: [], body: [], total: Math.round(total * 10) / 10 };
    // 半分をパーツへ、半分を車体へ
    const toParts = total * 0.5, toBody = total * 0.5;
    // 方向に合うパーツほど厚く
    const w = D.PART_CATS.map(c => 1 + ((dir && c.gain && c.gain[dir]) || 0) * 1.8);
    const wSum = w.reduce((a, b) => a + b, 0);
    D.PART_CATS.forEach((c, i) => {
      const p = g2.equipped[c.key];
      if (!p) return;
      const cap = partCap(g2, p);
      const add = toParts * (w[i] / wSum);
      const before = p.power;
      p.power = Math.round(Math.min(cap, p.power + add) * 10) / 10;
      if (p.power > before) out.parts.push({ name: p.name, gain: Math.round((p.power - before) * 10) / 10 });
    });
    const bw = D.BODY_ATTRS.map(a => 1 + ((dir && a.gain && a.gain[dir]) || 0) * 1.8);
    const bSum = bw.reduce((a, b) => a + b, 0);
    const bcap = bodyCap(g2);
    D.BODY_ATTRS.forEach((a, i) => {
      const add = toBody * (bw[i] / bSum);
      const before = g2.body[a.key] || 0;
      g2.body[a.key] = Math.round(Math.min(bcap, before + add) * 10) / 10;
      if (g2.body[a.key] > before) out.body.push({ name: a.name, gain: Math.round((g2.body[a.key] - before) * 10) / 10 });
    });
    g2.nextCar = 0;
    return out;
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

  /* 今季が終わったら規則が変わるか（＝いま作っているマシンが白紙になる年か） */
  function regulationNext(g2) {
    return (g2.season % REG_EVERY) === 0;
  }

  function applyRegulation(g2) {
    g2.reg = (g2.reg || 0) + 1;
    // ---- 保管していたパーツは「遺産」になる ----
    // 旧規則のまま走らせることはできないが、そこに詰まっている知見は残る。
    // ばらして解析すれば研究の材料になり、良いものを持っていたチームは
    // 新しい規則でも良いところから始められる
    const legacy = { count: 0, rp: 0, power: 0, up: [] };
    const bestRar = {};
    (g2.inventory || []).forEach(p => {
      legacy.count++;
      legacy.power += p.power;
      bestRar[p.cat] = Math.max(bestRar[p.cat] || 0, p.rarity);
    });
    legacy.rp = Math.round(legacy.power * 0.55);
    g2.rp += legacy.rp;

    // 自チーム：パーツと車体を新規則のものに置き換える
    g2.carGen = 0;
    D.PART_CATS.forEach(c => {
      const old2 = g2.equipped[c.key];
      // 積んできた知見のぶんだけ、ゼロよりは良いところから始まる
      const carry = old2 ? Math.min(14, old2.power * 0.18) : 0;
      // 保管していた同じ種類のパーツぶんの上乗せ
      const spare = Math.min(8, legacy.power * 0.012);
      // 規則が変わってもチームの設計力までは失われない。
      // 改良で積み上げたレアリティ（＝到達できる上限）は引き継ぎ、
      // 性能だけが白紙に戻る。開発で得た技術（タグ）も、そのまま残る。
      // 保管庫により良いものがあれば、そこまで引き上げられる
      const rar = Math.max(old2 ? old2.rarity : 1, bestRar[c.key] || 1);
      if (old2 && rar > old2.rarity) {
        legacy.up.push({ cat: c.name, from: old2.rarity, to: rar });
      }
      g2.equipped[c.key] = makePart(c.key, 0, rar, { power: 10 + carry + spare });
    });
    // 旧規則のパーツそのものは使えなくなる
    // （ここが inventory ではなく stock になっていて、保管しておけば
    //   規則変更をまるごと回避できてしまっていた）
    g2.inventory = [];
    g2.legacy = legacy;
    // 新しい規則に向けて積んでいた開発は、そのまま新型の出発点になる。
    // 規則が変わる前の年に来季へ振っておくことに、はっきり意味を持たせている
    g2.body = makeBody(g2, null, g2.nextCar || 0);
    g2.nextCar = 0;
    // 供給を受けていたエンジンも新規則では使えない
    g2.engine = null;
    g2.engineStash = null;
    /* 持ち込んでいたコンセプトも、規則ごと無効になる。
       ここを残すと、もう車に乗っていないものに裁定が出て、
       関係のないパーツから性能を引かれてしまう                   */
    g2.concepts = [];
    g2.tdLog = [];
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
      r.concepts = [];
    });
    return g2.reg;
  }

  /* ---------- 開発のブレイクスルー ----------
     規則が新しいうちほど、まだ掘られていないものが残っている。
     見つけたチームは一気に速くなる。規則が固まるほど、その芽は減る  */
  function innovFresh(g2) {
    const since = ((g2.season || 1) - 1) % REG_EVERY;
    return D.INNOV.fresh[Math.min(D.INNOV.fresh.length - 1, since)];
  }
  /* 1周あたり何秒ぶんの発見か → マシン性能で何点ぶんか に直す */
  function secToScore(g2, sec) {
    const t = D.TRACKS[(g2.nextRace || 0) % D.TRACKS.length];
    return sec / (t.base * 0.00092 * 0.60);
  }
  function innovName() { return pick(D.INNOV.NAMES); }
  /* プレイヤーの開発1回ぶんの抽選。規則が新しいうちほど当たりやすく、
     技術部門が厚いほど掘り当てられる。当たれば何を見つけたかを返す   */
  function rollBreakthrough(g2) {
    const o = org(g2);
    const p = (D.INNOV.playerRate + o.dept.engineer * D.INNOV.playerOrg * o.dataMul)
            * innovFresh(g2);
    return Math.random() < p ? innovName() : null;
  }

  /* ---------- パワーユニットの使用基数 ----------
     是正措置で時間をもらっている側は、PU の割り当ても1基ぶん緩む。
     空力だけを配り直しても、エンジンで置いていかれれば同じことなので  */
  function puLimit(g2) {
    const rank = constructorTable(g2).findIndex(r => r.isPlayer) + 1;
    return D.PU_LIMIT + (aduoMul(g2, rank || 99) > 1 ? 1 : 0);
  }

  /* ---------- ライバルのシーズン中の開発 ----------
     これが無いと、プレイヤーだけが毎週伸びて途中から一方的になる。
     強いチームほど開発が速く、下位はゆっくり。難易度でも変わる。
     ただしプレイヤーほどは伸びないので、手を入れただけ前に出られる。 */
  /* ---------- コストキャップ ----------
     開発と設備に注ぎ込める1シーズンの上限。使い切ったら、
     金があってもそれ以上マシンには注げない                        */
  function costCap(g2) {
    return D.COST_CAP + (g2.season - 1) * D.COST_CAP_GROW;
  }
  const capSpent = g2 => g2.capSpent || 0;
  const capLeft = g2 => Math.max(0, costCap(g2) - capSpent(g2));
  /* 上限に対して使った割合（0..1超） */
  const capRatio = g2 => capSpent(g2) / Math.max(1, costCap(g2));
  /* 開発の支出を記録する。上限を超えた分は返す。
     輸送費・人件費・設備投資・PUの購入は対象外なのでここを通さない */
  function spendCapped(g2, amount) {
    g2.capSpent = capSpent(g2) + amount;
    return Math.max(0, g2.capSpent - costCap(g2));
  }
  /* シーズン明けの精算。超過していれば罰金と、翌年の風洞時間の削減 */
  function settleCap(g2) {
    const over = Math.max(0, capSpent(g2) - costCap(g2));
    g2.capSpent = 0;
    g2.repairPaid = 0;              // 修理費の集計も、季が変われば仕切り直す
    g2.capPenalty = over > 0;
    if (over <= 0) return null;
    const fine = Math.round(over * D.COST_CAP_FINE);
    g2.funds -= fine;
    return { over: Math.round(over), fine: fine };
  }

  /* ---------- 風洞・CFDの使用時間 ----------
     前年の順位で決まる開発の伸びの倍率。1年を通して変わらない       */
  function atrOf(g2) {
    const r = g2.lastRank || 0;
    const pen = g2.capPenalty ? D.COST_CAP_ATR : 1;    // 前年の予算超過ぶん
    if (!r) return pen;                                // 1年目は順位の傾斜なし
    return D.ATR[Math.min(D.ATR.length - 1, r - 1)] * pen;
  }
  /* ---------- ADUO（空力開発格差是正指令）----------
     風洞時間（ATR）が前年の順位で決まる静的なものなのに対して、
     こちらは「いまのシーズンがどれだけ一方的か」を見て季中に発動する。
     独走しているチームは削られ、大きく離されたチームは上乗せされる。
     プレイヤーが独走している場合も、当然プレイヤーが削られる側になる   */
  function aduoOf(g2) {
    const none = { level: 0, cut: 1, lift: 1, share: 0, lead: 0, half: 99 };
    const done = g2.nextRace || 0;
    if (done < D.ADUO_FROM) return none;
    const table = constructorTable(g2);
    if (table.length < 2) return none;
    const max = (D.POINTS[0] + D.POINTS[1] + D.FASTEST_LAP_POINT) * done;
    const share = max > 0 ? table[0].points / max : 0;
    const lead = (table[0].points - table[1].points) / done;
    let hit = null;
    D.ADUO_LEVELS.forEach(L => { if (share >= L.share && lead >= L.lead) hit = L; });
    if (!hit) return none;
    return {
      level: hit.level, name: hit.name, icon: hit.icon, color: hit.color, note: hit.note,
      cut: hit.cut, lift: hit.lift, share: share, lead: lead,
      top: table[0].name, topIsPlayer: !!table[0].isPlayer,
      half: Math.max(2, Math.round(table.length * D.ADUO_HALF))
    };
  }
  /* そのチームが ADUO で受ける開発の倍率。順位表のどこにいるかで決まる */
  function aduoMul(g2, rank, ad) {
    const a = ad || aduoOf(g2);
    if (!a.level) return 1;
    if (rank === 1) return a.cut;         // 独走している当人が削られる
    if (rank > a.half) return a.lift;     // 大きく離されたチームに回る
    return 1;
  }
  /* 開発の伸びにかかる倍率。風洞時間の傾斜と、難易度と、ADUO、
     そしてオーナーの技術眼（+7%/Lv）を合わせたもの                */
  function devRate(g2) {
    const rank = constructorTable(g2).findIndex(r => r.isPlayer) + 1;
    return atrOf(g2) * (diffOf(g2).dev || 1) * aduoMul(g2, rank || 99)
         * (1 + osk(g2, 'eye') * 0.07)
         // パワーユニットを他人に任せているぶん、ほかへ人を回せる
         * (g2.engine ? D.ENGINE.freeDev : 1);
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
    const ad = aduoOf(g2);
    /* ADUO 発令中は、離されているぶんに応じた「追い上げ」がつく。
       開発時間の配り直しだけでは、すでに仕上がったマシンには追いつけない。
       差が大きいほど効き、追いついたぶんだけ効かなくなる            */
    const sum = st => st.speed + st.corner + st.accel;
    const mine = sum(carStats(g2));
    const topScore = Math.max.apply(null, [mine].concat((g2.rivals || []).map(r => sum(r.stats))));
    (g2.rivals || []).forEach(r => {
      // シーズン開始時の水準を覚えておく（どれだけ伸びたかを見せるため）
      if (!r.base0) r.base0 = { speed: r.stats.speed, corner: r.stats.corner, accel: r.stats.accel };
      const power = (D.RIVALS.find(x => x.name === r.name) || { power: 1 }).power;
      // 1週あたりの伸び。season が進むほど全体の水準も上がる。
      // 掃引して決めた値。これより速いとプレイヤーが永久に追いつけず、
      // 遅いとシーズン半ばで一方的になる。
      const atr = D.ATR[Math.min(D.ATR.length - 1, (rivalRank[r.name] || 6) - 1)];
      // 一強状態なら、離されたチームには是正措置ぶんが上乗せされる
      const relief = aduoMul(g2, rivalRank[r.name] || 6, ad);
      const step = (0.055 + power * 0.075) * (diff.rivalGrow || 1) * atr * relief
                 * (1 + g2.season * 0.04 + (g2.carGen || 0) * 0.09);
      const behind = (ad.level && (rivalRank[r.name] || 6) > 1)
        ? Math.max(0, topScore - sum(r.stats)) : 0;
      const catchUp = behind * D.ADUO_CATCH * ad.level / 3;   // 3項目に振り分ける
      ['speed', 'corner', 'accel'].forEach(k => {
        r.stats[k] = r.stats[k] + (step + catchUp) * (0.8 + Math.random() * 0.5);
      });
      // 信頼性も少しずつ上がる
      r.rel = clamp(r.rel + 0.012 * (diff.rivalGrow || 1), 40, 98);
      /* ---- ブレイクスルー ----
         毎週わずかな確率で、どこかのチームが何かを掘り当てる。
         規則が新しいうちほど起きやすく、是正措置で時間をもらっている
         チームは、その時間を探索に回せるぶん見つけやすい          */
      let ch = D.INNOV.rivalWeek * innovFresh(g2) * (0.55 + power * 0.55);
      if (relief > 1) ch *= 1 + D.INNOV.aduoBoost;
      if (Math.random() < ch) {
        const sec = rnd(D.INNOV.secMin, D.INNOV.secMax);
        const pts = secToScore(g2, sec);
        const ref = D.TRACKS[(g2.nextRace || 0) % D.TRACKS.length];
        const mul = 1 + pts / Math.max(1, carScoreOf(r.stats, ref));
        ['speed', 'corner', 'accel'].forEach(k => { r.stats[k] *= mul; });
        const what = innovName();
        // 何を持ち込んだのかは控えておく。あとで裁定が出ることがある
        r.concepts = (r.concepts || []).concat([{
          what: what, mul: mul, sec: Math.round(sec * 100) / 100, at: weekStamp(g2)
        }]);
        g2.innovLog = (g2.innovLog || []).concat([{
          team: r.name, color: r.color, what: what,
          sec: Math.round(sec * 100) / 100, mine: false
        }]);
      }
    });
    rollDirectives(g2);
  }

  /* ---------- 最近のできごと ----------
     記者はいつも同じことを聞くわけではない。裁定があった週と、
     ドライバーが入れ替わった週では、向けられる問いが変わる。
     直近のものだけを覚えておけば足りる                          */
  function pushNews(g2, kind, what, extra) {
    g2.news = (g2.news || []).concat([
      Object.assign({ kind: kind, what: what, at: weekStamp(g2) }, extra || {})
    ]).slice(-8);
  }
  /* いま記者がいちばん聞きたいこと。新しくて、重いものから */
  function pressTopic(g2) {
    const now = weekStamp(g2);
    const fresh = (g2.news || []).filter(n => now - n.at <= D.PRESS_FRESH);
    if (!fresh.length) return null;
    let best = null, bs = -1;
    fresh.forEach(n => {
      const t = D.PRESS.find(x => x.key === n.kind);
      if (!t) return;
      // 重さと新しさで選ぶ。同じくらいなら新しいほう
      const sc = t.weight * 10 - (now - n.at);
      if (sc > bs) { bs = sc; best = { topic: t, news: n }; }
    });
    return best;
  }

  /* ---------- テクニカルディレクティブ ----------
     掘り当てたものが、あとから「これは想定外だ」と裁定されることがある。
     規則が新しいうちほど灰色の領域が広く、そこを攻めたぶんリスクも高い。
     独走しているチームのものは、他所から突かれやすい               */
  function weekStamp(g2) {
    return ((g2.season || 1) - 1) * SEASON_WEEKS + (g2.week || 1);
  }
  function tdFresh(g2) {
    const since = ((g2.season || 1) - 1) % REG_EVERY;
    return D.TD.fresh[Math.min(D.TD.fresh.length - 1, since)];
  }
  /* そのコンセプトが今週、裁定を受ける確率 */
  function tdRisk(g2, isTop, shielded) {
    let r = D.TD.weekChance * tdFresh(g2);
    if (isTop) r *= D.TD.protestTop;
    if (shielded) r /= (1 + analystPower(g2) * D.TD.readShield);
    return r;
  }
  function rollDirectives(g2) {
    const table = constructorTable(g2);
    const topName = table.length ? table[0].name : '';
    const now = weekStamp(g2);
    const out = [];
    // ---- ライバルのぶん ----
    (g2.rivals || []).forEach(r => {
      const keep = [];
      (r.concepts || []).forEach(c => {
        if (c.safe || now - c.at < D.TD.grace ||
            Math.random() >= tdRisk(g2, r.name === topName, false)) { keep.push(c); return; }
        // 向こうにも顔の利くオーナーはいる。照会のまま流れることがある
        if (Math.random() < D.TD.rivalDismiss) {
          c.safe = true; keep.push(c);
          out.push({ team: r.name, color: r.color, what: c.what, sec: c.sec,
                     why: pick(D.TD.REASONS), mine: false, dismissed: true });
          return;
        }
        ['speed', 'corner', 'accel'].forEach(k => { r.stats[k] /= c.mul; });
        out.push({ team: r.name, color: r.color, what: c.what, sec: c.sec,
                   why: pick(D.TD.REASONS), mine: false });
      });
      r.concepts = keep;
    });
    // ---- 自チームのぶん ----
    // ここでは「照会が来た」までを決める。受け入れるか提訴するかは本人が選ぶ
    const mineTop = !!(table.length && table[0].isPlayer);
    (g2.concepts || []).forEach((c, i) => {
      if (c.safe || c.pending || now - c.at < D.TD.grace ||
          Math.random() >= tdRisk(g2, mineTop, true)) return;
      if (Math.random() < tdDismiss(g2)) {
        // オーナーの顔で、照会のまま収まった
        c.safe = true;
        out.push({ what: c.what, why: pick(D.TD.REASONS), mine: true, dismissed: true });
        return;
      }
      c.pending = true;
      g2.tdPending = (g2.tdPending || []).concat([{
        idx: i, what: c.what, why: pick(D.TD.REASONS),
        cat: c.cat || null, body: c.body || null, rarUp: !!c.rarUp,
        lost: Math.round(tdLoss(g2, c) * 10) / 10,
        fee: tdFee(g2, c), odds: Math.round(tdAppeal(g2) * 100)
      }]);
    });
    if (out.length) g2.tdLog = (g2.tdLog || []).concat(out);
  }

  /* 照会が不問に付される確率。オーナーの顔がそのまま効く */
  function tdDismiss(g2) {
    return clamp(D.TD.dismissBase + osk(g2, 'nego') * D.TD.dismissNego
               + osk(g2, 'fame') * D.TD.dismissFame, 0, D.TD.dismissMax);
  }
  /* 提訴が通る確率。交渉と技術の裏づけ、両方が要る */
  function tdAppeal(g2) {
    return clamp(D.TD.appealBase + osk(g2, 'nego') * D.TD.appealNego
               + osk(g2, 'eye') * D.TD.appealEye
               + analystPower(g2) * D.TD.appealAnalyst, D.TD.appealMin, D.TD.appealMax);
  }
  /* そのコンセプトを失うと、いくら性能が減るか */
  function tdLoss(g2, c) {
    if (c.body) return Math.max(0, Math.min((g2.body[c.body] || 0) - 4, c.gain * 0.85));
    const p = g2.equipped[c.cat];
    return p ? Math.max(0, Math.min(p.power - 8, c.gain * 0.85)) : 0;
  }
  function tdFee(g2, c) {
    return perkPrice(g2, 'legal',
      Math.round(D.TD.feeBase + tdLoss(g2, c) * D.TD.feePerLost
               + (g2.season || 1) * D.TD.feePerSeason));
  }
  /* 受け入れる：そのコンセプトを失う。解析したぶんは研究Pに残る。
     争って敗れた場合は、ばらして調べるひまもないので残らない       */
  function tdAccept(g2, cs, noRefund) {
    const c = (g2.concepts || [])[cs.idx];
    const lost = c ? tdLoss(g2, c) : 0;
    if (c) {
      if (c.body) g2.body[c.body] = Math.round(((g2.body[c.body] || 0) - lost) * 10) / 10;
      else {
        const p = g2.equipped[c.cat];
        if (p) {
          if (c.rarUp && p.rarity > 1) p.rarity--;
          p.power = Math.round((p.power - lost) * 10) / 10;
        }
      }
    }
    const rp = noRefund ? 0 : Math.round(lost * D.TD.refundRp);
    g2.rp += rp;
    g2.concepts = (g2.concepts || []).filter((x, i) => i !== cs.idx);
    reindexPending(g2, cs.idx);
    return { lost: Math.round(lost * 10) / 10, rp: rp, rarDown: !!(c && c.rarUp) };
  }
  /* 提訴する：費用を払って争う。通れば以後その件では問われない */
  function tdAppealNow(g2, cs) {
    g2.funds -= cs.fee;
    const win = Math.random() < tdAppeal(g2);
    const c = (g2.concepts || [])[cs.idx];
    if (win) {
      if (c) { c.pending = false; c.safe = true; }
      return { win: true, fee: cs.fee };
    }
    const r = tdAccept(g2, cs, true);   // 弁護に使ったぶん、知見は残らない
    r.win = false; r.fee = cs.fee;
    return r;
  }
  /* 1件処理したら、後ろに控えている件の指す番号をずらす */
  function reindexPending(g2, removed) {
    g2.tdPending = (g2.tdPending || []).map(x =>
      x.idx > removed ? Object.assign({}, x, { idx: x.idx - 1 }) : x);
  }

  /* ---------- 路面を読む力・濡れた路面での強さ ----------
     レース中の判断（どのタイヤをいつ履くか）を決める値。
     画面でも同じ数字を出したいので、ここに置いて race.js と共有する  */
  function foresightOf(g2) {
    // 上限に張りつくのが早すぎると、雇っても伸びた気がしない。
    // ひとり雇って 0.3 台、腕利きを揃えて 0.9 近くまで、なだらかに伸ばす
    return clamp(0.20 + readPower(g2) * 0.075 + osk(g2, 'call') * 0.06, 0.10, 0.92);
  }
  function wetSkillOf(d) {
    if (!d) return 0;
    return clamp((hasSkill(d, 'rain') ? 0.42 : 0)
               + (d.technique || 0) / 480 + (d.mental || 0) / 900, 0, 0.86);
  }
  /* タイヤをどれだけ保たせられるか（0..1。高いほど減りが遅い） */
  function tyreSkillOf(d) {
    if (!d) return 0;
    const v = (hasSkill(d, 'tyre') ? 0.45 : 0) + (d.technique || 0) / 420;
    return clamp(v, 0, 0.95);
  }

  /* ---------- マシン信頼性（0-100）---------- */
  function reliability(g) {
    let sum = 0, bonus = 0, n = 0;
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) { sum += 40; n++; return; }
      sum += p.cond; n++;
    });
    const avg = sum / Math.max(1, n);
    // 冷却強化と高耐久は、いまやチームの技術。台数ぶんではなく一度だけ効く
    bonus += techLv(g, 'cool') * (techDef('cool').per) + techLv(g, 'tough') * 0.8;
    const bodyRel = bodyRatio(g, 'rigidity') * 9 + bodyRatio(g, 'cooling') * 7;
    return clamp(avg + bonus + bodyRel - crewPenalty(g).rel - puRelDrop(g)
               + g.facilities.pit * 2.5 + pitPower(g) * 1.4
               + (g.engine ? D.ENGINE.relBonus : 0), 5, 99);
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
  /* 積荷。何をどれだけ持っていくか */
  function logiLoad(g2) {
    const k = (g2.logi && g2.logi.load) || 'std';
    return D.LOGI_LOADS.find(l => l.key === k) || D.LOGI_LOADS[1];
  }
  /* 1戦ぶんの輸送費。遠いコースほど高く、積むほど高い */
  function logiCost(g2, track) {
    const far = (track && track.far) || 1;
    const cut = Math.min(0.45, mgr(g2, 'logistics') * 0.012 + osk(g2, 'money') * 0.03);
    return perkPrice(g2, 'logi',
      Math.round(D.LOGI_BASE * far * logiPlan(g2).cost * logiLoad(g2).cost * (1 - cut)));
  }
  /* 荷が遅れる確率。遠いコースほど、そして安く運ぶほど高い。
     ロジスティクス責任者がいると、通関も現地手配も段取りよく進む     */
  function logiRisk(g2, track) {
    const far = (track && track.far) || 1;
    const base = logiPlan(g2).delay + logiLoad(g2).delay;
    if (base <= 0) return 0;
    const soft = 1 - Math.min(0.70, mgr(g2, 'logistics') * 0.020 + osk(g2, 'money') * 0.02);
    return clamp(base * (0.55 + far * 0.55) * soft, 0, 0.60);
  }
  /* 実際に遅れたかどうかを1戦ぶん判定する */
  function rollLogi(g2, track) {
    if (!g2.logi) g2.logi = { plan: 'std', load: 'std', crew: 0 };
    const late = Math.random() < logiRisk(g2, track);
    g2.logi.late = late;
    if (late) {
      D.PART_CATS.forEach(c => {
        const p = g2.equipped[c.key];
        if (p) p.cond = clamp(p.cond - D.LOGI_DELAY_COND, 5, 100);
      });
      g2.logi.crew = clamp(crew(g2) + D.LOGI_DELAY_FATIGUE, 0, 100);
    }
    return late;
  }
  /* レース後、持ってきた予備で機材を手当てする。
     軽装で来た週は、これができない                                  */
  function useSpares(g2) {
    const n = logiLoad(g2).spares;
    if (n <= 0) return null;
    const list = D.PART_CATS.map(c => g2.equipped[c.key])
      .filter(p => p && p.cond < 72)
      .sort((a, b) => a.cond - b.cond).slice(0, n);
    if (!list.length) return null;
    let sum = 0;
    list.forEach(p => {
      const before = p.cond;
      p.cond = clamp(p.cond + D.LOGI_SPARE_FIX, 5, 100);
      sum += p.cond - before;
    });
    return sum > 0 ? { n: list.length, gain: Math.round(sum) } : null;
  }
  /* クルーの疲労（0..100） */
  const crew = g2 => clamp((g2.logi && g2.logi.crew) || 0, 0, 100);
  /* 疲労が生む悪影響。ロジ責任者が付いていれば効きが小さい */
  function crewPenalty(g2) {
    const r = crew(g2) / 100 * (1 - Math.min(0.4, mgr(g2, 'logistics') * 0.008));
    return { pit: r * D.CREW_FULL.pit, rel: r * D.CREW_FULL.rel,
             mistake: r * D.CREW_FULL.mistake, level: crew(g2) };
  }
  /* ---------- 組織のかみ合い ----------
     各部門の「実際に効いている厚み」を一度に出す。
       dept …… その職種の腕 × 部門を見る首脳陣の乗数
                （部下がいない首脳陣は、掛ける相手がいないので空回りする）
       dataMul … アナリストが集めたデータの底上げ。開発・読み・育成にかかる
                （回す先が無ければ、やはり何も増えない）
       ready …… 現場の余力。クルーが疲れきっていると、読めていても動けない
     どこかを厚くするより、噛み合わせるほうが伸びる                     */
  function org(g2) {
    const raw = {}, dept = {}, lead = {};
    D.STAFF_TYPES.forEach(t => { raw[t.key] = staffBonus(g2, t.key); });
    D.MANAGERS.forEach(m => { lead[m.key] = 1 + mgr(g2, m.key) * D.ORG.lead; });
    D.STAFF_TYPES.forEach(t => {
      const boss = D.ORG.DEPT[t.key] || 'principal';
      dept[t.key] = raw[t.key] * lead[boss];
    });
    const data = dept.analyst / (dept.analyst + D.ORG.dataHalf);
    return {
      raw: raw, dept: dept, lead: lead,
      data: data,
      dataMul: 1 + data * D.ORG.dataGain,
      ready: 1 - (1 - D.ORG.readyFloor) * (crew(g2) / 100)
    };
  }
  /* 各部門が実際に出している力。式のあちこちはこれを見る */
  function devPower(g2)   { const o = org(g2); return o.dept.engineer * o.dataMul; }
  function designPower(g2){ return org(g2).dept.designer; }
  function pitPower(g2)   { return org(g2).dept.mechanic; }
  function readPower(g2)  { const o = org(g2); return o.dept.strategist * o.dataMul; }
  function trainPower(g2) { const o = org(g2); return o.dept.trainer * o.dataMul; }
  function analystPower(g2){ return org(g2).dept.analyst; }

  /* タイヤをどれだけ長持ちさせられるか（小さいほど持つ）。
     技術のあるドライバーほど、同じタイヤで長く走れる            */
  function tyreWear(d) { return (hasSkill(d, 'tyre') ? 0.55 : 1) * (1 - d.technique / 420); }

  /* このコースを素直に何回止まって走るか。
     よけいに1回止まって失うのはピットロードのぶん。そのかわり区間が短くなり、
     やわらかくて速いタイヤを履ける。短いピットロードと長い距離ほど2回が生きる */
  function naturalStops(track, laps, wear) {
    return laps * (0.42 + wear * 0.24) > (track.pitLane || 18) ? 2 : 1;
  }

  /* ---- ピットの静止時間としくじりやすさ ----
     ジャッキが上がって下りるまでの秒数。設備とクルーの腕で縮むのはここだけで、
     ピットロードを制限速度で走るぶん（コース側の数字）はいくら鍛えても縮まない。
     腕が上がるほど、ナットを落とすような大きなしくじりも減っていく          */
  function pitCrew(g2) {
    const skill = g2.facilities.pit * 0.55 + pitPower(g2) + osk(g2, 'call') * 0.5;
    const cw = crewPenalty(g2);
    const stand = D.PIT_STAND_MIN + (D.PIT_STAND_BASE - D.PIT_STAND_MIN)
                / (1 + skill * D.PIT_STAND_CURVE) + cw.pit;
    const fumble = clamp(D.PIT_FUMBLE_BASE / (1 + skill * 0.20) + cw.mistake * 0.8,
                         D.PIT_FUMBLE_MIN, 0.30);
    return { skill: skill, stand: stand, fumble: fumble };
  }

  /* レースを1戦こなしたぶんの消耗。輸送手段で増減する */
  function tireCrew(g2) {
    if (!g2.logi) g2.logi = { plan: 'std', load: 'std', crew: 0 };
    const soft = 1 - Math.min(0.5, mgr(g2, 'logistics') * 0.010);
    // レースの合間にいくらかは休める。荷が多いほど積み下ろしがこたえる
    const d = logiPlan(g2).fatigue + logiLoad(g2).fatigue - 2;
    g2.logi.crew = clamp(crew(g2) + (d > 0 ? d * soft : d), 0, 100);
  }
  /* 休養・オフシーズンでの回復 */
  function restCrew(g2, amount) {
    if (!g2.logi) g2.logi = { plan: 'std', load: 'std', crew: 0 };
    g2.logi.crew = clamp(crew(g2) - amount, 0, 100);
  }

  /* ---------- パワーユニットの使用基数と載せ替え ---------- */
  function puOf(g2) {
    if (!g2.pu) g2.pu = { used: 1, life: 100, grid: 0, over: 0, n: 1, pool: [] };
    if (!g2.pu.pool) g2.pu.pool = [];       // 車から降ろして取ってあるユニット
    if (!g2.pu.n) g2.pu.n = g2.pu.used || 1;  // いま載せているユニットの通し番号
    return g2.pu;
  }
  /* へたり具合（0=新品、1=使い切り）。
     残りが PU_TIRED_FROM を割ってから効きはじめる                    */
  function puTired(g2) {
    const pu = puOf(g2);
    return clamp((D.PU_TIRED_FROM - pu.life) / D.PU_TIRED_FROM, 0, 1);
  }
  /* いま選んでいる出力モード */
  function puMode(g2) {
    return D.PU_MODES.find(m => m.key === (g2.puMode || 'std')) || D.PU_MODES[1];
  }
  function setPuMode(g2, key) {
    if (D.PU_MODES.some(m => m.key === key)) g2.puMode = key;
    return puMode(g2);
  }
  /* PUの出力にかかる係数。使い込むほど本来の力を出せなくなり、
     どこまで回すか（出力モード）でも上下する                       */
  function puForm(g2) { return (1 - D.PU_TIRED * puTired(g2)) * puMode(g2).power; }
  /* 使い込んだPUが落とす信頼性。全開で回せばさらに落ちる */
  function puRelDrop(g2) { return D.PU_TIRED_REL * puTired(g2) - puMode(g2).rel; }
  /* PUの状態が、そのまま走りの速さに乗る量（性能ポイント）。
     マイナスなら遅い。グリッド1台ぶんがおよそ 1.0 に相当する      */
  function puPerf(g2) { return puMode(g2).perf - D.PU_PERF_DROP * puTired(g2); }
  /* 新品1基の値段。世代が進むほど高くつく */
  function puFreshCost(g2) {
    return perkPrice(g2, 'pu', Math.round(D.PU_FRESH_COST * (1 + (g2.carGen || 0) * 0.20)));
  }
  /* いま載せているユニットを降ろして保管する（残量があれば） */
  function stowPU(pu) {
    if (pu.life >= D.PU_KEEP_MIN) pu.pool.push({ n: pu.n, life: pu.life });
    pu.pool.sort((a, b) => b.life - a.life);
    if (pu.pool.length > 6) pu.pool.length = 6;
  }
  /* 新品を投入する。基数を1つ使い、上限を超えていればグリッド降格 */
  function fitFreshPU(g2) {
    const pu = puOf(g2);
    stowPU(pu);
    pu.used++; pu.n = pu.used; pu.life = 100;
    const out = { used: pu.used, over: false, grid: 0, fresh: true };
    if (pu.used > puLimit(g2)) {
      pu.over++; pu.grid += D.PU_PENALTY;
      out.over = true; out.grid = D.PU_PENALTY;
    }
    return out;
  }
  /* 保管してあるユニットに載せ替える。基数は増えないので降格もない */
  function mountPU(g2, idx) {
    const pu = puOf(g2);
    const u = pu.pool[idx];
    if (!u) return null;
    pu.pool.splice(idx, 1);
    stowPU(pu);
    const from = pu.n;
    pu.n = u.n; pu.life = u.life;
    return { from: from, to: u.n, life: Math.round(u.life) };
  }
  /* 1戦でどれだけ削れるか。冷却の効いた車体と、腕の良いメカニックほど保つ */
  function puWear(g2, track, pushMul) {
    const laps = (track && track.laps) || 26;
    const cool = 1 - bodyRatio(g2, 'cooling') * 0.30;
    const care = 1 - Math.min(0.28, pitPower(g2) * 0.06 + g2.facilities.pit * 0.015);
    return D.PU_BASE_WEAR * (laps / 26) * (pushMul || 1) * cool * care * puMode(g2).wear;
  }
  /* レースを走り終えたときの処理。使い切ったら次の基数へ */
  function usePU(g2, track, pushMul) {
    const pu = puOf(g2);
    pu.life = Math.max(0, pu.life - puWear(g2, track, pushMul));
    const out = { swapped: false, used: pu.used, over: false, grid: 0, reused: 0 };
    if (pu.life <= 0) {
      // 使い切ってしまった。取ってあるユニットが残っていればそれを積む
      const best = pu.pool.length ? 0 : -1;
      if (best >= 0 && pu.pool[best].life >= 30) {
        const m = mountPU(g2, best);
        out.swapped = true; out.reused = m.to; out.life = m.life;
      } else {
        const f = fitFreshPU(g2);
        out.swapped = true; out.used = f.used; out.over = f.over; out.grid = f.grid;
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
  function puReset(g2) { g2.pu = { used: 1, life: 100, grid: 0, over: 0, n: 1, pool: [] }; }

  /* このコースはどれだけ追い抜けるか（0..1）。
     長いストレートがあって、壁が近くないほど抜きやすい。
     グリッド降格をどのレースで取るか、を考えるための目安        */
  function overtakeEase(track) {
    if (!track) return 0.5;
    const spd = (track.weight && track.weight.speed) || 0.33;
    return clamp(spd * 2.0 + (track.base - 92) * 0.006 - (track.risk - 1) * 0.85, 0.05, 0.95);
  }

  /* ---------- パワーユニットの供給 ----------
     供給元がどれだけのものを持っているか。速いチームほど強い。
     客に回ってくるのは、ワークスより一段落としたもの            */
  function supplierPower(g2, teamName) {
    const rivals = g2.rivals || [];
    if (!rivals.length) return 0;
    const track = D.TRACKS[Math.min(g2.nextRace || 0, D.TRACKS.length - 1)];
    const scores = rivals.map(r => carScoreOf(r.stats, track));
    const lo = Math.min.apply(null, scores), hi = Math.max.apply(null, scores);
    const t = rivals.filter(r => r.name === teamName)[0];
    if (!t) return 0;
    const rank01 = hi > lo ? (carScoreOf(t.stats, track) - lo) / (hi - lo) : 0.5;
    const cap = D.CAR_GENS[Math.min(D.CAR_GENS.length - 1, g2.carGen || 0)].cap;
    return Math.round(cap * (0.55 + rank01 * 0.62) * D.ENGINE.customer);
  }
  /* 供給元が開発したぶんが、少しずつこちらへ降りてくる（毎週）。
     自分では一切手を入れられないのに、放っておいても強くなっていく   */
  function tickEngine(g2) {
    if (!g2.engine || !g2.equipped || !g2.equipped.pu) return 0;
    const want = supplierPower(g2, g2.engine.team);
    const now = g2.equipped.pu.power;
    if (want <= now + 0.05) return 0;
    const step = Math.min(want - now, Math.max(0.3, (want - now) * D.ENGINE.catch));
    g2.equipped.pu.power = now + step;
    g2.engine.power = Math.round(g2.equipped.pu.power);
    g2.engine.grown = Math.round(((g2.engine.grown || 0) + step) * 10) / 10;
    return Math.round(step * 10) / 10;
  }

  /* ---------- 修理費 ----------
     スピン、コースアウト、クラッシュ。壊したぶんは自分で払う。
     世代の進んだマシンほど部品が高い。難易度でも変わる          */
  function repairBill(g2, res) {
    const R2 = D.REPAIR;
    const genMul = 1 + (g2.carGen || 0) * R2.gen;
    const diff = diffOf(g2).repair == null ? 1 : diffOf(g2).repair;
    let sum = 0;
    const lines = [];
    (res.entries || []).filter(e => e.isPlayer).forEach(e => {
      let n = 0;
      if (e.spins) { n += R2.spin * e.spins; }
      if (e.dnf && e.dnfReason === 'スピンからのコースアウト') n += R2.off;
      else if (e.dnf && ['クラッシュ', '接触', 'コースアウト'].indexOf(e.dnfReason) >= 0) n += R2.crash;
      n += R2.dmg * (e.damage || 0);
      if (n <= 0) return;
      n = Math.round(n * genMul * diff);
      sum += n;
      lines.push({ name: e.driver.name, cost: n,
                   what: e.dnf ? e.dnfReason : (e.spins + '回スピン') });
    });
    return { total: sum, lines: lines };
  }

  /* ---------- パーツの消耗（レース後）---------- */
  function wearParts(g, amount) {
    // 整備性が高い車体は、同じ距離を走ってもパーツが傷まない
    const svc = 1 - bodyRatio(g, 'service') * 0.35;
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) return;
      // ギアボックスのように、そもそも消耗の速い部位がある
      const w = amount * Math.max(0.35, 1 - techLv(g, 'tough') * (D.PART_TRAITS.filter(t => t.key === 'tough')[0].per))
              * svc * (c.wear || 1);
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
      // 段位が上がるほど、同じ技能でもチームへの効き方が大きくなる
      const w = s.skill * staffRank(s).mul;
      if (s.type === key) { sum += w; return; }
      // 「肩書きは違うが、あの人はそこも見られる」ぶん
      (s.traits || []).forEach(tk => {
        const t = D.STAFF_TRAITS.find(x => x.key === tk);
        if (t && t.cross === key) sum += w * D.STAFF_TRAIT_CROSS;
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

  /* ---------- タイトルスポンサー ---------- */
  const titleOf = g2 => (g2.title && D.TITLE_SPONSORS.find(x => x.key === g2.title.key)) || null;
  /* 話ができる相手（ファンと注目度が届いているもののうち、いちばん大きいもの） */
  function titleOpen(g2) {
    return D.TITLE_SPONSORS.filter(t =>
      (g2.fans || 0) >= t.fans && (g2.hype || 0) >= t.hype);
  }
  function signTitle(g2, key) {
    const t = D.TITLE_SPONSORS.find(x => x.key === key);
    if (!t) return null;
    g2.title = { key: t.key, left: t.years };     // left は残りシーズン数
    return t;
  }
  /* 表示に使うチーム名。冠がつく */
  function teamLabel(g2) {
    const t = titleOf(g2);
    return t ? t.short + ' ' + g2.team : g2.team;
  }
  /* シーズン明けに契約年数が減る。切れたら外れる */
  function tickTitle(g2) {
    if (!g2.title) return null;
    g2.title.left--;
    if (g2.title.left > 0) return null;
    const gone = titleOf(g2);
    g2.title = null;
    return gone;
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

  /* ---------- サプライヤーの特典 ----------
     金を出す代わりに、自分たちの商売そのものを安くしてくれる。
     'fac:factory' のような細かい指定と、'fac' のような広い指定があり、
     どちらもその費目に効く。合わせても割引には上限を置く          */
  function perkCut(g2, target) {
    let cut = 0;
    (g2.sponsors || []).forEach(sp => {
      const pk = sp.perk;
      if (!pk) return;
      // 'fac' は 'fac:factory' にも効く。逆は効かない
      if (pk.key === target || (target.indexOf(pk.key + ':') === 0)) cut += pk.cut;
    });
    const ts = titleOf(g2);
    if (ts && ts.perk && (ts.perk.key === target || target.indexOf(ts.perk.key + ':') === 0)) {
      cut += ts.perk.cut;
    }
    return Math.min(D.PERK_CAP, cut);
  }
  /* 特典を効かせた値段 */
  function perkPrice(g2, target, amount) {
    return Math.round(amount * (1 - perkCut(g2, target)));
  }
  /* いま効いている特典の一覧（画面用） */
  function perkList(g2) {
    const out = [];
    const add2 = (sp, pk) => {
      if (!pk) return;
      const d = D.PERKS[pk.key] || { icon: '🏭', name: pk.key };
      out.push({ from: sp.name, icon: d.icon, name: d.name, cut: pk.cut, key: pk.key });
    };
    (g2.sponsors || []).forEach(sp => add2(sp, sp.perk));
    const ts = titleOf(g2);
    if (ts) add2(ts, ts.perk);
    return out;
  }

  /* ---------- 収支の内訳 ---------- */
  function finances(g2) {
    const staff = g2.staff.reduce((a, s) => a + s.salary, 0);
    const mgrs = D.MANAGERS.reduce((a, m) => a + (g2.managers && g2.managers[m.key] ? g2.managers[m.key].salary : 0), 0);
    const drivers = g2.drivers.reduce((a, d) => a + d.salary, 0)
                  + (g2.reserve ? g2.reserve.salary : 0);
    const youth = (g2.youth || []).reduce((a, d) => a + d.salary, 0);
    const facilities = D.FACILITIES.reduce((a, f) => a + g2.facilities[f.key] * 12, 0);
    // パワーユニットの供給料。1戦ぶんを週あたりにならす
    const engine = g2.engine ? Math.round(g2.engine.fee / raceWeek(0)) : 0;
    const other = 150;
    const raw = staff + mgrs + drivers + youth + facilities + engine + other;
    // ロジスティクス責任者は運営全体の費用を下げる
    // ロジスティクス責任者に加えて、オーナーの商才も運営費を下げる
    const cut = Math.min(0.45, mgr(g2, 'logistics') * 0.010 + osk(g2, 'money') * 0.03);
    // 難易度で、同じ陣容でも維持にかかる金が変わる
    const weekly = Math.round(raw * (1 - cut) * (diffOf(g2).upkeep || 1));

    // 1戦あたりのスポンサー収入（注目度・マーケ室・プリンシパル・難易度込み）
    const diff = diffOf(g2);
    const boost = hypeBonus(g2) * (1 + mgr(g2, 'principal') * 0.006);
    const scale = (1 + g2.facilities.market * 0.07) * boost * diff.sponsor
                * (1 + osk(g2, 'money') * 0.06);   // 商才
    const ts = titleOf(g2);
    const perRace = Math.round((g2.sponsors.reduce((a, sp) => a + (sp.per || 0), 0)
                                + (ts ? ts.per : 0)) * scale);
    const merch = fanIncome(g2);           // グッズ・入場料
    const rpRace = Math.round((g2.sponsors.reduce((a, sp) => a + (sp.rp || 0), 0)
                               + (ts ? ts.rp : 0)) * scale);

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
      reserve: null,        // リザーブドライバー（1人）
      title: null,          // タイトルスポンサー（冠）
      capSpent: 0,          // 今季ここまでの開発・設備への支出
      designEdge: 0,        // グリッドで得た設計のヒント（次の設計で効く）
      yardDone: [],         // 今週すでに声をかけた相手
      debrief: 0,           // レースの次の週だけ、反省会ができる
      lastRace: null,       // 直前のレースの要点（反省会で使う）
      capPenalty: false,    // 前季に予算上限を超えたか
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
      logi: { plan: 'std', load: 'std', crew: 0, late: false },  // 輸送手段・積荷・クルーの疲労
      focus: 'now',         // 開発リソースの配分
      nextCar: 0,           // 来季マシンに積み上げた開発量
      lastRank: 0,          // 前年のコンストラクターズ順位（風洞時間の傾斜に使う）
      pu: { used: 1, life: 100, grid: 0, over: 0 },   // パワーユニットの基数と残り
      equipped: {}, inventory: [], facilities: {}, staff: [], drivers: [], sponsors: [],
      techs: {},            // 開発で積み上げた技術（タグ）
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
  /* いまの段位と、次の段位まであとどれだけか */
  function staffRank(st) {
    const sk = (st && st.skill) || 0;
    let r = D.STAFF_RANKS[0];
    D.STAFF_RANKS.forEach(x => { if (sk >= x.at) r = x; });
    return r;
  }
  function nextStaffRank(st) {
    const cur = staffRank(st);
    const i = D.STAFF_RANKS.indexOf(cur);
    const nx = D.STAFF_RANKS[i + 1];
    if (!nx) return null;
    // 伸びしろが届かない人は、そこまで行けない
    return { rank: nx, need: Math.max(0, nx.at - (st.skill || 0)),
             reachable: staffCap(st) >= nx.at };
  }
  /* 「シニアメカニック」のような肩書き */
  function staffTitle(st) {
    const t = D.STAFF_TYPES.find(x => x.key === st.type) || { name: '' };
    return staffRank(st).prefix + t.name;
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
    const trainer = trainPower(g2);
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
  /* =======================================================
     リザーブドライバー
     万一のときに走る控え。事故で負傷した正ドライバーの代役になり、
     育成の出口にもなる。走らないぶん給料は安い。
     ======================================================= */
  const RESERVE_PAY = 0.45;        // 正ドライバーに対する給料の割合

  function setReserve(g2, d) {
    if (!d) return null;
    d.isReserve = true;
    d.isYouth = false;
    d.team = g2.team;
    d.salary = Math.round(((d.speed + d.technique + d.stamina + d.mental) / 4 * 0.95 + 18) * RESERVE_PAY);
    g2.reserve = d;
    return d;
  }
  function clearReserve(g2) { const d = g2.reserve; g2.reserve = null; return d; }
  /* 空いているシートにリザーブを座らせる（正ドライバーへの昇格）。
     控えのままでは伸びしろを使いきれないので、席が空いたら上げられる */
  function promoteReserve(g2) {
    const r = g2.reserve;
    if (!r || (g2.drivers || []).length >= 2) return null;
    g2.reserve = null;
    r.isReserve = false;
    r.isYouth = false;
    r.team = g2.team;
    r.salary = Math.round((r.speed + r.technique + r.stamina + r.mental) / 4 * 0.95 + 18);
    g2.drivers.push(r);
    return r;
  }
  /* 正ドライバーと入れ替える */
  function swapReserve(g2, driverId) {
    const i = (g2.drivers || []).findIndex(x => x.id === driverId);
    const r = g2.reserve;
    if (i < 0 || !r) return null;
    const out = g2.drivers[i];
    out.isReserve = true;
    out.salary = Math.round(((out.speed + out.technique + out.stamina + out.mental) / 4 * 0.95 + 18) * RESERVE_PAY);
    r.isReserve = false;
    r.salary = Math.round((r.speed + r.technique + r.stamina + r.mental) / 4 * 0.95 + 18);
    g2.drivers[i] = r;
    g2.reserve = out;
    return { inD: r, outD: out };
  }
  /* 負傷。クラッシュでのリタイアのときだけ起こる */
  function injureDriver(g2, d, races) {
    d.outFor = Math.max(d.outFor || 0, races);
    return d.outFor;
  }
  /* 欠場のカウントを1戦ぶん進める */
  function tickInjuries(g2) {
    const back = [];
    (g2.drivers || []).concat(g2.reserve ? [g2.reserve] : []).forEach(d => {
      if (d.outFor > 0) { d.outFor--; if (d.outFor === 0) back.push(d); }
    });
    return back;
  }
  /* レース週の朝に、体調を崩して走れなくなることがある。
     リザーブを置いておく理由のひとつ                                   */
  function rollAbsence(g2) {
    const out = [];
    (g2.drivers || []).forEach(d => {
      if (!canDrive(d)) return;
      // 体力のあるドライバーほど休まない
      if (Math.random() < 0.030 * (1 - d.stamina / 320)) {
        d.outFor = 1;
        out.push(d);
      }
    });
    return out;
  }

  /* 今週そのドライバーは走れるか */
  const canDrive = d => !d || !(d.outFor > 0);

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
      // 同じ職種にチーフがいると、その下は育ちが早い
      const chiefs = g.staff.filter(s => s !== st && s.type === st.type &&
                                    staffRank(s).key === 'chief').length;
      const off = rnd(26, 44) * (1 + mentors * 0.14 + chiefs * D.STAFF_CHIEF_MENTOR)
                * (stTrait(st, 'grower') ? 1.35 : 1);
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
    // 負傷しているドライバーはリザーブが代わりに走る。
    // 代役がいなければ、痛みを押して出走することになる
    let usedReserve = false;
    if (g.reserve) g.reserve.standIn = false;
    const lineup = (g.drivers || []).map(d => {
      if (canDrive(d)) { d.hurt = false; return d; }
      if (!usedReserve && g.reserve && canDrive(g.reserve)) {
        usedReserve = true;
        g.reserve.standIn = true;
        return g.reserve;
      }
      d.hurt = true;
      return d;
    });
    const me = {
      name: teamLabel(g), color: g.color, isPlayer: true, char: machineChar(mine),
      stats: mine, car: carScoreOf(mine, track), rel: reliability(g),
      points: g.points, drivers: lineup
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
    const rows = [{ name: teamLabel(g), color: g.color, points: g.points, isPlayer: true }]
      .concat(g.rivals.map(r => ({ name: r.name, color: r.color, points: r.points, isPlayer: false })));
    rows.sort((a, b) => b.points - a.points);
    return rows;
  }

  /* ---------- ドライバーズ順位表 ---------- */
  function driverTable(g) {
    let rows = [];
    g.drivers.forEach(d => rows.push({ name: d.name, team: teamLabel(g), color: g.color, points: d.seasonPoints, isPlayer: true }));
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
      if (!g.logi) g.logi = { plan: 'std', load: 'std', crew: 0 };
      if (!g.logi.load) g.logi.load = 'std';
      if (!g.pu) g.pu = { used: 1, life: 100, grid: 0, over: 0, n: 1, pool: [] };
      if (!g.pu.pool) g.pu.pool = [];
      if (!g.pu.n) g.pu.n = g.pu.used || 1;
      if (g.reserve === undefined) g.reserve = null;
      if (g.capSpent == null) g.capSpent = 0;
      // 個体に付いていた追加効果は、チームの技術（レベル1）に読み替える
      if (!g.techs) {
        g.techs = {};
        const soak = q => (q && q.traits || []).forEach(k => {
          if (!D.PART_TRAITS.filter(t => t.key === k).length) return;
          g.techs[k] = g.techs[k] || { lv: 0, p: 0 };
          if (g.techs[k].lv < 1) g.techs[k].lv = 1;
        });
        D.PART_CATS.forEach(c => soak(g.equipped && g.equipped[c.key]));
        (g.inventory || []).forEach(soak);
      }
      D.PART_CATS.forEach(c => {
        const q = g.equipped && g.equipped[c.key];
        if (q && q.polish == null) q.polish = 0;
      });
      (g.inventory || []).forEach(q => { if (q.polish == null) q.polish = 0; });
      // あとから増えたパーツ区分は、いまのマシン世代の下限で作っておく
      if (g.equipped) {
        D.PART_CATS.forEach(c => {
          if (g.equipped[c.key]) return;
          const cap = D.CAR_GENS[Math.min(D.CAR_GENS.length - 1, g.carGen || 0)].cap;
          g.equipped[c.key] = makePart(c.key, g.carGen || 0, 1,
            { power: Math.round(cap * 0.25), cond: 88, traits: [] });
        });
      }
      g.onGrid = false; g.gridOrder = null;   // グリッド散策の途中では再開しない
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
    staffRank, nextStaffRank, staffTitle,
    addStaffExp, addStaffExpAll, retireStaff, stTrait, traitOf, rollStaffTraits,
    promotableRoles, promoteStaff, PROMOTE_MIN,
    makeRivalStaff, poachFee, poachAttempt, keepStaff, loseStaff, makeRivals, developRivals, driverRating, resetNames, growStaff,
    diffOf, potOf, rollPotential, renegotiate, makeYouth, youthSlots, growYouth, promoteYouth,
    costCap, capSpent, capLeft, capRatio, spendCapped, settleCap, devRate, repairBill,
    techLv, techProg, techDef, techList, techStep, techCost, advanceTech, polishStep, polishLeft,
    supplierPower, tickEngine,
    hypeTier, hypeBonus, addHype, perkCut, perkPrice, perkList, sponsorOpen, titleOf, titleOpen, signTitle, teamLabel, tickTitle, atrOf, atrLabel, aduoOf, aduoMul, puLimit, innovFresh, secToScore, innovName, rollBreakthrough, tdFresh, tdRisk, tdDismiss, tdAppeal, tdLoss, tdFee, tdAccept, tdAppealNow, weekStamp, pushNews, pressTopic, championshipStake,
    fanTier, fanIncome, fanExpectation,
    makeOwner, osk, ownerRank, ownerProgress, addFame, learnOwnerSkill,
    REG_EVERY, regulationDue, regulationNext, applyRegulation,
    makeManager, mgr, finances, ersOf, ersFrom,
    puOf, puWear, usePU, nursePU, puReset,
    puTired, puForm, puRelDrop, puPerf, puFreshCost, fitFreshPU, mountPU, puMode, setPuMode, overtakeEase,
    bodyCap, makeBody, bodyStats, bodyVal, bodyRatio, genProgress, genLagging, tryAdvanceGen, GEN_STEP_AT, focusOf, nextCarProgress, nextCarPreview, applyStock,
    logiPlan, logiLoad, logiCost, logiRisk, rollLogi, useSpares, crewPenalty, pitCrew, org, devPower, designPower, pitPower, readPower, trainPower, analystPower, tyreWear, naturalStops, tireCrew, restCrew,
    makePart, partNote, partModel, partStats, partCap, partScore, rollRarity, workshopOf, workshopNext, wearParts, hasT,
    rollSkills, hasSkill, learnableSkills, teachSkill, SKILL_MAX,
    persOf, nationOf, reactToResult, quoteFor,
    setReserve, clearReserve, swapReserve, promoteReserve, injureDriver, tickInjuries, canDrive, rollAbsence, RESERVE_PAY,
    carStats, carScore, carScoreOf, machineChar, reliability, foresightOf, wetSkillOf, tyreSkillOf, staffBonus, weeklyCost,
    newGame, allTeams, constructorTable, driverTable,
    raceWeek, SEASON_WEEKS, PREP_WEEKS,
    save, load, wipe
  };
})();

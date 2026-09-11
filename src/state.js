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
  /* 第3引数は「品質」。1.00 が図面どおりで、
     大きいほど、そのパーツが到達できる上限が高い。
     作った瞬間に決まり、あとから改良しても動かない       */
  function makePart(catKey, gen, quality, opts) {
    opts = opts || {};
    const cat = D.PART_CATS.find(c => c.key === catKey);
    const q = clamp(quality || 1, D.QUAL.min, D.QUAL.max);
    const power = opts.power != null ? opts.power
      : Math.round((10 + gen * 13) * q * rnd(0.94, 1.08) * 10) / 10;
    // 追加効果はチームの技術（📐 開発）が受け持つので、
    // パーツ個体には付かない。運ではなく、積み上げで手に入れる
    const traits = opts.traits ? opts.traits.slice() : [];
    return {
      id: 'p' + (++partSeq) + Math.random().toString(36).slice(2, 6),
      cat: catKey,
      // 型式名の頭に世代の印。保管庫に古い世代が混ざっても一目で分かる
      name: (D.CAR_GENS[Math.min(D.CAR_GENS.length - 1, gen)] || {}).name + ' ' +
            cat.names[Math.min(cat.names.length - 1, gen)],
      gen: gen,
      quality: Math.round(q * 1000) / 1000,   // 作った瞬間に決まる器の大きさ
      mat: opts.mat != null ? opts.mat : 0,   // 何で作ったか（素材の段）
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

  /* ---------- 備品と職場環境 ----------
     g.gear = ['factory:jig', 'pit:rest', ...]。買えば残る          */
  function hasGear(g2, fac, key) {
    return ((g2 && g2.gear) || []).indexOf(fac + ':' + key) >= 0;
  }
  function gearList(g2, fac) {
    return (D.GEAR[fac] || []).map(x => ({
      fac: fac, key: x.key, name: x.name, icon: x.icon, cost: x.cost, need: x.need,
      env: x.env, eff: x.eff, note: x.note,
      price: perkPrice(g2, 'gear:' + fac, x.cost),
      up: Math.round(x.cost * D.UPKEEP.gear * (1 - perkCut(g2, 'up'))),
      owned: hasGear(g2, fac, x.key),
      open: ((g2.facilities && g2.facilities[fac]) || 1) >= x.need
    }));
  }
  function buyGear(g2, fac, key) {
    const x = (D.GEAR[fac] || []).filter(y => y.key === key)[0];
    if (!x || hasGear(g2, fac, key)) return null;
    if (((g2.facilities && g2.facilities[fac]) || 1) < x.need) return null;
    const price = perkPrice(g2, 'gear:' + fac, x.cost);
    if (g2.funds < price) return null;
    g2.funds -= price;
    g2.gear = (g2.gear || []).concat([fac + ':' + key]);
    return x;
  }
  /* 職場環境（働きやすさ）。備品の env を足したもの */
  function envScore(g2) {
    let n = 0;
    Object.keys(D.GEAR).forEach(fac => {
      D.GEAR[fac].forEach(x => { if (hasGear(g2, fac, x.key)) n += x.env; });
    });
    return n;
  }
  function envTier(g2) {
    const v = envScore(g2);
    let t = D.ENVW.TIERS[0];
    D.ENVW.TIERS.forEach(x => { if (v >= x.at) t = x; });
    return t;
  }

  /* ---------- 事業 ---------- */
  function hasEstate(g2, key) { return ((g2 && g2.estates) || []).indexOf(key) >= 0; }
  function estateList(g2) {
    return D.ESTATES.map(x => Object.assign({}, x, { owned: hasEstate(g2, x.key) }));
  }
  function buyEstate(g2, key) {
    const x = D.ESTATES.filter(y => y.key === key)[0];
    if (!x || hasEstate(g2, key) || g2.funds < x.cost) return null;
    g2.funds -= x.cost;
    g2.estates = (g2.estates || []).concat([key]);
    return x;
  }
  function estateUpkeep(g2) {
    return D.ESTATES.reduce((a, x) => a + (hasEstate(g2, x.key) ? x.upkeep : 0), 0);
  }

  /* ---------- カートレース ----------
     カート場を持っていると開ける、小さな週末。
     若手が実戦を覚え、街の子が見つかることがある。               */
  function kartName() {
    return pick(D.KART.NAMES) + '・' + pick(D.KART.LAST);
  }
  function kartRating(d) {
    // カートは体力よりも、感覚と度胸で決まる
    return d.speed * 0.42 + d.technique * 0.36 + d.mental * 0.22;
  }
  function runKart(g2) {
    const K = D.KART;
    const mine = (g2.youth || []).slice(0, 4);
    const field = [];
    mine.forEach(d => field.push({
      name: d.name, mine: true, youth: d, rate: kartRating(d) * rnd(0.94, 1.06),
      pot: potOf(d).key
    }));
    // 街の子たち。うちの若手と同じくらいの水準で集まってくるが、
    // たまに、どう見ても別物の子が混じっている
    const base = field.length ? field.reduce((a, e) => a + e.rate, 0) / field.length : 40;
    const n = Math.max(4, K.field - field.length);
    for (let i = 0; i < n; i++) {
      const star = Math.random() < 0.18;
      field.push({
        name: kartName(), mine: false, star: star,
        rate: clamp(base * rnd(0.74, 1.16) * (star ? rnd(1.18, 1.38) : 1), 8, 190)
      });
    }
    // 自前のコースなので、うちの子は勝手を知っている
    const home = 1 + 0.05 + (g2.facilities.youth || 1) * 0.014
               + (hasGear(g2, 'youth', 'lab') ? 0.03 : 0)
               + (hasEstate(g2, 'academy') ? 0.04 : 0);
    field.forEach(e => { if (e.mine) e.rate *= home; });

    // 12周ぶんを、ひとまとめに解く
    const log = [];
    field.forEach(e => {
      e.time = K.laps * (46 - e.rate * 0.060) * rnd(0.995, 1.005);
      e.spun = Math.random() < 0.10 * (1 - Math.min(0.7, e.rate / 110));
      if (e.spun) e.time += rnd(3, 8);
    });
    field.sort((a, b) => a.time - b.time);
    field.forEach((e, i) => { e.pos = i + 1; });

    const say = (pool, v) => {
      let t = pick(pool);
      Object.keys(v || {}).forEach(k => { t = t.split('{' + k + '}').join(v[k]); });
      return t;
    };
    log.push(say(K.SAY.start, { A: field[rint(0, 2)].name }));
    const mid = field.filter(e => e.pos >= 2 && e.pos <= 6);
    if (mid.length >= 2) log.push(say(K.SAY.pass, { A: mid[0].name, B: mid[1].name }));
    field.filter(e => e.spun).slice(0, 2).forEach(e => log.push(say(K.SAY.spin, { A: e.name })));
    log.push(say(K.SAY.fast, { A: field[0].name }));
    log.push(say(field[1] ? K.SAY.last : K.SAY.last,
                 { A: field[0].name, B: field[1] ? field[1].name : '' }));
    return { field: field, log: log };
  }
  /* 走り終えたあとの、実りのぶん */
  function kartReward(g2, res) {
    const K = D.KART;
    let prize = 0, fans = 0;
    const grown = [];
    res.field.filter(e => e.mine).forEach(e => {
      prize += K.prize[Math.min(K.prize.length - 1, e.pos - 1)];
      fans += e.pos === 1 ? K.fanWin : Math.round(K.fanRun * (1 - (e.pos - 1) / K.field));
      const mul = (e.pos === 1 ? K.growWin : K.growRun) * potOf(e.youth).growth;
      const d = e.youth;
      ['speed', 'technique', 'mental'].forEach(k => {
        d[k] = clamp(d[k] + rnd(0.6, 1.8) * mul * (1 - d[k] / 300), 1, 199);
      });
      d.exp += Math.round(6 * mul);
      d.trained++;
      grown.push({ name: d.name, pos: e.pos });
    });
    // 街の子。速かった子には、声をかけられる
    const star = res.field.filter(e => !e.mine && e.star && e.pos <= 3)[0];
    let found = null;
    if (star && Math.random() < K.scout + (res.field[0] && res.field[0].mine ? 0.20 : 0)) {
      found = makeYouth(g2.season);
      found.name = star.name;
      found.age = Math.min(found.age, 17);
    }
    g2.funds += prize;
    g2.fans = Math.max(120, g2.fans + fans);
    return { prize: prize, fans: fans, grown: grown, found: found };
  }

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
  /* =======================================================
     研究 → 開発 → 改良
     いきなり図面は引けない。まず「そもそも何が効くのか」を探す。
     部位ごとにテーマを持ち、溜まりきると「知見」がひとつ生まれる。
     知見は次の開発（または改良）1回に乗り、伸びもレアリティも大きくなる。
     ======================================================= */
  function researchPower(g2) {
    const R2 = D.RESEARCH;
    const o = org(g2);
    return (R2.step
          + (o.dept.researcher || 0) * R2.per
          + analystPower(g2) * R2.analyst)
         * (1 + (g2.facilities.tunnel || 1) * R2.tunnel)
         * (hasEstate(g2, 'lab') ? R2.lab : 1)
         // 路面が動く試験台。止まった床では出なかった数字が出る
         * (hasGear(g2, 'tunnel', 'rolling') ? 1.14 : 1)
         * rigMul(g2, 'tunnel')
         * devRate(g2);
  }
  function researchOf(g2, key) {
    g2.research = g2.research || {};
    if (!g2.research[key]) g2.research[key] = { p: 0, found: 0 };
    return g2.research[key];
  }
  /* 1週ぶん研究を進める。目盛りが埋まると知見がひとつ増える */
  function advanceResearch(g2, key) {
    const r = researchOf(g2, key);
    const gain = researchPower(g2);
    r.p += gain;
    let found = 0;
    while (r.p >= D.RESEARCH.need && r.found < D.RESEARCH.keep) {
      r.p -= D.RESEARCH.need; r.found++; found++;
    }
    if (r.found >= D.RESEARCH.keep) r.p = Math.min(r.p, D.RESEARCH.need - 1);
    return { gain: Math.round(gain * 10) / 10, found: found, have: r.found,
             p: Math.round(r.p), need: D.RESEARCH.need };
  }
  /* 開発・改良のときに知見をひとつ使う。使えたら true */
  function useFinding(g2, key) {
    const r = researchOf(g2, key);
    if (r.found <= 0) return false;
    r.found--;
    return true;
  }
  function findingsOf(g2, key) { return researchOf(g2, key).found; }
  /* ---------- コンセプトの線を押し広げる ----------
     方針に逆らう向きは、上限そのものが 58% までしか無い。
     それが「方針からは外れない」の実体で、
     いくら改良しても、その線より先へは行けなかった。

     研究は、その線を外へ押していく仕事にする。
     扇ひとつぶんの知見を積んで使うと、
     その扇の逆らう向きの上限が、少しずつ上がる。
     「ストレート重視なのに曲がる車も欲しい」を、時間と金で解く道   */
  function groupOfBody(key) {
    const gr = D.PART_GROUPS.filter(x => (x.body || []).indexOf(key) >= 0)[0];
    return gr ? gr.key : null;
  }
  function capLiftOf(g2, key) {
    const gk = groupOfBody(key);
    if (!gk) return 0;
    return clamp((g2.capLift && g2.capLift[gk]) || 0, 0, D.RESEARCH.liftMax);
  }
  /* 知見をひとつ使って、その扇の線を押し広げる */
  function liftConcept(g2, gk) {
    g2.capLift = g2.capLift || {};
    const now = clamp(g2.capLift[gk] || 0, 0, D.RESEARCH.liftMax);
    if (now >= D.RESEARCH.liftMax) return null;
    if (!useFinding(g2, gk)) return null;
    g2.capLift[gk] = Math.min(D.RESEARCH.liftMax, now + D.RESEARCH.lift);
    return { from: now, to: g2.capLift[gk] };
  }
  /* その扇のいまの上限（満点に対する割合）。逆らう向きだけの話 */
  function offCapOf(g2, gk) {
    const lift = clamp((g2.capLift && g2.capLift[gk]) || 0, 0, D.RESEARCH.liftMax);
    return Math.min(1, D.CONCEPT.offCap + lift);
  }

  /* 画面用。扇ごとの進み具合と、いま押さえつけられている項目を並べる */
  function researchList(g2) {
    return D.PART_GROUPS.map(gr => {
      const r = researchOf(g2, gr.key);
      // この扇のうち、方針に逆らっていて上限が下がっている項目
      const held = (gr.body || []).filter(k => conceptDir(g2, k) < 0)
        .map(k => (D.BODY_ATTRS.filter(x => x.key === k)[0] || { key: k, name: k, icon: '❓' }));
      return { key: gr.key, name: gr.name, icon: gr.icon, color: gr.color, note: gr.note,
               p: r.p, found: r.found, need: D.RESEARCH.need,
               held: held,
               off: offCapOf(g2, gr.key),
               next: Math.min(1, offCapOf(g2, gr.key) + D.RESEARCH.lift),
               full: ((g2.capLift && g2.capLift[gr.key]) || 0) >= D.RESEARCH.liftMax,
               pct: Math.min(100, Math.round(r.p / D.RESEARCH.need * 100)) };
    });
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

  /* パーツの品質（古いセーブにはレアリティしか無い） */
  function qualOf(p) {
    if (!p) return 1;
    if (p.quality != null) return p.quality;
    // 旧レアリティ 1〜5 を、そのまま器の大きさとして読み替える
    const OLD = [1.00, 1.11, 1.22, 1.34, 1.48];
    return OLD[clamp((p.rarity || 1) - 1, 0, 4)];
  }

  /* 改良の上限（マシン世代 × そのパーツの品質） */
  function partCap(g, p) {
    return Math.round(D.CAR_GENS[g.carGen].cap * qualOf(p));
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

  /* ---------- 設備の世代 ----------
     ファクトリーの工作機械と同じ考えかたを、ほかの施設にも通す。
     建物のレベルがその段に届くと、中の機械そのものが入れ替わる  */
  function rigOf(g2, key) {
    if (key === 'factory') return workshopOf(g2);
    const def = D.RIGS[key];
    if (!def) return null;
    const lv = (g2.facilities && g2.facilities[key]) || 1;
    let r = def.tiers[0];
    def.tiers.forEach(x => { if (lv >= x.at) r = x; });
    return r;
  }
  function rigNext(g2, key) {
    if (key === 'factory') return workshopNext(g2);
    const def = D.RIGS[key];
    if (!def) return null;
    const lv = (g2.facilities && g2.facilities[key]) || 1;
    return def.tiers.filter(x => x.at > lv)[0] || null;
  }
  /* その施設がいちばん得意にしている仕事にかかる倍率 */
  function rigMul(g2, key) {
    const r = rigOf(g2, key);
    if (!r) return 1;
    return r.mul != null ? r.mul : (r.prec != null ? r.prec : 1);
  }
  function rigTiers(key) {
    return key === 'factory' ? D.WORKSHOP : ((D.RIGS[key] || {}).tiers || []);
  }

  /* 設計時のレアリティ抽選（デザイナーの腕と、工作機械の世代で上振れする） */
  /* ---------- 品質を引く ----------
     底は素材が決める。そこに工作機械の世代と設計陣の腕が乗り、
     最後に運の幅がつく。だから同じ図面でも、出来上がりは毎回ちがう。
     底が上がっているほど、外れを引いてもそこそこのものになる */
  function rollQuality(g, catKey) {
    const Q = D.QUAL;
    const m = D.MATERIALS[matOf(g, groupOfPart(catKey))] || D.MATERIALS[0];
    const dz = designPower(g) + (g.designEdge || 0) * 1.4;
    const base = m.mid
               + workshopOf(g).rar * Q.rig
               + dz * Q.eng
               // 塵ひとつない部屋で組むと、同じ図面でも出来が揃う
               + (hasGear(g, 'factory', 'clean') ? 0.05 : 0);
    // 運。上振れのほうがわずかに長い尻尾を持たせてある
    const luck = rnd(-Q.spread * 0.9, Q.spread * 1.1);
    return clamp(Math.round((base + luck) * 1000) / 1000, Q.min, Q.max);
  }
  /* 絵柄の描き分けに使う 1〜5。品質をその段に丸める */
  function qualStars(q) {
    const L = D.QUALITY;
    let n = 1;
    L.forEach((x, i) => { if (q >= x.at) n = i + 1; });
    return n;
  }
  /* 品質の呼び名（並・良品・上物…） */
  function qualTier(q) {
    const L = D.QUALITY;
    let t = L[0];
    L.forEach(x => { if (q >= x.at) t = x; });
    return t;
  }

  /* ---------- 扇（グループ）と素材 ---------- */
  function groupOfPart(catKey) {
    const gr = D.PART_GROUPS.filter(x => x.parts.indexOf(catKey) >= 0)[0];
    return gr ? gr.key : D.PART_GROUPS[0].key;
  }
  function matOf(g2, groupKey) {
    return clamp(Math.round(((g2 && g2.mat) || {})[groupKey] || 0),
                 0, D.MATERIALS.length - 1);
  }
  function matDef(g2, groupKey) { return D.MATERIALS[matOf(g2, groupKey)]; }
  function matNext(g2, groupKey) {
    const n = matOf(g2, groupKey);
    return n + 1 < D.MATERIALS.length ? D.MATERIALS[n + 1] : null;
  }
  function matPoints(g2, groupKey) {
    return Math.round(((g2 && g2.matP) || {})[groupKey] || 0);
  }
  /* パーツを作る／煮詰めるたびに、その扇へ貯まる。
     作った経験がそのまま「次の素材を扱えるかどうか」になる */
  function addMatPoint(g2, catKey, n) {
    if (!g2.matP) g2.matP = {};
    const k = groupOfPart(catKey);
    g2.matP[k] = (g2.matP[k] || 0) + n;
  }
  /* 素材を一段上げる。足りていれば true */
  function matUp(g2, groupKey) {
    const nx = matNext(g2, groupKey);
    if (!nx || matPoints(g2, groupKey) < nx.cost) return null;
    if (!g2.mat) g2.mat = {};
    g2.matP[groupKey] -= nx.cost;
    g2.mat[groupKey] = matOf(g2, groupKey) + 1;
    return nx;
  }

  /* ---------- インテグレート（扇の中） ----------
     その扇の作り込み（剛性・軽量化…）が、上限に対してどこまで来ているか。
     7つの属性はそのまま中身として残るが、
     画面と言葉のうえでは扇ごとに1本にまとめる                   */
  function integrateOf(g2, groupKey) {
    const gr = D.PART_GROUPS.filter(x => x.key === groupKey)[0];
    if (!gr) return 0;
    let sum = 0, cap = 0;
    gr.body.forEach(k => {
      sum += (g2.body && g2.body[k]) || 0;
      cap += Math.max(1, bodyCapOf(g2, k));
    });
    return cap ? clamp(sum / cap, 0, 1) : 0;
  }
  /* 旧名。まだ呼んでいるところが残っていないか見張るために残す */
  function rollRarity(g) {
    return rollQuality(g, 'aero');
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
    const pot = opts.pot || rollPotential(opts.youth);
    const pers = opts.pers || pick(D.PERSONALITIES).key;
    /* 荒さ（-1 = 丁寧, +1 = 荒い）。荒いほど速いが、そのぶん壊す。
       素質が高い者ほど、この取引をしないで済む（速くて壊さない）  */
    const wild = rnd(-1, 1);
    const trade = 1 - (pot - 1) * 0.20;          // ★1=1.0 … ★5=0.2
    const lift = (pot - 1) * 3.5;                // 素質のぶんは、速さにも丁寧さにも乗る
    const persCare = (D.PERSONALITIES.find(x => x.key === pers) || {}).care || 0;
    const d = {
      id: 'd' + Math.random().toString(36).slice(2, 9),
      name: opts.name || freshName(),
      age: opts.age || rint(19, 34),
      speed: sp(base + wild * 8 * trade + lift * 0.5),
      technique: sp(base), stamina: sp(base), mental: sp(base),
      // 安定感。速さと引き換えになる、その人の性質。練習では上がらない
      care: clamp(Math.round(base - wild * 15 * trade + lift + persCare + rnd(-7, 7)), 5, 190),
      exp: 0, expLv: 1,
      form: 100,             // コンディション 60-120
      salary: 0,
      seasonPoints: 0, wins: 0, podiums: 0, races: 0,
      poles: 0, fastestLaps: 0, dnfs: 0, best: 99,
      nation: opts.nation || rint(0, D.NATIONS.length - 1),
      pot: pot,
      pers: pers,
      face: rint(0, 999999),          // 顔の見た目を決める種
      skills: opts.skills || rollSkills(level)
    };
    d.salary = Math.round((d.speed + d.technique + d.stamina + d.mental) / 4 * 0.95
                          + careOf(d) * 0.10 + 18);
    /* ---- 持参金つき ----
       腕で席を取る人ばかりではない。金を持ってくる人がいる。
       速さは足りないが、契約した日に金が入り、毎戦も入ってくる    */
    if (opts.paid) {
      const P2 = D.PAID;
      const bk = opts.backer || pick(P2.BACKERS);
      ['speed', 'technique', 'stamina', 'mental'].forEach(k => {
        d[k] = clamp(Math.round(d[k] * P2.skill), 5, 190);
      });
      d.paid = {
        key: bk.key, icon: bk.icon, name: bk.name, line: bk.line, rank: bk.rank,
        dowry: Math.round(P2.dowryBase + bk.rank * P2.dowryPer * (1 + level * 0.12)),
        per: Math.round(P2.perBase + bk.rank * P2.perPer * (1 + level * 0.10))
      };
      d.salary = Math.round(d.salary * P2.salaryCut);
    }
    return d;
  }
  /* 持参金つきのドライバーが、いま毎戦いくら持ってきているか */
  function paidIncome(g2) {
    return (g2.drivers || []).reduce((a, d) => a + ((d.paid && d.paid.per) || 0), 0);
  }
  function isPaid(d) { return !!(d && d.paid); }

  /* ---------- 安定感 ----------
     クラッシュとミスの起きやすさを決める、その人の「まとめる力」。
     鉄の心臓と精密機械は、そのまま安定感として現れる     */
  function careOf(d) {
    if (!d) return 100;
    let v = d.care != null ? d.care : 100;
    if (hasSkill(d, 'heart')) v += 22;
    if (hasSkill(d, 'precise')) v += 14;
    if (d.hurt) v -= 18;
    return clamp(v, 5, 199);
  }
  function careTier(d) {
    const v = careOf(d);
    return D.CARE_TIERS.filter(x => v <= x.max)[0] || D.CARE_TIERS[D.CARE_TIERS.length - 1];
  }
  /* 100 を等倍として、クラッシュ／ミスが何倍になるか */
  function careCrashMul(d) { return clamp(1 + (100 - careOf(d)) / 100 * D.CARE_CRASH, 0.22, 2.2); }
  function careMissMul(d)  { return clamp(1 + (100 - careOf(d)) / 100 * D.CARE_MISS,  0.45, 1.7); }

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
  /* ---------- 機構の噛み合い ----------
     部位どうしの組み合わせ。弱いほうの仕上がりで効き目が決まるので、
     一点に注ぎ込むより、噛み合う相手ごと育てたほうが速くなる。     */
  function mechScore(g2, m) {
    if (m.p) {
      const p = g2.equipped[m.p];
      return p ? clamp(p.power / Math.max(1, partCap(g2, p)), 0, 1.2) : 0;
    }
    return bodyRatio(g2, m.b);
  }
  function mechName(m) {
    if (m.p) { const c = D.PART_CATS.find(x => x.key === m.p); return c ? c : { name: m.p, icon: '?', color: '#888' }; }
    const b = D.BODY_ATTRS.find(x => x.key === m.b); return b ? b : { name: m.b, icon: '?', color: '#888' };
  }
  function mechSynergy(g2) {
    return D.MECH_SYNERGY.map(sy => {
      const a = mechScore(g2, sy.a), b = mechScore(g2, sy.b);
      const lo = Math.min(a, b);
      // 下限までは、いくら片方を厚くしても噛み合いは生まれない
      const eff = Math.max(0, lo - D.MECH_FLOOR);
      const v = sy.gain * (eff / (eff + sy.half));
      return { def: sy, aScore: a, bScore: b, low: lo, gain: v,
               // 効きの割合（満点に対して）
               ratio: v / sy.gain,
               on: v >= sy.gain * 0.22,
               weak: a <= b ? sy.a : sy.b };
    });
  }
  /* ---------- パッケージング ----------
     固まりと固まりのつなぎ目。
     その橋になっている噛み合いが、そのまま「まとまり」になる。
     細い橋は、ドライバーがいちばん先に気づくところ            */
  function packaging(g2) {
    const syn = mechSynergy(g2);
    const kk = m => (m.p ? 'p:' + m.p : 'b:' + m.b);
    return D.PACKAGING.map(p => {
      const want = [kk(p.via.a), kk(p.via.b)].sort().join('|');
      const x = syn.filter(y => [kk(y.def.a), kk(y.def.b)].sort().join('|') === want)[0];
      const r = x ? x.ratio : 0;
      return { def: p, syn: x, ratio: r,
               thin: r < D.PACK.thin, good: r >= D.PACK.good,
               weak: x ? x.weak : null };
    });
  }
  /* いちばん細い橋。ドライバーの言い分は、まずここから出る */
  function packWorst(g2) {
    const list = packaging(g2).slice().sort((a, b) => a.ratio - b.ratio);
    return list[0] || null;
  }
  /* 車全体のまとまり（0..1）。橋の平均 */
  function packScore(g2) {
    const list = packaging(g2);
    if (!list.length) return 0;
    return list.reduce((a, x) => a + x.ratio, 0) / list.length;
  }

  /* 噛み合いの合計。carStats などが見る */
  function mechLift(g2) {
    const out = { speed: 0, corner: 0, accel: 0, wear: 0, rel: 0 };
    mechSynergy(g2).forEach(x => {
      Object.keys(x.def.eff).forEach(k => { out[k] += x.gain * x.def.eff[k]; });
    });
    return out;
  }

  /* ---------- マシン本体（シャシー）の配分 ----------
     車を作るときに一度だけ引く。強い軸と弱い軸ができ、
     そこからその車の性格が決まる。
     コンセプトの向きへ少し引っぱられるが、そのとおりにはならない
     （狙って作っても、出来上がってみないと分からない）        */
  function rollChassis(g2) {
    const C = D.CHASSIS;
    /* conceptOf は定義そのものを返す（キーではない）。
       そして CONCEPTS の lead は扇のキーなので、軸の名前には使えない。
       軸と対応しているのはコンセプトのキーのほう。
       ドライバビリティ重視だけは速さの軸を名指ししていないので、
       どの軸へも引っぱらない                                   */
    const cn = conceptOf(g2);
    const AXOF = { speed: 'speed', corner: 'corner', accel: 'accel' };
    const leadAx = cn ? AXOF[cn.key] : null;
    /* 開発責任者とコンセプトの相性。
       得意な人に任せれば狙った向きへ素直に出るし、
       不得意な人だと、狙いが乗らないうえに、でこぼこの車になる */
    const fit = mgrFit(g2, 'technical');
    const lean = C.lean * (1 + fit * C.fitLean);
    const tilt = C.tilt * (1 - fit * C.fitTilt);
    const AX = ['speed', 'corner', 'accel'];
    const w = {};
    AX.forEach(k => {
      // コンセプトが名指ししている軸は、そのぶん出やすい
      const pull = (leadAx === k) ? lean : 0;
      w[k] = 1 / 3 + pull + rnd(-tilt, tilt);
    });
    const tot = AX.reduce((a, k) => a + Math.max(0.08, w[k]), 0);
    const out = {};
    AX.forEach(k => { out[k] = Math.round(Math.max(0.08, w[k]) / tot * 1000) / 1000; });
    return out;
  }
  /* いまの本体の配分。古いセーブや作りたてには、その場で引く */
  function chassisOf(g2) {
    if (!g2.chassis || g2.chassis.speed == null) g2.chassis = rollChassis(g2);
    return g2.chassis;
  }

  /* ---------- マシン本体の素の能力 ----------
     パーツを1つも載せ替えなくても、車そのものが持っている速さ。
     世代の器に比例するので、新車を出すとここが跳ね上がる       */
  function chassisStats(g2) {
    const gen = D.CAR_GENS[clamp(g2.carGen || 0, 0, D.CAR_GENS.length - 1)];
    const tot = gen.cap * D.CHASSIS.k;
    const c = chassisOf(g2);
    return { speed: tot * c.speed, corner: tot * c.corner, accel: tot * c.accel };
  }

  /* 本体の性格。いちばん強い軸と、強い軸／弱い軸の開きで決まる */
  function chassisTrait(g2) {
    const c = chassisOf(g2);
    const AX = ['speed', 'corner', 'accel'];
    let hi = AX[0], lo = AX[0];
    AX.forEach(k => { if (c[k] > c[hi]) hi = k; if (c[k] < c[lo]) lo = k; });
    const edge = c[lo] > 0 ? c[hi] / c[lo] : 1;
    let ed = D.CHASSIS_EDGE[0];
    D.CHASSIS_EDGE.forEach(x => { if (edge >= x.at) ed = x; });
    const key = ed === D.CHASSIS_EDGE[0] ? 'even' : hi;
    const def = D.CHASSIS_TRAITS.filter(x => x.key === key)[0] || D.CHASSIS_TRAITS[3];
    return { def: def, hi: hi, lo: lo, edge: edge, edgeName: ed.name };
  }

  /* ---------- パーツをどちらへ振っているか ----------
     本体の強い軸へ積んでいれば補強、弱い軸を埋めていれば是正。
     いま積んでいるパーツの配分と、本体の配分を見比べて決める   */
  function partsLean(g2) {
    const s = { speed: 0, corner: 0, accel: 0 };
    D.PART_CATS.forEach(c => {
      const p = g2.equipped[c.key];
      if (!p) return;
      const ps = partStats(p, g2);
      s.speed += ps.speed; s.corner += ps.corner; s.accel += ps.accel;
    });
    const tot = s.speed + s.corner + s.accel;
    if (tot <= 0) return { speed: 1 / 3, corner: 1 / 3, accel: 1 / 3 };
    return { speed: s.speed / tot, corner: s.corner / tot, accel: s.accel / tot };
  }
  function carDirection(g2) {
    const tr = chassisTrait(g2);
    const pl = partsLean(g2);
    const c = chassisOf(g2);
    // 本体の強い軸／弱い軸を、パーツがどれだけ持ち上げているか
    const up = pl[tr.hi] - c[tr.hi];
    const dn = pl[tr.lo] - c[tr.lo];
    const gap = up - dn;                    // ＋なら尖らせ、−なら埋め
    const key = gap > 0.045 ? 'boost' : gap < -0.045 ? 'fix' : 'flat';
    const def = D.CAR_DIRS.filter(x => x.key === key)[0];
    return { def: def, gap: gap, hi: tr.hi, lo: tr.lo, trait: tr };
  }

  /* 部位どうしの噛み合いが、満点に対してどこまで来ているか（0..1） */
  function meshScore(g2) {
    const list = mechSynergy(g2);
    if (!list.length) return 0;
    return clamp(list.reduce((a, x) => a + x.ratio, 0) / list.length, 0, 1);
  }

  /* ---------- インテグレート率 ----------
     ばらばらの部品と本体を、1台の車としてどれだけ引き出せているか。
     掛け算なので、ここが薄いと何を積んでも出てこない          */
  function integrateRate(g2) {
    const I = D.INTEG;
    const inner = D.PART_GROUPS.reduce((a, gr) => a + integrateOf(g2, gr.key), 0)
                / Math.max(1, D.PART_GROUPS.length);
    const bridge = packScore(g2);
    const mesh = meshScore(g2);
    const w = I.inner + I.bridge + I.mesh;
    const r = (inner * I.inner + bridge * I.bridge + mesh * I.mesh) / w;
    return { rate: I.floor + (1 - I.floor) * clamp(r, 0, 1),
             inner: inner, bridge: bridge, mesh: mesh, raw: clamp(r, 0, 1) };
  }

  /* ---------- 車の速さ ----------
       （マシン本体の素の能力 ＋ パーツの合計） × インテグレート率
     足し算でも掛け算でもなく、この順番であることに意味がある。
     良い部品を集めるだけでは速くならず、
     まとめ上げてはじめて、持っているものが出てくる            */
  function carStats(g) {
    const s = { speed: 0, corner: 0, accel: 0 };
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) return;
      const ps = partStats(p, g);
      // 傷んだパーツは本来の性能を出しきれない。
      // パワーユニットだけは、同じ数字を puForm 側で見ているので二重にかけない
      const f = (c.key === 'pu' ? puForm(g) : (0.82 + p.cond / 100 * 0.18));
      s.speed += ps.speed * f;
      s.corner += ps.corner * f;
      s.accel += ps.accel * f;
    });
    // マシン本体の素の能力
    const ch = chassisStats(g);
    s.speed += ch.speed; s.corner += ch.corner; s.accel += ch.accel;
    /* 作り込みが向きを作る。剛性はコーナーへ、軽量化は直線と加速へ。
       ここは配分の話なので、掛け算の前に足しておく             */
    const bs = bodyStats(g);
    s.speed += bs.speed; s.corner += bs.corner; s.accel += bs.accel;
    /* ---- 偏りの増幅 ----
       まとめ上げた車ほど、その車らしさが際立つ。
       まとまっていない車は、良いところも悪いところも出てこない。
       合計は動かさず、配分だけを伸び縮みさせる               */
    const it = integrateRate(g).rate;
    const amp = 1 + D.AMP.k * (it - D.AMP.mid);
    const mean = (s.speed + s.corner + s.accel) / 3;
    s.speed = Math.max(0, mean + (s.speed - mean) * amp);
    s.corner = Math.max(0, mean + (s.corner - mean) * amp);
    s.accel = Math.max(0, mean + (s.accel - mean) * amp);
    // ここまでが「持っているもの」。どれだけ引き出せるかを掛ける
    s.speed *= it; s.corner *= it; s.accel *= it;
    return s;
  }

  /* =======================================================
     車体（マシン本体）
     ======================================================= */
  /* =======================================================
     マシンコンセプト

     1年を通しての「この車は何で戦うのか」。
     決めた向きはよく伸び、逆らう向きは上限そのものが下がる。
     いくら時間と金をかけても、コンセプトの外までは行けない。
     ここが「大きな方針からは外れない」の実体。

     変えられるのは、オフのあいだと、
     車を作り直したとき（＝世代が上がった直後）だけ。
     途中でどうしても変えたければ、バージョンアップで作り直す。
     ======================================================= */
  function conceptOf(g2) {
    return D.CONCEPTS.find(c => c.key === (g2 && g2.plan)) || null;
  }
  /* いま選び直せるか。オフか、車を作り直した直後 */
  function conceptOpen(g2) {
    if (!g2) return false;
    if (!conceptOf(g2)) return true;              // まだ決めていないなら、いつでも
    if (g2.offseason) return true;
    return (g2.planGen != null && g2.planGen !== g2.carGen);
  }
  /* 決めたときに控えておく。次にどこで選び直せるかの判定に使う */
  function setConcept(g2, key) {
    if (!D.CONCEPTS.some(c => c.key === key)) return null;
    g2.plan = key;
    g2.planGen = g2.carGen;
    return conceptOf(g2);
  }
  /* その作り込みが、コンセプトに対してどちら向きか。
     +1 沿っている ／ -1 逆らっている ／ 0 どちらでもない */
  function conceptDir(g2, key) {
    const c = conceptOf(g2);
    if (!c) return 0;
    if (c.up.indexOf(key) >= 0) return 1;
    if (c.down.indexOf(key) >= 0) return -1;
    return 0;
  }
  /* 作り込み1項目ぶんの上限。逆らう向きはここが下がる。
     研究で線を押し広げたぶんだけ、下がりかたが浅くなる     */
  function bodyCapOf(g2, key) {
    const d = conceptDir(g2, key);
    if (d >= 0) return bodyCap(g2);
    return Math.round(bodyCap(g2) * Math.min(1, D.CONCEPT.offCap + capLiftOf(g2, key)));
  }
  /* 作り込みの伸びかたの倍率 */
  function conceptMul(g2, key) {
    const d = conceptDir(g2, key);
    return d > 0 ? D.CONCEPT.onMul : d < 0 ? D.CONCEPT.offMul : 1;
  }
  /* 部品の伸びかたの倍率。
     部品は上限までは削らない（そこが主な伸びしろなので）。
     方針に合う部品は速く、合わない部品は遅く進むだけ           */
  function conceptPartMul(g2, key) {
    const c = conceptOf(g2);
    if (!c) return 1;
    if ((c.pUp || []).indexOf(key) >= 0) return D.CONCEPT.onMul;
    if ((c.pDown || []).indexOf(key) >= 0) return D.CONCEPT.offMul;
    return 1;
  }

  /* ---------- 首脳陣の相性 ----------
     人には得意な作り方と、そうでない作り方がある。
     コンセプトと噛み合えば設計が冴え、噛み合わなければ精彩を欠く */
  function mgrFit(g2, role) {
    const m = g2 && g2.managers && g2.managers[role];
    const c = conceptOf(g2);
    if (!m || !c) return 0;
    if (m.good === c.key) return 1;
    if (m.bad === c.key) return -1;
    return 0;
  }
  /* ---------- 基本設計能力値 ----------
     コンセプトを図面に落とし込む力。
     もとになるのは人事の噛み合わせ（設計と開発の部門の力）で、
     そこに開発責任者の相性が掛かる。
     設計の段でいちばん効くのは、この人の得意・不得意          */
  function designBase(g2) {
    const o = org(g2);
    const K = D.CONCEPT;
    const raw = o.dept.designer * K.mixDesign + o.dept.engineer * K.mixEngineer;
    const f = mgrFit(g2, 'technical');
    const fit = 1 + (f > 0 ? K.fitUp : 0) - (f < 0 ? K.fitDown : 0);
    return { raw: raw, fit: fit, fitDir: f, value: raw * fit };
  }
  /* 設計したパーツの出来に、そのまま乗る倍率。

     まず人事の噛み合わせで「上積みの余地」が決まり（頭打ちのある形）、
     そこに開発責任者の相性が掛かる。
     部門が薄いうちは誰が来ても大差なく、
     厚くなるほど、責任者が誰かで出来が変わるようになる         */
  function designMul(g2) {
    const K = D.CONCEPT;
    const b = designBase(g2);
    const room = K.designMax * (b.raw / (b.raw + K.designHalf));
    return 1 + room * b.fit;
  }

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
    /* 新造した車は、前の車とは別の性格になる。
       狙って作っても、出来上がってみないと分からない  */
    g2.chassis = rollChassis(g2);
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
    // 割る相手はその項目の上限。コンセプトに逆らう項目は、
    // 満点まで行けないことがそのまま割合に出る
    const cap = bodyCapOf(g2, key);
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
    const w = D.PART_CATS.map(c => (1 + ((dir && c.gain && c.gain[dir]) || 0) * 1.8)
                                   * conceptPartMul(g2, c.key));
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
    const bw = D.BODY_ATTRS.map(a => (1 + ((dir && a.gain && a.gain[dir]) || 0) * 1.8)
                                     * conceptMul(g2, a.key));
    const bSum = bw.reduce((a, b) => a + b, 0);
    D.BODY_ATTRS.forEach((a, i) => {
      const add = toBody * (bw[i] / bSum);
      const before = g2.body[a.key] || 0;
      // コンセプトに逆らう項目は、上限そのものが低い
      g2.body[a.key] = Math.round(Math.min(bodyCapOf(g2, a.key), before + add) * 10) / 10;
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
      g2.owner.sp += (after - before) * D.FAME.spPerRank;
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

  /* いま規則の何年目か（0＝変わったばかり、REG_EVERY-1＝最終年）。
     難易度によっては、途中の年から始まることがある            */
  function regSince(g2) {
    return ((g2.season || 1) - 1 + (g2.regFrom || 0)) % REG_EVERY;
  }

  function regulationDue(g2) {
    return g2.season > 1 && regSince(g2) === 0;
  }

  /* 今季が終わったら規則が変わるか（＝いま作っているマシンが白紙になる年か） */
  function regulationNext(g2) {
    return regSince(g2) === REG_EVERY - 1;
  }

  function applyRegulation(g2) {
    g2.reg = (g2.reg || 0) + 1;
    // 新しい規則を、どこが読み切るか。ここで引き直す
    rollEraFit(g2);
    // ---- 保管していたパーツは「遺産」になる ----
    // 旧規則のまま走らせることはできないが、そこに詰まっている知見は残る。
    // ばらして解析すれば研究の材料になり、良いものを持っていたチームは
    // 新しい規則でも良いところから始められる
    const legacy = { count: 0, rp: 0, power: 0, up: [] };
    const bestQ = {};
    (g2.inventory || []).forEach(p => {
      legacy.count++;
      legacy.power += p.power;
      bestQ[p.cat] = Math.max(bestQ[p.cat] || 0, qualOf(p));
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
      // 手元にあったいちばん良い品質は引き継ぎ、性能だけが白紙に戻る。
      // 開発で得た技術（タグ）と、扇ごとの素材も、そのまま残る
      const oq = qualOf(old2);
      const q2 = Math.max(oq, bestQ[c.key] || 0);
      if (old2 && q2 > oq + 0.001) {
        legacy.up.push({ cat: c.name, from: oq, to: q2 });
      }
      g2.equipped[c.key] = makePart(c.key, 0, q2,
        { power: 10 + carry + spare, mat: matOf(g2, groupOfPart(c.key)) });
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
      /* 世代0の車で、その年に見合った水準。makeRivals と同じ物差し。
         規則が変わった年だけ水準が飛ばないよう、ここも通す        */
      const d2 = diffOf(g2);
      /* オーナーが替わって手に入れた地力は、規則が変わっても失われない。
         白紙に戻るのはマシンであって、金と人ではない            */
      const pw2 = r.pw != null ? r.pw : power;
      const base = rivalLevel(pw2, g2.season, 0, d2.rivalPower, d2.rivalGrow, d2.tight || 0);
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
    const since = regSince(g2);
    return D.INNOV.fresh[Math.min(D.INNOV.fresh.length - 1, since)];
  }
  /* 1周あたり何秒ぶんの発見か → マシン性能で何点ぶんか に直す */
  function secToScore(g2, sec) {
    const t = trackAt(g2, g2.nextRace);
    return sec / (t.base * 0.00092 * 0.60);
  }
  function innovName() { return pick(D.INNOV.NAMES); }

  /* ---------- ひらめきを抱える ----------
     掘り当てたものは、その場で速さに化けるわけではない。
     形にして、車に載せてはじめて効く。
     抱えたまま放っておくと、よそが先に持ち込んで古びる        */
  function ideaList(g2) {
    g2.ideas = (g2.ideas || []).filter(x => weekStamp(g2) - (x.at || 0) < D.IDEA.life);
    return g2.ideas;
  }
  function addIdea(g2, name, catKey) {
    const list = ideaList(g2);
    if (list.length >= D.IDEA.keep) list.shift();      // 古いものから忘れる
    const it = { id: 'i' + Math.random().toString(36).slice(2, 8),
                 name: name, cat: catKey, at: weekStamp(g2) };
    list.push(it);
    g2.ideas = list;
    return it;
  }
  function ideaOf(g2, id) { return ideaList(g2).filter(x => x.id === id)[0] || null; }
  function useIdea(g2, id) {
    const before = ideaList(g2).length;
    g2.ideas = ideaList(g2).filter(x => x.id !== id);
    return g2.ideas.length < before;
  }
  /* ひらめきが古びるまで、あと何週か */
  function ideaLeft(g2, it) {
    return Math.max(0, D.IDEA.life - (weekStamp(g2) - (it.at || 0)));
  }
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

  /* =======================================================
     トレンド（真似）
     誰かが掘り当てた解釈は、隠しておけない。写真に撮られ、
     風洞で再現され、数戦のうちにグリッドの半分が同じ形になる。
     真似るほうが速いが、本家の写しでしかないので届ききらない。
     ======================================================= */
  function setTrend(g2, by, what, mul, mine, sec) {
    g2.trend = {
      by: by, what: what, mul: mul, mine: !!mine,
      // 本家が何秒ぶん速くなったのか。写したチームの伸びはここから割り出す
      sec: sec != null ? Math.round(sec * 100) / 100 : null,
      at: g2.week || 0, season: g2.season || 1,
      copied: [], playerCopied: false
    };
    pushNews(g2, 'trend', what, { by: by });
  }
  /* 写したチームが縮めた秒数。本家の伸びに、写しの届き具合を掛ける。
     本家の秒数を持っていない（古いデータの）ときは分からないままにする */
  function copiedSec(t, ratio) {
    return t.sec == null ? null : Math.round(t.sec * ratio * 100) / 100;
  }
  function trendOf(g2) {
    const t = g2.trend;
    if (!t) return null;
    const age = (g2.week || 0) - t.at + ((g2.season || 1) - t.season) * 40;
    if (age > D.TREND.life) return null;
    return { t: t, age: age };
  }
  /* いま真似られるか（プレイヤー用）。本家でも、すでに写したあとでもない */
  function canCopyTrend(g2) {
    const cur = trendOf(g2);
    if (!cur) return null;
    if (cur.t.mine || cur.t.playerCopied) return null;
    // 首位のチームが本家なら、動き出せるようになるのが1週早い
    const top = topRival(g2);
    const early = D.TREND.startWeek - ((top && cur.t.by === top.name) ? D.TREND.topEarly : 0);
    if (cur.age < early) return { t: cur.t, age: cur.age, tooEarly: true, need: early - cur.age };
    return cur;
  }
  /* うちの解釈を、よそに写させる。写す側は近くを走っているチームから選ぶ */
  function letRivalCopy(g2, ratio) {
    const cur = trendOf(g2);
    if (!cur || !cur.t.mine) return null;
    const pool = (g2.rivals || []).filter(r => cur.t.copied.indexOf(r.name) < 0);
    if (!pool.length) return null;
    // 近い順位のチームほど、うちを見ている
    const tbl = constructorTable(g2);
    const myPos = tbl.findIndex(r => r.isPlayer);
    const posOf = nm => { const i = tbl.findIndex(r => r.name === nm); return i < 0 ? 99 : i; };
    pool.sort((a, b) => Math.abs(posOf(a.name) - myPos) - Math.abs(posOf(b.name) - myPos));
    const r = pool[Math.min(pool.length - 1, rint(0, 2))];
    const rt = (ratio == null ? D.TREND.copyOf : ratio);
    const gain = (cur.t.mul - 1) * rt;
    ['speed', 'corner', 'accel'].forEach(k => { r.stats[k] *= 1 + gain; });
    cur.t.copied.push(r.name);
    g2.innovLog = (g2.innovLog || []).concat([{
      team: r.name, color: r.color, what: cur.t.what, copyOf: teamLabel(g2),
      sec: copiedSec(cur.t, rt), mine: false
    }]);
    return { team: r.name, what: cur.t.what, gain: gain };
  }

  /* いま選手権を引っ張っているチーム（プレイヤー以外） */
  function topRival(g2) {
    const tbl = constructorTable(g2).filter(r => !r.isPlayer);
    return tbl.length ? tbl[0] : null;
  }
  /* 真似で届く割合。設計陣が厚いほど写しの精度が上がり、遅れるほど落ちる。
     首位のチームが本家なら、写真も記事も多いぶん読み解きやすい     */
  function copyRatio(g2, age, by) {
    const T = D.TREND;
    const top = topRival(g2);
    const isTop = by && top && by === top.name;
    return clamp(T.playerOf * (1 + designPower(g2) * 0.020) + (isTop ? T.topBonus : 0)
               - Math.max(0, age - T.startWeek) * T.lateFade, 0.30, 1.15);
  }

  /* ---------- 首位のマシンを写す ----------
     ブレイクスルーが出ていなくても、いちばん速い車はそこにある。
     写真を撮り、風洞で起こし、うちの車に載せる。
     差が大きいほど埋められるが、そのぶん高くつく               */
  function leadCopy(g2) {
    const L = D.TREND.lead;
    const top = topRival(g2);
    if (!top) return null;
    const t = trackAt(g2, g2.nextRace);
    const mine = carScore(g2, t);
    const theirs = carScoreOf((g2.rivals || []).filter(r => r.name === top.name)[0]
      ? (g2.rivals || []).filter(r => r.name === top.name)[0].stats : { speed: 0, corner: 0, accel: 0 }, t);
    const gap = theirs - mine;
    const cool = Math.max(0, (g2.leadCopyAt || -99) + L.cool - (weekStamp(g2)));
    const ratio = clamp(L.of * (1 + designPower(g2) * 0.020), 0.15, 0.60);
    const gain = gap <= 0 ? 0 : Math.min(L.cap, gap * ratio / Math.max(1, mine));
    return {
      team: top.name, gap: Math.round(gap * 10) / 10, gain: gain,
      cost: Math.round(L.cost + Math.max(0, gap) * L.costGap),
      rp: L.rp, cool: cool, ratio: ratio,
      ok: gap > 0.5 && cool <= 0
    };
  }
  function doLeadCopy(g2) {
    const c = leadCopy(g2);
    if (!c || !c.ok) return null;
    D.PART_CATS.forEach(cat => {
      if (cat.key === 'pu' && (g2.equipped.pu || {}).supplied) return;
      const p = g2.equipped[cat.key];
      if (p) p.power = Math.round(p.power * (1 + c.gain) * 10) / 10;
    });
    g2.leadCopyAt = weekStamp(g2);
    g2.concepts = (g2.concepts || []).concat([{
      cat: 'aero', what: c.team + 'のマシンの写し', copied: true,
      gain: c.gain, at: weekStamp(g2)
    }]);
    return c;
  }
  /* プレイヤーが持ち込む。掘り当てたときと同じだけの伸びが、写したぶん乗る */
  function copyTrend(g2) {
    const cur = canCopyTrend(g2);
    if (!cur || cur.tooEarly) return null;
    const T = D.TREND;
    const ratio = copyRatio(g2, cur.age, cur.t.by);
    const gain = (cur.t.mul - 1) * ratio;
    // 車体そのものではなく、装着しているパーツの性能に乗せる
    const cats = D.PART_CATS.filter(c => !(c.key === 'pu' && (g2.equipped.pu || {}).supplied));
    cats.forEach(c => {
      const p = g2.equipped[c.key];
      if (p) p.power = Math.round(p.power * (1 + gain) * 10) / 10;
    });
    cur.t.playerCopied = true;
    // 灰色の解釈を持ち込むと、裁定の対象になりやすくなる
    g2.concepts = (g2.concepts || []).concat([{
      cat: 'aero', what: cur.t.what + '（' + cur.t.by + 'の解釈）',
      copied: true, gain: gain, at: weekStamp(g2)
    }]);
    return { what: cur.t.what, by: cur.t.by, ratio: ratio, gain: gain };
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
    const left = Math.max(0, D.RACES - (g2.nextRace || 0));
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

  /* ---------- 規則を読めたかどうか ----------
     新しい規則の1年目は、当たり外れが大きい。
     同じ金をかけても、読めたチームは飛び出し、外したチームは沈む。
     年を追うごとに、みなが同じ答えへ寄っていくので差は縮む。
     どの規則でどのチームが当たるかは、規則が変わるたびに引き直す  */
  function rollEraFit(g2) {
    /* 一様に引くと「読み切った」と「外した」ばかりになる。
       3回引いて平均をとり、真ん中に寄せる。
       飛び抜けるチームも沈むチームも、いるにはいる、くらいに   */
    const bell = () => (rnd(-1, 1) + rnd(-1, 1) + rnd(-1, 1)) / 3;
    (g2.rivals || []).forEach(r => { r.eraRoll = bell(); });
  }
  function eraFitOf(g2, r) {
    const sp = D.RIVAL_DEV.eraSpread;
    const since = Math.min(sp.length - 1, regSince(g2));
    return 1 + (r.eraRoll || 0) * sp[since];
  }
  /* 画面用。いまその規則をどれだけ読めているか */
  function eraReadOf(g2, r) {
    const v = eraFitOf(g2, r);
    return v >= 1.14 ? { name: '読み切っている', icon: '🔥', color: '#e04a3f' }
         : v >= 1.05 ? { name: '掴んでいる',     icon: '📈', color: '#f0a020' }
         : v >= 0.95 ? { name: 'ふつう',         icon: '⚖️', color: '#a89878' }
         : v >= 0.86 ? { name: '手探り',         icon: '🌫️', color: '#7ecbf0' }
                     : { name: '外している',     icon: '🧊', color: '#3a7ad9' };
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
      // 横並びの年は、伸びかたの差も潰しておく（放っておくとまた開く）
      const own = r.pw != null ? r.pw
                : ((D.RIVALS.find(x => x.name === r.name) || { power: 1 }).power);
      const power = 1 + (own - 1) * (1 - (diff.tight || 0));
      // 1週あたりの伸び。season が進むほど全体の水準も上がる。
      // 掃引して決めた値。これより速いとプレイヤーが永久に追いつけず、
      // 遅いとシーズン半ばで一方的になる。
      const atr = D.ATR[Math.min(D.ATR.length - 1, (rivalRank[r.name] || 6) - 1)];
      // 一強状態なら、離されたチームには是正措置ぶんが上乗せされる
      const relief = aduoMul(g2, rivalRank[r.name] || 6, ad);
      /* 資金力（地力）の効きを、はっきり出す。
         そのうえで、規則を読めたかどうかを掛ける             */
      const RD = D.RIVAL_DEV;
      const money = Math.pow(power, RD.moneyK);
      /* 器が6倍になれば、1週の伸びも6倍でないと話にならない。
         足し算のままだと、高い世代では何もしていないのと同じになる */
      const capMul = D.CAR_GENS[Math.min(D.CAR_GENS.length - 1, g2.carGen || 0)].cap
                   / D.CAR_GENS[0].cap;
      const step = (RD.floor + money * RD.byMoney) * eraFitOf(g2, r)
                 * (diff.rivalGrow || 1) * atr * relief * capMul
                 * (1 + g2.season * 0.04);
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
        const ref = trackAt(g2, g2.nextRace);
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
        setTrend(g2, r.name, what, mul, false, sec);
      }
    });
    /* ---- 真似が広がる ----
       トレンドが立つと、他所はそれを写しにかかる。
       真似るほうが速いが、本家の写しでしかないので届ききらない。
       遅れて写すほど、届く量も落ちる                              */
    {
      const cur = trendOf(g2);
      if (cur && cur.age >= D.TREND.startWeek) {
        const T = D.TREND;
        (g2.rivals || []).forEach(r => {
          if (r.name === cur.t.by || cur.t.copied.indexOf(r.name) >= 0) return;
          const power = (D.RIVALS.find(x => x.name === r.name) || { power: 1 }).power;
          if (Math.random() > T.week * (0.6 + power * 0.8)) return;
          const ratio = clamp(T.copyOf - (cur.age - T.startWeek) * T.lateFade, 0.30, 1);
          const gain = (cur.t.mul - 1) * ratio;
          ['speed', 'corner', 'accel'].forEach(k => { r.stats[k] *= 1 + gain; });
          cur.t.copied.push(r.name);
          g2.innovLog = (g2.innovLog || []).concat([{
            team: r.name, color: r.color, what: cur.t.what,
            copyOf: cur.t.by, sec: copiedSec(cur.t, ratio), mine: false
          }]);
        });
        // 真似られたぶん、本家の優位は薄れていく
        if (cur.t.mine && cur.t.copied.length) {
          // プレイヤーが本家のときは、相対的に追いつかれるだけ（数字は動かさない）
        }
      }
    }
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
    // 裁く側に元うちの人間がいるかどうか。こっそり庇うことも、厳しく見ることもある
    if (shielded) r *= 1 - fiaFavor(g2) * D.FIA.tdRisk;
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
               + osk(g2, 'fame') * D.TD.dismissFame
               + fiaFavor(g2) * D.FIA.dismiss, 0, D.TD.dismissMax);
  }
  /* 提訴が通る確率。交渉と技術の裏づけ、両方が要る */
  function tdAppeal(g2) {
    return clamp(D.TD.appealBase + osk(g2, 'nego') * D.TD.appealNego
               + osk(g2, 'eye') * D.TD.appealEye
               + analystPower(g2) * D.TD.appealAnalyst
               + fiaFavor(g2) * D.FIA.appeal, D.TD.appealMin, D.TD.appealMax);
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
          // 格を1段落とす代わりに、器そのものを削る
          if (c.rarUp) p.quality = Math.max(D.QUAL.min, qualOf(p) - 0.11);
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
    return clamp(0.20 + readPower(g2) * 0.075 + osk(g2, 'call') * 0.06
               + (hasGear(g2, 'sim', 'eye') ? 0.04 : 0)
               + (hasGear(g2, 'sim', 'twin') ? 0.06 : 0)
               + (hasGear(g2, 'mission', 'radar') ? 0.05 : 0)
               + crewEff(g2).fore
               + kitEff(g2, 'weather', 'fore'), 0.10, 0.92);
  }
  /* =======================================================
     気温と路面温度

     路面はいつも気温より高い。日が照れば一気に上がり、
     雨なら冷える。レースが進めば日が傾いて下がり、
     ゴムが乗ったぶんだけ、わずかに上がる。
     ======================================================= */
  function airTemp(track, wx, roll) {
    const T = D.TEMP;
    const h = track && track.heat != null ? track.heat : 0.5;
    return T.airLo + (T.airHi - T.airLo) * h
         + (roll == null ? 0 : roll) * T.swing
         + (wx && wx.key === 'rain' ? T.rain * 0.5 : 0)
         + (wx && wx.key === 'storm' ? T.storm * 0.5 : 0);
  }
  /* 路面温度。prog は 0（スタート）〜1（チェッカー）、rub は乗ったゴム 0..1 */
  function roadTemp(track, wx, roll, prog, rub) {
    const T = D.TEMP;
    const key = (wx && wx.key) || 'cloud';
    const up = key === 'sunny' ? T.sun : key === 'cloud' ? T.cloud
             : key === 'rain' ? T.rain : T.storm;
    return airTemp(track, wx, roll) + T.roadBase + up
         - T.fade * clamp(prog || 0, 0, 1)
         + T.rubber * clamp(rub || 0, 0, 1);
  }
  /* その銘柄の作動域。真ん中がいちばん食う */
  function tyreBand(ty) {
    const lo = ty && ty.tLo != null ? ty.tLo : 30;
    const hi = ty && ty.tHi != null ? ty.tHi : 55;
    return { lo: lo, hi: hi, mid: (lo + hi) / 2 };
  }
  /* 作動域からどれだけ外れているか。
     負なら冷えすぎ、正なら熱すぎ、0 なら域の中（単位は℃）   */
  function tyreOff(ty, temp) {
    const b = tyreBand(ty);
    if (temp < b.lo) return temp - b.lo;
    if (temp > b.hi) return temp - b.hi;
    return 0;
  }
  /* 温度の見た目。冷たい青からちょうどの緑、熱い赤まで連続で変える */
  function tempTier(ty, temp) {
    const b = tyreBand(ty), off = tyreOff(ty, temp);
    if (off <= -14) return { key: 'icy',  name: '冷えきっている', icon: '🧊', color: '#4a86d8' };
    if (off < 0)    return { key: 'cold', name: '冷えている',     icon: '❄️', color: '#6aa8e0' };
    if (off >= 14)  return { key: 'melt', name: 'オーバーヒート', icon: '🔥', color: '#e0442a' };
    if (off > 0)    return { key: 'hot',  name: '熱を持っている', icon: '♨️', color: '#e08a2a' };
    // 域の中。真ん中に近いほど良い
    const d = Math.abs(temp - b.mid) / Math.max(1, (b.hi - b.lo) / 2);
    return d < 0.45
      ? { key: 'peak', name: 'ど真ん中', icon: '🎯', color: '#2e8b30' }
      : { key: 'ok',   name: '作動域',   icon: '🟢', color: '#4ea63f' };
  }
  /* いま履いている銘柄は、この路面温度に合っているか（0..1、1が最良）。
     金曜の見立てと、週末の画面で使う                          */
  function tyreTempFit(ty, road) {
    const off = Math.abs(tyreOff(ty, road));
    return clamp(1 - off / 22, 0, 1);
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

  /* ---------- マシン信頼性（0-100）----------
     素の値は、装着しているパーツの傷み具合そのもの。
     チームの強み（冷却技術・剛性・ピット設備・クルーの腕）は、
     そこに足し算で積むのではなく「壊れる余地」を削るかたちで効く。
     足し算だと、設備を伸ばした時点で 99% に貼りついてしまい、
     どれだけパーツがくたびれていても数字が動かなくなる         */
  function relCare(g) {
    return techLv(g, 'cool') * techDef('cool').per + techLv(g, 'tough') * 0.8
         + bodyRatio(g, 'rigidity') * 9 + bodyRatio(g, 'cooling') * 7
         + bodyRatio(g, 'service') * 6
         + g.facilities.pit * 2.5 + pitPower(g) * 1.4
         + (g.engine ? D.ENGINE.relBonus : 0)
         + (g.puLearn || 0)
         - crewPenalty(g).rel - puRelDrop(g);
  }
  /* 強みが「危うさ」を何割潰せるか。34 でちょうど半分、最大 86% */
  function relCut(g) {
    const care = Math.max(0, relCare(g));
    // 部位どうしの噛み合いも、そのまま壊れにくさになる
    return clamp(care / (care + 34) + mechLift(g).rel, 0, 0.88);
  }
  function partCondAvg(g) {
    let sum = 0, n = 0;
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      sum += p ? p.cond : 40; n++;
    });
    return sum / Math.max(1, n);
  }
  function reliability(g) {
    const avg = partCondAvg(g);
    return clamp(100 - (100 - avg) * (1 - relCut(g)), 5, 99);
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
  /* 遠征の編成。誰を現地へ連れて行くか */
  function logiCrew(g2) {
    const k = (g2.logi && g2.logi.party) || 'std';
    return D.LOGI_CREWS.filter(c => c.key === k)[0] || D.LOGI_CREWS[1];
  }
  /* 本国のミッションコントロール。施設のレベルがそのまま支援の厚み */
  function missionLv(g2) {
    return Math.max(0, (g2.facilities && g2.facilities.mission) || 0)
         * rigMul(g2, 'mission');
  }
  function hasMission(g2) { return missionLv(g2) > 0; }
  /* 遠征の編成が、現場の力にどれだけ効いているか。
     人を減らして薄くなったぶんは、ミッションコントロールが埋め戻す */
  function crewEff(g2) {
    const c = logiCrew(g2);
    const M = D.MISSION;
    const lv = missionLv(g2);
    // 本国に入れた道具のぶん
    const gearRead = (hasGear(g2, 'mission', 'wall2') ? 0.35 : 0)
                   + (hasGear(g2, 'mission', 'twin') ? 0.55 : 0);
    const gearFore = hasGear(g2, 'mission', 'twin') ? 0.06 : 0;
    const cover = clamp(lv > 0 ? M.coverBase + lv * M.coverLv : 0, 0, 0.92);
    // 薄くなったぶん（マイナス）は本国からの支援で戻る。厚くしたぶんはそのまま
    const fix = v => v < 0 ? v * (1 - cover) : v;
    return {
      pit:  fix(c.pit),
      read: fix(c.read) + lv * M.read + (lv > 0 ? gearRead : 0),
      fore: fix(c.fore) + lv * M.fore + (lv > 0 ? gearFore : 0),
      fatigue: c.fatigue + (c.key === 'lean' ? lv * M.fatigue : 0)
                         + depotLv(g2) * D.DEPOT.fatigue
                         + (hasGear(g2, 'depot', 'crate') ? -2 : 0),
      mission: lv > 0, missionLv: lv, cover: cover
    };
  }
  /* 遠征チーム。荷造りが速くなり、輸送費も遅延も減る */
  function depotLv(g2) {
    return Math.max(0, (g2.facilities && g2.facilities.depot) || 0)
         * rigMul(g2, 'depot');
  }
  /* 現地での支度の進み。遠征チームが厚いほど、着いた翌朝から動ける */
  function depotSetup(g2) {
    // 置きっぱなしの箱があると、着いた日から動ける
    return (1 + depotLv(g2) * D.DEPOT.setup) * (hasGear(g2, 'depot', 'hub') ? 1.025 : 1);
  }
  function depotCut(g2) {
    return clamp(depotLv(g2) * D.DEPOT.cut + (hasGear(g2, 'depot', 'crate') ? 0.08 : 0), 0, 0.55);
  }
  /* 1戦ぶんの輸送費。遠いコースほど高く、積むほど高い */
  function logiCost(g2, track) {
    const far = (track && track.far) || 1;
    const cut = Math.min(0.45, mgr(g2, 'logistics') * 0.012 + osk(g2, 'money') * 0.03
                             + logiPower(g2) * 0.020);
    return perkPrice(g2, 'logi',
      Math.round(D.LOGI_BASE * far * logiPlan(g2).cost * logiLoad(g2).cost
                 * logiCrew(g2).cost * (1 - cut) * (1 - depotCut(g2))));
  }
  /* 荷が遅れる確率。遠いコースほど、そして安く運ぶほど高い。
     ロジスティクス責任者がいると、通関も現地手配も段取りよく進む     */
  function logiRisk(g2, track) {
    const far = (track && track.far) || 1;
    const base = logiPlan(g2).delay + logiLoad(g2).delay;
    if (base <= 0) return 0;
    const soft = 1 - Math.min(0.85, mgr(g2, 'logistics') * 0.020 + osk(g2, 'money') * 0.02
                                 + logiPower(g2) * 0.030
                                 + Math.min(0.55, depotLv(g2) * D.DEPOT.delay)
                                 + (hasGear(g2, 'depot', 'rack') ? 0.20 : 0)
                                 // 置きっぱなしの箱があると、通関でも止まりにくい
                                 + (hasGear(g2, 'depot', 'hub') ? 0.20 : 0));
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
        if (p && c.key !== 'pu') p.cond = clamp(p.cond - D.LOGI_DELAY_COND, 5, 100);
      });
      g2.logi.crew = clamp(crew(g2) + D.LOGI_DELAY_FATIGUE, 0, 100);
    }
    return late;
  }
  /* レース後、持ってきた予備で機材を手当てする。
     軽装で来た週は、これができない                                  */
  function useSpares(g2) {
    // 倉庫が育つと、同じ積み荷でももう1点よけいに手当てできる
    const n = logiLoad(g2).spares + (depotLv(g2) >= D.DEPOT.spareAt ? 1 : 0);
    if (n <= 0) return null;
    const list = D.PART_CATS.map(c => g2.equipped[c.key])
      .filter((p, i) => p && p.cond < 72 && D.PART_CATS[i].key !== 'pu')
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
  /* ---------- トラックサイド装備 ----------
     g.kit = { weather: 2, radio: 1, ... }。0 が初期の一段目        */
  function kitLv(g2, key) { return (g2 && g2.kit && g2.kit[key]) || 0; }
  function kitOf(g2, key) {
    const K = D.RACEKIT.filter(x => x.key === key)[0];
    if (!K) return null;
    const lv = Math.min(K.tiers.length - 1, kitLv(g2, key));
    return { def: K, lv: lv, tier: K.tiers[lv], next: K.tiers[lv + 1] || null,
             max: lv >= K.tiers.length - 1 };
  }
  function kitEff(g2, key, field) {
    const k = kitOf(g2, key);
    return (k && k.tier.eff && k.tier.eff[field]) || 0;
  }
  function kitList(g2) { return D.RACEKIT.map(K => kitOf(g2, K.key)); }
  function buyKit(g2, key) {
    const k = kitOf(g2, key);
    if (!k || !k.next) return null;
    const price = perkPrice(g2, 'kit:' + key, k.next.cost);
    if (g2.funds < price) return null;
    g2.funds -= price;
    g2.kit = g2.kit || {};
    g2.kit[key] = k.lv + 1;
    return k.next;
  }
  /* 次の段に上げるときの、割引後の値段と、そのあとの維持費 */
  function kitPrice(g2, key) {
    const k = kitOf(g2, key);
    if (!k || !k.next) return null;
    return { price: perkPrice(g2, 'kit:' + key, k.next.cost),
             list: k.next.cost,
             up: Math.round(k.next.cost * D.UPKEEP.kit * (1 - perkCut(g2, 'up'))) };
  }

  /* ---------- グループ ----------
     職種ごとの一覧ではなく、実際に仕事をしている単位で見る。
     人の組み合わせで、中が噛み合ったり軋んだりする。               */
  function groupOf(g2, key) {
    const G = D.GROUPS.filter(x => x.key === key)[0];
    if (!G) return null;
    const mem = (g2.staff || []).filter(s => s.type === G.of);
    const raw = staffBonus(g2, G.of);
    const F = D.FRICTION;
    const notes = [];
    let mul = 1;
    // ⭐が2人以上。主役が2人いると、どちらも本気を出せない
    const nm = list => list.map(s => s.name).join('・');
    const starList = mem.filter(s => stTrait(s, 'star'));
    const stars = starList.length;
    if (stars >= 2) { mul += F.starClash; notes.push({ bad: true, icon: '⚡',
      who: nm(starList), why: '⭐名うて が' + stars + '人', amt: F.starClash,
      text: nm(starList) + ' が主役同士でぶつかり、どちらも本気を出せていない' }); }
    // まとめる人がいない
    const chiefs = mem.filter(s => staffRank(s).key === 'chief').length;
    if (mem.length >= 4 && !chiefs) { mul += F.noChief; notes.push({ bad: true, icon: '🧭',
      who: nm(mem), why: mem.length + '人／チーフ 0人', amt: F.noChief,
      text: mem.length + '人いるのに、まとめる人（チーフ）がいない' }); }
    // 指導者がいる
    const mentors = mem.filter(s => stTrait(s, 'mentor'));
    if (mentors.length) { mul += F.mentorLift; notes.push({ bad: false, icon: '🎓',
      who: nm(mentors), why: '🎓指導者', amt: F.mentorLift,
      text: nm(mentors) + ' が指導役。下が育ち、判断も速い' }); }
    // ベテランと若手が混ざっている
    if (mem.length >= 2) {
      const sorted = mem.slice().sort((a, b) => b.skill - a.skill);
      const top = sorted[0], low = sorted[sorted.length - 1];
      if (top.skill - low.skill >= F.mixGap) {
        mul += F.mixLift;
        notes.push({ bad: false, icon: '🤲',
          who: top.name + ' → ' + low.name,
          why: '技能差 ' + Math.round(top.skill - low.skill), amt: F.mixLift,
          text: top.name + '（技能 ' + Math.round(top.skill) + '）が ' +
                low.name + '（技能 ' + Math.round(low.skill) + '）に渡せている' });
      }
    }
    // 1人に寄りかかっている
    if (mem.length === 1 && mem[0].skill >= 45) { mul += F.soloRisk; notes.push({ bad: true, icon: '🪑',
      who: mem[0].name, why: 'ひとりだけ', amt: F.soloRisk,
      text: mem[0].name + ' ひとりに寄りかかっている。抜けたら止まる' }); }
    return { key: key, def: G, members: mem, raw: raw, mul: Math.max(0.5, mul),
             score: raw * Math.max(0.5, mul), chiefs: chiefs, notes: notes };
  }
  /* 相補作用。両方が育っているグループの組み合わせだけ効く */
  function synergyList(g2, scores) {
    return D.SYNERGY.map(sy => {
      const lo = Math.min(scores[sy.a] || 0, scores[sy.b] || 0);
      const v = sy.gain * (lo / (lo + sy.half));
      return { def: sy, a: sy.a, b: sy.b, low: lo, gain: v,
               on: v >= sy.gain * 0.18 };
    });
  }
  /* 全グループぶんの一覧（画面と org() の両方で使う） */
  function groupTable(g2) {
    const list = D.GROUPS.map(G => groupOf(g2, G.key));
    const scores = {};
    list.forEach(x => { scores[x.key] = x.score; });
    const syn = synergyList(g2, scores);
    // 相補作用は、関わっている両方のグループに乗る
    const lift = {};
    D.GROUPS.forEach(G => { lift[G.key] = 0; });
    syn.forEach(x => { lift[x.a] += x.gain; lift[x.b] += x.gain; });
    list.forEach(x => { x.lift = lift[x.key]; x.total = x.score * (1 + lift[x.key]); });
    return { list: list, byKey: (k) => list.filter(x => x.key === k)[0],
             syn: syn, scores: scores };
  }

  /* ---------- ドライバーが、どれだけ引き出せているか ----------
     持っている力そのものではなく、それが車に出ているかどうか。
     レースで実際に掛けている数字（乗りやすさと調子）をそのまま返す */
  /* ---------- 引き出し率 ----------
     車が持っている力のうち、その人が何割を出せるか。
     race.js がラップを出すのに使うのと同じ式。
     画面の「◯% 引き出せています」も、ここを通す        */
  function driverOut(rating, d) {
    const O = D.DRIVER_OUT;
    const pot = Math.max(0, Math.min(O.over.length - 1, (d && d.pot) || 0));
    // 腕は 100% まで。素質ぶんは、腕が伴ってはじめて乗る
    const k = Math.min(1, Math.max(0, rating) / O.ref);
    return Math.min(O.max, O.floor + (1 - O.floor) * k + O.over[pot] * k);
  }
  function driverFit(g2, d) {
    const drive = 1 + (bodyRatio(g2, 'drive') - RIVAL_BODY_REF) * 0.20;
    const form = (d.form || 100) / 100;
    // 調子は driverRating の中にすでに入っている。二重にかけない
    const out = driverOut(driverRating(d), d) * drive;
    return { drive: drive, form: form, out: out,
             // 車の持ち分を超えているか（素質の高い人だけが届く）
             over: out > 1.0 };
  }

  function org(g2) {
    const raw = {}, dept = {}, lead = {};
    // グループの中の噛み合いと、グループ同士の相補作用を通した値を使う
    const gt = groupTable(g2);
    const byType = {};
    gt.list.forEach(x => { byType[x.def.of] = x; });
    D.STAFF_TYPES.forEach(t => {
      const gx = byType[t.key];
      raw[t.key] = gx ? gx.total : staffBonus(g2, t.key);
    });
    D.MANAGERS.forEach(m => { lead[m.key] = 1 + mgr(g2, m.key) * D.ORG.lead; });
    D.STAFF_TYPES.forEach(t => {
      const boss = D.ORG.DEPT[t.key] || 'principal';
      dept[t.key] = raw[t.key] * lead[boss];
    });
    const data = dept.analyst / (dept.analyst + D.ORG.dataHalf);
    return {
      raw: raw, dept: dept, lead: lead, groups: gt,
      data: data,
      dataMul: 1 + data * D.ORG.dataGain,
      ready: 1 - (1 - D.ORG.readyFloor) * (crew(g2) / 100)
    };
  }
  /* 各部門が実際に出している力。式のあちこちはこれを見る */
  function devPower(g2)   { const o = org(g2); return o.dept.engineer * o.dataMul; }
  function designPower(g2){ return org(g2).dept.designer; }
  function pitPower(g2)   { return org(g2).dept.mechanic; }
  function readPower(g2)  { const o = org(g2);
    // 現地のピットウォールと、本国の分析チームを足したもの
    return Math.max(0, (o.dept.strategist + kitEff(g2, 'wall', 'read') + crewEff(g2).read))
           * o.dataMul; }
  function trainPower(g2) { const o = org(g2); return o.dept.trainer * o.dataMul; }
  function analystPower(g2){ return org(g2).dept.analyst; }
  /* 機材を運び、組み、片づける人たちの力 */
  function logiPower(g2)  { return org(g2).dept.logi || 0; }

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
    const skill = Math.max(0, g2.facilities.pit * 0.55 + pitPower(g2) + osk(g2, 'call') * 0.5
                             + crewEff(g2).pit) * rigMul(g2, 'pit');
    const cw = crewPenalty(g2);
    // 軽いホイールガンは、腕とは別に一律で削れる
    const gun = (hasGear(g2, 'pit', 'gun') ? 0.12 : 0)
              + (hasGear(g2, 'pit', 'jack') ? 0.18 : 0)
              + kitEff(g2, 'wall', 'stand');
    const stand = Math.max(D.PIT_STAND_MIN,
      D.PIT_STAND_MIN + (D.PIT_STAND_BASE - D.PIT_STAND_MIN)
      / (1 + skill * D.PIT_STAND_CURVE) + cw.pit - gun);
    const fumble = clamp(D.PIT_FUMBLE_BASE / (1 + skill * 0.20) + cw.mistake * 0.8,
                         D.PIT_FUMBLE_MIN, 0.30);
    return { skill: skill, stand: stand, fumble: fumble };
  }

  /* レースを1戦こなしたぶんの消耗。輸送手段で増減する */
  function tireCrew(g2) {
    if (!g2.logi) g2.logi = { plan: 'std', load: 'std', crew: 0 };
    const soft = 1 - Math.min(0.5, mgr(g2, 'logistics') * 0.010);
    // レースの合間にいくらかは休める。荷が多いほど積み下ろしがこたえる
    // 座って休める場所があるだけで、溜まりかたが変わる
    const rest = (hasGear(g2, 'pit', 'rest') ? 0.85 : 1) * (1 - kitEff(g2, 'home', 'crew'));
    const d = logiPlan(g2).fatigue + logiLoad(g2).fatigue + crewEff(g2).fatigue - 2;
    g2.logi.crew = clamp(crew(g2) + (d > 0 ? d * soft * rest : d), 0, 100);
  }
  /* 休養・オフシーズンでの回復 */
  function restCrew(g2, amount) {
    if (!g2.logi) g2.logi = { plan: 'std', load: 'std', crew: 0 };
    g2.logi.crew = clamp(crew(g2) - amount, 0, 100);
  }

  /* ---------- 予備シャシー ----------
     週末に壊しても、もう1台あれば載せ替えて走れる          */
  function spareOf(g2) { return clamp(Math.round((g2 && g2.spare) || 0), 0, D.SPARE.max); }
  function spareCost(g2) {
    const gen = D.CAR_GENS[clamp((g2 && g2.carGen) || 0, 0, D.CAR_GENS.length - 1)];
    // いちばん安い世代でも、それなりの額にはなる
    return Math.round(Math.max(900, (gen.cost || 3200) * D.SPARE.cost));
  }
  function buySpare(g2) {
    if (spareOf(g2) >= D.SPARE.max) return null;
    const c = spareCost(g2);
    if (g2.funds < c) return null;
    g2.funds -= c;
    g2.spare = spareOf(g2) + 1;
    return { cost: c, now: g2.spare };
  }

  /* ---------- 週末の事故 ----------
     予選が終わった時点で、壊したかどうかを決める。
     コースの危なさ、乗り手の安定感、車の傷みで変わる        */
  function weekendHitOdds(g2, track) {
    const W = D.WEEKEND_HIT;
    const ds = (g2.drivers || []).slice(0, 2);
    if (!ds.length) return 0;
    // 2人のうち、危ういほうに引きずられる
    const care = Math.min.apply(null, ds.map(d => careOf(d)));
    const cond = D.PART_CATS.reduce((a, c) => {
      const p = g2.equipped[c.key];
      return a + (p ? p.cond : 100);
    }, 0) / Math.max(1, D.PART_CATS.length);
    const byCare = W.careHalf / (W.careHalf + Math.max(0, care));
    const byCond = 1 + Math.max(0, 100 - cond) / W.condHalf;
    return clamp(W.base * byCare * byCond * ((track && track.risk) || 1), 0, 0.55);
  }
  function rollWeekendHit(g2, track) {
    if (Math.random() >= weekendHitOdds(g2, track)) return null;
    const ds = (g2.drivers || []).slice(0, 2);
    if (!ds.length) return null;
    // 安定感の低いほうが起こしやすい
    const d = ds.length > 1 && careOf(ds[1]) < careOf(ds[0]) && Math.random() < 0.62 ? ds[1] : ds[0];
    const kind = Math.random() < 0.58
      ? { key: 'crash', icon: '💥', name: 'クラッシュ',
          say: 'コースアウトして、フロントからバリアに当てました' }
      : { key: 'fail', icon: '🛠️', name: '大きな故障',
          say: '走行中に異音。開けてみたら、そのままでは日曜を迎えられません' };
    return { driver: d.name, kind: kind };
  }
  /* 手当てを実行する。三択のどれを選んでも日曜には走れる */
  function applyWeekendFix(g2, key) {
    const f = D.WEEKEND_HIT.fix.filter(x => x.key === key)[0];
    if (!f) return null;
    if (f.spare) {
      if (spareOf(g2) < f.spare) return null;
      g2.spare = spareOf(g2) - f.spare;
    }
    if (!g2.logi) g2.logi = { plan: 'std', load: 'std', crew: 0 };
    g2.logi.crew = clamp(crew(g2) + f.crew, 0, 100);
    D.PART_CATS.forEach(c => {
      const p = g2.equipped[c.key];
      if (p) p.cond = clamp(p.cond + f.cond, 10, 100);
    });
    return f;
  }

  /* ---------- 期待を超えたぶん ----------
     しんどい週末でも、結果が出ればクルーの顔つきは変わる   */
  function crewBoost(g2, beat) {
    if (!(beat > 0)) return 0;
    const v = Math.min(D.CREW_BOOST.max, beat * D.CREW_BOOST.per);
    restCrew(g2, v);
    return Math.round(v * 10) / 10;
  }

  /* ---------- パワーユニットの使用基数と載せ替え ---------- */
  function puOf(g2) {
    if (!g2.pu) g2.pu = { used: 1, life: 100, grid: 0, over: 0, n: 1, pool: [] };
    if (!g2.pu.pool) g2.pu.pool = [];       // 車から降ろして取ってあるユニット
    if (!g2.pu.n) g2.pu.n = g2.pu.used || 1;  // いま載せているユニットの通し番号
    /* 「パーツとしての耐久」と「基の残量」を別々に持つと、同じものの
       傷み具合が二つ並んで食い違う。実体は装着しているPUパーツの cond
       ひとつだけにして、pu.life はその別名にしておく。
       こうすると整備でも事故でも、動く数字はいつも一つになる        */
    const part = g2.equipped && g2.equipped.pu;
    if (part) {
      const d = Object.getOwnPropertyDescriptor(g2.pu, 'life');
      if (!d || !d.get) {
        // 古いセーブは、これまで画面に出ていた残量のほうを正とする
        if (d && typeof d.value === 'number') part.cond = clamp(d.value, 0, 100);
        delete g2.pu.life;
        Object.defineProperty(g2.pu, 'life', {
          configurable: true, enumerable: true,
          get: function () { return g2.equipped.pu ? g2.equipped.pu.cond : 100; },
          set: function (v) { if (g2.equipped.pu) g2.equipped.pu.cond = clamp(v, 0, 100); }
        });
      }
    }
    return g2.pu;
  }
  /* パワーユニットは「基の残量」で語る。ほかのパーツの
     「コンディション」とは戻しかたが違うので、名前も分けておく */
  function condLabel(key) { return key === 'pu' ? '残量' : 'コンディション'; }
  /* ---- パワーユニットの耐久（0〜1）----
     世代を重ねたPUほど、そして熟成させたPUほど、走っても減りにくい。
     開発で伸ばせるのはここで、消耗そのものとへたりの痛みの両方に効く */
  function puDur(g2) {
    const p = (g2.equipped && g2.equipped.pu) || null;
    if (!p) return 0;
    const N = D.PU_NURSE;
    const gen = (p.gen || 0) * N.durGen;
    // 良い品質のPUほど、走っても減りにくい
    const pol = clamp((qualOf(p) - 1) / 0.45, 0, 1) * N.durPol;
    return clamp(gen + pol, 0, 1);
  }
  /* 二度と戻らない摩耗（%）。整備の天井はここで決まる */
  function puHard(g2) {
    const p = (g2.equipped && g2.equipped.pu) || null;
    return p ? clamp(p.worn || 0, 0, 100) : 0;
  }
  /* 整備でどこまで戻せるか（%） */
  function puCeil(g2) { return 100 - puHard(g2); }
  /* へたり具合（0=新品、1=使い切り）。
     残りが PU_TIRED_FROM を割ってから効きはじめる。
     耐久のあるPUは、同じ残量でも痛みかたが小さい                   */
  function puTired(g2) {
    const pu = puOf(g2);
    const raw = clamp((D.PU_TIRED_FROM - pu.life) / D.PU_TIRED_FROM, 0, 1);
    return raw * (1 - D.PU_NURSE.dropCut * puDur(g2));
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
  /* 使い込んだPUが落とす信頼性。残量そのものは全パーツの平均に
     すでに入っているので、ここでは出力モードのぶんだけを見る    */
  function puRelDrop(g2) { return -puMode(g2).rel; }
  /* PUの状態が、そのまま走りの速さに乗る量（性能ポイント）。
     マイナスなら遅い。グリッド1台ぶんがおよそ 1.0 に相当する      */
  function puPerf(g2) { return puMode(g2).perf - D.PU_PERF_DROP * puTired(g2); }
  /* 新品1基の値段。世代が進むほど高くつく */
  function puFreshCost(g2) {
    return perkPrice(g2, 'pu', Math.round(D.PU_FRESH_COST * (1 + (g2.carGen || 0) * 0.20)));
  }
  /* いま載せているユニットを降ろして保管する（残量があれば） */
  function stowPU(pu, part) {
    if (pu.life >= D.PU_KEEP_MIN) {
      pu.pool.push({ n: pu.n, life: pu.life, worn: (part && part.worn) || 0 });
    }
    pu.pool.sort((a, b) => b.life - a.life);
    if (pu.pool.length > 6) pu.pool.length = 6;
  }
  /* 新品を投入する。基数を1つ使い、上限を超えていればグリッド降格 */
  function fitFreshPU(g2) {
    const pu = puOf(g2);
    stowPU(pu, g2.equipped && g2.equipped.pu);
    pu.used++; pu.n = pu.used; pu.life = 100;
    // 下ろしたてのユニットは、摩耗もまっさらから
    if (g2.equipped && g2.equipped.pu) g2.equipped.pu.worn = 0;
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
    stowPU(pu, g2.equipped && g2.equipped.pu);
    const from = pu.n;
    pu.n = u.n; pu.life = u.life;
    if (g2.equipped && g2.equipped.pu) g2.equipped.pu.worn = u.worn || 0;
    return { from: from, to: u.n, life: Math.round(u.life) };
  }
  /* 1戦でどれだけ削れるか。冷却の効いた車体と、腕の良いメカニックほど保つ */
  function puWear(g2, track, pushMul) {
    const laps = (track && track.laps) || 26;
    const cool = 1 - bodyRatio(g2, 'cooling') * 0.30;
    const care = 1 - Math.min(0.28, pitPower(g2) * 0.06 + g2.facilities.pit * 0.015);
    const dur = 1 - D.PU_NURSE.durMax * puDur(g2);
    return D.PU_BASE_WEAR * (laps / 26) * (pushMul || 1) * cool * care
         * puMode(g2).wear * dur;
  }
  /* レースを走り終えたときの処理。使い切ったら次の基数へ */
  function usePU(g2, track, pushMul) {
    const pu = puOf(g2);
    const w = puWear(g2, track, pushMul);
    pu.life = Math.max(0, pu.life - w);
    /* 走ったぶんの一部は、もう戻らない。整備の天井がそのぶん下がる */
    const part = g2.equipped && g2.equipped.pu;
    if (part) part.worn = clamp((part.worn || 0) + w * D.PU_NURSE.hard, 0, 100);
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
    // 手を入れられるのは補機まわりだけ。芯の摩耗ぶんは戻せない
    pu.life = clamp(pu.life + amount, 0, puCeil(g2));
    return Math.round(pu.life - before);
  }
  function puReset(g2) {
    g2.pu = { used: 1, life: 100, grid: 0, over: 0, n: 1, pool: [] };
    if (g2.equipped && g2.equipped.pu) g2.equipped.pu.cond = 100;
    puOf(g2);
  }

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
    const track = trackAt(g2, g2.nextRace);
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

  /* =======================================================
     こちらが供給する側になる
     自前のパワーユニットが業界の上位に立つと、
     分けてほしいという話が来るようになる。
     一時金と毎戦の供給料が入り、客が走らせたデータも戻ってくる。
     そのかわり、渡した相手はその日から速くなっていく。
     何年もかけて開いた差が、契約書一枚で埋まっていく。
     ======================================================= */
  function myPuPower(g2) {
    return (g2.equipped && g2.equipped.pu) ? g2.equipped.pu.power : 0;
  }
  /* ライバルが自前でどれだけのパワーユニットを持っているか。
     ライバルのパーツ内訳は持っていないので、直線の速さから逆算する。
     全パーツが同じくらい仕上がっているとすれば、
     直線の速さ ＝ パーツ出力 × 各パーツの効きの合計、になる       */
  function rivalPuOf(g2, r) {
    if (!r || !r.stats) return 0;
    return Math.max(0, r.stats.speed / D.PU_SUPPLY.speedTotal);
  }
  /* 自前のパワーユニットが、業界のどのあたりにあるか（0..1） */
  function puRank01(g2) {
    const rivals = g2.rivals || [];
    if (!rivals.length) return 0.5;
    const my = myPuPower(g2);
    const above = rivals.filter(r => rivalPuOf(g2, r) >= my).length;
    return 1 - above / rivals.length;
  }
  /* 供給できる状態かどうか。
     供給を受けている身では、人に配ることはできない            */
  function canSupplyPU(g2) {
    if (g2.engine) return false;
    return puRank01(g2) >= D.PU_SUPPLY.needRank;
  }
  function isCustomer(g2, name) {
    return (g2.customers || []).some(c => c.team === name);
  }
  /* 実際に押し上げられる幅。シャシーは相手のものなので、
     パワーユニットを渡しただけで別のチームにはならない          */
  function puLiftFor(own, give) {
    return Math.max(0, Math.min(give - own, own * D.PU_SUPPLY.maxLift));
  }
  /* 押し上げ幅が、ラップにすると何秒ぶんになるか。
     素点をいくら見せても速さの実感にならないので、
     race.js と同じ式（paceGap）を使って秒に直す。
     車の評価は perf の 0.60 ぶんを占めるので、そこだけが動く    */
  function supplySec(g2, teamName, lift) {
    const r = (g2.rivals || []).filter(x => x.name === teamName)[0];
    if (!r || !(lift > 0)) return 0;
    const track = trackAt(g2, g2.nextRace);
    const PU = D.PART_CATS.filter(c => c.key === 'pu')[0];
    const after = { speed:  r.stats.speed  + lift * PU.gain.speed,
                    corner: r.stats.corner,
                    accel:  r.stats.accel  + lift * PU.gain.accel };
    /* race.js と同じ 0.60/0.40。ドライバーは、そのチームの速いほうを使う */
    const drvOf = t => Math.max.apply(null,
      ((t && t.drivers) || []).map(driverRating).concat([30]));
    const perfOf = (st, t) => carScoreOf(st, track) * 0.60 + drvOf(t) * 0.40;
    // その顔ぶれの基準。race.js の perfRef と同じ組み立て
    const ref = Math.max.apply(null,
      (g2.rivals || []).map(x => perfOf(x === r ? after : x.stats, x))
        .concat([perfOf(carStats(g2), { drivers: g2.drivers || [] })])) + 4;
    const lapAt = perf => {
      const rel = (ref - perf) / Math.max(1, ref);
      return track.base * (1 + D.PACE.k * D.PACE.soft * Math.tanh(rel / D.PACE.soft));
    };
    return Math.max(0, lapAt(perfOf(r.stats, r)) - lapAt(perfOf(after, r)));
  }

  /* 「分けてほしい」と言ってくるチーム。
     自前が明らかに劣っている相手ほど、強く欲しがる            */
  function customerOffers(g2) {
    if (!canSupplyPU(g2)) return [];
    const P2 = D.PU_SUPPLY;
    const my = myPuPower(g2);
    const give = my * P2.detune;
    return (g2.rivals || []).filter(r => !isCustomer(g2, r.name))
      .map(r => {
        const own = rivalPuOf(g2, r);
        const gap = puLiftFor(own, give);
        return { team: r.name, color: r.color, own: Math.round(own),
                 give: Math.round(own + gap), gap: gap,
                 // 押し上げる幅が大きいほど、相手も高く払う
                 upfront: Math.round(P2.upfront + give * P2.upfrontPer + gap * 90),
                 fee: Math.round(P2.feeBase + give * P2.feePer + gap * 12) };
      })
      .filter(o => o.gap >= P2.gapMin)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 4);
  }
  function signCustomer(g2, name) {
    const P2 = D.PU_SUPPLY;
    if ((g2.customers || []).length >= P2.max) return null;
    const o = customerOffers(g2).filter(x => x.team === name)[0];
    if (!o) return null;
    g2.funds += o.upfront;
    g2.customers = (g2.customers || []).concat([{
      team: name, fee: o.fee, since: g2.season || 1, left: P2.years,
      given: 0, from: o.own
    }]);
    return o;
  }
  function dropCustomerFee(g2, name) {
    const c = (g2.customers || []).filter(x => x.team === name)[0];
    return c ? Math.round(c.fee * D.PU_SUPPLY.breakFee) : 0;
  }
  function dropCustomer(g2, name) {
    const fee = dropCustomerFee(g2, name);
    if (g2.funds < fee) return null;
    g2.funds -= fee;
    g2.customers = (g2.customers || []).filter(x => x.team !== name);
    return fee;
  }
  /* 1戦あたりに入ってくる供給料の合計 */
  function customerFee(g2) {
    return (g2.customers || []).reduce((a, c) => a + (c.fee || 0), 0);
  }
  /* 毎週、渡したぶんが相手に届く。
     ここが「一気に迫られる」ところ。自分が伸ばした最新型が、
     一段落としただけの形で、そのまま相手のマシンに乗っていく    */
  function tickCustomers(g2) {
    const P2 = D.PU_SUPPLY;
    const give = myPuPower(g2) * P2.detune;
    const PU = D.PART_CATS.filter(c => c.key === 'pu')[0];
    const moved = [];
    (g2.customers || []).forEach(c => {
      const r = (g2.rivals || []).filter(x => x.name === c.team)[0];
      if (!r || !r.stats) return;
      /* 押し上げられるのは「うちの仕様 − 相手が自前で持っていた分」まで。
         うちが伸ばせば的も動くので、客はいつまでも近づいてくる      */
      const target = puLiftFor(c.from || 0, give);
      const have = c.given || 0;
      if (have >= target - 0.05) return;
      const step = Math.min(target - have, Math.max(0.30, (target - have) * P2.catch));
      // パワーユニットが効くのは直線と立ち上がり。曲がりどころには効かない
      r.stats.speed += step * PU.gain.speed;
      r.stats.accel += step * PU.gain.accel;
      c.given = Math.round((have + step) * 10) / 10;
      moved.push({ team: c.team, step: Math.round(step * 10) / 10 });
    });
    if (moved.length) {
      // 客が走らせたぶんのデータが、こちらへ戻ってくる
      g2.rp += Math.round(P2.rp * moved.length);
      g2.puLearn = Math.min(P2.relCap, (g2.puLearn || 0) + P2.relGain * moved.length);
    }
    return moved;
  }
  /* シーズン越しに、供給契約の残りを1つ減らす */
  function tickCustomerYears(g2) {
    const gone = [];
    g2.customers = (g2.customers || []).filter(c => {
      c.left = (c.left || 1) - 1;
      if (c.left > 0) return true;
      gone.push(c.team);
      return false;
    });
    return gone;
  }
  /* 客のぶんも作るので、自分のパワーユニット開発は少し遅くなる */
  function puDevMul(g2) {
    const n = (g2.customers || []).length;
    return n ? Math.pow(D.PU_SUPPLY.devCost, Math.min(3, n)) : 1;
  }

  /* ---------- 修理費 ----------
     スピン、コースアウト、クラッシュ。壊したぶんは自分で払う。
     世代の進んだマシンほど部品が高い。難易度でも変わる          */
  /* 修理代がどれだけ安く済むか（0..0.62）。
     整備しやすい車体と、高耐久の技術が効く                    */
  function repairCut(g2) {
    return clamp(bodyRatio(g2, 'service') * 0.40 + techLv(g2, 'tough') * 0.035, 0, 0.62);
  }
  function repairBill(g2, res) {
    const R2 = D.REPAIR;
    const genMul = 1 + (g2.carGen || 0) * R2.gen;
    const diff = diffOf(g2).repair == null ? 1 : diffOf(g2).repair;
    // 整備性の高い車体は、直すのも速くて安い。
    // 高耐久の技術も、同じところに効く
    const svc = repairCut(g2);
    let sum = 0;
    const lines = [];
    (res.entries || []).filter(e => e.isPlayer).forEach(e => {
      let n = 0;
      if (e.spins) { n += R2.spin * e.spins; }
      if (e.dnf && e.dnfReason === 'スピンからのコースアウト') n += R2.off;
      else if (e.dnf && ['クラッシュ', '接触', 'コースアウト'].indexOf(e.dnfReason) >= 0) n += R2.crash;
      n += R2.dmg * (e.damage || 0);
      if (n <= 0) return;
      n = Math.round(n * genMul * diff * (1 - svc));
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
      // パワーユニットは「1戦でどれだけ削れるか」を usePU が持っている。
      // ここでも削ると、同じ消耗を二度数えることになる
      if (c.key === 'pu') return;
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

  /* ---------- ダウンフォースとタイヤの持ち ----------
     曲がる力にどれだけ振ってあるか。押しつける力が大きいほど
     タイヤは滑らず、1周あたりの摩耗が小さくなる。            */
  const RIVAL_BODY_REF = 0.40;          // ライバルの車体の仕上がり（基準）
  function dfBiasOf(s) {
    return s.corner / Math.max(1, s.speed + s.corner + s.accel);
  }
  /* タイヤの減りやすさ。1.00 がライバルの標準で、小さいほど長持ちする */
  function wearCarOf(s, lightRatio, mechWear) {
    return Math.max(0.55, (1 - lightRatio * 0.22) / (1 - RIVAL_BODY_REF * 0.22)
                        * (1 - (dfBiasOf(s) - D.DF_REF) * D.WEAR_DF)
                        * (1 - (mechWear || 0)));
  }
  function tyreKind(g2) {
    return wearCarOf(carStats(g2), bodyRatio(g2, 'light'), mechLift(g2).wear);
  }

  /* =======================================================
     週末のタイヤ
     持ち込めるのはセット単位で決まった本数だけ。
     1セットは「これまで走った周回」を覚えていて、走るほど古くなる。
     金曜に走り込むほど仕上がるが、日曜に残るタイヤは薄くなる。
     ここが、週末を通してひとつながりの選択になる。
     ======================================================= */
  function newTyreBank() {
    const b = {};
    const put = (k, n) => { b[k] = []; for (let i = 0; i < n; i++) b[k].push(0); };
    Object.keys(D.TYRE_ALLOC.sets).forEach(k => put(k, D.TYRE_ALLOC.sets[k]));
    // 雨用は別枠。数は決まっているが、ドライの本数には数えない
    Object.keys(D.TYRE_ALLOC.wet).forEach(k => put(k, D.TYRE_ALLOC.wet[k]));
    return b;
  }
  /* セットを1本取り出す（戻さない）。
     wantNew なら新品を、そうでなければ「まだ使えるいちばん古いもの」を選ぶ。
     新品を日曜に残すのが、中古で走ることの意味なので                */
  function drawSet(bank, key, wantNew) {
    let arr = bank[key];
    if (!arr || !arr.length) {
      /* その銘柄を使い切ったら、同じ用途のうちで残っているものに履き替える。
         乾いた路面でウェットを出すわけにはいかないので、
         ドライはドライ、雨用は雨用のなかだけで探す                   */
      const pool = D.DRY_TYRES.indexOf(key) >= 0
        ? D.DRY_TYRES : Object.keys(D.TYRE_ALLOC.wet);
      const alt = pool.filter(k => bank[k] && bank[k].length)
        .sort((a, b) => Math.min.apply(null, bank[a]) - Math.min.apply(null, bank[b]))[0];
      if (!alt) return { key: key, age: 0, empty: true };
      key = alt; arr = bank[key];
    }
    arr.sort((a, b) => a - b);
    let i = 0;                                  // 新品＝いちばん若いもの
    if (!wantNew) {
      for (let j = arr.length - 1; j >= 0; j--) { if (arr[j] > 0) { i = j; break; } }
    }
    const age = arr.splice(i, 1)[0];
    return { key: key, age: age, fresh: age <= 0 };
  }
  /* 走ったぶん古くして棚に戻す（フリー走行・予選で使ったセット） */
  function returnSet(bank, set, laps) {
    if (!set || set.empty) return set;
    (bank[set.key] = bank[set.key] || []).push(set.age + (laps || 0));
    return set;
  }
  /* 1セットで走る（取り出して、走って、戻す） */
  function runSet(bank, key, wantNew, laps) {
    return returnSet(bank, drawSet(bank, key, wantNew), laps);
  }
  /* 走り込みで、指定された銘柄を順におろす。
     走ったセットは棚に戻るが、もう新品ではない                     */
  function scrubBank(bank, list, laps) {
    (list || []).forEach(k => runSet(bank, k, true, typeof laps === 'function' ? laps() : laps));
  }
  /* 棚の中身（画面用）。銘柄ごとに 新品／中古 が何本ずつ残っているか */
  function bankRows(bank, wet) {
    const keys = wet ? Object.keys(D.TYRE_ALLOC.wet) : D.DRY_TYRES;
    return keys.map(k => {
      const arr = (bank && bank[k]) || [];
      return { key: k, fresh: arr.filter(a => a <= 0).length,
               used: arr.filter(a => a > 0).length, all: arr.length,
               wear: arr.filter(a => a > 0).reduce((a, b) => a + b, 0) };
    });
  }
  /* 新品が何セット残っているか。銘柄を渡せばその銘柄だけ数える */
  function bankFresh(bank, key) {
    return bankRows(bank).filter(r => !key || r.key === key)
                         .reduce((a, r) => a + r.fresh, 0);
  }
  /* 中古で走るぶんの遅さ（秒／周）。皮むきの1周ぶんは差し引く */
  function usedLoss(age) {
    const A = D.TYRE_ALLOC;
    if (!age || age <= 1) return 0;
    return A.qUsedLoss * Math.min(1, (age - 1) / 5);
  }

  /* =======================================================
     タイヤの読み
     金曜に何を履いて走ったか（データ）と、
     それを読める人がいるか（ストラテジストとエンジニア）。
     この二つは掛け算で、片方が欠けると何も出てこない。
     データがあっても読めないし、読めてもデータがなければ空振りになる。
     ======================================================= */
  function fpTyrePlan(key) {
    return D.FP_TYRE.filter(x => x.key === key)[0] || D.FP_TYRE[1];
  }
  /* 読める人の厚み（0..1）。読む人と、数字にする人の両方が要る */
  function readCrew(g2) {
    const R = D.TYRE_READ;
    const o = org(g2);
    return clamp(o.dept.strategist * R.str + o.dept.engineer * R.eng
                 + kitEff(g2, 'wall', 'read') * 0.30, 0, 1);
  }
  function tyreRead(g2, planKey, ran) {
    const R = D.TYRE_READ;
    const plan = fpTyrePlan(planKey);
    // 走らなかった週末は、データそのものが薄い
    const data = plan.deg * (ran == null ? 1 : ran);
    return clamp(R.base + data * readCrew(g2) * R.gain, 0, R.max);
  }
  /* このコースで、この車とこの人なら1セットが何周もつか。
     読みが浅いほど、出てくる数字の幅が広い（見立ての精度そのもの）  */
  function tyreLifeRead(g2, track, d, read) {
    const life = D.TYRES.filter(t => t.key === 'medium')[0].life;
    const wear = track.tyre * tyreWear(d) * tyreKind(g2);
    const real = life / Math.max(0.35, wear);
    const band = D.TYRE_READ.bandMax * (1 - read);
    return { real: real, lo: real * (1 - band), hi: real * (1 + band),
             wear: wear, band: band };
  }
  /* ストップ数の見立て。読みが浅いと、1回ぶんずれることがある */
  function stopsRead(g2, track, laps, wear, read) {
    const R = D.TYRE_READ;
    const real = naturalStops(track, laps, wear);
    if (read >= R.missFrom) return { n: real, sure: true, real: real };
    const p = R.missMax * (R.missFrom - read) / R.missFrom;
    if (Math.random() >= p) return { n: real, sure: false, real: real };
    return { n: clamp(real + (Math.random() < 0.5 ? -1 : 1), 1, 3),
             sure: false, real: real, off: true };
  }

  /* ---------- スタッフ効果 ---------- */
  function staffBonus(g, key) {
    let sum = 0;
    g.staff.forEach(s => {
      // 段位が上がるほど、同じ技能でもチームへの効き方が大きくなる
      const w = s.skill * staffRank(s).mul * (s.away > 0 ? D.SCHOOL.awayMul : 1);
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
    // 直営ショップとミュージアムは、週末以外の日にも売り上げを作る
    const own = (hasEstate(g2, 'shop') ? 0.35 : 0) + (hasEstate(g2, 'museum') ? 0.28 : 0);
    const mult = (1 + g2.facilities.market * 0.08) * (1 + osk(g2, 'money') * 0.05)
               * (1 + (g2.hype || 0) / 100 * 0.35) * (1 + own)
               * rigMul(g2, 'market');
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
      v = v * (1 + osk(g2, 'fame') * 0.20) * (1 + stars * 0.07)
          // ガレージの中をそのまま流すと、数字より先に顔が知られる
          * (hasGear(g2, 'market', 'sns') ? 1.18 : 1);
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
    /* 得意な作り方と、苦手な作り方。人によって違う。
       同じにならないように、苦手は得意以外から引く            */
    const keys = D.CONCEPTS.map(c => c.key);
    const good = pick(keys);
    const bad = pick(keys.filter(k => k !== good));
    return {
      id: 'm' + Math.random().toString(36).slice(2, 8),
      role: key, name: pick(D.FIRST) + '・' + pick(D.LAST),
      skill: skill, good: good, bad: bad,
      salary: Math.round(m.salary * (0.5 + skill / 46))
    };
  }
  /* 役職に就いている人の技能。空席なら0 */
  function mgr(g2, key) {
    const m = g2.managers && g2.managers[key];
    if (!m) return 0;
    return m.away > 0 ? m.skill * D.SCHOOL.awayMul : m.skill;
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
    /* サプライヤーは、看板ではなく道具そのものに効く。
       買うときと、持ち続けるあいだの両方が安くなる                */
    (g2.supply || []).forEach(c => {
      const d = D.SUPPLIERS.filter(x => x.key === c.key)[0];
      if (!d) return;
      const deep = 1 + supplyDeep(g2, c);
      const hitsGear = (target === 'gear' || target.indexOf('gear:') === 0);
      const hitsKit = (target === 'kit' || target.indexOf('kit:') === 0);
      if (target === 'up') cut += d.keep * deep;
      else if (hitsGear && (d.field === 'gear' || d.field === 'both')) cut += d.buy * deep;
      else if (hitsKit && (d.field === 'kit' || d.field === 'both')) cut += d.buy * deep;
    });
    return Math.min(D.PERK_CAP, cut);
  }

  /* =======================================================
     サプライヤー
     スポンサーは看板を貼って金を出す相手。
     サプライヤーは道具そのものを卸し、面倒を見てくれる相手。
     毎週いくらか払う代わりに、装備の値段と維持費が下がる。
     長く付き合うほど、値引きは深くなる。
     ======================================================= */
  function supplyDeep(g2, c) {
    const yrs = Math.max(0, (g2.season || 1) - (c.since || g2.season || 1));
    return Math.min(D.SUPPLY.deepCap, yrs * D.SUPPLY.deep);
  }
  function supplySlots(g2) {
    return D.SUPPLY.slots + (depotLv(g2) >= 4 ? 1 : 0);
  }
  function supplyOpen(g2, d) {
    return (g2.fans || 0) >= (d.fans || 0) && (g2.hype || 0) >= (d.hype || 0);
  }
  function supplyList(g2) {
    return D.SUPPLIERS.map(d => {
      const c = (g2.supply || []).filter(x => x.key === d.key)[0];
      return { def: d, on: !!c, contract: c || null,
               deep: c ? supplyDeep(g2, c) : 0,
               left: c ? c.left : 0,
               open: supplyOpen(g2, d) };
    });
  }
  function signSupply(g2, key) {
    const d = D.SUPPLIERS.filter(x => x.key === key)[0];
    if (!d || !supplyOpen(g2, d)) return null;
    g2.supply = g2.supply || [];
    if (g2.supply.some(x => x.key === key)) return null;
    if (g2.supply.length >= supplySlots(g2)) return null;
    g2.supply.push({ key: key, since: g2.season || 1, left: d.years });
    return d;
  }
  /* 途中で切る。残っている契約のぶんだけ違約金がいる */
  function dropSupplyCost(g2, key) {
    const c = (g2.supply || []).filter(x => x.key === key)[0];
    const d = D.SUPPLIERS.filter(x => x.key === key)[0];
    if (!c || !d) return 0;
    return Math.round(d.fee * D.SUPPLY.breakFee * Math.max(1, c.left));
  }
  function dropSupply(g2, key) {
    const cost = dropSupplyCost(g2, key);
    if (g2.funds < cost) return null;
    g2.funds -= cost;
    g2.supply = (g2.supply || []).filter(x => x.key !== key);
    return cost;
  }
  function supplyFee(g2) {
    return (g2.supply || []).reduce((a, c) => {
      const d = D.SUPPLIERS.filter(x => x.key === c.key)[0];
      return a + (d ? d.fee : 0);
    }, 0);
  }
  /* シーズンが変わったときに、契約の残りを1つ減らす */
  function tickSupply(g2) {
    const gone = [];
    g2.supply = (g2.supply || []).filter(c => {
      c.left = (c.left || 1) - 1;
      if (c.left > 0) return true;
      const d = D.SUPPLIERS.filter(x => x.key === c.key)[0];
      if (d) gone.push(d);
      return false;
    });
    return gone;
  }

  /* ---------- 装備の維持費 ----------
     買った道具は、置いてあるだけで金を食う。
     校正、消耗品、倉庫代。サプライヤーがいれば、そこが軽くなる    */
  function gearUpkeep(g2) {
    let raw = 0;
    Object.keys(D.GEAR).forEach(fac => {
      D.GEAR[fac].forEach(x => { if (hasGear(g2, fac, x.key)) raw += x.cost * D.UPKEEP.gear; });
    });
    D.RACEKIT.forEach(k => {
      const t = k.tiers[kitLv(g2, k.key)];
      if (t && t.cost) raw += t.cost * D.UPKEEP.kit;
    });
    return { raw: Math.round(raw), cut: perkCut(g2, 'up'),
             net: Math.round(raw * (1 - perkCut(g2, 'up'))) };
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
    const estate = estateUpkeep(g2);            // 持っている事業の維持費
    const gearUp = gearUpkeep(g2).net;          // 買った装備の維持費
    const supply = supplyFee(g2);               // サプライヤーへの契約料
    const raw = staff + mgrs + drivers + youth + facilities + engine
              + estate + gearUp + supply + other;
    // ロジスティクス責任者は運営全体の費用を下げる
    // ロジスティクス責任者に加えて、オーナーの商才も運営費を下げる
    const cut = Math.min(0.45, mgr(g2, 'logistics') * 0.010 + osk(g2, 'money') * 0.03);
    // 難易度で、同じ陣容でも維持にかかる金が変わる
    const weekly = Math.round(raw * (1 - cut) * (diffOf(g2).upkeep || 1));

    // 1戦あたりのスポンサー収入（注目度・マーケ室・プリンシパル・難易度込み）
    const diff = diffOf(g2);
    const boost = hypeBonus(g2) * (1 + mgr(g2, 'principal') * 0.006);
    const scale = (1 + g2.facilities.market * 0.07) * rigMul(g2, 'market') * boost * diff.sponsor
                * (1 + osk(g2, 'money') * 0.06)    // 商才
                * (hasGear(g2, 'market', 'hosp') ? 1.08 : 1);
    const ts = titleOf(g2);
    const perRace = Math.round((g2.sponsors.reduce((a, sp) => a + (sp.per || 0), 0)
                                + (ts ? ts.per : 0)) * scale);
    const merch = fanIncome(g2);           // グッズ・入場料
    const puSupply = customerFee(g2);      // よそに配っているパワーユニットの供給料
    const paid = paidIncome(g2);           // ドライバーが持ち込んでいるぶん
    const rpRace = Math.round((g2.sponsors.reduce((a, sp) => a + (sp.rp || 0), 0)
                               + (ts ? ts.rp : 0)) * scale);

    const PREP = raceWeek(0);                       // レース1回あたりの週数
    // 次のレースへの輸送費（コースの遠さで変わる）
    const shipping = logiCost(g2, D.TRACKS[g2.nextRace] || D.TRACKS[0]);
    return {
      staff: staff, managers: mgrs, drivers: drivers, youth: youth,
      facilities: facilities, engine: engine, estate: estate,
      gearUp: gearUp, supply: supply, other: other, cut: cut,
      weekly: weekly,
      sponsorPerRace: perRace,
      sponsorRpPerRace: rpRace,
      // レース1回ぶん（準備週＋レース週）の収支
      shipping: shipping,
      merch: merch,
      puSupply: puSupply,
      paid: paid,
      cycleCost: weekly * PREP + shipping,
      cycleIncome: perRace + merch + puSupply + paid,
      net: perRace + merch + puSupply + paid - weekly * PREP - shipping
    };
  }

  /* ---------- 週あたりの固定費 ---------- */
  function weeklyCost(g) { return finances(g).weekly; }

  /* ---------- ライバルチーム生成 ---------- */
  /* 技術の世代は業界全体で進む。自分だけが新しいマシンに乗るわけではない。
     ここが無いと、世代を上げた瞬間に永久に一方的な展開になる            */
  /* ---- ライバルの水準 ----
     その世代を上限まで埋めた車を「満」として、
     先頭がそのどこまで来るか、後ろがどこまで落ちるかで置く。
     器そのものに比例するので、世代が上がっても置いていかれない。
     規則変更のときの巻き戻しも、同じここを通す               */
  function rivalLevel(power, season, gen, dp, dg, tg) {
    const RL = D.RIVAL_LEVEL;
    const capNow = D.CAR_GENS[Math.min(D.CAR_GENS.length - 1, Math.max(0, gen || 0))].cap;
    const full = RL.fill * capNow;
    // 地力 0.70〜1.00 を tail〜1.00 に写す。横並びの年はここも潰す
    const rel0 = RL.tail + ((power - 0.70) / 0.30) * (1 - RL.tail);
    const rel = 1 + (rel0 - 1) * (1 - (tg || 0));
    // 規則の年数ぶんの底上げ。変わった直後はみな低いところから
    const age = RL.seed + Math.min(3, Math.max(0, (season || 1) - 1)) * RL.ramp;
    return full * RL.reach * rel * age * (dp == null ? 1 : dp) * (dg == null ? 1 : dg)
         + rnd(-1, 1) * full * RL.noise * (1 - (tg || 0) * 0.75);
  }

  /* ---------- オーナーの交代 ----------
     成績の履歴を見て、身売りと撤退を決める。
     呼ぶのはシーズンの変わり目、makeRivals より前。
     返すのは、画面と記録に出すための出来事の一覧            */
  const NEW_OWNERS = [
    { n: '産油国の投資ファンド',   w: '金に糸目をつけない。ただし結果を待つ気は長くない' },
    { n: '自動車メーカーの本体',   w: '本社が本気で乗り出してきた。設備も人も一気に入れ替わる' },
    { n: '成功した実業家',         w: '子どもの頃からの夢だったという。私財を注ぎ込んでいる' },
    { n: '大手飲料ブランド',       w: '広告費の桁が変わった。若い才能を集めはじめている' },
    { n: '古参のレース屋の連合',   w: '現場あがりの人間が金を出しあった。無駄が消えた' },
    { n: '半導体メーカー',         w: '計算機を持ち込んできた。風洞より先にシミュレータが建った' }
  ];
  function tickRivalOwners(g2) {
    const O = D.RIVAL_OWNER;
    const out = [];
    const table = constructorTable(g2);
    const rank = {};
    table.forEach((t, i) => { rank[t.name] = i + 1; });
    (g2.rivals || []).forEach(r => {
      const at = rank[r.name] || O.lowFrom;
      r.lowRun = at >= O.lowFrom ? (r.lowRun || 0) + 1 : 0;
      r.topRun = at <= O.topTo ? (r.topRun || 0) + 1 : 0;
      const pw = r.pw != null ? r.pw : ((D.RIVALS.find(x => x.name === r.name) || {}).power || 1);
      /* ---- 撤退（期待に届かなかった側）----
         買われたのに、また下位に沈んだ。
         新しいオーナーも、いつまでも待ってはくれない        */
      if (r.owner && r.lowRun >= O.lowYears && Math.random() < O.failChance) {
        const gone = r.owner;
        r.pw = Math.max(O.min, pw - O.failLoss);
        r.drvMul = Math.max(0.8, (r.drvMul || 1) * 0.90);
        r.owner = null;
        r.lowRun = 0; r.topRun = 0;
        out.push({ team: r.name, color: r.color, kind: 'fail', owner: gone,
                   from: Math.round(pw * 100), to: Math.round(r.pw * 100) });
        return;
      }
      /* ---- 身売り ----
         下位が続くと、チームそのものに値がつく。
         買うほうは、勝つために買う                       */
      if (r.lowRun >= O.lowYears && pw < O.max && Math.random() < O.lowChance) {
        const o = pick(NEW_OWNERS);
        r.pw = Math.min(O.max, pw + O.lowGain);
        r.drvMul = Math.min(1.6, (r.drvMul || 1) * O.drvGain);
        // 新しいオーナーは、まず現場に人と道具を入れる
        r.crew = clamp((r.crew != null ? r.crew : 0.5) + 0.18, 0, 1);
        r.owner = o.n;
        r.lowRun = 0; r.topRun = 0;
        out.push({ team: r.name, color: r.color, kind: 'buy', owner: o.n, why: o.w,
                   from: Math.round(pw * 100), to: Math.round(r.pw * 100) });
        return;
      }
      /* ---- 撤退 ----
         勝ち続けたチームは、出資者にとって「もう見た」ものになる */
      if (r.topRun >= O.topYears && pw > O.min && Math.random() < O.topChance) {
        r.pw = Math.max(O.min, pw - O.topLoss);
        r.drvMul = Math.max(0.8, (r.drvMul || 1) * 0.94);
        r.owner = null;
        r.lowRun = 0; r.topRun = 0;
        out.push({ team: r.name, color: r.color, kind: 'out',
                   from: Math.round(pw * 100), to: Math.round(r.pw * 100) });
        return;
      }
      if (r.pw == null) r.pw = pw;
    });
    return out;
  }
  /* チームごとに、来季へ持ち越すもの一式。
     makeRivals はライバルを作り直すので、ここに載せ替えないと
     「下位が何年続いたか」まで毎年ゼロに戻ってしまう           */
  function rivalCarry(g2) {
    const out = {};
    (g2.rivals || []).forEach(r => {
      out[r.name] = {
        pw: r.pw, drvMul: r.drvMul, owner: r.owner || null,
        lowRun: r.lowRun || 0, topRun: r.topRun || 0, crew: r.crew
      };
    });
    return out;
  }

  function makeRivals(season, keepNames, diff, era, carry) {
    resetNames(keepNames);
    const dp = diff ? diff.rivalPower : 1;
    const dg = diff ? diff.rivalGrow : 1;
    /* 規則が固まりきった年は、どのチームも同じところに行き着く。
       チームごとの地力の差を、そのぶんだけ 1 に寄せて横並びにする */
    const tg = (diff && diff.tight) || 0;
    return D.RIVALS.map((r, i) => {
      // そのチームがいま持っている地力。オーナーが替われば動く
      const c = (carry && carry[r.name]) || {};
      const own = c.pw != null ? c.pw : r.power;
      const dmul = c.drvMul || 1;
      const pw = 1 + (own - 1) * (1 - tg);
      const lv = (3 + season * 2.1 * dg) * pw * dp * dmul;
      const base = rivalLevel(own, season, era, dp, dg, tg);
      const t = {
        name: r.name, color: r.color, isPlayer: false, char: r.char,
        pw: own, drvMul: dmul, owner: c.owner || null,
        lowRun: c.lowRun || 0, topRun: c.topRun || 0,
        /* ピットクルーの腕（0..1）。車の速さとは別に持つ。
           持ち越すので、そのチームらしさとして残る              */
        crew: c.crew != null ? c.crew : clamp(0.5 + rnd(-0.42, 0.42) + (own - 0.85) * 0.30, 0, 1),
        // 3性能の絶対値。コース適性込みの速さは carScoreOf() で算出する
        stats: {
          speed:  base * 3 * r.bias.speed,
          corner: base * 3 * r.bias.corner,
          accel:  base * 3 * r.bias.accel
        },
        rel: clamp(72 + pw * 18 + season * 1.2 + rnd(-8, 8) * (1 - tg * 0.6), 40, 97),
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
  /* ---------- サマーブレイク ----------
     シーズンの折り返しで、工場ごと閉める2週間。
     実際のF1と同じで、ここは走ることも作ることもできない。
     そのぶん人が休まり、後半戦へ向けて仕切り直せる。          */
  const SUMMER_AT = Math.round(D.RACES / 2);   // この戦の「前」に入る（0-index）
  const SUMMER_WEEKS = 2;
  /* =======================================================
     開催カレンダー

     コースの数と、1シーズンに走る数は別のもの。
     毎年やる大会（伝統的な7つ）は必ず入り、
     残りは隔年でまわる組から、その年の組が入る。
     走る数はいつも D.RACES で変わらないので、
     「レースが増える」のではなく「顔ぶれが変わる」。
     ======================================================= */
  function buildCalendar(g2) {
    const season = (g2 && g2.season) || 1;
    const fixed = [], rota = [];
    D.TRACKS.forEach((t, i) => { ((t.every || 1) === 1 ? fixed : rota).push(i); });
    /* まわる組からは、窓をずらしながら取る。
       毎年ぜんぶ入れ替えると落ち着かないので、2つずつずらす。
       こうすると毎年 2つ抜けて 2つ入り、残りは続けて開催される  */
    const need = Math.max(0, D.RACES - fixed.length);
    const start = rota.length ? ((season - 1) * 2) % rota.length : 0;
    const pick = [];
    for (let k = 0; k < need && k < rota.length; k++) {
      pick.push(rota[(start + k) % rota.length]);
    }
    const idx = fixed.concat(pick);
    // 足りなければ、残っているものから順に埋める
    if (idx.length < D.RACES) {
      D.TRACKS.forEach((t, i) => {
        if (idx.length >= D.RACES || idx.indexOf(i) >= 0) return;
        idx.push(i);
      });
    }
    // 並びは一覧の順に戻す（遠征がかたよらないよう、もとの順が組んである）
    idx.sort((a, b) => a - b);
    return idx.slice(0, D.RACES);
  }
  /* いまのカレンダー。無ければその場で作る（古いセーブ用） */
  function calendarOf(g2) {
    if (!g2) return buildCalendar(null);
    if (!g2.calendar || g2.calendar.length !== D.RACES) g2.calendar = buildCalendar(g2);
    return g2.calendar;
  }
  function raceCount() { return D.RACES; }
  /* 第n戦が、コース一覧のどれか */
  function trackIdx(g2, round) {
    const cal = calendarOf(g2);
    return cal[clamp(Math.round(round || 0), 0, cal.length - 1)];
  }
  /* 第n戦のコースそのもの */
  function trackAt(g2, round) { return D.TRACKS[trackIdx(g2, round)]; }
  /* 去年やって今年やらない大会／今年から入る大会（画面で言うために使う） */
  function calendarDiff(g2) {
    const now = calendarOf(g2);
    const prev = buildCalendar({ season: ((g2 && g2.season) || 1) - 1 });
    return { added: now.filter(i => prev.indexOf(i) < 0).map(i => D.TRACKS[i]),
             gone: prev.filter(i => now.indexOf(i) < 0).map(i => D.TRACKS[i]) };
  }

  function raceWeek(i) {
    return (i + 1) * (PREP_WEEKS + 1) + (i >= SUMMER_AT ? SUMMER_WEEKS : 0);
  }
  const SEASON_WEEKS = D.RACES * (PREP_WEEKS + 1) + SUMMER_WEEKS;
  const summerFrom = () => raceWeek(SUMMER_AT - 1) + 1;
  const summerTo   = () => summerFrom() + SUMMER_WEEKS - 1;
  function inSummer(week) { return week >= summerFrom() && week <= summerTo(); }

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
      nextRace: 0,                  // 次のレースのindex（第何戦か）
      calendar: null,               // 今年やる大会の並び（あとで組む）
      points: 0,                    // 今季コンストラクターズポイント
      titles: { drivers: 0, teams: 0 },
      // オーナー（プレイヤー自身）。元ドライバーの経歴で初期スキルが変わる
      owner: null,
      reg: 0,                       // レギュレーション世代（4シーズンごとに変わる）
      regFrom: diff.regFrom || 0,   // 規則の何年目から始めるか（ヘルは最終年から）
      rivalScaled: 1,               // 新しい物差しで作ってある（古いセーブの乗せ替え用）
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
      spare: 0,             // 予備シャシーの数
      capLift: {},          // 研究で押し広げた、コンセプトの線（扇ごと）
      ideas: [],            // 抱えているひらめき（形にすると新しいパーツになる）
      mat: {},              // 扇ごとの素材の段（スチール → アルミ → …）
      matP: {},             // 扇ごとに貯まる勘所。素材を上げる元手になる
      standings: [], results: [],
      log: [],
      flags: { firstWin: false, tutorial: true },
      trainedThisWeek: false
    };
    g.calendar = buildCalendar(g);
    D.PART_GROUPS.forEach(gr => { g.mat[gr.key] = 0; g.matP[gr.key] = 0; });
    g.chassis = rollChassis(g);
    D.PART_CATS.forEach(c => { g.equipped[c.key] = makePart(c.key, 0, 1.0, { power: 10, cond: 92, traits: [] }); });
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
    // 最初の規則を、どこが読み切るか
    rollEraFit(g);
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
    // 働きやすい職場からは、そもそも人が出ていきにくい
    p *= Math.max(0.35, 1 - envScore(g2) * D.ENVW.keep);
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
     ブリーフィングと、ピットへの信頼
     走り終えたドライバーは必ず何かを言う。その言い分は、
     このマシンがこのコースで足りていないところから出てくる。
     エンジニアがどう返したかと、そのあと結果が出たかどうかで、
     ピットへの信頼が動いていく。
     ======================================================= */
  function meetingLv(g2) { return (g2.facilities && g2.facilities.meeting) || 1; }
  /* 話がどれだけ届くか。部屋と、そこに入れた道具で決まる */
  function roomPower(g2) {
    return meetingLv(g2)
         + (hasGear(g2, 'meeting', 'wall3') ? 1.2 : 0)
         + (hasGear(g2, 'meeting', 'rec') ? 1.0 : 0)
         // 全員の前に同じ絵が出ると、声の大きさで決まらなくなる
         + (hasGear(g2, 'meeting', 'board') ? 0.8 : 0);
  }
  function trustOf(d) {
    return d.trust == null ? D.TRUST.start : d.trust;
  }
  function trustTier(v) {
    const t = D.TRUST.tiers;
    for (let i = 0; i < t.length; i++) if (v >= t[i].at) return t[i];
    return t[t.length - 1];
  }
  function addTrust(g2, d, n) {
    // 良い方向の動きだけ、部屋のぶんだけ大きくなる。壊れるときは同じ速さで壊れる
    const k = n > 0 ? 1 + roomPower(g2) * D.BRIEF.roomTrust : 1;
    d.trust = clamp(trustOf(d) + n * k, 0, 100);
    return Math.round(d.trust);
  }
  /* レースごとに、少しだけ中央へ戻る。恨みも信頼も、走れば薄れる */
  function trustDrift(g2) {
    (g2.drivers || []).forEach(d => {
      const v = trustOf(d);
      d.trust = v + (D.TRUST.start - v) * (D.TRUST.drift * 0.1);
    });
  }
  /* 信頼が薄いと、指示を飲み込めない周が出る（0..ignoreMax） */
  function ignoreRate(d) {
    const v = trustOf(d);
    const from = D.TRUST.ignoreFrom;
    if (v >= from) return 0;
    return D.TRUST.ignoreMax * Math.min(1, (from - v) / from);
  }
  /* 信頼が厚いドライバーほど、開発へのフィードバックが的確になる */
  function trustDev(g2) {
    return (g2.drivers || []).reduce((a, d) => {
      const v = trustOf(d);
      if (v <= D.TRUST.devFrom) return a;
      return a + D.TRUST.devMax * (v - D.TRUST.devFrom) / (100 - D.TRUST.devFrom);
    }, 0);
  }

  /* ---- ドライバーが何を言うか ----
     コースが求めているものと、この車が持っているものの差。
     いちばん大きく足りていないところが、そのまま口から出る    */
  function briefFind(g2, track) {
    const st = carStats(g2);
    const w = (track && track.weight) || { speed: 0.33, corner: 0.34, accel: 0.33 };
    const tot = (st.speed + st.corner + st.accel) || 1;
    const wtot = (w.speed + w.corner + w.accel) || 1;
    const gaps = ['speed', 'corner', 'accel'].map(k => ({
      key: k, v: (w[k] / wtot) - (st[k] / tot)
    }));
    // タイヤの減りと乗り味も、同じ土俵に載せて比べる
    const wear = tyreKind(g2);                 // 1.00 が標準。大きいほど減る
    gaps.push({ key: 'wear',  v: (wear - 1) * 0.55 });
    const drive = bodyRatio(g2, 'drive');
    gaps.push({ key: 'drive', v: (RIVAL_BODY_REF - drive) * 0.85 });
    gaps.sort((a, b) => b.v - a.v);
    /* ---- まとまりの話 ----
       速さの数字がどれだけ揃っていても、つなぎ目が合っていなければ
       ドライバーはそこを言う。「エンジンとギヤ比が合っていない」は
       速さの多寡ではなく、噛み合わせの話                        */
    const pk = packWorst(g2);
    let packCand = null;
    if (pk && pk.thin) {
      /* 橋の細さは 0〜0.42、軸のずれは 0.02〜0.10。
         そのまま比べると橋の話しか出てこないので、同じ物差しに載せる */
      const pv = (D.PACK.thin - pk.ratio) * D.BRIEF.packScale;
      packCand = { key: 'pack:' + pk.def.key, v: pv,
                   def: { key: 'pack:' + pk.def.key, icon: pk.def.icon,
                          name: pk.def.name + 'が噛み合っていない',
                          say: pk.def.say, eng: pk.def.eng,
                          fix: pk.def.fix || null, pack: pk } };
    }
    const cand = gaps.map(x => ({ key: x.key, v: x.v,
                                  def: D.COMPLAINTS.filter(c => c.key === x.key)[0] }))
                     .filter(x => x.def);
    if (packCand) cand.push(packCand);
    cand.sort((a, b) => b.v - a.v);
    const top = cand[0];

    /* ---- 足りているとき ----
       いちばんのずれが小さければ、不満は出てこない。
       そのかわり、いちばん出来ているところの手応えを言う。
       毎週おなじことばかり言われていると、
       何を伸ばしたのかが分からなくなるので                     */
    // ずれがいちばん小さい＝求められているより出ているところ
    const best = gaps.slice().sort((a, b) => a.v - b.v)[0];
    const strong = -best.v;                    // 求められているより、どれだけ出ているか
    const B = D.BRIEF;
    const chance = clamp((strong - B.praiseFrom) / Math.max(0.001, B.praiseFull),
                         0, B.praiseMax);
    if (top.v < B.goodUnder || Math.random() < chance) {
      /* 良いところも、ひとつに決め打ちしない。
         求められているよりはっきり出ているところなら、どれも口に出る。
         いちばん出ているところとの比で絞ると、
         物差しの大きい項目（乗り味）だけを毎週言うことになる      */
      const gpool = gaps.filter(x => x.v <= -B.praiseFrom);
      const gp = (gpool.length ? gpool : [best])[rint(0, Math.max(0, gpool.length - 1))] || best;
      const pr = D.PRAISES.filter(x => x.key === gp.key)[0] || D.PRAISES[0];
      return { def: pr, good: true, gap: Math.round(top.v * 1000) / 1000, all: gaps };
    }

    /* ---- 言い出す候補 ----
       いちばん大きいずれの 72% までは、口に出る可能性がある。
       いつも同じ台詞にならないための幅                         */
    const band = top.v * D.BRIEF.pickBand;
    const pool = cand.filter(x => x.v >= band);
    const pick = pool[rint(0, pool.length - 1)] || top;
    return { def: pick.def, good: false,
             gap: Math.round(pick.v * 1000) / 1000, all: gaps,
             pack: pick.def.pack || null };
  }
  function fixOdds(g2) {
    return clamp(D.BRIEF.fixBase + org(g2).dept.engineer * D.BRIEF.fixEng
               + roomPower(g2) * D.BRIEF.fixRoom, 0.10, D.BRIEF.fixMax);
  }
  function dataOdds(g2) {
    return clamp(D.BRIEF.dataBase + analystPower(g2) * D.BRIEF.dataAnalyst
               + roomPower(g2) * D.BRIEF.dataRoom, 0.10, D.BRIEF.dataMax);
  }

  /* =======================================================
     エグゼクティブ講習
     人は現場でしか育たない、というのは半分だけ本当で、
     残りの半分は、いちど現場を離れないと身につかない。
     出しているあいだ、その人はチームにほとんど居ない。
     ======================================================= */
  function schoolList(g2) { return g2.school || []; }
  function schoolOpen(g2) { return (g2.school || []).length < D.SCHOOL.slots; }
  function personOf(g2, who, id) {
    if (who === 'mgr') return (g2.managers || {})[id] || null;
    return (g2.staff || []).filter(x => x.id === id)[0] || null;
  }
  /* その人を、その講習に出せるか */
  function courseOpen(g2, who, id, key) {
    const c = D.COURSES.filter(x => x.key === key)[0];
    const p = personOf(g2, who, id);
    if (!c || !p || p.away > 0) return false;
    if ((p.skill || 0) < c.need) return false;
    return (p.courses || []).indexOf(key) < 0;
  }
  function enrol(g2, who, id, key) {
    const c = D.COURSES.filter(x => x.key === key)[0];
    if (!c || !schoolOpen(g2) || !courseOpen(g2, who, id, key)) return null;
    if (g2.funds < c.cost) return null;
    const p = personOf(g2, who, id);
    g2.funds -= c.cost;
    p.away = c.weeks;
    g2.school = (g2.school || []).concat([{
      who: who, id: id, name: p.name, course: key, left: c.weeks, weeks: c.weeks
    }]);
    return { course: c, person: p };
  }
  /* 毎週1つ減らし、終わった人を帰す */
  function tickSchool(g2) {
    const done = [];
    g2.school = (g2.school || []).filter(e => {
      const p = personOf(g2, e.who, e.id);
      e.left -= 1;
      if (p && p.away > 0) p.away -= 1;
      if (e.left > 0) return true;
      const c = D.COURSES.filter(x => x.key === e.course)[0];
      if (!p || !c) return false;
      p.away = 0;
      const up = rnd(c.skill[0], c.skill[1]);
      p.skill = Math.round((p.skill + up) * 10) / 10;
      p.courses = (p.courses || []).concat([c.key]);
      p.net = Math.round(((p.net || 0) + (c.net || 0)) * 10) / 10;
      let gotTrait = null;
      if (c.trait && (p.traits || []).indexOf(c.trait) < 0) {
        p.traits = (p.traits || []).concat([c.trait]);
        gotTrait = D.STAFF_TRAITS.filter(x => x.key === c.trait)[0] || null;
      }
      if (c.exp) p.exp = (p.exp || 0) + c.exp;
      if (c.fia) fiaWarmAll(g2, c.fia);      // 同じ教室に、裁く側の人間が座っている
      if (p.salary != null && staffSalary) p.salary = staffSalary(p);
      done.push({ name: p.name, course: c, up: Math.round(up * 10) / 10,
                  trait: gotTrait, fia: c.fia || 0 });
      return false;
    });
    return done;
  }

  /* =======================================================
     FIA に移った人たち
     うちを離れた人が、そのまま業界から消えるとは限らない。
     何人かは競技団体に入り、規則を作る側、裁く側に回る。
     どう送り出したかが、何年かあとの車検場で返ってくる。
     ======================================================= */
  function joinFIA(g2, person, warm, why) {
    if (Math.random() >= D.FIA.joinOdds) return null;
    const rec = {
      name: person.name, role: pick(D.FIA.ROLES),
      warm: Math.round(clamp(warm + envScore(g2) * D.FIA.warmEnv, -100, 100)),
      since: g2.season || 1, why: why || '',
      type: person.type || null
    };
    g2.fia = (g2.fia || []).concat([rec]);
    return rec;
  }
  /* いま、裁く側にどれだけ味方（あるいは敵）がいるか（-1..1） */
  function fiaFavor(g2) {
    const list = (g2.fia || []).slice()
      .sort((a, b) => Math.abs(b.warm) - Math.abs(a.warm))
      .slice(0, D.FIA.cap);
    if (!list.length) return 0;
    const sum = list.reduce((a, x) => a + x.warm, 0);
    return clamp(sum / (D.FIA.perPerson * D.FIA.cap), -1, 1);
  }
  function fiaWarmAll(g2, amount) {
    (g2.fia || []).forEach(x => { x.warm = Math.round(clamp(x.warm + amount, -100, 100)); });
    return (g2.fia || []).length;
  }
  /* 顔を出しに行く。金と1週ではなく、金だけで少し温まる */
  function fiaVisit(g2) {
    if (!(g2.fia || []).length) return null;
    if (g2.funds < D.FIA.visitCost) return null;
    g2.funds -= D.FIA.visitCost;
    const gain = D.FIA.visitWarm * (1 + osk(g2, 'nego') * 0.10);
    fiaWarmAll(g2, gain);
    return Math.round(gain * 10) / 10;
  }
  /* 気持ちは風化する。恩も恨みも、そのままでは続かない */
  function fiaDrift(g2) {
    (g2.fia || []).forEach(x => {
      x.warm = Math.round(x.warm * (1 - D.FIA.drift));
    });
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
  /* ---------- 置ける人の数 ----------
     腕の良い人が応募してくるかどうかは、チームの規模で決まる。
     ではその人たちを何人置けるかというと、それは建物の話になる。
     机も、工具も、無線の席も、有限だから。
     どの施設を伸ばしても席は増えるので、
     「まず建てて、それから雇う」という順番が生まれる。          */
  function staffSlots(g2) {
    const f = g2.facilities || {};
    const lv = D.FACILITIES.reduce((a, c) => a + ((f[c.key] || 1) - 1), 0);
    return D.STAFF_SLOTS.base + Math.floor(lv / D.STAFF_SLOTS.per)
         + (hasEstate(g2, 'academy') ? 1 : 0);
  }
  function staffRoom(g2) {
    return Math.max(0, staffSlots(g2) - ((g2.staff || []).length));
  }

  function youthSlots(g2) {
    return 1 + Math.floor(((g2.facilities && g2.facilities.youth) || 1) / 2)
             + (hasEstate(g2, 'academy') ? 2 : 0);
  }

  /* 毎週の成長。才能とアカデミーのレベルで伸びが変わる */
  function growYouth(g2) {
    const lv = (g2.facilities && g2.facilities.youth) || 1;
    const trainer = trainPower(g2);
    const grown = [];
    (g2.youth || []).forEach(d => {
      // 若いうちほど伸びる。24歳を過ぎるとほとんど伸びなくなる
      const ageMul = d.age <= 21 ? 1 : d.age <= 23 ? 0.55 : 0.12;
      const gearMul = 1 + (hasGear(g2, 'youth', 'dorm') ? 0.15 : 0)
                        + (hasGear(g2, 'youth', 'lab') ? 0.10 : 0)
                        // 毎日いくらでも走れる場所。素質は走った距離で開く
                        + (hasGear(g2, 'youth', 'ykart') ? 0.14 : 0)
                        + (hasEstate(g2, 'kart') ? 0.12 : 0)
                        + (hasEstate(g2, 'academy') ? 0.20 : 0);
      const rate = potOf(d).growth * (0.55 + lv * 0.16 + trainer * 0.05)
                 * ageMul * gearMul * rigMul(g2, 'youth');
      ['speed', 'technique', 'stamina', 'mental'].forEach(k => {
        const extra = (k === 'stamina' && hasGear(g2, 'youth', 'lab')) ? 1.35 : 1;
        d[k] = clamp(d[k] + rnd(0.15, 0.75) * rate * extra * (1 - d[k] / 300), 1, 199);
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
                * (1 + envScore(g) * D.ENVW.growth)      // 働きやすい職場ほど伸びる
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
      // 施設が増えたセーブは、下限で埋めておく。
      // ミッションコントロールを備品として買っていた人は、その値打ちを引き継ぐ
      g.facilities = g.facilities || {};
      D.FACILITIES.forEach(f => {
        if (g.facilities[f.key] == null) {
          g.facilities[f.key] = (f.key === 'mission' &&
            (g.gear || []).indexOf('factory:mission') >= 0) ? 3 : 1;
        }
      });
      // 端数のまま保存された技能を丸めておく（過去の不具合ぶん）
      (g.staff || []).forEach(st => {
        if (typeof st.skill === 'number' && st.skill % 1 !== 0) st.skill = Math.round(st.skill);
      });
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
      /* 熟成とレアリティをやめて、品質ひとつにした。
         古いセーブのレアリティは、そのまま器の大きさとして読み替える */
      const toQual = q => {
        if (!q) return;
        if (q.quality == null) q.quality = qualOf(q);
        if (q.mat == null) q.mat = 0;
        delete q.polish; delete q.rarity;
      };
      D.PART_CATS.forEach(c => toQual(g.equipped && g.equipped[c.key]));
      (g.inventory || []).forEach(toQual);
      (g.stock || []).forEach(toQual);
      if (g.spare == null) g.spare = 0;
      /* 研究の単位を部位から扇へ移した。
         古い鍵のまま持っていても意味が合わないので、いちど畳む */
      if (!g.capLift) {
        g.capLift = {};
        g.research = {};
      }
      if (!g.ideas) g.ideas = [];
      /* ライバルの水準を、世代の器を基準にした物差しへ乗せ替えた。
         古いセーブは低いままなので、ここで一度だけ高さを揃える。
         向きの配分はそのチームらしさなので、比だけ保って伸ばす   */
      if (!g.rivalScaled && (g.rivals || []).length) {
        const d3 = diffOf(g);
        g.rivals.forEach(r => {
          const src = D.RIVALS.find(x => x.name === r.name);
          if (!src || !r.stats) return;
          const want = rivalLevel(src.power, g.season || 1, g.carGen || 0,
                                  d3.rivalPower, d3.rivalGrow, d3.tight || 0);
          const now = (r.stats.speed + r.stats.corner + r.stats.accel) / 3;
          if (!(now > 0)) return;
          const mul = Math.max(1, want / now);
          ['speed', 'corner', 'accel'].forEach(k => { r.stats[k] *= mul; });
          r.base0 = null;
        });
        g.rivalScaled = 1;
      }
      // 規則の読みかたは、途中から入れたぶんを引いておく
      if ((g.rivals || []).some(r => r.eraRoll == null)) rollEraFit(g);
      if (!g.mat) g.mat = {};
      if (!g.matP) g.matP = {};
      D.PART_GROUPS.forEach(gr => {
        if (g.mat[gr.key] == null) g.mat[gr.key] = 0;
        if (g.matP[gr.key] == null) g.matP[gr.key] = 0;
      });
      // あとから増えたパーツ区分は、いまのマシン世代の下限で作っておく
      if (g.equipped) {
        D.PART_CATS.forEach(c => {
          if (g.equipped[c.key]) return;
          const cap = D.CAR_GENS[Math.min(D.CAR_GENS.length - 1, g.carGen || 0)].cap;
          g.equipped[c.key] = makePart(c.key, g.carGen || 0, 1.0,
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
    makeDriver, careOf, careTier, careCrashMul, careMissMul, repairCut,
    makeStaff, staffSalary, staffCap, staffNeed, staffGrowMul, staffSlots, staffRoom,
    staffRank, nextStaffRank, staffTitle,
    addStaffExp, addStaffExpAll, retireStaff, stTrait, traitOf, rollStaffTraits,
    promotableRoles, promoteStaff, PROMOTE_MIN,
    paidIncome, isPaid,
    driverOut, airTemp, roadTemp, tyreBand, tyreOff, tempTier, tyreTempFit, meetingLv, roomPower, trustOf, trustTier, addTrust, trustDrift, ignoreRate, trustDev,
    briefFind, fixOdds, dataOdds,
    schoolList, schoolOpen, courseOpen, enrol, tickSchool, personOf,
    joinFIA, fiaFavor, fiaWarmAll, fiaVisit, fiaDrift,
    makeRivalStaff, poachFee, poachAttempt, keepStaff, loseStaff, makeRivals, developRivals, tickRivalOwners, rivalCarry, driverRating, resetNames, growStaff,
    diffOf, potOf, rollPotential, renegotiate, makeYouth, youthSlots, growYouth, promoteYouth,
    costCap, capSpent, capLeft, capRatio, spendCapped, settleCap, devRate, repairBill,
    techLv, techProg, techDef, techList, techStep, techCost, advanceTech,
    researchPower, researchOf, advanceResearch, useFinding, findingsOf, researchList,
    groupOfBody, capLiftOf, liftConcept, offCapOf,
    qualOf, qualTier, qualStars, rollQuality, groupOfPart,
    chassisStats, chassisOf, chassisTrait, rollChassis,
    spareOf, spareCost, buySpare, weekendHitOdds, rollWeekendHit, applyWeekendFix, crewBoost,
    partsLean, carDirection, meshScore, integrateRate,
    matOf, matDef, matNext, matPoints, addMatPoint, matUp, integrateOf, depotSetup,
    hasGear, gearList, buyGear, envScore, envTier,
    kitLv, kitOf, kitEff, kitList, buyKit,
    hasEstate, estateList, buyEstate, estateUpkeep, runKart, kartReward, kartRating, kartName,
    supplierPower, tickEngine, myPuPower, puRank01, canSupplyPU, customerOffers,
    signCustomer, dropCustomer, dropCustomerFee, customerFee, tickCustomers, rivalPuOf,
    supplySec,
    tickCustomerYears, puDevMul, isCustomer,
    hypeTier, hypeBonus, addHype, perkCut, perkPrice, perkList,
    supplyList, supplySlots, supplyOpen, signSupply, dropSupply, dropSupplyCost,
    supplyFee, supplyDeep, tickSupply, gearUpkeep, kitPrice, sponsorOpen, titleOf, titleOpen, signTitle, teamLabel, tickTitle, atrOf, atrLabel, aduoOf, aduoMul, puLimit, innovFresh, secToScore, innovName, rollBreakthrough,
    ideaList, addIdea, ideaOf, useIdea, ideaLeft, rollEraFit, eraFitOf, eraReadOf,
    setTrend, trendOf, canCopyTrend, copyTrend, copyRatio, letRivalCopy, topRival, leadCopy, doLeadCopy,
    tdFresh, tdRisk, tdDismiss, tdAppeal, tdLoss, tdFee, tdAccept, tdAppealNow, weekStamp, pushNews, pressTopic, championshipStake,
    fanTier, fanIncome, fanExpectation,
    makeOwner, osk, ownerRank, ownerProgress, addFame, learnOwnerSkill,
    buildCalendar, calendarOf, calendarDiff, raceCount, trackIdx, trackAt,
    REG_EVERY, regSince, regulationDue, regulationNext, applyRegulation,
    makeManager, mgr, finances, ersOf, ersFrom,
    puOf, puWear, usePU, nursePU, puReset, condLabel,
    relCare, relCut, partCondAvg,
    puTired, puDur, puHard, puCeil, puForm, puRelDrop, puPerf, puFreshCost, fitFreshPU, mountPU, puMode, setPuMode, overtakeEase,
    bodyCap, bodyCapOf, conceptOf, conceptOpen, setConcept, conceptDir, conceptMul,
    conceptPartMul, mgrFit, designBase, designMul,
    makeBody, bodyStats, bodyVal, bodyRatio, genProgress, genLagging, tryAdvanceGen, GEN_STEP_AT, focusOf, nextCarProgress, nextCarPreview, applyStock,
    logiPlan, logiLoad, logiCrew, crewEff, hasMission, missionLv, depotLv, depotCut, logiPower, logiCost, logiRisk, rollLogi, useSpares, crewPenalty, pitCrew, org, groupOf, groupTable, synergyList, devPower, designPower, pitPower, readPower, trainPower, analystPower, tyreWear, naturalStops, tireCrew, restCrew,
    makePart, partNote, partModel, partStats, partCap, partScore, rollRarity, workshopOf, workshopNext, rigOf, rigNext, rigMul, rigTiers, wearParts, hasT,
    rollSkills, hasSkill, learnableSkills, teachSkill, SKILL_MAX,
    persOf, nationOf, reactToResult, quoteFor,
    setReserve, clearReserve, swapReserve, promoteReserve, injureDriver, tickInjuries, canDrive, rollAbsence, RESERVE_PAY,
    carStats, carScore, carScoreOf, dfBiasOf, wearCarOf, tyreKind, machineChar,
    newTyreBank, drawSet, returnSet, runSet, scrubBank, bankRows, bankFresh, usedLoss,
    fpTyrePlan, readCrew, tyreRead, tyreLifeRead, stopsRead,
    mechSynergy, mechLift, mechScore, mechName, packaging, packWorst, packScore, driverFit, reliability, foresightOf, wetSkillOf, tyreSkillOf, staffBonus, weeklyCost,
    newGame, allTeams, constructorTable, driverTable,
    raceWeek, SEASON_WEEKS, PREP_WEEKS, SUMMER_AT, SUMMER_WEEKS, summerFrom, summerTo, inSummer,
    save, load, wipe
  };
})();

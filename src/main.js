/* =========================================================
   ゲーム本体：週の進行・各コマンド・レース進行
   ========================================================= */
window.GP = window.GP || {};

(function () {
  'use strict';
  const D = GP.data, S = GP.state, U = GP.ui, R = GP.race, RV = GP.raceview;
  const $ = id => document.getElementById(id);
  const money = U.money, esc = U.esc;
  let g = null;

  /* =======================================================
     週の進行
     ======================================================= */
  function isRaceWeek() { return g.nextRace < D.TRACKS.length && g.week === S.raceWeek(g.nextRace); }

  function endWeek() {
    // 固定費
    const cost = S.weeklyCost(g);
    g.funds -= cost;
    if (g.funds < 0) {
      U.log(g, '⚠️ 資金が底をついた！（' + money(g.funds) + '万）', 'bad');
      U.toast('⚠️ 資金がマイナスです！', 'bad');
      if (g.funds < -20000) return gameOver();
    }
    // 研究ポイントの自然増
    g.rp += 2 + Math.round(S.staffBonus(g, 'analyst'));
    // 下部組織の若手が育つ
    S.growYouth(g);
    // コンディション変動（放っておけば平常に戻る。悪循環にはまり込まないように）
    const drift = d => { d.form = S.clamp(d.form + (100 - d.form) * 0.14 + S.rnd(-4.5, 5), 62, 122); };
    g.drivers.forEach(d => { drift(d); levelCheck(d); });
    g.rivals.forEach(t => t.drivers.forEach(drift));   // ライバルも同じ条件で
    // ファンの自然減と、話題の風化
    g.fans = Math.max(0, g.fans - Math.round(g.fans * 0.006));
    S.addHype(g, -(g.hype || 0) * 0.035);

    g.week++;
    g.special = null;
    randomEvent();
    offerSpecial();
    offerSponsor();

    if (g.week > S.SEASON_WEEKS) return seasonEnd();
    S.save(g);
    render();
    if (isRaceWeek()) U.toast('🏁 今週はレースウィーク！', 'good');
  }

  function levelCheck(d) {
    while (d.exp >= 40 * d.expLv) {
      d.exp -= 40 * d.expLv;
      d.expLv++;
      const keys = ['speed', 'technique', 'stamina', 'mental'];
      const up = {};
      keys.forEach(k => { const v = S.rint(1, 4); d[k] = S.clamp(d[k] + v, 1, 199); up[k] = v; });
      d.salary = Math.round((d.speed + d.technique + d.stamina + d.mental) / 4 * 0.95 + 18);
      U.log(g, '⭐ ' + d.name + ' がレベルアップ！ (Lv.' + d.expLv + ')', 'good');
      U.pop('⭐ ' + d.name + ' Lv.' + d.expLv, 'good');
      GP.sound.play('levelup', 200);
      // レベルアップでスキルを閃くことがある
      const room = (d.skills || []).length < S.SKILL_MAX;
      if (room && Math.random() < 0.32) {
        const cand = S.learnableSkills(d);
        if (cand.length) {
          const sk = S.pick(cand);
          S.teachSkill(d, sk.key);
          U.log(g, '🎓 ' + d.name + ' がスキル「' + sk.name + '」を習得！', 'good');
          U.toast('🎓 ' + d.name + ' が ' + sk.icon + sk.name + ' を習得！', 'good');
        }
      }
    }
  }

  /* ---------- ランダムイベント（カイロ風の小さな事件） ---------- */
  const EVENTS = [
    { p: 0.06, run: () => { const m = S.rint(300, 1400); g.funds += m; return '💰 グッズが売れた！ +' + money(m) + '万'; } },
    { p: 0.05, run: () => { const f = S.rint(80, 400); g.fans += f; return '📺 テレビ特集が組まれた！ ファン +' + money(f); } },
    { p: 0.05, run: () => { const r = S.rint(6, 20); g.rp += r; return '💡 若手エンジニアがひらめいた！ 研究P +' + r; } },
    { p: 0.04, run: () => { const c = S.pick(D.PART_CATS); const p = g.equipped[c.key]; if (!p) return null;
        p.cond = S.clamp(p.cond - S.rint(8, 18), 10, 100); return '🔧 ' + p.name + 'に不具合が見つかった…'; } },
    { p: 0.04, run: () => { const d = S.pick(g.drivers); if (!d) return null; d.form = S.clamp(d.form + 12, 62, 122); return '😄 ' + d.name + ' の調子が上向いてきた！'; } },
    { p: 0.03, run: () => { const d = S.pick(g.drivers); if (!d) return null; d.form = S.clamp(d.form - 12, 62, 122); return '🤒 ' + d.name + ' が体調を崩している…'; } },
    { p: 0.03, run: () => { const m = S.rint(400, 1600); g.funds -= m; return '🧾 設備の修繕費がかかった… -' + money(m) + '万'; } },
    { p: 0.03, run: () => { const c = S.pick(D.PART_CATS); const p = g.equipped[c.key]; if (!p) return null;
        p.power = Math.round((p.power + 2) * 10) / 10; return '📐 ' + p.name + 'の設計を見直した！ 性能+2'; } },
    { p: 0.02, run: () => { const f = Math.round(g.fans * 0.06) + 50; g.fans += f; return '🎪 ファン感謝祭が大盛況！ ファン +' + money(f); } },
    { p: 0.02, run: () => { const d = S.pick(g.drivers); if (!d) return null; d.exp += 25; levelCheck(d); return '📚 ' + d.name + ' が自主練に励んだ！'; } }
  ];
  function randomEvent() {
    for (const e of EVENTS) {
      if (Math.random() < e.p) {
        const msg = e.run();
        if (msg) { U.log(g, msg); U.toast(msg); }
        return;
      }
    }
  }

  /* ---------- スポンサーからのオファー ----------
     注目度が高いと、まだ契約していない大手から向こうが声を掛けてくる     */
  function offerSponsor() {
    // 期限切れのオファーは引っ込む
    if (g.sponsorOffer && g.sponsorOffer.until != null && g.week > g.sponsorOffer.until) {
      U.log(g, '📞 ' + g.sponsorOffer.name + ' からのオファーは期限切れになった…', 'warn');
      g.sponsorOffer = null;
    }
    if (g.sponsorOffer) return;
    const slots = 2 + g.facilities.market;
    if (g.sponsors.length >= slots) return;
    const have = g.sponsors.map(x => x.name);
    const cand = D.SPONSORS.filter(sp => have.indexOf(sp.name) < 0 && S.sponsorOpen(g, sp));
    if (!cand.length) return;
    // 注目度が高いほど声が掛かりやすい
    if (Math.random() > 0.06 + (g.hype || 0) / 100 * 0.22) return;
    const sp = cand[cand.length - 1];        // 条件を満たす中でいちばん大きいところ
    g.sponsorOffer = { name: sp.name, adv: Math.round(sp.per * 8), until: g.week + 4 };
    GP.sound.play('confirm');
    U.log(g, '📞 ' + sp.name + ' から契約のオファーが届いた！（「営業」で確認）', 'good');
    U.toast('📞 ' + sp.name + ' からオファー！', 'good');
  }

  /* ---------- 特別戦の誘い ---------- */
  function offerSpecial() {
    if (isRaceWeek() || g.nextRace >= D.TRACKS.length) return;
    if (g.week >= S.SEASON_WEEKS - 1) return;          // 最終盤には来ない
    if (Math.random() > 0.24) return;
    const pool = D.SPECIALS.filter(x => g.season >= x.minSeason);
    if (!pool.length) return;
    const sp = S.pick(pool);
    g.special = { key: sp.key, trackIndex: S.rint(0, D.TRACKS.length - 1) };
    U.log(g, sp.icon + ' 「' + sp.name + '」への招待が届いた！', 'good');
    U.toast(sp.icon + ' ' + sp.name + ' への招待が届いた！', 'good');
  }

  function specialOf(g2) {
    return g2.special ? D.SPECIALS.find(x => x.key === g2.special.key) : null;
  }

  function enterSpecial() {
    const sp = specialOf(g);
    if (!sp) return;
    if (g.funds < sp.entry) return U.toast('エントリー費が足りません', 'bad');
    g.funds -= sp.entry;
    beginRace(g.special.trackIndex, sp);
  }

  /* =======================================================
     コマンド：開発
     ======================================================= */
  const improveCost = p => Math.round(D.PART_CATS.find(c => c.key === p.cat).cost * (1 + p.power / 20));
  const designCost = () => ({
    money: Math.round(1000 + g.carGen * 2200),
    rp: Math.round(26 + g.carGen * 24)
  });

  let useTicket = false;

  function cmdDevelop() {
    const tk = g.tickets || 0;
    if (!tk) useTicket = false;
    let body = '';
    if (tk) {
      body += '<div class="ticketbar' + (useTicket ? ' on' : '') + '" id="tkToggle">' +
        '<span class="tk-ic">🎫</span>' +
        '<span class="tk-body"><b>開発チケット ×' + tk + '</b>' +
        '<small>1枚使うと、次の開発・設計を資金も研究Pも使わずに行えます</small></span>' +
        '<span class="tk-sw">' + (useTicket ? '使う' : '使わない') + '</span></div>';
    }
    body += '<div class="sub">装着中パーツの改良</div><div class="pick">';
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) {
        body += '<div class="pickbtn done"><span class="pb-ic" style="background:' + c.color + '">' + c.icon + '</span>' +
          '<span class="pb-body"><b>' + c.name + '</b><small>パーツが未装着です</small></span><span class="pb-cost">—</span></div>';
        return;
      }
      const cost = improveCost(p), cap = S.partCap(g, p);
      const capped = p.power >= cap;
      const ok = useTicket || (g.funds >= cost && g.rp >= c.rp);
      body += '<button class="pickbtn" data-k="imp:' + c.key + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:' + c.color + '">' + c.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(p.name) + '</b>' +
        '<small>' + c.name + '／性能 ' + Math.round(p.power) + ' / 上限 ' + cap +
        (capped ? ' <em class="warn">上限到達</em>' : '') + '</small></span>' +
        '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>' : '💰' + money(cost) + '<br>🔬' + c.rp) + '</span></button>';
    });
    const dc = designCost();
    body += '</div><div class="sub">新しいパーツを設計する</div>' +
      '<p class="desc">デザイナーの腕が良いほど高レアリティのパーツができます。' +
      '完成したパーツは保管され、「マシン」から装着・合成できます。</p><div class="pick">';
    D.PART_CATS.forEach(c => {
      const ok = useTicket || (g.funds >= dc.money && g.rp >= dc.rp);
      body += '<button class="pickbtn" data-k="des:' + c.key + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:' + c.color + '">' + c.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(c.names[Math.min(c.names.length - 1, g.carGen)]) + ' を設計</b>' +
        '<small>' + c.name + '／' + D.CAR_GENS[g.carGen].name + '世代</small></span>' +
        '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>' : '💰' + money(dc.money) + '<br>🔬' + dc.rp) + '</span></button>';
    });
    body += '</div>';
    U.modal('🔧 マシン開発', body, [{ label: 'やめる', fn: U.closeModal }]);
    const tg = $('tkToggle');
    if (tg) tg.onclick = () => { useTicket = !useTicket; GP.sound.play('tap'); cmdDevelop(); };
    bindPick(k => {
      const [kind, key] = k.split(':');
      if (kind === 'imp') doImprove(key); else doDesign(key);
    });
  }

  /* チケットを1枚消費する。使わない場合は false を返す */
  function spendTicket() {
    if (!useTicket || !(g.tickets > 0)) return false;
    g.tickets--;
    useTicket = false;
    GP.sound.play('coin');
    U.log(g, '🎫 開発チケットを1枚使った。（残り ' + g.tickets + ' 枚）');
    return true;
  }

  function doImprove(key) {
    const c = D.PART_CATS.find(x => x.key === key);
    const p = g.equipped[key];
    if (!p) return;
    const cost = improveCost(p), cap = S.partCap(g, p);
    const free = spendTicket();
    if (!free) {
      if (g.funds < cost || g.rp < c.rp) return;
      g.funds -= cost; g.rp -= c.rp;
    }

    const facBonus = 1 + g.facilities.factory * 0.10 +
      ((key === 'aero' || key === 'susp') ? g.facilities.tunnel * 0.12 : 0);
    const engBonus = 1 + S.staffBonus(g, 'engineer') * 0.14;
    // ドライバーのフィードバック（職人肌ほど的確）
    const drvBonus = 1 + g.drivers.reduce((a, d) => a + S.persOf(d).dev, 0);
    let gain = S.rnd(3.4, 5.6) * facBonus * engBonus * drvBonus;
    let crit = false;
    if (Math.random() < 0.12) { gain *= 2.2; crit = true; }
    if (p.power >= cap) gain *= 0.16;
    gain = Math.round(gain * 10) / 10;

    p.power = Math.round((p.power + gain) * 10) / 10;
    p.cond = S.clamp(p.cond - S.rnd(2.5, 7) * (S.hasT(p, 'tough') ? 0.6 : 1), 10, 100);

    U.closeModal();
    const msg = c.icon + ' ' + p.name + ' の性能 +' + gain.toFixed(1) + (crit ? '  ✨ひらめき大成功！' : '');
    U.log(g, msg, crit ? 'good' : '');
    U.pop('+' + gain.toFixed(1), crit ? 'crit' : 'good');
    GP.sound.play(crit ? 'crit' : 'confirm');
    if (crit) U.toast('✨ ひらめいた！ 開発が大成功！', 'good');
    if (p.power >= cap) U.toast('このパーツは限界です。新型マシンか、より高レアなパーツが必要です。', 'warn');
    endWeek();
  }

  function doDesign(key) {
    const c = D.PART_CATS.find(x => x.key === key);
    const dc = designCost();
    if (g.inventory.length >= 24) { U.toast('保管庫がいっぱいです。「マシン」で合成・破棄しましょう。', 'warn'); return; }
    const free = spendTicket();
    if (!free) {
      if (g.funds < dc.money || g.rp < dc.rp) return;
      g.funds -= dc.money; g.rp -= dc.rp;
    }

    const rarity = S.rollRarity(g);
    const part = S.makePart(key, g.carGen, rarity);
    g.inventory.push(part);

    const rr = D.RARITY[rarity - 1];
    U.closeModal();
    U.log(g, '📐 ' + part.name + '（' + rr.name + '）が完成！ 性能 ' + Math.round(part.power), rarity >= 3 ? 'good' : '');
    GP.sound.play(rarity >= 4 ? 'crit' : 'confirm');
    if (rarity >= 4) U.toast('🎉 ' + rr.name + 'パーツ「' + part.name + '」が完成！', 'good');
    else U.toast('📐 ' + part.name + '（' + rr.name + '）が完成', rarity >= 3 ? 'good' : '');
    U.pop(U.stars(rarity), rarity >= 4 ? 'crit' : 'good');

    // 装着中より強ければすすめる
    const cur = g.equipped[key];
    if (!cur || S.partScore(part) > S.partScore(cur)) {
      U.toast('装着中の ' + (cur ? cur.name : '—') + ' より強力です！「マシン」で装着しましょう。', 'good');
    }
    endWeek();
  }

  /* =======================================================
     コマンド：研究（研究P獲得＋設計ティア解放）
     ======================================================= */
  function cmdResearch() {
    const cur = D.CAR_GENS[g.carGen], nx = D.CAR_GENS[g.carGen + 1];
    let body = '<div class="pick">' +
      '<button class="pickbtn" data-k="__gain"><span class="pb-ic" style="background:#8a6ad0">🔬</span>' +
      '<span class="pb-body"><b>データ解析</b><small>1週かけて研究ポイントを稼ぐ</small></span>' +
      '<span class="pb-cost">+' + Math.round(12 + S.staffBonus(g, 'analyst') * 4 + g.facilities.sim * 2) + '🔬</span></button></div>';

    body += '<div class="sub">新型マシンの開発</div>';
    body += '<p class="desc">現在のマシン：<b>' + cur.name + '</b>（全パーツの開発上限 ' + cur.cap + '／車体ベース +' + cur.base + '）</p>';
    if (!nx) {
      body += '<div class="bigbox">🏁 最終型 <b>' + cur.name + '</b> に到達済み</div>';
    } else {
      const ok = g.rp >= nx.rp && g.funds >= nx.cost;
      body += '<div class="pick"><button class="pickbtn" data-k="__gen"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#e04a3f">🏎️</span>' +
        '<span class="pb-body"><b>' + cur.name + ' → ' + nx.name + '</b>' +
        '<small>開発上限 ' + cur.cap + ' → ' + nx.cap + '／車体ベース +' + cur.base + ' → +' + nx.base +
        '<br>より高性能なパーツを設計できるようになります</small></span>' +
        '<span class="pb-cost">💰' + money(nx.cost) + '<br>🔬' + nx.rp + '</span></button></div>';
    }
    U.modal('🔬 研究開発', body, [{ label: 'やめる', fn: U.closeModal }]);
    bindPick(k => (k === '__gain') ? doResearchGain() : doNewCar());
  }

  function doResearchGain() {
    const gain = Math.round(12 + S.staffBonus(g, 'analyst') * 4 + g.facilities.sim * 2 + S.rnd(-2, 6));
    g.rp += gain;
    U.closeModal();
    U.log(g, '🔬 データ解析を行った。研究P +' + gain);
    U.pop('🔬+' + gain, 'good');
    endWeek();
  }

  function doNewCar() {
    const nx = D.CAR_GENS[g.carGen + 1];
    if (!nx || g.rp < nx.rp || g.funds < nx.cost) return;
    g.rp -= nx.rp; g.funds -= nx.cost; g.carGen++;
    // 新車のシェイクダウンで各パーツのコンディションが整う
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (p) p.cond = S.clamp(p.cond + 15, 10, 100);
    });
    U.closeModal();
    U.log(g, '🎊 新型マシン「' + nx.name + '」が完成！ 開発上限が ' + nx.cap + ' に上がった！', 'good');
    GP.sound.play('crit');
    U.toast('🎊 新型マシン「' + nx.name + '」ロールアウト！', 'good');
    U.pop('🏎️ ' + nx.name, 'crit');
    endWeek();
  }

  /* =======================================================
     コマンド：整備
     ======================================================= */
  function cmdMaintain() {
    const sum = D.PART_CATS.reduce((a, c) => a + (g.equipped[c.key] ? g.equipped[c.key].power : 0), 0);
    const cost = Math.round(400 + sum * 6);
    const body = '<p class="lead">マシンを分解整備して信頼性を回復します。</p>' +
      '<div class="bigbox">現在の信頼性 <b>' + Math.round(S.reliability(g)) + '%</b></div>' +
      '<p class="desc">費用：💰' + money(cost) + '万（1週消費）<br>各パーツのコンディションが大きく回復します。</p>';
    U.modal('🛠️ 分解整備', body, [
      { label: '整備する', cls: 'primary', disabled: g.funds < cost, fn: () => doMaintain(cost) },
      { label: 'やめる', fn: U.closeModal }
    ]);
  }
  function doMaintain(cost) {
    g.funds -= cost;
    const mech = 1 + S.staffBonus(g, 'mechanic') * 0.2 + g.facilities.pit * 0.08;
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (p) p.cond = S.clamp(p.cond + S.rnd(16, 26) * mech, 10, 100);
    });
    U.closeModal();
    U.log(g, '🛠️ 分解整備を行った。信頼性 ' + Math.round(S.reliability(g)) + '%', 'good');
    U.pop('🛠️ 信頼性UP', 'good');
    endWeek();
  }

  /* =======================================================
     コマンド：練習
     ======================================================= */
  function cmdTrain() {
    if (!g.drivers.length) return U.toast('ドライバーがいません', 'bad');
    const menu = [['speed', '速さ', '🏎️'], ['technique', '技術', '🎯'], ['stamina', '体力', '💪'], ['mental', '精神', '🧠']];
    let body = '<p class="lead">ドライバーと鍛える能力を選んでください。</p>';
    g.drivers.forEach((d, i) => {
      body += '<div class="trainrow"><div class="tr-nm">' + esc(d.name) + '<small>調子 ' + Math.round(d.form) + '</small></div><div class="tr-btns">';
      menu.forEach(m => { body += '<button class="pickbtn small" data-k="' + i + ':' + m[0] + '">' + m[2] + ' ' + m[1] + '</button>'; });
      body += '</div></div>';
    });
    const cost = 250 + g.facilities.sim * 60;
    body += '<p class="desc">費用：💰' + money(cost) + '万（1週消費）</p>';

    const scost = Math.round(2600 + g.season * 900);
    body += '<div class="sub">スキル特訓</div>' +
      '<p class="desc">集中特訓で新しいスキルを習得させます（1週消費・費用 💰' + money(scost) + '万）。<br>' +
      'トレーナーとシミュレーターが優秀なほど、良いスキルを覚えやすくなります。</p><div class="pick">';
    g.drivers.forEach((d, i) => {
      const full = (d.skills || []).length >= S.SKILL_MAX;
      const cand = S.learnableSkills(d);
      const ok = !full && cand.length && g.funds >= scost;
      body += '<button class="pickbtn" data-k="skill:' + i + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#8a6ad0">🎓</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + ' に特訓</b>' +
        '<small>習得済み ' + (d.skills || []).length + ' / ' + S.SKILL_MAX +
        (full ? '（スキル枠が満杯）' : '') + '</small></span>' +
        '<span class="pb-cost">💰' + money(scost) + '</span></button>';
    });
    body += '</div>';

    U.modal('💪 トレーニング', body, [{ label: 'やめる', fn: U.closeModal }], { wide: true });
    bindPick(k => {
      if (k.indexOf('skill:') === 0) doSkillTrain(+k.split(':')[1], scost);
      else doTrain(k, cost);
    });
  }

  function doSkillTrain(idx, cost) {
    const d = g.drivers[idx];
    if (!d || g.funds < cost) return;
    const cand = S.learnableSkills(d);
    if (!cand.length || (d.skills || []).length >= S.SKILL_MAX) return;
    g.funds -= cost;

    // トレーナーと施設が良いほど候補から複数回引き、良いスキルを引き当てやすい
    const tries = 1 + Math.min(3, Math.floor(S.staffBonus(g, 'trainer') * 0.8 + g.facilities.sim * 0.3));
    let best = null;
    for (let i = 0; i < tries; i++) {
      const pick = S.pick(cand);
      if (!best || Math.random() < 0.5) best = pick;
    }
    S.teachSkill(d, best.key);
    d.exp += 15; d.form = S.clamp(d.form - S.rnd(2, 6), 62, 122);
    levelCheck(d);
    U.closeModal();
    U.log(g, '🎓 ' + d.name + ' がスキル「' + best.name + '」を習得！', 'good');
    GP.sound.play('levelup');
    U.toast('🎓 ' + best.icon + ' ' + best.name + ' を習得！', 'good');
    U.pop('🎓 ' + best.name, 'crit');
    endWeek();
  }
  function doTrain(k, cost) {
    if (g.funds < cost) return U.toast('資金が足りません', 'bad');
    const [i, stat] = k.split(':');
    const d = g.drivers[+i];
    g.funds -= cost;
    const bonus = (1 + g.facilities.sim * 0.14 + S.staffBonus(g, 'trainer') * 0.16) * S.persOf(d).train;
    let gain = Math.round(S.rnd(2.2, 4.4) * bonus * (1 - d[stat] / 320) * 10) / 10;
    gain = Math.max(0.5, gain);
    if (Math.random() < 0.10) { gain *= 2.4; U.toast('🔥 特訓が実を結んだ！', 'good'); }
    d[stat] = S.clamp(d[stat] + gain, 1, 199);
    d.form = S.clamp(d.form - S.rnd(0, 4), 62, 122);
    d.exp += 8;
    d.salary = Math.round((d.speed + d.technique + d.stamina + d.mental) / 4 * 0.95 + 18);
    levelCheck(d);
    U.closeModal();
    const nm = { speed: '速さ', technique: '技術', stamina: '体力', mental: '精神' }[stat];
    U.log(g, '💪 ' + d.name + ' の' + nm + ' +' + gain.toFixed(1));
    U.pop('+' + gain.toFixed(1) + ' ' + nm, 'good');
    endWeek();
  }

  /* =======================================================
     コマンド：営業（スポンサー）
     ======================================================= */
  function cmdSponsor() {
    const slots = 2 + g.facilities.market;
    const have = g.sponsors.map(s => s.name);
    const avail = D.SPONSORS.filter(s => S.sponsorOpen(g, s) && have.indexOf(s.name) < 0);
    const ht = S.hypeTier(g);
    let body = '<p class="lead">スポンサー枠 ' + g.sponsors.length + ' / ' + slots + '（マーケティング室の拡張で増えます）</p>' +
      '<div class="hypebox"><span>' + ht.icon + ' メディアでの扱い <b style="color:' + ht.color + '">' + ht.name + '</b></span>' +
      '<span>スポンサー収入 <b>×' + S.hypeBonus(g).toFixed(2) + '</b></span></div>';

    if (g.sponsorOffer) {
      const sp = D.SPONSORS.find(x => x.name === g.sponsorOffer.name);
      if (sp) {
        body += '<div class="sub">📞 届いているオファー</div><div class="pick">' +
          '<button class="pickbtn offer" data-k="__offer">' +
          '<span class="pb-ic" style="background:#b06fd0">' + sp.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(sp.name) + ' から契約の打診</b>' +
          '<small>毎戦 ' + money(sp.per) + '万／' + sp.need + '位以内でボーナス ' + money(sp.bonus) + '万' +
          '<br>先方からの申し出なので契約金が上乗せされる：<b>+' + money(g.sponsorOffer.adv) + '万</b>' +
          (g.sponsorOffer.until != null ? '　<em class="warn">残り' + Math.max(0, g.sponsorOffer.until - g.week + 1) + '週</em>' : '') +
          '</small></span>' +
          '<span class="pb-cost">受ける</span></button></div>';
      }
    }
    body += '<div class="pick"><button class="pickbtn" data-k="__ad"><span class="pb-ic" style="background:#f0a020">📣</span>' +
      '<span class="pb-body"><b>プロモーション活動</b><small>ファンを増やし、少し資金も入る</small></span>' +
      '<span class="pb-cost">+ファン</span></button></div>';
    body += '<div class="sub">契約できるスポンサー</div><div class="pick">';
    if (!avail.length) body += '<p class="desc">いまの規模で契約できる相手がいません。' +
      'ファンを増やし、レースで上位に食い込んで注目度を上げましょう。</p>';
    avail.forEach(s => {
      const full = g.sponsors.length >= slots;
      body += '<button class="pickbtn" data-k="' + esc(s.name) + '"' + (full ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:#4ea63f">' + s.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(s.name) + '</b><small>毎戦 ' + money(s.per) + '万／' + s.need + '位以内でボーナス ' + money(s.bonus) + '万</small></span>' +
        '<span class="pb-cost">契約</span></button>';
    });
    body += '</div><div class="sub">契約中</div><div class="pick">';
    g.sponsors.forEach(s => {
      body += '<div class="pickbtn done"><span class="pb-ic" style="background:#4ea63f">' + s.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(s.name) + '</b><small>毎戦 ' + money(s.per) + '万</small></span>' +
        '<span class="pb-cost"><button class="mini danger" data-drop="' + esc(s.name) + '">解約</button></span></div>';
    });
    body += '</div>';
    U.modal('📣 営業活動', body, [{ label: 'やめる', fn: U.closeModal }]);
    bindPick(k => {
      if (k === '__ad') return doPromo();
      if (k === '__offer') return doAcceptOffer();
      doSign(k);
    });
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-drop]'), b => {
      b.onclick = () => {
        g.sponsors = g.sponsors.filter(s => s.name !== b.dataset.drop);
        U.log(g, '📣 ' + b.dataset.drop + ' との契約を解除した。');
        cmdSponsor();
      };
    });
  }
  function doPromo() {
    const f = Math.round((180 + g.fans * 0.10) * (1 + g.facilities.market * 0.18) * S.rnd(0.8, 1.3));
    const m = Math.round(f * 1.4);
    g.fans += f; g.funds += m;
    U.closeModal();
    GP.sound.play('coin');
    U.log(g, '📣 プロモーション活動。ファン +' + money(f) + '／収入 +' + money(m) + '万', 'good');
    U.pop('👥+' + money(f), 'good');
    endWeek();
  }
  function doAcceptOffer() {
    if (!g.sponsorOffer) return;
    const sp = D.SPONSORS.find(x => x.name === g.sponsorOffer.name);
    if (!sp) { g.sponsorOffer = null; return; }
    const slots = 2 + g.facilities.market;
    if (g.sponsors.length >= slots) { U.toast('スポンサー枠が空いていません', 'warn'); return; }
    const adv = g.sponsorOffer.adv;
    g.sponsors.push(Object.assign({}, sp));
    g.funds += adv;
    g.sponsorOffer = null;
    GP.sound.play('coin');
    U.closeModal();
    U.log(g, '🤝 ' + sp.name + ' のオファーを受けた！ 契約金 +' + money(adv) + '万', 'good');
    U.toast('🤝 ' + sp.name + ' と契約成立！', 'good');
    endWeek();
  }

  function doSign(name) {
    const s = D.SPONSORS.find(x => x.name === name);
    if (!s) return;
    g.sponsors.push(Object.assign({}, s));
    const adv = Math.round(s.per * 4);
    g.funds += adv;
    U.closeModal();
    GP.sound.play('coin');
    U.log(g, '🤝 ' + s.name + ' と契約！ 契約金 +' + money(adv) + '万', 'good');
    U.toast('🤝 ' + s.name + ' と契約成立！', 'good');
    endWeek();
  }

  /* =======================================================
     フリーメニュー：マシン（装着・合成・保管）
     ======================================================= */
  const fuseCost = m => Math.round(400 + m.power * 22);

  function cmdGarage() {
    let body = '<div class="sub">装着中のパーツ</div><div class="parts">';
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      const spare = g.inventory.filter(x => x.cat === c.key).length;
      const btn = '<span class="p-act"><button class="mini" data-swap="' + c.key + '"' +
        (spare ? '' : ' disabled') + '>交換' + (spare ? '(' + spare + ')' : '') + '</button></span>';
      body += p ? U.partRow(g, p, { trailing: btn })
        : '<div class="part empty"><span class="p-ic">' + c.icon + '</span>' +
          '<span class="p-nm">' + c.name + '<small>未装着</small></span>' + btn + '</div>';
    });
    body += '</div>';

    body += '<div class="sub">保管パーツ（' + g.inventory.length + ' / 24）</div>';
    if (!g.inventory.length) {
      body += '<p class="desc">保管パーツはありません。「開発」→「新しいパーツを設計する」で作れます。</p>';
    } else {
      body += '<p class="desc">合成すると素材の性能の一部を引き継ぎ、レアリティが上がることがあります（素材は消滅）。</p><div class="parts">';
      g.inventory.forEach(p => {
        const act = '<span class="p-act">' +
          '<button class="mini" data-eq="' + p.id + '">装着</button>' +
          '<button class="mini" data-fuse="' + p.id + '">合成</button>' +
          '<button class="mini danger" data-del="' + p.id + '">破棄</button></span>';
        body += U.partRow(g, p, { trailing: act });
      });
      body += '</div>';
    }

    U.modal('🏎️ マシン', body, [{ label: '閉じる', fn: U.closeModal }], { wide: true });
    bindAct('data-swap', k => openSwap(k));
    bindAct('data-eq', id => { doEquip(id); cmdGarage(); });
    bindAct('data-fuse', id => openFuse(id));
    bindAct('data-del', id => {
      const p = g.inventory.find(x => x.id === id);
      if (!p) return;
      U.modal('パーツを破棄', '<p class="lead">「' + esc(p.name) + '」を破棄しますか？<br>元には戻せません。</p>', [
        { label: '破棄する', cls: 'danger', fn: () => {
            g.inventory = g.inventory.filter(x => x.id !== id);
            U.log(g, '🗑️ ' + p.name + ' を破棄した。');
            S.save(g); render(); cmdGarage();
          } },
        { label: 'やめる', fn: cmdGarage }
      ]);
    });
  }

  function bindAct(attr, fn) {
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[' + attr + ']'), b => {
      b.onclick = () => fn(b.getAttribute(attr));
    });
  }

  function openSwap(catKey) {
    const c = D.PART_CATS.find(x => x.key === catKey);
    const list = g.inventory.filter(p => p.cat === catKey);
    let body = '<p class="lead">' + c.name + ' に装着するパーツを選んでください。</p>';
    const cur = g.equipped[catKey];
    if (cur) body += '<div class="sub">装着中</div><div class="parts">' + U.partRow(g, cur) + '</div>';
    body += '<div class="sub">保管パーツ</div><div class="parts">';
    list.forEach(p => {
      body += U.partRow(g, p, { trailing: '<span class="p-act"><button class="mini" data-eq="' + p.id + '">装着</button></span>' });
    });
    body += '</div>';
    U.modal('🔄 パーツ交換', body, [{ label: '戻る', fn: cmdGarage }], { wide: true });
    bindAct('data-eq', id => { doEquip(id); cmdGarage(); });
  }

  function doEquip(id) {
    const p = g.inventory.find(x => x.id === id);
    if (!p) return;
    const old = g.equipped[p.cat];
    g.inventory = g.inventory.filter(x => x.id !== id);
    g.equipped[p.cat] = p;
    if (old) g.inventory.push(old);
    U.log(g, '🔄 ' + p.name + ' を装着した。' + (old ? '（' + old.name + ' を保管）' : ''), 'good');
    U.toast('🔄 ' + p.name + ' を装着！', 'good');
    S.save(g); render();
  }

  function openFuse(materialId) {
    const m = g.inventory.find(x => x.id === materialId);
    if (!m) return;
    const c = D.PART_CATS.find(x => x.key === m.cat);
    const cost = fuseCost(m);
    const cands = [];
    if (g.equipped[m.cat]) cands.push({ p: g.equipped[m.cat], where: '装着中' });
    g.inventory.forEach(p => { if (p.cat === m.cat && p.id !== m.id) cands.push({ p: p, where: '保管' }); });

    let body = '<p class="lead">素材：<b>' + esc(m.name) + '</b>（' + U.stars(m.rarity) + '／性能 ' + Math.round(m.power) + '）<br>' +
      'この素材を吸収させる ' + c.name + ' を選んでください。</p>' +
      '<p class="desc">性能を <b>+' + Math.round(m.power * 0.45) + '</b> 引き継ぎ、' +
      Math.round((0.22 + m.rarity * 0.08) * 100) + '% の確率でレアリティが1段階上がります。<br>' +
      '費用 💰' + money(cost) + '万（週は消費しません）</p>';
    if (!cands.length) {
      body += '<div class="bigbox">同じ種類のパーツがありません</div>';
    } else {
      body += '<div class="parts">';
      cands.forEach(x => {
        body += U.partRow(g, x.p, { trailing: '<span class="p-act"><small>' + x.where + '</small>' +
          '<button class="mini" data-base="' + x.p.id + '"' + (g.funds < cost ? ' disabled' : '') + '>合成</button></span>' });
      });
      body += '</div>';
    }
    U.modal('⚗️ パーツ合成', body, [{ label: '戻る', fn: cmdGarage }], { wide: true });
    bindAct('data-base', id => doFuse(id, materialId));
  }

  function doFuse(baseId, materialId) {
    const m = g.inventory.find(x => x.id === materialId);
    if (!m) return;
    const base = (g.equipped[m.cat] && g.equipped[m.cat].id === baseId)
      ? g.equipped[m.cat] : g.inventory.find(x => x.id === baseId);
    if (!base) return;
    const cost = fuseCost(m);
    if (g.funds < cost) return;
    g.funds -= cost;

    const gain = Math.round(m.power * 0.45 * 10) / 10;
    base.power = Math.round((base.power + gain) * 10) / 10;
    let up = false;
    if (base.rarity < 5 && Math.random() < 0.22 + m.rarity * 0.08) { base.rarity++; up = true; }
    // 素材の追加効果を引き継ぐことがある
    let inherited = null;
    (m.traits || []).forEach(t => {
      if (base.traits.indexOf(t) < 0 && base.traits.length < 2 && Math.random() < 0.45) {
        base.traits.push(t); inherited = t;
      }
    });
    base.cond = S.clamp(base.cond + 6, 10, 100);
    g.inventory = g.inventory.filter(x => x.id !== materialId);

    let msg = '⚗️ ' + base.name + ' に ' + m.name + ' を合成！ 性能 +' + gain.toFixed(1);
    if (up) msg += '  ⭐レアリティが ' + D.RARITY[base.rarity - 1].name + ' に上がった！';
    if (inherited) {
      const t = D.PART_TRAITS.find(x => x.key === inherited);
      if (t) msg += '  ' + t.icon + t.name + ' を引き継いだ！';
    }
    U.log(g, msg, up ? 'good' : '');
    GP.sound.play(up ? 'crit' : 'upgrade');
    U.toast(up ? '⭐ ' + D.RARITY[base.rarity - 1].name + ' に進化！' : '⚗️ 合成成功！ 性能 +' + gain.toFixed(1), up ? 'good' : '');
    U.pop('+' + gain.toFixed(1), up ? 'crit' : 'good');
    S.save(g); render(); cmdGarage();
  }

  /* =======================================================
     フリーメニュー：施設
     ======================================================= */
  let baseSel = 'factory';

  function facilityCost(key) {
    const f = D.FACILITIES.find(x => x.key === key);
    const lv = g.facilities[key];
    return Math.round(f.base * Math.pow(lv, 1.55));
  }

  function cmdFacility() {
    const sc = GP.base.scale(g);
    const body =
      '<div class="baseinfo"><span>チーム規模 <b>' + sc.rank + '</b></span>' +
      '<span>施設を広げるほど、本拠地は大きく賑やかになります</span></div>' +
      '<div class="basewrap"><canvas id="baseCv" width="' + GP.base.W + '" height="' + GP.base.H + '"></canvas></div>' +
      '<div id="baseDetail"></div>';
    U.modal('🏗️ チーム本拠地', body, [{ label: '閉じる', fn: () => { GP.sound.play('tap'); U.closeModal(); } }], { wide: true });
    drawBase();
    const cv = $('baseCv');
    cv.onclick = ev => {
      const r = cv.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (GP.base.W / r.width);
      const y = (ev.clientY - r.top) * (GP.base.H / r.height);
      const k = GP.base.hit(x, y);
      if (k) { baseSel = k; GP.sound.play('tap'); drawBase(); }
    };
  }

  function drawBase() {
    const cv = $('baseCv');
    if (!cv) return;
    GP.base.render(cv, g, baseSel);
    const f = D.FACILITIES.find(x => x.key === baseSel);
    const lv = g.facilities[baseSel];
    const cost = facilityCost(baseSel);
    const max = lv >= 10;
    let h = '<div class="sub">' + f.icon + ' ' + f.name + '</div>' +
      '<p class="desc">' + f.desc + '</p>' +
      '<div class="lvbar"><span>Lv.' + lv + '</span><i>';
    for (let i = 1; i <= 10; i++) h += '<b class="' + (i <= lv ? 'on' : '') + '"></b>';
    h += '</i><span>' + (max ? 'MAX' : 'Lv.' + (lv + 1) + ' へ') + '</span></div>' +
      '<div class="basebtns">' +
      '<button class="btn primary" id="baseUp"' + ((max || g.funds < cost) ? ' disabled' : '') + '>' +
      (max ? '最大まで拡張済み' : '🔨 拡張する　💰' + money(cost) + '万') + '</button></div>' +
      '<div class="pick basepick">';
    D.FACILITIES.forEach(x => {
      const l2 = g.facilities[x.key], c2 = facilityCost(x.key);
      h += '<button class="pickbtn small' + (x.key === baseSel ? ' on' : '') + '" data-fac="' + x.key + '">' +
        x.icon + ' ' + x.name + ' <b>Lv.' + l2 + '</b>' +
        (l2 >= 10 ? ' <em>MAX</em>' : ' <em>💰' + money(c2) + '</em>') + '</button>';
    });
    h += '</div>';
    $('baseDetail').innerHTML = h;

    const up = $('baseUp');
    if (up) up.onclick = () => {
      const c = facilityCost(baseSel);
      if (g.funds < c || g.facilities[baseSel] >= 10) return;
      g.funds -= c; g.facilities[baseSel]++;
      const fa = D.FACILITIES.find(x => x.key === baseSel);
      GP.sound.play('build');
      U.log(g, '🏗️ ' + fa.name + ' を Lv.' + g.facilities[baseSel] + ' に拡張した！', 'good');
      U.toast('🏗️ ' + fa.name + ' Lv.' + g.facilities[baseSel] + '！', 'good');
      S.save(g); render(); drawBase();
      const sc2 = GP.base.scale(g);
      if (sc2.rank !== GP.base.scale({ facilities: Object.assign({}, g.facilities, { [baseSel]: g.facilities[baseSel] - 1 }), fans: g.fans, titles: g.titles }).rank) {
        GP.sound.play('levelup');
        U.toast('🎊 チーム規模が「' + sc2.rank + '」になった！', 'good');
        U.log(g, '🎊 チーム規模が「' + sc2.rank + '」に成長した！', 'good');
      }
    };
    Array.prototype.forEach.call($('baseDetail').querySelectorAll('[data-fac]'), b => {
      b.onclick = () => { baseSel = b.dataset.fac; GP.sound.play('tap'); drawBase(); };
    });
  }

  /* =======================================================
     フリーメニュー：人事
     ======================================================= */
  let staffMarket = null, driverMarket = null, youthMarket = null, mgrMarket = null;
  let hrTab = 'drivers';

  function teamQuality() { return GP.base.scale(g).value; }

  function refreshMarkets(force) {
    const q = teamQuality();
    if (force || !staffMarket) staffMarket = [0, 1, 2, 3].map(() => S.makeStaff(S.pick(D.STAFF_TYPES).key, q));
    if (force || !driverMarket) driverMarket = [0, 1, 2].map(() => S.makeDriver(1.2 + g.season * 1.4 + S.rnd(-0.6, 1.2)));
    if (force || !youthMarket) youthMarket = [0, 1, 2].map(() => S.makeYouth(g.season));
    if (force || !mgrMarket) mgrMarket = D.MANAGERS.map(m => S.makeManager(m.key, q));
  }

  const youthFee = d => Math.round(600 + S.driverRating(d) * 26 + d.pot * 900);
  const staffFee = st => st.salary * 8;
  const mgrFee = m => Math.round(m.salary * 10);

  function youthRow(d, actions) {
    const pt = S.potOf(d);
    return '<div class="pickbtn done youthrow">' +
      '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
      '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' +
      S.nationOf(d).flag + ' ' + d.age + '歳／総合 ' + Math.round(S.driverRating(d)) +
      '<br>才能 <em style="color:' + pt.color + '">' + U.stars(d.pot) + ' ' + pt.name + '</em>' +
      '　' + S.persOf(d).icon + S.persOf(d).name +
      '<br>速' + Math.round(d.speed) + ' 技' + Math.round(d.technique) +
      ' 体' + Math.round(d.stamina) + ' 精' + Math.round(d.mental) +
      '</small></span><span class="pb-cost">' + actions + '</span></div>';
  }

  /* スタッフ1人の能力表示 */
  function staffRow(st, actions, extra) {
    const t = D.STAFF_TYPES.find(x => x.key === st.type);
    const pct = Math.min(100, st.skill / 60 * 100);
    const rank = st.skill >= 45 ? '一流' : st.skill >= 32 ? '熟練' : st.skill >= 20 ? '中堅' : '見習い';
    return '<div class="pickbtn done staffrow">' +
      '<span class="pb-ic" style="background:#7b5a3a">' + t.icon + '</span>' +
      '<span class="pb-body"><b>' + esc(st.name) + '</b>' +
      '<small>' + t.name + '　<em class="srank">' + rank + '</em>' +
      '<br><span class="skbar"><i style="width:' + pct + '%"></i></span> 技能 <b>' + st.skill + '</b>' +
      '<br>' + t.desc + (extra || '') + '</small></span>' +
      '<span class="pb-cost">週' + money(st.salary) + '万<br>' + actions + '</span></div>';
  }

  function cmdStaff() {
    refreshMarkets(false);
    const tabs = [['drivers', '🧑‍✈️ ドライバー'], ['youth', '🎓 育成'],
                  ['staff', '👥 スタッフ'], ['mgmt', '👔 首脳陣']];
    let body = '<div class="hrtabs">' +
      tabs.map(t => '<button class="hrtab' + (hrTab === t[0] ? ' on' : '') + '" data-hr="' + t[0] + '">' + t[1] + '</button>').join('') +
      '</div>';

    if (hrTab === 'drivers') body += hrDrivers();
    else if (hrTab === 'youth') body += hrYouth();
    else if (hrTab === 'staff') body += hrStaff();
    else body += hrManagement();

    U.modal('👥 人事', body, [
      { label: '🔄 市場を更新（500万）', disabled: g.funds < 500,
        fn: () => { g.funds -= 500; refreshMarkets(true); render(); cmdStaff(); } },
      { label: '閉じる', fn: U.closeModal }
    ], { wide: true });

    Array.prototype.forEach.call($('modalBody').querySelectorAll('.hrtab'), b => {
      b.onclick = () => { hrTab = b.dataset.hr; GP.sound.play('tap'); cmdStaff(); };
    });
    bindPick(k => hrPick(k));
    bindHrActions();
  }

  /* ---- ドライバー ---- */
  function hrDrivers() {
    let body = '<div class="sub">所属ドライバー（' + g.drivers.length + '/2）</div><div class="pick">';
    g.drivers.forEach(d => {
      body += '<div class="pickbtn done">' +
        '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' + S.nationOf(d).flag + ' 総合 ' +
        Math.round(S.driverRating(d)) + '／' + d.age + '歳／' + S.persOf(d).icon + S.persOf(d).name +
        '<br>' + U.skillChips(d) + '</small></span>' +
        '<span class="pb-cost">週' + money(d.salary) + '万<br><button class="mini danger" data-fired="' + d.id + '">解雇</button></span></div>';
    });
    body += '</div><div class="sub">ドライバー市場</div><div class="pick">';
    driverMarket.forEach((d, i) => {
      const fee = Math.round(d.salary * 12);
      const full = g.drivers.length >= 2;
      body += '<button class="pickbtn" data-k="dm:' + i + '"' + ((full || g.funds < fee) ? ' disabled' : '') + '>' +
        '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' + S.nationOf(d).flag + ' 総合 ' +
        Math.round(S.driverRating(d)) + '／' + d.age + '歳／' + S.persOf(d).icon + S.persOf(d).name +
        '<br>速' + Math.round(d.speed) + ' 技' + Math.round(d.technique) + ' 体' + Math.round(d.stamina) + ' 精' + Math.round(d.mental) +
        '<br>' + U.skillChips(d) + '</small></span>' +
        '<span class="pb-cost">契約金<br>💰' + money(fee) + '</span></button>';
    });
    return body + '</div>';
  }

  /* ---- 下部組織 ---- */
  function hrYouth() {
    const slots = S.youthSlots(g);
    let body = '<div class="sub">🎓 下部組織（' + (g.youth || []).length + '/' + slots + '）</div>' +
      '<p class="desc">若手は毎週すこしずつ成長します。ユースアカデミーを拡張すると' +
      '伸びが速くなり、抱えられる人数も増えます。24歳を過ぎると伸びしろがなくなります。</p><div class="pick">';
    if (!(g.youth || []).length) body += '<p class="desc">育成中の若手はいません。</p>';
    (g.youth || []).forEach(d => {
      body += youthRow(d,
        '<button class="mini" data-promote="' + d.id + '"' + (g.drivers.length < 2 ? '' : ' disabled') + '>昇格</button>' +
        '<button class="mini danger" data-release="' + d.id + '">放出</button>');
    });
    body += '</div><div class="sub">若手スカウト</div><div class="pick">';
    youthMarket.forEach((d, i) => {
      const fee = youthFee(d);
      const full = (g.youth || []).length >= slots;
      body += '<button class="pickbtn" data-k="ym:' + i + '"' + ((full || g.funds < fee) ? ' disabled' : '') + '>' +
        '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' + S.nationOf(d).flag + ' ' + d.age + '歳／総合 ' +
        Math.round(S.driverRating(d)) + '<br>才能 <em style="color:' + S.potOf(d).color + '">' +
        U.stars(d.pot) + ' ' + S.potOf(d).name + '</em></small></span>' +
        '<span class="pb-cost">💰' + money(fee) + '</span></button>';
    });
    return body + '</div>';
  }

  /* ---- 現場スタッフ ---- */
  function hrStaff() {
    const q = teamQuality();
    let body = '<p class="lead">チームの規模が大きいほど、腕の良い人材が応募してきます。' +
      '<br>いまの規模：<b>' + GP.base.scale(g).rank + '</b></p>';
    body += '<div class="sub">在籍スタッフ（' + g.staff.length + '人）</div><div class="pick">';
    if (!g.staff.length) body += '<p class="desc">スタッフがいません。</p>';
    // 職種ごとの合計効果も見えるようにする
    const byType = {};
    g.staff.forEach(st => { byType[st.type] = (byType[st.type] || 0) + st.skill; });
    g.staff.slice().sort((a, b) => b.skill - a.skill).forEach(st => {
      body += staffRow(st, '<button class="mini danger" data-firestaff="' + st.id + '">解雇</button>');
    });
    body += '</div>';
    body += '<div class="sub">職種ごとの厚み</div><div class="deptgrid">';
    D.STAFF_TYPES.forEach(t => {
      const v = byType[t.key] || 0;
      body += '<div class="dept"><span>' + t.icon + ' ' + t.name + '</span>' +
        '<i><b style="width:' + Math.min(100, v / 120 * 100) + '%"></b></i><em>' + v + '</em></div>';
    });
    body += '</div>';
    body += '<div class="sub">スタッフ市場</div><div class="pick">';
    staffMarket.forEach((st, i) => {
      const fee = staffFee(st);
      body += '<button class="pickbtn" data-k="sm:' + i + '"' + (g.funds < fee ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:#7b5a3a">' +
        (D.STAFF_TYPES.find(x => x.key === st.type) || {}).icon + '</span>' +
        '<span class="pb-body"><b>' + esc(st.name) + '</b><small>' +
        (D.STAFF_TYPES.find(x => x.key === st.type) || {}).name + '／技能 ' + st.skill +
        '<br><span class="skbar"><i style="width:' + Math.min(100, st.skill / 60 * 100) + '%"></i></span>' +
        '</small></span><span class="pb-cost">💰' + money(fee) + '<br><em>週' + money(st.salary) + '</em></span></button>';
    });
    return body + '</div>';
  }

  /* ---- 首脳陣 ---- */
  function hrManagement() {
    let body = '<p class="lead">役職は1人ずつ。据えるとチーム全体に効きます。</p><div class="pick">';
    D.MANAGERS.forEach(m => {
      const cur = g.managers && g.managers[m.key];
      if (cur) {
        body += '<div class="pickbtn done mgmtrow">' +
          '<span class="pb-ic" style="background:#8a5a2a">' + m.icon + '</span>' +
          '<span class="pb-body"><b>' + m.name + '：' + esc(cur.name) + '</b>' +
          '<small><span class="skbar"><i style="width:' + Math.min(100, cur.skill / 60 * 100) + '%"></i></span> 技能 <b>' + cur.skill + '</b>' +
          '<br>' + m.desc + '<br><em class="mgeff">' + m.effect + '</em></small></span>' +
          '<span class="pb-cost">週' + money(cur.salary) + '万<br>' +
          '<button class="mini danger" data-firemgr="' + m.key + '">解任</button></span></div>';
      } else {
        body += '<div class="pickbtn done mgmtrow empty">' +
          '<span class="pb-ic" style="background:#a89878">' + m.icon + '</span>' +
          '<span class="pb-body"><b>' + m.name + '</b><small>空席<br>' + m.desc + '</small></span>' +
          '<span class="pb-cost">—</span></div>';
      }
    });
    body += '</div><div class="sub">候補者</div><div class="pick">';
    mgrMarket.forEach((cand, i) => {
      const m = D.MANAGERS.find(x => x.key === cand.role);
      const cur = g.managers && g.managers[cand.role];
      const fee = mgrFee(cand);
      const better = cur ? cand.skill - cur.skill : null;
      body += '<button class="pickbtn" data-k="mm:' + i + '"' + (g.funds < fee ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:#8a5a2a">' + m.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(cand.name) + '</b><small>' + m.name + '／技能 ' + cand.skill +
        (better !== null ? '（現任と<em class="' + (better > 0 ? 'good' : 'bad') + '">' + (better > 0 ? '+' : '') + better + '</em>）' : '') +
        '<br><span class="skbar"><i style="width:' + Math.min(100, cand.skill / 60 * 100) + '%"></i></span>' +
        '</small></span><span class="pb-cost">💰' + money(fee) + '<br><em>週' + money(cand.salary) + '</em></span></button>';
    });
    return body + '</div>';
  }

  /* ---- 操作 ---- */
  function hrPick(k) {
    const parts = k.split(':');
    const kind = parts[0], idx = +parts[1];
    if (kind === 'dm') {
      const d = driverMarket[idx], fee = Math.round(d.salary * 12);
      if (g.drivers.length >= 2 || g.funds < fee) return;
      g.funds -= fee; d.team = g.team; g.drivers.push(d);
      driverMarket.splice(idx, 1);
      U.log(g, '🧑‍✈️ ' + d.name + ' と契約した！', 'good');
      U.toast('🧑‍✈️ ' + d.name + ' が加入！', 'good');
    } else if (kind === 'ym') {
      const d = youthMarket[idx], fee = youthFee(d);
      if ((g.youth || []).length >= S.youthSlots(g) || g.funds < fee) return;
      g.funds -= fee;
      g.youth = (g.youth || []).concat([d]);
      youthMarket.splice(idx, 1);
      GP.sound.play('confirm');
      U.log(g, '🎓 若手の ' + d.name + '（' + S.potOf(d).name + '）を獲得した！', 'good');
      U.toast('🎓 ' + d.name + ' が下部組織に加入！', 'good');
    } else if (kind === 'sm') {
      const st = staffMarket[idx], fee = staffFee(st);
      if (g.funds < fee) return;
      g.funds -= fee; g.staff.push(st);
      staffMarket.splice(idx, 1);
      U.log(g, '👥 ' + st.name + ' を雇用した。（技能 ' + st.skill + '）', 'good');
      U.toast('👥 ' + st.name + ' が加入！', 'good');
    } else if (kind === 'mm') {
      const cand = mgrMarket[idx], fee = mgrFee(cand);
      if (g.funds < fee) return;
      const m = D.MANAGERS.find(x => x.key === cand.role);
      const cur = g.managers && g.managers[cand.role];
      g.funds -= fee;
      g.managers = g.managers || {};
      g.managers[cand.role] = cand;
      mgrMarket.splice(idx, 1);
      GP.sound.play('levelup');
      U.log(g, '👔 ' + m.name + ' に ' + cand.name + ' が就任！（技能 ' + cand.skill + '）' +
        (cur ? ' ' + cur.name + ' は退任した。' : ''), 'good');
      U.toast('👔 ' + m.name + '：' + cand.name + ' が就任！', 'good');
    }
    S.save(g); render(); cmdStaff();
  }

  function bindHrActions() {
    const body = $('modalBody');
    Array.prototype.forEach.call(body.querySelectorAll('[data-promote]'), b => {
      b.onclick = () => {
        const d = S.promoteYouth(g, b.dataset.promote);
        if (!d) return;
        GP.sound.play('levelup');
        U.log(g, '🎉 ' + d.name + ' がトップチームに昇格！ デビュー戦が待っている。', 'good');
        U.toast('🎉 ' + d.name + ' が昇格！', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-release]'), b => {
      b.onclick = () => {
        const d = (g.youth || []).find(x => x.id === b.dataset.release);
        if (!d) return;
        g.youth = g.youth.filter(x => x.id !== b.dataset.release);
        U.log(g, '👋 若手の ' + d.name + ' を放出した。');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-fired]'), b => {
      b.onclick = () => {
        const d = g.drivers.find(x => x.id === b.dataset.fired);
        if (!d) return;
        g.funds -= d.salary * 6;
        g.drivers = g.drivers.filter(x => x.id !== b.dataset.fired);
        U.log(g, '👋 ' + d.name + ' との契約を解除した（違約金 ' + money(d.salary * 6) + '万）。');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-firestaff]'), b => {
      b.onclick = () => {
        const st = g.staff.find(x => x.id === b.dataset.firestaff);
        if (!st) return;
        g.funds -= st.salary * 4;
        g.staff = g.staff.filter(x => x.id !== b.dataset.firestaff);
        U.log(g, '👋 ' + st.name + ' を解雇した（違約金 ' + money(st.salary * 4) + '万）。');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-firemgr]'), b => {
      b.onclick = () => {
        const key = b.dataset.firemgr;
        const cur = g.managers && g.managers[key];
        if (!cur) return;
        g.funds -= cur.salary * 6;
        delete g.managers[key];
        const m = D.MANAGERS.find(x => x.key === key);
        U.log(g, '👋 ' + m.name + ' の ' + cur.name + ' を解任した（違約金 ' + money(cur.salary * 6) + '万）。');
        S.save(g); render(); cmdStaff();
      };
    });
  }

  /* =======================================================
     レース
     ======================================================= */
  let pendingStrategy = {};
  let raceCtx = { trackIndex: 0, special: null };

  function cmdRace() { beginRace(g.nextRace, null); }

  function beginRace(trackIndex, special) {
    const t = D.TRACKS[trackIndex];
    if (g.drivers.length === 0) return U.toast('ドライバーがいません！', 'bad');
    raceCtx = { trackIndex: trackIndex, special: special };
    pendingStrategy = {};
    g.drivers.forEach(d => { pendingStrategy[d.id] = 'balance'; });
    const laps = Math.max(4, Math.round(t.laps * (special ? special.lapMul : 1)));

    let body = '<div class="racehead"><b>' +
      (special ? special.icon + ' ' + esc(special.name) : '第' + (trackIndex + 1) + '戦') + ' ' +
      t.country + ' ' + esc(t.name) + '</b>' +
      '<span>' + laps + '周 ／ ' + esc(t.desc) + '</span></div>';
    if (special) body += '<p class="note">' + esc(special.note) + '</p>';
    body += '<div class="sub">作戦を決める</div>';
    g.drivers.forEach(d => {
      body += '<div class="stratrow"><div class="sr-nm">' + esc(d.name) + '<small>調子 ' + Math.round(d.form) + '</small></div><div class="sr-btns" data-drv="' + d.id + '">';
      Object.keys(R.STRATEGIES).forEach(k => {
        const st = R.STRATEGIES[k];
        body += '<button class="stratbtn' + (k === 'balance' ? ' on' : '') + '" data-s="' + k + '">' + st.icon + '<br>' + st.name + '</button>';
      });
      body += '</div></div>';
    });
    body += '<p class="desc">🛡️ 安全第一＝ペースは落ちるがリタイアしにくい／🔥 攻める＝速いがミスとタイヤ消耗のリスク大</p>';

    // ---- スタートタイヤ ----
    const wet = false;   // 天候は決勝直前まで分からないので、雨なら自動で雨用に替わる
    body += '<div class="sub">スタートタイヤ</div>' +
      '<p class="desc">最初のスティントで履くタイヤです。以降は残り周回に合わせて自動で選ばれます。<br>' +
      '雨の場合は自動的に雨用タイヤになります。</p>';
    g.drivers.forEach(d => {
      body += '<div class="stratrow"><div class="sr-nm">' + esc(d.name) + '</div><div class="sr-btns tyres" data-tdrv="' + d.id + '">';
      D.DRY_TYRES.forEach((k, i) => {
        const t = D.TYRES.find(x => x.key === k);
        body += '<button class="tyrebtn' + (i === 1 ? ' on' : '') + '" data-t="' + k + '"' +
          ' title="' + esc(t.desc) + '" style="--tc:' + t.color + ';--tt:' + t.text + '">' +
          '<b>' + t.short + '</b><small>' + t.name + '<br>目安' + t.life + '周</small></button>';
      });
      body += '</div></div>';
      pendingStrategy['tyre_' + d.id] = 'medium';
    });

    U.modal(special ? special.icon + ' ' + special.name : '🏁 レースウィーク', body, [
      { label: '🏁 コースイン！', cls: 'primary', fn: startRace },
      { label: special ? 'やめておく' : 'まだ準備する', fn: U.closeModal }
    ]);

    Array.prototype.forEach.call($('modalBody').querySelectorAll('.stratbtn'), b => {
      b.onclick = () => {
        const wrap = b.parentElement;
        Array.prototype.forEach.call(wrap.children, c => c.classList.remove('on'));
        b.classList.add('on');
        pendingStrategy[wrap.dataset.drv] = b.dataset.s;
      };
    });
    Array.prototype.forEach.call($('modalBody').querySelectorAll('.tyrebtn'), b => {
      b.onclick = () => {
        const wrap = b.parentElement;
        Array.prototype.forEach.call(wrap.children, c => c.classList.remove('on'));
        b.classList.add('on');
        pendingStrategy['tyre_' + wrap.dataset.tdrv] = b.dataset.t;
      };
    });
  }

  let currentRes = null;
  function startRace() {
    currentRes = R.simulate(g, raceCtx.trackIndex, pendingStrategy, raceCtx.special);
    showQualifying();
  }

  function showQualifying() {
    const res = currentRes;
    let body = '<div class="racehead"><b>' + res.weather.icon + ' ' + res.weather.name + '</b><span>予選結果</span></div>';
    body += '<div class="gridlist">';
    res.grid.slice(0, 22).forEach(e => {
      body += '<div class="gridrow' + (e.isPlayer ? ' me' : '') + '">' +
        '<span class="gp-pos">' + e.grid + '</span>' +
        '<span class="rk-chip" style="background:' + e.color + '"></span>' +
        '<span class="gp-nm">' + esc(e.driver.name) + '</span>' +
        '<span class="gp-tm">' + esc(e.team.name) + '</span>' +
        '<span class="gp-t">' + fmtTime(e.qTime) + '</span></div>';
    });
    body += '</div>';
    U.modal('⏱️ 予選', body, [{ label: '🚦 決勝スタート！', cls: 'primary', fn: runRace }], { wide: true });
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const r = (s - m * 60);
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
  }

  function runRace() {
    U.closeModal();
    $('raceScreen').className = 'show';
    const cv = $('raceCanvas');
    cv.width = 560; cv.height = 400;
    $('rvTrack').textContent = currentRes.track.country + ' ' + currentRes.track.name;
    $('rvWeather').textContent = currentRes.weather.icon + ' ' + currentRes.weather.name;
    RV.start(cv, currentRes, showResult);
  }

  function showResult() {
    const res = currentRes;
    const reward = R.applyResult(g, res);
    setTimeout(() => {
      $('raceScreen').className = '';
      let body = '<div class="racehead"><b>' +
        (res.special ? res.special.icon + ' ' + esc(res.special.name) : '第' + (res.trackIndex + 1) + '戦') +
        ' ' + esc(res.track.name) + '</b><span>' + res.weather.icon + ' ' + res.weather.name + '</span></div>';
      body += '<div class="gridlist">';
      res.classified.slice(0, 22).forEach(e => {
        body += '<div class="gridrow' + (e.isPlayer ? ' me' : '') + (e.dnf ? ' dnf' : '') + '">' +
          '<span class="gp-pos' + (e.pos === 1 && !e.dnf ? ' gold' : e.pos === 2 && !e.dnf ? ' silver' : e.pos === 3 && !e.dnf ? ' bronze' : '') + '">' + (e.dnf ? '-' : e.pos) + '</span>' +
          '<span class="rk-chip" style="background:' + e.color + '"></span>' +
          '<span class="gp-nm">' + esc(e.driver.name) + '</span>' +
          '<span class="gp-tm">' + esc(e.team.name) + '</span>' +
          '<span class="gp-mv ' + (e.grid > e.pos ? 'up' : e.grid < e.pos ? 'down' : '') + '">' +
          (e.dnf ? 'DNF' : (e.grid > e.pos ? '▲' + (e.grid - e.pos) : e.grid < e.pos ? '▼' + (e.pos - e.grid) : '－')) + '</span>' +
          '<span class="gp-t">' + (e.dnf ? esc(e.dnfReason) : (e.points ? '+' + e.points + 'pt' : '')) +
          (e.flPoint ? '<em class="flp" title="ファステストラップ +1">⚡</em>' : '') + '</span></div>';
      });
      body += '</div>';
      const ht = S.hypeTier(g);
      const hd = res.hypeDelta || 0;
      body += '<div class="rewardbox">' +
        '<div>💰 賞金 <b>+' + money(reward.prize) + '万</b></div>' +
        '<div>📣 スポンサー <b>+' + money(reward.sponsorIncome) + '万</b><small>注目度 ×' + S.hypeBonus(g).toFixed(2) + '</small></div>' +
        '<div>👥 ファン <b class="' + (reward.fanDelta >= 0 ? 'good' : 'bad') + '">' + (reward.fanDelta >= 0 ? '+' : '') + money(reward.fanDelta) + '</b></div>' +
        '<div>' + ht.icon + ' 注目度 <b class="' + (hd >= 0 ? 'good' : 'bad') + '">' + (hd >= 0 ? '+' : '') + hd.toFixed(1) + '</b><small>' + ht.name + '</small></div>' +
        '</div>';
      if (res.fastestLap) {
        const scored = !res.fastestLap.dnf && res.fastestLap.pos <= D.POINTS.length && !res.special;
        body += '<p class="desc">⚡ ファステストラップ：' + esc(res.fastestLap.driver.name) +
          '（' + fmtTime(res.fastestLap.fastest) + '）' +
          (scored ? ' — 10位以内で完走のためボーナス <b>+1pt</b>' : ' — 10位以内ではないためボーナスなし') + '</p>';
      }

      // 性格に応じて調子が動き、ひとことを残す
      const said = [];
      res.classified.filter(e => e.isPlayer).forEach(e => {
        const q = S.quoteFor(e.driver, e.pos, e.dnf, said);
        said.push(q);
        const p = S.persOf(e.driver);
        body += '<div class="quote">' + U.face(e.driver, 30) +
          '<span><em>' + esc(e.driver.name) + '（' + p.icon + p.name + '）</em>「' + esc(q) + '」</span></div>';
        U.log(g, '💬 ' + e.driver.name + '「' + q + '」');
      });
      reward.notes.forEach(n => { body += '<p class="note">' + esc(n) + '</p>'; U.log(g, n, 'good'); });

      const bestMine = res.classified.filter(e => e.isPlayer).sort((a, b) => a.pos - b.pos)[0];
      if (bestMine) {
        if (!bestMine.dnf && bestMine.pos === 1) GP.sound.play('win');
        else if (!bestMine.dnf && bestMine.pos <= 3) GP.sound.play('podium');
        else if (bestMine.dnf || bestMine.pos > 10) GP.sound.play('bad');
        else GP.sound.play('confirm');
      }

      U.modal(res.special ? '🎪 特別戦の結果' : '🏆 レース結果', body,
        [{ label: 'ガレージへ戻る', cls: 'primary', fn: afterRace }], { wide: true });
    }, 900);
  }

  function afterRace() {
    U.closeModal();
    if (!raceCtx.special) g.nextRace++;
    g.special = null;
    g.drivers.forEach(d => levelCheck(d));
    endWeek();
  }

  /* =======================================================
     シーズン終了
     ======================================================= */
  function seasonEnd() {
    const table = S.constructorTable(g);
    const rank = table.findIndex(r => r.isPlayer) + 1;
    const prize = D.PRIZE[Math.min(D.PRIZE.length - 1, rank - 1)];
    const dTable = S.driverTable(g);
    const champ = dTable[0];
    const myChamp = g.drivers.find(d => d.name === champ.name);

    g.funds += prize;
    GP.sound.play(rank <= 3 ? 'win' : 'podium');
    if (rank === 1) { g.titles.teams++; g.fans += Math.round(g.fans * 0.3) + 2000; }
    if (myChamp) { g.titles.drivers++; g.fans += Math.round(g.fans * 0.2) + 1500; }

    let body = '<div class="racehead"><b>シーズン ' + g.season + ' 終了！</b><span>コンストラクターズ ' + rank + '位</span></div>';
    body += '<div class="gridlist">';
    table.forEach((r, i) => {
      body += '<div class="gridrow' + (r.isPlayer ? ' me' : '') + '">' +
        '<span class="gp-pos' + (i === 0 ? ' gold' : i === 1 ? ' silver' : i === 2 ? ' bronze' : '') + '">' + (i + 1) + '</span>' +
        '<span class="rk-chip" style="background:' + r.color + '"></span>' +
        '<span class="gp-nm">' + esc(r.name) + '</span><span class="gp-t">' + r.points + 'pt</span></div>';
    });
    body += '</div>';
    body += '<p class="note">🏅 ドライバーズチャンピオン：' + esc(champ.name) + '（' + esc(champ.team) + '） ' + champ.points + 'pt</p>';
    if (rank === 1) body += '<p class="note big">🏆🏆 コンストラクターズチャンピオン獲得！！ 🏆🏆</p>';
    if (myChamp) body += '<p class="note big">🎉 ' + esc(myChamp.name) + ' がドライバーズタイトルを獲得！</p>';
    body += '<div class="rewardbox"><div>💰 シーズン賞金 <b>+' + money(prize) + '万</b></div></div>';

    U.modal('🎊 シーズン終了', body, [{ label: '次のシーズンへ →', cls: 'primary', fn: nextSeason }], { wide: true });
    U.log(g, '🎊 シーズン' + g.season + ' 終了。コンストラクターズ ' + rank + '位。賞金 +' + money(prize) + '万', 'good');
  }

  function nextSeason() {
    U.closeModal();
    g.history.push({ season: g.season, points: g.points, rank: S.constructorTable(g).findIndex(r => r.isPlayer) + 1 });
    g.season++;
    g.week = 1;
    g.nextRace = 0;
    g.points = 0;
    g.results = [];
    // ドライバーの加齢
    const retired = [];
    g.drivers.forEach(d => {
      d.seasonPoints = 0; d.age++;
      if (d.age > 33) {
        const dec = (d.age - 33) * S.rnd(1.5, 4);
        ['speed', 'stamina'].forEach(k => { d[k] = S.clamp(d[k] - dec, 1, 199); });
      } else {
        d.mental = S.clamp(d.mental + S.rnd(1, 3), 1, 199);
      }
      if (d.age >= 38 && Math.random() < 0.45) retired.push(d);
    });
    retired.forEach(d => {
      g.drivers = g.drivers.filter(x => x.id !== d.id);
      U.log(g, '👋 ' + d.name + ' が引退を表明した。長い間おつかれさま。', 'warn');
    });
    // 若手の加齢と、育ちきった選手のお知らせ
    (g.youth || []).forEach(d => {
      d.age++;
      if (d.age >= 24) U.log(g, '🎓 ' + d.name + ' は育成年齢の上限が近い。昇格させるか決断のとき。', 'warn');
    });
    // スタッフの成長
    const grown = S.growStaff(g);
    if (grown.length) U.log(g, '📈 スタッフが成長した：' + grown.join('、'), 'good');
    // ライバル強化
    g.rivals = S.makeRivals(g.season, g.drivers.map(d => d.name));
    refreshMarkets(true);
    U.log(g, '🚩 シーズン' + g.season + ' 開幕！', 'good');
    GP.sound.play('confirm');
    U.toast('🚩 シーズン' + g.season + ' 開幕！', 'good');
    S.save(g); render();
    if (retired.length) U.toast('引退したドライバーがいます。「人事」で補充しましょう。', 'warn');
  }

  function gameOver() {
    GP.sound.play('bad');
    U.modal('💀 ゲームオーバー', '<p class="lead">資金が尽き、チームは解散となった…</p>' +
      '<p class="desc">シーズン ' + g.season + ' ／ 通算タイトル：コンストラクターズ ' + g.titles.teams + ' 回、ドライバーズ ' + g.titles.drivers + ' 回</p>',
      [{ label: '最初からやり直す', cls: 'primary', fn: () => { S.wipe(); location.reload(); } }]);
  }

  /* =======================================================
     ヘルパー
     ======================================================= */
  function bindPick(fn) {
    Array.prototype.forEach.call($('modalBody').querySelectorAll('.pickbtn[data-k]'), b => {
      if (b.tagName === 'BUTTON') b.onclick = () => fn(b.dataset.k);
    });
  }

  function render() {
    U.renderAll(g, specialOf(g));
    const race = isRaceWeek();
    $('cmdNormal').style.display = race ? 'none' : '';
    $('cmdRace').style.display = race ? '' : 'none';
    const btn = $('specialGo');
    if (btn) btn.onclick = enterSpecial;
    const skip = $('specialSkip');
    if (skip) skip.onclick = () => {
      const sp = specialOf(g);
      g.special = null;
      if (sp) U.log(g, sp.icon + ' ' + sp.name + ' への招待を辞退した。');
      S.save(g); render();
    };
  }

  /* =======================================================
     初期化
     ======================================================= */
  function bindSound() {
    const btn = $('tSound');
    const paint = () => { btn.textContent = GP.sound.isOn() ? '🔊' : '🔇'; btn.classList.toggle('off', !GP.sound.isOn()); };
    paint();
    btn.onclick = () => { GP.sound.setOn(!GP.sound.isOn()); paint(); };
    // ブラウザの制限があるので、最初の操作で音を使えるようにしておく。
    // Safari は pointerdown だけでは解除されないことがあるため、複数の操作で受ける
    const gestures = ['pointerdown', 'touchend', 'click', 'keydown'];
    const unlock = () => {
      GP.sound.unlock();
      gestures.forEach(g2 => document.removeEventListener(g2, unlock));
    };
    gestures.forEach(g2 => document.addEventListener(g2, unlock));
    // ボタン類には共通のクリック音を付ける
    document.addEventListener('pointerdown', ev => {
      const t = ev.target.closest && ev.target.closest('button');
      if (!t || t.disabled) return;
      if (t.id === 'tSound') return;
      GP.sound.play(t.classList.contains('cmd') || t.classList.contains('primary') ? 'click' : 'tap', 40);
    });
  }

  function bindCommands() {
    const map = {
      cDevelop: cmdDevelop, cResearch: cmdResearch, cMaintain: cmdMaintain,
      cTrain: cmdTrain, cSponsor: cmdSponsor, cRest: cmdRest,
      cGarage: cmdGarage, cFacility: cmdFacility, cStaff: cmdStaff, cInfo: cmdInfo,
      cRaceGo: cmdRace, cGarageR: cmdGarage, cStaffR: cmdStaff
    };
    Object.keys(map).forEach(id => { const el = $(id); if (el) el.onclick = map[id]; });
    $('modalClose').onclick = U.closeModal;
    // 数値は「レース全体を何秒で再生するか」。既定は「ゆっくり」
    const speeds = { rvSpeed0: 200, rvSpeed1: 95, rvSpeed2: 45, rvSpeed3: 15 };
    Object.keys(speeds).forEach(id => {
      $(id).onclick = () => {
        RV.setSpeed(speeds[id]);
        Object.keys(speeds).forEach(o => $(o).classList.toggle('primary', o === id));
      };
    });
    $('rvSkip').onclick = () => RV.skip();
  }

  function cmdRest() {
    g.drivers.forEach(d => { d.form = S.clamp(d.form + S.rnd(6, 14) * S.persOf(d).rest, 62, 122); });
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (p) p.cond = S.clamp(p.cond + S.rnd(3, 7), 10, 100);
    });
    U.log(g, '☕ チーム全体で休養をとった。コンディションが回復した。');
    U.pop('☕ 回復', 'good');
    endWeek();
  }

  function cmdInfo() {
    let body = U.finance(g);
    body += U.standings(g);
    body += '<div class="sub">今季のレース結果</div>';
    if (!g.results.length) body += '<p class="desc">まだレースがありません。</p>';
    g.results.slice().reverse().forEach(r => {
      const mine = r.rows.filter(x => x.isPlayer);
      body += '<div class="hist"><b>第' + r.round + '戦 ' + esc(r.track) + '</b> <small>' + r.weather + '</small><br>' +
        mine.map(m => (m.dnf ? 'DNF' : m.pos + '位') + ' ' + esc(m.name) + (m.pts ? '（+' + m.pts + 'pt）' : '')).join(' ／ ') + '</div>';
    });
    body += '<div class="sub">チームの歩み</div>';
    if (!g.history.length) body += '<p class="desc">まだ1シーズンも終えていません。</p>';
    g.history.forEach(h => { body += '<div class="hist">シーズン' + h.season + '：コンストラクターズ ' + h.rank + '位（' + h.points + 'pt）</div>'; });
    body += '<div class="sub">通算タイトル</div><p class="desc">コンストラクターズ ' + g.titles.teams + ' 回／ドライバーズ ' + g.titles.drivers + ' 回</p>';
    U.modal('📖 チーム情報', body, [
      { label: '💾 セーブ', fn: () => { S.save(g); U.toast('💾 セーブしました', 'good'); } },
      { label: '閉じる', fn: U.closeModal },
      { label: '🗑️ 最初から', cls: 'danger', fn: () => {
          U.modal('本当に最初から？', '<p class="lead">現在のデータは消えます。よろしいですか？</p>', [
            { label: 'はい', cls: 'danger', fn: () => { S.wipe(); location.reload(); } },
            { label: 'いいえ', fn: U.closeModal }]);
        } }
    ], { wide: true });
  }

  /* ---------- タイトル画面 ---------- */
  function showTitle() {
    const saved = S.load();
    const colors = ['#e04a3f', '#3a7ad9', '#4ea63f', '#f0a020', '#b06fd0', '#12b5b0'];
    let body = '<div class="titlewrap">' +
      '<p class="lead">あなたは弱小F1チームの新オーナー。<br>マシンを開発し、ドライバーを育て、世界の頂点を目指そう！</p>' +
      '<label class="fld">チーム名<input id="inTeam" maxlength="12" value="ニューカマーGP"></label>' +
      '<div class="fld">チームカラー<div class="colors">' +
      colors.map((c, i) => '<button class="colorbtn' + (i === 0 ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></button>').join('') +
      '</div></div>' +
      '<div class="fld">難易度<div class="diffs">' +
      D.DIFFICULTIES.map(d => '<button class="diffbtn' + (d.key === 'normal' ? ' on' : '') + '" data-m="' + d.key + '"' +
        ' style="--dc:' + d.color + '"><b>' + d.icon + ' ' + d.name + '</b><small>' + esc(d.short) + '</small></button>').join('') +
      '</div><p class="desc" id="diffDesc"></p></div></div>';
    const btns = [{ label: '🏁 チームを立ち上げる', cls: 'primary', fn: () => {
      const name = ($('inTeam').value || '').trim() || 'ニューカマーGP';
      const c = $('modalBody').querySelector('.colorbtn.on').dataset.c;
      const m = $('modalBody').querySelector('.diffbtn.on').dataset.m;
      g = S.newGame(name, c, m);
      U.log(g, '🚩 ' + name + ' が発足！ 目指すは世界の頂点！', 'good');
      U.closeModal(); document.body.classList.remove('preboot'); S.save(g); render();
      U.toast('チーム「' + name + '」発足！', 'good');
    } }];
    if (saved) btns.unshift({ label: '▶ つづきから（S' + saved.season + ' W' + saved.week + '）', cls: 'primary',
      fn: () => { g = saved; U.closeModal(); document.body.classList.remove('preboot'); render(); } });

    U.modal('🏎️ グランプリ物語', body, btns);
    $('modalClose').style.display = 'none';
    Array.prototype.forEach.call($('modalBody').querySelectorAll('.colorbtn'), b => {
      b.onclick = () => {
        Array.prototype.forEach.call(b.parentElement.children, c => c.classList.remove('on'));
        b.classList.add('on');
      };
    });
    const showDiff = key => {
      const d = D.DIFFICULTIES.find(x => x.key === key);
      $('diffDesc').textContent = d ? d.desc : '';
    };
    Array.prototype.forEach.call($('modalBody').querySelectorAll('.diffbtn'), b => {
      b.onclick = () => {
        Array.prototype.forEach.call(b.parentElement.children, c => c.classList.remove('on'));
        b.classList.add('on');
        showDiff(b.dataset.m);
      };
    });
    showDiff('normal');
  }

  /* ---------- エラーの可視化 ----------
     手元で再現できない環境（別ブラウザ・別端末）で問題が起きたとき、
     何が起きたのか画面上で分かるようにしておく                        */
  function showFatal(msg, where) {
    if (document.getElementById('fatalBox')) return;
    const box = document.createElement('div');
    box.id = 'fatalBox';
    box.innerHTML =
      '<div class="fatal-inner"><b>⚠️ エラーが発生しました</b>' +
      '<p>この内容を伝えていただければ原因を特定できます。</p>' +
      '<code></code>' +
      '<button id="fatalClose">閉じる</button></div>';
    box.querySelector('code').textContent =
      String(msg) + (where ? '\n' + where : '') +
      '\n' + navigator.userAgent;
    document.body.appendChild(box);
    box.querySelector('#fatalClose').onclick = () => box.remove();
  }

  window.addEventListener('error', ev => {
    showFatal(ev.message, (ev.filename || '') + ':' + (ev.lineno || '') + ':' + (ev.colno || ''));
  });
  window.addEventListener('unhandledrejection', ev => {
    showFatal((ev.reason && ev.reason.message) || ev.reason, '');
  });

  /* ---------- Service Worker（オフライン対応）----------
     file:// で直接開いた場合は登録できないが、その場合も普通に遊べる    */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    registerSW();
    bindSound();
    bindCommands();
    document.body.classList.add('preboot');
    g = S.newGame('ニューカマーGP', '#e04a3f');   // 仮state（チーム作成までは非表示）
    render();
    showTitle();
    $('modalClose').style.display = 'none';
    const mo = new MutationObserver(() => {
      if ($('modal').className === '') $('modalClose').style.display = '';
    });
    mo.observe($('modal'), { attributes: true, attributeFilter: ['class'] });
  });
})();

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
    // コンディション変動
    g.drivers.forEach(d => {
      d.form = S.clamp(d.form + S.rnd(-6, 6.5), 62, 122);
      levelCheck(d);
    });
    // ファンの自然減
    g.fans = Math.max(0, g.fans - Math.round(g.fans * 0.006));

    g.week++;
    randomEvent();

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

  /* =======================================================
     コマンド：開発
     ======================================================= */
  const improveCost = p => Math.round(D.PART_CATS.find(c => c.key === p.cat).cost * (1 + p.power / 20));
  const designCost = () => ({
    money: Math.round(1000 + g.carGen * 2200),
    rp: Math.round(26 + g.carGen * 24)
  });

  function cmdDevelop() {
    let body = '<div class="sub">装着中パーツの改良</div><div class="pick">';
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) {
        body += '<div class="pickbtn done"><span class="pb-ic" style="background:' + c.color + '">' + c.icon + '</span>' +
          '<span class="pb-body"><b>' + c.name + '</b><small>パーツが未装着です</small></span><span class="pb-cost">—</span></div>';
        return;
      }
      const cost = improveCost(p), cap = S.partCap(g, p);
      const capped = p.power >= cap;
      const ok = g.funds >= cost && g.rp >= c.rp;
      body += '<button class="pickbtn" data-k="imp:' + c.key + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:' + c.color + '">' + c.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(p.name) + '</b>' +
        '<small>' + c.name + '／性能 ' + Math.round(p.power) + ' / 上限 ' + cap +
        (capped ? ' <em class="warn">上限到達</em>' : '') + '</small></span>' +
        '<span class="pb-cost">💰' + money(cost) + '<br>🔬' + c.rp + '</span></button>';
    });
    const dc = designCost();
    body += '</div><div class="sub">新しいパーツを設計する</div>' +
      '<p class="desc">デザイナーの腕が良いほど高レアリティのパーツができます。' +
      '完成したパーツは保管され、「マシン」から装着・合成できます。</p><div class="pick">';
    D.PART_CATS.forEach(c => {
      const ok = g.funds >= dc.money && g.rp >= dc.rp;
      body += '<button class="pickbtn" data-k="des:' + c.key + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:' + c.color + '">' + c.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(c.names[Math.min(c.names.length - 1, g.carGen)]) + ' を設計</b>' +
        '<small>' + c.name + '／' + D.CAR_GENS[g.carGen].name + '世代</small></span>' +
        '<span class="pb-cost">💰' + money(dc.money) + '<br>🔬' + dc.rp + '</span></button>';
    });
    body += '</div>';
    U.modal('🔧 マシン開発', body, [{ label: 'やめる', fn: U.closeModal }]);
    bindPick(k => {
      const [kind, key] = k.split(':');
      if (kind === 'imp') doImprove(key); else doDesign(key);
    });
  }

  function doImprove(key) {
    const c = D.PART_CATS.find(x => x.key === key);
    const p = g.equipped[key];
    if (!p) return;
    const cost = improveCost(p), cap = S.partCap(g, p);
    if (g.funds < cost || g.rp < c.rp) return;
    g.funds -= cost; g.rp -= c.rp;

    const facBonus = 1 + g.facilities.factory * 0.10 +
      ((key === 'aero' || key === 'susp') ? g.facilities.tunnel * 0.12 : 0);
    const engBonus = 1 + S.staffBonus(g, 'engineer') * 0.14;
    let gain = S.rnd(3.4, 5.6) * facBonus * engBonus;
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
    if (crit) U.toast('✨ ひらめいた！ 開発が大成功！', 'good');
    if (p.power >= cap) U.toast('このパーツは限界です。新型マシンか、より高レアなパーツが必要です。', 'warn');
    endWeek();
  }

  function doDesign(key) {
    const c = D.PART_CATS.find(x => x.key === key);
    const dc = designCost();
    if (g.funds < dc.money || g.rp < dc.rp) return;
    if (g.inventory.length >= 24) { U.toast('保管庫がいっぱいです。「マシン」で合成・破棄しましょう。', 'warn'); return; }
    g.funds -= dc.money; g.rp -= dc.rp;

    const rarity = S.rollRarity(g);
    const part = S.makePart(key, g.carGen, rarity);
    g.inventory.push(part);

    const rr = D.RARITY[rarity - 1];
    U.closeModal();
    U.log(g, '📐 ' + part.name + '（' + rr.name + '）が完成！ 性能 ' + Math.round(part.power), rarity >= 3 ? 'good' : '');
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
    U.toast('🎓 ' + best.icon + ' ' + best.name + ' を習得！', 'good');
    U.pop('🎓 ' + best.name, 'crit');
    endWeek();
  }
  function doTrain(k, cost) {
    if (g.funds < cost) return U.toast('資金が足りません', 'bad');
    const [i, stat] = k.split(':');
    const d = g.drivers[+i];
    g.funds -= cost;
    const bonus = 1 + g.facilities.sim * 0.14 + S.staffBonus(g, 'trainer') * 0.16;
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
    const avail = D.SPONSORS.filter(s => g.fans >= s.fans && have.indexOf(s.name) < 0);
    let body = '<p class="lead">スポンサー枠 ' + g.sponsors.length + ' / ' + slots + '（マーケティング室の拡張で増えます）</p>';
    body += '<div class="pick"><button class="pickbtn" data-k="__ad"><span class="pb-ic" style="background:#f0a020">📣</span>' +
      '<span class="pb-body"><b>プロモーション活動</b><small>ファンを増やし、少し資金も入る</small></span>' +
      '<span class="pb-cost">+ファン</span></button></div>';
    body += '<div class="sub">契約できるスポンサー</div><div class="pick">';
    if (!avail.length) body += '<p class="desc">今のファン数では新しい契約先がありません。人気を高めましょう。</p>';
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
    bindPick(k => (k === '__ad') ? doPromo() : doSign(k));
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
    U.log(g, '📣 プロモーション活動。ファン +' + money(f) + '／収入 +' + money(m) + '万', 'good');
    U.pop('👥+' + money(f), 'good');
    endWeek();
  }
  function doSign(name) {
    const s = D.SPONSORS.find(x => x.name === name);
    if (!s) return;
    g.sponsors.push(Object.assign({}, s));
    const adv = Math.round(s.per * 4);
    g.funds += adv;
    U.closeModal();
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
    U.toast(up ? '⭐ ' + D.RARITY[base.rarity - 1].name + ' に進化！' : '⚗️ 合成成功！ 性能 +' + gain.toFixed(1), up ? 'good' : '');
    U.pop('+' + gain.toFixed(1), up ? 'crit' : 'good');
    S.save(g); render(); cmdGarage();
  }

  /* =======================================================
     フリーメニュー：施設
     ======================================================= */
  function cmdFacility() {
    let body = '<p class="lead">施設を拡張します（週は消費しません）。</p><div class="pick">';
    D.FACILITIES.forEach(f => {
      const lv = g.facilities[f.key];
      const cost = Math.round(f.base * Math.pow(lv, 1.55));
      const max = lv >= 10;
      body += '<button class="pickbtn" data-k="' + f.key + '"' + ((max || g.funds < cost) ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:#7b5a3a">' + f.icon + '</span>' +
        '<span class="pb-body"><b>' + f.name + ' Lv.' + lv + (max ? '（MAX）' : ' → ' + (lv + 1)) + '</b><small>' + f.desc + '</small></span>' +
        '<span class="pb-cost">' + (max ? 'MAX' : '💰' + money(cost)) + '</span></button>';
    });
    body += '</div>';
    U.modal('🏗️ 施設の拡張', body, [{ label: '閉じる', fn: U.closeModal }]);
    bindPick(k => {
      const f = D.FACILITIES.find(x => x.key === k);
      const lv = g.facilities[k];
      const cost = Math.round(f.base * Math.pow(lv, 1.55));
      if (g.funds < cost || lv >= 10) return;
      g.funds -= cost; g.facilities[k]++;
      U.log(g, '🏗️ ' + f.name + ' を Lv.' + g.facilities[k] + ' に拡張した！', 'good');
      U.toast('🏗️ ' + f.name + ' Lv.' + g.facilities[k] + '！', 'good');
      S.save(g); render(); cmdFacility();
    });
  }

  /* =======================================================
     フリーメニュー：人事
     ======================================================= */
  let staffMarket = null, driverMarket = null;
  function refreshMarkets(force) {
    if (force || !staffMarket) staffMarket = [0, 1, 2].map(() => S.makeStaff(S.pick(D.STAFF_TYPES).key));
    if (force || !driverMarket) driverMarket = [0, 1, 2].map(() => S.makeDriver(1.2 + g.season * 1.4 + S.rnd(-0.6, 1.2)));
  }
  function cmdStaff() {
    refreshMarkets(false);
    let body = '<div class="sub">ドライバー（' + g.drivers.length + '/2）</div><div class="pick">';
    g.drivers.forEach((d, i) => {
      body += '<div class="pickbtn done"><span class="pb-ic" style="background:#3a7ad9">🧑‍✈️</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>総合 ' + Math.round(S.driverRating(d)) + '／' + d.age + '歳' +
        '<br>' + U.skillChips(d) + '</small></span>' +
        '<span class="pb-cost"><button class="mini danger" data-fired="' + d.id + '">解雇</button></span></div>';
    });
    body += '</div><div class="sub">ドライバー市場</div><div class="pick">';
    driverMarket.forEach((d, i) => {
      const fee = Math.round(d.salary * 12);
      const full = g.drivers.length >= 2;
      body += '<button class="pickbtn" data-k="dm:' + i + '"' + ((full || g.funds < fee) ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:#3a7ad9">🧑‍✈️</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>総合 ' + Math.round(S.driverRating(d)) + '／' + d.age + '歳' +
        '<br>速' + Math.round(d.speed) + ' 技' + Math.round(d.technique) + ' 体' + Math.round(d.stamina) + ' 精' + Math.round(d.mental) +
        '<br>' + U.skillChips(d) + '</small></span>' +
        '<span class="pb-cost">契約金<br>💰' + money(fee) + '</span></button>';
    });
    body += '</div><div class="sub">スタッフ市場</div><div class="pick">';
    staffMarket.forEach((s, i) => {
      const t = D.STAFF_TYPES.find(x => x.key === s.type);
      const fee = s.salary * 8;
      body += '<button class="pickbtn" data-k="sm:' + i + '"' + (g.funds < fee ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:#7b5a3a">' + t.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(s.name) + '</b><small>' + t.name + '／技能 ' + s.skill + '／' + t.desc + '</small></span>' +
        '<span class="pb-cost">💰' + money(fee) + '<br><em>週' + money(s.salary) + '</em></span></button>';
    });
    body += '</div>';
    U.modal('👥 人事', body, [
      { label: '🔄 市場を更新（500万）', disabled: g.funds < 500, fn: () => { g.funds -= 500; refreshMarkets(true); render(); cmdStaff(); } },
      { label: '閉じる', fn: U.closeModal }
    ], { wide: true });

    bindPick(k => {
      const [kind, idx] = k.split(':');
      if (kind === 'dm') {
        const d = driverMarket[+idx], fee = Math.round(d.salary * 12);
        if (g.drivers.length >= 2 || g.funds < fee) return;
        g.funds -= fee; d.team = g.team; g.drivers.push(d);
        driverMarket.splice(+idx, 1);
        U.log(g, '🧑‍✈️ ' + d.name + ' と契約した！', 'good');
        U.toast('🧑‍✈️ ' + d.name + ' が加入！', 'good');
      } else {
        const s = staffMarket[+idx], fee = s.salary * 8;
        if (g.funds < fee) return;
        g.funds -= fee; g.staff.push(s);
        staffMarket.splice(+idx, 1);
        U.log(g, '👥 ' + s.name + ' を雇用した。', 'good');
        U.toast('👥 ' + s.name + ' が加入！', 'good');
      }
      S.save(g); render(); cmdStaff();
    });
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-fired]'), b => {
      b.onclick = () => {
        const d = g.drivers.find(x => x.id === b.dataset.fired);
        g.funds -= d.salary * 6;
        g.drivers = g.drivers.filter(x => x.id !== b.dataset.fired);
        U.log(g, '👋 ' + d.name + ' との契約を解除した（違約金 ' + money(d.salary * 6) + '万）。');
        S.save(g); render(); cmdStaff();
      };
    });
  }

  /* =======================================================
     レース
     ======================================================= */
  let pendingStrategy = {};
  function cmdRace() {
    const t = D.TRACKS[g.nextRace];
    if (g.drivers.length === 0) return U.toast('ドライバーがいません！', 'bad');
    pendingStrategy = {};
    g.drivers.forEach(d => { pendingStrategy[d.id] = 'balance'; });

    let body = '<div class="racehead"><b>第' + (g.nextRace + 1) + '戦 ' + t.country + ' ' + esc(t.name) + '</b>' +
      '<span>' + t.laps + '周 ／ ' + esc(t.desc) + '</span></div>';
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

    U.modal('🏁 レースウィーク', body, [
      { label: '🏁 コースイン！', cls: 'primary', fn: startRace },
      { label: 'まだ準備する', fn: U.closeModal }
    ]);

    Array.prototype.forEach.call($('modalBody').querySelectorAll('.stratbtn'), b => {
      b.onclick = () => {
        const wrap = b.parentElement;
        Array.prototype.forEach.call(wrap.children, c => c.classList.remove('on'));
        b.classList.add('on');
        pendingStrategy[wrap.dataset.drv] = b.dataset.s;
      };
    });
  }

  let currentRes = null;
  function startRace() {
    currentRes = R.simulate(g, g.nextRace, pendingStrategy);
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
      let body = '<div class="racehead"><b>第' + (res.trackIndex + 1) + '戦 ' + esc(res.track.name) + '</b><span>' + res.weather.icon + ' ' + res.weather.name + '</span></div>';
      body += '<div class="gridlist">';
      res.classified.slice(0, 22).forEach(e => {
        body += '<div class="gridrow' + (e.isPlayer ? ' me' : '') + (e.dnf ? ' dnf' : '') + '">' +
          '<span class="gp-pos' + (e.pos === 1 && !e.dnf ? ' gold' : e.pos === 2 && !e.dnf ? ' silver' : e.pos === 3 && !e.dnf ? ' bronze' : '') + '">' + (e.dnf ? '-' : e.pos) + '</span>' +
          '<span class="rk-chip" style="background:' + e.color + '"></span>' +
          '<span class="gp-nm">' + esc(e.driver.name) + '</span>' +
          '<span class="gp-tm">' + esc(e.team.name) + '</span>' +
          '<span class="gp-mv ' + (e.grid > e.pos ? 'up' : e.grid < e.pos ? 'down' : '') + '">' +
          (e.dnf ? 'DNF' : (e.grid > e.pos ? '▲' + (e.grid - e.pos) : e.grid < e.pos ? '▼' + (e.pos - e.grid) : '－')) + '</span>' +
          '<span class="gp-t">' + (e.dnf ? esc(e.dnfReason) : (e.points ? '+' + e.points + 'pt' : '')) + '</span></div>';
      });
      body += '</div>';
      body += '<div class="rewardbox">' +
        '<div>💰 賞金 <b>+' + money(reward.prize) + '万</b></div>' +
        '<div>📣 スポンサー <b>+' + money(reward.sponsorIncome) + '万</b></div>' +
        '<div>👥 ファン <b class="' + (reward.fanDelta >= 0 ? 'good' : 'bad') + '">' + (reward.fanDelta >= 0 ? '+' : '') + money(reward.fanDelta) + '</b></div>' +
        '</div>';
      if (res.fastestLap) body += '<p class="desc">⚡ ファステストラップ：' + esc(res.fastestLap.driver.name) + '（' + fmtTime(res.fastestLap.fastest) + '）</p>';
      reward.notes.forEach(n => { body += '<p class="note">' + esc(n) + '</p>'; U.log(g, n, 'good'); });

      U.modal('🏆 レース結果', body, [{ label: 'ガレージへ戻る', cls: 'primary', fn: afterRace }], { wide: true });
    }, 900);
  }

  function afterRace() {
    U.closeModal();
    g.nextRace++;
    g.drivers.forEach(d => { d.form = S.clamp(d.form + S.rnd(-8, 8), 62, 122); levelCheck(d); });
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
    // スタッフの成長
    const grown = S.growStaff(g);
    if (grown.length) U.log(g, '📈 スタッフが成長した：' + grown.join('、'), 'good');
    // ライバル強化
    g.rivals = S.makeRivals(g.season, g.drivers.map(d => d.name));
    refreshMarkets(true);
    U.log(g, '🚩 シーズン' + g.season + ' 開幕！', 'good');
    U.toast('🚩 シーズン' + g.season + ' 開幕！', 'good');
    S.save(g); render();
    if (retired.length) U.toast('引退したドライバーがいます。「人事」で補充しましょう。', 'warn');
  }

  function gameOver() {
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
    U.renderAll(g);
    const race = isRaceWeek();
    $('cmdNormal').style.display = race ? 'none' : '';
    $('cmdRace').style.display = race ? '' : 'none';
  }

  /* =======================================================
     初期化
     ======================================================= */
  function bindCommands() {
    const map = {
      cDevelop: cmdDevelop, cResearch: cmdResearch, cMaintain: cmdMaintain,
      cTrain: cmdTrain, cSponsor: cmdSponsor, cRest: cmdRest,
      cGarage: cmdGarage, cFacility: cmdFacility, cStaff: cmdStaff, cInfo: cmdInfo,
      cRaceGo: cmdRace, cGarageR: cmdGarage, cStaffR: cmdStaff
    };
    Object.keys(map).forEach(id => { const el = $(id); if (el) el.onclick = map[id]; });
    $('modalClose').onclick = U.closeModal;
    $('rvSpeed1').onclick = () => RV.setSpeed(2);
    $('rvSpeed2').onclick = () => RV.setSpeed(5);
    $('rvSpeed3').onclick = () => RV.setSpeed(12);
    $('rvSkip').onclick = () => RV.skip();
  }

  function cmdRest() {
    g.drivers.forEach(d => { d.form = S.clamp(d.form + S.rnd(6, 14), 62, 122); });
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (p) p.cond = S.clamp(p.cond + S.rnd(3, 7), 10, 100);
    });
    U.log(g, '☕ チーム全体で休養をとった。コンディションが回復した。');
    U.pop('☕ 回復', 'good');
    endWeek();
  }

  function cmdInfo() {
    let body = '<div class="sub">今季のレース結果</div>';
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
      { label: '🗑️ 最初から', cls: 'danger', fn: () => {
          U.modal('本当に最初から？', '<p class="lead">現在のデータは消えます。よろしいですか？</p>', [
            { label: 'はい', cls: 'danger', fn: () => { S.wipe(); location.reload(); } },
            { label: 'いいえ', fn: U.closeModal }]);
        } },
      { label: '閉じる', fn: U.closeModal }
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
      '</div></div></div>';
    const btns = [{ label: '🏁 チームを立ち上げる', cls: 'primary', fn: () => {
      const name = ($('inTeam').value || '').trim() || 'ニューカマーGP';
      const c = $('modalBody').querySelector('.colorbtn.on').dataset.c;
      g = S.newGame(name, c);
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
  }

  window.addEventListener('DOMContentLoaded', () => {
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

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
    crunchConsume(true);
    // 固定費
    const cost = S.weeklyCost(g);
    g.funds -= cost;
    if (g.funds < 0) {
      U.log(g, '⚠️ 資金が底をついた！（' + money(g.funds) + '万）', 'bad');
      U.toast('⚠️ 資金がマイナスです！', 'bad');
      if (g.funds < -20000) return gameOver();
    }
    // パーツを煮詰めきると、マシンそのものが次の世代へ進む
    const up = S.tryAdvanceGen(g);
    if (up) announceGen(up);
    // 研究ポイントの自然増
    g.rp += 2 + Math.round(S.staffBonus(g, 'analyst'));
    // ライバルも毎週マシンを煮詰めている
    S.developRivals(g);
    // 下部組織の若手が育つ
    S.growYouth(g);
    // コンディション変動（放っておけば平常に戻る。悪循環にはまり込まないように）
    const drift = d => { d.form = S.clamp(d.form + (100 - d.form) * 0.14 + S.rnd(-4.5, 5), 62, 122); };
    g.drivers.forEach(d => { drift(d); levelCheck(d); });
    g.rivals.forEach(t => t.drivers.forEach(drift));   // ライバルも同じ条件で
    // ファンの自然減と、話題の風化
    g.fans = Math.max(120, g.fans - Math.round(g.fans * 0.006));
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

  /* チームが何をしたかを、関わったスタッフの経験にする */
  function staffExp(typeKey, amount) {
    reportStaffUps(S.addStaffExp(g, typeKey, amount));
  }
  function staffExpAll(amount) {
    reportStaffUps(S.addStaffExpAll(g, amount));
  }
  function reportStaffUps(ups) {
    (ups || []).forEach(u => {
      const tail = u.capped ? '（もう伸びしろがない）' : '';
      U.log(g, '⭐ ' + u.name + ' が Lv.' + u.lv + ' に上がった（技能 +' + u.gained + ' → ' +
               u.skill + '）' + tail, 'good');
      if (u.learned) {
        U.log(g, '🎓 ' + u.name + ' が「' + u.learned.name + '」を身につけた。', 'good');
        U.toast('🎓 ' + u.name + '「' + u.learned.name + '」', 'good');
      }
      GP.sound.play('levelup', 160);
    });
  }

  /* 開発と設備への支出を、今季の予算に記録する。
     上限を超えても止めはしないが、シーズン明けに罰金と風洞時間の削減が来る */
  let capWarned = false;
  function capSpend(amount) {
    const before = S.capSpent(g);
    S.spendCapped(g, amount);
    const cap = S.costCap(g);
    if (before <= cap && S.capSpent(g) > cap && !capWarned) {
      capWarned = true;
      U.log(g, '🧾 今季の予算上限（' + money(cap) + '万）を超えた。' +
               'シーズン明けに超過分の' + Math.round(D.COST_CAP_FINE * 100) + '%が罰金となり、' +
               '翌年の風洞時間も削られる。', 'bad');
      U.toast('🧾 予算上限を超えました', 'bad');
    }
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
    const fc = S.focusOf(g);
    let body = interiorHTML('factory') +
      '<div class="sub">開発リソースの配分</div>' +
      '<p class="desc">今季の熟成に注ぐか、来季のマシンに前倒しで着手するか。' +
      '来季に回したぶんは、次の世代のマシンの初期性能になります。</p>' +
      '<div class="focusrow">';
    D.FOCUS_LEVELS.forEach(f => {
      body += '<button class="focusbtn' + (f.key === g.focus ? ' on' : '') + '" data-focus="' + f.key + '"' +
        ' title="' + esc(f.desc) + '"><b>' + f.icon + ' ' + f.name + '</b>' +
        '<small>今季 ' + Math.round(f.cur * 100) + '%／来季 ' + Math.round(f.next * 100) + '%</small></button>';
    });
    const prog = Math.round(S.nextCarProgress(g) * 100);
    const nv = S.nextCarPreview(g);
    body += '</div>' +
      '<div class="nextcar"><span>🌱 来季マシンの仕込み</span>' +
      '<i><b style="width:' + prog + '%"></b></i><em>' + prog + '%</em></div>';
    // 仕込みが何を買っているのかを、そのまま数字で出す
    body += '<p class="nextcar-note">' + (nv.isLast
      ? 'これ以上の新型はありません。仕込みは効果がないので「今季に全力」がおすすめです。'
      : 'いま新型に乗り換えると、車体の各項目は <b>' + nv.without + '</b> から始まります。' +
        (nv.gain > 0
          ? '仕込みぶんが乗って <b class="up">' + nv.withStock + '</b>（+' + nv.gain + '）になります。'
          : 'まだ仕込みは乗っていません。') +
        '<br>次のマシンでの上限は ' + nv.cap + ' です。') + '</p>';
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
        body += '<div class="pickbtn done"><span class="pb-ic ic-art" style="background:' + c.color + '">' + U.partIcon(c.key, 26, 0) + '</span>' +
          '<span class="pb-body"><b>' + c.name + '</b><small>パーツが未装着です</small></span><span class="pb-cost">—</span></div>';
        return;
      }
      const cost = improveCost(p), cap = S.partCap(g, p);
      const capped = p.power >= cap;
      const ok = useTicket || (g.funds >= cost && g.rp >= c.rp);
      // 供給を受けているパワーユニットは、こちらでは手を入れられない
      const locked = c.key === 'pu' && p.supplied;
      body += '<button class="pickbtn" data-k="imp:' + c.key + '"' + ((ok && !locked) ? '' : ' disabled') + '>' +
        '<span class="pb-ic ic-art" style="background:' + c.color + '">' + U.partIcon(c.key, 26, p.rar) + '</span>' +
        '<span class="pb-body"><b>' + esc(p.name) + '</b>' +
        '<small>' + c.name + '／性能 ' + Math.round(p.power) + ' / 上限 ' + cap +
        (locked ? ' <em class="warn">供給中は開発できません</em>'
                : (capped ? ' <em class="warn">上限到達</em>' : '')) + '</small></span>' +
        '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>' : '💰' + money(cost) + '<br>🔬' + c.rp) + '</span></button>';
    });
    // ---- 車体開発 ----
    const cap = S.bodyCap(g);
    body += '</div><div class="sub">車体の熟成</div>' +
      '<p class="desc">パーツは速さを、車体は<b>壊れにくさ・タイヤの保ち・ピット作業・維持費</b>を担当します。' +
      '効果は「上限に対して何割まで煮詰めたか」で決まるので、世代が変わっても価値は変わりません。<br>' +
      '上限は現在のマシン（' + D.CAR_GENS[g.carGen].name + '）で ' + cap + '。パーツを仕上げて世代が上がると、ここも上がります。' +
      'ライバルはおおむね50%の仕上がりです。</p><div class="pick">';
    D.BODY_ATTRS.forEach(a => {
      const v = (g.body && g.body[a.key]) || 0;
      const cost = bodyCost(v);
      const capped = v >= cap;
      const ok = useTicket || (g.funds >= cost && g.rp >= 8);
      const pct = Math.min(100, v / cap * 100);
      body += '<button class="pickbtn" data-k="bdy:' + a.key + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:' + a.color + '">' + a.icon + '</span>' +
        '<span class="pb-body"><b>' + a.name + '</b>' +
        '<small>' + a.desc + '<br><span class="bd-eff">' + a.eff +
        '<b>（いま ' + Math.round(pct) + '%）</b></span>' +
        '<span class="skbar"><i style="width:' + pct + '%;background:' + a.color + '"></i></span> ' +
        Math.round(v * 10) / 10 + ' / ' + cap + (capped ? ' <em class="warn">上限到達</em>' : '') + '</small></span>' +
        '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>' : '💰' + money(cost) + '<br>🔬8') + '</span></button>';
    });

    // ---- 今季の予算 ----
    const capPct = Math.min(140, S.capRatio(g) * 100);
    const overCap = S.capSpent(g) > S.costCap(g);
    body += '<div class="capbox' + (overCap ? ' over' : capPct > 80 ? ' warn' : '') + '">' +
      '<b>🧾 今季の予算 ' + money(S.capSpent(g)) + ' / ' + money(S.costCap(g)) + '万</b>' +
      '<span class="skbar big"><i class="' + (overCap ? 'f2' : capPct > 80 ? 'f1' : 'f0') +
        '" style="width:' + Math.min(100, capPct) + '%"></i></span>' +
      '<em>' + Math.round(capPct) + '%</em>' +
      '<small>開発・設計・合成・施設に使える1シーズンの上限です。' +
      (overCap
        ? '<b class="warn">超過分の' + Math.round(D.COST_CAP_FINE * 100) + '%が罰金になり、翌年の風洞時間も削られます。</b>'
        : '残り ' + money(S.capLeft(g)) + '万。超えても止まりませんが、罰金と翌年の開発時間削減が待っています。') +
      '</small></div>';

    const at2 = S.atrLabel(g);
    if (g.lastRank) {
      body += '<div class="atrbox slim" style="--ac:' + at2.color + '">' +
        '<b>' + at2.icon + ' 風洞・CFD使用時間：' + at2.name + '（開発の伸び ×' + S.atrOf(g).toFixed(2) + '）</b>' +
        '<small>昨季コンストラクターズ ' + g.lastRank + '位。上位ほど使える時間が減ります。</small></div>';
    }

    const dc = designCost();
    body += '</div><div class="sub">新しいパーツを設計する</div>' +
      '<p class="desc">デザイナーの腕が良いほど高レアリティのパーツができます。' +
      '完成したパーツは保管され、「マシン」から装着・合成できます。</p><div class="pick">';
    D.PART_CATS.forEach(c => {
      const ok = useTicket || (g.funds >= dc.money && g.rp >= dc.rp);
      body += '<button class="pickbtn" data-k="des:' + c.key + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic ic-art" style="background:' + c.color + '">' + U.partIcon(c.key, 26, 0) + '</span>' +
        '<span class="pb-body"><b>' + esc(c.names[Math.min(c.names.length - 1, g.carGen)]) + ' を設計</b>' +
        '<small>' + c.name + '／' + D.CAR_GENS[g.carGen].name + '世代</small></span>' +
        '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>' : '💰' + money(dc.money) + '<br>🔬' + dc.rp) + '</span></button>';
    });
    body += '</div>';
    U.modal('🔧 マシン開発', body, [{ label: 'やめる', fn: U.closeModal }]);
    paintInterior();
    const tg = $('tkToggle');
    if (tg) tg.onclick = () => { useTicket = !useTicket; GP.sound.play('tap'); cmdDevelop(); };
    Array.prototype.forEach.call($('modalBody').querySelectorAll('.focusbtn'), b => {
      b.onclick = () => {
        g.focus = b.dataset.focus;
        GP.sound.play('tap');
        const f = S.focusOf(g);
        U.log(g, '📐 開発方針を「' + f.icon + f.name + '」にした。');
        S.save(g); render(); cmdDevelop();
      };
    });
    bindPick(k => {
      const [kind, key] = k.split(':');
      if (kind === 'imp') doImprove(key);
      else if (kind === 'bdy') doBody(key);
      else doDesign(key);
    });
  }

  const bodyCost = v => Math.round(380 + v * 34);

  function doBody(key) {
    const a = D.BODY_ATTRS.find(x => x.key === key);
    if (!a || !g.body) return;
    const v = g.body[key] || 0;
    const cap = S.bodyCap(g);
    const cost = bodyCost(v);
    const free = spendTicket();
    if (!free) {
      if (g.funds < cost || g.rp < 8) return;
      g.funds -= cost; g.rp -= 8; capSpend(cost);
    }
    const facBonus = 1 + g.facilities.factory * 0.10 + g.facilities.tunnel * 0.06;
    const engBonus = 1 + S.staffBonus(g, 'engineer') * 0.12 + S.mgr(g, 'technical') * 0.008;
    const drvBonus = 1 + g.drivers.reduce((acc, d) => acc + S.persOf(d).dev, 0);
    const fc = S.focusOf(g);
    let gain = S.rnd(2.6, 4.2) * facBonus * engBonus * drvBonus * planMul((D.BODY_ATTRS.find(a => a.key === key) || {}).gain) * crunchMul() * S.devRate(g);
    let crit = false;
    if (Math.random() < 0.10) { gain *= 2.2; crit = true; }
    if (v >= cap) gain *= 0.30;   // 上限に達しても、完全には止まらない
    const toNext = gain * fc.next;
    gain = Math.round(gain * fc.cur * 10) / 10;
    g.nextCar = (g.nextCar || 0) + toNext;
    g.body[key] = Math.round((v + gain) * 10) / 10;

    U.closeModal();
    GP.sound.play(crit ? 'crit' : 'confirm');
    staffExp('engineer', 9); staffExp('designer', 4);
    U.log(g, a.icon + ' 車体の' + a.name + ' +' + gain.toFixed(1) + (crit ? '  ✨大きな発見！' : ''), crit ? 'good' : '');
    U.pop('+' + gain.toFixed(1) + ' ' + a.name, crit ? 'crit' : 'good');
    if (crit) U.toast('✨ 車体の' + a.name + 'で大きな発見！', 'good');
    if (g.body[key] >= cap) U.toast('この車体は煮詰まりました。パーツを仕上げれば次の世代へ進みます。', 'warn');
    endWeek();
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

  /* ---- 徹夜 ----
     その週の開発・研究・整備・練習を「2回ぶん」の効きにする代わりに、
     ドライバーとスタッフに疲れが残り、マシンのコンディションも落ちる。
     使いどころを選ばせたいので、連続で使うほど反動が大きくなる。      */
  function crunchOn() { return !!g.crunch; }

  function crunchMul() { return crunchOn() ? 2 : 1; }

  function cmdCrunch() {
    if (crunchOn()) {
      return U.modal('🌙 徹夜',
        '<p class="lead">今週はすでに徹夜態勢だ。</p>' +
        '<p class="desc">このまま開発・研究・整備・練習のどれかを実行すると、' +
        '2回ぶんの効きになります。</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    const row = (g.crunchRow || 0);
    const cost = Math.round(300 + row * 260 + g.staff.length * 40);
    const formHit = 6 + row * 5;
    const condHit = 5 + row * 4;
    U.modal('🌙 徹夜',
      '<p class="lead">工場に明かりを点けたまま、今週を走り切ります。</p>' +
      '<div class="bigbox">この週の 開発・研究・整備・練習 が <b>2回ぶん</b></div>' +
      '<p class="desc">代償として、ドライバーの調子 <b>-' + formHit + '</b>、' +
      'マシンのコンディション <b>-' + condHit + '</b>、費用 <b>💰' + money(cost) + '万</b>。<br>' +
      (row > 0 ? '<b class="bad">連続 ' + row + ' 週目なので反動が大きくなっています。</b>'
               : '休養を挟むと反動は戻ります。') + '</p>',
      [
        { label: '🌙 徹夜する', cls: 'primary', disabled: g.funds < cost,
          fn: () => {
            g.funds -= cost;
            g.crunch = true;
            g.drivers.forEach(d => { d.form = S.clamp(d.form - formHit, 62, 122); });
            D.PART_CATS.forEach(c => {
              const p2 = g.equipped[c.key];
              if (p2) p2.cond = S.clamp(p2.cond - condHit, 10, 100);
            });
            S.save(g);
            U.closeModal();
            U.toast('🌙 徹夜態勢。次の1コマンドが2回ぶん', 'good');
            U.log(g, '🌙 徹夜で作業した。次の1コマンドが2回ぶんになる。');
            GP.sound.play('confirm');
            render();
          } },
        { label: 'やめる', fn: U.closeModal }
      ]);
  }

  /* 徹夜を使い切ったときの後始末。endWeek から呼ぶ */
  function crunchConsume(used) {
    if (!g.crunch) { g.crunchRow = 0; return; }
    g.crunch = false;
    g.crunchRow = (g.crunchRow || 0) + (used ? 1 : 0);
  }

  /* 来季のマシン方針。オフに決めた方向は伸びやすく、外れた方向は少し鈍る。
     'balance' はどこも少しだけ底上げする。                          */
  function planMul(gainVec) {
    const p = g.plan;
    if (!p) return 1;
    if (p === 'balance') return 1.06;
    // 速さの向きを持たない項目（整備性など）は、方針の影響を受けない
    if (gainVec && !gainVec.speed && !gainVec.corner && !gainVec.accel) return 1;
    const w = (gainVec && gainVec[p]) || 0;
    if (w >= 0.5) return 1.22;
    if (w <= 0.15) return 0.92;
    return 1;
  }

  function doImprove(key) {
    const c = D.PART_CATS.find(x => x.key === key);
    const p = g.equipped[key];
    if (!p) return;
    const cost = improveCost(p), cap = S.partCap(g, p);
    const free = spendTicket();
    if (!free) {
      if (g.funds < cost || g.rp < c.rp) return;
      g.funds -= cost; g.rp -= c.rp; capSpend(cost);
    }

    const facBonus = 1 + g.facilities.factory * 0.10 +
      ((key === 'aero' || key === 'susp') ? g.facilities.tunnel * 0.12 : 0);
    const engBonus = 1 + S.staffBonus(g, 'engineer') * 0.14;
    // ドライバーのフィードバック（職人肌ほど的確）
    const drvBonus = 1 + g.drivers.reduce((a, d) => a + S.persOf(d).dev, 0);
    const fc = S.focusOf(g);
    let gain = S.rnd(3.4, 5.6) * facBonus * engBonus * drvBonus * planMul(c.gain) * crunchMul() * S.devRate(g);
    let crit = false;
    if (Math.random() < 0.12) { gain *= 2.2; crit = true; }
    if (p.power >= cap) gain *= 0.30;   // 上限に達しても、完全には止まらない
    // 来季に回したぶんは今季に乗らない
    const toNext = gain * fc.next;
    gain = Math.round(gain * fc.cur * 10) / 10;
    g.nextCar = (g.nextCar || 0) + toNext;

    p.power = Math.round((p.power + gain) * 10) / 10;
    p.cond = S.clamp(p.cond - S.rnd(2.5, 7) * (S.hasT(p, 'tough') ? 0.6 : 1), 10, 100);

    const msg = c.icon + ' ' + p.name + ' の性能 +' + gain.toFixed(1) + (crit ? '  ✨ひらめき大成功！' : '');
    staffExp('engineer', 12); staffExp('designer', 3);
    U.log(g, msg, crit ? 'good' : '');
    GP.sound.play(crit ? 'crit' : 'confirm');
    if (p.power >= cap) U.toast('このパーツは限界です。残りも仕上げれば、マシンが次の世代へ進みます。', 'warn');
    // 手を入れた実感が出るように、伸びを見せてから週を進める
    showDevResult({
      icon: U.partIcon(c.key, 44, p.rar), color: c.color,
      title: p.name, sub: c.name,
      from: p.power - gain, to: p.power, cap: cap, gain: gain, crit: crit,
      next: toNext > 0.05 ? toNext : 0
    }, endWeek);
  }

  /* ---- 開発の手応え ----
     数字だけだと何をしたのか分からないので、ゲージが伸びるところを見せる。
     大成功なら派手に。来季へ回ったぶんも併せて出す。                */
  function showDevResult(r, done) {
    const pct = v => Math.max(0, Math.min(100, v / Math.max(1, r.cap) * 100));
    const body =
      '<div class="devres' + (r.crit ? ' crit' : '') + '">' +
        '<div class="dv-head"><span class="dv-ic" style="background:' + r.color + '">' + r.icon + '</span>' +
          '<span class="dv-nm"><b>' + esc(r.title) + '</b><small>' + esc(r.sub) + '</small></span>' +
          '<span class="dv-gain">+<b id="dvNum">0.0</b></span></div>' +
        '<div class="dv-bar"><i class="dv-old" style="width:' + pct(r.from).toFixed(1) + '%"></i>' +
          '<i class="dv-new" id="dvNew" style="width:' + pct(r.from).toFixed(1) + '%"></i>' +
          '<b>' + Math.round(r.from) + ' → <u id="dvVal">' + Math.round(r.from) + '</u> / ' + r.cap + '</b></div>' +
        (r.crit ? '<div class="dv-crit">✨ ひらめいた！ 開発が大成功！</div>' : '') +
        (r.next ? '<p class="desc">来季のマシンへ <b>+' + r.next.toFixed(1) + '</b> 積み上げた。</p>' : '') +
      '</div>';
    // 「次へ」でも ✕ でも、必ず一度だけ週を進める。
    // ✕ で閉じられると週を消費せずに開発できてしまうため。
    let settled = false;
    const x = $('modalClose');
    const prev = x ? x.onclick : null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (x) x.onclick = prev;          // ✕ の役目を必ず元に戻す
      U.closeModal();
      if (done) done();
    };
    U.modal('🔧 開発', body, [{ label: '次へ', cls: 'primary', fn: finish }]);
    if (x) x.onclick = finish;
    // ゲージと数字を動かす
    const el = $('dvNew'), num = $('dvNum'), val = $('dvVal');
    if (!el) { return; }
    const t0 = performance.now(), dur = r.crit ? 900 : 620;
    const step = (ts) => {
      const k = Math.min(1, (ts - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);           // 最後にゆっくり止まる
      el.style.width = pct(r.from + r.gain * e).toFixed(1) + '%';
      if (num) num.textContent = (r.gain * e).toFixed(1);
      if (val) val.textContent = Math.round(r.from + r.gain * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function doDesign(key) {
    const c = D.PART_CATS.find(x => x.key === key);
    const dc = designCost();
    if (g.inventory.length >= 24) { U.toast('保管庫がいっぱいです。「マシン」で合成・破棄しましょう。', 'warn'); return; }
    const free = spendTicket();
    if (!free) {
      if (g.funds < dc.money || g.rp < dc.rp) return;
      g.funds -= dc.money; g.rp -= dc.rp; capSpend(dc.money);
    }

    const rarity = S.rollRarity(g);
    const part = S.makePart(key, g.carGen, rarity);
    g.inventory.push(part);

    const rr = D.RARITY[rarity - 1];
    U.closeModal();
    U.log(g, '📐 ' + part.name + '（' + rr.name + '）が完成！ 性能 ' + Math.round(part.power), rarity >= 3 ? 'good' : '');
    GP.sound.play(rarity >= 4 ? 'crit' : 'confirm');
    staffExp('designer', 14); staffExp('engineer', 3);
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
    let body = interiorHTML('tunnel') +
      '<div class="pick">' +
      '<button class="pickbtn" data-k="__gain"><span class="pb-ic" style="background:#8a6ad0">🔬</span>' +
      '<span class="pb-body"><b>データ解析</b><small>1週かけて研究ポイントを稼ぐ</small></span>' +
      '<span class="pb-cost">+' + Math.round(12 + S.staffBonus(g, 'analyst') * 4 + g.facilities.sim * 2) + '🔬</span></button></div>';

    body += '<div class="sub">マシンの世代</div>';
    body += '<p class="desc">現在のマシン：<b>' + cur.name + '</b>' +
      '（パーツの開発上限 ' + cur.cap + '／車体の熟成上限 ' + S.bodyCap(g) + '）</p>';
    if (!nx) {
      body += '<div class="bigbox">🏁 最終型 <b>' + cur.name + '</b> に到達済み</div>';
    } else {
      const prog = Math.round(S.genProgress(g) / S.GEN_STEP_AT * 100);
      const nv = S.nextCarPreview(g);
      body += '<div class="genbox">' +
        '<b>' + cur.name + ' → ' + nx.name + '</b>' +
        '<span class="skbar big"><i style="width:' + Math.min(100, prog) + '%"></i></span>' +
        '<em>' + Math.min(100, prog) + '%</em>' +
        '<small>装着中のパーツを上限まで煮詰めると、マシンはひとりでに次の世代へ更新されます。' +
        '買い物ではないので、資金も研究Pも要りません。<br>' +
        'パーツ上限 ' + cur.cap + ' → ' + nx.cap +
        '／車体上限 ' + S.bodyCap(g) + ' → ' + Math.round(nx.cap * D.BODY_CAP_RATIO) +
        '（各項目 <b>' + nv.withStock + '</b> から再スタート' +
        (nv.gain > 0 ? '／うち +' + nv.gain + ' は来季ぶんの仕込み' : '') + '）</small></div>';
    }
    // ---- パワーユニットの供給 ----
    // 自前で育てるか、強いチームから買うか。買えばすぐ速くなるが、
    // 供給を受けているあいだは自分で手を入れられず、毎戦の供給料もかかる。
    body += '<div class="sub">パワーユニットの供給</div>';
    if (g.engine) {
      const mine = g.equipped.pu;
      body += '<div class="bigbox">🔌 <b>' + esc(g.engine.team) + '</b> から供給を受けています' +
        '<small>性能 ' + (mine ? Math.round(mine.power) : '-') +
        '／供給料 💰' + money(g.engine.fee) + '万 毎戦</small></div>' +
        '<p class="desc">供給中は、自分でパワーユニットを開発・交換できません。' +
        '契約を切ると、自前のパワーユニットに戻ります。</p>' +
        '<div class="pick"><button class="pickbtn" data-k="__engoff">' +
        '<span class="pb-ic engic">✂️</span>' +
        '<span class="pb-body"><b>供給契約を切る</b>' +
        '<small>' + (g.engine.season === g.season ? '今季中の解約は違約金がかかります' : '違約金なし') +
        '</small></span><span class="pb-cost">' +
        (g.engine.season === g.season ? '💰' + money(engineBreakFee()) : '無料') +
        '</span></button></div>';
    } else {
      const offers = engineOffers();
      if (!offers.length) {
        body += '<p class="desc">いまは、こちらより強いパワーユニットを' +
          '分けてくれるチームがありません。</p>';
      } else {
        body += '<p class="desc">強いチームからパワーユニットを買えます。' +
          'すぐに速くなりますが、供給中は自分で開発できず、毎戦の供給料がかかります。</p>' +
          '<div class="pick">';
        offers.forEach(o => {
          const ok = g.funds >= o.upfront;
          body += '<button class="pickbtn" data-k="__eng:' + esc(o.team) + '"' + (ok ? '' : ' disabled') + '>' +
            '<span class="pb-ic engic" style="border-color:' + o.color + '">🔌</span>' +
            '<span class="pb-body"><b>' + esc(o.team) + ' 製</b>' +
            '<small>性能 ' + o.power + '（いまの自前は ' + o.mine + '）' +
            '／供給料 💰' + money(o.fee) + '万 毎戦</small></span>' +
            '<span class="pb-cost">💰' + money(o.upfront) + '</span></button>';
        });
        body += '</div>';
      }
    }

    U.modal('🔬 研究開発', body, [{ label: 'やめる', fn: U.closeModal }]);
    paintInterior();
    bindPick(k => {
      if (k === '__gain') return doResearchGain();
      if (k === '__engoff') return doEngineOff();
      if (k.indexOf('__eng:') === 0) return doEngineOn(k.slice(6));
    });
  }

  /* ---- エンジン供給 ---- */
  function engineBreakFee() {
    return Math.round((g.engine ? g.engine.fee : 0) * 6 + 900);
  }

  /* こちらより強いパワーユニットを持つチームの一覧。
     速いチームほど高く売る。                                        */
  function engineOffers() {
    const track = D.TRACKS[Math.min(g.nextRace, D.TRACKS.length - 1)];
    const teams = S.allTeams(g, track).filter(t => !t.isPlayer);
    if (!teams.length) return [];
    const scores = teams.map(t => t.car);
    const lo = Math.min.apply(null, scores), hi = Math.max.apply(null, scores);
    const cap = D.CAR_GENS[g.carGen].cap;
    const mine = g.equipped.pu ? Math.round(g.equipped.pu.power) : 0;
    return teams.map(t => {
      const rank01 = hi > lo ? (t.car - lo) / (hi - lo) : 0.5;
      const power = Math.round(cap * (0.55 + rank01 * 0.62));
      return {
        team: t.name, color: t.color, power: power, mine: mine, rank01: rank01,
        upfront: Math.round(1200 + power * 78 + rank01 * 2600),
        fee: Math.round(120 + power * 7 + rank01 * 190)
      };
    }).filter(o => o.power > mine + 2)
      .sort((a, b) => b.power - a.power)
      .slice(0, 4);
  }

  function doEngineOn(teamName) {
    const o = engineOffers().find(x => x.team === teamName);
    if (!o || g.funds < o.upfront) return;
    g.funds -= o.upfront;
    // 自前のパワーユニットは預けておき、契約を切ったら戻す
    g.engineStash = g.equipped.pu || null;
    g.equipped.pu = S.makePart('pu', g.carGen, 3, { power: o.power, name: o.team + ' PU' });
    g.equipped.pu.supplied = true;
    g.equipped.pu.name = o.team + ' 製 PU';
    g.engine = { team: o.team, fee: o.fee, power: o.power, season: g.season };
    U.closeModal();
    U.log(g, '🔌 ' + o.team + ' からパワーユニットの供給を受けることにした（性能 ' + o.power + '）');
    U.toast('🔌 ' + o.team + ' 製 PU を搭載', 'good');
    GP.sound.play('good');
    S.save(g); render();
  }

  function doEngineOff() {
    if (!g.engine) return;
    const fee = g.engine.season === g.season ? engineBreakFee() : 0;
    if (fee > g.funds) return U.toast('違約金が払えません', 'bad');
    g.funds -= fee;
    g.equipped.pu = g.engineStash || S.makePart('pu', g.carGen, 1, {});
    g.engineStash = null;
    const was = g.engine.team;
    g.engine = null;
    U.closeModal();
    U.log(g, '✂️ ' + was + ' との供給契約を切り、自前のパワーユニットに戻した' +
      (fee ? '（違約金 ' + money(fee) + '万）' : ''));
    S.save(g); render();
  }

  function doResearchGain() {
    const gain = Math.round((12 + S.staffBonus(g, 'analyst') * 4 + g.facilities.sim * 2
                            + S.osk(g, 'eye') + S.rnd(-2, 6)) * crunchMul());   // 技術眼
    g.rp += gain;
    U.closeModal();
    staffExp('analyst', 12);
    U.log(g, '🔬 データ解析を行った。研究P +' + gain);
    U.pop('🔬+' + gain, 'good');
    endWeek();
  }



  /* =======================================================
     コマンド：整備
     ======================================================= */
  function cmdMaintain() {
    const sum = D.PART_CATS.reduce((a, c) => a + (g.equipped[c.key] ? g.equipped[c.key].power : 0), 0);
    const cost = Math.round(400 + sum * 6);
    const body = interiorHTML('pit') +
      '<p class="lead">マシンを分解整備して信頼性を回復します。</p>' +
      '<div class="bigbox">現在の信頼性 <b>' + Math.round(S.reliability(g)) + '%</b></div>' +
      '<p class="desc">費用：💰' + money(cost) + '万（1週消費）<br>各パーツのコンディションが大きく回復します。</p>';
    U.modal('🛠️ 分解整備', body, [
      { label: '整備する', cls: 'primary', disabled: g.funds < cost, fn: () => doMaintain(cost) },
      { label: 'やめる', fn: U.closeModal }
    ]);
    paintInterior();
  }
  function doMaintain(cost) {
    g.funds -= cost;
    const mech = 1 + S.staffBonus(g, 'mechanic') * 0.2 + g.facilities.pit * 0.08;
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (p) p.cond = S.clamp(p.cond + S.rnd(16, 26) * mech, 10, 100);
    });
    const puGain = S.nursePU(g, S.rnd(8, 16) * (1 + S.staffBonus(g, 'mechanic') * 0.18));
    U.closeModal();
    staffExp('mechanic', 12);
    U.log(g, '🛠️ 分解整備を行った。信頼性 ' + Math.round(S.reliability(g)) + '%' +
             (puGain > 0 ? '／パワーユニットの残り +' + puGain + '%' : ''), 'good');
    U.pop('🛠️ 信頼性UP', 'good');
    endWeek();
  }

  /* =======================================================
     コマンド：練習
     ======================================================= */
  function cmdTrain() {
    if (!g.drivers.length) return U.toast('ドライバーがいません', 'bad');
    const menu = [['speed', '速さ', '🏎️'], ['technique', '技術', '🎯'], ['stamina', '体力', '💪'], ['mental', '精神', '🧠']];
    let body = interiorHTML('sim') +
      '<p class="lead">ドライバーと鍛える能力を選んでください。</p>';
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

    // ---- スタッフの研修 ----
    const wcost = Math.round(1400 + g.season * 500);
    const nStaff = (g.staff || []).length;
    body += '<div class="sub">スタッフの研修</div>' +
      '<p class="desc">現場を離れて学び直す週です（1週消費・費用 💰' + money(wcost) + '万）。' +
      '在籍している全員に経験が入り、若くて伸びしろのある人ほど大きく伸びます。' +
      '「指導者」がいるチームでは、さらに効きます。</p><div class="pick">';
    body += '<button class="pickbtn" data-k="wkshop"' +
      ((nStaff && g.funds >= wcost) ? '' : ' disabled') + '>' +
      '<span class="pb-ic" style="background:#3a7ad9">🏫</span>' +
      '<span class="pb-body"><b>全体研修をひらく</b>' +
      '<small>' + (nStaff ? nStaff + '人が参加。経験 +60（才能と年齢で伸びが変わる）'
                          : 'スタッフがいません') + '</small></span>' +
      '<span class="pb-cost">💰' + money(wcost) + '</span></button></div>';

    U.modal('💪 トレーニング', body, [{ label: 'やめる', fn: U.closeModal }], { wide: true });
    paintInterior();
    bindPick(k => {
      if (k === 'wkshop') doWorkshop(wcost);
      else if (k.indexOf('skill:') === 0) doSkillTrain(+k.split(':')[1], scost);
      else doTrain(k, cost);
    });
  }

  /* ---- スタッフの全体研修 ---- */
  function doWorkshop(cost) {
    if (!(g.staff || []).length || g.funds < cost) return;
    g.funds -= cost;
    const mentors = g.staff.filter(st => S.stTrait(st, 'mentor')).length;
    const before = g.staff.map(st => st.skill);
    staffExpAll(60 * (1 + mentors * 0.16));
    const after = g.staff.map(st => st.skill);
    const up = g.staff.filter((st, i) => after[i] > before[i]).length;
    U.closeModal();
    GP.sound.play('confirm');
    U.log(g, '🏫 全体研修をひらいた。' + (up ? up + '人の技能が伸びた。' : '目に見える伸びはなかった。'),
          up ? 'good' : '');
    U.pop('🏫 研修', up ? 'good' : '');
    endWeek();
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
    staffExp('trainer', 12);
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
    let body = interiorHTML('market') +
      '<p class="lead">スポンサー枠 ' + g.sponsors.length + ' / ' + slots + '（マーケティング室の拡張で増えます）</p>' +
      '<div class="hypebox"><span>' + ht.icon + ' メディアでの扱い <b style="color:' + ht.color + '">' + ht.name + '</b></span>' +
      '<span>スポンサー収入 <b>×' + S.hypeBonus(g).toFixed(2) + '</b></span></div>';

    if (g.sponsorOffer) {
      const sp = D.SPONSORS.find(x => x.name === g.sponsorOffer.name);
      if (sp) {
        body += '<div class="sub">📞 届いているオファー</div><div class="pick">' +
          '<button class="pickbtn offer" data-k="__offer">' +
          '<span class="pb-ic" style="background:#b06fd0">' + sp.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(sp.name) + ' から契約の打診</b>' + kindChip(sp) +
          '<small>' + payoutLine(sp) + '／' + sp.need + '位以内でボーナス ' + money(sp.bonus) + '万' +
          '<br>先方からの申し出なので契約金が上乗せされる：<b>+' + money(g.sponsorOffer.adv) + '万</b>' +
          (g.sponsorOffer.until != null ? '　<em class="warn">残り' + Math.max(0, g.sponsorOffer.until - g.week + 1) + '週</em>' : '') +
          '</small></span>' +
          '<span class="pb-cost">受ける</span></button></div>';
      }
    }
    // ---- タイトルスポンサー ----
    const cur = S.titleOf(g);
    body += '<div class="sub">👑 タイトルスポンサー</div>';
    if (cur) {
      body += '<div class="titlebox on"><b>' + cur.icon + ' ' + esc(cur.name) + '</b>' +
        '<span>チーム名：<b>' + esc(S.teamLabel(g)) + '</b></span>' +
        '<small>1戦あたり ' + money(cur.per) + '万' +
        (cur.rp ? '／研究P +' + cur.rp : '') + (cur.fan ? '／ファン +' + cur.fan : '') +
        '　契約はあと <b>' + g.title.left + 'シーズン</b></small></div>';
    } else {
      const open = S.titleOpen(g);
      body += '<p class="desc">チーム名に冠がつく、いちばん大きな契約です。' +
        'ファンと注目度が届いた相手からしか話は来ません。</p><div class="pick">';
      D.TITLE_SPONSORS.forEach(t => {
        const ok = open.indexOf(t) >= 0;
        body += '<button class="pickbtn' + (ok ? '' : ' done') + '" data-k="ttl:' + t.key + '"' +
          (ok ? '' : ' disabled') + '>' +
          '<span class="pb-ic" style="background:#8a6ad0">' + t.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(t.name) + '</b>' +
          '<small>' + esc(t.desc) + '<br>1戦 ' + money(t.per) + '万' +
          (t.rp ? '／研究P +' + t.rp : '') + (t.fan ? '／ファン +' + t.fan : '') +
          '　契約 ' + t.years + 'シーズン' +
          '<br>条件：ファン ' + money(t.fans) + ' 以上・注目度 ' + t.hype + ' 以上' +
          (ok ? '　<em class="free">条件を満たしています</em>' : '') + '</small></span>' +
          '<span class="pb-cost">' + (ok ? '交渉する' : '—') + '</span></button>';
      });
      body += '</div>';
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
        '<span class="pb-body"><b>' + esc(s.name) + '</b>' + kindChip(s) +
        '<small>' + payoutLine(s) + '<br>' + s.need + '位以内でボーナス ' + money(s.bonus) +
        '万' + (s.bonusRp ? '／研究P ' + s.bonusRp : '') + '</small></span>' +
        '<span class="pb-cost">契約</span></button>';
    });
    body += '</div><div class="sub">契約中</div><div class="pick">';
    g.sponsors.forEach(s => {
      body += '<div class="pickbtn done"><span class="pb-ic" style="background:#4ea63f">' + s.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(s.name) + '</b>' + kindChip(s) +
        '<small>' + payoutLine(s) + '<br>' + s.need + '位以内でボーナス（今季 ' +
        (s.hits || 0) + '/' + D.SPONSOR_BONUS_CAP + '回）</small></span>' +
        '<span class="pb-cost"><button class="mini danger" data-drop="' + esc(s.name) + '">解約</button></span></div>';
    });
    body += '</div>';
    U.modal('📣 営業活動', body, [{ label: 'やめる', fn: U.closeModal }]);
    paintInterior();
    bindPick(k => {
      if (k === '__ad') return doPromo();
      if (k === '__offer') return doAcceptOffer();
      if (k.indexOf('ttl:') === 0) return doTitleSponsor(k.slice(4));
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
  function kindChip(s) {
    const k = D.SPONSOR_KINDS[s.kind] || D.SPONSOR_KINDS.cash;
    return '<em class="skind ' + s.kind + '" title="' + esc(k.desc) + '">' + k.icon + k.name + '</em>';
  }
  function payoutLine(s) {
    const parts = [];
    if (s.per) parts.push('💰' + money(s.per) + '万');
    if (s.rp) parts.push('🔬' + s.rp);
    if (s.fan) parts.push('👥' + money(s.fan));
    return '毎戦 ' + parts.join('　');
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
    g.funds -= cost; capSpend(cost);

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
      g.funds -= c; capSpend(c); g.facilities[baseSel]++;
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
  let rivalStaffMarket = null;      // よそのチームで働いている人（引き抜きの相手）
  let hrTab = 'drivers';

  function teamQuality() { return GP.base.scale(g).value; }

  function refreshMarkets(force) {
    const q = teamQuality();
    if (force || !staffMarket) staffMarket = [0, 1, 2, 3].map(() => S.makeStaff(S.pick(D.STAFF_TYPES).key, q));
    if (force || !driverMarket) driverMarket = [0, 1, 2].map(() => S.makeDriver(1.2 + g.season * 1.4 + S.rnd(-0.6, 1.2)));
    if (force || !youthMarket) youthMarket = [0, 1, 2].map(() => S.makeYouth(g.season));
    if (force || !mgrMarket) mgrMarket = D.MANAGERS.map(m => S.makeManager(m.key, q));
    if (force || !rivalStaffMarket) rivalStaffMarket = [0, 1, 2].map(() => S.makeRivalStaff(g, q));
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
  /* 固有スキルの札。専門外へ効くものは、どの職能に乗るかも書く */
  function traitChips(st) {
    if (!st.traits || !st.traits.length) return '';
    return '<span class="trchips">' + st.traits.map(k => {
      const t = S.traitOf(k);
      if (!t) return '';
      const to = t.cross ? (D.STAFF_TYPES.find(x => x.key === t.cross) || {}).name : '';
      return '<em class="trchip' + (t.cross ? ' cross' : '') + '" title="' + esc(t.desc) + '">' +
        t.icon + ' ' + t.name + (to ? '<b>→' + to + '</b>' : '') + '</em>';
    }).join('') + '</span>';
  }

  function staffRow(st, actions, extra) {
    const t = D.STAFF_TYPES.find(x => x.key === st.type);
    const cap = S.staffCap(st);
    const pct = Math.min(100, st.skill / cap * 100);
    const rank = st.skill >= 45 ? '一流' : st.skill >= 32 ? '熟練' : st.skill >= 20 ? '中堅' : '見習い';
    const pt = S.potOf(st);
    const need = S.staffNeed(st);
    const exPct = Math.min(100, (st.exp || 0) / need * 100);
    const capped = st.skill >= cap;
    return '<div class="pickbtn done staffrow">' +
      '<span class="pb-ic" style="background:#7b5a3a">' + t.icon + '</span>' +
      '<span class="pb-body"><b>' + esc(st.name) + '</b>' +
      '<small>' + t.name + '　<em class="srank">' + rank + '</em>' +
      '　<em class="sage">' + (st.age || 34) + '歳</em>' +
      '　<em class="spot" style="color:' + pt.color + '">' + U.stars(st.pot || 2) + ' ' + pt.name + '</em>' +
      '<br><span class="skbar"><i style="width:' + pct + '%"></i></span> 技能 <b>' + st.skill +
      '</b> <em class="scap">/ ' + cap + (capped ? '（上限）' : '') + '</em>' +
      '<br><span class="skbar exp"><i style="width:' + exPct + '%"></i></span> ' +
      'Lv.<b>' + (st.expLv || 1) + '</b> <em class="scap">次まで ' +
      Math.max(0, Math.ceil(need - (st.exp || 0))) + '</em>' +
      '<br>' + t.desc + traitChips(st) + (extra || '') + '</small></span>' +
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
    body += '</div>';

    // ---- リザーブドライバー ----
    body += '<div class="sub">🪑 リザーブドライバー</div>' +
      '<p class="desc">万一のときに走る控えです。給料は正ドライバーの ' +
      Math.round(S.RESERVE_PAY * 100) + '%。事故で負傷したドライバーの代役に入り、' +
      'いつでも正ドライバーと入れ替えられます。</p><div class="pick">';
    if (g.reserve) {
      const r = g.reserve;
      const swaps = g.drivers.map(d =>
        '<button class="mini" data-swapres="' + d.id + '">' + esc(d.name) + 'と交代</button>').join('');
      body += '<div class="pickbtn done">' +
        '<span class="pb-ic face-ic">' + U.face(r, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(r.name) + '</b><small>' + S.nationOf(r).flag + ' 総合 ' +
        Math.round(S.driverRating(r)) + '／' + r.age + '歳／' + S.persOf(r).icon + S.persOf(r).name +
        (r.outFor > 0 ? '　<em class="warn">負傷欠場 あと' + r.outFor + '戦</em>' : '') +
        '<br>' + U.skillChips(r) + '</small></span>' +
        '<span class="pb-cost">週' + money(r.salary) + '万<br>' + swaps +
        '<button class="mini danger" data-relres="1">解除</button></span></div>';
    } else {
      body += '<p class="desc">リザーブはいません。下部組織の若手か、市場のドライバーを置けます。</p>';
      (g.youth || []).forEach(d => {
        body += '<div class="pickbtn done youthrow">' +
          '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
          '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' + S.nationOf(d).flag + ' ' +
          d.age + '歳／総合 ' + Math.round(S.driverRating(d)) + '（下部組織）</small></span>' +
          '<span class="pb-cost"><button class="mini" data-tores="' + d.id + '">リザーブへ</button></span></div>';
      });
    }
    body += '</div>';

    body += '<div class="sub">ドライバー市場</div><div class="pick">';
    driverMarket.forEach((d, i) => {
      const fee = Math.round(d.salary * 12);
      const full = g.drivers.length >= 2;
      body += '<button class="pickbtn" data-k="dm:' + i + '"' + ((full || g.funds < fee) ? ' disabled' : '') + '>' +
        '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' + S.nationOf(d).flag + ' 総合 ' +
        Math.round(S.driverRating(d)) + '／' + d.age + '歳／' + S.persOf(d).icon + S.persOf(d).name +
        '<br>速' + Math.round(d.speed) + ' 技' + Math.round(d.technique) + ' 体' + Math.round(d.stamina) + ' 精' + Math.round(d.mental) +
        '<br>' + U.skillChips(d) + '</small></span>' +
        '<span class="pb-cost">契約金<br>💰' + money(fee) +
        (g.reserve ? '' : '<br><button class="mini" data-mktres="' + i + '">リザーブへ</button>') +
        '</span></button>';
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
      const roles = S.promotableRoles(g, st);
      const up = roles.map(r => {
        const m = D.MANAGERS.find(x => x.key === r);
        return '<button class="mini good" data-promote-staff="' + st.id + ':' + r + '">' +
          m.icon + ' ' + m.name + 'へ</button>';
      }).join('');
      body += staffRow(st,
        up + '<button class="mini danger" data-firestaff="' + st.id + '">解雇</button>',
        st.skill >= S.PROMOTE_MIN && !roles.length ? '<br><em class="warn">昇進先が埋まっています</em>' : '');
    });
    body += '</div>';
    body += '<p class="desc">技能 ' + S.PROMOTE_MIN + ' 以上の人は、空いている首脳陣の役職に' +
      '<b>昇進</b>させられます。技能は少し目減りしますが、効き方がチーム全体に変わります。</p>';
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
        '　' + (st.age || 34) + '歳　<em style="color:' + S.potOf(st).color + '">' +
        U.stars(st.pot || 2) + ' ' + S.potOf(st).name + '</em>' +
        '<br><span class="skbar"><i style="width:' + Math.min(100, st.skill / S.staffCap(st) * 100) + '%"></i></span>' +
        traitChips(st) +
        '</small></span><span class="pb-cost">💰' + money(fee) + '<br><em>週' + money(st.salary) + '</em></span></button>';
    });
    body += '</div>';

    // ---- よそのチームから引き抜く ----
    body += '<div class="sub">🕵️ 他チームのスタッフを引き抜く</div>' +
      '<p class="desc">よそで働いている人は、市場の応募者より腕が立ちます。' +
      'そのぶん要る金は高く、「一途」な人はなかなか動きません。' +
      'オーナーの交渉術があると安く済みます。</p><div class="pick">';
    rivalStaffMarket.forEach((st, i) => {
      const fee = S.poachFee(g, st);
      const t = D.STAFF_TYPES.find(x => x.key === st.type) || {};
      body += '<button class="pickbtn" data-k="ps:' + i + '"' + (g.funds < fee ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:#8a4a3a">' + t.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(st.name) + '</b><small>' +
        t.name + '／技能 ' + st.skill + '　' + (st.age || 34) + '歳　<em class="fromteam">' + esc(st.team) + '</em>' +
        '　<em style="color:' + S.potOf(st).color + '">' + U.stars(st.pot || 2) + '</em>' +
        '<br><span class="skbar"><i style="width:' + Math.min(100, st.skill / S.staffCap(st) * 100) + '%"></i></span>' +
        traitChips(st) +
        '</small></span><span class="pb-cost">引き抜き<br>💰' + money(fee) + '<br><em>週' + money(st.salary) + '</em></span></button>';
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
    } else if (kind === 'ps') {
      const st = rivalStaffMarket[idx];
      if (!st) return;
      const fee = S.poachFee(g, st);
      if (g.funds < fee) return;
      g.funds -= fee;
      const from = st.team;
      delete st.team;
      g.staff.push(st);
      rivalStaffMarket.splice(idx, 1);
      GP.sound.play('crit');
      U.log(g, '🕵️ ' + from + ' から ' + st.name + '（技能 ' + st.skill + '）を引き抜いた！', 'good');
      U.toast('🕵️ ' + st.name + ' を引き抜いた！', 'good');
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
    Array.prototype.forEach.call(body.querySelectorAll('[data-tores]'), b => {
      b.onclick = () => {
        const d = (g.youth || []).find(x => x.id === b.dataset.tores);
        if (!d || g.reserve) return;
        g.youth = g.youth.filter(x => x.id !== b.dataset.tores);
        S.setReserve(g, d);
        GP.sound.play('confirm');
        U.log(g, '🪑 ' + d.name + ' をリザーブドライバーにした。', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-mktres]'), b => {
      b.onclick = ev => {
        ev.stopPropagation();
        const d = driverMarket[+b.dataset.mktres];
        if (!d || g.reserve) return;
        const fee = Math.round(d.salary * 12 * S.RESERVE_PAY);
        if (g.funds < fee) return U.toast('資金が足りません', 'bad');
        g.funds -= fee;
        driverMarket.splice(+b.dataset.mktres, 1);
        S.setReserve(g, d);
        GP.sound.play('confirm');
        U.log(g, '🪑 ' + d.name + ' とリザーブ契約を結んだ（契約金 ' + money(fee) + '万）。', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-swapres]'), b => {
      b.onclick = () => {
        const r = S.swapReserve(g, b.dataset.swapres);
        if (!r) return;
        GP.sound.play('levelup');
        U.log(g, '🔁 ' + r.inD.name + ' が正ドライバーに、' + r.outD.name + ' がリザーブに回った。', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-relres]'), b => {
      b.onclick = () => {
        const d = S.clearReserve(g);
        if (!d) return;
        U.log(g, '👋 リザーブの ' + d.name + ' との契約を解除した。');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-promote-staff]'), b => {
      b.onclick = () => {
        const [id, role] = b.dataset.promoteStaff.split(':');
        const r = S.promoteStaff(g, id, role);
        if (!r) return;
        const m = D.MANAGERS.find(x => x.key === role);
        GP.sound.play('levelup');
        U.log(g, '👔 ' + r.name + ' が ' + m.name + ' に昇進した！（技能 ' + r.skill +
                 '／週' + money(r.salary) + '万）', 'good');
        U.toast('👔 ' + r.name + ' が' + m.name + 'に昇進！', 'good');
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
    // レース週の朝。体調を崩して走れない人が出ることがある
    if (!raceCtx || raceCtx.trackIndex !== trackIndex || !raceCtx.rolled) {
      S.rollAbsence(g).forEach(d => {
        const cover = g.reserve && S.canDrive(g.reserve);
        U.log(g, '🤒 ' + d.name + ' が体調不良で今週は走れない。' +
          (cover ? 'リザーブの ' + g.reserve.name + ' が代役に入る。'
                 : 'リザーブがいないため、押して出走することになる…'), cover ? 'warn' : 'bad');
        U.toast('🤒 ' + d.name + ' が欠場', 'warn');
      });
    }
    raceCtx = { trackIndex: trackIndex, special: special, rolled: true };
    // 実際に走る2人。負傷や体調不良ならリザーブが入る
    const lineup = S.allTeams(g, t).find(x => x.isPlayer).drivers;
    pendingStrategy = {};
    lineup.forEach(d => { pendingStrategy[d.id] = 'balance'; });
    const laps = Math.max(4, Math.round(t.laps * (special ? special.lapMul : 1)));

    let body = '<div class="racehead"><b>' +
      (special ? special.icon + ' ' + esc(special.name) : '第' + (trackIndex + 1) + '戦') + ' ' +
      t.country + ' ' + esc(t.name) + '</b>' +
      '<span>' + laps + '周 ／ ' + esc(t.desc) + '</span></div>';
    if (special) body += '<p class="note">' + esc(special.note) + '</p>';

    // ---- パワーユニットの状態 ----
    const pu = S.puOf(g);
    const wear = S.puWear(g, t, 1);
    const left = Math.max(0, D.PU_LIMIT - pu.used);
    const willSwap = pu.life - wear <= 0;
    body += '<div class="pubox' + (pu.grid ? ' pen' : willSwap && left <= 0 ? ' warn' : '') + '">' +
      '<b>⚙️ パワーユニット ' + pu.used + '基目／今季あと ' + left + '基</b>' +
      '<span class="skbar big"><i class="' + (pu.life < 25 ? 'f2' : pu.life < 50 ? 'f1' : 'f0') +
        '" style="width:' + Math.round(pu.life) + '%"></i></span>' +
      '<em>残り ' + Math.round(pu.life) + '%</em>' +
      '<small>このコースを走ると、およそ ' + Math.round(wear) + '% 減ります。' +
      (willSwap
        ? (left > 0 ? 'このレースで載せ替えになります。'
                    : '<b class="warn">上限を超えるため、次戦は ' + D.PU_PENALTY + 'グリッド降格になります。</b>')
        : '「🛠️ 整備」で少し延命できます。') +
      (pu.grid ? '<br><b class="warn">今回は基数超過により ' + pu.grid + 'グリッド降格でスタートします。</b>' : '') +
      '</small></div>';

    const subs = lineup.filter(d => d.standIn || d.hurt);
    if (subs.length) {
      body += '<p class="note">' + subs.map(d => d.hurt
        ? '🩹 ' + esc(d.name) + ' は本調子ではありません（本来の力を出せません）'
        : '🪑 リザーブの ' + esc(d.name) + ' が代役として出走します').join('<br>') + '</p>';
    }
    body += '<div class="sub">作戦を決める</div>';
    lineup.forEach(d => {
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
    lineup.forEach(d => {
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

    // ---- ピット回数とタイヤの狙い ----
    body += '<div class="sub">ピット作戦</div>' +
      '<p class="desc">ストップが少ないほど1回のロスは減りますが、' +
      'タイヤを長く使うぶんペースが落ちます。多いほど新しいタイヤで攻められます。</p>';
    const STOPS = [['auto', 'おまかせ', 'コースに合わせて決める'],
                   ['1', '1ストップ', '引っ張る'],
                   ['2', '2ストップ', '標準'],
                   ['3', '3ストップ', '攻める']];
    const TBIAS = [['0', '柔らかめ', '速いが減る'],
                   ['1', 'バランス', ''],
                   ['2', '硬め', '遅いが保つ']];
    g.drivers.forEach(d => {
      body += '<div class="stratrow"><div class="sr-nm">' + esc(d.name) + '</div>' +
        '<div class="sr-btns" data-stops="' + d.id + '">';
      STOPS.forEach(o => {
        body += '<button class="stratbtn small' + (o[0] === 'auto' ? ' on' : '') + '" data-v="' + o[0] + '">' +
          o[1] + '<br><small>' + o[2] + '</small></button>';
      });
      body += '</div></div>';
      body += '<div class="stratrow"><div class="sr-nm"><small>タイヤの狙い</small></div>' +
        '<div class="sr-btns" data-tbias="' + d.id + '">';
      TBIAS.forEach(o => {
        body += '<button class="stratbtn small' + (o[0] === '1' ? ' on' : '') + '" data-v="' + o[0] + '">' +
          o[1] + (o[2] ? '<br><small>' + o[2] + '</small>' : '') + '</button>';
      });
      body += '</div></div>';
      pendingStrategy['stops_' + d.id] = 'auto';
      pendingStrategy['tbias_' + d.id] = '1';
    });

    // ---- ライバルの作戦の傾向 ----
    // 対戦を重ねると読めるように、チームごとの性格を出しておく
    body += '<div class="sub small">ライバルの作戦傾向</div><div class="stylelist">';
    (g.rivals || []).slice(0, 10).forEach(r => {
      const st = D.STRAT_STYLES[r.style] || D.STRAT_STYLES.balanced;
      body += '<span class="stylechip"><i style="background:' + r.color + '"></i>' +
        esc(r.name) + ' <b>' + st.icon + st.name + '</b></span>';
    });
    body += '</div>';

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
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-stops] .stratbtn'), b => {
      b.onclick = () => {
        const wrap = b.parentElement;
        Array.prototype.forEach.call(wrap.children, c => c.classList.remove('on'));
        b.classList.add('on');
        pendingStrategy['stops_' + wrap.dataset.stops] = b.dataset.v;
      };
    });
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-tbias] .stratbtn'), b => {
      b.onclick = () => {
        const wrap = b.parentElement;
        Array.prototype.forEach.call(wrap.children, c => c.classList.remove('on'));
        b.classList.add('on');
        pendingStrategy['tbias_' + wrap.dataset.tbias] = b.dataset.v;
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

  /* =======================================================
     デブリーフィング
     「なぜその順位だったのか」を、シミュレーションと同じ式で分解する。
     ラップタイム差 = 基準タイム × 0.00092 × 性能差、
     性能 = （マシン × 0.6 ＋ ドライバー × 0.4）× 週の調子。
     この式をそのまま逆に辿るので、出る数字は実際の中身と一致する。
     ======================================================= */
  const PERF_TO_SEC = 0.00092;

  function raceDebrief(res) {
    const me = res.classified.filter(e => e.isPlayer).sort((a, b) => a.pos - b.pos)[0];
    if (!me || !me.lapTimes || !me.lapTimes.length) return '';
    const fin = res.classified.filter(e => !e.dnf).sort((a, b) => a.pos - b.pos);
    // 比べる相手は優勝者。自分が勝っていれば2位
    const rival = (fin[0] && fin[0].id === me.id) ? fin[1] : fin[0];
    if (!rival || !rival.lapTimes || !rival.lapTimes.length) return '';

    const base = res.track.base;
    const drive = e => {
      const laps = e.lapTimes.filter(v => v != null);
      const pit = (e.pitTime || []).reduce((a, v) => a + (v || 0), 0);
      return { avg: (laps.reduce((a, v) => a + v, 0) - pit) / laps.length, pit: pit, laps: laps.length };
    };
    const A = drive(me), B = drive(rival);
    const gap = A.avg - B.avg;                       // 1周あたり、自分が遅れている秒数
    const carSec = base * PERF_TO_SEC * 0.60 *
      (rival.carScore * rival.formMul - me.carScore * me.formMul);
    const drvSec = base * PERF_TO_SEC * 0.40 *
      (rival.drvScore * rival.formMul - me.drvScore * me.formMul);
    const restSec = gap - carSec - drvSec;           // タイヤ・戦略・ERS・ミス

    // この週、全チームの中で自分のマシンと腕が何番目だったか
    const teams = {};
    res.entries.forEach(e => {
      const k = e.team.name;
      if (!teams[k] || e.drvScore > teams[k].drv) teams[k] = { car: e.carScore, drv: e.drvScore, mine: e.isPlayer };
    });
    const list = Object.keys(teams).map(k => teams[k]);
    const rankOf = key => {
      const mineV = (list.find(x => x.mine) || {})[key];
      if (mineV == null) return null;
      return list.filter(x => x[key] > mineV).length + 1;
    };
    const carRank = rankOf('car'), drvRank = rankOf('drv'), n = list.length;

    // いちばん効いたものを名指しする
    const items = [
      { key: 'car', label: 'マシンの速さ', sec: carSec, rank: carRank,
        advice: 'パーツの改良と車体の熟成に、もっとコマンドを割きましょう。' },
      { key: 'drv', label: 'ドライバーの腕', sec: drvSec, rank: drvRank,
        advice: '練習で鍛えるか、市場でより速いドライバーを獲りましょう。' },
      { key: 'etc', label: 'タイヤ・戦略・電気の使い方', sec: restSec, rank: null,
        advice: 'ピット回数やタイヤの狙い、ストラテジストの補強を見直しましょう。' }
    ];
    const worst = items.slice().sort((a, b) => b.sec - a.sec)[0];

    const sign = v => (v >= 0 ? '+' : '') + v.toFixed(2);
    const bar = v => {
      const w = Math.min(100, Math.abs(v) / Math.max(0.15, Math.abs(gap)) * 100);
      return '<i class="' + (v >= 0 ? 'lose' : 'win') + '" style="width:' + w + '%"></i>';
    };
    let h = '<div class="sub">🔍 デブリーフィング</div>' +
      '<p class="desc">' + esc(rival.team.name) + '（' + (rival.pos) + '位）と比べて、' +
      '1周あたり <b class="' + (gap >= 0 ? 'bad' : 'good') + '">' + sign(gap) + '秒</b>' +
      (gap >= 0 ? ' 遅れていました。その内訳です。' : ' 速く走れていました。その内訳です。') + '</p>';
    h += '<div class="dbr">';
    items.forEach(it => {
      h += '<div class="dbr-row' + (it === worst && it.sec > 0.02 ? ' worst' : '') + '">' +
        '<span class="dbr-nm">' + it.label +
        (it.rank ? '<em>全' + n + 'チーム中 ' + it.rank + '番目</em>' : '') + '</span>' +
        '<span class="dbr-bar">' + bar(it.sec) + '</span>' +
        '<b class="' + (it.sec >= 0 ? 'bad' : 'good') + '">' + sign(it.sec) + '秒</b></div>';
    });
    h += '</div>';

    // 走りそのもの以外で失ったもの
    const extra = [];
    const pd = A.pit - B.pit;
    if (Math.abs(pd) > 1.2) {
      extra.push('ピット作業では ' + (pd > 0 ? '相手より ' + pd.toFixed(1) + '秒 多く失いました'
                                             : '相手より ' + (-pd).toFixed(1) + '秒 得をしました') +
                 '（' + me.pits.length + '回ストップ・相手は' + rival.pits.length + '回）');
    }
    const moved = me.grid - me.pos;
    if (!me.dnf && moved !== 0) {
      extra.push('スタート ' + me.grid + '番手から ' + (moved > 0 ? moved + 'つ順位を上げました' : (-moved) + 'つ落としました'));
    }
    if (me.passes) extra.push('コース上で ' + me.passes + '回、前の車を抜きました');
    if (me.penalty) {
      extra.push('⚖️ 審査で合計 ' + me.penalty + '秒 加算されました（' +
        (me.penalties || []).map(x => x.lap + '周目 ' + x.name).join('、') + '）');
    }
    if (me.dnf) extra.push('リタイア（' + me.dnfReason + '）。信頼性は ' + Math.round(S.reliability(g)) + '% です');
    if (extra.length) h += '<p class="desc">' + extra.map(esc).join('<br>') + '</p>';

    if (worst.sec > 0.02) {
      h += '<p class="note">📌 いちばんの足かせは <b>' + worst.label + '</b>（1周 ' + sign(worst.sec) + '秒）。' +
           worst.advice + '</p>';
    } else {
      h += '<p class="note">📌 弱点らしい弱点はありません。この調子で積み上げましょう。</p>';
    }
    return h;
  }

  /* =======================================================
     選手権の重み
     いまの順位が賞金にしていくらなのか、1つ上げると／落とすといくら動くのか。
     終盤ほど1点の意味が重くなることを、そのまま数字で見せる。
     ======================================================= */
  function stakeBlock(compact) {
    const st = S.championshipStake(g);
    if (!st.of) return '';
    const heat = st.racesLeft <= 3 ? ' hot' : st.racesLeft <= 6 ? ' warm' : '';
    let h = '<div class="stake' + heat + '">' +
      '<div class="stake-head"><b>コンストラクターズ ' + st.rank + '位</b>' +
      '<span>' + st.points + 'pt／残り ' + st.racesLeft + '戦' +
      (st.racesLeft ? '（最大 ' + st.maxGain + 'pt）' : '') + '</span></div>';
    h += '<div class="stake-money">' +
      '<span>いまの順位の賞金 <b>' + money(st.prizeNow) + '万</b></span>' +
      (st.upGain ? '<span class="up">1つ上げると <b>+' + money(st.upGain) + '万</b></span>' : '') +
      (st.downLoss ? '<span class="down">1つ落とすと <b>-' + money(st.downLoss) + '万</b></span>' : '') +
      '</div>';
    const near = [];
    if (st.ahead) near.push('<span class="stake-nb"><i style="background:' + st.ahead.color + '"></i>' +
      esc(st.ahead.name) + ' が <b>' + st.ahead.gap + 'pt</b> 前</span>');
    if (st.behind) near.push('<span class="stake-nb"><i style="background:' + st.behind.color + '"></i>' +
      esc(st.behind.name) + ' が <b>' + st.behind.gap + 'pt</b> 後ろ</span>');
    if (near.length) h += '<div class="stake-near">' + near.join('') + '</div>';
    if (!compact) {
      if (st.rank === 1 && st.racesLeft === 0) h += '<p class="stake-msg win">🏆 タイトル獲得！</p>';
      else if (st.titleAlive && st.titleGap > 0 && st.racesLeft <= 6) {
        h += '<p class="stake-msg">🔥 まだタイトルの可能性がある。首位と <b>' + st.titleGap +
             'pt</b>、残り <b>' + st.racesLeft + '戦</b>で最大 <b>' + st.maxGain + 'pt</b>。</p>';
      } else if (!st.titleAlive && st.racesLeft > 0 && st.titleGap > 0) {
        h += '<p class="stake-msg">今季のタイトルは届かない。1つでも上の順位で終えることが、来季の資金になる。</p>';
      }
    }
    return h + '</div>';
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
      // このレースを荒らしたできごと
      const topics = [];
      if (res.safetyCar) topics.push('🚨 セーフティカー（' + res.safetyCar.from + '周目から' + res.safetyCar.laps + '周）');
      if (res.weatherChange) topics.push(res.weatherChange.icon + ' ' + res.weatherChange.at + '周目に'
        + res.weatherChange.from + '→' + res.weatherChange.to);
      // 「絶好調」は、実際に前に出てきたときだけ書く。毎回出すと意味がなくなる
      const hotCar = res.classified.filter(e => e.hot && !e.dnf).sort((a, b) => a.pos - b.pos)[0];
      if (res.hotTeam && hotCar &&
          (hotCar.pos <= 3 || (hotCar.pos <= 6 && hotCar.grid - hotCar.pos >= 3))) {
        topics.push('🔥 ' + esc(res.hotTeam) + ' が週末を通して絶好調（' +
          hotCar.grid + '番手→' + hotCar.pos + '位）');
      }
      if (topics.length) body += '<div class="racetopics">' + topics.join('<span>／</span>') + '</div>';
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
        '<div>📣 スポンサー <b>+' + money(reward.sponsorIncome) + '万</b><small>' +
        (reward.sponsorRp ? '研究P +' + reward.sponsorRp + '／' : '') + '注目度 ×' + S.hypeBonus(g).toFixed(2) + '</small></div>' +
        '<div>👥 ファン <b class="' + (reward.fanDelta >= 0 ? 'good' : 'bad') + '">' + (reward.fanDelta >= 0 ? '+' : '') + money(reward.fanDelta) + '</b></div>' +
        '<div>' + ht.icon + ' 注目度 <b class="' + (hd >= 0 ? 'good' : 'bad') + '">' + (hd >= 0 ? '+' : '') + hd.toFixed(1) + '</b><small>' + ht.name + '</small></div>' +
        '</div>';
      // いまの順位に、どれだけの重みがあるのか
      if (!res.special) body += stakeBlock(false);
      // なぜその順位だったのかを分解して見せる
      body += raceDebrief(res);
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
    // ---- 負けたレースからは学ぶ ----
    // 前を走るマシンを見ていれば、こちらのほうが遅いぶんだけ持ち帰るものがある。
    // 勝っているうちは学ぶものが少ない。下位のときほど効く救済。
    if (currentRes) {
      const track = D.TRACKS[Math.min(raceCtx.trackIndex, D.TRACKS.length - 1)];
      const mine = S.carScoreOf(S.carStats(g), track);
      let learn = 0;
      currentRes.entries.filter(e => e.isPlayer).forEach(e => {
        // 自分より前でゴールしたマシンのうち、こちらより速いもの
        const ahead = currentRes.entries.filter(o => !o.isPlayer && !o.dnf && o.pos < e.pos);
        ahead.forEach(o => {
          const theirs = S.carScoreOf(o.stats, track);
          if (theirs > mine) learn += Math.min(3.2, (theirs - mine) * 0.06);
        });
      });
      if (learn > 0) {
        const eye = S.osk(g, 'eye');
        const gain = Math.max(1, Math.round(learn * (1 + eye * 0.25)));
        g.rp += gain;
        U.log(g, '🔬 前を走るマシンから学んだ。研究P +' + gain);
        U.pop('🔬+' + gain, 'good');
      }
    }

    // 名声：上位でゴールするほどオーナーの名が売れる
    if (currentRes) {
      let f = 0;
      currentRes.entries.filter(e => e.isPlayer && !e.dnf).forEach(e => {
        f += Math.max(0, 22 - e.pos) * 1.6;          // 順位ぶん
        if (e.pos === 1) f += 40;
        else if (e.pos <= 3) f += 18;
      });
      if (f > 0) grantFame(Math.round(f), 'レースの結果');
    }
    if (!raceCtx.special) g.nextRace++;
    g.special = null;
    g.drivers.forEach(d => levelCheck(d));
    // レースを1戦こなすと、現場にいた全員が経験を積む
    staffExpAll(7);
    staffExp('strategist', 14);
    staffExp('mechanic', 8);
    // よそのチームが、うちの誰かに声をかけてくることがある
    const raid = S.poachAttempt(g);
    if (raid) { askPoach(raid); return; }
    endWeek();
  }

  /* ---- 引き抜きの申し出。引き止めるか、送り出すか ---- */
  function askPoach(raid) {
    const t = D.STAFF_TYPES.find(x => x.key === raid.type) || {};
    const canPay = g.funds >= raid.keep;
    const body = '<p class="lead">' + esc(raid.from) + ' が <b>' + esc(raid.name) + '</b>' +
      '（' + t.icon + t.name + '／技能 ' + raid.skill + '）に声をかけています。</p>' +
      '<p class="desc">引き止めるには支度金が要り、そのあとの給料も上がります。' +
      '送り出せば、その腕はライバルのものになります。</p>' +
      '<div class="poachbox"><span>💰 引き止めの支度金</span><b>' + money(raid.keep) + '万</b></div>' +
      '<div class="poachbox"><span>📈 これからの給料</span><b>+' +
        Math.round((raid.raise - 1) * 100) + '%</b></div>' +
      (canPay ? '' : '<p class="note">いまの資金では引き止められません。</p>');
    let settled = false, prevClose = null;
    const finish = fn => {
      if (settled) return;
      settled = true;
      if (prevClose !== null) $('modalClose').onclick = prevClose;   // ✕を元に戻す
      fn(); U.closeModal(); endWeek();
    };
    U.modal('🕵️ 引き抜きの申し出', body, [
      { label: '引き止める', cls: 'primary', disabled: !canPay, fn: () => finish(() => {
          g.funds -= raid.keep;
          S.keepStaff(g, raid.id, raid.raise);
          GP.sound.play('confirm');
          U.log(g, '🤝 ' + raid.name + ' を引き止めた（支度金 ' + money(raid.keep) + '万）。', 'good');
          U.toast('🤝 ' + raid.name + ' は残ってくれた', 'good');
        }) },
      { label: '送り出す', fn: () => finish(() => {
          S.loseStaff(g, raid.id);
          GP.sound.play('dnf');
          U.log(g, '👋 ' + raid.name + ' が ' + raid.from + ' へ移籍した…', 'bad');
          U.toast('👋 ' + raid.name + ' が去った', 'bad');
        }) }
    ]);
    // ✕で閉じたときも「送り出す」と同じ扱いにする（週が飛ばないように）
    prevClose = $('modalClose').onclick;
    $('modalClose').onclick = () => finish(() => {
      S.loseStaff(g, raid.id);
      U.log(g, '👋 ' + raid.name + ' が ' + raid.from + ' へ移籍した…', 'bad');
    });
  }

  /* =======================================================
     ライバルの動向
     どのチームがどれだけ伸びたか、どの方向に開発しているかを見る。
     ライバルが毎週マシンを煮詰めているのを、見えるようにする。
     ======================================================= */
  function rivalTrends() {
    const track = D.TRACKS[Math.min(g.nextRace, D.TRACKS.length - 1)];
    const table = S.constructorTable(g);
    const rows = [];
    const mineStats = S.carStats(g);
    rows.push({ name: g.team, color: g.color, mine: true,
                stats: mineStats, base0: null,
                car: S.carScoreOf(mineStats, track),
                style: null,
                pts: g.points });
    (g.rivals || []).forEach(r => {
      rows.push({ name: r.name, color: r.color, mine: false,
                  stats: r.stats, base0: r.base0 || null,
                  car: S.carScoreOf(r.stats, track),
                  style: r.style, pts: r.points });
    });
    rows.sort((a, b) => b.car - a.car);
    const top = rows[0].car || 1;

    let h = '<p class="desc">' + esc(track.name) + ' でのマシン評価と、' +
      'シーズン開始からの伸びです。開発の方向は、3性能のうちどこを厚くしているかを表します。</p>' +
      '<div class="trends">';
    rows.forEach((r, i) => {
      const tot = Math.max(1, r.stats.speed + r.stats.corner + r.stats.accel);
      const sh = k => Math.round(r.stats[k] / tot * 100);
      // シーズン開始からの伸び
      let grew = null;
      if (r.base0) {
        const b = r.base0.speed + r.base0.corner + r.base0.accel;
        grew = Math.round((tot / Math.max(1, b) - 1) * 100);
      }
      const st = r.style ? D.STRAT_STYLES[r.style] : null;
      h += '<div class="trow' + (r.mine ? ' me' : '') + '">' +
        '<span class="t-pos">' + (i + 1) + '</span>' +
        '<span class="rk-chip" style="background:' + r.color + '"></span>' +
        '<span class="t-nm">' + esc(r.name) + (st ? ' <em>' + st.icon + st.name + '</em>' : '') + '</span>' +
        '<span class="t-bar"><i style="width:' + Math.round(r.car / top * 100) + '%"></i>' +
          '<b>' + Math.round(r.car) + '</b></span>' +
        '<span class="t-mix" title="最高速／コーナー／加速">' +
          '<u class="sp" style="width:' + sh('speed') + '%"></u>' +
          '<u class="co" style="width:' + sh('corner') + '%"></u>' +
          '<u class="ac" style="width:' + sh('accel') + '%"></u></span>' +
        '<span class="t-grew' + (grew > 0 ? ' up' : '') + '">' +
          (grew == null ? '—' : (grew >= 0 ? '+' : '') + grew + '%') + '</span>' +
        '</div>';
    });
    h += '</div>' +
      '<div class="seclegend"><span><i style="background:#e04a3f"></i>最高速</span>' +
      '<span><i style="background:#3a7ad9"></i>コーナー</span>' +
      '<span><i style="background:#4ea63f"></i>加速</span>' +
      '<em>右端はシーズン開始からの伸び</em></div>';
    return h;
  }

  /* =======================================================
     オーナー画面
     ランクと名声、スキルの振り分け。
     ======================================================= */
  function cmdOwner() {
    if (!g.owner) g.owner = S.makeOwner();
    const o = g.owner;
    const pr = S.ownerProgress(g);
    const past = D.OWNER_PASTS.find(p2 => p2.key === o.past) || D.OWNER_PASTS[1];

    let body =
      '<div class="ownerhead">' +
        '<span class="orank">' + pr.cur.icon + '</span>' +
        '<span class="oinfo"><b>' + esc(o.name) + '</b>' +
          '<small>' + pr.cur.name + ' ／ ' + past.icon + past.name + '（元ドライバー）</small></span>' +
        '<span class="osp">スキルP<b>' + o.sp + '</b></span>' +
      '</div>' +
      '<div class="reqrow"><span>名声</span><i><b style="width:' + pr.pct + '%"></b></i>' +
        '<em>' + money(o.fame) + '</em></div>' +
      '<p class="desc">' +
        (pr.next ? '次のランク「' + pr.next.icon + pr.next.name + '」まで あと ' +
                   money(pr.need) + '。上がるごとにスキルポイントが2つ手に入ります。'
                 : '最高ランクに到達しています。') +
      '</p>' +
      '<p class="desc">名声は、レースで上位に入るほど、そしてシーズンの結果で貯まります。</p>' +
      '<div class="sub">スキル</div>' +
      '<p class="desc">段位は現在のランク＋1まで伸ばせます（いまは最大 ' +
        Math.min(D.OWNER_SKILL_MAX, pr.i + 1) + ' 段）。</p>' +
      '<div class="oskills">';

    D.OWNER_SKILLS.forEach(sk => {
      const lv = o.skills[sk.key] || 0;
      const capped = lv >= D.OWNER_SKILL_MAX;
      const locked = lv + 1 > pr.i + 1;
      const can = o.sp > 0 && !capped && !locked;
      body += '<div class="oskill">' +
        '<div class="osk-h"><span class="osk-ic" style="background:' + sk.color + '">' + sk.icon + '</span>' +
          '<b>' + sk.name + '</b>' +
          '<i class="osk-lv">' + '●'.repeat(lv) + '○'.repeat(D.OWNER_SKILL_MAX - lv) + '</i>' +
          '<button class="mini' + (can ? ' primary' : '') + '" data-osk="' + sk.key + '"' +
            (can ? '' : ' disabled') + '>' +
            (capped ? 'MAX' : locked ? 'ランク不足' : '+1') + '</button></div>' +
        '<small>' + esc(sk.desc) + '</small>' +
        '<div class="osk-eff">' + sk.eff.map(e => '<span>' + esc(e) + '</span>').join('') + '</div>' +
        '</div>';
    });
    body += '</div>';

    U.modal('🎩 オーナー', body, [{ label: '閉じる', fn: U.closeModal }], { wide: true });
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-osk]'), b => {
      b.onclick = () => {
        if (S.learnOwnerSkill(g, b.dataset.osk)) {
          GP.sound.play('good');
          S.save(g);
          cmdOwner();            // 画面を作り直して段位を反映
          U.renderTop(g);
        }
      };
    });
  }

  /* 名声を足し、ランクが上がったら知らせる */
  function grantFame(n, why) {
    if (!n) return;
    const up = S.addFame(g, n);
    if (up > 0) {
      const pr = S.ownerProgress(g);
      U.toast(pr.cur.icon + ' ' + pr.cur.name + ' に昇格！ スキルP +' + (up * 2), 'good');
      U.log(g, pr.cur.icon + ' オーナーランクが上がった：' + pr.cur.name +
               '（スキルポイント +' + (up * 2) + '）', 'good');
      GP.sound.play('win');
    } else if (why) {
      U.log(g, '⭐ 名声 +' + n + '（' + why + '）');
    }
  }

  /* =======================================================
     シーズン終了
     ======================================================= */
  function seasonEnd() {
    const table = S.constructorTable(g);
    const rank = table.findIndex(r => r.isPlayer) + 1;
    const prize = Math.round(D.PRIZE[Math.min(D.PRIZE.length - 1, rank - 1)]
                             * (1 + S.osk(g, 'money') * 0.05));   // 商才
    const dTable = S.driverTable(g);
    const champ = dTable[0];
    const myChamp = g.drivers.find(d => d.name === champ.name);
    const myChampPre = !!myChamp;

    g.funds += prize;
    // シーズンの結果は大きな名声になる
    grantFame(Math.round(Math.max(0, 12 - rank) * 26 + (rank === 1 ? 400 : 0)), 'シーズンの結果');
    if (myChampPre) grantFame(300, 'ドライバーズタイトル');
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

    // 来季の風洞・CFD使用時間は、この順位で決まる
    g.lastRank = rank;
    const at = S.atrLabel(g);
    body += '<div class="atrbox" style="--ac:' + at.color + '">' +
      '<b>' + at.icon + ' 来季の風洞・CFD使用時間：' + at.name +
      '（開発の伸び ×' + S.atrOf(g).toFixed(2) + '）</b>' +
      '<small>上位で終えたチームほど、翌年に使える開発時間が減ります。' +
      '勝てば勝つほど次は苦しく、負ければ作り直す時間がもらえる、という制度です。</small></div>';
    U.modal('🎊 シーズン終了', body,
      [{ label: '🌱 オフへ →', cls: 'primary', fn: enterOffseason }], { wide: true });
    U.log(g, '🎊 シーズン' + g.season + ' 終了。コンストラクターズ ' + rank + '位。賞金 +' + money(prize) + '万', 'good');
  }

  function nextSeason() {
    U.closeModal();
    g.offseason = false;
    g.offTalked = [];
    GP.base.invalidate();
    g.history.push({ season: g.season, points: g.points, rank: S.constructorTable(g).findIndex(r => r.isPlayer) + 1 });
    g.season++;
    g.week = 1;
    S.restCrew(g, 100);          // オフを挟んでクルーの疲れは抜ける
    S.puReset(g);                // パワーユニットの使用基数も新品から数え直す
    const capRes = S.settleCap(g);   // 予算の精算
    capWarned = false;
    if (capRes) {
      U.log(g, '🧾 予算超過 ' + money(capRes.over) + '万。罰金 -' + money(capRes.fine) +
               '万、来季の風洞時間も削られる。', 'bad');
      U.toast('🧾 予算超過の罰金 -' + money(capRes.fine) + '万', 'bad');
    }
    const goneTitle = S.tickTitle(g);
    if (goneTitle) {
      U.log(g, '👑 ' + goneTitle.name + ' とのタイトルスポンサー契約が満了した。', 'warn');
      U.toast('👑 冠スポンサーの契約が満了', 'warn');
    }
    g.nextRace = 0;
    // 4シーズンに一度、マシンの規則が変わる
    const regChange = S.regulationDue(g);
    if (regChange) S.applyRegulation(g);
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
    // スポンサーの達成ボーナス回数をリセット
    g.sponsors.forEach(sp2 => { sp2.hits = 0; });
    // 来季ぶんの仕込みは持ち越すが、使わないまま年を跨ぐと少し目減りする
    if (g.nextCar > 0) {
      g.nextCar = Math.round(g.nextCar * 0.8 * 10) / 10;
      U.log(g, '🌱 来季マシンの仕込みを持ち越した（' + Math.round(S.nextCarProgress(g) * 100) + '%）。', 'good');
    }
    // リザーブも1年ぶん歳を取り、負傷は明ける
    if (g.reserve) { g.reserve.age++; g.reserve.outFor = 0; g.reserve.seasonPoints = 0; }
    g.drivers.forEach(d => { d.outFor = 0; d.hurt = false; });
    // 若手の加齢と、育ちきった選手のお知らせ
    (g.youth || []).forEach(d => {
      d.age++;
      if (d.age >= 24) U.log(g, '🎓 ' + d.name + ' は育成年齢の上限が近い。昇格させるか決断のとき。', 'warn');
    });
    // 契約更改：活躍した人ほど報酬が上がる
    const rankNow = S.constructorTable(g).findIndex(r => r.isPlayer) + 1;
    const raises = S.renegotiate(g, rankNow);
    if (raises.length) {
      U.log(g, '📝 契約更改：' + raises.join('、') + '（チーム全体の人件費も上がった）', 'warn');
    }
    // スタッフの成長と、歳を重ねた人の引退
    const grown = S.growStaff(g);
    if (grown.length) U.log(g, '📈 スタッフが成長した：' + grown.join('、'), 'good');
    const left = S.retireStaff(g);
    left.forEach(st => {
      const t = D.STAFF_TYPES.find(x => x.key === st.type) || {};
      U.log(g, '🎩 ' + st.name + '（' + t.name + '／' + st.age + '歳）が現場を去った。長いあいだお疲れさま。', 'warn');
    });
    if (left.length) U.toast('🎩 ' + left.map(x => x.name).join('、') + ' が引退', 'warn');
    // ライバル強化
    g.rivals = S.makeRivals(g.season, g.drivers.map(d => d.name), S.diffOf(g), g.carGen);
    refreshMarkets(true);
    U.log(g, '🚩 シーズン' + g.season + ' 開幕！', 'good');
    GP.sound.play('confirm');
    U.toast('🚩 シーズン' + g.season + ' 開幕！', 'good');
    S.save(g); render();
    if (regChange) {
      U.modal('📜 レギュレーション変更',
        '<p class="lead">新しい規則のもとで、マシンは一から作り直しになりました。</p>' +
        '<div class="rewardbox">' +
        '<div>パーツ・車体 <b>白紙から</b><small>積んだ知見のぶんだけ、ゼロよりは良い所から。レアリティ（到達できる上限）は引き継ぎます</small></div>' +
        '<div>保管パーツ・PU供給 <b>使えない</b><small>旧規則のものは保管庫ごと失われます</small></div>' +
        '<div>施設・スタッフ・ドライバー・ファン・資金・オーナー <b>そのまま</b><small>積み上げたチーム力は失われません</small></div>' +
        '</div>' +
        '<p class="desc">ライバルも同じだけ戻ります。上位と下位の差が一度リセットされ、' +
        'ここからまた作り直しの勝負です。次の変更は ' + S.REG_EVERY + ' シーズン後。</p>',
        [{ label: 'やってやる', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
      U.log(g, '📜 レギュレーションが変わった。マシンは白紙から作り直し。', 'warn');
      GP.sound.play('light');
    }
    if (retired.length) U.toast('引退したドライバーがいます。「人事」で補充しましょう。', 'warn');
  }

  /* マシンが次の世代に上がったことを知らせる */
  function announceGen(up) {
    GP.sound.play('crit');
    U.log(g, '🎊 パーツが出そろい、マシンが「' + up.to + '」に更新された！ ' +
             'パーツ上限 ' + up.cap + '／車体上限 ' + up.bodyCap, 'good');
    U.toast('🎊 マシンが「' + up.to + '」に更新！', 'good');
    U.pop('🏎️ ' + up.to, 'crit');
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

  /* =======================================================
     本拠地ハブ
     建物がそのまま入口になる。押すと、その設備の画面が開く。
     「休養」だけは押した瞬間に1週進むので、建物には割り当てない。
     ======================================================= */
  /* 施設の内装。コマンド画面の先頭に、その施設の部屋を出す。
     レベルが上がるほど機材と人が増え、部屋が広くなる。            */
  function interiorHTML(key) {
    return '<div class="intwrap"><canvas id="intCv" width="' + GP.interior.W +
           '" height="' + GP.interior.H + '" data-fac="' + key + '"></canvas></div>';
  }
  function paintInterior() {
    const cv = $('intCv');
    if (cv) GP.interior.render(cv, g, cv.dataset.fac);
  }

  /* パドックで立ち寄れる場所。レースウィークだけこちらを使う */
  const PADDOCK_DOORS = {
    garage:  { icon: '🏎️', label: '自チームのガレージ', to: 'マシン', fn: () => cmdGarage() },
    drivers: { icon: '🧑‍✈️', label: 'ドライバーの控え', to: 'ドライバー',
               fn: () => { hrTab = 'drivers'; cmdStaff(); } },
    timing:  { icon: '📊', label: 'タイミングブース', to: '情報',   fn: () => cmdInfo() },
    gate:    { icon: '🏁', label: 'コースへの出口',   to: 'レース', fn: () => cmdRace() }
  };

  /* =======================================================
     オフ期間
     建物は閉まり、みんなが敷地に出ている。歩いて挨拶して回ると、
     来季に向けて少しずつ整う。話しかけられるのは一人一度きり。
     ======================================================= */
  const OFF_DOORS = {
    'off:drv0':  { icon: '🧑‍✈️', label: '', to: '話す', fn: () => doOffDriver(0) },
    'off:drv1':  { icon: '🧑‍✈️', label: '', to: '話す', fn: () => doOffDriver(1) },
    'off:staff': { icon: '👥', label: 'スタッフのみんな', to: '労う', fn: doOffStaff },
    'off:youth': { icon: '🎓', label: '下部組織の若手', to: '激励', fn: doOffYouth },
    'off:mgr':   { icon: '👔', label: '首脳陣', to: '来季の話', fn: doOffMgr },
    'off:test':    { icon: '🏁', label: '合同テスト',     to: '走る',   fn: doOffTest },
    'off:plan':    { icon: '📋', label: '来季のマシン方針', to: '決める', fn: doOffPlan },
    'off:sponsor': { icon: '🤝', label: 'スポンサー交渉',  to: '交渉',   fn: doOffSponsor },
    'off:scout':   { icon: '🔍', label: '若手のスカウト',  to: '探す',   fn: doOffScout },
    'off:next':    { icon: '🌱', label: '来季へ', to: '出発', fn: doOffNext }
  };

  /* ---- 合同テスト ----
     オフにしかできない走り込み。ドライバーが仕上がり、
     マシンのデータも取れる。走るほど良いが、費用がかかる。        */
  function doOffTest() {
    if (offDone('test')) {
      return U.modal('🏁 合同テスト',
        '<p class="lead">今オフのテストは終えた。</p>', [{ label: '戻る', fn: U.closeModal }]);
    }
    const plans = [
      { d: 1, name: '1日', cost: 900,  form: [4, 8],   rp: [4, 8],   sk: 0.15 },
      { d: 3, name: '3日', cost: 2400, form: [9, 16],  rp: [10, 18], sk: 0.35 },
      { d: 5, name: '5日', cost: 4200, form: [15, 24], rp: [18, 30], sk: 0.60 }
    ];
    let body = '<p class="lead">オフのサーキットを借りて走り込みます。' +
      'ドライバーが仕上がり、マシンのデータも取れます。</p>' +
      '<p class="desc">長く走るほど得るものは大きいですが、そのぶん費用がかかります。' +
      'いまの資金は ' + money(g.funds) + '万。</p><div class="pick">';
    plans.forEach(pl => {
      body += '<button class="pickbtn" data-k="test:' + pl.d + '"' +
        (g.funds >= pl.cost ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#4ea63f">🏁</span>' +
        '<span class="pb-body"><b>' + pl.name + 'のテスト</b>' +
        '<small>調子 +' + pl.form[0] + '〜' + pl.form[1] +
        '／研究P +' + pl.rp[0] + '〜' + pl.rp[1] +
        '／スキルが伸びることも</small></span>' +
        '<span class="pb-cost">💰' + money(pl.cost) + '</span></button>';
    });
    body += '</div>';
    U.modal('🏁 合同テスト', body, [{ label: 'やめる', fn: U.closeModal }]);
    bindPick(k => {
      const pl = plans.find(x => 'test:' + x.d === k);
      if (!pl || g.funds < pl.cost) return;
      g.funds -= pl.cost;
      const rp = Math.round(S.rnd(pl.rp[0], pl.rp[1]) * (1 + S.osk(g, 'eye') * 0.25));
      g.rp += rp;
      const notes = [];
      g.drivers.forEach(d => {
        const up = Math.round(S.rnd(pl.form[0], pl.form[1]) * S.persOf(d).rest);
        d.form = S.clamp(d.form + up, 62, 122);
        notes.push(esc(d.name) + ' 調子 +' + up);
        // 走り込みで技術が伸びることがある
        if (Math.random() < pl.sk) {
          const k2 = S.pick(['speed', 'technique', 'stamina', 'mental']);
          const g2 = Math.round(S.rnd(1, 3));
          d[k2] = S.clamp(d[k2] + g2, 1, 199);
          notes.push(esc(d.name) + ' ' + ({speed:'速さ',technique:'技術',stamina:'体力',mental:'精神'}[k2]) + ' +' + g2);
        }
      });
      offMark('test');
      S.save(g); U.renderTop(g);
      U.modal('🏁 合同テスト',
        '<p class="lead">' + pl.name + '走り込んだ。</p>' +
        '<div class="rewardbox"><div>研究ポイント <b>+' + rp + '</b></div></div>' +
        '<p class="desc">' + notes.join('／') + '</p>',
        [{ label: '手応えあり', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
      GP.sound.play('good');
    });
  }

  /* ---- 来季のマシン方針 ----
     どの性能を軸に作るかを決める。決めた方向は来季の開発で伸びやすくなる。 */
  function doOffPlan() {
    const DIRS = [
      { k: 'speed',  name: '最高速に振る', icon: '🚀', color: '#e04a3f',
        desc: 'ストレートの長いコースで戦える。抜きやすくもなる' },
      { k: 'corner', name: 'コーナーに振る', icon: '🌀', color: '#3a7ad9',
        desc: '低速コーナーの多いコースで効く。市街地に強い' },
      { k: 'accel',  name: '加速に振る',   icon: '⚡', color: '#4ea63f',
        desc: 'ストップ＆ゴーのコースと、スタートで効く' },
      { k: 'balance', name: 'バランス',    icon: '⚖️', color: '#8a8578',
        desc: 'どこでも戦えるが、飛び抜けはしない' }
    ];
    const cur = g.plan || null;
    let body = '<p class="lead">来季のマシンをどの方向で作るか決めます。</p>' +
      '<p class="desc">決めた方向の開発は来季ずっと <b>+22%</b> 伸びやすくなり、' +
      '他の方向は少しだけ伸びが鈍ります。オフのうちにしか決められません。</p>' +
      '<div class="pick">';
    DIRS.forEach(d => {
      body += '<button class="pickbtn' + (cur === d.k ? ' on' : '') + '" data-k="plan:' + d.k + '">' +
        '<span class="pb-ic" style="background:' + d.color + '">' + d.icon + '</span>' +
        '<span class="pb-body"><b>' + d.name + '</b><small>' + d.desc + '</small></span>' +
        (cur === d.k ? '<span class="pb-cost">選択中</span>' : '') + '</button>';
    });
    body += '</div>';
    U.modal('📋 来季のマシン方針', body, [{ label: '閉じる', fn: U.closeModal }]);
    bindPick(k => {
      if (k.indexOf('plan:') !== 0) return;
      g.plan = k.slice(5);
      offMark('plan');
      S.save(g);
      const d = DIRS.find(x => x.k === g.plan);
      U.closeModal();
      U.toast(d.icon + ' 来季は「' + d.name + '」', 'good');
      U.log(g, '📋 来季のマシン方針を「' + d.name + '」に決めた。');
      GP.sound.play('good');
      render();
    });
  }

  /* ---- オフのスポンサー交渉 ----
     シーズン中より良い条件で結べる。枠が空いていれば増やせる。   */
  function doOffSponsor() {
    if (offDone('sponsor')) {
      return U.modal('🤝 スポンサー交渉',
        '<p class="lead">今オフの交渉は済ませた。</p>', [{ label: '戻る', fn: U.closeModal }]);
    }
    const slots = 2 + g.facilities.market;
    const have = g.sponsors.map(sp => sp.name);
    const avail = D.SPONSORS.filter(sp => S.sponsorOpen(g, sp) && have.indexOf(sp.name) < 0);
    const boost = 1.18 + S.osk(g, 'nego') * 0.04;      // オフは条件が良い
    let body = '<p class="lead">オフはじっくり話ができるぶん、条件が良くなります。</p>' +
      '<p class="desc">枠 ' + g.sponsors.length + ' / ' + slots +
      '　オフの上乗せ <b>×' + boost.toFixed(2) + '</b>（交渉術で伸びます）</p>';
    if (g.sponsors.length >= slots) {
      body += '<p class="note">枠が埋まっています。マーケティング室を広げると増えます。</p>';
    } else if (!avail.length) {
      body += '<p class="note">いまの規模で新たに組める相手がいません。</p>';
    } else {
      body += '<div class="pick">';
      avail.slice(0, 4).forEach(sp => {
        const per = Math.round((sp.per || 0) * boost);
        const rp = Math.round((sp.rp || 0) * boost);
        body += '<button class="pickbtn" data-k="osp:' + esc(sp.name) + '">' +
          '<span class="pb-ic" style="background:' + (D.SPONSOR_KINDS[sp.kind] || {}).color + '">' +
            ((D.SPONSOR_KINDS[sp.kind] || {}).icon || '📣') + '</span>' +
          '<span class="pb-body"><b>' + esc(sp.name) + '</b>' +
          '<small>毎戦 💰' + money(per) + (rp ? '＋🔬' + rp : '') + '</small></span>' +
          '</button>';
      });
      body += '</div>';
    }
    U.modal('🤝 スポンサー交渉', body, [{ label: '閉じる', fn: U.closeModal }]);
    bindPick(k => {
      if (k.indexOf('osp:') !== 0) return;
      const sp = avail.find(x => x.name === k.slice(4));
      if (!sp || g.sponsors.length >= slots) return;
      const signed = JSON.parse(JSON.stringify(sp));
      signed.per = Math.round((sp.per || 0) * boost);
      signed.rp = Math.round((sp.rp || 0) * boost);
      signed.hits = 0;
      g.sponsors.push(signed);
      offMark('sponsor');
      S.save(g);
      U.closeModal();
      U.toast('🤝 ' + sp.name + 'と契約', 'good');
      U.log(g, '🤝 オフの交渉で ' + sp.name + ' と好条件で結んだ。', 'good');
      GP.sound.play('good');
      render();
    });
  }

  /* ---- オフの若手スカウト ----
     シーズン中より広く見て回れるので、良い素材に当たりやすい。   */
  function doOffScout() {
    if (offDone('scout')) {
      return U.modal('🔍 若手のスカウト',
        '<p class="lead">今オフはもう見て回った。</p>', [{ label: '戻る', fn: U.closeModal }]);
    }
    const slots = S.youthSlots(g);
    if ((g.youth || []).length >= slots) {
      return U.modal('🔍 若手のスカウト',
        '<p class="lead">下部組織がいっぱいです（' + g.youth.length + ' / ' + slots + '）。</p>' +
        '<p class="desc">ユースアカデミーを広げるか、誰かを昇格させると空きます。</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    // オフは3人まで見られる。才能はシーズン中より良く出る
    const cands = [0, 1, 2].map(() => {
      const y = S.makeYouth(g);
      if (Math.random() < 0.45) y.pot = Math.min(4, (y.pot || 0) + 1);   // オフの上振れ
      return y;
    });
    const cost = Math.round(600 + g.facilities.youth * 120);
    let body = '<p class="lead">オフは各地をゆっくり見て回れます。' +
      '良い素材に当たりやすい。</p>' +
      '<p class="desc">枠 ' + (g.youth || []).length + ' / ' + slots +
      '　契約金 💰' + money(cost) + '万（いまの資金 ' + money(g.funds) + '万）</p><div class="pick">';
    cands.forEach((y, i) => {
      const pot = D.POTENTIAL[Math.min(D.POTENTIAL.length - 1, y.pot || 0)];
      body += '<button class="pickbtn" data-k="oyo:' + i + '"' +
        (g.funds >= cost ? '' : ' disabled') + '>' +
        '<span class="pb-ic face-ic">' + U.face(y, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(y.name) + '</b>' +
        '<small>' + y.age + '歳／総合 ' + Math.round(S.driverRating(y)) +
        '／才能 ' + (pot ? pot.stars : '★') + '</small></span>' +
        '<span class="pb-cost">💰' + money(cost) + '</span></button>';
    });
    body += '</div>';
    U.modal('🔍 若手のスカウト', body, [{ label: 'やめる', fn: U.closeModal }]);
    bindPick(k => {
      if (k.indexOf('oyo:') !== 0) return;
      const y = cands[parseInt(k.slice(4), 10)];
      if (!y || g.funds < cost) return;
      g.funds -= cost;
      g.youth = (g.youth || []).concat([y]);
      offMark('scout');
      S.save(g);
      U.closeModal();
      U.toast('🔍 ' + y.name + ' が加入', 'good');
      U.log(g, '🔍 オフのスカウトで ' + y.name + ' を下部組織に迎えた。', 'good');
      GP.sound.play('good');
      render();
    });
  }

  function offDoors() {
    const m = {};
    Object.keys(OFF_DOORS).forEach(k => { m[k] = OFF_DOORS[k]; });
    (g.drivers || []).slice(0, 2).forEach((d, i) => {
      if (m['off:drv' + i]) m['off:drv' + i] = { icon: '🧑‍✈️', label: d.name, to: '話す',
                                                 fn: () => doOffDriver(i) };
    });
    return m;
  }

  function offDone(key) { return (g.offTalked || []).indexOf(key) >= 0; }
  function offMark(key) { g.offTalked = (g.offTalked || []).concat([key]); }

  function doOffDriver(i) {
    const d = (g.drivers || [])[i];
    if (!d) return;
    const key = 'drv' + i;
    const p = S.persOf(d);
    if (offDone(key)) {
      return U.modal('🧑‍✈️ ' + esc(d.name),
        '<div class="quote">' + U.face(d, 40) + '<span>また来季、よろしく頼む。</span></div>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    // 来季に向けて気持ちを整える。休養と同じで、性格で効きが変わる
    const up = Math.round(S.rnd(8, 16) * p.rest);
    d.form = S.clamp(d.form + up, 62, 122);
    const mup = Math.round(S.rnd(1, 3));
    d.mental = S.clamp(d.mental + mup, 1, 199);
    offMark(key);
    S.save(g); U.renderTop(g);
    U.modal('🧑‍✈️ ' + esc(d.name),
      '<div class="quote">' + U.face(d, 40) + '<span>' +
      esc(d.seasonPoints > 0 ? '今季は悪くなかった。来季はもっと上でやりたい。'
                             : '悔しいシーズンだった。来季は必ず返す。') + '</span></div>' +
      '<div class="rewardbox"><div>調子 <b>+' + up + '</b></div>' +
      '<div>精神 <b>+' + mup + '</b></div></div>',
      [{ label: 'ありがとう', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    GP.sound.play('good');
  }

  function doOffStaff() {
    if (offDone('staff')) {
      return U.modal('👥 スタッフのみんな', '<p class="lead">「来季も頼みます！」</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    // 労うと、シーズンの疲れが抜けて少し伸びる
    let n = 0;
    (g.staff || []).forEach(st => { st.skill = S.clamp(st.skill + S.rnd(1, 3), 1, 99); n++; });
    offMark('staff');
    S.save(g);
    U.modal('👥 スタッフのみんな',
      '<p class="lead">一年の働きを労った。</p>' +
      '<div class="bigbox">' + n + ' 人の技能が <b>少し上がった</b></div>' +
      '<p class="desc">オフのうちに労っておくと、来季の立ち上がりが変わります。</p>',
      [{ label: 'おつかれさま', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    GP.sound.play('good');
  }

  function doOffYouth() {
    if (offDone('youth')) {
      return U.modal('🎓 下部組織の若手', '<p class="lead">「来季こそ乗ります！」</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    let n = 0;
    (g.youth || []).forEach(y => {
      ['speed', 'technique', 'stamina', 'mental'].forEach(k => {
        y[k] = S.clamp(y[k] + S.rnd(1, 4), 1, 199);
      });
      n++;
    });
    offMark('youth');
    S.save(g);
    U.modal('🎓 下部組織の若手',
      n ? '<p class="lead">若手を集めて、来季の話をした。</p>' +
          '<div class="bigbox">' + n + ' 人が <b>少し伸びた</b></div>'
        : '<p class="lead">いまは下部組織に誰もいない。</p>' +
          '<p class="desc">「人事」→「育成」からスカウトできます。</p>',
      [{ label: '戻る', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
  }

  function doOffMgr() {
    if (offDone('mgr')) {
      return U.modal('👔 首脳陣', '<p class="lead">「方針は決まりました。あとはやるだけです」</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    // 来季に向けた仕込み。研究ポイントで返ってくる
    const gain = Math.round(10 + S.staffBonus(g, 'analyst') * 2 + S.mgr(g, 'principal') * 0.6 + S.rnd(0, 6));
    g.rp += gain;
    offMark('mgr');
    S.save(g); U.renderTop(g);
    U.modal('👔 首脳陣',
      '<p class="lead">来季の方針を詰めた。</p>' +
      '<div class="bigbox">研究ポイント <b>+' + gain + '</b></div>' +
      '<p class="desc">首脳陣が揃っているほど、実りのある話になります。</p>',
      [{ label: 'よろしく', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    GP.sound.play('good');
  }

  function doOffNext() {
    const LABEL = { drv0: 'ドライバー', drv1: 'ドライバー', staff: 'スタッフ',
                    youth: '下部組織', mgr: '首脳陣', test: '合同テスト',
                    plan: '来季の方針', sponsor: 'スポンサー交渉', scout: '若手のスカウト' };
    const left = Object.keys(LABEL)
      .filter(k => !offDone(k) && (k.indexOf('drv') !== 0 || g.drivers[parseInt(k.slice(3), 10)]));
    const body = left.length
      ? '<p class="lead">オフのうちにしかできないことが残っています。</p>' +
        '<div class="bigbox">残り <b>' + left.length + '</b> 件' +
        '<small>' + left.map(k => LABEL[k]).join('／') + '</small></div>' +
        '<p class="desc">来季を始めると、これらはもうできません。</p>'
      : '<p class="lead">オフにやるべきことは全部済ませた。来季へ向かおう。</p>';
    U.modal('🌱 来季へ', body, [
      { label: '🌱 来季を始める', cls: 'primary', fn: nextSeason },
      { label: 'もう少し回る', fn: U.closeModal }
    ]);
  }

  function enterOffseason() {
    U.closeModal();
    g.offseason = true;
    g.offTalked = [];
    GP.base.invalidate();
    S.save(g);
    U.toast('🌱 オフ期間。みんなに挨拶して回ろう', 'good');
    U.log(g, '🌱 シーズンオフに入った。');
    render();
  }

  /* いま歩いている場所（本拠地／パドック）と、その入口一覧 */
  function hubMap() { return isRaceWeek() ? GP.paddock : GP.base; }

  /* 同じレースウィークのうちは、一度きりの行動を覚えておく */
  function weekFlags() {
    if (g.wkTag !== g.season + ':' + g.week) {
      g.wkTag = g.season + ':' + g.week;
      g.scouted = [];
      g.talked = [];
    }
    return g;
  }

  /* パドックの入口一覧。ライバルのガレージと人はゲームの状態から作る */
  function hubDoors() {
    if (g.offseason) return offDoors();
    if (!isRaceWeek()) return HUB_DOORS;
    weekFlags();
    const map = {};
    Object.keys(PADDOCK_DOORS).forEach(k => { map[k] = PADDOCK_DOORS[k]; });
    (g.rivals || []).forEach((r, ri) => {
      // ガレージの並びは i=4 が自チーム。ライバルはそこを飛ばして詰める
      const gi = ri < GP.paddock.MINE_AT ? ri : ri + 1;
      const done = (g.scouted || []).indexOf(r.name) >= 0;
      map['scout' + gi] = {
        icon: done ? '✓' : '👀', label: r.name + ' のガレージ',
        to: done ? '確認済み' : '覗く',
        fn: () => doScout(r)
      };
    });
    (g.drivers || []).slice(0, 2).forEach((d, i) => {
      map['drv' + i] = { icon: '🧑‍✈️', label: d.name, to: '話す', fn: () => doTalk(d) };
    });
    map.press = { icon: '📰', label: '記者たち', to: '取材', fn: doPress };
    GP.paddock.visitors(g).forEach(v => {
      map[v.spot.key] = {
        icon: '🤝', label: v.driver.name + '（' + v.team.name + '）',
        to: '接触', fn: () => doPoach(v.driver, v.team)
      };
    });
    return map;
  }

  /* ---- ライバルのドライバーへの接触 ----
     一度で決まる話ではない。レースウィークごとに接触して心証を積み上げ、
     十分に傾いたところで移籍金を積んで引き抜く。                     */
  function poachInterest(d, team) {
    const track = D.TRACKS[Math.min(g.nextRace, D.TRACKS.length - 1)];
    const table = S.constructorTable(g);
    const myRank = table.findIndex(t => t.isPlayer) + 1;
    const theirRank = table.findIndex(t => t.name === team.name) + 1;
    // 上のチームからは来にくい。下のチームからは来やすい
    const rankPull = theirRank > 0 && myRank > 0 ? (theirRank - myRank) * 3.4 : 0;
    const fame = S.hypeTier(g).idx != null ? 0 : 0;
    return { rankPull: rankPull, myRank: myRank, theirRank: theirRank, track: track };
  }

  function poachFee(d, team) {
    const rating = S.driverRating(d);
    const table = S.constructorTable(g);
    const theirRank = Math.max(1, table.findIndex(t => t.name === team.name) + 1);
    // 強い選手ほど、上位チームに所属しているほど高い
    return Math.round((rating * 62 + (12 - theirRank) * 180 + 600)
                      * Math.max(0.55, 1 - S.osk(g, 'nego') * 0.06));   // 交渉術
  }

  function doPoach(d, team) {
    weekFlags();
    const key = 'poach:' + team.name + ':' + d.name;
    const info = poachInterest(d, team);
    if (d.interest == null) d.interest = 0;
    const already = (g.talked || []).indexOf(key) >= 0;
    const rating = Math.round(S.driverRating(d));
    const p = S.persOf(d);
    const fee = poachFee(d, team);

    const head =
      '<div class="quote">' + U.face(d, 40) + '<span><b>' + esc(d.name) + '</b>' +
      '<br><small>' + esc(team.name) + ' ／ ' + d.age + '歳 ／ 総合 ' + rating +
      ' ／ 給料 ' + money(d.salary) + '万/週</small></span></div>' +
      '<div class="reqrow"><span>心証</span><i><b style="width:' +
        Math.round(S.clamp(d.interest, 0, 100)) + '%"></b></i><em>' +
        Math.round(d.interest) + ' / 100</em></div>' +
      '<p class="desc">' + esc(p.icon + p.name + '／' + p.desc) + '</p>';

    const rows = [];
    // 心証が十分なら、移籍金を積んで誘える
    if (d.interest >= 60) {
      const canPay = g.funds >= fee;
      const full = g.drivers.length >= 2;
      rows.push({
        label: '💰 ' + money(fee) + '万で誘う', cls: 'primary',
        disabled: !canPay,
        fn: () => offerSeat(d, team, fee)
      });
      if (full) rows.push({ label: '（移籍には枠の入れ替えが要ります）', disabled: true, fn: () => {} });
    }
    if (!already) {
      rows.push({
        label: '🤝 話をする', cls: d.interest >= 60 ? '' : 'primary',
        fn: () => {
          // 自分のほうが上位なら心証は上がりやすい。下位だと響かない
          const up = S.clamp((6 + info.rankPull + S.rnd(-2, 5) + S.hypeBonus(g) * 4 - 4)
                             * (1 + S.osk(g, 'nego') * 0.12), -3, 26);   // 交渉術
          d.interest = S.clamp(d.interest + up, 0, 100);
          g.talked.push(key);
          S.save(g);
          U.closeModal();
          U.toast('🤝 心証 ' + (up >= 0 ? '+' : '') + Math.round(up), up >= 0 ? 'good' : 'bad');
          U.log(g, '🤝 ' + d.name + ' に接触した（心証 ' + Math.round(d.interest) + '）');
          render();
        }
      });
    }
    rows.push({ label: '戻る', fn: U.closeModal });

    const hint = already
      ? '<p class="note">今週はもう話した。次のレースウィークにまた来よう。</p>'
      : (info.rankPull < 0
          ? '<p class="note">相手のほうが上位のチームにいる。心証は上がりにくい。</p>'
          : '<p class="note">こちらのほうが上位。話は聞いてもらえそうだ。</p>');

    U.modal('🤝 ' + esc(d.name),
      head + hint +
      '<p class="desc">心証が <b>60</b> を超えると、移籍金を積んで誘えます。' +
      '移籍金の目安は <b>💰' + money(fee) + '万</b>。' +
      'いまの資金は ' + money(g.funds) + '万です。</p>',
      rows);
  }

  /* 引き抜きの実行。枠が埋まっていれば、誰と入れ替えるかを選ぶ */
  function offerSeat(d, team, fee) {
    if (g.funds < fee) return U.toast('資金が足りません', 'bad');
    const doSign = (outId) => {
      g.funds -= fee;
      if (outId != null) {
        const out = g.drivers.find(x => x.id === outId);
        g.drivers = g.drivers.filter(x => x.id !== outId);
        if (out) U.log(g, '👋 ' + out.name + ' との契約を解除した。');
      }
      // 相手チームから引き抜き、向こうには代役が入る
      team.drivers = team.drivers.filter(x => x !== d);
      const rep = S.makeDriver(Math.max(6, S.driverRating(d) * 0.82));
      rep.team = team.name;
      team.drivers.push(rep);
      d.team = g.team;
      d.interest = 100;
      d.seasonPoints = 0;
      g.drivers.push(d);
      U.closeModal();
      U.log(g, '🤝 ' + d.name + ' の獲得に成功した！（移籍金 ' + money(fee) + '万）', 'good');
      U.toast('🤝 ' + d.name + ' が加入！', 'good');
      GP.sound.play('good');
      GP.paddock.invalidate();
      S.save(g); render();
    };
    if (g.drivers.length < 2) return doSign(null);
    // 枠が埋まっているので、放出する側を選ぶ
    let body = '<p class="lead">' + esc(d.name) + ' を迎えるには、いまの2人のうち一人と契約を解除する必要があります。</p>' +
      '<div class="pick">';
    g.drivers.forEach(x => {
      body += '<button class="pickbtn" data-k="out:' + x.id + '">' +
        '<span class="pb-ic face-ic">' + U.face(x, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(x.name) + ' を放出</b>' +
        '<small>' + x.age + '歳／総合 ' + Math.round(S.driverRating(x)) +
        '／給料 ' + money(x.salary) + '万/週</small></span></button>';
    });
    body += '</div>';
    U.modal('🤝 ' + esc(d.name) + ' の獲得', body, [{ label: 'やめる', fn: U.closeModal }]);
    bindPick(k => { if (k.indexOf('out:') === 0) doSign(k.slice(4)); });
  }

  /* ---- 他チームのガレージを覗く ----
     自分より速いマシンほど学べるものが多い。分析担当がいると読み取れる量が増える。
     同じレースウィークでは1チームにつき1回まで。                       */
  function doScout(r) {
    weekFlags();
    const track = D.TRACKS[Math.min(g.nextRace, D.TRACKS.length - 1)];
    const mine = S.carScoreOf(S.carStats(g), track);
    const theirs = S.carScoreOf(r.stats, track);
    if ((g.scouted || []).indexOf(r.name) >= 0) {
      return U.modal('👀 ' + esc(r.name) + ' のガレージ',
        '<p class="lead">今週はもう十分に見せてもらった。</p>' +
        '<p class="desc">同じチームからは、レースウィークごとに一度しか学べません。</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    const analyst = S.staffBonus(g, 'analyst');
    // 差がそのまま学びになる。自分のほうが速ければ得るものは少ない
    const edge = Math.max(0, theirs - mine);
    const eye = S.osk(g, 'eye');
    const gain = Math.max(1, Math.round((edge * 0.30 + analyst * 0.5 + S.rnd(0, 1.5))
                                        * (1 + eye * 0.25)));   // 技術眼
    g.rp += gain;
    g.scouted.push(r.name);
    GP.paddock.invalidate();
    S.save(g);
    U.renderTop(g);            // ×で閉じても数字が合うように、先に上部バーを更新する
    const cmp = edge > 12 ? 'こちらより明らかに速い。学べることが多い。'
              : edge > 4 ? 'いくつか気になる工夫がある。'
              : 'こちらのほうが進んでいる。得るものは少ない。';
    U.modal('👀 ' + esc(r.name) + ' のガレージ',
      '<div class="intwrap"><canvas id="scoutCv" width="' + GP.paddock.W +
        '" height="120"></canvas></div>' +
      '<p class="lead">' + esc(cmp) + '</p>' +
      '<div class="bigbox">研究ポイント <b>+' + gain + '</b></div>' +
      '<p class="desc">相手のマシンがこのコースでどれだけ速いかで、学べる量が変わります。' +
      '分析担当を雇うと読み取れる量が増えます。</p>',
      [{ label: 'なるほど', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    // 覗いたマシンを描く
    const cv = $('scoutCv');
    if (cv) {
      const c2 = cv.getContext('2d');
      c2.imageSmoothingEnabled = false;
      c2.fillStyle = '#2a2436'; c2.fillRect(0, 0, cv.width, cv.height);
      c2.fillStyle = 'rgba(255,236,180,.14)'; c2.fillRect(0, 0, cv.width, 26);
      c2.save();
      c2.translate(cv.width / 2, 78); c2.scale(3.4, 3.4);
      GP.raceview.paintCar(c2, 0, 0, 0, r.color,
        Math.min(5, Math.max(0, Math.round((theirs - 12) / 26))), 0);
      c2.restore();
    }
    U.log(g, '👀 ' + r.name + ' のガレージを覗いた。研究ポイント +' + gain);
    GP.sound.play('good');
  }

  /* ---- ドライバーと話す ---- */
  function doTalk(d) {
    weekFlags();
    const key = 'talk:' + d.id;
    const done = (g.talked || []).indexOf(key) >= 0;
    const p = S.persOf(d);
    const line = S.quoteFor ? S.quoteFor(d, 'pre') : null;
    let body = '<div class="quote">' + U.face(d, 40) + '<span>' +
      esc(line || (d.form >= 108 ? '調子はいい。今日はいけると思う。'
                 : d.form <= 88 ? '正直、あまり感触がよくない。'
                 : 'いつも通り。やることをやるだけだ。')) + '</span></div>' +
      '<p class="desc">' + esc(p.icon + p.name + '／' + p.desc) + '</p>';
    if (done) {
      body += '<p class="note">今週はもう話した。</p>';
      return U.modal('🧑‍✈️ ' + esc(d.name), body, [{ label: '戻る', fn: U.closeModal }]);
    }
    const up = Math.round(S.rnd(3, 8) * p.rest);
    d.form = S.clamp(d.form + up, 62, 122);
    g.talked.push(key);
    S.save(g);
    U.renderTop(g);
    body += '<div class="bigbox">調子 <b>+' + up + '</b></div>' +
      '<p class="desc">レースウィークごとに、ひとり一度だけ話せます。</p>';
    U.modal('🧑‍✈️ ' + esc(d.name), body,
      [{ label: '送り出す', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    U.log(g, '🧑‍✈️ ' + d.name + ' と話した。調子 +' + up);
    GP.sound.play('good');
  }

  /* ---- 記者の取材 ----
     強気に出れば注目度が大きく動くが、外すと反動もある。          */
  function doPress() {
    weekFlags();
    if ((g.talked || []).indexOf('press') >= 0) {
      return U.modal('📰 記者たち',
        '<p class="lead">今週の取材はもう終えた。</p>', [{ label: '戻る', fn: U.closeModal }]);
    }
    const rank = S.constructorTable(g).findIndex(t => t.isPlayer) + 1;
    const teams = S.allTeams(g, D.TRACKS[Math.min(g.nextRace, D.TRACKS.length - 1)]).length;
    const strong = rank > 0 && rank <= Math.ceil(teams / 2);
    const answer = (label, hype, fan, note) => ({
      label: label, cls: hype > 6 ? 'primary' : '',
      fn: () => {
        // 上位にいるときの強気は効く。下位で大口を叩くと空回りする
        const mul = (strong ? 1 : 0.45) * (1 + S.osk(g, 'fame') * 0.25);   // 知名度
        const h = Math.round(hype * mul);
        S.addHype(g, h);
        g.fans = Math.max(0, Math.round(g.fans * (1 + fan * mul / 100)));
        g.talked.push('press');
        U.closeModal();
        U.toast('📰 注目度 ' + (h >= 0 ? '+' : '') + h, h >= 0 ? 'good' : 'bad');
        U.log(g, '📰 ' + note + '（注目度 ' + (h >= 0 ? '+' : '') + h + '）');
        S.save(g); render();
      }
    });
    U.modal('📰 記者たち',
      '<p class="lead">「今週の手応えはいかがですか？」</p>' +
      '<p class="desc">いまのコンストラクターズ順位は <b>' + (rank || '-') + '位</b>。' +
      (strong ? '上位にいるので、強気の発言はよく届きます。'
              : '下位のうちは、大きな話をしても響きにくいものです。') + '</p>',
      [
        answer('🔥 「表彰台を狙う」', 14, 3, '強気の発言をした'),
        answer('🙂 「一戦ずつ戦う」', 6, 1, '手堅く答えた'),
        answer('🤐 「特にありません」', 1, 0, '取材を短く切り上げた'),
        { label: 'やめる', fn: U.closeModal }
      ]);
  }

  const HUB_DOORS = {
    factory: { icon: '🏭', label: 'ファクトリー', to: '開発',   fn: () => cmdDevelop() },
    tunnel:  { icon: '🌀', label: '風洞',        to: '研究',   fn: () => cmdResearch() },
    sim:     { icon: '🏛️', label: 'シミュレーター', to: '練習', fn: () => cmdTrain() },
    market:  { icon: '📣', label: 'マーケティング室', to: '営業', fn: () => cmdSponsor() },
    youth:   { icon: '🎓', label: 'ユースアカデミー', to: '育成', fn: () => { hrTab = 'youth'; cmdStaff(); } },
    pit:     { icon: '🔧', label: 'ピット設備',   to: '整備',   fn: () => cmdMaintain() }
  };

  /* ---------- 拠点を歩く ----------
     プレイヤー（チームプリンシパル）が敷地を左右に歩き、
     建物の入口に立つと、その設備へ入れる。
     操作は 矢印キー／WASD と、画面のタップ（そこまで歩いていく）。   */
  const actor = { x: 264, y: 300, dir: 'down', frame: 0, moving: false, color: '#e04a3f' };
  let hubRaf = null, hubLast = 0, hubGoal = null, hubKeys = {}, hubDoor = null, hubBusy = false;
  let hubAutoEnter = null;     // 建物を押して向かっているとき、その入口の名前
  const WALK_SPEED = 62;            // 1秒あたりに進むドット数

  function stopHub() {
    if (hubRaf) cancelAnimationFrame(hubRaf);
    hubRaf = null; hubGoal = null; hubKeys = {};
  }

  function hubStep(ts) {
    const cv = $('hubCv');
    // 画面から消えた／レース中は止める（後処理の裏画面を奪い合わないように）
    const rs = $('raceScreen');
    if (!cv || !document.body.contains(cv) || !rs || /\bshow\b/.test(rs.className)) {
      hubRaf = null; return;
    }
    const dt = Math.min(0.05, (ts - hubLast) / 1000 || 0.016);
    hubLast = ts;

    // 画面（モーダル）が開いているあいだは操作を受けず、描画もしない。
    // ここで止めてしまうと、閉じたときに再開できないのでループ自体は回し続ける。
    const mo = $('modal');
    if (mo && /\bshow\b/.test(mo.className)) {
      hubKeys = {}; hubGoal = null; hubAutoEnter = null;
      hubRaf = requestAnimationFrame(hubStep);
      return;
    }

    let dx = 0, dy = 0;
    if (hubKeys.left) dx -= 1;
    if (hubKeys.right) dx += 1;
    if (hubKeys.up) dy -= 1;
    if (hubKeys.down) dy += 1;
    if (dx || dy) { hubGoal = null; hubAutoEnter = null; }   // キー操作が入ったら目的地を捨てる
    else if (hubGoal) {                              // タップした場所へ向かう
      const gx = hubGoal.x - actor.x, gy = hubGoal.y - actor.y;
      const d = Math.hypot(gx, gy);
      if (d < 3.0) {
        hubGoal = null;
        // 建物を押して向かってきた場合は、着いたらそのまま入る。
        // 「押したのに入れない」と感じさせないための扱い。
        if (hubAutoEnter) {
          const want = hubAutoEnter;
          hubAutoEnter = null;
          actor.moving = false;
          hubDoor = want;
          hubMap().drawWith(cv, g, hubDoor, actor);
          setTimeout(() => { if (hubDoor === want) hubEnter(); }, 120);
          hubRaf = requestAnimationFrame(hubStep);
          return;
        }
      } else { dx = gx / d; dy = gy / d; }
    }

    const len = Math.hypot(dx, dy) || 1;
    actor.moving = !!(dx || dy);
    if (actor.moving) {
      const p = hubMap().clampWalk(actor.x + (dx / len) * WALK_SPEED * dt,
                                   actor.y + (dy / len) * WALK_SPEED * dt);
      actor.x = p.x; actor.y = p.y;
      actor.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right')
                                              : (dy < 0 ? 'up' : 'down');
      actor.frame += dt * 8;
    } else {
      actor.frame = 0;
    }

    // 入口の判定と案内
    const door = hubMap().doorOf(actor.x, actor.y, g);
    const key = door ? door.key : null;
    if (key !== hubDoor) {
      hubDoor = key;
      const d = key && hubDoors()[key];
      const hint = $('hubHint');
      if (hint) {
        hint.textContent = d ? d.icon + ' ' + d.label + ' — ここで「入る」'
                             : (isRaceWeek() ? PADDOCK_IDLE_HINT : HUB_IDLE_HINT);
        hint.classList.toggle('on', !!d);
      }
      const btn = $('hubEnter');
      if (btn) { btn.disabled = !key; btn.textContent = key ? '▲ ' + hubDoors()[key].to + 'へ' : '▲ 入る'; }
      if (key) GP.sound.play('tap', 30);
    }

    hubMap().drawWith(cv, g, hubDoor, actor);
    hubRaf = requestAnimationFrame(hubStep);
  }

  function hubEnter() {
    if (!hubDoor || hubBusy) return;
    const d = hubDoors()[hubDoor];
    if (!d) return;
    hubBusy = true;
    GP.sound.play('click');
    hubGoal = null; hubKeys = {}; hubAutoEnter = null;
    d.fn();
    hubBusy = false;
  }

  const HUB_IDLE_HINT = '矢印キーで歩く／画面をタップでそこへ移動。建物の下で「入る」';
  const PADDOCK_IDLE_HINT = '矢印キーで歩く／画面をタップでそこへ移動。ガレージや出口の下で「入る」';

  function bindHub() {
    const cv = $('hubCv');
    if (!cv) { stopHub(); return; }
    GP.base.invalidate();          // 施設を広げた直後などに背景を作り直す
    GP.paddock.invalidate();
    actor.color = g.color || '#e04a3f';
    const p = hubMap().clampWalk(actor.x, actor.y);
    actor.x = p.x; actor.y = p.y;
    hubDoor = null;

    // 画面上の座標をキャンバスの座標へ直す
    const at = ev => {
      const r = cv.getBoundingClientRect();
      const t = (ev.changedTouches && ev.changedTouches[0]) || ev;
      return { x: (t.clientX - r.left) * (hubMap().W / r.width),
               y: (t.clientY - r.top) * (hubMap().H / r.height) };
    };

    // 建物を押したら、その入口まで歩いていく。地面を押したらそこへ歩く
    cv.onclick = ev => {
      const q = at(ev);
      const k = hubMap().hit(q.x, q.y);
      if (k && hubDoors()[k]) {
        const dp = hubMap().doorPos(k, g);
        if (dp) { hubGoal = dp; hubAutoEnter = k; return; }
      }
      // 地面を押したときは、そこへ歩くだけ
      hubAutoEnter = null;
      hubGoal = hubMap().clampWalk(q.x, q.y);
    };
    cv.ondblclick = () => hubEnter();

    const btn = $('hubEnter');
    if (btn) btn.onclick = hubEnter;

    if (!hubRaf) { hubLast = performance.now(); hubRaf = requestAnimationFrame(hubStep); }
  }

  /* キーボード操作。入力欄に文字を打っているときは邪魔しない */
  function bindHubKeys() {
    const MAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
                  a: 'left', d: 'right', w: 'up', s: 'down',
                  A: 'left', D: 'right', W: 'up', S: 'down' };
    const typing = () => {
      const t = document.activeElement;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    };
    document.addEventListener('keydown', ev => {
      if (typing() || !$('hubCv')) return;
      const m2 = $('modal');
      if (m2 && /\bshow\b/.test(m2.className)) return;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); hubEnter(); return; }
      const k = MAP[ev.key];
      if (!k) return;
      ev.preventDefault();
      hubKeys[k] = true;
    });
    document.addEventListener('keyup', ev => {
      const k = MAP[ev.key];
      if (k) hubKeys[k] = false;
    });
    // 画面から離れたときにキーが押しっぱなしにならないように
    window.addEventListener('blur', () => { hubKeys = {}; });
  }

  function render() {
    U.renderAll(g, specialOf(g));
    bindHub();
    const race = isRaceWeek();
    const offs = !!g.offseason;
    $('cmdNormal').style.display = (offs || race) ? 'none' : '';
    $('cmdRace').style.display = (!offs && race) ? '' : 'none';
    if ($('cmdOff')) $('cmdOff').style.display = offs ? '' : 'none';
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
  /* 見た目の切り替え。HD-2D（オクトパストラベラー風）を既定にする */
  const SKIN_KEY = 'gp_skin';
  function applySkin(k) {
    if (k === 'hd') document.body.setAttribute('data-skin', 'hd');
    else document.body.removeAttribute('data-skin');
    try { localStorage.setItem(SKIN_KEY, k); } catch (e) {}
  }
  function currentSkin() {
    let k = null;
    try { k = localStorage.getItem(SKIN_KEY); } catch (e) {}
    return k === 'kairo' ? 'kairo' : 'hd';
  }
  function bindSkin() {
    const btn = $('tSkin');
    if (!btn) return;
    const paint = () => {
      const hd = currentSkin() === 'hd';
      btn.textContent = hd ? '🌙' : '🎨';
      btn.title = hd ? '見た目：HD-2D（押すとカイロ風へ）' : '見た目：カイロ風（押すとHD-2Dへ）';
    };
    applySkin(currentSkin());
    paint();
    btn.onclick = () => { applySkin(currentSkin() === 'hd' ? 'kairo' : 'hd'); paint(); };
  }

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
      cLogi: cmdLogi, cLogiR: cmdLogi, cLogiO: cmdLogi,
      cGarage: cmdGarage, cFacility: cmdFacility, cStaff: cmdStaff, cInfo: cmdInfo,
      cRaceGo: cmdRace, cGarageR: cmdGarage, cStaffR: cmdStaff,
      cOffGo: doOffNext, cStaffO: cmdStaff, cInfoO: cmdInfo,
      cOwner: cmdOwner, cOwnerR: cmdOwner, cOwnerO: cmdOwner,
      cCrunch: cmdCrunch
    };
    Object.keys(map).forEach(id => { const el = $(id); if (el) el.onclick = map[id]; });
    $('modalClose').onclick = U.closeModal;
    // 数値は「レース全体を何秒で再生するか」。既定は「ゆっくり」
    const speeds = { rvSpeed0: 200, rvSpeed1: 95, rvSpeed2: 45, rvSpeed3: 15 };
    const allIds = Object.keys(speeds).concat(['rvSpeedReal']);
    const mark = id => allIds.forEach(o => { const el = $(o); if (el) el.classList.toggle('primary', o === id); });
    Object.keys(speeds).forEach(id => {
      $(id).onclick = () => { RV.setSpeed(speeds[id]); mark(id); };
    });
    // 実時間：実際のレースと同じ速さで進む。何分かかるかを添えておく
    const real = $('rvSpeedReal');
    if (real) real.onclick = () => {
      const sec = RV.setRealtime();
      mark('rvSpeedReal');
      U.toast('⏱ 実時間で進みます（残り約 ' + Math.ceil(sec / 60) + ' 分）', 'good');
    };
    $('rvSkip').onclick = () => RV.skip();
    Array.prototype.forEach.call($('rvCam').children, b => {
      b.onclick = () => { GP.sound.play('tap'); RV.setCamMode(b.dataset.cam); };
    });
  }

  function cmdRest() {
    g.crunchRow = 0;                 // 休むと徹夜の反動が抜ける
    g.drivers.forEach(d => { d.form = S.clamp(d.form + S.rnd(6, 14) * S.persOf(d).rest, 62, 122); });
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (p) p.cond = S.clamp(p.cond + S.rnd(3, 7), 10, 100);
    });
    S.restCrew(g, S.rnd(14, 22));
    U.log(g, '☕ チーム全体で休養をとった。コンディションとクルーの疲労が回復した。');
    U.pop('☕ 回復', 'good');
    endWeek();
  }

  /* ---------- ロジスティクス（週を消費しない）---------- */
  function cmdLogi() {
    const cur = S.logiPlan(g);
    const cw = S.crewPenalty(g);
    const nextTrack = D.TRACKS[g.nextRace] || D.TRACKS[0];
    const lvl = Math.round(cw.level);
    const state = lvl < 20 ? { t: '万全', c: 'good' } : lvl < 45 ? { t: 'ふつう', c: '' }
                : lvl < 70 ? { t: '疲れが見える', c: 'warn' } : { t: '限界', c: 'bad' };
    let body = '<p class="desc">レースごとに、マシンと機材を世界中へ運びます。' +
      '安く運べば資金は残りますが、クルーが消耗し、現地でのセットアップ時間も足りなくなります。</p>';

    body += '<div class="logi-crew"><b>🧑‍🔧 クルーの疲労</b>' +
      '<span class="skbar big"><i class="f' + (lvl < 45 ? '0' : lvl < 70 ? '1' : '2') +
      '" style="width:' + lvl + '%"></i></span>' +
      '<em class="' + state.c + '">' + lvl + ' / 100　' + state.t + '</em>' +
      '<small>ピット作業 +' + cw.pit.toFixed(1) + '秒／信頼性 -' + cw.rel.toFixed(1) +
      '／作業ミス +' + (cw.mistake * 100).toFixed(1) + '%<br>' +
      '「☕ 休養」で回復します。オフシーズンには抜けます。</small></div>';

    body += '<div class="sub">次戦 ' + nextTrack.country + ' ' + esc(nextTrack.name) +
      ' への輸送</div><div class="pick">';
    D.LOGI_PLANS.forEach(pl => {
      const save = { plan: (g.logi || {}).plan };
      g.logi = g.logi || { plan: 'std', crew: 0 };
      const before = g.logi.plan;
      g.logi.plan = pl.key;
      const cost = S.logiCost(g, nextTrack);
      g.logi.plan = before;
      const on = pl.key === cur.key;
      body += '<button class="pickbtn' + (on ? ' on' : '') + '" data-k="logi:' + pl.key + '">' +
        '<span class="pb-ic" style="background:' + pl.color + '">' + pl.icon + '</span>' +
        '<span class="pb-body"><b>' + pl.name + (on ? '　<em class="free">選択中</em>' : '') + '</b>' +
        '<small>' + pl.desc + '<br>' +
        'クルーの疲労 ' + (pl.fatigue > 0 ? '+' + pl.fatigue : pl.fatigue) + '／' +
        'マシンの仕上がり ' + (pl.perf === 1 ? '±0' :
          (pl.perf > 1 ? '+' : '') + ((pl.perf - 1) * 100).toFixed(1) + '%') +
        '</small></span>' +
        '<span class="pb-cost">💰' + money(cost) + '<br><b>' + esc(pl.note) + '</b></span></button>';
    });
    body += '</div><p class="desc">遠いコースほど輸送費は高くつきます。' +
      'ロジスティクス責任者を雇うと、費用も疲労も抑えられます。</p>';
    U.modal('🚚 ロジスティクス', body, [{ label: '閉じる', fn: U.closeModal }]);
    bindPick(k => {
      const key = k.split(':')[1];
      g.logi = g.logi || { plan: 'std', crew: 0 };
      g.logi.plan = key;
      const pl = S.logiPlan(g);
      GP.sound.play('confirm');
      U.log(g, '🚚 輸送を「' + pl.icon + pl.name + '」にした。');
      S.save(g); render(); cmdLogi();
    });
  }

  /* ---- チーム診断：いま何が足を引っぱっているのか ---- */
  function teamDiag() {
    const track = D.TRACKS[Math.min(g.nextRace, D.TRACKS.length - 1)];
    const mineCar = S.carScoreOf(S.carStats(g), track);
    const mineDrv = g.drivers.reduce((a, d) => a + S.driverRating(d), 0) / Math.max(1, g.drivers.length);
    const mineRel = S.reliability(g);
    const rows = [
      { key: 'car', icon: '🏎️', name: 'マシンの速さ', mine: mineCar,
        rivals: (g.rivals || []).map(r => S.carScoreOf(r.stats, track)),
        advice: 'パーツの改良と車体の熟成にコマンドを割きましょう。' },
      { key: 'drv', icon: '🧑‍✈️', name: 'ドライバーの腕', mine: mineDrv,
        rivals: (g.rivals || []).map(r => r.drivers.reduce((a, d) => a + S.driverRating(d), 0) / Math.max(1, r.drivers.length)),
        advice: '練習で鍛えるか、市場でより速い人を獲りましょう。' },
      { key: 'rel', icon: '🔩', name: 'マシンの信頼性', mine: mineRel,
        rivals: (g.rivals || []).map(r => r.rel),
        advice: '整備コマンド、ピット設備、メカニックの補強を。車体の剛性と冷却も効きます。' }
    ];
    const n = (g.rivals || []).length + 1;
    rows.forEach(r => {
      r.rank = r.rivals.filter(v => v > r.mine).length + 1;
      r.pct = (n - r.rank) / Math.max(1, n - 1);
    });
    const worst = rows.slice().sort((a, b) => b.rank - a.rank)[0];

    let h = '<div class="sub">🔎 チーム診断（次戦 ' + esc(track.name) + ' で）</div>' +
      '<div class="diag">';
    rows.forEach(r => {
      const cls = r.rank <= 3 ? 'top' : r.rank <= Math.ceil(n / 2) ? 'mid' : 'low';
      h += '<div class="diag-row' + (r === worst && r.rank > 3 ? ' worst' : '') + '">' +
        '<span class="diag-nm">' + r.icon + ' ' + r.name + '</span>' +
        '<span class="diag-bar"><i class="' + cls + '" style="width:' +
          Math.round(Math.max(4, r.pct * 100)) + '%"></i></span>' +
        '<b class="' + cls + '">' + r.rank + ' / ' + n + '位</b></div>';
    });
    h += '</div>';
    // 現場の細かいところ
    const fin = S.finances(g);
    const cw = S.crewPenalty(g);
    h += '<div class="diag-sub">' +
      '<span>🔧 ピット作業 <b>' + (20.5 - g.facilities.pit * 0.7 - S.staffBonus(g, 'mechanic') * 0.4
        - S.mgr(g, 'pitchief') * 0.06 - S.osk(g, 'call') * 0.5 + cw.pit).toFixed(1) + '秒</b></span>' +
      '<span>🧑‍🔧 クルーの疲労 <b>' + Math.round(cw.level) + '</b></span>' +
      '<span>⚙️ PU ' + S.puOf(g).used + '基目 <b class="' +
        (S.puOf(g).life < 25 ? 'bad' : '') + '">残り ' + Math.round(S.puOf(g).life) + '%</b>' +
        '（今季あと ' + Math.max(0, D.PU_LIMIT - S.puOf(g).used) + '基）</span>' +
      '<span>👷 開発の厚み <b>' + (S.staffBonus(g, 'engineer') * 100 / 3).toFixed(0) + '</b></span>' +
      '<span>🧾 今季の予算 <b class="' + (S.capSpent(g) > S.costCap(g) ? 'bad' : '') + '">' +
        money(S.capSpent(g)) + '/' + money(S.costCap(g)) + '万</b></span>' +
      '<span>💹 1戦の収支 <b class="' + (fin.net >= 0 ? 'good' : 'bad') + '">' +
        (fin.net >= 0 ? '+' : '') + money(fin.net) + '万</b></span>' +
      '</div>';
    if (worst.rank > 3) {
      h += '<p class="note">📌 いま一番の足かせは <b>' + worst.name + '</b>（' + worst.rank + '/' + n + '位）。' +
           worst.advice + '</p>';
    } else {
      h += '<p class="note">📌 どの部門も上位です。この形を保ちましょう。</p>';
    }
    return h;
  }

  /* ---- タイトルスポンサーと契約する（週は消費しない）---- */
  function doTitleSponsor(key) {
    if (g.title) return;
    if (S.titleOpen(g).every(t => t.key !== key)) return;
    const t = S.signTitle(g, key);
    if (!t) return;
    GP.sound.play('crit');
    U.log(g, '👑 ' + t.name + ' とタイトルスポンサー契約！ チーム名が「' +
             S.teamLabel(g) + '」になった。', 'good');
    U.toast('👑 ' + t.name + ' が冠スポンサーに！', 'good');
    U.pop('👑 ' + t.short, 'crit');
    S.save(g); render(); cmdSponsor();
  }

  function cmdInfo() {
    let body = stakeBlock(false);
    body += teamDiag();
    body += U.finance(g);
    body += '<div class="sub">🔎 ライバルの動向</div>' + rivalTrends();
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
    bindSkin();
    bindHubKeys();
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

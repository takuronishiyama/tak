/* =========================================================
   画面：営業と情報（スポンサー・サプライヤー・オーナー・診断）
   main.js から切り出したもの。中身はそのまま動かしていない。
   ほかの画面と共有しているものは、文脈（A）から link() で受け取る。
   ========================================================= */
window.GP = window.GP || {};
GP.screens = GP.screens || {};

GP.screens.biz = function (A) {
  'use strict';
  const D = GP.data, S = GP.state, U = GP.ui, R = GP.race, RV = GP.raceview;
  let g = null;
  /* ほかの画面と main.js から借りているもの。link() で埋まる */
  let $, bindPick, endWeek, esc, interiorHTML, money, paintInterior, render, rivalTrends, stakeBlock;
  function link() {
    $ = A.$;
    bindPick = A.bindPick;
    endWeek = A.endWeek;
    esc = A.esc;
    interiorHTML = A.interiorHTML;
    money = A.money;
    paintInterior = A.paintInterior;
    render = A.render;
    rivalTrends = A.rivalTrends;
    stakeBlock = A.stakeBlock;
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
      '<span>スポンサー収入 <b>×' + S.hypeBonus(g).toFixed(2) + '</b></span></div>' +
      '<p class="desc">契約・解約は<b>週を使いません</b>。何社でも見比べてから決めてください。<br>' +
      '<b>🏭 サプライヤー型</b>は現金こそ少ないものの、自分たちが売っているものを安く入れてくれます。' +
      '設備の導入費や新品PUの代金は、まとまると効きます。</p>' + perkBoxHTML();

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
    body += supplyBoxHTML();

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
      '<span class="pb-body"><b>プロモーション活動</b>' +
      '<small>ファンを増やし、少し資金も入る<br>' +
      '<b class="warn">この活動だけは1週ぶんのコマンドを使います</b></small></span>' +
      '<span class="pb-cost">+ファン<br>週を1つ使う</span></button></div>';
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
    bindSupply();
  }
  /* ---- いま効いているサプライヤー特典 ----
     契約の値打ちは、毎戦の入金だけでは測れない                  */
  function perkBoxHTML() {
    const list = S.perkList(g);
    if (!list.length) return '';
    // 同じ費目に複数ついていれば、合計でいくら安くなっているかを出す
    const seen = {};
    list.forEach(x => { seen[x.key] = true; });
    return '<div class="perkbox"><b>🏭 いま効いている現物支援</b>' +
      '<div class="perklist">' + list.map(x =>
        '<span class="perkrow"><b>' + x.icon + ' ' + esc(x.name) + '</b>' +
        '<em>-' + Math.round(S.perkCut(g, x.key) * 100) + '%</em>' +
        '<i>' + esc(x.from) + '</i></span>').join('') + '</div>' +
      '<small>同じ費目に何社かつけば重なりますが、合わせて ' +
      Math.round(D.PERK_CAP * 100) + '% までです。</small></div>';
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
    return '毎戦 ' + parts.join('　') + perkChip(s);
  }
  /* 現物で支える相手は、金額だけ見ても価値が分からない */
  function perkChip(s) {
    if (!s || !s.perk) return '';
    const d = D.PERKS[s.perk.key] || { icon: '🏭', name: s.perk.key };
    return '<em class="perk">' + d.icon + ' ' + d.name + ' -' +
      Math.round(s.perk.cut * 100) + '%</em>';
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
    // 判を押すだけなので週は使わない
    S.save(g); render(); cmdSponsor();
  }

  function doSign(name) {
    const s = D.SPONSORS.find(x => x.name === name);
    if (!s) return;
    g.sponsors.push(Object.assign({}, s));
    const adv = Math.round(s.per * 4);
    g.funds += adv;
    GP.sound.play('coin');
    U.log(g, '🤝 ' + s.name + ' と契約！ 契約金 +' + money(adv) + '万', 'good');
    U.toast('🤝 ' + s.name + ' と契約成立！', 'good');
    // 契約そのものは週を使わない。使うのはプロモーション活動だけ
    S.save(g); render(); cmdSponsor();
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
                   money(pr.need) + '。上がるごとにスキルポイントが' + D.FAME.spPerRank + 'つ手に入ります。'
                 : '最高ランクに到達しています。') +
      '</p>' +
      '<div class="sub small">名声が貯まること</div>' +
      '<p class="desc">下の一覧が、そのまま計算に使っている数字です。' +
        '1段上がるごとにスキルポイントが <b>' + D.FAME.spPerRank + '</b> つ手に入ります。</p>' +
      '<div class="famelist">' +
      D.FAME.SRC.map(x =>
        '<div class="fame-row"><i>' + x.icon + '</i><span>' + esc(x.name) +
        (x.note ? '<small>' + esc(x.note) + '</small>' : '') + '</span>' +
        '<em>+' + x.v + '</em></div>').join('') +
      '</div>' +
      '<p class="desc">レースの名声は<b>2台ぶん</b>入ります。' +
        '完走してポイントを持ち帰るだけでも積み上がるので、' +
        '毎戦きちんと帰ってくることがそのまま名になります。</p>' +
      '<div class="sub">スキル</div>' +
      '<p class="desc">段位は現在のランク＋1まで伸ばせます（いまは最大 ' +
        Math.min(D.OWNER_SKILL_MAX, pr.i + 1) + ' 段）。</p>' +
      ownerNowHTML(o) +
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
        (lv > 0 && sk.now
          ? '<div class="osk-eff now">いま：' +
            sk.now(lv).map(e => '<span>' + esc(e) + '</span>').join('') + '</div>'
          : '') +
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

  /* いま実際に効いているぶんだけを、まとめて出す。
     「取ったはいいが何が変わったのか分からない」を無くすため   */
  function ownerNowHTML(o) {
    const rows = [];
    D.OWNER_SKILLS.forEach(sk => {
      const lv = (o.skills || {})[sk.key] || 0;
      if (lv > 0 && sk.now) {
        rows.push('<div class="on-row"><i style="background:' + sk.color + '">' + sk.icon + '</i>' +
          '<b>' + sk.name + ' ' + lv + '段</b><span>' +
          sk.now(lv).map(esc).join(' ／ ') + '</span></div>');
      }
    });
    if (!rows.length) {
      return '<p class="note">まだスキルを取っていません。' +
        'スキルポイントを振ると、ここに「いま効いていること」が並びます。</p>';
    }
    return '<div class="sub small">いま効いていること</div>' +
      '<div class="ownernow">' + rows.join('') + '</div>';
  }

  /* 名声を足し、ランクが上がったら知らせる */
  function grantFame(n, why) {
    if (!n) return;
    const up = S.addFame(g, n);
    if (up > 0) {
      const pr = S.ownerProgress(g);
      const sp = up * D.FAME.spPerRank;
      U.toast(pr.cur.icon + ' ' + pr.cur.name + ' に昇格！ スキルP +' + sp, 'good');
      U.log(g, pr.cur.icon + ' オーナーランクが上がった：' + pr.cur.name +
               '（スキルポイント +' + sp + '）', 'good');
      GP.sound.play('win');
    } else if (why) {
      U.log(g, '⭐ 名声 +' + n + '（' + why + '）');
    }
  }

  /* =======================================================
     技術責任者からの報告
     いまのマシンとシーズンの残りを見て、チームが何を求めているかを言う。
     「今季は勝ちにいける」のか「来季に振るべき」なのかを、はっきり伝える。
     ======================================================= */
  function techVoice() {
    const m = g.managers && g.managers.technical;
    if (m) return { name: m.name, role: '開発責任者', icon: '🔬' };
    const eng = (g.staff || []).filter(x => x.type === 'engineer' || x.type === 'designer')
      .sort((a, b) => b.skill - a.skill)[0];
    if (eng) return { name: eng.name, role: 'エンジニア', icon: '👷' };
    return { name: '技術チーム', role: '', icon: '🔧' };
  }

  function techVerdict() {
    const track = S.trackAt(g, g.nextRace);
    const mineCar = S.carScoreOf(S.carStats(g), track);
    const rivals = (g.rivals || []).map(r => S.carScoreOf(r.stats, track));
    const carRank = rivals.filter(v => v > mineCar).length + 1;
    const n = rivals.length + 1;
    const left = Math.max(0, D.RACES - (g.nextRace || 0));
    const st = S.championshipStake(g);
    const prog = S.nextCarProgress(g);
    const fc = S.focusOf(g);
    const regSoon = S.regulationNext(g);
    const capR = S.capRatio(g);
    const atr = S.atrOf(g);
    // 車体とパーツの厚みの差（車体だけ置いていかれていないか）
    const bodyAvg = D.BODY_ATTRS.reduce((a, x) => a + S.bodyRatio(g, x.key), 0) / D.BODY_ATTRS.length;
    const partAvg = D.PART_CATS.reduce((a, c) => {
      const p = g.equipped[c.key];
      return a + (p ? Math.min(1, p.power / S.partCap(g, p)) : 0);
    }, 0) / D.PART_CATS.length;

    const V = [];
    // 上から順に、いちばん差し迫っているものを1つ選ぶ
    if (regSoon && prog < 0.35) {
      V.push({ tone: 'bad', head: 'このままでは来季、戦えません',
        text: '今季かぎりでレギュレーションが変わります。いま積んでいるパーツと車体は白紙に戻る。' +
              '来季ぶんの仕込みが <b>' + Math.round(prog * 100) + '%</b> では、開幕から周回遅れです。',
        ask: '開発リソースの配分を「来季優先」寄りに振ってください。' +
             '設計したパーツも売らずに保管を。次の規則の土台になります。' });
    }
    if (regSoon && prog >= 0.35) {
      V.push({ tone: 'good', head: '来季の下地はできています',
        text: '規則の変わる年に向けて、仕込みは <b>' + Math.round(prog * 100) + '%</b> まで来ました。' +
              '今季の順位は多少落としても構いません。',
        ask: 'このまま来季に厚く振り続けてください。' });
    }
    if (capR >= 0.95) {
      V.push({ tone: 'bad', head: '予算がもう限界です',
        text: '今季の上限に対して <b>' + Math.round(capR * 100) + '%</b> を使いました。' +
              'これ以上は超過分の罰金と、来季の風洞時間の削減がついてきます。',
        ask: '残りは金のかからない手で凌ぎましょう。整備と練習で持たせます。' });
    }
    if (bodyAvg + 0.22 < partAvg) {
      V.push({ tone: 'warn', head: '車体が置いていかれています',
        text: 'パーツは <b>' + Math.round(partAvg * 100) + '%</b> まで来ているのに、' +
              '車体は <b>' + Math.round(bodyAvg * 100) + '%</b>。' +
              '速さはあっても、壊れやすく、タイヤも保たず、ピットも遅いままです。',
        ask: '数週は車体の熟成に回してください。速さより、走りきる力が足りていません。' });
    }
    if (carRank <= 2 && left >= 3 && st.rank <= 3) {
      V.push({ tone: 'good', head: '今季、勝ちにいきましょう',
        text: 'マシンは <b>' + n + 'チーム中 ' + carRank + '番目</b>。選手権も <b>' + st.rank + '位</b>で、' +
              '残り <b>' + left + '戦</b>あります。ここで手を緩める理由がありません。',
        ask: st.rank === 1
          ? '開発は今季に全振りを。首位を守りきれば ' + money(st.prizeNow) + '万と、タイトルが手に入ります。'
          : '開発は今季に全振りを。1つ順位を上げるだけで ' + money(st.upGain) + '万が動きます。' });
    }
    if (carRank >= 7 && left <= 5 && left > 0) {
      V.push({ tone: 'warn', head: '今季の巻き返しは、正直むずかしい',
        text: 'マシンは <b>' + n + 'チーム中 ' + carRank + '番目</b>。残り <b>' + left + '戦</b>で' +
              'この差を埋めるより、来季のマシンに手を入れたほうが実りがあります。',
        ask: '配分を来季寄りに。今季は完走と入賞を拾って、賞金だけ確保しましょう。' });
    }
    if (atr < 0.92) {
      V.push({ tone: 'warn', head: '使える開発時間が少ない',
        text: '昨季の順位で風洞・CFDの使用時間が <b>×' + atr.toFixed(2) + '</b> に絞られています。' +
              '同じ手数でも、伸びは他所より小さい。',
        ask: '狙いを1つに絞りましょう。あちこち手を出すと、どれも届きません。' });
    }
    if (left === 0 && !g.offseason) {
      V.push({ tone: 'good', head: '今季は走りきりました',
        text: 'あとはオフの使い方です。仕込みは <b>' + Math.round(prog * 100) + '%</b>。',
        ask: 'オフに「来季のマシン方針」を決めてください。積んだ仕込みがそこで乗ります。' });
    }
    if (!V.length) {
      V.push({ tone: '', head: '悪くない進み方です',
        text: 'マシンは <b>' + n + 'チーム中 ' + carRank + '番目</b>、選手権は <b>' + st.rank + '位</b>。' +
              '今季の配分は「' + fc.icon + fc.name + '」です。',
        ask: 'このまま積み上げていきましょう。' });
    }
    return V[0];
  }

  function techReport() {
    const v = techVerdict();
    const who = techVoice();
    return '<div class="techrep ' + v.tone + '">' +
      '<div class="tr-head">' + who.icon + ' ' + esc(who.name) +
      (who.role ? '<em>' + who.role + '</em>' : '') + '</div>' +
      '<b>' + v.head + '</b>' +
      '<p>' + v.text + '</p>' +
      '<p class="tr-ask">▶ ' + v.ask + '</p></div>';
  }

  /* =======================================================
     経営レポート
     首脳陣が、リソースと人の過不足を指摘する。
     「足りない」だけでなく「余っている」も言う。
     ======================================================= */
  function mgmtVoice(role) {
    const m = g.managers && g.managers[role];
    const def = D.MANAGERS.find(x => x.key === role) || {};
    // 役職が空席なら、現場からの声としてまとめて上がってくる
    return m
      ? { name: m.name, icon: def.icon || '👔', role: def.name || '', vacant: false }
      : { name: '現場から', icon: def.icon || '👔', role: (def.name || '') + ' 不在', vacant: true };
  }

  function mgmtReport() {
    const track = S.trackAt(g, g.nextRace);
    const fin = S.finances(g);
    const out = [];
    const push = (sev, role, head, text, ask) =>
      out.push({ sev: sev, who: mgmtVoice(role), head: head, text: text, ask: ask });

    // ---- 資金繰り ----
    const runway = fin.weekly > 0 ? Math.floor(g.funds / fin.weekly) : 99;
    if (g.funds < 0) {
      push(3, 'principal', '資金がマイナスです',
        '固定費が毎週 ' + money(fin.weekly) + '万。いまの資金は ' + money(g.funds) + '万です。' +
        '-20,000万を割ると、チームは解散になります。',
        '人件費の見直しか、賞金の入る順位が要ります。');
    } else if (runway < 8) {
      push(3, 'principal', '資金がもちません',
        '毎週 ' + money(fin.weekly) + '万が出ていきます。いまの資金では <b>あと' + runway + '週</b>です。',
        '開発を止めてでも、賞金の入る順位を取りにいきましょう。遠征を船便に落とすのも手です。');
    } else if (runway > 40 && S.capRatio(g) < 0.55 && (g.nextRace || 0) >= 6) {
      push(1, 'principal', '資金が寝ています',
        '資金は ' + money(g.funds) + '万（' + runway + '週ぶん）。' +
        '今季の予算枠も <b>' + Math.round(S.capRatio(g) * 100) + '%</b> しか使っていません。',
        '使わなかった枠は来季に持ち越せません。開発か施設に回しましょう。');
    }

    // ---- 人の過不足 ----
    const need = [
      { k: 'engineer',   label: 'エンジニア',     why: '開発の伸びが上がりません' },
      { k: 'mechanic',   label: 'メカニック',     why: '信頼性が低く、ピット作業も遅いままです' },
      { k: 'strategist', label: 'ストラテジスト', why: 'ピットのタイミングが読めず、作業も遅れます' },
      { k: 'designer',   label: 'デザイナー',     why: '良いレアリティのパーツが設計できません' },
      { k: 'analyst',    label: 'アナリスト',     why: '研究ポイントが伸びません' },
      { k: 'trainer',    label: 'トレーナー',     why: 'ドライバーの育ちが遅くなります' }
    ];
    const bonus = {};
    need.forEach(x => { bonus[x.k] = S.staffBonus(g, x.k); });
    const missing = need.filter(x => bonus[x.k] < 0.35);
    if (missing.length) {
      const first = missing[0];
      push(missing.length >= 3 ? 3 : 2, 'principal',
        first.label + 'が足りていません',
        (missing.length > 1
          ? '<b>' + missing.map(x => x.label).join('・') + '</b> が手薄です。'
          : '<b>' + first.label + '</b> が実質いません。') + first.why,
        '人事から採るか、他チームから引き抜きましょう。' +
        (first.k === 'strategist'
          ? '一流のストラテジストがいるかどうかで、接戦での優勝率はおよそ倍変わります。' : ''));
    } else {
      const top = need.slice().sort((a, b) => bonus[b.k] - bonus[a.k]);
      if (bonus[top[0].k] > bonus[top[top.length - 1].k] * 3.2 && bonus[top[0].k] > 2.4) {
        push(1, 'principal', top[0].label + 'に偏っています',
          '<b>' + top[0].label + '</b> は厚いのに、<b>' + top[top.length - 1].label + '</b> が薄い。' +
          '同じ人件費なら、薄いところに寄せたほうが効きます。',
          '次の採用は ' + top[top.length - 1].label + ' を。昇進で首脳陣に上げるのも手です。');
      }
    }

    // ---- 首脳陣の空席 ----
    const vacant = D.MANAGERS.filter(x => !(g.managers && g.managers[x.key]));
    const promotable = (g.staff || []).some(x => S.promotableRoles(g, x).length);
    if (vacant.length && (promotable || g.funds > 12000)) {
      push(2, vacant[0].key, vacant[0].name + 'の席が空いています',
        '<b>' + vacant.map(x => x.name).join('・') + '</b> が不在です。' + esc(vacant[0].desc),
        promotable ? '技能の足りたスタッフを昇進させられます。人事から。'
                   : '候補者を雇いましょう。人事から。');
    }

    // ---- ドライバーとマシンの釣り合い ----
    const mineCar = S.carScoreOf(S.carStats(g), track);
    const mineDrv = g.drivers.reduce((a, d) => a + S.driverRating(d), 0) / Math.max(1, g.drivers.length);
    const carRank = (g.rivals || []).filter(r => S.carScoreOf(r.stats, track) > mineCar).length + 1;
    const drvRank = (g.rivals || []).filter(r =>
      r.drivers.reduce((a, d) => a + S.driverRating(d), 0) / Math.max(1, r.drivers.length) > mineDrv).length + 1;
    const balanceOk = (g.nextRace || 0) >= 2 || g.season > 1;
    if (balanceOk && drvRank - carRank >= 4 && carRank <= 8) {
      push(2, 'principal', 'マシンにドライバーが追いついていません',
        'マシンは <b>' + carRank + '番目</b>なのに、ドライバーの腕は <b>' + drvRank + '番目</b>。' +
        'いまのクルマなら、もっと上で走れるはずです。',
        '練習で鍛えるか、市場でより速い人を。育成の若手を上げる手もあります。');
    } else if (balanceOk && carRank - drvRank >= 4 && drvRank <= 8) {
      push(2, 'technical', 'ドライバーにマシンが追いついていません',
        'ドライバーの腕は <b>' + drvRank + '番目</b>なのに、マシンは <b>' + carRank + '番目</b>。' +
        'いい人材を遊ばせています。',
        '開発にコマンドを寄せてください。腕のある人ほど、良いクルマで化けます。');
    }

    // ---- 研究ポイント ----
    const capped = D.PART_CATS.every(c => {
      const p = g.equipped[c.key];
      return p && p.power >= S.partCap(g, p) * 0.95;
    });
    if (g.rp > 400 && !capped) {
      push(1, 'technical', '研究ポイントが余っています',
        '<b>' + g.rp + 'pt</b> 貯まっています。使わなければ、ただの数字です。',
        '設計に回して、より良いレアリティのパーツを引きにいきましょう。');
    }

    // ---- 現場の消耗 ----
    const cw = S.crewPenalty(g);
    if (cw.level >= 65) {
      push(2, 'pitchief', 'クルーが限界です',
        '疲労が <b>' + Math.round(cw.level) + '</b>。ピット作業が +' + cw.pit.toFixed(1) +
        '秒、信頼性も -' + cw.rel.toFixed(1) + ' 落ちています。',
        '「☕休養」を挟むか、遠征をチャーター便に上げてください。');
    }

    // ---- 運営費 ----
    if (fin.net < 0 && fin.weekly > 900) {
      push(2, 'logistics', '運営費が重くなっています',
        '毎週 ' + money(fin.weekly) + '万。1戦あたりの収支は <b>' +
        money(fin.net) + '万</b>で、賞金だけが頼りです。',
        mgmtVoice('logistics').vacant
          ? 'ロジスティクス責任者を据えれば、固定費そのものが下がります。'
          : '輸送手段を落とすか、契約を見直しましょう。');
    }

    // ---- 施設の偏り ----
    const lv = D.FACILITIES.map(f => ({ f: f, v: g.facilities[f.key] || 1 }))
      .sort((a, b) => b.v - a.v);
    if (lv.length && lv[0].v - lv[lv.length - 1].v >= 4) {
      push(1, 'technical', lv[lv.length - 1].f.name + 'だけ取り残されています',
        '<b>' + lv[0].f.name + ' Lv.' + lv[0].v + '</b> に対して、<b>' +
        lv[lv.length - 1].f.name + ' は Lv.' + lv[lv.length - 1].v + '</b>。' +
        esc(lv[lv.length - 1].f.desc),
        '次の拡張はそこへ。伸びしろが残っているところほど、同じ金額で効きます。');
    }

    out.sort((a, b) => b.sev - a.sev);
    return out.slice(0, 3);
  }

  function mgmtReportHTML() {
    const rows = mgmtReport();
    if (!rows.length) {
      return '<div class="sub">👔 経営レポート</div>' +
        '<p class="desc">いまのところ、目立った過不足はありません。</p>';
    }
    let h = '<div class="sub">👔 経営レポート — リソースと人の過不足</div><div class="mgrep">';
    rows.forEach(r => {
      const cls = r.sev >= 3 ? 'bad' : r.sev === 2 ? 'warn' : 'note';
      h += '<div class="mg-row ' + cls + '">' +
        '<div class="mg-who">' + r.who.icon + ' ' + esc(r.who.name) +
        '<em>' + esc(r.who.role) + '</em></div>' +
        '<b>' + r.head + '</b>' +
        '<p>' + r.text + '</p>' +
        '<p class="mg-ask">▶ ' + r.ask + '</p></div>';
    });
    return h + '</div>';
  }

  /* ---- チーム診断：いま何が足を引っぱっているのか ---- */
  function teamDiag() {
    const track = S.trackAt(g, g.nextRace);
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
      '<span>🔧 ピットの静止時間 <b>' + S.pitCrew(g).stand.toFixed(1) + '秒</b>' +
        '（しくじり ' + (S.pitCrew(g).fumble * 100).toFixed(0) + '%）</span>' +
      '<span>🧑‍🔧 クルーの疲労 <b>' + Math.round(cw.level) + '</b></span>' +
      '<span>⚙️ PU ' + S.puOf(g).n + '基目 <b class="' +
        (S.puOf(g).life < 25 ? 'bad' : '') + '">残り ' + Math.round(S.puOf(g).life) + '%</b>' +
        '（今季あと ' + Math.max(0, S.puLimit(g) - S.puOf(g).used) + '基／保管 ' +
        S.puOf(g).pool.length + '基）</span>' +
      '<span>👷 開発の厚み <b>' + (S.devPower(g) * 100 / 3).toFixed(0) + '</b></span>' +
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

  /* =======================================================
     サプライヤー
     看板を貼って金を出すスポンサーとは別に、
     道具そのものを卸してくれる相手がいる。
     効くのは「買うとき」と「持ち続けるあいだ」の両方。
     長く付き合うほど、値引きは深くなる。
     ======================================================= */
  function supplyBoxHTML() {
    const list = S.supplyList(g);
    const slots = S.supplySlots(g);
    const on = list.filter(x => x.on);
    const up = S.gearUpkeep(g);
    let h = '<div class="sub">🏭 サプライヤー</div>' +
      '<p class="desc">スポンサーが「看板を貼って金を出す相手」なら、サプライヤーは' +
      '<b>道具そのものを卸してくれる相手</b>です。毎週いくらか払う代わりに、' +
      '<b>装備の値段</b>と<b>維持費</b>がまとめて下がります。' +
      '付き合いが長くなるほど、値引きは深くなります。<br>' +
      '契約枠 <b>' + on.length + ' / ' + slots + '</b>（物流倉庫がLv.4になると1つ増えます）</p>';
    h += '<div class="upbox"><span>🔧 いまの維持費 <b>💰' + money(up.net) + '万／週</b></span>' +
      '<span>割引 <b>' + (up.cut > 0 ? '-' + Math.round(up.cut * 100) + '%' : 'なし') + '</b></span>' +
      '<span>契約料 <b>💰' + money(S.supplyFee(g)) + '万／週</b></span></div>';
    h += '<div class="pick">';
    list.forEach(x => {
      const d = x.def;
      const field = d.field === 'gear' ? '備品' : d.field === 'kit' ? '週末の機材' : '備品と機材';
      const deepPct = Math.round(x.deep * 100);
      const can = x.on || (x.open && on.length < slots);
      h += '<button class="pickbtn' + (x.on ? ' offer' : can ? '' : ' done') +
        '" data-sup="' + d.key + '"' + (can ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#5f7a4a">' + d.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) +
          (x.on ? '<em class="gowned">契約中 あと' + x.left + '季</em>' : '') + '</b>' +
        '<small>' + esc(d.desc) +
        '<br>' + field + 'の購入 <b>-' + Math.round(d.buy * 100) + '%</b>' +
        '／維持費 <b>-' + Math.round(d.keep * 100) + '%</b>' +
        '　契約料 <b>💰' + money(d.fee) + '万/週</b>　' + d.years + 'シーズン' +
        (x.on && deepPct > 0 ? '<br><em class="free">付き合いの深さで、いまは <b>+' +
          deepPct + '%</b> 上乗せして効いています</em>' : '') +
        (!x.on && !x.open ? '<br><em class="warn">条件：ファン ' + money(d.fans) +
          ' 以上・注目度 ' + d.hype + ' 以上</em>' : '') +
        (!x.on && x.open && on.length >= slots ? '<br><em class="warn">契約枠が空いていません</em>' : '') +
        '</small></span>' +
        '<span class="pb-cost">' + (x.on ? '解約' : can ? '契約' : '—') + '</span></button>';
    });
    return h + '</div>';
  }

  function bindSupply() {
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-sup]'), b => {
      b.onclick = () => {
        const key = b.dataset.sup;
        const cur = (g.supply || []).filter(x => x.key === key)[0];
        const d = D.SUPPLIERS.filter(x => x.key === key)[0];
        if (!d) return;
        if (cur) {
          const fee = S.dropSupplyCost(g, key);
          U.modal('🏭 ' + esc(d.name) + ' との契約を切る',
            '<p class="desc">残り <b>' + cur.left + 'シーズン</b>ぶんの違約金として ' +
            '<b>💰' + money(fee) + '万</b> がいります。<br>' +
            '切ると、装備の値段と維持費はもとの言い値に戻ります。</p>', [
              { label: '💰' + money(fee) + '万 払って切る', cls: 'primary',
                fn: () => {
                  if (S.dropSupply(g, key) == null) { U.toast('資金が足りません', 'bad'); return; }
                  U.log(g, '🏭 ' + d.name + ' との契約を解消した（違約金 -' + money(fee) + '万）', 'warn');
                  U.toast('🏭 ' + d.name + ' と解約', 'warn');
                  GP.sound.play('no');
                  S.save(g); render(); cmdSponsor();
                } },
              { label: 'やめておく', fn: cmdSponsor }
            ]);
          return;
        }
        if (!S.signSupply(g, key)) return U.toast('いまは契約できません', 'bad');
        U.log(g, '🏭 ' + d.name + ' とサプライヤー契約を結んだ（購入 -' +
          Math.round(d.buy * 100) + '%／維持費 -' + Math.round(d.keep * 100) + '%）', 'good');
        U.toast('🏭 ' + d.name + ' と契約！', 'good');
        GP.sound.play('buy');
        S.save(g); render(); cmdSponsor();
      };
    });
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

  /* ---- 難易度の付け替え（調整用）----
     いまは中身を見ながら手で試せるように出してある。
     効き目は「いまこの瞬間から」変わるだけで、
     これまでに積み上げたものはそのまま残る。               */
  function diffSwitchHTML() {
    const cur = S.diffOf(g);
    return '<div class="sub">⚙️ 難易度</div>' +
      '<p class="desc">いまは <b>' + cur.icon + cur.name + '</b>。' +
      '切り替えると、この先の<b>ライバルの強さ・開発の伸び・賞金・維持費・修理費</b>が変わります。' +
      'ここまでの資金や成績はそのままです。<em>（調整用の機能です）</em></p>' +
      '<div class="pick diffpick">' +
      D.DIFFICULTIES.map(d =>
        '<button class="pickbtn' + (d.key === cur.key ? ' on' : '') + '" data-diff="' + d.key + '"' +
        (d.key === cur.key ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:' + d.color + '">' + d.icon + '</span>' +
        '<span class="pb-body"><b>' + d.name + '</b><small>' + esc(d.short) +
        '<br><em>ライバルの土台 ×' + d.rivalPower.toFixed(2) +
        '／開発 ×' + d.dev.toFixed(2) +
        '／賞金 ×' + d.prize.toFixed(2) +
        '／維持費 ×' + (d.upkeep || 1).toFixed(2) + '</em></small></span>' +
        '<span class="pb-cost">' + (d.key === cur.key ? 'いま' : '切替') + '</span></button>').join('') +
      '</div>';
  }

  function cmdInfo() {
    let body = stakeBlock(false);
    body += mgmtReportHTML();
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
    body += diffSwitchHTML();
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
    // 難易度の付け替え（調整用）
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-diff]'), b => {
      b.onclick = () => {
        const d = D.DIFFICULTIES.find(x => x.key === b.dataset.diff);
        if (!d) return;
        g.mode = d.key;
        S.save(g);
        GP.sound.play('confirm');
        U.toast(d.icon + ' 難易度を「' + d.name + '」にしました', 'good');
        U.log(g, '⚙️ 難易度を ' + d.name + ' に変更した', 'warn');
        render(); cmdInfo();
      };
    });
  }
  return {
    name: 'biz',
    link: link,
    setG: function (v) { g = v; },
    api: { cmdSponsor: cmdSponsor, perkChip: perkChip, doSign: doSign, cmdOwner: cmdOwner, grantFame: grantFame, cmdInfo: cmdInfo, techReport: techReport }
  };
};

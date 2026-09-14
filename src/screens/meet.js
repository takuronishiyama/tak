/* =========================================================
   画面：首脳陣と話す

   これまでは、何をすればいいかを自分でメニューから探すしかなかった。
   ところがレース間の準備週は3週しかないのに、週を使う行動は16本ある。
   16本のうち1本を引いているだけになるので、
   何が効いたのかがいつまでも分からない。

   そこで、見ている人に聞けるようにする。
   4人の首脳がそれぞれの持ち場の数字を読んで、
   「いまここが弱い」「こうしたい」と言ってくる。
   プレイヤーは、それに乗るか、別の向きを指示するかを決める。

   台詞はぜんぶ、その場の数字から作る。
   定型文にすると2周目から読まれなくなるので、
   「上位5チームの平均より 14% 低い」まで言い切る。
   ========================================================= */
window.GP = window.GP || {};
GP.screens = GP.screens || {};

GP.screens.meet = function (A) {
  'use strict';
  const D = GP.data, S = GP.state, U = GP.ui;
  let g = null;
  let $, esc, money, render, bindAct;
  function link() {
    $ = A.$;
    esc = A.esc;
    money = A.money;
    render = A.render;
    bindAct = A.bindAct;
  }

  const pct = v => Math.round(v * 100);
  const sign = v => (v >= 0 ? '+' : '') + v;

  /* ---- 役職に就いている人 ---- */
  function whoOf(key) {
    const m = (g.managers || {})[key];
    const def = D.MANAGERS.filter(x => x.key === key)[0];
    return { def: def, person: m || null, skill: S.mgr(g, key) };
  }

  /* =======================================================
     🔬 開発責任者 ── 車のこと
     ライバル上位の平均と、いまの車を軸ごとに並べる。
     「ここが弱い」を数字で言えるだけの材料は、もう揃っている
     ======================================================= */
  function techReport2() {
    const w = whoOf('technical');
    const t = S.trackAt(g, g.nextRace);
    const mine = S.carStats(g);
    /* rivalTrends() は画面用のHTMLを返すので、ここでは使えない。
       ライバルの素のデータから、自分で並べ直す                  */
    const rows = (g.rivals || []).filter(r => r && r.stats);
    // 上位5チームの平均。ここが「世間の水準」
    const top = rows.slice()
      .sort((a, b) => S.carScoreOf(b.stats, t) - S.carScoreOf(a.stats, t))
      .slice(0, 5);
    const AX = [['speed', '直線'], ['corner', 'コーナー'], ['accel', '加速']];
    const gaps = AX.map(ax => {
      const avg = top.length
        ? top.reduce((a, r) => a + (r.stats[ax[0]] || 0), 0) / top.length : 0;
      const me = mine[ax[0]] || 0;
      return { key: ax[0], name: ax[1], me: me, avg: avg,
               rel: avg > 0 ? (me - avg) / avg : 0 };
    }).sort((a, b) => a.rel - b.rel);
    const worst = gaps[0], best = gaps[gaps.length - 1];

    const it = S.integrateRate(g);
    const step = S.autoIntStep(g);
    const plan = S.intPlanOf(g);
    // いちばん薄い車体項目
    const thin = D.BODY_ATTRS.map(a => {
      const cap = Math.max(1, S.bodyCapOf(g, a.key));
      return { a: a, r: ((g.body && g.body[a.key]) || 0) / cap };
    }).sort((x, y) => x.r - y.r)[0];

    const lines = [];
    if (top.length) {
      lines.push(['上位5チームとの差',
        gaps.map(x => x.name + ' <b class="' + (x.rel < -0.03 ? 'down' : x.rel > 0.03 ? 'up' : '') + '">' +
          sign(pct(x.rel)) + '%</b>').join('　')]);
    }
    lines.push(['つなぎ込み', '<b>' + pct(it.rate) + '%</b>　今週ぶん <b class="up">+' +
      step.toFixed(1) + '</b>（' + plan.icon + plan.name + '）']);
    if (thin) {
      lines.push(['いちばん薄いところ',
        thin.a.icon + ' <b>' + thin.a.name + '</b>（' + pct(thin.r) + '%）']);
    }

    /* 席が空いていても、数字は読める。
        「空席です」だけ返すと、はじめたばかりの人には
        4人とも同じことしか言わない画面になってしまう        */
    const vac = w.person ? '' :
      '（この席はまだ空いています。迎えると部門の出す力そのものが上がります）';
    let say;
    if (!top.length) {
      say = 'まだ比べる相手のデータが足りません。数戦を走ればはっきりします。';
    } else if (worst.rel < -0.05) {
      say = '上位5チームの平均と比べて、<b>' + worst.name + 'が ' + Math.abs(pct(worst.rel)) +
            '% 低い</b>です。いまは' + plan.name + '方向で進めています。' +
            (plan.key === 'thin'
              ? 'このまま穴を埋めていけば、どのコースでも戦えるようになります。'
              : '尖らせる方向なので、' + worst.name + 'の差はしばらく開いたままになります。');
    } else if (best.rel > 0.05) {
      say = '弱点らしい弱点はありません。<b>' + best.name + 'が平均より ' + pct(best.rel) +
            '% 高い</b>ので、ここをさらに伸ばして武器にするのも手です。';
    } else {
      say = 'どの軸も平均並みです。いまは' + plan.name + '方向。' +
            'どちらへ振るかで、この先の性格が決まります。';
    }

    return {
      key: 'technical', who: w, mood: worst && worst.rel < -0.12 ? 'bad'
        : worst && worst.rel < -0.05 ? 'warn' : 'good',
      head: worst && top.length
        ? worst.name + ' が ' + (worst.rel < 0 ? '-' : '+') + Math.abs(pct(worst.rel)) + '%'
        : 'つなぎ込み ' + pct(it.rate) + '%',
      say: say + (vac ? '<br><b class="down">' + vac + '</b>' : ''), lines: lines,
      acts: [
        { key: 'thin', icon: '🩹', label: '弱いところを埋めよう',
          note: '穴をなくす。どのコースでも戦える車になります',
          on: plan.key === 'thin',
          fn: () => setPlan('thin') },
        { key: 'edge', icon: '🔥', label: '強みを伸ばそう',
          note: '尖らせる。合うコースでは上位と殴り合えます',
          on: plan.key === 'edge',
          fn: () => setPlan('edge') }
      ]
    };
  }
  function setPlan(k) {
    g.intPlan = k;
    const pl = S.intPlanOf(g);
    GP.sound.play('confirm');
    U.log(g, '🔬 開発責任者に「' + pl.name + '」で進めるよう伝えた。');
    U.toast(pl.icon + ' ' + pl.name, 'good');
    S.save(g); render(); U.closePopup(); cmdMeet();
  }

  /* =======================================================
     🔧 ピットクルーチーフ ── 現場のこと
     ======================================================= */
  function pitReport() {
    const w = whoOf('pitchief');
    const cw = S.crewPenalty(g);
    const lvl = Math.round(cw.level);
    const o = S.org(g);
    const stand = S.pitCrew(g).stand;
    const lines = [
      ['クルーの疲労', '<b class="' + (lvl >= 70 ? 'down' : lvl >= 45 ? '' : 'up') + '">' +
        lvl + ' / 100</b>　ピット +' + cw.pit.toFixed(1) + '秒／作業ミス ' +
        (cw.mistake * 100).toFixed(1) + '%'],
      ['ピット静止', '<b>' + stand.toFixed(2) + '秒</b>'],
      ['部門の厚み', '🔩クルー <b>' + o.dept.mechanic.toFixed(1) + '</b>' +
        '　🧠作戦 <b>' + o.dept.strategist.toFixed(1) + '</b>']
    ];
    const vac = w.person ? '' :
      '（この席はまだ空いています。迎えると現場ごと底上げされます）';
    let say;
    if (lvl >= 70) {
      say = '<b>クルーが限界です</b>（疲労 ' + lvl + '）。この状態だと、' +
            'ピットで ' + cw.pit.toFixed(1) + '秒 余計にかかり、作業ミスも ' +
            (cw.mistake * 100).toFixed(1) + '% 出ます。1週でいいので休ませてください。';
    } else if (lvl >= 45) {
      say = '疲れが見えてきました（' + lvl + '）。まだ走れますが、' +
            '遠いレースが続くようなら、どこかで休ませたいところです。';
    } else if (o.dept.mechanic < 3) {
      say = 'クルーの頭数が足りません（厚み ' + o.dept.mechanic.toFixed(1) + '）。' +
            '人を入れれば静止時間が縮みます。いまは ' + stand.toFixed(2) + '秒。';
    } else {
      say = '現場は問題ありません。疲労 ' + lvl + '、静止 ' + stand.toFixed(2) + '秒。' +
            'このまま行けます。';
    }
    return {
      key: 'pitchief', who: w,
      mood: lvl >= 70 ? 'bad' : lvl >= 45 ? 'warn' : 'good',
      head: '疲労 ' + lvl + ' ／ 静止 ' + stand.toFixed(2) + '秒',
      say: say + (vac ? '<br><b class="down">' + vac + '</b>' : ''), lines: lines,
      acts: [
        { key: 'rest', icon: '☕', label: '休ませよう', note: '1週使って、人を休ませます',
          fn: () => { U.closePopup(); U.closeModal(); if (A.cmdRest) A.cmdRest(); } },
        { key: 'hr', icon: '👥', label: '人を入れよう', note: '人事へ。現場の部門を厚くします',
          fn: () => { U.closePopup(); U.closeModal(); if (A.cmdStaff) A.cmdStaff(); } }
      ]
    };
  }

  /* =======================================================
     🚚 ロジスティクス責任者 ── 運ぶことと、かかる金
     ======================================================= */
  function logiReport() {
    const w = whoOf('logistics');
    const fin = S.finances(g);
    const track = S.trackAt(g, g.nextRace);
    const risk = S.logiRisk(g, track);
    const ship = S.logiCost(g, track);
    const people = fin.staff + fin.managers + fin.drivers + fin.youth;
    const share = fin.weekly > 0 ? people / fin.weekly : 0;
    const lines = [
      ['週の固定費', '<b>💰' + money(fin.weekly) + '万</b>' +
        (fin.cut > 0 ? '（あなたの働きで -' + pct(fin.cut) + '%）' : '')],
      ['うち人件費', '<b>💰' + money(people) + '万</b>（' + pct(share) + '%）'],
      ['次戦 ' + esc(track.name), '輸送費 <b>💰' + money(ship) + '万</b>／遅延 <b class="' +
        (risk > 0.18 ? 'down' : risk > 0.08 ? '' : 'up') + '">' + pct(risk) + '%</b>']
    ];
    const vac = w.person ? '' :
      '（この席はまだ空いています。埋めるだけで固定費が何％か削れます）';
    let say;
    if (risk > 0.18) {
      say = '次は ' + track.name + '。いまの手配だと<b>遅延の危険が ' + pct(risk) +
            '%</b> あります。遅れると現地の支度が間に合いません。運びかたを見直しませんか。';
    } else if (share > 0.62) {
      say = '固定費の <b>' + pct(share) + '% が人件費</b>です。' +
            '頭数の割に稼げていないなら、どこかで整理が要ります。';
    } else if (ship > fin.weekly * 2.2) {
      /* 収支ぜんたいはプリンシパルの持ち場。
         ここは「運ぶこと」だけを見る。同じ話を二人にさせない */
      say = '次の ' + track.name + ' は遠いです。輸送費だけで <b>💰' + money(ship) +
            '万</b>、週の固定費 ' + Math.round(ship / Math.max(1, fin.weekly) * 10) / 10 +
            '週ぶんにあたります。積荷を軽くすれば、そのぶん浮きます。';
    } else {
      say = '運びは問題ありません。次戦の輸送費 💰' + money(ship) + '万、遅延 ' + pct(risk) +
            '%。積荷も編成も、いまの手配で足ります。';
    }
    return {
      key: 'logistics', who: w,
      mood: risk > 0.18 ? 'bad' : (share > 0.62 || ship > fin.weekly * 2.2) ? 'warn' : 'good',
      head: '固定費 💰' + money(fin.weekly) + '／週　遅延 ' + pct(risk) + '%',
      say: say + (vac ? '<br><b class="down">' + vac + '</b>' : ''), lines: lines,
      acts: [
        { key: 'logi', icon: '🚚', label: '手配を見直す', note: '遠征へ。運びかた・積荷・編成',
          fn: () => { U.closePopup(); U.closeModal(); if (A.cmdLogi) A.cmdLogi(); } }
      ]
    };
  }

  /* =======================================================
     👔 チームプリンシパル ── チーム全体
     ======================================================= */
  function bossReport() {
    const w = whoOf('principal');
    const fin = S.finances(g);
    const room = S.staffRoom(g);
    const slots = S.staffSlots(g);
    const have = (g.staff || []).length;
    // いちばん低い施設。ここが足を引っぱっている
    const low = D.FACILITIES.map(f => ({ f: f, lv: g.facilities[f.key] || 0 }))
      .sort((a, b) => a.lv - b.lv)[0];
    const lines = [
      ['資金', '<b>💰' + money(g.funds) + '万</b>　1戦あたり <b class="' +
        (fin.net < 0 ? 'down' : 'up') + '">' + sign(money(fin.net)) + '万</b>'],
      ['スタッフ', '<b>' + have + ' / ' + slots + '席</b>' +
        (room > 0 ? '（あと ' + room + '人 置けます）' : '（満席）')],
      ['いちばん低い施設', low ? low.f.icon + ' <b>' + low.f.name + ' Lv.' + low.lv + '</b>' : '—']
    ];
    const vac = w.person ? '' :
      '（この席はまだ空いています。チームの顔がいないぶん、収入も注目度も伸びません）';
    let say;
    if (g.funds < fin.weekly * 6) {
      say = '<b>資金が心もとない</b>（💰' + money(g.funds) + '万／週 ' +
            money(fin.weekly) + '万）。あと ' + Math.floor(g.funds / Math.max(1, fin.weekly)) +
            '週ぶんしかありません。まず稼ぐほうを。';
    } else if (fin.net < 0) {
      say = '1戦あたり <b class="down">' + money(fin.net) + '万</b>の赤字で回しています。' +
            '走るほど痩せるので、スポンサーを増やすか、身軽にするかです。';
    } else if (room > 2) {
      say = '席が <b>' + room + '人ぶん空いています</b>。施設を広げたのに人を入れていません。' +
            '空けておくだけでは何も起きません。';
    } else if (room <= 0) {
      say = '席が埋まりました（' + have + '/' + slots + '）。' +
            'これ以上入れるには、' + (low ? low.f.icon + low.f.name + 'あたりから' : '施設を') +
            '広げる必要があります。';
    } else if (low && low.lv <= 1) {
      say = low.f.icon + '<b>' + low.f.name + 'がまだ Lv.' + low.lv + '</b>です。' +
            esc(low.f.desc) + '——ここが足を引っぱっています。';
    } else {
      say = 'チームは回っています。資金 💰' + money(g.funds) + '万、1戦あたり +' +
            money(fin.net) + '万。次に効くのは' +
            (low ? low.f.icon + low.f.name + 'の拡張' : '人の補強') + 'あたりです。';
    }
    return {
      key: 'principal', who: w,
      mood: (g.funds < fin.weekly * 6 || fin.net < 0) ? 'bad' : room > 2 ? 'warn' : 'good',
      head: '💰' + money(g.funds) + '万　1戦 ' + sign(money(fin.net)) + '万',
      say: say + (vac ? '<br><b class="down">' + vac + '</b>' : ''), lines: lines,
      acts: [
        { key: 'biz', icon: '📣', label: '営業へ', note: 'スポンサーを増やす',
          fn: () => { U.closePopup(); U.closeModal(); if (A.cmdSponsor) A.cmdSponsor(); } },
        { key: 'fac', icon: '🏗️', label: '施設へ', note: '広げる・備品を入れる',
          fn: () => { U.closePopup(); U.closeModal(); if (A.cmdFacility) A.cmdFacility(); } }
      ]
    };
  }

  function reports() {
    return [techReport2(), pitReport(), logiReport(), bossReport()];
  }

  /* =======================================================
     画面
     ======================================================= */
  function cmdMeet() {
    const list = reports();
    const bad = list.filter(r => r.mood === 'bad').length;
    let body =
      '<p class="lead">それぞれの持ち場を見ている人に、いま何が起きているかを聞きます。<br>' +
      '<b>週は進みません。</b>何度でも聞けます。</p>' +
      (bad ? '<p class="note"><b class="warn">' + bad +
             '人が「まずい」と言っています。</b>赤い札から見てください。</p>' : '') +
      '<div class="pick">';
    list.forEach(r => {
      const m = r.who.def;
      body += '<button class="pickbtn mgrtalk ' + r.mood + '" data-talk="' + r.key + '">' +
        '<span class="pb-ic" style="background:#5a6270">' + m.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(m.name) +
        (r.who.person ? '　<em class="mgrnm">' + esc(r.who.person.name) + '</em>'
                      : '　<em class="warn">空席</em>') + '</b>' +
        '<small><b class="talkhead">' + r.head + '</b><br>' +
        esc(r.say.replace(/<[^>]+>/g, '')).slice(0, 58) + '…</small></span>' +
        '<span class="pb-cost">›</span></button>';
    });
    body += '</div>';
    U.modal('🗣️ 首脳陣に聞く', body, [{ label: '閉じる', fn: U.closeModal }]);
    bindAct('data-talk', k => openTalk(k));
  }

  function openTalk(key) {
    const r = reports().filter(x => x.key === key)[0];
    if (!r) return;
    const m = r.who.def;
    let h = '<div class="popsum"><span class="pb-ic" style="background:#5a6270">' + m.icon +
      '</span><span class="popsum-b"><b>' + esc(m.name) + '</b><small>' +
      (r.who.person ? esc(r.who.person.name) + '　技能 ' + Math.round(r.who.skill)
                    : '空席') + '</small></span></div>' +
      '<div class="mgrsay ' + r.mood + '">' + r.say + '</div>';
    r.lines.forEach(l => {
      h += '<div class="popcost"><span>' + l[0] + '</span><span>' + l[1] + '</span></div>';
    });
    if (r.acts && r.acts.length) {
      h += '<div class="sub small">どうしますか</div><div class="pick">';
      r.acts.forEach(a => {
        h += '<button class="pickbtn' + (a.on ? ' on' : '') + '" data-mgract="' + a.key + '">' +
          '<span class="pb-ic" style="background:#5a6270">' + a.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(a.label) +
          (a.on ? '　<em class="free">いまこれ</em>' : '') + '</b>' +
          '<small>' + esc(a.note) + '</small></span>' +
          '<span class="pb-cost">›</span></button>';
      });
      h += '</div>';
    }
    const box = U.popup(m.icon + ' ' + m.name, h,
      [{ label: '戻る', cls: 'primary', fn: () => { GP.sound.play('tap'); U.closePopup(); } }]);
    Array.prototype.forEach.call(box.querySelectorAll('[data-mgract]'), b => {
      b.onclick = () => {
        GP.sound.play('tap');
        const a = r.acts.filter(x => x.key === b.dataset.mgract)[0];
        if (a) a.fn();
      };
    });
  }

  return {
    name: 'meet',
    link: link,
    setG: function (v) { g = v; },
    api: { cmdMeet: cmdMeet, openTalk: openTalk, mgrReports: reports }
  };
};

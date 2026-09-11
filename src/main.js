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
     画面ごとのモジュール
     main.js がひとつのファイルとして大きくなりすぎたので、
     画面の単位で src/screens/ に切り出している。
     切り出したコードは中身を変えていない。かわりに、
     ほかの画面から借りている名前だけを link() で受け取る。

     A は、その受け渡しのための場所。
     ・各モジュールは自分の api を A に生やす
     ・main.js が持っているものも A に載せる
     ・そのあと全モジュールの link() を呼ぶと、名前がつながる
     g だけは持ち替えが起きるので、syncG() で配り直す。
     ======================================================= */
  const A = {};
  const SCREENS = [];

  function installScreens() {
    Object.keys(GP.screens || {}).forEach(k => {
      const m = GP.screens[k](A);
      SCREENS.push(m);
      Object.keys(m.api).forEach(n => { A[n] = m.api[n]; });
    });
    // main.js 側に残っているもの
    const mine = {
      $: $, money: money, esc: esc, bindPick: bindPick, endWeek: endWeek,
      render: render, capSpend: capSpend, levelCheck: levelCheck,
      staffExp: staffExp, staffExpAll: staffExpAll,
      interiorHTML: interiorHTML, paintInterior: paintInterior,
      isRaceWeek: isRaceWeek, rivalTrends: rivalTrends,
      nextSeason: nextSeason, gameOver: gameOver, announceGen: announceGen,
      syncG: syncG
    };
    Object.keys(mine).forEach(n => { A[n] = mine[n]; });
    SCREENS.forEach(m => m.link());
    /* ヘルプの飛び札（ui.js の受け口）から呼べるようにしておく。
       画面ごとに配線しないで済ませるための、ただ1本の口 */
    GP.app = A;
    syncG();
  }
  /* g を持ち替えたら、各画面にも配り直す */
  function syncG() { SCREENS.forEach(m => m.setG(g)); }

  /* =======================================================
     週の進行
     ======================================================= */
  /* レース週かどうか。「ちょうどその週」ではなく「その週以降」で見る。
     何かの拍子に週を跨いでしまった保存データでも、決勝に行けるようにする
     （以前は === だったため、跨ぐと二度とレースに行けなくなっていた）  */
  /* 縦向きのときだけ出る案内。一度閉じたら、その端末では出さない */
  (function () {
    const tip = document.getElementById('rotateTip');
    const x = document.getElementById('rotateTipX');
    if (!tip || !x) return;
    try { if (localStorage.getItem('gp-rotate-ok')) tip.style.display = 'none'; } catch (e) {}
    x.onclick = () => {
      tip.style.display = 'none';
      try { localStorage.setItem('gp-rotate-ok', '1'); } catch (e) {}
      measureTop();
    };
  })();

  /* ---- 上部バーの高さを、CSS に渡す ----
     お知らせの札を「だいたいこのへん」で下げていたので、
     案内が1本増えたスマートフォンでは、
     出たお知らせが資金や研究の数字にかぶっていた。
     決め打ちをやめて、実際に測った高さのぶんだけ下げる。      */
  function measureTop() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const b = bar.getBoundingClientRect().bottom;
    document.documentElement.style.setProperty('--topH', Math.max(0, Math.round(b)) + 'px');
  }
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(measureTop);
    const bar = document.querySelector('.topbar');
    if (bar) ro.observe(bar);
    const tip2 = document.getElementById('rotateTip');
    if (tip2) ro.observe(tip2);
  }
  window.addEventListener('resize', measureTop);
  window.addEventListener('orientationchange', () => setTimeout(measureTop, 120));
  measureTop();

  /* 遊びかた。どの画面からでも、上部バーの ❓ で開く */
  (function () {
    const hb = document.getElementById('tHelp');
    if (hb) hb.onclick = () => A.cmdHelp();
  })();

  function isRaceWeek() { return g.nextRace < D.RACES && g.week >= S.raceWeek(g.nextRace); }

  function endWeek() {
    A.crunchConsume(true);
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
    g.rp += 2 + Math.round(S.analystPower(g));
    // ライバルも毎週マシンを煮詰めている
    S.developRivals(g);
    // 講習に出している人が、そろそろ戻ってくる
    S.tickSchool(g).forEach(d => {
      U.log(g, d.course.icon + ' ' + d.name + ' が「' + d.course.name + '」から戻った（技能 +' +
        d.up + (d.trait ? '／' + d.trait.icon + d.trait.name + ' を身につけた' : '') +
        (d.fia ? '／競技団体との関係 +' + d.fia : '') + '）', 'good');
      U.toast(d.course.icon + ' ' + d.name + ' が戻った（技能 +' + d.up + '）', 'good');
    });
    // こちらが配っているなら、渡したぶんが毎週相手に届く
    const gave = S.tickCustomers(g);
    if (gave.length) {
      const big = gave.filter(x => x.step >= 1.0);
      if (big.length) {
        U.log(g, '🔌 ' + big.map(x => x.team).join('・') +
          ' に回した最新仕様が仕上がった（先方の直線 +' +
          big.map(x => x.step.toFixed(1)).join('／') + '）', 'warn');
      }
    }
    // 供給を受けているなら、供給元が伸ばしたぶんが降りてくる
    const eng = S.tickEngine(g);
    if (eng > 0) {
      U.log(g, '🔌 ' + g.engine.team + ' が持ち込んだ最新仕様が回ってきた（性能 +' +
        eng.toFixed(1) + ' → ' + Math.round(g.equipped.pu.power) + '）', 'good');
    }
    // どこかのチームが何かを掘り当てていたら、そのぶんの報せを出す
    (g.innovLog || []).forEach(n => {
      // 秒数が分からないもの（古いデータ）は、無理に 0.00 秒と書かない
      const amt = n.sec > 0 ? ' 1周あたり約 ' + n.sec.toFixed(2) + '秒 速くなった' : '';
      U.log(g, n.copyOf
        ? '🔬 ' + n.team + ' が ' + n.copyOf + ' の「' + n.what + '」を写してきた。' + amt
        : '🔬 ' + n.team + ' が「' + n.what + '」を投入！' + amt, 'warn');
      U.toast('🔬 ' + n.team + (n.copyOf ? 'も「' : '「') + n.what + '」', 'warn');
    });
    g.innovLog = [];
    // FIA の裁定。掘り当てたものが、そのまま認められるとは限らない
    const tds = g.tdLog || [];
    g.tdLog = [];
    tds.forEach(t => {
      if (t.mine) {
        U.log(g, '⚖️ 「' + t.what + '」について FIA から照会があったが（' + t.why +
          '）、オーナーの顔が利いて不問に付された。', 'good');
        S.pushNews(g, 'tdSafe', t.what);
        U.toast('⚖️ 「' + t.what + '」は不問に', 'good');
      } else if (t.dismissed) {
        U.log(g, '⚖️ ' + t.team + ' の「' + t.what + '」に照会（' + t.why +
          '）。しかし不問に付され、そのまま使い続ける。', 'warn');
      } else {
        U.log(g, '⚖️ FIA が ' + t.team + ' の「' + t.what + '」に裁定（' + t.why +
          '）。次戦から使えなくなり、1周あたり約 ' + t.sec.toFixed(2) + '秒 を失った', 'good');
        U.toast('⚖️ ' + t.team + '「' + t.what + '」が使用禁止に', 'good');
      }
    });
    // 下部組織の若手が育つ
    S.growYouth(g);
    // コンディション変動（放っておけば平常に戻る。悪循環にはまり込まないように）
    const drift = d => { d.form = S.clamp(d.form + (100 - d.form) * 0.14 + S.rnd(-4.5, 5), 62, 122); };
    g.drivers.forEach(d => { drift(d); levelCheck(d); });
    g.rivals.forEach(t => t.drivers.forEach(drift));   // ライバルも同じ条件で
    // ファンの自然減と、話題の風化
    g.fans = Math.max(120, g.fans - Math.round(g.fans * 0.006));
    S.addHype(g, -(g.hype || 0) * 0.035);

    if (g.debrief > 0) g.debrief--;   // 反省会ができるのはレースの次の週まで
    g.yardDone = [];             // 週が変われば、また声をかけて回れる
    GP.base.setYard(isRaceWeek() || g.offseason ? [] : A.yardPeople());
    GP.base.invalidate();
    g.week++;
    g.special = null;
    offerSpecial();
    offerSponsor();

    if (g.week > S.SEASON_WEEKS) return seasonEnd();
    // シーズンの折り返し。工場ごと閉める2週間
    if (S.inSummer(g.week) && g.summerSeason !== g.season) { S.save(g); return doSummerBreak(); }
    S.save(g);
    render();
    if (isRaceWeek()) U.toast('🏁 今週はレースウィーク！', 'good');
    // 審議が来ていれば、その週はそれが出来事になる
    if ((g.tdPending || []).length) return askDirective();
    // 週の終わりの出来事。選ばせるものが出なければ、流れるものを1つ
    if (!choiceEvent()) randomEvent();
  }

  /* =======================================================
     サマーブレイク
     シーズンの折り返しに、工場ごと閉める2週間。
     実際のF1と同じで、ここは走ることも作ることもできない。
     どう過ごすかだけを決めて、後半戦へ向かう。
     ======================================================= */
  const SUMMER_PLANS = [
    { key: 'rest', icon: '🏖️', name: '全員で休む',
      desc: 'ファクトリーの鍵を閉める。誰も何もしない2週間',
      note: 'ドライバーの調子が大きく戻り、スタッフも頭が冴える' },
    { key: 'camp', icon: '🏕️', name: '合同合宿を張る',
      desc: '休みのあいだにドライバーを鍛える。費用がかかる',
      note: '2人の能力が伸びる。ただし休養にはならない' },
    { key: 'work', icon: '🏭', name: 'こっそり手を動かす',
      desc: '閉めたことにして、裏で手を動かす',
      note: 'パーツは伸びるが、人は休めない。見つかれば裁定が待っている' }
  ];

  function doSummerBreak() {
    g.summerSeason = g.season;
    const camp = Math.round(1800 + g.fans * 0.06);
    const rows = SUMMER_PLANS.map(p2 => {
      const cost = p2.key === 'camp' ? camp : 0;
      return {
        label: p2.icon + ' ' + p2.name,
        sub: p2.desc + '<br><em>' + p2.note + '</em>',
        cost: cost,
        disabled: cost > 0 && g.funds < cost,
        fn: () => runSummer(p2.key, cost)
      };
    });
    let body = '<div class="racehead"><b>🏖️ サマーブレイク</b>' +
      '<span>第' + S.SUMMER_AT + '戦まで終了</span></div>' +
      '<p class="lead">シーズンの折り返しです。規則により、これから' +
      '<b>' + S.SUMMER_WEEKS + '週間</b>はファクトリーを閉めなければなりません。' +
      '走ることも、作ることもできません。<br>この2週間をどう使いますか。</p>' +
      '<div class="pick">';
    rows.forEach((r, i) => {
      body += '<button class="pickbtn" data-k="sb:' + i + '"' + (r.disabled ? ' disabled' : '') + '>' +
        '<span class="pb-body"><b>' + r.label + '</b><small>' + r.sub + '</small></span>' +
        '<span class="pb-cost">' + (r.cost ? '💰' + money(r.cost) + '万' : '費用なし') + '</span></button>';
    });
    body += '</div>';
    U.modal('🏖️ サマーブレイク', body, [], { wide: true });
    $('modalClose').style.display = 'none';
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-k^="sb:"]'), b => {
      b.onclick = () => { $('modalClose').style.display = ''; rows[+b.dataset.k.slice(3)].fn(); };
    });
  }

  function runSummer(key, cost) {
    const out = [];
    g.funds -= cost;
    if (key === 'rest') {
      g.drivers.forEach(d => {
        const p2 = S.persOf(d);
        const up = Math.round(S.rnd(14, 24) * p2.rest);
        d.form = S.clamp(d.form + up, 62, 124);
        out.push(d.name + ' 調子 +' + up);
      });
      staffExpAll(14);
      S.addHype(g, -2);
      out.push('スタッフ全員に経験 +14');
    } else if (key === 'camp') {
      g.drivers.forEach(d => {
        const ks = ['speed', 'technique', 'stamina', 'mental'];
        const got = [];
        ks.forEach(k => {
          const up = S.rnd(1.2, 3.4);
          d[k] = S.clamp(d[k] + up, 1, 199);
          got.push({ speed: '速さ', technique: '技術', stamina: '体力', mental: '精神' }[k] +
                    ' +' + up.toFixed(1));
        });
        d.form = S.clamp(d.form + S.rnd(-2, 6), 62, 122);
        out.push(d.name + '：' + got.join('／'));
      });
      staffExpAll(6);
    } else {
      // 閉めたことにして手を動かす。見つかれば裁定が待っている
      let gained = 0;
      D.PART_CATS.forEach(c => {
        const p2 = g.equipped[c.key];
        if (!p2 || (c.key === 'pu' && p2.supplied)) return;
        const up = 3.2 * (1 + S.devPower(g) * 0.10);
        p2.power = Math.round((p2.power + up) * 10) / 10;
        gained += up;
      });
      out.push('パーツの性能 合計 +' + gained.toFixed(1));
      g.drivers.forEach(d => {
        const dn = Math.round(S.rnd(4, 10));
        d.form = S.clamp(d.form - dn, 62, 122);
        out.push(d.name + ' 調子 -' + dn);
      });
      if (Math.random() < 0.34) {
        const fine = Math.round(2600 + g.fans * 0.08);
        g.funds -= fine;
        S.addHype(g, -6);
        out.push('⚖️ 休止期間の作業が発覚。制裁金 -' + money(fine) + '万／注目度 -6');
      } else {
        out.push('⚖️ 今回は誰にも気づかれなかった');
      }
    }
    // 2週間を消化して、後半戦へ
    g.week = S.summerTo() + 1;
    g.yardDone = [];
    S.save(g);
    const p3 = SUMMER_PLANS.find(x => x.key === key);
    U.modal('🏖️ ' + p3.icon + ' ' + p3.name,
      '<p class="lead">' + S.SUMMER_WEEKS + '週間が過ぎ、後半戦が始まります。</p>' +
      '<div class="rewardbox">' + out.map(x => '<div>' + esc(x) + '</div>').join('') + '</div>',
      [{ label: '後半戦へ', cls: 'primary', fn: () => {
        U.closeModal();
        U.log(g, '🏖️ サマーブレイク：' + p3.name, 'good');
        render();
        if (isRaceWeek()) U.toast('🏁 今週はレースウィーク！', 'good');
      } }], { wide: true });
    GP.sound.play('good');
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
  /* ---------- その場で決める小事件 ----------
     結果が流れるだけのイベントとは別に、こちらは選ばせる。
     どちらを選んでも得と損があり、チームの状況で出るものが変わる。   */
  const CHOICES = [
    {
      key: 'expo', p: 0.05, icon: '🎪',
      when: () => g.fans >= 800,
      title: 'ファンイベントの打診',
      text: () => '街の主催者から「週末にファンイベントを開かないか」と話が来た。' +
                  'マシンを持ち出せば人は集まるが、そのぶん整備の手は止まる。',
      opts: () => [
        { label: 'マシンを持ち出す', note: 'ファンが大きく増えるが、パーツが少し傷む',
          run: () => { const f = Math.round(g.fans * 0.09) + 220;
            g.fans += f; S.addHype(g, 3.2); S.wearParts(g, S.rnd(2, 5));
            return '🎪 会場は満員。ファン +' + money(f) + '／注目度 +3.2（パーツは少し傷んだ）'; } },
        { label: 'パネル展示だけにする', note: '無難。少しだけファンが増える',
          run: () => { const f = Math.round(g.fans * 0.02) + 60; g.fans += f;
            return '🎪 落ち着いた催しになった。ファン +' + money(f); } },
        { label: '断る', note: '何も起きない。整備に集中できる',
          run: () => { D.PART_CATS.forEach(c => { const q = g.equipped[c.key];
              if (q) q.cond = S.clamp(q.cond + 4, 10, 100); });
            return '🔧 断ってファクトリーに籠った。パーツのコンディションが整った'; } }
      ]
    },
    {
      key: 'poach', p: 0.05, icon: '📨', when: () => (g.staff || []).length >= 2,
      title: '技術情報の売り込み',
      text: () => 'どこかのチームを辞めた人物から「うちの資料を買わないか」と連絡が来た。' +
                  '中身は本物らしいが、褒められた話ではない。',
      opts: () => [
        { label: '買う（💰2,400万）', note: '研究Pが一気に入る。ただし露見すると評判が落ちる',
          run: () => { if (g.funds < 2400) return '💸 資金が足りず、話は流れた';
            g.funds -= 2400; const r = S.rint(45, 90); g.rp += r;
            if (Math.random() < 0.30) { S.addHype(g, -6); g.fans = Math.max(120, g.fans - Math.round(g.fans * 0.04));
              return '📨 資料は本物だった。研究P +' + r + '…が、噂が広まった（注目度 -6／ファン減）'; }
            return '📨 資料は本物だった。研究P +' + r; } },
        { label: '断る', note: '何も起きないが、筋は通る',
          run: () => { S.addHype(g, 1.2); return '📨 丁重に断った。筋を通す姿勢は伝わったようだ（注目度 +1.2）'; } }
      ]
    },
    {
      key: 'burn', p: 0.05, icon: '🌙', when: () => (g.staff || []).length >= 1,
      title: '現場からの相談',
      text: () => '「このままだと次の週末までに間に合いません」と相談が来た。' +
                  '人を増やすか、今いる面々に踏ん張ってもらうか。',
      opts: () => [
        { label: '応援を呼ぶ（💰1,600万）', note: '金で解決する',
          run: () => { if (g.funds < 1600) return '💸 資金が足りない。頭を下げて回るしかなかった';
            g.funds -= 1600; capSpend(1600);
            D.PART_CATS.forEach(c => { const q = g.equipped[c.key];
              if (q) q.cond = S.clamp(q.cond + 8, 10, 100); });
            return '👥 応援を呼んで間に合わせた。パーツのコンディションが回復（予算 -1,600万）'; } },
        { label: '踏ん張ってもらう', note: '無料だが、クルーが消耗する',
          run: () => { S.restCrew(g, -S.rnd(8, 14));
            staffExp('mechanic', 10);
            return '🌙 徹夜でしのいだ。クルーは疲れたが、現場の経験にはなった'; } }
      ]
    },
    {
      key: 'young', p: 0.04, icon: '🎓',
      when: () => (g.youth || []).length > 0 && g.drivers.length >= 2,
      title: '若手の直訴',
      text: () => '下部組織の ' + esc((g.youth[0] || {}).name || '若手') +
                  ' が「一度でいいから乗らせてください」と言ってきた。',
      opts: () => [
        { label: 'テストに乗せる', note: '大きく伸びるが、マシンを傷めるかもしれない',
          run: () => { const d = g.youth[0];
            ['speed', 'technique'].forEach(k => { d[k] = S.clamp(d[k] + S.rnd(2, 5) * S.potOf(d).growth, 1, 199); });
            if (Math.random() < 0.28) { S.wearParts(g, S.rnd(3, 7));
              return '🎓 ' + d.name + ' は伸びた。ただしマシンを少し傷めた'; }
            return '🎓 ' + d.name + ' がテストで大きく伸びた！'; } },
        { label: 'まだ早いと諭す', note: '本人は納得しないが、マシンは無事',
          run: () => { const d = g.youth[0];
            d.mental = S.clamp(d.mental + S.rnd(2, 4), 1, 199);
            return '🎓 ' + d.name + ' は悔しがったが、そのぶん芯が強くなった（精神 +）'; } }
      ]
    },
    {
      key: 'title', p: 0.04, icon: '📺', when: () => (g.hype || 0) >= 30,
      title: '密着取材の申し込み',
      text: () => 'テレビ局から「1週間、チームに張り付かせてほしい」と依頼が来た。' +
                  '露出は大きいが、現場は落ち着かなくなる。',
      opts: () => [
        { label: '受ける', note: '注目度とファンが大きく伸びるが、開発が乱れる',
          run: () => { S.addHype(g, 9); const f = Math.round(g.fans * 0.10) + 300; g.fans += f;
            const c = S.pick(D.PART_CATS); const q = g.equipped[c.key];
            if (q) q.power = Math.max(1, Math.round((q.power - 2) * 10) / 10);
            return '📺 密着が入った。注目度 +9／ファン +' + money(f) + '（開発は少し遅れた）'; } },
        { label: '断る', note: '静かに仕事ができる',
          run: () => { staffExp('engineer', 8); return '📺 断った。現場は落ち着いて仕事ができた'; } }
      ]
    }
  ];

  /* 週の終わりに、選ばせる事件が起きることがある */
  function choiceEvent() {
    if (g.offseason || isRaceWeek()) return false;
    const pool = CHOICES.filter(c => !c.when || c.when());
    for (const c of pool) {
      if (Math.random() >= c.p) continue;
      const opts = c.opts();
      let settled = false;
      const finish = fn => {
        if (settled) return;
        settled = true;
        const msg = fn();
        U.closeModal();
        if (msg) { U.log(g, msg); U.toast(msg); }
        S.save(g); render();
      };
      const body = '<p class="lead">' + c.text() + '</p><div class="pick">' +
        opts.map((o, i) => '<button class="pickbtn" data-k="ce:' + i + '">' +
          '<span class="pb-ic" style="background:#8a6ad0">' + c.icon + '</span>' +
          '<span class="pb-body"><b>' + o.label + '</b><small>' + o.note + '</small></span>' +
          '<span class="pb-cost">選ぶ</span></button>').join('') + '</div>';
      U.modal(c.icon + ' ' + c.title, body, []);
      GP.sound.play('light');
      bindPick(k => finish(opts[+k.split(':')[1]].run));
      // ✕で閉じたときは、いちばん無難な選択（最後の項目）にする
      const prevClose = $('modalClose').onclick;
      $('modalClose').onclick = () => {
        $('modalClose').onclick = prevClose;
        finish(opts[opts.length - 1].run);
      };
      return true;
    }
    return false;
  }

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
    if (isRaceWeek() || g.nextRace >= D.RACES) return;
    if (g.week >= S.SEASON_WEEKS - 1) return;          // 最終盤には来ない
    if (Math.random() > 0.24) return;
    const pool = D.SPECIALS.filter(x => g.season >= x.minSeason);
    if (!pool.length) return;
    const sp = S.pick(pool);
    // 特別戦は、今年やらないコースも含めて一覧から選ぶ
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
    A.beginRace(g.special.trackIndex, sp);
  }

  /* =======================================================
     ライバルの動向
     どのチームがどれだけ伸びたか、どの方向に開発しているかを見る。
     ライバルが毎週マシンを煮詰めているのを、見えるようにする。
     ======================================================= */
  function rivalTrends() {
    const track = S.trackAt(g, g.nextRace);
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
                  // いまの規則をどれだけ読めているか（開発ペースに出る）
                  era: S.eraReadOf(g, r),
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
        '<span class="t-nm">' + esc(r.name) + (st ? ' <em>' + st.icon + st.name + '</em>' : '') +
          (r.era ? ' <em class="erachip" style="color:' + r.era.color + '" title="' +
            'いまの規則をどれだけ読めているか。開発の速さに出ます">' +
            r.era.icon + r.era.name + '</em>' : '') + '</span>' +
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
      '<em>右端はシーズン開始からの伸び</em></div>' +
      '<p class="note">🔥📈⚖️🌫️🧊 は、そのチームが<b>いまの規則をどれだけ読めているか</b>です。' +
      '規則が新しいうちほど当たり外れが大きく、年を追うごとにみな同じ答えへ寄っていきます。' +
      '読み切っているチームは、同じ金をかけても速く育ちます。</p>';
    return h;
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
    A.grantFame(Math.round(Math.max(0, 12 - rank) * D.fameOf('season') +
                         (rank === 1 ? D.fameOf('champion') : 0)), 'シーズンの結果');
    if (myChampPre) A.grantFame(D.fameOf('drvTitle'), 'ドライバーズタイトル');
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
      '勝てば勝つほど次は苦しく、負ければ作り直す時間がもらえる、という制度です。</small></div>' +
      A.aduoBoxHTML(false);
    U.modal('🎊 シーズン終了', body,
      [{ label: '🌱 オフへ →', cls: 'primary', fn: A.enterOffseason }], { wide: true });
    U.log(g, '🎊 シーズン' + g.season + ' 終了。コンストラクターズ ' + rank + '位。賞金 +' + money(prize) + '万', 'good');
  }

  function nextSeason() {
    U.closeModal();
    g.offseason = false;
    g.offTalked = [];
    GP.base.invalidate();
    g.history.push({ season: g.season, points: g.points, rank: S.constructorTable(g).findIndex(r => r.isPlayer) + 1 });
    g.season++;
    /* 今年の顔ぶれを組み直す。走る数は変わらず、大会が入れ替わる。
       抜けた大会と入った大会は、開幕前に知らせる               */
    g.calendar = S.buildCalendar(g);
    {
      const cd = S.calendarDiff(g);
      if (cd.added.length || cd.gone.length) {
        U.log(g, '📅 今季のカレンダーが出た。' +
          (cd.added.length ? '新しく ' + cd.added.map(t => t.country + t.name).join('・') + ' が入り、' : '') +
          (cd.gone.length ? cd.gone.map(t => t.country + t.name).join('・') + ' は今季お休み。' : ''));
      }
    }
    g.week = 1;
    g.aduoLevel = 0; g.aduoNews = null;   // 是正措置は選手権ごとに仕切り直す
    S.restCrew(g, 100);          // オフを挟んでクルーの疲れは抜ける
    S.puReset(g);                // パワーユニットの使用基数も新品から数え直す
    const capRes = S.settleCap(g);   // 予算の精算
    capWarned = false;
    if (capRes) {
      U.log(g, '🧾 予算超過 ' + money(capRes.over) + '万。罰金 -' + money(capRes.fine) +
               '万、来季の風洞時間も削られる。', 'bad');
      U.toast('🧾 予算超過の罰金 -' + money(capRes.fine) + '万', 'bad');
    }
    S.fiaDrift(g);
    S.tickCustomerYears(g).forEach(name => {
      U.log(g, '🔌 ' + name + ' へのパワーユニット供給契約が満了した。', 'warn');
      U.toast('🔌 ' + name + ' への供給が満了', 'warn');
    });
    S.tickSupply(g).forEach(d => {
      U.log(g, '🏭 ' + d.name + ' とのサプライヤー契約が満了した。' +
               '装備の値段と維持費が元に戻る。', 'warn');
      U.toast('🏭 ' + d.name + ' との契約が満了', 'warn');
    });
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
      S.pushNews(g, 'drvOut', d.name);
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
    A.refreshMarkets(true);
    U.log(g, '🚩 シーズン' + g.season + ' 開幕！', 'good');
    GP.sound.play('confirm');
    U.toast('🚩 シーズン' + g.season + ' 開幕！', 'good');
    S.save(g); render();
    if (regChange) {
      const lg = g.legacy;
      U.modal('📜 レギュレーション変更',
        '<p class="lead">新しい規則のもとで、マシンは一から作り直しになりました。</p>' +
        '<div class="rewardbox">' +
        '<div>パーツ・車体 <b>白紙から</b><small>積んだ知見のぶんだけ、ゼロよりは良い所から。レアリティ（到達できる上限）は引き継ぎます</small></div>' +
        (lg && lg.count
          ? '<div>🧰 保管パーツ <b>遺産になった</b><small>' + lg.count + '個をばらして解析。研究P +' + lg.rp +
            (lg.up.length ? '／' + lg.up.map(x => x.cat + ' のレアリティが ★' + x.from + '→★' + x.to).join('、') : '') +
            '</small></div>'
          : '<div>保管パーツ <b>なし</b><small>持っていれば解析して次の規則に活かせました</small></div>') +
        '<div>📐 開発した技術 <b>そのまま</b><small>' +
          (S.techList(g).filter(t => t.lv > 0).map(t => t.icon + t.name + ' Lv.' + t.lv).join('／')
            || 'まだありません。技術は規則が変わっても残る、数少ないものです') + '</small></div>' +
        '<div>施設・スタッフ・ドライバー・ファン・資金・オーナー <b>そのまま</b><small>積み上げたチーム力は失われません</small></div>' +
        '</div>' +
        '<p class="desc">ライバルも同じだけ戻ります。上位と下位の差が一度リセットされ、' +
        'ここからまた作り直しの勝負です。次の変更は ' + S.REG_EVERY + ' シーズン後。</p>' +
        '<p class="desc"><b>🔬 いまがいちばん掘れる年です。</b>新しい規則には、まだ誰も' +
        '見つけていない構造が残っています。改良でブレイクスルーを掘り当てる確率が' +
        '<b>×' + S.innovFresh(g).toFixed(1) + '</b> になり、当たれば熟成が一気に進んで' +
        'パーツの格が早く上がります。ライバルも同じなので、突然1周 0.2〜0.5秒 速くなるチームが' +
        '出はじめます。ここで開発に厚く張れるかが、この4年を決めます。' +
        'ただし灰色の領域が広いぶん、掘り当てたものが<b>あとから裁定で取り上げられる</b>' +
        '確率も、いまがいちばん高くなります。</p>',
        [{ label: 'やってやる', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
      U.log(g, '📜 レギュレーションが変わった。マシンは白紙から作り直し。', 'warn');
      S.pushNews(g, 'reg', '新しい規則');
      GP.sound.play('light');
    }
    if (retired.length) U.toast('引退したドライバーがいます。「人事」で補充しましょう。', 'warn');
  }

  /* ---- 審議の席で出る声 ----
     技術側は見込みをそのまま言う。現場を仕切る側は情でも動くので、
     「勝ち目は薄い」と「それでも戦おう」が同じ席で並ぶことがある。
     決めるのはオーナー——という形にしたい                        */
  function hearingVoices(cs, canPay) {
    const odds = cs.odds / 100;
    // 技術側は、いる人のうちいちばん上の肩書きが答える
    const tm = g.managers && g.managers.technical;
    const an = (g.staff || []).filter(x => x.type === 'analyst' || x.type === 'engineer')
      .sort((a, b) => b.skill - a.skill)[0];
    const techWho = tm ? { icon: '🔬', name: tm.name, role: '開発責任者' }
      : an ? { icon: an.type === 'analyst' ? '📊' : '👷', name: an.name,
               role: (D.STAFF_TYPES.find(t => t.key === an.type) || {}).name || '' }
      : { icon: '🔧', name: '技術スタッフ', role: '' };
    const tier = D.TD.VOICE.tech.find(t => odds >= t.at) ||
                 D.TD.VOICE.tech[D.TD.VOICE.tech.length - 1];
    // 仕切る側。プリンシパルがいればその人、いなければオーナー本人
    const pr = g.managers && g.managers.principal;
    const bossWho = pr ? { icon: '👔', name: pr.name, role: 'チームプリンシパル' }
      : { icon: '🎩', name: (g.owner && g.owner.name) || 'オーナー', role: '' };
    // 争うか引くかは、見込みだけでは決まらない。金の余裕と、気性と、意地
    const ease = canPay ? Math.min(1, g.funds / Math.max(1, cs.fee * 5)) : 0;
    const p = S.clamp(0.15 + odds * 0.70 + ease * 0.20 + S.osk(g, 'nego') * 0.04, 0.05, 0.95);
    const fight = canPay && Math.random() < p;
    const line = S.pick(fight ? D.TD.VOICE.fight : D.TD.VOICE.fold);
    const row = (who, text, cls) =>
      '<div class="hv' + (cls ? ' ' + cls : '') + '">' +
        '<b>' + who.icon + ' ' + esc(who.name) + (who.role ? '<i>' + who.role + '</i>' : '') + '</b>' +
        '<span>' + esc(text) + '</span></div>';
    return '<div class="hvlist">' +
      row(techWho, S.pick(tier.lines), '') +
      row(bossWho, line, fight ? 'go' : 'no') +
      '</div>';
  }

  /* ---- 審議 ----  /* ---- 審議 ----
     照会を抜けてきた件は、受け入れるか、費用を払って争うかを選ぶ。
     争って通れば、以後その件で問われることはなくなる              */
  function askDirective() {
    const cs = (g.tdPending || [])[0];
    if (!cs) return;
    const where = cs.body
      ? '車体の' + ((D.BODY_ATTRS.find(a => a.key === cs.body) || {}).name || '')
      : ((D.PART_CATS.find(c => c.key === cs.cat) || {}).name || '');
    const rp = Math.round(cs.lost * D.TD.refundRp);
    const canPay = g.funds >= cs.fee;
    const body =
      '<p class="lead">FIA が「<b>' + esc(cs.what) + '</b>」の合法性を問うています。</p>' +
      '<div class="rewardbox"><div><b>' + esc(cs.why) + '</b><small>' +
        '認められなければ ' + esc(where) + ' の性能 <b>-' + cs.lost.toFixed(1) + '</b>' +
        (cs.rarUp ? '／パーツの格も1段下がります' : '') + '</small></div></div>' +
      '<div class="tdopt">' +
        '<div class="tdo"><b>🤝 受け入れる</b><small>コンセプトを取り下げます。' +
          'ばらして解析したぶん、研究P <b>+' + rp + '</b> は残ります。</small></div>' +
        '<div class="tdo' + (canPay ? '' : ' off') + '"><b>⚖️ 提訴する（' + money(cs.fee) + '万）</b>' +
          '<small>通る見込み <b>' + cs.odds + '%</b>。通れば<b>そのまま使い続けられ、' +
          'この件で二度と問われません</b>。<br>敗れれば性能は失ったうえ、費用も戻らず、' +
          '解析するひまもありません（研究Pなし）。' +
          (canPay ? '' : '<br><b class="warn">資金が足りません。</b>') + '</small></div>' +
      '</div>' +
      hearingVoices(cs, canPay) +
      '<p class="desc">通る見込みは、オーナーの<b>交渉術</b>と<b>技術眼</b>、そして' +
      'アナリストが積んだ技術的な裏づけで上がります。' +
      '照会の段階で不問に付されるかどうかは、<b>交渉術</b>と<b>知名度</b>しだいです。</p>';
    U.modal('⚖️ テクニカルディレクティブ — 審議', body, [
      { label: '🤝 受け入れる', fn: () => resolveDirective(cs, false) },
      { label: '⚖️ 提訴する（' + money(cs.fee) + '万）', cls: 'primary',
        disabled: !canPay, fn: () => resolveDirective(cs, true) }
    ]);
    GP.sound.play('light');
  }

  function resolveDirective(cs, appeal) {
    const where = cs.body
      ? '車体の' + ((D.BODY_ATTRS.find(a => a.key === cs.body) || {}).name || '')
      : ((D.PART_CATS.find(c => c.key === cs.cat) || {}).name || '');
    const r = appeal ? S.tdAppealNow(g, cs) : S.tdAccept(g, cs);
    g.tdPending = (g.tdPending || []).slice(1);
    U.closeModal();
    if (appeal && r.win) {
      GP.sound.play('levelup');
      U.log(g, '⚖️ 提訴が認められた！「' + cs.what + '」はそのまま使える（費用 -' +
        money(cs.fee) + '万）。この件で問われることはもうない。', 'good');
      S.pushNews(g, 'tdWon', cs.what);
      U.toast('⚖️ 提訴が認められた！', 'good');
      U.pop('⚖️ 不問', 'crit');
    } else {
      GP.sound.play('dnf');
      U.log(g, '⚖️ 「' + cs.what + '」は使用禁止に。' + where + ' の性能 -' + r.lost.toFixed(1) +
        (r.rarDown ? '／パーツの格も1段下がった' : '') +
        (appeal ? '（提訴は退けられ、費用 -' + money(cs.fee) + '万）'
                : '。ばらして解析したぶん 研究P +' + r.rp), 'bad');
      U.toast('⚖️ 「' + cs.what + '」が使用禁止に', 'bad');
      S.pushNews(g, 'tdLost', cs.what);
    }
    S.save(g); render();
    // 続けて審議が残っていれば、次の件へ
    if ((g.tdPending || []).length) setTimeout(askDirective, 500);
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

  function render() {
    U.renderAll(g, specialOf(g));
    A.bindHub();
    const race = isRaceWeek();
    const offs = !!g.offseason;
    $('cmdNormal').style.display = (offs || race) ? 'none' : '';
    $('cmdRace').style.display = (!offs && race) ? '' : 'none';
    // カート場を持っているときだけ、週コマンドに出す
    const kb = $('cKart');
    if (kb) kb.style.display = S.hasEstate(g, 'kart') ? '' : 'none';
    // グリッドに立っている間は、大きなボタンをそのまま決勝への進行にする
    const rg = $('cRaceGo');
    if (rg) {
      const onGrid = !!g.onGrid && !!A.prePack;
      rg.innerHTML = onGrid ? '<span>🚦</span>決勝へ進む！' : '<span>🏁</span>レースへ向かう！';
      rg.classList.toggle('go', onGrid);
    }
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
      cCar: A.cmdCar, cDriver: A.cmdDriverMenu, cMaintain: A.cmdMaintain,
      cSponsor: A.cmdSponsor, cRest: cmdRest,
      cLogi: A.cmdLogi, cLogiR: A.cmdLogi, cLogiO: A.cmdLogi,
      cGarage: A.cmdGarage, cFacility: A.cmdFacility, cStaff: A.cmdStaff, cInfo: A.cmdInfo,
      cRaceGo: A.cmdRace, cGarageR: A.cmdGarage, cStaffR: A.cmdStaff,
      cOffGo: A.doOffNext, cStaffO: A.cmdStaff, cInfoO: A.cmdInfo,
      cGarageO: A.cmdGarage, cFacilityO: A.cmdFacility, cFacilityR: A.cmdFacility,
      cOwner: A.cmdOwner, cOwnerR: A.cmdOwner, cOwnerO: A.cmdOwner,
      cCrunch: A.cmdCrunch, cKart: A.askKart,
      cEngine: A.cmdEngine, cEngineR: A.cmdEngine, cEngineO: A.cmdEngine
    };
    /* いま開いている画面がどのコマンドのものかを控えておく。
       ヘルプへ寄り道したあと、ここへ戻ってこられるようにするため。
       控えたものが実際にモーダルを開いたかどうかは ui.js が見分ける */
    Object.keys(map).forEach(id => {
      const el = $(id);
      if (!el) return;
      el.onclick = function () {
        A.pendingCmd = { fn: map[id], label: (el.textContent || '').replace(/\s+/g, ' ').trim() };
        return map[id].apply(this, arguments);
      };
    });
    $('modalClose').onclick = U.closeModal;
    // 数値は「レース全体を何秒で再生するか」。既定は「ゆっくり」
    /* じっくり（既定）を基準に、そこから3段だけ速くできる。
       数字は「レース全体を何秒で見せるか」 */
    const speeds = { rvSpeed0: 200, rvSpeed1: 110, rvSpeed2: 55, rvSpeed3: 22 };
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
    // 📋 タイミング：全車のセクター・ラップ・ベスト・前車とのギャップ
    const tm = $('rvTiming');
    if (tm) tm.onclick = () => {
      const on = RV.setTiming(!tm.classList.contains('primary'));
      tm.classList.toggle('primary', on);
      GP.sound.play('tap');
    };
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
      syncG();
      U.log(g, '🚩 ' + name + ' が発足！ 目指すは世界の頂点！', 'good');
      U.closeModal(); document.body.classList.remove('preboot'); S.save(g); render();
      U.toast('チーム「' + name + '」発足！', 'good');
    } }];
    if (saved) btns.unshift({ label: '▶ つづきから（S' + saved.season + ' W' + saved.week + '）', cls: 'primary',
      fn: () => { g = saved; syncG(); U.closeModal();
                  document.body.classList.remove('preboot'); render(); } });

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
    // 画面モジュールを先につなぐ。
    // コマンドの割り当ては、つながったあとの関数を見にいくため
    installScreens();
    registerSW();
    bindSkin();
    bindSound();
    bindCommands();
    document.body.classList.add('preboot');
    g = S.newGame('ニューカマーGP', '#e04a3f');   // 仮state（チーム作成までは非表示）
    syncG();
    render();
    showTitle();
    $('modalClose').style.display = 'none';
    const mo = new MutationObserver(() => {
      if ($('modal').className === '') $('modalClose').style.display = '';
    });
    mo.observe($('modal'), { attributes: true, attributeFilter: ['class'] });
  });
})();

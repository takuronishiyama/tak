/* =========================================================
   画面：レース週末（フリー走行・ブリーフィング・予選・決勝）
   main.js から切り出したもの。中身はそのまま動かしていない。
   ほかの画面と共有しているものは、文脈（A）から link() で受け取る。
   ========================================================= */
window.GP = window.GP || {};
GP.screens = GP.screens || {};

GP.screens.weekend = function (A) {
  'use strict';
  const D = GP.data, S = GP.state, U = GP.ui, R = GP.race, RV = GP.raceview;
  let g = null;
  /* ほかの画面と main.js から借りているもの。link() で埋まる */
  let $, askPoach, bindAct, bindPick, bindPuBox, capSpend, cmdGrid, endWeek, esc, grantFame, gridPeople, leaveGrid, levelCheck, money, puBoxHTML, refreshGrid, render, staffExp, staffExpAll, yardMark;
  function link() {
    $ = A.$;
    askPoach = A.askPoach;
    bindAct = A.bindAct;
    bindPick = A.bindPick;
    bindPuBox = A.bindPuBox;
    capSpend = A.capSpend;
    cmdGrid = A.cmdGrid;
    endWeek = A.endWeek;
    esc = A.esc;
    grantFame = A.grantFame;
    gridPeople = A.gridPeople;
    leaveGrid = A.leaveGrid;
    levelCheck = A.levelCheck;
    money = A.money;
    puBoxHTML = A.puBoxHTML;
    refreshGrid = A.refreshGrid;
    render = A.render;
    staffExp = A.staffExp;
    staffExpAll = A.staffExpAll;
    yardMark = A.yardMark;
  }


  /* =======================================================
     パワーユニットの載せ替え
     使い込んだユニットは出力も信頼性も落ちる。新品を入れれば速いが
     基数を1つ食い、上限を超えるとグリッド降格。降ろしたユニットは
     残量があるかぎり取っておけるので、あとでまた積める        */
  /* ---- タイヤの担当範囲 ----
     路面の濡れ具合を 0〜1 で刻み、そのときいちばん速い銘柄を選び直して
     境目を割り出す。数字を手で書かず、実際の計算式から帯を引く       */
  function tyreBandHTML() {
    const D2 = D;
    const lossOf = (ty, w) => {
      const ideal = ty.wetIdeal || 0, tol = ty.wetTol || 0.2;
      const gap = Math.max(0, Math.abs(w - ideal) - tol);
      let m = ty.pace * (1 + (gap <= 0 ? 0
              : gap * D2.WET_MISMATCH + gap * gap * D2.WET_MISMATCH2));
      if (!ty.wet) {
        const dow = Math.max(0, w - D2.ENV.dryWetFrom);
        if (dow > 0) m *= 1 + dow * D2.ENV.dryWetLoss;
      }
      return m;
    };
    const picks = ['medium', 'inter', 'wet'].map(k => D2.TYRES.find(x => x.key === k));
    const label = ['ドライ', 'インター', 'ウェット'];
    const seg = [];
    for (let i = 0; i <= 200; i++) {
      const w = i / 200;
      let bi = 0, bv = Infinity;
      picks.forEach((ty, j) => { const v = lossOf(ty, w); if (v < bv) { bv = v; bi = j; } });
      if (!seg.length || seg[seg.length - 1].i !== bi) seg.push({ i: bi, from: w, to: w });
      seg[seg.length - 1].to = w;
    }
    let bar = '';
    seg.forEach(sg => {
      const wd = (sg.to - sg.from) * 100;
      bar += '<b style="width:' + wd.toFixed(1) + '%;background:' + picks[sg.i].color +
             ';color:' + picks[sg.i].text + '">' + label[sg.i] + '</b>';
    });
    const cross = seg.slice(1).map(sg => Math.round(sg.from * 100));
    return '<div class="sub">タイヤの担当範囲</div>' +
      '<p class="desc">路面の濡れ具合で、いちばん速い銘柄は入れ替わります。' +
      '担当から外れるほど損は加速度的に大きくなり、' +
      '大雨をインターのまま走ると1周で10秒近く失います。' +
      'ドライタイヤで水に乗ると、遅いどころかまともに走れません。<br>' +
      '雨に強いドライバーほど、この範囲が左右に広がります。</p>' +
      '<div class="tband"><div class="tb-bar">' + bar + '</div>' +
      '<div class="tb-scale"><span>乾き</span><span>湿り</span><span>ハーフ</span>' +
      '<span>ウェット</span><span>大雨</span></div>' +
      '<p class="note">切り替わりの目安：濡れ ' + cross.join('% / ') + '%</p></div>';
  }

  /* ---- 決勝の空模様の見通し ----
     予選が終わった時点で、この先どうなりそうかを％で出す。
     当たるかどうかは読みの力しだい。ここを信じてタイヤを賭けられる */
  function forecastHTML(pre) {
    if (!pre || !pre.forecast) return '';
    const f = pre.forecast;
    const wx = pre.weather;
    const pc = Math.round(f.p * 100);
    const fo = Math.round(S.foresightOf(g) * 100);
    const cls = pc >= 65 ? 'hi' : pc >= 35 ? 'mid' : 'lo';
    const wet = f.to && (f.to.key === 'rain' || f.to.key === 'storm');
    return '<div class="sub">🌤️ 決勝の空模様</div>' +
      '<div class="fcbox ' + cls + '">' +
      '<span class="fc-now"><u>スタート時</u><b>' + wx.icon + '</b><span>' + wx.name + '</span></span>' +
      '<span class="fc-arrow">→</span>' +
      '<span class="fc-next"><u>この先</u><b>' + (f.to ? f.to.icon : '☁️') + '</b>' +
      '<span>' + (f.to ? f.to.name : 'くもり') + ' <b>' + pc + '%</b></span></span>' +
      '<small>ピットウォールの読み <b>' + fo + '%</b>' +
      '（🧠ストラテジストと📡天気の設備で上がります）。' +
      '読みが高いほど、この％は本当のことに近づきます。<br>' +
      (pc >= 65
        ? (wet ? '<b class="warn">降る可能性が高い。スタートタイヤを賭けるなら、ここです。</b>'
               : '<b>路面は良くなっていく見込みです。</b>')
        : pc >= 35
        ? '<b>五分に近い。読み違えると大きく損をしますが、当てれば一気に前へ出られます。</b>'
        : 'いまのところ、大きく動く気配はありません。') +
      '</small></div>';
  }

  /* そのチームが機材をどうやって運んできたか。荷が遅れていれば⏳ */
  function logiChip(e) {
    if (!e.logi) return '<span class="gp-lg"></span>';
    return '<span class="gp-lg" title="' + esc(e.logi.name) +
      (e.logiLate ? '／荷の到着が遅れた' : '') + '">' + e.logi.icon +
      (e.logiLate ? '<b class="late">⏳</b>' : '') + '</span>';
  }

  /* ---- 作戦の中身 ----
     「攻める」と「安全第一」が、実際に何を差し引きしているのか。
     言葉だけだと分からないので、そのコースの数字で出す        */
  function stratTableHTML(t, lineup) {
    const base = t.base || 90;
    const d0 = (lineup || [])[0];
    const B = R.STRATEGIES.balance;
    let h = '<div class="strtbl">' +
      '<div class="strow sth"><span>作戦</span><span>1周</span><span>タイヤの減り</span>' +
      '<span>ミス</span><span>クラッシュ</span></div>';
    Object.keys(R.STRATEGIES).forEach(k => {
      const st = R.STRATEGIES[k];
      const sec = base * ((1 - st.pace) - (1 - B.pace));      // 秒／周（− なら速い）
      const miss = 1 + (st.risk - 1) * 0.50;
      h += '<div class="strow">' +
        '<span class="stnm">' + st.icon + ' ' + st.name + '</span>' +
        '<span class="' + (sec < -0.01 ? 'good' : sec > 0.01 ? 'bad' : '') + '">' +
          (Math.abs(sec) < 0.005 ? '±0.00' : (sec < 0 ? '−' : '+') + Math.abs(sec).toFixed(2)) + '秒</span>' +
        '<span class="' + (st.tyre > 1 ? 'bad' : st.tyre < 1 ? 'good' : '') + '">×' + st.tyre.toFixed(2) + '</span>' +
        '<span class="' + (miss > 1 ? 'bad' : 'good') + '">×' + miss.toFixed(2) + '</span>' +
        '<span class="' + (st.risk > 1 ? 'bad' : 'good') + '">×' + st.risk.toFixed(2) + '</span>' +
        '</div>';
    });
    h += '</div>';
    h += '<p class="desc">攻めると 1周ぶん速くなるかわりに、タイヤが早く終わり、' +
      'ミスとクラッシュが増えます。安全第一はその逆です。<br>' +
      'クラッシュの起きやすさは<b>ドライバーの安定感</b>にも直結します' +
      (d0 ? '（' + esc(d0.name) + ' は ' + S.careTier(d0).icon + S.careTier(d0).name +
            '＝クラッシュ ×' + S.careCrashMul(d0).toFixed(2) + '）' : '') + '。<br>' +
      'レース中はこれとは別に、ピットウォールから周ごとの指示（' +
      D.ORDERS.map(o => o.icon + o.name).join('／') + '）が出ます。' +
      '雨や、車に傷を負ったあとは <b>🛡️ 安全第一</b> に切り替わり、' +
      'クラッシュが ×' + (D.ORDERS.filter(o => o.key === 'cool')[0].risk).toFixed(2) + ' まで下がります。</p>';
    return h;
  }

  /* =======================================================
     レース
     ======================================================= */
  let pendingStrategy = {};
  let raceCtx = { trackIndex: 0, special: null };

  function cmdRace() {
    // 予選が終わってグリッドに立っているときは、下のボタンからも決勝へ行ける。
    // ここで週末を頭からやり直すと、走り終えた予選が消えてしまう
    if (g.onGrid && A.prePack) return confirmStart();
    // 第n戦が、コース一覧のどれか。年によって顔ぶれが変わる
    beginRace(S.trackIdx(g, g.nextRace), null);
  }

  /* グリッドの用事を残したまま決勝へ行こうとしたときの確認 */
  function confirmStart() {
    const left = gridPeople().filter(q => q.key !== 'gd:go' && !q.done);
    if (!left.length) return leaveGrid(true);
    U.modal('🚦 スタート進行',
      '<p class="lead">まだグリッドで済ませていない用事があります。</p>' +
      '<div class="cpclist">' + left.map(q =>
        '<span class="cpc">' + esc(q.label || 'グリッド') + '</span>').join('') + '</div>' +
      '<p class="note">このまま決勝を始めると、今日はもう回れません。</p>',
      [{ label: '🚦 決勝を始める', cls: 'primary', fn: () => { U.closeModal(); leaveGrid(true); } },
       { label: 'グリッドへ戻る', fn: () => { U.closeModal(); refreshGrid(); } }]);
  }

  function beginRace(trackIndex, special) {
    const t = D.TRACKS[trackIndex];
    if (g.drivers.length === 0) return U.toast('ドライバーがいません！', 'bad');
    // レース週の朝。体調を崩して走れない人が出ることがある
    if (!raceCtx || raceCtx.trackIndex !== trackIndex || !raceCtx.rolled) {
      // 機材が現地に着いたか。安く運んだ週ほど、荷は遅れる
      if (S.rollLogi(g, t)) {
        U.log(g, '📦 ' + t.name + ' への機材が通関で止まった。金曜の走行がまるまる潰れ、' +
          'マシンは仕上げきれないまま週末に入る。', 'bad');
        U.toast('📦 機材の到着が遅れた！', 'bad');
      }
      // モーターホームがあると、週末のあいだにきちんと休める
      const homeUp = S.kitEff(g, 'home', 'form');
      if (homeUp > 0) {
        g.drivers.forEach(d => { d.form = S.clamp(d.form + homeUp, 62, 122); });
        U.log(g, S.kitOf(g, 'home').tier.icon + ' ' +
          S.kitOf(g, 'home').tier.name + 'で、現地でもきちんと休めた（調子 +' + homeUp + '）');
      }
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
    briefState = null;
    lineup.forEach(d => { pendingStrategy[d.id] = 'balance'; });
    const laps = Math.max(4, Math.round(t.laps * (special ? special.lapMul : 1)));

    let body = '<div class="racehead"><b>' +
      (special ? special.icon + ' ' + esc(special.name) : '第' + (trackIndex + 1) + '戦') + ' ' +
      t.country + ' ' + esc(t.name) + '</b>' +
      '<span>' + laps + '周 ／ ' + esc(t.desc) + '</span></div>';
    if (special) body += '<p class="note">' + esc(special.note) + '</p>';

    // ---- この週末に出ていくお金 ----
    // レースが終わってから請求が来るので、先に見せておく
    {
      const ship = S.logiCost(g, t);
      const pu = S.puOf(g);
      const willBuy = pu.life - S.puWear(g, t, 1) <= 0 && !pu.pool.some(u => u.life >= 30);
      const puCost = willBuy ? S.puFreshCost(g) : 0;
      const weekly = S.finances(g).weekly;
      const bill = ship + puCost + weekly;
      const after = g.funds - bill;
      body += '<div class="billbox' + (after < 0 ? ' bad' : after < bill ? ' warn' : '') + '">' +
        '<b>🧾 この週末に出ていくお金 ' + money(bill) + '万</b>' +
        '<small>🚚 遠征 ' + money(ship) + '万' +
        (puCost ? '／⚙️ 新品PU ' + money(puCost) + '万' : '') +
        '／🏭 運営 ' + money(weekly) + '万　→　残り <b class="' +
        (after < 0 ? 'bad' : 'good') + '">' + money(after) + '万</b>' +
        (after < 0 ? '<br><b class="warn">このままだと資金がマイナスになります。' +
                     '「🚚 遠征」で運びかたと積荷を落とせば減らせます。</b>' : '') +
        '</small></div>';
    }

    // ---- 機材の到着 ----
    if (g.logi && g.logi.late) {
      body += '<div class="pubox pen"><b>📦 機材の到着が遅れた</b>' +
        '<small>通関で止まり、金曜の走行がほとんど使えませんでした。' +
        'セットアップの効果は半分以下、パーツのコンディションも -' + D.LOGI_DELAY_COND +
        '、クルーの疲労も増えています。<br>' +
        '「🚚 遠征」で運びかたと積荷を見直せます。</small></div>';
    }

    // ---- 雨になったときに、誰の判断で走ることになるのか ----
    {
      const f = S.foresightOf(g);
      const strat = (g.staff || []).filter(x => x.type === 'strategist')
        .sort((a, b) => b.skill - a.skill)[0];
      const fName = f >= 0.7 ? '先を読める' : f >= 0.5 ? '読める' : f >= 0.32 ? 'やや後手' : '後手';
      body += '<div class="stratbox">' +
        '<b>🧠 路面を読む力 <em class="' + (f >= 0.5 ? 'good' : f >= 0.32 ? '' : 'bad') + '">' +
        Math.round(f * 100) + '／100（' + fName + '）</em></b>' +
        '<small>' + (strat
          ? 'ストラテジスト ' + esc(strat.name) + '（技能 ' + strat.skill + '）' +
            (g.managers && g.managers.principal ? '' : '') + '。'
          : '<b class="warn">ストラテジストがいません。</b>') +
        '路面がこれからどうなるかを、どこまで織り込んでタイヤを選べるかです。' +
        '読みが浅いと、いまの路面に合わせてしまい、次の周にはもう外しています。<br>' +
        'ひとつは<b>合わないタイヤで走る周</b>が減ること' +
        '（読み20→1.5周／読み46→1.2周／読み61→1.1周）。<br>' +
        'もうひとつは<b>天候が急変したとき、何周後に入るか</b>。飛び込むのが' +
        '早すぎればまだ乾いた路面をウェットで走り、遅すぎれば合わないまま何周も損をします。' +
        '読みが利くほど、その「ちょうどの周」を当てられます' +
        '（急変したレースの平均順位 読み20→4.6位／読み46→4.1位／読み61→4.0位）。</small>' +
        '<div class="wetdrv">' + lineup.map(d => {
          const ws = S.wetSkillOf(d), ts = S.tyreSkillOf(d);
          return '<span><b>' + esc(d.name) + '</b>' +
            '<em>🌧️ 雨 ' + Math.round(ws * 100) + '</em>' +
            '<em>🛞 タイヤ ' + Math.round(ts * 100) + '</em>' +
            (S.hasSkill && S.hasSkill(d, 'rain') ? '<i>雨の魔術師</i>' : '') + '</span>';
        }).join('') + '</div>' +
        '<small>雨適性が高い人は、合わないタイヤでも粘れて、濡れた路面そのものでも速く、ミスも減ります。</small>' +
        '</div>';
    }

    // ---- このコースでピットに入ると、どれだけ失うのか ----
    {
      const pc = S.pitCrew(g);
      const lane = t.pitLane || 18;
      const stand = pc.stand;
      const one = lane + stand;
      const scL = lane * D.PIT_LANE_SC + stand;
      const vscL = lane * D.PIT_LANE_VSC + stand;
      // このコースのピットロードは、全戦のなかでどのくらいか
      const lanes = D.TRACKS.map(x => x.pitLane || 18).sort((a, b) => a - b);
      const rank = lanes.indexOf(lane) + 1;
      const heavy = rank > D.RACES * 0.6;
      body += '<div class="stratbox pitbox">' +
        '<b>🔧 1回のピットで失う時間 <em>' + one.toFixed(1) + '秒</em></b>' +
        '<div class="pitsplit">' +
          '<span class="lane" style="flex:' + lane.toFixed(1) + '">🛣️ ' + lane.toFixed(1) + '秒</span>' +
          '<span class="stand" style="flex:' + Math.max(3.5, stand).toFixed(1) + '">🔧 ' +
            stand.toFixed(1) + '秒</span>' +
        '</div>' +
        '<small>🛣️ <b>ピットロード</b> ' + lane.toFixed(1) + '秒 — 速度制限のなかを走り抜けるぶん。' +
        'コースが決めていて、設備をいくら建てても<b>1秒も縮みません</b>' +
        '（' + (heavy ? '全' + D.RACES + '戦で' + (D.RACES - rank + 1) +
                        '番目に長い＝入るのが重いコース'
                      : '全' + D.RACES + '戦で' + rank +
                        '番目に短い＝入りやすいコース') + '）。<br>' +
        '🔧 <b>静止時間</b> ' + stand.toFixed(1) + '秒 — ジャッキが上がって下りるまで。' +
        'ここだけがピット設備とメカニックで縮みます（しくじる確率 ' +
        (pc.fumble * 100).toFixed(0) + '%）。<br>' +
        '🚨 <b>セーフティカー中なら ' + scL.toFixed(1) + '秒</b>／🟡 バーチャル中なら ' +
        vscL.toFixed(1) + '秒。隊列そのものが遅いので、走るぶんだけが安くなります' +
        '（止まっているぶんは変わりません）。<br>' +
        '1ストップで ' + one.toFixed(1) + '秒、2ストップで ' + (one * 2).toFixed(1) + '秒。' +
        'この差より新しいタイヤで取り返せるかが、ストップ回数の分かれ目です。</small>' +
        '</div>';
    }

    // ---- パワーユニットの状態と載せ替え ----
    body += puBoxHTML(t);

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
    body += stratTableHTML(t, lineup);

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
    body += tyreBandHTML();

    // ---- 予選でタイヤをどう使うか ----
    body += '<div class="sub">予選のタイヤの使いかた</div>' +
      '<p class="desc">週末に持ち込めるドライタイヤは <b>' +
      (D.TYRE_ALLOC.sets.soft + D.TYRE_ALLOC.sets.medium + D.TYRE_ALLOC.sets.hard) +
      'セット</b>（ソフト' + D.TYRE_ALLOC.sets.soft + '／ミディアム' + D.TYRE_ALLOC.sets.medium +
      '／ハード' + D.TYRE_ALLOC.sets.hard + '）。フリー走行と予選で使ったぶんは戻ってきません。<br>' +
      '予選に新品を入れるほど前に出られますが、日曜のタイヤは薄くなります。' +
      '（雨用は別枠なので、この数には入りません）</p>' +
      '<div class="pick qplan" data-qplan="1">';
    D.Q_PLANS.forEach(p => {
      const n = p.newQ.reduce((a, b) => a + b, 0);
      body += '<button class="pickbtn' + (p.key === 'all' ? ' on' : '') + '" data-v="' + p.key + '">' +
        '<span class="pb-ic" style="background:#c0392b">' + p.icon + '</span>' +
        '<span class="pb-body"><b>' + p.name + '</b><small>' + p.desc + '</small></span>' +
        '<span class="pb-cost">新品<br>' + n + '本</span></button>';
    });
    body += '</div>';
    pendingStrategy.qplan = 'all';

    // ---- ピット回数とタイヤの狙い ----
    {
      // このコースを素直に走るなら何回止まるか。ドライバーごとに違う
      const one = (t.pitLane || 18) + S.pitCrew(g).stand;
      const rec = g.drivers.map(d => S.naturalStops(t, laps, t.tyre * S.tyreWear(d)));
      const recTxt = rec.every(x => x === rec[0]) ? rec[0] + 'ストップ'
                   : Math.min.apply(null, rec) + '〜' + Math.max.apply(null, rec) + 'ストップ';
      body += '<div class="sub">ピット作戦</div>' +
        '<p class="desc">1回止まるたびに <b>' + one.toFixed(1) + '秒</b>。' +
        'このコースは' + laps + '周でピットロードが' + (t.pitLane || 18).toFixed(1) + '秒なので、' +
        '素直に走るなら <b>' + recTxt + '</b>（「おまかせ」はこれを選びます）。<br>' +
        'ストップが少ないほど失う秒数は減りますが、区間が長くなるぶん硬くて遅いタイヤになります。' +
        '多いほどやわらかいタイヤで攻められます。</p>';
    }
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
      { label: '🔧 フリー走行へ', cls: 'primary', fn: cmdPractice },
      { label: special ? 'やめておく' : 'まだ準備する', fn: U.closeModal }
    ]);

    // PUの載せ替えは、決めた作戦を残したままボックスだけ差し替える
    (function () {
      const redraw = () => {
        const box = $('modalBody').querySelector('.pubox');
        if (!box) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = puBoxHTML(t);
        box.parentNode.replaceChild(tmp.firstChild, box);
        bindPuBox(redraw);
      };
      bindPuBox(redraw);
    })();

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
    Array.prototype.forEach.call(document.querySelectorAll('[data-qplan]'), wrap => {
      Array.prototype.forEach.call(wrap.children, b => {
        b.onclick = () => {
          Array.prototype.forEach.call(wrap.children, c => c.classList.remove('on'));
          b.classList.add('on');
          pendingStrategy.qplan = b.dataset.v;
          GP.sound.play('tap');
        };
      });
    });
  }

  let currentRes = null, fpPack = null;
  A.prePack = null;           // 予選の結果。グリッドと本拠地の表示からも見る

  /* ---- フリー走行 ----
     限られた走行時間を、何に使うか。ひとつだけ選べる。 */
  const PRACTICE = [
    { k: 'setup', icon: '🔧', label: 'セットアップを詰める', setup: 1.014,
      note: 'マシンの仕上がりが上がる。いちばん素直な使い方',
      run: () => { staffExp('engineer', 10); return 'セットアップが決まった（今日のマシンが少し速い）'; } },
    { k: 'rookie', icon: '🎓', label: 'ルーキーを走らせる', setup: 1.004,
      note: '下部組織の若手に実車を走らせる。そのぶんセットアップは進まない',
      avail: () => (g.youth || []).length > 0,
      run: () => {
        // 乗せるのは自分たちで育てている若手だけ。
        // いちばん若い（=伸びしろの残っている）一人に走らせる
        const d = (g.youth || []).slice().sort((a, b) =>
          (a.age - b.age) || (S.potOf(b).growth - S.potOf(a).growth))[0];
        if (!d) return null;
        const keys = ['speed', 'technique', 'stamina', 'mental'];
        const ups = [];
        keys.forEach(k => {
          if (Math.random() < 0.6) {
            const up = S.rnd(1.4, 3.2) * S.potOf(d).growth;
            d[k] = S.clamp(d[k] + up, 1, 199);
            ups.push({ speed: '速さ', technique: '技術', stamina: '体力', mental: '精神' }[k] + ' +' + up.toFixed(1));
          }
        });
        d.exp = (d.exp || 0) + 20;
        staffExp('trainer', 10);
        return d.name + ' が実車を走らせた（' + (ups.join('／') || '手応えを得た') + '）';
      } },
    { k: 'tyre', icon: '🛞', label: 'タイヤを試す', setup: 1.007,
      note: 'このコースでの摩耗が分かる。ストップ数の読みが正確になる',
      run: () => {
        const t = D.TRACKS[Math.min(raceCtx.trackIndex, D.TRACKS.length - 1)];
        const stops = (t.tyre > 1.05 || t.laps > 28) ? 2 : 1;
        staffExp('strategist', 10);
        g.drivers.forEach(d => { d.technique = S.clamp(d.technique + S.rnd(0.6, 1.6), 1, 199); });
        return 'タイヤの持ちを確かめた（このコースは ' + stops + 'ストップが軸／ドライバーの技術も少し上がった）';
      } },
    { k: 'save', icon: '🛞', label: '走らずにタイヤを残す', setup: 1.000,
      note: 'ほとんどコースに出ない。セットアップは進まないが、日曜に手つかずのタイヤが残る',
      run: () => {
        staffExp('strategist', 6);
        return 'ガレージで過ごした（決勝のタイヤを温存した）';
      } },
    { k: 'long', icon: '📊', label: 'ロングランでデータを取る', setup: 1.005,
      note: '走り込んでデータを集める。研究ポイントが入る',
      run: () => {
        const rp = Math.max(4, Math.round(6 + S.analystPower(g) * 2.4 + S.osk(g, 'eye') * 1.5));
        g.rp += rp;
        staffExp('analyst', 12);
        return 'ロングランのデータが取れた（研究P +' + rp + '）';
      } }
  ];

  /* ---- 週末のタイヤ棚 ----
     いま何本残っていて、そのうち何本が手つかずなのか。
     走り込むほど減るので、金曜の選択が日曜の作戦にそのままつながる */
  function bankHTML(pack, note) {
    const mine = (pack && pack.entries || []).filter(e => e.isPlayer && e.bank);
    if (!mine.length) return '';
    let h = '<div class="sub small">🛞 週末に残っているタイヤ</div>';
    if (note) h += '<p class="desc">' + note + '</p>';
    h += '<div class="tybank">';
    mine.forEach(e => {
      h += '<div class="tb-row"><b>' + esc(e.driver.name) + '</b><span class="tb-sets">';
      S.bankRows(e.bank).forEach(r => {
        const t = D.TYRES.find(x => x.key === r.key);
        h += '<span class="tb-set" style="--tc:' + t.color + ';--tt:' + t.text + '"' +
          ' title="' + esc(t.name) + '"><i>' + t.short + '</i>' +
          '<em class="fresh' + (r.fresh ? '' : ' zero') + '">新' + r.fresh + '</em>' +
          '<em class="used' + (r.used ? '' : ' zero') + '">中' + r.used + '</em></span>';
      });
      h += '</span>';
      // 雨用は別枠。数だけ添えておく
      h += '<span class="tb-wet">' + S.bankRows(e.bank, true).map(r => {
        const t2 = D.TYRES.filter(x => x.key === r.key)[0];
        return '<i style="--tc:' + t2.color + ';--tt:' + t2.text + '">' + t2.short +
               (r.fresh + r.used) + '</i>';
      }).join('') + '</span></div>';
    });
    return h + '</div>';
  }

  /* 予選で走った一本が新品だったか中古だったか */
  function qTyreChip(e, si) {
    const q = e.qTyre && e.qTyre[si];
    if (!q) return '';
    const t = D.TYRES.find(x => x.key === q.key) || D.TYRES[0];
    return '<span class="qty' + (q.fresh ? ' new' : '') + '"' +
      ' style="--tc:' + t.color + ';--tt:' + t.text + '"' +
      ' title="' + (q.fresh ? '新品' : '中古（' + q.age.toFixed(1) + '周ぶん使用済み）') + '">' +
      t.short + (q.fresh ? '' : 'ᵘ') + '</span>';
  }

  /* ---- 金曜に何を履いて走るか ----
     「何を作業するか」とは別の選択。ソフトばかり走れば一発の速さは掴めるが、
     決勝で履く銘柄のことは何も分からないまま日曜を迎える。
     逆に決勝用を走り込めば読みは決まるが、日曜に出てくるのは中古ばかり。 */
  /* その走らせ方で金曜を終えたとき、日曜に新品が何本残るか。
     数字を手で書かず、実際の棚から引き算して出す                 */
  function leftoverHTML(p) {
    const bank = S.newTyreBank();
    S.scrubBank(bank, p.sets, () => D.TYRE_ALLOC.fpLaps);
    // 予選でソフトを3セット使う前提（Q1・Q2・Q3で1本ずつ）
    for (let i = 0; i < 3; i++) S.runSet(bank, 'soft', true, D.TYRE_ALLOC.qLaps);
    return ['soft', 'medium', 'hard'].map(k => {
      const ty = D.TYRES.find(x => x.key === k);
      const n = S.bankFresh(bank, k);
      return '<i class="lo' + (n === 0 ? ' zero' : '') + '" style="background:' +
        ty.color + ';color:' + ty.text + '">' + ty.name.charAt(0) + n + '</i>';
    }).join('');
  }

  function fpTyreHTML() {
    const cur = pendingStrategy.fpt || 'mix';
    const crew = S.readCrew(g);
    let h = '<div class="sub small">🛞 金曜に履くタイヤ</div>' +
      '<p class="desc">週末に持ち込めるドライタイヤは <b>13セット</b>' +
      '（ハード' + D.TYRE_ALLOC.sets.hard + '／ミディアム' + D.TYRE_ALLOC.sets.medium +
      '／ソフト' + D.TYRE_ALLOC.sets.soft + '）。' +
      '雨用はインター' + D.TYRE_ALLOC.wet.inter + '・ウェット' + D.TYRE_ALLOC.wet.wet +
      'の別枠です。走行で使った本数は戻ってきません。<br>' +
      '<b>ちがいはソフトを何本使うかです。</b>' +
      'ソフトは一発が速いぶん、走らせても長い距離のことは分かりません。' +
      '<b>ハードを履けるのは、長い距離を走り込む「レース重視」だけ</b>で、' +
      '短い走りでは働く温度まで持っていけません。<br>' +
      '<b>何を履いて走ったかが、そのまま日曜に分かっていることになります。</b>' +
      'ただし、データは読める人がいてはじめて数字になります' +
      '（いまの読み手の厚み <b>' + Math.round(crew * 100) + '%</b>' +
      '：ストラテジストとエンジニアの両方が要ります）。</p><div class="pick fptyre" data-fpt="1">';
    D.FP_TYRE.forEach(p => {
      const read = S.tyreRead(g, p.key, 1);
      h += '<button class="pickbtn' + (p.key === cur ? ' on' : '') + '" data-v="' + p.key + '">' +
        '<span class="pb-ic" style="background:#8a4a3a">' + p.icon + '</span>' +
        '<span class="pb-body"><b>' + p.name + '</b>' +
        (p.longRun ? '<i class="lrtag">ロングラン</i>' : '') + '<small>' + esc(p.desc) +
        '<br>一発の速さの手応え <b>' + Math.round(p.pace * 100) + '%</b>' +
        '／タイヤの読み <b>' + Math.round(read * 100) + '%</b>' +
        '<br>日曜に残る新品 ' + leftoverHTML(p) +
        '</small></span>' +
        '<span class="pb-cost">🛞' + p.sets.length + '本<br>' +
        '<i class="tyuse">' + p.sets.filter(k => k === 'soft').length + 'S ' +
        p.sets.filter(k => k === 'medium').length + 'M ' +
        p.sets.filter(k => k === 'hard').length + 'H</i></span></button>';
    });
    return h + '</div>';
  }

  function cmdPractice() {
    const t = D.TRACKS[Math.min(raceCtx.trackIndex, D.TRACKS.length - 1)];
    if (!pendingStrategy.fpt) pendingStrategy.fpt = 'mix';
    let body = '<div class="racehead"><b>🔧 フリー走行</b><span>' +
      t.country + ' ' + esc(t.name) + '</span></div>' +
      fpTyreHTML() +
      '<div class="sub small">🔧 走行時間を何に使うか</div>' +
      '<p class="desc">決まった時間を、何に使うか。ひとつだけ選んでください。' +
      'ここで決めたことは、この週末のあいだ効きます。</p>' +
      '<div class="pick">';
    PRACTICE.forEach((x, i) => {
      const ok = !x.avail || x.avail();
      const sets = x.k === 'save' ? D.FP_SAVE_SETS
                 : S.fpTyrePlan(pendingStrategy.fpt).sets.length;
      body += '<button class="pickbtn' + (ok ? '' : ' done') + '" data-k="fp:' + i + '"' +
        (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#3a7ad9">' + x.icon + '</span>' +
        '<span class="pb-body"><b>' + x.label + '</b><small>' + x.note +
        (ok ? '' : '<br><em class="warn">下部組織に若手がいません（「👥 人事」→「🎓 育成」で獲得）</em>') +
        (x.k === 'rookie' && ok ? '<br><em class="free">' +
          esc((g.youth || []).slice().sort((a, b) =>
            (a.age - b.age) || (S.potOf(b).growth - S.potOf(a).growth))[0].name) +
          ' が乗ります</em>' : '') +
        '</small></span>' +
        '<span class="pb-cost">マシン<br>+' + ((x.setup - 1) * 100).toFixed(1) + '%' +
        '<br><i class="tyuse">🛞' + sets + '本</i></span></button>';
    });
    body += '</div>';
    U.modal('🔧 フリー走行', body, [], { wide: true });
    bindPick(k => doPractice(+k.split(':')[1]));
    Array.prototype.forEach.call(document.querySelectorAll('[data-fpt]'), wrap => {
      Array.prototype.forEach.call(wrap.children, b => {
        b.onclick = () => {
          pendingStrategy.fpt = b.dataset.v;
          GP.sound.play('tap');
          cmdPractice();
        };
      });
    });
  }

  function doPractice(i) {
    const x = PRACTICE[i];
    if (!x || (x.avail && !x.avail())) return;
    // 荷が遅れた週は、走れる時間そのものが足りない
    const late = !!(g.logi && g.logi.late);
    pendingStrategy.setup = late ? 1 + (x.setup - 1) * 0.4 : x.setup;
    pendingStrategy.fp = x.k;              // 予選後のレポートの精度に効く
    const msg = x.run();
    if (msg) { U.log(g, x.icon + ' ' + msg); U.toast(x.icon + ' ' + msg, 'good'); }
    if (late) U.log(g, '⏳ 機材の到着が遅れたぶん、走行時間が足りなかった（効果は半分以下）。', 'warn');
    GP.sound.play('confirm');
    S.save(g);
    U.closeModal();
    fpPack = R.practice(g, raceCtx.trackIndex, pendingStrategy, raceCtx.special);
    showPractice();
  }

  function runQualifying() {
    fpPack = null;
    qTab = 'grid';
    A.prePack = R.prequalify(g, raceCtx.trackIndex, pendingStrategy, raceCtx.special);
    showQualifying();
  }

  function startRace() {
    currentRes = R.simulate(g, raceCtx.trackIndex, pendingStrategy, raceCtx.special, A.prePack);
    A.prePack = null;
    runRace();
  }

  /* ---- 予選のあとの、出力モードの決めどころ ----
     「全開で行くか、温存するか」は、走ってみるまで判断材料がなかった。
     予選で分かった前後との差を、モードの効きとそのまま突き合わせる。
     ここで変えても予選の並びは動かない（決勝ぶんだけ入れ替える）   */
  function puDecideHTML(pre, stage) {
    const fpStage = stage === 'fp';
    const t = pre.track;
    const mine = pre.entries.filter(e => e.isPlayer).slice().sort((a, b) => a.grid - b.grid);
    if (!mine.length) return '';
    const me = mine[0];
    const ahead = pre.grid[me.grid - 2] || null;
    const behind = pre.grid[me.grid] || null;
    const pu = S.puOf(g);
    const left = Math.max(0, S.puLimit(g) - pu.used);
    const racesLeft = Math.max(1, D.RACES - (g.nextRace || 0));
    const fp = pendingStrategy.fp;
    const deep = fp === 'long' || fp === 'tyre';   // データを取った週は読みが細かい

    // モードごとに、実際の式をそのまま回して比べる
    const cur = S.puMode(g).key;
    const rows = D.PU_MODES.map(m => {
      S.setPuMode(g, m.key);
      const car = S.carScore(g, t);
      return { m: m,
               perf: (car * 0.60 + me.drvScore * 0.40) * (me.pmul || 1) + S.puPerf(g),
               wear: S.puWear(g, t, 1), rel: S.reliability(g) };
    });
    S.setPuMode(g, cur);
    const std = rows[1];
    /* 性能はスコアなので、大きいほど速い。
       画面には「1周あたり何秒 遅いか」で出すので、引く向きを揃えておく */
    const slower = (x, y) => t.base * PERF_TO_SEC * (y.perf - x.perf);
    const need = ahead ? slower(me, ahead) : null;         // + なら前の車のほうが速い
    const margin = behind ? slower(behind, me) : null;     // + なら自分のほうが速い

    let h = '<div class="sub">⚙️ ' + (fpStage ? '出力モードを決める' : '決勝の出力モード') + '</div>' +
      '<p class="desc">' +
      (fpStage
        ? 'フリー走行の並びで、だいたいの位置が見えました。ここで決めたモードは<b>予選から</b>効きます。'
        : '予選で並びが決まりました。ここから先は<b>決勝ぶんだけ</b>選び直せます（予選の順位は動きません）。') +
      '<br>' +
      (deep ? '📊 走り込んだデータがあるので、1周あたりの差まで出せています。'
            : '走り込んでいないぶん、読みは大まかです（「📊 ロングラン」「🛞 タイヤ」を選ぶと細かく出ます）。') +
      '</p>';

    h += '<div class="pudec">';
    h += '<div class="pdrow pdh"><span>モード</span><span>1周</span><span>1戦の消耗</span>' +
         '<span>あと</span><span>信頼性</span></div>';
    rows.forEach(r => {
      const d = slower(r, std);                 // − なら標準より速い
      const races = Math.floor(pu.life / Math.max(0.1, r.wear));
      h += '<button class="pdrow pdbtn' + (r.m.key === cur ? ' on' : '') +
        '" data-pumode="' + r.m.key + '" title="' + esc(r.m.note) + '">' +
        '<span class="pdnm">' + r.m.icon + ' ' + r.m.name + '</span>' +
        '<span class="pdv ' + (d < -0.004 ? 'good' : d > 0.004 ? 'bad' : '') + '">' +
          (Math.abs(d) < 0.005 ? '±0.00' : (d < 0 ? '−' : '+') + Math.abs(d).toFixed(2)) + '秒</span>' +
        '<span class="pdv">-' + Math.round(r.wear) + '%</span>' +
        '<span class="pdv">' + races + '戦</span>' +
        '<span class="pdv">' + Math.round(r.rel) + '%</span>' +
        '</button>';
    });
    h += '</div>';

    // ---- 決め手になる一行 ----
    const dPush = slower(rows[2], std), dSave = slower(rows[0], std);
    const notes = [];
    if (ahead && need != null) {
      notes.push(need <= 0
        ? '決勝ペースでは、前の <b>' + esc(ahead.driver.name) + '</b> より 1周 ' +
          Math.abs(need).toFixed(2) + '秒 速い見込みです。'
        : (-dPush >= need
            ? '<b class="good">全開なら</b>、前の <b>' + esc(ahead.driver.name) + '</b>（1周 ' +
              need.toFixed(2) + '秒 速い）を上回れます。'
            : '前の <b>' + esc(ahead.driver.name) + '</b> は 1周 ' + need.toFixed(2) +
              '秒 速く、全開（' + Math.abs(dPush).toFixed(2) + '秒）でも届きません。'));
    }
    if (behind && margin != null) {
      notes.push(margin - dSave < 0
        ? '温存にすると、後ろの <b>' + esc(behind.driver.name) + '</b> に 1周 ' +
          Math.abs(margin - dSave).toFixed(2) + '秒 抜かれるペースになります。'
        : '温存にしても、後ろの <b>' + esc(behind.driver.name) + '</b> には 1周 ' +
          (margin - dSave).toFixed(2) + '秒 の余裕があります。');
    }
    // 基数のやりくり
    const perRace = rows.map(r => r.wear);
    const canFinish = m => {
      const total = pu.life + left * 100;
      return total >= perRace[m] * racesLeft;
    };
    notes.push('今季は残り <b>' + racesLeft + '戦</b>、使えるユニットは <b>あと' + left + '基</b>。' +
      (canFinish(2) ? '<b class="good">全開で走り切っても基数は足ります。</b>'
       : canFinish(1) ? '標準なら足りますが、<b class="warn">全開を続けると上限を超えます</b>（1基につき ' +
                        D.PU_PENALTY + 'グリッド降格）。'
       : '<b class="warn">このままでは基数が足りません。</b>温存を混ぜるか、降格を取るレースを選んでください。'));
    const ease = S.overtakeEase(t);
    notes.push('🏁 ' + esc(t.name) + ' は' +
      (ease > 0.62 ? '<b>追い抜きやすい</b>コース。降格を取るならここは向いています。'
       : ease < 0.38 ? '<b>追い抜きにくい</b>コース。前に出られる位置なら守りにいく手も。'
       : '追い抜きは並のコースです。'));
    h += '<p class="note">' + notes.join('<br>') + '</p>';

    /* ---- ここで新型を入れてしまうか ----
       「基数が足りない」と分かった、まさにその場で決められるようにする */
    const cost = S.puFreshCost(g);
    const over = pu.used >= S.puLimit(g);
    h += '<div class="pufresh2">' +
      '<button class="btn' + (g.funds >= cost ? ' primary' : '') + '" data-pufresh2="1"' +
        (g.funds < cost ? ' disabled' : '') + '>' +
        '⚙️ 新品のパワーユニットを入れる（💰' + money(cost) + '万）</button>' +
      '<small>いまの ' + pu.n + '基目（残り ' + Math.round(pu.life) + '%）を降ろして、' +
      (pu.life >= D.PU_KEEP_MIN ? '取っておきます。' : '廃棄します。') +
      '残量100%から走り出せます。' +
      (over ? '<b class="warn">今季の上限（' + S.puLimit(g) + '基）を超えるので、' +
              '次のレースは ' + D.PU_PENALTY + 'グリッド降格になります。</b>'
            : '今季の基数を1つ使います（あと' + left + '基）。') +
      (fpStage ? '' : '<br>予選の順位はこのままです（降格ぶんだけ下がります）。') +
      '</small>';
    if (pu.pool.length) {
      h += '<div class="pupool2">取ってあるユニット：' + pu.pool.map((u, i) =>
        '<button class="btn small" data-pumount2="' + i + '"' +
        (g.funds < D.PU_SWAP_COST ? ' disabled' : '') + '>' +
        u.n + '基目 残り' + Math.round(u.life) + '%（工賃 ' + money(D.PU_SWAP_COST) + '万）</button>').join('') +
        '</div>';
    }
    h += '</div>';
    return h;
  }

  /* 走行後の画面から、その場でユニットを入れ替える。
     予選が済んでいれば、決勝ぶんの数字だけ作り直す（並びは動かさない） */
  function bindPuDecide(pack, redraw) {
    const refresh = () => {
      if (pack && !pack.isFP) R.repackPU(pack, g);
      S.save(g); render(); redraw();
    };
    bindAct('data-pumode', k => {
      S.setPuMode(g, k);
      GP.sound.play('confirm');
      refresh();
    });
    bindAct('data-pufresh2', () => {
      const cost = S.puFreshCost(g);
      if (g.funds < cost) return U.toast('資金が足りません', 'bad');
      g.funds -= cost;
      const r = S.fitFreshPU(g);
      U.log(g, '⚙️ ' + r.used + '基目の新品パワーユニットを投入した（' + money(cost) + '万）。' +
        (r.over ? '基数の上限を超えたため、次のレースは ' + r.grid + 'グリッド降格。' : ''),
        r.over ? 'warn' : 'good');
      U.toast(r.over ? '⚙️ 新品PU投入（' + r.grid + 'グリッド降格）' : '⚙️ 新品PUを投入', r.over ? 'warn' : 'good');
      GP.sound.play('buy');
      refresh();
    });
    bindAct('data-pumount2', i => {
      if (g.funds < D.PU_SWAP_COST) return U.toast('資金が足りません', 'bad');
      const m = S.mountPU(g, +i);
      if (!m) return;
      g.funds -= D.PU_SWAP_COST; capSpend(D.PU_SWAP_COST);
      U.log(g, '⚙️ ' + m.from + '基目を降ろし、' + m.to + '基目（残り ' + m.life + '%）に載せ替えた。');
      U.toast('⚙️ ' + m.to + '基目に載せ替えた');
      GP.sound.play('buy');
      refresh();
    });
  }

  /* ---- フリー走行の結果 ----
     全車のタイムを並べて、いまどのへんに居るのかを掴む場面 */
  function showPractice() {
    const res = fpPack;
    let body = '<div class="racehead"><b>' + res.weather.icon + ' ' + res.weather.name +
      '</b><span>フリー走行の結果</span></div>' +
      '<p class="desc">この日の空模様です。決勝の天候は予選のあとで決まります。' +
      'タイムは積んでいる燃料も狙いもばらばらなので、並びは目安として見てください。</p>';
    body += '<div class="gridlist">';
    res.grid.slice(0, 22).forEach(e => {
      body += '<div class="gridrow' + (e.isPlayer ? ' me' : '') + '">' +
        '<span class="gp-pos">' + e.grid + '</span>' +
        '<span class="rk-chip" style="background:' + e.color + '"></span>' +
        '<span class="gp-nm">' + esc(e.driver.name) + '</span>' +
        '<span class="gp-tm">' + esc(e.team.name) + '</span>' +
        logiChip(e) +
        '<span class="gp-t">' + fmtTime(e.qTime) + '</span></div>';
    });
    body += '</div>' +
      '<p class="note">✈️🚢 の印は、そのチームが機材をどうやって運んできたかです。' +
      'チャーターで先乗りしたチームはセットアップが進んでおり、' +
      '船便のチームは荷が遅れることがあります（⏳）。</p>';
    body += fpLearnHTML(res);
    body += tyreLifeHTML(res);
    body += bankHTML(res, 'フリー走行で使ったぶんが引かれています。' +
                          '「新」は手つかず、「中」は一度走ったタイヤです。');
    body += puDecideHTML(res, 'fp');
    U.modal('🔧 フリー走行', body, [
      { label: '🎙️ ブリーフィングへ', cls: 'primary', fn: showBrief },
      { label: '⏱️ 予選へ（話を飛ばす）', fn: () => { briefState = null; runQualiStaged(); } }
    ], { wide: true });
    bindPuDecide(res, showPractice);
  }

  /* =======================================================
     ブリーフィング
     走り終えたドライバーは、必ず何かを言う。
     その言い分は、このマシンがこのコースで足りていないところから出る。
     エンジニアがどう返すかで車が変わることもあれば、
     「そこは腕の見せどころだ」で終わることもある。
     どちらを選んでも、結果が出たかどうかで信頼が動く。
     ======================================================= */
  let briefState = null;

  /* 席を買って乗っている人の札。何が後ろについているのかを出す */
  function paidChip(d) {
    if (!d || !d.paid) return '';
    return '<em class="paidchip" title="' + esc(d.paid.line) + '">' +
      d.paid.icon + ' ' + esc(d.paid.name) + '　毎戦 +' + money(d.paid.per) + '万</em>';
  }

  function trustChip(d) {
    const v = S.trustOf(d), t = S.trustTier(v);
    return '<span class="trustchip" style="--tk:' + t.color + '" title="' + esc(t.note) + '">' +
      t.icon + ' ' + t.name + ' <b>' + Math.round(v) + '</b></span>';
  }

  function showBrief() {
    const t = D.TRACKS[Math.min(raceCtx.trackIndex, D.TRACKS.length - 1)];
    if (!briefState) {
      const f = S.briefFind(g, t);
      // 言い出すのは、いちばん納得のいっていないほう
      const d = g.drivers.slice().sort((a, b) => S.trustOf(a) - S.trustOf(b))[0];
      if (!d) { runQualiStaged(); return; }
      briefState = { c: f.def, gap: f.gap, id: d.id,
                     say: f.def.say[S.rint(0, f.def.say.length - 1)], done: null };
    }
    const st = briefState;
    const d = g.drivers.filter(x => x.id === st.id)[0] || g.drivers[0];
    const room = S.meetingLv(g);
    let body = '<div class="racehead"><b>🗣️ ミーティングルーム Lv.' + room +
      '</b><span>' + t.country + ' ' + esc(t.name) + '　フリー走行のあと</span></div>';

    body += '<div class="quote qsay mine">' + U.face(d, 34) +
      '<span><em>' + esc(d.name) + '　' + trustChip(d) + '</em>' + esc(st.say) + '</span></div>';
    body += '<p class="desc">🔧 エンジニア：' + esc(st.c.eng) + '</p>';

    if (!st.done) {
      body += '<p class="desc">言い分は <b>' + st.c.icon + ' ' + esc(st.c.name) +
        '</b>。ここでの返し方が、そのままこの週末のマシンと、' +
        'この人のピットへの信頼に効きます。<br>' +
        '部屋が大きいほど話は届き（いまの伝わりやすさ <b>' +
        S.roomPower(g).toFixed(1) + '</b>）、決まったときの信頼の伸びも大きくなります。</p>';
      body += '<div class="pick">';
      D.BRIEF_REPLIES.forEach(r => {
        const odds = r.key === 'fix' ? S.fixOdds(g) : r.key === 'data' ? S.dataOdds(g) : null;
        body += '<button class="pickbtn" data-k="br:' + r.key + '">' +
          '<span class="pb-ic" style="background:#3f6f8a">' + r.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(r.name) + '</b>' +
          '<small>' + esc(r.desc) +
          '<br><em class="pnote">' + esc(r.line) + '</em>' +
          '<br>信頼 決まれば <b>+' + r.okTrust + '</b>／外せば <b>' + r.ngTrust + '</b>' +
          '　決勝しだいで さらに <b>+' + r.raceOk + ' / ' + r.raceNg + '</b>' +
          '</small></span>' +
          '<span class="pb-cost">' + (odds == null ? '結果しだい'
            : '決まる<br>' + Math.round(odds * 100) + '%') + '</span></button>';
      });
      body += '</div>';
      U.modal('🎙️ ブリーフィング', body, [
        { label: '何も言わずに送り出す', fn: () => { briefState.done = { skip: true }; showBrief(); } }
      ], { wide: true });
      bindPick(k => { if (k.indexOf('br:') === 0) doBrief(k.slice(3)); });
      return;
    }

    // ---- 返したあと ----
    const r = st.done.reply;
    if (r) {
      body += '<div class="quote qsay"><span><em>🔧 エンジニア</em>' + esc(r.line) + '</span></div>';
      body += '<p class="note' + (st.done.ok ? ' good' : ' warn') + '">' + esc(st.done.msg) + '</p>';
    } else {
      body += '<p class="note">何も言わず、そのまま送り出した。</p>';
    }
    body += bankHTML(fpPack || A.prePack);
    U.modal('🎙️ ブリーフィング', body, [
      { label: '⏱️ 一本ずつ走る', cls: 'primary', fn: () => { runQualiStaged(); } },
      { label: '⏱️ 一気に走らせる', fn: () => { runQualifying(); } }
    ], { wide: true });
  }

  function doBrief(key) {
    const st = briefState;
    if (!st || st.done) return;
    const r = D.BRIEF_REPLIES.filter(x => x.key === key)[0];
    const d = g.drivers.filter(x => x.id === st.id)[0] || g.drivers[0];
    if (!r || !d) return;
    let ok = true, msg = '';
    if (r.key === 'fix') {
      ok = Math.random() < S.fixOdds(g);
      // 設定で触りようのない言い分（つなぎ目の話など）は、ここへ来ても何もしない
      const f = st.c.fix || {};
      const tune = {};
      Object.keys(f).forEach(k => {
        // 外したときは、狙ったぶんは半分しか出ず、捨てたぶんはそのまま出る
        tune[k] = f[k] > 0 ? (ok ? f[k] : f[k] * 0.35) : f[k];
      });
      pendingStrategy.tune = tune;
      msg = ok
        ? '🔧 狙ったところに決まった。次のランで、本人の口調が変わった。'
        : '⚠️ 振ったぶんが噛み合わなかった。取りにいったところは出ず、捨てたところだけが減った。';
      staffExp('engineer', 10);
    } else if (r.key === 'data') {
      ok = Math.random() < S.dataOdds(g);
      msg = ok
        ? '📊 数字を見せると、本人が黙って頷いた。車はこのまま行く。'
        : '⚠️ 数字では納得しなかった。「乗ってるのは自分です」と言われて終わった。';
      staffExp('analyst', 10);
    } else {
      // 腕の見せどころ、は決勝まで答えが出ない
      ok = d.mental >= 100 || Math.random() < 0.5;
      msg = ok
        ? '💪 少し間があって、「やってみます」と返ってきた。'
        : '⚠️ 「分かりました」とだけ言って、席を立った。納得はしていない。';
    }
    S.addTrust(g, d, ok ? r.okTrust : r.ngTrust);
    // 決勝のあとに、結果でもう一度動かすために覚えておく
    g.brief = { id: d.id, reply: r.key, key: st.c.key,
                raceOk: r.raceOk, raceNg: r.raceNg, at: g.week };
    st.done = { reply: r, ok: ok, msg: msg };
    U.log(g, '🗣️ ' + d.name + '「' + st.say + '」→ ' + r.name + '（' +
      (ok ? '通じた' : '通じなかった') + '／信頼 ' + Math.round(S.trustOf(d)) + '）',
      ok ? 'good' : 'warn');
    GP.sound.play(ok ? 'confirm' : 'no');
    S.save(g);
    showBrief();
  }

  /* ---- 信頼が底を割ったドライバーは、ここを出たがる ---- */
  function checkLeave(after) {
    const d = (g.drivers || []).filter(x => S.trustOf(x) < D.TRUST.leaveAt && !x.leaveAsked)[0];
    if (!d) return false;
    const go = () => { U.closeModal(); if (after) after(); };
    d.leaveAsked = true;
    const fee = Math.round(d.salary * 26 + 1800);
    const canPay = g.funds >= fee;
    U.modal('💢 ' + esc(d.name) + ' から話がある',
      '<div class="quote qsay mine">' + U.face(d, 34) +
      '<span><em>' + esc(d.name) + '　' + trustChip(d) + '</em>' +
      '「ここでは、もう自分の走りができません。来季の席を探させてください」</span></div>' +
      '<p class="desc">ピットへの信頼が底を割りました。言ったことが当たらない週末が続けば、' +
      '乗っている人間はいちばん先にそれを知ります。<br>' +
      '引き止めるには、条件を積み直すしかありません（信頼が <b>' +
      D.TRUST.start + '</b> まで戻り、給料が上がります）。</p>' +
      '<div class="poachbox"><span>💰 積み直す支度金</span><b>' + money(fee) + '万</b></div>' +
      '<div class="poachbox"><span>📈 これからの給料</span><b>+25%</b></div>' +
      (canPay ? '' : '<p class="note">いまの資金では引き止められません。</p>'), [
      { label: '引き止める', cls: 'primary', disabled: !canPay, fn: () => {
          g.funds -= fee;
          d.salary = Math.round(d.salary * 1.25);
          d.trust = D.TRUST.start;
          d.leaveAsked = false;
          U.log(g, '🤝 ' + d.name + ' を引き止めた（支度金 ' + money(fee) + '万／給料 +25%）。' +
            'ここからは、言ったことを当てていくしかない。', 'good');
          GP.sound.play('confirm');
          S.save(g); render(); go();
        } },
      { label: '受け入れる', fn: () => {
          d.wantOut = true;
          U.log(g, '💢 ' + d.name + ' の移籍希望を受け入れた。今季かぎりでチームを離れる。', 'bad');
          GP.sound.play('dnf');
          S.save(g); render(); go();
        } }
    ]);
    // ✕で閉じたときも「受け入れる」と同じ扱いにする（週が飛ばないように）
    const prevX = $('modalClose').onclick;
    $('modalClose').onclick = () => {
      $('modalClose').onclick = prevX;
      d.wantOut = true;
      S.save(g); go();
    };
    return true;
  }

  /* ---- 決勝のあと、約束が果たされたかどうかで信頼が動く ---- */
  function settleBrief(res) {
    const b = g.brief;
    g.brief = null;
    S.trustDrift(g);
    if (!b) return null;
    const e = (res.classified || []).filter(x => x.isPlayer && x.driver.id === b.id)[0];
    const d = (g.drivers || []).filter(x => x.id === b.id)[0];
    if (!e || !d) return null;
    // グリッドを守れたか、上げられたか。持って帰れなかったのはいちばん響く
    const good = !e.dnf && e.pos <= e.grid;
    const amt = good ? b.raceOk : b.raceNg;
    const before = Math.round(S.trustOf(d));
    S.addTrust(g, d, amt);
    const after = Math.round(S.trustOf(d));
    return { name: d.name, good: good, before: before, after: after,
             reply: (D.BRIEF_REPLIES.filter(x => x.key === b.reply)[0] || {}).name || '',
             tier: S.trustTier(after) };
  }

  /* =======================================================
     段階予選
     Q1・Q2・Q3 を一本ずつ。あいだで出力モードを変え、
     セットアップを触り、次の一本に新品を入れるかを決める。
     一気に走らせるのと計算は同じで、区切りが入るだけ。
     ======================================================= */
  let qStage = null;

  /* セッションのあいだに触れる、セットアップの微調整 */
  const QTUNE = [
    { key: 'push', name: '攻めに振る', icon: '🔥', gain: 0.006, loss: 0.005, risk: 0.34,
      desc: '一本の速さを取りにいく。決まれば前に出るが、外すと収まりが悪くなる' },
    { key: 'keep', name: 'そのまま',   icon: '⚖️', gain: 0,     loss: 0,     risk: 0,
      desc: '触らない。いまの手応えのまま次の一本へ' },
    { key: 'calm', name: '安定に振る', icon: '🛡️', gain: 0.002, loss: 0.002, risk: 0.10,
      desc: 'まとめやすくする。速さは伸びないが、外しにくい' }
  ];

  function runQualiStaged() {
    fpPack = null;
    qTab = 'grid';
    pendingStrategy.qtune = 1;
    [0, 1, 2].forEach(i => { delete pendingStrategy['qnew' + i]; });
    qStage = { pack: R.qOpen(g, raceCtx.trackIndex, pendingStrategy, raceCtx.special),
               phase: 'prep', last: null, tuned: false, msg: '' };
    showQStage();
  }

  function qStageCut(qs) {
    const si = qs.si;
    if (si >= 2) return { from: qs.sizes[2], to: qs.sizes[2] };
    return { from: qs.sizes[si], to: qs.sizes[si + 1] };
  }

  function showQStage() {
    const st = qStage;
    if (!st) return;
    const pack = st.pack, qs = pack.qs;
    const si = Math.min(2, qs.si);
    const cut = qStageCut(qs);
    let body = '<div class="racehead"><b>' + pack.weather.icon + ' ' + pack.weather.name +
      '</b><span>Q' + (si + 1) + '　' + cut.from + '台 → ' + cut.to + '台</span></div>';

    if (st.phase === 'result' && st.last) {
      // ---- 走り終えた一本 ----
      const ss = st.last;
      body += '<p class="desc">Q' + (ss.si + 1) + ' が終わりました。' +
        (ss.dropped.length ? '<b>' + ss.dropped.length + '台</b>がここで敗退です。' : 'ここからポールを争います。') +
        '</p><div class="gridlist qlist">';
      ss.order.forEach((e, i) => {
        if (ss.cut != null && i === ss.cut) body += '<div class="qcut out1">ここから敗退</div>';
        body += qRowHTML(e, i + 1, e.qLap[ss.si], qTyreChip(e, ss.si) + qEvHTML(e.qEv[ss.si]));
      });
      body += '</div>';
      const mine = pack.entries.filter(e => e.isPlayer);
      const gone = mine.filter(e => e.qOut === ss.si);
      if (gone.length) {
        body += '<p class="note warn">' + gone.map(e => esc(e.driver.name) +
          ' はここで敗退しました。').join('<br>') + '</p>';
      }
      body += bankHTML(pack);
      const done = qs.si >= 3;
      U.modal('⏱️ 予選 Q' + (ss.si + 1), body, [
        { label: done ? '🏁 予選結果へ' : '▶ Q' + (qs.si + 1) + ' の支度へ',
          cls: 'primary', fn: done ? closeQStage : nextQPrep }
      ], { wide: true });
      return;
    }

    // ---- 次の一本の支度 ----
    const mine = pack.entries.filter(e => e.isPlayer && e.qOut == null);
    if (!mine.length) {
      body += '<p class="note warn">自チームはすでに敗退しています。残りの争いを見届けましょう。</p>';
    }
    body += '<p class="desc">走り出す前に、次の一本をどう戦うかを決めます。' +
      'ここで触ったことは<b>この一本から</b>効きます。</p>';
    if (st.msg) body += '<p class="note' + (st.msgOk ? ' good' : ' warn') + '">' + st.msg + '</p>';

    // 新品を入れるか
    const newOn = pendingStrategy['qnew' + si] != null
      ? !!pendingStrategy['qnew' + si]
      : !!R.qPlanOf(pendingStrategy).newQ[si];
    body += '<div class="sub small">🛞 この一本のタイヤ</div>' +
      '<p class="desc">新品は食いつきますが、日曜に残りません。' +
      '中古は約 <b>' + (D.TYRE_ALLOC.qUsedLoss).toFixed(2) + '秒</b> ぶん遅くなります。' +
      (si === 2 ? '<br>Q3はポール争いなので、ふつうは新品を入れます。' : '') + '</p>' +
      '<div class="qpickrow" data-qnew="' + si + '">' +
      '<button class="stratbtn' + (newOn ? ' on' : '') + '" data-v="1">🆕 新品<br><small>いちばん速い</small></button>' +
      '<button class="stratbtn' + (newOn ? '' : ' on') + '" data-v="0">♻️ 中古<br><small>日曜に残す</small></button>' +
      '</div>';
    body += bankHTML(pack);

    // セットアップの微調整（1セッションに1回だけ）
    body += '<div class="sub small">🔧 セットアップの微調整</div>';
    if (st.tuned) {
      body += '<p class="note">この一本ぶんの調整は済んでいます。</p>';
    } else {
      const eng = S.org(g).dept.engineer;
      body += '<p class="desc">技術陣が厚いほど、狙ったほうに決まります' +
        '（いまの成功率の底上げ：<b>+' + Math.round(Math.min(0.6, eng * 0.012) * 100) + '%</b>）。</p>' +
        '<div class="pick">';
      QTUNE.forEach(x => {
        const risk = x.risk ? Math.max(0.05, x.risk * (1 - Math.min(0.6, eng * 0.012))) : 0;
        body += '<button class="pickbtn" data-k="qt:' + x.key + '">' +
          '<span class="pb-ic" style="background:#3a7ad9">' + x.icon + '</span>' +
          '<span class="pb-body"><b>' + x.name + '</b><small>' + x.desc + '</small></span>' +
          '<span class="pb-cost">' + (x.gain ? '+' + (x.gain * 100).toFixed(1) + '%<br>' +
            '<i class="tyuse">外す ' + Math.round(risk * 100) + '%</i>' : '—') + '</span></button>';
      });
      body += '</div>';
    }

    body += puDecideHTML(pack, 'fp');
    U.modal('⏱️ 予選 Q' + (si + 1), body, [
      { label: '▶ Q' + (si + 1) + ' を走る', cls: 'primary', fn: runQStage },
      { label: '⏭️ 残りを一気に', fn: rushQStage }
    ], { wide: true });

    bindPick(k => { if (k.indexOf('qt:') === 0) doQTune(k.slice(3)); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-qnew]'), wrap => {
      Array.prototype.forEach.call(wrap.children, b => {
        b.onclick = () => {
          Array.prototype.forEach.call(wrap.children, c => c.classList.remove('on'));
          b.classList.add('on');
          pendingStrategy['qnew' + wrap.dataset.qnew] = +b.dataset.v;
          GP.sound.play('tap');
        };
      });
    });
    bindPuDecide(pack, showQStage);
  }

  function doQTune(k) {
    const st = qStage;
    const x = QTUNE.find(v => v.key === k);
    if (!st || !x || st.tuned) return;
    st.tuned = true;
    if (!x.gain) {
      st.msg = '⚖️ 何も触らず、そのまま送り出すことにした。';
      st.msgOk = true;
    } else {
      const eng = S.org(g).dept.engineer;
      const risk = Math.max(0.05, x.risk * (1 - Math.min(0.6, eng * 0.012)));
      const ok = Math.random() >= risk;
      pendingStrategy.qtune = (pendingStrategy.qtune || 1) * (ok ? 1 + x.gain : 1 - x.loss);
      st.msgOk = ok;
      st.msg = ok
        ? x.icon + ' 狙いどおりに決まった（マシン +' + (x.gain * 100).toFixed(1) + '%）'
        : '⚠️ 触ったぶんが裏目に出た（マシン −' + (x.loss * 100).toFixed(1) + '%）';
      staffExp('engineer', 6);
    }
    GP.sound.play(st.msgOk ? 'confirm' : 'no');
    showQStage();
  }

  function runQStage() {
    const st = qStage;
    if (!st) return;
    const ss = R.qStep(st.pack, g, pendingStrategy);
    if (!ss) { closeQStage(); return; }
    st.last = ss;
    st.phase = 'result';
    st.tuned = false;
    st.msg = '';
    GP.sound.play('confirm');
    showQStage();
  }

  function nextQPrep() {
    if (!qStage) return;
    qStage.phase = 'prep';
    showQStage();
  }

  /* 途中で「もういい」と思ったら、残りは一気に走らせる */
  function rushQStage() {
    const st = qStage;
    if (!st) return;
    while (st.pack.qs.si < 3) R.qStep(st.pack, g, pendingStrategy);
    closeQStage();
  }

  function closeQStage() {
    const st = qStage;
    if (!st) return;
    while (st.pack.qs.si < 3) R.qStep(st.pack, g, pendingStrategy);
    A.prePack = R.qClose(st.pack, g, pendingStrategy, raceCtx.special);
    qStage = null;
    qTab = 'grid';
    showQualifying();
  }

  /* ---- 金曜に分かったこと ----
     何を履いて走ったか（データ）と、それを読める人（ストラテジストと
     エンジニア）の積が「読み」になる。読みが深いほど、
     タイヤの持ちの見立てが細く、ストップ数の判断も外れなくなる。   */
  /* ---------- タイヤの持ち ----------
     銘柄ごとに、1周でどれだけ落ちていくか。数字を手で書くと
     式を触ったときに嘘になるので、決勝と同じ式をそのまま呼んで引く。

     決勝の1周は
       t  = 基準 * ty.pace
       t += 基準 * 走った周回 * 0.0014 * コース負荷 * 腕 * 作戦 * ty.wear
       寿命を過ぎたら t += 基準 * 超過^2 * 0.0011 * 腕
     という形をしている。ここではその増えぶんだけを取り出して並べる。 */
  function degOf(ty, track, age, wear) {
    const base = track.base;
    let v = base * (ty.pace - 1);
    v += base * age * 0.0014 * track.tyre * wear * ty.wear;
    const over = age - ty.life;
    if (over > 0) v += base * over * over * 0.0011;
    return v;
  }

  function tyreLifeHTML(res) {
    const t = res && res.track
      || D.TRACKS[Math.min(raceCtx.trackIndex, D.TRACKS.length - 1)];
    const d = (g.drivers || [])[0];
    const wear = d ? S.tyreWear(d) * S.tyreKind(g) : 1;
    const A = D.TYRE_ALLOC;
    // 金曜に1セット走らせると、これだけ古くなって日曜に出てくる
    const carry = A.fpLaps * A.carry;
    const pit = (t.pitLane || 18) + 2.6;

    let h = '<div class="sub small">🛞 タイヤの持ち</div>' +
      '<p class="desc">' + esc(t.name) + '（基準 ' + t.base + '秒／タイヤ負荷 ×' +
      t.tyre + '）で、いまのドライバーとマシン（タイヤへの当たり ×' +
      wear.toFixed(2) + '）が走ったときの落ち方です。' +
      '<b>寿命を過ぎると、そこから加速度的に落ちます。</b></p>' +
      '<div class="degwrap"><div class="degtab"><div class="dg-h"><span>銘柄</span>' +
      '<span>出だし</span><span>1周あたり</span><span>寿命</span>' +
      '<span>寿命+5周</span></div>';

    const s0 = degOf(D.TYRES[0], t, 0, wear);
    D.DRY_TYRES.forEach(k => {
      const ty = D.TYRES.find(x => x.key === k);
      const slope = t.base * 0.0014 * t.tyre * wear * ty.wear;
      const over5 = degOf(ty, t, ty.life + 5, wear) - degOf(ty, t, ty.life, wear);
      h += '<div class="dg-r"><span class="dg-n" style="background:' + ty.color +
        ';color:' + ty.text + '">' + ty.name + '</span>' +
        '<span>' + (degOf(ty, t, 0, wear) - s0 >= 0 ? '+' : '') +
        (degOf(ty, t, 0, wear) - s0).toFixed(2) + '秒</span>' +
        '<span>+' + slope.toFixed(3) + '秒</span>' +
        '<span><b>' + Math.round(ty.life / Math.max(0.35, t.tyre * wear)) + '周</b></span>' +
        '<span class="dg-w">+' + over5.toFixed(2) + '秒</span></div>';
    });
    h += '</div></div>';

    /* ---- ユーズドは実際に使えるのか ----
       ここがいちばん知りたいところなので、
       「ピット1回ぶんを失うまでに何周走れるか」に直して見せる      */
    h += '<div class="sub small">ユーズドは使えるのか</div>' +
      '<p class="desc">金曜に1セット走らせると ' + A.fpLaps + '周ぶん減り、' +
      'そのうち ' + Math.round(A.carry * 100) + '% を日曜まで引きずります' +
      '（＝出だしから約 ' + carry.toFixed(1) + '周ぶん古い状態）。' +
      'このコースのピット1回は約 <b>' + pit.toFixed(1) + '秒</b>です。</p>' +
      '<div class="degwrap"><div class="degtab"><div class="dg-h"><span>銘柄</span>' +
      '<span>新品なら</span><span>中古なら</span><span>出だしの差</span>' +
      '<span>1スティント</span></div>';
    /* 1スティントの長さ。「中古で走れるか」は、
       レース全体ではなく、次に止まるまでを走りきれるかで決まる      */
    const laps0 = Math.max(4, Math.round(t.laps *
      (raceCtx.special ? raceCtx.special.lapMul : 1)));
    const stint = Math.round(laps0 / (S.naturalStops(t, laps0, t.tyre * wear) + 1));
    D.DRY_TYRES.forEach(k => {
      const ty = D.TYRES.find(x => x.key === k);
      const real = ty.life / Math.max(0.35, t.tyre * wear);
      const used = real - carry;
      const loss = degOf(ty, t, carry, wear) - degOf(ty, t, 0, wear);
      // その中古で1スティント走ったとき、新品に対してどれだけ損をするか
      const cost = loss * Math.min(used, stint);
      const ok = used >= stint && cost < pit;
      h += '<div class="dg-r"><span class="dg-n" style="background:' + ty.color +
        ';color:' + ty.text + '">' + ty.name + '</span>' +
        '<span>' + Math.round(real) + '周</span>' +
        '<span>' + Math.round(used) + '周</span>' +
        '<span>+' + loss.toFixed(2) + '秒/周</span>' +
        '<span class="' + (ok ? 'dg-ok' : 'dg-w') + '">' +
        (used < stint ? Math.round(used) + '周で力尽きる'
         : cost >= pit ? '損が ' + cost.toFixed(1) + '秒' : '走りきれる') +
        '</span></div>';
    });
    h += '</div></div>' +
      '<p class="desc">このコースの1スティントは <b>約' + stint + '周</b>です' +
      '（' + laps0 + '周を ' + (S.naturalStops(t, laps0, t.tyre * wear) + 1) + '回に分けた場合）。' +
      '中古でもそこまで届き、失う時間がピット1回ぶん（' + pit.toFixed(1) + '秒）に' +
      '満たないなら、<b>新品を待つより中古で出たほうが速い</b>ということになります。</p>';
    return h;
  }

  function fpLearnHTML(res) {
    const t = res.track || D.TRACKS[Math.min(raceCtx.trackIndex, D.TRACKS.length - 1)];
    const plan = S.fpTyrePlan(pendingStrategy.fpt || 'mix');
    const me = (res.entries || []).filter(e => e.isPlayer)[0];
    const read = S.tyreRead(g, plan.key, me ? me.fpRan : 1);
    const laps = Math.max(4, Math.round(t.laps * (raceCtx.special ? raceCtx.special.lapMul : 1)));
    let h = '<div class="sub small">📋 金曜に分かったこと</div>' +
      '<div class="readbox"><span>' + plan.icon + ' ' + plan.name + '</span>' +
      '<span>読み手の厚み <b>' + Math.round(S.readCrew(g) * 100) + '%</b></span>' +
      '<span>タイヤの読み <b>' + Math.round(read * 100) + '%</b></span></div>';
    h += '<div class="lifelist">';
    (g.drivers || []).forEach(d => {
      const r = S.tyreLifeRead(g, t, d, read);
      const stops = S.naturalStops(t, laps, r.wear);
      h += '<div class="lf-row"><b>' + esc(d.name) + '</b>' +
        '<span>ミディアム1セットで <b>' + Math.round(r.lo) + '〜' + Math.round(r.hi) + '周</b></span>' +
        '<span>タイヤへの入力 <b>×' + S.tyreWear(d).toFixed(2) + '</b></span>' +
        '<span>' + (read >= D.TYRE_READ.missFrom
          ? '見立て <b>' + stops + 'ストップ</b>'
          : '<em class="warn">ストップ数は読み切れていない</em>') + '</span></div>';
    });
    h += '</div>';
    h += '<p class="desc">タイヤの減りは、<b>ドライバーのタイヤへの入力</b>' +
      '（丁寧なほど保つ）と、<b>マシンのタイヤへの攻撃性</b>' +
      '（いま ×' + S.tyreKind(g).toFixed(2) + '：ダウンフォースと軽さで変わります）、' +
      'そして<b>路面に乗ったゴム</b>で決まります。' +
      (read < D.TYRE_READ.missFrom
        ? '<br><em class="warn">読みが浅いので、「おまかせ」のストップ数が' +
          '1回ぶんずれることがあります。決勝用の銘柄を走らせるか、' +
          'ストラテジストとエンジニアを厚くすると当たるようになります。</em>'
        : '<br><em class="free">読みが足りているので、「おまかせ」のストップ数は当たります。</em>') +
      '</p>';
    return h;
  }

  /* ---- 予選の表 ----
     結果（決勝の並び）と、Q1・Q2・Q3 それぞれの走りを切り替えて見る。
     セッションの表では、そこで何が起きたのかも並べる            */
  let qTab = 'grid';

  function qRowHTML(e, pos, time, extra) {
    const cls = pos === 1 ? ' gold' : pos === 2 ? ' silver' : pos === 3 ? ' bronze' : '';
    return '<div class="gridrow' + (e.isPlayer ? ' me' : '') + '">' +
      '<span class="gp-pos' + cls + '">' + pos + '</span>' +
      '<span class="rk-chip" style="background:' + e.color + '"></span>' +
      '<span class="gp-nm">' + esc(e.driver.name) + '</span>' +
      '<span class="gp-tm">' + esc(e.team.name) + '</span>' +
      (extra || '') +
      '<span class="gp-t">' + (time == null ? '—' : fmtTime(time)) + '</span></div>';
  }

  /* そのセッションでその車に起きたこと。押し出された秒数もそのまま出す */
  function qEvHTML(list) {
    if (!list || !list.length) return '';
    return '<span class="qev">' + list.map(v =>
      '<i class="' + (v.sec < 0 ? 'up' : 'down') + '" title="' + esc(v.name) + '">' +
      v.icon + (v.sec < 0 ? '' : '+') + v.sec.toFixed(2) + '</i>').join('') + '</span>';
  }

  function qBadge(e) {
    const k = e.qOut === 0 ? 'Q1' : e.qOut === 1 ? 'Q2' : 'Q3';
    return '<span class="qsess q' + (e.qOut == null ? 3 : e.qOut + 1) + '">' + k + '</span>';
  }

  function qualiTableHTML(res) {
    const Q = res.quali;
    if (!Q) {
      return '<div class="gridlist qlist">' +
        res.grid.slice(0, 24).map(e => qRowHTML(e, e.grid, e.qTime, logiChip(e))).join('') +
        '</div>';
    }
    const tabs = [['grid', '🏁 結果'], ['Q1', 'Q1'], ['Q2', 'Q2'], ['Q3', 'Q3']];
    let h = '<div class="tabs qtabs">' + tabs.map(t =>
      '<button class="tab' + (qTab === t[0] ? ' on' : '') + '" data-qtab="' + t[0] + '">' +
      t[1] + '</button>').join('') + '</div>';
    if (qTab === 'grid') {
      h += '<div class="gridlist qlist">';
      res.grid.forEach(e => {
        if (e.grid === Q.q3n + 1) h += '<div class="qcut">ここから Q2 敗退</div>';
        if (e.grid === Q.q2n + 1) h += '<div class="qcut out1">ここから Q1 敗退</div>';
        h += qRowHTML(e, e.grid, e.qTime, qBadge(e) + logiChip(e));
      });
      h += '</div>';
      h += '<p class="desc">Q1で下位' + (Q.n - Q.q2n) + '台、Q2でさらに' +
           (Q.q2n - Q.q3n) + '台が落ち、残った' + Q.q3n + '台がポールを争います。</p>';
    } else {
      const si = +qTab.slice(1) - 1;
      const ss = Q.sessions[si];
      h += '<div class="gridlist qlist">';
      ss.order.forEach((e, i) => {
        if (ss.cut != null && i === ss.cut) h += '<div class="qcut out1">ここから敗退</div>';
        h += qRowHTML(e, i + 1, e.qLap[si], qTyreChip(e, si) + qEvHTML(e.qEv[si]));
      });
      h += '</div>';
    }
    return h;
  }

  /* ---- 予選のあとの、ドライバーの声 ---- */
  function qTalkHTML(res) {
    if (!res.qTalks || !res.qTalks.length) return '';
    return '<b class="sub small">🎙️ ドライバーの声</b>' +
      res.qTalks.map(t =>
        '<div class="quote qsay' + (t.isPlayer ? ' mine' : '') + '">' +
        U.face(t.driver, 32) +
        '<span><em>' + esc(t.name) + ' ／ ' + esc(t.team) + ' ／ ' + t.grid + '番手</em>' +
        esc(t.text) + '</span></div>').join('');
  }

  function showQualifying() {
    const res = A.prePack;
    let body = '<div class="racehead"><b>' + res.weather.icon + ' ' + res.weather.name +
               '</b><span>予選 — Q1 / Q2 / Q3</span></div>';
    body += qualiTableHTML(res);
    body += qTalkHTML(res);
    body += bankHTML(res, '日曜に使えるのはこれだけです。' +
      'スティントは「新」から順に履き、尽きたら中古で走ります。');
    body += forecastHTML(res);
    body += puDecideHTML(res, 'quali');
    U.modal('⏱️ 予選', body, [{ label: '🚶 グリッドへ', cls: 'primary', fn: cmdGrid }], { wide: true });
    Array.prototype.forEach.call(document.querySelectorAll('[data-qtab]'), b => {
      b.onclick = () => { qTab = b.getAttribute('data-qtab'); GP.sound.play('tap'); showQualifying(); };
    });
    // 選び直したら、決勝ぶんの数字だけ入れ替えて出し直す（並びは動かさない）
    bindPuDecide(A.prePack, showQualifying);
  }

  /* =======================================================
     デブリーフィング
     「なぜその順位だったのか」を、シミュレーションと同じ式で分解する。
     ラップタイム差 = 基準タイム × 0.00092 × 性能差、
     性能 = （マシン × 0.6 ＋ ドライバー × 0.4）× 週の調子。
     この式をそのまま逆に辿るので、出る数字は実際の中身と一致する。
     ======================================================= */
  const PERF_TO_SEC = 0.00092;

  /* ---- 今日の無線 ----
     レース中は数秒で消えるので、あとから全部読み返せるようにしておく */
  function radioLog(res) {
    const list = res.radio || [];
    if (!list.length) return '';
    let h = '<div class="sub small">📻 今日のチーム無線</div><div class="radiolog">';
    list.forEach(r => {
      h += '<div class="rl' + (r.from === 'pit' ? '' : ' drv') + '">' +
        '<i>L' + r.lap + '</i>' +
        '<b>' + (r.from === 'pit' ? '📻 ピット→' + esc(r.name) : '🗣️ ' + esc(r.name)) + '</b>' +
        '<span>' + esc(r.text) + '</span></div>';
    });
    return h + '</div>';
  }

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

  /* ---- 決勝のあとのひとこと ----
     順位だけを見て話させると、毎回おなじことしか言わない。
     その日その車に起きたことのうち、いちばん重かったものを選んで
     そこについて口を開かせる。何も無かった日は、性格どおりの台詞。 */
  function raceQuote(e, res, said) {
    if (e.dnf) return S.quoteFor(e.driver, e.pos, e.dnf, said);
    const moved = e.grid - e.pos;
    const on = {
      trouble: !!e.trouble,
      penalty: (e.penalties || []).length > 0,
      blue:    (e.blueLoss || 0) >= 1.6,
      wx:      !!res.weatherChange,
      sc:      !!res.safetyCar,
      pit:     (e.pitSlow || 0) > 0,
      charge:  moved >= 5,
      slip:    moved <= -5,
      fight:   moved >= 2 && moved <= 4 && e.pos <= 12
    };
    const pool = [];
    D.R_TALK.forEach(t => { if (on[t.key]) for (let i = 0; i < Math.round(t.w * 10); i++) pool.push(t); });
    // 起きたことがあっても、たまには順位そのものについて話す
    if (!pool.length || Math.random() < 0.22) return S.quoteFor(e.driver, e.pos, e.dnf, said);
    const t = pool[S.rint(0, pool.length - 1)];
    const lines = t.lines.filter(l => said.indexOf(l) < 0);
    return S.pick(lines.length ? lines : t.lines);
  }

  function showResult() {
    const res = currentRes;
    const htBefore = S.hypeTier(g).name;
    const reward = R.applyResult(g, res);
    const trustNews = settleBrief(res);
    // 注目度の段が上がったら、それもオーナーの名になる
    if (S.hypeTier(g).name !== htBefore && (res.hypeDelta || 0) > 0) {
      grantFame(D.fameOf('hype'), '注目度の段が上がった');
    }
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
      // ---- ピットへの信頼 ----
      // ブリーフィングで言ったことが、結果として返ってきたかどうか
      if (trustNews) {
        body += '<p class="note' + (trustNews.good ? ' good' : ' warn') + '">' +
          '🗣️ ' + esc(trustNews.name) + '：' + esc(trustNews.reply) + ' と返した週末は、' +
          (trustNews.good ? '結果でも応えられた。' : '結果が伴わなかった。') +
          ' ピットへの信頼 <b>' + trustNews.before + ' → ' + trustNews.after + '</b>' +
          '（' + trustNews.tier.icon + trustNews.tier.name + '）</p>';
      }
      // 指示を飲み込めなかった周があれば、そのことも出す
      {
        const defied = (res.classified || []).filter(x => x.isPlayer && x.defied > 0);
        if (defied.length) {
          body += '<p class="note warn">📻 ' + defied.map(x =>
            esc(x.driver.name) + ' は <b>' + x.defied + '周</b>、ピットの指示とは違う走りをしました')
            .join('<br>') + '。信頼が戻るまでは、こういう周が出ます。</p>';
        }
      }
      // いまの順位に、どれだけの重みがあるのか
      if (!res.special) body += stakeBlock(false);
      // なぜその順位だったのかを分解して見せる
      body += raceDebrief(res);
      // 今日の無線をふり返る
      body += radioLog(res);
      if (res.fastestLap) {
        const scored = !res.fastestLap.dnf && res.fastestLap.pos <= D.POINTS.length && !res.special;
        body += '<p class="desc">⚡ ファステストラップ：' + esc(res.fastestLap.driver.name) +
          '（' + fmtTime(res.fastestLap.fastest) + '）' +
          (scored ? ' — 10位以内で完走のためボーナス <b>+1pt</b>' : ' — 10位以内ではないためボーナスなし') + '</p>';
      }

      // 性格に応じて調子が動き、ひとことを残す。
      // その日その車に何かが起きていれば、そちらを話す
      const said = [];
      res.classified.filter(e => e.isPlayer).forEach(e => {
        const q = raceQuote(e, res, said);
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

    /* 名声：週末でやったことがそのまま名になる。
       数字は D.FAME.SRC の表と同じものを使っているので、
       オーナー画面に出ている説明と食い違わない                */
    if (currentRes) {
      const F = D.fameOf;
      let f = 0;
      currentRes.entries.filter(e => e.isPlayer && !e.dnf).forEach(e => {
        f += Math.max(0, 22 - e.pos) * F('pos') + F('finish');
        if (e.pos === 1) f += F('win');
        else if (e.pos <= 3) f += F('podium');
        if (e.pos <= D.POINTS.length) f += F('points');
        if (e.grid === 1) f += F('pole');
      });
      const fl = currentRes.fastestLap;
      if (fl && fl.isPlayer) f += F('fastest');
      if (f > 0) grantFame(Math.round(f), 'レースの週末');
    }
    if (!raceCtx.special) g.nextRace++;
    g.special = null;
    g.drivers.forEach(d => levelCheck(d));
    // レースを1戦こなすと、現場にいた全員が経験を積む
    staffExpAll(7);
    staffExp('strategist', 14);
    staffExp('mechanic', 8);
    g.gridClean = false;          // グリッドで聞いた話が効くのは、その一戦だけ
    // 次の週は、持ち帰ったデータを囲んでの反省会になる
    if (currentRes) {
      const me = currentRes.classified.filter(e => e.isPlayer).sort((a, b) => a.pos - b.pos)[0];
      const win = currentRes.classified.filter(e => !e.dnf).sort((a, b) => a.pos - b.pos)[0];
      const laps = currentRes.laps;
      const lap = e => {
        const arr = (e.lapTimes || []).filter(v => v != null);
        const pit = (e.pitTime || []).reduce((a, v) => a + (v || 0), 0);
        return arr.length ? (arr.reduce((a, v) => a + v, 0) - pit) / arr.length : 0;
      };
      g.lastRace = me ? {
        track: currentRes.track.name,
        pos: me.dnf ? 0 : me.pos,
        dnf: !!me.dnf,
        gap: (me && win && lap(me) && lap(win)) ? Math.round((lap(me) - lap(win)) * 100) / 100 : 0,
        pits: (me.pits || []).length,
        pen: me.penalty || 0,
        laps: laps,
        // 反省会でのひとことを、その日の中身に合わせるための材料
        misses: me.misses || 0,
        passes: me.passes || 0,
        reason: me.dnfReason || '',
        rain: !!(currentRes.weather && currentRes.weather.wet),
        sc: !!currentRes.safetyCar,
        started: me.grid || 0
      } : null;
      g.debrief = 2;                 // endWeek で1つ減り、次の週に反省会ができる
    }
    // 信頼が底を割ったドライバーがいれば、まずその話を聞く
    const nextUp = () => {
      const raid = S.poachAttempt(g);
      if (raid) { askPoach(raid); return; }
      endWeek();
    };
    if (checkLeave(nextUp)) return;
    nextUp();
  }

  /* =======================================================
     合同デブリーフィング
     ドライバーもエンジニアもメカニックも、一つの場に集まって
     前のレースを振り返る。最後に「次はどこを直すか」を決める。
     ======================================================= */
  function doDebrief() {
    const lr = g.lastRace;
    if (!lr) return;
    const topOf = keys => (g.staff || []).filter(x => keys.indexOf(x.type) >= 0)
      .sort((a, b) => b.skill - a.skill)[0];
    const eng = topOf(['engineer', 'designer']);
    const mech = topOf(['mechanic']);
    const strat = topOf(['strategist']);

    // 持ち帰った研究ポイント。前を走る車との差が大きいほど拾えるものが多い
    const fromGap = Math.min(26, Math.max(0, lr.gap) * 11);
    const base = 6 + (eng ? eng.skill * 0.22 : 0) + S.osk(g, 'eye');
    const rp = Math.round((base * 1.8 + fromGap + (lr.dnf ? 10 : 0))
                          * (1 + S.osk(g, 'eye') * 0.1));

    // 出席者のひとこと
    const said = [];
    const lineup = S.allTeams(g, S.trackAt(g, g.nextRace))
      .find(x => x.isPlayer).drivers;
    // ドライバーの言い分は二人で重ならないようにする
    const POOL = {
      win: ['「勝ちました。ここまで来られたのは、全員のおかげです」',
            '「最後の数周は、うしろを見ないようにしていました」',
            '「クルマが完璧でした。これを続けましょう」',
            '「表彰台のいちばん高いところは、やっぱり景色が違いますね」',
            '「ずっとこの日を待っていました。次も勝ちます」'],
      dnf: ['「途中で終わってしまった。次は必ず持ち帰ります」',
            '「あそこは避けられました。自分の責任です」',
            '「マシンは悪くなかった。それだけに悔しい」',
            '「手応えはあっただけに、最後まで走りたかった」',
            '「歩いて戻る道が、いちばん長く感じます」',
            '「悔やんでも仕方ない。次の週末に切り替えます」'],
      broke: ['「止まる直前、いつもと違う音がしていました」',
              '「マシンを信じて踏んでいただけに、残念です」',
              '「壊れたものは仕方ない。原因を潰しましょう」',
              '「ペースは良かった。あれで走り切れていたら…」'],
      crash: ['「自分のミスです。言い訳はしません」',
              '「あそこは行くべきではなかった。次に活かします」',
              '「相手も引かなかった。ああなると避けようがない」',
              '「一瞬でした。気づいたら壁が来ていました」'],
      good: ['「マシンは良かった。あと少しで、もっと上に行けます」',
             '「今日は全部つながりました。この形を続けたい」',
             '「タイヤの使い方がはまりました」',
             '「表彰台に上がると、また欲が出ますね」',
             '「クルマが素直でした。行きたいところに行ってくれる」',
             '「あと1周あれば、前を捕まえられていました」'],
      far: ['「コーナーの入口で我慢が利かない。そこが直れば違います」',
            '「ストレートで並ばれると、もう抵抗できません」',
            '「クルマがまだ言うことを聞いてくれない感じがします」',
            '「前の車について行くと、すぐタイヤが終わってしまう」',
            '「正直、今日は何をしても届かなかったと思います」',
            '「乗り方でごまかせる範囲を、もう超えています」',
            '「速い車の後ろで、勉強させてもらいました」',
            '「立ち上がりで置いていかれる。そこが全部です」'],
      near: ['「悪くない感触でした。あとは細かいところです」',
             '「あと少しの詰めだと思います。方向は合っています」',
             '「ピットのタイミング次第では、もう一つ前に行けました」',
             '「あと0.2秒。そこに全部が詰まっています」',
             '「戦えている実感はあります。もう一押しです」',
             '「今日の順位は、いまの実力どおりだと思います」'],
      rain: ['「あの路面では、誰もが手探りでした」',
             '「見えないんです。前の車のしぶきで、本当に何も」',
             '「雨は嫌いじゃありません。差を詰められる日ですから」'],
      messy: ['「今日は自分が乱れました。集中を切らさないようにします」',
              '「何度も飛び出しかけました。限界の見極めが甘かった」',
              '「あれだけミスをして、この順位なら上出来かもしれません」'],
      charge: ['「後ろから来る日は、走っていて楽しいですね」',
               '「抜けるクルマでした。それがいちばんの収穫です」',
               '「前が詰まっていたので、隙を探し続けました」']
    };
    // その日いちばん語るべきことを選ぶ。ミスの多い日、雨の日、追い上げた日…
    const bucket = lr.dnf ? (['クラッシュ', 'コースアウト', '接触'].indexOf(lr.reason) >= 0
                             ? (Math.random() < 0.6 ? 'crash' : 'dnf')
                             : (Math.random() < 0.6 ? 'broke' : 'dnf'))
                 : lr.pos === 1 ? 'win'
                 : lr.misses >= 2 && Math.random() < 0.5 ? 'messy'
                 : lr.rain && Math.random() < 0.45 ? 'rain'
                 : lr.started - lr.pos >= 5 && Math.random() < 0.55 ? 'charge'
                 : lr.pos <= 3 ? 'good' : lr.gap > 1.2 ? 'far' : 'near';
    const used = [];
    lineup.forEach(d => {
      const p = S.persOf(d);
      const cand = POOL[bucket].filter(x => used.indexOf(x) < 0);
      const t = S.pick(cand.length ? cand : POOL[bucket]);
      used.push(t);
      said.push({ icon: p.icon, who: d.name + '（ドライバー）', text: t, face: d });
    });
    if (eng) {
      const gapTxt = lr.gap.toFixed(2);
      said.push({ icon: '👷', who: eng.name + '（' +
        (D.STAFF_TYPES.find(x => x.key === eng.type) || {}).name + '）',
        text: lr.gap > 1.2
          ? S.pick(['「優勝車とは1周 ' + gapTxt + '秒。これは乗り方では埋まりません」',
                    '「1周 ' + gapTxt + '秒。素性のところで負けています。設計から見直しましょう」',
                    '「差は ' + gapTxt + '秒。どこか一つではなく、全部が少しずつ足りていません」'])
          : lr.gap > 0.05
            ? S.pick(['「優勝車とは1周 ' + gapTxt + '秒。どこで失っているかは、だいたい見えました」',
                      '「1周あたり ' + gapTxt + '秒。中速コーナーの立ち上がりに集約されています」',
                      '「差は ' + gapTxt + '秒。ここまで来れば、詰められる数字です」',
                      '「' + gapTxt + '秒。データを見るかぎり、あと一段は残っています」'])
            : S.pick(['「タイムの出方は良好です。この方向で詰めましょう」',
                      '「今日のデータはきれいです。狙いどおりに出ています」',
                      '「速さは足りています。あとは週末の運び方の問題です」']) });
    }
    if (strat) {
      said.push({ icon: '🧠', who: strat.name + '（ストラテジスト）',
        text: lr.pen
              ? S.pick(['「' + lr.pen + '秒の加算が痛かった。仕掛けどころを整理します」',
                        '「裁定で ' + lr.pen + '秒。あの場面は引く判断もありました」',
                        '「' + lr.pen + '秒は、順位そのものです。次は線を越えないように」'])
              : lr.sc
                ? S.pick(['「セーフティカーで作戦が一度壊れました。次はもう一枚用意しておきます」',
                          '「隊列が詰まったところで、選択肢が限られました」',
                          '「あのタイミングで入れたのは正解でした」'])
                : lr.pits >= 3
                  ? S.pick(['「' + lr.pits + '回は多い。ピットで失った時間が響きました」',
                            '「刻みすぎました。次はもう少し引っぱります」'])
                  : lr.pits >= 2
                    ? S.pick(['「' + lr.pits + 'ストップでした。1回に減らせた可能性はあります」',
                              '「' + lr.pits + '回。悪くはないですが、最適だったかは微妙です」'])
                    : S.pick(['「' + lr.pits + 'ストップ。読みは当たっていました」',
                              '「引っぱりきりました。タイヤの使い方が良かった」']) });
    }
    if (mech) {
      const pu = S.puOf(g);
      const spare = pu.pool.length;
      const leftU = Math.max(0, S.puLimit(g) - pu.used);
      said.push({ icon: '🔩', who: mech.name + '（メカニック）',
        text: pu.life < 30
              ? (spare
                 ? '「PUが残り' + Math.round(pu.life) + '%。棚に' + spare + '基取ってあります、積み替えますか」'
                 : leftU > 0
                   ? '「PUが残り' + Math.round(pu.life) + '%。出力が落ちています。新品はあと' + leftU + '基使えます」'
                   : '「PUが残り' + Math.round(pu.life) + '%。これ以上替えると降格です。だましだまし行きましょう」')
              : pu.life < 60
                ? '「PUは残り' + Math.round(pu.life) + '%。まだ持ちますが、そろそろ替え時を決めてください」'
                : '「マシンは無事です。消耗品だけ替えておきます」' });
    }

    const FOCUS = [
      { k: 'car', icon: '🏎️', label: 'マシンの速さを詰める',
        note: 'いちばん弱いパーツに手が入る',
        run: () => {
          let worst = null, wk = null;
          D.PART_CATS.forEach(c => { const q = g.equipped[c.key];
            if (q && (!worst || q.power < worst.power)) { worst = q; wk = c; } });
          if (!worst) return 'とくに手を入れるところはなかった';
          const up = Math.round(S.rnd(3.0, 5.5) * S.devRate(g) * 10) / 10;
          worst.power = Math.round(Math.min(S.partCap(g, worst) * 1.3, worst.power + up) * 10) / 10;
          staffExp('engineer', 12);
          return '🏎️ ' + worst.name + ' に手を入れた（性能 +' + up + '）';
        } },
      { k: 'tyre', icon: '🛞', label: 'タイヤの使い方を見直す',
        note: 'ドライバーの技術が伸び、タイヤが保つようになる',
        run: () => {
          const ups = [];
          (g.drivers || []).forEach(d => {
            const up = S.rnd(1.6, 3.4);
            d.technique = S.clamp(d.technique + up, 1, 199);
            ups.push(d.name + ' 技術 +' + up.toFixed(1));
          });
          staffExp('strategist', 12);
          return '🛞 ' + ups.join('／');
        } },
      { k: 'pit', icon: '🔧', label: 'ピット作業を洗い直す',
        note: 'メカニックが伸び、クルーの疲れも抜ける',
        run: () => {
          staffExp('mechanic', 16);
          S.restCrew(g, S.rnd(8, 15));
          const puUp = S.nursePU(g, S.rnd(4, 9));
          return '🔧 ピット作業を洗い直した（クルーの疲労が回復' +
                 (puUp > 0 ? '／PUの残り +' + puUp + '%' : '') + '）';
        } },
      { k: 'strat', icon: '🧠', label: '作戦を見直す',
        note: 'ストラテジストが伸び、路面と天候の読みが上がる',
        run: () => {
          staffExp('strategist', 20);
          staffExp('analyst', 10);
          const before = S.readPower(g), bf = S.foresightOf(g);
          // ピットウォールとデータ班がそろって伸びる週
          const ups = [];
          (g.staff || []).filter(x => x.type === 'strategist' || x.type === 'analyst')
            .forEach(x => {
              const cap = S.staffCap(x);
              if (x.skill < cap) { x.skill = S.clamp(Math.round(x.skill + 1), 1, cap); ups.push(x.name); }
            });
          // まだ専門の人がいない週は、集めたデータが研究に回る
          let extra = '';
          if (!ups.length) {
            const rp2 = Math.round(S.rnd(8, 14) * (1 + S.analystPower(g) * 0.2));
            g.rp += rp2;
            extra = '／見る人がいないぶん、データは持ち帰った（研究P +' + rp2 + '）';
          }
          const after = S.readPower(g), af = S.foresightOf(g);
          return '🧠 週末のコールをひとつずつ検証した（作戦の読み ' +
                 before.toFixed(2) + ' → ' + after.toFixed(2) +
                 '／天候の読み ' + Math.round(bf * 100) + '% → ' + Math.round(af * 100) + '%' +
                 (ups.length ? '／' + ups.join('・') + ' の技能 +1' : '') + extra + '）';
        } },
      { k: 'check', icon: '🩺', label: 'マシンを総点検する',
        note: '全パーツのコンディションが戻り、壊れにくくもなる',
        run: () => {
          const mech = 1 + S.pitPower(g) * 0.2 + g.facilities.pit * 0.08;
          let sum = 0;
          D.PART_CATS.forEach(c => {
            const p2 = g.equipped[c.key];
            if (!p2 || c.key === 'pu') return;
            const before = p2.cond;
            p2.cond = S.clamp(p2.cond + S.rnd(9, 15) * mech, 10, 100);
            sum += p2.cond - before;
          });
          const puUp = S.nursePU(g, S.rnd(5, 10) * (1 + S.pitPower(g) * 0.18));
          // 現場で見つけた弱点は、そのまま「高耐久」の技術になっていく
          const tech = S.advanceTech(g, 'tough');
          staffExp('mechanic', 18);
          return '🩺 一台ずつ分解して見た（コンディション 合計 +' + Math.round(sum) +
                 (puUp > 0 ? '／PUの残り +' + puUp + '%' : '') +
                 '／信頼性 ' + Math.round(S.reliability(g)) + '%' +
                 '／🛡️高耐久 ' + (tech.up ? 'Lv.' + tech.lv + 'に上がった' : '+' + tech.gain) + '）';
        } },
      { k: 'crew', icon: '🗣️', label: 'まず全員をねぎらう',
        note: 'チームの空気が良くなる。ドライバーの調子が大きく上向く',
        run: () => {
          const ups = [];
          (g.drivers || []).forEach(d => {
            const up = S.rnd(8, 15) * S.persOf(d).rest;
            d.form = S.clamp(d.form + up, 62, 122);
            ups.push(d.name + ' 調子 +' + up.toFixed(0));
          });
          staffExpAll(10);
          S.addHype(g, 1.2);
          return '🗣️ ' + ups.join('／');
        } }
    ];

    let body = '<div class="brief-head"><b>' + esc(lr.track) + '　' +
      (lr.dnf ? 'リタイア' : lr.pos + '位') + '</b>' +
      '<span>優勝車との差 1周 ' + (lr.gap > 0 ? '+' : '') + lr.gap.toFixed(2) + '秒' +
      '／' + lr.pits + 'ストップ' + (lr.pen ? '／加算 ' + lr.pen + '秒' : '') + '</span></div>';
    body += '<div class="brief-list">';
    said.forEach(x => {
      body += '<div class="brief-row">' +
        '<span class="brief-ic">' + (x.face ? U.face(x.face, 28) : x.icon) + '</span>' +
        '<span class="brief-body"><em>' + esc(x.who) + '</em>' + x.text + '</span></div>';
    });
    body += '</div>';
    body += '<div class="rewardbox"><div>🔬 持ち帰った研究ポイント <b>+' + rp + '</b>' +
      '<small>' + (lr.gap > 0.05 ? '前を走る車との差が大きいほど、拾えるものは多い' : '悪くない週だった') +
      '</small></div></div>';
    body += '<div class="sub">次はどこを直しますか</div><div class="pick">';
    FOCUS.forEach((f, i) => {
      body += '<button class="pickbtn" data-k="db:' + i + '">' +
        '<span class="pb-ic" style="background:#8a6ad0">' + f.icon + '</span>' +
        '<span class="pb-body"><b>' + f.label + '</b><small>' + f.note + '</small></span>' +
        '<span class="pb-cost">決める</span></button>';
    });
    body += '</div>';

    let settled = false;
    U.modal('🔍 合同デブリーフィング', body, []);
    GP.sound.play('light');
    bindPick(k => {
      if (settled) return;
      settled = true;
      yardMark('yd:brief');
      g.rp += rp;
      const msg = FOCUS[+k.split(':')[1]].run();
      U.closeModal();
      U.log(g, '🔍 合同デブリーフィング（' + esc(lr.track) + '）研究P +' + rp, 'good');
      if (msg) { U.log(g, msg, 'good'); U.toast(msg, 'good'); }
      GP.sound.play('crit');
      S.save(g); render();
    });
    const prevClose = $('modalClose').onclick;
    $('modalClose').onclick = () => {
      $('modalClose').onclick = prevClose;
      if (settled) return;
      settled = true;
      yardMark('yd:brief');
      g.rp += rp;
      U.closeModal();
      U.log(g, '🔍 合同デブリーフィング（' + esc(lr.track) + '）研究P +' + rp, 'good');
      S.save(g); render();
    };
  }
  return {
    name: 'weekend',
    link: link,
    setG: function (v) { g = v; },
    api: { cmdRace: cmdRace, beginRace: beginRace, startRace: startRace, paidChip: paidChip, trustChip: trustChip, PERF_TO_SEC: PERF_TO_SEC, stakeBlock: stakeBlock, doDebrief: doDebrief }
  };
};

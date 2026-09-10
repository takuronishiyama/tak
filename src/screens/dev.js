/* =========================================================
   画面：車体と開発（改良・設計・研究・整備・練習）
   main.js から切り出したもの。中身はそのまま動かしていない。
   ほかの画面と共有しているものは、文脈（A）から link() で受け取る。
   ========================================================= */
window.GP = window.GP || {};
GP.screens = GP.screens || {};

GP.screens.dev = function (A) {
  'use strict';
  const D = GP.data, S = GP.state, U = GP.ui, R = GP.race, RV = GP.raceview;
  let g = null;
  /* ほかの画面と main.js から借りているもの。link() で埋まる */
  let $, PERF_TO_SEC, bindAct, bindPick, capSpend, cmdStaff, endWeek, esc, interiorHTML, levelCheck, money, paintInterior, render, staffExp, staffExpAll, techReport;
  function link() {
    $ = A.$;
    PERF_TO_SEC = A.PERF_TO_SEC;
    bindAct = A.bindAct;
    bindPick = A.bindPick;
    capSpend = A.capSpend;
    cmdStaff = A.cmdStaff;
    endWeek = A.endWeek;
    esc = A.esc;
    interiorHTML = A.interiorHTML;
    levelCheck = A.levelCheck;
    money = A.money;
    paintInterior = A.paintInterior;
    render = A.render;
    staffExp = A.staffExp;
    staffExpAll = A.staffExpAll;
    techReport = A.techReport;
  }


  /* =======================================================
     🏎️ 車体
     「改良」「開発」「研究」は、どれもマシンを速くする手だが、
     何が違うのか、いまどれを叩くべきなのかが分かりにくかった。
     噛み合いの図と見立てを先に見せて、そこから選ばせる。
     ここを開くだけでは週は進まない。
     ======================================================= */
  function cmdCar() {
    const t = D.TRACKS[Math.min(g.nextRace, D.TRACKS.length - 1)];
    const sc = Math.round(S.carScore(g, t));
    let body =
      '<div class="racehead"><b>🏎️ ' + esc(D.CAR_GENS[g.carGen].name) + '</b>' +
      '<span>' + esc(t.name) + ' でのマシン評価 ' + sc + '</span></div>' +
      mechMapSVG(g) + mechReadHTML(g) +
      '<div class="sub">何をしますか</div>' +
      '<p class="desc">どれも1週ぶんのコマンドです。' +
      '<b>改良</b>は積んでいるものを煮詰め、<b>開発</b>は新しいパーツと技術を作り、' +
      '<b>研究</b>はその一段手前で「何が効くか」を探します。</p>' +
      '<div class="pick">' +
      carPickHTML('🔧', '改良', 'いま積んでいるパーツを煮詰める',
        '性能が伸び、熟成が溜まると格（レアリティ）が上がって上限そのものが伸びる', 'imp') +
      carPickHTML('📐', '開発', '新しいパーツを作り、技術を伸ばす',
        'チームの技術（タグ）はどのパーツにも乗る。新型を設計して載せ替える', 'des') +
      carPickHTML('🔬', '研究', 'まだ図面になっていないものを探す',
        '知見が溜まり、改良1回ぶんの伸びが大きくなる。開発の一段手前', 'res') +
      '</div>';
    U.modal('🏎️ 車体', body, [{ label: '閉じる', fn: U.closeModal }], { wide: true });
    const go = { imp: cmdImprove, des: cmdDesign, res: cmdResearch };
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-car]'), b => {
      b.onclick = () => { GP.sound.play('tap'); go[b.dataset.car](); };
    });
  }
  function carPickHTML(icon, name, sub, note, key) {
    return '<button class="pickbtn" data-car="' + key + '">' +
      '<span class="pb-ic" style="font-size:19px">' + icon + '</span>' +
      '<span class="pb-body"><b>' + name + '</b><small>' + esc(sub) +
      '<br><em>' + esc(note) + '</em></small></span>' +
      '<span class="pb-cost">1週</span></button>';
  }

  /* =======================================================
     🧑‍✈️ ドライバー
     走らせる人まわりを1つにまとめる。練習と、下部組織の育成。
     ======================================================= */
  function cmdDriverMenu() {
    let body = '<div class="sub">いまのドライバー</div><div class="pick">';
    (g.drivers || []).forEach(d => {
      const fit = S.driverFit(g, d);
      const ct = S.careTier(d), p2 = S.persOf(d);
      body += '<div class="pickbtn done">' +
        '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' +
        '総合 ' + Math.round(S.driverRating(d)) + '／調子 ' + Math.round(d.form) +
        '／' + p2.icon + p2.name + '／' + ct.icon + ct.name +
        '<br><em>いまの車で <b>' + Math.round(fit.out * 100) + '%</b> 引き出せています' +
        '（乗りやすさ ' + (fit.drive >= 1 ? '+' : '') + Math.round((fit.drive - 1) * 100) + '%）</em>' +
        '</small></span></div>';
    });
    if (!(g.drivers || []).length) body += '<p class="desc">シートが空いています。</p>';
    body += '</div>' +
      '<div class="sub">何をしますか</div>' +
      '<p class="desc">乗りやすいマシンほど、ドライバーは持っているものをそのまま出せます。' +
      '車体の<b>ドライバビリティ</b>を上げるのも、腕を上げるのと同じだけ効きます。</p>' +
      '<div class="pick">' +
      carPickHTML('💪', '練習', '2人を鍛える', '走り込みで能力そのものが伸びる。1週ぶん', 'train') +
      carPickHTML('🎓', '育成', '下部組織の若手を見る', '若手の伸びと、スカウト。人事の育成タブへ', 'youth') +
      carPickHTML('👥', '人事', 'ドライバーの入れ替えと契約', '市場から獲る／リザーブを置く／解雇する', 'hr') +
      '</div>';
    U.modal('🧑‍✈️ ドライバー', body, [{ label: '閉じる', fn: U.closeModal }], { wide: true });
    const go = { train: cmdTrain,
                 youth: () => { A.hrTab = 'youth'; cmdStaff(); },
                 hr: () => { A.hrTab = 'drivers'; cmdStaff(); } };
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-car]'), b => {
      b.onclick = () => { GP.sound.play('tap'); go[b.dataset.car](); };
    });
  }

  /* =======================================================
     コマンド：開発
     ======================================================= */
  const improveCost = p => S.perkPrice(g, 'improve',
    Math.round(D.PART_CATS.find(c => c.key === p.cat).cost * (1 + p.power / 20)));
  const designCost = () => ({
    money: S.perkPrice(g, 'design', Math.round(1000 + g.carGen * 2200)),
    rp: Math.round(26 + g.carGen * 24)
  });

  let useTicket = false;

  function cmdImprove() {
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
    // いちばん煮詰まっていないパーツ。ここが車全体の足を引っぱっている。
    // どれも似た仕上がりのときは、わざわざ名指ししない
    let weakest = null;
    {
      const rs = D.PART_CATS.map(c => {
        const q = g.equipped[c.key];
        if (!q || (c.key === 'pu' && q.supplied)) return null;
        return { key: c.key, r: q.power / S.partCap(g, q) };
      }).filter(Boolean).sort((a, b) => a.r - b.r);
      if (rs.length >= 2 && rs[1].r - rs[0].r >= 0.06) weakest = rs[0].key;
    }
    // 世代の進み具合は、手を入れるこの画面にも出しておく
    {
      const nxg = D.CAR_GENS[g.carGen + 1];
      if (nxg) {
        const gp = Math.round(S.genProgress(g) / S.GEN_STEP_AT * 100);
        const lag = S.genLagging(g);
        body += '<div class="genline">' +
          '<b>🏎️ ' + D.CAR_GENS[g.carGen].name + ' → ' + nxg.name + '</b>' +
          '<span class="skbar big"><i style="width:' + Math.min(100, gp) + '%"></i></span>' +
          '<em>' + Math.min(100, gp) + '%</em>' +
          '<small>' + (lag.length
            ? '残り：' + lag.slice(0, 3).map(x => x.name + ' ' + Math.round(x.ratio * 100) + '%').join('・') +
              '　※上限に届いたパーツを叩いても、ここは進みません'
            : 'すべて上限。次の週でマシンが新しい世代になります') + '</small></div>';
      }
    }
    // ---- 機構の噛み合い ----
    body += '<div class="sub">🔗 機構の噛み合い</div>' +
      '<p class="desc">部位どうしにも、人と同じで「片方だけ厚くしても意味がない」' +
      '組み合わせがあります。<b>弱いほうの仕上がり</b>で効き目が決まるので、' +
      '噛み合う相手ごと育てたほうが、同じ数字でも速くなります。</p>' +
      mechMapSVG(g) + mechReadHTML(g);

    body += '<div class="sub">装着中パーツの改良</div>' +
      '<p class="desc">パーツは<b>速さ</b>を作ります。数字は「1回手を入れると、' +
      '次のコースで1周あたりどれだけ速くなるか」の目安です。' +
      '手を入れ続けると<b>熟成</b>が溜まり、満ちたところで<b>格（レアリティ）が上がって上限そのものが伸びます</b>。' +
      'タグ（追加効果）は「📐 開発」の担当です。</p><div class="pick">';
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
      const pv = improvePreview(c);
      const pct = Math.round(pv.ratio * 100);
      const num = v => (v >= 0 ? '+' : '') + (Math.round(v * 10) / 10);
      // いま何を担っていて、1回でどこがどれだけ動くか
      const nowLine = [['速さ', pv.cur.speed], ['コーナー', pv.cur.corner], ['加速', pv.cur.accel]]
        .filter(x => x[1] > 0.05)
        .map(x => x[0] + ' ' + (Math.round(x[1] * 10) / 10)).join('／');
      const upLine = [['速さ', pv.dSpeed], ['コーナー', pv.dCorner], ['加速', pv.dAccel]]
        .filter(x => Math.abs(x[1]) > 0.02)
        .map(x => x[0] + ' ' + num(x[1])).join('／');
      body += '<button class="pickbtn devrow' + (weakest === c.key ? ' weak' : '') +
        '" data-k="imp:' + c.key + '"' + ((ok && !locked) ? '' : ' disabled') + '>' +
        '<span class="pb-ic ic-art" style="background:' + c.color + '">' + U.partIcon(c.key, 26, p.rarity) + '</span>' +
        '<span class="pb-body"><b>' + esc(p.name) +
        (weakest === c.key ? '<em class="weakchip">いちばん薄いところ</em>' : '') +
        // 研究で溜めた知見。この部位を改良すると、1つ使って大きく伸びる
        (S.findingsOf(g, c.key)
          ? '<em class="findchip" title="🔬 研究の知見。改良1回に乗って、伸びと熟成が ×' +
            D.RESEARCH.polMul.toFixed(2) + ' になります">🔬 知見 ' +
            S.findingsOf(g, c.key) + '</em>' : '') + '</b>' +
        '<small>' + c.name + '　性能 <b>' + Math.round(p.power) + '</b> / 上限 ' + cap +
        '（' + pct + '%）' +
        (locked ? ' <em class="warn">供給中は開発できません</em>'
                : (capped ? ' <em class="warn">上限到達。伸びは3割まで落ちます</em>' : '')) +
        '<span class="skbar"><i style="width:' + pct + '%;background:' + c.color + '"></i></span>' +
        '<span class="devnow">いまの寄与 ' + (nowLine || '—') + '</span>' +
        (locked ? '' :
          '<span class="devup">1回で 性能 +' + (Math.round(pv.gain * 10) / 10) +
          (upLine ? '　→　' + upLine : '') +
          '　<b>およそ ' + (pv.dSec >= 0 ? '-' : '+') + Math.abs(pv.dSec).toFixed(3) + '秒/周</b>' +
          secGainLine(pv) +
          (pv.toNext > 0.05 ? '　＋来季へ ' + (Math.round(pv.toNext * 10) / 10) : '') + '</span>') +
        // 熟成。手を入れ続けると、このパーツの「格」そのものが上がる
        (locked ? '' : (p.rarity >= D.RARITY.length
          ? '<span class="devpol">✨ 【' + D.RARITY[p.rarity - 1].name + '】これ以上の格はありません</span>'
          : '<span class="devpol">熟成 <span class="polbar"><i style="width:' +
            Math.round((p.polish || 0) * 100) + '%"></i></span>' +
            'あと ' + S.polishLeft(g, p) + '回で【' + D.RARITY[p.rarity].name + '】へ格上げ</span>')) +
        '</small></span>' +
        '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>' : '💰' + money(cost) + '<br>🔬' + c.rp) + '</span></button>';
    });
    // ---- 車体開発 ----
    const cap = S.bodyCap(g);
    // 車体は1回でどれだけ煮詰まるか（パーツと同じ式から出す）
    const bodyStep = a => {
      const facBonus = 1 + g.facilities.factory * 0.10;
      const engBonus = 1 + S.devPower(g) * 0.14;
      const drvBonus = 1 + g.drivers.reduce((x, d) => x + S.persOf(d).dev, 0);
      let gain = 3.4 * facBonus * engBonus * drvBonus * planMul(a.gain) * S.devRate(g);
      if (((g.body && g.body[a.key]) || 0) >= cap) gain *= 0.30;
      const fc = S.focusOf(g);
      return { now: gain * fc.cur, next: gain * fc.next };
    };
    body += '</div><div class="sub">車体の熟成</div>' +
      '<p class="desc">パーツが<b>速さ</b>なら、車体は<b>壊れにくさ・タイヤの保ち・乗りやすさ・ピット作業</b>です。' +
      '効き方は「その項目の上限に対して何割まで煮詰めたか」で決まります。<br>' +
      '車体の各項目の上限は、いまのマシン（' + D.CAR_GENS[g.carGen].name + '）で <b>' + cap + '</b>' +
      '（パーツの上限とは別ものです）。世代が上がると、ここも上がります。' +
      'ライバルはおおむね<b>50%</b>の仕上がりなので、そこを超えたぶんが差になります。</p><div class="pick">';
    D.BODY_ATTRS.forEach(a => {
      const v = (g.body && g.body[a.key]) || 0;
      const cost = bodyCost(v);
      const capped = v >= cap;
      const ok = useTicket || (g.funds >= cost && g.rp >= 8);
      const pct = Math.min(100, v / cap * 100);
      const st = bodyStep(a);
      const pct2 = Math.min(100, (v + st.now) / cap * 100);
      body += '<button class="pickbtn devrow" data-k="bdy:' + a.key + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:' + a.color + '">' + a.icon + '</span>' +
        '<span class="pb-body"><b>' + a.name +
        (pct >= 50 ? '<em class="overchip">ライバル超え</em>' : '') + '</b>' +
        '<small>' + a.desc +
        '<span class="skbar"><i style="width:' + pct + '%;background:' + a.color + '"></i>' +
        '<u style="left:50%"></u></span>' +
        '<span class="devnow">仕上がり <b>' + Math.round(pct) + '%</b>' +
        '（' + (Math.round(v * 10) / 10) + ' / ' + cap + '）　' + a.eff + '</span>' +
        '<span class="devup">1回で ' + Math.round(pct) + '% → <b>' + Math.round(pct2) + '%</b>' +
        (st.next > 0.05 ? '　＋来季へ ' + (Math.round(st.next * 10) / 10) : '') +
        (capped ? '　<em class="warn">上限到達。伸びは3割まで落ちます</em>' : '') + '</span>' +
        '</small></span>' +
        '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>' : '💰' + money(cost) + '<br>🔬8') + '</span></button>';
    });

    body = techReport() + body;

    // ---- 規則変更の予告 ----
    if (S.regulationNext(g)) {
      body += '<div class="regwarn">' +
        '<b>📜 今季が終わると、レギュレーションが変わります</b>' +
        '<small>いま積み上げているパーツと車体は、来季には白紙に戻ります。' +
        'ただし<b>設計のレアリティ</b>と<b>保管しているパーツ</b>、そして' +
        '<b>「来季に回した開発」</b>は新しい規則にそのまま持ち越せます。<br>' +
        '今季を捨てて来季に振るなら、開発リソースの配分を「来季優先」寄りに。' +
        '設計したパーツは売らずに保管しておくと、次の規則の土台になります。</small></div>';
    }

    // ---- 今季の予算 ----
    const capPct = Math.min(140, S.capRatio(g) * 100);
    const overCap = S.capSpent(g) > S.costCap(g);
    body += '<div class="capbox' + (overCap ? ' over' : capPct > 80 ? ' warn' : '') + '">' +
      '<b>🧾 今季の予算 ' + money(S.capSpent(g)) + ' / ' + money(S.costCap(g)) + '万</b>' +
      '<span class="skbar big"><i class="' + (overCap ? 'f2' : capPct > 80 ? 'f1' : 'f0') +
        '" style="width:' + Math.min(100, capPct) + '%"></i></span>' +
      '<em>' + Math.round(capPct) + '%</em>' +
      '<small><b>対象</b>：車体開発・パーツの設計／改良／合成・現場の応援要員。<br>' +
      '<b>対象外</b>：輸送費、スタッフとマネジメントの人件費、設備投資、パワーユニットの購入。<br>' +
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
    body += aduoBoxHTML(true) + innovBoxHTML() + conceptBoxHTML();

    body += '</div>';
    U.modal('🔧 改良', body, [
      { label: '📐 開発へ', fn: () => { U.closeModal(); cmdDesign(); } },
      { label: 'やめる', cls: 'primary', fn: U.closeModal }
    ]);
    paintInterior();
    const tg = $('tkToggle');
    if (tg) tg.onclick = () => { useTicket = !useTicket; GP.sound.play('tap'); cmdImprove(); };
    Array.prototype.forEach.call($('modalBody').querySelectorAll('.focusbtn'), b => {
      b.onclick = () => {
        g.focus = b.dataset.focus;
        GP.sound.play('tap');
        const f = S.focusOf(g);
        U.log(g, '📐 開発方針を「' + f.icon + f.name + '」にした。');
        S.save(g); render(); cmdImprove();
      };
    });
    bindPick(k => {
      const [kind, key] = k.split(':');
      if (kind === 'imp') doImprove(key);
      else if (kind === 'bdy') doBody(key);
    });
  }

  /* =======================================================
     コマンド：開発
     「新しいものを作る」側。ここでは技術（タグ）を積み上げ、
     新しいパーツを設計する。格（レアリティ）は改良の担当。
     ======================================================= */
  function cmdDesign() {
    const tk = g.tickets || 0;
    if (!tk) useTicket = false;
    let body = interiorHTML('factory');
    if (tk) {
      body += '<div class="ticketbar' + (useTicket ? ' on' : '') + '" id="tkToggle2">' +
        '<span class="tk-ic">🎫</span>' +
        '<span class="tk-body"><b>開発チケット ×' + tk + '</b>' +
        '<small>1枚使うと、次の開発・設計を資金も研究Pも使わずに行えます</small></span>' +
        '<span class="tk-sw">' + (useTicket ? '使う' : '使わない') + '</span></div>';
    }

    // ---- 技術開発 ----
    body += '<div class="sub">技術の開発</div>' +
      '<p class="desc">ここで積み上げるのは<b>チームの技術</b>です。' +
      '一度ものにした技術は、パーツを作り替えても、載せ替えても失われません。' +
      'レベルが上がるほど効きが強くなります。</p><div class="pick">';
    S.techList(g).forEach(t => {
      const c = S.techCost(g, t.key);
      const maxed = t.lv >= t.max;
      const ok = !maxed && (useTicket || (g.funds >= c.money && g.rp >= c.rp));
      const step = S.techStep(g);
      const left = maxed ? 0 : Math.max(1, Math.ceil((1 - t.p) / Math.max(0.001, step)));
      const now = t.lv > 0 ? (t.per >= 1 ? '+' + (t.lv * t.per).toFixed(1)
                                         : '+' + Math.round(t.lv * t.per * 100) + '%') : '—';
      body += '<button class="pickbtn techrow" data-k="tec:' + t.key + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:' + t.color + '">' + t.icon + '</span>' +
        '<span class="pb-body"><b>' + t.name +
          '<em class="techlv">Lv.' + t.lv + ' / ' + t.max + '</em></b>' +
        '<small>' + esc(t.desc) + '（' + t.eff + '）　いまの効き <b>' + now + '</b>' +
        '<span class="techbar"><i style="width:' + Math.round((maxed ? 1 : t.p) * 100) + '%;background:' + t.color + '"></i></span>' +
        (maxed ? '<span class="devup">これ以上は上がりません</span>'
               : '<span class="devup">あと ' + left + '回でLv.' + (t.lv + 1) + '　' +
                 '<em class="pnote">' + esc(t.note) + '</em></span>') +
        '</small></span>' +
        '<span class="pb-cost">' + (maxed ? '—'
          : useTicket ? '<b class="free">🎫 無料</b>'
          : '💰' + money(c.money) + '<br>🔬' + c.rp) + '</span></button>';
    });
    body += '</div>';

    // ---- パーツの設計 ----
    const dc = designCost();
    body += trendBoxHTML();
    body += '<div class="sub">新しいパーツを設計する</div>' + workshopBoxHTML() +
      '<p class="desc">できたパーツは保管され、「マシン」から装着・合成できます。' +
      '格（レアリティ）は、<b>改良で煮詰めて上げるもの</b>です。ここで出るのは出発点です。</p>' +
      '<div class="pick">';
    const desCut = S.perkCut(g, 'design');
    D.PART_CATS.forEach(c => {
      const ok = useTicket || (g.funds >= dc.money && g.rp >= dc.rp);
      body += '<button class="pickbtn" data-k="des:' + c.key + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic ic-art" style="background:' + c.color + '">' + U.partIcon(c.key, 26, 0) + '</span>' +
        '<span class="pb-body"><b>' + esc(S.partModel(c.key, g.carGen)) + ' を設計</b>' +
        '<small>' + c.name + '<br><em class="pnote">' + esc(S.partNote(c.key, g.carGen)) +
        '</em></small></span>' +
        '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>'
          : (desCut > 0 ? '<s>💰' + money(Math.round(dc.money / (1 - desCut))) + '</s><br>' : '') +
            '💰' + money(dc.money) + '<br>🔬' + dc.rp) + '</span></button>';
    });
    body += '</div>';

    U.modal('📐 開発', body, [
      { label: '🔧 改良へ', fn: () => { U.closeModal(); cmdImprove(); } },
      { label: 'やめる', cls: 'primary', fn: U.closeModal }
    ]);
    paintInterior();
    const tg2 = $('tkToggle2');
    if (tg2) tg2.onclick = () => { useTicket = !useTicket; GP.sound.play('tap'); cmdDesign(); };
    bindPick(k => {
      const [kind, key] = k.split(':');
      if (kind === 'tec') doTech(key);
      else if (kind === 'des') doDesign(key);
    });
    bindAct('data-copytrend', () => doCopyTrend());
    bindAct('data-leadcopy', () => doLeadCopy());
  }

  /* ---- 首位のマシンを写す ---- */
  function doLeadCopy() {
    const c = S.leadCopy(g);
    if (!c || !c.ok) return;
    if (g.funds < c.cost || g.rp < c.rp) return U.toast('資金か研究Pが足りません', 'bad');
    g.funds -= c.cost; g.rp -= c.rp; capSpend(c.cost);
    const r = S.doLeadCopy(g);
    if (!r) return;
    U.closeModal();
    U.log(g, '📸 ' + esc(r.team) + ' のマシンを起こして持ち込んだ（全パーツ +' +
      (r.gain * 100).toFixed(1) + '％）', 'good');
    U.toast('📸 首位のマシンを写した', 'good');
    GP.sound.play('levelup');
    S.pushNews(g, 'trend', r.team + 'のマシン', { by: r.team });
    endWeek();
  }

  /* ---- 他所の解釈を持ち込む ----
     写すのは速い。ただし本家の写しでしかないので、届ききらない  */
  function doCopyTrend() {
    const cur = S.canCopyTrend(g);
    if (!cur || cur.tooEarly) return;
    const cost = D.TREND.playerCost, rp = D.TREND.playerRp;
    if (g.funds < cost || g.rp < rp) return U.toast('資金か研究Pが足りません', 'bad');
    g.funds -= cost; g.rp -= rp; capSpend(cost);
    const r = S.copyTrend(g);
    if (!r) return;
    U.closeModal();
    U.log(g, '📐 ' + esc(r.by) + ' の「' + esc(r.what) + '」を読み解いて持ち込んだ' +
      '（全パーツ +' + (r.gain * 100).toFixed(1) + '％／本家の ' +
      Math.round(r.ratio * 100) + '%）', 'good');
    U.toast('📐 他所の解釈を持ち込んだ', 'good');
    GP.sound.play('levelup');
    S.pushNews(g, 'trend', r.what, { by: r.by });
    endWeek();
  }

  /* 技術をひとつ進める。1週かかる */
  function doTech(key) {
    const t = D.PART_TRAITS.filter(x => x.key === key)[0];
    if (!t) return;
    if (S.techLv(g, key) >= D.TECH.max) return;
    const c = S.techCost(g, key);
    const free = spendTicket();
    if (!free) {
      if (g.funds < c.money || g.rp < c.rp) return;
      g.funds -= c.money; g.rp -= c.rp; capSpend(c.money);
    }
    const r = S.advanceTech(g, key);
    staffExp('designer', 12); staffExp('engineer', 4);
    U.closeModal();
    if (r.up) {
      const now = t.per >= 1 ? '+' + (r.lv * t.per).toFixed(1)
                             : '+' + Math.round(r.lv * t.per * 100) + '%';
      U.log(g, t.icon + ' 「' + t.name + '」が Lv.' + r.lv + ' になった（いまの効き ' + now + '）', 'good');
      U.toast(t.icon + ' ' + t.name + ' Lv.' + r.lv + '！', 'good');
      GP.sound.play('levelup');
      U.pop('Lv.' + r.lv, 'crit');
    } else {
      U.log(g, t.icon + ' 「' + t.name + '」の開発を進めた（+' + Math.round(r.gain * 100) + '%）');
      GP.sound.play('confirm');
    }
    endWeek();
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
    const facBonus = (1 + g.facilities.factory * 0.10 + g.facilities.tunnel * 0.06)
                   * S.rigMul(g, 'tunnel');
    const engBonus = 1 + S.devPower(g) * 0.12;
    const drvBonus = 1 + g.drivers.reduce((acc, d) => acc + S.persOf(d).dev, 0);
    const fc = S.focusOf(g);
    let gain = S.rnd(2.6, 4.2) * facBonus * engBonus * drvBonus * planMul((D.BODY_ATTRS.find(a => a.key === key) || {}).gain) * crunchMul() * S.devRate(g);
    let crit = false;
    if (Math.random() < 0.10) { gain *= 2.2; crit = true; }
    const brk = S.rollBreakthrough(g);
    if (brk) { gain *= D.INNOV.playerGain; crit = true; }
    if (v >= cap) gain *= 0.30;   // 上限に達しても、完全には止まらない
    const toNext = gain * fc.next;
    gain = Math.round(gain * fc.cur * 10) / 10;
    g.nextCar = (g.nextCar || 0) + toNext;
    g.body[key] = Math.round((v + gain) * 10) / 10;
    if (brk) {
      g.concepts = (g.concepts || []).concat([{
        body: key, what: brk, gain: gain, at: S.weekStamp(g)
      }]);
      S.pushNews(g, 'brk', brk);
      /* 掘り当てたものは隠しておけない。写真に撮られ、風洞で再現され、
         数戦のうちにグリッドの半分が同じ形になる                    */
      {
        const t2 = D.TRACKS[Math.min(g.nextRace, D.TRACKS.length - 1)];
        const sec = S.rnd(D.INNOV.secMin, D.INNOV.secMax);
        const mul = 1 + S.secToScore(g, sec) / Math.max(1, S.carScore(g, t2));
        S.setTrend(g, g.team, brk, mul, true, sec);
      }
    }

    U.closeModal();
    GP.sound.play(crit ? 'crit' : 'confirm');
    staffExp('engineer', 9); staffExp('designer', 4);
    U.log(g, a.icon + ' 車体の' + a.name + ' +' + gain.toFixed(1) +
      (brk ? '  🔬' + brk + '！' : crit ? '  ✨大きな発見！' : ''), crit ? 'good' : '');
    U.pop('+' + gain.toFixed(1) + ' ' + a.name, crit ? 'crit' : 'good');
    if (brk) U.toast('🔬 ' + brk + '！ 車体が一段上のものになった', 'good');
    else if (crit) U.toast('✨ 車体の' + a.name + 'で大きな発見！', 'good');
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

  /* ---- この1回で何がどれだけ動くのか ----
     金額と「性能 18 / 上限 30」だけでは、どのパーツに手を入れるべきか
     判断できない。実際に使っている式から、平均的な伸びと、
     それが車の速さ・1周のタイムにどう出るかを出しておく          */
  /* =======================================================
     機構の噛み合い図
     部位を多角形に並べ、噛み合う相手どうしを線で結ぶ。
     線の太さがそのまま「いま効いている量」で、細い線が伸びしろ。
     人の組織図と同じ読みかたができるようにしてある。
     ======================================================= */
  /* 輪は二重。内は「車体の熟成」、外は「装着パーツ」。
     噛み合う相手が同じ角度に来るよう、並び順は手で決めてある。
     いちばん外の弧はチームの技術で、これは全パーツに乗る。      */
  const MECH_INNER = [
    { b: 'aeroBody', s: '空力' }, { b: 'drive', s: '乗り味' }, { b: 'rigidity', s: '剛性' },
    { b: 'light', s: '軽量' }, { b: 'cooling', s: '冷却' }, { b: 'service', s: '整備' },
    { b: 'battery', s: '電池' }
  ];
  const MECH_OUTER = [
    { p: 'aero', s: 'エアロ' }, { p: 'susp', s: 'サス' }, { p: 'chas', s: 'シャシー' },
    { p: 'gear', s: 'ギア' }, { p: 'pu', s: 'パワー' }, { p: 'brake', s: 'ブレーキ' },
    { p: 'elec', s: '電装' }
  ];
  const mechKey = m => (m.p ? 'p:' + m.p : 'b:' + m.b);

  function mechMapSVG(g2) {
    const syn = S.mechSynergy(g2);
    const CX = 240, CY = 238;
    // 内の輪の名前は輪の内側へ。外へ出すと、外の輪の節とぶつかる
    const R1 = 82, R2 = 152, L1 = 51, L2 = 186, R3 = 214;

    const place = (list, R, RL) => {
      const N = list.length;
      return list.map((m, i) => {
        const a2 = -Math.PI / 2 + i / N * Math.PI * 2;
        return { m: m, a: a2, x: CX + Math.cos(a2) * R, y: CY + Math.sin(a2) * R,
                 lx: CX + Math.cos(a2) * RL, ly: CY + Math.sin(a2) * RL };
      });
    };
    const inner = place(MECH_INNER, R1, L1);
    const outer = place(MECH_OUTER, R2, L2);
    const pos = {};
    inner.forEach(q => { pos[mechKey(q.m)] = q; });
    outer.forEach(q => { pos[mechKey(q.m)] = q; });

    // ---- 輪そのもの（うっすら円を敷いて、層があることを見せる）----
    let rings = '';
    [R1, R2].forEach(r => {
      rings += '<circle cx="' + CX + '" cy="' + CY + '" r="' + r +
        '" class="mm-ring"></circle>';
    });
    rings += '<circle cx="' + CX + '" cy="' + CY + '" r="' + R3 + '" class="mm-ring dash"></circle>';

    // ---- 線（噛み合い）----
    let lines = '';
    syn.forEach(x => {
      const A = pos[mechKey(x.def.a)], B = pos[mechKey(x.def.b)];
      if (!A || !B) return;
      const r = x.ratio;
      lines += '<line x1="' + A.x.toFixed(1) + '" y1="' + A.y.toFixed(1) +
        '" x2="' + B.x.toFixed(1) + '" y2="' + B.y.toFixed(1) +
        '" stroke="' + (x.on ? '#4ea63f' : '#8a8578') + '" stroke-width="' + (1.2 + r * 5.0).toFixed(2) +
        '" stroke-linecap="round" opacity="' + (0.20 + r * 0.7).toFixed(2) + '"></line>';
      if (x.on) {
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        lines += '<circle cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) +
          '" r="9" fill="#f0fbe8" stroke="#2e6b2e" stroke-width="1.5"></circle>' +
          '<text x="' + mx.toFixed(1) + '" y="' + (my + 3.2).toFixed(1) +
          '" class="mm-pct">' + Math.round(x.ratio * 100) + '</text>';
      }
    });

    // ---- 節 ----
    const nodeOf = (q, rr) => {
      const def = S.mechName(q.m);
      const sc = Math.min(1, S.mechScore(g2, q.m));
      const isP = !!q.m.p;
      const find = isP ? S.findingsOf(g2, q.m.p) : 0;
      let arc = '';
      if (sc > 0.001) {
        const a0 = -Math.PI / 2, a1 = a0 + sc * Math.PI * 2;
        const RR = rr + 3.5;
        if (sc >= 0.999) {
          arc = '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + RR +
            '" fill="none" stroke="' + def.color + '" stroke-width="3"></circle>';
        } else {
          const x0 = q.x + Math.cos(a0) * RR, y0 = q.y + Math.sin(a0) * RR;
          const x1 = q.x + Math.cos(a1) * RR, y1 = q.y + Math.sin(a1) * RR;
          arc = '<path d="M ' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A ' + RR + ' ' + RR +
            ' 0 ' + (sc > 0.5 ? 1 : 0) + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
            '" fill="none" stroke="' + def.color + '" stroke-width="3" stroke-linecap="round"></path>';
        }
      }
      return '<g>' + arc +
        '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + rr +
        '" class="mm-node ' + (isP ? 'part' : 'body') + '"></circle>' +
        '<text x="' + q.x.toFixed(1) + '" y="' + (q.y + 5.5).toFixed(1) + '" class="mm-ic">' +
        def.icon + '</text>' +
        (find ? '<circle cx="' + (q.x + rr * 0.72).toFixed(1) + '" cy="' + (q.y - rr * 0.72).toFixed(1) +
                '" r="6.5" fill="#3a7ad9" stroke="#0e0b14" stroke-width="1.5"></circle>' +
                '<text x="' + (q.x + rr * 0.72).toFixed(1) + '" y="' + (q.y - rr * 0.72 + 3).toFixed(1) +
                '" class="mm-find">' + find + '</text>' : '') +
        '<text x="' + q.lx.toFixed(1) + '" y="' + (q.ly + 3).toFixed(1) +
        '" class="mm-lb' + (isP ? '' : ' in') + '" ' +
        'text-anchor="' + (isP ? (Math.abs(Math.cos(q.a)) < 0.25 ? 'middle'
                          : (Math.cos(q.a) > 0 ? 'start' : 'end')) : 'middle') + '">' +
        esc(q.m.s) + '</text></g>';
    };
    const nodes = inner.map(q => nodeOf(q, 15)).join('') + outer.map(q => nodeOf(q, 17)).join('');

    // ---- 中心：マシンそのもの ----
    const st = S.carStats(g2);
    const gen = D.CAR_GENS[g2.carGen];
    const core = '<circle cx="' + CX + '" cy="' + CY + '" r="34" class="mm-core"></circle>' +
      '<text x="' + CX + '" y="' + (CY - 5) + '" class="mm-core-t">' + esc(gen.name) + '</text>' +
      '<text x="' + CX + '" y="' + (CY + 9) + '" class="mm-core-s">速' + Math.round(st.speed) +
      '／曲' + Math.round(st.corner) + '／加' + Math.round(st.accel) + '</text>';

    // ---- いちばん外の弧：チームの技術（全パーツに乗る）----
    let tech = '';
    D.PART_TRAITS.forEach((t, i) => {
      const lv = S.techLv(g2, t.key);
      const a2 = -Math.PI / 2 + (i + 0.5) / D.PART_TRAITS.length * Math.PI * 2;
      const x = CX + Math.cos(a2) * R3, y = CY + Math.sin(a2) * R3;
      tech += '<g opacity="' + (lv ? 1 : 0.42) + '">' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="12" class="mm-tech"' +
        (lv ? ' style="fill:' + t.color + '"' : '') + '></circle>' +
        '<text x="' + x.toFixed(1) + '" y="' + (y + 4.5).toFixed(1) + '" class="mm-ic sm">' + t.icon + '</text>' +
        '<text x="' + x.toFixed(1) + '" y="' + (y + 25).toFixed(1) + '" class="mm-lb sm" text-anchor="middle">' +
        esc(t.name) + (lv ? ' ' + lv : '') + '</text></g>';
    });

    return '<div class="mechmap"><svg viewBox="0 0 480 500" role="img">' +
      rings + lines + core + nodes + tech + '</svg>' +
      '<div class="mm-leg">' +
      '<span><i class="body"></i>内の輪：車体の熟成</span>' +
      '<span><i class="part"></i>外の輪：装着パーツ</span>' +
      '<span><i class="edge"></i>太い線ほど噛み合っている</span>' +
      '<span><i class="tech"></i>いちばん外：チームの技術（全パーツに乗る）</span>' +
      '<span><i class="find"></i>🔬 は研究の知見</span>' +
      '</div></div>';
  }

  /* ---- 見立てと、これからの方向 ----
     いまの車が何型で、どこが噛み合っていなくて、
     この先のコースを見たときに何を叩くべきか。
     数字の出どころは、レースで使っているものと同じ式。      */
  function mechReadHTML(g2) {
    const st = S.carStats(g2);
    const syn = S.mechSynergy(g2);
    const lift = S.mechLift(g2);
    const kind = S.tyreKind(g2);
    const df = S.dfBiasOf(st);

    // この先3戦。何が要るコースが続くのか
    const ahead = [];
    for (let i = g2.nextRace; i < Math.min(D.TRACKS.length, g2.nextRace + 3); i++) ahead.push(D.TRACKS[i]);
    const aw = { speed: 0, corner: 0, accel: 0 };
    ahead.forEach(t => { aw.speed += t.weight.speed; aw.corner += t.weight.corner; aw.accel += t.weight.accel; });
    const an = Math.max(1, ahead.length);
    ['speed', 'corner', 'accel'].forEach(k => { aw[k] /= an; });
    const NM = { speed: '最高速', corner: 'コーナー', accel: '加速' };
    const aheadTop = ['speed', 'corner', 'accel'].sort((a, b) => aw[b] - aw[a])[0];

    // うちの性能の偏り（釣り合った車と比べて、何が濃いか）
    const tot = Math.max(1, st.speed + st.corner + st.accel);
    const bias = { speed: st.speed / tot - 1 / 3, corner: st.corner / tot - 1 / 3, accel: st.accel / tot - 1 / 3 };
    const myTop = ['speed', 'corner', 'accel'].sort((a, b) => bias[b] - bias[a])[0];
    const myLow = ['speed', 'corner', 'accel'].sort((a, b) => bias[a] - bias[b])[0];

    // 伸びしろ：噛み合いのうち、まだ取り切れていない量を「弱いほう」に集める
    const room = {};
    syn.forEach(x => {
      const k = mechKey(x.weak);
      room[k] = (room[k] || 0) + (x.def.gain - x.gain);
    });
    const roomList = Object.keys(room).sort((a, b) => room[b] - room[a]);
    const nameOf = k => S.mechName(k[0] === 'p' ? { p: k.slice(2) } : { b: k.slice(2) });
    const worst = syn.slice().sort((a, b) => (a.ratio - b.ratio))[0];
    const best = syn.slice().sort((a, b) => (b.ratio - a.ratio))[0];

    const rows = [];
    // 見立て
    rows.push(['🔍', '見立て',
      S.machineChar(st) + '。' +
      (kind < 0.97 ? 'タイヤに優しく、長いスティントを引っぱれます。'
       : kind > 1.03 ? 'タイヤの当たりが強く、スティントは短めになります。' : '') +
      'ダウンフォース比 ' + (df * 100).toFixed(0) + '％（釣り合いは ' + Math.round(D.DF_REF * 100) + '％）。']);
    // 特徴
    if (best && best.on) {
      const A = S.mechName(best.def.a), B = S.mechName(best.def.b);
      rows.push(['✨', '特徴',
        A.icon + A.name + ' と ' + B.icon + B.name + ' が噛み合っています（' +
        Math.round(best.ratio * 100) + '％）。' + best.def.desc + '。']);
    } else {
      rows.push(['✨', '特徴',
        NM[myTop] + 'に振れた車です。まだどの部位も噛み合うところまで育っていません。']);
    }
    // 課題
    if (worst) {
      const W = S.mechName(worst.weak), O = S.mechName(
        mechKey(worst.weak) === mechKey(worst.def.a) ? worst.def.b : worst.def.a);
      rows.push(['⚠️', '課題',
        O.icon + O.name + ' に対して ' + W.icon + W.name + ' が薄く、「' + worst.def.name +
        '」が ' + Math.round(worst.ratio * 100) + '％ しか効いていません。' +
        (worst.ratio < 0.15 ? W.name + ' を先に育てないと、' + O.name + ' を叩いても返ってきません。' : '')]);
    }
    // 方向性
    {
      const t0 = ahead[0];
      let line = 'この先3戦は' + NM[aheadTop] + 'が効くコースが続きます。';
      if (t0) {
        const sw = GP.geom.sectorWeights(t0);
        const all = S.carScoreOf(st, t0);
        let bad = 0, badV = -1e9;
        sw.w.forEach((w, k) => {
          const d = (all - S.carScoreOf(st, { weight: w })) * sw.share0[k];
          if (d > badV) { badV = d; bad = k; }
        });
        line += esc(t0.name) + ' では S' + (bad + 1) + ' が弱点です。';
      }
      if (roomList.length && room[roomList[0]] > 0.004) {
        const R1 = nameOf(roomList[0]);
        line += R1.icon + R1.name + ' を伸ばすと、噛み合いの伸びしろがいちばん大きく残っています。';
      } else {
        line += NM[myLow] + 'が薄いので、そこを担う部位を叩くと素直に返ってきます。';
      }
      rows.push(['🧭', '方向性', line]);
    }

    return '<div class="mechread">' + rows.map(r =>
      '<div class="mr-row"><b>' + r[0] + ' ' + r[1] + '</b><span>' + r[2] + '</span></div>').join('') +
      '</div>' +
      '<div class="mechsum">' +
      ['速さ +' + (lift.speed * 100).toFixed(1) + '%',
       'コーナー +' + (lift.corner * 100).toFixed(1) + '%',
       '加速 +' + (lift.accel * 100).toFixed(1) + '%',
       'タイヤ -' + (lift.wear * 100).toFixed(1) + '%',
       '壊れにくさ +' + (lift.rel * 100).toFixed(1) + 'pt'
      ].map(x => '<span>' + x + '</span>').join('') + '</div>';
  }

  /* 1回の改良が、次のコースのどの区間で返ってくるか。
     いちばん効く区間だけを名指しする（3つ並べると読めない）   */
  function secGainLine(pv) {
    if (!pv.dSecs) return '';
    let best = 0;
    pv.dSecs.forEach((v, k) => { if (v > pv.dSecs[best]) best = k; });
    if (pv.dSecs[best] < 0.0004) return '';
    return '<em class="secgain">S' + (best + 1) + ' で -' + pv.dSecs[best].toFixed(3) + '秒</em>';
  }

  function improvePreview(c) {
    const p = g.equipped[c.key];
    if (!p) return null;
    const cap = S.partCap(g, p);
    const fc = S.focusOf(g);
    const wind = (c.key === 'aero' || c.key === 'susp');
    const facBonus = (1 + g.facilities.factory * 0.10 + (wind ? g.facilities.tunnel * 0.12 : 0))
                   * (wind ? S.rigMul(g, 'tunnel') : 1);
    const engBonus = 1 + S.devPower(g) * 0.14;
    const drvBonus = 1 + g.drivers.reduce((a, d) => a + S.persOf(d).dev, 0) + S.trustDev(g);
    let gain = 4.5 * facBonus * engBonus * drvBonus * planMul(c.gain) * S.devRate(g);
    if (c.key === 'pu') gain *= S.puDevMul(g);      // よそに配っているぶん、手が回らない
    if (p.power >= cap) gain *= 0.30;
    const now = gain * fc.cur, next = gain * fc.next;
    // 伸びたぶんが、車の速さにどう出るか
    const t = D.TRACKS[Math.min(g.nextRace, D.TRACKS.length - 1)];
    const before = S.carStats(g);
    const keep = p.power;
    p.power = keep + now;
    const after = S.carStats(g);
    p.power = keep;
    const dCar = S.carScoreOf(after, t) - S.carScoreOf(before, t);
    /* 区間ごとの効きかた。同じ1回でも、ダウンフォースは曲がりどころで、
       パワーは直線で返ってくる。足すと1周ぶんのタイムになる        */
    const sw = GP.geom.sectorWeights(t);
    const dSecs = sw.w.map((w, k) =>
      t.base * PERF_TO_SEC * 0.60 * sw.share0[k] *
      (S.carScoreOf(after, { weight: w }) - S.carScoreOf(before, { weight: w })));
    return {
      cur: S.partStats(p, g), gain: now, toNext: next, cap: cap,
      ratio: Math.min(1, p.power / cap),
      dSpeed: after.speed - before.speed,
      dCorner: after.corner - before.corner,
      dAccel: after.accel - before.accel,
      dCar: dCar,
      dSecs: dSecs,
      // perf は 車 0.60 ぶん。1周のタイムに直す
      dSec: t.base * PERF_TO_SEC * 0.60 * dCar
    };
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

    const wind = (key === 'aero' || key === 'susp');
    const facBonus = (1 + g.facilities.factory * 0.10 + (wind ? g.facilities.tunnel * 0.12 : 0))
                   * (wind ? S.rigMul(g, 'tunnel') : 1);
    const engBonus = 1 + S.devPower(g) * 0.14;
    // 現場に入れた道具のぶん
    const gearBonus = 1 + (S.hasGear(g, 'factory', 'jig') ? 0.06 : 0)
                        + (S.hasGear(g, 'factory', 'am')  ? 0.09 : 0);
    // ドライバーのフィードバック（職人肌ほど的確）
    const drvBonus = 1 + g.drivers.reduce((a, d) => a + S.persOf(d).dev, 0) + S.trustDev(g);
    const fc = S.focusOf(g);
    let gain = S.rnd(3.4, 5.6) * facBonus * engBonus * gearBonus * drvBonus * planMul(c.gain) * crunchMul() * S.devRate(g);
    if (key === 'pu') gain *= S.puDevMul(g);        // よそに配っているぶん、手が回らない
    let crit = false;
    // 研究で溜めた知見があれば、ここで1つ使う。何を直せばいいか分かっている
    const found = S.useFinding(g, key);
    if (found) gain *= D.RESEARCH.polMul;
    if (Math.random() < 0.12) { gain *= 2.2; crit = true; }
    /* ---- ブレイクスルー ----
       規則が新しいうちほど、まだ誰も掘っていないものが残っている。
       掘り当てると、熟成が一気に進む                                */
    const brk = S.rollBreakthrough(g);
    let upTo = null;
    let polGain = S.polishStep(g, p) * (found ? D.RESEARCH.polMul : 1);
    if (brk) {
      gain *= D.INNOV.playerGain; crit = true;
      polGain += 0.55;                 // 掘り当てたぶん、格に近づく
    }
    /* ---- 熟成 ----
       手を入れるたびに、そのパーツは少しずつ「良いもの」になっていく。
       満ちたところで格が上がり、到達できる上限そのものが伸びる      */
    if (p.rarity < D.RARITY.length) {
      p.polish = (p.polish || 0) + polGain;
      if (p.polish >= 1) { p.polish = 0; upTo = p.rarity + 1; }
    } else {
      p.polish = 0;
    }
    if (p.power >= cap) gain *= 0.30;   // 上限に達しても、完全には止まらない
    // 来季に回したぶんは今季に乗らない
    const toNext = gain * fc.next;
    gain = Math.round(gain * fc.cur * 10) / 10;
    g.nextCar = (g.nextCar || 0) + toNext;

    p.power = Math.round((p.power + gain) * 10) / 10;
    p.cond = S.clamp(p.cond - S.rnd(2.5, 7) * Math.max(0.4, 1 - S.techLv(g, 'tough') * 0.08), 10, 100);
    if (brk) {
      // 何を持ち込んだのかを控えておく。あとで裁定が出ることがある
      g.concepts = (g.concepts || []).concat([{
        cat: key, what: brk, rarUp: !!upTo, gain: gain, at: S.weekStamp(g)
      }]);
      S.pushNews(g, 'brk', brk);
    }
    if (upTo) {
      p.rarity = upTo;
      const rr = D.RARITY[upTo - 1];
      U.log(g, (brk ? '🔬 ' + brk + '！ ' : '✨ 熟成が実った！ ') + p.name +
        ' が【' + rr.name + '】に格上げ（上限も伸びた）', 'good');
      U.toast('✨ ' + rr.name + ' へ格上げ！', 'good');
      GP.sound.play('levelup');
    }

    const msg = c.icon + ' ' + p.name + ' の性能 +' + gain.toFixed(1) +
      (found ? '  🔬研究の知見をひとつ使った' : '') +
      (brk ? '  🔬' + brk + '！' : crit ? '  ✨ひらめき大成功！' : '');
    staffExp('engineer', 12); staffExp('designer', 3);
    U.log(g, msg, crit ? 'good' : '');
    GP.sound.play(crit ? 'crit' : 'confirm');
    if (p.power >= cap) U.toast('このパーツは限界です。残りも仕上げれば、マシンが次の世代へ進みます。', 'warn');
    // 手を入れた実感が出るように、伸びを見せてから週を進める
    showDevResult({
      icon: U.partIcon(c.key, 44, p.rarity), color: c.color,
      title: p.name,
      sub: upTo ? (brk ? '🔬 ' + brk + ' — ' : '✨ 熟成 — ') + '【' + D.RARITY[upTo - 1].name + '】へ'
         : brk ? '🔬 ' + brk : c.name,
      from: p.power - gain, to: p.power, cap: upTo ? S.partCap(g, p) : cap, gain: gain, crit: crit,
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

    const hinted = (g.designEdge || 0) > 0;
    const rarity = S.rollRarity(g);
    if (hinted) g.designEdge = Math.max(0, (g.designEdge || 0) - 1);   // ヒントは1回で使い切る
    const ws = S.workshopOf(g);
    const part = S.makePart(key, g.carGen, rarity);
    // 同じ図面でも、どの機械で削ったかで出来が変わる
    part.power = Math.round(part.power * ws.prec * 10) / 10;
    g.inventory.push(part);

    const rr = D.RARITY[rarity - 1];
    U.closeModal();
    U.log(g, '📐 ' + ws.icon + ' ' + ws.name + 'で ' + part.name + '（' + rr.name +
      '）が完成！ 性能 ' + Math.round(part.power), rarity >= 3 ? 'good' : '');
    GP.sound.play(rarity >= 4 ? 'crit' : 'confirm');
    staffExp('designer', 14); staffExp('engineer', 3);
    if (rarity >= 4) U.toast('🎉 ' + rr.name + 'パーツ「' + part.name + '」が完成！', 'good');
    else U.toast('📐 ' + part.name + '（' + rr.name + '）が完成', rarity >= 3 ? 'good' : '');
    U.pop(U.stars(rarity), rarity >= 4 ? 'crit' : 'good');

    // 装着中より強ければすすめる
    const cur = g.equipped[key];
    if (!cur || S.partScore(part, g) > S.partScore(cur, g)) {
      U.toast('装着中の ' + (cur ? cur.name : '—') + ' より強力です！「マシン」で装着しましょう。', 'good');
    }
    endWeek();
  }

  /* =======================================================
     コマンド：研究（研究P獲得＋設計ティア解放）
     ======================================================= */
  function cmdResearch() {
    const cur = D.CAR_GENS[g.carGen], nx = D.CAR_GENS[g.carGen + 1];
    const rp = S.researchPower(g);
    let body = interiorHTML('tunnel') +
      '<div class="pick">' +
      '<button class="pickbtn" data-k="__gain"><span class="pb-ic" style="background:#8a6ad0">📊</span>' +
      '<span class="pb-body"><b>データ解析</b><small>1週かけて研究ポイントを稼ぐ</small></span>' +
      '<span class="pb-cost">+' + Math.round(12 + S.analystPower(g) * 4 + g.facilities.sim * 2) + '🔬</span></button></div>';

    /* ---- 研究テーマ ----
       いきなり図面は引けない。まず「そもそも何が効くのか」を探す。
       溜まりきると知見がひとつ生まれ、次の改良1回に乗る          */
    body += '<div class="sub">🔬 研究テーマ</div>' +
      '<p class="desc"><b>リサーチ → 開発 → 改良</b>の、いちばん手前です。' +
      '部位をひとつ選んで1週かけて調べると、' + D.RESEARCH.need + ' まで溜まったところで' +
      '<b>知見</b>がひとつ生まれます。知見は次の <b>🔧 改良</b> 1回に乗り、' +
      '伸びと熟成が <b>×' + D.RESEARCH.polMul.toFixed(2) + '</b> になります' +
      '（部位ごとに ' + D.RESEARCH.keep + 'つまで抱えられます）。<br>' +
      '1週で進むのは <b>' + rp.toFixed(1) + '</b>。' +
      '🔬リサーチャー・📊アナリスト・風洞の規模・' +
      (S.hasEstate(g, 'lab') ? '<b>🔬リサーチセンター</b>' : '🔬リサーチセンター') +
      'で速くなります。<br>費用 💰' + money(D.RESEARCH.cost) + '万／🔬' + D.RESEARCH.rp +
      '（1週消費）</p><div class="pick">';
    S.researchList(g).forEach(r => {
      const poor = g.funds < D.RESEARCH.cost || g.rp < D.RESEARCH.rp;
      const full = r.found >= D.RESEARCH.keep;
      body += '<button class="pickbtn' + ((poor || full) ? ' done' : '') +
        '" data-k="res:' + r.key + '"' + ((poor || full) ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:' + r.color + '">' + r.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(r.name) +
          (r.found ? '　<em class="free">知見 ' + '🔬'.repeat(r.found) + '</em>' : '') + '</b>' +
        '<small><span class="skbar"><i style="width:' + r.pct + '%"></i></span> ' +
        r.p + ' / ' + r.need +
        (full ? '<br><b class="warn">これ以上は抱えられません。改良で使ってください</b>'
              : poor ? '<br><b class="warn">資金か研究Pが足りません</b>' : '') +
        '</small></span>' +
        '<span class="pb-cost">💰' + money(D.RESEARCH.cost) + '<br>🔬' + D.RESEARCH.rp + '</span></button>';
    });
    body += '</div>';

    body += '<div class="sub">マシンの世代</div>';
    body += '<p class="desc">現在のマシン：<b>' + cur.name + '</b>' +
      '（パーツの開発上限 ' + cur.cap + '／車体の熟成上限 ' + S.bodyCap(g) + '）</p>';
    if (!nx) {
      body += '<div class="bigbox">🏁 最終型 <b>' + cur.name + '</b> に到達済み</div>';
    } else {
      const prog = Math.round(S.genProgress(g) / S.GEN_STEP_AT * 100);
      const nv = S.nextCarPreview(g);
      const lag = S.genLagging(g);
      body += '<div class="genbox">' +
        '<b>' + cur.name + ' → ' + nx.name + '</b>' +
        '<span class="skbar big"><i style="width:' + Math.min(100, prog) + '%"></i></span>' +
        '<em>' + Math.min(100, prog) + '%</em>' +
        '<small>装着中のパーツを上限まで煮詰めると、マシンはひとりでに次の世代へ更新されます。' +
        '買い物ではないので、資金も研究Pも要りません。' +
        (lag.length
          ? '<br><b>残っているのは ' + lag.slice(0, 3).map(x => x.name + '（' +
            Math.round(x.ratio * 100) + '%）').join('・') + '</b>。' +
            '上限に届いたパーツをさらに叩いても、ここは進みません。'
          : '<br><b>パーツはすべて上限に届いています。次の週で世代が上がります。</b>') +
        (g.engine ? '<br>供給を受けているパワーユニットは、この計算に入りません' +
                    '（自分で開発できないため）。世代が上がると供給元の最新型に載せ替わります。' : '') +
        '<br>' +
        'パーツ上限 ' + cur.cap + ' → ' + nx.cap +
        '／車体上限 ' + S.bodyCap(g) + ' → ' + Math.round(nx.cap * D.BODY_CAP_RATIO) +
        '（各項目 <b>' + nv.withStock + '</b> から再スタート' +
        (nv.gain > 0 ? '／うち +' + nv.gain + ' は来季ぶんの仕込み' : '') + '）</small></div>';
    }
    /* パワーユニットの供給は、話が大きくなったので別の画面に移した。
       ここからも入れるようにしておく                              */
    body += '<div class="sub">パワーユニットの供給</div>' +
      '<p class="desc">' + (g.engine
        ? '<b>' + esc(g.engine.team) + '</b> から供給を受けています。'
        : (g.customers || []).length
          ? '<b>' + (g.customers || []).length + 'チーム</b>にパワーユニットを供給しています。'
          : 'よそから買うことも、こちらが供給する側に回ることもできます。') +
      '</p><div class="pick"><button class="pickbtn" data-k="__engscreen">' +
      '<span class="pb-ic engic">🔌</span>' +
      '<span class="pb-body"><b>エンジン供給の画面へ</b>' +
      '<small>買う・売る・契約を切る</small></span>' +
      '<span class="pb-cost">›</span></button></div>';

    U.modal('🔬 研究開発', body, [{ label: 'やめる', fn: U.closeModal }]);
    paintInterior();
    bindPick(k => {
      if (k === '__gain') return doResearchGain();
      if (k.indexOf('res:') === 0) return doResearch(k.slice(4));
      if (k === '__engoff') return doEngineOff();
      if (k.indexOf('__eng:') === 0) return doEngineOn(k.slice(6));
      if (k.indexOf('__cus:') === 0) return doCustomerOn(k.slice(6));
      if (k.indexOf('__cusoff:') === 0) return doCustomerOff(k.slice(9));
      if (k === '__engscreen') return cmdEngine();
    });
  }

  /* =======================================================
     エンジン供給
     買う側にも、売る側にも回れる。研究開発の一部だったが、
     どちらも一つの大きな判断なので、独立した画面にした
     ======================================================= */
  function cmdEngine() {
    let body = '<p class="lead">パワーユニットを<b>よそから買う</b>か、' +
      '<b>こちらが分ける</b>か。<br>' +
      'どちらも、開発の何年ぶんかを一度に動かす話になります。</p>';
    // ---- 買う側 ----
    // 自前で育てるか、強いチームから買うか。買えばすぐ速くなるが、
    // 供給を受けているあいだは自分で手を入れられず、毎戦の供給料もかかる。
    body += '<div class="sub">🔌 よそから買う</div>';
    if (g.engine) {
      const mine = g.equipped.pu;
      const stash = g.engineStash;
      const target = S.supplierPower(g, g.engine.team);
      body += '<div class="bigbox">🔌 <b>' + esc(g.engine.team) + '</b> から供給を受けています' +
        '<small>性能 ' + (mine ? Math.round(mine.power) : '-') +
        '／供給料 💰' + money(g.engine.fee) + '万 毎戦</small></div>' +
        '<div class="engcmp">' +
          '<div class="ec-row"><span>🔌 いま積んでいる供給品</span><b>' +
            (mine ? Math.round(mine.power) : '-') + '</b></div>' +
          '<div class="ec-row"><span>🏭 供給元がいま持っている水準</span><b>' + target + '</b></div>' +
          '<div class="ec-row dim"><span>🔧 預けてある自前のもの</span><b>' +
            (stash ? Math.round(stash.power) : '-') + '</b></div>' +
          (g.engine.grown ? '<div class="ec-row up"><span>📈 契約してから届いたぶん</span><b>+' +
            g.engine.grown.toFixed(1) + '</b></div>' : '') +
        '</div>' +
        '<p class="desc">供給中は、自分でパワーユニットを開発・交換できません。' +
        'そのかわり <b>供給元が開発したぶんが毎週こちらへ降りてきます</b>（ワークスより一段落とした仕様）。' +
        'パワーユニットに人を割かなくてよくなるので、<b>ほかの開発が ' +
        Math.round((D.ENGINE.freeDev - 1) * 100) + '% 速く</b>、出来合いを積むぶん <b>信頼性 +' +
        D.ENGINE.relBonus + '</b>。' +
        '契約を切ると、預けてある自前のパワーユニットに戻ります。</p>' +
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
          'すぐに速くなるうえ、<b>供給元が開発したぶんが毎週降りてくる</b>ので、' +
          '自分で手を入れなくても離されません。' +
          'パワーユニットから人を外せるぶん <b>ほかの開発が ' +
          Math.round((D.ENGINE.freeDev - 1) * 100) + '% 速く</b>なり、<b>信頼性 +' +
          D.ENGINE.relBonus + '</b>。' +
          'そのかわり毎戦の供給料がかかり、自分ではパワーユニットを育てられません' +
          '（ブレイクスルーも工作機械の精度も乗りません）。</p>' +
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

    body += customerBoxHTML();

    U.modal('🔌 エンジン供給', body, [{ label: 'とじる', fn: U.closeModal }]);
    paintInterior();
    bindPick(k => {
      if (k === '__engoff') return doEngineOff();
      if (k.indexOf('__eng:') === 0) return doEngineOn(k.slice(6));
      if (k.indexOf('__cus:') === 0) return doCustomerOn(k.slice(6));
      if (k.indexOf('__cusoff:') === 0) return doCustomerOff(k.slice(9));
    });
  }

  /* =======================================================
     こちらが供給する側になる
     自前のパワーユニットが業界の上位に立つと、
     分けてほしいという話が来る。金とデータが入るが、
     渡した相手はその日から速くなっていく。
     ======================================================= */
  function customerBoxHTML() {
    const P2 = D.PU_SUPPLY;
    const cus = g.customers || [];
    let h = '<div class="sub">よそへ供給する</div>';
    if (g.engine) {
      return h + '<p class="desc">いまは供給を<b>受けている</b>側です。' +
        '人に配るには、まず自前のパワーユニットに戻す必要があります。</p>';
    }
    const rank = S.puRank01(g);
    h += '<div class="purank"><span>🔌 自前のパワーユニット <b>' +
      Math.round(S.myPuPower(g)) + '</b></span>' +
      '<span>業界での位置 <b>上位 ' + Math.max(1, Math.round((1 - rank) * 100)) + '%</b></span>' +
      '<span>客に回す仕様 <b>' + Math.round(S.myPuPower(g) * P2.detune) + '</b></span></div>';

    if (cus.length) {
      h += '<div class="cuslist">' + cus.map(c => {
        const r = (g.rivals || []).filter(x => x.name === c.team)[0];
        return '<div class="cus-row">' +
          '<i style="background:' + (r ? r.color : '#888') + '"></i>' +
          '<b>' + esc(c.team) + '</b>' +
          '<span>毎戦 💰' + money(c.fee) + '万</span>' +
          '<span>渡したぶん <em class="warn">+' + (c.given || 0).toFixed(1) + '</em></span>' +
          '<span>あと' + c.left + '季</span></div>';
      }).join('') + '</div>' +
      '<p class="note warn">🔌 供給料は毎戦 <b>💰' + money(S.customerFee(g)) +
      '万</b>。そのかわり、うちが伸ばした最新仕様は<b>毎週そのまま先方に届いて</b>います。' +
      '自分のパワーユニット開発は <b>×' + S.puDevMul(g).toFixed(2) + '</b> に落ちます' +
      (g.puLearn ? '／客の壊れ方が分かるぶん、信頼性 <b>+' + (g.puLearn).toFixed(1) + '</b>' : '') +
      '。</p>';
      h += '<div class="pick">' + cus.map(c =>
        '<button class="pickbtn" data-k="__cusoff:' + esc(c.team) + '">' +
        '<span class="pb-ic engic">✂️</span>' +
        '<span class="pb-body"><b>' + esc(c.team) + ' への供給を切る</b>' +
        '<small>残り' + c.left + 'シーズンぶんの違約金がいります</small></span>' +
        '<span class="pb-cost">💰' + money(S.dropCustomerFee(g, c.team)) + '</span></button>').join('') +
        '</div>';
    }

    if (cus.length >= P2.max) {
      return h + '<p class="desc">これ以上は面倒を見きれません（上限 ' + P2.max + 'チーム）。</p>';
    }
    if (!S.canSupplyPU(g)) {
      return h + '<p class="desc">分けてほしいと言われるのは、' +
        '<b>自前のパワーユニットが業界の上位 ' +
        Math.round((1 - P2.needRank) * 100) + '% に入ってから</b>です。' +
        'いまはまだ、よそが欲しがる水準ではありません。</p>';
    }
    const offers = S.customerOffers(g);
    if (!offers.length) {
      return h + '<p class="desc">いまのところ、うちのパワーユニットを' +
        '欲しがっているチームはありません。</p>';
    }
    h += '<p class="desc">一時金と毎戦の供給料が入り、客が走らせたデータも戻ってきます' +
      '（研究P・信頼性）。<br>' +
      '<b class="warn">そのかわり、渡した相手はその日から速くなります。</b>' +
      'こちらが伸ばした最新仕様は、一段落としただけの形で毎週そのまま先方に届きます。' +
      '何年もかけて開いた差が、契約書一枚で埋まっていくということです。</p><div class="pick">';
    offers.forEach(o => {
      h += '<button class="pickbtn" data-k="__cus:' + esc(o.team) + '">' +
        '<span class="pb-ic engic" style="border-color:' + o.color + '">🔌</span>' +
        '<span class="pb-body"><b>' + esc(o.team) + ' に供給する</b>' +
        '<small>先方の自前 ' + o.own + ' → うちの仕様 <b>' + o.give + '</b>' +
        '（<em class="warn">+' + Math.round(o.gap) + '</em> 押し上げます）' +
        '<br>毎戦 💰' + money(o.fee) + '万　契約 ' + D.PU_SUPPLY.years + 'シーズン</small></span>' +
        '<span class="pb-cost">一時金<br>+' + money(o.upfront) + '</span></button>';
    });
    return h + '</div>';
  }

  function doCustomerOn(team) {
    const o = S.signCustomer(g, team);
    if (!o) return U.toast('いまは供給できません', 'bad');
    U.closeModal();
    U.log(g, '🔌 ' + team + ' にパワーユニットを供給することにした（一時金 +' +
      money(o.upfront) + '万／毎戦 ' + money(o.fee) + '万）。' +
      '先方の直線は、これから毎週こちらへ近づいてくる。', 'warn');
    U.toast('🔌 ' + team + ' へ供給開始', 'good');
    GP.sound.play('buy');
    S.save(g); render();
  }

  function doCustomerOff(team) {
    const fee = S.dropCustomerFee(g, team);
    if (S.dropCustomer(g, team) == null) return U.toast('違約金が払えません', 'bad');
    U.closeModal();
    U.log(g, '✂️ ' + team + ' への供給を打ち切った（違約金 -' + money(fee) + '万）。' +
      'すでに渡したものは、先方のマシンに残ったままだ。', 'warn');
    GP.sound.play('no');
    S.save(g); render();
  }

  /* ---- 研究テーマを1週進める ---- */
  function doResearch(key) {
    const c = D.PART_CATS.find(x => x.key === key);
    if (!c) return;
    if (g.funds < D.RESEARCH.cost || g.rp < D.RESEARCH.rp) return U.toast('資金か研究Pが足りません', 'bad');
    g.funds -= D.RESEARCH.cost; g.rp -= D.RESEARCH.rp; capSpend(D.RESEARCH.cost);
    const r = S.advanceResearch(g, key);
    staffExp('researcher', 16); staffExp('analyst', 6);
    U.closeModal();
    if (r.found) {
      U.log(g, '🔬 ' + c.name + 'の研究で<b>知見</b>を掴んだ！ 次の「🔧 改良」で使える（いま ' +
        r.have + 'つ）', 'good');
      U.toast('🔬 知見をひとつ掴んだ！', 'good');
      GP.sound.play('levelup');
    } else {
      U.log(g, '🔬 ' + c.name + 'を調べた（' + r.p + ' / ' + r.need + '　+' + r.gain + '）');
      U.pop('🔬+' + r.gain, 'good');
      GP.sound.play('confirm');
    }
    endWeek();
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
      const power = S.supplierPower(g, t.name) || Math.round(cap * (0.55 + rank01 * 0.62));
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
    const gain = Math.round((12 + S.analystPower(g) * 4 + g.facilities.sim * 2
                            + S.osk(g, 'eye') + S.rnd(-2, 6))
                            * crunchMul() * S.rigMul(g, 'sim'));   // 技術眼
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
  /* 1レースでどれだけ壊れるか（%）。決勝と同じ式をそのまま逆に辿る */
  function breakRisk(rel, t) {
    const laps = (t && t.laps) || 26;
    const per = (100 - rel) / 100 * 0.0022 * ((t && t.risk) || 1);
    return (1 - Math.pow(1 - per, laps)) * 100;
  }
  function cmdMaintain() {
    const sum = D.PART_CATS.reduce((a, c) => a + (g.equipped[c.key] ? g.equipped[c.key].power : 0), 0);
    const cost = Math.round(400 + sum * 6);
    const t = D.TRACKS[Math.min(g.nextRace || 0, D.TRACKS.length - 1)];
    const now = S.reliability(g);
    // 整備するとどこまで戻るかを、実際の式で先に出しておく
    const mech = (1 + S.pitPower(g) * 0.2 + g.facilities.pit * 0.08)
               * (S.hasGear(g, 'pit', 'rig2') ? 1.25 : 1);
    const after = (() => {
      const keep = {};
      D.PART_CATS.forEach(c => { const p = g.equipped[c.key]; if (p) keep[c.key] = p.cond; });
      D.PART_CATS.forEach(c => {
        const p = g.equipped[c.key];
        if (p && c.key !== 'pu') p.cond = S.clamp(p.cond + 21 * mech, 10, 100);
        else if (p) p.cond = S.clamp(p.cond + 12 * (1 + S.pitPower(g) * 0.18), 0, 100);
      });
      const v = S.reliability(g);
      D.PART_CATS.forEach(c => { const p = g.equipped[c.key]; if (p) p.cond = keep[c.key]; });
      return v;
    })();

    let body = interiorHTML('pit') +
      '<p class="lead">マシンを分解整備して信頼性を回復します。</p>' +
      '<div class="bigbox">信頼性 <b>' + Math.round(now) + '%</b>' +
        '<span class="bb-to">→ 整備後 <b>' + Math.round(after) + '%</b></span></div>' +
      '<p class="desc">' + esc(t.name) + 'を走ると、いまの状態で <b>約' +
        breakRisk(now, t).toFixed(1) + '%</b> の確率で壊れます' +
        '（整備後は 約' + breakRisk(after, t).toFixed(1) + '%）。</p>';

    // ---- どこがくたびれているか ----
    body += '<div class="sub">いまのコンディション</div><div class="mtlist">';
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) return;
      const isPu = c.key === 'pu';
      const to = isPu ? S.clamp(p.cond + 12 * (1 + S.pitPower(g) * 0.18), 0, 100)
                      : S.clamp(p.cond + 21 * mech, 10, 100);
      body += '<div class="mtrow' + (p.cond < 45 ? ' bad' : p.cond < 70 ? ' warn' : '') + '">' +
        '<span class="mt-ic" style="background:' + c.color + '">' + c.icon + '</span>' +
        '<span class="mt-nm">' + esc(c.name) + (isPu ? '<small>残量（基そのもの）</small>' : '') + '</span>' +
        '<span class="mt-bar"><i style="width:' + Math.round(p.cond) + '%;background:' + c.color + '"></i>' +
          '<u style="left:' + Math.round(p.cond) + '%;width:' + Math.round(to - p.cond) + '%"></u></span>' +
        '<span class="mt-v">' + Math.round(p.cond) + '%<em>→' + Math.round(to) + '</em></span></div>';
    });
    body += '</div>';
    body += '<p class="note">パワーユニットは分解して組み直せません。ここで戻せるのは補機まわりだけで、' +
      '元に戻せるのは新品を入れたときだけです。<br>' +
      '設備とクルーの腕（いま <b>' + Math.round(S.relCut(g) * 100) + '%</b> の危うさを打ち消しています）が上がるほど、' +
      '同じコンディションでも壊れにくくなります。</p>' +
      '<p class="desc">費用：💰' + money(cost) + '万（1週消費）</p>';
    U.modal('🛠️ 分解整備', body, [
      { label: '整備する', cls: 'primary', disabled: g.funds < cost, fn: () => doMaintain(cost) },
      { label: 'やめる', fn: U.closeModal }
    ]);
    paintInterior();
  }
  function doMaintain(cost) {
    g.funds -= cost;
    const mech = (1 + S.pitPower(g) * 0.2 + g.facilities.pit * 0.08)
               * (S.hasGear(g, 'pit', 'rig2') ? 1.25 : 1);
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      // パワーユニットは分解して組み直すわけにいかない。
      // できるのは補機まわりの手当てだけなので、下の nursePU のぶんだけ戻る
      if (p && c.key !== 'pu') p.cond = S.clamp(p.cond + S.rnd(16, 26) * mech, 10, 100);
    });
    const puGain = S.nursePU(g, S.rnd(8, 16) * (1 + S.pitPower(g) * 0.18));
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
    const tries = 1 + Math.min(3, Math.floor(S.trainPower(g) * 0.8 + g.facilities.sim * 0.3));
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
    const bonus = (1 + g.facilities.sim * 0.14 + S.trainPower(g) * 0.16
                     + (S.hasGear(g, 'sim', 'rig') ? 0.12 : 0)
                     + (S.hasGear(g, 'sim', 'eye') ? 0.08 : 0))
                * S.persOf(d).train * S.rigMul(g, 'sim');
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

  /* ---- いま持っているコンセプト ----
     掘り当てたものは強いが、裁定で取り上げられることがある。
     何を抱えていて、どれだけ危ういのかを出しておく                */
  function conceptBoxHTML() {
    const list = g.concepts || [];
    if (!list.length) return '';
    const top = S.constructorTable(g)[0];
    const risk = S.tdRisk(g, top && top.isPlayer, true);
    const now = S.weekStamp(g);
    const pct = (1 - Math.pow(1 - risk, 10)) * 100;   // 今後10週で覆される確率
    return '<div class="atrbox slim" style="--ac:#8a5ad0">' +
      '<b>🧪 いま持ち込んでいるコンセプト ' + list.length + '件' +
      '（10週で覆される確率 およそ ' + pct.toFixed(0) + '%）</b>' +
      '<div class="cpclist">' + list.map(c => {
        const where = c.body
          ? '車体の' + ((D.BODY_ATTRS.find(a => a.key === c.body) || {}).name || '')
          : ((D.PART_CATS.find(x => x.key === c.cat) || {}).name || '');
        const young = now - c.at < D.TD.grace;
        return '<span class="cpc' + (young ? ' safe' : '') + '">' +
          esc(c.what) + '<i>' + esc(where) + (c.rarUp ? '・格上げ' : '') +
          (young ? '・審査前' : '') + '</i></span>';
      }).join('') + '</div>' +
      '<div class="orgnote">' +
        '<span>🤝 照会のまま不問になる <b>' + Math.round(S.tdDismiss(g) * 100) + '%</b>' +
          '（交渉術・知名度）</span>' +
        '<span>⚖️ 提訴が通る <b>' + Math.round(S.tdAppeal(g) * 100) + '%</b>' +
          '（交渉術・技術眼・アナリスト）</span>' +
      '</div>' +
      '<small>規則が新しいうちほど覆されやすく、' +
      '<b>首位のチームのものは他所から突かれやすい</b>（危険度2倍）。' +
      '照会が来たら、受け入れるか、費用を払って提訴するかを選びます。' +
      '提訴が通れば、その件で二度と問われません。</small></div>';
  }

  /* ---- 工作機械の世代 ----
     パーツが勝手に良くなるのではなく、それを作る機械が変わるから
     良いものが作れるようになる。いま何で削っているのかを出す      */
  /* ---- 設備の世代 ----
     建物を大きくすると、中に置いてある機械そのものが入れ替わる。
     ファクトリーの工作機械と同じ見せかたを、すべての施設で使う  */
  function rigBoxHTML(key) {
    const f = D.FACILITIES.find(x => x.key === key) || {};
    const w = S.rigOf(g, key);
    if (!w) return '';
    const nx = S.rigNext(g, key);
    const lv = g.facilities[key];
    const tiers = S.rigTiers(key);
    const eff = key === 'factory'
      ? 'レアリティ抽選 <b>+' + w.rar.toFixed(1) + '</b>／製作の精度 <b>×' + w.prec.toFixed(2) + '</b>'
      : (D.RIGS[key] || {}).what + ' <b>×' + (w.mul || 1).toFixed(2) + '</b>';
    const nxEff = !nx ? '' : (key === 'factory'
      ? '（抽選 +' + nx.rar.toFixed(1) + '／精度 ×' + nx.prec.toFixed(2) + '）'
      : '（×' + (nx.mul || 1).toFixed(2) + '）');
    return '<div class="wsbox">' +
      '<b>' + w.icon + ' ' + w.name + '<em>' + esc(f.name || '') + ' Lv.' + lv + '</em></b>' +
      '<small>' + esc(w.desc) + '<br>' + eff +
      (nx ? '　→　次は Lv.' + nx.at + ' で <b>' + nx.icon + ' ' + esc(nx.name) + '</b>' + nxEff
          : '　これ以上の設備はありません') +
      '</small>' +
      '<div class="wsline">' + tiers.map(x =>
        '<span class="wsx' + (x.at === w.at ? ' on' : lv >= x.at ? ' past' : '') + '">' +
          x.icon + '<i>' + esc(x.name) + '</i></span>').join('<u>→</u>') + '</div>' +
      '</div>';
  }
  function workshopBoxHTML() { return rigBoxHTML('factory'); }

  /* ---- いまのトレンド ----
     誰かが掘り当てた解釈は、隠しておけない。
     写すのは速いが、本家の写しでしかないので届ききらない       */
  function trendBoxHTML() {
    const cur = S.trendOf(g);
    if (!cur) return leadCopyHTML();
    const t = cur.t;
    const mine = t.mine;
    const copiedN = (t.copied || []).length;
    let h = '<div class="sub">📸 いまのトレンド</div>' +
      '<div class="atrbox slim" style="--ac:#8a6ad0">' +
      '<b>' + (mine ? '🔬 うちの ' : '📸 ') + esc(t.what) +
      (mine ? '' : '（' + esc(t.by) + '）') + '</b>' +
      '<small>' +
      (mine
        ? 'うちが持ち込んだ解釈です。もう写真に撮られています。'
        : esc(t.by) + ' が持ち込んだ解釈が、グリッドに広がりはじめています。') +
      (copiedN ? '　すでに <b>' + copiedN + 'チーム</b>が同じ形にしてきました。' : '') +
      '<br>効き目は <b>+' + ((t.mul - 1) * 100).toFixed(1) + '%</b>。' +
      'トレンドが生きているのは、あと <b>' + Math.max(0, D.TREND.life - cur.age) + '週</b>です。' +
      '</small>';
    if (!mine && !t.playerCopied) {
      const cost = D.TREND.playerCost, rp = D.TREND.playerRp;
      const early = cur.age < D.TREND.startWeek;
      const ratio = S.copyRatio(g, cur.age);
      const poor = g.funds < cost || g.rp < rp;
      h += '<div class="pufresh2">' +
        '<button class="btn' + ((poor || early) ? '' : ' primary') + '" data-copytrend="1"' +
          ((poor || early) ? ' disabled' : '') + '>' +
          '📐 他所の解釈を持ち込む（💰' + money(cost) + '万／🔬' + rp + '）</button>' +
        '<small>' +
        (early
          ? '<b class="warn">まだ写真も図面も足りません。' +
            'あと' + (cur.need || 1) + '週ほどで、形が読めるようになります。</b>'
          : '装着している全パーツの性能が <b>+' + ((t.mul - 1) * ratio * 100).toFixed(1) +
            '%</b>（本家の ' + Math.round(ratio * 100) + '%）。' +
            'デザイナーが厚いほど写しの精度が上がり、遅れるほど届かなくなります。' +
            '<br><b class="warn">よそのものを持ち込むと、裁定の対象になりやすくなります。</b>') +
        (poor ? '<br><b class="warn">資金か研究Pが足りません</b>' : '') +
        '</small></div>';
    } else if (t.playerCopied) {
      h += '<small class="pupool">✅ うちもすでに同じ形にしています。</small>';
    }
    return h + '</div>' + leadCopyHTML();
  }

  /* ---- 首位のマシンを写す ----
     ブレイクスルーが出ていなくても、いちばん速い車はそこにある。
     写真を撮り、風洞で起こし、うちの車に載せる                 */
  function leadCopyHTML() {
    const c = S.leadCopy(g);
    if (!c) return '';
    let h = '<div class="atrbox slim" style="--ac:#c98b10">' +
      '<b>🏆 いま選手権を引っ張っているのは ' + esc(c.team) + '</b>' +
      '<small>';
    if (c.gap <= 0.5) {
      h += 'うちのマシンは、もう首位に見劣りしません。写すものはありません。</small></div>';
      return h;
    }
    h += 'マシンの出来では <b>' + c.gap.toFixed(1) + '点</b> 離されています。' +
      '写真を撮り、風洞で起こして、うちの車に載せることができます。' +
      '差の <b>' + Math.round(c.ratio * 100) + '%</b>（デザイナーが厚いほど上がる）を、' +
      '1回で最大 <b>+' + (D.TREND.lead.cap * 100).toFixed(0) + '%</b> まで埋めます。</small>';
    const poor = g.funds < c.cost || g.rp < c.rp;
    h += '<div class="pufresh2">' +
      '<button class="btn' + ((poor || !c.ok) ? '' : ' primary') + '" data-leadcopy="1"' +
        ((poor || !c.ok) ? ' disabled' : '') + '>' +
        '📸 ' + esc(c.team) + ' のマシンを写す（💰' + money(c.cost) + '万／🔬' + c.rp + '）</button>' +
      '<small>装着している全パーツの性能が <b>+' + (c.gain * 100).toFixed(1) + '%</b>。' +
      (c.cool > 0 ? '<br><b class="warn">前に写したばかりです。あと' + c.cool + '週。</b>' : '') +
      (poor ? '<br><b class="warn">資金か研究Pが足りません</b>' : '') +
      '<br><b class="warn">よそのマシンを起こすと、裁定の対象になりやすくなります。</b>' +
      '</small></div>';
    return h + '</div>';
  }

  /* ---- 規則の新しさ ----
     規則が変わった直後ほど、まだ誰も掘っていないものが残っている。
     いつ開発を厚くするかの判断材料として出しておく                */
  function innovBoxHTML() {
    const since = ((g.season || 1) - 1) % 4;
    const f = S.innovFresh(g);
    const label = ['まっさら', 'まだ掘れる', '固まってきた', '掘りつくされた'][since];
    const cls = f >= 2 ? '#4ea63f' : f >= 1.5 ? '#c98b10' : f >= 1.2 ? '#8a7a5a' : '#7b5a3a';
    return '<div class="atrbox slim" style="--ac:' + cls + '">' +
      '<b>🔬 いまの規則は' + (since + 1) + '年目：' + label +
      '（ブレイクスルー ×' + f.toFixed(2) + '）</b>' +
      '<small>規則が新しいうちは、まだ誰も見つけていない構造が残っています。' +
      '開発でときどき<b>ブレイクスルー</b>を掘り当て、パーツの格が1段上がります' +
      '（上限そのものが伸びます）。ライバルも同じで、' +
      '規則の変わり目には突然1周 0.2〜0.5秒 速くなるチームが出ます。<br>' +
      '<b>ただし裏返しもあります。</b>灰色の領域が広いということは、' +
      'あとから「これは想定外だ」と<b>裁定</b>が出て、取り上げられる確率も高いということです。</small></div>';
  }

  /* ---- ADUO（空力開発格差是正指令）----
     いま選手権がどれだけ一方的で、自分がどちら側にいるのかを出す      */
  function aduoBoxHTML(slim) {
    const ad = S.aduoOf(g);
    if (!ad.level) return '';
    const rank = S.constructorTable(g).findIndex(r => r.isPlayer) + 1;
    const mul = S.aduoMul(g, rank, ad);
    const side = mul < 1 ? '削られる側' : mul > 1 ? '上乗せを受ける側' : '据え置き';
    return '<div class="atrbox' + (slim ? ' slim' : '') + '" style="--ac:' + ad.color + '">' +
      '<b>' + ad.icon + ' ADUO レベル' + ad.level + '「' + ad.name + '」発令中</b>' +
      '<small>首位 <b>' + esc(ad.top) + '</b> が取りうる得点の <b>' +
      Math.round(ad.share * 100) + '%</b> を取り、2位に <b>1戦あたり ' +
      ad.lead.toFixed(1) + '点</b> の差をつけています。' + ad.note + '。<br>' +
      '首位 ×' + ad.cut.toFixed(2) + '／大きく離されたチーム ×' + ad.lift.toFixed(2) +
      '。<b>自チーム（' + rank + '位）は ×' + mul.toFixed(2) + ' の' + side + '</b>です。</small></div>';
  }
  return {
    name: 'dev',
    link: link,
    setG: function (v) { g = v; },
    api: {
      cmdEngine: cmdEngine, cmdCar: cmdCar, cmdDriverMenu: cmdDriverMenu, cmdImprove: cmdImprove, cmdCrunch: cmdCrunch, crunchConsume: crunchConsume, cmdResearch: cmdResearch, cmdMaintain: cmdMaintain, cmdTrain: cmdTrain, rigBoxHTML: rigBoxHTML, aduoBoxHTML: aduoBoxHTML }
  };
};

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
    const t = S.trackAt(g, g.nextRace);
    const sc = Math.round(S.carScore(g, t));
    let body =
      '<div class="racehead"><b>🏎️ ' + esc(D.CAR_GENS[g.carGen].name) + '</b>' +
      '<span>' + esc(t.name) + ' でのマシン評価 ' + sc + '</span></div>' +
      carMixHTML() +
      mechMapHTML(g) + mechReadHTML(g) +
      '<div class="sub">何をしますか</div>' +
      '<p class="desc">どれも1週ぶんのコマンドです。' +
      '<b>改良</b>は積んでいるものを煮詰め、<b>開発</b>は新しいパーツと素材を作り、' +
      '<b>研究</b>はその一段手前で「何が効くか」を探します。</p>' +
      '<div class="pick">' +
      carPickHTML('🔧', '改良', 'いま積んでいるパーツを煮詰める',
        '性能が上限へ近づく。上限はその個体の品質で決まっていて、ここでは動かない', 'imp') +
      carPickHTML('📐', '開発', '新しいパーツを作り、素材と技術を伸ばす',
        '出来のいい個体を引き当てる。作るほど扇に勘所が貯まり、素材を上げられる', 'des') +
      carPickHTML('🔬', '研究', 'まだ図面になっていないものを探す',
        '知見が溜まり、改良1回ぶんの伸びが大きくなる。開発の一段手前', 'res') +
      '</div>';
    U.modal('🏎️ 車体', body, [{ label: '閉じる', fn: U.closeModal }], { wide: true });
    const go = { imp: cmdImprove, des: cmdDesign, res: cmdResearch };
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-car]'), b => {
      b.onclick = () => { GP.sound.play('tap'); go[b.dataset.car](); };
    });
  }
  /* ---- 予備シャシー ----
     組んであるだけで、週末に壊したときの逃げ道になる。
     金は寝るが、クルーを潰さずに日曜を迎えられる          */
  function spareBoxHTML() {
    const now = S.spareOf(g);
    const cost = S.spareCost(g);
    const full = now >= D.SPARE.max;
    const ok = !full && g.funds >= cost;
    return '<div class="sub">予備シャシー</div>' +
      '<p class="desc">週末に壊したとき、組んであれば載せ替えるだけで済みます。' +
      '無ければ徹夜で叩き直すか、応急処置のまま日曜を迎えることになります。' +
      U.helpLink('car') + '</p><div class="pick">' +
      '<button class="pickbtn" data-spare="1"' + (ok ? '' : ' disabled') + '>' +
      '<span class="pb-ic" style="background:#c98b4a">🚛</span>' +
      '<span class="pb-body"><b>もう1台ぶん組んでおく' +
      '<em class="matnow">いま ' + now + ' / ' + D.SPARE.max + ' 台</em></b>' +
      '<small>' + (full ? 'これ以上は置く場所がありません'
                        : '載せ替えなら、クルーの疲労は +9 で済みます（徹夜なら +22）') +
      '</small></span>' +
      '<span class="pb-cost">' + (full ? '—' : '💰' + money(cost)) + '</span></button></div>';
  }

  /* ---- 素材 ----
     扇ごとに、いま何で作れるか。
     パーツを作り、煮詰めるたびに、その扇に「勘所」が貯まる。
     溜まったぶんを使うと素材が一段上がり、
     以後その扇で<b>作るパーツ</b>の出来が底上げされる。
     すでに載っているものは変わらない（作り直しが要る）        */
  function matBoxHTML() {
    let h = '<div class="sub">素材</div>' +
      '<p class="desc">扇ごとに、いま何で作れるか。' +
      '手を動かすほど勘所が貯まり、溜まったぶんで一段上げられます。' +
      '上がるのは<b>これから作るパーツ</b>で、いま載っているものは変わりません。' +
      U.helpLink('car') + '</p><div class="pick matpick">';
    D.PART_GROUPS.forEach(gr => {
      const now = S.matDef(g, gr.key);
      const nx = S.matNext(g, gr.key);
      const pt = S.matPoints(g, gr.key);
      const ok = !!nx && pt >= nx.cost;
      const pct = nx ? Math.min(100, Math.round(pt / nx.cost * 100)) : 100;
      h += '<button class="pickbtn matrow" data-mat="' + gr.key + '"' +
        (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:' + gr.color + '">' + gr.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(gr.name) +
        '<em class="matnow">' + now.icon + ' ' + esc(now.name) + '</em></b>' +
        '<small>' + esc(now.note) +
        (nx
          ? '<br><b>次は ' + nx.icon + ' ' + esc(nx.name) + '</b>' +
            '（品質の真ん中が ' + now.mid.toFixed(2) + ' → ' + nx.mid.toFixed(2) +
            '／作るときの性能 ×' + nx.mul.toFixed(2) + '）' +
            '<span class="skbar"><i style="width:' + pct + '%;background:' + gr.color + '"></i></span>' +
            '<span class="devnow">勘所 ' + pt + ' / ' + nx.cost + '</span>'
          : '<br><b>これ以上の素材はありません</b>') +
        '</small></span>' +
        '<span class="pb-cost">' + (nx ? (ok ? '🔨 上げる' : 'あと ' + (nx.cost - pt)) : '—') +
        '</span></button>';
    });
    return h + '</div>';
  }

  function bindMat() {
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-mat]'), b => {
      b.onclick = () => {
        const k = b.dataset.mat;
        const up = S.matUp(g, k);
        if (!up) return;
        const gr = D.PART_GROUPS.filter(x => x.key === k)[0];
        GP.sound.play('levelup');
        U.log(g, up.icon + ' ' + gr.name + ' を ' + up.name + 'で作れるようになった' +
          '（これから作るパーツの出来が上がる）', 'good');
        U.toast(up.icon + ' ' + gr.name + ' → ' + up.name + '！', 'good');
        S.save(g);
        render();
        cmdDesign();
      };
    });
  }

  /* ---- 速さの成り立ち ----
       （マシン本体 ＋ パーツ ＋ 作り込みの向き） × インテグレート率
     足し算と掛け算の順番が、そのままこのゲームの考え方になっている。
     良い部品を集めるだけでは速くならず、
     まとめ上げてはじめて、持っているものが出てくる            */
  function carMixHTML() {
    const sum = s => s.speed + s.corner + s.accel;
    let parts = 0;
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      if (!p) return;
      const ps = S.partStats(p, g);
      const f = (c.key === 'pu' ? S.puForm(g) : (0.82 + p.cond / 100 * 0.18));
      parts += (ps.speed + ps.corner + ps.accel) * f;
    });
    const ch = sum(S.chassisStats(g));
    const bd = sum(S.bodyStats(g));
    const raw = ch + parts + bd;
    const it = S.integrateRate(g);
    const lost = raw * (1 - it.rate);
    const bar = (label, v, color) =>
      '<i class="cm-seg" style="width:' + (v / Math.max(1, raw) * 100).toFixed(1) +
      '%;background:' + color + '" title="' + label + ' ' + Math.round(v) + '"></i>';
    const dir = S.carDirection(g);
    const tr = dir.trait;
    const AX = { speed: '直線', corner: 'コーナー', accel: '立ち上がり' };
    const c0 = S.chassisOf(g);
    return '<div class="carmix">' +
      '<b class="cm-h">速さの成り立ち</b>' +
      /* この車がどういう車なのか。
         本体を作ったときに決まった性格と、
         そこへパーツをどちらへ振っているか                   */
      '<span class="cm-char">' +
        '<b class="cm-trait" style="border-color:' + tr.def.color + ';color:' + tr.def.color + '"' +
        ' title="' + esc(tr.def.note) + '">' + tr.def.icon + ' ' + tr.def.name +
        '<em>' + tr.edgeName + '</em></b>' +
        '<b class="cm-dir" style="border-color:' + dir.def.color + ';color:' + dir.def.color + '"' +
        ' title="' + esc(dir.def.note) + '">' + dir.def.icon + ' ' + dir.def.name + '</b>' +
        '<i>本体 ' + AX.speed + Math.round(c0.speed * 100) + '／' +
        AX.corner + Math.round(c0.corner * 100) + '／' +
        AX.accel + Math.round(c0.accel * 100) + '　' +
        (dir.def.key === 'boost'
           ? '得意の' + AX[dir.hi] + 'へさらに積んでいます'
           : dir.def.key === 'fix'
           ? '苦手な' + AX[dir.lo] + 'を埋めています'
           : '本体の性格をそのまま引き継いでいます') + '</i>' +
      '</span>' +
      '<span class="cm-bar">' +
        bar('マシン本体', ch, '#c98b4a') +
        bar('パーツ', parts, '#3a7ad9') +
        bar('作り込みの向き', bd, '#4ea63f') +
      '</span>' +
      '<span class="cm-legend">' +
        '<i style="color:#c98b4a">■</i>本体 ' + Math.round(ch) +
        '　<i style="color:#3a7ad9">■</i>パーツ ' + Math.round(parts) +
        '　<i style="color:#4ea63f">■</i>向き ' + Math.round(bd) +
        '　＝ 持っているもの <b>' + Math.round(raw) + '</b></span>' +
      '<span class="cm-int' + (it.rate < 0.75 ? ' warn' : '') + '">' +
        '× インテグレート <b>' + Math.round(it.rate * 100) + '%</b>' +
        '（扇の中 ' + Math.round(it.inner * 100) + '％／継ぎ目 ' + Math.round(it.bridge * 100) +
        '％／噛み合い ' + Math.round(it.mesh * 100) + '％）' +
        '　＝ 実際に出ている <b>' + Math.round(raw * it.rate) + '</b>' +
        (lost > 1 ? '<em>まとめきれずに眠っているぶん ' + Math.round(lost) + '</em>' : '') +
      '</span>' +
      '<span class="cm-amp">まとめ上げるほど、この車は<b>' + tr.def.name +
        '</b>らしくなります（いまの増幅 ×' +
        (1 + D.AMP.k * (it.rate - D.AMP.mid)).toFixed(2) + '）</span>' +
      '</div>';
  }

  /* パーツの出来を、ひと目の札にする */
  function qualChip(p) {
    const q = S.qualOf(p), t = S.qualTier(q);
    const m = D.MATERIALS[p.mat || 0] || D.MATERIALS[0];
    return '<b class="qchip" style="border-color:' + t.color + ';color:' + t.color + '"' +
      ' title="' + esc(t.note) + '">' + t.name + ' ' + q.toFixed(2) + '</b>' +
      '<b class="mchip" title="' + esc(m.note) + '">' + m.icon + ' ' + m.name + '</b>';
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
      mechMapHTML(g) + mechReadHTML(g);

    body += '<div class="sub">装着中パーツの改良</div>' +
      '<p class="desc">数字は「1回手を入れると、次のコースで1周あたりどれだけ速くなるか」。' +
      U.helpLink('car') + '</p><div class="pick">';
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
        '<span class="pb-ic ic-art" style="background:' + c.color + '">' +
          U.partIcon(c.key, 26, S.qualStars(S.qualOf(p))) + '</span>' +
        '<span class="pb-body"><b>' + esc(p.name) +
        (weakest === c.key ? '<em class="weakchip">いちばん薄いところ</em>' : '') +
        // 研究で溜めた知見。この部位を改良すると、1つ使って大きく伸びる
        (S.findingsOf(g, c.key)
          ? '<em class="findchip" title="🔬 研究の知見。改良1回の伸びが ×' +
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
        /* 品質。上限がどこで止まるかは、この個体の出来で決まっている。
           改良では動かないので、これ以上を望むなら作り直すしかない */
        (locked ? '' :
          '<span class="devpol">' + qualChip(p) +
          '　この個体の上限は <b>' + cap + '</b>（世代 ' +
          D.CAR_GENS[g.carGen].cap + ' × 品質 ' + S.qualOf(p).toFixed(2) + '）' +
          (capped ? '　<b class="warn">作り直せば、もっと良い個体が出るかもしれません</b>' : '') +
          '</span>') +
        '</small></span>' +
        '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>' : '💰' + money(cost) + '<br>🔬' + c.rp) + '</span></button>';
    });
    // ---- インテグレート（まとめ上げ） ----
    // 上限は項目ごと。コンセプトに逆らう項目は、ここが低い
    const capAll = S.bodyCap(g);
    // 1回でどれだけまとまるか（パーツと同じ式から出す）
    const bodyStep = a => {
      const facBonus = 1 + g.facilities.factory * 0.10;
      const engBonus = 1 + S.devPower(g) * 0.14;
      const drvBonus = 1 + g.drivers.reduce((x, d) => x + S.persOf(d).dev, 0);
      // 作り込みは、コンセプトに沿う項目ほど速く進む
      let gain = 3.4 * facBonus * engBonus * drvBonus * S.conceptMul(g, a.key) * S.devRate(g);
      if (((g.body && g.body[a.key]) || 0) >= S.bodyCapOf(g, a.key)) gain *= 0.30;
      const fc = S.focusOf(g);
      return { now: gain * fc.cur, next: gain * fc.next };
    };
    /* ---- インテグレート ----
       ここは「速さの成り立ち」の × のところそのもの。
       項目の説明より先に、押すと掛け算が何％動くのかを出す。
       そうしないと、この一覧が何のためにあるのか分からない     */
    const itNow = S.integrateRate(g);
    // いま持っているもの（速さの成り立ちの帯と同じ勘定）
    const rawHave = (function () {
      const tot = s2 => s2.speed + s2.corner + s2.accel;
      let pp = 0;
      D.PART_CATS.forEach(c => {
        const p = g.equipped[c.key];
        if (!p) return;
        const ps = S.partStats(p, g);
        const f = (c.key === 'pu' ? S.puForm(g) : (0.82 + p.cond / 100 * 0.18));
        pp += (ps.speed + ps.corner + ps.accel) * f;
      });
      return tot(S.chassisStats(g)) + pp + tot(S.bodyStats(g));
    })();
    /* その項目を1回ぶん進めたら、まとめ上げが何％になるか。
       式を立て直すのではなく、実際に足して測り、すぐ戻す。
       継ぎ目にも噛み合いにも効くので、
       ここを通さないと正しい数字にならない                   */
    const rateIfUp = (key, add) => {
      if (!g.body) return itNow.rate;
      const bak = g.body[key];
      g.body[key] = (bak || 0) + add;
      const v2 = S.integrateRate(g).rate;
      g.body[key] = bak;
      return v2;
    };
    const asleep = rawHave * (1 - itNow.rate);

    body += '</div><div class="sub">インテグレート（まとめ上げ）</div>' +
      '<p class="desc">この一覧が、「速さの成り立ち」の <b>×</b> のところです。' +
      'パーツをいくら良くしても、まとめ上げていなければ出てきません。' +
      'いま持っている <b>' + Math.round(rawHave) + '</b> のうち、出ているのは <b>' +
      Math.round(rawHave * itNow.rate) + '</b>。残りの <b>' + Math.round(asleep) +
      '</b> は眠ったままです。<br>' +
      '同じ扇の中なら、どれを押してもまとめ上げは同じだけ進みます。' +
      'ちがうのは<b>値段</b>（薄いところほど安い）と、<b>おまけに付いてくるもの</b>です。' +
      U.helpLink('car') + '</p>' +
      '<div class="intsum">' +
        '<b>いまのインテグレート <u>' + Math.round(itNow.rate * 100) + '%</u></b>' +
        '<span><i style="width:' + Math.round(itNow.inner * 100) + '%"></i>扇の中 ' +
          Math.round(itNow.inner * 100) + '%<em>この一覧で上がります</em></span>' +
        '<span><i style="width:' + Math.round(itNow.bridge * 100) + '%"></i>継ぎ目 ' +
          Math.round(itNow.bridge * 100) + '%<em>隣り合う扇が両方とも厚いときに育ちます</em></span>' +
        '<span><i style="width:' + Math.round(itNow.mesh * 100) + '%"></i>噛み合い ' +
          Math.round(itNow.mesh * 100) + '%<em>パーツとの組が揃って育ちます</em></span>' +
      '</div>';

    /* 扇ごとに並べる。どの扇が足を引っぱっているかが、そのまま見える */
    D.PART_GROUPS.forEach(gr => {
      const inner = S.integrateOf(g, gr.key);
      body += '<div class="intgrp" style="border-left-color:' + gr.color + '">' +
        '<b style="color:' + gr.color + '">' + gr.icon + ' ' + gr.name + '</b>' +
        '<em>この扇のまとめ ' + Math.round(inner * 100) + '%</em>' +
        '<small>' + esc(gr.note) + '</small></div><div class="pick">';
      gr.body.forEach(key => {
        const a = D.BODY_ATTRS.filter(x => x.key === key)[0];
        if (!a) return;
        const v = (g.body && g.body[a.key]) || 0;
        const myCap = Math.max(1, S.bodyCapOf(g, a.key));
        const cost = bodyCost(v);
        const capped = v >= myCap;
        const ok = useTicket || (g.funds >= cost && g.rp >= 8);
        const pct = Math.min(100, v / myCap * 100);
        const st = bodyStep(a);
        const r2 = rateIfUp(a.key, st.now);
        const up = (r2 - itNow.rate) * rawHave;      // 眠っていた速さが、いくつ起きるか
        const thin = pct < 34;
        body += '<button class="pickbtn devrow" data-k="bdy:' + a.key + '"' + (ok ? '' : ' disabled') + '>' +
          '<span class="pb-ic" style="background:' + a.color + '">' + a.icon + '</span>' +
          '<span class="pb-body"><b>' + a.name +
          (thin ? '<em class="warn">ここが薄い</em>'
                : pct >= 50 ? '<em class="overchip">ライバル超え</em>' : '') + '</b>' +
          '<small>' +
          '<span class="skbar"><i style="width:' + pct + '%;background:' + a.color + '"></i>' +
          '<u style="left:50%"></u></span>' +
          '<span class="devnow">まとめ <b>' + Math.round(pct) + '%</b>' +
          '（' + (Math.round(v * 10) / 10) + ' / ' + myCap + '）' +
          (myCap < capAll ? '　<em class="cap">コンセプトに逆らう向きなので上限が低い</em>' : '') +
          '</span>' +
          '<span class="devup">1回で　インテグレート ' + (itNow.rate * 100).toFixed(1) +
          '% → <b>' + (r2 * 100).toFixed(1) + '%</b>' +
          '　＝ 眠っていた速さが <b>+' + up.toFixed(1) + '</b> 起きます' +
          (st.next > 0.05 ? '　＋来季へ ' + (Math.round(st.next * 10) / 10) : '') +
          (capped ? '　<em class="warn">上限到達。伸びは3割まで落ちます</em>' : '') + '</span>' +
          '<span class="deveff">' + a.eff + '</span>' +
          '</small></span>' +
          '<span class="pb-cost">' + (useTicket ? '<b class="free">🎫 無料</b>' : '💰' + money(cost) + '<br>🔬8') + '</span></button>';
      });
      body += '</div>';
    });
    body += '<div class="pick">';

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

    // ---- 予備シャシー ----
    body += spareBoxHTML();

    // ---- 素材 ----
    body += matBoxHTML();

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
    bindMat();
    bindAct('data-spare', () => {
      const r2 = S.buySpare(g);
      if (!r2) return;
      GP.sound.play('build');
      U.log(g, '🚛 予備シャシーを1台組んだ（いま ' + r2.now + '台／💰' + money(r2.cost) + '万）', 'good');
      U.toast('🚛 予備シャシー ' + r2.now + '台', 'good');
      S.save(g); render(); cmdDesign();
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
    // コンセプトに逆らう項目は、上限そのものが低い
    const cap = S.bodyCapOf(g, key);
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
    let gain = S.rnd(2.6, 4.2) * facBonus * engBonus * drvBonus
             * S.conceptMul(g, key) * crunchMul() * S.devRate(g);
    let crit = false;
    if (Math.random() < 0.10) { gain *= 2.2; crit = true; }
    const brk = S.rollBreakthrough(g);
    if (brk) { gain *= D.INNOV.playerGain; crit = true; }
    if (v >= cap) gain *= 0.30;   // 上限に達しても、完全には止まらない
    const toNext = gain * fc.next;
    gain = Math.round(gain * fc.cur * 10) / 10;
    g.nextCar = (g.nextCar || 0) + toNext;
    // 方針の外までは行けない。ここで頭を打つ
    g.body[key] = Math.round(Math.min(cap, v + gain) * 10) / 10;
    if (brk) {
      g.concepts = (g.concepts || []).concat([{
        body: key, what: brk, gain: gain, at: S.weekStamp(g)
      }]);
      S.pushNews(g, 'brk', brk);
      /* 掘り当てたものは隠しておけない。写真に撮られ、風洞で再現され、
         数戦のうちにグリッドの半分が同じ形になる                    */
      {
        const t2 = S.trackAt(g, g.nextRace);
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
    if (g.body[key] >= cap) {
      U.toast(S.conceptDir(g, key) < 0
        ? 'いまのコンセプトでは、' + a.name + 'はここまでです。方針を変えるなら車を作り直します。'
        : 'この車体は煮詰まりました。パーツを仕上げれば次の世代へ進みます。', 'warn');
    }
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
  /* コンセプトに合う部品は速く進み、合わない部品は遅い。
     どの部品が合うかは、速さの向きから推し量るのではなく
     コンセプトごとに名指ししてある（ドライバビリティのように、
     速さの3項目では表せない方針があるため）                   */
  function planMul(cat) {
    return S.conceptPartMul(g, cat && cat.key);
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
  /* どちらが部品でどちらが車体の作り込みかは mechName が知っている。
     輪に並べる順の表は、輪をやめたので要らなくなった               */
  const mechKey = m => (m.p ? 'p:' + m.p : 'b:' + m.b);

  /* =======================================================
     噛み合いの図（描き直し）

     もとは全部位を一つの輪に並べていたが、
     「どれとどれが噛み合うのか」「なぜ噛み合っていないのか」が
     輪の中では読み取れなかった。線が交差し、札が重なり、
     矢印がないので、どちらが原因でどちらが結果なのかも分からない。

     組ごとに一行にして、左右に相手を置き、あいだを継手でつなぐ。
     ・丸の大きさが、そのままその部位の充実ぶり
     ・小さいほうが、噛み合いを止めている当人
     ・継手の詰まりぐあいが、いま出ている効き
     数字を読まなくても、絵の大小だけで犯人が分かるようにしてある。
     ======================================================= */
  /* =======================================================
     三重の輪

     内 … 積んでいる部品
     中 … 車体の作り込み（＝その固まりの馴染み方）
     外 … マシンコンセプト

     部品はばらばらではなく、いくつかの固まりで仕事をしている。
     固まりごとに扇形を割り当てると、噛み合いの線はその扇形の中で
     閉じる（11組のうち9組）。輪に並べても線が総当たりで交差しないのは
     このおかげで、以前ぜんぶを一つの輪に並べていたときに
     読めなかったのは、この固まりが無かったからだった。

     いちばん外の曲線は、コンセプトが引いている境目。
     方針に逆らう向きでは内側へ食い込んでいて、そこから先へは
     どれだけ手をかけても行けない。作り込みの節はいまの値の位置に
     置いてあるので、境目に貼りついていれば「もう限界」と分かる。
     ======================================================= */
  const RING = {
    CX: 296, CY: 292, VW: 592, VH: 580,
    rCore: 30,          // まん中のコンセプト
    /* 部品の輪を広げると、隣どうしの間隔（弧の長さ）も広がる。
       名札を置く場所は、そこで稼ぐ                              */
    rPart: 88,          // 部品の輪（固定）
    bMin: 152, bMax: 218,   // 作り込みは、いまの値ぶんだけ外へ出る
    rLabel: 233,        // 作り込みの名札
    gapDeg: 7           // 固まりどうしのすき間
  };

  const pol = (r, a2) => [RING.CX + Math.cos(a2) * r, RING.CY + Math.sin(a2) * r];

  /* 固まりごとに扇形を割り当て、その中に部品と作り込みを並べる。
     扇形の広さは、その固まりが抱えている数に合わせる           */
  function ringSlots(g2) {
    const G = D.PART_GROUPS;
    const w = G.map(x => Math.max(x.parts.length, x.body.length));
    const wSum = w.reduce((p, c) => p + c, 0);
    const gap = RING.gapDeg * Math.PI / 180;
    const free = Math.PI * 2 - gap * G.length;
    const out = [];
    let at = -Math.PI / 2 + gap / 2;
    G.forEach((grp, i) => {
      const span = free * (w[i] / wSum);
      const spread = (list, r) => list.map((k, j) => {
        // 端に寄りすぎないよう、内側に少し詰めて等間隔に置く
        const t = list.length === 1 ? 0.5 : (j + 0.5) / list.length;
        return { key: k, a: at + span * t, r: r };
      });
      out.push({ grp: grp, from: at, to: at + span, mid: at + span / 2,
                 parts: spread(grp.parts, RING.rPart),
                 body: spread(grp.body, 0) });
      at += span + gap;
    });
    return out;
  }

  function conceptRingSVG(g2) {
    const slots = ringSlots(g2);
    const cap = S.bodyCap(g2);
    const cpt = S.conceptOf(g2);
    const syn = S.mechSynergy(g2);
    const live = syn.filter(x => x.on).length;

    // ---- 角度の索引（線を引くのに使う） ----
    const at = {};
    slots.forEach(sl => {
      sl.parts.forEach(p => { at['p:' + p.key] = { a: p.a, r: RING.rPart }; });
      sl.body.forEach(bq => {
        const v = (g2.body && g2.body[bq.key]) || 0;
        const lim = S.bodyCapOf(g2, bq.key);
        bq.val = v; bq.lim = lim;
        bq.r = RING.bMin + (cap > 0 ? Math.min(1, v / cap) : 0) * (RING.bMax - RING.bMin);
        bq.rLim = RING.bMin + (cap > 0 ? Math.min(1, lim / cap) : 0) * (RING.bMax - RING.bMin);
        at['b:' + bq.key] = { a: bq.a, r: bq.r };
      });
    });

    let h = '<svg viewBox="0 0 ' + RING.VW + ' ' + RING.VH + '" role="img" ' +
      'aria-label="部品と作り込みとコンセプトの輪">';

    // ---- 固まりの扇形（うっすら敷いて、まとまりを見せる） ----
    slots.forEach(sl => {
      const p0 = pol(RING.bMax + 8, sl.from), p1 = pol(RING.bMax + 8, sl.to);
      const q0 = pol(RING.rCore + 6, sl.from), q1 = pol(RING.rCore + 6, sl.to);
      h += '<path class="rg-sec" style="fill:' + sl.grp.color + '" d="' +
        'M' + q0[0].toFixed(1) + ' ' + q0[1].toFixed(1) +
        ' L' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) +
        ' A' + (RING.bMax + 8) + ' ' + (RING.bMax + 8) + ' 0 0 1 ' +
        p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) +
        ' L' + q1[0].toFixed(1) + ' ' + q1[1].toFixed(1) +
        ' A' + (RING.rCore + 6) + ' ' + (RING.rCore + 6) + ' 0 0 0 ' + q0[0].toFixed(1) + ' ' + q0[1].toFixed(1) + ' Z"></path>';
    });

    /* ---- コンセプトの境目 ----
       方針に逆らう向きでは内側へ食い込む。
       ここから先へは、どれだけ手をかけても行けない            */
    const lim = [];
    slots.forEach(sl => sl.body.forEach(bq => lim.push(bq)));
    lim.sort((x, y) => x.a - y.a);
    if (lim.length) {
      let d = '';
      lim.forEach((bq, i) => {
        const p = pol(bq.rLim, bq.a);
        d += (i ? ' L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      });
      d += ' Z';
      h += '<path class="rg-wall" d="' + d + '"></path>';
    }

    // ---- 部品の輪（薄い下敷き） ----
    h += '<circle cx="' + RING.CX + '" cy="' + RING.CY + '" r="' + RING.rPart +
      '" class="rg-ring"></circle>';

    /* ---- 扇形と扇形をつなぐ橋（パッケージング）----
       すき間をまたぐ弧として架ける。外へ伸びる棒だと
       「その方向に何かある」に見えてしまい、
       二つの扇形をつないでいることが伝わらない。
       弧なら、両側の扇に足がかかっているのが見える。
       受け（空の弧）をいつも敷いておくので、
       0%でも「ここに橋が架かるはずだ」と分かる                */
    const packs = S.packaging(g2);
    const byKey = {};
    slots.forEach(sl => { byKey[sl.grp.key] = sl; });
    const rBr = RING.bMax + 12;
    packs.forEach(pk => {
      const A = byKey[pk.def.a], B = byKey[pk.def.b];
      if (!A || !B) return;
      // 二つの扇形のあいだ（すき間）を探す
      let a1 = A.to, a2 = B.from;
      if (a2 < a1) a2 += Math.PI * 2;
      if (a2 - a1 > Math.PI) { a1 = B.to; a2 = A.from; if (a2 < a1) a2 += Math.PI * 2; }
      const mid = (a1 + a2) / 2;
      // すき間より少し広く取って、両側の扇形に足をかける
      const half = (a2 - a1) / 2 + 0.20;
      const arc = (from, to) => {
        const p0 = pol(rBr, from), p1 = pol(rBr, to);
        return 'M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) +
          ' A' + rBr + ' ' + rBr + ' 0 0 1 ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1);
      };
      // 受け：橋が架かるはずのところ
      h += '<path class="rg-brslot" d="' + arc(mid - half, mid + half) + '"></path>';
      // 実際に架かっているぶん。真ん中から左右へ伸びる
      const g2h = half * Math.max(0.03, pk.ratio);
      h += '<path class="rg-br' + (pk.thin ? ' thin' : pk.good ? ' good' : '') +
        '" d="' + arc(mid - g2h, mid + g2h) + '"></path>';
      // 両側の扇形へ下ろす足
      [mid - half, mid + half].forEach(ang => {
        const p0 = pol(rBr, ang), p1 = pol(rBr - 13, ang);
        h += '<path class="rg-brfoot' + (pk.good ? ' good' : '') + '" d="M' +
          p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + ' L' +
          p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + '"></path>';
      });
      // つなぎ目の名札と、噛み合いぐあい
      const [lx, ly] = pol(rBr + 16, mid);
      const anc = Math.abs(Math.cos(mid)) < 0.30 ? 'middle'
                : (Math.cos(mid) > 0 ? 'start' : 'end');
      h += '<text x="' + lx.toFixed(1) + '" y="' + (ly - 1).toFixed(1) +
        '" class="rg-brlb' + (pk.thin ? ' thin' : '') + '" text-anchor="' + anc + '">' +
        esc(pk.def.name) + '</text>' +
        '<text x="' + lx.toFixed(1) + '" y="' + (ly + 11).toFixed(1) +
        '" class="rg-brv' + (pk.thin ? ' thin' : '') + '" text-anchor="' + anc + '">' +
        Math.round(pk.ratio * 100) + '%</text>';
    });

    // ---- 噛み合いの線 ----
    syn.forEach(x => {
      const A = at[x.def.a.p ? 'p:' + x.def.a.p : 'b:' + x.def.a.b];
      const B = at[x.def.b.p ? 'p:' + x.def.b.p : 'b:' + x.def.b.b];
      if (!A || !B) return;
      const p = pol(A.r, A.a), q = pol(B.r, B.a);
      // 中心寄りへ少したわませると、節に重ならない
      const mr = Math.min(A.r, B.r) * 0.55;
      const ma = (A.a + B.a) / 2;
      const m = pol(mr, Math.abs(A.a - B.a) > Math.PI ? ma + Math.PI : ma);
      h += '<path class="rg-l' + (x.on ? ' on' : '') + '" d="M' + p[0].toFixed(1) + ' ' +
        p[1].toFixed(1) + ' Q' + m[0].toFixed(1) + ' ' + m[1].toFixed(1) + ' ' +
        q[0].toFixed(1) + ' ' + q[1].toFixed(1) +
        '" stroke-width="' + (1.3 + x.ratio * 4.4).toFixed(2) + '"></path>';
    });

    // ---- どちらが噛み合いを止めているか ----
    const weak = {};
    syn.forEach(x => {
      if (x.ratio >= 0.97) return;
      weak[x.weak.p ? 'p:' + x.weak.p : 'b:' + x.weak.b] = true;
    });

    // ---- 部品の節 ----
    slots.forEach(sl => sl.parts.forEach(p => {
      const o = S.mechName({ p: p.key });
      const sc = S.mechScore(g2, { p: p.key });
      const [x, y] = pol(RING.rPart, p.a);
      const r = 10 + Math.min(1, sc) * 8;
      h += '<g class="rg-n' + (weak['p:' + p.key] ? ' weak' : '') + '">' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) +
          '" style="fill:' + o.color + '"></circle>' +
        '<text x="' + x.toFixed(1) + '" y="' + (y + 4.5).toFixed(1) + '" class="rg-ic">' +
          o.icon + '</text></g>';
      /* 名札は輪の外側へ。内側に置くと、7つぶんが中心に集まって
         団子になり、まん中のコンセプトとも重なってしまう          */
      const [lx, ly] = pol(RING.rPart + r + 15, p.a);
      h += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 3).toFixed(1) +
        '" class="rg-plb" text-anchor="middle">' + esc(o.short || o.name) + '</text>';
    }));

    // ---- 作り込みの節と、名札 ----
    slots.forEach(sl => sl.body.forEach(bq => {
      const o = S.mechName({ b: bq.key });
      const dir = S.conceptDir(g2, bq.key);
      const [x, y] = pol(bq.r, bq.a);
      const full = bq.val >= bq.lim - 0.05;
      h += '<g class="rg-n' + (weak['b:' + bq.key] ? ' weak' : '') + (full ? ' full' : '') + '">' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
          '" r="12" style="fill:' + o.color + '"></circle>' +
        '<text x="' + x.toFixed(1) + '" y="' + (y + 4.5).toFixed(1) + '" class="rg-ic">' +
          o.icon + '</text></g>';
      // 節から境目までの「まだ伸ばせるぶん」
      if (bq.rLim - bq.r > 3) {
        const p2 = pol(bq.r + 12, bq.a), q2 = pol(bq.rLim, bq.a);
        h += '<path class="rg-room" d="M' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1) +
          ' L' + q2[0].toFixed(1) + ' ' + q2[1].toFixed(1) + '"></path>';
      }
      const [lx, ly] = pol(RING.rLabel, bq.a);
      const anc = Math.abs(Math.cos(bq.a)) < 0.30 ? 'middle'
                : (Math.cos(bq.a) > 0 ? 'start' : 'end');
      h += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 3).toFixed(1) +
        '" class="rg-blb' + (dir > 0 ? ' up' : dir < 0 ? ' dn' : '') +
        '" text-anchor="' + anc + '">' +
        (dir > 0 ? '▲' : dir < 0 ? '▽' : '') + esc(o.short || o.name) + '</text>';
    }));

    // ---- まん中：コンセプトそのもの ----
    h += '<circle cx="' + RING.CX + '" cy="' + RING.CY + '" r="' + RING.rCore + '" class="rg-core"' +
      (cpt ? ' style="fill:' + cpt.color + '"' : '') + '></circle>';
    h += '<text x="' + RING.CX + '" y="' + (RING.CY - 1) + '" class="rg-cic">' +
      (cpt ? cpt.icon : '❓') + '</text>';
    h += '<text x="' + RING.CX + '" y="' + (RING.CY + 14) + '" class="rg-cnm">' +
      (cpt ? esc(cpt.name.replace('重視', '')) : '未定') + '</text>';

    h += '</svg>';

    // ---- 読みかた ----
    const gl = D.PART_GROUPS.map(x =>
      '<span><i style="background:' + x.color + '"></i>' + x.icon + x.name + '</span>').join('');
    const pkAll = Math.round(S.packScore(g2) * 100);
    return '<div class="ringmap">' + h +
      '<div class="rg-leg">' + gl +
      '<span class="rg-sum">継ぎ目のインテグレート <b>' + pkAll + '%</b>' +
      '　噛み合っている組 <b>' + live + '</b>/' + syn.length + '</span>' +
      '</div>' +
      '<p class="desc">内から外へ、<b>部品 → インテグレート → コンセプト</b>。' +
      '節が<b>いちばん外の線</b>に貼りついていたら、その項目はもう限界です。' +
      '扇どうしの橋が<b>継ぎ目のインテグレート</b>で、細い橋は車をまとめさせません。' +
      U.helpLink('car') + '</p>' +
      '</div>';
  }

  function couplingSVG(x) {
    const A = S.mechName(x.def.a), B = S.mechName(x.def.b);
    const nm = o => o.short || o.name;
    return U.coupling({
      aIcon: A.icon, aName: nm(A), aColor: A.color, aFill: x.aScore,
      bIcon: B.icon, bName: nm(B), bColor: B.color, bFill: x.bScore,
      ratio: x.ratio, on: x.on, aWeak: x.weak === x.def.a
    });
  }

  /* 何に効くのか。数字ではなく、矢の本数で見せる */
  const EFF_NM = { speed: '最高速', corner: 'コーナー', accel: '加速',
                   wear: 'タイヤ持ち', rel: '信頼性' };
  function effChips(def, gain) {
    return Object.keys(def.eff).map(k => {
      const n = Math.max(1, Math.round(def.eff[k] * 3));
      return '<i class="ef ' + k + '">' + EFF_NM[k] +
        '<b>' + '▲'.repeat(n) + '</b></i>';
    }).join('');
  }

  function mechMapHTML(g2) {
    const syn = GP.state.mechSynergy(g2).slice()
      .sort((a, b) => (b.on - a.on) || (b.ratio - a.ratio));
    const st = GP.state.carStats(g2);
    const gen = D.CAR_GENS[g2.carGen];
    const live = syn.filter(x => x.on).length;

    let h = conceptRingSVG(g2) + '<div class="mechlist">' +
      '<div class="ml-head"><b>' + esc(gen.name) + '</b>' +
      '<span>速' + Math.round(st.speed) + '／曲' + Math.round(st.corner) +
      '／加' + Math.round(st.accel) + '</span>' +
      '<em>噛み合っている組 <b>' + live + '</b> / ' + syn.length + '</em></div>' +
      '<p class="desc">部品は、単体ではなく<b>組で効きます</b>。' +
      '上の輪が全体、下がその組ひとつずつの中身です。' +
      '<b>丸が小さいほうが、噛み合いを止めている側</b>。' +
      'そこを厚くすると、継手が詰まって効きはじめます。</p>';

    syn.forEach(x => {
      const W = GP.state.mechName(x.weak);
      h += '<div class="mlrow' + (x.on ? ' on' : '') + '">' +
        '<div class="ml-t"><span class="ml-ic">' + x.def.icon + '</span>' +
        '<b>' + esc(x.def.name) + '</b>' +
        '<em class="ml-pct' + (x.on ? ' on' : '') + '">' +
        Math.round(x.ratio * 100) + '%</em></div>' +
        '<div class="ml-body">' + couplingSVG(x) +
        '<div class="ml-side">' +
        '<small>' + esc(x.def.desc) + '</small>' +
        '<div class="ml-eff">' + effChips(x.def, x.gain) + '</div>' +
        '<div class="ml-weak">' + (x.ratio >= 0.97
          ? '<span class="ok">✔ ここは出しきっています</span>'
          : '<span class="ng">' + W.icon + ' <b>' + esc(W.name) + '</b> が追いついていません。'
            + 'ここを詰めると効きはじめます</span>') + '</div>' +
        '</div></div></div>';
    });
    return h + '</div>';
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
    for (let i = g2.nextRace; i < Math.min(D.RACES, g2.nextRace + 3); i++) ahead.push(S.trackAt(g2, i));
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
    let gain = 4.5 * facBonus * engBonus * drvBonus * planMul(c) * S.devRate(g);
    if (c.key === 'pu') gain *= S.puDevMul(g);      // よそに配っているぶん、手が回らない
    if (p.power >= cap) gain *= 0.30;
    const now = gain * fc.cur, next = gain * fc.next;
    // 伸びたぶんが、車の速さにどう出るか
    const t = S.trackAt(g, g.nextRace);
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
    let gain = S.rnd(3.4, 5.6) * facBonus * engBonus * gearBonus * drvBonus * planMul(c) * crunchMul() * S.devRate(g);
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
    if (brk) { gain *= D.INNOV.playerGain; crit = true; }
    /* 手を動かせば、その扇の作りかたも分かってくる。
       ここで貯まったぶんが、あとで素材を上げる元手になる */
    S.addMatPoint(g, key, D.MAT.perImprove * (brk ? 3 : 1));
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
        cat: key, what: brk, rarUp: false, gain: gain, at: S.weekStamp(g)
      }]);
      S.pushNews(g, 'brk', brk);
    }

    const msg = c.icon + ' ' + p.name + ' の性能 +' + gain.toFixed(1) +
      (found ? '  🔬研究の知見をひとつ使った' : '') +
      (brk ? '  🔬' + brk + '！' : crit ? '  ✨ひらめき大成功！' : '');
    staffExp('engineer', 12); staffExp('designer', 3);
    U.log(g, msg, crit ? 'good' : '');
    GP.sound.play(crit ? 'crit' : 'confirm');
    /* 上限で止まったら、そこから先は「作り直す」しかない。
       この個体の器は、作った日に決まっている                */
    if (p.power >= cap) {
      U.toast('この個体はここまでです（品質 ' + S.qualOf(p).toFixed(2) +
        '）。もっと良い出来を狙うなら、📐開発で作り直します。', 'warn');
    }
    // 手を入れた実感が出るように、伸びを見せてから週を進める
    showDevResult({
      icon: U.partIcon(c.key, 44, S.qualStars(S.qualOf(p))), color: c.color,
      title: p.name,
      sub: brk ? '🔬 ' + brk : c.name,
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

    const hinted = (g.designEdge || 0) > 0;
    /* ---- 出来 ----
       素材が底を決め、工作機械と設計陣がそこへ積み、最後に運が乗る。
       同じ図面でも毎回ちがう出来になるのは、この最後のひと振りのため */
    const quality = S.rollQuality(g, key);
    if (hinted) g.designEdge = Math.max(0, (g.designEdge || 0) - 1);   // ヒントは1回で使い切る
    const ws = S.workshopOf(g);
    const grp = S.groupOfPart(key);
    const part = S.makePart(key, g.carGen, quality, { mat: S.matOf(g, grp) });
    // 作れば作るほど、その扇の勘所が溜まる
    S.addMatPoint(g, key, D.MAT.perDesign);
    /* 同じ図面でも、どの機械で削ったかで出来が変わる。
       そしてその図面そのものの質が、基本設計能力で決まる。
       （人事の噛み合わせ × 開発責任者とコンセプトの相性）      */
    const dm = S.designMul(g);
    const mm = (D.MATERIALS[S.matOf(g, grp)] || D.MATERIALS[0]).mul;
    part.power = Math.round(part.power * ws.prec * dm * mm * 10) / 10;
    g.inventory.push(part);

    const qt = S.qualTier(quality);
    const star = S.qualStars(quality);
    U.closeModal();
    U.log(g, '📐 ' + ws.icon + ' ' + ws.name + 'で ' + part.name + '（' + qt.name +
      ' ' + quality.toFixed(2) + '）が完成！ 性能 ' + Math.round(part.power),
      star >= 3 ? 'good' : '');
    GP.sound.play(star >= 4 ? 'crit' : 'confirm');
    staffExp('designer', 14); staffExp('engineer', 3);
    if (star >= 4) U.toast('🎉 ' + qt.name + 'の出来！「' + part.name + '」', 'good');
    else U.toast('📐 ' + part.name + '（' + qt.name + '）が完成', star >= 3 ? 'good' : '');
    U.pop(qt.name + ' ' + quality.toFixed(2), star >= 4 ? 'crit' : 'good');

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
    h += '<p class="desc">一時金と毎戦の供給料、それに走行データが入ります。' +
      '<b class="warn">そのかわり、渡した相手はその日から速くなります。</b>' +
      U.helpLink('engine') + '</p><div class="pick">';
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
    const track = S.trackAt(g, g.nextRace);
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
    const t = S.trackAt(g, g.nextRace);
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

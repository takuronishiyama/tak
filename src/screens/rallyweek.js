/* =========================================================
   ラリーウィーク

   サーキットの週末が「金曜の走行 → 予選 → 決勝」なら、
   ラリーの週末は「レッキ → 一日目 → サービス → 二日目 → …」。

   決めることは3つだけ。
     ・レッキ（どこまで下見するか）＝ ペースノートの精度
     ・攻めかた（確実に〜振り切る）＝ 速さと外す確率
     ・積むスペア（タイヤを何本持つか）＝ パンクの傷の深さ
   あとは走って、サービスで直す。
   ========================================================= */
window.GP = window.GP || {};

GP.screens = GP.screens || {};
GP.screens.rallyweek = function (A) {
  'use strict';

  let $, esc, money, render, endWeek, bindPick;
  let g = null;

  function link() {
    $ = A.$; esc = A.esc; money = A.money; render = A.render;
    endWeek = A.endWeek; bindPick = A.bindPick;
  }
  function setG(x) { g = x; }

  const D = () => GP.data;
  const RD = () => GP.rallydata;
  const S = () => GP.state;
  const U = () => GP.ui;

  /* 週末のあいだ持っておく決めごと */
  let plan = null;
  let pack = null;      // 走り終えた結果
  let shown = 0;        // どこまで見せたか

  function secs(t) {
    const m = Math.floor(t / 60), s2 = t - m * 60;
    return m + ':' + (s2 < 10 ? '0' : '') + s2.toFixed(1);
  }
  function gapS(t) { return (t >= 0 ? '+' : '') + t.toFixed(1); }

  function freshPlan() {
    return { recce: 'one', pace: 'std', spares: 2, crew: {}, service: {} };
  }

  /* ---------- 入口 ---------- */
  function cmdRally() {
    const St = S();
    const rally = St.venueAt(g, g.nextRace);
    if (!rally) return;
    if (!plan) plan = freshPlan();
    pack = null; shown = 0;
    showBrief(rally);
  }

  /* ---------- 出発前 ---------- */
  function showBrief(rally) {
    const St = S(), Ui = U();
    const sf = RD().SURFACES[rally.surface] || RD().SURFACES.gravel;
    const stages = GP.rally.buildStages(rally, (g.season || 1) * 97 + g.nextRace * 13);
    const km = stages.reduce((a, s) => a + s.km, 0);
    const byDay = [0, 1, 2].map(d => stages.filter(s => s.day === d));

    let body = '<div class="racehead"><b>第' + (g.nextRace + 1) + '戦 ' +
      rally.country + ' ' + esc(rally.name) + '</b>' +
      '<span>' + sf.icon + ' ' + sf.name + '　全' + stages.length + 'SS ／ ' +
      km.toFixed(1) + 'km</span></div>' +
      '<p class="desc">' + esc(rally.desc) + '</p>';

    // ---- 決めること ----
    body += '<div class="sub">レッキ（下見）</div>' +
      '<div class="pick" data-rrecce="1">';
    RD().RECCE.forEach(r => {
      const can = g.funds >= r.cost;
      body += '<button class="pickbtn' + (r.key === plan.recce ? ' on' : '') + (can ? '' : ' cant') +
        '" data-v="' + r.key + '"' + (can ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#6b4724">' + r.icon + '</span>' +
        '<span class="pb-body"><b>' + r.name + '</b><small>' + esc(r.note) + '</small></span>' +
        '<span class="pb-cost">' + (r.cost ? '💰' + money(r.cost) : '—') + '</span></button>';
    });
    body += '</div>';

    body += '<div class="sub">攻めかた</div>' +
      '<div class="pick" data-rpace="1">';
    RD().PACES.forEach(p => {
      body += '<button class="pickbtn' + (p.key === plan.pace ? ' on' : '') + '" data-v="' + p.key + '">' +
        '<span class="pb-ic" style="background:#8f2a24">' + p.icon + '</span>' +
        '<span class="pb-body"><b>' + p.name + '</b><small>' + esc(p.note) + '</small></span>' +
        '<span class="pb-cost">' + ((p.pace - 1) * 100 >= 0 ? '+' : '') +
        ((p.pace - 1) * 100).toFixed(1) + '%<br><em class="' + (p.risk > 1 ? 'warn' : 'free') + '">危険×' +
        p.risk.toFixed(2) + '</em></span></button>';
    });
    body += '</div>';

    body += '<div class="sub">積むスペアタイヤ</div>' +
      '<p class="desc">多く積むほどパンクしても傷が浅く済みますが、そのぶん重くなります。' +
      '1本あたり、全区間で <b>0.25%</b> ずつ遅くなります。</p>' +
      '<div class="pick" data-rspare="1">';
    [0, 1, 2, 3].forEach(n => {
      body += '<button class="pickbtn' + (n === plan.spares ? ' on' : '') + '" data-v="' + n + '">' +
        '<span class="pb-ic" style="background:#33313e">🛞</span>' +
        '<span class="pb-body"><b>' + n + '本</b><small>' +
        (n === 0 ? '軽さを取る。切ったらそこまで' : n >= 3 ? '重いが、何が来ても走り切れる'
          : '標準的な積みかた') + '</small></span>' +
        '<span class="pb-cost">' + (n ? '-' + (n * 0.25).toFixed(2) + '%' : '±0') + '</span></button>';
    });
    body += '</div>';

    // ---- 読み上げの見込み ----
    const crew = crewPlan();
    const nq = GP.rally.notesOf(g, crew[(g.drivers[0] || {}).id] || {});
    body += '<div class="erabox"><b>📓 ペースノートの読み　<em>' +
      Math.round(nq * 100) + ' / 100</em></b><small>' +
      coLine() + '　レッキの手間と、右席の腕と、息の合いかたで決まります。' +
      '読みが甘いと、速く走れないうえに外しやすくなります。</small></div>';

    // ---- 日程 ----
    body += '<div class="sub">日程</div><div class="sslist">';
    byDay.forEach((list, d) => {
      if (!list.length) return;
      body += '<div class="ssday"><b>' + (d + 1) + '日目</b><em>' + list.length + 'SS ／ ' +
        list.reduce((a, s) => a + s.km, 0).toFixed(1) + 'km</em></div>';
      list.forEach(s => {
        const ssf = RD().SURFACES[s.surface] || sf;
        body += '<div class="ssrow"><i style="background:' + ssf.color + '">SS' + s.n + '</i>' +
          '<span><b>' + esc(s.name) + '</b><small>' + s.km.toFixed(1) + 'km　' +
          ssf.icon + ssf.name + (s.night ? '　🌙 夜' : '') +
          (s.power ? '　⚡ パワーステージ' : '') + '</small></span>' +
          '<em>' + (s.twisty > 0.66 ? '曲がりどころ' : s.twisty < 0.4 ? '高速' : '中速') +
          (s.rough > 0.7 ? '・荒い' : '') + '</em></div>';
      });
    });
    body += '</div>';

    Ui.modal('🏁 ' + rally.name, body, [
      { label: '🏁 スタートする', cls: 'primary', fn: () => startRally(rally) },
      { label: 'まだ準備する', fn: Ui.closeModal }
    ]);
    bindOpt('data-rrecce', v => { plan.recce = v; showBrief(rally); });
    bindOpt('data-rpace', v => { plan.pace = v; showBrief(rally); });
    bindOpt('data-rspare', v => { plan.spares = +v; showBrief(rally); });
  }

  function bindOpt(attr, fn) {
    const box = $('modalBody').querySelector('[' + attr + ']');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-v]'), b => {
      b.onclick = () => { GP.sound.play('tap'); fn(b.dataset.v); };
    });
  }

  function coLine() {
    const St = S();
    const d = g.drivers[0];
    const co = d ? St.coOf(g, d) : null;
    if (!co) return '右席がまだ決まっていません。';
    return '右席は ' + esc(co.name) + '（腕 ' + co.skill + '／息 ' +
      Math.round((co.bond || 0) * 100) + '%）。';
  }

  /* いまの乗員の組み合わせを、走らせる側に渡す形にする */
  function crewPlan() {
    const St = S();
    const rc = RD().RECCE.filter(r => r.key === plan.recce)[0] || RD().RECCE[1];
    const out = {};
    (g.drivers || []).forEach(d => {
      const co = St.coOf(g, d);
      out[d.id] = { co: co, recce: rc.q, bond: co ? (co.bond || 0) : 0 };
    });
    return out;
  }

  /* ---------- 走る ---------- */
  function startRally(rally) {
    const St = S(), Ui = U();
    const rc = RD().RECCE.filter(r => r.key === plan.recce)[0] || RD().RECCE[1];
    if (rc.cost) {
      if (g.funds < rc.cost) return Ui.toast('資金が足りません', 'bad');
      g.funds -= rc.cost;
    }
    plan.crew = crewPlan();
    // 積んだスペアのぶんだけ、ほんの少し重い
    pack = GP.rally.run(g, g.nextRace, plan);
    shown = 0;
    Ui.closeModal();
    runStage();
  }

  /* ---------- SSを走る ----------
     結果はもう出ているので、ここでやるのは再生だけ。
     自車のうち、いちばん上の一台を映す                      */
  function runStage() {
    const Ui = U();
    if (!pack || shown >= pack.log.length) return showStage();
    const row = pack.log[shown];
    const st = row.st;
    const mine = row.board.filter(b => b.isPlayer).sort((a, b) => a.t - b.t)[0];
    if (!mine || !GP.rallyview) return showStage();
    const road = GP.rally.buildRoad(st, (g.season || 1) * 7919 + pack.round * 131 + st.n * 17);
    const moments = [];
    if (mine.note) {
      moments.push({ at: mine.note.at == null ? 0.5 : mine.note.at,
                     icon: mine.note.icon, name: mine.note.name,
                     line: mine.note.line, loss: mine.note.loss, out: mine.note.out });
    }
    Ui.closeModal();
    const scr = $('rallyScreen');
    scr.classList.add('show');
    GP.rallyview.start($('rallyCanvas'), {
      n: st.n, name: st.name, km: st.km, surface: st.surface, night: st.night,
      road: road, timeS: mine.t, moments: moments,
      /* この区間のベスト。走っている最中に「いま何秒差か」を出す */
      leadTime: (row.board[0] || mine).t,
      color: g.color, name2: mine.name, rate: viewRate
    }, () => {
      scr.classList.remove('show');
      showStage();
    });
    bindView();
  }

  let viewRate = 20;
  function bindView() {
    const set = (id, v) => {
      const b = $(id);
      if (!b) return;
      b.onclick = () => {
        viewRate = v; GP.rallyview.setRate(v);
        ['rySpeed0', 'rySpeed1', 'rySpeed2'].forEach(k => {
          const e = $(k); if (e) e.classList.toggle('primary', k === id);
        });
        GP.sound.play('tap');
      };
    };
    set('rySpeed0', 20); set('rySpeed1', 45); set('rySpeed2', 140);
    const sk = $('rySkip');
    if (sk) sk.onclick = () => { GP.sound.play('tap'); GP.rallyview.skip(); };
  }

  /* ---------- SSの結果 ---------- */
  function showStage() {
    const Ui = U();
    if (!pack) return;
    if (shown >= pack.log.length) return showResult();
    const row = pack.log[shown];
    const st = row.st;
    const sf = RD().SURFACES[st.surface] || RD().SURFACES.gravel;
    const mine = row.board.filter(b => b.isPlayer);

    let body = '<div class="racehead"><b>SS' + st.n + ' ' + esc(st.name) + '</b>' +
      '<span>' + st.km.toFixed(1) + 'km　' + sf.icon + sf.name +
      (st.night ? '　🌙' : '') + (pack.wet ? '　🌧️ 濡れている' : '') +
      (st.power ? '　⚡ パワーステージ' : '') + '</span></div>';

    // 自分に起きたこと
    mine.forEach(b => {
      if (!b.note) return;
      body += '<div class="mgrsay ' + (b.note.out ? 'bad' : 'warn') + '">' +
        '<b>' + b.note.icon + ' ' + esc(b.name) + '：' + esc(b.note.name) + '</b>' +
        esc(b.note.line) + (b.note.loss ? '（<b>+' + b.note.loss + '秒</b>）' : '') + '</div>';
    });

    // この区間のタイム
    body += '<div class="sub">この区間</div><div class="ssboard">';
    row.board.slice(0, 10).forEach(b => {
      body += '<div class="ssb' + (b.isPlayer ? ' me' : '') + '">' +
        '<i>' + b.pos + '</i>' +
        '<span class="ssb-c" style="background:' + b.color + '"></span>' +
        '<b>' + esc(b.name) + '</b>' +
        '<em>' + secs(b.t) + '</em>' +
        '<u>' + (b.pos === 1 ? '—' : gapS(b.gap)) + '</u></div>';
    });
    body += '</div>';

    // 総合
    body += '<div class="sub small">総合</div>' + overallHTML(shown);

    const last = shown >= pack.log.length - 1;
    const btns = [
      { label: last ? '🏆 結果へ' : (row.service ? '🔧 サービスへ' : '▶ 次のSSへ'),
        cls: 'primary', fn: () => { shown++; if (!last && row.service) showService(); else runStage(); } },
      { label: '⏭️ 残りを一気に', fn: () => { shown = pack.log.length; showResult(); } }
    ];
    Ui.modal('🏁 ' + pack.rally.name, body, btns, { wide: true });
  }

  /* その時点までの総合順位 */
  function overallHTML(uptoIdx) {
    const tot = {};
    const outAt = {};
    for (let i = 0; i <= uptoIdx && i < pack.log.length; i++) {
      pack.log[i].board.forEach(b => {
        if (b.out && outAt[b.id] == null) outAt[b.id] = i + 1;
        if (outAt[b.id] == null) tot[b.id] = (tot[b.id] || 0) + b.t;
      });
    }
    const meta = {};
    pack.log[0].board.forEach(b => { meta[b.id] = b; });
    const live = Object.keys(tot).filter(k => outAt[k] == null)
      .sort((a, b) => tot[a] - tot[b]);
    const lead = live.length ? tot[live[0]] : 0;
    let h = '<div class="ssboard">';
    live.slice(0, 10).forEach((k, i) => {
      const b = meta[k] || {};
      h += '<div class="ssb' + (b.isPlayer ? ' me' : '') + '">' +
        '<i>' + (i + 1) + '</i>' +
        '<span class="ssb-c" style="background:' + b.color + '"></span>' +
        '<b>' + esc(b.name) + '</b>' +
        '<em>' + secs(tot[k]) + '</em>' +
        '<u>' + (i === 0 ? '—' : gapS(tot[k] - lead)) + '</u></div>';
    });
    return h + '</div>';
  }

  /* ---------- サービスパーク ---------- */
  function showService() {
    const Ui = U();
    const SV = RD().SERVICE;
    const used = Object.keys(plan.service).reduce((a, k) =>
      a + ((SV.jobs.filter(j => j.key === k)[0] || {}).min || 0), 0);
    let body = '<div class="racehead"><b>🔧 サービスパーク</b>' +
      '<span>使える時間 ' + SV.minutes + '分　いま ' + used + '分</span></div>' +
      '<p class="desc">決められた時間のなかで、どこまで手を入れるか。' +
      '超えたぶんは <b>1分につき ' + SV.overPerMin + '秒</b> が総合タイムに足されます。</p>' +
      '<div class="pick" data-rjob="1">';
    SV.jobs.forEach(j => {
      const on = !!plan.service[j.key];
      body += '<button class="pickbtn' + (on ? ' on' : '') + '" data-v="' + j.key + '">' +
        '<span class="pb-ic" style="background:#464351">' + j.icon + '</span>' +
        '<span class="pb-body"><b>' + j.name + '</b><small>' + esc(j.note) + '</small></span>' +
        '<span class="pb-cost">' + j.min + '分</span></button>';
    });
    body += '</div>';
    const over = Math.max(0, used - SV.minutes);
    if (over > 0) {
      body += '<p class="note warn">⏱️ ' + over + '分の超過。総合に <b>+' +
        (over * SV.overPerMin) + '秒</b> が足されます。</p>';
    }
    Ui.modal('🔧 サービスパーク', body, [
      { label: '▶ 次の日へ', cls: 'primary', fn: () => { applyService(); runStage(); } }
    ], { wide: true });
    bindOpt('data-rjob', v => {
      if (plan.service[v]) delete plan.service[v]; else plan.service[v] = 1;
      showService();
    });
  }

  function applyService() {
    const SV = RD().SERVICE;
    const used = Object.keys(plan.service).reduce((a, k) =>
      a + ((SV.jobs.filter(j => j.key === k)[0] || {}).min || 0), 0);
    const over = Math.max(0, used - SV.minutes);
    if (over > 0 && pack) {
      /* 超過はペナルティ。自分のクルーだけが背負う */
      pack.classified.filter(c => c.isPlayer).forEach(c => {
        c.total += over * SV.overPerMin;
        c.servicePenalty = over * SV.overPerMin;
      });
    }
    plan.service = {};
  }

  /* ---------- 結果 ---------- */
  function showResult() {
    const Ui = U(), St = S();
    if (!pack) return;
    // 走り終えたぶんの息が合っていく
    (g.codrivers || []).forEach(co => St.coBond(co));

    const R = GP.race;
    /* サーキットの結果処理をそのまま使う。
       点・賞金・ファン・部品の消耗・輸送費まで、同じ計算でよい。
       向こうが見ている形（track / weather / trackIndex）だけ揃える */
    const res = {
      classified: pack.classified, special: null, fastestLap: null,
      /* 向こうが見るのは entries（スピンの数え上げ）だけなので、
         完走・リタイアをそのまま渡しておけばよい            */
      entries: pack.classified,
      track: pack.rally, trackIndex: pack.round,
      weather: { key: pack.wet ? 'rain' : 'sun', name: pack.wet ? '雨' : '晴れ' },
      laps: pack.stages.length
    };
    const out = R.applyResult(g, res);
    // パワーステージのぶん
    pack.classified.forEach(c => {
      if (!c.power) return;
      c.points = (c.points || 0) + c.power;
      if (c.driver) c.driver.seasonPoints += c.power;
      if (c.isPlayer) g.points += c.power;
      else if (c.team) c.team.points += c.power;
    });

    const win = pack.classified[0];
    let body = '<div class="racehead"><b>🏆 ' + esc(pack.rally.name) + '</b>' +
      '<span>' + (win ? esc(win.name) + ' 優勝' : '') + '</span></div>';
    body += '<div class="ssboard big">';
    pack.classified.slice(0, 14).forEach(c => {
      body += '<div class="ssb' + (c.isPlayer ? ' me' : '') + (c.dnf ? ' out' : '') + '">' +
        '<i>' + (c.dnf ? '—' : c.pos) + '</i>' +
        '<span class="ssb-c" style="background:' + c.color + '"></span>' +
        '<b>' + esc(c.name) + '<small>' + esc(c.teamName || '') + '</small></b>' +
        '<em>' + (c.dnf ? 'SS' + c.outAt + ' ' + esc(c.outWhy) : secs(c.total)) + '</em>' +
        '<u>' + (c.dnf ? 'リタイア' : c.pos === 1 ? '—' : gapS(c.gap)) +
        (c.points ? '　<b class="up">+' + c.points + '</b>' : '') + '</u></div>';
    });
    body += '</div>';
    if (out && out.notes && out.notes.length) {
      body += '<div class="sub small">この一戦で</div>';
      out.notes.forEach(n => { body += '<p class="note">' + n + '</p>'; });
    }
    Ui.modal('🏆 結果', body, [
      { label: '拠点へ戻る', cls: 'primary', fn: () => { Ui.closeModal(); finish(); } }
    ], { wide: true });
  }

  function finish() {
    const Ui = U();
    g.nextRace++;
    pack = null; plan = null; shown = 0;
    Ui.log(g, '🏁 ラリーを走り終えた。', 'good');
    S().save(g);
    endWeek();
  }

  return {
    name: 'rallyweek',
    link: link,
    setG: setG,
    api: { cmdRally: cmdRally }
  };
};

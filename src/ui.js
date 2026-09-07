/* =========================================================
   UI 描画
   ========================================================= */
window.GP = window.GP || {};

GP.ui = (function () {
  'use strict';
  const D = GP.data, S = GP.state;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => Math.round(n).toLocaleString('ja-JP');

  /* ---------- トップバー ---------- */
  function renderTop(g) {
    const nextIdx = g.nextRace % D.TRACKS.length;
    const rw = S.raceWeek(g.nextRace);
    const left = Math.max(0, rw - g.week);
    $('tTeam').textContent = g.team;
    $('tTeamDot').style.background = g.color;
    $('tFunds').textContent = money(g.funds);
    $('tFans').textContent = money(g.fans);
    $('tRp').textContent = money(g.rp);
    $('tSeason').textContent = g.season;
    $('tWeek').textContent = g.week;
    $('tNext').textContent = g.nextRace >= D.TRACKS.length
      ? 'シーズン終了'
      : (left === 0 ? '★ 今週レース！' : '第' + (g.nextRace + 1) + '戦まで あと' + left + '週');
    $('tNext').className = left === 0 ? 'race-imminent' : '';
    $('tFunds').parentElement.classList.toggle('danger', g.funds < 0);
  }

  /* ---------- 次戦カード ---------- */
  function nextRaceCard(g) {
    if (g.nextRace >= D.TRACKS.length) {
      return '<div class="card"><div class="card-h">🏁 シーズン最終節</div>' +
        '<div class="pad">全' + D.TRACKS.length + '戦が終了しました。「次の週へ」でシーズンを締めましょう。</div></div>';
    }
    const t = D.TRACKS[g.nextRace];
    const sc = S.carScore(g, t);
    return '<div class="card"><div class="card-h">🏁 第' + (g.nextRace + 1) + '戦 ' + t.country + ' ' + esc(t.name) + '</div>' +
      '<div class="pad">' +
      '<div class="track-mini" id="trackMini"></div>' +
      '<div class="tinfo"><span>周回数 <b>' + t.laps + '</b></span><span>難易度 <b>' + '★'.repeat(Math.round(t.risk * 2)) + '</b></span></div>' +
      '<p class="desc">' + esc(t.desc) + '</p>' +
      '<div class="req">求められる性能：' +
      reqBar('最高速', t.weight.speed) + reqBar('コーナー', t.weight.corner) + reqBar('加速', t.weight.accel) +
      '</div>' +
      '<div class="score">このコースでのマシン評価 <b>' + Math.round(sc) + '</b></div>' +
      '</div></div>';
  }
  function reqBar(name, v) {
    return '<div class="reqrow"><span>' + name + '</span><i><b style="width:' +
      Math.round(v * 180) + '%"></b></i><em>' + Math.round(v * 100) + '%</em></div>';
  }

  /* ---------- マシンパネル ---------- */
  function carCard(g) {
    const st = S.carStats(g), rel = S.reliability(g);
    let parts = '';
    D.PART_CATS.forEach(c => {
      const p = g.parts[c.key], tier = D.TIERS[p.tier];
      const pct = Math.min(100, p.level / tier.cap * 100);
      parts += '<div class="part">' +
        '<span class="p-ic">' + c.icon + '</span>' +
        '<span class="p-nm">' + c.name + '<small>' + tier.name + '</small></span>' +
        '<span class="p-lv">Lv.' + Math.round(p.level) + '</span>' +
        '<span class="p-bar"><i style="width:' + pct + '%;background:' + c.color + '"></i></span>' +
        '<span class="p-cond ' + (p.cond < 45 ? 'bad' : p.cond < 70 ? 'warn' : '') + '">' + Math.round(p.cond) + '%</span>' +
        '</div>';
    });
    return '<div class="card"><div class="card-h">🏎️ マシン開発状況</div><div class="pad">' +
      '<div class="statrow">' + statBar('最高速', st.speed, '#e04a3f') + statBar('コーナー', st.corner, '#3a7ad9') + statBar('加速', st.accel, '#4ea63f') + '</div>' +
      '<div class="rel">信頼性 <b class="' + (rel < 55 ? 'bad' : rel < 75 ? 'warn' : 'good') + '">' + Math.round(rel) + '%</b>' +
      '<small>低いとリタイアしやすい。「整備」で回復。</small></div>' +
      '<div class="parts">' + parts + '</div>' +
      '</div></div>';
  }
  function statBar(name, v, col) {
    const pct = Math.min(100, v / 1.6);
    return '<div class="sb"><span>' + name + '</span><i><b style="width:' + pct + '%;background:' + col + '"></b></i><em>' + Math.round(v) + '</em></div>';
  }

  /* ---------- ドライバーカード ---------- */
  function driverCards(g) {
    let h = '<div class="card"><div class="card-h">🧑‍✈️ 所属ドライバー</div><div class="pad drvwrap">';
    g.drivers.forEach((d, i) => { h += driverCard(d, i); });
    if (g.drivers.length < 2) h += '<div class="drv empty">シートが空いています<br><small>「人事」から雇いましょう</small></div>';
    h += '</div></div>';
    return h;
  }
  function driverCard(d, i) {
    const r = Math.round(S.driverRating(d));
    return '<div class="drv">' +
      '<div class="drv-head"><span class="helmet" style="background:' + helmetColor(d) + '"></span>' +
      '<span class="drv-nm">' + esc(d.name) + '</span><span class="drv-age">' + d.age + '歳</span></div>' +
      '<div class="trait">' + esc(d.trait) + '</div>' +
      '<div class="drv-stats">' +
      mini('速さ', d.speed) + mini('技術', d.technique) + mini('体力', d.stamina) + mini('精神', d.mental) +
      '</div>' +
      '<div class="drv-foot">' +
      '<span>総合 <b>' + r + '</b></span>' +
      '<span>調子 <b class="' + (d.form >= 108 ? 'good' : d.form <= 88 ? 'bad' : '') + '">' + formLabel(d.form) + '</b></span>' +
      '<span>今季 <b>' + d.seasonPoints + 'pt</b></span>' +
      '</div>' +
      '<div class="drv-sal">給料 ' + money(d.salary) + '万/週</div>' +
      '</div>';
  }
  function mini(n, v) {
    return '<div class="mst"><span>' + n + '</span><i><b style="width:' + Math.min(100, v / 1.9) + '%"></b></i><em>' + Math.round(v) + '</em></div>';
  }
  function formLabel(f) {
    if (f >= 112) return '絶好調';
    if (f >= 104) return '好調';
    if (f >= 96) return '普通';
    if (f >= 88) return '不調';
    return '絶不調';
  }
  function helmetColor(d) {
    let h = 0; for (let i = 0; i < d.name.length; i++) h = (h * 31 + d.name.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',70%,55%)';
  }

  /* ---------- サイドパネル（タブ）---------- */
  let sideTab = 'log';
  function renderSide(g) {
    const tabs = [['log', '📜 日誌'], ['team', '📊 チーム順位'], ['drv', '🏅 ドライバー順位'], ['staff', '👥 スタッフ']];
    let h = '<div class="tabs">';
    tabs.forEach(t => { h += '<button class="tab' + (sideTab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; });
    h += '</div><div class="tabbody">';
    if (sideTab === 'log') {
      h += '<div class="loglist">' + g.log.slice(-70).reverse().map(l =>
        '<div class="logline ' + (l.t || '') + '">' + esc(l.s) + '</div>').join('') + '</div>';
    } else if (sideTab === 'team') {
      h += '<table class="rank"><tr><th>#</th><th>チーム</th><th>pt</th></tr>' +
        S.constructorTable(g).map((r, i) =>
          '<tr class="' + (r.isPlayer ? 'me' : '') + '"><td>' + (i + 1) + '</td><td>' +
          '<span class="rk-chip" style="background:' + r.color + '"></span>' + esc(r.name) +
          '</td><td>' + r.points + '</td></tr>').join('') + '</table>';
    } else if (sideTab === 'drv') {
      const rows = S.driverTable(g).slice(0, 22);
      h += '<table class="rank"><tr><th>#</th><th>ドライバー</th><th>チーム</th><th>pt</th></tr>' +
        rows.map((r, i) => '<tr class="' + (r.isPlayer ? 'me' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(r.name) +
          '</td><td><span class="rk-chip" style="background:' + r.color + '"></span>' + esc(r.team) + '</td><td>' + r.points + '</td></tr>').join('') +
        '</table>';
    } else {
      h += '<div class="stafflist">';
      g.staff.forEach(s => {
        const t = D.STAFF_TYPES.find(x => x.key === s.type);
        h += '<div class="staff"><span class="s-ic">' + t.icon + '</span><span class="s-nm">' + esc(s.name) +
          '<small>' + t.name + '</small></span><span class="s-sk">技能 ' + s.skill + '</span><span class="s-sal">' + money(s.salary) + '万</span></div>';
      });
      if (!g.staff.length) h += '<p class="desc">スタッフがいません。</p>';
      h += '</div><div class="facs">';
      D.FACILITIES.forEach(f => {
        h += '<div class="fac"><span>' + f.icon + ' ' + f.name + '</span><b>Lv.' + g.facilities[f.key] + '</b></div>';
      });
      h += '</div>';
      h += '<div class="spons"><div class="sub">スポンサー</div>';
      g.sponsors.forEach(s => { h += '<div class="spon">' + s.icon + ' ' + esc(s.name) + '<em>' + money(s.per) + '万/戦</em></div>'; });
      h += '</div>';
    }
    h += '</div>';
    $('sidePanel').innerHTML = h;
    Array.prototype.forEach.call($('sidePanel').querySelectorAll('.tab'), b => {
      b.onclick = () => { sideTab = b.dataset.tab; renderSide(g); };
    });
  }
  /* ---------- ミニコース図 ---------- */
  function drawMini(track) {
    const el = $('trackMini');
    if (!el || !track) return;
    const w = 260, h = 108, pad = 12;
    const pts = GP.raceview.smoothPath(track.path, w, h, pad);
    let d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (let i = 1; i < pts.length; i++) d += 'L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1);
    d += 'Z';
    const start = pts[0];
    el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="xMidYMid meet">' +
      '<path d="' + d + '" fill="none" stroke="#4a2f1a" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<path d="' + d + '" fill="none" stroke="#f6efd8" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + start[0].toFixed(1) + '" cy="' + start[1].toFixed(1) + '" r="4" fill="#e04a3f" stroke="#4a2f1a" stroke-width="2"/></svg>';
  }

  /* ---------- 全体再描画 ---------- */
  function renderAll(g) {
    renderTop(g);
    $('viewPanel').innerHTML = nextRaceCard(g) + carCard(g) + driverCards(g);
    if (g.nextRace < D.TRACKS.length) drawMini(D.TRACKS[g.nextRace]);
    renderSide(g);
  }

  /* ---------- ログ ---------- */
  function log(g, s, type) {
    g.log.push({ s: '[S' + g.season + ' W' + g.week + '] ' + s, t: type || '' });
    if (g.log.length > 400) g.log.splice(0, g.log.length - 400);
  }

  /* ---------- トースト ---------- */
  function toast(text, type) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = text;
    $('toastLayer').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 2200);
  }

  /* ---------- 数値ポップ ---------- */
  function pop(text, type) {
    const el = document.createElement('div');
    el.className = 'numpop ' + (type || '');
    el.textContent = text;
    el.style.left = (40 + Math.random() * 20) + '%';
    $('toastLayer').appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  /* ---------- モーダル ---------- */
  function modal(title, body, buttons, opts) {
    opts = opts || {};
    const m = $('modal');
    m.className = 'show' + (opts.wide ? ' wide' : '');
    $('modalTitle').innerHTML = title;
    $('modalBody').innerHTML = body;
    const bar = $('modalBtns');
    bar.innerHTML = '';
    (buttons || [{ label: '閉じる', fn: closeModal }]).forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.innerHTML = b.label;
      el.disabled = !!b.disabled;
      el.onclick = b.fn;
      bar.appendChild(el);
    });
    return $('modalBody');
  }
  function closeModal() { $('modal').className = ''; }

  return { renderAll, renderTop, renderSide, log, toast, pop, modal, closeModal, money, esc, driverCard, drawMini, $ };
})();

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
    const sc = GP.base.scale(g);
    const el = $('tRank');
    if (el && el.textContent !== sc.rank) {
      el.textContent = sc.rank;
      el.classList.remove('grow');
      void el.offsetWidth;
      el.classList.add('grow');
    }
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
      '<div class="seclegend">' +
      '<span><i style="background:' + SECTOR_COLORS[0] + '"></i>S1</span>' +
      '<span><i style="background:' + SECTOR_COLORS[1] + '"></i>S2</span>' +
      '<span><i style="background:' + SECTOR_COLORS[2] + '"></i>S3</span>' +
      (t.landmarks ? '<em>◯ ' + t.landmarks.map(esc).join(' ／ ') + '</em>' : '') +
      '</div>' +
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
  function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

  function partTraitChips(p) {
    if (!p.traits || !p.traits.length) return '';
    return p.traits.map(k => {
      const t = D.PART_TRAITS.find(x => x.key === k);
      return t ? '<span class="ptr" title="' + esc(t.desc) + '">' + t.icon + t.name + '</span>' : '';
    }).join('');
  }

  /* パーツ1行（装備画面・保管一覧でも使う） */
  function partRow(g, p, opts) {
    opts = opts || {};
    const c = D.PART_CATS.find(x => x.key === p.cat);
    const rr = D.RARITY[p.rarity - 1];
    const cap = S.partCap(g, p);
    const pct = Math.min(100, p.power / cap * 100);
    return '<div class="part">' +
      '<span class="p-ic" style="background:' + c.color + '">' + c.icon + '</span>' +
      '<span class="p-nm">' + esc(p.name) +
        '<small><span class="p-rar" style="color:' + rr.color + '">' + stars(p.rarity) + '</span> ' + c.name + '</small></span>' +
      '<span class="p-lv">' + Math.round(p.power) + '<small>/' + cap + '</small></span>' +
      '<span class="p-bar"><i style="width:' + pct + '%;background:' + c.color + '"></i></span>' +
      '<span class="p-cond ' + (p.cond < 45 ? 'bad' : p.cond < 70 ? 'warn' : '') + '">' + Math.round(p.cond) + '%</span>' +
      (opts.trailing || '') +
      (partTraitChips(p) ? '<span class="p-trs">' + partTraitChips(p) + '</span>' : '') +
      '</div>';
  }

  function carCard(g) {
    const st = S.carStats(g), rel = S.reliability(g);
    const gen = D.CAR_GENS[g.carGen];
    let parts = '';
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      parts += p ? partRow(g, p)
        : '<div class="part empty"><span class="p-ic">' + c.icon + '</span>' +
          '<span class="p-nm">' + c.name + '<small>未装着</small></span></div>';
    });
    return '<div class="card"><div class="card-h">🏎️ マシン <b class="gen">' + gen.name + '</b></div><div class="pad">' +
      '<div class="statrow">' + statBar('最高速', st.speed, '#e04a3f') + statBar('コーナー', st.corner, '#3a7ad9') + statBar('加速', st.accel, '#4ea63f') + '</div>' +
      '<div class="rel">信頼性 <b class="' + (rel < 55 ? 'bad' : rel < 75 ? 'warn' : 'good') + '">' + Math.round(rel) + '%</b>' +
      '<small>低いとリタイアしやすい。「整備」で回復。</small></div>' +
      '<div class="parts">' + parts + '</div>' +
      (g.inventory.length ? '<div class="invnote">📦 保管パーツ ' + g.inventory.length + ' 個（「マシン」で装着・合成）</div>' : '') +
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
    const p = S.persOf(d), na = S.nationOf(d);
    return '<div class="drv">' +
      '<div class="drv-head">' + face(d, 34) +
      '<span class="drv-id"><span class="drv-nm">' + esc(d.name) + '</span>' +
      '<span class="drv-sub">' + na.flag + ' ' + d.age + '歳 ／ <b title="' + esc(p.desc) + '">' + p.icon + p.name + '</b></span></span>' +
      '</div>' +
      '<div class="skills">' + skillChips(d) + '</div>' +
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
  /* =========================================================
     ドライバーの顔（種から作るドット絵。SVGなので拡大しても崩れない）
     ========================================================= */
  const SKIN = ['#f2c9a0', '#e0a878', '#c8865a', '#9a6440', '#6e4630', '#f7dcc0'];
  const HAIR = ['#2b1c12', '#4a2f1a', '#8a5a2a', '#c8a040', '#d8d2c8', '#8a2a2a', '#2a4a8a', '#1c1c1c'];

  function face(d, px) {
    px = px || 34;
    let h = (d.face != null ? d.face : 0) >>> 0;
    const nx = m => { h = (h * 1103515245 + 12345) >>> 0; return h % m; };
    const skin = SKIN[nx(SKIN.length)];
    const hair = HAIR[nx(HAIR.length)];
    const style = nx(4);           // 髪型
    const brow = nx(2);
    const extra = nx(6);           // ヒゲ・そばかす等
    const f = d.form == null ? 100 : d.form;

    const r = (x, y, w, ht, c) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + ht + '" fill="' + c + '"/>';
    let g = '';
    g += r(3, 4, 10, 11, skin);                       // 顔
    g += r(2, 6, 1, 6, skin) + r(13, 6, 1, 6, skin);  // 耳
    // 髪型
    if (style === 0) g += r(2, 2, 12, 4, hair) + r(2, 5, 2, 3, hair) + r(12, 5, 2, 3, hair);
    else if (style === 1) g += r(3, 1, 10, 4, hair) + r(5, 0, 2, 1, hair) + r(9, 0, 2, 1, hair);
    else if (style === 2) g += r(2, 2, 12, 3, hair) + r(1, 4, 2, 8, hair) + r(13, 4, 2, 8, hair);
    else g += r(3, 2, 10, 3, hair) + r(2, 3, 1, 3, hair) + r(13, 3, 1, 3, hair) + r(3, 5, 3, 1, hair);
    // 眉と目（調子で表情が変わる）
    const eyeY = f < 88 ? 9 : 8;
    g += r(5, eyeY - 2 + brow, 2, 1, '#3a2418') + r(9, eyeY - 2 + brow, 2, 1, '#3a2418');
    if (f >= 112) { g += r(5, eyeY, 2, 1, '#222') + r(9, eyeY, 2, 1, '#222'); }
    else { g += r(5, eyeY, 2, 2, '#222') + r(9, eyeY, 2, 2, '#222'); }
    // 口
    if (f >= 108) g += r(6, 12, 4, 1, '#a04030') + r(7, 13, 2, 1, '#a04030');
    else if (f <= 88) g += r(6, 13, 4, 1, '#8a4038');
    else g += r(7, 12, 2, 1, '#8a4038');
    // 個性
    if (extra === 0) g += r(6, 11, 4, 1, hair);                       // ヒゲ
    if (extra === 1) g += r(4, 10, 1, 1, '#c88060') + r(11, 10, 1, 1, '#c88060'); // そばかす
    if (extra === 2) g += r(4, 7, 8, 2, 'rgba(30,30,40,.75)');        // サングラス

    return '<svg class="face" viewBox="0 0 16 16" width="' + px + '" height="' + px + '" shape-rendering="crispEdges">' +
      '<rect width="16" height="16" fill="#cfe6f5"/>' + g + '</svg>';
  }

  function skillChips(d) {
    if (!d.skills || !d.skills.length) return '<span class="skill none">スキルなし</span>';
    return d.skills.map(k => {
      const s = D.SKILLS.find(x => x.key === k);
      return s ? '<span class="skill" title="' + esc(s.desc) + '">' + s.icon + s.name + '</span>' : '';
    }).join('');
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
  const SECTOR_COLORS = ['#f0a020', '#4ea63f', '#3a7ad9'];

  function drawMini(track) {
    const el = $('trackMini');
    if (!el || !track) return;
    const w = 260, h = 108, pad = 14;
    const poly = GP.geom.buildPoly(track.path, w, h, pad);
    const geo = GP.geom.analyze(track);
    const pts = poly.pts, n = poly.n;
    const seg = (from, to) => {
      let d = '', k = from, steps = 0;
      const span = (to - from + n) % n;
      while (steps <= span) {
        const p = pts[k % n];
        d += (steps ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
        k++; steps++;
      }
      return d;
    };
    let outline = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (let i = 1; i < n; i++) outline += 'L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1);
    outline += 'Z';

    // セクターごとに色分けし、どこで速さが要るのか一目で分かるようにする
    let secPaths = '';
    (geo.sectors || []).forEach((sc, i) => {
      secPaths += '<path d="' + seg(sc.from, sc.to) + '" fill="none" stroke="' + SECTOR_COLORS[i] +
        '" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>';
    });
    // 名物コーナーの位置
    let marks = '';
    (geo.corners || []).slice().sort((a, b) => b.peak - a.peak)
      .slice(0, (track.landmarks || []).length).forEach(cn => {
        const mid = pts[Math.round(cn.from + ((cn.to - cn.from + n) % n) / 2) % n];
        marks += '<circle cx="' + mid[0].toFixed(1) + '" cy="' + mid[1].toFixed(1) +
          '" r="3.2" fill="#fff" stroke="#4a2f1a" stroke-width="1.6"/>';
      });
    const start = pts[0];
    el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="xMidYMid meet">' +
      '<path d="' + outline + '" fill="none" stroke="#4a2f1a" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>' +
      secPaths + marks +
      '<circle cx="' + start[0].toFixed(1) + '" cy="' + start[1].toFixed(1) + '" r="4.5" fill="#e04a3f" stroke="#4a2f1a" stroke-width="2"/></svg>';
  }

  /* ---------- 特別戦の招待カード ---------- */
  function specialCard(g, sp) {
    if (!sp || !g.special) return '';
    const t = D.TRACKS[g.special.trackIndex];
    const laps = Math.max(4, Math.round(t.laps * sp.lapMul));
    return '<div class="card special"><div class="card-h">' + sp.icon + ' 特別戦の招待 — ' + esc(sp.name) + '</div>' +
      '<div class="pad">' +
      '<p class="lead">' + esc(sp.desc) + '</p>' +
      '<div class="sp-meta"><span>会場 <b>' + t.country + ' ' + esc(t.name) + '</b></span>' +
      '<span>距離 <b>' + laps + '周</b></span>' +
      '<span>エントリー費 <b>💰' + money(sp.entry) + '万</b></span></div>' +
      '<p class="note">' + esc(sp.note) + '</p>' +
      '<p class="desc">選手権のポイントは動きません。参加すると1週を消費します。</p>' +
      '<div class="sp-btns">' +
      '<button class="btn primary" id="specialGo"' + (g.funds < sp.entry ? ' disabled' : '') + '>' + sp.icon + ' 参加する</button>' +
      '<button class="btn" id="specialSkip">見送る</button></div>' +
      '</div></div>';
  }

  /* ---------- 全体再描画 ---------- */
  function renderAll(g, special) {
    renderTop(g);
    $('viewPanel').innerHTML = specialCard(g, special) + nextRaceCard(g) + carCard(g) + driverCards(g);
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
    if (GP.sound) {
      if (type === 'bad') GP.sound.play('bad', 300);
      else if (type === 'warn') GP.sound.play('warn', 300);
    }
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

  return { renderAll, renderTop, renderSide, log, toast, pop, modal, closeModal,
           money, esc, driverCard, drawMini, partRow, skillChips, stars, partTraitChips, face, $ };
})();

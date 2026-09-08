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
    if (g.nextRace >= D.TRACKS.length) {
      $('tNext').innerHTML = 'シーズン終了';
      $('tNext').className = '';
    } else if (left === 0) {
      $('tNext').innerHTML = '★ 今週レース！';
      $('tNext').className = 'race-imminent';
    } else {
      // 1コマンド＝1週なので、残り週数がそのまま「あと何回動けるか」になる
      let pips = '';
      for (let i = 0; i < left; i++) pips += '<i></i>';
      $('tNext').innerHTML = '第' + (g.nextRace + 1) + '戦まで <b>あと' + left + '週</b>' +
        '<span class="pips" title="レースまでに実行できるコマンド数">' + pips + '</span>' +
        '<em>コマンドあと' + left + '回</em>';
      $('tNext').className = left <= 1 ? 'race-soon' : '';
    }
    const ht = S.hypeTier(g);
    $('tHypeIc').textContent = ht.icon;
    $('tHypeVal').textContent = Math.round(g.hype || 0);
    $('tHypeBar').style.width = Math.round(g.hype || 0) + '%';
    $('tHypeBar').style.background = ht.color;
    $('tHypeBox').title = 'メディアでの扱い：' + ht.name +
      '（スポンサー収入 ×' + S.hypeBonus(g).toFixed(2) + '）';
    const tk = g.tickets || 0;
    $('tTicket').textContent = tk;
    $('tTicketBox').style.display = tk ? '' : 'none';
    $('tTicketBox').classList.toggle('has', tk > 0);
    const dm = S.diffOf(g);
    const md = $('tMode');
    md.textContent = dm.icon + dm.name;
    md.style.background = dm.color;
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
    const left = Math.max(0, S.raceWeek(g.nextRace) - g.week);
    const pips = left > 0 ? new Array(left + 1).join('<i></i>') : '';
    return '<div class="card"><div class="card-h">🏁 第' + (g.nextRace + 1) + '戦 ' + t.country + ' ' + esc(t.name) + '</div>' +
      '<div class="pad">' +
      '<div class="countdown' + (left === 0 ? ' now' : '') + '">' +
      (left === 0
        ? '<b>★ 今週が決勝です</b><span>「レースへ向かう！」を押してください</span>'
        : '<b>準備できるのは あと ' + left + ' 回</b>' +
          '<span class="pips">' + pips + '</span>' +
          '<span>コマンドを1つ選ぶと1週進みます</span>') +
      '</div>' +
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
      '<span class="p-ic ic-art" style="background:' + c.color + '">' + partIcon(c.key, 18, p.rar) + '</span>' +
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
        : '<div class="part empty"><span class="p-ic ic-art">' + partIcon(c.key, 18, 0) + '</span>' +
          '<span class="p-nm">' + c.name + '<small>未装着</small></span></div>';
    });
    const ers = S.ersOf(g);
    const cap = S.bodyCap(g);
    let bodyRows = '';
    D.BODY_ATTRS.forEach(a => {
      const v = (g.body && g.body[a.key]) || 0;
      const pct = Math.min(100, v / cap * 100);
      bodyRows += '<div class="battr" title="' + esc(a.desc) + '">' +
        '<span>' + a.icon + a.name + '</span>' +
        '<i><b style="width:' + pct + '%;background:' + a.color + '"></b></i>' +
        '<em>' + (Math.round(v * 10) / 10) + '<small>/' + cap + '</small></em></div>';
    });
    return '<div class="card"><div class="card-h">🏎️ マシン <b class="gen">' + gen.name + '</b></div><div class="pad">' +
      '<div class="statrow">' + statBar('最高速', st.speed, '#e04a3f') + statBar('コーナー', st.corner, '#3a7ad9') + statBar('加速', st.accel, '#4ea63f') + '</div>' +
      '<div class="ersrow" title="エレクトロニクスの性能で決まります。直線での放電に使われ、前車に迫るときは多く消費します">' +
      '<span>🔋 バッテリー</span>' +
      '<em>容量 <b>' + Math.round(ers.capacity) + '</b></em>' +
      '<em>回生 <b>' + ers.recover + '</b>/周</em>' +
      '<em>放電 <b>' + ers.deploy + '</b>/周</em></div>' +
      '<div class="rel">信頼性 <b class="' + (rel < 55 ? 'bad' : rel < 75 ? 'warn' : 'good') + '">' + Math.round(rel) + '%</b>' +
      '<small>低いとリタイアしやすい。「整備」で回復。</small></div>' +
      '<div class="sub small">車体の熟成</div><div class="bodyattrs">' + bodyRows + '</div>' +
      '<div class="sub small">装着パーツ</div>' +
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
  const SKIN  = ['#f2c9a0', '#e0a878', '#c8865a', '#9a6440', '#6e4630', '#f7dcc0'];
  const HAIR  = ['#2b1c12', '#4a2f1a', '#8a5a2a', '#c8a040', '#d8d2c8', '#8a2a2a', '#2a4a8a', '#1c1c1c'];
  const EYES  = ['#3a2a18', '#2a4a70', '#2f5a3a', '#5a3a6a', '#1c1c22'];
  const SUITS = ['#c8362c', '#2f66c0', '#3f9440', '#d8a020', '#9a4fc0', '#2aa0b8'];

  /* ---------- パーツのアイコン ----------
     カテゴリごとに、そのものの形を16×16のドット絵で描く。
     絵文字だと端末ごとに絵が変わってしまうので、自前で持つ。
     rar（レア度 0..4）が上がるほど、金属の照りと縁の輝きが強くなる。   */
  function partIcon(key, px, rar) {
    px = px || 20; rar = rar || 0;
    const r = (x, y, w, h, c) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>';
    const shine = 0.10 + rar * 0.10;                       // レアほど光る
    const hi = 'rgba(255,255,255,' + (0.30 + shine).toFixed(2) + ')';
    let g = '';

    if (key === 'pu') {
      // パワーユニット：Vバンクのエンジンブロック
      g += r(3, 5, 10, 8, '#5a5f6a') + r(3, 5, 10, 2, '#7c828e');
      g += r(2, 7, 1, 5, '#454a54') + r(13, 7, 1, 5, '#454a54');
      g += r(4, 2, 2, 4, '#8d94a0') + r(7, 2, 2, 4, '#8d94a0') + r(10, 2, 2, 4, '#8d94a0'); // 排気管
      g += r(4, 2, 2, 1, hi) + r(7, 2, 2, 1, hi) + r(10, 2, 2, 1, hi);
      g += r(4, 8, 8, 1, '#2f333b') + r(4, 10, 8, 1, '#2f333b');                            // 冷却フィン
      g += r(5, 13, 6, 2, '#3a3f48');                                                       // オイルパン
      g += r(3, 5, 3, 1, hi);

    } else if (key === 'aero') {
      // エアロ：多段のリアウイングと翼端板
      g += r(2, 4, 12, 2, '#2b2f38') + r(2, 4, 12, 1, hi);        // 上段
      g += r(3, 8, 10, 2, '#343945') + r(3, 8, 10, 1, hi);        // 下段
      g += r(1, 3, 2, 9, '#4a5160') + r(1, 3, 1, 9, '#5f6778');   // 翼端板
      g += r(13, 3, 2, 9, '#4a5160');
      g += r(7, 6, 2, 3, '#2b2f38');                              // 支柱
      g += r(4, 12, 8, 2, '#242830') + r(4, 12, 8, 1, 'rgba(255,255,255,.18)');  // ディフューザー

    } else if (key === 'chas') {
      // シャシー：モノコックの骨組み
      g += r(3, 3, 10, 11, '#4a4f5a');
      g += r(4, 4, 8, 9, '#6a707d');
      g += r(4, 4, 8, 2, hi);
      g += r(6, 6, 4, 5, '#343945');                              // コクピット開口
      g += r(2, 5, 1, 7, '#3a3f48') + r(13, 5, 1, 7, '#3a3f48');
      g += r(3, 13, 10, 2, '#2c3038');                            // フロア
      // 織り目（カーボン）
      g += r(4, 8, 8, 1, 'rgba(0,0,0,.22)') + r(4, 11, 8, 1, 'rgba(0,0,0,.22)');

    } else if (key === 'susp') {
      // サスペンション：コイルスプリングとダンパー
      g += r(7, 2, 2, 12, '#5a606c');                             // シャフト
      g += r(7, 2, 1, 12, '#7a818e');
      for (let y = 3; y < 12; y += 2) {                           // コイル
        g += r(4, y, 8, 1, '#9aa2b0') + r(4, y, 8, 0.5, hi);
        g += r(4, y + 1, 8, 1, '#5e6572');
      }
      g += r(5, 1, 6, 2, '#454a54') + r(5, 13, 6, 2, '#454a54');  // 上下のマウント
      g += r(5, 1, 6, 1, hi);

    } else {
      // エレクトロニクス：基板とチップ
      g += r(2, 3, 12, 10, '#1e5a35') + r(2, 3, 12, 1, '#2f7a48');
      g += r(5, 6, 6, 5, '#22262e') + r(5, 6, 6, 1, '#3c414c');   // チップ
      g += r(6, 7, 4, 3, '#2f353f');
      for (let x = 3; x < 13; x += 3) {                           // 配線
        g += r(x, 4, 1, 2, '#c8a53a') + r(x, 11, 1, 2, '#c8a53a');
      }
      g += r(3, 8, 2, 1, '#c8a53a') + r(11, 8, 2, 1, '#c8a53a');
      g += r(4, 5, 1, 1, hi) + r(10, 5, 1, 1, hi);                // はんだの光
      if (rar >= 2) g += r(11, 4, 2, 2, '#7ce8ff');               // 動作ランプ
    }

    // レアなパーツは縁が光る
    const edge = rar >= 3 ? '<rect x="0.5" y="0.5" width="15" height="15" fill="none" stroke="rgba(255,224,150,'
                            + (0.35 + rar * 0.12).toFixed(2) + ')" stroke-width="1"/>' : '';
    return '<svg class="picon" viewBox="0 0 16 16" width="' + px + '" height="' + px +
      '" shape-rendering="crispEdges">' + g + edge + '</svg>';
  }

  /* ---------- ドライバーの顔 ----------
     24×24 のドット絵。d.face を種にして、肌・髪・目・髪型・特徴を決める。
     調子（form）で表情が変わり、レーシングスーツの色で個体差を出す。      */
  function face(d, px) {
    px = px || 34;
    let h = (d.face != null ? d.face : 0) >>> 0;
    // 種を撹拌してから使う。そのまま回すと、近い種で似た顔ばかりになる
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0;
    h ^= h >>> 16;
    const nx = m => { h = (Math.imul(h, 1103515245) + 12345) >>> 0; return (h >>> 8) % m; };
    const skin  = SKIN[nx(SKIN.length)];
    const hair  = HAIR[nx(HAIR.length)];
    const eye   = EYES[nx(EYES.length)];
    const suit  = SUITS[nx(SUITS.length)];
    const style = nx(6);           // 髪型
    const brow  = nx(2);           // 眉の高さ
    const extra = nx(7);           // ヒゲ・そばかす等
    const f = d.form == null ? 100 : d.form;

    // 肌と髪の陰影を作る
    const mix = (hex, amt) => {
      const n = parseInt(hex.slice(1), 16);
      const c = v => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
      return 'rgb(' + c((n >> 16) & 255) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
    };
    const skinSh = mix(skin, -0.11), skinHi = mix(skin, 0.09);
    const hairHi = mix(hair, 0.16),  hairSh = mix(hair, -0.10);
    const suitSh = mix(suit, -0.14), suitHi = mix(suit, 0.16);

    const r = (x, y, w, ht, c) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + ht + '" fill="' + c + '"/>';
    let g = '';

    // ---- 肩とレーシングスーツ ----
    g += r(2, 19, 20, 5, suitSh);
    g += r(3, 20, 18, 4, suit);
    g += r(3, 20, 18, 1, suitHi);                    // 肩の照り
    g += r(9, 19, 6, 5, mix(suit, -0.22));           // 襟の合わせ
    g += r(11, 19, 2, 5, '#e8e4d8');                 // ファスナー
    // ---- 首 ----
    g += r(9, 16, 6, 4, skinSh);
    g += r(10, 16, 4, 3, skin);

    // ---- 顔の輪郭 ----
    g += r(5, 4, 14, 14, skin);
    g += r(4, 6, 1, 9, skin) + r(19, 6, 1, 9, skin); // 耳
    g += r(15, 4, 4, 14, skinSh);                    // 右側は影
    g += r(5, 4, 3, 14, skinHi);                     // 左側に光
    g += r(5, 16, 14, 2, skinSh);                    // 顎の下

    // ---- 髪型 ----
    if (style === 0) {                                // 短髪
      g += r(4, 1, 16, 5, hair) + r(4, 5, 2, 5, hair) + r(18, 5, 2, 5, hair);
      g += r(5, 1, 8, 2, hairHi);
    } else if (style === 1) {                         // 立ち上げ
      g += r(5, 0, 14, 5, hair) + r(7, -1, 3, 2, hair) + r(13, -1, 3, 2, hair);
      g += r(6, 0, 7, 2, hairHi);
    } else if (style === 2) {                         // 長髪
      g += r(4, 1, 16, 5, hair) + r(2, 4, 3, 13, hair) + r(19, 4, 3, 13, hair);
      g += r(5, 1, 8, 2, hairHi) + r(19, 5, 1, 10, hairSh);
    } else if (style === 3) {                         // 分け目
      g += r(4, 1, 16, 4, hair) + r(4, 4, 3, 4, hair) + r(18, 4, 2, 4, hair);
      g += r(4, 4, 7, 2, hair) + r(5, 1, 6, 2, hairHi);
    } else if (style === 4) {                         // 坊主／短く刈る
      g += r(5, 2, 14, 3, hair) + r(4, 4, 2, 3, hair) + r(18, 4, 2, 3, hair);
      g += r(6, 2, 7, 1, hairHi);
    } else {                                          // 結んだ髪
      g += r(4, 1, 16, 5, hair) + r(4, 5, 2, 4, hair) + r(18, 5, 2, 4, hair);
      g += r(19, 8, 4, 7, hair) + r(20, 9, 2, 5, hairSh) + r(5, 1, 8, 2, hairHi);
    }

    // ---- 眉と目（調子で表情が変わる）----
    const ey = f < 88 ? 12 : 11;
    g += r(7, ey - 3 + brow, 4, 1, hairSh) + r(13, ey - 3 + brow, 4, 1, hairSh);
    if (f >= 112) {                                   // 好調：目を細めて笑う
      g += r(7, ey, 4, 1, '#2a2028') + r(13, ey, 4, 1, '#2a2028');
    } else {
      g += r(7, ey, 4, 3, '#f4f2ee') + r(13, ey, 4, 3, '#f4f2ee');   // 白目
      g += r(8, ey + 1, 2, 2, eye) + r(14, ey + 1, 2, 2, eye);       // 虹彩
      g += r(8, ey + 1, 1, 1, '#ffffff') + r(14, ey + 1, 1, 1, '#ffffff'); // 光
      g += r(7, ey, 4, 1, mix(skin, -0.20)) + r(13, ey, 4, 1, mix(skin, -0.20)); // まぶたの影
    }
    // ---- 鼻と口 ----
    g += r(11, ey + 3, 2, 2, skinSh);
    if (f >= 108)      g += r(9, ey + 6, 6, 1, '#8e3a30') + r(10, ey + 7, 4, 1, '#b05a48');
    else if (f <= 88)  g += r(9, ey + 7, 6, 1, '#7e3a34');
    else               g += r(10, ey + 6, 4, 1, '#8a4038');

    // ---- 個性 ----
    if (extra === 0) g += r(8, ey + 5, 8, 3, hairSh) + r(9, ey + 8, 6, 1, hairSh);   // ヒゲ
    if (extra === 1) g += r(6, ey + 2, 2, 1, mix(skin, -0.16)) + r(16, ey + 2, 2, 1, mix(skin, -0.16)); // そばかす
    if (extra === 2) g += r(6, ey - 1, 12, 4, 'rgba(26,26,34,.82)') + r(7, ey, 3, 1, 'rgba(255,255,255,.35)'); // サングラス
    if (extra === 3) g += r(4, 5, 16, 2, '#e8e4d8') + r(4, 5, 16, 1, '#ffffff');     // ハチマキ
    if (extra === 4) g += r(8, ey + 6, 8, 2, hairSh);                                // 口ひげ

    return '<svg class="face" viewBox="0 0 24 24" width="' + px + '" height="' + px + '" shape-rendering="crispEdges">' +
      '<rect width="24" height="24" fill="#3f4d61"/>' +
      '<rect width="24" height="13" fill="#54657e"/>' + g + '</svg>';
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
      g.sponsors.forEach(s => {
        const bits = [];
        if (s.per) bits.push('💰' + money(s.per));
        if (s.rp) bits.push('🔬' + s.rp);
        if (s.fan) bits.push('👥' + money(s.fan));
        h += '<div class="spon">' + s.icon + ' ' + esc(s.name) + '<em>' + bits.join(' ') + '</em></div>';
      });
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
      secPaths += '<path class="sec" d="' + seg(sc.from, sc.to) + '" fill="none" stroke="' + SECTOR_COLORS[i] +
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

  /* =========================================================
     収支ダッシュボード
     ========================================================= */
  function finance(g) {
    const f = S.finances(g);
    const cyc = S.raceWeek(0);
    const rows = [
      ['👥 スタッフ給料', f.staff], ['👔 首脳陣の報酬', f.managers],
      ['🧑‍✈️ ドライバー給料', f.drivers], ['🎓 育成の費用', f.youth],
      ['🏗️ 施設の維持費', f.facilities], ['📋 その他', f.other]
    ];
    const raw = rows.reduce((a, r) => a + r[1], 0);
    let h = '<div class="sub">💹 収支</div>' +
      '<div class="fin"><div class="fin-col"><div class="fin-h">毎週の支出</div>';
    rows.forEach(r => {
      h += '<div class="fin-row"><span>' + r[0] + '</span><b>' + money(r[1]) + '</b></div>';
    });
    if (f.cut > 0) {
      h += '<div class="fin-row cut"><span>🚚 ロジスティクス削減</span><b>-' +
        Math.round(f.cut * 100) + '%</b></div>';
    }
    h += '<div class="fin-row total"><span>合計</span><b>' + money(f.weekly) + '万 / 週</b></div>' +
      '</div><div class="fin-col"><div class="fin-h">レース1回あたり</div>' +
      '<div class="fin-row"><span>📣 スポンサー収入</span><b class="good">+' + money(f.sponsorPerRace) + '</b></div>' +
      (f.sponsorRpPerRace ? '<div class="fin-row"><span>🔬 スポンサーの研究P</span><b class="good">+' + f.sponsorRpPerRace + '</b></div>' : '') +
      '<div class="fin-row"><span>💸 ' + cyc + '週ぶんの支出</span><b class="bad">-' + money(f.cycleCost) + '</b></div>' +
      '<div class="fin-row total"><span>差し引き</span><b class="' + (f.net >= 0 ? 'good' : 'bad') + '">' +
      (f.net >= 0 ? '+' : '') + money(f.net) + '万</b></div>' +
      '<p class="desc">※ここに賞金が加わります。賞金は順位しだいなので、' +
      'この差し引きがマイナスでも上位に入れば黒字になります。</p>' +
      '</div></div>';
    if (f.net < 0) {
      h += '<p class="note">スポンサー収入だけでは ' + money(-f.net) + '万 足りません。' +
        '順位を上げて賞金と注目度を稼ぐか、支出を見直しましょう。</p>';
    }
    return h;
  }

  /* =========================================================
     チャンピオンシップ順位表
     実際のF1と同じ配点（25-18-15-12-10-8-6-4-2-1）＋
     10位以内で完走したファステストラップに +1
     ========================================================= */
  function standings(g) {
    const rounds = g.results.filter(r => r.season === g.season);
    let h = '<div class="sub">🏆 ドライバーズランキング</div>';

    // ラウンドごとの獲得ポイントを名前で引けるようにする
    const byRound = {};
    rounds.forEach((r, i) => {
      r.rows.forEach(row => {
        byRound[row.name] = byRound[row.name] || [];
        byRound[row.name][i] = { pts: row.pts, pos: row.pos, dnf: row.dnf, fl: row.fl };
      });
    });

    const stats = {};
    g.drivers.forEach(d => { stats[d.name] = d; });
    g.rivals.forEach(t => t.drivers.forEach(d => { stats[d.name] = d; }));

    const rows = S.driverTable(g);
    h += '<div class="tablewrap"><table class="rank champ"><tr>' +
      '<th>#</th><th>ドライバー</th><th>チーム</th><th title="優勝">🏆</th>' +
      '<th title="表彰台">🥉</th><th title="ポールポジション">P</th>' +
      '<th title="ファステストラップ">⚡</th><th>pt</th></tr>';
    rows.forEach((r, i) => {
      const d = stats[r.name] || {};
      h += '<tr class="' + (r.isPlayer ? 'me' : '') + '"><td>' + (i + 1) + '</td>' +
        '<td class="nm">' + esc(r.name) + '</td>' +
        '<td><span class="rk-chip" style="background:' + r.color + '"></span>' + esc(r.team) + '</td>' +
        '<td>' + (d.wins || 0) + '</td><td>' + (d.podiums || 0) + '</td>' +
        '<td>' + (d.poles || 0) + '</td><td>' + (d.fastestLaps || 0) + '</td>' +
        '<td class="pt">' + r.points + '</td></tr>';
    });
    h += '</table></div>';

    h += '<div class="sub">🏭 コンストラクターズランキング</div>';
    h += '<div class="tablewrap"><table class="rank champ"><tr><th>#</th><th>チーム</th><th>pt</th></tr>';
    S.constructorTable(g).forEach((r, i) => {
      h += '<tr class="' + (r.isPlayer ? 'me' : '') + '"><td>' + (i + 1) + '</td>' +
        '<td class="nm"><span class="rk-chip" style="background:' + r.color + '"></span>' + esc(r.name) + '</td>' +
        '<td class="pt">' + r.points + '</td></tr>';
    });
    h += '</table></div>';

    // ラウンド別のポイント推移（上位ドライバーぶん）
    if (rounds.length) {
      h += '<div class="sub">📈 ラウンド別の獲得ポイント</div>';
      h += '<div class="tablewrap"><table class="rank grid"><tr><th class="nm">ドライバー</th>';
      rounds.forEach(r => { h += '<th title="' + esc(r.track) + '">R' + r.round + '</th>'; });
      h += '<th>計</th></tr>';
      rows.slice(0, 12).forEach(r => {
        h += '<tr class="' + (r.isPlayer ? 'me' : '') + '"><td class="nm">' + esc(r.name) + '</td>';
        rounds.forEach((rd, i) => {
          const c = (byRound[r.name] || [])[i];
          if (!c) { h += '<td class="dim">-</td>'; return; }
          const cls = c.dnf ? 'dnf' : c.pos === 1 ? 'gold' : c.pos <= 3 ? 'pod' : c.pts ? 'pts' : 'dim';
          h += '<td class="' + cls + '" title="' + (c.dnf ? 'リタイア' : c.pos + '位') +
            (c.fl ? ' / ファステストラップ' : '') + '">' + (c.dnf ? '×' : (c.pts || '·')) + '</td>';
        });
        h += '<td class="pt">' + r.points + '</td></tr>';
      });
      h += '</table></div>';
      h += '<p class="desc">セルの数字はその戦で得たポイント。🏆金＝優勝、緑＝表彰台、× はリタイア。</p>';
    }
    return h;
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
    $('viewPanel').innerHTML = specialCard(g, special) + hubCard(g) + nextRaceCard(g) + carCard(g) + driverCards(g);
    if (g.nextRace < D.TRACKS.length) drawMini(D.TRACKS[g.nextRace]);
    renderSide(g);
  }

  /* ---------- 本拠地（ここが操作の起点になる）----------
     建物を押すと、その設備の画面が開く。何が開くかは main.js が決める。 */
  function hubCard(g) {
    const sc = GP.base.scale(g);
    return '<div class="card hub">' +
      '<div class="card-h">🏠 チーム本拠地 <b class="hubrank">' + esc(sc.rank) + '</b></div>' +
      '<div class="pad">' +
      '<div class="basewrap"><canvas id="hubCv" width="' + GP.base.W + '" height="' + GP.base.H + '"></canvas></div>' +
      '<div class="hubhint" id="hubHint">建物を選ぶと、その設備の画面が開きます</div>' +
      '</div></div>';
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

  return { renderAll, hubCard, partIcon, renderTop, renderSide, log, toast, pop, modal, closeModal,
           money, esc, driverCard, drawMini, partRow, skillChips, stars, partTraitChips, face, standings, finance, $ };
})();

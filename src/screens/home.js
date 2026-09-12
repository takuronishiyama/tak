/* =========================================================
   画面：本拠地（設備・備品・ガレージ・グリッド・オフ・カート）
   main.js から切り出したもの。中身はそのまま動かしていない。
   ほかの画面と共有しているものは、文脈（A）から link() で受け取る。
   ========================================================= */
window.GP = window.GP || {};
GP.screens = GP.screens || {};

GP.screens.home = function (A) {
  'use strict';
  const D = GP.data, S = GP.state, U = GP.ui, R = GP.race, RV = GP.raceview;
  let g = null;
  /* ほかの画面と main.js から借りているもの。link() で埋まる */
  let $, bindPick, capSpend, cmdImprove, cmdInfo, cmdMaintain, cmdRace, cmdResearch, cmdSponsor, cmdStaff, cmdTrain, doDebrief, doPoach, doScout, endWeek, esc, grantFame, isRaceWeek, money, nextSeason, perkChip, render, rigBoxHTML, scoutCardHTML, staffExp, startRace;
  function link() {
    $ = A.$;
    bindPick = A.bindPick;
    capSpend = A.capSpend;
    cmdImprove = A.cmdImprove;
    cmdInfo = A.cmdInfo;
    cmdMaintain = A.cmdMaintain;
    cmdRace = A.cmdRace;
    cmdResearch = A.cmdResearch;
    cmdSponsor = A.cmdSponsor;
    cmdStaff = A.cmdStaff;
    cmdTrain = A.cmdTrain;
    doDebrief = A.doDebrief;
    doPoach = A.doPoach;
    doScout = A.doScout;
    endWeek = A.endWeek;
    esc = A.esc;
    grantFame = A.grantFame;
    isRaceWeek = A.isRaceWeek;
    money = A.money;
    nextSeason = A.nextSeason;
    perkChip = A.perkChip;
    render = A.render;
    rigBoxHTML = A.rigBoxHTML;
    scoutCardHTML = A.scoutCardHTML;
    staffExp = A.staffExp;
    startRace = A.startRace;
  }


  /* =======================================================
     フリーメニュー：マシン（装着・合成・保管）
     ======================================================= */
  const fuseCost = m => Math.round(400 + m.power * 22);

  /* マシンに積んでいるもの。
     整備の画面の中にも同じものを貼るので、
     組み立てと配線を分けてある。
     戻り先が画面によって違うので、配線のほうは受け取る    */
  function cmdGarage() {
    // 積んでいるものの管理は、整備の2枚目に置いてある
    A.cmdMaintain('kit');
  }

  function garageHTML() {
    let body = '<div class="sub">装着中のパーツ</div>' +
      '<p class="desc">🏭工房で作ったパーツは、ここで<b>交換</b>を押すと積み替えられます。' +
      '降ろしたものは下の保管庫に入ります。' + U.helpLink('car') + '</p><div class="parts">';
    D.PART_CATS.forEach(c => {
      const p = g.equipped[c.key];
      const spare = g.inventory.filter(x => x.cat === c.key).length;
      const btn = '<span class="p-act"><button class="mini" data-swap="' + c.key + '"' +
        (spare ? '' : ' disabled') + '>交換' + (spare ? '(' + spare + ')' : '') + '</button></span>';
      body += p ? U.partRow(g, p, { trailing: btn })
        : '<div class="part empty"><span class="p-ic">' + c.icon + '</span>' +
          '<span class="p-nm">' + c.name + '<small>未装着</small></span>' + btn + '</div>';
    });
    body += '</div>';

    body += '<div class="sub">保管パーツ（' + g.inventory.length + ' / 24）</div>';
    if (!g.inventory.length) {
      body += '<p class="desc">保管パーツはありません。' +
        '「🏭 工房」→「作る」で作ると、ここに入ります。</p>';
    } else {
      body += '<p class="desc">合成すると素材の性能の一部を引き継ぎ、レアリティが上がることがあります（素材は消滅）。</p><div class="parts">';
      g.inventory.forEach(p => {
        const act = '<span class="p-act">' +
          '<button class="mini" data-eq="' + p.id + '">装着</button>' +
          '<button class="mini" data-fuse="' + p.id + '">合成</button>' +
          '<button class="mini danger" data-del="' + p.id + '">破棄</button></span>';
        body += U.partRow(g, p, { trailing: act });
      });
      body += '</div>';
    }

    // ---- パワーユニット（基数と載せ替え）----
    body += '<div class="sub">パワーユニット</div>' +
      '<p class="desc">走るほど残りが減り、へたると出力も信頼性も落ちます。' +
      '新品は基数を1つ使い、上限（' + S.puLimit(g) + '基）を超えると次のレースがグリッド降格になります。<br>' +
      '残量のあるうちに降ろしたユニットは保管され、あとでまた積み直せます。<br>' +
      'よそから買うか、こちらから分けるかは「🔌 供給」で決めます。</p>' +
      puBoxHTML(null);

    // ---- シャシーの在庫 ----
    body += A.spareBoxHTML();
    return body;
  }

  /* 画面に貼ったあとの配線。back は、押したあとに開き直す先 */
  function bindGarage(back) {
    const again = back || cmdGarage;
    bindPuBox(again);
    bindAct('data-swap', k => openSwap(k));
    bindAct('data-eq', id => { doEquip(id); again(); });
    bindAct('data-fuse', id => openFuse(id));
    bindAct('data-spare', () => {
      const r2 = S.buySpare(g);
      if (!r2) return;
      GP.sound.play('build');
      U.log(g, '🚛 シャシーをもう1台組んだ（在庫 ' + r2.now + '台／💰' + money(r2.cost) + '万）', 'good');
      U.toast('🚛 シャシーの在庫 ' + r2.now + '台', 'good');
      S.save(g); render(); again();
    });
    bindAct('data-del', id => {
      const p = g.inventory.find(x => x.id === id);
      if (!p) return;
      U.modal('パーツを破棄', '<p class="lead">「' + esc(p.name) + '」を破棄しますか？<br>元には戻せません。</p>', [
        { label: '破棄する', cls: 'danger', fn: () => {
            g.inventory = g.inventory.filter(x => x.id !== id);
            U.log(g, '🗑️ ' + p.name + ' を破棄した。');
            S.save(g); render(); again();
          } },
        { label: 'やめる', fn: again }
      ]);
    });
  }

  function bindAct(attr, fn) {
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[' + attr + ']'), b => {
      b.onclick = () => fn(b.getAttribute(attr));
    });
  }

  function puBoxHTML(t) {
    const pu = S.puOf(g);
    const wear = t ? S.puWear(g, t, 1) : 0;
    const left = Math.max(0, S.puLimit(g) - pu.used);
    const willSwap = !!t && pu.life - wear <= 0;
    const cost = S.puFreshCost(g);
    // へたり具合は出力モードとは切り離して見せる（新品を「へたっている」と言わないため）
    const tired = S.puTired(g);
    const drop = Math.round(D.PU_TIRED * tired * 100);
    // 残量そのものがPUパーツのコンディションなので、
    // 信頼性はほかのパーツと同じ平均のなかで下がる
    const relDrop = Math.round((100 - pu.life) / D.PART_CATS.length);
    const perfDrop = D.PU_PERF_DROP * tired;

    let h = '<div class="pubox' + (pu.grid ? ' pen' : willSwap && left <= 0 ? ' warn' : '') + '">' +
      '<b>⚙️ パワーユニット ' + pu.n + '基目／今季 ' + pu.used + '基（あと ' + left + '基）</b>' +
      '<small class="punote">この残量が、そのままマシン画面のパワーユニットの' +
      'コンディションです。整備で少し戻せますが、元に戻せるのは新品だけです。</small>' +
      '<span class="skbar big"><i class="' + (pu.life < 25 ? 'f2' : pu.life < 50 ? 'f1' : 'f0') +
        '" style="width:' + Math.round(pu.life) + '%"></i></span>' +
      '<em>残り ' + Math.round(pu.life) + '%</em>' +
      '<small>' +
      (tired > 0.02
        ? '<b class="warn">へたってきています。グリッド ' + perfDrop.toFixed(1) +
          '台ぶん遅く、出力 -' + drop + '%／信頼性 -' + relDrop + '。</b> '
        : 'まだ本来の出力が出ています。 ') +
      (t ? 'このコースを走ると、およそ ' + Math.round(wear) + '% 減ります。' : '') +
      (willSwap ? (left > 0 ? 'このレース中に自動で載せ替えになります。'
                            : '<b class="warn">上限を超えるため、その次の戦は ' + D.PU_PENALTY + 'グリッド降格になります。</b>')
                : '') +
      (pu.grid ? '<br><b class="warn">次のレースは基数超過により ' + pu.grid + 'グリッド降格でスタートします。</b>' : '') +
      '</small>';

    // ---- 出力モード ----
    // どこまで回すか。速さと寿命の交換レート。ここが毎週の判断になる
    const mode = S.puMode(g);
    h += '<div class="pumode"><b>出力モード</b>';
    // いまのコース（マシン画面なら平均的なコース）で1戦あたり何%減るか。
    // モードごとの見込みは、いま選んでいるモードの消耗から比例で出す
    const refT = t || S.trackAt(g, g.nextRace);
    const wearOne = S.puWear(g, refT, 1) / Math.max(0.01, mode.wear);
    D.PU_MODES.forEach(m => {
      const per = wearOne * m.wear;
      const races = Math.max(0, Math.floor(pu.life / Math.max(0.1, per)));
      h += '<button class="pumbtn' + (m.key === mode.key ? ' on' : '') + '" data-pumode="' + m.key + '"' +
        ' title="' + esc(m.note) + '">' +
        '<i>' + m.icon + ' ' + m.name + '</i>' +
        '<small>速さ ' + (m.perf === 0 ? '±0' :
          (m.perf > 0 ? '+' : '−') + Math.abs(m.perf).toFixed(1) + '台') +
        '／1戦 -' + Math.round(per) + '%<br>いまのユニットであと約' + races + '戦</small></button>';
    });
    h += '</div><small class="pumnote">' + esc(mode.note) +
      '<br>「◯台」はグリッドでおよそ何台ぶん速い／遅いか。' +
      'へたったユニットは、これとは別に最大 ' + D.PU_PERF_DROP.toFixed(1) + '台ぶん遅くなります。</small>';

    // ---- 降格を取るなら、どのコースか ----
    if (t) {
      const ease = S.overtakeEase(t);
      h += '<small class="pupool">🏁 ' + esc(t.name) + ' は、' +
        (ease > 0.62 ? '<b>追い抜きやすい</b>コースです。降格を取るならここは向いています。'
         : ease < 0.38 ? '<b>追い抜きにくい</b>コースです。降格を取るのは避けたいところ。'
         : '追い抜きは並のコースです。') + '</small>';
    }

    // ---- 載せ替えの選択肢 ----
    h += '<div class="puswap"><b>載せ替える</b>';
    const overNext = pu.used + 1 > S.puLimit(g);
    h += '<button class="puopt' + (overNext ? ' pen' : '') + '" data-pufresh="1"' +
      (g.funds < cost ? ' disabled' : '') + '>' +
      '<i>🆕 新品を投入</i><small>' + money(cost) + '万／残り100%' +
      (overNext ? '<br><b class="warn">+' + D.PU_PENALTY + 'グリッド降格</b>' : '<br>今季の基数を1つ使う') +
      '</small></button>';
    pu.pool.forEach((u, i) => {
      h += '<button class="puopt" data-pumount="' + i + '"' +
        (g.funds < D.PU_SWAP_COST ? ' disabled' : '') + '>' +
        '<i>📦 ' + u.n + '基目に戻す</i><small>' + money(D.PU_SWAP_COST) + '万／残り ' +
        Math.round(u.life) + '%<br>基数は増えない</small></button>';
    });
    h += '</div>';
    if (!pu.pool.length) {
      h += '<small class="pupool">まだ取ってあるユニットはありません。' +
           '残量のあるうちに新品へ替えれば、降ろしたユニットは保管されます。</small>';
    }
    h += '</div>';
    return h;
  }

  /* ボックスの中のボタンを繋ぐ。after は画面を作り直す関数 */
  function bindPuBox(after) {
    bindAct('data-pumode', k => {
      S.setPuMode(g, k);
      S.save(g); render(); if (after) after();
    });
    bindAct('data-pufresh', () => {
      const cost = S.puFreshCost(g);
      if (g.funds < cost) return U.toast('資金が足りません', 'bad');
      g.funds -= cost;                 // PUは供給元から買うもので、上限の対象外
      const r = S.fitFreshPU(g);
      U.log(g, '⚙️ ' + r.used + '基目の新品パワーユニットを投入した（' + money(cost) + '万）。' +
        (r.over ? '基数の上限を超えたため、次のレースは ' + r.grid + 'グリッド降格。' : ''),
        r.over ? 'warn' : 'good');
      U.toast(r.over ? '⚙️ 新品PU投入（' + r.grid + 'グリッド降格）' : '⚙️ 新品PUを投入', r.over ? 'warn' : 'good');
      GP.sound.play('buy');
      S.save(g); render(); if (after) after();
    });
    bindAct('data-pumount', i => {
      if (g.funds < D.PU_SWAP_COST) return U.toast('資金が足りません', 'bad');
      const m = S.mountPU(g, +i);
      if (!m) return;
      g.funds -= D.PU_SWAP_COST; capSpend(D.PU_SWAP_COST);   // 工賃は現場の費用
      U.log(g, '⚙️ ' + m.from + '基目を降ろし、取ってあった ' + m.to + '基目（残り ' + m.life +
        '%）に載せ替えた（工賃 ' + money(D.PU_SWAP_COST) + '万）。');
      U.toast('⚙️ ' + m.to + '基目に載せ替えた');
      GP.sound.play('buy');
      S.save(g); render(); if (after) after();
    });
  }

  function openSwap(catKey) {
    const c = D.PART_CATS.find(x => x.key === catKey);
    const list = g.inventory.filter(p => p.cat === catKey);
    let body = '<p class="lead">' + c.name + ' に装着するパーツを選んでください。</p>';
    const cur = g.equipped[catKey];
    if (cur) body += '<div class="sub">装着中</div><div class="parts">' + U.partRow(g, cur) + '</div>';
    body += '<div class="sub">保管パーツ</div><div class="parts">';
    list.forEach(p => {
      body += U.partRow(g, p, { trailing: '<span class="p-act"><button class="mini" data-eq="' + p.id + '">装着</button></span>' });
    });
    body += '</div>';
    U.modal('🔄 パーツ交換', body, [{ label: '戻る', fn: cmdGarage }], { wide: true });
    bindAct('data-eq', id => { doEquip(id); cmdGarage(); });
  }

  function doEquip(id) {
    const p = g.inventory.find(x => x.id === id);
    if (!p) return;
    const old = g.equipped[p.cat];
    g.inventory = g.inventory.filter(x => x.id !== id);
    g.equipped[p.cat] = p;
    if (old) g.inventory.push(old);
    U.log(g, '🔄 ' + p.name + ' を装着した。' + (old ? '（' + old.name + ' を保管）' : ''), 'good');
    U.toast('🔄 ' + p.name + ' を装着！', 'good');
    S.save(g); render();
  }

  function openFuse(materialId) {
    const m = g.inventory.find(x => x.id === materialId);
    if (!m) return;
    const c = D.PART_CATS.find(x => x.key === m.cat);
    const cost = fuseCost(m);
    const cands = [];
    if (g.equipped[m.cat]) cands.push({ p: g.equipped[m.cat], where: '装着中' });
    g.inventory.forEach(p => { if (p.cat === m.cat && p.id !== m.id) cands.push({ p: p, where: '保管' }); });

    /* 素材の出来。パーツは品質（数値）で持っているので、そこから読む。
       ここで m.rarity を見ていたために NaN が出ていた            */
    const mq = S.qualOf(m);
    const gainNow = Math.round(m.power * 0.45 * 10) / 10;
    /* 器が広がる確率。doFuse と同じ式をここでも使う。
       別々に書いていたので、画面の数字が実際と違っていた        */
    const upChance = 0.18 + Math.max(0, mq - 1) * 0.30;
    const short = Math.max(0, cost - g.funds);
    let body = '<p class="lead">素材：<b>' + esc(m.name) + '</b>（' +
      U.stars(S.qualStars(mq)) + ' ' + esc(S.qualTier(mq).name) + ' ' + mq.toFixed(2) +
      '／性能 ' + Math.round(m.power) + '）<br>' +
      'この素材を吸収させる ' + c.name + ' を選んでください。</p>' +
      '<p class="desc">性能を <b>+' + gainNow.toFixed(1) + '</b> 引き継ぎ、' +
      Math.round(upChance * 100) + '% の確率で<b>品質そのものが少し広がります</b>' +
      '（出来の良い素材ほど、拾えるものが多い）。<br>' +
      '費用 💰' + money(cost) + '万（週は消費しません）</p>' +
      (short > 0 ? '<p class="note"><b class="warn">資金が足りません。</b>' +
        'あと <b>💰' + money(short) + '万</b> あれば合成できます。' +
        '営業でスポンサーを取るか、入賞して賞金を持ち帰りましょう。</p>' : '');
    if (!cands.length) {
      body += '<div class="bigbox">同じ種類のパーツがありません</div>';
    } else {
      body += '<div class="parts">';
      cands.forEach(x => {
        body += U.partRow(g, x.p, { trailing: '<span class="p-act"><small>' + x.where + '</small>' +
          '<button class="mini" data-base="' + x.p.id + '"' + (g.funds < cost ? ' disabled' : '') + '>合成</button></span>' });
      });
      body += '</div>';
    }
    U.modal('⚗️ パーツ合成', body, [{ label: '戻る', fn: cmdGarage }], { wide: true });
    bindAct('data-base', id => doFuse(id, materialId));
  }

  function doFuse(baseId, materialId) {
    const m = g.inventory.find(x => x.id === materialId);
    if (!m) return;
    const base = (g.equipped[m.cat] && g.equipped[m.cat].id === baseId)
      ? g.equipped[m.cat] : g.inventory.find(x => x.id === baseId);
    if (!base) return;
    const cost = fuseCost(m);
    if (g.funds < cost) return;
    g.funds -= cost; capSpend(cost);

    const gain = Math.round(m.power * 0.45 * 10) / 10;
    base.power = Math.round((base.power + gain) * 10) / 10;
    /* ---- 合成で器そのものが少し広がることがある ----
       ばらした側の出来が良いほど、拾えるものが多い。
       ただし品質は「作った日に決まる」ものなので、
       ここで広がるのは、あくまで削り出しの手直しぶんに留める      */
    let up = false;
    const mq = S.qualOf(m);
    // 画面に出している確率と同じ式（openFuse の upChance と揃えてある）
    if (Math.random() < 0.18 + Math.max(0, mq - 1) * 0.30) {
      base.quality = Math.min(D.QUAL.max, S.qualOf(base) + S.rnd(0.03, 0.07));
      base.quality = Math.round(base.quality * 1000) / 1000;
      up = true;
    }
    // 素材の追加効果を引き継ぐことがある
    let inherited = null;
    (m.traits || []).forEach(t => {
      if (base.traits.indexOf(t) < 0 && base.traits.length < 2 && Math.random() < 0.45) {
        base.traits.push(t); inherited = t;
      }
    });
    base.cond = S.clamp(base.cond + 6, 10, 100);
    g.inventory = g.inventory.filter(x => x.id !== materialId);

    let msg = '⚗️ ' + base.name + ' に ' + m.name + ' を合成！ 性能 +' + gain.toFixed(1);
    if (up) msg += '  ⭐品質が ' + S.qualOf(base).toFixed(2) +
                   '（' + S.qualTier(S.qualOf(base)).name + '）に上がった！';
    if (inherited) {
      const t = D.PART_TRAITS.find(x => x.key === inherited);
      if (t) msg += '  ' + t.icon + t.name + ' を引き継いだ！';
    }
    U.log(g, msg, up ? 'good' : '');
    GP.sound.play(up ? 'crit' : 'upgrade');
    U.toast(up ? '⭐ 品質 ' + S.qualOf(base).toFixed(2) + ' へ！'
               : '⚗️ 合成成功！ 性能 +' + gain.toFixed(1), up ? 'good' : '');
    U.pop('+' + gain.toFixed(1), up ? 'crit' : 'good');
    S.save(g); render(); cmdGarage();
  }

  /* =======================================================
     フリーメニュー：施設
     ======================================================= */
  let baseSel = 'factory';
  let baseTab = 'fac';   // 広げる／備品／事業

  function facilityCost(key) {
    const f = D.FACILITIES.find(x => x.key === key);
    const lv = g.facilities[key];
    // サプライヤーがついていれば、その設備の導入費が安くなる
    return S.perkPrice(g, 'fac:' + key, Math.round(f.base * Math.pow(lv, 1.55)));
  }

  function cmdFacility() {
    const sc = GP.base.scale(g);
    const body =
      '<div class="baseinfo"><span>チーム規模 <b>' + sc.rank + '</b></span>' +
      '<span>施設を広げるほど、本拠地は大きく賑やかになります</span></div>' +
      '<div class="basewrap"><canvas id="baseCv" width="' + GP.base.W + '" height="' + GP.base.H + '"></canvas></div>' +
      '<div id="baseDetail"></div>';
    U.modal('🏗️ チーム本拠地', body, [{ label: '閉じる', fn: () => { GP.sound.play('tap'); U.closeModal(); } }], { wide: true });
    drawBase();
    const cv = $('baseCv');
    cv.onclick = ev => {
      const r = cv.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (GP.base.W / r.width);
      const y = (ev.clientY - r.top) * (GP.base.H / r.height);
      const k = GP.base.hit(x, y);
      if (k) {
        baseSel = k;
        // 事業や遠征を見ている最中に建物を押したら、その施設の話へ戻す
        if (baseTab === 'est' || baseTab === 'logi') baseTab = 'fac';
        GP.sound.play('tap');
        drawBase();
      }
    };
  }

  /* ---- 備品 ----
     建物を大きくするのが「規模」なら、こちらは「中身」。
     現場に良い道具を入れ、まともに休める場所を作る。
     一度買えば残り、施設のレベルが足りないと置く場所がない。     */
  function gearBoxHTML(fac) {
    const list = S.gearList(g, fac);
    if (!list.length) return '';
    const tier = S.envTier(g), sc = S.envScore(g);
    let h = '<div class="sub small">備品と職場環境</div>' +
      '<div class="envbox"><b>' + tier.icon + ' ' + tier.name + '<em>働きやすさ ' + sc + '</em></b>' +
      '<small>' + esc(tier.desc) + '　—　スタッフの伸び <b>+' +
      Math.round(sc * D.ENVW.growth * 100) + '%</b>／引き抜かれにくさ <b>+' +
      Math.round(Math.min(65, sc * D.ENVW.keep * 100)) + '%</b></small></div>' +
      '<div class="pick gearpick">';
    list.forEach(x => {
      const can = !x.owned && x.open && g.funds >= x.price;
      const off = x.price < x.cost;
      h += '<button class="pickbtn gearrow' + (x.owned ? ' done' : '') + '" data-gear="' + fac + ':' + x.key + '"' +
        (can ? '' : ' disabled') + '>' +
        '<span class="pb-ic">' + x.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(x.name) +
          (x.owned ? '<em class="gowned">導入済み</em>'
                   : !x.open ? '<em class="warn">Lv.' + x.need + ' から</em>' : '') + '</b>' +
        '<small><b>' + esc(x.eff) + '</b>' + (x.env ? '　働きやすさ +' + x.env : '') +
        '　維持 💰' + money(x.up) + '万/週' +
        '<br><em class="pnote">' + esc(x.note) + '</em></small></span>' +
        '<span class="pb-cost">' + (x.owned ? '—'
          : (off ? '<s>' + money(x.cost) + '</s><br>' : '') + '💰' + money(x.price)) +
        '</span></button>';
    });
    const up = S.gearUpkeep(g);
    h += '</div><p class="note">🔧 いま持っている装備の維持費は <b>💰' + money(up.net) +
      '万／週</b>です' + (up.cut > 0
        ? '（サプライヤーの割引 <b>-' + Math.round(up.cut * 100) + '%</b> 込み。定価なら ' +
          money(up.raw) + '万）'
        : '（サプライヤーと組むと下げられます）') + '。買った道具は、置いてあるだけで金を食います。</p>';
    return h;
  }
  /* ---- 事業 ----
     本拠地の外に持つもの。レースで勝つための設備ではなく、
     チームが街に根を張るための場所                                 */
  function estateBoxHTML() {
    const list = S.estateList(g);
    const up = S.estateUpkeep(g);
    let h = '<div class="sub small">事業</div>' +
      '<p class="desc">本拠地の外に持つもの。買えば維持費がかかりますが、' +
      'チームの収入と、人の集まりかたが変わります。' +
      (up ? '　いまの維持費 <b>💰' + money(up) + '万／週</b>' : '') + '</p>' +
      '<div class="pick gearpick">';
    list.forEach(x => {
      const can = !x.owned && g.funds >= x.cost;
      const kart = x.key === 'kart' && x.owned;
      h += '<button class="pickbtn gearrow' + (x.owned ? ' done' : '') + '" data-est="' + x.key + '"' +
        ((can || kart) ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#8a5a2a">' + x.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(x.name) +
          (x.owned ? '<em class="gowned">所有</em>' : '') + '</b>' +
        '<small><b>' + esc(x.eff) + '</b>　維持 💰' + money(x.upkeep) + '万/週' +
        '<br><em class="pnote">' + esc(x.desc) + '</em>' +
        (kart ? '<br><b class="kartgo">🏁 押すと、今週カートレースを開けます（' +
                (g.youth || []).length + '人が出走）</b>' : '') +
        '</small></span>' +
        '<span class="pb-cost">' + (x.owned ? (kart ? '🏁 開く' : '—') : '💰' + money(x.cost)) + '</span></button>';
    });
    return h + '</div>';
  }
  function bindEstate() {
    const box = $('baseDetail');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-est]'), b => {
      b.onclick = () => {
        const key = b.dataset.est;
        if (key === 'kart' && S.hasEstate(g, key)) return askKart();
        const x = S.buyEstate(g, key);
        if (!x) return;
        GP.sound.play('build');
        U.log(g, x.icon + ' ' + x.name + ' を手に入れた（' + x.eff + '）', 'good');
        U.toast(x.icon + ' ' + x.name + '！', 'good');
        S.save(g); render(); drawBase();
      };
    });
  }

  /* =======================================================
     カートレース
     カート場を持っていると開ける、小さな週末。
     若手が実戦を覚え、街の子が見つかることがある。
     ======================================================= */
  function askKart() {
    const K = D.KART;
    // 施設画面からも開けるので、週を使ってよい時かどうかをここで確かめる。
    // レース週にこれを走らせると、決勝の週を潰してしまう
    if (isRaceWeek() || g.offseason) {
      return U.modal('🏁 カートレース',
        '<p class="lead">' + (g.offseason ? 'オフのあいだは開けません。' : '今週は決勝です。') + '</p>' +
        '<p class="desc">カートレースは1週かかります。' +
        (g.offseason ? '来季が始まってから開きましょう。' : 'レースが終わってからにしましょう。') + '</p>',
        [{ label: '戻る', cls: 'primary', fn: U.closeModal }]);
    }
    const ys = (g.youth || []);
    if (!ys.length) {
      return U.modal('🏁 カートレース',
        '<p class="lead">出走できる若手がいません。</p>' +
        '<p class="desc">「人事」の育成から、下部組織に若手を入れてください。</p>',
        [{ label: '戻る', cls: 'primary', fn: U.closeModal }]);
    }
    const ok = g.funds >= K.fee;
    U.modal('🏁 カートレース',
      '<p class="lead">今週、自前のカート場でレースを開きます。' +
      '街の子どもたちが集まってきます。</p>' +
      '<p class="desc">開催費 💰' + money(K.fee) + '万（1週消費）。' +
      '走った子は実戦のぶんだけ伸び、勝てば大きく伸びます。' +
      '街の子のなかに光るものがいたら、声をかけられます。</p>' +
      '<div class="sub small">🎮 自分でハンドルを握る</div>' +
      '<p class="desc">誰かの車に乗って、実際に走らせられます。' +
      '<b>使うのは左右だけ</b>（キーボードなら ← →）。' +
      'ラジコンと同じで、前に進むのは勝手にやります。<br>' +
      'アクセルとブレーキは、<b>いま走っている線で曲がりきれる速さ</b>に自動で当たります。' +
      'だから<b>どこを走るかが、そのままタイムになります</b>。' +
      '内へ詰めれば小回りになって遅く、外へふくらませれば大きな弧になって速い。<br>' +
      'コーナーの<b>外から入って、ふくらませて抜ける</b>のが速い、ということです。' +
      'ただしコースの外へ出ると急に遅くなります。<br>' +
      'その子のカート適性は、<b>タイヤの許容</b>として効きます（うまい子ほど、同じ線でも速く抜けられる）。</p>' +
      '<div class="pick">' + ys.slice(0, 4).map(d =>
        '<button class="pickbtn" data-k="kdrive:' + d.id + '"' + (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#3f8a4a">🏎️</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '（' + d.age + '歳）で走る</b>' +
        '<small>カート適性 <b>' + Math.round(S.kartRating(d)) + '</b>' +
        '　速さ ' + Math.round(d.speed) + '／技術 ' + Math.round(d.technique) +
        '／精神 ' + Math.round(d.mental) +
        '<br>タイヤの許容 <b>×' + kartSkillOf(d).toFixed(2) + '</b></small></span>' +
        '<span class="pb-cost">🎮<br>運転</span></button>').join('') + '</div>',
      [{ label: '👀 見ているだけにする', cls: 'primary', disabled: !ok, fn: doKart },
       { label: 'やめる', fn: U.closeModal }]);
    bindPick(k => { if (k.indexOf('kdrive:') === 0) startKartGame(k.slice(7)); });
  }
  /* =======================================================
     カートを、実際に運転する
     コースの上を自分で走らせる。曲がりどころでは速度の二乗ぶんだけ
     外へ押し出されるので、手前で緩めて、内側から立ち上がる。
     操作は左右とアクセルとブレーキだけ。
     乗せる子の腕は「タイヤの許容」として効く。
     ======================================================= */
  let kartRun = null;

  function kartSkillOf(d) {
    return 0.82 + Math.min(1, S.kartRating(d) / 160) * 0.34;
  }

  /* 出走表を作る。自分が乗る子、残りの若手、そして街の子たち */
  function kartField(driveId) {
    const K = D.KART;
    const ys = (g.youth || []).slice(0, 4);
    const field = [];
    ys.forEach((d, i) => {
      field.push({ name: d.name, youth: d, mine: true, you: d.id === driveId,
                   color: d.id === driveId ? '#ffd54a' : g.color,
                   skill: kartSkillOf(d) });
    });
    const base = field.length
      ? field.reduce((a, e) => a + e.skill, 0) / field.length : 0.95;
    const COL = ['#4a8fd0', '#d06a4a', '#6ac06a', '#b06fd0', '#d0a84a', '#5fbfc0'];
    const n = Math.max(4, K.field - field.length);
    for (let i = 0; i < n; i++) {
      const star = Math.random() < 0.18;
      field.push({
        name: S.kartName ? S.kartName() : 'こども' + (i + 1),
        mine: false, you: false, star: star, color: COL[i % COL.length],
        skill: S.clamp(base * S.rnd(0.88, 1.06) * (star ? S.rnd(1.06, 1.13) : 1), 0.72, 1.20)
      });
    }
    // スタート順は混ぜる（自分だけ有利にはしない）
    for (let i = field.length - 1; i > 0; i--) {
      const j = S.rint(0, i);
      const t = field[i]; field[i] = field[j]; field[j] = t;
    }
    return field;
  }

  function startKartGame(driveId) {
    const K = D.KART;
    if (g.funds < K.fee) return;
    g.funds -= K.fee;
    U.closeModal();
    const d = (g.youth || []).filter(x => x.id === driveId)[0];
    const field = kartField(driveId);
    const stt = GP.kart.start({ field: field, laps: GP.kart.LAPS });
    const cv = $('kartCanvas');
    $('kvName').textContent = d ? d.name + '（' + d.age + '歳）' : 'カートレース';
    $('kvLap').textContent = 'LAP 1 / ' + GP.kart.LAPS;
    $('kvPos').textContent = 'P-';
    $('kvSpd').textContent = '0';
    $('kartScreen').className = 'show';
    kartRun = { raf: 0, last: performance.now(), keys: {}, quit: false, driveId: driveId };
    bindKartPad();
    const loop = (now) => {
      if (!kartRun) return;
      const dt = Math.min(0.05, (now - kartRun.last) / 1000);
      kartRun.last = now;
      const s2 = GP.kart.tick(dt);
      GP.kart.draw(cv, { dusk: document.body.getAttribute('data-skin') === 'hd2d' });
      const you = s2.karts.filter(k => k.you)[0];
      $('kvCount').textContent = s2.count > 0
        ? (s2.count > 3 ? 'READY' : Math.ceil(s2.count)) : '';
      if (you) {
        $('kvLap').textContent = 'LAP ' + Math.min(GP.kart.LAPS, you.lap + 1) + ' / ' + GP.kart.LAPS;
        $('kvPos').textContent = 'P' + (you.pos || '-');
        $('kvSpd').textContent = Math.round(you.v * 0.42) + ' km/h' +
          (Math.abs(you.off) > 26 ? '　⚠️コース外' : you.slip > 0 ? '　💨スリップ' : '');
      }
      if (s2.over || kartRun.quit) { endKartGame(); return; }
      kartRun.raf = requestAnimationFrame(loop);
    };
    kartRun.raf = requestAnimationFrame(loop);
  }

  function bindKartPad() {
    const set = (k, v) => { if (GP.kart.state) GP.kart.state.inp[k] = v; };
    const hold = (id, on, off) => {
      const el = $(id);
      if (!el) return;
      const down = e => { e.preventDefault(); el.classList.add('on'); on(); };
      const up = e => { if (e) e.preventDefault(); el.classList.remove('on'); off(); };
      el.onpointerdown = down;
      el.onpointerup = up;
      el.onpointerleave = up;
      el.onpointercancel = up;
    };
    hold('kvL', () => set('steer', 1), () => { if (GP.kart.state && GP.kart.state.inp.steer > 0) set('steer', 0); });
    hold('kvR', () => set('steer', -1), () => { if (GP.kart.state && GP.kart.state.inp.steer < 0) set('steer', 0); });
    /* アクセルとブレーキのボタンは無くした。
       前に進むのは自動で、人が決めるのは向きだけ            */
    $('kvQuit').onclick = () => { if (kartRun) kartRun.quit = true; };
    const key = (e, down) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a') set('steer', down ? 1 : 0);
      else if (k === 'ArrowRight' || k === 'd') set('steer', down ? -1 : 0);
      else if (k === 'ArrowUp' || k === 'z' || k === ' ') set('throttle', down ? 1 : 0);
      else if (k === 'ArrowDown' || k === 'x') set('brake', down ? 1 : 0);
      else return;
      e.preventDefault();
    };
    kartRun.onKD = e => key(e, true);
    kartRun.onKU = e => key(e, false);
    window.addEventListener('keydown', kartRun.onKD);
    window.addEventListener('keyup', kartRun.onKU);
  }

  function endKartGame() {
    if (!kartRun) return;
    cancelAnimationFrame(kartRun.raf);
    window.removeEventListener('keydown', kartRun.onKD);
    window.removeEventListener('keyup', kartRun.onKU);
    const order = GP.kart.finish();
    kartRun = null;
    $('kartScreen').className = '';
    // 既存の実り（賞金・ファン・若手の伸び・スカウト）にそのまま渡す
    const res = { field: order.map(k => ({
      name: k.name, mine: k.mine, youth: k.youth, star: k.star,
      pos: k.pos, spun: k.spun > 2.5, unfin: !k.done,
      time: k.finish != null ? k.finish : (order[0].finish || 0) + 30
    })), log: [] };
    showKartResult(res, true);
  }

  function doKart() {
    const K = D.KART;
    if (g.funds < K.fee) return;
    g.funds -= K.fee;
    const res = S.runKart(g);
    U.closeModal();
    showKartResult(res, false);
  }

  function showKartResult(res, played) {
    const K = D.KART;
    const rw = S.kartReward(g, res);
    let body = '<div class="racehead"><b>🏁 カートレース</b><span>' +
      (played ? GP.kart.LAPS : K.laps) + '周</span></div>' +
      '<div class="gridlist">' + res.field.map(e =>
        '<div class="gridrow' + (e.mine ? ' me' : '') + '">' +
        '<span class="gp-pos' + (e.pos === 1 ? ' gold' : e.pos === 2 ? ' silver' : e.pos === 3 ? ' bronze' : '') + '">' +
        e.pos + '</span>' +
        '<span class="gp-nm">' + esc(e.name) + (e.mine ? ' <b>（うち）</b>' : e.star ? ' ✨' : '') + '</span>' +
        '<span class="gp-t">' + (e.unfin ? '＋1周' :
          e.pos === 1 ? '—' : '+' + (e.time - res.field[0].time).toFixed(1) + 's') +
        (e.spun ? ' 🌀' : '') + '</span></div>').join('') + '</div>' +
      (res.log.length
        ? '<div class="rv-loglist kartlog">' + res.log.map(t =>
            '<div class="rv-ev">' + esc(t) + '</div>').join('') + '</div>'
        : '') +
      '<div class="rewardbox">' +
        '<div>💰 賞金 <b>+' + money(rw.prize) + '</b><small>出走したぶんだけ</small></div>' +
        '<div>🔥 ファン <b>+' + rw.fans + '</b><small>近所の子とその家族</small></div>' +
        '<div>📈 伸びた若手 <b>' + rw.grown.length + '人</b><small>' +
          (rw.grown.map(x => x.name + ' ' + x.pos + '位').join('／') || '—') + '</small></div>' +
      '</div>';
    if (rw.found) {
      body += '<p class="note big">✨ ' + esc(rw.found.name) + '（' + rw.found.age +
        '歳）が、うちのカートで走りたいと言ってきました。下部組織に入りました。</p>';
      g.youth = (g.youth || []).concat([rw.found]);
    }
    U.modal('🏁 カートレース 結果', body,
      [{ label: '戻る', cls: 'primary', fn: () => { U.closeModal(); endWeek(); } }], { wide: true });
    GP.sound.play(res.field[0] && res.field[0].mine ? 'levelup' : 'confirm');
    U.log(g, '🏁 カート場でレースを開いた。' +
      (res.field[0] && res.field[0].mine ? res.field[0].name + ' が優勝！' : '') +
      ' 賞金 +' + rw.prize + '万／ファン +' + rw.fans, 'good');
    S.save(g);
  }

  function bindGear() {
    const box = $('baseDetail');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-gear]'), b => {
      b.onclick = () => {
        const [fac, key] = b.dataset.gear.split(':');
        const x = S.buyGear(g, fac, key);
        if (!x) return;
        GP.sound.play('build');
        U.log(g, x.icon + ' ' + x.name + ' を導入した（' + x.eff + '）', 'good');
        U.toast(x.icon + ' ' + x.name + ' を導入！', 'good');
        if (x.env) U.pop('働きやすさ +' + x.env, 'good');
        S.save(g); render(); drawBase();
      };
    });
  }

  /* 施設を選ぶ並び。以前は1,700pxの最下段にあったので、
     「選ぶ → 見る」の順になるよう、いちばん上へ持ってきた */
  function facPickHTML() {
    let h = '<div class="pick basepick">';
    D.FACILITIES.forEach(x => {
      const l2 = g.facilities[x.key], c2 = facilityCost(x.key);
      const gn = (D.GEAR[x.key] || []).filter(y => S.hasGear(g, x.key, y.key)).length;
      const gt = (D.GEAR[x.key] || []).length;
      h += '<button class="pickbtn small' + (x.key === baseSel ? ' on' : '') + '" data-fac="' + x.key + '">' +
        x.icon + ' ' + x.name + ' <b>Lv.' + l2 + '</b>' +
        (gt ? ' <i class="gearn' + (gn === gt ? ' full' : '') + '">備品 ' + gn + '/' + gt + '</i>' : '') +
        (l2 >= 10 ? ' <em>MAX</em>' : ' <em>💰' + money(c2) + '</em>') + '</button>';
    });
    return h + '</div>';
  }

  function drawBase() {
    const cv = $('baseCv');
    if (!cv) return;
    GP.base.render(cv, g, baseSel);
    const f = D.FACILITIES.find(x => x.key === baseSel);
    const lv = g.facilities[baseSel];
    const cost = facilityCost(baseSel);
    const facCut = S.perkCut(g, 'fac:' + baseSel);
    const max = lv >= 10;
    const owned = S.estateList(g).filter(x => x.owned).length;
    const gearAll = D.FACILITIES.reduce((a, x) => a + (D.GEAR[x.key] || []).length, 0);
    const gearGot = D.FACILITIES.reduce((a, x) =>
      a + (D.GEAR[x.key] || []).filter(y => S.hasGear(g, x.key, y.key)).length, 0);
    /* ---- 種類ごとに分ける ----
       広げる（レベル）／備品（施設に据える道具）／事業（外に持つ店）は
       別のもの。ひと続きに積むと、どれを見ているのか分からなくなる  */
    /* 遠征も本拠地の仕事なので、ここに並べる。
       選んでいる手配が一目で分かるように、札に出しておく       */
    const lp = S.logiPlan(g);
    const TABS = [
      ['fac',  '🏗️', '広げる', 'Lv.' + lv],
      ['gear', '🧰', '備品',   gearGot + '/' + gearAll],
      ['logi', '🚚', '遠征',   lp.icon],
      ['est',  '💼', '事業',   owned ? owned + '件' : '']
    ];
    let h = '<div class="tabs qtabs bastabs">' + TABS.map(t =>
      '<button class="tab' + (baseTab === t[0] ? ' on' : '') + '" data-btab="' + t[0] + '">' +
      t[1] + ' ' + t[2] + (t[3] ? '<em>' + t[3] + '</em>' : '') + '</button>').join('') + '</div>';

    if (baseTab === 'est') {
      h += estateBoxHTML();
    } else if (baseTab === 'logi') {
      h += logiBoxHTML();
    } else {
      h += facPickHTML() +
        '<div class="sub">' + f.icon + ' ' + f.name + '</div>';
      if (baseTab === 'gear') {
        h += gearBoxHTML(baseSel) ||
             '<p class="desc">この施設に据えられる備品はありません。</p>';
      } else {
        h += '<p class="desc">' + f.desc + '</p>' +
          rigBoxHTML(baseSel) +
          '<div class="lvbar"><span>Lv.' + lv + '</span><i>';
        for (let i = 1; i <= 10; i++) h += '<b class="' + (i <= lv ? 'on' : '') + '"></b>';
        h += '</i><span>' + (max ? 'MAX' : 'Lv.' + (lv + 1) + ' へ') + '</span></div>' +
          '<div class="basebtns">' +
          '<button class="btn primary" id="baseUp"' + ((max || g.funds < cost) ? ' disabled' : '') + '>' +
          (max ? '最大まで拡張済み'
               : '🔨 拡張する　' + (facCut > 0
                   ? '<s>💰' + money(Math.round(cost / (1 - facCut))) + '</s> 💰' + money(cost) + '万'
                   : '💰' + money(cost) + '万')) + '</button></div>' +
          (facCut > 0 ? '<p class="note">🏭 サプライヤーの現物支援で、この設備の導入費が <b>-' +
            Math.round(facCut * 100) + '%</b> になっています。</p>' : '');
      }
    }
    $('baseDetail').innerHTML = h;
    /* 事業は本拠地の外に持つもの。敷地の絵は関係がないので引っ込める。
       狭い横画面では、絵が出ているだけで一覧が2件しか見えなくなる  */
    /* モーダルの中のものを掴む。ホームの本拠地カードにも
       同じ .basewrap があるので、範囲を絞らないとそちらを消してしまう */
    const bw = document.querySelector('#modalBody .basewrap');
    const bi = document.querySelector('#modalBody .baseinfo');
    const wide = baseTab === 'est' || baseTab === 'logi';
    if (bw) bw.style.display = wide ? 'none' : '';
    if (bi) bi.style.display = wide ? 'none' : '';
    Array.prototype.forEach.call($('baseDetail').querySelectorAll('[data-btab]'), b => {
      b.onclick = () => { baseTab = b.dataset.btab; GP.sound.play('tap'); drawBase(); };
    });
    bindGear();
    bindEstate();
    if (baseTab === 'logi') bindLogi();

    const up = $('baseUp');
    if (up) up.onclick = () => {
      const c = facilityCost(baseSel);
      if (g.funds < c || g.facilities[baseSel] >= 10) return;
      // 設備投資は上限の対象外（建物や設備は開発費とは別枠で扱われる）
      g.funds -= c; g.facilities[baseSel]++;
      const fa = D.FACILITIES.find(x => x.key === baseSel);
      GP.sound.play('build');
      U.log(g, '🏗️ ' + fa.name + ' を Lv.' + g.facilities[baseSel] + ' に拡張した！', 'good');
      grantFame(D.fameOf('facility'), '施設を広げた');
      U.toast('🏗️ ' + fa.name + ' Lv.' + g.facilities[baseSel] + '！', 'good');
      S.save(g); render(); drawBase();
      const sc2 = GP.base.scale(g);
      if (sc2.rank !== GP.base.scale({ facilities: Object.assign({}, g.facilities, { [baseSel]: g.facilities[baseSel] - 1 }), fans: g.fans, titles: g.titles }).rank) {
        GP.sound.play('levelup');
        U.toast('🎊 チーム規模が「' + sc2.rank + '」になった！', 'good');
        U.log(g, '🎊 チーム規模が「' + sc2.rank + '」に成長した！', 'good');
      }
    };
    Array.prototype.forEach.call($('baseDetail').querySelectorAll('[data-fac]'), b => {
      b.onclick = () => { baseSel = b.dataset.fac; GP.sound.play('tap'); drawBase(); };
    });
  }

  /* パドックで立ち寄れる場所。レースウィークだけこちらを使う */
  /* =======================================================
     グリッドウォーク
     決勝前、コースに並んだマシンのあいだを歩く。
     ドライバーを送り出し、他所のマシンを間近で見て、関係者と話す。
     ここでやれることは、レースウィークごとに一度ずつ。
     ======================================================= */
  const GRID_GUESTS = [
    { key: 'tyre', icon: '🛞', who: 'タイヤ供給の技術者',
      line: g2 => {
        const t = S.trackAt(g2, g2.nextRace);
        return t.tyre >= 1.2
          ? '「今日は路面が厳しい。想定より1周ぶんは早くタレると思ってください」'
          : t.tyre <= 0.95
            ? '「路面はやさしいです。1ストップで引っぱる手もありますよ」'
            : '「標準的です。教科書どおりで問題ありません」';
      },
      run: () => { const d = S.pick(g.drivers); if (d) d.technique = S.clamp(d.technique + S.rnd(0.8, 2.0), 1, 199);
        return 'タイヤの使い方を教わった（ドライバーの技術が少し上がった）'; } },
    { key: 'fia', icon: '⚖️', who: 'FIAの技術委員',
      line: () => '「今日は特にトラックリミットを厳しく見ます。無理な飛び込みは加算対象です」',
      run: () => { g.gridClean = true;
        return '審査の基準を聞いておいた（今日は裁定を受けにくい）'; } },
    { key: 'boss', icon: '🎩', who: 'ライバルのチーム代表',
      line: g2 => {
        const r = (g2.rivals || [])[S.rint(0, Math.max(0, (g2.rivals || []).length - 1))];
        return r ? '「' + esc(r.name) + 'です。おたくのクルマ、去年とは別物ですね」' : '「いい週末を」';
      },
      run: () => { S.addHype(g, 2.0); return 'よそのチーム代表と言葉を交わした（注目度 +2.0）'; } },
    { key: 'eng', icon: '👷', who: 'よそのエンジニア',
      line: () => '「そこのフロア、うちも去年やりました。あれは苦労しましたよ」',
      run: () => { g.designEdge = (g.designEdge || 0) + 1;
        return '設計のヒントを持ち帰った（次に設計するパーツが良いものになりやすい）'; } }
  ];

  function gridGuest() {
    const i = (g.season * 7 + g.nextRace * 3) % GRID_GUESTS.length;
    return GRID_GUESTS[i];
  }

  /* グリッドに並ぶ顔ぶれを作る */
  function gridPeople() {
    const done = k => (g.talked || []).indexOf('grid:' + k) >= 0;
    const lineup = A.prePack
      ? A.prePack.entries.filter(e => e.isPlayer).map(e => e.driver)
      : (g.drivers || []);
    const gu = gridGuest();
    const list = [];
    lineup.slice(0, 2).forEach((d, i) => {
      list.push({ key: 'gd:mine' + i, kind: 'car', label: d.name,
                  color: g.color, gen: g.carGen, done: done('cheer' + i) });
    });
    while (list.length < 2) list.push({ key: 'gd:mine' + list.length, kind: 'car',
                                        label: '', color: g.color, gen: g.carGen, done: true });
    list.push({ key: 'gd:look', kind: 'look', label: '並んだマシンを見る',
                color: '#5a6270', done: done('look') });
    list.push({ key: 'gd:guest', kind: 'person', label: gu.who,
                color: '#8a5a2a', done: done('guest') });
    list.push({ key: 'gd:go', kind: 'gate', label: 'スタート進行', done: false });
    return list;
  }

  function gridDoors() {
    const m = {};
    const ppl = gridPeople();
    ppl.forEach(q => {
      const dn = q.done;
      if (q.key.indexOf('gd:mine') === 0) {
        const i = +q.key.slice(7);
        m[q.key] = { icon: '🔥', label: q.label || 'マシン', done: dn,
                     to: dn ? '送り出した' : '鼓舞する',
                     fn: () => dn ? yardAgain(q.label || 'ドライバー') : doCheer(i) };
      } else if (q.key === 'gd:look') {
        m[q.key] = { icon: '🔍', label: '並んだマシン', done: dn, to: dn ? '見て回った' : '見る',
                     fn: () => dn ? yardAgain('マシン') : doGridLook() };
      } else if (q.key === 'gd:guest') {
        m[q.key] = { icon: '🗣️', label: q.label, done: dn, to: dn ? '話した' : '話す',
                     fn: () => dn ? yardAgain(q.label) : doGridGuest() };
      } else if (q.key === 'gd:go') {
        m[q.key] = { icon: '🚦', label: 'スタート進行', to: '決勝へ', fn: () => leaveGrid(true) };
      }
    });
    return m;
  }

  /* グリッドへ降りる。ここからは歩いて回る */
  function cmdGrid() {
    weekFlags();
    U.closeModal();
    g.onGrid = true;
    // 並び（予選順）を絵のために持っておく。
    // 後ろのほうに沈んだ週でも自分のマシンが見えるよう、全車ぶん残す
    g.gridOrder = (A.prePack ? A.prePack.grid : []).map(e => ({
      color: e.color, gen: e.gen || 0, mine: !!e.isPlayer, name: e.driver.name
    }));
    GP.grid.setPeople(gridPeople());
    GP.grid.invalidate();
    hubSel = null;
    render();
    U.toast('🏁 グリッドに降りました。マシンやスタッフを押して回れます', 'good');
  }

  function refreshGrid() {
    GP.grid.setPeople(gridPeople());
    GP.grid.invalidate();
    render();
  }

  function leaveGrid(start) {
    g.onGrid = false;
    g.gridOrder = null;
    render();
    if (start) startRace();
  }




  function doCheer(i) {
    weekFlags();
    const t = S.trackAt(g, g.nextRace);
    const lineup = A.prePack
      ? A.prePack.entries.filter(e => e.isPlayer).map(e => e.driver)
      : S.allTeams(g, t).find(x => x.isPlayer).drivers;
    const d = lineup[i];
    if (!d || (g.talked || []).indexOf('grid:cheer' + i) >= 0) return;
    g.talked.push('grid:cheer' + i);
    const p = S.persOf(d);
    const up = S.rnd(5, 11) * p.up * (1 + S.osk(g, 'fame') * 0.06);
    d.form = S.clamp(d.form + up, 62, 122);
    // 予選はもう終わっているので、今日の決勝には直接乗せる
    if (A.prePack) {
      A.prePack.entries.filter(e => e.isPlayer && e.driver.id === d.id)
        .forEach(e => { e.perf *= 1 + up * 0.0012; });
    }
    U.modal('🔥 ' + esc(d.name) + ' を送り出す',
      '<div class="quote">' + U.face(d, 40) + '<span>' +
      (d.form >= 110 ? '「わかってます。今日は獲りにいきます」'
       : d.form >= 95 ? '「はい。やることは分かっています」'
       : '「……ありがとうございます。やってみます」') + '</span></div>' +
      '<p class="note">調子 +' + up.toFixed(0) + '（いま ' + Math.round(d.form) + '）</p>',
      [{ label: 'グリッドへ戻る', cls: 'primary', fn: () => { U.closeModal(); refreshGrid(); } }]);
    GP.sound.play('good');
    S.save(g); refreshGrid();
  }

  function doGridLook() {
    weekFlags();
    if ((g.talked || []).indexOf('grid:look') >= 0) return;
    g.talked.push('grid:look');
    const t = S.trackAt(g, g.nextRace);
    const mine = S.carScoreOf(S.carStats(g), t);
    const ahead = (g.rivals || []).filter(r => S.carScoreOf(r.stats, t) > mine);
    const analyst = S.analystPower(g);
    const eye = S.osk(g, 'eye');
    const edge = ahead.reduce((a, r) => a + (S.carScoreOf(r.stats, t) - mine), 0) / Math.max(1, ahead.length);
    const rp = Math.max(2, Math.round((edge * 0.22 + analyst * 0.6 + S.rnd(1, 3)) * (1 + eye * 0.25)));
    g.rp += rp;
    // 前に並ぶクルマが多いほど、設計のヒントも拾いやすい
    const hint = Math.random() < Math.min(0.75, 0.18 + ahead.length * 0.05 + analyst * 0.06);
    if (hint) g.designEdge = (g.designEdge || 0) + 1;
    const target = ahead.length ? S.pick(ahead) : null;
    U.modal('🔍 並んだマシンを間近で見る',
      '<p class="lead">' + (target
        ? esc(target.name) + ' のマシンを、手が届く距離で見る。' +
          '<br>フロアの処理、翼端板の形。写真では分からないものがある。'
        : '前に並ぶクルマはない。自分たちのクルマが、いちばん速い。') + '</p>' +
      '<p class="note">🔬 研究P +' + rp +
      (hint ? '<br>📐 設計のヒントを持ち帰った（次に設計するパーツが良いものになりやすい）' : '') +
      '</p>',
      [{ label: 'グリッドへ戻る', cls: 'primary', fn: () => { U.closeModal(); refreshGrid(); } }]);
    GP.sound.play(hint ? 'crit' : 'good');
    S.save(g); refreshGrid();
  }

  function doGridGuest() {
    weekFlags();
    if ((g.talked || []).indexOf('grid:guest') >= 0) return;
    /* ---- うちが流行の元になっているとき ----
       速いチームの周りには、必ず人が寄ってくる。
       見せれば貸しになるが、そのぶん写される               */
    const cur = S.trendOf(g);
    if (cur && cur.t.mine && cur.t.copied.length < 4) {
      g.talked.push('grid:guest');
      const rv = (g.rivals || [])[S.rint(0, Math.max(0, (g.rivals || []).length - 1))];
      const who = rv ? rv.name : 'よそのチーム';
      U.modal('👀 よそのエンジニアと話す',
        '<p class="lead">「最近、調子いいですね。' + esc(cur.t.what) + '——あれ、うちでも話題ですよ」<br>' +
        '<span class="desc">' + esc(who) + ' のエンジニアが、うちのマシンの後ろをじっと覗き込んでいる。</span></p>' +
        '<p class="note">うちの解釈は、もう ' + cur.t.copied.length + 'チームに写されています。' +
        '見せれば恩を売れますが、そのぶん向こうも速くなります。</p>',
        [
          { label: '😀 見せてやる', cls: 'primary', fn: () => {
              const r = S.letRivalCopy(g, D.TREND.copyOf);
              g.designEdge = (g.designEdge || 0) + 1;
              S.addHype(g, 3.0);
              U.closeModal();
              U.log(g, '👀 ' + (r ? esc(r.team) : 'よそのチーム') + ' に「' + esc(cur.t.what) +
                '」を見せた（注目度 +3.0／設計のヒント +1／向こうのマシン +' +
                (r ? (r.gain * 100).toFixed(1) : '0') + '%）', 'warn');
              U.toast('👀 見せてやった', 'warn');
              S.save(g); refreshGrid();
            } },
          { label: '😐 はぐらかす', fn: () => {
              // 隠しても、写真は撮られている。数戦のうちに、どうせ広まる
              const late = Math.random() < 0.55 ? S.letRivalCopy(g, D.TREND.copyOf * 0.72) : null;
              S.addHype(g, -0.5);
              U.closeModal();
              U.log(g, '👀 詳しくは答えなかった' +
                (late ? '。それでも ' + esc(late.team) + ' は数日で似た形にしてきた（+' +
                  (late.gain * 100).toFixed(1) + '%）' : '。今回はまだ写されていない'),
                late ? 'warn' : 'good');
              U.toast('😐 はぐらかした');
              S.save(g); refreshGrid();
            } }
        ]);
      GP.sound.play('light');
      S.save(g); refreshGrid();
      return;
    }
    g.talked.push('grid:guest');
    const gu = gridGuest();
    const note = gu.run();
    U.modal(gu.icon + ' ' + gu.who + 'と話す',
      '<p class="lead">' + gu.line(g) + '</p>' +
      '<p class="note">' + esc(note) + '</p>',
      [{ label: 'グリッドへ戻る', cls: 'primary', fn: () => { U.closeModal(); refreshGrid(); } }]);
    GP.sound.play('good');
    S.save(g); refreshGrid();
  }

  const PADDOCK_DOORS = {
    garage:  { icon: '🏎️', label: '自チームのガレージ', to: 'マシン', fn: () => cmdGarage() },
    drivers: { icon: '🧑‍✈️', label: 'ドライバーの控え', to: 'ドライバー',
               fn: () => { A.hrTab = 'drivers'; cmdStaff(); } },
    timing:  { icon: '📊', label: 'タイミングブース', to: '情報',   fn: () => cmdInfo() },
    gate:    { icon: '🏁', label: 'コースへの出口',   to: 'レース', fn: () => cmdRace() }
  };

  /* =======================================================
     オフ期間
     建物は閉まり、みんなが敷地に出ている。歩いて挨拶して回ると、
     来季に向けて少しずつ整う。話しかけられるのは一人一度きり。
     ======================================================= */
  const OFF_DOORS = {
    'off:drv0':  { icon: '🧑‍✈️', label: '', to: '話す', fn: () => doOffDriver(0) },
    'off:drv1':  { icon: '🧑‍✈️', label: '', to: '話す', fn: () => doOffDriver(1) },
    'off:staff': { icon: '👥', label: 'スタッフのみんな', to: '労う', fn: doOffStaff },
    'off:youth': { icon: '🎓', label: '下部組織の若手', to: '激励', fn: doOffYouth },
    'off:mgr':   { icon: '👔', label: '首脳陣', to: '来季の話', fn: doOffMgr },
    'off:test':    { icon: '🏁', label: '合同テスト',     to: '走る',   fn: doOffTest },
    'off:plan':    { icon: '📋', label: '来季のマシン方針', to: '決める', fn: doOffPlan },
    'off:sponsor': { icon: '🤝', label: 'スポンサー交渉',  to: '交渉',   fn: doOffSponsor },
    'off:scout':   { icon: '🔍', label: '若手のスカウト',  to: '探す',   fn: doOffScout },
    'off:next':    { icon: '🌱', label: '来季へ', to: '出発', fn: doOffNext }
  };

  /* ---- 合同テスト ----
     オフにしかできない走り込み。ドライバーが仕上がり、
     マシンのデータも取れる。走るほど良いが、費用がかかる。        */
  function doOffTest() {
    if (offDone('test')) {
      return U.modal('🏁 合同テスト',
        '<p class="lead">今オフのテストは終えた。</p>', [{ label: '戻る', fn: U.closeModal }]);
    }
    const plans = [
      { d: 1, name: '1日', cost: 900,  form: [4, 8],   rp: [4, 8],   sk: 0.15 },
      { d: 3, name: '3日', cost: 2400, form: [9, 16],  rp: [10, 18], sk: 0.35 },
      { d: 5, name: '5日', cost: 4200, form: [15, 24], rp: [18, 30], sk: 0.60 }
    ];
    let body = '<p class="lead">オフのサーキットを借りて走り込みます。' +
      'ドライバーが仕上がり、マシンのデータも取れます。</p>' +
      '<p class="desc">長く走るほど得るものは大きいですが、そのぶん費用がかかります。' +
      'いまの資金は ' + money(g.funds) + '万。</p><div class="pick">';
    plans.forEach(pl => {
      body += '<button class="pickbtn" data-k="test:' + pl.d + '"' +
        (g.funds >= pl.cost ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#4ea63f">🏁</span>' +
        '<span class="pb-body"><b>' + pl.name + 'のテスト</b>' +
        '<small>調子 +' + pl.form[0] + '〜' + pl.form[1] +
        '／研究P +' + pl.rp[0] + '〜' + pl.rp[1] +
        '／スキルが伸びることも</small></span>' +
        '<span class="pb-cost">💰' + money(pl.cost) + '</span></button>';
    });
    body += '</div>';
    U.modal('🏁 合同テスト', body, [{ label: 'やめる', fn: U.closeModal }]);
    bindPick(k => {
      const pl = plans.find(x => 'test:' + x.d === k);
      if (!pl || g.funds < pl.cost) return;
      g.funds -= pl.cost;
      const rp = Math.round(S.rnd(pl.rp[0], pl.rp[1]) * (1 + S.osk(g, 'eye') * 0.25));
      g.rp += rp;
      const notes = [];
      g.drivers.forEach(d => {
        const up = Math.round(S.rnd(pl.form[0], pl.form[1]) * S.persOf(d).rest);
        d.form = S.clamp(d.form + up, 62, 122);
        notes.push(esc(d.name) + ' 調子 +' + up);
        // 走り込みで技術が伸びることがある
        if (Math.random() < pl.sk) {
          const k2 = S.pick(['speed', 'technique', 'stamina', 'mental']);
          const g2 = Math.round(S.rnd(1, 3));
          d[k2] = S.clamp(d[k2] + g2, 1, 199);
          notes.push(esc(d.name) + ' ' + ({speed:'速さ',technique:'技術',stamina:'体力',mental:'精神'}[k2]) + ' +' + g2);
        }
      });
      offMark('test');
      S.save(g); U.renderTop(g);
      U.modal('🏁 合同テスト',
        '<p class="lead">' + pl.name + '走り込んだ。</p>' +
        '<div class="rewardbox"><div>研究ポイント <b>+' + rp + '</b></div></div>' +
        '<p class="desc">' + notes.join('／') + '</p>',
        [{ label: '手応えあり', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
      GP.sound.play('good');
    });
  }

  /* ---- 来季のマシン方針 ----
     どの性能を軸に作るかを決める。決めた方向は来季の開発で伸びやすくなる。 */
  /* コンセプトを小さな札で見せる。得意・苦手の説明で使う */
  function cnptChip(key) {
    const c = D.CONCEPTS.find(x => x.key === key);
    if (!c) return '—';
    return '<i class="cchip" style="background:' + c.color + '">' + c.icon + c.name + '</i>';
  }

  function doOffPlan() {
    /* ---- マシンコンセプト ----
       決めた向きはよく伸び、逆らう向きは上限そのものが下がる。
       いくら時間をかけてもコンセプトの外までは行けないので、
       ここは1年ぶんの覚悟を決める場面になる                     */
    const cur = g.plan || null;
    const stock = g.nextCar || 0;
    const db = S.designBase(g);
    const tech = (g.managers || {}).technical;

    let body = '<p class="lead">この車は、<b>何で戦うのか</b>を決めます。</p>' +
      '<p class="desc">決めた向きの開発は速く進み（<b>×' + D.CONCEPT.onMul.toFixed(2) + '</b>）、' +
      '逆らう向きは遅くなるうえに、<b>上限そのものが ' +
      Math.round(D.CONCEPT.offCap * 100) + '% で止まります</b>。' +
      'いくら時間をかけても、決めたコンセプトの外までは行けません。<br>' +
      '<b>変えられるのは、オフのあいだと、車を作り直した直後だけ</b>です。' +
      '途中でどうしても方向を変えたくなったら、世代を上げて作り直すことになります。</p>';

    // ---- 図面を引く人との相性 ----
    body += '<div class="cnpt-boss' + (tech ? '' : ' empty') + '">' +
      '<b>📐 基本設計能力 <em>' + db.value.toFixed(1) + '</em></b>' +
      '<small>コンセプトを図面に落とし込む力です。' +
      'もとになるのは<b>人事の噛み合わせ</b>（設計グループと開発グループ）で、' +
      'そこに<b>開発責任者の相性</b>が掛かります。' +
      (tech
        ? '<br>いまの開発責任者は <b>' + esc(tech.name) + '</b>。' +
          '得意は ' + cnptChip(tech.good) + '、苦手は ' + cnptChip(tech.bad) + '。'
        : '<br><em class="warn">開発責任者が空席です。図面の質はスタッフの力そのままになります。</em>') +
      '</small></div>';

    if (stock > 0) {
      body += '<div class="stockbox"><b>🌱 積んである来季ぶんの開発：' +
        Math.round(S.nextCarProgress(g) * 100) + '%</b>' +
        '<small>方針を決めると、この仕込みが<b>いまここでマシンに落とし込まれます</b>。' +
        '決めた方向のパーツと車体に厚く配られます。<br>' +
        '<em class="warn">オフのうちに決めないと、来季へ持ち越すあいだに2割が失われます。</em></small></div>';
    }
    body += '<div class="pick">';
    D.CONCEPTS.forEach(d => {
      const f = tech ? (tech.good === d.key ? 1 : tech.bad === d.key ? -1 : 0) : 0;
      const mul = 1 + (f > 0 ? D.CONCEPT.fitUp : 0) - (f < 0 ? D.CONCEPT.fitDown : 0);
      const upNm = d.up.map(k => (D.BODY_ATTRS.find(x => x.key === k) || {}).name).join('・');
      const dnNm = d.down.map(k => (D.BODY_ATTRS.find(x => x.key === k) || {}).name).join('・');
      body += '<button class="pickbtn' + (cur === d.key ? ' on' : '') +
        '" data-k="plan:' + d.key + '">' +
        '<span class="pb-ic" style="background:' + d.color + '">' + d.icon + '</span>' +
        '<span class="pb-body"><b>' + d.name + '</b>' +
        (f ? '<i class="fitm ' + (f > 0 ? 'good' : 'bad') + '">' +
             (f > 0 ? '開発責任者の得意 ×' + mul.toFixed(2) : '開発責任者の苦手 ×' + mul.toFixed(2)) +
             '</i>' : '') +
        '<small>' + esc(d.desc) +
        '<br><b class="up">伸びる：' + upNm + '</b>' +
        '　<b class="dn">頭打ち：' + dnNm + '</b></small></span>' +
        (cur === d.key ? '<span class="pb-cost">選択中</span>' : '') + '</button>';
    });
    body += '</div>';
    U.modal('📋 来季のマシン方針', body, [{ label: '閉じる', fn: U.closeModal }]);
    bindPick(k => {
      if (k.indexOf('plan:') !== 0) return;
      S.setConcept(g, k.slice(5));
      offMark('plan');
      const d = D.CONCEPTS.find(x => x.key === g.plan);
      // 積んであった仕込みを、その方向に厚くしてマシンへ落とし込む
      const got = S.applyStock(g, g.plan);
      S.save(g);
      U.closeModal();
      U.toast(d.icon + ' 来季は「' + d.name + '」', 'good');
      U.log(g, '📋 来季のマシン方針を「' + d.name + '」に決めた。');
      if (got) {
        const top = got.parts.concat(got.body).sort((a, b) => b.gain - a.gain).slice(0, 3)
          .map(x => x.name + ' +' + x.gain).join('、');
        U.log(g, '🌱 積んでいた開発が来季のマシンに乗った（' + top + ' ほか）。', 'good');
        U.toast('🌱 仕込みがマシンに乗った！', 'good');
        GP.sound.play('crit');
      } else {
        GP.sound.play('good');
      }
      render();
    });
  }

  /* ---- オフのスポンサー交渉 ----
     シーズン中より良い条件で結べる。枠が空いていれば増やせる。   */
  function doOffSponsor() {
    if (offDone('sponsor')) {
      return U.modal('🤝 スポンサー交渉',
        '<p class="lead">今オフの交渉は済ませた。</p>', [{ label: '戻る', fn: U.closeModal }]);
    }
    const slots = 2 + g.facilities.market;
    const have = g.sponsors.map(sp => sp.name);
    const avail = D.SPONSORS.filter(sp => S.sponsorOpen(g, sp) && have.indexOf(sp.name) < 0);
    const boost = 1.18 + S.osk(g, 'nego') * 0.04;      // オフは条件が良い
    let body = '<p class="lead">オフはじっくり話ができるぶん、条件が良くなります。</p>' +
      '<p class="desc">枠 ' + g.sponsors.length + ' / ' + slots +
      '　オフの上乗せ <b>×' + boost.toFixed(2) + '</b>（交渉術で伸びます）</p>';
    if (g.sponsors.length >= slots) {
      body += '<p class="note">枠が埋まっています。マーケティング室を広げると増えます。</p>';
    } else if (!avail.length) {
      body += '<p class="note">いまの規模で新たに組める相手がいません。</p>';
    } else {
      body += '<div class="pick">';
      avail.slice(0, 4).forEach(sp => {
        const per = Math.round((sp.per || 0) * boost);
        const rp = Math.round((sp.rp || 0) * boost);
        body += '<button class="pickbtn" data-k="osp:' + esc(sp.name) + '">' +
          '<span class="pb-ic" style="background:' + (D.SPONSOR_KINDS[sp.kind] || {}).color + '">' +
            ((D.SPONSOR_KINDS[sp.kind] || {}).icon || '📣') + '</span>' +
          '<span class="pb-body"><b>' + esc(sp.name) + '</b>' +
          '<small>毎戦 💰' + money(per) + (rp ? '＋🔬' + rp : '') + perkChip(sp) + '</small></span>' +
          '</button>';
      });
      body += '</div>';
    }
    U.modal('🤝 スポンサー交渉', body, [{ label: '閉じる', fn: U.closeModal }]);
    bindPick(k => {
      if (k.indexOf('osp:') !== 0) return;
      const sp = avail.find(x => x.name === k.slice(4));
      if (!sp || g.sponsors.length >= slots) return;
      const signed = JSON.parse(JSON.stringify(sp));
      signed.per = Math.round((sp.per || 0) * boost);
      signed.rp = Math.round((sp.rp || 0) * boost);
      signed.hits = 0;
      g.sponsors.push(signed);
      offMark('sponsor');
      S.save(g);
      U.closeModal();
      U.toast('🤝 ' + sp.name + 'と契約', 'good');
      U.log(g, '🤝 オフの交渉で ' + sp.name + ' と好条件で結んだ。', 'good');
      GP.sound.play('good');
      render();
    });
  }

  /* ---- オフの若手スカウト ----
     シーズン中より広く見て回れるので、良い素材に当たりやすい。   */
  function doOffScout() {
    if (offDone('scout')) {
      return U.modal('🔍 若手のスカウト',
        '<p class="lead">今オフはもう見て回った。</p>', [{ label: '戻る', fn: U.closeModal }]);
    }
    const slots = S.youthSlots(g);
    if ((g.youth || []).length >= slots) {
      return U.modal('🔍 若手のスカウト',
        '<p class="lead">下部組織がいっぱいです（' + g.youth.length + ' / ' + slots + '）。</p>' +
        '<p class="desc">ユースアカデミーを広げるか、誰かを昇格させると空きます。</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    // オフは3人まで見られる。才能はシーズン中より良く出る
    const cands = [0, 1, 2].map(() => {
      // makeYouth は「シーズン数」を受け取る。g を渡すと能力値が
      // すべて NaN になり、見ても何も分からない若手ができていた
      const y = S.makeYouth(g.season);
      if (Math.random() < 0.45) y.pot = Math.min(4, (y.pot || 0) + 1);   // オフの上振れ
      return y;
    });
    const cost = Math.round(600 + g.facilities.youth * 120);
    let body = '<p class="lead">オフは各地をゆっくり見て回れます。' +
      '良い素材に当たりやすい。</p>' +
      '<p class="desc">枠 ' + (g.youth || []).length + ' / ' + slots +
      '　契約金 💰' + money(cost) + '万（いまの資金 ' + money(g.funds) + '万）</p><div class="pick">';
    cands.forEach((y, i) => {
      body += '<button class="pickbtn scoutbtn" data-k="oyo:' + i + '"' +
        (g.funds >= cost ? '' : ' disabled') + '>' +
        '<span class="pb-ic face-ic">' + U.face(y, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(y.name) + '</b>' +
        '<small>' + scoutCardHTML(y) + '</small></span>' +
        '<span class="pb-cost">💰' + money(cost) + '</span></button>';
    });
    body += '</div>';
    U.modal('🔍 若手のスカウト', body, [{ label: 'やめる', fn: U.closeModal }]);
    bindPick(k => {
      if (k.indexOf('oyo:') !== 0) return;
      const y = cands[parseInt(k.slice(4), 10)];
      if (!y || g.funds < cost) return;
      g.funds -= cost;
      g.youth = (g.youth || []).concat([y]);
      offMark('scout');
      S.save(g);
      U.closeModal();
      U.toast('🔍 ' + y.name + ' が加入', 'good');
      U.log(g, '🔍 オフのスカウトで ' + y.name + ' を下部組織に迎えた。', 'good');
      GP.sound.play('good');
      render();
    });
  }

  function offDoors() {
    const m = {};
    // オフの用事も、済んだものにはチェックが付くようにする
    Object.keys(OFF_DOORS).forEach(k => {
      const d = OFF_DOORS[k];
      const tag = k.slice(4);
      m[k] = k === 'off:next' ? d
           : Object.assign({}, d, { done: offDone(tag),
                                    to: offDone(tag) ? '済んだ' : d.to });
    });
    (g.drivers || []).slice(0, 2).forEach((d, i) => {
      const dn = offDone('drv' + i);
      if (m['off:drv' + i]) m['off:drv' + i] = { icon: '🧑‍✈️', label: d.name, done: dn,
                                                 to: dn ? '話した' : '話す',
                                                 fn: () => doOffDriver(i) };
    });
    return m;
  }

  function offDone(key) { return (g.offTalked || []).indexOf(key) >= 0; }
  function offMark(key) { g.offTalked = (g.offTalked || []).concat([key]); }

  function doOffDriver(i) {
    const d = (g.drivers || [])[i];
    if (!d) return;
    const key = 'drv' + i;
    const p = S.persOf(d);
    if (offDone(key)) {
      return U.modal('🧑‍✈️ ' + esc(d.name),
        '<div class="quote">' + U.face(d, 40) + '<span>また来季、よろしく頼む。</span></div>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    // 来季に向けて気持ちを整える。休養と同じで、性格で効きが変わる
    const up = Math.round(S.rnd(8, 16) * p.rest);
    d.form = S.clamp(d.form + up, 62, 122);
    const mup = Math.round(S.rnd(1, 3));
    d.mental = S.clamp(d.mental + mup, 1, 199);
    offMark(key);
    S.save(g); U.renderTop(g);
    U.modal('🧑‍✈️ ' + esc(d.name),
      '<div class="quote">' + U.face(d, 40) + '<span>' +
      esc(d.seasonPoints > 0 ? '今季は悪くなかった。来季はもっと上でやりたい。'
                             : '悔しいシーズンだった。来季は必ず返す。') + '</span></div>' +
      '<div class="rewardbox"><div>調子 <b>+' + up + '</b></div>' +
      '<div>精神 <b>+' + mup + '</b></div></div>',
      [{ label: 'ありがとう', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    GP.sound.play('good');
  }

  function doOffStaff() {
    if (offDone('staff')) {
      return U.modal('👥 スタッフのみんな', '<p class="lead">「来季も頼みます！」</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    // 労うと、シーズンの疲れが抜けて少し伸びる
    let n = 0;
    // 端数のまま足すと「技能 36.269970727173385」と出てしまう。
    // 上限もその人の器（staffCap）で止める
    (g.staff || []).forEach(st => {
      st.skill = S.clamp(Math.round(st.skill + S.rnd(1, 3)), 1, S.staffCap(st));
      n++;
    });
    offMark('staff');
    S.save(g);
    U.modal('👥 スタッフのみんな',
      '<p class="lead">一年の働きを労った。</p>' +
      '<div class="bigbox">' + n + ' 人の技能が <b>少し上がった</b></div>' +
      '<p class="desc">オフのうちに労っておくと、来季の立ち上がりが変わります。</p>',
      [{ label: 'おつかれさま', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    GP.sound.play('good');
  }

  function doOffYouth() {
    if (offDone('youth')) {
      return U.modal('🎓 下部組織の若手', '<p class="lead">「来季こそ乗ります！」</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    let n = 0;
    (g.youth || []).forEach(y => {
      ['speed', 'technique', 'stamina', 'mental'].forEach(k => {
        y[k] = S.clamp(y[k] + S.rnd(1, 4), 1, 199);
      });
      n++;
    });
    offMark('youth');
    S.save(g);
    U.modal('🎓 下部組織の若手',
      n ? '<p class="lead">若手を集めて、来季の話をした。</p>' +
          '<div class="bigbox">' + n + ' 人が <b>少し伸びた</b></div>'
        : '<p class="lead">いまは下部組織に誰もいない。</p>' +
          '<p class="desc">「人事」→「育成」からスカウトできます。</p>',
      [{ label: '戻る', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
  }

  function doOffMgr() {
    if (offDone('mgr')) {
      return U.modal('👔 首脳陣', '<p class="lead">「方針は決まりました。あとはやるだけです」</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    // 来季に向けた仕込み。研究ポイントで返ってくる
    const gain = Math.round(10 + S.analystPower(g) * 2 + S.mgr(g, 'principal') * 0.6 + S.rnd(0, 6));
    g.rp += gain;
    offMark('mgr');
    S.save(g); U.renderTop(g);
    U.modal('👔 首脳陣',
      '<p class="lead">来季の方針を詰めた。</p>' +
      '<div class="bigbox">研究ポイント <b>+' + gain + '</b></div>' +
      '<p class="desc">首脳陣が揃っているほど、実りのある話になります。</p>',
      [{ label: 'よろしく', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    GP.sound.play('good');
  }

  function doOffNext() {
    const LABEL = { drv0: 'ドライバー', drv1: 'ドライバー', staff: 'スタッフ',
                    youth: '下部組織', mgr: '首脳陣', test: '合同テスト',
                    plan: '来季の方針', sponsor: 'スポンサー交渉', scout: '若手のスカウト' };
    const left = Object.keys(LABEL)
      .filter(k => !offDone(k) && (k.indexOf('drv') !== 0 || g.drivers[parseInt(k.slice(3), 10)]));
    const body = left.length
      ? '<p class="lead">オフのうちにしかできないことが残っています。</p>' +
        '<div class="bigbox">残り <b>' + left.length + '</b> 件' +
        '<small>' + left.map(k => LABEL[k]).join('／') + '</small></div>' +
        '<p class="desc">来季を始めると、これらはもうできません。</p>'
      : '<p class="lead">オフにやるべきことは全部済ませた。来季へ向かおう。</p>';
    U.modal('🌱 来季へ', body, [
      { label: '🌱 来季を始める', cls: 'primary', fn: nextSeason },
      { label: 'もう少し回る', fn: U.closeModal }
    ]);
  }

  function enterOffseason() {
    U.closeModal();
    g.offseason = true;
    g.offTalked = [];
    GP.base.invalidate();
    S.save(g);
    U.toast('🌱 オフ期間。みんなに挨拶して回ろう', 'good');
    U.log(g, '🌱 シーズンオフに入った。');
    render();
  }

  /* いま歩いている場所（本拠地／パドック）と、その入口一覧 */
  function hubMap() {
    if (g.onGrid) return GP.grid;
    return isRaceWeek() ? GP.paddock : GP.base;
  }

  /* 同じレースウィークのうちは、一度きりの行動を覚えておく */
  function weekFlags() {
    if (g.wkTag !== g.season + ':' + g.week) {
      g.wkTag = g.season + ':' + g.week;
      g.scouted = [];
      g.talked = [];
    }
    return g;
  }

  /* パドックの入口一覧。ライバルのガレージと人はゲームの状態から作る */
  function hubDoors() {
    if (g.offseason) return offDoors();
    if (g.onGrid) return gridDoors();
    if (!isRaceWeek()) {
      if (g.offseason) return HUB_DOORS;
      const m = {};
      Object.keys(HUB_DOORS).forEach(k => { m[k] = HUB_DOORS[k]; });
      const yd = yardDoors();
      Object.keys(yd).forEach(k => { m[k] = yd[k]; });
      return m;
    }
    weekFlags();
    const map = {};
    Object.keys(PADDOCK_DOORS).forEach(k => { map[k] = PADDOCK_DOORS[k]; });
    (g.rivals || []).forEach((r, ri) => {
      // ガレージの並びは i=4 が自チーム。ライバルはそこを飛ばして詰める
      const gi = ri < GP.paddock.MINE_AT ? ri : ri + 1;
      const done = (g.scouted || []).indexOf(r.name) >= 0;
      // 札は狭い。チーム名だけ出して、何をするかは下の一言に任せる
      map['scout' + gi] = {
        icon: '👀', label: r.name, done: done,
        to: done ? '確認済み' : 'ガレージを覗く',
        fn: () => doScout(r)
      };
    });
    const spoke = k => (g.talked || []).indexOf(k) >= 0;
    (g.drivers || []).slice(0, 2).forEach((d, i) => {
      const dn = spoke('talk:' + d.id);
      map['drv' + i] = { icon: '🧑‍✈️', label: d.name, done: dn,
                         to: dn ? '話した' : '話す', fn: () => doTalk(d) };
    });
    const pdn = spoke('press');
    map.press = { icon: '📰', label: '記者たち', done: pdn,
                  to: pdn ? '取材済み' : '取材', fn: doPress };
    GP.paddock.visitors(g).forEach(v => {
      const dn = spoke('poach:' + v.team.name + ':' + v.driver.name);
      map[v.spot.key] = {
        icon: '🤝', label: v.driver.name, done: dn,
        to: dn ? '接触済み' : v.team.name, fn: () => doPoach(v.driver, v.team)
      };
    });
    return map;
  }

  /* ---- ドライバーと話す ---- */
  function doTalk(d) {
    weekFlags();
    const key = 'talk:' + d.id;
    const done = (g.talked || []).indexOf(key) >= 0;
    const p = S.persOf(d);
    const line = S.quoteFor ? S.quoteFor(d, 'pre') : null;
    let body = '<div class="quote">' + U.face(d, 40) + '<span>' +
      esc(line || (d.form >= 108 ? '調子はいい。今日はいけると思う。'
                 : d.form <= 88 ? '正直、あまり感触がよくない。'
                 : 'いつも通り。やることをやるだけだ。')) + '</span></div>' +
      '<p class="desc">' + esc(p.icon + p.name + '／' + p.desc) + '</p>';
    if (done) {
      body += '<p class="note">今週はもう話した。</p>';
      return U.modal('🧑‍✈️ ' + esc(d.name), body, [{ label: '戻る', fn: U.closeModal }]);
    }
    const up = Math.round(S.rnd(3, 8) * p.rest);
    d.form = S.clamp(d.form + up, 62, 122);
    g.talked.push(key);
    S.save(g);
    U.renderTop(g);
    body += '<div class="bigbox">調子 <b>+' + up + '</b></div>' +
      '<p class="desc">レースウィークごとに、ひとり一度だけ話せます。</p>';
    U.modal('🧑‍✈️ ' + esc(d.name), body,
      [{ label: '送り出す', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    U.log(g, '🧑‍✈️ ' + d.name + ' と話した。調子 +' + up);
    GP.sound.play('good');
  }

  /* ---- 記者の取材 ----
     強気に出れば注目度が大きく動くが、外すと反動もある。          */
  function doPress() {
    weekFlags();
    if ((g.talked || []).indexOf('press') >= 0) {
      return U.modal('📰 記者たち',
        '<p class="lead">今週の取材はもう終えた。</p>', [{ label: '戻る', fn: U.closeModal }]);
    }
    const rank = S.constructorTable(g).findIndex(t => t.isPlayer) + 1;
    const teams = S.allTeams(g, S.trackAt(g, g.nextRace)).length;
    const strong = rank > 0 && rank <= Math.ceil(teams / 2);
    const answer = (label, hype, fan, note) => ({
      label: label, cls: hype > 6 ? 'primary' : '',
      fn: () => {
        // 上位にいるときの強気は効く。下位で大口を叩くと空回りする
        // 話題になっている最中の取材は、ふだんより大きく響く
        const hot = S.pressTopic(g) ? 1.35 : 1;
        const mul = (strong ? 1 : 0.45) * (1 + S.osk(g, 'fame') * 0.25) * hot;   // 知名度
        const h = Math.round(hype * mul);
        S.addHype(g, h);
        g.fans = Math.max(0, Math.round(g.fans * (1 + fan * mul / 100)));
        g.talked.push('press');
        U.closeModal();
        U.toast('📰 注目度 ' + (h >= 0 ? '+' : '') + h, h >= 0 ? 'good' : 'bad');
        U.log(g, '📰 ' + note + '（注目度 ' + (h >= 0 ? '+' : '') + h + '）');
        S.save(g); render();
      }
    });
    /* 直近に何かあれば、記者はそこを突いてくる。
       裁定、新機構、ドライバーの入れ替え——聞かれることが変わる  */
    const hit = S.pressTopic(g);
    const t = hit && hit.topic;
    const q = t ? t.q.replace('{W}', esc(hit.news.what))
                : '「今週の手応えはいかがですか？」';
    const opts = t ? t.a
      : [['🔥 「表彰台を狙う」', 14, 3, '強気の発言をした'],
         ['🙂 「一戦ずつ戦う」', 6, 1, '手堅く答えた'],
         ['🤐 「特にありません」', 1, 0, '取材を短く切り上げた']];
    U.modal('📰 記者たち',
      '<p class="lead">' + (t ? t.icon + ' ' : '') + q + '</p>' +
      (t ? '<p class="note">' + esc(hit.news.what) + ' の件で、記者たちが詰めかけています。' +
           'ここでの答えかたは、ふだんの取材より大きく響きます。</p>' : '') +
      '<p class="desc">いまのコンストラクターズ順位は <b>' + (rank || '-') + '位</b>。' +
      (strong ? '上位にいるので、強気の発言はよく届きます。'
              : '下位のうちは、大きな話をしても響きにくいものです。') + '</p>',
      opts.map(o => answer(o[0], o[1], o[2], o[3]))
          .concat([{ label: 'やめる', fn: U.closeModal }]));
  }

  /* =======================================================
     敷地に出ている人（平常週）
     コマンドとコマンドのあいだに、歩いて声をかけて回れる。
     週は消費しないが、一人につき週1回まで。
     ======================================================= */
  function yardPeople() {
    const done = g.yardDone || [];
    const list = [];
    // レースの次の週は、全員が集まる場ができる
    if (g.debrief > 0 && g.lastRace) {
      list.push({ key: 'yd:brief', label: '🔍 合同デブリーフィング', color: g.color,
                  prop: 'brief', done: done.indexOf('yd:brief') >= 0 });
    }
    (g.drivers || []).slice(0, 2).forEach((d, i) => {
      list.push({ key: 'yd:drv' + i, label: d.name, color: g.color,
                  hair: '#3a2718', face: '#f0c49a', done: done.indexOf('yd:drv' + i) >= 0 });
    });
    // 職種ごとに、その道のいちばんが出てくる
    const topOf = keys => (g.staff || []).filter(x => keys.indexOf(x.type) >= 0)
      .sort((a, b) => b.skill - a.skill)[0];
    const eng = topOf(['engineer', 'designer']);
    if (eng) {
      list.push({ key: 'yd:eng', label: eng.name, color: '#5a6270',
                  hair: '#2b1d12', face: '#e8bd94', hat: '#c9a86a',
                  done: done.indexOf('yd:eng') >= 0 });
    }
    const mech = topOf(['mechanic']);
    if (mech) {
      list.push({ key: 'yd:mech', label: mech.name, color: '#3a5a86',
                  hair: '#241c14', face: '#eec49a', hat: '#2a4a6a',
                  done: done.indexOf('yd:mech') >= 0 });
    }
    const strat = topOf(['strategist']);
    if (strat) {
      list.push({ key: 'yd:strat', label: strat.name, color: '#8a4a86',
                  hair: '#2b1d12', face: '#f0c49a',
                  done: done.indexOf('yd:strat') >= 0 });
    }
    list.push({ key: 'yd:crew', label: 'ピットクルー', color: '#3f8a4a',
                hair: '#4a3018', face: '#f2cba4', hat: '#e8c24a',
                done: done.indexOf('yd:crew') >= 0 });
    list.push({ key: 'yd:press', label: '記者', color: '#8a5a2a',
                hair: '#241c14', face: '#e2b48e', done: done.indexOf('yd:press') >= 0 });
    if ((g.youth || []).length) {
      list.push({ key: 'yd:youth', label: g.youth[0].name + '（若手）', color: '#b06fd0',
                  hair: '#3a2718', face: '#f0c49a', done: done.indexOf('yd:youth') >= 0 });
    }
    return list;
  }
  const yardDone = k => (g.yardDone || []).indexOf(k) >= 0;
  function yardMark(k) {
    g.yardDone = (g.yardDone || []).concat([k]);
    GP.base.setYard(yardPeople());     // 話した人は薄く描かれる
    GP.base.invalidate();
  }

  /* 敷地の人に話しかけたときの中身 */
  function yardDoors() {
    const m = {};
    yardPeople().forEach(q => {
      const dn = q.done;
      if (q.key === 'yd:brief') {
        m[q.key] = { icon: '🔍', label: '合同デブリーフィング', done: dn,
                     to: dn ? '終わった' : '集まる',
                     fn: () => dn ? yardAgain('チーム') : doDebrief() };
        return;
      }
      if (q.key.indexOf('yd:drv') === 0) {
        const i = +q.key.slice(6);
        m[q.key] = { icon: '🧑‍✈️', label: q.label, done: dn, to: dn ? '話した' : '話す',
                     fn: () => dn ? yardAgain(q.label) : doYardDriver(i) };
      } else if (q.key === 'yd:eng') {
        m[q.key] = { icon: '👷', label: q.label, done: dn, to: dn ? '話した' : '技術の話',
                     fn: () => dn ? yardAgain(q.label) : doYardEngineer() };
      } else if (q.key === 'yd:mech') {
        m[q.key] = { icon: '🔩', label: q.label, done: dn, to: dn ? '話した' : 'マシンを見る',
                     fn: () => dn ? yardAgain(q.label) : doYardMech() };
      } else if (q.key === 'yd:strat') {
        m[q.key] = { icon: '🧠', label: q.label, done: dn, to: dn ? '話した' : '作戦の相談',
                     fn: () => dn ? yardAgain(q.label) : doYardStrat() };
      } else if (q.key === 'yd:crew') {
        m[q.key] = { icon: '🧑‍🔧', label: 'ピットクルー', done: dn, to: dn ? '話した' : 'ねぎらう',
                     fn: () => dn ? yardAgain('ピットクルー') : doYardCrew() };
      } else if (q.key === 'yd:press') {
        m[q.key] = { icon: '📰', label: '記者', done: dn, to: dn ? '話した' : '取材を受ける',
                     fn: () => dn ? yardAgain('記者') : doYardPress() };
      } else if (q.key === 'yd:youth') {
        m[q.key] = { icon: '🎓', label: q.label, done: dn, to: dn ? '話した' : '激励する',
                     fn: () => dn ? yardAgain(q.label) : doYardYouth() };
      }
    });
    return m;
  }

  function yardAgain(name) {
    U.toast('🗨️ ' + name + ' とは今週もう話した', '');
    GP.sound.play('tap');
  }

  function yardResult(title, body, note) {
    U.modal(title, '<p class="lead">' + body + '</p>' +
      (note ? '<p class="note">' + note + '</p>' : ''),
      [{ label: '戻る', cls: 'primary', fn: U.closeModal }]);
  }

  function doYardDriver(i) {
    const d = (g.drivers || [])[i];
    if (!d) return;
    yardMark('yd:drv' + i);
    const up = S.rnd(4, 9) * S.persOf(d).rest;
    d.form = S.clamp(d.form + up, 62, 122);
    const p = S.persOf(d);
    const t = S.trackAt(g, g.nextRace);
    const w = t.weight;
    const best = w.speed >= w.corner && w.speed >= w.accel ? '最高速'
               : w.corner >= w.accel ? 'コーナー' : '加速';
    yardResult('🧑‍✈️ ' + esc(d.name) + 'と話す',
      p.icon + '「' + esc(t.name) + 'は' + best + 'が効きます。そこを煮詰めてもらえれば、あとは自分がやります」',
      '調子 +' + up.toFixed(0) + '（いま ' + Math.round(d.form) + '）');
    GP.sound.play('good');
    S.save(g); render();
  }

  function doYardEngineer() {
    const st = (g.staff || []).filter(x => x.type === 'engineer' || x.type === 'designer')
      .sort((a, b) => b.skill - a.skill)[0]
      || (g.staff || []).slice().sort((a, b) => b.skill - a.skill)[0];
    if (!st) return;
    yardMark('yd:eng');
    const rp = Math.round(4 + st.skill * 0.22 + S.osk(g, 'eye'));
    g.rp += rp;
    staffExp(st.type, 8);
    const t = D.STAFF_TYPES.find(x => x.key === st.type) || {};
    yardResult('👷 ' + esc(st.name) + 'と技術の話',
      '「いま気になっているのは' + esc(t.name === 'エンジニア' ? '車体のねじれ' : t.desc) +
      'のあたりです。少し数字を持ってきました」',
      '研究P +' + rp + '／' + esc(st.name) + 'にも経験が入った');
    GP.sound.play('good');
    S.save(g); render();
  }



  /* メカニックと話す。マシンの状態がいちばん悪いところを見てくれる */
  function doYardMech() {
    const st = (g.staff || []).filter(x => x.type === 'mechanic')
      .sort((a, b) => b.skill - a.skill)[0];
    if (!st) return;
    yardMark('yd:mech');
    const skill = 1 + st.skill * 0.02;
    // いちばんくたびれているパーツを見てもらう
    let worst = null;
    D.PART_CATS.forEach(c => {
      const q = g.equipped[c.key];
      // パワーユニットは立ち話では触れない（下で別に少しだけ延命する）
      if (c.key === 'pu') return;
      if (q && (!worst || q.cond < worst.cond)) worst = q;
    });
    const lines = [];
    if (worst) {
      // 立ち話でできるのは応急手当まで。ちゃんと戻すのは「🛠️ 整備」の仕事
      const up = Math.round(S.rnd(2.5, 5.5) * skill);
      worst.cond = S.clamp(worst.cond + up, 10, 92);
      lines.push(worst.name + ' のコンディション +' + up + '（いま ' + Math.round(worst.cond) + '%）');
    }
    const pu = S.puOf(g);
    const puUp = S.nursePU(g, S.rnd(3, 7) * skill);
    if (puUp > 0) lines.push('パワーユニットの残り +' + puUp + '%（いま ' + Math.round(pu.life) + '%）');
    staffExp('mechanic', 8);
    const t = S.trackAt(g, g.nextRace);
    const talk = pu.life < 30
      ? '「このユニット、次でだいたい限界です。載せ替えの週を作ってください」'
      : t.risk >= 1.1
        ? '「' + esc(t.name) + 'は壁が近い。足まわりは念入りに見ておきます」'
        : '「今のところ、目立った悪いところはありません。気持ちよく走れるはずです」';
    yardResult('🔩 ' + esc(st.name) + 'とマシンを見る', talk,
      lines.length ? lines.join('／') : '特に手を入れるところはなかった');
    GP.sound.play('good');
    S.save(g); render();
  }

  /* ストラテジストと話す。次戦の作戦の当たりをつけてくれる */
  function doYardStrat() {
    const st = (g.staff || []).filter(x => x.type === 'strategist')
      .sort((a, b) => b.skill - a.skill)[0];
    if (!st) return;
    yardMark('yd:strat');
    const t = S.trackAt(g, g.nextRace);
    const laps = t.laps;
    const stops = (t.tyre > 1.05 || laps > 28) ? 2 : 1;
    const tyreTalk = t.tyre >= 1.2 ? 'タイヤの摩耗が激しいコースです'
                   : t.tyre <= 0.95 ? 'タイヤは保つほうです' : 'タイヤは標準的です';
    const rp = Math.round(3 + st.skill * 0.12);
    g.rp += rp;
    staffExp('strategist', 8);
    yardResult('🧠 ' + esc(st.name) + 'と作戦の相談',
      '「' + esc(t.name) + 'は' + laps + '周。' + tyreTalk + '。' +
      'まずは <b>' + stops + 'ストップ</b>を軸に組み立てます」',
      '推奨ストップ数 ' + stops + '回／研究P +' + rp);
    GP.sound.play('good');
    S.save(g); render();
  }

  function doYardCrew() {
    yardMark('yd:crew');
    const before = S.crewPenalty(g).level;
    S.restCrew(g, S.rnd(6, 12));
    const now = S.crewPenalty(g).level;
    yardResult('🧑‍🔧 ピットクルーをねぎらう',
      '「オーナーが顔を出してくれると、こっちも張り合いが出ますよ」',
      'クルーの疲労 ' + Math.round(before) + ' → ' + Math.round(now));
    GP.sound.play('good');
    S.save(g); render();
  }

  function doYardPress() {
    yardMark('yd:press');
    // 直近に何かあれば、立ち話でもそこを聞かれる。話題があるほど大きく響く
    const hit = S.pressTopic(g);
    const q = hit ? hit.topic.q.replace('{W}', hit.news.what) : '「今季の手応えは？」';
    const hot = hit ? 1.5 : 1;
    const good = Math.random() < 0.72 + S.osk(g, 'fame') * 0.05;
    if (good) {
      const h = S.rnd(1.6, 4.0) * (1 + S.mgr(g, 'principal') * 0.006) * hot;
      const f = Math.round((30 + g.fans * 0.012) * hot);
      S.addHype(g, h);
      g.fans += f;
      yardResult('📰 ' + (hit ? hit.topic.icon + ' 取材を受ける' : '取材を受ける'),
        esc(q) + '——うまく答えられた。記事は好意的に出そうだ。',
        '注目度 +' + h.toFixed(1) + '／ファン +' + money(f));
      GP.sound.play('good');
    } else {
      S.addHype(g, 1.0);
      const d = (g.drivers || [])[0];
      if (d) d.form = S.clamp(d.form - S.rnd(1, 4) * hot, 62, 122);
      yardResult('📰 ' + (hit ? hit.topic.icon + ' 取材を受ける' : '取材を受ける'),
        esc(q) + '——言葉を選び損ねた。少し波風が立ちそうだ。',
        '注目度 +1.0／チームの空気が少し重くなった');
      GP.sound.play('tap');
    }
    S.save(g); render();
  }

  function doYardYouth() {
    const d = (g.youth || [])[0];
    if (!d) return;
    yardMark('yd:youth');
    const keys = ['speed', 'technique', 'stamina', 'mental'];
    const k = S.pick(keys);
    const up = S.rnd(1.2, 3.0) * S.potOf(d).growth;
    d[k] = S.clamp(d[k] + up, 1, 199);
    const nm = { speed: '速さ', technique: '技術', stamina: '体力', mental: '精神' }[k];
    yardResult('🎓 ' + esc(d.name) + 'を激励する',
      '「いつか、あの車に乗せてください」',
      nm + ' +' + up.toFixed(1) + '（' + S.potOf(d).name + '）');
    GP.sound.play('good');
    S.save(g); render();
  }

  const openFacility = key => { baseSel = key; cmdFacility(); };

  const HUB_DOORS = {
    // 敷地の絵と同じ並び。手前の列を左から、そのあと奥の列を左から
    pit:     { icon: '🔧', label: 'ピット設備',   to: '整備',   fn: () => cmdMaintain() },
    factory: { icon: '🏭', label: 'ファクトリー', to: '改良',   fn: () => cmdImprove() },
    sim:     { icon: '🏛️', label: 'シミュレーター', to: '練習', fn: () => cmdTrain() },
    market:  { icon: '📣', label: 'マーケティング室', to: '営業', fn: () => cmdSponsor() },
    youth:   { icon: '🎓', label: 'ユースアカデミー', to: '育成', fn: () => { A.hrTab = 'youth'; cmdStaff(); } },
    tunnel:  { icon: '🌀', label: '風洞',        to: '研究',   fn: () => cmdResearch() },
    depot:   { icon: '🚚', label: '遠征チーム',  to: '手配',   short: '遠征',
               fn: () => { baseTab = 'logi'; openFacility('depot'); } },
    mission: { icon: '📡', label: 'ミッションコントロール', to: '広げる', short: '管制室',
               fn: () => openFacility('mission') },
    meeting: { icon: '🗣️', label: 'ミーティングルーム', to: '広げる', short: '会議室',
               fn: () => openFacility('meeting') }
  };


  /* ---------- 拠点の画面 ----------
     以前はチームプリンシパルを歩かせていたが、
     小さい画面では「目的の建物の前に立つ」だけで手間がかかる。
     いまは絵を「いまどこに居るか」を見せるためのものとして残し、
     建物や人を直接押すか、下のタイルを押すかで入る。       */
  let hubSel = null, hubBusy = false;

  function stopHub() { hubSel = null; }

  /* 入口を一つ開ける。絵を押してもタイルを押してもここへ来る */
  function hubEnter(key) {
    const k = key || hubSel;
    const d = k && hubDoors()[k];
    if (!d || hubBusy) return;
    hubBusy = true;
    hubSel = k;
    GP.sound.play('click');
    d.fn();
    hubBusy = false;
  }

  function bindHub() {
    const cv = $('hubCv');
    if (!cv) { stopHub(); return; }
    // 平常週は、敷地に出ている人を用意する
    GP.base.setYard((isRaceWeek() || g.offseason) ? [] : yardPeople());
    GP.base.invalidate();          // 施設を広げた直後などに背景を作り直す
    GP.paddock.invalidate();
    // 前に選んだ場所がいまもあれば、そこを光らせたままにしておく
    if (hubSel && !hubDoors()[hubSel]) hubSel = null;
    // 本拠地とパドックでは絵の広さが違う。合わせておかないと右側が空く
    const mp = hubMap();
    if (cv.width !== mp.W || cv.height !== mp.H) { cv.width = mp.W; cv.height = mp.H; }
    mp.drawWith(cv, g, hubSel, null);

    // 画面上の座標をキャンバスの座標へ直す
    const at = ev => {
      const r = cv.getBoundingClientRect();
      const t = (ev.changedTouches && ev.changedTouches[0]) || ev;
      return { x: (t.clientX - r.left) * (hubMap().W / r.width),
               y: (t.clientY - r.top) * (hubMap().H / r.height) };
    };
    const keyAt = ev => {
      const q = at(ev);
      const k = hubMap().hit(q.x, q.y);
      return k && hubDoors()[k] ? k : null;
    };

    // 建物や人を押したら、そのままそこへ入る
    cv.onclick = ev => {
      const k = keyAt(ev);
      if (!k) return;
      batchStop();
      hubSel = k;
      hubMap().drawWith(cv, g, hubSel, null);
      hubEnter(k);
    };
    // 押せるところの上では指の形にする（どこが押せるか分かるように）
    cv.onmousemove = ev => {
      const k = keyAt(ev);
      cv.style.cursor = k ? 'pointer' : 'default';
      if (k !== hubSel) { hubSel = k; hubMap().drawWith(cv, g, hubSel, null); }
    };
    cv.onmouseleave = () => {
      cv.style.cursor = 'default';
      if (hubSel) { hubSel = null; hubMap().drawWith(cv, g, null, null); }
    };

    renderHubList();
  }

  /* ---- いまの場所でできることを、そのままボタンにする ----
     歩いて近づくのが楽しい人はそれで、まっすぐ選びたい人はここから。
     どちらでも同じところに行き着くようにしておく                    */
  /* ---- まとめて回る ----
     人数が増えてくると、一人ずつ歩いて話しかけるのが手間になる。
     「まだ済ませていない用事」だけを順に開き、閉じると次へ進む。
     一件ずつ開くのは、何が起きたかを取りこぼさないため             */
  let batchQ = null, batchTimer = 0;
  function batchable() {
    const doors = hubDoors();
    // done を持つ入口＝一度きりの用事。設備や画面への入口は対象にしない
    return Object.keys(doors).filter(k => doors[k].done === false || doors[k].done === true)
                             .filter(k => !doors[k].done);
  }
  function batchStop() {
    batchQ = null;
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = 0; }
  }
  function batchStart() {
    const list = batchable();
    if (!list.length) return U.toast('🗨️ 今日の用事はもう済んでいる', '');
    batchStop();
    batchQ = list;
    GP.sound.play('tap');
    batchNext();
  }
  function batchNext() {
    if (!batchQ) return;
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = 0; }
    const doors = hubDoors();
    let k = null;
    while (batchQ.length && !k) {
      const c = batchQ.shift();
      if (doors[c] && !doors[c].done) k = c;
    }
    if (!k) { batchStop(); refreshWalk(); return; }
    doors[k].fn();
    batchPoll(0);
  }
  /* 開いたモーダルを見ながら、次へ送る。
     ボタンが1つだけ＝ただ結果を見せている画面なので、そのボタンを
     「次へ」に差し替える。2つ以上あるものは選ばせる画面なので触らない。
     選び終えてモーダルが閉じたら、そこで次の用事へ進む             */
  function batchPoll(n) {
    if (!batchQ) return;
    batchTimer = setTimeout(() => {
      batchTimer = 0;
      if (!batchQ) return;
      const m = $('modal');
      if (!m || !/show/.test(m.className)) return batchNext();
      const box = $('modalBtns');
      const bs = box ? Array.prototype.slice.call(box.querySelectorAll('.btn')) : [];
      if (bs.length === 1 && !bs[0].getAttribute('data-batched')) {
        const b = bs[0];
        b.setAttribute('data-batched', '1');
        b.innerHTML = batchQ.length ? '▶ 次へ（あと ' + batchQ.length + ' 件）' : '✓ ひと回り終わり';
        b.onclick = () => { U.closeModal(); setTimeout(batchNext, 60); };
      }
      if (n < 400) batchPoll(n + 1); else batchStop();
    }, 250);
  }
  function refreshWalk() {
    if (g.onGrid) return refreshGrid();
    if (GP.base.setYard) GP.base.setYard(yardPeople());
    hubMap().invalidate();
    render();
  }

  /* ---- ここでできることを、並べたタイルにする ----
     場所（建物や画面への入口）と、用事（一度きりのやりとり）を分けて並べる。
     用事は済むとチェックが付くので、残りがひと目で分かる。        */
  function hubKind(d) { return d.kind || (d.done === undefined ? 'place' : 'errand'); }

  /* 見出しは場所によって変える。同じ「場所」でも、
     グリッドとオフでは並んでいるものの意味がちがう */
  function hubTitles() {
    if (g.offseason) return { place: '進む', job: 'オフの用事' };
    if (g.onGrid)    return { place: '進む', job: 'グリッドで' };
    if (isRaceWeek()) return { place: 'パドック', job: '人・用事' };
    return { place: '場所', job: '人・用事' };
  }

  /* ---- 絵の上に出す札 ----
     建物や人のところから引き出し線を出して、名前と用事を置く。
     一覧を別に並べるのをやめて、絵そのものを一覧にする。

     置きかたに一手間いる。札は建物の真上に出したいが、
     隣どうしが近いと重なって読めなくなる。
     いったん全部並べてから、実際の大きさを測って
     重なっているものを上へ逃がす（重ねたまま出すより、
     少し離れていても読めるほうがいい）                        */
  function renderMapTags() {
    const box = $('hubTags');
    if (!box) return;
    const mp = hubMap();
    const doors = hubDoors();
    const anchor = k => {
      if (mp.plotAnchor) { const a = mp.plotAnchor(k, g); if (a) return a; }
      return mp.doorPos ? mp.doorPos(k, g) : null;
    };
    /* 札を出すのは「まだ済ませていない、その週だけの用事」だけ。
       建物には絵の中に看板が立っているので、札は要らない。
       済んだ相手も絵の中には立っているので、押せば入れる      */
    const list = [];
    Object.keys(doors).forEach(k => {
      if (doors[k].done !== false) return;
      const p = anchor(k);
      if (!p) return;
      // 端の札が絵からはみ出さないよう、少し内側へ寄せる
      const x = Math.max(9, Math.min(91, p.x / mp.W * 100));
      list.push({ k: k, d: doors[k], x: x, y: p.y / mp.H * 100 });
    });
    if (!list.length) { box.innerHTML = ''; box.classList.remove('on'); return; }
    box.innerHTML = list.map(t =>
      '<button class="mtag" data-hub="' + esc(t.k) + '"' +
      ' style="left:' + t.x.toFixed(2) + '%;top:' + t.y.toFixed(2) + '%">' +
      '<span class="mt-pill"><i>' + (t.d.icon || '•') + '</i>' +
      '<b>' + esc(t.d.label || t.k) + '</b>' +
      '<em>' + esc(t.d.to || '入る') + '</em>' +
      '</span>' +
      '<span class="mt-stem"></span></button>').join('');
    box.classList.add('on');
    spreadTags(box);
    Array.prototype.forEach.call(box.querySelectorAll('[data-hub]'), b => {
      b.onclick = () => {
        batchStop();
        const k = b.getAttribute('data-hub');
        hubSel = k;
        const cv = $('hubCv');
        if (cv) hubMap().drawWith(cv, g, hubSel, null);
        GP.sound.play('tap');
        hubEnter(k);
      };
    });
  }

  /* 重なった札を上へ逃がす。
     下にあるものほど手前（＝絵の中で近い）なので、そちらを優先して残し、
     奥のものから順に持ち上げる                                  */
  function spreadTags(box) {
    const wrap = box.getBoundingClientRect();
    if (!wrap.height) return;
    const tags = Array.prototype.slice.call(box.querySelectorAll('.mtag'));
    const boxes = tags.map(el => {
      const p = el.querySelector('.mt-pill').getBoundingClientRect();
      return { el: el, lift: 0,
               l: p.left - wrap.left, r: p.right - wrap.left,
               t: p.top - wrap.top, b: p.bottom - wrap.top, h: p.height };
    });
    boxes.sort((a, b2) => b2.b - a.b);        // 手前（下）から決めていく
    const done = [];
    boxes.forEach(q => {
      for (let i = 0; i < 9; i++) {
        const hit = done.some(o =>
          q.l < o.r + 4 && q.r > o.l - 4 && q.t < o.b + 3 && q.b > o.t - 3);
        if (!hit) break;
        const d = q.h + 4;
        q.t -= d; q.b -= d; q.lift += d;
      }
      // 上へ逃がしすぎて絵から出るくらいなら、その札は畳んで印だけにする
      if (q.t < 2) { q.el.classList.add('mini'); q.lift = 0; q.t = 0; q.b = 16; }
      /* 左右も絵の中へ入れる。
         札は足もとの真上に出すので、名前が長いと端で外へ出てしまう。
         はみ出したぶんだけ横へずらす（引き出し線は足もとに残す）  */
      let sx = 0;
      if (q.l < 2) sx = 2 - q.l;
      else if (q.r > wrap.width - 2) sx = (wrap.width - 2) - q.r;
      if (sx) { q.l += sx; q.r += sx; }
      done.push(q);
      if (q.lift) {
        q.el.style.setProperty('--lift', q.lift + 'px');
        const stem = q.el.querySelector('.mt-stem');
        if (stem) stem.style.height = q.lift + 'px';
      }
      if (sx) q.el.style.setProperty('--shift', Math.round(sx) + 'px');
    });
  }

  function renderHubList() {
    renderMapTags();
    const box = $('hubList');
    if (!box) return;
    const doors = hubDoors();
    const keys = Object.keys(doors);
    if (!keys.length) { box.innerHTML = ''; return; }
    const places = keys.filter(k => hubKind(doors[k]) === 'place');
    const jobs   = keys.filter(k => hubKind(doors[k]) === 'errand');
    const rest = batchable().length;

    const tile = (k, cls) => {
      const d = doors[k];
      const done = !!d.done;
      return '<button class="hlbtn' + (cls || '') + (done ? ' done' : '') +
        '" data-hub="' + esc(k) + '">' +
        '<i>' + (d.icon || '•') + '</i>' +
        '<b>' + esc(d.label || k) + '</b>' +
        '<em>' + esc(d.to || '入る') + '</em>' +
        (done ? '<u>✓</u>' : '') + '</button>';
    };

    const ti = hubTitles();
    // グリッドとオフの「場所」は、ここから先へ進むための一枚。
    // 用事を済ませる前に押してしまわないよう、いちばん下に置いて形も変える
    const gate = g.offseason || g.onGrid;
    /* 建物は札を2段に積まず、絵の下の一列に畳む。
       名前は絵の中の看板が言っているので、ここでは
       絵柄と用事だけあれば足りる                            */
    const chip = k => {
      const d = doors[k];
      return '<button class="hlchip' + (d.done ? ' done' : '') + '" data-hub="' + esc(k) + '"' +
        ' title="' + esc((d.label || k) + '／' + (d.to || '入る')) + '">' +
        '<i>' + (d.icon || '•') + '</i><b>' +
        esc(d.short || d.to || d.label || k) + '</b></button>';
    };
    /* 「まとめて回る」も一列に混ぜる。
       行をもう1段作ると、そのぶん絵が痩せてしまう              */
    const allChip = (!gate && rest >= 2)
      ? '<button class="hlchip all" data-all="1" title="まだ済ませていない用事を順に開く">' +
        '<i>🗣️</i><b>まとめて</b><u>' + rest + '</u></button>' : '';
    const placeHTML = !places.length ? '' :
      (gate
        ? '<b class="hl-h">' + (jobs.length ? ti.place : 'ここでできること') + '</b>' +
          '<div class="hlgrid gate">' + places.map(k => tile(k, ' wide go')).join('') + '</div>'
        : '<div class="hlrow">' + allChip + places.map(chip).join('') + '</div>');
    /* 用事は絵の上に札で出ている。歩けない場面だけ、札の一覧も出す */
    const jobHTML = !jobs.length || !gate ? '' :
      '<button class="hlbtn allbtn" data-all="1"><i>🗣️</i><b>まとめて回る</b>' +
      '<em>あと ' + rest + ' 件</em></button>' +
      '<div class="hlgrid">' + jobs.map(k => tile(k, '')).join('') + '</div>';

    box.innerHTML = gate ? jobHTML + placeHTML : placeHTML + jobHTML;

    const allb = box.querySelector('[data-all]');
    if (allb) allb.onclick = batchStart;
    Array.prototype.forEach.call(box.querySelectorAll('[data-hub]'), b => {
      b.onclick = () => {
        batchStop();
        const k = b.getAttribute('data-hub');
        // 押した先を絵の中でも光らせてから開く
        hubSel = k;
        const cv = $('hubCv');
        if (cv) hubMap().drawWith(cv, g, hubSel, null);
        GP.sound.play('tap');
        hubEnter(k);
      };
    });
  }

  /* ---------- ロジスティクス（週を消費しない）---------- */
  /* ---- トラックサイド装備 ----
     施設は本拠地、備品はその中身、こちらは週末に戦うための道具。
     段階ごとに買い上げていく                                      */
  function kitBoxHTML() {
    // いまの「読み」がどこから来ているのかを、その場に出す
    const fo = S.foresightOf(g);
    const wKit = S.kitEff(g, 'weather', 'fore');
    const st = S.readPower(g);
    let h = '<div class="sub">🧰 トラックサイド装備</div>' +
      '<div class="forebox"><b>🌦️ 天候とタイヤの読み<em>' + Math.round(fo * 100) + '%</em></b>' +
      '<i class="grp-bar"><b style="width:' + Math.round(fo * 100) + '%"></b></i>' +
      '<small>雨が来る時刻と、路面がどこへ落ち着くかを、どれだけ当てられるか。' +
      '外すと、合わないタイヤのまま何周も走ることになります。<br>' +
      'ピットウォール（ストラテジスト）<b>' + st.toFixed(1) + '</b>' +
      '／采配 <b>+' + Math.round(S.osk(g, 'call') * 6) + '%</b>' +
      '／天気の読みの装備 <b>+' + Math.round(wKit * 100) + '%</b></small></div>' +
      '<p class="desc">現地に持ち込むもの。上げるほど、週末の読みと段取りが良くなります。' +
      '一度買えば残ります。</p><div class="pick gearpick">';
    S.kitList(g).forEach(k => {
      const d = k.def, t = k.tier, nx = k.next;
      const pr = S.kitPrice(g, d.key);
      const can = nx && pr && g.funds >= pr.price;
      h += '<button class="pickbtn kitrow" data-kit="' + d.key + '"' + (can ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#5a6270">' + t.icon + '</span>' +
        '<span class="pb-body"><b>' + d.icon + ' ' + d.name +
          '<em class="kitlv">' + (k.lv + 1) + ' / ' + d.tiers.length + '</em></b>' +
        '<small><b>' + esc(t.name) + '</b>　' + esc(t.desc) +
          '<span class="kitline">' + d.tiers.map((x, i) =>
            '<span class="kitx' + (i === k.lv ? ' on' : i < k.lv ? ' past' : '') + '" title="' +
            esc(x.name) + '">' + x.icon + '</span>').join('<u>→</u>') + '</span>' +
          (nx ? '<span class="devup">次は <b>' + esc(nx.name) + '</b>：' + esc(nx.desc) + '</span>'
              : '<span class="devup">これ以上はありません</span>') +
          '<br><em class="pnote">' + esc(d.what) + '</em>' +
        '</small></span>' +
        '<span class="pb-cost">' + (nx && pr
          ? (pr.price < pr.list ? '<s>' + money(pr.list) + '</s><br>' : '') +
            '💰' + money(pr.price) + '<br><i class="tyuse">維持 ' + money(pr.up) + '/週</i>'
          : '—') + '</span></button>';
    });
    return h + '</div>';
  }
  function bindKit() {
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-kit]'), b => {
      b.onclick = () => {
        const t = S.buyKit(g, b.dataset.kit);
        if (!t) return;
        GP.sound.play('build');
        U.log(g, t.icon + ' ' + t.name + ' を持ち込むことにした（' + t.desc + '）', 'good');
        U.toast(t.icon + ' ' + t.name + '！', 'good');
        S.save(g); render(); cmdLogi();
      };
    });
  }

  /* 遠征の手配。施設画面のタブとして貼るので、
     組み立てと配線を分けてある                              */
  function cmdLogi() {
    // 遠征も本拠地の仕事のひとつ。施設画面のタブとして開く
    baseTab = 'logi';
    cmdFacility();
  }

  let logiTab = 'plan';
  function logiBoxHTML() {
    const cur = S.logiPlan(g);
    const cw = S.crewPenalty(g);
    const nextTrack = S.trackAt(g, g.nextRace) || D.TRACKS[0];
    const lvl = Math.round(cw.level);
    const state = lvl < 20 ? { t: '万全', c: 'good' } : lvl < 45 ? { t: 'ふつう', c: '' }
                : lvl < 70 ? { t: '疲れが見える', c: 'warn' } : { t: '限界', c: 'bad' };
    let body = '<p class="desc">運び方しだいで、資金・クルーの疲れ・現地での支度の進み具合が変わります。'
      + U.helpLink('logi') + '</p>';

    body += '<div class="logi-crew"><b>🧑‍🔧 クルーの疲労</b>' +
      '<span class="skbar big"><i class="f' + (lvl < 45 ? '0' : lvl < 70 ? '1' : '2') +
      '" style="width:' + lvl + '%"></i></span>' +
      '<em class="' + state.c + '">' + lvl + ' / 100　' + state.t + '</em>' +
      '<small>ピット作業 +' + cw.pit.toFixed(1) + '秒／信頼性 -' + cw.rel.toFixed(1) +
      '／作業ミス +' + (cw.mistake * 100).toFixed(1) + '%<br>' +
      '「☕ 休養」で回復します。オフシーズンには抜けます。</small></div>';

    g.logi = g.logi || { plan: 'std', load: 'std', crew: 0 };
    const curLoad = S.logiLoad(g);
    // 選択肢を試したときの数字を、実際の関数から出す
    const withChoice = (plan, load, fn, party) => {
      const bp = g.logi.plan, bl = g.logi.load, bt = g.logi.party;
      g.logi.plan = plan; g.logi.load = load;
      if (party) g.logi.party = party;
      const v = fn();
      g.logi.plan = bp; g.logi.load = bl; g.logi.party = bt;
      return v;
    };
    const nowCost = S.logiCost(g, nextTrack);
    const nowRisk = S.logiRisk(g, nextTrack);

    body += '<div class="logi-now"><b>🌍 次戦 ' + nextTrack.country + ' ' + esc(nextTrack.name) +
      '</b><span>距離 ' + (nextTrack.far >= 1.35 ? '★★★ 遠い' :
        nextTrack.far >= 1.0 ? '★★ ふつう' : '★ 近い') +
      '（費用 ×' + nextTrack.far.toFixed(2) + '）</span>' +
      '<span>いまの手配なら <b>💰' + money(nowCost) + '万</b>／遅延の危険 <b class="' +
      (nowRisk > 0.18 ? 'bad' : nowRisk > 0.08 ? 'warn' : 'good') + '">' +
      Math.round(nowRisk * 100) + '%</b></span></div>';

    /* ---- タブ ----
       上の2つ（疲労と次戦の費用）は、どのタブでも見えている。
       三つの選択が合わさって、あの数字になるので            */
    const LT = [['plan', '🚚', '運びかた'], ['load', '📦', '積荷'],
                ['crew', '🧑‍🔧', '編成'], ['kit', '🧰', '装備']];
    body += '<div class="tabs qtabs bastabs">' + LT.map(t =>
      '<button class="tab' + (logiTab === t[0] ? ' on' : '') + '" data-ltab="' + t[0] + '">' +
      t[1] + ' ' + t[2] + '</button>').join('') + '</div>';

    if (logiTab === 'plan') {
    body += '<div class="sub">運びかた</div><div class="pick">';
    D.LOGI_PLANS.forEach(pl => {
      const cost = withChoice(pl.key, g.logi.load, () => S.logiCost(g, nextTrack));
      const risk = withChoice(pl.key, g.logi.load, () => S.logiRisk(g, nextTrack));
      const on = pl.key === cur.key;
      // 払えない手配は結べない。赤字のまま次戦に向かわせない
      const poor = !on && cost > g.funds;
      body += '<button class="pickbtn' + (on ? ' on' : '') + (poor ? ' done' : '') +
        '" data-k="logi:' + pl.key + '"' + (poor ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:' + pl.color + '">' + pl.icon + '</span>' +
        '<span class="pb-body"><b>' + pl.name + (on ? '　<em class="free">選択中</em>' : '') + '</b>' +
        '<small>' + pl.desc + '<br>' +
        'クルーの疲労 ' + (pl.fatigue > 0 ? '+' + pl.fatigue : pl.fatigue) + '／' +
        'マシンの仕上がり ' + (pl.perf === 1 ? '±0' :
          (pl.perf > 1 ? '+' : '') + ((pl.perf - 1) * 100).toFixed(1) + '%') +
        '／遅延 ' + Math.round(risk * 100) + '%' +
        (poor ? '<br><b class="warn">いまの資金では手配できません</b>' : '') +
        '</small></span>' +
        '<span class="pb-cost">💰' + money(cost) + '<br><b>' + esc(pl.note) + '</b></span></button>';
    });
    body += '</div>';

    }

    if (logiTab === 'load') {
    body += '<div class="sub">積荷</div>' +
      '<p class="desc">予備とツールをどれだけ持っていくか。'
      + U.helpLink('logi') + '</p><div class="pick">';
    D.LOGI_LOADS.forEach(ld => {
      const cost = withChoice(g.logi.plan, ld.key, () => S.logiCost(g, nextTrack));
      const risk = withChoice(g.logi.plan, ld.key, () => S.logiRisk(g, nextTrack));
      const on = ld.key === curLoad.key;
      const poor = !on && cost > g.funds;
      body += '<button class="pickbtn' + (on ? ' on' : '') + (poor ? ' done' : '') +
        '" data-k="load:' + ld.key + '"' + (poor ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:' + ld.color + '">' + ld.icon + '</span>' +
        '<span class="pb-body"><b>' + ld.name + (on ? '　<em class="free">選択中</em>' : '') + '</b>' +
        '<small>' + ld.desc + '<br>' +
        (ld.spares ? 'レース後に ' + ld.spares + '点を手当て（+' + D.LOGI_SPARE_FIX + '）'
                   : '<b class="warn">現場での手当てなし</b>') +
        '／パーツの傷み ×' + ld.wear.toFixed(2) +
        '／遅延 ' + Math.round(risk * 100) + '%' +
        (poor ? '<br><b class="warn">いまの資金では積めません</b>' : '') +
        '</small></span>' +
        '<span class="pb-cost">💰' + money(cost) + '<br><b>' + esc(ld.note) + '</b></span></button>';
    });
    body += '</div>';

    }

    // ---- 遠征の編成 ----
    if (logiTab === 'crew') {
      const curP = S.logiCrew(g);
      const mission = S.hasMission(g);
      body += '<div class="sub">遠征の編成</div>' +
        '<p class="desc">誰を現地へ連れて行くか。' + U.helpLink('logi') + '<br>' +
        (mission
          ? '🛰️ <b>ミッションコントロール室</b>があるので、本国に残った分析チームが' +
            '回線の向こうからレースに加わります（作戦の読み +' + D.MISSION.read.toFixed(2) +
            '／天候 +' + Math.round(D.MISSION.fore * 100) + '%）。' +
            '人を減らして薄くなったぶんも ' + Math.round(D.MISSION.leanCover * 100) + '% 埋め戻します。'
          : '本国に残した人間は、いまはレースに関われません。' +
            '「🏭 施設 → ファクトリー」の <b>🛰️ ミッションコントロール室</b>を入れると、' +
            '残った分析チームが回線の向こうからレースに加わります。') +
        '</p><div class="pick">';
      D.LOGI_CREWS.forEach(pt => {
        const cost = withChoice(g.logi.plan, g.logi.load, () => S.logiCost(g, nextTrack), pt.key);
        const eff = withChoice(g.logi.plan, g.logi.load, () => S.crewEff(g), pt.key);
        const stand = withChoice(g.logi.plan, g.logi.load, () => S.pitCrew(g).stand, pt.key);
        const read = withChoice(g.logi.plan, g.logi.load, () => S.readPower(g), pt.key);
        const on = pt.key === curP.key;
        const poor = !on && cost > g.funds;
        body += '<button class="pickbtn' + (on ? ' on' : '') + (poor ? ' done' : '') +
          '" data-k="party:' + pt.key + '"' + (poor ? ' disabled' : '') + '>' +
          '<span class="pb-ic" style="background:' + pt.color + '">' + pt.icon + '</span>' +
          '<span class="pb-body"><b>' + pt.name + (on ? '　<em class="free">選択中</em>' : '') + '</b>' +
          '<small>' + pt.desc + '<br>' +
          'ピット静止 <b>' + stand.toFixed(2) + '秒</b>／作戦の読み <b>' + read.toFixed(2) + '</b>' +
          '／クルーの疲労 ' + (eff.fatigue > 0 ? '+' + eff.fatigue : eff.fatigue) +
          (poor ? '<br><b class="warn">いまの資金では組めません</b>' : '') +
          '</small></span>' +
          '<span class="pb-cost">💰' + money(cost) + '<br><b>' + esc(pt.note) + '</b></span></button>';
      });
      body += '</div>';
    }

    // ---- この先のコースと、かかる費用の見通し ----
    body += '<div class="sub small">この先の遠征</div><div class="logi-cal">';
    for (let k = 0; k < 4; k++) {
      const tk = S.trackAt(g, (g.nextRace + k) % D.RACES);
      const c = S.logiCost(g, tk);
      body += '<span class="lc' + (k === 0 ? ' on' : '') + (tk.far >= 1.35 ? ' far' : '') + '">' +
        tk.country + '<b>' + esc(tk.name.slice(0, 7)) + '</b>' +
        '<em>💰' + money(c) + '</em></span>';
    }
    /* 効いているものを一行に畳む。仕組みの説明はヘルプへ回して、
       ここには「いま何％効いているか」だけを残す                */
    body += '</div><p class="desc">' +
      '🚚 遠征チーム Lv.' + (g.facilities.depot || 1) + '（輸送費 <b>-' +
      Math.round(S.depotCut(g) * 100) + '%</b>／現地の支度 <b>+' +
      ((S.depotSetup(g) - 1) * 100).toFixed(1) + '%</b>）　' +
      '📦 ロジスティシャン <b>' + S.logiPower(g).toFixed(1) + '</b>' +
      (S.perkCut(g, 'logi') > 0
        ? '　✈️ スポンサー割引 <b>-' + Math.round(S.perkCut(g, 'logi') * 100) + '%</b>' : '') +
      U.helpLink('logi') + '</p>';

    if (logiTab === 'kit') body += kitBoxHTML();
    return body;
  }

  /* 遠征のタブを開いたあとの配線 */
  function bindLogi() {
    const nextTrack = S.trackAt(g, g.nextRace) || D.TRACKS[0];
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-ltab]'), b => {
      b.onclick = () => { GP.sound.play('tap'); logiTab = b.dataset.ltab; cmdFacility(); };
    });
    bindKit();
    bindPick(k => {
      const [kind, key] = k.split(':');
      g.logi = g.logi || { plan: 'std', load: 'std', party: 'std', crew: 0 };
      const bp = g.logi.plan, bl = g.logi.load, bt = g.logi.party;
      if (kind === 'logi') g.logi.plan = key;
      else if (kind === 'party') g.logi.party = key;
      else g.logi.load = key;
      if (S.logiCost(g, nextTrack) > g.funds) {   // 払えないものは結べない
        g.logi.plan = bp; g.logi.load = bl; g.logi.party = bt;
        return U.toast('その手配は資金が足りません', 'bad');
      }
      if (kind === 'logi') {
        const pl = S.logiPlan(g);
        U.log(g, '🚚 遠征の手配を「' + pl.icon + pl.name + '」にした。');
      } else {
        const ld = S.logiLoad(g);
        U.log(g, '📦 積荷を「' + ld.icon + ld.name + '」にした。');
      }
      GP.sound.play('confirm');
      S.save(g); render(); drawBase();
    });
  }
  return {
    name: 'home',
    link: link,
    setG: function (v) { g = v; },
    /* openFuse も外へ出しておく。出ていなかったせいで、画面を
       総当たりする検査がここへ一度も入れず、NaN が残っていた   */
    api: { cmdGarage: cmdGarage, garageHTML: garageHTML, bindGarage: bindGarage,
           openFuse: openFuse,
           bindAct: bindAct, puBoxHTML: puBoxHTML, bindPuBox: bindPuBox, cmdFacility: cmdFacility, askKart: askKart, gridPeople: gridPeople, cmdGrid: cmdGrid, refreshGrid: refreshGrid, leaveGrid: leaveGrid, doOffNext: doOffNext, enterOffseason: enterOffseason, weekFlags: weekFlags, yardPeople: yardPeople, yardMark: yardMark, bindHub: bindHub, cmdLogi: cmdLogi }
  };
};

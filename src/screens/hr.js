/* =========================================================
   画面：人事（ドライバー・育成・グループ・首脳陣・講習・FIA）
   main.js から切り出したもの。中身はそのまま動かしていない。
   ほかの画面と共有しているものは、文脈（A）から link() で受け取る。
   ========================================================= */
window.GP = window.GP || {};
GP.screens = GP.screens || {};

GP.screens.hr = function (A) {
  'use strict';
  const D = GP.data, S = GP.state, U = GP.ui, R = GP.race, RV = GP.raceview;
  let g = null;
  /* ほかの画面と main.js から借りているもの。link() で埋まる */
  let $, bindPick, endWeek, esc, grantFame, money, paidChip, render, trustChip, weekFlags;
  function link() {
    $ = A.$;
    bindPick = A.bindPick;
    endWeek = A.endWeek;
    esc = A.esc;
    grantFame = A.grantFame;
    money = A.money;
    paidChip = A.paidChip;
    render = A.render;
    trustChip = A.trustChip;
    weekFlags = A.weekFlags;
  }


  /* =======================================================
     フリーメニュー：人事
     ======================================================= */
  let staffMarket = null, driverMarket = null, youthMarket = null, mgrMarket = null;
  let rivalStaffMarket = null;      // よそのチームで働いている人（引き抜きの相手）
  A.hrTab = 'drivers';        // 人事のいまのタブ（本拠地からも切り替える）

  function teamQuality() { return GP.base.scale(g).value; }

  function refreshMarkets(force) {
    const q = teamQuality();
    if (force || !staffMarket) staffMarket = [0, 1, 2, 3].map(() => S.makeStaff(S.pick(D.STAFF_TYPES).key, q));
    if (force || !driverMarket) driverMarket = [0, 1, 2].map(() =>
      S.makeDriver(1.2 + g.season * 1.4 + S.rnd(-0.6, 1.2),
                   Math.random() < D.PAID.odds ? { paid: true } : {}));
    if (force || !youthMarket) youthMarket = [0, 1, 2].map(() => S.makeYouth(g.season));
    if (force || !mgrMarket) mgrMarket = D.MANAGERS.map(m => S.makeManager(m.key, q));
    if (force || !rivalStaffMarket) rivalStaffMarket = [0, 1, 2].map(() => S.makeRivalStaff(g, q));
  }

  const youthFee = d => Math.round(600 + S.driverRating(d) * 26 + d.pot * 900);
  const staffFee = st => st.salary * 8;
  const mgrFee = m => Math.round(m.salary * 10);

  /* ---- スカウトの見立て ----
     若手の中身は、見る側の目が良いほど正確に分かる。
     ユースアカデミーと育成スタッフ、アナリストの力で誤差が縮む。
     同じ相手には毎回同じ見立てを返す（開き直すたびに変わらない）  */
  function scoutErr() {
    const p = (((g.facilities && g.facilities.youth) || 1) * 1.1
            + S.trainPower(g) * 0.9 + S.analystPower(g) * 0.5) * S.rigMul(g, 'youth');
    return Math.max(0, 10 - p * 1.4);
  }
  function scoutJit(id, k) {
    const str = String(id) + k;
    let h = 7;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100003;
    return (h / 100003) * 2 - 1;
  }
  function scoutStat(d, k, err) {
    const v = d[k] || 0;
    if (err <= 2) return { txt: String(Math.round(v)), lo: v, hi: v, sure: true };
    const mid = v + scoutJit(d.id + k, 'm') * err * 0.6;
    const lo = Math.max(1, Math.round(mid - err / 2));
    const hi = Math.min(199, Math.round(mid + err / 2));
    return { txt: lo + '〜' + hi, lo: lo, hi: hi, sure: false };
  }
  /* 若手1人ぶんの見立て。スカウトの候補にも、抱えている若手にも使う */
  function scoutCardHTML(d, opts) {
    opts = opts || {};
    const err = opts.known ? 0 : scoutErr();
    const KEYS = [['speed', '速さ'], ['technique', '技術'], ['stamina', '体力'], ['mental', '精神']];
    const pt = S.potOf(d);
    const pers = S.persOf(d);
    let pot;
    if (err <= 4) {
      pot = '<em style="color:' + pt.color + '">' + U.stars(d.pot) + ' ' + pt.name + '</em>';
    } else {
      const w = 1;
      const lo = Math.max(1, (d.pot || 1) - w), hi = Math.min(5, (d.pot || 1) + w);
      pot = '<em>' + U.stars(lo) + '〜' + U.stars(hi) + '（' +
        D.POTENTIAL[lo - 1].name + '〜' + D.POTENTIAL[hi - 1].name + '）</em>';
    }
    const rate = KEYS.map(([k]) => scoutStat(d, k, err));
    const ov = err <= 2 ? String(Math.round(S.driverRating(d)))
             : Math.round(rate.reduce((a, r) => a + r.lo, 0) / 4) + '〜' +
               Math.round(rate.reduce((a, r) => a + r.hi, 0) / 4);
    const ct = S.careTier(d);
    // 荒いか手堅いかは、走りを見れば分かる。見立ての精度とは別に出す
    let h = '<span class="sc-head">' + S.nationOf(d).flag + ' ' + d.age + '歳' +
      '　総合 <b>' + ov + '</b>　' + pers.icon + pers.name +
      '　<b style="color:' + ct.color + '" title="' + esc(ct.note) + '">' +
      ct.icon + ct.name + '</b></span>' +
      '<span class="sc-pot">才能 ' + pot + '</span>' +
      '<span class="sc-bars">';
    KEYS.forEach(([k, nm], i) => {
      const r = rate[i];
      h += '<i><u>' + nm + '</u>' +
        '<b class="scb"><s style="width:' + Math.min(100, r.lo / 1.4) + '%"></s>' +
        (r.sure ? '' : '<q style="left:' + Math.min(100, r.lo / 1.4) + '%;width:' +
          Math.min(100 - r.lo / 1.4, (r.hi - r.lo) / 1.4) + '%"></q>') + '</b>' +
        '<em>' + r.txt + '</em></i>';
    });
    h += '</span>';
    if (!opts.known) {
      h += '<span class="sc-note">' + (err <= 2
        ? '🔎 見立ては確かです。'
        : err <= 6 ? '🔎 だいたいの見当はつきます（幅は見立ての誤差）。'
                   : '🔎 まだ目が粗い見立てです。ユースアカデミー・育成スタッフ・' +
                     'アナリストを伸ばすと、この幅が縮みます。') + '</span>';
    }
    return h;
  }

  function youthRow(d, actions) {
    // 自分のところで走らせているので、中身はすっかり分かっている
    return '<div class="pickbtn done youthrow scoutbtn">' +
      '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
      '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' +
      scoutCardHTML(d, { known: true }) + '</small></span>' +
      '<span class="pb-cost">' + actions + '</span></div>';
  }

  /* スタッフ1人の能力表示 */
  /* 固有スキルの札。専門外へ効くものは、どの職能に乗るかも書く */
  function traitChips(st) {
    if (!st.traits || !st.traits.length) return '';
    return '<span class="trchips">' + st.traits.map(k => {
      const t = S.traitOf(k);
      if (!t) return '';
      const to = t.cross ? (D.STAFF_TYPES.find(x => x.key === t.cross) || {}).name : '';
      return '<em class="trchip' + (t.cross ? ' cross' : '') + '" title="' + esc(t.desc) + '">' +
        t.icon + ' ' + t.name + (to ? '<b>→' + to + '</b>' : '') + '</em>';
    }).join('') + '</span>';
  }

  /* この人の「この先」を、段位のはしごとして見せる。
     いまどこにいて、次に何が要るのか、その先に何があるのかを一列に並べる */
  function careerPath(st) {
    const t = D.STAFF_TYPES.find(x => x.key === st.type) || {};
    const cur = S.staffRank(st);
    const cap = S.staffCap(st);
    let h = '<span class="career">';
    D.STAFF_RANKS.forEach(r => {
      const on = r.key === cur.key;
      const done = st.skill >= r.at;
      const far = cap < r.at;
      h += '<i class="cr' + (on ? ' on' : done ? ' done' : '') + (far ? ' far' : '') +
        '" title="' + esc(r.note) + '">' + r.icon + ' ' + (r.prefix || '一人前') +
        (r.at ? '<u>' + r.at + '</u>' : '') + '</i>';
    });
    // その先の首脳陣
    (t.promote || []).forEach(k => {
      const m = D.MANAGERS.find(x => x.key === k);
      if (!m) return;
      h += '<i class="cr mgr' + (cur.key === 'chief' ? ' ready' : '') + '">' +
        m.icon + ' ' + m.name + '</i>';
    });
    h += '</span>';
    const nx = S.nextStaffRank(st);
    if (nx) {
      h += '<span class="careernote">' + (nx.reachable
        ? '次は <b>' + (nx.rank.prefix || '一人前') + '</b>（技能あと ' + Math.ceil(nx.need) + '）。' +
          esc(nx.rank.note)
        : '<b class="warn">伸びしろの上限（' + cap + '）が足りず、' +
          (nx.rank.prefix || '一人前') + 'には届きません。</b>') + '</span>';
    } else {
      h += '<span class="careernote"><b>チーフに到達。「👔 首脳陣」から昇進させられます。</b></span>';
    }
    return h;
  }

  function staffRow(st, actions, extra) {
    const t = D.STAFF_TYPES.find(x => x.key === st.type);
    const cap = S.staffCap(st);
    const pct = Math.min(100, st.skill / cap * 100);
    const rk = S.staffRank(st);
    const pt = S.potOf(st);
    const need = S.staffNeed(st);
    const exPct = Math.min(100, (st.exp || 0) / need * 100);
    const capped = st.skill >= cap;
    return '<div class="pickbtn done staffrow">' +
      '<span class="pb-ic" style="background:#7b5a3a">' + t.icon + '</span>' +
      '<span class="pb-body"><b>' + esc(st.name) +
      '<em class="stitle">' + rk.icon + ' ' + esc(S.staffTitle(st)) + '</em></b>' +
      '<small><em class="sage">' + (st.age || 34) + '歳</em>' +
      '　<em class="spot" style="color:' + pt.color + '">' + U.stars(st.pot || 2) + ' ' + pt.name + '</em>' +
      '　<em class="srank">効き方 ×' + rk.mul.toFixed(2) + '</em>' +
      '<br><span class="skbar"><i style="width:' + pct + '%"></i></span> 技能 <b>' + st.skill +
      '</b> <em class="scap">/ ' + cap + (capped ? '（上限）' : '') + '</em>' +
      '<br><span class="skbar exp"><i style="width:' + exPct + '%"></i></span> ' +
      'Lv.<b>' + (st.expLv || 1) + '</b> <em class="scap">次のレベルまで ' +
      Math.max(0, Math.ceil(need - (st.exp || 0))) + '（レベルが上がると技能 +1〜3）</em>' +
      careerPath(st) +
      '<br>' + t.desc + traitChips(st) + (extra || '') + '</small></span>' +
      '<span class="pb-cost">週' + money(st.salary) + '万<br>' + actions + '</span></div>';
  }

  function cmdStaff() {
    refreshMarkets(false);
    const tabs = [['drivers', '🧑‍✈️ ドライバー'], ['youth', '🎓 育成'],
                  ['staff', '👥 グループ'], ['mgmt', '👔 首脳陣'],
                  ['school', '🏛️ 講習'], ['fia', '🌐 FIA']];
    let body = '<div class="hrtabs">' +
      tabs.map(t => '<button class="hrtab' + (A.hrTab === t[0] ? ' on' : '') + '" data-hr="' + t[0] + '">' + t[1] + '</button>').join('') +
      '</div>';

    if (A.hrTab === 'drivers') body += hrDrivers();
    else if (A.hrTab === 'youth') body += hrYouth();
    else if (A.hrTab === 'staff') body += hrStaff();
    else if (A.hrTab === 'school') body += hrSchool();
    else if (A.hrTab === 'fia') body += hrFIA();
    else body += hrManagement();

    U.modal('👥 人事', body, [
      { label: '🔄 市場を更新（500万）', disabled: g.funds < 500,
        fn: () => { g.funds -= 500; refreshMarkets(true); render(); cmdStaff(); } },
      { label: '閉じる', fn: U.closeModal }
    ], { wide: true });

    Array.prototype.forEach.call($('modalBody').querySelectorAll('.hrtab'), b => {
      b.onclick = () => { A.hrTab = b.dataset.hr; GP.sound.play('tap'); cmdStaff(); };
    });
    bindPick(k => hrPick(k));
    bindHrActions();
    bindSchool();
  }

  /* =======================================================
     エグゼクティブ講習
     人は現場でしか育たない、というのは半分だけ本当で、
     残りの半分は、いちど現場を離れないと身につかない。
     出しているあいだ、その人はチームにほとんど居ない。
     ======================================================= */
  let schoolPick = null;      // いま選んでいる人（'staff:id' か 'mgr:key'）

  function schoolPeople() {
    const out = [];
    D.MANAGERS.forEach(m => {
      const p = g.managers && g.managers[m.key];
      if (p) out.push({ who: 'mgr', id: m.key, p: p, icon: m.icon, role: m.name });
    });
    (g.staff || []).slice().sort((a, b) => b.skill - a.skill).forEach(st => {
      const t = D.STAFF_TYPES.filter(x => x.key === st.type)[0] || {};
      out.push({ who: 'staff', id: st.id, p: st, icon: t.icon || '👤', role: t.name || '' });
    });
    return out;
  }

  function hrSchool() {
    const going = S.schoolList(g);
    let h = '<div class="sub">🏛️ エグゼクティブ講習</div>' +
      '<p class="desc">現場を離れないと身につかないものがあります。' +
      '出しているあいだ、その人の力は <b>' + Math.round(D.SCHOOL.awayMul * 100) +
      '%</b> しか出ません。戻ってきたときに何を持ち帰るかで、出した意味が決まります。<br>' +
      '同時に出せるのは <b>' + D.SCHOOL.slots + '人</b>までです。</p>';

    if (going.length) {
      h += '<div class="schoolgo">' + going.map(e => {
        const c = D.COURSES.filter(x => x.key === e.course)[0] || {};
        return '<div class="sg-row"><i>' + (c.icon || '📘') + '</i>' +
          '<b>' + esc(e.name) + '</b><span>' + esc(c.name || '') + '</span>' +
          '<em>あと' + e.left + '週</em>' +
          '<span class="skbar"><i style="width:' +
          Math.round(100 * (e.weeks - e.left) / Math.max(1, e.weeks)) + '%"></i></span></div>';
      }).join('') + '</div>';
    }

    // 誰を出すか
    const people = schoolPeople().filter(x => !(x.p.away > 0));
    if (!S.schoolOpen(g)) {
      return h + '<p class="note">いまは席が埋まっています。誰かが戻るまで待ちましょう。</p>';
    }
    if (!people.length) {
      return h + '<p class="note">出せる人がいません。</p>';
    }
    if (!schoolPick || !people.some(x => x.who + ':' + x.id === schoolPick)) {
      schoolPick = people[0].who + ':' + people[0].id;
    }
    h += '<div class="sub small">誰を出すか</div><div class="schoolwho" data-swho="1">' +
      people.map(x => {
        const key = x.who + ':' + x.id;
        return '<button class="swbtn' + (key === schoolPick ? ' on' : '') + '" data-v="' + key + '">' +
          x.icon + '<b>' + esc(x.p.name) + '</b><small>' + esc(x.role) +
          '／技能 ' + Math.round(x.p.skill) + (x.p.net ? '／人脈 ' + x.p.net : '') + '</small></button>';
      }).join('') + '</div>';

    const sel = people.filter(x => x.who + ':' + x.id === schoolPick)[0];
    h += '<div class="sub small">どの講習に出すか</div><div class="pick">';
    D.COURSES.forEach(c => {
      const ok = sel && S.courseOpen(g, sel.who, sel.id, c.key) && g.funds >= c.cost;
      const done = sel && (sel.p.courses || []).indexOf(c.key) >= 0;
      const short = sel && (sel.p.skill || 0) < c.need;
      h += '<button class="pickbtn' + (done ? ' done' : '') + '" data-k="sch:' + c.key + '"' +
        (ok ? '' : ' disabled') + '>' +
        '<span class="pb-ic" style="background:#6a5aa8">' + c.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(c.name) +
          (done ? '<em class="gowned">受講済み</em>' : '') + '</b>' +
        '<small>' + esc(c.desc) +
        '<br>技能 <b>+' + c.skill[0] + '〜' + c.skill[1] + '</b>' +
        '／人脈 <b>+' + c.net + '</b>' +
        (c.trait ? '／<b>指導者</b>になることがある' : '') +
        (c.fia ? '／<b>競技団体との関係 +' + c.fia + '</b>' : '') +
        (c.exp ? '／昇進の経験 +' + c.exp : '') +
        '　<b>' + c.weeks + '週</b>不在' +
        (short ? '<br><em class="warn">技能 ' + c.need + ' から受けられます</em>' : '') +
        '</small></span>' +
        '<span class="pb-cost">💰' + money(c.cost) + '</span></button>';
    });
    return h + '</div>';
  }

  function bindSchool() {
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-swho]'), wrap => {
      Array.prototype.forEach.call(wrap.children, b => {
        b.onclick = () => { schoolPick = b.dataset.v; GP.sound.play('tap'); cmdStaff(); };
      });
    });
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-fia]'), b => {
      b.onclick = () => {
        const gain = S.fiaVisit(g);
        if (gain == null) return U.toast('資金が足りません', 'bad');
        U.log(g, '🌐 かつての仲間を訪ねて、競技団体に顔を出した（関係 +' + gain + '）', 'good');
        U.toast('🌐 顔を出してきた', 'good');
        GP.sound.play('confirm');
        S.save(g); render(); cmdStaff();
      };
    });
  }

  function doEnrol(key) {
    if (!schoolPick) return;
    const [who, id] = schoolPick.split(':');
    const r = S.enrol(g, who, who === 'mgr' ? id : +id, key);
    if (!r) return U.toast('いまは出せません', 'bad');
    U.log(g, r.course.icon + ' ' + r.person.name + ' を「' + r.course.name +
      '」へ送り出した（' + r.course.weeks + '週不在）', 'good');
    U.toast(r.course.icon + ' ' + r.person.name + ' が講習へ', 'good');
    GP.sound.play('buy');
    S.save(g); render(); cmdStaff();
  }

  /* =======================================================
     FIA に移った人たち
     うちを離れた人が、そのまま業界から消えるとは限らない。
     何人かは規則を作る側、裁く側に回る。
     どう送り出したかが、何年かあとの車検場で返ってくる。
     ======================================================= */
  function warmLabel(w) {
    if (w >= 40) return { t: 'こっそり味方', c: '#2f7a3a' };
    if (w >= 12) return { t: '好意的', c: '#4f8a45' };
    if (w > -12) return { t: '中立', c: '#7a7264' };
    if (w > -40) return { t: '冷やか', c: '#a86a2a' };
    return { t: '厳しい', c: '#b03a2a' };
  }

  function hrFIA() {
    const list = g.fia || [];
    const fav = S.fiaFavor(g);
    const lb = warmLabel(Math.round(fav * D.FIA.perPerson));
    let h = '<div class="sub">🌐 競技団体にいる、かつての仲間</div>' +
      '<p class="desc">うちを離れた人が、そのまま業界から消えるとは限りません。' +
      '何人かは競技団体に入り、<b>規則を作る側、裁く側</b>に回ります。' +
      'どう送り出したかが、何年かあとの車検場で返ってきます。</p>';
    if (!list.length) {
      return h + '<p class="note">いまのところ、向こうに知った顔はいません。</p>';
    }
    h += '<div class="fiabox"><span>いまの間柄 <b style="color:' + lb.c + '">' + lb.t + '</b></span>' +
      '<span>照会の来やすさ <b>' + (fav > 0 ? '-' : '+') +
        Math.round(Math.abs(fav) * D.FIA.tdRisk * 100) + '%</b></span>' +
      '<span>不問になる確率 <b>' + (fav >= 0 ? '+' : '') +
        Math.round(fav * D.FIA.dismiss * 100) + '%</b></span>' +
      '<span>提訴の通りやすさ <b>' + (fav >= 0 ? '+' : '') +
        Math.round(fav * D.FIA.appeal * 100) + '%</b></span>' +
      '<span>レース中の裁定 <b>' + (fav > 0 ? '-' : '+') +
        Math.round(Math.abs(fav) * D.FIA.pen * 100) + '%</b></span></div>';
    h += '<div class="fialist">' + list.slice().sort((a, b) => b.warm - a.warm).map(x => {
      const w = warmLabel(x.warm);
      return '<div class="fia-row"><i style="background:' + w.c + '"></i>' +
        '<b>' + esc(x.name) + '</b><span>' + esc(x.role) + '</span>' +
        '<em style="color:' + w.c + '">' + w.t + '</em>' +
        '<small>' + esc(x.why || '') + '（S' + x.since + '〜）</small></div>';
    }).join('') + '</div>';
    h += '<p class="desc">恩も恨みも、そのままでは続きません。毎シーズン、気持ちは中立へ戻っていきます。<br>' +
      '「国際モータースポーツ課程」に人を出すと、同じ教室で顔を合わせるぶん関係が温まります。</p>' +
      '<div class="pick"><button class="pickbtn" data-fia="1"' +
      (g.funds >= D.FIA.visitCost ? '' : ' disabled') + '>' +
      '<span class="pb-ic" style="background:#3f6f8a">🤝</span>' +
      '<span class="pb-body"><b>顔を出しに行く</b><small>' +
      'かつての仲間を訪ねる。全員との関係が <b>+' + D.FIA.visitWarm + '</b> 温まります' +
      '（週は使いません）</small></span>' +
      '<span class="pb-cost">💰' + money(D.FIA.visitCost) + '</span></button></div>';
    return h;
  }

  /* ---- ドライバー ---- */
  /* ---- 安定感（危うい〜完璧主義）の見かた ----
     ドライバーカードに出ている札が何を意味するのか、
     数字の効きまで含めて一箇所で説明しておく               */
  function careLegendHTML() {
    return '<div class="sub small">🎚️ 安定感の見かた</div>' +
      '<p class="desc">同じ速さでも、限界の手前で止められる人と、' +
      '踏み越えてしまう人がいます。速さと引き換えの性質なので、' +
      '<b>危うい人ほど素の速さは高い</b>ことが多いです。' +
      'レアリティの高いドライバーだけが、速さと安定感を両方持ちます。</p>' +
      '<div class="carelegend">' +
      D.CARE_TIERS.map((t, i) => {
        const lo = i === 0 ? 0 : D.CARE_TIERS[i - 1].max;
        return '<div class="cl-row"><i style="background:' + t.color + '">' + t.icon + '</i>' +
          '<b>' + t.name + '</b>' +
          '<em>' + lo + (t.max >= 999 ? '〜' : '〜' + t.max) + '</em>' +
          '<span>' + esc(t.note) + '</span></div>';
      }).join('') + '</div>' +
      '<p class="desc">高いほど<b>クラッシュとミスが減ります</b>。' +
      '性格と、車体の<b>ドライバビリティ</b>でも上下します。' +
      U.helpLink('people') + '</p>';
  }

  function hrDrivers() {
    let body = '<div class="sub">所属ドライバー（' + g.drivers.length + '/2）</div>' +
      '<div class="trustrow">' + g.drivers.map(d =>
        '<span class="tr-one">' + esc(d.name) + ' ' + trustChip(d) + '</span>').join('') +
      '</div>' +
      '<p class="desc">🗣️ <b>ピットへの信頼</b>は、言ったことが結果として返ってきたかどうかで動きます。' +
      U.helpLink('people') + '</p>' +
      '<div class="pick">';
    g.drivers.forEach(d => {
      body += '<div class="pickbtn done">' +
        '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' + S.nationOf(d).flag + ' 総合 ' +
        Math.round(S.driverRating(d)) + '／' + d.age + '歳／' + S.persOf(d).icon + S.persOf(d).name +
        '<br>' + U.skillChips(d) + paidChip(d) + '</small></span>' +
        '<span class="pb-cost">週' + money(d.salary) + '万' +
        (d.paid ? '<br><b class="paidin">毎戦 +' + money(d.paid.per) + '</b>' : '') +
        '<br><button class="mini danger" data-fired="' + d.id + '">解雇</button></span></div>';
    });
    body += '</div>';
    body += careLegendHTML();

    // ---- リザーブドライバー ----
    body += '<div class="sub">🪑 リザーブドライバー</div>' +
      '<p class="desc">万一のときに走る控えです。給料は正ドライバーの ' +
      Math.round(S.RESERVE_PAY * 100) + '%。事故で負傷したドライバーの代役に入ります。<br>' +
      '<b>シートが空いていればそのまま正ドライバーに昇格</b>させられますし、' +
      'いまの正ドライバーと入れ替えることもできます（給料は正ドライバーの額になります）。</p><div class="pick">';
    if (g.reserve) {
      const r = g.reserve;
      const openSeat = g.drivers.length < 2;
      const full = Math.round((r.speed + r.technique + r.stamina + r.mental) / 4 * 0.95 + 18);
      const acts = (openSeat
          ? '<button class="mini good" data-promres="1">⬆ 正ドライバーに昇格</button>'
          : '') +
        g.drivers.map(d =>
          '<button class="mini" data-swapres="' + d.id + '">' + esc(d.name) +
          'と入れ替えて昇格</button>').join('');
      body += '<div class="pickbtn done">' +
        '<span class="pb-ic face-ic">' + U.face(r, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(r.name) + '</b><small>' + S.nationOf(r).flag + ' 総合 ' +
        Math.round(S.driverRating(r)) + '／' + r.age + '歳／' + S.persOf(r).icon + S.persOf(r).name +
        (r.outFor > 0 ? '　<em class="warn">負傷欠場 あと' + r.outFor + '戦</em>' : '') +
        '<br>' + U.skillChips(r) +
        '<br>昇格すると 週' + money(r.salary) + '万 → <b>週' + money(full) + '万</b>' +
        (openSeat ? '（いまシートが1つ空いています）' : '') + '</small></span>' +
        '<span class="pb-cost">週' + money(r.salary) + '万<br>' + acts +
        '<button class="mini danger" data-relres="1">解除</button></span></div>';
    } else {
      body += '<p class="desc">リザーブはいません。下部組織の若手か、市場のドライバーを置けます。</p>';
      (g.youth || []).forEach(d => {
        body += '<div class="pickbtn done youthrow">' +
          '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
          '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' + S.nationOf(d).flag + ' ' +
          d.age + '歳／総合 ' + Math.round(S.driverRating(d)) + '（下部組織）</small></span>' +
          '<span class="pb-cost"><button class="mini" data-tores="' + d.id + '">リザーブへ</button></span></div>';
      });
    }
    body += '</div>';

    // ---- 育成の若手 ----
    // フルタイムと育成は地続き。同じ画面で、いま誰が控えているかが見える
    const ys = g.youth || [];
    body += '<div class="sub">🎓 育成の若手（' + ys.length + '/' + S.youthSlots(g) + '）</div>';
    if (!ys.length) {
      body += '<p class="desc">下部組織に誰もいません。「🎓 育成」から探せます。' +
        'ここで育てた子が、上のフルタイムの席を埋めます。</p>';
    } else {
      body += '<p class="desc">上の席が空いたとき、ここから昇格させられます。' +
        '手を入れるのは「🎓 育成」から。</p><div class="pick">';
      ys.slice().sort((a, b) => S.driverRating(b) - S.driverRating(a)).forEach(d => {
        const p2 = S.potOf(d);
        body += '<div class="pickbtn done"><span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
          '<span class="pb-body"><b>' + esc(d.name) + '<em class="ychip">' + d.age + '歳</em></b>' +
          '<small>総合 <b>' + Math.round(S.driverRating(d)) + '</b>' +
          '　速さ ' + Math.round(d.speed) + '／技術 ' + Math.round(d.technique) +
          '／体力 ' + Math.round(d.stamina) + '／精神 ' + Math.round(d.mental) +
          '　<em style="color:' + p2.color + '">' + U.stars(d.pot || 2) + ' ' + p2.name + '</em>' +
          '</small></span><span class="pb-cost">週' + money(d.salary) + '万</span></div>';
      });
      body += '</div>';
    }
    body += '<div class="sub">ドライバー市場</div><div class="pick">';
    driverMarket.forEach((d, i) => {
      const fee = Math.round(d.salary * 12);
      const full = g.drivers.length >= 2;
      body += '<button class="pickbtn" data-k="dm:' + i + '"' + ((full || g.funds < fee) ? ' disabled' : '') + '>' +
        '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' + S.nationOf(d).flag + ' 総合 ' +
        Math.round(S.driverRating(d)) + '／' + d.age + '歳／' + S.persOf(d).icon + S.persOf(d).name +
        '<br>速' + Math.round(d.speed) + ' 技' + Math.round(d.technique) + ' 体' + Math.round(d.stamina) + ' 精' + Math.round(d.mental) +
        '<br>' + U.skillChips(d) + paidChip(d) + '</small></span>' +
        '<span class="pb-cost">' +
        (d.paid ? '<b class="paidin">持参金<br>+' + money(d.paid.dowry) + '</b><br>' : '') +
        '契約金<br>💰' + money(fee) +
        (g.reserve ? '' : '<br><button class="mini" data-mktres="' + i + '">リザーブへ</button>') +
        '</span></button>';
    });
    return body + '</div>';
  }

  /* ---- 下部組織 ---- */
  function hrYouth() {
    const slots = S.youthSlots(g);
    let body = careLegendHTML() +
      '<div class="sub">🎓 下部組織（' + (g.youth || []).length + '/' + slots + '）</div>' +
      '<p class="desc">若手は毎週すこしずつ成長します。ユースアカデミーを拡張すると' +
      '伸びが速くなり、抱えられる人数も増えます。24歳を過ぎると伸びしろがなくなります。</p>' +
      '<div class="whybox"><b>🎓 自分で育てると、何が得なのか</b>' +
      '<span>📈 <b>伸びる</b>　市場で買うドライバーはもう伸びません。若手だけが、毎週上がっていきます</span>' +
      '<span>💴 <b>安い</b>　昇格しても給料は市場価格より低いままです。浮いたぶんは開発に回せます</span>' +
      '<span>🤝 <b>離れにくい</b>　自分たちで育てた人は、よそから声がかかっても靡きにくい</span>' +
      '<span>🛞 <b>金曜に乗せられる</b>　フリー走行の「ルーキーを走らせる」は、若手がいないと選べません</span>' +
      '</div>' +
      '<div class="whybox alt"><b>💼 逆に、金がないときは</b>' +
      '<span>ドライバー市場には、<b>持参金つき</b>のドライバーが混じります。腕は' +
      Math.round((1 - D.PAID.skill) * 100) + '%ほど落ちますが、契約した日にまとまった金が入り、' +
      '毎戦も持ち込みがあります。給料も安い。<br>' +
      'そのかわり、実力で選んでいないぶん<b>話題としては割り引かれ</b>、速さでは戦えません。' +
      '席をひとつ金に換えて、その金でマシンを速くする、という選び方です。</span></div>' +
      '<div class="pick">';
    if (!(g.youth || []).length) body += '<p class="desc">育成中の若手はいません。</p>';
    (g.youth || []).forEach(d => {
      body += youthRow(d,
        '<button class="mini" data-promote="' + d.id + '"' + (g.drivers.length < 2 ? '' : ' disabled') + '>昇格</button>' +
        '<button class="mini danger" data-release="' + d.id + '">放出</button>');
    });
    body += '</div><div class="sub">若手スカウト</div><div class="pick">';
    youthMarket.forEach((d, i) => {
      const fee = youthFee(d);
      const full = (g.youth || []).length >= slots;
      body += '<button class="pickbtn scoutbtn" data-k="ym:' + i + '"' + ((full || g.funds < fee) ? ' disabled' : '') + '>' +
        '<span class="pb-ic face-ic">' + U.face(d, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b><small>' +
        scoutCardHTML(d) + '</small></span>' +
        '<span class="pb-cost">💰' + money(fee) + '</span></button>';
    });
    return body + '</div>';
  }

  /* ---- 現場スタッフ ---- */
  /* ---- グループ ----
     職種の一覧ではなく、実際に仕事をしている単位で見せる。
     グループの中の噛み合いと、グループ同士の相補作用を、
     そのまま数字と言葉で出す                                      */
  /* =======================================================
     人の輪
     マシンと同じ読みかたで、チームの中身を多重の輪にする。
     中心＝チーム、内＝首脳陣、外＝各セクション、いちばん外＝ドライバー。
     線は「誰が誰を見ているか」と「セクションどうしの噛み合い」。
     ドライバーの節は、持っている力をどれだけ車に出せているか。
     ======================================================= */
  /* =======================================================
     人 → 部門 → 効き目

     もとは多重の輪だったが、輪には向きがないので
     「誰のおかげで、何が良くなっているのか」が読めなかった。
     左から右へ、人・上司・効き目の順に並べると、
     線を追うだけで因果がたどれる。
     棒の長さがそのまま出ている力で、いちばん短い行が伸ばしどころ。
     ======================================================= */
  const CHAIN_ROWS = [
    { k: 'engineer',   nm: '開発',   ic: '👷', to: '車の改良が速く進む' },
    { k: 'designer',   nm: '設計',   ic: '🎨', to: '作るパーツの格が上がる' },
    { k: 'analyst',    nm: 'データ', ic: '📊', to: '開発・作戦・育成をまとめて底上げ' },
    { k: 'researcher', nm: '研究',   ic: '🔬', to: '研究テーマが早く進む' },
    { k: 'mechanic',   nm: 'ピット', ic: '🔩', to: '静止時間が縮み、信頼性が上がる' },
    { k: 'strategist', nm: '作戦',   ic: '🧠', to: '路面とストップ数を読み切れる' },
    { k: 'trainer',    nm: '育成',   ic: '💪', to: 'ドライバーが速く伸びる' },
    { k: 'logi',       nm: '物流',   ic: '📦', to: '輸送費と遅れが減る' }
  ];

  function orgChainHTML(g2) {
    const o = S.org(g2);
    const DEPT = D.ORG.DEPT;
    const staff = g2.staff || [];
    const rows = CHAIN_ROWS.map(r => {
      const bossKey = DEPT[r.k] || 'principal';
      const boss = D.MANAGERS.find(m => m.key === bossKey) || {};
      const who = staff.filter(x => x.type === r.k);
      return { r: r, boss: boss, bossKey: bossKey, who: who,
               lead: o.lead[bossKey] || 1, out: o.dept[r.k] || 0 };
    });
    const top = Math.max.apply(null, rows.map(x => x.out).concat([1]));
    const thin = rows.slice().sort((a, b) => a.out - b.out)[0];

    let h = '<p class="desc">左から右へ読んでください。' +
      '<b>雇った人</b>が<b>部門の力</b>になり、それが<b>右のこと</b>を良くします。' +
      '途中の<b>👔 上司</b>は、その部門ぜんぶに掛け算で効きます' +
      '（部下がいない部門では、掛けるものがないので空回りします）。<br>' +
      'いま<b>いちばん短いのは ' + thin.r.ic + ' ' + thin.r.nm + '</b>です。' +
      '同じ人件費なら、ここに足すのがいちばん伸びます。</p>' +
      '<div class="chain">';
    rows.forEach(x => {
      const n = x.who.length;
      const sk = n ? Math.round(x.who.reduce((a, s2) => a + s2.skill, 0) / n) : 0;
      const mgrOn = (S.mgr(g2, x.bossKey) || 0) > 0;
      h += '<div class="chrow' + (n ? '' : ' empty') + (x === thin ? ' thin' : '') + '">' +
        // 人
        '<span class="ch-who">' + x.r.ic + '<b>' + n + '人</b>' +
          (n ? '<i>技能' + sk + '</i>' : '<i class="ng">空</i>') + '</span>' +
        '<span class="ch-ar">→</span>' +
        // 上司
        '<span class="ch-boss' + (mgrOn ? ' on' : '') + '" title="' + esc(x.boss.name || '') + '">' +
          (x.boss.icon || '👔') + '<i>' + (mgrOn ? '×' + x.lead.toFixed(2) : '空席') + '</i>' +
          // 開発責任者だけは、コンセプトとの相性が設計に直に効く
          (x.bossKey === 'technical' && mgrOn
            ? '<u class="fitdot ' + (S.mgrFit(g2, 'technical') > 0 ? 'good'
              : S.mgrFit(g2, 'technical') < 0 ? 'bad' : '') + '"></u>' : '') +
          '</span>' +
        '<span class="ch-ar">→</span>' +
        // 部門の力
        '<span class="ch-nm">' + x.r.nm + '</span>' +
        '<span class="ch-bar"><i style="width:' +
          Math.round(Math.max(2, x.out / top * 100)) + '%"></i></span>' +
        '<b class="ch-out">' + x.out.toFixed(1) + '</b>' +
        // せまい画面では「効き目」が下の行に落ちるので、この矢印だけ消す
        '<span class="ch-ar tail">→</span>' +
        '<span class="ch-to">' + esc(x.r.to) + '</span>' +
        '</div>';
    });
    return h + '</div>';
  }

  function groupsHTML() {
    const gt = S.groupTable(g);
    let h = '';
    D.GROUP_PLACES.forEach(pl => {
      const mine = gt.list.filter(x => x.def.place === pl.key);
      const tot = mine.reduce((a, x) => a + x.total, 0);
      const n = mine.reduce((a, x) => a + x.members.length, 0);
      h += '<div class="sub">' + pl.icon + ' ' + pl.name +
        '<em class="gsum">' + n + '人／力 ' + tot.toFixed(1) + '</em></div>' +
        '<p class="desc">' + esc(pl.desc) + '</p>';
      mine.forEach(x => {
        const d = x.def;
        const bar = Math.min(100, x.total / 16 * 100);
        h += '<div class="grpbox">' +
          '<div class="grp-h"><b>' + d.icon + ' ' + d.name + '</b>' +
          '<span class="grp-n">' + x.members.length + '人</span>' +
          '<i class="grp-bar"><b style="width:' + bar + '%"></b></i>' +
          '<em class="grp-v">' + x.total.toFixed(1) + '</em></div>' +
          '<small class="grp-d">' + esc(d.desc) + '</small>' +
          '<div class="grp-mul">' +
            '<span>素の力 <b>' + x.raw.toFixed(1) + '</b></span>' +
            '<span class="' + (x.mul > 1 ? 'up' : x.mul < 1 ? 'down' : '') + '">中の噛み合い <b>×' +
              x.mul.toFixed(2) + '</b></span>' +
            '<span class="' + (x.lift > 0.005 ? 'up' : '') + '">ほかのグループから <b>+' +
              Math.round(x.lift * 100) + '%</b></span>' +
          '</div>';
        x.notes.forEach(nt => {
          // 「誰の、何が、どれだけ」を一列に出す。
          // 理由だけ書かれても、どこを直せばいいのか分からない
          const amt = nt.amt == null ? '' :
            '<em class="gn-amt">' + (nt.amt > 0 ? '+' : '−') +
            Math.round(Math.abs(nt.amt) * 100) + '%</em>';
          h += '<div class="grp-note' + (nt.bad ? ' bad' : '') + '">' + nt.icon + ' ' +
            (nt.who ? '<b>' + esc(nt.who) + '</b>　' : '') +
            (nt.why ? '<u>' + esc(nt.why) + '</u>　' : '') + amt +
            '<span class="gn-t">' + esc(nt.text) + '</span></div>';
        });
        if (!x.members.length) {
          h += '<div class="grp-note bad">🕳️ ここに人がいない。' + esc(d.desc) + 'が丸ごと抜けている</div>';
        }
        h += '<div class="pick grp-mem">';
        x.members.slice().sort((a, b) => b.skill - a.skill).forEach(st => {
          const roles = S.promotableRoles(g, st);
          const up = roles.map(r => {
            const m = D.MANAGERS.find(y => y.key === r);
            return '<button class="mini good" data-promote-staff="' + st.id + ':' + r + '">' +
              m.icon + ' ' + m.name + 'へ</button>';
          }).join('');
          h += staffRow(st,
            up + '<button class="mini danger" data-firestaff="' + st.id + '">解雇</button>',
            st.skill >= S.PROMOTE_MIN && !roles.length ? '<br><em class="warn">昇進先が埋まっています</em>' : '');
        });
        h += '</div></div>';
      });
    });
    // 人 → 部門 → 効き目
    h += '<div class="sub">🔗 人が、どこに効いているか</div>' + orgChainHTML(g);

    // 相補作用
    h += '<div class="sub">🤝 グループ同士の相補作用</div>' +
      '<p class="desc">両方のグループが育っているときだけ効きます。' +
      '片方が空だと、いくらもう片方を厚くしても何も起きません。</p><div class="synlist">';
    /* 車の部位と同じ形の話なので、同じ絵で見せる。
       画面が変わっても読みかたを覚え直さなくて済む            */
    gt.syn.slice().sort((a, b) => (b.on - a.on) || (b.gain - a.gain)).forEach(x => {
      const A = gt.byKey(x.a), B = gt.byKey(x.b);
      const sa = gt.scores[x.a] || 0, sb = gt.scores[x.b] || 0;
      const aWeak = sa <= sb;
      const W = aWeak ? A : B;
      // 満ちる目安は半減値の2倍。そこまで来ればほぼ効きが出きっている
      const full = Math.max(0.5, x.def.half * 2);
      const nm = o => o.def.short || o.def.name.replace('グループ', '');
      h += '<div class="mlrow' + (x.on ? ' on' : '') + '">' +
        '<div class="ml-t"><span class="ml-ic">' + x.def.icon + '</span>' +
        '<b>' + esc(x.def.name) + '</b>' +
        '<em class="ml-pct' + (x.on ? ' on' : '') + '">' +
        (x.on ? '+' + (x.gain * 100).toFixed(1) + '%' : '—') + '</em></div>' +
        '<div class="ml-body">' +
        U.coupling({
          aIcon: A.def.icon, aName: nm(A), aColor: '#7b6a4a', aFill: sa / full,
          bIcon: B.def.icon, bName: nm(B), bColor: '#7b6a4a', bFill: sb / full,
          ratio: x.def.gain > 0 ? x.gain / x.def.gain : 0, on: x.on, aWeak: aWeak
        }) +
        '<div class="ml-side"><small>' + esc(x.def.desc) + '</small>' +
        '<div class="ml-weak">' + (x.on && x.gain >= x.def.gain * 0.9
          ? '<span class="ok">✔ ここは回りきっています</span>'
          : '<span class="ng">' + W.def.icon + ' <b>' + esc(nm(W)) +
            '</b> の手が足りていません。ここに人を入れると回りはじめます</span>') +
        '</div></div></div></div>';
    });
    h += '</div>';
    return h;
  }

  function hrStaff() {
    const q = teamQuality();
    let body = '<p class="lead">チームの規模が大きいほど、腕の良い人材が応募してきます。' +
      '<br>いまの規模：<b>' + GP.base.scale(g).rank + '</b></p>' + orgBoxHTML();
    body += groupsHTML();
    body += '<p class="desc">技能が上がると肩書きが変わります：' +
      D.STAFF_RANKS.map(r => r.icon + (r.prefix || '一人前') + (r.at ? '（' + r.at + '）' : '')).join(' → ') +
      '。<br><b>チーフ</b>まで来た人は「👔 首脳陣」の空いている役職へ昇進させられます。' +
      '同じ職種にチーフがいると、その下の人が育つのも早くなります。</p>';
    body += '<div class="deptgrid" style="display:none">';
    body += '</div>';
    /* ---- 置ける席 ----
       腕の良い人が来るかどうかは規模の話、何人置けるかは建物の話 */
    const room = S.staffRoom(g);
    body += '<div class="sub">スタッフ市場' +
      '<span class="slotchip' + (room <= 0 ? ' full' : '') + '">' +
      (g.staff || []).length + ' / ' + S.staffSlots(g) + '人</span></div>' +
      '<p class="desc">' + (room > 0
        ? 'あと <b>' + room + '人</b> 置けます。'
        : '<b class="warn">席が埋まっています。</b>') +
      '席の数は施設のレベルで増えます（' + D.STAFF_SLOTS.per +
      'レベルぶん伸ばすごとに1席）。どの施設を伸ばしても構いません。</p>' +
      '<div class="pick">';
    staffMarket.forEach((st, i) => {
      const fee = staffFee(st);
      body += '<button class="pickbtn" data-k="sm:' + i + '"' +
        (g.funds < fee || room <= 0 ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:#7b5a3a">' +
        (D.STAFF_TYPES.find(x => x.key === st.type) || {}).icon + '</span>' +
        '<span class="pb-body"><b>' + esc(st.name) + '</b><small>' +
        (D.STAFF_TYPES.find(x => x.key === st.type) || {}).name + '／技能 ' + st.skill +
        '　' + (st.age || 34) + '歳　<em style="color:' + S.potOf(st).color + '">' +
        U.stars(st.pot || 2) + ' ' + S.potOf(st).name + '</em>' +
        '<br><span class="skbar"><i style="width:' + Math.min(100, st.skill / S.staffCap(st) * 100) + '%"></i></span>' +
        traitChips(st) +
        '</small></span><span class="pb-cost">💰' + money(fee) + '<br><em>週' + money(st.salary) + '</em></span></button>';
    });
    body += '</div>';

    // ---- よそのチームから引き抜く ----
    body += '<div class="sub">🕵️ 他チームのスタッフを引き抜く</div>' +
      '<p class="desc">市場の応募者より腕が立つかわりに、要る金は高くつきます。' +
      U.helpLink('people') +
      (room > 0 ? '' : '<br><b class="warn">こちらも、席が空いていないと連れて来られません。</b>') +
      '</p><div class="pick">';
    rivalStaffMarket.forEach((st, i) => {
      const fee = S.poachFee(g, st);
      const t = D.STAFF_TYPES.find(x => x.key === st.type) || {};
      body += '<button class="pickbtn" data-k="ps:' + i + '"' +
        (g.funds < fee || room <= 0 ? ' disabled' : '') + '>' +
        '<span class="pb-ic" style="background:#8a4a3a">' + t.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(st.name) + '</b><small>' +
        t.name + '／技能 ' + st.skill + '　' + (st.age || 34) + '歳　<em class="fromteam">' + esc(st.team) + '</em>' +
        '　<em style="color:' + S.potOf(st).color + '">' + U.stars(st.pot || 2) + '</em>' +
        '<br><span class="skbar"><i style="width:' + Math.min(100, st.skill / S.staffCap(st) * 100) + '%"></i></span>' +
        traitChips(st) +
        '</small></span><span class="pb-cost">引き抜き<br>💰' + money(fee) + '<br><em>週' + money(st.salary) + '</em></span></button>';
    });
    return body + '</div>';
  }

  /* ---- 首脳陣 ---- */
  /* 役職に技能◯の人を据えたら、実際に何がどれだけ変わるか。
     説明文ではなく、いまゲームが使っている式から数字を出す。
     こうしないと「誰を据えるべきか」が比べられない            */
  function mgrEffect(role, skill) {
    const n = Math.max(0, skill || 0);
    const o = S.org(g);
    const pc = v => (v >= 0 ? '+' : '') + v.toFixed(v < 10 ? 1 : 0) + '%';
    // 部門長は「部下の力を何割増しにするか」。掛ける相手がいなければ空回りする
    const lift = n * D.ORG.lead * 100;
    const under = keys => keys.reduce((a, k) => a + o.raw[k], 0);
    const deptRows = (keys, label) => {
      const have = under(keys);
      return [
        [label + 'の効き', pc(lift)],
        ['いまの部下', have.toFixed(1) + (have < 1.0 ? '（ほぼ空回り）' : '')],
        ['実際の上乗せ', '+' + (have * lift / 100).toFixed(2)]
      ];
    };
    if (role === 'principal') return [
      ['スポンサー収入', pc(n * 0.6)],
      ['注目度の伸び', pc(n * 0.4)],
      ['育成部門の効き', pc(lift)]
    ];
    if (role === 'technical') return deptRows(['engineer', 'designer', 'analyst'], '技術部門');
    if (role === 'pitchief') return deptRows(['mechanic', 'strategist'], '現場部門');
    if (role === 'logistics') return [
      ['週の運営費', '-' + Math.min(45, n * 1.0).toFixed(0) + '%'],
      ['輸送費', '-' + Math.min(45, n * 1.2).toFixed(0) + '%'],
      ['荷の遅延', '-' + Math.min(70, n * 2.0).toFixed(0) + '%'],
      ['クルーの疲労', '-' + Math.min(50, n * 1.0).toFixed(0) + '%']
    ];
    return [];
  }
  const effChips = (role, skill) => '<span class="mgeffs">' +
    mgrEffect(role, skill).map(e => '<em>' + e[0] + ' <b>' + e[1] + '</b></em>').join('') + '</span>';

  /* ---- 部門のかみ合い ----
     どの部門も、単体の足し算では出せない力を出している。
     何が何に掛かっているのかを、そのまま数字で見せる            */
  function orgBoxHTML() {
    const o = S.org(g);
    const D2 = D.ORG.DEPT;
    const bossOf = k => D.MANAGERS.find(m => m.key === (D2[k] || 'principal')) || {};
    const rows = [
      { k: 'engineer',   nm: '開発',   ic: '👷', out: S.devPower(g),   data: true },
      { k: 'designer',   nm: '設計',   ic: '🎨', out: S.designPower(g), data: false },
      { k: 'mechanic',   nm: 'ピット', ic: '🔩', out: S.pitPower(g),   data: false },
      { k: 'strategist', nm: '作戦',   ic: '🧠', out: S.readPower(g),  data: true },
      { k: 'trainer',    nm: '育成',   ic: '💪', out: S.trainPower(g), data: true },
      { k: 'analyst',    nm: 'データ', ic: '📊', out: S.analystPower(g), data: false }
    ];
    const top = Math.max.apply(null, rows.map(r => r.out).concat([1]));
    // いちばん細いところ。そこを厚くすると、全体がいちばん伸びる
    const thin = rows.slice().sort((a, b) => a.out - b.out)[0];
    let h = '<div class="orgbox"><b>🏢 部門のかみ合い</b>' +
      '<small>部門はそれぞれ独立していません。<b>上司は部下に掛かり</b>、' +
      '<b>データは開発・作戦・育成に掛かり</b>、<b>現場の疲れは作戦の実行力を削り</b>ます。' +
      '同じ人件費でも、噛み合わせ次第で出る力が変わります。</small>' +
      '<div class="orglist">';
    rows.forEach(r => {
      const boss = bossOf(r.k);
      const lead = o.lead[D2[r.k] || 'principal'];
      h += '<div class="orgrow">' +
        '<span class="or-nm">' + r.ic + ' ' + r.nm + '</span>' +
        '<span class="or-bar"><i style="width:' +
          Math.round(Math.max(3, r.out / top * 100)) + '%"></i></span>' +
        '<b class="or-out">' + r.out.toFixed(1) + '</b>' +
        '<span class="or-chain">' + o.raw[r.k].toFixed(1) +
          ' <em>×</em> ' + boss.icon + (lead).toFixed(2) +
          (r.data ? ' <em>×</em> 📊' + o.dataMul.toFixed(2) : '') +
        '</span></div>';
    });
    h += '</div>' +
      '<div class="orgnote">' +
        '<span>📊 データが回っている <b>' + Math.round(o.data * 100) + '%</b>' +
          '（開発・作戦・育成 <b>×' + o.dataMul.toFixed(2) + '</b>）</span>' +
        '<span>🧑‍🔧 現場の余力 <b>' + Math.round(o.ready * 100) + '%</b>' +
          '（作戦をどれだけ実際に打てるか）</span>' +
      '</div>' +
      '<small>いま細いのは <b>' + thin.ic + ' ' + thin.nm + '</b>。' +
      'ここを厚くすると、掛かっている先までまとめて伸びます。</small>' +
      '</div>';
    return h;
  }

  function hrManagement() {
    let body = '<p class="lead">役職は1人ずつ。据えると<b>その部門の人が出す力に掛かります</b>。<br>' +
      '各役職に、<b>自前のスタッフからの昇進</b>と<b>外からの招聘</b>を並べてあります。' +
      '数字は「その技能なら、いまの部下に対して実際にどれだけ効くか」です。</p>' +
      orgBoxHTML();

    D.MANAGERS.forEach(m => {
      const cur = g.managers && g.managers[m.key];
      body += '<div class="sub">' + m.icon + ' ' + m.name + '</div>' +
        '<p class="desc">' + m.desc + '</p><div class="pick">';

      // ---- 現任 ----
      if (cur) {
        body += '<div class="pickbtn done mgmtrow">' +
          '<span class="pb-ic" style="background:#8a5a2a">' + m.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(cur.name) + '<em class="nowchip">現任</em></b>' +
          '<small><span class="skbar"><i style="width:' + Math.min(100, cur.skill / 60 * 100) + '%"></i></span> 技能 <b>' + cur.skill + '</b>' +
          effChips(m.key, cur.skill) + '</small></span>' +
          '<span class="pb-cost">週' + money(cur.salary) + '万<br>' +
          '<button class="mini danger" data-firemgr="' + m.key + '">解任</button></span></div>';
      }

      // ---- 自前のスタッフからの昇進 ----
      const ups = (g.staff || []).filter(st => S.promotableRoles(g, st).indexOf(m.key) >= 0)
        .sort((a, b) => b.skill - a.skill);
      ups.forEach(st => {
        const after = Math.max(10, Math.round(st.skill * 0.85));
        const sal = Math.round(m.salary * (0.6 + after / 30));
        const diff = cur ? after - cur.skill : null;
        const t = D.STAFF_TYPES.find(x => x.key === st.type) || {};
        body += '<div class="pickbtn mgmtrow up">' +
          '<span class="pb-ic" style="background:#4a7a3a">⬆</span>' +
          '<span class="pb-body"><b>' + esc(st.name) + '<em class="upchip">昇進</em></b>' +
          '<small>' + t.name + '（技能 ' + st.skill + '）→ ' + m.name + ' <b>技能 ' + after + '</b>' +
          (diff !== null ? '（現任と<em class="' + (diff > 0 ? 'good' : 'bad') + '">' +
            (diff > 0 ? '+' : '') + diff + '</em>）' : '') +
          '<br><span class="skbar"><i style="width:' + Math.min(100, after / 60 * 100) + '%"></i></span>' +
          effChips(m.key, after) +
          '<br><em class="warn">現場からは1人減ります（' + t.name + ' の厚み -' +
          (st.skill / 20).toFixed(1) + '）</em></small></span>' +
          '<span class="pb-cost">契約金なし<br><em>週' + money(sal) + '</em><br>' +
          '<button class="mini good" data-promote-staff="' + st.id + ':' + m.key + '">昇進させる</button>' +
          '</span></div>';
      });

      // ---- 外からの招聘 ----
      mgrMarket.forEach((cand, i) => {
        if (cand.role !== m.key) return;
        const fee = mgrFee(cand);
        const diff = cur ? cand.skill - cur.skill : null;
        const poor = g.funds < fee;
        body += '<button class="pickbtn mgmtrow" data-k="mm:' + i + '"' + (poor ? ' disabled' : '') + '>' +
          '<span class="pb-ic" style="background:#8a5a2a">' + m.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(cand.name) + '<em class="hirechip">招聘</em></b>' +
          '<small>技能 <b>' + cand.skill + '</b>' +
          (diff !== null ? '（現任と<em class="' + (diff > 0 ? 'good' : 'bad') + '">' +
            (diff > 0 ? '+' : '') + diff + '</em>）' : '') +
          '<br><span class="skbar"><i style="width:' + Math.min(100, cand.skill / 60 * 100) + '%"></i></span>' +
          effChips(m.key, cand.skill) +
          (poor ? '<br><em class="warn">いまの資金では契約できません</em>' : '') +
          '</small></span>' +
          '<span class="pb-cost">💰' + money(fee) + '<br><em>週' + money(cand.salary) + '</em></span></button>';
      });

      if (!cur && !ups.length && !mgrMarket.some(c => c.role === m.key)) {
        body += '<p class="desc">いまは空席です。技能 ' + S.PROMOTE_MIN +
          ' 以上のスタッフが育つか、市場に候補が出るのを待ちましょう' +
          '（「🔄 市場を更新」で入れ替わります）。</p>';
      }
      body += '</div>';
    });
    return body;
  }

  /* ---- 操作 ---- */
  function hrPick(k) {
    if (k.indexOf('sch:') === 0) return doEnrol(k.slice(4));
    const parts = k.split(':');
    const kind = parts[0], idx = +parts[1];
    if (kind === 'dm') {
      const d = driverMarket[idx], fee = Math.round(d.salary * 12);
      if (g.drivers.length >= 2 || g.funds < fee) return;
      g.funds -= fee; d.team = g.team; g.drivers.push(d);
      driverMarket.splice(idx, 1);
      if (d.paid) {
        g.funds += d.paid.dowry;
        U.log(g, '💼 ' + d.paid.icon + ' ' + d.paid.name + ' から持参金 +' +
          money(d.paid.dowry) + '万。' + d.paid.line, 'good');
        U.pop('💼 +' + money(d.paid.dowry), 'good');
      }
      U.log(g, '🧑‍✈️ ' + d.name + ' と契約した！', 'good');
      S.pushNews(g, 'drvIn', d.name);
      U.toast('🧑‍✈️ ' + d.name + ' が加入！', 'good');
    } else if (kind === 'ym') {
      const d = youthMarket[idx], fee = youthFee(d);
      if ((g.youth || []).length >= S.youthSlots(g) || g.funds < fee) return;
      g.funds -= fee;
      g.youth = (g.youth || []).concat([d]);
      youthMarket.splice(idx, 1);
      GP.sound.play('confirm');
      U.log(g, '🎓 若手の ' + d.name + '（' + S.potOf(d).name + '）を獲得した！', 'good');
      U.toast('🎓 ' + d.name + ' が下部組織に加入！', 'good');
    } else if (kind === 'sm') {
      const st = staffMarket[idx], fee = staffFee(st);
      if (g.funds < fee || S.staffRoom(g) <= 0) return;
      g.funds -= fee; g.staff.push(st);
      staffMarket.splice(idx, 1);
      U.log(g, '👥 ' + st.name + ' を雇用した。（技能 ' + st.skill + '）', 'good');
      U.toast('👥 ' + st.name + ' が加入！', 'good');
    } else if (kind === 'ps') {
      const st = rivalStaffMarket[idx];
      if (!st) return;
      const fee = S.poachFee(g, st);
      if (g.funds < fee || S.staffRoom(g) <= 0) return;
      g.funds -= fee;
      const from = st.team;
      delete st.team;
      g.staff.push(st);
      rivalStaffMarket.splice(idx, 1);
      GP.sound.play('crit');
      U.log(g, '🕵️ ' + from + ' から ' + st.name + '（技能 ' + st.skill + '）を引き抜いた！', 'good');
      U.toast('🕵️ ' + st.name + ' を引き抜いた！', 'good');
    } else if (kind === 'mm') {
      const cand = mgrMarket[idx], fee = mgrFee(cand);
      if (g.funds < fee) return;
      const m = D.MANAGERS.find(x => x.key === cand.role);
      const cur = g.managers && g.managers[cand.role];
      g.funds -= fee;
      g.managers = g.managers || {};
      g.managers[cand.role] = cand;
      mgrMarket.splice(idx, 1);
      GP.sound.play('levelup');
      U.log(g, '👔 ' + m.name + ' に ' + cand.name + ' が就任！（技能 ' + cand.skill + '）' +
        (cur ? ' ' + cur.name + ' は退任した。' : ''), 'good');
      U.toast('👔 ' + m.name + '：' + cand.name + ' が就任！', 'good');
    }
    S.save(g); render(); cmdStaff();
  }

  function bindHrActions() {
    const body = $('modalBody');
    Array.prototype.forEach.call(body.querySelectorAll('[data-promote]'), b => {
      b.onclick = () => {
        const d = S.promoteYouth(g, b.dataset.promote);
        if (!d) return;
        GP.sound.play('levelup');
        U.log(g, '🎉 ' + d.name + ' がトップチームに昇格！ デビュー戦が待っている。', 'good');
        U.toast('🎉 ' + d.name + ' が昇格！', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-tores]'), b => {
      b.onclick = () => {
        const d = (g.youth || []).find(x => x.id === b.dataset.tores);
        if (!d || g.reserve) return;
        g.youth = g.youth.filter(x => x.id !== b.dataset.tores);
        S.setReserve(g, d);
        GP.sound.play('confirm');
        U.log(g, '🪑 ' + d.name + ' をリザーブドライバーにした。', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-mktres]'), b => {
      b.onclick = ev => {
        ev.stopPropagation();
        const d = driverMarket[+b.dataset.mktres];
        if (!d || g.reserve) return;
        const fee = Math.round(d.salary * 12 * S.RESERVE_PAY);
        if (g.funds < fee) return U.toast('資金が足りません', 'bad');
        g.funds -= fee;
        driverMarket.splice(+b.dataset.mktres, 1);
        S.setReserve(g, d);
        GP.sound.play('confirm');
        U.log(g, '🪑 ' + d.name + ' とリザーブ契約を結んだ（契約金 ' + money(fee) + '万）。', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-promres]'), b => {
      b.onclick = () => {
        const d = S.promoteReserve(g);
        if (!d) return;
        GP.sound.play('levelup');
        U.log(g, '🎉 リザーブの ' + d.name + ' が正ドライバーに昇格！（週' +
                 money(d.salary) + '万）', 'good');
        U.toast('🎉 ' + d.name + ' が正ドライバーに！', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-swapres]'), b => {
      b.onclick = () => {
        const r = S.swapReserve(g, b.dataset.swapres);
        if (!r) return;
        GP.sound.play('levelup');
        U.log(g, '🔁 ' + r.inD.name + ' が正ドライバーに、' + r.outD.name + ' がリザーブに回った。', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-relres]'), b => {
      b.onclick = () => {
        const d = S.clearReserve(g);
        if (!d) return;
        U.log(g, '👋 リザーブの ' + d.name + ' との契約を解除した。');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-promote-staff]'), b => {
      b.onclick = () => {
        const [id, role] = b.dataset.promoteStaff.split(':');
        const r = S.promoteStaff(g, id, role);
        if (!r) return;
        const m = D.MANAGERS.find(x => x.key === role);
        GP.sound.play('levelup');
        U.log(g, '👔 ' + r.name + ' が ' + m.name + ' に昇進した！（技能 ' + r.skill +
                 '／週' + money(r.salary) + '万）', 'good');
        U.toast('👔 ' + r.name + ' が' + m.name + 'に昇進！', 'good');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-release]'), b => {
      b.onclick = () => {
        const d = (g.youth || []).find(x => x.id === b.dataset.release);
        if (!d) return;
        g.youth = g.youth.filter(x => x.id !== b.dataset.release);
        U.log(g, '👋 若手の ' + d.name + ' を放出した。');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-fired]'), b => {
      b.onclick = () => {
        const d = g.drivers.find(x => x.id === b.dataset.fired);
        if (!d) return;
        g.funds -= d.salary * 6;
        g.drivers = g.drivers.filter(x => x.id !== b.dataset.fired);
        U.log(g, '👋 ' + d.name + ' との契約を解除した（違約金 ' + money(d.salary * 6) + '万）。');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-firestaff]'), b => {
      b.onclick = () => {
        const st = g.staff.find(x => x.id === b.dataset.firestaff);
        if (!st) return;
        g.funds -= st.salary * 4;
        g.staff = g.staff.filter(x => x.id !== b.dataset.firestaff);
        U.log(g, '👋 ' + st.name + ' を解雇した（違約金 ' + money(st.salary * 4) + '万）。');
        S.save(g); render(); cmdStaff();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-firemgr]'), b => {
      b.onclick = () => {
        const key = b.dataset.firemgr;
        const cur = g.managers && g.managers[key];
        if (!cur) return;
        g.funds -= cur.salary * 6;
        delete g.managers[key];
        const m = D.MANAGERS.find(x => x.key === key);
        U.log(g, '👋 ' + m.name + ' の ' + cur.name + ' を解任した（違約金 ' + money(cur.salary * 6) + '万）。');
        S.save(g); render(); cmdStaff();
      };
    });
  }

  /* ---- 引き抜きの申し出。引き止めるか、送り出すか ---- */
  function askPoach(raid) {
    const t = D.STAFF_TYPES.find(x => x.key === raid.type) || {};
    const canPay = g.funds >= raid.keep;
    const body = '<p class="lead">' + esc(raid.from) + ' が <b>' + esc(raid.name) + '</b>' +
      '（' + t.icon + t.name + '／技能 ' + raid.skill + '）に声をかけています。</p>' +
      '<p class="desc">引き止めるには支度金が要り、そのあとの給料も上がります。' +
      '送り出せば、その腕はライバルのものになります。</p>' +
      '<div class="poachbox"><span>💰 引き止めの支度金</span><b>' + money(raid.keep) + '万</b></div>' +
      '<div class="poachbox"><span>📈 これからの給料</span><b>+' +
        Math.round((raid.raise - 1) * 100) + '%</b></div>' +
      (canPay ? '' : '<p class="note">いまの資金では引き止められません。</p>');
    let settled = false, prevClose = null;
    const finish = fn => {
      if (settled) return;
      settled = true;
      if (prevClose !== null) $('modalClose').onclick = prevClose;   // ✕を元に戻す
      fn(); U.closeModal(); endWeek();
    };
    U.modal('🕵️ 引き抜きの申し出', body, [
      { label: '引き止める', cls: 'primary', disabled: !canPay, fn: () => finish(() => {
          g.funds -= raid.keep;
          S.keepStaff(g, raid.id, raid.raise);
          GP.sound.play('confirm');
          U.log(g, '🤝 ' + raid.name + ' を引き止めた（支度金 ' + money(raid.keep) + '万）。', 'good');
          U.toast('🤝 ' + raid.name + ' は残ってくれた', 'good');
          const st2 = (g.staff || []).filter(x => x.id === raid.id)[0];
          if (st2) st2.wasKept = (st2.wasKept || 0) + 1;   // 引き止められた記憶は残る
        }) },
      { label: '送り出す', fn: () => finish(() => {
          const who = (g.staff || []).filter(x => x.id === raid.id)[0];
          S.loseStaff(g, raid.id);
          GP.sound.play('dnf');
          U.log(g, '👋 ' + raid.name + ' が ' + raid.from + ' へ移籍した…', 'bad');
          U.toast('👋 ' + raid.name + ' が去った', 'bad');
          noteFIA(who || { name: raid.name, type: raid.type }, D.FIA.warmCold,
                  '引き止めてもらえなかった');
        }) }
    ]);
    // ✕で閉じたときも「送り出す」と同じ扱いにする（週が飛ばないように）
    prevClose = $('modalClose').onclick;
    $('modalClose').onclick = () => finish(() => {
      const who = (g.staff || []).filter(x => x.id === raid.id)[0];
      S.loseStaff(g, raid.id);
      U.log(g, '👋 ' + raid.name + ' が ' + raid.from + ' へ移籍した…', 'bad');
      noteFIA(who || { name: raid.name, type: raid.type }, D.FIA.warmCold,
              '引き止めてもらえなかった');
    });
  }

  /* 去っていった人が、何年かして裁く側に現れることがある。
     どう送り出したかが、そのときの目つきになる               */
  function noteFIA(person, warm, why) {
    if (!person) return;
    const rec = S.joinFIA(g, person, warm, why);
    if (!rec) return;
    U.log(g, '🌐 ' + rec.name + ' が競技団体に入ったらしい（' + rec.role + '）。' +
      (rec.warm >= 12 ? 'こちらには、まだ悪くない顔を向けてくれている。'
       : rec.warm <= -12 ? 'あの別れ方では、甘くは見てもらえないだろう。'
       : '仕事は仕事、という顔をしている。'), rec.warm >= 12 ? 'good' : 'warn');
  }

  /* ---- ライバルのドライバーへの接触 ----
     一度で決まる話ではない。レースウィークごとに接触して心証を積み上げ、
     十分に傾いたところで移籍金を積んで引き抜く。                     */
  function poachInterest(d, team) {
    const track = S.trackAt(g, g.nextRace);
    const table = S.constructorTable(g);
    const myRank = table.findIndex(t => t.isPlayer) + 1;
    const theirRank = table.findIndex(t => t.name === team.name) + 1;
    // 上のチームからは来にくい。下のチームからは来やすい
    const rankPull = theirRank > 0 && myRank > 0 ? (theirRank - myRank) * 3.4 : 0;
    const fame = S.hypeTier(g).idx != null ? 0 : 0;
    return { rankPull: rankPull, myRank: myRank, theirRank: theirRank, track: track };
  }

  function poachFee(d, team) {
    const rating = S.driverRating(d);
    const table = S.constructorTable(g);
    const theirRank = Math.max(1, table.findIndex(t => t.name === team.name) + 1);
    // 強い選手ほど、上位チームに所属しているほど高い
    return Math.round((rating * 62 + (12 - theirRank) * 180 + 600)
                      * Math.max(0.55, 1 - S.osk(g, 'nego') * 0.06));   // 交渉術
  }

  function doPoach(d, team) {
    weekFlags();
    const key = 'poach:' + team.name + ':' + d.name;
    const info = poachInterest(d, team);
    if (d.interest == null) d.interest = 0;
    const already = (g.talked || []).indexOf(key) >= 0;
    const rating = Math.round(S.driverRating(d));
    const p = S.persOf(d);
    const fee = poachFee(d, team);

    const head =
      '<div class="quote">' + U.face(d, 40) + '<span><b>' + esc(d.name) + '</b>' +
      '<br><small>' + esc(team.name) + ' ／ ' + d.age + '歳 ／ 総合 ' + rating +
      ' ／ 給料 ' + money(d.salary) + '万/週</small></span></div>' +
      '<div class="reqrow"><span>心証</span><i><b style="width:' +
        Math.round(S.clamp(d.interest, 0, 100)) + '%"></b></i><em>' +
        Math.round(d.interest) + ' / 100</em></div>' +
      '<p class="desc">' + esc(p.icon + p.name + '／' + p.desc) + '</p>';

    const rows = [];
    // 心証が十分なら、移籍金を積んで誘える
    if (d.interest >= 60) {
      const canPay = g.funds >= fee;
      const full = g.drivers.length >= 2;
      rows.push({
        label: '💰 ' + money(fee) + '万で誘う', cls: 'primary',
        disabled: !canPay,
        fn: () => offerSeat(d, team, fee)
      });
      if (full) rows.push({ label: '（移籍には枠の入れ替えが要ります）', disabled: true, fn: () => {} });
    }
    if (!already) {
      rows.push({
        label: '🤝 話をする', cls: d.interest >= 60 ? '' : 'primary',
        fn: () => {
          // 自分のほうが上位なら心証は上がりやすい。下位だと響かない
          const up = S.clamp((6 + info.rankPull + S.rnd(-2, 5) + S.hypeBonus(g) * 4 - 4)
                             * (1 + S.osk(g, 'nego') * 0.12), -3, 26);   // 交渉術
          d.interest = S.clamp(d.interest + up, 0, 100);
          g.talked.push(key);
          S.save(g);
          U.closeModal();
          U.toast('🤝 心証 ' + (up >= 0 ? '+' : '') + Math.round(up), up >= 0 ? 'good' : 'bad');
          U.log(g, '🤝 ' + d.name + ' に接触した（心証 ' + Math.round(d.interest) + '）');
          render();
        }
      });
    }
    rows.push({ label: '戻る', fn: U.closeModal });

    const hint = already
      ? '<p class="note">今週はもう話した。次のレースウィークにまた来よう。</p>'
      : (info.rankPull < 0
          ? '<p class="note">相手のほうが上位のチームにいる。心証は上がりにくい。</p>'
          : '<p class="note">こちらのほうが上位。話は聞いてもらえそうだ。</p>');

    U.modal('🤝 ' + esc(d.name),
      head + hint +
      '<p class="desc">心証が <b>60</b> を超えると、移籍金を積んで誘えます。' +
      '移籍金の目安は <b>💰' + money(fee) + '万</b>。' +
      'いまの資金は ' + money(g.funds) + '万です。</p>',
      rows);
  }

  /* 引き抜きの実行。枠が埋まっていれば、誰と入れ替えるかを選ぶ */
  function offerSeat(d, team, fee) {
    if (g.funds < fee) return U.toast('資金が足りません', 'bad');
    const doSign = (outId) => {
      g.funds -= fee;
      if (outId != null) {
        const out = g.drivers.find(x => x.id === outId);
        g.drivers = g.drivers.filter(x => x.id !== outId);
        if (out) U.log(g, '👋 ' + out.name + ' との契約を解除した。');
      }
      // 相手チームから引き抜き、向こうには代役が入る
      team.drivers = team.drivers.filter(x => x !== d);
      const rep = S.makeDriver(Math.max(6, S.driverRating(d) * 0.82));
      rep.team = team.name;
      team.drivers.push(rep);
      d.team = g.team;
      d.interest = 100;
      d.seasonPoints = 0;
      g.drivers.push(d);
      U.closeModal();
      U.log(g, '🤝 ' + d.name + ' の獲得に成功した！（移籍金 ' + money(fee) + '万）', 'good');
      grantFame(D.fameOf('poach'), '他チームから引き抜いた');
      U.toast('🤝 ' + d.name + ' が加入！', 'good');
      GP.sound.play('good');
      GP.paddock.invalidate();
      S.save(g); render();
    };
    if (g.drivers.length < 2) return doSign(null);
    // 枠が埋まっているので、放出する側を選ぶ
    let body = '<p class="lead">' + esc(d.name) + ' を迎えるには、いまの2人のうち一人と契約を解除する必要があります。</p>' +
      '<div class="pick">';
    g.drivers.forEach(x => {
      body += '<button class="pickbtn" data-k="out:' + x.id + '">' +
        '<span class="pb-ic face-ic">' + U.face(x, 30) + '</span>' +
        '<span class="pb-body"><b>' + esc(x.name) + ' を放出</b>' +
        '<small>' + x.age + '歳／総合 ' + Math.round(S.driverRating(x)) +
        '／給料 ' + money(x.salary) + '万/週</small></span></button>';
    });
    body += '</div>';
    U.modal('🤝 ' + esc(d.name) + ' の獲得', body, [{ label: 'やめる', fn: U.closeModal }]);
    bindPick(k => { if (k.indexOf('out:') === 0) doSign(k.slice(4)); });
  }

  /* ---- 他チームのガレージを覗く ----
     自分より速いマシンほど学べるものが多い。分析担当がいると読み取れる量が増える。
     同じレースウィークでは1チームにつき1回まで。                       */
  function doScout(r) {
    weekFlags();
    const track = S.trackAt(g, g.nextRace);
    const mine = S.carScoreOf(S.carStats(g), track);
    const theirs = S.carScoreOf(r.stats, track);
    if ((g.scouted || []).indexOf(r.name) >= 0) {
      return U.modal('👀 ' + esc(r.name) + ' のガレージ',
        '<p class="lead">今週はもう十分に見せてもらった。</p>' +
        '<p class="desc">同じチームからは、レースウィークごとに一度しか学べません。</p>',
        [{ label: '戻る', fn: U.closeModal }]);
    }
    const analyst = S.analystPower(g);
    // 差がそのまま学びになる。自分のほうが速ければ得るものは少ない
    const edge = Math.max(0, theirs - mine);
    const eye = S.osk(g, 'eye');
    const gain = Math.max(1, Math.round((edge * 0.30 + analyst * 0.5 + S.rnd(0, 1.5))
                                        * (1 + eye * 0.25)));   // 技術眼
    g.rp += gain;
    g.scouted.push(r.name);
    GP.paddock.invalidate();
    S.save(g);
    U.renderTop(g);            // ×で閉じても数字が合うように、先に上部バーを更新する
    const cmp = edge > 12 ? 'こちらより明らかに速い。学べることが多い。'
              : edge > 4 ? 'いくつか気になる工夫がある。'
              : 'こちらのほうが進んでいる。得るものは少ない。';
    U.modal('👀 ' + esc(r.name) + ' のガレージ',
      '<div class="intwrap"><canvas id="scoutCv" width="' + GP.paddock.W +
        '" height="120"></canvas></div>' +
      '<p class="lead">' + esc(cmp) + '</p>' +
      '<div class="bigbox">研究ポイント <b>+' + gain + '</b></div>' +
      '<p class="desc">相手のマシンがこのコースでどれだけ速いかで、学べる量が変わります。' +
      '分析担当を雇うと読み取れる量が増えます。</p>',
      [{ label: 'なるほど', cls: 'primary', fn: () => { U.closeModal(); render(); } }]);
    // 覗いたマシンを描く
    const cv = $('scoutCv');
    if (cv) {
      const c2 = cv.getContext('2d');
      c2.imageSmoothingEnabled = false;
      c2.fillStyle = '#2a2436'; c2.fillRect(0, 0, cv.width, cv.height);
      c2.fillStyle = 'rgba(255,236,180,.14)'; c2.fillRect(0, 0, cv.width, 26);
      c2.save();
      c2.translate(cv.width / 2, 78); c2.scale(3.4, 3.4);
      GP.raceview.paintCar(c2, 0, 0, 0, r.color,
        Math.min(5, Math.max(0, Math.round((theirs - 12) / 26))), 0);
      c2.restore();
    }
    U.log(g, '👀 ' + r.name + ' のガレージを覗いた。研究ポイント +' + gain);
    GP.sound.play('good');
  }
  return {
    name: 'hr',
    link: link,
    setG: function (v) { g = v; },
    api: { refreshMarkets: refreshMarkets, scoutCardHTML: scoutCardHTML, cmdStaff: cmdStaff, askPoach: askPoach, doPoach: doPoach, doScout: doScout }
  };
};

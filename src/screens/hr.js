/* =========================================================
   画面：人事（ドライバー・育成・スタッフグループ・首脳陣・講習・FIA）
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
  A.hrTab = 'staff';          // 人事（働く人）のいまのタブ
  A.drvTab = 'drivers';       // ドライバー（走る人）のいまのタブ（本拠地からも切り替える）
  let hrMode = 'staff';       // いま開いているのがどちらか。再描画はこれに従う

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

  /* ---- 部門ごとの求人 ----
     応募者はチーム全体で4人しか来ない。どの職種で来るかは運なので、
     「開発の人が欲しい」と思っても何週も来ないことがあった。
     ここは職種を決めて出す金。その部門の候補だけ入れ替わる      */
  function scoutStaffType(typeKey) {
    const q = teamQuality();
    const rest = (staffMarket || []).filter(st => st.type !== typeKey);
    const add = [];
    for (let i = 0; i < D.STAFF_SCOUT.n; i++) add.push(S.makeStaff(typeKey, q));
    staffMarket = rest.concat(add);
  }

  /* その部門の候補だけを入れ替える釦。市場の小窓の中から押せる */
  function scoutBtn(groupKey, again) {
    const G = D.GROUPS.filter(x => x.key === groupKey)[0];
    if (!G) return null;
    const cost = D.STAFF_SCOUT.cost;
    const has = (staffMarket || []).some(st => st.type === G.of);
    return {
      label: (has ? '🔄 ' : '🔎 ') + G.icon + (has ? 'の候補を入れ替える' : 'の候補を探す') +
        '（' + money(cost) + '万）',
      disabled: g.funds < cost,
      fn: () => {
        if (g.funds < cost) return;
        g.funds -= cost;
        scoutStaffType(G.of);
        GP.sound.play('confirm');
        U.log(g, '🔎 ' + G.name + ' の求人を出した（💰' + money(cost) + '万）。新しい応募者が来た');
        U.toast('🔎 ' + G.name + ' に応募者', 'good');
        S.save(g); render();
        U.closePopup();
        again();
      }
    };
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

  /* ---- 人事とドライバー ----
     働く人（スタッフグループ・首脳陣・講習・FIA）と、走る人（契約・練習・育成）は
     主題がちがう。前は「人事」に6枚あり、「ドライバー」のハブにも同じ2枚が
     あって、同じ物に入口が2つあった。画面を2つに分け、
     買った・雇ったあとの開き直しは、いま開いているほうに従う      */
  const HR_TABS = {
    staff: [['staff', '👥 スタッフグループ'], ['mgmt', '👔 首脳陣'],
            ['school', '🏛️ 講習'], ['fia', '🌐 FIA']],
    drv:   [['drivers', '🧑‍✈️ 契約'], ['train', '💪 練習'], ['youth', '🎓 育成']]
  };
  function cmdStaff() { hrMode = 'staff'; openHr(); }
  function cmdDrivers() { hrMode = 'drv'; openHr(); }
  function reopenHr() { openHr(); }
  function openHr() {
    refreshMarkets(false);
    const drv = hrMode === 'drv';
    const tabs = HR_TABS[hrMode];
    const keys = tabs.map(t => t[0]);
    let cur = drv ? A.drvTab : A.hrTab;
    if (keys.indexOf(cur) < 0) cur = keys[0];
    if (drv) A.drvTab = cur; else A.hrTab = cur;
    let body = '<div class="hrtabs">' +
      tabs.map(t => '<button class="hrtab' + (cur === t[0] ? ' on' : '') + '" data-hr="' + t[0] + '">' + t[1] + '</button>').join('') +
      '</div>';

    if (cur === 'drivers') body += hrDrivers();
    else if (cur === 'train') body += A.trainHTML();
    else if (cur === 'youth') body += hrYouth();
    else if (cur === 'staff') body += hrStaff();
    else if (cur === 'school') body += hrSchool();
    else if (cur === 'fia') body += hrFIA();
    else body += hrManagement();

    const btns = [];
    if (cur !== 'train') btns.push(
      { label: '🔄 市場を更新（500万）', disabled: g.funds < 500,
        fn: () => {
          g.funds -= 500; refreshMarkets(true);
          U.log(g, '🔄 市場を更新した（💰500万）。顔ぶれが入れ替わった');
          S.save(g); render(); reopenHr();
        } });
    btns.push({ label: '閉じる', fn: U.closeModal });
    U.modal(drv ? '🧑‍✈️ ドライバー' : '👥 人事', body, btns, { wide: true });

    Array.prototype.forEach.call($('modalBody').querySelectorAll('.hrtab'), b => {
      b.onclick = () => {
        if (drv) A.drvTab = b.dataset.hr; else A.hrTab = b.dataset.hr;
        GP.sound.play('tap'); reopenHr();
      };
    });
    // 練習の配線は dev.js の側。bindPick を二重に掛けないよう、ここで抜ける
    if (cur === 'train') { A.bindTrain(); return; }
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
        b.onclick = () => { schoolPick = b.dataset.v; GP.sound.play('tap'); reopenHr(); };
      });
    });
    Array.prototype.forEach.call($('modalBody').querySelectorAll('[data-fia]'), b => {
      b.onclick = () => {
        const gain = S.fiaVisit(g);
        if (gain == null) return U.toast('資金が足りません', 'bad');
        U.log(g, '🌐 かつての仲間を訪ねて、競技団体に顔を出した（関係 +' + gain + '）', 'good');
        U.toast('🌐 顔を出してきた', 'good');
        GP.sound.play('confirm');
        S.save(g); render(); reopenHr();
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
    S.save(g); render(); reopenHr();
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

  /* =======================================================
     ドライバーの席と、その小窓

     施設・備品と同じ形。タブに出すのは「席」だけにして、
     誰を迎えるか・誰を出すか・いまの誰と比べてどうかは、
     押したあとの小窓でまとめて決める。
     ======================================================= */
  const DKEYS = [['speed', '速さ'], ['technique', '技術'],
                 ['stamina', '体力'], ['mental', '精神']];

  function seatList() {
    return [
      { key: 'full', icon: '🏎️', name: 'フルタイム', cap: 2,
        list: (g.drivers || []).slice(),
        note: '日曜に走る2人。ここが空いていると出走できません' },
      { key: 'res', icon: '🪑', name: 'リザーブ', cap: 1,
        list: g.reserve ? [g.reserve] : [],
        note: '負傷の代役。給料は正ドライバーの ' +
              Math.round(S.RESERVE_PAY * 100) + '%で、席が空けばそのまま昇格できます' },
      { key: 'youth', icon: '🎓', name: '育成の若手', cap: S.youthSlots(g),
        list: ((g.youth || []).slice().sort((a, b) => S.driverRating(b) - S.driverRating(a))),
        note: '下部組織。ここで育てた子が、上の席を埋めます' }
    ];
  }
  function seatOf(key) { return seatList().filter(x => x.key === key)[0]; }

  /* 候補と、いまの面々を能力ごとに並べる。
     「入れたらどうなるか」は、隣に並べないと分からない  */
  function cmpTableHTML(cand, others, candLabel) {
    if (!others.length) return '';
    let h = '<div class="cmpwrap"><table class="cmptbl"><tr><th></th>' +
      '<th class="c-cand">' + esc(candLabel || (cand.name || '').slice(0, 5)) + '</th>' +
      others.map(o => '<th>' + esc((o.name || '').slice(0, 5)) + '</th>').join('') + '</tr>';
    const row = (label, get, dg) => {
      const cv = get(cand);
      h += '<tr><td>' + label + '</td><td class="c-cand"><b>' + cv.toFixed(dg) + '</b></td>' +
        others.map(o => {
          const ov = get(o);
          const d = cv - ov;
          const cls = d > 0.05 ? 'up' : d < -0.05 ? 'down' : '';
          return '<td>' + ov.toFixed(dg) +
            '<em class="' + cls + '">' + (d >= 0 ? '+' : '') + d.toFixed(dg) + '</em></td>';
        }).join('') + '</tr>';
    };
    row('総合', d => S.driverRating(d), 0);
    DKEYS.forEach(k => row(k[1], d => d[k[0]] || 0, 0));
    row('週給', d => d.salary || 0, 0);
    return h + '</table></div>';
  }

  /* ひとりぶんの見出し（顔・名前・素性） */
  function drvHeadHTML(d, sub) {
    const p2 = S.persOf(d);
    return '<div class="popsum"><span class="pb-ic face-ic">' + U.face(d, 34) + '</span>' +
      '<span class="popsum-b"><b>' + esc(d.name) + '</b>' +
      '<small>' + S.nationOf(d).flag + ' ' + d.age + '歳　' + p2.icon + ' ' + esc(p2.name) +
      '　総合 <b>' + Math.round(S.driverRating(d)) + '</b>' + (sub ? '<br>' + sub : '') +
      '</small></span></div>' +
      '<p class="desc">' + U.skillChips(d) + paidChip(d) + '</p>';
  }

  /* ---- 席の小窓 ---- */
  function openSeat(key) {
    const st = seatOf(key);
    if (!st) return;
    let h = '<div class="popsum"><span class="pb-ic" style="background:#5a6270">' + st.icon +
      '</span><span class="popsum-b"><b>' + esc(st.name) + '</b>' +
      '<small>' + st.list.length + ' / ' + st.cap + '人</small></span></div>' +
      '<p class="desc">' + esc(st.note) + '</p>';
    if (st.list.length) {
      h += '<div class="pick">';
      st.list.forEach(d => {
        h += '<button class="pickbtn" data-drvpop="' + d.id + '">' +
          '<span class="pb-ic face-ic">' + U.face(d, 28) + '</span>' +
          '<span class="pb-body"><b>' + esc(d.name) + '</b>' +
          '<small>' + S.nationOf(d).flag + ' ' + d.age + '歳　総合 <b>' +
          Math.round(S.driverRating(d)) + '</b>' +
          (key === 'full' ? '　' + trustChip(d) : '') +
          (d.outFor > 0 ? '　<em class="warn">負傷欠場 あと' + d.outFor + '戦</em>' : '') +
          '</small></span>' +
          '<span class="pb-cost">週' + money(d.salary) + '万</span></button>';
      });
      h += '</div>';
    } else {
      h += '<p class="note">この席は空いています。</p>';
    }
    const room = st.list.length < st.cap;
    h += '<p class="note">' + (room
      ? '押すと、その人の詳しい話と、出す・上げる・入れ替えるが出ます。'
      : '<b class="warn">満員です。</b>誰かを出さないと迎えられません。') + '</p>';
    const btns = [];
    if (room) btns.push({ label: '＋ 迎える', cls: 'primary',
      fn: () => openSeatMarket(key) });
    btns.push({ label: '閉じる', fn: () => { GP.sound.play('tap'); U.closePopup(); } });
    const box = U.popup(st.icon + ' ' + esc(st.name), h, btns);
    Array.prototype.forEach.call(box.querySelectorAll('[data-drvpop]'), b => {
      b.onclick = () => { GP.sound.play('tap'); openDriverPop(b.dataset.drvpop, key); };
    });
  }

  /* ---- いる人の小窓（比較つき） ---- */
  function openDriverPop(id, seat) {
    const st = seatOf(seat);
    const d = (st.list || []).filter(x => x.id === id)[0];
    if (!d) return;
    const back = () => openSeat(seat);
    const others = (g.drivers || []).filter(x => x.id !== d.id);
    let h = drvHeadHTML(d, '週' + money(d.salary) + '万' +
      (d.paid ? '／毎戦 +' + money(d.paid.per) + '万' : ''));
    h += cmpTableHTML(d, others, 'この人');
    const btns = [];
    if (seat === 'full') {
      const fee = d.salary * 6;
      h += '<p class="note">解雇すると違約金 <b>💰' + money(fee) +
        '万</b>（週給の6週ぶん）。走る人が1人になると、その席は空いたままです。</p>';
      btns.push({ label: '👋 解雇する　💰' + money(fee) + '万', cls: 'danger', fn: () => {
        g.funds -= fee;
        g.drivers = g.drivers.filter(x => x.id !== d.id);
        U.log(g, '👋 ' + d.name + ' との契約を解除した（違約金 ' + money(fee) + '万）。');
        S.save(g); render(); U.closePopup(); reopenHr();
      } });
    } else if (seat === 'res') {
      const full = Math.round((d.speed + d.technique + d.stamina + d.mental) / 4 * 0.95 + 18);
      h += '<p class="note">正ドライバーに上げると 週' + money(d.salary) + '万 → <b>週' +
        money(full) + '万</b>になります。</p>';
      if ((g.drivers || []).length < 2) {
        btns.push({ label: '⬆ 正ドライバーに昇格', cls: 'primary', fn: () => {
          const r = S.promoteReserve(g);
          if (!r) return;
          GP.sound.play('levelup');
          U.log(g, '🎉 リザーブの ' + r.name + ' が正ドライバーに昇格！（週' + money(r.salary) + '万）', 'good');
          U.toast('🎉 ' + r.name + ' が正ドライバーに！', 'good');
          S.save(g); render(); U.closePopup(); reopenHr();
        } });
      }
      (g.drivers || []).forEach(o => {
        btns.push({ label: '🔁 ' + esc(o.name) + ' と入れ替え', fn: () => {
          const r = S.swapReserve(g, o.id);
          if (!r) return;
          GP.sound.play('levelup');
          U.log(g, '🔁 ' + r.inD.name + ' が正ドライバーに、' + r.outD.name + ' がリザーブに回った。', 'good');
          S.save(g); render(); U.closePopup(); reopenHr();
        } });
      });
      btns.push({ label: '👋 契約を解除', cls: 'danger', fn: () => {
        const r = S.clearReserve(g);
        if (!r) return;
        U.log(g, '👋 リザーブの ' + r.name + ' との契約を解除した。');
        S.save(g); render(); U.closePopup(); reopenHr();
      } });
    } else {
      if ((g.drivers || []).length < 2) {
        btns.push({ label: '🎉 トップチームへ昇格', cls: 'primary', fn: () => {
          const r = S.promoteYouth(g, d.id);
          if (!r) return;
          GP.sound.play('levelup');
          U.log(g, '🎉 ' + r.name + ' がトップチームに昇格！ デビュー戦が待っている。', 'good');
          U.toast('🎉 ' + r.name + ' が昇格！', 'good');
          S.save(g); render(); U.closePopup(); reopenHr();
        } });
      }
      if (!g.reserve) {
        btns.push({ label: '🪑 リザーブにする', fn: () => {
          g.youth = (g.youth || []).filter(x => x.id !== d.id);
          S.setReserve(g, d);
          GP.sound.play('confirm');
          U.log(g, '🪑 ' + d.name + ' をリザーブドライバーにした。', 'good');
          S.save(g); render(); U.closePopup(); reopenHr();
        } });
      }
      btns.push({ label: '👋 放出する', cls: 'danger', fn: () => {
        g.youth = (g.youth || []).filter(x => x.id !== d.id);
        U.log(g, '👋 若手の ' + d.name + ' を放出した。');
        S.save(g); render(); U.closePopup(); reopenHr();
      } });
    }
    btns.push({ label: '戻る', fn: () => { GP.sound.play('tap'); back(); } });
    U.popup(S.nationOf(d).flag + ' ' + esc(d.name), h, btns);
  }

  /* ---- 迎える相手を選ぶ小窓 ---- */
  /* ---- 市場の更新を、市場の小窓の中でやる ----
     これまで「🔄 市場を更新」は人事の画面の下にしか無かった。
     候補を見ている最中に入れ替えたくなっても、いちど小窓を閉じ、
     画面ごと開き直し、また同じところまで潜り直す必要があった。
     その場で更新して、同じ小窓を開き直す                     */
  function marketRefreshBtn(again) {
    return {
      label: '🔄 市場を更新（500万）',
      disabled: g.funds < 500,
      fn: () => {
        if (g.funds < 500) return;
        g.funds -= 500;
        refreshMarkets(true);
        GP.sound.play('confirm');
        U.log(g, '🔄 市場を更新した（💰500万）。顔ぶれが入れ替わった');
        S.save(g); render();
        U.closePopup();
        again();
      }
    };
  }

  function openSeatMarket(seat) {
    const youth = seat === 'youth';
    const list = youth ? youthMarket : driverMarket;
    let h = '<p class="desc">' + (youth
      ? '下部組織に迎える若手です。いまは荒くても、素質のある子は伸びます。'
      : '押すと、いまの面々と能力を並べて見比べられます。') + '</p><div class="pick">';
    if (!list.length) h += '<p class="note">いま声を掛けられる相手がいません。市場の更新を待ってください。</p>';
    list.forEach((d, i) => {
      const fee = youth ? youthFee(d) : Math.round(d.salary * 12);
      const p3 = S.potOf(d);
      h += '<button class="pickbtn' + (g.funds >= fee ? '' : ' cant') +
        '" data-offer="' + i + '">' +
        '<span class="pb-ic face-ic">' + U.face(d, 28) + '</span>' +
        '<span class="pb-body"><b>' + esc(d.name) + '</b>' +
        '<small>' + S.nationOf(d).flag + ' ' + d.age + '歳　総合 <b>' +
        Math.round(S.driverRating(d)) + '</b>' +
        '　<em style="color:' + p3.color + '">' + U.stars(d.pot || 2) + '</em>' +
        (d.paid ? '　<b class="paidin">持参金 +' + money(d.paid.dowry) + '</b>' : '') +
        '</small></span>' +
        '<span class="pb-cost">💰' + money(fee) + '</span></button>';
    });
    h += '</div>';
    const box = U.popup('＋ ' + (youth ? '若手を迎える' : 'ドライバーを迎える'), h,
      [marketRefreshBtn(() => openSeatMarket(seat)),
       { label: '戻る', cls: 'primary', fn: () => { GP.sound.play('tap'); openSeat(seat); } }]);
    Array.prototype.forEach.call(box.querySelectorAll('[data-offer]'), b => {
      b.onclick = () => { GP.sound.play('tap'); openOfferPop(+b.dataset.offer, seat); };
    });
  }

  /* ---- 迎える前に、いまの面々と並べて見る ---- */
  function openOfferPop(i, seat) {
    const youth = seat === 'youth';
    const list = youth ? youthMarket : driverMarket;
    const d = list[i];
    if (!d) return;
    const fee = youth ? youthFee(d) : Math.round(d.salary * 12);
    const short = Math.max(0, fee - g.funds);
    const others = youth ? (g.youth || []).slice() : (g.drivers || []).slice();
    let h = drvHeadHTML(d, '週' + money(d.salary) + '万');
    h += cmpTableHTML(d, others, 'この人');
    if (!others.length) h += '<p class="note">比べる相手がまだいません。</p>';
    h += '<div class="popcost"><span>' + (youth ? '獲得の費用' : '契約金') + '</span><span><b>💰' +
      money(fee) + '万</b></span></div>' +
      '<div class="popcost"><span>毎週の給料</span><span><b>💰' + money(d.salary) + '万</b></span></div>';
    if (d.paid) {
      h += '<div class="popcost"><span>持参金</span><span><b class="paidin">+💰' +
        money(d.paid.dowry) + '万</b><br><small>毎戦 +' + money(d.paid.per) + '万</small></span></div>' +
        '<p class="note">' + esc(d.paid.line) + '</p>';
    }
    if (short > 0) h += '<p class="note"><b class="warn">資金が足りません。</b>あと <b>💰' +
      money(short) + '万</b> です。</p>';
    /* 迎え先ごとに空きを見る。リザーブの席から開いたときでも、
       「契約する」が見ているのはフルタイムの席のほう          */
    const fullSeat = seatOf('full'), ySeat = seatOf('youth');
    const roomFull = fullSeat.list.length < fullSeat.cap;
    const roomY = ySeat.list.length < ySeat.cap;
    const roomRes = !g.reserve;
    const btns = [];
    if (youth) {
      if (!roomY) h += '<p class="note"><b class="warn">下部組織の席が埋まっています。</b></p>';
      btns.push({ label: '🎓 下部組織に迎える　💰' + money(fee) + '万', cls: 'primary',
        disabled: short > 0 || !roomY,
        fn: () => { hrPick('ym:' + i); U.closePopup(); reopenHr(); } });
    } else {
      if (!roomFull) h += '<p class="note">フルタイムの席は埋まっています（2/2）。' +
        (roomRes ? 'リザーブとしてなら迎えられます。' : '') + '</p>';
      btns.push({ label: '✍️ 契約する（フルタイム）　💰' + money(fee) + '万', cls: 'primary',
        disabled: short > 0 || !roomFull,
        fn: () => { hrPick('dm:' + i); U.closePopup(); reopenHr(); } });
      if (roomRes) {
        const rfee = Math.round(d.salary * 12 * S.RESERVE_PAY);
        btns.push({ label: '🪑 リザーブとして迎える　💰' + money(rfee) + '万',
          disabled: g.funds < rfee,
          fn: () => {
            g.funds -= rfee;
            S.setReserve(g, d);
            list.splice(i, 1);
            GP.sound.play('confirm');
            U.log(g, '🪑 ' + d.name + ' をリザーブドライバーとして迎えた（' + money(rfee) + '万）。', 'good');
            U.toast('🪑 ' + d.name + ' がリザーブに', 'good');
            S.save(g); render(); U.closePopup(); reopenHr();
          } });
      }
    }
    btns.push({ label: '戻る', fn: () => { GP.sound.play('tap'); openSeatMarket(seat); } });
    U.popup(S.nationOf(d).flag + ' ' + esc(d.name), h, btns);
  }

  function hrDrivers() {
    /* タブに出すのは席だけ。中身は押したときの小窓へ。
       前はここに所属・リザーブ・育成・市場を全部積んでいて、
       市場まで下りるのに画面1.7枚ぶん送っていた            */
    let body = '<p class="desc">席を押すと、いま誰がいるか・誰を迎えるか・' +
      'いまの人と比べてどうかが、その場で出ます。' + U.helpLink('people') + '</p>' +
      '<div class="pick">';
    seatList().forEach(st => {
      const full = st.list.length >= st.cap;
      const names = st.list.length
        ? st.list.map(d => esc(d.name) + ' <b>' + Math.round(S.driverRating(d)) + '</b>').join('　')
        : '<b class="warn">空いています</b>';
      body += '<button class="pickbtn seatrow" data-seat="' + st.key + '">' +
        '<span class="pb-ic" style="background:#5a6270">' + st.icon + '</span>' +
        '<span class="pb-body"><b>' + esc(st.name) +
        '<em class="grp-n">' + st.list.length + ' / ' + st.cap + '</em></b>' +
        '<small>' + names + '<br><em class="pnote">' + esc(st.note) + '</em></small></span>' +
        '<span class="pb-cost">' + (full ? '満員' : '＋迎える') + '</span></button>';
    });
    body += '</div>';

    /* ---- いまの車との相性 ----
       前はドライバーのハブに出ていた一行。ハブをやめたので、ここに残す */
    if ((g.drivers || []).length) {
      body += '<div class="sub">🏎️ いまの車との相性</div>' +
        '<div class="trustrow">' + g.drivers.map(d => {
          const fit = S.driverFit(g, d);
          return '<span class="tr-one">' + esc(d.name) + '　車の力を <b>' +
            Math.round(fit.out * 100) + '%</b> 引き出せています' +
            (fit.over ? '<em class="up">（持ち分を超えています）</em>' : '') + '</span>';
        }).join('') + '</div>' +
        '<p class="desc">乗りやすいマシンほど、持っているものをそのまま出せます。' +
        '車体の<b>ドライバビリティ</b>を上げるのも、腕を上げるのと同じだけ効きます。</p>';
    }

    // ---- 信頼と、走らせかたの話 ----
    body += '<div class="sub">🗣️ ピットへの信頼</div>' +
      '<div class="trustrow">' + g.drivers.map(d =>
        '<span class="tr-one">' + esc(d.name) + ' ' + trustChip(d) + '</span>').join('') +
      '</div>' +
      '<p class="desc">言ったことが結果として返ってきたかどうかで動きます。' +
      '高いほど、無線の指示をそのとおりに走ってくれます。</p>' +
      careLegendHTML();
    return body;
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
    { k: 'logi',       nm: '物流',   ic: '📦', to: '輸送費と遅れが減り、ピットと現地の支度に掛かる' }
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

  /* =======================================================
     グループと人の小窓

     施設・備品と同じ考えかた。一覧の行は名前と数字だけにして、
     中身は押したときに出す。解雇のような取り返しのつかないものは、
     その場で起きるのをやめて、小窓で一度受け止める。
     ======================================================= */
  function stMini(st) {
    const t = D.STAFF_TYPES.find(x => x.key === st.type) || {};
    const rk = S.staffRank(st);
    const cap = S.staffCap(st);
    return '<button class="pickbtn stmini" data-stpop="' + st.id + '">' +
      '<span class="pb-ic" style="background:#7b5a3a">' + (t.icon || '👤') + '</span>' +
      '<span class="pb-body"><b>' + esc(st.name) +
      '<em class="stitle">' + rk.icon + ' ' + esc(S.staffTitle(st)) + '</em></b>' +
      '<small><span class="skbar"><i style="width:' +
      Math.min(100, st.skill / cap * 100) + '%"></i></span> 技能 <b>' + st.skill +
      '</b> <em class="scap">/ ' + cap + '</em>　' +
      (st.age || 34) + '歳　効き方 ×' + rk.mul.toFixed(2) + '</small></span>' +
      '<span class="pb-cost">週' + money(st.salary) + '万</span></button>';
  }

  /* 部門の面々と、候補を能力ごとに並べる。
     ドライバーの席と同じ考えかた——入れたらどうなるかは、
     隣に置かないと分からない                              */
  function cmpStaffHTML(cand, others, candLabel) {
    if (!others.length) return '';
    let h = '<div class="cmpwrap"><table class="cmptbl"><tr><th></th>' +
      '<th class="c-cand">' + esc(candLabel || (cand.name || '').slice(0, 5)) + '</th>' +
      others.map(o => '<th>' + esc((o.name || '').slice(0, 5)) + '</th>').join('') + '</tr>';
    const row = (label, get, dg) => {
      const cv = get(cand);
      h += '<tr><td>' + label + '</td><td class="c-cand"><b>' + cv.toFixed(dg) + '</b></td>' +
        others.map(o => {
          const ov = get(o), d = cv - ov;
          const cls = d > 0.005 ? 'up' : d < -0.005 ? 'down' : '';
          return '<td>' + ov.toFixed(dg) +
            '<em class="' + cls + '">' + (d >= 0 ? '+' : '') + d.toFixed(dg) + '</em></td>';
        }).join('') + '</tr>';
    };
    row('技能', st => st.skill || 0, 0);
    row('伸びしろ（上限）', st => S.staffCap(st), 0);
    row('効き方', st => S.staffRank(st).mul, 2);
    row('年齢', st => st.age || 34, 0);
    row('週給', st => st.salary || 0, 0);
    return h + '</table></div>';
  }

  /* ---- その部門に迎える相手を選ぶ小窓 ---- */
  function openStaffMarket(key) {
    const gt = S.groupTable(g);
    const x = gt.byKey(key);
    if (!x) return;
    const d = x.def;
    const room = S.staffRoom(g);
    const cands = staffMarket
      .map((st, i) => ({ st: st, i: i }))
      .filter(o => o.st.type === d.of)
      .sort((a, b) => b.st.skill - a.st.skill);
    let h = '<div class="popsum"><span class="pb-ic" style="background:#5a6270">' + d.icon +
      '</span><span class="popsum-b"><b>' + esc(d.name) + ' に迎える</b>' +
      '<small>いま ' + x.members.length + '人／チーム全体 ' +
      (g.staff || []).length + ' / ' + S.staffSlots(g) + '人</small></span></div>';
    h += room > 0
      ? '<p class="desc">押すと、いまの部門の面々と並べて見比べられます。</p>'
      : '<p class="note"><b class="warn">席が埋まっています。</b>' +
        '施設を伸ばすか、誰かを出さないと迎えられません。</p>';
    h += '<div class="pick">';
    if (!cands.length) {
      h += '<p class="note">いま ' + esc(d.name) + ' の応募者はいません。<br>' +
        '下の「🔎 ' + d.icon + 'の候補を探す」でこの部門だけ求人を出せます' +
        '（💰' + money(D.STAFF_SCOUT.cost) + '万）。</p>';
    }
    cands.forEach(o => {
      const st = o.st, fee = staffFee(st), pt = S.potOf(st);
      h += '<button class="pickbtn' + (g.funds >= fee && room > 0 ? '' : ' cant') +
        '" data-soffer="' + o.i + '">' +
        '<span class="pb-ic" style="background:#7b5a3a">' + (D.STAFF_TYPES.filter(t => t.key === st.type)[0] || {}).icon + '</span>' +
        '<span class="pb-body"><b>' + esc(st.name) + '</b>' +
        '<small>技能 <b>' + st.skill + '</b> / ' + S.staffCap(st) +
        '　' + (st.age || 34) + '歳　<em style="color:' + pt.color + '">' +
        U.stars(st.pot || 2) + '</em>' + traitChips(st) + '</small></span>' +
        '<span class="pb-cost">💰' + money(fee) + '<br><em>週' + money(st.salary) + '</em></span></button>';
    });
    h += '</div>';
    const btns = [scoutBtn(key, () => openStaffMarket(key)),
                  marketRefreshBtn(() => openStaffMarket(key)),
                  { label: '戻る', cls: 'primary', fn: () => { GP.sound.play('tap'); openGroupPop(key); } }];
    const box = U.popup('＋ ' + d.icon + ' ' + esc(d.name), h, btns.filter(b => b));
    Array.prototype.forEach.call(box.querySelectorAll('[data-soffer]'), b => {
      b.onclick = () => { GP.sound.play('tap'); openStaffOffer(+b.dataset.soffer, key); };
    });
  }

  /* ---- 迎える前に、部門の面々と並べて見る ---- */
  function openStaffOffer(i, key) {
    const st = staffMarket[i];
    if (!st) return;
    const gt = S.groupTable(g);
    const x = gt.byKey(key);
    const others = x ? x.members.slice().sort((a, b) => b.skill - a.skill) : [];
    const t = D.STAFF_TYPES.filter(y => y.key === st.type)[0] || {};
    const fee = staffFee(st);
    const room = S.staffRoom(g);
    const short = Math.max(0, fee - g.funds);
    const pt = S.potOf(st);
    const rk = S.staffRank(st);
    let h = '<div class="popsum"><span class="pb-ic" style="background:#7b5a3a">' +
      (t.icon || '👤') + '</span><span class="popsum-b"><b>' + esc(st.name) + '</b>' +
      '<small>' + esc(t.name || '') + '　' + (st.age || 34) + '歳　' +
      rk.icon + ' ' + esc(S.staffTitle(st)) +
      '　<em style="color:' + pt.color + '">' + U.stars(st.pot || 2) + ' ' + esc(pt.name) +
      '</em></small></span></div>' +
      '<p class="desc">' + esc(t.desc || '') + traitChips(st) + '</p>';
    h += cmpStaffHTML(st, others, 'この人');
    if (!others.length) h += '<p class="note">この部門にはまだ誰もいません。最初のひとりになります。</p>';
    h += '<div class="popcost"><span>契約金</span><span><b>💰' + money(fee) + '万</b></span></div>' +
      '<div class="popcost"><span>毎週の給料</span><span><b>💰' + money(st.salary) + '万</b></span></div>';
    if (x) {
      /* 入れたら部門の力がどこまで伸びるか。
         グループの噛み合いを通した値で出す（画面の数字と同じ式） */
      const before = x.total;
      const back = (g.staff || []).slice();
      g.staff = back.concat([st]);
      const after = (S.groupTable(g).byKey(key) || {}).total || before;
      g.staff = back;
      h += '<div class="popcost"><span>' + esc(x.def.name) + 'の力</span><span><b>' +
        before.toFixed(1) + ' → ' + after.toFixed(1) + '</b>' +
        '<br><small>中の噛み合いと、ほかの部門からの効きを通した値</small></span></div>';
    }
    if (room <= 0) h += '<p class="note"><b class="warn">席が埋まっています（' +
      (g.staff || []).length + ' / ' + S.staffSlots(g) + '人）。</b>施設を伸ばすと増えます。</p>';
    if (short > 0) h += '<p class="note"><b class="warn">資金が足りません。</b>あと <b>💰' +
      money(short) + '万</b> です。</p>';
    U.popup((t.icon || '👤') + ' ' + esc(st.name), h, [
      { label: '✍️ 雇う　💰' + money(fee) + '万', cls: 'primary',
        disabled: short > 0 || room <= 0,
        fn: () => { hrPick('sm:' + i); U.closePopup(); reopenHr(); } },
      { label: '戻る', fn: () => { GP.sound.play('tap'); openStaffMarket(key); } }
    ]);
  }

  /* ひとりぶんの小窓。昇進と解雇はここでだけ起きる */
  function openStaffPop(id, back) {
    const st = (g.staff || []).find(x => x.id === id);
    if (!st) return;
    const t = D.STAFF_TYPES.find(x => x.key === st.type) || {};
    const roles = S.promotableRoles(g, st);
    const fee = st.salary * 4;
    const h = '<div class="stpop">' + staffRow(st, '', '') + '</div>' +
      '<div class="popcost"><span>この職種の役目</span><span>' + esc(t.desc || '') + '</span></div>' +
      (roles.length
        ? ''
        : (st.skill >= S.PROMOTE_MIN
            ? '<p class="note">👔 昇進できる腕はありますが、空いている役職がありません。</p>'
            : '<p class="note">👔 昇進できるのは、チーフまで来た人だけです。</p>')) +
      '<p class="note">解雇すると、違約金として <b>💰' + money(fee) + '万</b>（週給の4週ぶん）がかかります。' +
      '抜けた穴は、その場で部門の力に出ます。</p>';
    const btns = roles.map(r => {
      const m = D.MANAGERS.find(y => y.key === r) || {};
      return { label: '👔 ' + (m.name || r) + 'へ昇進', cls: 'primary',
        fn: () => {
          const rr = S.promoteStaff(g, id, r);
          if (!rr) return;
          GP.sound.play('levelup');
          U.log(g, '👔 ' + rr.name + ' が ' + m.name + ' に昇進した！（技能 ' + rr.skill +
                   '／週' + money(rr.salary) + '万）', 'good');
          U.toast('👔 ' + rr.name + ' が' + m.name + 'に昇進！', 'good');
          S.save(g); render(); U.closePopup(); reopenHr();
        } };
    });
    btns.push({ label: '👋 解雇する　💰' + money(fee) + '万', cls: 'danger',
      fn: () => {
        g.funds -= fee;
        g.staff = g.staff.filter(x => x.id !== id);
        U.log(g, '👋 ' + st.name + ' を解雇した（違約金 ' + money(fee) + '万）。');
        U.toast('👋 ' + st.name + ' を解雇');
        S.save(g); render(); U.closePopup(); reopenHr();
      } });
    btns.push({ label: '戻る', fn: () => { GP.sound.play('tap'); U.closePopup(); if (back) back(); } });
    U.popup((t.icon || '👤') + ' ' + esc(st.name), h, btns);
  }

  /* グループひとつぶんの小窓。中の噛み合いと、居る人 */
  function openGroupPop(key) {
    const gt = S.groupTable(g);
    const x = gt.byKey(key);
    if (!x) return;
    const d = x.def;
    const pl = D.GROUP_PLACES.filter(y => y.key === d.place)[0] || {};
    let h = '<div class="popsum"><span class="pb-ic" style="background:#5a6270">' + d.icon +
      '</span><span class="popsum-b"><b>' + esc(d.name) + '</b>' +
      '<small>' + (pl.icon || '') + ' ' + esc(pl.name || '') + '　' +
      x.members.length + '人</small></span></div>' +
      '<p class="desc">' + esc(d.desc) + '</p>' +
      '<div class="grp-mul">' +
        '<span>素の力 <b>' + x.raw.toFixed(1) + '</b></span>' +
        '<span class="' + (x.mul > 1 ? 'up' : x.mul < 1 ? 'down' : '') + '">中の噛み合い <b>×' +
          x.mul.toFixed(2) + '</b></span>' +
        '<span class="' + (x.lift > 0.005 ? 'up' : '') + '">ほかのスタッフグループから <b>+' +
          Math.round(x.lift * 100) + '%</b></span>' +
      '</div>' +
      '<div class="popcost"><span>出ている力</span><span><b>' + x.total.toFixed(1) + '</b></span></div>';
    x.notes.forEach(nt => {
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
    } else {
      h += '<div class="sub small">居る人（押すと昇進・解雇）</div><div class="pick">' +
        x.members.slice().sort((a, b) => b.skill - a.skill).map(stMini).join('') + '</div>';
    }
    const cands = staffMarket.filter(y => y.type === d.of).length;
    h += '<p class="note">' + (cands
      ? '市場に <b>' + cands + '人</b> の応募者がいます。'
      : 'いまこの部門の応募者はいません（🔎 求人を出せます）。') +
      '　席はチーム全体で ' + (g.staff || []).length + ' / ' + S.staffSlots(g) + '人。</p>';
    const box = U.popup(d.icon + ' ' + esc(d.name), h, [
      { label: cands ? '＋ 迎える（候補 ' + cands + '人）' : '🔎 求人を出す', cls: 'primary',
        fn: () => openStaffMarket(key) },
      { label: '閉じる', fn: () => { GP.sound.play('tap'); U.closePopup(); } }
    ]);
    Array.prototype.forEach.call(box.querySelectorAll('[data-stpop]'), b => {
      b.onclick = () => { GP.sound.play('tap'); openStaffPop(b.dataset.stpop, () => openGroupPop(key)); };
    });
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
      /* 行は名前と数字だけ。中の噛み合い・軋み・居る人は、
         押したときの小窓に回す。前はここに全部積んでいたので、
         ファクトリーを開くだけで画面1.8枚ぶんあった        */
      h += '<div class="pick">';
      mine.forEach(x => {
        const d = x.def;
        const bar = Math.min(100, x.total / 16 * 100);
        const bad = x.notes.filter(nt => nt.bad).length;
        const good = x.notes.filter(nt => !nt.bad).length;
        h += '<button class="pickbtn grprow' + (x.members.length ? '' : ' cant') +
          '" data-grp="' + x.key + '">' +
          '<span class="pb-ic" style="background:#5a6270">' + d.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(d.name) +
          '<em class="grp-n">' + x.members.length + '人</em></b>' +
          '<small><i class="grp-bar"><b style="width:' + bar + '%"></b></i>' +
          '素の力 <b>' + x.raw.toFixed(1) + '</b>' +
          '　<em class="' + (x.mul > 1 ? 'up' : x.mul < 1 ? 'down' : '') + '">噛み合い ×' +
            x.mul.toFixed(2) + '</em>' +
          '　<em class="' + (x.lift > 0.005 ? 'up' : '') + '">ほかから +' +
            Math.round(x.lift * 100) + '%</em>' +
          (x.members.length
            ? (good || bad
                ? '<br>' + (good ? '<em class="up">🤝 良い組み合わせ ' + good + '</em>　' : '') +
                  (bad ? '<em class="down">⚡ 軋み ' + bad + '</em>' : '')
                : '')
            : '<br><b class="warn">🕳️ ここに人がいない</b>') +
          '</small></span>' +
          '<span class="pb-cost"><b>' + x.total.toFixed(1) + '</b></span></button>';
      });
      h += '</div>';
    });

    return h;
  }

  /* ---- かみ合いの奥の話 ----
     読まなくても雇える。読むと、どこに人を足すと効くかが分かる。
     雇う手前に置くと画面1枚ぶん邪魔なので、雇うところの後ろに回した */
  function orgDeepHTML() {
    const gt = S.groupTable(g);
    let h = '';
    // 人 → 部門 → 効き目
    h += '<div class="sub">🔗 人が、どこに効いているか</div>' + orgChainHTML(g);

    // 相補作用
    h += '<div class="sub">🤝 スタッフグループ同士の相補作用</div>' +
      '<p class="desc">両方のスタッフグループが育っているときだけ効きます。' +
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
    const room = S.staffRoom(g);
    const scale = GP.base.scale(g);

    /* ---- ①いま居る人 ----
       見出しは groupsHTML の中で場所ごとに立つので、ここでは足さない
       （足すと中身の無い節がひとつできて、折りたたみが1段増える） */
    let body = groupsHTML();

    /* ---- ②雇う ----
       前はここが画面のいちばん下、相補作用の長い説明の後ろにあった。
       雇うのが人事の主目的なので、居る人のすぐ下に上げた         */
    body += '<div class="sub">🧑‍💼 人を迎える' +
      '<span class="slotchip' + (room <= 0 ? ' full' : '') + '">' +
      (g.staff || []).length + ' / ' + S.staffSlots(g) + '人</span></div>' +
      '<p class="desc">チームの規模が大きいほど、腕の良い人材が応募してきます' +
      '（いまの規模：<b>' + scale.rank + '</b>）。' +
      (room > 0
        ? 'あと <b>' + room + '人</b> 置けます。'
        : '<b class="warn">席が埋まっています。</b>') +
      '席の数は施設のレベルで増えます（' + D.STAFF_SLOTS.per +
      'レベルぶん伸ばすごとに1席）。<br>' +
      'グループを押すと、応募者をいまの面々と並べて見比べられます。' +
      '応募者がいない部門には、その場で<b>🔎 求人</b>を出せます' +
      '（💰' + money(D.STAFF_SCOUT.cost) + '万／その部門だけ入れ替わります）。</p>';

    /* 応募者がいる部門だけ並べると、欲しい部門が画面から消えて
       「来ていない」のか「そもそも無い」のか分からなかった。
       8つのグループは常に同じ並びで出し、状態だけを変える     */
    const gt = S.groupTable(g);
    D.GROUP_PLACES.forEach(pl => {
      const gs = D.GROUPS.filter(G => G.place === pl.key);
      if (!gs.length) return;
      body += '<p class="mktplace">' + pl.icon + ' ' + pl.name + '</p><div class="pick">';
      gs.forEach(G => {
        const cands = staffMarket.filter(st => st.type === G.of);
        const mine = (g.staff || []).filter(st => st.type === G.of);
        const top = mine.slice().sort((a, b) => b.skill - a.skill)[0];
        const best = cands.slice().sort((a, b) => b.skill - a.skill)[0];
        const gain = (best && top) ? best.skill - top.skill : null;
        const fee = best ? staffFee(best) : 0;
        const x = gt.byKey(G.key);
        body += '<button class="pickbtn smktrow' + (cands.length ? '' : ' cant') +
          '" data-smkt="' + G.key + '">' +
          '<span class="pb-ic" style="background:' + (cands.length ? '#7b5a3a' : '#5a5a5a') + '">' +
            G.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(G.name) +
          '<em class="grp-n">' + (x ? x.members.length : mine.length) + '人</em>' +
          (cands.length
            ? '<em class="mkt-n">候補 ' + cands.length + '人</em>'
            : '<em class="mkt-n none">候補なし</em>') + '</b>' +
          '<small>' +
          (best
            ? '最上位は <b>技能 ' + best.skill + '</b>' +
              (gain === null
                ? '　<em class="up">ここはまだ空です</em>'
                : '　うちの一番手 ' + top.skill +
                  '　<em class="' + (gain > 0 ? 'up' : 'down') + '">' +
                  (gain > 0 ? '+' : '') + gain + '</em>') +
              '　<em class="mkt-fee">契約金 💰' + money(fee) + '万〜</em>'
            : (top ? 'うちの一番手は 技能 ' + top.skill
                    : '<em class="warn">ここに人がいません</em>') +
              '<br><em class="mkt-ask">🔎 求人を出せます（💰' +
              money(D.STAFF_SCOUT.cost) + '万）</em>') +
          '</small></span>' +
          '<span class="pb-cost">' + (cands.length ? '見比べる' : '求人') + '</span></button>';
      });
      body += '</div>';
    });

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
    body += '</div>';

    /* ---- ③肩書きと、かみ合いの奥の話 ---- */
    body += '<p class="desc">技能が上がると肩書きが変わります：' +
      D.STAFF_RANKS.map(r => r.icon + (r.prefix || '一人前') + (r.at ? '（' + r.at + '）' : '')).join(' → ') +
      '。<br><b>チーフ</b>まで来た人は「👔 首脳陣」の空いている役職へ昇進させられます。' +
      '同じ職種にチーフがいると、その下の人が育つのも早くなります。</p>';
    body += orgBoxHTML();
    body += orgDeepHTML();
    return body;
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
  /* ---- 役職が「どこに効くのか」 ----
     ここの本体はスタッフグループ同士の相補作用のほうで、
     首脳陣はその上に掛かる倍率でしかない。
     なのに候補1人ずつに数字の帯を付けていたので、
     同じ数字が3行も4行も並んで、何を見比べる画面なのか
     分からなくなっていた。効き先は役職につき一度だけ書く。
     行に残すのは「技能」と「現任との差」だけ                 */
  const MGR_SCOPE = {
    principal: [['💰', 'スポンサー収入'], ['📣', '注目度の伸び'], ['💪', '育成グループの力']],
    technical: [['👷', '開発グループの力'], ['🎨', '設計グループの力'], ['📊', '解析グループの力']],
    pitchief:  [['🔩', 'ピットクルーの力'], ['🧠', 'ピットウォールの力']],
    logistics: [['🏦', '週の運営費'], ['🚚', '輸送費'], ['📦', '荷の遅延'], ['😮‍💨', 'クルーの疲労']]
  };
  const MGR_UNDER = { technical: ['engineer', 'designer', 'analyst'], pitchief: ['mechanic', 'strategist'] };

  function mgrScopeHTML(m, cur) {
    const sc = MGR_SCOPE[m.key] || [];
    let h = '<div class="mgscope"><b>' + m.icon + ' この席が効くところ</b>' +
      '<div class="mgscope-l">' +
      sc.map(e => '<em>' + e[0] + ' ' + e[1] + '</em>').join('') + '</div>';
    const keys = MGR_UNDER[m.key];
    if (keys) {
      const o = S.org(g);
      const have = keys.reduce((a, k) => a + o.raw[k], 0);
      h += '<small>' + (have < 1.0
        ? '<b class="warn">掛ける相手がいません（部下の厚み ' + have.toFixed(1) +
          '）。ここに人を入れないと、誰を据えても空回りします。</b>'
        : '部下の厚み <b>' + have.toFixed(1) + '</b> に掛かります。' +
          '部下が厚いほど、同じ技能でも上乗せが大きくなります。') + '</small>';
    }
    h += cur
      ? '<small>いま：' + esc(cur.name) + '（技能 ' + cur.skill + '）→ ' +
        mgrEffect(m.key, cur.skill).filter(e => e[0] !== 'いまの部下')
          .map(e => e[0] + ' <b>' + e[1] + '</b>').join('　') + '</small>'
      : '<small><b class="warn">空席です。いまここは効いていません。</b></small>';
    return h + '</div>';
  }

  /* ---- 部門のかみ合い ----
     どの部門も、単体の足し算では出せない力を出している。
     何が何に掛かっているのかを、そのまま数字で見せる            */
  function orgBoxHTML() {
    const o = S.org(g);
    const D2 = D.ORG.DEPT;
    const bossOf = k => D.MANAGERS.find(m => m.key === (D2[k] || 'principal')) || {};
    /* 研究だけはここに出さない。単位が「週あたりの研究ポイント」で、
       ほかの部門の5倍の桁になるので、並べると棒が全部潰れる。
       研究は下の「人が、どこに効いているか」で見る            */
    const rows = [
      { k: 'engineer',   nm: '開発',   ic: '👷', out: S.devPower(g),   data: true },
      { k: 'designer',   nm: '設計',   ic: '🎨', out: S.designPower(g), data: false },
      { k: 'mechanic',   nm: 'ピット', ic: '🔩', out: S.pitPower(g),   data: false, move: true },
      { k: 'strategist', nm: '作戦',   ic: '🧠', out: S.readPower(g),  data: true },
      { k: 'trainer',    nm: '育成',   ic: '💪', out: S.trainPower(g), data: true },
      { k: 'analyst',    nm: 'データ', ic: '📊', out: S.analystPower(g), data: false },
      { k: 'logi',       nm: '物流',   ic: '📦', out: S.logiPower(g),  data: false }
    ];
    const top = Math.max.apply(null, rows.map(r => r.out).concat([1]));
    // いちばん細いところ。そこを厚くすると、全体がいちばん伸びる
    const thin = rows.slice().sort((a, b) => a.out - b.out)[0];
    let h = '<div class="orgbox"><b>🏢 部門のかみ合い</b>' +
      '<small>部門はそれぞれ独立していません。同じ人件費でも、' +
      '噛み合わせ次第で出る力が変わります。' + U.helpLink('people') + '</small>' +
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
          (r.move ? ' <em>×</em> 📦' + o.moveMul.toFixed(2) : '') +
        '</span></div>';
    });
    h += '</div>' +
      '<div class="orgnote">' +
        '<span>📊 データが回っている <b>' + Math.round(o.data * 100) + '%</b>' +
          '（開発・作戦・育成 <b>×' + o.dataMul.toFixed(2) + '</b>）</span>' +
        '<span>📦 段取りが回っている <b>' + Math.round(o.move * 100) + '%</b>' +
          '（ピット <b>×' + o.moveMul.toFixed(2) + '</b>／現地の支度 <b>+' +
          ((o.setupMul - 1) * 100).toFixed(1) + '%</b>）</span>' +
        '<span>🧑‍🔧 現場の余力 <b>' + Math.round(o.ready * 100) + '%</b>' +
          '（作戦をどれだけ実際に打てるか）</span>' +
      '</div>' +
      '<small>いま細いのは <b>' + thin.ic + ' ' + thin.nm + '</b>。' +
      'ここを厚くすると、掛かっている先までまとめて伸びます。</small>' +
      '</div>';
    return h;
  }

  function hrManagement() {
    let body = '<p class="lead">役職は1人ずつ。据えると<b>その席が効くところに掛かります</b>。<br>' +
      '効き先は役職ごとに一度だけ書いてあります。候補の行で見るのは' +
      '<b>技能</b>と<b>現任との差</b>だけで足ります。</p>' +
      orgBoxHTML();

    D.MANAGERS.forEach(m => {
      const cur = g.managers && g.managers[m.key];
      body += '<div class="sub">' + m.icon + ' ' + m.name + '</div>' +
        '<p class="desc">' + m.desc + '</p>' +
        mgrScopeHTML(m, cur) + '<div class="pick">';

      // ---- 現任 ----
      if (cur) {
        body += '<div class="pickbtn done mgmtrow">' +
          '<span class="pb-ic" style="background:#8a5a2a">' + m.icon + '</span>' +
          '<span class="pb-body"><b>' + esc(cur.name) + '<em class="nowchip">現任</em></b>' +
          '<small><span class="skbar"><i style="width:' + Math.min(100, cur.skill / 60 * 100) + '%"></i></span> 技能 <b>' + cur.skill + '</b>' +
          '</small></span>' +
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
    S.save(g); render(); reopenHr();
  }

  function bindHrActions() {
    const body = $('modalBody');
    Array.prototype.forEach.call(body.querySelectorAll('[data-grp]'), b => {
      b.onclick = () => { GP.sound.play('tap'); openGroupPop(b.dataset.grp); };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-seat]'), b => {
      b.onclick = () => { GP.sound.play('tap'); openSeat(b.dataset.seat); };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-smkt]'), b => {
      b.onclick = () => { GP.sound.play('tap'); openStaffMarket(b.dataset.smkt); };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-promote]'), b => {
      b.onclick = () => {
        const d = S.promoteYouth(g, b.dataset.promote);
        if (!d) return;
        GP.sound.play('levelup');
        U.log(g, '🎉 ' + d.name + ' がトップチームに昇格！ デビュー戦が待っている。', 'good');
        U.toast('🎉 ' + d.name + ' が昇格！', 'good');
        S.save(g); render(); reopenHr();
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
        S.save(g); render(); reopenHr();
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
        S.save(g); render(); reopenHr();
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
        S.save(g); render(); reopenHr();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-swapres]'), b => {
      b.onclick = () => {
        const r = S.swapReserve(g, b.dataset.swapres);
        if (!r) return;
        GP.sound.play('levelup');
        U.log(g, '🔁 ' + r.inD.name + ' が正ドライバーに、' + r.outD.name + ' がリザーブに回った。', 'good');
        S.save(g); render(); reopenHr();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-relres]'), b => {
      b.onclick = () => {
        const d = S.clearReserve(g);
        if (!d) return;
        U.log(g, '👋 リザーブの ' + d.name + ' との契約を解除した。');
        S.save(g); render(); reopenHr();
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
        S.save(g); render(); reopenHr();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-release]'), b => {
      b.onclick = () => {
        const d = (g.youth || []).find(x => x.id === b.dataset.release);
        if (!d) return;
        g.youth = g.youth.filter(x => x.id !== b.dataset.release);
        U.log(g, '👋 若手の ' + d.name + ' を放出した。');
        S.save(g); render(); reopenHr();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-fired]'), b => {
      b.onclick = () => {
        const d = g.drivers.find(x => x.id === b.dataset.fired);
        if (!d) return;
        g.funds -= d.salary * 6;
        g.drivers = g.drivers.filter(x => x.id !== b.dataset.fired);
        U.log(g, '👋 ' + d.name + ' との契約を解除した（違約金 ' + money(d.salary * 6) + '万）。');
        S.save(g); render(); reopenHr();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-firestaff]'), b => {
      b.onclick = () => {
        const st = g.staff.find(x => x.id === b.dataset.firestaff);
        if (!st) return;
        g.funds -= st.salary * 4;
        g.staff = g.staff.filter(x => x.id !== b.dataset.firestaff);
        U.log(g, '👋 ' + st.name + ' を解雇した（違約金 ' + money(st.salary * 4) + '万）。');
        S.save(g); render(); reopenHr();
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
        S.save(g); render(); reopenHr();
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
    api: { cmdDrivers: cmdDrivers, refreshMarkets: refreshMarkets, scoutCardHTML: scoutCardHTML, cmdStaff: cmdStaff, askPoach: askPoach, doPoach: doPoach, doScout: doScout }
  };
};

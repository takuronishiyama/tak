/* =========================================================
   レースシミュレーション（予選＋決勝）
   ラップ単位で全車のタイムを積み上げ、結果とドラマを生成する
   ========================================================= */
window.GP = window.GP || {};

GP.race = (function () {
  'use strict';
  const D = GP.data, S = GP.state;

  const STRATEGIES = {
    safe:    { name: '安全第一', icon: '🛡️', pace: -0.006, risk: 0.55, tyre: 0.80 },
    balance: { name: 'バランス', icon: '⚖️', pace: 0.000,  risk: 1.00, tyre: 1.00 },
    attack:  { name: '攻める',   icon: '🔥', pace: 0.009,  risk: 1.85, tyre: 1.25 }
  };

  /* =========================================================
     実況のことば
     同じ出来事でも、毎回ちがう言い回しで出てくるようにする。
     ところどころ、そのコースの名物コーナーの名前を混ぜて
     「どこで何が起きたのか」が絵として浮かぶようにしている
     {A}=仕掛けた側／{B}=やられた側／{C}=コーナー名／{P}=順位
     ========================================================= */
  function lm(track) {
    const l = (track && track.landmarks) || [];
    return l.length ? S.pick(l) : 'コーナー';
  }
  function say(list, v) {
    let t = S.pick(list);
    v = v || {};
    Object.keys(v).forEach(k => {
      t = t.split('{' + k + '}').join(v[k] == null ? '' : v[k]);
    });
    return t;
  }

  const SAY = {
    /* ストレートで抜いた */
    passStraight: [
      '{A} ストレートで {B} を刺した！',
      '{A}、スリップから抜け出して {B} の前へ！',
      '{A} が {B} を並ぶ間もなく置き去りに！',
      '{A}、DRSを開けて一気に {B} をかわす！',
      '{A} と {B}、真横に並んだまま——先に前に出たのは {A}！',
      '{A} が {B} の真後ろから飛び出した！ 完璧な仕掛け！',
      '{A}、加速で勝った！ {B} は成す術なし！',
      '{A} が {B} をブレーキングで仕留めた！'
    ],
    /* コーナーで抜いた */
    passCorner: [
      '{A} {C} で {B} の内に飛び込んだ！',
      '{A}、{C} の立ち上がりで {B} をとらえた！',
      '{A} が {C} で外から並んだ——そのまま前へ！',
      '{A}、{C} でひとつ深く突っ込んで {B} を攻略！',
      '{A} が {B} のわずかな乱れを見逃さない！ {C} で前へ！',
      '{A}、{C} を一段速いラインで抜けて {B} をパス！',
      '{A} と {B}、{C} で並走——競り勝ったのは {A}！',
      '{A} が {C} で強引に鼻をねじ込んだ！'
    ],
    /* 抜いてトップに立った */
    passLead: [
      '{A} が {B} をとらえた！ ついにトップ！',
      '{A}、{B} を抜いて首位に立つ！ レースが動いた！',
      '先頭が入れ替わった！ {A} が {B} の前へ！',
      '{A} がついに {B} を仕留めた——ここからは自分のレースだ！'
    ],
    /* 終盤の抜き */
    passLate: [
      '残りわずか、{A} が {B} を抜いた！ この一撃は大きい！',
      '土壇場！ {A} が {B} をかわして {P}位に浮上！',
      '最後の最後で {A}！ {B} は守りきれなかった！'
    ],
    /* 抜けずに詰まった */
    stuck: [
      '{A}、{B} の背後に貼りつくが前に出られない…',
      '{A} が何度も顔を出すが、{B} が閉める！',
      '{A}、{C} で並びかけたが押し戻された…',
      '{A} は {B} の乱気流に苦しんでいる。近づくほど曲がらない',
      '{A}、仕掛けどころを探しているが糸口がない…',
      '{B} のブロックが巧い。{A} はまた1周を失う'
    ],
    /* 小さなミス */
    miss: [
      '{A} {C} で膨らんだ！ タイムをロス…',
      '{A}、{C} の入口でわずかに乱れた…',
      '{A} が一瞬アンダーステアに苦しむ！',
      '{A}、縁石に乗りすぎてマシンが跳ねた！',
      '{A} がブレーキを残しすぎた…立ち上がりが鈍い',
      '{A}、シフトを一段まちがえた！ もったいない',
      '{A} が {C} でラインを外した！'
    ],
    /* タイヤが終わっているときのミス */
    missTyre: [
      '{A} {C} でフロントをロックさせた！ 白煙が上がる！',
      '{A}、タイヤが音を上げている。{C} で止まりきれない！',
      '{A} が {C} でずるりと滑った——タイヤの限界だ',
      '{A}、リアが出た！ タイヤはもう終わっている',
      '{A} が必死にカウンターを当てる！ グリップがない！'
    ],
    /* 雨でのミス */
    missWet: [
      '{A} {C} で水たまりに乗った！ 大きくスライド！',
      '{A}、視界がない中で {C} をオーバーラン！',
      '{A} が白線に乗ってヒヤリ！ よく立て直した！',
      '{A}、リアが流れた！ 雨がじわじわ効いてくる',
      '{A} が {C} でハイドロプレーニング！ 肝が冷える！'
    ],
    /* 攻めすぎたときのミス */
    missPush: [
      '{A}、攻めすぎた！ {C} で完全に行き過ぎた！',
      '{A} が突っ込みすぎてコースを外れた！',
      '{A}、限界を超えた！ {C} で大きくはらんだ！',
      '{A} が無理な体勢から立て直す！ 危ない！'
    ],
    /* 大きなミス（スピン級） */
    missBig: [
      '{A} スピン！ {C} でコマのように回った！',
      '{A} がコースを飛び出した！ 砂煙が上がる！',
      '{A}、完全に姿勢を失った！ グラベルまで運ばれる！',
      '{A} スピンターン！ なんとかコースには戻ったが大きなロス…',
      '{A} が {C} でグラベルへ！ 順位を大きく落とす！'
    ],
    /* 機械の故障でリタイア */
    dnfMech: [
      '{A} が{B}でリタイア…',
      '{A}、{B}！ 白煙とともにマシンを止める…',
      '{A} のマシンが力を失った——{B}だ',
      '{A}、{B}でストップ。ガレージが沈黙する…',
      '{A} が路肩にマシンを寄せる。{B}——今日はここまで'
    ],
    /* クラッシュでリタイア */
    dnfCrash: [
      '{A} が{B}！ ここでレースを終える…',
      '{A}、{B}！ マシンは大きなダメージ…',
      '{A} が{B}でストップ！ 無線に応答はない…',
      '{A}、{B}——一瞬の出来事だった',
      '{A} が {C} で{B}！ 週末が終わってしまった…'
    ],
    /* ピットイン */
    pit: [
      '{A} ピットイン！ {B}に交換 ({P}秒)',
      '{A} が動いた！ {B}を履いて送り出す ({P}秒)',
      '{A} ピットへ。{B}に履き替えて再スタート ({P}秒)',
      '{A}、タイヤ交換！ {B}で残りを走りきる ({P}秒)'
    ],
    /* 手間取ったピット */
    pitSlow: [
      '{A} ピットイン！ …作業が止まった！ {B}に交換 ({P}秒)',
      '{A} ピットイン、しかしタイヤがはまらない！ {B} ({P}秒)',
      '{A} ピットで痛恨のロス！ {B}に交換 ({P}秒)'
    ]
  };

  /* =========================================================
     チーム無線
     ピットウォールとドライバーの、その場のやりとり。
     実況が「外から見た絵」なら、こちらは「中の声」。
     短い言葉だけを、起きたことに合わせて積んでいく
     {D}=ドライバー名／{P}=順位／{N}=残り周回／{T}=タイヤ
     {GA}=前との差／{GB}=後ろとの差／{L}=タイヤの残り周回／{S}=秒数
     ========================================================= */
  const RADIO = {
    /* --- ピット → ドライバー --- */
    box: ['「ボックス、ボックス。{T} に行く」',
          '「今周ピットだ。{T} を用意してある」',
          '「入れ。{T}、準備できている」',
          '「ボックス確認。{T} で最後まで行く」'],
    gapAhead: ['「前とのギャップ {GA}。まだ削れる」',
               '「差は {GA}。このペースなら追いつく」',
               '「前は {GA}。焦らず一定で」',
               '「ギャップ {GA}、じわじわ来ている。いい流れだ」'],
    gapBehind: ['「後ろが {GB} まで来ている。ラインは締めておけ」',
                '「うしろ {GB}。ストレートだけ気をつけろ」',
                '「{GB} 差まで詰められている。ミスだけはするな」'],
    clear: ['「前後ともクリア。自分のリズムで行っていい」',
            '「まわりは空いている。タイヤを労わろう」'],
    tyre: ['「そのタイヤ、あと {L} 周は持たせたい」',
           '「タイヤの数字は悪くない。あと {L} 周は行ける」',
           '「タイヤを労われ。あと {L} 周だ」'],
    save: ['「ペースを落とせ。タイヤを最後まで持たせる」',
           '「1周あたり少し捨てていい。終盤に取り返す」',
           '「いまは我慢だ。仕掛けるのはまだ先」'],
    push: ['「ここからプッシュ。残り {N} 周、全部使え」',
           '「行っていい。ペースを上げろ」',
           '「いまが勝負どころだ。攻めてくれ」'],
    sc: ['「セーフティカー、セーフティカー。デルタを守れ」',
         '「イエロー全面。ペースを落として隊列につけ」',
         '「セーフティカーだ。落ち着いて、デルタ確認」'],
    vsc: ['「バーチャルセーフティカー。デルタ、デルタ」',
          '「VSC 発動。指定タイムを外すな」'],
    rain: ['「3コーナー付近に雨。数周で本格的に来る」',
           '「レーダーが赤い。すぐ濡れる、備えてくれ」',
           '「雨が来た。無理はするな、様子を教えてくれ」'],
    dry: ['「路面が乾いてきた。ドライのタイミングを見ている」',
          '「雨は上がった。ラインの外はまだ濡れている」'],
    pen: ['「{S}秒の加算だ。取り返すぞ、まだ終わっていない」',
          '「裁定が出た。{S}秒。頭を切り替えてくれ」'],
    ok: ['「大丈夫か？ マシンの状態を教えてくれ」',
         '「いまのは見えた。ダメージはないか」',
         '「落ち着いていこう。何が起きた？」'],
    final: ['「残り {N} 周。このまま持ち帰ってくれ」',
            '「あと {N} 周。ポジションを守れ」',
            '「最後の {N} 周だ。ミスなく行こう」'],
    last: ['「ファイナルラップ。行ってこい」',
           '「最終ラップだ。全部出しきれ」'],
    win: ['「P1！ P1だ！ よくやった！！」',
          '「チェッカー、P1！ 信じられない、最高だ！」'],
    podium: ['「P{P}！ 表彰台だ！ よくやった！」',
             '「チェッカー、P{P}。素晴らしい走りだった」'],
    points: ['「チェッカー、P{P}。ポイントを持ち帰った。よくやった」',
             '「P{P} でフィニッシュ。悪くない一日だ」'],
    plain: ['「チェッカー、P{P}。今日はここまでだ。お疲れさま」',
            '「P{P}。持ち帰れたことをよしとしよう」'],
    dnfPit: ['「マシンを止めてくれ。安全な場所に寄せろ」',
             '「今日は終わりだ。ゆっくり降りてくれ」'],

    /* --- ドライバー → ピット --- */
    roger: ['「了解、入る」', '「コピー、ボックス」', '「わかった、今周入る」'],
    rogerShort: ['「了解」', '「コピー」', '「わかっている」'],
    tyreGone: ['「タイヤが終わった。これ以上は保たない」',
               '「グリップがない。もう滑るだけだ」',
               '「限界だ、タイヤを替えてくれ」',
               '「リアが完全に終わっている。入れてくれ」'],
    under: ['「アンダーがひどい。フロントが入らない」',
            '「曲がらない。ターン1で毎回はらんでいる」',
            '「フロントがまるで効かない」'],
    over: ['「リアが逃げる。乗りにくい」',
           '「立ち上がりで毎回滑る。押さえきれない」',
           '「バランスが後ろに寄りすぎている」'],
    stuck: ['「前が遅い。なんとかしてくれ」',
            '「後ろにいると曲がらない。離れるしかない」',
            '「ずっと詰まっている。作戦を変えられないか」'],
    okBack: ['「問題ない、続ける」',
             '「大丈夫だ。少し行き過ぎただけ」',
             '「マシンは無事だ。行ける」'],
    pushBack: ['「まだ行ける。プッシュする」',
               '「任せてくれ。ここから上げる」',
               '「わかった。全部出す」'],
    rainBack: ['「セクター2、もう濡れている」',
               '「見えない。前のしぶきで何も見えない」',
               '「まだドライでいける。もう少し引っぱらせてくれ」'],
    angry: ['「その作戦は違うだろう！」',
            '「なぜあそこで入れなかったんだ」',
            '「こんな加算は納得できない」'],
    thanks: ['「みんな、ありがとう！ 最高のクルマだった！」',
             '「やった！ チーム全員のおかげだ！」',
             '「この一勝は、工場のみんなのものだ」'],
    thanksOk: ['「ありがとう、いいクルマだった」',
               '「持ち帰れてよかった。次はもっと行ける」'],
    sorry: ['「すまない。自分のミスだ」',
            '「悔しい。次は必ず持ち帰る」',
            '「マシンは良かった。それだけに残念だ」']
  };

  /* ピットウォールがこの周に出す指示。
     タイヤの残り・前後の車間・残り周回から、攻めるか抑えるかを決める。
     決めた指示は、そのままラップタイムとタイヤの減りに効く          */
  function decideOrder(e, lap, laps, ty) {
    const left = ty.life - e.tyreAge;                 // タイヤの余力（周）
    const nextPit = e.pitPlan.find(l => l > lap);
    const toPit = nextPit == null ? laps - lap : nextPit - lap;
    const gapA = e.gapAhead, gapB = e.gapBehind;
    // タイヤが持たない見込みなら、まず抑える
    if (left < toPit) return 'save';
    // 攻め続けられる時間には限りがある。何周も出しっぱなしにはできない
    const burnt = (e.pushLaps || 0) >= 4;
    // 終盤、前が射程で、タイヤを使い切ってよいなら出しきる
    if (laps - lap <= 4 && gapA != null && gapA < 2.0) return 'push';
    if (!burnt) {
      // 後ろに詰められている。守るのは、タイヤに余裕があるときだけ
      if (gapB != null && gapB < 1.0 && left > toPit * 1.6 + 3) return 'push';
      // 前が射程。仕掛けるのも、余裕があるときだけ
      if (gapA != null && gapA < 1.0 && left > toPit * 1.6 + 4) return 'push';
    }
    // ぎりぎりなら労わる
    if (left < toPit + 2) return 'save';
    return 'hold';
  }
  const orderOf = k => D.ORDERS.find(o => o.key === k) || D.ORDERS[1];

  /* その周に、自チームのドライバーとどんなやりとりがあったか。
     優先度の高い出来事から1件だけ拾い、なければ何周かに一度だけ
     状況を伝える。毎周しゃべると、かえって何も伝わらないため     */
  function radioTick(st) {
    const lap = st.lap, laps = st.laps, radio = st.radio;
    const run = st.order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
    run.forEach((e, i) => {
      if (!e.isPlayer) return;
      e.radioCool = Math.max(0, (e.radioCool || 0) - 1);
      const ty = tyreOf(e.tyreKey);
      const ahead = i > 0 ? run[i - 1] : null;
      const behind = i < run.length - 1 ? run[i + 1] : null;
      // 「ボックス、◯◯に行く」で読むのは、これから実際に履くタイヤ。
      // いま履いているものを読んでいたため、交換の結果と食い違っていた
      const nextTy = e.pitTyre || ty.key;
      const V = {
        D: e.driver.name, P: i + 1, N: laps - lap, T: tyreOf(nextTy).name,
        L: Math.max(0, Math.round(ty.life - e.tyreAge)),
        GA: ahead ? (e.cum[lap - 1] - ahead.cum[lap - 1]).toFixed(1) + '秒' : '',
        GB: behind ? (behind.cum[lap - 1] - e.cum[lap - 1]).toFixed(1) + '秒' : '',
        S: e.penalty || 0
      };
      const push = (pool, from, force) => {
        // 直前と同じ言い回しにならないように、二度までは引き直す
        let text = say(pool, V);
        for (let k = 0; k < 2 && radio.length && radio[radio.length - 1].text === text; k++) {
          text = say(pool, V);
        }
        radio.push({ lap: lap, from: from, name: e.driver.name, id: e.id, text: text });
        if (!force) e.radioCool = 3;
      };
      const beat = lap + (e.num || 0);      // 2台の無線が重ならないようにずらす
      // ---- 起きたことに応じて、優先度の高いものから ----
      if (e.pitPlan.indexOf(lap + 1) >= 0) {           // 次の周にピット
        push(RADIO.box, 'pit', true);
        push(RADIO.roger, 'drv', true);
        e.radioCool = 2;
        return;
      }
      if (st.scStart) {                                 // セーフティカーが出た
        push(st.scVirtual ? RADIO.vsc : RADIO.sc, 'pit', true);
        push(RADIO.rogerShort, 'drv', true);
        e.radioCool = 2;
        return;
      }
      if (st.wxChanged) {                               // 天候が動いた
        push(st.wxWet ? RADIO.rain : RADIO.dry, 'pit', true);
        push(RADIO.rainBack, 'drv', true);
        e.radioCool = 2;
        return;
      }
      if (e.radioPen === lap) {                         // 加算をもらった
        e.radioPen = -1;
        push(RADIO.pen, 'pit', true);
        push(RADIO.angry, 'drv', true);
        e.radioCool = 3;
        return;
      }
      if (e.orderChanged === lap) {                     // 指示が変わった
        e.orderChanged = -1;
        if (e.order === 'push') { push(RADIO.push, 'pit', true); push(RADIO.pushBack, 'drv', true); }
        else if (e.order === 'save') { push(RADIO.save, 'pit', true); push(RADIO.rogerShort, 'drv', true); }
        else { push(RADIO.clear, 'pit', true); }
        e.radioCool = 3;
        return;
      }
      if (e.radioMiss === lap) {                        // 大きく崩した
        e.radioMiss = -1;
        push(RADIO.ok, 'pit', true);
        push(RADIO.okBack, 'drv', true);
        e.radioCool = 3;
        return;
      }
      if (e.radioCool > 0) return;
      // ---- ここから先は、間が空いているときだけ ----
      if (e.tyreAge > ty.life + 1) {                    // タイヤが終わった
        push(RADIO.tyreGone, 'drv');
        push(e.pitPlan.some(l => l > lap) ? RADIO.tyre : RADIO.save, 'pit', true);
        return;
      }
      if (lap === laps) { return; }                     // 最終周は結果側で入れる
      if (lap === laps - 1) { push(RADIO.last, 'pit'); return; }
      if (laps - lap <= 4) {                            // 残りわずか
        push(behind && (behind.cum[lap - 1] - e.cum[lap - 1]) < 2.5 ? RADIO.final : RADIO.push, 'pit');
        push(RADIO.pushBack, 'drv', true);
        return;
      }
      if (e.stuckLaps >= 3 && ahead) {                  // ずっと前に詰まっている
        e.stuckLaps = 0;
        push(RADIO.stuck, 'drv');
        push(RADIO.push, 'pit', true);
        return;
      }
      if (beat % 5 === 2) {                             // 定期的な状況報告
        const gA = ahead ? e.cum[lap - 1] - ahead.cum[lap - 1] : 99;
        const gB = behind ? behind.cum[lap - 1] - e.cum[lap - 1] : 99;
        if (gA < 3.0) push(RADIO.gapAhead, 'pit');
        else if (gB < 3.0) push(RADIO.gapBehind, 'pit');
        else if (e.tyreAge > ty.life * 0.7) push(RADIO.save, 'pit');
        else push(RADIO.clear, 'pit');
        return;
      }
      if (beat % 7 === 4) {                             // ドライバーからの訴え
        // マシンの性格を、ドライバーの言葉で出す
        const under = e.stats && e.stats.corner < e.stats.speed;
        push(under ? RADIO.under : RADIO.over, 'drv');
      }
    });
  }

  /* ---------- エントリーリスト作成 ---------- */
  function buildEntries(g, track, weather, strategy) {
    const teams = S.allTeams(g, track);
    // 週ごとの調子。金曜のセットアップがはまったかどうかで、チームごとに少し上下する。
    // そして毎レース、どこか1チームが「当たり週」を引いて前に出てくる
    const form = teams.map(t => t.isPlayer ? 1 : 1 + S.rnd(-0.014, 0.014));
    const ri = [];
    teams.forEach((t, i) => { if (!t.isPlayer) ri.push(i); });
    let hot = -1;
    if (ri.length) { hot = ri[S.rint(0, ri.length - 1)]; form[hot] += 0.052; }
    const list = [];
    list.hotTeam = hot >= 0 ? teams[hot].name : '';
    // 車体の熟成度（0..1）。ライバルは「そこそこ仕上げてある」0.5 として扱うので、
    // プレイヤーは煮詰めれば有利に、放っておけば不利になる
    const RIVAL_BODY = RIVAL_BODY_REF;
    const myBody = {
      rigid: S.bodyRatio(g, 'rigidity'), light: S.bodyRatio(g, 'light'),
      aero:  S.bodyRatio(g, 'aeroBody'), cool:  S.bodyRatio(g, 'cooling'),
      svc:   S.bodyRatio(g, 'service'),  drive: S.bodyRatio(g, 'drive')
    };
    const evenBody = { rigid: RIVAL_BODY, light: RIVAL_BODY, aero: RIVAL_BODY,
                       cool: RIVAL_BODY, svc: RIVAL_BODY, drive: RIVAL_BODY };
    teams.forEach((t, ti) => {
      t.drivers.forEach((d, di) => {
        const strat = t.isPlayer ? (strategy[d.id] || 'balance') : autoStrategy(t, track);
        const st = STRATEGIES[strat];
        const sk = k => S.hasSkill(d, k);
        let drv = S.driverRating(d);
        // スキルによる補正
        if (sk('rain') && (weather.key === 'rain' || weather.key === 'storm')) drv *= 1.18;
        // 痛みを押しての出走。本来の力は出せない
        if (d.hurt) drv *= 0.72;
        // 母国グランプリ。地元のスタンドが自分の色で埋まると、人は強くなる
        if (S.nationOf(d).flag === track.country) drv *= 1.035;
        // 乗りやすいマシンほど、ドライバーは持っているものをそのまま出せる
        const bd0 = t.isPlayer ? myBody : evenBody;
        drv *= 1 + (bd0.drive - RIVAL_BODY) * 0.20;
        // パワーユニットの状態と出力モードは、そのまま走りの速さに出る。
        // へたったユニットで我慢するほど、じわじわ順位を落としていく
        const perf = (t.car * 0.60 + drv * 0.40) * form[ti]
                   * (t.isPlayer ? (g.logi && g.logi.late ? 0.990 : S.logiPlan(g).perf)
                                 * ((strategy && strategy.setup) || 1) : 1)
                   + (t.isPlayer ? S.puPerf(g) : 0);

        const stats = t.stats || { speed: 1, corner: 1, accel: 1 };
        list.push({
          id: t.isPlayer ? d.id : (t.name + di),
          driver: d, team: t, color: t.color, isPlayer: !!t.isPlayer,
          num: list.length + 1,
          stats: stats,
          // このマシンがコース上でどう速度を出すか。区間タイムの配分もここから来る
          prof: GP.geom.speedProfile(track, stats),
          gen: t.isPlayer ? g.carGen : Math.min(D.CAR_GENS.length - 1, Math.round((t.car - 12) / 26)),
          perf: perf, strat: strat, st: st, sk: sk, hot: ti === hot,
          // あとで「何が効いて、その順位になったのか」を分解するために残す
          carScore: t.car, drvScore: drv, formMul: form[ti],
          bd: t.isPlayer ? myBody : evenBody,
          startTyre: t.isPlayer ? (strategy['tyre_' + d.id] || null) : null,
          // 作戦の性格（ライバル）と、プレイヤーが選んだピット回数・タイヤの狙い
          style: t.style || 'balanced',
          stopPlan: t.isPlayer ? (strategy['stops_' + d.id] || 'auto') : null,
          tyrePlan: t.isPlayer ? (strategy['tbias_' + d.id] == null ? 1
                                  : parseInt(strategy['tbias_' + d.id], 10)) : null,
          rel: t.rel,
          tyreSkill: (sk('tyre') ? 0.55 : 1) * (1 - d.technique / 420),
          lapTimes: [], cum: [], pits: [], sectors: [], bestSec: [Infinity, Infinity, Infinity],
          dnf: false, dnfLap: -1, dnfReason: '',
          grid: 0, pos: 0, fastest: Infinity
        });
      });
    });
    return list;
  }

  /* 審査の裁定。持ち時間に5秒足され、結果は順位に効く */
  function givePenalty(e, key, lap, events, laps) {
    const P = D.PENALTIES.find(x => x.key === key) || D.PENALTIES[0];
    e.penalty = (e.penalty || 0) + P.sec;
    e.penalties = (e.penalties || []).concat([{ lap: lap, key: P.key, name: P.name, sec: P.sec }]);
    // 持ち時間に足す。この周の集計が済んでいれば直接、まだなら次の集計で足す
    if (e.cum[lap - 1] != null) e.cum[lap - 1] += P.sec;
    else e.penPending = (e.penPending || 0) + P.sec;
    if (e.isPlayer) {
      e.radioPen = lap;                       // 無線でひとこと交わすための目印
      events.push({ lap: lap, type: 'penalty', car: e,
        text: P.icon + ' ' + e.driver.name + ' に' + P.sec + '秒加算 — ' + P.text });
    }
  }

  /* ライバルの車体はこのくらい仕上がっている、という基準。
     プレイヤーの車体効果はすべてここを 0 として増減する */
  const RIVAL_BODY_REF = 0.40;

  const tyreOf = key => D.TYRES.find(t => t.key === key) || D.TYRES[1];

  /* このスティント（区間）を走りきるのに向いたタイヤを選ぶ。
     攻めるチームは寿命ぎりぎりの速いタイヤを、
     堅実なチームは余裕のある硬いタイヤを選ぶ                        */
  function pickTyre(stintLaps, weather, prefer, bias) {
    if (weather.key === 'storm') return 'wet';
    if (weather.key === 'rain') return 'inter';
    if (prefer && D.DRY_TYRES.indexOf(prefer) >= 0) return prefer;
    const fit = D.DRY_TYRES.map(k => tyreOf(k)).filter(t => t.life >= stintLaps * 0.9);
    if (!fit.length) return 'hard';
    // bias 0=攻め（寿命ぎりぎりの速いタイヤ） 1=バランス 2=堅実（余裕のある硬いタイヤ）
    const i = bias >= 2 ? fit.length - 1 : bias === 1 ? Math.floor((fit.length - 1) / 2) : 0;
    return fit[i].key;
  }

  function autoStrategy(team, track) {
    const r = Math.random();
    if (r < 0.2) return 'safe';
    if (r < 0.75) return 'balance';
    return 'attack';
  }

  /* ---------- 天候抽選 ---------- */
  function rollWeather(track) {
    const r = Math.random() * (0.9 + track.tyre * 0.1);
    if (r < 0.52) return D.WEATHER[0];
    if (r < 0.78) return D.WEATHER[1];
    if (r < 0.94) return D.WEATHER[2];
    return D.WEATHER[3];
  }

  /* ---------- 予選 ---------- */
  function qualify(entries, track, weather) {
    entries.forEach(e => {
      let q = e.perf;
      if (e.sk('qualify')) q *= 1.07;
      q *= (0.94 + Math.random() * 0.12) * weather.grip;
      q *= (1 - (1 - e.driver.mental / 260) * (weather.chaos - 1) * 0.08);
      e.qScore = q;
      e.qTime = track.base * (1 + (0.02 + (140 - q) * 0.0009));
    });
    entries.sort((a, b) => b.qScore - a.qScore);
    entries.forEach((e, i) => { e.grid = i + 1; });
    return entries.slice();
  }

  /* ---------- 予選まで ----------
     グリッドを先に確定させて、決勝の前に見せられるようにする。
     ここで作ったものを simulate に渡すと、そのまま決勝に使われる      */
  function prequalify(g, trackIndex, strategy, special) {
    const track = D.TRACKS[trackIndex];
    const weather = Object.assign({}, special && special.force
      ? (D.WEATHER.find(w => w.key === special.force) || rollWeather(track))
      : rollWeather(track));
    weather.wetTyres = (weather.key === 'rain' || weather.key === 'storm');
    const entries = buildEntries(g, track, weather, strategy);
    const grid = qualify(entries, track, weather);
    return { trackIndex: trackIndex, track: track, weather: weather,
             entries: entries, grid: grid, special: special };
  }

  /* ---------- 決勝シミュレーション ---------- */
  function simulate(g, trackIndex, strategy, special, pre) {
    const track = D.TRACKS[trackIndex];
    // 予選を先に走らせてあれば、そのグリッドをそのまま使う
    const weather = pre ? pre.weather : Object.assign({}, special && special.force
      ? (D.WEATHER.find(w => w.key === special.force) || rollWeather(track))
      : rollWeather(track));
    if (!pre) weather.wetTyres = (weather.key === 'rain' || weather.key === 'storm');
    const entries = pre ? pre.entries : buildEntries(g, track, weather, strategy);
    const grid = pre ? pre.grid : qualify(entries, track, weather);
    // パワーユニットの基数超過による降格。予選のあとに順位を下げる
    const gridPen = (g.pu && g.pu.grid) || 0;
    if (gridPen > 0) {
      grid.filter(e => e.isPlayer).forEach(e => { e.grid += gridPen; e.gridPen = gridPen; });
      grid.sort((a, b) => a.grid - b.grid);
      grid.forEach((e, i) => { e.grid = i + 1; });
      entries.sort((a, b) => a.grid - b.grid);
    }
    const laps = Math.max(4, Math.round(track.laps * (special ? special.lapMul : 1)));
    const events = [];
    const bestSector = [Infinity, Infinity, Infinity];   // セッション最速（紫）
    let scLaps = 0, scFrom = 0, scPending = false, scDone = false;   // セーフティカー
    let scStarted = false, wxChangedThisLap = false;   // 無線でひとこと入れるための目印
    const bestSectorBy = [null, null, null];
    const scInfo = { from: 0, laps: 0, virtual: false };
    const radio = [];                 // チーム無線。自チームのぶんだけ積む
    // 天候の急変。降り出す／上がるで、履いているタイヤの正解が入れ替わる
    let wx = { key: weather.key, grip: weather.grip, chaos: weather.chaos, wet: weather.wetTyres };
    let wxTo = null, wxAt = 0;
    const wxInfo = { at: 0, from: weather.name, to: '', icon: '' };
    /* ---- 路面の濡れ具合 ----
       「乾いているか、濡れているか」の二択ではなく、0〜1 の度合いで持つ。
       しかもセクターごとに違う。雨は手前のセクターから来て奥へ広がり、
       乾くときも同じ順に乾いていく。おかげで
       「通り雨」「大雨」「乾きかけ」が、そのまま履き替えの判断になる  */
    let wetTarget = weather.wetTo != null ? weather.wetTo : (weather.wetTyres ? 0.6 : 0);
    const wetSec = [wetTarget, wetTarget, wetTarget];
    const wetLog = [];                       // 各周のセクター別の濡れ具合（観戦画面用）
    let shower = null;                       // 通り雨（何周かだけ強く降る）
    const secShare = geoShare();
    function geoShare() { return [0.34, 0.33, 0.33]; }
    /* コース全体としての濡れ具合（セクターの長さで重みづけ） */
    const wetAvg = () => wetSec[0] * secShare[0] + wetSec[1] * secShare[1] + wetSec[2] * secShare[2];
    /* タイヤと路面が噛み合っていないぶん、1周でどれだけ失うか */
    function wetLoss(ty, w) {
      const ideal = ty.wetIdeal != null ? ty.wetIdeal : (ty.wet ? 0.7 : 0);
      const tol = ty.wetTol != null ? ty.wetTol : 0.2;
      const d = Math.max(0, Math.abs(w - ideal) - tol);
      return d * D.WET_MISMATCH;
    }
    /* いま入ったとして、どのタイヤを履くか。
       予定していた銘柄を基本にしつつ、路面が変わっていれば合わせ直す。
       乾きかけなら、少し先を読んでドライに賭けることもある          */
    function tyreForNow(e, lap) {
      const planned = e.stints[e.stintIdx] ? e.stints[e.stintIdx].key : 'medium';
      const w = wx.level == null ? 0 : wx.level;
      // 路面がこれから向かう先。乾きかけならドライに、降り出しなら雨用に
      const ahead = w + (wetTarget - w) * 0.55;
      const dry = pickTyre(laps - lap, { key: 'sunny' }, D.DRY_TYRES.indexOf(planned) >= 0 ? planned : null, e.tyreBias);
      const want = bestWetTyre(ahead, dry);
      // 予定どおりで大きく損をしないなら、予定を尊重する
      const lossPlanned = wetLoss(tyreOf(planned), ahead);
      return lossPlanned <= wetLoss(tyreOf(want), ahead) + 0.012 ? planned : want;
    }

    /* いまの路面にいちばん合うタイヤ */
    function bestWetTyre(w, dryPick) {
      if (w < 0.20) return dryPick;
      let best = null, bl = 9;
      D.TYRES.forEach(t => {
        if (!t.wet) return;
        const l = wetLoss(t, w);
        if (l < bl) { bl = l; best = t.key; }
      });
      return best || 'inter';
    }
    // 追い抜きやすさ：最長ストレートの長さ（実際の形状）と、コースの速度特性から決める
    const geo = GP.geom.analyze(track);
    const passEase = 0.25 + geo.longestShare * 1.1 + track.weight.speed * 0.5;
    const E = D.ERS;
    // ストレートが長いコースほど、放電を速さに変えやすい
    const ersScale = 0.7 + geo.longestShare * 1.6;
    const refPerf = Math.max.apply(null, entries.map(e => e.perf)) + 4;
    const cw = S.crewPenalty(g);          // クルーの疲労
    const pitLoss = 20.5 - g.facilities.pit * 0.7 - S.staffBonus(g, 'mechanic') * 0.4
                  - S.mgr(g, 'pitchief') * 0.06 - S.osk(g, 'call') * 0.5   // 采配
                  + cw.pit;
    const strategist = S.staffBonus(g, 'strategist');

    // ピット戦略とタイヤの割り当て
    entries.forEach(e => {
      const wear = track.tyre * e.st.tyre * e.tyreSkill;
      // コースとマシンから決まる「素直な」ストップ回数
      const natural = (wear > 1.05 || laps > 28) ? 2 : 1;
      let stops = natural;
      e.tyreBias = 1;
      e.react = 0.45;                     // アンダーカットを仕掛ける積極性

      if (e.isPlayer) {
        // プレイヤーは自分で選べる。'auto' ならコース任せ
        const want = e.stopPlan;
        if (want === '1' || want === '2' || want === '3') stops = parseInt(want, 10);
        e.tyreBias = e.tyrePlan == null ? 1 : e.tyrePlan;
        e.react = 0.5 + strategist * 0.12 + S.osk(g, 'call') * 0.06;
      } else {
        // ライバルはチームごとの性格に従う。性格はシーズンを通して変わらない
        const st = D.STRAT_STYLES[e.style] || D.STRAT_STYLES.balanced;
        if (st.random) {                  // 型破りなチームだけは毎回読めない
          stops = S.clamp(natural + S.rint(-1, 1), 1, 3);
          e.tyreBias = S.rint(0, 2);
        } else {
          stops = S.clamp(natural + st.stopBias, 1, 3);
          e.tyreBias = st.tyreBias;
        }
        e.react = st.react;
        e.pitShift = st.random ? S.rnd(-0.1, 0.1) : st.pitShift;
      }
      e.stops = stops;

      const blur = e.isPlayer ? Math.max(0, 1.6 - strategist * 0.5) : 1.4;
      const shift = e.pitShift || 0;
      e.pitPlan = [];
      for (let i = 1; i <= stops; i++) {
        // 等分だと毎回同じ周回になるので、性格ぶんの前倒し／引っ張りを乗せる
        const frac = i / (stops + 1) * (1 + shift);
        e.pitPlan.push(S.clamp(Math.round(laps * frac + S.rnd(-blur, blur)), 2, laps - 2));
      }
      e.pitPlan.sort((a, b) => a - b);
      e.pitLoss = pitLoss - (e.isPlayer ? strategist * 0.5 : 0) - (e.bd.svc - RIVAL_BODY_REF) * 2.2;
      e.tyreAge = 0;
      e.startBoost = (e.sk('start') ? 2.2 : 0) + e.driver.technique / 200;

      // 各スティントの長さから履くタイヤを決める。最初のスティントだけは指定できる
      const bounds = [0].concat(e.pitPlan, [laps]);
      e.stints = [];
      for (let i = 0; i < bounds.length - 1; i++) {
        const len = bounds[i + 1] - bounds[i];
        const prefer = (i === 0 && e.isPlayer) ? e.startTyre : null;
        e.stints.push({ from: bounds[i] + 1, to: bounds[i + 1],
                        key: pickTyre(len, weather, prefer, e.tyreBias), laps: len });
      }
      // ドライレースでは2種類以上のタイヤを使わなければならない（実際のF1のルール）
      if (!weather.wetTyres && e.stints.length >= 2) {
        const keys = e.stints.map(x => x.key);
        if (keys.every(k => k === keys[0])) {
          // いちばん短いスティントを、別の銘柄に差し替える
          let si = 0;
          for (let i = 1; i < e.stints.length; i++) if (e.stints[i].laps < e.stints[si].laps) si = i;
          const st2 = e.stints[si];
          const alt = D.DRY_TYRES.map(k => tyreOf(k))
            .filter(t => t.key !== keys[0] && t.life >= st2.laps * 0.85);
          st2.key = alt.length ? alt[0].key
            : (keys[0] === 'hard' ? 'medium' : 'hard');
          st2.forced = true;
        }
      }
      e.tyreKey = e.stints[0].key;
      e.stintIdx = 0;
      e.lapTyre = [];       // 各周のタイヤと使用周回数（観戦画面の表示に使う）
      e.pitTime = [];       // 各周のピット停止時間
      e.lapErs = [];        // 各周のバッテリー残量
      e.lapOrder = [];      // 各周にピットウォールが出していた指示
      e.order = 'hold';
      // ERS：エレクトロニクスの性能が高いほど容量も回生量も大きい
      const elecPower = e.isPlayer
        ? S.ersOf(g).power
        : (e.stats.accel * 0.42 + e.stats.speed * 0.12);
      const ers = S.ersFrom(elecPower);
      e.ersCap = ers.capacity;
      e.ersRecover = ers.recover;
      e.ersDeploy = ers.deploy;
      e.battery = ers.capacity;   // 満充電でスタート
    });

    let order = grid.slice();
    const posHistory = [];

    // 途中で天気が変わるかどうかを先に決めておく（実況では出さない）
    if (!special && laps >= 12 && Math.random() < 0.30) {
      wxTo = weather.wetTyres
        ? D.WEATHER[Math.random() < 0.55 ? 1 : 0]                    // 雨が上がる
        : D.WEATHER[Math.random() < 0.30 ? 3 : 2];                   // 降り出す
      wxAt = S.rint(Math.round(laps * 0.22), Math.round(laps * 0.74));
    }

    for (let lap = 1; lap <= laps; lap++) {
      /* ---- 路面が変わっていく ----
         雨はセクター1から来て奥へ抜けていく。乾くときも同じ順。
         「セクター2だけまだ濡れている」という時間が生まれる         */
      if (shower) {
        shower.left--;
        if (shower.left <= 0) { wetTarget = shower.back; shower = null; }
      } else if (!special && lap > 3 && lap < laps - 3 && Math.random() < 0.012) {
        // 通り雨。数周だけ強く降って、また引いていく
        shower = { left: S.rint(3, 6), back: wetTarget };
        wetTarget = Math.min(1, Math.max(wetTarget, 0.35) + S.rnd(0.18, 0.42));
        events.push({ lap, type: 'weather',
          text: '🌦️ 一部のセクターに雨雲がかかった！ 路面が濡れはじめる' });
        wxChangedThisLap = true;
      }
      for (let k = 0; k < 3; k++) {
        const rate = 0.40 - k * 0.09;                 // 手前のセクターから変わる
        wetSec[k] += (wetTarget - wetSec[k]) * rate;
        if (Math.abs(wetTarget - wetSec[k]) < 0.01) wetSec[k] = wetTarget;
      }
      wetLog[lap - 1] = [Math.round(wetSec[0] * 100) / 100,
                         Math.round(wetSec[1] * 100) / 100,
                         Math.round(wetSec[2] * 100) / 100];
      const wnow = wetAvg();
      // 路面が濡れるほどグリップが落ち、荒れる
      wx.grip = 1 - wnow * 0.15;
      wx.chaos = 1 + wnow * 1.35;
      wx.wet = wnow >= 0.30;
      wx.level = wnow;

      // 天候の急変。全車があわててタイヤを替えに来る
      if (wxTo && lap === wxAt) {
        wx = { key: wxTo.key, grip: wxTo.grip, chaos: wxTo.chaos,
               wet: wxTo.key === 'rain' || wxTo.key === 'storm' };
        wetTarget = wxTo.wetTo != null ? wxTo.wetTo : (wx.wet ? 0.6 : 0);
        wxInfo.at = lap; wxInfo.to = wxTo.name; wxInfo.icon = wxTo.icon;
        wxChangedThisLap = true;
        events.push({ lap, type: 'weather',
          text: wxTo.icon + ' 天候が変わった！ ' + weather.name + ' → ' + wxTo.name
              + '（' + (wx.wet ? 'ウェットタイヤへ' : 'ドライタイヤへ') + '）' });
        order.forEach(e => {
          if (e.dnf || lap >= laps - 1) return;
          // いま履いているもので大きく損をしないなら、慌てて入らない
          if (wetLoss(tyreOf(e.tyreKey), wetTarget) < 0.02) return;
          // 読みの速いチームほど早く動ける
          const delay = S.clamp(Math.round(3.4 - e.react * 2.8 + S.rnd(-0.5, 1.4)), 1, 6);
          const at = Math.min(laps - 1, lap + delay);
          e.pitPlan = e.pitPlan.filter(p => p > at + 3);
          e.pitPlan.push(at);
          e.pitPlan.sort((a, b) => a - b);
        });
        wxTo = null;
      }
      order.forEach(e => {
        if (e.dnf) return;

        // 基準ラップタイム
        let t = track.base * (1 + (refPerf - e.perf) * 0.00092);
        t *= (1 - e.st.pace);
        t /= wx.grip;

        // タイヤの銘柄によるペース差
        const ty = tyreOf(e.tyreKey);
        t *= ty.pace;

        // 路面と銘柄が噛み合っていないぶんだけ遅くなる。
        // 「合っている／合っていない」ではなく、ずれた量で効く
        t *= 1 + wetLoss(ty, wx.level);

        // タイヤ摩耗。寿命を超えると急激にタレる
        e.tyreAge++;
        // 軽い車体はタイヤを痛めない（ライバル基準の 0.5 で ±0 になるように正規化する）
        const wearMul = (1 - e.bd.light * 0.22) / (1 - RIVAL_BODY_REF * 0.22);
        t += track.base * e.tyreAge * 0.00075 * track.tyre * e.tyreSkill * e.st.tyre * ty.wear * wearMul;
        const over = e.tyreAge - ty.life;
        if (over > 0) t += track.base * over * over * 0.0006 * e.tyreSkill * wearMul;
        e.lapTyre[lap - 1] = { key: e.tyreKey, age: Math.round(e.tyreAge), life: ty.life };

        // スタミナ低下（終盤）— アイアンマンは影響を受けない
        if (lap > laps * 0.6 && !e.sk('stamina')) {
          t += track.base * 0.0006 * (1 - e.driver.stamina / 200) * (lap - laps * 0.6)
             * ((1 - e.bd.cool * 0.35) / (1 - RIVAL_BODY_REF * 0.35));
        }

        // ラストスパート
        if (e.sk('spurt') && lap > laps * 0.8) t *= 0.994;

        // ERS：溜まっている電気を放電して速さに変える。
        // 前の車に迫っているときは多めに使う（前周の差で判定）
        const want = e.ersDeploy * (e.chasing ? E.attackMul : 1);
        const use = Math.min(e.battery, want);
        e.battery = Math.min(e.ersCap, e.battery - use + e.ersRecover);
        t *= (1 - use * E.gainPerUnit * ersScale);
        e.lapErs[lap - 1] = { level: Math.round(e.battery), cap: e.ersCap, used: Math.round(use) };

        // 次の周にピットへ入るなら、履くタイヤをこの時点で決めておく。
        // 無線で読み上げるのも、実際に履くのも同じものにするため
        if (e.pitPlan.indexOf(lap + 1) >= 0 && !e.pitTyre) {
          const keep = e.stintIdx;
          e.stintIdx = Math.min(e.stints.length - 1, e.stintIdx + 1);
          e.pitTyre = tyreForNow(e, lap + 1);
          e.stintIdx = keep;
        }

        // ---- ピットウォールの指示 ----
        // 攻めれば速いがタイヤを食い、抑えればタイヤは保つが遅い。
        // 無線で言っていることが、そのままここで効く
        const scNow2 = scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps;
        const ordKey = scNow2 ? 'hold' : decideOrder(e, lap, laps, ty);
        if (ordKey !== e.order) { e.orderChanged = lap; e.order = ordKey; }
        // 攻めた周を数えておく。続けざまには出せない
        e.pushLaps = ordKey === 'push' ? (e.pushLaps || 0) + 1 : Math.max(0, (e.pushLaps || 0) - 1);
        const ord = orderOf(ordKey);
        t *= (1 + ord.pace);
        e.tyreAge += ord.wear;
        e.lapOrder[lap - 1] = ordKey;

        // ---- 前の車との関係 ----
        // 直線では前車の後ろが速く（スリップストリーム）、
        // コーナーでは前車の乱れた空気で曲がらない（乱気流）。
        // 抜きにくいコースほど乱気流がきつく、張りついたまま抜けない
        if (e.gapAhead != null && e.gapAhead < 1.5) {
          const near = 1 - e.gapAhead / 1.5;               // 0..1
          const dirty = 1.7 - passEase;                    // 抜きにくいほど大きい
          t -= track.base * 0.0042 * near * (0.35 + geo.longestShare * 2.2);
          t += track.base * 0.0060 * near * near * dirty
             * ((1 - e.bd.aero * 0.30) / (1 - RIVAL_BODY_REF * 0.30));
          if (e.gapAhead < 0.9) e.tyreAge += 0.26;         // 前について走るとタイヤが焼ける
        }
        // ---- 後ろから来られている ----
        // 守るために普段より攻めた走りになる。速くはなるが、そのぶん削れる
        if (e.gapBehind != null && e.gapBehind < 1.6) {
          const push = 1 - e.gapBehind / 1.6;
          t -= track.base * 0.0034 * push * (0.55 + e.driver.mental / 240);
          e.tyreAge += 0.20 * push;
          e.defending = push;
        } else {
          e.defending = 0;
        }

        // ランダム（精密機械はブレが小さい）
        const jitter = (e.sk('precise') ? 0.45 : 1) * (1 - (e.bd.drive - RIVAL_BODY_REF) * 0.42);
        t += track.base * S.rnd(-0.0035, 0.0045) * jitter * wx.chaos * (1 - e.driver.mental / 400);

        // ---- ドライバーのミス ----
        // 終わったタイヤ、濡れた路面、攻めすぎ、切れた集中——
        // どれかが噛み合うと、ふっと足元をすくわれる。
        // 乗りやすいマシン（ドライバビリティ）ほど、これが起きにくい
        if (lap > 1) {
          const tyreOver = Math.max(0, e.tyreAge - ty.life);
          let mp = 0.0090
                 * (1 + (e.st.risk - 1) * 0.50)
                 * (1.55 - e.driver.mental / 190)
                 * (1 + tyreOver * 0.075)
                 * (0.55 + wx.chaos * 0.45)
                 * ((1 - e.bd.drive * 0.25) / (1 - RIVAL_BODY_REF * 0.25))
                 * (e.sk('precise') ? 0.58 : 1)
                 * (e.driver.hurt ? 1.35 : 1)
                 * (1 + (e.defending || 0) * 0.45)      // 守っているときほど乱れやすい
                 * orderOf(e.order).miss;               // 攻めろと言われた周ほど乱れやすい
          if (scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps) mp = 0;   // 隊列を流している間は起きない
          if (Math.random() < mp) {
            // 大きく崩したか、こらえたか
            const big = Math.random() < 0.16 + (e.st.risk - 1) * 0.10;
            const lost = big ? S.rnd(4.5, 11.0) : S.rnd(0.4, 2.4);
            t += lost;
            e.tyreAge += big ? 1.6 : 0.5;
            e.misses = (e.misses || 0) + 1;
            if (big && e.isPlayer) e.radioMiss = lap;
            // 何が原因だったかで、言い回しを変える
            const pool = big ? SAY.missBig
                       : wx.wet && Math.random() < 0.7 ? SAY.missWet
                       : tyreOver > 0 ? SAY.missTyre
                       : e.st.risk > 1.4 && Math.random() < 0.6 ? SAY.missPush
                       : SAY.miss;
            if (e.isPlayer || big || Math.random() < 0.22) {
              events.push({ lap: lap, type: 'miss', car: e,
                text: say(pool, { A: e.driver.name, C: lm(track) }) +
                      '（-' + lost.toFixed(1) + '秒）' });
            }
            // 大きく外れたまま順位を保っていると、審査が入る
            if (big && Math.random() < 0.18) givePenalty(e, 'limits', lap, events, laps);
          }
        }

        // スタート（1周目）
        if (lap === 1) t += e.grid * 0.42 - e.startBoost + track.base * 0.10;

        // セーフティカー中は全車そろって流す。差はほとんど開かない
        const underSC = scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps;
        if (underSC) {
          if (scInfo.virtual) {
            // バーチャル：全車が同じ割合で落とすので、差はそのまま残る
            t *= 1.26;
            e.tyreAge = Math.max(0, e.tyreAge - 0.2);
          } else {
            t = track.base * 1.34 + S.rnd(-0.15, 0.15);
            e.tyreAge = Math.max(0, e.tyreAge - 0.35);    // 流している間はタイヤも保つ
          }
        }

        // ピットイン（新しいタイヤに履き替える）
        let pitAdd = 0;
        if (e.pitPlan.indexOf(lap) >= 0) {
          // セーフティカー中は隊列が遅いので、失う時間が小さい
          const scCheap = underSC ? (scInfo.virtual ? 0.68 : 0.42) : 1;
          const miss = e.isPlayer ? 0.035 + cw.mistake : 0.035;
          const loss = (e.pitLoss + S.rnd(-0.8, 2.2) + (Math.random() < miss ? S.rnd(3, 9) : 0)) * scCheap;
          t += loss;
          pitAdd = loss;
          e.tyreAge = 0;
          e.pits.push(lap);
          // ピットレーンでの速度超過。慌てているチームほど出る
          if (Math.random() < 0.012 * (e.isPlayer ? Math.max(0.4, 1 - strategist * 0.25) : 1)) {
            givePenalty(e, 'speeding', lap, events, laps);
          }
          e.stintIdx = Math.min(e.stints.length - 1, e.stintIdx + 1);
          e.tyreKey = e.pitTyre || tyreForNow(e, lap);
          e.pitTyre = null;
          if (e.isPlayer) {
            const nt = tyreOf(e.tyreKey);
            events.push({ lap, type: 'pit', car: e,
              text: say(loss > e.pitLoss + 3 ? SAY.pitSlow : SAY.pit,
                { A: e.driver.name, B: nt.name, P: loss.toFixed(1) }) });
          }
        }
        e.pitTime[lap - 1] = pitAdd;

        e.lapTimes[lap - 1] = t;
        const prev = lap === 1 ? 0 : e.cum[lap - 2];
        // 罰則はラップタイムではなく持ち時間に足す（区間タイムの表示を汚さない）
        e.cum[lap - 1] = prev + t + (e.penPending || 0);
        e.penPending = 0;
        if (lap > 1 && t < e.fastest) e.fastest = t;

        // 区間タイム：走行ぶんはマシンの速度プロファイルの配分で割り、
        // ピットでの停止時間は最終セクターにまとめて足す
        const sh = e.prof.share;
        const drive = t - pitAdd;
        const sec = [drive * sh[0], drive * sh[1], drive * sh[2] + pitAdd];
        e.sectors[lap - 1] = sec;
        for (let k = 0; k < 3; k++) {
          if (lap > 1 && sec[k] < e.bestSec[k]) e.bestSec[k] = sec[k];
          if (lap > 1 && sec[k] < bestSector[k]) { bestSector[k] = sec[k]; bestSectorBy[k] = e.id; }
        }
      });

      // ブロッキング（前車に詰まると遅くなる＝抜きにくいコースほど顕著）
      const running = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
      running.forEach(e => { e.chasing = false; });
      for (let i = 1; i < running.length; i++) {
        const gap = running[i].cum[lap - 1] - running[i - 1].cum[lap - 1];
        // 2秒以内なら次の周はERSを多めに使って仕掛ける
        if (gap > 0 && gap < 2.0) running[i].chasing = true;
        // ---- 追い抜きの攻防 ----
        // 0.8秒以内まで詰めたら仕掛ける。コースの性格で、
        // 「ストレートで刺す」か「コーナーで飛び込む」かが変わる。
        const scNow = scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps;
        if (!scNow && gap > 0 && gap < 0.90) {
          const atk = running[i], def = running[i - 1];
          // ストレートが長いコースほど、直線勝負になりやすい
          const onStraight = Math.random() < Math.min(0.88, 0.15 + passEase * 0.85);
          const batt = atk.ersCap ? atk.battery / atk.ersCap : 0;

          // 射程に入ってからが長い。詰めるところまでは速さの差で行けるが、
          // 最後の数十センチは、直線の長さと電気の残りが決める。
          // 「近づけるのに抜けない」時間は、ここで生まれる
          const merit = Math.max(0, atk.perf - def.perf);
          let p = 0.010 + merit * 0.010;
          if (onStraight) {
            // 直線：電気が残っているほど伸びる。スリップストリームも効く
            p += 0.050 + batt * 0.15 + geo.longestShare * 0.42;
          } else {
            // コーナー：腕とマシンのコーナー性能がものを言う
            p += (atk.driver.technique - def.driver.technique) * 0.004
               + (atk.stats.corner - def.stats.corner) * 0.0012;
          }
          if (atk.sk('passer')) p += 0.12;
          if (def.sk('heart')) p -= 0.08;             // 勝負強い相手は簡単には譲らない
          if (atk.st) p += (atk.st.risk - 1) * 0.055;      // 攻める作戦ほど仕掛けが決まる
          if (atk.isPlayer) p += S.osk(g, 'call') * 0.08;    // 采配
          // コースの抜きやすさで全体を大きく上下させる。
          // 市街地では滅多に抜けず、直線の長いコースでは何度も入れ替わる。
          // 空力コンセプトが良いほど、前車の乱気流の中でも走れる
          p *= (0.18 + passEase * 1.24) * ((1 + atk.bd.aero * 0.20) / (1 + RIVAL_BODY_REF * 0.20));
          // 一度でしくじると、次の周は前の乱気流でさらに苦しくなる。
          // 「射程に入っているのに抜けない」時間を作るための締め
          p *= 0.46;
          // 何周も張りついていると、しびれを切らして強引に行く
          p *= 1 + Math.min(0.9, (atk.stuckLaps || 0) * 0.12);
          p = S.clamp(p, 0.005, 0.72);

          if (Math.random() < p) {
            // 成功：前に出る。詰まっていた時間もここで解ける
            atk.cum[lap - 1] = def.cum[lap - 1] - S.rnd(0.08, 0.28);
            atk.passes = (atk.passes || 0) + 1;
            atk.stuckLaps = 0;
            // 実況。自チームが絡む攻防と、上位の攻防は必ず伝える
            if (atk.isPlayer || def.isPlayer || i <= 3) {
              const v = { A: atk.driver.name, B: def.driver.name, C: lm(track), P: i };
              const pool = i === 1 ? SAY.passLead
                         : lap > laps * 0.85 ? SAY.passLate
                         : onStraight ? SAY.passStraight : SAY.passCorner;
              events.push({ lap: lap, type: 'pass', car: atk, text: say(pool, v) });
            }
            // 強引に決めた一撃は、あとで咎められることがある
            // グリッドで審査の基準を聞いてきた週は、咎められにくい
            const rough = (onStraight ? 0.010 : 0.030)
                        * (atk.st ? atk.st.risk : 1)
                        * (1 - atk.driver.technique / 320)
                        * (atk.isPlayer && g.gridClean ? 0.45 : 1);
            if (Math.random() < rough) givePenalty(atk, 'contact', lap, events, laps);
          } else {
            // 失敗：抜けずに詰まる。コーナーで無理をすると足を痛める
            let stuck = (0.55 - gap) * (2.1 - passEase * 0.8);
            if (atk.sk('passer')) stuck *= 0.55;
            atk.cum[lap - 1] += stuck;
            atk.stuckLaps = (atk.stuckLaps || 0) + 1;
            // 抜けなかったことも、たまには言葉にする（毎周だとうるさいので控えめに）
            if ((atk.isPlayer || def.isPlayer) && Math.random() < 0.16) {
              events.push({ lap: lap, type: 'miss', car: atk,
                text: say(SAY.stuck, { A: atk.driver.name, B: def.driver.name, C: lm(track) }) });
            }
            if (!onStraight && Math.random() < 0.05 + (atk.st ? (atk.st.risk - 1) * 0.05 : 0)) {
              const miss = S.rnd(0.7, 2.3);
              atk.cum[lap - 1] += miss;
              atk.tyreAge += 0.6;                     // 無理をするとタイヤも傷む
              if (atk.isPlayer) {
                events.push({ lap: lap, type: 'miss', car: atk,
                  text: say(SAY.missPush, { A: atk.driver.name, C: lm(track) }) +
                        '（-' + miss.toFixed(1) + '秒）' });
              }
              // はみ出したまま順位を保っていると、審査が入る
              if (Math.random() < 0.24 * (atk.isPlayer && g.gridClean ? 0.45 : 1)) givePenalty(atk, 'limits', lap, events, laps);
            }
          }
        }

        // ---- アンダーカット ----
        // 前の車に詰まっていて、抜きにくいコースで、自分のピット予定が近いなら、
        // 1周早く入って新しいタイヤで前に出ることを狙う。
        // 逆に前の車が先に入ったら、こちらは引っ張って（オーバーカット）応じる。
        const me = running[i], ahead = running[i - 1];
        if (!me.dnf && me.pitPlan.length && gap > 0 && gap < 2.6 && passEase < 0.95) {
          const next = me.pitPlan.find(l => l > lap);
          if (next != null && next - lap <= 3 && next > lap + 1 &&
              Math.random() < me.react * 0.34) {
            me.pitPlan[me.pitPlan.indexOf(next)] = lap + 1;
            me.pitPlan.sort((a, b) => a - b);
            me.undercut = (me.undercut || 0) + 1;
            if (me.isPlayer || ahead.isPlayer) {
              events.push({ lap: lap + 1, type: 'pit', car: me,
                text: me.driver.name + ' アンダーカットを狙って1周早くピットへ！' });
            }
          }
        }
      }

      // リタイア判定
      order.forEach(e => {
        if (e.dnf || lap < 2) return;
        const mech = (100 - e.rel) / 100 * 0.0022 * track.risk * (e.sk('feeler') ? 0.55 : 1);
        const crash = (1 - e.driver.mental / 230) * 0.0011 * track.risk * wx.chaos * e.st.risk
                    * ((1 - e.bd.rigid * 0.30) / (1 - RIVAL_BODY_REF * 0.30))
                      * (e.sk('heart') ? 0.40 : 1);
        const r = Math.random();
        if (r < mech) {
          e.dnf = true; e.dnfLap = lap; e.dnfReason = S.pick(['エンジンブロー', 'ギアボックストラブル', '油圧系トラブル', 'MGU-K故障', 'ブレーキトラブル']);
          events.push({ lap, type: 'dnf', car: e,
            text: say(SAY.dnfMech, { A: e.driver.name, B: e.dnfReason, C: lm(track) }) });
        } else if (r < mech + crash) {
          e.dnf = true; e.dnfLap = lap; e.dnfReason = S.pick(['クラッシュ', 'コースアウト', '接触']);
          events.push({ lap, type: 'dnf', car: e,
            text: say(SAY.dnfCrash, { A: e.driver.name, B: e.dnfReason, C: lm(track) }) });
          // マシンがコース上に止まると、セーフティカーが入ることがある
          if (scLaps <= 0 && lap < laps - 2 && e.dnfReason !== 'コースアウト' &&
              Math.random() < 0.62 + track.risk * 0.18) {
            scPending = true;
          }
        }
      });

      // ---- セーフティカー ----
      // 隊列が詰まるので、大きなリードも一度リセットされる。
      // ここで入るか引っ張るかが、レースの分かれ目になる。
      if (scPending && !scDone) {
        scPending = false; scDone = true; scStarted = true;
        // 障害物がコース脇で済むならバーチャル、コース上に残るなら実車が出る。
        // バーチャルは全車が一斉に減速するだけで、差はそのまま残る。
        const virtual = Math.random() < 0.45;
        scLaps = virtual ? S.rint(2, 3) : S.rint(3, 5);
        scFrom = lap + 1;
        scInfo.from = scFrom; scInfo.laps = scLaps; scInfo.virtual = virtual;
        const run = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
        if (!virtual) {
          const lead = run.length ? run[0].cum[lap - 1] : 0;
          run.forEach((e, i) => {
            // 先導車の後ろに一列に並び直す
            e.cum[lap - 1] = lead + i * S.rnd(0.55, 0.95);
            e.scBunched = true;
          });
        }
        events.push({ lap: lap, type: 'sc',
          text: virtual
            ? '🟡 バーチャルセーフティカー！ 全車が一斉にペースを落とす（' + scLaps + '周）'
            : '🚨 セーフティカー出動！ 先導車の後ろに一列に詰まる（' + scLaps + '周）' });
        // 隊列が遅いあいだはピットの損失が小さい。作戦が動く
        // （バーチャルは全車が同じだけ遅いので、得は小さい）
        run.forEach(e => {
          if (virtual && Math.random() < 0.55) return;
          const next = e.pitPlan.find(l => l > lap);
          if (next == null) return;
          // 予定が遠くても、安いピットなら前倒しする価値がある
          const worth = (next - lap) <= Math.round(laps * 0.45);
          if (worth && Math.random() < 0.55 + (e.react || 0.4) * 0.4) {
            e.pitPlan[e.pitPlan.indexOf(next)] = lap + 1;
            e.pitPlan.sort((a, b) => a - b);
            e.scPit = true;
            if (e.isPlayer) {
              events.push({ lap: lap + 1, type: 'pit', car: e,
                text: e.driver.name + ' セーフティカー中にピットへ！ ロスが小さい' });
            }
          }
        });
      }

      // ---- 次の周のために、前後の車間を控えておく ----
      const now2 = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
      now2.forEach((e, i) => {
        e.gapAhead = i > 0 ? now2[i - 1].cum[lap - 1] != null
          ? e.cum[lap - 1] - now2[i - 1].cum[lap - 1] : null : null;
        e.gapBehind = i < now2.length - 1
          ? now2[i + 1].cum[lap - 1] - e.cum[lap - 1] : null;
      });

      // ---- チーム無線 ----
      radioTick({ lap: lap, laps: laps, order: order, radio: radio,
                  scStart: scStarted, scVirtual: scInfo.virtual,
                  wxChanged: wxChangedThisLap, wxWet: wx.wet });
      scStarted = false; wxChangedThisLap = false;

      // 順位変動の記録
      const newOrder = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
      if (lap > 1) {
        newOrder.forEach((e, i) => {
          const prevIdx = posHistory[posHistory.length - 1].indexOf(e.id);
          if (prevIdx >= 0 && prevIdx > i && e.isPlayer) {
            const victim = newOrder[i + 1];
            if (victim) events.push({ lap, type: 'pass', car: e, text: e.driver.name + ' が ' + victim.driver.name + ' をオーバーテイク！ → ' + (i + 1) + '位' });
          }
        });
      }
      posHistory.push(newOrder.map(e => e.id));
      order = newOrder.concat(order.filter(e => e.dnf));
    }

    // 最終結果
    const finishers = entries.filter(e => !e.dnf).sort((a, b) => a.cum[laps - 1] - b.cum[laps - 1]);
    const retired = entries.filter(e => e.dnf).sort((a, b) => b.dnfLap - a.dnfLap);
    const classified = finishers.concat(retired);
    classified.forEach((e, i) => { e.pos = i + 1; });

    // ---- チェッカー後の無線 ----
    classified.forEach(e => {
      if (!e.isPlayer) return;
      const V = { D: e.driver.name, P: e.pos, N: 0 };
      const at = e.dnf ? Math.max(1, e.dnfLap) : laps;
      const pair = e.dnf ? [RADIO.dnfPit, RADIO.sorry]
                 : e.pos === 1 ? [RADIO.win, RADIO.thanks]
                 : e.pos <= 3 ? [RADIO.podium, RADIO.thanks]
                 : e.pos <= D.POINTS.length ? [RADIO.points, RADIO.thanksOk]
                 : [RADIO.plain, RADIO.thanksOk];
      radio.push({ lap: at, from: 'pit', name: e.driver.name, id: e.id, text: say(pair[0], V) });
      radio.push({ lap: at, from: 'drv', name: e.driver.name, id: e.id, text: say(pair[1], V) });
    });
    radio.sort((a, b) => a.lap - b.lap);

    let fl = null;
    finishers.forEach(e => { if (!fl || e.fastest < fl.fastest) fl = e; });

    return {
      track, trackIndex, weather, laps, grid, entries, classified, finishers,
      events, radio: radio, wetLog: wetLog, fastestLap: fl, geo: geo, passEase: passEase, special: special || null,
      bestSector: bestSector, bestSectorBy: bestSectorBy,
      safetyCar: scInfo.laps ? scInfo : null,
      hotTeam: entries.hotTeam || '',
      weatherChange: wxInfo.at ? wxInfo : null,
      totalTime: laps * track.base * 1.05
    };
  }

  /* ---------- レース結果をゲームに反映 ---------- */
  function applyResult(g, res) {
    const notes = [];
    const sp = res.special;
    const diff = S.diffOf(g);
    let prize = 0, fanDelta = 0;

    // ファステストラップは10位以内で完走した場合のみ1点（実際のF1と同じ扱い）
    const flCar = res.fastestLap;
    const flScores = !!(flCar && !flCar.dnf && flCar.pos <= D.POINTS.length);

    res.classified.forEach(e => {
      let pts = (!e.dnf && e.pos <= D.POINTS.length) ? D.POINTS[e.pos - 1] : 0;
      const gotFL = flCar && e.id === flCar.id;
      if (gotFL && flScores) pts += D.FASTEST_LAP_POINT;
      // 特別戦は選手権とは無関係。ポイントも通算成績も動かない
      e.points = sp ? 0 : pts;
      e.flPoint = !sp && gotFL && flScores;
      if (!sp) {
        e.driver.seasonPoints += pts;
        e.driver.races++;
        if (e.grid === 1) e.driver.poles = (e.driver.poles || 0) + 1;
        if (gotFL) e.driver.fastestLaps = (e.driver.fastestLaps || 0) + 1;
        if (e.dnf) e.driver.dnfs = (e.driver.dnfs || 0) + 1;
        else {
          if (e.pos === 1) e.driver.wins++;
          if (e.pos <= 3) e.driver.podiums++;
          if (e.pos < (e.driver.best || 99)) e.driver.best = e.pos;
        }
      }
      // 結果を受けての調子の変化は全ドライバーに等しく起きる
      S.reactToResult(e.driver, e.pos, e.dnf);
      if (e.isPlayer) {
        if (!sp) g.points += pts;
        const base = (800 + pts * 470 + (e.dnf ? 0 : Math.max(0, 1300 - e.pos * 50))) * diff.prize;
        prize += sp ? base * sp.prize : base;
        let gain = 12 + Math.max(0, 22 - e.pos) + (e.dnf ? 0 : 8);
        if (sp) gain = Math.round(gain * sp.lapMul) + (sp.exp || 0);
        e.driver.exp += Math.round(gain * (S.hasSkill(e.driver, 'grower') ? 1.5 : 1));
      } else if (!sp) {
        e.team.points += pts;
      }
    });

    // ---- ファン増減 ----
    // 順位そのものではなく、「ファンが期待していた順位」をどれだけ上回ったかで動く。
    // 弱小チームの7位は大喝采、強豪の7位は失望、という当たり前が効くようになる。
    const best = res.classified.filter(e => e.isPlayer).sort((a, b) => a.pos - b.pos)[0];
    const expect = S.fanExpectation(g);
    let fanNote = '';
    if (best) {
      const got = best.dnf ? 22 : best.pos;
      const beat = expect - got;                       // +なら期待より上
      const base = Math.round(90 + g.fans * 0.03);
      if (best.pos === 1)      { fanDelta = Math.round(600 + g.fans * 0.14); fanNote = '🏆 優勝！ 街中が歓喜に包まれた！'; }
      else if (best.pos <= 3)  { fanDelta = Math.round(300 + g.fans * 0.08); fanNote = '🥉 表彰台！ ファンが増えた！'; }
      else if (!best.dnf && best.pos <= 10) { fanDelta = Math.round(110 + g.fans * 0.03); fanNote = 'ポイント獲得。着実にファンが増えている。'; }
      else                     { fanDelta = -Math.round(30 + g.fans * 0.02); fanNote = best.dnf ? 'リタイア…ファンが少し離れてしまった。' : 'ノーポイント…ファンが少し離れてしまった。'; }
      // 期待との差ぶん
      fanDelta += Math.round(base * S.clamp(beat, -6, 8) * 0.34);
      if (beat >= 4) fanNote = '🎉 誰も期待していなかった ' + got + '位！ ファンが一気に増えた！';
      else if (beat <= -4 && !best.dnf) fanNote = '😞 ' + expect + '位あたりを期待されていたのに ' + got + '位…ファンが離れた。';
      notes.push(fanNote + '（期待 ' + expect + '位）');

      // 母国グランプリ：地元のスタンドが自分の色で埋まる
      const homeDrv = g.drivers.filter(d => S.nationOf(d).flag === res.track.country);
      if (homeDrv.length) {
        const nm = homeDrv.map(d => d.name).join('・');
        if (best.pos <= 10 && !best.dnf) {
          fanDelta = Math.round(fanDelta * 1.6) + 220;
          notes.push('🎌 ' + res.track.country + ' は ' + nm + ' の母国グランプリ。地元の声援がファンを連れてきた！');
        } else {
          notes.push('🎌 ' + res.track.country + ' は ' + nm + ' の母国グランプリだったが、地元に良いところを見せられなかった…');
        }
      }
      if (sp) fanDelta = Math.round(Math.max(0, fanDelta) * sp.fans + 60 * sp.fans);
    }

    // ---- 注目度（露出）----
    // 入賞できなくても、より上位でゴールすれば話題にはなる
    let hypeDelta = 0;
    res.classified.filter(e => e.isPlayer).forEach(e => {
      if (e.dnf) { hypeDelta -= 2; return; }
      hypeDelta += (D.HYPE_BY_POS[e.pos - 1] || 0.2);
      if (e.grid === 1) hypeDelta += 3;                       // ポールポジション
      if (e.flPoint || (res.fastestLap && res.fastestLap.id === e.id)) hypeDelta += 3;
      const gained = e.grid - e.pos;
      if (gained > 0) hypeDelta += Math.min(6, gained * 0.4); // 追い上げも評価される
    });
    if (sp) hypeDelta *= 0.6;                                  // 特別戦は選手権より扱いが小さい
    hypeDelta *= (1 + S.mgr(g, 'principal') * 0.004);          // 発信力のあるプリンシパルほど話題になる
    const beforeTier = S.hypeTier(g).name;
    S.addHype(g, hypeDelta);
    const afterTier = S.hypeTier(g).name;
    if (afterTier !== beforeTier) {
      notes.push('📣 メディアでの扱いが「' + afterTier + '」に変わった！ スポンサー収入が伸びる。');
      res.hypeUp = afterTier;
    }
    res.hypeDelta = hypeDelta;

    // スポンサー報酬（種別によって資金・研究P・ファンのどれが入るかが変わる）
    const hb = S.hypeBonus(g) * (1 + S.mgr(g, 'principal') * 0.006);
    const spScale = (1 + g.facilities.market * 0.07) * hb * (sp ? 0.4 : 1) * diff.sponsor;
    let sponsorIncome = 0, sponsorRp = 0, sponsorFans = 0;
    g.sponsors.forEach(s2 => {
      sponsorIncome += (s2.per || 0) * spScale;
      sponsorRp     += (s2.rp || 0) * spScale;
      sponsorFans   += (s2.fan || 0) * spScale;
      // 達成ボーナスは契約上、シーズンあたりの回数に上限がある
      const hits = s2.hits || 0;
      if (!sp && best && !best.dnf && best.pos <= s2.need && hits < D.SPONSOR_BONUS_CAP) {
        s2.hits = hits + 1;
        sponsorIncome += (s2.bonus || 0);
        sponsorRp += (s2.bonusRp || 0);
        const kind = D.SPONSOR_KINDS[s2.kind] || D.SPONSOR_KINDS.cash;
        notes.push(kind.icon + ' ' + s2.name + ' の目標達成ボーナス！ +' +
          Math.round(s2.bonus || 0) + '万' + (s2.bonusRp ? ' / 研究P +' + s2.bonusRp : '') +
          '（今季 ' + s2.hits + '/' + D.SPONSOR_BONUS_CAP + '回目）');
      }
    });
    // タイトルスポンサー。冠がつくぶん、支払いも大きい
    const ts = S.titleOf(g);
    if (ts) {
      sponsorIncome += (ts.per || 0) * spScale;
      sponsorRp     += (ts.rp || 0) * spScale;
      sponsorFans   += (ts.fan || 0) * spScale;
    }
    sponsorIncome = Math.round(sponsorIncome);
    sponsorRp = Math.round(sponsorRp);
    sponsorFans = Math.round(sponsorFans);
    fanDelta += sponsorFans;

    // 事故で負傷することがある。次戦以降をリザーブが埋める
    res.classified.filter(e => e.isPlayer && e.dnf).forEach(e => {
      const crashed = ['クラッシュ', '接触'].indexOf(e.dnfReason) >= 0;
      if (!crashed) return;
      const p = 0.45 * (1 - e.driver.stamina / 300);
      if (Math.random() >= p) return;
      const out = S.injureDriver(g, e.driver, S.rint(1, 2));
      const cover = g.reserve && S.canDrive(g.reserve);
      notes.push('🚑 ' + e.driver.name + ' が事故で負傷。次の ' + out + '戦を欠場します。' +
        (cover ? 'リザーブの ' + g.reserve.name + ' が代役に入ります。'
               : 'リザーブがいないため、痛みを押しての出走になります。'));
    });
    // 欠場のカウントを1戦ぶん進める
    S.tickInjuries(g).forEach(d => {
      notes.push('🩹 ' + d.name + ' が復帰しました。');
    });

    // パーツの消耗。予備もツールも置いてきた週は、現場で手当てができない
    S.wearParts(g, S.rnd(2.6, 6.2) * res.track.risk * (sp ? sp.wear : 1) * S.logiLoad(g).wear);
    // 持ってきた予備で、いちばん傷んだところを直しておく
    const fixed = S.useSpares(g);
    if (fixed) {
      notes.push('🧰 積んできた予備で ' + fixed.n + '点を手当てした（コンディション +' +
        fixed.gain + '）。');
    } else if (S.logiLoad(g).spares <= 0) {
      notes.push('🎒 軽装で来たため、傷んだ機材はそのまま持ち帰るしかなかった。');
    }
    // パワーユニットの消耗。攻める作戦ほど早く傷む
    const pushMul = res.classified.filter(e => e.isPlayer)
      .reduce((a, e) => Math.max(a, e.st ? e.st.risk : 1), 1) * (sp ? sp.wear * 0.4 + 0.6 : 1);
    if (g.pu) g.pu.grid = 0;                     // 前回の降格ぶんは消化済み
    const puRes = S.usePU(g, res.track, 0.55 + pushMul * 0.45);
    if (puRes.swapped) {
      if (puRes.reused) {
        notes.push('⚙️ パワーユニットを使い切ったので、取ってあった ' + puRes.reused +
          '基目（残り ' + puRes.life + '%）に載せ替えた。基数は増えていない。');
      } else {
        // 新品は買うもの。走り切ってしまったぶんも、ちゃんと請求が来る
        const puCost = S.puFreshCost(g);
        g.funds -= puCost;
        if (puRes.over) {
          notes.push('⚙️ ' + puRes.used + '基目のパワーユニットを投入（' + puCost +
            '万）。使用基数の上限（' + D.PU_LIMIT + '基）を超えたため、次戦は ' +
            puRes.grid + 'グリッド降格。');
        } else {
          notes.push('⚙️ ' + puRes.used + '基目のパワーユニットに載せ替えた（' + puCost +
            '万／今季あと ' + Math.max(0, D.PU_LIMIT - puRes.used) + '基）。');
        }
      }
    } else if (S.puOf(g).life < 40) {
      const pu2 = S.puOf(g);
      notes.push('⚙️ パワーユニットの残りが ' + Math.round(pu2.life) +
        '%。出力が ' + Math.round((1 - S.puForm(g)) * 100) + '%、信頼性が ' +
        Math.round(S.puRelDrop(g)) + ' 落ちている（今季あと ' +
        Math.max(0, D.PU_LIMIT - pu2.used) + '基／保管 ' + pu2.pool.length + '基）。');
    }
    // 輸送費の支払いと、クルーの消耗
    const ship = S.logiCost(g, res.track);
    g.funds -= ship;
    if (g.logi) g.logi.late = false;      // 今回の遅延は消化した
    const crewBefore = S.crewPenalty(g).level;
    S.tireCrew(g);
    const crewNow = S.crewPenalty(g).level;
    notes.push('🚚 ' + S.logiPlan(g).icon + ' ' + res.track.country + ' への輸送費 -' + ship + '万');
    if (crewNow >= 70 && crewBefore < 70) {
      notes.push('🧑‍🔧 クルーの疲れが限界に近い。ピット作業が遅れ、ミスも出はじめている。休養を。');
    }

    // 入賞できない状態が続いたら、開発チケットが届く（選手権のみ）
    if (!sp) {
      const scored = res.classified.some(e => e.isPlayer && !e.dnf && e.points > 0);
      if (scored) {
        g.dryStreak = 0;
      } else {
        g.dryStreak = (g.dryStreak || 0) + 1;
        if (g.dryStreak >= diff.ticket) {
          g.dryStreak = 0;
          g.tickets = (g.tickets || 0) + 1;
          notes.push('🎫 苦戦が続いたチームに開発チケットが届いた！（開発・設計を1回無料で行える）');
          res.gotTicket = true;
        }
      }
    }

    // 初優勝フラグ
    if (!sp && best && best.pos === 1 && !g.flags.firstWin) {
      g.flags.firstWin = true;
      notes.push('🎉 チーム初優勝！ 記念すべき一勝が刻まれた！');
    }

    // グッズと入場料。ファンがそのままチームの収入になる
    const merch = Math.round(S.fanIncome(g) * (sp ? 0.5 : 1));
    if (merch > 0) notes.push('🎫 グッズ・入場料 +' + merch + '万（' + S.fanTier(g).icon + S.fanTier(g).name + '）');
    g.funds += prize + sponsorIncome + merch;
    // 知名度の高いオーナーのチームは、同じ結果でもファンが増えやすい
    if (fanDelta > 0) fanDelta = Math.round(fanDelta * (1 + S.osk(g, 'fame') * 0.08));
    // 負けが込んでも、離れていくのは一度に1割ちょっとまで。
    // どんなときも残ってくれる人たちがいる
    if (fanDelta < 0) fanDelta = Math.max(fanDelta, -Math.round(g.fans * 0.12) - 20);
    g.fans = Math.max(120, g.fans + fanDelta);
    g.rp += (sp ? sp.rp : 8) + Math.round(S.staffBonus(g, 'analyst') * 2) + sponsorRp;

    res.reward = { prize, sponsorIncome, sponsorRp, sponsorFans, fanDelta, merch, notes };
    if (!sp) g.results.push({
      season: g.season, round: res.trackIndex + 1, track: res.track.name,
      weather: res.weather.name,
      rows: res.classified.slice(0, 22).map(e => ({
        pos: e.pos, name: e.driver.name, team: e.team.name, color: e.color,
        grid: e.grid, pts: e.points, dnf: e.dnf, isPlayer: e.isPlayer,
        fl: !!e.flPoint || !!(res.fastestLap && res.fastestLap.id === e.id)
      }))
    });
    return res.reward;
  }

  return { simulate, prequalify, applyResult, STRATEGIES, rollWeather };
})();

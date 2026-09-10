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
      '{A} が {B} をブレーキングで仕留めた！',
      '{A}、スリップに入った——そのまま横に出て {B} を抜き去る！',
      '{A} が {B} のミラーいっぱいに現れた！ もう止められない！',
      '{A}、トウをきれいに使った。{B} は反応できない！',
      '{A} が {B} をアウト側から。度胸のある仕掛けだ！'
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
      '{A} が {C} で強引に鼻をねじ込んだ！',
      '{A}、{C} でブレーキを遅らせた！ {B} の前に出る！',
      '{A} が {C} の1コーナー手前でフェイント——{B} が食いついた隙に前へ！',
      '{A}、{C} を抜けたところで {B} を並びなおして仕留めた！',
      '{A} が {C} でインを閉めた！ {B} は下がるしかない！'
    ],
    /* 抜いてトップに立った */
    passLead: [
      '{A} が {B} をとらえた！ ついにトップ！',
      '{A}、{B} を抜いて首位に立つ！ レースが動いた！',
      '先頭が入れ替わった！ {A} が {B} の前へ！',
      '{A} がついに {B} を仕留めた——ここからは自分のレースだ！',
      '{A}、トップに躍り出た！ ガレージが総立ちだ！',
      '{A} が {B} を攻略！ この瞬間、レースの色が変わった！',
      '首位交代！ {A} が {B} を退けて先頭へ！'
    ],
    /* 終盤の抜き */
    passLate: [
      '残りわずか、{A} が {B} を抜いた！ この一撃は大きい！',
      '土壇場！ {A} が {B} をかわして {P}位に浮上！',
      '最後の最後で {A}！ {B} は守りきれなかった！',
      '{A} が終盤に賭けた！ {B} をとらえて {P}位！',
      '残り数周でこの一撃！ {A} が {B} の前に出た！',
      '{A}、最後の力を振り絞って {B} をパス！ {P}位だ！'
    ],
    /* 抜けずに詰まった */
    stuck: [
      '{A}、{B} の背後に貼りつくが前に出られない…',
      '{A} が何度も顔を出すが、{B} が閉める！',
      '{A}、{C} で並びかけたが押し戻された…',
      '{A} は {B} の乱気流に苦しんでいる。近づくほど曲がらない',
      '{A}、仕掛けどころを探しているが糸口がない…',
      '{B} のブロックが巧い。{A} はまた1周を失う',
      '{A}、{C} で顔を出すが届かない。{B} が完璧にラインを守る',
      '{A} は近づけば近づくほど失速する。前のマシンが空気を乱している',
      '{A}、無線で苛立ちを見せる——それでも {B} は前にいる',
      '{A} が仕掛ける、しかし {B} も譲らない！ この2台、動かない'
    ],
    /* 小さなミス */
    miss: [
      '{A} {C} で膨らんだ！ タイムをロス…',
      '{A}、{C} の入口でわずかに乱れた…',
      '{A} が一瞬アンダーステアに苦しむ！',
      '{A}、縁石に乗りすぎてマシンが跳ねた！',
      '{A} がブレーキを残しすぎた…立ち上がりが鈍い',
      '{A}、シフトを一段まちがえた！ もったいない',
      '{A} が {C} でラインを外した！',
      '{A}、{C} でわずかにブレーキをロック。前が入らない',
      '{A} が {C} でリズムを崩した。細かいロスが積み重なる',
      '{A}、ギアが噛み合わない！ 一瞬の空白',
      '{A} が {C} で車体を暴れさせた。ひやりとする場面'
    ],
    /* タイヤが終わっているときのミス */
    missTyre: [
      '{A} {C} でフロントをロックさせた！ 白煙が上がる！',
      '{A}、タイヤが音を上げている。{C} で止まりきれない！',
      '{A} が {C} でずるりと滑った——タイヤの限界だ',
      '{A}、リアが出た！ タイヤはもう終わっている',
      '{A} が必死にカウンターを当てる！ グリップがない！',
      '{A}、タイヤがブリスターを起こしている。もう限界だ',
      '{A} が {C} で真っ白な煙を上げた！ フラットスポットができた！'
    ],
    /* 雨でのミス */
    missWet: [
      '{A} {C} で水たまりに乗った！ 大きくスライド！',
      '{A}、視界がない中で {C} をオーバーラン！',
      '{A} が白線に乗ってヒヤリ！ よく立て直した！',
      '{A}、リアが流れた！ 雨がじわじわ効いてくる',
      '{A} が {C} でハイドロプレーニング！ 肝が冷える！',
      '{A}、{C} で完全に前が見えない！ 手探りの走りだ',
      '{A} が川のようになった {C} でマシンを持っていかれかけた！'
    ],
    /* 攻めすぎたときのミス */
    missPush: [
      '{A}、攻めすぎた！ {C} で完全に行き過ぎた！',
      '{A} が突っ込みすぎてコースを外れた！',
      '{A}、限界を超えた！ {C} で大きくはらんだ！',
      '{A} が無理な体勢から立て直す！ 危ない！',
      '{A}、欲を出しすぎた！ {C} でタイヤをロックさせる！',
      '{A} が {C} で行き場を失った！ 攻めの代償だ'
    ],
    /* 大きなミス（スピン級） */
    missBig: [
      '{A} スピン！ {C} でコマのように回った！',
      '{A} がコースを飛び出した！ 砂煙が上がる！',
      '{A}、完全に姿勢を失った！ グラベルまで運ばれる！',
      '{A} スピンターン！ なんとかコースには戻ったが大きなロス…',
      '{A} が {C} でグラベルへ！ 順位を大きく落とす！',
      '{A}、{C} で完全にコントロールを失った！ 一回転！',
      '{A} が半回転！ 対向のマシンをかろうじてかわす！'
    ],
    /* 環境に負けてのスピン。何が原因かが伝わるように、銘柄を混ぜる */
    spin: [
      '{A} スピン！ {T} が路面に負けた！',
      '{A}、{C} でリアが抜けた！ {T} ではもう保たない！',
      '{A} が半回転！ タイヤが仕事をしていない！',
      '{A}、{C} の立ち上がりで挙動を乱した！ 大きなロス！',
      '{A} が {C} でコースを外れかける！ {T} が限界だ！',
      '{A}、こらえきれずスピン！ グリップがまるでない！'
    ],
    /* 溝のないタイヤで水に乗ってしまった */
    aqua: [
      '{A} が水に乗った！ {T} では止まれない！',
      '{A}、ハイドロプレーニング！ ハンドルが効いていない！',
      '{A} が真横を向いた！ {T} で雨の {C} は無理だ！',
      '{A}、水しぶきの向こうで完全に姿勢を失った！ タイヤが合っていない！'
    ],
    aquaOut: [
      '{A} が水に乗ったままバリアへ！ {T} のまま走り続けた代償だ…',
      '{A}、ハイドロプレーニングでコースアウト。雨の {C} に溝のないタイヤでは…',
      '{A} が {C} の外へ消えた。ピットに入れるべきだった…'
    ],
    spinOut: [
      '{A} スピンからそのままバリアへ！ {T} では戦えなかった…',
      '{A}、{C} で回ってグラベルに沈む。ここでレース終了…',
      '{A} がコースを飛び出し、そのまま止まった…',
      '{A}、耐えきれずコースアウト。{T} を履き続けた代償だ…'
    ],
    /* 機械の故障でリタイア */
    dnfMech: [
      '{A} が{B}でリタイア…',
      '{A}、{B}！ 白煙とともにマシンを止める…',
      '{A} のマシンが力を失った——{B}だ',
      '{A}、{B}でストップ。ガレージが沈黙する…',
      '{A} が路肩にマシンを寄せる。{B}——今日はここまで',
      '{A}、{B}。ステアリングを外してマシンを降りる…',
      '{A} のマシンから煙が上がった！ {B}だ',
      '{A}、無線で「終わった」——{B}'
    ],
    /* クラッシュでリタイア */
    dnfCrash: [
      '{A} が{B}！ ここでレースを終える…',
      '{A}、{B}！ マシンは大きなダメージ…',
      '{A} が{B}でストップ！ 無線に応答はない…',
      '{A}、{B}——一瞬の出来事だった',
      '{A} が {C} で{B}！ 週末が終わってしまった…',
      '{A} が {C} でバリアに！ {B}——マシンは動かない',
      '{A}、{B}！ 破片がコース上に散らばる！'
    ],
    /* ピットイン */
    pit: [
      '{A} ピットイン！ {B}に交換（静止{S}秒・計{P}秒）',
      '{A} が動いた！ {B}を履いて送り出す（静止{S}秒・計{P}秒）',
      '{A} ピットへ。{B}に履き替えて再スタート（静止{S}秒・計{P}秒）',
      '{A}、タイヤ交換！ {B}で残りを走りきる（静止{S}秒・計{P}秒）'
    ],
    /* 手間取ったピット */
    pitSlow: [
      '{A} ピットイン！ …作業が止まった！ {B}に交換（静止{S}秒・計{P}秒）',
      '{A} ピットイン、しかしタイヤがはまらない！ {B}（静止{S}秒・計{P}秒）',
      '{A} ピットで痛恨のロス！ {B}に交換（静止{S}秒・計{P}秒）'
    ],
    /* ファステストラップを更新した */
    fastest: [
      '{A} がファステストラップ！ {T} でこのペースは驚異的だ！',
      '{A}、この周でトップタイム！ まだ余力があるということか',
      '{A} が全体ベストを塗り替えた！ マシンが完全に決まっている',
      '{A}、ファステスト更新！ ガレージがモニターを見上げる'
    ],
    /* 表彰台圏に入った／落ちた */
    intoPodium: [
      '{A} が3位に浮上！ 表彰台が見えてきた！',
      '{A}、ついに表彰台圏内！ ここからは守りに入れない',
      '{A} が {P}位——シャンパンの射程に入った！'
    ],
    outPodium: [
      '{A} が表彰台圏から落ちた…{P}位',
      '{A}、譲るしかなかった。表彰台が遠ざかる…',
      '{A} が {P}位へ後退。ここから立て直せるか'
    ],
    /* 入賞圏に入った */
    intoPoints: [
      '{A} が10位以内に入った！ ポイント圏内だ！',
      '{A}、{P}位でポイント圏内！ 苦しいレースが報われるか',
      '{A} が入賞圏に滑り込んだ！ この1点が大きい'
    ],
    /* チームメイトどうしの争い */
    teammate: [
      '同士討ちは避けたい——{A} と {B}、同じ色の2台が並んだ！',
      '{A} と {B}、チームメイト同士の一騎打ち！ ピットは気が気でない',
      'ガレージが息を呑む。{A} が {B} の内に飛び込んだ！',
      '{A} と {B}、同じマシンで同じライン。譲る気配はない'
    ],
    /* 最終ラップ突入 */
    finalLap: [
      'ファイナルラップ！ 最後の1周が始まった！',
      '白熱のまま最終周へ。ここからは何が起きてもおかしくない！',
      '残り1周。全員がすべてを出しきる！'
    ],
    /* 母国グランプリ */
    home: [
      '{A} にとっては母国グランプリ。スタンドの声援が明らかに大きい',
      'ホームの {A}。この一戦にかける思いは特別だ',
      '{A} の国旗がスタンドを埋めている。母国での一戦だ'
    ],
    /* 隊列が遅いあいだのピット。ピットロードのぶんが安く済む */
    pitCheap: [
      '{A} この隊列でピットイン！ {B}に交換 — ロードのロスが{L}秒で済んだ（計{P}秒）',
      '{A} 絶好のタイミングでピットへ！ {B}に交換（ロード{L}秒・静止{S}秒）',
      '{A} 隊列が遅いうちに動いた！ {B}を履いて復帰（計{P}秒）'
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
    /* --- チームメイトと作戦を分けたとき --- */
    split: ['「言っておく。{B} とは作戦が違う。向こうは{NS}ストップだ」',
            '「作戦を分けた。{B} は{NS}ストップ、君はこのまま行く」',
            '「{B} とは別のことをやる。並んでも気にするな。順番はあとで整える」'],
    splitBack: ['「了解。自分の作戦に集中する」',
                '「わかった。向こうは向こう、こっちはこっちだな」',
                '「コピー。こっちのリズムで行く」'],
    splitNear: ['「{B} が近いが、作戦が違う。無理に争うな」',
                '「同士討ちだけは避けてくれ。ストップの数が違う」',
                '「向こうはあとで入る。いま抑えても、あとで前に出られる」'],
    splitNearBack: ['「分かってる。当てはしない」',
                    '「争わないよ。作戦を信じる」',
                    '「了解。自分のペースを守る」'],
    /* --- 周回遅れの列 --- */
    blue: ['「前に周回遅れが{NB}台。青旗は出ている、落ち着いて処理してくれ」',
           '「周回遅れの列に入る。焦らず、きれいに抜いてくれ」',
           '「前がごちゃついている。1台ずつ確実に片付けよう」'],
    blueBack: ['「見えている。1台ずつ行く」',
               '「なかなかどいてくれないな」',
               '「了解。無理はしない」'],
    /* --- ピットで手当てしたあと --- */
    fixed: ['「見た目は良くなった。数字も戻っている。行けるはずだ」',
            '「手は入れた。これで少しは楽になる」',
            '「応急だが押さえた。あとは君の腕次第だ」'],
    fixedBack: ['「だいぶマシだ。これなら走れる」',
                '「了解、感触が戻った」',
                '「まだ違和感はあるが、さっきよりずっといい」'],
    /* --- 「順位より、持って帰ってくれ」--- */
    cool: ['「ここは無理をするな。順位は守れればいい」',
           '「ここからは車を労わってくれ。まとめて持ち帰ろう」',
           '「ポイントは持って帰るぞ。抑えていこう」',
           '「もう十分だ。無理をしないで、きれいにまとめてくれ」',
           '「一度落ち着こう。マージンを取って走ってくれ」'],
    coolWet: ['「路面が良くない。無理はするな、抑えて走ってくれ」',
              '「水の上だ。攻めるところじゃない。持って帰ってくれ」',
              '「雨脚が強い。今日は完走が仕事だ。落ち着いていこう」',
              '「白線には乗るな。マージンを取って、丁寧に」'],
    coolBack: ['「了解。抑える」',
               '「わかった。まとめて持って帰る」',
               '「そうする。ここは我慢だな」',
               '「コピー。マージン取って走る」'],
    /* --- スタート前。グリッドについてから、フォーメーションまでの一往復 --- */
    gridPole: ['「聞こえるか。今日はいちばん前だ。あとは出るだけでいい」',
               '「ポールだ。1コーナーまでは誰も前にいない。思いきり行け」',
               '「最前列。ここまで来たのは君の仕事だ。あとは楽しんでこい」'],
    gridFront: ['「P{G} スタート。前は見えている。1周目で決めにいこう」',
                '「P{G}。表彰台の射程だ。落ち着いて、いつも通りに」',
                '「{G}番手。悪くない位置だ。1コーナーだけは慎重に」'],
    gridMid: ['「P{G}。長いレースになる。前半は我慢だ」',
              '「{G}番手スタート。混戦になる、無理はしなくていい」',
              '「P{G}。ここからでも取れる。作戦は用意してある」'],
    gridBack: ['「P{G}。今日は下から行く。焦らず、拾えるものを拾おう」',
               '「後方スタートだ。1周目を生き残れば、まだ何でもできる」',
               '「P{G}。ここから前に出るところを、みんなに見せてやれ」'],
    gridWet: ['「路面はもう濡れている。最初の3周が全部だ。慎重に」',
              '「ウェットスタート。視界は悪い、前についていくな」',
              '「雨だ。今日は我慢した者が勝つ。焦らないでくれ」'],
    /* --- ドライバー → ピット（スタート前の返事）--- */
    gridHot: ['「わかってます。今日は獲りにいきます」',
              '「クルマ、いい感じです。全部出します」',
              '「準備できてます。行きましょう」'],
    gridCalm: ['「了解。いつも通りやります」',
               '「はい。1コーナーは見ておきます」',
               '「大丈夫です。行けます」'],
    gridLow: ['「……了解です。できることをやります」',
              '「わかりました。まずは生き残ります」',
              '「はい。とにかく最後まで持って帰ります」'],
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
             '「チェッカー、P{P}。素晴らしい走りだった」',
             '「表彰台、表彰台！ よく持ち帰ってくれた！」',
             '「P{P}。この一歩は大きい。おめでとう」'],
    points: ['「チェッカー、P{P}。ポイントを持ち帰った。よくやった」',
             '「P{P} でフィニッシュ。悪くない一日だ」'],
    plain: ['「チェッカー、P{P}。今日はここまでだ。お疲れさま」',
            '「P{P}。持ち帰れたことをよしとしよう」'],
    aqua: ['「そのタイヤでは水を掻き出せない。すぐ入れ、いますぐだ」',
           '「ドライのままでは走れない。次の周、絶対にボックスだ」',
           '「無理をするな。タイヤが合っていない、持ち帰ることを考えろ」'],
    aquaBack: ['「まったく止まりません。真っ直ぐしか走れない」',
               '「水に乗ります。これ以上は本当に危ないです」',
               '「タイヤが仕事をしていません。早く入れてください」'],
    spin: ['「大丈夫か！ いまのは見えた。落ち着いていこう」',
           '「そのタイヤではもう戦えない。次の周、入るぞ」',
           '「無理をするな。いまはクルマを持ち帰ることが先だ」'],
    spinBack: ['「すみません、まったくグリップがありません」',
               '「持っていかれました。何も残っていません」',
               '「これ以上は無理です。指示をください」'],
    fastest: ['「いまのがファステストだ。いいペースを刻んでいる」',
              '「全体ベスト。そのリズムを崩すな」',
              '「トップタイムだ。まだ余裕はあるか？」'],
    fastestBack: ['「まだいける。マシンが決まっている」',
                  '「感触はいい。このまま行く」',
                  '「もう少し攻められる」'],
    teammate: ['「後ろはチームメイトだ。接触だけは避けろ」',
               '「同士討ちは絶対に避ける。クリーンに行け」',
               '「同じ色の2台だ。頭を冷やして走れ」'],
    teammateBack: ['「わかっている。フェアにやる」',
                   '「譲るつもりはないが、当てはしない」',
                   '「了解、クリーンに行く」'],
    intoPodium: ['「3番手に上がった。ここからは守りきるぞ」',
                 '「表彰台圏内だ。焦らず、確実に」'],
    home: ['「ホームだ。スタンドは全部お前の味方だぞ」',
           '「母国のファンが見ている。いい走りを見せてやれ」'],
    restart: ['「この周でセーフティカーが入る。ラインから再開だ、準備しろ」',
              '「隊列解除。ホームストレートで一斉に行くぞ」',
              '「次の周、グリーンだ。タイヤを温めておけ」',
              '「リスタート、リスタート。前に集中しろ」'],
    restartBack: ['「了解、行く」', '「タイヤは温まっている」',
                  '「準備できている」', '「ここで前に出る」'],
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
  function decideOrder(e, lap, laps, ty, wet) {
    const left = ty.life - e.tyreAge;                 // タイヤの余力（周）
    const nextPit = e.pitPlan.find(l => l > lap);
    const toPit = nextPit == null ? laps - lap : nextPit - lap;
    const gapA = e.gapAhead, gapB = e.gapBehind;
    /* ---- まず「持って帰る」判断 ----
       濡れた路面や、車に傷を負ったあと、あるいは前後が離れていて
       走りきるだけでよいときは、順位より完走を取る。
       慎重なドライバーほど、ここに入りやすい                       */
    // 不具合を抱えて運んでいる車は、そのあいだずっと安全第一
    if (e.trouble && !e.trouble.done && e.trouble.act === 'nurse') return 'cool';
    {
      const careV = S.careOf(e.driver);
      const alone = (gapA == null || gapA > 4.5) && (gapB == null || gapB > 4.5);
      const hurt = (e.damage || 0) >= 1.4 || (e.spins || 0) >= 1;
      const soaked = (wet || 0) >= 0.55;
      const risky = (e.harsh || 0) >= 1.05;
      // 攻めろと言われている作戦のときは、そう簡単には引かない
      const bias = (1.9 - e.st.risk) * (0.6 + careV / 160);
      let want = 0;
      if (soaked) want += 1.0;
      if (hurt) want += 0.9;
      if (risky) want += 0.7;
      if (alone) want += 0.5;
      if (lap > laps * 0.8 && alone) want += 0.4;
      if (want * bias >= 1.5) return 'cool';
    }
    // タイヤが持たない見込みなら、まず抑える
    if (left < toPit) return 'save';
    // 攻め続けられる時間には限りがある。何周も出しっぱなしにはできない
    const burnt = (e.pushLaps || 0) >= 4;
    // 濡れた路面では、そもそも仕掛けにいかない。攻める作戦の人だけが踏む
    const bold = (wet || 0) < 0.45 ||
                 Math.random() < 0.30 + (e.st.risk - 1) * 0.22 + (100 - S.careOf(e.driver)) / 400;
    // 終盤、前が射程で、タイヤを使い切ってよいなら出しきる
    if (laps - lap <= 4 && gapA != null && gapA < 2.0 && bold) return 'push';
    if (!burnt && bold) {
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

  /* ---------- 不具合が出たときの判断 ----------
     走り切るか、抑えて運ぶか、ピットで手当てするか、降ろすか。
     残り周回・いまの順位・悪化の速さ・止まる確率を、そのまま秤にかける。
     読みの利くピットウォールほど、正しいほうを選べる            */
  function decideTrouble(e, def, lap, laps, pos, pitLoss, read) {
    const left = Math.max(1, laps - lap);
    // このまま行ったら、残りで何秒失うか
    const keepLoss = def.loss * left + def.grow * left * (left + 1) / 2;
    // このまま行ったら、どれだけの確率で止まるか
    const keepDnf = 1 - Math.pow(1 - def.dnf * (1 + left * 0.05), left);
    // 抑えて運んだ場合
    const nurseLoss = keepLoss * (0.55 + def.nurse * 0.45) + left * 0.55;
    const nurseDnf = 1 - Math.pow(1 - def.dnf * def.nurse * (1 + left * 0.05), left);
    // 順位の価値。上位ほど、失うものが大きい
    const worth = Math.max(0, (D.POINTS[pos - 1] || 0));
    const secPerPt = 3.2;                    // 1ポイントを何秒ぶんと見るか
    const cost = (lossSec, dnfP) => lossSec + dnfP * (worth * secPerPt + 45);
    const cand = [
      { key: 'go',    v: cost(keepLoss, keepDnf) },
      { key: 'nurse', v: cost(nurseLoss, nurseDnf) }
    ];
    // 入って手当てするには、走る周が残っていないと意味がない
    if (def.fix != null && left >= 3) {
      const after = keepLoss * def.fix;
      cand.push({ key: 'pit', v: cost(after + pitLoss, keepDnf * def.fix) });
    }
    /* 降ろす。順位は捨てるが、部品も修理代も守れる。
       どうせ止まる見込みか、現場では手の打ちようがないときだけ考える */
    if ((keepDnf >= 0.32 || def.fix == null) && left >= 2) {
      cand.push({ key: 'retire', v: worth * secPerPt + 58 - (def.dnf > 0.006 ? 26 : 0) });
    }
    cand.sort((a, b) => a.v - b.v);
    // 読みが浅いほど、最善を外す
    const sure = Math.min(0.94, 0.42 + read * 0.16);
    return Math.random() < sure ? cand[0].key : S.pick(cand).key;
  }

  /* その周に、自チームのドライバーとどんなやりとりがあったか。
     優先度の高い出来事から1件だけ拾い、なければ何周かに一度だけ
     状況を伝える。毎周しゃべると、かえって何も伝わらないため     */
  function radioTick(st) {
    const lap = st.lap, laps = st.laps, radio = st.radio;
    const wxWetNow = st.wetLevel || 0;
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
        B: e.splitWith || '', NB: e.blueN || 0, NS: e.splitOther || 0,
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
      if (st.scEnd) {                                   // 次の周からレース再開
        push(RADIO.restart, 'pit', true);
        push(RADIO.restartBack, 'drv', true);
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
        else if (e.order === 'cool') {
          // 「順位より、持って帰ってくれ」。雨と、傷を負ったあとの合図
          push((wxWetNow >= 0.55 ? RADIO.coolWet : RADIO.cool), 'pit', true);
          push(RADIO.coolBack, 'drv', true);
        }
        else if (e.order === 'save') { push(RADIO.save, 'pit', true); push(RADIO.rogerShort, 'drv', true); }
        else { push(RADIO.clear, 'pit', true); }
        e.radioCool = 3;
        return;
      }
      // 溝のないタイヤで水の上に居る。何をおいてもこれを伝える
      if ((e.dryWet || 0) > 0.05 && e.radioCool <= 0) {
        push(RADIO.aqua, 'pit', true);
        push(RADIO.aquaBack, 'drv', true);
        e.radioCool = 4;
        return;
      }
      if (lap === 1 && e.splitWith) {                   // 作戦を分けた
        push(RADIO.split, 'pit', true);
        push(RADIO.splitBack, 'drv', true);
        e.radioCool = 4;
        return;
      }
      if (e.radioBlue === lap) {                        // 周回遅れの列
        e.radioBlue = -1;
        push(RADIO.blue, 'pit', true);
        push(RADIO.blueBack, 'drv', true);
        e.radioCool = 4;
        return;
      }
      if (e.radioTrouble === lap) {                     // 不具合を訴えた
        e.radioTrouble = -1;
        const tb = e.trouble;
        if (tb) {
          push(tb.def.drv, 'drv', true);
          const reply = tb.act === 'pit' ? (tb.def.pit.length ? tb.def.pit : tb.def.go)
                      : tb.act === 'nurse' ? tb.def.nurseSay
                      : tb.act === 'retire' ? tb.def.quit
                      : tb.def.go;
          push(reply, 'pit', true);
          e.radioCool = 3;
          return;
        }
      }
      if (e.radioFixed === lap) {                       // ピットで手当てした
        e.radioFixed = -1;
        push(RADIO.fixed, 'pit', true);
        push(RADIO.fixedBack, 'drv', true);
        e.radioCool = 3;
        return;
      }
      if (e.radioSpin === lap) {                        // スピンした
        e.radioSpin = -1;
        push(RADIO.spin, 'pit', true);
        push(RADIO.spinBack, 'drv', true);
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
  /* ---- ライバルがどうやって機材を運んできたか ----
     金のあるチームはチャーターで先乗りし、苦しいチームは船便に賭ける。
     同じ週末のあいだは同じ答えになるよう、名前とコースから決める      */
  function rivalLogi(team, track, trackIndex, season) {
    const str = team.name + '|' + trackIndex + '|' + (season || 1);
    let h = 11;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000003;
    const r1 = (h % 1000) / 1000, r2 = ((h / 1000) | 0) % 1000 / 1000;
    const power = (D.RIVALS.filter(x => x.name === team.name)[0] || { power: 1 }).power;
    /* 予算のあるチームほどチャーター、苦しいチームほど船便。
       遠いコースは運賃そのものが高くつくので、どのチームも一段下げる */
    const far = (track.far || 1);
    const rich = S.clamp((power - 0.68) / 0.34 - (far - 1) * 0.45, 0, 1);
    const pick2 = r1 < 0.10 + rich * 0.62 ? 0
                : r1 < 0.60 + rich * 0.35 ? 1 : 2;
    const def = D.RIVAL_LOGI[pick2];
    const late = r2 < def.delay * far;
    return { def: def, late: late,
             perf: def.perf * (late ? D.RIVAL_LATE.perf : 1),
             rel: def.rel + (late ? D.RIVAL_LATE.rel : 0) };
  }

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
        const strat = t.isPlayer ? (strategy[d.id] || 'balance') : autoStrategy(t, track, weather);
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
        // ライバルも、何で機材を運んできたかで週末が変わる
        const rl = t.isPlayer ? null : rivalLogi(t, track, D.TRACKS.indexOf(track), g.season);
        const pmul = form[ti]
                   * (t.isPlayer ? (g.logi && g.logi.late ? 0.990 : S.logiPlan(g).perf)
                                 * ((strategy && strategy.setup) || 1)
                                 : rl.perf);
        const perf = (t.car * 0.60 + drv * 0.40) * pmul
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
          perf: perf, pmul: pmul, strat: strat, st: st, sk: sk, hot: ti === hot,
          // あとで「何が効いて、その順位になったのか」を分解するために残す
          carScore: t.car, drvScore: drv, formMul: form[ti],
          bd: t.isPlayer ? myBody : evenBody,
          startTyre: t.isPlayer ? (strategy['tyre_' + d.id] || null) : null,
          // 作戦の性格（ライバル）と、プレイヤーが選んだピット回数・タイヤの狙い
          style: t.style || 'balanced',
          stopPlan: t.isPlayer ? (strategy['stops_' + d.id] || 'auto') : null,
          tyrePlan: t.isPlayer ? (strategy['tbias_' + d.id] == null ? 1
                                  : parseInt(strategy['tbias_' + d.id], 10)) : null,
          rel: t.rel + (rl ? rl.rel : 0),
          logi: rl ? rl.def : (t.isPlayer ? S.logiPlan(g) : null),
          logiLate: rl ? rl.late : !!(t.isPlayer && g.logi && g.logi.late),
          // いちばん傷んでいる部位（壊れたときの理由に使う）
          /* いちばん傷んでいる部位（壊れたときの理由に使う）。
             パワーユニットは1戦で大きく削れるぶん、素の数字だと
             いつもここに居座ってしまうので、消耗の速さで割って比べる */
          weakCat: t.isPlayer ? (D.PART_CATS.slice().sort((a, b) => {
            const v = c => ((g.equipped[c.key] || {}).cond || 100) *
                           (c.key === 'pu' ? 2.2 : 1 / (c.wear || 1));
            return v(a) - v(b);
          })[0] || {}).key : null,
          tyreSkill: S.tyreWear(d),
          lapTimes: [], cum: [], pits: [], sectors: [], penSec: [], noRec: [],
        bestSec: [Infinity, Infinity, Infinity],
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
    if (e.cum[lap - 1] != null) {
      e.cum[lap - 1] += P.sec;
      e.penSec[lap - 1] = (e.penSec[lap - 1] || 0) + P.sec;
    } else e.penPending = (e.penPending || 0) + P.sec;
    if (e.isPlayer) {
      e.radioPen = lap;                       // 無線でひとこと交わすための目印
      events.push({ lap: lap, type: 'penalty', car: e,
        text: P.icon + ' ' + e.driver.name + ' に' + P.sec + '秒加算 — ' + P.text });
    }
  }

  /* ライバルの車体はこのくらい仕上がっている、という基準。
     プレイヤーの車体効果はすべてここを 0 として増減する */
  const RIVAL_BODY_REF = 0.40;
  /* いちばん傷んでいた部位から、壊れかたを決める */
  const MECH_BY_CAT = {
    pu:   'エンジンブロー', gear: 'ギアボックストラブル', elec: '電装系トラブル',
    susp: 'サスペンション破損', chas: '油圧系トラブル', aero: 'フロアの破損',
    brake: 'ブレーキトラブル'
  };

  const tyreOf = key => D.TYRES.find(t => t.key === key) || D.TYRES[1];

  /* このスティント（区間）を走りきるのに向いたタイヤを選ぶ。
     攻めるチームは寿命ぎりぎりの速いタイヤを、
     堅実なチームは余裕のある硬いタイヤを選ぶ                        */
  function pickTyre(stintLaps, weather, prefer, bias) {
    if (weather.key === 'storm') return 'wet';
    if (weather.key === 'rain') return 'inter';
    if (prefer && D.DRY_TYRES.indexOf(prefer) >= 0) return prefer;
    /* 短い区間ほど、やわらかくて速いタイヤを選べる。
       bias 0=攻め（余裕をほとんど残さない） 1=バランス 2=堅実（余裕をたっぷり取る）  */
    const margin = bias >= 2 ? 1.34 : bias === 1 ? 1.10 : 0.94;
    const fit = D.DRY_TYRES.map(k => tyreOf(k)).filter(t => t.life >= stintLaps * margin);
    // どれも保たないなら、いちばん保つものを履くしかない
    if (!fit.length) return D.DRY_TYRES[D.DRY_TYRES.length - 1];
    // 保つもののうち、いちばんやわらかい＝いちばん速いもの
    return fit[0].key;
  }

  /* ---- ライバルの作戦 ----
     こちらと同じことを、向こうもやっている。
     荒いドライバーは攻め、手堅いドライバーは守る。
     荒れるコースや雨の週末は、全体に慎重になる。
     チームの性格（style）も、そのまま週末の構えに出る            */
  function autoStrategy(team, track, weather) {
    const d = (team.drivers || [])[0];
    const care = d ? S.careOf(d) : 100;
    const wet = weather && (weather.key === 'rain' || weather.key === 'storm');
    let attack = 0.26 + (100 - care) / 100 * 0.30
               + (team.style === 'attack' ? 0.16 : team.style === 'safe' ? -0.14 : 0)
               - ((track.risk || 1) - 1) * 0.28
               - (wet ? 0.14 : 0);
    let safe = 0.18 + (care - 100) / 100 * 0.28
             + ((track.risk || 1) - 1) * 0.30
             + (wet ? 0.16 : 0)
             + (team.style === 'safe' ? 0.14 : 0);
    attack = Math.max(0.04, Math.min(0.62, attack));
    safe = Math.max(0.04, Math.min(0.62, safe));
    const r = Math.random();
    if (r < safe) return 'safe';
    if (r < safe + attack) return 'attack';
    return 'balance';
  }

  /* ---------- 天候抽選 ---------- */
  function rollWeather(track) {
    const r = Math.random() * (0.9 + track.tyre * 0.1);
    if (r < 0.62)  return D.WEATHER[0];   // 晴れ
    if (r < 0.885) return D.WEATHER[1];   // くもり
    if (r < 0.965) return D.WEATHER[2];   // 雨
    return D.WEATHER[3];                  // 大雨
  }

  /* ---------- 予選 ---------- */
  /* ---------- 予選（ノックアウト） ----------
     Q1 で下位が落ち、Q2 でさらに落ち、残った10台前後が Q3 でポールを争う。
     セッションごとに一本ずつ引き直すので、速い車が Q1 で沈むこともある。
     路面は走るほど仕上がり、落とされる側ほど攻める。
     そして混雑・黄旗・ミス・セットアップのずれが、そこに乗ってくる。   */
  function qEventFor(e, si, track, weather, eng) {
    const out = [];
    D.Q_EVENTS.forEach(ev => {
      let p = ev.p * (ev.bySess[si] || 1);
      // 抜きにくい（狭い）コースほど前が詰まる。逆にスリップは効かない
      if (ev.key === 'traffic') p *= 1.25 - (track.weight.speed || 0.33);
      if (ev.key === 'tow')     p *= 0.45 + (track.weight.speed || 0.33) * 1.7;
      // ミスは、丁寧なドライバーほど出さない
      if (ev.key === 'mistake') p *= S.careMissMul(e.driver) * (weather.chaos || 1);
      // 黄旗は荒れる日ほど出る
      if (ev.key === 'yellow')  p *= (weather.chaos || 1);
      // セットアップのずれは、エンジニアが厚いほど起きない
      // セットアップのずれは、技術陣が厚いほど起きない
      if (ev.key === 'balance') p *= e.isPlayer ? 1 - Math.min(0.55, (eng || 0) * 0.014) : 0.92;
      // 予選巧者は、出るところにきちんと出て、無駄なくまとめる
      if (e.sk('qualify') && ev.lo > 0) p *= 0.72;
      if (Math.random() < p) out.push({ key: ev.key, icon: ev.icon, name: ev.name,
                                        sec: S.rnd(ev.lo, ev.hi) });
    });
    return out;
  }

  function qualify(entries, track, weather, eng) {
    const Q = D.QUALI;
    const n = entries.length;
    const cut = S.clamp(Math.round(n * Q.cut), Q.cutMin, Q.cutMax);
    const q2n = Math.max(Q.minQ2, Math.min(n - 1, n - cut));
    const q3n = Math.max(Q.minQ3, Math.min(q2n - 1, n - cut * 2));
    const sizes = [n, q2n, q3n];
    entries.forEach(e => { e.qLap = [null, null, null]; e.qEv = [[], [], []]; e.qOut = null; });

    let field = entries.slice();
    const sessions = [];
    for (let si = 0; si < 3; si++) {
      field.forEach(e => {
        let q = e.perf;
        if (e.sk('qualify')) q *= 1.07;
        const sp = Q.spread[si];
        q *= (1 - sp + Math.random() * sp * 2) * weather.grip;
        // 落とすか落とされるかの場面ほど、気持ちの強さがタイムに出る
        q *= (1 - (1 - e.driver.mental / 260) * (weather.chaos - 1) * 0.08 * (1 + Q.nerve[si]));
        let t = track.base * (1 + (Q.base + (140 - q) * 0.0009)) * Q.evo[si];
        const evs = qEventFor(e, si, track, weather, eng);
        evs.forEach(v => { t += v.sec; });
        e.qLap[si] = Math.max(track.base * 0.80, t);
        e.qEv[si] = evs;
        e.qScore = q;
      });
      const order = field.slice().sort((a, b) => a.qLap[si] - b.qLap[si]);
      const keep = si < 2 ? order.slice(0, sizes[si + 1]) : order;
      const drop = si < 2 ? order.slice(sizes[si + 1]) : [];
      drop.forEach(e => { e.qOut = si; });
      sessions.push({ key: 'Q' + (si + 1), si: si, order: order,
                      cut: si < 2 ? sizes[si + 1] : null, dropped: drop });
      field = keep;
    }

    /* 並び：Q3組 → Q2で落ちた組 → Q1で落ちた組。
       それぞれ、最後に走ったセッションのタイム順に並べる */
    const bySess = si => entries.filter(e => (e.qOut == null ? 2 : e.qOut) === si)
                                .sort((a, b) => a.qLap[si] - b.qLap[si]);
    const grid = bySess(2).concat(bySess(1)).concat(bySess(0));
    grid.forEach((e, i) => {
      e.grid = i + 1;
      // 表に出すのは「その順位を決めた一本」。
      // 最速の一本を出すと、並びと時計が食い違って見えてしまう
      e.qTime = e.qLap[e.qOut == null ? 2 : e.qOut];
      e.qBest = Math.min.apply(null, e.qLap.filter(v => v != null));
    });
    entries.sort((a, b) => a.grid - b.grid);
    grid.quali = { sessions: sessions, q2n: q2n, q3n: q3n, n: n };
    return grid;
  }

  /* ---------- 予選のあとの、ドライバーのひとこと ----------
     その日いちばん大きかった出来事について口を開く。
     何も起きなかった日は、順位そのものについて話す。          */
  function qTalks(grid, weather) {
    const out = [];
    const lastSi = e => (e.qOut == null ? 2 : e.qOut);
    const keyFor = e => {
      const evs = (e.qEv[lastSi(e)] || []).slice()
        .sort((a, b) => Math.abs(b.sec) - Math.abs(a.sec));
      // 0.16秒以上動いたことは、本人がいちばん覚えている
      const big = evs.filter(v => Math.abs(v.sec) >= 0.16)[0];
      if (big) return big.key;
      if (weather.wetTyres && Math.random() < 0.45) return 'wet';
      if (e.grid === 1) return 'pole';
      if (e.qOut === 0) return 'q1out';
      if (e.qOut === 1) return 'q2out';
      if (e.grid <= 5) return 'front';
      return 'q3in';
    };
    const say = e => {
      const key = keyFor(e);
      const pool = D.Q_TALK[key];
      if (!pool || !pool.length) return;
      out.push({ driver: e.driver, name: e.driver.name, team: e.team.name,
                 color: e.color, isPlayer: !!e.isPlayer, grid: e.grid,
                 key: key, text: S.pick(pool) });
    };
    grid.filter(e => e.isPlayer).forEach(say);
    /* 番狂わせがあれば、よそのドライバーの声も拾う。
       速いはずの車が Q1 で沈んだ日は、それが週末いちばんの話題になる */
    grid.filter(e => !e.isPlayer && e.qOut === 0)
        .sort((a, b) => b.carScore - a.carScore)
        .slice(0, 2)
        .forEach(say);
    return out;
  }

  /* ---------- フリー走行 ----------
     決勝と同じ顔ぶれで一本走らせて、そのときの並びを出す。
     ただし積んでいる燃料も狙っているものもばらばらなので、
     予選ほど当てにはならない。「だいたいこのへん」を掴むためのもの   */
  function practice(g, trackIndex, strategy, special) {
    const track = D.TRACKS[trackIndex];
    const weather = Object.assign({}, special && special.force
      ? (D.WEATHER.find(w => w.key === special.force) || rollWeather(track))
      : rollWeather(track));
    weather.wetTyres = (weather.key === 'rain' || weather.key === 'storm');
    const entries = buildEntries(g, track, weather, strategy);
    // 走り込んだ週ほど、出てくる並びが本当の力に近づく
    const deep = strategy && (strategy.fp === 'long' || strategy.fp === 'tyre');
    const spread = deep ? 0.055 : 0.105;
    entries.forEach(e => {
      e.fpScore = e.perf * (1 - spread + Math.random() * spread * 2);
      e.qTime = track.base * (1 + (0.026 + (140 - e.fpScore) * 0.0009));
    });
    const grid = entries.slice().sort((a, b) => a.qTime - b.qTime);
    grid.forEach((e, i) => { e.grid = i + 1; });
    return { trackIndex: trackIndex, track: track, weather: weather,
             entries: entries, grid: grid, special: special, isFP: true };
  }

  /* ---------- 天候の先ゆき ----------
     決勝の途中で空模様が動くかどうかを、予選の時点で決めておく。
     こうしておくと「まだ起きていないこと」に対して予報が出せる。
     予報が当たるかどうかは、読みの力（ストラテジスト＋天気の設備）しだい。 */
  function rollWxChange(weather, laps, special) {
    if (special || laps < 12) return null;
    const WX_ODDS = { sunny: 0.26, cloud: 0.34, rain: 0.55, storm: 0.55 };
    const odds = WX_ODDS[weather.key] != null ? WX_ODDS[weather.key] : 0.30;
    if (Math.random() >= odds) return null;
    let to;
    if (weather.wetTyres) {
      to = D.WEATHER[Math.random() < 0.62 ? 1 : 0];
    } else if (weather.key === 'sunny') {
      to = Math.random() < 0.80 ? D.WEATHER[1] : D.WEATHER[2];
    } else {
      const r2 = Math.random();
      to = r2 < 0.56 ? D.WEATHER[0] : (r2 < 0.95 ? D.WEATHER[2] : D.WEATHER[3]);
    }
    return { to: to, at: S.rint(Math.round(laps * 0.22), Math.round(laps * 0.74)) };
  }
  /* ある時点から見た「この先の予報」。
     近づくほど当たり、読みが浅いほど、直前まではっきりしない。
     読みが浅いチームは、ありもしない雨を見ることもある            */
  function forecastAt(chg, lap, laps, foresight, seed) {
    const f = S.clamp(foresight == null ? 0.3 : foresight, 0.05, 0.95);
    const horizon = Math.max(6, Math.round(laps * 0.45));
    // 同じ状況なら同じ予報になるよう、ぶれは種から作る
    const jit = (k) => {
      const str = 'f' + seed + '|' + lap + '|' + k;
      let h = 5;
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100003;
      return h / 100003;
    };
    /* 決勝が始まる前（lap 0）は「この週末に動くかどうか」を出す。
       何周目に、までは当てられないが、動くか動かないかは読める     */
    if (lap === 0) {
      if (chg) {
        return { to: chg.to, at: chg.at, in: chg.at,
                 p: S.clamp(0.10 + f * 0.72 + (jit('c') - 0.5) * (1 - f) * 0.95, 0.05, 0.96),
                 real: true };
      }
      return { to: D.WEATHER[2], at: null, in: null,
               p: S.clamp((1 - f) * 0.62 * jit('d'), 0.02, 0.62), real: false };
    }
    if (chg && chg.at >= lap) {
      const d = chg.at - lap;
      if (d <= horizon) {
        const near = 1 - d / horizon;
        const p = S.clamp(0.12 + near * (0.30 + f * 0.66)
                        + (jit('a') - 0.5) * (1 - f) * 0.55, 0.05, 0.97);
        return { to: chg.to, at: chg.at, in: d, p: p, real: true };
      }
    }
    // 何も来ない週。読みが浅いほど、ありもしない予報を見る
    const p = S.clamp((1 - f) * 0.50 * jit('b'), 0.02, 0.55);
    const wet = chg ? chg.to : null;
    return { to: wet || D.WEATHER[2], at: null, in: null, p: p, real: false };
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
    const grid = qualify(entries, track, weather, S.org(g).dept.engineer);
    const laps = Math.max(4, Math.round(track.laps * (special ? special.lapMul : 1)));
    const wxChange = rollWxChange(weather, laps, special);
    return { trackIndex: trackIndex, track: track, weather: weather,
             entries: entries, grid: grid, special: special,
             quali: grid.quali, qTalks: qTalks(grid, weather),
             laps: laps, wxChange: wxChange,
             // 決勝が始まる前に見える予報（0周目から見た先ゆき）
             forecast: forecastAt(wxChange, 0, laps, S.foresightOf(g), trackIndex + '|' + g.season) };
  }

  /* 予選が終わったあとで出力モードを変えたときに、決勝ぶんの速さと
     信頼性だけを入れ替える。グリッドは予選のまま動かさない。
     予選と決勝で別のモードを選べる、というだけの仕掛け              */
  function repackPU(pre, g) {
    if (!pre || !pre.entries) return null;
    const car = S.carScore(g, pre.track);
    const pp = S.puPerf(g);
    const rel = S.reliability(g);
    pre.entries.forEach(e => {
      if (!e.isPlayer) return;
      e.carScore = car;
      e.perf = (car * 0.60 + e.drvScore * 0.40) * (e.pmul || 1) + pp;
      e.rel = rel;
    });
    return { car: car, perf: pp, rel: rel };
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
    const grid = pre ? pre.grid : qualify(entries, track, weather, S.org(g).dept.engineer);
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
    let rubber = D.RUBBER.start, rubberWashed = false;   // 路面に乗ったゴム
    const rubberLog = [];
    let scStarted = false, wxChangedThisLap = false;   // 無線でひとこと入れるための目印
    const bestSectorBy = [null, null, null];
    const scInfo = { from: 0, laps: 0, virtual: false };
    let splitInfo = null;              // チームメイトで作戦を分けたときの控え
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
    /* 路面の濡れ具合と銘柄が、どれだけずれているか（0..1）。
       うまい人ほど、合わないタイヤでも許容できる幅が広い       */
    function wetGap(ty, w, e) {
      if (!isFinite(w)) w = 0;
      const ideal = ty.wetIdeal != null ? ty.wetIdeal : (ty.wet ? 0.7 : 0);
      const tol = (ty.wetTol != null ? ty.wetTol : 0.2) * (1 + (e ? e.wetSkill : 0) * 0.45);
      return Math.max(0, Math.abs(w - ideal) - tol);
    }
    /* 担当範囲から外れたぶんの、1周あたりの損。
       外れかたが大きいほど加速度的に重くなる（二次の項）ので、
       「大雨なのにインターのまま」は目に見えて割に合わなくなる  */
    function wetLoss(ty, w, e) {
      const gap = wetGap(ty, w, e);
      if (gap <= 0) return 0;
      return (gap * D.WET_MISMATCH + gap * gap * D.WET_MISMATCH2)
           * (1 - (e ? e.wetSkill : 0) * 0.35);
    }

    /* 溝のないタイヤが、掻き出せない水の上に取り残されている量。
       ドライタイヤのときだけ 0 より大きくなる                     */
    function dryOnWet(ty, w) {
      if (ty.wet) return 0;
      return Math.max(0, (w || 0) - D.ENV.dryWetFrom);
    }

    /* ---------- 環境係数 ----------
       いま、このクルマがどれだけ唐突か。
       合わない銘柄・終わったタイヤ・濡れた路面・攻めろという指示、
       の4つを足し合わせる。                                      */
    function envHarshOf(e, ty, w, ordKey) {
      const E2 = D.ENV;
      const over = Math.max(0, e.tyreAge - ty.life);
      // ずれの効きかたは、銘柄で性格が違う。
      // 溝のあるタイヤを乾いた路面で使うのは「溶ける」であって「滑る」ではない
      // ずれの向きで意味が変わる。水に対してタイヤが足りなければ「滑る」、
      // タイヤに対して水が足りなければ「溶ける」。滑るほうがずっと危ない
      const ideal = ty.wetIdeal != null ? ty.wetIdeal : (ty.wet ? 0.7 : 0);
      const tooLittle = (w || 0) > ideal;
      return wetGap(ty, w, e) * E2.mismatch * (tooLittle ? 1 : E2.wetOnDry)
           + over * E2.wear
           + (w || 0) * E2.wet * (1 - e.wetSkill * 0.45)
           + (ordKey === 'push' ? E2.push : 0)
           // 濡れた路面のドライタイヤ。ここだけは腕でもほとんど埋まらない
           + dryOnWet(ty, w) * E2.dryWet * (1 - e.wetSkill * 0.20);
    }
    /* それをいなす力。腕（レーティングとメンタル）と、乗りやすさ */
    function envGripOf(e) {
      const E2 = D.ENV;
      const rate = S.clamp(S.driverRating(e.driver) / 100, 0, 1.2);
      const nerve = S.clamp(e.driver.mental / 190, 0, 1.1);
      const skill = rate * 0.60 + nerve * 0.40;
      const body = 1 + (e.bd.drive - RIVAL_BODY_REF) * E2.gripBody;
      return Math.max(0.35, (E2.gripBase + skill * E2.gripDrv) * body
                            * (e.sk('precise') ? 1.18 : 1)
                            * (e.driver.hurt ? 0.86 : 1));
    }
    /* いま入ったとして、どのタイヤを履くか。
       予定していた銘柄を基本にしつつ、路面が変わっていれば合わせ直す。
       乾きかけなら、少し先を読んでドライに賭けることもある          */
    function tyreForNow(e, lap) {
      const planned = e.stints[e.stintIdx] ? e.stints[e.stintIdx].key : 'medium';
      const w = wx.level == null ? 0 : wx.level;
      // このスティントのあいだ、路面は実際にはこのあたりに落ち着く
      const truth = w + (wetTarget - w) * 0.62;
      // ストラテジストの読み＝その「落ち着く先」をどれだけ正しく当てられるか。
      // 読みが浅いと、いまの路面に引きずられ、しかも当て推量が混じる
      const f = e.foresight == null ? 0.5 : e.foresight;
      const ahead = S.clamp(w + (truth - w) * f + S.rnd(-0.24, 0.24) * (1 - f), 0, 1);
      const dry = pickTyre(laps - lap, { key: 'sunny' }, D.DRY_TYRES.indexOf(planned) >= 0 ? planned : null, e.tyreBias);
      const want = bestWetTyre(ahead, dry, e);
      // 予定どおりで大きく損をしないなら、予定を尊重する
      const lossPlanned = wetLoss(tyreOf(planned), ahead, e);
      return lossPlanned <= wetLoss(tyreOf(want), ahead, e) + 0.012 ? planned : want;
    }

    /* いまの路面にいちばん合うタイヤ */
    function bestWetTyre(w, dryPick, e) {
      if (w < 0.20) return dryPick;
      let best = null, bl = 9;
      D.TYRES.forEach(t => {
        if (!t.wet) return;
        const l = wetLoss(t, w, e);
        if (l < bl) { bl = l; best = t.key; }
      });
      // 雨に強い人なら、半端な路面でドライのまま行く手もある
      if (wetLoss(tyreOf(dryPick), w, e) < bl) return dryPick;
      return best || 'inter';
    }
    // 追い抜きやすさ：最長ストレートの長さ（実際の形状）と、コースの速度特性から決める
    const geo = GP.geom.analyze(track);
    const passEase = 0.25 + geo.longestShare * 1.1 + track.weight.speed * 0.5;
    const E = D.ERS;
    // ストレートが長いコースほど、放電を速さに変えやすい
    const ersScale = 0.7 + geo.longestShare * 1.6;
    const refPerf = Math.max.apply(null, entries.map(e => e.perf)) + 4;
    /* ---- ピットで失う時間 ----
       「ピットロードを制限速度で走り抜けるぶん」＋「止まって作業しているぶん」。
       前者はコースが決めていて、設備をいくら建てても1秒も縮まない。
       縮められるのは後者だけ。だから隊列が遅いセーフティカー中は、
       走るぶんだけが安くなり、止まるぶんは変わらずかかる。            */
    const pitLane = track.pitLane || 18;
    const myPit = S.pitCrew(g);
    /* 読み（何をすべきか分かる）と、現場の余力（実際に動ける）は別もの。
       疲れきったクルーでは、正しい指示も間に合わない                  */
    const strategist = S.readPower(g);
    const ready = S.org(g).ready;
    // ライバルのクルーの腕は、そのチームの地力なりに揃っている
    const carRef = entries.reduce((a, e) => a + e.carScore, 0) / Math.max(1, entries.length);

    // ピット戦略とタイヤの割り当て
    /* ---- チームメイトで作戦を分ける ----
       2台とも同じ作戦にすると、読みが外れたときに揃って沈む。
       腕のあるストラテジストは、わざと1台ずつ違う作戦へ振り分けて、
       どちらかが必ず当たるようにする。「おまかせ」のときだけ働く    */
    {
      const mine = entries.filter(e => e.isPlayer &&
        (e.stopPlan == null || e.stopPlan === 'auto'));
      if (mine.length === 2) {
        const nat = mine.map(e =>
          S.naturalStops(track, laps, track.tyre * e.st.tyre * e.tyreSkill));
        if (nat[0] === nat[1]) {
          const read = S.readPower(g);
          const p2 = read >= D.SPLIT.need
            ? Math.min(D.SPLIT.cap, D.SPLIT.sure + (read - D.SPLIT.need) * D.SPLIT.step) : 0;
          if (p2 > 0 && Math.random() < p2) {
            // 後ろの1台を逆の作戦へ回す。前の車の作戦は動かさない
            const b = mine[1], base = nat[1];
            const alt = base >= 3 ? base - 1
                      : base <= 1 ? 2
                      : (Math.random() < 0.6 ? base + 1 : base - 1);
            b.forceStops = alt;
            b.tyreBias = alt > base ? 0 : 2;
            mine[0].splitWith = b.driver.name;
            b.splitWith = mine[0].driver.name;
            mine[0].splitStops = base; b.splitStops = alt;
            mine[0].splitOther = alt; b.splitOther = base;
            splitInfo = { a: mine[0].driver.name, aStops: base,
                          b: b.driver.name, bStops: alt };
          }
        }
      }
    }

    entries.forEach(e => {
      const wear = track.tyre * e.st.tyre * e.tyreSkill;
      /* コースとマシンから決まる「素直な」ストップ回数。
         よけいに1回止まって失うのはピットロードのぶん。
         そのかわり区間が短くなり、やわらかくて速いタイヤを履ける。
         ピットロードが短くて周回の多いコースほど、2回止まる価値が出る  */
      const natural = S.naturalStops(track, laps, wear);
      let stops = natural;
      e.tyreBias = 1;
      e.react = 0.45;                     // アンダーカットを仕掛ける積極性

      if (e.isPlayer) {
        // プレイヤーは自分で選べる。'auto' ならコース任せ
        const want = e.stopPlan;
        if (want === '1' || want === '2' || want === '3') stops = parseInt(want, 10);
        else if (e.forceStops) stops = e.forceStops;      // 振り分けられたほう
        e.tyreBias = e.forceStops ? e.tyreBias
                   : (e.tyrePlan == null ? 1 : e.tyrePlan);
        e.react = (0.5 + strategist * 0.12 + S.osk(g, 'call') * 0.06) * ready;
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

      /* 予定の周をどれだけ散らすか。等分ちょうどを外さないこと自体に
         値打ちはないので、ここは全チーム同じ。読みの差は「路面がどうなるかを
         当てて、いつ履き替えるかを決める」ほうに出る                    */
      const blur = 1.4;
      const shift = e.pitShift || 0;
      e.pitPlan = [];
      for (let i = 1; i <= stops; i++) {
        // 等分だと毎回同じ周回になるので、性格ぶんの前倒し／引っ張りを乗せる
        const frac = i / (stops + 1) * (1 + shift);
        e.pitPlan.push(S.clamp(Math.round(laps * frac + S.rnd(-blur, blur)), 2, laps - 2));
      }
      e.pitPlan.sort((a, b) => a - b);
      // ピットロードは全車共通。車体の出入りのしやすさだけがわずかに効く
      e.pitLane = pitLane * (1 - (e.bd.drive - RIVAL_BODY_REF) * 0.06);
      e.pitStand = e.isPlayer
        ? Math.max(D.PIT_STAND_MIN, myPit.stand - (e.bd.svc - RIVAL_BODY_REF) * 1.8)
        : S.clamp(D.PIT_STAND_RIVAL - (e.carScore - carRef) * 0.020,
                  D.PIT_STAND_MIN, 6.2);
      e.pitFumble = e.isPlayer ? myPit.fumble : 0.045;
      e.pitLoss = e.pitLane + e.pitStand;      // 平常時の目安。表示と「遅かった」判定に使う
      e.tyreAge = 0;
      e.startBoost = (e.sk('start') ? 2.2 : 0) + e.driver.technique / 200;
      /* ---- ストラテジストの読み ----
         路面が「いまどうか」ではなく「これからどうなるか」を、
         どこまで織り込んでタイヤを選べるか。0.1（後手）〜0.92（先読み）  */
      e.foresight = e.isPlayer ? S.foresightOf(g)
                               : S.clamp(0.22 + (e.react || 0.45) * 0.55, 0.10, 0.88);
      /* ---- ドライバーの雨・路面への適性 ----
         合わないタイヤでも、うまい人はある程度なんとかしてしまう。
         ここが高いほど「もう1周だけ引っぱる」判断が成立する          */
      e.wetSkill = S.wetSkillOf(e.driver);

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
      e.lapHarsh = [];      // 各周の「環境の厳しさ」（env / grip）
      e.spins = 0;          // スピンした回数
      e.damage = 0;         // 車体に入ったダメージ（レース後の修理費になる）
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
    let raceBest = Infinity;      // レース全体のベストラップ
    let teamFightAt = 0;          // 同士討ちの実況を出しすぎないための間隔

    /* 途中で天気が変わるかどうかを先に決めておく（実況では出さない）。
       どの空模様でも一律に変わることにすると、晴れの日でも次々に降り出して
       雨のレースばかりになってしまう。いまの空から素直に決める           */
    /* 空模様は、雨でなくても動く。晴れがくもりに、くもりが晴れに変わる
       だけでも、路面の乾きかたとタイヤの選択が変わる。
       「雨のレース」は減らしつつ、動きのある週末は増やしたい       */
    // 予選の時点で決めてあれば、それをそのまま使う（予報と食い違わせない）
    const chg = pre && pre.wxChange !== undefined ? pre.wxChange
              : rollWxChange(weather, laps, special);
    if (chg) { wxTo = chg.to; wxAt = chg.at; }
    /* 各周から見た「この先の予報」。読みの力でぶれる。
       観戦画面の 過去／いま／この先 の表示に使う                */
    const foreSeed = trackIndex + '|' + (g.season || 1);
    const foreLog = [];
    for (let l = 1; l <= laps; l++) {
      foreLog.push(forecastAt(chg, l, laps, S.foresightOf(g), foreSeed));
    }

    if (splitInfo) {
      events.push({ lap: 1, type: 'pit',
        text: '🧠 ピットウォールが作戦を分けた —— ' + splitInfo.a + ' は' +
              splitInfo.aStops + 'ストップ、' + splitInfo.b + ' は' +
              splitInfo.bStops + 'ストップ。どちらかを必ず当てにいく' });
    }

    // ---- スタート前の無線 ----
    // グリッドについてから、フォーメーションラップに出るまでのひと言。
    // 「どこから出るか」「どんな路面か」「どんな調子か」で言うことが変わる
    entries.forEach(e => {
      if (!e.isPlayer) return;
      const V0 = { D: e.driver.name, G: e.grid, W: weather.name };
      const pool = weather.wetTyres ? RADIO.gridWet
                 : e.grid === 1     ? RADIO.gridPole
                 : e.grid <= 5      ? RADIO.gridFront
                 : e.grid <= 12     ? RADIO.gridMid
                                    : RADIO.gridBack;
      const form = e.driver.form || 100;
      const back = form >= 108 ? RADIO.gridHot : form >= 92 ? RADIO.gridCalm : RADIO.gridLow;
      // 2台に同じ言い回しが並ばないよう、二度までは引き直す
      const fresh = (poolX) => {
        let t = say(poolX, V0);
        for (let k = 0; k < 2 && radio.some(r => r.text === t); k++) t = say(poolX, V0);
        return t;
      };
      radio.push({ lap: 0, from: 'pit', name: e.driver.name, id: e.id, text: fresh(pool) });
      radio.push({ lap: 0, from: 'drv', name: e.driver.name, id: e.id, text: fresh(back) });
    });

    // ---- 母国グランプリ ----
    // 自国のコースで走る週末は、それだけで特別な一戦になる
    entries.forEach(e => {
      if (!e.isPlayer || e.dnf) return;
      const nat = S.nationOf(e.driver);
      if (nat && nat.flag && nat.flag === track.country) {
        events.push({ lap: 1, type: 'home', text: say(SAY.home, { A: e.driver.name }) });
        radio.push({ lap: 1, from: 'pit', name: e.driver.name, id: e.id,
                     text: say(RADIO.home, { D: e.driver.name }) });
      }
    });

    for (let lap = 1; lap <= laps; lap++) {
      /* ---- 路面が変わっていく ----
         雨はセクター1から来て奥へ抜けていく。乾くときも同じ順。
         「セクター2だけまだ濡れている」という時間が生まれる         */
      if (shower) {
        shower.left--;
        if (shower.left <= 0) { wetTarget = shower.back; shower = null; }
      } else if (!special && lap > 3 && lap < laps - 3 &&
                 Math.random() < 0.0025 * (wx.key === 'sunny' ? 1 : 2)) {
        /* 通り雨。数周だけ降って、また引いていく。
           晴れているほど起きにくく、起きても路面はインターの範囲までしか
           濡れない。ここを強くしすぎると、雨のレースばかりになる     */
        shower = { left: S.rint(3, 6), back: wetTarget };
        wetTarget = Math.min(1, Math.max(wetTarget, 0.22) + S.rnd(0.10, 0.26));
        events.push({ lap, type: 'weather',
          text: '🌦️ 一部のセクターに雨雲がかかった！ 路面が濡れはじめる' });
        wxChangedThisLap = true;
      }
      for (let k = 0; k < 3; k++) {
        const rate = 0.40 - k * 0.09;                 // 手前のセクターから変わる
        wetSec[k] += (wetTarget - wetSec[k]) * rate;
        if (Math.abs(wetTarget - wetSec[k]) < 0.01) wetSec[k] = wetTarget;
      }
      /* ---- 路面の熟成（ラバー）----
         走るほどゴムが乗ってグリップが上がる。雨が降れば流れる  */
      {
        const wn = wetAvg();
        if (wn > D.RUBBER.washFrom) {
          const before = rubber;
          rubber = Math.max(0, rubber - wn * D.RUBBER.wash);
          if (before >= 0.35 && rubber < 0.15 && !rubberWashed) {
            rubberWashed = true;
            events.push({ lap: lap, type: 'weather',
              text: '🌧️ 乗っていたラバーが雨で流れた。路面は一度まっさらに戻る' });
          }
        } else {
          rubber = Math.min(1, rubber + D.RUBBER.gain * (1 - rubber));
          if (rubber > 0.35) rubberWashed = false;
        }
        rubberLog[lap - 1] = Math.round(rubber * 100) / 100;
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

      // ---- レーダーを読む ----
      // 読みの鋭いチームだけは、変わる前に動ける。
      // ここで先に入れたチームは、路面が変わった瞬間に正解を履いている
      if (wxTo && lap === wxAt - 2) {
        order.forEach(e => {
          if (e.dnf || e.readRadar) return;
          if ((e.foresight || 0) < 0.55) return;
          if (Math.random() > (e.foresight - 0.48) * 1.6) return;
          e.readRadar = true;
          e.pitPlan = e.pitPlan.filter(p2 => p2 > wxAt + 2);
          e.pitPlan.push(wxAt);
          e.pitPlan.sort((a, b) => a - b);
          if (e.isPlayer) {
            events.push({ lap: lap, type: 'pit', car: e,
              text: '📡 ' + e.driver.name + ' 陣営、レーダーを読んで先にピットを組み替えた！' });
          }
        });
      }

      // 天候の急変。全車があわててタイヤを替えに来る
      if (wxTo && lap === wxAt) {
        // 天気そのものは差し替えるが、路面の濡れ具合は毎周この上で
        // 計算し直している。wx を丸ごと作り直すと level が消えてしまい、
        // それ以降のラップタイムがすべて壊れる
        wx.key = wxTo.key;
        const nowWet = wxTo.key === 'rain' || wxTo.key === 'storm';
        wetTarget = wxTo.wetTo != null ? wxTo.wetTo : (nowWet ? 0.6 : 0);
        wxInfo.at = lap; wxInfo.to = wxTo.name; wxInfo.icon = wxTo.icon;
        wxChangedThisLap = true;
        events.push({ lap, type: 'weather',
          text: wxTo.icon + ' 天候が変わった！ ' + weather.name + ' → ' + wxTo.name
              + '（' + (nowWet ? 'ウェットタイヤへ' : 'ドライタイヤへ') + '）' });
        order.forEach(e => {
          if (e.dnf || lap >= laps - 1) return;
          // いま履いているもので大きく損をしないなら、慌てて入らない
          if (wetLoss(tyreOf(e.tyreKey), wetTarget, e) < 0.02) return;
          /* ---- いつ入るのが正解か ----
             路面はこれから何周かかけて wetTarget に向かって動くので、
             降りはじめに飛び込むのが常に正しいわけではない。早すぎれば
             まだ乾いた路面をウェットで走ることになるし、遅すぎれば
             合わないタイヤのまま何周も損をする。
             読みが利くチームほど、その「ちょうどの周」を当てられる      */
          const cur = tyreOf(e.tyreKey);
          const left = laps - lap;
          const scoreAt = k => {
            let w2 = wetAvg(), tot = 0, want = null;
            for (let j = 1; j <= left; j++) {
              w2 += (wetTarget - w2) * 0.31;            // 3セクターのならしたところ
              if (j <= k) { tot += wetLoss(cur, w2, e); continue; }
              if (!want) {
                const dry = pickTyre(Math.max(3, left - k), weather, null, e.tyreBias);
                want = tyreOf(bestWetTyre(w2, dry, e));
              }
              tot += wetLoss(want, w2, e);
            }
            return tot;
          };
          let ideal = 1, bestLoss = Infinity;
          for (let k = 1; k <= 6; k++) { const v = scoreAt(k); if (v < bestLoss) { bestLoss = v; ideal = k; } }
          // 読みが浅いほど、その周を外す
          const fo = e.foresight == null ? 0.5 : e.foresight;
          const delay = S.clamp(Math.round(ideal + S.rnd(-2.8, 2.8) * (1 - fo)), 1, 6);
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

        // 路面に乗ったゴムのぶんだけ、みんなが速くなる
        t *= 1 - rubber * D.RUBBER.pace;

        // 路面と銘柄が噛み合っていないぶんだけ遅くなる。
        // 「合っている／合っていない」ではなく、ずれた量で効く
        t *= 1 + wetLoss(ty, wx.level, e);
        // 溝のないタイヤで水の上に居ると、「遅い」ではなく「走れない」に変わる
        const dow = dryOnWet(ty, wx.level);
        e.dryWet = dow;                        // 無線と観戦画面の警告に使う
        if (dow > 0) t *= 1 + dow * D.ENV.dryWetLoss * (1 - e.wetSkill * 0.25);
        // 雨に強い人は、濡れた路面そのものでも速い
        t *= 1 - e.wetSkill * wx.level * 0.012;

        /* ---- 周回遅れの処理 ----
           速い車はレースの後半、必ず周回遅れの列に追いつく。
           青旗が出ても譲るのに1コーナーぶんはかかる。
           「1周ぶん以上うしろにいる車」を、1周でどれだけ追い越すかは
           ラップタイムの差そのもの（1 - 自分の周回時間 / 相手の周回時間）。
           抜きにくいコースほど、そして相手が慣れていないほど時間が消える  */
        if (lap > 2) {
          const myPrev = e.cum[lap - 2];
          const myLap = e.lapTimes[lap - 2] || track.base;
          let meets = 0, n = 0;
          order.forEach(b => {
            if (b === e || b.dnf || b.cum[lap - 2] == null) return;
            const behind = b.cum[lap - 2] - myPrev;
            // 完全に1周遅れていなくても、コース上で追いつけば同じこと。
            // 半周以上うしろの車から、少しずつ「列」として効きはじめる
            if (behind < myLap * 0.55) return;
            const near = Math.min(1, behind / myLap);
            const bLap = b.lapTimes[lap - 2] || myLap;
            const rate = Math.max(0, 1 - myLap / bLap) * near; // 1周でどれだけ詰めるか
            if (rate <= 0) return;
            // 譲る側が慣れているほど、双方の損が減る
            const yieldFast = 1 - (S.careOf(b.driver) - 100) / 100 * D.BLUE.care;
            meets += Math.min(0.35, rate * 2.2) * Math.max(0.5, yieldFast);
            n++;
          });
          if (meets > 0) {
            const cost = meets * D.BLUE.loss
                       * (1 - passEase * D.BLUE.ease)
                       * (1 - Math.min(0.55, e.driver.technique / 200 * D.BLUE.skill))
                       * (e.sk('passer') ? 0.65 : 1);
            t += cost;
            e.blueLoss = (e.blueLoss || 0) + cost;
            e.blueN = n;
            // 列に入ったことを、たまに無線で伝える
            if (e.isPlayer && n >= 2 && !e.radioBlueAt) {
              e.radioBlue = lap; e.radioBlueAt = lap;
            }
          } else {
            e.blueN = 0;
          }
        }
        /* 周回遅れ側も、譲るぶんだけ失う */
        if (lap > 2) {
          const lead = order.filter(x => !x.dnf && x.cum[lap - 2] != null)
            .sort((a, b) => a.cum[lap - 2] - b.cum[lap - 2])[0];
          if (lead && lead !== e) {
            const down = e.cum[lap - 2] - lead.cum[lap - 2];
            const lapT = lead.lapTimes[lap - 2] || track.base;
            if (down >= lapT * 0.55) {
              const rate = Math.max(0, 1 - lapT / (e.lapTimes[lap - 2] || lapT));
              t += Math.min(0.30, rate * 2.2) * D.BLUE.yield * Math.max(1, Math.floor(down / lapT));
            }
          }
        }

        /* 抱えている不具合のぶん。放っておくほど広がっていく。
           抑えて運べば広がりは遅くなるが、そのぶんペースも落ちる */
        if (e.trouble && !e.trouble.done) {
          const tb = e.trouble;
          t += tb.loss;
          tb.loss += tb.def.grow * (tb.act === 'nurse' ? tb.def.nurse : 1);
          tb.laps = (tb.laps || 0) + 1;
        }

        // タイヤ摩耗。寿命を超えると急激にタレる
        e.tyreAge++;
        // 溝のあるタイヤを乾いた路面で使うと、溝が一気に溶けてなくなる
        if (ty.wet) e.tyreAge += wetGap(ty, wx.level, e) * D.ENV.wetMelt;
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
        const ordKey = scNow2 ? 'hold' : decideOrder(e, lap, laps, ty, wx.level || 0);
        if (ordKey !== e.order) { e.orderChanged = lap; e.order = ordKey; }
        // 攻めた周を数えておく。続けざまには出せない
        e.pushLaps = ordKey === 'push' ? (e.pushLaps || 0) + 1 : Math.max(0, (e.pushLaps || 0) - 1);
        const ord = orderOf(ordKey);
        // 無線がまともなほど、言ったことがそのまま伝わる
        const radio = e.isPlayer ? 1 + S.kitEff(g, 'radio', 'order') : 1;
        t *= (1 + ord.pace * radio);
        e.tyreAge += ord.wear;
        e.lapOrder[lap - 1] = ordKey;

        // ---- 環境係数 ----
        // 合わない銘柄・終わったタイヤ・濡れた路面・攻めろという指示が
        // 「厳しさ」を作り、腕と乗りやすさがそれをいなす。
        // 手に負えなくなったぶんだけ、タイヤは余計に削れ、あとでスピンが出る
        e.harsh = envHarshOf(e, ty, wx.level || 0, ordKey) / envGripOf(e);
        const overHarsh = Math.max(0, e.harsh - D.ENV.degraFrom);
        if (overHarsh > 0) e.tyreAge += overHarsh * D.ENV.degra;
        e.lapHarsh[lap - 1] = Math.round(e.harsh * 100) / 100;

        // 隊列を流しているあいだは、スリップも乱気流も守りも働かない
        const flowing = scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps;

        // ---- 前の車との関係 ----
        // 直線では前車の後ろが速く（スリップストリーム）、
        // コーナーでは前車の乱れた空気で曲がらない（乱気流）。
        // 抜きにくいコースほど乱気流がきつく、張りついたまま抜けない
        if (!flowing && e.gapAhead != null && e.gapAhead < 1.5) {
          const near = 1 - e.gapAhead / 1.5;               // 0..1
          const dirty = 1.7 - passEase;                    // 抜きにくいほど大きい
          t -= track.base * 0.0042 * near * (0.35 + geo.longestShare * 2.2);
          t += track.base * 0.0060 * near * near * dirty
             * ((1 - e.bd.aero * 0.30) / (1 - RIVAL_BODY_REF * 0.30));
          if (e.gapAhead < 0.9) e.tyreAge += 0.26;         // 前について走るとタイヤが焼ける
        }
        // ---- 後ろから来られている ----
        // 守るために普段より攻めた走りになる。速くはなるが、そのぶん削れる
        if (!flowing && e.gapBehind != null && e.gapBehind < 1.6) {
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
        // ---- スピン ----
        // ミスとは別枠。環境の厳しさがドライバーの手に負えなくなったとき、
        // 前触れなく後ろから抜ける。合わない銘柄で走り続けた代償はここに出る
        let spun = false;
        const scNow3 = scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps;
        if (lap > 1 && !scNow3) {
          const sp = Math.max(0, e.harsh - D.ENV.spinFrom) * D.ENV.spin;
          if (sp > 0 && Math.random() < sp) {
            spun = true;
            const aqua = dryOnWet(ty, wx.level) > 0;      // 水に乗ってしまった
            const lost = S.rnd(D.ENV.spinLoss[0], D.ENV.spinLoss[1]) * (aqua ? 1.4 : 1);
            t += lost;
            e.tyreAge += D.ENV.spinWear;
            e.spins++;
            e.damage = (e.damage || 0) + S.rnd(0.35, 1.10);
            if (e.isPlayer) e.radioSpin = lap;
            const off = Math.random() < (aqua ? D.ENV.dryWetOff : D.ENV.spinOff);
            const pool = off ? (aqua ? SAY.aquaOut : SAY.spinOut)
                             : (aqua ? SAY.aqua : SAY.spin);
            events.push({ lap: lap, type: 'spin', car: e,
              text: say(pool,
                        { A: e.driver.name, C: lm(track), T: tyreOf(e.tyreKey).name }) +
                    (off ? '' : '（-' + lost.toFixed(1) + '秒）') });
            if (off) {
              e.dnf = true; e.dnfLap = lap; e.dnfReason = 'スピンからのコースアウト';
              e.damage = (e.damage || 0) + S.rnd(1.2, 2.6);
              if (scLaps <= 0 && lap < laps - 2 && Math.random() < 0.40 + track.risk * 0.16) {
                scPending = true;
              }
            }
          }
        }

        if (lap > 1 && !spun) {
          const tyreOver = Math.max(0, e.tyreAge - ty.life);
          let mp = 0.0090
                 * (1 + (e.st.risk - 1) * 0.50)
                 * S.careMissMul(e.driver)               // その人の「まとめる力」
                 * (1.55 - e.driver.mental / 190)
                 * (1 + tyreOver * 0.075)
                 * (0.55 + wx.chaos * 0.45) * (1 - e.wetSkill * wx.level * 0.55)
                 * ((1 - e.bd.drive * 0.25) / (1 - RIVAL_BODY_REF * 0.25))
                 * (e.driver.hurt ? 1.35 : 1)
                 * (1 - rubber * D.RUBBER.calm)      // 乗った路面ほど落ち着いて踏める
                 * (1 + (e.defending || 0) * 0.45)      // 守っているときほど乱れやすい
                 * orderOf(e.order).miss                // 攻めろと言われた周ほど乱れやすい
                 * (e.isPlayer ? 1 - S.kitEff(g, 'radio', 'miss') : 1);
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

        /* ---- セーフティカー中 ----
           どちらも「全車が同じラップタイムで走る」のが正しい。
           割合で落とすと、もともと遅い車ほど失う秒数が大きくなり、
           バーチャル中なのに差が開いていってしまう。
           指定タイムに合わせて走るのだから、みな同じ1周になる       */
        const underSC = scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps;
        if (underSC) {
          if (scInfo.virtual) {
            // バーチャル：直前までの差を、コンマ1くらいの揺れで保つ
            t = track.base * 1.28 + S.rnd(-0.05, 0.05);
            e.tyreAge = Math.max(0, e.tyreAge - 0.2);
          } else {
            // 実車：隊列に詰まっているので、さらに差は動かない
            t = track.base * 1.34 + S.rnd(-0.03, 0.03);
            e.tyreAge = Math.max(0, e.tyreAge - 0.35);    // 流している間はタイヤも保つ
          }
        }

        /* 隊列を流しているあいだは、全車がゆっくり走る。
           ピットで止まるぶんはこのあとで足すので、
           「入った車だけが損をする」ことにはならない              */
        if (underSC) t *= scInfo.virtual ? D.SC_PACE.vsc : D.SC_PACE.sc;

        /* 隊列に詰める／離れるぶんを、この周のタイムとして払う。
           1周で払いきれないぶんは次の周へ持ち越す。
           先頭が待ち、後ろが追いつく、という時間の流れをそのまま出す */
        if (e.scPull) {
          // どれだけ急いでも、まともに走る周より速くは走れない
          const floor = t * 0.68;
          const pay = S.clamp(e.scPull, floor - t, t * 1.20);
          t += pay;
          e.scPull -= pay;
          if (Math.abs(e.scPull) < 0.05) e.scPull = 0;
          e.noRec[lap - 1] = true;                   // 記録には残さない
        }

        // ピットイン（新しいタイヤに履き替える）
        let pitAdd = 0;
        if (e.pitPlan.indexOf(lap) >= 0) {
          /* 隊列が遅いあいだ、安くなるのは「走るぶん」だけ。
             ジャッキが上がって下りるまでの時間は、何が出ていても変わらない  */
          const laneMul = underSC ? (scInfo.virtual ? D.PIT_LANE_VSC : D.PIT_LANE_SC) : 1;
          const fumbled = Math.random() < e.pitFumble;
          if (fumbled) e.pitSlow = (e.pitSlow || 0) + 1;   // レース後のひとことに使う
          const stand = e.pitStand + S.rnd(-0.25, 0.75) + (fumbled ? S.rnd(2.5, 8.0) : 0);
          const lane = e.pitLane * laneMul;
          const loss = lane + stand;
          t += loss;
          pitAdd = loss;
          e.tyreAge = 0;
          e.pits.push(lap);
          // ピットレーンでの速度超過。慌てているチームほど出る
          if (Math.random() < 0.012 * (e.isPlayer
                ? Math.max(0.35, 1 - strategist * 0.22 - myPit.skill * 0.018) : 1)) {
            givePenalty(e, 'speeding', lap, events, laps);
          }
          e.stintIdx = Math.min(e.stints.length - 1, e.stintIdx + 1);
          e.tyreKey = e.pitTyre || tyreForNow(e, lap);
          e.pitTyre = null;
          if (e.isPlayer) {
            const nt = tyreOf(e.tyreKey);
            const pool = fumbled ? SAY.pitSlow : (underSC ? SAY.pitCheap : SAY.pit);
            events.push({ lap, type: 'pit', car: e,
              text: say(pool, { A: e.driver.name, B: nt.name,
                                P: loss.toFixed(1), S: stand.toFixed(1),
                                L: lane.toFixed(1) }) });
          }
        }
        e.pitTime[lap - 1] = pitAdd;

        e.lapTimes[lap - 1] = t;
        const prev = lap === 1 ? 0 : e.cum[lap - 2];
        // 罰則はラップタイムではなく持ち時間に足す（区間タイムの表示を汚さない）
        e.cum[lap - 1] = prev + t + (e.penPending || 0);
        e.penSec[lap - 1] = (e.penSec[lap - 1] || 0) + (e.penPending || 0);
        e.penPending = 0;
        // ラップタイム・区間タイム・ベストは、この周の持ち時間が
        // ブロックやセーフティカーで動いたあと、syncLapTime で確定させる
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

      /* ---- マシンの不具合 ----
         いきなり止まる前に、たいていは「様子がおかしい」時間がある。
         ドライバーが訴え、ピットウォールが決める                */
      order.forEach(e => {
        if (e.dnf || lap < 2 || lap >= laps) return;
        if (e.trouble && !e.trouble.done) {
          const tb = e.trouble;
          // ピットで手当てすることにしていた車は、そこで軽くなる
          if (tb.act === 'pit' && tb.fixAt === lap) {
            tb.loss *= tb.def.fix;
            if (tb.loss < 0.08) { tb.done = true; }
            tb.act = 'nurse';
            if (e.isPlayer) e.radioFixed = lap;
          }
          // 放っておくほど、止まる確率が上がる
          const risk = tb.def.dnf * (tb.act === 'nurse' ? tb.def.nurse : 1)
                     * (1 + (tb.laps || 0) * 0.05)
                     * (e.sk('feeler') ? 0.55 : 1);
          if (tb.act === 'retire' && lap >= tb.from + 1) {
            e.dnf = true; e.dnfLap = lap;
            e.dnfReason = tb.def.name + '（チームがマシンを降ろした）';
            e.retired = true;
            events.push({ lap: lap, type: 'dnf', car: e,
              text: '🏳️ ' + e.driver.name + ' はピットへ。' + tb.def.name +
                    'を抱えたまま走らせず、チームがマシンを降ろした' });
            return;
          }
          if (Math.random() < risk) {
            e.dnf = true; e.dnfLap = lap; e.dnfReason = tb.def.name;
            events.push({ lap: lap, type: 'dnf', car: e,
              text: say(SAY.dnfMech, { A: e.driver.name, B: tb.def.name, C: lm(track) }) });
            return;
          }
        } else if (!e.trouble) {
          // 信頼性が低いほど、荒れるコースほど、不具合は出る
          const rate = (D.TROUBLE_RATE.base + (100 - e.rel) / 100 * D.TROUBLE_RATE.rel)
                     * track.risk * (e.sk('feeler') ? 0.55 : 1);
          if (Math.random() < rate) {
            // どこに出るかは、いちばん傷んでいる部位に寄せる
            const pool = D.TROUBLES.filter(x => x.cat === e.weakCat);
            const def = (pool.length && Math.random() < 0.55) ? S.pick(pool) : S.pick(D.TROUBLES);
            const pos = Math.max(1, order.filter(x => !x.dnf)
              .sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]).indexOf(e) + 1);
            const read = e.isPlayer ? S.readPower(g) : 1.0;
            const act = decideTrouble(e, def, lap, laps, pos, e.pitLoss || 22, read);
            // act は手当てのあとで変わるので、最初の判断も残しておく
            e.trouble = { def: def, from: lap, loss: def.loss, act: act, act0: act, laps: 0 };
            if (act === 'pit') {
              const at = Math.min(laps - 1, lap + 1);
              e.pitPlan = e.pitPlan.filter(l => l !== at).concat([at]).sort((a, b) => a - b);
              e.trouble.fixAt = at;
            }
            if (e.isPlayer) e.radioTrouble = lap;
            events.push({ lap: lap, type: 'miss', car: e,
              text: def.icon + ' ' + e.driver.name + ' が' + def.name + 'を訴えている' +
                    '（1周 -' + def.loss.toFixed(1) + '秒' +
                    (act === 'pit' ? '／ピットで手当てへ'
                     : act === 'nurse' ? '／抑えて運ぶ'
                     : act === 'retire' ? '／降ろす判断' : '／このまま行く') + '）' });
          }
        }
      });

      // リタイア判定
      order.forEach(e => {
        if (e.dnf || lap < 2) return;
        // 不具合を抱えている車の「いきなり止まる」ぶんは、上で見ている
        const mech = (100 - e.rel) / 100 * 0.0022 * 0.40 * track.risk * (e.sk('feeler') ? 0.55 : 1);
        /* クラッシュは「腕」ではなく「まとめる力」で決まる。
           速い人が壊さないとは限らない、というのがこのゲームの取引。
           ピットの指示（安全第一〜プッシュ）も、そのまま危うさに乗る */
        const crash = (1 - e.driver.mental / 230) * 0.0011 * track.risk * wx.chaos * e.st.risk
                    * S.careCrashMul(e.driver)
                    * (orderOf(e.order).risk != null ? orderOf(e.order).risk : 1)
                    * ((1 - e.bd.rigid * 0.30) / (1 - RIVAL_BODY_REF * 0.30));
        const r = Math.random();
        if (r < mech) {
          // どこが壊れたかは、いちばん傷んでいる部位に寄せる。
          // 「ギアボックスが限界だった」と、あとから納得できるように
          e.dnf = true; e.dnfLap = lap;
          e.dnfReason = e.weakCat ? MECH_BY_CAT[e.weakCat]
                      : S.pick(['エンジンブロー', 'ギアボックストラブル', '油圧系トラブル', 'MGU-K故障', 'ブレーキトラブル']);
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
          // 先導車の後ろに一列に並び直す。
          // 前の車との差を積み上げていく（i 倍していたため、
          // 後ろほど間隔が開き、順番まで入れ替わってしまっていた）
          /* 隊列に詰めるぶんは、その場で持ち時間を書き換えるのではなく
             「次の周で詰める」ぶんとして預ける。こうしないと、
             すでに走り終えた周のタイムが後から書き換わってしまい、
             観戦画面で車がコース上を飛ぶように見える              */
          let acc = run.length ? run[0].cum[lap - 1] : 0;
          run.forEach((e, i) => {
            if (i > 0) acc += S.rnd(0.55, 0.95);
            e.scPull = (e.scPull || 0) + (acc - e.cum[lap - 1]);
            e.scBunched = true;
          });
        }
        events.push({ lap: lap, type: 'sc',
          text: virtual
            ? '🟡 バーチャルセーフティカー！ 全車が一斉にペースを落とす（' + scLaps + '周）'
            : '🚨 セーフティカー出動！ 先導車の後ろに一列に詰まる（' + scLaps + '周）' });
        /* 隊列が遅いあいだ、安くなるのは「ピットロードを走るぶん」だけ。
           そのぶんが、まだ引っぱれたはずの周を捨てる損より大きいなら入る。
           実車のほうが隊列が遅いので、浮く時間もバーチャルより大きい     */
        run.forEach(e => {
          const next = e.pitPlan.find(l => l > lap);
          if (next == null) return;
          const save = e.pitLane * (1 - (virtual ? D.PIT_LANE_VSC : D.PIT_LANE_SC));
          const early = Math.max(0, next - lap - 1) * 1.05;   // 捨てる周のぶん
          const net = save - early;
          if (net < 1.0) return;
          if (Math.random() < 0.30 + (e.react || 0.4) * 0.45 + net * 0.045) {
            e.pitPlan[e.pitPlan.indexOf(next)] = lap + 1;
            e.pitPlan.sort((a, b) => a - b);
            e.scPit = true;
            if (e.isPlayer) {
              events.push({ lap: lap + 1, type: 'pit', car: e,
                text: '🔧 ' + e.driver.name + ' 隊列が遅いうちにピットへ！ ' +
                      'ピットロードのロスが ' + save.toFixed(1) + '秒 小さくなる' });
            }
          }
        });
      }

      /* ---- 隊列解除（リスタート）----
         先導の最終周が終わったところで、もう一度きれいに詰め直す。
         先導中にピットへ入った車は隊列の後ろに戻るが、隊列そのものが遅いので、
         次にラインを越えるころには車間は詰まっている。
         つまり再開はいつもホームストレートから、一列に並んだ状態で始まる。
         バーチャルは全車が同じだけ遅いだけなので、車間はそのまま     */
      let scEnded = false;
      if (scLaps > 0 && lap === scFrom + scLaps - 1 && lap < laps) {
        scEnded = true;
        if (!scInfo.virtual) {
          const line = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
          let acc = line.length ? line[0].cum[lap - 1] : 0;
          line.forEach((e, i) => {
            if (i > 0) acc += S.rnd(0.55, 0.95);
            // 出動時の詰め残しは、ここでの並びにもう入っている。足さずに置き換える
            e.scPull = acc - e.cum[lap - 1];
          });
        }
        events.push({ lap: lap + 1, type: 'restart',
          text: scInfo.virtual
            ? '🟢 バーチャルセーフティカー解除。コントロールラインから通常のレースに戻る'
            : '🟢 セーフティカーがピットへ！ ホームストレートから一斉にレース再開！' });
      }

      /* 持ち時間（cum）を動かしたあとで、ラップタイムと区間タイムを合わせ直す。
         ブロックや追い抜き、セーフティカーの並び直しは cum だけを動かしていたため、
         ここを飛ばすと「ラップは速いのに前とのギャップが縮まらない」表示になる */
      entries.forEach(e => {
        if (e.cum[lap - 1] == null || e.synced === lap) return;
        e.synced = lap;
        const prevC = lap === 1 ? 0 : (e.cum[lap - 2] || 0);
        const real = Math.max(0.1, e.cum[lap - 1] - prevC - (e.penSec[lap - 1] || 0));
        e.lapTimes[lap - 1] = real;
        const pitAdd = (e.pitTime || [])[lap - 1] || 0;
        const sh = e.prof.share;
        const dr = Math.max(0.1, real - pitAdd);
        const sec = [dr * sh[0], dr * sh[1], dr * sh[2] + pitAdd];
        e.sectors[lap - 1] = sec;
        const scNow3 = scLaps > 0 && lap >= scFrom && lap < scFrom + scLaps;
        if (scNow3) e.noRec[lap - 1] = true;
        if (lap > 1 && !e.dnf && !e.noRec[lap - 1]) {
          if (real < e.fastest) e.fastest = real;
          for (let k = 0; k < 3; k++) {
            if (sec[k] < e.bestSec[k]) e.bestSec[k] = sec[k];
            if (sec[k] < bestSector[k]) { bestSector[k] = sec[k]; bestSectorBy[k] = e.id; }
          }
        }
      });

      /* ---- レースの節目 ----
         抜いた・ミスした以外にも、見ていて「おっ」となる瞬間はある。
         ファステスト、表彰台圏の出入り、チームメイト同士の並走、最終ラップ  */
      {
        const run3 = order.filter(e => !e.dnf).sort((a, b) => a.cum[lap - 1] - b.cum[lap - 1]);
        run3.forEach((e, i) => {
          const pos = i + 1;
          if (lap > 1 && e.isPlayer) {
            // ファステストラップ。全体ベストを塗り替えた周だけ
            const t2 = e.lapTimes[lap - 1];
            if (t2 != null && !e.pitTime[lap - 1] && !e.noRec[lap - 1] && t2 < raceBest - 0.001) {
              raceBest = t2;
              if (!e.saidFastest || lap - e.saidFastest > 4) {
                e.saidFastest = lap;
                events.push({ lap: lap, type: 'fast', car: e,
                  text: say(SAY.fastest, { A: e.driver.name, T: track.name }) });
                radio.push({ lap: lap, from: 'pit', name: e.driver.name, id: e.id,
                             text: say(RADIO.fastest, { D: e.driver.name }) });
                radio.push({ lap: lap, from: 'drv', name: e.driver.name, id: e.id,
                             text: say(RADIO.fastestBack, { D: e.driver.name }) });
              }
            }
            // 表彰台圏・入賞圏の出入り
            const was = e.lastPos || pos;
            if (lap > 2 && was !== pos) {
              const V2 = { A: e.driver.name, P: pos };
              if (was > 3 && pos <= 3) {
                events.push({ lap: lap, type: 'pass', car: e, text: say(SAY.intoPodium, V2) });
                radio.push({ lap: lap, from: 'pit', name: e.driver.name, id: e.id,
                             text: say(RADIO.intoPodium, { P: pos }) });
              } else if (was <= 3 && pos > 3) {
                events.push({ lap: lap, type: 'miss', car: e, text: say(SAY.outPodium, V2) });
              } else if (was > D.POINTS.length && pos <= D.POINTS.length) {
                events.push({ lap: lap, type: 'pass', car: e, text: say(SAY.intoPoints, V2) });
              }
            }
            e.lastPos = pos;
          }
          // チームメイト同士の並走。同じ色の2台が1秒以内に並んだとき
          const nx = run3[i + 1];
          if (e.isPlayer && nx && nx.isPlayer && lap > 2 &&
              nx.cum[lap - 1] - e.cum[lap - 1] < 1.0 &&
              (!teamFightAt || lap - teamFightAt > 6)) {
            teamFightAt = lap;
            // 作戦を分けているときは、争わせない言いかたになる
            const apart = !!e.splitWith && e.stops !== nx.stops;
            events.push({ lap: lap, type: 'pass', car: e,
              text: say(SAY.teammate, { A: e.driver.name, B: nx.driver.name }) +
                    (apart ? '（作戦が違う2台。ピットは同士討ちを避けたい）' : '') });
            radio.push({ lap: lap, from: 'pit', name: e.driver.name, id: e.id,
                         text: say(apart ? RADIO.splitNear : RADIO.teammate,
                                   { D: e.driver.name, B: nx.driver.name }) });
            radio.push({ lap: lap, from: 'drv', name: e.driver.name, id: e.id,
                         text: say(apart ? RADIO.splitNearBack : RADIO.teammateBack,
                                   { D: e.driver.name }) });
          }
        });
        if (lap === laps) {
          events.push({ lap: lap, type: 'final', text: say(SAY.finalLap, {}) });
        }
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
                  scStart: scStarted, scVirtual: scInfo.virtual, scEnd: scEnded,
                  wxChanged: wxChangedThisLap, wxWet: wx.wet, wetLevel: wx.level || 0 });
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
      // end：チェッカーを受けてからのやりとり。ファイナルラップの頭ではなく、
      // 自分の車が実際にラインを通過してから鳴らす
      const end = !e.dnf;
      radio.push({ lap: at, end: end, from: 'pit', name: e.driver.name, id: e.id, text: say(pair[0], V) });
      radio.push({ lap: at, end: end, from: 'drv', name: e.driver.name, id: e.id, text: say(pair[1], V) });
    });
    radio.sort((a, b) => a.lap - b.lap);

    let fl = null;
    finishers.forEach(e => { if (!fl || e.fastest < fl.fastest) fl = e; });

    return {
      track, trackIndex, weather, laps, grid, entries, classified, finishers,
      events, radio: radio, wetLog: wetLog, foreLog: foreLog, wxChange: chg, fastestLap: fl, geo: geo, passEase: passEase, special: special || null,
      bestSector: bestSector, bestSectorBy: bestSectorBy,
      safetyCar: scInfo.laps ? scInfo : null,
      hotTeam: entries.hotTeam || '',
      weatherChange: wxInfo.at ? wxInfo : null,
      rubberLog: rubberLog,
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
    // ミュージアムがあると、勝てない週末でも語られるものが残る
    if (hypeDelta < 0 && S.hasEstate(g, 'museum')) hypeDelta *= 0.65;
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

    // ---- スピン ----
    // 路面と銘柄が噛み合わないまま走ると、タイムだけでなく姿勢も失う。
    // 何が起きていたのかを、レース後にも一度だけ言葉にしておく
    res.entries.filter(e => e.isPlayer && (e.spins || 0) > 0).forEach(e => {
      notes.push('🌀 ' + e.driver.name + ' はこのレースで ' + e.spins + '回スピンしました。' +
        '（路面に合わないタイヤ、終わったタイヤ、攻めすぎ——このどれかが続くと起きます。' +
        '乗りやすいマシンと、腕のあるドライバーほど、こらえられます）');
    });

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
            '万）。使用基数の上限（' + S.puLimit(g) + '基）を超えたため、次戦は ' +
            puRes.grid + 'グリッド降格。');
        } else {
          notes.push('⚙️ ' + puRes.used + '基目のパワーユニットに載せ替えた（' + puCost +
            '万／今季あと ' + Math.max(0, S.puLimit(g) - puRes.used) + '基）。');
        }
      }
    } else if (S.puOf(g).life < 40) {
      const pu2 = S.puOf(g);
      notes.push('⚙️ パワーユニットの残りが ' + Math.round(pu2.life) +
        '%。出力が ' + Math.round((1 - S.puForm(g)) * 100) + '%、信頼性が ' +
        Math.round(S.puRelDrop(g)) + ' 落ちている（今季あと ' +
        Math.max(0, S.puLimit(g) - pu2.used) + '基／保管 ' + pu2.pool.length + '基）。');
    }
    // ---- 修理費 ----
    // 壊した週末のツケは、次の週末までに払わなければならない
    const rep = S.repairBill(g, res);
    if (rep.total > 0) {
      g.funds -= rep.total;
      g.repairPaid = (g.repairPaid || 0) + rep.total;
      rep.lines.forEach(l => {
        notes.push('🔧 ' + l.name + ' のマシン修理（' + l.what + '） -' + l.cost + '万');
      });
      if (rep.total >= 2000) {
        notes.push('💸 修理に ' + rep.total + '万。開発に回せたはずの金が、そのまま消えた。');
      }
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

    /* ---- ADUO（空力開発格差是正指令）----
       この1戦で選手権がどれだけ一方的になったかを見て、FIA が動く。
       段が上がった／下がったときだけ、報せとして残す                */
    if (!sp) {
      const ad = S.aduoOf(g);
      const was = g.aduoLevel || 0;
      if (ad.level !== was) {
        g.aduoLevel = ad.level;
        if (ad.level > was) S.pushNews(g, 'aduo', ad.name);
        g.aduoNews = ad.level ? {
          level: ad.level, name: ad.name, icon: ad.icon, color: ad.color, note: ad.note,
          top: ad.top, mine: !!ad.topIsPlayer, up: ad.level > was,
          cut: ad.cut, lift: ad.lift
        } : { level: 0, up: false };
        notes.push(ad.level
          ? ad.icon + ' FIA が ADUO（空力開発格差是正指令）レベル' + ad.level + '「' + ad.name +
            '」を発令。' + (ad.topIsPlayer
              ? '独走している自チームの風洞・CFD時間が ×' + ad.cut.toFixed(2) + ' に削られる。'
              : ad.top + ' の時間が削られ、離されたチームに ×' + ad.lift.toFixed(2) + ' が回る。')
          : '⚖️ 選手権が競り合ってきたため、ADUO は解除された。開発時間の配り直しは終わり。');
      }
    }

    if (!sp && best && best.pos === 1) S.pushNews(g, 'win', best.driver.name);
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
    if (fanDelta > 0) fanDelta = Math.round(fanDelta * (1 + S.osk(g, 'fame') * 0.08)
                                            * (S.hasGear(g, 'market', 'stud') ? 1.12 : 1)
                                            * (S.hasEstate(g, 'shop') ? 1.08 : 1)
                                            * (S.hasEstate(g, 'esports') ? 1.18 : 1));
    // 負けが込んでも、離れていくのは一度に1割ちょっとまで。
    // どんなときも残ってくれる人たちがいる
    if (fanDelta < 0) fanDelta = Math.max(fanDelta, -Math.round(g.fans * 0.12) - 20);
    g.fans = Math.max(120, g.fans + fanDelta);
    g.rp += (sp ? sp.rp : 8) + Math.round(S.analystPower(g) * 2) + sponsorRp;

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

  return { simulate, prequalify, practice, applyResult, repackPU, STRATEGIES, rollWeather };
})();

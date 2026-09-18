/* =========================================================
   ラリー（WRC）のデータ

   サーキットの代わりに「ラリー」がある。ラリーは3日に分かれ、
   一日のなかに何本かのSS（スペシャルステージ）が入る。
   並んで走らず、1台ずつ出て、タイムの合計で順位が決まる。

   ここはデータだけ。走らせる側は rally.js。
   ========================================================= */
window.GP = window.GP || {};

GP.rallydata = (function () {
  'use strict';

  /* ---------- 路面 ----------
     車の作りかたの向き先が、路面ごとに変わる。
     grip  … 路面がどれだけ食うか（低いほどタイムが伸びない）
     rough … 壊れやすさ。石を拾う、底を打つ
     sweep … 先頭が損をする度合い。掃き掃除がどれだけ効くか      */
  const SURFACES = {
    gravel: { key: 'gravel', name: 'グラベル', icon: '🪨', color: '#96683a',
              grip: 0.92, rough: 1.00, sweep: 1.00,
              note: '砂利。上を掃くほど下から硬い路面が出てくる' },
    tarmac: { key: 'tarmac', name: 'ターマック', icon: '🛣️', color: '#5d5a6b',
              grip: 1.06, rough: 0.55, sweep: 0.18,
              note: '舗装。走行順はほとんど効かないが、路面の汚れは残る' },
    snow:   { key: 'snow',   name: 'スノー', icon: '❄️', color: '#a8c8f2',
              grip: 0.80, rough: 0.70, sweep: 0.55,
              note: '雪と氷。スパイクが刺されば速いが、掘れると別物になる' }
  };

  /* ---------- ラリー ----------
     days は「一日の中のSSの本数」。
     twisty はコーナーの多さ（1に近いほど曲がりどころ）。
     rough は路面の荒さ。km は1本の平均の長さ。               */
  const RALLIES = [
    { key: 'monte', name: 'ラリー・モンテヴェルデ', country: '🇲🇨', region: 'eu', every: 1,
      surface: 'tarmac', mix: 'snow', far: 0.65, risk: 1.30,
      weight: { speed: 0.26, corner: 0.48, accel: 0.26 },
      days: [4, 6, 3], km: 19, twisty: 0.78, rough: 0.30, night: true,
      desc: '凍った峠と、乾いた谷。同じSSの中で路面が変わる',
      places: ['シズン峠', 'ラ・ブレオル', 'ブルデュー', 'サン・ジャン', 'ヴァル・デ・プレ', 'トゥルニ'] },

    { key: 'snow', name: 'スノーフィヨルド・ラリー', country: '🇸🇪', region: 'eu', every: 1,
      surface: 'snow', far: 0.80, risk: 0.95,
      weight: { speed: 0.40, corner: 0.38, accel: 0.22 },
      days: [4, 6, 3], km: 17, twisty: 0.44, rough: 0.30,
      desc: '雪の壁に肩を預けて曲がる。世界でいちばん平均速度が高い',
      places: ['ヴァルグスタ', 'ローサ湖', 'ハーゲン', 'コルスビー', 'スヴァネ', 'ミッケルス'] },

    { key: 'sierra', name: 'シエラ・ロハ・ラリー', country: '🇲🇽', region: 'am', every: 2, slot: 0,
      surface: 'gravel', far: 1.35, risk: 1.05,
      weight: { speed: 0.36, corner: 0.34, accel: 0.30 },
      days: [4, 6, 3], km: 21, twisty: 0.52, rough: 0.72, heat: 0.90,
      desc: '標高2000m。空気が薄く、エンジンが本気を出せない',
      places: ['オテイツォ', 'ラス・ミナス', 'エル・チョコラテ', 'グアナフアト', 'イブアイ', 'デレチョ'] },

    { key: 'costa', name: 'コスタ・ヴェルデ・ラリー', country: '🇵🇹', region: 'eu', every: 1,
      surface: 'gravel', far: 0.75, risk: 1.00,
      weight: { speed: 0.32, corner: 0.40, accel: 0.28 },
      days: [4, 6, 3], km: 20, twisty: 0.60, rough: 0.66,
      desc: '砂の下から岩盤が出る。二度目に通ると別のコースになる',
      places: ['ロウザダ', 'アマランテ', 'ヴィエイラ', 'カブレイラ', 'モンチーニョ', 'フェルゲイラス'] },

    { key: 'savanna', name: 'サバンナ・トレイル', country: '🇰🇪', region: 'af', every: 1,
      surface: 'gravel', far: 1.45, risk: 1.55,
      weight: { speed: 0.34, corner: 0.28, accel: 0.38 },
      days: [4, 5, 4], km: 26, twisty: 0.34, rough: 1.00, heat: 0.95,
      desc: '岩と洗濯板と泥。完走できれば、それだけで表彰台が見える',
      places: ['カムクンジ', 'ソイサンブ', 'エレメンタイタ', 'スリーピング', 'ハエラ', 'マランバ'] },

    { key: 'lakeland', name: 'レイクランド・ラリー', country: '🇫🇮', region: 'eu', every: 1,
      surface: 'gravel', far: 0.90, risk: 1.20,
      weight: { speed: 0.46, corner: 0.30, accel: 0.24 },
      days: [4, 6, 3], km: 18, twisty: 0.30, rough: 0.40,
      desc: '丘を越えるたびに車が飛ぶ。着地の向きで次が決まる',
      places: ['オウニンポージャ', 'ルーヒマキ', 'ピヒラヤコスキ', 'ヤムサ', 'ハルユ', 'レーッパヴオリ'] },

    { key: 'olive', name: 'オリーヴ・マウンテン', country: '🇬🇷', region: 'eu', every: 2, slot: 1,
      surface: 'gravel', far: 0.95, risk: 1.45,
      weight: { speed: 0.28, corner: 0.36, accel: 0.36 },
      days: [4, 6, 3], km: 22, twisty: 0.62, rough: 0.95, heat: 0.85,
      desc: '尖った石が転がる山道。足まわりがそのまま結果になる',
      places: ['タルジナ', 'エレフテロホリ', 'パヴリアナ', 'バウキオン', 'アギイ', 'グラヴィア'] },

    { key: 'vigna', name: 'ヴィーニャ・アスファルト', country: '🇮🇹', region: 'eu', every: 1,
      surface: 'tarmac', far: 0.70, risk: 1.10,
      weight: { speed: 0.30, corner: 0.50, accel: 0.20 },
      days: [4, 6, 3], km: 18, twisty: 0.80, rough: 0.35,
      desc: '葡萄畑のあいだの細い舗装。落ちれば石垣が待っている',
      places: ['テルジュ', 'モンテ・レルノ', 'コルテ', 'フィリッピ', 'タヴォラーラ', 'ミカリツィア'] },

    { key: 'hinoki', name: 'ヒノキ・フォレスト', country: '🇯🇵', region: 'asia', every: 1,
      surface: 'tarmac', far: 1.40, risk: 1.25,
      weight: { speed: 0.28, corner: 0.48, accel: 0.24 },
      days: [4, 6, 3], km: 17, twisty: 0.84, rough: 0.30,
      desc: '濡れた杉林の林道。落ち葉と苔で、乾いた舗装の顔をしない',
      places: ['イスミ', 'ニノミヤ', 'イナブ', 'シタラ', 'オクミカワ', 'ネジバナ'] },

    { key: 'highland', name: 'ハイランド・グラベル', country: '🇬🇧', region: 'eu', every: 2, slot: 0,
      surface: 'gravel', far: 0.72, risk: 1.15,
      weight: { speed: 0.34, corner: 0.38, accel: 0.28 },
      days: [4, 6, 3], km: 19, twisty: 0.58, rough: 0.70,
      desc: '泥と水たまり。轍が深く、二番手以降のほうが走りやすい',
      places: ['ダイフナント', 'ミルウル', 'スウィート・ラム', 'ブレンギ', 'アルウェン', 'ゲイル'] },

    { key: 'mixto', name: 'ミクスト・ソル', country: '🇪🇸', region: 'eu', every: 1,
      surface: 'gravel', mix: 'tarmac', mixByDay: true, far: 0.72, risk: 1.00,
      weight: { speed: 0.34, corner: 0.42, accel: 0.24 },
      days: [4, 6, 3], km: 19, twisty: 0.66, rough: 0.50,
      desc: '初日は砂利、翌日から舗装。車を一晩で作り替える',
      places: ['テラ・アルタ', 'エル・プリオラート', 'サヴァリャ', 'リバ・ロージャ', 'ケローリ', 'サルー'] },

    { key: 'andes', name: 'アンデス・コースト', country: '🇨🇱', region: 'am', every: 2, slot: 1,
      surface: 'gravel', far: 1.50, risk: 1.10,
      weight: { speed: 0.38, corner: 0.36, accel: 0.26 },
      days: [4, 6, 3], km: 20, twisty: 0.54, rough: 0.58,
      desc: '海から丘へ駆け上がる。朝は霧、昼は埃',
      places: ['プルンコ', 'ビオビオ', 'ロス・ゴンサレス', 'マリア・ラス・クルセス', 'ペドロ', 'ラハ'] },

    { key: 'wein', name: 'ヴァインベルク・ラリー', country: '🇩🇪', region: 'eu', every: 2, slot: 0,
      surface: 'tarmac', far: 0.70, risk: 1.35,
      weight: { speed: 0.42, corner: 0.40, accel: 0.18 },
      days: [4, 6, 3], km: 20, twisty: 0.62, rough: 0.42,
      desc: '軍用地のコンクリート塊「ハインケルシュタイン」が待つ',
      places: ['パンツァープラッテ', 'グレーフェンブルク', 'ミッテルモーゼル', 'ルヴァリー', 'アルフ', 'ゴンツェラート'] }
  ];

  /* ---------- 走らせかた ----------
     攻めるほど速いが、外す確率も上がる。
     SSのたびに選ぶのではなく、一日の方針として決める        */
  const PACES = [
    { key: 'safe',  icon: '🛡️', name: '確実に',   pace: 0.988, risk: 0.55,
      note: '取りこぼさない。上とは離れるが、最後に残っている' },
    { key: 'std',   icon: '⚖️', name: '標準',     pace: 1.000, risk: 1.00,
      note: 'ペースノート通りに走る' },
    { key: 'push',  icon: '🔥', name: '攻める',   pace: 1.011, risk: 1.75,
      note: '差を詰めにいく。石も縁石も拾いやすくなる' },
    { key: 'max',   icon: '💥', name: '振り切る', pace: 1.019, risk: 2.80,
      note: '全部出す。1本で終わることもある' }
  ];

  /* ---------- SSで起きること ----------
     w は起きやすさの重み。lossS は失う秒。out なら終わり  */
  const TROUBLES = [
    { key: 'punc',  icon: '🛞', name: 'パンク',       w: 1.00, lossS: [40, 150], rough: 1.6,
      line: '右リアを切った。次のサービスまで、あと何本' },
    { key: 'spin',  icon: '🌀', name: 'スピン',       w: 0.85, lossS: [8, 30],  twist: 1.5,
      line: '曲がりきれずに回した。すぐ立て直したが、時計は止まらない' },
    { key: 'off',   icon: '🌾', name: 'コースオフ',   w: 0.55, lossS: [25, 110], twist: 1.3,
      line: '外に出た。観客に押してもらって戻る' },
    { key: 'susp',  icon: '🔩', name: 'サスペンション', w: 0.42, lossS: [60, 210], rough: 2.0,
      line: '底を打った。曲がる気がしないまま、フィニッシュまで' },
    { key: 'engine',icon: '⚙️', name: 'エンジン',     w: 0.20, out: true,
      line: '水温が上がりきった。ここで止まる' },
    { key: 'crash', icon: '💥', name: 'クラッシュ',   w: 0.30, out: true, twist: 1.2,
      line: '外側の土手に当てた。乗員は無事。車は動かない' }
  ];

  /* ---------- サービスパーク ----------
     決められた時間のなかで、どこまで直すか。
     時間を超えると、超えたぶんだけペナルティがつく          */
  const SERVICE = {
    minutes: 30,                  // 一回のサービスで使える時間
    overPerMin: 10,               // 1分の超過につき、この秒数が足される
    jobs: [
      { key: 'check', icon: '🔍', name: '点検だけ',   min: 5,  fix: 0.10, note: '締め直して送り出す' },
      { key: 'tyre',  icon: '🛞', name: 'タイヤ交換', min: 6,  fix: 0.00, tyre: true, note: '次の区間ぶんを積み直す' },
      { key: 'susp',  icon: '🔩', name: '足まわり',   min: 12, fix: 0.45, note: 'ダンパーとアームを入れ替える' },
      { key: 'body',  icon: '🔧', name: '外まわり',   min: 9,  fix: 0.25, note: 'ぶつけたところを叩き出す' },
      { key: 'engine',icon: '⚙️', name: '駆動系',     min: 16, fix: 0.60, note: 'ミッションとデフを見る' },
      { key: 'setup', icon: '🖊️', name: '味つけ',     min: 8,  setup: true, note: '次の路面へ合わせ込む' }
    ]
  };

  /* ---------- ペースノート ----------
     コ・ドライバーの腕と、レッキにかけた手間で決まる。
     読みが甘いほど、速く走れず、外しやすくなる              */
  const NOTES = {
    base: 0.52,        // 何もしないときの精度
    coNote: 0.34,      // コ・ドライバーの技能ぶん
    recce: 0.20,       // レッキ（下見）のぶん
    bond: 0.12,        // 息の合いかたのぶん
    paceAt: 0.045,     // 精度1あたり、タイムがどれだけ変わるか
    riskAt: 1.45       // 精度が低いほど、外す確率がこれだけ増える
  };

  /* レッキ（事前の下見）。週を使うかどうかを選ばせる */
  const RECCE = [
    { key: 'none', icon: '🚫', name: '行かない',   weeks: 0, cost: 0,    q: 0.00,
      note: '去年のノートを使い回す。知らない曲がりは出たとこ勝負' },
    { key: 'one',  icon: '🚗', name: '一往復',     weeks: 0, cost: 900,  q: 0.55,
      note: '主要なSSだけ通す。週は使わないが、金はかかる' },
    { key: 'full', icon: '📓', name: '二往復',     weeks: 1, cost: 1800, q: 1.00,
      note: '全SSを二度通して書き直す。1週まるごと使う' }
  ];

  /* ---------- 走行順 ----------
     グラベルの初日は、前にいるほど砂利を掃いて損をする。
     二日目からは前日の順位の逆順で出るので、今度は得をする   */
  const ROAD = {
    sweepMax: 0.012,     // 先頭が背負う、いちばん重いときの割合
    decay: 0.62,         // 後ろへ行くほど、どれだけ軽くなるか
    cleanFrom: 8         // これより後ろは、ほぼ掃き終わったあと
  };

  /* パワーステージ。最終SSの上位に、おまけの点が入る */
  const POWER_STAGE = [5, 4, 3, 2, 1];

  return { SURFACES, RALLIES, PACES, TROUBLES, SERVICE, NOTES, RECCE, ROAD, POWER_STAGE };
})();

/* =========================================================
   GRAND PRIX MONOGATARI - データ定義
   ========================================================= */
window.GP = window.GP || {};

GP.data = (function () {
  'use strict';

  /* ---------- サーキット ----------
     weight: そのコースで効くマシン性能の配分（合計1.0）
     path  : 0..1 正規化されたコース形状（描画・走行用の閉ループ）      */
  const TRACKS = [
    {
      name: 'ベイサイド・ストリート', country: '🇦🇪', laps: 24, base: 92,
      weight: { speed: 0.30, corner: 0.34, accel: 0.36 }, tyre: 1.15, risk: 1.20,
      desc: '低速コーナーの続く市街地。壁が近い。',
      landmarks: ['ハーバーヘアピン', 'マリーナ・シケイン', 'ブリッジコーナー'],
      path: [[.14,.72],[.1,.52],[.16,.4],[.12,.3],[.12,.2],[.62,.2],[.72,.26],[.72,.44],[.86,.44],[.9,.52],[.86,.62],[.55,.62],[.48,.72],[.3,.8]]
    },
    {
      name: 'シルバーウッド・パーク', country: '🇬🇧', laps: 26, base: 88,
      weight: { speed: 0.32, corner: 0.46, accel: 0.22 }, tyre: 1.25, risk: 0.95,
      desc: '高速コーナーの連続。エアロが物を言う。',
      landmarks: ['ウッドランド', 'ハイスピードS', 'オークカーブ'],
      path: [[.28,.2],[.42,.18],[.54,.24],[.6,.36],[.72,.3],[.84,.34],[.88,.46],[.8,.54],[.66,.52],[.56,.58],[.58,.7],[.68,.78],[.6,.86],[.44,.86],[.32,.8],[.3,.68],[.2,.6],[.1,.46],[.16,.3]]
    },
    {
      name: 'モンテローザ市街地', country: '🇲🇨', laps: 30, base: 78,
      weight: { speed: 0.14, corner: 0.44, accel: 0.42 }, tyre: 0.85, risk: 1.45,
      desc: '抜けない。予選が全て。ミスは即クラッシュ。',
      landmarks: ['カジノヘアピン', 'トンネル出口', 'ポートシケイン'],
      path: [[.52,.18],[.66,.24],[.62,.36],[.74,.42],[.84,.56],[.72,.66],[.56,.62],[.48,.7],[.52,.82],[.34,.86],[.22,.76],[.28,.62],[.18,.52],[.24,.38],[.18,.24]]
    },
    {
      name: 'グランデ・ロッソ', country: '🇮🇹', laps: 25, base: 84,
      weight: { speed: 0.56, corner: 0.20, accel: 0.24 }, tyre: 0.95, risk: 1.05,
      desc: '超高速。パワーユニットの馬力勝負。',
      landmarks: ['グランデ・カーブ', '第1シケイン', 'パラボリカ'],
      path: [[.55,.24],[.8,.23],[.89,.3],[.8,.36],[.86,.44],[.9,.58],[.7,.64],[.45,.66],[.25,.64],[.3,.55],[.18,.5],[.09,.38],[.08,.26],[.3,.25]]
    },
    {
      name: 'アルペン・リンク', country: '🇦🇹', laps: 28, base: 76,
      weight: { speed: 0.44, corner: 0.26, accel: 0.30 }, tyre: 1.05, risk: 1.00,
      desc: '短いラップに登り坂。ブレーキ勝負の一発勝負。',
      landmarks: ['マウンテンターン', 'ダウンヒル', 'サミット'],
      path: [[.2,.36],[.34,.26],[.56,.3],[.62,.44],[.78,.44],[.86,.56],[.76,.7],[.52,.74],[.4,.66],[.28,.76],[.16,.66]]
    },
    {
      name: 'サクラ・エイト', country: '🇯🇵', laps: 27, base: 95,
      weight: { speed: 0.30, corner: 0.42, accel: 0.28 }, tyre: 1.30, risk: 1.10,
      desc: '立体交差の8の字。総合力が問われる名コース。',
      landmarks: ['スプーンカーブ', '逆バンク', 'デグナー'],
      path: [[.62,.18],[.38,.14],[.2,.2],[.12,.36],[.2,.26],[.32,.22],[.4,.28],[.34,.36],[.42,.42],[.36,.5],[.44,.56],[.58,.54],[.7,.46],[.8,.48],[.84,.58],[.76,.66],[.64,.64],[.56,.7],[.6,.8],[.74,.84],[.86,.78],[.88,.62],[.8,.34]]
    },
    {
      name: 'デザート・ドーム', country: '🇧🇭', laps: 26, base: 90,
      weight: { speed: 0.38, corner: 0.24, accel: 0.38 }, tyre: 1.35, risk: 0.90,
      desc: '路面が荒くタイヤに厳しい。ナイトレース。',
      landmarks: ['ドーム・ターン', 'サンドトラップ', 'オアシスベンド'],
      path: [[.3,.82],[.16,.7],[.24,.52],[.14,.42],[.16,.28],[.48,.24],[.56,.36],[.72,.32],[.86,.44],[.8,.6],[.6,.64],[.52,.76]]
    },
    {
      name: 'メイプル・アイランド', country: '🇨🇦', laps: 29, base: 82,
      weight: { speed: 0.42, corner: 0.22, accel: 0.36 }, tyre: 1.10, risk: 1.25,
      desc: '低速シケイン＋長い直線。壁が待っている。',
      landmarks: ['ウォール・オブ・メイプル', 'アイランド・シケイン', 'ラストヘアピン'],
      path: [[.4,.32],[.68,.3],[.78,.34],[.72,.4],[.82,.44],[.9,.54],[.86,.66],[.62,.72],[.36,.74],[.26,.7],[.3,.62],[.2,.58],[.1,.46],[.1,.34]]
    },
    {
      name: 'グリーンヒル・フォレスト', country: '🇧🇪', laps: 24, base: 106,
      weight: { speed: 0.40, corner: 0.40, accel: 0.20 }, tyre: 1.20, risk: 1.15,
      desc: '長大な1周と天候の急変。ドライバーの腕が出る。',
      landmarks: ['オー・ルージュ', 'フォレストバンク', 'ラ・コンブ'],
      path: [[.34,.34],[.5,.3],[.66,.32],[.78,.38],[.86,.48],[.82,.58],[.7,.6],[.6,.54],[.52,.58],[.5,.68],[.58,.76],[.52,.86],[.36,.88],[.22,.84],[.14,.82],[.1,.74],[.14,.56],[.22,.42]]
    },
    {
      name: 'リオ・エストレラ', country: '🇧🇷', laps: 30, base: 74,
      weight: { speed: 0.34, corner: 0.32, accel: 0.34 }, tyre: 1.15, risk: 1.20,
      desc: '反時計回りの短いラップ。雨が多い。',
      landmarks: ['エストレラ・カーブ', 'スタジアム区間', 'セニーニャ'],
      path: [[.16,.68],[.18,.44],[.22,.24],[.54,.2],[.74,.3],[.82,.46],[.7,.58],[.5,.56],[.42,.66],[.5,.8],[.3,.84]]
    },
    {
      name: 'ラスベガス・ネオン', country: '🇺🇸', laps: 28, base: 96,
      weight: { speed: 0.52, corner: 0.24, accel: 0.24 }, tyre: 0.90, risk: 1.30,
      desc: 'ネオン輝く超高速ストリート。低温がタイヤを苦しめる。',
      landmarks: ['ネオンベンド', 'ストリップ・ターン', 'ダウンタウン'],
      path: [[.55,.78],[.2,.77],[.09,.62],[.36,.52],[.07,.38],[.07,.22],[.35,.21],[.65,.205],[.9,.2],[.94,.34],[.62,.4],[.9,.5],[.88,.7]]
    },
    {
      name: 'ファイナル・オアシス', country: '🇦🇪', laps: 27, base: 88,
      weight: { speed: 0.34, corner: 0.34, accel: 0.32 }, tyre: 1.05, risk: 0.85,
      desc: '最終戦。ここまでの全てが試される。',
      landmarks: ['ファイナルターン', 'パームコーナー', 'サンセットベンド'],
      path: [[.52,.26],[.72,.3],[.84,.42],[.78,.56],[.58,.58],[.5,.68],[.6,.8],[.38,.86],[.2,.76],[.24,.56],[.12,.46],[.14,.34]]
    }
  ];

  /* ---------- マシンパーツのカテゴリ ---------- */
  const PART_CATS = [
    { key: 'pu',    name: 'パワーユニット', icon: '⚙️', color: '#e04a3f',
      gain: { speed: 0.70, corner: 0.00, accel: 0.30 }, cost: 320, rp: 6,
      names: ['ベーシックV6', 'ターボV6', 'ハイブリッドV8', 'スーパーチャージV8', 'ゼロエミッションV10', 'ネオドライブV12'] },
    { key: 'aero',  name: 'エアロダイナミクス', icon: '🪽', color: '#3a7ad9',
      gain: { speed: 0.15, corner: 0.75, accel: 0.10 }, cost: 300, rp: 6,
      names: ['プレーンウイング', 'ダブルデッキ', 'ブロウンディフューザー', 'グラウンドエフェクト', 'アクティブエアロ', 'ゼロドラッグ'] },
    { key: 'chas',  name: 'シャシー', icon: '🧱', color: '#4ea63f',
      gain: { speed: 0.30, corner: 0.40, accel: 0.30 }, cost: 280, rp: 5,
      names: ['スチールフレーム', 'アルミモノコック', 'カーボンモノコック', 'ハニカムシェル', 'ナノカーボン', 'グラフェンコア'] },
    { key: 'susp',  name: 'サスペンション', icon: '🌀', color: '#b06fd0',
      gain: { speed: 0.05, corner: 0.65, accel: 0.30 }, cost: 260, rp: 5,
      names: ['ダブルウィッシュボーン', 'プッシュロッド', 'プルロッド', 'アクティブサス', 'マグネライド', 'リニアサス'] },
    { key: 'elec',  name: 'エレクトロニクス', icon: '💡', color: '#f0a020',
      gain: { speed: 0.20, corner: 0.20, accel: 0.60 }, cost: 240, rp: 5,
      names: ['ベーシックECU', 'デジタルECU', 'トラクションCPU', 'AIコントロール', 'ニューラルECU', 'クオンタムECU'] }
  ];

  /* ---------- オーナー（プレイヤー自身） ----------
     元ドライバーがチームを率いて世界一を目指す、という立ち位置。
     実績でランクが上がり、上がるたびにスキルポイントが手に入る。      */
  const OWNER_RANKS = [
    { need: 0,     name: '無名のオーナー',   icon: '🥚' },
    { need: 120,   name: '駆け出しのオーナー', icon: '🐣' },
    { need: 400,   name: '一人前のオーナー',  icon: '🧑‍💼' },
    { need: 1000,  name: '名の知れたオーナー', icon: '🎩' },
    { need: 2200,  name: '辣腕オーナー',     icon: '💼' },
    { need: 4200,  name: '名門の主',        icon: '🏛️' },
    { need: 7500,  name: '伝説のオーナー',   icon: '👑' }
  ];

  /* スキルの系統。各段はランクで解放され、スキルポイントで伸ばす */
  const OWNER_SKILLS = [
    { key: 'nego',  name: '交渉術', icon: '🤝', color: '#e04a3f',
      desc: '引き抜きの心証が上がりやすくなり、移籍金と契約更改の要求が下がる',
      eff: ['心証の伸び +12%/Lv', '移籍金 -6%/Lv', '契約更改の要求 -4%/Lv'] },
    { key: 'money', name: '商才',   icon: '💰', color: '#ffc93c',
      desc: 'スポンサー収入と賞金が増え、週の運営費が下がる',
      eff: ['スポンサー収入 +6%/Lv', '賞金 +5%/Lv', '運営費 -3%/Lv'] },
    { key: 'eye',   name: '技術眼', icon: '🔬', color: '#3a7ad9',
      desc: '開発の伸びと、他チームを偵察したときの研究ポイントが増える',
      eff: ['開発の伸び +7%/Lv', '偵察の研究P +25%/Lv', '週の研究P +1/Lv'] },
    { key: 'call',  name: '采配',   icon: '🎯', color: '#4ea63f',
      desc: 'ピット作業が速くなり、アンダーカットが決まりやすく、調子も上がる',
      eff: ['ピット時間 -0.5秒/Lv', '仕掛ける成功率 +8%/Lv', 'レース週の調子 +2/Lv'] },
    { key: 'fame',  name: '知名度', icon: '📣', color: '#b06fd0',
      desc: '注目度が上がりやすく、取材が強く効き、ファンが増えやすい',
      eff: ['注目度の増え +20%/Lv', '取材の効果 +25%/Lv', 'ファンの増え +8%/Lv'] }
  ];
  const OWNER_SKILL_MAX = 5;

  /* 元ドライバーとしての経歴。オーナーの初期スキルに反映される */
  const OWNER_PASTS = [
    { key: 'champ', name: '元王者',     icon: '👑',
      desc: '頂点を知っている。人が集まり、名前が売れる',
      skills: { nego: 1, fame: 1 }, funds: -2500 },
    { key: 'iron',  name: '鉄人',       icon: '💪',
      desc: '長く走り続けた。現場を知り、采配に活きる',
      skills: { call: 2 }, funds: 0 },
    { key: 'tech',  name: 'テストの鬼', icon: '🔧',
      desc: '開発ドライバーとして生きた。マシンを見る目がある',
      skills: { eye: 2 }, funds: 0 },
    { key: 'star',  name: '人気者',     icon: '🌟',
      desc: '速さより愛された。スポンサーと客がついてくる',
      skills: { fame: 1, money: 1 }, funds: 1500 },
    { key: 'privateer', name: '雑草',   icon: '🌱',
      desc: '金のないところから這い上がった。台所事情に強い',
      skills: { money: 2 }, funds: 3000 }
  ];

  /* ---------- チームごとの作戦の性格 ----------
     シーズンを通して変わらないので、「あのチームは引っ張る」と覚えられる。
     stopBias  ストップ回数の増減
     pitShift  予定周回を早める(-)／遅らせる(+) 割合
     tyreBias  0=攻め（柔らかいタイヤ） 1=バランス 2=堅実（硬いタイヤ）
     react     アンダーカットを仕掛ける積極性 0..1                       */
  const STRAT_STYLES = {
    aggressive: { name: '強気',   icon: '🔥', stopBias:  1, pitShift: -0.10, tyreBias: 0, react: 0.85 },
    steady:     { name: '堅実',   icon: '🛡️', stopBias: -1, pitShift:  0.10, tyreBias: 2, react: 0.20 },
    balanced:   { name: '標準',   icon: '⚖️', stopBias:  0, pitShift:  0.00, tyreBias: 1, react: 0.50 },
    wild:       { name: '型破り', icon: '🎲', stopBias:  0, pitShift:  0.00, tyreBias: 1, react: 0.65, random: true }
  };
  const STRAT_STYLE_KEYS = ['aggressive', 'steady', 'balanced', 'balanced', 'wild'];

  /* ---------- コースの景観テーマ ---------- */
  const THEMES = {
    grass:  { sky: '#7fbf5a', dot: '#76b552', edge: '#e8e0c8', road: '#55585f', night: false },
    forest: { sky: '#4f8f42', dot: '#468239', edge: '#e2dcc4', road: '#4e5158', night: false },
    alpine: { sky: '#8fc96a', dot: '#84bd5f', edge: '#eee7d2', road: '#5b5e66', night: false },
    street: { sky: '#9aa0a8', dot: '#8f959d', edge: '#d8d2c0', road: '#4c4f56', night: false },
    desert: { sky: '#d8b878', dot: '#cfae6c', edge: '#f0e6cc', road: '#5a5a5e', night: true },
    neon:   { sky: '#1b2038', dot: '#232a4a', edge: '#4a4f6a', road: '#3a3d48', night: true }
  };
  const TRACK_THEME = {
    'ベイサイド・ストリート': 'street', 'シルバーウッド・パーク': 'grass',
    'モンテローザ市街地': 'street',   'グランデ・ロッソ': 'grass',
    'アルペン・リンク': 'alpine',     'サクラ・エイト': 'grass',
    'デザート・ドーム': 'desert',     'メイプル・アイランド': 'grass',
    'グリーンヒル・フォレスト': 'forest', 'リオ・エストレラ': 'grass',
    'ラスベガス・ネオン': 'neon',     'ファイナル・オアシス': 'desert'
  };

  /* ---------- パーツのレアリティ ----------
     mult は製作時のベース性能、capMult は改良の上限に効く          */
  const RARITY = [
    { n: 1, name: 'ノーマル',     color: '#a89878', mult: 1.00, capMult: 1.00 },
    { n: 2, name: 'レア',         color: '#4ea63f', mult: 1.22, capMult: 1.11 },
    { n: 3, name: 'スーパーレア', color: '#3a7ad9', mult: 1.50, capMult: 1.22 },
    { n: 4, name: 'ウルトラレア', color: '#b06fd0', mult: 1.85, capMult: 1.34 },
    { n: 5, name: 'レジェンド',   color: '#f0a020', mult: 2.30, capMult: 1.48 }
  ];

  /* ---------- パーツに付く追加効果（製作時に稀に付与）---------- */
  const PART_TRAITS = [
    { key: 'light',  name: '軽量化',   icon: '🪶', desc: '加速性能がさらに上がる' },
    { key: 'tough',  name: '高耐久',   icon: '🛡️', desc: '消耗しにくい' },
    { key: 'cool',   name: '冷却強化', icon: '❄️', desc: 'トラブルが起きにくい' },
    { key: 'sharp',  name: '高剛性',   icon: '💠', desc: 'コーナー性能がさらに上がる' },
    { key: 'boost',  name: '高出力',   icon: '🔥', desc: '最高速がさらに上がる' }
  ];

  /* ---------- 車体（マシン本体）----------
     パーツとは別に、車体そのものを1年かけて熟成させる。
     新型マシンを作ると数値は上がるが、また育て直しになる            */
  /* 車体はパーツと同じ土俵で速さを競わない。
     パーツが触らないところ ―― 壊れにくさ、タイヤの保ち、ピット作業、維持費 ――
     を担当する。効果は「今のマシンの上限に対して何割まで煮詰めたか」で効く。 */
  const BODY_ATTRS = [
    { key: 'rigidity', name: '剛性',       icon: '🧱', color: '#4ea63f',
      desc: 'コーナー性能がわずかに上がる',
      eff: '壊れにくくなり、クラッシュも減る（信頼性 +9／クラッシュ -30%）',
      gain: { speed: 0.00, corner: 0.18, accel: 0.00 } },
    { key: 'light',    name: '軽量化',     icon: '🪶', color: '#7ecbf0',
      desc: '最高速と加速がわずかに上がる',
      eff: 'タイヤに優しくなり、スティントを引っぱれる（摩耗 -22%）',
      gain: { speed: 0.26, corner: 0.00, accel: 0.20 } },
    { key: 'aeroBody', name: '空力コンセプト', icon: '🌬️', color: '#3a7ad9',
      desc: 'コーナー性能がわずかに上がる',
      eff: 'エアロパーツの効きが増し、前車を追いやすくなる（追い抜き +20%）',
      gain: { speed: 0.00, corner: 0.26, accel: 0.00 } },
    { key: 'cooling',  name: '冷却',       icon: '❄️', color: '#b06fd0',
      desc: '加速がごくわずかに上がる',
      eff: '信頼性 +7、バッテリーの回生が増え、終盤のタレが小さくなる',
      gain: { speed: 0.00, corner: 0.00, accel: 0.06 } },
    { key: 'battery',  name: 'バッテリー',   icon: '🔋', color: '#f0a020',
      desc: '最高速と加速がわずかに上がる',
      eff: '電気の容量と放電量が増え、直線で伸びる',
      gain: { speed: 0.12, corner: 0.00, accel: 0.14 } },
    { key: 'drive',    name: 'ドライバビリティ', icon: '🎯', color: '#e0644a',
      desc: 'マシンそのものの速さは変わらない',
      eff: '素直で乗りやすくなり、ドライバーが腕をそのまま出せる（ドライバー評価 +8%／ミス -25%）',
      gain: { speed: 0.00, corner: 0.00, accel: 0.00 } },
    { key: 'service',  name: '整備性',     icon: '🧰', color: '#c98b4a',
      desc: 'マシンそのものの速さは変わらない',
      eff: 'ピット作業が最大2.2秒速くなり、パーツの消耗が -35%（維持費が下がる）',
      gain: { speed: 0.00, corner: 0.00, accel: 0.00 } }
  ];
  /* 車体の各項目の上限は、マシン世代の上限に対する割合で決まる */
  const BODY_CAP_RATIO = 0.35;
  /* 新型を作ったとき、前の車体の知見をどれだけ引き継ぐか */
  const BODY_CARRY = 0.50;

  /* ---------- 開発リソースの配分 ----------
     今シーズンの熟成に全振りするか、来季のマシンに前倒しで着手するか。
     早く始めるほど来季が強くなるが、そのぶん今季の伸びが落ちる         */
  const FOCUS_LEVELS = [
    { key: 'now',   name: '今季に全力', icon: '🔥', next: 0.00, cur: 1.00,
      desc: '来季の準備はしない。今季の伸びが最大' },
    { key: 'mostly',name: '今季優先',   icon: '⚖️', next: 0.20, cur: 0.88,
      desc: '少しだけ来季に手をつける' },
    { key: 'half',  name: '半々',       icon: '🔀', next: 0.45, cur: 0.70,
      desc: '今季と来季に半分ずつ' },
    { key: 'next',  name: '来季優先',   icon: '🌱', next: 0.75, cur: 0.48,
      desc: '今季は捨て気味。来季に大きく賭ける' }
  ];
  /* 蓄えた「来季ぶんの開発」が、翌シーズンの車体にどれだけ乗るか */
  const CARRY_TO_NEXT = 0.55;

  /* ---------- マシンの世代（研究で開発）---------- */
  const CAR_GENS = [
    { name: 'MK-I',   cap: 30,  rp: 0,    cost: 0,     base: 0 },
    { name: 'MK-II',  cap: 55,  rp: 90,   cost: 3200,  base: 4 },
    { name: 'MK-III', cap: 80,  rp: 260,  cost: 9500,  base: 9 },
    { name: 'MK-IV',  cap: 108, rp: 640,  cost: 28000, base: 15 },
    { name: 'MK-V',   cap: 140, rp: 1100, cost: 52000, base: 22 },
    { name: 'MK-VI',  cap: 180, rp: 1800, cost: 90000, base: 30 }
  ];

  /* ---------- ドライバースキル ----------
     効果はすべて race.js のシミュレーションに実際に接続されている  */
  const SKILLS = [
    { key: 'rain',    name: '雨の魔術師',     icon: '🌧️', desc: '雨のレースで速さが大きく上がる' },
    { key: 'start',   name: 'スタートダッシュ', icon: '🚀', desc: '1周目で大きく順位を上げる' },
    { key: 'tyre',    name: 'タイヤマネジメント', icon: '🛞', desc: 'タイヤの消耗をおさえる' },
    { key: 'spurt',   name: 'ラストスパート',   icon: '🏃', desc: 'レース終盤に速さが上がる' },
    { key: 'heart',   name: '鉄の心臓',       icon: '❤️', desc: 'ミスによるクラッシュが激減する' },
    { key: 'passer',  name: 'オーバーテイカー', icon: '⚔️', desc: '前車に詰まっても失速しにくい' },
    { key: 'qualify', name: '予選番長',       icon: '⏱️', desc: '予選での速さが上がる' },
    { key: 'feeler',  name: 'マシンフィーラー', icon: '🔧', desc: 'マシントラブルを未然に防ぐ' },
    { key: 'precise', name: '精密機械',       icon: '📐', desc: 'ラップタイムがブレなくなる' },
    { key: 'stamina', name: 'アイアンマン',   icon: '💪', desc: '終盤の体力低下がなくなる' },
    { key: 'genius',  name: '天性のセンス',   icon: '✨', desc: '常に速さが底上げされる' },
    { key: 'grower',  name: '大器晩成',       icon: '🌱', desc: '経験値を多く獲得する' }
  ];

  /* ---------- 施設 ---------- */
  const FACILITIES = [
    { key: 'factory', name: 'ファクトリー', icon: '🏭', desc: '開発コマンドの伸びが上がる',   base: 1800 },
    { key: 'tunnel',  name: '風洞',         icon: '💨', desc: 'エアロ／サスの開発が伸びる',   base: 2200 },
    { key: 'sim',     name: 'シミュレーター', icon: '🕹️', desc: 'ドライバー育成が加速する',   base: 2000 },
    { key: 'market',  name: 'マーケティング室', icon: '📣', desc: 'スポンサー収入が増える',   base: 1600 },
    { key: 'pit',     name: 'ピット設備',   icon: '🔧', desc: 'ピット作業とマシン信頼性が上がる', base: 1900 },
    { key: 'youth',   name: 'ユースアカデミー', icon: '🎓', desc: '若手の成長が速くなり、枠も増える', base: 2400 }
  ];

  /* ---------- 難易度 ----------
     数値はすべて実際の計算に掛かる倍率。ticket は
     「何戦入賞できなければ開発チケットが1枚もらえるか」        */
  const DIFFICULTIES = [
    {
      key: 'easy', name: 'イージー', icon: '🌴', color: '#4ea63f',
      short: '大口スポンサーの後ろ盾つき',
      desc: '産油国の巨大スポンサーが最初から付き、資金に困りません。' +
            'ライバルの土台が弱く、賞金もスポンサー料も多めに入ります。',
      rivalPower: 0.78, rivalGrow: 1.05, funds: 1.45, prize: 1.15, sponsor: 1.15,
      ticket: 3, oilSponsor: true
    },
    {
      key: 'normal', name: 'ノーマル', icon: '⚖️', color: '#3a7ad9',
      short: '標準のバランス',
      desc: '弱小チームから這い上がる、基本の難易度です。' +
            'ライバルもシーズン中に少しずつ速くなります。',
      rivalPower: 1.00, rivalGrow: 1.10, funds: 1.00, prize: 1.00, sponsor: 1.00,
      ticket: 4, oilSponsor: false
    },
    {
      key: 'hard', name: 'ハード', icon: '🔥', color: '#e04a3f',
      short: '周りが速い',
      desc: 'ライバルが強く、シーズン中も毎週マシンを煮詰めてきます。' +
            '手を止めるとすぐ置いていかれ、資金も賞金も渋い。',
      rivalPower: 1.05, rivalGrow: 1.15, funds: 0.82, prize: 0.88, sponsor: 0.88,
      ticket: 5, oilSponsor: false
    }
  ];

  /* イージー専用の大口スポンサー */
  const OIL_SPONSOR = {
    name: 'アル・ナジュム石油', icon: '🛢️', kind: 'cash',
    per: 1950, rp: 0, fan: 0, bonus: 6000, bonusRp: 0, need: 6, fans: 0, hype: 0
  };

  /* ---------- 才能（成長のしやすさ）---------- */
  const POTENTIAL = [
    { n: 1, name: '平凡',   color: '#a89878', growth: 0.72 },
    { n: 2, name: '有望',   color: '#4ea63f', growth: 0.92 },
    { n: 3, name: '逸材',   color: '#3a7ad9', growth: 1.15 },
    { n: 4, name: '天才肌', color: '#b06fd0', growth: 1.45 },
    { n: 5, name: '大器',   color: '#f0a020', growth: 1.85 }
  ];

  /* ---------- 国籍 ---------- */
  const NATIONS = [
    { flag: '🇯🇵', name: '日本' },      { flag: '🇮🇹', name: 'イタリア' },
    { flag: '🇬🇧', name: 'イギリス' },  { flag: '🇩🇪', name: 'ドイツ' },
    { flag: '🇫🇷', name: 'フランス' },  { flag: '🇪🇸', name: 'スペイン' },
    { flag: '🇧🇷', name: 'ブラジル' },  { flag: '🇳🇱', name: 'オランダ' },
    { flag: '🇫🇮', name: 'フィンランド' }, { flag: '🇦🇺', name: 'オーストラリア' },
    { flag: '🇨🇦', name: 'カナダ' },    { flag: '🇲🇽', name: 'メキシコ' },
    { flag: '🇦🇷', name: 'アルゼンチン' }, { flag: '🇸🇪', name: 'スウェーデン' },
    { flag: '🇺🇸', name: 'アメリカ' },  { flag: '🇩🇰', name: 'デンマーク' }
  ];

  /* ---------- 性格 ----------
     形だけの飾りにせず、すべてゲーム内の数値に効かせている            */
  const PERSONALITIES = [
    { key: 'hot',   name: '熱血漢',        icon: '🔥', desc: '結果に感情が乗る。勝てば絶好調、負ければ落ち込む',
      up: 1.9, down: 1.9, rest: 1.0, train: 1.0, dev: 0 },
    { key: 'cool',  name: 'クール',        icon: '🧊', desc: '結果に左右されず、いつも通りの走りをする',
      up: 0.5, down: 0.35, rest: 1.0, train: 1.0, dev: 0 },
    { key: 'pro',   name: '職人肌',        icon: '🔧', desc: 'マシンへの要求が的確。開発の伸びが上がる',
      up: 0.9, down: 0.9, rest: 1.0, train: 1.0, dev: 0.14 },
    { key: 'sunny', name: 'ムードメーカー', icon: '☀️', desc: 'チームの空気が良くなる。休養での回復が大きい',
      up: 1.2, down: 0.7, rest: 1.7, train: 1.0, dev: 0 },
    { key: 'proud', name: '負けず嫌い',    icon: '👑', desc: '表彰台なら絶好調。圏外だと荒れる',
      up: 1.6, down: 1.5, rest: 0.9, train: 1.15, dev: 0 },
    { key: 'study', name: '努力家',        icon: '📚', desc: '練習の効果が高く、経験値も多く得る',
      up: 1.0, down: 0.8, rest: 1.0, train: 1.35, dev: 0.05 },
    { key: 'wild',  name: '荒くれ',        icon: '⚡', desc: '攻めの走りを好む。調子の波が激しい',
      up: 1.5, down: 1.4, rest: 1.2, train: 0.9, dev: 0 }
  ];

  /* ---------- レース後のひとこと ---------- */
  const QUOTES = {
    hot:   { win: ['最高だ！ この一勝はチームのみんなのものだ！', 'やったぞ！ もっと勝てる、絶対にだ！'],
             ok:  ['悪くない。でも俺はもっと上に行きたい！', 'next はもっと前だ。まだまだこれからだ！'],
             bad: ['クソッ…！ 俺の走りじゃなかった。', '悔しい。次は絶対に返す。約束する。'] },
    cool:  { win: ['計算通りだ。マシンがよく仕上がっていた。', '悪くないレースだった。それだけだ。'],
             ok:  ['想定の範囲内だ。淡々と積み上げよう。', 'データは取れた。次に活かせる。'],
             bad: ['今日は条件が合わなかった。それだけのことだ。', '感情的になっても速くはならない。切り替える。'] },
    pro:   { win: ['このマシン、仕上がってきましたね。最高です。', 'いい仕事をしてくれた。整備班にも礼を言いたい。'],
             ok:  ['ターン3のバランスが気になる。詰めましょう。', 'あと一歩、リアの安定感が欲しいですね。'],
             bad: ['マシンの挙動が読めなかった。原因を探ります。', 'セットアップを一から見直させてください。'] },
    sunny: { win: ['やったー！ 今夜はお祝いだね！', 'みんなの顔が見たいよ、最高の一日だ！'],
             ok:  ['ポイント持ち帰れたし、上出来上出来！', 'いい流れだよ、この調子でいこう！'],
             bad: ['まあ、こんな日もあるって！ next next！', '落ち込んでてもしょうがない。切り替えていこう！'] },
    proud: { win: ['当然の結果だ。私はこの場所にいるべき人間だ。', '見たか。これが実力の差というものだ。'],
             ok:  ['この順位で満足しろと？ 冗談じゃない。', 'マシンさえ良ければ、私はもっと前にいる。'],
             bad: ['論外だ。こんな結果は受け入れられない。', '誰かが責任を取るべきだ。私ではない。'] },
    study: { win: ['信じられない…！ practice が報われました！', '練習でやってきたことが、そのまま出せました！'],
             ok:  ['まだ課題は山ほどあります。持ち帰って詰めます。', '一つずつ、確実に上を目指します。'],
             bad: ['力不足です。もっと練習させてください。', '悔しいですが、原因は分かっています。直します。'] },
    wild:  { win: ['ハハッ！ 攻めた奴が勝つんだよ！', '突っ込んで、差した。それだけさ！'],
             ok:  ['もう一回仕掛けてれば行けたな。', '守りに入った瞬間に終わりだ。次は行く。'],
             bad: ['攻めた結果だ。後悔はしてない。', 'ちょっとやりすぎたか？ まあ次があるさ。'] }
  };

  /* ---------- ドライバー名プール ---------- */
  const FIRST = ['レオ','マルコ','アキラ','ニコ','ダニ','ハビ','ユーリ','カイ','セバス','エミル','ラウル','トマ','ミカ','オリー','ルカ','ジル','ハンネス','ソラ','エンツォ','パブロ','ヨナス','ケント','アラン','ディノ','リアム','マテオ','ハル','ノア','エリオ','ヴィム','ジョー','タケル','ピエール','サンドロ'];
  const LAST  = ['ヴァレンティ','シュナイダー','ロッシ','ベルガー','クルツ','モラレス','イワノフ','タカハシ','デュポン','オコナー',
                 'リンドクヴィスト','ペレイラ','ファン・デル・ベルク','コルテス','ヤマギシ','ブランコ','ヴァイス','ドラゴ','マルケス','キャンベル',
                 'ソレンセン','ナカジマ','フェルナンデス','ヴィドマー','オルソン','ブルネッリ','マクレガー','ハートマン','コヴァチ','ルソー',
                 'サンチェス','エステバン','ノヴァク','ミハイロフ','ベネデット','クロフト','アマーリオ','シライシ','ラガルド','フォークナー'];

  /* ---------- ライバルチーム ---------- */
  /* bias は3性能の配分。チームごとにマシンの個性が違い、
     コースとの相性で速さが変わる（合計 1.0）                       */
  const RIVALS = [
    { name: 'スクーデリア・ロッソ',  color: '#e02020', power: 1.00, char: 'パワー型',       bias: { speed: .42, corner: .28, accel: .30 } },
    { name: 'アルジェント・ワークス', color: '#c8ccd4', power: 0.98, char: 'オールラウンド', bias: { speed: .34, corner: .33, accel: .33 } },
    { name: 'ブルーブル・レーシング', color: '#1a3a8f', power: 0.96, char: 'ダウンフォース型', bias: { speed: .26, corner: .44, accel: .30 } },
    { name: 'マクレイン・パピヤ',    color: '#ff8000', power: 0.92, char: 'パワー型',       bias: { speed: .40, corner: .29, accel: .31 } },
    { name: 'アストロ・グリーン',    color: '#0f8a5f', power: 0.88, char: 'コーナー重視',   bias: { speed: .29, corner: .39, accel: .32 } },
    { name: 'アルピナ・ブルー',      color: '#2f86d8', power: 0.84, char: 'トラクション型', bias: { speed: .28, corner: .35, accel: .37 } },
    { name: 'ウィリス・モータース',  color: '#4aa8e0', power: 0.78, char: 'ロードラッグ型', bias: { speed: .44, corner: .26, accel: .30 } },
    { name: 'ハースト・レーシング',  color: '#b0182c', power: 0.74, char: 'トラクション型', bias: { speed: .34, corner: .26, accel: .40 } },
    { name: 'キック・ザウバル',      color: '#00c04a', power: 0.72, char: 'オールラウンド', bias: { speed: .32, corner: .34, accel: .34 } },
    { name: 'ヴィザ・トロロッソ',    color: '#5a7ad0', power: 0.70, char: 'コーナー重視',   bias: { speed: .28, corner: .38, accel: .34 } }
  ];

  /* ---------- スポンサー ---------- */
  /* fans はファン数、hype は注目度（露出）の必要値。
     大手ほど「話題になっているチーム」でないと相手にしてくれない        */
  const SPONSOR_KINDS = {
    cash:  { name: '現金型',   icon: '💰', desc: '毎戦まとまった資金が入る' },
    tech:  { name: '技術提携', icon: '🔬', desc: '資金は少ないが、研究ポイントが大きく入る' },
    mixed: { name: '複合型',   icon: '🔀', desc: '資金と研究ポイントの両方が入る' },
    media: { name: '露出型',   icon: '📣', desc: '資金は控えめだが、ファンと注目度が伸びる' }
  };

  const SPONSORS = [
    { name: 'マメゾウ電機',   icon: '🔌', kind: 'cash',  per: 340,  rp: 0,  fan: 0,
      bonus: 1500,  bonusRp: 0,   need: 12, fans: 0,     hype: 0 },
    { name: 'カメカメ運送',   icon: '📦', kind: 'cash',  per: 450,  rp: 0,  fan: 0,
      bonus: 2200,  bonusRp: 0,   need: 10, fans: 400,   hype: 8 },
    { name: 'テクノ理研',     icon: '🧪', kind: 'tech',  per: 120,  rp: 9,  fan: 0,
      bonus: 400,   bonusRp: 26,  need: 10, fans: 300,   hype: 6 },
    { name: 'ホシノ製菓',     icon: '🍬', kind: 'media', per: 420,  rp: 0,  fan: 130,
      bonus: 1800,  bonusRp: 0,   need: 8,  fans: 1200,  hype: 18 },
    { name: 'グリーンオイル', icon: '🛢️', kind: 'cash',  per: 880,  rp: 0,  fan: 0,
      bonus: 5000,  bonusRp: 0,   need: 6,  fans: 3000,  hype: 30 },
    { name: '未来重工',       icon: '⚙️', kind: 'tech',  per: 260,  rp: 20, fan: 0,
      bonus: 900,   bonusRp: 60,  need: 6,  fans: 2500,  hype: 26 },
    { name: 'ゼンリョク銀行', icon: '🏦', kind: 'cash',  per: 1280, rp: 0,  fan: 0,
      bonus: 8000,  bonusRp: 0,   need: 5,  fans: 7000,  hype: 42 },
    { name: 'ネクサス通信',   icon: '📡', kind: 'mixed', per: 900,  rp: 14, fan: 90,
      bonus: 4200,  bonusRp: 40,  need: 3,  fans: 14000, hype: 55 },
    { name: 'クオンタム研究所', icon: '🔭', kind: 'tech', per: 380,  rp: 38, fan: 0,
      bonus: 1400,  bonusRp: 120, need: 4,  fans: 12000, hype: 52 },
    { name: 'オリオン航空',   icon: '✈️', kind: 'media', per: 1500, rp: 0,  fan: 420,
      bonus: 7000,  bonusRp: 0,   need: 2,  fans: 26000, hype: 68 },
    { name: 'ワールドテック', icon: '🌐', kind: 'mixed', per: 1900, rp: 26, fan: 160,
      bonus: 9000,  bonusRp: 80,  need: 1,  fans: 45000, hype: 82 }
  ];

  /* 目標達成ボーナスは、1シーズンにこの回数まで（契約上の上限） */
  const SPONSOR_BONUS_CAP = 3;

  /* ---------- 注目度（メディア露出）---------- */
  const HYPE_TIERS = [
    { max: 12,  name: '無名',       icon: '🫥', color: '#a89878' },
    { max: 28,  name: '注目され始め', icon: '📻', color: '#8a9a6a' },
    { max: 46,  name: '話題のチーム', icon: '📰', color: '#4ea63f' },
    { max: 64,  name: '人気チーム',   icon: '📺', color: '#3a7ad9' },
    { max: 82,  name: '主役',        icon: '🌟', color: '#b06fd0' },
    { max: 101, name: '時代の顔',    icon: '👑', color: '#f0a020' }
  ];

  /* 順位ごとの注目度の増減。ポイント圏外でも上位で終えれば露出は増える */
  const HYPE_BY_POS = [16, 12, 10, 8, 7, 6, 5.5, 5, 4.5, 4, 3, 2.6, 2.2, 1.8, 1.5, 1.2, 1, 0.8, 0.6, 0.4, 0.3, 0.2];

  /* ファステストラップのボーナスポイント（10位以内で完走した場合のみ） */
  const FASTEST_LAP_POINT = 1;

  /* ---------- マネジメント層（役職）----------
     現場のスタッフとは別枠。1役職に1人だけ据えられる。
     効果はすべて実際の計算に掛かる                                  */
  const MANAGERS = [
    { key: 'principal', name: 'チームプリンシパル', icon: '👔', salary: 180,
      desc: 'チームの顔。スポンサー収入と注目度が上がり、スタッフも育ちやすくなる',
      effect: '収入 +0.6%／技能1、注目度 +0.4%／技能1' },
    { key: 'technical', name: '開発責任者',       icon: '🔬', salary: 150,
      desc: '技術部門の統括。開発の伸びと、設計するパーツのレアリティが上がる',
      effect: '開発 +0.8%／技能1、レアリティ抽選に加算' },
    { key: 'pitchief',  name: 'ピットクルーチーフ', icon: '🔧', salary: 130,
      desc: 'ピット作業を仕切る。停止時間が短くなり、マシンの信頼性も上がる',
      effect: 'ピット -0.06秒／技能1、信頼性 +0.15／技能1' },
    { key: 'logistics', name: 'ロジスティクス責任者', icon: '🚚', salary: 85,
      desc: '遠征と運営の効率化。週ごとの固定費が下がる（大所帯ほど効く）',
      effect: '固定費 -1.0%／技能1（最大35%）' }
  ];

  /* ---------- ERS（バッテリー）----------
     エレクトロニクスの性能から容量と回生量が決まる。
     直線で放電して速さに変え、前車に迫るときは多めに使う             */
  const ERS = {
    baseCapacity: 55,       // 最低限の容量
    capPerPower: 1.35,      // エレクトロニクス性能1あたりの容量
    recoverBase: 15,        // 1周あたりの基本回生量
    recoverPerPower: 0.30,  // 性能1あたりの追加回生量
    deployBase: 18,         // 通常時に1周で使う量
    deployPerPower: 0.30,   // 性能1あたりの追加放電量
    attackMul: 1.75,        // 前車に迫っているときの倍率
    gainPerUnit: 0.00025    // 放電1あたりのラップタイム短縮率
  };

  /* ---------- スタッフ ---------- */
  const STAFF_TYPES = [
    { key: 'engineer',   name: 'エンジニア',     icon: '👷', desc: '開発の伸びが上がる',           salary: 60 },
    { key: 'designer',   name: 'デザイナー',     icon: '🎨', desc: '設計するパーツのレアリティが上がる', salary: 62 },
    { key: 'mechanic',   name: 'メカニック',     icon: '🔩', desc: '信頼性とピット作業が上がる',   salary: 50 },
    { key: 'strategist', name: 'ストラテジスト', icon: '🧠', desc: 'ピット戦略が最適化される',     salary: 65 },
    { key: 'analyst',    name: 'アナリスト',     icon: '📊', desc: '研究ポイントが増える',         salary: 55 },
    { key: 'trainer',    name: 'トレーナー',     icon: '💪', desc: 'ドライバー育成が上がる',       salary: 45 }
  ];

  /* ---------- 特別戦 ----------
     選手権とは別に、準備週へ不定期に舞い込むイベントレース。
     laps は通常の何倍か、rules はシミュレーションに渡す特別ルール。   */
  const SPECIALS = [
    {
      key: 'endurance', name: '耐久レース', icon: '🌙',
      desc: '通常の2倍の距離を走り抜く長丁場。完走できればファンも賞金も大きい。',
      note: 'マシンの消耗が激しく、信頼性とスタミナが物を言う',
      lapMul: 2.0, entry: 800, prize: 3.0, fans: 2.2, wear: 3.2, rp: 18,
      minSeason: 1
    },
    {
      key: 'exhibition', name: 'エキシビションレース', icon: '🎪',
      desc: '短距離のお祭りレース。順位は選手権に影響しないが、ファンが一気に増える。',
      note: 'リタイアしてもペナルティはない。気軽に攻められる',
      lapMul: 0.45, entry: 400, prize: 1.2, fans: 3.4, wear: 0.6, rp: 6,
      minSeason: 1
    },
    {
      key: 'rookie', name: '新人テスト', icon: '🔰',
      desc: '若手だけの走行会。順位より、走り込みそのものが糧になる。',
      note: 'ドライバーの経験値が大きく入る。マシンへの負担も軽い',
      lapMul: 0.6, entry: 300, prize: 0.6, fans: 0.8, wear: 0.8, rp: 10,
      exp: 90, minSeason: 1
    },
    {
      key: 'sponsor', name: 'スポンサーカップ', icon: '🏆',
      desc: 'スポンサー主催の招待レース。上位に入れば契約金がはずむ。',
      note: '賞金がとにかく大きい。逆に言えばそれだけが目的',
      lapMul: 0.8, entry: 1200, prize: 4.5, fans: 1.4, wear: 1.4, rp: 8,
      minSeason: 2
    },
    {
      key: 'rain', name: 'レインマスターズ', icon: '⛈️', force: 'rain',
      desc: '雨天決行が決まっている変わり種の一戦。腕自慢が集まる。',
      note: '必ず雨。雨に強いドライバーの独壇場になる',
      lapMul: 0.7, entry: 600, prize: 2.2, fans: 2.0, wear: 1.6, rp: 14,
      minSeason: 2
    }
  ];

  /* ---------- ポイントシステム ---------- */
  /* 実際のF1と同じ配点。10位までが入賞 */
  const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

  /* ---------- 賞金（シーズン末・コンストラクターズ順位）---------- */
  const PRIZE = [72000, 56000, 45000, 35000, 28000, 22000, 17500, 13500, 10500, 8000, 6400];

  /* ---------- タイヤ ----------
     pace はラップタイムの倍率（小さいほど速い）、
     wear は摩耗の速さ、life は性能が落ちきるまでの目安周回数        */
  const TYRES = [
    { key: 'soft',   name: 'ソフト',    short: 'S', color: '#e02020', text: '#fff',
      pace: 0.986, wear: 1.60, life: 15, wet: false, desc: 'いちばん速いが、あっという間に摩耗する' },
    { key: 'medium', name: 'ミディアム', short: 'M', color: '#f0c000', text: '#3a2413',
      pace: 1.000, wear: 1.00, life: 25, wet: false, desc: '速さと保ちのバランス型' },
    { key: 'hard',   name: 'ハード',    short: 'H', color: '#eeeae0', text: '#3a2413',
      pace: 1.014, wear: 0.66, life: 38, wet: false, desc: '遅いが長く保つ。ストップを減らせる' },
    { key: 'inter',  name: 'インター',  short: 'I', color: '#4ea63f', text: '#fff',
      pace: 1.000, wear: 1.15, life: 24, wet: true,  desc: '小雨〜半乾き路面用' },
    { key: 'wet',    name: 'ウェット',  short: 'W', color: '#3a7ad9', text: '#fff',
      pace: 1.000, wear: 0.95, life: 30, wet: true,  desc: '大雨用。水を大量に掻き出す' }
  ];
  const DRY_TYRES = ['soft', 'medium', 'hard'];

  /* ---------- 天候 ---------- */
  const WEATHER = [
    { key: 'sunny', name: '晴れ',   icon: '☀️', grip: 1.00, chaos: 1.00 },
    { key: 'cloud', name: 'くもり', icon: '☁️', grip: 1.01, chaos: 1.00 },
    { key: 'rain',  name: '雨',     icon: '🌧️', grip: 0.93, chaos: 1.60 },
    { key: 'storm', name: '大雨',   icon: '⛈️', grip: 0.87, chaos: 2.20 }
  ];

  return { SPONSOR_BONUS_CAP, OWNER_RANKS, OWNER_SKILLS, OWNER_SKILL_MAX, OWNER_PASTS, STRAT_STYLES, STRAT_STYLE_KEYS, TRACKS, THEMES, TRACK_THEME, DIFFICULTIES, OIL_SPONSOR, POTENTIAL, PART_CATS, RARITY,
           BODY_ATTRS, BODY_CAP_RATIO, BODY_CARRY, FOCUS_LEVELS, CARRY_TO_NEXT, PART_TRAITS, CAR_GENS, SKILLS, FACILITIES,
           SPONSOR_KINDS, NATIONS, PERSONALITIES, QUOTES, SPECIALS, TYRES, DRY_TYRES, MANAGERS, ERS, HYPE_TIERS, HYPE_BY_POS, FASTEST_LAP_POINT, FIRST, LAST, RIVALS, SPONSORS, STAFF_TYPES, POINTS, PRIZE, WEATHER };
})();

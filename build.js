/* =========================================================
   1ファイル版のビルド
   index.html / assets/style.css / src/*.js をまとめて
   grandprix.html を作る。ファイル1つで完結するので、
   ダウンロードして開くだけで確実に遊べる。

     node build.js
   ========================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// index.html から読み込み順を拾う（並び順の二重管理を避ける）
let html = read('index.html');
const scripts = [];
html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => { scripts.push(src); return _; });
if (!scripts.length) throw new Error('index.html に <script src> が見つかりません');

const css = read('assets/style.css');

let out = html;

// 1) 外部スタイルシートをインライン化
out = out.replace('<link rel="stylesheet" href="assets/style.css">',
  '<style>\n' + css + '\n</style>');

// 2) 外部スクリプトをインライン化（1つ目の位置にまとめて差し込む）
const bundle = scripts.map(src =>
  '<script>\n/* ===== ' + src + ' ===== */\n' + read(src) + '\n</script>'
).join('\n');
out = out.replace('<script src="' + scripts[0] + '"></script>', bundle);
scripts.slice(1).forEach(src => {
  out = out.replace('<script src="' + src + '"></script>\n', '');
  out = out.replace('<script src="' + src + '"></script>', '');
});

// 3) 単体ファイルでは使えないものを外す
out = out.replace('<link rel="manifest" href="manifest.webmanifest">\n', '');
out = out.replace(/<link rel="apple-touch-icon"[^>]*>\n/, '');
out = out.replace(/<link rel="icon"[^>]*>\n/, '');
out = out.replace(/^\s*registerSW\(\);\n/m, '');

// 4) 出自が分かるようにしておく
out = out.replace('<head>',
  '<head>\n<!-- このファイルは build.js が生成した1ファイル版です。編集は src/ 側で行ってください。 -->');

fs.writeFileSync(path.join(ROOT, 'grandprix.html'), out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log('grandprix.html を生成しました（' + kb + ' KB / スクリプト ' + scripts.length + ' 本を同梱）');

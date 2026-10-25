// app.js/style.cssを単一HTMLに同期する。外部依存は不要。
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const script = '\n' + ['app.js', 'sns.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n;\n') + '\n';
const style = '\n' + fs.readFileSync(path.join(root, 'style.css'), 'utf8') + '\n';
if (/<\/script/i.test(script) || /<\/style/i.test(style)) throw Error('埋め込みを終了するタグが含まれています');
const hash = text => createHash('sha256').update(text).digest('base64');
const target = path.join(root, 'index.html');
const original = fs.readFileSync(target, 'utf8');
const html = original
  .replace(/<!-- HIGHT:STYLE -->[\s\S]*?<!-- \/HIGHT:STYLE -->/, () => `<!-- HIGHT:STYLE --><style>${style}</style><!-- /HIGHT:STYLE -->`)
  .replace(/<!-- HIGHT:SCRIPT -->[\s\S]*?<!-- \/HIGHT:SCRIPT -->/, () => `<!-- HIGHT:SCRIPT --><script>${script}</script><!-- /HIGHT:SCRIPT -->`)
  .replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/, (_, start, end) => `${start}default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'${end}`);
if (!html.includes(`<script>${script}</script>`) || !html.includes(`<style>${style}</style>`)) throw Error('埋め込みマーカーがありません');
if (process.argv.includes('--check')) {
  if (html !== original) throw Error('index.htmlが古くなっています。node scripts/build.cjsを実行してください');
  console.log('HTMLとソース・CSPハッシュの同期OK');
} else {
  fs.writeFileSync(target, html);
  console.log('index.htmlを生成しました');
}

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const emulator = process.env.HIGHT_EMULATORS === '1';
if (emulator && !process.env.HIGHT_OUTPUT_FILE) throw Error('テスト用ビルドには別のHIGHT_OUTPUT_FILEが必要です');
const bundled = esbuild.buildSync({ entryPoints: [path.join(root, 'sns.js')], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: ['es2020'], supported: { 'template-literal': false }, minify: true,
  define: { __HIGHT_EMULATORS__: String(emulator) }, legalComments: 'inline' }).outputFiles[0].text;
const script = '\n' + fs.readFileSync(path.join(root, 'app.js'), 'utf8') + '\n;\n' + bundled.replace(/<\/script/gi, '<\\/script') + '\n';
const style = '\n' + fs.readFileSync(path.join(root, 'style.css'), 'utf8') + '\n';
const hash = text => createHash('sha256').update(text).digest('base64');
const target = process.env.HIGHT_OUTPUT_FILE || path.join(root, 'index.html');
const original = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const connect = emulator ? 'http://127.0.0.1:9099 http://127.0.0.1:8080 ws://127.0.0.1:8080' : 'https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com';
const html = original
  .replace(/<!-- HIGHT:STYLE -->[\s\S]*?<!-- \/HIGHT:STYLE -->/, () => `<!-- HIGHT:STYLE --><style>${style}</style><!-- /HIGHT:STYLE -->`)
  .replace(/<!-- HIGHT:SCRIPT -->[\s\S]*?<!-- \/HIGHT:SCRIPT -->/, () => `<!-- HIGHT:SCRIPT --><script>${script}</script><!-- /HIGHT:SCRIPT -->`)
  .replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/, (_, a, b) => `${a}default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; connect-src ${connect}; object-src 'none'; base-uri 'none'; form-action 'none'${b}`);
if (!html.includes(`<script>${script}</script>`)) throw Error('埋め込みマーカーがありません');
if (process.argv.includes('--check')) {
  if (html !== original) throw Error('index.htmlが古くなっています。npm run buildを実行してください');
  console.log('HTML・SDK・CSPの同期OK');
} else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, html); console.log('HTMLを生成しました: ' + target); }

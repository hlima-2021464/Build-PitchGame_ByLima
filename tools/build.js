'use strict';
// Regenera los archivos que sirve el sitio a partir de src/.
// No forma parte de lo que descarga el navegador.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');

function minifyCSS(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function minifyHTML(code) {
  return code.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
}

execSync('npx --yes terser src/game.js -c passes=3 -m -o game.js', { stdio: 'inherit', cwd: root });
fs.writeFileSync(path.join(root, 'style.css'), minifyCSS(fs.readFileSync(path.join(src, 'style.css'), 'utf8')));
fs.writeFileSync(path.join(root, 'index.html'), minifyHTML(fs.readFileSync(path.join(src, 'index.html'), 'utf8')));

const files = ['index.html', 'style.css', 'game.js'];
let total = 0;
console.log('\nBytes sin comprimir (lo que cuenta para el limite):');
for (const f of files) {
  const n = fs.statSync(path.join(root, f)).size;
  total += n;
  console.log(f.padEnd(12), n);
}
console.log('TOTAL'.padEnd(12), total);
console.log('Objetivo 29000. Limite 32000 (32 KB) / 32768 (32 KiB).');

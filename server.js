'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const files = new Set(['index.html', 'styles.css', 'app.js', 'processing.js', 'editor.js']);
function createServer() { return http.createServer((req, res) => {
  const name = (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.html';
  if (!files.has(name)) { res.writeHead(404); res.end('Arquivo não encontrado'); return; }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[path.extname(name)], 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(root, name)).pipe(res);
}); }
if (require.main === module) createServer().listen(4173, '127.0.0.1', () => console.log('Totem Studio: http://127.0.0.1:4173 — Ctrl+C para encerrar.'));
module.exports = { createServer };

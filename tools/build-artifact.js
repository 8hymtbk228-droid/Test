// Baut aus index.html + rules.js + app.js eine einzelne Seite für die Veröffentlichung als Claude-Artifact.
// Aufruf: node tools/build-artifact.js <zieldatei>
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = process.argv[2];
if (!out) { console.error('Zieldatei angeben: node tools/build-artifact.js <zieldatei>'); process.exit(1); }

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/\s*<meta charset[^>]*>/, '')
  .replace(/\s*<meta name="viewport"[^>]*>/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
  // Datei-Downloads sind in der Artifact-Ansicht gesperrt -> nur lokal anbieten
  .replace(/<!--local-only-->[\s\S]*?<!--\/local-only-->/g, '')
  .replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
    `<script>\n${fs.readFileSync(path.join(root, src), 'utf8')}\n</script>`);

fs.writeFileSync(out, head.trim() + '\n' + body.trim() + '\n');
console.log(`geschrieben: ${out}`);

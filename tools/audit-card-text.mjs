// audit.mjs — compare every card the 30 lists use, printed text against the text the
// game generates, and flag any printed clause with no counterpart. Presence of a field
// is not evidence of implementation: a card can carry a keyword and still be missing its
// whole ability, which is how shd-184 slipped through.
// Run: node tools/audit-card-text.mjs [scratchDir]
// Reads the local source-name pack for printed text, so it only works on a machine that
// has one; it is a checking tool, not part of the game.
import { readFileSync, writeFileSync } from 'node:fs'; import vm from 'node:vm';
const root = 'C:/Users/antho/OneDrive/Documents/Star wars unlimited/';
const html = readFileSync(root + 'tests.html', 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !/tests\//.test(s));
const window = {}; window.window = window;
const ctx = vm.createContext({ window, console, SB: undefined });
for (const s of srcs) vm.runInContext(readFileSync(root + s, 'utf8'), ctx, { filename: s });
const SB = window.SB;
function objAfter(src, marker) { const i = src.indexOf(marker); let s = src.indexOf('{', i), d = 0;
  for (let j = s; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return JSON.parse(src.slice(s, j + 1)); } }
const X = objAfter(readFileSync(root + 'data/names-source.js', 'utf8'), 'var X = ');
const ids = new Set();
for (const d of JSON.parse(readFileSync((process.argv[2] || 'scratch') + '/decks2.json', 'utf8')))
  for (const c of d.cats.flatMap(x => x.cards)) if (c.id) ids.add(c.id);
// Markers that MUST show up on our side if the printed card has them.
const MARK = [
  [/when played/i, /when played/i], [/on attack\b/i, /on attack/i],
  [/when defeated/i, /when defeated/i], [/when attacked/i, /when this unit is attacked|when attacked/i],
  [/when attack ends|when.*attack ends/i, /attack ends|after this unit attacks/i],
  [/\baction\b\s*\[/i, /\baction\b/i], [/epic action/i, /epic action/i],
  [/\bambush\b/i, /\bambush\b/i], [/\bsentinel\b/i, /\bsentinel\b/i],
  [/\boverwhelm\b/i, /\boverwhelm\b/i], [/\braid \d/i, /\braid\b/i],
  [/\bshielded\b/i, /\bshielded\b/i], [/\bgrit\b/i, /\bgrit\b/i],
  [/\brestore \d/i, /\brestore\b/i], [/\bsaboteur\b/i, /\bsaboteur\b/i],
  [/\bsmuggle\b/i, /\bsmuggle\b/i], [/\bexploit \d/i, /\bexploit\b/i],
  [/\bpiloting\b/i, /\bpilot/i], [/\bbounty\b/i, /\bbounty\b/i],
  [/\bhidden\b/i, /\bhidden\b/i], [/\bplot\b/i, /\bplot\b/i], [/\bcoordinate\b/i, /\bcoordinate\b/i],
];
const rows = [];
for (const id of [...ids].sort()) {
  const printed = (X[id] || []).join(' / ');
  if (!printed) continue;
  let ours; try { ours = SB.cardText(id).join(' / '); } catch (e) { ours = 'TEXT ERROR: ' + e.message; }
  const missing = MARK.filter(([p, o]) => p.test(printed) && !o.test(ours)).map(([p]) => String(p));
  // A printed number that appears nowhere in ours is often a dropped cost or amount.
  const pn = (printed.match(/\d+/g) || []); const on = new Set(ours.match(/\d+/g) || []);
  const lostNums = [...new Set(pn.filter(n => !on.has(n)))];
  if (missing.length || (!ours && printed) || lostNums.length)
    rows.push({ id, printed, ours, missing, lostNums });
}
writeFileSync((process.argv[2] || 'scratch') + '/audit.json', JSON.stringify(rows, null, 1));
console.log('cards with printed rules checked:', ids.size, '| flagged:', rows.length);
for (const r of rows) console.log('\n### ' + r.id + (r.missing.length ? '  MISSING ' + r.missing.join(' ') : '') + (r.lostNums.length ? '  NUMS ' + r.lostNums.join(',') : '') + '\n  P: ' + r.printed.slice(0, 150) + '\n  O: ' + (r.ours || '(nothing)').slice(0, 150));

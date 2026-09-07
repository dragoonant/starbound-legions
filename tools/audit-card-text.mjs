// audit-card-text.mjs — compare every card the competitive lists use, printed text
// against the text the game generates, and flag any printed clause with no counterpart.
// Presence of a field is not evidence of implementation: a card can carry a keyword and
// still be missing its whole ability, which is how shd-184 slipped through.
// Run: node tools/audit-card-text.mjs [deckIdPrefixOrRange]
//   node tools/audit-card-text.mjs              # every registered deck
//   node tools/audit-card-text.mjs c21-c50      # just the wave-2 lists
// Reads the generated source-name pack for printed text, so it only works where that
// pack is present; it is a checking tool, not part of the game.
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(root + 'tests.html', 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !/tests\//.test(s));
const window = {}; window.window = window;
const ctx = vm.createContext({ window, console, SB: undefined });
for (const s of srcs) vm.runInContext(readFileSync(root + s, 'utf8'), ctx, { filename: s });
const SB = window.SB;
function objAfter(src, marker) { const i = src.indexOf(marker); let s = src.indexOf('{', i), d = 0;
  for (let j = s; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return JSON.parse(src.slice(s, j + 1)); } }
const X = objAfter(readFileSync(root + 'data/names-source.js', 'utf8'), 'var X = ');
// Which decks to sweep: a "c21-c50" style range, a plain prefix, or everything.
const arg = process.argv[2] || '';
const range = /^c(\d+)-c(\d+)$/.exec(arg);
function wanted(id) {
  if (!arg) return true;
  if (range) { const m = /^deck-c(\d+)$/.exec(id); return m && +m[1] >= +range[1] && +m[1] <= +range[2]; }
  return id.startsWith('deck-' + arg) || id.startsWith(arg);
}
const ids = new Set(); const decks = [];
for (const [did, d] of Object.entries(SB.decks)) {
  if (!wanted(did)) continue; decks.push(did);
  for (const c of [d.leader, d.base, ...(d.cards || []), ...(d.sideboard || [])]) if (c) ids.add(c);
}
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
console.log('decks swept:', decks.length, '| cards with printed rules checked:', ids.size, '| flagged:', rows.length);
for (const r of rows) console.log('\n### ' + r.id + (r.missing.length ? '  MISSING ' + r.missing.join(' ') : '') + (r.lostNums.length ? '  NUMS ' + r.lostNums.join(',') : '') + '\n  P: ' + r.printed.slice(0, 220) + '\n  O: ' + (r.ours || '(nothing)').slice(0, 220));

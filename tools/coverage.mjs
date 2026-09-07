// coverage.mjs — per-card usage coverage from random play. NOT part of the test
// suite (it is slow by design): it plays many random games with a recorder on the
// op dispatcher and reports which cards were never played and which of their ops
// never resolved. The output is a work queue for deterministic scenario tests, not
// a verdict — an op that never fires may be unreachable (a bug) or merely rare
// (the random player never got there). Usage:
//   node tools/coverage.mjs [--games N] [--deck <id>] [--top K] [--out file] [--all]
//     --games N   random games per deck (default 20; each deck plays N games,
//                 seats alternating, against a rotating opponent)
//     --deck id   only play games featuring this deck (both seats)
//     --top K     how many never-fired entries to print (default 25)
//     --out file  where the full JSON report goes (default scratch/coverage.json;
//                 scratch/ is gitignored, so a report never lands in a commit)
//     --all       print the full never-fired list instead of the top K
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function flag(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const GAMES = +flag('--games', 20);
const ONLY = flag('--deck', null);
const TOP = +flag('--top', 25);
const OUT = flag('--out', join(root, 'scratch', 'coverage.json'));
const ALL = args.includes('--all');

// Load the engine exactly as the test runner does (one script list, no drift), minus
// the test files themselves.
const html = readFileSync(join(root, 'tests.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
  .filter(s => !s.startsWith('tests/'));
const window = {};
window.window = window;
const context = vm.createContext({ window, console, SB: undefined });
for (const src of srcs) vm.runInContext(readFileSync(join(root, src), 'utf8'), context, { filename: src });
const SB = window.SB;
SB.validateContent();

// ---- 1. Stamp every op in the card data with a stable coverage id ------------------
// Ops are plain data; the engine clones state by JSON so a stamp on the card data
// rides along into every queue item built from it, including nested then/else, the
// a/b branches of a binary choice, repeated effects and granted temporary abilities.
const expected = {};          // cardId -> [usage id, ...]
function stampOps(ops, cardId, path) {
  (ops || []).forEach((op, i) => {
    const id = path + '/' + i + ':' + op.op;
    op._cov = id;
    expected[cardId].push(id);
    stampOps(op.then, cardId, id + '.then');
    stampOps(op.else, cardId, id + '.else');
    if (op.a && op.a.effects) stampOps(op.a.effects, cardId, id + '.a');
    if (op.b && op.b.effects) stampOps(op.b.effects, cardId, id + '.b');
    if (op.effect) stampOps([op.effect], cardId, id + '.effect');
    if (op.ability && op.ability.effects) stampOps(op.ability.effects, cardId, id + '.ability');
    if (op.grantTempAbility && op.grantTempAbility.effects) stampOps(op.grantTempAbility.effects, cardId, id + '.grant');
  });
}
function stampHolder(holder, cardId, label) {
  if (!holder) return;
  (holder.abilities || []).forEach((ab, i) => stampOps(ab.effects, cardId, label + ab.trigger + '#' + i));
  if (holder.effects) stampOps(holder.effects, cardId, label); // epicAbility
}
const PLAYABLE = { unit: 'played', event: 'played', upgrade: 'played', leader: 'deployed' };
// A card no registered deck carries can never be reached by deck play; it is listed
// separately so it does not pass for a suspect.
const inDeck = new Set();
Object.keys(SB.decks).forEach(d => {
  const dk = SB.decks[d];
  [dk.leader, dk.base].concat(dk.cards || [], dk.sideboard || []).forEach(id => inDeck.add(id));
});
for (const cardId of Object.keys(SB.cards)) {
  const c = SB.cards[cardId];
  if (/^fx-/.test(cardId)) continue;                 // test fixtures
  expected[cardId] = [];
  if (PLAYABLE[c.type]) expected[cardId].push(PLAYABLE[c.type]);
  stampHolder(c, cardId, '');
  stampHolder(c.leaderSide, cardId, 'leader:');
  stampHolder(c.deployedSide, cardId, 'deployed:');
  stampHolder(c.pilotSide, cardId, 'pilot:');
  stampHolder(c.epicAbility, cardId, 'epic');
}

// ---- 2. Record --------------------------------------------------------------------
const hits = {};               // usage id -> count
const fizzles = {};            // cardId -> count of fizzled ops
function hit(k) { hits[k] = (hits[k] || 0) + 1; }
const prevExecOp = SB.execOp;
SB.execOp = function (state, item, target) {
  if (item.op && item.op._cov) hit(item.op._cov);
  return prevExecOp(state, item, target);
};
const prevLog = SB.log;
SB.log = function (state, entry) {
  if (entry.type === 'playCard' && entry.cardId) hit(entry.cardId + '|played');
  if ((entry.type === 'deployLeader' || entry.type === 'deployLeaderPilot') && entry.cardId) hit(entry.cardId + '|deployed');
  if (entry.type === 'fizzle' && entry.cardId) fizzles[entry.cardId] = (fizzles[entry.cardId] || 0) + 1;
  return prevLog(state, entry);
};

// ---- 3. Play -----------------------------------------------------------------------
function randomGame(deck0, deck1, seed, cap) {
  let s = SB.newGame({ deck0, deck1, seed });
  const rand = SB.rng('cov|' + seed);
  let n = 0;
  while (!SB.isTerminal(s)) {
    if (++n > (cap || 4000)) throw new Error('no termination: ' + seed);
    const acts = SB.legalActions(s);
    if (acts.length === 0) throw new Error('dead state: ' + seed);
    s = SB.apply(s, acts[Math.floor(rand() * acts.length)]);
  }
  return s;
}
const decks = Object.keys(SB.decks).filter(d => !/^fixture/.test(d));
const t0 = Date.now();
let games = 0;
decks.forEach((d, di) => {
  if (ONLY && d !== ONLY) return;
  for (let i = 0; i < GAMES; i++) {
    const foe = decks[(di + 1 + i) % decks.length];
    if (foe === d) continue;
    if (i % 2) randomGame(foe, d, d + '|' + i); else randomGame(d, foe, d + '|' + i);
    games++;
  }
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

// ---- 4. Report ----------------------------------------------------------------------
const cards = {};
let totalUsages = 0, hitUsages = 0, playable = 0, playedCards = 0, withOps = 0, allOpsCards = 0;
const never = [];
const noDeck = Object.keys(expected).filter(id => !inDeck.has(id));
for (const cardId of Object.keys(expected)) {
  if (!inDeck.has(cardId)) continue;
  const want = expected[cardId];
  const missing = want.filter(u => !hits[cardId + '|' + u] && !hits[u]);
  const ops = want.filter(u => u !== 'played' && u !== 'deployed');
  const opsHit = ops.filter(u => hits[u]).length;
  totalUsages += want.length; hitUsages += want.length - missing.length;
  const play = want.find(u => u === 'played' || u === 'deployed');
  if (play) { playable++; if (hits[cardId + '|' + play]) playedCards++; }
  if (ops.length) { withOps++; if (opsHit === ops.length) allOpsCards++; }
  cards[cardId] = { usages: want.length, hit: want.length - missing.length, missing, fizzles: fizzles[cardId] || 0 };
  missing.forEach(u => never.push({ cardId, usage: u, played: !!(play && hits[cardId + '|' + play]) }));
}
// Cards that WERE played but whose ops never fired are the interesting suspects: the
// random player got the card onto the board and the ability still did nothing.
never.sort((a, b) => (b.played - a.played) || a.cardId.localeCompare(b.cardId));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ games, decksPlayed: ONLY ? 1 : decks.length, seconds: +secs,
  summary: { totalUsages, hitUsages, playable, playedCards, cardsWithOps: withOps, cardsAllOpsFired: allOpsCards,
    cardsInNoDeck: noDeck.length },
  never, cards, cardsInNoDeck: noDeck }, null, 1));

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : 'n/a';
console.log(`coverage: ${games} games over ${ONLY ? 1 : decks.length} decks in ${secs}s`);
console.log(`  cards in a registered deck : ${Object.keys(cards).length} (${noDeck.length} more are in no deck and are not counted)`);
console.log(`  cards played at least once : ${playedCards}/${playable} (${pct(playedCards, playable)})`);
console.log(`  op usages resolved         : ${hitUsages}/${totalUsages} (${pct(hitUsages, totalUsages)})`);
console.log(`  cards with every op fired  : ${allOpsCards}/${withOps} (${pct(allOpsCards, withOps)})`);
const suspects = never.filter(n => n.played);
console.log(`  never-fired usages         : ${never.length} (${suspects.length} on cards that WERE played)`);
const show = ALL ? never : never.slice(0, TOP);
show.forEach(n => console.log(`    ${n.played ? 'PLAYED ' : 'unseen '} ${n.cardId}  ${n.usage}`));
if (!ALL && never.length > show.length) console.log(`    ... ${never.length - show.length} more in ${OUT} (or --all)`);

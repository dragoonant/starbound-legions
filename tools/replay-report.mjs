// replay-report.mjs — re-run a bug report (js/bugreport.js) headlessly.
//
// A trace is seed + deck ids + the ordered actions of BOTH seats, so replaying it
// reproduces the match exactly, including the AI's moves (they are recorded, not
// re-chosen — the AI is free to change without invalidating old reports).
//
// The run reports three kinds of trouble, each of which is a bug on its own:
//   ILLEGAL   the UI offered an action the engine would not have
//   THREW     apply died on an action
//   DIVERGED  the same action produced different log entries than it did in the browser
//
// Usage:
//   node tools/replay-report.mjs <report.json>            notes, trouble, and context
//   node tools/replay-report.mjs <report.json> --verbose  the whole transcript
//   node tools/replay-report.mjs <report.json> --stop 42  stop after action 42
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const verbose = args.includes('--verbose');
const si = args.indexOf('--stop');
const stopAt = si >= 0 ? Number(args[si + 1]) : Infinity;
if (!file) { console.error('usage: node tools/replay-report.mjs <report.json> [--verbose] [--stop N]'); process.exit(2); }

// Same script list as the test runner, for the same reason: ONE list, no drift.
// The tests themselves are dropped; everything else is engine, data and log text.
const html = readFileSync(join(root, 'tests.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => m[1]).filter((s) => !s.startsWith('tests/'));
const window = { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false }) };
window.window = window;
const context = vm.createContext({ window, console, SB: undefined });
for (const src of srcs) vm.runInContext(readFileSync(join(root, src), 'utf8'), context, { filename: src });
const SB = window.SB;

const report = JSON.parse(readFileSync(file, 'utf8'));
if (report.format !== 'sb-bugreport/1') console.error(`! unknown format ${report.format}, trying anyway`);

const s = report.setup;
console.log(`report      ${report.when}  (${report.finishedAt || 'open'})`);
console.log(`setup       seed=${s.seed}  you=${s.deck0}  opponent=${s.deck1}  skill=${s.difficulty}  initiative=P${s.initiative}`);
if (report.env) console.log(`shown as    names=${report.env.namesMode} anim=${report.env.animMode}`);
console.log(`events      ${report.events.length}${report.truncated ? ' (TRUNCATED)' : ''}`);
console.log('');

let state = SB.newGame({ deck0: s.deck0, deck1: s.deck1, seed: s.seed });
const trouble = [];
// Every pre-action state, so an undo event can wind the replay back the same way the
// player did. Cheap: apply already clones, so these are states that exist anyway.
const rewind = [];
// The context window: the lines before a note or a failure are the ones worth reading,
// so ordinary lines are held back and only printed when something asks for them.
const held = [];
let applied = 0;
let echo = 0;           // lines still owed to whatever just flushed

function line(text) {
  if (verbose || echo > 0) { echo--; console.log(text); return; }
  held.push(text);
  if (held.length > 8) held.shift();
}
// Print the run-up, then keep printing for a while: what happens just AFTER a flag or
// a failure is as much of the story as what came before it.
function flush(after) {
  held.splice(0).forEach((t) => console.log(t));
  if (after !== false) echo = 14;
}

function describe(entry, st) {
  try { return SB.describeLog(entry, st) || `(no describer: ${entry.type})`; }
  catch (e) { return `(describer threw on ${entry.type}: ${e.message})`; }
}

function actionLabel(a) {
  const rest = Object.keys(a).filter((k) => k !== 'type' && k !== 'player')
    .map((k) => `${k}=${JSON.stringify(a[k])}`).join(' ');
  return `${a.type}${rest ? ' ' + rest : ''}`;
}

for (const ev of report.events) {
  if (ev.kind === 'note') {
    flush();
    console.log(`\n>>> FLAGGED at event ${ev.n} (round ${ev.at ? ev.at.round : '?'}): ${ev.text}\n`);
    continue;
  }
  if (ev.kind === 'error') {
    flush();
    console.log(`\n!!! ERROR (${ev.which}) at event ${ev.n}: ${ev.message}`);
    if (ev.stack) console.log(ev.stack.split('\n').map((l) => '    ' + l).join('\n'));
    console.log('');
    trouble.push(`event ${ev.n}: ${ev.which} error — ${ev.message}`);
    continue;
  }
  if (ev.kind === 'undo') {
    // Wind the replay back exactly as far as the player did, or the rest of the trace
    // is applied to a game that never existed.
    const steps = ev.steps == null ? 1 : ev.steps;
    if (steps > rewind.length) {
      flush();
      console.log(`!!! UNDO PAST THE START at event ${ev.n}: asked for ${steps}, have ${rewind.length}`);
      trouble.push(`event ${ev.n}: undo went back further than the trace goes`);
      break;
    }
    for (let i = 0; i < steps; i++) state = rewind.pop();
    applied -= steps;
    line(`--- undo ${steps} action(s), back to round ${state.round} ${state.phase} ---`);
    continue;
  }
  if (ev.kind !== 'action') continue;
  if (applied >= stopAt) break;

  const who = ev.source === 'ai' ? 'AI ' : 'YOU';
  if (ev.legal === false) {
    flush();
    console.log(`!!! ILLEGAL at event ${ev.n}: ${actionLabel(ev.action)} was not offered by the engine`);
    trouble.push(`event ${ev.n}: illegal action ${actionLabel(ev.action)}`);
  }
  line(`[${String(ev.n).padStart(4)}] r${ev.at.round} ${ev.at.phase.padEnd(7)} ${who} ${actionLabel(ev.action)}`);

  rewind.push(state);
  const before = state.log.length;
  let next;
  try {
    next = SB.apply(state, ev.action);
  } catch (e) {
    flush();
    console.log(`\n!!! THREW replaying event ${ev.n} (${actionLabel(ev.action)}): ${e.message}`);
    console.log(String(e.stack).split('\n').slice(0, 8).map((l) => '    ' + l).join('\n'));
    trouble.push(`event ${ev.n}: apply threw — ${e.message}`);
    break;
  }
  const produced = next.log.slice(before);
  produced.forEach((entry) => line(`         ${entry.via ? '  ' : ''}${describe(entry, next)}`));

  // Same seed, same actions: a different log means the replay is not the game the
  // player saw, and the report cannot be trusted until that is explained.
  const mine = produced.map((e) => e.type).join(',');
  const theirs = (ev.log || []).map((e) => e.type).join(',');
  if (mine !== theirs) {
    flush();
    console.log(`!!! DIVERGED at event ${ev.n}: browser logged [${theirs}], replay logged [${mine}]`);
    trouble.push(`event ${ev.n}: log diverged`);
  }
  state = next;
  applied++;
}

flush(false);           // the last few lines are the state the player is looking at
console.log('');
console.log(`replayed    ${applied} actions -> round ${state.round} ${state.phase}` +
  (state.winner != null ? `, winner P${state.winner}` : ''));
if (report.final) {
  const f = report.final;
  const same = f.at.round === state.round && f.at.phase === state.phase;
  console.log(`browser was round ${f.at.round} ${f.at.phase}` +
    (f.winner != null ? `, winner P${f.winner}` : '') + (same ? '   (match)' : '   <-- MISMATCH'));
  if (!same) trouble.push('final state does not match the browser');
}
console.log('');
if (trouble.length === 0) {
  console.log('No engine trouble found: the trace replays cleanly. Read the FLAGGED notes above.');
} else {
  console.log('Trouble:');
  trouble.forEach((t) => console.log('  - ' + t));
}
process.exit(trouble.length ? 1 : 0);

// bugreport.js — the black box recorder.
//
// The game is deterministic: seed + the two deck ids + the ordered list of actions
// reproduces a match exactly (js/util.js SB.rng, js/state.js SB.newGame). So the
// thing worth capturing is not a screenshot and not the rendered log — it is the
// TRACE: the setup, every action applied in order, the raw log entries each one
// produced, and any error thrown along the way. `tools/replay-report.mjs` re-runs a
// trace headlessly and lands on the exact state the player was looking at.
//
// UI-only file (index.html, never tests.html): it touches document, navigator and
// window. It reads state and never writes it — recording must not be able to change
// the game it is recording.
//
// It stores INTERNAL IDS ONLY. No card names, printed text or vocabulary words go
// into a trace, so a report is safe to paste anywhere (CLAUDE.md, NOTICE.md).
(function (SB) {
  'use strict';

  const MAX_EVENTS = 4000;      // a long match is ~500; the cap is against a runaway loop

  let trace = null;

  function now() { return Date.now(); }

  // A snapshot small enough to sit on every event and still answer "where were we?".
  function where(state) {
    if (!state) return null;
    const w = { round: state.round, phase: state.phase, active: state.active,
      initiative: state.initiative, queue: state.queue.length };
    if (state.queue.length) w.step = state.queue[state.queue.length - 1].step;
    return w;
  }

  // Counts, not contents: enough to spot "my hand grew by three" without turning the
  // trace into a full state dump on every line.
  function tally(state) {
    if (!state) return null;
    const seats = state.players.map(function (p) {
      return { hand: p.hand.length, deck: p.deck.length, discard: p.discard.length,
        resources: p.resources.length, baseDamage: p.base.damage,
        leader: p.leader.defeated ? 'defeated' : (p.leader.deployed ? 'deployed' : 'undeployed') };
    });
    return { seats: seats, ground: state.ground.length, space: state.space.length };
  }

  function push(ev) {
    if (!trace) return null;
    if (trace.events.length >= MAX_EVENTS) {
      if (!trace.truncated) { trace.truncated = true; trace.events.push({ kind: 'truncated' }); }
      return null;
    }
    ev.n = trace.events.length;
    ev.t = now() - trace.startedAt;
    trace.events.push(ev);
    return ev;
  }

  const API = {

    // ---- lifecycle ---------------------------------------------------------

    // Called by UI.start. A new match is a new trace: the old one is gone unless the
    // player already exported it, which is the same bargain as undo history.
    begin: function (opts, state) {
      trace = {
        format: 'sb-bugreport/1',
        startedAt: now(),
        when: new Date().toISOString(),
        setup: {
          seed: state.seed,
          deck0: opts.deck0, deck1: opts.deck1,
          difficulty: opts.difficulty || 'mid',
          humanSeat: 0,
          initiative: state.initiative,
        },
        env: {
          page: (typeof location !== 'undefined' && location.pathname) || null,
          ua: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
          viewport: (typeof window !== 'undefined') ? [window.innerWidth, window.innerHeight] : null,
          // How the player was reading the game. Affects only what they SAW, never the
          // rules — but "the log said the wrong thing" depends on which name set is on.
          namesMode: SB.names && SB.names.mode ? SB.names.mode() : null,
          animMode: SB.anim && SB.anim.mode ? SB.anim.mode() : null,
        },
        events: [],
        truncated: false,
      };
      return trace;
    },

    active: function () { return !!trace; },
    count: function () { return trace ? trace.events.length : 0; },

    // ---- recording ---------------------------------------------------------

    // One applied action. `source` is who chose it: the player or the AI. The log
    // slice is the payoff — the structured entries the action produced, in order,
    // exactly as the engine wrote them.
    action: function (source, action, prev, next) {
      if (!trace) return;
      push({ kind: 'action', source: source, action: action, at: where(prev),
        legal: API.wasLegal(prev, action),
        log: next.log.slice(prev.log.length), after: tally(next) });
      if (SB.isTerminal(next)) push({ kind: 'end', winner: next.winner, at: where(next) });
    },

    // Whether the engine would have offered that action from that state. Recorded
    // rather than asserted: a trace whose action was never legal IS the bug report.
    wasLegal: function (state, action) {
      try {
        const key = JSON.stringify(action);
        return SB.legalActions(state).some(function (a) { return JSON.stringify(a) === key; });
      } catch (e) { return null; }
    },

    // Undo rewinds the game but NOT the trace: what the player did and then took back
    // is often the very thing that went wrong. The marker keeps the replay honest.
    // `steps` is how many recorded actions the game just wound back, which is what lets
    // a replay follow along instead of drifting off into a game nobody played.
    undo: function (fromState, toState, steps) {
      push({ kind: 'undo', steps: steps, from: where(fromState), to: where(toState) });
    },

    // The player pressing "Flag a bug" — a pin at the exact action index, which is the
    // one thing a trace cannot work out for itself.
    note: function (text) {
      push({ kind: 'note', text: String(text == null ? '' : text).slice(0, 2000),
        at: SB.ui && SB.ui.state ? where(SB.ui.state) : null });
    },

    // A thrown error, from apply or from a render. Recorded in place, so the trace
    // says which action was being processed when the game fell over.
    error: function (which, err, extra) {
      const ev = { kind: 'error', which: which,
        message: String((err && err.message) || err),
        stack: err && err.stack ? String(err.stack).split('\n').slice(0, 12).join('\n') : null };
      if (extra) ev.extra = extra;
      push(ev);
    },

    // ---- export ------------------------------------------------------------

    toJSON: function () {
      if (!trace) return null;
      const out = JSON.parse(JSON.stringify(trace));
      delete out.startedAt;
      out.finishedAt = new Date().toISOString();
      // The state the player is staring at while they file the report — the thing a
      // replay is checked against.
      if (SB.ui && SB.ui.state) {
        out.final = { at: where(SB.ui.state), tally: tally(SB.ui.state),
          winner: SB.ui.state.winner, logLength: SB.ui.state.log.length };
      }
      return out;
    },

    text: function () { return JSON.stringify(API.toJSON(), null, 1); },

    filename: function () {
      const stamp = trace ? trace.when.replace(/[:.]/g, '-').slice(0, 19) : 'none';
      return 'sb-bug-' + (trace ? trace.setup.seed : 'x') + '-' + stamp + '.json';
    },

    // Download AND clipboard: the file is the thing to attach, the clipboard is for
    // pasting straight into a chat. Whichever the player reaches for, they have it.
    download: function () {
      if (!trace) return false;
      const text = API.text();
      try {
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = API.filename();
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      } catch (e) { /* the clipboard copy below is the fallback path */ }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
      } catch (e) {}
      return true;
    },
  };

  // Uncaught errors anywhere in the app land in the trace with their position in the
  // game, which is the context a console screenshot always loses.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('error', function (e) {
      API.error('uncaught', e.error || { message: e.message },
        { file: e.filename, line: e.lineno, col: e.colno });
    });
    window.addEventListener('unhandledrejection', function (e) {
      API.error('rejection', e.reason || { message: 'unhandled rejection' });
    });
  }

  SB.bugreport = API;
})(window.SB = window.SB || {});

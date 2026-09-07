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

    // Where a report should end up: traces/, next to the code that has to fix it.
    // The dev server (tools/serve.mjs) takes it over POST /__trace/<name> and writes it
    // there. Played from file:// or from the deployed site there is no server to take
    // it, so fall back to the download-and-clipboard path below.
    //
    // done(how, name) gets 'server' | 'download' | 'failed'.
    save: function (done) {
      if (!trace) { if (done) done('failed', null); return false; }
      const name = API.filename();
      const finish = function (how) { if (done) done(how, name); };
      if (typeof fetch !== 'function' || typeof location === 'undefined' || location.protocol === 'file:') {
        finish(API.download() ? 'download' : 'failed');
        return true;
      }
      fetch('/__trace/' + encodeURIComponent(name), { method: 'POST', body: API.text() })
        .then(function (res) { finish(res.ok ? 'server' : (API.download() ? 'download' : 'failed')); })
        .catch(function () { finish(API.download() ? 'download' : 'failed'); });
      return true;
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

  // ---- the dialog ----------------------------------------------------------
  // window.prompt() was the placeholder: one line, no room to say what you expected,
  // and on the browsers that suppress it the button looks dead. This is the same ask
  // in the game's own chrome, and it can do the other half of the job — pin the moment
  // AND put the trace in traces/ — which is what makes pressing it visibly worth it.

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  API.openDialog = function () {
    if (document.getElementById('bug-overlay')) return;
    const B = SB.names.bug;
    const overlay = el('div'); overlay.id = 'bug-overlay';
    const box = el('div'); box.id = 'bug-box';

    box.appendChild(el('h2', 'bug-title', B.title));
    box.appendChild(el('p', 'bug-blurb', B.blurb));

    const ta = document.createElement('textarea');
    ta.id = 'bug-note';
    ta.rows = 5;
    ta.placeholder = B.placeholder;
    box.appendChild(ta);

    // What is about to be written down, said plainly: nobody should have to guess what
    // a bug report is sending on their behalf.
    const s = SB.ui && SB.ui.state;
    if (s) {
      box.appendChild(el('div', 'bug-what', B.attaches
        .replace('{round}', String(s.round)).replace('{actions}', String(API.count()))));
    }

    const status = el('div', 'bug-status');
    const btns = el('div', 'bug-buttons');

    const send = el('button', 'action-btn', B.send);
    send.onclick = function () {
      if (!trace) { status.textContent = B.noGame; return; }
      API.note(ta.value);
      send.disabled = true;
      status.textContent = B.sending;
      API.save(function (how, name) {
        if (how === 'failed') { send.disabled = false; status.textContent = B.failed; return; }
        status.textContent = (how === 'server' ? B.savedServer : B.savedDownload).replace('{file}', name);
        cancel.textContent = B.close;
      });
    };

    // Pinning without saving: the moment is what only the player can supply, and a
    // match often produces three of them before anyone wants a file.
    const pin = el('button', 'action-btn', B.pinOnly);
    pin.onclick = function () {
      if (!trace) { status.textContent = B.noGame; return; }
      API.note(ta.value);
      status.textContent = B.pinned;
      ta.value = '';
    };

    const cancel = el('button', 'action-btn', B.cancel);
    cancel.onclick = API.closeDialog;

    btns.appendChild(send);
    btns.appendChild(pin);
    btns.appendChild(cancel);
    box.appendChild(btns);
    box.appendChild(status);

    overlay.appendChild(box);
    overlay.onclick = function (e) { if (e.target === overlay) API.closeDialog(); };
    document.body.appendChild(overlay);
    document.addEventListener('keydown', escClose);
    ta.focus();
  };

  API.closeDialog = function () {
    const o = document.getElementById('bug-overlay');
    if (o) o.remove();
    document.removeEventListener('keydown', escClose);
  };

  function escClose(e) { if (e.key === 'Escape') API.closeDialog(); }

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

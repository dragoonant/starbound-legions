// test-voice.js — guards for the played-unit one-liners (js/voice.js,
// data/voicelines.js). The bubble is cosmetic, so these tests protect the two
// things that would actually rot: COVERAGE (a unit that can be played must have
// something to say) and DEAD WEIGHT (a pool no deck can reach is wasted writing,
// which is the whole reason the file is pools and not per-card lines).
(function (SB) {
  'use strict';
  const T = SB.test;

  // Every unit and leader that appears in a real deck — the only cards that can
  // ever reach the table, and so the only ones worth writing for.
  function playableUnits() {
    const ids = {};
    Object.keys(SB.decks).forEach(function (d) {
      const deck = SB.decks[d];
      [deck.leader, deck.base].forEach(function (x) { if (x) ids[x] = 1; });
      (deck.cards || []).forEach(function (e) { ids[typeof e === 'string' ? e : (e.id || e.cardId)] = 1; });
      if (deck.list) Object.keys(deck.list).forEach(function (k) { ids[k] = 1; });
    });
    return Object.keys(ids).filter(function (id) {
      const c = SB.cards[id];
      return c && (c.type === 'unit' || c.type === 'leader');
    });
  }

  T.add('voice: every playable unit and leader has a pool', function () {
    const missing = playableUnits().filter(function (id) { return !SB.voice.poolFor(id); });
    if (missing.length) throw new Error(missing.length + ' playable units with no voice pool: ' + missing.slice(0, 10).join(', '));
  });

  T.add('voice: nothing but units and leaders speaks', function () {
    const loud = Object.keys(SB.cards).filter(function (id) {
      const c = SB.cards[id];
      return c.type !== 'unit' && c.type !== 'leader' && SB.voice.poolFor(id);
    });
    if (loud.length) throw new Error('non-unit cards with a pool: ' + loud.slice(0, 5).join(', '));
  });

  T.add('voice: no pool is unreachable', function () {
    // The point of the archetype design is that a small table covers a big pool.
    // A champion or trait entry no deck can reach is writing nobody will ever see,
    // so it fails here rather than sitting in the file forever.
    const champs = {}, traits = {};
    playableUnits().forEach(function (id) {
      const p = SB.voice.poolFor(id);
      if (p.key.indexOf('champion:') === 0) champs[p.key.slice(9)] = 1;
      (p.traits || []).forEach(function (t) { traits[t] = 1; });
    });
    const dead = [];
    Object.keys(SB.voiceLines.champions).forEach(function (n) { if (!champs[n]) dead.push('champion ' + n); });
    Object.keys(SB.voiceLines.traits).forEach(function (t) { if (!traits[t]) dead.push('trait ' + t + ' (' + (SB.names.traits[t] || '?') + ')'); });
    if (dead.length) throw new Error(dead.length + ' unreachable voice pools:\n  ' + dead.join('\n  '));
  });

  T.add('voice: every line is one clean short breath', function () {
    const problems = [];
    function check(where, lines) {
      if (!lines.length) { problems.push(where + ': empty pool'); return; }
      lines.forEach(function (entry) {
        let line;
        try { line = SB.voice.render(entry); } catch (e) { problems.push(where + ': threw ' + e.message); return; }
        if (typeof line !== 'string' || !line.trim()) problems.push(where + ': empty line');
        else if (line.length > SB.voice.MAX_LEN) problems.push(where + ': too long (' + line.length + ') "' + line + '"');
        if (/\s\s/.test(line)) problems.push(where + ': doubled space in "' + line + '"');
        if (/\bundefined\b|\bnull\b|\bNaN\b/.test(line)) problems.push(where + ': hole in "' + line + '"');
      });
    }
    Object.keys(SB.voiceLines.champions).forEach(function (n) { check('champion ' + n, SB.voiceLines.champions[n]); });
    Object.keys(SB.voiceLines.traits).forEach(function (t) { check('trait ' + t, SB.voiceLines.traits[t]); });
    Object.keys(SB.voiceLines.aspects).forEach(function (a) { check('aspect ' + a, SB.voiceLines.aspects[a]); });
    check('generic', SB.voiceLines.generic);
    if (problems.length) throw new Error(problems.length + ' voice-line problems:\n  ' + problems.join('\n  '));
  });

  T.add('voice: no line stores a vocabulary word', function () {
    // CLAUDE.md: generated prose never STORES the words the theme renames — it
    // reads SB.names.terms when it renders. A line that needs one is a function.
    // Catching it here is what keeps the bubble reading in the same vocabulary as
    // the rest of the screen when the printed card names are switched on.
    const banned = /\b(the )?(Current|Force)\b/i;
    const bad = [];
    function scan(where, lines) {
      lines.forEach(function (entry) {
        if (typeof entry === 'string' && banned.test(entry)) bad.push(where + ': "' + entry + '"');
      });
    }
    Object.keys(SB.voiceLines.champions).forEach(function (n) { scan('champion ' + n, SB.voiceLines.champions[n]); });
    Object.keys(SB.voiceLines.traits).forEach(function (t) { scan('trait ' + t, SB.voiceLines.traits[t]); });
    Object.keys(SB.voiceLines.aspects).forEach(function (a) { scan('aspect ' + a, SB.voiceLines.aspects[a]); });
    if (bad.length) throw new Error('vocabulary stored in a voice line (make it a function):\n  ' + bad.join('\n  '));
  });

  T.add('voice: a champion outranks its traits', function () {
    // The ordering that makes one entry cover seven cards. Kael Verin is a Warden
    // and Attuned; he must still speak as himself.
    const kael = Object.keys(SB.cards).filter(function (id) {
      const n = SB.names.themeCard(id);
      return n && n.name === 'Kael Verin';
    });
    if (!kael.length) throw new Error('no Kael Verin card to check');
    kael.forEach(function (id) {
      const key = SB.voice.poolFor(id).key;
      if (key !== 'champion:Kael Verin') throw new Error(id + ' spoke as ' + key);
    });
  });

  T.add('voice: the same play always says the same thing', function () {
    // The salt is the log index, so an undo-and-redo or a replayed trace repeats
    // the match exactly instead of re-rolling a different line.
    const id = playableUnits()[0];
    for (let salt = 0; salt < 50; salt++) {
      const a = SB.voice.lineFor(id, salt), b = SB.voice.lineFor(id, salt);
      if (a !== b) throw new Error('line for ' + id + ' salt ' + salt + ' is not stable');
    }
  });

  T.add('voice: speaks on roughly half of plays', function () {
    const ids = playableUnits();
    let said = 0, total = 0;
    ids.forEach(function (id) {
      for (let salt = 0; salt < 8; salt++) { total++; if (SB.voice.lineFor(id, salt)) said++; }
    });
    const rate = said / total;
    if (Math.abs(rate - SB.voice.RATE) > 0.05) {
      throw new Error('speak rate ' + rate.toFixed(3) + ' is not near ' + SB.voice.RATE);
    }
  });

  T.add('voice: a talkative card does not repeat itself every time', function () {
    // A pool with four lines should actually use them across a match's worth of
    // plays — a hash that collapsed to one index would pass every test above.
    const id = Object.keys(SB.cards).filter(function (i) {
      const p = SB.voice.poolFor(i);
      return p && p.lines.length >= 4;
    })[0];
    const seen = {};
    for (let salt = 0; salt < 200; salt++) {
      const l = SB.voice.lineFor(id, salt);
      if (l) seen[l] = 1;
    }
    if (Object.keys(seen).length < 3) throw new Error(id + ' only ever says ' + Object.keys(seen).join(' / '));
  });
})(window.SB = window.SB || {});

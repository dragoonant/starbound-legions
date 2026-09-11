// voice.js — the chat bubble a unit throws out as it lands on the table.
//
// PURELY COSMETIC. It reads a card id and the log index the play came from, and
// returns a string; it never touches state, never writes a log entry, and the
// engine cannot see it. Two halves, the same split the rest of the UI uses:
//
//   lineFor(cardId, salt) — PURE. Deterministic, headless, tested.
//   speak(cardId, opts)   — DOM. Draws the bubble beside the played card.
//
// WHY IT IS CHEAP. Lines are not authored per card — 1600 units would be a book.
// data/voicelines.js holds ~50 POOLS (recurring champions, then archetypes by
// trait, then an aspect backstop) and this file picks the most specific pool the
// card qualifies for. One Warden pool speaks for two hundred Wardens, and a new
// set needs no new lines at all: its cards inherit the archetype they already
// declare in their trait list.
//
// WHEN IT FIRES. About half of plays (RATE), decided by a hash of the card id and
// the log index — so it is deterministic: the same match replayed, or undone and
// redone, speaks the same lines in the same places instead of re-rolling. Only
// units and leaders speak; events, upgrades and bases are silent.
(function (SB) {
  'use strict';

  const RATE = 0.5;          // share of plays that say something
  const MAX_LEN = 56;        // a bubble is one breath; validate.js enforces it

  // Two ordered trait lists, because a unit has two things worth saying: WHAT IT
  // IS and WHO IT FIGHTS FOR. A Concord trooper can plausibly say "Copy that —
  // advancing" or "For the Concord!", and picking only one list would throw the
  // other away: ordering role above faction silenced every faction pool (a
  // Concord Trooper is always a Trooper first), and ordering faction above role
  // would turn every pilot and droid into a flag. So a card that carries both
  // draws from the two pools COMBINED, and the hash picks a line across them.
  //
  // ROLE, most specific first: the first entry a card carries wins, so a Warden
  // Trooper speaks as a Warden and a Hegemony Fighter as a pilot. Vehicle
  // sub-types sit above the foot-soldier roles. There is deliberately no bare
  // Vehicle pool: every ship in every deck carries a sub-type, and a pool nothing
  // can reach is writing nobody reads (tests/test-voice.js fails on one).
  const ROLE = [
    'tr54', 'tr56', 'tr15', 'tr09', 'tr19', 'tr44', 'tr26', 'tr49', 'tr28',
    'tr36', 'tr11', 'tr50', 'tr35', 'tr21', 'tr30', 'tr03', 'tr25', 'tr05', 'tr07',
    'tr08', 'tr12',
    'tr47', 'tr40', 'tr37', 'tr04', 'tr10', 'tr41',
    'tr29', 'tr43', 'tr13',
  ];
  // FACTION, likewise most specific first: a New Concord unit is not a Concord one.
  const FACTION = ['tr45', 'tr34', 'tr27', 'tr33', 'tr32', 'tr17'];

  function firstMatch(list, traits, pools) {
    for (let i = 0; i < list.length; i++) {
      if (traits.indexOf(list[i]) >= 0 && pools[list[i]]) return list[i];
    }
    return null;
  }

  // FNV-1a. Small, stable across runs, and good enough to scatter a pool index.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  // The champion pools are keyed by the THEME name, which stays reachable even
  // while the printed-name pack is displaying something else — a unit speaks in
  // the theme's voice either way, because these lines were written for it.
  function themeName(cardId) {
    const n = (SB.names.themeCard && SB.names.themeCard(cardId)) || SB.names.cards[cardId];
    return n ? n.name : null;
  }

  // The pool a card draws from, and the key that chose it (tests read the key).
  SB.voice = {};
  SB.voice.poolFor = function (cardId) {
    const card = SB.cards[cardId];
    const V = SB.voiceLines;
    if (!card || !V) return null;
    if (card.type !== 'unit' && card.type !== 'leader') return null;

    const name = themeName(cardId);
    if (name && V.champions[name]) return { key: 'champion:' + name, traits: [], lines: V.champions[name] };

    const traits = card.traits || [];
    const role = firstMatch(ROLE, traits, V.traits);
    const faction = firstMatch(FACTION, traits, V.traits);
    if (role || faction) {
      const keys = [role, faction].filter(Boolean);
      return {
        key: 'trait:' + keys.join('+'),
        traits: keys,
        lines: keys.reduce(function (all, t) { return all.concat(V.traits[t]); }, []),
      };
    }
    const aspects = card.aspects || [];
    for (let i = 0; i < aspects.length; i++) {
      if (V.aspects[aspects[i]]) return { key: 'aspect:' + aspects[i], traits: [], lines: V.aspects[aspects[i]] };
    }
    return { key: 'generic', traits: [], lines: V.generic };
  };

  // salt distinguishes one play of a card from the next — the UI passes the log
  // index, so the same card says different things across a match but the SAME
  // thing when that match is replayed.
  SB.voice.lineFor = function (cardId, salt) {
    const pool = SB.voice.poolFor(cardId);
    if (!pool) return null;
    const h = hash(cardId + '#' + (salt == null ? 0 : salt));
    if ((h % 1000) / 1000 >= RATE) return null;          // stayed quiet this time
    return SB.voice.render(pool.lines[(h >>> 10) % pool.lines.length]);
  };

  // A pool entry is a string, or a function when the line names game vocabulary
  // (the power the Attuned draw on): those build from SB.names.terms HERE, at
  // render time, so the bubble reads in the same words as the rest of the screen
  // and no vocabulary word is ever stored (CLAUDE.md).
  SB.voice.render = function (entry) {
    return (typeof entry === 'function') ? entry() : entry;
  };

  SB.voice.RATE = RATE;
  SB.voice.MAX_LEN = MAX_LEN;

  // ---- the bubble (DOM) ----------------------------------------------------
  // Anchored to the spotlight card when there is one (js/preview.js puts the
  // played card in the middle of the screen for a beat, which is exactly the
  // moment the unit should speak), otherwise to the card's node on the board.
  // Skipped entirely while animations are off — it is a flourish, not
  // information, and everything it conveys is already on the card.
  const SHOW_MS = 1700, FADE_MS = 260;

  SB.voice.speak = function (cardId, opts) {
    if (typeof document === 'undefined') return null;
    if (SB.anim && SB.anim.mode && SB.anim.mode() === 'off') return null;
    const o = opts || {};
    const line = (o.line !== undefined) ? o.line : SB.voice.lineFor(cardId, o.salt);
    if (!line) return null;

    const anchor = o.anchor || document.getElementById('spotlight');
    if (!anchor || !anchor.getBoundingClientRect) return null;

    const old = document.getElementById('voice-bubble');
    if (old) old.remove();

    const box = document.createElement('div');
    box.id = 'voice-bubble';
    box.className = 'voice-bubble';
    box.setAttribute('role', 'status');
    box.textContent = line;
    document.body.appendChild(box);

    // Placed after insertion so the bubble's own measured size can keep it on
    // screen: above the card by default, below it when there is no room up top.
    const r = anchor.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    let left = r.left + r.width * 0.72;
    let top = r.top - b.height - 14;
    let below = false;
    if (top < 8) { top = r.bottom + 14; below = true; }
    left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
    box.classList.add(below ? 'is-below' : 'is-above');
    box.style.left = left + 'px';
    box.style.top = top + 'px';

    void box.getBoundingClientRect();          // flush the start state (§7C)
    box.classList.add('is-in');
    const hold = setTimeout(function () {
      box.classList.remove('is-in');
      setTimeout(function () { box.remove(); }, FADE_MS);
    }, SHOW_MS);
    box.onclick = function () { clearTimeout(hold); box.remove(); };
    return box;
  };
})(window.SB = window.SB || {});

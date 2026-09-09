// rules.js — derived-value helpers shared by engine, AI, and UI.
// Depends on: util.js, card data (SB.cards). No state mutation anywhere in this file.
(function (SB) {
  'use strict';

  SB.card = function (cardId) {
    const c = SB.cards[cardId];
    SB.assert(c, 'unknown card ' + cardId);
    return c;
  };

  // The card definition governing a unit in an arena. Deployed leaders use the
  // deployedSide block; everything else uses the card root.
  SB.unitDef = function (unit) {
    // A clone (unit.copyOf) plays as the copied card's definition.
    const c = SB.card(unit.copyOf || unit.cardId);
    return c.type === 'leader' ? c.deployedSide : c;
  };

  function upgradeDefs(unit) {
    return unit.upgrades.map(function (inst) { return SB.card(inst.cardId); });
  }

  // All traits on a unit: its def, its card root, plus traits granted by upgrades.
  SB.unitTraits = function (state, unit) {
    let ts = (SB.unitDef(unit).traits || []).concat(SB.card(unit.cardId).traits || []);
    unit.upgrades.forEach(function (inst) {
      ts = ts.concat(SB.card(inst.cardId).grantTraits || []);
    });
    return ts;
  };

  // Is this unit's readying blocked by an enemy jailer in play?
  SB.isJailed = function (state, unit) {
    return SB.allUnits(state).some(function (j) { return j.jails === unit.uid; });
  };

  SB.unitKeywords = function (state, unit) {
    if (unit.keywordsSuppressed || unit.keywordsSuppressedForAttack) return [];
    // Keyword instances from the unit itself plus its upgrades. Duplicate keywords
    // stack for numeric ones (raid, restore) and are redundant for boolean ones.
    let kws = (SB.unitDef(unit).keywords || []).slice();
    upgradeDefs(unit).forEach(function (u) {
      // Anything aboard a ship grants from its pilot box, not from the card's root —
      // the same rule SB.upgradeStats uses for the numbers.
      const from = u.pilotSide || u;
      kws = kws.concat(from.grantKeywords || []);
    });
    return kws;
  };

  SB.hasKeyword = function (state, unit, k) {
    return SB.unitKeywords(state, unit).some(function (kw) { return kw.k === k; });
  };

  SB.keywordTotal = function (state, unit, k) {
    return SB.unitKeywords(state, unit).reduce(function (sum, kw) {
      return sum + (kw.k === k ? (kw.n || 0) : 0);
    }, 0);
  };

  // An upgrade's stat contribution. Anything aboard a ship contributes its PILOT box,
  // which is printed with its own smaller numbers: a leader aboard a ship was handing
  // over the body of a leader standing on the ground, and a pilot UNIT was handing over
  // its own unit body, several power and HP too many in both cases.
  SB.upgradeStats = function (card) {
    const side = card.pilotSide || (card.type === 'leader' ? card.deployedSide : null);
    if (side) return { power: side.power || 0, hp: side.hp || 0 };
    return { power: card.power || 0, hp: card.hp || 0 };
  };
  const upgradeStats = SB.upgradeStats;

  SB.unitPower = function (state, unit) {
    const def = SB.unitDef(unit);
    let p = def.power + unit.temp.power + unit.experience + (unit.advantage || 0);
    upgradeDefs(unit).forEach(function (u) { p += upgradeStats(u).power; });
    if (SB.hasKeyword(state, unit, 'grit')) p += unit.damage;
    return Math.max(0, p);
  };

  SB.unitMaxHp = function (state, unit) {
    const def = SB.unitDef(unit);
    let h = def.hp + unit.temp.hp + unit.experience;
    upgradeDefs(unit).forEach(function (u) { h += upgradeStats(u).hp; });
    return h;
  };

  // Pilot capacity: normally 1 pilot; the extraPilotSlot static allows 2.
  SB.pilotCount = function (state, unit) {
    return unit.upgrades.filter(function (inst) {
      const c = SB.card(inst.cardId);
      return c.type === 'leader' || (c.traits || []).indexOf('tr30') >= 0 ||
        (c.grantTraits || []).indexOf('tr30') >= 0;
    }).length;
  };
  // "Has a pilot" for attach-gating: true when at capacity.
  SB.hasPilot = function (state, unit) {
    const cap = (SB.unitDef(unit).staticFlags || []).indexOf('extraPilotSlot') >= 0 ? 2 : 1;
    return SB.pilotCount(state, unit) >= cap;
  };

  SB.unitRemainingHp = function (state, unit) {
    return SB.unitMaxHp(state, unit) - unit.damage;
  };

  // Aspect icons available to a player: leader icons + base icon(s).
  SB.playerAspects = function (state, playerIdx) {
    const p = state.players[playerIdx];
    return (SB.card(p.leader.cardId).aspects || [])
      .concat(SB.card(p.base.cardId).aspects || []);
  };

  // Cost after aspect penalty: +2 per aspect icon on the card not matched by an
  // available icon (icons are consumed per copy: a double-aggression card needs
  // two aggression icons to avoid penalty).
  SB.cardCost = function (state, playerIdx, cardId) {
    const card = SB.card(cardId);
    const avail = SB.playerAspects(state, playerIdx).slice();
    let penalty = 0;
    (card.aspects || []).forEach(function (a) {
      const i = avail.indexOf(a);
      if (i >= 0) avail.splice(i, 1); else penalty += 2;
    });
    let cost = card.cost + penalty;
    // Conditional printed cost modifier (e.g. "costs 1 less while you control ...").
    if (card.costMod && SB.checkCondition &&
        SB.checkCondition(state, playerIdx, card.costMod, {})) {
      cost += card.costMod.delta;
    }
    return Math.max(0, cost);
  };

  // Smuggle cost: printed smuggle cost + 2 per smuggle aspect icon not covered.
  SB.smuggleCost = function (state, playerIdx, card, sm) {
    const avail = SB.playerAspects(state, playerIdx).slice();
    let penalty = 0;
    (sm.aspects || []).forEach(function (a) {
      const i = avail.indexOf(a);
      if (i >= 0) avail.splice(i, 1); else penalty += 2;
    });
    return sm.cost + penalty;
  };

  // Is money the only thing between the player and this card? True when the card's
  // adjusted cost exceeds their ready resources — and nothing else. A card held back
  // by a rule (a unique already in play, an upgrade with nothing to attach to) is not
  // "unaffordable", so the UI must confirm the engine offers no play for it before
  // trusting this; and a discount route the engine does offer (exploit, smuggle) makes
  // the play legal, which is what clears the mark there.
  SB.cantAfford = function (state, playerIdx, cardId) {
    return SB.cardCost(state, playerIdx, cardId) > SB.readyResources(state, playerIdx);
  };

  SB.readyResources = function (state, playerIdx) {
    const p = state.players[playerIdx];
    return p.resources.filter(function (r2) { return !r2.exhausted; }).length + (p.credits || 0);
  };

  SB.allUnits = function (state, playerIdx) {
    const all = state.ground.concat(state.space);
    return playerIdx == null ? all : all.filter(function (u) { return u.owner === playerIdx; });
  };

  SB.arenaOf = function (state, unit) {
    return state.ground.indexOf(unit) >= 0 ? 'ground' : 'space';
  };

  SB.findUnit = function (state, uid) {
    return SB.allUnits(state).find(function (u) { return u.uid === uid; }) || null;
  };
})(window.SB = window.SB || {});

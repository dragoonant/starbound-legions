// validate.js — load-time content validation. Call SB.validateContent() after all
// data files load (index.html and tests.html both do). Throw early: a typo caught
// here would otherwise surface as a confusing engine error many turns later.
(function (SB) {
  'use strict';

  const CARD_TYPES = ['unit', 'event', 'upgrade', 'leader', 'base'];
  const ARENAS = ['ground', 'space'];
  const TRIGGERS = ['onPlay', 'onAttack', 'whenDefeated', 'onDeploy', 'onRegroup', 'action',
    'constant', 'onAttackEnds', 'whenAttacked', 'onCardPlayed', 'onUnitPlayed',
    'combatConstant', 'onDefeatUnit', 'bounty', 'onSmuggle', 'onUpgradePlayed',
    'onUpgradeAttachedSelf',
    'whenCombatDamaged', 'combatAura', 'onOpponentDraw', 'whenHealed',
    'onIndirectUnitDamage', 'onDeployPilot', 'onPlayAsPilot', 'onNonCombatDamage',
    'onForceUnitAttack', 'onRevealOrDiscard', 'onFriendlyAttack',
    'onFriendlyDefeated', 'defenderAura', 'onFriendlyAttackEnds', 'onReadyTax',
    // competitive expansion (js/ops2.js)
    'onTakeInitiative', 'onWhenDefeatedUsed', 'onFriendlyDamagedSurvives', 'onEnemyUnitDefeated',
    'onFriendlyUpgradeDefeated', 'onFriendlyDealsDamageToEnemyUnit', 'onOpponentPlaysCard',
    'onOwnBaseCombatDamaged', 'onUseForce',
    // cluster-c3 expansion
    'onOwnDraw', 'onDeckDiscard', 'onBaseDamaged', 'onPilotAttached',
    // leader competitive-expansion pass
    'onActionPhaseStart'];
  const ASPECTS = ['command', 'aggression', 'cunning', 'vigilance', 'heroism', 'villainy'];

  function fail(id, msg) { throw new Error('content error [' + id + ']: ' + msg); }

  function checkAbilities(id, def) {
    (def.keywords || []).forEach(function (kw) {
      if (!SB.names.keywords[kw.k]) fail(id, 'unknown keyword ' + kw.k);
    });
    (def.grantKeywords || []).forEach(function (kw) {
      if (!SB.names.keywords[kw.k]) fail(id, 'unknown granted keyword ' + kw.k);
    });
    (def.abilities || []).forEach(function (ab) {
      if (TRIGGERS.indexOf(ab.trigger) < 0) fail(id, 'unknown trigger ' + ab.trigger);
      if (ab.trigger === 'onReadyTax') return; // {amount} shape, no effects list
      if (ab.trigger === 'constant' || ab.trigger === 'combatConstant' ||
          ab.trigger === 'combatAura' || ab.trigger === 'defenderAura') {
        if (!ab.grant) fail(id, 'constant ability without grant');
        (ab.grant.keywords || []).forEach(function (kw) {
          if (!SB.names.keywords[kw.k]) fail(id, 'unknown granted keyword ' + kw.k);
        });
        return;
      }
      if (!Array.isArray(ab.effects) || ab.effects.length === 0) fail(id, 'ability without effects');
      function checkOps(ops) {
        ops.forEach(function (op) {
          if (!SB.ops[op.op]) fail(id, 'unknown op ' + op.op);
          if (op.then) checkOps(op.then);
          if (op.else) checkOps(op.else);
        });
      }
      checkOps(ab.effects);
    });
  }

  SB.validateContent = function () {
    Object.keys(SB.cards).forEach(function (id) {
      const c = SB.cards[id];
      if (c.id !== id) fail(id, 'id mismatch: ' + c.id);
      if (CARD_TYPES.indexOf(c.type) < 0) fail(id, 'unknown type ' + c.type);
      (c.aspects || []).forEach(function (a) {
        if (ASPECTS.indexOf(a) < 0) fail(id, 'unknown aspect ' + a);
      });
      if (c.type === 'unit') {
        if (ARENAS.indexOf(c.arena) < 0) fail(id, 'unit needs arena');
        if (typeof c.cost !== 'number' || typeof c.power !== 'number' || typeof c.hp !== 'number')
          fail(id, 'unit needs cost/power/hp');
        checkAbilities(id, c);
      } else if (c.type === 'leader') {
        if (!c.leaderSide || !c.deployedSide) fail(id, 'leader needs leaderSide + deployedSide');
        if (typeof c.deployCost !== 'number') fail(id, 'leader needs deployCost');
        if (typeof c.deployedSide.power !== 'number' || typeof c.deployedSide.hp !== 'number')
          fail(id, 'deployedSide needs power/hp');
        checkAbilities(id, c.leaderSide);
        checkAbilities(id, c.deployedSide);
      } else if (c.type === 'base') {
        if (typeof c.hp !== 'number') fail(id, 'base needs hp');
        checkAbilities(id, c);
      } else {
        if (typeof c.cost !== 'number') fail(id, c.type + ' needs cost');
        checkAbilities(id, c);
      }
    });

    // The uniqueness rule (js/rules.js SB.uniqueDuplicates) keys on card identity,
    // while the printed rule keys on name-plus-subtitle. The two stay equivalent only
    // while no two identities share a name, so a collision is a content error, not a
    // naming nit: it would let a player control two copies of what the rules call one
    // card. Checked against the THEME names, which are the identity the engine is
    // built on — a loaded source pack is a display layer over them.
    const byName = {};
    Object.keys(SB.cards).forEach(function (id) {
      const n = SB.names.original ? SB.names.original('cards', id) : SB.names.cards[id];
      if (!n || !n.name) return;
      const key = n.name + '\u0000' + (n.subtitle || '');
      if (byName[key]) fail(id, 'shares its name and subtitle with ' + byName[key]);
      byName[key] = id;
    });

    // The printed-names pack is a different matter. It maps several ids onto one
    // printed card — reprints, and cards the community database records under one
    // title — and where BOTH are unique the engine would let a player control two
    // copies of what the printed pack calls one card. That is a content decision
    // (which ids are genuinely one card, and so want `sameCardAs`), not something to
    // resolve by throwing at load: reported, and listed in DEVIATIONS.md.
    SB.namePackCollisions = function () {
      const seen = {}, out = [];
      Object.keys(SB.cards).forEach(function (id) {
        const n = SB.names.cards[id];
        if (!n || !n.name) return;
        const key = n.name + '\u0000' + (n.subtitle || '');
        if (seen[key]) out.push([seen[key], id]); else seen[key] = id;
      });
      return out.filter(function (pair) {
        return SB.cards[pair[0]].unique && SB.cards[pair[1]].unique &&
          SB.cardIdentity(pair[0]) !== SB.cardIdentity(pair[1]);
      });
    };

    Object.keys(SB.decks || {}).forEach(function (deckId) {
      const d = SB.decks[deckId];
      if (!SB.cards[d.leader] || SB.cards[d.leader].type !== 'leader') fail(deckId, 'bad leader ' + d.leader);
      if (!SB.cards[d.base] || SB.cards[d.base].type !== 'base') fail(deckId, 'bad base ' + d.base);
      // The sideboard (tournament lists only) is checked like the main deck; the copy
      // limit applies to main + sideboard together, as in the source rules.
      const pool = d.cards.concat(d.sideboard || []);
      pool.forEach(function (cid) {
        const c = SB.cards[cid];
        if (!c) fail(deckId, 'unknown card ' + cid);
        if (c.type === 'leader' || c.type === 'base') fail(deckId, 'deck contains ' + c.type + ' ' + cid);
      });
      if (d.format && d.format !== 'premier' && d.format !== 'eternal') fail(deckId, 'unknown format ' + d.format);
      // Copy limit: max 3 of a card id per deck, unless the card raises its own limit.
      const counts = {};
      pool.forEach(function (cid) { counts[cid] = (counts[cid] || 0) + 1; });
      Object.keys(counts).forEach(function (cid) {
        const limit = SB.cards[cid].copyLimit || 3;
        if (counts[cid] > limit) fail(deckId, counts[cid] + ' copies of ' + cid);
      });
      // Minimum deck size: 50, raised by the leader, the base, or any main-deck
      // card carrying minDeckSizeDelta (jtl-024 style). Only enforced for
      // tournament-format decks — test fixtures (tests/fixtures.js) run small
      // decks on purpose and carry no format.
      if (d.format) {
        const minSize = 50 +
          (SB.cards[d.leader].minDeckSizeDelta || 0) + (SB.cards[d.base].minDeckSizeDelta || 0) +
          d.cards.reduce(function (sum, cid) { return sum + (SB.cards[cid].minDeckSizeDelta || 0); }, 0);
        if (d.cards.length < minSize) fail(deckId, d.cards.length + ' cards, needs ' + minSize + ' or more');
      }
    });
  };
})(window.SB = window.SB || {});

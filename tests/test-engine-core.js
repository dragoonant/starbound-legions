// test-engine-core.js — setup, turn flow, resources, play costs, immutability.
(function (SB) {
  'use strict';
  const T = SB.test;

  T.add('setup: hands of 4 after resourcing 2, resources 2 each', function () {
    const s = T.game();
    T.eq(s.phase, 'action', 'phase');
    [0, 1].forEach(function (p) {
      T.eq(s.players[p].hand.length, 4, 'hand p' + p);
      T.eq(s.players[p].resources.length, 2, 'resources p' + p);
      const total = SB.decks[s.players[p].deckId].cards.length;
      T.eq(s.players[p].deck.length, total - 6, 'deck p' + p);
    });
    T.eq(s.active, s.initiative, 'initiative acts first');
  });

  T.add('reproducible: same seed, same game start', function () {
    const a = T.game('fixtureA', 'fixtureB', 'seed42');
    const b = T.game('fixtureA', 'fixtureB', 'seed42');
    T.deepEq(a, b, 'identical states');
    const c = T.game('fixtureA', 'fixtureB', 'seed43');
    T.ok(JSON.stringify(a) !== JSON.stringify(c), 'different seed differs');
  });

  T.add('apply never mutates its input', function () {
    const s = T.game();
    const before = JSON.stringify(s);
    const acts = SB.legalActions(s);
    acts.forEach(function (a) { SB.apply(s, a); });
    T.eq(JSON.stringify(s), before, 'state unchanged after applying every action');
  });

  T.add('play unit: pays cost, enters exhausted in its arena', function () {
    let s = T.game();
    const me = s.active;
    T.putInHand(s, me, 'fx-grunt');
    T.giveResources(s, me, 3);
    s = T.act(s, { type: 'playCard', cardId: 'fx-grunt' });
    const u = SB.allUnits(s, me).find(function (x) { return x.cardId === 'fx-grunt'; });
    T.ok(u, 'on board');
    T.ok(u.exhausted, 'enters exhausted');
    T.eq(SB.arenaOf(s, u), 'ground', 'ground arena');
  });

  T.add('aspect penalty: off-aspect card costs +2 per missing icon', function () {
    const s = T.game();
    // fixtureA aspects: command+heroism (leader) + aggression (base).
    T.eq(SB.cardCost(s, 0, 'fx-grunt'), 1, 'aggression covered');
    T.eq(SB.cardCost(s, 0, 'fx-ghost'), 5, 'cunning not covered: 3+2');
    T.eq(SB.cardCost(s, 0, 'fx-supply'), 2, 'command covered');
  });

  T.add('cantAfford: true only when the cost outruns ready resources', function () {
    const s = T.game();
    // 2 ready resources at the start of round 1.
    T.eq(SB.readyResources(s, 0), 2, 'two ready');
    T.ok(!SB.cantAfford(s, 0, 'fx-grunt'), 'cost 1 is affordable');
    T.ok(!SB.cantAfford(s, 0, 'fx-supply'), 'cost 2 is exactly affordable');
    T.ok(SB.cantAfford(s, 0, 'fx-ghost'), 'cost 3+2 off-aspect is not');
    // The aspect penalty is part of it: the same card is affordable to nobody here,
    // but the comparison is against the ADJUSTED cost, not the printed one.
    T.ok(SB.cardCost(s, 0, 'fx-ghost') > SB.card('fx-ghost').cost, 'penalty applied');
  });

  T.add('pass/pass ends round; regroup draws 2 and readies', function () {
    let s = T.game('fixtureA', 'fixtureB', 'rg');
    const first = s.active;
    s = T.act(s, { type: 'pass' });
    s = T.act(s, { type: 'pass' });
    // Now in regroup resource choices.
    T.eq(s.players[0].hand.length, 6, 'drew 2');
    T.eq(s.players[1].hand.length, 6, 'drew 2');
    s = SB.apply(s, SB.legalActions(s)[0]); // resource something
    s = SB.apply(s, SB.legalActions(s).find(function (a) { return a.handIndex === -1; })); // decline
    T.eq(s.phase, 'action', 'back to action');
    T.eq(s.round, 2, 'round 2');
    T.eq(s.players[0].resources.length + s.players[1].resources.length, 5, 'one resourced');
  });

  T.add('claim initiative: locks claimer, flips token, other keeps acting', function () {
    let s = T.game('fixtureA', 'fixtureB', 'claim');
    const claimer = s.active;
    s = T.act(s, { type: 'claimInitiative' });
    T.eq(s.initiative, claimer, 'token moved');
    T.eq(s.active, SB.other(claimer), 'other player acts');
    // Claimer never acts again this phase: other player passes → regroup.
    s = T.act(s, { type: 'pass' });
    T.eq(s.phase, 'regroup', 'phase over');
    // Initiative holder resources first next regroup: queue head is claimer.
    T.eq(s.queue[0].player, claimer, 'claimer picks resource first');
  });

  T.add('pass then act clears consecutive-pass tracking', function () {
    let s = T.game('fixtureA', 'fixtureB', 'pp');
    const a = s.active, b = SB.other(a);
    T.putInHand(s, b, 'fx-grunt');
    T.giveResources(s, b, 2);
    s = T.act(s, { type: 'pass' });               // a passes
    s = T.act(s, { type: 'playCard', cardId: 'fx-grunt' }); // b acts
    T.eq(s.phase, 'action', 'still action phase');
    s = T.act(s, { type: 'pass' });               // a passes again
    T.eq(s.phase, 'action', 'not over: passes were not consecutive');
    s = T.act(s, { type: 'pass' });               // b passes → both consecutive
    T.eq(s.phase, 'regroup', 'now over');
  });

  // ---- the uniqueness rule ------------------------------------------------
  // Printed rule: a player may not CONTROL two copies of the same unique card. The
  // second copy is legal to play; the moment it lands the controller keeps one and
  // the rest are defeated. Players do this on purpose, so the two abilities firing
  // in one play is the behaviour under test, not a side effect.

  function withUniqueFixtures(fn) {
    SB.cards['fx-uniq'] = { id: 'fx-uniq', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1,
      aspects: [], unique: true,
      abilities: [{ trigger: 'onPlay', effects: [{ op: 'draw', amount: 1 }] },
        { trigger: 'whenDefeated', effects: [{ op: 'gainCredits', amount: 1 }] }] };
    SB.cards['fx-uniq-up'] = { id: 'fx-uniq-up', type: 'upgrade', cost: 1, power: 1, hp: 1,
      aspects: [], unique: true };
    SB.cards['fx-plain'] = { id: 'fx-plain', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1,
      aspects: [] };
    SB.names.register('cards', 'fx-uniq', { name: 'FX Uniq' });
    SB.names.register('cards', 'fx-uniq-up', { name: 'FX Uniq Up' });
    SB.names.register('cards', 'fx-plain', { name: 'FX Plain' });
    try { fn(); } finally {
      delete SB.cards['fx-uniq']; delete SB.cards['fx-uniq-up']; delete SB.cards['fx-plain'];
    }
  }

  T.add('unique rule: the second copy is playable', function () {
    withUniqueFixtures(function () {
      let s = T.game();
      const me = s.active;
      T.putOnBoard(s, me, 'fx-uniq');
      T.putInHand(s, me, 'fx-uniq');
      T.giveResources(s, me, 2);
      const plays = SB.legalActions(s).filter(function (a) { return a.cardId === 'fx-uniq'; });
      T.eq(plays.length, 1, 'the duplicate can be played');
    });
  });

  T.add('unique rule: playing the second copy asks which to keep, then defeats the other', function () {
    withUniqueFixtures(function () {
      let s = T.game();
      const me = s.active;
      const first = T.putOnBoard(s, me, 'fx-uniq');
      T.putInHand(s, me, 'fx-uniq');
      T.giveResources(s, me, 2);
      const handBefore = s.players[me].hand.length;
      s = T.act(s, { type: 'playCard', cardId: 'fx-uniq' });
      // Both copies are on the board and the played one's "when played" has resolved.
      T.eq(SB.allUnits(s, me).filter(function (u) { return u.cardId === 'fx-uniq'; }).length, 2, 'both copies present');
      T.eq(s.players[me].hand.length, handBefore - 1 + 1, 'when-played drew a card');
      T.eq(s.queue[0].step, 'uniqueDefeat', 'the rule asks which to keep');
      const choices = SB.legalActions(s);
      T.eq(choices.length, 2, 'one choice per copy');
      const creditsBefore = s.players[me].credits || 0;
      s = T.act(s, { type: 'uniqueKeep', uid: first.uid });
      const left = SB.allUnits(s, me).filter(function (u) { return u.cardId === 'fx-uniq'; });
      T.eq(left.length, 1, 'one copy survives');
      T.eq(left[0].uid, first.uid, 'the chosen copy is the one kept');
      T.eq((s.players[me].credits || 0), creditsBefore + 1, 'the defeated copy used its last words');
      T.eq(s.queue.length, 0, 'the board is settled');
    });
  });

  T.add('unique rule: keeping the new copy defeats the old one', function () {
    withUniqueFixtures(function () {
      let s = T.game();
      const me = s.active;
      const first = T.putOnBoard(s, me, 'fx-uniq');
      T.putInHand(s, me, 'fx-uniq');
      T.giveResources(s, me, 2);
      s = T.act(s, { type: 'playCard', cardId: 'fx-uniq' });
      const fresh = SB.allUnits(s, me).find(function (u) { return u.cardId === 'fx-uniq' && u.uid !== first.uid; });
      s = T.act(s, { type: 'uniqueKeep', uid: fresh.uid });
      const left = SB.allUnits(s, me).filter(function (u) { return u.cardId === 'fx-uniq'; });
      T.eq(left.length, 1, 'one copy survives');
      T.eq(left[0].uid, fresh.uid, 'the new copy stayed');
    });
  });

  T.add('unique rule: non-unique cards stack freely', function () {
    withUniqueFixtures(function () {
      let s = T.game();
      const me = s.active;
      T.putOnBoard(s, me, 'fx-plain');
      T.putInHand(s, me, 'fx-plain');
      T.giveResources(s, me, 2);
      s = T.act(s, { type: 'playCard', cardId: 'fx-plain' });
      T.eq(s.queue.length, 0, 'no uniqueness choice');
      T.eq(SB.allUnits(s, me).filter(function (u) { return u.cardId === 'fx-plain'; }).length, 2, 'both stay');
    });
  });

  T.add('unique rule: the opponent controlling a copy is not your problem', function () {
    withUniqueFixtures(function () {
      let s = T.game();
      const me = s.active;
      T.putOnBoard(s, SB.other(me), 'fx-uniq');
      T.putInHand(s, me, 'fx-uniq');
      T.giveResources(s, me, 2);
      s = T.act(s, { type: 'playCard', cardId: 'fx-uniq' });
      T.eq(s.queue.length, 0, 'no uniqueness choice: one copy each');
      T.eq(SB.allUnits(s).filter(function (u) { return u.cardId === 'fx-uniq'; }).length, 2, 'both stay');
    });
  });

  T.add('unique rule: it covers upgrades too', function () {
    withUniqueFixtures(function () {
      let s = T.game();
      const me = s.active;
      const a = T.putOnBoard(s, me, 'fx-plain');
      const b = T.putOnBoard(s, me, 'fx-plain');
      a.upgrades.push({ uid: s.nextUid++, cardId: 'fx-uniq-up', owner: me });
      b.upgrades.push({ uid: s.nextUid++, cardId: 'fx-uniq-up', owner: me });
      const dups = SB.uniqueDuplicates(s, me);
      T.eq(dups.length, 1, 'the duplicated upgrade is found');
      T.eq(dups[0].copies.length, 2, 'two copies');
      s = T.act(s, { type: 'pass' });
      T.eq(s.queue[0].step, 'uniqueDefeat', 'the rule asks which to keep');
      s = T.act(s, { type: 'uniqueKeep', uid: a.upgrades[0].uid });
      const held = SB.allUnits(s, me).reduce(function (n2, u) {
        return n2 + u.upgrades.filter(function (i2) { return i2.cardId === 'fx-uniq-up'; }).length;
      }, 0);
      T.eq(held, 1, 'one copy of the upgrade survives');
    });
  });

  // A card printed twice is one card wearing two ids. Nothing sets sameCardAs yet
  // (DEVIATIONS.md says why), so this guards the hook rather than live content.
  T.add('unique rule: sameCardAs folds two ids into one identity', function () {
    withUniqueFixtures(function () {
      SB.cards['fx-uniq-rp'] = { id: 'fx-uniq-rp', type: 'unit', arena: 'ground', cost: 1,
        power: 1, hp: 1, aspects: [], unique: true, sameCardAs: 'fx-uniq' };
      SB.names.register('cards', 'fx-uniq-rp', { name: 'FX Uniq Reprint' });
      try {
        let s = T.game();
        const me = s.active;
        const a = T.putOnBoard(s, me, 'fx-uniq');
        T.putOnBoard(s, me, 'fx-uniq-rp');
        const dups = SB.uniqueDuplicates(s, me);
        T.eq(dups.length, 1, 'the two ids are one card');
        T.eq(SB.uniqueGroupCardId(dups[0]), 'fx-uniq', 'named after a copy actually on the board');
        s = T.act(s, { type: 'pass' });
        T.eq(s.queue[0].step, 'uniqueDefeat', 'the rule bites across the reprint');
        s = T.act(s, { type: 'uniqueKeep', uid: a.uid });
        T.eq(SB.allUnits(s, me).filter(function (u) {
          return SB.cardIdentity(u.cardId) === 'fx-uniq';
        }).length, 1, 'one copy of the card survives');
      } finally {
        delete SB.cards['fx-uniq-rp'];
        delete SB.names.cards['fx-uniq-rp'];
      }
    });
  });

  // The rule keys on card id; the printed rule keys on name-plus-subtitle. Content
  // validation is what holds the two equivalent, so it has to actually catch a clash.
  T.add('unique rule: two ids sharing a name and subtitle fail validation', function () {
    SB.cards['zz-twin-a'] = { id: 'zz-twin-a', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: [] };
    SB.cards['zz-twin-b'] = { id: 'zz-twin-b', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: [] };
    SB.names.register('cards', 'zz-twin-a', { name: 'Twin', subtitle: 'Of Two Minds' });
    SB.names.register('cards', 'zz-twin-b', { name: 'Twin', subtitle: 'Of Two Minds' });
    try {
      const e = T.throws(function () { SB.validateContent(); }, 'a shared printed identity is a content error');
      T.ok(/shares its name and subtitle/.test(String(e)), 'and says so: ' + e);
    } finally {
      delete SB.cards['zz-twin-a']; delete SB.cards['zz-twin-b'];
      delete SB.names.cards['zz-twin-a']; delete SB.names.cards['zz-twin-b'];
    }
    SB.validateContent();   // and the real content still passes
  });

  T.add('unique rule: taking control of a copy you already have trips it', function () {
    withUniqueFixtures(function () {
      let s = T.game();
      const me = s.active;
      const mine = T.putOnBoard(s, me, 'fx-uniq');
      const theirs = T.putOnBoard(s, SB.other(me), 'fx-uniq');
      T.eq(SB.uniqueDuplicates(s, me).length, 0, 'one each is fine');
      theirs.owner = me;                       // as takeControl does
      s = T.act(s, { type: 'pass' });
      T.eq(s.queue[0].step, 'uniqueDefeat', 'now the rule bites');
      s = T.act(s, { type: 'uniqueKeep', uid: mine.uid });
      T.eq(SB.allUnits(s, me).filter(function (u) { return u.cardId === 'fx-uniq'; }).length, 1, 'one left');
    });
  });

  T.add('deck-out: failing to draw damages own base 3 per card', function () {
    let s = T.game('fixtureA', 'fixtureB', 'deckout');
    s.players[0].deck = [];
    s = T.act(s, { type: 'pass' });
    s = T.act(s, { type: 'pass' });
    T.eq(s.players[0].base.damage, 6, 'two missed draws = 6');
  });

  T.add('leader deploy: needs resources, arrives ready, flips back on defeat', function () {
    let s = T.game('fixtureA', 'fixtureB', 'dep');
    const me = s.active;
    T.eq(SB.legalActions(s).filter(function (a) { return a.type === 'deployLeader'; }).length, 0, 'not yet');
    T.giveResources(s, me, 3); // 2 + 3 = 5 total resources
    s = T.act(s, { type: 'deployLeader' });
    const lu = SB.allUnits(s, me).find(function (u) { return SB.card(u.cardId).type === 'leader'; });
    T.ok(lu && !lu.exhausted, 'deployed ready');
    // Defeat it: flips back exhausted, healed.
    let s2 = SB.clone(s);
    const lu2 = SB.findUnit(s2, lu.uid);
    SB.defeatUnit(s2, lu2, {});
    T.ok(!s2.players[me].leader.deployed, 'back to leader side');
    T.ok(s2.players[me].leader.exhausted, 'exhausted after defeat');
  });

  T.add('leader defeat: cannot deploy again for the rest of the game', function () {
    let s = T.game('fixtureA', 'fixtureB', 'nodeploy');
    const me = s.active;
    T.giveResources(s, me, 3);
    s = T.act(s, { type: 'deployLeader' });
    const lu = SB.allUnits(s, me).find(function (u) { return SB.card(u.cardId).type === 'leader'; });
    SB.defeatUnit(s, SB.findUnit(s, lu.uid), {});
    T.ok(s.players[me].leader.defeated, 'flagged defeated');
    s.active = me;
    s.players[me].leader.exhausted = false;
    T.eq(SB.legalActions(s).filter(function (a) {
      return a.type === 'deployLeader' || a.type === 'deployLeaderPilot';
    }).length, 0, 'no redeploy offered');
    T.ok(SB.legalActions(s).some(function (a) { return a.type === 'leaderAction'; }),
      'leader-side abilities still usable');
  });

  T.add('leader action: exhausts leader, queues effect with choice', function () {
    let s = T.game('fixtureA', 'fixtureB', 'la');
    s.active = 0; s.initiative = 0; // pin to the fixtureA player: its leader grants experience
    const me = 0;
    T.putOnBoard(s, me, 'fx-grunt');
    T.putOnBoard(s, me, 'fx-wall');
    T.giveResources(s, me, 1);
    s = T.act(s, { type: 'leaderAction' });
    T.ok(s.players[me].leader.exhausted, 'leader exhausted');
    const choices = SB.legalActions(s);
    T.eq(choices[0].type, 'choose', 'choice pending');
    T.eq(choices.length, 2, 'two friendly units to pick');
    s = SB.apply(s, choices[0]);
    const total = SB.allUnits(s, me).reduce(function (n, u) { return n + u.experience; }, 0);
    T.eq(total, 1, 'one experience token granted');
  });
})(window.SB = window.SB || {});

// test-expansion.js — the second op vocabulary (js/ops2.js) and the engine hooks it
// rides on, pinned through real competitive-expansion cards. Each test builds one
// position, drives the choice queue with explicit picks, and asserts the board.
(function (SB) {
  'use strict';
  const T = SB.test;

  // Resolve the open queue by picking, at each step, the first action `pick` accepts
  // (or the first action when `pick` is absent). Returns the settled state.
  function drive(s, pick, limit) {
    let n = 0;
    while (s.queue.length > 0 && !SB.isTerminal(s) && n++ < (limit || 40)) {
      const acts = SB.legalActions(s);
      const a = (pick && acts.find(pick)) || acts[0];
      s = SB.apply(s, a);
    }
    return s;
  }
  function rich(s, who) { T.giveResources(s, who, 14); return s; }
  // Top the bank up to EXACTLY n ready resources: T.game() already deals a starting
  // few, so an affordability test cannot just hand over a count and hope.
  function fund(s, who, n) {
    const have = SB.readyResources(s, who);
    if (n > have) T.giveResources(s, who, n - have);
    return s;
  }
  function play(s, who, cardId, extra) {
    s.active = who; // a play passes the turn; tests string several plays by one seat
    const inst = T.putInHand(s, who, cardId);
    const idx = s.players[who].hand.indexOf(inst);
    return T.act(s, Object.assign({ type: 'playCard', handIndex: idx, cardId: cardId }, extra || {}));
  }
  // A leader's unit side on the board (the generic helper reads the root arena).
  function deployed(s, who, leaderId) {
    const u = SB.makeUnit(s, leaderId, who);
    u.exhausted = false;
    s[SB.card(leaderId).deployedSide.arena || 'ground'].push(u);
    return u;
  }
  function unitsOf(s, who, cardId) {
    return SB.allUnits(s, who).filter(function (u) { return u.cardId === cardId; });
  }

  T.add('expansion: choose an arena and exhaust every unit in it', function () {
    let s = rich(T.game(), 0); s.active = 0;
    const me = 0, foe = 1;
    const g1 = T.putOnBoard(s, foe, 'fx-grunt'), g2 = T.putOnBoard(s, foe, 'fx-wall');
    const fl = T.putOnBoard(s, foe, 'fx-flyer');
    s = play(s, me, 'ash-219');
    s = drive(s, function (a) { return (a.type === 'binary' && a.pick === 'a') || (a.type === 'pickArena' && a.arena === 'ground'); });
    T.ok(SB.findUnit(s, g1.uid).exhausted && SB.findUnit(s, g2.uid).exhausted, 'ground units exhausted');
    T.ok(!SB.findUnit(s, fl.uid).exhausted, 'space unit untouched');
  });

  T.add('expansion: a static cost discount from a unit in play', function () {
    let s = T.game(); const me = 0;
    const before = SB.cardCost(s, me, 'jtl-041');
    deployed(s, me, 'jtl-005');
    T.eq(SB.cardCost(s, me, 'jtl-041'), before - 2, 'capital ships cost 2 less while the deployed leader is in play');
  });

  T.add('expansion: "the next unit you play enters ready" honours its filter', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    s = play(s, me, 'ash-248'); s = drive(s);
    s = play(s, me, 'fx-grunt'); // power 2: not eligible
    T.ok(unitsOf(s, me, 'fx-grunt')[0].exhausted, 'a 2-power unit still arrives exhausted');
    s = play(s, me, 'fx-wall');  // power 1: eligible
    T.ok(!unitsOf(s, me, 'fx-wall')[0].exhausted, 'a 1-power unit arrives ready');
    s = play(s, me, 'fx-medic'); // grant consumed
    T.ok(unitsOf(s, me, 'fx-medic')[0].exhausted, 'the grant was spent');
  });

  T.add('expansion: an aura can take a keyword away', function () {
    let s = T.game(); const me = 0, foe = 1;
    const wall = T.putOnBoard(s, foe, 'fx-wall');
    const mine = T.putOnBoard(s, me, 'fx-grunt');
    T.ok(SB.hasKeyword(s, wall, 'sentinel'), 'sentinel before');
    T.ok(!SB.attackTargets(s, mine).some(function (t) { return t.kind === 'base'; }), 'base shielded by the sentinel');
    T.putOnBoard(s, me, 'ash-040');
    T.ok(!SB.hasKeyword(s, wall, 'sentinel'), 'sentinel lost under the aura');
    T.ok(SB.attackTargets(s, mine).some(function (t) { return t.kind === 'base'; }), 'base attackable again');
  });

  T.add('expansion: dynamic stats count other friendly space units', function () {
    let s = T.game(); const me = 0;
    const sq = T.putOnBoard(s, me, 'jtl-115');
    const base = SB.unitPower(s, sq);
    T.putOnBoard(s, me, 'fx-flyer'); T.putOnBoard(s, me, 'fx-flyer');
    T.eq(SB.unitPower(s, sq), base + 2, '+1 power per other friendly space unit');
    T.eq(SB.unitMaxHp(s, sq), SB.card('jtl-115').hp + 2, '+1 HP per other friendly space unit');
  });

  T.add('expansion: numeric keyword granted to each matching unit for the round', function () {
    let s = T.game(); s.active = 0; const me = 0;
    const y = T.putOnBoard(s, me, 'lof-045');
    const luke = T.putOnBoard(s, me, 'ash-112', { exhausted: true });
    T.eq(SB.keywordTotal(s, luke, 'restore'), 1, 'printed restore 1');
    s = T.act(s, { type: 'attack', attacker: y.uid, target: { kind: 'base', player: 1 } });
    s = drive(s);
    T.eq(SB.keywordTotal(s, SB.findUnit(s, luke.uid), 'restore'), 2, 'gained restore 1 on top');
  });

  T.add('expansion: naming a card blocks the opponent from playing it', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    T.putInHand(s, foe, 'fx-bolt');
    s = play(s, me, 'ash-077');
    s = drive(s, function (a) { return a.type === 'nameCard' && a.cardId === 'fx-bolt'; });
    T.ok(SB.nameBlocked(s, foe, 'fx-bolt'), 'the named card is blocked for the opponent');
    s.active = foe; T.giveResources(s, foe, 5);
    T.ok(!SB.legalActions(s).some(function (a) { return a.type === 'playCard' && a.cardId === 'fx-bolt'; }), 'and cannot be played');
    T.ok(!SB.nameBlocked(s, me, 'fx-bolt'), 'the namer may still play copies');
  });

  T.add('expansion: losing all abilities, then defeat by cost', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const brute = T.putOnBoard(s, foe, 'fx-brute'); // cost 4, overwhelm
    s = play(s, me, 'law-132');
    s = drive(s, function (a) { return a.type === 'choose'; });
    const b = SB.findUnit(s, brute.uid);
    T.ok(b, 'a 4-cost unit is not defeated');
    T.ok(!SB.hasKeyword(s, b, 'overwhelm'), 'but it lost its keyword');
    let s2 = rich(T.game(), 0); s2.active = 0;
    const wall = T.putOnBoard(s2, foe, 'fx-wall'); // cost 2
    s2 = play(s2, me, 'law-132'); s2 = drive(s2);
    T.ok(!SB.findUnit(s2, wall.uid), 'a 2-cost unit is defeated');
  });

  T.add('expansion: defeat units under a remaining-HP budget, creating a token each', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const g = T.putOnBoard(s, foe, 'fx-grunt'), f = T.putOnBoard(s, foe, 'fx-flyer');
    s = play(s, me, 'ash-053');
    // Pick the two enemies (the freshly created friendly tokens are legal picks too);
    // stop once neither is offered.
    s = drive(s, function (a) { return a.type === 'budgetDefeat' && (a.uid === g.uid || a.uid === f.uid); });
    T.ok(!SB.findUnit(s, g.uid) && !SB.findUnit(s, f.uid), 'both 2-HP units fell within the budget of 6');
    T.eq(unitsOf(s, me, 'tok-mnd').length, 2, 'one token per unit defeated');
  });

  T.add('expansion: a base captures a unit and rescues it at the regroup phase', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const g = T.putOnBoard(s, foe, 'fx-grunt');
    s = play(s, me, 'sec-195'); s = drive(s);
    T.ok(!SB.findUnit(s, g.uid), 'captured off the board');
    T.eq((s.players[me].baseCaptured || []).length, 1, 'held at the base');
    s = T.act(s, { type: 'pass' }); s = T.act(s, { type: 'pass' }); // both seats pass in turn
    s = drive(s, function (a) { return a.type === 'resourceCard' && a.handIndex === -1; });
    T.ok(SB.findUnit(s, g.uid), 'rescued at the start of the regroup phase');
  });

  T.add('expansion: borrowing another unit\'s last-words ability without defeating it', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const m = T.putOnBoard(s, me, 'fx-martyr');
    const hand = s.players[me].hand.length;
    s = play(s, me, 'jtl-039');
    s = drive(s, function (a) { return a.type === 'choose' && a.index >= 0; });
    T.ok(SB.findUnit(s, m.uid), 'the martyr lives');
    T.eq(s.players[me].hand.length, hand + 1, 'its draw happened anyway');
  });

  T.add('expansion: "when an enemy unit is defeated" observers fire', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    T.putOnBoard(s, me, 'lof-130');
    const g = T.putOnBoard(s, foe, 'fx-grunt');
    const before = s.players[foe].base.damage;
    s = play(s, me, 'fx-bolt');
    s = drive(s, function (a) { return a.type === 'choose' && s.queue[0].candidates[a.index].uid === g.uid; });
    T.ok(!SB.findUnit(s, g.uid), 'grunt defeated');
    T.eq(s.players[foe].base.damage, before + 1, 'its controller\'s base took 1');
  });

  T.add('expansion: a shield on the guardian breaks instead of a lethal hit on a friend', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const guard = T.putOnBoard(s, me, 'ash-062', { shields: 1 });
    const g = T.putOnBoard(s, me, 'fx-grunt');
    s = play(s, me, 'fx-bolt');
    s = drive(s, function (a) { return a.type === 'choose' && s.queue[0].candidates[a.index].uid === g.uid; });
    T.ok(SB.findUnit(s, g.uid) && SB.findUnit(s, g.uid).damage === 0, 'the grunt was spared');
    T.eq(SB.findUnit(s, guard.uid).shields, 0, 'at the price of the guardian\'s shield');
  });

  T.add('expansion: moving a shield token between units', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const g = T.putOnBoard(s, me, 'fx-grunt', { shields: 1 });
    s = play(s, me, 'jtl-242');
    const shuttle = unitsOf(s, me, 'jtl-242')[0];
    s = drive(s, function (a) { return (a.type === 'tokenTake' && a.uid === g.uid) || (a.type === 'tokenGive' && a.uid === shuttle.uid); });
    T.eq(SB.findUnit(s, g.uid).shields, 0, 'taken from the grunt');
    T.eq(SB.findUnit(s, shuttle.uid).shields, 2, 'given to the shuttle (on top of its own)');
  });

  T.add('expansion: a pilot unit boards a vehicle, and ejects when it would be defeated', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const luke = T.putOnBoard(s, me, 'jtl-094');
    s = play(s, me, 'jtl-038');
    s = drive(s, function (a) { return a.type === 'pilotFromUnit' && a.uid === luke.uid; });
    const ship = unitsOf(s, me, 'jtl-038')[0];
    T.ok(!SB.findUnit(s, luke.uid), 'no longer a ground unit');
    T.ok(ship.upgrades.some(function (i) { return i.cardId === 'jtl-094'; }), 'now a pilot upgrade');
    SB.defeatUnit(s, ship, {});
    const back = unitsOf(s, me, 'jtl-094')[0];
    T.ok(back && SB.arenaOf(s, back) === 'ground' && back.exhausted, 'ejected to the ground arena, exhausted');
  });

  T.add('expansion: a discard action plays a card discarded this round', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const inst = { uid: s.nextUid++, cardId: 'shd-135' };
    s.players[me].discard.push(inst);
    T.ok(!SB.legalActions(s).some(function (a) { return a.type === 'playDiscardAction'; }), 'not offered for an old discard');
    SB.noteDiscarded(s, me, inst);
    s = T.act(s, { type: 'playDiscardAction', cardId: 'shd-135' });
    T.eq(unitsOf(s, me, 'shd-135').length, 1, 'played from the discard pile');
  });

  T.add('expansion: granted smuggle lets any resource be played', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    s.players[me].resources.push({ instance: { uid: s.nextUid++, cardId: 'fx-grunt' }, exhausted: false });
    T.ok(!SB.legalActions(s).some(function (a) { return a.type === 'smuggle' && a.cardId === 'fx-grunt'; }), 'no smuggle without the grant');
    T.putOnBoard(s, me, 'shd-248');
    T.ok(SB.legalActions(s).some(function (a) { return a.type === 'smuggle' && a.cardId === 'fx-grunt'; }), 'smuggle offered with the grant');
    s = T.act(s, { type: 'smuggle', cardId: 'fx-grunt' });
    T.eq(unitsOf(s, me, 'fx-grunt').length, 1, 'and it enters play');
  });

  T.add('expansion: a base that shrinks the opening hand', function () {
    const s = SB.newGame({ deck0: 'deck-c08', deck1: 'fixtureB', seed: 'hand' });
    T.eq(SB.card(SB.decks['deck-c08'].base).startingHandDelta, -1, 'the deck carries the base in question');
    T.eq(s.players[0].hand.length, 5, 'five cards instead of six');
    T.eq(s.players[1].hand.length, 6, 'the other side unaffected');
  });

  T.add('expansion: "when you take the initiative" on a leader side', function () {
    let s = T.game('deck-c08', 'fixtureB', 'init');
    s.active = 0; s.initiativeClaimed = false; s.locked = [false, false]; s.passed = [false, false];
    T.giveResources(s, 0, 3);
    const hand = s.players[0].hand.length;
    s = T.act(s, { type: 'claimInitiative' });
    s = drive(s, function (a) { return (a.type === 'leaderTrigger' && a.use) || (a.type === 'binary' && a.pick === 'a'); });
    T.eq(s.players[0].hand.length, hand + 1, 'paid 1 to draw a card');
    T.ok(s.players[0].leader.exhausted === false, 'no exhaust cost on this trigger');
  });

  T.add('expansion: a combat static with a generic condition (first attack strikes first)', function () {
    let s = T.game(); s.active = 0; const me = 0, foe = 1;
    const pod = T.putOnBoard(s, me, 'law-219');
    const g = T.putOnBoard(s, foe, 'fx-grunt');
    T.ok(SB.unitPower(s, pod) >= 2, 'premise: the racer can kill the grunt outright');
    s = T.act(s, { type: 'attack', attacker: pod.uid, target: { kind: 'unit', uid: g.uid } });
    s = drive(s);
    T.ok(!SB.findUnit(s, g.uid), 'grunt defeated');
    T.eq(SB.findUnit(s, pod.uid).damage, 0, 'first strike: no damage back on the first attack of the round');
  });

  T.add('expansion: "when your base is dealt combat damage" observers', function () {
    let s = T.game(); s.active = 1; const me = 0, foe = 1;
    const eval1 = T.putOnBoard(s, me, 'ts26-073');
    const g = T.putOnBoard(s, foe, 'fx-grunt');
    s = T.act(s, { type: 'attack', attacker: g.uid, target: { kind: 'base', player: me } });
    s = drive(s, function (a) { return a.type === 'choose' && s.queue[0].candidates[a.index].uid === g.uid; });
    T.eq(SB.findUnit(s, g.uid).damage, 1, 'the attacker took 1 from the defender\'s observer');
    T.ok(SB.findUnit(s, eval1.uid), 'observer still there');
  });

  T.add('expansion: every card of the 20 tournament lists renders and validates', function () {
    let n = 0;
    Object.keys(SB.decks).forEach(function (d) {
      if (SB.decks[d].group !== 'competitive') return;
      const dk = SB.decks[d];
      [dk.leader, dk.base].concat(dk.cards, dk.sideboard || []).forEach(function (id) {
        const lines = SB.cardText(id);
        T.ok(Array.isArray(lines), id + ' renders');
        lines.forEach(function (l) { T.ok(!/undefined|\[object/.test(l), id + ' has a hole: ' + l); });
        n++;
      });
    });
    T.ok(n > 1000, 'walked the lists (' + n + ' slots)');
  });
  T.add('expansion: a paid branch is not offered when the cost cannot be met', function () {
    // jtl-096 costs 3 and its "when played" branch charges 2 more. Played on exactly
    // 3 resources there is nothing left to pay with, so only the free branch stands.
    let s = T.game();
    fund(s, 0, SB.card('jtl-096').cost);   // exactly the card, nothing spare
    s = play(s, 0, 'jtl-096');
    T.eq(SB.readyResources(s, 0), 0, 'the play emptied the bank');
    T.eq(s.queue[0].step, 'binaryPick', 'the choice is pending');
    const acts = SB.legalActions(s);
    T.eq(acts.length, 1, 'one branch only');
    T.eq(acts[0].pick, 'b', 'and it is the branch that costs nothing');
    s = SB.apply(s, acts[0]);
    const u = unitsOf(s, 0, 'jtl-096')[0];
    T.ok(u && SB.arenaOf(s, u) === 'space', 'it never moved arena');
    T.eq(u.experience, 0, 'and gained nothing it did not pay for');
  });

  T.add('expansion: with the resources spare, the paid branch is offered and charged', function () {
    let s = T.game();
    fund(s, 0, SB.card('jtl-096').cost + 2);  // the card, plus the branch's price
    s = play(s, 0, 'jtl-096');
    const acts = SB.legalActions(s);
    T.eq(acts.length, 2, 'both branches stand');
    s = drive(SB.apply(s, acts.find(function (a) { return a.pick === 'a'; })));
    const u = unitsOf(s, 0, 'jtl-096')[0];
    T.eq(SB.readyResources(s, 0), 0, 'paid 3 for the card and 2 for the branch');
    T.eq(SB.arenaOf(s, u), 'ground', 'moved arena');
    T.eq(u.experience, 2, 'and took its two experience');
  });

  T.add('expansion: an unpayable cost drops the effects it was buying', function () {
    // The guard above keeps this off the table in play, so pin the last line of
    // defence directly: a cost that cannot be met takes its own invocation with it
    // rather than fizzling alone and letting the rest resolve for free.
    let s = T.game();
    const u = T.putOnBoard(s, 0, 'fx-grunt');
    s.players[0].resources.forEach(function (r) { r.exhausted = true; });
    SB.queueEffects(s, 0, [
      { op: 'spendResources', amount: 2 },
      { op: 'experience', amount: 2, target: { self: true } },
    ], { sourceUid: u.uid, cardId: 'fx-grunt' });
    SB.drainQueue(s);
    T.eq(SB.findUnit(s, u.uid).experience, 0, 'the effect behind the cost never ran');
    T.ok(s.log.some(function (l) { return l.why === 'cantPay'; }), 'and the log says why');
  });

  T.add("expansion: an upgrade's when-played ability resolves once, not twice", function () {
    // lof-091 deals damage equal to its bearer's power, itself included. On a 2-power
    // bearer that is 4 — once. It used to fire twice, because the upgrade was already
    // attached when the bearer's own triggers were fired.
    let s = rich(T.game(), 0);
    const mine = T.putOnBoard(s, 0, 'fx-grunt');      // 2 power, 4 with the upgrade
    const foe = T.putOnBoard(s, 1, 'fx-gritty');      // 2/6: survives 4, dies to 8
    s = play(s, 0, 'lof-091', { attachTo: mine.uid });
    s = drive(s);
    const hit = SB.findUnit(s, foe.uid);
    T.ok(hit, 'the target survived a single hit');
    T.eq(hit.damage, 4, "took the bearer's power exactly once");
    T.eq(s.log.filter(function (l) { return l.type === 'unitDamage' && l.uid === foe.uid; }).length, 1,
      'and the log records one hit');
  });

  T.add("expansion: attaching an upgrade does not re-fire the bearer's own play ability", function () {
    // fx-sniper deals 2 when IT is played. Putting an upgrade on it later is not a
    // second play of the sniper.
    let s = rich(T.game(), 0);
    const foe = T.putOnBoard(s, 1, 'fx-gritty');
    s = play(s, 0, 'fx-sniper');
    s = drive(s);
    const after = SB.findUnit(s, foe.uid).damage;
    const sniper = unitsOf(s, 0, 'fx-sniper')[0];
    s = play(s, 0, 'fx-blade', { attachTo: sniper.uid });
    s = drive(s);
    T.eq(SB.findUnit(s, foe.uid).damage, after, 'the sniper did not shoot again');
  });

  T.add('expansion: an upgrade that bounces the OTHER upgrades leaves itself alone', function () {
    // ash-199 needs to know which upgrade it is; it learns that from its own play ctx,
    // which the duplicate trigger path used to be the only source of.
    let s = rich(T.game(), 0);
    const mine = T.putOnBoard(s, 0, 'fx-grunt');
    s = play(s, 0, 'fx-blade', { attachTo: mine.uid });
    s = drive(s);
    s = play(s, 0, 'ash-199', { attachTo: mine.uid });
    s = drive(s);
    const worn = SB.findUnit(s, mine.uid).upgrades.map(function (i) { return i.cardId; });
    T.eq(worn.join(','), 'ash-199', 'it stayed and the other one went');
    T.ok(s.players[0].hand.some(function (i) { return i.cardId === 'fx-blade'; }), 'the other one is back in hand');
  });

  // ---- a leader piloting a ship belongs to whoever DEPLOYED it -----------------
  // Seize the enemy ship their leader is flying, kill it, and it must be THEIR leader
  // that goes back to the sideline. Every consumer used to read the bearer's controller,
  // so this sidelined the wrong player's leader and marked it defeated for the game.
  function leaderAboard(s, seat, bearerCardId) {
    const p = s.players[seat];
    p.leader.cardId = 'jtl-009';                 // a leader with a pilot side
    const bearer = T.putOnBoard(s, seat, bearerCardId);
    p.leader.deployed = 'pilot';
    const inst = { uid: s.nextUid++, cardId: p.leader.cardId, leaderPilot: true, owner: seat };
    p.leader.uid = inst.uid;
    bearer.upgrades.push(inst);
    return bearer;
  }

  // ---- cluster-c4 expansion: credit tokens, naming, capture forms, extra regroup ----

  T.add('cluster-c4: law-221 takes control of an enemy Credit token on attack', function () {
    let s = T.game(); s.active = 0; const me = 0, foe = 1;
    s.players[foe].credits = 1;
    const u = T.putOnBoard(s, me, 'law-221');
    s = T.act(s, { type: 'attack', attacker: u.uid, target: { kind: 'base', player: foe } });
    s = drive(s);
    T.eq(s.players[foe].credits, 0, 'the opponent lost their credit token');
    T.eq(s.players[me].credits, 1, 'this unit\'s controller gained it');
  });

  T.add('cluster-c4: law-106 may defeat an enemy Credit token when played', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    s.players[foe].credits = 1;
    s = play(s, me, 'law-106');
    s = drive(s, function (a) { return a.type === 'binary' && a.pick === 'a'; });
    T.eq(s.players[foe].credits, 0, 'the enemy credit token was defeated, not taken');
    T.eq(s.players[me].credits || 0, 0, 'this player did not gain a credit');
  });

  T.add('cluster-c4: law-243 blocks a named card from being played for the rest of the phase', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    T.putInHand(s, foe, 'fx-grunt'); // seen in the opponent's hand so it is nameable
    s = play(s, me, 'law-243');
    s = drive(s, function (a) { return a.type === 'nameCard' && a.cardId === 'fx-grunt'; });
    T.ok(SB.nameBlocked(s, foe, 'fx-grunt'), 'fx-grunt is blocked for the rest of this phase');
    T.ok(SB.nameBlocked(s, me, 'fx-grunt'), 'the block applies to either player, not just the opponent');
    T.eq(s.phaseNamedBlocks.length, 1, 'tracked as a phase-scoped block, not a unit-bound one');
  });

  T.add('cluster-c4: shd-202 names a card that costs opponents 3 more while this unit is in play', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    T.putInHand(s, foe, 'fx-grunt');
    const before = SB.cardCost(s, foe, 'fx-grunt');
    s = play(s, me, 'shd-202');
    s = drive(s, function (a) { return a.type === 'nameCard' && a.cardId === 'fx-grunt'; });
    T.eq(SB.cardCost(s, foe, 'fx-grunt'), before + 3, 'costs 3 more for the opponent to play');
    T.eq(SB.cardCost(s, me, 'fx-grunt'), before, 'unaffected for this unit\'s own controller');
  });

  T.add('cluster-c4: twi-187 captures up to 3 enemy non-leader units totalling 8 or less remaining HP', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const a1 = T.putOnBoard(s, foe, 'fx-grunt'); // cheap, low HP
    const a2 = T.putOnBoard(s, foe, 'fx-grunt');
    const big = T.putOnBoard(s, foe, 'fx-wall'); // too much HP to fit the budget alongside the others
    s = play(s, me, 'twi-187');
    s = drive(s, function (a) { return a.type === 'captureBudget' && (a.uid === a1.uid || a.uid === a2.uid); }, 60);
    const captor = unitsOf(s, me, 'twi-187')[0];
    T.ok(!SB.findUnit(s, a1.uid) || !SB.findUnit(s, a2.uid), 'at least one cheap unit was captured');
    T.ok(SB.findUnit(s, big.uid), 'the high-HP unit was never a legal pick and stayed in play');
    T.ok(captor.captured && captor.captured.length <= 3, 'never more than 3 captives');
  });

  T.add('cluster-c4: sec-193 lets an opponent give up a unit to be captured, or this unit readies', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const victim = T.putOnBoard(s, foe, 'fx-grunt');
    s = play(s, me, 'sec-193');
    const captor = unitsOf(s, me, 'sec-193')[0];
    s = drive(s, function (a) { return a.type === 'captureOrReady' && a.uid === victim.uid; });
    T.ok(!SB.findUnit(s, victim.uid), 'the opponent\'s unit was captured');
    T.ok(SB.findUnit(s, captor.uid).captured.some(function (c) { return c.uid === victim.uid; }), 'held by sec-193');

    let s2 = rich(T.game(), 0); s2.active = 0;
    s2 = play(s2, me, 'sec-193');
    const captor2 = unitsOf(s2, me, 'sec-193')[0];
    captor2.exhausted = true;
    s2 = drive(s2, function (a) { return a.type === 'captureOrReady' && a.uid == null; });
    T.ok(!SB.findUnit(s2, captor2.uid).exhausted, 'declining readies sec-193 instead');
  });

  T.add('cluster-c4: law-072 adds a second regroup phase each round', function () {
    let s = T.game();
    T.putOnBoard(s, 0, 'law-072');
    const round0 = s.round;
    s = T.act(s, { type: 'pass' });
    s = T.act(s, { type: 'pass' });
    s = drive(s, null, 200); // resource/ready choices for both regroup phases
    T.eq(s.round, round0 + 1, 'still exactly one round later — the extra phase does not skip a round');
    T.eq(s.phase, 'action', 'settles back into a normal action phase');
    const regroupEntries = s.log.filter(function (l) { return l.type === 'regroup'; });
    T.eq(regroupEntries.length, 2, 'two regroup phases happened this round');
  });

  T.add('cluster-c4: sor-193 enters play ready and must pay 1 or bounce at regroup', function () {
    T.ok((SB.card('sor-193').staticFlags || []).indexOf('entersReady') >= 0, 'card data carries the entersReady flag');

    // Can pay: stays.
    let s1 = rich(T.game(), 0); const me = 0;
    const u1 = T.putOnBoard(s1, me, 'sor-193');
    SB.fireTriggers(s1, 'onRegroup', u1, { sourceUid: u1.uid });
    SB.drainQueue(s1);
    s1 = drive(s1, function (a) { return a.type === 'binary' && a.pick === 'a'; });
    T.ok(SB.findUnit(s1, u1.uid), 'stays in play after paying 1');

    // Cannot pay: returns to hand.
    let s2 = T.game();
    const u2 = T.putOnBoard(s2, me, 'sor-193');
    s2.players[me].resources.forEach(function (r) { r.exhausted = true; });
    SB.fireTriggers(s2, 'onRegroup', u2, { sourceUid: u2.uid });
    SB.drainQueue(s2);
    s2 = drive(s2);
    T.ok(!SB.findUnit(s2, u2.uid), 'left play');
    T.ok(s2.players[me].hand.some(function (inst) { return inst.cardId === 'sor-193'; }), 'returned to hand');
  });

  T.add('cluster-c4: law-077 upgrade stops its bearer readying and burns the base at regroup', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const bearer = T.putOnBoard(s, me, 'fx-grunt');
    bearer.exhausted = true;
    s = play(s, me, 'law-077', { attachTo: bearer.uid });
    const before = s.players[me].base.damage;
    SB.fireTriggers(s, 'onRegroup', SB.findUnit(s, bearer.uid), { sourceUid: bearer.uid });
    SB.drainQueue(s);
    T.eq(s.players[me].base.damage, before + 2, 'the bearer\'s controller took 2 base damage at regroup');
    T.ok(SB.unitHasGrantedStaticFlag(s, SB.findUnit(s, bearer.uid), 'cantReady'), 'the bearer cannot ready while wearing it');
  });

  T.add('expansion: killing a seized ship sidelines ITS leader, not yours', function () {
    let s = rich(T.game(), 0);
    const bearer = leaderAboard(s, 1, 'fx-grunt');   // their leader, aboard their unit
    s.players[0].leader.deployed = false;
    // Seize it, exactly as the event in the report did, then defeat it.
    SB.ops.takeControl(s, { controller: 0, op: {}, ctx: {} }, { kind: 'unit', uid: bearer.uid });
    T.eq(SB.findUnit(s, bearer.uid).owner, 0, 'the ship changed hands');
    SB.defeatUnit(s, SB.findUnit(s, bearer.uid), {});
    T.eq(s.players[1].leader.deployed, false, 'THEIR leader left the board');
    T.ok(s.players[1].leader.defeated, 'and is out for the game, having died aboard');
    T.eq(s.players[0].leader.deployed, false, 'your leader was never deployed');
    T.ok(!s.players[0].leader.defeated, 'and is emphatically not defeated');
    T.ok(!s.players[0].leader.exhausted, 'nor exhausted');
    const sidelined = s.log.filter(function (l) { return l.type === 'leaderReturned'; });
    T.eq(sidelined.length, 1, 'one leader was sidelined');
    T.eq(sidelined[0].player, 1, 'and the log names the right player');
  });

  T.add('expansion: the ordinary case still works — your own ship, your own leader', function () {
    let s = rich(T.game(), 0);
    const bearer = leaderAboard(s, 0, 'fx-grunt');
    SB.defeatUnit(s, SB.findUnit(s, bearer.uid), {});
    T.eq(s.players[0].leader.deployed, false, 'your leader left the board');
    T.ok(s.players[0].leader.defeated, 'out for the game');
    T.ok(!s.players[1].leader.defeated, 'theirs untouched');
  });

  // ---- a deployed leader costs its DEPLOY cost -------------------------------
  // law-132 defeats the unit it hits only if that unit costs 3 or less. A leader card
  // has no `cost` field at all, so the test read undefined, || 0 made it the cheapest
  // thing on the board, and a 5-cost leader died to it.
  function deployLeaderUnit(s, seat, leaderId) {
    s.players[seat].leader.cardId = leaderId;
    const u = SB.makeUnit(s, leaderId, seat);
    u.exhausted = false;
    s[SB.card(leaderId).deployedSide.arena || 'ground'].push(u);
    s.players[seat].leader.deployed = true;
    s.players[seat].leader.uid = u.uid;
    return u;
  }

  T.add('expansion: a deployed leader is priced at its deploy cost, not at nothing', function () {
    T.eq(SB.costOf('jtl-005'), 5, 'the leader costs its deploy cost');
    T.eq(SB.costOf('fx-grunt'), SB.card('fx-grunt').cost, 'an ordinary unit is unchanged');
  });

  T.add('expansion: "defeat it if it costs 3 or less" does not defeat a 5-cost leader', function () {
    let s = T.game();
    s.active = 1; s.initiative = 1;
    const lead = deployLeaderUnit(s, 0, 'jtl-005');
    s.players[1].hand = [];
    T.putInHand(s, 1, 'law-132');
    T.giveResources(s, 1, 8);
    s = T.act(s, { type: 'playCard', cardId: 'law-132' });
    s = drive(s);
    const still = SB.findUnit(s, lead.uid);
    T.ok(still, 'the leader survived');
    T.ok(still.abilitiesSuppressed, 'and still lost its abilities, which is the rest of the card');
  });

  T.add('expansion: ...but it still defeats a unit that really does cost 3 or less', function () {
    let s = T.game();
    s.active = 1; s.initiative = 1;
    const cheap = T.putOnBoard(s, 0, 'fx-ambusher');   // cost 3
    T.eq(SB.card('fx-ambusher').cost, 3, 'the fixture is the cost the test assumes');
    s.players[1].hand = [];
    T.putInHand(s, 1, 'law-132');
    T.giveResources(s, 1, 8);
    s = T.act(s, { type: 'playCard', cardId: 'law-132' });
    s = drive(s);
    T.ok(!SB.findUnit(s, cheap.uid), 'the 3-cost unit died');
  });

  T.add('expansion: a two-hit event still finds its second target after the first hit kills the saved unit', function () {
    // sec-180: 3 damage to a unit, then (with initiative) 2 damage to another unit
    // in the same arena. The 3 damage defeated the first target, so the "same
    // arena as the chosen unit" lookup found nothing and the 2 damage fizzled
    // with an enemy still sitting in that arena.
    let s = T.game();
    s.active = 1; s.initiative = 1;
    const first = T.putOnBoard(s, 0, 'fx-flyer');     // space, hp 2: dies to the 3
    const second = T.putOnBoard(s, 0, 'fx-flyer');    // space: the legal follow-up
    const grounded = T.putOnBoard(s, 0, 'fx-grunt');  // ground: never legal for the 2
    s = rich(s, 1);
    s = play(s, 1, 'sec-180');
    const pick = function (st, uid) {
      const i = st.queue[0].candidates.findIndex(function (c) { return c.uid === uid; });
      T.ok(i >= 0, 'unit ' + uid + ' is offered');
      return T.act(st, { type: 'choose', index: i });
    };
    s = pick(s, first.uid);
    T.ok(!SB.findUnit(s, first.uid), 'the first hit killed its target');
    T.eq(s.queue[0] && s.queue[0].step, 'effect', 'the second hit is asking for a target');
    const uids = s.queue[0].candidates.map(function (c) { return c.uid; });
    T.deepEq(uids, [second.uid], 'the other space unit is the one legal target');
    T.ok(uids.indexOf(grounded.uid) < 0, 'the ground unit is not offered');
    s = pick(s, second.uid);
    T.ok(!SB.findUnit(s, second.uid), 'and the 2 damage defeats it (hp 2)');
    T.ok(SB.findUnit(s, grounded.uid), 'the ground unit was never touched');
  });

  T.add("expansion: the opponent, not the hand owner, picks the card discarded by ash-220", function () {
    let s = rich(T.game(), 1);
    T.putInHand(s, 0, "sor-045");
    s = play(s, 1, "ash-220");
    T.eq(s.queue[0].step, "discardChoice", "the pick is pending");
    T.eq(SB.whoActs(s), 1, "the player who played the card acts");
    const acts = SB.legalActions(s);
    T.ok(acts.length > 1 && acts.every(function (a) { return a.player === 1 && a.targetPlayer === 0; }), "every choice is the opponent picking from seat 0's hand");
    s = SB.apply(s, acts[0]);
    T.eq(s.queue.length && s.queue[0].step === "discardChoice" ? 1 : 0, 0, "the pick resolves");
  });

  // ---- new vocabulary: fewerResourcesThanOpponent, opponentControlsNoGroundUnits,
  // hasShield, resourcesOwned, friendlyTraitCount, cantAttackBases, cantReady,
  // minDeckSizeDelta ---------------------------------------------------------

  T.add('expansion: law-202 buffs its attacker when you control fewer resources than an opponent', function () {
    let s = T.game(); const me = 0, foe = 1;
    s.active = me;
    const atk = T.putOnBoard(s, me, 'fx-grunt');
    fund(s, me, 3);
    T.giveResources(s, foe, 10); // strictly more resources than me
    s = play(s, me, 'law-202');
    s = drive(s);
    const u = SB.findUnit(s, atk.uid);
    T.ok(SB.hasKeyword(s, u, 'saboteur'), 'gains Saboteur for the attack');
    T.eq(u.temp.power, 2, 'the +2/+0 bonus applied while behind on resources');
  });

  T.add('expansion: law-202 withholds the stat bonus without fewer resources than an opponent', function () {
    let s = T.game(); const me = 0, foe = 1;
    s.active = me;
    const atk = T.putOnBoard(s, me, 'fx-grunt');
    fund(s, me, 5); fund(s, foe, 5); // tied, not fewer
    s = play(s, me, 'law-202');
    s = drive(s);
    const u = SB.findUnit(s, atk.uid);
    T.ok(SB.hasKeyword(s, u, 'saboteur'), 'still gains Saboteur');
    T.eq(u.temp.power, 0, 'no bonus while not behind on resources');
  });

  T.add('expansion: sec-170 enters play ready only while the opponent controls no ground units', function () {
    let s = rich(T.game(), 0); s.active = 0;
    s = play(s, 0, 'sec-170');
    T.ok(!unitsOf(s, 0, 'sec-170')[0].exhausted, 'ready — the opponent has no ground units');
    let s2 = rich(T.game(), 0); s2.active = 0;
    T.putOnBoard(s2, 1, 'fx-wall');
    s2 = play(s2, 0, 'sec-170');
    T.ok(unitsOf(s2, 0, 'sec-170')[0].exhausted, 'exhausted — the opponent controls a ground unit');
  });

  T.add('expansion: sor-090 deals damage equal to the resources you control', function () {
    SB.cards['fx-tank'] = { id: 'fx-tank', type: 'unit', arena: 'space', cost: 1, power: 0, hp: 20, aspects: ['vigilance'] };
    try {
      let s = rich(T.game(), 0); const me = 0, foe = 1;
      s.active = me;
      fund(s, me, 12);
      const n = s.players[me].resources.length;
      const victim = T.putOnBoard(s, foe, 'fx-tank'); // hp 20: survives any resource count in this test
      s = play(s, me, 'sor-090');
      s = drive(s, function (a) { return a.uid === victim.uid; });
      T.eq(SB.findUnit(s, victim.uid).damage, n, 'damage dealt equals the number of resources controlled');
      const u = unitsOf(s, me, 'sor-090')[0];
      T.ok(SB.hasKeyword(s, u, 'sentinel') && SB.hasKeyword(s, u, 'overwhelm'), 'keeps its printed Sentinel and Overwhelm');
    } finally {
      delete SB.cards['fx-tank'];
    }
  });

  T.add('expansion: jtl-116 deals indirect damage equal to the Vehicle units you control', function () {
    let s = rich(T.game(), 0); const me = 0, foe = 1;
    s.active = me;
    T.putOnBoard(s, me, 'jtl-183'); // a Vehicle already in play (tr46)
    const before = s.players[foe].base.damage;
    s = play(s, me, 'jtl-116'); // itself a Vehicle too: 2 on the board once played
    s = drive(s);
    T.eq(s.players[foe].base.damage - before, 2, 'indirect damage equals the number of friendly Vehicles');
  });

  T.add('expansion: sor-072 stops its bearer from attacking a base', function () {
    let s = T.game(); const me = 0;
    const bearer = T.putOnBoard(s, me, 'fx-grunt');
    bearer.upgrades.push({ uid: s.nextUid++, cardId: 'sor-072', owner: me });
    T.ok(!SB.attackTargets(s, bearer).some(function (t) { return t.kind === 'base'; }), 'no base among its attack targets');
    T.ok(SB.unitHasGrantedStaticFlag(s, bearer, 'cantAttackBases'), 'the flag is picked up from the upgrade');
  });

  T.add('expansion: a unit with cantReady is skipped when units ready at regroup', function () {
    SB.cards['fx-frozen'] = { id: 'fx-frozen', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1,
      aspects: ['vigilance'], staticFlags: ['cantReady'] };
    try {
      let s = T.game('fixtureA', 'fixtureB', 'cantready'); const me = 0;
      const u = T.putOnBoard(s, me, 'fx-frozen', { exhausted: true });
      const other = T.putOnBoard(s, me, 'fx-grunt', { exhausted: true });
      s = T.act(s, { type: 'pass' });
      s = T.act(s, { type: 'pass' }); // pass/pass ends the round
      s = drive(s); // resolve the regroup resource picks, which trigger the ready step
      T.ok(SB.findUnit(s, u.uid).exhausted, 'cantReady unit stayed exhausted through regroup');
      T.ok(!SB.findUnit(s, other.uid).exhausted, 'an ordinary unit readied normally');
    } finally {
      delete SB.cards['fx-frozen'];
    }
  });

  T.add('expansion: a shield-selector filter (hasShield) keeps only shielded candidates', function () {
    let s = T.game(); const me = 0;
    const shielded = T.putOnBoard(s, me, 'fx-grunt', { shields: 1 });
    const bare = T.putOnBoard(s, me, 'fx-wall');
    const cands = SB.selectorCandidates(s, me, { who: 'friendly', what: 'unit', hasShield: true }, {});
    T.ok(cands.some(function (c) { return c.uid === shielded.uid; }), 'the shielded unit is a candidate');
    T.ok(!cands.some(function (c) { return c.uid === bare.uid; }), 'the unshielded unit is filtered out');
  });

  T.add('expansion: chooseTwoModes resolves two modes fully, in the order picked', function () {
    SB.cards['fx-choose4'] = { id: 'fx-choose4', type: 'event', cost: 0, aspects: [],
      abilities: [{ trigger: 'onPlay', effects: [{ op: 'chooseTwoModes', count: 2, modes: [
        { effects: [{ op: 'experience', amount: 2, target: { who: 'friendly', what: 'unit' } }] },
        { effects: [{ op: 'shield', amount: 1, target: { who: 'friendly', what: 'unit' } }] },
        { effects: [{ op: 'draw', amount: 1 }] },
        { effects: [{ op: 'healBase', amount: 2 }] },
      ] }] }] };
    try {
      let s = T.game(); const me = 0;
      const u = T.putOnBoard(s, me, 'fx-grunt');
      s.players[me].base.damage = 5;
      s = play(s, me, 'fx-choose4');
      // Pick mode index 3 (heal base) first, then mode index 1 (shield) second — one
      // explicit SB.apply per pick, since drive() would otherwise keep going and take
      // the second pick for us too.
      let acts = SB.legalActions(s);
      s = SB.apply(s, acts.find(function (a) { return a.type === 'chooseMode' && a.index === 3; }));
      acts = SB.legalActions(s);
      s = SB.apply(s, acts.find(function (a) { return a.type === 'chooseMode' && a.index === 1; }));
      s = drive(s);
      T.eq(s.players[me].base.damage, 3, 'the heal-base mode resolved');
      T.eq(SB.findUnit(s, u.uid).shields, 1, 'the shield mode also resolved');
      T.eq(SB.findUnit(s, u.uid).experience, 0, 'the un-picked modes did not resolve');
      T.eq(s.queue.length, 0, 'the whole choice settled — nothing left hanging');
    } finally {
      delete SB.cards['fx-choose4'];
    }
  });

  T.add('expansion: chooseTwoModes still offers a mode with no legal target — it fizzles instead of hanging', function () {
    SB.cards['fx-choose4b'] = { id: 'fx-choose4b', type: 'event', cost: 0, aspects: [],
      abilities: [{ trigger: 'onPlay', effects: [{ op: 'chooseTwoModes', count: 2, modes: [
        { effects: [{ op: 'defeat', target: { who: 'enemy', what: 'unit' } }] }, // no enemy units exist
        { effects: [{ op: 'draw', amount: 1 }] },
        { effects: [{ op: 'draw', amount: 1 }] },
      ] }] }] };
    try {
      let s = T.game(); const me = 0;
      const handBefore = s.players[me].hand.length;
      s = play(s, me, 'fx-choose4b');
      const before = s.players[me].hand.length; // after playing the card itself
      let acts = SB.legalActions(s);
      s = SB.apply(s, acts.find(function (a) { return a.type === 'chooseMode' && a.index === 0; }));
      acts = SB.legalActions(s);
      s = SB.apply(s, acts.find(function (a) { return a.type === 'chooseMode' && a.index === 1; }));
      s = drive(s);
      T.eq(s.queue.length, 0, 'the empty-target mode did not hang the queue');
      T.eq(s.players[me].hand.length, before + 1, 'the drawn card from the second mode arrived');
      T.ok(handBefore >= 0, 'sanity');
    } finally {
      delete SB.cards['fx-choose4b'];
    }
  });

  T.add('expansion: defeatShieldsOn clears every shield, then a chained op can still hit the same unit (jtl-180)', function () {
    let s = rich(T.game(), 0); const me = 0, foe = 1;
    s.active = me;
    const victim = T.putOnBoard(s, foe, 'fx-wall', { shields: 2 });
    s = play(s, me, 'jtl-180');
    s = drive(s, function (a) { return a.type === 'choose' && s.queue[0].candidates[a.index].uid === victim.uid; });
    const u = SB.findUnit(s, victim.uid);
    T.eq(u.shields, 0, 'both shields defeated');
    T.eq(u.damage, 3, 'then took 3 damage on the same, now-unshielded unit');
  });

  T.add('expansion: a notUpgraded selector filter keeps only bare units (jtl-080)', function () {
    let s = rich(T.game(), 0); const me = 0, foe = 1;
    s.active = me;
    const bare = T.putOnBoard(s, foe, 'fx-grunt');
    const dressed = T.putOnBoard(s, foe, 'fx-wall');
    dressed.upgrades.push({ uid: s.nextUid++, cardId: 'sor-072', owner: foe });
    const mine = T.putOnBoard(s, me, 'fx-flyer');
    s = play(s, me, 'jtl-080');
    s = drive(s);
    T.ok(!SB.findUnit(s, bare.uid), 'the un-upgraded enemy unit was defeated');
    T.ok(SB.findUnit(s, dressed.uid), 'the upgraded enemy unit survived');
    T.ok(!SB.findUnit(s, mine.uid), 'the un-upgraded friendly unit was defeated too — "each unit"');
  });

  T.add('expansion: mill with who:"opponent" discards from the opponent\'s deck, not your own', function () {
    let s = T.game(); const me = 0, foe = 1;
    const myDeckBefore = s.players[me].deck.length;
    const foeDeckBefore = s.players[foe].deck.length;
    SB.queueEffects(s, me, [{ op: 'mill', who: 'opponent', amount: 6 }], {});
    SB.drainQueue(s);
    T.eq(s.players[foe].deck.length, foeDeckBefore - 6, 'six cards left the opponent\'s deck');
    T.eq(s.players[me].deck.length, myDeckBefore, 'your own deck is untouched');
  });

  T.add('expansion: exhaustUpTo exhausts at most N units and can stop early', function () {
    let s = T.game(); const me = 0;
    const a = T.putOnBoard(s, me, 'fx-grunt');
    const b = T.putOnBoard(s, me, 'fx-wall');
    const c = T.putOnBoard(s, me, 'fx-flyer');
    SB.queueEffects(s, me, [{ op: 'exhaustUpTo', amount: 2 }], {});
    SB.drainQueue(s);
    let acts = SB.legalActions(s);
    T.ok(acts.some(function (x) { return x.type === 'exhaustUpTo' && x.uid == null; }), 'stopping is offered');
    s = SB.apply(s, acts.find(function (x) { return x.type === 'exhaustUpTo' && x.uid === a.uid; }));
    acts = SB.legalActions(s);
    s = SB.apply(s, acts.find(function (x) { return x.type === 'exhaustUpTo' && x.uid === b.uid; }));
    T.eq(s.queue.length, 0, 'after 2 picks the step ends on its own — no forced third pick');
    T.ok(SB.findUnit(s, a.uid).exhausted && SB.findUnit(s, b.uid).exhausted, 'both chosen units exhausted');
    T.ok(!SB.findUnit(s, c.uid).exhausted, 'the third unit was left alone');
  });

  T.add('expansion: minDeckSizeDelta raises a deck’s minimum size (jtl-024)', function () {
    T.eq(SB.card('jtl-024').minDeckSizeDelta, 10, 'jtl-024 carries the +10 delta');
    SB.decks['fx-shortdeck'] = { leader: 'law-010', base: 'jtl-024', format: 'premier',
      cards: (function () { const a = []; for (let i = 0; i < 59; i++) a.push('law-041'); return a; })() };
    try {
      T.throws(function () { SB.validateContent(); }, 'a 59-card deck fails the 60-card minimum a jtl-024 base imposes');
    } finally {
      delete SB.decks['fx-shortdeck'];
      SB.validateContent(); // restore a clean world for tests that follow
    }
  });

  // ==== tournament cluster c2 (js/ops2.js additions) ==========================

  T.add('expansion c2: a unit\'s power/hp scale with resources controlled, and it keeps Sentinel only while undamaged (ts26-050)', function () {
    SB.cards['fx-c2res'] = { id: 'fx-c2res', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: ['command'],
      abilities: [
        { trigger: 'constant', scope: { self: true }, grant: { dynamicStat: 'resourcesOwned', dynamicPowerPer: 1, dynamicHpPer: 1 } },
        { trigger: 'constant', scope: { self: true }, grant: { keywords: [{ k: 'sentinel' }] }, condition: { if: 'selfDamaged', not: true } },
      ] };
    try {
      let s = T.game(); const me = 0;
      T.giveResources(s, me, 3);
      const u = T.putOnBoard(s, me, 'fx-c2res');
      const n = s.players[me].resources.length; // T.game() already resources a few cards during setup
      T.eq(SB.unitPower(s, u), 1 + n, 'power is base 1 plus the resources controlled');
      T.eq(SB.unitMaxHp(s, u), 1 + n, 'hp scales the same way');
      T.ok(SB.hasKeyword(s, u, 'sentinel'), 'undamaged: gains Sentinel');
      u.damage = 1;
      T.ok(!SB.hasKeyword(s, u, 'sentinel'), 'damaged: loses Sentinel');
    } finally { delete SB.cards['fx-c2res']; }
  });

  T.add('expansion c2: "When you use the Force" fires only when a power token is actually spent, not on a fizzled attempt (lof-101)', function () {
    SB.cards['fx-c2force'] = { id: 'fx-c2force', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: ['command'],
      abilities: [{ trigger: 'onUseForce', effects: [{ op: 'draw', amount: 1 }] }] };
    try {
      let s = T.game(); const me = 0;
      const u = T.putOnBoard(s, me, 'fx-c2force');
      const before = s.players[me].hand.length;
      SB.queueEffects(s, me, [{ op: 'useForce' }], { sourceUid: u.uid });
      SB.drainQueue(s);
      T.eq(s.players[me].hand.length, before, 'no power token held — useForce fizzles and the trigger does not fire');
      s.players[me].force = true;
      SB.queueEffects(s, me, [{ op: 'useForce' }], { sourceUid: u.uid });
      SB.drainQueue(s);
      T.eq(s.players[me].hand.length, before + 1, 'spending an actual power token fires the trigger');
    } finally { delete SB.cards['fx-c2force']; }
  });

  T.add('expansion c2: a "When Defeated" ability can read/gate on this unit\'s power after it has already left play (sec-035, jtl-104)', function () {
    SB.cards['fx-c2ret7'] = { id: 'fx-c2ret7', type: 'unit', arena: 'ground', cost: 1, power: 7, hp: 1, aspects: ['command'],
      abilities: [{ trigger: 'whenDefeated', condition: { if: 'selfPowerWasAtLeast', n: 7 }, effects: [{ op: 'selfDefeatedToHand' }] }] };
    SB.cards['fx-c2ret3'] = { id: 'fx-c2ret3', type: 'unit', arena: 'ground', cost: 1, power: 3, hp: 1, aspects: ['command'],
      abilities: [{ trigger: 'whenDefeated', condition: { if: 'selfPowerWasAtLeast', n: 7 }, effects: [{ op: 'selfDefeatedToHand' }] }] };
    SB.cards['fx-c2dmg'] = { id: 'fx-c2dmg', type: 'unit', arena: 'ground', cost: 1, power: 5, hp: 1, aspects: ['command'],
      abilities: [{ trigger: 'whenDefeated', effects: [{ op: 'damage', amount: 0, amountRef: 'powerOfDefeatedSource', target: { who: 'any', what: 'unit' } }] }] };
    try {
      let s = T.game(); const me = 0, foe = 1;
      const strong = T.putOnBoard(s, me, 'fx-c2ret7');
      const weak = T.putOnBoard(s, me, 'fx-c2ret3');
      SB.defeatUnit(s, strong, {}); SB.drainQueue(s);
      SB.defeatUnit(s, weak, {}); SB.drainQueue(s);
      T.ok(s.players[me].hand.some(function (i) { return i.cardId === 'fx-c2ret7'; }), 'the 7-power unit returned to hand');
      T.ok(!s.players[me].hand.some(function (i) { return i.cardId === 'fx-c2ret3'; }), 'the 3-power unit did not qualify');
      T.ok(s.players[me].discard.some(function (i) { return i.cardId === 'fx-c2ret3'; }), 'it stayed in the discard pile instead');

      const attacker = T.putOnBoard(s, me, 'fx-c2dmg');
      const victim = T.putOnBoard(s, foe, 'fx-gritty'); // hp 6, survives 5 damage
      SB.defeatUnit(s, attacker, {});
      SB.drainQueue(s);
      s = drive(s, function (a) { return a.type === 'choose' && s.queue[0].candidates[a.index].uid === victim.uid; });
      T.eq(SB.findUnit(s, victim.uid).damage, 5, 'the damage equals the defeated unit’s power, read from the snapshot');
    } finally { delete SB.cards['fx-c2ret7']; delete SB.cards['fx-c2ret3']; delete SB.cards['fx-c2dmg']; }
  });

  T.add('expansion c2: "control another <trait> card (unit, upgrade, or leader)" checks every zone in play, not just units (jtl-104)', function () {
    SB.cards['fx-c2sentinel'] = { id: 'fx-c2sentinel', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: ['command'],
      abilities: [{ trigger: 'constant', scope: { self: true }, grant: { keywords: [{ k: 'sentinel' }] },
        condition: { if: 'controlsTraitCardAnywhere', trait: 'tr50' } }] };
    SB.cards['fx-c2trup'] = { id: 'fx-c2trup', type: 'upgrade', cost: 1, aspects: [], traits: ['tr50'] };
    try {
      let s = T.game(); const me = 0;
      const u = T.putOnBoard(s, me, 'fx-c2sentinel');
      const other = T.putOnBoard(s, me, 'fx-wall');
      T.ok(!SB.hasKeyword(s, u, 'sentinel'), 'no matching card anywhere yet');
      other.upgrades.push({ uid: s.nextUid++, cardId: 'fx-c2trup', owner: me });
      T.ok(SB.hasKeyword(s, u, 'sentinel'), 'an upgrade of the trait, on ANOTHER unit, satisfies it — not just units in play');
    } finally { delete SB.cards['fx-c2sentinel']; delete SB.cards['fx-c2trup']; }
  });

  T.add('expansion c2: "while an opponent controls a unit of trait X" reads the opponent\'s board, not your own (lof-118)', function () {
    SB.cards['fx-c2amb'] = { id: 'fx-c2amb', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: ['command'],
      abilities: [{ trigger: 'constant', scope: { self: true }, grant: { keywords: [{ k: 'ambush' }] },
        condition: { if: 'opponentControlsUnitWithTrait', trait: 'tr12' } }] };
    SB.cards['fx-c2forceunit'] = { id: 'fx-c2forceunit', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: ['command'], traits: ['tr12'] };
    try {
      let s = T.game(); const me = 0, foe = 1;
      const u = T.putOnBoard(s, me, 'fx-c2amb');
      T.ok(!SB.hasKeyword(s, u, 'ambush'), 'opponent controls no Force unit yet');
      T.putOnBoard(s, me, 'fx-c2forceunit'); // one of my own — should NOT satisfy "an opponent controls"
      T.ok(!SB.hasKeyword(s, u, 'ambush'), 'a Force unit under my own control does not count');
      T.putOnBoard(s, foe, 'fx-c2forceunit');
      T.ok(SB.hasKeyword(s, u, 'ambush'), 'now the opponent controls one — Ambush granted');
    } finally { delete SB.cards['fx-c2amb']; delete SB.cards['fx-c2forceunit']; }
  });

  T.add('expansion c2: an amountRef counting enemy units defeated this phase (sec-035)', function () {
    let s = rich(T.game(), 0); const me = 0, foe = 1;
    const a = T.putOnBoard(s, foe, 'fx-grunt');
    const b = T.putOnBoard(s, foe, 'fx-wall');
    const mine = T.putOnBoard(s, me, 'fx-flyer');
    SB.defeatUnit(s, a, {});
    SB.defeatUnit(s, mine, {}); // a friendly defeat should NOT count
    SB.defeatUnit(s, b, {});
    const c = T.putOnBoard(s, me, 'fx-flyer');
    SB.queueEffects(s, me, [{ op: 'experience', amountRef: 'enemyDefeatedThisPhaseCount', target: { who: 'any', what: 'unit' } }], {});
    SB.drainQueue(s);
    s = drive(s, function (a) { return a.type === 'choose' && s.queue[0].candidates[a.index].uid === c.uid; });
    T.eq(SB.findUnit(s, c.uid).experience, 2, 'counts only the 2 enemy units defeated this phase, not the friendly one');
  });

  T.add('expansion c2: an amountRef equal to twice the number of units controlled (lof-101)', function () {
    let s = T.game(); const me = 0, foe = 1;
    T.putOnBoard(s, me, 'fx-grunt'); // 1 friendly unit controlled -> 2x = 2
    const victim = T.putOnBoard(s, foe, 'fx-wall'); // hp 5, survives 2 damage
    SB.queueEffects(s, me, [{ op: 'damage', amountRef: 'doubleControlledUnits', target: { who: 'any', what: 'unit' } }], {});
    SB.drainQueue(s);
    s = drive(s, function (a) { return a.type === 'choose' && s.queue[0].candidates[a.index].uid === victim.uid; });
    T.eq(SB.findUnit(s, victim.uid).damage, 2, 'twice the 1 unit controlled');
  });

  T.add('expansion c2: returning a unit remembers its cost for a follow-up op, even after it leaves play (ash-038)', function () {
    let s = T.game(); const me = 0, foe = 1;
    const returned = T.putOnBoard(s, me, 'jtl-183'); // a real costed card, not a token/fixture
    const cost = SB.costOf('jtl-183');
    const victim = T.putOnBoard(s, foe, 'fx-wall'); // hp 5, survives the 2 damage
    SB.queueEffects(s, me, [
      { op: 'returnHandSaveCost', target: { who: 'friendly', what: 'unit' }, saveCostAs: 'rc' },
      { op: 'damage', target: { who: 'any', what: 'unit' }, amountRef: 'stored:rc' },
    ], {});
    SB.drainQueue(s);
    s = drive(s, function (a) {
      return a.type === 'choose' && s.queue[0].candidates &&
        (s.queue[0].candidates[a.index].uid === returned.uid || s.queue[0].candidates[a.index].uid === victim.uid);
    });
    T.ok(!SB.findUnit(s, returned.uid), 'the unit went back to hand');
    T.ok(s.players[me].hand.some(function (i) { return i.uid === returned.uid; }), 'confirm it is in hand');
    T.eq(SB.findUnit(s, victim.uid).damage, cost, 'damage equals the returned unit’s printed cost');
  });

  T.add('expansion c2: paying resources one at a time onto a chosen (non-self) unit, each one an experience token (sec-040)', function () {
    let s = rich(T.game(), 0); const me = 0;
    const before = SB.readyResources(s, me);
    const chosen = T.putOnBoard(s, me, 'fx-wall');
    SB.queueEffects(s, me, [{ op: 'payForExperienceOn', target: { who: 'any', what: 'unit', nonLeader: true } }], {});
    SB.drainQueue(s);
    let acts = SB.legalActions(s);
    s = SB.apply(s, acts.find(function (a) { return a.type === 'payXpTargetPick' && a.uid === chosen.uid; }));
    // Pay twice, then stop.
    for (let i = 0; i < 2; i++) {
      acts = SB.legalActions(s);
      s = SB.apply(s, acts.find(function (a) { return a.type === 'payXp' && a.pay; }));
    }
    acts = SB.legalActions(s);
    s = SB.apply(s, acts.find(function (a) { return a.type === 'payXp' && !a.pay; }));
    T.eq(SB.findUnit(s, chosen.uid).experience, 2, 'two resources paid, two experience tokens on the chosen unit');
    T.eq(SB.readyResources(s, me), before - 2, 'two resources were spent');
  });

  // ---- cluster-c3: eight tournament cards whose triggers didn't exist yet -------

  T.add('cluster-c3: onOwnDraw fires when you draw during the action phase, not on an opponent draw (law-052)', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    rich(s, foe);
    const u = T.putOnBoard(s, me, 'law-052');
    s = play(s, me, 'fx-supply'); // draws 2 for me
    T.eq(SB.findUnit(s, u.uid).shields, 1, 'shielded once for my own draw event, regardless of card count');
    s = play(s, foe, 'fx-supply'); // draws 2 for the opponent instead
    T.eq(SB.findUnit(s, u.uid).shields, 1, 'no shield from an opponent draw');
  });

  T.add('cluster-c3: onDeckDiscard fires only for a discard from the deck, not the hand, once per round (law-176)', function () {
    let s = T.game(); const me = 0;
    const u = T.putOnBoard(s, me, 'law-176', { exhausted: true });
    SB.queueEffects(s, me, [{ op: 'discard', who: 'self' }], {}); // discard from HAND
    SB.drainQueue(s);
    s = drive(s);
    T.ok(SB.findUnit(s, u.uid).exhausted, 'a hand discard does not ready it');
    SB.queueEffects(s, me, [{ op: 'mill', amount: 1 }], {}); // discard from DECK
    SB.drainQueue(s);
    s = drive(s, function (a) { return a.type === 'binary' && a.pick === 'a'; });
    T.ok(!SB.findUnit(s, u.uid).exhausted, 'readied after a deck discard');
    SB.findUnit(s, u.uid).exhausted = true;
    SB.queueEffects(s, me, [{ op: 'mill', amount: 1 }], {});
    SB.drainQueue(s);
    s = drive(s, function (a) { return a.type === 'binary' && a.pick === 'a'; });
    T.ok(SB.findUnit(s, u.uid).exhausted, 'once per round: a second deck discard does nothing more');
  });

  T.add('cluster-c3: law-053 gains a credit only when the defeated enemy unit was the highest-cost enemy, once per round', function () {
    let s = T.game(); const me = 0, foe = 1;
    T.putOnBoard(s, me, 'law-053');
    const grunt = T.putOnBoard(s, foe, 'fx-grunt');   // cost 1
    const brute1 = T.putOnBoard(s, foe, 'fx-brute');  // cost 4
    const brute2 = T.putOnBoard(s, foe, 'fx-brute');  // cost 4 — tied for highest
    SB.defeatUnit(s, SB.findUnit(s, grunt.uid), {});
    SB.drainQueue(s);
    T.eq(s.players[me].credits || 0, 0, 'the cheapest enemy unit dying pays nothing');
    SB.defeatUnit(s, SB.findUnit(s, brute1.uid), {});
    SB.drainQueue(s);
    T.eq(s.players[me].credits || 0, 1, 'the (tied) highest-cost enemy unit dying pays a credit');
    SB.defeatUnit(s, SB.findUnit(s, brute2.uid), {});
    SB.drainQueue(s);
    T.eq(s.players[me].credits || 0, 1, 'once per round: a second highest-cost death this round pays nothing more');
  });

  T.add('cluster-c3: lof-142 hits the enemy base only when they play an event, not a unit (playedType filter)', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    rich(s, foe);
    T.putOnBoard(s, me, 'lof-142');
    const fodder = T.putOnBoard(s, foe, 'fx-grunt'); // fx-bolt's own damage lands here, not the base
    const before = s.players[foe].base.damage;
    s = play(s, foe, 'fx-bolt', {}); // an event
    // Aim fx-bolt's own damage at the spare unit, not the base, so the base-damage
    // count below isolates lof-142's observer effect.
    const idx = s.queue[0].candidates.findIndex(function (c) { return c.kind === 'unit' && c.uid === fodder.uid; });
    s = SB.apply(s, SB.legalActions(s).find(function (a) { return a.type === 'choose' && a.index === idx; }));
    T.eq(s.players[foe].base.damage, before + 1, 'the observer added exactly 1 base damage for the event');
    T.ok(!SB.findUnit(s, fodder.uid), 'fx-bolt\'s own 3 damage defeated the spare unit, confirming it took the hit, not the base');
    const baseAfterEvent = s.players[foe].base.damage;
    s = play(s, foe, 'fx-grunt'); // a unit, not an event
    T.eq(s.players[foe].base.damage, baseAfterEvent, 'no extra base damage from a unit play');
  });

  T.add('cluster-c3: ash-204 gains Advantage from any damage to your base, not only combat (onBaseDamaged)', function () {
    let s = T.game(); const me = 0;
    const u = T.putOnBoard(s, me, 'ash-204');
    SB.damageBase(s, me, 2, 'indirect');
    SB.drainQueue(s);
    T.eq(u.advantage || 0, 1, 'non-combat damage to the base still gives the unit Advantage');
  });

  T.add('cluster-c3: jtl-186 may draw on attack only after playing a Bounty Hunter or Pilot card this phase', function () {
    let s = T.game(); s.active = 0; const me = 0, foe = 1;
    const u = T.putOnBoard(s, me, 'jtl-186');
    const deckBefore = s.players[me].deck.length;
    s = T.act(s, { type: 'attack', attacker: u.uid, target: { kind: 'base', player: foe } });
    T.eq(s.queue.length, 0, 'nothing played this phase: the ability does not even offer a choice');
    T.eq(s.players[me].deck.length, deckBefore, 'no draw happened');

    let s2 = rich(T.game(), 0); s2.active = 0;
    s2 = play(s2, me, 'shd-254'); // trait tr03 (Bounty Hunter)
    s2.active = me; // a play passes the turn; take it back for the attack below
    const u2 = T.putOnBoard(s2, me, 'jtl-186');
    const deckBefore2 = s2.players[me].deck.length;
    s2 = T.act(s2, { type: 'attack', attacker: u2.uid, target: { kind: 'base', player: foe } });
    s2 = drive(s2, function (a) { return a.type === 'binary' && a.pick === 'a'; });
    T.eq(s2.players[me].deck.length, deckBefore2 - 1, 'drew a card after playing a Bounty Hunter card this phase');
  });

  T.add('cluster-c3: law-076 shields itself on play only if you discarded a card (hand or deck) this phase', function () {
    let s = T.game(); const me = 0;
    const u1 = T.putOnBoard(s, me, 'law-076');
    T.eq(u1.shields || 0, 0, 'putOnBoard bypasses onPlay entirely — sanity check');
    let s2 = rich(T.game(), 0); s2.active = 0;
    SB.queueEffects(s2, me, [{ op: 'mill', amount: 1 }], {}); // a deck discard this phase
    SB.drainQueue(s2);
    s2 = play(s2, me, 'law-076');
    const u2 = unitsOf(s2, me, 'law-076')[0];
    T.eq(u2.shields, 1, 'shielded: a card was discarded from the deck this phase');
  });

  T.add('cluster-c3: jtl-223 may return a cheap or exhausted unit to hand when a Pilot attaches to it', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const bearer = T.putOnBoard(s, me, 'jtl-223'); // trait tr46 (Vehicle), no pilot yet
    const cheap = T.putOnBoard(s, foe, 'fx-grunt'); // cost 1: qualifies even while ready
    T.putInHand(s, me, 'jtl-057'); // cost 1, keyword piloting (trait tr30)
    s = T.act(s, { type: 'playCard', cardId: 'jtl-057', asPilot: true, attachTo: bearer.uid });
    T.ok(SB.hasPilot(s, SB.findUnit(s, bearer.uid)), 'the pilot attached');
    s = drive(s);
    T.ok(!SB.findUnit(s, cheap.uid), 'the cheap unit left play');
    T.ok(s.players[foe].hand.some(function (inst) { return inst.cardId === 'fx-grunt'; }), 'it went back to its owner\'s hand');
  });

  // ---- cluster-c5 expansion ----------------------------------------------

  T.add('cluster-c5: shd-094 discounts a Force unit 8, any other unit only 6', function () {
    let s = T.game(); const me = 0;
    // Fund exactly the event's real cost (aspect penalties may raise it above the
    // printed 6) plus 1 resource left over, to tell the two discount branches apart.
    fund(s, me, SB.cardCost(s, me, 'shd-094') + 1);
    s.players[me].discard.push({ uid: s.nextUid++, cardId: 'law-149' }); // Force (tr12), cost 8, no aspect penalty here
    s.players[me].discard.push({ uid: s.nextUid++, cardId: 'ash-179' }); // not Force, cost 8, no aspect penalty here
    s = play(s, me, 'shd-094');
    const acts = SB.legalActions(s);
    T.ok(acts.some(function (a) { return a.type === 'playHandCard' && a.cardId === 'law-149'; }),
      'the Force unit is playable at 1 resource left (8 off)');
    T.ok(!acts.some(function (a) { return a.type === 'playHandCard' && a.cardId === 'ash-179'; }),
      'the non-Force unit is not playable at 1 resource left (only 6 off)');
  });

  T.add('cluster-c5: sor-183 may return an event from either discard pile to its owner\'s hand', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    s.players[foe].discard.push({ uid: s.nextUid++, cardId: 'fx-bolt' }); // opponent's event
    s = play(s, me, 'sor-183');
    s = T.act(s, { type: 'returnEventCard', owner: foe, index: 0 });
    T.ok(s.players[foe].hand.some(function (inst) { return inst.cardId === 'fx-bolt'; }), 'the event returned to its owner\'s hand, not the caster\'s');
  });

  T.add('cluster-c5: shd-207 returns a unit then its owner may replay it for free', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const g = T.putOnBoard(s, foe, 'fx-grunt'); // cost 1, qualifies (<=6)
    const before = SB.readyResources(s, foe);
    s = play(s, me, 'shd-207');
    // The only legal target auto-resolves (a mandatory return with one candidate) —
    // the queue head is already the owner's "play it free?" choice.
    s = T.act(s, { type: 'returnReplay', play: true });
    const reborn = unitsOf(s, foe, 'fx-grunt')[0];
    T.ok(reborn, 'the unit came back under its owner\'s control');
    T.eq(SB.readyResources(s, foe), before, 'replayed for free — no resources spent');
  });

  T.add('cluster-c5: law-093 returns a cheap unit, replays it free, and it gains Shielded for the phase', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const g = T.putOnBoard(s, foe, 'fx-grunt'); // cost 1 (<=3)
    s = play(s, me, 'law-093');
    // The choose step picks the unit (only candidate); the drive then falls through
    // to the "play it free?" step and takes its first offered action, which is play:true.
    s = drive(s, function (a) {
      return a.type === 'choose' && s.queue[0].candidates && s.queue[0].candidates[a.index] && s.queue[0].candidates[a.index].uid === g.uid;
    }, 2);
    const reborn = unitsOf(s, foe, 'fx-grunt')[0];
    T.ok(SB.hasKeyword(s, reborn, 'shielded'), 'the replayed unit gained Shielded for this phase');
  });

  T.add('cluster-c5: law-096 lets each player pull a unit before defeating everything left', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const mine = T.putOnBoard(s, me, 'fx-grunt');
    const theirs = T.putOnBoard(s, foe, 'fx-wall');
    const spared = T.putOnBoard(s, foe, 'fx-flyer');
    s = play(s, me, 'law-096');
    // Active player returns `theirs` (an enemy unit is a legal choice), opponent returns `spared`.
    s = T.act(s, { type: 'mutualReturn', uid: theirs.uid });
    s = T.act(s, { type: 'mutualReturn', uid: spared.uid });
    T.ok(s.players[foe].hand.some(function (inst) { return inst.cardId === 'fx-wall'; }), 'the returned enemy unit went to its own owner\'s hand');
    T.ok(s.players[foe].hand.some(function (inst) { return inst.cardId === 'fx-flyer'; }), 'the second returned unit also went home');
    T.ok(!SB.findUnit(s, mine.uid), 'every remaining non-leader unit was defeated, including the caster\'s own');
  });

  T.add('cluster-c5: sor-052 heals a budget spread across units/bases then hits itself for the total', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const dmg1 = T.putOnBoard(s, me, 'fx-wall', { damage: 3 });
    s.players[me].base.damage = 4;
    s = play(s, me, 'sor-052');
    s = drive(s, function (a) { return a.type === 'healBudgetPoint' && a.kind === 'unit' && a.uid === dmg1.uid; }, 3);
    s = drive(s, function (a) { return a.type === 'healBudgetPoint' && a.kind === 'base'; }, 4);
    s = T.act(s, { type: 'healBudgetPoint', kind: 'stop' });
    const src = unitsOf(s, me, 'sor-052')[0];
    T.eq(SB.findUnit(s, dmg1.uid).damage, 0, 'the wall was fully healed');
    T.eq(s.players[me].base.damage, 0, 'the base was fully healed');
    T.eq(src.damage, 7, 'sor-052 took damage equal to the 7 total it healed');
  });

  T.add('cluster-c5: sec-073 taxes each enemy unit at the start of the next action phase', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const enemy = T.putOnBoard(s, foe, 'fx-grunt');
    s = play(s, me, 'sec-073');
    s = T.act(s, { type: 'pass' }); s = T.act(s, { type: 'pass' });
    // Walk the regroup phase (both players decline to resource) up to, but not past,
    // the tax choice the next action phase arms.
    let guard = 0;
    while (s.queue.length > 0 && s.queue[0].step !== 'payOrExhaustPick' && guard++ < 10) {
      s = T.act(s, { type: 'resourceCard', handIndex: -1 });
    }
    const acts = SB.legalActions(s);
    T.ok(acts.some(function (a) { return a.type === 'payOrExhaust' && a.uid === enemy.uid; }), 'the enemy unit must now pay or exhaust');
    s = T.act(s, { type: 'payOrExhaust', uid: enemy.uid, pay: false });
    T.ok(SB.findUnit(s, enemy.uid).exhausted, 'declining payment exhausts the unit');
  });

  T.add('cluster-c5: shd-090 redirects this attack\'s retaliation damage to a chosen friendly Underworld unit', function () {
    let s = T.game(); const me = 0, foe = 1;
    const atk = T.putOnBoard(s, me, 'shd-090'); atk.exhausted = false;
    const guard = T.putOnBoard(s, me, 'sor-183'); // another friendly Underworld (tr45) unit
    const defender = T.putOnBoard(s, foe, 'fx-wall'); // power 1
    s = T.act(s, { type: 'attack', attacker: atk.uid, target: { kind: 'unit', uid: defender.uid } });
    s = drive(s, function (a) { return a.type === 'choose' && a.index >= 0; });
    T.eq(SB.findUnit(s, atk.uid).damage, 0, 'the attacker took no damage');
    T.eq(SB.findUnit(s, guard.uid).damage, 1, 'the chosen friendly unit took the retaliation damage instead');
  });

  T.add('cluster-c5: sec-157 buffs an attack, grants Overwhelm, and strips the defender\'s abilities for it', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const atk = T.putOnBoard(s, me, 'fx-grunt'); atk.exhausted = false; // power 2
    // twi-083 normally creates a token when attacked; with abilities suppressed for
    // this attack, that "whenAttacked" ability must not fire.
    const defender = T.putOnBoard(s, foe, 'twi-083'); // power 4, hp 4
    s = play(s, me, 'sec-157');
    s = T.act(s, { type: 'effectAttack', target: { kind: 'unit', uid: defender.uid } });
    T.eq(SB.allUnits(s, foe).filter(function (u) { return u.cardId === 'tok-gv1'; }).length, 0,
      'the defender\'s whenAttacked ability was suppressed — no token created');
    const survivor = SB.findUnit(s, defender.uid);
    T.ok(survivor && !survivor.abilitiesSuppressedForAttack, 'the suppression clears once the attack it named is over');
  });

  T.add('cluster-c5: sor-252 bottoms up to 4 chosen cards from a single discard pile', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const before = s.players[me].deck.length;
    s.players[me].discard.push({ uid: s.nextUid++, cardId: 'fx-bolt' }, { uid: s.nextUid++, cardId: 'fx-supply' });
    s = play(s, me, 'sor-252');
    s = T.act(s, { type: 'bottomDiscard', owner: me, index: 0 });
    s = T.act(s, { type: 'bottomDiscard', owner: me, index: 0 });
    s = T.act(s, { type: 'bottomDiscard', index: -1 });
    T.eq(s.players[me].deck.length, before + 2, 'both chosen cards landed on the bottom of the deck');
    T.eq(s.players[me].discard.filter(function (i) { return i.cardId === 'fx-bolt' || i.cardId === 'fx-supply'; }).length, 0, 'they left the discard pile');
  });

  T.add('cluster-c5: jtl-164 may resource the top card only while an opponent controls more resources', function () {
    let s = T.game(); const me = 0, foe = 1;
    fund(s, me, 4); fund(s, foe, 6); // opponent now clearly controls more resources
    const deckTop = s.players[me].deck[0].cardId;
    s = play(s, me, 'jtl-164');
    s = drive(s, function (a) { return a.type === 'binary' && a.pick === 'a'; });
    T.ok(s.players[me].resources.some(function (r) { return r.instance.cardId === deckTop; }), 'the top card became a resource');
  });

  // ---- shd-109: reveal resources, play every unit revealed for free ---------

  T.add('shd-109: a unit revealed from resources is played for free, a non-unit revealed stays a resource', function () {
    let s = T.game(); const me = 0;
    fund(s, me, SB.cardCost(s, me, 'shd-109'));
    const grunt = { uid: s.nextUid++, cardId: 'fx-grunt' }; // unit
    const bolt = { uid: s.nextUid++, cardId: 'fx-bolt' }; // event, not a unit
    s.players[me].resources.push({ instance: grunt, exhausted: false });
    s.players[me].resources.push({ instance: bolt, exhausted: false });
    const resourceCountBefore = s.players[me].resources.length;
    s = play(s, me, 'shd-109');
    s = T.act(s, { type: 'revealResource', uid: grunt.uid });
    s = T.act(s, { type: 'revealResource', uid: bolt.uid });
    s = T.act(s, { type: 'revealResource', uid: null }); // stop revealing
    s = drive(s); // resolves the forced free play of the revealed unit
    T.ok(SB.allUnits(s, me).some(function (u) { return u.cardId === 'fx-grunt' && u.enteredRound === s.round; }),
      'the revealed unit entered play');
    T.ok(!s.players[me].resources.some(function (r) { return r.instance.uid === grunt.uid; }),
      'the played unit left the resource row');
    T.ok(s.players[me].resources.some(function (r) { return r.instance.uid === bolt.uid; }),
      'the revealed non-unit is still sitting in the resource row');
    T.eq(s.players[me].resources.length, resourceCountBefore,
      'the resource row is topped back up from the deck, same as any other card played from resources');
  });

  T.add('shd-109: stopping early leaves the un-revealed resources untouched', function () {
    let s = T.game(); const me = 0;
    fund(s, me, SB.cardCost(s, me, 'shd-109'));
    const grunt = { uid: s.nextUid++, cardId: 'fx-grunt' };
    const wall = { uid: s.nextUid++, cardId: 'fx-wall' };
    s.players[me].resources.push({ instance: grunt, exhausted: false });
    s.players[me].resources.push({ instance: wall, exhausted: false });
    s = play(s, me, 'shd-109');
    s = T.act(s, { type: 'revealResource', uid: null }); // stop before revealing anything
    T.eq(s.queue.length, 0, 'the ability resolves with nothing revealed');
    T.ok(s.players[me].resources.some(function (r) { return r.instance.uid === grunt.uid; }),
      'the un-revealed unit stayed a resource');
    T.ok(s.players[me].resources.some(function (r) { return r.instance.uid === wall.uid; }),
      'the other un-revealed unit stayed a resource too');
    T.ok(!SB.allUnits(s, me).some(function (u) { return u.cardId === 'fx-grunt' || u.cardId === 'fx-wall'; }),
      'nothing was played');
  });

  T.add('shd-109: revealing can stop partway through, after some resources are already revealed', function () {
    let s = T.game(); const me = 0;
    fund(s, me, SB.cardCost(s, me, 'shd-109'));
    const grunt = { uid: s.nextUid++, cardId: 'fx-grunt' };
    const wall = { uid: s.nextUid++, cardId: 'fx-wall' };
    s.players[me].resources.push({ instance: grunt, exhausted: false });
    s.players[me].resources.push({ instance: wall, exhausted: false });
    s = play(s, me, 'shd-109');
    let acts = SB.legalActions(s);
    T.ok(acts.some(function (a) { return a.type === 'revealResource' && a.uid == null; }), 'stopping is offered');
    s = T.act(s, { type: 'revealResource', uid: grunt.uid });
    s = T.act(s, { type: 'revealResource', uid: null }); // stop after just one reveal
    s = drive(s);
    T.ok(SB.allUnits(s, me).some(function (u) { return u.cardId === 'fx-grunt' && u.enteredRound === s.round; }),
      'the one revealed unit was played');
    T.ok(s.players[me].resources.some(function (r) { return r.instance.uid === wall.uid; }),
      'the never-revealed unit was left alone in resources');
    T.ok(!SB.allUnits(s, me).some(function (u) { return u.cardId === 'fx-wall'; }),
      'the never-revealed unit was not played');
  });

  T.add('law-237: On Attack, look at top 3, may discard 1, rest go back on top', function () {
    let s = T.game(); s.active = 0; const me = 0, foe = 1;
    const u = T.putOnBoard(s, me, 'law-237', { exhausted: false });
    const top3 = ['fx-grunt', 'fx-flyer', 'fx-wall'].map(function (cid) { return { uid: s.nextUid++, cardId: cid }; });
    s.players[me].deck = top3.concat(s.players[me].deck);
    const deckBefore = s.players[me].deck.length;
    s = T.act(s, { type: 'attack', attacker: u.uid, target: { kind: 'base', player: foe } });
    s = T.act(s, { type: 'peekDiscardPick', index: 1 }); // discard the middle card
    T.eq(s.players[me].deck.length, deckBefore - 1, 'exactly one card left the deck');
    T.ok(s.players[me].discard.some(function (i) { return i.cardId === 'fx-flyer'; }),
      'the chosen card went to the discard pile');
    T.eq(s.players[me].deck[0].cardId, 'fx-grunt', 'the first kept card is back on top');
    T.eq(s.players[me].deck[1].cardId, 'fx-wall', 'the second kept card follows it');
  });

  // ---- leader competitive-expansion pass: new vocabulary added for 15 leaders ----

  T.add('jtl-018 leader side: extraAction lets the same player act again', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'jtl-018';
    s.active = me;
    T.putOnBoard(s, me, 'fx-grunt', { exhausted: false });
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s); // resolve the (single-candidate) suppress target
    T.eq(s.active, me, 'the extra action keeps the same player active instead of passing the turn');
    T.ok(s.players[me].leader.exhausted, 'the leader action still exhausted the leader');
  });

  T.add('jtl-018 unit side: suppressUpTo can suppress more than one unit, then stop', function () {
    let s = deployed_(0);
    const me = 0;
    const a = T.putOnBoard(s, me, 'fx-grunt', { exhausted: false });
    const b = T.putOnBoard(s, me, 'fx-wall', { exhausted: false });
    s = T.act(s, { type: 'attack', attacker: s.ground.find(function (u) { return u.cardId === 'jtl-018'; }).uid,
      target: { kind: 'base', player: 1 } });
    s = T.act(s, { type: 'suppressUpTo', uid: a.uid });
    s = T.act(s, { type: 'suppressUpTo', uid: b.uid });
    s = T.act(s, { type: 'suppressUpTo', uid: null });
    T.ok(SB.findUnit(s, a.uid).abilitiesSuppressed, 'the first chosen unit lost its abilities');
    T.ok(SB.findUnit(s, b.uid).abilitiesSuppressed, 'the second chosen unit lost its abilities too');
  });
  function deployed_(who) {
    let s = T.game(); s.active = who; s.initiative = who;
    const u = deployed(s, who, 'jtl-018');
    return s;
  }

  T.add('law-013 leader side: the activation cost defeats one of your own resources', function () {
    let s = T.game(); const me = 0, foe = 1;
    s.players[me].leader.cardId = 'law-013';
    s.active = me;
    T.giveResources(s, me, 1);
    const before = s.players[me].resources.length;
    T.putOnBoard(s, foe, 'fx-grunt', { exhausted: false });
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s, function (a) { return a.type === 'choose'; });
    T.eq(s.players[me].resources.length, before - 1, 'one resource was defeated as part of activating the action');
    T.eq(s.players[me].credits || 0, 1, 'and a credit token was created');
  });

  T.add('law-016: the leader action is gated on having created a token this phase', function () {
    let s = T.game(); const me = 0, foe = 1;
    s.players[me].leader.cardId = 'law-016';
    s.active = me;
    T.putOnBoard(s, foe, 'fx-grunt', { exhausted: false });
    T.ok(!SB.legalActions(s).some(function (a) { return a.type === 'leaderAction'; }),
      'no token created yet — the action is not offered');
    s.players[me].createdTokenThisPhase = true;
    T.ok(SB.legalActions(s).some(function (a) { return a.type === 'leaderAction'; }),
      'once a token was created this phase, the action becomes available');
  });

  T.add('ash-003 leader side: the buff target must be the only unit you control in its arena', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'ash-003';
    s.active = me;
    T.giveResources(s, me, 1);
    const solo = T.putOnBoard(s, me, 'fx-grunt', { exhausted: false });
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s);
    T.eq(SB.findUnit(s, solo.uid).temp.power, 2, 'the lone ground unit was buffed');
  });


  // Two tests once sat here asserting sor-002's and sec-007's leader actions were
  // always offered and simply fizzled. Both abilities are gated now — the action is
  // not offered unless its condition can be met — and the audit tests below cover
  // that stricter behaviour.
  T.add('sor-002 unit side: shielded, and heals on every enemy death', function () {
    let s = T.game(); const me = 0;
    s.players[me].base.damage = 2;
    const u = deployed(s, me, 'sor-002');
    T.ok(SB.hasKeyword(s, u, 'shielded'), 'the deployed side is shielded');
  });

  T.add('ash-007 leader side: hands a whole arena sentinel and overwhelm', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'ash-007'; s.active = me;
    const mine = T.putOnBoard(s, me, 'fx-grunt');
    const theirs = T.putOnBoard(s, 1, 'fx-grunt');
    s = drive(T.act(s, { type: 'leaderAction' }));
    const g = SB.findUnit(s, mine.uid), e = SB.findUnit(s, theirs.uid);
    T.ok(SB.hasKeyword(s, g, 'sentinel') && SB.hasKeyword(s, g, 'overwhelm'), 'yours gained both');
    T.ok(SB.hasKeyword(s, e, 'sentinel'), 'and so did theirs — it says each unit');
  });

  T.add('ash-007 unit side: every other friendly unit gains both keywords', function () {
    let s = T.game(); const me = 0;
    deployed(s, me, 'ash-007');
    const other = T.putOnBoard(s, me, 'fx-grunt');
    T.ok(SB.hasKeyword(s, other, 'overwhelm'), 'the aura reaches other friendlies');
    T.ok(SB.hasKeyword(s, other, 'sentinel'), 'with both keywords');
  });

  T.add('twi-018 leader side: the damage only reaches an equal-cost enemy', function () {
    let s = rich(T.game(), 0); const me = 0;
    s.players[me].leader.cardId = 'twi-018'; s.active = me;
    const same = T.putOnBoard(s, 1, 'fx-grunt');       // same cost as the unit played
    s = play(s, me, 'fx-grunt');
    s = drive(s);
    T.eq(SB.findUnit(s, same.uid).damage, 1, 'the equal-cost enemy took it');
  });

  T.add('jtl-015 leader side: the action is offered and lends saboteur', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'jtl-015'; s.active = me;
    T.giveResources(s, me, 2);
    const flyer = T.putOnBoard(s, me, 'fx-flyer', { exhausted: false });
    T.ok(SB.legalActions(s).some(function (a) { return a.type === 'leaderAction'; }),
      'a ready space unit makes the action live');
    s = T.act(s, { type: 'leaderAction' });
    T.ok((SB.findUnit(s, flyer.uid).tempKeywords || []).indexOf('saboteur') >= 0,
      'the attacker carries saboteur into the swing');
  });

  T.add('sec-006 leader side: offers a second, strictly cheaper attacker', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'sec-006'; s.active = me;
    T.putOnBoard(s, me, 'fx-brute', { exhausted: false });
    T.putOnBoard(s, me, 'fx-grunt', { exhausted: false });
    T.putOnBoard(s, 1, 'fx-grunt');
    T.ok(SB.legalActions(s).some(function (a) { return a.type === 'leaderAction'; }),
      'the action is offered at all');
  });

  T.add('lof-007: the leader banks the token its unit side pays off', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'lof-007'; s.active = me;
    T.ok(!s.players[me].force, 'no token to begin with');
    s = drive(T.act(s, { type: 'leaderAction' }));
    T.ok(s.players[me].force, 'the action banks one');

    let t = T.game();
    const u = deployed(t, me, 'lof-007');
    const bare = SB.unitPower(t, u);
    t.players[me].force = true;
    T.eq(SB.unitPower(t, u) - bare, 4, 'holding it is worth +4 power');
    T.ok(SB.hasKeyword(t, u, 'overwhelm'), 'and overwhelm');
  });


  // A leader flown as a pilot contributes its PILOT box, which is printed smaller than
  // the body it would have standing on the ground. The engine read the deployed unit
  // side instead, so every pilot leader handed its ship several HP too many — and the
  // four pilot sides that existed had been authored to match that, duplicating the
  // unit side rather than the printed pilot numbers.
  T.add('pilot leaders lend the ship their pilot box, not their unit side', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader = { cardId: 'jtl-009', deployed: false, exhausted: false };
    T.giveResources(s, me, 12);
    s.active = me;
    const ship = T.putOnBoard(s, me, 'sor-044');   // a plain 2/3 vehicle
    const bareP = SB.unitPower(s, ship), bareH = SB.unitMaxHp(s, ship);
    const act = SB.legalActions(s).find(function (a) { return a.type === 'deployLeaderPilot'; });
    T.ok(!!act, 'the ship is a legal berth');
    s = T.act(s, act);
    const flown = SB.findUnit(s, ship.uid);
    const pilot = SB.card('jtl-009').pilotSide;
    T.eq(SB.unitPower(s, flown) - bareP, pilot.power, 'power comes from the pilot box');
    T.eq(SB.unitMaxHp(s, flown) - bareH, pilot.hp, 'and so does HP');
    T.ok(pilot.hp !== SB.card('jtl-009').deployedSide.hp,
      'which is a different number from the unit side — the bug this pins');
  });

  T.add('jtl-015 as a pilot hands the ship saboteur', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader = { cardId: 'jtl-015', deployed: false, exhausted: false };
    T.giveResources(s, me, 12); s.active = me;
    const ship = T.putOnBoard(s, me, 'sor-044');
    T.ok(!SB.hasKeyword(s, ship, 'saboteur'), 'not before it is flown');
    s = T.act(s, SB.legalActions(s).find(function (a) { return a.type === 'deployLeaderPilot'; }));
    T.ok(SB.hasKeyword(s, SB.findUnit(s, ship.uid), 'saboteur'), 'the pilot grants it');
  });

  // jtl-198 lost the upkeep that balances its cheap body.
  T.add('jtl-198: takes 1 damage when the regroup phase starts', function () {
    let s = T.game(); const me = 0;
    const u = T.putOnBoard(s, me, 'jtl-198');
    T.eq(u.damage, 0, 'undamaged on arrival');
    // Both seats pass: that ends the action phase and starts regroup, with nothing
    // else happening in between that could touch the unit.
    s = T.act(s, { type: 'pass' });
    s = T.act(s, { type: 'pass' });
    T.eq(SB.findUnit(s, u.uid).damage, 1, 'one regroup, one damage');
  });

  // ash-208 had the keyword and none of the ability the keyword feeds.
  T.add('ash-208: attaching an upgrade to it offers an exhaust', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const bearer = T.putOnBoard(s, me, 'ash-208');
    T.putOnBoard(s, 1, 'fx-grunt');
    s = play(s, me, 'fx-blade', { attachTo: bearer.uid });
    T.ok(SB.legalActions(s).some(function (a) { return a.type === 'choose'; }),
      'the attach opens a choice');
  });

  // sec-201 granted the wrong keyword outright: grit where the card grants raid 2.
  // Both are conditional keyword grants, so the shape looked right and only the
  // meaning was wrong — invisible to every check except reading the card.
  T.add('sec-201: raid 2, and only while you control the named character', function () {
    let s = T.game(); const me = 0;
    const u = T.putOnBoard(s, me, 'sec-201');
    T.eq(SB.keywordTotal(s, u, 'raid'), 0, 'alone, it gets nothing');
    T.ok(!SB.hasKeyword(s, u, 'grit'), 'and it never grants grit');
    s.players[me].leader = { cardId: 'sec-016', deployed: false };
    T.eq(SB.keywordTotal(s, u, 'raid'), 2, 'with the character as a leader, raid 2');
  });

  // twi-159 printed a keyword and carried none at all: it rendered as a blank card.
  T.add('twi-159: has overwhelm', function () {
    const s = T.game();
    T.ok(SB.hasKeyword(s, T.putOnBoard(s, 0, 'twi-159'), 'overwhelm'), 'overwhelm is on it');
  });

  // twi-196 kept its ambush but lost the coordinate-gated raid entirely.
  T.add('twi-196: raid 3 once you control three units', function () {
    let s = T.game(); const me = 0;
    const u = T.putOnBoard(s, me, 'twi-196');
    T.eq(SB.keywordTotal(s, u, 'raid'), 0, 'one unit is not a coordination');
    T.putOnBoard(s, me, 'fx-grunt'); T.putOnBoard(s, me, 'fx-grunt');
    T.eq(SB.keywordTotal(s, u, 'raid'), 3, 'three units turn it on');
  });

  // shd-204 gains ambush only when it comes out of the hand. Smuggling it out of the
  // resource row is the cheaper line precisely because it does NOT come swinging, so
  // granting ambush on both paths would hand the discount a free attack.
  T.add('shd-204: ambush when played from hand, none when smuggled', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    s.space.push(SB.makeUnit(s, 'fx-grunt', 1));   // something for an ambush to hit
    s = play(s, me, 'shd-204');
    const fromHand = unitsOf(s, me, 'shd-204')[0];
    T.ok(SB.hasKeyword(s, fromHand, 'ambush'), 'played from hand, it has ambush');

    let t = rich(T.game(), 0); t.active = 0;
    t.space.push(SB.makeUnit(t, 'fx-grunt', 1));
    t.players[me].resources.push({ instance: { uid: t.nextUid++, cardId: 'shd-204' }, exhausted: false });
    t = T.act(t, { type: 'smuggle', cardId: 'shd-204' });
    const smuggled = unitsOf(t, me, 'shd-204')[0];
    T.ok(!!smuggled, 'it smuggles into play');
    T.ok(!SB.hasKeyword(t, smuggled, 'ambush'), 'smuggled, it does not');
  });

  // A smuggle cost of 0 lets a card be played out of the resource row for nothing. The
  // importer left 19 cards that way — every one of them free — and nothing failed,
  // because the keyword was present and only its number was wrong. Presence is not
  // correctness: assert the number.
  T.add('content: no card smuggles for free', function () {
    const free = [];
    Object.keys(SB.cards).forEach(function (id) {
      (SB.cards[id].keywords || []).forEach(function (k) {
        if (k.k === 'smuggle' && !(k.cost > 0)) free.push(id);
      });
    });
    T.eq(free.join(' '), '', 'cards with a zero smuggle cost');
  });


  // ---- wave-2 audit: cards whose printed rules had no implementation at all --------

  T.add('audit shd-187: enemy card abilities cannot damage, defeat or capture it', function () {
    let s = T.game(); const me = 0, foe = 1;
    const ward = T.putOnBoard(s, foe, 'shd-187');
    SB.damageUnit(s, ward, 2, { controller: me });
    T.eq(SB.findUnit(s, ward.uid).damage, 0, 'ability damage from the other side is shrugged off');
    SB.damageUnit(s, ward, 1, { controller: foe });
    T.eq(SB.findUnit(s, ward.uid).damage, 1, 'its own controller can still damage it');
    SB.damageUnit(s, ward, 5, { controller: me, combat: true });
    T.ok(!SB.findUnit(s, ward.uid), 'combat damage still kills it');
  });

  T.add('audit ash-208: a shield arriving counts as an upgrade attaching', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const victim = T.putOnBoard(s, foe, 'fx-grunt', { exhausted: false });
    s = play(s, me, 'ash-208');
    s = drive(s, function (a) { return a.type !== 'chooseNone' && a.target ? a.target.uid === victim.uid : true; });
    T.ok(SB.findUnit(s, victim.uid).exhausted, 'the shielded keyword fired the attach trigger');
  });

  T.add('audit jtl-198: it damages itself when the regroup phase starts', function () {
    let s = T.game(); const me = 0;
    const u = T.putOnBoard(s, me, 'jtl-198');
    s.active = me; s.players[me].locked = false;
    SB.fireTriggers(s, 'onRegroup', u, { sourceUid: u.uid });
    SB.drainQueue(s);
    T.eq(SB.findUnit(s, u.uid).damage, 1, 'one damage on itself at regroup');
  });

  T.add('audit sor-198: it strikes first while attacking', function () {
    let s = T.game(); const me = 0, foe = 1;
    const mine = T.putOnBoard(s, me, 'sor-198', { exhausted: false });
    const theirs = T.putOnBoard(s, foe, 'fx-grunt'); // 2/2, dies to 6 power before it swings
    s.active = me;
    s = T.act(s, { type: 'attack', attacker: mine.uid, target: { kind: 'unit', uid: theirs.uid } });
    s = drive(s);
    T.ok(!SB.findUnit(s, theirs.uid), 'the defender is gone');
    T.eq(SB.findUnit(s, mine.uid).damage, 0, 'and it never dealt its damage back');
  });

  T.add('audit twi-196: coordinate hands it Raid 3 at three units', function () {
    let s = T.game(); const me = 0;
    const u = T.putOnBoard(s, me, 'twi-196');
    T.ok(!SB.hasKeyword(s, u, 'raid'), 'no raid on its own');
    T.putOnBoard(s, me, 'fx-grunt'); T.putOnBoard(s, me, 'fx-wall');
    T.ok(SB.hasKeyword(s, u, 'raid'), 'raid once you control three units');
  });

  T.add('audit shd-204: ambush from hand only, and its smuggle cost is 6', function () {
    T.eq(SB.card('shd-204').keywords[0].cost, 6, 'the printed smuggle cost');
    T.ok(!SB.hasKeyword(T.game(), { cardId: 'shd-204', upgrades: [], temp: {} }, 'ambush'),
      'it does not carry Ambush as a printed keyword');
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    const prey = T.putOnBoard(s, foe, 'fx-flyer'); // 3/2 in space
    s = play(s, me, 'shd-204');                    // 5/5 in space
    s = drive(s);
    T.ok(!SB.findUnit(s, prey.uid), 'played from hand, it attacked the moment it landed');
  });

  T.add('audit sor-199: a Cunning card may be discarded instead of paying', function () {
    let s = T.game(); const me = 0;
    s.active = me;
    T.putInHand(s, me, 'sor-199');
    T.putInHand(s, me, 'fx-ghost'); // cunning
    s.players[me].resources = [];
    const acts = SB.legalActions(s).filter(function (a) { return a.type === 'playCard' && a.cardId === 'sor-199'; });
    T.eq(acts.length, 1, 'with no resources at all the alternate cost is the only way to play it');
    T.ok(acts[0].altDiscardIndex != null, 'and it is the discard payment');
    const before = s.players[me].hand.length;
    s = T.act(s, acts[0]);
    T.eq(s.players[me].hand.length, before - 2, 'both the event and the card that paid for it left the hand');
  });

  T.add('audit sec-209: defeating a unit in combat lets it capture another', function () {
    let s = T.game(); const me = 0, foe = 1;
    const mine = T.putOnBoard(s, me, 'sec-209', { exhausted: false });
    const dies = T.putOnBoard(s, foe, 'fx-grunt');
    const prize = T.putOnBoard(s, foe, 'fx-medic');
    s.active = me;
    s = T.act(s, { type: 'attack', attacker: mine.uid, target: { kind: 'unit', uid: dies.uid } });
    s = drive(s);
    T.ok(!SB.findUnit(s, prize.uid), 'the second unit was carried off');
  });

  // ---- the ten leaders that deployed with no abilities at all ----------------------

  T.add('audit ash-007 leader: one arena gains Sentinel and Overwhelm', function () {
    let s = T.game(); const me = 0, foe = 1;
    s.players[me].leader.cardId = 'ash-007'; s.active = me;
    const g = T.putOnBoard(s, foe, 'fx-grunt');
    const f = T.putOnBoard(s, me, 'fx-flyer');
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s, function (a) { return a.type !== 'binary' || a.pick === 'a'; });
    T.ok(SB.hasKeyword(s, SB.findUnit(s, g.uid), 'sentinel'), 'every ground unit, both sides');
    T.ok(SB.hasKeyword(s, SB.findUnit(s, g.uid), 'overwhelm'), 'and overwhelm with it');
    T.ok(!SB.hasKeyword(s, SB.findUnit(s, f.uid), 'sentinel'), 'the space arena was not the one chosen');
  });

  T.add('audit ash-007 unit side: the aura passes both keywords to the others', function () {
    let s = T.game(); const me = 0;
    deployed(s, me, 'ash-007');
    const g = T.putOnBoard(s, me, 'fx-grunt');
    T.ok(SB.hasKeyword(s, g, 'overwhelm') && SB.hasKeyword(s, g, 'sentinel'), 'each other friendly unit');
  });

  T.add('audit jtl-015 leader: a space unit attacks with +1 power and saboteur', function () {
    let s = T.game(); const me = 0, foe = 1;
    s.players[me].leader.cardId = 'jtl-015'; s.active = me;
    T.giveResources(s, me, 1);
    const mine = T.putOnBoard(s, me, 'fx-flyer', { exhausted: false }); // 3/2 in space
    const wall = T.putOnBoard(s, foe, 'fx-shieldy');                    // 2/3 shielded, space
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s, function (a) { return !a.attacker || a.attacker === mine.uid; });
    T.ok(!SB.findUnit(s, wall.uid), 'saboteur popped the shield and +1 power finished it');
  });

  T.add('audit law-002 leader: the gift pays a credit', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'law-002'; s.active = me;
    const g = T.putOnBoard(s, me, 'fx-grunt');
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s);
    T.eq(SB.findUnit(s, g.uid).owner, 1, 'the opponent controls it now');
    T.eq(s.players[me].credits || 0, 1, 'and a credit was created');
  });

  T.add('audit lof-001 leader: discarding an upgrade draws', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'lof-001'; s.active = me;
    T.putInHand(s, me, 'fx-blade');
    const hand = s.players[me].hand.length;
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s, function (a) { return a.type !== 'discardCard' || SB.card(s.players[me].hand[a.handIndex].cardId).type === 'upgrade'; });
    T.eq(s.players[me].hand.length, hand, 'one card discarded, one drawn back');
    T.eq(s.players[me].discard[s.players[me].discard.length - 1].cardId, 'fx-blade', 'the upgrade is the card that went');
  });

  T.add('audit lof-007: force uses count towards its deploy threshold', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'lof-007'; s.active = me;
    T.giveResources(s, me, 8);
    s.players[me].resources = s.players[me].resources.slice(0, 8);
    T.ok(!SB.legalActions(s).some(function (a) { return a.type === 'deployLeader'; }), '8 resources is not enough');
    s.players[me].forceUsesThisPhase = 1;
    T.ok(SB.legalActions(s).some(function (a) { return a.type === 'deployLeader'; }), 'one use of the Force closes the gap');
  });

  T.add('audit sec-006 leader: a second, cheaper unit may follow the first into the attack', function () {
    let s = T.game(); const me = 0, foe = 1;
    s.players[me].leader.cardId = 'sec-006'; s.active = me;
    const brute = T.putOnBoard(s, me, 'fx-brute'); // cost 4, attacks first
    const grunt = T.putOnBoard(s, me, 'fx-grunt'); // cost 1, may follow
    T.putOnBoard(s, foe, 'fx-medic');
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s);
    const attackers = s.log.filter(function (e) { return e.type === 'attackDeclared'; })
      .map(function (e) { return e.attacker; });
    T.eq(attackers.length, 2, 'two attacks came out of one leader action');
    T.eq(attackers[0], brute.uid, 'the 4-cost unit went first');
    T.eq(attackers[1], grunt.uid, 'and only the cheaper unit could follow it');
  });

  T.add('audit sec-006 leader: nothing follows when the first attacker is the cheapest', function () {
    let s = T.game(); const me = 0, foe = 1;
    s.players[me].leader.cardId = 'sec-006'; s.active = me;
    T.putOnBoard(s, me, 'fx-grunt');  // cost 1 — the only ready unit
    T.putOnBoard(s, foe, 'fx-medic');
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s);
    T.eq(s.log.filter(function (e) { return e.type === 'attackDeclared'; }).length, 1,
      'no unit costs less than a 1-cost attacker, so the second attack never happens');
  });

  T.add('audit sec-007 leader: the action needs a card costing 6 or more to discard', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'sec-007'; s.active = me;
    s.players[me].hand = [];
    T.putInHand(s, me, 'fx-grunt');
    T.ok(!SB.legalActions(s).some(function (a) { return a.type === 'leaderAction'; }),
      'nothing expensive in hand — the action is not offered');
    T.putInHand(s, me, 'sec-209'); // cost 8
    T.ok(SB.legalActions(s).some(function (a) { return a.type === 'leaderAction'; }),
      'an 8-cost card in hand unlocks it');
  });

  T.add('audit sec-017 leader: base damage lets it strip the enemy deck', function () {
    let s = T.game(); const me = 0, foe = 1;
    s.players[me].leader.cardId = 'sec-017'; s.active = me;
    const mine = T.putOnBoard(s, me, 'fx-grunt', { exhausted: false });
    const deckBefore = s.players[foe].deck.length;
    s = T.act(s, { type: 'attack', attacker: mine.uid, target: { kind: 'base', player: foe } });
    s = drive(s);
    T.eq(s.players[foe].deck.length, deckBefore - 1, 'one card left their deck');
    T.ok(s.players[me].leader.exhausted, 'the leader paid with its own exhaust');
  });

  T.add('audit sor-002: the leader heals only after an enemy unit died', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'sor-002'; s.active = me;
    s.players[me].base.damage = 3;
    T.ok(!SB.legalActions(s).some(function (a) { return a.type === 'leaderAction'; }), 'nothing died yet');
    s.defeatedThisPhase = [{ owner: 1, cardId: 'fx-grunt' }];
    T.ok(SB.legalActions(s).some(function (a) { return a.type === 'leaderAction'; }), 'now it is offered');
    s = T.act(s, { type: 'leaderAction' });
    s = drive(s);
    T.eq(s.players[me].base.damage, 2, 'one damage healed');
  });

  T.add('audit sor-002 unit side: it deploys with a shield', function () {
    let s = T.game(); const me = 0;
    s.players[me].leader.cardId = 'sor-002'; s.active = me;
    T.giveResources(s, me, 12);
    s = T.act(s, { type: 'deployLeader' });
    s = drive(s);
    const u = SB.findUnit(s, s.players[me].leader.uid);
    T.eq(u.shields, 1, 'the printed Shielded keyword lands on the deploy');
  });

  T.add('audit twi-018 leader: it hits a unit of the played card\u2019s cost', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    s.players[me].leader.cardId = 'twi-018';
    const same = T.putOnBoard(s, foe, 'fx-gritty'); // cost 3, matches
    s = play(s, me, 'fx-ghost');                    // cost 3, no ambush of its own
    s = drive(s);
    T.eq(SB.findUnit(s, same.uid).damage, 1, 'the equal-cost unit took it');
    T.ok(s.players[me].leader.exhausted, 'and the leader paid its exhaust');
  });

  T.add('audit twi-018 leader: a unit of any other cost is not a legal target', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0, foe = 1;
    s.players[me].leader.cardId = 'twi-018';
    const other = T.putOnBoard(s, foe, 'fx-wall'); // cost 2
    s = play(s, me, 'fx-ghost');                   // cost 3
    s = drive(s);
    T.eq(SB.findUnit(s, other.uid).damage, 0, 'the cheaper unit was never in range');
  });

  // Two shapes the pulled skeletons kept getting wrong, now that every one they broke
  // has been repaired: a keyword cost left at its default, and a leader with no
  // abilities on either side.
  T.add('audit: no smuggle keyword is left at a zero cost', function () {
    const zero = Object.keys(SB.cards).filter(function (id) {
      return (SB.cards[id].keywords || []).some(function (k) { return k.k === 'smuggle' && !(k.cost > 0); });
    });
    T.eq(zero.length, 0, 'a smuggle cost of 0 plays the card off a resource for free: ' + zero.join(', '));
  });

  T.add('audit: no piloting keyword is left at a zero cost', function () {
    const zero = Object.keys(SB.cards).filter(function (id) {
      return (SB.cards[id].keywords || []).some(function (k) { return k.k === 'piloting' && !(k.cost > 0); });
    });
    T.eq(zero.length, 0, 'a piloting cost of 0 attaches the pilot to a vehicle for free: ' + zero.join(', '));
  });

  T.add('audit: every leader a registered deck uses has a leader-side ability', function () {
    const seen = {};
    Object.keys(SB.decks).forEach(function (d) { seen[SB.decks[d].leader] = true; });
    const bare = Object.keys(seen).filter(function (id) {
      return !((SB.cards[id].leaderSide.abilities || []).length);
    });
    T.eq(bare.length, 0, 'a leader with no leader-side ability does nothing until it deploys: ' + bare.join(', '));
  });
  // ---- pilots: the printed piloting cost, and the box the ship actually gets --------

  T.add('a pilot UNIT lends the ship its pilot box, not its own body', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const ship = T.putOnBoard(s, me, 'sor-044');   // a plain vehicle with no pilot
    const bareP = SB.unitPower(s, ship), bareH = SB.unitMaxHp(s, ship);
    const pilot = SB.card('jtl-142');              // 7/7 as a unit, 3/3 in its pilot box
    s = play(s, me, 'jtl-142', { asPilot: true, attachTo: ship.uid });
    const flown = SB.findUnit(s, ship.uid);
    T.eq(SB.unitPower(s, flown) - bareP, pilot.pilotSide.power, 'power comes from the pilot box');
    T.eq(SB.unitMaxHp(s, flown) - bareH, pilot.pilotSide.hp, 'and so does HP');
    T.ok(pilot.pilotSide.power !== pilot.power, 'which is a smaller number than its unit body');
  });

  T.add('the aura-free power reading uses the pilot box too', function () {
    let s = rich(T.game(), 0); s.active = 0; const me = 0;
    const ship = T.putOnBoard(s, me, 'sor-044');
    const bare = SB.unitPowerNoAura(s, ship);
    s = play(s, me, 'jtl-142', { asPilot: true, attachTo: ship.uid });
    const flown = SB.findUnit(s, ship.uid);
    T.eq(SB.unitPowerNoAura(s, flown) - bare, SB.card('jtl-142').pilotSide.power,
      'the path aura conditions read agrees with SB.unitPower');
  });

  T.add('jtl-210 is played as a pilot for its printed cost, on one aspect', function () {
    const kw = SB.card('jtl-210').keywords.find(function (k) { return k.k === 'piloting'; });
    T.eq(kw.cost, 2, 'the printed piloting cost');
    T.eq(kw.aspects.join(','), 'cunning', 'one aspect, not two — a doubled one taxes it twice');
    // Aspect penalties are charged per unmatched icon, so the duplicate was worth 2 resources.
    let s = T.game(); const me = 0;
    const card = SB.card('jtl-210');
    T.eq(SB.smuggleCost(s, me, card, kw), SB.smuggleCost(s, me, card, { cost: 2, aspects: ['cunning'] }),
      'and it prices exactly as the printed bracket reads');
  });

  T.add('a pilot shows what it costs to fly and what it gives the ship', function () {
    const lines = SB.cardText('jtl-057').join(' / ');
    T.ok(/Piloting \[2, Vigilance\]/.test(lines), 'the printed piloting cost is on the card: ' + lines);
    T.ok(/attached unit gets \+1\/\+3/.test(lines), 'and so is the pilot box: ' + lines);
  });

  T.add('content: every pilot carries the box it lends its ship', function () {
    const missing = Object.keys(SB.cards).filter(function (id) {
      const c = SB.cards[id];
      return (c.keywords || []).some(function (k) { return k.k === 'piloting'; }) && !c.pilotSide;
    });
    T.eq(missing.join(' '), '', 'pilots with no pilot box, which would lend their unit body instead');
  });

})(window.SB = window.SB || {});

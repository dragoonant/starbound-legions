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
})(window.SB = window.SB || {});

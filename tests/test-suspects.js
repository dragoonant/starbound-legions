// test-suspects.js — deterministic scenarios for the abilities tools/coverage.mjs
// flagged as never firing in random play even though the card reached the board.
// Each test builds the exact position the ability wants and drives it through, so
// a rare trigger is proven reachable rather than assumed so. A failure here is a
// card whose printed promise the engine does not keep.
(function (SB) {
  'use strict';
  const T = SB.test;

  // Resolve the open queue, picking at each step the first action `pick(action,
  // state)` accepts, else the first action offered.
  function drive(s, pick, limit) {
    let n = 0;
    while (s.queue.length > 0 && !SB.isTerminal(s) && n++ < (limit || 40)) {
      const acts = SB.legalActions(s);
      const a = (pick && acts.find(function (x) { return pick(x, s); })) || acts[0];
      s = SB.apply(s, a);
    }
    return s;
  }
  // Candidate-list picks: a 'choose' action indexes the queue head's candidates.
  function cand(s, a) { return a.type === 'choose' && a.index >= 0 ? s.queue[0].candidates[a.index] : null; }
  function wantUnit(uid) { return function (a, s) { const c = cand(s, a); return !!c && c.uid === uid; }; }
  function wantBase(who) { return function (a, s) { const c = cand(s, a); return !!c && c.kind === 'base' && c.player === who; }; }
  function decline(a) { return a.type === 'choose' && a.index === -1; }
  function any() { const fs = Array.prototype.slice.call(arguments); return function (a, s) { return fs.some(function (f) { return f(a, s); }); }; }
  function branchA(a) { return a.type === 'binary' && a.pick === 'a'; }

  function board(s, who, id, opts) { return T.putOnBoard(s, who, id, opts); }
  function play(s, who, cardId, extra) {
    s.active = who;
    const inst = T.putInHand(s, who, cardId);
    const idx = s.players[who].hand.indexOf(inst);
    return T.act(s, Object.assign({ type: 'playCard', handIndex: idx, cardId: cardId }, extra || {}));
  }
  function attack(s, who, uid, target) {
    s.active = who;
    return T.act(s, { type: 'attack', attacker: uid, target: target });
  }
  function base(who) { return { kind: 'base', player: who }; }
  function unitT(u) { return { kind: 'unit', uid: u.uid }; }
  function fresh() { const s = T.game('fixtureA', 'fixtureB', 'suspect'); T.giveResources(s, 0, 12); T.giveResources(s, 1, 12); return s; }
  // Queue an effect by hand (as if a card had done it) and run it to its first choice.
  function inject(s, who, ops, ctx) { SB.queueEffects(s, who, ops, ctx); SB.drainQueue(s); return s; }

  T.add('suspect ash-036: after the attack, a defeated defender pays out 3 advantage', function () {
    let s = fresh();
    const me = board(s, 0, 'ash-036');        // power 1
    const buddy = board(s, 0, 'fx-grunt');
    const victim = board(s, 1, 'fx-grunt', { damage: 1 }); // hp 2, dies to 1 power
    s = attack(s, 0, me.uid, unitT(victim));
    s = drive(s, wantUnit(buddy.uid));
    T.ok(!SB.findUnit(s, victim.uid), 'the defender died');
    T.eq(SB.findUnit(s, buddy.uid).advantage, 3, 'three advantage tokens landed');
  });

  T.add('suspect ash-101: a defender that survived with damage is defeated after the attack', function () {
    let s = fresh();
    const me = board(s, 0, 'ash-101');        // power 6
    const tank = board(s, 1, 'fx-gritty', { damage: 1, shields: 1 }); // the shield eats the hit; it stays damaged
    s = attack(s, 0, me.uid, unitT(tank));
    s = drive(s);
    T.ok(!SB.findUnit(s, tank.uid), 'the damaged survivor was defeated by the after-attack ability');
  });

  T.add('suspect ash-161: a friendly upgrade dying pings a base for 1', function () {
    let s = fresh();
    board(s, 0, 'ash-161');
    const bearer = board(s, 0, 'fx-grunt');
    // A plain upgrade with no bounty to muddy the base pick. jtl-120 used to serve here,
    // until it was given the attach restriction its card prints (a Vehicle only).
    s = play(s, 0, 'fx-blade', { attachTo: bearer.uid });
    s = drive(s);
    T.eq(SB.findUnit(s, bearer.uid).upgrades.length, 1, 'upgrade attached');
    const before = s.players[1].base.damage;
    const killer = board(s, 1, 'fx-brute');   // power 5 vs hp 2: the upgrade goes down with its bearer
    s = attack(s, 1, killer.uid, unitT(bearer));
    s = drive(s, wantBase(1));
    T.ok(!SB.findUnit(s, bearer.uid), 'bearer died');
    T.eq(s.players[1].base.damage, before + 1, 'the enemy base took 1');
  });

  T.add('suspect jtl-062: healing it lets it ping a space unit', function () {
    let s = fresh();
    const me = board(s, 0, 'jtl-062', { damage: 2 });
    const foe = board(s, 1, 'fx-flyer');
    s = inject(s, 0, [{ op: 'heal', amount: 1, target: { who: 'friendly', what: 'unit' } }], { sourceUid: me.uid, cardId: 'fx-medic' });
    s = drive(s, wantUnit(foe.uid));      // the ping may hit any space unit, itself included
    T.eq(SB.findUnit(s, me.uid).damage, 1, 'it was healed 1');
    T.eq(SB.findUnit(s, foe.uid).damage, 1, 'and the space unit took 1');
  });

  T.add('suspect jtl-111: an opponent drawing in the action phase hands out experience', function () {
    let s = fresh();
    const me = board(s, 0, 'jtl-111');
    s.phase = 'action';
    SB.drawCards(s, 1, 1);
    SB.drainQueue(s);
    s = drive(s, wantUnit(me.uid));
    T.eq(SB.findUnit(s, me.uid).experience, 1, 'experience token given');
  });

  T.add('suspect jtl-203: played as a pilot, it may attack with the vehicle', function () {
    let s = fresh();
    const ship = board(s, 0, 'jtl-115');     // a Vehicle (tr46) with no pilot
    s.active = 0;
    const inst = T.putInHand(s, 0, 'jtl-203');
    const idx = s.players[0].hand.indexOf(inst);
    const acts = SB.legalActions(s).filter(function (a) { return a.type === 'playCard' && a.handIndex === idx && a.asPilot; });
    T.eq(acts.length, 1, 'a pilot play is offered onto the vehicle');
    s = SB.apply(s, acts[0]);
    const before = s.players[1].base.damage;
    s = drive(s, function (a) { return a.type === 'effectAttack' && a.target && a.target.kind === 'base'; });
    T.eq(SB.findUnit(s, ship.uid).upgrades.length, 1, 'pilot attached');
    T.ok(s.players[1].base.damage > before, 'the piloted vehicle attacked the base');
  });

  T.add('suspect jtl-250: with a Cunning unit alongside, the attack offers ready-a-resource', function () {
    let s = fresh();
    const me = board(s, 0, 'jtl-250');
    board(s, 0, 'fx-ghost');               // cunning
    s.players[0].resources[0].exhausted = true;
    const ready = SB.readyResources(s, 0);
    s = attack(s, 0, me.uid, base(1));
    s = drive(s, branchA);
    T.eq(SB.readyResources(s, 0), ready + 1, 'one resource readied');
  });

  T.add('suspect law-035: alongside an Aggression unit it heals 4', function () {
    let s = fresh();
    board(s, 0, 'fx-grunt');               // aggression
    const hurt = board(s, 0, 'fx-gritty', { damage: 5 });
    s = play(s, 0, 'law-035');
    s = drive(s, wantUnit(hurt.uid));
    T.eq(SB.findUnit(s, hurt.uid).damage, 1, 'healed 4');
  });

  T.add('suspect law-047: healed damage comes back as damage to a unit', function () {
    let s = fresh();
    const me = board(s, 0, 'law-047', { damage: 3 });
    const foe = board(s, 1, 'fx-gritty');
    s = inject(s, 0, [{ op: 'heal', amount: 3, target: { who: 'friendly', what: 'unit' } }], { sourceUid: me.uid, cardId: 'fx-medic' });
    s = drive(s, wantUnit(foe.uid));
    T.eq(SB.findUnit(s, me.uid).damage, 0, 'fully healed');
    T.eq(SB.findUnit(s, foe.uid).damage, 3, 'the enemy took the 3 healed');
  });

  T.add('suspect law-078: alongside a Vigilance unit it may defeat any upgrade', function () {
    let s = fresh();
    board(s, 0, 'fx-wall');                // vigilance
    const bearer = board(s, 1, 'fx-grunt');
    s = play(s, 1, 'shd-071', { attachTo: bearer.uid });
    s = drive(s);
    s = play(s, 0, 'law-078');
    // Decline the ambush (it would kill the bearer first); take the upgrade instead.
    s = drive(s, any(decline, function (a) { return a.type === 'defeatUpgrade' && a.uid === bearer.uid; }));
    T.ok(SB.findUnit(s, bearer.uid), 'bearer still there');
    T.eq(SB.findUnit(s, bearer.uid).upgrades.length, 0, 'the upgrade was defeated');
  });

  T.add('suspect lof-229: an upgrade played on it offers spend-the-force-and-draw', function () {
    let s = fresh();
    const me = board(s, 0, 'lof-229');
    s.players[0].force = true;
    const hand = s.players[0].hand.length;
    s = play(s, 0, 'shd-071', { attachTo: me.uid });
    T.ok(s.queue.length > 0 && s.queue[0].step === 'binaryPick', 'the choice was raised (the upgrade was played on this unit)');
    s = drive(s, branchA);
    T.eq(s.players[0].force, false, 'force spent');
    T.eq(s.players[0].hand.length, hand + 1, 'drew a card');
  });

  T.add('suspect lof-229: an upgrade played on ANOTHER unit does not', function () {
    let s = fresh();
    board(s, 0, 'lof-229');
    const other = board(s, 0, 'fx-grunt');
    s.players[0].force = true;
    s = play(s, 0, 'shd-071', { attachTo: other.uid });
    s = drive(s);
    T.eq(s.players[0].force, true, 'nothing offered, force untouched');
  });

  T.add('suspect sec-085: with the icons in hand, it may disclose and hand out two experience', function () {
    let s = fresh();
    const me = board(s, 0, 'sec-085');
    const a = board(s, 0, 'fx-grunt');
    const b = board(s, 0, 'fx-wall');
    T.putInHand(s, 0, 'sec-085');          // command + villainy
    T.putInHand(s, 0, 'jtl-111');          // command
    s = attack(s, 0, me.uid, base(1));
    T.ok(SB.legalActions(s).some(branchA), 'branch a offered');
    s = drive(s, any(branchA, wantUnit(a.uid), wantUnit(b.uid)));
    const xp = (SB.findUnit(s, a.uid).experience || 0) + (SB.findUnit(s, b.uid).experience || 0);
    T.eq(xp, 2, 'two experience tokens handed out');
    T.ok(SB.findUnit(s, a.uid).experience === 1 && SB.findUnit(s, b.uid).experience === 1, 'to two different units');
  });

  T.add('suspect shd-031: the granted bounty pays its collector 5 base heal', function () {
    let s = fresh();
    const me = board(s, 0, 'shd-031');
    const mark = board(s, 0, 'fx-grunt');
    s.players[1].base.damage = 8;
    s.active = 0;
    s = T.act(s, { type: 'unitAction', uid: me.uid, abilityIndex: 0 });
    s = drive(s, wantUnit(mark.uid));
    T.eq((SB.findUnit(s, mark.uid).tempAbilities || []).length, 1, 'bounty granted');
    const killer = board(s, 1, 'fx-brute');
    s = attack(s, 1, killer.uid, unitT(mark));
    s = drive(s, wantBase(1));
    T.eq(s.players[1].base.damage, 3, 'the opponent collected 5 healing');
  });

  T.add('suspect shd-071: bounty on a champion heals 6 instead of 4', function () {
    let s = fresh();
    const mark = board(s, 0, 'sor-049');   // unique, hp 6
    s = play(s, 0, 'shd-071', { attachTo: mark.uid });
    s = drive(s);
    s.players[1].base.damage = 10;
    s = inject(s, 1, [{ op: 'damage', amount: 6, target: { who: 'enemy', what: 'unit' } }], { cardId: 'fx-bolt' });
    s = drive(s, any(wantUnit(mark.uid), wantBase(1), decline));
    T.ok(!SB.findUnit(s, mark.uid), 'the champion died');
    T.eq(s.players[1].base.damage, 4, 'collector healed 6');
  });

  T.add('suspect shd-172: an opponent playing a card lets it deal that cost in damage', function () {
    let s = fresh();
    board(s, 0, 'shd-172');
    const foeUnit = board(s, 1, 'fx-gritty');
    s = play(s, 1, 'fx-brute');            // cost 4
    s = drive(s, any(branchA, wantUnit(foeUnit.uid)));
    T.eq(SB.findUnit(s, foeUnit.uid).damage, 4, 'took damage equal to the played card cost');
  });
})(window.SB = window.SB || {});

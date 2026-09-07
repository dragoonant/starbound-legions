// ops2.js — second op vocabulary, added for the competitive-deck expansion. Loads after
// ops.js and before validate.js. Registers into SB.ops / SB.queueSteps, and extends the
// condition, amount-ref and selector vocabularies through the hook tables effects.js
// consults before throwing (SB.extraConditions, SB.extraAmounts, SB.extraSelector).
// Every op here has a describer in text.js and a test in tests/test-expansion.js.
(function (SB) {
  'use strict';
  const O = SB.ops;
  const S = SB.queueSteps;

  // ---- helpers --------------------------------------------------------------
  function saved(state, ctx, name) { return SB.efx(state, ctx)[name]; }
  function savedUnit(state, ctx, name) {
    const t = saved(state, ctx, name);
    return t && t.kind === 'unit' ? SB.findUnit(state, t.uid) : null;
  }
  function unitOwnerOrPlayer(state, t) {
    if (!t) return null;
    if (t.kind === 'base') return t.player;
    const u = SB.findUnit(state, t.uid);
    return u ? u.owner : null;
  }
  // Its only caller (searchTake's discardIt) always pulls the discarded card off
  // the top of the deck, so this is a deck-originated discard (see noteDiscarded).
  function pushDiscardInst(state, playerIdx, inst) {
    state.players[playerIdx].discard.push(inst);
    SB.noteDiscarded(state, playerIdx, inst, true);
  }
  // Discards made this phase (uids) — shd-135-style discard actions read it.
  // fromDeck: the card came from the deck rather than the hand — fires the "when
  // you discard a card from your deck" observers (law-176).
  SB.noteDiscarded = function (state, playerIdx, inst, fromDeck) {
    const p = state.players[playerIdx];
    p.discardedThisPhase = p.discardedThisPhase || [];
    p.discardedThisPhase.push(inst.uid);
    if (fromDeck) {
      SB.allUnits(state, playerIdx).forEach(function (u) {
        SB.fireTriggers(state, 'onDeckDiscard', u, { sourceUid: u.uid });
      });
    }
  };

  // All abilities a unit currently carries, in a stable order: its own definition
  // (deployed side for leaders), each upgrade (pilot cards contribute only their
  // pilot-side abilities; leader pilots their pilotSide block), granted temporaries,
  // and auras from other units. Used by trigger firing AND by the action enumerator,
  // so an upgrade-granted "Action:" is offered like a printed one.
  SB.unitAllAbilities = function (state, unit) {
    const out = [];
    const def = SB.unitDef(unit);
    if (unit.abilitiesSuppressed || unit.abilitiesSuppressedForAttack || SB.nameSilenced(state, unit.owner, unit.cardId)) return out;
    (def.abilities || []).forEach(function (ab) { if (!ab.asPilotOnly) out.push(ab); });
    unit.upgrades.forEach(function (inst) {
      const c = SB.card(inst.cardId);
      if (inst.leaderPilot) {
        ((c.pilotSide && c.pilotSide.abilities) || []).forEach(function (ab) { out.push(ab); });
        return;
      }
      if (SB.nameSilenced(state, SB.upgradeOwner(unit, inst), inst.cardId)) return;
      (c.abilities || []).forEach(function (ab) { if (!ab.asUnitOnly) out.push(ab); });
    });
    (unit.tempAbilities || []).forEach(function (ab) { out.push(ab); });
    SB.auraGrants(state, unit).forEach(function (g) {
      (g.abilities || []).forEach(function (ab) { out.push(ab); });
    });
    return out;
  };

  // "Name a card" effects (see DEVIATIONS.md): the unit remembers a card id and either
  // blocks the opponent from playing it or silences every copy the opponent owns.
  SB.nameSilenced = function (state, ownerIdx, cardId) {
    if (!state || ownerIdx == null) return false;
    return SB.allUnits(state, SB.other(ownerIdx)).some(function (u) {
      return u.namedCard === cardId && u.namedMode === 'silence';
    });
  };
  SB.nameBlocked = function (state, ownerIdx, cardId) {
    if ((state.phaseNamedBlocks || []).some(function (b) { return b.cardId === cardId; })) return true;
    return SB.allUnits(state, SB.other(ownerIdx)).some(function (u) {
      return u.namedCard === cardId && u.namedMode === 'block';
    });
  };
  // "Each card with that name costs 3 more for your opponents to play" (shd-202):
  // extra cost added when the player about to pay is the enemy of the unit that
  // named the card, while that unit remains in play.
  SB.nameCostTax = function (state, ownerIdx, cardId) {
    let tax = 0;
    SB.allUnits(state, SB.other(ownerIdx)).forEach(function (u) {
      if (u.namedCard === cardId && u.namedMode === 'costTax') tax += u.namedTaxAmount || 3;
    });
    return tax;
  };

  // ---- aura extensions: lost keywords, dynamic stats, numeric keyword auras ------
  // Re-entrancy guard: an aura's condition or scope may read power, keywords or
  // traits, which read auras again. Nested lookups see printed values only (the same
  // rule ops.js applies to trait grants), so the recursion bottoms out.
  const prevAuraGrants = SB.auraGrants;
  let auraDepth = 0;
  SB.auraGrants = function (state, unit) {
    if (auraDepth > 0) return [];
    auraDepth++;
    try { return prevAuraGrants(state, unit); } finally { auraDepth--; }
  };
  const prevHasKeyword = SB.hasKeyword;
  SB.hasKeyword = function (state, unit, k) {
    if (unit.abilitiesSuppressed || unit.abilitiesSuppressedForAttack) return false;
    let lost = false;
    SB.auraGrants(state, unit).forEach(function (g) {
      if (g.loseKeywords && g.loseKeywords.indexOf(k) >= 0) lost = true;
    });
    if (lost) return false;
    if (prevHasKeyword(state, unit, k)) return true;
    return (unit.tempKeywordNs || []).some(function (kw) { return kw.k === k; });
  };
  const prevKeywordTotal = SB.keywordTotal;
  SB.keywordTotal = function (state, unit, k) {
    let n = prevKeywordTotal(state, unit, k);
    (unit.tempKeywordNs || []).forEach(function (kw) { if (kw.k === k) n += kw.n || 0; });
    SB.auraGrants(state, unit).forEach(function (g) {
      if (g.dynamicKeyword && g.dynamicKeyword.k === k) n += dynamicCount(state, unit, g.dynamicKeyword.per);
    });
    return n;
  };
  function dynamicCount(state, unit, kind) {
    if (kind === 'damagedEnemyUnits') return SB.allUnits(state, SB.other(unit.owner)).filter(function (u) { return u.damage > 0; }).length;
    if (kind === 'otherFriendlySpace') return state.space.filter(function (u) { return u.owner === unit.owner && u.uid !== unit.uid; }).length;
    if (kind === 'upgradesOnSelf') return unit.upgrades.length;
    return 0;
  }
  const prevPower = SB.unitPower, prevMaxHp = SB.unitMaxHp;
  SB.unitPower = function (state, unit) {
    let p = prevPower(state, unit);
    SB.auraGrants(state, unit).forEach(function (g) {
      if (g.dynamicStat) p += dynamicCount(state, unit, g.dynamicStat) * (g.dynamicPowerPer || 0);
    });
    return Math.max(0, p);
  };
  SB.unitMaxHp = function (state, unit) {
    let h = prevMaxHp(state, unit);
    SB.auraGrants(state, unit).forEach(function (g) {
      if (g.dynamicStat) h += dynamicCount(state, unit, g.dynamicStat) * (g.dynamicHpPer || 0);
    });
    return h;
  };
  // Power without any aura, for aura conditions that look at the unit's own power
  // (an aura conditioned on unitPower would recurse into itself).
  SB.unitPowerNoAura = function (state, unit) {
    const def = SB.unitDef(unit);
    let p = def.power + unit.temp.power + unit.experience + (unit.advantage || 0);
    unit.upgrades.forEach(function (inst) {
      const c = SB.card(inst.cardId);
      p += c.type === 'leader' ? c.deployedSide.power : (c.power || 0);
    });
    if (prevHasKeyword(state, unit, 'grit')) p += unit.damage;
    return Math.max(0, p);
  };

  // Static cost discounts from units in play: grant {costDiscount:{amount, filter, oncePerRound?}}.
  // Consumed by engine.playCard (SB.consumeStaticDiscounts) when oncePerRound.
  const prevCardCost = SB.cardCost;
  SB.cardCost = function (state, playerIdx, cardId) {
    let cost = prevCardCost(state, playerIdx, cardId);
    if (!state || !state.ground) return cost;
    const card = SB.card(cardId);
    SB.allUnits(state, playerIdx).forEach(function (u) {
      (SB.unitDef(u).abilities || []).forEach(function (ab) {
        if (ab.trigger !== 'constant' || !ab.grant || !ab.grant.costDiscount) return;
        const d = ab.grant.costDiscount;
        if (!discountMatches(card, d.filter)) return;
        if (d.oncePerRound && u.discountUsedRound === state.round) return;
        cost = Math.max(0, cost - d.amount);
      });
    });
    cost += SB.nameCostTax(state, playerIdx, cardId);
    return cost;
  };
  function discountMatches(card, f) {
    f = f || {};
    if (f.type && card.type !== f.type) return false;
    if (f.trait && (card.traits || []).indexOf(f.trait) < 0) return false;
    if (f.hasTrigger && !(card.abilities || []).some(function (ab) { return ab.trigger === f.hasTrigger; })) return false;
    return true;
  }
  SB.consumeStaticDiscounts = function (state, playerIdx, cardId) {
    const card = SB.card(cardId);
    SB.allUnits(state, playerIdx).forEach(function (u) {
      (SB.unitDef(u).abilities || []).forEach(function (ab) {
        if (ab.trigger !== 'constant' || !ab.grant || !ab.grant.costDiscount) return;
        const d = ab.grant.costDiscount;
        if (d.oncePerRound && discountMatches(card, d.filter) && u.discountUsedRound !== state.round) {
          u.discountUsedRound = state.round;
        }
      });
    });
  };

  // Upgrades that make the bearer count as a leader unit / provide aspect icons.
  SB.bearerCountsAsLeader = function (unit) {
    return unit.upgrades.some(function (inst) { return (SB.card(inst.cardId).staticFlags || []).indexOf('bearerIsLeader') >= 0; });
  };
  // True if a unit's own printed staticFlags, or any upgrade attached to it, carry
  // `flag` — an upgrade grants its own staticFlags to its bearer (sor-072 style).
  SB.unitHasGrantedStaticFlag = function (state, unit, flag) {
    if (!unit) return false;
    if ((SB.unitDef(unit).staticFlags || []).indexOf(flag) >= 0) return true;
    return unit.upgrades.some(function (inst) { return (SB.card(inst.cardId).staticFlags || []).indexOf(flag) >= 0; });
  };
  const prevPlayerAspects = SB.playerAspects;
  SB.playerAspects = function (state, playerIdx) {
    let a = prevPlayerAspects(state, playerIdx);
    if (!state || !state.ground) return a;
    SB.allUnits(state, playerIdx).forEach(function (u) {
      if (u.upgrades.some(function (inst) { return (SB.card(inst.cardId).staticFlags || []).indexOf('providesAspects') >= 0; })) {
        a = a.concat(SB.card(u.cardId).aspects || []);
      }
    });
    return a;
  };

  // ---- selectors ------------------------------------------------------------
  // Post-filter for selector keys effects.js does not know. Keep describeTarget in
  // text.js in step with every key here.
  SB.extraSelector = function (state, controller, sel, ctx, u) {
    if (sel.minRemHp != null && SB.unitRemainingHp(state, u) < sel.minRemHp) return false;
    if (sel.upgraded && u.upgrades.length === 0) return false;
    if (sel.notUpgraded && u.upgrades.length > 0) return false;
    if (sel.powerLessThanSomeFriendly) {
      const p = SB.unitPower(state, u);
      if (!SB.allUnits(state, controller).some(function (f) { return f.uid !== u.uid && SB.unitPower(state, f) > p; })) return false;
    }
    if (sel.sameArenaAsPlayed) {
      const pu = ctx.playedUid != null ? SB.findUnit(state, ctx.playedUid) : null;
      if (!pu || SB.arenaOf(state, pu) !== SB.arenaOf(state, u)) return false;
    }
    if (sel.sameArenaAsSource) {
      const su = SB.findUnit(state, ctx.sourceUid);
      if (!su || SB.arenaOf(state, su) !== SB.arenaOf(state, u)) return false;
    }
    if (sel.maxCostRefMilled) {
      const costs = SB.efx(state, ctx).milledCosts || [];
      const c = costs.length ? costs[costs.length - 1] : null;
      if (c == null || SB.costOf(u.cardId) > c) return false;
    }
    if (sel.notCardIs && sel.notCardIs.indexOf(u.cardId) >= 0) return false;
    // "...that costs X or less or an exhausted ...that costs Y or less" (jtl-223):
    // a ready unit only qualifies under the low threshold; an exhausted one may
    // also qualify under the higher one.
    if (sel.costOrExhaustedCost) {
      const cc = sel.costOrExhaustedCost;
      const cost = SB.costOf(u.cardId);
      if (!(cost <= cc.max || (u.exhausted && cost <= cc.exhaustedMax))) return false;
    }
    if (sel.arenaRef) {
      const a = SB.efx(state, ctx)[sel.arenaRef];
      if (!a || SB.arenaOf(state, u) !== a) return false;
    }
    if (sel.aspectRef) {
      const a = SB.efx(state, ctx)[sel.aspectRef];
      if (!a || (SB.card(u.cardId).aspects || []).indexOf(a) < 0) return false;
    }
    if (sel.hasShieldOrExperience && !(u.shields > 0 || u.experience > 0)) return false;
    if (sel.notLeaderPilotBearer && u.upgrades.some(function (i) { return i.leaderPilot; })) return false;
    if (sel.hasShield && !(u.shields > 0)) return false;
    return true;
  };

  // ---- conditions -------------------------------------------------------------
  SB.extraConditions = {
    moreCardsInHandThanOpponent: function (state, c) {
      return state.players[c].hand.length > state.players[SB.other(c)].hand.length;
    },
    enteredThisPhaseAtLeast: function (state, c, cond) {
      return SB.allUnits(state, c).filter(function (u) { return u.enteredRound === state.round; }).length >= cond.n;
    },
    unitLeftPlayThisPhase: function (state) {
      return (state.defeatedThisPhase || []).length > 0 || (state.leftPlayThisPhase || 0) > 0;
    },
    attackedWithTraitThisPhase: function (state, c, cond) {
      return (state.attackedThisPhase || []).some(function (a) {
        if (a.owner !== c) return false;
        if (cond.nonToken && SB.card(a.cardId).token) return false;
        return a.traits.indexOf(cond.trait) >= 0;
      });
    },
    controlUnitsAtLeast: function (state, c, cond) { return SB.allUnits(state, c).length >= cond.n; },
    onlyFriendlyNonLeaderGroundUnit: function (state, c, cond, ctx) {
      return state.ground.filter(function (u) { return u.owner === c && SB.card(u.cardId).type !== 'leader'; })
        .every(function (u) { return u.uid === ctx.sourceUid; });
    },
    savedGone: function (state, c, cond, ctx) {
      const t = saved(state, ctx, cond.name);
      return !!t && t.kind === 'unit' && !SB.findUnit(state, t.uid);
    },
    storedAtLeast: function (state, c, cond, ctx) { return (SB.efx(state, ctx)[cond.name] || 0) >= cond.n; },
    milledHasAspect: function (state, c, cond, ctx) {
      const a = SB.efx(state, ctx).milledAspects || [];
      return a.length > 0 && a[a.length - 1].indexOf(cond.aspect) >= 0;
    },
    discardHasAspect: function (state, c, cond) {
      return state.players[c].discard.some(function (inst) { return (SB.card(inst.cardId).aspects || []).indexOf(cond.aspect) >= 0; });
    },
    controlNonUniqueUnit: function (state, c, cond, ctx) {
      return SB.allUnits(state, c).some(function (u) { return !SB.card(u.cardId).unique && u.uid !== ctx.sourceUid; });
    },
    // The mirror of controlNonUniqueUnit: cards print "a champion unit" for a unique one.
    controlUniqueUnit: function (state, c, cond, ctx) {
      return SB.allUnits(state, c).some(function (u) { return !!SB.card(u.cardId).unique && u.uid !== (ctx || {}).sourceUid; });
    },
    controlDamagedUnit: function (state, c) { return SB.allUnits(state, c).some(function (u) { return u.damage > 0; }); },
    moreSpaceUnitsThanOpponent: function (state, c) {
      const mine = state.space.filter(function (u) { return u.owner === c; }).length;
      return mine > state.space.length - mine;
    },
    selfPowerAtLeast: function (state, c, cond, ctx) {
      const self = SB.findUnit(state, ctx.sourceUid);
      return !!self && SB.unitPowerNoAura(state, self) >= cond.n;
    },
    noOtherAttacksThisPhase: function (state, c, cond, ctx) {
      const me = ctx.attackEndedUid != null ? ctx.attackEndedUid : ctx.sourceUid;
      return (state.attackedThisPhase || []).every(function (a) { return a.uid === me; });
    },
    leaderHasTrait: function (state, c, cond) {
      return (SB.card(state.players[c].leader.cardId).traits || []).indexOf(cond.trait) >= 0;
    },
    bearerHasAspect: function (state, c, cond, ctx) {
      const b = SB.findUnit(state, ctx.sourceUid);
      return !!b && (SB.card(b.cardId).aspects || []).indexOf(cond.aspect) >= 0;
    },
    bearerHasNoneOfAspects: function (state, c, cond, ctx) {
      const b = SB.findUnit(state, ctx.sourceUid);
      return !!b && !(SB.card(b.cardId).aspects || []).some(function (a) { return cond.aspects.indexOf(a) >= 0; });
    },
    savedMaxCost: function (state, c, cond, ctx) {
      const u = savedUnit(state, ctx, cond.name);
      return !!u && SB.costOf(u.cardId) <= cond.n;
    },
    creditsAtLeast: function (state, c, cond) { return (state.players[c].credits || 0) >= cond.n; },
    opponentHasCredits: function (state, c) { return (state.players[SB.other(c)].credits || 0) > 0; },
    baseRemHpAtMost: function (state, c, cond) {
      const b = state.players[c].base;
      return SB.card(b.cardId).hp - b.damage <= cond.n;
    },
    controlUnitWithTraitAny: function (state, c, cond) {
      return SB.allUnits(state, c).some(function (u) { return SB.unitTraits(state, u).indexOf(cond.trait) >= 0; });
    },
    controlCapitalOrTrait: function (state, c, cond) {
      return SB.allUnits(state, c).some(function (u) { return SB.unitTraits(state, u).indexOf(cond.trait) >= 0; });
    },
    savedIsCard: function (state, c, cond, ctx) {
      const u = savedUnit(state, ctx, cond.name);
      return !!u && cond.cards.indexOf(u.cardId) >= 0;
    },
    playedThisPhaseHasTrait: function (state, c, cond) {
      // cond.traits (array) is an OR of kinds (jtl-186: Bounty Hunter or Pilot);
      // cond.trait (single) is the older, still-supported shape.
      const wanted = cond.traits || (cond.trait != null ? [cond.trait] : []);
      return (state.players[c].playedThisPhase || []).some(function (cid) {
        const traits = SB.card(cid).traits || [];
        return wanted.some(function (t) { return traits.indexOf(t) >= 0; });
      });
    },
    fewerResourcesThanOpponent: function (state, c) {
      return state.players[c].resources.length < state.players[SB.other(c)].resources.length;
    },
    opponentControlsNoGroundUnits: function (state, c) {
      return !state.ground.some(function (u) { return u.owner === SB.other(c); });
    },
    // "If you discarded a card from your hand or deck this phase" (law-076).
    discardedThisPhase: function (state, c) {
      return (state.players[c].discardedThisPhase || []).length > 0;
    },
    // "A unit with the highest cost among enemy units is defeated" (law-053):
    // at the moment this fires the defeated unit has already left play, so the
    // check is whether its cost was >= every unit still owned by the same player.
    defeatedWasHighestCostEnemy: function (state, c, cond, ctx) {
      const entry = (state.defeatedThisPhase || []).slice().reverse()
        .find(function (d) { return d.uid === ctx.defeatedUid; });
      if (!entry) return false;
      const cost = SB.costOf(entry.cardId);
      return SB.allUnits(state, entry.owner).every(function (u) { return SB.costOf(u.cardId) <= cost; });
    },
  };

  // ---- amount refs -------------------------------------------------------------
  SB.extraAmounts = function (state, item, target, ref) {
    const ctx = item.ctx || {};
    if (ref === 'powerOfPlayed') {
      const u = ctx.playedUid != null ? SB.findUnit(state, ctx.playedUid) : null;
      return u ? SB.unitPower(state, u) : 0;
    }
    if (ref === 'friendlySpaceCount') return state.space.filter(function (u) { return u.owner === item.controller; }).length;
    if (ref === 'handSize') return state.players[item.controller].hand.length;
    if (ref === 'defeatedPower') return ctx.defeatedPower || 0;
    if (ref === 'playedCardCost') return ctx.playedCardCost || 0;
    if (ref === 'creditsOwned') return state.players[item.controller].credits || 0;
    if (ref === 'resourcesOwned') return state.players[item.controller].resources.length;
    if (ref === 'friendlyTraitCount') {
      const trait = item.op.trait;
      return SB.allUnits(state, item.controller).filter(function (u) { return SB.unitTraits(state, u).indexOf(trait) >= 0; }).length;
    }
    const m = ref.match(/^remHpOf:(.+)$/);
    if (m) { const u = savedUnit(state, ctx, m[1]); return u ? SB.unitRemainingHp(state, u) : 0; }
    return undefined;
  };

  // ---- small ops ----------------------------------------------------------------
  // Exhaust every unit matched by scope.
  O.exhaustAll = function (state, item) {
    SB.selectorCandidates(state, item.controller, item.op.scope, item.ctx || {}).forEach(function (c) {
      const u = SB.findUnit(state, c.uid);
      if (u && !u.exhausted) { u.exhausted = true; SB.log(state, { type: 'exhausted', uid: u.uid }); }
    });
  };
  // Exhaust up to N units, one at a time, player's choice of which (and whether to
  // stop early) — sor-203's "Exhaust up to 2 units."
  O.exhaustUpTo = function (state, item) {
    state.queue.unshift({ step: 'exhaustUpToPick', player: item.controller,
      remaining: item.op.amount || 1, target: item.op.target || { who: 'any', what: 'unit' }, ctx: item.ctx });
  };
  S.exhaustUpToPick = {
    actions: function (state, itemStep) {
      if (itemStep.remaining <= 0) return null;
      const cands = SB.selectorCandidates(state, itemStep.player, itemStep.target, itemStep.ctx || {})
        .filter(function (c) { const u = SB.findUnit(state, c.uid); return u && !u.exhausted; });
      if (cands.length === 0) return null;
      const acts = cands.map(function (c) { return { type: 'exhaustUpTo', player: itemStep.player, uid: c.uid }; });
      acts.push({ type: 'exhaustUpTo', player: itemStep.player, uid: null });
      return acts;
    },
    apply: function (state, itemStep, action) {
      if (action.uid == null) return;
      const u = SB.findUnit(state, action.uid);
      if (u && !u.exhausted) { u.exhausted = true; SB.log(state, { type: 'exhausted', uid: u.uid }); }
      if (itemStep.remaining - 1 > 0) {
        state.queue.unshift({ step: 'exhaustUpToPick', player: itemStep.player,
          remaining: itemStep.remaining - 1, target: itemStep.target, ctx: itemStep.ctx });
      }
    },
  };
  // Reveal any number of resources, one at a time, stopping whenever the player
  // likes; every unit revealed this way is then played for free, one at a time, in
  // the order it was revealed — shd-109. A non-unit revealed this way simply stays
  // a resource. Playing one of the revealed units removes it from the resource row
  // exactly like any other card played from resources (the row is topped back up
  // from the deck, same as js/ops.js's playHandPick zone:'resources' path used by
  // ash-001) — so an unrevealed resource stays exactly as available to pay for
  // anything else resolving alongside this event, and a played one stops being
  // available the moment it is played, not before.
  // Reveal up to `upTo` hand cards sharing an aspect icon, then give this unit an
  // Experience token for each card revealed this way (sor-035). Same requeue-until-
  // stop shape as revealResourcePick, just over the hand instead of the resource row.
  O.revealAspectForExperience = function (state, item) {
    state.queue.unshift({ step: 'revealAspectPick', player: item.controller, aspect: item.op.aspect,
      upTo: item.op.upTo || 1, revealed: [], ctx: item.ctx });
  };
  SB.queueSteps.revealAspectPick = {
    actions: function (state, itemStep) {
      const p = state.players[itemStep.player];
      const revealed = itemStep.revealed || [];
      const acts = [{ type: 'revealHandCard', player: itemStep.player, uid: null }];
      if (revealed.length < itemStep.upTo) {
        p.hand.forEach(function (inst) {
          if (revealed.indexOf(inst.uid) >= 0) return;
          if ((SB.card(inst.cardId).aspects || []).indexOf(itemStep.aspect) < 0) return;
          acts.push({ type: 'revealHandCard', player: itemStep.player, uid: inst.uid });
        });
      }
      return acts;
    },
    apply: function (state, itemStep, action) {
      if (action.uid == null) {
        const n = (itemStep.revealed || []).length;
        if (n > 0) SB.queueEffects(state, itemStep.player, [{ op: 'experience', amount: n, target: { self: true } }], itemStep.ctx);
        return;
      }
      const p = state.players[itemStep.player];
      const inst = p.hand.find(function (x) { return x.uid === action.uid; });
      if (inst) SB.log(state, { type: 'handCardRevealed', player: itemStep.player, cardId: inst.cardId });
      state.queue.unshift({ step: 'revealAspectPick', player: itemStep.player, aspect: itemStep.aspect,
        upTo: itemStep.upTo, revealed: (itemStep.revealed || []).concat([action.uid]), ctx: itemStep.ctx });
    },
  };
  O.revealResourcesPlayUnits = function (state, item) {
    state.queue.unshift({ step: 'revealResourcePick', player: item.controller, ctx: item.ctx, revealed: [] });
  };
  S.revealResourcePick = {
    actions: function (state, itemStep) {
      const p = state.players[itemStep.player];
      const revealed = itemStep.revealed || [];
      const cands = p.resources.filter(function (r) { return revealed.indexOf(r.instance.uid) < 0; });
      const acts = cands.map(function (r) { return { type: 'revealResource', player: itemStep.player, uid: r.instance.uid }; });
      acts.push({ type: 'revealResource', player: itemStep.player, uid: null });
      return acts;
    },
    apply: function (state, itemStep, action) {
      const p = state.players[itemStep.player];
      if (action.uid == null) {
        const revealed = itemStep.revealed || [];
        // Queue plays in reveal order: unshift the last-revealed unit first so the
        // first-revealed unit ends up at the front of the queue.
        revealed.slice().reverse().forEach(function (uid) {
          const r = p.resources.find(function (x) { return x.instance.uid === uid; });
          if (!r || SB.card(r.instance.cardId).type !== 'unit') return;
          state.queue.unshift({ step: 'playHandPick', player: itemStep.player, ctx: itemStep.ctx,
            filter: { uidIs: uid, type: 'unit' }, discount: 99, entersReady: false, defeatAtRegroup: false,
            optional: false, zones: ['resources'] });
        });
        return;
      }
      const r = p.resources.find(function (x) { return x.instance.uid === action.uid; });
      if (!r) return;
      SB.log(state, { type: 'resourceRevealed', player: itemStep.player, cardId: r.instance.cardId, uid: r.instance.uid });
      state.queue.unshift({ step: 'revealResourcePick', player: itemStep.player, ctx: itemStep.ctx,
        revealed: (itemStep.revealed || []).concat([action.uid]) });
    },
  };
  // Give a temporary keyword (numeric allowed) to every unit matched by scope.
  O.giveKeywordAll = function (state, item) {
    SB.selectorCandidates(state, item.controller, item.op.scope, item.ctx || {}).forEach(function (c) {
      const u = SB.findUnit(state, c.uid);
      if (!u) return;
      grantTempKeyword(u, item.op.k, item.op.n);
      SB.log(state, { type: 'gainedKeyword', uid: u.uid, k: item.op.k, sound: 'buff' });
    });
  };
  function grantTempKeyword(u, k, n) {
    if (n != null) { u.tempKeywordNs = u.tempKeywordNs || []; u.tempKeywordNs.push({ k: k, n: n }); }
    else { u.tempKeywords = u.tempKeywords || []; u.tempKeywords.push(k); }
  }
  // Spend credit tokens (fizzles if short).
  O.spendCredits = function (state, item) {
    const p = state.players[item.controller];
    if ((p.credits || 0) < item.op.amount) { SB.log(state, { type: 'fizzle', why: 'cantPay', fizzled: true }); return; }
    p.credits -= item.op.amount;
    SB.log(state, { type: 'creditSpent', player: item.controller });
  };
  // Hand this unit (the source) to the opponent.
  O.giveControlSelf = function (state, item) {
    const u = SB.findUnit(state, item.ctx && item.ctx.sourceUid);
    if (!u) return;
    u.owner = SB.other(u.owner);
    SB.log(state, { type: 'controlTaken', uid: u.uid, by: u.owner, sound: 'claim', notice: true });
  };
  // The attacking source lets the defender strike first this attack (law-086).
  O.defenderStrikesFirst = function (state, item) {
    const u = SB.findUnit(state, item.ctx && item.ctx.sourceUid);
    if (u) { u.defenderFirstNext = true; SB.log(state, { type: 'attackModified', uid: u.uid }); }
  };
  // A unit loses all abilities (and keywords) for this round.
  O.suppressAbilities = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (!u) return;
    u.abilitiesSuppressed = true;
    u.keywordsSuppressed = true;
    SB.log(state, { type: 'abilitiesSuppressed', uid: u.uid, sound: 'ability' });
  };
  // "The next unit you play this phase (matching filter) enters play ready."
  O.grantEntersReady = function (state, item) {
    const p = state.players[item.controller];
    p.entersReadyGrants = p.entersReadyGrants || [];
    p.entersReadyGrants.push({ filter: item.op.filter || {} });
    SB.log(state, { type: 'readyGrantArmed', player: item.controller, sound: 'buff' });
  };
  // Use the "When Defeated" abilities of another friendly unit without defeating it.
  O.useWhenDefeatedOf = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (!u) return;
    SB.unitAllAbilities(state, u).forEach(function (ab) {
      if (ab.trigger !== 'whenDefeated') return;
      SB.queueEffects(state, u.owner, ab.effects, { sourceUid: u.uid, cardId: u.cardId, condition: ab.condition });
    });
    SB.log(state, { type: 'abilityBorrowed', uid: u.uid, sound: 'ability' });
  };
  // Use again the "When Defeated" ability that just resolved (jtl-002 style).
  O.reuseAbility = function (state, item) {
    const r = state.lastWhenDefeated;
    if (!r || r.controller !== item.controller) { SB.log(state, { type: 'fizzle', why: 'nothingToRepeat', fizzled: true }); return; }
    const ctx = Object.assign({}, r.ctx); delete ctx.inv;
    SB.queueEffects(state, item.controller, r.effects, ctx);
    SB.log(state, { type: 'abilityRepeated', cardId: r.ctx.cardId, sound: 'ability' });
  };
  // Remove every copy of the saved unit's card from its controller's hand and deck.
  O.purgeCopies = function (state, item) {
    const cid = SB.efx(state, item.ctx)[item.op.ofSaved + 'CardId'];
    const who = SB.efx(state, item.ctx)[item.op.ofSaved + 'Owner'];
    if (!cid || who == null) return;
    const p = state.players[who];
    let n = 0;
    ['hand', 'deck'].forEach(function (zone) {
      p[zone] = p[zone].filter(function (inst) { if (inst.cardId === cid) { p.discard.push(inst); n++; return false; } return true; });
    });
    p.deck = SB.shuffled(p.deck, SB.rng(SB.stateSeed(state, 'purge')));
    SB.log(state, { type: 'copiesPurged', player: who, cardId: cid, amount: n, notice: true });
  };
  // Defeat: also remember the victim's card id / owner for follow-up ops.
  const prevDefeatOp = O.defeat;
  O.defeat = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (u && item.op.saveDefeatedAs) {
      const st = SB.efx(state, item.ctx);
      st[item.op.saveDefeatedAs + 'CardId'] = u.cardId;
      st[item.op.saveDefeatedAs + 'Owner'] = u.owner;
      st[item.op.saveDefeatedAs + 'Uid'] = u.uid;
    }
    prevDefeatOp(state, item, target);
  };
  // Defeat every unit in scope and remember how many enemies fell.
  const prevDefeatAll = O.defeatAll;
  O.defeatAll = function (state, item) {
    if (item.op.saveEnemyCountAs) {
      const n = SB.selectorCandidates(state, item.controller, item.op.scope, item.ctx || {})
        .filter(function (c) { const u = SB.findUnit(state, c.uid); return u && u.owner !== item.controller; }).length;
      SB.efx(state, item.ctx)[item.op.saveEnemyCountAs] = n;
    }
    prevDefeatAll(state, item);
  };
  // damageAll may take an amountRef.
  const prevDamageAll = O.damageAll;
  O.damageAll = function (state, item) {
    if (item.op.amountRef == null) return prevDamageAll(state, item);
    const amt = SB.resolveAmount(state, item, null) || 0;
    const cands = SB.selectorCandidates(state, item.controller, item.op.scope, item.ctx || {});
    const units = cands.map(function (c) { return SB.findUnit(state, c.uid); }).filter(Boolean);
    units.forEach(function (u) { SB.damageUnit(state, u, amt, item.ctx); });
  };
  // Defeat all upgrades on a chosen unit.
  O.defeatAllUpgradesOn = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (!u) return;
    u.upgrades.slice().forEach(function (inst) { SB.removeUpgrade(state, u, inst, 'defeated'); });
    if (SB.findUnit(state, u.uid) && SB.unitRemainingHp(state, u) <= 0) SB.defeatUnit(state, u, item.ctx);
  };
  // Return every upgrade on a chosen unit to its owner's HAND. Deliberately not
  // SB.removeUpgrade: that path discards the upgrade and fires its "When Defeated",
  // and a card that hands the upgrade back does neither.
  O.returnUpgradesToHandOn = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (!u) return;
    const maxCost = item.op.maxCost;
    u.upgrades.slice().forEach(function (inst) {
      if (maxCost != null && (SB.card(inst.cardId).cost || 0) > maxCost) return;
      const i = u.upgrades.indexOf(inst);
      if (i < 0) return;
      u.upgrades.splice(i, 1);
      const owner = SB.upgradeOwner(u, inst);
      if (!SB.card(inst.cardId).token) state.players[owner].hand.push(inst);
      SB.log(state, { type: 'returnedToHand', player: owner, cardId: inst.cardId });
    });
    if (SB.findUnit(state, u.uid) && SB.unitRemainingHp(state, u) <= 0) SB.defeatUnit(state, u, item.ctx);
  };
  // Defeat every Shield token on a chosen unit (jtl-180). Leaves the unit itself
  // in play so a following op (via saveTargetAs/useTarget) can still act on it.
  O.defeatShieldsOn = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (!u || u.shields <= 0) return;
    const n = u.shields;
    u.shields = 0;
    SB.log(state, { type: 'shieldsDefeated', uid: u.uid, amount: n, sound: 'shield' });
  };
  // Return this upgrade card (just defeated) from its owner's discard pile to hand.
  O.selfUpgradeToHand = function (state, item) {
    const uid = item.ctx && item.ctx.upgradeInstUid;
    const who = item.controller;
    const p = state.players[who];
    const i = p.discard.findIndex(function (inst) { return inst.uid === uid; });
    if (i < 0) return;
    p.hand.push(p.discard.splice(i, 1)[0]);
    SB.log(state, { type: 'tookFromDiscard', player: who, sound: 'draw' });
  };
  // Distribute N advantage tokens among units matched by scope, one at a time
  // (optional: the player may stop early; count saved when asked).
  O.dividedAdvantage = function (state, item) {
    const total = item.op.amountRef ? (SB.resolveAmount(state, item, null) || 0) : (item.op.amount || 0);
    if (total <= 0) return;
    state.queue.unshift({ step: 'advantagePoint', player: item.controller, left: total, given: 0,
      scope: item.op.scope || { who: 'friendly', what: 'unit' }, optional: !!item.op.optional,
      saveCountAs: item.op.saveCountAs, ctx: item.ctx });
  };
  S.advantagePoint = {
    actions: function (state, it) {
      if (it.left <= 0) return null;
      const acts = SB.selectorCandidates(state, it.player, it.scope, it.ctx || {})
        .filter(function (c) { return c.kind === 'unit'; })
        .map(function (c) { return { type: 'advantageTo', player: it.player, uid: c.uid }; });
      if (!acts.length) return null;
      if (it.optional) acts.push({ type: 'advantageTo', player: it.player, uid: null });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.uid == null) { finish(state, it); return; }
      const u = SB.findUnit(state, action.uid);
      if (u) { u.advantage = (u.advantage || 0) + 1; SB.log(state, { type: 'advantage', uid: u.uid, amount: 1, sound: 'buff' }); }
      const next = Object.assign({}, it, { left: it.left - 1, given: it.given + 1 });
      if (next.left > 0) state.queue.unshift(next); else finish(state, next);
    },
  };
  function finish(state, it) {
    if (it.saveCountAs && it.ctx) SB.efx(state, it.ctx)[it.saveCountAs] = it.given;
  }

  // Choose an aspect (stored under saveAs for later ops).
  O.chooseAspect = function (state, item) {
    state.queue.unshift({ step: 'aspectPick', player: item.controller, saveAs: item.op.saveAs || 'aspect', ctx: item.ctx });
  };
  S.aspectPick = {
    actions: function (state, it) {
      return ['vigilance', 'command', 'aggression', 'cunning', 'heroism', 'villainy'].map(function (a) {
        return { type: 'pickAspect', player: it.player, aspect: a };
      });
    },
    apply: function (state, it, action) {
      SB.efx(state, it.ctx || {})[it.saveAs] = action.aspect;
      SB.log(state, { type: 'aspectChosen', player: it.player, aspect: action.aspect });
    },
  };
  // Choose an arena (stored under saveAs).
  O.chooseArena = function (state, item) {
    state.queue.unshift({ step: 'arenaPick', player: item.controller, saveAs: item.op.saveAs || 'arena', ctx: item.ctx });
  };
  S.arenaPick = {
    actions: function (state, it) {
      return [{ type: 'pickArena', player: it.player, arena: 'ground' }, { type: 'pickArena', player: it.player, arena: 'space' }];
    },
    apply: function (state, it, action) {
      SB.efx(state, it.ctx || {})[it.saveAs] = action.arena;
      SB.log(state, { type: 'arenaChosen', player: it.player, arena: action.arena });
    },
  };
  // Mill 1 and note the milled card's aspects (law-018).
  const prevMill = O.mill;
  O.mill = function (state, item) {
    const who = item.op.who === 'opponent' ? SB.other(item.controller) : item.controller;
    const p = state.players[who];
    const before = p.discard.length;
    prevMill(state, item);
    const milled = p.discard.slice(before);
    SB.efx(state, item.ctx).milledAspects = milled.map(function (inst) { return SB.card(inst.cardId).aspects || []; });
    milled.forEach(function (inst) { SB.noteDiscarded(state, who, inst, true); });
  };
  SB.extraConditions.milledHasChosenAspect = function (state, c, cond, ctx) {
    const st = SB.efx(state, ctx);
    const a = st[cond.name || 'aspect'];
    const m = st.milledAspects || [];
    return !!a && m.length > 0 && m[m.length - 1].indexOf(a) >= 0;
  };

  // Put a card from hand on the top or bottom of your deck.
  O.handToDeckTopOrBottom = function (state, item) {
    state.queue.unshift({ step: 'handToDeckPick', player: item.controller });
  };
  S.handToDeckPick = {
    actions: function (state, it) {
      const p = state.players[it.player];
      if (!p.hand.length) return null;
      const acts = [];
      p.hand.forEach(function (inst, i) {
        acts.push({ type: 'handToDeck', player: it.player, handIndex: i, where: 'top' });
        acts.push({ type: 'handToDeck', player: it.player, handIndex: i, where: 'bottom' });
      });
      return acts;
    },
    apply: function (state, it, action) {
      const p = state.players[it.player];
      const inst = p.hand.splice(action.handIndex, 1)[0];
      if (action.where === 'top') p.deck.unshift(inst); else p.deck.push(inst);
      SB.log(state, { type: action.where === 'top' ? 'toppedCard' : 'bottomedCard', player: it.player });
    },
  };

  // Deal up to N damage to your own base in steps of `per`; the next unit you play
  // this phase costs 1 less per step (ash-027).
  O.selfBaseDamageForDiscount = function (state, item) {
    state.queue.unshift({ step: 'selfBurnPick', player: item.controller, max: item.op.max || 6, per: item.op.per || 2 });
  };
  S.selfBurnPick = {
    actions: function (state, it) {
      const acts = [];
      for (let n = 0; n <= it.max; n += it.per) acts.push({ type: 'selfBurn', player: it.player, amount: n });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.amount <= 0) return;
      SB.damageBase(state, it.player, action.amount, 'selfEffect');
      const p = state.players[it.player];
      p.discounts = p.discounts || [];
      p.discounts.push({ amount: Math.floor(action.amount / it.per), remaining: 1, filter: { type: 'unit' } });
      SB.log(state, { type: 'discountGranted', player: it.player, sound: 'buff' });
    },
  };

  // Defeat any number of non-leader units with total remaining HP <= budget; queue
  // `perDefeat` effects once for each unit defeated this way (ash-053).
  O.defeatBudget = function (state, item) {
    state.queue.unshift({ step: 'defeatBudgetPick', player: item.controller, budget: item.op.budget,
      perDefeat: item.op.perDefeat || [], ctx: item.ctx, scope: item.op.scope || { who: 'any', what: 'unit', nonLeader: true } });
  };
  S.defeatBudgetPick = {
    actions: function (state, it) {
      const acts = [{ type: 'budgetDefeat', player: it.player, uid: null }];
      SB.selectorCandidates(state, it.player, it.scope, it.ctx || {}).forEach(function (c) {
        const u = SB.findUnit(state, c.uid);
        if (!u || SB.unitRemainingHp(state, u) > it.budget) return;
        acts.push({ type: 'budgetDefeat', player: it.player, uid: u.uid });
      });
      return acts.length > 1 ? acts : null;
    },
    apply: function (state, it, action) {
      if (action.uid == null) return;
      const u = SB.findUnit(state, action.uid);
      if (!u) return;
      const hp = SB.unitRemainingHp(state, u);
      SB.defeatUnit(state, u, it.ctx || {});
      if (it.perDefeat.length) SB.queueEffects(state, it.player, it.perDefeat, it.ctx || {});
      const rest = it.budget - hp;
      if (rest > 0) state.queue.push({ step: 'defeatBudgetPick', player: it.player, budget: rest, perDefeat: it.perDefeat, ctx: it.ctx, scope: it.scope });
    },
  };

  // Attach a friendly pilot unit (or move a pilot upgrade) onto the source unit (jtl-038).
  O.attachUnitAsPilot = function (state, item) {
    const bearer = SB.findUnit(state, item.ctx && item.ctx.sourceUid);
    if (!bearer) return;
    state.queue.unshift({ step: 'pilotAttachPick', player: item.controller, bearerUid: bearer.uid, optional: item.op.optional !== false });
  };
  S.pilotAttachPick = {
    actions: function (state, it) {
      const bearer = SB.findUnit(state, it.bearerUid);
      if (!bearer || SB.hasPilot(state, bearer)) return null;
      const acts = [];
      SB.allUnits(state, it.player).forEach(function (u) {
        if (u.uid === bearer.uid) return;
        if (SB.unitTraits(state, u).indexOf('tr30') >= 0 && SB.card(u.cardId).type === 'unit') {
          acts.push({ type: 'pilotFromUnit', player: it.player, uid: u.uid });
        }
        u.upgrades.forEach(function (inst, ui) {
          const c = SB.card(inst.cardId);
          if (inst.leaderPilot || (c.traits || []).indexOf('tr30') < 0) return;
          acts.push({ type: 'pilotFromUpgrade', player: it.player, uid: u.uid, index: ui });
        });
      });
      if (!acts.length) return null;
      if (it.optional) acts.push({ type: 'pilotFromUnit', player: it.player, uid: null });
      return acts;
    },
    apply: function (state, it, action) {
      const bearer = SB.findUnit(state, it.bearerUid);
      if (!bearer || action.uid == null) return;
      if (action.type === 'pilotFromUnit') {
        SB.unitToUpgrade(state, SB.findUnit(state, action.uid), bearer);
      } else {
        const src = SB.findUnit(state, action.uid);
        if (!src) return;
        const inst = src.upgrades.splice(action.index, 1)[0];
        bearer.upgrades.push(inst);
        SB.log(state, { type: 'attached', uid: bearer.uid, cardId: inst.cardId, sound: 'attach' });
        // "When a Pilot attaches to this unit" observers (jtl-223) — both branches
        // above are filtered to trait tr30 (Pilot) in `actions`.
        SB.fireTriggers(state, 'onPilotAttached', bearer, { sourceUid: bearer.uid });
      }
    },
  };
  // A unit in play becomes an upgrade on `bearer` (its own upgrades are defeated,
  // its damage removed).
  SB.unitToUpgrade = function (state, unit, bearer) {
    if (!unit || !bearer) return;
    unit.upgrades.slice().forEach(function (inst) { SB.removeUpgrade(state, unit, inst, 'defeated'); });
    const arena = SB.arenaOf(state, unit);
    state[arena].splice(state[arena].indexOf(unit), 1);
    const inst = { uid: unit.uid, cardId: unit.cardId, owner: unit.owner };
    bearer.upgrades.push(inst);
    SB.log(state, { type: 'attached', uid: bearer.uid, cardId: inst.cardId, sound: 'attach' });
    // Its only caller filters to trait tr30 (Pilot) units.
    SB.fireTriggers(state, 'onPilotAttached', bearer, { sourceUid: bearer.uid });
  };
  // A pilot upgrade leaves its bearer and enters the ground arena as an exhausted unit.
  SB.upgradeToGroundUnit = function (state, bearer, inst) {
    const i = bearer.upgrades.indexOf(inst);
    if (i >= 0) bearer.upgrades.splice(i, 1);
    const owner = inst.owner != null ? inst.owner : bearer.owner;
    const u = SB.makeUnit(state, inst.cardId, owner);
    u.uid = inst.uid;
    u.exhausted = true;
    state.ground.push(u);
    SB.log(state, { type: 'ejected', uid: u.uid, cardId: u.cardId, sound: 'deploy' });
  };

  // Move one shield or experience token from a unit to another unit (jtl-242).
  O.moveTokenCounter = function (state, item) {
    state.queue.unshift({ step: 'tokenSourcePick', player: item.controller, optional: item.op.optional !== false });
  };
  S.tokenSourcePick = {
    actions: function (state, it) {
      const acts = [];
      SB.allUnits(state).forEach(function (u) {
        if (u.shields > 0) acts.push({ type: 'tokenTake', player: it.player, uid: u.uid, kind: 'shield' });
        if (u.experience > 0) acts.push({ type: 'tokenTake', player: it.player, uid: u.uid, kind: 'experience' });
      });
      if (!acts.length) return null;
      if (it.optional) acts.push({ type: 'tokenTake', player: it.player, uid: null });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.uid == null) return;
      state.queue.unshift({ step: 'tokenDestPick', player: it.player, fromUid: action.uid, kind: action.kind });
    },
  };
  S.tokenDestPick = {
    actions: function (state, it) {
      const acts = [];
      SB.allUnits(state).forEach(function (u) {
        if (u.uid !== it.fromUid) acts.push({ type: 'tokenGive', player: it.player, uid: u.uid, kind: it.kind });
      });
      return acts.length ? acts : null;
    },
    apply: function (state, it, action) {
      const from = SB.findUnit(state, it.fromUid), to = SB.findUnit(state, action.uid);
      if (!from || !to) return;
      if (it.kind === 'shield' && from.shields > 0) { from.shields--; to.shields++; SB.log(state, { type: 'shield', uid: to.uid, sound: 'shield' }); }
      if (it.kind === 'experience' && from.experience > 0) {
        from.experience--; to.experience++;
        SB.log(state, { type: 'experience', uid: to.uid, amount: 1, sound: 'buff' });
        if (SB.unitRemainingHp(state, from) <= 0) SB.defeatUnit(state, from, {});
      }
    },
  };

  // Spend a credit token belonging to either player (law-191).
  O.spendAnyCredit = function (state, item) {
    state.queue.unshift({ step: 'creditPick', player: item.controller, optional: item.op.optional !== false, saveAs: item.op.saveAs, ctx: item.ctx });
  };
  S.creditPick = {
    actions: function (state, it) {
      const acts = [];
      [it.player, SB.other(it.player)].forEach(function (pi) {
        if ((state.players[pi].credits || 0) > 0) acts.push({ type: 'creditSpend', player: it.player, who: pi });
      });
      if (!acts.length) return null;
      if (it.optional) acts.push({ type: 'creditSpend', player: it.player, who: null });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.who == null) return;
      state.players[action.who].credits -= 1;
      SB.log(state, { type: 'creditSpent', player: action.who });
      if (it.saveAs && it.ctx) SB.efx(state, it.ctx)[it.saveAs] = 1;
    },
  };

  // Name a card: choose among the cards visible in the opponent's hand and discard
  // pile (DEVIATIONS.md). mode 'block' = they cannot play it; 'silence' = their copies
  // lose all abilities; 'costTax' = it costs `amount` more for opponents to play.
  // 'block'/'silence'/'costTax' last while the naming unit remains in play.
  // mode 'phaseBlock' (law-243) has no naming unit — it blocks for both players for
  // the rest of the current action phase (cleared in startActionPhase).
  O.nameCard = function (state, item) {
    const mode = item.op.mode || 'block';
    if (mode === 'phaseBlock') {
      state.queue.unshift({ step: 'namePick', player: item.controller, uid: null, mode: mode });
      return;
    }
    const src = SB.findUnit(state, item.ctx && item.ctx.sourceUid);
    if (!src) return;
    state.queue.unshift({ step: 'namePick', player: item.controller, uid: src.uid, mode: mode, amount: item.op.amount });
  };
  S.namePick = {
    actions: function (state, it) {
      const opp = state.players[SB.other(it.player)];
      const seen = {};
      opp.hand.concat(opp.discard).forEach(function (inst) { seen[inst.cardId] = true; });
      const acts = Object.keys(seen).map(function (cid) { return { type: 'nameCard', player: it.player, cardId: cid }; });
      return acts.length ? acts : null;
    },
    apply: function (state, it, action) {
      if (it.mode === 'phaseBlock') {
        state.phaseNamedBlocks = state.phaseNamedBlocks || [];
        state.phaseNamedBlocks.push({ cardId: action.cardId });
        SB.log(state, { type: 'cardNamed', cardId: action.cardId, player: it.player, notice: true });
        return;
      }
      const u = SB.findUnit(state, it.uid);
      if (!u) return;
      u.namedCard = action.cardId; u.namedMode = it.mode;
      if (it.mode === 'costTax') u.namedTaxAmount = it.amount || 3;
      SB.log(state, { type: 'cardNamed', uid: u.uid, cardId: action.cardId, notice: true });
    },
  };

  // Your base captures an enemy unit; it is rescued at the start of the regroup phase.
  O.captureToBase = function (state, item, target) {
    const victim = SB.findUnit(state, target.uid);
    if (!victim) return;
    SB.collectBounties(state, victim);
    const arena = SB.arenaOf(state, victim);
    state[arena].splice(state[arena].indexOf(victim), 1);
    const p = state.players[item.controller];
    p.baseCaptured = p.baseCaptured || [];
    p.baseCaptured.push({ uid: victim.uid, cardId: victim.cardId, owner: victim.owner, upgrades: victim.upgrades });
    SB.log(state, { type: 'captured', uid: victim.uid, cardId: victim.cardId, by: null, sound: 'capture' });
  };
  SB.releaseBaseCaptives = function (state) {
    state.players.forEach(function (p) {
      (p.baseCaptured || []).forEach(function (cap) {
        const u = SB.makeUnit(state, cap.cardId, cap.owner);
        u.uid = cap.uid; u.upgrades = cap.upgrades || [];
        state[SB.card(cap.cardId).arena].push(u);
        SB.log(state, { type: 'rescued', uid: u.uid, cardId: u.cardId });
      });
      p.baseCaptured = [];
    });
  };

  // Count a saved unit's on-attack abilities into a stored number (jtl-174).
  O.countOnAttackAbilities = function (state, item) {
    const u = savedUnit(state, item.ctx, item.op.ofSaved);
    SB.efx(state, item.ctx)[item.op.saveAs || 'n'] = u ? SB.unitAllAbilities(state, u).filter(function (ab) { return ab.trigger === 'onAttack'; }).length : 0;
  };
  // Clone: enter play as a copy of a non-leader, non-vehicle unit (twi-116).
  O.cloneEnter = function (state, item, target) {
    const self = SB.findUnit(state, item.ctx && item.ctx.sourceUid);
    const model = SB.findUnit(state, target.uid);
    if (!self || !model) return;
    self.copyOf = model.copyOf || model.cardId;
    SB.log(state, { type: 'cloned', uid: self.uid, cardId: self.copyOf, notice: true });
  };
  // The opponent may play the just-defeated unit from its owner's discard for free (jtl-221).
  O.opponentMayPlayDefeated = function (state, item) {
    const uid = item.ctx && item.ctx.sourceUid;
    if (uid == null) return;
    state.queue.unshift({ step: 'playHandPick', player: SB.other(item.controller), ctx: item.ctx,
      filter: { uidIs: uid }, discount: 99, entersReady: false, defeatAtRegroup: false, optional: true, zones: ['opponentDiscard'] });
  };

  // ---- extended queue steps -------------------------------------------------------
  // playHandPick: more zones (resources, opponentDiscard), upgrades with a bearer pick,
  // uid / stored-card filters, and a saved played unit.
  const prevPlayPick = S.playHandPick;
  S.playHandPick = {
    actions: function (state, it) {
      const zones = it.zones || ['hand'];
      const extra = zones.some(function (z) { return z === 'resources' || z === 'opponentDiscard'; });
      const f = it.filter || {};
      const wantsUpgrades = f.type === 'upgrade' || f.allowUpgrades;
      if (!extra && !wantsUpgrades && !f.uidIs && !f.uidRef && !f.cardIsRef) return prevPlayPick.actions(state, it);
      const p = state.players[it.player];
      const acts = [];
      function pile(z) {
        if (z === 'hand') return p.hand;
        if (z === 'discard') return p.discard;
        if (z === 'opponentDiscard') return state.players[SB.other(it.player)].discard;
        if (z === 'resources') return p.resources.map(function (r) { return r.instance; });
        return [];
      }
      zones.forEach(function (z) {
        pile(z).forEach(function (inst, i) {
          const card = SB.card(inst.cardId);
          if (f.uidIs != null && inst.uid !== f.uidIs) return;
          if (f.uidRef && SB.efx(state, it.ctx || {})[f.uidRef] !== inst.uid) return;
          if (f.cardIsRef && SB.efx(state, it.ctx || {})[f.cardIsRef] !== inst.cardId) return;
          if (f.type && card.type !== f.type) return;
          if (f.trait && (card.traits || []).indexOf(f.trait) < 0) return;
          if (f.maxCost != null && card.cost > f.maxCost) return;
          if (f.aspect && (card.aspects || []).indexOf(f.aspect) < 0) return;
          if (card.type === 'leader' || card.type === 'base') return;
          if (card.type === 'upgrade' && !wantsUpgrades) return;
          if (card.type !== 'upgrade' && f.type === 'upgrade') return;
          const cost = Math.max(0, SB.cardCost(state, it.player, inst.cardId) - it.discount);
          if (cost > SB.readyResources(state, it.player)) return;
          if (card.type === 'unit' && card.unique &&
              SB.allUnits(state, it.player).some(function (u) { return u.cardId === inst.cardId; })) return;
          if (card.type === 'upgrade') {
            SB.allUnits(state).forEach(function (u) {
              if (card.attachTo === 'friendly' && u.owner !== it.player) return;
              if (card.attachTo === 'enemy' && u.owner === it.player) return;
              if (!SB.attachAllowed(state, card, u)) return;
              if (f.bearerRef) { const t = SB.efx(state, it.ctx || {})[f.bearerRef]; if (!t || t.uid !== u.uid) return; }
              if (f.bearerPlayedThisRound && u.enteredRound !== state.round) return;
              if (f.bearerFriendly && u.owner !== it.player) return;
              acts.push({ type: 'playHandCard', player: it.player, handIndex: i, cardId: inst.cardId, zone: z, attachTo: u.uid });
            });
          } else {
            acts.push({ type: 'playHandCard', player: it.player, handIndex: i, cardId: inst.cardId, zone: z });
          }
        });
      });
      if (!acts.length) return null;
      if (it.optional) acts.push({ type: 'playHandCard', player: it.player, handIndex: -1 });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.handIndex === -1) return;
      const p = state.players[it.player];
      let playAction;
      if (action.zone === 'resources') {
        const r = p.resources[action.handIndex];
        if (!r || r.instance.cardId !== action.cardId) return;
        const inst = r.instance;
        if (p.deck.length) p.resources[action.handIndex] = { instance: p.deck.shift(), exhausted: r.exhausted };
        else p.resources.splice(action.handIndex, 1);
        playAction = { fromInst: inst, cardId: action.cardId, attachTo: action.attachTo };
      } else if (action.zone === 'opponentDiscard') {
        const od = state.players[SB.other(it.player)].discard;
        const inst = od.splice(action.handIndex, 1)[0];
        playAction = { fromInst: inst, cardId: action.cardId, attachTo: action.attachTo };
      } else if (action.zone === 'discard') {
        playAction = { fromDiscard: action.handIndex, cardId: action.cardId, attachTo: action.attachTo };
      } else {
        playAction = { handIndex: action.handIndex, cardId: action.cardId, attachTo: action.attachTo };
      }
      // The enumerator prices a candidate with the trait-dependent discount (a Force
      // unit costs 8 less instead of 6). Paying with only the flat discount made an
      // offered card unaffordable at apply time and threw.
      let discount = it.discount;
      if (it.discountByTrait) {
        const dbt = it.discountByTrait;
        discount = (SB.card(action.cardId).traits || []).indexOf(dbt.trait) >= 0 ? dbt.amount : dbt.otherwise;
      }
      SB.playCardWithMods(state, it.player, playAction,
        { discount: discount, entersReady: it.entersReady, defeatAtRegroup: it.defeatAtRegroup, returnAtRegroup: it.returnAtRegroup });
      const played = SB.allUnits(state, it.player).find(function (u) { return u.cardId === action.cardId && u.enteredRound === state.round; });
      if (it.ctx) {
        const st = SB.efx(state, it.ctx);
        st.playedOne = 1;
        if (played) st[it.savePlayedAs || 'played'] = { kind: 'unit', uid: played.uid };
      }
      const grantAmbush = it.withAmbush || (it.withAmbushIfCredit && state.lastPaymentUsedCredit);
      // A unit that already has ambush queued its own attack when it entered play;
      // granting it again would let it attack twice.
      if (grantAmbush && played && played.exhausted && SB.card(action.cardId).type === 'unit' &&
          !SB.hasKeyword(state, played, 'ambush')) {
        state.queue.push({ step: 'effect', controller: it.player,
          ctx: { sourceUid: played.uid, cardId: played.cardId }, op: { op: 'ambushAttack', target: null } });
      }
      if (it.withHidden && played) grantTempKeyword(played, 'hidden');
      if (it.entersReady && played) played.exhausted = false;
    },
  };
  const prevPlayFromHand = O.playFromHand;
  O.playFromHand = function (state, item) {
    prevPlayFromHand(state, item);
    const step = state.queue[0];
    if (step && step.step === 'playHandPick') {
      step.savePlayedAs = item.op.savePlayedAs;
      step.withHidden = !!item.op.withHidden;
      step.returnAtRegroup = !!item.op.returnAtRegroup;
    }
  };
  // Attach filters shared by every attach path.
  SB.attachAllowed = function (state, card, u) {
    if (card.attachArena && SB.arenaOf(state, u) !== card.attachArena) return false;
    const f = card.attachFilter;
    if (!f) return true;
    const traits = SB.unitTraits(state, u);
    if (f.notTrait && traits.indexOf(f.notTrait) >= 0) return false;
    if (f.trait && traits.indexOf(f.trait) < 0) return false;
    if (f.uniqueOnly && !SB.card(u.cardId).unique) return false;
    if (f.damaged && u.damage === 0) return false;
    return true;
  };

  // searchPick: opponent search, depth refs, budgets, discard-it / resource-it, saved
  // card id, upgrades played onto a saved bearer, and enters-ready / return mods.
  const prevSearch = S.searchPick;
  S.searchPick = {
    actions: function (state, it) {
      if (it.budget == null && !it.discardIt && !it.resourceIt && !it.attachToSaved) return prevSearch.actions(state, it);
      const p = state.players[it.player];
      const depth = it.depth || p.deck.length;
      const f = it.filter || {};
      const acts = [];
      p.deck.slice(0, depth).forEach(function (inst, i) {
        const c = SB.card(inst.cardId);
        if (f.type && c.type !== f.type) return;
        if (f.trait && (c.traits || []).indexOf(f.trait) < 0) return;
        if (f.arena && c.arena !== f.arena) return;
        if (it.budget != null) {
          if ((c.cost || 0) > it.budget) return;
          if (c.unique && SB.allUnits(state, it.player).some(function (u) { return u.cardId === inst.cardId; })) return;
        }
        if (it.attachToSaved) {
          const b = savedUnit(state, it.ctx, it.attachToSaved);
          if (!b || c.type !== 'upgrade' || !SB.attachAllowed(state, c, b)) return;
          const cost = Math.max(0, SB.cardCost(state, it.player, inst.cardId) - (it.playDiscount || 0));
          if (cost > SB.readyResources(state, it.player)) return;
        }
        acts.push({ type: 'searchTake', player: it.player, deckIndex: i });
      });
      if (!acts.length) return null;
      acts.push({ type: 'searchTake', player: it.player, deckIndex: -1 });
      return acts;
    },
    apply: function (state, it, action) {
      const p = state.players[it.player];
      const took = action.deckIndex >= 0;
      if (took) {
        const inst = p.deck[action.deckIndex];
        if (it.ctx) SB.efx(state, it.ctx).lastSearchedCardId = inst.cardId;
        if (it.discardIt) {
          p.deck.splice(action.deckIndex, 1); pushDiscardInst(state, it.player, inst);
          if (it.ctx) SB.efx(state, it.ctx).discardedCardId = inst.cardId;
          SB.log(state, { type: 'discarded', player: it.player, cardId: inst.cardId, sound: 'discard' });
        } else if (it.resourceIt) {
          p.deck.splice(action.deckIndex, 1);
          p.resources.push({ instance: inst, exhausted: false });
          SB.log(state, { type: 'resourced', player: it.player });
        } else if (it.budget != null) {
          const cost = SB.card(inst.cardId).cost || 0;
          SB.playCardWithMods(state, it.player, { fromDeckIndex: action.deckIndex, cardId: inst.cardId }, { discount: 99 });
          const rest = it.budget - cost;
          if (rest > 0) { state.queue.unshift(Object.assign({}, it, { budget: rest, depth: it.depth == null ? null : it.depth - 1 })); return; }
        } else if (it.attachToSaved) {
          const b = savedUnit(state, it.ctx, it.attachToSaved);
          if (b) SB.playCardWithMods(state, it.player, { fromDeckIndex: action.deckIndex, cardId: inst.cardId, attachTo: b.uid }, { discount: it.playDiscount || 0 });
        } else if (it.playIt) {
          SB.playCardWithMods(state, it.player, { fromDeckIndex: action.deckIndex, cardId: inst.cardId },
            { discount: it.playDiscount, entersReady: it.entersReady, returnAtRegroup: it.returnAtRegroup });
        } else {
          p.deck.splice(action.deckIndex, 1); p.hand.push(inst);
          SB.log(state, { type: 'searched', player: it.player });
        }
        if (it.remaining > 1) {
          state.queue.unshift(Object.assign({}, it, { remaining: it.remaining - 1, depth: it.depth == null ? null : it.depth - 1 }));
          return;
        }
      }
      p.deck = SB.shuffled(p.deck, SB.rng(SB.stateSeed(state, 'searchShuffle')));
      SB.log(state, { type: 'deckShuffled', player: it.player });
    },
  };
  const prevSearchOp = O.searchDeck;
  O.searchDeck = function (state, item) {
    const who = item.op.who === 'opponent' ? SB.other(item.controller) : item.controller;
    let depth = item.op.depth || null;
    if (item.op.depthRef) depth = (SB.efx(state, item.ctx)[item.op.depthRef] || 0) * (item.op.depthMul || 1);
    if (item.op.depthRef && depth <= 0) return;
    // Search doubling upgrade on the source unit.
    const src = SB.findUnit(state, item.ctx && item.ctx.sourceUid);
    if (depth && src && src.upgrades.some(function (i) { return (SB.card(i.cardId).staticFlags || []).indexOf('doubleSearch') >= 0; })) depth *= 2;
    state.queue.unshift({
      step: 'searchPick', player: who, filter: item.op.filter || {}, remaining: item.op.take || 1, depth: depth,
      playIt: !!item.op.playIt, playDiscount: item.op.playDiscount || 0, budget: item.op.budget,
      discardIt: !!item.op.discardIt, resourceIt: !!item.op.resourceIt, attachToSaved: item.op.attachToSaved,
      entersReady: !!item.op.entersReady, returnAtRegroup: !!item.op.returnAtRegroup, ctx: item.ctx,
    });
    void prevSearchOp;
  };

  // attackWith: power bonus from a ref, abilities borrowed from a discarded card, and
  // a saved-target attacker (useTarget) all flow through the existing step.
  const prevAttackWith = O.attackWith;
  O.attackWith = function (state, item, target) {
    if (item.op.bonusPowerRef) {
      item = Object.assign({}, item, { op: Object.assign({}, item.op, { bonusPower: (item.op.bonusPower || 0) + (SB.resolveAmount(state, { op: { amountRef: item.op.bonusPowerRef }, ctx: item.ctx, controller: item.controller }, target) || 0) }) });
    }
    if (item.op.abilitiesFromDiscarded) {
      const cid = SB.efx(state, item.ctx).discardedCardId;
      const u = SB.findUnit(state, target.uid);
      if (cid && u) {
        const c = SB.card(cid);
        if (c.abilities && c.abilities.length) u.tempAbilities = (u.tempAbilities || []).concat(c.abilities);
        if (c.keywords) c.keywords.forEach(function (kw) { grantTempKeyword(u, kw.k, kw.n); });
      }
    }
    if (item.op.defenderFirst) {
      const u = SB.findUnit(state, target.uid);
      if (u) u.defenderFirstNext = true;
    }
    // A stat bump for this attack, gated by an arbitrary condition (law-202: +2/+0
    // while you control fewer resources than an opponent).
    if (item.op.bonusIfCond && SB.checkCondition(state, item.controller, item.op.bonusIfCond.cond, item.ctx || {})) {
      const u = SB.findUnit(state, target.uid);
      if (u) { u.temp.power += item.op.bonusIfCond.power || 0; u.temp.hp += item.op.bonusIfCond.hp || 0; }
    }
    prevAttackWith(state, item, target);
  };

  // defeatUpgradePick: friendly-only, non-leader, optional, remember the bearer.
  const prevDefeatUpgradePick = S.defeatUpgradePick;
  S.defeatUpgradePick = {
    actions: function (state, it) {
      const acts = [];
      SB.allUnits(state).forEach(function (u) {
        if (it.friendlyOnly && u.owner !== it.player) return;
        if (it.bearerArena && SB.arenaOf(state, u) !== it.bearerArena) return;
        u.upgrades.forEach(function (inst, ui) {
          if (it.nonLeaderOnly && inst.leaderPilot) return;
          if (it.nonUniqueOnly && SB.card(inst.cardId).unique) return;
          acts.push({ type: 'defeatUpgrade', player: it.player, uid: u.uid, index: ui });
        });
      });
      if (!acts.length) return null;
      if (it.optional) acts.push({ type: 'defeatUpgrade', player: it.player, uid: null });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.uid == null) return;
      const u = SB.findUnit(state, action.uid);
      if (!u) return;
      if (it.ctx) {
        const st = SB.efx(state, it.ctx);
        if (it.saveBearerAs) st[it.saveBearerAs] = { kind: 'unit', uid: u.uid };
        if (it.saveAs) st[it.saveAs] = 1;
      }
      prevDefeatUpgradePick.apply(state, it, action);
    },
  };
  O.defeatUpgrade = function (state, item) {
    state.queue.unshift({ step: 'defeatUpgradePick', player: item.controller, friendlyOnly: !!item.op.friendlyOnly,
      nonLeaderOnly: !!item.op.nonLeaderOnly, nonUniqueOnly: !!item.op.nonUniqueOnly, optional: !!item.op.optional,
      saveBearerAs: item.op.saveBearerAs, saveAs: item.op.saveAs, bearerArena: item.op.bearerArena, ctx: item.ctx });
  };

  // discardChoice: aspect-sharing filter, optional decline, success flag.
  const prevDiscardChoice = S.discardChoice;
  S.discardChoice = {
    actions: function (state, it) {
      const base = prevDiscardChoice.actions(state, it);
      if (!base) return null;
      let acts = base;
      const f = it.filter || {};
      if (f.sharesAspectWithSaved) {
        const u = savedUnit(state, it.ctx, f.sharesAspectWithSaved);
        const asp = u ? (SB.card(u.cardId).aspects || []) : [];
        const p = state.players[it.player];
        acts = acts.filter(function (a) { return (SB.card(p.hand[a.handIndex].cardId).aspects || []).some(function (x) { return asp.indexOf(x) >= 0; }); });
      }
      if (f.notType) { const p = state.players[it.player]; acts = acts.filter(function (a) { return SB.card(p.hand[a.handIndex].cardId).type !== f.notType; }); }
      if (!acts.length) return null;
      if (it.optional) acts.push({ type: 'discardCard', player: it.forcedBy != null ? it.forcedBy : it.player, targetPlayer: it.player, handIndex: -1 });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.handIndex === -1) return;
      prevDiscardChoice.apply(state, it, action);
      const p = state.players[it.player];
      const inst = p.discard[p.discard.length - 1];
      if (inst) SB.noteDiscarded(state, it.player, inst);
      if (it.saveAs && it.ctx) SB.efx(state, it.ctx)[it.saveAs] = 1;
    },
  };
  O.discardFromOpponentHandChoice = function (state, item) {
    O.revealHand(state, item);
    state.queue.unshift({ step: 'discardChoice', player: SB.other(item.controller), forcedBy: item.controller, ctx: item.ctx,
      filter: item.op.filter, optional: !!item.op.optional, saveAs: item.op.saveAs });
  };
  const prevDiscardRandom = O.discardRandom;
  O.discardRandom = function (state, item) {
    const who = item.op.who === 'self' ? item.controller : SB.other(item.controller);
    const before = state.players[who].discard.length;
    prevDiscardRandom(state, item);
    state.players[who].discard.slice(before).forEach(function (inst) { SB.noteDiscarded(state, who, inst); });
  };

  // bottomDiscardPick / takeFromDiscardPick: cost and aspect filters.
  const prevBottomPick = S.bottomDiscardPick;
  S.bottomDiscardPick = {
    actions: function (state, it) {
      const base = prevBottomPick.actions(state, it);
      if (!base) return null;
      const f = it.filter || {};
      const acts = base.filter(function (a) {
        if (a.index < 0) return true;
        const pile = state.players[a.owner != null ? a.owner : it.player];
        const c = SB.card(pile.discard[a.index].cardId);
        if (f.maxCost != null && (c.cost || 0) > f.maxCost) return false;
        if (f.aspect && (c.aspects || []).indexOf(f.aspect) < 0) return false;
        return true;
      });
      return acts.length > 1 || it.count > 0 ? acts : null;
    },
    apply: prevBottomPick.apply,
  };
  const prevTakePick = S.takeFromDiscardPick;
  S.takeFromDiscardPick = {
    actions: function (state, it) {
      const base = prevTakePick.actions(state, it);
      if (!base) return null;
      const f = it.filter || {};
      const p = state.players[it.player];
      const acts = base.filter(function (a) {
        if (a.index < 0) return true;
        const c = SB.card(p.discard[a.index].cardId);
        if (f.maxCost != null && (c.cost || 0) > f.maxCost) return false;
        if (f.aspect && (c.aspects || []).indexOf(f.aspect) < 0) return false;
        return true;
      });
      return acts.some(function (a) { return a.index >= 0; }) ? acts : null;
    },
    apply: prevTakePick.apply,
  };

  // readyResource / discloseReveal for the other player.
  const prevReadyResource = O.readyResource;
  O.readyResource = function (state, item) {
    if (item.op.who !== 'opponent') return prevReadyResource(state, item);
    prevReadyResource(state, Object.assign({}, item, { controller: SB.other(item.controller) }));
  };
  const prevDisclose = O.discloseReveal;
  O.discloseReveal = function (state, item) {
    if (item.op.who !== 'opponent') return prevDisclose(state, item);
    prevDisclose(state, Object.assign({}, item, { controller: SB.other(item.controller) }));
  };
  // binaryChoice: the gate may be evaluated for the chooser rather than the controller.
  const prevBinaryPick = S.binaryPick;
  S.binaryPick = {
    actions: function (state, it) {
      if (!it.aGateFor) return prevBinaryPick.actions(state, it);
      const acts = [];
      if ((!it.aGate || SB.checkCondition(state, it.player, it.aGate, it.ctx || {})) &&
          SB.branchAffordable(state, it.controller, it.a)) acts.push({ type: 'binary', player: it.player, pick: 'a' });
      acts.push({ type: 'binary', player: it.player, pick: 'b' });
      return acts;
    },
    apply: prevBinaryPick.apply,
  };
  const prevBinary = O.binaryChoice;
  O.binaryChoice = function (state, item) {
    prevBinary(state, item);
    if (item.op.aGateFor === 'chooser') state.queue[0].aGateFor = 'chooser';
  };
  // createToken: fires "when you play or create a unit" observers and may save the token.
  const prevCreateToken = O.createToken;
  O.createToken = function (state, item) {
    const before = SB.allUnits(state).map(function (u) { return u.uid; });
    prevCreateToken(state, item);
    const made = SB.allUnits(state).filter(function (u) { return before.indexOf(u.uid) < 0; });
    if (!made.length) return;
    if (item.op.saveAs && item.ctx) SB.efx(state, item.ctx)[item.op.saveAs] = { kind: 'unit', uid: made[0].uid };
    made.forEach(function (tok) {
      SB.allUnits(state, tok.owner).forEach(function (obs) {
        if (obs.uid === tok.uid) return;
        SB.fireTriggers(state, 'onUnitPlayed', obs, { sourceUid: obs.uid, playedUid: tok.uid, playedCardId: tok.cardId, created: true });
      });
      if (SB.fireLeaderTrigger) SB.fireLeaderTrigger(state, tok.owner, 'onUnitPlayed', { playedUid: tok.uid, playedCardId: tok.cardId });
    });
  };
  // peekTop: play discount.
  const prevPeek = S.peekDecide;
  S.peekDecide = {
    actions: function (state, it) {
      if (!it.discount) return prevPeek.actions(state, it);
      const p = state.players[it.player];
      if (!p.deck.length) return null;
      const inst = p.deck[0], card = SB.card(inst.cardId);
      const acts = [];
      it.modes.forEach(function (m) {
        if (m !== 'play') { acts.push({ type: 'peekAct', player: it.player, mode: m }); return; }
        const cost = Math.max(0, SB.cardCost(state, it.player, inst.cardId) - it.discount);
        if (cost > SB.readyResources(state, it.player)) return;
        if (card.type === 'unit' && card.unique && SB.allUnits(state, it.player).some(function (u) { return u.cardId === inst.cardId; })) return;
        if (card.type === 'unit' || card.type === 'event') acts.push({ type: 'peekAct', player: it.player, mode: 'play', cardId: inst.cardId });
        else if (card.type === 'upgrade') SB.allUnits(state).forEach(function (u) {
          if (card.attachTo === 'friendly' && u.owner !== it.player) return;
          if (card.attachTo === 'enemy' && u.owner === it.player) return;
          if (!SB.attachAllowed(state, card, u)) return;
          acts.push({ type: 'peekAct', player: it.player, mode: 'play', cardId: inst.cardId, attachTo: u.uid });
        });
      });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.mode !== 'play' || !it.discount) return prevPeek.apply(state, it, action);
      const inst = state.players[it.player].deck[0];
      if (!inst) return;
      SB.playCardWithMods(state, it.player, { fromDeckTop: true, cardId: inst.cardId, attachTo: action.attachTo }, { discount: it.discount });
    },
  };
  O.peekTop = function (state, item) {
    state.queue.unshift({ step: 'peekDecide', player: item.controller, modes: item.op.modes, discount: item.op.free ? 99 : (item.op.discount || 0) });
  };
  // Look at the top `depth` cards of the deck, discard up to 1 of them, and put the
  // rest back on top (law-237: "Look at the top 3 cards ... You may discard 1 of them.
  // Put the rest back on top in any order."). Simplification per DEVIATIONS.md: the
  // kept cards return in their original relative order rather than a player-chosen one.
  // The player who LOOKS and the deck being looked at are not always the same: one
  // leader digs into the defending player's deck. `player` is the chooser throughout;
  // `deckPlayer` owns the cards. `required` drops the decline option for a card that
  // says discard rather than may discard.
  O.peekTopDiscardUpTo = function (state, item) {
    state.queue.unshift({ step: 'peekTopDiscardUpTo', player: item.controller,
      deckPlayer: item.op.who === 'opponent' ? SB.other(item.controller) : item.controller,
      required: !!item.op.required, depth: item.op.depth || 3 });
  };
  SB.queueSteps.peekTopDiscardUpTo = {
    actions: function (state, itemStep) {
      const p = state.players[itemStep.deckPlayer != null ? itemStep.deckPlayer : itemStep.player];
      const n = Math.min(itemStep.depth, p.deck.length);
      if (n === 0) return null;
      const acts = itemStep.required ? [] : [{ type: 'peekDiscardPick', player: itemStep.player, index: -1 }];
      for (let i = 0; i < n; i++) acts.push({ type: 'peekDiscardPick', player: itemStep.player, index: i });
      return acts.length ? acts : null;
    },
    apply: function (state, itemStep, action) {
      const owner = itemStep.deckPlayer != null ? itemStep.deckPlayer : itemStep.player;
      const p = state.players[owner];
      const n = Math.min(itemStep.depth, p.deck.length);
      const cards = p.deck.splice(0, n);
      if (action.index >= 0) {
        const inst = cards.splice(action.index, 1)[0];
        p.discard.push(inst);
        SB.log(state, { type: 'discarded', player: owner, cardId: inst.cardId, sound: 'discard' });
      }
      cards.slice().reverse().forEach(function (c) { p.deck.unshift(c); });
      SB.log(state, { type: 'arrangedTop', player: owner });
    },
  };
  // takeControl: returned to its owner when the source unit leaves play.
  const prevTakeControl = O.takeControl;
  O.takeControl = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (u && (SB.unitDef(u).staticFlags || []).indexOf('noControlChange') >= 0) {
      SB.log(state, { type: 'fizzle', why: 'immune', fizzled: true }); return;
    }
    const original = u ? u.owner : null;
    prevTakeControl(state, item, target);
    if (u && item.op.untilSourceLeaves && item.ctx && item.ctx.sourceUid != null) {
      u.controlBond = { srcUid: item.ctx.sourceUid, originalOwner: original };
    }
  };
  // Indirect damage: a dealer with the assignOwnIndirect static assigns the points.
  const prevIndirect = O.indirectDamage;
  O.indirectDamage = function (state, item) {
    const before = state.queue.length;
    prevIndirect(state, item);
    const own = SB.allUnits(state, item.controller).some(function (u) { return (SB.unitDef(u).staticFlags || []).indexOf('assignOwnIndirect') >= 0; });
    if (!own) return;
    for (let i = 0; i < state.queue.length - before; i++) {
      const q = state.queue[i];
      if (q.step === 'indirectPoint' && q.player !== item.controller) { q.assignedBy = item.controller; q.victim = q.player; }
    }
  };
  const prevIndirectPoint = S.indirectPoint;
  S.indirectPoint = {
    actions: function (state, it) {
      if (it.assignedBy == null) return prevIndirectPoint.actions(state, it);
      const v = it.victim;
      const acts = [{ type: 'indirectTo', player: it.assignedBy, target: { kind: 'base', player: v } }];
      SB.allUnits(state, v).forEach(function (u) { acts.push({ type: 'indirectTo', player: it.assignedBy, target: { kind: 'unit', uid: u.uid } }); });
      return acts;
    },
    apply: prevIndirectPoint.apply,
  };

  // ---- upgrade defeat plumbing ----------------------------------------------------
  // Every path that removes an upgrade goes through here so "When Defeated" on the
  // upgrade itself, ejecting pilots, and "when a friendly upgrade is defeated"
  // observers all fire from one place.
  SB.removeUpgrade = function (state, bearer, inst, why) {
    const i = bearer.upgrades.indexOf(inst);
    if (i < 0) return;
    const card = SB.card(inst.cardId);
    if (why === 'defeated' && !inst.leaderPilot && (card.staticFlags || []).indexOf('ejectOnDefeat') >= 0) {
      SB.upgradeToGroundUnit(state, bearer, inst);
      return;
    }
    bearer.upgrades.splice(i, 1);
    if (inst.leaderPilot) {
      SB.sidelineLeaderPilot(state, bearer, inst, { defeated: why === 'defeated', log: true });
      return;
    }
    const owner = SB.upgradeOwner(bearer, inst);
    if (!card.token) state.players[owner].discard.push(inst);
    if (why === 'defeated') {
      SB.log(state, { type: 'upgradeDefeated', uid: bearer.uid, cardId: inst.cardId, sound: 'destroy' });
      const bearerTraits = SB.unitTraits(state, bearer);
      (card.abilities || []).forEach(function (ab) {
        if (ab.trigger !== 'whenDefeated') return;
        SB.queueEffects(state, owner, ab.effects, { cardId: inst.cardId, upgradeInstUid: inst.uid, bearerUid: bearer.uid,
          bearerTraits: bearerTraits, bearerFriendly: bearer.owner === owner, condition: ab.condition });
      });
      SB.allUnits(state, owner).forEach(function (obs) {
        SB.fireTriggers(state, 'onFriendlyUpgradeDefeated', obs, { sourceUid: obs.uid });
      });
    }
  };
  SB.extraConditions.bearerWasFriendlyWithTrait = function (state, c, cond, ctx) {
    return !!ctx.bearerFriendly && (ctx.bearerTraits || []).indexOf(cond.trait) >= 0;
  };
  // Route the older upgrade-removal paths through the shared helper.
  S.defeatUpgradePick.apply = (function (orig) {
    return function (state, it, action) {
      if (action.uid == null) return orig(state, it, action);
      const u = SB.findUnit(state, action.uid);
      if (!u) return;
      if (it.ctx) {
        const st = SB.efx(state, it.ctx);
        if (it.saveBearerAs) st[it.saveBearerAs] = { kind: 'unit', uid: u.uid };
        if (it.saveAs) st[it.saveAs] = 1;
      }
      const inst = u.upgrades[action.index];
      if (!inst) return;
      SB.removeUpgrade(state, u, inst, 'defeated');
      if (SB.findUnit(state, u.uid) && SB.unitRemainingHp(state, u) <= 0) SB.defeatUnit(state, u, {});
    };
  })(S.defeatUpgradePick.apply);
  O.defeatDefenderUpgrades = function (state, item) {
    const t = item.ctx && item.ctx.attackTarget;
    const u = t && t.kind === 'unit' ? SB.findUnit(state, t.uid) : null;
    if (!u) return;
    u.upgrades.slice().forEach(function (inst) { SB.removeUpgrade(state, u, inst, 'defeated'); });
    SB.log(state, { type: 'upgradesDefeated', uid: u.uid, sound: 'destroy' });
    if (SB.unitRemainingHp(state, u) <= 0) SB.defeatUnit(state, u, {});
  };
  O.defeatUpgradeOn = function (state, item) {
    const uid = item.ctx && item.ctx.damagedUid;
    const u = uid != null ? SB.findUnit(state, uid) : null;
    if (!u) return;
    const inst = u.upgrades.find(function (i2) { return !SB.card(i2.cardId).unique && !i2.leaderPilot; });
    if (!inst) return;
    SB.removeUpgrade(state, u, inst, 'defeated');
    if (SB.unitRemainingHp(state, u) <= 0) SB.defeatUnit(state, u, {});
  };

  // ---- damage hooks ------------------------------------------------------------------
  // Replacement effects on damage (see DEVIATIONS.md for the auto-choice rules):
  //  - shieldRedirect: another friendly unit with the static pops one of its shields to
  //    prevent damage that would defeat the target;
  //  - sacrificeToPrevent: the target's controller defeats their cheapest other unit
  //    sharing a kind with it to prevent damage that would defeat it;
  //  - underworldUnpreventable: damage from an underworld source whose controller has
  //    the static ignores the target's shields.
  const prevDamageUnit = SB.damageUnit;
  SB.damageUnit = function (state, unit, amount, ctx) {
    if (amount <= 0) return;
    ctx = ctx || {};
    const lethal = amount >= SB.unitRemainingHp(state, unit);
    if (lethal) {
      const guard = SB.allUnits(state, unit.owner).find(function (f) {
        return f.uid !== unit.uid && f.shields > 0 && (SB.unitDef(f).staticFlags || []).indexOf('shieldRedirect') >= 0;
      });
      if (guard) { guard.shields -= 1; SB.log(state, { type: 'shieldPopped', uid: guard.uid, sound: 'shield' }); return; }
      if ((SB.unitDef(unit).staticFlags || []).indexOf('sacrificeToPrevent') >= 0) {
        const traits = SB.unitTraits(state, unit);
        const cands = SB.allUnits(state, unit.owner).filter(function (f) {
          return f.uid !== unit.uid && SB.unitTraits(state, f).some(function (t) { return traits.indexOf(t) >= 0; });
        }).sort(function (a, b) { return SB.costOf(a.cardId) - SB.costOf(b.cardId); });
        if (cands.length) { SB.defeatUnit(state, cands[0], {}); SB.log(state, { type: 'damagePrevented', uid: unit.uid }); return; }
      }
    }
    if (unit.shields > 0) {
      const srcUnit = ctx.sourceUid != null ? SB.findUnit(state, ctx.sourceUid) : null;
      const dealer = ctx.dealer != null ? ctx.dealer : (srcUnit ? srcUnit.owner : ctx.controller);
      const srcTraits = srcUnit ? SB.unitTraits(state, srcUnit) : (ctx.cardId ? (SB.card(ctx.cardId).traits || []) : []);
      if (dealer != null && dealer !== unit.owner && srcTraits.indexOf('tr45') >= 0 &&
          SB.allUnits(state, dealer).some(function (f) { return (SB.unitDef(f).staticFlags || []).indexOf('underworldUnpreventable') >= 0; })) {
        unit.shields = 0;
        SB.log(state, { type: 'shieldsSabotaged', uid: unit.uid, sound: 'shield' });
      }
    }
    prevDamageUnit(state, unit, amount, ctx);
    if (!SB.findUnit(state, unit.uid)) return;
    // Survived: observers on both sides ("a friendly unit" includes the observer itself).
    SB.allUnits(state, unit.owner).forEach(function (obs) {
      SB.fireTriggers(state, 'onFriendlyDamagedSurvives', obs, { sourceUid: obs.uid, damagedUid: unit.uid });
    });
    const srcUnit2 = ctx.sourceUid != null ? SB.findUnit(state, ctx.sourceUid) : null;
    const dealer2 = ctx.dealer != null ? ctx.dealer : (srcUnit2 ? srcUnit2.owner : ctx.controller);
    if (dealer2 != null && dealer2 !== unit.owner) {
      SB.allUnits(state, dealer2).forEach(function (obs) {
        SB.fireTriggers(state, 'onFriendlyDealsDamageToEnemyUnit', obs, { sourceUid: obs.uid, damagedUid: unit.uid });
      });
      if (SB.fireLeaderTrigger) SB.fireLeaderTrigger(state, dealer2, 'onFriendlyDealsDamageToEnemyUnit', { damagedUid: unit.uid });
    }
  };
  // Defeat hooks: remember the victim's power, fire enemy-defeated observers, return
  // control-bonded units, count units leaving play, and route upgrades through
  // SB.removeUpgrade so their own "When Defeated" fires.
  const prevDefeatUnit = SB.defeatUnit;
  SB.defeatUnit = function (state, unit, ctx) {
    if (!SB.findUnit(state, unit.uid)) return;
    ctx = ctx || {};
    ctx.defeatedPower = SB.unitPower(state, unit);
    // Ejecting pilots leave before the defeat; every other upgrade is discarded by the
    // base routine (which also collects their bounties), then their own "When
    // Defeated" and the friendly-upgrade observers fire from here.
    unit.upgrades.slice().forEach(function (inst) {
      if (!inst.leaderPilot && (SB.card(inst.cardId).staticFlags || []).indexOf('ejectOnDefeat') >= 0) SB.removeUpgrade(state, unit, inst, 'defeated');
    });
    const ups = unit.upgrades.slice();
    const bearerTraits = SB.unitTraits(state, unit);
    const owner = unit.owner;
    // Remember the defeated unit's When Defeated abilities for "use it again" effects.
    const wd = SB.unitAllAbilities(state, unit).filter(function (ab) { return ab.trigger === 'whenDefeated'; });
    // Abilities lent by an aura cannot be found once the unit has left the board, so
    // their last words are queued from here.
    const auraWd = [];
    SB.auraGrants(state, unit).forEach(function (g) {
      (g.abilities || []).forEach(function (ab) { if (ab.trigger === 'whenDefeated') auraWd.push(ab); });
    });
    // shd-001's aura: "gains: When Defeated: return an upgrade that was attached to
    // this unit to its owner's hand" — snapshot which upgrades were on it, since
    // they are already discarded by the time the aura-lent ability resolves.
    const formerUpgrades = unit.upgrades.filter(function (inst) {
      return !inst.leaderPilot && !SB.card(inst.cardId).token;
    }).map(function (inst) { return { uid: inst.uid, owner: SB.upgradeOwner(unit, inst) }; });
    prevDefeatUnit(state, unit, ctx);
    auraWd.forEach(function (ab) {
      SB.queueEffects(state, owner, ab.effects, { sourceUid: unit.uid, cardId: unit.cardId, condition: ab.condition,
        defeatedPower: ctx.defeatedPower, formerUpgrades: formerUpgrades });
    });
    ups.forEach(function (inst) {
      if (inst.leaderPilot) return;
      const card = SB.card(inst.cardId);
      const upOwner = inst.owner != null ? inst.owner : owner;
      (card.abilities || []).forEach(function (ab) {
        if (ab.trigger !== 'whenDefeated') return;
        SB.queueEffects(state, upOwner, ab.effects, { cardId: inst.cardId, upgradeInstUid: inst.uid, bearerUid: unit.uid,
          bearerTraits: bearerTraits, bearerFriendly: owner === upOwner, condition: ab.condition });
      });
      SB.allUnits(state, upOwner).forEach(function (obs) {
        SB.fireTriggers(state, 'onFriendlyUpgradeDefeated', obs, { sourceUid: obs.uid });
      });
    });
    state.leftPlayThisPhase = (state.leftPlayThisPhase || 0) + 1;
    if (wd.length) {
      state.lastWhenDefeated = { controller: unit.owner, effects: [].concat.apply([], wd.map(function (ab) { return ab.effects; })),
        ctx: { sourceUid: unit.uid, cardId: unit.cardId } };
      SB.allUnits(state, unit.owner).forEach(function (obs) {
        SB.fireTriggers(state, 'onWhenDefeatedUsed', obs, { sourceUid: obs.uid });
      });
      if (SB.fireLeaderTrigger) SB.fireLeaderTrigger(state, unit.owner, 'onWhenDefeatedUsed', {});
    }
    SB.allUnits(state, SB.other(unit.owner)).forEach(function (obs) {
      SB.fireTriggers(state, 'onEnemyUnitDefeated', obs, { sourceUid: obs.uid, defeatedUid: unit.uid });
    });
    SB.allUnits(state).filter(function (u) { return u.controlBond && u.controlBond.srcUid === unit.uid; }).forEach(function (u) {
      u.owner = u.controlBond.originalOwner; delete u.controlBond;
      SB.log(state, { type: 'controlTaken', uid: u.uid, by: u.owner, sound: 'claim', notice: true });
    });
    revertResourceBonds(state, unit.uid);
  };
  // Bounce also counts as leaving play and releases control bonds.
  const prevReturnHand = O.returnHand;
  O.returnHand = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (u && (SB.unitDef(u).staticFlags || []).indexOf('noControlChange') >= 0 && u.owner !== item.controller) {
      SB.log(state, { type: 'fizzle', why: 'immune', fizzled: true }); return;
    }
    if (u) {
      const ups = u.upgrades.slice(); u.upgrades = [];
      ups.forEach(function (inst) { SB.removeUpgrade(state, { uid: u.uid, owner: u.owner, upgrades: [inst], cardId: u.cardId }, inst, 'returned'); });
    }
    prevReturnHand(state, item, target);
    if (u && !SB.findUnit(state, u.uid)) {
      state.leftPlayThisPhase = (state.leftPlayThisPhase || 0) + 1;
      SB.allUnits(state).filter(function (x) { return x.controlBond && x.controlBond.srcUid === u.uid; }).forEach(function (x) {
        x.owner = x.controlBond.originalOwner; delete x.controlBond;
      });
      revertResourceBonds(state, u.uid);
    }
  };
  // A resource taken under a unit's control (shd-213) reverts to its original
  // owner the moment that unit leaves play, same idea as controlBond for units but
  // tracked separately since a resource instance isn't a unit.
  function revertResourceBonds(state, leftUid) {
    if (!state.resourceBonds || !state.resourceBonds.length) return;
    const keep = [];
    state.resourceBonds.forEach(function (b) {
      if (b.srcUid !== leftUid) { keep.push(b); return; }
      const holder = state.players[b.newOwner];
      const idx = holder.resources.findIndex(function (r) { return r.instance.uid === b.resUid; });
      if (idx >= 0) {
        const r = holder.resources.splice(idx, 1)[0];
        state.players[b.originalOwner].resources.push(r);
        SB.log(state, { type: 'controlTaken', player: b.originalOwner, sound: 'claim', notice: true });
      }
    });
    state.resourceBonds = keep;
  }
  // "Take control of an enemy resource. When this unit leaves play, that
  // resource's owner takes control of it." (shd-213).
  O.takeControlResource = function (state, item) {
    state.queue.unshift({ step: 'takeControlResourcePick', player: item.controller, ctx: item.ctx });
  };
  SB.queueSteps.takeControlResourcePick = {
    actions: function (state, itemStep) {
      const opp = state.players[SB.other(itemStep.player)];
      if (!opp.resources.length) return null;
      return opp.resources.map(function (r, i) { return { type: 'takeControlResourcePick', player: itemStep.player, index: i }; });
    },
    apply: function (state, itemStep, action) {
      const foe = SB.other(itemStep.player);
      const opp = state.players[foe];
      const r = opp.resources.splice(action.index, 1)[0];
      if (!r) return;
      state.players[itemStep.player].resources.push(r);
      const srcUid = itemStep.ctx && itemStep.ctx.sourceUid;
      if (srcUid != null) {
        state.resourceBonds = state.resourceBonds || [];
        state.resourceBonds.push({ resUid: r.instance.uid, srcUid: srcUid, originalOwner: foe, newOwner: itemStep.player });
      }
      SB.log(state, { type: 'resourceControlled', player: itemStep.player });
    },
  };
  // Return a chosen unit to the top or bottom of ITS OWNER'S deck — the owner's
  // choice, not the caster's (lof-200: "Its owner puts it on the top or bottom of
  // their deck.").
  O.returnDeckTopOrBottom = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (!u) return;
    const arena = SB.arenaOf(state, u);
    state[arena].splice(state[arena].indexOf(u), 1);
    const card = SB.card(u.cardId);
    const owner = u.owner;
    u.upgrades.forEach(function (inst) {
      if (!SB.card(inst.cardId).token) state.players[SB.upgradeOwner(u, inst)].discard.push(inst);
    });
    SB.log(state, { type: 'returnedToDeck', uid: u.uid, cardId: u.cardId, player: owner });
    if (!card.token) {
      state.queue.unshift({ step: 'deckTopOrBottomPick', player: owner, cardId: u.cardId, uid: u.uid });
    }
  };
  SB.queueSteps.deckTopOrBottomPick = {
    actions: function (state, itemStep) {
      return [
        { type: 'deckPlace', player: itemStep.player, where: 'top' },
        { type: 'deckPlace', player: itemStep.player, where: 'bottom' },
      ];
    },
    apply: function (state, itemStep, action) {
      const p = state.players[itemStep.player];
      const inst = { uid: itemStep.uid, cardId: itemStep.cardId };
      if (action.where === 'top') p.deck.unshift(inst); else p.deck.push(inst);
    },
  };
  // Return every unit matched by scope to its owner's hand (shd-233).
  O.returnHandAll = function (state, item) {
    const uids = SB.selectorCandidates(state, item.controller, item.op.scope, item.ctx || {}).map(function (c) { return c.uid; });
    uids.forEach(function (uid) {
      const u = SB.findUnit(state, uid);
      if (u) O.returnHand(state, item, { kind: 'unit', uid: uid });
    });
  };

  // ---- fireTriggers: the combined ability list, pilot sides, silence --------------
  SB.fireTriggers = function (state, trigger, unit, ctx) {
    SB.unitAllAbilities(state, unit).forEach(function (ab) {
      if (ab.trigger !== trigger) return;
      if (ab.playedTrait && (!ctx || !ctx.playedCardId ||
          (SB.card(ctx.playedCardId).traits || []).indexOf(ab.playedTrait) < 0)) return;
      if (ab.playedUnique && (!ctx || !ctx.playedCardId || !SB.card(ctx.playedCardId).unique)) return;
      if (ab.playedType && (!ctx || !ctx.playedCardId || SB.card(ctx.playedCardId).type !== ab.playedType)) return;
      if (ab.notCreated && ctx && ctx.created) return;
      // "When a friendly <trait> unit's attack ends" (law-007's unit side).
      if (ab.attackerTrait) {
        const au = ctx && ctx.attackEndedUid != null ? SB.findUnit(state, ctx.attackEndedUid) : null;
        if (!au || SB.unitTraits(state, au).indexOf(ab.attackerTrait) < 0) return;
      }
      const effectCtx = {
        viaTrigger: true,   // see js/effects.js fireTriggers
        sourceUid: unit.uid, cardId: unit.cardId, condition: ab.condition,
        playedCardId: ctx && ctx.playedCardId, bearerUid: ctx && ctx.bearerUid,
        attackerUid: ctx && ctx.attackerUid, attackTarget: ctx && ctx.attackTarget,
        damagedUid: ctx && ctx.damagedUid, paidCost: ctx && ctx.paidCost,
        defenderDefeated: ctx && ctx.defenderDefeated, healedAmount: ctx && ctx.healedAmount,
        baseDamageDealt: ctx && ctx.baseDamageDealt, attackEndedUid: ctx && ctx.attackEndedUid,
        defeatedUid: ctx && ctx.defeatedUid, playedUid: ctx && ctx.playedUid,
        combat: ctx && ctx.combat, defenderDamagedNonLeader: ctx && ctx.defenderDamagedNonLeader,
        defeatedPower: ctx && ctx.defeatedPower, playedCardCost: ctx && ctx.playedCardCost,
        controller: unit.owner, formerUpgrades: ctx && ctx.formerUpgrades,
      };
      if (ab.oncePerRoundTrigger) {
        if (unit.triggerUsedRound === state.round) return;
        // A trigger paired with a condition (law-053) only spends its once-per-round
        // use when it actually goes off — see js/effects.js fireTriggers for why
        // this has to happen before the flag is consumed, not at effect resolution.
        if (ab.condition && !SB.checkCondition(state, unit.owner, ab.condition, effectCtx)) return;
        unit.triggerUsedRound = state.round;
      }
      SB.queueEffects(state, unit.owner, ab.effects, effectCtx);
    });
  };
  // Aura-granted abilities must not be re-collected through auraGrants of the source
  // itself; auraGrants reads only printed constant abilities, so no cycle.

  // ---- chooseTwoModes: "Choose two, in any order:" mode lists ---------------------
  // {op:'chooseTwoModes', modes:[{effects:[...]}, ...], count:2}. The player picks one
  // still-unpicked mode, it resolves FULLY (its own effects may themselves raise
  // choices), then — if picks remain — the same step re-offers the modes not yet
  // taken. A mode is always offered even when it currently has no legal effect: its
  // effects simply fizzle through the normal no-candidate/no-saved-target paths
  // (see SB.drainQueue), so the choice never hangs waiting for a target that can't
  // exist.
  O.chooseTwoModes = function (state, item) {
    state.queue.unshift({ step: 'modeChoicePick', player: item.controller, controller: item.controller,
      modes: item.op.modes, remaining: item.op.count || 2, picked: [], ctx: item.ctx });
  };
  S.modeChoicePick = {
    actions: function (state, itemStep) {
      if (itemStep.remaining <= 0) return null;
      const acts = [];
      itemStep.modes.forEach(function (m, i) {
        if (itemStep.picked.indexOf(i) >= 0) return;
        acts.push({ type: 'chooseMode', player: itemStep.player, index: i });
      });
      return acts;
    },
    apply: function (state, itemStep, action) {
      const i = action.index;
      const mode = itemStep.modes[i];
      SB.log(state, { type: 'modeChosen', player: itemStep.controller, cardId: itemStep.ctx && itemStep.ctx.cardId });
      const remaining = itemStep.remaining - 1;
      const picked = itemStep.picked.concat([i]);
      if (remaining > 0) {
        state.queue.unshift({ step: 'modeChoicePick', player: itemStep.player, controller: itemStep.controller,
          modes: itemStep.modes, remaining: remaining, picked: picked, ctx: itemStep.ctx });
      }
      SB.queueEffects(state, itemStep.controller, mode.effects, itemStep.ctx || {});
    },
  };

  // ---- useTarget: '@damaged' -------------------------------------------------------
  const prevDrain = SB.drainQueue;
  SB.drainQueue = function (state) {
    // Rewrite '@damaged' into a stored target before the base driver looks at it.
    if (state.queue.length && state.queue[0].step === 'effect' && state.queue[0].op && state.queue[0].op.useTarget === '@damaged') {
      const it = state.queue[0];
      const uid = it.ctx && it.ctx.damagedUid;
      SB.efx(state, it.ctx || {}).damagedTarget = uid != null ? { kind: 'unit', uid: uid } : null;
      it.op = Object.assign({}, it.op, { useTarget: 'damagedTarget' });
    }
    prevDrain(state);
  };
  // Keep going when a rewritten item is not at the head: apply the same rewrite lazily.
  const prevExecOp = SB.execOp;
  SB.execOp = function (state, item, target) {
    prevExecOp(state, item, target);
    if (state.queue.length && state.queue[0].step === 'effect' && state.queue[0].op && state.queue[0].op.useTarget === '@damaged') {
      const it = state.queue[0];
      const uid = it.ctx && it.ctx.damagedUid;
      SB.efx(state, it.ctx || {}).damagedTarget = uid != null ? { kind: 'unit', uid: uid } : null;
      it.op = Object.assign({}, it.op, { useTarget: 'damagedTarget' });
    }
  };

  // ==== tournament cluster c2 extensions ====================================

  // A unit's power/hp scaling with how many resources its controller has in play
  // (ts26-050): plugs into the existing dynamicStat/dynamicCount machinery above.
  const prevDynamicCount = dynamicCount;
  dynamicCount = function (state, unit, kind) {
    if (kind === 'resourcesOwned') return state.players[unit.owner].resources.length;
    return prevDynamicCount(state, unit, kind);
  };

  // Snapshot a unit's power the instant before it leaves play in SB.defeatUnit, so a
  // "When Defeated" ability can still read/gate on "this unit's power" after the
  // unit itself is gone (sec-035, jtl-104).
  const prevDefeatUnitC2 = SB.defeatUnit;
  SB.defeatUnit = function (state, unit, ctx) {
    state.defeatPowerSnapshot = state.defeatPowerSnapshot || {};
    state.defeatPowerSnapshot[unit.uid] = SB.unitPower(state, unit);
    return prevDefeatUnitC2(state, unit, ctx);
  };
  SB.extraConditions.selfPowerWasAtLeast = function (state, c, cond, ctx) {
    const p = state.defeatPowerSnapshot && state.defeatPowerSnapshot[ctx.sourceUid];
    return (p || 0) >= cond.n;
  };

  // "You control another <trait> card (unit, upgrade, or leader)" — control checked
  // across every zone a card can sit in while in play, not just units (jtl-104).
  SB.extraConditions.controlsTraitCardAnywhere = function (state, c, cond, ctx) {
    const trait = cond.trait;
    if (SB.allUnits(state, c).some(function (u) { return u.uid !== ctx.sourceUid && SB.unitTraits(state, u).indexOf(trait) >= 0; })) return true;
    if (SB.allUnits(state, c).some(function (u) { return u.upgrades.some(function (inst) { return (SB.card(inst.cardId).traits || []).indexOf(trait) >= 0; }); })) return true;
    const leader = state.players[c].leader;
    return leader && (SB.card(leader.cardId).traits || []).indexOf(trait) >= 0;
  };

  // "An opponent controls a unit of trait X" (lof-118).
  SB.extraConditions.opponentControlsUnitWithTrait = function (state, c, cond) {
    return SB.allUnits(state, SB.other(c)).some(function (u) { return SB.unitTraits(state, u).indexOf(cond.trait) >= 0; });
  };

  // ---- amount refs: enemy-units-defeated-this-phase, double unit count, and a
  // defeated unit's snapshotted power (see SB.defeatUnit wrapper above).
  const prevExtraAmounts = SB.extraAmounts;
  SB.extraAmounts = function (state, item, target, ref) {
    const ctx = item.ctx || {};
    if (ref === 'enemyDefeatedThisPhaseCount') {
      return (state.defeatedThisPhase || []).filter(function (d) { return d.owner === SB.other(item.controller); }).length;
    }
    if (ref === 'doubleControlledUnits') return SB.allUnits(state, item.controller).length * 2;
    if (ref === 'powerOfDefeatedSource') {
      return (state.defeatPowerSnapshot && state.defeatPowerSnapshot[ctx.sourceUid]) || 0;
    }
    // Friendly units at or above a printed remaining-HP threshold (lof-121: "for
    // each friendly unit with 7 or more remaining HP"). The threshold rides on the
    // op as minRemHp, the same shape as friendlyTraitCount's op.trait.
    if (ref === 'friendlyMinRemHpCount') {
      const min = item.op.minRemHp || 0;
      return SB.allUnits(state, item.controller).filter(function (u) { return SB.unitRemainingHp(state, u) >= min; }).length;
    }
    return prevExtraAmounts(state, item, target, ref);
  };

  // draw, with an amountRef (draw doesn't take one natively — see buffTempRef for
  // the same pattern applied to buffTemp).
  O.drawRef = function (state, item) {
    let who = item.controller;
    if (item.op.who === 'opponent') who = SB.other(item.controller);
    const n = SB.resolveAmount(state, item, null) || 0;
    if (n > 0) SB.drawCards(state, who, n);
  };

  // A unit that already left play (defeated, its {uid,cardId} pushed to discard by
  // SB.defeatUnit) returns itself to its owner's hand instead of staying discarded
  // (sec-035's "if this unit had 7 or more power, return him to his owner's hand").
  O.selfDefeatedToHand = function (state, item) {
    const owner = state.players[item.controller];
    const uid = item.ctx && item.ctx.sourceUid;
    const i = owner.discard.findIndex(function (inst) { return inst.uid === uid; });
    if (i < 0) return;
    const inst = owner.discard.splice(i, 1)[0];
    owner.hand.push(inst);
    SB.log(state, { type: 'returnedToHand', player: item.controller, cardId: inst.cardId, sound: 'returnHand' });
  };

  // Return another friendly unit to hand and remember its printed cost, so a
  // follow-up op can read "the returned unit's cost" even though the unit is gone
  // by the time that op runs (ash-038).
  O.returnHandSaveCost = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (!u) return;
    SB.efx(state, item.ctx)[item.op.saveCostAs || 'rc'] = SB.costOf(u.cardId);
    O.returnHand(state, item, target);
  };

  // Choose a unit, then pay resources one at a time (unbounded — capped only by
  // resources actually available), granting an experience token to that chosen
  // unit for each one paid (sec-040's "pay any number of resources").
  O.payForExperienceOn = function (state, item) {
    state.queue.unshift({ step: 'payXpTargetPick', player: item.controller,
      target: item.op.target || { who: 'any', what: 'unit', nonLeader: true }, ctx: item.ctx });
  };
  S.payXpTargetPick = {
    actions: function (state, itemStep) {
      const cands = SB.selectorCandidates(state, itemStep.player, itemStep.target, itemStep.ctx || {});
      if (!cands.length) return null;
      return cands.map(function (c) { return { type: 'payXpTargetPick', player: itemStep.player, uid: c.uid }; });
    },
    apply: function (state, itemStep, action) {
      if (action.uid == null) return;
      state.queue.unshift({ step: 'payXpPick', player: itemStep.player, left: 99, uid: action.uid });
    },
  };

  // "When you use the Force" (lof-101): fires for every friendly unit carrying a
  // matching ability whenever a power token is actually spent (not on a fizzled
  // attempt with no token to spend).
  const prevUseForceC2 = O.useForce;
  O.useForce = function (state, item) {
    const had = !!state.players[item.controller].force;
    prevUseForceC2(state, item);
    if (had) {
      SB.allUnits(state, item.controller).forEach(function (u) {
        SB.fireTriggers(state, 'onUseForce', u, { sourceUid: u.uid });
      });
    }
  };

  // ---- cluster-c4 expansion: credit tokens as targetable objects, capture forms,
  // extra regroup phase (see scratch/cluster-c4.json) ---------------------------

  // Take control of one of the opponent's credit tokens (law-221). Credits are a
  // plain per-player counter (state.players[i].credits), not objects, so "take
  // control of one" is modeled as moving a single count from their pool to yours.
  O.stealCredit = function (state, item) {
    const opp = state.players[SB.other(item.controller)];
    if (!(opp.credits > 0)) { SB.log(state, { type: 'fizzle', why: 'noCredits', fizzled: true }); return; }
    opp.credits -= 1;
    const me = state.players[item.controller];
    me.credits = (me.credits || 0) + 1;
    SB.log(state, { type: 'creditStolen', player: item.controller });
  };

  // Defeat one of the opponent's credit tokens (law-106): remove one from their
  // pool without giving it to anyone.
  O.defeatCredit = function (state, item) {
    const opp = state.players[SB.other(item.controller)];
    if (!(opp.credits > 0)) { SB.log(state, { type: 'fizzle', why: 'noCredits', fizzled: true }); return; }
    opp.credits -= 1;
    SB.log(state, { type: 'creditDefeated', player: SB.other(item.controller) });
  };

  // "You may rescue a captured card. If you don't, give a Shield token to this
  // unit." (shd-197). Unlike rescueChoice below, the chooser is this card's own
  // controller and the pick is from ANY of their cards held captive anywhere on
  // the board, not just ones guarded by a specific unit; there's no draw. A
  // following op gated on {"if":"storedAtLeast","name":"rescued","n":1,"not":true}
  // reads as "if you don't" — the store stays unset both on an explicit decline
  // and when nothing was there to rescue in the first place (queue step auto-skips).
  O.rescueOwnCaptured = function (state, item) {
    state.queue.unshift({ step: 'rescueOwnPick', player: item.controller, ctx: item.ctx });
  };
  SB.queueSteps.rescueOwnPick = {
    actions: function (state, itemStep) {
      const acts = [{ type: 'rescueOwnPick', player: itemStep.player, captorUid: null, uid: null }];
      SB.allUnits(state).forEach(function (captor) {
        (captor.captured || []).forEach(function (c) {
          if (c.owner === itemStep.player) acts.push({ type: 'rescueOwnPick', player: itemStep.player, captorUid: captor.uid, uid: c.uid, cardId: c.cardId });
        });
      });
      return acts.length > 1 ? acts : null;
    },
    apply: function (state, itemStep, action) {
      if (action.uid == null) return;
      const captor = SB.findUnit(state, action.captorUid);
      if (!captor) return;
      const idx = (captor.captured || []).findIndex(function (c) { return c.uid === action.uid; });
      if (idx < 0) return;
      const cap = captor.captured.splice(idx, 1)[0];
      const u = SB.makeUnit(state, cap.cardId, cap.owner);
      u.uid = cap.uid;
      u.upgrades = cap.upgrades || [];
      state[SB.card(cap.cardId).arena].push(u);
      SB.log(state, { type: 'rescued', uid: u.uid, cardId: u.cardId });
      if (itemStep.ctx) SB.efx(state, itemStep.ctx).rescued = 1;
    },
  };
  // "On Attack: The defending player may rescue a card they own guarded by this
  // unit. If they do, draw 2 cards." (twi-187). The defending player picks one of
  // their own cards currently held captive by the attacker; releasing it returns
  // it to play the same way a captor's death does (see releaseCaptured), and the
  // attacker's controller draws 2.
  O.rescueChoice = function (state, item) {
    const src = SB.findUnit(state, item.ctx && item.ctx.sourceUid);
    if (!src || !(src.captured && src.captured.length)) return;
    const t = item.ctx.attackTarget;
    let defender = null;
    if (t) defender = t.kind === 'base' ? t.player : ((SB.findUnit(state, t.uid) || {}).owner);
    if (defender == null) return;
    if (!src.captured.some(function (c) { return c.owner === defender; })) return;
    state.queue.unshift({ step: 'rescuePick', player: defender, captorUid: src.uid, ctx: item.ctx, drawController: item.controller });
  };
  S.rescuePick = {
    actions: function (state, itemStep) {
      const captor = SB.findUnit(state, itemStep.captorUid);
      if (!captor) return null;
      const acts = [{ type: 'rescuePick', player: itemStep.player, uid: null }];
      (captor.captured || []).forEach(function (c) {
        if (c.owner === itemStep.player) acts.push({ type: 'rescuePick', player: itemStep.player, uid: c.uid, cardId: c.cardId });
      });
      return acts.length > 1 ? acts : null;
    },
    apply: function (state, itemStep, action) {
      if (action.uid == null) return;
      const captor = SB.findUnit(state, itemStep.captorUid);
      if (!captor) return;
      const idx = (captor.captured || []).findIndex(function (c) { return c.uid === action.uid; });
      if (idx < 0) return;
      const cap = captor.captured.splice(idx, 1)[0];
      const u = SB.makeUnit(state, cap.cardId, cap.owner);
      u.uid = cap.uid;
      u.upgrades = cap.upgrades || [];
      state[SB.card(cap.cardId).arena].push(u);
      SB.log(state, { type: 'rescued', uid: u.uid, cardId: u.cardId });
      SB.queueEffects(state, itemStep.drawController, [{ op: 'draw', amount: 2 }], itemStep.ctx);
    },
  };

  // "An opponent may choose a non-leader unit they control. If they do, this unit
  // captures that unit. If they don't, ready this unit." (sec-193). The opponent
  // (not this card's controller) makes the choice, from among their own units.
  O.captureOrReady = function (state, item) {
    const src = SB.findUnit(state, item.ctx && item.ctx.sourceUid);
    if (!src) return;
    state.queue.unshift({ step: 'captureOrReadyPick', player: SB.other(item.controller), captorUid: src.uid });
  };
  S.captureOrReadyPick = {
    actions: function (state, itemStep) {
      const acts = [{ type: 'captureOrReady', player: itemStep.player, uid: null }];
      SB.allUnits(state, itemStep.player).forEach(function (u) {
        if (SB.card(u.cardId).type === 'leader') return;
        acts.push({ type: 'captureOrReady', player: itemStep.player, uid: u.uid });
      });
      return acts;
    },
    apply: function (state, itemStep, action) {
      const captor = SB.findUnit(state, itemStep.captorUid);
      if (action.uid == null) {
        if (captor) { captor.exhausted = false; SB.log(state, { type: 'readied', uid: captor.uid }); }
        return;
      }
      const victim = SB.findUnit(state, action.uid);
      if (!captor || !victim) return;
      SB.collectBounties(state, victim);
      const arena = SB.arenaOf(state, victim);
      state[arena].splice(state[arena].indexOf(victim), 1);
      captor.captured = captor.captured || [];
      captor.captured.push({ uid: victim.uid, cardId: victim.cardId, owner: victim.owner, upgrades: victim.upgrades });
      SB.log(state, { type: 'captured', uid: victim.uid, cardId: victim.cardId, by: captor.uid, sound: 'capture' });
    },
  };
  // ---- cluster-c5 expansion --------------------------------------------------
  // Twelve tournament cards that needed a handful of new, narrowly-scoped ops.

  // Return an event from a discard pile (either player's) to its owner's hand (sor-183).
  O.returnEventFromDiscard = function (state, item) {
    state.queue.unshift({ step: 'returnEventPick', player: item.controller, ctx: item.ctx,
      optional: item.op.optional !== false });
  };
  S.returnEventPick = {
    actions: function (state, it) {
      const acts = [];
      [it.player, SB.other(it.player)].forEach(function (owner) {
        state.players[owner].discard.forEach(function (inst, i) {
          if (SB.card(inst.cardId).type !== 'event') return;
          acts.push({ type: 'returnEventCard', player: it.player, owner: owner, index: i });
        });
      });
      if (!acts.length) return null;
      if (it.optional) acts.push({ type: 'returnEventCard', player: it.player, owner: null, index: -1 });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.index < 0) return;
      const p = state.players[action.owner];
      const inst = p.discard.splice(action.index, 1)[0];
      p.hand.push(inst);
      SB.log(state, { type: 'tookFromDiscard', player: action.owner, cardId: inst.cardId, sound: 'draw' });
    },
  };

  // Return a chosen unit to its owner's hand, then its owner may play it for free
  // (shd-207, law-093). `grantKeyword` (law-093: Shielded) is granted to the unit for
  // this phase if it's replayed.
  O.returnThenReplay = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (!u) return;
    const owner = u.owner;
    const uid = u.uid;
    const cardId = u.cardId;
    O.returnHand(state, item, target);
    if (SB.findUnit(state, uid)) return; // returnHand fizzled (e.g. immune)
    state.queue.unshift({ step: 'returnReplayPick', player: owner, ctx: item.ctx, uid: uid,
      cardId: cardId, grantKeyword: item.op.grantKeyword || null });
  };
  S.returnReplayPick = {
    actions: function (state, it) {
      const p = state.players[it.player];
      const idx = p.hand.findIndex(function (inst) { return inst.uid === it.uid; });
      if (idx < 0) return null;
      return [
        { type: 'returnReplay', player: it.player, play: true, handIndex: idx, cardId: it.cardId },
        { type: 'returnReplay', player: it.player, play: false },
      ];
    },
    apply: function (state, it, action) {
      if (!action.play) return;
      SB.playCardWithMods(state, it.player, { handIndex: action.handIndex, cardId: it.cardId }, { discount: 99 });
      if (it.grantKeyword) {
        const u = SB.findUnit(state, it.uid);
        if (u) {
          u.tempKeywords = (u.tempKeywords || []).concat([it.grantKeyword]);
          SB.log(state, { type: 'gainedKeyword', uid: u.uid, k: it.grantKeyword, sound: 'buff' });
        }
      }
    },
  };

  // Each player may return one non-leader unit to hand, then defeat every remaining
  // non-leader unit (law-096).
  O.eachPlayerReturnThenDefeatAll = function (state, item) {
    state.queue.unshift({ step: 'mutualReturnPick', player: item.controller, ctx: item.ctx, done: [] });
  };
  S.mutualReturnPick = {
    actions: function (state, it) {
      const acts = [{ type: 'mutualReturn', player: it.player, uid: null }];
      SB.allUnits(state).forEach(function (u) {
        if (SB.card(u.cardId).type === 'leader') return;
        acts.push({ type: 'mutualReturn', player: it.player, uid: u.uid });
      });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.uid != null) {
        const u = SB.findUnit(state, action.uid);
        if (u) O.returnHand(state, { controller: it.player, ctx: it.ctx }, { kind: 'unit', uid: u.uid });
      }
      const done = it.done.concat([it.player]);
      const other = SB.other(it.player);
      if (done.indexOf(other) < 0) {
        state.queue.unshift({ step: 'mutualReturnPick', player: other, ctx: it.ctx, done: done });
        return;
      }
      // Both players have decided: defeat everything non-leader that's left.
      SB.allUnits(state).slice().forEach(function (u) {
        if (SB.card(u.cardId).type === 'leader') return;
        if (SB.findUnit(state, u.uid)) SB.defeatUnit(state, u, it.ctx || {});
      });
    },
  };

  // Heal up to `budget` total damage split across any number of units/bases, then
  // deal that much damage to the source unit itself (sor-052).
  O.healBudgetThenSelfDamage = function (state, item) {
    state.queue.unshift({ step: 'healBudgetPick', player: item.controller, ctx: item.ctx,
      budget: item.op.budget || 0, healed: 0, sourceUid: item.ctx && item.ctx.sourceUid });
  };
  S.healBudgetPick = {
    actions: function (state, it) {
      if (it.budget <= 0) return null;
      const acts = [{ type: 'healBudgetPoint', player: it.player, kind: 'stop' }];
      SB.allUnits(state).forEach(function (u) {
        if (u.damage > 0) acts.push({ type: 'healBudgetPoint', player: it.player, kind: 'unit', uid: u.uid });
      });
      [0, 1].forEach(function (pi) {
        if (state.players[pi].base.damage > 0) acts.push({ type: 'healBudgetPoint', player: it.player, kind: 'base', pi: pi });
      });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.kind === 'stop') {
        finishHealBudget(state, it);
        return;
      }
      let healed = 0;
      if (action.kind === 'unit') {
        const u = SB.findUnit(state, action.uid);
        if (u && u.damage > 0) { u.damage -= 1; healed = 1; SB.log(state, { type: 'unitHeal', uid: u.uid, amount: 1, sound: 'heal' }); }
      } else {
        const b = state.players[action.pi].base;
        if (b.damage > 0) { b.damage -= 1; healed = 1; SB.log(state, { type: 'baseHeal', player: action.pi, amount: 1, sound: 'heal' }); }
      }
      const left = it.budget - healed;
      if (left > 0 && healed > 0) {
        state.queue.unshift({ step: 'healBudgetPick', player: it.player, ctx: it.ctx, budget: left,
          healed: it.healed + healed, sourceUid: it.sourceUid });
      } else {
        finishHealBudget(state, Object.assign({}, it, { healed: it.healed + healed }));
      }
    },
  };
  function finishHealBudget(state, it) {
    const total = it.healed || 0;
    if (total > 0) {
      const u = it.sourceUid != null ? SB.findUnit(state, it.sourceUid) : null;
      if (u) SB.damageUnit(state, u, total, { sourceUid: u.uid });
    }
  }

  // Alternate cost: discard a card with the given aspect instead of paying an
  // event's resource cost (sor-199 needs this, but hooking the hand-play cost path
  // safely — while another pass edits engine.js concurrently — is out of scope for
  // this expansion; sor-199 is left vanilla, see the cluster-c5 report).

  // Delayed tax: at the start of the next action phase, each enemy unit's controller
  // must pay 1 resource or exhaust it (sec-073).
  O.taxEnemyNextPhase = function (state, item) {
    state.pendingEnemyTax = state.pendingEnemyTax || [];
    state.pendingEnemyTax.push({ controller: item.controller, amount: item.op.amount || 1 });
    SB.log(state, { type: 'enemyTaxArmed', player: item.controller, amount: item.op.amount || 1, sound: 'buff' });
  };
  SB.applyPendingEnemyTax = function (state) {
    const pending = state.pendingEnemyTax;
    if (!pending || !pending.length) return;
    state.pendingEnemyTax = [];
    pending.forEach(function (p) {
      SB.allUnits(state, SB.other(p.controller)).forEach(function (u) {
        state.queue.push({ step: 'payOrExhaustPick', player: u.owner, uid: u.uid, amount: p.amount });
      });
    });
  };
  S.payOrExhaustPick = {
    actions: function (state, it) {
      const u = SB.findUnit(state, it.uid);
      if (!u) return null;
      const acts = [];
      if (SB.readyResources(state, it.player) >= it.amount) acts.push({ type: 'payOrExhaust', player: it.player, uid: it.uid, pay: true });
      if (!u.exhausted) acts.push({ type: 'payOrExhaust', player: it.player, uid: it.uid, pay: false });
      return acts.length ? acts : null;
    },
    apply: function (state, it, action) {
      const u = SB.findUnit(state, it.uid);
      if (!u) return;
      if (action.pay) {
        const res = state.players[it.player].resources;
        let left = it.amount;
        for (let i = 0; i < res.length && left > 0; i++) { if (!res[i].exhausted) { res[i].exhausted = true; left--; } }
        SB.log(state, { type: 'resourcesExhausted', player: it.player, amount: it.amount - left });
      } else {
        u.exhausted = true;
        SB.log(state, { type: 'exhausted', uid: u.uid });
      }
    },
  };

  // On Attack: redirect all combat damage that would be dealt to the attacker this
  // attack to a chosen friendly Underworld unit instead (shd-090).
  O.redirectAttackerDamage = function (state, item, target) {
    const atk = SB.findUnit(state, item.ctx && item.ctx.sourceUid);
    if (!atk || !target) return;
    atk.redirectAttackerDamageTo = target.uid;
    SB.log(state, { type: 'attackModified', uid: atk.uid, sound: 'ability' });
  };

  // attackTargetChoice: also suppress the defender's abilities for this attack when
  // the attacking effect says so and the target is a unit (sec-157).
  const prevAttackTargetChoice = S.attackTargetChoice;
  S.attackTargetChoice = {
    actions: prevAttackTargetChoice.actions,
    apply: function (state, itemStep, action) {
      if (action.target && action.target.kind === 'unit' && itemStep.defenderLosesAbilitiesIfUnit) {
        const def = SB.findUnit(state, action.target.uid);
        if (def) { def.abilitiesSuppressedForAttack = true; def.keywordsSuppressedForAttack = true;
          SB.log(state, { type: 'abilitiesSuppressed', uid: def.uid, sound: 'ability' }); }
      }
      prevAttackTargetChoice.apply(state, itemStep, action);
    },
  };

  // "If an opponent controls more resources than you" (jtl-164).
  SB.extraConditions.opponentMoreResources = function (state, controller) {
    return state.players[SB.other(controller)].resources.length > state.players[controller].resources.length;
  };

  // ==== leader competitive-expansion pass (15 leaders missing their printed sides) ====

  // ---- selectors --------------------------------------------------------------
  const prevExtraSelector2 = SB.extraSelector;
  SB.extraSelector = function (state, controller, sel, ctx, u) {
    if (!prevExtraSelector2(state, controller, sel, ctx, u)) return false;
    // "if it's the only [non-leader] unit you control in its arena" (ash-003).
    if (sel.onlyFriendlyUnitInArena) {
      const arena = SB.arenaOf(state, u);
      const excludeLeader = sel.onlyFriendlyUnitInArena === 'nonLeader';
      const cnt = state[arena].filter(function (x) {
        if (x.owner !== controller) return false;
        if (excludeLeader && SB.card(x.cardId).type === 'leader') return false;
        return true;
      }).length;
      if (cnt !== 1) return false;
    }
    // "a unit that costs less than the amount of combat damage dealt to a base this
    // attack" (ash-016) — strictly less than, unlike maxCostRefRevealed below.
    if (sel.costLtBaseDamage) {
      const bd = (ctx && ctx.baseDamageDealt) || 0;
      if (SB.costOf(u.cardId) >= bd) return false;
    }
    // "a different unit" meaning not the unit whose attack just ended (ash-013).
    if (sel.notAttackEnded && ctx && ctx.attackEndedUid === u.uid) return false;
    // "a unit that costs the same as or less than the revealed card" (sor-016).
    if (sel.maxCostRefRevealed) {
      const rc = SB.efx(state, ctx).revealedCost;
      if (rc == null || SB.costOf(u.cardId) > rc) return false;
    }
    // "a unit without an experience token on it" (lof-008).
    if (sel.noExperience && u.experience > 0) return false;
    // "a unit that doesn't share an aspect with the disclosed card" (sec-004).
    if (sel.notAspectRef) {
      const a = SB.efx(state, ctx)[sel.notAspectRef];
      if (a && (SB.card(u.cardId).aspects || []).indexOf(a) >= 0) return false;
    }
    return true;
  };

  // ---- conditions ---------------------------------------------------------------
  // "If it/this attack dealt N or more combat damage to a base" (ash-013, ash-016).
  SB.extraConditions.attackBaseDamageAtLeast = function (state, c, cond, ctx) {
    return ((ctx && ctx.baseDamageDealt) || 0) >= cond.n;
  };
  // "If you created a token this phase" (law-016) — tracked by wrapping SB.log
  // below for every token-creating op (Credit/Shield/Experience/Advantage tokens
  // and token units), reset each action phase in js/engine.js startActionPhase.
  SB.extraConditions.createdTokenThisPhase = function (state, c) {
    return !!state.players[c].createdTokenThisPhase;
  };
  const TOKEN_LOG_TYPES = { experience: 1, advantage: 1, shield: 1, creditsGained: 1, tokenCreated: 1 };
  const prevLog2 = SB.log;
  SB.log = function (state, entry) {
    const r = prevLog2(state, entry);
    if (TOKEN_LOG_TYPES[entry.type] && state.players) {
      let owner = entry.player;
      if (owner == null && entry.uid != null) {
        const u = SB.findUnit(state, entry.uid);
        if (u) owner = u.owner;
      }
      if (owner != null && state.players[owner]) state.players[owner].createdTokenThisPhase = true;
    }
    return r;
  };

  // ---- chooseAspect: restrict the offered list (sec-004 excludes villainy) ------
  O.chooseAspect = function (state, item) {
    state.queue.unshift({ step: 'aspectPick', player: item.controller, saveAs: item.op.saveAs || 'aspect',
      options: item.op.options, ctx: item.ctx });
  };
  S.aspectPick = {
    actions: function (state, it) {
      return (it.options || ['vigilance', 'command', 'aggression', 'cunning', 'heroism', 'villainy']).map(function (a) {
        return { type: 'pickAspect', player: it.player, aspect: a };
      });
    },
    apply: function (state, it, action) {
      SB.efx(state, it.ctx || {})[it.saveAs] = action.aspect;
      SB.log(state, { type: 'aspectChosen', player: it.player, aspect: action.aspect });
    },
  };

  // ---- discloseReveal: aspectRef variant (a chosen aspect, not a literal list) --
  const prevDiscloseReveal = O.discloseReveal;
  O.discloseReveal = function (state, item) {
    if (item.op.aspectRef) {
      const a = SB.efx(state, item.ctx)[item.op.aspectRef];
      SB.log(state, { type: 'disclosed', player: item.controller, aspects: a ? [a] : [], notice: true });
      if (SB.fireLeaderTrigger) SB.fireLeaderTrigger(state, item.controller, 'onRevealOrDiscard', {});
      SB.allUnits(state, item.controller).forEach(function (u) {
        SB.fireTriggers(state, 'onRevealOrDiscard', u, { sourceUid: u.uid });
      });
      return;
    }
    prevDiscloseReveal(state, item);
  };

  // ---- extraAction: "take an extra action after this one" (jtl-018) -------------
  // advanceTurn() has already run by the time queued effects resolve (it fires
  // synchronously right after the action is applied — js/engine.js), so simply
  // restoring `active` to the controller undoes it, granting another action.
  O.extraAction = function (state, item) {
    state.active = item.controller;
    SB.log(state, { type: 'extraAction', player: item.controller, sound: 'buff' });
  };

  // ---- suppressUpTo: "choose any number of friendly units. They lose all
  // abilities for this round" (jtl-018's unit side) — unbounded exhaustUpTo-style
  // repeat-until-stop picker.
  // Note: the field is named `scope`, not `target` — an op with a top-level `target`
  // is intercepted by effects.js's generic single-candidate selector before this
  // handler ever runs (see exhaustAll / giveKeywordAll for the same reason).
  O.suppressUpTo = function (state, item) {
    state.queue.unshift({ step: 'suppressUpToPick', player: item.controller,
      target: item.op.scope || { who: 'friendly', what: 'unit' }, ctx: item.ctx });
  };
  S.suppressUpToPick = {
    actions: function (state, itemStep) {
      const cands = SB.selectorCandidates(state, itemStep.player, itemStep.target, itemStep.ctx || {})
        .filter(function (c) { const u = SB.findUnit(state, c.uid); return u && !u.abilitiesSuppressed; });
      if (cands.length === 0) return null;
      const acts = cands.map(function (c) { return { type: 'suppressUpTo', player: itemStep.player, uid: c.uid }; });
      acts.push({ type: 'suppressUpTo', player: itemStep.player, uid: null });
      return acts;
    },
    apply: function (state, itemStep, action) {
      if (action.uid == null) return;
      const u = SB.findUnit(state, action.uid);
      if (u) {
        u.abilitiesSuppressed = true;
        u.keywordsSuppressed = true;
        SB.log(state, { type: 'abilitiesSuppressed', uid: u.uid, sound: 'ability' });
      }
      state.queue.unshift({ step: 'suppressUpToPick', player: itemStep.player, target: itemStep.target, ctx: itemStep.ctx });
    },
  };

  // ---- defeatResource: "defeat a friendly resource" / "defeat a resource you
  // control", as a cost-like effect (law-013) or an optional one (law-013's unit
  // side, sor-017's delayed one). {optional?, saveAs?}
  O.defeatResource = function (state, item) {
    const p = state.players[item.controller];
    if (!p.resources.length) { SB.log(state, { type: 'fizzle', why: 'noResources', fizzled: true }); return; }
    state.queue.unshift({ step: 'defeatResourcePick', player: item.controller, ctx: item.ctx,
      optional: !!item.op.optional, saveAs: item.op.saveAs });
  };
  S.defeatResourcePick = {
    actions: function (state, it) {
      const p = state.players[it.player];
      const acts = p.resources.map(function (r, i) { return { type: 'defeatResource', player: it.player, index: i }; });
      if (it.optional) acts.push({ type: 'defeatResource', player: it.player, index: -1 });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.index === -1) return;
      const p = state.players[it.player];
      const r = p.resources.splice(action.index, 1)[0];
      if (!r) return;
      p.discard.push(r.instance);
      if (it.saveAs) SB.efx(state, it.ctx || {})[it.saveAs] = true;
      SB.log(state, { type: 'resourceDefeated', player: it.player, sound: 'destroy' });
    },
  };

  // ---- defeatResourceNextPhase: "At the start of the next action phase, defeat a
  // resource you control" (sor-017) — same delayed-arm shape as taxEnemyNextPhase.
  O.defeatResourceNextPhase = function (state, item) {
    state.pendingResourceDefeat = state.pendingResourceDefeat || [];
    state.pendingResourceDefeat.push({ controller: item.controller });
    SB.log(state, { type: 'resourceDefeatArmed', player: item.controller, sound: 'buff' });
  };
  SB.applyPendingResourceDefeat = function (state) {
    const pending = state.pendingResourceDefeat;
    if (!pending || !pending.length) return;
    state.pendingResourceDefeat = [];
    pending.forEach(function (p) {
      if (state.players[p.controller].resources.length) {
        state.queue.push({ step: 'defeatResourcePick', player: p.controller, ctx: {}, optional: false });
      }
    });
  };

  // ---- resourceFromHand: "put a card from your hand into play as a resource [and
  // ready it]" (sor-017's leader side) — a mid-game version of setup resourcing.
  O.resourceFromHand = function (state, item) {
    const p = state.players[item.controller];
    if (p.hand.length === 0) { SB.log(state, { type: 'fizzle', why: 'emptyHand', fizzled: true }); return; }
    state.queue.unshift({ step: 'resourceFromHandPick', player: item.controller,
      exhausted: item.op.exhausted !== false, ctx: item.ctx });
  };
  S.resourceFromHandPick = {
    actions: function (state, it) {
      const p = state.players[it.player];
      return p.hand.map(function (_, i) { return { type: 'resourceFromHand', player: it.player, index: i }; });
    },
    apply: function (state, it, action) {
      const p = state.players[it.player];
      const inst = p.hand.splice(action.index, 1)[0];
      if (!inst) return;
      p.resources.push({ instance: inst, exhausted: it.exhausted });
      SB.log(state, { type: 'resourced', player: it.player });
    },
  };

  // ---- revealTopOf: "reveal the top card of any player's deck" (sor-016) — takes
  // {who:'self'|'opponent'}, wrapped in a binaryChoice for the "any player" pick.
  O.revealTopOf = function (state, item) {
    const pIdx = item.op.who === 'opponent' ? SB.other(item.controller) : item.controller;
    const p = state.players[pIdx];
    if (p.deck.length === 0) return;
    SB.efx(state, item.ctx).revealedCost = SB.card(p.deck[0].cardId).cost;
    SB.log(state, { type: 'revealedTop', player: pIdx, cardId: p.deck[0].cardId, notice: true });
  };

  // ---- lookTopBothDecks: "look at the top card of each player's deck" (sor-016)
  // — public information only, no state change beyond the log line.
  O.lookTopBothDecks = function (state, item) {
    const a = state.players[0].deck[0], b = state.players[1].deck[0];
    SB.log(state, { type: 'lookedTopBoth', p0CardId: a ? a.cardId : null, p1CardId: b ? b.cardId : null, notice: true });
  };
  SB.fireActionPhaseStartTriggers = function (state) {
    [0, 1].forEach(function (pl) {
      if (SB.fireLeaderTrigger) SB.fireLeaderTrigger(state, pl, 'onActionPhaseStart', {});
      SB.allUnits(state, pl).forEach(function (u) {
        SB.fireTriggers(state, 'onActionPhaseStart', u, { sourceUid: u.uid });
      });
    });
  };

  // ---- giveKeywordN: give a single chosen unit a numbered keyword for this round
  // (law-012's "gains Raid 1") — giveKeywordAll applies to a whole scope, not a
  // single picked target, so this reuses its grantTempKeyword helper instead.
  O.giveKeywordN = function (state, item, target) {
    const u = SB.findUnit(state, target.uid);
    if (!u) return;
    grantTempKeyword(u, item.op.k, item.op.n);
    SB.log(state, { type: 'gainedKeyword', uid: u.uid, k: item.op.k, sound: 'buff' });
  };

  // ---- returnFormerUpgrade: "you may return an upgrade that was attached to this
  // unit to its owner's hand" (shd-001's aura), reading the formerUpgrades snapshot
  // taken by SB.defeatUnit above before upgrades were moved to discard.
  O.returnFormerUpgrade = function (state, item) {
    const list = (item.ctx && item.ctx.formerUpgrades) || [];
    if (!list.length) return;
    state.queue.unshift({ step: 'returnFormerUpgradePick', player: item.controller, list: list });
  };
  S.returnFormerUpgradePick = {
    actions: function (state, it) {
      const cands = it.list.filter(function (e) {
        return state.players[e.owner].discard.some(function (inst) { return inst.uid === e.uid; });
      });
      if (!cands.length) return null;
      const acts = cands.map(function (e) { return { type: 'returnFormerUpgrade', player: it.player, uid: e.uid, owner: e.owner }; });
      acts.push({ type: 'returnFormerUpgrade', player: it.player, uid: null });
      return acts;
    },
    apply: function (state, it, action) {
      if (action.uid == null) return;
      const p = state.players[action.owner];
      const i = p.discard.findIndex(function (inst) { return inst.uid === action.uid; });
      if (i < 0) return;
      p.hand.push(p.discard.splice(i, 1)[0]);
      SB.log(state, { type: 'tookFromDiscard', player: action.owner, sound: 'draw' });
    },
  };
})(window.SB = window.SB || {});

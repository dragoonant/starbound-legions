# DEVIATIONS

Deliberate, minor divergences from printed behavior (all logged here per the
"faithful, no cuts" instruction — each is a digital-model simplification, not a
missing mechanic):

- Deck searches shuffle the whole deck instead of bottoming the unseen window in
  random order (indistinguishable for hidden zones).
- "Name a card, then look at the opponent's hand and discard a card with that
  name" is modeled as: reveal the hand, then the caster chooses one card to
  discard (slightly stronger than naming blind).
- "For this attack" stat changes granted by on-attack abilities last until end of
  round when granted as temporary keywords/stats (relevant only if the same unit
  is readied and attacks again in the same round).
- Multi-unit "give X to up to N distinct units" effects granted through repeated
  single-target picks can, for one card (Luminous-Beings analogue), pick the same
  unit twice. jtl-174's "deal 2 damage to a different enemy unit" for each of the
  chosen unit's on-attack abilities has the same limitation: the repeated damage
  picks are not constrained to be distinct from each other.
- Abilities lent to another attacker by a support-style unit last until end of
  round rather than only for that one attack.
- law-237's "Look at the top 3 cards of your deck. You may discard 1 of them. Put
  the rest back on top in any order." keeps the kept cards in their original
  relative order instead of letting the player re-arrange them.

## Competitive-deck expansion (js/ops2.js)

- **"Name a card"** effects choose among the cards the opponent has already shown
  (their hand as revealed by the effect, and their discard pile) rather than naming
  blind from the whole card pool. Blocking ("can't play cards with that name") and
  silencing ("copies lose all abilities") then work exactly as printed.
- **Damage replacement is decided by the engine, not by a prompt.** A shield-redirect
  guardian breaks a shield only when the hit would defeat the friend; a
  sacrifice-to-prevent unit gives up its cheapest kind-sharing friend only when the hit
  would defeat it. Both are "you may" on the card; a prompt inside the damage routine
  would stall every combat resolution.
- **"Defeat any number of upgrades on a unit"** defeats every upgrade on the chosen unit.
- **"Choose an opponent; for this phase they may play this unit from your discard pile
  for free"** is offered to the opponent once, immediately, rather than staying open for
  the rest of the phase.
- **"Draw any number of players a card"** (choose any number of players) is two
  yes/no choices, one per player.
- **A leader's "use that ability again"** repeats the most recent last-words ability
  used by its controller; the printed timing ("when you use") is the same moment.
- **Cards played from a resource** are replaced by the top card of the deck in the same
  ready/exhausted state, exactly as a smuggled card is.
- **"Deal 1 damage to any number of bases"** is one yes/no per base.
- **The clone unit** copies the printed definition (stats, keywords, abilities) of the
  chosen unit; it keeps its own card identity for uniqueness and naming.
- **Deck-size bases** ("minimum deck size +10") have no effect: decks are prebuilt.

## From CARD-LOG-AND-TARGETING-SPEC.md

- **§4, "never auto-resolve a forced target silently."** The engine still resolves a
  sole forced target without a prompt. Raising a confirm-only dialog for a decision
  with one possible answer would make the AI and every fuzz game pay for a click that
  decides nothing, and `SB.legalActions` would have to offer an action that cannot be
  refused. The knowledge the rule protects — *that something was targeted, and what* —
  is restored instead by an `autoTarget` log entry carrying `notice: true`, so the
  play is announced on a highlighted line with a card preview attached.
  Guarded by `tests/test-log.js`.
- **§2, second-person rewriting.** The spec humanises engine prose (`Player 0 draws 2.`)
  with sentinel substitution and a bare-verb table. This engine never writes prose at
  all — log entries are pure structured data and `js/logtext.js` generates the sentence
  at render time, already in the right person. The substitution machinery, and the
  three bugs the spec warns about, have nothing to act on here.
- **§12, multi-pick targeting.** The engine has no `min`/`max` multi-select choice:
  "choose up to N" is modeled as repeated single picks with a Stop action. The
  `multiPicks` toggle list, Confirm/Clear buttons and set-equality matching therefore
  have no counterpart to drive, and are not implemented.
- **Naming a card.** Two cards print "name a card", meaning any card in the game. The
  engine offers only the cards the opponent has already revealed this game, because a
  free-text picker over the whole pool has no counterpart in the targeting model and
  would let a player fish for information the rules never give them. The lockout and the
  cost tax themselves behave as printed once a name is chosen.
- **jtl-015, the pilot side's stats.** The leader's epic action offers a choice between
  deploying as a ground unit and deploying as an upgrade on a friendly vehicle without a
  pilot. The pilot side prints no separate stats or abilities, so it is authored with the
  deployed side's power and HP; the engine already grants a leader pilot its deployed-side
  power, so the two readings agree in play.
- **Piloting costs on 25 pulled pilots.** A pilot's piloting cost is printed as a face
  stat, not as rules text, so it is not in the generated source-name pack and cannot be
  checked against it. Twenty-five pilots came out of the skeleton pull with a piloting
  cost of 0, which let them attach to a vehicle for nothing. They are priced instead by
  a stated rule — `max(1, ceil(unit cost / 2))` — which reproduces two of the five
  hand-authored piloting costs exactly and lands within 1 of two more (jtl-094, printed
  above its unit cost, is an outlier no rule recovers). The five authored values are left
  as they are. Replace these with the printed numbers if the source workpackets come
  back; a test keeps any of them from returning to 0.

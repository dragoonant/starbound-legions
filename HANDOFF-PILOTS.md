# Handoff — what a pilot's box still does not do

Start here in a fresh chat. Read CLAUDE.md first (it points at the binding docs), then
this. Scope: the twenty pilot units whose pilot box carries more than power and HP.

## Where things stand

`main` @ 4ee7dda. Suite: `node tools/run-tests.mjs --quiet` → 247 passed. Run it before
every commit.

A pilot unit may be played as an upgrade onto a friendly vehicle without a pilot, for the
piloting cost in `keywords[{k:'piloting', cost, aspects}]`. What it hands the ship it flies
is its **pilot box**, `pilotSide: {power, hp}` — read by `SB.upgradeStats` (js/rules.js),
which every stat path now goes through. All thirty pilots carry a box and a correct cost;
`tests/test-expansion.js` guards both ("content: every pilot carries the box it lends its
ship", "content: no pilot attaches to a vehicle for free").

What is NOT carried: twenty of those boxes also print an ability, and none of it is in the
card data. A pilot currently lends stats only. Three boxes are authored already — jtl-142,
jtl-189, jtl-203 — and are the models to copy. Seven boxes print nothing but stats and need
no work: jtl-049, jtl-100, jtl-108, jtl-159, jtl-236, jtl-246, jtl-255.

## The twenty, by shape

**Flat keyword grant (4).** The box gives the ship one keyword outright.

| Card | Grants |
|------|--------|
| jtl-034 | grit |
| jtl-045 | restore 1 |
| jtl-058 | sentinel |
| jtl-211 | raid 1 |

These want `pilotSide.grantKeywords: [{k:'…'}]`, the same field a leader pilot uses.
**One engine change is needed first**: `SB.unitKeywords` (js/rules.js) reads `grantKeywords`
off `pilotSide` only when the upgrade is a leader —

```js
const from = u.type === 'leader' && u.pilotSide ? u.pilotSide : u;
```

— so a unit's box is skipped. Widen it to `u.pilotSide || u`, mirroring what
`SB.upgradeStats` already does for stats. Nothing else should need touching: jtl-015 proves
the leader path works, so the unit path is the same data reaching the same reader.

**Conditional grant (2).**

- **jtl-109** — sentinel, but only while its controller has a unit in each arena.
- **jtl-150** — three grants keyed off the ship's trait: overwhelm on a Fighter, +0/+1 on a
  Transport, grit on a Speeder.

Both are `constant` abilities with `asPilotOnly: true` and a condition; `bearerHasTrait` is
the condition jtl-189 already uses, and the arena counts have `controlArenaUnit`.

**Granted ability (4).** The box hands the ship a triggered ability of its own.

| Card | The ship gains |
|------|----------------|
| jtl-035 | on attack: give an enemy unit in the arena −1/−1 for the round |
| jtl-046 | on attack: give this unit an experience token, then deal 1 damage to it |
| jtl-048 | on attack: discard the top card of the defender's deck; draw if it cost 3 or less |
| jtl-066 | on attack: heal up to 2 damage spread across any number of units |

No engine work. An ability marked `asPilotOnly: true` is already contributed to the bearer
by `SB.unitAllAbilities` — that is exactly how jtl-142 works today. Copy its shape.

**When it attaches (8).** An effect that fires as the pilot is played onto a ship.

| Card | Effect |
|------|--------|
| jtl-036 | give the ship a shield |
| jtl-057 | may heal 2 damage from a unit |
| jtl-084 | create a fighter token |
| jtl-086 | may give an experience token to another unit |
| jtl-098 | search the top 5 of your deck for a card of its faction trait, reveal and draw it |
| jtl-145 | may pay 2 resources to ready a unit of its faction trait |
| jtl-148 | may defeat an upgrade costing 2 or less |
| jtl-210 | exhaust an enemy unit in the ship's arena |

Use the `onPlayAsPilot` trigger (jtl-189 and jtl-203 both use it). Note jtl-210's existing
`onPlay` is its **unit** side and is correct — the box effect is a second, separate ability.

**Its own shape (2).**

- **jtl-094** — instead of being defeated as an upgrade, its controller may move it to the
  ground arena as a unit, exhausted. Check `ejectOnDefeat` (js/ops2.js) before writing
  anything: it already moves a defeated pilot somewhere, and may be this with a flag.
- **jtl-197** — when the ship it flies finishes an attack and survives, its controller may
  return it to hand. `selfUpgradeToHand` (js/ops2.js) is the op; an `asPilotOnly` ability
  with an `onAttackEnds` trigger fires on the bearer.

## How to check your work

Printed values came from a public CC0 card dataset, not from guesses; only numbers and
structured ops enter the repo, never printed wording (NOTICE.md, CLAUDE.md). The audit
tool compares what we generate against the printed text for anything that has it:

```
node tools/audit-card-text.mjs            # every registered deck
node tools/audit-card-text.mjs c21-c50    # just the wave-2 lists
```

A pilot's box text does not reach `SB.cardText` through the same path as unit rules text,
so the audit will not catch a missing box ability — read `js/text.js`'s pilot branch and
make sure whatever you add renders, then check it by eye against the card.

Two counts are worth re-running after any change:

```
node tools/run-tests.mjs --quiet   # 247 and rising
node tools/coverage.mjs            # 1320 games; a new op that never fires is a dead op
```

## One correction to carry forward

DEVIATIONS.md said 26 of the 30 boxes grant a keyword. That was a loose read of the card
text and is wrong: 4 grant a keyword flatly, 2 conditionally, and the other 14 gaps are
abilities, attach effects or one-off shapes. The entry has been corrected in the same
commit as this file.

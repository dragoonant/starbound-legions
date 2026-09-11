// voicelines.js — what a unit says as it hits the table. Display text, so it lives
// beside the other names files and nowhere else (CLAUDE.md: all display text in the
// names files). ALL ORIGINAL EXPRESSION, written for the theme in THEME.md — every
// line here was written for this project. None is quoted, adapted or paraphrased
// from any film, show or published game; they aim at the same ARCHETYPAL BEATS a
// space opera hits (a pilot checking in, a knight steadying himself, a droid
// complaining) in this project's own words.
//
// The file's SHAPE is the point. There are ~1600 units and leaders in the card pool
// and 571 of them appear in an actual deck; writing a line for each would be a book
// and most of it would never be read. Instead a line is chosen from POOLS, most
// specific match first (js/voice.js SPECIFICITY):
//
//   champions — keyed by the theme name of a recurring character, so ONE entry
//     covers every card that character appears on (Kael Verin has seven). Only
//     characters that actually turn up in data/decks.js are listed; a test fails
//     on a pool no deck can reach, so this table cannot rot into dead weight.
//   traits    — keyed by trait id. A Warden speaks as a Warden, a Fighter as a
//     pilot, a Trooper as a trooper. ~38 entries carry the whole card pool, and a
//     new set needs no new lines at all: its cards inherit the archetype they
//     already declare in their trait list.
//   aspects   — the backstop for a unit with no trait we have a voice for.
//
// VOCABULARY. A line that names the power the Attuned draw on is a FUNCTION, not a
// string, and builds from SB.names.terms when it renders — the same rule the log
// lines and help text follow. So it reads "the Force" beside the printed card names
// and "the Current" under the theme's, and never stores either word (CLAUDE.md).
//
// Every line is one short breath: it renders in a small bubble over a card, so
// nothing here runs past js/voice.js MAX_LEN.
(function (SB) {
  'use strict';

  function T() { return SB.names.terms; }

  SB.voiceLines = {

    // ---- recurring champions ------------------------------------------------
    // Keyed by the theme display name, which stays reachable through the printed-
    // name pack (names.js themeCard) — these lines were written for these
    // characters, so they follow the character, not the label on the card.
    champions: {
      'Kael Verin': [function () { return cap(T().force) + ' runs through me.'; }, 'I am ready.', 'I will not turn.'],
      'Sera Verin': ['Hold the line — I am coming.', 'The Freeburn answers.', 'Somebody has to go first.'],
      'Joren Vale': ['I was the best of us once.', 'Nobody tells me what I cannot do.', 'It should have been me.'],
      'Lord Malvane': ['You are already beaten.', 'Kneel.', 'I was a knight. I am worse now.'],
      'Arch-Consul Veyd': ['Everything is proceeding.', 'Your fleet was always mine.', 'Let them come.'],
      'Emperor Veyd': ['The Veil belongs to me.', 'Patience. Then ruin.', 'Let them come.'],
      'Master Wyn': ['Small things end wars.', 'Doubt is the only defeat.', 'Old, yes. Slow, no.'],
      'Corvan Dree': ['Steady. Breathe. Strike.', 'The thread holds.', 'Go — I will hold the door.'],
      'Aldric Vey': ['I stopped asking permission.', 'The Order was wrong about plenty.'],
      'Tessa Rill': ['I can do this.', 'Teach me after. Fight now.', 'I am not afraid. Mostly.'],
      'Skarn': ['At last, the veil thins.', 'I have waited an age for this hour.'],
      'Count Vezar': ['How disappointing.', 'You lack refinement.'],
      'Lord Serath': ['How disappointing.', 'The Order taught me this. Badly.'],
      'General Klexis': ['Calculating your surrender.', 'My legions do not tire.'],
      'Dax Farrow': ['I have a very bad plan.', 'Relax. I have done worse.', 'Do not scratch the paint.'],
      'Grumm': ['Grumm does not like this plan.', 'Fine. Grumm will carry it.'],
      'Rho Kade': ['The contract is the contract.', 'Alive costs extra.', 'I do not miss twice.'],
      'Korrin': ['This is my clan’s war now.', 'Armor holds. Grudges hold longer.'],
      'Pip': ['Pip helps!', 'Small. Fast. Lucky.'],
      'Prefect Draul': ['Order will be restored.', 'The Hegemony did not die. It waited.'],
      'Magnate Gorvax': ['Everything has a price. Even you.', 'I do not chase. I collect.'],
      'Calder Voss': ['I like these odds.', 'The house sits down last.'],
      'Vessa Ryl': ['My ship, my rules.', 'I do not fly for flags.'],
      'Jem Skady': ['You did not see me.', 'Already done. You were slow.'],
      'Ashen Knight Vael': ['The Order rises from its ash.', 'We remember what was burned.'],
      'K4-Dee': ['Beeping urgently.', 'Warning ignored. Proceeding.', 'I have opinions about this.'],
      'Vox-3': ['Oh, we are all going to die.', 'Statistically, this is unwise.'],
      'XR-9': ['Target acquired. Mercy unavailable.', 'Efficient. Quiet. Done.'],
      'Vex Calla': ['One shot is enough.', 'Hold still.'],
      'Sslith': ['I have your scent.', 'Run. It is better sport.'],
      'Amessa Solenne': ['The Concord still has a voice.', 'I will not beg for my world.'],
      'Admiral Hexler': ['Bring us to firing range.', 'The Maw does not wait.'],
      'Admiral Corvath': ['The plan accounted for this.', 'Three moves ahead of you.'],
      'Doctor Skell': ['Hold still. This is data.', 'Fascinating. Fatal, but fascinating.'],
      'Doctor Ensor': ['The specimen is ready.', 'Adjusting the dosage.'],
      'The Forgemother': ['My children are hungry.', 'The forge never cools.'],
      'Mother Kestra': ['The sisters are listening.', 'I named you before you were born.'],
      'Barlow Greeve': ['I take my cut first.', 'Nothing personal. Mostly.'],
      'Auditor Dray': ['The ledger says otherwise.', 'Your accounts are overdue.'],
      'Director Kresh': ['The project proceeds.', 'You were never cleared for this.'],
      'Captain Radd': ['All hands, brace.', 'We hold this deck.'],
      'Garruk Orell': ['I have broken harder things.', 'Send the next one.'],
      'Sindra Kaz': ['Wires talk. I listen.', 'Give me ten seconds.'],
      'Shen Harrow': ['I know the quiet routes.', 'Nobody follows me twice.'],
      'Ashka Vane': ['I fly for the ones left behind.', 'Cut me loose.'],
      'Marrow': ['Bones remember.', 'Come and be counted.'],
      'Hu-Yan': ['Patience is a weapon.', 'The stone waits for the river.'],
      'The Wyrmhide': ['Thick plate. Thin patience.', 'Let them hit us.'],
      'The Vagrant Star': ['She still has a run left in her.', 'That noise is normal. Probably.'],
      'The Kestrel Vow': ['Quarry sighted.', 'No warning shot.'],
      'The Ironwing': ['Clan colors, burning.', 'Bring it in close.'],
      'The Sovereign Maw': ['Nothing escapes the Maw.', 'All batteries, open fire.'],
      'The Bastion Light': ['The Freeburn stands.', 'Hold formation. Hold hope.'],
      'The Silent Verdict': ['Judgment requires no voice.', 'The sentence is executed.'],
      'The Concordant': ['The charter still flies.', 'Signal the senate.'],
      'The Gilded Wake': ['Bidding is open.', 'Everything aboard is for sale.'],
    },

    // ---- archetypes, by trait ----------------------------------------------
    // js/voice.js walks SPECIFICITY and takes the first trait a card carries, so a
    // Warden Trooper speaks as a Warden and an ordinary Trooper as a trooper.
    // Only traits that appear on a unit in a real deck are listed.
    traits: {
      tr21: [function () { return cap(T().force) + ' is with me.'; }, 'I did not want this fight.', 'Let go. Then strike.', 'A knight still stands.'],   // Warden
      tr12: ['I feel it moving.', function () { return cap(T().force) + ' shows me the way.'; }, 'Something is coming.', 'Be still. Then act.'],          // Attuned
      tr35: ['Your fear feeds me.', 'The dark is patient.', 'Kneel or break.', 'I was a knight once, too.'],                                              // Umbra
      tr19: ['Someone here is lying.', 'Do not run. I enjoy that.'],                                                                                      // Seeker
      tr11: ['The ash remembers.', 'We rebuild on bone.', 'The Order did not end.'],                                                                      // Ashen Order
      tr50: ['I came back for this.', 'The fire is lit again.', 'Try burying me twice.'],                                                                 // Rekindled
      tr28: ['The sisters are watching.', 'Blood and smoke, then.', 'I know your true name.'],                                                            // Hexen
      tr25: ['Honor is armor.', 'My clan does not retreat.', 'Speak, or bleed.'],                                                                         // Vhalkar
      tr03: ['I work for whoever pays.', 'You are on a list.', 'Found you.'],                                                                             // Tracker
      tr30: ['In the pipe, holding steady.', 'Wing on me.', 'Give me a clean run.', 'Throttle up.'],                                                      // Ace
      tr49: ['Loud noise. Big arms.', 'I do not need a weapon.'],                                                                                         // Ursok
      tr09: ['Little and fierce!', 'The forest is on our side.'],                                                                                         // Brackle
      tr44: ['The roots said you would come.', 'We grow back.'],                                                                                          // Sylvethi
      tr15: ['The deep is cold. I am colder.', 'Surface folk. Always shouting.'],                                                                         // Murkfolk
      tr26: ['Lumeria does not surrender.', 'Gilded, not soft.', 'For the spire.'],                                                                       // Lumeria
      tr54: ['Play it again — louder.', 'Somebody call this a war?'],                                                                                     // Musician
      tr56: ['Take everything.', 'We do not garrison. We strip.'],                                                                                        // Reaver
      tr05: ['Vat-born and ready.', 'We were made for this hour.', 'Numbers, not names.'],                                                                // Vatborn
      tr08: ['Systems nominal.', 'Directive accepted.', 'Beginning task.', 'Query: why me?'],                                                             // Automa
      tr07: ['— a low, rolling snarl —', 'It bares its teeth.', 'It has not been fed.'],                                                        // Beast
      tr36: ['Embercell, in position.', 'Light it and go.', 'Nobody gets left.'],                                                                         // Embercell
      tr29: ['You will follow procedure.', 'This is my sector.', 'Log it and move.', 'I did not ask.'],                                                   // Official
      tr43: ['Moving up!', 'On your left!', 'Copy that — advancing.', 'Contact!'],                                                                        // Trooper
      tr13: ['Nobody’s payroll but mine.', 'I am only here for the run.', 'Point me at the exit.'],                                                  // Drifter
      tr47: ['Walker advancing.', 'Nothing stops these legs.', 'Ground shakes. Good.'],                                                                   // Strider
      tr40: ['Armor forward.', 'Cannon loaded.', 'Roll over them.'],                                                                                      // Tank
      tr37: ['Skimming low!', 'Fast and gone.', 'Hold on to the rail.'],                                                                                  // Skimmer
      tr10: ['Standing by.', 'Locking on.', 'Cutting in — mark me.', 'I have the angle.'],                                                                // Fighter
      tr04: ['All batteries, ready.', 'Bring us about.', 'Shields to full.'],                                                                             // Capital Ship
      tr41: ['Cargo secured.', 'Coming in heavy.', 'Drop in ten.'],                                                                                       // Transport
      tr45: ['Business is business.', 'The courts pay well.', 'You owe someone.'],                                                                        // Syndicate
      tr34: ['The Severance endures.', 'Flesh is a flaw.', 'Compliance is cheaper.'],                                                                     // Severance
      tr33: ['For the Concord!', 'The senate still stands.', 'We hold to the charter.'],                                                                  // Concord
      tr27: ['The Concord is reborn.', 'We learned from the fall.', 'Again, and better.'],                                                                // New Concord
      tr32: ['For the Freeburn!', 'Burn it down.', 'We are still here.'],                                                                                 // Freeburn
      tr17: ['For the Hegemony.', 'Compliance, or consequence.', 'The Consul commands.', 'Fall in.'],                                                     // Hegemony
    },

    // ---- aspect backstop ----------------------------------------------------
    // Reached only by a unit whose traits we have no voice for. Deliberately broad.
    aspects: {
      villainy: ['You should not have come.', 'This ends badly. For you.', 'Enjoy the quiet.'],
      heroism: ['I will hold.', 'Stand with me.', 'Somebody has to.'],
      command: ['On my order.', 'Form up.', 'Positions.'],
      aggression: ['Let’s ruin something.', 'Finally.', 'Swing first.'],
      cunning: ['You never saw me.', 'Look the other way.', 'Too easy.'],
      vigilance: ['Nothing gets past.', 'Watching.', 'I have the line.'],
    },

    // The last resort, so a unit with neither a trait nor an aspect we cover can
    // still speak. Nothing in the current pool reaches it.
    generic: ['Reporting in.', 'Ready.', 'Say the word.'],
  };

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
})(window.SB = window.SB || {});

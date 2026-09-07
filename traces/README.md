# traces/

Where a reported bug lands.

`js/bugreport.js` records every match as it is played: the seed, both deck ids, and every
action either seat applied, with the log entries each produced and any error thrown along
the way. The engine is deterministic in exactly those inputs, so a file here is a
replayable match, not a screenshot. Internal ids only — no card names or printed text, so
a report is safe to paste anywhere.

**Flag a bug** in the log drawer opens a box for what you saw. *Send report* pins that
sentence to the current action and writes the whole trace here as
`sb-bug-<seed>-<time>.json`, timestamped with when the game was played. *Pin only* keeps
playing and leaves the note in the trace for later. **Save bug report** files one without
a comment, and a crash saves one by itself.

Writing here needs the dev server (`node tools/serve.mjs`), which takes the file over
`POST /__trace/<name>`. From `file://` or the deployed site there is no server to take it,
so the browser downloads the report (and copies it to the clipboard) instead, and it
belongs in this directory by hand.

## Replaying one

    node tools/replay-report.mjs traces/sb-bug-g12345-2026-09-07T04-10-51.json
    node tools/replay-report.mjs traces/<file> --verbose     # the whole transcript
    node tools/replay-report.mjs traces/<file> --stop 42     # stop after action 42
    node tools/replay-report.mjs --selftest                  # prove replay still works

Replay re-runs the trace against the real engine and reports three kinds of trouble, each
a bug on its own: ILLEGAL (the UI offered an action the engine would not have), THREW
(apply died on an action), and DIVERGED (the same action produced different log entries
than it did in the browser).

The JSON files here are gitignored. To send one along with a bug, commit it deliberately:
`git add -f traces/<file>.json`.

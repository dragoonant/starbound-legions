// sound.js — SFX from structured log entries + the adaptive battle score.
// Music runs on Web Audio for GAPLESS looping: decoded buffers are trimmed to their
// SUSTAINED body — an RMS envelope finds where the recorded fade-in has come up and
// where the closing decrescendo starts, and the loop lives strictly inside those
// points. Trimming silence alone was not enough: a generated track's fade-out is loud
// enough to pass a silence test, so the loop sounded like the piece ending and
// starting again. Playback also begins at full level — only tier switches crossfade.
//
// Three intensity tiers keyed to the lowest remaining base HP:
//   > 20  tier 1 (stately)   |  > 10  tier 2 (urgent)  |  <= 10  tier 3 (frenzied)
// Preferred sources are sfx/music-1/2/3.mp3 (one shared motif, see
// tools/gen-music.mjs). Until those exist, the single sfx/music.mp3 drives all
// three tiers at rising playback rates — the same recording, growing frenzied.
// At 0 HP the score resolves: sfx/end-win.mp3 / end-loss.mp3 if present, else a
// synthesized D-major (victory) or D-minor (defeat) swell.
//
// iPadOS needs three things this file does and a desktop browser does not care
// about: the page must hold a media audio session (a silent looping <audio>
// element) or the whole graph is silenced by Silent mode and rides the ringer
// volume; the graph must be unlocked from a real gesture; and a context parked by
// an audio-session interruption has to be REBUILT, because resume() stops taking.
(function (SB) {
  'use strict';

  const cache = {};
  const sfxBuffers = {};        // name -> decoded AudioBuffer (Web Audio path)
  const sfxLoading = {};        // name -> in-flight decode promise
  let lastLogLen = 0;
  let muted = false;

  // Log sound tags the battle animation owns, and the clip each falls back to when
  // the animation is off (the old attack/hit/destroy clips were retired for these).
  const ANIM_OWNED = { attack: 'laser', hit: 'laserHit', destroy: 'defeat' };

  function clip(name) {
    if (!cache[name]) {
      const a = new Audio('sfx/' + name + '.mp3');
      a.preload = 'auto';
      cache[name] = a;
    }
    return cache[name];
  }

  // Fire a clip on the shared graph. The buffer is decoded on first use; the very
  // first hit of a clip falls back to an <audio> element so nothing is swallowed
  // while it decodes, and every later hit is pure Web Audio.
  function playSfx(name) {
    const ctx = actx();
    if (!ctx) return playSfxElement(name);
    const buf = sfxBuffers[name];
    if (buf) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = 0.5;
        src.connect(g).connect(ctx.destination);
        src.start();
      } catch (e) { /* context torn down */ }
      return;
    }
    loadSfx(ctx, name);   // missing clip: the element path stays the fallback
    playSfxElement(name);
  }

  // Decode the battle clips up front so the element fallback above stays unused
  // in practice — one clip through an <audio> element is enough to disturb the
  // audio session on iPadOS.
  const PREWARM = ['laser', 'laserHit', 'slash', 'lunge', 'shield', 'baseHit',
    'defeat', 'deploy', 'play', 'draw', 'discard', 'ability', 'buff', 'heal',
    'capture', 'claim'];
  function prewarmSfx() {
    const ctx = actx();
    if (!ctx) return;
    PREWARM.forEach(function (name) { loadSfx(ctx, name); });
  }

  function loadSfx(ctx, name) {
    if (sfxBuffers[name] || sfxLoading[name]) return sfxLoading[name];
    sfxLoading[name] = fetch('sfx/' + name + '.mp3')
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(function (ab) { return decode(ctx, ab); })
      .then(function (b) { sfxBuffers[name] = b; })
      .catch(function () {});
    return sfxLoading[name];
  }

  // Safari before 14.1 has only the callback form of decodeAudioData and returns
  // undefined, which turns the promise chain into a TypeError and leaves every clip
  // undecoded. Wrap both forms.
  function decode(ctx, ab) {
    return new Promise(function (resolve, reject) {
      const p = ctx.decodeAudioData(ab, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  function playSfxElement(name) {
    try {
      const a = clip(name).cloneNode();
      a.volume = 0.5;
      a.play().catch(function () { /* pre-interaction / missing file */ });
    } catch (e) { /* no audio support */ }
  }

  // ======================= adaptive music =======================
  const Music = {
    ctx: null, buffers: {}, tierRates: [1, 1, 1], sharedFallback: false,
    current: null,        // {tier, source, gain}
    tier: 0, ended: false, started: false,
  };
  const FADE_S = 1.6;          // crossfade length when the tier changes mid-match
  const OUT_S = 0.9;           // how fast the outgoing tier gets out of the way
  // Tier 1 opens the match: quieter and softened, so it reads as tension rather than
  // a duel already in progress. The later tiers open up in level and brightness.
  const TIER_GAIN = [0.13, 0.20, 0.27];
  const TIER_TONE = [1500, 4500, 14000];   // lowpass cutoff, Hz

  // iOS/iPadOS parks the AudioContext in 'suspended' — and, on newer WebKit,
  // 'interrupted' — whenever the page's audio session is taken away (another app,
  // a lock, a tab switch, or an HTMLMediaElement starting and stopping). A parked
  // context produces no sound while still happily accepting scheduled nodes, which
  // is what made the score go silent between clips. Resume on every state change
  // and on any user gesture, and keep polling the state, so it never stays parked.
  let stuck = 0;               // consecutive wakes that found the context parked
  function wake() {
    const ctx = Music.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') { stuck = 0; return; }
    // 'closed', or WebKit's 'interrupted' holding for several seconds with resume()
    // refusing to take: the context is gone for good — iPadOS lands here after an
    // audio-session interruption (a call, another app, Siri) and resume() resolves
    // while the graph stays silent. Nothing short of a new context brings it back.
    // Plain 'suspended' is never rebuilt: that is the ordinary pre-gesture state,
    // and resume() does take there.
    if (ctx.state === 'closed' || (ctx.state === 'interrupted' && ++stuck > 3)) {
      rebuild();
      return;
    }
    try { ctx.resume(); } catch (e) {}
  }

  // Stand a fresh context up and put the score back on it. AudioBuffers are not
  // bound to the context that decoded them, so the clips and tracks survive.
  function rebuild() {
    const old = Music.ctx;
    const tier = Music.tier;
    stuck = 0;
    Music.ctx = null;
    Music.current = null;
    Music.tier = 0;
    try { if (old && old.state !== 'closed') old.close(); } catch (e) {}
    if (!actx()) return;
    if (Music.started && !muted && !Music.ended && tier) playTier(tier);
  }

  let poll = null;
  function watchCtx(ctx) {
    ctx.onstatechange = wake;
    // One poll for the life of the page — a rebuild must not stack another.
    if (poll == null) poll = setInterval(wake, 1000);
  }

  function actx() {
    if (!Music.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      Music.ctx = new AC();
      watchCtx(Music.ctx);
    }
    wake();
    return Music.ctx;
  }

  // ---- iPadOS audio session ----
  // A page whose only output is Web Audio runs in iOS's "ambient" audio session:
  // it follows the RINGER volume and is silenced outright by Silent mode — which is
  // exactly a tablet where music and clips are all dead while everything else works.
  // Playing an HTMLAudioElement promotes the page to the media playback session,
  // which ignores the ring switch and follows the media volume. So we hold one
  // silent looping element open for the life of the page. It is started once, from
  // a user gesture, and never stopped: it was clips STARTING AND STOPPING elements
  // that used to park the context (see the header), not an element simply running.
  let holder = null;
  function silentWavUrl() {
    const sr = 8000, n = sr / 2;                 // half a second of 8-bit silence
    const bytes = new Uint8Array(44 + n);
    const dv = new DataView(bytes.buffer);
    function tag(off, s) { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); }
    tag(0, 'RIFF'); dv.setUint32(4, 36 + n, true); tag(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr, true);
    dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    tag(36, 'data'); dv.setUint32(40, n, true);
    for (let i = 0; i < n; i++) bytes[44 + i] = 128;   // 8-bit PCM silence is 0x80
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(s);
  }

  function holdSession() {
    try {
      if (!holder) {
        holder = new Audio(silentWavUrl());
        holder.loop = true;
        holder.volume = 0.001;      // inaudible where volume is settable; iOS ignores
                                    // it and plays the silence itself, which is the point
        holder.setAttribute('playsinline', '');
      }
      if (holder.paused) {
        const p = holder.play();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) { /* no audio support */ }
  }

  // The unlock every browser gates audio behind, and the one iPadOS needs to see a
  // buffer actually start. Wired to the first gesture ANYWHERE on the page, not just
  // to the Start button, and left armed so a later gesture recovers a parked session.
  function unlock() {
    const ctx = actx();
    holdSession();
    if (!ctx) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {}
  }

  if (typeof document !== 'undefined') {
    ['pointerdown', 'touchend', 'keydown', 'click'].forEach(function (ev) {
      document.addEventListener(ev, unlock, true);
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { wake(); holdSession(); }
    });
    window.addEventListener('focus', function () { wake(); holdSession(); });
    window.addEventListener('pageshow', function () { wake(); holdSession(); });
  }

  function fetchBuffer(name) {
    const ctx = actx();
    if (!ctx) return Promise.resolve(null);
    return fetch('sfx/' + name + '.mp3')
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(function (ab) { return decode(ctx, ab); })
      .catch(function () { return null; });
  }

  // Loop span = the sustained body of the track. A coarse RMS envelope is measured and
  // the loop runs from the first to the last window holding a good fraction of the
  // track's typical level, which drops decoder padding, the recorded fade-in, and the
  // closing decrescendo that made looping sound like a restart.
  const spanCache = new WeakMap();
  function audibleSpan(buf) {
    const cached = spanCache.get(buf);
    if (cached) return cached;
    const d = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const win = Math.max(1, Math.round(sr * 0.05));        // 50 ms windows
    const env = [];
    for (let i = 0; i + win <= d.length; i += win) {
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += d[j] * d[j];
      env.push(Math.sqrt(sum / win));
    }
    let span = { start: 0, end: buf.duration };
    if (env.length) {
      // Typical level = median of the windows that are not near-silent.
      const loud = env.filter(function (v) { return v > 0.004; })
                      .sort(function (x, y) { return x - y; });
      const median = loud.length ? loud[Math.floor(loud.length / 2)] : 0;
      const thr = Math.max(0.004, median * 0.8);
      let lo = 0, hi = env.length - 1;
      while (lo < env.length && env[lo] < thr) lo++;
      while (hi > lo && env[hi] < thr) hi--;
      if (lo < env.length) {
        // Nudge inward one window so neither loop edge sits on a ramp.
        const start = Math.min(lo + 1, hi) * win / sr;
        const end = Math.min(d.length, (hi + 1) * win) / sr;
        if (end - start > 1) span = { start: start, end: end };
      }
    }
    spanCache.set(buf, span);
    return span;
  }

  function loadMusic() {
    if (Music.loading) return Music.loading;
    // sfx/music.mp3 is only the fallback for a build with no tier tracks, and it is
    // the largest file in sfx/ — fetch it ONLY once the tiers are known to be missing,
    // never alongside them.
    Music.loading = Promise.all([
      fetchBuffer('music-1'), fetchBuffer('music-2'), fetchBuffer('music-3'),
      fetchBuffer('end-win'), fetchBuffer('end-loss'),
    ]).then(function (r) {
      Music.endBuffers = { win: r[3], loss: r[4] };
      if (r[0] && r[1] && r[2]) {
        Music.buffers = { 1: r[0], 2: r[1], 3: r[2] };
        return;
      }
      return fetchBuffer('music').then(function (one) {
        if (!one) return;
        // Single-track fallback: one recording, rising playback rate per tier.
        Music.buffers = { 1: one, 2: one, 3: one };
        Music.tierRates = [1.0, 1.09, 1.18];
        Music.sharedFallback = true;
      });
    });
    return Music.loading;
  }

  function playTier(tier) {
    const ctx = actx();
    const buf = Music.buffers[tier];
    if (!ctx || !buf) return;
    const span = audibleSpan(buf);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = span.start;
    src.loopEnd = span.end;
    src.playbackRate.value = Music.tierRates[tier - 1] || 1;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = TIER_TONE[tier - 1] || 14000;
    const gain = ctx.createGain();
    const level = TIER_GAIN[tier - 1] || 0.22;
    // Straight in at level: the score is meant to be already playing, not to swell up.
    gain.gain.setValueAtTime(level, ctx.currentTime);
    src.connect(tone).connect(gain).connect(ctx.destination);
    // When both tiers share one buffer, keep musical position across the switch.
    let offset = span.start;
    if (Music.sharedFallback && Music.current && Music.current.startedAt != null) {
      const played = (ctx.currentTime - Music.current.startedAt) * (Music.current.rate || 1);
      const len = span.end - span.start;
      offset = span.start + (played % len);
    }
    src.start(0, offset);
    fadeOutCurrent(true);   // incoming line is instant; the old one ducks out under it
    Music.current = { tier: tier, source: src, gain: gain, startedAt: ctx.currentTime, rate: src.playbackRate.value };
    Music.tier = tier;
  }

  function fadeOutCurrent(fast) {
    if (!Music.current) return;
    const ctx = Music.ctx;
    const old = Music.current;
    const t = fast ? OUT_S : FADE_S;
    try {
      old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime);
      old.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + t);
      old.source.stop(ctx.currentTime + t + 0.05);
    } catch (e) {}
    Music.current = null;
  }

  function tierFor(state) {
    let low = Infinity;
    state.players.forEach(function (p) {
      const hp = SB.card(p.base.cardId).hp - p.base.damage;
      if (hp < low) low = hp;
    });
    if (low > 20) return 1;
    if (low > 10) return 2;
    return 3;
  }

  // Synthesized finale fallback: a short orchestral-ish chord swell in D.
  function synthEnding(win) {
    const ctx = actx();
    if (!ctx) return;
    const freqs = win ? [146.83, 220.0, 293.66, 369.99]   // D3 A3 D4 F#4 — D major
                      : [146.83, 220.0, 293.66, 349.23];  // D3 A3 D4 F4  — D minor
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + (win ? 0.6 : 1.2));
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (win ? 4.5 : 6));
    master.connect(ctx.destination);
    freqs.forEach(function (f, i) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.value = win ? f : f * 0.999;            // hair of gravity on the loss
      const g = ctx.createGain();
      g.gain.value = 0.22 / freqs.length * (i === 0 ? 1.6 : 1);
      o.connect(g).connect(master);
      o.start(ctx.currentTime + i * (win ? 0.05 : 0.15)); // win stabs in, loss sags in
      o.stop(ctx.currentTime + 6.5);
    });
  }

  function playEnding(win) {
    if (Music.ended) return;
    Music.ended = true;
    fadeOutCurrent(true);
    // The end-of-match video brings its own audio; let it own the finale.
    if (SB.endVideo && SB.endVideo.claim(win)) return;
    const buf = Music.endBuffers && Music.endBuffers[win ? 'win' : 'loss'];
    const ctx = actx();
    if (buf && ctx) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      src.connect(g).connect(ctx.destination);
      src.start(ctx.currentTime + 0.4);
    } else {
      setTimeout(function () { synthEnding(win); }, 400);
    }
  }

  // The finale the animation still owes us: js/anim.js is drawing the planet that
  // ended the match, so the ending music and the end-of-match video wait for it.
  let deferredEnd = null;

  function updateMusic(state, deferEnd) {
    if (!state || !Music.started || muted) return;
    if (SB.isTerminal(state)) {
      const win = state.winner === (SB.ui ? SB.ui.humanSeat : 0);
      if (deferEnd) { deferredEnd = win; return; }
      playEnding(win);
      return;
    }
    if (Music.ended) return;
    const t = tierFor(state);
    if (t !== Music.tier) playTier(t);
  }

  // ======================= public surface =======================
  SB.sound = {
    isMuted: function () { return muted; },
    // Handed back by js/endvideo.js when the clip cannot play.
    playEndingFallback: function (win) {
      if (muted) return;
      const buf = Music.endBuffers && Music.endBuffers[win ? "win" : "loss"];
      const ctx = actx();
      if (buf && ctx) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = 0.35;
        src.connect(g).connect(ctx.destination);
        src.start(ctx.currentTime + 0.4);
      } else {
        setTimeout(function () { synthEnding(win); }, 400);
      }
    },
    toggleMute: function () {
      muted = !muted;
      if (muted) { fadeOutCurrent(true); Music.tier = 0; return muted; }
      // Unmuting has to put the score back on: the tier it was playing was torn
      // down, and updateMusic only starts a tier when the tier CHANGES.
      unlock();
      if (Music.started && !Music.ended && SB.ui && SB.ui.state && !SB.isTerminal(SB.ui.state)) {
        playTier(tierFor(SB.ui.state));
      }
      return muted;
    },
    // One clip, now. js/anim.js calls this at the moment a shot lands.
    // Clips go through the SAME AudioContext as the score. An <audio> element
    // playing alongside Web Audio is what broke the music on iPadOS: each element
    // reconfigured the page's audio session, so the score was only audible for as
    // long as a clip was playing. One graph, one session, no cutouts.
    sfx: function (name) {
      if (muted) return;
      playSfx(name);
    },
    // Called by the UI after every apply: SFX for new log entries + music tier.
    // `animated` = js/anim.js is about to draw this apply and will voice the battle
    // tags itself when each picture happens, so they are left alone here.
    // deferEnd: the caller (js/ui.js) is about to animate the match-ending blow and
    // will call playDeferredEnd() once the planet has finished going up.
    play: function (state, animated, deferEnd) {
      const fresh = state.log.slice(lastLogLen);
      lastLogLen = state.log.length;
      if (!muted) {
        const seen = {};
        fresh.forEach(function (l) {
          if (!l.sound || seen[l.sound]) return; // one clip per type per action
          if (animated && ANIM_OWNED[l.sound]) return;
          seen[l.sound] = true;
          SB.sound.sfx(ANIM_OWNED[l.sound] || l.sound);
        });
      }
      updateMusic(state, deferEnd);
    },
    // Undoing past the end: the finale we were holding is no longer owed.
    dropDeferredEnd: function () { deferredEnd = null; },
    // The end-of-match animation is over (played out or skipped): music and video now.
    playDeferredEnd: function () {
      if (deferredEnd == null) return;
      const win = deferredEnd;
      deferredEnd = null;
      playEnding(win);
    },
    reset: function () {
      lastLogLen = 0;
      deferredEnd = null;
      Music.ended = false;
      if (SB.endVideo) SB.endVideo.reset();
      fadeOutCurrent(true);
      Music.tier = 0;
      // The old state is still the finished match at this point: replaying its
      // ending here would re-trigger the end-of-match video over the new game.
      if (Music.started && SB.ui && SB.ui.state && !SB.isTerminal(SB.ui.state)) updateMusic(SB.ui.state);
    },
    // Kicked off on new game; real playback begins after the first user gesture
    // (browsers gate audio) — the first doAction's updateMusic picks it up.
    // Debug/inspection hook (used by tests and the pane; safe to keep).
    _debug: function () {
      return { started: Music.started, tier: Music.tier, ended: Music.ended,
        sharedFallback: Music.sharedFallback,
        buffers: Object.keys(Music.buffers).length,
        endings: Music.endBuffers ? [!!Music.endBuffers.win, !!Music.endBuffers.loss] : null,
        rate: Music.current ? Music.current.rate : 0,
        session: !!(holder && !holder.paused),
        ctxState: Music.ctx ? Music.ctx.state : 'none' };
    },
    startAmbience: function () {
      Music.started = true;
      unlock();          // this call is inside the Start button's click handler
      prewarmSfx();
      loadMusic().then(function () {
        if (!muted && !Music.ended && SB.ui && SB.ui.state && !SB.isTerminal(SB.ui.state)) {
          playTier(tierFor(SB.ui.state));
        }
      });
    },
  };
})(window.SB = window.SB || {});

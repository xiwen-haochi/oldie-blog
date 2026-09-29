---
title: "A chiptune theme without a single MP3"
date: 2026-04-02
description: "The background music on this site is square waves generated in your browser. Total download: 0 bytes."
tags: [code, retro, javascript, music]
---

Press the ♪ button in the corner. That is the whole soundtrack: oscillators,
a gain node, and about forty lines of JavaScript. Nothing is downloaded.

<!-- more -->

## How it works

```javascript
const ctx = new AudioContext();
const osc = ctx.createOscillator();   // square wave = 8-bit heart
osc.type = 'square';
osc.frequency.value = 523.25;         // C5
osc.connect(ctx.destination);
osc.start();
```

That plays one note forever. To get a tune you need a sequencer, a short note
table, and a lookahead scheduler so the timing does not drift when the tab is
busy.

```javascript
const MELODY = [
  [0, 523.25], [1, 659.25], [2, 783.99], [3, 659.25],
  [4, 587.33], [5, 493.88], [6, 440.00], [7, 493.88],
];

function schedule(step = 0) {
  const [beat, freq] = MELODY[step % MELODY.length];
  const at = ctx.currentTime + beat * 0.25;
  playNote(freq, at, 0.24);
  setTimeout(() => schedule(step + 1), 260);
}
```

## Why bother?

Because an autoplaying <audio> tag from 1999 was considered rude, and it still
is. So the music only starts when you ask for it, and it remembers your choice.
Respect the user, then be as loud as you like.

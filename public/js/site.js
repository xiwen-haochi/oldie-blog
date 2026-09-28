/* oldie-blog · site.js
 * Everything on this page that moves, blinks, beeps or answers back.
 * No frameworks. No build step. One file, about 20kB, ships as-is.
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var CSRF = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('oldie:' + k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('oldie:' + k, v); } catch (e) { /* private mode */ } },
  };

  /* ------------------------------------------------------------- toasts */
  function toast(text, kind) {
    var el = document.createElement('div');
    el.className = 'oldie-toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, 2600);
    setTimeout(function () { el.remove(); }, 3100);
  }

  /* ============================================================ THEME 1998 */
  var Theme = {
    key: 'theme',
    current: function () { return document.documentElement.getAttribute('data-theme') || 'classic'; },
    apply: function (mode) {
      document.documentElement.setAttribute('data-theme', mode);
      store.set(Theme.key, mode);
      $$('[data-toggle-theme]').forEach(function (b) {
        b.classList.toggle('on', mode === '1998');
        b.setAttribute('aria-pressed', mode === '1998' ? 'true' : 'false');
      });
    },
    toggle: function () { Theme.apply(Theme.current() === '1998' ? 'classic' : '1998'); },
    init: function () {
      // ?theme=1998 is shareable: "look at my site in 1998"
      var forced = /[?&]theme=(1998|classic)\b/.exec(location.search);
      if (forced) {
        Theme.apply(forced[1]);
      } else {
        var saved = store.get(Theme.key, null);
        if (saved) Theme.apply(saved);
      }
      document.addEventListener('click', function (e) {
        var t = e.target.closest('[data-toggle-theme]');
        if (!t) return;
        e.preventDefault();
        Theme.toggle();
        toast(Theme.current() === '1998' ? '⏳ TIME MACHINE: 1998 MODE' : '↩ back to the present');
      });
    },
  };

  /* ========================================================= CHIPTUNE PLAYER */
  var Chiptune = {
    ctx: null, master: null, timer: null, step: 0, playing: false, volume: 0.16,
    // an original little tune — square lead, triangle bass, noise hat
    lead: [523.25, 659.25, 783.99, 659.25, 587.33, 493.88, 440.00, 493.88,
           523.25, 659.25, 987.77, 880.00, 783.99, 659.25, 587.33, 523.25],
    bass: [130.81, 130.81, 196.00, 196.00, 146.83, 146.83, 220.00, 196.00],
    ensure: function () {
      if (Chiptune.ctx) return Chiptune.ctx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      Chiptune.ctx = new AC();
      Chiptune.master = Chiptune.ctx.createGain();
      Chiptune.master.gain.value = Chiptune.volume;
      Chiptune.master.connect(Chiptune.ctx.destination);
      return Chiptune.ctx;
    },
    note: function (freq, start, dur, type, gain) {
      var ctx = Chiptune.ctx;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain || 0.18, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g); g.connect(Chiptune.master);
      osc.start(start); osc.stop(start + dur + 0.02);
    },
    hat: function (start) {
      var ctx = Chiptune.ctx;
      var len = 0.04;
      var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      var src = ctx.createBufferSource();
      var g = ctx.createGain();
      g.gain.value = 0.06;
      src.buffer = buf; src.connect(g); g.connect(Chiptune.master);
      src.start(start);
    },
    tick: function () {
      var ctx = Chiptune.ctx;
      if (!ctx) return;
      var t = ctx.currentTime + 0.06;
      var s = Chiptune.step;
      var beat = 0.26;
      Chiptune.note(Chiptune.lead[s % Chiptune.lead.length], t, beat * 0.9, 'square', 0.14);
      if (s % 2 === 0) Chiptune.note(Chiptune.bass[(s >> 1) % Chiptune.bass.length], t, beat * 1.6, 'triangle', 0.22);
      if (s % 2 === 1) Chiptune.hat(t);
      if (s % 8 === 7) Chiptune.note(1046.5, t, beat * 0.5, 'square', 0.1);
      Chiptune.step++;
    },
    start: function () {
      var ctx = Chiptune.ensure();
      if (!ctx) { toast('⚠ This browser has no Web Audio API', 'warn'); return; }
      if (ctx.state === 'suspended') ctx.resume();
      Chiptune.playing = true;
      Chiptune.tick();
      Chiptune.timer = setInterval(Chiptune.tick, 260);
      store.set('music', 'on');
      Chiptune.paint(true);
    },
    stop: function () {
      Chiptune.playing = false;
      clearInterval(Chiptune.timer);
      Chiptune.timer = null;
      store.set('music', 'off');
      Chiptune.paint(false);
    },
    toggle: function () { Chiptune.playing ? Chiptune.stop() : Chiptune.start(); },
    paint: function (on) {
      $$('[data-toggle-music]').forEach(function (b) {
        b.classList.toggle('on', on);
        var lbl = b.querySelector('[data-music-label]');
        if (lbl) lbl.textContent = on ? 'STOP' : 'BGM';
      });
    },
    init: function () {
      document.addEventListener('click', function (e) {
        var t = e.target.closest('[data-toggle-music]');
        if (!t) return;
        e.preventDefault();
        Chiptune.toggle();
        toast(Chiptune.playing ? '♫ chiptune theme: ON (0 bytes downloaded)' : '♪ music off');
      });
      // remember the choice, but never autoplay without a gesture
      if (store.get('music', 'off') === 'on') {
        var once = function () {
          Chiptune.start();
          document.removeEventListener('pointerdown', once);
          document.removeEventListener('keydown', once);
        };
        document.addEventListener('pointerdown', once, { once: true });
        document.addEventListener('keydown', once, { once: true });
      }
    },
  };

  /* =========================================================== DOS TERMINAL */
  var Terminal = {
    el: null, body: null, input: null, form: null, ps1: null,
    history: [], hIndex: 0, cwd: 'C:\\OLDIE',
    boot: function () {
      Terminal.el = $('#terminal');
      if (!Terminal.el) return;
      Terminal.body = $('#term-body');
      Terminal.input = $('#term-input');
      Terminal.form = $('#term-form');
      Terminal.ps1 = $('#term-ps1');
      Terminal.el.setAttribute('aria-hidden', 'true');

      Terminal.form.addEventListener('submit', function (e) {
        e.preventDefault();
        Terminal.run(Terminal.input.value);
        Terminal.input.value = '';
      });
      $$('[data-term-action]').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.getAttribute('data-term-action');
          if (a === 'clear') Terminal.clear();
          else Terminal.run(a);
        });
      });
      $('#term-drag').addEventListener('dblclick', function () { Terminal.toggle(); });
      document.addEventListener('click', function (e) {
        if (!e.target.closest('[data-toggle-terminal]')) return;
        e.preventDefault();
        Terminal.toggle();
      });
      Terminal.input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (!Terminal.history.length) return;
          Terminal.hIndex = Math.max(0, Terminal.hIndex - 1);
          Terminal.input.value = Terminal.history[Terminal.hIndex] || '';
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          Terminal.hIndex = Math.min(Terminal.history.length, Terminal.hIndex + 1);
          Terminal.input.value = Terminal.history[Terminal.hIndex] || '';
        } else if (e.key === 'Escape') {
          Terminal.close();
        } else if (e.key === 'l' && e.ctrlKey) {
          e.preventDefault();
          Terminal.clear();
        }
      });
      Terminal.drag();
    },
    drag: function () {
      var bar = $('#term-drag');
      var term = Terminal.el;
      var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
      if (!bar) return;
      bar.addEventListener('mousedown', function (e) {
        if (e.target.closest('button')) return;
        dragging = true;
        var r = term.getBoundingClientRect();
        ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
        bar.style.cursor = 'grabbing';
        e.preventDefault();
      });
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var x = Math.min(Math.max(0, ox + e.clientX - sx), window.innerWidth - 120);
        var y = Math.min(Math.max(0, oy + e.clientY - sy), window.innerHeight - 40);
        term.style.left = x + 'px';
        term.style.top = y + 'px';
        term.style.right = 'auto';
        term.style.bottom = 'auto';
      });
      window.addEventListener('mouseup', function () { dragging = false; if (bar) bar.style.cursor = 'grab'; });
    },
    echo: function (text, cls) {
      var line = document.createElement('div');
      line.className = 'term-line' + (cls ? ' ' + cls : '');
      line.textContent = text;
      Terminal.body.appendChild(line);
      Terminal.body.scrollTop = Terminal.body.scrollHeight;
    },
    banner: function () {
      Terminal.body.innerHTML = '';
      [
        'oldie-blog DOS [Version 0.1.0]',
        '(C) 1998-2025 The Webmaster. All rights reserved.',
        '',
        'Type "help" for the command list, "dir" to look around,',
        'or "neofetch" if you would like to feel informed.',
        '',
      ].forEach(function (l) { Terminal.echo(l, l ? '' : 'dim'); });
    },
    clear: function () { Terminal.body.innerHTML = ''; },
    open: function () {
      if (!Terminal.el) return;
      if (!Terminal.body.childNodes.length) Terminal.banner();
      Terminal.el.classList.add('open');
      Terminal.el.setAttribute('aria-hidden', 'false');
      Terminal.input.focus();
    },
    close: function () {
      Terminal.el.classList.remove('open');
      Terminal.el.setAttribute('aria-hidden', 'true');
    },
    toggle: function () {
      if (!Terminal.el) return;
      Terminal.el.classList.contains('open') ? Terminal.close() : Terminal.open();
    },
    run: function (cmd) {
      var raw = String(cmd || '').trim();
      if (!raw) return;
      Terminal.history.push(raw);
      Terminal.hIndex = Terminal.history.length;
      Terminal.echo(Terminal.cwd + '>' + raw, 'hi');

      var lower = raw.toLowerCase();
      var parts = lower.split(/\s+/);
      var head = parts[0];

      // ---- commands handled entirely in the browser --------------------
      if (head === 'clear' || head === 'cls') return Terminal.clear();
      if (head === 'exit' || head === 'quit') { Terminal.echo('bye', 'dim'); return Terminal.close(); }
      if (head === 'help' || head === '?') return fetchCmd(raw);
      if (head === 'cd') {
        var target = (raw.split(/\s+/)[1] || '').toLowerCase();
        if (!target || target === '..' || target === 'home' || target === '/') Terminal.cwd = 'C:\\OLDIE';
        else if (['posts', 'tags', 'ring', 'guestbook'].indexOf(target) > -1) Terminal.cwd = 'C:\\OLDIE\\' + target.toUpperCase();
        else {
          Terminal.echo('The system cannot find the path specified.', 'err');
          Terminal.echo('Available: posts, tags, ring, guestbook, home', 'dim');
          return;
        }
        Terminal.ps1.textContent = Terminal.cwd + '>';
        return fetchCmd('dir');
      }
      if (head === 'music') {
        var arg = (lower.split(/\s+/)[1] || 'toggle');
        if (arg === 'off') Chiptune.stop(); else if (arg === 'on') Chiptune.start(); else Chiptune.toggle();
        return Terminal.echo('♪ chiptune ' + (Chiptune.playing ? 'playing' : 'stopped'), 'warn');
      }
      if (head === 'theme') {
        var t = (lower.split(/\s+/)[1] || '');
        if (t === '1998') Theme.apply('1998'); else if (t === 'classic') Theme.apply('classic'); else Theme.toggle();
        return Terminal.echo('⏳ theme: ' + Theme.current(), 'warn');
      }
      if (head === 'open' || head === 'start') {
        var url = raw.split(/\s+/).slice(1).join(' ') || '/';
        Terminal.echo('[ open ' + url + ' ]', 'warn');
        if (url.charAt(0) === '/') setTimeout(function () { location.href = url; }, 500);
        return;
      }
      return fetchCmd(raw);
    },
  };

  function fetchCmd(cmd) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/terminal', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.onload = function () {
      if (xhr.status !== 200) {
        Terminal.echo('ERROR ' + xhr.status + ': the machine refused that command.', 'err');
        return;
      }
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
      (data.lines || []).forEach(function (l) {
        if (l.cls === 'clear') Terminal.clear();
        else Terminal.echo(l.text, l.cls);
      });
    };
    xhr.onerror = function () { Terminal.echo('ERROR: could not reach the server.', 'err'); };
    xhr.send('cmd=' + encodeURIComponent(cmd) + '&_csrf=' + encodeURIComponent(CSRF) + '&screen=' + encodeURIComponent(window.screen.width + 'x' + window.screen.height));
  }

  /* ============================================================== RADIO */
  var Radio = {
    speaking: false,
    meter: null,
    ensureMeter: function () {
      if (Radio.meter) return Radio.meter;
      var bar = document.createElement('div');
      bar.className = 'radio-meter';
      bar.innerHTML = '<div class="vu"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><span class="radio-label">📻 ON AIR</span><button class="btn tiny" type="button">STOP</button>';
      var body = $('[data-post-body]');
      (body ? body.parentNode : document.body).insertBefore(bar, body);
      bar.querySelector('button').addEventListener('click', function () { Radio.stop(); });
      Radio.meter = bar;
      return bar;
    },
    stop: function () {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      Radio.speaking = false;
      if (Radio.meter) Radio.meter.remove();
      Radio.meter = null;
      $$('[data-listen-post]').forEach(function (b) { b.textContent = '📻 LISTEN TO THIS POST'; });
    },
    play: function () {
      if (!('speechSynthesis' in window)) { toast('⚠ Your browser cannot speak. It was invented later than 1998.', 'warn'); return; }
      var body = $('[data-post-body]');
      if (!body) return;
      Radio.stop();
      var meter = Radio.ensureMeter();
      meter.classList.add('live');
      var chunks = [];
      var paragraphs = $$('p, li, h2, h3, blockquote, pre', body);
      (paragraphs.length ? paragraphs : [body]).forEach(function (el) {
        var text = (el.textContent || '').trim();
        if (text.length > 1) chunks.push(text);
      });
      var u = new SpeechSynthesisUtterance(chunks.join(' … '));
      u.rate = 0.96; u.pitch = 0.85; u.volume = 1;
      u.lang = document.documentElement.lang || 'en-US';
      u.onend = function () { Radio.stop(); toast('📻 that was the bulletin'); };
      u.onerror = function () { Radio.stop(); };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      Radio.speaking = true;
      $$('[data-listen-post]').forEach(function (b) { b.textContent = '⏹ STOP NARRATION'; });
    },
    init: function () {
      document.addEventListener('click', function (e) {
        var b = e.target.closest('[data-listen-post]');
        if (!b) return;
        e.preventDefault();
        Radio.speaking ? Radio.stop() : Radio.play();
      });
    },
  };

  /* ======================================================== hit counter */
  function animateCounter(el, from, to) {
    if (from === to) { el.textContent = to; return; }
    var start = performance.now();
    var dur = 620;
    (function frame(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(frame);
    })(start);
  }

  function refreshStats() {
    fetch('/api/stats', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var digits = $$('#hit-counter .digit');
        if (digits.length) {
          var str = String(s.total).padStart(8, '0').slice(-8);
          animateCounter(digits[digits.length - 1], Number(digits[digits.length - 1].textContent) || 0, Number(str[str.length - 1]));
        }
        var t = $('#hit-today'); if (t) t.textContent = s.today;
        var u = $('#hit-unique'); if (u) u.textContent = s.unique;
        var o = $('#sb-online'); if (o) o.textContent = s.online;
        var h = $('#sb-hits'); if (h) h.textContent = s.total;
      })
      .catch(function () { /* offline: keep the baked-in numbers */ });
  }

  /* ======================================================= dial-up loader */
  function dialup() {
    var wrap = $('#dialup');
    var bar = $('#dialup-bar');
    var sb = $('#sb-status');
    if (!wrap || !bar) return;
    var pct = 0;
    var timer = setInterval(function () {
      pct += Math.random() * 18 + 6;
      if (pct >= 100) {
        pct = 100;
        clearInterval(timer);
        wrap.classList.add('done');
        if (sb) sb.innerHTML = '📄 Document: Done &nbsp;·&nbsp; transferred in ' + perfMs() + ' ms';
        setTimeout(function () { wrap.style.height = '0'; wrap.style.opacity = '0'; }, 700);
      }
      bar.style.width = pct + '%';
      if (sb) sb.innerHTML = '📶 Connecting at 56,000 bps… ' + Math.floor(pct) + '%';
    }, 55);
  }

  function perfMs() {
    var nav = performance.getEntriesByType('navigation')[0];
    return nav ? Math.round(nav.domContentLoadedEventEnd || performance.now()) : Math.round(performance.now());
  }

  /* ========================================================== misc chrome */
  function chrome() {
    var gen = $('#gen-time');
    if (gen) gen.textContent = perfMs();

    var status = $('#sb-status');
    if (status && !status.textContent.match(/Document/)) {
      setTimeout(function () { status.innerHTML = '📄 Document: Done'; }, 1400);
    }

    var path = $('#sb-path');
    if (path) path.textContent = location.pathname + location.search;

    $$('[data-copy]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var text = el.getAttribute('data-copy');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { toast('🔗 link copied: ' + text); });
        } else {
          var ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); toast('🔗 link copied'); } catch (err) { toast('copy failed', 'warn'); }
          ta.remove();
        }
      });
    });

    $$('[data-scroll-top]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (el.tagName === 'A') e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    $$('[data-terminal-cat]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        Terminal.open();
        Terminal.run('type ' + el.getAttribute('data-terminal-cat'));
      });
    });

    // subtitle flash in the title bar
    var tb = $('#tb-title');
    if (tb && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      var base = tb.textContent;
      var i = 0;
      setInterval(function () {
        if (document.hidden || document.querySelector('.terminal.open')) return;
        i = (i + 1) % (base.length + 1);
        tb.textContent = base.slice(0, i) + '_'.repeat(0);
      }, 2600);
    }

    // guestbook / comment character counters
    $$('textarea[maxlength]').forEach(function (ta) {
      var id = ta.id;
      if (!id) return;
      var hint = document.createElement('div');
      hint.className = 'form-note';
      hint.style.textAlign = 'right';
      var sync = function () { hint.textContent = ta.value.length + ' / ' + ta.getAttribute('maxlength') + ' characters'; };
      ta.addEventListener('input', sync);
      ta.parentNode.appendChild(hint);
      sync();
    });
  }

  /* ====================================================== instant search */
  function instantSearch() {
    var input = $('#q');
    if (!input) return;
    var box = document.createElement('div');
    box.className = 'suggest';
    box.hidden = true;
    input.parentNode.style.position = 'relative';
    input.parentNode.appendChild(box);
    var items = [];
    var sel = -1;
    var timer = null;

    function hide() { box.hidden = true; sel = -1; items = []; }
    function paint() {
      items.forEach(function (el, i) { el.classList.toggle('sel', i === sel); });
    }
    function render(results) {
      box.innerHTML = '';
      if (!results.length) {
        var none = document.createElement('div');
        none.className = 'form-note';
        none.style.padding = '6px 8px';
        none.textContent = 'no hits. try tag: or a shorter word.';
        box.appendChild(none);
      }
      results.forEach(function (r) {
        var a = document.createElement('a');
        a.href = r.url;
        a.innerHTML = '<strong>' + escapeHtml(r.title) + '</strong><br><span class="mono" style="font-size:11px">' + escapeHtml(r.description.slice(0, 90)) + '</span>';
        box.appendChild(a);
        items.push(a);
      });
      box.hidden = false;
      sel = -1;
      paint();
    }
    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 2) return hide();
      timer = setTimeout(function () {
        fetch('/api/search?q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (d) { render(d.results || []); })
          .catch(function () { hide(); });
      }, 160);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
      else if (e.key === 'Enter' && sel >= 0 && items[sel]) { e.preventDefault(); location.href = items[sel].getAttribute('href'); }
      else if (e.key === 'Escape') { hide(); }
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search-box') && !e.target.closest('.suggest')) hide(); });
  }

  /* ============================================================== shortcuts */
  function shortcuts() {
    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        Terminal.toggle();
        return;
      }
      if (e.key === '/' && !typing) {
        var q = $('#q');
        if (q) { e.preventDefault(); q.focus(); }
      }
      if (e.key === 'Escape' && Terminal.el && Terminal.el.classList.contains('open')) Terminal.close();
    });
  }

  /* ==================================================================== boot */
  function init() {
    try { Theme.init(); } catch (e) { console.warn('theme', e); }
    try { Terminal.boot(); } catch (e) { console.warn('terminal', e); }
    try { Chiptune.init(); } catch (e) { console.warn('chiptune', e); }
    try { Radio.init(); } catch (e) { console.warn('radio', e); }
    try { shortcuts(); } catch (e) { console.warn('shortcuts', e); }
    try { chrome(); } catch (e) { console.warn('chrome', e); }
    try { instantSearch(); } catch (e) { console.warn('search', e); }
    try { dialup(); } catch (e) { console.warn('dialup', e); }
    refreshStats();
    setInterval(refreshStats, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

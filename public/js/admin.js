/* oldie-blog · admin.js — editor helpers: live preview, slugs, autosave */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var CSRF = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var I18N = {};
  try {
    var blob = document.getElementById('i18n-admin');
    if (blob) I18N = JSON.parse(blob.textContent || '{}');
  } catch (e) { /* fall back to the keys below */ }
  var say = function (key, fallback) { return I18N[key] || fallback; };
  var form = $('#editor-form');

  /* --------------------------------------------------- delete confirms */
  document.addEventListener('submit', function (e) {
    var message = e.target.getAttribute('data-confirm');
    if (message && !window.confirm(message)) e.preventDefault();
  });

  if (!form) return;

  var body = $('#body', form);
  var title = $('#title', form);
  var slug = $('#slug', form);
  var originalSlug = $('input[name="originalSlug"]', form);
  var originalSlugValue = (originalSlug && originalSlug.value) || '';
  var description = $('#description', form);
  var stats = $('#editor-stats');
  var autosave = $('#autosave-state');
  var previewPane = $('#preview-pane');
  var metaPane = $('#meta-pane');
  var rawPane = $('#raw-pane');

  function slugify(text) {
    return String(text || '').toLowerCase().trim()
      .replace(/['"]/g, '')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70);
  }

  /* ------------------------------------------------------- live slug */
  if (title && slug) {
    var slugTouched = slug.value.trim().length > 0;
    slug.addEventListener('input', function () { slugTouched = true; });
    title.addEventListener('input', function () {
      if (slugTouched) return;
      slug.value = slugify(title.value);
      paintSlug();
    });
    function paintSlug() {
      var el = $('#slug-preview');
      if (!el) return;
      var kind = form.getAttribute('action').indexOf('pages') > -1 ? '' : '/posts/';
      el.textContent = kind + (slug.value || '…');
    }
    slug.addEventListener('input', paintSlug);
    paintSlug();
  }

  /* ---------------------------------------------------------- stats */
  function paintStats() {
    if (!body) return;
    var text = body.value;
    var words = (text.match(/[\u4e00-\u9fff]/g) || []).length + (text.match(/[A-Za-z0-9_'-]+/g) || []).length;
    var mins = Math.max(1, Math.round((words / 260) * 10) / 10);
    if (stats) stats.textContent = words + ' · ' + mins + ' min · ' + text.length + ' chars';
  }
  if (body) body.addEventListener('input', paintStats);
  paintStats();

  /* --------------------------------------------------- toolbar wraps */
  $$('[data-wrap]', form).forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!body) return;
      var token = btn.getAttribute('data-wrap');
      var start = body.selectionStart;
      var end = body.selectionEnd;
      var selected = body.value.slice(start, end);
      var before = body.value.slice(0, start);
      var after = body.value.slice(end);
      if (token === '**' || token === '_') {
        body.value = before + token + (selected || 'text') + token + after;
        body.setSelectionRange(start + token.length, start + token.length + (selected || 'text').length);
      } else if (token.startsWith('![')) {
        body.value = before + token + (selected || 'alt text') + after;
      } else {
        body.value = before + token + selected + after;
        body.setSelectionRange(start + token.length, start + token.length + selected.length);
      }
      body.focus();
      body.dispatchEvent(new Event('input'));
    });
  });

  /* ------------------------------------------------- image insertion */
  function insertAtCursor(text) {
    if (!body) return;
    var start = body.selectionStart || body.value.length;
    body.value = body.value.slice(0, start) + text + body.value.slice(body.selectionEnd || start);
    body.focus();
    body.dispatchEvent(new Event('input'));
  }
  $$('[data-insert-image]', form).forEach(function (b) {
    b.addEventListener('click', function () { insertAtCursor('![' + (title ? title.value : 'image') + '](' + b.getAttribute('data-insert-image') + ')'); });
  });

  var fileInput = $('#upload-inline');
  if (fileInput) {
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) { alert('Too big: max 4 MB'); return; }
      var reader = new FileReader();
      reader.onload = function () { insertAtCursor('![' + (title ? title.value : 'image') + '](' + reader.result + ')'); };
      reader.readAsDataURL(file);
    });
  }

  document.addEventListener('paste', function (e) {
    var target = e.target.getAttribute && e.target.getAttribute('data-paste-target');
    if (!target) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') === 0) {
        var file = items[i].getAsFile();
        var reader = new FileReader();
        reader.onload = function () { $('#' + target).value = reader.result; };
        reader.readAsDataURL(file);
        break;
      }
    }
  });

  /* ------------------------------------------------------ live preview */
  var timer = null;
  var lastSaved = null;
  function refreshPreview() {
    var data = new FormData(form);
    fetch('/admin/preview', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': CSRF,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams(data).toString(),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) throw new Error(d.error);
        if (previewPane) previewPane.innerHTML = d.html || '<p class="form-note">' + escapeHtml(say('previewEmpty', 'Nothing to preview yet.')) + '</p>';
        if (metaPane) {
          metaPane.innerHTML =
            '<table class="table"><tbody>' +
            row('Title', d.meta.title || '(empty)') +
            row('Meta description', d.meta.description) +
            row('Canonical', d.meta.url) +
            row('OG image', '/assets/og-default.svg') +
            row('Reading time', d.readingTime + ' min') +
            row('Words', d.wordCount) +
            row('Excerpt', d.excerpt) +
            '</tbody></table>' +
            '<p class="form-note">Copy this snippet if you syndicate elsewhere:</p>' +
            '<textarea rows="3" class="mono" onclick="this.select()">' +
            escapeHtml('<meta name="description" content="' + d.meta.description + '">') + '</textarea>';
        }
        if (rawPane) rawPane.textContent = body ? body.value : '';
        if (!description && d.excerpt) {
          description.value = d.excerpt;
          description.dispatchEvent(new Event('input'));
        }
      })
      .catch(function (err) {
        if (previewPane) previewPane.innerHTML = '<div class="alert err">' + escapeHtml(say('previewFailed', 'Preview failed: {msg}').replace('{msg}', err.message)) + '</div>';
      });
  }
  function row(k, v) {
    return '<tr><th style="width:34%">' + escapeHtml(k) + '</th><td>' + escapeHtml(String(v)) + '</td></tr>';
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function schedulePreview() {
    clearTimeout(timer);
    timer = setTimeout(refreshPreview, 420);
  }
  if (body) body.addEventListener('input', schedulePreview);
  $$('[name="title"], [name="description"], [name="slug"], [name="tags"], [name="cover"]', form).forEach(function (el) {
    el.addEventListener('input', schedulePreview);
  });
  refreshPreview();

  /* ---------------------------------------------------------- tabs */
  $$('[data-preview-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var name = tab.getAttribute('data-preview-tab');
      $$('[data-preview-tab]').forEach(function (t) { t.classList.toggle('on', t === tab); });
      if (previewPane) previewPane.hidden = name !== 'preview';
      if (metaPane) metaPane.hidden = name !== 'meta';
      if (rawPane) rawPane.hidden = name !== 'raw';
      if (name === 'raw' && rawPane && body) rawPane.textContent = body.value;
    });
  });

  /* ------------------------------------------------------- autosave */
  // one stable key per post, so a saved post never leaves a ghost draft behind
  var KEY = 'oldie:draft:' + (originalSlugValue || 'new');
  var dirty = false;
  var submitted = false;

  function markDirty() {
    dirty = true;
    submitted = false;
    if (body && body.value.trim()) {
      try { localStorage.setItem(KEY, body.value); } catch (err) { /* quota */ }
    }
  }

  if (body) {
    var snapshot = localStorage.getItem(KEY);
    var justSaved = /[?&]saved=1/.test(location.search);
    var stale = snapshot && snapshot !== body.value && snapshot.trim().length > 40;
    if (stale && !justSaved) {
      var restore = window.confirm(say('unsaved', 'Found an unsaved local draft ({n} chars). Restore it?').replace('{n}', snapshot.length));
      if (restore) { body.value = snapshot; body.dispatchEvent(new Event('input')); }
    }
    body.addEventListener('input', markDirty);
    setInterval(function () {
      if (!dirty || submitted || !body || !body.value.trim()) return;
      if (autosave) autosave.textContent = say('autosave', 'local autosave {time}').replace('{time}', new Date().toLocaleTimeString());
    }, 8000);

    // Only nag when there is genuinely unsaved work. Saving posts a form and
    // lands back here with ?saved=1, so a fresh load must stay quiet.
    form.addEventListener('submit', function () {
      submitted = true;
      dirty = false;
      try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
    });
    window.addEventListener('beforeunload', function (e) {
      if (!dirty || submitted) return;
      if (body && !body.value.trim() && !title.value.trim()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }
})();

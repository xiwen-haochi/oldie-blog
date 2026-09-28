import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCALES, DEFAULT_LOCALE, normaliseLocale, availableLocales, localeMeta,
  resolveLocale, makeTranslator, clientStrings,
} from '../src/lib/i18n.js';

test('ships Chinese and English, Chinese first', () => {
  assert.deepEqual(Object.keys(LOCALES), ['zh-CN', 'en']);
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  assert.deepEqual(availableLocales().map((l) => l.code), ['zh-CN', 'en']);
  assert.equal(localeMeta('zh-CN').label, '中文');
});

test('normaliseLocale folds regional variants', () => {
  assert.equal(normaliseLocale('zh'), 'zh-CN');
  assert.equal(normaliseLocale('zh-TW'), 'zh-CN');
  assert.equal(normaliseLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(normaliseLocale('EN'), 'en');
  assert.equal(normaliseLocale('en-GB'), 'en');
  assert.equal(normaliseLocale('fr'), null);
  assert.equal(normaliseLocale(''), null);
  assert.equal(normaliseLocale(undefined), null);
});

test('resolveLocale prefers the query string', () => {
  const req = { query: { lang: 'en' }, cookies: { oldie_lang: 'zh-CN' }, headers: {} };
  assert.equal(resolveLocale(req, 'zh-CN'), 'en');
});

test('resolveLocale falls back to cookie, then header, then config', () => {
  assert.equal(resolveLocale({ query: {}, cookies: { oldie_lang: 'en' }, headers: {} }, 'zh-CN'), 'en');
  assert.equal(resolveLocale({ query: {}, cookies: {}, headers: { 'accept-language': 'fr;q=0.9, en;q=0.8' } }, 'zh-CN'), 'en');
  assert.equal(resolveLocale({ query: {}, cookies: {}, headers: {} }, 'zh-CN'), 'zh-CN');
  assert.equal(resolveLocale({ query: {}, cookies: {}, headers: {} }, 'de'), 'zh-CN', 'unknown config falls back to default');
});

test('translator interpolates {vars}', () => {
  const zh = makeTranslator('zh-CN');
  assert.match(zh('home.visitor_line', { total: 42, since: '1998', posts: 4, guestbook: 5 }), /42/);
  assert.ok(!zh('home.visitor_line', { total: 42 }).includes('{total}'));
  const en = makeTranslator('en');
  assert.match(en('footer.you_are_visiting', { n: 2, total: 5 }), /#2 of 5/);
});

test('unknown keys return the key itself (loud, not silent)', () => {
  const zh = makeTranslator('zh-CN');
  assert.equal(zh('nope.not.here'), 'nope.not.here');
  assert.equal(zh.has('nope.not.here'), false);
  assert.equal(zh.has('side.guestbook'), true);
});

test('every shipped key exists in both dictionaries', () => {
  const zh = makeTranslator('zh-CN');
  const en = makeTranslator('en');
  const keys = Object.keys(LOCALES);
  assert.ok(keys.length === 2);
  for (const key of Object.keys(zhDict())) {
    assert.ok(en.has(key), 'missing English translation: ' + key);
  }
});

// reach into the module internals via a fresh translator on both sides
function zhDict() {
  return DICT_ZH;
}
import { DICT_ZH, DICT_EN } from '../src/lib/i18n.js';

test('dictionaries are the same size', () => {
  assert.equal(Object.keys(DICT_ZH).length, Object.keys(DICT_EN).length);
});

test('client strings cover the toasts the browser shows', () => {
  const zh = clientStrings('zh-CN');
  const en = clientStrings('en');
  for (const key of ['themeOn', 'musicOn', 'noAudio', 'noSpeech', 'onAir', 'listen', 'previewEmpty']) {
    assert.ok(zh[key], 'zh missing ' + key);
    assert.ok(en[key], 'en missing ' + key);
    assert.notEqual(zh[key], en[key], key + ' was not translated');
  }
  assert.equal(zh.locale, 'zh-CN');
  assert.equal(en.locale, 'en');
});

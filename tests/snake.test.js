/* tests/snake.test.js
 *
 * The snake is the only feature that runs entirely in the browser, so nothing
 * else in this suite can see it. It is also the only feature that has shipped
 * a bug the node tests could not catch: a NaN coordinate once, and a death
 * that printed itself once every 130ms until you noticed and pressed q.
 *
 * So rather than leave it untested, this loads the shipped source out of
 * public/js/site.js and drives it against stubs. It is the real code, not a
 * copy -- if the game stops working, this fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'public/js/site.js'), 'utf8');

/** Build a game wired to stubs, and hand back the handles a test needs. */
function load() {
  // Back each marker up to its opening /* -- slicing from the middle of a
  // banner comment leaves the next banner unterminated.
  const from = SRC.lastIndexOf('/*', SRC.indexOf('SNAKE */'));
  const to = SRC.lastIndexOf('/*', SRC.indexOf('RADIO */'));
  assert.ok(from > -1 && to > from, 'the snake block moved; update the markers here');

  const lines = [];
  const keys = [];
  const timers = new Map();
  let nextId = 1;

  const body = {
    child: null,
    scrollTop: 0,
    scrollHeight: 100,
    appendChild(el) { this.child = el; el.parentNode = this; return el; },
    removeChild(el) { if (this.child === el) this.child = null; el.parentNode = null; return el; },
  };
  const document = {
    createElement: () => ({ textContent: '', parentNode: null }),
    addEventListener: (type, fn) => { if (type === 'keydown') keys.push(fn); },
    removeEventListener: (type, fn) => {
      if (type !== 'keydown') return;
      const at = keys.indexOf(fn);
      if (at > -1) keys.splice(at, 1);
    },
  };
  const saved = new Map();
  const window = {
    localStorage: {
      getItem: (k) => (saved.has(k) ? saved.get(k) : null),
      setItem: (k, v) => saved.set(k, String(v)),
    },
  };
  const Terminal = { echo: (text) => lines.push(String(text)), body };

  const Snake = new Function(
    'Terminal', 'document', 'window', 'setInterval', 'clearInterval',
    SRC.slice(from, to) + '\nreturn Snake;',
  )(
    Terminal, document, window,
    (fn, ms) => { const id = nextId++; timers.set(id, fn); return id; },
    (id) => { timers.delete(id); },
  );

  /**
   * Park the apple somewhere the snake will not meet it. Food spawns at
   * random, so a test that counts score is a coin flip: about one run in
   * five the snake eats on its way into the wall and the total is not what
   * the test wrote down.
   */
  const parkFood = () => { Snake.state.food = { x: 0, y: 0 }; };

  /** Run the field forward until it dies or the cap is hit. */
  function run(turns, dir) {
    for (let i = 0; i < turns; i++) {
      if (dir) Snake.turn(dir);
      Snake.step();
      if (Snake.state && Snake.state.dead) return i + 1;
    }
    return 0;
  }

  return {
    Snake, body, saved, parkFood,
    live: () => timers.size,
    lines,
    said: (needle) => lines.filter((l) => l.includes(needle)).length,
    press: (key) => { for (const fn of keys.slice()) fn({ key, preventDefault() {} }); },
    keys: () => keys.slice(),
    run,
  };
}

test('a live field runs on exactly one timer', () => {
  const g = load();
  g.Snake.start();
  assert.equal(g.live(), 1);
});

test('a live field still refuses to start twice', () => {
  const g = load();
  g.Snake.start();
  g.lines.length = 0;
  g.Snake.start();
  assert.match(g.lines.join('\n'), /already loose/);
  assert.equal(g.live(), 1, 'a second field would mean a second timer');
});

test('steering moves the head, and the snake never turns back on itself', () => {
  const g = load();
  g.Snake.start();
  const start = { ...g.Snake.state.snake[0] };
  g.Snake.step();
  assert.equal(g.Snake.state.snake[0].x, start.x + 1);

  g.Snake.turn({ x: -1, y: 0 });          // straight back into itself
  g.Snake.step();
  assert.equal(g.Snake.state.snake[0].x, start.x + 2, 'the snake doubled back');
});

test('the apple scores ten and the field grows', () => {
  const g = load();
  g.Snake.start();
  const s = g.Snake.state;
  const length = s.snake.length;
  s.food = { x: s.snake[0].x + 1, y: s.snake[0].y };
  g.Snake.step();
  assert.equal(g.Snake.score, 10);
  assert.equal(g.Snake.state.snake.length, length + 1);
});

test('a dead field reports the game over exactly once', () => {
  const g = load();
  g.Snake.start();
  assert.ok(g.run(40) > 0, 'the field should have died');
  assert.equal(g.said('GAME OVER'), 1);
  assert.equal(g.said('score'), 1);
  assert.equal(g.said('type snake to play again'), 1);
});

test('a dead field cannot keep printing the game over on later ticks', () => {
  const g = load();
  g.Snake.start();
  g.run(40);
  // The bug: step() never looked at state.dead, so every tick walked the same
  // head into the same wall and printed the whole block again.
  const said = g.lines.length;
  for (let i = 0; i < 200; i++) g.Snake.step();
  assert.equal(g.said('GAME OVER'), 1);
  assert.equal(g.lines.length, said, 'no extra output after the game is over');
});

test('a dead field leaves no timer behind', () => {
  const g = load();
  g.Snake.start();
  g.run(40);
  assert.equal(g.live(), 0, 'a finished game should not keep ticking');
});

test('a dead field ignores the arrow keys but still answers q', () => {
  const g = load();
  g.Snake.start();
  g.run(40);

  let eaten = false;
  for (const fn of g.keys()) fn({ key: 'ArrowUp', preventDefault() { eaten = true; } });
  assert.equal(eaten, false, 'a dead field must not swallow keys meant for the prompt');
  assert.equal(g.Snake.state.dead, true);

  // a finished program still exits when you ask it to
  g.press('q');
  assert.equal(g.said('(process ended'), 1);
  assert.equal(g.live(), 0);
});

test('the game over screen tells the truth: snake starts a new field', () => {
  const g = load();
  g.Snake.start();
  g.run(40);
  g.lines.length = 0;

  g.Snake.start();
  assert.doesNotMatch(g.lines.join('\n'), /already loose/, 'a finished game must not refuse a retry');
  assert.equal(g.Snake.state.dead, false);
  assert.equal(g.Snake.score, 0);
  assert.equal(g.live(), 1, 'the new field needs its own timer');
});

test('a new field replaces the dead one instead of stacking below it', () => {
  const g = load();
  g.Snake.start();
  g.run(40);
  const dead = g.body.child;
  g.Snake.start();
  assert.notEqual(g.body.child, dead, 'the old board was left on screen');
  assert.equal(dead.parentNode, null);
});

test('the best score survives a restart', () => {
  const g = load();
  g.Snake.start();
  g.parkFood();
  g.Snake.score = 70;
  g.run(40);
  assert.equal(g.saved.get('snake.best'), '70');
  g.Snake.start();
  assert.equal(g.Snake.best, 70);
});

test('starting a new game does not wipe the stored record', () => {
  const g = load();
  g.Snake.start();
  g.parkFood();
  g.Snake.score = 70;
  g.run(40);
  assert.equal(g.saved.get('snake.best'), '70');

  // It used to read the record through store('snake.best', 0), which wrote
  // that 0 back over it -- so the best column was always 0 for anyone who
  // ever played a second game.
  g.Snake.start();
  assert.equal(g.saved.get('snake.best'), '70', 'the record was overwritten');
  assert.equal(g.Snake.best, 70);
});

test('q ends a live field once, and says the score once', () => {
  const g = load();
  g.Snake.start();
  g.Snake.score = 20;
  g.press('q');
  assert.equal(g.live(), 0);
  assert.equal(g.Snake.on, false);
  assert.equal(g.said('(process ended'), 1);
  g.press('q');
  assert.equal(g.said('(process ended'), 1, 'q was handled twice');
});

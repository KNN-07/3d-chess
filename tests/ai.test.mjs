import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../dist/vendor/chess.js';
import { chooseMove } from '../dist/ai.js';

test('all AI levels return a legal opening move without changing the input', () => {
  const chess = new Chess();
  const initial = chess.fen();
  for (const level of [1, 2, 3]) {
    const result = chooseMove(initial, level);
    assert.ok(result.move);
    const replay = new Chess(initial);
    assert.ok(replay.move(result.move));
    assert.ok(result.nodes > 0);
    assert.ok(result.elapsedMs < 3500, `level ${level} took ${result.elapsedMs.toFixed(0)}ms`);
    assert.equal(chess.fen(), initial);
  }
});

test('AI recognizes mate in one', () => {
  const chess = new Chess('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
  const result = chooseMove(chess.fen(), 2);
  chess.move(result.move);
  assert.equal(chess.isCheckmate(), true);
});

test('AI returns no move after mate or stalemate', () => {
  for (const fen of [
    '7k/6Q1/5K2/8/8/8/8/8 b - - 0 1',
    '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
  ]) assert.equal(chooseMove(fen, 2).move, null);
});

test('AI escapes check with a legal move', () => {
  const chess = new Chess('4r2k/8/8/8/8/8/8/4K3 w - - 0 1');
  const result = chooseMove(chess.fen(), 2);
  assert.ok(chess.move(result.move));
  assert.equal(chess.isCheck(), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../dist/vendor/chess.js';

test('starting position has exactly 20 legal moves', () => {
  const chess = new Chess();
  assert.equal(chess.moves().length, 20);
  assert.equal(chess.turn(), 'w');
});

test('castling moves both pieces and cannot cross an attacked square', () => {
  const chess = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.ok(chess.moves().includes('O-O'));
  assert.ok(chess.moves().includes('O-O-O'));
  chess.move('O-O');
  assert.equal(chess.get('g1').type, 'k');
  assert.equal(chess.get('f1').type, 'r');
  assert.equal(chess.get('h1'), undefined);
  const attacked = new Chess('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1');
  assert.ok(!attacked.moves().includes('O-O'));
});

test('en passant removes the bypassed pawn and is valid only immediately', () => {
  const chess = new Chess();
  for (const san of ['e4', 'a6', 'e5', 'd5']) chess.move(san);
  const before = chess.fen();
  chess.move({ from: 'e5', to: 'd6' });
  assert.equal(chess.get('d6').color, 'w');
  assert.equal(chess.get('d5'), undefined);
  chess.undo();
  assert.equal(chess.fen(), before);
  chess.move('Nf3');
  chess.move('a5');
  assert.ok(!chess.moves({ square: 'e5' }).includes('exd6'));
});

test('promotion offers all four choices including underpromotion', () => {
  const chess = new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1');
  const promotions = chess.moves({ verbose: true }).filter(move => move.from === 'a7');
  assert.deepEqual(promotions.map(move => move.promotion).sort(), ['b', 'n', 'q', 'r']);
  chess.move({ from: 'a7', to: 'a8', promotion: 'n' });
  assert.equal(chess.get('a8').type, 'n');
});

test('a pinned piece cannot expose its own king', () => {
  const chess = new Chess('4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1');
  const moves = chess.moves({ square: 'e2', verbose: true });
  assert.ok(moves.length > 0);
  assert.ok(moves.every(move => move.to.startsWith('e')));
  assert.throws(() => chess.move({ from: 'e2', to: 'd2' }));
});

test('Fools mate ends the game with the white king checkmated', () => {
  const chess = new Chess();
  for (const san of ['f3', 'e5', 'g4', 'Qh4#']) chess.move(san);
  assert.equal(chess.isCheckmate(), true);
  assert.equal(chess.isGameOver(), true);
  assert.equal(chess.turn(), 'w');
  assert.equal(chess.moves().length, 0);
});

test('stalemate is a draw with no check', () => {
  const chess = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(chess.isCheck(), false);
  assert.equal(chess.isStalemate(), true);
  assert.equal(chess.isDraw(), true);
});

test('undo restores position, turn, move counters and castling rights', () => {
  const chess = new Chess();
  const initial = chess.fen();
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']) chess.move(san);
  for (let index = 0; index < 7; index++) assert.ok(chess.undo());
  assert.equal(chess.fen(), initial);
  assert.deepEqual(chess.history(), []);
});

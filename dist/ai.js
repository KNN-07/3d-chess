import { Chess } from './vendor/chess.js';

const VALUES = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
const MATE = 100000;
const LIMITS = {
  1: { milliseconds: 140, depth: 1, quiescence: 0 },
  2: { milliseconds: 720, depth: 5, quiescence: 3 },
  3: { milliseconds: 1700, depth: 6, quiescence: 4 },
};

function moveKey(move) {
  return move.from + move.to + (move.promotion || '');
}

function compact(move) {
  return { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) };
}

function order(moves, preferred) {
  return moves.map(move => ({ move, priority:
    (moveKey(move) === preferred ? 100000 : 0) +
    (move.captured ? 10 * VALUES[move.captured] - VALUES[move.piece] : 0) +
    (move.promotion ? VALUES[move.promotion] + 800 : 0) +
    (move.san.includes('#') ? 50000 : move.san.includes('+') ? 45 : 0)
  })).sort((a, b) => b.priority - a.priority).map(item => item.move);
}

// A compact material/activity evaluation, always from the player to move.
function evaluate(chess) {
  const board = chess.board();
  let score = 0;
  let nonPawnMaterial = 0;
  for (const row of board) for (const piece of row) {
    if (piece && piece.type !== 'p' && piece.type !== 'k') nonPawnMaterial += VALUES[piece.type];
  }
  for (let row = 0; row < 8; row++) for (let file = 0; file < 8; file++) {
    const piece = board[row][file];
    if (!piece) continue;
    const sign = piece.color === 'w' ? 1 : -1;
    const rank = piece.color === 'w' ? 7 - row : row;
    const centrality = 7 - Math.abs(file - 3.5) - Math.abs(row - 3.5);
    let value = VALUES[piece.type];
    if (piece.type === 'p') value += rank * 7 + centrality * 3 + (rank === 6 ? 28 : 0);
    if (piece.type === 'n') value += centrality * 10 - (rank === 0 ? 12 : 0);
    if (piece.type === 'b') value += centrality * 6 + Math.min(rank, 3) * 3;
    if (piece.type === 'r') value += rank === 6 ? 20 : 0;
    if (piece.type === 'q') value += centrality * 2;
    if (piece.type === 'k') {
      if (nonPawnMaterial < 1800) value += centrality * 10;
      else {
        value -= centrality * 7 + rank * 7;
        if (rank === 0 && (file === 2 || file === 6)) value += 22;
        const shieldRow = row + (piece.color === 'w' ? -1 : 1);
        if (shieldRow >= 0 && shieldRow < 8) for (let shieldFile = Math.max(0, file - 1); shieldFile <= Math.min(7, file + 1); shieldFile++) {
          const shield = board[shieldRow][shieldFile];
          if (shield?.type === 'p' && shield.color === piece.color) value += 10;
        }
      }
    }
    score += sign * value;
  }
  return chess.turn() === 'w' ? score : -score;
}

function drawn(chess) {
  return chess.isInsufficientMaterial() || chess.isDrawByFiftyMoves() || chess.isThreefoldRepetition();
}

/**
 * Search a fresh position without mutating the caller's game. The returned move
 * is a legal {from, to, promotion?}, or null when no move should be played.
 * A worker keeps all search work off the interface thread.
 */
export function chooseMove(fen, level = 2) {
  const started = performance.now();
  const settings = LIMITS[level] || LIMITS[2];
  const deadline = started + settings.milliseconds;
  const chess = new Chess(fen);
  const initialMoves = chess.moves({ verbose: true });
  let nodes = 0;
  let completedDepth = 0;
  const timeout = Symbol('search deadline');
  if (initialMoves.length === 0 || drawn(chess)) {
    return { move: null, nodes, depth: 0, score: initialMoves.length === 0 && chess.isCheck() ? -MATE : 0, elapsedMs: performance.now() - started };
  }
  let bestMove = order(initialMoves)[0];
  let bestScore = evaluate(chess);
  let preferred = moveKey(bestMove);

  function visit() {
    nodes++;
    if ((nodes & 15) === 0 && performance.now() >= deadline) throw timeout;
  }

  function quiet(alpha, beta, remaining, ply, suppliedMoves) {
    visit();
    const moves = suppliedMoves || chess.moves({ verbose: true });
    const check = chess.isCheck();
    if (moves.length === 0) return check ? -MATE + ply : 0;
    if (drawn(chess)) return 0;
    const stand = evaluate(chess);
    // At the hard horizon use static evaluation, but never call a check mate.
    if (remaining <= 0) return stand;
    if (!check) {
      if (stand >= beta) return stand;
      alpha = Math.max(alpha, stand);
    }
    const candidates = check ? moves : moves.filter(move => move.captured || move.promotion);
    for (const move of order(candidates)) {
      chess.move(compact(move));
      let score;
      try { score = -quiet(-beta, -alpha, remaining - 1, ply + 1); }
      finally { chess.undo(); }
      if (score >= beta) return score;
      alpha = Math.max(alpha, score);
    }
    return alpha;
  }

  function search(depth, alpha, beta, ply) {
    visit();
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return chess.isCheck() ? -MATE + ply : 0;
    if (drawn(chess)) return 0;
    if (depth === 0) return quiet(alpha, beta, settings.quiescence, ply, moves);
    let best = -Infinity;
    for (const move of order(moves)) {
      chess.move(compact(move));
      let score;
      try { score = -search(depth - 1, -beta, -alpha, ply + 1); }
      finally { chess.undo(); }
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return best;
  }

  for (let depth = 1; depth <= settings.depth; depth++) {
    let iterationBest = bestMove;
    let iterationScore = -Infinity;
    let alpha = -Infinity;
    try {
      for (const move of order(initialMoves, preferred)) {
        if (performance.now() >= deadline) throw timeout;
        chess.move(compact(move));
        let score;
        try { score = -search(depth - 1, -Infinity, -alpha, 1); }
        finally { chess.undo(); }
        if (score > iterationScore) { iterationScore = score; iterationBest = move; }
        alpha = Math.max(alpha, score);
        // A legal immediate mate needs no further comparison or iteration.
        if (score === MATE - 1) break;
      }
      bestMove = iterationBest;
      bestScore = iterationScore;
      preferred = moveKey(bestMove);
      completedDepth = depth;
      if (bestScore >= MATE - 100) break;
    } catch (error) {
      if (error !== timeout) throw error;
      // Use a partial first iteration rather than losing its useful work.
      if (completedDepth === 0 && iterationScore > -Infinity) {
        bestMove = iterationBest;
        bestScore = iterationScore;
      }
      break;
    }
  }
  return { move: compact(bestMove), nodes, depth: completedDepth, score: bestScore, elapsedMs: performance.now() - started };
}

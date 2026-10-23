const INIT_TIMEOUT_MS = 20_000;
const SEARCH_GRACE_MS = 10_000;
const DEFAULT_MOVETIME_MS = 1_000;
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export class StockfishError extends Error {
  constructor(message, code = 'ENGINE_ERROR') {
    super(message);
    this.name = code.endsWith('_TIMEOUT') ? 'TimeoutError' : 'StockfishError';
    this.code = code;
  }
}

function abortError() {
  const error = new Error('Stockfish search was cancelled.');
  error.name = 'AbortError';
  return error;
}

function fenText(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\u0000]/.test(value)) {
    throw new TypeError(`${label} must be a non-empty FEN on a single line.`);
  }
  return value.trim();
}

function positionCommand({fen, startFen, moves}) {
  const current = fenText(fen, 'fen');
  if (moves !== undefined && (!Array.isArray(moves) || moves.some(move => typeof move !== 'string' || !UCI_MOVE.test(move)))) {
    throw new TypeError('moves must be an array of UCI moves such as e2e4 or e7e8q.');
  }
  let position;
  if (startFen !== undefined) position = `position fen ${fenText(startFen, 'startFen')}`;
  else if (moves !== undefined) position = 'position startpos';
  else position = `position fen ${current}`;
  if (moves?.length) position += ` moves ${moves.join(' ')}`;
  return position;
}

/** A fresh classic Web Worker is used for every search and terminated afterward. */
export class StockfishClient {
  constructor({workerFactory = () => new Worker('./vendor/stockfish/stockfish-19-lite-single.js')} = {}) {
    if (typeof workerFactory !== 'function') throw new TypeError('workerFactory must be a function.');
    this.workerFactory = workerFactory;
    this.pending = null;
    this.disposed = false;
  }

  async search({fen, startFen, moves, elo, movetime = DEFAULT_MOVETIME_MS} = {}) {
    if (this.disposed) throw new StockfishError('This Stockfish client has been disposed.', 'CLIENT_DISPOSED');
    this.cancel();
    if (elo !== null && !Number.isSafeInteger(elo)) throw new TypeError('elo must be an integer, or null for full strength.');
    if (!Number.isSafeInteger(movetime) || movetime <= 0 || movetime > 2_147_483_647 - SEARCH_GRACE_MS) {
      throw new TypeError('movetime must be a positive whole number of milliseconds.');
    }
    const position = positionCommand({fen, startFen, moves});
    return new Promise((resolve, reject) => {
      const request = {resolve, reject, elo, movetime, position, engineName:'Stockfish', eloRange:null, phase:'uci', settled:false, worker:null, timer:null};
      this.pending = request;
      try {
        request.worker = this.workerFactory();
        if (!request.worker || typeof request.worker.postMessage !== 'function' || typeof request.worker.terminate !== 'function') {
          throw new TypeError('workerFactory must return a Web Worker.');
        }
        request.worker.onmessage = event => {
          if (!this._active(request) || typeof event.data !== 'string') return;
          for (const line of event.data.split(/\r?\n/)) {
            if (!this._active(request)) break;
            this._line(request, line.trim());
          }
        };
        request.worker.onerror = event => {
          event.preventDefault?.();
          this._finish(request, new StockfishError(`Stockfish worker failed${event.message ? `: ${event.message}` : '.'}`, 'WORKER_ERROR'));
        };
        request.worker.onmessageerror = () => this._finish(request, new StockfishError('Stockfish returned an unreadable worker message.', 'WORKER_MESSAGE_ERROR'));
        request.timer = setTimeout(() => this._finish(request, new StockfishError('Stockfish did not initialize within 20 seconds.', 'ENGINE_INIT_TIMEOUT')), INIT_TIMEOUT_MS);
        this._send(request, 'uci');
      } catch (error) {
        this._finish(request, new StockfishError(`Could not start Stockfish. ${error.message || error}`, 'WORKER_START_ERROR'));
      }
    });
  }

  _active(request) { return this.pending === request && !request.settled; }

  _send(request, command) {
    if (!this._active(request)) return;
    try { request.worker.postMessage(command); }
    catch (error) { this._finish(request, new StockfishError(`Could not communicate with Stockfish. ${error.message || error}`, 'WORKER_ERROR')); }
  }

  _line(request, line) {
    if (!line) return;
    if (request.phase === 'uci') {
      const name = /^id name\s+(.+)$/i.exec(line);
      if (name) request.engineName = name[1];
      const option = /^option name UCI_Elo type spin(?:\s|$)(.*)$/i.exec(line);
      if (option) {
        const minimum = /(?:^|\s)min\s+(-?\d+)(?=\s|$)/i.exec(option[1]);
        const maximum = /(?:^|\s)max\s+(-?\d+)(?=\s|$)/i.exec(option[1]);
        const min = minimum ? Number(minimum[1]) : NaN, max = maximum ? Number(maximum[1]) : NaN;
        if (Number.isSafeInteger(min) && Number.isSafeInteger(max) && min <= max) request.eloRange = {min, max};
      }
      if (line !== 'uciok') return;
      if (request.elo !== null) {
        if (!request.eloRange) {
          this._finish(request, new StockfishError('This Stockfish build does not advertise a supported UCI_Elo range.', 'ELO_UNSUPPORTED'));
          return;
        }
        const {min, max} = request.eloRange;
        if (request.elo < min || request.elo > max) {
          const error = new StockfishError(`This Stockfish build supports Elo ${min}–${max}; ${request.elo} is outside that range.`, 'ELO_OUT_OF_RANGE');
          error.eloRange = {...request.eloRange};
          this._finish(request, error);
          return;
        }
      }
      request.phase = 'ready';
      this._send(request, 'setoption name Hash value 16');
      this._send(request, `setoption name UCI_LimitStrength value ${request.elo !== null}`);
      if (request.elo !== null) this._send(request, `setoption name UCI_Elo value ${request.elo}`);
      this._send(request, 'isready');
      return;
    }
    if (request.phase === 'ready' && line === 'readyok') {
      clearTimeout(request.timer);
      request.phase = 'search';
      request.timer = setTimeout(() => this._finish(request, new StockfishError('Stockfish did not return a move in time. Please try again.', 'ENGINE_SEARCH_TIMEOUT')), request.movetime + SEARCH_GRACE_MS);
      this._send(request, request.position);
      this._send(request, `go movetime ${request.movetime}`);
      return;
    }
    if (request.phase !== 'search' || !/^bestmove(?:\s|$)/.test(line)) return;
    const value = /^bestmove\s+(\S+)(?:\s+ponder\s+\S+)?\s*$/.exec(line)?.[1];
    if (!value || !UCI_MOVE.test(value) || value.slice(0,2) === value.slice(2,4)) {
      this._finish(request, new StockfishError(`Stockfish did not return a usable move${value ? ` (${value})` : ''}.`, 'INVALID_BESTMOVE'));
      return;
    }
    const move = {from:value.slice(0,2), to:value.slice(2,4)};
    if (value[4]) move.promotion = value[4];
    const result = {move, engineName:request.engineName};
    if (request.eloRange) result.eloRange = {...request.eloRange};
    this._finish(request, null, result);
  }

  _finish(request, error, result) {
    if (!this._active(request)) return;
    request.settled = true;
    clearTimeout(request.timer);
    this.pending = null;
    if (request.worker) {
      request.worker.onmessage = request.worker.onerror = request.worker.onmessageerror = null;
      try { request.worker.terminate?.(); } catch { /* Preserve the original outcome if worker cleanup fails. */ }
    }
    if (error) request.reject(error); else request.resolve(result);
  }

  cancel() { if (this.pending) this._finish(this.pending, abortError()); }
  dispose() { this.cancel(); this.disposed = true; }
}

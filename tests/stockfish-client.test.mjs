import test from 'node:test';
import assert from 'node:assert/strict';
import {StockfishClient} from '../dist/stockfish-client.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
class Worker {
  constructor() { this.commands = []; this.terminations = 0; }
  postMessage(command) { this.commands.push(command); }
  terminate() { this.terminations++; }
  receive(data) { this.onmessage?.({data}); }
}
function harness(t) {
  const workers = [];
  const client = new StockfishClient({workerFactory: () => {const worker = new Worker();workers.push(worker);return worker;}});
  t.after(() => client.dispose());
  return {client, workers};
}
function handshake(worker, min = 1320, max = 3190) {
  worker.receive(`id name Stockfish Test\noption name Hash type spin default 16 min 1 max 33554432\noption name UCI_LimitStrength type check default false\noption name UCI_Elo type spin default 1320 min ${min} max ${max}\nuciok`);
}
function ready(worker) { handshake(worker); worker.receive('readyok'); }

test('waits for both UCI handshakes before sending options or search commands', async t => {
  const {client, workers} = harness(t);
  const pending = client.search({fen:AFTER_E4, moves:['e2e4'], elo:1600, movetime:900});
  const worker = workers[0];
  assert.deepEqual(worker.commands, ['uci']);
  worker.receive('info string initializing');worker.receive('readyok');
  assert.deepEqual(worker.commands, ['uci']);
  handshake(worker);
  assert.deepEqual(worker.commands, ['uci','setoption name Hash value 16','setoption name UCI_LimitStrength value true','setoption name UCI_Elo value 1600','isready']);
  worker.receive('uciok');
  assert.equal(worker.commands.length, 5, 'duplicate handshake replies are ignored');
  worker.receive('readyok');
  assert.deepEqual(worker.commands.slice(-2), ['position startpos moves e2e4','go movetime 900']);
  worker.receive('info depth 16 score cp 12 nodes 28000');
  worker.receive('bestmove e7e5 ponder g1f3');
  assert.deepEqual(await pending, {move:{from:'e7',to:'e5'},engineName:'Stockfish Test',eloRange:{min:1320,max:3190}});
  assert.equal(worker.terminations, 1);assert.equal(client.pending, null);
});

test('full-strength search disables limiting and uses a complete FEN without history', async t => {
  const {client, workers} = harness(t);
  const pending = client.search({fen:START, elo:null});
  const worker = workers[0];ready(worker);
  assert.ok(worker.commands.includes('setoption name UCI_LimitStrength value false'));
  assert.ok(!worker.commands.some(command => command.startsWith('setoption name UCI_Elo')));
  assert.deepEqual(worker.commands.slice(-2), [`position fen ${START}`,'go movetime 1000']);
  worker.receive('bestmove e2e4');await pending;
});

test('history can start from a custom FEN and promotion moves are preserved', async t => {
  const {client, workers} = harness(t);
  const pending = client.search({fen:START,startFen:AFTER_E4,moves:['a7a6'],elo:3190});
  const worker = workers[0];ready(worker);
  assert.equal(worker.commands.at(-2), `position fen ${AFTER_E4} moves a7a6`);
  worker.receive('bestmove e7e8n');
  assert.deepEqual((await pending).move,{from:'e7',to:'e8',promotion:'n'});
});

test('rejects out-of-range Elo without silently clamping or starting a search', async t => {
  const {client, workers} = harness(t);
  for (const elo of [1319,3191]) {
    const pending = client.search({fen:START,elo});
    const worker = workers.at(-1);handshake(worker);
    await assert.rejects(pending, error => error.code === 'ELO_OUT_OF_RANGE' && error.eloRange.min === 1320 && error.eloRange.max === 3190);
    assert.deepEqual(worker.commands,['uci']);assert.equal(worker.terminations,1);
  }
});

test('limited searches require an advertised range, while full strength does not', async t => {
  const {client, workers} = harness(t);
  const limited = client.search({fen:START,elo:1800});workers[0].receive('uciok');
  await assert.rejects(limited,{code:'ELO_UNSUPPORTED'});
  const full = client.search({fen:START,elo:null});
  workers[1].receive('id name Stockfish\nuciok\nreadyok\nbestmove g1f3');
  assert.deepEqual(await full,{move:{from:'g1',to:'f3'},engineName:'Stockfish'});
});

test('cancel mid-initialization rejects with AbortError and ignores stale worker messages', async t => {
  const {client, workers} = harness(t);
  const first = client.search({fen:START,elo:1600});
  const oldMessage = workers[0].onmessage;
  client.cancel();
  await assert.rejects(first,{name:'AbortError'});
  assert.equal(workers[0].terminations,1);
  const second = client.search({fen:START,elo:1700});
  oldMessage({data:'uciok\nreadyok\nbestmove a2a4'});
  assert.deepEqual(workers[1].commands,['uci']);
  ready(workers[1]);workers[1].receive('bestmove d2d4');
  assert.deepEqual((await second).move,{from:'d2',to:'d4'});
});

test('starting a new search terminates an active search rather than reusing its results', async t => {
  const {client, workers} = harness(t);
  const first = client.search({fen:START,elo:1600});ready(workers[0]);
  const firstOutcome = first.catch(error => error);
  const second = client.search({fen:AFTER_E4,elo:1800});
  assert.equal((await firstOutcome).name,'AbortError');
  assert.equal(workers[0].terminations,1);
  ready(workers[1]);workers[1].receive('bestmove c7c5');await second;
  assert.equal(workers[1].terminations,1);
});

test('invalid or absent bestmove tokens reject and clean up the worker', async t => {
  const {client, workers} = harness(t);
  for (const reply of ['bestmove (none)','bestmove 0000','bestmove','bestmove e2e9','bestmove a1a1','bestmove e7e8x']) {
    const pending = client.search({fen:START,elo:null});const worker=workers.at(-1);ready(worker);worker.receive(reply);
    await assert.rejects(pending,{code:'INVALID_BESTMOVE'});assert.equal(worker.terminations,1);
  }
});

test('fatal worker and transport errors reject and permit a clean restart', async t => {
  const {client, workers} = harness(t);
  const failed = client.search({fen:START,elo:null});
  workers[0].onerror({message:'WASM failed to initialize',preventDefault(){}});
  await assert.rejects(failed,{code:'WORKER_ERROR'});assert.equal(workers[0].terminations,1);
  const unreadable = client.search({fen:START,elo:null});workers[1].onmessageerror();
  await assert.rejects(unreadable,{code:'WORKER_MESSAGE_ERROR'});
  const success = client.search({fen:START,elo:null});ready(workers[2]);workers[2].receive('bestmove b1c3');await success;
});

test('initialization timeout includes waiting for readyok', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const {client, workers} = harness(t);
  const pending = client.search({fen:START,elo:1600});handshake(workers[0]);
  t.mock.timers.tick(20_001);
  await assert.rejects(pending,{name:'TimeoutError',code:'ENGINE_INIT_TIMEOUT'});
  assert.equal(workers[0].terminations,1);
});

test('search timeout uses movetime plus the ten-second grace period', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const {client, workers} = harness(t);
  const pending = client.search({fen:START,elo:1600,movetime:500});ready(workers[0]);
  t.mock.timers.tick(10_499);assert.equal(workers[0].terminations,0);
  t.mock.timers.tick(2);await assert.rejects(pending,{code:'ENGINE_SEARCH_TIMEOUT'});
  assert.equal(workers[0].terminations,1);
});

test('validates commands before creating a worker and rejects malformed Elo values', async t => {
  const {client, workers} = harness(t);
  for (const bad of [{elo:1600.5},{elo:NaN},{elo:undefined},{movetime:0},{moves:['e2e4\ngo infinite']},{fen:'fen\nquit'},{startFen:'/\nquit'}]) {
    await assert.rejects(client.search({fen:START,elo:1600,...bad}),TypeError);
  }
  assert.equal(workers.length,0);
});

test('worker startup/postMessage failures are cleaned up and dispose is final', async () => {
  const startup = new StockfishClient({workerFactory:()=>{throw new Error('Blocked worker');}});
  await assert.rejects(startup.search({fen:START,elo:null}),{code:'WORKER_START_ERROR'});
  assert.equal(startup.pending,null);
  const worker=new Worker();worker.postMessage=()=>{throw new Error('Worker closed');};
  const transport=new StockfishClient({workerFactory:()=>worker});
  await assert.rejects(transport.search({fen:START,elo:null}),{code:'WORKER_ERROR'});
  assert.equal(worker.terminations,1);
  transport.dispose();transport.dispose();
  await assert.rejects(transport.search({fen:START,elo:null}),{code:'CLIENT_DISPOSED'});
});

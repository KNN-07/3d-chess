import { Chess } from './vendor/chess.js';
import { ChessScene } from './scene.js';
import { Companion } from './companion.js';

const $=id=>document.getElementById(id);
const game=new Chess();
const companion=new Companion();
const STORAGE='wooden-table-chess-v1';
const names={p:'Pawn',n:'Knight',b:'Bishop',r:'Rook',q:'Queen',k:'King'};
let mode='ai',level=2,selected=null,thinking=false,hinting=false,moving=false,visualGeneration=0,pendingPromotion=null,worker=null,job=0,sound=false,topView=false,engineFailed=false,nextMode=null,scene=null,audio=null;
let toastTimer;
try{const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');if(saved){if(saved.pgn)game.loadPgn(saved.pgn);mode=saved.mode==='local'?'local':'ai';level=[1,2,3].includes(saved.level)?saved.level:2;sound=!!saved.sound;}}catch{game.reset();}

function save(){game.setHeader('Event','Casual game');game.setHeader('Site','The Wooden Table');game.setHeader('White','White');game.setHeader('Black',mode==='ai'?'Jimmy':'Black');game.setHeader('Result',game.isCheckmate()?(game.turn()==='w'?'0-1':'1-0'):game.isDraw()?'1/2-1/2':'*');try{localStorage.setItem(STORAGE,JSON.stringify({pgn:game.pgn(),mode,level,sound}));}catch{/* Private browsing may not permit storage. */}}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3800);}
function playSound(capture=false){if(!sound)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();audio.resume();const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.connect(gain);gain.connect(audio.destination);oscillator.type='sine';oscillator.frequency.setValueAtTime(capture?320:520,audio.currentTime);oscillator.frequency.exponentialRampToValueAtTime(160,audio.currentTime+.075);gain.gain.setValueAtTime(.12,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.13);oscillator.start();oscillator.stop(audio.currentTime+.14);}catch{}}
function humanTurn(){return !thinking&&!moving&&!game.isGameOver()&&(mode==='local'||game.turn()==='w');}
function cancelJob(){job++;worker?.terminate();worker=null;thinking=false;hinting=false;}
function cancelVisual(){visualGeneration++;moving=false;scene?.cancelMove?.();}
function endMessage(){if(game.isCheckmate())return `Checkmate · ${game.turn()==='w'?'Black':'White'} wins`;if(game.isStalemate())return 'Draw · Stalemate';if(game.isThreefoldRepetition())return 'Draw · Threefold repetition';if(game.isInsufficientMaterial())return 'Draw · Insufficient material';if(game.isDrawByFiftyMoves())return 'Draw · Fifty-move rule';if(game.isDraw())return 'Draw';return null;}
function highlight(){if(!scene)return;const history=game.history({verbose:true});const previous=history.at(-1);const legal=selected?game.moves({square:selected,verbose:true}).map(m=>m.to):[];let check=null;if(game.isCheck())check=game.board().flat().find(p=>p?.type==='k'&&p.color===game.turn())?.square;scene.setHighlights({selected,legal,lastMove:previous?{from:previous.from,to:previous.to}:null,check});}
function render(positionChanged=false){
  if(positionChanged)scene?.setPosition(game.board());
  highlight();
  const history=game.history({verbose:true}),last=history.at(-1),end=endMessage(),turn=game.turn()==='w'?'White':'Black';
  const moveNumber=Math.floor(history.length/2)+1;
  $('last-move').textContent=last?.san||'♙';
  $('turn-status').textContent=end||`${moveNumber}. ${turn} to move${game.isCheck()?' · Check':''}`;
  $('speech-text').textContent=moving?'Making a move':end?(game.isCheckmate()?'Good game!':'A well-played draw'):thinking?'Thinking':hinting?'Let me think…':game.isCheck()?'King in check!':selected?`${names[game.get(selected)?.type]||'Piece'} to move`:mode==='local'?`${turn} to move`:'Your move';
  $('mood').textContent=thinking||hinting?'✧':end?'✦':game.isCheck()?'!':'✦';
  $('speech').classList.toggle('thinking',thinking||hinting);
  companion.react(end?'end':game.isCheck()?'check':moving?'move':thinking||hinting?'thinking':'idle');
  $('opponent-name').textContent=mode==='ai'?'Jimmy':'Two players';
  $('opponent-level').textContent=mode==='ai'?`(${['','Casual','Club','Advanced'][level]})`:'(Local)';
  $('player-info').textContent=mode==='ai'?'You play as White':'Pass-and-play on this device';
  $('difficulty').value=String(level);$('difficulty').disabled=mode==='local';
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',b.dataset.mode===mode);});
  $('undo-button').disabled=!history.length||!!pendingPromotion;
  $('export-button').disabled=!history.length;
  $('hint-button').disabled=(!humanTurn()&&!engineFailed)||hinting||!!pendingPromotion;
  $('hint-button').setAttribute('aria-label',engineFailed?'Retry computer move':'Show hint');
  $('hint-button').title=engineFailed?'Retry computer move':'Show hint';
  $('move-input').disabled=!humanTurn()||!!pendingPromotion;
  $('move-form').querySelector('button').disabled=!humanTurn()||!!pendingPromotion;
  $('sound-button').setAttribute('aria-pressed',sound);$('sound-button').setAttribute('aria-label',sound?'Mute sound':'Enable sound');$('sound-button').title=sound?'Mute sound':'Enable sound';
  const moveHistory=$('move-history');moveHistory.replaceChildren();
  if(!history.length){const empty=document.createElement('p');empty.className='empty-history';empty.textContent='A fresh board. A world of possibilities.';moveHistory.append(empty);}
  for(let i=0;i<history.length;i+=2){const row=document.createElement('div');row.className='move-row';[`${i/2+1}.`,history[i].san,history[i+1]?.san||'—'].forEach((text,index)=>{const span=document.createElement('span');span.textContent=text;if(index===1&&i===history.length-1||index===2&&i+1===history.length-1)span.className='latest';row.append(span);});moveHistory.append(row);}
  moveHistory.scrollTop=moveHistory.scrollHeight;
}
function execute(move){
  if(moving)return false;
  let result;try{result=game.move(move);}catch{return false;}
  if(!result)return false;
  cancelJob();engineFailed=false;selected=null;pendingPromotion=null;$('move-feedback').textContent='';
  const generation=++visualGeneration,afterBoard=game.board();moving=true;render();save();
  Promise.resolve().then(()=>{
    if(generation!==visualGeneration)return;
    if(scene?.animateMove)return scene.animateMove(result,afterBoard);
    scene?.setPosition(afterBoard);
  }).catch(error=>{console.error('Move animation failed:',error);}).finally(()=>{
    if(generation!==visualGeneration)return;
    moving=false;render(true);playSound(!!result.captured);
    if(game.isGameOver())toast(endMessage());else scheduleComputer();
  });
  return true;
}
function askPromotion(from,to){pendingPromotion={from,to};$('promotion-dialog').showModal();render();}
function selectSquare(square){
  if(!humanTurn()||pendingPromotion)return;
  if(selected===square){selected=null;highlight();render();return;}
  if(selected){const candidate=game.moves({square:selected,verbose:true}).filter(m=>m.to===square);if(candidate.length){if(candidate.some(m=>m.promotion)){askPromotion(selected,square);return;}execute({from:selected,to:square});return;}}
  const piece=game.get(square);selected=piece?.color===game.turn()?square:null;render();
}
function requestEngine(kind){
  cancelJob();engineFailed=false;const id=job;const fen=game.fen();thinking=kind==='move';hinting=kind==='hint';render();
  const fail=()=>{if(id!==job)return;cancelJob();engineFailed=kind==='move';render();toast(kind==='move'?'Computer interrupted. Tap the lightbulb to retry.':'Hint unavailable. You can try again.');};
  try{worker=new Worker('./engine-worker.js',{type:'module'});worker.onmessage=({data})=>{if(data.id!==job||fen!==game.fen())return;if(data.error||!data.move){fail();return;}const legal=game.moves({verbose:true}).find(m=>m.from===data.move.from&&m.to===data.move.to&&(!data.move.promotion||m.promotion===data.move.promotion));if(!legal){fail();return;}cancelJob();if(kind==='move'){execute(data.move);}else{selected=legal.from;render();scene?.setHighlights({selected:legal.from,legal:[legal.to],lastMove:null,check:null});toast(`Try ${legal.san} · ${legal.from} → ${legal.to}`);}};worker.onerror=fail;worker.postMessage({id,fen,level:kind==='hint'?3:level});}catch{fail();}
}
function scheduleComputer(){if(!moving&&mode==='ai'&&game.turn()==='b'&&!game.isGameOver())requestEngine('move');}
function newGame(requestedMode=mode){nextMode=requestedMode;if(game.history().length){$('new-game-dialog').returnValue='';$('new-game-dialog').showModal();}else startGame();}
function startGame(){cancelJob();cancelVisual();engineFailed=false;pendingPromotion=null;selected=null;game.reset();mode=nextMode||mode;nextMode=null;scene?.resetView();topView=false;$('view-button').setAttribute('aria-pressed','false');$('view-button').setAttribute('aria-label','Switch to top view');$('view-button').title='Top view';render(true);save();setMenu(false);toast(mode==='local'?'Two-player game · White starts':'You are White · Your move');}
function setMenu(open){$('menu').hidden=!open;$('menu-shade').hidden=!open;$('menu-button').setAttribute('aria-expanded',open);if(open)$('close-menu').focus();else $('menu-button').focus();}

$('menu-button').onclick=()=>setMenu($('menu').hidden);$('close-menu').onclick=()=>setMenu(false);$('menu-shade').onclick=()=>setMenu(false);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('menu').hidden)setMenu(false);});
$('restart-button').onclick=()=>newGame();$('new-game-menu').onclick=()=>newGame();
$('new-game-dialog').addEventListener('close',()=>{if($('new-game-dialog').returnValue==='start')startGame();else nextMode=null;});
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{if(button.dataset.mode!==mode)newGame(button.dataset.mode);});
$('difficulty').onchange=()=>{level=Number($('difficulty').value);save();if(mode==='ai'&&game.turn()==='b'&&!game.isGameOver())scheduleComputer();else render();};
$('undo-button').onclick=()=>{cancelJob();cancelVisual();engineFailed=false;selected=null;if(mode==='ai'&&game.turn()==='w'){game.undo();game.undo();}else game.undo();render(true);save();toast('Move taken back');};
$('hint-button').onclick=()=>{if(engineFailed)scheduleComputer();else if(humanTurn())requestEngine('hint');};
$('zoom-in').onclick=()=>scene?.zoom(-1);$('zoom-out').onclick=()=>scene?.zoom(1);
$('flip-button').onclick=()=>scene?.flip();
$('view-button').onclick=()=>{topView=!topView;scene?.setView(topView?'top':'perspective');$('view-button').setAttribute('aria-pressed',topView);$('view-button').setAttribute('aria-label',topView?'Switch to perspective view':'Switch to top view');$('view-button').title=topView?'Perspective view':'Top view';};
$('sound-button').onclick=()=>{sound=!sound;save();render();playSound();};
document.querySelectorAll('[data-promote]').forEach(button=>button.onclick=()=>{const move=pendingPromotion;if(!move)return;pendingPromotion=null;$('promotion-dialog').close();execute({...move,promotion:button.dataset.promote});});
$('promotion-dialog').addEventListener('cancel',()=>{pendingPromotion=null;selected=null;render();});
$('move-form').onsubmit=event=>{event.preventDefault();if(!humanTurn())return;const value=$('move-input').value.trim();if(!value)return;const coordinate=value.toLowerCase().replace(/[\s-]/g,'');let move=value;if(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(coordinate)){move={from:coordinate.slice(0,2),to:coordinate.slice(2,4)};if(coordinate[4])move.promotion=coordinate[4];else if(game.moves({square:move.from,verbose:true}).some(m=>m.to===move.to&&m.promotion)){askPromotion(move.from,move.to);$('move-input').value='';return;}}if(execute(move)){$('move-input').value='';}else $('move-feedback').textContent='That move is not legal in this position.';};
$('export-button').onclick=()=>{save();const blob=new Blob([game.pgn()],{type:'application/x-chess-pgn'});const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='wooden-table-game.pgn';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Game exported as PGN');};

try{scene=new ChessScene($('scene'),{onSquare:selectSquare});render(true);$('loading').hidden=true;scheduleComputer();}catch(error){$('loading').hidden=true;$('scene').innerHTML='<div class="webgl-fallback"><h1>One more move…</h1><p>This 3D board needs WebGL. Enable hardware acceleration in your browser, then reload. The menu and notation controls are still available.</p></div>';render();console.error(error);}

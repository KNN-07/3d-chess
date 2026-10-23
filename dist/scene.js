import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const BOARD_Y = .18;
const FILES = 'abcdefgh';
const squarePosition = square => new THREE.Vector3(FILES.indexOf(square[0]) - 3.5, BOARD_Y, 4.5 - Number(square[1]));

// All timber, pieces, and lighting are generated locally; no remote assets.
function woodTexture(base, seed = 1, planks = false) {
  const size = planks ? 1024 : 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(size, size);
  let randomState = seed;
  const random = () => { randomState = (1664525 * randomState + 1013904223) >>> 0; return randomState / 4294967296; };
  const noiseGrid = Array.from({length:16384}, () => random() * 2 - 1);
  const noise = (x,y) => {
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
    const at=(a,b)=>noiseGrid[((b&127)*128)+(a&127)];
    const a=at(ix,iy)*(1-sx)+at(ix+1,iy)*sx;
    const b=at(ix,iy+1)*(1-sx)+at(ix+1,iy+1)*sx;
    return a*(1-sy)+b*sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bend = noise(x*.006,y*.005)*11 + Math.sin(y*.004+seed)*3;
      const fine = noise((x+bend)*1.8,y*.13);
      const fiber = noise((x+bend)*.72,y*.025);
      const broad = noise((x+bend)*.04,y*.006);
      const pores = Math.max(0,noise((x+bend)*1.05,y*.065)-.34);
      let shade = fine*4 + fiber*11 + broad*15 - pores*24 + (random()-.5)*9;
      if (planks) {
        const plank = Math.floor(x / 170.7);
        shade += Math.sin(plank * 12.73 + seed) * 7;
        const edge = x % 170.7;
        if (edge < 3 || edge > 168) shade -= 45;
        else if (edge < 6) shade += 9;
        if(Math.abs(y-(plank%2?720:355))<1.6)shade-=30;
      }
      const i = (y * size + x) * 4;
      pixels.data[i] = base[0] + shade;
      pixels.data[i + 1] = base[1] + shade * .84;
      pixels.data[i + 2] = base[2] + shade * .63;
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function lathe(profile, segments = 48) {
  return new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)), segments);
}

function pieceTemplate(type, material, trim, eyeMaterial) {
  const group = new THREE.Group();
  const add = (geometry, mat = material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x,y,z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const baseRadius = type === 'p' ? .285 : .335;
  add(lathe([[0,0],[baseRadius*.83,0],[baseRadius,.035],[baseRadius,.085],[baseRadius*.96,.12],[baseRadius*.82,.16],[baseRadius*.80,.20],[baseRadius*.74,.22],[0,.22]]));
  add(new THREE.TorusGeometry(baseRadius*.94,.016,8,48),trim,0,.10).rotation.x = Math.PI / 2;
  add(new THREE.TorusGeometry(baseRadius*.79,.013,8,48),trim,0,.195).rotation.x = Math.PI / 2;
  if (type === 'p') {
    add(lathe([[0,.18],[.205,.18],[.20,.25],[.14,.34],[.105,.49],[.12,.55],[.177,.575],[.18,.61],[.155,.645],[0,.65]]));
    add(new THREE.SphereGeometry(.187,32,24),material,0,.79);
  } else if (type === 'r') {
    add(lathe([[0,.18],[.245,.18],[.245,.25],[.18,.36],[.185,.79],[.235,.86],[.235,.90],[.315,.92],[.32,1.035],[0,1.035]]));
    add(new THREE.CylinderGeometry(.27,.27,.025,48),trim,0,1.047);
    const battlement=new THREE.Shape();
    battlement.absarc(0,0,.321,-.37,.37,false);
    battlement.absarc(0,0,.245,.37,-.37,true);battlement.closePath();
    const toothGeometry=new THREE.ExtrudeGeometry(battlement,{depth:.12,steps:1,bevelEnabled:true,bevelThickness:.008,bevelSize:.008,bevelSegments:2,curveSegments:6});
    toothGeometry.rotateX(-Math.PI/2);
    for (let i=0;i<6;i++) {
      const a = i * Math.PI / 3;
      const tooth = add(toothGeometry,material,0,1.025,0);
      tooth.rotation.y = a;
    }
  } else if (type === 'n') {
    add(lathe([[0,.19],[.25,.19],[.25,.26],[.22,.32],[.23,.37],[.25,.39],[0,.39]]));
    const shape = new THREE.Shape();
    shape.moveTo(-.22,0);
    shape.bezierCurveTo(-.29,.24,-.24,.56,-.13,.78);
    shape.lineTo(-.08,.98);shape.lineTo(.015,.83);shape.lineTo(.13,.91);shape.lineTo(.17,.72);
    shape.bezierCurveTo(.23,.65,.33,.55,.41,.43);
    shape.lineTo(.38,.32);shape.lineTo(.23,.29);shape.lineTo(.12,.39);
    shape.bezierCurveTo(.03,.31,.04,.19,.19,.05);
    shape.lineTo(.23,0);shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape,{depth:.25,bevelEnabled:true,bevelThickness:.035,bevelSize:.035,bevelSegments:3,curveSegments:12,steps:1});
    geometry.translate(0,0,-.125);
    add(geometry,material,0,.39);
    for (const side of [-1,1]) add(new THREE.SphereGeometry(.026,12,10),eyeMaterial,.14,1.045,side*.162);
  } else {
    const queen = type === 'q', king = type === 'k';
    const stemTop = king ? 1.12 : queen ? 1.04 : .88;
    add(lathe([[0,.18],[.25,.18],[.26,.25],[.22,.30],[.155,.43],[.115,stemTop-.23],[.14,stemTop-.13],[.23,stemTop-.105],[.245,stemTop-.07],[.235,stemTop-.025],[.16,stemTop],[0,stemTop]]));
    add(new THREE.TorusGeometry(.232,.012,8,48),trim,0,stemTop-.055).rotation.x=Math.PI/2;
    if (type === 'b') {
      // A narrow recessed dark diagonal seam gives the bishop its mitre.
      const mitre=add(lathe([[0,0],[.12,.015],[.19,.10],[.205,.18],[.165,.29],[.09,.38],[0,.43]]),material,0,.88);
      const slot=add(new THREE.BoxGeometry(.025,.29,.025),eyeMaterial,.045,1.12,.166);
      slot.rotation.z=-.48;
      add(new THREE.SphereGeometry(.052,20,16),material,0,1.33);
    } else if (queen) {
      add(lathe([[0,0],[.14,0],[.16,.10],[.275,.24],[.28,.28],[.23,.27],[.18,.16],[0,.13]]),material,0,1.04);
      for(let i=0;i<8;i++) {
        const a=i*Math.PI/4;
        const tip=add(new THREE.ConeGeometry(.047,.16,16),material,Math.sin(a)*.253,1.35,Math.cos(a)*.253);
        tip.rotation.z=-Math.sin(a)*.22;tip.rotation.x=Math.cos(a)*.22;
        add(new THREE.SphereGeometry(.041,16,12),material,Math.sin(a)*.268,1.427,Math.cos(a)*.268);
      }
      add(new THREE.SphereGeometry(.13,28,20),material,0,1.32);
      add(new THREE.SphereGeometry(.045,16,12),trim,0,1.463);
    } else if (king) {
      add(lathe([[0,0],[.15,0],[.18,.07],[.16,.14],[.085,.20],[0,.20]]),material,0,1.12);
      add(new THREE.BoxGeometry(.075,.32,.075),material,0,1.48);
      add(new THREE.BoxGeometry(.235,.075,.075),material,0,1.525);
    }
  }
  return group;
}

export class ChessScene {
  constructor(container, {onSquare} = {}) {
    this.container=container;
    this.onSquare=onSquare;
    this.disposed=false;
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color('#30231c');
    this.camera=new THREE.PerspectiveCamera(36,1,.1,100);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=.97;
    this.canvas=this.renderer.domElement;
    this.canvas.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline:none';
    this.canvas.setAttribute('aria-label','Interactive 3D chessboard. Select a piece and its destination. Drag to rotate, scroll to zoom.');
    this.canvas.tabIndex=0;
    container.append(this.canvas);
    this.controls=new OrbitControls(this.camera,this.canvas);
    this.controls.target.set(0,-.10,0);
    this.controls.enableDamping=true;
    this.controls.dampingFactor=.09;
    this.controls.enablePan=false;
    this.controls.minPolarAngle=.025;
    this.controls.maxPolarAngle=1.16;
    this.controls.rotateSpeed=.55;
    this.controls.zoomSpeed=.65;
    this.controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
    this.controls.addEventListener('start',()=>{this.transition=null;});
    this.raycaster=new THREE.Raycaster();
    this.pointer=new THREE.Vector2();
    this.pieces=new THREE.Group();
    this.highlights=new THREE.Group();
    this.scene.add(this.pieces,this.highlights);
    this.squares=[];
    this.templates={};
    this.textures=[];
    this.materials=[];
    this.view='perspective';
    this.facing=0;
    this._setupLighting();
    this._buildBoard();
    this._buildTemplates();
    this._bindInput();
    this.resizeObserver=new ResizeObserver(()=>this._resize());
    this.resizeObserver.observe(container);
    this._resize(true);
    this._animate=this._animate.bind(this);
    this.frame=requestAnimationFrame(this._animate);
  }

  _material(options) { const m=new THREE.MeshStandardMaterial(options);this.materials.push(m);return m; }

  _setupLighting() {
    this.scene.add(new THREE.HemisphereLight(0xfff6e5,0x443026,.95));
    const sun=new THREE.DirectionalLight(0xfff5df,2.7);
    sun.position.set(-4,11,5);
    sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);
    Object.assign(sun.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:1,far:25});
    sun.shadow.bias=-.00022;
    sun.shadow.normalBias=.025;
    sun.shadow.radius=3;
    this.scene.add(sun);
    const fill=new THREE.DirectionalLight(0xdce4ee,.48);fill.position.set(6,6,-5);this.scene.add(fill);
    // A studio reflection map produces highlights on the black lacquer.
    const env=new THREE.Scene();env.background=new THREE.Color('#68635c');
    for(const [x,y,z,w,h,intensity] of [[-4,6,3,5,7,5],[5,4,-3,4,6,3],[0,8,-4,7,3,2]]) {
      const panel=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color().setScalar(intensity),side:THREE.DoubleSide}));
      panel.position.set(x,y,z);panel.lookAt(0,0,0);env.add(panel);
    }
    const pmrem=new THREE.PMREMGenerator(this.renderer);
    this.environment=pmrem.fromScene(env,.03);
    this.scene.environment=this.environment.texture;
    env.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});pmrem.dispose();
  }

  _buildBoard() {
    const maple=woodTexture([208,170,118],73);
    const walnut=woodTexture([77,43,23],41);
    const table=woodTexture([63,45,35],92,true);
    table.repeat.set(2.7,2.7);
    this.textures.push(maple,walnut,table);
    const tabletop=this._material({map:table,roughness:.87,bumpMap:table,bumpScale:.018});
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),tabletop);
    ground.rotation.x=-Math.PI/2;ground.position.y=-.185;ground.receiveShadow=true;this.scene.add(ground);
    // Texture density is independent of the large support plane.
    table.repeat.set(12,12);
    const edgeMat=this._material({color:0x40281a,roughness:.43});
    const rimMat=this._material({map:maple,color:0xf5d2a0,roughness:.42});
    const base=new THREE.Mesh(new THREE.BoxGeometry(8.60,.32,8.60),edgeMat);
    base.position.y=-.02;base.castShadow=true;base.receiveShadow=true;this.scene.add(base);
    const rim=new THREE.Mesh(new THREE.BoxGeometry(8.53,.08,8.53),rimMat);
    rim.position.y=.14;rim.castShadow=true;rim.receiveShadow=true;this.scene.add(rim);
    const inlayMat=this._material({color:0x251a11,roughness:.5});
    for(const sign of [-1,1]) {
      const h=new THREE.Mesh(new THREE.BoxGeometry(8.13,.012,.025),inlayMat);h.position.set(0,.185,sign*4.065);this.scene.add(h);
      const v=new THREE.Mesh(new THREE.BoxGeometry(.025,.012,8.13),inlayMat);v.position.set(sign*4.065,.185,0);this.scene.add(v);
    }
    const squareGeometry=new THREE.BoxGeometry(1,.025,1);
    const variants=[];
    for(let tone=0;tone<2;tone++) for(let i=0;i<4;i++) {
      const map=(tone?walnut:maple).clone();map.needsUpdate=true;
      map.offset.set(i*.233,i*.157);map.repeat.set(.56,.98);this.textures.push(map);
      variants.push(this._material({map,roughness:.43,bumpMap:map,bumpScale:.008}));
    }
    for(let rank=0;rank<8;rank++) for(let file=0;file<8;file++) {
      const dark=(rank+file)%2;
      const mesh=new THREE.Mesh(squareGeometry,variants[dark*4+(file+rank*3)%4]);
      mesh.position.set(file-3.5,BOARD_Y+.004,rank-3.5);
      mesh.receiveShadow=true;
      mesh.userData.square=FILES[file]+(8-rank);
      this.squares.push(mesh);this.scene.add(mesh);
    }
    for(let i=0;i<8;i++) {
      this._label(FILES[i].toUpperCase(),i-3.5,4.17,0);
      this._label(FILES[i].toUpperCase(),i-3.5,-4.17,Math.PI);
      this._label(String(8-i),-4.17,i-3.5,0);
      this._label(String(8-i),4.17,i-3.5,Math.PI);
    }
    this.dotGeometry=new THREE.CircleGeometry(.105,32);
    this.overlayGeometry=new THREE.PlaneGeometry(.98,.98);
    this.ringGeometry=new THREE.RingGeometry(.39,.435,48);
    this.selectedMaterial=new THREE.MeshBasicMaterial({color:0xc7d682,transparent:true,opacity:.38,depthWrite:false});
    this.lastMaterial=new THREE.MeshBasicMaterial({color:0xbacb7a,transparent:true,opacity:.23,depthWrite:false});
    this.checkMaterial=new THREE.MeshBasicMaterial({color:0xd6412e,transparent:true,opacity:.55,depthWrite:false});
    this.dotMaterial=new THREE.MeshBasicMaterial({color:0x1c2a14,transparent:true,opacity:.32,depthWrite:false});
    this.materials.push(this.selectedMaterial,this.lastMaterial,this.checkMaterial,this.dotMaterial);
  }

  _label(text,x,z,rotation) {
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const ctx=canvas.getContext('2d');ctx.font='600 77px Georgia, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#282016';ctx.fillText(text,64,68);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;this.textures.push(texture);
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false});this.materials.push(material);
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(.185,.185),material);
    plane.rotation.x=-Math.PI/2;plane.rotation.z=rotation;plane.position.set(x,.187,z);this.scene.add(plane);
  }

  _buildTemplates() {
    const ivory=this._material({color:0xd9c59a,roughness:.24,metalness:.035,envMapIntensity:.42});
    const ivoryTrim=this._material({color:0xe8d7b1,roughness:.21,metalness:.06,envMapIntensity:.48});
    const black=this._material({color:0x101211,roughness:.235,metalness:.08,envMapIntensity:.70});
    const blackTrim=this._material({color:0x292c2a,roughness:.23,metalness:.16,envMapIntensity:.72});
    for(const color of ['w','b']) for(const type of ['p','r','n','b','q','k']) this.templates[color+type]=pieceTemplate(type,color==='w'?ivory:black,color==='w'?ivoryTrim:blackTrim,color==='w'?black:blackTrim);
  }

  setPosition(board) {
    this.cancelMove();
    this._applyPosition(board);
  }

  _applyPosition(board) {
    this.pieces.clear();
    this.occupied=new Set();
    for(let rank=0;rank<8;rank++) for(let file=0;file<8;file++) {
      const piece=board[rank]?.[file];if(!piece)continue;
      const square=piece.square||FILES[file]+(8-rank);
      const group=this.templates[piece.color+piece.type].clone(true);
      group.position.copy(squarePosition(square));group.position.y+=.023;
      if(piece.color==='b')group.rotation.y=Math.PI;
      group.traverse(child=>{child.userData.square=square;});
      this.pieces.add(group);this.occupied.add(square);
    }
  }

  _buildHand() {
    if(this.hand)return;
    const root=new THREE.Group();root.visible=false;this.scene.add(root);
    const skin=new THREE.MeshPhysicalMaterial({color:0xc98f68,roughness:.64,metalness:0,envMapIntensity:.16,clearcoat:.04,clearcoatRoughness:.75});
    const nail=new THREE.MeshPhysicalMaterial({color:0xe3bca5,roughness:.40,metalness:0,envMapIntensity:.20,clearcoat:.12});
    const crease=this._material({color:0xa96e50,roughness:.82,envMapIntensity:.08});
    this.materials.push(skin,nail);
    const sphere=new THREE.SphereGeometry(1,24,16);
    const mesh=(parent,geometry,material=skin)=>{const object=new THREE.Mesh(geometry,material);object.castShadow=true;object.receiveShadow=true;parent.add(object);return object;};
    const oval=(parent,x,y,z,sx,sy,sz,material=skin)=>{const object=mesh(parent,sphere,material);object.position.set(x,y,z);object.scale.set(sx,sy,sz);return object;};
    // An asymmetric, softly bevelled palm with a fuller thumb pad.
    const outline=new THREE.Shape();outline.moveTo(-.265,.68);
    outline.bezierCurveTo(-.34,.50,-.47,.28,-.47,-.12);
    outline.bezierCurveTo(-.48,-.35,-.43,-.53,-.33,-.57);
    outline.bezierCurveTo(-.10,-.62,.19,-.62,.34,-.52);
    outline.bezierCurveTo(.46,-.40,.47,-.12,.43,.17);
    outline.bezierCurveTo(.41,.40,.33,.55,.275,.68);outline.closePath();
    const palmGeometry=new THREE.ExtrudeGeometry(outline,{depth:.18,bevelEnabled:true,bevelThickness:.075,bevelSize:.055,bevelSegments:5,curveSegments:16,steps:1});
    palmGeometry.translate(0,0,-.09);palmGeometry.rotateX(Math.PI/2);
    mesh(root,palmGeometry);
    oval(root,0,.055,.025,.425,.145,.55);
    oval(root,-.34,-.035,.10,.225,.17,.34);
    oval(root,.24,-.02,.20,.20,.125,.30);
    // The forearm continues beyond the table rather than ending in a floating wrist.
    const wristStart=new THREE.Vector3(0,.005,.62),armEnd=new THREE.Vector3(.25,1.15,14.0);
    const armDirection=armEnd.clone().sub(wristStart);
    const arm=mesh(root,new THREE.CylinderGeometry(.64,.275,armDirection.length(),32,1));
    arm.position.copy(wristStart).add(armEnd).multiplyScalar(.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),armDirection.normalize());
    oval(root,0,.005,.63,.29,.16,.30);
    for(const z of [.61,.69]) {
      const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.20,.135,z),new THREE.Vector3(0,.165,z+.015),new THREE.Vector3(.20,.135,z)]);
      mesh(root,new THREE.TubeGeometry(curve,12,.004,5,false),crease);
    }
    const makeDigit=(x,z,lengths,radius,spread)=>{
      const base=new THREE.Group();base.position.set(x,-.005,z);base.rotation.y=spread;root.add(base);
      const joints=[];let parent=base;
      lengths.forEach((length,index)=>{
        const joint=new THREE.Group();parent.add(joint);
        const r=radius*(1-index*.10);
        const segment=mesh(joint,new THREE.CapsuleGeometry(r,Math.max(.02,length-2*r),8,16));
        segment.rotation.x=Math.PI/2;segment.position.z=-length/2;
        oval(joint,0,.018,-.025,r*1.025,r*.88,r*.95);
        if(index===lengths.length-1){const plate=oval(joint,0,r*.83,-length*.61,r*.68,.013,length*.255,nail);plate.rotation.x=.04;}
        joints.push(joint);
        const next=new THREE.Group();next.position.z=-length;joint.add(next);parent=next;
      });
      return {base,joints};
    };
    const fingers=[
      makeDigit(-.31,-.51,[.50,.36,.28],.105,.025),
      makeDigit(-.075,-.56,[.55,.39,.29],.11,0),
      makeDigit(.16,-.53,[.51,.36,.27],.103,-.025),
      makeDigit(.36,-.43,[.40,.29,.23],.088,-.08),
    ];
    const thumb=makeDigit(-.55,-.24,[.60,.50],.13,-1.3);
    oval(root,-.46,-.025,-.10,.18,.15,.26);
    this.hand={root,fingers,thumb};
    this._poseHand(0);
  }

  _poseHand(grip) {
    const {fingers,thumb}=this.hand;
    fingers.forEach((finger,index)=>{
      const curl=grip*(index===0?1:index===1?.94:.87);
      finger.joints[0].rotation.x=-(.12+curl*.62+index*.025);
      finger.joints[1].rotation.x=-(.10+curl*1.05);
      finger.joints[2].rotation.x=-(.07+curl*.45);
    });
    thumb.base.rotation.y=THREE.MathUtils.lerp(-1.3,-.90,grip);
    thumb.joints[0].rotation.x=-THREE.MathUtils.lerp(.10,.50,grip);
    thumb.joints[1].rotation.x=-THREE.MathUtils.lerp(.12,.65,grip);
  }

  animateMove(move,afterBoard) {
    this.cancelMove();
    if(this.disposed)return Promise.resolve();
    const moving=this.pieces.children.find(piece=>piece.userData.square===move.from);
    if(!moving||window.matchMedia('(prefers-reduced-motion: reduce)').matches){this._applyPosition(afterBoard);return Promise.resolve();}
    this._buildHand();
    const side=move.color==='b'?-1:1;
    const from=squarePosition(move.from),to=squarePosition(move.to);from.y+=.023;to.y+=.023;
    const pieceHeight={p:.98,r:1.18,n:1.40,b:1.38,q:1.51,k:1.65}[move.piece]||1.1;
    const captureSquare=move.flags?.includes('e')?move.to[0]+move.from[1]:move.to;
    const captured=this.pieces.children.find(piece=>piece!==moving&&piece.userData.square===captureSquare);
    this.hand.root.rotation.set(0,side===1?0:Math.PI,0);
    this.hand.root.visible=true;
    return new Promise(resolve=>{
      this.moveAnimation={start:performance.now(),duration:1750,from,to,moving,captured,afterBoard,side,gripHeight:pieceHeight*.82+.85,resolve,captureRemoved:false,applied:false};
      this._updateMoveAnimation(this.moveAnimation.start);
    });
  }

  cancelMove() {
    const animation=this.moveAnimation;
    this.moveAnimation=null;
    if(this.hand)this.hand.root.visible=false;
    if(animation)animation.resolve();
  }

  _updateMoveAnimation(now) {
    const animation=this.moveAnimation;if(!animation)return;
    const {from,to,moving,side,gripHeight}=animation;
    const t=THREE.MathUtils.clamp((now-animation.start)/animation.duration,0,1);
    const smooth=value=>{const n=THREE.MathUtils.clamp(value,0,1);return n*n*(3-2*n);};
    const handPosition=from.clone();
    let grip=0,lift=0,travel=0;
    if(t<.22) {
      const reach=smooth(t/.22);
      handPosition.x+=side*(.16+.55*(1-reach));
      handPosition.y+=gripHeight+.28+1.65*(1-reach);
      handPosition.z+=side*(.74+8.5*(1-reach));
    } else if(t<.32) {
      grip=smooth((t-.22)/.10);
      handPosition.x+=side*.16;handPosition.y+=gripHeight+.28*(1-grip);handPosition.z+=side*.74;
    } else {
      grip=1;
      if(t<.45)lift=1.10*smooth((t-.32)/.13);
      else if(t<.69){travel=smooth((t-.45)/.24);lift=1.10+.12*Math.sin(Math.PI*travel);}
      else if(t<.80){travel=1;lift=1.10*(1-smooth((t-.69)/.11));}
      else travel=1;
      moving.position.lerpVectors(from,to,travel);moving.position.y+=lift;
      handPosition.copy(moving.position);handPosition.x+=side*.16;handPosition.y+=gripHeight;handPosition.z+=side*.74;
      if(!animation.captureRemoved){if(animation.captured)this.pieces.remove(animation.captured);animation.captureRemoved=true;}
      if(t>=.80) {
        const release=smooth((t-.80)/.08);grip=1-release;handPosition.y+=release*.45;
        if(!animation.applied){this._applyPosition(animation.afterBoard);animation.applied=true;}
      }
      if(t>=.88) {
        const retreat=smooth((t-.88)/.12);
        handPosition.x+=side*retreat*.6;handPosition.y+=retreat*2;handPosition.z+=side*retreat*9.5;
      }
    }
    this.hand.root.position.copy(handPosition);
    this._poseHand(grip);
    if(t===1){this.moveAnimation=null;this.hand.root.visible=false;animation.resolve();}
  }

  setHighlights({selected=null,legal=[],lastMove=null,check=null}={}) {
    this.highlights.clear();
    const add=(square,geometry,material,lift=.024)=>{
      if(!square||!/^[a-h][1-8]$/.test(square))return;
      const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=-Math.PI/2;mesh.position.copy(squarePosition(square));mesh.position.y+=lift;this.highlights.add(mesh);
    };
    if(lastMove){add(lastMove.from,this.overlayGeometry,this.lastMaterial);add(lastMove.to,this.overlayGeometry,this.lastMaterial);}
    add(selected,this.overlayGeometry,this.selectedMaterial,.026);
    add(check,this.overlayGeometry,this.checkMaterial,.028);
    for(const square of legal)add(square,this.occupied?.has(square)?this.ringGeometry:this.dotGeometry,this.dotMaterial,.030);
  }

  _bindInput() {
    this.activePointers=new Set();
    this._down=e=>{this.activePointers.add(e.pointerId);if(this.activePointers.size>1)this.multiTouch=true;this.pointerDown={x:e.clientX,y:e.clientY,button:e.button,id:e.pointerId,dragged:false};};
    this._pointerMove=e=>{const start=this.pointerDown;if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)start.dragged=true;};
    this._up=e=>{
      this.activePointers.delete(e.pointerId);
      if(this.multiTouch){if(!this.activePointers.size)this.multiTouch=false;this.pointerDown=null;return;}
      const start=this.pointerDown;this.pointerDown=null;
      if(!start||start.dragged||start.button!==0||start.id!==e.pointerId||Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)return;
      const rect=this.canvas.getBoundingClientRect();
      this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
      this.raycaster.setFromCamera(this.pointer,this.camera);
      const hit=this.raycaster.intersectObjects([...this.squares,this.pieces],true).find(hit=>hit.object.userData.square);
      if(hit)this.onSquare?.(hit.object.userData.square);
    };
    this._cancel=e=>{this.activePointers.delete(e.pointerId);if(!this.activePointers.size)this.multiTouch=false;this.pointerDown=null;};
    this._context=e=>e.preventDefault();
    this.canvas.addEventListener('pointerdown',this._down);
    this.canvas.addEventListener('pointermove',this._pointerMove);
    this.canvas.addEventListener('pointerup',this._up);
    this.canvas.addEventListener('pointercancel',this._cancel);
    this.canvas.addEventListener('contextmenu',this._context);
  }

  _fitDistance() {
    const aspect=this.camera.aspect;
    // At desktop size the board fills the viewport vertically, as a real table.
    const vertical=this.view==='top'?14.1:14.0;
    const usableWidth=Math.max(.4,aspect-(aspect>1.1?.15:.06));
    return Math.max(vertical,14.35/usableWidth);
  }

  _resize(initial=false) {
    const width=Math.max(1,this.container.clientWidth),height=Math.max(1,this.container.clientHeight);
    const oldFit=this.fitDistance;
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height,false);
    this.fitDistance=this._fitDistance();
    this.controls.minDistance=this.fitDistance*.56;this.controls.maxDistance=this.fitDistance*1.8;
    if(initial||!oldFit) {
      const polar=this.view==='top'?.025:.48;
      this.camera.position.setFromSpherical(new THREE.Spherical(this.fitDistance,polar,this.facing));this.camera.position.add(this.controls.target);
    } else {
      const offset=this.camera.position.clone().sub(this.controls.target);offset.multiplyScalar(this.fitDistance/oldFit);this.camera.position.copy(this.controls.target).add(offset);
    }
    this.camera.lookAt(this.controls.target);this.controls.update();
  }

  _moveCamera(radius,phi,theta) {
    const start=new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    while(theta-start.theta>Math.PI)theta-=Math.PI*2;
    while(theta-start.theta<-Math.PI)theta+=Math.PI*2;
    this.transition={start,end:new THREE.Spherical(radius,phi,theta),time:performance.now(),duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?1:700};
  }

  flip() {
    const current=this.transition?.end.clone()||new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    this.facing=(this.facing+Math.PI)%(Math.PI*2);
    this._moveCamera(current.radius,current.phi,current.theta+Math.PI);
  }

  setView(view) {
    this.view=view==='top'?'top':'perspective';this.fitDistance=this._fitDistance();
    this._moveCamera(this.fitDistance,this.view==='top'?.025:.48,this.facing);
  }

  resetView() { this.view='perspective';this.facing=0;this.fitDistance=this._fitDistance();this._moveCamera(this.fitDistance,.48,0); }

  zoom(direction) {
    const current=this.transition?.end.clone()||new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    this._moveCamera(THREE.MathUtils.clamp(current.radius*(direction<0?.88:1.13),this.controls.minDistance,this.controls.maxDistance),current.phi,current.theta);
  }

  getSquareScreenPosition(square) {
    const position=squarePosition(square).project(this.camera);
    return {x:(position.x*.5+.5)*this.canvas.clientWidth,y:(-position.y*.5+.5)*this.canvas.clientHeight};
  }

  _animate(now) {
    if(this.disposed)return;
    this._updateMoveAnimation(now);
    if(this.transition) {
      const {start,end,time,duration}=this.transition;
      const t=THREE.MathUtils.clamp((now-time)/duration,0,1),ease=1-Math.pow(1-t,3);
      const value=new THREE.Spherical(THREE.MathUtils.lerp(start.radius,end.radius,ease),THREE.MathUtils.lerp(start.phi,end.phi,ease),THREE.MathUtils.lerp(start.theta,end.theta,ease));
      this.camera.position.setFromSpherical(value).add(this.controls.target);
      if(t===1)this.transition=null;
    }
    this.controls.update();
    this.renderer.render(this.scene,this.camera);
    this.frame=requestAnimationFrame(this._animate);
  }

  dispose() {
    if(this.disposed)return;this.cancelMove();this.disposed=true;
    cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();
    this.canvas.removeEventListener('pointerdown',this._down);this.canvas.removeEventListener('pointermove',this._pointerMove);this.canvas.removeEventListener('pointerup',this._up);this.canvas.removeEventListener('pointercancel',this._cancel);this.canvas.removeEventListener('contextmenu',this._context);
    const geometries=new Set();this.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});Object.values(this.templates).forEach(g=>g.traverse(o=>{if(o.geometry)geometries.add(o.geometry);}));
    geometries.add(this.dotGeometry);geometries.add(this.overlayGeometry);geometries.add(this.ringGeometry);
    geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());this.environment.dispose();this.renderer.dispose();this.canvas.remove();
  }
}

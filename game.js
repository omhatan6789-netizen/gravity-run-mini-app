(() => {
  'use strict';
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const startButton = document.getElementById('startButton');
  const statusText = document.getElementById('statusText');
  const stageNumber = document.getElementById('stageNumber');
  const stagePill = document.getElementById('stagePill');
  const tapHint = document.getElementById('tapHint');
  const soundButton = document.getElementById('soundButton');
  const ui = { title: document.getElementById('overlayTitle'), copy: document.getElementById('overlayCopy'), eyebrow: document.getElementById('eyebrow'), emblem: document.getElementById('cardEmblem'), note: document.getElementById('smallNote') };
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); tg.disableVerticalSwipes?.(); }

  const stages = [
    { name: 'المجرّة الزرقاء', sky: ['#78c4ff','#48a9f7'], wall: '#526288', trim: '#9888cb', trim2: '#514d80', accent: '#c4eaff', seed: 17 },
    { name: 'غابة النعناع', sky: ['#d7f0a3','#a9dc82'], wall: '#81523d', trim: '#47ba68', trim2: '#287f59', accent: '#f5ffd6', seed: 41 },
    { name: 'صحراء الشمس', sky: ['#ffed91','#ffd35d'], wall: '#a65a3e', trim: '#ffac28', trim2: '#b46532', accent: '#fffbd0', seed: 73 }
  ];
  const stageLength = 1850;
  let W = 0, H = 0, dpr = 1, mode = 'ready', stageIndex = 0, elapsed = 0, lastTime = 0, time = 0, soundOn = false, audioCtx = null;
  let players = [], hazards = [], particles = [], stars = [], cameraY = 0, countdown = 0;
  const rand = (seed) => { let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function resize() {
    const r = canvas.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!players.length) resetPlayers();
  }
  function bounds() { const wall = Math.max(34, W * .105); return { left: wall + 8, right: W - wall - 8, wall }; }
  function resetPlayers() {
    const b = bounds(); const center = (b.left + b.right) / 2;
    players = [makePlayer('blue', center - Math.min(20, W*.06), -1), makePlayer('red', center + Math.min(20, W*.06), 1)];
  }
  function makePlayer(color, x, side) { return { color, x, side, y: 0, alive: true, trail: [], anim: Math.random()*10, targetSide: side, wobble: 0 }; }
  function makeHazards(si) {
    const b = bounds(), width = b.right - b.left, list = [];
    // Safe-side openings alternate to make gravity switching essential.
    for (let i = 0; i < 7; i++) {
      const safe = (i + si) % 2 === 0 ? 1 : -1;
      const gap = Math.min(width * .43, 150);
      const depth = width - gap;
      list.push({ y: 200 + i * 225, safe, depth, width: Math.min(width*.085, 29), type: i % 3 === 1 ? 'crate' : 'ledge', seed: si*100+i });
    }
    // A broad central splitter adds a narrow but readable passage on later stages.
    if (si > 0) for (let i = 0; i < 3; i++) list.push({ y: 320 + i*510, safe: i%2 ? -1 : 1, depth: width*.52, width: Math.min(width*.06,21), type:'pillar', seed:si*300+i });
    return list.sort((a,b)=>a.y-b.y);
  }
  function begin() {
    stageIndex = 0; elapsed = 0; time = 0; mode = 'countdown'; countdown = 2.2;
    resetPlayers(); hazards = makeHazards(0); particles = []; cameraY = 0;
    overlay.classList.add('hidden'); tapHint.classList.remove('hidden'); stagePill.classList.remove('hidden');
    statusText.textContent = 'استعد...'; stageNumber.textContent = '1';
    playTone(440,.08); requestAnimationFrame(loop);
  }
  function showResult(win, text) {
    if (mode === 'ended') return;
    mode = 'ended'; overlay.classList.remove('hidden'); tapHint.classList.add('hidden');
    ui.eyebrow.textContent = win ? 'فوز مستحق!' : 'انتهى السباق';
    ui.title.textContent = win ? 'أكملت المراحل الثلاث!' : 'البوت سبقك!';
    ui.copy.textContent = win ? 'يا سلام! تفاديت الحواجز وأنهيت كل المراحل قبل البوت.' : (text || 'سقطت في حفرة أو اصطدمت بعقبة. جرّب مرة ثانية وبدّل الجاذبية في الوقت المناسب.');
    ui.emblem.textContent = win ? '★' : '↻'; ui.emblem.style.background = win ? 'linear-gradient(145deg,#ffe887,#ffad37)' : '';
    ui.emblem.style.color = win ? '#593510' : ''; ui.eyebrow.style.color = win ? '#ffd465' : '';
    ui.note.textContent = 'ما فيه نقاط — الفوز بإنهاء المراحل أو خسارة البوت'; startButton.innerHTML = 'العب مرة ثانية <span>↻</span>';
    playTone(win ? 780 : 180, .2);
  }
  function nextStage() {
    if (stageIndex >= 2) { showResult(true); return; }
    stageIndex++; elapsed = 0; hazards = makeHazards(stageIndex);
    players.forEach(p => { p.y = 0; p.alive = true; p.side = p.color === 'blue' ? -1 : 1; p.targetSide = p.side; p.x = p.side < 0 ? bounds().left + 22 : bounds().right - 22; p.trail = []; });
    particles = []; stageNumber.textContent = String(stageIndex+1); statusText.textContent = stages[stageIndex].name;
    countdown = 1.15; mode = 'countdown'; playTone(580,.12);
  }
  function flip(p) { if (!p?.alive || mode !== 'playing') return; p.side *= -1; p.targetSide = p.side; p.wobble = .22; emit(p.x,p.y+H*.69,p.color==='blue'?'#65eaff':'#ffb0ac',7); playTone(p.color==='blue'?620:360,.055); }
  function controls(e) {
    if (e) { e.preventDefault(); }
    if (mode === 'ready' || mode === 'ended') { begin(); return; }
    if (mode === 'playing') flip(players[0]);
  }
  function createStars() { stars=[]; for (let i=0;i<35;i++) stars.push({x:rand(i+8),y:rand(i+99),r:1+rand(i+7)*3,a:.13+rand(i+3)*.2}); }
  function emit(x,y,color,n=4) { for(let i=0;i<n;i++) particles.push({x,y,vx:(Math.random()-.5)*95,vy:(Math.random()-.6)*90,life:.45+Math.random()*.35,max:.8,color,r:2+Math.random()*3}); }
  function update(dt) {
    time += dt;
    if (mode === 'countdown') { countdown -= dt; if (countdown <= 0) {mode='playing';statusText.textContent=stages[stageIndex].name+' — انطلق!';playTone(700,.13);} }
    if (mode !== 'playing') { updateParticles(dt); return; }
    elapsed += dt;
    const b=bounds(), width=b.right-b.left, runnerY=H*.70, playerSpeed=205, botSpeed=211;
    for (let pi=0;pi<players.length;pi++) {
      const p=players[pi]; if(!p.alive) continue;
      const speed=pi===0?playerSpeed:botSpeed; p.y += speed*dt; p.anim += dt*9; p.wobble=Math.max(0,p.wobble-dt);
      const target = p.side < 0 ? b.left+19 : b.right-19;
      // Bot reads the next opening and switches before reaching each barrier.
      if (pi===1) {
        const next=hazards.find(h=>h.y>p.y+95);
        if(next && next.y-p.y < 190 && p.side !== next.safe) {p.side=next.safe;p.targetSide=next.safe;}
        if(next && p.y>stageLength-280) {p.side = (b.right-p.x < p.x-b.left)?-1:1;}
      }
      const dx=target-p.x; p.x += clamp(dx,-(pi===0?240:290)*dt,(pi===0?240:290)*dt);
      p.trail.push({x:p.x,y:runnerY,life:.32}); if(p.trail.length>8)p.trail.shift();
      for(const h of hazards) {
        const sy=runnerY-(h.y-p.y);
        if(Math.abs(sy-runnerY)<(h.width/2+11)) {
          const overlaps = h.safe<0 ? p.x < b.right-h.depth : p.x > b.left+h.depth;
          if(overlaps) {p.alive=false;emit(p.x,runnerY,p.color==='blue'?'#54ddff':'#ff7177',20);playTone(125,.25);if(pi===0){canvas.parentElement.classList.add('shake');setTimeout(()=>canvas.parentElement.classList.remove('shake'),300);showResult(false,'اصطدمت بعقبة! المس الشاشة أبكر لتنتقل إلى الجهة الآمنة.');}else {showResult(true,'البوت اصطدم بعقبة، وأنت فزت!');}break;}
        }
      }
      if(p.alive && p.y>=stageLength) {p.y=stageLength; if(pi===0){ if(players[1].y<stageLength){showResult(true);return;} } else if(players[0].y<stageLength){showResult(false,'البوت أنهى المراحل قبلك. حاول تبديل الجاذبية في توقيت أفضل.');return;} }
    }
    if(players[0].y>=stageLength && players[1].y>=stageLength) nextStage();
    cameraY=players[0].y; updateParticles(dt);
  }
  function updateParticles(dt) { particles=particles.filter(p=>p.life>0); for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;p.vy+=35*dt;} }
  function roundedRect(x,y,w,h,r,fill,stroke,lw=1){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.lineWidth=lw;ctx.strokeStyle=stroke;ctx.stroke()}}
  function drawBackground(s) {
    const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,s.sky[0]);g.addColorStop(1,s.sky[1]);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    ctx.save();ctx.globalAlpha=.18;
    if(stageIndex===0){for(let i=0;i<stars.length;i++){let x=stars[i].x*W,y=((stars[i].y*H+time*11)%H);ctx.fillStyle='#fff';ctx.globalAlpha=stars[i].a;ctx.beginPath();ctx.arc(x,y,stars[i].r,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=.12;ctx.strokeStyle='#fff';ctx.lineWidth=1;for(let i=0;i<5;i++){ctx.beginPath();ctx.arc(W*.5,H*.48,45+i*27+Math.sin(time+i)*4,0,Math.PI*2);ctx.stroke();}}
    else if(stageIndex===1){for(let i=0;i<8;i++){const x=((i*79+20)%W),y=((i*137+time*12)%H);ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(x,y,20,7,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(x+14,y-7,10,0,Math.PI*2);ctx.fill();}}
    else {for(let i=0;i<6;i++){ctx.fillStyle=i%2?'#fff5b4':'#eaa63f';ctx.beginPath();ctx.moveTo(i*W/4-60,H*.2+(i%3)*85);ctx.lineTo(i*W/4+30,H*.2+(i%3)*85-45);ctx.lineTo(i*W/4+140,H*.2+(i%3)*85);ctx.fill();}}
    ctx.restore();
  }
  function drawWalls(s) {
    const b=bounds();
    // Dark rim and repeating scallops create a lively, layered side-wall treatment.
    ctx.fillStyle=s.wall;ctx.fillRect(0,0,b.wall,H);ctx.fillRect(W-b.wall,0,b.wall,H);
    const step=18,offset=(time*35)%step;
    for(let side=0;side<2;side++){
      const x=side===0?b.wall-2:W-b.wall+2;
      for(let y=-step+offset;y<H+step;y+=step){ctx.fillStyle=s.trim2;ctx.beginPath();ctx.arc(x,y,11,side===0?-.5*Math.PI:.5*Math.PI,side===0?.5*Math.PI:1.5*Math.PI);ctx.fill();ctx.fillStyle=s.trim;ctx.beginPath();ctx.arc(x+(side===0?4:-4),y,8,side===0?-.5*Math.PI:.5*Math.PI,side===0?.5*Math.PI:1.5*Math.PI);ctx.fill();}
    }
    ctx.fillStyle='#17213a';ctx.fillRect(b.left-3,0,3,H);ctx.fillRect(b.right,0,3,H);
  }
  function drawHazards(s) {
    const b=bounds(), runnerY=H*.70;
    for(const h of hazards){const sy=runnerY-(h.y-cameraY);if(sy < -90 || sy>H+90)continue;
      const depth=h.depth, blockW=h.width;
      const x=h.safe<0?b.right-depth:b.left;
      const grad=ctx.createLinearGradient(x,sy-blockW/2,x+depth,sy+blockW/2);grad.addColorStop(0,'#2c2744');grad.addColorStop(.12,s.wall);grad.addColorStop(1,s.wall);
      ctx.fillStyle=grad;ctx.fillRect(x,sy-blockW/2,depth,blockW);
      ctx.strokeStyle='#211b2e';ctx.lineWidth=4;ctx.strokeRect(x,sy-blockW/2,depth,blockW);
      ctx.fillStyle=s.trim;ctx.fillRect(h.safe<0?x: x+depth-blockW,sy-blockW/2,blockW,blockW);
      if(h.type==='crate'){
        const cx=h.safe<0?x+depth-10:x+10;ctx.fillStyle='#a95345';ctx.strokeStyle='#452e39';ctx.lineWidth=3;ctx.fillRect(cx-13,sy-13,26,26);ctx.strokeRect(cx-13,sy-13,26,26);ctx.beginPath();ctx.moveTo(cx-10,sy-10);ctx.lineTo(cx+10,sy+10);ctx.moveTo(cx+10,sy-10);ctx.lineTo(cx-10,sy+10);ctx.stroke();
      }
    }
  }
  function drawRunner(p, y) {
    const s=p.color==='blue'?'#11bdf1':'#ff5e69', dark=p.color==='blue'?'#063f68':'#672b39';
    for(let i=0;i<p.trail.length;i++){const t=p.trail[i];ctx.globalAlpha=(i/p.trail.length)*.18;ctx.fillStyle=s;ctx.beginPath();ctx.ellipse(t.x,y+(p.trail.length-i)*2,9,13,0,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
    ctx.save();ctx.translate(p.x,y);ctx.rotate(p.side<0?0:Math.PI);ctx.rotate(Math.sin(p.anim)*.045+p.wobble*1.3);
    // Original, vector-drawn mascot: visor, compact suit, boots and bright gravity-side accents.
    ctx.fillStyle=dark;ctx.beginPath();ctx.ellipse(0,1,13,17,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#f7fbff';ctx.beginPath();ctx.ellipse(0,-2,9.5,12,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#26344f';ctx.beginPath();ctx.ellipse(2,-4,4,5,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(3,-5,1.3,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=s;roundedRect(-11,-1,22,6,3,s);ctx.fillStyle='#ffd451';ctx.beginPath();ctx.moveTo(-8,10);ctx.lineTo(-18,8);ctx.lineTo(-12,15);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#17243a';ctx.lineWidth=2.2;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-5,12);ctx.lineTo(-9,17+Math.sin(p.anim)*2);ctx.moveTo(5,12);ctx.lineTo(9,17-Math.sin(p.anim)*2);ctx.stroke();
    ctx.restore();
  }
  function render() {
    const s=stages[stageIndex]||stages[0];drawBackground(s);drawWalls(s);drawHazards(s);
    const runnerY=H*.70;
    // Finish gate and subtle progress cue.
    const remain=stageLength-cameraY;
    if(remain<330){const fy=runnerY-remain;ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.setLineDash([8,6]);ctx.beginPath();ctx.moveTo(bounds().left,fy);ctx.lineTo(bounds().right,fy);ctx.stroke();ctx.setLineDash([]);}
    players.forEach(p=>{if(p.alive)drawRunner(p,runnerY);});
    for(const p of particles){ctx.globalAlpha=clamp(p.life/p.max,0,1);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
    if(mode==='countdown'){const n=Math.max(1,Math.ceil(countdown));ctx.fillStyle='#12203b9c';ctx.beginPath();ctx.arc(W/2,H*.43,39,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.font='800 44px Rubik, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(n),W/2,H*.43);}
  }
  function loop(now) { if(mode==='ended'||mode==='ready')return; const dt=Math.min(.04,(now-lastTime)/1000||0);lastTime=now;update(dt);render();if(mode!=='ended')requestAnimationFrame(loop); }
  function playTone(freq,duration) { if(!soundOn)return;try{audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.055,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+duration);}catch(_){} }

  canvas.addEventListener('pointerdown', e=>{if(mode==='ready'||mode==='ended')return;controls(e);});
  startButton.addEventListener('click',e=>{e.stopPropagation();begin();});
  overlay.addEventListener('click',e=>{if(e.target===overlay&&mode==='ended')begin();});
  document.addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();if(mode==='ready'||mode==='ended')begin();else flip(players[0]);}});
  soundButton.addEventListener('click',()=>{soundOn=!soundOn;soundButton.textContent=soundOn?'♫':'♪';soundButton.style.color=soundOn?'#62d7ff':'';if(soundOn)playTone(520,.08);});
  window.addEventListener('resize',resize);window.addEventListener('orientationchange',()=>setTimeout(resize,150));
  createStars();resize();resetPlayers();render();
})();

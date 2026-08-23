(function(){
'use strict';
const PRIM=window.PRIM={sims:[]};

PRIM.clamp=(v,a,b)=>v<a?a:v>b?b:v;
PRIM.lerp=(a,b,t)=>a+(b-a)*t;
PRIM.rand=(a,b)=>a+Math.random()*(b-a);
PRIM.pick=arr=>arr[(Math.random()*arr.length)|0];
PRIM.hexRgb=function(hex){
  const n=parseInt(hex.slice(1),16);
  return [(n>>16)&255,(n>>8)&255,n&255];
};

function createEngine(canvas){
  const ctx=canvas.getContext('2d',{alpha:false});
  const eng={
    canvas:canvas,
    ctx:ctx,
    w:0,
    h:0,
    paused:false,
    sim:null,
    input:null,
    onStats:null,
    _last:performance.now(),
    _fpsAcc:0,
    _fpsN:0,
    _rt:null,
    _statT:performance.now(),
    resize(){
      eng.w=Math.max(320,window.innerWidth);
      eng.h=Math.max(240,window.innerHeight);
      canvas.width=eng.w;
      canvas.height=eng.h;
      ctx.fillStyle='#04060a';
      ctx.fillRect(0,0,eng.w,eng.h);
      if(eng.sim&&eng.sim.resize)eng.sim.resize();
    },
    setSim(inst){
      eng.sim=inst;
    },
    loop(now){
      const dt=Math.min((now-eng._last)/1000,0.05);
      eng._last=now;
      if(!eng.paused&&eng.sim&&eng.sim.step)eng.sim.step(dt);
      if(eng.sim&&eng.sim.draw)eng.sim.draw(ctx);
      if(eng.onFrame)eng.onFrame(dt);
      eng._fpsAcc+=dt;
      eng._fpsN++;
      if(now-eng._statT>300){
        const fps=Math.round(eng._fpsN/Math.max(eng._fpsAcc,1e-6));
        eng._fpsAcc=0;
        eng._fpsN=0;
        eng._statT=now;
        if(eng.onStats)eng.onStats(fps);
      }
      requestAnimationFrame(eng.loop);
    }
  };
  window.addEventListener('resize',()=>{
    clearTimeout(eng._rt);
    eng._rt=setTimeout(()=>eng.resize(),150);
  });
  eng.resize();
  requestAnimationFrame(eng.loop);
  return eng;
}

function attachInput(canvas){
  const inp={x:-99999,y:-99999,down:false,alt:false};
  function local(e){
    const r=canvas.getBoundingClientRect();
    return [e.clientX-r.left,e.clientY-r.top];
  }
  canvas.addEventListener('pointermove',e=>{
    const p=local(e);
    inp.x=p[0];
    inp.y=p[1];
  });
  canvas.addEventListener('pointerdown',e=>{
    const p=local(e);
    inp.x=p[0];
    inp.y=p[1];
    inp.down=true;
    inp.alt=e.button===2||e.altKey;
    try{canvas.setPointerCapture(e.pointerId);}catch(err){}
  });
  window.addEventListener('pointerup',()=>{
    inp.down=false;
    inp.alt=false;
  });
  canvas.addEventListener('pointerleave',()=>{
    if(!inp.down){
      inp.x=-99999;
      inp.y=-99999;
    }
  });
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  return inp;
}

PRIM.createEngine=createEngine;
PRIM.attachInput=attachInput;
})();

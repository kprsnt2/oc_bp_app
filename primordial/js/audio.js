(function(){
'use strict';
const PRIM=window.PRIM;

let ctx=null,bus=null;
let enabled=false,mode=null,lastBuilt='';
const N={};

function ensure(){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC)return false;
  if(!ctx){
    ctx=new AC();
    bus=ctx.createGain();
    bus.gain.value=0.0001;
    const comp=ctx.createDynamicsCompressor();
    comp.threshold.value=-18;
    comp.ratio.value=6;
    bus.connect(comp);
    comp.connect(ctx.destination);
  }
  if(ctx.state==='suspended')ctx.resume();
  return true;
}

function teardown(){
  for(const k in N){
    const n=N[k];
    try{if(n.stop)n.stop();}catch(e){}
    try{if(n.disconnect)n.disconnect();}catch(e){}
    delete N[k];
  }
}

function noiseBuffer(){
  const len=ctx.sampleRate*2;
  const buf=ctx.createBuffer(1,len,ctx.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
  return buf;
}

function buildDrone(f,gain){
  const o1=ctx.createOscillator(),o2=ctx.createOscillator();
  const f1=ctx.createBiquadFilter(),g=ctx.createGain();
  o1.type='sawtooth';
  o2.type='sawtooth';
  o1.frequency.value=f;
  o2.frequency.value=f*1.007;
  f1.type='lowpass';
  f1.frequency.value=180;
  f1.Q.value=7;
  g.gain.value=gain;
  o1.connect(f1);
  o2.connect(f1);
  f1.connect(g);
  g.connect(bus);
  o1.start();
  o2.start();
  N.o1=o1;
  N.o2=o2;
  N.fl=f1;
  N.gn=g;
}

function buildNoise(){
  const src=ctx.createBufferSource();
  src.buffer=noiseBuffer();
  src.loop=true;
  const bp=ctx.createBiquadFilter();
  bp.type='bandpass';
  bp.frequency.value=400;
  bp.Q.value=9;
  const g=ctx.createGain();
  g.gain.value=0.5;
  src.connect(bp);
  bp.connect(g);
  g.connect(bus);
  src.start();
  N.ns=src;
  N.bp=bp;
  N.gn=g;
}

function buildPad(){
  const g=ctx.createGain();
  g.gain.value=0.09;
  const fl=ctx.createBiquadFilter();
  fl.type='lowpass';
  fl.frequency.value=900;
  fl.connect(g);
  g.connect(bus);
  const os=[];
  [110,164.81,220,277.18].forEach(function(fq,i){
    const o=ctx.createOscillator();
    o.type='triangle';
    o.frequency.value=fq;
    o.detune.value=(i-1.5)*4;
    const og=ctx.createGain();
    og.gain.value=0.8;
    o.connect(og);
    og.connect(fl);
    o.start();
    os.push(o);
  });
  N.padFl=fl;
  N.padOs=os;
  N.gn=g;
}

function buildBell(){
  const car=ctx.createOscillator();
  const mod=ctx.createOscillator();
  const modG=ctx.createGain();
  const g=ctx.createGain();
  car.type='sine';
  mod.type='sine';
  car.frequency.value=82;
  mod.frequency.value=41;
  modG.gain.value=40;
  mod.connect(modG);
  modG.connect(car.frequency);
  g.gain.value=0.16;
  car.connect(g);
  g.connect(bus);
  car.start();
  mod.start();
  N.car=car;
  N.mod=mod;
  N.modG=modG;
  N.gn=g;
}

function build(m){
  teardown();
  lastBuilt=m;
  if(!ctx)return;
  if(m==='particle-life')buildDrone(55,0.15);
  else if(m==='physarum')buildNoise();
  else if(m==='boids')buildPad();
  else if(m==='gray-scott')buildBell();
  else buildDrone(73,0.11);
}

function smooth(node,param,v,t){
  node[param].setTargetAtTime(v,ctx.currentTime,t||0.12);
}

function pluck(freq,vol){
  const t=ctx.currentTime;
  if(pluck._last&&t-pluck._last<0.06)return;
  pluck._last=t;
  const o=ctx.createOscillator(),g=ctx.createGain();
  o.type='triangle';
  o.frequency.value=freq;
  g.gain.setValueAtTime(0.0001,t);
  g.gain.exponentialRampToValueAtTime(vol||0.2,t+0.014);
  g.gain.exponentialRampToValueAtTime(0.0001,t+0.55);
  o.connect(g);
  g.connect(bus);
  o.start(t);
  o.stop(t+0.6);
  o.onended=function(){
    try{o.disconnect();g.disconnect();}catch(e){}
  };
}

function update(mt){
  if(!enabled||!ctx||!mt)return;
  if(mode==='particle-life'&&N.fl){
    smooth(N.fl,'frequency',140+mt.act*1600,0.15);
  }else if(mode==='physarum'&&N.bp){
    smooth(N.bp,'frequency',220+mt.act*2000,0.25);
  }else if(mode==='boids'&&N.padFl){
    smooth(N.padFl,'frequency',300+mt.act*2400,0.2);
    for(let i=0;i<N.padOs.length;i++){
      smooth(N.padOs[i],'detune',(i-1.5)*4+mt.tone*(i-1.5)*26,0.4);
    }
  }else if(mode==='gray-scott'&&N.mod){
    smooth(N.mod,'frequency',26+mt.act*150,0.35);
    smooth(N.modG,'gain',8+mt.act*150,0.35);
  }else if(mode==='evolution'&&N.o1){
    smooth(N.o1,'frequency',48+mt.tone*74,0.5);
    if(mt.pulse>0.5){
      const scale=[0,3,5,7,10];
      const semi=P.pick(scale)+12*((Math.random()*2)|0);
      pluck(196*Math.pow(2,semi/12),0.16);
    }
  }
}

PRIM.audio={
  setEnabled:function(on){
    enabled=on;
    if(on){
      if(ensure()){
        bus.gain.setTargetAtTime(1,ctx.currentTime,0.5);
        build(mode||'particle-life');
      }
    }else{
      if(ctx)bus.gain.setTargetAtTime(0.0001,ctx.currentTime,0.15);
      setTimeout(teardown,700);
    }
  },
  setMode:function(m){
    mode=m;
    if(enabled&&lastBuilt!==m){
      if(ensure())build(m);
    }
  },
  update:update,
  isEnabled:function(){return enabled;}
};

PRIM.metrics=function(def,inst){
  if(!def||!inst)return null;
  const id=def.id;
  if(id==='particle-life'){
    const n=inst.n,stride=Math.max(1,(n/256)|0);
    let s=0,c=0;
    for(let i=0;i<n;i+=stride){
      s+=Math.abs(inst.vx[i])+Math.abs(inst.vy[i]);
      c++;
    }
    return {act:PRIM.clamp(s/Math.max(1,c)/2,0,1)};
  }
  if(id==='physarum'){
    const map=inst.map,stride=Math.max(1,(map.length/256)|0);
    let s=0,c=0;
    for(let i=0;i<map.length;i+=stride){
      s+=map[i];
      c++;
    }
    return {act:PRIM.clamp(s/Math.max(1,c)/26,0,1)};
  }
  if(id==='boids'){
    const n=inst.n,stride=Math.max(1,(n/256)|0);
    let s=0,c=0;
    for(let i=0;i<n;i+=stride){
      s+=Math.sqrt(inst.vx[i]*inst.vx[i]+inst.vy[i]*inst.vy[i]);
      c++;
    }
    return {act:PRIM.clamp(s/Math.max(1,c)/(inst.p.maxSpeed*1.3),0,1),tone:0.5};
  }
  if(id==='gray-scott'){
    const B=inst.B,stride=Math.max(1,(B.length/256)|0);
    let s=0,c=0;
    for(let i=0;i<B.length;i+=stride){
      s+=B[i];
      c++;
    }
    return {act:PRIM.clamp(s/Math.max(1,c)*inst.p.gain*2.2,0,1)};
  }
  if(id==='evolution'){
    const pulse=inst.pulse;
    return {
      tone:PRIM.clamp(inst.critters.length/(inst.p.cap||240),0,1),
      act:PRIM.clamp(0.15+pulse*0.85,0,1),
      pulse:pulse
    };
  }
  return null;
};
})();

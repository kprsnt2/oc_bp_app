(function(){
'use strict';
const P=window.PRIM;
const $=function(id){return document.getElementById(id);};

const canvas=$('view');
const engine=P.createEngine(canvas);
engine.input=P.attachInput(canvas);

let inst=null,def=null;

const els={
  tabs:$('tabs'),
  controls:$('controls'),
  fps:$('stat-fps'),
  ent:$('stat-entities'),
  hint:$('hint'),
  paused:$('paused-flag'),
  jarList:$('jar-list'),
  jarName:$('jar-name'),
  jarSave:$('jar-save-btn'),
  seedList:$('seed-list')
};

const SEEDS={
  'particle-life':[
    {name:'primordial soup',apply:function(i){
      i.p.count=3500;i.p.species=6;i.p.radius=64;i.p.force=1;i.p.friction=0.5;i.p.warp=1;
      i.randomizeMatrix();
    }},
    {name:'hunting spiral',apply:function(i){
      i.p.species=6;i.p.radius=76;i.p.force=1.1;i.p.friction=0.38;
      i.reset();
      const K=6,m=new Float32Array(K*K);
      for(let r=0;r<K;r++)for(let c=0;c<K;c++){
        m[r*K+c]=r===c?-0.28:(c===(r+1)%K?0.85:(c===(r+2)%K?0.12:-0.14));
      }
      i.matrix=m;
    }},
    {name:'cell culture',apply:function(i){
      i.p.species=5;i.p.radius=88;i.p.force=0.9;i.p.friction=0.55;
      i.reset();
      const K=5,m=new Float32Array(K*K);
      for(let r=0;r<K;r++)for(let c=0;c<K;c++)m[r*K+c]=r===c?0.62:P.rand(-0.32,0.22);
      i.matrix=m;
    }}
  ],
  'physarum':[
    {name:'vein network',apply:function(i){
      i.p.sensorAngle=24;i.p.sensorDist=11;i.p.turnAngle=30;i.p.speed=1.1;i.p.deposit=6;i.p.decay=0.94;i.p.gain=0.09;
    }},
    {name:'fine lace',apply:function(i){
      i.p.sensorAngle=44;i.p.sensorDist=19;i.p.turnAngle=48;i.p.speed=1.4;i.p.decay=0.962;i.p.gain=0.11;
    }},
    {name:'thick mats',apply:function(i){
      i.p.sensorAngle=12;i.p.sensorDist=5;i.p.turnAngle=16;i.p.deposit=13;i.p.decay=0.92;i.p.gain=0.07;
    }}
  ],
  'boids':[
    {name:'murmuration',apply:function(i){
      i.p.count=1500;i.p.perception=56;i.p.sep=1.1;i.p.ali=1.5;i.p.coh=1.2;i.p.trail=0.5;i.p.maxSpeed=150;
    }},
    {name:'swirl vipers',apply:function(i){
      i.p.count=700;i.p.perception=26;i.p.sepRadius=14;i.p.sep=2.6;i.p.ali=0.4;i.p.coh=0.35;i.p.maxSpeed=200;i.p.edges='bounce';
    }},
    {name:'slow nebula',apply:function(i){
      i.p.count=900;i.p.perception=80;i.p.sep=0.8;i.p.ali=0.7;i.p.coh=1.6;i.p.maxSpeed=70;i.p.size=3.4;i.p.trail=0.62;i.p.edges='wrap';
    }}
  ],
  'gray-scott':[
    {name:'coral garden',apply:function(i){i.applyPreset('coral');}},
    {name:'embryos dividing',apply:function(i){i.applyPreset('mitosis');}},
    {name:'wormfield',apply:function(i){i.applyPreset('worms');}}
  ],
  'evolution':[
    {name:'petri dawn',apply:function(i){
      i.p.foodRate=45;i.p.mutation=0.12;i.p.metabolism=1;i.p.sense=170;i.p.cap=240;
    }},
    {name:'famine world',apply:function(i){
      i.p.foodRate=14;i.p.mutation=0.22;i.p.metabolism=0.9;i.p.cap=160;
    }},
    {name:'all-you-can-eat',apply:function(i){
      i.p.foodRate=110;i.p.mutation=0.06;i.p.metabolism=1.2;i.p.cap=380;
    }}
  ]
};

engine.onStats=function(fps){
  els.fps.textContent=fps+' fps';
  els.ent.textContent=inst&&inst.countEntity?inst.countEntity():'';
};

engine.onFrame=function(){
  if(P.audio.isEnabled()){
    P.audio.update(P.metrics(def,inst));
  }
};

function coerce(v){
  return v!==''&&!isNaN(Number(v))?Number(v):v;
}

function fmtVal(s,v){
  const dec=s.step&&s.step<1?(String(s.step).split('.')[1]||'').length:0;
  return Number(v).toFixed(dec);
}

function buildControls(){
  els.controls.innerHTML='';
  for(const s of def.params){
    if(s.type==='slider'){
      const row=document.createElement('div');
      row.className='ctl';
      const lab=document.createElement('label');
      const nl=document.createElement('span');
      nl.textContent=s.label;
      const vl=document.createElement('span');
      vl.className='val';
      vl.textContent=fmtVal(s,inst.p[s.key]);
      lab.appendChild(nl);
      lab.appendChild(vl);
      const input=document.createElement('input');
      input.type='range';
      input.min=s.min;
      input.max=s.max;
      input.step=s.step;
      input.value=inst.p[s.key];
      let rt=null;
      input.addEventListener('input',function(){
        inst.p[s.key]=parseFloat(input.value);
        vl.textContent=fmtVal(s,inst.p[s.key]);
        if(s.rebuild){
          clearTimeout(rt);
          rt=setTimeout(function(){inst.reset();},140);
        }
      });
      row.appendChild(lab);
      row.appendChild(input);
      els.controls.appendChild(row);
    }else if(s.type==='select'){
      const row=document.createElement('div');
      row.className='ctl';
      const lab=document.createElement('label');
      lab.innerHTML='<span>'+s.label+'</span>';
      const sel=document.createElement('select');
      for(const o of s.options){
        const op=document.createElement('option');
        op.value=o.value;
        op.textContent=o.label;
        sel.appendChild(op);
      }
      sel.value=String(inst.p[s.key]);
      sel.addEventListener('change',function(){
        const v=coerce(sel.value);
        inst.p[s.key]=v;
        if(s.rebuild)inst.reset();
        if(s.apply)s.apply(inst,v);
        buildControls();
      });
      row.appendChild(lab);
      row.appendChild(sel);
      els.controls.appendChild(row);
    }else if(s.type==='button'){
      const row=document.createElement('div');
      row.className='btn-row';
      const b=document.createElement('button');
      b.className='ghost';
      b.textContent=s.label;
      b.addEventListener('click',function(){
        s.action(inst);
        refreshCustom();
      });
      row.appendChild(b);
      els.controls.appendChild(row);
    }else if(s.type==='custom'){
      const holder=document.createElement('div');
      holder.className='custom';
      holder.dataset.custom=s.key;
      els.controls.appendChild(holder);
      if(inst.renderCustom)inst.renderCustom(holder);
    }
  }
}

function refreshCustom(){
  els.controls.querySelectorAll('[data-custom]').forEach(function(h){
    if(inst.renderCustom)inst.renderCustom(h);
  });
}

function renderSeeds(){
  els.seedList.innerHTML='';
  (SEEDS[def.id]||[]).forEach(function(sd){
    const chip=document.createElement('button');
    chip.className='seed';
    chip.textContent=sd.name;
    chip.addEventListener('click',function(){
      sd.apply(inst);
      inst.reset();
      buildControls();
    });
    els.seedList.appendChild(chip);
  });
}

function switchSim(d){
  def=d;
  inst=d.create(engine);
  engine.setSim(inst);
  P.audio.setMode(d.id);
  document.documentElement.style.setProperty('--accent',d.accent);
  Array.from(els.tabs.children).forEach(function(b){
    b.classList.toggle('active',b.dataset.id===d.id);
  });
  els.hint.textContent=d.hint||'';
  buildControls();
  renderSeeds();
}

const JAR_KEY='primordial.jar.v1';
function loadJar(){
  try{return JSON.parse(localStorage.getItem(JAR_KEY))||[];}catch(err){return [];}
}
function saveJar(list){
  try{localStorage.setItem(JAR_KEY,JSON.stringify(list));}catch(err){}
}

function renderJar(){
  els.jarList.innerHTML='';
  const list=loadJar();
  if(!list.length){
    const li=document.createElement('li');
    li.className='jar-empty';
    li.textContent='empty \u2014 tune a world, then bottle it';
    els.jarList.appendChild(li);
    return;
  }
  for(const it of list){
    const li=document.createElement('li');
    const nm=document.createElement('span');
    nm.className='jar-nm';
    nm.textContent=it.name;
    const del=document.createElement('button');
    del.className='jar-del';
    del.textContent='\u2715';
    del.title='discard specimen';
    nm.addEventListener('click',function(){applySpecimen(it);});
    del.addEventListener('click',function(ev){
      ev.stopPropagation();
      saveJar(loadJar().filter(function(x){return x!==it;}));
      renderJar();
    });
    li.appendChild(nm);
    li.appendChild(del);
    els.jarList.appendChild(li);
  }
}

function applySpecimen(it){
  const d=P.sims.find(function(s){return s.id===it.sim;});
  if(!d)return;
  switchSim(d);
  Object.assign(inst.p,it.p);
  inst.reset();
  if(it.extra&&inst.applyExtra)inst.applyExtra(it.extra);
  buildControls();
}

els.jarSave.addEventListener('click',function(){
  const list=loadJar();
  const fallback=def.name.toLowerCase().replace(/[^a-z]+/g,'-')+'-'+String(list.length+1).padStart(2,'0');
  const name=(els.jarName.value||'').trim()||fallback;
  list.unshift({
    name:name,
    sim:def.id,
    p:Object.assign({},inst.p),
    extra:inst.serialize?inst.serialize():null
  });
  saveJar(list.slice(0,24));
  els.jarName.value='';
  renderJar();
});

$('btn-audio').addEventListener('click',function(){
  const on=!P.audio.isEnabled();
  P.audio.setEnabled(on);
  this.classList.toggle('on',on);
});

$('btn-shot').addEventListener('click',function(){
  const done=function(url){
    const a=document.createElement('a');
    a.href=url;
    a.download='primordial-'+def.id+'-'+Date.now()+'.png';
    a.click();
    setTimeout(function(){URL.revokeObjectURL(url);},3000);
  };
  engine.canvas.toBlob(function(b){
    if(b)done(URL.createObjectURL(b));
    else done(engine.canvas.toDataURL('image/png'));
  },'image/png');
});

let recorder=null,chunks=[];
$('btn-rec').addEventListener('click',function(){
  if(!window.MediaRecorder)return;
  if(recorder){
    recorder.stop();
    return;
  }
  const stream=engine.canvas.captureStream(60);
  const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ?'video/webm;codecs=vp9'
    :'video/webm';
  recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8e6});
  chunks=[];
  recorder.ondataavailable=function(e){if(e.data.size)chunks.push(e.data);};
  recorder.onstop=function(){
    const b=new Blob(chunks,{type:'video/webm'});
    const url=URL.createObjectURL(b);
    const a=document.createElement('a');
    a.href=url;
    a.download='primordial-'+def.id+'-'+Date.now()+'.webm';
    a.click();
    setTimeout(function(){URL.revokeObjectURL(url);},5000);
    recorder=null;
    this.classList.remove('recording');
    document.body.classList.remove('recording');
  }.bind(this);
  recorder.start();
  this.classList.add('recording');
  document.body.classList.add('recording');
});

$('panel-close').addEventListener('click',function(){
  document.body.classList.add('panel-off');
});
$('panel-open').addEventListener('click',function(){
  document.body.classList.remove('panel-off');
});

window.addEventListener('keydown',function(e){
  const t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA'))return;
  if(e.key===' '){
    e.preventDefault();
    engine.paused=!engine.paused;
    els.paused.textContent=engine.paused?'PAUSED':'';
  }else if(e.key==='r'||e.key==='R'){
    if(inst)inst.reset();
  }else if(e.key==='m'||e.key==='M'){
    if(inst&&inst.mutate){
      inst.mutate();
      buildControls();
    }
  }else if(e.key==='a'||e.key==='A'){
    $('btn-audio').click();
  }else if(e.key==='h'||e.key==='H'){
    document.body.classList.toggle('ui-hidden');
  }else if(e.key>='1'&&e.key<='9'){
    const d=P.sims[Number(e.key)-1];
    if(d)switchSim(d);
  }
});

P.sims.forEach(function(s,i){
  const b=document.createElement('button');
  b.dataset.id=s.id;
  const ic=document.createElement('i');
  ic.textContent=String(i+1);
  const tx=document.createElement('span');
  tx.textContent=s.name;
  b.appendChild(ic);
  b.appendChild(tx);
  b.addEventListener('click',function(){switchSim(s);});
  els.tabs.appendChild(b);
});

switchSim(P.sims[0]);
renderJar();

})();

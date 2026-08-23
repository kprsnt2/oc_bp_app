(function(){
'use strict';
const P=window.PRIM;

const IN=8,HID=6,OUT=2;
const W_IN=0;
const W_HID=IN*HID;
const W_OUT=W_HID+HID;
const W_BOUT=W_OUT+HID*OUT;
const GENOME=W_BOUT+OUT;

function randn(){
  let u=0,v=0;
  while(u===0)u=Math.random();
  while(v===0)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}

function randGenome(){
  const g=new Float32Array(GENOME);
  for(let i=0;i<GENOME;i++)g[i]=randn()*0.8;
  return g;
}

function mutateGenome(g,rate){
  const ng=new Float32Array(GENOME);
  for(let i=0;i<GENOME;i++){
    ng[i]=g[i];
    if(Math.random()<0.85)ng[i]+=randn()*rate;
    if(Math.random()<0.008)ng[i]=randn()*1.4;
  }
  return ng;
}

class Evolution{
  constructor(engine){
    this.engine=engine;
    this.definition=P.sims.find(s=>s.id==='evolution');
    this.p={};
    for(const s of this.definition.params)if(s.key)this.p[s.key]=s.value;
    this.critters=[];
    this.food=[];
    this.gen=0;
    this.births=0;
    this.deaths=0;
    this.pulse=0;
    this.history=[];
    this._acc=0;
    this._frame=0;
    this._hid=new Float32Array(HID);
    this._out=new Float32Array(OUT);
    this.statCanvas=null;
    this.reset();
  }
  spawn(parent){
    const w=this.engine.w,h=this.engine.h,p=this.p;
    const g=parent?mutateGenome(parent.g,p.mutation):randGenome();
    const c={
      x:parent?parent.x:Math.random()*w,
      y:parent?parent.y:Math.random()*h,
      dir:Math.random()*Math.PI*2,
      speed:p.maxSpeed*0.3,
      e:0,
      g:g,
      size:0.7+(1/(1+Math.exp(-g[0])))*0.9,
      hue:(((g[1]*97+g[2]*53)*57)%360+360)%360,
      age:0,
      cd:parent?1.6:0,
      gen:parent?parent.gen+1:0
    };
    if(c.gen>this.gen)this.gen=c.gen;
    return c;
  }
  spawnFood(x,y){
    const w=this.engine.w,h=this.engine.h;
    this.food.push({
      x:x!==undefined?x:Math.random()*w,
      y:y!==undefined?y:Math.random()*h
    });
    if(this.food.length>1500)this.food.splice(0,this.food.length-1500);
  }
  reset(){
    this.critters.length=0;
    this.food.length=0;
    this.gen=0;
    this.births=0;
    this.deaths=0;
    this.history.length=0;
    const cap=this.p.cap|0;
    for(let i=0;i<Math.min(cap,80);i++){
      const c=this.spawn(null);
      c.e=this.p.startEnergy;
      this.critters.push(c);
    }
    for(let i=0;i<240;i++)this.spawnFood();
  }
  think(c,inF,relF,dF,relC,dC,energyN){
    const g=c.g,hid=this._hid,out=this._out;
    const sC=relC===null?0:Math.sin(relC);
    const cC=relC===null?0:Math.cos(relC);
    const inp=[1,inF?Math.sin(relF):0,inF?Math.cos(relF):0,inF?dF:1,sC,cC,dC,energyN];
    for(let hh=0;hh<HID;hh++){
      let s=g[W_HID+hh];
      const off=W_IN+hh*IN;
      for(let ii=0;ii<IN;ii++)s+=g[off+ii]*inp[ii];
      hid[hh]=Math.tanh(s);
    }
    for(let oo=0;oo<OUT;oo++){
      let s=g[W_BOUT+oo];
      const off=W_OUT+oo*HID;
      for(let hh=0;hh<HID;hh++)s+=g[off+hh]*hid[hh];
      out[oo]=s;
    }
    return out;
  }
  step(dt){
    const p=this.p,w=this.engine.w,h=this.engine.h;
    const sdt=Math.min(dt,0.05);
    this._frame++;
    this._acc+=sdt*p.foodRate;
    while(this._acc>=1){
      this._acc--;
      this.spawnFood();
    }
    const inp=this.engine.input;
    if(inp&&inp.down&&inp.x>-1000){
      for(let i=0;i<3;i++)this.spawnFood(inp.x+P.rand(-26,26),inp.y+P.rand(-26,26));
    }
    const cs=this.critters,fs=this.food;
    const sense=p.sense,sense2=sense*sense,maxV=p.maxSpeed,repro=p.reproAt;
    const eScale=p.startEnergy/60;
    for(let ci=cs.length-1;ci>=0;ci--){
      const c=cs[ci];
      c.age+=sdt;
      c.cd-=sdt;
      let fd2=1e18,fiBest=-1,fa=0;
      for(let fi=0;fi<fs.length;fi++){
        const dx=fs[fi].x-c.x,dy=fs[fi].y-c.y;
        const d2=dx*dx+dy*dy;
        if(d2<fd2){
          fd2=d2;
          fiBest=fi;
          fa=Math.atan2(dy,dx);
        }
      }
      let cd2=1e18,cbest=null,ca=0;
      for(let oi=0;oi<cs.length;oi++){
        const o=cs[oi];
        if(o===c)continue;
        const dx=o.x-c.x,dy=o.y-c.y;
        const d2=dx*dx+dy*dy;
        if(d2<cd2){
          cd2=d2;
          cbest=o;
          ca=Math.atan2(dy,dx);
        }
      }
      const inF=fd2<sense2;
      const dF=inF?Math.sqrt(fd2)/sense:1;
      const relF=inF?fa-c.dir:0;
      const hasC=cd2<sense2;
      const dC=hasC?Math.min(1,Math.sqrt(cd2)/sense):1;
      const relC=hasC?ca-c.dir:null;
      const out=this.think(c,inF,relF,dF,relC,dC,P.clamp(c.e/(repro*2),0,1));
      const turn=Math.tanh(out[0])*3.4;
      const thr=1/(1+Math.exp(-out[1]));
      c.dir+=turn*sdt;
      const target=thr*maxV;
      c.speed+=(target-c.speed)*Math.min(1,sdt*4);
      c.x+=Math.cos(c.dir)*c.speed*sdt;
      c.y+=Math.sin(c.dir)*c.speed*sdt;
      if(c.x<0)c.x+=w;else if(c.x>=w)c.x-=w;
      if(c.y<0)c.y+=h;else if(c.y>=h)c.y-=h;
      c.e-=(0.7+2.3*(c.speed/maxV))*c.size*p.metabolism*sdt*eScale;
      const eatR=6+c.size*8;
      if(fiBest>=0&&fd2<eatR*eatR){
        fs.splice(fiBest,1);
        c.e+=p.startEnergy*0.38;
      }
      if(c.e>repro&&cs.length<p.cap&&c.cd<=0){
        c.cd=2;
        const ch=this.spawn(c);
        ch.e=c.e*0.45;
        c.e*=0.55;
        cs.push(ch);
        this.births++;
        this.pulse=1;
      }
      if(c.e<=0||(c.age>240&&Math.random()<sdt*0.5)){
        this.deaths++;
        this.pulse=1;
        if(Math.random()<0.3)this.spawnFood(c.x,c.y);
        cs.splice(ci,1);
      }
    }
    if(this._frame%15===0){
      let sp=0;
      for(const c of cs)sp+=c.speed;
      this.history.push([cs.length,sp/Math.max(1,cs.length)]);
      if(this.history.length>180)this.history.shift();
    }
    if(this.statCanvas&&this._frame%20===0)this.drawStats();
    this.pulse*=0.985;
  }
  draw(ctx){
    const e=this.engine,w=e.w,h=e.h,p=this.p;
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#04060a';
    ctx.fillRect(0,0,w,h);
    ctx.fillStyle='rgba(57,217,138,.85)';
    const fs=this.food;
    for(let i=0;i<fs.length;i++)ctx.fillRect(fs[i].x-1.3,fs[i].y-1.3,2.6,2.6);
    const cs=this.critters,repro=p.reproAt;
    for(let i=0;i<cs.length;i++){
      const c=cs[i];
      const ang=c.dir,ca=Math.cos(ang),sa=Math.sin(ang);
      const L=c.size*6,Wd=c.size*2.4;
      const alpha=P.clamp(0.3+c.e/(repro*0.7),0.3,1);
      ctx.fillStyle='hsla('+c.hue.toFixed(0)+',80%,58%,'+alpha.toFixed(2)+')';
      ctx.beginPath();
      ctx.moveTo(c.x+ca*L,c.y+sa*L);
      ctx.lineTo(c.x-ca*L*0.55-sa*Wd,c.y-sa*L*0.55+ca*Wd);
      ctx.lineTo(c.x-ca*L*0.55+sa*Wd,c.y-sa*L*0.55-ca*Wd);
      ctx.closePath();
      ctx.fill();
    }
    if(e.input&&e.input.down&&e.input.x>-1000){
      ctx.strokeStyle='rgba(57,217,138,.5)';
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.arc(e.input.x,e.input.y,26,0,6.2832);
      ctx.stroke();
    }
  }
  drawStats(){
    const cv=this.statCanvas;
    const g=cv.getContext('2d');
    const W=cv.width,H=cv.height;
    g.clearRect(0,0,W,H);
    g.strokeStyle='rgba(120,180,220,.15)';
    g.lineWidth=1;
    g.beginPath();
    g.moveTo(0,H-0.5);
    g.lineTo(W,H-0.5);
    g.stroke();
    const hist=this.history;
    if(hist.length<2)return;
    const cap=this.p.cap||240,maxV=this.p.maxSpeed;
    g.strokeStyle='rgba(89,242,199,.9)';
    g.beginPath();
    for(let i=0;i<hist.length;i++){
      const x=i/(hist.length-1)*W;
      const y=H-(hist[i][0]/cap)*(H-4)-2;
      if(i===0)g.moveTo(x,y);else g.lineTo(x,y);
    }
    g.stroke();
    g.strokeStyle='rgba(255,209,102,.55)';
    g.beginPath();
    for(let i=0;i<hist.length;i++){
      const x=i/(hist.length-1)*W;
      const y=H-(hist[i][1]/maxV)*(H-4)-2;
      if(i===0)g.moveTo(x,y);else g.lineTo(x,y);
    }
    g.stroke();
  }
  renderCustom(el){
    el.innerHTML='';
    const cv=document.createElement('canvas');
    cv.width=232;
    cv.height=86;
    cv.className='stat-canvas';
    el.appendChild(cv);
    this.statCanvas=cv;
    const note=document.createElement('div');
    note.className='mx-note';
    note.textContent='population \u00b7 average speed \u2014 watch lineages take over';
    el.appendChild(note);
    this.drawStats();
  }
  resize(){
    const w=this.engine.w,h=this.engine.h;
    for(const c of this.critters){
      if(c.x>=w)c.x=w-1;
      if(c.y>=h)c.y=h-1;
    }
  }
  mutate(){
    this.p.mutation=+P.clamp(this.p.mutation*1.35,0.02,0.7).toFixed(3);
    const cs=this.critters;
    for(let i=0;i<cs.length;i++){
      if(Math.random()<0.3){
        const wi=(Math.random()*GENOME)|0;
        cs[i].g[wi]+=randn()*0.6;
      }
    }
    this.pulse=1;
  }
  countEntity(){
    return this.critters.length+' critters \u00b7 gen '+this.gen;
  }
}

P.sims.push({
  id:'evolution',
  name:'EVOLUTION',
  accent:'#ff8f5e',
  hint:'drag = scatter food \u00b7 neural-net critters forage, breed and mutate \u2014 nobody designs them, selection does',
  params:[
    {key:'cap',label:'population cap',type:'slider',min:40,max:500,step:10,value:240,rebuild:true},
    {key:'foodRate',label:'food rain',type:'slider',min:5,max:120,step:1,value:45},
    {key:'mutation',label:'mutation rate',type:'slider',min:0.01,max:0.6,step:0.005,value:0.12},
    {key:'startEnergy',label:'starter energy',type:'slider',min:20,max:120,step:2,value:60},
    {key:'reproAt',label:'breed threshold',type:'slider',min:60,max:240,step:5,value:130},
    {key:'metabolism',label:'metabolism',type:'slider',min:0.2,max:3,step:0.05,value:1},
    {key:'sense',label:'vision range',type:'slider',min:40,max:320,step:5,value:170},
    {key:'maxSpeed',label:'max speed',type:'slider',min:20,max:160,step:5,value:90},
    {type:'custom',key:'stats'},
    {type:'button',label:'IRRADIATE',action:i=>i.mutate()}
  ],
  create:e=>new Evolution(e)
});
})();

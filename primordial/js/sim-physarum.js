(function(){
'use strict';
const P=window.PRIM;

const PALETTES={
  bioluminescence:[[0,'#020409'],[0.22,'#07293d'],[0.5,'#0fb8c9'],[0.78,'#9df4ff'],[1,'#ffffff']],
  rust:[[0,'#070403'],[0.3,'#4a100a'],[0.62,'#cf4a1c'],[0.86,'#ffb23e'],[1,'#fff3c4']],
  ghost:[[0,'#040507'],[0.55,'#5d7186'],[0.85,'#cfdce8'],[1,'#ffffff']],
  toxic:[[0,'#040208'],[0.35,'#2c0f8a'],[0.7,'#00e5b0'],[0.92,'#eaffd0'],[1,'#ffffff']]
};

function sample(m,w,h,x,y){
  let xi=x|0,yi=y|0;
  xi=((xi%w)+w)%w;
  yi=((yi%h)+h)%h;
  return m[xi+yi*w];
}

class Physarum{
  constructor(engine){
    this.engine=engine;
    this.definition=P.sims.find(s=>s.id==='physarum');
    this.p={};
    for(const s of this.definition.params)if(s.key)this.p[s.key]=s.value;
    this.lut=null;
    this.lutName='';
    this.reset();
  }
  alloc(){
    const e=this.engine;
    const sc=parseFloat(this.p.resolution)||0.35;
    this.mw=Math.max(64,(e.w*sc)|0);
    this.mh=Math.max(64,(e.h*sc)|0);
    this.map=new Float32Array(this.mw*this.mh);
    this.tmp=new Float32Array(this.mw*this.mh);
    this.img=new ImageData(this.mw,this.mh);
    this.off=document.createElement('canvas');
    this.off.width=this.mw;
    this.off.height=this.mh;
    this.octx=this.off.getContext('2d');
    this.scx=this.mw/e.w;
    this.scy=this.mh/e.h;
  }
  seedAgents(){
    const n=this.p.agents|0;
    const w=this.engine.w,h=this.engine.h;
    this.n=n;
    this.ag=new Float32Array(n*3);
    for(let i=0;i<n;i++){
      this.ag[i*3]=Math.random()*w;
      this.ag[i*3+1]=Math.random()*h;
      this.ag[i*3+2]=Math.random()*Math.PI*2;
    }
  }
  reset(){
    this.alloc();
    this.seedAgents();
  }
  getLut(){
    if(this.lut&&this.lutName===this.p.palette)return this.lut;
    const stops=PALETTES[this.p.palette]||PALETTES.bioluminescence;
    const lut=new Uint8ClampedArray(1024);
    for(let i=0;i<256;i++){
      const t=i/255;
      let a=stops[0],b=stops[stops.length-1];
      for(let s=0;s<stops.length-1;s++){
        if(t>=stops[s][0]&&t<=stops[s+1][0]){
          a=stops[s];
          b=stops[s+1];
          break;
        }
      }
      const span=(b[0]-a[0])||1;
      const f=(t-a[0])/span;
      const ca=P.hexRgb(a[1]),cb=P.hexRgb(b[1]);
      lut[i*4]=P.lerp(ca[0],cb[0],f);
      lut[i*4+1]=P.lerp(ca[1],cb[1],f);
      lut[i*4+2]=P.lerp(ca[2],cb[2],f);
      lut[i*4+3]=255;
    }
    this.lut=lut;
    this.lutName=this.p.palette;
    return lut;
  }
  diffuse(){
    const src=this.map,dst=this.tmp,w=this.mw,h=this.mh;
    for(let y=0;y<h;y++){
      const r=y*w;
      for(let x=0;x<w;x++){
        const l=x>0?src[r+x-1]:src[r+w-1];
        const rr=x<w-1?src[r+x+1]:src[r];
        dst[r+x]=(l*0.25+src[r+x]*0.5+rr*0.25);
      }
    }
    for(let x=0;x<w;x++){
      for(let y=0;y<h;y++){
        const u=y>0?dst[(y-1)*w+x]:dst[(h-1)*w+x];
        const d=y<h-1?dst[(y+1)*w+x]:dst[x];
        src[y*w+x]=(u*0.25+dst[y*w+x]*0.5+d*0.25);
      }
    }
  }
  paintFood(){
    const inp=this.engine.input;
    if(!inp||!inp.down||inp.x<-1000)return;
    const p=this.p,map=this.map,mw=this.mw,mh=this.mh;
    const cx=inp.x*this.scx,cy=inp.y*this.scy;
    const r=Math.max(2,p.brush*this.scx),r2=r*r;
    const x0=Math.max(0,(cx-r)|0),x1=Math.min(mw-1,(cx+r)|0);
    const y0=Math.max(0,(cy-r)|0),y1=Math.min(mh-1,(cy+r)|0);
    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        const dx=x-cx,dy=y-cy,d2=dx*dx+dy*dy;
        if(d2<r2)map[x+y*mw]+=30*(1-Math.sqrt(d2)/r);
      }
    }
  }
  step(){
    const e=this.engine,w=e.w,h=e.h,p=this.p;
    const mw=this.mw,mh=this.mh,map=this.map,ag=this.ag,n=this.n;
    const sa=p.sensorAngle*Math.PI/180,sd=p.sensorDist;
    const ta=p.turnAngle*Math.PI/180,ss=p.speed;
    const dep=p.deposit,scx=this.scx,scy=this.scy,decay=p.decay;
    this.paintFood();
    for(let i=0;i<n;i++){
      const o=i*3;
      let x=ag[o],y=ag[o+1],a=ag[o+2];
      const xc=x*scx,yc=y*scy;
      const fc=sample(map,mw,mh,xc+Math.cos(a)*sd,yc+Math.sin(a)*sd);
      const fl=sample(map,mw,mh,xc+Math.cos(a-sa)*sd,yc+Math.sin(a-sa)*sd);
      const fr=sample(map,mw,mh,xc+Math.cos(a+sa)*sd,yc+Math.sin(a+sa)*sd);
      if(fc>fl&&fc>fr){
        a+=(Math.random()-0.5)*ta*0.3;
      }else if(fl>fr){
        a-=ta*(0.6+Math.random()*0.8);
      }else if(fr>fl){
        a+=ta*(0.6+Math.random()*0.8);
      }else{
        a+=(Math.random()-0.5)*ta;
      }
      x+=Math.cos(a)*ss;
      y+=Math.sin(a)*ss;
      if(x<0)x+=w;else if(x>=w)x-=w;
      if(y<0)y+=h;else if(y>=h)y-=h;
      ag[o]=x;
      ag[o+1]=y;
      ag[o+2]=a;
      map[((y*scy)|0)*mw+((x*scx)|0)]+=dep;
    }
    this.diffuse();
    for(let i=0;i<map.length;i++)map[i]*=decay;
  }
  render(ctx){
    const lut=this.getLut();
    const d=this.img.data,map=this.map,gain=this.p.gain;
    for(let i=0,j=0;i<map.length;i++,j+=4){
      let t=map[i]*gain;
      t=t>1?1:t<0?0:t;
      const li=((t*255)|0)*4;
      d[j]=lut[li];
      d[j+1]=lut[li+1];
      d[j+2]=lut[li+2];
      d[j+3]=255;
    }
    this.octx.putImageData(this.img,0,0);
    const w=this.engine.w,h=this.engine.h;
    ctx.globalCompositeOperation='source-over';
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(this.off,0,0,this.mw,this.mh,0,0,w,h);
  }
  draw(ctx){
    this.render(ctx);
  }
  resize(){
    this.reset();
  }
  mutate(){
    this.p.sensorAngle=Math.round(P.rand(10,50));
    this.p.sensorDist=Math.round(P.rand(4,26));
    this.p.turnAngle=Math.round(P.rand(12,55));
    this.p.decay=+P.rand(0.88,0.975).toFixed(3);
    this.p.palette=P.pick(Object.keys(PALETTES));
  }
  countEntity(){
    return this.n+' agents';
  }
}

P.sims.push({
  id:'physarum',
  name:'PHYSARUM',
  accent:'#4cc9f0',
  hint:'drag = drip nutrient \u00b7 a mindless slime mould weaves transport networks that remember where food has been',
  params:[
    {key:'agents',label:'agents',type:'slider',min:5000,max:150000,step:5000,value:45000,rebuild:true},
    {key:'resolution',label:'trail resolution',type:'select',value:'0.35',rebuild:true,options:[
      {label:'coarse',value:'0.22'},
      {label:'standard',value:'0.35'},
      {label:'fine',value:'0.5'}
    ]},
    {key:'sensorAngle',label:'sensor angle',type:'slider',min:5,max:70,step:1,value:24},
    {key:'sensorDist',label:'sensor reach',type:'slider',min:2,max:40,step:1,value:11},
    {key:'turnAngle',label:'turn rate',type:'slider',min:2,max:60,step:1,value:30},
    {key:'speed',label:'stride',type:'slider',min:0.3,max:4,step:0.05,value:1.1},
    {key:'deposit',label:'deposit',type:'slider',min:1,max:24,step:0.5,value:6},
    {key:'decay',label:'evaporation',type:'slider',min:0.82,max:0.985,step:0.001,value:0.94},
    {key:'gain',label:'exposure',type:'slider',min:0.02,max:0.5,step:0.005,value:0.09},
    {key:'brush',label:'nutrient brush',type:'slider',min:4,max:40,step:1,value:16},
    {key:'palette',label:'palette',type:'select',value:'bioluminescence',options:[
      {label:'bioluminescence',value:'bioluminescence'},
      {label:'rust',value:'rust'},
      {label:'ghost',value:'ghost'},
      {label:'toxic',value:'toxic'}
    ]},
    {type:'button',label:'RESEED COLONY',action:i=>i.seedAgents()}
  ],
  create:e=>new Physarum(e)
});
})();

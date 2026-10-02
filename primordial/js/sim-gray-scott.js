(function(){
'use strict';
const P=window.PRIM;

const PRESETS={
  'coral':{f:0.0545,k:0.062},
  'mitosis':{f:0.0367,k:0.0649},
  'worms':{f:0.058,k:0.065},
  'u-skate':{f:0.062,k:0.0609},
  'solitons':{f:0.03,k:0.062}
};

function buildLut(stops){
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
  return lut;
}

const PETRI=[[0,'#030507'],[0.3,'#0d3b4f'],[0.6,'#31d9c6'],[0.85,'#c9fff2'],[1,'#ffffff']];

class GrayScott{
  constructor(engine){
    this.engine=engine;
    this.definition=P.sims.find(s=>s.id==='gray-scott');
    this.p={};
    for(const s of this.definition.params)if(s.key)this.p[s.key]=s.value;
    this.lut=buildLut(PETRI);
    this.reset();
  }
  alloc(){
    const e=this.engine;
    const sc=parseFloat(this.p.resolution)||0.26;
    this.gw=Math.max(48,(e.w*sc)|0);
    this.gh=Math.max(48,(e.h*sc)|0);
    const N=this.gw*this.gh;
    this.A=new Float32Array(N).fill(1);
    this.B=new Float32Array(N);
    this.AN=new Float32Array(N);
    this.BN=new Float32Array(N);
    this.img=new ImageData(this.gw,this.gh);
    this.off=document.createElement('canvas');
    this.off.width=this.gw;
    this.off.height=this.gh;
    this.octx=this.off.getContext('2d');
  }
  seedPattern(){
    const B=this.B,gw=this.gw,gh=this.gh;
    B.fill(0);
    const blobs=Math.round(gw*gh/9000)+10;
    for(let b=0;b<blobs;b++){
      const cx=Math.random()*gw,cy=Math.random()*gh;
      const r=P.rand(2.5,7),r2=r*r;
      const x0=Math.max(1,(cx-r)|0),x1=Math.min(gw-2,(cx+r)|0);
      const y0=Math.max(1,(cy-r)|0),y1=Math.min(gh-2,(cy+r)|0);
      for(let y=y0;y<=y1;y++){
        for(let x=x0;x<=x1;x++){
          const dx=x-cx,dy=y-cy;
          if(dx*dx+dy*dy<r2)B[x+y*gw]=1;
        }
      }
    }
    for(let d=0;d<40;d++){
      B[(1+((Math.random()*(gw-2))|0))+(1+((Math.random()*(gh-2))|0))*gw]=1;
    }
  }
  reset(){
    this.alloc();
    this.seedPattern();
  }
  paint(){
    const inp=this.engine.input;
    if(!inp||!inp.down||inp.x<-1000)return;
    const p=this.p,B=this.B,gw=this.gw,gh=this.gh,e=this.engine;
    const sc=gw/e.w;
    const cx=inp.x*sc,cy=inp.y*sc;
    const r=Math.max(1.5,p.brush*sc),r2=r*r;
    const x0=Math.max(1,(cx-r)|0),x1=Math.min(gw-2,(cx+r)|0);
    const y0=Math.max(1,(cy-r)|0),y1=Math.min(gh-2,(cy+r)|0);
    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        const dx=x-cx,dy=y-cy;
        if(dx*dx+dy*dy<r2)B[x+y*gw]=1;
      }
    }
  }
  step(){
    const p=this.p;
    this.paint();
    let A=this.A,B=this.B,AN=this.AN,BN=this.BN;
    const gw=this.gw,gh=this.gh;
    const f=p.feed,k=p.kill,steps=p.steps|0;
    for(let s=0;s<steps;s++){
      for(let y=1;y<gh-1;y++){
        const r=y*gw;
        for(let x=1;x<gw-1;x++){
          const i=r+x;
          const a=A[i],b=B[i];
          const la=0.2*(A[i-1]+A[i+1]+A[i-gw]+A[i+gw])+0.05*(A[i-gw-1]+A[i-gw+1]+A[i+gw-1]+A[i+gw+1])-a;
          const lb=0.2*(B[i-1]+B[i+1]+B[i-gw]+B[i+gw])+0.05*(B[i-gw-1]+B[i-gw+1]+B[i+gw-1]+B[i+gw+1])-b;
          const ab2=a*b*b;
          let na=a+(la-ab2+f*(1-a));
          let nb=b+(lb*0.5+ab2-(k+f)*b);
          AN[i]=na<0?0:na>1?1:na;
          BN[i]=nb<0?0:nb>1?1:nb;
        }
      }
      const tA=A;A=AN;AN=tA;
      const tB=B;B=BN;BN=tB;
    }
    this.A=A;
    this.B=B;
    this.AN=AN;
    this.BN=BN;
  }
  render(ctx){
    const B=this.B,lut=this.lut,gain=this.p.gain;
    const d=this.img.data,N=this.gw*this.gh;
    for(let i=0,j=0;i<N;i++,j+=4){
      let t=B[i]*gain;
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
    ctx.drawImage(this.off,0,0,this.gw,this.gh,0,0,w,h);
  }
  draw(ctx){
    this.render(ctx);
  }
  resize(){
    this.reset();
  }
  applyPreset(name){
    const pr=PRESETS[name];
    if(pr){
      this.p.feed=pr.f;
      this.p.kill=pr.k;
    }
  }
  mutate(){
    this.p.feed=+P.clamp(this.p.feed+P.rand(-0.006,0.006),0.01,0.085).toFixed(4);
    this.p.kill=+P.clamp(this.p.kill+P.rand(-0.003,0.003),0.03,0.072).toFixed(4);
  }
  countEntity(){
    return (this.gw*this.gh)+' cells';
  }
}

P.sims.push({
  id:'gray-scott',
  name:'GRAY\u2013SCOTT',
  accent:'#c77dff',
  hint:'drag = paint reactant \u00b7 two virtual chemicals eat and feed each other into coral, cells and crawling worms',
  params:[
    {key:'preset',label:'specimen recipe',type:'select',value:'coral',options:[
      {label:'coral',value:'coral'},
      {label:'mitosis',value:'mitosis'},
      {label:'worms',value:'worms'},
      {label:'u-skate',value:'u-skate'},
      {label:'solitons',value:'solitons'},
      {label:'custom',value:'custom'}
    ],apply:(inst,v)=>inst.applyPreset(v)},
    {key:'feed',label:'feed rate',type:'slider',min:0.005,max:0.09,step:0.0005,value:0.0545},
    {key:'kill',label:'kill rate',type:'slider',min:0.03,max:0.075,step:0.0005,value:0.062},
    {key:'steps',label:'sim speed',type:'slider',min:1,max:14,step:1,value:8},
    {key:'resolution',label:'grid resolution',type:'select',value:'0.26',rebuild:true,options:[
      {label:'coarse',value:'0.18'},
      {label:'standard',value:'0.26'},
      {label:'fine',value:'0.38'}
    ]},
    {key:'brush',label:'brush size',type:'slider',min:4,max:40,step:1,value:14},
    {key:'gain',label:'exposure',type:'slider',min:1,max:8,step:0.25,value:3.5},
    {type:'button',label:'RESEED DISH',action:i=>i.seedPattern()}
  ],
  create:e=>new GrayScott(e)
});
})();

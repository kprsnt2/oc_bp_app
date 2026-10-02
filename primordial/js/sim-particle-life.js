(function(){
'use strict';
const P=window.PRIM;

const COLORS=['#59f2c7','#ff4d8d','#ffd166','#7aa2ff','#c77dff','#4cc9f0','#f4a261','#a3e635'];
const CYCLE=[-1,-0.5,0,0.5,1];

function mxColor(v){
  if(v>0)return 'rgba(89,242,199,'+(0.12+0.78*v).toFixed(2)+')';
  if(v<0)return 'rgba(255,77,141,'+(0.12+0.78*(-v)).toFixed(2)+')';
  return 'rgba(120,140,170,.10)';
}
function fmtV(v){
  if(v===0)return '';
  const a=Math.abs(v);
  return (v>0?'+':'-')+(a<1?String(a).slice(1):String(a));
}

class ParticleLife{
  constructor(engine){
    this.engine=engine;
    this.definition=P.sims.find(s=>s.id==='particle-life');
    this.p={};
    for(const s of this.definition.params)if(s.key)this.p[s.key]=s.value;
    this.K=0;
    this.matrix=null;
    this._h=null;
    this._n=null;
    this.reset();
  }
  randomizeMatrix(){
    const K=this.K||this.p.species|0;
    const m=new Float32Array(K*K);
    for(let i=0;i<m.length;i++)m[i]=Math.random()*2-1;
    this.matrix=m;
  }
  zeroMatrix(){
    this.matrix=new Float32Array(this.K*this.K);
  }
  buildSprites(K){
    return COLORS.slice(0,K).map(hex=>{
      const c=document.createElement('canvas');
      c.width=c.height=64;
      const g=c.getContext('2d');
      const rgb=P.hexRgb(hex);
      const grad=g.createRadialGradient(32,32,0,32,32,32);
      grad.addColorStop(0,'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',1)');
      grad.addColorStop(0.25,'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.55)');
      grad.addColorStop(1,'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0)');
      g.fillStyle=grad;
      g.fillRect(0,0,64,64);
      return c;
    });
  }
  reset(){
    const n=this.p.count|0;
    const K=this.p.species|0;
    if(!this.matrix||this.K!==K){
      this.K=K;
      this.randomizeMatrix();
    }
    const w=this.engine.w,h=this.engine.h;
    this.n=n;
    this.px=new Float32Array(n);
    this.py=new Float32Array(n);
    this.vx=new Float32Array(n);
    this.vy=new Float32Array(n);
    this.sp=new Uint8Array(n);
    for(let i=0;i<n;i++){
      this.px[i]=Math.random()*w;
      this.py[i]=Math.random()*h;
      this.sp[i]=(Math.random()*K)|0;
    }
    this.sprites=this.buildSprites(K);
  }
  step(dt){
    const e=this.engine,w=e.w,h=e.h,p=this.p;
    const sdt=Math.min(dt,0.05)*60*p.warp;
    const R=p.radius,R2=R*R,beta=R*0.3,inBeta=1/beta;
    const n=this.n,m=this.matrix,K=this.K;
    const px=this.px,py=this.py,vx=this.vx,vy=this.vy,sp=this.sp;
    const gw=Math.max(1,Math.ceil(w/R)),gh=Math.max(1,Math.ceil(h/R)),cells=gw*gh;
    let heads=this._h,nxt=this._n;
    if(!heads||heads.length!==cells)heads=this._h=new Int32Array(cells);
    if(!nxt||nxt.length<n)nxt=this._n=new Int32Array(n);
    heads.fill(-1);
    const cw=w/gw,ch=h/gh;
    for(let i=0;i<n;i++){
      let gx=(px[i]/cw)|0,gy=(py[i]/ch)|0;
      if(gx>=gw)gx=gw-1;else if(gx<0)gx=0;
      if(gy>=gh)gy=gh-1;else if(gy<0)gy=0;
      const ci=gx+gy*gw;
      nxt[i]=heads[ci];
      heads[ci]=i;
    }
    const damp=Math.pow(p.friction,sdt);
    const accel=8*p.force*sdt;
    for(let i=0;i<n;i++){
      const xi=px[i],yi=py[i],si=sp[i];
      let gx=(xi/cw)|0,gy=(yi/ch)|0;
      if(gx>=gw)gx=gw-1;else if(gx<0)gx=0;
      if(gy>=gh)gy=gh-1;else if(gy<0)gy=0;
      let fx=0,fy=0;
      for(let oy=-1;oy<=1;oy++){
        let yy=gy+oy;
        if(yy<0)yy+=gh;else if(yy>=gh)yy-=gh;
        const row=yy*gw;
        for(let ox=-1;ox<=1;ox++){
          let xx=gx+ox;
          if(xx<0)xx+=gw;else if(xx>=gw)xx-=gw;
          let j=heads[xx+row];
          while(j!==-1){
            if(j!==i){
              let dx=px[j]-xi,dy=py[j]-yi;
              if(dx>w*0.5)dx-=w;else if(dx<-w*0.5)dx+=w;
              if(dy>h*0.5)dy-=h;else if(dy<-h*0.5)dy+=h;
              const d2=dx*dx+dy*dy;
              if(d2<R2&&d2>1e-6){
                const d=Math.sqrt(d2);
                let f;
                if(d<beta)f=d*inBeta-1;
                else f=m[si*K+sp[j]]*(1-Math.abs(2*d-beta-R)/(R-beta));
                fx+=f*dx/d;
                fy+=f*dy/d;
              }
            }
            j=nxt[j];
          }
        }
      }
      vx[i]=(vx[i]+fx*accel)*damp;
      vy[i]=(vy[i]+fy*accel)*damp;
    }
    const inp=e.input;
    const well=inp&&inp.down?(inp.alt?-2600:2600):0;
    const wx=well?inp.x:0,wy=well?inp.y:0;
    const WR2=260*260;
    for(let i=0;i<n;i++){
      let x=px[i]+vx[i]*sdt,y=py[i]+vy[i]*sdt;
      if(x<0)x+=w;else if(x>=w)x-=w;
      if(y<0)y+=h;else if(y>=h)y-=h;
      px[i]=x;
      py[i]=y;
      if(well){
        const dx=wx-x,dy=wy-y,d2=dx*dx+dy*dy;
        if(d2<WR2&&d2>16){
          const d=Math.sqrt(d2),g=well*sdt/d;
          vx[i]+=dx*g;
          vy[i]+=dy*g;
        }
      }
    }
  }
  draw(ctx){
    const e=this.engine,w=e.w,h=e.h,p=this.p;
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(4,6,10,'+(1-p.trail).toFixed(3)+')';
    ctx.fillRect(0,0,w,h);
    const dsz=6+p.size*4,hs=dsz/2;
    const px=this.px,py=this.py,sp=this.sp,spr=this.sprites;
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<this.n;i++)ctx.drawImage(spr[sp[i]],px[i]-hs,py[i]-hs,dsz,dsz);
    ctx.globalCompositeOperation='source-over';
    if(e.input&&e.input.down&&e.input.x>-1000){
      ctx.strokeStyle=e.input.alt?'rgba(255,77,141,.45)':'rgba(89,242,199,.45)';
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.arc(e.input.x,e.input.y,260,0,6.2832);
      ctx.stroke();
    }
  }
  resize(){
    const w=this.engine.w,h=this.engine.h;
    for(let i=0;i<this.n;i++){
      if(this.px[i]>=w)this.px[i]=w-1;
      if(this.py[i]>=h)this.py[i]=h-1;
    }
  }
  mutate(){
    this.randomizeMatrix();
    this.p.force=+P.rand(0.3,2).toFixed(2);
    this.p.friction=+P.rand(0.12,0.75).toFixed(2);
    this.p.radius=Math.round(P.rand(30,110));
  }
  serialize(){
    return {matrix:Array.from(this.matrix)};
  }
  applyExtra(o){
    if(o&&o.matrix){
      const K=Math.round(Math.sqrt(o.matrix.length));
      if(K===this.K)this.matrix=Float32Array.from(o.matrix);
    }
  }
  countEntity(){
    return this.n+' particles';
  }
  renderCustom(el){
    el.innerHTML='';
    const K=this.K,m=this.matrix;
    const grid=document.createElement('div');
    grid.className='mx-grid';
    grid.style.gridTemplateColumns='repeat('+K+',1fr)';
    for(let r=0;r<K;r++){
      for(let c=0;c<K;c++){
        const idx=r*K+c;
        const cell=document.createElement('div');
        cell.className='mx-cell';
        cell.title='species '+(r+1)+' pulled by species '+(c+1);
        const paint=()=>{
          const v=m[idx];
          cell.style.background=mxColor(v);
          cell.textContent=fmtV(v);
        };
        cell.addEventListener('pointerdown',ev=>{
          ev.preventDefault();
          const ci=CYCLE.indexOf(m[idx]);
          m[idx]=CYCLE[(ci+1)%CYCLE.length];
          paint();
        });
        paint();
        grid.appendChild(cell);
      }
    }
    el.appendChild(grid);
    const note=document.createElement('div');
    note.className='mx-note';
    note.textContent='row is pulled by column \u00b7 click a cell to cycle its force';
    el.appendChild(note);
  }
}

P.sims.push({
  id:'particle-life',
  name:'PARTICLE LIFE',
  accent:'#59f2c7',
  hint:'drag = gravity well \u00b7 alt / right-drag = repulse \u00b7 tune the attraction matrix to breed new chemistries',
  params:[
    {key:'count',label:'particles',type:'slider',min:500,max:12000,step:250,value:3500,rebuild:true},
    {key:'species',label:'species',type:'slider',min:2,max:8,step:1,value:6,rebuild:true},
    {key:'radius',label:'sense radius',type:'slider',min:20,max:160,step:2,value:64},
    {key:'force',label:'force scale',type:'slider',min:0.1,max:4,step:0.05,value:1},
    {key:'friction',label:'drag',type:'slider',min:0.05,max:0.95,step:0.01,value:0.5},
    {key:'warp',label:'time warp',type:'slider',min:0.2,max:2.5,step:0.05,value:1},
    {key:'size',label:'glow',type:'slider',min:0.5,max:6,step:0.25,value:2.5},
    {key:'trail',label:'afterglow',type:'slider',min:0,max:0.95,step:0.01,value:0.65},
    {type:'button',label:'MUTATE MATRIX',action:i=>i.randomizeMatrix()},
    {type:'button',label:'STILL POINT',action:i=>i.zeroMatrix()},
    {type:'custom',key:'matrix'}
  ],
  create:e=>new ParticleLife(e)
});
})();

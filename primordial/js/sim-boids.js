(function(){
'use strict';
const P=window.PRIM;

class Boids{
  constructor(engine){
    this.engine=engine;
    this.definition=P.sims.find(s=>s.id==='boids');
    this.p={};
    for(const s of this.definition.params)if(s.key)this.p[s.key]=s.value;
    this._h=null;
    this._n=null;
    this.reset();
  }
  reset(){
    const n=this.p.count|0;
    const w=this.engine.w,h=this.engine.h;
    const ms=this.p.maxSpeed;
    this.n=n;
    this.px=new Float32Array(n);
    this.py=new Float32Array(n);
    this.vx=new Float32Array(n);
    this.vy=new Float32Array(n);
    for(let i=0;i<n;i++){
      this.px[i]=Math.random()*w;
      this.py[i]=Math.random()*h;
      const a=Math.random()*Math.PI*2,s=ms*(0.5+Math.random()*0.5);
      this.vx[i]=Math.cos(a)*s;
      this.vy[i]=Math.sin(a)*s;
    }
  }
  step(dt){
    const e=this.engine,w=e.w,h=e.h,p=this.p,n=this.n;
    const px=this.px,py=this.py,vx=this.vx,vy=this.vy;
    const pr=p.perception,pr2=pr*pr,sr=p.sepRadius,sr2=sr*sr;
    const ms=p.maxSpeed,maxF=ms*4;
    const sdt=Math.min(dt,0.05);
    const gw=Math.max(1,Math.ceil(w/pr)),gh=Math.max(1,Math.ceil(h/pr)),cells=gw*gh;
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
    const wrap=p.edges==='wrap';
    const inp=e.input;
    const feed=inp&&inp.down&&!inp.alt&&inp.x>-1000;
    const fx=feed?inp.x:0,fy=feed?inp.y:0;
    for(let i=0;i<n;i++){
      const xi=px[i],yi=py[i];
      let gx=(xi/cw)|0,gy=(yi/ch)|0;
      if(gx>=gw)gx=gw-1;else if(gx<0)gx=0;
      if(gy>=gh)gy=gh-1;else if(gy<0)gy=0;
      let axs=0,ays=0,cxs=0,cys=0,sxs=0,sys=0,cnt=0,scnt=0;
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
              const d2=dx*dx+dy*dy;
              if(d2<pr2){
                axs+=vx[j];
                ays+=vy[j];
                cxs+=px[j];
                cys+=py[j];
                cnt++;
                if(d2<sr2&&d2>1e-4){
                  const d=Math.sqrt(d2);
                  sxs+=dx/d*(1-d/sr);
                  sys+=dy/d*(1-d/sr);
                  scnt++;
                }
              }
            }
            j=nxt[j];
          }
        }
      }
      let ax=0,ay=0;
      if(cnt){
        let alx=axs/cnt,aly=ays/cnt;
        let al=Math.sqrt(alx*alx+aly*aly)||1;
        alx=alx/al*ms-vx[i];
        aly=aly/al*ms-vy[i];
        ax+=alx*p.ali;
        ay+=aly*p.ali;
        let cx=cxs/cnt-xi,cy=cys/cnt-yi;
        let cl=Math.sqrt(cx*cx+cy*cy)||1;
        cx=cx/cl*ms-vx[i];
        cy=cy/cl*ms-vy[i];
        ax+=cx*p.coh;
        ay+=cy*p.coh;
      }
      if(scnt){
        let sx=sxs/scnt,sy=sys/scnt;
        let sl=Math.sqrt(sx*sx+sy*sy)||1;
        sx=sx/sl*ms-vx[i];
        sy=sy/sl*ms-vy[i];
        ax+=sx*p.sep;
        ay+=sy*p.sep;
      }
      if(feed){
        const dx=fx-xi,dy=fy-yi,d2=dx*dx+dy*dy;
        if(d2<300*300&&d2>25){
          const d=Math.sqrt(d2);
          ax+=(dx/d*ms-vx[i])*1.4;
          ay+=(dy/d*ms-vy[i])*1.4;
        }
      }
      const am=Math.sqrt(ax*ax+ay*ay);
      if(am>maxF){
        ax=ax/am*maxF;
        ay=ay/am*maxF;
      }
      vx[i]+=ax*sdt;
      vy[i]+=ay*sdt;
      const spd=Math.sqrt(vx[i]*vx[i]+vy[i]*vy[i])||1;
      const cl=P.clamp(spd,ms*0.35,ms);
      vx[i]*=cl/spd;
      vy[i]*=cl/spd;
      px[i]+=vx[i]*sdt;
      py[i]+=vy[i]*sdt;
      if(wrap){
        if(px[i]<0)px[i]+=w;else if(px[i]>=w)px[i]-=w;
        if(py[i]<0)py[i]+=h;else if(py[i]>=h)py[i]-=h;
      }else{
        if(px[i]<6&&vx[i]<0)vx[i]=-vx[i];else if(px[i]>w-6&&vx[i]>0)vx[i]=-vx[i];
        if(py[i]<6&&vy[i]<0)vy[i]=-vy[i];else if(py[i]>h-6&&vy[i]>0)vy[i]=-vy[i];
        if(px[i]<0)px[i]=0;else if(px[i]>=w)px[i]=w-1;
        if(py[i]<0)py[i]=0;else if(py[i]>=h)py[i]=h-1;
      }
    }
  }
  draw(ctx){
    const e=this.engine,w=e.w,h=e.h,p=this.p;
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(4,6,10,'+(1-p.trail).toFixed(3)+')';
    ctx.fillRect(0,0,w,h);
    const px=this.px,py=this.py,vx=this.vx,vy=this.vy;
    const sz=p.size,L=sz*2.2,Wd=sz*0.85;
    const byHeading=p.hue==='heading';
    for(let i=0;i<this.n;i++){
      const ang=Math.atan2(vy[i],vx[i]);
      const ca=Math.cos(ang),sa=Math.sin(ang);
      const x=px[i],y=py[i];
      const hue=byHeading?((ang*57.2958)+360)%360:(i*222.5)%360;
      ctx.fillStyle='hsl('+hue.toFixed(0)+',85%,60%)';
      ctx.beginPath();
      ctx.moveTo(x+ca*L,y+sa*L);
      ctx.lineTo(x-ca*L*0.55-sa*Wd,y-sa*L*0.55+ca*Wd);
      ctx.lineTo(x-ca*L*0.55+sa*Wd,y-sa*L*0.55-ca*Wd);
      ctx.closePath();
      ctx.fill();
    }
    if(e.input&&e.input.down&&!e.input.alt&&e.input.x>-1000){
      ctx.strokeStyle='rgba(89,242,199,.45)';
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.arc(e.input.x,e.input.y,300,0,6.2832);
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
    this.p.sep=+P.rand(0.4,2.4).toFixed(2);
    this.p.ali=+P.rand(0.3,2).toFixed(2);
    this.p.coh=+P.rand(0.3,2).toFixed(2);
    this.p.perception=Math.round(P.rand(24,80));
  }
  countEntity(){
    return this.n+' boids';
  }
}

P.sims.push({
  id:'boids',
  name:'BOIDS',
  accent:'#ffd166',
  hint:'drag = feeder beacon \u00b7 three rules, one mind: separate, align, cohere',
  params:[
    {key:'count',label:'flock size',type:'slider',min:100,max:3000,step:50,value:800,rebuild:true},
    {key:'perception',label:'perception',type:'slider',min:12,max:120,step:2,value:48},
    {key:'sepRadius',label:'personal space',type:'slider',min:6,max:40,step:1,value:20},
    {key:'sep',label:'separation',type:'slider',min:0,max:3,step:0.05,value:1.5},
    {key:'ali',label:'alignment',type:'slider',min:0,max:3,step:0.05,value:1},
    {key:'coh',label:'cohesion',type:'slider',min:0,max:3,step:0.05,value:0.9},
    {key:'maxSpeed',label:'max speed',type:'slider',min:40,max:300,step:5,value:150},
    {key:'size',label:'body size',type:'slider',min:1,max:6,step:0.25,value:2.6},
    {key:'trail',label:'afterglow',type:'slider',min:0,max:0.95,step:0.01,value:0.35},
    {key:'edges',label:'edges',type:'select',value:'wrap',options:[
      {label:'toroidal',value:'wrap'},
      {label:'walls',value:'bounce'}
    ]},
    {key:'hue',label:'colouring',type:'select',value:'heading',options:[
      {label:'by heading',value:'heading'},
      {label:'golden dust',value:'golden'}
    ]}
  ],
  create:e=>new Boids(e)
});
})();

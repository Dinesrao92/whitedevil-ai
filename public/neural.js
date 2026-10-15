/* Decorative, locally rendered visualization. No telemetry or external assets. */
(() => {
  'use strict';
  const canvas = document.getElementById('neural-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const toggle = document.getElementById('motion-toggle');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches, visible = true, frame = 0, last = 0, time = 0;
  let width = 0, height = 0, scale = 1;
  // Hand-shaped cortical folds keep the silhouette anatomical rather than spherical.
  const folds = [
    [[-12,-99],[-35,-111],[-57,-106],[-65,-92],[-56,-77],[-35,-74],[-24,-61],[-31,-48]],
    [[-70,-96],[-88,-88],[-100,-68],[-91,-54],[-72,-55],[-60,-39],[-65,-21]],
    [[-106,-61],[-120,-40],[-112,-20],[-91,-17],[-80,-4],[-89,10],[-106,9]],
    [[-111,20],[-105,43],[-86,50],[-70,38],[-67,20],[-49,16],[-34,31]],
    [[-83,59],[-66,74],[-47,72],[-38,57],[-20,51],[-13,32]],
    [[-11,-83],[-16,-64],[-11,-46],[-23,-29],[-21,-8],[-13,6],[-16,21]],
    [[-48,-64],[-42,-49],[-49,-34],[-42,-16],[-49,1],[-35,11]],
    [[-79,-41],[-87,-34],[-78,-21],[-61,-12],[-61,3]],
    [[-28,-98],[-41,-92],[-44,-83]],
    [[-98,29],[-85,23],[-79,31]],
    [[-58,49],[-51,39],[-41,44]],
    [[-33,69],[-24,80],[-14,67]]
  ];
  function curve(points) {
    const result=[];
    for(let i=0;i<points.length-1;i++){
      const a=points[Math.max(0,i-1)], b=points[i], c=points[i+1], d=points[Math.min(points.length-1,i+2)];
      for(let j=0;j<12;j++){
        const t=j/12,t2=t*t,t3=t2*t;
        result.push([.5*((2*b[0])+(-a[0]+c[0])*t+(2*a[0]-5*b[0]+4*c[0]-d[0])*t2+(-a[0]+3*b[0]-3*c[0]+d[0])*t3),.5*((2*b[1])+(-a[1]+c[1])*t+(2*a[1]-5*b[1]+4*c[1]-d[1])*t2+(-a[1]+3*b[1]-3*c[1]+d[1])*t3)]);
      }
    }
    result.push(points[points.length-1]);return result;
  }
  const lines=[];
  for(const side of [1,-1]) folds.forEach((points,i)=>lines.push({points:curve(points.map(([x,y])=>[x*side,y+(side===-1?Math.sin(i*2)*3:0)])),side,index:i}));
  const boundary=curve([[-9,79],[-25,85],[-43,79],[-64,78],[-84,64],[-101,54],[-112,35],[-121,20],[-122,-1],[-128,-20],[-121,-43],[-113,-62],[-103,-81],[-86,-96],[-65,-107],[-44,-117],[-22,-114],[-9,-104],[-7,-74],[-8,-38],[-6,-4],[-8,33],[-9,79]]);
  function path(points,side=1,offset=0){ctx.beginPath();points.forEach(([x,y],i)=>{const px=x*side+offset,py=y; i?ctx.lineTo(px,py):ctx.moveTo(px,py);});}
  function dot(x,y,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  function draw(){
    ctx.clearRect(0,0,width,height);
    if(!width||!height)return;
    const cx=width*.5,cy=Math.min(height*.42,194), t=time*.001;
    ctx.save();ctx.translate(cx,cy);ctx.scale(scale,scale);
    const halo=ctx.createRadialGradient(0,-15,5,0,-15,175);
    halo.addColorStop(0,'rgba(104,62,222,.17)');halo.addColorStop(.65,'rgba(91,63,182,.07)');halo.addColorStop(1,'rgba(52,36,100,0)');ctx.fillStyle=halo;ctx.fillRect(-180,-180,360,360);
    // A quiet projection plinth grounds the floating brain.
    for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(0,116+i*5,112-i*19,19-i*3,0,0,Math.PI*2);ctx.strokeStyle=`rgba(136,101,238,${.15-i*.025})`;ctx.lineWidth=.7;ctx.stroke();}
    ctx.beginPath();ctx.ellipse(0,116,112,19,0,t*.12,t*.12+1.1);ctx.strokeStyle='rgba(169,133,255,.55)';ctx.lineWidth=1.2;ctx.stroke();
    ctx.save();ctx.translate(Math.sin(t*.21)*2,Math.sin(t*.7)*3);ctx.rotate(Math.sin(t*.25)*.012);
    for(const side of [1,-1]){
      path(boundary,side);ctx.closePath();const fill=ctx.createLinearGradient(-130,-100,130,80);fill.addColorStop(0,'rgba(72,91,209,.07)');fill.addColorStop(.52,'rgba(135,78,233,.13)');fill.addColorStop(1,'rgba(105,77,203,.04)');ctx.fillStyle=fill;ctx.fill();
      ctx.strokeStyle=side===1?'rgba(116,147,255,.64)':'rgba(180,126,255,.7)';ctx.lineWidth=1;ctx.shadowColor='#9664ff';ctx.shadowBlur=8;ctx.stroke();ctx.shadowBlur=0;
      for(let band=1;band<4;band++){ctx.save();ctx.scale(1-band*.025,1-band*.018);path(boundary,side);ctx.strokeStyle=`rgba(142,105,234,${.15-band*.025})`;ctx.lineWidth=.65;ctx.stroke();ctx.restore();}
    }
    for(const line of lines){
      for(let k=-1;k<=1;k++){
        path(line.points,1,k*2.6);ctx.strokeStyle=k===0?(line.side===1?'rgba(116,156,255,.76)':'rgba(186,128,255,.74)'):'rgba(144,99,232,.18)';ctx.lineWidth=k===0?1.15:.65;
        ctx.shadowColor=line.side===1?'#608cff':'#ac63ff';ctx.shadowBlur=k===0?5:0;ctx.stroke();
      }
      ctx.shadowBlur=0;
      if(line.index<8){const n=line.points.length;const at=((t*(10+line.index*.7)+line.index*19)%n)|0;const point=line.points[at];dot(point[0],point[1],1.5,'#e2d4ff');for(let tail=1;tail<7;tail++){const p=line.points[(at-tail+n)%n];dot(p[0],p[1],1-tail*.1,`rgba(163,145,255,${.5-tail*.06})`);}}
    }
    // Fine depth lines are deliberately sparse to preserve the cortical shapes.
    for(let i=0;i<40;i++){const a=i*2.39996;const r=Math.sqrt((i+.5)/40);const x=Math.cos(a)*117*r,y=Math.sin(a)*96*r-17;if(Math.abs(x)<12)continue;dot(x,y,.7,`rgba(179,161,255,${.16+.13*Math.sin(t*.5+i)})`);}
    ctx.restore();
    for(let i=0;i<9;i++){const a=i*2.399+ t*.018;const x=Math.cos(a)*(143+(i%3)*7),y=Math.sin(a)*113-12;dot(x,y,i%3===0?1.2:.65,`rgba(154,139,220,${.2+(i%3)*.08})`);}
    ctx.restore();
  }
  function active(){return !paused&&visible&&!document.hidden;}
  function tick(now){frame=0;if(!active())return;if(now-last>=1000/30){time+=Math.min(now-last,60);last=now;draw();}frame=requestAnimationFrame(tick);}
  function sync(){if(toggle){toggle.textContent=paused?'Resume motion':'Pause motion';toggle.setAttribute('aria-pressed',String(paused));}if(active()&&!frame){last=performance.now();frame=requestAnimationFrame(tick);}else if(!active()&&frame){cancelAnimationFrame(frame);frame=0;}draw();}
  function resize(){const box=canvas.getBoundingClientRect();width=box.width;height=box.height;const dpr=Math.min(window.devicePixelRatio||1,1.75);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);scale=Math.min(width/350,(height-120)/260,1.16);draw();}
  if(toggle)toggle.addEventListener('click',()=>{paused=!paused;sync();});
  reduced.addEventListener('change',e=>{paused=e.matches;sync();});
  document.addEventListener('visibilitychange',sync);
  if('ResizeObserver' in window)new ResizeObserver(resize).observe(canvas.parentElement);else window.addEventListener('resize',resize,{passive:true});
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();},{rootMargin:'40px'}).observe(canvas);
  resize();sync();
})();

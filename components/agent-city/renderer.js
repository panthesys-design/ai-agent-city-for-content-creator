// Drawing primitives extracted from Isometric Campus.html. Each renderer owns its
// palette state and SVG IDs; React owns data, layout, events, and lifecycle.
export function createBuildingRenderer(defs, prefix) {
defs.innerHTML = "\n    <linearGradient id=\"padSide\" x1=\"0\" x2=\"1\" y1=\"0\" y2=\"0\">\n      <stop offset=\"0\" stop-color=\"#e6e9ec\"/><stop offset=\"1\" stop-color=\"#cfd4d9\"/>\n    </linearGradient>\n    \n    \n    \n    \n    <filter id=\"blurMid\" x=\"-30%\" y=\"-40%\" width=\"160%\" height=\"180%\"><feGaussianBlur stdDeviation=\"8\"/></filter>\n    <radialGradient id=\"glow\"><stop offset=\"0\" stop-color=\"#fff1b8\" stop-opacity=\".95\"/><stop offset=\".35\" stop-color=\"#ffd36b\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#ffb84a\" stop-opacity=\"0\"/></radialGradient>\n    \n    \n    \n    \n    <filter id=\"blurSm\" x=\"-30%\" y=\"-30%\" width=\"160%\" height=\"160%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n";
defs.querySelectorAll('[id]').forEach(el => el.id = `${prefix}-${el.id}`);
const NS='http://www.w3.org/2000/svg';
const C=Math.cos(Math.PI/6), S=0.5;
const P=(x,y,z=0)=>[(x-y)*C,(x+y)*S-z];
const pts=a=>a.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
function el(name,attrs,parent){const e=document.createElementNS(NS,name);for(const k in attrs)e.setAttribute(k, k==='id' ? `${prefix}-${attrs[k]}` : typeof attrs[k]==='string' ? attrs[k].replace(/url\(#([^)]*)\)/g, (_, id) => `url(#${prefix}-${id})`) : attrs[k]);if(parent)parent.appendChild(e);return e}
const poly=(g,a,fill,extra={})=>el('polygon',Object.assign({points:pts(a),fill,stroke:fill,'stroke-width':.7,'stroke-linejoin':'round'},extra),g);

const COL={top:'#ffffff',left:'#f1f2f4',right:'#dfe2e6',roof:'#f3f4f6',roofLine:'#e2e5e8'};

/* ---------- drawing primitives ---------- */
function facePt(b,face,u,v){return face==='L'?P(b.x+u,b.y+b.d,b.z+v):P(b.x+b.w,b.y+u,b.z+v)}
let GLASS='clear', LIGHTS=null, SEED=1, LITN=0;
const GLASS_TINTS={
  clear:[['#bfc7cf','#d6dce1','#e3e7eb'],['#aab3bc','#c2cad1','#d0d6dc']],
  blue: [['#8db5e6','#bcd5f2','#dbe8f8'],['#7aa2d6','#a6c3ea','#c3d7f1']],
  teal: [['#7fcdc8','#b4e4e0','#d6f1ef'],['#68bab4','#9ad7d2','#bde6e2']],
  warm: [['#efc690','#f6dcb8','#fbecd6'],['#e0b27a','#ecca9f','#f3dcbc']],
};
(function(){
  for(const [k,[l,r]] of Object.entries(GLASS_TINTS))[['L',l],['R',r]].forEach(([f,c])=>{
    const gr=el('linearGradient',{id:'g'+f+'-'+k,x1:0,x2:0,y1:0,y2:1},defs);
    [0,.3,1].forEach((o,i)=>el('stop',{offset:o,'stop-color':c[i]},gr));
  });})();
const rnd1=n=>{const v=Math.sin(n*12.9898+SEED*78.233)*43758.5453;return v-Math.floor(v)};
function pane(g,b,face,u,v,w,h,lit){
  const q=[facePt(b,face,u,v),facePt(b,face,u+w,v),facePt(b,face,u+w,v+h),facePt(b,face,u,v+h)];
  poly(g,q,'url(#g'+face+'-'+(GLASS_TINTS[GLASS]?GLASS:'clear')+')',{stroke:'none'});
  if(lit&&LIGHTS)poly(LIGHTS,q,face==='L'?'#ffd77a':'#f5c25e',{stroke:'none',class:'lit'});
}
function windows(g,b,face,o){
  const len=face==='L'?b.w:b.d, mu=o.mu??6, gu=o.gu??4, gv=o.gv??6, z0=o.z0??10, z1=o.z1??b.h-8;
  const cw=(len-2*mu-(o.cols-1)*gu)/o.cols, rh=(z1-z0-(o.rows-1)*gv)/o.rows;
  for(let r=0;r<o.rows;r++)for(let c=0;c<o.cols;c++)pane(g,b,face,mu+c*(cw+gu),z0+r*(rh+gv),cw,rh,rnd1(++LITN)<.38);
}
function box(g,b){
  const {x,y,z,w,d,h}=b, t=z+h;
  poly(g,[P(x,y+d,z),P(x+w,y+d,z),P(x+w,y+d,t),P(x,y+d,t)],b.cl||COL.left);
  poly(g,[P(x+w,y,z),P(x+w,y+d,z),P(x+w,y+d,t),P(x+w,y,t)],b.cr||COL.right);
  poly(g,[P(x,y,t),P(x+w,y,t),P(x+w,y+d,t),P(x,y+d,t)],b.ct||COL.top);
  if(b.roof){const i=6;poly(g,[P(x+i,y+i,t),P(x+w-i,y+i,t),P(x+w-i,y+d-i,t),P(x+i,y+d-i,t)],COL.roof,{stroke:COL.roofLine,'stroke-width':1})}
  if(b.L)windows(g,b,'L',b.L);
  if(b.R)windows(g,b,'R',b.R);
}
function tree(g,x,y,s=1){
  const [cx,cy]=P(x,y,0), r=7.5*s, h=34*s;
  el('ellipse',{cx:cx+3,cy:cy+1,rx:r*1.25,ry:r*.6,fill:'#3f5a1e',opacity:.2},g);
  el('path',{d:`M${cx-r},${cy} A${r},${r*.5} 0 0 0 ${cx+r},${cy} L${cx},${cy-h} Z`,fill:'#a4d91f'},g);
  el('path',{d:`M${cx+r},${cy} A${r},${r*.5} 0 0 1 ${cx+r*.15},${cy+r*.5} L${cx},${cy-h} Z`,fill:'#7fb50e'},g);
}
function trees(g,list){list.slice().sort((a,b)=>(a[0]+a[1])-(b[0]+b[1])).forEach(t=>tree(g,...t))}
function rrect(x0,y0,x1,y1,r){
  const out=[], corners=[[x1-r,y1-r,0],[x0+r,y1-r,90],[x0+r,y0+r,180],[x1-r,y0+r,270]];
  for(const [cx,cy,st] of corners)for(let i=0;i<=8;i++){const t=(st+i*90/8)*Math.PI/180;out.push([cx+r*Math.cos(t),cy+r*Math.sin(t)])}
  return out;
}
function slab(g,world,z,T,topFill,sideFill,topAttrs={}){
  const top=world.map(p=>P(p[0],p[1],z)), bot=top.map(p=>[p[0],p[1]+T]);
  let li=0,ri=0;top.forEach((p,i)=>{if(p[0]<top[li][0])li=i;if(p[0]>top[ri][0])ri=i});
  el('polygon',{points:pts(bot),fill:sideFill},g);
  el('polygon',{points:pts([top[li],top[ri],bot[ri],bot[li]]),fill:sideFill},g);
  el('polygon',Object.assign({points:pts(top),fill:topFill,'stroke-linejoin':'round'},topAttrs),g);
  return bot;
}
function pad(outer,lift,body){
  const plot=rrect(-110,-110,110,110,30);
  outer.insertBefore(el('polygon',{class:'pad-shadow',points:pts(plot.map(p=>{const q=P(p[0],p[1]);return [q[0],q[1]+12]})),fill:'#3f5a1e',opacity:.3,filter:'url(#blurMid)'}),lift);
  slab(body,plot,7,7,'#fbfbfc','url(#padSide)',{class:'pad-top',stroke:'#ffffff','stroke-width':1.5});
}
function contactShadow(g,boxes){
  const s=el('g',{filter:'url(#blurSm)',opacity:.2},g), e=7;
  boxes.filter(b=>b.z===0).forEach(b=>el('polygon',{points:pts([P(b.x-e,b.y-e),P(b.x+b.w+e+6,b.y-e),P(b.x+b.w+e+6,b.y+b.d+e+6),P(b.x-e,b.y+b.d+e+6)]),fill:'#4f5863'},s));
}

/* ---------- building types: plain white massing. Colour comes from the spec (accent, glass, extras). ---------- */
const TYPES={
  tower:{
    anchor:[0,0,300],
    parts:{main:{x:-55,y:-55,z:0,w:110,d:110,h:300}},
    door:[0,74],
    trees:[[-84,66,1],[-68,80,1.25],[38,82,1.2],[54,90,.9]],
    draw(g){
      const main=Object.assign({roof:true,L:{cols:4,rows:9,z0:46,z1:290,mu:9,gu:5,gv:6}},this.parts.main);
      contactShadow(g,[main]);
      box(g,main);
      pane(g,main,'L',40,0,30,32,true);
      box(g,{x:-14,y:-30,z:300,w:30,d:24,h:9});
      for(let i=0;i<4;i++)for(let j=0;j<4;j++)
        poly(g,[P(12+i*7,10+j*7,300),P(17+i*7,10+j*7,300),P(17+i*7,15+j*7,300),P(12+i*7,15+j*7,300)],'#dfe2e6');
      [[-20,75],[20,75]].forEach(([x,y])=>el('line',{x1:P(x,y)[0],y1:P(x,y)[1],x2:P(x,y,34)[0],y2:P(x,y,34)[1],stroke:'#d3d7dc','stroke-width':2.2,'stroke-linecap':'round'},g));
      box(g,{x:-24,y:55,z:34,w:48,d:24,h:4});
    }
  },
  stepped:{
    anchor:[-10,0,190],
    parts:{core:{x:-72,y:-50,z:0,w:52,d:100,h:190},main:{x:-20,y:-50,z:0,w:92,d:100,h:150}},
    door:[-46,68],
    trees:[[-96,62,1.2],[-82,76,.95]],
    draw(g){
      const core=Object.assign({roof:true,L:{cols:1,rows:3,z0:48,z1:150,mu:16,gv:14}},this.parts.core);
      const main=Object.assign({roof:true,L:{cols:3,rows:4,z0:9,z1:142,mu:6,gu:5,gv:8},R:{cols:3,rows:4,z0:9,z1:142,mu:7,gu:6,gv:8}},this.parts.main);
      contactShadow(g,[core,main]);
      box(g,core);
      pane(g,core,'L',14,0,24,34,true);
      box(g,main);
      box(g,{x:-62,y:-36,z:190,w:26,d:10,h:5});
      box(g,{x:14,y:-22,z:150,w:22,d:22,h:8});
    }
  },
  office:{
    anchor:[-5,0,172],
    parts:{main:{x:-65,y:-48,z:0,w:120,d:96,h:172},annex:{x:55,y:8,z:0,w:42,d:40,h:46}},
    door:[76,64],
    trees:[[-92,62,1],[-78,64,1.2],[-64,66,1.05],[-50,68,1.25],[-36,70,1],[-22,72,1.15],[-8,74,.9]],
    draw(g){
      const main=Object.assign({roof:true,L:{cols:5,rows:4,z0:10,z1:140,mu:6,gu:5,gv:7},R:{cols:4,rows:4,z0:10,z1:140,mu:6,gu:5,gv:7}},this.parts.main);
      const annex=Object.assign({},this.parts.annex);
      contactShadow(g,[main,annex]);
      box(g,main);
      box(g,{x:-30,y:-14,z:172,w:22,d:18,h:8});
      box(g,{x:14,y:-30,z:172,w:10,d:10,h:5});
      box(g,annex);
      pane(g,annex,'L',10,0,22,30,true);
      box(g,{x:-98,y:78,z:0,w:44,d:10,h:12,ct:'#ffffff'});
    }
  }
};
/* ---------- agent office: lavender glass-front studio with a pill sign and a visible interior ---------- */
const THEMES={
  lavender:{top:'#f7f4fc',side:['#f1ecfa','#e6dff4','#d3c9e8'],deck:'#e9e3f3',accent:'#7c4dea',sign:'#cfc4e6'},
  mint:    {top:'#f3fbf8',side:['#eaf7f2','#dcefe8','#c3e0d5'],deck:'#e0f1ea',accent:'#12a38a',sign:'#bfe3d6'},
  peach:   {top:'#fff7f2',side:['#fdeee5','#f8e0d2','#efcbb7'],deck:'#f8e6db',accent:'#f0703a',sign:'#f3cdb8'},
  sky:     {top:'#f4f8ff',side:['#eaf1fd','#dbe6f9','#c3d3ef'],deck:'#e1eaf9',accent:'#3b7bf0',sign:'#c6d6f2'},
  rose:    {top:'#fff4f8',side:['#fceaf1','#f6dae6','#eac2d3'],deck:'#f6e1ea',accent:'#e04f8f',sign:'#efc6d7'},
  white:   {top:'#ffffff',side:['#f6f7f9','#eceef1','#d9dce1'],deck:'#eef0f3',accent:'#2d3340',sign:'#d9dce1'},
  gold:    {top:'#fbf8f1',side:['#f6f1e4','#ece4cf','#d6c8a6'],deck:'#efe7d4',accent:'#c08a1e',sign:'#e6d7b0'},
};
(function(){
  for(const [k,t] of Object.entries(THEMES)){t.key=k;const gr=el('linearGradient',{id:'side-'+k,x1:0,x2:1,y1:0,y2:0},defs);
    t.side.forEach((c,i)=>el('stop',{offset:i/2,'stop-color':c},gr));}})();
let TH=THEMES.lavender;
function rbox(g,b,r){   // box with rounded vertical corners, soft top edge, coloured by the current theme
  slab(g,rrect(b.x,b.y,b.x+b.w,b.y+b.d,Math.min(r,b.w/2,b.d/2)),b.z+b.h,b.h,b.top||TH.top,'url(#side-'+TH.key+')',{stroke:'#ffffff','stroke-width':1.2});
}
function roundTree(g,x,y,s=1,z=7){
  const [bx,by]=P(x,y,z), h=20*s;
  el('ellipse',{cx:bx+3,cy:by+1,rx:15*s,ry:7*s,fill:'#3f5a1e',opacity:.18},g);
  el('line',{x1:bx,y1:by,x2:bx,y2:by-h,stroke:'#8b5e3c','stroke-width':4*s,'stroke-linecap':'round'},g);
  const cy=by-h-9*s;
  [[6,4,9,'#6fb436'],[-7,3,9,'#79bf3e'],[0,-2,12,'#86cc45'],[-5,-9,8,'#9bd85a'],[6,-8,7,'#a9e06b'],[-1,-13,5.5,'#bfe98a']]
    .forEach(([dx,dy,r,c])=>el('circle',{cx:bx+dx*s,cy:cy+dy*s,r:r*s,fill:c},g));
}
function bush(g,x,y,s=1){
  const [bx,by]=P(x,y,7);
  el('ellipse',{cx:bx+2,cy:by+1,rx:9*s,ry:4*s,fill:'#3f5a1e',opacity:.16},g);
  [[-4,-3,5,'#6fb436'],[4,-3,5,'#79bf3e'],[0,-6,5.5,'#93d453'],[-1,-9,3,'#b3e57a']].forEach(([dx,dy,r,c])=>el('circle',{cx:bx+dx*s,cy:by+dy*s,r:r*s,fill:c},g));
}
function plant(g,x,y,z){
  box(g,{x:x-5,y:y-5,z,w:10,d:10,h:9,ct:'#f2eee8',cl:'#ffffff',cr:'#e6e1da'});
  const [cx,cy]=P(x,y,z+9);
  [[-6,-10,-1],[6,-11,1],[0,-15,0],[-4,-6,-1],[5,-6,1]].forEach(([dx,dy,k])=>
    el('path',{d:`M${cx},${cy} Q${cx+dx*.3},${cy+dy*.6} ${cx+dx},${cy+dy} Q${cx+dx*.7+k*2},${cy+dy*.4} ${cx},${cy}`,fill:k<0?'#4f9e2c':k>0?'#6fbf3a':'#86d14a'},g));
}
const ICONS={
  search:g=>{el('circle',{cx:0,cy:-1.5,r:4.6,fill:'none',stroke:'#fff','stroke-width':2.2},g);el('line',{x1:3.4,y1:2,x2:7,y2:5.6,stroke:'#fff','stroke-width':2.4,'stroke-linecap':'round'},g)},
  doc:g=>{el('rect',{x:-4.5,y:-6.5,width:9,height:12,rx:1.5,fill:'#fff'},g);[-3,0,3].forEach(y=>el('line',{x1:-2.5,y1:y,x2:2.5,y2:y,stroke:'#8b5cf6','stroke-width':1.2},g))},
  play:g=>el('path',{d:'M-3,-5 L5,0 L-3,5 Z',fill:'#fff'},g),
  wave:g=>[-5,-2.5,0,2.5,5].forEach((x,i)=>el('line',{x1:x,y1:-[2,4,6,4,2][i],x2:x,y2:[2,4,6,4,2][i],stroke:'#fff','stroke-width':1.8,'stroke-linecap':'round'},g)),
  image:g=>{el('rect',{x:-6,y:-5,width:12,height:10,rx:2,fill:'none',stroke:'#fff','stroke-width':1.8},g);el('path',{d:'M-5,4 L-1,-0.5 L2,2.5 L3.5,1 L5.5,4 Z',fill:'#fff'},g);el('circle',{cx:2.5,cy:-2,r:1.3,fill:'#fff'},g)},
  sparkle:g=>{el('path',{d:'M-1,-7 Q0,-1 6,0 Q0,1 -1,7 Q-2,1 -8,0 Q-2,-1 -1,-7 Z',fill:'#fff'},g);el('path',{d:'M5,-7 Q5.4,-5 7.4,-4.6 Q5.4,-4.2 5,-2.2 Q4.6,-4.2 2.6,-4.6 Q4.6,-5 5,-7 Z',fill:'#ffe08a'},g)},
  rocket:g=>{el('path',{d:'M0,-7 C4,-4 4,2 2,5 L-2,5 C-4,2 -4,-4 0,-7 Z',fill:'#fff'},g);el('circle',{cx:0,cy:-1.5,r:1.6,fill:'#8b5cf6'},g)},
};
function pillSign(g,x,y,z,w,h,label,icon){
  // a rounded pill on the front (L) face, extruded 6 units toward the viewer
  const at=(dy)=>{const o=P(x,y+dy,z+h);return `matrix(${C},${S},0,1,${o[0].toFixed(2)},${o[1].toFixed(2)})`};
  for(let d=0;d<6;d+=1.5)el('rect',{x:0,y:0,width:w,height:h,rx:h/2,fill:d<4.5?TH.sign:shade(TH.sign,1.3),transform:at(d)},g);
  const f=el('g',{transform:at(6)},g);
  el('rect',{x:0,y:0,width:w,height:h,rx:h/2,fill:'#ffffff'},f);
  el('rect',{x:h*.12,y:h*.12,width:h*.76,height:h*.76,rx:h*.22,fill:TH.accent},f);
  const ig=el('g',{transform:`translate(${h/2},${h/2}) scale(${h/24})`},f);(ICONS[icon]||ICONS.search)(ig);
  const fs=Math.min(h*.5,(w-h-10)/(Math.max(1,label.length)*.56));
  const t=el('text',{x:h+5,y:h/2+fs*.36,'font-size':fs.toFixed(1),'font-weight':800,'font-family':'Onest,system-ui,sans-serif',fill:'#241d3a'},f);t.textContent=label;
}
/* screens: 2D content drawn on a monitor face (local x right, y down) */
const rct=(f,x,y,w,h,fill,o={})=>el('rect',Object.assign({x,y,width:w,height:h,fill},o),f);
function faceGroup(g,x,y,z){const o=P(x,y,z);return el('g',{transform:`matrix(${C},${S},0,1,${o[0].toFixed(2)},${o[1].toFixed(2)})`},g)}
const SCREENS={
  chart:(f,w,h)=>{rct(f,0,0,w,h,'#4f7cff');el('polyline',{points:`${w*.1},${h*.72} ${w*.3},${h*.45} ${w*.5},${h*.62} ${w*.7},${h*.3} ${w*.9},${h*.42}`,fill:'none',stroke:'#9ff0ff','stroke-width':1.6,'stroke-linejoin':'round'},f);rct(f,w*.08,h*.1,w*.3,h*.1,'#fff',{rx:1})},
  doc:(f,w,h)=>{rct(f,0,0,w,h,'#ffffff');rct(f,w*.1,h*.12,w*.45,h*.12,TH.accent,{rx:1});[.36,.52,.68,.84].forEach((y,i)=>rct(f,w*.1,h*y,w*(i%2?.55:.75),h*.07,'#c9cdd6',{rx:1}))},
  wave:(f,w,h)=>{rct(f,0,0,w,h,'#24195a');for(let i=0;i<12;i++){const bh=h*(.12+.6*Math.abs(Math.sin(i*1.3)));rct(f,w*.08+i*w*.072,(h-bh)/2,w*.045,bh,i%2?'#9ff0ff':'#c4a8ff',{rx:.6})}},
  play:(f,w,h)=>{rct(f,0,0,w,h,'#1d2140');el('circle',{cx:w/2,cy:h*.4,r:h*.22,fill:TH.accent},f);el('path',{d:`M${w/2-h*.07},${h*.29} L${w/2+h*.11},${h*.4} L${w/2-h*.07},${h*.51} Z`,fill:'#fff'},f);
    [['#ff8fb1',.08,.3],['#ffd166',.4,.25],['#9ff0ff',.67,.25]].forEach(([c,x,ww])=>rct(f,w*x,h*.76,w*ww,h*.11,c,{rx:.6}))},
  image:(f,w,h)=>{rct(f,0,0,w,h,'#fff0f6');rct(f,w*.06,h*.12,w*.52,h*.76,'#cfe0ff',{rx:1});el('path',{d:`M${w*.06},${h*.88} L${w*.24},${h*.5} L${w*.36},${h*.68} L${w*.44},${h*.58} L${w*.58},${h*.88} Z`,fill:TH.accent},f);
    el('circle',{cx:w*.45,cy:h*.3,r:h*.08,fill:'#ffd166'},f);rct(f,w*.64,h*.12,w*.3,h*.34,'#ff8fb1',{rx:1});rct(f,w*.64,h*.54,w*.3,h*.34,'#c4a8ff',{rx:1})},
  calendar:(f,w,h)=>{rct(f,0,0,w,h,'#f5f0ff');rct(f,0,0,w,h*.2,TH.accent);for(let r=0;r<3;r++)for(let c=0;c<6;c++)rct(f,w*.06+c*w*.15,h*.3+r*h*.22,w*.12,h*.16,(r*6+c)%5===1?TH.accent:'#dcd2fb',{rx:.8})},
};
function monitor(g,x0,Y,w,h,kind,z0){
  box(g,{x:x0+w/2-2.5,y:Y-6,z:z0-4,w:5,d:4,h:5,ct:'#6b6f80',cl:'#5b5f70',cr:'#4b4f60'});
  box(g,{x:x0-1.5,y:Y-3,z:z0-1.5,w:w+3,d:3,h:h+3,ct:'#4b4f60',cl:'#2e3240',cr:'#262a36'});
  (SCREENS[kind]||SCREENS.chart)(faceGroup(g,x0,Y,z0+h),w,h);
  if(LIGHTS)rct(faceGroup(LIGHTS,x0,Y,z0+h),0,0,w,h,'#bfe0ff',{opacity:.3,class:'lit'});
}
function dish(g,x,y,z){
  rbox(g,{x:x-6,y:y-6,z,w:12,d:12,h:4},3);
  const a=P(x,y,z+4),b2=P(x,y,z+16);el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#8f98a2','stroke-width':3},g);
  const c=P(x,y,z+24);
  el('ellipse',{cx:c[0],cy:c[1],rx:14,ry:9,transform:`rotate(-28 ${c[0]} ${c[1]})`,fill:'#e7eaee',stroke:'#c3c9d0','stroke-width':1.2},g);
  el('ellipse',{cx:c[0]+1,cy:c[1]+1,rx:10,ry:6,transform:`rotate(-28 ${c[0]} ${c[1]})`,fill:'#d4d9df'},g);
  el('line',{x1:c[0],y1:c[1],x2:c[0]+9,y2:c[1]-10,stroke:'#8f98a2','stroke-width':1.6},g);
  el('circle',{cx:c[0]+9,cy:c[1]-10,r:2.2,fill:'#5b6370'},g);
}
const SCREEN_FOR={desk:'chart',writer:'doc',voice:'wave',gallery:'image',publish:'calendar'};
function interior(g,kind,X0,X1,Y0,Y1,F,TOP){
  const voice=kind==='voice';
  poly(g,[P(X0,Y0,F),P(X1,Y0,F),P(X1,Y1,F),P(X0,Y1,F)],voice?'#e2c494':'#e6c08a');
  poly(g,[P(X0,Y0,F),P(X1,Y0,F),P(X1,Y0,TOP),P(X0,Y0,TOP)],voice?'#7a5ce0':'#fde6bd');
  poly(g,[P(X0,Y0,F),P(X0,Y1,F),P(X0,Y1,TOP),P(X0,Y0,TOP)],voice?'#6446c9':'#f4d6a2');
  if(voice){
    for(let i=0;i<7;i++){const x=X0+8+i*19;poly(g,[P(x,Y0,F+12),P(x+13,Y0,F+12),P(x+13,Y0,TOP-12),P(x,Y0,TOP-12)],'#6a4cd6',{stroke:'none'})}
    for(let i=0;i<6;i++){const y=Y0+8+i*19;poly(g,[P(X0,y,F+12),P(X0,y+13,F+12),P(X0,y+13,TOP-12),P(X0,y,TOP-12)],'#5536b5',{stroke:'none'})}
  }
  if(kind==='gallery')[[-58,26,'#ffd166'],[-24,32,'#c4a8ff'],[14,24,'#ff8fb1']].forEach(([x,w,c])=>{
    const f=faceGroup(g,x,Y0+.5,F+66);rct(f,0,0,w,w*.75,'#ffffff',{rx:1.5});rct(f,3,3,w-6,w*.75-6,c,{rx:1});
    el('path',{d:`M3,${w*.75-3} L${w*.35},${w*.32} L${w*.55},${w*.5} L${w-3},${w*.75-3} Z`,fill:'#ffffff',opacity:.7},f)});
  if(['desk','writer','publish'].includes(kind)){
    box(g,{x:14,y:-58,z:F,w:44,d:10,h:46,ct:'#e2b47c',cl:'#d29d62',cr:'#b98549'});
    for(let r=0;r<3;r++){const zz=F+6+r*14;
      for(let i=0;i<6;i++){const bx=17+i*6.4, c=['#7c4dea','#ff8a65','#4f8cff','#ffd166','#2ec4a6','#e255a1'][(i+r*2)%6];
        poly(g,[P(bx,-48,zz),P(bx+4.6,-48,zz),P(bx+4.6,-48,zz+9-(i%3)),P(bx,-48,zz+9-(i%3))],c,{stroke:'none'})}
      poly(g,[P(14,-48,zz-1.5),P(58,-48,zz-1.5),P(58,-48,zz),P(14,-48,zz)],'#b98549',{stroke:'none'});}
  }
  plant(g,-56,-46,F);
  box(g,{x:-38,y:8,z:F,w:70,d:26,h:14,ct:'#f6dcb0',cl:'#c9955a',cr:'#b07d45'});
  const z0=F+19;
  if(kind==='editing'){monitor(g,-32,15,29,17,'chart',z0);monitor(g,0,15,29,17,'play',z0);}
  else monitor(g,-26,15,40,18,SCREEN_FOR[kind]||'chart',z0);
  box(g,{x:-18,y:22,z:F+14,w:24,d:7,h:1.5,ct:'#f1edf8',cl:'#d9d3e6',cr:'#c9c2d8'});
  if(voice){const a=P(-31,27,F+14),b2=P(-31,27,F+30);el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#3a3e4e','stroke-width':1.8},g);
    el('rect',{x:b2[0]-3.4,y:b2[1]-8,width:6.8,height:10,rx:3.4,fill:'#3a3e4e'},g);el('rect',{x:b2[0]-2.2,y:b2[1]-6.5,width:4.4,height:5,rx:2.2,fill:'#6b7080'},g)}
  box(g,{x:46,y:28,z:F,w:3,d:3,h:11,ct:'#5d5a73',cl:'#4c4962',cr:'#3d3a52'});
  box(g,{x:39,y:21,z:F+11,w:17,d:16,h:3,ct:'#8a84ad',cl:'#6a6590',cr:'#57527c'});
  box(g,{x:39,y:35,z:F+14,w:17,d:3,h:13,ct:'#8a84ad',cl:'#6a6590',cr:'#57527c'});
  plant(g,-58,40,F);plant(g,58,-20,F);
}
const AG={X0:-70,X1:70,Y0:-60,Y1:60,F:8,TOP:96,UH:46};
const agentOpts=b=>({floors:Math.max(1,Math.min(4,b.floors|0||1)),glass:['full','front','none'].includes(b.glass)?b.glass:'full',
  theme:THEMES[b.theme]?b.theme:'lavender',interior:b.interior||'desk',roof:Array.isArray(b.roof)?b.roof:['tree','units'],trees:b.trees!==false});
TYPES.agent={
  anchor:b=>{const o=agentOpts(b);return [0,0,AG.TOP+16+(o.floors>1?(o.floors-1)*AG.UH+12:0)+12]},
  parts:{main:{x:-70,y:-60,z:0,w:140,d:120,h:112}},
  door:b=>agentOpts(b).glass==='none'?[0,92]:[34,92],
  trees:[],
  noBand:true,
  draw(g,b){
    const o=agentOpts(b), {X0,X1,Y0,Y1,F,TOP,UH}=AG;
    TH=THEMES[o.theme]; GLASS='warm';
    if(o.trees){roundTree(g,-96,-46,1.05);roundTree(g,-30,-92,.9);}
    contactShadow(g,[{x:-76,y:-66,z:0,w:152,d:132}]);
    rbox(g,{x:-76,y:-66,z:0,w:152,d:132,h:F},18);
    if(o.glass==='none'){
      const gb={x:X0,y:Y0,z:F,w:X1-X0,d:Y1-Y0,h:TOP-F};
      rbox(g,gb,12);
      const du=(X1-X0)/2-17;
      pane(g,gb,'L',du,0,34,50,true);
      [[du+17,0,du+17,50],[du,50,du+34,50]].forEach(([u1,v1,u2,v2])=>{const a=facePt(gb,'L',u1,v1),b2=facePt(gb,'L',u2,v2);el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#ffffff','stroke-width':2},g)});
      pane(g,gb,'L',16,20,24,44,true);pane(g,gb,'L',X1-X0-40,20,24,44,true);
      windows(g,gb,'R',{cols:3,rows:1,z0:20,z1:64,mu:18,gu:12});
      abox(g,{x:X0+du-6,y:Y1,z:F+54,w:46,d:14,h:5},TH.accent);
    }else{
      interior(g,o.interior,X0,X1,Y0,Y1,F,TOP);
      rbox(g,{x:X1-8,y:Y0,z:F,w:8,d:8,h:TOP-F},4);
      rbox(g,{x:X0,y:Y1-8,z:F,w:8,d:8,h:TOP-F},4);
      const glass=(face)=>{
        const q=face==='L'?[P(X0+8,Y1,F),P(X1,Y1,F),P(X1,Y1,TOP),P(X0+8,Y1,TOP)]:[P(X1,Y0+8,F),P(X1,Y1,F),P(X1,Y1,TOP),P(X1,Y0+8,TOP)];
        poly(g,q,face==='L'?'#ffffff':'#f6ecff',{opacity:.1,stroke:'none'});
        poly(LIGHTS||g,q,'#ffc65a',{opacity:.38,stroke:'none',class:'lit'});
        const len=face==='L'?X1-X0-8:Y1-Y0-8;
        for(let i=1;i<3;i++){const u=len*i/3;const a=face==='L'?P(X0+8+u,Y1,F):P(X1,Y0+8+u,F),b2=face==='L'?P(X0+8+u,Y1,TOP):P(X1,Y0+8+u,TOP);
          el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:TH.side[1],'stroke-width':2.4},g)}
        const s1=face==='L'?P(X0+30,Y1,TOP-6):P(X1,Y0+30,TOP-6), s2=face==='L'?P(X0+52,Y1,F+30):P(X1,Y0+52,F+30);
        el('line',{x1:s1[0],y1:s1[1],x2:s2[0],y2:s2[1],stroke:'#ffffff','stroke-width':4,opacity:.22,'stroke-linecap':'round'},g);
      };
      if(o.glass==='full')glass('R');
      else{
        const wb={x:X0,y:Y0,z:F,w:X1-X0,d:Y1-Y0,h:TOP-F};
        poly(g,[P(X1,Y0+8,F),P(X1,Y1,F),P(X1,Y1,TOP),P(X1,Y0+8,TOP)],TH.side[2]);
        windows(g,wb,'R',{cols:2,rows:1,z0:26,z1:70,mu:22,gu:22});
      }
      glass('L');
      rbox(g,{x:X1-7,y:Y1-7,z:F,w:8,d:8,h:TOP-F},4);
      const c1=P(X1,Y1-1,F+2),c2=P(X1,Y1-1,TOP-2);
      el('line',{x1:c1[0]-2,y1:c1[1],x2:c2[0]-2,y2:c2[1],stroke:'#ffe08a','stroke-width':2.6},g);
    }
    // fascia, optional upper floors, roof
    rbox(g,{x:-78,y:-68,z:TOP,w:156,d:136,h:16},20);
    let roofZ=TOP+16;
    if(o.floors>1){
      const H=(o.floors-1)*UH, ub={x:X0+2,y:Y0+2,z:roofZ,w:X1-X0-4,d:Y1-Y0-4,h:H};
      rbox(g,ub,14);
      windows(g,ub,'L',{cols:4,rows:o.floors-1,z0:10,z1:H-8,mu:16,gu:10,gv:16});
      windows(g,ub,'R',{cols:3,rows:o.floors-1,z0:10,z1:H-8,mu:16,gu:10,gv:16});
      rbox(g,{x:-76,y:-66,z:roofZ+H,w:152,d:132,h:12},20);
      roofZ+=H+12;
    }
    el('polygon',{points:pts(rrect(-66,-56,66,56,13).map(q=>P(q[0],q[1],roofZ))),fill:TH.deck,stroke:TH.side[1],'stroke-width':1},g);
    const R=new Set(o.roof);
    if(R.has('tree'))roundTree(g,-48,-38,.85,roofZ);
    if(R.has('units')){rbox(g,{x:6,y:-46,z:roofZ,w:24,d:18,h:8},5);rbox(g,{x:38,y:-20,z:roofZ,w:14,d:12,h:6},4);}
    if(R.has('solar'))solarPanels(g,{x:-46,y:6,z:roofZ,h:0},0,0,2,3);
    if(R.has('garden'))roofGarden(g,{x:10,y:8,z:roofZ,h:0},0,0,28,36);
    if(R.has('dish'))dish(g,46,30,roofZ);
    // sign, steps, planting
    const label=String(b.label||b.name||'Agent').slice(0,16);
    pillSign(g,-60,68,TOP-1,Math.max(96,Math.min(136,44+label.length*6.4)),21,label,b.icon);
    const sx=o.glass==='none'?-20:16;
    rbox(g,{x:sx,y:62,z:0,w:40,d:20,h:5},4);rbox(g,{x:sx,y:62,z:0,w:40,d:10,h:8},4);
    if(o.trees){
      [[-88,86],[-72,86],[-56,86],[-40,86],[-24,86],[-8,86],[8,86],[70,86],[88,86],[90,70],[90,52],[90,34]]
        .filter(([x])=>x<sx-8||x>sx+48).forEach(([x,y])=>bush(g,x,y,.9));
      roundTree(g,-96,58,1.1);roundTree(g,96,-4,1.05);
    }
    TH=THEMES.lavender;
  }
};
/* ---------- HQ skyscrapers: three styles, all driven by the spec ---------- */
const skyOpts=b=>({style:['empire','crown','twin'].includes(b.style)?b.style:'empire',theme:THEMES[b.theme]?b.theme:'gold',
  height:Math.max(1,Math.min(5,b.height|0||3)),tint:GLASS_TINTS[b.tint]?b.tint:'blue',spire:b.spire!==false,trees:b.trees!==false});
const skyScale=o=>.7+.15*(o.height-1);
const POD=36;
function skyTop(b){
  const o=skyOpts(b), s=skyScale(o);
  if(o.style==='empire')return POD+(150+110+70+36)*s+(o.spire?122:12);
  if(o.style==='crown')return POD+250*s+72+46+(o.spire?46:0);
  return POD+280*s+28+(o.spire?58:6);
}
const th=b=>Object.assign(b,{ct:TH.top,cl:TH.side[0],cr:TH.side[2]});
function ledge(g,t,r=0){rbox(g,{x:t.x-3,y:t.y-3,z:t.z+t.h-1,w:t.w+6,d:t.d+6,h:3,top:'#ffffff'},r+3)}
function rband(g,t,c,r){   // accent band that stops where the rounded corners begin
  [['L',t.w],['R',t.d]].forEach(([f,len])=>poly(g,[facePt(t,f,r,t.h-8),facePt(t,f,len-r,t.h-8),facePt(t,f,len-r,t.h-3),facePt(t,f,r,t.h-3)],f==='L'?c:shade(c,.82),{stroke:'none'}));
}
function emblem(g,x,y,z,size,icon){
  const draw=(parent,glow)=>{const f=faceGroup(parent,x,y,z);
    if(glow)el('rect',{x:-4,y:-4,width:size+8,height:size+8,rx:size*.32,fill:'url(#glow)',class:'lit'},f);
    el('rect',{x:0,y:0,width:size,height:size,rx:size*.24,fill:TH.accent,class:glow?'lit':null},f);
    const ig=el('g',{transform:`translate(${size/2},${size/2}) scale(${size/22})`},f);(ICONS[icon]||ICONS.sparkle)(ig);};
  draw(g,false); if(LIGHTS)draw(LIGHTS,true);
}
function strips(g,t,face,fl=15,r=0){   // art-deco style: narrow vertical window strips between piers
  const len=face==='L'?t.w:t.d, mu=r+4;
  windows(g,t,face,{cols:Math.max(2,Math.floor((len-2*mu)/12)),rows:Math.max(1,Math.floor((t.h-12)/fl)),z0:7,z1:t.h-10,mu,gu:4.5,gv:4});
}
function curtain(g,t,r=0){   // glass curtain wall between the rounded corners, with floor lines and random lit offices
  [['L',t.w],['R',t.d]].forEach(([f,len])=>{
    const u0=r+2,u1=len-r-2;
    poly(g,[facePt(t,f,u0,2),facePt(t,f,u1,2),facePt(t,f,u1,t.h-2),facePt(t,f,u0,t.h-2)],'url(#g'+f+'-'+GLASS+')',{stroke:'none'});
    for(let z=12;z<t.h-4;z+=12){const a=facePt(t,f,u0,z),b2=facePt(t,f,u1,z);el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#ffffff','stroke-width':.9,opacity:.55},g)}
    for(let u=u0+16;u<u1-2;u+=16){const a=facePt(t,f,u,2),b2=facePt(t,f,u,t.h-2);el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#ffffff','stroke-width':.8,opacity:.35},g)}
    if(LIGHTS)for(let z=2;z<t.h-13;z+=12)for(let u=u0;u<u1-15;u+=16)if(rnd1(++LITN)<.32)
      poly(LIGHTS,[facePt(t,f,u+1,z+1),facePt(t,f,u+15,z+1),facePt(t,f,u+15,z+11),facePt(t,f,u+1,z+11)],f==='L'?'#ffd77a':'#f5c25e',{stroke:'none',class:'lit'});
  });
}
function needle(g,x,y,z,h){
  const a=P(x,y,z),b2=P(x,y,z+h);el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#b9bfc6','stroke-width':2.4,'stroke-linecap':'round'},g);
  el('circle',{cx:b2[0],cy:b2[1],r:3.2,fill:'#ff3b5c',class:'blink'},LIGHTS||g);
}
function cbox(hw,hd,z,h,cx=0,cy=0){return {x:cx-hw,y:cy-hd,z,w:hw*2,d:hd*2,h}}
function skyPodium(g,o,b){
  const pod={x:-90,y:-80,z:0,w:180,d:160,h:POD};
  contactShadow(g,[pod]);rbox(g,pod,20);
  pane(g,pod,'L',22,0,136,26,true);pane(g,pod,'R',22,0,116,26,true);
  [['L',136],['R',116]].forEach(([f,len])=>{for(let u=22+17;u<22+len;u+=17){const a=facePt(pod,f,u,0),b2=facePt(pod,f,u,26);el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#ffffff','stroke-width':1.6},g)}});
  rband(g,pod,TH.accent,20);
  {const c=TH.accent;slab(g,rrect(-28,80,28,96,6),30,4,shade(c,1.25),c,{stroke:shade(c,1.4),'stroke-width':1})}
  rbox(g,{x:-26,y:80,z:0,w:52,d:12,h:3,top:'#ffffff'},4);
}
TYPES.skyscraper={
  anchor:b=>[0,0,skyTop(b)+6],
  parts:{main:{x:-70,y:-62,z:0,w:140,d:124,h:300}},
  door:[0,100],
  trees:[],
  noBand:true,
  draw(g,b){
    const o=skyOpts(b), s=skyScale(o);
    TH=THEMES[o.theme]; GLASS=o.tint;
    if(o.trees){roundTree(g,-100,-70,1.1);roundTree(g,-60,-102,.95);}
    skyPodium(g,o,b);
    let z=POD;
    if(o.style==='empire'){
      const tiers=[[70,62,150],[56,50,110],[42,38,70],[28,26,36]];
      tiers.forEach(([hw,hd,h],i)=>{
        const t=cbox(hw,hd,z,h*s), r=Math.round(hw*.22);rbox(g,t,r);
        if(i<3){strips(g,t,'L',15,r);strips(g,t,'R',15,r);}
        rband(g,t,TH.accent,r);ledge(g,t,r);
        if(i===3)emblem(g,-12,hd,z+t.h-8,24,b.icon);
        z+=t.h;
      });
      if(o.spire){
        [[13,11,22,5],[8,7,26,3.5],[4.5,4,26,2]].forEach(([hw,hd,h,r])=>{const t=cbox(hw,hd,z,h);rbox(g,t,r);ledge(g,t,r);z+=h});
        needle(g,0,0,z,48);
      }else{rbox(g,{x:-10,y:-10,z,w:20,d:16,h:8},4);}
    }else if(o.style==='crown'){
      const shaft=cbox(66,58,z,250*s);rbox(g,shaft,16);curtain(g,shaft,16);
      emblem(g,-14,58,z+shaft.h-14,28,b.icon);
      z+=shaft.h;
      [[56,49,26],[45,39,24],[34,29,22]].forEach(([hw,hd,h])=>{
        const t=cbox(hw,hd,z,h), r=Math.round(hw*.24);rbox(g,t,r);curtain(g,t,r);
        rband(g,t,TH.accent,r);
        if(LIGHTS){const q=f=>poly(LIGHTS,[facePt(t,f,r,h-8),facePt(t,f,(f==='L'?t.w:t.d)-r,h-8),facePt(t,f,(f==='L'?t.w:t.d)-r,h-3),facePt(t,f,r,h-3)],'#ffe9a8',{stroke:'none',class:'lit'});q('L');q('R');}
        ledge(g,t,r);z+=h;
      });
      {const c=TH.accent;let zz=z;
        [[30,26,12,10],[23,20,12,8],[16,14,12,6],[9,8,12,4]].forEach(([hw,hd,h,r],i)=>{
          slab(g,rrect(-hw,-hd,hw,hd,r),zz+h,h,shade(c,1.3+i*.08),i%2?shade(c,.9):c,{stroke:shade(c,1.5),'stroke-width':1});
          if(LIGHTS)el('polygon',{points:pts(rrect(-hw,-hd,hw,hd,r).map(q=>P(q[0],q[1],zz+h))),fill:'#bfe0ff',opacity:.35,class:'lit'},LIGHTS);
          zz+=h;});
        z=zz-2;}
      if(o.spire)needle(g,0,0,z,46);
    }else{
      const H=280*s;
      const tower=(cx,withEmblem)=>{
        const t=cbox(34,40,z,H,cx,-6);rbox(g,t,10);strips(g,t,'L',14,10);strips(g,t,'R',14,10);rband(g,t,TH.accent,10);ledge(g,t,10);
        let zz=z+H;
        [[26,32,16,8],[18,24,12,6]].forEach(([hw,hd,h,r])=>{const u=cbox(hw,hd,zz,h,cx,-6);rbox(g,u,r);rband(g,u,TH.accent,r);ledge(g,u,r);zz+=h});
        if(withEmblem)emblem(g,cx-11,18,zz-4,22,b.icon);
        if(o.spire)needle(g,cx,-6,zz,58);else rbox(g,{x:cx-8,y:-12,z:zz,w:16,d:12,h:6},4);
      };
      tower(-50,false);
      const br=cbox(16,10,z+H*.55,18,0,-6);rbox(g,br,4);curtain(g,br,3);rband(g,br,TH.accent,4);
      const br2=cbox(16,10,z+H*.55-26,6,0,-6);rbox(g,br2,3);
      tower(50,true);
    }
    const label=String(b.label||b.name||'HQ').slice(0,16);
    pillSign(g,-62,80,POD-6,Math.max(96,Math.min(136,44+label.length*6.4)),22,label,b.icon);
    if(o.trees){
      [[-98,96],[-82,98],[-66,98],[-50,98],[44,98],[60,98],[76,98],[98,84],[100,66],[100,48]].forEach(([x,y])=>bush(g,x,y,.9));
      roundTree(g,-102,74,1.15);roundTree(g,102,18,1.1);
    }
    TH=THEMES.lavender;
  }
};

/* ---------- extras: each spec "type" maps to one small drawing function ---------- */
function shade(hex,f){
  const n=parseInt(hex.slice(1),16), ch=[n>>16,(n>>8)&255,n&255].map(c=>Math.round(f<1?c*f:c+(255-c)*(f-1)));
  return '#'+ch.map(c=>Math.max(0,Math.min(255,c)).toString(16).padStart(2,'0')).join('');
}
const abox=(g,b,c)=>box(g,Object.assign(b,{ct:shade(c,1.25),cl:c,cr:shade(c,.82)}));
const isoCircle=(x,y,z,r,n=16)=>Array.from({length:n},(_,i)=>{const t=i/n*Math.PI*2;return P(x+r*Math.cos(t),y+r*Math.sin(t),z)});
const FACE=f=>f==='right'||f==='R'?'R':'L';
const FLOWERS=['#ff6b8a','#ffd84a','#ffffff','#b07cff','#ff9f43'];

function accentBand(g,p,c){
  const q=(face,len)=>poly(g,[facePt(p,face,0,p.h-8),facePt(p,face,len,p.h-8),facePt(p,face,len,p.h-3),facePt(p,face,0,p.h-3)],face==='L'?c:shade(c,.82),{stroke:'none'});
  q('L',p.w);q('R',p.d);
}
function awning(g,p,face,u,w,z,c){
  const dep=16, drop=10, n=Math.max(2,Math.round(w/10)), sw=w/n;
  const wall=(uu,zz)=>face==='L'?P(p.x+uu,p.y+p.d,zz):P(p.x+p.w,p.y+uu,zz);
  const out=(uu,zz)=>face==='L'?P(p.x+uu,p.y+p.d+dep,zz):P(p.x+p.w+dep,p.y+uu,zz);
  for(let i=0;i<n;i++){const a=u+i*sw,b2=a+sw, col=i%2?'#ffffff':c;
    poly(g,[wall(a,z),wall(b2,z),out(b2,z-drop),out(a,z-drop)],face==='L'?col:shade(col,.93),{'stroke-width':.4});
    poly(g,[out(a,z-drop),out(b2,z-drop),out(b2,z-drop-5),out(a,z-drop-5)],i%2?'#eef0f2':shade(c,.85),{'stroke-width':.4});
  }
  poly(g,[wall(u+w,z),out(u+w,z-drop),out(u+w,z-drop-5),wall(u+w,z-4)],shade(c,.72));
}
function balcony(g,p,face,u,w,z,c){
  const W='#ffffff';
  if(face==='L'){
    const X=p.x+u,Y=p.y+p.d;
    box(g,{x:X,y:Y,z,w,d:12,h:3,ct:W});
    poly(g,[P(X+w,Y,z+3),P(X+w,Y+12,z+3),P(X+w,Y+12,z+14),P(X+w,Y,z+14)],c,{opacity:.35,stroke:'none'});
    poly(g,[P(X,Y+12,z+3),P(X+w,Y+12,z+3),P(X+w,Y+12,z+14),P(X,Y+12,z+14)],c,{opacity:.4,stroke:'none'});
    [[P(X,Y+12,z+14),P(X+w,Y+12,z+14)],[P(X+w,Y+12,z+14),P(X+w,Y,z+14)]].forEach(([a,b2])=>el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:shade(c,.8),'stroke-width':2,'stroke-linecap':'round'},g));
  }else{
    const X=p.x+p.w,Y=p.y+u;
    box(g,{x:X,y:Y,z,w:12,d:w,h:3,ct:W});
    poly(g,[P(X,Y+w,z+3),P(X+12,Y+w,z+3),P(X+12,Y+w,z+14),P(X,Y+w,z+14)],c,{opacity:.35,stroke:'none'});
    poly(g,[P(X+12,Y,z+3),P(X+12,Y+w,z+3),P(X+12,Y+w,z+14),P(X+12,Y,z+14)],c,{opacity:.4,stroke:'none'});
    [[P(X+12,Y,z+14),P(X+12,Y+w,z+14)],[P(X+12,Y+w,z+14),P(X,Y+w,z+14)]].forEach(([a,b2])=>el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:shade(c,.8),'stroke-width':2,'stroke-linecap':'round'},g));
  }
}
function shopfront(g,p,face,u,w,c){
  pane(g,p,face,u,0,w,30,true);
  for(let i=1;i<4;i++){const a=facePt(p,face,u+w*i/4,0),b2=facePt(p,face,u+w*i/4,30);el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#ffffff','stroke-width':2},g)}
  awning(g,p,face,u-3,w+6,42,c);
}
function sign(g,p,face,u,w,v,h,text,c){
  let sb, m;
  if(face==='L'){sb={x:p.x+u,y:p.y+p.d,z:p.z+v,w,d:3,h};m=[C,S]}
  else{sb={x:p.x+p.w,y:p.y+u,z:p.z+v,w:3,d:w,h};m=[C,-S]}
  abox(g,sb,c);
  const fs=Math.min(h*.62,w/(Math.max(1,text.length)*.7)), base=(h-fs*.72)/2;
  const o=face==='L'?facePt(sb,'L',w/2,base):facePt(sb,'R',w/2,base);
  const t=el('text',{x:0,y:0,'text-anchor':'middle','font-size':fs.toFixed(1),'font-weight':800,'font-family':'Onest,system-ui,sans-serif','letter-spacing':'.06em',fill:'#ffffff',
    transform:`matrix(${m[0]},${m[1]},0,1,${o[0].toFixed(1)},${o[1].toFixed(1)})`},g);
  t.textContent=text;
  if(LIGHTS){const tt=t.cloneNode(true);tt.setAttribute('fill','#fff6d8');tt.setAttribute('class','lit');LIGHTS.appendChild(tt)}
}
function roofGarden(g,p,u,v,w,d){
  const top=p.z+p.h, X=p.x+u, Y=p.y+v;
  box(g,{x:X,y:Y,z:top,w,d,h:5,ct:'#a2d65c',cl:'#ece6d8',cr:'#d8d0bf'});
  const items=[];
  for(let i=0;i<Math.floor(w/9);i++)for(let j=0;j<Math.floor(d/9);j++){
    const r=rnd1(++LITN), x=X+4.5+i*9+(rnd1(++LITN)-.5)*3, y=Y+4.5+j*9+(rnd1(++LITN)-.5)*3;
    if(r<.55)items.push([x,y,'bush',rnd1(++LITN)]);else if(r<.85)items.push([x,y,'flower',rnd1(++LITN)]);
  }
  items.sort((a,b)=>(a[0]+a[1])-(b[0]+b[1])).forEach(([x,y,k,q])=>{
    const [cx,cy]=P(x,y,top+5);
    if(k==='bush'){const r=3.6+q*2.4;
      el('circle',{cx:cx+r*.4,cy:cy-r*.5,r:r*.8,fill:'#5fae22'},g);el('circle',{cx:cx-r*.2,cy:cy-r*.8,r,fill:'#7cc832'},g);el('circle',{cx:cx-r*.45,cy:cy-r*1.1,r:r*.45,fill:'#a5e05a'},g);}
    else [[-2.5,0],[2,-1.5],[0,2]].forEach(([dx,dy])=>el('circle',{cx:cx+dx,cy:cy+dy-1,r:1.8,fill:FLOWERS[Math.floor(q*FLOWERS.length)]},g));
  });
}
function solarPanels(g,p,u,v,rows,cols){
  const top=p.z+p.h;
  for(let j=rows-1;j>=0;j--)for(let i=0;i<cols;i++){
    const x=p.x+u+i*17, y=p.y+v+j*20;
    box(g,{x,y,z:top,w:14,d:17,h:4,ct:'#3b62b3',cl:'#d3d8de',cr:'#bcc2c9'});
    [[P(x+7,y,top+4),P(x+7,y+17,top+4)],[P(x,y+8.5,top+4),P(x+14,y+8.5,top+4)]].forEach(([a,b2])=>el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#8fb2f0','stroke-width':.9,opacity:.8},g));
    poly(g,[P(x+1,y+1,top+4),P(x+5,y+1,top+4),P(x+1,y+6,top+4)],'#ffffff',{opacity:.35,stroke:'none'});
  }
}
function flag(g,p,u,v,c){
  const top=p.z+p.h, x=p.x+u, y=p.y+v, a=P(x,y,top), b2=P(x,y,top+48);
  el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#c5cad0','stroke-width':2},g);
  el('circle',{cx:b2[0],cy:b2[1]-1.5,r:2.2,fill:'#ffd84a'},g);
  const f=el('g',{},g);
  poly(f,[P(x,y,top+46),P(x+12,y,top+47),P(x+24,y,top+44),P(x+24,y,top+32),P(x+12,y,top+35),P(x,y,top+34)],c);
  poly(f,[P(x,y,top+41),P(x+12,y,top+42),P(x+24,y,top+39),P(x+24,y,top+36),P(x+12,y,top+39),P(x,y,top+38)],'#ffffff',{opacity:.9});
}
function antenna(g,p,u,v){
  const top=p.z+p.h, x=p.x+u, y=p.y+v, a=P(x,y,top), b2=P(x,y,top+58);
  box(g,{x:x-4,y:y-4,z:top,w:8,d:8,h:4});
  el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#b9bfc6','stroke-width':2.2},g);
  [30,42].forEach(h=>{const q=P(x,y,top+h);el('line',{x1:q[0]-7,y1:q[1]+2,x2:q[0]+7,y2:q[1]-2,stroke:'#b9bfc6','stroke-width':1.6},g)});
  el('circle',{cx:b2[0],cy:b2[1],r:3,fill:'#ff3b5c',class:'blink'},LIGHTS||g);
}
function waterTank(g,p,u,v,c='#d39a62'){
  const top=p.z+p.h, x=p.x+u, y=p.y+v, r=11, rx=r*C*Math.SQRT2*.82, ry=r*S*Math.SQRT2*.82;
  [[-6,-6],[6,-6],[-6,6],[6,6]].forEach(([dx,dy])=>{const a=P(x+dx,y+dy,top),b2=P(x+dx,y+dy,top+10);el('line',{x1:a[0],y1:a[1],x2:b2[0],y2:b2[1],stroke:'#9aa2ab','stroke-width':2},g)});
  const [bx,by]=P(x,y,top+10), ty=by-24;
  el('ellipse',{cx:bx,cy:by,rx,ry,fill:shade(c,.8)},g);
  el('rect',{x:bx-rx,y:ty,width:rx,height:by-ty,fill:c},g);
  el('rect',{x:bx,y:ty,width:rx,height:by-ty,fill:shade(c,.82)},g);
  [8,16].forEach(h=>el('line',{x1:bx-rx,y1:by-h,x2:bx+rx,y2:by-h,stroke:shade(c,.65),'stroke-width':1.3},g));
  el('ellipse',{cx:bx,cy:ty,rx,ry,fill:shade(c,1.2)},g);
  el('path',{d:`M${bx-rx-1},${ty} L${bx},${ty-13} L${bx+rx+1},${ty} A${rx+1},${ry} 0 0 1 ${bx-rx-1},${ty} Z`,fill:shade(c,.7)},g);
  el('path',{d:`M${bx-rx-1},${ty} L${bx},${ty-13} L${bx},${ty+ry} A${rx+1},${ry} 0 0 1 ${bx-rx-1},${ty} Z`,fill:shade(c,.88)},g);
}
function parasol(g,x,y,c){
  const z=7, [px,py]=P(x,y,z);
  el('ellipse',{cx:px+4,cy:py+2,rx:20,ry:9,fill:'#4f5863',opacity:.14},g);
  box(g,{x:x-5,y:y-5,z,w:10,d:10,h:12,ct:'#ffffff',cl:'#f1f2f4',cr:'#dfe2e6'});
  const t=P(x,y,z+34);el('line',{x1:px,y1:py,x2:t[0],y2:t[1],stroke:'#9aa2ab','stroke-width':1.8},g);
  const rim=isoCircle(x,y,z+30,19,10), apex=P(x,y,z+40);
  rim.map((q,i)=>({i,q,n:rim[(i+1)%10],d:Math.cos((i+.5)/10*Math.PI*2)+Math.sin((i+.5)/10*Math.PI*2)}))
     .sort((a,b)=>a.d-b.d).forEach(({i,q,n})=>poly(g,[apex,q,n],i%2?'#ffffff':c,{'stroke-width':.5}));
}
function bench(g,x,y){
  const z=7, wd={ct:'#e3a86b',cl:'#c98a4f',cr:'#b0743d'};
  box(g,{x,y,z,w:3,d:7,h:6,ct:'#8d959e',cl:'#7b838c',cr:'#6b737c'});box(g,{x:x+21,y,z,w:3,d:7,h:6,ct:'#8d959e',cl:'#7b838c',cr:'#6b737c'});
  box(g,Object.assign({x,y,z:z+8,w:24,d:2,h:9},wd));
  box(g,Object.assign({x,y,z:z+6,w:24,d:8,h:2},wd));
}
function flowerbed(g,x,y,w,d){
  const z=7;
  box(g,{x,y,z,w,d,h:6,ct:'#78bb34',cl:'#ffffff',cr:'#e4e7ea'});
  for(let i=0;i<Math.floor(w/5);i++)for(let j=0;j<Math.floor(d/5);j++){
    const q=P(x+2.5+i*5,y+2.5+j*5,z+6);el('circle',{cx:q[0],cy:q[1]-1.5,r:1.9,fill:FLOWERS[Math.floor(rnd1(++LITN)*FLOWERS.length)]},g);
  }
}

function drawExtras(g,b,T){
  const c=b.accent||'#ff6b4a', part=e=>T.parts[e.part||'main']||Object.values(T.parts)[0], ground=[];
  if(!T.noBand)Object.values(T.parts).forEach(p=>accentBand(g,p,c));
  (b.extras||[]).forEach(e=>{
    const p=part(e), col=e.color||c;
    switch(e.type){
      case 'awning':      awning(g,p,FACE(e.face),e.u??6,e.w??40,e.z??40,col);break;
      case 'balcony':     balcony(g,p,FACE(e.face),e.u??6,e.w??40,e.z??60,col);break;
      case 'shopfront':   shopfront(g,p,FACE(e.face),e.u??10,e.w??60,col);break;
      case 'sign':        sign(g,p,FACE(e.face),e.u??10,e.w??60,e.v??p.h-34,e.h??24,String(e.text||'SIGN').slice(0,10),col);break;
      case 'roofGarden':  roofGarden(g,p,e.u??10,e.v??10,e.w??40,e.d??40);break;
      case 'solarPanels': solarPanels(g,p,e.u??10,e.v??10,e.rows??2,e.cols??3);break;
      case 'flag':        flag(g,p,e.u??10,e.v??10,col);break;
      case 'antenna':     antenna(g,p,e.u??20,e.v??20);break;
      case 'waterTank':   waterTank(g,p,e.u??20,e.v??20,e.color);break;
      case 'parasol': case 'bench': case 'flowerbed': ground.push(e);break;
    }
  });
  return ground;
}
function drawPadLife(g,b,T,items){
  const c=b.accent||'#ff6b4a';
  const all=[...(T.trees||[]).map(t=>({type:'tree',x:t[0],y:t[1],s:t[2]})),...items];
  all.sort((a,b2)=>(a.x+a.y+(a.d||0))-(b2.x+b2.y+(b2.d||0))).forEach(e=>{
    if(e.type==='tree')tree(g,e.x,e.y,e.s);
    else if(e.type==='parasol')parasol(g,e.x,e.y,e.color||c);
    else if(e.type==='bench')bench(g,e.x,e.y);
    else if(e.type==='flowerbed')flowerbed(g,e.x,e.y,e.w??40,e.d??10);
  });
}

return (target, building) => {
  target.replaceChildren();
  const b = {...building, label: building.name, extras: building.extras || []};
  const lift=el('g',{class:'lift'},target);
  const body=el('g',{class:'body'},lift), lights=el('g',{class:'lights'},lift);
  pad(target,lift,body);
  const T=TYPES[b.type];
  GLASS=b.glass||'clear'; LIGHTS=lights; LITN=0;
  SEED=[...b.id].reduce((a,ch)=>(a*31+ch.charCodeAt(0))&65535,7);
  T.draw(body,b);
  drawPadLife(body,b,T,drawExtras(body,b,T));
  LIGHTS=null;
};
}

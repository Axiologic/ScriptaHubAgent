/* One editable vector identity for the homepage and narrated SHF films. */
(() => {
  'use strict';
  const emotions=['neutral','happy','curious','worried','sad','angry','surprised','determined','tired','skeptical','relieved','inspired'];
  const palette={ceramic:'#f2f2df',edge:'#50746e',metal:'#bb9560',ink:'#163e3b',screen:'#133633',mint:'#b8e1cc',coat:'#245e54',dark:'#12584f',paper:'#fff6df'};
  function visual(emotion='curious') {
    let serial=0;
    const n=(type,attrs={},children)=>({id:'$asset.detail'+(++serial),type,attrs,...(typeof children==='string'?{text:children}:children?{children}:{})});
    const g=(id,children,extra={})=>({id:'$asset.'+id,type:'g',attrs:{},children,...extra});
    const r=(x,y,width,height,rx,fill,stroke=palette.edge)=>n('rect',{x,y,width,height,rx,fill,stroke,'stroke-width':1.5});
    const c=(cx,cy,rad,fill)=>n('circle',{cx,cy,r:rad,fill});
    const p=(d,fill='none',stroke=palette.edge,w=2)=>n('path',{d,fill,stroke,'stroke-width':w,'stroke-linecap':'round','stroke-linejoin':'round'});
    const expressions=emotions.map(e=>{
      const calm=['relieved','happy','inspired'].includes(e),worry=['worried','sad','angry'].includes(e),tilt=e==='curious'||e==='skeptical';
      const eyes=calm?[p('M-40 -270 Q-30 -282 -20 -270','none',palette.mint,5),p('M20 -270 Q30 -282 40 -270','none',palette.mint,5)]:[r(-36,-284,12,worry?17:23,6,palette.mint,'none'),r(24,-284,12,e==='tired'?12:23,6,palette.mint,'none')];
      return g('expression.'+e,[...eyes,p(tilt?'M-42 -295 L-20 -300':'M-42 -297 L-20 -297','none',palette.metal,2.5),p(worry?'M20 -300 L42 -293':'M20 -297 L42 -297','none',palette.metal,2.5),e==='surprised'?n('ellipse',{cx:0,cy:-249,rx:7,ry:9,fill:palette.mint}):p(worry?'M-12 -243 Q0 -253 12 -243':'M-14 -252 Q0 -240 14 -252','none',palette.mint,3)],{opacity:e===emotion?1:0});
    });
    return {id:'$asset',type:'g',attrs:{},anchors:{left:[-80,-160],right:[82,-155],top:[0,-347],bottom:[0,8],center:[0,-165]},children:[
      g('legL',[r(-37,-78,27,63,12,palette.dark),r(-48,-25,45,25,11,palette.ceramic)]),
      g('legR',[r(10,-78,27,63,12,palette.dark),r(3,-25,45,25,11,palette.ceramic)]),
      g('torso',[r(-19,-218,38,31,10,palette.metal),p('M-43 -199 Q0 -214 43 -199 L53 -88 Q0 -60 -53 -88 Z',palette.coat),p('M-35 -194 L-9 -166 L0 -192 L9 -166 L35 -194',palette.ceramic),p('M-12 -190 L0 -184 L12 -190 L12 -178 L0 -183 L-12 -178 Z',palette.metal),p('M0 -177 L0 -94','none',palette.dark,2),r(17,-146,22,31,4,palette.dark),p('M22 -137 L33 -137 M22 -131 L33 -131','none',palette.metal,2),c(-13,-153,3,palette.metal),c(-13,-130,3,palette.metal)]),
      g('armL',[c(-34,-157,15,palette.metal),p('M-42 -154 Q-76 -136 -67 -107','none',palette.coat,22),r(-91,-159,62,89,5,palette.dark),r(-84,-151,47,73,2,palette.paper),r(-91,-159,8,89,2,palette.metal),p('M-74 -134 L-47 -134 M-74 -126 L-53 -126','none',palette.metal,2),r(-87,-95,35,22,9,palette.ceramic)]),
      g('armR',[c(32,-156,15,palette.metal),p('M40 -155 Q76 -149 85 -185','none',palette.coat,22),r(74,-209,28,33,11,palette.ceramic),p('M87 -202 L87 -190','none',palette.edge,2)]),
      g('head',[r(-83,-292,19,44,8,palette.metal),r(64,-292,19,44,8,palette.metal),r(-71,-326,142,116,33,palette.ceramic),r(-60,-310,120,85,25,palette.screen,'#2d655b'),...expressions,g('spectacles',[n('circle',{cx:-30,cy:-274,r:22,fill:'none',stroke:palette.metal,'stroke-width':2.5}),n('circle',{cx:30,cy:-274,r:22,fill:'none',stroke:palette.metal,'stroke-width':2.5}),p('M-8 -274 Q0 -280 8 -274 M-52 -277 L-66 -283 M52 -277 L66 -283','none',palette.metal,2.5)]),c(-51,-226,2,palette.metal),c(51,-226,2,palette.metal)],{origin:[0,-216]})
    ]};
  }
  function svg(emotion='curious') {
    const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const render=node=>`<${node.type} data-part="${node.id.replace('$asset.','')}" ${Object.entries({...node.attrs,...(node.opacity===undefined?{}:{opacity:node.opacity})}).map(([k,v])=>`${k}="${escape(v)}"`).join(' ')}>${node.text?escape(node.text):''}${(node.children||[]).map(render).join('')}</${node.type}>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-125 -345 260 365" aria-hidden="true" focusable="false">${render(visual(emotion))}</svg>`;
  }
  globalThis.ScriptaMascot=Object.freeze({visual,svg,emotions});
})();

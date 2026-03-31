import * as XLSX from 'xlsx';
import './styles.css';

window.XLSX = XLSX;

// ══════════════════════════════════════════
// ESTADO
// ══════════════════════════════════════════
let potreros=[], rotacion=[], rodeoColors={};
let proj=null, canvas, ctx, mapaEl;
let animRAF=null, animando=false;
let animMs=null, animStartMs=0, animEndMs=0, animSpeed=5;
let hoverIdx=null, hoverPrIdx=null;
let curFecha=new Date();
const RCOLS=['#c0392b','#7d3c98','#1a6fa8','#d46b18','#0d7360','#616a13'];

// Vacas: posiciones interpoladas para animación de transición
let vacaStates={}; // {loteNombre: {x,y,tx,ty,progress,moving}}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
window.addEventListener('load',()=>{
  canvas=document.getElementById('cv');
  ctx=canvas.getContext('2d');
  mapaEl=document.getElementById('mapa');
  resize();
  window.addEventListener('resize',()=>{resize();if(potreros.length){calcProj();draw(curFecha);}});
  canvas.addEventListener('mousemove',onMM);
  canvas.addEventListener('mouseleave',()=>{hoverIdx=null;hideTip();if(!animando)draw(curFecha);});
  setHoy();
});
function resize(){canvas.width=mapaEl.clientWidth;canvas.height=mapaEl.clientHeight;}

// ══════════════════════════════════════════
// STATUS
// ══════════════════════════════════════════
function setS(id,type,msg){
  const el=document.getElementById(id);
  el.className=`sbar ${type}`;
  const dc={idle:'idle',loading:'loading',ok:'ok',err:'err'}[type];
  el.innerHTML=`<div class="sdot ${dc}"></div><span>${msg}</span>`;
}

// ══════════════════════════════════════════
// CARGAR KML
// ══════════════════════════════════════════
function loadKML(input){
  const f=input.files[0];if(!f)return;
  setS('skml','loading',`Leyendo ${f.name}...`);
  const r=new FileReader();
  r.onload=e=>{
    try{
      const doc=new DOMParser().parseFromString(e.target.result,'text/xml');
      potreros=[];
      doc.querySelectorAll('Placemark').forEach(pm=>{
        let nombre='';
        const nn=pm.querySelectorAll('name');
        if(nn.length)nombre=nn[0].textContent.trim();
        pm.querySelectorAll('Data').forEach(d=>{
          if(d.getAttribute('name')==='name'){const v=d.querySelector('value');if(v)nombre=v.textContent.trim();}
        });
        if(!nombre)return;
        let area=null;
        pm.querySelectorAll('Data').forEach(d=>{
          if(d.getAttribute('name')==='area'){const v=d.querySelector('value');if(v)area=parseFloat(v.textContent);}
        });
        let best=[];
        pm.querySelectorAll('coordinates').forEach(ce=>{
          const c=ce.textContent.trim().split(/\s+/).map(x=>{const p=x.split(',');return{lng:parseFloat(p[0]),lat:parseFloat(p[1])};}).filter(c=>!isNaN(c.lng));
          if(c.length>best.length)best=c;
        });
        if(best.length<3)return;
        const cx=best.reduce((s,c)=>s+c.lng,0)/best.length;
        const cy=best.reduce((s,c)=>s+c.lat,0)/best.length;
        potreros.push({nombre,coords:best,area,centroide:{lng:cx,lat:cy}});
      });
      if(!potreros.length){setS('skml','err','No se encontraron potreros');return;}
      setS('skml','ok',`✓ ${potreros.length} potreros`);
      document.getElementById('empty').style.display='none';
      calcProj();draw(curFecha);checkAnim();
    }catch(e){setS('skml','err','Error: '+e.message);}
  };
  r.readAsText(f);
}

// ══════════════════════════════════════════
// CARGAR EXCEL — LEE PLANILLA DEL PASTOR Y TABLERO
// ══════════════════════════════════════════
function loadExcel(input){
  const f=input.files[0];if(!f)return;
  setS('sxl','loading',`Leyendo ${f.name}...`);
  const r=new FileReader();
  r.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
      rotacion=[];
      const rSet=new Set();
      let metodo='';

      const pastSheets=wb.SheetNames.filter(s=>s.toLowerCase().includes('pastor'));

      pastSheets.forEach(sn=>{
        const ws=wb.Sheets[sn];
        const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});

        let rodeo=sn;
        for(let r=0;r<Math.min(6,data.length);r++){
          if(!data[r])continue;
          for(const v of data[r]){
            if(typeof v==='string'&&v.length>2&&!v.includes('=')&&!v.includes('http')&&!v.includes('PLANILLA')){
              const vl=v.toLowerCase();
              if(vl.includes('rodeo')||vl.includes('vaca')||vl.includes('madre')||vl.includes('toro')||vl.includes('novillo')||vl.includes('ternero')||vl.includes('vaquillona')||vl.includes('célula'))
                {rodeo=v.trim();}
            }
          }
        }

        let cL=-1,cFE=-1,cFS=-1,cD=-1,cSup=-1;
        for(let r=0;r<data.length;r++){
          const row=data[r];if(!row)continue;

          const vals=row.map(v=>String(v??'').toLowerCase().trim());
          if(vals.includes('lote')&&(vals.some(v=>v.includes('fecha ent'))||vals.some(v=>v==='fecha ent'))){
            cL=vals.indexOf('lote');
            cFE=vals.findIndex(v=>v.includes('fecha ent'));
            cFS=vals.findIndex(v=>v.includes('fecha sal'));
            cD=vals.findIndex(v=>v==='días'||v==='dias');
            cSup=vals.findIndex(v=>v.includes('supl'));
            continue;
          }

          if(cL===-1)continue;

          const lv=row[cL];
          if(lv===null||lv===undefined||typeof lv==='boolean')continue;
          if(typeof lv==='string'&&(lv.includes('PLANIFICADO')||lv.includes('REAL')||lv.toLowerCase().includes('lote')))continue;

          const loteStr=String(lv).trim();
          if(!loteStr||loteStr==='null')continue;

          const feR=row[cFE], fsR=row[cFS];
          if(!feR||!fsR)continue;

          const fEnt=feR instanceof Date?feR:xlDate(feR);
          const fSal=fsR instanceof Date?fsR:xlDate(fsR);
          if(!fEnt||!fSal||isNaN(fEnt.getTime()))continue;
          if(fEnt.getFullYear()>2050||fSal.getFullYear()>2050)continue;

          const dias=cD>=0&&row[cD]?Math.round(Number(row[cD])):null;
          const supl=cSup>=0?row[cSup]:null;
          const lotNum=parseFloat(loteStr);

          rSet.add(rodeo);
          rotacion.push({rodeo,lote:loteStr,lotNum:isNaN(lotNum)?null:lotNum,fechaEntrada:fEnt,fechaSalida:fSal,dias,supl:supl?String(supl):'',orden:rotacion.length});
          metodo='Planilla del Pastor';
        }
      });

      if(rotacion.length===0){
        const tSh=wb.SheetNames.find(s=>s.includes('Tablero')&&!s.includes('OFFLINE'));
        if(tSh){
          const ws=wb.Sheets[tSh];
          const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
          let hRow=-1;
          for(let r=0;r<Math.min(30,data.length);r++){
            if(data[r]&&String(data[r][0]??'').toLowerCase().includes('nombre lote')){hRow=r;break;}
          }
          if(hRow!==-1){
            for(let r=hRow+1;r<data.length;r++){
              const row=data[r];if(!row)continue;
              const lote=row[0],rodeo=row[2]??'Rodeo';
              if(!lote||typeof lote!=='string')continue;
              const loteStr=lote.trim();
              [[11,13],[14,16]].forEach(([ei,si])=>{
                const fe=row[ei],fs=row[si];
                const e=fe instanceof Date?fe:xlDate(fe);
                const s=fs instanceof Date?fs:xlDate(fs);
                if(e&&s&&e.getFullYear()<2050&&s.getFullYear()<2050){
                  rSet.add(String(rodeo).trim());
                  rotacion.push({rodeo:String(rodeo).trim(),lote:loteStr,lotNum:null,fechaEntrada:e,fechaSalida:s,dias:Math.round((s-e)/86400000),supl:'',orden:rotacion.length});
                }
              });
            }
            metodo='5. Tablero';
          }
        }
      }

      if(rotacion.length===0){
        setS('sxl','err','No encontré datos. Verificá que el archivo tenga "Planilla del Pastor" o "5. Tablero"');
        return;
      }

      rotacion.sort((a,b)=>a.fechaEntrada-b.fechaEntrada);

      const rArr=[...rSet];
      rArr.forEach((r,i)=>{rodeoColors[r]=RCOLS[i%RCOLS.length];});

      animStartMs=Math.min(...rotacion.map(r=>r.fechaEntrada.getTime()));
      animEndMs=Math.max(...rotacion.map(r=>r.fechaSalida.getTime()));
      animMs=animStartMs;
      document.getElementById('tls').textContent=fmtC(new Date(animStartMs));
      document.getElementById('tle').textContent=fmtC(new Date(animEndMs));
      document.getElementById('tlblk').style.display='block';

      document.getElementById('rlist').innerHTML=rArr.map(r=>`<div class="rchip"><div class="rdot" style="background:${rodeoColors[r]}"></div>${r}</div>`).join('');

      const nLotes=new Set(rotacion.map(r=>r.lote)).size;
      setS('sxl','ok',`✓ ${nLotes} lotes · ${rotacion.length} movimientos · ${rArr.length} rodeo${rArr.length>1?'s':''} (${metodo})`);

      buildPanelPastor();
      if(potreros.length)draw(curFecha);
      checkAnim();
    }catch(err){setS('sxl','err','Error: '+err.message);console.error(err);}
  };
  r.readAsArrayBuffer(f);
}

function xlDate(v){
  if(v instanceof Date)return v;
  if(typeof v==='number')return new Date(Math.floor(v-25569)*86400000);
  if(typeof v==='string'){const d=new Date(v);return isNaN(d)?null:d;}
  return null;
}
function checkAnim(){document.getElementById('abtn').disabled=!(potreros.length&&rotacion.length);}

function buildPanelPastor(){
  const body=document.getElementById('prbody');
  document.querySelector('.pr-sub').textContent=`${rotacion.length} movimientos`;
  body.innerHTML='';
  rotacion.forEach((m,i)=>{
    const div=document.createElement('div');
    div.className='pr-row';
    div.dataset.idx=i;
    div.innerHTML=`
      <div class="pr-num">${i+1}</div>
      <div class="pr-info">
        <div class="pr-lote">${nomPotrero(m)}</div>
        <div class="pr-dates">${fmtC(m.fechaEntrada)} → ${fmtC(m.fechaSalida)}</div>
        ${m.supl?`<div class="pr-dias">${m.supl}</div>`:''}
      </div>
      <div>
        <div class="pr-badge pb-sin" id="pbadge-${i}">—</div>
        <div class="pr-dias" id="pdias-${i}">${m.dias?m.dias+'d':''}</div>
      </div>`;
    div.addEventListener('mouseenter',()=>{hoverPrIdx=i;updatePanelHighlight();if(!animando)draw(curFecha);});
    div.addEventListener('mouseleave',()=>{hoverPrIdx=null;updatePanelHighlight();if(!animando)draw(curFecha);});
    body.appendChild(div);
  });
  updatePanelBadges(curFecha);
}

function updatePanelBadges(fecha){
  rotacion.forEach((m,i)=>{
    const pbEl=document.getElementById(`pbadge-${i}`);
    const pdEl=document.getElementById(`pdias-${i}`);
    const row=document.querySelector(`.pr-row[data-idx="${i}"]`);
    if(!pbEl||!row)return;
    const fc=new Date(fecha);fc.setHours(12);
    const fE=new Date(m.fechaEntrada);fE.setHours(0);
    const fS=new Date(m.fechaSalida);fS.setHours(23,59,59);
    row.className='pr-row';
    if(fc>=fE&&fc<=fS){
      row.classList.add('oc');
      pbEl.className='pr-badge pb-oc'; pbEl.textContent='Ocupado';
      const diasR=Math.ceil((fS-fc)/86400000);
      pdEl.textContent=`Sale en ${diasR}d`;
    } else if(fc<fE){
      const dias=Math.ceil((fE-fc)/86400000);
      row.classList.add('pro');
      pbEl.className='pr-badge pb-pro'; pbEl.textContent='Próximo';
      pdEl.textContent=`Entra en ${dias}d`;
    } else {
      row.classList.add('des');
      pbEl.className='pr-badge pb-des'; pbEl.textContent='Pasado';
      const diasD=Math.floor((fc-fS)/86400000);
      pdEl.textContent=`Hace ${diasD}d`;
    }
  });
}

function updatePanelHighlight(){
  document.querySelectorAll('.pr-row').forEach((r,i)=>{
    r.classList.toggle('hl',i===hoverPrIdx);
  });
}

function nomPotrero(m){
  if(m.lotNum!==null){
    const p=potreros.find(p=>matchLote(p.nombre,m));
    if(p)return p.nombre;
    return `Potrero ${m.lote}`;
  }
  return m.lote;
}

function nm(s){return String(s).toLowerCase().trim().replace(/\s+/g,' ');}
function nmn(s){return String(s).toLowerCase().trim().replace(/potrero\s*/g,'').replace(/lote\s*/g,'').replace(/\s+/g,'');}

function matchLote(potNombre,mov){
  if(nm(potNombre)===nm(mov.lote))return true;
  const pn=nmn(potNombre), mn=nmn(mov.lote);
  if(pn===mn)return true;
  if(mov.lotNum!==null){
    const numStr=String(mov.lotNum);
    if(pn===numStr)return true;
    if(pn.startsWith(numStr)&&pn.length>numStr.length&&isNaN(pn[numStr.length]))return true;
  }
  return false;
}

function calcProj(){
  if(!potreros.length)return;
  const W=canvas.width,H=canvas.height;
  let ml=1e9,xl=-1e9,mb=1e9,xb=-1e9;
  potreros.forEach(p=>p.coords.forEach(c=>{
    if(c.lng<ml)ml=c.lng;if(c.lng>xl)xl=c.lng;
    if(c.lat<mb)mb=c.lat;if(c.lat>xb)xb=c.lat;
  }));
  const pad=52,sh=40;
  const sx=(W-pad*2)/(xl-ml),sy=(H-pad*2-sh)/(xb-mb);
  const sc=Math.min(sx,sy);
  const ox=(W-(xl-ml)*sc)/2,oy=(H-sh-(xb-mb)*sc)/2;
  proj={ox,oy,sc,ml,mb,W,H,sh};
  const toXY=(lng,lat)=>({x:(lng-ml)*sc+ox,y:H-sh-((lat-mb)*sc+oy)});
  potreros.forEach(p=>{
    p.px=p.coords.map(c=>toXY(c.lng,c.lat));
    p.cpx=toXY(p.centroide.lng,p.centroide.lat);
  });
}

function getEst(p,fecha){
  const fc=new Date(fecha);fc.setHours(12);

  for(const m of rotacion){
    if(!matchLote(p.nombre,m))continue;
    const fE=new Date(m.fechaEntrada);fE.setHours(0);
    const fS=new Date(m.fechaSalida);fS.setHours(23,59,59);
    if(fc>=fE&&fc<=fS)return{tipo:'ocupado',rodeo:m.rodeo,fEnt:m.fechaEntrada,fSal:m.fechaSalida,diasRest:Math.ceil((fS-fc)/86400000),mov:m};
  }

  let proxMov=null;
  for(const m of rotacion){
    if(!matchLote(p.nombre,m))continue;
    const fE=new Date(m.fechaEntrada);fE.setHours(0);
    if(fE>fc){
      if(!proxMov||fE<new Date(proxMov.fechaEntrada))proxMov=m;
    }
  }

  let ultSal=null;
  for(const m of rotacion){
    if(!matchLote(p.nombre,m))continue;
    const fS=new Date(m.fechaSalida);
    if(fS<fc&&(!ultSal||fS>ultSal))ultSal=fS;
  }

  if(ultSal||proxMov){
    return{tipo:'descanso',diasDesc:ultSal?Math.floor((fc-ultSal)/86400000):null,prox:proxMov};
  }
  return{tipo:'sin'};
}

function getProximoGlobal(fecha){
  const fc=new Date(fecha);fc.setHours(12);
  let mejor=null;
  for(const m of rotacion){
    const fE=new Date(m.fechaEntrada);fE.setHours(0);
    if(fE>fc){
      if(!mejor||fE<new Date(mejor.fechaEntrada))mejor=m;
    }
  }
  return mejor;
}

const FCOL={ocupado:r=>rodeoColors[r]||'#c0392b',descanso:()=>'#3a7a33',sin:()=>'#3a5030'};

function draw(fecha){
  if(!proj||!potreros.length)return;
  curFecha=fecha;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#253d1c';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle='rgba(255,255,255,.022)';ctx.lineWidth=1;
  for(let x=0;x<canvas.width;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
  for(let y=0;y<canvas.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}

  const proxGlobal=getProximoGlobal(fecha);
  let nOc=0,nDes=0,nPro=0;

  potreros.forEach((p,i)=>{
    const est=getEst(p,fecha);
    const isH=hoverIdx===i||hoverPrIdx!==null&&rotacion[hoverPrIdx]&&matchLote(p.nombre,rotacion[hoverPrIdx]);
    let col=FCOL[est.tipo]?.(est.rodeo)||'#3a5030';

    let esPro=false;
    if(est.tipo==='descanso'&&proxGlobal&&matchLote(p.nombre,proxGlobal)){
      col='#d46b18';esPro=true;
    }

    ctx.save();
    ctx.shadowColor='rgba(0,0,0,.42)';ctx.shadowBlur=isH?16:6;ctx.shadowOffsetX=1;ctx.shadowOffsetY=2;
    ctx.beginPath();
    p.px.forEach((pt,j)=>j?ctx.lineTo(pt.x,pt.y):ctx.moveTo(pt.x,pt.y));
    ctx.closePath();
    ctx.fillStyle=col;ctx.globalAlpha=isH?1:.88;ctx.fill();
    ctx.restore();

    if(est.tipo==='descanso'&&!esPro){
      ctx.save();
      ctx.beginPath();p.px.forEach((pt,j)=>j?ctx.lineTo(pt.x,pt.y):ctx.moveTo(pt.x,pt.y));ctx.closePath();ctx.clip();
      ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1;
      for(let d=-200;d<300;d+=14){ctx.beginPath();ctx.moveTo(p.cpx.x+d-100,p.cpx.y-100);ctx.lineTo(p.cpx.x+d+100,p.cpx.y+100);ctx.stroke();}
      ctx.restore();
    }

    ctx.beginPath();p.px.forEach((pt,j)=>j?ctx.lineTo(pt.x,pt.y):ctx.moveTo(pt.x,pt.y));ctx.closePath();
    if(isH){ctx.strokeStyle='rgba(160,255,130,.7)';ctx.lineWidth=3.5;ctx.stroke();}
    ctx.strokeStyle='rgba(255,255,255,.38)';ctx.lineWidth=1.5;ctx.stroke();

    ctx.save();
    ctx.font='500 10.5px "IBM Plex Mono",monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='rgba(255,255,255,.9)';ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=5;
    const lbl=p.nombre.replace(/[Pp]otrero\s*/,'P').replace(/[Ll]ote\s*/,'L');
    ctx.fillText(lbl,p.cpx.x,p.cpx.y+(est.tipo==='ocupado'?10:0));
    ctx.restore();

    if(est.tipo==='ocupado')nOc++;
    else if(est.tipo==='descanso')nDes++;
    if(esPro)nPro++;
  });

  if(rotacion.length){
    drawFlechaMovimiento(fecha,proxGlobal);
    drawVacas(fecha);
  }

  document.getElementById('noc').textContent=nOc;
  document.getElementById('ndes').textContent=nDes;
  document.getElementById('npro').textContent=nPro;
  document.getElementById('ntot').textContent=potreros.length;
  document.getElementById('bsts').style.display='flex';
  document.getElementById('fbadge').style.display='block';
  document.getElementById('fbf').textContent=fmtF(fecha);
  document.getElementById('fbd').textContent=fmtD(fecha);
  updatePanelBadges(fecha);
}

function drawFlechaMovimiento(fecha,proxGlobal){
  if(!proxGlobal)return;
  const fc=new Date(fecha);fc.setHours(12);
  let loteActual=null;
  for(const m of rotacion){
    const fE=new Date(m.fechaEntrada);fE.setHours(0);
    const fS=new Date(m.fechaSalida);fS.setHours(23,59,59);
    if(fc>=fE&&fc<=fS){
      loteActual=m;break;
    }
  }
  if(!loteActual)return;
  const pOrig=potreros.find(p=>matchLote(p.nombre,loteActual));
  const pDest=potreros.find(p=>matchLote(p.nombre,proxGlobal));
  if(!pOrig||!pDest||pOrig===pDest)return;

  const ox=pOrig.cpx.x,oy=pOrig.cpx.y;
  const dx=pDest.cpx.x,dy=pDest.cpx.y;
  const t=Date.now()/1000;

  ctx.save();
  ctx.setLineDash([8,6]);
  ctx.lineDashOffset=-(t*30)%14;
  ctx.strokeStyle='rgba(255,200,80,.55)';
  ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(dx,dy);ctx.stroke();
  ctx.setLineDash([]);

  const ang=Math.atan2(dy-oy,dx-ox);
  const ax=dx-Math.cos(ang)*18,ay=dy-Math.sin(ang)*18;
  ctx.fillStyle='rgba(255,200,80,.75)';
  ctx.beginPath();
  ctx.moveTo(dx,dy);
  ctx.lineTo(ax-Math.cos(ang-0.4)*12,ay-Math.sin(ang-0.4)*12);
  ctx.lineTo(ax-Math.cos(ang+0.4)*12,ay-Math.sin(ang+0.4)*12);
  ctx.closePath();ctx.fill();

  const mx=(ox+dx)/2,my=(oy+dy)/2-10;
  ctx.font='500 10px "IBM Plex Mono",monospace';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,200,80,.9)';
  ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=4;
  const diasHasta=Math.ceil((new Date(proxGlobal.fechaEntrada)-new Date(fecha))/86400000);
  ctx.fillText(`→ ${pDest.nombre.replace(/[Pp]otrero /,'P')} en ${diasHasta}d`,mx,my);
  ctx.restore();
}

function drawVacas(fecha){
  const t=Date.now()/1000;
  potreros.forEach(p=>{
    const est=getEst(p,fecha);
    if(est.tipo!=='ocupado')return;
    const col=rodeoColors[est.rodeo]||'#c0392b';
    const n=p.area?Math.min(5,Math.max(1,Math.floor(p.area/12))):2;
    for(let k=0;k<n;k++){
      const ang=(k/n)*Math.PI*2+t*0.22*(k%2?1:-1);
      const r=13+k*7;
      const vx=p.cpx.x+Math.cos(ang)*r*0.5;
      const vy=p.cpx.y-16+Math.sin(ang)*r*0.3;
      const bob=Math.sin(t*3.2+k*1.1)*1.4;
      drawVacaRealista(vx,vy+bob,col,t+k*0.9,k);
    }
  });
}

function drawVacaRealista(cx,cy,color,t,seed){
  const s=1;
  ctx.save();
  ctx.translate(cx,cy);

  ctx.beginPath();ctx.ellipse(0,13*s,11*s,2.5*s,0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,.22)';ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0,3*s,11*s,6.5*s,0,0,Math.PI*2);
  ctx.fillStyle='#f5f5f0';ctx.fill();
  ctx.strokeStyle=color;ctx.lineWidth=1.3;ctx.stroke();

  ctx.save();
  ctx.beginPath();ctx.ellipse(0,3*s,11*s,6.5*s,0,0,Math.PI*2);ctx.clip();
  const manchas=[[3,1,3.5,2.5,0.4],[-3.5,5,2.5,2,0.2],[1.5,-1,2,1.5,0.3]];
  manchas.forEach(([mx,my,rx,ry,a])=>{
    ctx.beginPath();ctx.ellipse(mx*s,my*s,rx*s,ry*s,a,0,Math.PI*2);
    ctx.fillStyle=color;ctx.globalAlpha=.65;ctx.fill();ctx.globalAlpha=1;
  });
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(8*s,-1*s);ctx.quadraticCurveTo(12*s,-2*s,12*s,-5*s);
  ctx.quadraticCurveTo(12*s,-7*s,10*s,-7*s);ctx.quadraticCurveTo(8*s,-7*s,8*s,-3*s);
  ctx.closePath();ctx.fillStyle='#f0f0eb';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();

  ctx.beginPath();ctx.ellipse(12*s,-8*s,4.5*s,3.8*s,0.2,0,Math.PI*2);
  ctx.fillStyle='#f0f0eb';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1.3;ctx.stroke();

  ctx.beginPath();ctx.ellipse(15.5*s,-7*s,2.2*s,1.6*s,0.1,0,Math.PI*2);
  ctx.fillStyle='#e8c4b8';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=0.8;ctx.stroke();
  ctx.beginPath();ctx.arc(14.8*s,-7*s,.5*s,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,.4)';ctx.fill();
  ctx.beginPath();ctx.arc(16.2*s,-7.2*s,.5*s,0,Math.PI*2);ctx.fill();

  ctx.beginPath();ctx.arc(12.5*s,-9.5*s,1.1*s,0,Math.PI*2);ctx.fillStyle='#1a1a0a';ctx.fill();
  ctx.beginPath();ctx.arc(12.8*s,-9.8*s,.35*s,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.7)';ctx.fill();

  ctx.beginPath();ctx.ellipse(10.5*s,-11.5*s,1.8*s,1.2*s,-0.5,0,Math.PI*2);
  ctx.fillStyle='#e8c4b8';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=0.8;ctx.stroke();

  ctx.beginPath();ctx.moveTo(10*s,-12*s);ctx.quadraticCurveTo(9*s,-15*s,11*s,-14*s);
  ctx.strokeStyle='#c8a870';ctx.lineWidth=1.2;ctx.lineCap='round';ctx.stroke();

  const patas=[[-5.5,8,-4.5],[-1.5,8,4.5],[2.5,8,-4],[6,8,3.5]];
  patas.forEach(([px,py,phase])=>{
    const ext=Math.sin(t*4.2+phase)*2.5;
    ctx.beginPath();
    ctx.moveTo(px*s,py*s);
    ctx.lineTo(px*s+ext*.3,(py+5)*s);
    ctx.lineTo(px*s+ext*.3+0.5,(py+8.5+Math.abs(ext)*.3)*s);
    ctx.strokeStyle=color;ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
    ctx.beginPath();ctx.ellipse(px*s+ext*.3+0.5,(py+9.5)*s,1.5*s,.7*s,.1,0,Math.PI*2);
    ctx.fillStyle='#333';ctx.fill();
  });

  ctx.beginPath();ctx.ellipse(0,10*s,3.5*s,2*s,0,0,Math.PI*2);
  ctx.fillStyle='#e8c4b8';ctx.fill();
  [[-1.5,12],[1.5,12]].forEach(([px,py])=>{
    ctx.beginPath();ctx.moveTo(px*s,py*s);ctx.lineTo(px*s,(py+2)*s);
    ctx.strokeStyle='#d4a090';ctx.lineWidth=1;ctx.stroke();
  });

  const colaSwing=Math.sin(t*2.5)*3;
  ctx.beginPath();ctx.moveTo(-10*s,1*s);
  ctx.quadraticCurveTo(-15*s,-3*s+colaSwing,-12*s,-8*s+colaSwing);
  ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.lineCap='round';ctx.stroke();
  ctx.beginPath();ctx.arc(-12*s,-8.5*s+colaSwing,1.8*s,0,Math.PI*2);
  ctx.fillStyle='#ddd';ctx.fill();

  ctx.restore();
}

function onMM(e){
  const rect=canvas.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  let found=null;
  potreros.forEach((p,i)=>{if(pip(mx,my,p.px))found=i;});
  if(found!==hoverIdx){hoverIdx=found;if(!animando)draw(curFecha);}
  if(found!==null)showTip(e,potreros[found],curFecha);
  else hideTip();
}

function pip(x,y,pts){
  let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y;
    if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}

function showTip(e,p,fecha){
  const tip=document.getElementById('tip');
  const wr=mapaEl.getBoundingClientRect();
  const est=getEst(p,fecha);
  const fc=new Date(fecha);fc.setHours(12);
  const proxGlobal=getProximoGlobal(fecha);
  const esPro=est.tipo==='descanso'&&proxGlobal&&matchLote(p.nombre,proxGlobal);

  let h=`<div class="tt">${p.nombre}</div>`;
  if(p.area)h+=`<div class="tr"><span class="trl">Superficie</span><span class="trv">${p.area.toFixed(1)} ha</span></div>`;

  if(est.tipo==='ocupado'){
    h+=`<div class="tr"><span class="trl">Rodeo</span><span class="trv">${est.rodeo}</span></div>`;
    h+=`<div class="tr"><span class="trl">Ingresó</span><span class="trv">${fmtF(est.fEnt)}</span></div>`;
    h+=`<div class="tr"><span class="trl">Sale</span><span class="trv">${fmtF(est.fSal)}</span></div>`;
    h+=`<div class="tr"><span class="trl">Días restantes</span><span class="trv">${est.diasRest} días</span></div>`;
    if(est.mov?.supl)h+=`<div class="tr"><span class="trl">Suplemento</span><span class="trv">${est.mov.supl}</span></div>`;
    h+=`<span class="tbg toc">🐄 Con animales</span>`;
  } else if(esPro){
    const dias=Math.ceil((new Date(proxGlobal.fechaEntrada)-fc)/86400000);
    h+=`<div class="tr"><span class="trl">Próximo ingreso</span><span class="trv">${fmtF(proxGlobal.fechaEntrada)}</span></div>`;
    h+=`<div class="tr"><span class="trl">Faltan</span><span class="trv">${dias} días</span></div>`;
    h+=`<div class="tr"><span class="trl">Sale el</span><span class="trv">${fmtF(proxGlobal.fechaSalida)}</span></div>`;
    if(proxGlobal.dias)h+=`<div class="tr"><span class="trl">Estadía</span><span class="trv">${proxGlobal.dias} días</span></div>`;
    h+=`<span class="tbg tpro">⏳ Próximo ingreso</span>`;
  } else if(est.tipo==='descanso'){
    h+=`<div class="tr"><span class="trl">Días descansando</span><span class="trv">${est.diasDesc ?? '—'} días</span></div>`;
    if(est.prox){
      const dias=Math.ceil((new Date(est.prox.fechaEntrada)-fc)/86400000);
      h+=`<div class="tr"><span class="trl">Próx. entrada</span><span class="trv">${fmtF(est.prox.fechaEntrada)}</span></div>`;
      h+=`<div class="tr"><span class="trl">Faltan</span><span class="trv">${dias} días</span></div>`;
    }
    h+=`<span class="tbg tdes">🌿 En descanso</span>`;
  } else {
    h+=`<span class="tbg tsin">Sin datos en planilla</span>`;
  }
  tip.innerHTML=h;tip.classList.add('vis');
  let tx=e.clientX-wr.left+14,ty=e.clientY-wr.top+14;
  if(tx+260>wr.width)tx=e.clientX-wr.left-265;
  if(ty+240>wr.height)ty=e.clientY-wr.top-240;
  tip.style.left=tx+'px';tip.style.top=ty+'px';
}
function hideTip(){document.getElementById('tip').classList.remove('vis');}

function toggleAnim(){animando?stopAnim():startAnim();}

function startAnim(){
  if(!rotacion.length||!potreros.length)return;
  animando=true;
  document.getElementById('abtn').classList.add('on');
  document.getElementById('aico').textContent='■';
  document.getElementById('albl').textContent='Detener simulación';
  document.getElementById('asts').classList.add('vis');
  if(!animMs||animMs>=animEndMs-86400000)animMs=animStartMs;
  let last=null;
  function loop(ts){
    if(!animando)return;
    if(!last)last=ts;
    animMs+=((ts-last)/1000)*animSpeed*2.5*86400000;
    last=ts;
    if(animMs>=animEndMs){
      animMs=animEndMs;const f=new Date(animMs);
      document.getElementById('datePick').value=isoD(f);
      draw(f);updAnim(1,f);stopAnim();return;
    }
    const f=new Date(animMs);
    document.getElementById('datePick').value=isoD(f);
    updAnim((animMs-animStartMs)/(animEndMs-animStartMs),f);
    draw(f);
    animRAF=requestAnimationFrame(loop);
  }
  animRAF=requestAnimationFrame(loop);
}

function stopAnim(){
  animando=false;
  if(animRAF){cancelAnimationFrame(animRAF);animRAF=null;}
  document.getElementById('abtn').classList.remove('on');
  document.getElementById('aico').textContent='▶';
  document.getElementById('albl').textContent='Simular rotación';
  document.getElementById('asts').classList.remove('vis');
}

function updAnim(prog,f){
  document.getElementById('asfi').style.width=(prog*100).toFixed(1)+'%';
  document.getElementById('asl').textContent='SIMULANDO · '+fmtF(f);
  document.getElementById('tlfi').style.width=(prog*100).toFixed(1)+'%';
}
function setSp(v){animSpeed=parseInt(v);document.getElementById('spv').textContent=v+'×';}

function onDateChange(){
  const v=document.getElementById('datePick').value;if(!v)return;
  const [y,m,d]=v.split('-').map(Number);
  curFecha=new Date(y,m-1,d,12);
  if(potreros.length)draw(curFecha);
}
function setHoy(){
  const h=new Date();document.getElementById('datePick').value=isoD(h);
  curFecha=new Date(h.getFullYear(),h.getMonth(),h.getDate(),12);
  if(potreros.length)draw(curFecha);
}
function isoD(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function fmtF(d){if(!d)return'—';return new Date(d).toLocaleDateString('es-AR',{day:'numeric',month:'short',year:'numeric'});}
function fmtC(d){return new Date(d).toLocaleDateString('es-AR',{day:'numeric',month:'short'});}
function fmtD(d){return new Date(d).toLocaleDateString('es-AR',{weekday:'long'});}

Object.assign(window,{
  loadKML,
  loadExcel,
  onDateChange,
  setHoy,
  toggleAnim,
  setSp,
});

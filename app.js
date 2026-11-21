/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BASE=Date.UTC(2026,10,23,0,0); // 23 Nov 2026 00:00 (naive WITA)
const toMin=s=>{ if(!s) return null; const m=String(s).match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/); if(!m) return null; return (Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5])-BASE)/60000; };
const fromMin=mn=>{ const d=new Date(BASE+Math.round(mn)*60000); const p=n=>String(n).padStart(2,'0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const nowWita=()=>{ const d=new Date(Date.now()+8*3600000); const p=n=>String(n).padStart(2,'0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const fmt=s=>{ if(!s) return '–'; const m=String(s).match(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d)/); return m?`${m[2]}/${m[1]} ${m[3]}`:esc(s); };
const fmtMin=mn=>fmt(fromMin(mn));
const num=v=>{ if(v===''||v==null) return null; const n=Number(v); return isFinite(n)?n:null; };
const r0=v=>Math.round(v);
function toast(msg,ok){ const t=$('#toast'); t.textContent=msg; t.className='toast'+(ok?' okk':''); t.style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>t.style.display='none',4000); }

/* ---------- state ---------- */
let db=null, user=null, myId=null, canWrite=true;
let tasks=[], checks=[], temps=[], rots=[], settings={};
let picF='', showF='all', chkF='all', areaF='';
const AREAS=[{k:'pel',n:'Pelletizing',c:'#7b5ad6',ic:'⚙️'},{k:'kiln',n:'Kiln',c:'#e0602a',ic:'🔥'},{k:'cts',n:'Calcine Transfer Car',c:'#1f6fd1',ic:'🚃'}];
const AIDX=k=>{ const i=AREAS.findIndex(a=>a.k===k); return i<0?9:i; };
const areaOf=t=>t.area3||'kiln';
const areaName=k=>(AREAS.find(a=>a.k===k)||{n:'Umum'}).n;
const areaCol=k=>(AREAS.find(a=>a.k===k)||{c:'#5f6b7c'}).c;
function chkArea(c){ if(c.general) return 'all'; const t=(c.tasks||[]).map(id=>tasks.find(x=>x.id===id)).filter(Boolean); const cnt={}; t.forEach(x=>cnt[areaOf(x)]=(cnt[areaOf(x)]||0)+1); return Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0]||'kiln'; }
const blockOf=t=>t.group==='ops'?'ops':areaOf(t);
const BIDX=t=>t.group==='ops'?-1:AIDX(areaOf(t));
const isWaived=x=>!!x.waiveIf&&taskDone(x.waiveIf);
const openT=t=>t.status!=='selesai'&&!isWaived(t);
const openC=c=>c.result!=='ok'&&!isWaived(c);
const sortedTasks=()=>[...tasks].sort((a,b)=>BIDX(a)-BIDX(b)||(a.order??0)-(b.order??0));
function renderAreas(){
  const card=(k,n,c,ic)=>{
    const ts=tasks.filter(t=>!k||areaOf(t)===k), cs=checks.filter(x=>!k||chkArea(x)===k||(x.general&&!k));
    const dT=ts.filter(t=>t.status==='selesai').length, okC=cs.filter(x=>x.result==='ok').length;
    const bad=ts.filter(t=>t.status==='kendala'||isLate(t)).length+cs.filter(x=>x.result==='nok').length;
    const ready=ts.length&&!ts.some(openT)&&!cs.some(openC);
    const st=ready?'<span class="pill p-ok">Siap</span>':bad?`<span class="pill p-bad">${bad} masalah</span>`:'<span class="pill p-idle">Proses</span>';
    return `<button class="acard ${areaF===k?'on':''}" data-a="${k}" style="--ac:${c}"><div class="an"><span class="ai">${ic}</span>${esc(n)}</div><span class="st">${st}</span>
      <div class="row2"><span><b>${dT}/${ts.length}</b> pekerjaan</span><span><b>${okC}/${cs.length}</b> cek OK</span></div>
      <div class="bar" style="--c:${c}"><i style="width:${ts.length?dT/ts.length*100:0}%"></i></div></button>`;
  };
  $('#areas').innerHTML=card('','Semua area','#14a397','🏭')+AREAS.map(a=>card(a.k,a.n,a.c,a.ic)).join('');
}
$('#areas').addEventListener('click',e=>{ const b=e.target.closest('.acard'); if(!b) return; areaF=b.dataset.a; renderAreas(); renderGantt(); renderTasks(); renderChecks(); });
let chunkSel=0, draftStages=null;
const STATUS={belum:'Belum mulai',jalan:'Berjalan',selesai:'Selesai',kendala:'Kendala'};
const names={};

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('on',v.id==='v-'+b.dataset.v));
  if(b.dataset.v==='temp'){ drawChart(); setTimeout(()=>{ const r=document.querySelector('#hourTbl tr.hnow'); if(r) r.scrollIntoView({block:'center'}); },50); }
  try{ history.replaceState(null,'','#'+b.dataset.v);}catch(e){}
});
const h0=(location.hash||'').slice(1); const tb=document.querySelector(`.tab[data-v="${h0}"]`); if(tb) tb.click();

/* ---------- task / check derived ---------- */
const taskDone=id=>{ const t=tasks.find(x=>x.id===id); return t&&t.status==='selesai'; };
const allTasksDone=()=>tasks.length>0&&tasks.every(t=>t.status==='selesai');
function checkLocked(c){ const ids=c.tasks||[]; if(c.general||ids.length===0) return !allTasksDone(); return !ids.every(taskDone); }
function qtyMet(t){ if(t.qtyTarget==null) return true; const a=num(t.qtyActual); if(a==null) return false; const q=t.qtyTarget; return t.qtyRule==='max'?a<=q:t.qtyRule==='lt'?a<q:t.qtyRule==='gt'?a>q:a>=q; }
const qtyLabel=t=>`${({max:'≤',lt:'<',gt:'>',min:'≥'})[t.qtyRule||'min']} ${String(t.qtyTarget).replace('.',',')} ${t.qtyUnit||''}`;
const isLate=t=>{ const pe=toMin(t.planEnd); return t.status!=='selesai'&&pe!=null&&toMin(nowWita())>pe; };

/* ---------- temperature phase logic ---------- */
const nm1=()=>settings.t1Name||'T1', nm2=()=>settings.t2Name||'T2';
const nmW=w=>w===1?nm1():nm2();
const colW=w=>w===1?'var(--t1)':'var(--t2)';
const valOf=(r,w)=>num(w===1?r.t1:r.t2);
function readings(){ return temps.map(r=>({...r,m:toMin(r.time)})).filter(r=>r.m!=null).sort((a,b)=>a.m-b.m); }
// value of param w at time m: latest reading at/before m within 90 min, else first reading within 30 min after
function valAt(w,m){
  const rs=readings(); let best=null;
  for(const r of rs){ const v=valOf(r,w); if(v!=null&&r.m<=m&&m-r.m<=90) best={v,m:r.m}; }
  if(best) return best;
  for(const r of rs){ const v=valOf(r,w); if(v!=null&&r.m>m&&r.m-m<=30) return {v,m:r.m}; }
  return null;
}
function chunkAt(m,strictBefore){ const rs=readings().filter(r=>strictBefore?r.m<m:r.m<=m); return rs.length?!!rs[rs.length-1].chunk:null; }
const gChunk=()=>settings.chunk===true?true:settings.chunk===false?false:null;
const gW=()=>gChunk()==null?null:(gChunk()?2:1);
function pickCtl(ov,m,strict){ const c=gChunk(); return c==null?{w:null,src:'none'}:{w:c?2:1,src:'auto',chunk:c}; }
function pickCtlOld(ov,m,strict){ if(ov==='T1') return {w:1,src:'manual'}; if(ov==='T2') return {w:2,src:'manual'}; const c=chunkAt(m,strict); if(c==null){ const c2=chunkAt(m+30,false); if(c2==null) return {w:null,src:'none'}; return {w:c2?2:1,src:'auto',chunk:c2}; } return {w:c?2:1,src:'auto',chunk:c}; }
function phaseModel(){
  const s=settings;
  const cs=toMin(s.coolStart), hs=toMin(s.heatStart), run=toMin(s.mRun);
  const coolRate=num(s.coolRate);
  const cc=cs!=null?pickCtl(s.coolCtl,cs,false):{w:null};
  const coolBase=cc.w?valAt(cc.w,cs):null;
  const hc=hs!=null?pickCtl(s.heatCtl,hs,false):{w:null};
  let heatBase=hc.w?valAt(hc.w,hs):null;
  const pts=[], segRates=[];
  let finalTemp=null;
  if(heatBase){
    let m=hs, v=heatBase.v; pts.push({m,v});
    for(const st of (s.heatStages||[])){
      const rate=num(st.rate); let to=num(st.to);
      if(to==null){ const b=valAt(hc.w,cs); to=b?b.v:null; }
      if(!rate||to==null) continue;
      if(to>v){ const m2=m+(to-v)/rate*60; segRates.push({a:m,b:m2,rate}); m=m2; v=to; pts.push({m,v}); }
      const hold=num(st.hold)||0; if(hold>0){ m+=hold*60; pts.push({m,v}); }
      finalTemp=v;
    }
  }
  return {cs,hs,run,coolRate,cc,coolBase,hc,heatBase,pts,segRates,finalTemp,heatEnd:pts.length?pts[pts.length-1].m:null};
}
function phaseAt(m,P){ if(P.cs!=null&&m>=P.cs&&(P.hs==null||m<P.hs)) return 'cool'; if(P.hs!=null&&m>=P.hs&&(P.run==null||m<=P.run)) return 'heat'; return null; }
function ctlAt(m,P,chunk){ return gW()||(chunk?2:1); }
function targetAt(m,P){
  const ph=phaseAt(m,P);
  if(ph==='cool'&&P.cc.w&&P.coolBase&&P.coolRate!=null) return {w:P.cc.w,v:P.coolBase.v-P.coolRate*(m-P.cs)/60,phase:ph};
  if(ph==='heat'&&P.hc.w&&P.pts.length){ const pts=P.pts; let v=pts[pts.length-1].v; for(let i=1;i<pts.length;i++){ if(m<=pts[i].m){ const a=pts[i-1],b=pts[i]; v=a.v+(b.v-a.v)*(m-a.m)/((b.m-a.m)||1); break; } } return {w:P.hc.w,v,phase:ph}; }
  return null;
}
function heatRateLimitAt(m,P){ const s=P.segRates.find(x=>m>=x.a&&m<=x.b+1); return s?s.rate:(P.segRates.length?Math.max(...P.segRates.map(x=>x.rate)):null); }
// evaluate a reading: ctl param, target, deviation, rate vs previous reading of same param
function evalReading(r,P,rs){
  const w=ctlAt(r.m,P,r.chunk), v=valOf(r,w), tg=targetAt(r.m,P), ph=phaseAt(r.m,P);
  const tol=num(settings.tol)??0;
  let dev=null, devFlag='';
  if(v!=null&&tg&&tg.w===w){ dev=v-tg.v;
    if(ph==='cool'&&dev< -tol) devFlag='turun terlalu cepat';
    if(ph==='heat'&&dev>tol) devFlag='naik terlalu cepat';
    if(ph==='heat'&&dev< -tol) devFlag='tertinggal dari target';
  }
  let rate=null, rateFlag='';
  const prev=[...rs].reverse().find(p=>p.m<r.m&&valOf(p,w)!=null&&phaseAt(p.m,P)===ph);
  if(v!=null&&prev&&r.m>prev.m){ rate=(v-valOf(prev,w))/((r.m-prev.m)/60);
    if(ph==='cool'&&P.coolRate!=null&&rate< -P.coolRate) rateFlag=`turun ${r0(-rate)} °C/jam > ${P.coolRate}`;
    if(ph==='heat'){ const lim=heatRateLimitAt(r.m,P); if(lim!=null&&rate>lim) rateFlag=`naik ${r0(rate)} °C/jam > ${lim}`; }
  }
  return {w,v,tg,ph,dev,devFlag,rate,rateFlag};
}
const PHN={cool:'Pendinginan',heat:'Heating up'};

/* ---------- rotation slots ---------- */
function rotSlots(){
  const a=toMin(settings.auxStart), b=toMin(settings.auxEnd); if(a==null||b==null||b<=a) return [];
  const out=[]; for(let m=Math.ceil(a/60)*60;m<b;m+=60){ const id='r'+fromMin(m); const d=rots.find(x=>x.id===id)||{}; out.push({id,m,done:!!d.done,...d}); } return out;
}
function rotState(sl,nowM){ if(sl.done) return 'done'; if(nowM>=sl.m+60) return 'miss'; if(nowM>=sl.m) return 'due'; return 'next'; }

/* ---------- render: header + gate + kpi ---------- */
function renderTop(){
  const nowS=nowWita(), nowM=toMin(nowS);
  $('#clock').textContent='Sekarang '+fmt(nowS)+' WITA';
  const steps=[['Mulai pendinginan',settings.coolStart],['Stop feeding',settings.mStop],['Power off',settings.mOff],['Power on / heating',settings.heatStart||settings.mOn],['Kiln running normal',settings.mRun]];
  let cur=-1; steps.forEach((x,i)=>{ const m=toMin(x[1]); if(m!=null&&nowM>=m) cur=i; });
  $('#strip').innerHTML=steps.map((x,i)=>`<div class="step ${i<cur?'done':i===cur?'now':''}"><div class="k">${x[0]}</div><div class="v">${fmt(x[1])}</div></div>`).join('');

  const nT=tasks.length, dT=tasks.filter(t=>t.status==='selesai').length;
  const nC=checks.length, okC=checks.filter(c=>c.result==='ok').length, nokC=checks.filter(c=>c.result==='nok').length;
  const kend=tasks.filter(t=>t.status==='kendala').length, jal=tasks.filter(t=>t.status==='jalan').length, late=tasks.filter(isLate).length;
  $('#kTask').textContent=nT?`${dT} / ${nT}`:'–';
  $('#kTaskSub').textContent=nT?`${jal} berjalan · ${kend} kendala · ${late} terlambat`:'Belum ada data pekerjaan';
  $('#kTaskBar').style.width=nT?(dT/nT*100)+'%':'0';
  const readyC=checks.filter(c=>!c.result&&!checkLocked(c)).length;
  $('#kCheck').textContent=nC?`${okC} / ${nC}`:'–';
  $('#kCheckSub').textContent=nC?`${nokC} NOK · ${readyC} siap dicek · ${checks.filter(c=>!c.result&&checkLocked(c)).length} terkunci`:'Belum ada item cek';
  $('#kCheckBar').style.width=nC?(okC/nC*100)+'%':'0';
  const cc=$('#cntChk'); const ccn=nokC+readyC; cc.hidden=!ccn; cc.textContent=ccn;

  const sl=rotSlots(), dn=sl.filter(x=>x.done).length, miss=sl.filter(x=>rotState(x,nowM)==='miss').length, due=sl.find(x=>rotState(x,nowM)==='due');
  const nxt=sl.find(x=>rotState(x,nowM)==='next');
  $('#kRot').textContent=sl.length?`${dn} / ${sl.length}`:'–';
  $('#kRotSub').innerHTML=sl.length?(miss?`<span class="pill p-bad">${miss} terlewat</span> `:'')+(due?`<span class="pill p-run">Jam ${fmt(due.time||fromMin(due.m)).slice(6)} belum diputar</span>`:nxt?`Berikutnya ${fmt(fromMin(nxt.m))}`:'Selesai'):'Atur jam di Setting';
  $('#kRotBar').style.width=sl.length?(dn/sl.length*100)+'%':'0';
  const cr=$('#cntRot'); cr.hidden=!(miss||due); cr.textContent=miss+(due?1:0);
  const hm=hourMissing(), ct=$('#cntTemp'); if(ct){ ct.hidden=!hm; ct.textContent=hm; }

  const prep=tasks.filter(t=>t.group==='ops');
  $('#kPrep').innerHTML=prep.length?prep.map(t=>{
    const st=t.status==='selesai'?'<span class="pill p-ok">Selesai</span>':isLate(t)?'<span class="pill p-bad">Terlambat</span>':t.status==='jalan'?'<span class="pill p-run">Berjalan</span>':'<span class="pill p-idle">Belum</span>';
    const q=t.qtyTarget!=null?` <span class="muted">(${t.qtyActual!=null&&t.qtyActual!==''?esc(t.qtyActual):'–'} ${qtyLabel(t)})</span>`:'';
    return `<div class="prep"><span>${esc(t.short||t.work)}${q}</span>${st}</div>`;
  }).join(''):'–';

  const oT=tasks.filter(openT), oC=checks.filter(openC);
  const ready=nT>0&&nC>0&&!oT.length&&!oC.length;
  const reasons=[];
  if(!nT) reasons.push('Data pekerjaan belum dimuat');
  if(oT.length) reasons.push(`${oT.length} pekerjaan belum selesai — `+AREAS.map(a=>{ const n=oT.filter(t=>areaOf(t)===a.k).length; return n?`${a.n}: ${n}`:''; }).filter(Boolean).join(' · ')+(kend?` (${kend} kendala)`:''));
  const nokB=oC.filter(c=>c.result==='nok'); if(nokB.length) reasons.push(`${nokB.length} cek equipment NOK: `+[...new Set(nokB.map(c=>c.equipment))].join(', '));
  const pend=oC.filter(c=>!c.result).length; if(pend) reasons.push(`${pend} cek equipment belum dilakukan`);
  const wv=[...tasks.filter(t=>isWaived(t)&&t.status!=='selesai').map(t=>t.short||t.work),...checks.filter(c=>isWaived(c)&&c.result!=='ok').map(c=>'cek '+c.equipment)];
  const wvTxt=wv.length?`<div class="w small" style="margin-top:6px">Dilewatkan untuk heating up (ada cadangan ore di dry ore bin): ${esc(wv.join(', '))}</div>`:'';
  const warn=miss?`<div class="w small" style="margin-top:6px">Perhatian: ${miss} putaran kiln per jam terlewat – laporkan ke SPV Operation.</div>`:'';
  const g=$('#gate'); g.className='gate '+(ready?'yes':'no');
  g.innerHTML=ready
    ?`<div class="ic">✓</div><div><div class="t">Kiln siap running ✓</div><div class="ink2 small">Semua pekerjaan selesai dan semua equipment sudah dicek OK. Konfirmasi ke CCR sebelum power on.</div>${wvTxt}${warn}</div>`
    :`<div class="ic">!</div><div><div class="t">Kiln belum boleh running</div><ul>${reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>${wvTxt}${warn}</div>`;

  // temperature KPI
  const P=phaseModel(), phNow=phaseAt(nowM,P), rs=readings(), last=rs[rs.length-1];
  let w=null, why='';
  w=gW(); why=gChunk()==null?'Pilih kondisi chunk di tab Temperatur':(gChunk()?'Ada chunk sebelum shutdown':'Tidak ada chunk sebelum shutdown')+(phNow?` · fase ${PHN[phNow].toLowerCase()}`:'');
  let valTxt='';
  if(last){ const e=evalReading(last,P,rs);
    if(e.v!=null){ valTxt=`${esc(nmW(e.w))} ${r0(e.v)} °C pukul ${fmt(last.time).slice(6)}`+(e.tg&&e.tg.w===e.w?` · target ${r0(e.tg.v)}`:'')+(e.rate!=null?` · ${e.rate>0?'+':''}${r0(e.rate)} °C/jam`:'');
      const fl=[e.devFlag,e.rateFlag].filter(Boolean); valTxt+=fl.length?` <span class="pill p-bad">${esc(fl.join('; '))}</span>`:(e.tg?' <span class="pill p-ok">sesuai</span>':''); }
  }
  $('#kMode').innerHTML=w?`Kontrol <span style="color:${colW(w)}">${esc(nmW(w))}</span>`:'–';
  $('#kModeSub').innerHTML=(why?esc(why)+'<br>':'')+(valTxt||'Belum ada pembacaan');
  document.querySelectorAll('.t1name').forEach(e=>e.textContent=nm1());
  document.querySelectorAll('.t2name').forEach(e=>e.textContent=nm2());
}

/* ---------- render: gantt ---------- */
function renderGantt(){
  const S=-4*60, E=24*60, span=E-S;
  const pos=m=>Math.max(0,Math.min(100,(m-S)/span*100));
  let head='<div class="grow"><div></div><div class="ghead">';
  for(let h=-4;h<=24;h+=2) head+=`<span style="left:${pos(h*60)}%">${String((h+24)%24).padStart(2,'0')}:00${h===-4?' (22/11)':h===0?' (23/11)':''}</span>`;
  head+='</div></div>';
  const lines=[[settings.coolStart,'#8b7fd1'],[settings.mStop,'#c99a2e'],[settings.mOff,'#c9544c'],[settings.heatStart||settings.mOn,'#4c9a50']].map(([v,c])=>{const m=toMin(v);return m!=null&&m>=S&&m<=E?`<div class="vline" style="left:${pos(m)}%;border-color:${c}"></div>`:''}).join('');
  const nm=toMin(nowWita()); const nowL=(nm>=S&&nm<=E)?`<div class="vline" style="left:${pos(nm)}%;border-color:#22262b"></div>`:'';
  const rows=sortedTasks().filter(t=>!areaF||areaOf(t)===areaF).map((t,i)=>{
    const ps=toMin(t.planStart), pe=toMin(t.planEnd);
    const plan=(ps!=null&&pe!=null)?`<div class="gbar gplan" style="left:${pos(ps)}%;width:${pos(pe)-pos(ps)}%" title="Plan ${fmt(t.planStart)}–${fmt(t.planEnd)}"></div>`:'';
    let act='';
    const as=toMin(t.actStart);
    if(as!=null){
      const ae=toMin(t.actEnd)??(t.status==='selesai'?as:nm);
      const col=t.status==='selesai'?'#4c9a50':t.status==='kendala'?'#c9544c':'#d9a21b';
      act=`<div class="gbar gact" style="left:${pos(as)}%;width:${Math.max(.4,pos(ae)-pos(as))}%;background:${col}" title="Aktual ${fmt(t.actStart)}–${t.actEnd?fmt(t.actEnd):'sekarang'}"></div>`;
    }
    const lateMark=isLate(t)?' <span style="color:var(--bad)">●</span>':'';
    return `<div class="grow" style="--gc:${t.group==='ops'?'#0e9f8e':areaCol(areaOf(t))}"><div class="nm" title="${esc(t.work)}">${esc(t.no)}. ${esc(t.short||t.work)}${lateMark}</div><div class="track${i%2?' alt':''}">${lines}${nowL}${plan}${act}</div></div>`;
  }).join('');
  $('#gantt').innerHTML=tasks.length?head+rows:'<div class="muted">Belum ada data pekerjaan.</div>';
}

/* ---------- render: tasks table ---------- */
function renderPicFilter(){
  const pics=[...new Set(tasks.map(t=>(t.pic||'').trim()).filter(Boolean))].sort();
  const cur=picF; $('#fPic').innerHTML='<option value="">Semua</option>'+pics.map(p=>`<option ${p===cur?'selected':''}>${esc(p)}</option>`).join('');
}
$('#fPic').onchange=e=>{ picF=e.target.value; renderTasks(); };
document.querySelectorAll('#v-pekerjaan .chipbtn').forEach(b=>b.onclick=()=>{ showF=b.dataset.f; document.querySelectorAll('#v-pekerjaan .chipbtn').forEach(x=>x.classList.toggle('on',x===b)); renderTasks(); });
function renderTasks(){
  renderPicFilter();
  const dis=canWrite?'':'disabled';
  const list=sortedTasks().filter(t=>(!areaF||areaOf(t)===areaF)&&(!picF||(t.pic||'').trim()===picF)&&(showF==='all'||(showF==='open'&&t.status!=='selesai')||(showF==='late'&&(isLate(t)||t.status==='kendala'))));
  let h=`<thead><tr><th>No</th><th>Pekerjaan</th><th>Plan</th><th>Status</th><th>Progres</th><th>Aktual mulai / selesai</th><th>PIC utama (SPV)</th><th>Dicek oleh</th><th>Catatan</th></tr></thead><tbody>`;
  let lastG='', lastA='';
  for(const t of list){
    if(blockOf(t)!==lastA){ lastA=blockOf(t); lastG=''; if(lastA==='ops'){ h+=`<tr class="ahead" style="--ac:#0e9f8e"><td colspan="9">🧰 Operation – persiapan sebelum stop feeding</td></tr>`; } else { const A=AREAS.find(a=>a.k===lastA)||{}; h+=`<tr class="ahead a-${esc(lastA)}"><td colspan="9">${A.ic||''} ${esc(areaName(lastA))}</td></tr>`; } }
    if(lastA!=='ops'&&t.group!==lastG){ lastG=t.group; h+=`<tr class="grp grp-${esc(t.group)}"><td colspan="9">${esc(t.groupName||t.group)}</td></tr>`; }
    const qty=t.qtyTarget!=null?`<div style="margin-top:6px;white-space:nowrap"><input type="number" step="any" data-f="qtyActual" value="${esc(t.qtyActual??'')}" style="width:72px;${qtyMet(t)?'border-color:var(--ok);background:var(--okSoft)':''}" ${dis}> <span class="small ink2">${qtyLabel(t)}</span></div>`:'';
    h+=`<tr data-id="${esc(t.id)}" class="trow" style="--gc:${t.group==='ops'?'#0e9f8e':areaCol(areaOf(t))}">
      <td class="ink2">${esc(t.no)}</td>
      <td style="min-width:240px"><div style="font-weight:550">${esc(t.work)}${t.waiveIf?` <span class="pill ${isWaived(t)?'p-info':'p-idle'}" title="Tidak menahan heating up bila dry ore bin backup sudah full">Boleh dilewatkan</span>`:''}${t.group==='ops'?` <span class="pill" style="background:color-mix(in srgb,${areaCol(areaOf(t))} 15%,white);color:${areaCol(areaOf(t))}">${esc(areaName(areaOf(t)))}</span>`:''}</div><div class="who">${esc(t.equipment)}${t.wo?' · '+esc(t.wo):''}</div>${t.remark?`<div class="who">${esc(t.remark)}</div>`:''}</td>
      <td class="small" style="white-space:nowrap">${fmt(t.planStart)}<br>${fmt(t.planEnd)}${isLate(t)?'<br><span class="pill p-bad">Terlambat</span>':''}</td>
      <td><select data-f="status" class="st-${esc(t.status)}" ${dis}>${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${t.status===k?'selected':''}>${v}</option>`).join('')}</select></td>
      <td style="white-space:nowrap"><input type="number" min="0" max="100" step="10" data-f="progress" value="${esc(t.progress??0)}" style="width:64px" ${dis}> %${qty}</td>
      <td><input type="datetime-local" data-f="actStart" value="${esc(t.actStart||'')}" ${dis}><br><input type="datetime-local" data-f="actEnd" value="${esc(t.actEnd||'')}" style="margin-top:4px" ${dis}></td>
      <td><input data-f="pic" value="${esc(t.pic||'')}" style="width:130px" ${dis}><div class="who">${esc(t.workGroup||'')}</div></td>
      <td><input data-f="checkedBy" value="${esc(t.checkedBy||'')}" placeholder="nama pengecek" style="width:130px" ${dis}></td>
      <td><input data-f="note" value="${esc(t.note||'')}" style="width:170px" ${dis}></td>
    </tr>`;
  }
  h+='</tbody>';
  $('#taskTbl').innerHTML=list.length?h:'<tr><td class="muted">Tidak ada pekerjaan untuk filter ini.</td></tr>';
  $('#ncTask').innerHTML='<option value="">— pilih pekerjaan terkait —</option>'+tasks.map(t=>`<option value="${esc(t.id)}">${esc(t.no)}. ${esc(t.work.slice(0,50))}</option>`).join('');
}
$('#taskTbl').addEventListener('change',async e=>{
  const tr=e.target.closest('tr[data-id]'); if(!tr) return;
  const id=tr.dataset.id, f=e.target.dataset.f; if(!f) return;
  const t=tasks.find(x=>x.id===id); const patch={};
  let v=e.target.value;
  if(f==='progress') v=Math.max(0,Math.min(100,Number(v)||0));
  if(f==='qtyActual') v=num(v);
  if(f==='status'&&v==='selesai'&&!qtyMet(t)){ toast(`Belum bisa Selesai: ${t.short||t.work} harus ${qtyLabel(t)} (aktual: ${t.qtyActual??'belum diisi'}).`); e.target.value=t.status; return; }
  patch[f]=v;
  if(f==='status'){
    if((v==='jalan'||v==='kendala')&&!t.actStart) patch.actStart=nowWita();
    if(v==='selesai'){ if(!t.actStart) patch.actStart=nowWita(); if(!t.actEnd) patch.actEnd=nowWita(); patch.progress=100; }
    if(v==='belum'){ patch.actStart=''; patch.actEnd=''; patch.progress=0; }
    if(v!=='selesai'&&t.status==='selesai'){ patch.actEnd=''; }
  }
  patch.updatedBy=myId||''; patch.updatedAt=nowWita();
  await write(db.doc('tasks/'+id),patch,true);
});

/* ---------- render: checks ---------- */
document.querySelectorAll('#v-cek .chipbtn').forEach(b=>b.onclick=()=>{ chkF=b.dataset.c; document.querySelectorAll('#v-cek .chipbtn').forEach(x=>x.classList.toggle('on',x===b)); renderChecks(); });
const chkPic=c=>{ const ps=(c.tasks||[]).map(id=>(tasks.find(t=>t.id===id)||{}).pic).filter(Boolean); return c.general?'Semua SPV + Operation':[...new Set(ps.join(',').split(',').map(x=>x.trim()).filter(Boolean))].join(', ')||'–'; };
function renderChecks(){
  const dis=canWrite?'':'disabled';
  const sorted=[...checks].sort((a,b)=>{ const x=chkArea(a),y=chkArea(b); return (x==='all'?9:AIDX(x))-(y==='all'?9:AIDX(y))||(a.order??999)-(b.order??999); }).filter(c=>{ const ar=chkArea(c); if(areaF&&ar!==areaF&&ar!=='all') return false; const lk=checkLocked(c); return chkF==='all'||(chkF==='ready'&&!c.result&&!lk)||(chkF==='nok'&&c.result==='nok')||(chkF==='locked'&&!c.result&&lk); });
  let h=`<thead><tr><th>Equipment</th><th>Yang wajib dicek</th><th>Pekerjaan terkait</th><th>PIC (SPV)</th><th>Status</th><th>Dicek oleh</th><th>Hasil</th><th>Catatan</th></tr></thead><tbody>`;
  let lastA='';
  for(const c of sorted){
    const ar=chkArea(c); if(ar!==lastA){ lastA=ar; const A=AREAS.find(a=>a.k===ar); h+=`<tr class="ahead a-${esc(ar)}" style="${ar==='all'?'--ac:#14a397':''}"><td colspan="8">${A?A.ic+' '+esc(A.n):'🏭 Umum – semua area'}</td></tr>`; }
    const locked=checkLocked(c);
    const rel=(c.tasks||[]).map(id=>{const t=tasks.find(x=>x.id===id);return t?`<div class="small">${t.status==='selesai'?'<span style="color:var(--ok)">✓</span>':'<span class="muted">○</span>'} ${esc(t.no)}. ${esc((t.short||t.work).slice(0,40))}</div>`:''}).join('')||'<span class="who">Setelah semua pekerjaan selesai</span>';
    const st=c.result==='ok'?'<span class="pill p-ok">OK</span>':c.result==='nok'?'<span class="pill p-bad">NOK</span>':locked?'<span class="pill p-idle">Terkunci</span>':'<span class="pill p-info">Siap dicek</span>';
    const dd=locked||!canWrite?'disabled':'';
    h+=`<tr data-id="${esc(c.id)}">
      <td style="font-weight:600;min-width:150px">${esc(c.equipment)}${c.waiveIf?`<div><span class="pill ${isWaived(c)?'p-info':'p-idle'}" style="margin-top:4px" title="Tidak menahan heating up bila dry ore bin backup sudah full">Boleh dilewatkan</span></div>`:''}</td>
      <td style="min-width:220px">${(c.items||[]).map(i=>`<div class="ckitem">• ${esc(i)}</div>`).join('')}</td>
      <td>${rel}</td>
      <td class="small">${esc(chkPic(c))}</td>
      <td>${st}${c.result&&c.at?`<div class="who" style="margin-top:4px">${fmt(c.at)}${c.by?` · input <span data-uid="${esc(c.by)}">${esc(names[c.by]||'…')}</span>`:''}</div>`:''}</td>
      <td><input data-f="checker" value="${esc(c.checker||'')}" placeholder="nama pengecek" style="width:130px" ${dd}></td>
      <td style="white-space:nowrap"><button class="btn sm ok" data-r="ok" ${dd}>OK</button> <button class="btn sm bad" data-r="nok" ${dd}>NOK</button>${c.result?` <button class="btn sm" data-r="" ${dis}>Reset</button>`:''}</td>
      <td><input data-f="note" value="${esc(c.note||'')}" placeholder="${c.result==='nok'?'wajib isi temuan':''}" style="width:170px" ${dis}></td>
    </tr>`;
  }
  h+='</tbody>';
  $('#checkTbl').innerHTML=sorted.length?h:'<tr><td class="muted">Tidak ada item untuk filter ini.</td></tr>';
  resolveNames();
}
$('#checkTbl').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-r]'); if(!b) return;
  const tr=b.closest('tr'), id=tr.dataset.id; const c=checks.find(x=>x.id===id);
  const r=b.dataset.r;
  if(r&&checkLocked(c)){ toast('Item ini masih terkunci: pekerjaan terkait belum selesai.'); return; }
  const checker=tr.querySelector('[data-f=checker]').value.trim(), note=tr.querySelector('[data-f=note]').value.trim();
  if(r&&!checker){ toast('Isi nama pengecek dulu.'); return; }
  if(r==='nok'&&!note){ toast('Isi catatan temuan dulu sebelum NOK.'); return; }
  await write(db.doc('checks/'+id),{result:r,checker,note,by:r?(myId||''):'',at:r?nowWita():''},true);
});
$('#checkTbl').addEventListener('change',async e=>{
  const f=e.target.dataset.f; if(f!=='note'&&f!=='checker') return;
  const id=e.target.closest('tr').dataset.id;
  await write(db.doc('checks/'+id),{[f]:e.target.value.trim()},true);
});

/* ---------- rotations ---------- */
function renderRots(){
  const sl=rotSlots(), nowM=toMin(nowWita());
  $('#slots').innerHTML=sl.length?sl.map(x=>{
    const st=rotState(x,nowM); const dis=!canWrite?'disabled':'';
    const lbl={done:'<span class="pill p-ok">Sudah diputar</span>',miss:'<span class="pill p-bad">Terlewat</span>',due:'<span class="pill p-run">Jam ini – belum</span>',next:'<span class="pill p-idle">Akan datang</span>'}[st];
    const body=x.done
      ?`<div class="small" style="margin-top:6px">Diputar ${fmt(x.at).slice(6)}</div>${x.note?`<div class="who">${esc(x.note)}</div>`:''}<button class="btn sm" data-undo="${esc(x.id)}" style="margin-top:8px" ${dis}>Batalkan</button>`
      :`<input data-nt="${esc(x.id)}" placeholder="Catatan ops (opsional)" ${dis}><button class="btn sm pri" data-do="${esc(x.id)}" style="margin-top:8px;width:100%" ${dis}>Sudah diputar</button>`;
    return `<div class="slot ${st}"><div style="display:flex;justify-content:space-between;align-items:center"><span class="h">${fmt(fromMin(x.m)).slice(6)}</span>${lbl}</div><div class="who">${fmt(fromMin(x.m)).slice(0,5)} · 1× putaran aux</div>${body}</div>`;
  }).join(''):'<div class="muted">Atur jam mulai & selesai putaran di tab Setting.</div>';
}
$('#slots').addEventListener('click',async e=>{
  const d=e.target.closest('button[data-do]'), u=e.target.closest('button[data-undo]');
  if(d){ const id=d.dataset.do;
    if(await write(db.doc('rotations/'+id),{done:true,at:nowWita(),note:$(`[data-nt="${id}"]`).value.trim(),by:myId||''})) toast('Putaran tercatat.',true); }
  if(u){ await write(db.doc('rotations/'+u.dataset.undo),{done:false,at:'',note:'',by:''}); }
});

$('#ncAdd').onclick=async()=>{
  const eq=$('#ncEq').value.trim(), it=$('#ncItem').value.trim(); if(!eq||!it){toast('Isi equipment dan poin cek.');return;}
  const tid=$('#ncTask').value; if(!tid){ toast('Pilih pekerjaan terkait.'); return; }
  if(await write(db.collection('checks').doc(),{equipment:eq,items:[it],tasks:tid?[tid]:[],general:!tid,order:900+checks.length,result:'',note:''})){ $('#ncEq').value='';$('#ncItem').value=''; }
};

/* ---------- hourly input ---------- */
const hourDraft={};
function hourSlots(){ const a=toMin(settings.coolStart); let b=toMin(settings.mRun); if(b==null&&toMin(settings.heatStart)!=null) b=toMin(settings.heatStart)+720; if(a==null||b==null) return []; const out=[]; for(let m=Math.ceil(a/60)*60;m<=b;m+=60) out.push(m); return out; }
const slotDoc=m=>{ const t=fromMin(m); return temps.find(r=>r.id==='h'+t)||temps.find(r=>r.time===t); };
let hourPending=false;
function renderHourly(){
  const tbl=$('#hourTbl');
  if(tbl.contains(document.activeElement)){ hourPending=true; return; }
  hourPending=false;
  const P=phaseModel(), rs=readings(), nowM=toMin(nowWita()), dis=canWrite?'':'disabled';
  const slots=hourSlots();
  let h=`<thead><tr><th>Jam</th><th>Fase</th><th>Temperatur</th><th class="right">Target</th><th class="right">Deviasi</th><th class="right">Laju °C/jam</th><th>Catatan</th><th></th></tr></thead><tbody>`;
  const G=gW();
  if(G==null){ tbl.innerHTML='<tr><td class="muted" style="padding:16px">Pilih dulu kondisi chunk sebelum shutdown di atas – setelah itu tabel input per jam terbuka.</td></tr>'; return; }
  for(const m of slots){
    const r=slotDoc(m), id=fromMin(m);
    const w=G;
    const val=r?valOf(r,w):null;
    const fut=m>nowM, isNow=nowM>=m&&nowM<m+60;
    const ph=phaseAt(m,P), tg=targetAt(m,P);
    let dev='–', rate='–', flag='';
    if(r){ const e=evalReading({...r,m},P,rs);
      if(e.dev!=null) dev=(e.dev>0?'+':'')+r0(e.dev); if(e.rate!=null) rate=(e.rate>0?'+':'')+r0(e.rate);
      flag=[e.devFlag,e.rateFlag].filter(Boolean).join('; '); }
    const tgTxt=tg?(tg.w===w?`${r0(tg.v)}`:`<span class="who" title="Target berlaku untuk ${esc(nmW(tg.w))}">${esc(nmW(tg.w))} ${r0(tg.v)}</span>`):'–';
    const ref=(m===toMin(settings.coolStart)?'<div class="who" style="color:var(--warn)">acuan pendinginan</div>':'')+(m===toMin(settings.heatStart)?'<div class="who" style="color:var(--warn)">acuan heating</div>':'');
    const st=r?`<span class="pill p-ok">Tersimpan</span>${r.by?`<div class="who"><span data-uid="${esc(r.by)}">${esc(names[r.by]||'…')}</span></div>`:''}`:(fut?'<span class="who">belum tiba</span>':(isNow?'':'<span class="pill p-bad">Belum diisi</span>'));
    const dd=!canWrite?'disabled':'';
    h+=`<tr data-m="${m}" class="${isNow?'hnow':''} ${r?'hsaved':''} ${fut?'hfut':''}">
      <td style="white-space:nowrap"><b>${fmt(id).slice(6)}</b> <span class="who">${fmt(id).slice(0,5)}</span>${isNow?' <span class="pill p-info">jam ini</span>':''}${ref}</td>
      <td class="small">${ph?PHN[ph]:'–'}</td>
      <td style="white-space:nowrap"><b class="plab" style="color:${colW(w)};display:inline-block;width:28px">${esc(nmW(w))}</b><input type="number" data-k="val" value="${val??''}" style="width:90px" ${dd}> °C</td>
      <td class="right">${tgTxt}</td>
      <td class="right">${dev}</td>
      <td class="right">${rate}</td>
      <td><input data-k="note" value="${esc((r&&r.note)||'')}" placeholder="catatan" style="width:200px" ${dd}>${flag?`<div class="small" style="color:var(--bad);margin-top:3px">⚠ ${esc(flag)}</div>`:''}</td>
      <td style="white-space:nowrap"><button class="btn sm ${r?'':'pri'}" data-save="1" ${dd}>${r?'Ubah':'Simpan'}</button> ${st}</td>
    </tr>`;
  }
  h+='</tbody>';
  tbl.innerHTML=slots.length?h:'<tr><td class="muted">Atur jam mulai pendinginan & running normal di Setting.</td></tr>';
  resolveNames();
}
function renderChunkSel(){
  const c=gChunk(); $('#tReset').disabled=!canWrite;
  document.querySelectorAll('#chunkSel button').forEach(b=>{ b.classList.toggle('on',String(c)===b.dataset.c); b.disabled=!canWrite; });
  $('#chunkInfo').innerHTML=c==null?'<span class="pill p-run">Belum dipilih</span>':`Acuan: <b style="color:${colW(c?2:1)}">${esc(nmW(c?2:1))}</b> untuk seluruh fase pendinginan & heating up`;
}
$('#chunkSel').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-c]'); if(!b) return;
  const c=b.dataset.c==='true';
  if(gChunk()===c) return;
  const other=temps.some(r=>valOf(r,c?1:2)!=null&&valOf(r,c?2:1)==null);
  if(other&&!b.dataset.arm){ b.dataset.arm=1; toast(`Sudah ada isian ${nmW(c?1:2)}. Klik sekali lagi untuk tetap ganti acuan ke ${nmW(c?2:1)}.`); setTimeout(()=>delete b.dataset.arm,4000); return; }
  if(await write(db.doc('settings/main'),{chunk:c},true)) toast(`Acuan diset ke ${nmW(c?2:1)}.`,true);
});
let resetArm=0;
$('#tReset').addEventListener('click',async()=>{
  const b=$('#tReset');
  if(!temps.length){ toast('Belum ada isian temperatur.'); return; }
  if(!resetArm){ resetArm=1; b.textContent=`Yakin hapus ${temps.length} isian? Klik lagi`; b.classList.add('pri'); setTimeout(()=>{ resetArm=0; b.textContent='Reset semua isian temperatur'; b.classList.remove('pri'); },5000); return; }
  resetArm=0; b.disabled=true; b.textContent='Menghapus…';
  let fail=0;
  try{ await db.clear('temps','Reset semua isian temperatur'); }catch(e){ fail=temps.length; }
  b.disabled=!canWrite; b.textContent='Reset semua isian temperatur'; b.classList.remove('pri');
  toast(fail?`${fail} isian gagal dihapus, coba lagi.`:'Semua isian temperatur sudah dihapus.',!fail);
});
function hourMissing(){ if(gW()==null) return 0; const nowM=toMin(nowWita()); return hourSlots().filter(m=>m+60<=nowM&&!slotDoc(m)).length; }
$('#hourTbl').addEventListener('focusout',()=>setTimeout(()=>{ if(hourPending&&!$('#hourTbl').contains(document.activeElement)) renderHourly(); },50));
$('#hourTbl').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-save]'); if(!b) return;
  const tr=b.closest('tr'), m=+tr.dataset.m, id=fromMin(m);
  const chunk=gChunk(), v=num(tr.querySelector('[data-k=val]').value), note=tr.querySelector('[data-k=note]').value.trim();
  if(v==null){ toast(`Isi ${chunk?nm2():nm1()} untuk jam ${fmt(id).slice(6)}.`); return; }
  const old=slotDoc(m);
  b.disabled=true;
  const ok=await write(db.doc('temps/h'+id),{time:id,chunk,t1:chunk?null:v,t2:chunk?v:null,note,by:myId||'',at:nowWita()});
  if(ok&&old&&old.id!=='h'+id){ try{ await db.doc('temps/'+old.id).delete(); }catch(_){} }
  if(ok){ delete hourDraft[id]; b.blur(); toast(`Jam ${fmt(id).slice(6)} tersimpan.`,true); }
  b.disabled=false;
});

/* ---------- chart ---------- */
let chart=null;
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const bandPlugin={id:'bands',beforeDatasetsDraw(c){
  const {ctx,chartArea:a,scales:{x}}=c; if(!a) return;
  ctx.save();
  const rows=readings();
  ctx.setLineDash([4,4]); ctx.lineWidth=1; ctx.font='11px system-ui'; ctx.textBaseline='top';
  let k=0;
  for(const [lbl,v,col] of [['Mulai pendinginan',settings.coolStart,'#8b7fd1'],['Stop feed',settings.mStop,'#c99a2e'],['Power off',settings.mOff,'#c9544c'],['Heating',settings.heatStart||settings.mOn,'#4c9a50'],['Normal',settings.mRun,'#898781']]){
    const m=toMin(v); if(m==null) continue; const px=x.getPixelForValue(m); if(px<a.left||px>a.right) continue;
    ctx.strokeStyle=col; ctx.beginPath(); ctx.moveTo(px,a.top); ctx.lineTo(px,a.bottom); ctx.stroke(); ctx.fillStyle='#55595f'; ctx.fillText(lbl,px+4,a.top+2+(k++%2)*13);
  }
  ctx.restore();
}};
function drawChart(){
  if(!window.Chart) return;
  const P=phaseModel(), rows=readings();
  const t1=rows.filter(r=>num(r.t1)!=null).map(r=>({x:r.m,y:num(r.t1),ctl:ctlAt(r.m,P,r.chunk)===1}));
  const t2=rows.filter(r=>num(r.t2)!=null).map(r=>({x:r.m,y:num(r.t2),ctl:ctlAt(r.m,P,r.chunk)===2}));
  const ms=[settings.coolStart,settings.mStop,settings.mOff,settings.heatStart,settings.mRun].map(toMin).filter(v=>v!=null);
  const allX=[...rows.map(r=>r.m),...ms];
  let xmin=allX.length?Math.min(...allX):0, xmax=allX.length?Math.max(...allX):24*60;
  xmin=Math.floor((xmin-60)/60)*60; xmax=Math.ceil((xmax+60)/60)*60;
  const T1=css('--t1'), T2=css('--t2'), surf='#ffffff', cw=w=>w===1?T1:T2;
  const coolPts=[], heatPts=[];
  if(P.cs!=null) for(let m=P.cs;m<=(P.hs??xmax);m+=15){ const t=targetAt(m,P); if(t&&t.phase==='cool') coolPts.push({x:m,y:t.v}); }
  if(P.hs!=null){ const end=Math.min(P.run??xmax,xmax); for(let m=P.hs;m<=end;m+=15){ const t=targetAt(m,P); if(t&&t.phase==='heat') heatPts.push({x:m,y:t.v}); } }
  const pr=d=>d.raw&&d.raw.ctl?6:3.5;
  const data={datasets:[
    {label:nm1()+' aktual',data:t1,borderColor:T1,backgroundColor:T1,borderWidth:2,pointRadius:pr,pointHoverRadius:7,pointBorderColor:surf,pointBorderWidth:2,tension:0},
    {label:nm2()+' aktual',data:t2,borderColor:T2,backgroundColor:T2,borderWidth:2,pointRadius:pr,pointHoverRadius:7,pointBorderColor:surf,pointBorderWidth:2,tension:0},
    {label:'Target pendinginan '+(P.cc.w?nmW(P.cc.w):''),data:coolPts,borderColor:P.cc.w?cw(P.cc.w):'#898781',borderDash:[6,5],borderWidth:1.5,pointRadius:0,pointHoverRadius:0},
    {label:'Target heating '+(P.hc.w?nmW(P.hc.w):''),data:heatPts,borderColor:P.hc.w?cw(P.hc.w):'#898781',borderDash:[6,5],borderWidth:1.5,pointRadius:0,pointHoverRadius:0},
  ]};
  const opts={responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
    interaction:{mode:'nearest',axis:'x',intersect:false},
    plugins:{legend:{display:false},tooltip:{backgroundColor:'#ffffff',borderColor:'#d3d2ca',borderWidth:1,titleColor:'#22262b',bodyColor:'#22262b',
      callbacks:{title:it=>it.length?fmtMin(it[0].parsed.x)+' WITA':'',label:it=>`${it.dataset.label}: ${r0(it.parsed.y)} °C${it.raw&&it.raw.ctl?' (dikontrol)':''}`}}},
    scales:{x:{type:'linear',min:xmin,max:xmax,grid:{color:'#ebeae5'},ticks:{color:'#898781',stepSize:180,callback:v=>fmtMin(v)}},
            y:{grid:{color:'#ebeae5'},ticks:{color:'#898781',callback:v=>v+' °C'}}}};
  if(chart){ chart.data=data; chart.options=opts; chart.update('none'); }
  else chart=new Chart($('#chart'),{type:'line',data,options:opts,plugins:[bandPlugin]});
}

/* ---------- settings ---------- */
function renderSettings(){
  const s=settings;
  const set=(id,v)=>{ if(document.activeElement!==$(id)) $(id).value=v??''; };
  set('#sT1n',s.t1Name); set('#sT2n',s.t2Name); set('#sTol',s.tol);
  set('#cStart',s.coolStart); set('#cRate',s.coolRate);
  set('#hStart',s.heatStart);
  set('#aStart',s.auxStart); set('#aEnd',s.auxEnd); set('#mStop',s.mStop); set('#mOff',s.mOff); set('#mOn',s.mOn); set('#mRun',s.mRun);
  if(!draftStages) draftStages=(s.heatStages||[]).map(x=>({...x}));
  renderStages(); renderPhaseInfo();
}
function renderStages(){
  $('#stTbl').innerHTML=`<tr><th>#</th><th class="right">Laju naik °C/jam</th><th class="right">Sampai suhu</th><th class="right">Hold</th><th></th></tr>`+
    (draftStages.length?draftStages.map((p,i)=>`<tr><td>${i+1}</td><td class="right">${p.rate??'–'}</td><td class="right">${p.to??'<span class="muted">= suhu awal pendinginan</span>'}</td><td class="right">${p.hold?p.hold+' jam':'–'}</td><td><button class="btn sm" data-si="${i}">Hapus</button></td></tr>`).join(''):'<tr><td colspan="5" class="muted">Belum ada tahap.</td></tr>');
}
function renderPhaseInfo(){
  const P=phaseModel();
  const ctlTxt=c=>c.w?`<b style="color:${colW(c.w)}">${esc(nmW(c.w))}</b> (${c.chunk?'ada chunk':'tidak ada chunk'} sebelum shutdown)`:'<span class="ink2">belum dipilih – pilih kondisi chunk di tab Temperatur</span>';
  $('#cInfo').innerHTML=`Dikontrol: ${ctlTxt(P.cc)}<br>Nilai acuan: ${P.coolBase?`<b>${r0(P.coolBase.v)} °C</b> (pembacaan ${fmtMin(P.coolBase.m)})`:'<span class="ink2">belum ada pembacaan di jam mulai pendinginan</span>'}`+
    (P.coolBase&&P.coolRate!=null&&P.hs!=null?`<br>Batas suhu terendah saat mulai heating: ≈ <b>${r0(P.coolBase.v-P.coolRate*(P.hs-P.cs)/60)} °C</b>`:'');
  $('#hInfo').innerHTML=`Dikontrol: ${ctlTxt(P.hc)}<br>Nilai awal: ${P.heatBase?`<b>${r0(P.heatBase.v)} °C</b> (pembacaan ${fmtMin(P.heatBase.m)})`:'<span class="ink2">belum ada pembacaan di jam mulai heating</span>'}`+
    (P.heatEnd!=null&&P.finalTemp!=null?`<br>Proyeksi capai ${r0(P.finalTemp)} °C: <b>${fmtMin(P.heatEnd)}</b>`:'');
}
$('#stTbl').addEventListener('click',e=>{ const b=e.target.closest('button[data-si]'); if(!b) return; draftStages.splice(+b.dataset.si,1); renderStages(); });
$('#stAdd').onclick=()=>{ const rate=num($('#stRate').value); if(!rate||rate<=0){toast('Isi laju naik (°C/jam).');return;} draftStages.push({rate,to:num($('#stTo').value),hold:num($('#stHold').value)||0}); ['#stRate','#stTo','#stHold'].forEach(s=>$(s).value=''); renderStages(); };
$('#sSave').onclick=async()=>{
  const v=id=>$(id).value;
  const ok=await write(db.doc('settings/main'),{t1Name:v('#sT1n').trim(),t2Name:v('#sT2n').trim(),tol:num(v('#sTol')),
    coolStart:v('#cStart'),coolRate:num(v('#cRate')),coolCtl:'auto',heatStart:v('#hStart'),heatCtl:'auto',heatStages:draftStages,
    auxStart:v('#aStart'),auxEnd:v('#aEnd'),mStop:v('#mStop'),mOff:v('#mOff'),mOn:v('#mOn'),mRun:v('#mRun')});
  if(ok) toast('Setting tersimpan.',true);
};

/* ---------- names ---------- */
async function resolveNames(){
  if(!user) return;
  const ids=[...new Set([...document.querySelectorAll('[data-uid]')].map(e=>e.dataset.uid).filter(Boolean))];
  if(!ids.length) return;
  try{ const ps=await user.profiles(ids); for(const id of ids){ names[id]=(ps&&ps[id]&&ps[id].name)||'Seseorang'; } }catch(e){}
  document.querySelectorAll('[data-uid]').forEach(e=>e.textContent=names[e.dataset.uid]||'Seseorang');
}

/* ---------- write wrapper ---------- */
async function write(ref,data,merge){
  if(!db){ toast('Penyimpanan belum tersedia di tampilan ini.'); return false; }
  try{ if(merge) await ref.update(data); else await ref.set(data); return true; }
  catch(err){
    if(err&&err.code==='invalid_argument'&&!GH.token){ canWrite=false; renderAll(); toast('Login editor dulu (tombol 🔑 di kanan atas) untuk bisa input.'); }
    else if(err&&err.code==='auth'){ GH.logout(); canWrite=false; renderAuth(); renderAll(); toast('Token GitHub tidak valid/kedaluwarsa. Login ulang.'); }
    else if(err&&err.code==='forbidden') toast('Akun GitHub ini tidak punya akses tulis ke repo.');
    else toast('Gagal menyimpan: '+((err&&err.message)||'coba lagi'));
    return false;
  }
}

function renderAll(){ renderTop(); renderAreas(); renderGantt(); renderTasks(); renderChecks(); renderRots(); renderChunkSel(); renderHourly(); renderSettings(); drawChart(); }

/* ---------- boot ---------- */
renderAll();
setInterval(()=>{ renderTop(); renderGantt(); renderRots(); renderHourly(); },60000);

function renderAuth(){
  const b=$('#authBtn'); if(!b) return;
  if(GH.token&&GH.login){ b.innerHTML='👤 '+esc(GH.login)+' · Logout'; b.dataset.m='out'; }
  else { b.innerHTML='🔑 Login editor'; b.dataset.m='in'; }
}
$('#authBtn').addEventListener('click',()=>{
  if($('#authBtn').dataset.m==='out'){ GH.logout(); myId=''; canWrite=false; renderAuth(); renderAll(); toast('Sudah logout. Mode lihat saja.',true); return; }
  $('#authDlg').style.display='flex'; $('#tokIn').value=''; $('#tokIn').focus();
});
$('#tokCancel').onclick=()=>{ $('#authDlg').style.display='none'; };
$('#tokSave').onclick=async()=>{
  const t=$('#tokIn').value.trim(); if(!t){ toast('Tempel token GitHub dulu.'); return; }
  const b=$('#tokSave'); b.disabled=true; b.textContent='Memeriksa…';
  try{ const l=await GH.loginWith(t); myId=l; canWrite=true; $('#authDlg').style.display='none'; renderAuth(); renderAll(); toast('Login sebagai '+l+'. Sekarang bisa input.',true); }
  catch(e){ toast(e.code==='auth'?'Token tidak valid atau sudah kedaluwarsa.':(e.message||'Login gagal.')); }
  b.disabled=false; b.textContent='Login';
};
$('#repoInfo').textContent=GHCFG.owner&&GHCFG.repo?`Data: github.com/${GHCFG.owner}/${GHCFG.repo} (branch ${GHCFG.branch})`:'Repo belum dikonfigurasi';
$('#repoInfo').href=GHCFG.owner?`https://github.com/${GHCFG.owner}/${GHCFG.repo}/commits/${GHCFG.branch}`:'#';

(async()=>{
  canWrite=false; renderAuth();
  if(!GHCFG.owner||!GHCFG.repo){ const b=$('#banner'); b.textContent='Repo GitHub belum dikonfigurasi (DASH_CONFIG di index.html).'; b.style.display='block'; return; }
  db=GH.db; user=GH.user;
  let first=true;
  const done=()=>{ if(first){ first=false; $('#banner').style.display='none'; } };
  const err=e=>{ const b=$('#banner'); b.textContent='Data belum bisa dimuat dari GitHub ('+(e&&e.message||'koneksi')+'). Halaman akan mencoba lagi otomatis.'; b.style.display='block'; };
  db.collection('tasks').orderBy('order').onSnapshot(s=>{ tasks=s.docs.map(d=>({id:d.id,...d.data()})); done(); renderAll(); },err);
  db.collection('checks').onSnapshot(s=>{ checks=s.docs.map(d=>({id:d.id,...d.data()})); renderTop(); renderAreas(); renderChecks(); },err);
  db.collection('rotations').onSnapshot(s=>{ rots=s.docs.map(d=>({id:d.id,...d.data()})); renderTop(); renderRots(); },err);
  db.collection('temps').onSnapshot(s=>{ temps=s.docs.map(d=>({id:d.id,...d.data()})); renderTop(); renderHourly(); renderPhaseInfo(); drawChart(); },err);
  db.doc('settings/main').onSnapshot(s=>{ settings=s.exists?s.data():{}; draftStages=null; renderAll(); },err);
  const b=$('#banner'); b.textContent='Memuat data dari GitHub…'; b.style.display='block';
  await GH.start();
  myId=GH.login||''; canWrite=!!(GH.token&&GH.login); renderAuth(); renderAll();
})();

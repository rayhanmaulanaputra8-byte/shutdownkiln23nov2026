/* ================= GitHub storage (data = JSON files on a separate branch) =================
   Read  : viewers without a token read raw.githubusercontent.com (no limit, may lag up to ~5 min);
           editors read via the GitHub API (fresh).
   Write : editors only, via the GitHub Contents API with their own fine-grained token.
           Every change = one commit on the data branch (history = audit log). */
const GHCFG=(()=>{
  const c=window.DASH_CONFIG||{};
  let owner=c.owner||'', repo=c.repo||'';
  const h=location.hostname, p=location.pathname.split('/').filter(Boolean);
  if(!owner&&h.endsWith('.github.io')) owner=h.split('.')[0];
  if(!repo&&h.endsWith('.github.io')) repo=p[0]||(owner+'.github.io');
  return {owner,repo,branch:c.dataBranch||'data'};
})();
const GH=(()=>{
  const FILES=['tasks','checks','rotations','temps','settings'];
  let token=''; try{ token=localStorage.getItem('ghDashToken')||''; }catch(e){}
  let login='';
  const files={}, subs={}; FILES.forEach(f=>{ subs[f]=[]; });
  const b64e=s=>btoa(unescape(encodeURIComponent(s)));
  const b64d=s=>decodeURIComponent(escape(atob(String(s).replace(/\n/g,''))));
  const base=()=>`/repos/${GHCFG.owner}/${GHCFG.repo}`;
  function err(code,message,status){ const e=new Error(message); e.code=code; e.status=status; return e; }
  async function api(path,opt={}){
    const r=await fetch('https://api.github.com'+path,{cache:'no-store',...opt,headers:{'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{'Authorization':'Bearer '+token}:{}),...(opt.headers||{})}});
    if(!r.ok){ let m='HTTP '+r.status; try{ const j=await r.json(); if(j&&j.message) m=j.message; }catch(_){}
      throw err(r.status===401?'auth':r.status===403?'forbidden':'http',m,r.status); }
    return r.status===204?null:r.json();
  }
  async function fetchFile(name){
    if(token){ const j=await api(`${base()}/contents/data/${name}.json?ref=${encodeURIComponent(GHCFG.branch)}&t=${Date.now()}`); return {sha:j.sha,obj:JSON.parse(b64d(j.content))}; }
    const r=await fetch(`https://raw.githubusercontent.com/${GHCFG.owner}/${GHCFG.repo}/${GHCFG.branch}/data/${name}.json?t=${Date.now()}`,{cache:'no-store'});
    if(!r.ok) throw err('http','HTTP '+r.status,r.status);
    return {sha:null,obj:await r.json()};
  }
  const snapCol=name=>{ const o=(files[name]&&files[name].obj)||{}; const docs=Object.keys(o).map(id=>({id,exists:true,data:()=>o[id],metadata:{fromCache:false}}));
    if(name==='tasks') docs.sort((a,b)=>(a.data().order??0)-(b.data().order??0));
    return {docs,size:docs.length,empty:!docs.length,metadata:{fromCache:false,hasPendingWrites:false}}; };
  const snapDoc=(name,id)=>{ const o=(files[name]&&files[name].obj)||{}; return {id,exists:id in o,data:()=>o[id],metadata:{fromCache:false}}; };
  function emit(name){ subs[name].forEach(s=>{ try{ s.type==='col'?s.cb(snapCol(name)):s.cb(snapDoc(name,s.id)); }catch(e){ console.error(e); } }); }
  const sameJSON=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  async function load(name){
    try{ const f=await fetchFile(name); const changed=!files[name]||!sameJSON(files[name].obj,f.obj); files[name]=f; if(changed) emit(name); }
    catch(e){ subs[name].forEach(s=>s.err&&s.err(e)); }
  }
  async function mutate(name,fn,msg){
    if(!token) throw err('invalid_argument','Belum login editor');
    for(let i=0;i<5;i++){
      const cur=await fetchFile(name); const obj=cur.obj; fn(obj);
      try{
        const res=await api(`${base()}/contents/data/${name}.json`,{method:'PUT',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({message:`${msg} (${login||'editor'})`,content:b64e(JSON.stringify(obj,null,1)+'\n'),sha:cur.sha,branch:GHCFG.branch})});
        files[name]={sha:res.content.sha,obj}; emit(name); return;
      }catch(e){ if(e.status===409||e.status===422){ await new Promise(r=>setTimeout(r,300+Math.random()*700)); continue; } throw e; }
    }
    throw err('http','Bentrok dengan editor lain, coba lagi');
  }
  const label=(name,id)=>{ const d=files[name]&&files[name].obj&&files[name].obj[id]; return d&&(d.no||d.equipment||d.time)||id; };
  function docRef(name,id){
    return {id,path:name+'/'+id,
      onSnapshot(cb,e){ subs[name].push({type:'doc',id,cb,err:e}); if(files[name]) cb(snapDoc(name,id)); return ()=>{}; },
      async get(){ return snapDoc(name,id); },
      update(d){ return mutate(name,o=>{ if(!o[id]) throw err('invalid_argument','Data tidak ditemukan'); o[id]={...o[id],...d}; },`Update ${name} ${label(name,id)}`); },
      set(d){ return mutate(name,o=>{ o[id]=d; },`Set ${name} ${d.no||d.equipment||d.time||id}`); },
      delete(){ return mutate(name,o=>{ delete o[id]; },`Hapus ${name} ${label(name,id)}`); },
      collection(){ throw err('invalid_argument','not supported'); } };
  }
  const db={
    collection(name){ const q={ orderBy(){ return q; }, where(){ return q; }, limit(){ return q; },
      onSnapshot(cb,e){ subs[name].push({type:'col',cb,err:e}); if(files[name]) cb(snapCol(name)); return ()=>{}; },
      async get(){ return snapCol(name); },
      doc(id){ return docRef(name,id||('x'+Date.now().toString(36)+Math.random().toString(36).slice(2,7))); },
      async add(d){ const r=q.doc(); await r.set(d); return r; } }; return q; },
    doc(path){ const [c,id]=path.split('/'); return docRef(c,id); },
    clear(name,msg){ return mutate(name,o=>{ Object.keys(o).forEach(k=>delete o[k]); },msg||`Reset ${name}`); }
  };
  const user={ id:async()=>login, me:async()=>({id:login,name:login}), isOwner:()=>false, canEdit:()=>!!token,
    can:async()=>!!token&&!!login, profiles:async ids=>Object.fromEntries(ids.map(i=>[i,{id:i,name:i}])) };
  let timer=null;
  function startPolling(){ clearInterval(timer); timer=setInterval(()=>FILES.forEach(load),token?30000:60000); }
  async function verify(t){
    const prev=token; token=t;
    try{ const u=await api('/user'); const rp=await api(base());
      if(!rp.permissions||!rp.permissions.push) throw err('forbidden','Akun '+u.login+' belum punya akses tulis ke repo ini (minta ditambahkan sebagai collaborator)');
      login=u.login; return u.login;
    }catch(e){ token=prev; throw e; }
  }
  return {
    cfg:GHCFG, db, user, FILES,
    get token(){ return token; }, get login(){ return login; },
    async start(){
      if(token){ try{ await verify(token); }catch(e){ token=''; login=''; try{ localStorage.removeItem('ghDashToken'); }catch(_){} } }
      await Promise.all(FILES.map(load)); startPolling();
    },
    async loginWith(t){ const l=await verify(t.trim()); try{ localStorage.setItem('ghDashToken',t.trim()); }catch(_){} await Promise.all(FILES.map(load)); startPolling(); return l; },
    logout(){ token=''; login=''; try{ localStorage.removeItem('ghDashToken'); }catch(_){} startPolling(); },
    refresh(){ return Promise.all(FILES.map(load)); }
  };
})();

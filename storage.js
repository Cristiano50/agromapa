/* IndexedDB adapter shared by the app and migration tests. */
(function(root){
'use strict';
const DB_STORES=['kv','tiles','records','outbox','meta','blobs','conflicts'];
function createDatabase(name,{indexedDB=root.indexedDB,idb=root.idb,onError=()=>{}}={}){ let p=null; const upgrade=d=>{ DB_STORES.forEach(n=>{ if(!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
  function open(){ if(p) return p;
    p=(idb&&idb.openDB)?idb.openDB(name,2,{upgrade}):new Promise((res,rej)=>{ try{ const r=indexedDB.open(name,2); r.onupgradeneeded=e=>upgrade(e.target.result); r.onsuccess=e=>{ const d=e.target.result; res(d); }; r.onerror=()=>rej(r.error); }catch(e){ rej(e); } });
    p=p.catch(error=>{ p=null; throw error; }); return p; }
  const req=q=>new Promise((res,rej)=>{ q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); });
  async function transaction(stores,mode,fn){ let tx,done;
    try{ const d=await open(); const wrapped=!!(idb&&d.get); tx=d.transaction(stores,mode);
      done=wrapped?tx.done:new Promise((resolve,reject)=>{ tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error||new Error('Gravação cancelada')); tx.onerror=()=>{}; });
      // Observe failures immediately, including aborts while requests are still pending.
      done.catch(()=>{}); const result=await fn(name=>tx.objectStore(name),wrapped); await done; return result;
    }catch(e){ try{ tx?.abort(); }catch(_){} if(done) await done.catch(()=>{}); if(mode==='readwrite') onError(e); throw e; }
  }
  const run=(store,mode,fn)=>transaction(store,mode,(get,wrapped)=>fn(get(store),wrapped));
  const op=(store,mode,name,...args)=>run(store,mode,(st,isIdb)=>isIdb?st[name](...args):req(st[name](...args)));
  return { get:(s,k)=>op(s,'readonly','get',k), set:(s,k,v)=>op(s,'readwrite','put',v,k), del:(s,k)=>op(s,'readwrite','delete',k), count:s=>op(s,'readonly','count'), clear:s=>op(s,'readwrite','clear'),
    atomic(stores,fn){ return transaction(stores,'readwrite',(get,wrapped)=>fn((s,name,...args)=>{ const q=get(s)[name](...args); return wrapped?q:req(q); })); },
    keys:s=>op(s,'readonly','getAllKeys'), all:s=>op(s,'readonly','getAll'),
    async entries(s){ return run(s,'readonly',async(st,wrapped)=>{ const [k,v]=await Promise.all([wrapped?st.getAllKeys():req(st.getAllKeys()),wrapped?st.getAll():req(st.getAll())]); return k.map((key,i)=>[key,v[i]]); }); },
    async batch(groups){ const names=Object.keys(groups).filter(s=>groups[s].length); if(!names.length) return;
      return transaction(names,'readwrite',async(get,wrapped)=>{ const pending=[]; for(const s of names) for(const [k,v] of groups[s]){ const q=v===undefined?get(s).delete(k):get(s).put(v,k); pending.push(wrapped?q:req(q)); } await Promise.all(pending); }); },
    snapshot(){ return transaction(DB_STORES,'readonly',async(get,wrapped)=>{ const groups={}; await Promise.all(DB_STORES.map(async s=>{ const st=get(s); const [keys,values]=await Promise.all([wrapped?st.getAllKeys():req(st.getAllKeys()),wrapped?st.getAll():req(st.getAll())]); groups[s]=keys.map((key,i)=>[key,values[i]]); })); return groups; }); },
    putMany(s,pairs){ return this.batch({[s]:pairs}); } };
}
const api={createDatabase}; if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.AgroStorage=api;
})(globalThis);

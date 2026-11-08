/* Account routing is chosen once per page. Login/logout reload instead of redirecting
   outstanding callbacks to another account's database. The legacy database is never deleted. */
(function(root){
  'use strict';
  const STORES=['kv','tiles','records','outbox','meta','blobs','conflicts'];
  const userId=s=>typeof s?.user?.id==='string'&&s.user.id.length>0&&s.user.id.length<=200?s.user.id:null;
  const namespace=id=>id?'user:'+id:'guest';
  const databaseName=id=>id?'agromapa-account-v1:'+encodeURIComponent(id):'agromapa-local-v1';
  function create({createDatabase,planLegacy,randomId=()=>crypto.randomUUID()}){
    const registry=createDatabase('agromapa-accounts-v1'), legacy=createDatabase('agromapa');
    let active,db,initP,migration={copied:0,retained:0,warnings:[]};
    const stale=()=>Object.assign(new Error('A conta mudou em outra aba. Reabra o aplicativo para continuar.'),{name:'AccountChangedError'});
    async function assertActive(){ const current=await registry.get('kv','active'); if(!active||current?.revision!==active.revision) throw stale(); return current; }
    function init(){ if(initP) return initP; initP=initialize(); return initP; }
    async function initialize(){
      const oldSession=await legacy.get('kv','session'), oldInvite=await legacy.get('kv','pendingInvite');
      active=await registry.atomic(['kv'],async op=>{
        let current=await op('kv','get','active');
        if(!current){const id=userId(oldSession);current={userId:id,session:id?oldSession:null,pendingInvite:oldInvite||null,revision:randomId()};await op('kv','put',current,'active');}
        return current;
      });
      db=createDatabase(databaseName(active.userId));
      if(active.pendingInvite){
        await db.set('kv','pendingInvite',active.pendingInvite);
        await registry.atomic(['kv'],async op=>{const current=await op('kv','get','active');if(current?.revision!==active.revision) throw stale();await op('kv','put',{...current,pendingInvite:null},'active');});
        active.pendingInvite=null;
      }
      await migrate(); return {db,active:structuredClone(active),migration};
    }
    async function changeSession(session,{expire=false,pendingInvite=null}={}){
      const id=session?userId(session):expire?active.userId:null;
      if(session&&!id) throw new Error('A conta não possui um identificador válido.');
      await registry.atomic(['kv'],async op=>{
        const current=await op('kv','get','active'); if(current?.revision!==active.revision) throw stale();
        await op('kv','put',{userId:id,session,pendingInvite:session?pendingInvite:null,revision:randomId()},'active');
      });
      // Deliberately leave this page's active identity and database immutable.
    }
    async function refreshSession(session){
      if(userId(session)!==active.userId) throw new Error('A sessão recebida pertence a outra conta.');
      await registry.atomic(['kv'],async op=>{
        const current=await op('kv','get','active');if(current?.revision!==active.revision) throw stale();
        await op('kv','put',{...current,session},'active');
      }); active.session=session;
    }
    async function expireSession(){
      await registry.atomic(['kv'],async op=>{const current=await op('kv','get','active');if(current?.revision!==active.revision) throw stale();await op('kv','put',{...current,session:null},'active');});
      active.session=null;
    }
    async function legacySnapshot(){
      const snapshot=await legacy.snapshot(), kv=new Map(snapshot.kv);
      // Old pre-sync installations used one state2 object. Convert a COPY once so UUIDs
      // stay stable across interrupted migrations. No original state2 data is removed.
      if(!snapshot.records.length&&kv.get('state2')?.farms?.length){
        return registry.atomic(['kv'],async op=>{
          const existing=await op('kv','get','legacy-v3-copy');if(existing) return existing;
          const source=kv.get('state2'),keys=['farms','areas','ops','stock','moves','samples','photos','mip','mipPoints','lots','weighs','rotations','health','fin','tasks','rain','clots'];
          const ids=new Map(); for(const k of keys) for(const r of source[k]||[]) if(r?.id&&!/^[\da-f-]{36}$/i.test(r.id)) ids.set(r.id,randomId());
          const fix=v=>Array.isArray(v)?v.map(fix):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,fix(x)])):ids.get(v)||v;
          const state=fix(source),copy=structuredClone(snapshot);copy.records=[];
          for(const k of keys) (state[k]||[]).forEach((rec,o)=>{
            if(k!=='farms'&&!rec.farmId){const related=(state.areas||[]).find(x=>x.id===rec.areaId)||(state.lots||[]).find(x=>x.id===rec.lotId)||(state.stock||[]).find(x=>x.id===rec.itemId);rec.farmId=related?.farmId||state.farmId||state.farms[0]?.id;}
            copy.records.push([k+':'+rec.id,{k,id:rec.id,rec,o}]);
          });
          copy.kv=[...copy.kv.filter(([k])=>k!=='local'),['local',{...state,schema:4}]];
          await op('kv','put',copy,'legacy-v3-copy');return copy;
        });
      } return snapshot;
    }
    async function copyPlan(plan,sourceTag){
      if(!plan.selectedFarmIds.length) return 0;
      return db.atomic(STORES,async op=>{
        if(plan.selectedFarmIds.length!==1) throw new Error('A cópia deve ser atômica por propriedade.');
        const farmId=plan.selectedFarmIds[0];
        if(await op('meta','get',sourceTag+farmId)) return 0;
        // All records, pending changes, photos, versions and completion markers commit together.
        // An unmarked destination with overlapping entities is not a partial migration we
        // can safely merge: its queue/version may describe a different local edit.
        const keys=new Set(['farms:'+farmId,...['records','outbox','conflicts'].flatMap(s=>plan.groups[s].map(([key])=>key))]);
        const collision=()=>new Error('Os dados anteriores foram preservados: esta propriedade já possui registros ou alterações nesta conta.');
        for(const key of keys){for(const store of ['records','outbox','conflicts']) if(await op(store,'get',key)!==undefined) throw collision();
          if(await op('meta','get','v:'+key)!==undefined) throw collision();}
        for(const store of ['meta','blobs']) for(const [key]of plan.groups[store]) if(await op(store,'get',key)!==undefined) throw collision();
        let count=0;
        for(const store of STORES) for(const [key,value]of plan.groups[store]){
          if(await op(store,'get',key)===undefined){await op(store,'put',value,key);if(store==='records') count++;}
        }
        for(const id of plan.selectedFarmIds) await op('meta','put',{at:Date.now()},sourceTag+id);
        return count;
      });
    }
    async function migrate(authorizedFarmIds=[]){
      await assertActive();
      const snapshot=await legacySnapshot(), options={mode:active.userId?'account':'guest',userId:active.userId,authorizedFarmIds};
      const discovery=planLegacy(snapshot,options), owner=namespace(active.userId);
      const reserved=await registry.atomic(['meta','kv'],async op=>{
        if((await op('kv','get','active'))?.revision!==active.revision) throw stale();
        const selected=[];
        for(const id of discovery.candidateFarmIds){const claim=await op('meta','get','claim:'+id);
          if(!claim||claim.owner===owner){if(!claim) await op('meta','put',{owner},'claim:'+id);selected.push(id);}}
        return selected;
      });
      const selected=[];for(const id of reserved) if(!await db.get('meta','legacy-v1:'+id)) selected.push(id);
      const plan=planLegacy(snapshot,{...options,selectedFarmIds:selected});
      let copied=0; for(const id of selected) copied+=await copyPlan(planLegacy(snapshot,{...options,selectedFarmIds:[id]}),'legacy-v1:');
      const unclaimed=[];for(const id of discovery.candidateFarmIds) if(!reserved.includes(id)) unclaimed.push(id);
      migration={copied,retained:plan.retained.records.length,warnings:plan.warnings,otherAccount:unclaimed.length};
      return migration;
    }
    async function importLocal(){
      if(!active.userId) throw new Error('Entre em uma conta antes de copiar os dados locais.');
      await assertActive(); const snapshot=await createDatabase(databaseName(null)).snapshot();
      const discovery=planLegacy(snapshot,{mode:'guest'}),selected=[];
      for(const id of discovery.candidateFarmIds) if(!await db.get('meta','local-copy-v1:'+id)) selected.push(id);
      let copied=0;for(const id of selected) copied+=await copyPlan(planLegacy(snapshot,{mode:'guest',selectedFarmIds:[id]}),'local-copy-v1:');return copied;
    }
    return {init,assertActive,changeSession,refreshSession,expireSession,migrate,importLocal,get active(){return active;},get migration(){return migration;},get db(){return db;}};
  }
  const api={create,databaseName}; if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.AgroAccountStore=api;
})(globalThis);

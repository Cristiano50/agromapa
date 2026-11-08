const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create,databaseName}=require('../account-store.js');
const {planLegacy}=require('../account-migration.js');
const STORES=['kv','tiles','records','outbox','meta','blobs','conflicts'];
function environment(){
  const databases=new Map();let revision=0;
  function createDatabase(name){if(databases.has(name))return databases.get(name);
    let state=Object.fromEntries(STORES.map(s=>[s,new Map()])),tail=Promise.resolve();
    const db={failCommit:false,get:async(s,k)=>structuredClone(state[s].get(k)),snapshot:async()=>Object.fromEntries(STORES.map(s=>[s,structuredClone([...state[s]])])),
      atomic(stores,fn){const work=tail.catch(()=>{}).then(async()=>{const draft=structuredClone(state);const result=await fn(async(s,op,...args)=>{
        assert.ok(stores.includes(s),'transaction must include '+s);if(op==='get')return structuredClone(draft[s].get(args[0]));if(op==='put'){draft[s].set(args[1],structuredClone(args[0]));return args[1];}if(op==='delete')return draft[s].delete(args[0]);throw Error('unsupported '+op);
      });if(db.failCommit){db.failCommit=false;throw Error('commit failed');}state=draft;return result;});tail=work;return work;},
      set(s,k,v){return this.atomic([s],op=>op(s,'put',v,k));},
      seed(s,k,v){state[s].set(k,structuredClone(v));}};databases.set(name,db);return db;
  }
  const coordinator=()=>create({createDatabase,planLegacy,randomId:()=> 'revision-'+(++revision)});
  return {createDatabase,coordinator,databases};
}
const session=id=>({user:{id},access_token:'access-'+id,refresh_token:'refresh-'+id});
test('session expiry keeps the account and pending data without switching or reloading',async()=>{
  const e=environment();seedLegacy(e);const guest=e.coordinator();await guest.init();await guest.changeSession(session('A'));
  const a=e.coordinator();await a.init();const revision=a.active.revision;await a.expireSession();
  const current=await a.assertActive();assert.equal(current.userId,'A');assert.equal(current.session,null);assert.equal(current.revision,revision);
  assert.equal((await a.db.get('outbox','ops:deleted')).seq,12345);
});
test('pending invite survives explicit login and is not copied again after consumption',async()=>{
  const e=environment(),guest=e.coordinator();await guest.init();await guest.changeSession(session('A'),{pendingInvite:'test-invite'});
  const a=e.coordinator();await a.init();assert.equal(await a.db.get('kv','pendingInvite'),'test-invite');
  await a.db.atomic(['kv'],op=>op('kv','delete','pendingInvite'));const reopened=e.coordinator();await reopened.init();assert.equal(await reopened.db.get('kv','pendingInvite'),undefined);
});
const farm=(id,cloud,user)=>({k:'farms',id,rec:{id,name:id,cloud,_members:user?[{user_id:user}]:[]},o:0});
function seedLegacy(e){const db=e.createDatabase('agromapa');
  db.seed('records','farms:local',farm('local',false));db.seed('records','farms:a',farm('a',true,'A'));db.seed('records','farms:b',farm('b',true,'B'));
  db.seed('records','photos:p',{k:'photos',id:'p',rec:{id:'p',farmId:'a'},o:0});db.seed('blobs','photo:p:t',new Blob(['photo-a']));
  db.seed('outbox','ops:deleted',{k:'ops',id:'deleted',table:'ops',farm:'a',seq:12345,deleted:true,data:{farmId:'a'}});
  db.seed('meta','v:ops:deleted',{version:8});db.seed('meta','cursor:a','cursor-a');db.seed('conflicts','fin:c',{k:'fin',id:'c',farm:'a',mine:{amount:1},server:{data:{amount:2}},version:9});
  db.seed('kv','local',{schema:4,farmId:'local',settings:{base:'sat'}});return db;
}
test('guest, A and B remain isolated; account changes cannot reroute outstanding callbacks',async()=>{const e=environment(),legacy=seedLegacy(e),original=await legacy.snapshot();
  const guest=e.coordinator(),g=await guest.init();assert.ok(await g.db.get('records','farms:local'));assert.equal(await g.db.get('records','farms:a'),undefined);
  await guest.changeSession(session('A'));const a=e.coordinator(),ai=await a.init();assert.ok(await ai.db.get('records','farms:a'));assert.equal(await ai.db.get('records','farms:local'),undefined);
  await a.changeSession(session('B'));const b=e.coordinator(),bi=await b.init();assert.ok(await bi.db.get('records','farms:b'));assert.equal(await bi.db.get('records','farms:a'),undefined);
  await ai.db.atomic(['kv'],op=>op('kv','put','late-A','callback'));assert.equal(await bi.db.get('kv','callback'),undefined);assert.equal(a.db,ai.db);assert.equal((await a.init()).db,ai.db);
  await assert.rejects(a.assertActive(),{name:'AccountChangedError'});assert.deepEqual(await legacy.snapshot(),original);
});
test('pending deletions, sequences, versions, conflicts and blobs commit together',async()=>{const e=environment(),legacy=seedLegacy(e);legacy.seed('kv','session',session('A'));const c=e.coordinator(),{db}=await c.init();
  assert.equal((await db.get('outbox','ops:deleted')).seq,12345);assert.equal((await db.get('outbox','ops:deleted')).deleted,true);assert.equal((await db.get('meta','v:ops:deleted')).version,8);
  assert.equal((await db.get('conflicts','fin:c')).version,9);assert.equal(await (await db.get('blobs','photo:p:t')).text(),'photo-a');assert.ok(await db.get('meta','legacy-v1:a'));
});
test('failed copy retains claim and all source data; same owner can retry atomically',async()=>{const e=environment(),legacy=seedLegacy(e);legacy.seed('kv','session',session('A'));const before=await legacy.snapshot(),dest=e.createDatabase(databaseName('A'));dest.failCommit=true;
  await assert.rejects(e.coordinator().init(),/commit failed/);assert.equal(await dest.get('records','farms:a'),undefined);assert.equal(await dest.get('outbox','ops:deleted'),undefined);assert.equal(await dest.get('meta','legacy-v1:a'),undefined);
  assert.equal((await e.createDatabase('agromapa-accounts-v1').get('meta','claim:a')).owner,'user:A');
  await e.coordinator().init();assert.ok(await dest.get('meta','legacy-v1:a'));assert.deepEqual(await legacy.snapshot(),before);
});
test('reentrant migration is idempotent and never replays a consumed outbox entry',async()=>{const e=environment();seedLegacy(e).seed('kv','session',session('A'));const c=e.coordinator(),{db}=await c.init();
  await db.atomic(['outbox'],op=>op('outbox','delete','ops:deleted'));await Promise.all([c.migrate(['a']),c.migrate(['a'])]);assert.equal(await db.get('outbox','ops:deleted'),undefined);
});
test('farm claimed by A cannot replay legacy pending edits into B even with API access',async()=>{const e=environment();seedLegacy(e).seed('kv','session',session('A'));const a=e.coordinator();await a.init();await a.changeSession(session('B'));
  const b=e.coordinator();await b.init();await b.migrate(['a','b']);assert.equal(await b.db.get('records','farms:a'),undefined);assert.equal(await b.db.get('outbox','ops:deleted'),undefined);
});
test('logout preserves account database and refresh rejects a different user or stale tab',async()=>{const e=environment();seedLegacy(e).seed('kv','session',session('A'));const a=e.coordinator();await a.init();
  await assert.rejects(a.refreshSession(session('B')),/outra conta/);await a.refreshSession({...session('A'),access_token:'renewed'});assert.equal(a.active.session.access_token,'renewed');
  await a.changeSession(null);assert.equal((await e.createDatabase('agromapa-accounts-v1').get('kv','active')).userId,null);assert.ok(await a.db.get('records','farms:a'));
  await assert.rejects(a.refreshSession(session('A')),{name:'AccountChangedError'});assert.equal((await e.coordinator().init()).active.userId,null);
});
test('explicit local import preserves source and is idempotent',async()=>{const e=environment();seedLegacy(e);const g=e.coordinator();await g.init();const before=await g.db.snapshot();await g.changeSession(session('A'));
  const a=e.coordinator();await a.init();assert.equal(await a.importLocal(),1);assert.ok(await a.db.get('records','farms:local'));assert.equal(await a.importLocal(),0);assert.deepEqual(await g.db.snapshot(),before);
});
test('overlapping destination queues abort copy without inconsistent metadata or completion marker',async()=>{const e=environment();seedLegacy(e).seed('kv','session',session('A'));const dest=e.createDatabase(databaseName('A'));
  dest.seed('outbox','ops:deleted',{k:'ops',id:'deleted',farm:'a',seq:999,data:{newer:true}});const before=await dest.snapshot();
  await assert.rejects(e.coordinator().init(),/preservados/);assert.deepEqual(await dest.snapshot(),before);assert.equal(await dest.get('meta','legacy-v1:a'),undefined);
});
test('two simultaneous first migrations recheck completion inside the write transaction',async()=>{const e=environment();seedLegacy(e).seed('kv','session',session('A'));const [first,second]=await Promise.all([e.coordinator().init(),e.coordinator().init()]);
  assert.equal(first.db,second.db);assert.equal((await first.db.get('outbox','ops:deleted')).seq,12345);assert.equal(first.migration.copied+second.migration.copied,2);
});
test('v3 conversion preserves original and reuses generated IDs after failed commit',async()=>{const e=environment(),legacy=e.createDatabase('agromapa');
  const original={farms:[{id:'old-farm',name:'Local'}],areas:[{id:'old-area',farmId:'old-farm'}],farmId:'old-farm',settings:{base:'sat'}};legacy.seed('kv','state2',original);
  e.createDatabase(databaseName(null)).failCommit=true;await assert.rejects(e.coordinator().init(),/commit failed/);
  const registry=e.createDatabase('agromapa-accounts-v1'),copy=await registry.get('kv','legacy-v3-copy');const newId=copy.records.find(([,r])=>r.k==='farms')[1].id;
  const next=await e.coordinator().init();assert.ok(await next.db.get('records','farms:'+newId));assert.deepEqual(await legacy.get('kv','state2'),original);assert.deepEqual(await registry.get('kv','legacy-v3-copy'),copy);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const section=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));

// Native IndexedDB test double: requests succeed before the transaction commits.
// A late abort must roll back every store, despite successful individual requests.
function database(){
  const stores=new Map(['kv','tiles','records','outbox','meta','blobs','conflicts'].map(k=>[k,new Map()]));
  const control={stores,failCommit:false,commits:0};
  control.open=()=>{const request={}; queueMicrotask(()=>request.onsuccess({target:{result:{
    transaction(names,mode){names=Array.isArray(names)?names:[names];const drafts=new Map(names.map(n=>[n,new Map(stores.get(n))]));
      let ended=false;const tx={error:null,abort(){if(ended)return;ended=true;tx.error=new Error('Transaction aborted');queueMicrotask(()=>tx.onabort?.());},
        objectStore(name){const map=drafts.get(name);const make=fn=>{const r={};queueMicrotask(()=>{try{r.result=fn();r.onsuccess?.();}catch(e){r.error=e;r.onerror?.();tx.abort();}});return r;};return {
          put:(v,k)=>make(()=>map.set(k,structuredClone(v))),delete:k=>make(()=>map.delete(k)),get:k=>make(()=>map.get(k)),
          getAllKeys:()=>make(()=>[...map.keys()]),getAll:()=>make(()=>[...map.values()]),count:()=>make(()=>map.size),clear:()=>make(()=>map.clear())};}};
      setImmediate(()=>{if(ended)return;if(control.failCommit){control.failCommit=false;tx.abort();return;}ended=true;if(mode==='readwrite'){control.beforeCommit?.(names);for(const [k,v]of drafts)stores.set(k,v);control.commits++;}tx.oncomplete?.();});return tx;}
  }}}));return request;};return control;
}
function fixture(){const db=database();const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}},indexedDB:db,AgroStorage:{createDatabase:(name,options)=>require('../storage.js').createDatabase(name,{...options,indexedDB:db})},structuredClone,console,setTimeout,clearTimeout,AbortController,toast(){},
  S:{photos:[],farms:[{id:'f',cloud:true,name:'Initial'}],settings:{},alerts:{},forecast:{},farmId:'f'},SKEYS:{farms:'farm'},SKEY_ALIAS:{},SNAP:new Map(),SYNCSEQ:0,persistT:null,persistP:null,WIPING:false,
  PHOTO_URLS:new Map(),recData:(k,r)=>({...r}),farmOfRec:(k,r)=>r.id,isCloud:()=>true,SYNC:{schedule(){},updatePill(){}},uid:()=> 'generated',healOld:()=>false,isFolha:()=>false,FV:0});
  vm.runInContext(section('const DB_STORES=', '/* ============================ base de conhecimento'),context);
  vm.runInContext(section('function save(){','async function load(){'),context);
  vm.runInContext(section('async function acknowledgeSync(', 'async function requestWithTimeout('),context);
  vm.runInContext('globalThis.db=DB; globalThis.doPersist=persist; globalThis.snap=SNAP',context);return {db,context};}

test('batch waits for actual commit and rolls back all stores on a late abort',async()=>{const {db,context:c}=fixture();db.failCommit=true;
  await assert.rejects(c.db.batch({records:[['x',{value:1}]],outbox:[['x',{value:1}]],kv:[['local',{value:1}]]}));
  for(const name of ['records','outbox','kv'])assert.equal(db.stores.get(name).size,0);
  await c.db.batch({records:[['x',{value:2}]],outbox:[['x',{value:2}]]});assert.equal(db.stores.get('outbox').get('x').value,2);
});
test('failed persistence retains dirty snapshot and retries the unchanged data',async()=>{const {db,context:c}=fixture();db.failCommit=true;
  await assert.rejects(c.doPersist());assert.equal(c.snap.size,0);assert.equal(db.stores.get('records').size,0);
  await c.doPersist();assert.equal(db.stores.get('records').get('farms:f').rec.name,'Initial');assert.ok(db.stores.get('outbox').has('farms:f'));assert.equal(c.snap.size,1);
});
test('queued saves preserve a newer edit while a previous commit is pending',async()=>{const {db,context:c}=fixture();const first=c.doPersist();await new Promise(queueMicrotask);
  c.S.farms[0].name='Newer';const second=c.doPersist();await Promise.all([first,second]);
  assert.equal(db.stores.get('records').get('farms:f').rec.name,'Newer');assert.equal(db.stores.get('outbox').get('farms:f').data.name,'Newer');assert.equal(JSON.parse(c.snap.get('farms:f')).name,'Newer');
});
test('deletion failure keeps prior snapshot and retries the tombstone',async()=>{const {db,context:c}=fixture();await c.doPersist();c.S.farms=[];db.failCommit=true;
  await assert.rejects(c.doPersist());assert.ok(c.snap.has('farms:f'));assert.ok(db.stores.get('records').has('farms:f'));
  await c.doPersist();assert.equal(db.stores.get('records').has('farms:f'),false);assert.equal(db.stores.get('outbox').get('farms:f').deleted,true);
});
function network(fetch){const c=vm.createContext({fetch,AbortController,setTimeout,clearTimeout});vm.runInContext(section('async function requestWithTimeout(', 'const SYNC=(()=>'),c);return c.requestWithTimeout;}
test('timeout aborts request and a subsequent request can succeed',async()=>{let aborted=false,calls=0;
  const request=network((url,{signal})=>{calls++;if(calls===1){signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});}return Promise.resolve({json:async()=>({ok:true})});});
  await assert.rejects(request('/test',{},r=>r.json(),5),e=>e.name==='TimeoutError');assert.equal(aborted,true);
  assert.equal((await request('/test',{},r=>r.json(),100)).ok,true);
});
test('timeout also covers a stalled response body',async()=>{const request=network(async()=>({json:()=>new Promise(()=>{})}));
  await assert.rejects(request('/test',{},r=>r.json(),5),e=>e.name==='TimeoutError');
});
test('acknowledging an old push preserves a newer queued edit',async()=>{const {db,context:c}=fixture();await c.doPersist();const old=structuredClone(db.stores.get('outbox').get('farms:f'));
  c.S.farms[0].name='New edit';await c.doPersist();await c.acknowledgeSync('farms:f',old,{status:'ok',version:2},'f');
  assert.equal(db.stores.get('outbox').get('farms:f').data.name,'New edit');assert.equal(db.stores.get('meta').get('v:farms:f').version,2);
});
test('pull flushes a debounced local change before replacing remote state',async()=>{const {db,context:c}=fixture();await c.doPersist();await c.db.del('outbox','farms:f');c.S.farms[0].name='Unsaved form edit';
  assert.equal(await c.receiveSync('farms','f',{name:'Remote'},false,3),false);assert.equal(c.S.farms[0].name,'Unsaved form edit');assert.equal(db.stores.get('outbox').get('farms:f').data.name,'Unsaved form edit');
});
test('pull does not overwrite a form edit made during its transaction commit',async()=>{const {db,context:c}=fixture();await c.doPersist();await c.db.del('outbox','farms:f');
  db.beforeCommit=names=>{if(names.includes('conflicts')&&names.includes('records')){c.S.farms[0].name='Typed during pull';db.beforeCommit=null;}};
  assert.equal(await c.receiveSync('farms','f',{name:'Remote'},false,3),false);assert.equal(c.S.farms[0].name,'Typed during pull');
  await c.persistNow();assert.equal(db.stores.get('outbox').get('farms:f').data.name,'Typed during pull');
});
test('app update is blocked on failed save and proceeds after retry succeeds',async()=>{const button={};let fail=true,messages=0,warning=0;
  const c=vm.createContext({$:()=>button,UPD:{requested:false,reg:{waiting:{postMessage(){messages++;}}}},persistNow:async()=>{if(fail)throw new Error('quota');},showSaveFailure(){warning++;},toast(){},location:{reload(){throw new Error('Unexpected reload');}}});
  vm.runInContext(html.split('\n').find(line=>line.includes("$('#updNow').onclick=")),c);
  await button.onclick();assert.equal(messages,0);assert.equal(c.UPD.requested,false);assert.equal(warning,1);
  fail=false;await button.onclick();assert.equal(messages,1);assert.equal(c.UPD.requested,true);
});
test('invite failure preserves token for transient errors and removes only definitive invalid responses',async()=>{
  const line=html.split('\n').find(line=>line.includes("api('POST','/invites/accept'"));
  const handler=line.slice(line.indexOf('}catch(e){')+10,line.lastIndexOf('} }'));
  for(const status of [undefined,401,403,429,500,503,400,404,410,422]){
    const pending=new Map([['pendingInvite','token']]);const error=Object.assign(new Error('invite failure'),{status});
    const c=vm.createContext({DB:{del:async(store,key)=>pending.delete(key)},toast(){},error});
    await assert.rejects(vm.runInContext('(async function(e){'+handler+'})(error)',c),e=>e===error);
    assert.equal(pending.has('pendingInvite'),![400,404,410,422].includes(status),'HTTP '+status);
  }
});

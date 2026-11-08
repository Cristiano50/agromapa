const {test}=require('node:test');
const assert=require('node:assert/strict');
const {planLegacy}=require('../account-migration.js');
const record=(k,rec)=>[k+':'+rec.id,{k,id:rec.id,rec,o:0}];
function fixture(){return {
  records:[record('farms',{id:'local',name:'Local'}),record('farms',{id:'a',name:'A',cloud:true,_members:[{user_id:'alice'}]}),record('farms',{id:'b',name:'B',cloud:true,_members:[{user_id:'bob'}]}),record('areas',{id:'areaA',farmId:'a'}),record('photos',{id:'photoA',areaId:'areaA'})],
  outbox:[['ops:deleted',{k:'ops',table:'ops',id:'deleted',farm:'a',data:{farmId:'a',value:42},seq:987654321,deleted:true}]],
  conflicts:[['fin:conflict',{k:'fin',table:'finance',id:'conflict',farm:'a',mine:{amount:10},mineDeleted:false,server:{data:{amount:20}},version:9,at:123}]],
  meta:[['v:ops:deleted',{version:8}],['v:fin:conflict',{version:7}],['cursor:a','cursor-a'],['cursor:b','cursor-b']],
  blobs:[['photo:photoA:t',new Blob(['photo'])],['photo:other:t',new Blob(['other'])]],tiles:[['lic/1/2/3',new Blob(['tile'])]],
  kv:[['session',{user:{id:'bob'},refresh_token:'secret'}],['device','old-device'],['tile:a',{template:'token-url'}],['pendingInvite','secret-invite'],['local',{farmId:'b',schema:4,settings:{base:'sat',tab:'painel',soilUnit:'cmolc',token:'secret',logos:{a:'data:image/png;base64,YQ==',b:'data:image/png;base64,Yg=='},layers:{areas:true,token:'secret'}},alerts:{secret:'b'},forecast:{secret:'b'},dmSession:{farmId:'b'}}]]
};}
test('discovery requires final farm claims before returning any copies',()=>{const p=planLegacy(fixture(),{mode:'account',userId:'alice',authorizedFarmIds:['b']});
  assert.deepEqual(p.candidateFarmIds,['a','b']);assert.deepEqual(p.selectedFarmIds,[]);assert.ok(Object.values(p.groups).every(a=>a.length===0));
});
test('membership cannot bypass explicit final claims',()=>{const p=planLegacy(fixture(),{mode:'account',userId:'alice',authorizedFarmIds:['b'],selectedFarmIds:['b']});
  assert.deepEqual(p.selectedFarmIds,['b']);assert.equal(p.groups.outbox.length,0);assert.equal(p.groups.conflicts.length,0);assert.ok(p.retained.records.includes('farms:a'));
});
test('guest receives only purely local farms, even when claims include cloud farms',()=>{const p=planLegacy(fixture(),{mode:'guest',selectedFarmIds:['a','b','local']});
  assert.deepEqual(p.selectedFarmIds,['local']);assert.deepEqual(p.groups.records.map(x=>x[0]),['farms:local']);assert.equal(p.groups.outbox.length,0);
});
test('account preserves tombstones, sequence, versions, conflicts and associated photo blobs',async()=>{const s=fixture(),p=planLegacy(s,{mode:'account',userId:'alice',selectedFarmIds:['a']});
  assert.deepEqual(p.groups.outbox,s.outbox);assert.deepEqual(p.groups.conflicts,s.conflicts);assert.ok(p.groups.meta.some(([k])=>k==='v:ops:deleted'));assert.ok(p.groups.meta.some(([k])=>k==='cursor:a'));
  assert.equal(p.groups.blobs.length,1);assert.equal(await p.groups.blobs[0][1].text(),'photo');assert.equal(p.groups.tiles.length,0);
});
test('unknown tombstone farm is retained unless authorized by API, without requiring live farm',()=>{const s={outbox:[['areas:gone',{k:'areas',id:'gone',farm:'orphan',data:{},deleted:true,seq:99}]]};
  assert.equal(planLegacy(s,{mode:'account',userId:'alice',selectedFarmIds:['orphan']}).groups.outbox.length,0);
  const p=planLegacy(s,{mode:'account',userId:'alice',authorizedFarmIds:['orphan'],selectedFarmIds:['orphan']});assert.equal(p.groups.outbox[0][1].seq,99);
});
test('conflicting ownership remains in legacy rather than being reassigned',()=>{const s=fixture();s.records.push(record('ops',{id:'wrong',farmId:'b',areaId:'areaA'}));s.outbox.push(['ops:wrong',{k:'ops',id:'wrong',farm:'a',data:{farmId:'b'},seq:5}]);
  const p=planLegacy(s,{mode:'account',userId:'alice',authorizedFarmIds:['a','b'],selectedFarmIds:['a','b']});assert.ok(p.retained.records.includes('ops:wrong'));assert.ok(p.retained.outbox.includes('ops:wrong'));assert.ok(p.warnings.length);
});
test('settings exclude other farms, sessions, tokens and derived data',()=>{const p=planLegacy(fixture(),{mode:'account',userId:'alice',selectedFarmIds:['a']});
  assert.deepEqual(p.groups.kv.map(x=>x[0]),['local']);const local=p.groups.kv[0][1];assert.equal(local.farmId,'a');assert.equal(local.settings.token,undefined);assert.deepEqual(Object.keys(local.settings.logos),['a']);assert.deepEqual(local.settings.layers,{areas:true});assert.deepEqual(local.forecast,{});assert.equal(local.dmSession,null);
});
test('planning is deterministic and never mutates legacy records or sequence numbers',()=>{const s=fixture(),before=structuredClone(s),options={mode:'account',userId:'alice',selectedFarmIds:['a']};
  const a=planLegacy(s,options),b=planLegacy(s,options);assert.deepEqual(a,b);assert.deepEqual(s,before);a.groups.outbox[0][1].seq=1;assert.equal(s.outbox[0][1].seq,987654321);
});
test('queue and remote metadata prevent a farm without cloud flag from becoming guest data',()=>{const s={records:[record('farms',{id:'x'})],outbox:[['ops:x',{k:'ops',id:'x',farm:'x',seq:8}]]};
  assert.deepEqual(planLegacy(s,{mode:'guest',selectedFarmIds:['x']}).selectedFarmIds,[]);
  delete s.outbox;s.meta=[['v:farms:x',{version:2}]];assert.deepEqual(planLegacy(s,{mode:'guest',selectedFarmIds:['x']}).selectedFarmIds,[]);
});

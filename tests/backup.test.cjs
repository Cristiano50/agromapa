const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prepare}=require('../backup.js');
const keys=['farms','areas','ops','samples'];
const options={keys,uid:()=>crypto.randomUUID(),isUUID:id=>/^[a-f\d-]{36}$/i.test(id)};
const fid='11111111-1111-4111-8111-111111111111';
const base=()=>({farms:[{id:fid,name:'Fazenda',cloud:true,_role:'owner'}],areas:[],ops:[],samples:[],farmId:fid});
test('invalid later collection does not partially change farms or live state',()=>{
  const state=base(), before=structuredClone(state);
  assert.throws(()=>prepare({farms:[{id:fid,name:'Changed'}],ops:[{id:'op',inputs:null}]},state,options),/insumos/);
  assert.deepEqual(state,before);
});
test('merge preserves cloud ownership and does not trust imported roles',()=>{
  const state=base();
  const result=prepare({farms:[{id:fid,name:'Updated',_role:'viewer',cloud:false}]},state,options);
  assert.equal(result.state.farms[0]._role,'owner'); assert.equal(result.state.farms[0].cloud,true);
  assert.equal(state.farms[0].name,'Fazenda'); assert.equal(result.updated,1);
});
test('legacy IDs are remapped consistently without changing source',()=>{
  const source={farms:[{id:'old',name:'Nova'}],ops:[{id:'operation',farmId:'old',inputs:[]}],farmId:'old'};
  const before=structuredClone(source), result=prepare(source,base(),options);
  assert.equal(result.state.ops[0].farmId,result.state.farmId);
  assert.equal(result.added,2); assert.deepEqual(source,before);
});
test('rejects unknown versions, bad geometry, invalid references and duplicate IDs',()=>{
  const invalid=[{farms:[],schema:99},{farms:[],areas:[{id:'a',name:'A',pts:[{lat:200,lng:0}]}]},
    {farms:[],ops:[{id:'o',farmId:'missing',inputs:[]}]},{farms:[{id:fid,name:'A'},{id:fid,name:'B'}]}];
  for(const source of invalid) assert.throws(()=>prepare(source,base(),options));
});
test('rejects prototype keys at any depth',()=>{
  assert.throws(()=>prepare(JSON.parse('{"farms":[],"settings":{"__proto__":{"x":true}}}'),base(),options),/permitido/);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('all inline scripts and standalone runtime files parse',()=>{
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  for(const file of ['backup.js','sw.js']) new vm.Script(fs.readFileSync(path.join(root,file),'utf8'));
});
test('static UI IDs are unique',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').split('<script>')[0];
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
});

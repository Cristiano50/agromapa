const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('async function switchAccount('),html.indexOf('async function checkAccountChange('));
function fixture(failSave=false){const calls=[],app={inert:false};const c=vm.createContext({ACCOUNT_SWITCHING:false,$:()=>app,
  SYNC:{idle:async()=>calls.push('idle')},persistNow:async()=>{calls.push('save');if(failSave)throw Error('disk full');},
  DB:{get:async()=> 'invite'},ACCOUNTS:{changeSession:async(s,o)=>calls.push(['change',s,o])},notifyAccountChange:()=>calls.push('notify'),location:{reload:()=>calls.push('reload')},toast(){},showSaveFailure(){}});
  vm.runInContext(source,c);return {c,calls,app};}
test('account switch flushes pending writes before changing identity and reloads only afterwards',async()=>{const {c,calls}=fixture();await c.switchAccount({user:{id:'B'}});assert.deepEqual(calls.slice(0,2),['idle','save']);assert.equal(calls[2][0],'change');assert.equal(calls[2][2].pendingInvite,'invite');assert.deepEqual(calls.slice(3),['notify','reload']);});
test('failed save blocks logout and leaves original identity and page intact',async()=>{const {c,calls,app}=fixture(true);await assert.rejects(c.switchAccount(null),/disk full/);assert.deepEqual(calls,['idle','save']);assert.equal(app.inert,false);assert.equal(c.ACCOUNT_SWITCHING,false);});

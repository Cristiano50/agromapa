/* Pure, non-destructive legacy migration planner. The caller reserves farm claims,
   then atomically copies missing destination keys and its per-farm completion markers.
   No claim, session, credential, or source deletion is performed by this module. */
(function(root){
  'use strict';
  const STORES=['kv','tiles','records','outbox','meta','blobs','conflicts'];
  const ENTITY_KEYS=['farms','areas','ops','stock','moves','samples','photos','mip','mipPoints','lots','weighs','rotations','health','fin','tasks','rain','clots'];
  const string=v=>typeof v==='string'&&v.length>0;
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  function planLegacy(snapshot,{mode,userId,authorizedFarmIds=[],selectedFarmIds=[]}={}){
    if(!['guest','account'].includes(mode)) throw new Error('Migration mode must be guest or account');
    if(mode==='account'&&!string(userId)) throw new Error('Account migration requires a user ID');
    const source={}; for(const store of STORES){ const input=snapshot?.[store]||[];
      if(!(input instanceof Map)&&!Array.isArray(input)) throw new Error('Invalid store snapshot: '+store);
      const pairs=Array.from(input); if(pairs.some(p=>!Array.isArray(p)||p.length!==2||!string(p[0]))) throw new Error('Invalid snapshot entry: '+store);
      if(new Set(pairs.map(p=>p[0])).size!==pairs.length) throw new Error('Duplicate snapshot key: '+store);
      source[store]=new Map(pairs);
    }
    const groups=Object.fromEntries(STORES.map(s=>[s,[]])); const copied=Object.fromEntries(STORES.map(s=>[s,new Set()]));
    const warnings=[], farms=new Map(), owners=new Map(), farmIds=new Set(), cloud=new Set(), validRecords=new Map();
    function addOwner(key,id){ if(!string(id)) return; farmIds.add(id); if(!owners.has(key)) owners.set(key,new Set()); owners.get(key).add(id); }
    for(const [key,row]of source.records){
      if(!object(row)||!ENTITY_KEYS.includes(row.k)||!object(row.rec)||!string(row.id)||row.rec.id!==row.id||key!==row.k+':'+row.id) continue;
      validRecords.set(key,row);
      if(row.k==='farms'){ farms.set(row.id,row.rec); addOwner(key,row.id); if(row.rec.cloud||(Array.isArray(row.rec._members)&&row.rec._members.length)) cloud.add(row.id); }
      else addOwner(key,row.rec.farmId);
    }
    for(const store of ['outbox','conflicts']) for(const [key,row]of source[store]){
      if(!object(row)||!ENTITY_KEYS.includes(row.k)||!string(row.id)||key!==row.k+':'+row.id) continue;
      addOwner(key,row.farm); addOwner(key,row.data?.farmId); addOwner(key,row.mine?.farmId);
      if(row.k==='farms') addOwner(key,row.id);
      for(const id of owners.get(key)||[]) cloud.add(id);
    }
    // Resolve legacy records that refer to their farm through an area, lot, or stock item.
    let changed=true; while(changed){changed=false;
      for(const [key,row]of validRecords) for(const [field,kind]of [['areaId','areas'],['lotId','lots'],['itemId','stock']]){
        const ref=row.rec[field]; if(!string(ref)) continue;
        for(const id of owners.get(kind+':'+ref)||[]){const previous=owners.get(key)?.size||0; addOwner(key,id); if(owners.get(key).size!==previous) changed=true;}
      }
    }
    for(const [key]of source.meta){
      if(key.startsWith('cursor:')){const id=key.slice(7); if(string(id)){farmIds.add(id);cloud.add(id);}}
      else if(key.startsWith('v:')) for(const id of owners.get(key.slice(2))||[]) cloud.add(id);
    }
    // Queued entries may acquire ownership through their associated live record.
    for(const store of ['outbox','conflicts']) for(const [key]of source[store]) for(const id of owners.get(key)||[]) cloud.add(id);
    const authorized=new Set(authorizedFarmIds); const claimed=new Set(selectedFarmIds);
    const candidates=[...farmIds].filter(id=>{
      if(mode==='guest') return farms.has(id)&&!cloud.has(id);
      const members=farms.get(id)?._members;
      return cloud.has(id)&&(authorized.has(id)||(Array.isArray(members)&&members.some(m=>m?.user_id===userId)));
    }).sort();
    const selected=candidates.filter(id=>claimed.has(id)), selectedSet=new Set(selected);
    const eligible=key=>{const ids=owners.get(key);return ids?.size===1&&selectedSet.has([...ids][0]);};
    const copy=(store,key,value)=>{ groups[store].push([key,structuredClone(value)]); copied[store].add(key); };
    for(const [key,row]of validRecords) if(eligible(key)) copy('records',key,row);
    for(const store of ['outbox','conflicts']) for(const [key,row]of source[store]){
      if(mode==='account'&&object(row)&&ENTITY_KEYS.includes(row.k)&&key===row.k+':'+row.id&&eligible(key)) copy(store,key,row);
    }
    const entities=new Set([...copied.records,...copied.outbox,...copied.conflicts]);
    for(const [key,value]of source.meta) if((key.startsWith('v:')&&entities.has(key.slice(2)))||(mode==='account'&&key.startsWith('cursor:')&&selectedSet.has(key.slice(7)))) copy('meta',key,value);
    for(const [key,value]of source.blobs){ const match=/^photo:(.+):(t|f)$/.exec(key); if(match&&entities.has('photos:'+match[1])) copy('blobs',key,value); }
    const local=source.kv.get('local');
    if(selected.length&&object(local)){
      const settings={}, original=object(local.settings)?local.settings:{};
      // Explicit allowlist: never carry authentication state, tokens, or unscoped arbitrary settings.
      for(const key of ['base','tab','soilUnit','finSeason','instHide']){ const v=original[key]; if(typeof v==='boolean'||typeof v==='number'||(typeof v==='string'&&v.length<200)) settings[key]=v; }
      if(object(original.layers)) settings.layers=Object.fromEntries(Object.entries(original.layers).filter(([k,v])=>typeof v==='boolean'&&/^[\w-]{1,80}$/.test(k)));
      if(object(original.logos)) settings.logos=Object.fromEntries(Object.entries(original.logos).filter(([id,v])=>selectedSet.has(id)&&typeof v==='string'&&/^data:image\/(png|jpeg);base64,/.test(v)));
      if(string(original.colArea)&&entities.has('areas:'+original.colArea)) settings.colArea=original.colArea;
      // Derived forecasts/alerts and incomplete field sessions stay recoverable in legacy storage.
      copy('kv','local',{settings,farmId:selectedSet.has(local.farmId)?local.farmId:selected[0],schema:local.schema||4,alerts:{items:[],at:null},forecast:{},dmSession:null});
    }
    for(const [key,ids]of owners) if(ids.size>1) warnings.push('Conflicting farm ownership retained in legacy: '+key);
    if(source.kv.has('state2')) warnings.push('Legacy state2 requires explicit conversion; retained unchanged.');
    const retained=Object.fromEntries(STORES.map(s=>[s,[...source[s].keys()].filter(k=>!copied[s].has(k))]));
    return {groups,candidateFarmIds:candidates,selectedFarmIds:selected,retained,warnings};
  }
  if(typeof module!=='undefined'&&module.exports) module.exports={planLegacy}; else root.AgroAccountMigration={planLegacy};
})(globalThis);

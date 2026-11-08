/* Backup preparation is pure: malformed files never modify the live application. */
(function(root){
  'use strict';
  function prepare(src,current,{keys,uid,isUUID}){
    const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
    const fail=message=>{ throw new Error(message); };
    if(!object(src)||!Array.isArray(src.farms)) fail('O arquivo não contém uma lista de propriedades.');
    if(src.schema!=null&&(!Number.isInteger(src.schema)||src.schema>4||src.schema<1)) fail('Versão de backup não suportada.');
    function check(v,depth=0){
      if(depth>40) fail('Estrutura de backup muito profunda.');
      if(v&&typeof v==='object') for(const [k,x] of Object.entries(v)){
        if(['__proto__','prototype','constructor'].includes(k)) fail('Campo de backup não permitido.');
        check(x,depth+1);
      }
    }
    check(src);
    let count=0;
    const point=p=>object(p)&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180;
    const polygon=pts=>Array.isArray(pts)&&pts.length>=3&&pts.length<=100000&&pts.every(point);
    for(const k of keys){
      if(src[k]===undefined) continue;
      if(!Array.isArray(src[k])) fail(`A lista ${k} é inválida.`);
      count+=src[k].length; if(count>100000) fail('O backup excede o limite de registros.');
      const ids=new Set();
      for(const r of src[k]){
        if(!object(r)||typeof r.id!=='string'||!r.id||r.id.length>200||ids.has(r.id)) fail(`Identificador inválido ou repetido em ${k}.`);
        ids.add(r.id);
        if(['farms','areas'].includes(k)&&(typeof r.name!=='string'||!r.name.trim())) fail(`Nome ausente em ${k}.`);
        if(k==='areas'&&!polygon(r.pts)) fail('Coordenadas de talhão inválidas.');
        if(k==='areas'&&r.season!=null&&!object(r.season)) fail('Safra de talhão inválida.');
        if(k==='farms'&&r.boundary!=null&&(!object(r.boundary)||!polygon(r.boundary.pts))) fail('Divisa da propriedade inválida.');
        if(k==='ops'&&(!Array.isArray(r.inputs)||!r.inputs.every(object))) fail('Lista de insumos inválida.');
        for(const f of ['sources','entries','payments']) if(r[f]!=null&&(!Array.isArray(r[f])||!r[f].every(object))) fail(`Lista ${f} inválida.`);
        if(r.farmId!=null&&typeof r.farmId!=='string') fail('Referência de propriedade inválida.');
      }
    }
    const map=new Map();
    for(const k of keys) for(const r of src[k]||[]) if(!isUUID(r.id)&&!map.has(r.id)) map.set(r.id,uid());
    const fix=v=>Array.isArray(v)?v.map(fix):object(v)?Object.fromEntries(Object.entries(v).map(([a,b])=>[a,fix(b)])):typeof v==='string'&&map.has(v)?map.get(v):v;
    const incoming=fix(src), state=structuredClone(current); let added=0,updated=0;
    for(const k of keys) for(const r of incoming[k]||[]){
      for(const name of ['cloud','_members','_role','_bSeeded']) delete r[name];
      if(k==='areas'){
        const se=r.season||(r.season={}), text=String(se.spacing||'').replace(/,/g,'.');
        if(text&&!se.rowSp){ const m=text.match(/([\d.]+)\s*[x×]\s*([\d.]+)/); if(m){ se.rowSp=+m[1]; se.plantSp=+m[2]; } }
        if(se.plantDate&&!se.plantYear) se.plantYear=+String(se.plantDate).slice(0,4);
      }
      if(k==='samples'&&r.results&&!r.resultsUnit) r.resultsUnit='mmolc';
      const i=state[k].findIndex(x=>x.id===r.id);
      if(i>=0){
        if(k==='farms') for(const name of ['cloud','_members','_role','_bSeeded']) if(state[k][i][name]!==undefined) r[name]=state[k][i][name];
        state[k][i]=r; updated++;
      }else{ state[k].push(r); added++; }
    }
    const farms=new Set(state.farms.map(f=>f.id));
    for(const k of keys) for(const r of incoming[k]||[]) if(r.farmId&&!farms.has(r.farmId)) fail('Registro aponta para uma propriedade inexistente.');
    if(incoming.farmId&&farms.has(incoming.farmId)) state.farmId=incoming.farmId;
    return {state,added,updated};
  }
  if(typeof module!=='undefined'&&module.exports) module.exports={prepare};
  else root.AgroBackup={prepare};
})(globalThis);

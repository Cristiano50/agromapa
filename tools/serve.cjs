// Local preview only. No dependencies and no directory listing.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const port=Number(process.argv[2]||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  let rel; try{ rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname); }catch{res.writeHead(400).end();return;}
  if(rel==='/') rel='/index.html';
  const file=path.resolve(root,'.'+rel);
  if(!file.startsWith(root+path.sep)||rel.split('/').some(p=>p.startsWith('.'))){res.writeHead(403).end();return;}
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(body);});
}).listen(port,'127.0.0.1',()=>console.log('AgroMapa: http://127.0.0.1:'+port));

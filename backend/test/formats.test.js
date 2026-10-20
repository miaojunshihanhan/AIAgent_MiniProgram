'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
const {parseMaterial}=require('../src/parsers')
const {importMaterials,loadIndex,retrieve}=require('../src/knowledge')
const {createServer}=require('../src/server')
// Minimal stored ZIP fixture; deterministic and independent of Office installations.
function zip(entries){
 const local=[],central=[];let offset=0
 for(const [name,text]of Object.entries(entries)){
  const n=Buffer.from(name),b=Buffer.from(text);let crc=0xffffffff
  for(const byte of b){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}crc=(crc^0xffffffff)>>>0
  const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt32LE(crc,14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26)
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42)
  local.push(l,n,b);central.push(c,n);offset+=l.length+n.length+b.length
 }
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16)
 return Buffer.concat([...local,cd,end])
}
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'agent-formats-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const config={materialsRoot:path.join(root,'materials'),dataRoot:path.join(root,'data'),mode:'mock'};await fs.mkdir(config.materialsRoot);return config}
test('PPTX extracts text runs and preserves slide location',async t=>{
 const c=await setup(t),f=path.join(c.materialsRoot,'slides.pptx')
 await fs.writeFile(f,zip({'ppt/slides/slide1.xml':'<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>护理流程</a:t></a:r><a:r><a:t>说明</a:t></a:r></a:p></p:sld>','ppt/slides/slide2.xml':'<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>交接记录</a:t></a:r></a:p></p:sld>'}))
 await importMaterials(c);const index=await loadIndex(c),hit=retrieve(index,'交接')[0]
 assert.equal(hit.chunk.location,'幻灯片 2');assert.equal(hit.chunk.lineStart,2)
 assert.equal(hit.doc.text.split('\n')[hit.chunk.lineStart-1],hit.chunk.text)
 assert.equal(index.documents[0].chunks[0].text,'护理流程说明')
})
test('XLSX reads shared/inline strings and sheet plus row locations',async t=>{
 const c=await setup(t),f=path.join(c.materialsRoot,'sheet.xlsx')
 await fs.writeFile(f,zip({'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="学习计划" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/sharedStrings.xml':'<sst><si><t>项目</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>岗前培训</t></is></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>'}))
 const parsed=await parseMaterial(f,'.xlsx');assert.equal(parsed.sections.length,2);assert.match(parsed.sections[1].location,/学习计划.*2/);assert.match(parsed.sections[1].text,/项目/);assert.match(parsed.sections[1].text,/岗前培训/)
})
test('media without transcript is searchable by name; sidecar edits update version',async t=>{
 const c=await setup(t),f=path.join(c.materialsRoot,'1..mp4');await fs.writeFile(f,'0123456789')
 let report=await importMaterials(c);assert.equal(report.pendingTextCount,0);assert.equal(report.searchableCount,1)
 const named=(await loadIndex(c)).documents[0];assert.equal(named.status,'name_only');assert.match(named.chunks[0].text,/1\.\.mp4/);assert.equal(named.chunks[0].metadataOnly,true)
 await fs.writeFile(f+'.txt','操作演示文字说明')
 report=await importMaterials(c);assert.equal(report.documentCount,1);assert.equal(report.searchableCount,1)
 const before=(await loadIndex(c)).documents[0];assert.match(before.chunks[0].location,/配套说明/)
 await fs.writeFile(f+'.txt','更新后的操作演示');await importMaterials(c)
 assert.notEqual((await loadIndex(c)).documents[0].version,before.version)
 const server=createServer(c);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
 const url='http://127.0.0.1:'+server.address().port+'/documents/'+before.id+'/original'
 const response=await fetch(url,{headers:{Range:'bytes=2-5'}})
 assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'video/mp4');assert.equal(response.headers.get('content-range'),'bytes 2-5/10');assert.equal(await response.text(),'2345')
 assert.equal((await fetch(url,{headers:{Range:'bytes=30-50'}})).status,416)
})

test('greetings bypass retrieval and model invocation',async t=>{
 const c=await setup(t),server=createServer(c,{generateAnswer:async()=>{throw new Error('must not invoke model')}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
 const r=await fetch('http://127.0.0.1:'+server.address().port+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'你好！'})})
 const x=await r.json();assert.equal(r.status,200);assert.equal(x.mode,'local');assert.equal(x.modelInvoked,false);assert.equal(x.citations.length,0)
 const {localReply}=require('../src/router');assert.equal(localReply('你好，请问宝宝打嗝怎么办'),null)
 assert.notEqual(localReply('你好',()=>0).answer,localReply('你好',()=>0.99).answer)
})
test('unchanged imports reuse parsed content and catalog',async t=>{
 const c=await setup(t);await fs.writeFile(path.join(c.materialsRoot,'a.txt'),'索引缓存测试')
 const first=await importMaterials(c),second=await importMaterials(c)
 assert.equal(first.parsedCount,1);assert.equal(second.parsedCount,0);assert.equal(second.reusedCount,1)
 const idx=await loadIndex(c);assert.ok(idx.search.postings['索引']);assert.ok(await fs.stat(path.join(c.dataRoot,'catalog.json')))
})
test('evidence budget and unrelated queries exclude unnecessary model context',()=>{
 const {compactEvidence,retrieve}=require('../src/search')
 const doc={id:'d',version:'v',title:'材料',chunks:[{id:'c',text:'保修期限。'.repeat(1000),lineStart:1,lineEnd:1}]}
 assert.equal(retrieve({documents:[doc]},'今天天气如何').length,0)
 const e=compactEvidence(Array.from({length:8},()=>({doc,chunk:doc.chunks[0]})))
 assert.ok(e.reduce((n,s)=>n+s.quote.length,0)<=1800);assert.ok(e.every(s=>s.quote.length<=650))
})

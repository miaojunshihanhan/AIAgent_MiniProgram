'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const hash = value => createHash('sha256').update(value).digest('hex')
function splitText(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), chunks = []
  let buffer = '', start = 1, end = 1
  const flush = () => {
    if (buffer.trim()) chunks.push({ text: buffer, lineStart: start, lineEnd: end })
    buffer = ''
  }
  lines.forEach((line, i) => {
    for (let offset = 0; offset < Math.max(line.length, 1); offset += 1000) {
      const piece = line.slice(offset, offset + 1000)
      if (buffer && buffer.length + piece.length + 1 > 1000) flush()
      if (!buffer) start = i + 1
      else buffer += '\n'
      buffer += piece; end = i + 1
      if (buffer.length >= 1000) flush()
    }
  })
  flush()
  return chunks
}
async function scan(root, relative = '') {
  const out = []
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || (!relative && entry.name === 'README.md')) continue
    const rel = path.join(relative, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) out.push(...await scan(root, rel))
    else out.push(rel)
  }
  return out.sort()
}
async function importMaterials(config) {
  const {parseMaterial,formats}=require('./parsers')
  const {createReadStream}=require('node:fs')
  await fs.mkdir(config.materialsRoot,{recursive:true})
  await fs.mkdir(path.join(config.dataRoot,'originals'),{recursive:true})
  const previous=await loadIndex(config), byPath=new Map(previous.documents.map(d=>[d.relativePath,d]))
  const documents=[],skipped=[],warnings=[];let reusedCount=0,parsedCount=0
  for(const relative of await scan(config.materialsRoot)) {
    const ext=path.extname(relative).toLowerCase(), filename=path.join(config.materialsRoot,relative)
    if(!formats.has(ext)){skipped.push({file:relative,reason:'暂不支持此格式'});continue}
    // A media sidecar belongs to its media document, not a second independent source.
    if(['.txt','.md'].includes(ext)&&/\.(jpg|jpeg|png|webp|mp4)\.(txt|md)$/i.test(relative)) {
      try{await fs.access(filename.slice(0,-ext.length));continue}catch(_){}
    }
    try {
      const stat=await fs.stat(filename)
      const max=['.txt','.md'].includes(ext)?5*1024*1024:512*1024*1024
      if(stat.size>max)throw new Error('文件超过限制：文本 5MB，Office / 媒体 512MB')
      const digest=createHash('sha256')
      for await(const part of createReadStream(filename))digest.update(part)
      const rawHash=digest.digest('hex')
      let sidecarHash=''
      for(const candidate of [filename+'.txt',filename+'.md']){try{const bytes=await fs.readFile(candidate);sidecarHash=hash(bytes);break}catch(e){if(e.code!=='ENOENT')throw e}}
      const previousDoc=byPath.get(relative.replace(/\\/g,'/'))
      if(previousDoc&&previousDoc.rawHash===rawHash&&previousDoc.sidecarHash===sidecarHash&&previousDoc.parserVersion===3){documents.push(previousDoc);reusedCount++;if(previousDoc.warning)warnings.push({file:relative,reason:previousDoc.warning});continue}
      const parsed=await parseMaterial(filename,ext);parsedCount++
      if(['.txt','.md'].includes(ext)&&!parsed.sections.some(section=>section.text.trim()))throw new Error('空文件')
      const chunks=[]; let text='',lineOffset=0
      for(const section of parsed.sections){
        if(!section.text.trim())continue
        const normalized=section.text.replace(/\r\n?/g,'\n')
        chunks.push(...splitText(normalized).map(c=>({...c,lineStart:c.lineStart+lineOffset,lineEnd:c.lineEnd+lineOffset,location:section.location||'',pageNumber:section.pageNumber||null})))
        text+=(text?'\n':'')+normalized
        lineOffset=text.split('\n').length
      }
      // Sidecar edits also invalidate citations; keep raw bytes intact in snapshot.
      const version=parsed.sidecar?hash(rawHash+'\n'+text):rawHash
      const id=hash(relative.replace(/\\/g,'/')).slice(0,24),original=id+'-'+version+ext
      const destination=path.join(config.dataRoot,'originals',original)
      try{await fs.access(destination)}catch(_){await fs.copyFile(filename,destination)}
      const status=chunks.length?'ready':'needs_text'
      const warning=parsed.warning||(!chunks.length?'未提取到正文，可能只有图片或扫描内容，需 OCR 或转为可读文本':'')
      if(warning)warnings.push({file:relative,reason:warning})
      documents.push({id,version,title:path.basename(relative),relativePath:relative.replace(/\\/g,'/'),format:ext.slice(1),size:stat.size,original,text,
        rawHash,sidecarHash,parserVersion:3,pages:parsed.pages||[],kind:parsed.kind,status,warning,sidecar:parsed.sidecar||'',chunks:chunks.map((chunk,index)=>({...chunk,id:id+'-'+version.slice(0,12)+'-'+index}))})
    }catch(error){skipped.push({file:relative,reason:error.message})}
  }
  const index={schemaVersion:3,importedAt:new Date().toISOString(),documents}
  index.search=require('./search').buildSearch(documents)
  await fs.writeFile(path.join(config.dataRoot,'catalog.json'),JSON.stringify(documents.map(d=>({id:d.id,title:d.title,version:d.version,status:d.status,pages:(d.pages||[]).map(p=>({number:p.number,heading:p.text.split('\n')[0]||'',chunkIds:d.chunks.filter(c=>c.pageNumber===p.number).map(c=>c.id)}))})),null,2),'utf8')
  const target=path.join(config.dataRoot,'knowledge.json'),temp=target+'.tmp'
  await fs.writeFile(temp,JSON.stringify(index),'utf8');await fs.rename(temp,target)
  const report={reusedCount,parsedCount,documentCount:documents.length,searchableCount:documents.filter(d=>d.chunks.length).length,pendingTextCount:documents.filter(d=>!d.chunks.length).length,
    chunkCount:documents.reduce((n,d)=>n+d.chunks.length,0),skipped,warnings}
  await fs.writeFile(path.join(config.dataRoot,'import-report.json'),JSON.stringify(report,null,2),'utf8')
  return report
}
async function loadIndex(config) {
  try { return JSON.parse(await fs.readFile(path.join(config.dataRoot, 'knowledge.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return { documents: [], importedAt: null }; throw error }
}
const {retrieve}=require('./search')
module.exports = { splitText, importMaterials, loadIndex, retrieve }

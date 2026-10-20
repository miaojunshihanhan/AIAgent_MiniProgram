'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const yauzl = require('yauzl')
const { XMLParser } = require('fast-xml-parser')
const WordExtractor = require('word-extractor')
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, trimValues: false })
const list = value => value == null ? [] : Array.isArray(value) ? value : [value]
function plain(node) {
  if (node == null) return ''
  if (typeof node !== 'object') return String(node)
  if (Array.isArray(node)) return node.map(plain).join('')
  if (node.t != null) return plain(node.t)
  return Object.entries(node).filter(([key]) => !key.startsWith('@_')).map(([, value]) => plain(value)).join('')
}
function values(node, key) {
  if (!node || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([k, value]) => k === key ? list(value) : Array.isArray(value) ? value.flatMap(v => values(v, key)) : values(value, key))
}
// Read only selected XML entries, never embedded pictures/video. Enforce decompression limits.
function readOffice(filename) {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, {lazyEntries:true}, (error, zip) => {
      if (error) return reject(error)
      const entries = new Map(); let total = 0
      const stop = error => {zip.close();reject(error)}
      zip.on('error', stop)
      zip.on('entry', entry => {
        const name = entry.fileName
        const wanted = /^(ppt\/slides\/slide\d+\.xml|word\/document\.xml|xl\/sharedStrings\.xml|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/sheet\d+\.xml)$/.test(name)
        if (!wanted) return zip.readEntry()
        if (entry.uncompressedSize > 32*1024*1024 || (total += entry.uncompressedSize) > 64*1024*1024) return stop(new Error('文档文本 XML 过大，请拆分材料'))
        zip.openReadStream(entry, (error, stream) => {
          if (error) return stop(error)
          const parts=[]; let received=0
          stream.on('data', part => {received+=part.length; if(received>32*1024*1024) stream.destroy(new Error('解压文本过大')); else parts.push(part)})
          stream.on('error', stop)
          stream.on('end', () => {try {entries.set(name,xml.parse(Buffer.concat(parts).toString('utf8')));zip.readEntry()} catch(e){stop(e)}})
        })
      })
      zip.on('end', () => resolve(entries));zip.readEntry()
    })
  })
}
const imageFormats = new Set(['.jpg','.jpeg','.png','.webp'])
const videoFormats = new Set(['.mp4'])
const formats = new Set(['.txt','.md','.doc','.docx','.pptx','.xlsx',...imageFormats,...videoFormats])
async function parseMaterial(filename, ext) {
  if (ext === '.txt' || ext === '.md') return {kind:'text',sections:[{location:'',text:new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(filename))}]}
  if (imageFormats.has(ext) || videoFormats.has(ext)) {
    let text='', sidecar=''
    for (const candidate of [filename+'.txt',filename+'.md']) {
      try {if((await fs.stat(candidate)).size>5*1024*1024)throw new Error('配套文本超过 5MB');text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(candidate));sidecar=path.basename(candidate);break}
      catch(error){if(error.code!=='ENOENT')throw error}
    }
    return {kind:imageFormats.has(ext)?'image':'video', status:text.trim()?'ready':'name_only', sidecar,
      sections:text.trim()?[{location:'配套说明 / 转写文本（非自动识别）',text}]:[{location:'文件名称（未识别媒体内容）',text:'文件名：'+path.basename(filename)+'\n仅依据名称匹配，尚未识别图片画面或视频内容。',metadataOnly:true}],
      warning:text.trim()?'媒体检索依据为配套文本，未自动识别画面或音频':'可按名称匹配并展示原文件；尚未识别画面、音频或视频内容'}
  }
  if (ext === '.doc') {
    const doc=await new WordExtractor().extract(filename)
    return {kind:'document',sections:[{location:'Word 正文',text:doc.getBody()}]}
  }
  const entries=await readOffice(filename)
  if(ext==='.pptx') {
    const slides=[...entries].filter(([name])=>name.startsWith('ppt/slides/')).sort((a,b)=>Number(a[0].match(/slide(\d+)/)[1])-Number(b[0].match(/slide(\d+)/)[1]))
    return {kind:'document',pages:slides.map(([name,body])=>({number:Number(name.match(/slide([0-9]+)/)[1]),text:values(body,'p').map(p=>values(p,'t').map(plain).join('')).filter(t=>t.trim()).join('\n')})),sections:slides.map(([name,body])=>({pageNumber:Number(name.match(/slide([0-9]+)/)[1]),location:'幻灯片 '+name.match(/slide(\d+)/)[1],text:values(body,'p').map(p=>values(p,'t').map(plain).join('')).filter(t=>t.trim()).join('\n')})),warning:'仅提取幻灯片文字；图片和嵌入媒体未自动识别'}
  }
  if(ext==='.docx') return {kind:'document',sections:[{location:'Word 正文',text:values(entries.get('word/document.xml'),'p').map(p=>values(p,'t').map(plain).join('')).join('\n')}]}
  const strings=list(entries.get('xl/sharedStrings.xml')?.sst?.si).map(plain)
  const relationships=list(entries.get('xl/_rels/workbook.xml.rels')?.Relationships?.Relationship)
  const sheets=list(entries.get('xl/workbook.xml')?.workbook?.sheets?.sheet)
  const sections=[]
  for(const sheet of sheets){
    const rel=relationships.find(r=>r['@_Id']===sheet['@_id'])
    if(!rel)continue
    const target=rel['@_Target'].startsWith('/')?rel['@_Target'].slice(1):path.posix.normalize('xl/'+rel['@_Target'])
    const rows=list(entries.get(target)?.worksheet?.sheetData?.row)
    const header=rows[0]?list(rows[0].c).map(cellText).join(' | '):''
    for(const row of rows){
      const text=list(row.c).map(c=>(c['@_r']||'')+'='+cellText(c)).join(' | ')
      sections.push({location:'工作表「'+sheet['@_name']+'」第 '+row['@_r']+' 行',text:(row===rows[0]?'':'首行上下文：'+header+'\n')+text})
    }
  }
  function cellText(c){if(c['@_t']==='s')return strings[Number(c.v)]||'';if(c['@_t']==='inlineStr')return plain(c.is);return plain(c.v)}
  return {kind:'document',sections,warning:'Excel 读取已保存的单元格值，不重新计算公式'}
}
module.exports={parseMaterial,formats,readOffice}

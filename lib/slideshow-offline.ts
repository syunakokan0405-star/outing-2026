export type OfflineSlide = {
  id: string
  participant: string
  mission: string
  createdAt: string
  hearts: number
  rotation: number
  blob: Blob
}

// ZIP "store" format: WebP is already compressed, so avoid lossy re-encoding
// or an extra compression dependency. All files live beside index.html.
export async function makeSlideshowZip(items: OfflineSlide[], seconds: number): Promise<Blob> {
  const files: { name: string; blob: Blob }[] = items.map(item => ({
    name: 'images/' + item.id + '.webp',
    blob: item.blob,
  }))
  const slides = items.map(({ blob: _blob, ...post }) => ({
    ...post,
    src: 'images/' + post.id + '.webp',
  }))
  const json = JSON.stringify(slides).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')
  const css = 'html,body{margin:0;background:#050608;color:white;font-family:Arial,sans-serif;height:100%;overflow:hidden}' +
    '#stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
    '#photo{display:block;width:100%;height:100%;max-width:none;max-height:none;flex:0 0 auto;object-fit:contain;animation:fade .6s ease}' +
    '#backdrop{position:absolute;inset:-12%;width:124%;height:124%;object-fit:cover;filter:blur(54px) brightness(.24);transform:scale(1.08)}' +
    '#caption{position:absolute;bottom:0;left:0;right:0;padding:70px 4vw 32px;background:linear-gradient(transparent,rgba(0,0,0,.82))}' +
    '#who{font-size:clamp(22px,3vw,46px);font-weight:300}#mission{color:#ccc;margin-top:8px;font-size:clamp(13px,1.6vw,24px)}' +
    '#logo{position:absolute;top:26px;left:4vw;letter-spacing:.28em;font-size:12px;color:#eee}' +
    '#hint{position:absolute;top:24px;right:4vw;font-size:12px;color:#aaa}' +
    '@keyframes fade{from{opacity:0}to{opacity:1}}'
  const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Outing 2026 Offline Slideshow</title><style>' + css + '</style></head><body>' +
    '<div id="stage"><img id="backdrop" alt="" aria-hidden="true"><img id="photo" alt="Outing photo"></div><div id="logo">OUTING 2026</div><div id="hint">Space: Pause / ← →: Move / R: Rotate / F11: Fullscreen</div>' +
    '<div id="caption"><div id="who"></div><div id="mission"></div></div>' +
    '<script>const slides=' + json + ';let index=0;let playing=true;const photo=document.getElementById("photo"),backdrop=document.getElementById("backdrop"),who=document.getElementById("who"),mission=document.getElementById("mission");' +
    'function show(){if(!slides.length){who.textContent="No photos";return;}const p=slides[index];const rot=p.rotation||0;photo.src=p.src;backdrop.src=p.src;photo.style.width=rot%180===0?"100%":"100vh";photo.style.height=rot%180===0?"100%":"100vw";photo.style.transform="rotate("+rot+"deg)";photo.style.animation="none";void photo.offsetWidth;photo.style.animation="fade .6s ease";who.textContent=p.participant;mission.textContent=p.mission;}' +
    'function move(d){index=(index+d+slides.length)%slides.length;show();}document.addEventListener("keydown",e=>{if(e.key===" "){e.preventDefault();playing=!playing;}else if(e.key==="ArrowRight"){move(1);}else if(e.key==="ArrowLeft"){move(-1);}else if(e.key.toLowerCase()==="r"&&slides.length){slides[index].rotation=((slides[index].rotation||0)+(e.shiftKey?-90:90)+360)%360;show();}});' +
    'setInterval(()=>{if(playing&&slides.length>1)move(1)},' + (Math.max(3, Math.min(20, seconds)) * 1000) + ');show();</script></body></html>'
  files.unshift({ name: 'index.html', blob: new Blob([html], { type: 'text/html;charset=utf-8' }) })
  const manifest = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), slides }, null, 2)
  files.push({ name: 'manifest.json', blob: new Blob([manifest], { type: 'application/json' }) })

  const parts: BlobPart[] = []
  const central: ArrayBuffer[] = []
  const encoder = new TextEncoder()
  let offset = 0
  let centralSize = 0
  for (const file of files) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer())
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(bytes)
    const header = new ArrayBuffer(30 + nameBytes.length)
    const head = new DataView(header)
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, bytes.length, true)
    head.setUint32(22, bytes.length, true)
    head.setUint16(26, nameBytes.length, true)
    new Uint8Array(header, 30).set(nameBytes)
    parts.push(header, file.blob)

    const entry = new ArrayBuffer(46 + nameBytes.length)
    const view = new DataView(entry)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0x0800, true)
    view.setUint32(16, crc, true)
    view.setUint32(20, bytes.length, true)
    view.setUint32(24, bytes.length, true)
    view.setUint16(28, nameBytes.length, true)
    view.setUint32(42, offset, true)
    new Uint8Array(entry, 46).set(nameBytes)
    central.push(entry)
    centralSize += entry.byteLength
    offset += header.byteLength + file.blob.size
  }
  parts.push(...central)
  const end = new ArrayBuffer(22)
  const footer = new DataView(end)
  footer.setUint32(0, 0x06054b50, true)
  footer.setUint16(8, files.length, true)
  footer.setUint16(10, files.length, true)
  footer.setUint32(12, centralSize, true)
  footer.setUint32(16, offset, true)
  parts.push(end)
  return new Blob(parts, { type: 'application/zip' })
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const value of bytes) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

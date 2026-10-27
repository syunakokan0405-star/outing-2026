import { makeZip } from './zip'
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
  // Keep the same fit-to-stage algorithm in the offline player. Both live and
  // offline presentations reserve header/footer space instead of masking photos.
  const css = 'html,body{margin:0;background:#020304;color:white;font-family:Arial,sans-serif;height:100%;overflow:hidden}' +
    '#stage{position:absolute;top:66px;bottom:108px;left:0;right:0;background:#020304;overflow:hidden}' +
    '#photo{position:absolute;top:50%;left:50%;display:block;max-width:none;max-height:none;transform-origin:center;visibility:hidden;animation:fade .6s ease}' +
    '#caption{position:absolute;bottom:0;left:0;right:0;height:108px;box-sizing:border-box;padding:16px 4vw 30px;background:#020304;overflow:hidden}' +
    '#who{font-size:clamp(22px,3vw,46px);font-weight:300}#mission{color:#ccc;margin-top:8px;font-size:clamp(13px,1.6vw,24px)}' +
    '#logo{position:absolute;top:26px;left:4vw;letter-spacing:.28em;font-size:12px;color:#eee}' +
    '#hint{position:absolute;top:24px;right:4vw;font-size:12px;color:#aaa}' +
    '@keyframes fade{from{opacity:0}to{opacity:1}}'
  const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Outing 2026 Offline Slideshow</title><style>' + css + '</style></head><body>' +
    '<div id="stage"><img id="photo" alt="Outing photo"></div><div id="logo">OUTING 2026</div><div id="hint">Space: Pause / ← →: Move / R: Rotate / F11: Fullscreen</div>' +
    '<div id="caption"><div id="who"></div><div id="mission"></div></div>' +
    '<script>const slides=' + json + ';let index=0;let playing=true;const photo=document.getElementById("photo"),stage=document.getElementById("stage"),who=document.getElementById("who"),mission=document.getElementById("mission");' +
    'function fit(){if(!slides.length||!photo.naturalWidth||!photo.naturalHeight)return;const rot=slides[index].rotation||0;const quarter=rot%180!==0;const rw=quarter?photo.naturalHeight:photo.naturalWidth;const rh=quarter?photo.naturalWidth:photo.naturalHeight;const scale=Math.min(Math.max(1,stage.clientWidth-24)/rw,Math.max(1,stage.clientHeight-24)/rh);photo.style.width=(photo.naturalWidth*scale)+"px";photo.style.height=(photo.naturalHeight*scale)+"px";photo.style.transform="translate(-50%,-50%) rotate("+rot+"deg)";photo.style.visibility="visible";}' +
    'photo.onload=fit;window.addEventListener("resize",fit);function show(){if(!slides.length){who.textContent="No photos";return;}const p=slides[index];photo.style.visibility="hidden";photo.src=p.src;if(photo.complete&&photo.naturalWidth)fit();photo.style.animation="none";void photo.offsetWidth;photo.style.animation="fade .6s ease";who.textContent=p.participant;mission.textContent=p.mission;}' +
    'function move(d){index=(index+d+slides.length)%slides.length;show();}document.addEventListener("keydown",e=>{if(e.key===" "){e.preventDefault();playing=!playing;}else if(e.key==="ArrowRight"){move(1);}else if(e.key==="ArrowLeft"){move(-1);}else if(e.key.toLowerCase()==="r"&&slides.length){slides[index].rotation=((slides[index].rotation||0)+(e.shiftKey?-90:90)+360)%360;fit();}});' +
    'setInterval(()=>{if(playing&&slides.length>1)move(1)},' + (Math.max(3, Math.min(20, seconds)) * 1000) + ');show();</script></body></html>'

  files.unshift({ name: 'index.html', blob: new Blob([html], { type: 'text/html;charset=utf-8' }) })
  const manifest = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), slides }, null, 2)
  files.push({ name: 'manifest.json', blob: new Blob([manifest], { type: 'application/json' }) })

  return makeZip(files)
}

// PaiMini 老板全部流水图片导出修复。
// 只接管“导出老板全部流水 PNG”按钮，不修改普通小票导出与核心保存逻辑。

let started=false;
const $=id=>document.getElementById(id);

function toast(message){window.paiMiniOrderBridge?.toast?.(message)}
function safeName(v){return String(v||'老板').trim().replace(/[\\/:*?"<>|]/g,'-')||'老板'}

async function ensureHtml2Canvas(){
  if(window.html2canvas)return window.html2canvas;
  const existing=document.querySelector('script[data-pa-mini-html2canvas]');
  if(existing){
    await new Promise((resolve,reject)=>{existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true})});
    return window.html2canvas;
  }
  await new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    s.dataset.paMiniHtml2canvas='1';
    s.onload=resolve;s.onerror=reject;document.head.appendChild(s);
  });
  return window.html2canvas;
}

async function waitImages(root){
  const images=[...root.querySelectorAll('img')];
  await Promise.all(images.map(img=>{
    if(img.complete)return Promise.resolve();
    return new Promise(resolve=>{const done=()=>resolve();img.addEventListener('load',done,{once:true});img.addEventListener('error',done,{once:true});setTimeout(done,2500)});
  }));
}

function downloadCanvas(canvas,filename){
  return new Promise((resolve,reject)=>{
    if(canvas.toBlob){
      canvas.toBlob(blob=>{
        if(!blob){reject(new Error('png_blob_failed'));return}
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url;a.download=filename;a.rel='noopener';
        document.body.appendChild(a);a.click();a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1500);
        resolve();
      },'image/png');
      return;
    }
    try{
      const a=document.createElement('a');a.download=filename;a.href=canvas.toDataURL('image/png');document.body.appendChild(a);a.click();a.remove();resolve();
    }catch(e){reject(e)}
  });
}

function normalizeExportClone(node){
  // html2canvas 1.4.x can choke on modern CSS functions such as color-mix().
  // Freeze the export copy to plain colors so rendering is deterministic.
  node.style.setProperty('--bg','#fff8f5');
  node.style.setProperty('--paper','#fffdfa');
  node.style.setProperty('--ink','#4d413d');
  node.style.setProperty('--muted','#917f84');
  node.style.setProperty('--pink','#e58aa7');
  node.style.setProperty('--pink-deep','#d66f93');
  node.style.setProperty('--pink-soft','#fff0f5');
  node.style.setProperty('--line','#f0d7df');
  node.style.background='#fffdfa';
  return node;
}

async function imageToDataUrl(url){
  const r=await fetch(url,{mode:'cors',cache:'force-cache'});
  if(!r.ok)throw new Error('image_http_'+r.status);
  const blob=await r.blob();
  return await new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>resolve(fr.result);
    fr.onerror=reject;
    fr.readAsDataURL(blob);
  });
}

async function prepareImages(root){
  const restores=[];
  for(const img of [...root.querySelectorAll('img')]){
    const src=img.getAttribute('src')||'';
    if(!src || src.startsWith('data:') || src.startsWith('blob:'))continue;
    try{
      const absolute=new URL(src,location.href);
      if(absolute.origin===location.origin)continue;
      const old=src;
      img.setAttribute('src',await imageToDataUrl(absolute.href));
      restores.push(()=>img.setAttribute('src',old));
    }catch(_){
      const old=img.style.display;
      img.style.display='none';
      restores.push(()=>{img.style.display=old});
    }
  }
  return ()=>restores.forEach(fn=>fn());
}

function cloneForExport(source){
  const clone=source.cloneNode(true);
  clone.removeAttribute('id');
  clone.style.width=Math.max(560,Math.round(source.getBoundingClientRect().width||620))+'px';
  clone.style.maxWidth='none';
  clone.style.height='auto';
  clone.style.maxHeight='none';
  clone.style.overflow='visible';
  normalizeExportClone(clone);
  const host=document.createElement('div');
  host.style.position='fixed';host.style.left='-10000px';host.style.top='0';host.style.zIndex='-1';host.style.background='transparent';host.style.pointerEvents='none';
  host.appendChild(clone);document.body.appendChild(host);
  return {host,clone};
}

function bossNameFromCapture(capture){
  const meta=[...capture.querySelectorAll('.statement-meta div')].find(x=>String(x.textContent||'').includes('老板'));
  const b=meta?.querySelector('b')?.textContent;
  return safeName(b||'老板');
}

async function renderOne(html2canvas,node){
  await waitImages(node);
  if(document.fonts?.ready)await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,1200))]);
  const w=Math.max(1,node.scrollWidth||node.getBoundingClientRect().width||620);
  const h=Math.max(1,node.scrollHeight||node.getBoundingClientRect().height||800);
  // iOS / 手机浏览器对超大 canvas 很敏感。动态控制像素面积，避免“点了没反应”。
  const maxArea=8_000_000;
  const maxSide=8000;
  const byArea=Math.sqrt(maxArea/(w*h));
  const bySide=Math.min(maxSide/w,maxSide/h);
  const scale=Math.max(0.55,Math.min(1.6,byArea,bySide));
  return html2canvas(node,{scale,useCORS:true,allowTaint:false,backgroundColor:'#fffdfa',logging:false,scrollX:0,scrollY:0,windowWidth:Math.ceil(w),windowHeight:Math.ceil(h)});
}

async function exportBossStatement(){
  const capture=$('bossStatementCapture');
  const btn=$('exportBossStatementBtn');
  if(!capture||!capture.children.length){toast('先打开一个老板的全部流水');return}
  const old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='正在生成图片…'}
  let host=null;
  try{
    const html2canvas=await ensureHtml2Canvas();
    if(!html2canvas)throw new Error('html2canvas_not_ready');
    const name=bossNameFromCapture(capture);
    const stamp=new Date().toISOString().slice(0,10);
    const cloned=cloneForExport(capture);host=cloned.host;
    const node=cloned.clone;

    // 超长流水拆页导出，避免手机端 canvas 超限。正常长度仍然只导出一张。
    const rows=[...node.querySelectorAll('.statement-list .statement-row')];
    const totalHeight=node.scrollHeight||0;
    if(totalHeight<=5200 && rows.length<=18){
      const restoreImages=await prepareImages(node);
      try{
        const canvas=await renderOne(html2canvas,node);
        await downloadCanvas(canvas,`${name}-全部流水-${stamp}.png`);
      }finally{
        restoreImages();
      }
      toast('老板全部流水已导出 ♡');
      return;
    }

    const perPage=8;
    const pages=Math.ceil(rows.length/perPage);
    const sourceRows=[...capture.querySelectorAll('.statement-list .statement-row')];
    for(let page=0;page<pages;page++){
      const pageClone=capture.cloneNode(true);pageClone.removeAttribute('id');normalizeExportClone(pageClone);
      pageClone.style.width=Math.max(560,Math.round(capture.getBoundingClientRect().width||620))+'px';pageClone.style.maxWidth='none';pageClone.style.height='auto';pageClone.style.maxHeight='none';pageClone.style.overflow='visible';
      const list=pageClone.querySelector('.statement-list');if(list)list.innerHTML='';
      sourceRows.slice(page*perPage,(page+1)*perPage).forEach(r=>list?.appendChild(r.cloneNode(true)));
      if(page<pages-1)pageClone.querySelector('.receipt-total')?.remove();
      const marker=document.createElement('p');marker.style.textAlign='center';marker.style.fontSize='11px';marker.style.opacity='.65';marker.textContent=`第 ${page+1} / ${pages} 页`;
      pageClone.appendChild(marker);
      host.appendChild(pageClone);
      const restoreImages=await prepareImages(pageClone);
      try{
        const canvas=await renderOne(html2canvas,pageClone);
        await downloadCanvas(canvas,`${name}-全部流水-${stamp}-${page+1}of${pages}.png`);
      }catch(error){
        throw new Error(`第 ${page+1}/${pages} 页：${String(error?.message||error)}`);
      }finally{
        restoreImages();
        pageClone.remove();
      }
      await new Promise(r=>setTimeout(r,320));
    }
    toast(`流水较长，已分 ${pages} 张导出 ♡`);
  }catch(error){
    console.warn('boss statement safe export failed',error);
    const detail=String(error?.message||error||'未知错误').slice(0,120);
    toast('老板流水导出失败：'+detail);
  }finally{
    host?.remove();if(btn){btn.disabled=false;btn.textContent=old||'导出老板全部流水 PNG'}
  }
}

export function initBossStatementExportSafe(){
  if(started)return;started=true;
  const btn=$('exportBossStatementBtn');
  if(!btn){started=false;throw new Error('boss statement export button not ready')}
  btn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();void exportBossStatement()},{capture:true});
}

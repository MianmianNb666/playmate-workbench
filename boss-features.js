import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const $=(id)=>document.getElementById(id);

const localState={
  session:null,
  shops:[],
  records:[],
  groups:[],
  previewMode:"current",
  activeGroup:null,
  prepaid:[],
  benefits:[],
  benefitLedger:[],
  customers:[]
};

function safe(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function money(value,shop){
  return (shop?.currency_symbol||"¥")+Number(value||0).toFixed(2);
}

function dateParts(value){
  const d=new Date(value);
  return {
    date:d.toLocaleDateString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit"}),
    time:d.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})
  };
}

function currentReceiptControls(){
  return {
    show_customer:$("showCustomer")?.checked??true,
    show_companion:$("showCompanion")?.checked??true,
    show_unit_price:$("showUnitPrice")?.checked??true,
    show_quantity:$("showQuantity")?.checked??true,
    show_total_spent:$("showTotalSpent")?.checked??true,
    show_note:$("showNote")?.checked??true,
    show_time:$("showTime")?.checked??true,
    show_logo:$("showLogo")?.checked??true,
    show_footer:$("showFooter")?.checked??true,
    boss_message:$("bossMessage")?.value.trim()||""
  };
}

async function fetchReceiptSettings(shopId){
  if(!shopId) return currentReceiptControls();
  const {data}=await supabase.from("receipt_settings")
    .select("*")
    .eq("shop_id",shopId)
    .maybeSingle();
  return {
    ...currentReceiptControls(),
    ...(data||{})
  };
}

function groupRecords(){
  const map=new Map();
  localState.records.forEach(r=>{
    const key=r.customer_id
      ? r.shop_id+"::"+r.customer_id
      : r.shop_id+"::name::"+String(r.customer_name_snapshot||"");
    if(!map.has(key)){
      map.set(key,{
        key,
        shop_id:r.shop_id,
        customer:r.customer_name_snapshot||"未命名老板",
        records:[]
      });
    }
    map.get(key).records.push(r);
  });

  localState.groups=[...map.values()].map(group=>{
    group.records.sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
    group.total=group.records.reduce((sum,r)=>sum+Number(r.amount||0),0);
    return group;
  }).sort((a,b)=>b.total-a.total);
}

function renderBossSummary(){
  const list=$("bossSummaryList");
  const empty=$("emptyBossSummary");
  if(!list||!empty) return;

  groupRecords();
  empty.classList.toggle("hidden",localState.groups.length>0);

  list.innerHTML=localState.groups.map((group,index)=>{
    const shop=localState.shops.find(s=>s.id===group.shop_id);
    return `
      <div class="boss-summary-item">
        <b>${safe(group.customer)}</b>
        <p>${safe(shop?.name||"已删除店铺")} · ${group.records.length} 笔流水</p>
        <strong>${money(group.total,shop)}</strong>
        <div class="row-actions">
          <button class="tiny-btn" data-boss-index="${index}" type="button">查看全部流水</button>
        </div>
      </div>
    `;
  }).join("");
}

function statementEntries(group){
  const customerId=group.records?.find(r=>r.customer_id)?.customer_id
    || localState.customers.find(c=>c.shop_id===group.shop_id&&String(c.name||"").trim()===String(group.customer||"").trim())?.id
    || null;
  const consumption=(group.records||[]).map(r=>({type:"consume",at:r.occurred_at,amount:Number(r.amount||0),record:r}));
  if(!customerId)return consumption.sort((a,b)=>new Date(b.at)-new Date(a.at));
  const prepaid=localState.prepaid.filter(x=>x.customer_id===customerId).map(x=>({type:"prepaid",at:x.created_at,amount:Number(x.delta||0),record:x}));
  const benefits=localState.benefitLedger.filter(x=>x.customer_id===customerId&&Number(x.delta||0)!==0).map(x=>({type:"benefit",at:x.created_at,amount:Number(x.delta||0),record:x}));
  return [...consumption,...prepaid,...benefits].sort((a,b)=>new Date(b.at)-new Date(a.at));
}

function statementHtml(group,settings){
  const shop=localState.shops.find(s=>s.id===group.shop_id)||{};
  const records=group.records||[];
  const total=records.reduce((sum,r)=>sum+Number(r.amount||0),0);
  const entries=statementEntries(group);
  const newest=entries[0]?.at||records[0]?.occurred_at;
  const oldest=entries[entries.length-1]?.at||records[records.length-1]?.occurred_at;
  const newestDate=newest?dateParts(newest).date:"-";
  const oldestDate=oldest?dateParts(oldest).date:"-";

  const logo=settings.show_logo && shop.logo_url
    ? `<img class="receipt-logo" src="${safe(shop.logo_url)}" alt="">`
    : "";

  return `
    <div class="receipt-head">
      ${logo}
      <h3>${safe(shop.name||"店铺")}</h3>
      <p>老板流水 · STATEMENT ♡</p>
    </div>

    <div class="statement-meta">
      <div>老板<b>${safe(group.customer)}</b></div>
      <div>流水笔数<b>${entries.length} 笔</b></div>
      <div>时间范围<b>${safe(oldestDate)} - ${safe(newestDate)}</b></div>
      <div>全部累计<b>${money(total,shop)}</b></div>
    </div>

    <div class="statement-list">
      ${entries.map(entry=>{
        const d=dateParts(entry.at),r=entry.record;
        if(entry.type==="prepaid"){
          const gift=r.balance_type==="gift";
          const title=entry.amount>=0?(gift?"赠送余额":"增加预存"):(r.kind==="refund"?"撤回 / 退款":(gift?"扣除赠送余额":"扣除预存"));
          return `<div class="statement-row"><time>${safe(d.date)}<br>${safe(d.time)}</time><div><b>${safe(title)}</b><span>${safe(r.note||"")}${r.balance_after!=null?" · 该类余额 "+money(r.balance_after,shop):""}</span></div><strong>${entry.amount>=0?"+":""}${money(entry.amount,shop)}</strong></div>`;
        }
        if(entry.type==="benefit"){
          const unit=r.unit_label||"";const title=entry.amount>=0?"赠送权益":"使用 / 回收权益";
          return `<div class="statement-row"><time>${safe(d.date)}<br>${safe(d.time)}</time><div><b>${safe(title)} · ${safe(r.benefit_name||"权益")}</b><span>${safe(r.note||"")}</span></div><strong>${entry.amount>=0?"+":""}${safe(entry.amount)}${safe(unit)}</strong></div>`;
        }
        return `<div class="statement-row"><time>${safe(d.date)}<br>${safe(d.time)}</time><div><b>${safe(r.item_name_snapshot||"消费")}</b><span>${settings.show_companion?"陪陪 "+safe(r.companion_name||"-")+" · ":""}${settings.show_quantity?safe(r.duration_input||r.quantity||""):""}${r.prepaid_used?" · 预存扣除 "+money(r.prepaid_used,shop):""}</span></div><strong>-${money(r.amount,shop)}</strong></div>`;
      }).join("")}
    </div>

    <div class="receipt-total">
      <span>全部流水合计</span>
      <strong>${money(total,shop)}</strong>
    </div>

    ${settings.boss_message?`<div class="receipt-message">${safe(settings.boss_message)}</div>`:""}
    ${settings.show_footer?`<div class="receipt-footer">${safe(shop.footer_text||"谢谢喜欢，祝你今天也开心 ♡")}</div>`:""}
  `;
}

function sampleStatementGroup(){
  const shopId=$("receiptShop")?.value||localState.shops[0]?.id;
  const real=localState.groups.find(g=>g.shop_id===shopId);
  if(real) return real;

  const now=Date.now();
  return {
    shop_id:shopId,
    customer:"老板昵称",
    records:[
      {occurred_at:new Date(now-2*86400000).toISOString(),item_name_snapshot:"语聊",companion_name:"A",duration_input:"2H",amount:100},
      {occurred_at:new Date(now-86400000).toISOString(),item_name_snapshot:"王者陪玩",companion_name:"B",duration_input:"1H",amount:50},
      {occurred_at:new Date(now).toISOString(),item_name_snapshot:"唱歌",companion_name:"C",duration_input:"2首",amount:30}
    ]
  };
}

async function renderReceiptPreviewMode(){
  const inline=$("receiptPreviewInline");
  if(!inline) return;

  const currentBtn=$("previewCurrentReceiptTab");
  const statementBtn=$("previewBossStatementTab");
  const title=$("receiptPreviewTitle");

  currentBtn?.classList.toggle("active",localState.previewMode==="current");
  statementBtn?.classList.toggle("active",localState.previewMode==="statement");

  if(localState.previewMode==="current"){
    if(title) title.textContent="本次小票预览";
    const checkbox=$("showCustomer");
    checkbox?.dispatchEvent(new Event("change"));
    return;
  }

  if(title) title.textContent="老板流水预览";
  const group=sampleStatementGroup();
  const settings=currentReceiptControls();
  inline.innerHTML=statementHtml(group,settings);
}

async function openBossStatement(index){
  const group=localState.groups[Number(index)];
  if(!group) return;
  localState.activeGroup=group;
  const settings=await fetchReceiptSettings(group.shop_id);
  $("bossStatementCapture").innerHTML=statementHtml(group,settings);
  $("bossStatementDialog").showModal();
}

async function imageUrlToDataUrl(url){
  const response=await fetch(url,{mode:"cors",cache:"no-store"});
  if(!response.ok) throw new Error("image fetch failed");
  const blob=await response.blob();
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(blob);
  });
}

async function canvasToBlob(canvas){
  if(typeof canvas?.toBlob!=="function") throw new Error("PNG转换：浏览器不支持 canvas.toBlob");
  return await new Promise((resolve,reject)=>{
    try{
      canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("PNG转换：toBlob 返回空文件")),"image/png");
    }catch(error){
      reject(new Error("PNG转换："+(error?.message||String(error))));
    }
  });
}

async function downloadCanvas(canvas,filename){
  const blob=await canvasToBlob(canvas);
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.download=filename;
  link.href=url;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function exportPageName(filename,page,total){
  if(total<=1) return filename;
  const dot=filename.toLowerCase().lastIndexOf(".png");
  const base=dot>=0?filename.slice(0,dot):filename;
  return `${base}-第${page}页-共${total}页.png`;
}

async function prepareExportImages(el){
  const restorers=[];
  const images=[...el.querySelectorAll("img")];
  for(const img of images){
    const src=img.getAttribute("src")||"";
    if(!src || src.startsWith("data:") || src.startsWith("blob:")) continue;
    try{
      const absolute=new URL(src,location.href);
      if(absolute.origin===location.origin) continue;
      const dataUrl=await imageUrlToDataUrl(absolute.href);
      const oldSrc=img.getAttribute("src");
      img.setAttribute("src",dataUrl);
      restorers.push(()=>img.setAttribute("src",oldSrc));
    }catch{
      const oldDisplay=img.style.display;
      img.style.display="none";
      restorers.push(()=>{img.style.display=oldDisplay});
    }
  }
  return ()=>restorers.forEach(fn=>fn());
}

async function captureExportPage(el,filename,pageLabel=""){
  let canvas;
  try{
    canvas=await window.html2canvas(el,{
    scale:2,
    useCORS:true,
    allowTaint:false,
    backgroundColor:null,
    logging:false,
    width:Math.ceil(el.scrollWidth),
    height:Math.ceil(Math.max(el.scrollHeight,el.getBoundingClientRect().height)),
      windowWidth:Math.max(document.documentElement.clientWidth,Math.ceil(el.scrollWidth))
    });
  }catch(error){
    throw new Error((pageLabel?pageLabel+" · ":"")+"页面渲染："+(error?.message||String(error)));
  }
  try{
    await downloadCanvas(canvas,filename);
  }catch(error){
    throw new Error((pageLabel?pageLabel+" · ":"")+(error?.message||String(error)));
  }
}

async function exportElement(el,filename){
  if(!el||!window.html2canvas) return;

  const rows=[...el.querySelectorAll(".statement-list .statement-row")];
  const rowsPerPage=10;

  // Short statements keep the original one-image experience.
  if(rows.length<=rowsPerPage){
    const restore=await prepareExportImages(el);
    try{
      await captureExportPage(el,filename,"单页");
    }finally{
      restore();
    }
    return;
  }

  // Long statements are split in the DOM first. This avoids ever creating
  // one giant canvas on mobile, which is the failure mode we are protecting.
  const pageCount=Math.ceil(rows.length/rowsPerPage);
  const sourceList=el.querySelector(".statement-list");
  const sourceTotal=el.querySelector(".receipt-total");
  const sourceMessage=el.querySelector(".receipt-message");
  const sourceFooter=el.querySelector(".receipt-footer");

  for(let page=0;page<pageCount;page++){
    const pageEl=el.cloneNode(true);
    pageEl.style.width=Math.max(320,Math.ceil(el.getBoundingClientRect().width||380))+"px";
    pageEl.style.maxWidth="none";
    pageEl.style.height="auto";
    pageEl.style.maxHeight="none";
    pageEl.style.overflow="visible";

    const pageRows=[...pageEl.querySelectorAll(".statement-list .statement-row")];
    pageRows.forEach((row,index)=>{
      if(index<page*rowsPerPage || index>=(page+1)*rowsPerPage) row.remove();
    });

    const meta=pageEl.querySelector(".statement-meta");
    if(meta){
      const marker=document.createElement("div");
      marker.innerHTML="分页<b>第 "+(page+1)+" / "+pageCount+" 页</b>";
      meta.appendChild(marker);
    }

    // Totals/message/footer belong to the last page only.
    if(page<pageCount-1){
      pageEl.querySelector(".receipt-total")?.remove();
      pageEl.querySelector(".receipt-message")?.remove();
      pageEl.querySelector(".receipt-footer")?.remove();
    }

    const host=document.createElement("div");
    host.style.cssText="position:fixed;left:-10000px;top:0;z-index:-1;pointer-events:none;background:#fff;";
    host.appendChild(pageEl);
    document.body.appendChild(host);

    const restore=await prepareExportImages(pageEl);
    try{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await captureExportPage(
        pageEl,
        exportPageName(filename,page+1,pageCount),
        "第 "+(page+1)+"/"+pageCount+" 页"
      );
    }finally{
      restore();
      host.remove();
    }

    await new Promise(resolve=>setTimeout(resolve,220));
  }
}
async function loadData(){
  if(!localState.session) return;
  const [shops,records,prepaid,benefits,benefitLedger,customers]=await Promise.all([
    supabase.from("shops").select("*").order("name"),
    supabase.from("consumption_records").select("*").order("occurred_at",{ascending:false}).limit(1000),
    supabase.from("customer_prepaid_ledger").select("*").order("created_at",{ascending:false}).limit(2000),
    supabase.from("customer_benefits").select("*").order("updated_at",{ascending:false}).limit(2000),
    supabase.from("customer_benefit_ledger").select("*").order("created_at",{ascending:false}).limit(2000),
    supabase.from("customers").select("id,shop_id,name,prepaid_balance,gift_balance").order("name")
  ]);
  if(!shops.error) localState.shops=shops.data||[];
  if(!records.error) localState.records=records.data||[];
  if(!prepaid.error) localState.prepaid=prepaid.data||[];
  if(!benefits.error) localState.benefits=benefits.data||[];
  if(!benefitLedger.error) localState.benefitLedger=benefitLedger.data||[];
  if(!customers.error) localState.customers=customers.data||[];
  renderBossSummary();
  if(localState.previewMode==="statement") renderReceiptPreviewMode();
}

function scheduleReload(){
  clearTimeout(scheduleReload.timer);
  scheduleReload.timer=setTimeout(loadData,350);
}

function bind(){
  $("bossSummaryList")?.addEventListener("click",e=>{
    const btn=e.target.closest("[data-boss-index]");
    if(btn) openBossStatement(btn.dataset.bossIndex);
  });

  $("closeBossStatementDialog")?.addEventListener("click",()=>{
    $("bossStatementDialog").close();
  });

  $("exportBossStatementBtn")?.addEventListener("click",async()=>{
    if(!localState.activeGroup) return;
    const clean=String(localState.activeGroup.customer||"老板").replace(/[\\/:*?"<>|]/g,"-");
    try{
      await exportElement(
        $("bossStatementCapture"),
        clean+"-全部流水-"+Date.now()+".png"
      );
    }catch(error){
      console.error("boss statement export failed",error);
      const detail=String(error?.message||error||"未知错误").slice(0,180);
      const message="老板流水导出失败："+detail;
      if(typeof window.paiMiniOrderBridge?.toast==="function"){
        window.paiMiniOrderBridge.toast(message);
      }else{
        alert(message);
      }
    }
  });

  $("previewCurrentReceiptTab")?.addEventListener("click",()=>{
    localState.previewMode="current";
    renderReceiptPreviewMode();
  });

  $("previewBossStatementTab")?.addEventListener("click",()=>{
    localState.previewMode="statement";
    renderReceiptPreviewMode();
  });

  $("bossMessage")?.addEventListener("input",()=>{
    if(localState.previewMode==="statement") renderReceiptPreviewMode();
  });

  [
    "showCustomer","showCompanion","showUnitPrice","showQuantity",
    "showTotalSpent","showNote","showTime","showLogo","showFooter"
  ].forEach(id=>{
    $(id)?.addEventListener("change",()=>{
      if(localState.previewMode==="statement"){
        setTimeout(renderReceiptPreviewMode,0);
      }
    });
  });

  $("receiptShop")?.addEventListener("change",()=>{
    setTimeout(()=>{
      if(localState.previewMode==="statement") renderReceiptPreviewMode();
    },450);
  });

  $("saveRecordBtn")?.addEventListener("click",()=>setTimeout(scheduleReload,600));
  $("recordList")?.addEventListener("click",()=>setTimeout(scheduleReload,600));
  $("refreshDataBtn")?.addEventListener("click",()=>setTimeout(scheduleReload,600));
}

bind();

const {data}=await supabase.auth.getSession();
localState.session=data.session;
if(localState.session) await loadData();

supabase.auth.onAuthStateChange(async (_event,session)=>{
  localState.session=session;
  if(session) await loadData();
});

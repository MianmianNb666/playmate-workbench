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
  activeGroup:null
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

function statementHtml(group,settings){
  const shop=localState.shops.find(s=>s.id===group.shop_id)||{};
  const records=group.records||[];
  const total=records.reduce((sum,r)=>sum+Number(r.amount||0),0);
  const newest=records[0]?.occurred_at;
  const oldest=records[records.length-1]?.occurred_at;
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
      <div>流水笔数<b>${records.length} 笔</b></div>
      <div>时间范围<b>${safe(oldestDate)} - ${safe(newestDate)}</b></div>
      <div>全部累计<b>${money(total,shop)}</b></div>
    </div>

    <div class="statement-list">
      ${records.map(r=>{
        const d=dateParts(r.occurred_at);
        return `
          <div class="statement-row">
            <time>${safe(d.date)}<br>${safe(d.time)}</time>
            <div>
              <b>${safe(r.item_name_snapshot||"")}</b>
              <span>
                ${settings.show_companion?"陪陪 "+safe(r.companion_name||"-")+" · ":""}
                ${settings.show_quantity?safe(r.duration_input||r.quantity||""):""}
              </span>
            </div>
            <strong>${money(r.amount,shop)}</strong>
          </div>
        `;
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

async function exportElement(el,filename){
  if(!el||!window.html2canvas) return;
  const canvas=await window.html2canvas(el,{
    scale:2,
    useCORS:true,
    backgroundColor:null
  });
  const link=document.createElement("a");
  link.download=filename;
  link.href=canvas.toDataURL("image/png");
  link.click();
}

async function loadData(){
  if(!localState.session) return;
  const [shops,records]=await Promise.all([
    supabase.from("shops").select("*").order("name"),
    supabase.from("consumption_records").select("*").order("occurred_at",{ascending:false}).limit(1000)
  ]);
  if(!shops.error) localState.shops=shops.data||[];
  if(!records.error) localState.records=records.data||[];
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
    await exportElement(
      $("bossStatementCapture"),
      clean+"-全部流水-"+Date.now()+".png"
    );
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

// Isolated multi-order module.
// Auth/bootstrap remain in the main app. This module stages lines and saves them as normal
// consumption_records so existing records/history stay compatible.
const $=id=>document.getElementById(id);
const lines=[];
const money=n=>"¥"+Number(n||0).toFixed(2);

function discountRate(){
  const raw=($("customerDiscount")?.value||"").trim();
  if(!raw) return 100;
  const n=Number(raw.replace(/折|%/g,""));
  if(!Number.isFinite(n)) return 100;
  return raw.includes("%")?n:(n<=10?n*10:n);
}
function currentLine(){
  const companion=($("companionName")?.value||"").trim();
  const item=($("calcItemName")?.value||"").trim();
  const price=Number($("calcUnitPrice")?.value);
  const unit=($("calcUnitLabel")?.value||"").trim()||"次";
  const unitMinutes=Number($("calcUnitMinutes")?.value)||null;
  const measure=($("durationInput")?.value||"").trim();
  const displayed=($("calcTotal")?.textContent||"").replace(/[^0-9.-]/g,"");
  const total=Number(displayed);
  if(!companion){window.alert("先填写陪陪");return null}
  if(!item){window.alert("先填写项目");return null}
  if(!Number.isFinite(price)){window.alert("先填写单价");return null}
  if(!measure){window.alert("先填写时长 / 数量");return null}
  if(!Number.isFinite(total)||total<0){window.alert("当前项目还没有算出有效金额");return null}
  let quantity=Number(measure);
  if(!Number.isFinite(quantity)){
    const h=measure.match(/([0-9.]+)\s*(?:h|小时)/i);
    const mm=measure.match(/([0-9.]+)\s*(?:m|分)/i);
    if(h&&unitMinutes) quantity=Number(h[1])*60/unitMinutes;
    else if(mm&&unitMinutes) quantity=Number(mm[1])/unitMinutes;
  }
  if(!Number.isFinite(quantity)) quantity=1;
  return {id:crypto.randomUUID?.()||String(Date.now()+Math.random()),companion,item,price,unit,unitMinutes,measure,quantity,total,discountRate:discountRate()};
}
function render(){
  const box=$("orderLineList");
  if(!box)return;
  box.innerHTML=lines.length?lines.map((x,i)=>'<div class="order-line"><div class="order-line-main"><b>'+escapeHtml(x.companion)+'</b><small>项目 '+(i+1)+'</small></div><div class="order-line-item"><b>'+escapeHtml(x.item)+'</b><small>'+money(x.price)+' / '+escapeHtml(x.unit)+' · '+escapeHtml(x.measure)+'</small></div><div class="order-line-price">'+money(x.total)+'</div><button class="order-line-remove" data-remove-line="'+x.id+'" type="button" aria-label="删除">×</button></div>').join(""):'<div class="empty-state">还没有添加项目。填好上面的陪陪、项目和数量后，点「添加当前项目」。</div>';
  const total=lines.reduce((a,x)=>a+x.total,0);
  if($("orderGrandTotal")) $("orderGrandTotal").textContent=money(total);
  window.paiMiniMultiOrder={lines:[...lines],total,clear};
}
function escapeHtml(v){const d=document.createElement("div");d.textContent=String(v??"");return d.innerHTML}
function add(){
  const x=currentLine(); if(!x)return;
  lines.push(x);render();
  if($("durationInput")) $("durationInput").value="";
  if($("calcTotal")) $("calcTotal").textContent=money(0);
  if($("calcFormula")) $("calcFormula").textContent="已加入本单，可继续添加同一陪玩或换一个陪玩";
}
function clear(){lines.splice(0);render()}

async function saveWholeOrder(){
  if(!lines.length){window.alert("先添加至少一个陪玩项目");return}
  const bridge=window.paiMiniOrderBridge;
  if(!bridge){window.alert("页面还没准备好，请刷新后再试");return}
  const ctx=bridge.getContext();
  if(!ctx.state?.shopId){window.alert("请先选择店铺");return}
  if(!ctx.customerName){window.alert("先填写老板 / 顾客");return}

  const btn=$("saveWholeOrderBtn");
  const old=btn.textContent;
  btn.disabled=true; btn.textContent="整单保存中…";
  try{
    let customer=ctx.state.customers.find(c=>c.name===ctx.customerName)||null;
    if(!customer){
      let created=await ctx.supabase.from("customers").insert({
        shop_id:ctx.state.shopId,name:ctx.customerName,discount_rate:ctx.discountRate
      }).select().single();
      if(created.error && /discount_rate|column/i.test(String(created.error.message||""))){
        created=await ctx.supabase.from("customers").insert({shop_id:ctx.state.shopId,name:ctx.customerName}).select().single();
      }
      if(created.error) throw created.error;
      customer=created.data;
      ctx.state.customers.push(customer);
    }

    const historyRes=await ctx.supabase.from("consumption_records").select("amount").eq("customer_id",customer.id);
    if(historyRes.error) throw historyRes.error;
    let running=(historyRes.data||[]).reduce((sum,r)=>sum+Number(r.amount||0),0);

    // Save sequentially so previous_total/new_total stay correct for every line.
    for(const x of lines){
      const original=x.discountRate>0?x.total/(x.discountRate/100):x.total;
      const next=running+x.total;
      const report='老板：'+ctx.customerName+'\n陪陪：'+x.companion+'\n消费项目：'+x.item+'\n单价：'+x.price+'/'+x.unit+'\n时长/数量：'+x.measure+'\n总价：'+x.total+'\n累计消费：'+next;
      const base={
        shop_id:ctx.state.shopId,customer_id:customer.id,item_id:null,
        customer_name_snapshot:ctx.customerName,
        item_name:x.item,item_name_snapshot:x.item,
        companion_name:x.companion,
        unit_price_snapshot:x.price,
        unit_label:x.unit||"次",unit_label_snapshot:x.unit||"次",
        unit_minutes_snapshot:x.unitMinutes,
        quantity:x.quantity,duration_input:x.measure,
        amount:x.total,previous_total:running,new_total:next,
        note:ctx.note,report_text:report
      };
      let result=await ctx.supabase.from("consumption_records").insert({
        ...base,original_amount:original,discount_rate_snapshot:x.discountRate
      }).select("id").single();
      if(result.error && /original_amount|discount_rate_snapshot|schema cache|column/i.test(String(result.error.message||""))){
        result=await ctx.supabase.from("consumption_records").insert(base).select("id").single();
      }
      if(result.error) throw result.error;
      running=next;
    }
    clear();
    await bridge.refreshAfterSave();
    bridge.toast("整单已保存 ♡");
  }catch(error){
    console.error("saveWholeOrder failed",error);
    const detail=String(error?.message||error||"未知错误");
    window.alert("整单没有保存成功。\n\n原因："+detail);
  }finally{
    btn.disabled=false;btn.textContent=old;
  }
}
document.addEventListener("DOMContentLoaded",()=>{
  $("addOrderLineBtn")?.addEventListener("click",add);
  $("saveWholeOrderBtn")?.addEventListener("click",saveWholeOrder);
  $("orderLineList")?.addEventListener("click",e=>{
    const b=e.target.closest("[data-remove-line]");if(!b)return;
    const i=lines.findIndex(x=>x.id===b.dataset.removeLine);if(i>=0)lines.splice(i,1);render();
  });
  render();
});

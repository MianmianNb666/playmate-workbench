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
  window.paiMiniMultiOrder={lines:[...lines],total,clear,save:saveWholeOrder,report:buildWholeOrderReport};
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

function buildWholeOrderReport(){
  if(!lines.length)return "";
  const customer=($("customerName")?.value||"").trim();
  const note=($("calcNote")?.value||"").trim();
  const total=lines.reduce((sum,line)=>sum+Number(line.total||0),0);
  const grouped=[];
  for(const line of lines){
    let group=grouped.find(x=>x.companion===line.companion);
    if(!group){group={companion:line.companion,lines:[]};grouped.push(group)}
    group.lines.push(line);
  }
  const out=[];
  if(customer)out.push("老板："+customer);
  grouped.forEach(group=>{
    out.push("陪陪："+group.companion);
    group.lines.forEach((line,index)=>{
      const prefix=group.lines.length>1?"项目"+(index+1)+"：":"消费项目：";
      out.push(prefix+line.item);
      out.push("单价："+line.price+"/"+line.unit);
      out.push("时长/数量："+line.measure);
      out.push("小计："+Number(line.total||0).toFixed(2));
    });
  });
  out.push("本单总价："+total.toFixed(2));
  if(note)out.push("备注："+note);
  return out.join("\n");
}

async function saveWholeOrder(){
  if(!lines.length){window.alert("先添加至少一个陪玩项目");return}
  const bridge=window.paiMiniOrderBridge;
  if(!bridge){window.alert("页面还没准备好，请刷新后再试");return}
  const ctx=bridge.getContext();
  if(!ctx.state?.shopId){window.alert("请先选择店铺");return}
  if(!ctx.customerName){window.alert("先填写老板 / 顾客");return}

  const btn=$("saveWholeOrderBtn");
  const old=btn?.textContent||"保存整单";
  if(btn){btn.disabled=true;btn.textContent="整单保存中…"}

  try{
    // 只在当前店铺里找同名老板，避免误拿到别的店铺的同名档案。
    let customer=(ctx.state.customers||[]).find(c=>c.shop_id===ctx.state.shopId&&String(c.name||"").trim()===ctx.customerName)||null;

    if(!customer){
      let created=await ctx.supabase.from("customers").insert({
        shop_id:ctx.state.shopId,
        name:ctx.customerName,
        discount_rate:ctx.discountRate
      }).select().single();

      if(created.error && /discount_rate|schema cache|column/i.test(String(created.error.message||""))){
        created=await ctx.supabase.from("customers").insert({
          shop_id:ctx.state.shopId,
          name:ctx.customerName
        }).select().single();
      }

      // 如果创建档案失败，再查一次，避免并发/已有档案导致整单直接终止。
      if(created.error){
        const existing=await ctx.supabase.from("customers")
          .select("*")
          .eq("shop_id",ctx.state.shopId)
          .eq("name",ctx.customerName)
          .maybeSingle();
        if(existing.error) throw created.error;
        customer=existing.data||null;
      }else{
        customer=created.data;
        ctx.state.customers.push(customer);
      }
    }

    let historyQuery=ctx.supabase.from("consumption_records").select("amount");
    historyQuery=customer?.id
      ? historyQuery.eq("customer_id",customer.id)
      : historyQuery.eq("shop_id",ctx.state.shopId).eq("customer_name_snapshot",ctx.customerName);

    const historyRes=await historyQuery;
    if(historyRes.error) throw historyRes.error;
    let running=(historyRes.data||[]).reduce((sum,r)=>sum+Number(r.amount||0),0);

    const rows=lines.map(x=>{
      const original=x.discountRate>0?x.total/(x.discountRate/100):x.total;
      const next=running+x.total;
      const report='老板：'+ctx.customerName+'\\n陪陪：'+x.companion+'\\n消费项目：'+x.item+'\\n单价：'+x.price+'/'+x.unit+'\\n时长/数量：'+x.measure+'\\n总价：'+x.total+'\\n累计消费：'+next+(ctx.note?'\\n备注：'+ctx.note:'');
      const row={
        shop_id:ctx.state.shopId,
        customer_id:customer?.id||null,
        item_id:null,
        customer_name_snapshot:ctx.customerName,
        item_name:x.item,
        item_name_snapshot:x.item,
        companion_name:x.companion,
        unit_price_snapshot:x.price,
        unit_label:x.unit||"次",
        unit_label_snapshot:x.unit||"次",
        unit_minutes_snapshot:x.unitMinutes,
        quantity:x.quantity,
        duration_input:x.measure,
        amount:x.total,
        previous_total:running,
        new_total:next,
        note:ctx.note,
        report_text:report,
        original_amount:original,
        discount_rate_snapshot:x.discountRate
      };
      running=next;
      return row;
    });

    // 整批一次写入，避免多项目只保存一半。
    let result=await ctx.supabase.from("consumption_records").insert(rows).select("id");

    // 兼容旧数据库没有折扣字段。
    if(result.error && /original_amount|discount_rate_snapshot|schema cache|column/i.test(String(result.error.message||""))){
      const compatRows=rows.map(({original_amount,discount_rate_snapshot,...row})=>row);
      result=await ctx.supabase.from("consumption_records").insert(compatRows).select("id");
    }

    // 如果历史 customer 外键异常，退化为纯快照保存，和主保存入口保持一致。
    if(result.error && /foreign key|violates.*constraint|customer_id|item_id/i.test(String(result.error.message||""))){
      const snapshotRows=rows.map(row=>({...row,customer_id:null,item_id:null}));
      result=await ctx.supabase.from("consumption_records").insert(snapshotRows).select("id");
    }

    if(result.error) throw result.error;

    clear();
    await bridge.refreshAfterSave();
    bridge.toast("整单已保存 ♡");
  }catch(error){
    console.error("saveWholeOrder failed",error);
    const detail=String(error?.message||error||"未知错误");
    window.alert("整单没有保存成功。\\n\\n原因："+detail);
  }finally{
    if(btn){btn.disabled=false;btn.textContent=old}
  }
}

function bindMultiOrder(){
  if(window.__paiMiniMultiOrderBound)return;
  window.__paiMiniMultiOrderBound=true;
  $("addOrderLineBtn")?.addEventListener("click",add);
  $("saveWholeOrderBtn")?.addEventListener("click",saveWholeOrder);
  $("orderLineList")?.addEventListener("click",e=>{
    const b=e.target.closest("[data-remove-line]");if(!b)return;
    const i=lines.findIndex(x=>x.id===b.dataset.removeLine);if(i>=0)lines.splice(i,1);render();
  });
  render();
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",bindMultiOrder,{once:true});
}else{
  bindMultiOrder();
}

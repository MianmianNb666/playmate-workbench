// Isolated multi-order staging module.
// It does not touch auth, Supabase initialization, or the existing single-record save path.
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
    const h=measure.match(/([0-9.]+)\s*[hH小时]/);
    const m=measure.match(/([0-9.]+)\s*[mM分]/);
    if(h&&unitMinutes) quantity=Number(h[1])*60/unitMinutes;
    else if(m&&unitMinutes) quantity=Number(m[1])/unitMinutes;
  }
  if(!Number.isFinite(quantity)) quantity=1;
  return {id:crypto.randomUUID?.()||String(Date.now()+Math.random()),companion,item,price,unit,unitMinutes,measure,quantity,total,discountRate:discountRate()};
}
function render(){
  const box=$("orderLineList");
  if(!box)return;
  if(!lines.length){
    box.innerHTML='<div class="empty-state">还没有添加项目。填好上面的陪陪、项目和数量后，点「添加当前项目」。</div>';
  }else{
    box.innerHTML=lines.map((x,i)=>'<div class="order-line"><div class="order-line-main"><b>'+escapeHtml(x.companion)+'</b><small>陪玩 '+(i+1)+'</small></div><div class="order-line-item"><b>'+escapeHtml(x.item)+'</b><small>'+money(x.price)+' / '+escapeHtml(x.unit)+' · '+escapeHtml(x.measure)+'</small></div><div class="order-line-price">'+money(x.total)+'</div><button class="order-line-remove" data-remove-line="'+x.id+'" type="button" aria-label="删除">×</button></div>').join("");
  }
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
document.addEventListener("DOMContentLoaded",()=>{
  $("addOrderLineBtn")?.addEventListener("click",add);
  $("orderLineList")?.addEventListener("click",e=>{
    const b=e.target.closest("[data-remove-line]");if(!b)return;
    const i=lines.findIndex(x=>x.id===b.dataset.removeLine);if(i>=0)lines.splice(i,1);render();
  });
  render();
});

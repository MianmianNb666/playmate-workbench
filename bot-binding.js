let initialized=false;
let bindings=[];

const $=id=>document.getElementById(id);

function bridge(){return window.paiMiniOrderBridge||null}
function safe(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}

function setStatus(text,bad=false){
  const el=$("botBindingHint");
  if(!el)return;
  el.textContent=text||"";
  el.style.color=bad?"var(--bad)":"var(--muted)";
}

function render(){
  const api=bridge();
  const ctx=api?.getContext?.()||{};
  const shop=ctx.shop;
  if($("botBindingShopName")) $("botBindingShopName").textContent=shop?.name||"未选择店铺";

  const list=$("botBindingList");
  if(!list)return;
  list.innerHTML=bindings.length?bindings.map(row=>`
    <div class="manager-row">
      <div>
        <b>${safe(row.channel_name||"未命名微信群")}</b>
        <small>${safe(row.channel_external_id||"")} · ${row.enabled===false?"已暂停":"运行中"}</small>
      </div>
      <div class="row-actions">
        <button class="tiny-btn" type="button" data-bot-toggle="${row.id}" data-next="${row.enabled===false?"on":"off"}">${row.enabled===false?"恢复":"暂停"}</button>
        <button class="tiny-btn danger" type="button" data-bot-unbind="${row.id}">解除绑定</button>
      </div>
    </div>
  `).join(""):'<div class="empty-state">这家店还没有绑定微信群。</div>';
}

async function refresh({silent=false}={}){
  const api=bridge();const ctx=api?.getContext?.()||{};
  if(!ctx.supabase||!ctx.state?.session?.user?.id||!ctx.shop?.id){bindings=[];render();return}
  try{
    const {data,error}=await ctx.supabase.from("bot_bindings")
      .select("*")
      .eq("owner_user_id",ctx.state.session.user.id)
      .eq("shop_id",ctx.shop.id)
      .order("created_at",{ascending:false});
    if(error)throw error;
    bindings=data||[];
    render();
    if(!silent)setStatus("已刷新绑定状态");
  }catch(error){
    console.error("bot binding refresh failed",error);
    bindings=[];render();
    if(!silent)setStatus("机器人绑定读取失败："+(error?.message||"未知错误"),true);
  }
}

async function generateCode(){
  const api=bridge();const ctx=api?.getContext?.()||{};
  if(!ctx.supabase||!ctx.shop?.id){api?.toast?.("先选择一家店铺");return}
  const btn=$("generateBotPairingCodeBtn");
  if(btn){btn.disabled=true;btn.textContent="生成中…"}
  try{
    const {data,error}=await ctx.supabase.rpc("create_bot_pairing_code",{p_shop_id:ctx.shop.id});
    if(error)throw error;
    const code=String(data?.code||"").trim();
    if(!code)throw new Error("没有返回绑定码");
    if($("botPairingCode")) $("botPairingCode").textContent=code;
    if($("botPairingCommand")) $("botPairingCommand").textContent="绑定 "+code;
    $("botPairingResult")?.classList.remove("hidden");
    setStatus("绑定码 10 分钟有效，只能使用一次。");
  }catch(error){
    console.error("generate bot pairing code failed",error);
    const missing=/create_bot_pairing_code|PGRST202|schema cache|does not exist/i.test(String(error?.message||""));
    setStatus(missing?"机器人绑定功能尚未部署，请先运行配套 SQL":"生成失败："+(error?.message||"未知错误"),true);
  }finally{
    if(btn){btn.disabled=false;btn.textContent="生成绑定码"}
  }
}

async function copyCommand(){
  const text=$("botPairingCommand")?.textContent?.trim();
  if(!text)return;
  try{
    await navigator.clipboard.writeText(text);
    bridge()?.toast?.("已复制，去微信群发送即可 ♡");
  }catch{
    bridge()?.toast?.("复制失败，请手动复制绑定命令");
  }
}

async function toggleBinding(id,next){
  const api=bridge();const ctx=api?.getContext?.()||{};
  const enabled=next==="on";
  const {error}=await ctx.supabase.from("bot_bindings").update({enabled,updated_at:new Date().toISOString()}).eq("id",id);
  if(error){api?.toast?.("操作失败："+error.message);return}
  api?.toast?.(enabled?"机器人已恢复":"机器人已暂停");
  await refresh({silent:true});
}

async function unbind(id){
  const api=bridge();const ctx=api?.getContext?.()||{};
  const row=bindings.find(x=>x.id===id);
  if(!row)return;
  if(!confirm("解除与「"+(row.channel_name||"这个微信群")+"」的绑定吗？"))return;
  const {error}=await ctx.supabase.from("bot_bindings").delete().eq("id",id);
  if(error){api?.toast?.("解除失败："+error.message);return}
  api?.toast?.("已解除机器人绑定");
  await refresh({silent:true});
}

function bind(){
  $("generateBotPairingCodeBtn")?.addEventListener("click",generateCode);
  $("copyBotPairingCommandBtn")?.addEventListener("click",copyCommand);
  $("refreshBotBindingsBtn")?.addEventListener("click",()=>refresh());
  $("botBindingList")?.addEventListener("click",e=>{
    const toggle=e.target.closest("[data-bot-toggle]");
    if(toggle){toggleBinding(toggle.dataset.botToggle,toggle.dataset.next);return}
    const unbind=e.target.closest("[data-bot-unbind]");
    if(unbind)unbind(unbind.dataset.botUnbind);
  });
  window.addEventListener("paimini:shop-changed",()=>refresh({silent:true}));
}

export function initBotBinding(){
  if(initialized)return refresh({silent:true});
  initialized=true;
  bind();
  return refresh({silent:true});
}

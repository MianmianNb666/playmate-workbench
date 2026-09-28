import { createClient } from "./vendor/supabase-js.mjs?v=20260927-cache2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js?v=20260927-tencent2";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const $=id=>document.getElementById(id);

function currentShop(){
  const select=$("calcShop");
  if(!select?.value) return null;
  const option=select.options?.[select.selectedIndex];
  return {
    id:select.value,
    name:(option?.textContent||"当前店铺").trim()
  };
}

function setHint(message,isError=false){
  const el=$("botPairingHint");
  if(!el) return;
  el.textContent=message||"";
  el.style.color=isError?"var(--bad)":"";
}

function resetPairingDisplay(){
  const code=$("botPairingCode");
  const expire=$("botPairingExpires");
  const copy=$("copyBotPairingCodeBtn");
  if(code) code.textContent="--------";
  if(expire) expire.textContent="生成后 10 分钟内有效，仅可使用一次";
  if(copy) copy.disabled=true;
}

function refreshShopLabel(){
  const shop=currentShop();
  const label=$("botPairingShopName");
  if(label) label.textContent=shop?.name||"未选择店铺";
  resetPairingDisplay();
  setHint("");
}

async function generatePairingCode(){
  const shop=currentShop();
  if(!shop){
    setHint("请先选择要绑定的店铺。",true);
    return;
  }

  const btn=$("generateBotPairingCodeBtn");
  if(btn){
    btn.disabled=true;
    btn.textContent="生成中…";
  }
  setHint("");

  try{
    const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
    if(sessionError) throw sessionError;
    if(!sessionData?.session){
      throw new Error("请先登录 PaiMini");
    }

    const {data,error}=await supabase.rpc("create_bot_pairing_code",{
      p_shop_id:shop.id
    });
    if(error) throw error;

    const result=Array.isArray(data)?data[0]:data;
    const code=String(result?.code||"").trim();
    if(!code) throw new Error("绑定码生成失败，请重试");

    $("botPairingCode").textContent=code;
    $("copyBotPairingCodeBtn").disabled=false;

    const expiresAt=result?.expires_at ? new Date(result.expires_at) : null;
    $("botPairingExpires").textContent=expiresAt && !Number.isNaN(expiresAt.getTime())
      ? "有效至 "+expiresAt.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})+"，仅可使用一次"
      : "10 分钟内有效，仅可使用一次";

    setHint(`把「绑定 ${code}」发送到要绑定「${shop.name}」的微信群。`);
  }catch(error){
    console.error("create bot pairing code failed",error);
    setHint("生成失败："+(error?.message||String(error)),true);
    resetPairingDisplay();
  }finally{
    if(btn){
      btn.disabled=false;
      btn.textContent="生成绑定码";
    }
  }
}

async function copyPairingCommand(){
  const code=String($("botPairingCode")?.textContent||"").trim();
  if(!code || code==="--------") return;
  const text="绑定 "+code;
  try{
    await navigator.clipboard.writeText(text);
    setHint("已复制："+text);
  }catch{
    const area=document.createElement("textarea");
    area.value=text;
    area.style.position="fixed";
    area.style.opacity="0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    setHint("已复制："+text);
  }
}

function init(){
  const generate=$("generateBotPairingCodeBtn");
  const copy=$("copyBotPairingCodeBtn");
  if(!generate || !copy) return;

  generate.addEventListener("click",generatePairingCode);
  copy.addEventListener("click",copyPairingCommand);

  $("calcShop")?.addEventListener("change",refreshShopLabel);
  window.addEventListener("paimini:shop-changed",refreshShopLabel);

  refreshShopLabel();
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",init,{once:true});
}else{
  init();
}

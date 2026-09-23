import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js?v=20260923-savefix4";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);

function hint(text,bad=false){
  $("hint").textContent=text||"";
  $("hint").style.color=bad?"#c65f76":"#9c818c";
}

async function ensureRecoverySession(){
  const {data,error}=await supabase.auth.getSession();
  if(error){hint("重置链接验证失败："+error.message,true);return false}
  if(data.session){hint("链接验证成功，请设置新密码。");return true}

  let ok=false;
  await new Promise(resolve=>{
    const {data:sub}=supabase.auth.onAuthStateChange((event,session)=>{
      if(event==="PASSWORD_RECOVERY"||session){ok=true;sub.subscription.unsubscribe();resolve()}
    });
    setTimeout(()=>{try{sub.subscription.unsubscribe()}catch{};resolve()},2500);
  });

  if(!ok){
    const again=await supabase.auth.getSession();
    ok=!!again.data.session;
  }
  hint(ok?"链接验证成功，请设置新密码。":"重置链接无效或已过期，请让管理员重新发送。",!ok);
  return ok;
}

async function save(){
  const p1=$("newPassword").value;
  const p2=$("confirmPassword").value;
  if(p1.length<6){hint("密码至少 6 位。",true);return}
  if(p1!==p2){hint("两次输入的密码不一致。",true);return}

  const btn=$("savePasswordBtn");
  btn.disabled=true;btn.textContent="保存中…";
  const {error}=await supabase.auth.updateUser({password:p1});
  btn.disabled=false;btn.textContent="保存新密码";

  if(error){hint("保存失败："+error.message,true);return}
  $("formBox").classList.add("hidden");
  $("successBox").classList.remove("hidden");
  hint("密码更新成功 ♡");
}

$("savePasswordBtn").addEventListener("click",save);
await ensureRecoverySession();

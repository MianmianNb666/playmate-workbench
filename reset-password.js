import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js?v=20260923-savefix4";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
});
const $=id=>document.getElementById(id);
let recoveryReady=false;

function hint(text,bad=false){
  $("hint").textContent=text||"";
  $("hint").style.color=bad?"#c65f76":"#9c818c";
}

function setReady(ready){
  recoveryReady=!!ready;
  const btn=$("savePasswordBtn");
  if(btn) btn.disabled=!ready;
}

function cleanRecoveryUrl(){
  try{
    const clean=new URL(window.location.href);
    clean.searchParams.delete("code");
    clean.searchParams.delete("type");
    clean.hash="";
    history.replaceState({},document.title,clean.pathname);
  }catch{}
}

async function establishRecoverySession(){
  setReady(false);
  hint("正在验证重置链接…");

  try{
    // 1) Supabase PKCE / 新版邮件链接：?code=...
    const url=new URL(window.location.href);
    const code=url.searchParams.get("code");
    if(code){
      const {data,error}=await supabase.auth.exchangeCodeForSession(code);
      if(error) throw error;
      if(data?.session){
        cleanRecoveryUrl();
        setReady(true);
        hint("链接验证成功，请设置新密码。");
        return true;
      }
    }

    // 2) 兼容旧版 implicit flow：#access_token=...&refresh_token=...
    const hash=new URLSearchParams((window.location.hash||"").replace(/^#/,""));
    const accessToken=hash.get("access_token");
    const refreshToken=hash.get("refresh_token");
    if(accessToken&&refreshToken){
      const {data,error}=await supabase.auth.setSession({
        access_token:accessToken,
        refresh_token:refreshToken
      });
      if(error) throw error;
      if(data?.session){
        cleanRecoveryUrl();
        setReady(true);
        hint("链接验证成功，请设置新密码。");
        return true;
      }
    }

    // 3) 如果浏览器已经持有 recovery session，则直接使用。
    const {data,error}=await supabase.auth.getSession();
    if(error) throw error;
    if(data?.session){
      setReady(true);
      hint("链接验证成功，请设置新密码。");
      return true;
    }

    hint("重置链接无效或已过期，请让管理员重新发送一封新的重置邮件。",true);
    return false;
  }catch(error){
    console.error("recovery session failed",error);
    hint("重置链接验证失败："+String(error?.message||error||"未知错误")+"。请重新发送一封新的重置邮件。",true);
    return false;
  }
}

async function save(){
  if(!recoveryReady){
    hint("重置链接还没有验证成功，暂时不能保存密码。",true);
    return;
  }

  const p1=$("newPassword").value;
  const p2=$("confirmPassword").value;
  if(p1.length<6){hint("密码至少 6 位。",true);return}
  if(p1!==p2){hint("两次输入的密码不一致。",true);return}

  const btn=$("savePasswordBtn");
  btn.disabled=true;
  btn.textContent="保存中…";

  try{
    const {data:sessionData}=await supabase.auth.getSession();
    if(!sessionData?.session) throw new Error("重置会话已失效，请重新发送重置邮件");

    const {error}=await supabase.auth.updateUser({password:p1});
    if(error) throw error;

    $("formBox").classList.add("hidden");
    $("successBox").classList.remove("hidden");
    hint("密码更新成功 ♡");
    try{await supabase.auth.signOut()}catch{}
  }catch(error){
    console.error("password update failed",error);
    setReady(false);
    hint("保存失败："+String(error?.message||error||"未知错误")+"。请重新发送一封新的重置邮件。",true);
  }finally{
    btn.textContent="保存新密码";
    if(recoveryReady) btn.disabled=false;
  }
}

$("savePasswordBtn").addEventListener("click",save);
setReady(false);
await establishRecoverySession();

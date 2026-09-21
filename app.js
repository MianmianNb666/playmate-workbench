import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const $ = (id) => document.getElementById(id);
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

function setConnection(text, ok=true){
  const box=$("connectionStatus");
  box.className="status "+(ok?"good":"bad");
  $("connectionText").textContent=text;
}

function setAuthHint(text, bad=false){
  const el=$("authHint");
  el.textContent=text||"";
  el.style.color=bad?"var(--bad)":"var(--muted)";
}

async function refreshSession(){
  const { data, error } = await supabase.auth.getSession();
  if(error){
    setConnection("Supabase 连接失败",false);
    setAuthHint(error.message,true);
    return;
  }
  setConnection("Supabase 已连接 ✓",true);
  const session=data.session;
  $("loggedOutBox").classList.toggle("hidden",!!session);
  $("loggedInBox").classList.toggle("hidden",!session);
  $("accountEmail").textContent=session?.user?.email||"";
}

async function signUp(){
  const email=$("email").value.trim();
  const password=$("password").value;
  if(!email||password.length<6){
    setAuthHint("请输入邮箱，密码至少 6 位。",true);
    return;
  }
  setAuthHint("正在注册…");
  const { data, error } = await supabase.auth.signUp({email,password});
  if(error){
    setAuthHint("注册失败："+error.message,true);
    return;
  }
  if(data.session){
    setAuthHint("注册成功 ✓");
  }else{
    setAuthHint("注册成功。当前 Auth 如果开启了邮箱确认，请先去邮箱完成确认。");
  }
  await refreshSession();
}

async function signIn(){
  const email=$("email").value.trim();
  const password=$("password").value;
  if(!email||!password){
    setAuthHint("请输入邮箱和密码。",true);
    return;
  }
  setAuthHint("正在登录…");
  const { error } = await supabase.auth.signInWithPassword({email,password});
  if(error){
    setAuthHint("登录失败："+error.message,true);
    return;
  }
  setAuthHint("登录成功 ✓");
  await refreshSession();
}

async function signOut(){
  await supabase.auth.signOut();
  setAuthHint("");
  await refreshSession();
}

$("signUpBtn").onclick=signUp;
$("signInBtn").onclick=signIn;
$("signOutBtn").onclick=signOut;

supabase.auth.onAuthStateChange(()=>refreshSession());
refreshSession();

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

const money = (value) => {
  const n = Number(value || 0);
  return "¥" + (Number.isFinite(n) ? n : 0).toFixed(2);
};

function updateCalculator(){
  const unit = Math.max(0, Number($("unitPrice").value || 0));
  const qty = Math.max(0, Number($("quantity").value || 0));
  const extra = Math.max(0, Number($("extraFee").value || 0));
  $("totalPrice").textContent = money(unit * qty + extra);
}

["unitPrice","quantity","extraFee"].forEach(id => $(id).addEventListener("input", updateCalculator));

$("clearCalc").addEventListener("click", () => {
  $("unitPrice").value = "";
  $("quantity").value = "1";
  $("extraFee").value = "0";
  $("copyHint").textContent = "";
  updateCalculator();
});

$("copyQuote").addEventListener("click", async () => {
  const unit = Math.max(0, Number($("unitPrice").value || 0));
  const qty = Math.max(0, Number($("quantity").value || 0));
  const extra = Math.max(0, Number($("extraFee").value || 0));
  const total = unit * qty + extra;
  const text = `派单报价：单价 ${money(unit)} × ${qty}，额外费用 ${money(extra)}，合计 ${money(total)}`;
  try{
    await navigator.clipboard.writeText(text);
    $("copyHint").textContent = "已复制报价 ♡";
  }catch{
    $("copyHint").textContent = text;
  }
});

$("jumpCalculator").addEventListener("click", () => {
  $("calculator").scrollIntoView({behavior:"smooth",block:"start"});
});

const dialog = $("accountDialog");
function openAccount(){
  if(typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open","");
}
function closeAccount(){
  if(typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}
$("accountBtn").addEventListener("click", openAccount);
$("myNavBtn").addEventListener("click", openAccount);
$("closeAccount").addEventListener("click", closeAccount);
dialog.addEventListener("click", (event) => {
  if(event.target === dialog) closeAccount();
});

function setConnection(text, ok=true){
  const box = $("connectionStatus");
  box.className = "connection-pill " + (ok ? "good" : "bad");
  $("connectionText").textContent = text;
}
function setAuthHint(text, bad=false){
  $("authHint").textContent = text || "";
  $("authHint").style.color = bad ? "var(--bad)" : "#9b7784";
}

async function refreshSession(){
  const {data,error} = await supabase.auth.getSession();
  if(error){
    setConnection("Supabase 连接失败", false);
    setAuthHint(error.message, true);
    return;
  }
  setConnection("Supabase 已连接 ✓", true);
  const session = data.session;
  $("loggedOutBox").classList.toggle("hidden", !!session);
  $("loggedInBox").classList.toggle("hidden", !session);
  $("accountEmail").textContent = session?.user?.email || "";
  $("accountIcon").textContent = session ? "🐱" : "♡";
}

async function signUp(){
  const email = $("email").value.trim();
  const password = $("password").value;
  if(!email || password.length < 6){
    setAuthHint("请输入邮箱，密码至少 6 位。", true);
    return;
  }
  setAuthHint("正在注册…");
  const {data,error} = await supabase.auth.signUp({
    email,
    password,
    options:{
      emailRedirectTo:new URL("./",window.location.href).href
    }
  });
  if(error){
    setAuthHint("注册失败：" + error.message, true);
    return;
  }
  setAuthHint(data.session ? "注册成功 ✓" : "注册成功，请按邮箱里的确认链接完成验证。");
  await refreshSession();
}

async function signIn(){
  const email = $("email").value.trim();
  const password = $("password").value;
  if(!email || !password){
    setAuthHint("请输入邮箱和密码。", true);
    return;
  }
  setAuthHint("正在登录…");
  const {error} = await supabase.auth.signInWithPassword({email,password});
  if(error){
    setAuthHint("登录失败：" + error.message, true);
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

$("signUpBtn").addEventListener("click", signUp);
$("signInBtn").addEventListener("click", signIn);
$("signOutBtn").addEventListener("click", signOut);

supabase.auth.onAuthStateChange(() => refreshSession());
updateCalculator();
refreshSession();

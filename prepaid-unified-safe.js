// PaiMini 预存统一发放：预设只负责保存套餐；发放时 选老板 → 选预设 → 可临时修改 → 一键发放。
// 独立模块，不参与核心启动，不改派单保存逻辑。

let started=false;
let busy=false;
const $=id=>document.getElementById(id);
const TIMEOUT_MS=16000;
const state={customers:[],presets:[],customerId:null,presetId:null,benefits:[]};

function ctx(){try{return window.paiMiniOrderBridge?.getContext?.()||null}catch{return null}}
function supabase(){return ctx()?.supabase||null}
function toast(message){window.paiMiniOrderBridge?.toast?.(message)}
function safe(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function money(v){const shop=(ctx()?.state?.shops||[]).find(x=>x.id===currentCustomer()?.shop_id)||ctx()?.shop;return (shop?.currency_symbol||'¥')+num(v).toFixed(2)}
function deadline(label){return new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timeout')),TIMEOUT_MS))}
async function query(promise,label){const r=await Promise.race([promise,deadline(label)]);if(r?.error)throw r.error;return r?.data||[]}
async function rpc(name,args){const s=supabase();if(!s)throw new Error('CORE_SUPABASE_NOT_READY');const r=await Promise.race([s.rpc(name,args),deadline(name)]);if(r?.error)throw r.error;return r?.data}
function currentCustomer(){return state.customers.find(x=>x.id===state.customerId)||null}
function currentPreset(){return state.presets.find(x=>x.id===state.presetId)||null}

function ensureStyle(){
  if($('prepaidUnifiedStyle'))return;
  const s=document.createElement('style');s.id='prepaidUnifiedStyle';s.textContent=`
  .prepaid-unified-card{margin-top:14px}.prepaid-unified-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.prepaid-unified-grid .wide{grid-column:1/-1}.prepaid-unified-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:12px 0}.prepaid-unified-stat{border:1px solid var(--line);border-radius:14px;padding:11px;background:var(--paper)}.prepaid-unified-stat span{display:block;color:var(--muted);font-size:11px}.prepaid-unified-stat b{display:block;margin-top:4px;font-size:17px}.prepaid-unified-benefits{display:grid;gap:8px;margin-top:10px}.prepaid-unified-benefit{display:grid;grid-template-columns:2fr .8fr .8fr 1fr auto;gap:7px;align-items:end;border:1px solid var(--line);border-radius:13px;padding:10px}.prepaid-unified-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.prepaid-unified-note{font-size:11px;color:var(--muted);line-height:1.55;margin-top:7px}
  #prepaidPresetSafeCard [data-apply-preset]{display:none!important}
  @media(max-width:720px){.prepaid-unified-grid,.prepaid-unified-summary{grid-template-columns:1fr}.prepaid-unified-grid .wide{grid-column:auto}.prepaid-unified-benefit{grid-template-columns:1fr 1fr}.prepaid-unified-benefit .benefit-name{grid-column:1/-1}}
  `;document.head.appendChild(s);
}

function cleanPresetCopy(){
  const card=$('prepaidPresetSafeCard');if(!card)return;
  const title=card.querySelector('.card-title b');if(title)title.textContent='预存套餐预设 ♡';
  const sub=card.querySelector('.card-title small');if(sub)sub.textContent='这里只负责保存常用套餐，真正发放请在下面选择老板和预设';
  card.querySelectorAll('.card-title').forEach(x=>{if(x.querySelector('b')?.textContent==='已有预设'){const sm=x.querySelector('small');if(sm)sm.textContent='已保存的套餐会出现在下方发放区';}});
}

function mount(){
  const mount=$('prepaidPageMount');if(!mount)return false;
  let card=$('prepaidUnifiedCard');
  if(!card){
    card=document.createElement('div');card.id='prepaidUnifiedCard';card.className='card prepaid-unified-card';
    const preset=$('prepaidPresetSafeCard');if(preset)preset.insertAdjacentElement('afterend',card);else mount.prepend(card);
  }
  card.innerHTML=`
    <div class="card-title"><div><b>给老板添加预存 ♡</b><small>选老板 → 选预设 → 需要的话临时改金额或权益 → 一键发放</small></div></div>
    <div class="prepaid-unified-grid">
      <label>老板<select id="prepaidUnifiedCustomer"></select></label>
      <label>预存预设<select id="prepaidUnifiedPreset"></select></label>
      <label>本次预存金额<input id="prepaidUnifiedAmount" type="number" min="0" step="0.01" placeholder="0.00"></label>
      <label>备注<input id="prepaidUnifiedNote" maxlength="160" placeholder="默认记录套餐名称，可临时修改"></label>
    </div>
    <div id="prepaidUnifiedSummary" class="prepaid-unified-summary"></div>
    <div style="margin-top:10px"><b>本次附赠权益</b><small style="display:block;color:var(--muted);margin-top:3px">从预设自动带出，这一次可以临时增删改，不会改掉原预设。</small></div>
    <div id="prepaidUnifiedBenefits" class="prepaid-unified-benefits"></div>
    <div class="prepaid-unified-actions">
      <button id="prepaidUnifiedAddBenefit" class="btn soft" type="button">＋ 临时加权益</button>
      <button id="prepaidUnifiedApply" class="btn primary" type="button">确认添加预存</button>
    </div>
    <p class="prepaid-unified-note">发放后会同时更新老板余额、权益和两边流水，并记住来源预设。</p>`;
  bind();return true;
}

function presetBenefits(p){return Array.isArray(p?.bundled_benefits)?p.bundled_benefits.map(x=>{const isBalance=x.type==='balance'||(String(x.name||'').trim()==='赠送余额'&&String(x.unit||'').trim()==='元');return {type:isBalance?'balance':'benefit',name:isBalance?'赠送余额':(x.name||''),quantity:num(x.quantity||1),unit:isBalance?'元':(x.unit||'个'),expires_days:isBalance?'':(x.expires_days??'')}}):[]}
function renderSelectors(){
  const csel=$('prepaidUnifiedCustomer'),psel=$('prepaidUnifiedPreset');if(!csel||!psel)return;
  const currentShopId=ctx()?.shop?.id;
  const customers=state.customers.filter(c=>!currentShopId||c.shop_id===currentShopId);
  csel.innerHTML=customers.length?customers.map(c=>`<option value="${safe(c.id)}">${safe(c.name)}</option>`).join(''):'<option value="">还没有老板档案</option>';
  if(state.customerId&&customers.some(c=>c.id===state.customerId))csel.value=state.customerId;else state.customerId=csel.value||null;
  renderPresetOptions();
}
function renderPresetOptions(){
  const psel=$('prepaidUnifiedPreset');if(!psel)return;const c=currentCustomer();
  const rows=state.presets.filter(p=>p.is_active!==false&&p.preset_type==='prepaid'&&(!c||p.shop_id===c.shop_id));
  psel.innerHTML=rows.length?rows.map(p=>`<option value="${safe(p.id)}">${safe(p.name)} · ${money(p.amount)}</option>`).join(''):'<option value="">这个店还没有预存预设</option>';
  if(state.presetId&&rows.some(p=>p.id===state.presetId))psel.value=state.presetId;else state.presetId=psel.value||null;
  applyPresetDraft();
}
function applyPresetDraft(){
  const p=currentPreset();
  if(!p){state.benefits=[];if($('prepaidUnifiedAmount'))$('prepaidUnifiedAmount').value='';if($('prepaidUnifiedNote'))$('prepaidUnifiedNote').value='';renderBenefits();renderSummary();return}
  $('prepaidUnifiedAmount').value=num(p.amount).toFixed(2);$('prepaidUnifiedNote').value=p.note||p.name||'';state.benefits=presetBenefits(p);renderBenefits();renderSummary();
}
function readBenefits(){
  return [...document.querySelectorAll('#prepaidUnifiedBenefits [data-u-benefit-row]')].map(row=>{
    const index=Number(row.dataset.uBenefitRow);
    const prior=state.benefits[index]||{};
    const name=(row.querySelector('[data-u-field="name"]')?.value||'').trim();
    const quantity=num(row.querySelector('[data-u-field="quantity"]')?.value);
    const unit=(row.querySelector('[data-u-field="unit"]')?.value||'个').trim()||'个';
    const days=(row.querySelector('[data-u-field="days"]')?.value||'').trim();
    const isBalance=prior.type==='balance'||name==='赠送余额'||(unit==='元'&&/余额/.test(name));
    return {type:isBalance?'balance':'benefit',name:isBalance?'赠送余额':name,quantity,unit:isBalance?'元':unit,expires_days:isBalance?null:(days?Number(days):null)};
  }).filter(x=>x.name&&x.quantity>0);
}
function renderBenefits(){
  const box=$('prepaidUnifiedBenefits');if(!box)return;
  box.innerHTML=state.benefits.length?state.benefits.map((b,i)=>`<div class="prepaid-unified-benefit" data-u-benefit-row="${i}"><label class="benefit-name">权益名称<input data-u-field="name" value="${safe(b.name)}"></label><label>数量<input data-u-field="quantity" type="number" min="0" step="0.01" value="${safe(b.quantity)}"></label><label>单位<input data-u-field="unit" value="${safe(b.unit||'个')}"></label><label>有效天数<input data-u-field="days" type="number" min="1" step="1" value="${safe(b.expires_days??'')}" placeholder="长期"></label><button class="tiny-btn danger" data-u-remove="${i}" type="button">删除</button></div>`).join(''):'<div class="empty-state">这个预设没有附赠权益。也可以临时添加。</div>';
}
function renderSummary(){
  const c=currentCustomer(),box=$('prepaidUnifiedSummary');if(!box)return;const amount=num($('prepaidUnifiedAmount')?.value);const gift=(state.benefits||[]).filter(x=>x?.type==='balance'||String(x?.name||'').trim()==='赠送余额'||(String(x?.unit||'').trim()==='元'&&/余额/.test(String(x?.name||'')))).reduce((sum,x)=>sum+num(x?.quantity),0);const before=num(c?.prepaid_balance)+num(c?.gift_balance);const added=Math.max(0,amount)+Math.max(0,gift);const after=before+added;
  box.innerHTML=`<div class="prepaid-unified-stat"><span>当前余额</span><b>${money(before)}</b></div><div class="prepaid-unified-stat"><span>本次到账</span><b>${money(added)}</b></div><div class="prepaid-unified-stat"><span>添加后余额</span><b>${money(after)}</b></div>`;
}

async function load(){
  const s=supabase();if(!s)return;
  try{
    const [customers,presets]=await Promise.all([
      query(s.from('customers').select('id,name,shop_id,prepaid_balance,gift_balance').order('name'),'customers'),
      query(s.from('wallet_presets').select('*').eq('preset_type','prepaid').order('sort_order').order('created_at'),'presets')
    ]);
    state.customers=customers;state.presets=presets;renderSelectors();
  }catch(e){console.warn('unified prepaid load failed',e);toast('预存资料读取失败，请点进预存页重试')}
}

async function apply(){
  if(busy)return;const c=currentCustomer(),p=currentPreset(),amount=num($('prepaidUnifiedAmount')?.value);
  if(!c)return toast('先选择老板');if(!p)return toast('先选择预存预设');if(!(amount>0))return toast('预存金额要大于 0');
  const benefits=readBenefits().map(x=>{const isGift=x.type==='balance'||String(x.name||'').trim()==='赠送余额'||(String(x.unit||'').trim()==='元'&&/余额/.test(String(x.name||'')));return isGift?{...x,type:'balance',name:'赠送余额',unit:'元',expires_days:null}:x});
  const giftAmount=benefits.filter(x=>x.type==='balance').reduce((sum,x)=>sum+num(x.quantity),0);
  if(!confirm(`给「${c.name}」添加 ${money(amount)} 预存？${giftAmount>0?`\n赠送余额：${money(giftAmount)}\n实际到账：${money(amount+giftAmount)}`:''}\n来源预设：${p.name}${benefits.length?`\n附赠权益：${benefits.length} 项`:''}`))return;
  busy=true;$('prepaidUnifiedApply').disabled=true;
  try{
    const result=await rpc('apply_custom_prepaid_package_with_gift',{p_customer_id:c.id,p_preset_id:p.id,p_amount:amount,p_benefits:benefits,p_note:$('prepaidUnifiedNote')?.value.trim()||null});
    if(result?.balance_after!=null)c.prepaid_balance=result.balance_after;
    if(result?.gift_result?.balance_after!=null)c.gift_balance=result.gift_result.balance_after;
    renderSummary();
    document.getElementById('prepaidSafeRefresh')?.click();
    window.dispatchEvent(new CustomEvent('paimini:prepaid-updated',{detail:{customerId:c.id,balance:num(c.prepaid_balance)+num(c.gift_balance)}}));
    toast('已添加预存 ♡');
  }catch(e){console.warn('custom prepaid issue failed',e);toast(String(e?.message||e).includes('apply_custom_prepaid_package')?'请先运行最新预存 SQL':'添加预存失败：'+String(e?.message||e))}
  finally{busy=false;$('prepaidUnifiedApply').disabled=false}
}

function bind(){
  $('prepaidUnifiedCustomer')?.addEventListener('change',()=>{state.customerId=$('prepaidUnifiedCustomer').value||null;renderPresetOptions()});
  $('prepaidUnifiedPreset')?.addEventListener('change',()=>{state.presetId=$('prepaidUnifiedPreset').value||null;applyPresetDraft()});
  $('prepaidUnifiedAmount')?.addEventListener('input',renderSummary);
  $('prepaidUnifiedAddBenefit')?.addEventListener('click',()=>{state.benefits=readBenefits();state.benefits.push({name:'',quantity:1,unit:'个',expires_days:''});renderBenefits()});
  $('prepaidUnifiedBenefits')?.addEventListener('input',()=>{state.benefits=readBenefits();renderSummary()});
  $('prepaidUnifiedBenefits')?.addEventListener('click',e=>{const b=e.target.closest('[data-u-remove]');if(!b)return;state.benefits=readBenefits();state.benefits.splice(Number(b.dataset.uRemove),1);renderBenefits()});
  $('prepaidUnifiedApply')?.addEventListener('click',apply);
  window.addEventListener('paimini:prepaid-presets-updated',()=>void load());
  // 初次进入由 initPrepaidUnifiedSafe() 的 load() 负责；预设变化由 prepaid-presets-updated 负责刷新，避免点进页面重复请求。
}

export async function initPrepaidUnifiedSafe(){
  if(started)return;started=true;ensureStyle();cleanPresetCopy();if(!mount()){started=false;throw new Error('prepaid page not ready')}await load();
}

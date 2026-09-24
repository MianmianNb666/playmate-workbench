// PaiMini 预存套餐预设。只在“预存”页面点开后加载。
// 复用核心 Supabase；不参与核心启动；不改派单保存逻辑。

let started=false;
let busy=false;
const $=id=>document.getElementById(id);
const TIMEOUT_MS=16000;
const state={presets:[],shops:[],shopId:null,benefits:[]};

function ctx(){try{return window.paiMiniOrderBridge?.getContext?.()||null}catch{return null}}
function supabase(){return ctx()?.supabase||null}
function toast(message){window.paiMiniOrderBridge?.toast?.(message)}
function safe(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function deadline(label){return new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timeout')),TIMEOUT_MS))}
async function query(promise,label){const r=await Promise.race([promise,deadline(label)]);if(r?.error)throw r.error;return r?.data||[]}
async function rpc(name,args){const s=supabase();if(!s)throw new Error('CORE_SUPABASE_NOT_READY');const r=await Promise.race([s.rpc(name,args),deadline(name)]);if(r?.error)throw r.error;return r?.data}

function ensureStyle(){
  if($('prepaidPresetSafeStyle'))return;
  const style=document.createElement('style');style.id='prepaidPresetSafeStyle';style.textContent=`
  .preset-safe-card{margin-top:14px}.preset-safe-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.preset-safe-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.preset-safe-form .wide{grid-column:1/-1}
  .preset-benefit-row{display:grid;grid-template-columns:2fr .8fr .8fr 1fr auto;gap:7px;align-items:end;margin-top:7px}.preset-safe-list{display:grid;gap:8px}.preset-safe-item{border:1px solid var(--line);border-radius:14px;padding:11px}.preset-safe-item-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.preset-safe-item p{margin:5px 0 0;color:var(--muted);font-size:11px;line-height:1.5}.preset-safe-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
  @media(max-width:850px){.preset-safe-grid{grid-template-columns:1fr}}@media(max-width:620px){.preset-safe-form{grid-template-columns:1fr}.preset-safe-form .wide{grid-column:auto}.preset-benefit-row{grid-template-columns:1fr 1fr}.preset-benefit-row .benefit-name{grid-column:1/-1}}
  `;document.head.appendChild(style);
}

function newBenefitDraft(){return {type:'benefit',name:'',quantity:1,unit:'个',expires_days:''}}
function renderBenefitRows(){
  const wrap=$('presetBenefitRows');if(!wrap)return;
  if(!state.benefits.length)state.benefits=[newBenefitDraft()];
  wrap.innerHTML=state.benefits.map((b,i)=>{
    const isBalance=b.type==='balance';
    return `
    <div class="preset-benefit-row" data-benefit-index="${i}">
      <label>类型<select data-benefit-field="type"><option value="benefit" ${!isBalance?'selected':''}>普通权益</option><option value="balance" ${isBalance?'selected':''}>赠送余额</option></select></label>
      ${isBalance
        ? `<label class="benefit-name">赠送金额<input data-benefit-field="quantity" type="number" min="0" step="0.01" value="${safe(b.quantity)}" placeholder="例如 100"></label><input data-benefit-field="name" type="hidden" value="赠送余额"><input data-benefit-field="unit" type="hidden" value="元"><input data-benefit-field="expires_days" type="hidden" value="">`
        : `<label class="benefit-name">权益名称<input data-benefit-field="name" value="${safe(b.name)}" placeholder="例如 赠送时长"></label><label>数量<input data-benefit-field="quantity" type="number" min="0" step="0.01" value="${safe(b.quantity)}"></label><label>单位<input data-benefit-field="unit" value="${safe(b.unit||'个')}" placeholder="次 / 分钟"></label><label>有效天数<input data-benefit-field="expires_days" type="number" min="1" step="1" value="${safe(b.expires_days)}" placeholder="留空=长期"></label>`}
      <button class="tiny-btn danger" data-remove-benefit="${i}" type="button">删除</button>
    </div>`;
  }).join('');
}
function mount(){
  const mount=$('prepaidPageMount');if(!mount)return false;
  let card=$('prepaidPresetSafeCard');
  if(!card){card=document.createElement('div');card.id='prepaidPresetSafeCard';card.className='card preset-safe-card';mount.appendChild(card)}
  card.innerHTML=`
    <div class="card-title"><div><b>预存套餐预设 ♡</b><small>先把常用预存金额和赠送权益设好，之后一键发给老板</small></div></div>
    <div class="preset-safe-grid">
      <div>
        <div class="preset-safe-form">
          <label>店铺<select id="presetShop"></select></label>
          <label>套餐名称<input id="presetName" placeholder="例如 充500送2小时"></label>
          <label>预存金额<input id="presetAmount" type="number" min="0" step="0.01" placeholder="500"></label>
          <label>排序<input id="presetSort" type="number" step="1" value="0"></label>
          <label class="wide">备注<input id="presetNote" maxlength="160" placeholder="可选"></label>
        </div>
        <div style="margin-top:12px"><b>附赠权益</b><small style="display:block;color:var(--muted);margin-top:3px">一个套餐可以带多项权益，不需要权益就删空。</small></div>
        <div id="presetBenefitRows"></div>
        <div class="preset-safe-actions">
          <button id="presetAddBenefit" class="btn soft" type="button">＋ 添加权益</button>
          <button id="presetSave" class="btn primary" type="button">保存预设</button>
        </div>
      </div>
      <div>
        <div class="card-title"><div><b>已有预设</b><small>选好老板后可以直接发放</small></div></div>
        <div id="presetList" class="preset-safe-list"></div>
      </div>
    </div>`;
  bind();return true;
}

function renderShopOptions(){
  const s=$('presetShop');if(!s)return;
  const core=ctx();const uid=core?.state?.session?.user?.id;
  state.shops=(core?.state?.shops||[]).filter(shop=>shop.user_id===uid);
  state.shopId=state.shopId&&state.shops.some(x=>x.id===state.shopId)?state.shopId:(core?.shop?.id&&state.shops.some(x=>x.id===core.shop.id)?core.shop.id:state.shops[0]?.id||null);
  s.innerHTML=state.shops.length?state.shops.map(x=>`<option value="${safe(x.id)}">${safe(x.name)}</option>`).join(''):'<option value="">还没有自己的店铺</option>';
  if(state.shopId)s.value=state.shopId;
}

function presetBenefitsText(p){
  const arr=Array.isArray(p.bundled_benefits)?p.bundled_benefits:[];
  if(!arr.length)return '无附赠权益';
  return arr.map(x=>`${x.name||'权益'} × ${x.quantity||1} ${x.unit||'个'}${x.expires_days?` · ${x.expires_days}天`:''}`).join('；');
}
function renderList(){
  const list=$('presetList');if(!list)return;
  const rows=state.presets.filter(x=>x.shop_id===state.shopId&&x.preset_type==='prepaid');
  list.innerHTML=rows.length?rows.map(p=>`
    <div class="preset-safe-item">
      <div class="preset-safe-item-head"><div><b>${safe(p.name)}</b><p>预存 ¥${num(p.amount).toFixed(2)}</p></div><span class="status-tag ${p.is_active===false?'off':''}">${p.is_active===false?'已停用':'启用中'}</span></div>
      <p>${safe(presetBenefitsText(p))}${p.note?`<br>${safe(p.note)}`:''}</p>
      <div class="preset-safe-actions">
        <button class="tiny-btn" data-apply-preset="${safe(p.id)}" type="button" ${p.is_active===false?'disabled':''}>发给当前老板</button>
        <button class="tiny-btn" data-toggle-preset="${safe(p.id)}" type="button">${p.is_active===false?'启用':'停用'}</button>
        <button class="tiny-btn danger" data-delete-preset="${safe(p.id)}" type="button">删除</button>
      </div>
    </div>`).join(''):'<div class="empty-state">这个店还没有预存套餐预设。</div>';
}

async function loadPresets(){
  const s=supabase();if(!s)return;
  try{
    state.presets=await query(s.from('wallet_presets').select('*').order('sort_order').order('created_at'),'wallet presets');
    renderList();
    window.dispatchEvent(new CustomEvent('paimini:prepaid-presets-updated'));
  }catch(e){console.warn('preset load failed',e);toast('预存套餐读取失败')}
}

function readBenefitDrafts(){
  const rows=[...document.querySelectorAll('[data-benefit-index]')];
  return rows.map(row=>{
    const type=row.querySelector('[data-benefit-field="type"]')?.value||'benefit';
    const quantity=num(row.querySelector('[data-benefit-field="quantity"]')?.value||0);
    if(type==='balance')return quantity>0?{type:'balance',name:'赠送余额',quantity,unit:'元',expires_days:null}:null;
    const name=(row.querySelector('[data-benefit-field="name"]')?.value||'').trim();
    const unit=(row.querySelector('[data-benefit-field="unit"]')?.value||'个').trim()||'个';
    const days=(row.querySelector('[data-benefit-field="expires_days"]')?.value||'').trim();
    return name&&quantity>0?{type:'benefit',name,quantity,unit,expires_days:days?Number(days):null}:null;
  }).filter(Boolean);
}
async function savePreset(){
  if(busy)return;const s=supabase();const name=$('presetName')?.value.trim();const amount=num($('presetAmount')?.value);const shopId=$('presetShop')?.value;
  if(!s||!shopId){toast('先选择店铺');return}if(!name){toast('先填写套餐名称');return}if(!(amount>0)){toast('预存金额要大于 0');return}
  busy=true;$('presetSave').disabled=true;
  try{
    const payload={shop_id:shopId,preset_type:'prepaid',name,amount,bundled_benefits:readBenefitDrafts(),note:$('presetNote')?.value.trim()||null,sort_order:Number($('presetSort')?.value||0),is_active:true};
    const r=await Promise.race([s.from('wallet_presets').insert(payload),deadline('save preset')]);if(r?.error)throw r.error;
    $('presetName').value='';$('presetAmount').value='';$('presetNote').value='';$('presetSort').value='0';state.benefits=[newBenefitDraft()];renderBenefitRows();await loadPresets();toast('预存套餐已保存 ♡');
  }catch(e){console.warn('preset save failed',e);toast('保存预设失败：'+String(e?.message||e))}finally{busy=false;$('presetSave').disabled=false}
}

async function applyPreset(id){
  if(busy)return;const customerId=$('prepaidSafeCustomer')?.value;if(!customerId){toast('先在上面选择老板');return}
  const p=state.presets.find(x=>x.id===id);if(!p)return;
  if(!confirm(`给当前老板发放「${p.name}」？\n预存：¥${num(p.amount).toFixed(2)}\n${presetBenefitsText(p)}`))return;
  busy=true;
  try{await rpc('apply_prepaid_package',{p_customer_id:customerId,p_preset_id:id});toast('预存套餐已发放 ♡');document.getElementById('prepaidSafeRefresh')?.click()}catch(e){console.warn('apply preset failed',e);toast('发放失败：'+String(e?.message||e))}finally{busy=false}
}
async function togglePreset(id){const s=supabase(),p=state.presets.find(x=>x.id===id);if(!s||!p)return;const r=await s.from('wallet_presets').update({is_active:!p.is_active}).eq('id',id);if(r.error){toast('更新失败');return}await loadPresets()}
async function deletePreset(id){if(!confirm('删除这个预存套餐预设？已产生的历史流水不会删除。'))return;const s=supabase();const r=await s.from('wallet_presets').delete().eq('id',id);if(r.error){toast('删除失败：'+r.error.message);return}await loadPresets()}

function bind(){
  $('presetShop')?.addEventListener('change',()=>{state.shopId=$('presetShop').value||null;renderList()});
  $('presetAddBenefit')?.addEventListener('click',()=>{state.benefits=readBenefitDrafts();state.benefits.push(newBenefitDraft());renderBenefitRows()});
  $('presetBenefitRows')?.addEventListener('change',e=>{const t=e.target.closest('[data-benefit-field="type"]');if(!t)return;state.benefits=readBenefitDrafts();const i=Number(t.closest('[data-benefit-index]')?.dataset.benefitIndex);state.benefits[i]=t.value==='balance'?{type:'balance',name:'赠送余额',quantity:100,unit:'元',expires_days:''}:newBenefitDraft();renderBenefitRows()});
  $('presetBenefitRows')?.addEventListener('click',e=>{const b=e.target.closest('[data-remove-benefit]');if(!b)return;state.benefits=readBenefitDrafts();state.benefits.splice(Number(b.dataset.removeBenefit),1);renderBenefitRows()});
  $('presetSave')?.addEventListener('click',savePreset);
  $('presetList')?.addEventListener('click',e=>{const a=e.target.closest('[data-apply-preset]');const t=e.target.closest('[data-toggle-preset]');const d=e.target.closest('[data-delete-preset]');if(a)applyPreset(a.dataset.applyPreset);if(t)togglePreset(t.dataset.togglePreset);if(d)deletePreset(d.dataset.deletePreset)});
}

export async function initPrepaidPresetsSafe(){
  if(started)return;started=true;ensureStyle();if(!mount()){started=false;throw new Error('prepaid page not ready')}
  renderShopOptions();state.benefits=[newBenefitDraft()];renderBenefitRows();await loadPresets();
}

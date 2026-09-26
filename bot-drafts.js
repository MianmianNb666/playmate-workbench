let drafts=[];
let initialized=false;
let loading=false;

const $=id=>document.getElementById(id);

function bridge(){
  return window.paiMiniOrderBridge||null;
}

function isMissingRobotTable(error){
  const code=String(error?.code||"");
  const msg=String(error?.message||error||"").toLowerCase();
  return code==="42P01" || code==="PGRST205" || msg.includes("bot_drafts") && (msg.includes("does not exist") || msg.includes("schema cache"));
}

function setCardVisible(visible){
  $("botDraftCard")?.classList.toggle("hidden",!visible);
}

function getDraftItemMatch(draft){
  const api=bridge();
  const {state}=api?.getContext?.()||{};
  const itemName=String(draft?.item_name||"").trim().toLowerCase();
  if(!itemName) return {kind:"missing",label:"⚠️ 未识别项目，请手动选择价格"};

  const activeItems=(state?.items||[]).filter(item=>item.is_active!==false);
  const matches=activeItems.filter(item=>
    String(item.name||"").trim().toLowerCase()===itemName
  );

  if(matches.length===1){
    const item=matches[0];
    const price=Number(item.unit_price||0);
    const unit=item.unit_label||"次";
    return {
      kind:"matched",
      label:`✓ 已匹配价格表 · ¥${price.toFixed(2)} / ${unit}`
    };
  }

  if(matches.length>1){
    return {kind:"ambiguous",label:"⚠️ 找到多个同名项目，请手动选择价格"};
  }

  return {kind:"missing",label:"⚠️ 项目未匹配价格表，请手动选择价格"};
}

function render(){
  const list=$("botDraftList");
  const empty=$("botDraftEmpty");
  const count=$("botDraftCount");
  if(!list||!empty) return;

  if(count) count.textContent=String(drafts.length);
  empty.classList.toggle("hidden",drafts.length>0);

  list.innerHTML=drafts.map(draft=>{
    const customer=draft.customer_name||"未填老板";
    const companion=draft.companion_name||"未填陪陪";
    const measure=draft.measure||"未填时长/数量";
    const source=draft.source_channel_name||"机器人消息";
    const total=Number.isFinite(Number(draft.expected_total))
      ? ` · 预计 ¥${Number(draft.expected_total).toFixed(2)}`
      : "";
    const itemMatch=getDraftItemMatch(draft);
    return `
      <div class="bot-draft-row" data-bot-draft-row="${draft.id}">
        <div class="bot-draft-main">
          <div class="bot-draft-title">
            <b>${escapeHtml(customer)}｜${escapeHtml(draft.item_name||"未识别项目")}｜${escapeHtml(measure)}${total}</b>
            <span>待载入</span>
          </div>
          <p>陪陪：${escapeHtml(companion)} · 来源：${escapeHtml(source)}</p>
          <div class="bot-draft-match bot-draft-match-${itemMatch.kind}">${escapeHtml(itemMatch.label)}</div>
          ${draft.raw_message?`<small>原消息：${escapeHtml(draft.raw_message)}</small>`:""}
        </div>
        <div class="bot-draft-actions">
          <button class="btn primary" type="button" data-bot-load="${draft.id}">载入计算器</button>
          <button class="btn ghost" type="button" data-bot-ignore="${draft.id}">忽略</button>
        </div>
      </div>
    `;
  }).join("");
}

function escapeHtml(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

export async function refreshBotDrafts({silent=false}={}){
  if(loading) return;
  const api=bridge();
  const card=$("botDraftCard");
  if(!api||!card) return;

  const {supabase,state,shop}=api.getContext();
  if(!supabase||!state?.session?.user?.id||!shop?.id){
    drafts=[];
    render();
    setCardVisible(false);
    return;
  }

  loading=true;
  $("refreshBotDraftsBtn")?.setAttribute("disabled","disabled");
  try{
    const {data,error}=await supabase
      .from("bot_drafts")
      .select("*")
      .eq("owner_user_id",state.session.user.id)
      .eq("shop_id",shop.id)
      .eq("status","pending")
      .order("created_at",{ascending:false})
      .limit(30);

    if(error){
      if(isMissingRobotTable(error)){
        drafts=[];
        render();
        setCardVisible(false);
        return;
      }
      throw error;
    }

    drafts=data||[];
    setCardVisible(true);
    render();
  }catch(error){
    console.error("robot drafts load failed",error);
    if(!silent) api.toast?.("机器人草稿读取失败，请稍后重试");
  }finally{
    loading=false;
    $("refreshBotDraftsBtn")?.removeAttribute("disabled");
  }
}

async function markDraft(id,status){
  const api=bridge();
  const draft=drafts.find(x=>x.id===id);
  if(!api||!draft) return;

  const {supabase}=api.getContext();
  const patch={status};
  if(status==="loaded") patch.loaded_at=new Date().toISOString();
  if(status==="ignored") patch.ignored_at=new Date().toISOString();

  const {error}=await supabase
    .from("bot_drafts")
    .update(patch)
    .eq("id",id);

  if(error) throw error;
  drafts=drafts.filter(x=>x.id!==id);
  render();
}

async function loadDraft(id){
  const api=bridge();
  const draft=drafts.find(x=>x.id===id);
  if(!api||!draft) return;

  try{
    const result=await api.loadRobotDraftIntoCalculator?.(draft);
    if(!result?.ok) return;

    try{
      await markDraft(id,"loaded");
    }catch(error){
      console.error("robot draft status update failed",error);
      api.toast?.("已载入计算器，但草稿状态更新失败");
      return;
    }

    if(result.ambiguous){
      api.toast?.("已带入基础信息，同名项目有多个，请手动选项目");
    }else if(!result.matched){
      api.toast?.("已带入基础信息，项目未匹配，请手动选价格");
    }else if(result.autoAdded && result.customerMatched){
      api.toast?.("已匹配老板预存，并自动加入本单项目 ♡");
    }else if(result.autoAdded){
      api.toast?.("项目已自动加入本单，老板可继续确认 ♡");
    }else{
      api.toast?.("机器人草稿已载入计算器 ♡");
    }
  }catch(error){
    console.error("robot draft load failed",error);
    api.toast?.("载入机器人草稿失败："+(error?.message||"未知错误"));
  }
}

async function ignoreDraft(id){
  const api=bridge();
  try{
    await markDraft(id,"ignored");
    api?.toast?.("已忽略这条机器人草稿");
  }catch(error){
    console.error("robot draft ignore failed",error);
    api?.toast?.("忽略失败："+(error?.message||"未知错误"));
  }
}

function bind(){
  $("refreshBotDraftsBtn")?.addEventListener("click",()=>refreshBotDrafts());
  $("botDraftList")?.addEventListener("click",event=>{
    const load=event.target.closest("[data-bot-load]");
    if(load){
      loadDraft(load.dataset.botLoad);
      return;
    }
    const ignore=event.target.closest("[data-bot-ignore]");
    if(ignore) ignoreDraft(ignore.dataset.botIgnore);
  });

  window.addEventListener("paimini:shop-changed",()=>refreshBotDrafts({silent:true}));
}

export function initBotDrafts(){
  if(initialized) return refreshBotDrafts({silent:true});
  initialized=true;
  bind();
  return refreshBotDrafts({silent:true});
}

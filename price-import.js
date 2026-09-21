import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const $=(id)=>document.getElementById(id);

const state={
  file:null,
  objectUrl:null,
  rows:[],
  session:null,
  currentShop:null
};

function notify(message){
  const el=$("toast");
  if(!el){alert(message);return}
  el.textContent=message;
  el.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer=setTimeout(()=>el.classList.remove("show"),2400);
}

function safe(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function currentShopId(){
  return $("calcShop")?.value || null;
}

async function refreshOwnership(){
  const shopId=currentShopId();
  const btn=$("importRecognizedPricesBtn");
  const recognizeBtn=$("recognizePriceImageBtn");
  if(!shopId||!state.session){
    state.currentShop=null;
    if(btn) btn.disabled=true;
    return false;
  }
  const {data,error}=await supabase.from("shops").select("*").eq("id",shopId).maybeSingle();
  if(error||!data){
    state.currentShop=null;
    if(btn) btn.disabled=true;
    return false;
  }
  state.currentShop=data;
  const owns=data.user_id===state.session.user.id;
  if(recognizeBtn){
    recognizeBtn.title=owns?"":"共享店铺的价格表只能由创建者修改";
  }
  updateImportButton();
  return owns;
}

function updateImportButton(){
  const btn=$("importRecognizedPricesBtn");
  if(!btn) return;
  const owns=!!state.currentShop && !!state.session && state.currentShop.user_id===state.session.user.id;
  btn.disabled=!owns || state.rows.length===0;
  btn.textContent=owns
    ? "确认导入当前店铺"
    : "共享价格表仅店铺创建者可导入";
}

function loadScript(src){
  return new Promise((resolve,reject)=>{
    if(window.Tesseract){resolve();return}
    const existing=document.querySelector('script[data-price-ocr="1"]');
    if(existing){
      existing.addEventListener("load",resolve,{once:true});
      existing.addEventListener("error",reject,{once:true});
      return;
    }
    const script=document.createElement("script");
    script.src=src;
    script.async=true;
    script.dataset.priceOcr="1";
    script.onload=resolve;
    script.onerror=()=>reject(new Error("OCR 组件加载失败"));
    document.head.appendChild(script);
  });
}

function setProgress(progress,text){
  const wrap=$("ocrProgressWrap");
  const bar=$("ocrProgressBar");
  const label=$("ocrProgressText");
  wrap?.classList.remove("hidden");
  if(bar) bar.style.width=Math.round(Math.max(0,Math.min(1,progress))*100)+"%";
  if(label) label.textContent=text;
}

function normalizeUnit(raw){
  let value=String(raw||"").trim().toLowerCase().replaceAll(" ","");
  if(!value) return {unitLabel:"次",unitMinutes:null};

  value=value
    .replace(/^\/+|\/+$/g,"")
    .replace(/^每/,"");

  // OCR 常把 0.5h 看成 o5h / 05h。
  if(value==="o5h"||value==="05h"||value===".5h") value="0.5h";

  if(["半","半小时","0.5h","0.5hr"].includes(value)){
    return {unitLabel:"半",unitMinutes:30};
  }
  if(["h","hr","hrs","hour","小时","时"].includes(value)){
    return {unitLabel:"小时",unitMinutes:60};
  }
  if(["m","min","mins","分钟","分"].includes(value)){
    return {unitLabel:"分钟",unitMinutes:1};
  }

  const minMatch=value.match(/^(\d+(?:\.\d+)?)(?:分钟|分|min|mins)$/i);
  if(minMatch){
    const minutes=Number(minMatch[1]);
    return {unitLabel:minutes+"分钟",unitMinutes:minutes};
  }

  if(["局","次","首","把","单","份","个"].includes(value)){
    return {unitLabel:value,unitMinutes:null};
  }

  return {unitLabel:raw||"次",unitMinutes:null};
}

function cleanLine(line){
  return String(line||"")
    .replace(/[｜|]/g," ")
    .replace(/[：:]/g," ")
    .replace(/[￥]/g,"¥")
    .replace(/[／]/g,"/")
    .replace(/[，,；;]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function parsePriceToken(rawToken){
  let token=String(rawToken||"")
    .trim()
    .toLowerCase()
    .replace(/[¥￥]/g,"")
    .replace(/元/g,"")
    .replace(/\s+/g,"");

  if(!token || !/\d/.test(token)) return null;

  // 美工价目表 OCR 常见误识别：
  // 25r0.5h / 40ro5h / 30rh / 15r10min
  if(/^[0-9.r\/hmings]+$/i.test(token)){
    token=token.replace(/o/g,"0");
  }
  token=token
    .replace(/r0?5h$/i,"r0.5h")
    .replace(/\/0?5h$/i,"/0.5h");

  const match=token.match(/^(\d+(?:\.\d+)?)(?:r|\/)?(.*)$/i);
  if(!match) return null;

  const price=Number(match[1]);
  if(!Number.isFinite(price)) return null;

  let rawUnit=String(match[2]||"")
    .replace(/^\/+|\/+$/g,"")
    .trim();

  const normalized=normalizeUnit(rawUnit||"次");
  return {
    price,
    unitLabel:normalized.unitLabel,
    unitMinutes:normalized.unitMinutes,
    raw:rawToken
  };
}

function extractPriceTokens(line){
  const cleaned=cleanLine(line);
  if(!cleaned) return [];

  // 先按空格拆。大多数价目表 OCR 会把每个价格块保留成独立 token。
  const chunks=cleaned.split(/\s+/).filter(Boolean);
  const parsed=chunks
    .map(parsePriceToken)
    .filter(Boolean);

  // 至少一半 chunk 看起来是价格，才把这一整行当作“价格行”。
  if(parsed.length && parsed.length>=Math.ceil(chunks.length/2)){
    return parsed;
  }

  return [];
}

function chineseWordSegments(text){
  const joined=String(text||"")
    .replace(/[【】\[\]（）()「」『』]/g,"")
    .replace(/\s+/g,"")
    .trim();

  if(!joined) return [];

  try{
    if(Intl?.Segmenter){
      const segmenter=new Intl.Segmenter("zh-CN",{granularity:"word"});
      const words=[...segmenter.segment(joined)]
        .filter(part=>part.isWordLike)
        .map(part=>part.segment)
        .filter(Boolean);
      if(words.length) return words;
    }
  }catch{}

  return [...joined];
}

function partitionWords(words,count){
  if(count<=0) return [];
  if(count===1) return [words.join("")];
  if(words.length===count) return words.slice();
  if(words.length<count) return [];

  const result=[];
  let index=0;

  for(let groupIndex=0;groupIndex<count;groupIndex++){
    const groupsLeft=count-groupIndex;
    const wordsLeft=words.length-index;

    if(groupsLeft===1){
      result.push(words.slice(index).join(""));
      break;
    }

    const totalChars=words.slice(index).reduce((sum,w)=>sum+w.length,0);
    const target=totalChars/groupsLeft;
    const mustLeave=groupsLeft-1;

    let group="";
    while(index<words.length-mustLeave){
      const next=words[index];
      if(!group){
        group+=next;
        index++;
        continue;
      }

      const nowDiff=Math.abs(group.length-target);
      const nextDiff=Math.abs(group.length+next.length-target);

      if(nextDiff<=nowDiff){
        group+=next;
        index++;
      }else{
        break;
      }
    }
    result.push(group);
  }

  return result.length===count ? result : [];
}

function splitNamesForCount(nameLine,count){
  if(count<=0) return [];

  const cleaned=cleanLine(nameLine)
    .replace(/[0-9¥￥]/g,"")
    .replace(/[·•—_+=]/g," ")
    .trim();

  if(!cleaned) return [];

  // OCR 没把汉字拆散时，优先尊重原来的空格。
  const rawTokens=cleaned.split(/\s+/).filter(Boolean);
  if(rawTokens.length===count){
    return rawTokens.map(x=>x.replace(/\s+/g,""));
  }

  const joined=rawTokens.join("");
  const words=chineseWordSegments(joined);
  const segmented=partitionWords(words,count);
  if(segmented.length===count) return segmented;

  // 最后兜底：如果字符数刚好能平均分，直接按字符切。
  const chars=[...joined];
  if(chars.length>=count && chars.length%count===0){
    const size=chars.length/count;
    return Array.from({length:count},(_,i)=>chars.slice(i*size,(i+1)*size).join(""));
  }

  if(count===1) return [joined];
  return [];
}

function parseNamedPriceLine(line){
  const cleaned=cleanLine(line);
  if(!cleaned) return null;

  const chunks=cleaned.split(/\s+/).filter(Boolean);
  if(chunks.length<2) return null;

  const price=parsePriceToken(chunks[chunks.length-1]);
  if(!price) return null;

  const name=chunks.slice(0,-1).join("").trim();
  if(!name || /\d/.test(name)) return null;

  return {
    category:"",
    name,
    price:price.price,
    unitLabel:price.unitLabel,
    unitMinutes:price.unitMinutes
  };
}

function parseOcrText(text){
  const lines=String(text||"")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  const rows=[];
  let pendingNameLine="";

  for(const line of lines){
    const direct=parseNamedPriceLine(line);
    if(direct){
      rows.push(direct);
      pendingNameLine="";
      continue;
    }

    const prices=extractPriceTokens(line);

    if(prices.length){
      if(pendingNameLine){
        const names=splitNamesForCount(pendingNameLine,prices.length);

        if(names.length===prices.length){
          names.forEach((name,index)=>{
            const price=prices[index];
            rows.push({
              category:"",
              name,
              price:price.price,
              unitLabel:price.unitLabel,
              unitMinutes:price.unitMinutes
            });
          });
        }
      }
      pendingNameLine="";
      continue;
    }

    // 不再把纯文字行当“分类”。它只是下一组项目名称。
    pendingNameLine=line;
  }

  const seen=new Set();
  return rows.filter(row=>{
    const key=[row.name,row.price,row.unitLabel].join("::").toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderRows(){
  const container=$("ocrRows");
  const empty=$("ocrEmpty");
  if(!container||!empty) return;

  empty.classList.toggle("hidden",state.rows.length>0);
  container.innerHTML=state.rows.map((row,index)=>`
    <div class="ocr-row" data-index="${index}">
      <label>分类（可空）
        <input data-field="category" value="${safe(row.category||"")}" placeholder="默认不分类">
      </label>
      <label>项目
        <input data-field="name" value="${safe(row.name)}">
      </label>
      <label>单价
        <input data-field="price" type="number" min="0" step="0.01" value="${safe(row.price)}">
      </label>
      <label>单位
        <input data-field="unitLabel" value="${safe(row.unitLabel)}">
      </label>
      <label>分钟/单位
        <input data-field="unitMinutes" type="number" min="0" step="1" value="${row.unitMinutes??""}" placeholder="可空">
      </label>
      <button class="ocr-row-remove" data-remove-row="${index}" type="button">×</button>
      <div class="ocr-row-note">识别结果仅作为草稿，确认后才会保存。</div>
    </div>
  `).join("");

  updateImportButton();
}

function clearImport(){
  state.file=null;
  state.rows=[];
  $("priceImageInput").value="";
  $("ocrRawText").value="";
  $("priceImagePreviewWrap").classList.add("hidden");
  $("ocrProgressWrap").classList.add("hidden");
  $("ocrProgressBar").style.width="0";
  if(state.objectUrl){
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl=null;
  }
  renderRows();
}

async function recognize(){
  const owns=await refreshOwnership();
  if(!owns){
    notify("这家店的共享价格表只能由创建者导入");
    return;
  }
  if(!state.file){
    notify("先选择一张价格表图片");
    return;
  }

  const btn=$("recognizePriceImageBtn");
  btn.disabled=true;
  btn.textContent="识别中…";
  setProgress(.02,"正在准备本地 OCR…");

  try{
    await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js");

    const result=await window.Tesseract.recognize(
      state.file,
      "chi_sim+eng",
      {
        logger(message){
          if(message.status==="recognizing text"){
            setProgress(message.progress||0,"正在识别文字 "+Math.round((message.progress||0)*100)+"%");
          }else{
            const labels={
              "loading tesseract core":"正在加载识别组件…",
              "initializing tesseract":"正在初始化…",
              "loading language traineddata":"正在加载中文识别模型…",
              "initializing api":"正在准备识别…"
            };
            if(labels[message.status]) setProgress(message.progress||.05,labels[message.status]);
          }
        }
      }
    );

    const text=result?.data?.text||"";
    $("ocrRawText").value=text;
    state.rows=parseOcrText(text);
    renderRows();
    setProgress(1,state.rows.length
      ? "识别完成，共整理出 "+state.rows.length+" 个项目。请先检查再导入。"
      : "文字识别完成，但没有自动整理出价格项目。可以修改右侧文字后点「重新整理文字」。"
    );
  }catch(error){
    console.error(error);
    setProgress(0,"识别失败");
    notify("识别失败："+error.message);
  }finally{
    btn.disabled=false;
    btn.textContent="开始识别";
  }
}

function reparse(){
  const text=$("ocrRawText").value;
  if(!text.trim()){
    notify("识别文字还是空的");
    return;
  }
  state.rows=parseOcrText(text);
  renderRows();
  notify(state.rows.length?"已经重新整理 ♡":"暂时没找到可识别的价格行");
}

async function importRows(){
  const owns=await refreshOwnership();
  if(!owns){
    notify("这家店的共享价格表只能由创建者修改");
    return;
  }

  const shopId=currentShopId();
  const validRows=state.rows.filter(row=>
    String(row.name||"").trim() &&
    Number.isFinite(Number(row.price)) &&
    Number(row.price)>=0
  );

  if(!shopId||!validRows.length){
    notify("没有可以导入的项目");
    return;
  }

  const {data:existingCategories,error:catError}=await supabase.from("price_categories")
    .select("*")
    .eq("shop_id",shopId);
  if(catError){notify("读取分类失败："+catError.message);return}

  const categoryMap=new Map(
    (existingCategories||[]).map(c=>[String(c.name||"").trim().toLowerCase(),c])
  );

  // 分类默认留空。只有用户自己在识别结果里填写了分类，才创建/匹配分类。
  const missingNames=[...new Set(
    validRows
      .map(r=>String(r.category||"").trim())
      .filter(Boolean)
      .filter(name=>!categoryMap.has(name.toLowerCase()))
  )];

  if(missingNames.length){
    const {data:newCats,error}=await supabase.from("price_categories")
      .insert(missingNames.map((name,index)=>({
        shop_id:shopId,
        name,
        sort_order:(existingCategories?.length||0)*10+(index+1)*10
      })))
      .select("*");
    if(error){notify("新增分类失败："+error.message);return}
    (newCats||[]).forEach(cat=>categoryMap.set(String(cat.name).trim().toLowerCase(),cat));
  }

  const {data:existingItems,error:itemError}=await supabase.from("price_items")
    .select("*")
    .eq("shop_id",shopId);
  if(itemError){notify("读取价格项目失败："+itemError.message);return}

  const existingByName=new Map(
    (existingItems||[]).map(item=>[String(item.name||"").trim().toLowerCase(),item])
  );
  const duplicates=validRows.filter(row=>existingByName.has(String(row.name).trim().toLowerCase()));

  if(duplicates.length){
    const names=[...new Set(duplicates.map(r=>r.name))].slice(0,6).join("、");
    const ok=confirm(
      "发现 "+duplicates.length+" 个同名项目（"+names+(duplicates.length>6?"…":"")+"）。\n\n继续会用识别结果更新这些项目的价格和单位，是否继续？"
    );
    if(!ok) return;
  }

  const importBtn=$("importRecognizedPricesBtn");
  importBtn.disabled=true;
  importBtn.textContent="正在导入…";

  try{
    let created=0;
    let updated=0;

    for(const row of validRows){
      const categoryName=String(row.category||"").trim();
      const category=categoryName
        ? categoryMap.get(categoryName.toLowerCase())
        : null;
      const normalized=normalizeUnit(row.unitLabel);
      const unitMinutes=row.unitMinutes===""||row.unitMinutes==null
        ? normalized.unitMinutes
        : Number(row.unitMinutes);

      const payload={
        shop_id:shopId,
        category_id:category?.id||null,
        name:String(row.name).trim(),
        unit_price:Number(row.price),
        unit_label:String(row.unitLabel||normalized.unitLabel||"次").trim(),
        unit_minutes:Number.isFinite(unitMinutes)?unitMinutes:null,
        is_active:true
      };

      const existing=existingByName.get(payload.name.toLowerCase());
      if(existing){
        const {error}=await supabase.from("price_items")
          .update(payload)
          .eq("id",existing.id);
        if(error) throw error;
        updated++;
      }else{
        const {data,error}=await supabase.from("price_items")
          .insert(payload)
          .select("*")
          .single();
        if(error) throw error;
        existingByName.set(payload.name.toLowerCase(),data);
        created++;
      }
    }

    notify("导入完成：新增 "+created+" 项，更新 "+updated+" 项 ♡");

    // 让原工作台重新读取当前店铺价格表，不上传或保存原图片。
    const shopSelect=$("calcShop");
    if(shopSelect){
      shopSelect.dispatchEvent(new Event("change",{bubbles:true}));
    }
  }catch(error){
    console.error(error);
    notify("导入失败："+error.message);
  }finally{
    updateImportButton();
  }
}

function bind(){
  $("priceImageInput")?.addEventListener("change",e=>{
    const file=e.target.files?.[0]||null;
    state.file=file;
    state.rows=[];
    $("ocrRawText").value="";
    renderRows();

    if(state.objectUrl){
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl=null;
    }

    if(file){
      state.objectUrl=URL.createObjectURL(file);
      $("priceImagePreview").src=state.objectUrl;
      $("priceImagePreviewWrap").classList.remove("hidden");
    }else{
      $("priceImagePreviewWrap").classList.add("hidden");
    }
  });

  $("recognizePriceImageBtn")?.addEventListener("click",recognize);
  $("clearPriceImageBtn")?.addEventListener("click",clearImport);
  $("reparseOcrBtn")?.addEventListener("click",reparse);
  $("importRecognizedPricesBtn")?.addEventListener("click",importRows);

  $("ocrRows")?.addEventListener("input",e=>{
    const rowEl=e.target.closest(".ocr-row");
    const field=e.target.dataset.field;
    if(!rowEl||!field) return;
    const index=Number(rowEl.dataset.index);
    if(!state.rows[index]) return;
    let value=e.target.value;
    if(field==="price") value=Number(value||0);
    if(field==="unitMinutes") value=value===""?null:Number(value);
    state.rows[index][field]=value;
  });

  $("ocrRows")?.addEventListener("click",e=>{
    const btn=e.target.closest("[data-remove-row]");
    if(!btn) return;
    state.rows.splice(Number(btn.dataset.removeRow),1);
    renderRows();
  });

  $("calcShop")?.addEventListener("change",()=>setTimeout(refreshOwnership,0));
}

bind();

const {data}=await supabase.auth.getSession();
state.session=data.session;
if(state.session){
  await refreshOwnership();
  setTimeout(refreshOwnership,700);
  setTimeout(refreshOwnership,1600);
}

const shopSelect=$("calcShop");
if(shopSelect){
  const observer=new MutationObserver(()=>refreshOwnership());
  observer.observe(shopSelect,{childList:true,subtree:true});
}

supabase.auth.onAuthStateChange(async(_event,session)=>{
  state.session=session;
  if(session) await refreshOwnership();
});

// PaiMini 预存页面布局整理：预存预设置顶，余额与权益合并为一个管理区。
// 只调整 DOM 排版，不发请求、不改保存逻辑。

function ensureStyle(){
  if(document.getElementById('prepaidLayoutPolishStyle')) return;
  const style=document.createElement('style');
  style.id='prepaidLayoutPolishStyle';
  style.textContent=`
    #prepaidPageMount{display:flex;flex-direction:column;gap:14px}
    #prepaidPresetSafeCard{order:0;margin-top:0}
    #prepaidManagerSafeCard{order:1;margin-top:0}
    .prepaid-combined-box{border:1px solid var(--line);border-radius:16px;padding:14px}
    .prepaid-combined-section+.prepaid-combined-section{margin-top:18px;padding-top:18px;border-top:1px dashed var(--line)}
    .prepaid-combined-section>h3{margin:0 0 4px}
    .prepaid-combined-section>p{margin:0 0 10px;color:var(--muted);font-size:11px;line-height:1.55}
  `;
  document.head.appendChild(style);
}

function combineManager(){
  const grid=document.querySelector('#prepaidManagerSafeCard .prepaid-safe-grid');
  if(!grid || grid.dataset.combined==='1') return;
  const boxes=[...grid.querySelectorAll(':scope > .prepaid-safe-box')];
  if(boxes.length<2) return;

  const combined=document.createElement('div');
  combined.className='prepaid-combined-box';

  boxes.forEach(box=>{
    const section=document.createElement('section');
    section.className='prepaid-combined-section';
    while(box.firstChild) section.appendChild(box.firstChild);
    combined.appendChild(section);
    box.remove();
  });

  grid.innerHTML='';
  grid.appendChild(combined);
  grid.style.display='block';
  grid.dataset.combined='1';
}

function movePresetToTop(){
  const mount=document.getElementById('prepaidPageMount');
  const preset=document.getElementById('prepaidPresetSafeCard');
  if(mount && preset && mount.firstElementChild!==preset){
    mount.prepend(preset);
  }
}

export function applyPrepaidLayoutPolish(){
  ensureStyle();
  movePresetToTop();
  combineManager();
}

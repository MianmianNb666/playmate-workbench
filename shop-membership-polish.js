// PaiMini membership production copy polish.
// Presentation only: no RPCs, no auth reads, no writes.

function text(id,value){
  const el=document.getElementById(id);
  if(el) el.textContent=value;
}

export function polishShopMembershipUi(){
  const card=document.getElementById('shopMembershipShellCard');
  if(!card) return;

  const title=card.querySelector('.card-title b');
  const subtitle=card.querySelector('.card-title small');
  if(title) title.textContent='店铺成员 ♡';
  if(subtitle) subtitle.textContent='邀请成员加入店铺，一起使用共享价格表';

  const notes=[...card.querySelectorAll('.shell-note')];
  if(notes[0]){
    const b=notes[0].querySelector(':scope > b');
    const s=notes[0].querySelector(':scope > small');
    if(b) b.textContent='加入其他店铺';
    if(s) s.textContent='输入店主分享的邀请码，确认店名后即可加入。';
  }
  if(notes[1]){
    const b=notes[1].querySelector(':scope > b');
    const s=notes[1].querySelector(':scope > small');
    if(b) b.textContent='我加入的店铺';
    if(s) s.textContent='加入后可以使用店铺共享的价格表；你的顾客、消费记录和余额仍只属于你。';
  }

  const owner=document.getElementById('shopMembershipOwnerPanel');
  if(owner){
    const b=owner.querySelector(':scope > b');
    const s=owner.querySelector(':scope > small');
    if(b) b.textContent='当前店铺成员';
    if(s) s.textContent='管理成员和邀请方式。只有店铺创建者可以操作。';
  }

  const join=document.getElementById('shopMembershipJoinBtn');
  if(join) join.textContent='加入店铺';
  const input=document.getElementById('shopMembershipJoinCode');
  if(input) input.placeholder='输入店铺邀请码';

  const regen=document.getElementById('shopMembershipRegenerate');
  if(regen) regen.textContent='更换邀请码';
  const refresh=document.getElementById('shopMembershipRefreshBtn');
  if(refresh) refresh.textContent='刷新成员';

  // Keep runtime/error status messages intact; only remove developer-stage wording from the static UI.
}

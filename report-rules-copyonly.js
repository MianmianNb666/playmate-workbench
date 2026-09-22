// PaiMini 报备规则显示收口：派单页不展示“报备结算”卡片，只保留复制报备时的变量计算。
export function applyReportRulesCopyOnly(){
  try{
    document.getElementById('orderReportRuleCard')?.remove();
    const settings=document.getElementById('reportRuleSettingsCard');
    const small=settings?.querySelector('.card-title small');
    if(small) small.textContent='每个店铺可设置默认团抽、派抽、到手比例和来源；复制报备时自动计算并替换变量';
  }catch(error){
    console.warn('report rules copy-only polish failed',error);
  }
}

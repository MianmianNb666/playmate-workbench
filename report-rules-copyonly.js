// PaiMini 报备显示收口：
// 不在“我的店铺”或“派单计算”额外展示报备规则/报备结算卡片。
// 只保留原有“我的报备模板”里的变量，以及复制报备时的变量替换逻辑。
export function applyReportRulesCopyOnly(){
  try{
    document.getElementById('orderReportRuleCard')?.remove();
    document.getElementById('reportRuleSettingsCard')?.remove();
  }catch(error){
    console.warn('report rules copy-only polish failed',error);
  }
}

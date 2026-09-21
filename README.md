# playmate-workbench

独立陪玩派单计算器 V1。

## V1 分区
1. 派单计算
2. 价格表
3. 消费记录
4. 店铺模板
5. 小票设置
6. 设置

## 核心流程
选店铺 → 选老板 → 选项目卡片 → 手填陪陪 → 自动带单价/单位 → 输入时长或数量 → 自动算价 → 查看历史累计和新累计 → 复制报备 → 预览/导出 PNG 小票 → 保存消费记录。

## 数据库
Supabase migration:
`supabase/migrations/20260921150000_v1_core.sql`

核心表：
- shops
- price_categories
- price_items
- customers
- consumption_records
- report_templates
- receipt_settings

历史消费记录保存价格快照，后续修改价格表不会污染旧单。

## 当前部署
GitHub Pages:
`https://mianmiannb666.github.io/playmate-workbench/`

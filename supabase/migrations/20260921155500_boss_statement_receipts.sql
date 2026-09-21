-- V1.3 老板留言 + 老板完整流水导出

alter table public.receipt_settings
  add column if not exists boss_message text
  default '谢谢支持，祝你今天也开心 ♡';

-- 兼容已有数据
update public.receipt_settings
set boss_message = '谢谢支持，祝你今天也开心 ♡'
where boss_message is null;

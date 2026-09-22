# PROJECT_CONTEXT.md

> 给后续开发对话使用。继续这个项目时，先读本文件，再读最新代码。不要重新建项目。

## 项目身份

- 项目：派Mini / 陪玩工作台
- 仓库：`MianmianNb666/playmate-workbench`
- 默认分支：`main`
- 部署：`https://mianmiannb666.github.io/playmate-workbench/`
- 这是独立于莓桃工作台的项目。
- 不要重新建仓库，不要把代码合回 `berry-workbench`。
- 使用独立 Supabase 项目，业务表和权限逻辑独立。

## 开发原则

1. 先读取最新目标文件，再修改。
2. 尽量小改，避免影响已经正常的手机端和保存逻辑。
3. 涉及登录、Supabase、店铺权限、价格保存、消费记录时尤其谨慎。
4. 修前端兼容问题时，优先检查：
   - 当前 `index.html` 实际加载的是哪个版本 JS
   - 浏览器/PWA缓存
   - 事件绑定是否在桌面端和手机端一致
5. 改 JS 后必要时更新 `index.html` 里的资源版本号，强制手机/电脑加载最新版。
6. 不要在公开仓库提交 secret / service_role key。

## 当前主要文件

- `index.html`：主界面
- `app-v20260921-8.js`：当前主应用脚本，先看 index 实际引用版本
- `boss-features.js`：老板/顾客相关增强功能
- `price-import.js`：图片价格表 OCR 识别、修改、整理、导入
- `multi-order.js`：一单多陪玩 / 多项目
- `wallet-features.js`：预存套餐与附赠权益
- `shop-membership.js`：店铺成员制、邀请码/邀请链接、加入/退出店铺
- `prepaid-page.js`：预存套餐独立一级分区
- `readonly-access.js`：账号到期后的只读模式
- `delete-mode.js`：设置中的删除模式
- `admin.html` / `admin.js`：管理端
- `styles.css`：主样式
- `supabase-config.js`：Supabase 前端公开配置与扩展模块加载
- `supabase/migrations/`：数据库 migration
- `sw.js`：PWA 缓存

## 当前核心功能

- 派单计算
- 多陪玩
- 每个陪玩可添加多个项目
- 保存整单
- 价格表管理
- 图片识别价格表
- OCR 后手动修改文字
- 重新整理 / 自动匹配项目
- 确认导入当前店铺
- 顾客 / 老板档案
- 消费记录
- 小票预览 / 导出
- 报备复制
- 店铺成员制与邀请加入
- 预存套餐与附赠权益
- 邀请码到期只读模式
- 删除模式
- 管理端
- 手机端 / 电脑端适配

## 店铺成员制（2026-09-23）

- 已废弃「所有登录用户都能看到公开店铺」的产品逻辑。
- 普通账号只能看到：
  1. 自己创建的店铺；
  2. 已通过该店铺加入码 / 邀请链接加入的店铺。
- 店主在「小店」页面管理邀请：复制邀请码、复制链接、关闭邀请、重新开启、重新生成。
- 重新生成后旧邀请码 / 旧链接立即失效；关闭邀请不会踢出已有成员。
- 已加入成员可以退出店铺。
- 成员只能共享读取店铺与价格表，不能修改店铺或共享价格表。
- 老板档案、消费记录、预存余额、权益、报备等个人业务数据继续按 `user_id` 隔离，不会因为加入同一个店而互相可见。
- 关键 migration：`20260923033000_shop_membership_invites.sql`。
- `shops.visibility` 仅保留兼容，不再作为普通用户可见性依据。
- 管理端通过 `SECURITY DEFINER` 管理 RPC 继续可查看全部店铺，不受成员 RLS 限制。

## 图片识别价格表当前逻辑

相关文件：`price-import.js`

流程：
1. 选择价格表图片。
2. 本地 OCR 识别，不保存原图。
3. 原始识别文字写入 `#ocrRawText`。
4. 自动解析为 `state.rows`，显示在 `#ocrRows`。
5. 用户可修改上方原始文字，点击「重新整理文字」重新解析。
6. 用户也可直接修改下方已经匹配出来的行。
7. 点击「确认导入当前店铺」写入 `price_categories` / `price_items`。
8. 同名项目会提示，并可更新现有价格与单位。

重要：
- 当前代码没有设计“手机一套、电脑一套”。
- 如果手机可提交、电脑不可提交，优先怀疑浏览器/PWA缓存、旧版 `price-import.js`、资源版本号或桌面端事件状态。
- 不要因此重写 OCR 或数据库逻辑。

## 当前 OCR 实现

优先：
- PaddleOCR JS
- PP-OCRv5
- ONNX Runtime WASM

失败时回退：
- Tesseract.js
- `chi_sim+eng`

长图会切片，本地处理。

## 店铺权限

- 图片价格表导入只允许店铺创建者修改共享价格表。
- `refreshOwnership()` 会读取当前店铺并判断 `shops.user_id === session.user.id`。
- 加入成员可读取店铺/价格表，但 ownership 仍为 false，因此不能修改共享价格。
- 如果按钮在某端被禁用，先检查 session、当前 shop、ownership 状态，不要直接删权限判断。

## 当前已知待排查问题

### 电脑端 OCR 修改后不能正常重新匹配/提交
- 2026-09-22 已做第二轮修复，等待桌面端实机确认。
- 手机端原有正常逻辑保持不变。
- 提交时不再只依赖 `input` 事件判断是否改过文字，而是直接比较当前 `#ocrRawText` 与 `state.lastParsedText`。
- 只要当前文字和上一次已匹配文字不同，`importRows()` 会先强制 `reparse()`，再导入。
- 同时补充 `input / change / paste` 状态监听，并将 `price-import.js` 资源版本更新到 `v20260922-v21`。
- 未修改数据库、OCR 引擎和手机端业务流程。
- 若仍复现，下一步优先检查桌面浏览器控制台报错与页面是否实际加载 v21，而不是重写 OCR。

## 后续接手方式

新对话建议第一句话：

> 先读取仓库里的 PROJECT_CONTEXT.md 和 CHANGELOG_DEV.md，再基于最新代码继续开发。不要重建项目，不要重构正常功能。先检查 index.html 当前加载的 JS 版本，再改。

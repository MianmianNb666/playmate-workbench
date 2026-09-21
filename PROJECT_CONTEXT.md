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
- `admin.html` / `admin.js`：管理端
- `styles.css`：主样式
- `supabase-config.js`：Supabase 前端公开配置
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
- 店铺与店铺权限
- 管理端
- 手机端 / 电脑端适配

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
- 如果按钮在某端被禁用，先检查 session、当前 shop、ownership 状态，不要直接删权限判断。

## 当前已知待排查问题

### 电脑端 OCR 修改后不能正常重新匹配/提交
- 手机端正常。
- 仓库当前事件绑定存在：
  - `reparseOcrBtn -> reparse()`
  - `importRecognizedPricesBtn -> importRows()`
- 当前最可能方向：
  - 电脑端缓存旧资源
  - JS 版本号未刷新
  - 桌面端 state / ownership 状态未及时刷新
- 修复时优先“小改 + 更新资源版本号”，不要动数据库。

## 后续接手方式

新对话建议第一句话：

> 先读取仓库里的 PROJECT_CONTEXT.md 和 CHANGELOG_DEV.md，再基于最新代码继续开发。不要重建项目，不要重构正常功能。先检查 index.html 当前加载的 JS 版本，再改。

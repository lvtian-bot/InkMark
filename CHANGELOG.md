# 更新日志

所有显著变更都记录在本文件中，格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## 0.1.9（2026-08-22）
### ✨ 新增
- 工具栏格式按钮支持自定义快捷键并新增删除整行

**完整对比**: [v0.1.8...v0.1.9](https://github.com/lvtian-bot/InkMark/compare/v0.1.8...v0.1.9)
## 0.1.8（2026-08-21）
### ✨ 新增
- 表格支持插入与删除行列
- 新增可选自动保存并去除保存按钮高亮

**完整对比**: [v0.1.7...v0.1.8](https://github.com/lvtian-bot/InkMark/compare/v0.1.7...v0.1.8)
## 0.1.7（2026-08-19）
### 🐛 修复
- 星标统一为最近打开唯一置顶机制并支持文件夹加星

**完整对比**: [v0.1.6...v0.1.7](https://github.com/lvtian-bot/InkMark/compare/v0.1.6...v0.1.7)
## 0.1.6（2026-08-19）
### ⚙️ 工程维护
- 引入自动发布说明与提交规范校验
### ✨ 新增
- 统一滚动条胶囊样式并覆盖源码模式
- 最近打开支持加星置顶
### 🏗️ 构建与集成
- 修复 git-cliff 安装包下载地址
- 将 git-cliff 注入 PATH 供后续步骤调用
### 📝 文档
- 明确中文提交规范与发布说明自动化约束
- 待办清单改为三类并按版本归档历史任务
- 删除发布流程中的版本号递增规则

**完整对比**: [v0.1.5...v0.1.6](https://github.com/lvtian-bot/InkMark/compare/v0.1.5...v0.1.6)
## 0.1.5（2026-08-16）
### 🐛 修复
- Resolve autoUpdater via CJS default interop

**完整对比**: [v0.1.4...v0.1.5](https://github.com/lvtian-bot/InkMark/compare/v0.1.4...v0.1.5)
## 0.1.4（2026-08-15）
### ✨ 新增
- Align menu shortcuts, dynamic status tooltips and popup position
- Expand menu items, toolbar toggle and configurable shortcuts

**完整对比**: [v0.1.3...v0.1.4](https://github.com/lvtian-bot/InkMark/compare/v0.1.3...v0.1.4)
## 0.1.3（2026-08-15）
### 🐛 修复
- Set nsis artifactName to keep latest.yml and asset names aligned
### 📝 文档
- Note in-app update filename mismatch follow-up
- Rely on in-app updates, drop local installer retention

**完整对比**: [v0.1.2...v0.1.3](https://github.com/lvtian-bot/InkMark/compare/v0.1.2...v0.1.3)
## 0.1.2（2026-08-14）
### ⚡ 性能
- Lazy-load source mode and dialogs to speed up launch
### ✨ 新增
- Add Ctrl+N blank document and external-update reload prompt
### 🐛 修复
- Follow-system language resolves menu from renderer system language
- Find/replace jump and highlight stability, panel alignment

**完整对比**: [v0.1.1...v0.1.2](https://github.com/lvtian-bot/InkMark/compare/v0.1.1...v0.1.2)
## 0.1.1（2026-08-13）
### ✨ 新增
- Manual update flow with download progress and guarded install
- Wizard-style NSIS installer with install-range migration
- Multi-language interface (Simplified Chinese / English)
### 📝 文档
- Define Windows installer migration behavior
- Define manual update workflow
- Mark manual update and wizard installer done

**完整对比**: [v0.1.0...v0.1.1](https://github.com/lvtian-bot/InkMark/compare/v0.1.0...v0.1.1)
## 0.1.0（2026-08-13）
### ✨ 新增
- 任务列表渲染重构与文件对话框记忆位置
- 所见即所得模式保留列表原始 Markdown 标记符号
- 所见即所得块级标记浮现（标题/引用/列表）
- 块级标记浮现加设置开关（默认关闭，实验性）
### 🐛 修复
- 列表标记保留补 inputRule 覆盖（打字新建也记字符）
- 序列化空段落不再注入 <br /> 占位
### 📝 文档
- 记录 v0.0.9 发布完成
- 标记浮现需求文档与范围（块级先行）
- 标记浮现设置项提示补充「未来可能会被移除」

**完整对比**: [v0.0.9...v0.1.0](https://github.com/lvtian-bot/InkMark/compare/v0.0.9...v0.1.0)
## 0.0.9（2026-08-12）
### ✨ 新增
- 欢迎页布局重排与文件树清空
- 快捷键设置、frontmatter 渲染及多项修复
### 🐛 修复
- 大纲在右侧时刻漏边框

**完整对比**: [v0.0.8...v0.0.9](https://github.com/lvtian-bot/InkMark/compare/v0.0.8...v0.0.9)
## 0.0.8（2026-08-10）
### 📝 文档
- 记录 v0.0.7 发布完成
- 补充发布文档中通过 gh CLI 下载安装包的明确指令
- 设计标签页位置记忆
- 制定标签页位置记忆实现计划

**完整对比**: [v0.0.7...v0.0.8](https://github.com/lvtian-bot/InkMark/compare/v0.0.7...v0.0.8)
## 0.0.7（2026-08-10）
### ✨ 新增
- 文件树工作区（只读浏览与外部刷新）
- 侧栏格式对齐与大纲章节折叠
- 文件树跟随活动文档
### 🐛 修复
- 字号档位标签「适中」改为「默认」
- 配置 .gitattributes 与 prettier 跨平台换行符规则
### 📝 文档
- 同步文件树工作区、发布流程与待办记录
- 强化发布流程中的状态跟踪要求并追加 v0.0.7 待办

**完整对比**: [v0.0.6...v0.0.7](https://github.com/lvtian-bot/InkMark/compare/v0.0.6...v0.0.7)
## 0.0.6（2026-08-09）
### ⚙️ 工程维护
- 关闭 electron-vite 自动清空 out 以兼容沙箱构建
- 抽取共享主题模型并接入 Vitest 工程链
### ✨ 新增
- 编辑器状态隔离与体验增强
- 标签页支持拖拽排序
### 🐛 修复
- 收紧 Electron 安全基线
### 📝 文档
- 记录标记符号统一化限制并同步标签页进度
### 🧪 测试
- 补齐文件冲突与关闭决策的单元测试

**完整对比**: [v0.0.5...v0.0.6](https://github.com/lvtian-bot/InkMark/compare/v0.0.5...v0.0.6)
## 0.0.5（2026-08-09）
### ✨ 新增
- 源码模式升级 CodeMirror 6 并完善状态栏入口
- 编辑器体验增强、工具栏宽度与 Alt+E 快捷键
### 🐛 修复
- 待办任务行首 Delete 键误触发勾选状态
- 统一编辑区布局并增加工具栏宽度设置

**完整对比**: [v0.0.4...v0.0.5](https://github.com/lvtian-bot/InkMark/compare/v0.0.4...v0.0.5)
## 0.0.4（2026-08-08）
### ⏪ 回退
- Revert "feat: support Obsidian ![[image]] embed syntax"
### ♻️ 重构
- 收敛数据模型与文件保存安全，补冷启动竞态
### ⚙️ 工程维护
- 升级 release 工作流 Node 版本至 24
- 引入 mattpocock 技能集到 .agents
### ✨ 新增
- Multi-tab support with Chrome-like behavior
- Move tab bar to window top with titleBarOverlay
- Add hamburger menu and editing toolbar
- 标签整列点击、淡蓝标签栏、白色工作区，修大纲高亮与表格样式
- 起始页、任务清单、最近文件与外部修改检测
- 工具栏图标升级与源码模式视觉统一，发布 v0.0.3
- 多文件打开、工具栏补齐、对话框增强与多项体验改进
- 添加文件实时监听与设置面板
- 添加查找替换与 Markdown 回归基线
- Image local storage with inkmark-local protocol
- Support Obsidian ![[image]] embed syntax
- 合并图片本地存储并加强安全边界
### 🐛 修复
- 默认画布色改为白色，修复打包后背景变灰
- 同名标题导致大纲重复渲染与工具栏阴影叠加

**完整对比**: [v0.0.1...v0.0.4](https://github.com/lvtian-bot/InkMark/compare/v0.0.1...v0.0.4)
## 0.0.1（2026-08-07）
### ⚙️ 工程维护
- Switch from pnpm to npm
- Set version to 0.0.1
- Add window state persistence and app branding assets
- 忽略 tsbuildinfo 构建缓存
- 添加 GitHub Actions 自动发布工作流
### ✨ 新增
- InkMark v1 - Markdown WYSIWYG editor
- Add New/Open/Save buttons to title bar
- Resizable/toggleable outline + file association
- 新增源码视图、状态栏与字数统计，优化表格与标题样式
### 🐛 修复
- 修复 release 工作流打包发布失败

<!-- 本文件由 git-cliff 依据 Conventional Commits 自动生成，请勿手工编辑 -->

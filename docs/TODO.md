# InkMark 待办

产品出发点、定位与边界见 [product-positioning.md](./product-positioning.md)。历史已完成事项见 [TODO-ARCHIVE.md](./TODO-ARCHIVE.md)。

待办记录的任务不代表一定要做，是可以探讨的。如果在实现过程当中会带来更大的问题，或者是说成本大于收益，必须要提出来。

## 记录规则

1. 所有任务分为三类：**新功能**、**Bug 修复**、**暂不考虑**。
2. 新增任务一律追加到对应分类末尾。
3. 任务完成后标记 `[x]` 并按 Obsidian Tasks 格式记录完成时间：`✅ YYYY-MM-DD`。已完成项说明保持简短（最多三条）。
4. 版本发布时，将已完成的 `[x]` 项统一剪切归档至 [TODO-ARCHIVE.md](./TODO-ARCHIVE.md) 对应版本下，保持待办清单精炼聚焦。

## 新功能

- [ ] 导出 HTML / PDF / 富文本
- [ ] 简单表格编辑，添加删除行列等
- [ ] 可选自动保存（默认关闭）
- [ ] 数学公式与图表（KaTeX / Mermaid）
- [ ] 外部改动审阅（编辑区内联 diff，逐块接受/拒绝）；需求见 [change-review.md](./change-review.md)
- [x] 最近打开支持加星置顶：加星文件常驻文件夹块之下、不占 10 条配额，悬停星标/移除按钮与分组分隔线 ✅ 2026-08-19
  - shared `recent-items.ts` 增加 `starred` 字段、排序（文件夹 → 加星 → 普通）与 `toggleRecentStar`。
  - 原生菜单“最近打开”同步星标分组与 ★ 前缀；`recent-files.json` 向后兼容。

## Bug 修复

## 暂不考虑

- [ ] 所见即所得模式：光标进入段落后，相应的标记浮现，并可编辑（Live Preview）；需求与历史评估见 [live-preview.md](./live-preview.md)
  - 历史记录：2026-08-13 曾基于 ProseMirror 行首装饰（Decoration）实现块级浮现与行首 `#`/Backspace 升降级。
  - 清理原因：2026-08-16 评估确认行首装饰方案无法将光标点入字符字形中间编辑，与期望的自然体验差距较大，易造成“功能不可用”的误解，已完全从代码库清理。
  - 后续参考：若未来重新立项，需采用聚焦展开源码态的完整 NodeView 机制重构，可查阅 Git 历史与 live-preview.md。

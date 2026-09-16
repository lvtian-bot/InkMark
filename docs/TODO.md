# InkMark 待办

产品出发点、定位与边界见 [product-positioning.md](./product-positioning.md)。历史已完成事项见 [TODO-ARCHIVE.md](./TODO-ARCHIVE.md)。

待办记录的任务不代表一定要做，是可以探讨的。如果在实现过程当中会带来更大的问题，或者是说成本大于收益，必须要提出来。

## 记录规则

1. 所有任务分为三类：**新功能**、**Bug 修复**、**暂不考虑**。
2. 新增任务一律追加到对应分类末尾。
3. 任务完成后标记 `[x]` 并按 Obsidian Tasks 格式记录完成时间：`✅ YYYY-MM-DD`。已完成项说明保持简短（最多三条）。
4. 版本发布时，将已完成的 `[x]` 项统一剪切归档至 [TODO-ARCHIVE.md](./TODO-ARCHIVE.md) 对应版本下，保持待办清单精炼聚焦。

## 新功能

- [ ] 导出 Word

- [x] 排版数值设置：行距、段落间距、列表项间距改为具体数值输入（限定范围），旧版行距档位自动迁移 ✅ 2026-09-16
  - 不做命名档位；数值经 CSS 变量注入编辑区，持久化与注入两层夹回范围；规格见 [theme-architecture.md](./theme-architecture.md)「正文行距规格」。

- [x] 换行行为：宽松换行显示语义（单换行渲染为换行、空行渲染为空行高度的段落间距），回车保持默认分段键位；决策过程见 [line-break-mode.md](./line-break-mode.md) ✅ 2026-09-16
  - 2026-09-15 曾实现双模式设置与 Word 键位（回车即换行），2026-09-16 试用后确认解释成本高于收益，回退到默认键位，仅保留宽松显示语义与段落间距调整。
  - 各阶段实现可在 git 历史检索 `strictLineBreaks`、`line-break-keymap`、`gap-cursor`。

## Bug 修复

## 暂不考虑

- [ ] 数学公式与图表（KaTeX / Mermaid）

- [ ] 所见即所得模式：光标进入段落后，相应的标记浮现，并可编辑（Live Preview）；需求与历史评估见 [live-preview.md](./live-preview.md)
  - 历史记录：2026-08-13 曾基于 ProseMirror 行首装饰（Decoration）实现块级浮现与行首 `#`/Backspace 升降级。

  - 清理原因：2026-08-16 评估确认行首装饰方案无法将光标点入字符字形中间编辑，与期望的自然体验差距较大，易造成“功能不可用”的误解，已完全从代码库清理。

  - 后续参考：若未来重新立项，需采用聚焦展开源码态的完整 NodeView 机制重构，可查阅 Git 历史与 live-preview\.md。

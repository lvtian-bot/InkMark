# 标签页编辑位置记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 切换标签页或编辑模式后，恢复当前文档在对应模式中的滚动位置、光标和选区。

**Architecture:** 标签页状态分别保存 `wysiwygScrollTop` 与 `sourceScrollTop`，编辑器光标、选区和撤销历史继续由现有的 `editorStateCache` 按标签页和模式缓存。WYSIWYG 使用 `.editor-container`，源码模式通过 `SourceEditorHandle` 使用 CodeMirror 的 `view.scrollDOM`；`App.tsx` 在标签页和模式切换流程中捕获旧模式并恢复新模式的位置。

**Tech Stack:** React 18、Zustand 5、TypeScript strict、Milkdown 7.22、CodeMirror 6、Vitest 4、npm。

## Global Constraints

- 文档内容以标签页的 `sourceContent` 为单一真源；本次不新增内容镜像。
- 位置状态只存在于当前会话的 `tabs[]` 中，不写入 Markdown、localStorage 或用户设置。
- 不为普通滚动增加高频 Zustand 更新，只在标签页切换和编辑模式切换时捕获位置。
- 源码编辑器通过 `SourceEditorHandle` 暴露滚动接口，调用方不直接查询 CodeMirror DOM。
- 不新增依赖；依赖和脚本以 `package.json` 为准，最终运行 `npm run check`。
- 遵守现有 TypeScript、React、2 空格缩进、单引号和分号规范。
- 保留工作区已有的未提交改动，只修改本计划列出的文件。

---

## 文件结构与职责

- `src/renderer/src/stores/useStore.ts`：标签页位置字段、默认值和按活动标签页更新位置的方法。
- `src/renderer/src/tab-position.test.ts`：验证两个编辑模式的位置状态相互独立。
- `src/renderer/src/editor-scroll.ts`：编辑器滚动容器的空值安全读取、写入和数值归一化。
- `src/renderer/src/editor-scroll.test.ts`：验证滚动容器辅助函数。
- `src/renderer/src/editor-position.ts`：把编辑模式映射到对应的标签页位置字段，供切换流程使用。
- `src/renderer/src/editor-position.test.ts`：验证模式与位置字段、位置更新对象的映射。
- `src/renderer/src/editor-ref.ts`：WYSIWYG 现有滚动接口保持不变，由组件改用共享辅助函数。
- `src/renderer/src/source-editor-ref.ts`：增加源码编辑器滚动接口。
- `src/renderer/src/components/Editor.tsx`：通过 `.editor-container` 接入共享滚动读写辅助函数。
- `src/renderer/src/components/SourceEditor.tsx`：通过 CodeMirror `view.scrollDOM` 实现源码滚动接口。
- `src/renderer/src/App.tsx`：在标签页切换和模式切换时保存、恢复对应模式的位置。
- `docs/TODO.md`：实现并验收后只勾选该事项并记录完成日期。

### Task 1: 为标签页建立按模式分离的位置状态

**Files:**
- Create: `src/renderer/src/tab-position.test.ts`
- Modify: `src/renderer/src/stores/useStore.ts`

**Interfaces:**
- `Tab.wysiwygScrollTop: number`：所见即所得模式的滚动位置。
- `Tab.sourceScrollTop: number`：源码模式的滚动位置。
- `setWysiwygScrollTop(top: number): void`：更新活动标签页的 WYSIWYG 位置。
- `setSourceScrollTop(top: number): void`：更新活动标签页的源码位置。

- [ ] **Step 1: 写一个会失败的状态测试**

创建 `src/renderer/src/tab-position.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { useStore } from './stores/useStore';

describe('tab editor positions', () => {
it('为每个标签页分别保存两种编辑模式的滚动位置', () => {
  const { addTab, setActiveTab, setWysiwygScrollTop, setSourceScrollTop } = useStore.getState();
  const tabId = addTab({ filePath: 'D:/notes/position.md', content: '# position' });
  setActiveTab(tabId);

  const initialTab = useStore.getState().tabs.find((tab) => tab.id === tabId);
  expect(initialTab?.wysiwygScrollTop).toBe(0);
  expect(initialTab?.sourceScrollTop).toBe(0);

  setWysiwygScrollTop(240);
  setSourceScrollTop(80);

  const tab = useStore.getState().tabs.find((item) => item.id === tabId);
  expect(tab?.wysiwygScrollTop).toBe(240);
  expect(tab?.sourceScrollTop).toBe(80);
});
});
```

- [ ] **Step 2: 运行测试并确认它因功能缺失失败**

运行：

```bash
npm test -- src/renderer/src/tab-position.test.ts
```

预期：新增测试失败，原因是标签页没有两个位置字段或 `setWysiwygScrollTop` / `setSourceScrollTop` 尚不存在；现有关闭标签页测试仍应正常执行。

- [ ] **Step 3: 实现最小状态模型**

在 `Tab` 中把现有的单一 `scrollTop` 替换为两个字段，并在 `createTab()` 中都初始化为 `0`。在 `InkMarkState` 中增加两个按活动标签页更新的方法：

```ts
setWysiwygScrollTop: (top: number) => void;
setSourceScrollTop: (top: number) => void;
```

两者都通过 `get().updateTab(get().activeTabId, ...)` 更新对应字段，并把负数归一化为 `0`。删除不再有明确模式语义的 `setScrollTop`。

- [ ] **Step 4: 运行测试并确认通过**

运行：

```bash
npm test -- src/renderer/src/tab-position.test.ts
```

预期：该文件中的全部测试通过；两个位置字段均能独立保存。

- [ ] **Step 5: 提交独立的状态模型改动**

```bash
git add src/renderer/src/stores/useStore.ts src/renderer/src/tab-position.test.ts
git commit -m "feat: 分离标签页编辑模式滚动位置"
```

### Task 2: 为两个编辑器提供统一的滚动容器接口

**Files:**
- Create: `src/renderer/src/editor-scroll.ts`
- Create: `src/renderer/src/editor-scroll.test.ts`
- Modify: `src/renderer/src/components/Editor.tsx`
- Modify: `src/renderer/src/components/SourceEditor.tsx`
- Modify: `src/renderer/src/source-editor-ref.ts`

**Interfaces:**
- `ScrollContainer`：只要求具有可读写的 `scrollTop: number`。
- `readScrollTop(container: ScrollContainer | null | undefined): number`：空容器返回 `0`。
- `writeScrollTop(container: ScrollContainer | null | undefined, top: number): void`：空容器跳过；负数和非有限数写入 `0`。
- `SourceEditorHandle.getScrollTop(): number`：读取 CodeMirror `view.scrollDOM.scrollTop`。
- `SourceEditorHandle.setScrollTop(top: number): void`：写入 CodeMirror `view.scrollDOM.scrollTop`。

- [ ] **Step 1: 写滚动辅助函数的失败测试**

创建 `src/renderer/src/editor-scroll.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { readScrollTop, writeScrollTop } from './editor-scroll';

describe('editor scroll helpers', () => {
  it('读取容器位置，空容器返回零', () => {
    expect(readScrollTop({ scrollTop: 24 })).toBe(24);
    expect(readScrollTop(null)).toBe(0);
  });

  it('写入位置时把负数和非有限数归零', () => {
    const container = { scrollTop: 24 };

    writeScrollTop(container, 180);
    expect(container.scrollTop).toBe(180);

    writeScrollTop(container, -4);
    expect(container.scrollTop).toBe(0);

    writeScrollTop(container, Number.NaN);
    expect(container.scrollTop).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试并确认模块缺失导致失败**

运行：

```bash
npm test -- src/renderer/src/editor-scroll.test.ts
```

预期：测试因 `./editor-scroll` 尚不存在而失败。

- [ ] **Step 3: 实现共享滚动辅助函数**

创建 `src/renderer/src/editor-scroll.ts`，实现以下逻辑：

```ts
export interface ScrollContainer {
  scrollTop: number;
}

export function readScrollTop(container: ScrollContainer | null | undefined): number {
  return container?.scrollTop ?? 0;
}

export function writeScrollTop(
  container: ScrollContainer | null | undefined,
  top: number,
): void {
  if (!container) return;
  container.scrollTop = Number.isFinite(top) ? Math.max(0, top) : 0;
}
```

- [ ] **Step 4: 运行辅助函数测试并确认通过**

运行：

```bash
npm test -- src/renderer/src/editor-scroll.test.ts
```

预期：两个测试通过。

- [ ] **Step 5: 接入 WYSIWYG 与源码编辑器句柄**

在 `Editor.tsx` 中用 `readScrollTop` / `writeScrollTop` 实现已有 `getScrollTop` / `setScrollTop`；在 `SourceEditor.tsx` 的 `sourceEditorHandle.current` 中增加：

```ts
getScrollTop: () => readScrollTop(view.scrollDOM),
setScrollTop: (top) => writeScrollTop(view.scrollDOM, top),
```

同时在 `source-editor-ref.ts` 的 `SourceEditorHandle` 中声明这两个方法。不要通过 `document.querySelector` 查找源码滚动容器。

- [ ] **Step 6: 运行相关检查**

运行：

```bash
npm test -- src/renderer/src/editor-scroll.test.ts src/renderer/src/tab-position.test.ts
npm run typecheck
```

预期：定向测试和两个 TypeScript 项目均通过；如果接口变更暴露出未更新的调用点，修复调用点后再继续。

- [ ] **Step 7: 提交编辑器滚动接口改动**

```bash
git add src/renderer/src/editor-scroll.ts src/renderer/src/editor-scroll.test.ts src/renderer/src/components/Editor.tsx src/renderer/src/components/SourceEditor.tsx src/renderer/src/source-editor-ref.ts
git commit -m "feat: 暴露源码编辑器滚动位置"
```

### Task 3: 接入标签页和模式切换的保存恢复流程

**Files:**
- Create: `src/renderer/src/editor-position.ts`
- Create: `src/renderer/src/editor-position.test.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- `ScrollPositionField = 'wysiwygScrollTop' | 'sourceScrollTop'`。
- `scrollPositionField(mode: ViewMode): ScrollPositionField`：返回模式对应的标签页字段。
- `readTabScrollTop(tab, mode): number`：读取标签页在指定模式的位置。
- `scrollPositionUpdate(mode, top): Pick<Tab, 'wysiwygScrollTop' | 'sourceScrollTop'>`：生成只更新目标模式字段的位置更新对象。

- [ ] **Step 1: 写模式映射的失败测试**

创建 `src/renderer/src/editor-position.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  readTabScrollTop,
  scrollPositionField,
  scrollPositionUpdate,
} from './editor-position';

describe('editor position mapping', () => {
  const tab = { wysiwygScrollTop: 120, sourceScrollTop: 48 };

  it('把编辑模式映射到独立的位置字段', () => {
    expect(scrollPositionField('wysiwyg')).toBe('wysiwygScrollTop');
    expect(scrollPositionField('source')).toBe('sourceScrollTop');
    expect(readTabScrollTop(tab, 'wysiwyg')).toBe(120);
    expect(readTabScrollTop(tab, 'source')).toBe(48);
  });

  it('只生成目标模式的位置更新', () => {
    expect(scrollPositionUpdate('wysiwyg', 240)).toEqual({ wysiwygScrollTop: 240 });
    expect(scrollPositionUpdate('source', -8)).toEqual({ sourceScrollTop: 0 });
  });
});
```

- [ ] **Step 2: 运行测试并确认映射模块缺失导致失败**

运行：

```bash
npm test -- src/renderer/src/editor-position.test.ts
```

预期：测试因 `./editor-position` 尚不存在而失败。

- [ ] **Step 3: 实现模式映射模块**

创建 `src/renderer/src/editor-position.ts`。使用 `import type { Tab } from './stores/useStore'`，避免运行时循环依赖；实现 `scrollPositionField`、`readTabScrollTop` 和 `scrollPositionUpdate`，并用 `Number.isFinite(top) ? Math.max(0, top) : 0` 归一化位置。

- [ ] **Step 4: 运行模式映射测试并确认通过**

运行：

```bash
npm test -- src/renderer/src/editor-position.test.ts
```

预期：两个测试通过。

- [ ] **Step 5: 改造标签页切换流程**

在 `App.tsx` 中引入 `readTabScrollTop` 和 `scrollPositionUpdate`。在现有标签页切换 `useLayoutEffect` 中：

1. 用 `viewModeRef.current` 保存旧标签页当前模式。
2. WYSIWYG 通过 `editorHandle.current.getScrollTop()` 读取位置，源码模式通过 `sourceEditorHandle.current?.getScrollTop() ?? 0` 读取位置。
3. 用 `scrollPositionUpdate(oldMode, scrollTop)` 与 `sourceContent` 一起传给 `updateTab(oldTabId, ...)`。
4. 删除对旧 `newTab.scrollTop` 的恢复，改为读取 `readTabScrollTop(newTab, targetMode)`。
5. 下一帧只在 `viewModeRef.current === targetMode` 时恢复位置；源码模式调用 `sourceEditorHandle.current?.setScrollTop(top)`，WYSIWYG 调用 `editorHandle.current?.setScrollTop(top)`。

位置捕获与 `editorStateCache.capture` 使用同一个旧模式，位置恢复与该次切换的目标模式使用同一个 `targetMode`，避免快速切换时把一种模式的位置写入另一种模式。

- [ ] **Step 6: 改造编辑模式切换流程**

在现有 `viewMode` 变化的 `useEffect` 中：

1. 用 `prevModeRef.current` 记录离开的模式。
2. 在切换编辑器状态之前读取离开模式的滚动位置，并通过 `updateTab(tabId, scrollPositionUpdate(previousMode, scrollTop))` 保存。
3. 保留现有的 `editorStateCache.capture` / `restore`、`sourceContent`、大纲和字数统计同步逻辑。
4. 状态恢复完成后，通过 `useStore.getState()` 读取当前标签页的目标模式位置。
5. 用 `requestAnimationFrame` 恢复目标模式滚动；如果 `viewModeRef.current` 已不是本次目标模式，则跳过该帧，避免覆盖后续切换。

- [ ] **Step 7: 运行切换流程定向测试**

运行：

```bash
npm test -- src/renderer/src/editor-position.test.ts src/renderer/src/document-editor-state.test.ts src/renderer/src/tab-position.test.ts
npm run typecheck
```

预期：位置映射、编辑器状态隔离、标签页状态测试和 TypeScript 检查全部通过。

- [ ] **Step 8: 提交切换流程改动**

```bash
git add src/renderer/src/editor-position.ts src/renderer/src/editor-position.test.ts src/renderer/src/App.tsx
git commit -m "fix: 保留标签页编辑位置"
```

### Task 4: 完成文档记录与最终验证

**Files:**
- Modify: `docs/TODO.md:38`

**Interfaces:**
- 不新增运行时接口；本任务只更新完成记录并执行项目质量门禁。

- [ ] **Step 1: 运行完整质量门禁**

运行：

```bash
npm run check
```

预期：ESLint、两个 TypeScript 配置、Vitest、Prettier 和生产构建全部通过。

- [ ] **Step 2: 更新待办完成状态**

只把 `docs/TODO.md` 中这一行改为：

```md
- [x] 记住浏览位置，或光标位置，至少切换标签页不能瞎跳。 ✅ 2026-08-10
```

不移动该事项，不删除其他待办，不新增说明段落。

- [ ] **Step 3: 进行轻量人工验收或记录限制**

若当前环境能够可靠控制 Electron 界面，使用两篇足够长的 Markdown 文档检查：WYSIWYG 标签页切换、源码标签页切换、同一标签页两种模式来回切换、编辑后切换。确认光标、选区和各自滚动位置不互相覆盖。

若当前环境无法可靠控制 Electron 界面，不搭建临时截图或模拟键鼠流程，在交付说明中明确列出该人工验收尚未执行；自动化检查结果仍需真实记录。

- [ ] **Step 4: 检查差异并提交文档记录**

运行：

```bash
git diff --check
git status --short
```

确认本任务只留下计划范围内的修改，并保留用户已有的 `docs/TODO.md`、`StartPage.tsx`、`useFile.ts` 和 `useStore.test.ts` 未提交改动；然后提交本任务文档记录：

```bash
git add docs/TODO.md
git commit -m "docs: 完成标签页位置记忆待办"
```

## 计划自审

- 目标与问题：Task 1 建立按模式字段，Task 2 补齐源码滚动接口，Task 3 接入两个切换流程。
- 状态边界：Task 1 和 Task 3 明确位置只在 `tabs[]` 会话状态中，不涉及持久化。
- 光标与选区：Task 3 保留现有 `editorStateCache`，没有重复引入坐标存储。
- 失败处理：Task 2 的空句柄辅助函数和 Task 3 的可见模式检查覆盖句柄未建立、开始页和快速切换场景。
- 测试覆盖：每个新纯逻辑模块都先写失败测试；Task 4 运行完整质量门禁并记录人工验收限制。
- 无未决设计占位；文件名、字段名、方法名和测试中的调用保持一致。

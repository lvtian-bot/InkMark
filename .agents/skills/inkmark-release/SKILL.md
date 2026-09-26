---
name: inkmark-release
description: 发布 InkMark Windows 桌面客户端版本时使用；覆盖工作区提交、版本确认、待办归档、质量检查、标签触发、安装包与自动更新校验。普通开发、仅推送分支或撰写技术文档不使用。
---

# InkMark 版本发布

本技能是 InkMark 发布流程的唯一权威规范。发布由 `v*` 标签触发 `.github/workflows/release.yml`（质量检查、Windows 打包和 GitHub Release 上传）；普通分支推送只触发 `quality.yml` 质量检查。执行前核对当前工作流与 `package.json`，不要把这里的步骤当成外部平台的实时状态。

## 确定发布范围与版本

1. 检查 `git status`、本地与远端 `master` 的差异、`package.json` 与 `package-lock.json` 的版本，以及 `docs/TODO.md` 中本次已完成的事项。
2. 工作区存在未提交改动或未跟踪文件时，逐项核对内容摘要，按提交规范分类全部提交——代码功能与修复用 `feat:`/`fix:`（连同配套测试与文档），纯文档说明用 `docs:`——提交后再次执行 `git status` 确认工作区干净。发布是 GitHub Actions 按标签对应的提交在云端打包的，本地未提交的改动不会进入安装包，发布的就不是本地最新版本；且发布过程中的版本重置、重打标签等操作可能直接丢弃未提交内容且无法找回。仅当某项改动确实不宜随本次发布时，向用户说明并经确认后留在工作区，不得默默排除。
3. 版本号默认小步提升：常规发布只递增补丁位（如 0.2.0 → 0.2.1），包含新功能也不因此升次版本位；升位由用户明确决定（2026-09-04 起）。改变版本号或发布前，先向用户说明拟变更的版本号、影响范围和发布后果，取得针对该版本的明确同意；未经同意不修改版本字段、不创建/移动/删除标签。
4. Release 成功前发现版本号错误：取消运行中的 workflow、删除标签并重置版本提交重做，不追加修正提交——追加会留下指向未发布版本的幽灵提交，事后只能重写历史清理（2026-09-04 v0.2.1 发布教训）。

## 制作并触发发布

1. 将 `docs/TODO.md` 中本次已打勾的 `[x]` 待办项，剪切归档至 `docs/TODO-ARCHIVE.md` 顶部的 `## vX.Y.Z（YYYY-MM-DD）` 小节；未完成事项留在原处。
2. 同步更新 `package.json` 和 `package-lock.json` 中的版本号，检查两处一致；`CHANGELOG.md` 由 Release 工作流依据 `cliff.toml` 自动生成，不手工编辑。
3. 运行 `npm run check`，确认 lint、类型检查、单元测试、格式检查和生产构建全部通过。
4. 提交版本改动并推送 `master`，等待 Quality workflow 通过。
5. 创建与包版本一致的标签（例如 `v0.0.7`）并推送到远端；推送标签会启动对外发布。
6. **主动跟踪 Release workflow**：推送标签后，通过 `gh run list` / `gh run watch` 或 GitHub 页面实时跟踪执行过程，直至所有步骤全部完成。严禁推完标签不跟踪；若工作流失败，必须立即介入排查处理。
7. 确认 GitHub Release 页面已成功生成该版本，且包含 `.exe` 安装包、`.exe.blockmap` 和 `latest.yml` 完整发布产物。
8. 确认 Release 页面正文已由工作流自动生成中文发布说明（依据 `cliff.toml` 从 Conventional Commits 派生），仓库根 `CHANGELOG.md` 已由工作流自动提交更新。
9. 核对 `latest.yml` 的 `url`/`path` 与实际上传资产名一致。v0.1.3 起 `nsis.artifactName` 已显式指定无空格文件名（`${productName}-Setup-${version}.${ext}`），磁盘名、清单名与上传名三者恒一致，正常无需干预；若发现不一致（应用内更新会下载 404），修正该文件并以 `gh release upload <tag> latest.yml --clobber` 覆盖，再通过 GitHub API（资产 CDN 有缓存）复核生效。

完成标准：GitHub Actions Release 工作流成功执行、GitHub Release 发布成功且产物完整、发布说明与 CHANGELOG 已自动生成、`latest.yml` 与资产名一致（应用内更新可用）。仅创建标签、仅推送远端或工作流中途失败均不视为完成发布。

## 提交规范

- 版本提交固定写作 `chore: release vX.Y.Z`；工作流生成的 CHANGELOG 提交为 `chore: 发布后更新 CHANGELOG 至 vX.Y.Z`，两者都会被发布说明自动排除。
- 提交信息遵循 Conventional Commits（`feat:`/`fix:`/`docs:`/`chore:` 等类型前缀 + 中文主题，标题不超过 100 字符）；Quality workflow 已启用 commitlint 校验，不合规的推送会直接变红。

## 人工验证边界

- `npm run check` 是每次发布的自动门禁。
- 人工验证只覆盖本次改动直接相关、自动测试无法覆盖且能够可靠操作的少量界面行为。
- 无法可靠控制 Electron 界面时，记录尚未验证的具体体验项，交由用户实际使用确认。
- 完整 Markdown 人工回归仅用于编辑器内核升级、核心解析或序列化链路大范围调整，以及兼容性缺陷专项修复；具体清单见 [`markdown-compatibility.md`](../../../docs/markdown-compatibility.md)。

## 自动化触发与其他

- 本地 `npm run build:win` 不会创建 GitHub Release，只在需要本地留存安装包或排查打包问题时运行。
- 发布产物以 GitHub Release 为准，用户通过应用内「检查更新」升级，不要求下载安装包到本地留存（2026-08-14 起）。
- 如果 Release workflow 失败，不移动或覆盖已经公开使用的版本标签。修复问题后按实际情况删除尚未成功发布的标签并重建，或递增补丁版本重新发布。

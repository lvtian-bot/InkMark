# InkMark 发布流程

本文是版本发布的唯一操作说明。普通分支推送只做质量检查；只有推送 `v*` 版本标签才会自动打包并创建 GitHub Release。

## 发布步骤

1. 确认本次版本范围，更新 `package.json` 和 `package-lock.json` 中的版本号。
2. 运行 `npm run check`，确认 lint、类型检查、单元测试、格式检查和生产构建全部通过。
3. 提交版本改动并推送 `master`，等待 Quality workflow 通过。
4. 创建与包版本一致的标签（例如 `v0.0.7`），并将标签推送到远端。
5. **主动跟踪 Release workflow**：推送标签后，执行人必须通过 `gh run list` / `gh run watch` 或 GitHub 页面实时跟踪 Release 工作流执行过程，直至所有步骤全部完成。严禁推完标签不跟踪；若工作流失败，必须立即介入排查处理。
6. 确认 GitHub Release 页面已成功生成该版本，且包含 `.exe` 安装包、`.exe.blockmap` 和 `latest.yml` 完整发布产物。
7. 确认 Release 页面正文已由工作流自动生成中文发布说明（依据 `cliff.toml` 从 Conventional Commits 派生），仓库根 `CHANGELOG.md` 已由工作流自动提交更新。
8. 核对 `latest.yml` 的 `url`/`path` 与实际上传资产名一致。v0.1.3 起 `nsis.artifactName` 已显式指定无空格文件名（`${productName}-Setup-${version}.${ext}`），磁盘名、清单名与上传名三者恒一致，正常无需干预；若发现不一致（应用内更新会下载 404），修正该文件并以 `gh release upload <tag> latest.yml --clobber` 覆盖，再通过 GitHub API（资产 CDN 有缓存）复核生效。

完成标准：GitHub Actions Release 工作流成功执行、GitHub Release 发布成功且产物完整、发布说明与 CHANGELOG 已自动生成、`latest.yml` 与资产名一致（应用内更新可用）。仅创建标签、仅推送远端或工作流中途失败均不视为完成发布。

## 版本号与提交规范

- 0.x 阶段：缺陷修复递增补丁号（0.1.4 → 0.1.5），新功能或体验改进递增次版本号（0.1.x → 0.2.0）；1.0 留给功能面与数据格式稳定之后。
- 版本提交固定写作 `chore: release vX.Y.Z`；工作流生成的 CHANGELOG 提交为 `chore: 发布后更新 CHANGELOG 至 vX.Y.Z`，两者都会被发布说明自动排除。
- 提交信息遵循 Conventional Commits（`feat:`/`fix:`/`docs:`/`chore:` 等类型前缀 + 中文主题，标题不超过 100 字符）；Quality workflow 已启用 commitlint 校验，不合规的推送会直接变红。

本地留存说明（2026-08-14 起）：发布产物以 GitHub Release 为准，用户通过应用内「检查更新」升级，不再要求下载安装包到本地留存；需要排查打包问题时仍可本地 `npm run build:win`。

## 人工验证边界

- `npm run check` 是每次发布的自动门禁。
- 人工验证只覆盖本次改动直接相关、自动测试无法覆盖且能够可靠操作的少量界面行为。
- 无法可靠控制 Electron 界面时，记录尚未验证的具体体验项，交由用户实际使用确认。
- 完整 Markdown 人工回归仅用于编辑器内核升级、核心解析或序列化链路大范围调整，以及兼容性缺陷专项修复；具体清单见 [`markdown-compatibility.md`](markdown-compatibility.md)。

## 自动化触发规则

- 推送到 `master`：触发 `.github/workflows/quality.yml`，只运行质量检查。
- 推送 `v*` 标签：触发 `.github/workflows/release.yml`，运行质量检查、Windows 打包和 GitHub Release 上传。
- 本地 `npm run build:win` 不会创建 GitHub Release，只在需要本地留存安装包或排查打包问题时运行。

如果 Release workflow 失败，不移动或覆盖已经公开使用的版本标签。修复问题后按实际情况删除尚未成功发布的标签并重建，或递增补丁版本重新发布。

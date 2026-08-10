# InkMark 发布流程

本文是版本发布的唯一操作说明。普通分支推送只做质量检查；只有推送 `v*` 版本标签才会自动打包并创建 GitHub Release。

## 发布步骤

1. 确认本次版本范围，更新 `package.json` 和 `package-lock.json` 中的版本号。
2. 运行 `npm run check`，确认 lint、类型检查、单元测试、格式检查和生产构建全部通过。
3. 提交版本改动并推送 `master`，等待 Quality workflow 通过。
4. 创建与包版本一致的标签，例如 `v0.0.6`，并将标签推送到远端。
5. 等待 Release workflow 完成。该流程会再次运行质量检查、构建 Windows 安装包，并创建 GitHub Release。
6. 确认 Release 页面存在 `.exe` 安装包、`.exe.blockmap` 和 `latest.yml`。
7. 在本地保留同版本安装包，以下两种方式任选其一：
   - 从 GitHub Release 下载已发布的 `.exe` 安装包；
   - 运行 `npm run build:win`，保留 `dist/` 中生成的同版本安装包。

完成标准：GitHub Release 发布成功，并且本地能够找到同版本的 Windows 安装包。仅创建标签、仅通过构建或仅生成远端文件都不算完成发布。

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

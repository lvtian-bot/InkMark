module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 提交主题使用中文，不受英文大小写规则约束；英文小写主题同样放行。
    'subject-case': [0],
    // 标题总长度与既有仓库纪律保持一致（Conventional Commits 头 + 中文主题）。
    'header-max-length': [2, 'always', 100],
  },
};

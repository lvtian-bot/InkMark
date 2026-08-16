type ElectronUpdaterModule = typeof import('electron-updater');

export type AutoUpdater = ElectronUpdaterModule['autoUpdater'];

// 打包后的主进程产物是 CommonJS。原生 import() 加载 CJS 模块时，Node 靠静态分析
// （cjs-module-lexer）枚举命名导出，识别不了 electron-updater 用
// Object.defineProperty getter 导出的 autoUpdater，直接解构会得到 undefined；
// default 指向原始 module.exports，getter 在其上始终可见。
type UpdaterModuleWithDefault = ElectronUpdaterModule & {
  default?: { autoUpdater?: AutoUpdater };
};

export function resolveAutoUpdater(module: UpdaterModuleWithDefault): AutoUpdater {
  const updater = module.autoUpdater ?? module.default?.autoUpdater;
  if (updater === undefined || updater === null) {
    throw new Error('electron-updater did not expose autoUpdater');
  }
  return updater;
}

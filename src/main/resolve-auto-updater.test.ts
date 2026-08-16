import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolveAutoUpdater } from './resolve-auto-updater';

type ModuleShape = Parameters<typeof resolveAutoUpdater>[0];

function asModule(value: unknown): ModuleShape {
  return value as ModuleShape;
}

describe('resolveAutoUpdater', () => {
  it('returns autoUpdater when the namespace exposes it directly', () => {
    const updater = { autoDownload: true };
    expect(resolveAutoUpdater(asModule({ autoUpdater: updater }))).toBe(updater);
  });

  it('falls back to default.autoUpdater when the namespace omits the export', () => {
    const updater = { autoDownload: true };
    expect(resolveAutoUpdater(asModule({ default: { autoUpdater: updater } }))).toBe(updater);
  });

  it('resolves lazy getter exports on default (packaged CJS interop shape)', () => {
    let evaluated = false;
    const module = asModule({
      default: {
        get autoUpdater() {
          evaluated = true;
          return { autoDownload: true };
        },
      },
    });
    const updater = resolveAutoUpdater(module);
    expect(updater).toEqual({ autoDownload: true });
    expect(evaluated).toBe(true);
  });

  it('throws a descriptive error when neither shape exposes autoUpdater', () => {
    expect(() => resolveAutoUpdater(asModule({}))).toThrow(/did not expose autoUpdater/);
    expect(() => resolveAutoUpdater(asModule({ default: {} }))).toThrow(
      /did not expose autoUpdater/,
    );
  });

  // 真实 CJS 运行时回归：v0.1.2 起打包产物用原生 import() 加载 electron-updater，
  // Node 的 cjs-module-lexer 识别不出其 getter 导出的 autoUpdater，命名空间上为
  // undefined，只有 default（即 module.exports）可达。vitest 自身的 ESM 互操作会
  // 掩盖该差异，必须用子进程跑真实 Node 语义验证兜底策略仍然成立。
  it('keeps autoUpdater reachable in a real CommonJS dynamic import', async () => {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const script = `
import('electron-updater').then(
  (ns) => {
    const viaNamespace = 'autoUpdater' in ns;
    const viaDefault =
      typeof ns.default === 'object' && ns.default !== null && 'autoUpdater' in ns.default;
    if (!viaNamespace && !viaDefault) {
      console.error('autoUpdater unreachable via both namespace and default');
      process.exit(1);
    }
    console.log(JSON.stringify({ viaNamespace, viaDefault }));
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);`;
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ['-e', script], {
      cwd: repoRoot,
      timeout: 30_000,
    });
    expect(stderr).toBe('');
    const reachability = JSON.parse(stdout.trim().split('\n').at(-1) ?? 'null') as {
      viaNamespace: boolean;
      viaDefault: boolean;
    };
    expect(reachability.viaNamespace || reachability.viaDefault).toBe(true);
  });
});

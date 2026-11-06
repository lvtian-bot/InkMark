import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { createImageStorage, type Translate } from './image-storage';

const tempDirs: string[] = [];
const t: Translate = (key) => key;

function makeTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'inkmark-image-storage-'));
  tempDirs.push(directory);
  return directory;
}

function writeImage(filePath: string, content: string): void {
  writeFileSync(filePath, Buffer.from(`image:${content}`));
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('copyAssetsForSaveAs', () => {
  it('按正文引用复制改名后的旧附件目录，并改写副本路径', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const sourcePath = join(sourceDirectory, '新名.md');
    const targetPath = join(targetDirectory, '副本.md');
    const oldAssets = join(sourceDirectory, '旧名.assets');
    mkdirSync(oldAssets);
    writeImage(join(oldAssets, '图 1.png'), 'one');

    const content = '# 标题\n\n![图片](旧名.assets/图%201.png)';
    const result = createImageStorage({ t }).copyAssetsForSaveAs(sourcePath, targetPath, content);

    expect(result).toContain('%E5%89%AF%E6%9C%AC.assets/%E5%9B%BE%201.png');
    expect(readFileSync(join(targetDirectory, '副本.assets', '图 1.png'), 'utf8')).toBe(
      'image:one',
    );
    expect(existsSync(join(targetDirectory, '旧名.assets'))).toBe(false);
  });

  it('只复制正文实际引用的本地图片，保留在线图片和未引用附件', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const sourcePath = join(sourceDirectory, 'note.md');
    const targetPath = join(targetDirectory, 'copy.md');
    const pictures = join(sourceDirectory, 'pictures');
    mkdirSync(pictures);
    writeImage(join(pictures, 'used.jpg'), 'used');
    writeImage(join(pictures, 'unused.jpg'), 'unused');

    const content = '![used](pictures/used.jpg)\n\n![remote](https://example.com/x.png)';
    const result = createImageStorage({ t }).copyAssetsForSaveAs(sourcePath, targetPath, content);

    expect(result).toContain('copy.assets/used.jpg');
    expect(result).toContain('https://example.com/x.png');
    expect(readdirSync(join(targetDirectory, 'copy.assets'))).toEqual(['used.jpg']);
  });

  it('同一图片被多次引用时只创建一个副本', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const imagePath = join(sourceDirectory, 'image.png');
    writeImage(imagePath, 'same');
    const content = '![a](image.png)\n![b](image.png)';

    const result = createImageStorage({ t }).copyAssetsForSaveAs(
      join(sourceDirectory, 'note.md'),
      join(targetDirectory, 'copy.md'),
      content,
    );

    expect(result).toBe('![a](copy.assets/image.png)\n![b](copy.assets/image.png)');
    expect(readdirSync(join(targetDirectory, 'copy.assets'))).toEqual(['image.png']);
  });

  it('源图片缺失时不留下目标附件目录或部分副本', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const sourcePath = join(sourceDirectory, 'note.md');
    const targetPath = join(targetDirectory, 'copy.md');
    writeImage(join(sourceDirectory, 'ok.png'), 'ok');

    expect(() =>
      createImageStorage({ t }).copyAssetsForSaveAs(
        sourcePath,
        targetPath,
        '![ok](ok.png)\n![missing](missing.png)',
      ),
    ).toThrowError(expect.objectContaining({ code: 'IMAGE_COPY_FAILED' }));
    expect(existsSync(join(targetDirectory, 'copy.assets'))).toBe(false);
  });

  it('目标文档名和源图片名含空格、括号与特殊字符时仍生成可解析路径', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const sourcePath = join(sourceDirectory, 'note.md');
    const targetPath = join(targetDirectory, '副本 (#) 1.md');
    const pictures = join(sourceDirectory, '图片目录');
    mkdirSync(pictures);
    writeImage(join(pictures, '图 (1)#%.png'), 'special');

    const content = '![图片](图片目录/图%20%281%29%23%25.png)';
    const result = createImageStorage({ t }).copyAssetsForSaveAs(sourcePath, targetPath, content);
    const destination = /!\[[^\]]*\]\(([^)]+)\)/.exec(result)?.[1];

    expect(destination).toBeDefined();
    expect(decodeURIComponent(destination!)).toBe('副本 (#) 1.assets/图 (1)--.png');
    expect(existsSync(join(targetDirectory, '副本 (#) 1.assets', '图 (1)--.png'))).toBe(true);
  });

  it('已有同名同内容图片复用，冲突内容保留原图并使用序号', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const sourceImage = join(sourceDirectory, 'image.png');
    const otherImageDirectory = join(sourceDirectory, 'other');
    mkdirSync(otherImageDirectory);
    const otherImage = join(otherImageDirectory, 'image.png');
    writeImage(sourceImage, 'same');
    writeImage(otherImage, 'different');

    const targetAssets = join(targetDirectory, 'copy.assets');
    mkdirSync(targetAssets);
    writeImage(join(targetAssets, 'image.png'), 'same');
    const content = '![one](image.png)\n![two](other/image.png)';
    const result = createImageStorage({ t }).copyAssetsForSaveAs(
      join(sourceDirectory, 'note.md'),
      join(targetDirectory, 'copy.md'),
      content,
    );

    expect(result).toBe('![one](copy.assets/image.png)\n![two](copy.assets/image-1.png)');
    expect(readFileSync(join(targetAssets, 'image.png'), 'utf8')).toBe('image:same');
    expect(readFileSync(join(targetAssets, 'image-1.png'), 'utf8')).toBe('image:different');
  });

  it('支持 ../ 自定义路径、绝对路径和 file URL', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    const sharedDirectory = join(root, 'shared');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    mkdirSync(sharedDirectory);
    const parentImage = join(sharedDirectory, 'parent.png');
    const absoluteImage = join(sourceDirectory, 'absolute.jpg');
    const fileUrlImage = join(sourceDirectory, 'file-url.gif');
    writeImage(parentImage, 'parent');
    writeImage(absoluteImage, 'absolute');
    writeImage(fileUrlImage, 'file-url');

    const absoluteSource = absoluteImage.replace(/\\/g, '/');
    const content = [
      '![parent](../shared/parent.png)',
      `![absolute](${absoluteSource})`,
      `![file](${pathToFileURL(fileUrlImage).href})`,
    ].join('\n');
    const result = createImageStorage({ t }).copyAssetsForSaveAs(
      join(sourceDirectory, 'note.md'),
      join(targetDirectory, 'copy.md'),
      content,
    );

    expect(result).toContain('copy.assets/parent.png');
    expect(result).toContain('copy.assets/absolute.jpg');
    expect(result).toContain('copy.assets/file-url.gif');
    expect(readFileSync(join(targetDirectory, 'copy.assets', 'parent.png'), 'utf8')).toBe(
      'image:parent',
    );
    expect(readFileSync(join(targetDirectory, 'copy.assets', 'absolute.jpg'), 'utf8')).toBe(
      'image:absolute',
    );
    expect(readFileSync(join(targetDirectory, 'copy.assets', 'file-url.gif'), 'utf8')).toBe(
      'image:file-url',
    );
  });

  it('改写引用式图片定义并复制实际使用的图片', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    const pictures = join(sourceDirectory, 'pictures');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    mkdirSync(pictures);
    writeImage(join(pictures, 'hero.png'), 'hero');

    const content = '![Hero][hero]\n\n[hero]: pictures/hero.png "标题"';
    const result = createImageStorage({ t }).copyAssetsForSaveAs(
      join(sourceDirectory, 'note.md'),
      join(targetDirectory, 'copy.md'),
      content,
    );

    expect(result).toBe('![Hero][hero]\n\n[hero]: copy.assets/hero.png "标题"');
    expect(readFileSync(join(targetDirectory, 'copy.assets', 'hero.png'), 'utf8')).toBe(
      'image:hero',
    );
  });

  it('目标附件项为目录时拒绝并回滚本次新增图片', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    const targetAssets = join(targetDirectory, 'copy.assets');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    mkdirSync(targetAssets);
    writeImage(join(sourceDirectory, 'first.png'), 'first');
    writeImage(join(sourceDirectory, 'second.png'), 'second');
    mkdirSync(join(targetAssets, 'second.png'));

    expect(() =>
      createImageStorage({ t }).copyAssetsForSaveAs(
        join(sourceDirectory, 'note.md'),
        join(targetDirectory, 'copy.md'),
        '![first](first.png)\n![second](second.png)',
      ),
    ).toThrowError(expect.objectContaining({ code: 'IMAGE_COPY_FAILED' }));
    expect(existsSync(join(targetAssets, 'first.png'))).toBe(false);
    expect(existsSync(join(targetAssets, 'second.png'))).toBe(true);
  });

  it('目标附件项为 junction 时拒绝并回滚本次新增图片', () => {
    const root = makeTempDir();
    const sourceDirectory = join(root, 'source');
    const targetDirectory = join(root, 'target');
    const targetAssets = join(targetDirectory, 'copy.assets');
    const occupiedDirectory = join(root, 'occupied');
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    mkdirSync(targetAssets);
    mkdirSync(occupiedDirectory);
    writeImage(join(sourceDirectory, 'first.png'), 'first');
    writeImage(join(sourceDirectory, 'second.png'), 'second');
    symlinkSync(occupiedDirectory, join(targetAssets, 'second.png'), 'junction');

    expect(() =>
      createImageStorage({ t }).copyAssetsForSaveAs(
        join(sourceDirectory, 'note.md'),
        join(targetDirectory, 'copy.md'),
        '![first](first.png)\n![second](second.png)',
      ),
    ).toThrowError(expect.objectContaining({ code: 'IMAGE_COPY_FAILED' }));
    expect(existsSync(join(targetAssets, 'first.png'))).toBe(false);
    expect(existsSync(join(targetAssets, 'second.png'))).toBe(true);
  });

  it('同目录另存保持正文，不创建附件副本', () => {
    const root = makeTempDir();
    const sourcePath = join(root, 'note.md');
    const targetPath = join(root, 'copy.md');
    const content = '![image](outside/image.png)';

    expect(createImageStorage({ t }).copyAssetsForSaveAs(sourcePath, targetPath, content)).toBe(
      content,
    );
    expect(readdirSync(root)).toEqual([]);
  });
});

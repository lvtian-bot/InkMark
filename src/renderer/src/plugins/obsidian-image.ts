export const OBSIDIAN_MARK = '__obsidian_embed__';

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif|ico)$/i;

/**
 * 预处理：把 Obsidian 的 ![[image.png]] 转成标准 Markdown image，
 * 用 title 属性做标记，序列化时据此转回原格式。
 * ![[image.png|400]] 中的宽度参数暂忽略。
 * 非图片嵌入（如 ![[note]]）保持原样。
 */
export function preprocessObsidianImages(md: string): string {
  return md.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (match, path) => {
    if (IMAGE_EXT.test(path)) {
      return `![](${path} "${OBSIDIAN_MARK}")`;
    }
    return match;
  });
}

/**
 * 后处理：把 title 为标记值的 image 转回 ![[src]] 格式。
 */
export function postprocessObsidianImages(md: string): string {
  return md.replace(
    /!\[[^\]]*\]\(([^)\s]+)\s*"__obsidian_embed__"\)/g,
    (_match, src) => `![[${src}]]`
  );
}
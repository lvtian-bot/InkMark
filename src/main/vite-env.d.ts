// 主进程内以 ?raw 引入的文本资源（导出样式表）。
declare module '*.css?raw' {
  const content: string;
  export default content;
}

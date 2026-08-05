/** SVG imports are bundled as text by the plugin build. */
declare module '*.svg' {
  const content: string;
  export default content;
}

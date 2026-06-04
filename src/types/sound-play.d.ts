// Minimal ambient types for the untyped `sound-play` package.
declare module "sound-play" {
  export function play(path: string, volume?: number): Promise<void>;
  const _default: { play: typeof play };
  export default _default;
}

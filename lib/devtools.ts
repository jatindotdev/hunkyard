// The worker-pool HUD (F3) is a development instrument: live tokenizer stats, a
// theme-cycler and a scroll stress-tester. It is not part of the review
// surface, so it stays out of production bundles unless explicitly asked for.
//
// Set NEXT_PUBLIC_HUNKYARD_DEVTOOLS=1 to force it on in a production build, or
// =0 to hide it in development.
const flag = process.env.NEXT_PUBLIC_HUNKYARD_DEVTOOLS;

export const DEVTOOLS_ENABLED =
  flag === '1' ? true : flag === '0' ? false : process.env.NODE_ENV !== 'production';

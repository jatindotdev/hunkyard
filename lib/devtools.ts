// The worker-pool HUD (F3) is a development instrument: live tokenizer stats, a
// theme cycler and a scroll stress-tester. It is not part of the review
// surface, so it stays out of production builds unless asked for.
//
// Set VITE_HUNKYARD_DEVTOOLS=1 to force it on in a production build, or =0 to
// hide it in development.
//
// Reads import.meta.env rather than process.env: this module runs in the
// browser, and `process` does not exist there. Next polyfilled it, which is why
// the original spelling worked and then broke on the move to Vite.
const flag = import.meta.env.VITE_HUNKYARD_DEVTOOLS;

export const DEVTOOLS_ENABLED =
  flag === '1' ? true : flag === '0' ? false : import.meta.env.DEV;

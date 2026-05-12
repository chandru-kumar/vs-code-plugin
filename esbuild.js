// @ts-check
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const reportPlugin = {
  name: 'pilotcode-report',
  setup(build) {
    build.onStart(() => {
      console.log('[pilotcode] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach((e) =>
        console.error(`[pilotcode] error: ${e.text}`)
      );
      console.log(
        `[pilotcode] build finished${
          result.errors.length ? ' with errors' : ''
        }`
      );
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [reportPlugin],
  });

  if (watch) {
    await ctx.watch();
    console.log('[pilotcode] watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

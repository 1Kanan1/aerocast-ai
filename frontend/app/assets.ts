import { createAssetServer } from 'remix/assets'
import { componentHmr } from 'remix/component-hmr/assets'

const rootDir = process.cwd()
const nodeEnv = process.env.NODE_ENV ?? 'development'
const isDevelopment = nodeEnv === 'development'
const isHmr = Boolean(isDevelopment && process.env.REMIX_NODE_HMR)

export const assets = createAssetServer({
  basePath: '/assets',
  rootDir,

  allowFiles: [
    'app/routes.ts',
    'app/**/public/**',
    // Shared with the islands; each one is browser-safe by construction.
    'app/lib/answer.ts',
    'app/lib/format.ts',
    'app/lib/map-data.ts',
    'app/lib/monochrome.ts',
    'app/lib/observations.ts',
    'app/lib/radar.ts',
    'app/ui/answer.tsx',
    'app/ui/timeline.tsx',
  ],
  allowPackages: ['remix'],
  denyFiles: ['app/**/*.test.*'],
  sourceMaps: isDevelopment ? 'external' : undefined,
  minify: !isDevelopment,
  watch: isDevelopment,
  hmr: isHmr
    ? {
        channel: async () =>
          (await import('remix/node-hmr/runtime')).createBrowserHmrChannel(),
        moduleImporter: 'remix/multiple-import-maps-polyfill',
      }
    : undefined,
  scripts: {
    loaders: isHmr ? [componentHmr()] : undefined,
    // Vendored MapLibre build, fetched as a static file at runtime.
    external: ['/vendor/maplibre/maplibre-gl.mjs'],
  },
})

const entry = 'app/actions/public/entry.ts'

export const scriptEntry = await assets.getScriptEntry(entry)

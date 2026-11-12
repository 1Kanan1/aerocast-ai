const TILE_SIZE = 256
const TILE_ZOOM = 8

/** The window reads the radar within this radius of the station. */
export const AREA_NM = 30

export const RADAR_ATTRIBUTION =
  'Radar: <a href="https://mesonet.agron.iastate.edu/ogc/">Iowa Environmental Mesonet</a>'

/** Coverage is reported per compass sector, north first, clockwise. */
export const SECTORS = 8

/**
 * NEXRAD's own ramp, light to heavy, mapped onto a blue-to-red weather ramp:
 * light echo is cold blue, heavier cores warm towards yellow and red. The
 * source colours are a smooth blend, so each pixel takes the nearest step.
 */
const ECHO_RAMP: {
  from: [number, number, number]
  to: [number, number, number]
}[] = [
  { from: [170, 176, 180], to: [214, 236, 247] },
  { from: [144, 152, 180], to: [180, 218, 238] },
  { from: [108, 125, 170], to: [143, 199, 227] },
  { from: [79, 103, 162], to: [108, 178, 214] },
  { from: [67, 94, 159], to: [84, 160, 200] },
  { from: [12, 149, 16], to: [96, 176, 170] },
  { from: [16, 196, 22], to: [150, 196, 122] },
  { from: [82, 214, 162], to: [232, 214, 120] },
  { from: [240, 220, 40], to: [232, 163, 90] },
  { from: [230, 150, 40], to: [217, 103, 79] },
  { from: [230, 60, 50], to: [184, 66, 58] },
]

export interface RadarWindow {
  /** PNG data URL of the recolored window, transparent where there is no echo. */
  image: string
  /** Share of the disc with an echo, 0 to 1. */
  total: number
  /** Share of each sector with an echo, north first, clockwise. */
  sectors: number[]
}

/** Rewrite each echo pixel to the nearest step of the window ramp. */
export function recolorEchoes(pixels: Uint8ClampedArray): void {
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 24) {
      pixels[index + 3] = 0
      continue
    }

    let red = pixels[index]
    let green = pixels[index + 1]
    let blue = pixels[index + 2]
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY

    for (let step = 0; step < ECHO_RAMP.length; step++) {
      let from = ECHO_RAMP[step].from
      let dr = red - from[0]
      let dg = green - from[1]
      let db = blue - from[2]
      let distance = dr * dr + dg * dg + db * db
      if (distance < bestDistance) {
        bestDistance = distance
        best = step
      }
    }

    let to = ECHO_RAMP[best].to
    pixels[index] = to[0]
    pixels[index + 1] = to[1]
    pixels[index + 2] = to[2]
  }
}

/** Count echo pixels inside the disc, overall and per compass sector. */
export function radarCoverage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
): { total: number; sectors: number[] } {
  let echoes = Array.from({ length: SECTORS }, () => 0)
  let seen = Array.from({ length: SECTORS }, () => 0)
  let echoTotal = 0
  let areaTotal = 0
  let radiusSquared = radius * radius

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dx = x - centerX
      let dy = y - centerY
      if (dx * dx + dy * dy > radiusSquared) continue

      let angle = Math.atan2(dx, -dy)
      let turn = (angle + Math.PI * 2) % (Math.PI * 2)
      let sector = Math.floor(turn / ((Math.PI * 2) / SECTORS))

      seen[sector] += 1
      areaTotal += 1
      if (pixels[(y * width + x) * 4 + 3] > 24) {
        echoes[sector] += 1
        echoTotal += 1
      }
    }
  }

  return {
    total: areaTotal === 0 ? 0 : echoTotal / areaTotal,
    sectors: echoes.map((count, index) =>
      seen[index] === 0 ? 0 : count / seen[index],
    ),
  }
}

/**
 * The tiles are shared: neighbouring stations ask for the same ones, and each
 * window is a square of tiles, so the overlap is large. One request per tile.
 */
const tileCache = new Map<string, Promise<Blob | null>>()
const MAX_TILES = 240

function fetchTile(url: string): Promise<Blob | null> {
  let cached = tileCache.get(url)
  if (cached !== undefined) return cached

  let promise = fetch(url)
    .then((response) => (response.ok ? response.blob() : null))
    .catch(() => null)
  tileCache.set(url, promise)
  if (tileCache.size > MAX_TILES) {
    let oldest = tileCache.keys().next()
    if (!oldest.done) tileCache.delete(oldest.value)
  }
  return promise
}

/**
 * Fetch only the tiles that cover the disc around the station, composite them,
 * soften the pixel edges, recolor and measure. One request set per station,
 * and nothing outside the radius is read.
 */
export async function fetchRadarWindow(
  lat: number,
  lon: number,
  radiusNm: number,
  signal: AbortSignal,
): Promise<RadarWindow | null> {
  let scale = TILE_SIZE * 2 ** TILE_ZOOM
  let worldX = ((lon + 180) / 360) * scale
  let latRadians = (lat * Math.PI) / 180
  let worldY =
    ((1 - Math.log(Math.tan(latRadians) + 1 / Math.cos(latRadians)) / Math.PI) /
      2) *
    scale
  let metersPerPixel = (156543.03392 * Math.cos(latRadians)) / 2 ** TILE_ZOOM
  let radius = (radiusNm * 1852) / metersPerPixel
  let half = Math.ceil(radius) + 1

  let canvas = document.createElement('canvas')
  canvas.width = half * 2
  canvas.height = half * 2
  let context = canvas.getContext('2d')
  if (context === null) return null
  context.imageSmoothingEnabled = false

  let originX = worldX - half
  let originY = worldY - half
  let firstTileX = Math.floor(originX / TILE_SIZE)
  let lastTileX = Math.floor((originX + canvas.width) / TILE_SIZE)
  let firstTileY = Math.floor(originY / TILE_SIZE)
  let lastTileY = Math.floor((originY + canvas.height) / TILE_SIZE)

  let tiles: Promise<void>[] = []
  for (let tileY = firstTileY; tileY <= lastTileY; tileY++) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX++) {
      let url = `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${TILE_ZOOM}/${tileX}/${tileY}.png`
      tiles.push(
        fetchTile(url)
          .then(async (blob) => {
            if (blob === null) return
            let bitmap = await createImageBitmap(blob)
            context?.drawImage(
              bitmap,
              tileX * TILE_SIZE - originX,
              tileY * TILE_SIZE - originY,
            )
            bitmap.close()
          })
          .catch(() => {}),
      )
    }
  }

  try {
    await Promise.all(tiles)
    if (signal.aborted) return null

    // Soften the 1 km bins before reading colours, so the window reads as a
    // field rather than as blocks.
    let soft = document.createElement('canvas')
    soft.width = canvas.width
    soft.height = canvas.height
    let smooth = soft.getContext('2d')
    if (smooth === null) return null
    smooth.filter = 'blur(2.5px)'
    smooth.drawImage(canvas, 0, 0)

    let image = smooth.getImageData(0, 0, soft.width, soft.height)
    let coverage = radarCoverage(
      image.data,
      soft.width,
      soft.height,
      half,
      half,
      radius,
    )
    recolorEchoes(image.data)
    smooth.putImageData(image, 0, 0)

    return {
      image: smooth.canvas.toDataURL('image/png'),
      ...coverage,
    }
  } catch {
    return null
  }
}

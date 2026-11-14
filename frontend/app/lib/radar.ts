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

/**
 * A droplet of echo, placed once per radar fetch and moved thereafter. The
 * position is a fraction of the window's half-size, so a zoom only scales it;
 * the level carries the intensity, and every draw property is set from it.
 */
export interface RadarDrop {
  /** -1 to 1 across the window, north up. */
  x: number
  y: number
  /** Which of the echo levels it belongs to: 0 lightest to 3 heaviest. */
  level: number
  /** Where in its fall loop it starts, 0 to 1. */
  phase: number
  /** How far it may fall before leaving its own echo, as a fraction of the half-size. */
  travel: number
}

export interface RadarWindow {
  /** Share of the disc with an echo, 0 to 1. */
  total: number
  /** Share of each sector with an echo, north first, clockwise. */
  sectors: number[]
  /** The echo as droplets, already placed in window coordinates. */
  drops: RadarDrop[]
}

/** The echo steps folded into levels, so that each level can look different. */
export const ECHO_LEVELS = 4

/** The level a ramp step belongs to, 0 lightest to 3 heaviest. */
export function echoLevel(step: number): number {
  return Math.min(
    ECHO_LEVELS - 1,
    Math.floor((step * ECHO_LEVELS) / ECHO_RAMP.length),
  )
}

/**
 * Share of a cell's samples that become drops, per level. The gaps are wide
 * on purpose: a level has to be told apart from its neighbour at a glance,
 * so light echo is nearly bare and heavy echo is nearly solid.
 */
const DENSITY = [0.06, 0.2, 0.45, 0.7]

/**
 * Read the window as echo steps: 0 for clear, then 1 to 11 along the ramp.
 * The colours themselves are not painted any more, so this only names what
 * each pixel is worth.
 */
export function echoSteps(pixels: Uint8ClampedArray): Uint8Array {
  let steps = new Uint8Array(pixels.length / 4)
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 24) continue

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

    steps[index / 4] = best + 1
  }
  return steps
}

/** How many pixels one drop stands for; the window is read at this size. */
const DROP_CELL = 3

/** The furthest a drop may fall before it would leave its own colour. */
const DROP_RUN = 8

/**
 * The direction the rain falls in, as a unit vector in window pixels. Kept
 * here because the drops have to be checked against it: a drop is coloured by
 * the echo it sits in, so it may only fall as far as that echo reaches.
 */
export const RAIN_FALL = {
  ux: Math.sin(0.22),
  uy: Math.cos(0.22),
}

/**
 * Turn the echo into droplets. Light echo gives few, small drops; a heavy
 * core gives many, larger ones, which is what makes the field read as rain
 * rather than as a coloured wash. The scatter is a hash of the cell, so the
 * same window always produces the same drops and a test can say so.
 */
export function radarDrops(
  steps: Uint8Array,
  width: number,
  half: number,
): RadarDrop[] {
  let drops: RadarDrop[] = []
  let heaviest = ECHO_RAMP.length - 1

  for (let y = 0; y < width; y += DROP_CELL) {
    for (let x = 0; x < width; x += DROP_CELL) {
      let echo = 0
      let sum = 0
      let seen = 0

      for (let dy = 0; dy < DROP_CELL; dy++) {
        for (let dx = 0; dx < DROP_CELL; dx++) {
          let px = x + dx
          let py = y + dy
          if (px >= width || py >= width) continue
          seen += 1
          let step = steps[py * width + px]
          if (step === 0) continue
          echo += 1
          sum += step - 1
        }
      }

      if (echo === 0 || seen === 0) continue
      let strength = sum / echo / heaviest
      let cell = echoLevel(Math.round(strength * heaviest))
      if (scatter(x, y) > DENSITY[cell]) continue

      let across = x + DROP_CELL * scatter(y, x)
      let down = y + DROP_CELL * scatter(x + 7, y + 13)
      if (Math.hypot(across - half, down - half) > half) continue

      // The drop takes the colour of the pixel it lands on, not the cell's
      // average, so it can never sit in one echo wearing another's colour.
      let px = Math.round(across)
      let py = Math.round(down)
      let echoStep = steps[py * width + px]
      if (echoStep === 0) continue

      // Then it may only fall while the echo under it stays that colour.
      let run = 0
      for (let ahead = 1; ahead <= DROP_RUN; ahead++) {
        let sx = Math.round(across + RAIN_FALL.ux * ahead)
        let sy = Math.round(down + RAIN_FALL.uy * ahead)
        if (sx < 0 || sy < 0 || sx >= width || sy >= width) break
        if (steps[sy * width + sx] !== echoStep) break
        run = ahead
      }
      if (run === 0) continue

      drops.push({
        x: (across - half) / half,
        y: (down - half) / half,
        level: echoLevel(echoStep - 1),
        phase: scatter(x + 11, y + 17),
        travel: run / half,
      })
    }
  }

  return drops
}

/** A stable 0..1 from a cell coordinate: same window, same drops. */
function scatter(x: number, y: number): number {
  let hash = (x * 374761393 + y * 668265263) | 0
  hash = (hash ^ (hash >>> 13)) * 1274126177
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
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
 * soften the pixel edges, then measure the coverage and place the echo as
 * droplets. One request set per station, and nothing outside the radius is
 * read.
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
    let steps = echoSteps(image.data)

    return {
      ...coverage,
      drops: radarDrops(steps, soft.width, half),
    }
  } catch {
    return null
  }
}

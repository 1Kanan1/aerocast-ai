/** The basemap ships color; the interface is monochrome by design. */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB =
  /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i

/** Walk a style object and replace every color with its grey equivalent. */
export function toMonochrome<T>(value: T): T {
  return walk(value, false)
}

/** The same walk, inverted, for a dark basemap built from a light style. */
export function toDarkMonochrome<T>(value: T): T {
  return walk(value, true)
}

function walk<T>(value: T, invert: boolean): T {
  if (typeof value === 'string') return recolour(value, invert) as T
  if (Array.isArray(value)) return value.map((item) => walk(item, invert)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, walk(item, invert)]),
    ) as T
  }
  return value
}

function recolour(value: string, invert: boolean): string {
  if (HEX.test(value)) {
    let digits =
      value.length === 4
        ? value
            .slice(1)
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : value.slice(1)

    return hexGrey(
      shade(
        greyValue(
          Number.parseInt(digits.slice(0, 2), 16),
          Number.parseInt(digits.slice(2, 4), 16),
          Number.parseInt(digits.slice(4, 6), 16),
        ),
        invert,
      ),
    )
  }

  let rgb = RGB.exec(value)
  if (rgb) {
    let grey = shade(
      greyValue(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])),
      invert,
    )
    return rgb[4] === undefined
      ? `rgb(${grey}, ${grey}, ${grey})`
      : `rgba(${grey}, ${grey}, ${grey}, ${rgb[4]})`
  }

  return value
}

function shade(grey: number, invert: boolean): number {
  return invert ? 255 - grey : grey
}

function greyValue(red: number, green: number, blue: number): number {
  return Math.round(0.299 * red + 0.587 * green + 0.114 * blue)
}

function hexGrey(grey: number): string {
  let pair = grey.toString(16).padStart(2, '0')
  return `#${pair}${pair}${pair}`
}

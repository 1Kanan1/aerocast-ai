/** The basemap ships color; the interface is monochrome by design. */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB =
  /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i

/** Walk a style object and replace every color with its grey equivalent. */
export function toMonochrome<T>(value: T): T {
  if (typeof value === 'string') return recolour(value) as T
  if (Array.isArray(value)) return value.map(toMonochrome) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toMonochrome(item)]),
    ) as T
  }
  return value
}

function recolour(value: string): string {
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
      greyValue(
        Number.parseInt(digits.slice(0, 2), 16),
        Number.parseInt(digits.slice(2, 4), 16),
        Number.parseInt(digits.slice(4, 6), 16),
      ),
    )
  }

  let rgb = RGB.exec(value)
  if (rgb) {
    let grey = greyValue(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]))
    return rgb[4] === undefined
      ? `rgb(${grey}, ${grey}, ${grey})`
      : `rgba(${grey}, ${grey}, ${grey}, ${rgb[4]})`
  }

  return value
}

function greyValue(red: number, green: number, blue: number): number {
  return Math.round(0.299 * red + 0.587 * green + 0.114 * blue)
}

function hexGrey(grey: number): string {
  let pair = grey.toString(16).padStart(2, '0')
  return `#${pair}${pair}${pair}`
}

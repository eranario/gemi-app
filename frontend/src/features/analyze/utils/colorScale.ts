import { scaleLinear } from "d3-scale"

/** Return 2nd and 98th percentile of an array of numbers. */
export function percentileRange(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  const sorted = [...values].sort((a, b) => a - b)
  const lo = sorted[Math.floor(sorted.length * 0.02)]
  const hi = sorted[Math.ceil(sorted.length * 0.98) - 1]
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi]
}

/** True if the column name suggests temperature (reverse the color ramp). */
export function isTempColumn(col: string): boolean {
  return /temp|celsius|fahrenheit/i.test(col)
}

/**
 * Build a d3 scale that maps a numeric value → [r, g, b, a] uint8 array.
 * Red → Blue by default; Blue → Red for temperature columns.
 */
export function buildColorScale(
  min: number,
  max: number,
  column: string,
): (value: number | null | undefined) => [number, number, number, number] {
  const reverse = isTempColumn(column)

  const ramp = reverse
    ? scaleLinear<string>().domain([min, max]).range(["#2563eb", "#dc2626"]).clamp(true)
    : scaleLinear<string>().domain([min, max]).range(["#dc2626", "#2563eb"]).clamp(true)

  return (value) => {
    if (value == null || isNaN(value as number)) return [128, 128, 128, 180]
    const hex = ramp(value as number)
    return hexToRgba(hex, 200)
  }
}

function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace("#", "")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return [r, g, b, alpha]
}

/** CSS gradient string for the legend (left = low, right = high). */
export function legendGradient(column: string): string {
  return isTempColumn(column)
    ? "linear-gradient(to right, #2563eb, #dc2626)"
    : "linear-gradient(to right, #dc2626, #2563eb)"
}

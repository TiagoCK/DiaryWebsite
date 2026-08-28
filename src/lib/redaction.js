/**
 * Mapping redaction boxes between the original image and a rotated view of it.
 *
 * Boxes are stored as percentages of the ORIGINAL image, before any rotation or
 * crop. That is the only space that stays stable when the geometry changes: a
 * box stored relative to a cropped view would cover different content the
 * moment the crop moved, and for a censor bar that is a leak rather than a
 * cosmetic slip.
 *
 * The editor shows the image at its current rotation so bars are placed the way
 * a reader sees the page, which means converting on the way in and out.
 */

/**
 * A box given in ORIGINAL space, expressed in the space of the image rotated
 * clockwise by `rotation` degrees. All values are percentages.
 *
 * Derivation for 90 degrees clockwise: the original's top-left corner becomes
 * the rotated image's top-right, so an original x becomes a rotated y, and an
 * original y becomes a rotated x measured from the far edge. Width and height
 * swap. 180 is its own inverse; 270 is the mirror of 90.
 */
export function toRotatedSpace(box, rotation) {
  const r = normalise(rotation);
  const { x, y, width, height } = box;

  if (r === 90) return { x: 100 - y - height, y: x, width: height, height: width };
  if (r === 180) return { x: 100 - x - width, y: 100 - y - height, width, height };
  if (r === 270) return { x: y, y: 100 - x - width, width: height, height: width };
  return { x, y, width, height };
}

/**
 * The inverse: a box drawn on the rotated view, expressed in ORIGINAL space.
 *
 * Rotating back by (360 - rotation) is the same operation, so this reuses the
 * forward mapping rather than repeating four hand-derived cases that could
 * disagree with it.
 */
export function toOriginalSpace(box, rotation) {
  return toRotatedSpace(box, (360 - normalise(rotation)) % 360);
}

/** Clamp a box to the image and drop anything with no area. Returns null if unusable. */
export function sanitiseBox(box) {
  const x = clampPercent(box?.x);
  const y = clampPercent(box?.y);
  const width = Math.min(clampPercent(box?.width), 100 - x);
  const height = Math.min(clampPercent(box?.height), 100 - y);
  if (!(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

export function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function normalise(rotation) {
  const r = Number(rotation) || 0;
  return ((Math.round(r / 90) * 90) % 360 + 360) % 360;
}

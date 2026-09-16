/**
 * The maths behind the zoom overlay, with no DOM in sight.
 *
 * Pan and zoom is the kind of thing that looks right until it is subtly wrong --
 * the image drifts under the cursor, or you can drag it off screen and lose it.
 * Both are arithmetic mistakes, so the arithmetic lives here where it can be
 * exercised directly rather than by dragging at a browser.
 *
 * The model: `scale` multiplies the image's natural size, and `offset` is the
 * position of the image's top-left corner in container coordinates.
 */

/** Zoom limits. 1 is the image's natural pixel size, not "fit to window". */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

/** The scale at which the whole image fits inside the container. */
export function fitScale(container, image) {
  if (!container?.width || !container?.height || !image?.width || !image?.height) return 1;
  return Math.min(container.width / image.width, container.height / image.height);
}

export function clampScale(scale, { min = MIN_SCALE, max = MAX_SCALE } = {}) {
  if (!Number.isFinite(scale)) return min;
  return Math.min(max, Math.max(min, scale));
}

/**
 * Keep the image sensibly placed in the container.
 *
 * Two cases, and getting the first wrong is what makes an image "stick" to a
 * corner instead of sitting still:
 *
 *   smaller than the container  centre it on that axis, ignoring the drag
 *   larger                      allow panning, but never past an edge, so the
 *                               container is always fully covered
 */
export function clampOffset(offset, { container, image, scale }) {
  const shown = { width: image.width * scale, height: image.height * scale };

  const axis = (value, containerSize, shownSize) => {
    if (shownSize <= containerSize) return (containerSize - shownSize) / 2;
    // Left/top edge cannot go positive, right/bottom cannot come inside.
    return Math.min(0, Math.max(containerSize - shownSize, value));
  };

  return {
    x: axis(offset.x, container.width, shown.width),
    y: axis(offset.y, container.height, shown.height),
  };
}

/**
 * Zoom about a point, keeping whatever is under that point exactly where it is.
 *
 * The whole feel of wheel-zoom rests on this. Without it the image scales about
 * its own corner and the thing you were looking at slides away, which reads as
 * the page moving on its own.
 *
 * `point` is in container coordinates -- the cursor position, or the container
 * centre for the +/- buttons.
 */
export function zoomAt({ scale, offset }, point, factor, bounds = {}) {
  const next = clampScale(scale * factor, bounds);

  // Where the point sits on the image, in unscaled image pixels. That has to
  // land back under the cursor once the scale changes.
  const imageX = (point.x - offset.x) / scale;
  const imageY = (point.y - offset.y) / scale;

  return {
    scale: next,
    offset: { x: point.x - imageX * next, y: point.y - imageY * next },
  };
}

/** Fit the image to the container, centred. The state the overlay opens in. */
export function fitState(container, image) {
  const scale = clampScale(fitScale(container, image));
  return { scale, offset: clampOffset({ x: 0, y: 0 }, { container, image, scale }) };
}

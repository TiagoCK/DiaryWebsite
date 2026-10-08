"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { clampOffset, clampScale, fitState, MAX_SCALE, zoomAt } from "@/lib/zoom";

/** How much one wheel notch changes the scale. */
const WHEEL_STEP = 1.15;

/** What the +/- buttons do, and what double-click toggles up to. */
const BUTTON_STEP = 1.4;

/**
 * One scan, filling the window, zoomable and pannable.
 *
 * The book frame shows a spread at about 900px wide, so a single page lands
 * near 450px on screen -- a quarter of a laptop window, on handwriting. This is
 * the answer to that, and mostly it is buying SIZE: the scans themselves are
 * around 512px per page, so past roughly 200% it is enlarging blur rather than
 * revealing anything. The zoom percentage is shown so that is visible rather
 * than mysterious.
 *
 * All the arithmetic lives in src/lib/zoom.js, where it is tested. This file is
 * events, refs and focus.
 */
export default function PageZoom({ page, label, onClose }) {
  const frameRef = useRef(null);
  const imageRef = useRef(null);
  const closeRef = useRef(null);
  const draggingRef = useRef(null);

  // null until the image reports its size; there is nothing to fit before that.
  const [view, setView] = useState(null);
  const [natural, setNatural] = useState(null);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image?.naturalWidth) return;

    const size = { width: image.naturalWidth, height: image.naturalHeight };
    setNatural(size);
    setView(
      fitState({ width: frame.clientWidth, height: frame.clientHeight }, size)
    );
  }, []);

  // Re-fit when the window changes shape; a fitted image should stay fitted.
  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  /*
   * Focus moves into the overlay and returns where it came from.
   *
   * Without the restore, closing drops focus to <body> and a keyboard user has
   * to tab from the top of the page back to where they were reading.
   */
  useLayoutEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Apply a scale change about a point, then keep the result on screen. */
  const applyZoom = useCallback(
    (factor, point) => {
      setView((current) => {
        const frame = frameRef.current;
        if (!current || !frame || !natural) return current;

        const container = { width: frame.clientWidth, height: frame.clientHeight };
        const at =
          point ?? { x: container.width / 2, y: container.height / 2 };

        const next = zoomAt(current, at, factor);
        return {
          scale: next.scale,
          offset: clampOffset(next.offset, { container, image: natural, scale: next.scale }),
        };
      });
    },
    [natural]
  );

  const onWheel = (event) => {
    // Not preventDefault'd via onWheel alone -- React attaches it passively, so
    // the page can still scroll behind. The overlay is fixed and covers the
    // viewport, so there is nothing behind it to scroll.
    const frame = frameRef.current;
    if (!frame) return;
    const box = frame.getBoundingClientRect();
    applyZoom(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    draggingRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: view?.offset,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !drag.origin) return;

    const frame = frameRef.current;
    if (!frame || !natural) return;

    setView((current) => {
      if (!current) return current;
      const moved = {
        x: drag.origin.x + (event.clientX - drag.startX),
        y: drag.origin.y + (event.clientY - drag.startY),
      };
      return {
        scale: current.scale,
        offset: clampOffset(moved, {
          container: { width: frame.clientWidth, height: frame.clientHeight },
          image: natural,
          scale: current.scale,
        }),
      };
    });
  };

  const endDrag = (event) => {
    if (draggingRef.current?.pointerId === event.pointerId) draggingRef.current = null;
  };

  /** Double-click toggles between fitted and a step closer. */
  const onDoubleClick = (event) => {
    const frame = frameRef.current;
    if (!frame || !natural || !view) return;
    const container = { width: frame.clientWidth, height: frame.clientHeight };
    const fitted = fitState(container, natural);

    if (Math.abs(view.scale - fitted.scale) < 0.01) {
      const box = frame.getBoundingClientRect();
      applyZoom(BUTTON_STEP * 1.5, { x: event.clientX - box.left, y: event.clientY - box.top });
    } else {
      setView(fitted);
    }
  };

  const percent = view ? Math.round(view.scale * 100) : 100;
  const atLimit = view ? clampScale(view.scale) >= MAX_SCALE : false;

  return (
    <div
      className="zoom"
      role="dialog"
      aria-modal="true"
      aria-label={`${label}, zoomable`}
      onPointerDown={(event) => {
        // Only a click on the backdrop itself closes; a drag that happens to
        // end here should not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="zoom__bar">
        <span className="zoom__label">{label}</span>

        <span className="zoom__controls">
          <button type="button" onClick={() => applyZoom(1 / BUTTON_STEP)} aria-label="Zoom out">
            &minus;
          </button>
          <span className="zoom__percent" aria-live="polite">
            {percent}%
          </span>
          <button
            type="button"
            onClick={() => applyZoom(BUTTON_STEP)}
            aria-label="Zoom in"
            disabled={atLimit}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => natural && frameRef.current && setView(
              fitState(
                { width: frameRef.current.clientWidth, height: frameRef.current.clientHeight },
                natural
              )
            )}
          >
            Fit
          </button>
          <button type="button" ref={closeRef} onClick={onClose} className="zoom__close">
            Close
          </button>
        </span>
      </div>

      <div
        className="zoom__frame"
        ref={frameRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      >
        <img
          ref={imageRef}
          className="zoom__image"
          src={page.src}
          alt={label}
          onLoad={measure}
          draggable="false"
          style={
            view
              ? {
                  width: natural.width * view.scale,
                  height: natural.height * view.scale,
                  transform: `translate(${view.offset.x}px, ${view.offset.y}px)`,
                }
              : { visibility: "hidden" }
          }
        />
      </div>
    </div>
  );
}

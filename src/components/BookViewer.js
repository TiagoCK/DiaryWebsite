"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { halfOf } from "@/lib/views";

const FLIP_MS = 600;

/** One half of the open book: half a spread, a whole single page, or blank. */
function Half({ half }) {
  if (!half) return <div className="half half--blank" aria-hidden="true" />;

  const { page, clip } = half;
  return (
    <div className={`half ${clip ? `half--clip-${clip}` : "half--whole"}`}>
      {/* Plain <img>: the clipping relies on absolute positioning, and browsers
          apply these files' EXIF rotation natively. width/height are the
          display dimensions, so the box is reserved before the bytes land. */}
      <img
        src={page.src}
        width={page.width}
        height={page.height}
        alt=""
        draggable="false"
        decoding="async"
      />
    </div>
  );
}

export default function BookViewer({ views, totalPages }) {
  const [index, setIndex] = useState(0);
  // null at rest; otherwise { dir, target, phase } for the flip in flight.
  const [flip, setFlip] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Mirrors `flip` so callbacks can read it without going stale.
  const flipRef = useRef(null);
  const leafRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const settle = useCallback(() => {
    const active = flipRef.current;
    if (!active) return;
    clearTimeout(timerRef.current);
    flipRef.current = null;
    setIndex(active.target);
    setFlip(null);
  }, []);

  const go = useCallback(
    (dir) => {
      // A flip already running owns the leaf; a second one would animate from
      // a half-rotated state.
      if (flipRef.current) return;
      const target = dir === "next" ? index + 1 : index - 1;
      if (target < 0 || target >= views.length) return;

      if (reducedMotion) {
        setIndex(target);
        return;
      }

      const next = { dir, target, phase: "start" };
      flipRef.current = next;
      setFlip(next);

      // Settle even if the transition never reports finishing. A backgrounded
      // tab freezes rAF and throttles transitions, so without this the leaf
      // would hang mid-turn and leave navigation permanently disabled.
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(settle, FLIP_MS + 150);
    },
    [index, views.length, reducedMotion, settle]
  );

  // Commit the leaf's starting angle before moving it, or the browser collapses
  // both styles into one recalculation and nothing animates. Reading the
  // computed style forces that flush; rAF would be tidier but never fires while
  // the tab is hidden.
  useLayoutEffect(() => {
    if (flip?.phase !== "start") return;
    if (leafRef.current) getComputedStyle(leafRef.current).transform;
    const running = { ...flip, phase: "run" };
    flipRef.current = running;
    setFlip(running);
  }, [flip]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "ArrowRight") go("next");
      else if (event.key === "ArrowLeft") go("prev");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const current = views[index];
  const target = flip ? views[flip.target] : null;
  const forward = flip?.dir === "next";

  // While a leaf turns, one static side already belongs to the view being
  // revealed: turning forward uncovers the next view's right side, turning back
  // uncovers the previous view's left side.
  const leftHalf = halfOf(flip && !forward ? target : current, "left");
  const rightHalf = halfOf(flip && forward ? target : current, "right");

  // The back face is what shows once the leaf passes vertical.
  const leafFront = forward ? halfOf(current, "right") : halfOf(target, "right");
  const leafBack = forward ? halfOf(target, "left") : halfOf(current, "left");

  const atStart = flip?.phase === "start";
  const leafAngle = flip && (forward ? !atStart : atStart) ? -180 : 0;

  const neighbours = [views[index - 1], views[index + 1]].filter(Boolean);

  return (
    <div className="viewer">
      <div className="book">
        <div className="slot slot--left">
          <Half half={leftHalf} />
        </div>
        <div className="slot slot--right">
          <Half half={rightHalf} />
        </div>

        {flip && (
          <div
            ref={leafRef}
            className="leaf"
            style={{
              transform: `rotateY(${leafAngle}deg)`,
              transition: atStart
                ? "none"
                : `transform ${FLIP_MS}ms cubic-bezier(0.33, 0, 0.2, 1)`,
            }}
            onTransitionEnd={(event) => {
              if (event.propertyName === "transform") settle();
            }}
          >
            <div className="leaf__face leaf__face--front">
              <Half half={leafFront} />
            </div>
            <div className="leaf__face leaf__face--back">
              <Half half={leafBack} />
            </div>
          </div>
        )}

        <div className="spine" aria-hidden="true" />
      </div>

      <nav className="controls">
        <button type="button" onClick={() => go("prev")} disabled={index === 0 || !!flip}>
          &larr; Previous
        </button>
        <span className="counter" aria-live="polite">
          {current.label} <span className="counter__total">of {totalPages}</span>
        </span>
        <button
          type="button"
          onClick={() => go("next")}
          disabled={index === views.length - 1 || !!flip}
        >
          Next &rarr;
        </button>
      </nav>

      {/* Only the immediate neighbours are fetched ahead, so a flip never stalls
          while the rest of the diary stays unrequested. */}
      <div className="preload" aria-hidden="true">
        {neighbours.flatMap((view) =>
          view.pages.map((page) => (
            <img key={page.pageId} src={page.src} alt="" decoding="async" />
          ))
        )}
      </div>
    </div>
  );
}

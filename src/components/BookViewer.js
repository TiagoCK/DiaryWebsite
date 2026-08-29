"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import HighlightedLine from "@/components/HighlightedLine";
import { searchPages } from "@/lib/search";
import { halfOf, viewIndexForPage } from "@/lib/views";

const FLIP_MS = 600;

/** Enough to be useful without turning the viewer into a list; the rest are counted. */
const MAX_RESULTS = 8;

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

export default function BookViewer({
  views,
  totalPages,
  animate = true,
  renderToolbar,
  initialIndex = 0,
}) {
  // Only the starting point. /?page=N is resolved on the server; the component
  // is keyed on it there, so arriving at a second deep link remounts rather
  // than being ignored by this initialiser.
  const [index, setIndex] = useState(initialIndex);
  // null at rest; otherwise { dir, target, phase } for the flip in flight.
  const [flip, setFlip] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [jumpError, setJumpError] = useState("");
  const [query, setQuery] = useState("");

  // The admin editor turns the flip off: 600ms per step is tiring when you are
  // stepping through looking for scans to fix. Reuses the reduced-motion branch
  // below rather than introducing a second way to skip the animation.
  const skipAnimation = !animate || reducedMotion;

  // Mirrors `flip` so callbacks can read it without going stale.
  const flipRef = useRef(null);
  const leafRef = useRef(null);
  const timerRef = useRef(null);
  const jumpId = useId();
  const searchId = useId();

  // Results are per PAGE, not per view: a paired view holds two single pages
  // with a first line each, and saying which one matched is the useful part.
  const allPages = useMemo(() => views.flatMap((view) => view.pages), [views]);
  const matches = useMemo(() => searchPages(allPages, query), [allPages, query]);

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

  /** Move to a view by index, animating only when it is the next one along. */
  const goToIndex = useCallback(
    (target) => {
      // A flip already running owns the leaf; a second one would animate from
      // a half-rotated state.
      if (flipRef.current) return;
      if (target < 0 || target >= views.length || target === index) return;

      const step = target - index;

      // The leaf turns exactly one view, so a jump further than that has no
      // leaf to turn and lands directly.
      if (skipAnimation || Math.abs(step) !== 1) {
        setIndex(target);
        return;
      }

      const next = { dir: step === 1 ? "next" : "prev", target, phase: "start" };
      flipRef.current = next;
      setFlip(next);

      // Settle even if the transition never reports finishing. A backgrounded
      // tab freezes rAF and throttles transitions, so without this the leaf
      // would hang mid-turn and leave navigation permanently disabled.
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(settle, FLIP_MS + 150);
    },
    [index, views.length, skipAnimation, settle]
  );

  const go = useCallback(
    (dir) => goToIndex(dir === "next" ? index + 1 : index - 1),
    [goToIndex, index]
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
    // The cascading render the linter warns about is the mechanism here, not a
    // mistake: the leaf has to be committed at its starting angle with no
    // transition, the browser has to recalculate, and only then can the angle
    // change with a transition attached. One render cannot express that, and
    // adjusting state during render would not give the browser its flush.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlip(running);
  }, [flip]);

  useEffect(() => {
    const onKey = (event) => {
      // Left and Right are caret movement inside a text field, and the jump
      // input sits in these very controls. Without this, typing a page number
      // would flip the book and preventDefault() would freeze the caret.
      const el = event.target;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      ) {
        return;
      }

      if (event.key === "ArrowRight") go("next");
      else if (event.key === "ArrowLeft") go("prev");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const onJump = (event) => {
    event.preventDefault();
    if (flipRef.current) return;

    const raw = jumpValue.trim();
    const numeric = /^\d+$/.test(raw);
    const target = numeric ? viewIndexForPage(views, Number(raw)) : -1;

    if (target < 0) {
      // A number inside the range that still matches no view means a gap left
      // by a deleted page. Saying so beats repeating the range back at someone
      // who already typed something inside it.
      setJumpError(
        numeric && Number(raw) >= 1 && Number(raw) <= totalPages
          ? `There is no page ${raw} in this diary.`
          : `Pages run 1–${totalPages}.`
      );
      return;
    }

    // Cleared rather than left showing what was typed: the counter beside it
    // already says where you are, and the field is ready for the next jump.
    setJumpError("");
    setJumpValue("");
    goToIndex(target);
  };

  // An empty diary is a reachable state -- a fresh project before the first
  // upload, or every page deleted. Without this, views[0] is undefined and
  // reading current.label below throws, taking down both the reader and the
  // admin editor with a 500 and no way back from inside the app.
  const current = views[index];
  if (!current) {
    return (
      <div className="viewer">
        <p className="admin__note">
          No pages yet. Drop scans into <code>images/incoming/</code> and run{" "}
          <code>npm run add -- --commit</code>.
        </p>
      </div>
    );
  }

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
      {renderToolbar && <div className="viewer__toolbar">{renderToolbar(current)}</div>}

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
        {/* Counter and jump field are one flex child, so .controls keeps its
            three columns and Previous/Next stay pinned to the edges. */}
        <div className="controls__center">
          <span className="counter" aria-live="polite">
            {current.label} <span className="counter__total">of {totalPages}</span>
          </span>

          {/* noValidate, with min/max kept for the spinner and screen readers:
              otherwise the browser blocks submit on an out-of-range number and
              onJump never runs, so the message below could only ever report a
              gap. One rule, one place, one wording. */}
          <form className="jump" onSubmit={onJump} noValidate>
            <label className="jump__label" htmlFor={jumpId}>
              Go to page
            </label>
            <input
              id={jumpId}
              className="jump__input"
              type="number"
              min="1"
              max={totalPages}
              inputMode="numeric"
              value={jumpValue}
              placeholder={String(current.pages[0].pageId)}
              onChange={(event) => {
                setJumpValue(event.target.value);
                setJumpError("");
              }}
            />
            <button type="submit" disabled={!!flip}>
              Go
            </button>
          </form>

          {/* Always rendered so it is an established live region; hidden by
              .jump__msg:empty until there is something to announce. */}
          <p className="jump__msg" role="status">
            {jumpError}
          </p>
        </div>

        <button
          type="button"
          onClick={() => go("next")}
          disabled={index === views.length - 1 || !!flip}
        >
          Next &rarr;
        </button>
      </nav>

      {/* Filters the pages already in memory -- no request, so results appear as
          you type and you never leave the page you are reading. */}
      <section className="search">
        <label className="search__label" htmlFor={searchId}>
          Search first lines
        </label>
        <input
          id={searchId}
          className="search__input"
          type="search"
          value={query}
          placeholder="a word from the first line&hellip;"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />

        {query.trim() !== "" && (
          <div className="search__results" role="status">
            {matches.length === 0 ? (
              <p className="search__empty">
                Nothing matches. Only pages with a first line typed in can be found.
              </p>
            ) : (
              <>
                <ul className="search__list">
                  {matches.slice(0, MAX_RESULTS).map((page) => {
                    const target = viewIndexForPage(views, page.pageId);
                    const span =
                      page.pageCount === 1
                        ? `page ${page.pageId}`
                        : `pages ${page.pageId}–${page.pageId + page.pageCount - 1}`;
                    return (
                      <li key={page.contentId}>
                        <button
                          type="button"
                          className="search__hit"
                          disabled={!!flip || target === index}
                          onClick={() => goToIndex(target)}
                        >
                          <span className="search__span">{span}</span>
                          <HighlightedLine text={page.firstLine} query={query} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {matches.length > MAX_RESULTS && (
                  <p className="search__more">
                    and {matches.length - MAX_RESULTS} more
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Only the immediate neighbours are fetched ahead, so a flip never stalls
          while the rest of the diary stays unrequested. */}
      <div className="preload" aria-hidden="true">
        {neighbours.flatMap((view) =>
          view.pages.map((page) => (
            <img key={page.contentId} src={page.src} alt="" decoding="async" />
          ))
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import {
  deletePage,
  revertImage,
  saveImageEdit,
  setRedactionBoxes,
} from "@/app/admin/editor/actions";
import { toOriginalSpace, toRotatedSpace } from "@/lib/redaction";

/** Below this (percent of the image) a drag is treated as a stray click. */
const MIN_BAR_PERCENT = 1;

/**
 * Edit one scan: rotate and crop it, or cover areas with black bars.
 *
 * Both modes work from the same picture -- the pristine original, drawn to a
 * canvas at the current rotation. The server applies bars to the original
 * before rotating and cropping, so a bar is stored in the original's coordinate
 * space and converted only through the rotation being displayed. Crop never
 * enters that conversion, which is why the preview shows the uncropped image
 * with the crop region merely outlined.
 *
 * Bars are data, not a burn. The original stays uncensored so an admin can see
 * what a bar covers, and removing a bar republishes the page without it.
 */
export default function ImageEditor({ page }) {
  const router = useRouter();
  const [mode, setMode] = useState("crop");
  const [rotation, setRotation] = useState(page.rotation ?? 0);
  const [crop, setCrop] = useState(page.crop ? { unit: "%", ...page.crop } : undefined);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [pending, startTransition] = useTransition();

  // Bars are held in ORIGINAL space and converted for display.
  const [boxes, setBoxes] = useState(page.boxes ?? []);
  const [selection, setSelection] = useState(undefined);
  const [barTool, setBarTool] = useState("draw");
  const [selected, setSelected] = useState(null);

  /**
   * Preview-only. There is no field on setRedactionBoxes that could carry this
   * and publish() fills bars with opaque black, so a see-through bar cannot
   * reach a saved image. It also resets to solid on every load, so a
   * see-through bar is never mistaken for one that has not been applied.
   */
  const [seeThrough, setSeeThrough] = useState(false);

  // Two steps, because this cannot be undone and the button sits beside Save.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const sourceRef = useRef(null);
  /*
   * The source image's natural size, in state rather than read off sourceRef
   * during render.
   *
   * The ref still holds the Image for redraw() to paint from -- that runs in
   * handlers, which is what refs are for. But rendering from ref.current only
   * worked because the same onload happened to call setPreview: React had no
   * idea the ref had changed. Remove that incidental state update and the
   * editor would render with no known size.
   */
  const [sourceSize, setSourceSize] = useState(null);

  const isSpread = page.pageCount === 2;
  const label = isSpread ? `Pages ${page.pageId}–${page.pageId + 1}` : `Page ${page.pageId}`;
  const serverBoxes = JSON.stringify(page.boxes ?? []);
  const dirtyBars = JSON.stringify(boxes) !== serverBoxes;

  // Resync when the server's copy changes. After a save sanitiseBox may have
  // clamped a box, and without this the local state keeps the unclamped values:
  // the "unsaved" badge would never clear, and the bar drawn on screen would be
  // wider than the one actually burned into the published image.
  //
  // Adjusted during render rather than in an effect. React re-runs this
  // component immediately, before the browser paints, so the bars never flash
  // at their old geometry -- an effect would show one frame of the unclamped
  // box first.
  const [syncedBoxes, setSyncedBoxes] = useState(serverBoxes);
  if (syncedBoxes !== serverBoxes) {
    setSyncedBoxes(serverBoxes);
    setBoxes(JSON.parse(serverBoxes));
    setSelected(null);
  }

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      sourceRef.current = img;
      setSourceSize({ width: img.naturalWidth, height: img.naturalHeight });
      setStatus(null);
      redraw(img, page.rotation ?? 0, setPreview);
    };
    img.onerror = () => {
      if (!cancelled) setStatus({ ok: false, message: "Could not load the image." });
    };
    img.src = `/api/admin/original/${page.pageId}`;
    return () => {
      cancelled = true;
    };
  }, [page.pageId, page.rotation]);

  const removeBar = useCallback((index) => {
    setBoxes((list) => list.filter((_, j) => j !== index));
    setSelected(null);
  }, []);

  // Delete removes the selected bar, Escape drops the selection.
  useEffect(() => {
    if (mode !== "redact" || selected === null) return undefined;
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeBar(selected);
      } else if (event.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selected, removeBar]);

  const rotate = useCallback(
    (delta) => {
      const next = (((rotation + delta) % 360) + 360) % 360;
      setRotation(next);
      // A crop box chosen in the old orientation describes a different region
      // once the image turns. Bars are unaffected -- they are stored against the
      // original, so they follow the content through any rotation.
      setCrop(undefined);
      setSelection(undefined);
      if (sourceRef.current) redraw(sourceRef.current, next, setPreview);
    },
    [rotation]
  );

  /** Drawing commits on release; a click without a real drag makes nothing. */
  function commitDrawn(percent) {
    if (!percent || percent.width < MIN_BAR_PERCENT || percent.height < MIN_BAR_PERCENT) {
      setSelection(undefined);
      return;
    }
    setBoxes((list) => [...list, toOriginalSpace(percent, rotation)]);
    setSelection(undefined);
  }

  const rotatedSize = getRotatedSize(sourceSize, rotation);
  const outputSize = getOutputSize(rotatedSize, crop);
  const shownBoxes = boxes.map((b) => toRotatedSpace(b, rotation));

  const editingBar = mode === "redact" && barTool === "select" && selected !== null;

  function run(fn, after) {
    setStatus(null);
    startTransition(async () => {
      const result = await fn();
      setStatus(result);
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  const onSave = () =>
    run(() =>
      saveImageEdit({
        pageId: page.pageId,
        rotation,
        crop:
          crop && crop.width > 0 && crop.height > 0
            ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height }
            : null,
      })
    );

  const onRevert = () =>
    run(
      () => revertImage({ pageId: page.pageId }),
      () => {
        setRotation(0);
        setCrop(undefined);
        if (sourceRef.current) redraw(sourceRef.current, 0, setPreview);
      }
    );

  // Navigates away rather than refreshing: every page after this one has just
  // been renumbered, so this URL now addresses a different scan.
  const onDelete = () =>
    run(
      () => deletePage({ pageId: page.pageId, confirm: true }),
      () => router.push("/admin/editor")
    );

  const onSaveBars = () =>
    run(
      () =>
        // Only geometry crosses this boundary. There is no opacity field.
        setRedactionBoxes({
          pageId: page.pageId,
          boxes: boxes.map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height })),
        }),
      () => setSelected(null)
    );

  // What ReactCrop is bound to depends on the tool: a transient rectangle while
  // drawing, the selected bar while editing one.
  const activeCrop = (() => {
    if (mode === "crop") return crop;
    if (editingBar) return { unit: "%", ...shownBoxes[selected] };
    return selection;
  })();

  function onCropChange(percent) {
    if (mode === "crop") return setCrop(percent);
    if (editingBar) {
      const stored = toOriginalSpace(percent, rotation);
      return setBoxes((list) => list.map((b, i) => (i === selected ? stored : b)));
    }
    setSelection(percent);
  }

  return (
    <div className="editor">
      <div className="editor__head">
        <h2>Editing {label}</h2>
        <button type="button" className="editor__back" onClick={() => router.push("/admin/editor")}>
          &larr; Back to browser
        </button>
      </div>

      <div className="editor__modes" role="tablist">
        {[
          ["crop", "Rotate & crop"],
          ["redact", "Censor bars"],
        ].map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={`editor__mode${mode === id ? " editor__mode--on" : ""}`}
            onClick={() => {
              setSelection(undefined);
              setSelected(null);
              setStatus(null);
              setMode(id);
            }}
            disabled={pending}
          >
            {text}
          </button>
        ))}
      </div>

      {mode === "crop" ? (
        <div className="editor__tools">
          <button type="button" onClick={() => rotate(-90)} disabled={pending || !preview}>
            &#8630; Rotate left
          </button>
          <button type="button" onClick={() => rotate(90)} disabled={pending || !preview}>
            &#8631; Rotate right
          </button>
          <button type="button" onClick={() => setCrop(undefined)} disabled={pending || !crop}>
            Clear crop
          </button>
          <span className="editor__dims">
            {outputSize ? `Result: ${outputSize.width} × ${outputSize.height}` : "…"}
            {rotation !== 0 && <span className="editor__flag">rotated {rotation}°</span>}
          </span>
        </div>
      ) : (
        <div className="editor__tools">
          <div className="editor__seg" role="group" aria-label="Bar tool">
            {[
              ["draw", "Draw"],
              ["select", "Select"],
            ].map(([id, text]) => (
              <button
                key={id}
                type="button"
                aria-pressed={barTool === id}
                className={`editor__segbtn${barTool === id ? " editor__segbtn--on" : ""}`}
                onClick={() => {
                  setBarTool(id);
                  setSelection(undefined);
                  setSelected(null);
                }}
                disabled={pending}
              >
                {text}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSeeThrough((v) => !v)}
            disabled={pending || !boxes.length}
            aria-pressed={seeThrough}
          >
            {seeThrough ? "Solid bars" : "See through bars"}
          </button>

          <button
            type="button"
            onClick={() => removeBar(selected)}
            disabled={pending || selected === null}
          >
            Delete bar
          </button>

          <button
            type="button"
            onClick={() => {
              setBoxes([]);
              setSelected(null);
            }}
            disabled={pending || !boxes.length}
          >
            Remove all
          </button>

          <span className="editor__dims">
            {barTool === "draw"
              ? "Drag to place a bar"
              : selected === null
                ? "Click a bar to select it"
                : `Bar ${selected + 1} selected`}
            {seeThrough && <span className="editor__flag">preview only</span>}
          </span>
        </div>
      )}

      <div className="editor__stage">
        {preview ? (
          <div className={`editor__cropwrap${editingBar ? " editor__cropwrap--editing" : ""}`}>
            <ReactCrop
              crop={activeCrop}
              onChange={(_p, percent) => onCropChange(percent)}
              onComplete={(_p, percent) => {
                if (mode === "redact" && barTool === "draw") commitDrawn(percent);
              }}
              keepSelection={mode === "crop" || editingBar}
              // With nothing selected in Select mode, ReactCrop must stop
              // swallowing pointer events or the bars underneath are unclickable.
              disabled={mode === "redact" && barTool === "select" && selected === null}
              onDragStart={(event) => {
                // While a bar is selected ReactCrop still owns the whole image,
                // so a drag on empty canvas would be read as reshaping that bar
                // and quietly move it off the content it covers. A drag that
                // starts outside the selection deselects instead.
                if (!editingBar) return;
                const box = shownBoxes[selected];
                const rect = event.currentTarget?.getBoundingClientRect?.();
                if (!box || !rect || !rect.width || !rect.height) return;
                const px = ((event.clientX - rect.left) / rect.width) * 100;
                const py = ((event.clientY - rect.top) / rect.height) * 100;
                const inside =
                  px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height;
                if (!inside) setSelected(null);
              }}
            >
              <img src={preview} alt="" className="editor__img" />
            </ReactCrop>

            {/* Exactly what the published image will have covered. */}
            {shownBoxes.map((bar, i) => {
              const isSelected = editingBar && selected === i;
              return (
                <div
                  key={i}
                  className={[
                    "editor__bar",
                    seeThrough ? "editor__bar--ghost" : "",
                    mode === "redact" && barTool === "select" ? "editor__bar--pickable" : "",
                    isSelected ? "editor__bar--selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    left: `${bar.x}%`,
                    top: `${bar.y}%`,
                    width: `${bar.width}%`,
                    height: `${bar.height}%`,
                  }}
                  onClick={() => {
                    if (mode === "redact" && barTool === "select") setSelected(i);
                  }}
                />
              );
            })}

            {mode === "redact" && crop && (
              // Bars are placed against the uncropped image, so the crop is shown
              // as an outline rather than applied -- anything outside it is
              // simply not published.
              <div
                className="editor__cropghost"
                style={{
                  left: `${crop.x}%`,
                  top: `${crop.y}%`,
                  width: `${crop.width}%`,
                  height: `${crop.height}%`,
                }}
                aria-hidden="true"
              />
            )}

            {mode === "crop" && isSpread && <div className="editor__spine" aria-hidden="true" />}
          </div>
        ) : (
          <p className="admin__note">Loading image&hellip;</p>
        )}
      </div>

      {mode === "crop" && isSpread && (
        <p className="admin__note editor__warn">
          This scan is a two-page spread. The reader splits it down the middle, so keep
          the spine on the guide line or the page halves will be misaligned.
        </p>
      )}

      {mode === "redact" && (
        <div className="editor__redact">
          {boxes.length > 0 && (
            <ul className="editor__barlist">
              {shownBoxes.map((bar, i) => (
                <li key={i} className={selected === i ? "editor__barlist--on" : undefined}>
                  <button
                    type="button"
                    className="editor__barpick"
                    onClick={() => {
                      setBarTool("select");
                      setSelected(i);
                    }}
                    disabled={pending}
                  >
                    Bar {i + 1} &mdash; {Math.round(bar.width)}% &times; {Math.round(bar.height)}%
                  </button>
                  <button type="button" onClick={() => removeBar(i)} disabled={pending}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="admin__note">
            Bars are burned into the image the site publishes, not drawn over it in the
            browser &mdash; see-through is a preview here only and never reaches a saved
            image. The stored original stays uncensored so you can still see what a bar
            covers, which means <strong>any admin can see it too</strong>, and your local{" "}
            <code>images/</code> masters are untouched either way. Removing a bar
            republishes the page without it.
          </p>
        </div>
      )}

      {status && (
        <p className={status.ok ? "editor__ok" : "editor__error"} role="alert">
          {status.ok ? "Saved." : status.message}
        </p>
      )}

      <div className="editor__actions">
        {mode === "crop" ? (
          <>
            <button
              type="button"
              className="editor__save"
              onClick={onSave}
              disabled={pending || !preview}
            >
              {pending ? "Working…" : "Save"}
            </button>
            {page.hasOriginal && (
              <button type="button" onClick={onRevert} disabled={pending}>
                Undo rotate &amp; crop
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="editor__save"
            onClick={onSaveBars}
            disabled={pending || !preview}
          >
            {pending ? "Working…" : boxes.length ? `Save ${boxes.length} bar(s)` : "Remove all bars"}
            {dirtyBars && !pending && <span className="editor__unsaved">unsaved</span>}
          </button>
        )}

        {/* Pushed to the far end, away from Save. */}
        <button
          type="button"
          className="editor__remove"
          onClick={() => setConfirmingDelete((on) => !on)}
          disabled={pending}
          aria-expanded={confirmingDelete}
        >
          {confirmingDelete ? "Keep this page" : "Remove page…"}
        </button>
      </div>

      {confirmingDelete && (
        <div className="editor__danger" role="alert">
          <p>
            <strong>
              Remove{" "}
              {page.pageCount === 1
                ? `page ${page.pageId}`
                : `pages ${page.pageId}–${page.pageId + page.pageCount - 1}`}
              ?
            </strong>{" "}
            The scan, its first line
            {page.boxes?.length ? `, its ${page.boxes.length} censor bar(s)` : ""} and
            any stored original are deleted. This cannot be undone.
          </p>
          <p className="editor__note">
            Every later page moves {page.pageCount === 1 ? "down one" : "down two"} so
            the numbering stays gapless — page numbers you have written down
            elsewhere will shift. Your master file in <code>images/</code> is left
            where it is.
          </p>
          <button
            type="button"
            className="editor__remove editor__remove--confirm"
            onClick={onDelete}
            disabled={pending}
          >
            {pending ? "Removing…" : "Yes, remove it"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Draw the source at the given rotation and hand back a data URL. */
function redraw(img, rotation, setPreview) {
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? img.naturalHeight : img.naturalWidth;
  canvas.height = swap ? img.naturalWidth : img.naturalHeight;

  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  // Preview only -- published bytes are produced server-side by sharp from the
  // original, so this re-encode never reaches storage.
  setPreview(canvas.toDataURL("image/jpeg", 0.9));
}

function getRotatedSize(size, rotation) {
  if (!size) return null;
  const swap = rotation === 90 || rotation === 270;
  return {
    width: swap ? size.height : size.width,
    height: swap ? size.width : size.height,
  };
}

function getOutputSize(rotatedSize, crop) {
  if (!rotatedSize) return null;
  if (!crop || !crop.width || !crop.height) return rotatedSize;
  return {
    width: Math.max(1, Math.round((crop.width / 100) * rotatedSize.width)),
    height: Math.max(1, Math.round((crop.height / 100) * rotatedSize.height)),
  };
}

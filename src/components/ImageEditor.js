"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import { revertImage, saveImageEdit, setRedactionBoxes } from "@/app/admin/editor/actions";
import { toOriginalSpace, toRotatedSpace } from "@/lib/redaction";

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

  // Held in ORIGINAL space, converted for display.
  const [boxes, setBoxes] = useState(page.boxes ?? []);
  const [selection, setSelection] = useState(undefined);

  const sourceRef = useRef(null);

  const isSpread = page.pageCount === 2;
  const label = isSpread ? `Pages ${page.pageId}–${page.pageId + 1}` : `Page ${page.pageId}`;

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      sourceRef.current = img;
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

  function addBar() {
    if (!selection?.width || !selection?.height) return;
    setBoxes((list) => [...list, toOriginalSpace(selection, rotation)]);
    setSelection(undefined);
  }

  const rotatedSize = getRotatedSize(sourceRef.current, rotation);
  const outputSize = getOutputSize(rotatedSize, crop);
  const shownBoxes = boxes.map((b) => toRotatedSpace(b, rotation));

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

  const onSaveBars = () => run(() => setRedactionBoxes({ pageId: page.pageId, boxes }));

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
          <button type="button" onClick={addBar} disabled={pending || !selection}>
            + Add bar
          </button>
          <button type="button" onClick={() => setBoxes([])} disabled={pending || !boxes.length}>
            Remove all
          </button>
          <span className="editor__dims">
            {boxes.length === 0 ? "Drag a rectangle, then Add bar" : `${boxes.length} bar(s)`}
          </span>
        </div>
      )}

      <div className="editor__stage">
        {preview ? (
          <div className="editor__cropwrap">
            <ReactCrop
              crop={mode === "crop" ? crop : selection}
              onChange={(_p, percent) =>
                mode === "crop" ? setCrop(percent) : setSelection(percent)
              }
              keepSelection={mode === "crop"}
            >
              <img src={preview} alt="" className="editor__img" />
            </ReactCrop>

            {/* Exactly what the published image will have covered. */}
            {shownBoxes.map((bar, i) => (
              <div
                key={i}
                className="editor__bar"
                style={{
                  left: `${bar.x}%`,
                  top: `${bar.y}%`,
                  width: `${bar.width}%`,
                  height: `${bar.height}%`,
                }}
                aria-hidden="true"
              />
            ))}

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
                <li key={i}>
                  <span>
                    Bar {i + 1} &mdash; {Math.round(bar.width)}% &times; {Math.round(bar.height)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setBoxes((list) => list.filter((_, j) => j !== i))}
                    disabled={pending}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="admin__note">
            Bars are burned into the image the site publishes, not drawn over it in the
            browser. The stored original stays uncensored so you can still see what a bar
            covers, which means <strong>any admin can see it too</strong> &mdash; and
            your local <code>images/</code> masters are untouched either way. Removing a
            bar republishes the page without it.
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
          </button>
        )}
      </div>
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

function getRotatedSize(img, rotation) {
  if (!img) return null;
  const swap = rotation === 90 || rotation === 270;
  return {
    width: swap ? img.naturalHeight : img.naturalWidth,
    height: swap ? img.naturalWidth : img.naturalHeight,
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

"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import { revertImage, saveImageEdit } from "@/app/admin/editor/actions";

/**
 * Rotate and crop one scan.
 *
 * Rotation is previewed by drawing the source into a canvas and handing the
 * result to the crop tool. That is not cosmetic: the server applies rotate then
 * crop, so the crop box has to be drawn on an already-rotated image or its
 * coordinates would describe a different region than the one you selected.
 *
 * Crop travels as percentages rather than pixels, so the on-screen scale can
 * never disagree with the source resolution.
 */
export default function ImageEditor({ page }) {
  const router = useRouter();
  const [rotation, setRotation] = useState(page.rotation ?? 0);
  const [crop, setCrop] = useState(page.crop ? { unit: "%", ...page.crop } : undefined);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [pending, startTransition] = useTransition();

  const sourceRef = useRef(null);

  const isSpread = page.pageCount === 2;
  const label = isSpread
    ? `Pages ${page.pageId}–${page.pageId + 1}`
    : `Page ${page.pageId}`;

  // Load the pristine original once. Same-origin (the route streams the bytes
  // rather than redirecting), so drawing it to a canvas does not taint it.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      sourceRef.current = img;
      setStatus(null);
      redraw(img, rotation, setPreview);
    };
    img.onerror = () => {
      if (!cancelled) setStatus({ ok: false, message: "Could not load the image." });
    };
    img.src = `/api/admin/original/${page.pageId}`;
    return () => {
      cancelled = true;
    };
    // Deliberately only on mount: rotation redraws are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.pageId]);

  const rotate = useCallback(
    (delta) => {
      const next = (((rotation + delta) % 360) + 360) % 360;
      setRotation(next);
      // A crop box selected in the old orientation describes a different region
      // once the image turns, so it is cleared rather than silently reinterpreted.
      setCrop(undefined);
      if (sourceRef.current) redraw(sourceRef.current, next, setPreview);
    },
    [rotation]
  );

  const rotatedSize = getRotatedSize(sourceRef.current, rotation);
  const outputSize = getOutputSize(rotatedSize, crop);

  function onSave() {
    setStatus(null);
    startTransition(async () => {
      const payload = {
        pageId: page.pageId,
        rotation,
        crop: crop && crop.width > 0 && crop.height > 0
          ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height }
          : null,
      };
      const result = await saveImageEdit(payload);
      setStatus(result);
      if (result.ok) router.refresh();
    });
  }

  function onRevert() {
    setStatus(null);
    startTransition(async () => {
      const result = await revertImage({ pageId: page.pageId });
      setStatus(result);
      if (result.ok) {
        setRotation(0);
        setCrop(undefined);
        if (sourceRef.current) redraw(sourceRef.current, 0, setPreview);
        router.refresh();
      }
    });
  }

  return (
    <div className="editor">
      <div className="editor__head">
        <h2>Editing {label}</h2>
        <button type="button" className="editor__back" onClick={() => router.push("/admin/editor")}>
          &larr; Back to browser
        </button>
      </div>

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
          {outputSize
            ? `Result: ${outputSize.width} × ${outputSize.height}`
            : "…"}
          {rotation !== 0 && <span className="editor__flag">rotated {rotation}°</span>}
        </span>
      </div>

      <div className="editor__stage">
        {preview ? (
          <div className="editor__cropwrap">
            <ReactCrop
              crop={crop}
              onChange={(_pixel, percent) => setCrop(percent)}
              keepSelection
            >
              <img src={preview} alt="" className="editor__img" />
            </ReactCrop>
            {isSpread && (
              // The reader splits a spread at exactly 50% to build its two
              // pages; there is no spine-position field. An off-centre crop
              // would silently misalign every page split for this scan.
              <div className="editor__spine" aria-hidden="true" />
            )}
          </div>
        ) : (
          <p className="admin__note">Loading image&hellip;</p>
        )}
      </div>

      {isSpread && (
        <p className="admin__note editor__warn">
          This scan is a two-page spread. The reader splits it down the middle, so
          keep the spine on the guide line or the page halves will be misaligned.
        </p>
      )}

      {status && (
        <p className={status.ok ? "editor__ok" : "editor__error"} role="alert">
          {status.ok ? "Saved." : status.message}
        </p>
      )}

      <div className="editor__actions">
        <button type="button" className="editor__save" onClick={onSave} disabled={pending || !preview}>
          {pending ? "Working…" : "Save"}
        </button>
        {page.hasOriginal && (
          <button type="button" onClick={onRevert} disabled={pending}>
            Revert to original
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

  // Preview only -- the saved bytes are produced server-side by sharp from the
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

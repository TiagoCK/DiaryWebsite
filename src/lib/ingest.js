/**
 * Turning a file into a diary page.
 *
 * This is the pipeline that scripts/add-pages.mjs has always used, lifted out so
 * the in-app uploader runs exactly the same code. Two implementations of "what
 * are the dimensions, is it a spread, what should the JPEG look like" would
 * drift, and the drift would only show up as pages that render differently
 * depending on how they were added.
 *
 * Server-side only: it pulls in sharp, and rasterisePdf() pulls in pdfjs and a
 * native canvas.
 */

import path from "node:path";
import sharp from "sharp";

import { DIARY_ID } from "./pages.js";

/** Widest a stored page gets. Bigger buys nothing on screen and costs storage. */
export const MAX_WIDTH = 1600;

/**
 * JPEG, not PNG, and quality 85.
 *
 * These are photographs of paper -- continuous tone, sensor noise -- which is
 * exactly the content PNG compresses worst; the same pages come out roughly
 * 10-15x larger with no visible gain on handwriting. Nothing compounds the loss
 * either: originals/ keeps the pristine upload, so every later edit re-encodes
 * once from that rather than from the last encode.
 */
export const JPEG_QUALITY = 85;

/** What the uploader will accept. Matches the script's list, plus PDF. */
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
export const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
]);
export const PDF_MIME = "application/pdf";

/**
 * Ceilings for one upload.
 *
 * Not security boundaries -- only admins get this far -- but a mis-picked file
 * should fail fast rather than pull a gigabyte into memory or spend ten minutes
 * rendering a book.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;

/**
 * A filename safe to write into images/.
 *
 * The uploader's name comes from the browser, so it is stripped to a leaf name
 * with a conservative character set before it goes anywhere near a path. Commit
 * additionally refuses to overwrite an existing master.
 */
export function safeFileName(name) {
  const leaf = String(name).split(/[\\/]/).pop() ?? "";
  const cleaned = leaf
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 120);
  return cleaned || "upload";
}

/**
 * Normalise one scan and work out what it is.
 *
 * .rotate() with no argument bakes in the file's EXIF orientation and drops the
 * tag, so nothing downstream has to interpret it. The scans in this diary carry
 * orientation 6 AND 8, so anything that strips EXIF without baking would leave
 * some spreads turned the opposite way from the rest.
 *
 * `pageCountOverride` is how the caller forces the single/spread decision --
 * the script's --single/--spread flags, and the uploader's per-page dropdown.
 */
export async function analyse(original, { pageCountOverride } = {}) {
  const meta = await sharp(original).metadata();

  // Display dimensions of the file as it will sit in images/. metadata() reports
  // the stored dimensions, which for an EXIF-rotated scan are the wrong way
  // round -- orientations 5..8 mean a quarter turn, so they swap.
  const turned = meta.orientation >= 5 && meta.orientation <= 8;
  const sourceWidth = turned ? meta.height : meta.width;
  const sourceHeight = turned ? meta.width : meta.height;

  const pipeline = sharp(original).rotate();
  if (sourceWidth > MAX_WIDTH) pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });

  const { data, info } = await pipeline
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  // An open book photographed as one image comes out wider than it is tall; a
  // single page is portrait. This matches every scan already in the diary.
  const guessed = sourceWidth > sourceHeight ? 2 : 1;
  const pageCount = pageCountOverride ?? guessed;

  return {
    bytes: data,
    pageCount,
    guessed,
    forced: pageCountOverride != null && pageCountOverride !== guessed,
    // For the database: what the site will actually serve.
    width: info.width,
    height: info.height,
    byteSize: data.byteLength,
    // For the manifest: the master that stays in images/, which is larger
    // whenever the upload downscaled it.
    sourceWidth,
    sourceHeight,
    originalSize: original.byteLength,
  };
}

/** The first page number not already spoken for. */
export async function nextFreePageId(supabase, diaryId = DIARY_ID) {
  const { data, error } = await supabase
    .from("pages")
    .select("page_id, page_count")
    .eq("diary_id", diaryId)
    .order("page_id", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read existing pages: ${error.message}`);
  if (!data?.length) return 1;
  return data[0].page_id + (data[0].page_count ?? 1);
}

/**
 * Render every page of a PDF to a PNG, in order, handing each to `onPage`.
 *
 * Streamed rather than returned as an array. A 150 page scan is roughly 3 MB of
 * PNG per page, so collecting them first meant holding ~450 MB live at once and
 * the process could run out of heap well inside MAX_PDF_PAGES -- that cap
 * counts pages, not pixels. Handing each page over and dropping it keeps peak
 * memory at one page. Returns the number of pages rendered.
 *
 * PNG is the intermediate on purpose: it is lossless, so analyse() still
 * performs exactly one lossy encode, the same as a photograph gets. Rasterising
 * straight to JPEG would encode twice.
 *
 * Scale is computed per page from that page's own size so the long edge lands
 * near MAX_WIDTH. A fixed DPI would over-render a large format page and
 * under-render a small one, and rendering above MAX_WIDTH only to have sharp
 * shrink it again is a second resample for nothing.
 *
 * pdfjs and the canvas are imported here rather than at module scope so that
 * uploading an ordinary image -- and the add-pages script, which never touches
 * PDFs -- does not load a native binary it has no use for.
 */
export async function rasterisePdf(buffer, { onPage, maxPages = MAX_PDF_PAGES } = {}) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // pdfjs looks these up to draw the 14 standard fonts; without it, text in a
  // PDF that does not embed its fonts renders wrong or not at all.
  //
  // Forward slashes with a trailing one, not path.join and not a file:// URL.
  // pdfjs rejects a path that does not end in "/" -- which a Windows join
  // always does -- and it fails to read a file:// URL whose path contains an
  // escape, so any project folder with a space in its name (this one) silently
  // loses its fonts.
  const standardFontDataUrl = `${path
    .join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts")
    .split(path.sep)
    .join("/")}/`;

  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    // A PDF is untrusted input even when an admin chose it. pdfjs does not run
    // document JavaScript unless enableScripting is set, and this closes the
    // other route by which a crafted file could get code evaluated.
    isEvalSupported: false,
  });

  try {
    const doc = await task.promise;

    if (doc.numPages > maxPages) {
      throw new Error(
        `${doc.numPages} pages, which is over the ${maxPages} page limit for one upload. ` +
          `Split it and upload the parts in order.`
      );
    }

    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = MAX_WIDTH / Math.max(unscaled.width, unscaled.height);
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      // PDF pages are transparent where nothing is drawn, and transparency
      // flattens to black in a JPEG. Paint the paper first.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport, canvas }).promise;

      // Awaited, so the caller has finished with this page -- written it to
      // staging -- before the next one is rendered and this buffer is dropped.
      await onPage(canvas.toBuffer("image/png"), n, doc.numPages);
      page.cleanup();
    }

    return doc.numPages;
  } finally {
    // Frees the worker; without it the process keeps a handle open.
    await task.destroy();
  }
}

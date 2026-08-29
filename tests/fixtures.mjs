/**
 * Test inputs, generated rather than checked in.
 *
 * Nothing here reads images/. Those are the actual diary -- gitignored, private,
 * and absent on any machine that has not scanned a diary -- so a suite that
 * depended on them would pass only on one laptop and would leak private content
 * into the repository the moment someone committed a fixture.
 *
 * Generating them also makes the interesting cases expressible. An EXIF-rotated
 * scan is the one that has broken this pipeline before, and it is far easier to
 * author one than to find one.
 */

import sharp from "sharp";

/** Taller than wide: analyse() should call this a single page. */
export function portrait({ width = 500, height = 900 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: "#e8e2d4" } })
    .jpeg()
    .toBuffer();
}

/** Wider than tall: an open book, so analyse() should call it a spread. */
export function landscape({ width = 900, height = 500 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: "#e8e2d4" } })
    .jpeg()
    .toBuffer();
}

/**
 * Stored portrait, tagged EXIF orientation 6, so it DISPLAYS landscape.
 *
 * The whole point: metadata() reports 400x900, but the file a viewer shows is
 * 900x400. Orientations 5..8 are quarter turns and swap the axes, which is why
 * analyse() cannot trust the stored dimensions. The real diary carries both 6
 * and 8.
 */
export function turned({ width = 400, height = 900, orientation = 6 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: "#e8e2d4" } })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
}

/** Wider than MAX_WIDTH, to exercise the downscale. */
export function oversized({ width = 4000, height = 2000 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: "#888888" } })
    .jpeg()
    .toBuffer();
}

/** Not a valid image at all. */
export function notAnImage() {
  return Buffer.from("this is definitely not a jpeg");
}

const PDF_PAGES = [
  { label: "PAGE ONE", box: [0, 0, 612, 792] },
  { label: "PAGE TWO", box: [0, 0, 612, 792] },
  { label: "PAGE THREE", box: [0, 0, 792, 612] },
];

/**
 * A three page PDF with byte-accurate xref offsets, written by hand.
 *
 * Pages 1 and 2 are portrait and page 3 is landscape, so the single/spread
 * guess is exercised. Each page draws one MORE filled square than the last, so
 * the rasterised output can be checked for ORDER by measuring ink -- no OCR, no
 * reading text back, just a monotonic signal that says which page is which.
 */
export function threePagePdf() {
  const objects = [];
  const add = (body) => objects.push(body); // returns new length = 1-based number

  add(null); // 1: catalog, filled in below
  add(null); // 2: page tree
  const fontNum = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const kids = [];
  PDF_PAGES.forEach(({ label, box }, index) => {
    let squares = "";
    for (let i = 0; i <= index; i += 1) {
      squares += `0 0 0 rg ${60 + i * 120} 60 100 100 re f\n`;
    }
    const stream =
      `BT /F1 64 Tf 60 ${box[3] - 120} Td (${label}) Tj ET\n` +
      `4 w 30 30 ${box[2] - 60} ${box[3] - 60} re S\n` +
      squares;

    const contentNum = add(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`
    );
    const pageNum = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [${box.join(" ")}] ` +
        `/Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`
    );
    kids.push(`${pageNum} 0 R`);
  });

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${PDF_PAGES.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${startxref}\n%%EOF\n`;

  // latin1: the offsets above are byte counts, so the encoding must be 1:1.
  return Buffer.from(pdf, "latin1");
}

/** Count of pixels darker than mid-grey -- the ink measure used for ordering. */
export async function inkOf(imageBuffer) {
  const { data } = await sharp(imageBuffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (let i = 0; i < data.length; i += 1) if (data[i] < 128) dark += 1;
  return dark;
}

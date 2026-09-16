/**
 * Which font files the site loads.
 *
 * This is one half of the typography config; the other half is the token block
 * at the top of src/app/globals.css, which says what each ROLE is set in. The
 * split is deliberate -- they answer different questions. "What is the site set
 * in?" is four lines of CSS. "Which font files exist at all?" is this file,
 * which has to be JavaScript because next/font is a build-time transform.
 *
 * next/font downloads and self-hosts at build time. Nothing is fetched from
 * Google at runtime, so no reader's IP reaches a third party just by opening a
 * page -- which matters here more than it would on most sites.
 */

import { Caveat } from "next/font/google";

/**
 * The handwriting face.
 *
 * Caveat is a STAND-IN, chosen only because it is a script face that proves the
 * wiring. It carries no aesthetic commitment.
 *
 * To swap in your own hand:
 *   1. put the file at src/fonts/handwriting.woff2
 *   2. replace this whole declaration with:
 *
 *        import localFont from "next/font/local";
 *        const hand = localFont({
 *          src: "../fonts/handwriting.woff2",
 *          variable: "--font-hand-loaded",
 *          display: "swap",
 *        });
 *
 * Nothing else in the codebase moves -- every consumer goes through the
 * --font-hand token, not through this name.
 */
const hand = Caveat({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-hand-loaded",
  // Render the fallback immediately and swap when the face arrives. The
  // alternative blanks every heading on the page until the font lands.
  display: "swap",
});

/**
 * Goes on <html> so the variable is in scope for the whole document, including
 * anything portalled outside <body>.
 *
 * Only .variable, not .className: applying .className would SET the font on the
 * element as well as declaring the variable, which would put the whole site in
 * handwriting and make the token block below it meaningless.
 */
export const fontClassName = hand.variable;

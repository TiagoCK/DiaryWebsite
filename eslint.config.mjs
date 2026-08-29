import next from "eslint-config-next/core-web-vitals";

/**
 * Next's recommended rules plus core-web-vitals.
 *
 * Imported directly: eslint-config-next 16 ships flat config, so the FlatCompat
 * shim most guides still show is not only unnecessary here, it crashes on this
 * config's circular plugin references.
 */
const config = [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "build/**", "images/**"],
  },
  ...next,
  {
    rules: {
      /*
       * The scan images are deliberately plain <img>.
       *
       * They are private, single-use, signed-URL images behind an auth check,
       * so next/image has nothing to optimise or cache; and half of a spread is
       * positioned absolutely against the frame, which next/image's wrapper
       * would sit in the middle of. See the comment in src/components/BookViewer.js.
       */
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;

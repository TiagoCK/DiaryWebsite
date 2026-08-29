/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * Native modules the bundler must leave alone.
   *
   * sharp and @napi-rs/canvas load prebuilt .node binaries, and pdfjs resolves
   * its worker and standard font files by path at runtime. Bundling any of them
   * breaks those lookups, and the failure surfaces only when a route actually
   * runs -- not at build time.
   */
  serverExternalPackages: ["sharp", "@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;

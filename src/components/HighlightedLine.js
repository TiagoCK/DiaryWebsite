import { highlight } from "@/lib/search";

/**
 * A first line with the matched parts marked.
 *
 * No hooks and no "use client", so the same component renders inside the
 * client-side viewer filter and inside the two server-rendered search pages --
 * one appearance for a match, wherever it is shown.
 */
export default function HighlightedLine({ text, query, className = "hit__line" }) {
  const segments = highlight(text, query);
  if (segments.length === 0) return null;

  return (
    <span className={className}>
      {segments.map((segment, i) =>
        segment.hit ? (
          <mark key={i} className="hit__mark">
            {segment.text}
          </mark>
        ) : (
          // Fragment rather than a bare string so the key stays on an element.
          <span key={i}>{segment.text}</span>
        )
      )}
    </span>
  );
}

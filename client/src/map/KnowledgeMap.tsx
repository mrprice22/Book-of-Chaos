import { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { t } from '../i18n';
import { navigate, parseRoute } from '../routing/route';

let initialised = false;

/** Mermaid is a module-level singleton, so configure it exactly once. */
function initMermaid() {
  if (initialised) return;
  mermaid.initialize({
    startOnLoad: false,
    // The map follows the page. `securityLevel: 'strict'` is the default and stays:
    // labels come from author-supplied titles.
    theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'default',
    flowchart: { useMaxWidth: true, htmlLabels: false },
  });
  initialised = true;
}

/**
 * Renders Mermaid source to SVG.
 *
 * Async and racy by nature: subscription updates can produce new source while a
 * previous render is still running, so a stale result must not overwrite a newer
 * one. The generation counter is what enforces that.
 */
export function KnowledgeMap({ source }: { source: string }) {
  const domId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    initMermaid();
    const current = ++generation.current;

    mermaid
      .render(`map-${domId}`, source)
      .then((result) => {
        if (generation.current !== current) return;
        setSvg(result.svg);
        setFailed(false);
      })
      .catch(() => {
        if (generation.current !== current) return;
        // A parse failure is a bug in the source builder, not something the reader
        // can act on — but a blank rectangle where the map should be is worse than
        // a sentence saying so.
        setFailed(true);
      });
  }, [source, domId]);

  if (failed) {
    return <p className="map-status">{t('map.unavailable')}</p>;
  }
  if (svg === undefined) {
    return <p className="map-status">{t('map.rendering')}</p>;
  }

  // The SVG is Mermaid's output from source this app generated and escaped.
  return (
    // The interactive elements are Mermaid's own anchors inside the SVG — already
    // focusable and keyboard-activatable. This listener only intercepts their clicks
    // so navigation stays in-app; it adds no new interaction of its own.
    <div
      className="knowledge-map"
      onClick={onMapClick}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Turn a click on a node's link into an in-app navigation.
 *
 * Mermaid renders `click c1 "/chapter/1"` as a real anchor, so without this the map
 * would still work — it would just reload the page and drop the connection. Anything
 * that is not a chapter link (a modified click, an external href) is left to the
 * browser.
 */
function onMapClick(event: React.MouseEvent<HTMLDivElement>) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const anchor = (event.target as Element | null)?.closest('a');
  // Mermaid writes SVG anchors as `xlink:href`, not `href`. Reading only `href` got
  // null every time, so this handler quietly did nothing and every map click was a
  // full page load — which still reached the chapter, and so still looked correct.
  const href = anchor?.getAttribute('href') ?? anchor?.getAttribute('xlink:href');
  if (!href) return;

  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  if (parseRoute(url.pathname).name !== 'chapter') return;

  event.preventDefault();
  navigate(url.pathname);
}

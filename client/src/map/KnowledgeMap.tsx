import { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { t } from '../i18n';

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
  return <div className="knowledge-map" dangerouslySetInnerHTML={{ __html: svg }} />;
}

"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadSampleWiki, SAMPLE_LOCALES, type SampleLocale, type SampleWiki } from "./sample-wiki";

/**
 * Offers the bundled sample wiki. Choosing a language fetches it in the browser
 * and hands the files to the same flow a picked folder uses, so the reader
 * lands on the normal Preview.
 */
export function SampleWikiImport({
  disabled,
  onLoaded,
  onLoadingChange,
  onCancelReady,
}: {
  disabled: boolean;
  /** Hands the files to the import flow; resolves when that import has settled. */
  onLoaded: (sample: SampleWiki) => Promise<void>;
  /** True from the click until the import has settled, so siblings can lock too. */
  onLoadingChange?: (loading: boolean) => void;
  onCancelReady?: (cancel: (() => void) | null) => void;
}): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = useRef(false);

  function settle(): void {
    running.current = false;
    setLoading(false);
    onLoadingChange?.(false);
  }

  async function choose(locale: SampleLocale): Promise<void> {
    if (running.current) return;
    running.current = true;
    const controller = new AbortController();
    onCancelReady?.(() => controller.abort());
    setError(null);
    setLoading(true);
    onLoadingChange?.(true);
    try {
      const sample = await loadSampleWiki(locale, fetch, controller.signal);
      if (!controller.signal.aborted) await onLoaded(sample);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load the sample wiki.");
    } finally {
      onCancelReady?.(null);
      settle();
    }
  }

  return (
    <div id="sample-wiki" role="group" aria-labelledby="sample-wiki-heading" className="mt-4 border-t border-kh-border pt-4">
      <h2 id="sample-wiki-heading" className="text-body font-medium text-kh-text">Try with a sample wiki</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {SAMPLE_LOCALES.map(({ locale, label }) => (
          <Button key={locale} type="button" variant="secondary" lang={locale} disabled={disabled || loading} onClick={() => void choose(locale)}>
            {label}
          </Button>
        ))}
      </div>
      {error ? <p role="alert" className="mt-2 text-body text-kh-danger">{error}</p> : null}
    </div>
  );
}

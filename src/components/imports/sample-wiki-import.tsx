"use client";
import { useState } from "react";
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
}: {
  disabled: boolean;
  onLoaded: (sample: SampleWiki) => Promise<void>;
}): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(locale: SampleLocale): Promise<void> {
    setError(null);
    setLoading(true);
    let sample: SampleWiki;
    try {
      sample = await loadSampleWiki(locale);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load the sample wiki.");
      setLoading(false);
      return;
    }
    setLoading(false);
    await onLoaded(sample);
  }

  return (
    <div id="sample-wiki" role="group" aria-labelledby="sample-wiki-heading" className="mt-4 border-t border-kh-border pt-4">
      <h2 id="sample-wiki-heading" className="text-body font-medium text-kh-text">Try with a sample wiki</h2>
      <p className="mt-1 text-body text-kh-text-muted">
        Not sure what a folder should look like? Import a ready-made one and see Preview before anything is saved.
      </p>
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

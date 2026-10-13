"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The surrounding reading surface uses this local control's state in CSS. */
export function ReadingWidthToggle() {
  const [wide, setWide] = useState(false);
  return <Button type="button" variant="ghost" className="print:hidden" aria-pressed={wide} data-reading-wide={wide ? "true" : "false"} onClick={() => setWide(!wide)}>
    <Maximize2 className="size-4" aria-hidden="true" />Wide view
  </Button>;
}

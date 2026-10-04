"use client";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
export function SearchDateZone({ offset }: { offset?: string }) {
  const [value, setValue] = useState(offset || "0");
  useEffect(() => { setValue(offset || String(-new Date().getTimezoneOffset())); }, [offset]);
  const n = Number(value);
  const label = Number.isFinite(n) ? `UTC${n < 0 ? "−" : "+"}${String(Math.floor(Math.abs(n) / 60)).padStart(2, "0")}:${String(Math.abs(n) % 60).padStart(2, "0")}` : "Invalid UTC offset";
  return <><Input type="hidden" name="offset" value={value} readOnly /><p className="text-caption text-kh-text-muted">Dates are inclusive in {label}, based on the current content version.</p></>;
}

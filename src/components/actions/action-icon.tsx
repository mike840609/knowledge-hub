import {
  Database,
  FileText,
  Info,
  Pencil,
  Plus,
  Search,
  Settings,
  Star,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { ActionIconName } from "./action-registry";

/**
 * The registry names its icons rather than importing them, so the rules stay
 * testable without pulling a component tree into a node test. This is the one
 * place those names become pictures.
 */
const icons: Record<ActionIconName, LucideIcon> = {
  knowledge: FileText,
  search: Search,
  sources: Database,
  settings: Settings,
  create: Plus,
  import: Upload,
  open: FileText,
  edit: Pencil,
  favorite: Star,
  details: Info,
};

export function ActionIcon({ name, className = "h-4 w-4 shrink-0 text-kh-text-muted" }: { name: ActionIconName; className?: string }) {
  const Icon = icons[name];
  return <Icon className={className} aria-hidden="true" />;
}

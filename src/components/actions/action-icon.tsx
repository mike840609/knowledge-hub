import {
  Database,
  ExternalLink,
  Link2,
  FileText,
  Info,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
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
  "new-tab": ExternalLink,
  "copy-link": Link2,
  knowledge: FileText,
  search: Search,
  sources: Database,
  settings: Settings,
  create: Plus,
  import: Upload,
  open: FileText,
  edit: Pencil,
  // Not a chain: Copy link already is one, and the two sit side by side in
  // the row menu while doing very different things.
  share: Share2,
  favorite: Star,
  details: Info,
};

export function ActionIcon({ name, className = "h-4 w-4 shrink-0 text-kh-text-muted" }: { name: ActionIconName; className?: string }) {
  const Icon = icons[name];
  return <Icon className={className} aria-hidden="true" />;
}

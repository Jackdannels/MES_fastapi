import { withDirectives } from "vue";
import { vAppIcon } from "@/directives/appIcon";

// Compact screens are intentionally text-only: their existing scale is too small
// for a useful decorative icon. The directive preserves each control's bounds.
export function withVisualIcon(node, name, compact = false, options = {}) {
  return compact ? node : withDirectives(node, [[vAppIcon, { name, ...options }]]);
}

import { Badge } from "@/components/ui/badge";

/** The Console "filled in by NotOnQ" tag: amber outline, amber text. */
export function NotOnQBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="notonq" className={className}>
      {children}
    </Badge>
  );
}

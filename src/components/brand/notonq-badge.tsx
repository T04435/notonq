import { Badge } from "@/components/ui/badge";

/** The Schema "filled by NotOnQ" badge: hatched ground, the text on a solid strip so it stays readable. */
export function NotOnQBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="notonq" className={className}>
      <span className="bg-background px-1">{children}</span>
    </Badge>
  );
}

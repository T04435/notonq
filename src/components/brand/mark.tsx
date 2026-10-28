import { cn } from "cn";

// The NotOnQ mark, ported 1:1 from the Console boards: square-cut braces (Qloo's response shape) around an amber slot,
// the value NotOnQ fills in. While something runs, the slot blinks (still with reduced motion).
const LEFT = "M14 6C9 6 9 9 9 13V20C9 22 7 24 5 24C7 24 9 26 9 28V35C9 39 9 42 14 42";
const RIGHT = "M34 6C39 6 39 9 39 13V20C39 22 41 24 43 24C41 24 39 26 39 28V35C39 39 39 42 34 42";

/** muted: the slot takes the text colour too, so the whole mark goes quiet (a step that found nothing). */
export function Mark({ size = 24, className, label, running, muted }: { size?: number; className?: string; label?: string; running?: boolean; muted?: boolean }) {
  const stroke = size <= 16 ? 5 : 4.5;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={cn("shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={LEFT} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="square" strokeLinejoin="miter" />
      <path d={RIGHT} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="square" strokeLinejoin="miter" />
      <rect x="17" y="17" width="14" height="14" fill={muted ? "currentColor" : "var(--fill)"} className={running ? "console-blink" : undefined} />
    </svg>
  );
}

/** Mark plus wordmark, as in the site header. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark size={24} />
      <span className="text-base font-medium tracking-[-0.04em]">NotOnQ</span>
    </span>
  );
}

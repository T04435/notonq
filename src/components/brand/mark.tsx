import { cn } from "cn";

// The NotOnQ mark, ported 1:1 from the Schema brand board: braces (Qloo's response shape) around a slot. At small sizes
// the slot is solid; from 40 px up it is hatched, the way the brand marks a value NotOnQ filled in.
const LEFT = "M14 6C9 6 9 9 9 13V20C9 22 7 24 5 24C7 24 9 26 9 28V35C9 39 9 42 14 42";
const RIGHT = "M34 6C39 6 39 9 39 13V20C39 22 41 24 43 24C41 24 39 26 39 28V35C39 39 39 42 34 42";

export function Mark({ size = 24, className, label }: { size?: number; className?: string; label?: string }) {
  const hatched = size >= 40;
  const stroke = size >= 120 ? 2.6 : size >= 40 ? 3 : 4;
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
      <path d={LEFT} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
      <path d={RIGHT} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
      {hatched ? (
        <>
          <rect x="17" y="17" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={stroke * 0.8} />
          <path d="M17 25L25 17M17 31L31 17M23 31L31 23" stroke="currentColor" strokeWidth={stroke * 0.6} />
        </>
      ) : (
        <rect x="17" y="17" width="14" height="14" fill="currentColor" />
      )}
    </svg>
  );
}

/** Mark plus wordmark, as in the site header. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark size={22} />
      <span className="text-base font-medium tracking-[-0.04em]">NotOnQ</span>
    </span>
  );
}

import { cn } from "cn"
import { Mark } from "@/components/brand/mark"

/** The loader is the NotOnQ mark with its slot blinking (the brand's "running" state). */
function Spinner({ className }: { className?: string }) {
  return (
    <span data-slot="spinner" role="status" aria-label="Loading" className={cn("inline-flex size-4 text-foreground", className)}>
      <Mark size={48} running className="size-full" />
    </span>
  )
}

/** A page or section still loading: the mark, centred, blinking. */
function PageSpinner() {
  return (
    <div className="flex min-h-[40vh] w-full items-center justify-center">
      <Spinner className="size-10" />
    </div>
  )
}

export { PageSpinner, Spinner }

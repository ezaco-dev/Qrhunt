import { cn } from "@/lib/utils";

/**
 * Label.
 *
 * Sengaja elemen `<label>` biasa, bukan primitif Base UI: tidak ada perilaku
 * popup yang perlu di-wire, dan ini tidak menambah bobot ke bundle.
 */
export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex select-none items-center gap-2 text-sm leading-none font-medium group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
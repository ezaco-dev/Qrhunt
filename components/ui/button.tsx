import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * Tombol.
 *
 * `render` adalah cara Base UI mengganti elemen terluar: komponen ini tetap
 * adalah `<button>` secara semantik, tapi bisa dirender sebagai `<a>` atau
 * `next/link` tanpa kehilangan gaya, fokus, dan penangan event.
 *
 * JEBAKAN: props elemen `render` menang atas props yang dikirim ke Button.
 * Render bawaan adalah `<button type="button" />`, jadi untuk tombol submit
 * form tulis `render={<button type="submit" />}` — menulis `type="submit"`
 * sebagai prop tidak berpengaruh apa pun dan tombol tidak men-submit.
 */
export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  render?: React.ReactElement;
}

export function Button({ className, variant, size, render, ...props }: ButtonProps) {
  return useRender({
    render: render ?? <button type="button" />,
    props: {
      ...props,
      className: cn(buttonVariants({ variant, size }), className),
    },
  });
}

export { buttonVariants };
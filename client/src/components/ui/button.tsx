import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "border border-tally/80 bg-tally text-primary-foreground shadow-[0_8px_24px_oklch(0.92_0.24_112_/_18%)] hover:-translate-y-0.5 hover:bg-tally/90 hover:shadow-[0_12px_30px_oklch(0.92_0.24_112_/_28%)]",
        destructive:
          "border border-stop/60 bg-stop/90 text-white hover:-translate-y-0.5 hover:bg-stop focus-visible:ring-destructive/20",
        outline:
          "border border-white/15 bg-white/[0.025] shadow-none hover:border-tally/45 hover:bg-tally/10",
        secondary: "border border-white/[0.08] bg-white/[0.06] text-secondary-foreground hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.1]",
        ghost:
          "text-muted-foreground hover:bg-white/[0.07] hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2 has-[>svg]:px-3.5",
        sm: "h-9 gap-1.5 px-3.5 has-[>svg]:px-2.5",
        lg: "h-11 px-7 has-[>svg]:px-4.5",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

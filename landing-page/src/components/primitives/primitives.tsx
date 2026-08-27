import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...a: Array<string | false | undefined | null>) => a.filter(Boolean).join(" ");

export const Btn = ({
  kind = "sec",
  size = "md",
  block,
  children,
  icon,
  className,
  ...r
}: {
  kind?: "sec" | "pri" | "ghost";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={cx("btn focus-ring", `btn-${kind}`, `btn-${size}`, block && "btn-block", className)} {...r}>
    {icon}
    {children}
  </button>
);

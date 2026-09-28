import type { AnchorHTMLAttributes } from "react";

import { Link } from "../router";

type TextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
  ({ to: string; href?: never } | { href: string; to?: never });

export function TextLink({ to, href, className, ...rest }: TextLinkProps) {
  const classes = className ? `text-link ${className}` : "text-link";
  if (to !== undefined) {
    return <Link to={to} className={classes} {...rest} />;
  }
  return <a href={href} className={classes} target="_blank" rel="noreferrer" {...rest} />;
}

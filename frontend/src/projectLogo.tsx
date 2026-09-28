import { useEffect, useState } from "react";

interface ProjectLogoProps {
  size: number;
  slug?: string;
  className?: string;
}

export function ProjectLogo({ size, slug, className }: ProjectLogoProps) {
  const src = slug ? `/api/avatars/projects/${encodeURIComponent(slug)}` : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const classes = `project-logo${className ? ` ${className}` : ""}`;
  if (failed || src === null) {
    return <span className={classes} style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <img
      className={`${classes} project-logo-image`}
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}

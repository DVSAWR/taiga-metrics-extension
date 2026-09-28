import { useEffect, useState } from "react";

import { Icon } from "../icons";

export function UserPhoto({ userId }: { userId: number | null }) {
  const src = userId === null ? null : `/api/avatars/users/${userId}`;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed || src === null) {
    return <Icon name="person" />;
  }
  return (
    <img className="user-photo" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  );
}

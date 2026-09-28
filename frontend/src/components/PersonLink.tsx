import { createContext, Fragment, useContext } from "react";

import { TextLink } from "./TextLink";

export const TaigaUrlContext = createContext<string | null>(null);

export function PersonLink({ name, username }: { name: string; username: string | null }) {
  const taigaUrl = useContext(TaigaUrlContext);
  if (!taigaUrl || !username) {
    return <>{name}</>;
  }
  return (
    <TextLink
      href={`${taigaUrl}/profile/${encodeURIComponent(username)}`}
      title={`${name} in Taiga`}
    >
      {name}
    </TextLink>
  );
}

export interface Directory {
  people: Record<string, string>;
  usernames: Record<string, string>;
}

export function PersonRef({
  directory,
  id,
  nobody,
}: {
  directory: Directory;
  id: number | null;
  nobody: string;
}) {
  if (id === null) {
    return <span className="muted-inline">{nobody}</span>;
  }
  return (
    <PersonLink
      name={directory.people[String(id)] ?? `#${id}`}
      username={directory.usernames[String(id)] ?? null}
    />
  );
}

export function PeopleRefs({
  directory,
  ids,
  nobody,
}: {
  directory: Directory;
  ids: number[];
  nobody: string;
}) {
  if (ids.length === 0) {
    return <span className="muted-inline">{nobody}</span>;
  }
  return (
    <>
      {ids.map((id, index) => (
        <Fragment key={id}>
          {index > 0 && ", "}
          <PersonRef directory={directory} id={id} nobody={nobody} />
        </Fragment>
      ))}
    </>
  );
}

export function PersonList({
  people,
  nobody,
}: {
  people: { id: number; name: string; username: string | null }[];
  nobody: string;
}) {
  if (people.length === 0) {
    return <span className="muted-inline">{nobody}</span>;
  }
  return (
    <>
      {people.map((person, index) => (
        <Fragment key={person.id}>
          {index > 0 && ", "}
          <PersonLink name={person.name} username={person.username} />
        </Fragment>
      ))}
    </>
  );
}

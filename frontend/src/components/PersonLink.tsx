import { createContext, Fragment, useContext } from "react";

import { personPath } from "../router";
import { TextLink } from "./TextLink";

export const TaigaUrlContext = createContext<string | null>(null);

export interface PeopleAccess {
  slug: string;
  me: number;
  others: boolean;
}

export const PeopleContext = createContext<PeopleAccess | null>(null);

export function usePersonPath(id: number | null): string | null {
  const access = useContext(PeopleContext);
  if (!access || id === null || (id !== access.me && !access.others)) {
    return null;
  }
  return personPath(access.slug, id);
}

export function PersonLink({ name, id }: { name: string; id: number | null }) {
  const to = usePersonPath(id);
  if (!to) {
    return <>{name}</>;
  }
  return (
    <TextLink to={to} title={`${name}: their page`}>
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
  return <PersonLink name={directory.people[String(id)] ?? `#${id}`} id={id} />;
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
          <PersonLink name={person.name} id={person.id} />
        </Fragment>
      ))}
    </>
  );
}

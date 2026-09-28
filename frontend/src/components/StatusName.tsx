import type { ItemType } from "../api";
import { columnPath } from "../router";
import { TextLink } from "./TextLink";

const NO_COLOR = "#a9aabc";

export function StatusName({
  slug,
  itemType,
  id,
  name,
  color,
}: {
  slug: string;
  itemType: ItemType;
  id: number | null;
  name: string | null;
  color: string | null;
}) {
  if (name === null) {
    return <span className="muted-inline">-</span>;
  }
  return (
    <span className="column-name">
      <span className="column-color" style={{ background: color || NO_COLOR }} />
      {id === null ? (
        name
      ) : (
        <TextLink
          to={columnPath(slug, itemType, id)}
          target="_blank"
          rel="noreferrer"
          title={`${name}: cards in it now and how long they stay`}
          onClick={(event) => event.stopPropagation()}
        >
          {name}
        </TextLink>
      )}
    </span>
  );
}

import type { ItemType } from "../api";
import { MODULE_OF_TYPE } from "../modules";
import { cardPath } from "../router";
import { TextLink } from "./TextLink";

export function CardLink({
  slug,
  itemType,
  itemId,
  subject,
}: {
  slug: string;
  itemType: ItemType;
  itemId: number;
  subject: string;
}) {
  return (
    <TextLink
      to={cardPath(slug, MODULE_OF_TYPE[itemType], itemId)}
      title={subject}
      target="_blank"
      rel="noreferrer"
    >
      {subject}
    </TextLink>
  );
}

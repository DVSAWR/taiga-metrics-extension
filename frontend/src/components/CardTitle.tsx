import type { ItemType } from "../api";
import { CardLink } from "./CardLink";
import { CardRef } from "./CardRef";

export function CardTitle({
  slug,
  itemType,
  itemId,
  cardRef,
  subject,
  isDeleted,
  taigaUrl,
}: {
  slug: string;
  itemType: ItemType;
  itemId: number;
  cardRef: number | null;
  subject: string;
  isDeleted: boolean;
  taigaUrl: string | null;
}) {
  return (
    <span
      className={isDeleted ? "card-title-text is-deleted" : "card-title-text"}
      title={isDeleted ? `${subject} (deleted in Taiga)` : subject}
    >
      <CardRef
        itemType={itemType}
        itemId={itemId}
        cardRef={cardRef}
        isDeleted={isDeleted}
        slug={slug}
        taigaUrl={taigaUrl}
      />{" "}
      <CardLink slug={slug} itemType={itemType} itemId={itemId} subject={subject} />
    </span>
  );
}

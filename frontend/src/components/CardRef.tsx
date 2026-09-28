import type { ItemType } from "../api";
import { taigaItemUrl } from "../taigaLinks";
import { TextLink } from "./TextLink";

interface CardRefProps {
  itemType: ItemType;
  itemId: number;
  cardRef: number | null;
  isDeleted: boolean;
  slug: string;
  taigaUrl: string | null;
}

export function CardRef({ itemType, itemId, cardRef, isDeleted, slug, taigaUrl }: CardRefProps) {
  const label = `#${cardRef ?? itemId}`;
  if (!taigaUrl || cardRef === null || isDeleted) {
    return <span className="item-ref">{label}</span>;
  }
  return (
    <TextLink
      className="item-ref"
      href={taigaItemUrl(taigaUrl, slug, itemType, cardRef)}
      title="Open in Taiga"
      onClick={(event) => event.stopPropagation()}
    >
      {label}
    </TextLink>
  );
}

import { Fragment, useEffect, useState, type MouseEvent } from "react";

import {
  fetchCardEvents,
  searchCards,
  type CardEvent,
  type CardRow,
  type ItemType,
  type ProjectSummary,
} from "../api";
import { CardTitle } from "../components/CardTitle";
import { PersonLink, PersonList } from "../components/PersonLink";
import { TextLink } from "../components/TextLink";
import { formatDateTime, ITEM_TYPE_FILTERS, ITEM_TYPE_LABELS } from "../format";
import { FilterButton, FilterPanel } from "../components/FilterPanel";
import { useFilterSelection, useFiltersOpen } from "../filterState";
import { Icon } from "../icons";
import { columnPath } from "../router";
import { NotFoundPage } from "./HomePage";

const SEARCH_DELAY_MS = 300;

export function describeEvent(event: CardEvent) {
  switch (event.kind) {
    case "create":
      return (
        <>
          <span className="move-kind">Created in</span> {event.to_status ?? "-"}
        </>
      );
    case "delete":
      return (
        <>
          <span className="deleted-status">Deleted</span> <span className="move-kind">from</span>{" "}
          {event.from_status ?? "-"}
        </>
      );
    case "assign":
      return (
        <>
          <span className="move-kind">Assignees:</span>{" "}
          <PersonList people={event.assignees ?? []} nobody="nobody" />
        </>
      );
    case "move":
      return (
        <>
          {event.from_status ?? "-"} <span className="move-arrow">→</span> {event.to_status ?? "-"}
        </>
      );
  }
}

function fromLink(event: MouseEvent<HTMLElement>): boolean {
  return event.target instanceof Element && event.target.closest("a") !== null;
}

export function EventUser({ event }: { event: CardEvent }) {
  if (event.user) {
    return <PersonLink name={event.user.name} username={event.user.username} />;
  }
  return <>{event.user_name || "-"}</>;
}

function CardHistory({ slug, card }: { slug: string; card: CardRow }) {
  const [events, setEvents] = useState<CardEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCardEvents(slug, card.item_type, card.item_id)
      .then(setEvents)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [slug, card.item_type, card.item_id]);

  if (error) {
    return <p className="history-error">{error}</p>;
  }
  if (!events) {
    return <p className="muted">Loading history...</p>;
  }
  if (events.length === 0) {
    return <p className="muted">No history stored for this card.</p>;
  }
  return (
    <ol className="history">
      {events.map((event) => (
        <li key={`${event.history_id}-${event.kind}`}>
          <span className="history-time">{formatDateTime(event.happened_at)}</span>
          <span className="history-text">{describeEvent(event)}</span>
          <span className="history-user">
            <EventUser event={event} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function SearchPage({
  slug,
  projects,
  taigaUrl,
}: {
  slug: string;
  projects: ProjectSummary[] | null;
  taigaUrl: string | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ItemType | null>(null);
  const [selection, setSelection] = useFilterSelection(slug);
  const [filtersOpen, setFiltersOpen] = useFiltersOpen();
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchCards(slug, query, filter, selection)
        .then((next) => {
          if (!cancelled) {
            setCards(next);
            setError(null);
          }
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug, query, filter, selection]);

  if (projects && !project) {
    return <NotFoundPage />;
  }

  return (
    <>
      <h1>Search</h1>
      <div className="search-bar toolbar">
        <FilterButton
          open={filtersOpen}
          selection={selection}
          onToggle={() => setFiltersOpen(!filtersOpen)}
        />
        <label className="search-input">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Card #number or text in the subject"
            aria-label="Search cards"
            autoFocus
          />
        </label>
        <div className="segmented" role="group" aria-label="Card type">
          {ITEM_TYPE_FILTERS.map((option) => (
            <button
              key={option.label}
              type="button"
              className={option.value === filter ? "active" : ""}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="with-filters">
        {filtersOpen && (
          <FilterPanel
            slug={slug}
            itemType={filter}
            selection={selection}
            onChange={setSelection}
          />
        )}
        <div className="filtered-content">
          {error && <div className="banner banner-fail">{error}</div>}
          {cards && cards.length === 0 && <p className="muted">No cards match.</p>}
          {cards && cards.length > 0 && (
            <section className="card">
              <table className="table search-table">
                <colgroup>
                  <col />
                  <col className="col-column" />
                  <col className="col-people" />
                  <col className="col-when" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Status</th>
                    <th>Assignees</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((card) => {
                    const key = `${card.item_type}-${card.item_id}`;
                    const expanded = open === key;
                    return (
                      <Fragment key={key}>
                        <tr
                          className={`clickable${expanded ? " expanded" : ""}`}
                          onClick={(event) => {
                            if (!fromLink(event)) {
                              setOpen(expanded ? null : key);
                            }
                          }}
                        >
                          <td className="truncate" title={card.subject}>
                            <span className="item-type">{ITEM_TYPE_LABELS[card.item_type]}</span>{" "}
                            <CardTitle
                              slug={slug}
                              itemType={card.item_type}
                              itemId={card.item_id}
                              cardRef={card.ref}
                              subject={card.subject}
                              isDeleted={card.is_deleted}
                              taigaUrl={taigaUrl}
                            />
                          </td>
                          <td>
                            {card.is_deleted || !card.status ? (
                              "-"
                            ) : card.status_id === null ? (
                              card.status
                            ) : (
                              <TextLink
                                to={columnPath(slug, card.item_type, card.status_id)}
                                title={`${card.status}: cards in it now and how long they stay`}
                              >
                                {card.status}
                              </TextLink>
                            )}
                          </td>
                          <td>
                            <PersonList people={card.assignees} nobody="-" />
                          </td>
                          <td className="nowrap">{formatDateTime(card.created_at)}</td>
                        </tr>
                        {expanded && (
                          <tr className="history-row">
                            <td colSpan={4}>
                              <CardHistory slug={slug} card={card} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

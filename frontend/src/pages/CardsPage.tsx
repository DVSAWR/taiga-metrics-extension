import type { ProjectSummary } from "../api";
import { FilterPanel } from "../components/FilterPanel";
import { useFilterSelection, useItemType, usePeriod } from "../filterState";
import { cardsPath, Link, type CardsTab } from "../router";
import { HistoryTab } from "./HistoryTab";
import { NotFoundPage } from "./HomePage";
import { projectTypes } from "./KanbanPage";

const TABS: { key: CardsTab; label: string }[] = [
  { key: "search", label: "Search" },
  { key: "history", label: "History" },
];

export function CardsTabs({ slug, tab }: { slug: string; tab: CardsTab }) {
  return (
    <>
      <h1>Cards</h1>
      <nav className="tabs" aria-label="Cards">
        {TABS.map((option) => (
          <Link
            key={option.key}
            to={cardsPath(slug, option.key)}
            className={`tab${option.key === tab ? " active" : ""}`}
          >
            {option.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

export function HistoryPage({
  slug,
  projects,
  taigaUrl,
}: {
  slug: string;
  projects: ProjectSummary[] | null;
  taigaUrl: string | null;
}) {
  const project = projects?.find((candidate) => candidate.slug === slug);
  const types = projectTypes(project);
  const [itemType, setItemType] = useItemType(slug, types);
  const [selection, setSelection] = useFilterSelection(slug);
  const [period, setPeriod] = usePeriod(slug);
  if (projects && !project) {
    return <NotFoundPage />;
  }
  return (
    <>
      <CardsTabs slug={slug} tab="history" />
      <div className="with-filters">
        <FilterPanel
          slug={slug}
          itemType={itemType}
          selection={selection}
          onChange={setSelection}
          period={period}
          onPeriodChange={setPeriod}
          typeChoice={{ types, value: itemType, onChange: setItemType }}
        />
        <div className="filtered-content">
          <HistoryTab
            slug={slug}
            itemType={itemType}
            selection={selection}
            period={period}
            taigaUrl={taigaUrl}
          />
        </div>
      </div>
    </>
  );
}

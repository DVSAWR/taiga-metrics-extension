export interface SchemaStatus {
  compatible: boolean;
  missing_tables: string[];
  missing_columns: string[];
}

export interface TaigaCounts {
  projects: number;
  users: number;
  history_entries: number;
}

export interface TaigaStatus {
  connected: boolean;
  read_only: boolean;
  server_version: string | null;
  schema_status: SchemaStatus | null;
  counts: TaigaCounts | null;
  error: string | null;
}

export interface MetricsDbStatus {
  connected: boolean;
  revision: string | null;
  head_revision: string | null;
  up_to_date: boolean;
  error: string | null;
}

export interface HealthReport {
  version: string;
  taiga: TaigaStatus;
  metrics_db: MetricsDbStatus;
}

export type Page = "flow" | "search" | "team";
export type Scope = "all" | "own";

export interface AccessInfo {
  pages: Page[];
  scope: Scope;
  can_manage: boolean;
}

export interface ProjectSummary {
  id: number;
  name: string;
  slug: string;
  description: string;
  is_blocked: boolean;
  modules: Module[];
  has_scrum: boolean;
  has_kanban: boolean;
  has_sprints: boolean;
  access: AccessInfo;
}

export type Module = "epics" | "userstories" | "tasks" | "issues";

export interface Sprint {
  id: number;
  name: string;
  start: string | null;
  finish: string | null;
  closed: boolean;
}

export const UNAUTHORIZED_EVENT = "taiga-metrics:unauthorized";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function detailOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") {
      return body.detail;
    }
  } catch {
    return `HTTP ${response.status}`;
  }
  return `HTTP ${response.status}`;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  if (method !== "GET") {
    headers.set("X-Taiga-Metrics", "1");
  }
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (response.status === 401 && !url.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!response.ok) {
    throw new ApiError(await detailOf(response), response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function getJson<T>(url: string): Promise<T> {
  return request<T>(url);
}

export function fetchHealth(slug: string): Promise<HealthReport> {
  return getJson<HealthReport>(`${projectApi(slug)}/status`);
}

export function fetchProjects(): Promise<ProjectSummary[]> {
  return getJson<ProjectSummary[]>("/api/projects");
}

export type ItemType = "userstory" | "task" | "issue" | "epic";

export interface Mismatch {
  item_type: ItemType;
  item_id: number;
  project_slug: string | null;
  ref: number | null;
  subject: string;
  actual_status: string | null;
  history_status: string | null;
  reason: "no_history" | "mismatch";
}

export interface SyncRun {
  id: number;
  trigger: string;
  status: "running" | "succeeded" | "failed" | "interrupted";
  started_at: string;
  finished_at: string | null;
  history_since: string | null;
  history_read: number;
  transitions_added: number;
  assignments_added: number;
  items_checked: number;
  mismatches: number;
  mismatch_sample: Mismatch[];
  error: string | null;
}

export interface ProjectSyncSummary {
  id: number;
  name: string;
  slug: string;
  userstories: number;
  tasks: number;
  issues: number;
  epics: number;
  deleted_items: number;
  transitions: number;
  assignments: number;
  last_event_at: string | null;
}

export interface SyncSummary {
  watermark: string | null;
  projects: ProjectSyncSummary[];
}

export interface TransitionRow {
  history_id: string;
  item_type: ItemType;
  item_id: number;
  ref: number | null;
  subject: string;
  is_deleted: boolean;
  kind: "create" | "move" | "delete";
  happened_at: string;
  user_name: string;
  from_status: string | null;
  to_status: string | null;
  from_status_id: number | null;
  to_status_id: number | null;
  from_color: string | null;
  to_color: string | null;
  assignees: Person[];
  user: Person | null;
  days_in_status: number | null;
  level: StayLevel | null;
  usual: UsualStay | null;
}

export interface UsualStay {
  stays: number;
  p5: number | null;
  p15: number | null;
  p50: number | null;
  p85: number | null;
  p95: number | null;
}

export type StayLevel = "very_fast" | "fast" | "long" | "very_long" | "passed_through";

export interface TransitionPage {
  rows: TransitionRow[];
  has_more: boolean;
}

export type DayKind = "working" | "calendar";

export interface Period {
  from: string | null;
  to: string | null;
  days?: DayKind;
}

export const ALL_TIME: Period = { from: null, to: null };

export function fetchSyncRuns(slug: string, limit = 20): Promise<SyncRun[]> {
  return getJson<SyncRun[]>(`${projectApi(slug)}/sync/runs?limit=${limit}`);
}

export function fetchSyncSummary(slug: string): Promise<SyncSummary> {
  return getJson<SyncSummary>(`${projectApi(slug)}/sync/summary`);
}

export async function startSync(slug: string): Promise<boolean> {
  return (await request<{ accepted: boolean }>(`${projectApi(slug)}/sync`, { method: "POST" }))
    .accepted;
}

export interface FilterSelection {
  include: string[];
  exclude: string[];
}

function addSelection(params: URLSearchParams, selection: FilterSelection | null): void {
  selection?.include.forEach((value) => params.append("include", value));
  selection?.exclude.forEach((value) => params.append("exclude", value));
}

function addPeriod(params: URLSearchParams, period: Period): void {
  if (period.from) {
    params.set("from", period.from);
  }
  if (period.to) {
    params.set("to", period.to);
  }
  addDays(params, period.days);
}

function addDays(params: URLSearchParams, days: DayKind | undefined): void {
  if (days === "calendar") {
    params.set("days", days);
  }
}

export function fetchTransitions(
  slug: string,
  itemType: ItemType,
  selection: FilterSelection,
  period: Period,
  offset = 0,
  limit = 100,
  itemId: number | null = null,
): Promise<TransitionPage> {
  const params = new URLSearchParams({
    item_type: itemType,
    offset: String(offset),
    limit: String(limit),
  });
  if (itemId !== null) {
    params.set("item_id", String(itemId));
  }
  addSelection(params, selection);
  addPeriod(params, period);
  return getJson<TransitionPage>(
    `/api/projects/${encodeURIComponent(slug)}/transitions?${params}`,
  );
}

export interface UiConfig {
  taiga_url: string;
  community_url: string;
  repository_url: string;
}

export function fetchConfig(): Promise<UiConfig> {
  return getJson<UiConfig>("/api/config");
}

export interface Member {
  user_id: number;
  username: string;
  full_name: string;
  role: string;
  is_owner: boolean;
  is_admin: boolean;
  is_active: boolean;
}

export interface Person {
  id: number;
  name: string;
  username: string | null;
}

export interface CardRow {
  item_type: ItemType;
  item_id: number;
  ref: number | null;
  subject: string;
  status_id: number | null;
  status: string | null;
  is_deleted: boolean;
  created_at: string | null;
  assignees: Person[];
}

export interface CardEvent {
  history_id: string;
  happened_at: string;
  user_name: string;
  kind: "create" | "move" | "delete" | "assign";
  from_status: string | null;
  to_status: string | null;
  assignees: Person[] | null;
  user: Person | null;
}

const projectApi = (slug: string) => `/api/projects/${encodeURIComponent(slug)}`;

export interface Swimlane {
  id: number;
  name: string;
  wip: Record<string, number>;
}

export interface Swimlanes {
  lanes: Swimlane[];
  cards: Record<string, number | null>;
}

export function fetchSwimlanes(slug: string, itemType: ItemType): Promise<Swimlanes> {
  return getJson<Swimlanes>(
    `${projectApi(slug)}/swimlanes?${new URLSearchParams({ item_type: itemType })}`,
  );
}

export function fetchSprints(slug: string): Promise<Sprint[]> {
  return getJson<Sprint[]>(`${projectApi(slug)}/sprints`);
}

export type PeriodKind = "day" | "week" | "month" | "sprint";

export interface PeriodRef {
  key: string;
  label: string;
  start: string;
  end: string;
  current: boolean;
  days_left: number | null;
}

export interface CellStats {
  period: string;
  status_id: number;
  n: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
  sum: number;
}

export interface StatusNow {
  status_id: number;
  cards: number;
  oldest_days: number;
}

export interface SpreadStats {
  n: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
  sum: number;
  slow: number;
  fast: number;
}

export interface GroupCell {
  period: string;
  group: string;
  stays: number;
  stats: SpreadStats;
}

export interface TotalCell {
  period: string;
  cards: number;
  lead: SpreadStats | null;
  cycle: SpreadStats | null;
  waiting_days: number;
  work_days: number;
}

export interface OldestInWork {
  item_id: number;
  ref: number | null;
  subject: string;
  days: number;
}

export interface PeriodStatusTimes {
  kind: PeriodKind;
  periods: PeriodRef[];
  outside: boolean;
  columns: ColumnRef[];
  cells: CellStats[];
  now: StatusNow[];
  groups: GroupCell[];
  totals: TotalCell[];
  in_work_now: number;
  oldest_in_work: OldestInWork | null;
}

export interface StayRow {
  item_id: number;
  ref: number | null;
  subject: string;
  is_deleted: boolean;
  start: string;
  end: string;
  days: number;
  assignees: number[];
  exited_by: number | null;
}

export interface PeriodStays {
  rows: StayRow[];
  people: Record<string, string>;
  usernames: Record<string, string>;
  roles: Record<string, string>;
  role_of: Record<string, number | null>;
}

export interface FinishedRow {
  item_id: number;
  ref: number | null;
  subject: string;
  is_deleted: boolean;
  finished_at: string;
  lead_days: number | null;
  cycle_days: number | null;
  assignees: number[];
  finished_by: number | null;
}

export interface PeriodFinished {
  rows: FinishedRow[];
  people: Record<string, string>;
  usernames: Record<string, string>;
}

export interface ScrumScope {
  by: PeriodKind;
  from: string | null;
  to: string | null;
  pass: number;
  days?: DayKind;
}

function scrumParams(itemType: ItemType, selection: FilterSelection, scope: ScrumScope) {
  const params = new URLSearchParams({
    item_type: itemType,
    by: scope.by,
    pass_minutes: String(scope.pass),
  });
  if (scope.from) {
    params.set("from", scope.from);
  }
  if (scope.to) {
    params.set("to", scope.to);
  }
  addDays(params, scope.days);
  addSelection(params, selection);
  return params;
}

export function fetchPeriodStatusTimes(
  slug: string,
  itemType: ItemType,
  selection: FilterSelection,
  scope: ScrumScope,
): Promise<PeriodStatusTimes> {
  return getJson<PeriodStatusTimes>(
    `${projectApi(slug)}/scrum/status-times?${scrumParams(itemType, selection, scope)}`,
  );
}

export function fetchPeriodFinished(
  slug: string,
  itemType: ItemType,
  selection: FilterSelection,
  scope: ScrumScope,
  key: string,
): Promise<PeriodFinished> {
  const params = scrumParams(itemType, selection, scope);
  params.set("key", key);
  return getJson<PeriodFinished>(`${projectApi(slug)}/scrum/finished?${params}`);
}

export function fetchPeriodStays(
  slug: string,
  itemType: ItemType,
  selection: FilterSelection,
  scope: ScrumScope,
  key: string,
  statusId: number,
): Promise<PeriodStays> {
  const params = scrumParams(itemType, selection, scope);
  params.set("key", key);
  params.set("status_id", String(statusId));
  return getJson<PeriodStays>(`${projectApi(slug)}/scrum/stays?${params}`);
}

export function fetchMembers(slug: string): Promise<Member[]> {
  return getJson<Member[]>(`${projectApi(slug)}/members`);
}

export function searchCards(
  slug: string,
  query: string,
  itemType: ItemType | null,
  selection: FilterSelection | null = null,
  limit = 50,
): Promise<CardRow[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (itemType) {
    params.set("item_type", itemType);
  }
  addSelection(params, selection);
  return getJson<CardRow[]>(`${projectApi(slug)}/cards?${params}`);
}

export function fetchCardEvents(
  slug: string,
  itemType: ItemType,
  itemId: number,
): Promise<CardEvent[]> {
  return getJson<CardEvent[]>(`${projectApi(slug)}/cards/${itemType}/${itemId}/events`);
}

export type FilterCategoryKey =
  | "status"
  | "swimlane"
  | "assigned"
  | "role"
  | "created_by"
  | "created_by_role"
  | "epic"
  | "tag";

export interface FilterValue {
  value: string;
  label: string;
  count: number;
  color?: string | null;
}

export interface FilterCategory {
  key: FilterCategoryKey;
  title: string;
  values: FilterValue[];
}

export interface FilterPanelData {
  categories: FilterCategory[];
  total: number;
  matching: number;
}

export function fetchFilterPanel(
  slug: string,
  itemType: ItemType | null,
  selection: FilterSelection,
): Promise<FilterPanelData> {
  const params = new URLSearchParams();
  if (itemType) {
    params.set("item_type", itemType);
  }
  addSelection(params, selection);
  return getJson<FilterPanelData>(`${projectApi(slug)}/filters?${params}`);
}

export interface Me {
  id: number;
  username: string;
  full_name: string;
  email: string;
  is_superuser: boolean;
}

export async function fetchMe(): Promise<Me | null> {
  try {
    return await request<Me>("/api/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export function login(username: string, password: string): Promise<Me> {
  return request<Me>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export interface PageOption {
  key: Page;
  title: string;
}

export interface RoleAccess {
  role_id: number;
  name: string;
  pages: Page[];
  scope: Scope;
}

export interface AccessSettings {
  pages: PageOption[];
  roles: RoleAccess[];
}

export function fetchAccessSettings(slug: string): Promise<AccessSettings> {
  return getJson<AccessSettings>(`${projectApi(slug)}/access`);
}

export function updateRoleAccess(
  slug: string,
  roleId: number,
  pages: Page[],
  scope: Scope,
): Promise<RoleAccess> {
  return request<RoleAccess>(`${projectApi(slug)}/access/${roleId}`, {
    method: "PUT",
    body: JSON.stringify({ pages, scope }),
  });
}

export type ColumnType = "queue" | "work" | "rework" | "done" | "cancelled";

export interface ColumnInfo {
  status_id: number;
  name: string;
  color: string;
  position: number;
  is_closed: boolean;
  is_archived: boolean;
  is_deleted: boolean;
  cards: number;
  type: ColumnType | null;
}

export interface ItemTypeColumns {
  item_type: ItemType;
  columns: ColumnInfo[];
  show_removed: boolean;
}

export function setShowRemoved(
  slug: string,
  itemType: ItemType,
  showRemoved: boolean,
): Promise<void> {
  return request<void>(`${projectApi(slug)}/removed-columns/${itemType}`, {
    method: "PUT",
    body: JSON.stringify({ show_removed: showRemoved }),
  });
}

export function fetchColumns(slug: string): Promise<ItemTypeColumns[]> {
  return getJson<ItemTypeColumns[]>(`${projectApi(slug)}/columns`);
}

export function setColumnType(
  slug: string,
  itemType: ItemType,
  statusId: number,
  type: ColumnType | null,
): Promise<void> {
  return request<void>(`${projectApi(slug)}/columns/${itemType}/${statusId}`, {
    method: "PUT",
    body: JSON.stringify({ type }),
  });
}

export interface MemberCalendar {
  user_id: number;
  name: string;
  role: string;
  working_days: number[] | null;
}

export interface CalendarSettings {
  timezone: string;
  working_days: number[];
  members: MemberCalendar[];
}

export function fetchCalendar(slug: string): Promise<CalendarSettings> {
  return getJson<CalendarSettings>(`${projectApi(slug)}/calendar`);
}

export function saveCalendar(
  slug: string,
  timezone: string,
  workingDays: number[],
): Promise<void> {
  return request<void>(`${projectApi(slug)}/calendar`, {
    method: "PUT",
    body: JSON.stringify({ timezone, working_days: workingDays }),
  });
}

export function saveMemberDays(
  slug: string,
  userId: number,
  workingDays: number[] | null,
): Promise<void> {
  return request<void>(`${projectApi(slug)}/calendar/members/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ working_days: workingDays }),
  });
}

export interface ColumnTime {
  status_id: number;
  name: string;
  color: string;
  type: ColumnType | null;
  is_deleted: boolean;
  cards: number;
  p50: number | null;
  p85: number | null;
  p95: number | null;
  in_column_now: number;
}

export interface Sample {
  item_id: number;
  ref: number | null;
  subject: string;
  days: number;
  finished_at: string;
  created_at: string | null;
  is_deleted: boolean;
  assignees: number[];
  user_id: number | null;
}

export interface FinishedCard {
  item_id: number;
  ref: number | null;
  subject: string;
  finished_at: string;
  created_at: string | null;
  is_deleted: boolean;
  assignees: number[];
  user_id: number | null;
}

export interface Distribution {
  p50: number | null;
  p85: number | null;
  p95: number | null;
  samples: Sample[];
}

export interface Week {
  start: string;
  finished: number;
}

export interface BackMove {
  from_status: number;
  to_status: number;
  count: number;
  reopen: boolean;
  rework: boolean;
}

export interface MoveEvent {
  item_id: number;
  ref: number | null;
  subject: string;
  happened_at: string;
  user_id: number | null;
  assignees: number[];
  is_deleted: boolean;
}

export interface MoveCount {
  from_status: number | null;
  to_status: number | null;
  count: number;
  cards: number;
  events: MoveEvent[];
}

export interface PersonMoves {
  person_id: number | null;
  from_status: number | null;
  to_status: number | null;
  count: number;
}

export interface StuckCard {
  item_id: number;
  ref: number | null;
  subject: string;
  status_id: number;
  days_in_column: number;
  days_idle: number | null;
  level: "red" | "yellow" | null;
  p85: number | null;
  p95: number | null;
  assignees: number[];
  created_by: number | null;
}

export interface FlowReport {
  configured: boolean;
  missing: string[];
  cards: number;
  finished: number;
  in_progress: number;
  columns: ColumnTime[];
  lead_time: Distribution;
  cycle_time: Distribution;
  throughput: Week[];
  back_moves: {
    moves: BackMove[];
    cards_moved: number;
    cards_with_back_moves: number;
  };
  stuck: StuckCard[];
  moves: MoveCount[];
  moves_by_assignee: PersonMoves[];
  moves_by_mover: PersonMoves[];
  current: StuckCard[];
  column_cards: ColumnCard[];
  finishes: FinishedCard[];
}

export interface ColumnCard {
  status_id: number;
  now: boolean;
  item_id: number;
  ref: number | null;
  subject: string;
  created_at: string | null;
  is_deleted: boolean;
  days: number;
  assignees: number[];
  user_id: number | null;
}

export interface FlowResponse {
  report: FlowReport;
  people: Record<string, string>;
  usernames: Record<string, string>;
  period_start: string | null;
  period_end: string | null;
  generated_at: string;
  timezone: string;
  working_weekdays: number[];
}

export function fetchFlow(
  slug: string,
  itemType: ItemType,
  selection: FilterSelection,
  period: Period,
  column: number | null = null,
): Promise<FlowResponse> {
  const params = new URLSearchParams({ item_type: itemType });
  if (column !== null) {
    params.set("column", String(column));
  }
  addSelection(params, selection);
  addPeriod(params, period);
  return getJson<FlowResponse>(`${projectApi(slug)}/flow?${params}`);
}

export interface Stay {
  status_id: number;
  start: string;
  end: string | null;
  days: number;
  exited_by: number | null;
  level: StayLevel | null;
}

export interface ColumnTotal {
  status_id: number;
  days: number;
  visits: number;
}

export interface CardReport {
  stays: Stay[];
  columns: ColumnTotal[];
  finished_at: string | null;
  lead_days: number | null;
  cycle_days: number | null;
  back_moves: number;
}

export interface ColumnRef {
  status_id: number;
  name: string;
  color: string;
  type: ColumnType | null;
  is_deleted: boolean;
}

export interface CardFlow {
  item_type: ItemType;
  item_id: number;
  ref: number | null;
  subject: string;
  status_id: number | null;
  created_at: string | null;
  is_deleted: boolean;
  report: CardReport;
  columns: ColumnRef[];
  people: Record<string, string>;
  usernames: Record<string, string>;
}

export interface CardComment {
  id: string;
  created_at: string;
  edited_at: string | null;
  author_id: number | null;
  author_name: string;
  text: string;
}

export interface CardComments {
  comments: CardComment[];
  usernames: Record<string, string>;
}

export function fetchCardComments(
  slug: string,
  itemType: ItemType,
  itemId: number,
): Promise<CardComments> {
  return getJson<CardComments>(`${projectApi(slug)}/cards/${itemType}/${itemId}/comments`);
}

export function fetchCardFlow(
  slug: string,
  itemType: ItemType,
  itemId: number,
  days?: DayKind,
): Promise<CardFlow> {
  const params = new URLSearchParams();
  addDays(params, days);
  return getJson<CardFlow>(`${projectApi(slug)}/cards/${itemType}/${itemId}/flow?${params}`);
}

export interface PowerMetric {
  key: string;
  title: string;
  explanation: string;
  icon: string;
  module: "issues" | "tasks" | "wiki" | null;
  source: "taiga" | "extension";
  weight: number;
}

export interface TeamStats {
  metrics: PowerMetric[];
  values: Record<string, Record<string, number>>;
  modules: ("issues" | "tasks" | "wiki")[];
}

export function fetchTeamStats(slug: string, period: Period): Promise<TeamStats> {
  const params = new URLSearchParams();
  addPeriod(params, period);
  return getJson<TeamStats>(`${projectApi(slug)}/team-stats?${params}`);
}

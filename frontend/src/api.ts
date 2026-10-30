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

export type Page =
  | "overview"
  | "directions"
  | "people"
  | "my_page"
  | "trends"
  | "activity"
  | "cards";
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
  has_periods: boolean;
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
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
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

const pendingGets = new Map<string, Promise<unknown>>();

function getJson<T>(url: string): Promise<T> {
  const known = pendingGets.get(url);
  if (known) return known as Promise<T>;
  const pending = request<T>(url).finally(() => pendingGets.delete(url));
  pendingGets.set(url, pending);
  return pending;
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
  from_status_id: number | null;
  to_status_id: number | null;
  from_color: string | null;
  to_color: string | null;
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

export type ColumnType = "queue" | "work" | "done" | "cancelled";

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
  roles: number[];
  return_mode: ColumnMode;
}

export type ColumnMode = "normal" | "pause" | "triage";
export type Credit = "assignees" | "author" | "everyone" | "author_reviewer";

export interface ReturnSettings {
  earlier: boolean;
  out_of_done: boolean;
  misclick_minutes: number;
  credit: Credit;
}

export function setReturnSettings(
  slug: string,
  itemType: ItemType,
  settings: ReturnSettings,
): Promise<void> {
  return request<void>(`${projectApi(slug)}/returns/${itemType}`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function setColumnReturn(
  slug: string,
  itemType: ItemType,
  statusId: number,
  mode: ColumnMode,
): Promise<void> {
  return request<void>(`${projectApi(slug)}/columns/${itemType}/${statusId}/return`, {
    method: "PUT",
    body: JSON.stringify({ mode }),
  });
}

export interface ItemTypeColumns {
  item_type: ItemType;
  columns: ColumnInfo[];
  returns: ReturnSettings;
  return_pairs: ReturnPair[];
}

export interface ReturnPair {
  from_status: number;
  to_status: number;
  is_return: boolean;
}

export function setReturnPairs(
  slug: string,
  itemType: ItemType,
  pairs: ReturnPair[],
): Promise<void> {
  return request<void>(`${projectApi(slug)}/returns/${itemType}/pairs`, {
    method: "PUT",
    body: JSON.stringify({ pairs }),
  });
}

export function fetchColumns(slug: string): Promise<ItemTypeColumns[]> {
  return getJson<ItemTypeColumns[]>(`${projectApi(slug)}/columns`);
}

export interface RoleRef {
  id: number;
  name: string;
}

export function fetchRoles(slug: string): Promise<RoleRef[]> {
  return getJson<RoleRef[]>(`${projectApi(slug)}/roles`);
}

export function setColumnRoles(
  slug: string,
  itemType: ItemType,
  statusId: number,
  roleIds: number[],
): Promise<void> {
  return request<void>(`${projectApi(slug)}/columns/${itemType}/${statusId}/roles`, {
    method: "PUT",
    body: JSON.stringify({ role_ids: roleIds }),
  });
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
  used: boolean;
  passes: number;
  clean_passes: number;
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
  credited_status: number | null;
}

export interface ReturnEvent {
  item_id: number;
  ref: number | null;
  subject: string;
  happened_at: string;
  from_status: number;
  to_status: number;
  credited_status: number;
  credited: number[];
}

export interface FirstPassEvent {
  item_id: number;
  ref: number | null;
  subject: string;
  status_id: number;
  passed_at: string;
  author: number | null;
  clean: boolean;
}

export interface ReturnCase {
  item_id: number;
  ref: number | null;
  subject: string;
  kind: "direct" | "rework" | "unlinked_route";
  detected_at: string;
  from_status: number;
  to_status: number;
  routed_at: string | null;
  routed_to: number | null;
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
  days_in_status: number;
  age_days: number | null;
  calendar_age_days: number | null;
  age_p85: number | null;
  age_p95: number | null;
  status_level: "red" | "yellow" | null;
  age_level: "red" | "yellow" | null;
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
    cases: ReturnCase[];
    rework_entries: number;
    rework_routes: number;
    events: ReturnEvent[];
  };
  stuck: StuckCard[];
  stuck_at_end: StuckCard[];
  moves: MoveCount[];
  moves_by_assignee: PersonMoves[];
  moves_by_mover: PersonMoves[];
  current: StuckCard[];
  column_cards: ColumnCard[];
  finishes: FinishedCard[];
  first_passes: FirstPassEvent[];
  credited_returns: ReturnEvent[] | null;
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
  column_roles: Record<string, number[]>;
  roles: Record<string, string>;
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
  rest = false,
): Promise<FlowResponse> {
  const params = new URLSearchParams({ item_type: itemType });
  if (column !== null) {
    params.set("column", String(column));
  }
  if (rest) {
    params.set("side", "rest");
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
  aging: StuckCard | null;
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

export interface PersonProfile {
  id: number;
  name: string;
  username: string;
  role: string | null;
  role_id: number | null;
  is_member: boolean;
  is_owner: boolean;
  is_admin: boolean;
  is_active: boolean;
  item_types: ItemType[];
}

export interface PersonPage {
  profile: PersonProfile;
  metrics: PowerMetric[];
  values: Record<string, number>;
  highest: Record<string, number>;
  modules: ("issues" | "tasks" | "wiki")[];
}

export type ActivityKind = "create" | "move" | "assign" | "comment" | "edit" | "delete";

export interface ActivityEvent {
  id: string;
  happened_at: string;
  day: string;
  kind: ActivityKind;
  item_type: ItemType | null;
  item_id: number | null;
  ref: number | null;
  subject: string | null;
  is_deleted: boolean;
  other: string | null;
  from_status_id: number | null;
  to_status_id: number | null;
  from_status: string | null;
  to_status: string | null;
  from_color: string | null;
  to_color: string | null;
  fields: string[];
  comment: string | null;
}

export interface ActivityDay {
  day: string;
  counts: Partial<Record<ActivityKind, number>>;
}

export interface PersonActivity {
  events: ActivityEvent[];
  days: ActivityDay[];
  totals: Partial<Record<ActivityKind, number>>;
  total: number;
  truncated: boolean;
}

function personApi(slug: string, userId: number): string {
  return `${projectApi(slug)}/people/${userId}`;
}

export function fetchPerson(
  slug: string,
  userId: number,
  period: Period,
  selection: FilterSelection | null = null,
  itemType: ItemType | null = null,
): Promise<PersonPage> {
  const params = new URLSearchParams();
  addPeriod(params, period);
  addSelection(params, selection);
  if (itemType !== null) params.set("item_type", itemType);
  return getJson<PersonPage>(`${personApi(slug, userId)}?${params}`);
}

export function fetchPersonFlow(
  slug: string,
  userId: number,
  itemType: ItemType,
  period: Period,
  selection: FilterSelection | null = null,
): Promise<FlowResponse> {
  const params = new URLSearchParams({ item_type: itemType });
  addPeriod(params, period);
  addSelection(params, selection);
  return getJson<FlowResponse>(`${personApi(slug, userId)}/flow?${params}`);
}

export function fetchPersonActivity(
  slug: string,
  userId: number,
  period: Period,
  selection: FilterSelection | null = null,
  itemType: ItemType | null = null,
): Promise<PersonActivity> {
  const params = new URLSearchParams();
  addPeriod(params, period);
  addSelection(params, selection);
  if (itemType !== null) params.set("item_type", itemType);
  return getJson<PersonActivity>(`${personApi(slug, userId)}/activity?${params}`);
}

export interface TeamActivityDay {
  day: string;
  counts: Partial<Record<ActivityKind, number>>;
  person_kinds: Record<string, Partial<Record<ActivityKind, number>>>;
  people: Record<string, number>;
}

export interface TeamActivity {
  days: TeamActivityDay[];
  totals: Partial<Record<ActivityKind, number>>;
  total: number;
  people: Record<string, string>;
}

export function fetchTeamActivity(
  slug: string,
  period: Period,
  role: number | null = null,
  person: number | null = null,
  selection: FilterSelection | null = null,
  itemType: ItemType | null = null,
): Promise<TeamActivity> {
  const params = new URLSearchParams();
  addPeriod(params, period);
  addSelection(params, selection);
  if (itemType !== null) params.set("item_type", itemType);
  if (role !== null) {
    params.set("role", String(role));
  }
  if (person !== null) {
    params.set("person", String(person));
  }
  return getJson<TeamActivity>(`${projectApi(slug)}/activity?${params}`);
}

export interface TeamEvent extends ActivityEvent {
  user_id: number;
  user_name: string;
}

export interface TeamEvents {
  events: TeamEvent[];
  total: number;
  truncated: boolean;
}

export function fetchTeamEvents(
  slug: string,
  period: Period,
  role: number | null,
  person: number | null,
  kind: ActivityKind | null,
  selection: FilterSelection | null = null,
  itemType: ItemType | null = null,
): Promise<TeamEvents> {
  const params = new URLSearchParams();
  addPeriod(params, period);
  addSelection(params, selection);
  if (itemType !== null) params.set("item_type", itemType);
  if (role !== null) {
    params.set("role", String(role));
  }
  if (person !== null) {
    params.set("person", String(person));
  }
  if (kind !== null) {
    params.set("kind", kind);
  }
  return getJson<TeamEvents>(`${projectApi(slug)}/activity/events?${params}`);
}

export interface ReturnStats {
  returns: number;
  returned_cards: number;
  repeat_returns: number;
  repeated_cards: number;
  repeat_rate: number | null;
}

export interface ColumnShare extends ReturnStats {
  status_id: number;
  name: string;
  color: string;
  type: ColumnType | null;
  roles: number[];
  stays: number;
  days: number;
  person_stays: number;
  person_days: number;
  share: number | null;
  p50: number | null;
  person_p50: number | null;
  now: number;
  person_now: number;
  passes: number;
  clean_passes: number;
  returns: number;
}

export interface PersonShare extends ReturnStats {
  role_id: number | null;
  columns: ColumnShare[];
  roles: Record<string, string>;
  events: ReturnEvent[];
}

export function fetchPersonShare(
  slug: string,
  userId: number,
  itemType: ItemType,
  period: Period,
  selection: FilterSelection | null = null,
): Promise<PersonShare> {
  const params = new URLSearchParams({ item_type: itemType });
  addPeriod(params, period);
  addSelection(params, selection);
  return getJson<PersonShare>(`${personApi(slug, userId)}/share?${params}`);
}

export interface Cadence {
  weeks: number | null;
  start: string | null;
}

export interface ReportingSettings {
  scrum: boolean;
  taiga_sprints: number;
  cadence: Cadence;
}

export const PROJECTS_CHANGED_EVENT = "taiga-metrics:projects-changed";

export function fetchReporting(slug: string): Promise<ReportingSettings> {
  return getJson<ReportingSettings>(`${projectApi(slug)}/reporting`);
}

export async function saveReporting(slug: string, cadence: Cadence): Promise<void> {
  await request<void>(`${projectApi(slug)}/reporting`, {
    method: "PUT",
    body: JSON.stringify(cadence),
  });
  window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
}

export interface DirectionRef {
  role_id: number;
  name: string;
  columns: Partial<Record<ItemType, number[]>>;
  members: number[];
}

export interface DirectionColumn {
  time: ColumnTime;
  wip_limit: number | null;
}

export interface DirectionPerson extends ReturnStats {
  user_id: number;
  member: boolean;
  stays: number;
  days: number;
  share: number | null;
  p50: number | null;
  passes: number;
  clean_passes: number;
  returns: number;
}

export interface DirectionFlow extends ReturnStats {
  columns: DirectionColumn[];
  in_now: number;
  stuck: StuckCard[];
  passed: number;
  returned: BackMove[];
  sent_back: BackMove[];
  stays: number;
  days: number;
  people: DirectionPerson[];
  names: Record<string, string>;
  usernames: Record<string, string>;
}

export function fetchDirections(slug: string): Promise<DirectionRef[]> {
  return getJson<DirectionRef[]>(`${projectApi(slug)}/directions`);
}

export function fetchDirectionSummary(
  slug: string,
  itemType: ItemType,
  period: Period,
  selection: FilterSelection | null = null,
): Promise<BreakdownRow[]> {
  const params = new URLSearchParams({ item_type: itemType });
  addPeriod(params, period);
  addSelection(params, selection);
  return getJson<BreakdownRow[]>(`${projectApi(slug)}/directions/summary?${params}`);
}

export function fetchDirection(
  slug: string,
  roleId: number,
  itemType: ItemType,
  period: Period,
  selection: FilterSelection | null = null,
): Promise<DirectionFlow> {
  const params = new URLSearchParams({ item_type: itemType });
  addPeriod(params, period);
  addSelection(params, selection);
  return getJson<DirectionFlow>(`${projectApi(slug)}/directions/${roleId}?${params}`);
}

export type SubjectKind = "project" | "role" | "person";

export interface Subject {
  kind: SubjectKind;
  id: number | null;
}

export interface Tiles extends ReturnStats {
  in_progress: number;
  stuck: number;
  finished: number;
  lead_p50: number | null;
  lead_p85: number | null;
  cycle_p50: number | null;
  cycle_p85: number | null;
  passes: number;
  clean_passes: number;
  returns: number;
}

export interface BreakdownRow extends ReturnStats {
  kind: "role" | "person" | "status";
  id: number;
  name: string;
  statuses: number[];
  color: string | null;
  member: boolean | null;
  in_now: number;
  stuck: number;
  done: number;
  p50: number | null;
  share: number | null;
  passes: number;
  clean_passes: number;
  returns: number;
}

export interface Analysis {
  subject: Subject;
  name: string;
  tiles: Tiles;
  breakdown: BreakdownRow[];
  flow: FlowResponse;
  statuses: number[] | null;
  compared: number[] | null;
}

export function subjectKey(subject: Subject): string {
  return subject.kind === "project" ? "project" : `${subject.kind}:${subject.id}`;
}

export function parseSubject(value: string): Subject | null {
  if (value === "project") {
    return { kind: "project", id: null };
  }
  const [kind, raw] = value.split(":");
  const id = Number(raw);
  return (kind === "role" || kind === "person") && Number.isInteger(id) ? { kind, id } : null;
}

export function fetchAnalysis(
  slug: string,
  subject: Subject,
  itemType: ItemType,
  selection: FilterSelection,
  period: Period,
): Promise<Analysis> {
  const params = new URLSearchParams({ scope: subjectKey(subject), item_type: itemType });
  addSelection(params, selection);
  addPeriod(params, period);
  return getJson<Analysis>(`${projectApi(slug)}/analysis?${params}`);
}

export interface PersonSummary extends ReturnStats {
  user_id: number;
  name: string;
  username: string | null;
  role_id: number | null;
  in_progress: number;
  stuck: number;
  finished: number;
  lead_p50: number | null;
  cycle_p50: number | null;
  passes: number;
  clean_passes: number;
  returns: number;
}

export function fetchPeopleSummary(
  slug: string,
  itemType: ItemType,
  period: Period,
  selection: FilterSelection | null = null,
): Promise<PersonSummary[]> {
  const params = new URLSearchParams({ item_type: itemType });
  addPeriod(params, period);
  addSelection(params, selection);
  return getJson<PersonSummary[]>(`${projectApi(slug)}/people?${params}`);
}

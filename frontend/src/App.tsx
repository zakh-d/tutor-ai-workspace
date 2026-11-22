import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  BookOpen,
  Users,
  CalendarDays,
  CheckSquare,
  Files,
  GraduationCap,
  Layers,
  History,
  ArrowUpRight,
  Plus,
  Search,
  LogOut,
  ChevronRight,
  Settings,
  Link,
  Menu,
  X,
} from "lucide-react";
import { request, type RecordData, type Page } from "./api";
import { initializeAuth, keycloak, authRedirectUri } from "./auth";
import { canEditAssignment, firstUnansweredQuestion, requireAssignmentIdentity, requiresAnswer } from "./public-assignment";
import { describeDue, formatStatus, lessonDays, lessonStart, loadLessonPlans, loadOpenTasks, overviewPreviewLimit, previewRecords, selectLessonPlans, type LessonDay } from "./overview-data";
import { RecordSummary, ContentPreview, SubmissionAnswers, readableValue } from "./record-display";
import { SourceEditor } from "./source-editor";
import { DateTimeField, RequiredMark, TeacherTimezone, TimezoneField, ZonedTime } from "./time-fields";
import { displayTimeValue, endTimeError, isDateOnly, isTimeZone, resolveDateTime } from "./zoned-time";
import { effectiveStudentTimezone, useStudentTimezones } from "./student-timezones";
import { StudentSchedules } from "./student-schedules";
import { readSection, sectionHref, type WorkspaceSection } from "./workspace-navigation";
import { loadWorkspace } from "./workspace-timezone";
import { VersionBadge } from "./version-badge";

const navigationGroups = [
  {
    label: "Workspace",
    sections: [
      ["Overview", BookOpen],
      ["Students", Users],
      ["Lessons", GraduationCap],
      ["Calendar", CalendarDays],
      ["Tasks", CheckSquare],
    ],
  },
  {
    label: "Teaching resources",
    sections: [
      ["Materials", Files],
      ["Homework", BookOpen],
      ["Flashcards", Layers],
    ],
  },
  {
    label: "Administration",
    sections: [
      ["Activity", History],
      ["Settings", Settings],
      ["Connections", Link],
    ],
  },
] as const;

type ResourceIntent = { type: "create" } | { type: "detail"; record: RecordData };
type Navigate = (section: WorkspaceSection, intent?: ResourceIntent) => void;
const authSectionKey = "atelier-auth-section";
const displaySection = (section: WorkspaceSection) => section === "Tasks" ? "My to-dos" : section === "Assignments" ? "Homework" : section === "Calendar" ? "Google Calendar" : section;

const routes: Record<string, string> = {
  Students: "students",
  Lessons: "lessons",
  Materials: "materials",
  Tasks: "tasks",
  Homework: "homework-templates",
  Flashcards: "flashcard-sets",
  Activity: "history",
  Assignments: "assignments",
  Calendar: "calendar/events",
};
const fields: Record<string, string[]> = {
  Students: ["display_name", "timezone", "contact", "subject", "level", "goals", "notes"],
  Lessons: ["title", "student_id", "plan", "notes", "status", "material_ids"],
  Materials: ["title", "description", "tags", "student_ids", "lesson_ids"],
  Tasks: [
    "title",
    "description",
    "due_at",
    "status",
    "student_id",
    "lesson_id",
  ],
  Homework: ["title", "instructions", "questions", "source_refs"],
  Flashcards: ["title", "cards", "source_refs", "lesson_id"],
};
const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const text = readableValue;
const initial = (section: string) =>
  section === "Homework"
    ? {
        questions: [
          {
            id: crypto.randomUUID(),
            type: "written_response",
            prompt: "",
            points: 10,
            required: true,
            rubric: "",
            max_chars: 10000,
          },
        ],
        source_refs: [],
      }
    : section === "Flashcards"
      ? { cards: [{ term: "", definition: "" }], source_refs: [] }
      : section === "Lessons"
        ? { status: "planned", material_ids: [] }
        : section === "Tasks"
          ? { status: "todo" }
          : section === "Materials"
            ? { tags: [], student_ids: [], lesson_ids: [] }
            : {};
export function App() {
  const publicId = location.pathname.match(/^\/a\/([^/]+)$/)?.[1];
  return publicId ? <PublicAssignment id={publicId} /> : <Workspace />;
}
function Workspace() {
  const [auth, setAuth] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState("");
  const [workspace, setWorkspace] = useState<RecordData>();
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0);
  const [navigation, setNavigation] = useState<{ section: WorkspaceSection; intent?: ResourceIntent }>(
    () => ({ section: readSection(location.search) }),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const { section, intent } = navigation;

  useEffect(() => {
    const directSection = readSection(location.search);
    const callback = new URLSearchParams(location.hash.slice(1));
    const isCallback = callback.has("state") && (callback.has("code") || callback.has("error"));
    if (!isCallback) {
      sessionStorage.setItem(authSectionKey, sectionHref(directSection));
    }
    initializeAuth()
      .then((signedIn) => {
        const pendingHref = sessionStorage.getItem(authSectionKey);
        sessionStorage.removeItem(authSectionKey);
        if (isCallback && pendingHref) {
          const restored = readSection(new URL(pendingHref, location.origin).search);
          history.replaceState(history.state, "", sectionHref(restored));
          setNavigation({ section: restored });
        }
        setAuth(signedIn);
      })
      .catch((e) => setAuthError(e.message));
  }, []);

  useEffect(() => {
    const restoreSection = () => {
      setMenuOpen(false);
      setNavigation({ section: readSection(location.search) });
      requestAnimationFrame(() => main.current?.focus());
    };
    window.addEventListener("popstate", restoreSection);
    return () => window.removeEventListener("popstate", restoreSection);
  }, []);

  useEffect(() => {
    if (!auth) return;
    let active = true;
    loadWorkspace()
      .then(data => { if (active) setWorkspace(data); })
      .catch(error => { if (active) setWorkspaceError(error.message); });
    return () => { active = false; };
  }, [auth, workspaceAttempt]);

  const navigate: Navigate = (destination, nextIntent) => {
    if (destination !== section)
      history.pushState(null, "", sectionHref(destination));
    setMenuOpen(false);
    setNavigation({ section: destination, intent: nextIntent });
    if (!nextIntent) requestAnimationFrame(() => main.current?.focus());
  };
  function follow(event: MouseEvent<HTMLAnchorElement>, destination: WorkspaceSection) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    navigate(destination);
  }
  function signIn() {
    sessionStorage.setItem(authSectionKey, sectionHref(section));
    keycloak.login({ redirectUri: authRedirectUri }).catch((e) => setAuthError(e.message));
  }
  function signOut() {
    sessionStorage.removeItem(authSectionKey);
    void keycloak.logout({ redirectUri: authRedirectUri });
  }

  if (!auth) return (
    <main className="login">
      <div className="brand"><BookOpen aria-hidden="true" /> Atelier</div>
      <section className="panel login-card">
        <h1>Tutor workspace</h1>
        {authError ? (
          <p role="alert" className="error">Sign-in unavailable. {authError}</p>
        ) : auth === null ? (
          <p role="status">Connecting securely…</p>
        ) : (
          <button type="button" onClick={signIn}>Sign in <ArrowUpRight size={17} aria-hidden="true" /></button>
        )}
      </section>
    </main>
  );

  return (
    <div className="shell">
      <a className="skip-link" href="#workspace-main">Skip to main content</a>
      <aside className={menuOpen ? "rail menu-open" : "rail"}
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            setMenuOpen(false);
            menu.current?.focus();
          }
        }}
      >
        <div className="rail-heading">
          <a className="brand" href="/" onClick={(event) => follow(event, "Overview")}>
            <BookOpen aria-hidden="true" /> Atelier
          </a>
          <button type="button" className="secondary menu-toggle" ref={menu} aria-expanded={menuOpen}
            aria-controls="workspace-navigation" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            Menu
          </button>
        </div>
        <div className="rail-content" id="workspace-navigation">
          <nav aria-label="Workspace">
            {navigationGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <p>{group.label}</p>
                <ul>
                  {group.sections.map(([name, Icon]) => (
                    <li key={name}>
                      <a href={sectionHref(name)} aria-current={section === name || (section === "Assignments" && name === "Homework") ? "page" : undefined}
                        onClick={(event) => follow(event, name)}>
                        <Icon size={18} aria-hidden="true" />{displaySection(name)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="rail-account">
            <VersionBadge />
            <strong>{keycloak.tokenParsed?.preferred_username ?? "Tutor"}</strong>
            <button type="button" className="text-button" onClick={signOut}>
              <LogOut size={17} aria-hidden="true" />Sign out
            </button>
          </div>
        </div>
      </aside>
      <main id="workspace-main" className="workspace-main" ref={main} tabIndex={-1}>
        {workspace ? (
          <TeacherTimezone.Provider value={text(workspace.timezone)}>
            {section === "Overview" ? (
              <Overview navigate={navigate} follow={follow} />
            ) : section === "Settings" ? (
              <><div className="page-heading"><h1>Settings</h1></div><WorkspaceTimezoneSettings workspace={workspace} saveWorkspace={setWorkspace} /></>
            ) : section === "Connections" ? (
              <Connections />
            ) : (
              <Resource key={section} section={section} intent={intent} navigate={navigate} />
            )}
          </TeacherTimezone.Provider>
        ) : workspaceError ? (
          <div className="panel panel-state">
            <p role="alert">Couldn’t load workspace settings. {workspaceError}</p>
            <button type="button" className="secondary" onClick={() => {
              setWorkspaceError("");
              setWorkspaceAttempt(attempt => attempt + 1);
            }}>Retry</button>
          </div>
        ) : <p role="status">Loading workspace settings…</p>}
      </main>
    </div>
  );
}

function usePreview(fetchPage: () => Promise<Page>) {
  type State = { page: Page } | { error: string };
  const [state, setState] = useState<State>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    fetchPage()
      .then((page) => { if (active) setState({ page }); })
      .catch((error: Error) => { if (active) setState({ error: error.message }); });
    return () => { active = false; };
  }, [fetchPage, attempt]);
  return {
    state,
    retry() {
      setState(undefined);
      setAttempt((current) => current + 1);
    },
  };
}

function Overview({ navigate, follow }: {
  navigate: Navigate;
  follow: (event: MouseEvent<HTMLAnchorElement>, section: WorkspaceSection) => void;
}) {
  const lessons = usePreview(loadLessonPlans);
  const tasks = usePreview(loadOpenTasks);
  const [day, setDay] = useState<LessonDay>("All");
  const teacherZone = useContext(TeacherTimezone);
  const now = new Date();
  const lessonPage = lessons.state && "page" in lessons.state ? {
    page: { ...lessons.state.page, items: selectLessonPlans(lessons.state.page.items, day, now, teacherZone) },
  } : lessons.state;
  const students = useStudentTimezones([
    ...(lessonPage && "page" in lessonPage ? previewRecords(lessonPage.page.items, overviewPreviewLimit) : []),
    ...(tasks.state && "page" in tasks.state ? previewRecords(tasks.state.page.items, overviewPreviewLimit) : []),
  ]);
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeZone: teacherZone }).format(now);
  const planLesson = () => navigate("Lessons", { type: "create" });

  return (
    <>
      <div className="page-heading">
        <div><h1>Overview</h1><p>{date} · <a href={sectionHref("Settings")} onClick={event => follow(event, "Settings")}>Teacher timezone ({teacherZone})</a></p></div>
        <button type="button" onClick={planLesson}><Plus size={18} aria-hidden="true" />Plan a lesson</button>
      </div>
      <div className="overview-grid">
        <PreviewPanel title="Lesson plans" destination="Lessons" preview={{ ...lessons, state: lessonPage }}
          follow={follow} emptyTitle={day === "All" ? "No planned lessons" : `No planned lessons ${day.toLowerCase()}`}
          emptyAction={planLesson} emptyActionLabel="Plan a lesson" limit={overviewPreviewLimit}
          controls={<div className="lesson-day-filter" role="group" aria-label="Lesson day">
            {lessonDays.map(option => <button className="secondary" key={option} type="button"
              aria-pressed={day === option} onClick={() => setDay(option)}>{option}</button>)}
          </div>}>
          {(lesson) => (
            <button type="button" className="list-row record-button" onClick={() => navigate("Lessons", { type: "detail", record: lesson })}>
              <span className="record-icon"><GraduationCap size={19} aria-hidden="true" /></span>
              <span className="row-copy">
                <strong>{text(lesson.title)}</strong>
                {students.student(lesson) && <small>{text(students.student(lesson)?.display_name)}</small>}
                {displayTimeValue(lessonStart(lesson)) &&
                  <small><ZonedTime value={lessonStart(lesson)} studentZone={students.timezone(lesson)} /></small>}
              </span>
              <span className="badge">{formatStatus(lesson.status)}</span>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          )}
        </PreviewPanel>
        <PreviewPanel title="My to-dos" destination="Tasks" preview={tasks}
          follow={follow} emptyTitle="No open to-dos"
          emptyDescription="Add a private reminder for your next step."
          emptyAction={() => navigate("Tasks", { type: "create" })} emptyActionLabel="Add a to-do" limit={overviewPreviewLimit}>
          {(task) => {
            const due = describeDue(task.due_at, now, teacherZone);
            return (
              <button type="button" className="list-row record-button" onClick={() => navigate("Tasks", { type: "detail", record: task })}>
                <span className="row-copy">
                  <strong>{text(task.title)}</strong>
                  <small className={due.overdue ? "overdue" : undefined}>{due.text}</small>
                  {displayTimeValue(task.due_at) &&
                    <small><ZonedTime value={task.due_at} studentZone={students.timezone(task)} /></small>}
                </span>
                <span className="badge">{formatStatus(task.status)}</span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            );
          }}
        </PreviewPanel>
      </div>
    </>
  );
}

export function PreviewPanel({ title, destination, preview, follow, emptyTitle, emptyDescription, emptyAction, emptyActionLabel, children, controls, limit }: {
  title: string;
  destination: WorkspaceSection;
  preview: ReturnType<typeof usePreview>;
  follow: (event: MouseEvent<HTMLAnchorElement>, section: WorkspaceSection) => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction: () => void;
  emptyActionLabel: string;
  children: (record: RecordData) => ReactNode;
  controls?: ReactNode;
  limit?: number;
}) {
  const headingId = useId();
  const state = preview.state;
  return (
    <section className="panel preview-panel" aria-labelledby={headingId}>
      <div className="panel-title">
        <h2 id={headingId}>{title}</h2>
        <a className="text-link" href={sectionHref(destination)} onClick={(event) => follow(event, destination)}>
          View {destination.toLowerCase()} <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </div>
      {controls}
      {!state ? (
        <p className="panel-state" role="status">Loading {title.toLowerCase()}…</p>
      ) : "error" in state ? (
        <div className="panel-state">
          <p role="alert">Couldn’t load {title.toLowerCase()}. {state.error}</p>
          <button type="button" className="secondary" onClick={preview.retry}>Retry</button>
        </div>
      ) : state.page.items.length ? (
        <>
          {limit !== undefined && (state.page.next_cursor || state.page.items.length > limit) && (
            <p className="preview-note">Preview · showing {Math.min(limit, state.page.items.length)} records</p>
          )}
          <ul className="preview-list">
            {previewRecords(state.page.items, limit).map((record) => <li key={record.id}>{children(record)}</li>)}
          </ul>
        </>
      ) : (
        <Empty title={emptyTitle} description={emptyDescription} action={emptyAction} actionLabel={emptyActionLabel} />
      )}
    </section>
  );
}

function Empty({ title, description, action, actionLabel }: {
  title: string;
  description?: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <button type="button" className="secondary" onClick={action}>{actionLabel}</button>}
    </div>
  );
}

function RecordPage({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); window.scrollTo(0, 0); }, [title]);
  return <section className="record-page">
    <button type="button" className="text-button back-link" onClick={close}>‹ Back to list</button>
    <h1 tabIndex={-1} ref={heading}>{title}</h1>
    <div className="record-page-body">{children}</div>
  </section>;
}

const recordNames: Partial<Record<WorkspaceSection, string>> = {
  Students: "student",
  Lessons: "lesson",
  Materials: "material",
  Tasks: "to-do",
  Homework: "homework template",
  Flashcards: "flashcard set",
};

function recordTitle(record: Record<string, unknown>, fallback = "Record details") {
  return text(record.display_name ?? record.title ?? (record.content as { title?: string } | undefined)?.title) || fallback;
}

function Resource({ section, intent, navigate }: { section: WorkspaceSection; intent?: ResourceIntent; navigate: Navigate }) {
  const [rows, setRows] = useState<RecordData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; cursor?: string }>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [archived, setArchived] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const [editor, setEditor] = useState<Record<string, unknown> | null>(
    () => intent?.type === "create" ? initial(section) : null,
  );
  const [detail, setDetail] = useState<RecordData | null>(intent?.type === "detail" ? intent.record : null);
  const [selected, setSelected] = useState<RecordData | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [actionError, setActionError] = useState("");
  const [mutating, setMutating] = useState(false);
  const [result, setResult] = useState("");
  const loadSequence = useRef(0);
  const route = routes[section];
  const recordName = recordNames[section];
  const addLabel = section === "Lessons" ? "Plan a lesson" : recordName ? `Add a ${recordName}` : "";
  const calendarRange = useRef({
    start: new Date().toISOString(),
    end: new Date(Date.now() + 30 * 86400000).toISOString(),
  });

  const teacherZone = useContext(TeacherTimezone);
  const studentProfiles = useStudentTimezones([
    ...(["Lessons", "Tasks", "Calendar", "Assignments"].includes(section) ? rows : []),
    ...(selected ? [selected] : []),
  ]);

  useEffect(() => {
    if (intent?.type === "detail") openDetail(intent.record);
    else if (intent?.type === "create") setEditor(initial(section));
  }, [intent]);

  async function load(next?: string) {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(undefined);
    if (!next) {
      setRows([]);
      setCursor(null);
    }
    try {
      const params = new URLSearchParams();
      let path = "/" + route;
      if (materialSearch) {
        path = "/search";
        params.set("types", "materials");
        params.set("q", materialSearch);
      } else if (fields[section]) {
        params.set("archived", String(archived));
      }
      if (section === "Calendar") {
        params.set("start", calendarRange.current.start);
        params.set("end", calendarRange.current.end);
      }
      if (next) params.set("cursor", next);
      const page = await request<Page>(path + (params.size ? "?" + params : ""));
      if (sequence === loadSequence.current) {
        setRows((old) => (next ? [...old, ...page.items] : page.items));
        setCursor(page.next_cursor);
      }
    } catch (e) {
      if (sequence === loadSequence.current)
        setLoadError({ message: (e as Error).message, cursor: next });
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, [archived, materialSearch]);
  useEffect(() => {
    if (!detail) return;
    if (!fields[section] && section !== "Assignments") {
      setSelected(detail);
      return;
    }
    let active = true;
    request<{ data: RecordData }>("/" + route + "/" + detail.id)
      .then((response) => { if (active) setSelected(response.data); })
      .catch((error: Error) => { if (active) setDetailError(error.message); });
    return () => { active = false; };
  }, [detail, detailAttempt, route, section]);

  function closeDialog() {
    setEditor(null);
    setDetail(null);
    setSelected(null);
    setDetailError("");
    setActionError("");
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-dialog-focus]")?.focus());
  }
  function addRecord() {
    setEditor(initial(section));
  }
  function openDetail(record: RecordData) {
    setDetail(record);
    setSelected(null);
    setDetailError("");
    setActionError("");
  }
  function clearFilters() {
    setQuery("");
    setFilter("");
    setMaterialSearch("");
  }
  async function mutate(path: string, body: unknown = {}, revision?: number) {
    setActionError("");
    setMutating(true);
    try {
      const response = await request<{
        data?: RecordData;
        status?: string;
        url?: string;
        link?: string;
        access_url?: string;
      }>(path, { method: "POST", body, revision });
      setResult(
        (response.data?.access_link as string | undefined) ??
          (response.data?.link_unavailable
            ? "This link cannot be recovered. Replace assignment access to generate a new link."
            : undefined) ??
          response.link ??
          response.access_url ??
          response.url ??
          (response.status === "pending"
            ? "Operation queued; awaiting confirmation."
            : "Change saved."),
      );
      closeDialog();
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setMutating(false);
    }
  }

  const localQuery = materialSearch ? "" : query.trim().toLowerCase();
  const visible = rows.filter(
    (record) =>
      (!localQuery || JSON.stringify(record).toLowerCase().includes(localQuery)) &&
      (!filter || record.status === filter),
  );
  const filtered = Boolean(localQuery || filter || materialSearch);
  const selectedName = editor
    ? `${editor.id ? "Edit" : "New"} ${recordName}`
    : recordTitle(selected ?? detail ?? {}, section === "Activity" ? "Revision detail" : "Record details");

  return (
    <>
      {!editor && !detail && <>
      <div className="page-heading">
        <div><h1>{displaySection(section)}</h1>
        {section === "Tasks" && <p>Private reminders for you. To send exercises to a student, use Homework.</p>}
        </div>
        {recordName && (
          <button type="button" data-dialog-focus onClick={addRecord}>
            <Plus size={17} aria-hidden="true" />{addLabel}
          </button>
        )}
      </div>
      {["Homework", "Assignments"].includes(section) && <section className="homework-workflow" aria-label="Homework workflow">
        <ol><li><strong>Create</strong> reusable questions</li><li><strong>Send</strong> a private copy to a student</li><li><strong>Review</strong> answers and share feedback</li></ol>
        <nav className="workflow-tabs" aria-label="Homework views">
          <a href={sectionHref("Homework")} aria-current={section === "Homework" ? "page" : undefined} onClick={event => { event.preventDefault(); navigate("Homework"); }}>Create homework</a>
          <a href={sectionHref("Assignments")} aria-current={section === "Assignments" ? "page" : undefined} onClick={event => { event.preventDefault(); navigate("Assignments"); }}>Sent to students</a>
        </nav>
        <p>{section === "Homework" ? "A template holds reusable questions. Open a template to send a private copy to a student." : "Each assignment is a private copy of homework sent to one student. Open it to manage access and review answers."}</p>
      </section>}
      {result && (
        <div className="notice">
          {result.startsWith("http") ? <CopyLink url={result} /> : <p role="status">{result}</p>}
          <button type="button" className="text-button" onClick={() => setResult("")}>Dismiss</button>
        </div>
      )}
      {section === "Calendar" && <CalendarEditor refresh={() => load()} />}
      <section className="panel" aria-label={`${section} records`}>
        <div className="toolbar">
          <label className="search">
            <Search size={17} aria-hidden="true" />
            <input type="search" name="search-records" autoComplete="off"
              aria-label={`Search ${displaySection(section).toLowerCase()}`}
              placeholder={`Search ${displaySection(section).toLowerCase()}…`}
              maxLength={500} value={query} onChange={(event) => {
                setQuery(event.target.value);
                if (materialSearch && !event.target.value.trim()) setMaterialSearch("");
              }} />
          </label>
          {["Tasks", "Lessons"].includes(section) && (
            <select name="status" aria-label="Status" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="">All statuses</option>
              {(section === "Tasks" ? ["todo", "in_progress", "done"] : ["planned", "completed", "cancelled"]).map((status) => (
                <option key={status} value={status}>{formatStatus(status)}</option>
              ))}
            </select>
          )}
          {section === "Materials" && (
            <button type="button" className="secondary" disabled={!query.trim() || archived}
              onClick={() => {
                const term = query.trim();
                if (materialSearch === term) void load();
                else setMaterialSearch(term);
              }}>
              Search text
            </button>
          )}
          {recordName && (
            <label className="archive-filter">
              <input type="checkbox" name="archived" checked={archived} onChange={(event) => {
                setArchived(event.target.checked);
                setMaterialSearch("");
              }} />
              Archived
            </label>
          )}
        </div>
        {materialSearch && <p className="preview-note">Text search results for “{materialSearch}” <button type="button" className="text-button" onClick={clearFilters}>Clear search</button></p>}
        {loadError && (
          <div className="panel-state">
            <p className="error" role="alert">Couldn’t load {displaySection(section).toLowerCase()}. {loadError.message}</p>
            <button type="button" className="secondary" onClick={() => load(loadError.cursor)}>Retry</button>
          </div>
        )}
        {loading && <p className="panel-state" role="status">Loading {displaySection(section).toLowerCase()}…</p>}
        {visible.length > 0 && (
          <div className="records">
            {visible.map((record) => {
              const due = section === "Tasks" ? describeDue(record.due_at, undefined, teacherZone) : null;
              const summary = section === "Assignments" ? text(studentProfiles.student(record)?.display_name) : text(record.subject ?? record.description ?? record.actor_category);
              const time = section === "Lessons" ? lessonStart(record) : section === "Calendar" ? record.start :
                (section === "Tasks" || section === "Assignments") ? record.due_at : undefined;
              const timeLabel = section === "Assignments" || (section === "Tasks" && record.status === "done") ? "Due" :
                section === "Lessons" || section === "Calendar" ? "Starts" : "";
              return (
                <button type="button" className="list-row record-button" key={record.id} onClick={() => openDetail(record)}>
                  <span className="record-icon" aria-hidden="true">
                    {section === "Students" ? text(record.display_name).slice(0, 1) : <BookOpen size={19} />}
                  </span>
                  <span className="row-copy">
                    <strong>{recordTitle(record, section === "Assignments" ? "Sent homework" : label(text(record.entity_type) || recordName || "Record"))}</strong>
                    {due && record.status !== "done" && <small className={due.overdue ? "overdue" : undefined}>{due.text}</small>}
                    {!due && summary && <small>{summary}</small>}
                    {displayTimeValue(time) &&
                      <small>{timeLabel && <strong>{timeLabel}</strong>}<ZonedTime value={time} studentZone={studentProfiles.timezone(record)} /></small>}
                  </span>
                  {record.status != null && <span className="badge">{formatStatus(record.status)}</span>}
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
        {!loading && !loadError && !visible.length && (
          filtered ? (
            <Empty title={cursor ? "No matches in the loaded records" : "No matching records"}
              description={cursor ? "Clear the filters or load more records." : undefined}
              action={clearFilters} actionLabel="Clear filters" />
          ) : (
            <Empty title={`No ${archived ? "archived " : ""}${displaySection(section).toLowerCase()}${section === "Homework" ? " templates" : ""} yet`}
              action={recordName && !archived ? addRecord : undefined} actionLabel={addLabel} />
          )
        )}
        {cursor && !loadError && (
          <button type="button" className="secondary load-more" disabled={loading} onClick={() => load(cursor)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </section>
      </>}
      {(editor || detail) && (
        <RecordPage title={selectedName} close={closeDialog}>
          {editor ? (
            <Editor section={section} record={editor} close={closeDialog}
              saved={() => { setResult(`${section === "Tasks" ? "To-do" : label(recordName ?? "Record")} saved.`); closeDialog(); void load(); }} />
          ) : selected ? (
            <div className="detail">
              <RecordSummary record={section === "Students" ? {
                ...selected, timezone: selected.timezone ?? `${teacherZone} (teacher timezone)`,
              } : selected} studentZone={studentProfiles.timezone(selected)} />
              {section === "Lessons" && Boolean(selected.calendar_event_id) &&
                <LinkedCalendarEvent id={text(selected.calendar_event_id)} navigate={navigate} />}
              <RelatedRecords record={selected} navigate={navigate} />
              <ContentPreview record={selected} />
              {actionError && <p role="alert" className="error">{actionError}</p>}
              {mutating && <p role="status">Saving changes…</p>}
              <fieldset className="detail-actions" disabled={mutating}>
              {fields[section] && (
                <>
                  <button type="button"
                    onClick={() => {
                      setEditor(selected);
                      setSelected(null);
                    }}
                  >
                    Edit record
                  </button>
                  <button type="button"
                    className="secondary"
                    onClick={() => {
                      if (!selected.archived_at && !confirm(section === "Students"
                        ? "Archive this student? Existing assignments and access links stay active until you revoke them."
                        : `Archive this ${recordName}?`)) return;
                      void mutate(
                        `/${route}/${selected.id}/${selected.archived_at ? "restore" : "archive"}`,
                        {},
                        selected.revision,
                      );
                    }}
                  >
                    {selected.archived_at ? "Restore" : "Archive"}
                  </button>
                </>
              )}
              {section === "Students" && <StudentSchedules student={selected} openLesson={lesson => navigate("Lessons", { type: "detail", record: lesson })} />}
              {section === "Students" && <StudentProgress student={selected} navigate={navigate} />}
              {section === "Materials" && <MaterialTools material={selected} />}{" "}
              {section === "Calendar" && (
                <CalendarTools
                  event={selected}
                  studentZone={studentProfiles.timezone(selected)}
                  refresh={() => {
                    closeDialog();
                    void load();
                  }}
                />
              )}
              {section === "Assignments" && (
                <AssignmentReview
                  assignment={selected}
                  studentZone={studentProfiles.timezone(selected)}
                  refresh={() => {
                    closeDialog();
                    void load();
                  }}
                />
              )}
              {section === "Materials" && (
                <label className="file-control">
                  Upload a material version
                  <input
                    type="file"
                    accept=".pdf,.pptx,.docx,.md,.txt"
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      const file = input.files?.[0];
                      if (!file) return;
                      input.value = "";
                      const body = new FormData();
                      body.append("file", file);
                      await mutate(
                        `/materials/${selected.id}/versions`,
                        body,
                        selected.revision,
                      );
                    }}
                  />
                </label>
              )}
              {section === "Homework" && (
                <Publish
                  template={selected}
                  onPublish={(body) =>
                    mutate(
                      `/homework-templates/${selected.id}/publish`,
                      body,
                      selected.revision,
                    )
                  }
                />
              )}{" "}
              {section === "Flashcards" && (
                <button type="button"
                  className="secondary"
                  onClick={async () => {
                    try {
                      await download(
                        `/api/v1/flashcard-sets/${selected.id}/export`,
                        "flashcards.tsv",
                      );
                    } catch (e) {
                      setActionError((e as Error).message);
                    }
                  }}
                >
                  Download TSV
                </button>
              )}
              {section === "Activity" && (
                <button type="button"
                  className="secondary"
                  onClick={() => {
                    if (
                      confirm(
                        "Restore this revision’s previous state as a new revision? Later edits and irreversible effects may prevent restoration.",
                      )
                    )
                      mutate("/history/undo", {
                        target_revision_id: selected.id,
                        expected_current_revision: selected.revision,
                      });
                  }}
                >
                  Restore previous state
                </button>
              )}
              </fieldset>

            </div>
          ) : detailError ? (
            <>
              <p role="alert" className="error">Couldn’t load record details. {detailError}</p>
              <button type="button" className="secondary" onClick={() => {
                setDetailError("");
                setDetailAttempt((attempt) => attempt + 1);
              }}>Retry</button>
            </>
          ) : <p role="status">Loading record details…</p>}
        </RecordPage>
      )}
    </>
  );
}

function CopyLink({ url }: { url: string }) {
  const [feedback, setFeedback] = useState("");
  return (
    <>
      <label>
        Assignment link
        <input readOnly value={url} />
      </label>
      <button type="button" onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setFeedback("Link copied.");
        } catch {
          setFeedback("Couldn’t copy automatically. Select the assignment link and copy it.");
        }
      }}>Copy link</button>
      <p>Copy this link now. It cannot be shown again.</p>
      <p role="status" className="copy-feedback">{feedback}</p>
    </>
  );
}
function Publish({
  template,
  onPublish,
}: {
  template: RecordData;
  onPublish: (b: unknown) => void;
}) {
  const [student, setStudent] = useState(""),
    [due, setDue] = useState(""),
    [error, setError] = useState("");
  const teacherZone = useContext(TeacherTimezone);
  const studentRef = { student_id: student };
  const studentZone = useStudentTimezones([studentRef]).timezone(studentRef);
  return (
    <form
      className="publish"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        try {
          onPublish({
            student_id: student,
            due_at: resolveDateTime(due, teacherZone),
            public_attachment_ids: [],
          });
        } catch (error) {
          setError((error as Error).message);
        }
      }}
    >
      <h3>Send to a student</h3>
      <label>
        <span>Student<RequiredMark /></span>
        <ReferenceInput
          route="students"
          value={student}
          change={setStudent}
          required
        />
      </label>
      <DateTimeField label="Due date (optional)" value={due} onChange={setDue} studentZone={studentZone} />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit">Send & get private link</button>
      <small>
        A private copy of “{text(template.title)}” will be shared with this student.
      </small>
    </form>
  );
}
function Editor({
  section,
  record,
  close,
  saved,
}: {
  section: string;
  record: Record<string, unknown>;
  close: () => void;
  saved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(record),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const existing = record as RecordData;
  const teacherZone = useContext(TeacherTimezone);
  const students = useStudentTimezones([draft]);
  const student = students.student(draft);
  const studentZone = students.timezone(draft);
  const nativeTiming = section === "Lessons" && !existing.calendar_event_id;
  const lessonZone = (typeof draft.timezone === "string" ? draft.timezone : teacherZone);
  const start = text(draft.starts_at);
  const end = text(draft.ends_at);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {};
      for (const field of fields[section]) {
        let v = draft[field];
        if (
          [
            "questions",
            "cards",
            "source_refs",
            "tags",
            "material_ids",
            "student_ids",
            "lesson_ids",
          ].includes(field)
        )
          v = typeof v === "string" ? JSON.parse(v) : (v ?? []);
        if (field === "due_at") {
          if (v !== undefined) payload[field] = resolveDateTime(text(v), teacherZone);
          continue;
        }
        if (field === "timezone" && v && !isTimeZone(text(v))) throw new Error("Choose a valid IANA timezone.");
        if (v === "" && existing.id && !["title", "display_name", "instructions"].includes(field)) {
          payload[field] = null;
          continue;
        }
        if (v !== undefined && v !== "") payload[field] = v;
      }
      if (nativeTiming) {
        const starts = resolveDateTime(text(draft.starts_at), lessonZone);
        const ends = resolveDateTime(text(draft.ends_at), lessonZone);
        if (Boolean(starts) !== Boolean(ends)) throw new Error("Enter both a start and an end to schedule the lesson.");
        if (starts && ends && Date.parse(ends) <= Date.parse(starts)) throw new Error("The end must follow the start.");
        if (starts || existing.starts_at) {
          payload.starts_at = starts;
          payload.ends_at = ends;
          payload.timezone = starts ? lessonZone : null;
        }
        if (existing.schedule_id && !starts) throw new Error("Recurring lessons need a start and end. You can cancel this lesson using its status.");
      }
      await request(
        "/" + routes[section] + (existing.id ? "/" + existing.id : ""),
        {
          method: existing.id ? "PATCH" : "POST",
          body: payload,
          revision: existing.id ? existing.revision : undefined,
        },
      );
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} autoComplete="off">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <fieldset className="editor-fields" disabled={busy}>
        {fields[section].map((field) => {
          const val = draft[field];
          if (field === "timezone") return <TimezoneField key={field} label="Student timezone" value={text(val)}
            onChange={timezone => setDraft({ ...draft, timezone })} placeholder={`Use teacher timezone (${teacherZone})`} />;
          if (field === "due_at") return <DateTimeField key={field} label="Due date" value={text(val)}
            onChange={due_at => setDraft({ ...draft, due_at })} studentZone={studentZone} />;
          if (field === "tags") return <label key={field}>Tags<input value={Array.isArray(val) ? val.join(", ") : text(val)} onChange={event => setDraft({ ...draft, tags: event.target.value.split(",").map(tag => tag.trim()).filter(Boolean) })} /><small>Separate tags with commas.</small></label>;
          if (field === "source_refs") return <SourceEditor key={field} value={Array.isArray(val) ? val : []} change={value => setDraft({ ...draft, source_refs: value })} />;
          if(field==='contact')return <label key={field}>Contact email<input type="email" value={(val as {email?:string}|null)?.email??''} onChange={e=>setDraft({...draft,contact:e.target.value?{email:e.target.value}:null})}/></label>;
          if (["student_id", "lesson_id"].includes(field))
            return (
              <label key={field}>
                <span>{field === "student_id" ? "Student" : "Lesson"}
                  {section === "Lessons" && field === "student_id" && !existing.schedule_id && <RequiredMark />}
                </span>
                {section === "Lessons" && field === "student_id" && existing.schedule_id ?
                  <span>{text(student?.display_name) || "Original student"}</span> :
                  <ReferenceInput
                    route={field === "student_id" ? "students" : "lessons"}
                    value={text(val)}
                    change={(v) => setDraft({ ...draft, [field]: v })}
                    required={section === "Lessons" && field === "student_id"}
                  /> }
              </label>
            );
          if (["student_ids", "lesson_ids", "material_ids"].includes(field))
            return (
              <label key={field}>
                {field === "student_ids" ? "Students" : field === "lesson_ids" ? "Lessons" : "Materials"}
                <ReferenceMultiple
                  route={
                    field === "student_ids"
                      ? "students"
                      : field === "lesson_ids"
                        ? "lessons"
                        : "materials"
                  }
                  value={Array.isArray(val) ? (val as string[]) : []}
                  change={(v) => setDraft({ ...draft, [field]: v })}
                />
              </label>
            );
          if (field === "questions")
            return (
              <QuestionEditor
                key={field}
                value={Array.isArray(val) ? val : []}
                change={(v) => setDraft({ ...draft, questions: v })}
              />
            );
          if (field === "cards")
            return (
              <CardEditor
                key={field}
                value={Array.isArray(val) ? val : []}
                change={(v) => setDraft({ ...draft, cards: v })}
              />
            );
          return (
            <label key={field}>
              <span>{label(field)}{["title", "display_name"].includes(field) && <RequiredMark />}</span>
              {field === "status" ? (
                <select
                  value={text(
                    val ?? (section === "Tasks" ? "todo" : "planned"),
                  )}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                >
                  {(section === "Tasks"
                    ? ["todo", "in_progress", "done"]
                    : ["planned", "completed", "cancelled"]
                  ).map((v) => (
                    <option key={v} value={v}>{formatStatus(v)}</option>
                  ))}
                </select>
              ) : [
                  "description",
                  "plan",
                  "notes",
                  "goals",
                  "instructions",
                ].includes(field) ? (
                <textarea
                  rows={3}
                  value={text(val)}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              ) : (
                <input
                  required={["title", "display_name"].includes(field)}
                  type="text"
                  name={field}
                  value={text(val)}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              )}{" "}
            </label>
          );
        })}
        {nativeTiming && <>
          <TimezoneField label="Lesson timezone" value={lessonZone} onChange={timezone => setDraft({ ...draft, timezone })} required />
          <DateTimeField label="Start" value={start} onChange={starts_at => setDraft({ ...draft, starts_at })}
            inputZone={lessonZone} studentZone={studentZone} required={Boolean(existing.schedule_id || end)} />
          <DateTimeField label="End" value={end} onChange={ends_at => setDraft({ ...draft, ends_at })}
            inputZone={lessonZone} studentZone={studentZone} required={Boolean(existing.schedule_id || start)}
            rangeError={endTimeError(start, end, lessonZone)} />
        </>}
        {section === "Lessons" && Boolean(existing.calendar_event_id) && <p>To reschedule this lesson, open its linked Google Calendar event.</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
        </div>
        </fieldset>
    </form>
  );
}
async function download(path: string, name: string) {
  await keycloak.updateToken(30);
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${keycloak.token}` },
  });
  if (!response.ok) throw new Error("Download unavailable");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function WorkspaceTimezoneSettings({ workspace, saveWorkspace }: { workspace: RecordData; saveWorkspace: (workspace: RecordData) => void }) {
  const [timezone, setTimezone] = useState(text(workspace.timezone));
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel connection">
      <h2>Workspace timezone</h2>
      <form onSubmit={async event => {
        event.preventDefault();
        setError("");
        setFeedback("");
        setBusy(true);
        try {
          if (!isTimeZone(timezone)) throw new Error("Choose a valid IANA timezone.");
          const { data } = await request<{ data: RecordData }>("/workspace", {
            method: "PATCH", revision: workspace.revision, body: { timezone },
          });
          saveWorkspace(data);
          setFeedback("Teacher timezone saved.");
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        <TimezoneField label="Teacher timezone" value={timezone} onChange={setTimezone} required />
        <button type="submit" disabled={busy || (workspace.timezone_configured === true && timezone === workspace.timezone)}>Save timezone</button>
      </form>
      {feedback && <p role="status">{feedback}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
function Connections() {
  const [error, setError] = useState(""),
    [connection, setConnection] = useState<RecordData | null>(null);
  useEffect(() => {
    request<{ data: RecordData }>("/calendar/connection")
      .then((r) => setConnection(r.data))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <h1>Connections</h1>
      </div>
      <section className="panel connection">
        <h2>Google Calendar</h2>
        <p>
          Connect one writable calendar to schedule lessons. Google remains the
          source of event timing.
        </p>
        {connection && (
          <>
            <p>Status: {formatStatus(connection.status)}</p>
            {typeof connection.calendar_name === "string" && <p>Teaching calendar: {connection.calendar_name}</p>}
            {connection.status === "select_calendar" && (
              <CalendarSelection
                connection={connection}
                saved={setConnection}
              />
            )}
          </>
        )}
        <button type="button"
          onClick={async () => {
            try {
              const r = await request<{
                data?: { authorization_url?: string };
                url?: string;
                authorization_url?: string;
              }>("/calendar/connection/authorize", {
                method: "POST",
                body: {},
              });
              const url =
                r.data?.authorization_url ?? r.authorization_url ?? r.url;
              if (url) location.assign(url);
              else
                throw new Error(
                  "The server did not return an authorization URL",
                );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Connect Google Calendar <ArrowUpRight size={16} />
        </button>
        {connection && (
          <button type="button"
            className="secondary"
            onClick={async () => {
              try {
                await request("/calendar/connection/disconnect", {
                  method: "POST",
                  body: {},
                  revision: connection.revision,
                });
                setConnection(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Disconnect
          </button>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <section className="panel connection">
        <h2>External AI assistant</h2>
        <p>
          Connect an approved remote Streamable HTTP MCP client using OAuth with
          PKCE. Your assistant can access student data and materials when
          requested. Only the tutor website can release grades or reopen
          submissions.
        </p>
        <label>
          Server URL
          <input readOnly value={location.origin + "/mcp"} />
        </label>
        <p>
          Ask your deployment operator for the registered client ID, exact
          redirect URI, and supported scopes. No shared API key is required.
        </p>
        <code>
          workspace:read workspace:write assignments:publish calendar:read
          calendar:write grading:propose history:read history:undo
        </code>
      </section>
    </>
  );
}
type Question = {
  id: string;
  type: string;
  prompt: string;
  points: number;
  required: boolean;
  max_chars?: number;
  allowed_types?: string[];
  max_files?: number;
  options?: { id: string; text: string }[];
};
type PublicData = {
  id: string;
  title: string;
  instructions: string;
  questions: Question[];
  due_at?: string;
  teacher_timezone?: string;
  student_timezone?: string;
  status: string;
  attempt: {
    id: string;
    revision: number;
    status: string;
    answers: { question_id: string; value: unknown }[];
    files?: { id: string; question_id: string; filename: string }[];
  };
  attachments?: { id: string; filename: string }[];
  released_result?: {
    items: { question_id: string; awarded_points: number; feedback: string }[];
    overall_feedback: string;
  };
};
function PublicAssignment({ id }: { id: string }) {
  const [data, setData] = useState<PublicData | null>(null),
    [csrf, setCsrf] = useState(""),
    [answers, setAnswers] = useState<Record<string, unknown>>({}),
    [error, setError] = useState(""),
    [operation, setOperation] = useState<"saving" | "submitting" | "uploading" | "removing" | "reloading" | null>(null),
    [message, setMessage] = useState(""),
    [conflict, setConflict] = useState(false),
    [validateAnswers, setValidateAnswers] = useState(false);
  const busy = operation !== null;
  const apply = (d: PublicData) => {
    requireAssignmentIdentity(id, d.id);
    setData(d);
    const saved = Object.fromEntries(
      (d.attempt.answers ?? []).map((a) => [a.question_id, a.value]),
    );
    for (const question of d.questions)
      if (question.type === "file_upload")
        saved[question.id] = (d.attempt.files ?? [])
          .filter((f) => f.question_id === question.id)
          .map((f) => f.id);
    setAnswers(saved);
  };
  useEffect(() => {
    const token = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
    (async () => {
      try {
        if (token) {
          const r = await request<{
            csrf_token: string;
            assignment: PublicData;
          }>(`/assignments/${id}/session`, {
            public: true,
            method: "POST",
            body: { token },
          });
          setCsrf(r.csrf_token);
          sessionStorage.setItem("assignment-csrf", r.csrf_token);
          apply(r.assignment);
        } else {
          setCsrf(sessionStorage.getItem("assignment-csrf") ?? "");
          apply(await request<PublicData>("/assignment", { public: true }));
        }
      } catch {
        setError(
          "This assignment is unavailable. Please contact your tutor for a current link.",
        );
      }
    })();
  }, [id]);
  async function save() {
    if (!data) return false;
    const response = await request<{
      revision: number;
      data?: { revision: number };
    }>("/attempt", {
      public: true,
      method: "PATCH",
      revision: data.attempt.revision,
      csrf,
      body: {
        answers: Object.entries(answers).map(([question_id, value]) => ({
          question_id,
          value,
        })),
      },
    });
    const revision = response.revision ?? response.data?.revision;
    if (!revision)
      throw new Error(
        "Save returned no revision. Reload to check the saved draft.",
      );
    setData({ ...data, attempt: { ...data.attempt, revision } });
    return revision;
  }
  async function action(submit = false, form?: HTMLFormElement) {
    if (!data || busy) return;
    const missingIndex = firstUnansweredQuestion(data.questions, answers, submit);
    if (submit) setValidateAnswers(true);
    if (missingIndex !== -1) {
      form?.querySelector<HTMLElement>(`[data-question-index="${missingIndex}"] :is(input, textarea)`)?.focus();
      return;
    }
    setOperation(submit ? "submitting" : "saving");
    setError("");
    setMessage("");
    try {
      const revision = await save();
      if (submit && revision) {
        const result = await request<{ data: PublicData["attempt"] }>("/attempt/submit", {
          public: true,
          method: "POST",
          revision,
          csrf,
          body: {},
        });
        apply({ ...data, attempt: result.data });
        setMessage("Your work has been submitted.");
      } else setMessage("Draft saved. You can come back to it.");
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 409) setConflict(true);
    } finally {
      setOperation(null);
    }
  }
  return (
    <main className="assignment">
      <div className="brand"><BookOpen aria-hidden="true" /> Atelier</div>
      {!data ? (
        <div className="assignment-heading">
          <h1>Assignment</h1>
          {error ? <p className="error" role="alert">{error}</p> : <p role="status">Loading assignment…</p>}
        </div>
      ) : (
        <>
          <div className="assignment-heading">
            <h1>{data.title}</h1>
            <span className="badge">{data.status !== "open" ? "Closed" : formatStatus(data.attempt.status)}</span>
            <p className="preserve">{data.instructions}</p>
            {data.due_at && (
              <div className="public-due">
                <strong>Due</strong>
                {data.teacher_timezone && isTimeZone(data.teacher_timezone) ? (
                  <TeacherTimezone.Provider value={data.teacher_timezone}>
                    <ZonedTime value={data.due_at} studentZone={data.student_timezone && isTimeZone(data.student_timezone) ? data.student_timezone : undefined} />
                  </TeacherTimezone.Provider>
                ) : <ZonedTime value={data.due_at} studentOnly />}
              </div>
            )}
          </div>
          {!canEditAssignment(data.status, data.attempt.status) && (
            <p className="notice" role="status">
              {data.status !== "open"
                ? "This assignment is closed. Contact your tutor to continue."
                : "Your answers have been submitted. Your tutor will share feedback here when it is ready."}
            </p>
          )}
          {(data.attachments ?? []).map((file) => (
            <p key={file.id}>
              <a href={"/public/v1/files/" + file.id} download>
                {file.filename}
              </a>
            </p>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(true, e.currentTarget);
            }}
          >
            {data.questions.map((q, i) => {
              const readonly = !canEditAssignment(data.status, data.attempt.status);
              const invalid = !readonly && validateAnswers && requiresAnswer(q, answers);
              const errorId = `assignment-answer-error-${i}`;
              return (
                <fieldset
                  className="panel question"
                  key={q.id}
                  disabled={readonly || busy || conflict}
                  data-question-index={i}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errorId : undefined}
                >
                  <legend>
                    <span>{i + 1}.</span> {q.prompt}{" "}
                    {q.required && <><RequiredMark /><span className="sr-only"> Required</span></>}
                  </legend>
                  <small>{q.points} points</small>
                  {["single_choice", "multiple_choice"].includes(q.type) ? (
                    q.options?.map((option) => (
                      <label className="option" key={option.id}>
                        <input
                          type={
                            q.type === "single_choice" ? "radio" : "checkbox"
                          }
                          name={q.id}
                          checked={
                            q.type === "single_choice"
                              ? answers[q.id] === option.id
                              : Array.isArray(answers[q.id]) &&
                                (answers[q.id] as string[]).includes(option.id)
                          }
                          onChange={(e) => {
                            if (q.type === "single_choice")
                              setAnswers({ ...answers, [q.id]: option.id });
                            else {
                              const current = (answers[q.id] ?? []) as string[];
                              setAnswers({
                                ...answers,
                                [q.id]: e.target.checked
                                  ? [...current, option.id]
                                  : current.filter((v) => v !== option.id),
                              });
                            }
                          }}
                        />
                        {option.text}
                      </label>
                    ))
                  ) : q.type === "file_upload" ? (
                    <>
                      {!readonly && <label className="file-control">
                        Attach a file
                        <input
                          type="file"
                          name={`file-${q.id}`}
                          accept={(q.allowed_types ?? ["pdf", "docx", "txt", "png", "jpg", "jpeg"]).map(type => "." + type).join(",")}
                          disabled={(data.attempt.files ?? []).filter(file => file.question_id === q.id).length >= (q.max_files ?? 3)}
                          onChange={async (e) => {
                            const input = e.currentTarget;
                            const file = input.files?.[0];
                            if (!file) return;
                            input.value = "";
                            setOperation("uploading");
                            setError("");
                            setMessage("");
                            try {
                              const body = new FormData();
                              body.append("question_id", q.id);
                              body.append("file", file);
                              await request("/attempt/files", {
                                public: true,
                                method: "POST",
                                body,
                                revision: (await save()) || data.attempt.revision,
                                csrf,
                              });
                              apply(
                                await request<PublicData>("/assignment", {
                                  public: true,
                                }),
                              );
                              setMessage("File attached.");
                            } catch (err) {
                              setError((err as Error).message);
                              if ((err as { status?: number }).status === 409) setConflict(true);
                            } finally {
                              setOperation(null);
                            }
                          }}
                        />
                      </label>}
                      {(data.attempt.files ?? [])
                        .filter((f) => f.question_id === q.id)
                        .map((file) => (
                          <div className="attachment" key={file.id}>
                            <a href={"/public/v1/files/" + file.id} download>
                              {file.filename}
                            </a>
                            {!readonly && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={async () => {
                                  setOperation("removing");
                                  setError("");
                                  setMessage("");
                                  try {
                                    const revision = await save();
                                    await request(
                                      "/attempt/files/" + file.id + "/remove",
                                      {
                                        public: true,
                                        method: "POST",
                                        revision: revision || data.attempt.revision,
                                        csrf,
                                        body: {},
                                      },
                                    );
                                    apply(
                                      await request<PublicData>("/assignment", {
                                        public: true,
                                      }),
                                    );
                                    setMessage("File removed.");
                                  } catch (err) {
                                    setError((err as Error).message);
                                    if ((err as { status?: number }).status === 409) setConflict(true);
                                  } finally { setOperation(null); }
                                }}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                    </>
                  ) : (
                    <textarea
                      aria-label={q.prompt}
                      aria-required={q.required}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errorId : undefined}
                      rows={6}
                      maxLength={q.max_chars ?? 10000}
                      value={text(answers[q.id])}
                      onChange={(e) =>
                        setAnswers({ ...answers, [q.id]: e.target.value })
                      }
                    />
                  )}
                  {invalid && <p className="field-error" id={errorId} role="alert">
                    {q.type === "file_upload" ? "Attach a file." : "Answer this required question."}
                  </p>}
                </fieldset>
              );
            })}
            {error && <p className="error" role="alert">{error}</p>}
            {conflict && (
              <div className="notice">
                <p>Your answers are still visible. Load the server version to check the current assignment and continue.</p>
                <button type="button" disabled={busy} onClick={async () => {
                  setOperation("reloading");
                  try {
                    apply(await request<PublicData>("/assignment", { public: true }));
                    setConflict(false);
                    setError("");
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setOperation(null);
                  }
                }}>
                  {operation === "reloading" ? "Loading…" : "Load server version"}
                </button>
              </div>
            )}
            <p role="status" className="assignment-feedback">
              {operation === "saving" ? "Saving draft…"
                : operation === "submitting" ? "Submitting assignment…"
                : operation === "uploading" ? "Attaching file…"
                : operation === "removing" ? "Removing file…"
                : operation === "reloading" ? "Loading server version…"
                : message}
            </p>
            {canEditAssignment(data.status, data.attempt.status) ? (
              <div className="assignment-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || conflict}
                  onClick={() => action()}
                >
                  {operation === "saving" ? "Saving draft…" : "Save draft"}
                </button>
                <button type="submit" disabled={busy || conflict}>
                  {operation === "submitting" ? "Submitting…" : "Submit assignment"}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
                <p>
                  Submission makes your answers read-only until your tutor
                  reopens the assignment.
                </p>
              </div>
            ) : null}
          </form>
          {data.released_result != null && (
            <section className="panel question">
              <h2>Your feedback</h2>
              <p className="preserve">
                {data.released_result.overall_feedback}
              </p>
              {data.released_result.items.map((item) => (
                <div className="question-editor" key={item.question_id}>
                  <strong>
                    {data.questions.find((q) => q.id === item.question_id)
                      ?.prompt ?? "Question"}
                  </strong>
                  <p>{item.awarded_points} points</p>
                  <p className="preserve">{item.feedback}</p>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
function QuestionEditor({
  value,
  change,
}: {
  value: unknown[];
  change: (v: unknown[]) => void;
}) {
  const questions = value as (Question & {
    rubric?: string;
    correct_option_id?: string;
    correct_option_ids?: string[];
    allowed_types?: string[];
    max_files?: number;
  })[];
  const update = (i: number, patch: object) =>
    change(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <section>
      <h3>Questions</h3>
      {questions.map((q, i) => (
        <div className="question-editor" key={q.id}>
          <div className="toolbar">
            <strong>Question {i + 1}</strong>
            <button
              type="button"
              className="text-button"
              onClick={() => change(questions.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <label>
            Question type
            <select
              value={q.type}
              onChange={(e) => {
                const type = e.target.value;
                const common = {
                  id: q.id,
                  type,
                  prompt: q.prompt,
                  points: q.points,
                  required: q.required,
                };
                if (type.includes("choice")) {
                  const options = [
                    { id: crypto.randomUUID(), text: "" },
                    { id: crypto.randomUUID(), text: "" },
                  ];
                  change(
                    questions.map((v, j) =>
                      j === i
                        ? {
                            ...common,
                            options,
                            ...(type === "single_choice"
                              ? { correct_option_id: options[0].id }
                              : { correct_option_ids: [options[0].id] }),
                          }
                        : v,
                    ),
                  );
                } else
                  change(
                    questions.map((v, j) =>
                      j === i
                        ? {
                            ...common,
                            rubric: "",
                            ...(type === "file_upload"
                              ? {
                                  allowed_types: [
                                    "pdf",
                                    "docx",
                                    "txt",
                                    "png",
                                    "jpg",
                                  ],
                                  max_files: 3,
                                }
                              : { max_chars: 10000 }),
                          }
                        : v,
                    ),
                  );
              }}
            >
              {[
                "written_response",
                "single_choice",
                "multiple_choice",
                "file_upload",
              ].map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Prompt<RequiredMark /></span>
            <textarea
              required
              value={q.prompt}
              onChange={(e) => update(i, { prompt: e.target.value })}
            />
          </label>
          <label>
            Points
            <input
              type="number"
              min="0"
              max="100"
              value={q.points}
              onChange={(e) => update(i, { points: Number(e.target.value) })}
            />
          </label>
          <label className="option">
            <input
              type="checkbox"
              checked={q.required}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            Required answer
          </label>
          {q.options?.map((o, j) => (
            <div className="option-edit" key={o.id}>
              <RequiredMark />
              <input
                aria-label={`Option ${j + 1}`}
                required
                value={o.text}
                onChange={(e) =>
                  update(i, {
                    options: q.options!.map((v) =>
                      v.id === o.id ? { ...v, text: e.target.value } : v,
                    ),
                  })
                }
              />
              <label className="option">
                <input
                  type={q.type === "single_choice" ? "radio" : "checkbox"}
                  name={"correct-" + q.id}
                  checked={
                    q.type === "single_choice"
                      ? q.correct_option_id === o.id
                      : (q.correct_option_ids?.includes(o.id) ?? false)
                  }
                  onChange={(e) =>
                    update(
                      i,
                      q.type === "single_choice"
                        ? { correct_option_id: o.id }
                        : {
                            correct_option_ids: e.target.checked
                              ? [...(q.correct_option_ids ?? []), o.id]
                              : (q.correct_option_ids ?? []).filter(
                                  (v) => v !== o.id,
                                ),
                          },
                    )
                  }
                />
                Correct
              </label>
            </div>
          ))}
          {q.options && q.options.length < 10 && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                update(i, {
                  options: [
                    ...q.options!,
                    { id: crypto.randomUUID(), text: "" },
                  ],
                })
              }
            >
              Add option
            </button>
          )}
          {!q.options && (
            <label>
              Private grading rubric
              <textarea
                value={q.rubric ?? ""}
                onChange={(e) => update(i, { rubric: e.target.value })}
              />
            </label>
          )}
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          change([
            ...questions,
            {
              id: crypto.randomUUID(),
              type: "written_response",
              prompt: "",
              points: 10,
              required: true,
              rubric: "",
              max_chars: 10000,
            },
          ])
        }
      >
        Add question
      </button>
    </section>
  );
}
function CardEditor({
  value,
  change,
}: {
  value: unknown[];
  change: (v: unknown[]) => void;
}) {
  const cards = value as { term: string; definition: string }[];
  return (
    <section>
      <h3>Flashcards</h3>
      {cards.map((card, i) => (
        <div className="question-editor" key={i}>
          <label>
            <span>Term<RequiredMark /></span>
            <input
              required
              value={card.term}
              onChange={(e) =>
                change(
                  cards.map((c, j) =>
                    j === i ? { ...c, term: e.target.value } : c,
                  ),
                )
              }
            />
          </label>
          <label>
            <span>Definition<RequiredMark /></span>
            <textarea
              required
              value={card.definition}
              onChange={(e) =>
                change(
                  cards.map((c, j) =>
                    j === i ? { ...c, definition: e.target.value } : c,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => change(cards.filter((_, j) => j !== i))}
          >
            Remove card
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() => change([...cards, { term: "", definition: "" }])}
      >
        Add card
      </button>
    </section>
  );
}
function AssignmentReview({
  assignment,
  studentZone,
  refresh,
}: {
  assignment: RecordData;
  studentZone?: string;
  refresh: () => void;
}) {
  const [attempts, setAttempts] = useState<RecordData[]>([]),
    [attempt, setAttempt] = useState<RecordData | null>(null),
    [items, setItems] = useState<
      { question_id: string; awarded_points: number; feedback: string }[]
    >([]),
    [feedback, setFeedback] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const teacherZone = useContext(TeacherTimezone);
  const [due, setDue] = useState(text(assignment.due_at));
  useEffect(() => {
    request<Page>(`/assignments/${assignment.id}/submissions`)
      .then((r) => setAttempts(r.items))
      .catch((e) => setError(e.message));
  }, [assignment.id]);
  async function select(row: RecordData) {
    try {
      const r = await request<{ data: RecordData }>(`/submissions/${row.id}`);
      setAttempt(r.data);
      const questions = (r.data.questions ??
        (assignment.content as { questions?: unknown[] } | undefined)
          ?.questions ??
        []) as Question[];
      setItems(
        questions.length
          ? questions.map((q) => ({
              question_id: q.id,
              awarded_points: Number(
                (
                  r.data.objective_result as Record<string, number> | undefined
                )?.[q.id] ?? 0,
              ),
              feedback: "",
            }))
          : ((r.data.answers ?? []) as { question_id: string }[]).map((a) => ({
              question_id: a.question_id,
              awarded_points: Number(
                (
                  r.data.objective_result as Record<string, number> | undefined
                )?.[a.question_id] ?? 0,
              ),
              feedback: "",
            })),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function action(name: string) {
    setBusy(true);
    try {
      const response = await request<{
        data?: { access_link?: string };
        url?: string;
        link?: string;
        access_url?: string;
      }>(`/assignments/${assignment.id}/${name}`, {
        method: "POST",
        revision: assignment.revision,
        body: {},
      });
      if (name === "replace-access")
        setNotice(
          response.data?.access_link ??
            response.link ??
            response.access_url ??
            response.url ??
            "Link unavailable. Replace access to issue a new link.",
        );
      else refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function release() {
    if (!attempt || busy) return;
    setBusy(true);
    try {
      const proposal = await request<{ data: RecordData; revision: number }>(
        `/submissions/${attempt.id}/grade-proposals`,
        {
          method: "POST",
          body: {
            items,
            overall_feedback: feedback,
            expected_submission_revision: attempt.revision,
          },
        },
      );
      await request(`/submissions/${attempt.id}/release-grade`, {
        method: "POST",
        revision: assignment.revision,
        body: {
          proposal_id: proposal.data.id,
          expected_proposal_revision:
            proposal.revision ?? proposal.data.revision,
          expected_submission_revision: attempt.revision,
          expected_assignment_revision: assignment.revision,
        },
      });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="review">
      <h3>Assignment access & review</h3>
      <form onSubmit={async event => {
        event.preventDefault();
        setError("");
        setBusy(true);
        try {
          await request(`/assignments/${assignment.id}`, {
            method: "PATCH", revision: assignment.revision, body: { due_at: resolveDateTime(due, teacherZone) },
          });
          refresh();
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        <DateTimeField label="Due date" value={due} onChange={setDue} studentZone={studentZone} />
        <button type="submit" className="secondary" disabled={busy || due === text(assignment.due_at)}>Save due date</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <div className="notice">
          {notice.startsWith("http") ? <CopyLink key={notice} url={notice} /> : <p role="status">{notice}</p>}
        </div>
      )}
      <div className="actions">
        <button type="button"
          disabled={busy}
          className="secondary"
          onClick={() => action("replace-access")}
        >
          Replace private link
        </button>
        <button type="button"
          disabled={busy}
          className="secondary"
          onClick={() => action("revoke-access")}
        >
          Revoke access
        </button>
        <button type="button"
          disabled={busy}
          className="secondary"
          onClick={() => action("reopen")}
        >
          Reopen submission
        </button>
      </div>
      <h3>Submissions</h3>
      {!attempts.length && <p>No submissions yet.</p>}
      {attempts.map((a) => (
        <button type="button" className="secondary" key={a.id} onClick={() => select(a)}>
          {formatStatus(a.status)} {`Attempt ${a.attempt_number ?? attempts.indexOf(a) + 1}`}
        </button>
      ))}
      {attempt && (
        <>
          {items.map((item, i) => (
            <div className="grading-question" key={item.question_id}>
              <SubmissionAnswers attempt={attempt} content={assignment.content} questionId={item.question_id} download={(path, name) => download(path, name).catch(error => setError(error.message))} />
              <label>
                Question {i + 1} points (out of {((attempt.questions ?? (assignment.content as {questions?: Question[]} | undefined)?.questions ?? []) as Question[]).find(question => question.id === item.question_id)?.points ?? 100})
                <input
                  type="number"
                  min="0"
                  max={((attempt.questions ?? (assignment.content as {questions?: Question[]} | undefined)?.questions ?? []) as Question[]).find(question => question.id === item.question_id)?.points ?? 100}
                  disabled={busy}
                  readOnly={((attempt.questions ?? (assignment.content as {questions?: Question[]} | undefined)?.questions ?? []) as Question[]).find(question => question.id === item.question_id)?.type.includes("choice")}
                  value={item.awarded_points}
                  onChange={(e) =>
                    setItems(
                      items.map((v, j) =>
                        j === i
                          ? { ...v, awarded_points: Number(e.target.value) }
                          : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Feedback
                <textarea
                  value={item.feedback}
                  onChange={(e) =>
                    setItems(
                      items.map((v, j) =>
                        j === i ? { ...v, feedback: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
          <label>
            Overall feedback
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <button type="button"
            disabled={busy || attempt.status === "draft"}
            onClick={release}
          >
            {busy ? "Saving…" : "Release grades & feedback"}
          </button>
          <p>
            Multiple-choice scores are calculated automatically. Students see grades only after release.
          </p>
        </>
      )}
    </div>
  );
}
function CalendarEditor({ refresh }: { refresh: () => void }) {
  const teacherZone = useContext(TeacherTimezone);
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [operationId, setOperationId] = useState("");
  const [timezone, setTimezone] = useState(teacherZone);
  const [lesson, setLesson] = useState<RecordData>();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const studentZone = useStudentTimezones(lesson ? [lesson] : []).timezone(lesson ?? {});
  async function sync() {
    try {
      const r = await request<{ operation_id: string }>("/calendar/sync", {
        method: "POST",
        body: {},
      });
      setNotice("Calendar refresh queued.");
      setOperationId(r.operation_id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel connection">
      <div className="actions">
        <button type="button" className="secondary" onClick={sync}>
          Refresh calendar
        </button>
        <button type="button" onClick={() => setOpen(!open)}>Add Google Calendar event</button>
      </div>
      {notice && <p className="notice">{notice}</p>}
      {operationId && <OperationMonitor id={operationId} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              setError("");
              const r = await request<{ operation_id: string }>(
                "/calendar/events",
                {
                  method: "POST",
                  body: {
                    title: f.get("title"),
                    lesson_id: f.get("lesson_id"),
                    expected_lesson_revision: Number(f.get("lesson_revision")),
                    ...calendarTiming(start, end, timezone),
                  },
                },
              );
              setNotice("Lesson scheduled for processing. Waiting for Google confirmation.");
              setOperationId(r.operation_id);
              setOpen(false);
              refresh();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <LessonFields revisionName="lesson_revision" change={record => {
            setLesson(record);
            setStart(text(record?.starts_at));
            setEnd(text(record?.ends_at));
          }} />
          <label>
            <span>Event title<RequiredMark /></span>
            <input name="title" required />
          </label>
          <TimezoneField label="Event timezone" value={timezone} onChange={setTimezone} required />
          <DateTimeField label="Start" value={start} onChange={setStart} inputZone={timezone} studentZone={studentZone} required />
          <DateTimeField label="End" value={end} onChange={setEnd} inputZone={timezone} studentZone={studentZone}
            required rangeError={endTimeError(start, end, timezone)} />
          <button type="submit">Queue calendar event</button>
        </form>
      )}
    </section>
  );
}
function MaterialTools({ material }: { material: RecordData }) {
  const [versions, setVersions] = useState<RecordData[]>([]),
    [preview, setPreview] = useState(""),
    [artifact, setArtifact] = useState(text(material.active_artifact_id??"")),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    request<Page>(`/materials/${material.id}/versions`)
      .then((r) => setVersions(r.items))
      .catch((e) => setError(e.message));
  }, [material.id]);
  return (
    <section className="review">
      <h3>Versions & extracted text</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      {notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i) && (
        <OperationMonitor
          id={notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)![0]}
        />
      )}
      {versions.map((v) => (
        <div className="question-editor" key={v.id}>
          <strong>{text(v.filename) || `Version ${versions.indexOf(v) + 1}`}</strong>
          <p>Status: {formatStatus(v.conversion_state ?? v.status ?? "processing")}</p>
          {Array.isArray(v.warnings) && v.warnings.length > 0 && <p>{v.warnings.map(readableValue).join("; ")}</p>}
          {v.error != null && <p className="error">{readableValue(v.error)}</p>}
          <div className="actions">
            <button type="button"
              className="secondary"
              onClick={() =>
                download(
                  `/api/v1/materials/${material.id}/original?version_id=${v.id}`,
                  text(v.filename ?? "material"),
                )
              }
            >
              Download original
            </button>
            <button type="button"
              className="secondary"
              onClick={async () => {
                try {
                  const r = await request<{ status: string }>(
                    `/materials/${material.id}/retry-conversion`,
                    {
                      method: "POST",
                      revision: material.revision,
                      body: { version_id: v.id },
                    },
                  );
                  setNotice("Conversion queued · " + r.status);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Retry conversion
            </button>
          </div>
        </div>
      ))}
      <label>
        Extracted text version
        <select value={artifact} onChange={(event) => { setArtifact(event.target.value); setPreview(""); }}>
          <option value="">Choose a converted version</option>
          {material.active_artifact_id != null && <option value={text(material.active_artifact_id)}>Current text</option>}
          {versions.filter(version => version.artifact_id && version.artifact_id !== material.active_artifact_id).map((version, index) => <option key={version.id} value={text(version.artifact_id)}>{text(version.filename) || `Version ${index + 1}`}</option>)}
        </select>
      </label>
      <button type="button"
        className="secondary"
        disabled={!artifact}
        onClick={async () => {
          try {
            const chunks:string[]=[];let start:number|null=0;
            do{const r:{data:{chunks:{text:string}[];warnings:string[];next_start:number|null}}=await request<{data:{chunks:{text:string}[];warnings:string[];next_start:number|null}}>(`/materials/${material.id}/chunks?artifact_id=${encodeURIComponent(artifact)}&start=${start}&count=20`);chunks.push(...r.data.chunks.map(c=>c.text));start=r.data.next_start;if(r.data.warnings.length)setNotice(r.data.warnings.join(' · '));}while(start!==null);
            setPreview(chunks.join('\n\n'));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Load extracted text
      </button>
      <label>
        Correct extracted Markdown
        <textarea
          rows={12}
          value={preview}
          onChange={(e) => setPreview(e.target.value)}
        />
      </label>
      <button type="button"
        disabled={!artifact || !preview}
        onClick={async () => {
          try {
            await request(`/materials/${material.id}/markdown-corrections`, {
              method: "POST",
              revision: material.revision,
              body: { source_artifact_id: artifact, markdown: preview },
            });
            setNotice("Correction saved as a new artifact.");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Save correction
      </button>
    </section>
  );
}
function calendarTiming(start: string, end: string, timezone: string) {
  const starts = resolveDateTime(start, timezone);
  const ends = resolveDateTime(end, timezone);
  if (!starts || !ends) throw new Error("Enter both a start and an end.");
  if (Date.parse(ends) <= Date.parse(starts)) throw new Error("The end must follow the start.");
  return { start: starts, end: ends, timezone };
}

function CalendarTools({ event, studentZone, refresh }: {
  event: RecordData;
  studentZone?: string;
  refresh: () => void;
}) {
  const teacherZone = useContext(TeacherTimezone);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operationId, setOperationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const startValue = displayTimeValue(event.start);
  const endValue = displayTimeValue(event.end);
  const providerZone = text(event.timezone ?? (event.start as { timeZone?: string } | undefined)?.timeZone);
  const [timezone, setTimezone] = useState(isTimeZone(providerZone) ? providerZone : teacherZone);
  const [start, setStart] = useState(startValue);
  const [end, setEnd] = useState(endValue);
  const timed = startValue && endValue && !isDateOnly(startValue) && !isDateOnly(endValue);

  return (
    <section className="review">
      <h3>Calendar event</h3>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {operationId && <OperationMonitor id={operationId} />}
      {timed && !event.deleted && <form onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
          const r = await request<{ operation_id: string }>(`/calendar/events/${event.id}`, {
            method: "PATCH",
            revision: event.revision,
            body: { ...calendarTiming(start, end, timezone), expected_etag: event.etag },
          });
          setNotice("Time change queued. Waiting for Google confirmation.");
          setOperationId(r.operation_id);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setSubmitting(false);
        }
      }}>
        <TimezoneField label="Event timezone" value={timezone} onChange={setTimezone} required />
        <DateTimeField label="New start" value={start} onChange={setStart} inputZone={timezone} studentZone={studentZone} required />
        <DateTimeField label="New end" value={end} onChange={setEnd} inputZone={timezone} studentZone={studentZone}
          required rangeError={endTimeError(start, end, timezone)} />
        <button type="submit" disabled={submitting}>Queue reschedule</button>
      </form>}
      {!event.lesson_id && !event.deleted && <form onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError("");
        try {
          await request(`/calendar/events/${event.id}/link`, {
            method: "POST",
            revision: event.revision,
            body: {
              lesson_id: f.get("lesson_id"),
              expected_lesson_revision: Number(f.get("revision")),
            },
          });
          refresh();
        } catch (err) {
          setError((err as Error).message);
        }
      }}>
        <LessonFields revisionName="revision" />
        <button type="submit" className="secondary">Link lesson</button>
      </form>}
    </section>
  );
}
function CalendarSelection({
  connection,
  saved,
}: {
  connection: RecordData;
  saved: (r: RecordData) => void;
}) {
  const [calendars, setCalendars] = useState<RecordData[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    request<Page>("/calendar/calendars")
      .then((r) => setCalendars(r.items))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await request<{ data: RecordData }>(
            "/calendar/connection",
            {
              method: "PUT",
              revision: connection.revision,
              body: { calendar_id: selected },
            },
          );
          saved(r.data);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label>
        <span>Select your teaching calendar<RequiredMark /></span>
        <select
          required
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a writable calendar</option>
          {calendars.map((c) => (
            <option value={c.id} key={c.id}>
              {text(c.summary) || "Teaching calendar"}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit">Use this calendar</button>
    </form>
  );
}
function ReferenceInput({
  route,
  value,
  change,
  required = false,
}: {
  route: string;
  value: string;
  change: (v: string) => void;
  required?: boolean;
}) {
  const [rows, setRows] = useState<RecordData[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    request<Page>("/" + route + "?limit=100")
      .then((r) => setRows(r.items))
      .catch((e) => setError(e.message));
  }, [route]);
  return (
    <>
      <select
        required={required}
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">{required ? "Choose a record" : "None"}</option>
        {rows.map((r) => (
          <option value={r.id} key={r.id}>
            {recordTitle(r, "Untitled record")}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
function ReferenceMultiple({
  route,
  value,
  change,
}: {
  route: string;
  value: string[];
  change: (v: string[]) => void;
}) {
  const [rows, setRows] = useState<RecordData[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    request<Page>("/" + route + "?limit=100")
      .then((r) => setRows(r.items))
      .catch((e) => setError(e.message));
  }, [route]);
  return (
    <>
      <select
        multiple
        size={Math.min(5, Math.max(2, rows.length))}
        value={value}
        onChange={(e) =>
          change([...e.target.selectedOptions].map((o) => o.value))
        }
      >
        {rows.map((r) => (
          <option value={r.id} key={r.id}>
            {recordTitle(r, "Untitled record")}
          </option>
        ))}
      </select>
      <small>Hold Ctrl / Command to select more than one.</small>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
function OperationMonitor({ id }: { id: string }) {
  const [result, setResult] = useState<RecordData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await request<{ data: RecordData }>(
          "/calendar/operations/" + id,
        );
        if (!active) return;
        setResult(r.data);
        if (["queued", "pending", "running"].includes(text(r.data.status)))
          timer = setTimeout(poll, 2000);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  return (
    <div role="status" className="notice">
      Calendar operation: {result ? text(result.status) : "Checking status…"}
      {result?.error != null && <p>{readableValue(result.error)}</p>}
      {error && <p>{error}</p>}
    </div>
  );
}
function LinkedCalendarEvent({ id, navigate }: { id: string; navigate: Navigate }) {
  const [event, setEvent] = useState<RecordData>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<{ data: RecordData }>(`/calendar/events/${id}`)
      .then(({ data }) => { if (active) setEvent(data); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [id]);
  return (
    <section className="review">
      <h3>Google Calendar</h3>
      {error && <p role="alert" className="error">{error}</p>}
      {Boolean(event?.deleted) && <p>This Google Calendar event was cancelled.</p>}
      {event && <button type="button" className="secondary" onClick={() => navigate("Calendar", { type: "detail", record: event })}>Open calendar event</button>}
    </section>
  );
}

function StudentProgress({ student, navigate }: { student: RecordData; navigate: Navigate }) {
  const teacherZone = useContext(TeacherTimezone);
  const studentZone = effectiveStudentTimezone(student, teacherZone);
  const [records, setRecords] = useState<{ kind: "Lessons" | "Assignments"; record: RecordData }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.all((["Lessons", "Assignments"] as const).map(async kind => {
      const page = await request<Page>(`/${routes[kind]}?student_id=${student.id}`);
      return page.items.map(record => ({ kind, record }));
    })).then(results => {
      if (active) setRecords(results.flat().sort((a, b) => text(b.record.created_at).localeCompare(text(a.record.created_at))));
    }).catch(error => {
      if (active) setError(error.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [student.id]);
  return (
    <section className="review">
      <h3>Learning history</h3>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p role="status">Loading learning history…</p>}
      {!loading && !error && !records.length && <p>No linked lessons or assignments yet.</p>}
      {records.map(({ kind, record }) => {
        const assignment = kind === "Assignments";
        const name = assignment ? "Sent homework" : "Lesson";
        return <div className="question-editor" key={record.id}>
          <span className="badge">{name}</span>
          <h3><button type="button" className="text-button" onClick={() => navigate(kind, { type: "detail", record })}>{recordTitle(record, name)}</button></h3>
          <p>{formatStatus(record.status)}</p>
          <ZonedTime value={assignment ? record.due_at : lessonStart(record)} studentZone={studentZone} />
          {record.release_id != null && <span className="badge">Results released</span>}
        </div>;
      })}
    </section>
  );
}

function RelatedRecords({record, navigate}: {record: RecordData; navigate: Navigate}) {
  const [links, setLinks] = useState<{section: WorkspaceSection; record: RecordData}[]>([]), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError(""); setLinks([]);
    const related: {section: WorkspaceSection; id: string}[] = [];
    if (record.student_id) related.push({section: "Students", id: String(record.student_id)});
    if (record.lesson_id) related.push({section: "Lessons", id: String(record.lesson_id)});
    for (const [field, section] of [["material_ids", "Materials"], ["student_ids", "Students"], ["lesson_ids", "Lessons"]] as const) {
      if (Array.isArray(record[field])) for (const id of record[field] as string[]) related.push({section, id});
    }
    Promise.all(related.map(async ({section, id}) => ({section, record: (await request<{data: RecordData}>(`/${routes[section]}/${id}`)).data}))).then(rows => {if(active) setLinks(rows);}).catch(() => {if(active) setError("Some linked records could not be loaded.");});
    return () => {active = false;};
  }, [record.id]);
  return links.length || error ? <section className="related-records"><h3>Linked records</h3>{links.map(link => <button type="button" className="text-button" key={link.record.id} onClick={() => navigate(link.section, {type: "detail", record: link.record})}>{recordTitle(link.record)} <small>({displaySection(link.section)})</small></button>)}{error && <p role="status">{error}</p>}</section> : null;
}
function LessonFields({ revisionName, change }: { revisionName: string; change?: (lesson?: RecordData) => void }) {
  const [lessons, setLessons] = useState<RecordData[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    request<Page>("/lessons?limit=100").then(page => setLessons(page.items)).catch(error => setError(error.message));
  }, []);
  const lesson = lessons.find(lesson => lesson.id === selected);
  return <>
    <label><span>Lesson<RequiredMark /></span>
      <select name="lesson_id" required value={selected} onChange={event => {
        setSelected(event.target.value);
        change?.(lessons.find(lesson => lesson.id === event.target.value));
      }}>
        <option value="">Choose a lesson</option>
        {lessons.map(lesson => <option key={lesson.id} value={lesson.id}>{recordTitle(lesson)}</option>)}
      </select>
    </label>
    <input type="hidden" name={revisionName} value={lesson?.revision ?? ""} />
    {error && <p role="alert" className="error">{error}</p>}
  </>;
}

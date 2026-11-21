import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
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
  Menu,
  X,
} from "lucide-react";
import { request, type RecordData, type Page } from "./api";
import { initializeAuth, keycloak, authRedirectUri } from "./auth";
import { canEditAssignment, requireAssignmentIdentity } from "./public-assignment";
import { dateValue, describeDue, formatDateTime, formatStatus, loadLessonPlans, loadOpenTasks, loadStudentNames } from "./overview-data";
import { readSection, sectionHref, type WorkspaceSection } from "./workspace-navigation";

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
      ["Assignments", CheckSquare],
      ["Flashcards", Layers],
    ],
  },
  {
    label: "Administration",
    sections: [
      ["Activity", History],
      ["Connections", Settings],
    ],
  },
] as const;

type ResourceIntent = { type: "create" } | { type: "detail"; record: RecordData };
type Navigate = (section: WorkspaceSection, intent?: ResourceIntent) => void;
const authSectionKey = "atelier-auth-section";
const authSessionKey = "atelier-session-available";

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
  Students: ["display_name", "contact", "subject", "level", "goals", "notes"],
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
const text = (v: unknown) =>
  v==null?"":typeof v === "string" ? v : JSON.stringify(v);
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
    const resumeSession = sessionStorage.getItem(authSessionKey) === "true";
    if (resumeSession && !isCallback) {
      sessionStorage.setItem(authSectionKey, sectionHref(directSection));
    }
    initializeAuth(resumeSession)
      .then((signedIn) => {
        const pendingHref = sessionStorage.getItem(authSectionKey);
        sessionStorage.removeItem(authSectionKey);
        if (isCallback && pendingHref) {
          const restored = readSection(new URL(pendingHref, location.origin).search);
          history.replaceState(history.state, "", sectionHref(restored));
          setNavigation({ section: restored });
        }
        if (signedIn) sessionStorage.setItem(authSessionKey, "true");
        else sessionStorage.removeItem(authSessionKey);
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
    sessionStorage.removeItem(authSessionKey);
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
          <button onClick={signIn}>Sign in <ArrowUpRight size={17} aria-hidden="true" /></button>
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
          <button className="secondary menu-toggle" ref={menu} aria-expanded={menuOpen}
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
                      <a href={sectionHref(name)} aria-current={section === name ? "page" : undefined}
                        onClick={(event) => follow(event, name)}>
                        <Icon size={18} aria-hidden="true" />{name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="rail-account">
            <strong>{keycloak.tokenParsed?.preferred_username ?? "Tutor"}</strong>
            <button className="text-button" onClick={signOut}>
              <LogOut size={17} aria-hidden="true" />Sign out
            </button>
          </div>
        </div>
      </aside>
      <main id="workspace-main" className="workspace-main" ref={main} tabIndex={-1}>
        {section === "Overview" ? (
          <Overview navigate={navigate} follow={follow} />
        ) : section === "Connections" ? (
          <Connections />
        ) : (
          <Resource key={section} section={section} intent={intent} />
        )}
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
  const students = usePreview(loadStudentNames);
  const studentItems = students.state && "page" in students.state ? students.state.page.items : [];
  const studentsById = new Map(studentItems.map((student) => [student.id, text(student.display_name)]));
  const now = new Date();
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(now);
  const planLesson = () => navigate("Lessons", { type: "create" });

  return (
    <>
      <div className="page-heading">
        <div><h1>Overview</h1><p>{date}</p></div>
        <button onClick={planLesson}><Plus size={18} aria-hidden="true" />Plan a lesson</button>
      </div>
      <div className="overview-grid">
        <PreviewPanel title="Lesson plans" destination="Lessons" preview={lessons}
          follow={follow} emptyTitle="No planned lessons"
          emptyDescription="Start a lesson plan for a student."
          emptyAction={planLesson} emptyActionLabel="Plan a lesson">
          {(lesson) => (
            <button className="list-row record-button" onClick={() => navigate("Lessons", { type: "detail", record: lesson })}>
              <span className="record-icon"><GraduationCap size={19} aria-hidden="true" /></span>
              <span className="row-copy">
                <strong>{text(lesson.title)}</strong>
                {studentsById.has(text(lesson.student_id)) && <small>{studentsById.get(text(lesson.student_id))}</small>}
              </span>
              <span className="badge">{formatStatus(lesson.status)}</span>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          )}
        </PreviewPanel>
        <PreviewPanel title="Open tasks" destination="Tasks" preview={tasks}
          follow={follow} emptyTitle="No open tasks"
          emptyDescription="Add a task to keep track of your next step."
          emptyAction={() => navigate("Tasks", { type: "create" })} emptyActionLabel="Add a task">
          {(task) => {
            const due = describeDue(task.due_at, now);
            return (
              <button className="list-row record-button" onClick={() => navigate("Tasks", { type: "detail", record: task })}>
                <span className="row-copy">
                  <strong>{text(task.title)}</strong>
                  <small className={due.overdue ? "overdue" : undefined} title={formatDateTime(task.due_at) || undefined}>
                    {due.text}
                  </small>
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

function PreviewPanel({ title, destination, preview, follow, emptyTitle, emptyDescription, emptyAction, emptyActionLabel, children }: {
  title: string;
  destination: WorkspaceSection;
  preview: ReturnType<typeof usePreview>;
  follow: (event: MouseEvent<HTMLAnchorElement>, section: WorkspaceSection) => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction: () => void;
  emptyActionLabel: string;
  children: (record: RecordData) => ReactNode;
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
      {!state ? (
        <p className="panel-state" role="status">Loading {title.toLowerCase()}…</p>
      ) : "error" in state ? (
        <div className="panel-state">
          <p role="alert">Couldn’t load {title.toLowerCase()}. {state.error}</p>
          <button className="secondary" onClick={preview.retry}>Retry</button>
        </div>
      ) : state.page.items.length ? (
        <>
          {(state.page.next_cursor || state.page.items.length > 5) && (
            <p className="preview-note">Preview · showing {Math.min(5, state.page.items.length)} records</p>
          )}
          <ul className="preview-list">
            {state.page.items.slice(0, 5).map((record) => <li key={record.id}>{children(record)}</li>)}
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
      {action && <button className="secondary" onClick={action}>{actionLabel}</button>}
    </div>
  );
}

function Dialog({ title, close, children }: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    closeButton.current?.focus();
    return () => {
      element.close();
      const target = opener instanceof HTMLElement && opener.isConnected && opener !== document.body
        ? opener
        : (document.querySelector<HTMLElement>("[data-dialog-focus]") ?? document.getElementById("workspace-main"));
      target?.focus();
    };
  }, []);
  useLayoutEffect(() => {
    closeButton.current?.focus();
  }, [title]);
  return (
    <dialog className="modal" ref={dialog} aria-labelledby={headingId} onCancel={(event) => {
      event.preventDefault();
      close();
    }}>
      <div className="modal-heading">
        <h2 id={headingId}>{title}</h2>
        <button type="button" className="text-button close" ref={closeButton} onClick={close} aria-label="Close dialog">
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

const recordNames: Partial<Record<WorkspaceSection, string>> = {
  Students: "student",
  Lessons: "lesson",
  Materials: "material",
  Tasks: "task",
  Homework: "homework template",
  Flashcards: "flashcard set",
};

function recordTitle(record: Record<string, unknown>, fallback = "Record details") {
  return text(record.display_name ?? record.title) || fallback;
}

function Resource({ section, intent }: { section: WorkspaceSection; intent?: ResourceIntent }) {
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
      <div className="page-heading">
        <h1>{section === "Homework" ? "Homework templates" : section}</h1>
        {recordName && (
          <button data-dialog-focus onClick={addRecord}>
            <Plus size={17} aria-hidden="true" />{addLabel}
          </button>
        )}
      </div>
      {result && (
        <div className="notice">
          {result.startsWith("http") ? <CopyLink url={result} /> : <p role="status">{result}</p>}
          <button className="text-button" onClick={() => setResult("")}>Dismiss</button>
        </div>
      )}
      {section === "Calendar" && <CalendarEditor refresh={() => load()} />}
      <section className="panel" aria-label={`${section} records`}>
        <div className="toolbar">
          <label className="search">
            <Search size={17} aria-hidden="true" />
            <input type="search" name="search-records" autoComplete="off"
              aria-label={`Search ${section.toLowerCase()}`}
              placeholder={`Search ${section.toLowerCase()}…`}
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
            <button className="secondary" disabled={!query.trim() || archived}
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
        {materialSearch && <p className="preview-note">Text search results for “{materialSearch}” <button className="text-button" onClick={clearFilters}>Clear search</button></p>}
        {loadError && (
          <div className="panel-state">
            <p className="error" role="alert">Couldn’t load {section.toLowerCase()}. {loadError.message}</p>
            <button className="secondary" onClick={() => load(loadError.cursor)}>Retry</button>
          </div>
        )}
        {loading && <p className="panel-state" role="status">Loading {section.toLowerCase()}…</p>}
        {visible.length > 0 && (
          <div className="records">
            {visible.map((record) => {
              const due = section === "Tasks" ? describeDue(record.due_at) : null;
              const summary = text(record.subject ?? record.description ?? record.actor_category);
              return (
                <button className="list-row record-button" key={record.id} onClick={() => openDetail(record)}>
                  <span className="record-icon" aria-hidden="true">
                    {section === "Students" ? text(record.display_name).slice(0, 1) : <BookOpen size={19} />}
                  </span>
                  <span className="row-copy">
                    <strong>{recordTitle(record, text(record.entity_type ?? record.id))}</strong>
                    {due ? (
                      <small className={due.overdue && record.status !== "done" ? "overdue" : undefined}>
                        {record.status === "done" && record.due_at ? formatDateTime(record.due_at) : due.text}
                      </small>
                    ) : summary && <small>{summary}</small>}
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
            <Empty title={`No ${archived ? "archived " : ""}${section.toLowerCase()}${section === "Homework" ? " templates" : ""} yet`}
              action={recordName && !archived ? addRecord : undefined} actionLabel={addLabel} />
          )
        )}
        {cursor && !loadError && (
          <button className="secondary load-more" disabled={loading} onClick={() => load(cursor)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </section>
      {(editor || detail) && (
        <Dialog title={selectedName} close={closeDialog}>
          {editor ? (
            <Editor section={section} record={editor} close={closeDialog}
              saved={() => { closeDialog(); void load(); }} />
          ) : selected ? (
            <div className="detail">
              <RecordSummary record={selected} />
              {actionError && <p role="alert" className="error">{actionError}</p>}
              {mutating && <p role="status">Saving changes…</p>}
              <fieldset className="detail-actions" disabled={mutating}>
              {fields[section] && (
                <>
                  <button
                    onClick={() => {
                      setEditor(selected);
                      setSelected(null);
                    }}
                  >
                    Edit record
                  </button>
                  <button
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
              {section === "Students" && <StudentProgress student={selected}/>}
              {section === "Materials" && <MaterialTools material={selected} />}{" "}
              {section === "Calendar" && (
                <CalendarTools
                  event={selected}
                  refresh={() => {
                    closeDialog();
                    void load();
                  }}
                />
              )}
              {section === "Assignments" && (
                <AssignmentReview
                  assignment={selected}
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
                <button
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
                <button
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
              <details className="technical-details">
                <summary>Technical details</summary>
                <pre>{JSON.stringify(selected, null, 2)}</pre>
              </details>
            </div>
          ) : detailError ? (
            <>
              <p role="alert" className="error">Couldn’t load record details. {detailError}</p>
              <button className="secondary" onClick={() => {
                setDetailError("");
                setDetailAttempt((attempt) => attempt + 1);
              }}>Retry</button>
            </>
          ) : <p role="status">Loading record details…</p>}
        </Dialog>
      )}
    </>
  );
}

function RecordSummary({ record }: { record: RecordData }) {
  const keys = [
    "status", "due_at", "subject", "level", "description", "plan", "goals", "notes", "instructions",
    "start", "end", "expires_at", "created_at",
  ];
  return (
    <dl className="record-summary">
      {keys.filter((key) => record[key]).map((key) => {
        const formatted = key === "status" ? formatStatus(record[key])
          : ["due_at", "start", "end", "expires_at", "created_at"].includes(key)
            ? formatDateTime(record[key]) || text(record[key])
            : text(record[key]);
        return (
          <div key={key}>
            <dt>{key === "due_at" ? "Due" : label(key)}</dt>
            <dd className="preserve">{formatted}</dd>
          </div>
        );
      })}
    </dl>
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
    [due, setDue] = useState("");
  return (
    <form
      className="publish"
      onSubmit={(e) => {
        e.preventDefault();
        onPublish({
          student_id: student,
          ...(due ? { due_at: new Date(due).toISOString() } : {}),
          public_attachment_ids: [],
        });
      }}
    >
      <h3>Publish assignment</h3>
      <label>
        Student
        <ReferenceInput
          route="students"
          value={student}
          change={setStudent}
          required
        />
      </label>
      <label>
        Due date (optional)
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <button>Publish & get private link</button>
      <small>
        A snapshot of “{text(template.title)}” will be shared with this student.
      </small>
    </form>
  );
}
function localDateTime(value: unknown) {
  const date = dateValue(value);
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
  async function save(e: FormEvent) {
    e.preventDefault();
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
        if(v===''&&existing.id&& !['title','display_name','instructions'].includes(field)){payload[field]=null;continue;}
        if (v !== undefined && v !== "")
          payload[field] =
            field === "due_at" ? new Date(String(v)).toISOString() : v;
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
        {fields[section].map((field) => {
          const val = draft[field],
            json = [
              "questions",
              "cards",
              "source_refs",
              "tags",
              "material_ids",
              "student_ids",
              "lesson_ids",
            ].includes(field);
          if(field==='contact')return <label key={field}>Contact email<input type="email" value={(val as {email?:string}|null)?.email??''} onChange={e=>setDraft({...draft,contact:e.target.value?{email:e.target.value}:null})}/></label>;
          if (["student_id", "lesson_id"].includes(field))
            return (
              <label key={field}>
                {field === "student_id" ? "Student" : "Lesson"}
                <ReferenceInput
                  route={field === "student_id" ? "students" : "lessons"}
                  value={text(val)}
                  change={(v) => setDraft({ ...draft, [field]: v })}
                  required={section === "Lessons" && field === "student_id"}
                />
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
              {field === "due_at" ? "Due date" : label(field)}
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
              ) : json ||
                [
                  "description",
                  "plan",
                  "notes",
                  "goals",
                  "instructions",
                ].includes(field) ? (
                <textarea
                  rows={json ? 6 : 3}
                  value={
                    json
                      ? typeof val === "string"
                        ? val
                        : JSON.stringify(val ?? [], null, 2)
                      : text(val)
                  }
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              ) : (
                <input
                  required={
                    ["title", "display_name"].includes(field) ||
                    (section === "Lessons" && field === "student_id")
                  }
                  type={field === "due_at" ? "datetime-local" : "text"}
                  name={field}
                  value={field === "due_at" ? localDateTime(val) : text(val)}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              )}{" "}
              {json && <small>Structured JSON · validated by the server</small>}
            </label>
          );
        })}
        <div className="actions">
          <button disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
        </div>
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
            <details className="technical-details">
              <summary>Technical details</summary>
              <pre>{JSON.stringify(connection, null, 2)}</pre>
            </details>
            {connection.status === "select_calendar" && (
              <CalendarSelection
                connection={connection}
                saved={setConnection}
              />
            )}
          </>
        )}
        <button
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
          <button
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
    [conflict, setConflict] = useState(false);
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
  async function action(submit = false) {
    if (!data || busy) return;
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
              <p><time dateTime={data.due_at}>Due {formatDateTime(data.due_at)}</time></p>
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
              action(true);
            }}
          >
            {data.questions.map((q, i) => {
              const readonly = !canEditAssignment(data.status, data.attempt.status);
              return (
                <fieldset
                  className="panel question"
                  key={q.id}
                  disabled={readonly || busy || conflict}
                >
                  <legend>
                    <span>{i + 1}.</span> {q.prompt}{" "}
                    {q.required && <small>Required</small>}
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
                      rows={6}
                      maxLength={q.max_chars ?? 10000}
                      value={text(answers[q.id])}
                      onChange={(e) =>
                        setAnswers({ ...answers, [q.id]: e.target.value })
                      }
                    />
                  )}
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
            Prompt
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
            Term
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
            Definition
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
  refresh,
}: {
  assignment: RecordData;
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
    if (!attempt) return;
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
        <button
          disabled={busy}
          className="secondary"
          onClick={() => action("replace-access")}
        >
          Replace private link
        </button>
        <button
          disabled={busy}
          className="secondary"
          onClick={() => action("revoke-access")}
        >
          Revoke access
        </button>
        <button
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
        <button className="secondary" key={a.id} onClick={() => select(a)}>
          {formatStatus(a.status)} {formatDateTime(a.created_at) || a.id.slice(0, 8)}
        </button>
      ))}
      {attempt && (
        <>
          <details className="technical-details">
            <summary>Submission details</summary>
            <pre>{JSON.stringify(attempt, null, 2)}</pre>
          </details>
          {items.map((item, i) => (
            <div key={item.question_id}>
              <label>
                Question {i + 1} points
                <input
                  type="number"
                  min="0"
                  max="100"
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
          <button
            disabled={busy || attempt.status === "draft"}
            onClick={release}
          >
            {busy ? "Saving…" : "Release grades & feedback"}
          </button>
          <p>
            Objective scores must match the deterministic server score. Students
            see grades only after release.
          </p>
        </>
      )}
    </div>
  );
}
function CalendarEditor({ refresh }: { refresh: () => void }) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function sync() {
    try {
      const r = await request<{ operation_id: string }>("/calendar/sync", {
        method: "POST",
        body: {},
      });
      setNotice("Refresh queued · " + r.operation_id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel connection">
      <div className="actions">
        <button className="secondary" onClick={sync}>
          Refresh calendar
        </button>
        <button onClick={() => setOpen(!open)}>Schedule a lesson</button>
      </div>
      {notice && <p className="notice">{notice}</p>}
      {notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i) && (
        <OperationMonitor
          id={notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)![0]}
        />
      )}
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
              const timezone = String(f.get("timezone"));
              const r = await request<{ operation_id: string }>(
                "/calendar/events",
                {
                  method: "POST",
                  body: {
                    title: f.get("title"),
                    lesson_id: f.get("lesson_id"),
                    expected_lesson_revision: Number(f.get("lesson_revision")),
                    start: new Date(String(f.get("start"))).toISOString(),
                    end: new Date(String(f.get("end"))).toISOString(),
                    timezone,
                  },
                },
              );
              setNotice(
                "Schedule operation queued; Google confirmation is pending · " +
                  r.operation_id,
              );
              setOpen(false);
              refresh();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label>
            Lesson ID
            <input name="lesson_id" required />
          </label>
          <label>
            Current lesson revision
            <input name="lesson_revision" type="number" min="1" required />
          </label>
          <label>
            Event title
            <input name="title" required />
          </label>
          <label>
            Start (your local time)
            <input name="start" type="datetime-local" required />
          </label>
          <label>
            End (your local time)
            <input name="end" type="datetime-local" required />
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
              required
            />
          </label>
          <button>Queue calendar event</button>
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
          <strong>{text(v.filename ?? v.id)}</strong>
          <p>Status: {text(v.status ?? "processing")}</p>
          <pre>{JSON.stringify(v, null, 2)}</pre>
          <div className="actions">
            <button
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
            <button
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
        Artifact ID
        <input value={artifact} onChange={(e) => setArtifact(e.target.value)} />
      </label>
      <button
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
      <button
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
function CalendarTools({
  event,
  refresh,
}: {
  event: RecordData;
  refresh: () => void;
}) {
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <section className="review">
      <h3>Calendar event</h3>
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
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            const r = await request<{ operation_id: string }>(
              `/calendar/events/${event.id}`,
              {
                method: "PATCH",
                revision: event.revision,
                body: {
                  start: new Date(String(f.get("start"))).toISOString(),
                  end: new Date(String(f.get("end"))).toISOString(),
                  timezone: f.get("timezone"),
                  expected_etag: event.etag,
                },
              },
            );
            setNotice(
              "Reschedule queued; provider confirmation pending · " +
                r.operation_id,
            );
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>
          New start (your local time)
          <input type="datetime-local" name="start" required />
        </label>
        <label>
          New end (your local time)
          <input type="datetime-local" name="end" required />
        </label>
        <label>
          Timezone
          <input
            name="timezone"
            defaultValue={text(
              event.timezone ??
                Intl.DateTimeFormat().resolvedOptions().timeZone,
            )}
            required
          />
        </label>
        <button>Queue reschedule</button>
      </form>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
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
        }}
      >
        <label>
          Link lesson ID
          <input name="lesson_id" required />
        </label>
        <label>
          Current lesson revision
          <input name="revision" type="number" min="1" required />
        </label>
        <button className="secondary">Link lesson</button>
      </form>
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
        Select your teaching calendar
        <select
          required
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a writable calendar</option>
          {calendars.map((c) => (
            <option value={c.id} key={c.id}>
              {text(c.summary ?? c.id)}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button>Use this calendar</button>
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
            {text(r.display_name ?? r.title ?? r.id)}
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
            {text(r.display_name ?? r.title ?? r.id)}
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
      {result?.error != null && <p>{text(result.error)}</p>}
      {error && <p>{error}</p>}
    </div>
  );
}
function StudentProgress({student}:{student:RecordData}){const[records,setRecords]=useState<{kind:string;record:RecordData}[]>([]),[error,setError]=useState('');useEffect(()=>{Promise.all(['lessons','assignments'].map(async kind=>{const r=await request<Page>('/'+kind+'?student_id='+student.id);return r.items.filter(item=>item.student_id===student.id).map(record=>({kind,record}))})).then(rows=>setRecords(rows.flat().sort((a,b)=>text(b.record.created_at).localeCompare(text(a.record.created_at))))).catch(e=>setError(e.message))},[student.id]);return <section className="review"><h3>Learning history</h3>{error&&<p className="error">{error}</p>}{records.length?records.map(({kind,record})=><div className="question-editor" key={record.id}><span className="eyebrow">{kind}</span><h3>{text(record.title??record.id)}</h3><p>{text(record.status)} · {new Date(text(record.created_at)).toLocaleDateString()}</p>{record.release_id!=null&&<span className="badge">Results released</span>}</div>):<p>No linked lessons or assignments yet.</p>}</section>}

import { useState, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

type ShiftType = "당" | "비";
type ExceptionType = "연가" | "교육" | "출장" | "병가" | "기타";

type DayException = {
  type: ExceptionType;
  note: string;
};

type AppConfig = {
  teamName: string;
  referenceDangDate: string; // YYYY-MM-DD — 알고 있는 당번 날짜
  exceptions: Record<string, DayException>; // YYYY-MM-DD → 예외
  googleClientId: string;
  googleCalendarId: string;
  alarmBeforeMinutes: number; // 출근(9시) 몇 분 전에 알람
};

type CalendarDay = {
  dateStr: string;
  dayOfMonth: number;
  dayOfWeek: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  shift: ShiftType;
  exception?: DayException;
};

type TokenClient = { requestAccessToken: () => void };

// ═══════════════════════════════════════════════════════════════════
// 상수 / 기본값
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY = "firefighter-shift-v1";
const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const EXCEPTION_TYPES: ExceptionType[] = ["연가", "교육", "출장", "병가", "기타"];

const DEFAULT_CONFIG: AppConfig = {
  teamName: "2팀",
  referenceDangDate: "2026-06-20",
  exceptions: {},
  googleClientId: "",
  googleCalendarId: "primary",
  alarmBeforeMinutes: 90,
};

// ═══════════════════════════════════════════════════════════════════
// 순수 함수
// ═══════════════════════════════════════════════════════════════════

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dateToStr(d);
}

function getShift(dateStr: string, referenceDangDate: string): ShiftType {
  const d = new Date(dateStr + "T12:00:00");
  const ref = new Date(referenceDangDate + "T12:00:00");
  const diff = Math.round((d.getTime() - ref.getTime()) / 86_400_000);
  return ((diff % 3) + 3) % 3 === 0 ? "당" : "비";
}

function alarmTimeStr(minutesBefore: number): string {
  const total = 9 * 60 - minutesBefore;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function buildMonthDays(year: number, month: number, config: AppConfig): CalendarDay[] {
  const today = todayStr();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: CalendarDay[] = [];

  // 앞 패딩
  for (let i = 0; i < firstDay.getDay(); i++) {
    const d = new Date(year, month, 1 - firstDay.getDay() + i);
    const ds = dateToStr(d);
    days.push({
      dateStr: ds, dayOfMonth: d.getDate(), dayOfWeek: d.getDay(),
      isCurrentMonth: false, isToday: ds === today,
      shift: getShift(ds, config.referenceDangDate),
    });
  }

  // 현재 달
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const ds = `${year}-${pad(month + 1)}-${pad(day)}`;
    days.push({
      dateStr: ds, dayOfMonth: day, dayOfWeek: new Date(year, month, day).getDay(),
      isCurrentMonth: true, isToday: ds === today,
      shift: getShift(ds, config.referenceDangDate),
      exception: config.exceptions[ds],
    });
  }

  // 뒤 패딩 (6줄 채우기)
  for (let i = 1; days.length < 42; i++) {
    const d = new Date(year, month + 1, i);
    const ds = dateToStr(d);
    days.push({
      dateStr: ds, dayOfMonth: d.getDate(), dayOfWeek: d.getDay(),
      isCurrentMonth: false, isToday: ds === today,
      shift: getShift(ds, config.referenceDangDate),
    });
  }

  return days;
}

// ═══════════════════════════════════════════════════════════════════
// 구글 캘린더 API
// ═══════════════════════════════════════════════════════════════════

async function gcalFetch(token: string, method: string, path: string, body?: unknown) {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function deleteShiftEvents(token: string, calId: string, fromDate: string, toDate: string) {
  const params = new URLSearchParams({
    privateExtendedProperty: "shiftApp=true",
    timeMin: `${fromDate}T00:00:00+09:00`,
    timeMax: `${toDate}T23:59:59+09:00`,
    maxResults: "2500",
    singleEvents: "true",
  });
  const res = await gcalFetch(token, "GET", `/calendars/${encodeURIComponent(calId)}/events?${params}`);
  if (!res.ok) return;
  const data = await res.json() as { items?: { id: string }[] };
  for (const ev of data.items ?? []) {
    await gcalFetch(token, "DELETE", `/calendars/${encodeURIComponent(calId)}/events/${ev.id}`);
  }
}

async function syncToGcal(token: string, config: AppConfig): Promise<number> {
  const startDate = new Date();
  startDate.setDate(1);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 3);

  const fromStr = dateToStr(startDate);
  const toStr = dateToStr(endDate);

  await deleteShiftEvents(token, config.googleCalendarId, fromStr, toStr);

  let created = 0;
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const ds = dateToStr(cur);
    if (getShift(ds, config.referenceDangDate) === "당") {
      const ex = config.exceptions[ds];
      const res = await gcalFetch(token, "POST",
        `/calendars/${encodeURIComponent(config.googleCalendarId)}/events`,
        {
          summary: ex ? `소방 당번 (${ex.type})` : "소방 당번",
          description: ex?.note ?? "",
          start: { dateTime: `${ds}T09:00:00+09:00`, timeZone: "Asia/Seoul" },
          end: { dateTime: `${addDays(ds, 1)}T09:00:00+09:00`, timeZone: "Asia/Seoul" },
          colorId: "5", // 노란색(Banana)
          reminders: {
            useDefault: false,
            overrides: [{ method: "popup", minutes: config.alarmBeforeMinutes }],
          },
          extendedProperties: { private: { shiftApp: "true" } },
        }
      );
      if (res.ok) created++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return created;
}

// ═══════════════════════════════════════════════════════════════════
// App
// ═══════════════════════════════════════════════════════════════════

type View = "calendar" | "settings";

export default function App() {
  const [config, setConfig] = useState<AppConfig>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) as AppConfig };
    } catch { /**/ }
    return { ...DEFAULT_CONFIG };
  });

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [view, setView] = useState<View>("calendar");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncing, setSyncing] = useState(false);
  const tokenClientRef = useRef<TokenClient | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    if (!config.googleClientId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!g) return;
    tokenClientRef.current = g.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: "https://www.googleapis.com/auth/calendar.events",
      callback: (res: { access_token?: string; error?: string }) => {
        if (res.access_token) {
          setGoogleToken(res.access_token);
          setSyncMsg("구글 계정 연결됨 ✓");
        } else {
          setSyncMsg("연결 실패: " + (res.error ?? "알 수 없는 오류"));
        }
      },
    });
  }, [config.googleClientId]);

  function patch(p: Partial<AppConfig>) {
    setConfig(c => ({ ...c, ...p }));
  }

  function setException(ds: string, ex: DayException | null) {
    setConfig(c => {
      const exceptions = { ...c.exceptions };
      if (ex) exceptions[ds] = ex;
      else delete exceptions[ds];
      return { ...c, exceptions };
    });
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function goToday() {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function connectGoogle() {
    if (tokenClientRef.current) {
      tokenClientRef.current.requestAccessToken();
    } else {
      setSyncMsg("Google Client ID를 먼저 입력해주세요");
    }
  }

  async function handleSync() {
    if (!googleToken) { setSyncMsg("구글 계정을 먼저 연결해주세요"); return; }
    setSyncing(true);
    setSyncMsg("동기화 중...");
    try {
      const created = await syncToGcal(googleToken, config);
      setSyncMsg(`완료 ✓  당번 일정 ${created}개 생성 (오늘~3개월)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "알 수 없는 오류";
      if (msg.includes("401")) {
        setGoogleToken(null);
        setSyncMsg("토큰 만료 — 구글 계정 재연결 후 다시 시도해주세요");
      } else {
        setSyncMsg("오류: " + msg);
      }
    } finally {
      setSyncing(false);
    }
  }

  const today = todayStr();
  const days = buildMonthDays(year, month, config);
  const todayShift = getShift(today, config.referenceDangDate);
  const tomorrowDate = addDays(today, 1);
  const tomorrowShift = getShift(tomorrowDate, config.referenceDangDate);
  const tomorrowEx = config.exceptions[tomorrowDate];
  const alarmTime = alarmTimeStr(config.alarmBeforeMinutes);
  const showAlarm = tomorrowShift === "당" && !tomorrowEx;

  return (
    <div className="app">

      {/* ══ 캘린더 뷰 ══════════════════════════════════════════ */}
      {view === "calendar" && (
        <>
          <header className="topbar">
            <button className="nav-btn" onClick={prevMonth}>‹</button>
            <div className="topbar-mid">
              <button className="month-btn" onClick={goToday}>
                {year}년 {month + 1}월
              </button>
              <span className="team-tag">{config.teamName}</span>
            </div>
            <button className="nav-btn" onClick={nextMonth}>›</button>
            <button className="gear-btn" onClick={() => setView("settings")}>⚙</button>
          </header>

          <div className="dow-row">
            {DAY_LABELS.map((d, i) => (
              <div key={d} className={`dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`}>{d}</div>
            ))}
          </div>

          <div className="cal-grid">
            {days.map(day => {
              const isDang = day.shift === "당";
              const hasEx = !!day.exception;
              const exLabel = day.exception?.type;

              return (
                <button
                  key={day.dateStr}
                  className={[
                    "cal-cell",
                    !day.isCurrentMonth && "other",
                    isDang && day.isCurrentMonth && "dang-cell",
                    day.isToday && "today-cell",
                  ].filter(Boolean).join(" ")}
                  onClick={() => { if (day.isCurrentMonth) setSelectedDate(day.dateStr); }}
                >
                  <span className={[
                    "cal-num",
                    day.dayOfWeek === 0 && "sun",
                    day.dayOfWeek === 6 && "sat",
                    day.isToday && "today-num",
                  ].filter(Boolean).join(" ")}>
                    {day.dayOfMonth}
                  </span>

                  {day.isCurrentMonth && (
                    isDang ? (
                      <span className="badge-dang">{hasEx ? exLabel!.slice(0, 1) : "당"}</span>
                    ) : (
                      <span className={`label-bi ${hasEx ? "has-ex" : ""}`}>
                        {hasEx ? exLabel!.slice(0, 1) : "비"}
                      </span>
                    )
                  )}
                </button>
              );
            })}
          </div>

          <div className="status-bar">
            <StatusChip label="오늘" shift={todayShift} override={config.exceptions[today]?.type} />
            <StatusChip label="내일" shift={tomorrowShift} override={tomorrowEx?.type} />
            {showAlarm && (
              <div className="alarm-chip">
                <span className="chip-label">내일 기상</span>
                <span className="alarm-time">{alarmTime}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ 설정 뷰 ════════════════════════════════════════════ */}
      {view === "settings" && (
        <div className="settings-view">
          <header className="settings-topbar">
            <button className="back-btn" onClick={() => setView("calendar")}>‹</button>
            <span className="settings-heading">설정</span>
          </header>

          <div className="settings-body">

            {/* 팀 설정 */}
            <SettingsSection title="팀 설정">
              <SettingsRow label="팀 이름">
                <input
                  type="text"
                  value={config.teamName}
                  onChange={e => patch({ teamName: e.target.value })}
                  placeholder="예: 2팀"
                />
              </SettingsRow>
              <SettingsRow label="기준 당번일">
                <input
                  type="date"
                  value={config.referenceDangDate}
                  onChange={e => patch({ referenceDangDate: e.target.value })}
                />
              </SettingsRow>
              <p className="hint">인사이동 시 팀 이름과 기준 당번일을 변경하세요.</p>
            </SettingsSection>

            {/* 알람 */}
            <SettingsSection title="알람">
              <SettingsRow label="출근 전 기상">
                <div className="alarm-input-row">
                  <input
                    type="number"
                    min={30}
                    max={240}
                    value={config.alarmBeforeMinutes}
                    onChange={e => patch({ alarmBeforeMinutes: Number(e.target.value) })}
                  />
                  <span className="unit">분 전</span>
                </div>
              </SettingsRow>
              <p className="hint">9시 출근 기준 → 기상 알람 {alarmTime} (구글 캘린더 알림으로 설정됨)</p>
            </SettingsSection>

            {/* 구글 캘린더 */}
            <SettingsSection title="구글 캘린더 연동">
              <SettingsRow label="Google Client ID">
                <input
                  type="text"
                  value={config.googleClientId}
                  onChange={e => patch({ googleClientId: e.target.value })}
                  placeholder="Google Cloud에서 발급"
                />
              </SettingsRow>
              <SettingsRow label="캘린더 ID">
                <input
                  type="text"
                  value={config.googleCalendarId}
                  onChange={e => patch({ googleCalendarId: e.target.value })}
                  placeholder="primary"
                />
              </SettingsRow>
              <div className="gcal-btn-row">
                <button
                  className={`btn-outline ${googleToken ? "ok" : ""}`}
                  onClick={connectGoogle}
                  disabled={!config.googleClientId}
                >
                  {googleToken ? "✓ 연결됨 (재연결)" : "구글 계정 연결"}
                </button>
                <button
                  className="btn-primary"
                  onClick={handleSync}
                  disabled={!googleToken || syncing}
                >
                  {syncing ? "동기화 중..." : "지금 동기화"}
                </button>
              </div>
              {syncMsg && (
                <p className={`sync-msg ${syncMsg.includes("오류") || syncMsg.includes("실패") || syncMsg.includes("만료") ? "err" : "ok"}`}>
                  {syncMsg}
                </p>
              )}
              <p className="hint">
                오늘부터 3개월간 당번 일정이 구글 캘린더에 자동 생성됩니다.
                기존 앱 일정과 중복되지 않도록 기존 캘린더 일정은 미리 정리해주세요.
              </p>
            </SettingsSection>

          </div>
        </div>
      )}

      {/* ══ 날짜 상세 모달 ═══════════════════════════════════ */}
      {selectedDate && (
        <div className="overlay" onClick={() => setSelectedDate(null)}>
          <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
            <DaySheet
              dateStr={selectedDate}
              shift={getShift(selectedDate, config.referenceDangDate)}
              exception={config.exceptions[selectedDate]}
              onSave={ex => { setException(selectedDate, ex); setSelectedDate(null); }}
              onRemove={() => { setException(selectedDate, null); setSelectedDate(null); }}
              onClose={() => setSelectedDate(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 컴포넌트
// ═══════════════════════════════════════════════════════════════════

function StatusChip({ label, shift, override }: {
  label: string;
  shift: ShiftType;
  override?: string;
}) {
  return (
    <div className="status-chip">
      <span className="chip-label">{label}</span>
      <span className={`chip-shift ${shift === "당" ? "dang" : "bi"}`}>
        {override ?? (shift === "당" ? "당번" : "비번")}
      </span>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="row-label">{label}</span>
      <div className="row-control">{children}</div>
    </div>
  );
}

function DaySheet({ dateStr, shift, exception, onSave, onRemove, onClose }: {
  dateStr: string;
  shift: ShiftType;
  exception?: DayException;
  onSave: (ex: DayException) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [exType, setExType] = useState<ExceptionType>(exception?.type ?? "연가");
  const [note, setNote] = useState(exception?.note ?? "");
  const [y, m, d] = dateStr.split("-");

  return (
    <>
      <div className="sheet-top">
        <div>
          <p className="sheet-date">{y}년 {Number(m)}월 {Number(d)}일</p>
          <p className={`sheet-shift-label ${shift === "당" ? "dang" : "bi"}`}>
            {exception?.type ?? (shift === "당" ? "당번" : "비번")}
          </p>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {exception ? (
        <div className="ex-view">
          <span className="ex-badge">{exception.type}</span>
          {exception.note && <p className="ex-note-text">{exception.note}</p>}
          <button className="btn-remove" onClick={onRemove}>예외 제거</button>
        </div>
      ) : (
        <div className="ex-form">
          <p className="ex-form-title">예외 사항 추가</p>
          <div className="ex-type-list">
            {EXCEPTION_TYPES.map(t => (
              <button
                key={t}
                className={`ex-type-btn ${exType === t ? "active" : ""}`}
                onClick={() => setExType(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            className="ex-note-input"
            type="text"
            placeholder="메모 (선택)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <button className="btn-save" onClick={() => onSave({ type: exType, note })}>저장</button>
        </div>
      )}
    </>
  );
}

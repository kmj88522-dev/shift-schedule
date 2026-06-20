import { useState, useEffect, useRef } from "react";

type ShiftType = "당" | "비";
type ExceptionType = "연가" | "교육" | "출장" | "병가" | "기타";
type TeamPreset = "1팀" | "2팀" | "3팀" | "커스텀";

type DaySchedule = {
  exceptionType?: ExceptionType;
  title: string;
  note: string;
  location: string;
  endDate: string;
};

type AppConfig = {
  teamPreset: TeamPreset;
  customReferenceDangDate: string;
  schedules: Record<string, DaySchedule>;
  googleClientId: string;
  googleCalendarId: string;
  alarmFirstMinutes: number;
  alarmInterval: number;
  alarmCount: number;
};

type CalendarDay = {
  dateStr: string;
  dayOfMonth: number;
  dayOfWeek: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  shift: ShiftType;
  schedule?: DaySchedule;
};

type TokenClient = { requestAccessToken: () => void };

const STORAGE_KEY = "firefighter-shift-v2";
const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const EXCEPTION_TYPES: ExceptionType[] = ["연가", "교육", "출장", "병가", "기타"];

const TEAM_REF: Record<string, string> = {
  "1팀": "2026-06-19",
  "2팀": "2026-06-20",
  "3팀": "2026-06-21",
};

const EX_COLORS: Record<ExceptionType, string> = {
  연가: "#22c55e",
  교육: "#3b82f6",
  출장: "#8b5cf6",
  병가: "#94a3b8",
  기타: "#f97316",
};

const DEFAULT_CONFIG: AppConfig = {
  teamPreset: "2팀",
  customReferenceDangDate: "2026-06-20",
  schedules: {},
  googleClientId: "",
  googleCalendarId: "primary",
  alarmFirstMinutes: 90,
  alarmInterval: 10,
  alarmCount: 5,
};

function pad(n: number) { return String(n).padStart(2, "0"); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function dateToStr(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDays(ds: string, n: number) { const d = new Date(ds+"T12:00:00"); d.setDate(d.getDate()+n); return dateToStr(d); }
function getRef(c: AppConfig) { return c.teamPreset === "커스텀" ? c.customReferenceDangDate : (TEAM_REF[c.teamPreset] ?? "2026-06-20"); }
function getShift(ds: string, ref: string): ShiftType {
  const diff = Math.round((new Date(ds+"T12:00:00").getTime() - new Date(ref+"T12:00:00").getTime()) / 86_400_000);
  return ((diff % 3) + 3) % 3 === 0 ? "당" : "비";
}
function minsToTime(m: number) { const t = 9*60-m; return `${pad(Math.floor(t/60))}:${pad(t%60)}`; }
function alarmArr(c: AppConfig) {
  return Array.from({length: c.alarmCount}, (_,i) => c.alarmFirstMinutes - i*c.alarmInterval).filter(m => m > 0);
}

function buildDays(year: number, month: number, config: AppConfig): CalendarDay[] {
  const ref = getRef(config);
  const today = todayStr();
  const first = new Date(year, month, 1);
  const last = new Date(year, month+1, 0);
  const days: CalendarDay[] = [];
  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(year, month, 1 - first.getDay() + i);
    const ds = dateToStr(d);
    days.push({dateStr:ds, dayOfMonth:d.getDate(), dayOfWeek:d.getDay(), isCurrentMonth:false, isToday:ds===today, shift:getShift(ds,ref)});
  }
  for (let day = 1; day <= last.getDate(); day++) {
    const ds = `${year}-${pad(month+1)}-${pad(day)}`;
    days.push({dateStr:ds, dayOfMonth:day, dayOfWeek:new Date(year,month,day).getDay(), isCurrentMonth:true, isToday:ds===today, shift:getShift(ds,ref), schedule:config.schedules[ds]});
  }
  for (let i = 1; days.length < 42; i++) {
    const d = new Date(year, month+1, i);
    const ds = dateToStr(d);
    days.push({dateStr:ds, dayOfMonth:d.getDate(), dayOfWeek:d.getDay(), isCurrentMonth:false, isToday:ds===today, shift:getShift(ds,ref)});
  }
  return days;
}

async function gcalFetch(token: string, method: string, path: string, body?: unknown) {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {Authorization:`Bearer ${token}`, ...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
}
async function deleteShiftEvents(token: string, calId: string, from: string, to: string) {
  const p = new URLSearchParams({privateExtendedProperty:"shiftApp=true", timeMin:`${from}T00:00:00+09:00`, timeMax:`${to}T23:59:59+09:00`, maxResults:"2500", singleEvents:"true"});
  const res = await gcalFetch(token,"GET",`/calendars/${encodeURIComponent(calId)}/events?${p}`);
  if (!res.ok) return;
  const data = await res.json() as {items?:{id:string}[]};
  for (const ev of data.items??[]) await gcalFetch(token,"DELETE",`/calendars/${encodeURIComponent(calId)}/events/${ev.id}`);
}
async function syncToGcal(token: string, config: AppConfig): Promise<number> {
  const start = new Date(); start.setDate(1);
  const end = new Date(start); end.setMonth(end.getMonth()+3);
  await deleteShiftEvents(token, config.googleCalendarId, dateToStr(start), dateToStr(end));
  const ref = getRef(config);
  const alarms = alarmArr(config);
  let created = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const ds = dateToStr(cur);
    if (getShift(ds, ref) === "당") {
      const s = config.schedules[ds];
      const ex = s?.exceptionType;
      const res = await gcalFetch(token,"POST",`/calendars/${encodeURIComponent(config.googleCalendarId)}/events`,{
        summary: ex ? `소방 당번 (${ex})` : "소방 당번",
        description: [s?.title, s?.note, s?.location].filter(Boolean).join("\n"),
        start:{dateTime:`${ds}T09:00:00+09:00`, timeZone:"Asia/Seoul"},
        end:{dateTime:`${addDays(ds,1)}T09:00:00+09:00`, timeZone:"Asia/Seoul"},
        colorId: ex?"2":"5",
        reminders:{useDefault:false, overrides:alarms.map(m=>({method:"popup",minutes:m}))},
        extendedProperties:{private:{shiftApp:"true"}},
      });
      if (res.ok) created++;
    }
    cur.setDate(cur.getDate()+1);
  }
  return created;
}

type View = "calendar" | "settings";

export default function App() {
  const [config, setConfig] = useState<AppConfig>(() => {
    try { const r = localStorage.getItem(STORAGE_KEY); if (r) return {...DEFAULT_CONFIG, ...JSON.parse(r) as AppConfig}; } catch {/**/}
    return {...DEFAULT_CONFIG};
  });
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [view, setView] = useState<View>("calendar");
  const [selectedDate, setSelectedDate] = useState<string|null>(null);
  const [googleToken, setGoogleToken] = useState<string|null>(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncing, setSyncing] = useState(false);
  const tokenRef = useRef<TokenClient|null>(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); }, [config]);
  useEffect(() => {
    if (!config.googleClientId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!g) return;
    tokenRef.current = g.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: "https://www.googleapis.com/auth/calendar.events",
      callback: (res: {access_token?:string; error?:string}) => {
        if (res.access_token) { setGoogleToken(res.access_token); setSyncMsg("구글 계정 연결됨 ✓"); }
        else setSyncMsg("연결 실패: " + (res.error ?? "알 수 없는 오류"));
      },
    });
  }, [config.googleClientId]);

  function patch(p: Partial<AppConfig>) { setConfig(c => ({...c,...p})); }
  function setSched(ds: string, s: DaySchedule|null) {
    setConfig(c => { const schedules={...c.schedules}; if(s) schedules[ds]=s; else delete schedules[ds]; return {...c,schedules}; });
  }
  function prevMonth() { if(month===0){setYear(y=>y-1);setMonth(11);}else setMonth(m=>m-1); }
  function nextMonth() { if(month===11){setYear(y=>y+1);setMonth(0);}else setMonth(m=>m+1); }
  function goToday() { const d=new Date(); setYear(d.getFullYear()); setMonth(d.getMonth()); }
  function connectGoogle() { if(tokenRef.current) tokenRef.current.requestAccessToken(); else setSyncMsg("Google Client ID를 먼저 입력해주세요"); }
  async function handleSync() {
    if (!googleToken) { setSyncMsg("구글 계정을 먼저 연결해주세요"); return; }
    setSyncing(true); setSyncMsg("동기화 중...");
    try { const n = await syncToGcal(googleToken, config); setSyncMsg(`완료 ✓  당번 일정 ${n}개 생성 (오늘~3개월)`); }
    catch (e) {
      const msg = e instanceof Error ? e.message : "알 수 없는 오류";
      if (msg.includes("401")) { setGoogleToken(null); setSyncMsg("토큰 만료 — 구글 계정 재연결 후 다시 시도해주세요"); }
      else setSyncMsg("오류: " + msg);
    } finally { setSyncing(false); }
  }

  const today = todayStr();
  const ref = getRef(config);
  const days = buildDays(year, month, config);
  const todayShift = getShift(today, ref);
  const tmrDate = addDays(today, 1);
  const tmrShift = getShift(tmrDate, ref);
  const todayEx = config.schedules[today]?.exceptionType;
  const tmrEx = config.schedules[tmrDate]?.exceptionType;
  const todayLabel = todayEx ?? (todayShift==="당"?"당번":"비번");
  const tmrLabel = tmrEx ?? (tmrShift==="당"?"당번":"비번");
  const showAlarm = tmrShift==="당" && !tmrEx;
  const todayDow = DAY_LABELS[new Date(today+"T12:00:00").getDay()];

  return (
    <div className="app">
      {view === "calendar" && (
        <>
          <header className="topbar">
            <button className="nav-btn" onClick={prevMonth}>‹</button>
            <div className="topbar-mid">
              <button className="month-btn" onClick={goToday}>{year}년 {month+1}월</button>
              <div className="topbar-status">
                <span className="team-tag">{config.teamPreset}</span>
                <span className="status-line">
                  {today}({todayDow}){" "}
                  <span className={todayShift==="당"?"clr-dang":"clr-bi"}>{todayLabel}</span>
                  {" · 내일 "}
                  <span className={tmrShift==="당"?"clr-dang":"clr-bi"}>{tmrLabel}</span>
                  {showAlarm && <span className="clr-alarm"> ⏰{minsToTime(config.alarmFirstMinutes)}</span>}
                </span>
              </div>
            </div>
            <button className="nav-btn" onClick={nextMonth}>›</button>
            <button className="gear-btn" onClick={() => setView("settings")}>⚙</button>
          </header>

          <div className="dow-row">
            {DAY_LABELS.map((d,i) => <div key={d} className={`dow ${i===0?"sun":i===6?"sat":""}`}>{d}</div>)}
          </div>

          <div className="cal-grid">
            {days.map(day => {
              const isDang = day.shift==="당";
              const ex = day.schedule?.exceptionType;
              const badgeColor = isDang ? (ex ? EX_COLORS[ex] : "#f59e0b") : null;
              const schedText = day.schedule?.title || day.schedule?.note;
              return (
                <button
                  key={day.dateStr}
                  className={["cal-cell", !day.isCurrentMonth&&"other", isDang&&day.isCurrentMonth&&"dang-cell", day.isToday&&"today-cell"].filter(Boolean).join(" ")}
                  onClick={() => { if(day.isCurrentMonth) setSelectedDate(day.dateStr); }}
                >
                  <div className="cell-top">
                    <span className={["cal-num", day.dayOfWeek===0&&"sun", day.dayOfWeek===6&&"sat", day.isToday&&"today-num"].filter(Boolean).join(" ")}>
                      {day.dayOfMonth}
                    </span>
                    {day.isCurrentMonth && (
                      isDang
                        ? <span className="badge-dang" style={ex?{background:badgeColor!}:undefined}>{ex?ex[0]:"당"}</span>
                        : <span className="label-bi">비</span>
                    )}
                  </div>
                  {day.isCurrentMonth && schedText && <div className="cell-sched">{schedText}</div>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {view === "settings" && (
        <div className="settings-view">
          <header className="settings-topbar">
            <button className="back-btn" onClick={() => setView("calendar")}>‹</button>
            <span className="settings-heading">설정</span>
          </header>
          <div className="settings-body">

            <SettingsSection title="팀 설정">
              <div className="team-selector">
                {(["1팀","2팀","3팀","커스텀"] as TeamPreset[]).map(t => (
                  <button key={t} className={`team-btn ${config.teamPreset===t?"active":""}`} onClick={() => patch({teamPreset:t})}>{t}</button>
                ))}
              </div>
              {config.teamPreset === "커스텀" ? (
                <>
                  <SettingsRow label="기준 당번일">
                    <input type="date" value={config.customReferenceDangDate} onChange={e => patch({customReferenceDangDate:e.target.value})} />
                  </SettingsRow>
                  <p className="hint">내근직 등 커스텀 근무형태에 사용하세요.</p>
                </>
              ) : (
                <p className="hint">전남소방본부 3조 1교대. 인사이동 시 팀을 변경하세요.</p>
              )}
            </SettingsSection>

            <SettingsSection title="알람 설정">
              <SettingsRow label="첫 알람">
                <div className="alarm-input-row">
                  <input type="number" min={30} max={300} value={config.alarmFirstMinutes} onChange={e => patch({alarmFirstMinutes:Number(e.target.value)})} />
                  <span className="unit">분 전 ({minsToTime(config.alarmFirstMinutes)})</span>
                </div>
              </SettingsRow>
              <SettingsRow label="간격">
                <div className="alarm-input-row">
                  <input type="number" min={5} max={30} value={config.alarmInterval} onChange={e => patch({alarmInterval:Number(e.target.value)})} />
                  <span className="unit">분</span>
                </div>
              </SettingsRow>
              <SettingsRow label="횟수">
                <div className="alarm-input-row">
                  <input type="number" min={1} max={10} value={config.alarmCount} onChange={e => patch({alarmCount:Number(e.target.value)})} />
                  <span className="unit">회</span>
                </div>
              </SettingsRow>
              <p className="hint">구글 캘린더 팝업: {minsToTime(config.alarmFirstMinutes)}부터 {config.alarmInterval}분 간격 {config.alarmCount}회</p>
            </SettingsSection>

            <SettingsSection title="구글 캘린더 연동">
              <SettingsRow label="Google Client ID">
                <input type="text" value={config.googleClientId} onChange={e => patch({googleClientId:e.target.value})} placeholder="Google Cloud에서 발급" />
              </SettingsRow>
              <SettingsRow label="캘린더 ID">
                <input type="text" value={config.googleCalendarId} onChange={e => patch({googleCalendarId:e.target.value})} placeholder="primary" />
              </SettingsRow>
              <div className="gcal-btn-row">
                <button className={`btn-outline ${googleToken?"ok":""}`} onClick={connectGoogle} disabled={!config.googleClientId}>
                  {googleToken?"✓ 연결됨 (재연결)":"구글 계정 연결"}
                </button>
                <button className="btn-primary" onClick={handleSync} disabled={!googleToken||syncing}>
                  {syncing?"동기화 중...":"지금 동기화"}
                </button>
              </div>
              {syncMsg && <p className={`sync-msg ${syncMsg.includes("오류")||syncMsg.includes("실패")||syncMsg.includes("만료")?"err":"ok"}`}>{syncMsg}</p>}
              <p className="hint">오늘부터 3개월간 당번 일정이 구글 캘린더에 자동 생성됩니다.</p>
            </SettingsSection>

          </div>
        </div>
      )}

      {selectedDate && (
        <div className="overlay" onClick={() => setSelectedDate(null)}>
          <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
            <DaySheet
              dateStr={selectedDate}
              shift={getShift(selectedDate, ref)}
              schedule={config.schedules[selectedDate]}
              onSave={s => { setSched(selectedDate, s); setSelectedDate(null); }}
              onRemove={() => { setSched(selectedDate, null); setSelectedDate(null); }}
              onClose={() => setSelectedDate(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsSection({title, children}: {title:string; children:React.ReactNode}) {
  return <section className="settings-section"><h2 className="section-title">{title}</h2>{children}</section>;
}
function SettingsRow({label, children}: {label:string; children:React.ReactNode}) {
  return <div className="settings-row"><span className="row-label">{label}</span><div className="row-control">{children}</div></div>;
}

function DaySheet({dateStr, shift, schedule, onSave, onRemove, onClose}: {
  dateStr:string; shift:ShiftType; schedule?:DaySchedule;
  onSave:(s:DaySchedule)=>void; onRemove:()=>void; onClose:()=>void;
}) {
  const [exType, setExType] = useState<ExceptionType|undefined>(schedule?.exceptionType);
  const [title, setTitle] = useState(schedule?.title??"");
  const [note, setNote] = useState(schedule?.note??"");
  const [location, setLocation] = useState(schedule?.location??"");
  const [endDate, setEndDate] = useState(schedule?.endDate??dateStr);
  const [y,m,d] = dateStr.split("-");
  const isDang = shift==="당";
  const badgeColor = isDang ? (exType ? EX_COLORS[exType] : "#f59e0b") : null;
  const shiftLabel = exType ?? (isDang?"당번":"비번");

  return (
    <>
      <div className="sheet-top">
        <div>
          <p className="sheet-date">{y}년 {Number(m)}월 {Number(d)}일</p>
          <div className="sheet-shift-row">
            {isDang && <span className="sheet-badge" style={{background:badgeColor!}}>{exType?exType[0]:"당"}</span>}
            <span className={`sheet-shift-label ${isDang?"dang":"bi"}`}>{shiftLabel}</span>
          </div>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="sched-form">
        <p className="sched-form-title">일정 추가</p>

        {isDang && (
          <div className="field-group">
            <p className="field-label">근무 변경</p>
            <div className="ex-type-list">
              <button className={`ex-type-btn ${!exType?"active":""}`} onClick={() => setExType(undefined)}>당번</button>
              {EXCEPTION_TYPES.map(t => (
                <button key={t}
                  className={`ex-type-btn ${exType===t?"active":""}`}
                  style={exType===t ? {borderColor:EX_COLORS[t], background:EX_COLORS[t]+"22", color:EX_COLORS[t]} : undefined}
                  onClick={() => setExType(p => p===t?undefined:t)}
                >{t}</button>
              ))}
            </div>
          </div>
        )}

        <div className="field-group">
          <label className="field-label">제목</label>
          <input className="field-input" type="text" placeholder="일정 제목" value={title} onChange={e=>setTitle(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">내용</label>
          <textarea className="field-input field-textarea" placeholder="메모" value={note} onChange={e=>setNote(e.target.value)} rows={2} />
        </div>
        <div className="field-row-two">
          <div className="field-group">
            <label className="field-label">시작일</label>
            <input className="field-input" type="date" value={dateStr} disabled />
          </div>
          <div className="field-group">
            <label className="field-label">종료일</label>
            <input className="field-input" type="date" value={endDate} min={dateStr} onChange={e=>setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label">위치</label>
          <input className="field-input" type="text" placeholder="장소" value={location} onChange={e=>setLocation(e.target.value)} />
        </div>

        <div className="sheet-btn-row">
          {schedule && <button className="btn-remove" onClick={onRemove}>삭제</button>}
          <button className="btn-save" onClick={() => onSave({exceptionType:exType, title, note, location, endDate})}>저장</button>
        </div>
      </div>
    </>
  );
}

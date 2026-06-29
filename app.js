const API_URL = "/api/readers";
const SERVER_INFO_URL = "/api/server-info";
const SUBJECTS = ["English", "English presentation", "Chinese", "Chinese presentation", "Math"];

function subjectId(subject) {
  return subject.toLowerCase().replaceAll(" ", "-");
}

const fallbackState = {
  currentReaderId: null,
  readers: [],
};

const form = document.querySelector("#reader-form");
const resetButton = document.querySelector("#reset-button");
const serverUrlCard = document.querySelector("#server-url-card");
const serverUrlText = document.querySelector("#server-url-text");
const leaderboardList = document.querySelector("#leaderboard-list");
const readerRank = document.querySelector("#reader-rank");
const progressDate = document.querySelector("#progress-date");
const goalsModal = document.querySelector("#goals-modal");
const goalsModalForm = document.querySelector("#goals-modal-form");
const closeGoalsModalButton = document.querySelector("#close-goals-modal");
const cancelGoalsUpdateButton = document.querySelector("#cancel-goals-update");
const goalsModalMessage = document.querySelector("#goals-modal-message");
const timerReaderName = document.querySelector("#timer-reader-name");
const timerDisplay = document.querySelector("#timer-display");
const timerStatus = document.querySelector("#timer-status");
const startTimerButton = document.querySelector("#start-timer-button");
const stopTimerButton = document.querySelector("#stop-timer-button");
const commentSessionButton = document.querySelector("#comment-session-button");
const subjectModal = document.querySelector("#subject-modal");
const closeSubjectModalButton = document.querySelector("#close-subject-modal");
const recordModal = document.querySelector("#record-modal");
const recordModalForm = document.querySelector("#record-modal-form");
const closeRecordModalButton = document.querySelector("#close-record-modal");
const cancelRecordUpdateButton = document.querySelector("#cancel-record-update");
const recordModalMessage = document.querySelector("#record-modal-message");
const commentModal = document.querySelector("#comment-modal");
const commentModalForm = document.querySelector("#comment-modal-form");
const closeCommentModalButton = document.querySelector("#close-comment-modal");
const cancelCommentUpdateButton = document.querySelector("#cancel-comment-update");
const commentModalMessage = document.querySelector("#comment-modal-message");
const weekRecordModal = document.querySelector("#week-record-modal");
const closeWeekRecordModalButton = document.querySelector("#close-week-record-modal");
const weekRecordReaderId = document.querySelector("#week-record-reader-id");
const weekRecordReaderName = document.querySelector("#week-record-reader-name");
const weekRecordWeek = document.querySelector("#week-record-week");
const weekSubjectSummary = document.querySelector("#week-subject-summary");
const weekRecordChart = document.querySelector("#week-record-chart");
const weekRecordBody = document.querySelector("#week-record-body");
const weekCommentModal = document.querySelector("#week-comment-modal");
const closeWeekCommentModalButton = document.querySelector("#close-week-comment-modal");
const weekCommentMeta = document.querySelector("#week-comment-meta");
const weekCommentText = document.querySelector("#week-comment-text");

const fields = {
  name: document.querySelector("#reader-name"),
  password: document.querySelector("#reader-password"),
};

const goalsModalFields = {
  name: document.querySelector("#goals-reader-name"),
  subjectGoals: Object.fromEntries(
    SUBJECTS.map((subject) => [
      subject,
      {
        workday: document.querySelector(`#modal-${subjectId(subject)}-workday-goal`),
        weekend: document.querySelector(`#modal-${subjectId(subject)}-weekend-goal`),
      },
    ]),
  ),
};

const recordModalFields = {
  name: document.querySelector("#record-reader-name"),
  date: document.querySelector("#record-date"),
  password: "",
  subjectMinutes: Object.fromEntries(
    SUBJECTS.map((subject) => [
      subject,
      document.querySelector(`#record-${subjectId(subject)}-minutes`),
    ]),
  ),
};

const commentModalFields = {
  name: document.querySelector("#comment-reader-name"),
  date: document.querySelector("#comment-date"),
  subject: document.querySelector("#comment-subject"),
  text: document.querySelector("#comment-text"),
};

const progress = {
  dailyText: document.querySelector("#daily-progress-text"),
  weeklyText: document.querySelector("#weekly-progress-text"),
  dailyMeter: document.querySelector("#daily-meter"),
  weeklyMeter: document.querySelector("#weekly-meter"),
};

const subjectProgress = {
  daily: Object.fromEntries(
    SUBJECTS.map((subject) => [subject, document.querySelector(`#daily-${subjectId(subject)}-time-text`)]),
  ),
  weekly: Object.fromEntries(
    SUBJECTS.map((subject) => [subject, document.querySelector(`#weekly-${subjectId(subject)}-time-text`)]),
  ),
};

let state = structuredClone(fallbackState);
let timerStartedAt = null;
let timerInterval = null;
let timerSavedMinutes = 0;
let timerSaving = false;
let timerStopping = false;
let timerActiveReaderName = "";
let timerActiveSubject = "";
let selectedDateKey = getLocalDateKey();

function isServerSideBrowser() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function getWeekStartDate(dateKey) {
  const date = getDateFromKey(dateKey);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function getIsoWeekValue(dateKey = selectedDateKey) {
  const date = getDateFromKey(dateKey);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getDateKeyFromWeekValue(weekValue, dayOffset = 0) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekValue);
  if (!match) return getLocalDateKey(getWeekStartDate(selectedDateKey));

  const year = Number(match[1]);
  const week = Number(match[2]);
  const date = new Date(year, 0, 1 + (week - 1) * 7);
  const day = date.getDay() || 7;
  if (day <= 4) {
    date.setDate(date.getDate() - day + 1);
  } else {
    date.setDate(date.getDate() + 8 - day);
  }
  date.setDate(date.getDate() + dayOffset);
  return getLocalDateKey(date);
}

function formatShortDate(dateKey) {
  const date = getDateFromKey(dateKey);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function getDailyRecord(reader, dateKey = selectedDateKey) {
  return reader?.dailyRecords?.[dateKey] ?? null;
}

function hasDateRecords(reader) {
  return !!reader?.dailyRecords && Object.keys(reader.dailyRecords).length > 0;
}

function isWeekend(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getIsoWeekParts(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return { year: date.getFullYear(), week };
}

function isSameIsoWeek(dateKey, targetDateKey) {
  const dateParts = getIsoWeekParts(dateKey);
  const targetParts = getIsoWeekParts(targetDateKey);
  return dateParts.year === targetParts.year && dateParts.week === targetParts.week;
}

function scoreReader(reader, dateKey = selectedDateKey) {
  const values = getProgressValues(reader, dateKey);
  return values.weekly;
}

function getRankedReaders() {
  return [...state.readers].sort((a, b) => scoreReader(b) - scoreReader(a));
}

function getCurrentReader() {
  return state.readers.find((reader) => reader.id === state.currentReaderId) ?? null;
}

function clampPercent(value, goal) {
  if (!goal) return 0;
  return Math.min(100, Math.round((value / goal) * 100));
}

function getProgressTone(value, goal) {
  if (!goal || value <= 0) return "empty";

  const percent = (value / goal) * 100;
  if (percent > 100) return "over";
  if (percent >= 100) return "complete";
  if (percent >= 75) return "strong";
  if (percent >= 40) return "steady";
  return "low";
}

function updateMeter(meter, value, goal) {
  meter.style.width = `${clampPercent(value, goal)}%`;
  meter.dataset.progressTone = getProgressTone(value, goal);
}

function readNumber(field, fallback) {
  const parsed = Number(field.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readSubjectGoals(source) {
  return Object.fromEntries(
    SUBJECTS.map((subject) => [
      subject,
      {
        workday: readNumber(source.subjectGoals[subject].workday, 20),
        weekend: readNumber(source.subjectGoals[subject].weekend, 30),
      },
    ]),
  );
}

function getSubjectGoals(reader) {
  const storedGoals = reader?.goals?.subjects ?? {};
  return Object.fromEntries(
    SUBJECTS.map((subject) => [
      subject,
      {
        workday: storedGoals[subject]?.workday ?? storedGoals[subject]?.daily ?? 20,
        weekend: storedGoals[subject]?.weekend ?? storedGoals[subject]?.daily ?? 30,
      },
    ]),
  );
}

function getSubjectDailyGoal(reader, dateKey = selectedDateKey) {
  const goals = getSubjectGoals(reader);
  const goalType = isWeekend(dateKey) ? "weekend" : "workday";
  return SUBJECTS.reduce((total, subject) => total + goals[subject][goalType], 0);
}

function getSubjectWeeklyGoal(reader) {
  const goals = getSubjectGoals(reader);
  return SUBJECTS.reduce((total, subject) => {
    return total + goals[subject].workday * 5 + goals[subject].weekend * 2;
  }, 0);
}

function createReaderId() {
  if (globalThis.crypto?.randomUUID) {
    return `reader-${globalThis.crypto.randomUUID()}`;
  }

  const randomValue = Math.random().toString(36).slice(2, 10);
  return `reader-${Date.now().toString(36)}-${randomValue}`;
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function setTimerRunning(isRunning) {
  startTimerButton.disabled = isRunning || timerStopping || !state.readers.length;
  stopTimerButton.disabled = !isRunning || timerStopping;
  commentSessionButton.disabled = !state.readers.length;
}

function updateTimerDisplay() {
  timerDisplay.textContent = timerStartedAt ? formatDuration(Date.now() - timerStartedAt) : "00:00:00";
}

function openSubjectModal() {
  subjectModal.hidden = false;
}

function closeSubjectModal() {
  subjectModal.hidden = true;
}

function startTimerForSubject(subject) {
  if (timerStartedAt || timerStopping) return;

  const name = timerReaderName.value.trim();
  if (!name) {
    timerReaderName.focus();
    return;
  }

  timerStartedAt = Date.now();
  timerSavedMinutes = 0;
  timerActiveReaderName = name;
  timerActiveSubject = subject;
  timerReaderName.disabled = true;
  setTimerRunning(true);
  closeSubjectModal();
  timerStatus.textContent = `${name} is studying ${subject}`;
  updateTimerDisplay();
  timerInterval = window.setInterval(() => {
    updateTimerDisplay();
    autosaveTimerProgress();
  }, 1000);
}

async function saveTimerMinutes(readerName, minutes, subject, successMessage) {
  if (timerSaving || minutes <= 0 || !subject) return false;

  timerSaving = true;
  try {
    const data = await addReadingSession(readerName, minutes, subject);
    state = {
      currentReaderId: data.currentReaderId,
      readers: data.readers,
    };
    render();
    timerStatus.textContent = successMessage;
    return true;
  } catch (error) {
    timerStatus.textContent = getErrorMessage(error, "Timer save failed");
    return false;
  } finally {
    timerSaving = false;
  }
}

async function autosaveTimerProgress() {
  if (!timerStartedAt || timerStopping) return;

  const name = timerActiveReaderName;
  const elapsedWholeMinutes = Math.floor((Date.now() - timerStartedAt) / 60000);
  const unsavedMinutes = elapsedWholeMinutes - timerSavedMinutes;
  if (!name || unsavedMinutes <= 0) return;

  const saved = await saveTimerMinutes(name, unsavedMinutes, timerActiveSubject, `Saved ${elapsedWholeMinutes} min so far`);
  if (saved) {
    timerSavedMinutes += unsavedMinutes;
  }
}

async function waitForActiveTimerSave() {
  while (timerSaving) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

function getProgressValues(reader, dateKey = selectedDateKey) {
  const dailyRecord = getDailyRecord(reader, dateKey);
  const canUseLegacyTotals = !hasDateRecords(reader) && dateKey === getLocalDateKey();
  const subjectTotals = getSubjectTotals(reader, dateKey);
  const subjectDailyTotal = sumSubjectTotals(subjectTotals.daily);
  const subjectWeeklyTotal = sumSubjectTotals(subjectTotals.weekly);
  const legacyDailyTotal =
    dailyRecord?.todayMinutes ?? dailyRecord?.minutes ?? (canUseLegacyTotals ? reader?.todayMinutes ?? 0 : 0);
  const legacyWeeklyTotal = dailyRecord?.weekMinutes ?? (canUseLegacyTotals ? reader?.weekMinutes ?? 0 : 0);

  return {
    today: subjectDailyTotal || legacyDailyTotal,
    weekly: subjectWeeklyTotal || legacyWeeklyTotal,
    dailyGoal: getSubjectDailyGoal(reader, dateKey),
    weeklyGoal: getSubjectWeeklyGoal(reader),
  };
}

function createSubjectTotals() {
  return Object.fromEntries(SUBJECTS.map((subject) => [subject, 0]));
}

function sumSubjectTotals(totals) {
  return SUBJECTS.reduce((total, subject) => total + totals[subject], 0);
}

function getSubjectTotals(reader, dateKey = selectedDateKey) {
  const totals = {
    daily: createSubjectTotals(),
    weekly: createSubjectTotals(),
  };
  const sessions = Array.isArray(reader?.readingSessions) ? reader.readingSessions : [];

  sessions.forEach((session) => {
    if (!SUBJECTS.includes(session.subject)) return;
    if (!session.recordDate) return;

    const minutes = Number(session.minutes);
    if (!Number.isFinite(minutes)) return;

    if (session.recordDate === dateKey) {
      totals.daily[session.subject] += minutes;
    }

    if (isSameIsoWeek(session.recordDate, dateKey)) {
      totals.weekly[session.subject] += minutes;
    }
  });

  return totals;
}

function getDailySubjectMinutes(reader, dateKey = selectedDateKey) {
  return getSubjectTotals(reader, dateKey).daily;
}

function getDailySubjectComments(reader, dateKey = selectedDateKey) {
  const comments = Object.fromEntries(SUBJECTS.map((subject) => [subject, ""]));
  const sessions = Array.isArray(reader?.readingSessions) ? reader.readingSessions : [];

  sessions.forEach((session) => {
    if (!SUBJECTS.includes(session.subject)) return;
    if (session.recordDate !== dateKey) return;

    const comment = String(session.comment ?? "").trim();
    if (comment) comments[session.subject] = comment;
  });

  return comments;
}

function getWeekDailySubjectRows(reader, weekValue) {
  return Array.from({ length: 7 }, (_, dayOffset) => {
    const dateKey = getDateKeyFromWeekValue(weekValue, dayOffset);
    const totals = getDailySubjectMinutes(reader, dateKey);
    const comments = getDailySubjectComments(reader, dateKey);
    return {
      dateKey,
      label: formatShortDate(dateKey),
      totals,
      comments,
      total: sumSubjectTotals(totals),
    };
  });
}

function readSubjectMinutes(source) {
  return Object.fromEntries(
    SUBJECTS.map((subject) => [
      subject,
      Math.max(0, readNumber(source.subjectMinutes[subject], 0)),
    ]),
  );
}

function updateSubjectProgress(reader = getCurrentReader(), dateKey = selectedDateKey) {
  const totals = getSubjectTotals(reader, dateKey);
  const goals = getSubjectGoals(reader);
  SUBJECTS.forEach((subject) => {
    const dailyGoal = isWeekend(dateKey) ? goals[subject].weekend : goals[subject].workday;
    const weeklyGoal = goals[subject].workday * 5 + goals[subject].weekend * 2;
    subjectProgress.daily[subject].textContent = `${totals.daily[subject]} / ${dailyGoal} min`;
    subjectProgress.weekly[subject].textContent = `${totals.weekly[subject]} / ${weeklyGoal} min`;
  });
}

function updateProgress(reader = getCurrentReader(), dateKey = selectedDateKey) {
  const { today, weekly, dailyGoal, weeklyGoal } = getProgressValues(reader, dateKey);

  progress.dailyText.textContent = `${today} / ${dailyGoal} min`;
  progress.weeklyText.textContent = `${weekly} / ${weeklyGoal} min`;

  updateMeter(progress.dailyMeter, today, dailyGoal);
  updateMeter(progress.weeklyMeter, weekly, weeklyGoal);
}

function updateRankPill() {
  const ranked = getRankedReaders();
  const currentIndex = ranked.findIndex((reader) => reader.id === state.currentReaderId);
  readerRank.textContent = currentIndex >= 0 ? `Rank #${currentIndex + 1}` : `${ranked.length} readers`;
}

function previewReaderProgress(reader) {
  updateProgress(reader);
  updateSubjectProgress(reader);
  readerRank.textContent = reader ? `${reader.name}'s goals` : "Add a reader";
}

function restoreCurrentProgress() {
  updateProgress();
  updateSubjectProgress();
  updateRankPill();
}

function updateLeaderboard() {
  const ranked = getRankedReaders();
  leaderboardList.innerHTML = "";

  if (!ranked.length) {
    const emptyRow = document.createElement("li");
    emptyRow.className = "empty-row";
    emptyRow.textContent = "No readers yet";
    leaderboardList.append(emptyRow);
    readerRank.textContent = "Add a reader";
    return;
  }

  ranked.forEach((reader, index) => {
    const row = document.createElement("li");
    row.className = `leader-row${reader.id === state.currentReaderId ? " current-reader" : ""}`;
    row.dataset.readerId = reader.id;

    const place = document.createElement("span");
    place.className = "place";
    place.textContent = index + 1;

    const details = document.createElement("span");
    details.className = "reader-details";
    const name = document.createElement("span");
    name.className = "reader-name";
    name.textContent = reader.name;

    const weekRecordButton = document.createElement("button");
    weekRecordButton.className = "week-record-button";
    weekRecordButton.type = "button";
    weekRecordButton.dataset.readerId = reader.id;
    weekRecordButton.setAttribute("aria-label", `View weekly subject records for ${reader.name}`);
    weekRecordButton.title = `View weekly subject records for ${reader.name}`;
    weekRecordButton.textContent = "Week";

    details.append(name, weekRecordButton);

    const score = document.createElement("span");
    score.className = "score";
    score.textContent = scoreReader(reader);

    const goalsButton = document.createElement("button");
    goalsButton.className = "goals-reader-button";
    goalsButton.type = "button";
    goalsButton.dataset.readerId = reader.id;
    goalsButton.setAttribute("aria-label", `Update reading goals for ${reader.name}`);
    goalsButton.title = `Update reading goals for ${reader.name}`;
    goalsButton.textContent = "Goals";

    const updateButton = document.createElement("button");
    updateButton.className = "update-reader-button";
    updateButton.type = "button";
    updateButton.dataset.readerId = reader.id;
    updateButton.setAttribute("aria-label", `Update reading record for ${reader.name}`);
    updateButton.title = `Update reading record for ${reader.name}`;
    updateButton.textContent = "Update";

    const removeButton = document.createElement("button");
    removeButton.className = "remove-reader-button";
    removeButton.type = "button";
    removeButton.dataset.readerId = reader.id;
    removeButton.setAttribute("aria-label", `Delete ${reader.name}`);
    removeButton.title = `Delete ${reader.name}`;
    removeButton.textContent = "Delete";

    const actions = document.createElement("span");
    actions.className = "reader-actions";
    actions.append(goalsButton, updateButton, removeButton);

    row.append(place, details, score, actions);
    leaderboardList.append(row);
  });

  updateRankPill();
}

function updateTimerReaderOptions() {
  const selectedName = timerReaderName.value;
  timerReaderName.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.readers.length ? "Choose a reader" : "No readers yet";
  timerReaderName.append(placeholder);

  state.readers.forEach((reader) => {
    const option = document.createElement("option");
    option.value = reader.name;
    option.textContent = reader.name;
    timerReaderName.append(option);
  });

  const selectedReader = state.readers.find((reader) => reader.name === selectedName);
  const currentReader = getCurrentReader();
  timerReaderName.value = selectedReader?.name ?? currentReader?.name ?? "";
  startTimerButton.disabled = !state.readers.length || !!timerStartedAt || timerStopping;
  commentSessionButton.disabled = !state.readers.length;
}

function render() {
  updateProgress();
  updateSubjectProgress();
  updateLeaderboard();
  updateTimerReaderOptions();
}

function clearReaderFields() {
  fields.name.value = "";
  fields.password.value = "admin";
  fields.name.focus();
}

function openGoalsModal(reader) {
  state.currentReaderId = reader.id;
  render();

  goalsModalFields.name.value = reader.name;
  const subjectGoals = getSubjectGoals(reader);
  SUBJECTS.forEach((subject) => {
    goalsModalFields.subjectGoals[subject].workday.value = subjectGoals[subject].workday;
    goalsModalFields.subjectGoals[subject].weekend.value = subjectGoals[subject].weekend;
  });
  goalsModalMessage.textContent = "";
  goalsModal.hidden = false;
  goalsModalFields.subjectGoals.English.workday.focus();
}

function closeGoalsModal() {
  goalsModal.hidden = true;
  goalsModalMessage.textContent = "";
}

function fillRecordModalForDate(reader, dateKey) {
  recordModalFields.date.value = dateKey;
  const subjectMinutes = getDailySubjectMinutes(reader, dateKey);
  SUBJECTS.forEach((subject) => {
    recordModalFields.subjectMinutes[subject].value = subjectMinutes[subject];
  });
}

function openRecordModal(reader) {
  state.currentReaderId = reader.id;
  render();

  recordModalFields.name.value = reader.name;
  fillRecordModalForDate(reader, selectedDateKey);
  recordModalMessage.textContent = "";
  recordModal.hidden = false;
  recordModalFields.subjectMinutes.English.focus();
}

function closeRecordModal() {
  recordModal.hidden = true;
  recordModalMessage.textContent = "";
  recordModalFields.password = "";
}

function fillCommentModalForDate(reader, dateKey) {
  commentModalFields.date.value = dateKey;
  const subjectComments = getDailySubjectComments(reader, dateKey);
  commentModalFields.text.value = subjectComments[commentModalFields.subject.value] ?? "";
}

function openCommentModal(reader) {
  state.currentReaderId = reader.id;
  render();

  commentModalFields.name.value = reader.name;
  commentModalFields.subject.value = SUBJECTS.includes(timerActiveSubject) ? timerActiveSubject : "English";
  fillCommentModalForDate(reader, selectedDateKey);
  commentModalMessage.textContent = "";
  commentModal.hidden = false;
  commentModalFields.subject.focus();
}

function closeCommentModal() {
  commentModal.hidden = true;
  commentModalMessage.textContent = "";
}

function renderWeekRecordTable() {
  const reader = state.readers.find((item) => item.id === weekRecordReaderId.value);
  if (!reader || !weekRecordWeek.value) return;

  const rows = getWeekDailySubjectRows(reader, weekRecordWeek.value);
  renderWeekSubjectSummary(reader, rows);
  renderWeekRecordChart(reader, rows);

  weekRecordBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const values = [
      row.label,
      ...SUBJECTS.map((subject) => `${row.totals[subject]} min`),
      `${row.total} min`,
      SUBJECTS.map((subject) => {
        return row.comments[subject] ? `${subject}: ${row.comments[subject]}` : "";
      }).filter(Boolean).join("; ") || "-",
    ];

    values.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      cell.textContent = value;
      tr.append(cell);
    });

    weekRecordBody.append(tr);
  });
}

function renderWeekSubjectSummary(reader, rows) {
  weekSubjectSummary.innerHTML = "";
  const goals = getSubjectGoals(reader);

  SUBJECTS.forEach((subject) => {
    const weeklyRead = rows.reduce((total, row) => total + row.totals[subject], 0);
    const weeklyGoal = goals[subject].workday * 5 + goals[subject].weekend * 2;
    const weeklyPercent = weeklyGoal ? Math.round((weeklyRead / weeklyGoal) * 100) : 0;

    const item = document.createElement("article");
    item.className = "week-subject-summary-item";

    const header = document.createElement("div");
    header.className = "week-subject-summary-header";
    const name = document.createElement("strong");
    name.textContent = subject;
    const value = document.createElement("span");
    value.textContent = `${weeklyRead} / ${weeklyGoal} min (${weeklyPercent}%)`;
    header.append(name, value);

    const meter = document.createElement("div");
    meter.className = "week-subject-summary-meter";
    const fill = document.createElement("span");
    updateMeter(fill, weeklyRead, weeklyGoal);
    meter.append(fill);

    item.append(header, meter);
    weekSubjectSummary.append(item);
  });
}

function renderWeekRecordChart(reader, rows) {
  weekRecordChart.innerHTML = "";
  const goals = getSubjectGoals(reader);

  SUBJECTS.forEach((subject) => {
    const panel = document.createElement("article");
    panel.className = `subject-histogram ${subjectId(subject)}-histogram`;

    const title = document.createElement("h3");
    title.textContent = subject;

    const bars = document.createElement("div");
    bars.className = "subject-histogram-bars";

    rows.forEach((row) => {
      const goal = isWeekend(row.dateKey) ? goals[subject].weekend : goals[subject].workday;
      const minutes = row.totals[subject];
      const percent = goal ? Math.round((minutes / goal) * 100) : 0;
      const cappedPercent = Math.min(100, percent);
      const comment = String(row.comments[subject] ?? "").trim();

      const item = document.createElement("div");
      item.className = "subject-histogram-day";

      const percentLabel = document.createElement("strong");
      percentLabel.textContent = `${percent}%`;

      const barTrack = document.createElement("div");
      barTrack.className = "subject-histogram-track";
      barTrack.title = comment
        ? `${row.label}: ${minutes} / ${goal} min (${percent}%)\n${comment}`
        : `${row.label}: ${minutes} / ${goal} min (${percent}%)`;
      if (comment) {
        barTrack.dataset.comment = comment;
        barTrack.dataset.commentMeta = `${subject} · ${row.label}`;
        barTrack.tabIndex = 0;
      }

      const bar = document.createElement("span");
      bar.className = "subject-histogram-fill";
      bar.style.height = `${cappedPercent}%`;
      bar.dataset.progressTone = getProgressTone(minutes, goal);
      bar.setAttribute(
        "aria-label",
        comment
          ? `${subject} ${row.label}: ${minutes} of ${goal} minutes. Comment: ${comment}`
          : `${subject} ${row.label}: ${minutes} of ${goal} minutes`,
      );
      barTrack.append(bar);

      const dayLabel = document.createElement("span");
      dayLabel.className = "subject-histogram-day-label";
      dayLabel.textContent = row.label;

      const minutesLabel = document.createElement("span");
      minutesLabel.className = "subject-histogram-minutes";
      minutesLabel.textContent = `${minutes}/${goal}m`;

      item.append(percentLabel, barTrack, dayLabel, minutesLabel);
      bars.append(item);
    });

    panel.append(title, bars);
    weekRecordChart.append(panel);
  });
}

function openWeekRecordModal(reader) {
  state.currentReaderId = reader.id;
  render();

  weekRecordReaderId.value = reader.id;
  weekRecordReaderName.textContent = reader.name;
  weekRecordWeek.value = getIsoWeekValue(selectedDateKey);
  renderWeekRecordTable();
  weekRecordModal.hidden = false;
  weekRecordWeek.focus();
}

function closeWeekRecordModal() {
  weekRecordModal.hidden = true;
}

function openWeekCommentModal(meta, comment) {
  weekCommentMeta.textContent = meta;
  weekCommentText.textContent = comment;
  weekCommentModal.hidden = false;
  closeWeekCommentModalButton.focus();
}

function closeWeekCommentModal() {
  weekCommentModal.hidden = true;
  weekCommentMeta.textContent = "";
  weekCommentText.textContent = "";
}

function configureServerOnlyControls() {
  resetButton.hidden = !isServerSideBrowser();
}

async function loadServerInfo() {
  if (!isServerSideBrowser() || !serverUrlCard || !serverUrlText) return;

  try {
    const response = await fetch(SERVER_INFO_URL);
    if (!response.ok) throw new Error("Unable to load server info");

    const info = await response.json();
    if (!info.isServer) return;

    serverUrlText.textContent = info.networkUrl || info.localUrl || window.location.origin;
    serverUrlCard.hidden = false;
  } catch {
    serverUrlText.textContent = `${window.location.origin}/`;
    serverUrlCard.hidden = false;
  }
}

async function loadReaders() {
  const response = await fetch(API_URL);
  if (!response.ok) throw new Error("Unable to load readers");
  const data = await response.json();

  state = {
    currentReaderId: data.currentReaderId ?? null,
    readers: Array.isArray(data.readers) ? data.readers : [],
  };
  render();
}

async function addReader(reader) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reader),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? "Unable to save reader");
  }
  return response.json();
}

async function clearReaders() {
  const response = await fetch(API_URL, { method: "DELETE" });
  if (!response.ok) throw new Error("Unable to clear readers");
  return response.json();
}

async function updateGoals(readerName, goals) {
  const response = await fetch(`${API_URL}/${encodeURIComponent(readerName)}/goals`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goals }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? "Unable to update goals");
  }
  return response.json();
}

async function updateReadingRecord(readerName, recordDate, subjectMinutes, subjectComments, password) {
  const response = await fetch(`${API_URL}/${encodeURIComponent(readerName)}/today`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordDate, subjectMinutes, subjectComments, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? "Unable to update reading record");
  }
  return response.json();
}

async function updateReadingComments(readerName, recordDate, subjectComments) {
  const response = await fetch(`${API_URL}/${encodeURIComponent(readerName)}/today`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordDate, subjectComments }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? "Unable to update comments");
  }
  return response.json();
}

async function addReadingSession(readerName, minutes, subject) {
  const response = await fetch(`${API_URL}/${encodeURIComponent(readerName)}/reading-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minutes, recordDate: getLocalDateKey(), subject }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? "Unable to save reading time");
  }
  return response.json();
}

async function removeReader(readerId, password) {
  const response = await fetch(`${API_URL}/${encodeURIComponent(readerId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? "Unable to remove reader");
  }
  return response.json();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = fields.name.value.trim();
  if (!name) {
    fields.name.focus();
    return;
  }

  if (state.readers.some((reader) => normalizeName(reader.name) === normalizeName(name))) {
    readerRank.textContent = "Name already exists";
    fields.name.focus();
    return;
  }

  const newReader = {
    id: createReaderId(),
    name,
    password: fields.password.value || "admin",
    goals: {
      subjects: getSubjectGoals(),
    },
    recordDate: selectedDateKey,
    todayMinutes: 0,
    weekMinutes: 0,
    monthBooks: 0,
  };

  try {
    const data = await addReader(newReader);
    state = {
      currentReaderId: data.currentReaderId,
      readers: data.readers,
    };
    render();
    clearReaderFields();
  } catch (error) {
    readerRank.textContent = getErrorMessage(error, "Save failed");
  }
});

startTimerButton.addEventListener("click", () => {
  const name = timerReaderName.value.trim();
  if (!name) {
    timerReaderName.focus();
    return;
  }

  openSubjectModal();
});

commentSessionButton.addEventListener("click", () => {
  const name = timerActiveReaderName || timerReaderName.value.trim();
  const reader = state.readers.find((item) => item.name === name);
  if (!reader) {
    timerReaderName.focus();
    return;
  }

  openCommentModal(reader);
});

stopTimerButton.addEventListener("click", async () => {
  if (!timerStartedAt || timerStopping) return;

  const name = timerActiveReaderName;
  const subject = timerActiveSubject;
  const elapsedMs = Date.now() - timerStartedAt;

  timerStopping = true;
  window.clearInterval(timerInterval);
  timerInterval = null;
  setTimerRunning(true);
  await waitForActiveTimerSave();

  const elapsedWholeMinutes = Math.floor(elapsedMs / 60000);
  const totalMinutes = timerSavedMinutes > 0 ? elapsedWholeMinutes : Math.max(1, Math.ceil(elapsedMs / 60000));
  const unsavedMinutes = totalMinutes - timerSavedMinutes;
  const saved =
    unsavedMinutes > 0
      ? await saveTimerMinutes(name, unsavedMinutes, subject, `Added ${totalMinutes} min total`)
      : true;

  if (!saved) {
    timerStopping = false;
    setTimerRunning(true);
    return;
  }

  timerStartedAt = null;
  timerActiveReaderName = "";
  timerActiveSubject = "";
  timerStopping = false;
  timerReaderName.disabled = false;
  updateTimerDisplay();
  setTimerRunning(false);

  if (unsavedMinutes <= 0) {
    timerStatus.textContent = `Added ${timerSavedMinutes} min total`;
  }
  timerSavedMinutes = 0;
});

if (isServerSideBrowser()) {
  resetButton.addEventListener("click", async () => {
    try {
      const data = await clearReaders();
      state = {
        currentReaderId: data.currentReaderId,
        readers: data.readers,
      };
      render();
      clearReaderFields();
    } catch {
      readerRank.textContent = "Reset failed";
    }
  });
}

leaderboardList.addEventListener("click", async (event) => {
  const weekRecordButton = event.target.closest(".week-record-button");
  if (weekRecordButton) {
    const reader = state.readers.find((item) => item.id === weekRecordButton.dataset.readerId);
    if (reader) openWeekRecordModal(reader);
    return;
  }

  const goalsButton = event.target.closest(".goals-reader-button");
  if (goalsButton) {
    const reader = state.readers.find((item) => item.id === goalsButton.dataset.readerId);
    if (reader) openGoalsModal(reader);
    return;
  }

  const updateButton = event.target.closest(".update-reader-button");
  if (updateButton) {
    const reader = state.readers.find((item) => item.id === updateButton.dataset.readerId);
    if (!reader) return;

    const password = window.prompt(`Enter password to update ${reader.name}`);
    if (password === null) return;

    recordModalFields.password = password;
    openRecordModal(reader);
    return;
  }

  const button = event.target.closest(".remove-reader-button");
  if (button) {
    const reader = state.readers.find((item) => item.id === button.dataset.readerId);
    if (!reader) return;

    const password = window.prompt(`Enter password to delete ${reader.name}`);
    if (password === null) return;

    try {
      const data = await removeReader(button.dataset.readerId, password);
      state = {
        currentReaderId: data.currentReaderId,
        readers: data.readers,
      };
      render();
    } catch (error) {
      readerRank.textContent = getErrorMessage(error, "Remove failed");
    }
    return;
  }

});

leaderboardList.addEventListener("mouseover", (event) => {
  const row = event.target.closest(".leader-row");
  if (!row || row.contains(event.relatedTarget)) return;

  const reader = state.readers.find((item) => item.id === row.dataset.readerId);
  if (reader) previewReaderProgress(reader);
});

leaderboardList.addEventListener("mouseout", (event) => {
  const row = event.target.closest(".leader-row");
  if (!row || row.contains(event.relatedTarget)) return;

  restoreCurrentProgress();
});

leaderboardList.addEventListener("focusin", (event) => {
  const row = event.target.closest(".leader-row");
  if (!row) return;

  const reader = state.readers.find((item) => item.id === row.dataset.readerId);
  if (reader) previewReaderProgress(reader);
});

leaderboardList.addEventListener("focusout", (event) => {
  const row = event.target.closest(".leader-row");
  if (!row || row.contains(event.relatedTarget)) return;

  restoreCurrentProgress();
});

goalsModalForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const data = await updateGoals(goalsModalFields.name.value, {
      subjects: readSubjectGoals(goalsModalFields),
    });
    state = {
      currentReaderId: data.currentReaderId,
      readers: data.readers,
    };
    render();
    closeGoalsModal();
    readerRank.textContent = "Goals updated";
  } catch (error) {
    goalsModalMessage.textContent = getErrorMessage(error, "Update failed");
  }
});

closeGoalsModalButton.addEventListener("click", closeGoalsModal);
cancelGoalsUpdateButton.addEventListener("click", closeGoalsModal);
goalsModal.addEventListener("click", (event) => {
  if (event.target === goalsModal) closeGoalsModal();
});

recordModalForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const recordDate = recordModalFields.date.value || selectedDateKey;
    const reader = state.readers.find((item) => item.name === recordModalFields.name.value);
    const data = await updateReadingRecord(
      recordModalFields.name.value,
      recordDate,
      readSubjectMinutes(recordModalFields),
      getDailySubjectComments(reader, recordDate),
      recordModalFields.password,
    );
    state = {
      currentReaderId: data.currentReaderId,
      readers: data.readers,
    };
    selectedDateKey = recordDate;
    if (progressDate) progressDate.value = recordDate;
    render();
    closeRecordModal();
    readerRank.textContent = "Record updated";
  } catch (error) {
    recordModalMessage.textContent = getErrorMessage(error, "Update failed");
  }
});

closeRecordModalButton.addEventListener("click", closeRecordModal);
cancelRecordUpdateButton.addEventListener("click", closeRecordModal);
recordModalFields.date.addEventListener("change", () => {
  const reader = state.readers.find((item) => item.name === recordModalFields.name.value);
  if (!reader) return;

  fillRecordModalForDate(reader, recordModalFields.date.value || selectedDateKey);
});
recordModal.addEventListener("click", (event) => {
  if (event.target === recordModal) closeRecordModal();
});

commentModalForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const recordDate = commentModalFields.date.value || selectedDateKey;
    const reader = state.readers.find((item) => item.name === commentModalFields.name.value);
    const subjectComments = getDailySubjectComments(reader, recordDate);
    subjectComments[commentModalFields.subject.value] = commentModalFields.text.value.trim();
    const data = await updateReadingComments(
      commentModalFields.name.value,
      recordDate,
      subjectComments,
    );
    state = {
      currentReaderId: data.currentReaderId,
      readers: data.readers,
    };
    selectedDateKey = recordDate;
    if (progressDate) progressDate.value = recordDate;
    render();
    closeCommentModal();
    readerRank.textContent = "Comments updated";
  } catch (error) {
    commentModalMessage.textContent = getErrorMessage(error, "Update failed");
  }
});

closeCommentModalButton.addEventListener("click", closeCommentModal);
cancelCommentUpdateButton.addEventListener("click", closeCommentModal);
commentModalFields.date.addEventListener("change", () => {
  const reader = state.readers.find((item) => item.name === commentModalFields.name.value);
  if (!reader) return;

  fillCommentModalForDate(reader, commentModalFields.date.value || selectedDateKey);
});
commentModalFields.subject.addEventListener("change", () => {
  const reader = state.readers.find((item) => item.name === commentModalFields.name.value);
  if (!reader) return;

  fillCommentModalForDate(reader, commentModalFields.date.value || selectedDateKey);
});
commentModal.addEventListener("click", (event) => {
  if (event.target === commentModal) closeCommentModal();
});

closeWeekRecordModalButton.addEventListener("click", closeWeekRecordModal);
weekRecordWeek.addEventListener("change", renderWeekRecordTable);
weekRecordChart.addEventListener("dblclick", (event) => {
  const barTrack = event.target.closest(".subject-histogram-track[data-comment]");
  if (!barTrack) return;

  openWeekCommentModal(barTrack.dataset.commentMeta ?? "Comment", barTrack.dataset.comment);
});
weekRecordModal.addEventListener("click", (event) => {
  if (event.target === weekRecordModal) closeWeekRecordModal();
});

closeWeekCommentModalButton.addEventListener("click", closeWeekCommentModal);
weekCommentModal.addEventListener("click", (event) => {
  if (event.target === weekCommentModal) closeWeekCommentModal();
});

subjectModal.addEventListener("click", (event) => {
  if (event.target === subjectModal) {
    closeSubjectModal();
    return;
  }

  const subjectButton = event.target.closest(".subject-button");
  if (subjectButton) startTimerForSubject(subjectButton.dataset.subject);
});

closeSubjectModalButton.addEventListener("click", closeSubjectModal);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (!weekCommentModal.hidden) {
    closeWeekCommentModal();
  } else if (!goalsModal.hidden) {
    closeGoalsModal();
  } else if (!subjectModal.hidden) {
    closeSubjectModal();
  } else if (!recordModal.hidden) {
    closeRecordModal();
  } else if (!commentModal.hidden) {
    closeCommentModal();
  } else if (!weekRecordModal.hidden) {
    closeWeekRecordModal();
  }
});

if (progressDate) {
  progressDate.value = selectedDateKey;
  progressDate.addEventListener("change", () => {
    selectedDateKey = progressDate.value || getLocalDateKey();
    render();
  });
}

configureServerOnlyControls();
loadServerInfo();
loadReaders().catch(() => {
  leaderboardList.innerHTML = "";
  const emptyRow = document.createElement("li");
  emptyRow.className = "empty-row";
  emptyRow.textContent = "Open the page from the server URL";
  leaderboardList.append(emptyRow);
  readerRank.textContent = "Server needed";
});

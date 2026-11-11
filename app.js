(() => {
  "use strict";

  const STORAGE_KEY = "pto-tracker-state-v1";
  const FLEX_CAP_MIN = 108 * 60;
  const STANDARD_CAP_MIN = 160 * 60;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const DEFAULT_STATE = {
    employmentType: "hourly",
    employeeClass: "F",
    payFrequency: "weekly",
    hireDate: "2026-02-02",
    balanceAsOf: "2026-11-11",
    viewDate: "",
    viewDateSelected: false,
    stdMin: 1480,
    flexMin: 2133,
    vacations: []
  };

  const FLEX_RATES = {
    weekly: { F: 1.35, R: 1.32, H: 1 },
    biweekly: { F: 2.7, R: 2.64, H: 2 },
    monthly: { F: 5.84, R: 5.71, H: 4.25 }
  };
  const STD_WEEKLY = {
    F: [0.62, 1.39, 1.54, 1.70, 1.85, 2.00, 2.16],
    R: [0.43, 1.00, 1.12, 1.24, 1.35, 1.47, 1.58],
    H: [0.29, 0.68, 0.75, 0.83, 0.91, 0.99, 1.06]
  };
  const STD_BIWEEKLY_HOURLY = {
    F: [1.24, 2.77, 3.08, 3.39, 3.70, 4.00, 4.31],
    R: [0.85, 2.00, 2.24, 2.47, 2.70, 2.93, 3.16],
    H: [0.58, 1.35, 1.50, 1.66, 1.81, 1.97, 2.12]
  };
  const STD_ANNUAL = {
    F: [32, 72, 80, 88, 96, 104, 112],
    R: [22, 52, 58, 64, 70, 76, 82],
    H: [15, 35, 39, 43, 47, 51, 55]
  };
  const STD_SALARIED_ANNUAL = {
    F: [72, 112, 152],
    R: [52, 82, 112],
    H: [35, 55, 75]
  };
  const STD_SALARIED_BIWEEKLY = {
    F: [2.77, 4.31, 5.85],
    R: [2.00, 3.16, 4.31],
    H: [1.35, 2.12, 2.89]
  };
  const STD_SALARIED_MONTHLY = {
    F: [6.00, 9.34, 12.67],
    R: [4.34, 6.84, 9.34],
    H: [2.92, 4.59, 6.25]
  };

  let state = loadState();
  let lastLiveDate = dateString(new Date());

  function $(id) {
    return document.getElementById(id);
  }

  function safeDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function addYears(date, years) {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() + years);
    return result;
  }

  function yearsOfService(hireDate, date) {
    let years = date.getFullYear() - hireDate.getFullYear();
    const anniversary = addYears(hireDate, years);
    if (date < anniversary) years -= 1;
    return Math.max(0, years);
  }

  function rateIndex(yos) {
    return Math.min(Math.max(0, yos), 6);
  }

  function salariedRateIndex(yos) {
    if (yos <= 0) return 0;
    if (yos <= 5) return 1;
    return 2;
  }

  function standardAnnualHours(currentState, date) {
    const yos = yearsOfService(safeDate(currentState.hireDate), date);
    if (currentState.employmentType === "salaried") {
      return STD_SALARIED_ANNUAL[currentState.employeeClass][salariedRateIndex(yos)];
    }
    return STD_ANNUAL[currentState.employeeClass][rateIndex(yos)];
  }

  function standardRateHours(currentState, date) {
    const yos = yearsOfService(safeDate(currentState.hireDate), date);
    if (currentState.employmentType === "salaried") {
      const index = salariedRateIndex(yos);
      if (currentState.payFrequency === "biweekly") {
        return STD_SALARIED_BIWEEKLY[currentState.employeeClass][index];
      }
      if (currentState.payFrequency === "monthly") {
        return STD_SALARIED_MONTHLY[currentState.employeeClass][index];
      }
      return STD_SALARIED_ANNUAL[currentState.employeeClass][index] / 52;
    }
    if (currentState.payFrequency === "weekly") {
      return STD_WEEKLY[currentState.employeeClass][rateIndex(yos)];
    }
    if (currentState.payFrequency === "biweekly") {
      return STD_BIWEEKLY_HOURLY[currentState.employeeClass][rateIndex(yos)];
    }
    return standardAnnualHours(currentState, date) / 12;
  }

  function flexibleRateHours(currentState) {
    return FLEX_RATES[currentState.payFrequency][currentState.employeeClass];
  }

  function formatMinutes(minutes) {
    const rounded = Math.round(Number(minutes) || 0);
    const sign = rounded < 0 ? "-" : "";
    const absolute = Math.abs(rounded);
    const hours = Math.floor(absolute / 60);
    const mins = absolute % 60;
    return `${sign}${hours}h ${mins}m`;
  }

  function formatHours(hours) {
    return `${Number(hours).toFixed(2).replace(/\.00$/, "")}h`;
  }

  function formatDate(value) {
    const date = safeDate(value);
    if (!date) return value || "";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function normalizeState(raw) {
    const next = { ...DEFAULT_STATE, ...(raw || {}) };
    next.employmentType = next.employmentType === "salaried" ? "salaried" : "hourly";
    next.employeeClass = ["F", "R", "H"].includes(next.employeeClass) ? next.employeeClass : "F";
    next.payFrequency = ["weekly", "biweekly", "monthly"].includes(next.payFrequency) ? next.payFrequency : "weekly";
    next.hireDate = safeDate(next.hireDate) ? next.hireDate : DEFAULT_STATE.hireDate;
    next.balanceAsOf = safeDate(next.balanceAsOf) ? next.balanceAsOf : DEFAULT_STATE.balanceAsOf;
    next.viewDate = safeDate(next.viewDate) ? next.viewDate : "";
    next.viewDateSelected = next.viewDateSelected === true && Boolean(next.viewDate);
    if (!next.viewDateSelected) next.viewDate = "";
    next.stdMin = Math.max(0, Math.round(Number(next.stdMin) || 0));
    next.flexMin = Math.max(0, Math.round(Number(next.flexMin) || 0));
    next.vacations = Array.isArray(next.vacations) ? next.vacations
      .map((item, index) => {
        if (!item || (item.type !== "std" && item.type !== "flex")) return null;
        const startDate = item.startDate || item.date;
        const endDate = item.endDate || item.date || item.startDate;
        const start = safeDate(startDate);
        const end = safeDate(endDate);
        const hoursPerDay = Number(item.hoursPerDay ?? item.hrs);
        if (!start || !end || end < start || !(hoursPerDay > 0)) return null;
        return {
          id: String(item.id || `leave-${index}-${dateString(start)}`).slice(0, 80),
          startDate: dateString(start),
          endDate: dateString(end),
          type: item.type,
          hoursPerDay,
          weekdaysOnly: item.weekdaysOnly === true,
          note: String(item.note || "").slice(0, 120)
        };
      })
      .filter(Boolean) : [];
    return next;
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return normalizeState(saved ? JSON.parse(saved) : DEFAULT_STATE);
    } catch {
      return normalizeState(DEFAULT_STATE);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $("storage-note").textContent = "Saved locally";
    } catch {
      $("storage-note").textContent = "Local storage unavailable";
    }
  }

  function collapseSettings() {
    $("settings-section").classList.add("settings-collapsed");
    $("settings-toggle").style.display = "inline-block";
  }

  function expandSettings() {
    $("settings-section").classList.remove("settings-collapsed");
    $("settings-toggle").style.display = "none";
  }

  function todayDate() {
    return safeDate(dateString(new Date()));
  }

  function addMonths(date, months) {
    const result = new Date(date);
    const originalDay = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + months);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(originalDay, lastDay));
    return result;
  }

  function periodDate(startDate, periodNumber) {
    if (state.payFrequency === "weekly") return addDays(startDate, periodNumber * 7);
    if (state.payFrequency === "biweekly") return addDays(startDate, periodNumber * 14);
    return addMonths(startDate, periodNumber);
  }

  function completedPeriods(startDate, endDate) {
    let periods = 0;
    while (periodDate(startDate, periods + 1) <= endDate) periods += 1;
    return periods;
  }

  function flexibleGrantDates(startDate, endDate) {
    const dates = new Map();
    const hireDate = safeDate(state.hireDate);
    if (hireDate && hireDate > startDate && hireDate <= endDate) dates.set(dateString(hireDate), hireDate);
    for (let year = startDate.getFullYear(); year <= endDate.getFullYear(); year += 1) {
      const newYear = new Date(year, 0, 1);
      if (newYear > startDate && newYear <= endDate) dates.set(dateString(newYear), newYear);
    }
    return [...dates.values()];
  }

  function balanceAt(targetDate) {
    const asOf = safeDate(state.balanceAsOf);
    if (!asOf || !targetDate || targetDate < asOf) return null;

    let std = Math.min(STANDARD_CAP_MIN, state.stdMin);
    let flex = state.flexMin;
    const periods = completedPeriods(asOf, targetDate);
    const events = new Map();

    function eventFor(date) {
      const key = dateString(date);
      if (!events.has(key)) {
        events.set(key, {
          date,
          stdAccrual: 0,
          flexAccrual: 0,
          flexGrant: 0,
          flexRollover: false,
          stdUse: 0,
          flexUse: 0
        });
      }
      return events.get(key);
    }

    for (let period = 1; period <= periods; period += 1) {
      const accrualDate = periodDate(asOf, period);
      const event = eventFor(accrualDate);
      event.stdAccrual += (standardRateHours(state, accrualDate) || 0) * 60;
      event.flexAccrual += flexibleRateHours(state) * 60;
    }

    flexibleGrantDates(asOf, targetDate).forEach(date => {
      const event = eventFor(date);
      if (date.getMonth() === 0 && date.getDate() === 1) event.flexRollover = true;
      event.flexGrant += flexibleGrantHours(state.employeeClass) * 60;
    });

    state.vacations.forEach(leave => {
      leaveUsageDates(leave).forEach(({ date, hours }) => {
        if (date <= asOf || date > targetDate) return;
        const event = eventFor(date);
        if (leave.type === "std") event.stdUse += hours * 60;
        else event.flexUse += hours * 60;
      });
    });

    [...events.values()]
      .sort((a, b) => a.date - b.date)
      .forEach(event => {
        if (event.flexRollover) flex = Math.min(FLEX_CAP_MIN, flex);
        std = Math.min(STANDARD_CAP_MIN, std + event.stdAccrual);
        flex += event.flexAccrual + event.flexGrant;
        std -= event.stdUse;
        flex -= event.flexUse;
      });

    return { std, flex, combined: std + flex, periods };
  }

  function flexibleGrantHours(employeeClass) {
    return { F: 10, R: 7.5, H: 5 }[employeeClass];
  }

  function leaveUsageDates(leave) {
    const start = safeDate(leave.startDate);
    const end = safeDate(leave.endDate);
    if (!start || !end || end < start) return [];
    const dates = [];
    for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
      const day = date.getDay();
      if (!leave.weekdaysOnly || (day !== 0 && day !== 6)) {
        dates.push({ date: new Date(date), hours: Number(leave.hoursPerDay) });
      }
    }
    return dates;
  }

  function leaveDayCount(leave) {
    return leaveUsageDates(leave).length;
  }

  function leaveTotalHours(leave) {
    return leaveDayCount(leave) * Number(leave.hoursPerDay);
  }

  function leaveDateLabel(leave) {
    return leave.startDate === leave.endDate
      ? formatDate(leave.startDate)
      : `${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}`;
  }

  function liveBalance() {
    return balanceAt(todayDate());
  }

  function project(weeks) {
    const targetDate = addDays(todayDate(), weeks * 7);
    return balanceAt(targetDate) || { std: state.stdMin, flex: state.flexMin, combined: state.stdMin + state.flexMin };
  }

  function anniversaryWeek() {
    const today = todayDate();
    const hireDate = safeDate(state.hireDate);
    const anniversary = addYears(hireDate, yearsOfService(hireDate, today) + 1);
    const days = Math.ceil((anniversary - today) / MS_PER_DAY);
    return days > 0 ? Math.ceil(days / 7) : null;
  }

  function fillSettingsForm() {
    $("employmentType").value = state.employmentType;
    $("employeeClass").value = state.employeeClass;
    $("payFrequency").value = state.payFrequency;
    $("hireDate").value = state.hireDate;
    $("balanceAsOf").value = state.balanceAsOf;
    $("balanceAsOf").max = dateString(todayDate());
    $("stdHours").value = Math.floor(state.stdMin / 60);
    $("stdMinutes").value = state.stdMin % 60;
    $("flexHours").value = Math.floor(state.flexMin / 60);
    $("flexMinutes").value = state.flexMin % 60;
  }

  function readSettingsForm() {
    const stdHours = Math.max(0, Number($("stdHours").value) || 0);
    const stdMinutes = Math.min(59, Math.max(0, Number($("stdMinutes").value) || 0));
    const flexHours = Math.max(0, Number($("flexHours").value) || 0);
    const flexMinutes = Math.min(59, Math.max(0, Number($("flexMinutes").value) || 0));
    state = normalizeState({
      ...state,
      employmentType: $("employmentType").value,
      employeeClass: $("employeeClass").value,
      payFrequency: $("payFrequency").value,
      hireDate: $("hireDate").value,
      balanceAsOf: $("balanceAsOf").value,
      stdMin: stdHours * 60 + stdMinutes,
      flexMin: flexHours * 60 + flexMinutes
    });
  }

  function renderBalances() {
    const current = liveBalance();
    const std = current ? current.std : state.stdMin;
    const flex = current ? current.flex : state.flexMin;
    const standardPercent = Math.min(100, Math.max(0, (std / STANDARD_CAP_MIN) * 100));
    const percent = Math.min(100, Math.max(0, (flex / FLEX_CAP_MIN) * 100));
    $("today-label").textContent = formatDate(dateString(todayDate()));
    $("std-balance").textContent = formatMinutes(std);
    $("flex-balance").textContent = formatMinutes(flex);
    $("combined-balance").textContent = formatMinutes(std + flex);
    $("total-balance").textContent = formatMinutes(std + flex);
    $("flex-total-label").textContent = formatMinutes(flex);
    $("std-total-label").textContent = formatMinutes(std);
    $("std-progress").style.width = `${standardPercent}%`;
    $("std-progress").classList.toggle("amber", standardPercent > 90);
    $("std-cap-label").textContent = `${Math.round(standardPercent)}% of 160h balance cap`;
    const total = Math.max(0, std + flex);
    const flexShare = total ? Math.max(0, flex / total) * 100 : 0;
    $("flex-segment").style.width = `${flexShare}%`;
    $("std-segment").style.width = `${Math.max(0, 100 - flexShare)}%`;
    $("flex-progress").style.width = `${percent}%`;
    $("flex-progress").classList.toggle("amber", percent > 90);
    $("flex-cap-label").textContent = `${Math.round(percent)}% of 108h rollover cap`;
    const rate = standardRateHours(state, todayDate());
    const derivedRate = (state.employmentType === "hourly" && state.payFrequency === "monthly")
      || (state.employmentType === "salaried" && state.payFrequency === "weekly");
    $("std-rate").textContent = `Current Standard rate: ${formatHours(rate)} per ${state.payFrequency} pay period${derivedRate ? " (derived)" : ""}`;
    const warnings = [];
    if (!current) warnings.push("Your balance date is in the future, so a live balance is not available yet.");
    if (std < 0 || flex < 0) warnings.push("Not enough PTO for the logged usage.");
    if (std >= STANDARD_CAP_MIN) warnings.push("Standard PTO is at the 160h balance cap; additional accrual may not increase the available balance.");
    if (flex > FLEX_CAP_MIN) warnings.push("Flexible PTO is above the 108h rollover cap; excess will not roll over.");
    $("policy-warning").innerHTML = warnings.length
      ? warnings.map(message => `<div class="notice${message.includes("Not enough") ? " error" : ""}">${message}</div>`).join("")
      : `<div class="notice info">Live balance is calculated from your saved balance date.</div>`;
  }

  function renderSelectedDate() {
    $("viewDate").min = state.balanceAsOf;
    $("viewDate").max = "";
    $("viewDate").value = state.viewDateSelected ? state.viewDate : "";
    if (!state.viewDateSelected || !safeDate(state.viewDate)) {
      $("view-date-copy").textContent = "Choose a date to see your estimated balance. Planned vacation usage is included.";
      $("view-balance-overview").style.display = "none";
      $("view-balance-cards").style.display = "none";
      $("view-total-balance").textContent = "—";
      $("view-flex-segment").style.width = "0%";
      $("view-std-segment").style.width = "0%";
      $("view-flex-total-label").textContent = "—";
      $("view-std-total-label").textContent = "—";
      $("view-std-balance").textContent = "—";
      $("view-flex-balance").textContent = "—";
      $("view-std-progress").style.width = "0%";
      $("view-std-progress").classList.remove("amber");
      $("view-std-cap-label").textContent = "";
      $("view-flex-progress").style.width = "0%";
      $("view-flex-progress").classList.remove("amber");
      $("view-flex-cap-label").textContent = "";
      $("view-date-note").textContent = "";
      $("view-warning").innerHTML = "";
      return;
    }

    const target = safeDate(state.viewDate);
    $("view-date-copy").textContent = `Estimated balance for ${formatDate(state.viewDate)}. Planned vacation usage is included.`;
    $("view-balance-overview").style.display = "";
    $("view-balance-cards").style.display = "";
    const result = balanceAt(target);
    if (!result) {
      $("view-total-balance").textContent = "—";
      $("view-flex-segment").style.width = "0%";
      $("view-std-segment").style.width = "0%";
      $("view-flex-total-label").textContent = "—";
      $("view-std-total-label").textContent = "—";
      $("view-std-balance").textContent = "—";
      $("view-flex-balance").textContent = "—";
      $("view-std-progress").style.width = "0%";
      $("view-std-progress").classList.remove("amber");
      $("view-std-cap-label").textContent = "";
      $("view-flex-progress").style.width = "0%";
      $("view-flex-progress").classList.remove("amber");
      $("view-flex-cap-label").textContent = "";
      $("view-date-note").textContent = `Choose ${formatDate(state.balanceAsOf)} or later.`;
      $("view-warning").innerHTML = `<div class="notice error">The selected date is before the starting balance date.</div>`;
      return;
    }
    $("view-total-balance").textContent = formatMinutes(result.combined);
    $("view-flex-total-label").textContent = formatMinutes(result.flex);
    $("view-std-total-label").textContent = formatMinutes(result.std);
    const total = Math.max(0, result.std + result.flex);
    const flexShare = total ? Math.max(0, result.flex / total) * 100 : 0;
    $("view-flex-segment").style.width = `${flexShare}%`;
    $("view-std-segment").style.width = `${Math.max(0, 100 - flexShare)}%`;
    const standardPercent = Math.min(100, Math.max(0, (result.std / STANDARD_CAP_MIN) * 100));
    $("view-std-progress").style.width = `${standardPercent}%`;
    $("view-std-progress").classList.toggle("amber", standardPercent > 90);
    $("view-std-cap-label").textContent = `${Math.round(standardPercent)}% of 160h balance cap`;
    const percent = Math.min(100, Math.max(0, (result.flex / FLEX_CAP_MIN) * 100));
    $("view-std-balance").textContent = formatMinutes(result.std);
    $("view-flex-balance").textContent = formatMinutes(result.flex);
    $("view-flex-progress").style.width = `${percent}%`;
    $("view-flex-progress").classList.toggle("amber", percent > 90);
    $("view-flex-cap-label").textContent = `${Math.round(percent)}% of 108h rollover cap`;
    $("view-date-note").textContent = `${result.periods} completed ${state.payFrequency} pay period${result.periods === 1 ? "" : "s"} since ${formatDate(state.balanceAsOf)}.`;
    const warnings = [];
    if (result.std < 0 || result.flex < 0) warnings.push("Not enough PTO for the logged usage.");
    if (result.std >= STANDARD_CAP_MIN) warnings.push("Standard PTO is at the 160h balance cap; additional accrual may not increase the available balance.");
    if (result.flex > FLEX_CAP_MIN) warnings.push("Flexible PTO is above the 108h rollover cap; excess will not roll over.");
    $("view-warning").innerHTML = warnings.map(message => `<div class="notice${message.includes("Not enough") ? " error" : ""}">${message}</div>`).join("");
  }

  function renderChart() {
    const svg = $("chart");
    const width = 760;
    const height = 300;
    const left = 52;
    const right = 18;
    const top = 18;
    const bottom = 34;
    const graphWidth = width - left - right;
    const graphHeight = height - top - bottom;
    const points = Array.from({ length: 53 }, (_, week) => ({ week, ...project(week) }));
    const maxValue = Math.max(FLEX_CAP_MIN, ...points.map(point => Math.max(point.std, point.flex, point.combined, 0)));
    const minValue = 0;
    const x = week => left + (week / 52) * graphWidth;
    const y = value => top + graphHeight - ((Math.max(minValue, value) - minValue) / (maxValue - minValue || 1)) * graphHeight;
    const linePath = key => points.map((point, index) => `${index ? "L" : "M"} ${x(point.week).toFixed(1)} ${y(point[key]).toFixed(1)}`).join(" ");
    const grid = [0, .25, .5, .75, 1].map(fraction => {
      const value = maxValue * fraction;
      const yy = y(value);
      return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" stroke="#e5e7eb"/><text x="${left - 8}" y="${yy + 4}" text-anchor="end" fill="#66727d" font-size="11">${Math.round(value / 60)}h</text>`;
    }).join("");
    const xLabels = [0, 13, 26, 39, 52].map(week => `<text x="${x(week)}" y="${height - 8}" text-anchor="middle" fill="#66727d" font-size="11">${week}</text>`).join("");
    const capY = y(FLEX_CAP_MIN);
    const anniv = anniversaryWeek();
    const annivLine = anniv && anniv <= 52
      ? `<line x1="${x(anniv)}" y1="${top}" x2="${x(anniv)}" y2="${top + graphHeight}" stroke="#6b7280" stroke-dasharray="4 4"/><text x="${x(anniv) + 5}" y="${top + 12}" fill="#66727d" font-size="11">1-year</text>`
      : "";
    svg.innerHTML = `
      ${grid}
      <line x1="${left}" y1="${capY}" x2="${width - right}" y2="${capY}" stroke="#a16207" stroke-dasharray="6 4"/>
      ${annivLine}
      <path d="${linePath("std")}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
      <path d="${linePath("flex")}" fill="none" stroke="#059669" stroke-width="2.5"/>
      <path d="${linePath("combined")}" fill="none" stroke="#7c3aed" stroke-width="2.5"/>
      ${xLabels}
      <text x="${width - right}" y="${height - 8}" text-anchor="end" fill="#66727d" font-size="11">weeks from now</text>
    `;
  }

  function renderVacations() {
    const sorted = [...state.vacations].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const stdTotal = sorted.filter(item => item.type === "std").reduce((sum, item) => sum + leaveTotalHours(item), 0);
    const flexTotal = sorted.filter(item => item.type === "flex").reduce((sum, item) => sum + leaveTotalHours(item), 0);
    $("vacation-summary").textContent = sorted.length
      ? `Logged total: ${formatHours(stdTotal)} Standard, ${formatHours(flexTotal)} Flexible`
      : "No vacations logged.";
    $("vacations").innerHTML = sorted.length ? sorted.map(item => {
      const after = balanceAt(safeDate(item.endDate));
      const balanceAfter = after
        ? `<span class="balance-line${after.std < 0 ? " balance-negative" : ""}">Std ${formatMinutes(after.std)}</span><span class="balance-line${after.flex < 0 ? " balance-negative" : ""}">Flex ${formatMinutes(after.flex)}</span>`
        : `<span class="muted">Before starting balance</span>`;
      const dayCount = leaveDayCount(item);
      const isMultiDay = item.startDate !== item.endDate;
      const dayLabel = isMultiDay
        ? `${dayCount} ${dayCount === 1 ? "day" : "days"} · ${formatHours(leaveTotalHours(item))}`
        : formatHours(leaveTotalHours(item));
      const scheduleLabel = item.weekdaysOnly ? "Weekdays only" : "Every day";
      const schedule = isMultiDay ? `<small class="leave-schedule">${scheduleLabel}</small>` : "";
      const perDay = isMultiDay ? `<small class="leave-schedule">${formatHours(item.hoursPerDay)}/day</small>` : "";
      return `<tr><td>${leaveDateLabel(item)}${schedule}</td><td>${item.type === "std" ? "Standard" : "Flexible"}</td><td>${dayLabel}${perDay}</td><td class="balance-cell">${balanceAfter}</td><td>${escapeHtml(item.note)}</td><td class="right"><button class="danger small-button" type="button" data-remove="${escapeHtml(item.id)}">Remove</button></td></tr>`;
    }).join("") : `<tr><td colspan="6" class="empty">Add planned vacation to include it in projections.</td></tr>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function render() {
    fillSettingsForm();
    renderBalances();
    renderSelectedDate();
    renderChart();
    renderVacations();
  }

  $("settings-form").addEventListener("submit", event => {
    event.preventDefault();
    readSettingsForm();
    saveState();
    render();
    collapseSettings();
    $("settings-status").textContent = "Saved.";
    setTimeout(() => { $("settings-status").textContent = ""; }, 2500);
  });

  $("settings-toggle").addEventListener("click", expandSettings);

  const vacationModal = $("vacation-modal");

  function openVacationModal(focusForm) {
    if (!vacationModal.open) vacationModal.showModal();
    if (focusForm) {
      setTimeout(() => $("vacationStartDate").focus(), 0);
    }
  }

  $("add-vacation-button").addEventListener("click", () => openVacationModal(true));
  $("vacation-close").addEventListener("click", () => vacationModal.close());
  vacationModal.addEventListener("click", event => {
    if (event.target === vacationModal) vacationModal.close();
  });

  function newLeaveId() {
    return `leave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function vacationFormLeave() {
    const isMultiDay = $("vacationMultiDay").checked;
    const startDate = $("vacationStartDate").value;
    const endDate = isMultiDay ? $("vacationEndDate").value : startDate;
    const start = safeDate(startDate);
    const end = safeDate(endDate);
    const hours = Math.max(0, Number($("vacationHoursPerDay").value) || 0);
    const minutes = isMultiDay ? 0 : Math.min(59, Math.max(0, Number($("vacationMinutes").value) || 0));
    const hoursPerDay = isMultiDay ? hours : hours + (minutes / 60);
    if (!start || !end || !(hoursPerDay > 0)) return null;
    return {
      startDate,
      endDate,
      type: $("vacationType").value,
      hoursPerDay,
      weekdaysOnly: isMultiDay && $("vacationWeekdaysOnly").checked,
      note: $("vacationNote").value.trim().slice(0, 120)
    };
  }

  function leaveRangesOverlap(first, second) {
    return first.startDate <= second.endDate && second.startDate <= first.endDate;
  }

  function overlapsExistingLeave(candidate) {
    return state.vacations.some(existing => leaveRangesOverlap(candidate, existing));
  }

  function renderVacationPreview() {
    const preview = $("vacation-preview");
    const isMultiDay = $("vacationMultiDay").checked;
    const startDate = $("vacationStartDate").value;
    const endDate = isMultiDay ? $("vacationEndDate").value : startDate;
    const start = safeDate(startDate);
    const end = safeDate(endDate);
    $("vacationEndDate").min = startDate || "";
    preview.classList.remove("warning");

    if (!start || !end) {
      preview.textContent = isMultiDay
        ? "Choose dates to preview this leave."
        : "Choose a date to preview this leave.";
      return;
    }
    if (end < start) {
      preview.textContent = "End date must be on or after the start date.";
      preview.classList.add("warning");
      return;
    }

    const leave = vacationFormLeave();
    if (!leave) {
      preview.textContent = isMultiDay
        ? "Enter hours per day to preview this leave."
        : "Enter a PTO duration to preview this leave.";
      preview.classList.add("warning");
      return;
    }
    const dayCount = leaveDayCount(leave);
    const totalHours = leaveTotalHours(leave);
    const typeLabel = leave.type === "std" ? "Standard" : "Flexible";
    const scheduleLabel = leave.weekdaysOnly ? "weekdays only" : "every day";
    const overlapWarning = overlapsExistingLeave(leave)
      ? " This overlaps an existing planned leave."
      : "";
    if (!dayCount) {
      preview.textContent = `${leaveDateLabel(leave)} has no ${scheduleLabel} leave days.`;
      preview.classList.add("warning");
      return;
    }
    preview.textContent = isMultiDay
      ? `${leaveDateLabel(leave)} · ${dayCount} ${dayCount === 1 ? "day" : "days"} × ${formatHours(leave.hoursPerDay)} = ${formatHours(totalHours)} ${typeLabel} PTO (${scheduleLabel}).${overlapWarning}`
      : `${leaveDateLabel(leave)} · ${formatHours(totalHours)} ${typeLabel} PTO.${overlapWarning}`;
    if (overlapWarning) preview.classList.add("warning");
  }

  function syncVacationMode() {
    const isMultiDay = $("vacationMultiDay").checked;
    $("vacation-form").classList.toggle("is-multi-day", isMultiDay);
    $("vacation-end-date-field").classList.add("multi-day-only");
    $("vacation-weekdays-field").classList.add("multi-day-only");
    $("vacation-end-date-field").classList.toggle("is-hidden", !isMultiDay);
    $("vacation-weekdays-field").classList.toggle("is-hidden", !isMultiDay);
    $("vacationEndDate").required = isMultiDay;
    $("vacationEndDate").disabled = !isMultiDay;
    $("vacationWeekdaysOnly").disabled = !isMultiDay;
    $("vacationMinutes").disabled = isMultiDay;
    $("vacation-minutes-field").classList.toggle("is-hidden", isMultiDay);
    $("vacation-date-label").textContent = isMultiDay ? "Start date" : "Date";
    $("vacation-hours-label").textContent = isMultiDay ? "Hours per day" : "Hours";
    $("vacationHoursPerDay").step = isMultiDay ? "0.25" : "1";
    $("vacationHoursPerDay").min = isMultiDay ? "0.25" : "0";
    if (!isMultiDay) {
      $("vacationEndDate").value = $("vacationStartDate").value;
      $("vacationWeekdaysOnly").checked = false;
    } else if (!$("vacationEndDate").value) {
      $("vacationEndDate").value = $("vacationStartDate").value;
    }
    renderVacationPreview();
  }

  function resetVacationForm() {
    $("vacation-form").reset();
    const today = dateString(todayDate());
    $("vacationMultiDay").checked = false;
    $("vacationStartDate").value = today;
    $("vacationEndDate").value = today;
    $("vacationHoursPerDay").value = "8";
    $("vacationMinutes").value = "0";
    syncVacationMode();
  }

  ["vacationStartDate", "vacationEndDate", "vacationType", "vacationHoursPerDay", "vacationMinutes", "vacationWeekdaysOnly", "vacationNote"]
    .forEach(id => $(id).addEventListener("input", renderVacationPreview));

  $("vacationMultiDay").addEventListener("change", syncVacationMode);
  $("vacationStartDate").addEventListener("change", () => {
    if (!$("vacationMultiDay").checked) $("vacationEndDate").value = $("vacationStartDate").value;
  });

  $("viewDate").addEventListener("change", event => {
    state.viewDate = event.target.value;
    state.viewDateSelected = Boolean(event.target.value);
    saveState();
    renderSelectedDate();
  });

  function refreshIfDateChanged() {
    const currentDate = dateString(new Date());
    if (currentDate === lastLiveDate) return;
    lastLiveDate = currentDate;
    renderBalances();
    renderSelectedDate();
    renderChart();
  }

  window.addEventListener("focus", refreshIfDateChanged);
  setInterval(refreshIfDateChanged, 60000);

  $("vacation-form").addEventListener("submit", event => {
    event.preventDefault();
    const leave = vacationFormLeave();
    const start = leave && safeDate(leave.startDate);
    const end = leave && safeDate(leave.endDate);
    if (!leave || !start || !end || end < start || !leaveDayCount(leave)) {
      $("vacation-status").textContent = "Choose a valid date range with at least one leave day.";
      return;
    }
    const overlapping = overlapsExistingLeave(leave);
    state.vacations.push({ ...leave, id: newLeaveId() });
    saveState();
    render();
    const after = balanceAt(end);
    resetVacationForm();
    $("vacation-status").textContent = overlapping
      ? "Vacation added. It overlaps an existing planned leave."
      : after && (after.std < 0 || after.flex < 0)
        ? "Vacation added. Balance warning: not enough PTO after this leave."
        : "Vacation added.";
    setTimeout(() => { $("vacation-status").textContent = ""; }, 2500);
  });

  $("vacations").addEventListener("click", event => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    state.vacations = state.vacations.filter(item => item.id !== button.dataset.remove);
    saveState();
    render();
  });

  $("export-button").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pto-tracker-state.json";
    link.click();
    URL.revokeObjectURL(url);
    $("backup-status").textContent = "Exported.";
    setTimeout(() => { $("backup-status").textContent = ""; }, 2500);
  });

  $("import-file").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = normalizeState(JSON.parse(reader.result));
        saveState();
        render();
        collapseSettings();
        $("backup-status").textContent = "Imported.";
      } catch {
        $("backup-status").textContent = "That file could not be imported.";
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  });

  $("reset-button").addEventListener("click", () => {
    if (!confirm("Reset all local PTO data to the default values?")) return;
    state = normalizeState(DEFAULT_STATE);
    saveState();
    render();
    collapseSettings();
    $("backup-status").textContent = "Reset.";
  });

  resetVacationForm();
  render();
  try {
    if (localStorage.getItem(STORAGE_KEY)) collapseSettings();
    else expandSettings();
  } catch {
    expandSettings();
  }
})();

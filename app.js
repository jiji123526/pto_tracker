(() => {
  "use strict";

  const STORAGE_KEY = "pto-tracker-state-v1";
  const FLEX_CAP_MIN = 108 * 60;
  const STANDARD_CAP_MIN = 160 * 60;
  const BALANCE_PLACEHOLDER = "0 h";
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const WEEKLY_ACCRUAL_WEEKDAY = 6; // Saturday; JavaScript uses Sunday = 0.
  const DEFAULT_STATE = {
    configured: false,
    employmentType: "",
    employeeClass: "",
    payFrequency: "",
    hireDate: "",
    balanceAsOf: "",
    viewDate: "",
    viewDateSelected: false,
    stdMin: 0,
    flexMin: 0,
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

  function defaultBalanceDate(payFrequency, referenceDate = todayDate()) {
    if (!referenceDate || (payFrequency !== "weekly" && payFrequency !== "biweekly")) {
      return referenceDate ? dateString(referenceDate) : dateString(new Date());
    }
    const daysSinceSaturday = (referenceDate.getDay() - WEEKLY_ACCRUAL_WEEKDAY + 7) % 7;
    return dateString(addDays(referenceDate, -daysSinceSaturday));
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
    const source = raw || {};
    const next = { ...DEFAULT_STATE, ...source };
    const hasCompleteSettings = Boolean(
      safeDate(source.hireDate)
      && ["hourly", "salaried"].includes(source.employmentType)
      && ["F", "R", "H"].includes(source.employeeClass)
      && ["weekly", "biweekly", "monthly"].includes(source.payFrequency)
    );
    next.configured = source.configured === true || hasCompleteSettings;
    next.employmentType = ["hourly", "salaried"].includes(next.employmentType) ? next.employmentType : "";
    next.employeeClass = ["F", "R", "H"].includes(next.employeeClass) ? next.employeeClass : "";
    next.payFrequency = ["weekly", "biweekly", "monthly"].includes(next.payFrequency) ? next.payFrequency : "";
    next.hireDate = safeDate(next.hireDate) ? next.hireDate : "";
    const currentDate = dateString(new Date());
    const fallbackBalanceDate = defaultBalanceDate(next.payFrequency, safeDate(currentDate));
    const savedBalanceDate = safeDate(next.balanceAsOf);
    const currentDateIsUnanchored = savedBalanceDate
      && dateString(savedBalanceDate) === currentDate
      && (next.payFrequency === "weekly" || next.payFrequency === "biweekly");
    next.balanceAsOf = savedBalanceDate
      && savedBalanceDate <= safeDate(currentDate)
      && !currentDateIsUnanchored
      ? dateString(savedBalanceDate)
      : fallbackBalanceDate;
    next.viewDate = safeDate(next.viewDate) && next.viewDate >= currentDate ? next.viewDate : "";
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

  function nextWeekdayAfter(startDate, weekday) {
    let date = addDays(startDate, 1);
    const offset = (weekday - date.getDay() + 7) % 7;
    return addDays(date, offset);
  }

  function lastSaturdayOfMonth(year, month) {
    const lastDay = new Date(year, month + 1, 0);
    const daysSinceSaturday = (lastDay.getDay() - WEEKLY_ACCRUAL_WEEKDAY + 7) % 7;
    return addDays(lastDay, -daysSinceSaturday);
  }

  function accrualDates(startDate, endDate) {
    if (!startDate || !endDate || endDate <= startDate) return [];
    const dates = [];
    if (state.payFrequency === "weekly" || state.payFrequency === "biweekly") {
      const step = state.payFrequency === "biweekly" ? 14 : 7;
      for (
        let date = nextWeekdayAfter(startDate, WEEKLY_ACCRUAL_WEEKDAY);
        date <= endDate;
        date = addDays(date, step)
      ) {
        dates.push(date);
      }
      return dates;
    }

    const monthCursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    for (
      let month = monthCursor;
      month <= endDate;
      month = new Date(month.getFullYear(), month.getMonth() + 1, 1)
    ) {
      const date = lastSaturdayOfMonth(month.getFullYear(), month.getMonth());
      if (date > startDate && date <= endDate) dates.push(date);
    }
    return dates;
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

  function balanceAt(targetDate, includeLeave = true) {
    const asOf = safeDate(state.balanceAsOf) || todayDate();
    if (!state.configured || !targetDate || targetDate < asOf) return null;

    let std = Math.min(STANDARD_CAP_MIN, state.stdMin);
    let flex = state.flexMin;
    const periods = accrualDates(asOf, targetDate);
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

    periods.forEach(accrualDate => {
      const event = eventFor(accrualDate);
      event.stdAccrual += (standardRateHours(state, accrualDate) || 0) * 60;
      event.flexAccrual += flexibleRateHours(state) * 60;
    });

    flexibleGrantDates(asOf, targetDate).forEach(date => {
      const event = eventFor(date);
      if (date.getMonth() === 0 && date.getDate() === 1) event.flexRollover = true;
      event.flexGrant += flexibleGrantHours(state.employeeClass) * 60;
    });

    state.vacations.forEach(leave => {
      if (!includeLeave) return;
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

    return { std, flex, combined: std + flex, periods: periods.length };
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

  function nextAnniversaryMarker() {
    const today = todayDate();
    const hireDate = safeDate(state.hireDate);
    if (!state.configured || !hireDate) return null;
    const anniversaryYears = yearsOfService(hireDate, today) + 1;
    const anniversary = addYears(hireDate, anniversaryYears);
    const weeks = (anniversary - today) / (7 * MS_PER_DAY);
    return weeks > 0 ? { weeks, years: anniversaryYears } : null;
  }

  function nextNewYearMarker() {
    const today = todayDate();
    const newYear = new Date(today.getFullYear() + 1, 0, 1);
    return {
      date: newYear,
      weeks: (newYear - today) / (7 * MS_PER_DAY)
    };
  }

  function plannedLeaveBands() {
    const today = todayDate();
    const projectionEnd = addDays(today, 52 * 7);
    const bands = [];

    state.vacations.forEach(leave => {
      const dates = leaveUsageDates(leave)
        .map(item => item.date)
        .filter(date => date > today && date <= projectionEnd)
        .sort((first, second) => first - second);
      if (!dates.length) return;

      let start = dates[0];
      let end = dates[0];
      for (let index = 1; index < dates.length; index += 1) {
        const date = dates[index];
        if ((date - end) / MS_PER_DAY <= 1) {
          end = date;
        } else {
          bands.push({ leave, start, end });
          start = date;
          end = date;
        }
      }
      bands.push({ leave, start, end });
    });

    return bands;
  }

  function plannedLeaveTotals() {
    const today = todayDate();
    return state.vacations.reduce((totals, leave) => {
      leaveUsageDates(leave).forEach(({ date, hours }) => {
        if (date < today) return;
        totals[leave.type] += hours * 60;
      });
      return totals;
    }, { std: 0, flex: 0 });
  }

  function fillSettingsForm() {
    $("employmentType").value = state.employmentType || "";
    $("employeeClass").value = state.employeeClass || "";
    $("payFrequency").value = state.payFrequency || "";
    $("hireDate").value = state.hireDate;
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
    const payFrequency = $("payFrequency").value;
    state = normalizeState({
      ...state,
      configured: true,
      employmentType: $("employmentType").value,
      employeeClass: $("employeeClass").value,
      payFrequency,
      hireDate: $("hireDate").value,
      balanceAsOf: state.configured ? state.balanceAsOf : defaultBalanceDate(payFrequency),
      stdMin: stdHours * 60 + stdMinutes,
      flexMin: flexHours * 60 + flexMinutes
    });
  }

  function plannedLeaveTotalsThrough(targetDate) {
    const today = todayDate();
    return state.vacations.reduce((totals, leave) => {
      leaveUsageDates(leave).forEach(({ date, hours }) => {
        if (date < today || date > targetDate) return;
        totals[leave.type] += hours * 60;
      });
      return totals;
    }, { std: 0, flex: 0 });
  }

  function renderBalanceView() {
    const configured = state.configured;
    const today = todayDate();
    const todayLabel = formatDate(dateString(today));
    const overview = $("balance-overview");
    const cards = $("balance-cards");
    const warnings = [];
    const savedViewDate = state.viewDateSelected ? safeDate(state.viewDate) : null;
    const selectedDate = savedViewDate && savedViewDate >= today ? savedViewDate : today;
    const currentMode = selectedDate.getTime() === today.getTime();

    $("viewDate").min = dateString(today);
    $("viewDate").value = dateString(selectedDate);

    const setDetailMode = (isDateMode) => {
      $("std-primary-detail").hidden = false;
      $("flex-primary-detail").hidden = false;
      $("std-planned-detail").hidden = false;
      $("flex-planned-detail").hidden = false;
      $("std-available-detail").hidden = false;
      $("flex-available-detail").hidden = false;
    };

    if (currentMode) {
      const current = liveBalance();
      const currentStd = current ? current.std : state.stdMin;
      const currentFlex = current ? current.flex : state.flexMin;
      const planned = plannedLeaveTotals();
      const availableStd = currentStd - planned.std;
      const availableFlex = currentFlex - planned.flex;
      const availableTotal = availableStd + availableFlex;
      const standardPercent = Math.min(100, Math.max(0, (availableStd / STANDARD_CAP_MIN) * 100));
      const percent = Math.min(100, Math.max(0, (availableFlex / FLEX_CAP_MIN) * 100));

      setDetailMode(false);
      overview.hidden = false;
      cards.hidden = false;
      $("balance-view-copy").innerHTML = `Current balances as of <span id="today-label">${todayLabel}</span>, with planned time off deducted from available balances.`;
      $("total-balance-label").textContent = "Total Available Balance";
      $("std-primary-label").textContent = "Current balance";
      $("flex-primary-label").textContent = "Current balance";
      $("std-result-label").textContent = "Available balance";
      $("flex-result-label").textContent = "Available balance";
      $("std-current-balance").textContent = configured ? formatMinutes(currentStd) : BALANCE_PLACEHOLDER;
      $("std-planned-balance").textContent = configured ? formatMinutes(planned.std) : BALANCE_PLACEHOLDER;
      $("std-balance").textContent = configured ? formatMinutes(availableStd) : BALANCE_PLACEHOLDER;
      $("flex-current-balance").textContent = configured ? formatMinutes(currentFlex) : BALANCE_PLACEHOLDER;
      $("flex-planned-balance").textContent = configured ? formatMinutes(planned.flex) : BALANCE_PLACEHOLDER;
      $("flex-balance").textContent = configured ? formatMinutes(availableFlex) : BALANCE_PLACEHOLDER;
      $("combined-balance").textContent = configured ? formatMinutes(availableTotal) : BALANCE_PLACEHOLDER;
      $("total-balance").textContent = configured ? formatMinutes(availableTotal) : BALANCE_PLACEHOLDER;
      $("flex-total-label").textContent = configured ? formatMinutes(availableFlex) : BALANCE_PLACEHOLDER;
      $("std-total-label").textContent = configured ? formatMinutes(availableStd) : BALANCE_PLACEHOLDER;
      $("std-progress").style.width = `${standardPercent}%`;
      $("std-progress").classList.toggle("amber", standardPercent > 90);
      $("std-cap-label").textContent = configured ? `${Math.round(standardPercent)}% of 160h balance cap` : "";
      const total = Math.max(0, availableStd) + Math.max(0, availableFlex);
      const flexShare = total ? Math.max(0, availableFlex) / total * 100 : 0;
      $("flex-segment").style.width = `${flexShare}%`;
      $("std-segment").style.width = `${Math.max(0, 100 - flexShare)}%`;
      $("flex-progress").style.width = `${percent}%`;
      $("flex-progress").classList.toggle("amber", percent > 90);
      $("flex-cap-label").textContent = configured ? `${Math.round(percent)}% of 108h rollover cap` : "";
      if (!configured) warnings.push("Complete your status above to calculate your live balance.");
      if (availableStd < 0 || availableFlex < 0) warnings.push("Not enough PTO after planned time off.");
      if (currentStd >= STANDARD_CAP_MIN) warnings.push("Standard PTO is at the 160h balance cap; additional accrual may not increase the available balance.");
      if (currentFlex > FLEX_CAP_MIN) warnings.push("Flexible PTO is above the 108h rollover cap; excess will not roll over.");
      $("view-date-note").textContent = configured && current && current.periods
        ? `${current.periods} completed ${state.payFrequency} pay period${current.periods === 1 ? "" : "s"} since ${formatDate(state.balanceAsOf)}.`
        : "";
      $("policy-warning").innerHTML = warnings.length
        ? warnings.map(message => `<div class="notice${message.includes("Not enough") ? " error" : ""}">${message}</div>`).join("")
        : `<div class="notice info">Balance is calculated from your saved starting balance date and completed pay periods.</div>`;
      return;
    }

    setDetailMode(true);
    const target = selectedDate;
    const projected = balanceAt(target, false);
    const result = balanceAt(target, true);
    if (!projected || !result) {
      $("balance-view-copy").textContent = configured
        ? `Estimated balance for ${formatDate(dateString(target))}.`
        : "Complete your status above to calculate a future balance.";
      overview.hidden = true;
      cards.hidden = true;
      $("view-date-note").textContent = configured ? `Choose ${todayLabel} or later.` : "";
      $("policy-warning").innerHTML = configured
        ? `<div class="notice error">The selected date is before today's starting balance.</div>`
        : `<div class="notice error">Complete your status above to calculate your future balance.</div>`;
      return;
    }

    overview.hidden = false;
    cards.hidden = false;
    $("balance-view-copy").textContent = `Estimated balance for ${formatDate(dateString(target))}. Planned time-off usage and future accruals are included.`;
    $("total-balance-label").textContent = "Projected Total Balance";
    const planned = plannedLeaveTotalsThrough(target);
    $("std-current-balance").textContent = configured ? formatMinutes(projected.std) : BALANCE_PLACEHOLDER;
    $("std-planned-balance").textContent = configured ? formatMinutes(planned.std) : BALANCE_PLACEHOLDER;
    $("std-balance").textContent = configured ? formatMinutes(result.std) : BALANCE_PLACEHOLDER;
    $("flex-current-balance").textContent = configured ? formatMinutes(projected.flex) : BALANCE_PLACEHOLDER;
    $("flex-planned-balance").textContent = configured ? formatMinutes(planned.flex) : BALANCE_PLACEHOLDER;
    $("flex-balance").textContent = configured ? formatMinutes(result.flex) : BALANCE_PLACEHOLDER;
    $("total-balance").textContent = configured ? formatMinutes(projected.combined) : BALANCE_PLACEHOLDER;
    $("flex-total-label").textContent = configured ? formatMinutes(projected.flex) : BALANCE_PLACEHOLDER;
    $("std-total-label").textContent = configured ? formatMinutes(projected.std) : BALANCE_PLACEHOLDER;
    $("std-primary-label").textContent = "Projected balance";
    $("flex-primary-label").textContent = "Projected balance";
    $("std-result-label").textContent = "Available balance";
    $("flex-result-label").textContent = "Available balance";
    const total = Math.max(0, projected.std + projected.flex);
    const flexShare = total ? Math.max(0, projected.flex) / total * 100 : 0;
    $("flex-segment").style.width = `${flexShare}%`;
    $("std-segment").style.width = `${Math.max(0, 100 - flexShare)}%`;
    const standardPercent = Math.min(100, Math.max(0, (projected.std / STANDARD_CAP_MIN) * 100));
    const percent = Math.min(100, Math.max(0, (projected.flex / FLEX_CAP_MIN) * 100));
    $("std-progress").style.width = `${standardPercent}%`;
    $("std-progress").classList.toggle("amber", standardPercent > 90);
    $("std-cap-label").textContent = `${Math.round(standardPercent)}% of 160h balance cap`;
    $("flex-progress").style.width = `${percent}%`;
    $("flex-progress").classList.toggle("amber", percent > 90);
    $("flex-cap-label").textContent = `${Math.round(percent)}% of 108h rollover cap`;
    $("view-date-note").textContent = `${result.periods} completed ${state.payFrequency} pay period${result.periods === 1 ? "" : "s"} since ${formatDate(state.balanceAsOf)}.`;
    if (result.std < 0 || result.flex < 0) warnings.push("Not enough PTO for the logged usage.");
    if (result.std >= STANDARD_CAP_MIN) warnings.push("Standard PTO is at the 160h balance cap; additional accrual may not increase the available balance.");
    if (result.flex > FLEX_CAP_MIN) warnings.push("Flexible PTO is above the 108h rollover cap; excess will not roll over.");
    $("policy-warning").innerHTML = warnings.map(message => `<div class="notice${message.includes("Not enough") ? " error" : ""}">${message}</div>`).join("");
  }

  function renderBalanceDefinitions() {
    const summary = $("personal-accrual-summary");
    const grid = $("personal-accrual-grid");
    const note = $("personal-accrual-note");
    const configured = state.configured
      && safeDate(state.hireDate)
      && state.employeeClass
      && state.payFrequency
      && state.employmentType;

    if (!configured) {
      summary.textContent = "Complete your status information to see your personalized accruals.";
      grid.hidden = true;
      note.hidden = true;
      return;
    }

    const today = todayDate();
    const hireDate = safeDate(state.hireDate);
    const yos = yearsOfService(hireDate, today);
    const standardRate = standardRateHours(state, today);
    const flexibleRate = flexibleRateHours(state);
    const frequencyLabel = {
      weekly: "weekly",
      biweekly: "biweekly",
      monthly: "monthly"
    }[state.payFrequency];
    const standardIsDerived = (state.employmentType === "hourly" && state.payFrequency === "monthly")
      || (state.employmentType === "salaried" && state.payFrequency === "weekly");

    summary.textContent = `Class ${state.employeeClass} · ${state.employmentType} · ${frequencyLabel} pay · ${yos} year${yos === 1 ? "" : "s"} of service`;
    $("personal-standard-rate").textContent = `${formatHours(standardRate)} / pay period`;
    $("personal-flexible-rate").textContent = `${formatHours(flexibleRate)} / pay period`;
    $("personal-standard-detail").textContent = standardIsDerived
      ? "Derived from the annual Standard PTO rate."
      : "Based on your current Standard PTO tenure tier.";
    $("personal-flexible-detail").textContent = "Based on your class and pay frequency.";
    note.textContent = "Weekly accruals are applied every Saturday, biweekly accruals every other Saturday, and monthly accruals on the last Saturday of each month. Standard PTO changes when you reach a new hire-date anniversary tier; Flexible PTO is the same at every tenure.";
    grid.hidden = false;
    note.hidden = false;
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
    const points = Array.from({ length: 53 }, (_, week) => ({
      week,
      date: addDays(todayDate(), week * 7),
      ...project(week)
    }));
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
    const xLabels = [0, 13, 26, 39, 52]
      .map(week => `<text x="${x(week)}" y="${height - 19}" text-anchor="middle" fill="#66727d" font-size="11">${week}</text>`)
      .join("");
    const capY = y(FLEX_CAP_MIN);
    const anniv = nextAnniversaryMarker();
    const annivLine = anniv && anniv.weeks <= 52
      ? `<line x1="${x(anniv.weeks)}" y1="${top}" x2="${x(anniv.weeks)}" y2="${top + graphHeight}" stroke="#6b7280" stroke-dasharray="4 4"/><text x="${x(anniv.weeks) + 5}" y="${top + 12}" fill="#66727d" font-size="11">${anniv.years}-year mark</text>`
      : "";
    const newYear = nextNewYearMarker();
    const newYearLine = state.configured && newYear.weeks <= 52
      ? `<line x1="${x(newYear.weeks)}" y1="${top}" x2="${x(newYear.weeks)}" y2="${top + graphHeight}" stroke="#059669" stroke-dasharray="4 4"/><text x="${x(newYear.weeks) + 5}" y="${top + 28}" fill="#047857" font-size="11">New Year grant</text>`
      : "";
    const leaveMarkers = plannedLeaveBands().map(({ leave, start, end }) => {
      const today = todayDate();
      const startWeek = (start - today) / (7 * MS_PER_DAY);
      const endWeek = (end - today) / (7 * MS_PER_DAY);
      const startX = x(startWeek);
      const endX = x(endWeek);
      const width = Math.max(2, endX - startX);
      const typeLabel = leave.type === "std" ? "Standard" : "Flexible";
      return `
        <rect x="${startX}" y="${top}" width="${width}" height="${graphHeight}" fill="#c2410c" opacity=".10">
          <title>Planned ${typeLabel} time off: ${formatDate(leave.startDate)}${leave.startDate === leave.endDate ? "" : ` – ${formatDate(leave.endDate)}`}</title>
        </rect>
        <line x1="${startX}" y1="${top}" x2="${startX}" y2="${top + graphHeight}" stroke="#c2410c" stroke-dasharray="2 3"/>
        <line x1="${Math.max(startX, endX)}" y1="${top}" x2="${Math.max(startX, endX)}" y2="${top + graphHeight}" stroke="#c2410c" stroke-dasharray="2 3"/>
      `;
    }).join("");
    svg.innerHTML = `
      ${grid}
      <line x1="${left}" y1="${capY}" x2="${width - right}" y2="${capY}" stroke="#a16207" stroke-dasharray="6 4"/>
      ${annivLine}
      ${newYearLine}
      ${leaveMarkers}
      <path d="${linePath("std")}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
      <path d="${linePath("flex")}" fill="none" stroke="#059669" stroke-width="2.5"/>
      <path d="${linePath("combined")}" fill="none" stroke="#7c3aed" stroke-width="2.5"/>
      <g id="chart-hover" display="none">
        <line id="chart-hover-line" x1="${x(0)}" y1="${top}" x2="${x(0)}" y2="${top + graphHeight}" stroke="#64748b" stroke-dasharray="3 3"/>
        <circle id="chart-hover-std" cx="${x(0)}" cy="${y(points[0].std)}" r="4" fill="#2563eb" stroke="#fff" stroke-width="2"/>
        <circle id="chart-hover-flex" cx="${x(0)}" cy="${y(points[0].flex)}" r="4" fill="#059669" stroke="#fff" stroke-width="2"/>
        <circle id="chart-hover-combined" cx="${x(0)}" cy="${y(points[0].combined)}" r="4" fill="#7c3aed" stroke="#fff" stroke-width="2"/>
      </g>
      ${xLabels}
      <text x="${left + graphWidth / 2}" y="${height - 4}" text-anchor="middle" fill="#66727d" font-size="11">weeks from now</text>
      <rect id="chart-hover-target" x="0" y="0" width="${width}" height="${height}" fill="transparent" pointer-events="all"/>
    `;
    bindChartHover(points, { width, left, top, graphWidth, graphHeight });
  }

  function nthWeekdayOfMonth(year, month, weekday, occurrence) {
    const first = new Date(year, month, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return new Date(year, month, 1 + offset + ((occurrence - 1) * 7));
  }

  function lastWeekdayOfMonth(year, month, weekday) {
    const last = new Date(year, month + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month + 1, last.getDate() - offset);
  }

  function observedHoliday(year, month, day) {
    const holiday = new Date(year, month, day);
    if (holiday.getDay() === 6) return addDays(holiday, -1);
    if (holiday.getDay() === 0) return addDays(holiday, 1);
    return holiday;
  }

  function holidaysForYear(year) {
    return [
      { name: "US New Year's Day Observed", date: observedHoliday(year, 0, 1) },
      { name: "US Martin Luther King Jr. Day", date: nthWeekdayOfMonth(year, 0, 1, 3) },
      { name: "US Memorial Day", date: lastWeekdayOfMonth(year, 4, 1) },
      { name: "US Independence Day Observed", date: observedHoliday(year, 6, 4) },
      { name: "US Labor Day", date: nthWeekdayOfMonth(year, 8, 1, 1) },
      { name: "US Thanksgiving Day", date: nthWeekdayOfMonth(year, 10, 4, 4) },
      { name: "US Christmas Day Observed", date: observedHoliday(year, 11, 25) }
    ].sort((first, second) => first.date - second.date);
  }

  function formatHolidayDate(date) {
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function renderHolidays() {
    const today = todayDate();
    const year = today.getFullYear();
    $("holidays-year").textContent = year;
    $("holiday-list").innerHTML = holidaysForYear(year).map(holiday => {
      const isPast = holiday.date < today;
      return `<div class="holiday-row${isPast ? " past" : ""}"><span>${holiday.name}</span><strong>${formatHolidayDate(holiday.date)}</strong></div>`;
    }).join("");
  }

  function bindChartHover(points, chart) {
    const svg = $("chart");
    const hover = $("chart-hover");
    const tooltip = $("chart-tooltip");
    if (!svg || !hover || !tooltip) return;

    function hide() {
      hover.setAttribute("display", "none");
      tooltip.classList.remove("is-visible");
    }

    function show(event) {
      const screenPoint = svg.createSVGPoint();
      screenPoint.x = event.clientX;
      screenPoint.y = event.clientY;
      const transform = svg.getScreenCTM();
      if (!transform) return;
      const svgPoint = screenPoint.matrixTransform(transform.inverse());
      const clampedX = Math.max(chart.left, Math.min(chart.left + chart.graphWidth, svgPoint.x));
      const week = Math.max(0, Math.min(52, Math.round(((clampedX - chart.left) / chart.graphWidth) * 52)));
      const point = points[week];
      const pointX = chart.left + (week / 52) * chart.graphWidth;

      $("chart-hover-line").setAttribute("x1", pointX);
      $("chart-hover-line").setAttribute("x2", pointX);
      $("chart-hover-std").setAttribute("cx", pointX);
      $("chart-hover-std").setAttribute("cy", pointY(point.std));
      $("chart-hover-flex").setAttribute("cx", pointX);
      $("chart-hover-flex").setAttribute("cy", pointY(point.flex));
      $("chart-hover-combined").setAttribute("cx", pointX);
      $("chart-hover-combined").setAttribute("cy", pointY(point.combined));
      hover.setAttribute("display", "");

      tooltip.innerHTML = `
        <div class="chart-tooltip-title">${week === 0 ? "Today" : `In ${week} week${week === 1 ? "" : "s"}`}</div>
        <div class="chart-tooltip-date">${formatDate(dateString(point.date))}</div>
        <div class="chart-tooltip-row"><span>Standard</span><strong>${formatMinutes(point.std)}</strong></div>
        <div class="chart-tooltip-row"><span>Flexible</span><strong>${formatMinutes(point.flex)}</strong></div>
        <div class="chart-tooltip-row"><span>Total</span><strong>${formatMinutes(point.combined)}</strong></div>
      `;
      tooltip.classList.add("is-visible");

      const offset = 14;
      const tooltipWidth = tooltip.offsetWidth || 180;
      const tooltipHeight = tooltip.offsetHeight || 100;
      const left = Math.min(window.innerWidth - tooltipWidth - 8, event.clientX + offset);
      const top = Math.min(window.innerHeight - tooltipHeight - 8, event.clientY + offset);
      tooltip.style.left = `${Math.max(8, left)}px`;
      tooltip.style.top = `${Math.max(8, top)}px`;
    }

    function pointY(value) {
      const maxValue = Math.max(FLEX_CAP_MIN, ...points.map(point => Math.max(point.std, point.flex, point.combined, 0)));
      return chart.top + chart.graphHeight - (Math.max(0, value) / (maxValue || 1)) * chart.graphHeight;
    }

    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerenter", show);
    svg.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
  }

  function renderRequests() {
    const today = todayDate();
    const requests = [...state.vacations]
      .filter(item => safeDate(item.endDate) >= today)
      .sort((first, second) => first.startDate.localeCompare(second.startDate));

    $("requests-list").innerHTML = requests.length
      ? requests.map(item => {
        const start = safeDate(item.startDate);
        const isCurrent = start <= today;
        const remainingHours = leaveUsageDates(item)
          .filter(({ date }) => date >= today)
          .reduce((total, entry) => total + entry.hours, 0);
        const typeLabel = item.type === "std" ? "Standard PTO" : "Flexible PTO";
        const note = item.note ? ` · ${escapeHtml(item.note)}` : "";
        return `
          <div class="request-row">
            <div class="request-main">
              <span class="request-title">${leaveDateLabel(item)}</span>
            <span class="request-meta">${typeLabel} · ${formatMinutes(remainingHours * 60)}${note}</span>
            </div>
            <span class="request-status">${isCurrent ? "Current" : "Upcoming"}</span>
          </div>
        `;
      }).join("")
      : `<div class="requests-empty muted">No current or upcoming requests.</div>`;
  }

  function renderVacations() {
    const sorted = [...state.vacations].sort((a, b) => (
      b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate)
    ));
    const hasLogs = sorted.length > 0;
    const stdTotal = sorted.filter(item => item.type === "std").reduce((sum, item) => sum + leaveTotalHours(item), 0);
    const flexTotal = sorted.filter(item => item.type === "flex").reduce((sum, item) => sum + leaveTotalHours(item), 0);
    $("vacation-summary").textContent = hasLogs
      ? `Logged total: ${formatHours(stdTotal)} Standard, ${formatHours(flexTotal)} Flexible`
      : "";
    $("vacation-list-header").hidden = !hasLogs;
    $("vacation-empty").hidden = hasLogs;
    $("vacation-table-wrap").hidden = !hasLogs;
    $("vacations").innerHTML = hasLogs ? sorted.map(item => {
      const after = balanceAt(safeDate(item.endDate));
      const balanceAfter = after
        ? `<span class="balance-line${after.std < 0 ? " balance-negative" : ""}">Std ${formatMinutes(after.std)}</span><span class="balance-line${after.flex < 0 ? " balance-negative" : ""}">Flex ${formatMinutes(after.flex)}</span>`
        : `<span class="muted">Before today's starting balance</span>`;
      const dayCount = leaveDayCount(item);
      const isMultiDay = item.startDate !== item.endDate;
      const dayLabel = isMultiDay
        ? `${dayCount} ${dayCount === 1 ? "day" : "days"} · ${formatHours(leaveTotalHours(item))}`
        : formatHours(leaveTotalHours(item));
      const scheduleLabel = item.weekdaysOnly ? "Weekdays only" : "Every day";
      const schedule = isMultiDay ? `<small class="leave-schedule">${scheduleLabel}</small>` : "";
      const perDay = isMultiDay ? `<small class="leave-schedule">${formatHours(item.hoursPerDay)}/day</small>` : "";
      return `<tr><td>${leaveDateLabel(item)}${schedule}</td><td>${item.type === "std" ? "Standard" : "Flexible"}</td><td>${dayLabel}${perDay}</td><td class="balance-cell">${balanceAfter}</td><td>${escapeHtml(item.note)}</td><td class="right"><button class="danger small-button" type="button" data-remove="${escapeHtml(item.id)}">Remove</button></td></tr>`;
    }).join("") : "";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function render() {
    fillSettingsForm();
    renderRequests();
    renderBalanceView();
    renderChart();
    renderHolidays();
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

  const employeeClassInfo = $("employee-class-info");
  const employeeClassPopover = $("employee-class-popover");

  function closeEmployeeClassPopover() {
    employeeClassPopover.hidden = true;
    employeeClassInfo.setAttribute("aria-expanded", "false");
  }

  employeeClassInfo.addEventListener("click", event => {
    event.stopPropagation();
    const isOpen = !employeeClassPopover.hidden;
    if (isOpen) {
      closeEmployeeClassPopover();
      return;
    }
    employeeClassPopover.hidden = false;
    employeeClassInfo.setAttribute("aria-expanded", "true");
  });

  employeeClassPopover.addEventListener("click", event => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    if (!employeeClassPopover.hidden) closeEmployeeClassPopover();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !employeeClassPopover.hidden) {
      closeEmployeeClassPopover();
    }
  });

  const vacationModal = $("vacation-modal");
  const guideModal = $("guide-modal");

  function openVacationModal(focusForm, type = "", listOnly = false) {
    $("vacation-form").hidden = listOnly;
    vacationModal.classList.toggle("logs-only", listOnly);
    $("vacation-modal-title").textContent = listOnly ? "Time-off logs" : "Time-off log";
    $("vacation-modal-description").textContent = listOnly
      ? "Review your logged and planned time off."
      : "Plan one-day or multi-day time off and see the projected balances after it.";
    if (type === "std" || type === "flex") {
      $("vacationType").value = type;
      renderVacationPreview();
    }
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
  $("view-all-requests").addEventListener("click", () => openVacationModal(false, "", true));
  document.querySelectorAll("[data-open-requests]").forEach(button => {
    button.addEventListener("click", () => openVacationModal(true, button.dataset.openRequests));
  });
  $("guide-button").addEventListener("click", () => guideModal.showModal());
  $("guide-close").addEventListener("click", () => guideModal.close());
  guideModal.addEventListener("click", event => {
    if (event.target === guideModal) guideModal.close();
  });

  const balanceDefinitionsModal = $("balance-definitions-modal");
  $("balance-definitions-button").addEventListener("click", () => {
    renderBalanceDefinitions();
    balanceDefinitionsModal.showModal();
  });
  $("balance-definitions-close").addEventListener("click", () => balanceDefinitionsModal.close());
  balanceDefinitionsModal.addEventListener("click", event => {
    if (event.target === balanceDefinitionsModal) balanceDefinitionsModal.close();
  });

  $("holidays-info").addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
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
        ? "Choose dates to preview this time off."
        : "Choose a date to preview this time off.";
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
        ? "Enter hours per day to preview this time off."
        : "Enter a PTO duration to preview this time off.";
      preview.classList.add("warning");
      return;
    }
    const dayCount = leaveDayCount(leave);
    const totalHours = leaveTotalHours(leave);
    const typeLabel = leave.type === "std" ? "Standard" : "Flexible";
    const scheduleLabel = leave.weekdaysOnly ? "weekdays only" : "every day";
    const overlapWarning = overlapsExistingLeave(leave)
      ? " This overlaps existing planned time off."
      : "";
    if (!dayCount) {
      preview.textContent = `${leaveDateLabel(leave)} has no scheduled ${scheduleLabel} days.`;
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
    $("vacation-form").querySelector(".vacation-form").classList.toggle("is-multi-day", isMultiDay);
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
    renderBalanceView();
  });

  function refreshIfDateChanged() {
    const currentDate = dateString(new Date());
    if (currentDate === lastLiveDate) return;
    lastLiveDate = currentDate;
    renderRequests();
    renderBalanceView();
    renderChart();
    renderHolidays();
  }

  window.addEventListener("focus", refreshIfDateChanged);
  setInterval(refreshIfDateChanged, 60000);

  $("vacation-form").addEventListener("submit", event => {
    event.preventDefault();
    const leave = vacationFormLeave();
    const start = leave && safeDate(leave.startDate);
    const end = leave && safeDate(leave.endDate);
    if (!leave || !start || !end || end < start || !leaveDayCount(leave)) {
      $("vacation-status").textContent = "Choose a valid date range with at least one time-off day.";
      return;
    }
    const overlapping = overlapsExistingLeave(leave);
    state.vacations.push({ ...leave, id: newLeaveId() });
    saveState();
    render();
    const after = balanceAt(end);
    resetVacationForm();
    $("vacation-status").textContent = overlapping
      ? "Time off added. It overlaps existing planned time off."
      : after && (after.std < 0 || after.flex < 0)
        ? "Time off added. Balance warning: not enough PTO after this time off."
        : "Time off added.";
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
    if (!confirm("Reset all local PTO data?")) return;
    state = normalizeState(DEFAULT_STATE);
    saveState();
    render();
    expandSettings();
    $("backup-status").textContent = "Reset.";
  });

  resetVacationForm();
  render();
  try {
    if (localStorage.getItem(STORAGE_KEY) && state.configured) collapseSettings();
    else expandSettings();
  } catch {
    expandSettings();
  }
})();

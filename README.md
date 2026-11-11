# PTO Tracker

A local-only PTO balance tracker built with vanilla HTML, CSS, and JavaScript.

The app estimates Standard PTO and Flexible PTO balances, logs planned time off, and projects balances up to 52 weeks into the future. Data stays in the browser and is never sent to a server.

## Features

- Configure employment type, employee class, pay frequency, hire date, and current PTO balances
- Track Standard PTO and Flexible PTO separately
- View current balances and balances for a future date
- Log one-day or multi-day time off
- Support weekday-only multi-day time off
- See a 52-week SVG balance projection
- Review PTO policy tables and caps
- Export and import local data as JSON
- Reset local data

## Run locally

From the project directory:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in a browser.

No build step or dependency installation is required.

## How calculations work

### Starting balance

The Standard PTO and Flexible PTO values entered in **Your status** are treated as the saved balances for the current date. Future calculations add accruals and subtract logged time off after that date.

### Standard PTO

For hourly employees, Standard PTO accrual depends on:

- Employee class: F, R, or H
- Years of service
- Pay frequency

Weekly and biweekly hourly rates use the policy’s per-pay-period tables. Hourly monthly rates are derived from annual accrual divided by 12.

For salaried employees, the app uses the salaried annual, biweekly, and monthly tables included in the policy reference.

Standard PTO has a 160-hour balance cap in the app.

### Flexible PTO

Flexible PTO accrues each pay period according to employee class and pay frequency:

| Pay frequency | Class F | Class R | Class H |
| --- | ---: | ---: | ---: |
| Weekly | 1.35h | 1.32h | 1h |
| Biweekly | 2.7h | 2.64h | 2h |
| Monthly | 5.84h | 5.71h | 4.25h |

The annual Flexible PTO grant occurs on the hire date and on January 1 in subsequent years:

- Class F: 10 hours
- Class R: 7.5 hours
- Class H: 5 hours

The Flexible PTO rollover cap is 108 hours. Flexible PTO has no balance, annual accrual, or usage cap in the app.

### Years-of-service changes

There is no separate one-year Standard PTO lump-sum grant. At the one-year anniversary, the Standard PTO accrual rate changes to the next years-of-service tier for applicable future pay periods.

## Data storage

State is stored in browser `localStorage` under:

```text
pto-tracker-state-v1
```

Use **Export JSON** before clearing browser data or moving to another device.

## Project files

- `index.html` — page structure and policy reference
- `styles.css` — layout and visual styles
- `app.js` — state management, calculations, rendering, projections, and storage

## Policy reference

The embedded policy reference identifies the source as:

```text
Policy: Paid Time Off (Washington) - US
Dated Aug 27, 2025
Effective Jan 5, 2025
```

The app is an estimate and does not account for discretionary year-end Flexible PTO adjustments or changes to company policy. Confirm balances with official employment records when accuracy is important.

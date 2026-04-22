# 💎 Skill Portal — Diamond Certification Tracker

Track Diamond 1 and Diamond 2 certification progress for your tech support team using interactive radar charts.

## Features

- **Two radar charts** — Diamond 1 (Applications, OSs, Customer Service, Operations) and Diamond 2 (Security, AV, Network, Project Management/Leadership)
- **Current vs. Aim overlay** — See where you are (red) and where you're headed (blue)
- **Quick skill updates** — Sliders for instant 1–5 scoring
- **Manager View** — Team-wide tracking with individual drill-down
- **Historical tracking** — Every update is saved for future growth analysis
- **Fully portable** — SQLite database, no external services required

## Quick Start

```bash
git clone <your-repo-url>
cd Training Diamonds
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

## Transferring Data

The database lives at `data/skills.db`. To move your data to another machine:

1. Copy the entire project folder (or clone from GitHub)
2. Copy your `data/skills.db` file into the `data/` directory
3. Run `npm start`

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (via better-sqlite3)
- **Frontend:** Vanilla HTML/CSS/JS + Chart.js
- **Charts:** Chart.js v4 radar charts

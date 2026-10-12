# ClearPass – Attendance Clearance & Unblocking System

React + Vite front end, one Vercel serverless function (`api/db.ts`), and a shared Postgres database (Neon).
Everyone on the team sees the same data; the app checks for teammates' changes every ~8 seconds.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project →** import the repo (Vite is auto-detected; no build settings needed).
3. In the project: **Storage → Create Database → Neon (Postgres)** and connect it to the project.
   This adds `DATABASE_URL` automatically.
4. (Optional) **Settings → Environment Variables:** add `APP_ACCESS_CODE` to require a shared code. Leave it unset for no login at all.
5. Redeploy. Tables are created automatically on first request.

## Local development

The `/api` function only runs under the Vercel CLI, so use it instead of plain `vite`:

    npm install
    npm i -g vercel
    vercel link
    vercel env pull .env.local     # pulls DATABASE_URL + APP_ACCESS_CODE
    vercel dev

Tip: create a separate Neon branch for local/dev so testing never touches real records.

## Moving existing data in

In the old (IndexedDB) version click **Backup**, then in this version click **Restore** and pick the JSON file.
Old backups are compatible.

## Notes

- If `APP_ACCESS_CODE` is set, everyone needs that shared code (not per-user login). If unset, anyone with the URL has full access.
- Last write wins: if two people edit the same cell at the same moment, the later save is kept.
- Request bodies are limited to ~4.5 MB on Vercel (roughly 15–20k students per master list upload).
- "Clear database" and "Restore" replace data for everyone.

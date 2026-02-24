# Inspection App

Mobile-first property inspection app for short-term rental management. Inspectors conduct area-by-area inspections with voice recordings and photos; AI transcribes, analyzes, and generates reports to Notion.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without Supabase configured, the app runs with mock data.

---

## Supabase Setup (Existing Project)

### 1. Get credentials

In your Supabase project: **Project Settings → API**

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 2. Run the schema

In Supabase: **SQL Editor → New query**

Copy the contents of `supabase/schema.sql` and run it. This creates the tables.

### 3. Create storage buckets

In Supabase: **Storage → New bucket**

| Bucket                        | Public | Max file size |
|-------------------------------|--------|---------------|
| `inspection-audio-recordings` | No     | 50 MB         |
| `inspection-photos`           | No     | 10 MB         |

Path format:
- `inspection-audio-recordings`: `{inspection_id}/{area_id}.webm`
- `inspection-photos`: `{inspection_id}/{area_id}/{photo_id}.jpg`

For each bucket: **Storage → [bucket] → Policies → New policy** → allow `INSERT` and `SELECT` for authenticated/anon users (depending on your auth setup).

### 4. Seed test data (optional)

If you want sample deals and apartments before n8n pushes real data, run `supabase/seed.sql` in the SQL Editor.

### 5. n8n data structure

When pushing from n8n, use **deal_sku** to link apartments to deals (not UUID):

- **ins_deals**: `deal_sku` (unique, serves as identifier and display name), `focus_areas`, `notion_page_id`
- **ins_apartments**: `deal_sku` (matches ins_deals.deal_sku), `apartment_sku` (e.g. "A101"), `issues`, `notion_page_id`

### 6. RLS policies (required for recordings/photos)

If recordings and photos are not saving to Supabase, RLS is likely blocking inserts. Run `supabase/migration_rls_policies.sql` in the SQL Editor to allow anon inserts.

### 7. Question scores and photo linking

For per-question AI scores and photos linked to questions, run `supabase/migration_question_scores.sql` in the SQL Editor.

### 7b. User-friendly question info (optional)

To store question labels and full question text in `ins_question_scores` for easier viewing in Supabase, run `supabase/migration_question_user_friendly.sql`.

### 8. Allow inspection completion (UPDATE)

To mark inspections as submitted when the inspector finishes, run `supabase/migration_inspections_update.sql` in the SQL Editor.

### 9. Migrating from old schema

If you already have tables with `deal_id` (UUID) linking apartments to deals, run `supabase/migration_deal_sku.sql` in the SQL Editor.

---

## Notion Report Generation

When an inspection is submitted, the app generates a report and pushes it to Notion.

### 1. Create a Notion integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Create a new integration
3. Copy the **Internal Integration Secret** → `NOTION_API_KEY` in `.env.local`

### 2. Share pages with the integration

- Share the **Deal 1-pager pages** with your integration (so reports can be appended)
- Create an **Inspections** page (or similar) and share it with the integration (for the database parent)

### 3. Create the inspection database (one-time)

```bash
curl -X POST http://localhost:3000/api/setup/notion-database
```

Requires `NOTION_PARENT_PAGE_ID` (the Inspections page ID). The response includes `database_id`.

Add to `.env.local`:

```
NOTION_API_KEY=your-integration-secret
NOTION_INSPECTION_DATABASE_ID=the-database-id-from-setup
NOTION_PARENT_PAGE_ID=your-inspections-page-id  # Only needed for setup
```

### 4. Report structure

- **Deal 1-pager**: A toggle block "Inspection DD.MM.YY" with summary + link to the inspection database
- **Inspection database**: One row per block (Shared Areas, Unit A101, …) with Quarter, Deal, Actions, and scores per question
- **Row pages**: Details and photos per question inside each database row

---

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx            # Deal selection
│   ├── inspect/[dealId]/   # Unit selection
│   └── inspect/.../[inspectionId]/  # Inspection flow
├── lib/
│   ├── data.ts             # Supabase queries (falls back to mock)
│   ├── questions.ts        # Question bank, deep-dive logic
│   └── supabase.ts         # Client (only created when URL set)
└── ...
```

---

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)

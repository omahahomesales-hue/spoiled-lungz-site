# Spoiled Lungz website

Static site (no build step) deployed on Vercel, with content in Supabase.

- `index.html` + `js/site.js`: public site with the 21+ gate, tabs, products, merch, locations, about, and contact.
- `admin.html` + `js/admin.js`: admin at `/admin` for adding and editing products, merch, and locations, uploading photos, and reading contact messages.
- `config.js`: Supabase URL and publishable key. If it's blank, the site runs on built-in placeholder content.
- `supabase/schema.sql`: tables, row-level security, photo bucket, and the two boutique locations.

## Content rules
- **Products** (flower, edibles, concentrates, vapes) are a menu only, with no online checkout. Each product can be tagged with the boutiques that carry it.
- **Merch** sells through Stripe Payment Links. Create a link in Stripe, then paste it into the merch item's "Stripe payment link" field.

## Adding an admin
1. In Supabase, go to Authentication → Users → Add user. Enter their email and a password, and check "Auto confirm".
2. Run this SQL: `insert into public.admins (email) values ('person@example.com');`

## Deploy
Push to GitHub, then import the repo in Vercel. Use framework preset "Other" with no build command. Every push to `main` redeploys the site.

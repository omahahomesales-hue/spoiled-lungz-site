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

## Members, orders & delivery (added Oct 2026)
- **Members tab** (`#members`): people apply (21+ date of birth enforced by the database), then wait as *pending* until an admin approves them in `/admin → Members`. Approved members see prices, members-only products, and can order for delivery or pickup. Payment is collected at handoff for now.
- **Admin → Orders**: confirm, mark out for delivery / ready for pickup / completed, cancel (stock goes back automatically), assign a driver, mark paid.
- **Admin → Staff & drivers**: add drivers (they only see deliveries assigned to them at `/admin`) or other admins.
- **Products**: member price (blank = not orderable), stock (blank = not tracked), members-only switch.
- Database rules live in `supabase/002_members_orders.sql`. Prices and stock are enforced in the database (`place_order`), not the browser.

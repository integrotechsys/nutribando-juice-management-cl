# NutriBando Juice — Sales & Dispatch System

A web system (works on phones too, and can be installed on the home screen) for:

- **Dispatch** juice bottles to biker sellers (juice, bottles, total money)
- **Add more juice** to a seller who is still out
- **Reconcile** at the end of the day: returned bottles → sold bottles → money expected vs collected
- **Shop sales** (glass / takeaway)
- **Expenses**, **Reports** (by day, juice, seller, category) and **Forecast** (30 / 60 / 90 days)

Currency: **TSh**. All dates and times: **East Africa Time (GMT+3)**.

## Who can do what

| | Staff | Admin |
|---|---|---|
| Create a dispatch, add more juice, record returns & money | ✅ | ✅ |
| Record shop sales | ✅ | ✅ |
| Edit / delete / re-open dispatches, shop sales | ❌ | ✅ |
| Expenses, Reports, Forecast | ❌ | ✅ |
| Juices & prices, Sellers, Staff accounts | ❌ | ✅ |

Biker sellers do not log in. The rules are enforced by the database (not just hidden buttons).

---

## Set-up (about 20 minutes, all free)

### 1. Supabase (database + logins)
1. Create an account at **supabase.com** → **New project** (pick a region close to you, e.g. Europe/Frankfurt or Mumbai; save the database password).
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, click **Run**. You should see "Success".
3. Create **your admin login first**: **Authentication → Users → Add user → Create new user**, enter your email + a password, tick **Auto Confirm User**. *The first user created automatically becomes Admin.*
4. Add your staff the same way (they become **Staff**; you can change roles later in the app under **Staff**).
5. Recommended: **Authentication → Sign In / Providers** → turn **off** "Allow new users to sign up", so only people you create can log in.
6. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

### 2. Put your keys and logo in the project
1. Open `public/config.js` and paste the Project URL and anon key.
2. Your logo is already in `public/logo.png` (square 512×512 for the header and phone icon) and `public/logo-192.png`.
3. Brand colours (red and green from your logo): top of `public/styles.css`.

### 3. GitHub
Create a new repository (e.g. `nutribando-juice`) and upload everything in this folder (or `git init`, `git add .`, `git commit`, `git push`).

### 4. Render (puts it online)
1. **render.com → New → Static Site** → connect your GitHub repo.
2. **Build command:** leave empty. **Publish directory:** `public`.
3. Click **Create Static Site**. In a minute you get a link like `https://nutribando-juice.onrender.com`.

(There is also a `render.yaml` if you prefer **New → Blueprint**.)

### 5. First use
1. Open the link on your phone or computer and log in as admin.
2. **Juices** → set the price of each juice (they start at 0).
3. **Sellers** → add your biker sellers.
4. Done — staff can start from **Dispatch → New dispatch**.

On a phone: open the link in Chrome/Safari → menu → **Add to Home screen** to install it like an app.

---

## Daily routine
1. **Morning:** Dispatch → *New dispatch* → choose seller, enter bottles per juice → *Dispatch*. (Print button gives a slip.)
2. **During the day:** open the seller's dispatch → *Add more juice* if they sell out.
3. **Evening:** open the dispatch → enter **returned bottles** per juice. Sold bottles and the amount expected are calculated; enter the **money collected**; the difference is shown → *Close dispatch*. Returned bottles are just what you put back in the freezer — they are not counted as sales.
4. Admin records expenses and checks Reports / Forecast.

## How the numbers work
- **Revenue** = money actually collected from sellers + shop sales. **Cash short** = expected − collected.
- A juice's price is saved on every dispatch, so changing a price later never changes old records.
- **Forecast** uses your last up to 90 days: it follows your recent trend (14+ days of data), adjusts for weekday patterns (28+ days) and keeps results within ±50% of your average so one odd week can't distort it. Expenses use your recent daily average. Use the **Scenario** box for cautious / optimistic views. It is an estimate — more records make it better.

## Good to know (free plans)
- **Supabase free** pauses a project after about a week with no activity; log in to the dashboard to resume it. Using the app daily avoids this. Consider backing up occasionally (Reports → CSV, or Supabase → Database → Backups on paid plans).
- **Render static sites** are free and do not "sleep". When you buy a domain, add it in Render → Settings → Custom Domains.
- Never share the Supabase **service_role** key. Only the **anon** key goes in `config.js`.

## Changing rules later
Permissions live in `supabase/schema.sql` (section *ROW LEVEL SECURITY*). For example, to let staff also record expenses, add a policy in Supabase for `expenses` using `public.is_staff()`; ask and I'll write it for you.

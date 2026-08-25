# ODYSSEY MVP — Setup Guide (for total beginners)

Follow these steps IN ORDER. Don't skip ahead.

## Part 1 — Get the database ready (Supabase)

1. Go to your Supabase project ("Odyssey") at supabase.com/dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **New query**
4. Open `supabase/schema.sql` from this folder, copy ALL of it, paste it into the SQL Editor
5. Click **Run** (bottom right). You should see "Success. No rows returned."
   - This just created your `profiles` and `engagements` tables and their security rules.
6. Click **Table Editor** in the sidebar — you should now see `profiles` and `engagements` listed. If you see them, it worked.

## Part 2 — Get your Supabase keys

1. In Supabase, click the gear icon **Project Settings** (bottom left)
2. Click **API** in the settings menu
3. You'll see two things you need:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key (a long string of letters/numbers)
4. Keep this tab open, you'll paste these in a minute.

## Part 3 — Run the app on your own computer

You need **Node.js** installed first. If you don't have it: go to nodejs.org, download the LTS version, install it like any normal program.

1. Download/unzip this whole `odyssey-mvp` folder onto your computer
2. Open a terminal (Mac: Terminal app. Windows: search "Command Prompt" or use VS Code's built-in terminal)
3. Navigate into the folder:
   ```
   cd path/to/odyssey-mvp
   ```
4. Install the dependencies (this downloads React, Next.js, Supabase's code libraries):
   ```
   npm install
   ```
   This will take 1-3 minutes and create a `node_modules` folder. That's normal, don't touch it.
5. Create your environment file:
   ```
   cp .env.local.example .env.local
   ```
   (On Windows Command Prompt, use `copy` instead of `cp`)
6. Open `.env.local` in any text editor and paste in your real Supabase URL and anon key from Part 2.
7. Start the app:
   ```
   npm run dev
   ```
8. Open your browser to **http://localhost:3000** — you should see the ODYSSEY login screen.
9. Click "Need an account? Sign up", create a test account, confirm via email (Supabase sends a real confirmation email), then log in.

If you see the Dashboard with your name/role, and can click through to Engagements and create one — **Tuesday's deliverables are done.**

## Part 4 — Push this to GitHub

1. Create a new repository on github.com (don't initialize with a README, you already have one)
2. In your terminal, inside the `odyssey-mvp` folder:
   ```
   git init
   git add .
   git commit -m "MVP: login, roles, engagements"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
   git push -u origin main
   ```
3. Refresh your GitHub repo page — your code should now be there.
   **Important:** `.env.local` will NOT be uploaded (it's in `.gitignore` on purpose — never commit secret keys to GitHub).

## Part 5 — Deploy to Vercel (so it's live on the internet)

1. Go to vercel.com, sign up/log in using your **GitHub account** (this links them automatically)
2. Click **Add New -> Project**
3. Find your `odyssey-mvp` repo in the list, click **Import**
4. Before clicking Deploy, expand **Environment Variables** and add these two (same values as your `.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Click **Deploy**. Wait 1-2 minutes.
6. You'll get a live URL like `odyssey-mvp.vercel.app` — this is your real, shareable link.

## Team collaboration note

- Make sure your GitHub repo is **Public** for now — Vercel's free Hobby plan does not allow multiple people to collaborate on a **private** repo's deployment. Public repos are free to collaborate on.
- Every teammate should be added as a **Collaborator** on the GitHub repo (repo Settings -> Collaborators) so everyone can push code.
- For Supabase, invite your team via **Organization Settings -> Team -> Invite member** so they can see the database too (this is separate from GitHub access).

## What's next (Wednesday's items)

- Upload JE data (file upload -> Supabase Storage)
- Validate uploaded data (check for required columns before saving)
- Configure testing criteria (a settings page storing the 5 rule thresholds)

Ask for these next and we'll build them the same way.

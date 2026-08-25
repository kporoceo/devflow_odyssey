# ODYSSEY — Local Setup Guide

Follow these steps in order. Disclaimers are noted inline — read them, they'll save you time.

---

## Step 1 — Install Node.js

*Skip this step if you already have Node.js installed. Check first by running `node -v` in your terminal — if you get a version number, move to Step 2.*

1. Go to [nodejs.org](https://nodejs.org)
2. Download the **LTS** version (not "Current")
3. Run the installer, click Next through everything with default options
4. Close and reopen your terminal/Command Prompt — it won't recognize `node`/`npm` in a window that was already open before install
5. Verify:
   ```
   node -v
   npm -v
   ```
   Both should print a version number. If "not recognized," restart your computer once and retry.

---

## Step 2 — Install Git

*Skip this step if you already have Git installed. Check with `git -v` first.*

1. Go to [git-scm.com](https://git-scm.com), download for your OS, run the installer
2. Click Next through all screens with defaults, **except**:
   - "Adjusting the name of the initial branch" → choose **Override the default branch name** and type `main`
3. Close and reopen your terminal
4. Verify: `git -v`
5. Set your identity (skip if you've already configured git on this machine before):
   ```
   git config --global user.name "Your Full Name"
   git config --global user.email "your-github-email@example.com"
   ```

---

## Step 3 — Get the code

**Disclaimer:** Put this folder somewhere simple — **not** inside OneDrive/Google Drive/Dropbox. Those sync services fight with the thousands of small files `npm install` creates and cause slowdowns or file-lock errors. Use something like `C:\Projects\` (Windows) or `~/Projects/` (Mac).

```
cd C:\Projects
git clone https://github.com/kporoceo/devflow_odyssey.git
cd devflow_odyssey
```

---

## Step 4 — Install dependencies

```
npm install
```

Takes 1-3 minutes.

**Disclaimer:** You'll likely see yellow "warn" messages and an "X vulnerabilities" notice at the end — this is normal and not urgent for this project. **Do not run `npm audit fix --force`.** It can jump the project to a newer major version that breaks the existing code. If you're unsure, leave it alone and ask before running any `audit fix` command.

---

## Step 5 — Set up your environment file

**Disclaimer:** This file holds secret keys and is intentionally never stored in GitHub (it's in `.gitignore`). Every teammate creates their own local copy.

1. Copy the template:
   ```
   copy .env.local.example .env.local
   ```
   (Mac/Linux: use `cp` instead of `copy`)

2. Open `.env.local` in a text editor.

3. Fill in the two values:
   ```
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   ```

4. Save the file.

**Disclaimer:** Double-check the filename is exactly `.env.local` — not `.env.local.txt`. Some text editors silently append `.txt`. If unsure, run `dir /a` (Windows) or `ls -la` (Mac) in the folder to see the real filename.

---

## Step 6 — Run it

```
npm run dev
```

Wait for the terminal to show:
```
▲ Next.js 14.2.35
- Local: http://localhost:3000
✓ Ready
```

Open **http://localhost:3000**. You should see the ODYSSEY login screen.

Sign up with a test account, confirm via the email Supabase sends, then log in.

---

## Daily workflow from here

Save and share your changes:
```
git add .
git commit -m "describe what you changed"
git push
```

Get teammates' latest changes — do this **before** starting work each session:
```
git pull
```

**Disclaimer:** If `npm run dev` throws new errors after a `git pull`, someone likely added a new dependency. Run `npm install` again to catch up before debugging further.

---

## Common problems

| Problem | Fix |
|---|---|
| `'npm' is not recognized` | Node.js isn't installed, or terminal wasn't reopened after installing. |
| `'git' is not recognized` | Git isn't installed, or terminal wasn't reopened. |
| Red error: "Supabase URL and API key are required" | `.env.local` is missing, empty, or misnamed. Redo Step 5. |
| Can't type in Command Prompt | Click inside the window, press Escape. |
| App very slow / odd install errors | Project folder is inside OneDrive/Drive/Dropbox. Move it to a plain local folder (Step 3). |
| `git push` asks you to sign in | Click "Sign in with your browser," authorize on the GitHub page, return to terminal. |

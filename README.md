# Tony Chen — Portfolio Site

A plain HTML/CSS/JS rebuild of the portfolio, ready to host for free on GitHub Pages.

## Structure

```
portfolio-site/
  index.html                Home page (hero + contact sheet of work)
  reel.html                 Show reel
  projects.html             Full projects list
  about.html                About, tools, and the contact form (#contact)
  projects/
    vincis-voyage.html
    night-vision.html
    tramsheds-joyride.html
    piece-it-together.html
    portfolio-site.html
  css/style.css
  js/script.js
  images/                   Site images (already compressed/resized)
  files/                    Resume PDF
  serve.ps1                 Local preview server
```

There is no `contact.html` — it was retired on 13 Aug 2026 and the contact
form moved to the bottom of `about.html`. Nav is Home / Reel / Projects /
About, hand-duplicated across all 9 pages.

## 1. Videos

All five video slots are wired up to YouTube embeds:
- `index.html` — show reel
- `projects/vincis-voyage.html`
- `projects/night-vision.html`
- `projects/tramsheds-joyride.html`
- `projects/piece-it-together.html`

Big video files (your Show Reel, Vinci's Voyage, etc.) aren't included in
this repo — GitHub Pages isn't built for hosting large `.mp4` files directly,
so each page instead embeds the YouTube-hosted version.

**To swap a video later:** open the relevant HTML file, find the `<iframe
src="https://www.youtube.com/embed/VIDEO_ID" ...>` in the `.video-frame`
block, and replace `VIDEO_ID` with the new one from the video's YouTube URL
(`https://youtube.com/watch?v=VIDEO_ID`).

## 2. Project thumbnails — done

All four projects have a thumbnail. They are set as a `background-image` on
the `.project-card-media` div in `projects.html`, not as `<img>` tags, so
that is the place to swap one.

## 3. The contact form — done

The form at the bottom of `about.html` posts to
[Formspree](https://formspree.io) (free tier, no backend needed), which
catches the submission and emails it to tonyc.cn.au@gmail.com. It is live —
the endpoint is `https://formspree.io/f/mgawlplz`. That URL is public by
design and is not a secret.

Two things not to break if you edit the form:

- **The field named `email` is Formspree's Reply-To.** Rename it and replying
  to a notification stops reaching the sender.
- **`_gotcha` is a spam honeypot**, hidden from people and filled in by bots;
  Formspree drops anything that arrives with it set. It is deliberately
  `display:none`, `tabindex="-1"` and `aria-hidden`, so it stays out of the
  tab order and away from screen readers. Leave all three on.

The Instagram link (**@toy.hen**) is filled in, in the `social-links` block
in `about.html`. There is no Vimeo or LinkedIn link yet.

## 4. Preview locally

**Don't just double-click `index.html`.** The YouTube embeds will fail with
"Error 153 / Video player configuration error" when loaded via a bare
`file://` path — YouTube's player requires a real HTTP origin to initialize.
Always preview through a local server instead.

If you have Node.js installed:

```bash
npx serve .
```

If you don't have Node.js (this machine didn't), a zero-install option is
included — `serve.ps1`, a tiny static file server written in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open `http://localhost:5500/`. `serve.ps1` is a local dev convenience
only — it isn't needed once the site is deployed to GitHub Pages (GitHub
serves everything over `https://`, so the video embeds work automatically
there).

## 5. Push to GitHub and enable GitHub Pages

```bash
git init
git add .
git commit -m "Initial portfolio site"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Then in the GitHub repo: **Settings → Pages → Source → Deploy from branch →
main → / (root)**. Your site will be live at
`https://<your-username>.github.io/<repo-name>/` within a minute or two.

If you want it at the root of `<your-username>.github.io` (no repo name in
the URL), name the repo exactly `<your-username>.github.io`.

## 6. Adding the two extra projects later

Duplicate one of the files in `projects/`, update the title/meta/copy, add a
thumbnail to `images/projects/`, then add a matching card to `projects.html`
and (optionally) the featured grid in `index.html`.

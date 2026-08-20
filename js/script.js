function initSite() {
  /* ---------- mobile nav ---------- */
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");

  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const isOpen = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    links.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => links.classList.remove("open"));
    });
  }

  /* ---------- hero background loop ----------
     The hero is the only clip on the site that plays without being asked, so it
     is the only place prefers-reduced-motion still has to be honoured &mdash;
     everywhere else nothing moves until a visitor presses Play, which is why
     those branches were dropped. It also stays a still on Save-Data: this is the
     landing page, and a background flourish is the first thing worth dropping.
     Either way the poster carries the design, so nothing looks broken. */
  const heroSection = document.querySelector("[data-hero-video]");
  if (heroSection) initHeroVideo(heroSection);

  function initHeroVideo(section) {
    const video = section.querySelector("video[data-src]");
    if (!video) return;

    const reduced = window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const conn = navigator.connection;
    const saveData = !!(conn && conn.saveData);
    /* 2g only. A phone on 3g gets the clip, because on a phone it no longer
       competes with anything &mdash; see the deferral below. */
    const slowLink = !!(conn && /(^|-)2g$/.test(conn.effectiveType || ""));
    if (reduced || saveData || slowLink) return;   // poster stands in; nothing downloads

    /* PHONES GET THE CLIP TOO, BUT LAST. It used to be desktop-only on an
       innerWidth < 700 gate, dropped 20 Aug 2026: the loop is the one thing on
       the page that says the work is animated, and cutting it left the phone
       with the least persuasive version of the site.

       What actually made it wrong on a phone was WHEN it loaded, not that it
       loaded. Measured at 375px: `load` fires after ~1.37MB, because
       loading="lazy" still pulls ten of the twelve sheet stills in ahead of it
       &mdash; the threshold is generous, so "below the fold" does not mean
       "later". Fetched eagerly, the clip's 472KB sat in the middle of that
       queue competing with the pictures. Deferred, it is the last request the
       page makes and nothing waits on it.

       Two gates, and the second is the one that saves the data:
         - wait for `load`, so the clip queues behind everything the page
           actually needs. A bare timer fires while the stills are still
           arriving and puts the clip in the queue beside them, which is the
           problem it was meant to avoid.
         - only fetch if the hero is STILL ON SCREEN. Somebody who scrolled
           straight to the sheet never pays for it. If they scroll back up, the
           observer below starts it then &mdash; deferred, not cancelled.

       There is deliberately NO separate mobile encode. A portrait crop to the
       band a phone actually shows is the only re-encode that saves anything
       worth having (620x720 at crf 32 is 305KB, SSIM 0.979), and it over-zooms
       on a sub-700px LANDSCAPE viewport, where the browser would otherwise show
       the full width. Full-frame downscales save nothing at all &mdash; 960x540
       at crf 30 comes out at 441KB against the shipped 483KB, because the
       shipped file is already only 268kbps. One file, one framing. */
    const deferred = window.innerWidth < 700;
    const SETTLE_MS = 1200;   // quiet time after `load` before the clip is asked for

    let started = false;
    let onScreen = true;
    let armed = false;   // `load` has fired and the settle time has passed

    function start() {
      if (started) return;
      started = true;
      /* preload="none" plus a src alone leaves the element at readyState 0 for
         ever, so canplay never fires. Set preload AND call load() &mdash; the
         same trap the stepper and the media grid work around. */
      video.src = video.dataset.src;
      delete video.dataset.src;
      video.preload = "auto";
      video.load();

      video.addEventListener("canplay", () => {
        const p = video.play();
        /* Muted autoplay is allowed without a gesture, but if a browser ever
           refuses there is nothing to recover: the poster is already the frame
           the clip opens on, so a refusal just leaves the hero as a still.
           iOS Low Power Mode refuses exactly this, so some phones will fetch
           the clip and show the still anyway &mdash; nothing on the page can
           know that before asking. */
        if (p && p.catch) p.catch(() => {});
      }, { once: true });
    }

    /* Stop it once the hero has scrolled away rather than decode a clip nobody
       can see, and pick it up again on the way back. On a phone this observer
       is also what arms the deferred start, so it is set up BEFORE anything
       loads rather than after. */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          onScreen = e.isIntersecting;
          if (!onScreen) {
            if (started) video.pause();
            return;
          }
          if (!started) {
            /* Only reachable on the deferred path, and only once `load` has
               fired &mdash; scrolling back to a hero whose settle timer has not
               run yet leaves `armed` false and the timer still does the work. */
            if (armed) start();
            return;
          }
          const p = video.play();
          if (p && p.catch) p.catch(() => {});
        });
      }, { threshold: 0 }).observe(section);
    }

    function release() {
      window.setTimeout(() => {
        armed = true;
        if (onScreen) start();   // otherwise the observer picks it up on the way back
      }, SETTLE_MS);
    }

    if (!deferred) {
      start();
    } else if (document.readyState === "complete") {
      release();
    } else {
      window.addEventListener("load", release, { once: true });
    }
  }

  /* ---------- swipe ----------
     One horizontal drag = one step, used by the scrubber viewer, a multi-frame
     media-grid tile and the lightbox. Everything these three do was already
     reachable with a pointer or a keyboard; on a phone the only thing to hand
     is the media itself, so it has to be the control.

     Pointer events rather than touch events, so a mouse drag works the same
     way — but the browser has to be told the horizontal axis is ours or it
     cancels the gesture the moment it decides you are scrolling. That is
     `touch-action: pan-y` in the stylesheet, on each element wired up here:
     vertical scrolling still belongs to the page, horizontal comes to us.

     A swipe must not also count as a tap — a tile's click opens the lightbox
     and the lightbox's own click steps a frame. The capture-phase listener
     swallows the click that follows a swipe; the flag clears on the next
     pointerdown rather than on a timer, because the synthetic click can land
     in the same task as pointerup and a setTimeout(0) would be too late. */
  function addSwipe(el, onSwipe) {
    const MIN = 40;      // px of travel before it counts as a swipe
    const SLOPE = 1.4;   // how much more horizontal than vertical it must be
    let id = null;
    let x0 = 0;
    let y0 = 0;
    let fired = false;
    let swallow = false;

    el.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary) return;
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      fired = false;
      swallow = false;
    });

    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id || fired) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (Math.abs(dx) < MIN || Math.abs(dx) < Math.abs(dy) * SLOPE) return;
      // one step per gesture: lift and swipe again for the next one, which is
      // steadier than a running total over a long drag
      fired = true;
      swallow = true;
      onSwipe(dx < 0 ? 1 : -1);   // drag left = forward, like a filmstrip
    });

    const end = (e) => { if (e.pointerId === id) id = null; };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);

    el.addEventListener("click", (e) => {
      if (!swallow) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  /* ---------- touch preview tracking ----------
     Shared by the media grid and the home page sheet. Both preview a clip under
     the pointer, and a finger has no pointer to give them: it produces
     mouseenter/mouseleave only as a synthetic pair *after a tap*, and a tap is
     already the gesture that opens the lightbox or follows the link. So before
     this, the only way to see a clip run on a phone was to commit to leaving
     the page you were on.

     Each component registers its tiles here with their own enter/leave, and the
     tracker starts whatever a dragging finger arrives on and stops what it
     left — the same "what's under me" preview a pointer gets for free.

     Declared up here rather than beside the media grid because initSheet runs
     further up the file, and a `const` below it would still be in its temporal
     dead zone when the sheet registers its cells. */
  const tileHandlers = new Map();
  let touchTile = null;
  let touchWired = false;

  function wireTouchTracking() {
    if (touchWired) return;
    touchWired = true;

    /* Listen on the document, not on the component: touch events target
       wherever the finger went *down*, so a scroll begun on the text above a
       grid never reaches the grid at all — which is the common case.
       elementFromPoint is in viewport coordinates, exactly what a moving
       finger gives us. */
    const track = (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const tile = el && el.closest ? el.closest("figure, .sheet-cell") : null;
      const next = tile && tileHandlers.has(tile) ? tile : null;
      if (next === touchTile) return;
      if (touchTile) tileHandlers.get(touchTile).leave();
      touchTile = next;
      if (next) tileHandlers.get(next).enter();
    };

    /* Passive: this must never interfere with the scroll that is carrying the
       finger across the tiles in the first place. Nothing stops on touchend —
       the tile you lifted on is the one you stopped to look at, so it keeps
       playing until the next gesture reaches a different tile. */
    document.addEventListener("touchstart", track, { passive: true });
    document.addEventListener("touchmove", track, { passive: true });
  }

  /* ---------- contact sheet ----------
     Every cell ships as a still inside a link, and that is the component. A cell
     carrying data-clip grows a <video> the first time a pointer or a finger
     reaches it, which is also when the file is first fetched — so motion costs
     nothing on load.

     The clip is deliberately a bonus and never the reason a cell is legible:
     a still-only cell is a complete cell.

     The clip is deliberately a bonus and never the reason a cell is legible:
     a still-only cell is a complete cell. */
  const sheet = document.querySelector("[data-sheet]");
  if (sheet) initSheet(sheet);

  function initSheet(grid) {
    const mq = window.matchMedia;
    /* The only thing that stops a cell previewing now is a stated preference
       for less motion. It used to be "no pointer" as well: a touch screen had
       no way to reach the preview, so the cells stayed plain stills and, more
       importantly, did not advertise motion they could not play. The touch
       tracker gives a finger the same reach a pointer has, so the badge is
       honest on a phone and the gate comes off. */
    const still = !!(mq && mq("(prefers-reduced-motion: reduce)").matches);

    grid.querySelectorAll(".sheet-cell[data-clip]").forEach((tile) => {
      /* Only claim there is motion once we know we will actually play it. */
      if (!still) {
        const badge = document.createElement("span");
        badge.className = "sheet-motion";
        badge.setAttribute("aria-hidden", "true");
        badge.textContent = "▶";
        tile.appendChild(badge);
      }

      let video = null;

      function enter() {
        if (still) return;
        if (!video) {
          video = document.createElement("video");
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          /* Decorative: the <img> already carries the description, and the tile
             is a link, so the clip must not be a second tab stop. */
          video.setAttribute("aria-hidden", "true");
          video.tabIndex = -1;
          /* A src alone leaves preload="none" elements at readyState 0 for ever.
             Set preload AND load() — same trap as the stepper. */
          video.preload = "auto";
          video.src = tile.dataset.clip;
          tile.appendChild(video);
          video.load();
        }
        const p = video.play();
        if (p && p.catch) p.catch(() => {});
        video.classList.add("is-playing");
      }

      /* Clearing touchTile covers every way a cell can be stopped that the
         tracker didn't cause — a synthetic mouseleave after a tap most of all.
         Without it the tracker still believes the finger is on this cell and
         skips restarting it when the finger comes back. */
      function leave() {
        if (touchTile === tile) touchTile = null;
        if (!video) return;
        video.classList.remove("is-playing");
        video.pause();
      }

      tile.addEventListener("mouseenter", enter);
      tile.addEventListener("mouseleave", leave);
      tile.addEventListener("focus", enter);
      tile.addEventListener("blur", leave);
      /* A drag across the sheet previews whatever it passes over. The cell is a
         link, so a tap still opens the project — this only reads the finger,
         never swallows it, and a drag that scrolls fires no click. */
      if (!still) {
        tileHandlers.set(tile, { enter, leave });
        wireTouchTracking();
      }
    });
  }

  /* ---------- before / after shot comparison ----------
     Two clips of one shot kept in lockstep. Sources sit in data-src so
     nothing downloads until the pair scrolls into view. */
  document.querySelectorAll("[data-compare]").forEach(initCompare);

  /* ---------- frame stepper ----------
     Progressive enhancement over a .framestrip: with JS off the markup is a
     grid of captured frames, which already makes the point. Here it becomes
     one large frame the reader advances by hand.

     The frames come from a video rather than a folder of stills on purpose —
     109 JPGs at this size run to several megabytes, the same frames as h264
     are well under one. Stepping is just a seek to the middle of frame n. */
  /* Every tile's "pointer left" handler. Opening the lightbox covers the grid
     but doesn't necessarily fire mouseleave on the tile underneath, so the
     cycle (and any clip) would carry on running behind it.
     Declared before the init call below: initMediaGrid fills it as it runs, and
     a `const` further down the file is still in its temporal dead zone here. */
  const tileLeavers = [];

  document.querySelectorAll("[data-mediagrid]").forEach(initMediaGrid);

  /* ---------- media grid + lightbox ----------
     For a set of related items that are NOT in step with each other, so there
     is deliberately no shared play/pause: each clip loads and loops on its own
     once it scrolls into view. Any tile can be opened large. */
  let box = null;
  let boxReturnFocus = null;
  let boxFig = null;   // the open tile, when it has a batch of frames
  let boxIdx = 0;
  /* Closing hands focus back to the tile, which fires its focus handler — the
     same handler that starts a preview. Without this the cycle restarts the
     instant you close the enlarged view. */
  let restoringFocus = false;

  function closeBox() {
    if (!box || box.hidden) return;
    box.hidden = true;
    box.querySelector(".lightbox-inner").innerHTML = "";
    box.querySelector(".lightbox-count").textContent = "";
    boxFig = null;
    document.body.style.overflow = "";
    if (boxReturnFocus) {
      restoringFocus = true;
      boxReturnFocus.focus();
      // let the focus event land before tiles are allowed to preview again
      setTimeout(() => { restoringFocus = false; }, 0);
    }
  }

  /* Step through a multi-frame tile without leaving the lightbox — click the
     image, or use the arrow keys. */
  function stepBox(d) {
    if (!boxFig || !boxFig.frames) return;
    const fr = boxFig.frames;
    boxIdx = (boxIdx + d + fr.length) % fr.length;
    const im = box.querySelector(".lightbox-inner img");
    if (!im) return;
    im.classList.add("is-swapping");
    const done = () => { im.src = fr[boxIdx]; im.classList.remove("is-swapping"); };
    const pre = new Image();
    pre.onload = done;
    pre.onerror = done;
    pre.src = fr[boxIdx];
    box.querySelector(".lightbox-count").textContent = (boxIdx + 1) + " / " + fr.length;
  }

  function openBox(fig) {
    // settle the grid first — nothing should still be cycling or playing
    // underneath while the enlarged view is up
    tileLeavers.forEach((fn) => fn());

    if (!box) {
      box = document.createElement("div");
      box.className = "lightbox";
      box.hidden = true;
      box.innerHTML =
        '<button type="button" class="lightbox-close">Close</button>' +
        '<div><div class="lightbox-inner"></div>' +
        '<p class="lightbox-cap"></p><p class="lightbox-count"></p></div>';
      box.addEventListener("click", (e) => {
        // backdrop only — clicks on the media itself shouldn't dismiss it
        if (e.target === box || e.target.classList.contains("lightbox-close")) closeBox();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { closeBox(); return; }
        if (box.hidden || !boxFig) return;
        if (e.key === "ArrowRight") { e.preventDefault(); stepBox(1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); stepBox(-1); }
      });
      /* Swiping the enlarged image steps it, the same as clicking it or using
         the arrow keys. On the media itself rather than the backdrop, which
         dismisses. stepBox already ignores a single-frame tile. */
      addSwipe(box.querySelector(".lightbox-inner"), stepBox);
      document.body.appendChild(box);
    }

    const src = fig.querySelector("video, img");
    if (!src) return;
    const inner = box.querySelector(".lightbox-inner");
    inner.innerHTML = "";

    let big;
    if (src.tagName === "VIDEO") {
      big = document.createElement("video");
      big.src = src.getAttribute("src") || src.getAttribute("data-src");
      big.muted = true;
      big.loop = true;
      big.playsInline = true;
      big.controls = true;
      big.setAttribute("aria-label", src.getAttribute("aria-label") || "");
      const p = big.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      big = document.createElement("img");
      big.alt = src.getAttribute("alt") || "";
      // a multi-frame tile opens on whichever frame was on screen, and can be
      // clicked through from there
      boxFig = fig.frames ? fig : null;
      boxIdx = boxFig ? (fig.frameIndex || 0) : 0;
      big.src = boxFig ? boxFig.frames[boxIdx] : src.getAttribute("src");
      if (boxFig) {
        big.classList.add("is-steppable");
        big.title = "Next frame";
        big.addEventListener("click", () => stepBox(1));
      }
    }
    inner.appendChild(big);

    const name = fig.querySelector("strong");
    const note = fig.querySelector("figcaption span");
    box.querySelector(".lightbox-cap").textContent =
      [name && name.textContent, note && note.textContent].filter(Boolean).join(" — ");
    box.querySelector(".lightbox-count").textContent =
      boxFig ? (boxIdx + 1) + " / " + boxFig.frames.length : "";

    boxReturnFocus = fig;
    box.hidden = false;
    document.body.style.overflow = "hidden";
    box.querySelector(".lightbox-close").focus();
  }

  function initMediaGrid(grid) {
    if (grid.dataset.gridReady || !grid.classList.contains("mediagrid")) return;
    grid.dataset.gridReady = "1";

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const figs = Array.from(grid.querySelectorAll("figure"));

    /* preload="none" means setting src alone fetches nothing — the element
       stays at readyState 0 and never fires canplay. It needs both the
       preload change and an explicit load(). */
    function load(v) {
      if (v.getAttribute("src")) return;
      const s = v.getAttribute("data-src");
      if (!s) return;
      v.setAttribute("preload", "auto");
      v.setAttribute("src", s);
      v.load();
    }

    /* Preview on hover rather than on sight: several clips looping at once
       fights for attention and none of them wins. Nothing downloads until
       the pointer arrives, which also keeps the tiles cheap. */
    function preview(v, on) {
      if (!v) return;
      if (!on) { delete v.dataset.wanted; v.pause(); return; }
      v.dataset.wanted = "1";
      load(v);
      if (reduced) return;
      /* First hover sets src, so the file usually isn't decodable yet and
         play() rejects. Wait for data, then re-check the pointer is still
         here — otherwise a slow load starts playing after you've left. */
      const go = () => {
        if (!v.dataset.wanted) return;
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      };
      if (v.readyState >= 2) go();
      else v.addEventListener("canplay", go, { once: true });
    }

    /* A still tile can carry more than one frame of the same subject — the
       wing skinned, the bare ribs, the measured draft. The extra paths live in
       data-frames rather than as more <img> elements, so the shipped markup
       still has exactly one image for the no-JS view, and none of the extras
       download until the pointer arrives. Same rule the clips follow.

       Returns a run(on) function, or null when there's nothing to cycle. */
    function initFrames(f) {
      const img = f.querySelector("img");
      if (!img || f.querySelector("video")) return null;
      const extra = (f.dataset.frames || "").split("|")
        .map((s) => s.trim()).filter(Boolean);
      if (!extra.length) return null;

      const srcs = [img.getAttribute("src")].concat(extra);
      let i = 0;
      let timer = null;
      let primed = false;

      /* Cycle timing, all in one place.
         FADE_MS must match the .frame-top opacity transition in style.css —
         JS uses it to know when the top has finished fading and can be
         repointed, so if the two drift the swap lands early and flickers.
         FIRST_MS is deliberately shorter than STEP_MS: a plain interval leaves
         the tile sitting still for a whole period, which reads as though the
         hover did nothing at all. */
      const STEP_MS  = 800;
      const FIRST_MS = 380;
      const FADE_MS  = 260;

      /* Two layers, so a swap never shows the empty tile behind. The next
         frame is parked on an underlay and the top image fades *away* to
         reveal it; once it's invisible the top is repointed at the same file
         and snapped back to opaque, which changes nothing on screen.
         The underlay goes after the base in the DOM and is pushed behind with
         z-index, so figure.querySelector("img") still finds the real image. */
      img.classList.add("frame-top");
      const under = document.createElement("img");
      under.className = "frame-under";
      under.alt = "";
      under.setAttribute("aria-hidden", "true");
      img.insertAdjacentElement("afterend", under);

      /* One dot per frame, so a tile with more to show says so at rest — and
         each is a real button, so you can jump straight to a frame instead of
         waiting for the cycle to come round. */
      let hold = false;   // set once the viewer picks a frame by hand
      let live = false;   // pointer/focus is on the tile
      let fadeT = null;   // the pending "swap the top over" step
      const dots = document.createElement("div");
      dots.className = "frame-dots";
      srcs.forEach((s, k) => {
        const d = document.createElement("button");
        d.type = "button";
        d.className = "frame-dot";
        d.setAttribute("aria-label", "Frame " + (k + 1) + " of " + srcs.length);
        d.addEventListener("click", (e) => {
          // the tile itself opens the lightbox on click — a dot must not
          e.stopPropagation();
          e.preventDefault();
          pick(k);
        });
        d.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        });
        dots.appendChild(d);
      });
      f.appendChild(dots);
      const mark = () => {
        Array.from(dots.children).forEach((d, k) => {
          d.classList.toggle("is-on", k === i);
          d.setAttribute("aria-current", k === i ? "true" : "false");
        });
      };
      mark();

      /* Cross-fade: decode the next frame, put it on the underlay, then fade
         the top away to it. Nothing is ever transparent over an empty tile. */
      function show(n) {
        n = (n + srcs.length) % srcs.length;
        if (n === i) return;
        i = n;
        f.frameIndex = i;
        mark();
        if (reduced) {
          img.setAttribute("src", srcs[i]);
          under.setAttribute("src", srcs[i]);
          return;
        }
        const pre = new Image();
        const go = () => {
          if (f.frameIndex !== i) return;
          under.setAttribute("src", srcs[i]);
          /* If the tile was left (or the lightbox opened) while this frame was
             still decoding, land on it without animating. Bailing out here
             instead would leave `i` ahead of what's on screen, and the next
             show(i) would return early as a no-op — the tile would stick on a
             stale frame with the wrong dot lit. */
          if (!live) { img.setAttribute("src", srcs[i]); return; }
          /* Give the underlay a beat to paint before the top starts to go.
             A timeout rather than requestAnimationFrame: rAF is suspended
             entirely while the page isn't rendering, which would strand the
             swap half-done with `i` ahead of what's on screen. */
          fadeT = setTimeout(() => {
            if (f.frameIndex !== i) return;
            if (!live) { img.setAttribute("src", srcs[i]); return; }
            img.classList.add("is-fading");
            fadeT = setTimeout(() => { fadeT = null; settle(); }, FADE_MS);
          }, 20);
        };
        pre.onload = go;
        pre.onerror = go;
        pre.src = srcs[i];
      }

      /* Land on the current frame right now: repoint the top at whatever the
         underlay is already showing and snap it back opaque, with no
         transition so there is nothing to see. Called when the fade finishes
         normally, and again if the tile is stopped mid-fade — otherwise a
         pending swap fires after the lightbox is already open, and the tile
         appears to keep cycling behind it. */
      function settle() {
        if (fadeT) { clearTimeout(fadeT); fadeT = null; }
        if (!img.classList.contains("is-fading")) return;
        img.classList.add("no-anim");
        img.setAttribute("src", srcs[i]);
        img.classList.remove("is-fading");
        void img.offsetWidth;
        img.classList.remove("no-anim");
      }

      /* Choosing a frame by hand — a dot, or a swipe across the tile — stops
         the automatic cycle for as long as the tile stays live, so it holds
         still on whatever you went looking for. */
      function pick(n) {
        hold = true;
        if (timer) { clearTimeout(timer); timer = null; }
        show(n);
      }

      // the lightbox reads these to step through the same batch
      f.frames = srcs;
      f.frameIndex = 0;
      f.stepFrame = (d) => pick(i + d);

      return function run(on) {
        if (timer) { clearTimeout(timer); timer = null; }
        // leaving stops the cycle but keeps the frame you left on — snapping
        // back to the first one throws away what you were looking at
        if (!on) { live = false; hold = false; settle(); return; }
        live = true;
        if (!primed) {
          primed = true;
          extra.forEach((s) => { const p = new Image(); p.src = s; });
        }
        // reduced motion: the dots and the lightbox still work, it just
        // doesn't cycle on its own
        if (reduced) return;
        /* A self-rescheduling timeout rather than setInterval, so the first
           step can be quicker than the rest and each period is measured from
           the previous swap instead of from a fixed clock — an interval keeps
           firing while a frame is still decoding and the steps pile up.
           show() waits on the image's own load event, so on the very first
           hover (when the extra frames have only just been requested) the
           swap lands as soon as it is decoded rather than at exactly
           FIRST_MS. That is the floor, not the guarantee. */
        timer = setTimeout(function step() {
          show(i + 1);
          timer = setTimeout(step, STEP_MS);
        }, FIRST_MS);
      };
    }

    figs.forEach((f) => {
      if (!f.querySelector("video, img")) return;
      const v = f.querySelector("video");
      const cycle = initFrames(f);
      /* Nothing previews while the enlarged view is up, or while focus is
         being handed back to the tile as it closes. A click focuses the tile
         *before* it fires click, so without the first guard the cycle would
         also restart underneath the lightbox it just opened. */
      const enter = () => {
        if (restoringFocus || (box && !box.hidden)) return;
        preview(v, true);
        if (cycle) cycle(true);
      };
      /* Clearing touchTile here covers every way a tile can be stopped that
         the touch tracker didn't cause — a synthetic mouseleave, the lightbox
         opening. Without it the tracker still believes the finger is on this
         tile and skips restarting it when the finger comes back. */
      const leave = () => {
        if (touchTile === f) touchTile = null;
        preview(v, false);
        if (cycle) cycle(false);
      };
      tileLeavers.push(leave);
      tileHandlers.set(f, { enter, leave });
      wireTouchTracking();
      f.addEventListener("mouseenter", enter);
      f.addEventListener("mouseleave", leave);
      // keyboard parity — tabbing to a tile previews it too
      f.addEventListener("focus", enter);
      f.addEventListener("blur", leave);
      // a batch of frames steps on a swipe, the touch equivalent of the dots
      if (cycle && f.frames) addSwipe(f, (d) => f.stepFrame(d));
      f.classList.add("is-zoomable");
      f.tabIndex = 0;
      f.setAttribute("role", "button");
      const name = f.querySelector("strong");
      f.setAttribute("aria-label", "Enlarge" + (name ? ": " + name.textContent : ""));
      f.addEventListener("click", () => openBox(f));
      f.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBox(f); }
      });
    });
  }

  document.querySelectorAll("[data-stepper]").forEach(initStepper);

  function initStepper(source) {
    if (source.dataset.stepperReady) return;

    /* One <figure> per shot. Reading them out of the markup rather than a
       config blob keeps the no-JS view honest: with scripts off the same
       elements are a plain grid of shot stills with captions. */
    const shots = Array.from(source.querySelectorAll("figure"))
      .map((fig) => ({
        src: fig.dataset.shotSrc,
        fps: parseFloat(fig.dataset.shotFps) || 25,
        label: fig.dataset.shotLabel || "",
        alt: fig.dataset.shotAlt || "",
        note: fig.dataset.shotNote || "",
        poster: (fig.querySelector("img") || {}).src || ""
      }))
      .filter((s) => s.src);
    if (!shots.length) return;
    source.dataset.stepperReady = "1";

    const label = source.dataset.stepper || "";

    const wrap = document.createElement("div");
    wrap.className = "stepper";
    wrap.innerHTML =
      '<div class="step-viewer">' +
        '<span class="step-stamp"></span>' +
        '<video class="step-video" muted playsinline preload="none"></video>' +
        '<span class="step-count"></span>' +
      "</div>" +
      '<div class="step-bar">' +
        '<button type="button" class="step-btn" data-dir="-1" aria-label="Previous frame">&#9664;</button>' +
        '<input type="range" class="step-range" min="0" max="0" value="0" step="1" aria-label="Frame">' +
        '<button type="button" class="step-btn" data-dir="1" aria-label="Next frame">&#9654;</button>' +
        '<button type="button" class="step-play">Play</button>' +
      "</div>" +
      '<p class="step-hint"></p>' +
      '<div class="step-shots" role="tablist" aria-label="Shots"></div>';

    const video = wrap.querySelector(".step-video");
    const stamp = wrap.querySelector(".step-stamp");
    const count = wrap.querySelector(".step-count");
    const range = wrap.querySelector(".step-range");
    const play = wrap.querySelector(".step-play");
    const hint = wrap.querySelector(".step-hint");
    const shelf = wrap.querySelector(".step-shots");
    const steps = Array.from(wrap.querySelectorAll(".step-btn"));

    let fps = shots[0].fps;
    let current = -1;

    const tabs = shots.map((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "step-shot";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-label", "Shot " + (i + 1) + ": " + s.label);
      b.innerHTML = '<img alt=""><span></span>';
      b.querySelector("img").src = s.poster;
      b.querySelector("span").textContent = s.label;
      b.addEventListener("click", () => selectShot(i));
      shelf.appendChild(b);
      return b;
    });

    let total = 0;
    let frame = 0;
    let playing = false;
    const pad = (n) => String(n).padStart(3, "0");

    /* Seek to the middle of a frame, not its edge: currentTime lands on a
       boundary otherwise and rounding can show the neighbour. */
    function seek(i) {
      frame = Math.max(0, Math.min(total - 1, i));
      video.currentTime = (frame + 0.5) / fps;
      range.value = frame;
      count.textContent = pad(frame + 1) + " / " + pad(total);
      steps[0].disabled = frame === 0;
      steps[1].disabled = frame === total - 1;
    }

    function stopPlayback() {
      video.pause();
      playing = false;
      play.textContent = "Play";
    }

    video.addEventListener("loadedmetadata", () => {
      total = Math.max(1, Math.round(video.duration * fps));
      range.max = total - 1;
      const s = shots[current];
      /* Frame count plus whatever the shot's note says, and nothing about how
         to work the control — the slider and the arrows explain themselves.
         The note is authored prose, so punctuate only if it doesn't already. */
      const note = s && s.note ? s.note.trim() : "";
      let line = total + " exposures" + (note ? " — " + note : "");
      if (!/[.!?]$/.test(line)) line += ".";
      hint.textContent = line;
      seek(0);
    });

    /* Swapping shot re-points the same <video>: one element, one set of
       listeners, and only the chosen clip is ever downloaded. */
    function selectShot(i) {
      if (i === current) return;
      if (playing) stopPlayback();
      current = i;
      const s = shots[i];
      fps = s.fps;
      total = 0;
      stamp.textContent = label ? label + " / " + s.label : s.label;
      count.textContent = "";
      range.max = 0;
      range.value = 0;
      video.setAttribute("aria-label", s.alt);
      if (s.poster) video.setAttribute("poster", s.poster);
      video.setAttribute("preload", "auto");
      video.setAttribute("src", s.src);
      video.load();
      tabs.forEach((b, j) => {
        b.setAttribute("aria-selected", i === j ? "true" : "false");
        b.tabIndex = i === j ? 0 : -1;
      });
    }

    range.addEventListener("input", () => {
      if (playing) stopPlayback();
      seek(parseInt(range.value, 10));
    });

    steps.forEach((b) => {
      b.addEventListener("click", () => {
        if (playing) stopPlayback();
        seek(frame + parseInt(b.dataset.dir, 10));
      });
    });

    play.addEventListener("click", () => {
      if (playing) { stopPlayback(); return; }
      if (frame >= total - 1) seek(0);
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
      playing = true;
      play.textContent = "Pause";
    });

    /* While it plays, the slider and counter follow the video rather than
       driving it — otherwise the input handler would fight playback. */
    video.addEventListener("timeupdate", () => {
      if (!playing) return;
      const i = Math.min(total - 1, Math.floor(video.currentTime * fps));
      frame = i;
      range.value = i;
      count.textContent = pad(i + 1) + " / " + pad(total);
    });
    video.addEventListener("ended", () => { stopPlayback(); seek(total - 1); });

    /* Stepping needs the file buffered, so hold off until it scrolls into
       view — otherwise every visitor pays for a clip they may never reach. */
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) { if (playing) stopPlayback(); return; }
          if (current < 0) selectShot(0);
        });
      }, { threshold: 0.2 });
      io.observe(wrap);
    } else {
      selectShot(0);
    }

    source.setAttribute("hidden", "");
    source.parentNode.insertBefore(wrap, source);
  }

  function initCompare(root) {
    if (root.dataset.compareReady) return;
    const vids = Array.from(root.querySelectorAll("video"));
    if (!vids.length) return;
    root.dataset.compareReady = "1";

    let loaded = false;
    let playing = false;
    /* Whether the visitor asked for playback, as opposed to the observer
       resuming it. Nothing here starts on its own — the block loads on
       approach and sits on its poster until the Play button is pressed. */
    let wantsPlay = false;

    /* Frame stepping state. There is no way to read a clip's frame rate off
       the DOM, so it comes from the encode convention (12fps) and
       data-compare-fps overrides it where a pair was cut at something else
       (the Night Vision rig pair is 24). Get it wrong and the buttons still
       move the clips, just not by exactly one frame. */
    const fps = parseFloat(root.dataset.compareFps) || 12;
    let frame = 0;
    let total = 0;
    let stepPrev = null;
    let stepNext = null;

    function load() {
      if (loaded) return;
      loaded = true;
      vids.forEach((v) => {
        const src = v.getAttribute("data-src");
        if (!src || v.getAttribute("src")) return;
        /* preload="none" plus a src alone leaves the element at readyState 0
           forever, so a seek would silently do nothing and the step buttons
           would look broken. Needs preload="auto" AND an explicit .load(),
           same pairing the stepper and the media grid use. */
        v.setAttribute("preload", "auto");
        v.setAttribute("src", src);
        v.load();
      });
    }

    function play() {
      load();
      // restart together so the two stay aligned however long they've idled
      frame = 0;
      vids.forEach((v) => { v.currentTime = 0; });
      vids.forEach((v) => {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      });
      playing = true;
      if (toggle) toggle.textContent = "Pause";
      syncSteps();
    }

    function pause() {
      vids.forEach((v) => v.pause());
      playing = false;
      if (toggle) toggle.textContent = "Play";
      syncSteps();
    }

    /* Ends are only worth marking while the pair is parked: mid-playback the
       first and last frames fly past and the buttons would flicker disabled
       once per loop. */
    function syncSteps() {
      if (!stepPrev) return;
      stepPrev.disabled = !playing && frame <= 0;
      stepNext.disabled = !playing && total > 0 && frame >= total - 1;
    }

    /* Land in the middle of a frame rather than on its edge — on a boundary,
       rounding can show the neighbour instead. Same seek the stepper makes. */
    function step(delta) {
      load();
      // stepping means the visitor is driving by hand now
      wantsPlay = false;
      if (playing) pause();
      const last = total > 0 ? total - 1 : frame + delta;
      frame = Math.max(0, Math.min(last, frame + delta));
      vids.forEach((v) => { v.currentTime = (frame + 0.5) / fps; });
      syncSteps();
    }

    const toggle = root.querySelector(".compare-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        wantsPlay = !playing;
        if (playing) pause(); else play();
      });
      toggle.textContent = "Play";
    }

    /* The two step buttons are built here rather than authored into every
       .compare-bar, so copying an existing block gets them for free — same
       property as adding or removing a panel. They bracket the transport:
       previous, play/pause, next. */
    const bar = root.querySelector(".compare-bar");
    if (bar && toggle) {
      const mkStep = (dir, label, glyph) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "compare-step";
        b.setAttribute("aria-label", label);
        b.innerHTML = glyph;
        b.addEventListener("click", () => step(dir));
        return b;
      };
      stepPrev = mkStep(-1, "Previous frame", "&#9664;");
      stepNext = mkStep(1, "Next frame", "&#9654;");
      bar.insertBefore(stepPrev, toggle);
      bar.insertBefore(stepNext, toggle.nextSibling);
      syncSteps();
    }

    vids[0].addEventListener("loadedmetadata", () => {
      total = Math.max(1, Math.round(vids[0].duration * fps));
      syncSteps();
    });

    /* Track the frame index through playback so a step picks up from what is
       on screen, not from wherever it was last parked. */
    vids[0].addEventListener("timeupdate", () => {
      if (playing) frame = Math.floor(vids[0].currentTime * fps);
    });

    /* Drift correction: each clip decodes independently, so nudge every other
       one back to the first whenever it slips more than a frame apart. Works
       for any number of layers — two for a before/after, three for a
       plate / linework / composite build-up. */
    if (vids.length > 1) {
      vids[0].addEventListener("timeupdate", () => {
        if (!playing) return;
        const lead = vids[0].currentTime;
        for (let i = 1; i < vids.length; i++) {
          if (Math.abs(vids[i].currentTime - lead) > 0.12) vids[i].currentTime = lead;
        }
      });
    }

    /* The observer gates loading and stops a clip that has scrolled away — it
       does not start anything. Coming back into view resumes only what the
       visitor had running, so a block they never touched stays on its poster.
       This also makes the old prefers-reduced-motion branch unnecessary:
       nothing moves until it is asked to, for everyone. */
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            load();
            if (wantsPlay && !playing) play();
          } else if (playing) {
            pause();
          }
        });
      }, { threshold: 0.35 });
      io.observe(root);
    } else {
      load();
    }
  }

  /* ---------- progression scrubber ----------
     Progressive enhancement: the markup ships as a plain list of <figure>
     elements inside [data-scrubber], so with JS off every stage is still
     visible and captioned. This upgrades that list into a single viewer
     plus a labelled track. */
  document.querySelectorAll("[data-scrubber]").forEach(initScrubber);

  function initScrubber(source) {
    // guard against running twice over the same markup
    if (source.dataset.scrubberReady) return;
    const figures = Array.from(source.querySelectorAll("figure"));
    if (figures.length < 2) return;
    source.dataset.scrubberReady = "1";

    /* A stage is a still (<img>), a silent looping clip (<video>), or a gap
       (neither). Video is used rather than GIF because on this project's own
       footage a GIF came out roughly 100x larger for the same few seconds. */
    const stages = figures.map((fig) => {
      const img = fig.querySelector("img");
      const vid = fig.querySelector("video");
      return {
        label: fig.dataset.label || "",
        title: (fig.querySelector("h3") || {}).textContent || "",
        note: (fig.querySelector("p") || {}).textContent || "",
        kind: vid ? "video" : img ? "image" : "gap",
        /* The badge normally means "this stage is a clip". `data-motion` sets
           it directly, for a bare instance that carries no media but still
           wants to show the badge as part of the track's vocabulary. */
        motion: !!vid || "motion" in fig.dataset,
        src: vid ? vid.getAttribute("data-src") : img ? img.getAttribute("src") : null,
        poster: vid ? vid.getAttribute("poster") : null,
        alt: vid ? vid.getAttribute("data-alt") || "" : img ? img.getAttribute("alt") : ""
      };
    });

    const pad = (n) => (n < 10 ? "0" : "") + n;
    const total = stages.length;

    /* `data-scrub-bare` drops the viewer and leaves the track, for the one
       instance whose subject IS the control: the case study on the site
       itself. Everywhere else the scrubber exists to change a picture, so this
       is opt-in and the default is unaffected.

       It also means no media loads at all — with nothing on screen to show it,
       fetching a stage's still (or worse, its clip) would be pure weight. A
       stage may still carry a <video> to earn its motion badge; the badge is a
       property of the track, which is the part that survives here. */
    const bare = "scrubBare" in source.dataset;

    const wrap = document.createElement("div");
    wrap.className = "scrubber" + (bare ? " is-bare" : "");
    wrap.innerHTML =
      '<div class="scrub-viewer">' +
        '<span class="scrub-stamp"></span>' +
        '<img alt="">' +
        '<video class="scrub-video" muted loop playsinline preload="metadata"></video>' +
        '<div class="scrub-gap">' +
          '<span class="gap-mark">?</span>' +
          "<strong>No photo yet</strong>" +
          '<span class="gap-note"></span>' +
        "</div>" +
      "</div>" +
      // the rail lives on the wrapper, outside the masked/scrolling track, so
      // it stays continuous instead of fading out with the dots at the edges
      '<div class="scrub-trackwrap">' +
        '<div class="scrub-track"><div class="scrub-nodes" role="tablist"></div></div>' +
      "</div>" +
      '<div class="scrub-readout">' +
        '<div><h3></h3><p></p></div>' +
        '<span class="scrub-count"></span>' +
      "</div>";

    const viewer  = wrap.querySelector(".scrub-viewer");
    const img     = wrap.querySelector(".scrub-viewer > img");
    const video   = wrap.querySelector(".scrub-video");
    const gap     = wrap.querySelector(".scrub-gap");
    const gapNote = wrap.querySelector(".gap-note");
    const stamp   = wrap.querySelector(".scrub-stamp");
    const nodes   = wrap.querySelector(".scrub-nodes");
    const readout = wrap.querySelector(".scrub-readout");
    const title   = wrap.querySelector(".scrub-readout h3");
    const note    = wrap.querySelector(".scrub-readout p");
    const count   = wrap.querySelector(".scrub-count");

    const trackWrap = wrap.querySelector(".scrub-trackwrap");
    const track = wrap.querySelector(".scrub-track");
    const label = source.dataset.scrubber || "";
    const buttons = stages.map((stage, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "scrub-node" +
        // "no photo yet" is meaningless where no photo was ever going to show
        (!bare && stage.kind === "gap" ? " is-gap" : "") +
        (stage.motion ? " is-motion" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-label", "Stage " + (i + 1) + " of " + total + ": " + stage.title);
      b.innerHTML =
        '<span class="node-dot"></span><span class="node-label"></span>';
      b.querySelector(".node-label").textContent = stage.label;
      nodes.appendChild(b);
      return b;
    });

    let current = -1;

    function show(i) {
      if (i === current) return;
      current = i;
      const s = stages[i];
      // always stop whatever was playing before switching stage
      video.pause();
      video.classList.remove("is-shown");

      if (bare) {
        /* No viewer, so nothing to swap and nothing to fetch. Falls through to
           the readout and the node state below, which is the whole component
           in this mode. */
      } else if (s.kind === "video") {
        img.classList.remove("is-shown");
        img.removeAttribute("src");
        img.alt = "";
        gap.classList.remove("is-shown");
        viewer.classList.remove("has-gap");
        if (video.getAttribute("src") !== s.src) {
          video.setAttribute("src", s.src);
          if (s.poster) video.setAttribute("poster", s.poster);
        }
        video.setAttribute("aria-label", s.alt);
        video.classList.add("is-shown");
        // honour reduced-motion: show the poster frame paused instead
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          /* Wait for frame data before playing. A freshly-set src is still
             loading, and play() against a pending load request rejects with
             AbortError — which dropped the stage onto native controls the
             FIRST time it was ever reached, and only autoplayed once the file
             was cached. Cold load is the visitor's first impression, so it is
             the one that has to work.

             preload="metadata" stops before frame data arrives, so readyState
             stalls at 1 and loadeddata never fires on its own — same trap the
             stepper and media grid document: ask for the rest with
             preload="auto" AND call load(), or it sits there.

             The index guard stops a slow load from starting playback on a
             stage the visitor has already scrubbed away from. */
          const startAt = i;
          let attempts = 0;
          const start = () => {
            if (current !== startAt) return;
            video.currentTime = 0;
            const p = video.play();
            if (p && p.catch) p.catch(() => {
              if (current !== startAt) return;
              /* A pending load(), or the pause() from a fast scrub through
                 this stage, aborts the attempt. Retry a few times before
                 handing over to native controls, or a visitor who flicked
                 past the stage and came back finds it dead. */
              if (++attempts <= 3) setTimeout(start, 220);
              else video.controls = true;
            });
          };
          if (video.readyState >= 2) {
            start();
          } else {
            video.addEventListener("loadeddata", start, { once: true });
            video.preload = "auto";
            video.load();
          }
        } else {
          video.controls = true;
        }
      } else if (s.kind === "image") {
        img.src = s.src;
        img.alt = s.alt;
        img.classList.add("is-shown");
        gap.classList.remove("is-shown");
        viewer.classList.remove("has-gap");
      } else {
        img.classList.remove("is-shown");
        img.removeAttribute("src");
        img.alt = "";
        gapNote.textContent = s.note;
        gap.classList.add("is-shown");
        // state hook only — the viewer deliberately keeps its 16:10 box so the
        // frame size never changes between stages
        viewer.classList.add("has-gap");
      }
      title.textContent = s.title;
      note.textContent = bare || s.src ? s.note : "";
      count.textContent = pad(i + 1) + " / " + pad(total);
      stamp.textContent = label;
      buttons.forEach((b, j) => {
        b.setAttribute("aria-current", i === j ? "true" : "false");
        b.setAttribute("aria-selected", i === j ? "true" : "false");
        b.tabIndex = i === j ? 0 : -1;
      });
      // not while dragging — the pointer is already over a visible node, and
      // auto-scrolling under the cursor would fight the gesture
      if (!dragging) revealNode(buttons[i]);
      updateFades();
    }

    /* Keeps the two bits of track chrome in sync with the scroll position:
       the edge fades, and the rail's end points. */
    function updateFades() {
      const max = track.scrollWidth - track.clientWidth;
      track.classList.toggle("fade-start", max > 1 && track.scrollLeft > 1);
      track.classList.toggle("fade-end", max > 1 && track.scrollLeft < max - 1);

      /* The rail should stop at the first and last dot rather than running to
         the container edge. It sits on the wrapper (so the mask can't fade it)
         while the dots sit in the scroller, so the insets are recomputed here
         and clamped at 0 — once an end dot scrolls out of view the rail runs
         to the edge again, which is correct: the timeline really does continue
         past it. */
      const w = trackWrap.getBoundingClientRect();
      if (!w.width) return;
      const firstDot = buttons[0].querySelector(".node-dot").getBoundingClientRect();
      const lastDot = buttons[total - 1].querySelector(".node-dot").getBoundingClientRect();
      const startX = firstDot.left + firstDot.width / 2 - w.left;
      const endX = lastDot.left + lastDot.width / 2 - w.left;
      trackWrap.style.setProperty("--rail-l", Math.max(0, startX) + "px");
      trackWrap.style.setProperty("--rail-r", Math.max(0, w.width - endX) + "px");
    }
    /* Captions differ in length, so the readout grew and shrank as you stepped
       through — up to a whole extra line. That reflows everything below the
       scrubber, which reads as the page jumping while you scrub. Reserve the
       tallest caption's height up front so switching stage never changes
       layout. Measured rather than guessed, because wrapping depends on the
       caption text and the viewport width. */
    function lockReadoutHeight() {
      const keptTitle = title.textContent;
      const keptNote = note.textContent;
      readout.style.minHeight = "";
      let tallest = 0;
      stages.forEach((s) => {
        title.textContent = s.title;
        note.textContent = bare || s.src ? s.note : "";
        tallest = Math.max(tallest, readout.getBoundingClientRect().height);
      });
      title.textContent = keptTitle;
      note.textContent = keptNote;
      readout.style.minHeight = Math.ceil(tallest) + "px";
    }

    track.addEventListener("scroll", updateFades, { passive: true });

    /* --rail-l is an absolute offset, so it goes stale whenever the track
       shifts horizontally without a resize event. The one that always bit:
       the rail is measured before the page is tall enough for a vertical
       scrollbar, then the scrollbar appears, narrows the container by ~15px
       and moves every dot left — leaving the rail starting 15px to the right
       of the first dot, visibly detached from it. Only the left end showed it,
       because --rail-r is measured from the right edge so the same shift
       cancels out. Late-loading images and a font swap do the same thing.
       Setting custom properties does not resize the wrapper, so this cannot
       feed back on itself. */
    if ("ResizeObserver" in window) {
      new ResizeObserver(updateFades).observe(trackWrap);
    }

    let resizeRaf = null;
    window.addEventListener("resize", () => {
      updateFades();
      // remeasuring forces a reflow per stage, so coalesce resize bursts
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(lockReadoutHeight);
    });

    /* Keep the active stage on screen. Adjusts only the track's own
       scrollLeft — scrollIntoView would also move the page vertically. */
    function revealNode(el) {
      const t = track.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const margin = 16;
      if (r.left < t.left + margin) {
        track.scrollLeft -= t.left + margin - r.left;
      } else if (r.right > t.right - margin) {
        track.scrollLeft += r.right - (t.right - margin);
      }
    }

    /* Three ways to move the track sideways, since the scrollbar is hidden:
         - grab a dot and drag toward an edge, which auto-pans (below)
         - grab the track background and drag it (mouse only; touch already
           pans natively, and hijacking that would fight the browser)
         - wheel / trackpad over the track
       Keyboard needs none of these: revealNode already follows the selection. */
    let dragging = false;   // dragging a dot = scrubbing
    let didDrag = false;
    let panning = false;    // dragging the background = panning
    let panFromX = 0;
    let panFromScroll = 0;
    let lastX = 0;
    let downX = 0;          // where a dot press went down, for the zip's deadzone
    let panRaf = null;

    function nearestIndex(clientX) {
      let best = 0;
      let bestDist = Infinity;
      buttons.forEach((b, i) => {
        const r = b.getBoundingClientRect();
        const dist = Math.abs(clientX - (r.left + r.width / 2));
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      return best;
    }

    /* ---- the gummy blob ----
       The blob is a separate element that travels the rail while you drag. It
       deliberately does NOT sit under the pointer: a stage holds onto it as you
       pull away, so it lags *behind* the finger, leaning back at the stage it
       is leaving. That lag is the whole point — it says which stage you are
       still on and which way you are pulling, and letting go of it as you cross
       the midpoint is what makes the change land as a snap rather than a slide.

       It moves in TWO stages, and the split is what gives it weight rather than
       a constant offset:

       1. The magnets decide where the blob is wanted. At MAGNET = 1 a stage
          keeps the blob exactly on its own dot, so near a stage it does not
          drift with the cursor at all — it is pinned, and what moves is the
          stretch reaching out toward your hand. RELEASE sets how abruptly that
          grip gives out as you pull away, and it is high so the pinned zone
          stays wide and flat rather than easing off from the first pixel: the
          blob sits dead on the dot for the first third of the pull, then lets
          go over the rest. GRIP is where the stage lets go COMPLETELY — past
          it nothing holds the blob and it simply rides the pointer, so every
          gap has a pinned end, a release, and a free middle.
       2. The blob then CHASES that position rather than being placed on it,
          approaching it with a time constant of DRAG_TAU. This is where the
          weight comes from. Position alone is memoryless: drag slowly or fast
          and you get an identical offset, which reads as a blob pinned a fixed
          distance from the cursor rather than one being dragged. Chasing it
          means the lag grows with how fast you move (roughly speed x DRAG_TAU)
          and bleeds off to nothing when you stop — so the same gesture done
          gently and done hard look different, and letting go of the pointer
          lets the blob catch up.

       The chase is also what makes GRIP safe. The magnets hand off at ~2.9x the
       pointer speed on one side of GRIP and 1x on the other; placed directly
       that kink would read as a stutter, but chased it comes out as the blob
       lunging and then locking on.

       Everything is a ratio of the gap, so it reads identically at 347px
       segments (a three-stage track) and 116px (Vinci's nine).

       - SQUASH thins the blob as it stretches, so it reads as the same amount
         of goo rather than more of it. It is the SILHOUETTE's area that has to
         stay constant, which means scaleY = 1 / scaleX. The obvious-looking
         stretch^-0.5 is the 3D ellipsoid — right for a real object where the
         third axis absorbs some of it, wrong here, because nothing on screen
         has a third axis: measured, it still let the blob fatten by 16% from
         rest to full stretch, and that showed.
       - The stretch measures the gap between the blob and the POINTER, which is
         the thing actually being stretched. Both sources feed it for free: the
         magnet holding it back near a stage, and its own weight while moving.
         It goes round whenever the two meet — resting on a stage, or parked
         mid-gap with the pointer still.

       The stretch itself is one-sided, and it reaches toward the POINTER: the
       blob's far edge stays where an unstretched one would be and the whole
       extra length goes out the other side, so a pinned blob looks like goo
       anchored on the dot being pulled at. Splitting it evenly, as scaleX does
       on its own, would push half the smear out behind the dot — away from the
       hand doing the pulling — which is what it used to do.

       The picture still changes at the midpoint, so what you drag is continuous
       and what you see is always a real stage. */
    const MAX_STRETCH = 0.62;   // extra scaleX at full stretch
    const MAGNET = 1;           // how much of your movement a stage holds back.
                                // 1 means a stage keeps the blob exactly ON its
                                // dot — it is pinned, not merely slowed
    const GRIP = 0.72;          // how far out it holds on at all, as a fraction
                                // of half a gap — past this the pointer wins
    const RELEASE = 3.2;        // how abruptly the hold gives out approaching
                                // GRIP. High keeps the pinned zone wide and flat
    const DRAG_TAU = 28;        // ms — the blob's own weight
    const DRAG_SLIP = 0.5;      // cap on how far its weight alone can throw it
                                // off the aim, so a flick can't detach it
    const STRETCH_REF = 0.75;   // distance from the pointer that fully smears it,
                                // again as a fraction of half a gap
    const SQUASH = 1;           // scaleY = stretch ** -SQUASH. 1 holds the
                                // silhouette's AREA constant, which is the thing
                                // that reads as the blob keeping its volume
    const LEAN_TAU = 60;        // ms — how fast the reach swings round
    let blob = null;
    let blobLean = 0;           // -1 tail to the right … +1 tail to the left
    let blobRaw = null;         // pointer position, in the nodes' own space
    let blobPos = null;         // where the blob actually is, chasing blobAim
    let blobAim = 0;            // where the magnets want it
    let blobHalf = 1;           // half a gap, the scale everything is measured in
    let blobLoop = null;
    let blobLast = 0;

    function reducedMotion() {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function ensureBlob() {
      if (blob) return blob;
      blob = document.createElement("span");
      blob.className = "scrub-blob";
      blob.setAttribute("aria-hidden", "true");
      nodes.appendChild(blob);
      return blob;
    }

    /* Dot centres in the nodes' own coordinate space. Taken from the BUTTONS,
       which are never transformed — measuring the dots would fold the blob's
       own transform back into the next frame if it ever moved one. Read from
       getBoundingClientRect against the nodes rect so track scrolling is
       already accounted for. */
    function dotCentres() {
      const n = nodes.getBoundingClientRect();
      return buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return r.left + r.width / 2 - n.left;
      });
    }

    /* `x` anchors the blob and `lean` says which way it grows from there: +1
       extends it in +x, -1 in -x, 0 splits it evenly. The anchored edge lands
       exactly where an unstretched blob centred on x would have put it, so the
       stretch only ever adds to one end. */
    function placeBlob(x, stretch, lean) {
      const el = ensureBlob();
      const n = nodes.getBoundingClientRect();
      const d = buttons[0].querySelector(".node-dot").getBoundingClientRect();
      const w = el.offsetWidth || d.width;
      const squash = Math.pow(stretch, -SQUASH);
      // scaleX grows the blob about its own centre, so half the extra length
      // lands on each side. Shifting the centre back by that same half-length
      // puts all of it on one side, leaving the far edge exactly where an
      // unstretched blob would have had it. Measured at the 1.15 the transform
      // already carries, since that scales the extra too.
      const grow = (w * 1.15 * (stretch - 1)) / 2;
      const cx = x + lean * grow;
      el.style.transform =
        "translate(" + (cx - w / 2).toFixed(2) + "px," + (d.top - n.top).toFixed(2) + "px)" +
        " scale(1.15) scaleX(" + stretch.toFixed(3) + ")" +
        " scaleY(" + squash.toFixed(3) + ")";
    }

    /* Aim only — where the magnets want the blob. Nothing is drawn here; the
       chase below is what puts it on screen, and it keeps running after the
       pointer stops so the blob can settle onto whatever it was reaching for. */
    function aimBlob(clientX) {
      if (reducedMotion()) return;
      const n = nodes.getBoundingClientRect();
      const cs = dotCentres();
      const raw = Math.max(cs[0], Math.min(cs[total - 1], clientX - n.left));

      blobRaw = raw;

      let near = 0;
      for (let i = 1; i < total; i++) {
        if (Math.abs(raw - cs[i]) < Math.abs(raw - cs[near])) near = i;
      }
      const gap = total > 1 ? Math.abs(cs[total - 1] - cs[0]) / (total - 1) : 1;
      blobHalf = gap / 2 || 1;
      const dist = Math.min(1, Math.abs(raw - cs[near]) / blobHalf);

      // past GRIP the stage has let go entirely and the aim IS the pointer
      const hold = dist >= GRIP
        ? 0
        : MAGNET * (1 - Math.pow(dist / GRIP, RELEASE));
      blobAim = raw + (cs[near] - raw) * hold;
      if (blobPos === null) {
        // first aim of the gesture: sit on it and paint now rather than a frame
        // later, or the dot goes hollow with nothing yet in its place
        blobPos = blobAim;
        placeBlob(blobPos, 1, blobLean);
      }
      startBlobLoop();
    }

    /* The chase. Runs every frame while a dot is held, not once per pointermove
       — the blob has to keep converging after the pointer stops, and a
       pointermove-driven step would tie the physics to how fast the mouse is
       being moved, which is exactly the thing being measured. */
    function blobStep(now) {
      // dt-corrected, so the weight is the same at 60Hz and 120Hz. Clamped
      // because a backgrounded tab hands back one enormous frame on return,
      // which should land the blob rather than fling it.
      const dt = Math.min(50, Math.max(1, now - blobLast));
      blobLast = now;
      blobPos += (blobAim - blobPos) * (1 - Math.exp(-dt / DRAG_TAU));
      // a hard flick would otherwise leave it most of a gap behind, which stops
      // reading as weight and starts reading as a dropped frame
      const slip = DRAG_SLIP * blobHalf;
      blobPos = Math.max(blobAim - slip, Math.min(blobAim + slip, blobPos));

      /* The goo runs between the blob and your finger, so that gap is both how
         far it is stretched AND which way. Reaching toward the pointer is the
         only reading that survives a strong magnet: pinned to a dot with the
         cursor pulling away, a tail pointing backwards smears the blob out
         behind the dot, away from the hand doing the pulling.

         Direction from the offset also solves the flip that made travel
         direction necessary before. The two disagree only past the midpoint,
         where the next stage has the blob and is pulling it PAST the cursor —
         and the sign turns over exactly where the offset is zero, which is
         exactly where there is no stretch to see it in. */
      const off = blobRaw - blobPos;
      if (Math.abs(off) > 1) {
        const dir = off > 0 ? 1 : -1;
        blobLean += (dir - blobLean) * (1 - Math.exp(-dt / LEAN_TAU));
      }
      const smear = Math.abs(off) / (blobHalf * STRETCH_REF);
      placeBlob(blobPos, 1 + Math.min(1, smear) * MAX_STRETCH, blobLean);
      blobLoop = dragging ? requestAnimationFrame(blobStep) : null;
    }

    function startBlobLoop() {
      if (blobLoop !== null || !dragging) return;
      blobLast = performance.now();
      blobLoop = requestAnimationFrame(blobStep);
    }

    function stopBlobLoop() {
      if (blobLoop !== null) cancelAnimationFrame(blobLoop);
      blobLoop = null;
    }

    // spring home to whichever stage the drag ended on
    function settleBlob() {
      if (reducedMotion() || !blob) return;
      const cs = dotCentres();
      if (cs[current] === undefined) return;
      placeBlob(cs[current], 1, 0);
    }

    /* ---- clicking a stage: the blob flies there ----
       Clicking a distant dot used to drop the blob straight onto it, which told
       you nothing — the one thing the blob is for is showing the selection
       MOVE. So a click launches it instead: out of the old dot, smeared along
       the direction of travel, easing into the new one with a small overshoot.

       Driven frame by frame in JS rather than by a CSS transition because the
       stretch has to vary DURING the flight — it leaves round, smears, and is
       round again by the time it lands. A transition can only interpolate
       between two poses, so the stretch would still be there on arrival.

       Distances vary enormously (116px segments on Vinci's nine, 347px on a
       three-stage track, and a click can cross the whole rail), so duration
       goes as the square root: a long trip takes longer but travels faster,
       which is what makes it read as a zip rather than a slide. */
    const ZIP_MIN = 170;        // ms floor, so a short hop still registers
    const ZIP_MAX = 460;        // ms cap, for a click across the whole track
    const ZIP_RATE = 9;         // ms per sqrt(px)
    const ZIP_OVERSHOOT = 14;   // px past the dot at most, whatever the distance
    let zipRaf = null;
    let zipPos = null;          // last position painted, so a re-click takes over

    /* easeOutBack's peak overshoot works out at 4k³ / 27(k+1)², which is CUBIC
       in k, not linear — scaling the classic k = 1.70158 down pro rata gives a
       tenth of the bounce you asked for. Inverted by fixed-point iteration
       instead, run once per flight. (k = 1.70158 recovers the standard 10%.) */
    function backConstant(over) {
      let k = Math.cbrt(6.75 * over);
      for (let i = 0; i < 8; i++) k = Math.cbrt(6.75 * over * (k + 1) * (k + 1));
      return k;
    }

    function easeOutBack(t, k) {
      const u = t - 1;
      return 1 + (k + 1) * u * u * u + k * u * u;
    }

    function stopZip() {
      if (zipRaf !== null) cancelAnimationFrame(zipRaf);
      zipRaf = null;
    }

    function zipBlob(from, to) {
      stopZip();
      if (reducedMotion()) return;
      const span = to - from;
      const dist = Math.abs(span);
      if (dist < 1) return;
      ensureBlob();
      wrap.classList.remove("is-settling");
      wrap.classList.add("is-blobbing");

      const dur = Math.min(ZIP_MAX, ZIP_MIN + ZIP_RATE * Math.sqrt(dist));
      // a fixed 14px of overshoot however far it came, capped at the 10% the
      // easing gives on its own — 10% of a full-rail trip would be a bounce
      const k = backConstant(Math.min(0.1, ZIP_OVERSHOOT / dist));
      // a flight has no cursor to reach for, so it trails: the smear grows
      // BACKWARDS out of the direction it is travelling, like a comet
      const lean = span > 0 ? -1 : 1;
      // a longer flight is a faster one, so it smears harder
      const mag = Math.min(1, 0.6 + dist / 900);
      const t0 = performance.now();

      const frame = (now) => {
        /* Clamped at BOTH ends. rAF hands you the timestamp the frame started,
           which can predate the performance.now() taken in the click handler
           that scheduled it — so the first callback arrives with a negative t.
           Unclamped that ran the easing backwards: the blob launched 23px the
           wrong way and pinched below its own width on the way out. */
        const t = Math.max(0, Math.min(1, (now - t0) / dur));
        /* Stretch tracks how fast it is going, not where it is: a short attack
           so it leaves the dot round rather than already smeared, then a decay
           to nothing by the time it arrives. Deliberately reaches 0 before the
           overshoot is spent — a blob still stretching while it springs back
           reads as a wobble, not a landing. */
        const sp = Math.min(1, t / 0.12) * (1 - t) * (1 - t);
        zipPos = from + span * easeOutBack(t, k);
        placeBlob(zipPos, 1 + sp * MAX_STRETCH * mag, lean);
        if (t < 1) {
          zipRaf = requestAnimationFrame(frame);
          return;
        }
        zipRaf = null;
        zipPos = to;
        placeBlob(to, 1, 0);
        /* Hand back: blob out and dot back in, in the same paint. is-settling
           is what switches the dots' own transition off, so adding it and
           dropping is-blobbing have to land together or the dot cross-fades in
           over 150ms while the blob is already gone. Unlike the drag's release
           there is nothing left to spring — this arrived under its own power —
           so is-settling is only here for that one frame.

           A short timeout, NOT requestAnimationFrame: rAF is suspended while
           the page isn't rendering, which would strand is-settling and leave
           the dots with their transitions switched off for good. */
        wrap.classList.add("is-settling");
        wrap.classList.remove("is-blobbing");
        setTimeout(() => wrap.classList.remove("is-settling"), 30);
      };
      zipRaf = requestAnimationFrame(frame);
    }

    /* Dot centres are measured against the nodes rect, which the dots sit
       inside, so they are invariant under track scrolling — a flight can be
       aimed before show() calls revealNode and still land on the dot. */
    function zipTo(fromIndex, toIndex) {
      if (fromIndex === toIndex || reducedMotion()) return;
      const cs = dotCentres();
      if (cs[fromIndex] === undefined || cs[toIndex] === undefined) return;
      // mid-flight a new click takes over from wherever the blob actually is,
      // rather than snapping back to a dot to set off again
      const from = zipRaf !== null && zipPos !== null ? zipPos : cs[fromIndex];
      zipBlob(from, cs[toIndex]);
    }

    function maxScroll() {
      return track.scrollWidth - track.clientWidth;
    }

    /* While scrubbing, holding the pointer near either end keeps the track
       moving, so a single drag can reach stages that start off-screen. */
    function panStep() {
      const t = track.getBoundingClientRect();
      const zone = 56;
      let dir = 0;
      if (lastX < t.left + zone) dir = -1;
      else if (lastX > t.right - zone) dir = 1;

      if (dragging && dir !== 0) {
        const before = track.scrollLeft;
        track.scrollLeft = Math.max(0, Math.min(maxScroll(), before + dir * 9));
        if (track.scrollLeft !== before) {
          show(nearestIndex(lastX));
          // the dots move under a still pointer while auto-panning, so the
          // blob has to be re-aimed even though nothing was moved by hand
          aimBlob(lastX);
          updateFades();
        }
        panRaf = requestAnimationFrame(panStep);
      } else {
        panRaf = null;
      }
    }

    function startEdgePan() {
      if (panRaf === null) panRaf = requestAnimationFrame(panStep);
    }

    function stopEdgePan() {
      if (panRaf !== null) {
        cancelAnimationFrame(panRaf);
        panRaf = null;
      }
    }

    nodes.addEventListener("pointerdown", (e) => {
      lastX = e.clientX;
      if (e.target.closest(".node-dot")) {
        dragging = true;
        didDrag = false;
        downX = e.clientX;
        // no travel yet, so the blob starts round and symmetric and grows its
        // tail as the drag commits to a direction
        blobLean = 0;
        blobRaw = null;
        blobPos = null;
        wrap.classList.add("is-dragging");
        wrap.classList.remove("is-settling");
        if (!reducedMotion()) wrap.classList.add("is-blobbing");
        try {
          nodes.setPointerCapture(e.pointerId);
        } catch (err) {
          /* capture is best-effort; dragging still works without it */
        }
        const from = current;
        const to = nearestIndex(e.clientX);
        show(to);
        /* Press a different dot and the blob flies to it. It is only a flight
           until the pointer actually moves — pointermove hands straight back to
           the drag model, which is the same gesture the visitor started. */
        if (to !== from) {
          zipTo(from, to);
        } else {
          stopZip();
          aimBlob(e.clientX);
        }
        e.preventDefault();
        return;
      }
      // background drag pans the track — mouse only, so touch keeps native scroll
      if (e.pointerType !== "mouse" || maxScroll() <= 0) return;
      panning = true;
      panFromX = e.clientX;
      panFromScroll = track.scrollLeft;
      wrap.classList.add("is-panning");
      try {
        nodes.setPointerCapture(e.pointerId);
      } catch (err) {
        /* best effort */
      }
      e.preventDefault();
    });

    nodes.addEventListener("pointermove", (e) => {
      lastX = e.clientX;
      if (panning) {
        // a pan begun on a node's label would otherwise fire a click on
        // release and jump to that stage
        if (Math.abs(e.clientX - panFromX) > 3) didDrag = true;
        track.scrollLeft = panFromScroll - (e.clientX - panFromX);
        updateFades();
        return;
      }
      if (!dragging) return;
      /* A flight is in the air, so this press was a click. Don't let a shaky
         hand shoot it down — only a deliberate drag takes the blob back off the
         easing curve and onto the pointer. */
      if (zipRaf !== null) {
        if (Math.abs(e.clientX - downX) <= 4) return;
        stopZip();
        // pick the blob up from where the flight had got to, so taking over
        // mid-air is a handover rather than a jump
        blobPos = zipPos;
      }
      didDrag = true;
      show(nearestIndex(e.clientX));
      aimBlob(e.clientX);
      startEdgePan();
    });

    /* Wheel and trackpad. Only consumes the event while the track can still
       move that way, so reaching either end hands scrolling back to the page
       instead of trapping the cursor. */
    track.addEventListener("wheel", (e) => {
      const max = maxScroll();
      if (max <= 0) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      if ((delta < 0 && track.scrollLeft > 0) || (delta > 0 && track.scrollLeft < max)) {
        e.preventDefault();
        track.scrollLeft = Math.max(0, Math.min(max, track.scrollLeft + delta));
        updateFades();
      }
    }, { passive: false });

    function endDrag(e) {
      if (!dragging && !panning) return;
      dragging = false;
      panning = false;
      stopEdgePan();
      // before settleBlob, or a frame still in flight repaints over the settle
      // transform and the CSS spring animates to the wrong place
      stopBlobLoop();
      wrap.classList.remove("is-dragging");
      wrap.classList.remove("is-panning");
      /* Let go and the blob springs home to the stage it landed on, then hands
         back to the dot. The hand-back order matters: is-blobbing goes first,
         while is-settling still has the dots' transition switched off, so the
         blob vanishing and the dot re-filling happen in the same frame. Drop
         is-settling first instead and you get a 150ms cross-fade where neither
         is fully drawn. */
      // a flight already owns the blob and ends with its own hand-back; letting
      // the release settle it too would snap it onto the dot mid-air
      if (zipRaf === null && wrap.classList.contains("is-blobbing")) {
        wrap.classList.add("is-settling");
        settleBlob();
        setTimeout(() => {
          wrap.classList.remove("is-blobbing");
          /* A short timeout, NOT requestAnimationFrame — rAF is suspended
             entirely while the page isn't rendering, which would strand
             is-settling and leave the dots with their transitions switched
             off for good. Same reason the media grid's cross-fade avoids it. */
          setTimeout(() => wrap.classList.remove("is-settling"), 30);
        }, 320);
      }
      try {
        nodes.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* nothing captured */
      }
      updateFades();
      // let the synthetic click that follows pointerup pass before re-arming
      setTimeout(() => { didDrag = false; }, 0);
    }

    nodes.addEventListener("pointerup", endDrag);
    nodes.addEventListener("pointercancel", endDrag);

    buttons.forEach((b, i) => {
      b.addEventListener("click", () => {
        if (didDrag) return;
        const from = current;
        show(i);
        /* This is the path for a click on a node's LABEL, which starts no drag
           at all. A click on the dot itself already flew from pointerdown,
           which moved `current` — so `from === i` by the time the click lands
           and nothing fires twice. */
        zipTo(from, i);
      });
      b.addEventListener("keydown", (e) => {
        let next = null;
        if (e.key === "ArrowRight") next = (i + 1) % total;
        if (e.key === "ArrowLeft") next = (i - 1 + total) % total;
        if (e.key === "Home") next = 0;
        if (e.key === "End") next = total - 1;
        if (next === null) return;
        e.preventDefault();
        buttons[next].focus();
        show(next);
      });
    });

    /* Swipe the frame itself to move a stage. The track is reachable with a
       finger but its dots are small and it is the thinnest strip on the page;
       the viewer is the biggest target there is, and dragging a filmstrip
       sideways is what the component looks like it should do.

       It clamps rather than wraps — unlike the arrow keys, which cycle. A
       swipe is a continuous gesture over a linear timeline, so hitting the
       last stage and landing back on the first would read as a glitch;
       stopping dead says "that's the end of the track". */
    addSwipe(viewer, (d) => {
      const n = current + d;
      if (n >= 0 && n < total) show(n);
    });

    source.setAttribute("hidden", "");
    source.parentNode.insertBefore(wrap, source);
    show(startIndex());
    lockReadoutHeight();

    /* Which stage the scrubber opens on. Defaults to the first, so any instance
       without data-scrub-start behaves exactly as before. The attribute takes
       either a stage's data-label (case-insensitive) or a 1-based position.
       Anything that doesn't resolve falls back to the first stage rather than
       opening on a blank viewer — a typo shouldn't cost you the whole block.
       Note show() calls revealNode, which only moves track.scrollLeft, so
       starting at the last stage scrolls the track to its end without touching
       the page's own scroll position. */
    function startIndex() {
      const want = (source.dataset.scrubStart || "").trim();
      if (!want) return 0;
      const byLabel = stages.findIndex(
        (s) => s.label.toLowerCase() === want.toLowerCase());
      if (byLabel >= 0) return byLabel;
      const n = parseInt(want, 10);
      return n >= 1 && n <= total ? n - 1 : 0;
    }
    /* Web fonts land after first paint and change how captions wrap, so the
       height measured above can be short. Remeasure once they're ready. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(lockReadoutHeight);
    }
  }
}

// Run now if the DOM is already parsed (e.g. the script was loaded late or
// deferred), otherwise wait for it.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSite);
} else {
  initSite();
}

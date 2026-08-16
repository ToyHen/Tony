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
    /* Phones get the poster, not the clip. At 375px the loop is scaled to a
       fraction of its size for the full download, on the connection least
       likely to want it — and the poster is frame 0, so the image is identical,
       just still. Raise or drop this line if the motion matters more than the
       weight. */
    const narrow = window.innerWidth < 700;
    if (reduced || saveData || narrow) return;   // poster stands in; nothing downloads

    /* preload="none" plus a src alone leaves the element at readyState 0 for
       ever, so canplay never fires. Set preload AND call load() &mdash; the same
       trap the stepper and the media grid work around. */
    video.src = video.dataset.src;
    delete video.dataset.src;
    video.preload = "auto";
    video.load();

    video.addEventListener("canplay", () => {
      const p = video.play();
      /* Muted autoplay is allowed without a gesture, but if a browser ever
         refuses there is nothing to recover: the poster is already the frame
         the clip opens on, so a refusal just leaves the hero as a still. */
      if (p && p.catch) p.catch(() => {});
    }, { once: true });

    /* Stop it once the hero has scrolled away rather than decode a clip nobody
       can see, and pick it up again on the way back. */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!video.src) return;
          if (e.isIntersecting) {
            const p = video.play();
            if (p && p.catch) p.catch(() => {});
          } else {
            video.pause();
          }
        });
      }, { threshold: 0 }).observe(section);
    }
  }

  /* ---------- contact sheet ----------
     Every cell ships as a still inside a link, and that is the component. A cell
     carrying data-clip grows a <video> on first hover, which is also when the
     file is first fetched — so motion costs nothing on load, and nothing at all
     on a phone, where the pointer never arrives.

     The clip is deliberately a bonus and never the reason a cell is legible:
     the label is always drawn, and a still-only cell is a complete cell. */
  const sheet = document.querySelector("[data-sheet]");
  if (sheet) initSheet(sheet);

  function initSheet(grid) {
    const mq = window.matchMedia;
    /* No pointer means the preview can never be triggered, so on a touch screen
       the cells stay plain stills — and, more importantly, must not advertise a
       preview they cannot play. */
    const canHover = !mq || mq("(hover: hover)").matches;
    const still = (mq && mq("(prefers-reduced-motion: reduce)").matches) || !canHover;

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

      function leave() {
        if (!video) return;
        video.classList.remove("is-playing");
        video.pause();
      }

      tile.addEventListener("mouseenter", enter);
      tile.addEventListener("mouseleave", leave);
      tile.addEventListener("focus", enter);
      tile.addEventListener("blur", leave);
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
          hold = true;
          if (timer) { clearTimeout(timer); timer = null; }
          show(k);
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

      // the lightbox reads these to step through the same batch
      f.frames = srcs;
      f.frameIndex = 0;

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
      const leave = () => { preview(v, false); if (cycle) cycle(false); };
      tileLeavers.push(leave);
      f.addEventListener("mouseenter", enter);
      f.addEventListener("mouseleave", leave);
      // keyboard parity — tabbing to a tile previews it too
      f.addEventListener("focus", enter);
      f.addEventListener("blur", leave);
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
        src: vid ? vid.getAttribute("data-src") : img ? img.getAttribute("src") : null,
        poster: vid ? vid.getAttribute("poster") : null,
        alt: vid ? vid.getAttribute("data-alt") || "" : img ? img.getAttribute("alt") : ""
      };
    });

    const pad = (n) => (n < 10 ? "0" : "") + n;
    const total = stages.length;

    const wrap = document.createElement("div");
    wrap.className = "scrubber";
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
        (stage.kind === "gap" ? " is-gap" : "") +
        (stage.kind === "video" ? " is-motion" : "");
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

      if (s.kind === "video") {
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
          video.currentTime = 0;
          const p = video.play();
          if (p && p.catch) p.catch(() => { video.controls = true; });
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
      note.textContent = s.src ? s.note : "";
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
        note.textContent = s.src ? s.note : "";
        tallest = Math.max(tallest, readout.getBoundingClientRect().height);
      });
      title.textContent = keptTitle;
      note.textContent = keptNote;
      readout.style.minHeight = Math.ceil(tallest) + "px";
    }

    track.addEventListener("scroll", updateFades, { passive: true });
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
        wrap.classList.add("is-dragging");
        try {
          nodes.setPointerCapture(e.pointerId);
        } catch (err) {
          /* capture is best-effort; dragging still works without it */
        }
        show(nearestIndex(e.clientX));
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
      didDrag = true;
      show(nearestIndex(e.clientX));
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
      wrap.classList.remove("is-dragging");
      wrap.classList.remove("is-panning");
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
        show(i);
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

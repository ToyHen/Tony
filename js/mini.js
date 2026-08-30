/* mini-lab: the only JavaScript the prototype adds.
 *
 * Variant A ("bench") needs none of it -- its layout is CSS and its behaviour
 * is the shipped initMediaGrid. What is here is the lab's own A/B/C switch,
 * which never ports anywhere, plus two things the other variants need
 * measurements for: B's pile, and C's overflow test.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var touchGesture = null;
  var touchLiftFig = null;
  var blockedClickSc = null;

  /* :focus-visible normally distinguishes keyboard focus from pointer focus,
     but a programmatic return from the lightbox inherits the close button's
     visible-focus state in some browsers. Track the actual input modality as
     well, so a mouse or finger can never leave a heaped strip carrying the
     keyboard-only lift. */
  document.addEventListener("keydown", function (e) {
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      root.classList.add("is-keyboard-nav");
      blockedClickSc = null;
      setTouchLift(null);
    }
  }, true);
  document.addEventListener("pointerdown", function (e) {
    root.classList.remove("is-keyboard-nav");
    /* touchstart owns touch suppression; a mouse or pen begins a separate
       action and can safely discard anything an earlier touch left behind. */
    if (e.pointerType !== "touch") {
      blockedClickSc = null;
      setTouchLift(null);
    }
  }, true);

  /* ------------------------------------------------- the variant, locked to F
     THIS IS THE SHIPPED COPY AND IT HAS NO SWITCH. mini-lab/mini.js carries
     seven variants behind lab chrome; this one is Constellation and nothing
     else, so setVariant takes no argument, reads no ?v= and writes no history.

     F SETS .is-exploded AS WELL AS ITS OWN CLASS, and that is the point of it.
     B's film strip, drift, pile, hover-lift and open transition are all
     written against .is-exploded, so F inherits every one of them unchanged
     and costs only the rules it adds on top. Do not "tidy" .is-exploded away
     because no Exploded variant ships here -- it is load-bearing.

     Under a stated preference for less motion the pile is not applied at all:
     .is-cluster is what heaps the strips, so without it every gallery renders
     already open in ordinary flow. That is also the no-JS view. */
  function setVariant() {
    root.classList.add("is-exploded", "is-constellation");
    clearRoles();
    pile(!reduced);
  }

  /* Three variants want to make a .scatter focusable, for three different
     reasons -- C so a keyboard can scroll a band, E so it can open a drawer,
     and neither in A, B or D. They were each clearing up after themselves,
     which meant the ResizeObserver calling bandKeys(false) mid-life quietly
     stripped the tabindex and role that DRAWERS had just set: the drawers were
     unreachable by keyboard and nothing said why, because aria-expanded (which
     bands does not touch) was still there.

     So the shared attributes get ONE owner. This clears them on every variant
     change and each variant only ever sets its own. */
  function clearRoles() {
    document.querySelectorAll(".scatter").forEach(function (sc) {
      sc.removeAttribute("tabindex");
      sc.removeAttribute("role");
      sc.removeAttribute("aria-label");
      sc.removeAttribute("aria-expanded");
      sc.classList.remove("has-overflow", "is-open");
    });
  }


  /* ================================================================= B: the pile
     B rests as a heap of film strips per work and opens out when a visitor
     reaches the section -- pointer, keyboard focus or finger.

     The OPEN layout is the ordinary flow one, so the only thing that needs
     computing is the journey INTO the heap: for each figure, the delta from
     where the flow put it to where it lies on the pile.

     Measured with getBoundingClientRect deliberately. That reports the
     TRANSFORMED box, normally the trap this project documents -- but here the
     transformed box is exactly the question, because a strip's tilt and drift
     are part of where it visually sits.

     The open state is the DEFAULT and .is-cluster is what heaps it, so with JS
     off, or under a stated preference for less motion, every gallery is simply
     already open. Same shape as the rest of the site: the working thing ships,
     the enhancement is added on top. */

  var GOLDEN = 2.399963;    // radians; the angle that never lines up with itself

  /* Where a gallery's heap sits across its band when the markup does not say.
     The same four values the four sections author inline, so an unattended
     fifth section joins the rhythm instead of landing dead centre. */
  var AX_CYCLE = [0.24, 0.71, 0.38, 0.82];
  /* FLATTEN is gone -- the vertical spread now comes from the box height. */

  /* Deterministic pseudo-random from an integer. The page has to compose the
     same way on every load or it cannot be judged, so nothing here calls
     Math.random -- this is the usual sin/fract hash, seeded by index and a
     salt so one item can draw several independent numbers. */
  function rnd(i, salt) {
    var x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  /* A signed amplitude with a FLOOR. Taking (rnd * 2 - 1) * max lands a good
     third of nineteen items within a pixel of zero, so those strips sat
     perfectly still while their neighbours moved -- which reads as some of
     them being broken rather than as a calm pile. Direction is random,
     magnitude never smaller than `min`. */
  function amp(i, salt, min, max) {
    var sign = rnd(i, salt) < 0.5 ? -1 : 1;
    return sign * (min + rnd(i, salt + 40) * (max - min));
  }

  function measure(sc) {
    /* Must be measured while OPEN, or every delta is taken from a position
       that is itself already a heap offset. Re-heaped in the same turn, so
       nothing is painted in between.

       The drift is suspended for the same reason: getBoundingClientRect
       reports where a strip is right now, wander included, so measuring
       through it would fold a few pixels into the heap positions and they
       would creep a little further on every resize. */
    var wasHeaped = sc.classList.contains("is-cluster");
    if (wasHeaped) sc.classList.remove("is-cluster");
    sc.classList.add("is-measuring");

    /* THE CAROUSEL'S OWN SCALE HAS TO COME OFF FIRST. Every delta below is
       read with getBoundingClientRect, which reports the TRANSFORMED box -- so
       measuring a work sitting at the back of the stage at scale 0.55 returns
       offsets 45% short, and the heap it then builds is wrong by that much and
       changes every time the carousel turns. .is-flat drops the whole
       transform for the duration; where the work ends up meanwhile does not
       matter, because everything here is relative to the container. */
    var work = sc.closest(".work");
    if (work) work.classList.add("is-flat");

    /* THE WIDTH IS PINNED BEFORE THE HEIGHT IS RELEASED, AND THAT IS THE WHOLE
       OF A REAL BUG.

       Everything below is a delta from where the flow puts a strip, so it is
       only correct if the flow measured here is the flow that gets rendered.
       Releasing the height to read the open layout makes the PAGE taller --
       and a taller page can bring in the vertical scrollbar, which narrows the
       container. Measured at a 556px viewport: at rest the page is 967px in a
       982px viewport with no scrollbar, and the gallery is 508px wide; with
       one gallery's height released the page becomes 1088px, the scrollbar
       arrives, and the gallery measures 493px. Fifteen pixels is enough to
       change how many strips fit on a line, so the flow that was measured was
       one that would never be rendered, and the heap came out spread across
       the page instead of piled -- 520px and 612px wide against an expected
       240, with the second overflowing the page sideways.

       The tell was that it hit some galleries and not others: only the ones
       whose open state is tall enough to summon the scrollbar. The short one
       measured 508px and piled correctly.

       Pinning the width means the strips lay out exactly as they will be
       rendered whatever the page does around them. It also covers the same
       thing happening for any other reason -- a horizontal scrollbar, a font
       swap, chrome appearing. Same family as the scrubber's --rail-l trap in
       CLAUDE.md, where the rail is measured before the page is tall enough for
       a scrollbar; here the measurement is what summons it. */
    var prev = sc.style.height;
    var prevW = sc.style.width;
    var pinned = sc.offsetWidth;
    sc.__pinW = pinned;          /* what this measurement is only valid for */
    sc.style.width = pinned + "px";
    sc.style.height = "auto";
    var box = sc.getBoundingClientRect();
    var open = sc.offsetHeight;
    var figs = sc.querySelectorAll("figure");
    var n = figs.length;

    /* The drift hash is seeded by a DOCUMENT-wide index, not the index within
       the section. Per-section, every gallery restarts at 0, so the first
       strip of each pile drew the same amplitude and the same period as the
       first strip of every other pile -- nineteen items but only eight
       distinct drifts, moving in fours. */
    var seed = Array.prototype.indexOf.call(
      document.querySelectorAll(".scatter"), sc) * 37;

    /* EVERY STRIP IS BROUGHT TO THE SAME WIDTH ON THE HEAP, and that is not
       cosmetic. Glass Shatter's finished clip carries --weight: 1.7, so open
       it is nearly twice its neighbours -- and heaped it simply buried the
       other seven, which is what the first version did. Emphasis is what the
       OPEN layout is for; a pile has to read as a pile. */
    /* HEAP SIZE IS A TOKEN, NOT A CONSTANT, so a branch of B can change how
       big a pile rests without touching this function. F wants heaps small
       enough that all four are on screen together; G wants them a little
       smaller than B's; B keeps the numbers it was tuned with. Read off the
       element, so the answer lives beside the rest of that variant's CSS. */
    var scs = getComputedStyle(sc);
    var frac = parseFloat(scs.getPropertyValue("--heap-frac")) || 0.36;
    var cap = parseFloat(scs.getPropertyValue("--heap-max")) || 230;
    var target = Math.min(box.width * frac, cap);

    /* The spread comes off the ITEM, so a heap is as big as the pictures in it
       and no bigger. Sizing it off the section's open height instead gave every
       pile a box the size of its exploded state -- the heaps ended up far
       apart with air around each one, and Tony's verdict was exact: "there's
       literally no point for the exploding", because nothing was gained by
       opening something that already had all that room.

       `tight` pulls small piles in further. A three-item heap spread as wide as
       an eight-item one is not a heap, it is three pictures in a row. */
    /* THE PILE'S SHAPE IS A TOKEN TOO, and it is the better lever of the two.
       Fitting four heaps into one screen by shrinking the strips costs
       legibility everywhere; flattening the spiral costs only vertical space,
       which is exactly what is short, and there is always room across a
       1000px band. F spreads wide and flat for that reason. */
    var tight = Math.min(1, Math.sqrt(n / 6));
    var sx = parseFloat(scs.getPropertyValue("--heap-wide")) || 1.02;
    var sy = parseFloat(scs.getPropertyValue("--heap-tall")) || 0.54;
    var fitLong = scs.getPropertyValue("--heap-fit").trim() === "long";
    var spreadX = target * sx * tight;
    var spreadY = target * sy * tight;

    /* WHERE ACROSS THE BAND THE HEAP SITS, 0 to 1, default dead centre.
       Only F uses it. Once the piles are small enough to sit four to a screen,
       centring all four stacks them into a column down the middle of a wide
       page, which reads as a list of piles rather than as a set of them --
       so each one is anchored somewhere different across its own band.

       Clamped to the heap's own half-extent, so an anchor near an edge slides
       the pile as far as it can go and then stops, instead of hanging half of
       it outside the container on a narrow screen. */
    var half = spreadX + target / 2;
    var ax = parseFloat(scs.getPropertyValue("--heap-ax"));
    /* A COPIED <article> WITH NOTHING CHANGED STILL LANDS SOMEWHERE SENSIBLE.
       --heap-ax is authored inline per gallery, but falling back to 0.5 would
       drop an unlabelled new section dead centre, where its own title has
       nowhere to go. The cycle repeats the four authored values, so a fifth
       section picks up the rhythm rather than breaking it. */
    if (!isFinite(ax)) ax = AX_CYCLE[(seed / 37) % AX_CYCLE.length];
    var anchorX = Math.max(half, Math.min(box.width - half, box.width * ax));
    if (box.width < half * 2) anchorX = box.width / 2;

    /* WHICH SIDE THE TITLE GOES ON IS DERIVED, NOT DECLARED. It used to be two
       :nth-of-type rules, which meant a fifth gallery got no rule at all and
       its name landed on top of its own pile. The heap knows which half it is
       in; the title takes the other one. */
    if (work) work.classList.toggle("title-left", anchorX > box.width / 2);

    var pos = [];

    for (var i = 0; i < n; i++) {
      /* Golden-angle spiral: deterministic, identical on every load, and it
         stays even at any item count -- which a hand-written offset table does
         not, and this page is explicitly built to grow. Later items land
         further out and therefore stack on top, so the eye reads the heap from
         its edges inwards.

         (i+0.5)/n, not i/(n-1). The latter parks item 0 DEAD CENTRE where the
         other seven bury it completely -- Glass Shatter's storyboard, the one
         white picture in the set, disappeared under the pile and the heap read
         as a stack of black rectangles. Half a step out keeps an edge of it
         showing. A one-item section is still centred by the guard, or its only
         picture would sit off to the side of its own box. */
      var ang = i * GOLDEN;
      var rad = n > 1 ? Math.sqrt((i + 0.5) / n) : 0;
      pos.push([Math.cos(ang) * rad * spreadX, Math.sin(ang) * rad * spreadY]);
    }

    /* The heap's box is the heap's own extent, measured, not a fraction of
       anything: however tall the pile actually is, plus a little air. */
    var extent = 0;
    var wLeft = Infinity, wRight = -Infinity;
    var cs = [];
    figs.forEach(function (f, i) {
      var r = f.getBoundingClientRect();
      /* WIDTH or LONG EDGE. B brings every strip to a common WIDTH, which is
         what stops Glass Shatter's --weight: 1.7 clip burying its neighbours.
         But width alone leaves the pile's HEIGHT set by whichever item is
         most portrait: at a common 90px width the 3:1 pencil study is 30px
         tall and the 9:16 phone footage is 160px, so one item is nearly six
         times the other and the heap has to be tall enough for it.

         Capping the LONG edge instead makes every strip the same size in its
         own longest dimension -- the same rule make-still.ps1 uses on a phone
         still, and for the same reason. It costs a little of B's neat common
         width and buys a heap that is as small as it looks. F takes that
         trade because F's heaps have to fit four to a screen; B keeps its. */
      cs.push(Math.min(1, target /
        (fitLong ? Math.max(r.width, r.height) : r.width)));
      extent = Math.max(extent, Math.abs(pos[i][1]) + (r.height * cs[i]) / 2);
      /* Sideways too, so F's titles can be told where the pile actually ends.
         Hand-tuned percentages cannot know: the heap's width depends on the
         item count, the viewport and --heap-max, so a number that clears it at
         one width runs straight into it at another. Tony: "some of the texts
         are going into the cluster of media." */
      var hw = (r.width * cs[i]) / 2;
      if (pos[i][0] - hw < wLeft) wLeft = pos[i][0] - hw;
      if (pos[i][0] + hw > wRight) wRight = pos[i][0] + hw;
    });
    var heap = Math.round(extent * 2 + 30);

    /* Published on the .work, not the .scatter -- a custom property inherits
       DOWN, and .work-head is the scatter's sibling, so it would never see one
       set there. The tilt widens a strip's box a little past this, which the
       gap in the CSS absorbs. */
    (work || sc).style.setProperty("--heap-l",
      Math.round(anchorX + wLeft) + "px");
    (work || sc).style.setProperty("--heap-r",
      Math.round(anchorX + wRight) + "px");

    /* The open state spills out of the heap's box rather than making it taller
       -- that is what keeps the piles compact and close together while the
       page still never reflows.

       But NOT centred, which is what it was first: an even split sent the top
       of the explosion 168px above the box, and since a section only opens
       when the pointer is over it, the top of the viewport is exactly where
       that lands. The sticky header sits at z-index 50 and drew straight over
       it -- Tony: "the items went too far up", with 67px of picture hidden
       behind the nav.

       So the upward spill is capped and the rest goes downward, where the only
       thing it covers is the next heap and nothing is chrome. UP_CAP is
       measured against the highest item's UNTRANSFORMED layout position plus
       its own --drop, so the cap is on what actually ends up on screen rather
       than on the shift that produces it.

       A section whose open state is SHORTER than its heap box still gets a
       negative shift and contracts, which Math.min leaves alone. */
    /* A token, because how far a section may spill upward depends on how close
       to the top of the page its heap sits. B's piles are large and start well
       down the page, so 60px is safe there; F's are a third the size and the
       first one is only 190px from the top, where 60px put the head of the
       explosion 23px behind the sticky header -- the same failure Tony called
       out on B, reappearing because the layout around it changed. */
    var UP_CAP = parseFloat(scs.getPropertyValue("--heap-rise"));
    if (!isFinite(UP_CAP)) UP_CAP = 60;
    var topMost = Infinity;
    figs.forEach(function (f) {
      var drop = parseFloat(getComputedStyle(f).getPropertyValue("--drop")) || 0;
      topMost = Math.min(topMost, f.offsetTop + drop);
    });
    var shift = Math.min(Math.round((open - heap) / 2), Math.round(topMost) + UP_CAP);

    /* How far the open state reaches above and below its own band. Kept so the
       titles can get out of the way of an explosion before it arrives -- see
       hushTitles(). Worked out here because this is the one place the open
       layout is actually measured. */
    sc.__openTop = -shift;
    sc.__openBot = -shift + open;

    figs.forEach(function (f, i) {
      var r = f.getBoundingClientRect();
      var nowX = r.left + r.width / 2 - box.left;
      var nowY = r.top + r.height / 2 - box.top;
      f.style.setProperty("--cs", cs[i].toFixed(3));
      /* Scaling is about the element's own centre, so the centre is the same
         point before and after -- which is why the delta can be computed off
         the unscaled box and the scale applied independently. */
      /* These are offsets from the FLOW position, applied as left/top -- see
         the note in mini.css. .is-measuring neutralises left/top/transform for
         the duration, so nowX/nowY are the untouched flow centres and the
         offsets never compound across re-measures. */
      f.style.setProperty("--cx", Math.round(anchorX + pos[i][0] - nowX) + "px");
      f.style.setProperty("--cy", Math.round(heap / 2 + pos[i][1] - nowY) + "px");
      f.style.setProperty("--oy", -shift + "px");
      /* Opening staggers along the pile rather than all at once. */
      f.style.setProperty("--i", i);

      /* The drift's amplitude, period and phase. Small and slow on purpose:
         about seven pixels and a degree and a half over twenty-odd seconds is
         a pile settling, not a pile fidgeting. No two periods match, so the
         strips never fall into step, and the negative delay starts each one
         part-way through its own cycle instead of nineteen setting off
         together the moment the page loads. */
      var k = i + seed;

      /* Which CHARACTER of drift, and the period that suits it. Weighted
         toward the calmer two: a pile where most strips are parked most of the
         time and one or two are moving reads as settling, where all nineteen
         moving at once reads as restless. "c" gets the long periods, so a
         nearly-still strip on a 60s cycle moves about once a minute. */
      var kinds = ["a", "b", "c", "b", "c"];
      var kind = kinds[Math.min(kinds.length - 1,
                                Math.floor(rnd(k, 6) * kinds.length))];
      var dur = kind === "a" ? 16 + rnd(k, 4) * 10
              : kind === "b" ? 24 + rnd(k, 4) * 16
              :                36 + rnd(k, 4) * 26;

      /* Written as --dx0/--dy0/--dr0, NOT --dx/--dy/--dr. These are inline
         styles, and an inline declaration beats any stylesheet rule -- so the
         hover state could not take the drift's amplitude to zero without
         !important. mini.css maps the 0-suffixed pair onto the names the
         keyframes actually read, and overriding a mapping costs nothing. */
      f.style.setProperty("--dx0", amp(k, 1, 3.5, 8).toFixed(1) + "px");
      f.style.setProperty("--dy0", amp(k, 2, 2.5, 6).toFixed(1) + "px");

      /* ROTATION DIRECTION ALTERNATES, it is not hashed like the rest.
         Tony read the pile as "rotating relative to the cluster center". The
         geometry was not the cause -- measured, each strip's centre moves by
         at most the 8px translation budget, so they do spin in place, and the
         orbit a rotation about the layout origin contributes is only 1-5px.
         What was happening is that a hashed sign leaves the directions free to
         LEAN: section 0 had five strips turning one way against two at the
         same instant, and a pile whose members mostly turn together is a pile
         that turns. Strict alternation makes that impossible at any moment.

         Magnitude is down to 1.0-2.2deg (was 1.7-3.6). The far corner of a
         300px strip swings about 8px at 3deg, which was reading as travel
         rather than as a turn. */
      var turn = (i % 2 ? 1 : -1) * (1.0 + rnd(k, 3) * 1.2);
      f.style.setProperty("--dr0", turn.toFixed(2) + "deg");
      f.style.setProperty("--dname", "sc-drift-" + kind);
      f.style.setProperty("--dur", dur.toFixed(1) + "s");
      /* Phase spread across this item's OWN period, so a 60s strip is not all
         crowded into the first 32 seconds of its cycle. */
      f.style.setProperty("--delay", (-rnd(k, 5) * dur).toFixed(1) + "s");
    });

    sc.style.height = prev;
    sc.style.width = prevW;
    sc.style.setProperty("--sc-h", heap + "px");

    /* A RE-MEASURE MUST NOT ANIMATE, AND BY DEFAULT IT DID.
       .is-measuring forces left/top/transform to neutral, and the
       getBoundingClientRect calls above force a style recalc -- so those
       neutral values get COMMITTED as the computed style. Taking the class off
       then moves every strip from the flow origin back to its heap position
       with the 0.52s staggered transition live, i.e. the whole pile plays its
       gathering animation again. Measured on one width change: 75 transitions,
       left/top/transform/box-shadow across all nineteen strips. Drag a window
       edge and the ResizeObserver fires that continuously -- Tony: "at very
       narrow width, it constantly repeats, trying to cluster up."

       .is-snap holds transitions off across the restore; the forced reflow is
       what commits the new positions while they are still off. Removing it
       afterwards changes no value, so nothing animates then either.

       setTimeout, not requestAnimationFrame, for the reason the site's scrubber
       documents: rAF is suspended while the page is not rendering, which would
       strand .is-snap and leave the pile with transitions off for good. Late
       removal is harmless here -- the positions are already correct -- so a
       timer that fires whenever it fires is the safe side to err on. */
    sc.classList.add("is-snap");
    sc.classList.remove("is-measuring");
    if (work) work.classList.remove("is-flat");
    if (wasHeaped) sc.classList.add("is-cluster");
    void sc.offsetHeight;
    setTimeout(function () { sc.classList.remove("is-snap"); }, 0);

    /* What this pile was last measured against. See remeasure(). */
    sc.__mw = sc.offsetWidth;
  }

  /* EXACTLY ONE HEAP IS OPEN, and which one is decided in ONE place from the
     pointer's position -- not by pointerenter/pointerleave on each gallery.

     The per-element pairs were the other half of the glitch. enter and leave
     fire against a moving layout as well as a moving pointer, they arrive in
     an order that depends on which element resized first, and each gallery
     only knew about itself -- so two could be open at once and neither could
     tell. A single hit-test cannot disagree with itself: whatever is under the
     pointer is open, everything else is heaped, evaluated once per move.

     It also means a plain scroll opens nothing. Scrolling fires no
     pointermove, so a gallery arriving under a stationary cursor is not an
     intention and is no longer treated as one. */
  var openSc = null;

  /* A TITLE STEPS ASIDE FOR AN EXPLOSION THAT IS ABOUT TO COVER IT.
     F names each work in the clear half beside its heap, and an open gallery
     spills across the full width -- so it lands on its own title and usually
     its neighbour's too, leaving half-words ("STOP M...", "EPT ART...") that
     read as a broken layout rather than as one thing in front of another.

     Fading EVERY title whenever anything is open was the first answer and it
     is worse: the bands tile the page, so a pointer anywhere over the content
     has something open, and the names would be gone almost whenever anyone was
     looking. Only the ones actually reached need to move, which is a vertical
     overlap test -- the explosion is full width, so the x axis decides nothing.

     The reach comes from measure(), where the open layout is the thing being
     measured; reading it off the live DOM at open time would return the heap,
     because nothing has moved yet. */
  function hushTitles(sc) {
    if (!root.classList.contains("is-constellation")) return;
    var top = -Infinity, bot = -Infinity;
    if (sc) {
      var r = sc.getBoundingClientRect();
      top = r.top + (sc.__openTop || 0) - 24;
      bot = r.top + (sc.__openBot || 0) + 24;
    }
    document.querySelectorAll(".work-head").forEach(function (h) {
      var q = h.getBoundingClientRect();
      h.classList.toggle("is-hushed", sc !== null && q.bottom > top && q.top < bot);
    });
  }

  function setOpen(sc) {
    if (sc === openSc) return;
    if (touchLiftFig && touchLiftFig.closest(".scatter") !== sc) setTouchLift(null);
    if (openSc) openSc.classList.add("is-cluster");
    openSc = sc;
    if (sc) sc.classList.remove("is-cluster");
    hushTitles(sc);
  }

  /* The lightbox is modal, so the cluster behind it is paused visually as
     well as interactively. In particular, focusing the lightbox's close
     button must not read as "focus left the galleries" and retract the pile
     that supplied the enlarged item. */
  function lightboxIsOpen() {
    var lightbox = document.querySelector(".lightbox");
    return !!(lightbox && !lightbox.hidden);
  }

  /* Phone :hover used to provide this lift accidentally, and could remain
     matched after the finger left. An explicit class gives touch the same
     tactile straightening while the gesture is active, with one owner and a
     definite release path. */
  function setTouchLift(fig) {
    if (fig === touchLiftFig) return;
    if (touchLiftFig) touchLiftFig.classList.remove("is-touch-lift");
    touchLiftFig = fig;
    if (fig) fig.classList.add("is-touch-lift");
  }

  /* WHICH GALLERY IS UNDER THE POINTER -- and for the stacked variants that is
     a question about BANDS, not about which picture happens to be on top.

     It used to be `elementFromPoint(...).closest('.scatter')`, and that is
     self-contradictory the moment one gallery is open: its strips spill
     hundreds of pixels down over the galleries below, so a pointer moving
     through the spill lands alternately on a spilled strip (answer: the open
     one) and, between strips, on the band underneath (answer: a different
     one). Measured at 375px with the first gallery open, a straight line down
     the middle of the page returned 0,0,0,-1,-1,1,1,1,2,2,3,3 -- and each of
     those is a full open-and-close of a fifteen-hundred-pixel explosion. That
     is Tony's "things freak out when the browser is too narrow": the hit test
     changing its mind about what is being pointed at.

     A gallery's BAND cannot overlap another gallery's band -- they are
     siblings in normal flow -- so asking which band contains the point can
     never disagree with itself. One crossing, one switch. The spill becomes
     purely visual, which is what it always was.

     The CAROUSEL keeps elementFromPoint, and must: its four piles are
     absolutely positioned and deliberately overlap, so there are no bands and
     "what is on top" is exactly the right question there. */
  function inRect(r, x, y) {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  /* The box a gallery's strips actually occupy right now -- heaped, that is the
     pile; open, it is the whole explosion, which reaches far outside the
     gallery's own band. */
  function inkRect(sc) {
    var l = Infinity, t = Infinity, rr = -Infinity, b = -Infinity;
    sc.querySelectorAll("figure").forEach(function (f) {
      var q = f.getBoundingClientRect();
      if (q.left < l) l = q.left;
      if (q.top < t) t = q.top;
      if (q.right > rr) rr = q.right;
      if (q.bottom > b) b = q.bottom;
    });
    return { left: l, top: t, right: rr, bottom: b };
  }

  function fromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    var carousel = root.classList.contains("is-carousel");

    /* Chrome that sits OVER the galleries still wins. The header is sticky and
       the lab switch is fixed, so without this, pointing at the nav opens
       whatever band happens to be scrolled behind it. */
    if (el && el.closest && el.closest(".site-header")) return null;

    /* 1. AN OPEN GALLERY OWNS ITS WHOLE SPREAD, and nothing inside it can take
       the pointer away.

       A gallery's band is only its HEAP's box; the explosion reaches far
       outside it, so a band test alone said "you have left" the moment the
       pointer moved off the pile toward one of the strips it had just thrown
       out. Tony: "when I hover to explode open a project and I try to go and
       click on one of the items, the exploded view closes as soon as my mouse
       leaves the initial media."

       Claiming only the open gallery's own STRIPS is not enough either.
       Crossing an explosion means passing over bare page between them, and
       every one of those points sits above some other gallery -- whose little
       pile is often visible through the gap and would steal the pointer.
       Measured at 1280px with the first gallery open: 214 of 576 points across
       its own explosion handed off to a neighbour. That is the same
       change-its-mind flicker in a new guise.

       So while a gallery is open it holds everything inside the box its strips
       occupy. The rule a visitor can actually infer is "leave the explosion to
       go somewhere else" -- and leaving it collapses the thing that was
       covering the other piles, which puts them back in reach. */
    if (openSc && inRect(inkRect(openSc), x, y)) return openSc;

    /* 2. Otherwise a strip claims it: this is how a heaped pile is picked up,
       including one showing through a gap once nothing is open. */
    var fig = el && el.closest ? el.closest(".scatter figure") : null;
    if (fig) {
      var sc = fig.closest(".scatter");
      var w = carousel ? sc.closest(".work") : null;
      /* ON THE CAROUSEL ONLY THE FRONT HEAP OPENS. The other three are turned
         away -- small, dimmed and partly behind their neighbours -- so
         exploding one where it stands would spill a full-size scatter out of a
         pile the visitor can barely see, over the two in front of it. Clicking
         a turned heap brings it round instead; see carousel() below. A strip
         belonging to a turned pile claims nothing and falls through, rather
         than closing the front one out from under the pointer. */
      if (!w || w.classList.contains("is-front")) return sc;
    }

    /* The carousel's piles overlap on purpose and have no bands. */
    if (carousel) return null;

    /* 3. Otherwise the band claims it -- the forgiving way in, since a heap is
       a small target in a wide row. Bands are siblings in normal flow, so they
       cannot overlap and this can never disagree with itself. */
    var hit = null;
    document.querySelectorAll(".scatter").forEach(function (sc2) {
      if (inRect(sc2.getBoundingClientRect(), x, y)) hit = sc2;
    });
    return hit;
  }

  /* Where the pointer last was. The carousel needs it: the ring settles AFTER
     the pointer has stopped moving, so the pile that arrives at the front
     arrives under a stationary cursor and no further pointermove is coming to
     notice it. Without this, reaching for the ring stopped it and then nothing
     opened until the pointer twitched. */
  var lastX = -1, lastY = -1;

  document.addEventListener("pointermove", function (e) {
    if (!root.classList.contains("is-exploded") || reduced || lightboxIsOpen()) return;
    lastX = e.clientX;
    lastY = e.clientY;
    setOpen(fromPoint(lastX, lastY));
  }, { passive: true });

  /* TOUCH KEEPS THE ORIGINAL "PRESS AND DRAG THROUGH THE PILES" DESIGN.
     First contact opens the pile under the finger, and touchmove keeps handing
     the open state to whichever pile the finger reaches. None of the touch
     events preventDefault, so the same vertical drag still scrolls the page.

     The bug was that the browser could follow that opening gesture with a
     synthetic click. initMediaGrid then treated the click as a second action
     and opened a tile in the lightbox. Remember when this gesture opened or
     dragged a pile and consume only that follow-up click. A clean tap inside
     an ALREADY-open pile remains unblocked and opens the chosen tile normally.
     Beginning any new physical action clears the old block, so a scroll that
     produces no click cannot poison the next tap. */
  var TOUCH_SLOP = 12;

  function findTouch(list, id) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i];
    }
    return null;
  }

  /* A mouse needs the open gallery to own the gaps between its strips so the
     explosion stays stable while the pointer crosses it. A finger has a more
     deliberate signal: the rendered media strip it actually landed on. Let
     that strip win first, even when it belongs to a different pile peeking
     through the open one; fall back to the stable broad hit-test in a gap. */
  function touchFigureAt(x, y, target) {
    var el = target || document.elementFromPoint(x, y);
    return el && el.closest ? el.closest(".scatter figure") : null;
  }

  function fromTouchPoint(x, y, target) {
    var fig = touchFigureAt(x, y, target);
    return fig ? fig.closest(".scatter") : fromPoint(x, y);
  }

  document.addEventListener("touchstart", function (e) {
    /* Also clear explicitly for older touch implementations that do not emit
       Pointer Events before their Touch Events. */
    root.classList.remove("is-keyboard-nav");
    blockedClickSc = null;
    setTouchLift(null);
    if (!root.classList.contains("is-exploded") || reduced || lightboxIsOpen() ||
        !e.touches || e.touches.length !== 1) {
      touchGesture = null;
      return;
    }

    var t = e.touches[0];
    var touchedFig = touchFigureAt(t.clientX, t.clientY, e.target);
    var next = fromTouchPoint(t.clientX, t.clientY, e.target);
    var switched = next !== openSc;
    setOpen(next);
    touchGesture = {
      id: t.identifier,
      x: t.clientX,
      y: t.clientY,
      moved: false
    };
    setTouchLift(touchedFig && touchedFig.closest(".scatter") === next ? touchedFig : null);
    if (switched && next) blockedClickSc = next;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!touchGesture) return;
    if (!e.touches || e.touches.length !== 1) {
      touchGesture.moved = true;
      return;
    }
    var t = findTouch(e.touches, touchGesture.id);
    if (!t) { touchGesture.moved = true; return; }
    var dx = t.clientX - touchGesture.x;
    var dy = t.clientY - touchGesture.y;
    if (dx * dx + dy * dy > TOUCH_SLOP * TOUCH_SLOP) touchGesture.moved = true;

    var touchedFig = touchFigureAt(t.clientX, t.clientY);
    var next = fromTouchPoint(t.clientX, t.clientY);
    if (next !== openSc) setOpen(next);
    setTouchLift(touchedFig && touchedFig.closest(".scatter") === next ? touchedFig : null);
    /* A real drag is a cluster/scroll gesture even if it finishes in the same
       pile it began in. Do not let its release enlarge an arbitrary tile. */
    if (touchGesture.moved && next) blockedClickSc = next;
  }, { passive: true });

  document.addEventListener("touchend", function () {
    setTouchLift(null);
    touchGesture = null;
  }, { passive: true });

  document.addEventListener("touchcancel", function () {
    setTouchLift(null);
    touchGesture = null;
    blockedClickSc = null;
  }, { passive: true });

  window.addEventListener("blur", function () { setTouchLift(null); });

  /* Capture runs before the figure's bubble-phase click handler in script.js.
     The touch block is heap-specific, and pointerdown/touchstart/keydown clears
     it before any genuinely separate action, so later taps cannot be swallowed.

     The second guard is deliberately input-agnostic: if a visible strip from
     ANOTHER retracted pile peeks through the open explosion, its first click
     belongs to that pile, not to the lightbox. Touchstart normally switches it
     first; this is the final authority for browsers with unusual touch targets
     and gives a mouse the same understandable first-click rule. */
  document.addEventListener("click", function (e) {
    var sc = e.target && e.target.closest ? e.target.closest(".scatter") : null;
    if (blockedClickSc) {
      var blocked = blockedClickSc;
      blockedClickSc = null;
      if (sc === blocked) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }

    if (root.classList.contains("is-exploded") && !reduced &&
        !lightboxIsOpen() && sc && sc !== openSc) {
      setOpen(sc);
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  /* Keyboard: tabbing into a gallery opens it. No focusout handler is needed
     any more -- the next thing focused sets the open one, and if that is
     outside every gallery, setOpen(null) heaps them all. */
  document.addEventListener("focusin", function (e) {
    if (!root.classList.contains("is-exploded") || reduced || lightboxIsOpen()) return;
    setOpen(e.target.closest ? e.target.closest(".scatter") : null);
  });

  function pile(on) {
    if (!on) setOpen(null);
    document.querySelectorAll(".scatter").forEach(function (sc) {
      if (!on) {
        sc.classList.remove("is-cluster");
        sc.style.removeProperty("height");
        sc.style.removeProperty("--sc-h");
        return;
      }
      measure(sc);
      sc.classList.add("is-cluster");
    });
    if (on) openSc = null;
  }


  /* =========================================================== G: the carousel
     The four piles stop being a column and become a ring seen edge on: one at
     the front, one turned away behind it, one to each side, all four on screen
     at once and each taking its turn at the front.

     Position is computed rather than declared, because a ring is trigonometry
     and CSS keyframes can only approximate one with a polygon -- at this
     radius a twelve-stop track sags about ten pixels off the true circle on
     every leg. Four elements a frame is nothing; the drift, which runs on
     nineteen and runs continuously, stays on the compositor where it belongs.

     THE RING STOPS WHEN THE POINTER ARRIVES, and that is not a nicety. B's
     whole mechanic is that reaching a pile opens it, and this page has already
     been through one version of the lesson: a hover target that moves under
     the pointer cannot be reached, and no amount of damping fixes it -- the
     motion has to stop. So the rotation is ambient, for a visitor who is not
     yet pointing at anything, and the moment one is it holds still. */
  var CAR_TURN = 46000;   // ms for a full revolution
  var carPhase = 0, carLast = 0, carRaf = 0, carHold = false, carTo = null;

  function carPaint() {
    var works = document.querySelectorAll(".work");
    var n = works.length;
    if (!n) return;
    var stage = works[0].parentNode;
    var cw = stage.clientWidth;
    /* Radius as a fraction of the stage, read off the stage, so the narrow
       breakpoint can pull the ring in from CSS beside the rule that widens
       the piles -- rather than the two halves of one adjustment living in
       different files. */
    var want = cw * (parseFloat(getComputedStyle(stage)
                       .getPropertyValue("--car-r")) || 0.31);
    /* CLAMPED SO A PILE'S BOX STAYS INSIDE THE STAGE. A .work is as wide as
       its OPEN explosion needs, which is far wider than the heap drawn in it
       -- so at the detents the boxes hung 86px past the viewport and the page
       grew a horizontal scrollbar even though nothing visible was out there.
       Overflow is computed on boxes, not on ink. The cap is geometric rather
       than a smaller number in the CSS, so it holds at every width instead of
       being right at the one it was tuned on. */
    /* Measured off a TURNED pile, not works[0]. The front lane widens (see
       below), so clamping against it would pull the ring in every time a pile
       arrived and let it back out when one left -- the radius would breathe. */
    var lane = 0;
    works.forEach(function (w) {
      if (!w.classList.contains("is-front")) lane = Math.max(lane, w.offsetWidth);
    });
    if (!lane) lane = works[0].offsetWidth;
    /* --car-fit: 0 turns the clamp off, for a stage narrow enough that four
       lanes cannot sit side by side at all. Below about 720px the clamp
       collapses the radius to nothing and the ring becomes one heap in the
       middle -- so there the stage clips horizontally instead and the turned
       piles are allowed to hang half off it, which is what a carousel on a
       phone has always looked like. Clipping is safe because only the FRONT
       pile explodes and it is centred. */
    var fit = parseFloat(getComputedStyle(stage).getPropertyValue("--car-fit"));
    var rx = fit === 0 ? want
                       : Math.min(want, Math.max(0, cw / 2 - lane / 2));
    var best = -1, bestEl = null;

    works.forEach(function (w, j) {
      var th = (carPhase + j / n) * Math.PI * 2;
      /* d is depth: 1 at the front, 0 turned fully away. Everything else --
         size, height, dimming and paint order -- is a function of it, so the
         four cues can never disagree about which pile is nearest. */
      var d = (Math.cos(th) + 1) / 2;
      w.style.setProperty("--car-x", Math.round(Math.sin(th) * rx) + "px");
      w.style.setProperty("--car-y", Math.round(-(1 - d) * 88) + "px");
      w.style.setProperty("--car-s", (0.46 + 0.54 * d).toFixed(3));
      w.style.setProperty("--car-o", (0.28 + 0.72 * d).toFixed(3));
      w.style.zIndex = Math.round(d * 100) + 1;
      if (d > best) { best = d; bestEl = w; }
    });

    /* SQUARELY AT THE FRONT, not merely nearest to it. With four piles the
       ring passes through positions where two sit at +-0.7 of the radius and
       nothing is at the front at all -- and "nearest the front" there is a
       pile standing over its neighbour, whose explosion then covers the pile
       you were about to reach for. Below the threshold no pile is front, so
       nothing opens and every pile is click-to-bring-round. */
    /* ARRIVING AT THE FRONT WIDENS THE LANE, WHICH MEANS RE-MEASURING.
       A turned pile is a lane narrow enough that four fit on the ring; the
       front pile has to explode into something worth looking at, and in a
       528px lane seven items stacked five rows deep and ran 143px past the
       bottom of the screen. So the front lane widens, and because a heap's
       positions are deltas from the FLOW those deltas are now wrong.

       Re-measuring is free of visible artefacts here, which is not obvious:
       the heap is centred on the lane and the lane is centred on the stage,
       and the strip size is capped well below either width -- so every strip
       lands on the same pixel it was already on and only the open layout
       changes. It runs on a front CHANGE, not per frame: a handful of times a
       minute, and at a detent where nothing else is moving. */
    works.forEach(function (w) {
      var was = w.classList.contains("is-front");
      var now = w === bestEl && best > 0.985;
      if (was === now) return;
      w.classList.toggle("is-front", now);
      var sc = w.querySelector(".scatter");
      if (sc) measure(sc);
    });
  }

  function carStep(ts) {
    carRaf = requestAnimationFrame(carStep);
    var dt = carLast ? Math.min(64, ts - carLast) : 16;
    carLast = ts;

    var landed = false;
    if (carTo !== null) {
      /* Shortest way round: the phase is a circle, so a turn from 0.9 to 0.1
         is a tenth forward, not nine tenths back. Rounding the difference to
         the nearest whole revolution is the whole of that. */
      var diff = carTo - carPhase;
      diff -= Math.round(diff);
      if (Math.abs(diff) < 0.002) { carPhase = carTo; carTo = null; landed = true; }
      else carPhase += diff * Math.min(1, dt / 190);
    } else if (!carHold) {
      carPhase += dt / CAR_TURN;
    }
    carPhase = (carPhase % 1 + 1) % 1;
    carPaint();
    /* The ring has stopped and a pile is now squarely at the front. Ask the
       hit-test again, because the pointer has not moved and will not: what
       changed is what is underneath it. */
    if (landed && lastX >= 0) setOpen(fromPoint(lastX, lastY));
  }

  /* Bring a turned pile round to the front. Front is where (phase + j/n) is a
     whole revolution, so the phase it wants is simply -j/n. */
  function carBring(w) {
    var works = document.querySelectorAll(".work");
    var j = Array.prototype.indexOf.call(works, w);
    if (j < 0) return;
    carTo = ((-j / works.length) % 1 + 1) % 1;
  }

  function carousel(on) {
    if (carRaf) { cancelAnimationFrame(carRaf); carRaf = 0; }
    carLast = 0;
    if (!on) {
      document.querySelectorAll(".work").forEach(function (w) {
        w.classList.remove("is-front", "is-flat");
        w.style.zIndex = "";
        ["--car-x", "--car-y", "--car-s", "--car-o"].forEach(function (p) {
          w.style.removeProperty(p);
        });
      });
      return;
    }
    carPaint();
    carRaf = requestAnimationFrame(carStep);
  }

  /* Holding the ring still is a property of the STAGE, not of one pile: the
     piles overlap, so a leave/enter pair between two of them would restart the
     rotation for a frame in the middle of a reach. */
  document.addEventListener("pointerover", function (e) {
    if (!root.classList.contains("is-carousel")) return;
    var over = !!(e.target.closest && e.target.closest(".work"));
    /* IT DOES NOT JUST STOP, IT SETTLES. Stopping dead leaves the ring
       wherever it happened to be, which half the time is between positions --
       no pile at the front, so nothing opens and the stage reads as broken.
       Snapping to the nearest quarter turn puts one pile squarely at the
       front and the other three where they belong.

       This is the one place the "a hover target must not move" rule is bent,
       and deliberately: it is a single settle of a few hundred milliseconds
       that ENDS stationary, not a motion that continues under the pointer.
       Nearest detent rather than "bring the one under the pointer round", so
       the movement is always the smallest one that resolves the ring. */
    if (over && !carHold) {
      var n = document.querySelectorAll(".work").length || 1;
      carTo = ((Math.round(carPhase * n) / n) % 1 + 1) % 1;
    }
    carHold = over;
  }, { passive: true });
  /* pointerover alone would leave the ring frozen for good if the pointer
     left the window while it was over a pile -- no further pointerover ever
     arrives. A null relatedTarget on pointerout is the pointer leaving the
     document, which is the one case that needs saying explicitly. */
  document.addEventListener("pointerout", function (e) {
    if (!e.relatedTarget) carHold = false;
  }, { passive: true });

  /* Clicking a turned pile brings it round. Taken in the CAPTURE phase, for
     the same reason the drawers take theirs: initMediaGrid has already bound
     the lightbox to every figure, and a click on a pile at the back would
     otherwise enlarge whichever strip happened to be on top of it. Once the
     pile is at the front the handler stands aside and the figures behave
     exactly as they do in B. */
  document.addEventListener("click", function (e) {
    if (!root.classList.contains("is-carousel")) return;
    var w = e.target.closest && e.target.closest(".work");
    if (!w || w.classList.contains("is-front")) return;
    e.preventDefault();
    e.stopPropagation();
    carBring(w);
  }, true);

  /* Tabbing into a turned pile brings it round too, so the keyboard reaches
     all four. Without this a keyboard visitor can focus a strip that is at 54%
     and 34% opacity behind two others, which is a focus ring on something
     effectively invisible. */
  document.addEventListener("focusin", function (e) {
    if (!root.classList.contains("is-carousel")) return;
    var w = e.target.closest && e.target.closest(".work");
    if (w && !w.classList.contains("is-front")) carBring(w);
  });


  /* ============================================================== C: the bands
     A horizontally scrolling region has to be a focus stop, or a keyboard can
     reach the figures inside it (initMediaGrid makes them tabbable) but has no
     way to scroll the strip itself -- and browsers disagree about whether an
     overflow container is focusable on its own. Set here rather than in the
     markup because in the other two variants the element scrolls nothing, and
     a focus stop that does nothing is worse than no focus stop.

     If bands ever ship, these three attributes are authored in the HTML
     instead and this function goes away with the switch. */
  function bandKeys(on) {
    if (!on) return;                    // clearRoles() owns the tear-down
    document.querySelectorAll(".scatter").forEach(function (sc) {
      /* A band that fits gets none of this. Reminiscence Reverie holds one
         item and its strip is exactly the container width, so it does not
         scroll -- and then the edge fade eats 54px of the only picture in the
         section for nothing, and the focus stop is a tab stop that does
         nothing when you get there. Both are keyed off real overflow. */
      var scrolls = sc.scrollWidth > sc.clientWidth + 1;
      sc.classList.toggle("has-overflow", scrolls);

      if (!scrolls) {
        sc.removeAttribute("tabindex");
        sc.removeAttribute("role");
        sc.removeAttribute("aria-label");
        return;
      }
      var work = sc.closest(".work");
      var h = work && work.querySelector("h2");
      sc.setAttribute("tabindex", "0");
      sc.setAttribute("role", "group");
      sc.setAttribute("aria-label", (h ? h.textContent : "Gallery") +
        " — scrolling gallery, " + sc.querySelectorAll("figure").length + " items");
    });
  }


  /* ============================================================== E: drawers
     A sliver per work; click one to open it, and only one is open at a time.

     The click is taken in the CAPTURE phase while the drawer is shut, because
     initMediaGrid has already bound the lightbox to every figure and a click
     on a peeking strip would otherwise enlarge it rather than open the drawer.
     Once open the handler stands aside and the figures behave normally.

     Quick prototype: the open height reuses B's measurement, and the drawer is
     a real focus stop so a keyboard can reach it. */
  function drawers(on) {
    if (!on) return;                    // clearRoles() owns the tear-down
    document.querySelectorAll(".scatter").forEach(function (sc) {
      measure(sc);
      sc.setAttribute("tabindex", "0");
      sc.setAttribute("role", "button");
      sc.setAttribute("aria-expanded", "false");
      wireDrawer(sc);
    });
  }

  function openDrawer(sc) {
    document.querySelectorAll(".scatter").forEach(function (o) {
      var isIt = o === sc;
      o.classList.toggle("is-open", isIt);
      o.setAttribute("aria-expanded", isIt ? "true" : "false");
      o.setAttribute("tabindex", isIt ? "-1" : "0");
    });
  }

  function wireDrawer(sc) {
    if (sc.dataset.drawerWired) return;
    sc.dataset.drawerWired = "1";
    sc.addEventListener("click", function (e) {
      if (!root.classList.contains("is-drawers")) return;
      if (sc.classList.contains("is-open")) return;
      e.preventDefault();
      e.stopPropagation();
      openDrawer(sc);
    }, true);
    sc.addEventListener("keydown", function (e) {
      if (!root.classList.contains("is-drawers")) return;
      if (sc.classList.contains("is-open")) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      openDrawer(sc);
    });
  }


  /* ------------------------------------------------------------------ resize
     Both of the above are measurements, so both go stale when the width
     changes. ResizeObserver rather than a resize listener for the reason the
     scrubber's rail documents: the container also moves when a scrollbar
     appears, which fires no resize event. */
  /* THE OBSERVER SEES ITS OWN WRITES. measure() sets --sc-h, which IS the
     scatter's height, so every measurement resizes the very element being
     observed and the observer fires again -- three ticks for one width change,
     each one a forced layout over nineteen strips.

     A pile only goes stale when its WIDTH changes, so that is the gate. It
     costs nothing in coverage: the box is a fixed --sc-h tall and the
     container's width, so a lazily-loaded image landing does not resize it at
     all and never reached this path anyway -- which is what the load listener
     below is for, and why that one forces. */
  function remeasure(force) {
    function pass(sc) {
      if (force === true || sc.offsetWidth !== sc.__mw) measure(sc);
    }
    if (root.classList.contains("is-exploded") && !reduced) {
      document.querySelectorAll(".scatter").forEach(pass);
    }
    bandKeys(root.classList.contains("is-bands"));
    if (root.classList.contains("is-drawers")) {
      document.querySelectorAll(".scatter").forEach(pass);
    }
    /* The ring's radius is a fraction of the stage, and every pile has just
       been re-measured against a new width, so the layout has to be redrawn
       even though the phase has not moved. */
    if (root.classList.contains("is-carousel")) carPaint();
  }

  /* THE GATE NEEDS A SAFETY NET, AND A DRAGGED WINDOW EDGE IS WHY.
     The observer's notifications are coalesced per frame, and during a drag
     the last one can be delivered while the layout is still settling -- so a
     pile gets measured at a width that is then superseded with no further
     notification. Before the width gate that healed itself, because every tick
     re-measured; with the gate the stale measurement sticks, and the heap sits
     spread across the page at that one width until something else disturbs it.
     Seen at 470px: the galleries were 422px wide and still carrying deltas
     measured against 1037.

     So the gated pass runs immediately, for responsiveness, and a FORCED pass
     runs once the width has been still for a moment. A measurement is silent
     now (see .is-snap), so the second pass costs nothing visible and one extra
     layout per gesture is a fair price for never being wrong. */
  var settle = 0;

  /* AND THE SETTLE PASS CHECKS ITS OWN WORK. A measurement is only valid for
     the width it was pinned to, and a window still being dragged can move on
     between the pass starting and the layout landing. Rather than guess at a
     debounce long enough to outlast every browser and every drag, compare each
     pile's pinned width against what it actually ended up with and go again if
     they disagree. Bounded, so a pathological layout cannot spin. */
  function settlePass(tries) {
    remeasure(true);
    var stale = false;
    document.querySelectorAll(".scatter").forEach(function (sc) {
      if (sc.offsetWidth !== sc.__pinW) stale = true;
    });
    if (stale && tries > 0) {
      setTimeout(function () { settlePass(tries - 1); }, 120);
    }
  }

  function onResize() {
    remeasure();
    clearTimeout(settle);
    settle = setTimeout(function () { settlePass(4); }, 140);
  }

  if ("ResizeObserver" in window) {
    /* remeasure() is never handed the observer's entries directly: `force` has
       to be a literal true, and only the call sites here and on `load` pass
       one. */
    var ro = new ResizeObserver(onResize);
    document.querySelectorAll(".scatter").forEach(function (sc) { ro.observe(sc); });
  }

  /* A lazily-loaded image landing changes a row's height and therefore the
     open height every pile delta was measured against -- without changing the
     scatter's own box, so the observer above never sees it. Forced. */
  window.addEventListener("load", function () { remeasure(true); });

  setVariant();


  /* ====================================================== authoring check
     LOCAL ONLY. Every mistake this catches is one you cannot see by looking at
     the page, which is the whole reason it is worth twenty lines: a figure
     missing its <figcaption><strong> still draws perfectly and simply becomes
     an unlabelled "Enlarge" button with an uncaptioned lightbox, and a wrong
     --ar is a shape you would blame on the picture. Adding media by hand is
     the normal way this page changes, so the footguns get a smoke alarm.

     Silent on a real host, so it costs a shipped page nothing but its bytes.
     Delete the whole block to remove it; nothing else refers to it. */
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    window.addEventListener("load", function () {
      var say = [];

      document.querySelectorAll(".scatter").forEach(function (sc) {
        var name = (sc.closest(".work") || {}).querySelector
          ? (sc.closest(".work").querySelector("h2") || {}).textContent : "?";
        if (!sc.querySelector(".sc-fill")) {
          say.push(name + ": no <i class=\"sc-fill\"> spacer -- the last row " +
                   "will grow its items to full width.");
        }
      });

      document.querySelectorAll(".scatter figure").forEach(function (f) {
        var strong = f.querySelector("figcaption strong");
        var label = strong ? strong.textContent : null;
        var src = (f.querySelector("img,video") || {}).getAttribute
          ? (f.querySelector("img,video").getAttribute("src") ||
             f.querySelector("img,video").getAttribute("data-src") || "?") : "?";

        if (!label) {
          say.push(src + ": no <figcaption><strong> -- this tile announces as " +
                   "\"Enlarge\" and its lightbox opens with no caption.");
        }

        var v = f.querySelector("video");
        if (v) {
          if (!v.getAttribute("poster")) {
            say.push(src + ": <video> with no poster -- nothing to show at rest.");
          }
          if (v.getAttribute("preload") !== "none") {
            say.push(src + ": <video> without preload=\"none\" -- it downloads " +
                     "on page load instead of on demand.");
          }
        }

        /* --ar has to match the file or the row is justified against a shape
           the picture does not have. Checked against the decoded image rather
           than trusted, for the same reason a manifest never overrules ffprobe
           in this project: the file is the authority on the file. */
        var img = f.querySelector("img");
        if (!img) return;
        var check = function () {
          if (!img.naturalWidth || !img.naturalHeight) return;
          var real = img.naturalWidth / img.naturalHeight;
          var said = parseFloat(getComputedStyle(f).getPropertyValue("--ar"));
          if (!isFinite(said) || Math.abs(said - real) / real > 0.03) {
            console.warn("[mini-lab] " + src + ": --ar is " +
              (isFinite(said) ? said : "unset") + " but the file is " +
              real.toFixed(3) + " (" + img.naturalWidth + "x" +
              img.naturalHeight + ").");
          }
        };
        if (img.complete) check(); else img.addEventListener("load", check);
      });

      if (say.length) {
        console.warn("[mini-lab] " + say.length +
                     " authoring problem(s):\n  " + say.join("\n  "));
      }
    });
  }
})();

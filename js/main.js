/* ============================================================
   Stephen Jackson — Personal Site
   Vanilla JS: nav state, mobile menu, smooth-scroll + active link,
   scroll-reveal (IntersectionObserver), and the pinned scroll-scrub
   statement (GSAP ScrollTrigger). Honors prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --------------------------------------------------------
     1. NAV — transparent over hero, solid after scroll
     -------------------------------------------------------- */
  var nav = document.getElementById("nav");
  var hero = document.getElementById("hero");

  function syncNavState() {
    var threshold = hero ? hero.offsetHeight - 80 : 200;
    nav.setAttribute("data-state", window.scrollY > threshold ? "scrolled" : "top");
  }

  /* rAF-throttled scroll handler */
  var scrollScheduled = false;
  function onScroll() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(function () {
      syncNavState();
      scrollScheduled = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", syncNavState);
  syncNavState();

  /* --------------------------------------------------------
     2. MOBILE MENU SHEET
     -------------------------------------------------------- */
  var toggle = document.getElementById("navToggle");
  var sheet = document.getElementById("mobileSheet");

  function setMenu(open) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    sheet.setAttribute("data-open", String(open));
    sheet.setAttribute("aria-hidden", String(!open));
    document.body.style.overflow = open ? "hidden" : "";
  }
  toggle.addEventListener("click", function () {
    setMenu(toggle.getAttribute("aria-expanded") !== "true");
  });
  /* Close on link click + on Escape */
  sheet.querySelectorAll(".sheet__link").forEach(function (link) {
    link.addEventListener("click", function () { setMenu(false); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      toggle.focus();
    }
  });

  /* --------------------------------------------------------
     3. ACTIVE SECTION HIGHLIGHTING
     -------------------------------------------------------- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav__link"));
  var sectionIds = navLinks.map(function (l) { return l.getAttribute("href").slice(1); });
  var sections = sectionIds
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);

  if ("IntersectionObserver" in window) {
    var activeObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id;
          navLinks.forEach(function (link) {
            link.setAttribute("aria-current",
              link.getAttribute("href") === "#" + id ? "true" : "false");
          });
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    sections.forEach(function (s) { activeObserver.observe(s); });
  }

  /* --------------------------------------------------------
     4. SCROLL REVEAL — IntersectionObserver
     -------------------------------------------------------- */
  var revealEls = document.querySelectorAll(".reveal");
  if (prefersReduced || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.12 });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* --------------------------------------------------------
     5. PINNED SCROLL-SCRUB STATEMENT
        Drives ambient video.currentTime from scroll progress
        and reveals statement lines in sync. Degrades gracefully.
     -------------------------------------------------------- */
  var scrubSection = document.getElementById("work");
  var scrubVideo = document.getElementById("scrubVideo");
  var scrubLines = Array.prototype.slice.call(document.querySelectorAll(".scrub__line"));

  function enableScrubFallback() {
    /* Static / ambient fallback: quietly loop the muted video if it
       can play, otherwise the poster stands in. Lines simply fade in. */
    if (scrubVideo) {
      scrubVideo.setAttribute("loop", "");
      scrubVideo.setAttribute("autoplay", "");
      var p = scrubVideo.play();
      if (p && typeof p.catch === "function") { p.catch(function () {}); }
    }
    /* reveal lines with IntersectionObserver (or immediately) */
    if (prefersReduced || !("IntersectionObserver" in window)) {
      scrubLines.forEach(function (l) { l.style.opacity = "1"; l.style.transform = "none"; });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.style.transition = "opacity 0.9s ease, transform 0.9s ease";
          entry.target.style.opacity = "1";
          entry.target.style.transform = "none";
        }
      });
    }, { threshold: 0.4 });
    scrubLines.forEach(function (l) {
      l.style.opacity = "0";
      l.style.transform = "translateY(16px)";
      io.observe(l);
    });
  }

  function initScrub() {
    var gsapReady = window.gsap && window.ScrollTrigger;

    /* Graceful degradation paths — only when motion is disabled or GSAP
       failed to load. Touch / small screens now scroll-scrub like desktop. */
    if (prefersReduced || !gsapReady) {
      enableScrubFallback();
      return;
    }

    scrubSection.setAttribute("data-scrub", "on");
    gsap.registerPlugin(ScrollTrigger);

    /* --- Event-driven video scrubbing ---
       Issue at most ONE seek at a time and wait for the browser's `seeked`
       event before issuing the next. This paces seeks to whatever the decoder
       can actually sustain instead of flooding it every animation frame
       (the source of the scroll stutter). */
    var targetTime = 0;       // where scroll wants the video
    var displayTime = 0;      // eased position we actually seek to
    var duration = 0;
    var isSeeking = false;    // a seek is in flight, awaiting `seeked`
    var lastSeek = -1;        // last value we sent to currentTime
    var seekStart = 0;        // timestamp the in-flight seek began (watchdog)
    var SEEK_EPS = 0.03;      // seconds; skip seeks smaller than this

    function onMeta() { duration = scrubVideo.duration || 0; }
    if (scrubVideo.readyState >= 1) { onMeta(); }
    else { scrubVideo.addEventListener("loadedmetadata", onMeta); }

    /* Released only when the browser confirms the seek completed. */
    scrubVideo.addEventListener("seeked", function () { isSeeking = false; });

    function pump(now) {
      if (duration > 0) {
        /* Watchdog: if a `seeked` never arrives (some browsers coalesce seeks
           that resolve to an unchanged keyframe), self-clear so we don't deadlock. */
        if (isSeeking && now - seekStart > 250) { isSeeking = false; }

        if (!isSeeking) {
          /* Ease toward the scroll target; advances one step per completed
             seek, naturally matching the decoder's real seek rate. */
          displayTime += (targetTime - displayTime) * 0.2;
          if (Math.abs(displayTime - lastSeek) > SEEK_EPS) {
            isSeeking = true;
            seekStart = now;
            lastSeek = displayTime;
            try { scrubVideo.currentTime = displayTime; }
            catch (e) { isSeeking = false; }
          }
        }
      }
      requestAnimationFrame(pump);
    }
    requestAnimationFrame(pump);

    /* Pin the section; map progress -> targetTime */
    ScrollTrigger.create({
      trigger: scrubSection,
      start: "top top",
      end: "bottom bottom",
      pin: "#scrubPin",
      scrub: true,
      onUpdate: function (self) {
        if (duration > 0) { targetTime = self.progress * duration; }
      }
    });

    /* Reveal each line across the scroll, staggered through progress */
    var seg = 1 / scrubLines.length;
    scrubLines.forEach(function (line, i) {
      var start = i * seg;
      gsap.fromTo(line,
        { opacity: 0, y: 18 },
        {
          opacity: 1, y: 0, ease: "power2.out",
          scrollTrigger: {
            trigger: scrubSection,
            start: "top top",
            end: "bottom bottom",
            scrub: true,
            onUpdate: function (self) {
              /* Fade in over its segment; fade out slightly before the next */
              var p = self.progress;
              var local = (p - start) / seg;
              var op = Math.max(0, Math.min(1, local * 1.6));
              if (i < scrubLines.length - 1 && p > start + seg * 1.05) {
                op = Math.max(0, 1 - (p - (start + seg)) / (seg * 0.5));
              }
              gsap.set(line, { opacity: op, y: (1 - op) * 18 });
            }
          }
        }
      );
    });

    ScrollTrigger.refresh();

    /* iOS Safari only paints frames from `currentTime` seeks after the video
       has played at least once. Prime it (play→pause) on the first user
       gesture so mobile scrubbing actually renders. Runs once, stays silent. */
    function primeVideo() {
      var p = scrubVideo.play();
      if (p && typeof p.then === "function") {
        p.then(function () { scrubVideo.pause(); }).catch(function () {});
      } else {
        scrubVideo.pause();
      }
    }
    window.addEventListener("touchstart", primeVideo, { passive: true, once: true });
    window.addEventListener("pointerdown", primeVideo, { passive: true, once: true });
  }

  /* GSAP loads with defer; init on window load to ensure it's parsed */
  if (document.readyState === "complete") { initScrub(); }
  else { window.addEventListener("load", initScrub); }

})();

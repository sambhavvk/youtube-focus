(() => {
  "use strict";

  const STORAGE_KEY = "youtubeFocusSettings";
  const DEFAULTS = { enabled: true, cardSize: "comfortable" };
  const CARD_SELECTOR = "ytd-compact-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer";
  let settings = { ...DEFAULTS };
  let ready = false;
  let navigating = false;
  let layout = null;
  let pending = null;
  let resizePending = null;

  function normalizeSettings(value) {
    return {
      enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
      cardSize: ["compact", "comfortable", "large"].includes(value?.cardSize)
        ? value.cardSize : "comfortable"
    };
  }

  function schedule() {
    if (pending === null) pending = setTimeout(reconcile, 60);
  }

  // Let YouTube update its player dimensions after the columns change. Never
  // replace the player or its video element, so playback and native controls stay intact.
  function notifyResize() {
    clearTimeout(resizePending);
    resizePending = setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  }

  function watchPage() {
    return location.pathname === "/watch" && new URLSearchParams(location.search).has("v");
  }

  function moveNative(state, node, destination, before = null) {
    if (!node || node.parentNode === destination) return;
    if (!state.moves.has(node)) {
      const anchor = document.createComment("youtube-focus original position");
      const parent = node.parentNode;
      const next = node.nextSibling;
      node.before(anchor);
      state.moves.set(node, { anchor, parent, next });
    }
    destination.insertBefore(node, before);
  }

  // The watch metadata reuses #title for several sections (Chapters, Transcript,
  // infocards). The real video name lives in #title-row, so never match lookalikes.
  function findVideoTitle(metadata) {
    const row = metadata.querySelector("#title-row");
    if (row) return row.querySelector("#title, h1");
    return metadata.querySelector(":scope > #title, :scope > h1");
  }

  function createLayout(watch) {
    const columns = watch.querySelector("#columns");
    const primary = columns?.querySelector("#primary");
    const secondary = columns?.querySelector("#secondary");
    const below = primary?.querySelector("#below");
    // Unknown page variants stay untouched until the native watch structure is ready.
    if (!columns || !primary || !secondary || !below) return null;

    const state = {
      watch, columns, primary, secondary, moves: new Map(), marked: new Set(),
      nativeVisibility: new Map(), nativeBodyAttributes: new Map(),
      videoId: new URLSearchParams(location.search).get("v"), commentsOpen: false
    };
    state.details = document.createElement("div");
    state.details.id = "yf-details";
    // The native video name moves here, below the player. Channel, actions and
    // description stay together in the sidebar.
    state.title = document.createElement("div");
    state.title.id = "yf-title";
    // Recommendations keep their native cards but lose the "Recommended videos" heading.
    state.recommendations = document.createElement("section");
    state.recommendations.id = "yf-recommendations";
    state.recommendations.setAttribute("aria-label", "Recommended videos");
    state.recommendations.hidden = true;

    state.toggle = document.createElement("button");
    state.toggle.id = "yf-comments-toggle";
    state.toggle.type = "button";
    state.toggle.setAttribute("aria-controls", "yf-comments-panel");
    state.toggle.setAttribute("aria-expanded", "false");
    state.toggle.textContent = "Open comments";
    state.toggle.addEventListener("click", () => setComments(!state.commentsOpen));

    state.commentsPanel = document.createElement("section");
    state.commentsPanel.id = "yf-comments-panel";
    state.commentsPanel.setAttribute("aria-label", "Comments");
    state.commentsPanel.tabIndex = 0;
    state.commentsPanel.hidden = true;
    state.commentsStatus = document.createElement("p");
    state.commentsStatus.className = "yf-comments-status";
    state.commentsStatus.setAttribute("role", "status");
    state.commentsStatus.textContent = "Comments will appear here when YouTube loads them. Some videos have comments turned off.";
    state.commentsPanel.append(state.commentsStatus);
    // The native panel's close command addresses its original sidebar container.
    // Route that existing control to the relocated panel's toggle instead.
    state.commentsPanel.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest("ytd-engagement-panel-title-header-renderer #visibility-button")) {
        event.preventDefault();
        event.stopPropagation();
        setComments(false, true);
      }
    }, true);
    state.details.append(state.toggle, state.commentsPanel);
    (secondary.querySelector("#secondary-inner") || secondary).prepend(state.details);
    primary.after(state.title);
    columns.append(state.recommendations);

    state.structureObserver = new MutationObserver(schedule);
    state.structureObserver.observe(watch, { childList: true, subtree: true });
    state.modeObserver = new MutationObserver(() => { schedule(); notifyResize(); });
    state.modeObserver.observe(watch, {
      attributes: true, attributeFilter: ["theater", "fullscreen", "video-id", "is-two-columns_", "hidden"]
    });
    state.resizeObserver = new ResizeObserver(() => sizeSidebar(state));
    state.resizeObserver.observe(primary);
    state.commentsObserver = new MutationObserver(() => {
      if (state.commentsOpen && state.commentsHost?.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN") {
        setComments(false);
      }
    });
    watch.classList.add("yf-active");
    notifyResize();
    return state;
  }

  function teardown() {
    if (!layout) return;
    const state = layout;
    layout = null;
    state.structureObserver.disconnect();
    state.modeObserver.disconnect();
    state.resizeObserver.disconnect();
    state.commentsObserver.disconnect();
    state.watch.classList.remove("yf-active");
    delete state.watch.dataset.yfCardSize;
    state.watch.style.removeProperty("--yf-player-height");
    // Reverse order restores children before their original containing blocks.
    for (const [node, record] of [...state.moves].reverse()) {
      if (node.isConnected && record.anchor.isConnected) {
        record.anchor.replaceWith(node);
      } else if (node.isConnected && record.parent.isConnected) {
        // YouTube can re-render a container and drop the anchor; fall back to the
        // recorded parent so disabling still restores the native content.
        record.anchor.remove();
        record.parent.insertBefore(node, record.next?.isConnected ? record.next : null);
      } else {
        record.anchor.remove();
      }
    }
    for (const node of state.marked) {
      delete node.dataset.yfGrid;
      delete node.dataset.yfWide;
    }
    for (const [node, value] of state.nativeVisibility) {
      if (value === null) node.removeAttribute("visibility");
      else node.setAttribute("visibility", value);
    }
    for (const [node, attributes] of state.nativeBodyAttributes) {
      for (const [name, value] of Object.entries(attributes)) {
        if (value === null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      }
    }
    state.details.remove();
    state.title.remove();
    state.recommendations.remove();
    notifyResize();
  }

  function markRecommendationGrids(state, related) {
    // Both the older compact renderers and the current lockup renderers are native
    // YouTube elements. Keep continuations, shelves and menus in their original lists.
    for (const list of related.querySelectorAll("#items, #contents")) {
      const children = [...list.children];
      if (!children.some(child => child.matches(CARD_SELECTOR))) continue;
      if (!list.hasAttribute("data-yf-grid")) list.dataset.yfGrid = "";
      state.marked.add(list);
      for (const child of children) {
        if (child.matches(CARD_SELECTOR)) delete child.dataset.yfWide;
        else child.dataset.yfWide = "";
        state.marked.add(child);
      }
    }
  }

  function sizeSidebar(state) {
    const height = state.watch.querySelector("#movie_player")?.getBoundingClientRect().height ||
      state.primary.getBoundingClientRect().height;
    if (height > 0) {
      const value = `${Math.round(height)}px`;
      if (state.watch.style.getPropertyValue("--yf-player-height") !== value) {
        state.watch.style.setProperty("--yf-player-height", value);
      }
    }
  }

  function setComments(open, focus = false) {
    if (!layout) return false;
    layout.commentsOpen = open;
    layout.commentsPanel.hidden = !open;
    layout.toggle.setAttribute("aria-expanded", String(open));
    layout.toggle.textContent = open ? "Close comments" : "Open comments";
    if (layout.commentsHost) {
      layout.commentsHost.setAttribute("visibility", open ? "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" : "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
    }
    if (focus) {
      layout.toggle.scrollIntoView({ block: "nearest", behavior: "instant" });
      layout.toggle.focus({ preventScroll: true });
    }
    if (!open && layout.commentsPanel.contains(document.activeElement)) {
      layout.toggle.focus({ preventScroll: true });
    }
    return true;
  }

  function reconcile() {
    pending = null;
    if (!ready || !settings.enabled || navigating || !watchPage()) {
      teardown();
      return;
    }
    const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
    if (layout && (layout.watch !== watch || !layout.columns.isConnected ||
        !layout.details.isConnected || !layout.title.isConnected ||
        !layout.recommendations.isConnected)) teardown();
    if (!watch) return;
    if (!layout) layout = createLayout(watch);
    if (!layout) return;
    const state = layout;
    const videoId = new URLSearchParams(location.search).get("v");
    if (state.videoId !== videoId) {
      state.videoId = videoId;
      setComments(false);
      state.commentsPanel.scrollTop = 0;
      const body = state.commentsHost?.querySelector(":scope > #content");
      if (body) body.scrollTop = 0;
    }
    state.watch.dataset.yfCardSize = settings.cardSize;

    const below = watch.querySelector("#below");
    if (below && !state.details.contains(below)) moveNative(state, below, state.details, state.toggle);
    // Some watch-page experiments put the title/metadata in a separate #above block.
    const above = state.primary.querySelector("#above");
    if (above && above.querySelector("ytd-watch-metadata, h1")) {
      moveNative(state, above, state.details, state.details.firstChild);
    }
    // The video name moves below the player, above the recommendation grid.
    const metadata = below?.querySelector("ytd-watch-metadata") ||
      state.details.querySelector("ytd-watch-metadata") || watch.querySelector("ytd-watch-metadata");
    const title = metadata && findVideoTitle(metadata);
    if (title && !state.title.contains(title)) {
      // A replaced metadata block can leave a stale title behind.
      if (state.title.firstChild) state.title.replaceChildren();
      moveNative(state, title, state.title);
    }
    const related = watch.querySelector("#related") ||
      watch.querySelector("ytd-watch-next-secondary-results-renderer");
    if (related) {
      moveNative(state, related, state.recommendations);
      state.recommendations.hidden = false;
      markRecommendationGrids(state, related);
    }
    // Current watch layouts keep an empty disabled #comments placeholder and
    // render the usable comments component in an engagement panel instead.
    const nativeCommentsPanel = watch.querySelector("ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-comments-section']");
    if (nativeCommentsPanel) {
      state.commentsPanel.tabIndex = -1;
      // Keep the panel header, sorting controls and comments together. Its native
      // visibility attribute triggers YouTube's on-demand comments loading.
      if (state.commentsHost !== nativeCommentsPanel) {
        state.commentsObserver.disconnect();
        state.commentsHost = nativeCommentsPanel;
        state.nativeVisibility.set(nativeCommentsPanel, nativeCommentsPanel.getAttribute("visibility"));
        moveNative(state, nativeCommentsPanel, state.commentsPanel);
        nativeCommentsPanel.setAttribute("visibility", state.commentsOpen ? "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" : "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
        state.commentsObserver.observe(nativeCommentsPanel, { attributes: true, attributeFilter: ["visibility"] });
      }
      if (!state.commentsPanel.contains(nativeCommentsPanel)) moveNative(state, nativeCommentsPanel, state.commentsPanel);
      const body = nativeCommentsPanel.querySelector(":scope > #content");
      if (body && !state.nativeBodyAttributes.has(body)) {
        state.nativeBodyAttributes.set(body, {
          tabindex: body.getAttribute("tabindex"),
          role: body.getAttribute("role"),
          "aria-label": body.getAttribute("aria-label")
        });
        body.tabIndex = 0;
        body.setAttribute("role", "region");
        body.setAttribute("aria-label", "Comment thread");
      }
    } else {
      state.commentsPanel.tabIndex = 0;
      state.commentsHost = null;
      state.commentsObserver.disconnect();
    }
    const comments = watch.querySelector("ytd-comments:not([disable-upgrade]):not([hidden])") ||
      watch.querySelector("ytd-comments:not([disable-upgrade])");
    if (comments && !nativeCommentsPanel) moveNative(state, comments, state.commentsPanel);
    state.commentsStatus.hidden = Boolean(comments?.querySelector("ytd-comments-header-renderer, ytd-comment-thread-renderer, ytd-message-renderer, #comment-entry"));
    sizeSidebar(state);
  }

  // YouTube keeps its document alive during navigation. Watch for replacement
  // watch roots as well as mutations inside the active root, without polling.
  let lastUrl = location.href;
  const pageObserver = new MutationObserver(() => {
    const urlChanged = location.href !== lastUrl;
    lastUrl = location.href;
    if (urlChanged || !layout || !layout.watch.isConnected) schedule();
  });
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("yt-navigate-start", () => { navigating = true; teardown(); });
  document.addEventListener("yt-navigate-finish", () => { navigating = false; schedule(); });
  document.addEventListener("yt-page-data-updated", schedule);
  window.addEventListener("popstate", schedule);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && layout?.commentsOpen &&
        (layout.commentsPanel.contains(event.target) || event.target === layout.toggle)) {
      setComments(false);
      layout.toggle.focus({ preventScroll: true });
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      settings = normalizeSettings(changes[STORAGE_KEY].newValue);
      schedule();
    }
  });
  browser.runtime.onMessage.addListener(message => {
    if (message?.type === "youtube-focus:get-status") {
      return Promise.resolve({ active: Boolean(layout), commentsOpen: layout?.commentsOpen || false });
    }
    if (message?.type === "youtube-focus:open-comments") {
      if (!layout) return Promise.resolve({ ok: false, message: "Enable the focus layout on a loaded YouTube video first." });
      setComments(true, true);
      return Promise.resolve({ ok: true });
    }
    return undefined;
  });
  browser.storage.local.get(STORAGE_KEY).then(stored => {
    settings = normalizeSettings(stored[STORAGE_KEY]);
  }).catch(error => {
    console.warn("YouTube Focus could not read settings; using defaults.", error);
  }).finally(() => { ready = true; schedule(); });
})();

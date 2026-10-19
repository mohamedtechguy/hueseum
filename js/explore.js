/* =====================================================================
   Hueseum: Explore page
   - Keeps the colour picker, hex field and pigment presets in sync
   - Re-tints the site live as the colour changes
   - Validates the search form and calls the AIC search API with it
   - Renders results as paint-chip cards, sorts them, loads more pages
   - Suggests neighbouring colours (The Color API)
   - Opens a detail dialog with the full record and an artist biography
   ===================================================================== */
(function () {
  "use strict";

  const H = window.Hueseum;
  const { colour, api, el, forms } = H;

  const state = {
    query: null,        // the last valid search options
    works: [],          // all works loaded for that search
    page: 1,
    totalPages: 1,
    total: 0,
    iiif: undefined,
    controller: null,   // AbortController for the request in flight
    colourName: "",
    opener: null        // element to return focus to when the dialog closes
  };

  // Elements
  const form = document.getElementById("search-form");
  const picker = document.getElementById("colour-picker");
  const hexInput = document.getElementById("colour-hex");
  const presetsBox = document.getElementById("pigment-presets");
  const tolerance = document.getElementById("tolerance");
  const toleranceOut = document.getElementById("tolerance-output");
  const yearFrom = document.getElementById("year-from");
  const yearTo = document.getElementById("year-to");
  const pickedName = document.querySelector("[data-picked-name]");
  const pickedSwatch = document.querySelector("[data-picked-swatch]");
  const grid = document.getElementById("results-grid");
  const status = document.getElementById("results-status");
  const loadMore = document.getElementById("load-more");
  const neighbours = document.getElementById("neighbours");
  const dialog = document.getElementById("artwork-dialog");
  const dialogBody = document.getElementById("dialog-body");

  /* ---------- Colour controls ---------- */

  function buildPresets() {
    H.pigments.forEach((pigment, index) => {
      const id = "preset-" + index;
      const swatch = el("span", { className: "preset__swatch", "aria-hidden": "true" });
      swatch.style.setProperty("--chip", pigment.hex);
      presetsBox.append(
        el("label", { className: "preset", for: id }, [
          el("input", { type: "radio", name: "preset", id, value: pigment.hex, dataset: { name: pigment.name } }),
          swatch,
          el("span", { text: pigment.name })
        ])
      );
    });
  }

  const lookUpName = H.debounce(async (hex) => {
    try {
      const name = await api.colourName(hex);
      // Only update if the colour hasn't changed while we waited
      if (colour.normalise(hexInput.value) === hex && !checkedPreset()) {
        setName(name);
      }
    } catch (err) {
      setName(hex);
    }
  }, 350);

  function checkedPreset() {
    return presetsBox.querySelector("input:checked");
  }

  function setName(name) {
    state.colourName = name;
    pickedName.textContent = name;
  }

  /** Single place that updates every colour control and the site tint. */
  function setColour(hex, source) {
    const clean = colour.normalise(hex);
    if (!clean) return;
    if (source !== "picker") picker.value = clean.toLowerCase();
    if (source !== "hex") hexInput.value = clean;
    pickedSwatch.style.background = clean;
    forms.clearError(hexInput);
    H.applyPick(clean, false);

    // Tick the matching pigment, or clear the presets if it's a custom colour
    let matched = null;
    presetsBox.querySelectorAll("input").forEach((radio) => {
      const isMatch = radio.value === clean;
      radio.checked = isMatch;
      if (isMatch) matched = radio;
    });

    if (matched) setName(matched.dataset.name);
    else {
      pickedName.textContent = "Looking up…";
      lookUpName(clean);
    }
  }

  picker.addEventListener("input", () => setColour(picker.value, "picker"));

  hexInput.addEventListener("input", () => {
    const clean = colour.normalise(hexInput.value);
    if (clean && hexInput.value.replace("#", "").length === 6) setColour(clean, "hex");
  });

  hexInput.addEventListener("blur", () => {
    if (!colour.normalise(hexInput.value)) {
      forms.showError(hexInput, "Enter a six-character hex code, such as #D9381E.");
    } else {
      hexInput.value = colour.normalise(hexInput.value);
    }
  });

  presetsBox.addEventListener("change", (event) => {
    if (event.target.name === "preset") setColour(event.target.value, "preset");
  });

  tolerance.addEventListener("input", () => {
    toleranceOut.textContent = "±" + tolerance.value + "°";
  });

  [yearFrom, yearTo].forEach((input) => {
    input.addEventListener("input", () => {
      forms.clearError(yearFrom);
      yearTo.removeAttribute("aria-invalid");
    });
  });

  /* ---------- Validation ---------- */

  function readYear(input) {
    const raw = input.value.trim();
    if (raw === "") return { ok: true, value: undefined };
    const n = Number(raw);
    if (!Number.isInteger(n)) return { ok: false, message: "Enter a whole year, such as 1850." };
    if (n < -3000 || n > 2026) return { ok: false, message: "Enter a year between -3000 and 2026." };
    return { ok: true, value: n };
  }

  /** Returns search options, or null after showing errors next to the fields. */
  function validate() {
    let firstInvalid = null;

    const hex = colour.normalise(hexInput.value);
    if (!hex) {
      forms.showError(hexInput, "Enter a six-character hex code, such as #D9381E.");
      firstInvalid = hexInput;
    }

    const from = readYear(yearFrom);
    const to = readYear(yearTo);
    forms.clearError(yearFrom);
    yearTo.removeAttribute("aria-invalid");
    if (!from.ok || !to.ok) {
      const bad = !from.ok ? yearFrom : yearTo;
      forms.showError(yearFrom, (!from.ok ? from : to).message);
      if (bad === yearTo) {
        yearFrom.removeAttribute("aria-invalid");
        yearTo.setAttribute("aria-invalid", "true");
      }
      firstInvalid = firstInvalid || bad;
    } else if (from.value !== undefined && to.value !== undefined && from.value > to.value) {
      forms.showError(yearFrom, "The first year must be earlier than the second.");
      yearTo.setAttribute("aria-invalid", "true");
      firstInvalid = firstInvalid || yearFrom;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return null;
    }

    const data = new FormData(form);
    return {
      hex,
      tolerance: Number(data.get("tolerance")),
      matchTone: data.get("matchTone") === "on",
      q: (data.get("q") || "").toString().trim(),
      from: from.value,
      to: to.value,
      types: data.getAll("type"),
      publicDomain: data.get("publicDomain") === "on",
      limit: Number(data.get("limit")) || 12,
      page: 1
    };
  }

  /* ---------- Rendering results ---------- */

  function currentSort() {
    const checked = form.querySelector('input[name="sort"]:checked');
    return checked ? checked.value : "match";
  }

  function sortWorks(works) {
    const sorted = works.slice();
    switch (currentSort()) {
      case "oldest":
        return sorted.sort((a, b) => (a.date_start ?? 9999) - (b.date_start ?? 9999));
      case "newest":
        return sorted.sort((a, b) => (b.date_start ?? -9999) - (a.date_start ?? -9999));
      case "relevance":
        return sorted.sort((a, b) => a.page - b.page || a.relevance - b.relevance);
      default:
        return sorted.sort((a, b) => b.score - a.score);
    }
  }

  function artHex(work) {
    return work.color ? colour.hslToHex(work.color) : "#9AA1AB";
  }

  function makeCard(work, index) {
    const art = artHex(work);
    const img = el("img", {
      src: api.imageUrl(work.image_id, 400, state.iiif),
      alt: (work.thumbnail && work.thumbnail.alt_text) || "",
      loading: "lazy",
      width: "400",
      height: "500"
    });
    img.addEventListener("load", () => img.classList.add("is-loaded"));
    img.addEventListener("error", () => img.remove());

    const button = el("button", {
      type: "button",
      className: "art-card",
      "aria-haspopup": "dialog",
      dataset: { match: colour.matchBand(work.score), id: work.id }
    }, [
      el("span", { className: "art-card__image" }, [img]),
      el("span", { className: "art-card__chip" }, [
        el("span", { className: "art-card__title", text: work.title }),
        el("span", { className: "art-card__meta", text: [work.artist_title || "Unknown artist", work.date_display].filter(Boolean).join(", ") }),
        el("span", { className: "art-card__hsl" }, [
          el("span", { text: art + (work.color ? "  H" + work.color.h + " S" + work.color.s + " L" + work.color.l : "") }),
          el("span", { className: "match", text: work.score + "% match" })
        ])
      ])
    ]);
    button.style.setProperty("--art", art);
    button.style.setProperty("--art-ink", colour.inkFor(art));
    button.addEventListener("click", () => openDetail(work, button));

    const item = el("li", null, [button]);
    item.style.setProperty("--i", index % 12);
    return item;
  }

  function renderResults() {
    const works = sortWorks(state.works);
    if (!works.length) {
      grid.replaceChildren(
        el("li", { className: "empty-results" }, [
          el("h3", { text: "No works in this colour yet" }),
          el("p", { text: "Try a looser hue tolerance, turn off \"Match tone\", clear the year range, or tick more types of work." })
        ])
      );
      return;
    }
    grid.replaceChildren(...works.map(makeCard));
  }

  function showSkeletons(count) {
    const skeletons = [];
    for (let i = 0; i < count; i += 1) {
      skeletons.push(el("li", { "aria-hidden": "true" }, [el("div", { className: "art-card art-card--skeleton" })]));
    }
    grid.replaceChildren(...skeletons);
  }

  function describeSearch(q) {
    const parts = [];
    const name = state.colourName && state.colourName !== q.hex ? state.colourName + " " : "";
    parts.push("works near " + name + "(" + q.hex + ")");
    if (q.q) parts.push("ranked by “" + q.q + "”");
    return parts.join(", ");
  }

  function updateStatus() {
    const q = state.query;
    const shown = state.works.length;
    status.classList.remove("status--error");
    if (!shown) {
      status.textContent = "No " + describeSearch(q) + " were found.";
      return;
    }
    status.replaceChildren(
      "Showing ",
      el("strong", { text: H.formatNumber(shown) }),
      " of " + H.formatNumber(state.total) + " " + describeSearch(q) + "."
    );
  }

  function updateLoadMore() {
    const q = state.query;
    const more = state.page < state.totalPages && state.page * q.limit < 1000;
    loadMore.hidden = !more;
    loadMore.disabled = false;
    loadMore.textContent = "Show " + q.limit + " more works";
  }

  /* ---------- Searching ---------- */

  async function runSearch(options, append) {
    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    state.controller = controller;

    if (!append) {
      state.query = options;
      state.works = [];
      showSkeletons(options.limit);
      neighbours.hidden = true;
      H.applyPick(options.hex, true);
      syncUrl(options);
    } else {
      loadMore.disabled = true;
      loadMore.textContent = "Loading…";
    }

    grid.setAttribute("aria-busy", "true");
    status.classList.remove("status--error");
    status.textContent = "Searching the collection for " + describeSearch(options) + "…";

    try {
      const result = await api.searchByColour(options, controller.signal);
      result.works.forEach((w) => { w.page = options.page; });
      state.works = append ? state.works.concat(result.works) : result.works;
      state.page = result.page;
      state.totalPages = result.totalPages;
      state.total = result.total;
      state.iiif = result.iiif;

      renderResults();
      updateStatus();
      updateLoadMore();
      if (!append) loadNeighbours(options.hex);
    } catch (err) {
      if (controller.signal.aborted) return; // replaced by a newer search
      grid.replaceChildren();
      loadMore.hidden = true;
      status.classList.add("status--error");
      const retry = el("button", { type: "button", className: "button button--ghost button--small", text: "Try again" });
      retry.addEventListener("click", () => runSearch(options, append));
      status.replaceChildren(el("span", { text: err.message + " " }), retry);
    } finally {
      if (state.controller === controller) grid.setAttribute("aria-busy", "false");
    }
  }

  async function loadNeighbours(hex) {
    try {
      const list = await api.colourNeighbours(hex);
      if (!list.length || colour.normalise(hexInput.value) !== hex) return;
      const ul = neighbours.querySelector("ul");
      ul.replaceChildren(...list.map((c) => {
        const sw = el("span", { className: "chip__swatch", "aria-hidden": "true" });
        sw.style.setProperty("--chip", c.hex);
        const btn = el("button", { type: "button" }, [sw, el("span", { text: (c.name || c.hex) + " " }), el("code", { text: c.hex })]);
        btn.setAttribute("aria-label", "Search " + (c.name || "") + " " + c.hex);
        btn.addEventListener("click", () => {
          setColour(c.hex, "neighbour");
          if (c.name) setName(c.name);
          form.requestSubmit();
        });
        return el("li", null, [btn]);
      }));
      neighbours.hidden = false;
    } catch (err) {
      neighbours.hidden = true; // suggestions are optional
    }
  }

  function syncUrl(options) {
    const params = new URLSearchParams();
    params.set("hex", options.hex.slice(1));
    if (options.q) params.set("q", options.q);
    try {
      history.replaceState(null, "", "?" + params.toString());
    } catch (err) {
      /* some file:// contexts block this; not important */
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const options = validate();
    if (options) runSearch(options, false);
  });

  form.addEventListener("reset", () => {
    // Let the browser restore default values first, then sync the custom UI
    setTimeout(() => {
      [hexInput, yearFrom, yearTo].forEach(forms.clearError);
      yearTo.removeAttribute("aria-invalid");
      toleranceOut.textContent = "±" + tolerance.value + "°";
      setColour(hexInput.value, "reset");
    }, 0);
  });

  form.addEventListener("change", (event) => {
    if (event.target.name === "sort" && state.works.length) renderResults();
  });

  loadMore.addEventListener("click", () => {
    if (!state.query) return;
    runSearch(Object.assign({}, state.query, { page: state.page + 1 }), true);
  });

  /* ---------- Detail dialog ---------- */

  function hangButtonLabel(id) {
    return H.exhibition.has(id) ? "Remove from my exhibition" : "Hang in my exhibition";
  }

  function tombstoneRows(work) {
    const rows = [
      ["Artist", work.artist_display || work.artist_title],
      ["Date", work.date_display],
      ["Medium", work.medium_display],
      ["Size", work.dimensions],
      ["Made in", work.place_of_origin],
      ["Type", work.artwork_type_title],
      ["Department", work.department_title],
      ["On view", work.is_on_view ? (work.gallery_title || "Yes") : "Not currently on display"],
      ["Rights", work.is_public_domain ? "Public domain (CC0)" : "In copyright, shown for study"],
      ["Credit", work.credit_line]
    ];
    const dl = el("dl", { className: "tombstone" });
    rows.forEach(([label, value]) => {
      if (!value) return;
      dl.append(el("dt", { text: label }), el("dd", { text: value }));
    });
    return dl;
  }

  /** The museum's descriptions contain HTML. Keep only the text, paragraph by paragraph. */
  function descriptionParagraphs(html) {
    if (!html) return [];
    const doc = new DOMParser().parseFromString(html, "text/html");
    const blocks = Array.from(doc.querySelectorAll("p"));
    const texts = blocks.length ? blocks.map((p) => p.textContent) : [doc.body.textContent];
    return texts.map((t) => t.trim()).filter(Boolean).map((t) => el("p", { text: t }));
  }

  async function openDetail(work, opener) {
    state.opener = opener || null;
    const art = artHex(work);

    const img = el("img", {
      src: api.imageUrl(work.image_id, 843, state.iiif),
      alt: (work.thumbnail && work.thumbnail.alt_text) || "Image of " + work.title,
      width: "843"
    });
    const figure = el("figure", { className: "detail__image" }, [img]);
    figure.style.setProperty("--art", art);

    const swatch = el("span", { className: "chip__swatch", "aria-hidden": "true" });
    swatch.style.setProperty("--chip", art);
    const colourNameEl = el("span", { text: "Dominant colour" });
    const colourChip = el("span", { className: "chip" }, [swatch, colourNameEl, el("code", { text: art })]);

    const hangStatus = el("p", { className: "status status--success", role: "status" });
    const hangBtn = el("button", { type: "button", className: "button button--primary", text: hangButtonLabel(work.id) });
    const searchBtn = el("button", { type: "button", className: "button button--ghost", text: "Search this colour" });
    const museumLink = el("a", { href: "https://www.artic.edu/artworks/" + work.id, text: "View on the museum's website" });

    const tombstoneSlot = el("div", null, [el("p", { className: "status", text: "Loading the full label…" })]);
    const descSlot = el("div", { className: "detail__description" });
    const bioSlot = el("div");

    const text = el("div", { className: "detail__text" }, [
      el("p", { className: "eyebrow", text: work.artwork_type_title || "Artwork" }),
      el("h2", { id: "dialog-title", text: work.title }),
      el("p", { className: "detail__artist", text: [work.artist_title || "Unknown artist", work.date_display].filter(Boolean).join(", ") }),
      el("p", null, [colourChip]),
      el("div", { className: "detail__actions" }, [hangBtn, searchBtn]),
      hangStatus,
      tombstoneSlot,
      descSlot,
      bioSlot,
      el("p", null, [museumLink])
    ]);

    dialogBody.replaceChildren(figure, text);
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("[data-close-dialog]").focus();

    hangBtn.addEventListener("click", () => {
      if (H.exhibition.has(work.id)) {
        H.exhibition.remove(work.id);
        hangStatus.textContent = "Removed from your exhibition.";
      } else {
        const result = H.exhibition.add(work);
        if (result === "full") {
          hangStatus.classList.replace("status--success", "status--error");
          hangStatus.textContent = "Your exhibition is full (" + H.exhibition.max + " works). Remove one to make space.";
          return;
        }
        hangStatus.classList.replace("status--error", "status--success");
        hangStatus.textContent = "Hung in your exhibition. You now have " + H.exhibition.list().length + " of " + H.exhibition.max + " works.";
      }
      hangBtn.textContent = hangButtonLabel(work.id);
    });

    searchBtn.addEventListener("click", () => {
      dialog.close();
      setColour(art, "artwork");
      form.requestSubmit();
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Fetch the full record, then the colour's name and the artist biography
    api.colourName(art).then((name) => { colourNameEl.textContent = name; }).catch(() => {});

    try {
      const { work: full } = await api.getArtwork(work.id);
      Object.assign(work, full);
      tombstoneSlot.replaceChildren(tombstoneRows(full));
      descSlot.replaceChildren(...descriptionParagraphs(full.description || full.short_description));
    } catch (err) {
      tombstoneSlot.replaceChildren(el("p", { className: "status status--error", text: err.message }));
    }

    const bio = await api.artistSummary(work.artist_title);
    if (bio && dialog.open) {
      const children = [];
      if (bio.image) children.push(el("img", { src: bio.image, alt: "", width: "64", height: "64" }));
      const textBlock = el("div", null, [
        el("h3", { text: "About " + bio.title }),
        el("p", { text: bio.extract })
      ]);
      if (bio.url) textBlock.append(el("p", null, [el("a", { href: bio.url, text: "Read more on Wikipedia" })]));
      children.push(textBlock);
      const aside = el("aside", { className: "artist-bio", "aria-label": "Artist biography" }, children);
      if (!bio.image) aside.style.gridTemplateColumns = "1fr";
      bioSlot.replaceChildren(aside);
    }
  }

  async function openById(id) {
    try {
      const { work, iiif } = await api.getArtwork(id);
      if (!work || !work.image_id) return;
      state.iiif = state.iiif || iiif;
      const target = colour.hexToHsl(colour.normalise(hexInput.value) || "#2A3FC0");
      work.score = colour.matchScore(target, work.color);
      openDetail(work, null);
    } catch (err) {
      /* if the shared work can't load, the results are still shown */
    }
  }

  dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());

  // Clicking the dark backdrop (outside the content) closes the dialog
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener("close", () => {
    if (state.opener && document.body.contains(state.opener)) state.opener.focus();
  });

  /* ---------- Start-up ---------- */

  document.addEventListener("DOMContentLoaded", () => {
    buildPresets();
    const params = new URLSearchParams(window.location.search);
    const fromUrl = colour.normalise(params.get("hex") || "");
    const start = fromUrl || H.savedPick() || "#2A3FC0";

    if (params.get("q")) document.getElementById("keywords").value = params.get("q").slice(0, 60);
    setColour(start, "start");
    if (params.get("name") && !checkedPreset()) setName(params.get("name").slice(0, 40));

    // Open the page in a working state: run the search straight away
    const options = validate();
    if (options) runSearch(options, false);

    const openId = params.get("open");
    if (openId && /^\d+$/.test(openId)) openById(openId);
  });
})();

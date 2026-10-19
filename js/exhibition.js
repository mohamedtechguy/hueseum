/* =====================================================================
   Hueseum: My exhibition page
   - Hangs saved works in a framed "gallery room"
   - Reorder and remove works; palette strip from their colours
   - Exhibition details form: live title, character counter, wall paint
   - Visit planner form: validated with an error summary, then checks
     live which works are on view (AIC API) and builds a route card
   ===================================================================== */
(function () {
  "use strict";

  const H = window.Hueseum;
  const { colour, api, el, forms } = H;

  const room = document.getElementById("gallery-room");
  const hung = document.getElementById("hung-works");
  const empty = document.getElementById("empty-state");
  const palette = document.getElementById("palette-strip");
  const showTitle = document.querySelector("[data-show-title]");

  const detailsForm = document.getElementById("details-form");
  const titleInput = document.getElementById("show-title");
  const curatorInput = document.getElementById("curator");
  const statementInput = document.getElementById("statement");
  const customWallField = document.getElementById("custom-wall-field");
  const customWall = document.getElementById("custom-wall");
  const detailsStatus = document.getElementById("details-status");

  const visitForm = document.getElementById("visit-form");
  const errorSummary = document.getElementById("visit-errors");
  const cardWrap = document.getElementById("route-card-wrap");
  const card = document.getElementById("route-card");

  const workHex = (w) => (w.color ? colour.hslToHex(w.color) : "#9AA1AB");

  /* ---------- The gallery room ---------- */

  function renderRoom(focusAfter) {
    const works = H.exhibition.list();
    empty.hidden = works.length > 0;

    palette.replaceChildren(...works.map((w) => {
      const li = el("li", { title: workHex(w) }, [el("span", { className: "visually-hidden", text: w.title + ", " + workHex(w) })]);
      li.style.setProperty("--chip", workHex(w));
      return li;
    }));

    hung.replaceChildren(...works.map((w, index) => {
      const img = el("img", {
        src: api.imageUrl(w.image_id, 600),
        alt: w.alt || "Image of " + w.title,
        loading: "lazy",
        width: "600"
      });
      img.style.setProperty("--art", workHex(w));

      const controls = el("div", { className: "wall-label__controls" }, [
        el("button", { type: "button", dataset: { action: "left", id: w.id }, "aria-label": "Move " + w.title + " earlier", text: "← Earlier", disabled: index === 0 }),
        el("button", { type: "button", dataset: { action: "right", id: w.id }, "aria-label": "Move " + w.title + " later", text: "Later →", disabled: index === works.length - 1 }),
        el("button", { type: "button", dataset: { action: "remove", id: w.id }, "aria-label": "Remove " + w.title, text: "Remove" })
      ]);

      return el("li", { className: "hung-work" }, [
        el("figure", { className: "hung-work__frame" }, [img]),
        el("div", { className: "wall-label" }, [
          el("span", { className: "wall-label__title", text: w.title }),
          el("span", { text: [w.artist, w.date].filter(Boolean).join(", ") }),
          el("code", { text: workHex(w) }),
          controls
        ])
      ]);
    }));

    if (focusAfter) {
      const target = hung.querySelector('button[data-id="' + focusAfter.id + '"][data-action="' + focusAfter.action + '"]:not([disabled])') ||
        hung.querySelector('button[data-id="' + focusAfter.id + '"]') ||
        hung.querySelector("button") ||
        document.querySelector("#empty-state a");
      if (target) target.focus();
    }
  }

  // One listener handles every reorder and remove button (event delegation)
  hung.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const action = button.dataset.action;
    if (action === "left") H.exhibition.move(id, -1);
    if (action === "right") H.exhibition.move(id, 1);
    if (action === "remove") H.exhibition.remove(id);
    renderRoom(action === "remove" ? { id: -1, action } : { id, action });
  });

  /* ---------- Wall paint ---------- */

  function selectedWall() {
    const checked = detailsForm.querySelector('input[name="wall"]:checked');
    if (!checked) return null;
    return checked.value === "custom" ? colour.normalise(customWall.value) : checked.value;
  }

  function paintWalls() {
    const isCustom = detailsForm.querySelector('input[name="wall"]:checked')?.value === "custom";
    customWallField.hidden = !isCustom;
    const wall = selectedWall();
    if (!wall) return;
    room.style.setProperty("--room-wall", wall);
    room.style.setProperty("--room-ink", colour.inkFor(wall));
  }

  /* ---------- Exhibition details form ---------- */

  function loadDetails() {
    const d = H.exhibition.details();
    titleInput.value = d.title;
    curatorInput.value = d.curator;
    statementInput.value = d.statement;
    customWall.value = (colour.normalise(d.customWall) || "#C8B89A").toLowerCase();
    const radio = detailsForm.querySelector('input[name="wall"][value="' + d.wall + '"]') ||
      detailsForm.querySelector('input[name="wall"][value="#EDEFF1"]');
    radio.checked = true;
    showTitle.textContent = d.title || "Untitled exhibition";
    paintWalls();
  }

  titleInput.addEventListener("input", () => {
    showTitle.textContent = titleInput.value.trim() || "Untitled exhibition";
    if (titleInput.value.trim()) forms.clearError(titleInput);
  });

  detailsForm.addEventListener("change", (event) => {
    if (event.target.name === "wall" || event.target === customWall) paintWalls();
  });
  customWall.addEventListener("input", paintWalls);

  forms.attachCounter(statementInput, document.getElementById("statement-count"));

  detailsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      forms.showError(titleInput, "Give your exhibition a title.");
      titleInput.focus();
      return;
    }
    const checked = detailsForm.querySelector('input[name="wall"]:checked');
    H.exhibition.saveDetails({
      title,
      curator: curatorInput.value.trim(),
      statement: statementInput.value.trim(),
      wall: checked ? checked.value : "#EDEFF1",
      customWall: colour.normalise(customWall.value)
    });
    detailsStatus.className = "status status--success";
    detailsStatus.textContent = "Saved in this browser.";
  });

  /* ---------- Visit planner ---------- */

  function isoDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + 6);
  const dateInput = document.getElementById("visit-date");
  dateInput.min = isoDate(today);
  dateInput.max = isoDate(maxDate);

  /** Each rule returns an error message or "" when the field is fine. */
  const visitRules = {
    "visitor-name": (input) => {
      const v = input.value.trim();
      if (!v) return "Enter your name.";
      if (v.length < 2) return "Your name needs at least 2 characters.";
      if (!/^[\p{L}][\p{L}\s'.-]*$/u.test(v)) return "Use letters, spaces, hyphens or apostrophes only.";
      return "";
    },
    "visit-date": (input) => {
      if (!input.value) return "Choose the date of your visit.";
      if (input.value < input.min) return "Choose today or a later date.";
      if (input.value > input.max) return "Choose a date within the next 6 months.";
      return "";
    },
    arrival: (input) => (input.value ? "" : "Choose an arrival time."),
    "group-size": (input) => {
      const n = Number(input.value);
      if (!input.value) return "Enter how many people are coming.";
      if (!Number.isInteger(n) || n < 1 || n > 12) return "Enter a number from 1 to 12.";
      return "";
    },
    "visit-confirm": (input) => (input.checked ? "" : "Tick the box to confirm you understand this is not a ticket.")
  };

  // Validate each field when the visitor leaves it, and clear errors as they fix them
  Object.keys(visitRules).forEach((id) => {
    const input = document.getElementById(id);
    input.addEventListener("blur", () => {
      if (input.value || input.type === "checkbox") checkField(id);
    });
    input.addEventListener(input.tagName === "SELECT" || input.type === "checkbox" ? "change" : "input", () => {
      if (input.getAttribute("aria-invalid") === "true") checkField(id);
    });
  });

  function checkField(id) {
    const input = document.getElementById(id);
    const message = visitRules[id](input);
    if (message) forms.showError(input, message);
    else forms.clearError(input);
    return message;
  }

  function showSummary(problems) {
    const list = errorSummary.querySelector("ul");
    list.replaceChildren(...problems.map(({ id, message, href }) => {
      const link = el("a", { href: href || "#" + id, text: message });
      if (!href) {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          document.getElementById(id).focus();
        });
      }
      return el("li", null, [link]);
    }));
    errorSummary.hidden = false;
    errorSummary.focus();
  }

  visitForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const problems = [];
    Object.keys(visitRules).forEach((id) => {
      const message = checkField(id);
      if (message) problems.push({ id, message });
    });
    const works = H.exhibition.list();
    if (!works.length) {
      problems.unshift({ id: "explore", message: "Hang at least one work before planning a visit.", href: "explore.html" });
    }
    if (problems.length) {
      showSummary(problems);
      return;
    }
    errorSummary.hidden = true;

    const data = new FormData(visitForm);
    const plan = {
      name: data.get("name").toString().trim(),
      date: data.get("date").toString(),
      arrival: data.get("arrival").toString(),
      group: Number(data.get("group")),
      pace: Number(data.get("pace")),
      access: data.getAll("access"),
      notes: (data.get("notes") || "").toString().trim()
    };

    const submit = visitForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Checking the galleries…";

    let status = null;
    try {
      status = await api.getOnViewStatus(works.map((w) => w.id));
    } catch (err) {
      status = null; // build the card anyway, without gallery numbers
    }

    submit.disabled = false;
    submit.textContent = "Build my route card";
    renderCard(plan, works, status);
  });

  function galleryNumber(title) {
    const match = /(\d+)/.exec(title || "");
    return match ? Number(match[1]) : 9999;
  }

  function renderCard(plan, works, status) {
    const details = H.exhibition.details();
    const byId = new Map((status || []).map((s) => [s.id, s]));
    const rows = works.map((w) => Object.assign({}, w, byId.get(w.id) || {}, { title: w.title }));
    const onView = rows.filter((r) => r.is_on_view);
    const away = rows.filter((r) => !r.is_on_view);

    // Route: visit galleries in number order, which roughly follows the building's floors
    onView.sort((a, b) => galleryNumber(a.gallery_title) - galleryNumber(b.gallery_title));
    const galleries = new Set(onView.map((r) => r.gallery_title)).size;
    const minutes = onView.length * plan.pace + galleries * 4;

    const visitDate = new Date(plan.date + "T12:00:00");
    const dateText = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(visitDate);

    // Barcode: one stripe per work, its width set by the time you'll spend with it
    const barcode = el("div", { className: "route-card__barcode", "aria-hidden": "true" });
    rows.forEach((r) => {
      const stripe = el("span");
      stripe.style.setProperty("--chip", workHex(r));
      stripe.style.setProperty("--w", r.is_on_view ? plan.pace : 1);
      barcode.append(stripe);
    });

    const facts = el("dl", { className: "route-card__facts" });
    [
      ["Date", dateText],
      ["Arrive", plan.arrival],
      ["Group", plan.group === 1 ? "1 person" : plan.group + " people"],
      ["Time needed", status ? "About " + Math.max(minutes, 10) + " min" : "Unknown"]
    ].forEach(([dt, dd]) => facts.append(el("div", null, [el("dt", { text: dt }), el("dd", { text: dd })])));

    const body = el("div", { className: "route-card__body" }, [
      el("p", { className: "eyebrow", text: "Hueseum route card" }),
      el("h3", { className: "route-card__title", text: (details.title || "My exhibition") + " for " + plan.name }),
      facts
    ]);

    if (!status) {
      body.append(el("p", { className: "status status--error", text: "We couldn't check what's on display right now, so gallery numbers are missing. Try again later." }));
      body.append(routeList(rows, false));
    } else {
      if (onView.length) {
        body.append(el("h4", { text: "Your route (" + onView.length + " on display)" }), routeList(onView, true));
      } else {
        body.append(el("p", { text: "None of your works are on display at the moment. They may be on loan, in storage or being conserved." }));
      }
      if (away.length) {
        body.append(el("h4", { text: "Not on display right now" }), routeList(away, false));
      }
    }

    if (plan.access.length) {
      body.append(el("p", null, [el("strong", { text: "Access needs: " }), plan.access.join(", ") + ". Ask at the information desk on arrival."]));
    }
    if (plan.notes) {
      body.append(el("p", null, [el("strong", { text: "Notes: " }), plan.notes]));
    }
    body.append(el("p", { className: "route-card__note" }, [
      "This is a planning card made by Hueseum, not an admission ticket. Check opening times and buy tickets on the ",
      el("a", { href: "https://www.artic.edu/visit", text: "Art Institute of Chicago website" }),
      "."
    ]));

    card.replaceChildren(barcode, body);
    cardWrap.hidden = false;
    card.focus();
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function routeList(rows, onView) {
    return el("ol", { className: "route-list" }, rows.map((r) => el("li", null, [
      el("span", { text: r.title + " " }),
      el("span", { className: "tag " + (onView ? "tag--on" : "tag--off"), text: onView ? r.gallery_title || "On view" : "Not on view" })
    ])));
  }

  /* ---------- Start-up ---------- */

  document.addEventListener("DOMContentLoaded", () => {
    loadDetails();
    renderRoom();
  });

  // Keep the room in sync if the exhibition changes in another tab
  window.addEventListener("storage", (event) => {
    if (event.key === "hueseum.exhibition") renderRoom();
  });
})();

/* =====================================================================
   Hueseum: Home page
   - Builds the historic pigment chips (hovering one re-colours the hero)
   - "Colour of the day": a date-seeded colour, named by The Color API,
     with four matching paintings from the Art Institute of Chicago
   ===================================================================== */
(function () {
  "use strict";

  const H = window.Hueseum;
  const { colour, api, el } = H;

  function buildPigments() {
    const grid = document.getElementById("pigment-grid");
    const accent = document.querySelector(".hero__accent");
    if (!grid) return;

    H.pigments.forEach((pigment) => {
      const link = el("a", {
        className: "pigment-chip",
        href: "explore.html?hex=" + pigment.hex.slice(1) + "&name=" + encodeURIComponent(pigment.name)
      }, [
        el("span", { className: "pigment-chip__swatch", "aria-hidden": "true" }),
        el("span", { className: "pigment-chip__label" }, [
          el("span", { className: "pigment-chip__name", text: pigment.name }),
          el("span", { className: "pigment-chip__hex", text: pigment.hex }),
          el("span", { className: "pigment-chip__note", text: pigment.note })
        ])
      ]);
      link.style.setProperty("--chip", pigment.hex);

      // Hovering or focusing a pigment paints the hero's highlighted word
      const preview = () => {
        accent.style.setProperty("--hero-accent", pigment.hex);
        accent.style.setProperty("--hero-accent-ink", colour.inkFor(pigment.hex));
      };
      link.addEventListener("mouseenter", preview);
      link.addEventListener("focus", preview);

      grid.append(el("li", null, [link]));
    });

    // When the pointer leaves the grid, go back to the visitor's own colour
    grid.addEventListener("mouseleave", () => {
      accent.style.removeProperty("--hero-accent");
      accent.style.removeProperty("--hero-accent-ink");
    });
  }

  /** The same colour all day for everyone: hue steps round the wheel by the golden angle. */
  function colourOfTheDay(date) {
    const start = Date.UTC(date.getFullYear(), 0, 0);
    const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000);
    const hue = Math.round((day * 137.508) % 360);
    return colour.hslToHex({ h: hue, s: 55, l: 42 });
  }

  /** A home-page card links to the Explore page and opens that work. */
  function dailyCard(work, hex, iiif, index) {
    const art = work.color ? colour.hslToHex(work.color) : "#9AA1AB";
    const img = el("img", {
      src: api.imageUrl(work.image_id, 400, iiif),
      alt: (work.thumbnail && work.thumbnail.alt_text) || "",
      loading: "lazy",
      width: "400",
      height: "500"
    });
    img.addEventListener("load", () => img.classList.add("is-loaded"));

    const card = el("a", {
      className: "art-card",
      href: "explore.html?hex=" + hex.slice(1) + "&open=" + work.id,
      dataset: { match: colour.matchBand(work.score) }
    }, [
      el("span", { className: "art-card__image" }, [img]),
      el("span", { className: "art-card__chip" }, [
        el("span", { className: "art-card__title", text: work.title }),
        el("span", { className: "art-card__meta", text: [work.artist_title, work.date_display].filter(Boolean).join(", ") }),
        el("span", { className: "art-card__hsl" }, [
          el("span", { text: work.color ? "H" + work.color.h + " S" + work.color.s + " L" + work.color.l : "" }),
          el("span", { className: "match", text: work.score + "% match" })
        ])
      ])
    ]);
    card.style.setProperty("--art", art);
    card.style.setProperty("--art-ink", colour.inkFor(art));
    card.style.setProperty("--i", index);
    return card;
  }

  async function loadDaily() {
    const hex = colourOfTheDay(new Date());
    const grid = document.querySelector("[data-daily-grid]");
    const status = document.querySelector("[data-daily-status]");
    const nameEl = document.querySelector("[data-daily-name]");
    document.querySelector("[data-daily-hex]").textContent = hex;
    document.querySelector("[data-daily-swatch]").style.setProperty("--chip", hex);
    document.querySelector("[data-daily-link]").href = "explore.html?hex=" + hex.slice(1);

    // Name and artworks load in parallel; either can fail without breaking the other
    api.colourName(hex)
      .then((name) => { nameEl.textContent = name; })
      .catch(() => { nameEl.textContent = hex; });

    try {
      const result = await api.searchByColour({
        hex, tolerance: 10, matchTone: true, types: ["Painting"], limit: 12, page: 1
      });
      const best = result.works.sort((a, b) => b.score - a.score).slice(0, 4);
      grid.replaceChildren(...best.map((w, i) => dailyCard(w, hex, result.iiif, i)));
      if (!best.length) {
        status.textContent = "No paintings match today's shade closely. Try the Explore page for a wider search.";
      }
    } catch (err) {
      grid.replaceChildren();
      status.classList.add("status--error");
      status.textContent = err.message || "Today's works could not be loaded.";
    } finally {
      grid.setAttribute("aria-busy", "false");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    buildPigments();
    loadDaily();
  });
})();

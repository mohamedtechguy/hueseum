/* =====================================================================
   Hueseum: shared code used on every page
   - Colour maths (hex <-> RGB <-> HSL, contrast, match score)
   - The historic pigment list used on Home and Explore
   - Safe localStorage wrapper and the "My exhibition" store
   - Animated mobile menu
   - "Lights off" theme toggle
   - Small form helpers (show/clear errors, character counters)
   Everything is attached to one global object, window.Hueseum, so the
   page scripts can use it without ES modules (works from file:// too).
   ===================================================================== */
(function () {
  "use strict";

  const H = (window.Hueseum = window.Hueseum || {});

  /* ---------- Colour maths ---------- */
  const colour = {
    /** Turns "abc", "#AABBCC" or "aabbcc" into "#AABBCC". Returns null if invalid. */
    normalise(input) {
      if (typeof input !== "string") return null;
      let hex = input.trim().replace(/^#/, "");
      if (/^[0-9a-f]{3}$/i.test(hex)) {
        hex = hex.split("").map((c) => c + c).join("");
      }
      return /^[0-9a-f]{6}$/i.test(hex) ? "#" + hex.toUpperCase() : null;
    },

    hexToRgb(hex) {
      const n = parseInt(hex.replace("#", ""), 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    },

    rgbToHex({ r, g, b }) {
      return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
    },

    /** Returns hue 0-360, saturation and lightness 0-100 (same scale as the museum's data). */
    rgbToHsl({ r, g, b }) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h = 0;
      let s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
      }
      return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
    },

    hslToHex({ h, s, l }) {
      s /= 100; l /= 100;
      const k = (n) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return colour.rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
    },

    hexToHsl(hex) {
      return colour.rgbToHsl(colour.hexToRgb(hex));
    },

    /** WCAG relative luminance */
    luminance(hex) {
      const { r, g, b } = colour.hexToRgb(hex);
      const lin = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    },

    contrast(a, b) {
      const la = colour.luminance(a);
      const lb = colour.luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    },

    /** Picks near-black or white text, whichever reads better on the background. */
    inkFor(bgHex) {
      const dark = "#14161B";
      const light = "#FFFFFF";
      return colour.contrast(bgHex, dark) >= colour.contrast(bgHex, light) ? dark : light;
    },

    /** Shortest distance between two hues on the colour wheel (0-180). */
    hueDistance(a, b) {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    },

    /** Greys, near-blacks and near-whites have no meaningful hue. */
    isNeutral(hsl) {
      return hsl.s < 15 || hsl.l < 12 || hsl.l > 92;
    },

    /**
     * Match score out of 100 between the visitor's colour and an artwork's colour.
     * Hue counts 60%, saturation 20%, lightness 20%. Neutrals are compared on tone only.
     */
    matchScore(target, art) {
      if (!art || typeof art.h !== "number") return 0;
      const ds = Math.abs(target.s - art.s) / 100;
      const dl = Math.abs(target.l - art.l) / 100;
      let distance;
      if (colour.isNeutral(target)) {
        distance = 0.5 * ds + 0.5 * dl;
      } else {
        const dh = colour.hueDistance(target.h, art.h) / 180;
        distance = 0.6 * dh + 0.2 * ds + 0.2 * dl;
      }
      return Math.max(0, Math.round((1 - distance) * 100));
    },

    matchBand(score) {
      if (score >= 85) return "high";
      if (score >= 70) return "medium";
      return "low";
    }
  };
  H.colour = colour;

  /* ---------- Historic pigments (shared by Home and Explore) ---------- */
  H.pigments = [
    { name: "Vermilion", hex: "#D9381E", note: "Cinnabar, used by the Romans" },
    { name: "Madder Lake", hex: "#B5243F", note: "Madder root, ancient Egypt" },
    { name: "Burnt Sienna", hex: "#B5562A", note: "Roasted earth from Siena" },
    { name: "Lead-tin Yellow", hex: "#E6B422", note: "Old Masters, 1300s to 1700s" },
    { name: "Green Earth", hex: "#6F8F5E", note: "Under medieval skin tones" },
    { name: "Malachite", hex: "#3A9A5B", note: "Copper ore, ancient Egypt" },
    { name: "Verdigris", hex: "#3AA6A0", note: "Copper patina, ancient Greece" },
    { name: "Cerulean", hex: "#2A7AB0", note: "Cobalt blue, sold from 1860s" },
    { name: "Ultramarine", hex: "#2A3FC0", note: "Ground lapis lazuli" },
    { name: "Tyrian Purple", hex: "#8A1E5C", note: "Sea-snail dye, Phoenicia" },
    { name: "Lamp Black", hex: "#2B2B2B", note: "Soot, prehistoric caves" },
    { name: "Lead White", hex: "#EDEAE0", note: "Lead carbonate, antiquity" }
  ];

  /* ---------- Safe storage ---------- */
  // localStorage can throw (private mode, blocked storage), so every call is wrapped.
  const storage = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (err) {
        return false;
      }
    }
  };
  H.storage = storage;

  /* ---------- My exhibition store ---------- */
  const EXHIBITION_KEY = "hueseum.exhibition";
  const DETAILS_KEY = "hueseum.details";
  const MAX_WORKS = 12;

  const exhibition = {
    max: MAX_WORKS,
    list() {
      const items = storage.get(EXHIBITION_KEY, []);
      return Array.isArray(items) ? items : [];
    },
    save(items) {
      storage.set(EXHIBITION_KEY, items);
      updateCountBadges();
      document.dispatchEvent(new CustomEvent("hueseum:exhibition-changed"));
    },
    has(id) {
      return exhibition.list().some((w) => w.id === id);
    },
    /** Returns "added", "full" or "exists" */
    add(work) {
      const items = exhibition.list();
      if (items.some((w) => w.id === work.id)) return "exists";
      if (items.length >= MAX_WORKS) return "full";
      items.push({
        id: work.id,
        title: work.title,
        artist: work.artist_title || "Unknown artist",
        date: work.date_display || "",
        image_id: work.image_id,
        alt: (work.thumbnail && work.thumbnail.alt_text) || "",
        color: work.color || null
      });
      exhibition.save(items);
      return "added";
    },
    remove(id) {
      exhibition.save(exhibition.list().filter((w) => w.id !== id));
    },
    move(id, direction) {
      const items = exhibition.list();
      const from = items.findIndex((w) => w.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= items.length) return;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      exhibition.save(items);
    },
    details() {
      return Object.assign(
        { title: "", curator: "", statement: "", wall: "#EDEFF1", customWall: "#C8B89A" },
        storage.get(DETAILS_KEY, {})
      );
    },
    saveDetails(details) {
      storage.set(DETAILS_KEY, details);
    }
  };
  H.exhibition = exhibition;

  function updateCountBadges() {
    const count = exhibition.list().length;
    document.querySelectorAll("[data-exhibition-count]").forEach((badge) => {
      badge.textContent = count;
      badge.dataset.count = String(count);
    });
  }

  /* ---------- The visitor's colour re-tints the whole site ---------- */
  const PICK_KEY = "hueseum.pick";

  H.applyPick = function (hex, remember) {
    const clean = colour.normalise(hex);
    if (!clean) return;
    const root = document.documentElement;
    root.style.setProperty("--pick", clean);
    root.style.setProperty("--pick-ink", colour.inkFor(clean));
    if (remember) storage.set(PICK_KEY, clean);
  };

  H.savedPick = function () {
    return colour.normalise(storage.get(PICK_KEY, "")) || null;
  };

  /* ---------- Animated mobile menu ---------- */
  function initMenu() {
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;

    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
      toggle.querySelector(".menu-toggle__label").textContent = open ? "Close" : "Menu";
    };

    toggle.addEventListener("click", () => {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    // Escape closes the menu and returns focus to the button
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        toggle.focus();
      }
    });

    // Reset when the screen grows past the mobile breakpoint
    const desktop = window.matchMedia("(min-width: 48em)");
    desktop.addEventListener("change", (e) => {
      if (e.matches) setOpen(false);
    });
  }

  /* ---------- "Lights off" (dark mode) toggle ---------- */
  const THEME_KEY = "hueseum.theme";

  function initLights() {
    const root = document.documentElement;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    const saved = storage.get(THEME_KEY, null);
    if (saved === "dark" || saved === "light") root.dataset.theme = saved;

    const isDark = () =>
      root.dataset.theme ? root.dataset.theme === "dark" : systemDark.matches;

    const render = () => {
      const dark = isDark();
      document.querySelectorAll("[data-lights-toggle]").forEach((btn) => {
        // The label stays "Lights off"; aria-pressed tells assistive tech whether it is on
        btn.setAttribute("aria-pressed", String(dark));
        btn.title = dark ? "Dark mode is on. Press to turn the lights back on." : "Switch to dark mode";
      });
    };

    document.querySelectorAll("[data-lights-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = isDark() ? "light" : "dark";
        root.dataset.theme = next;
        storage.set(THEME_KEY, next);
        render();
      });
    });

    systemDark.addEventListener("change", render);
    render();
  }

  /* ---------- Form helpers ---------- */
  H.forms = {
    /** Shows a message under a field and marks it invalid for assistive technology. */
    showError(field, message) {
      const key = field.id || field.name;
      const slot = document.querySelector('[data-error-for="' + key + '"]');
      field.setAttribute("aria-invalid", "true");
      if (slot) slot.textContent = message;
    },
    clearError(field) {
      const key = field.id || field.name;
      const slot = document.querySelector('[data-error-for="' + key + '"]');
      field.removeAttribute("aria-invalid");
      if (slot) slot.textContent = "";
    },
    /** Live "N characters left" counter for a textarea with maxlength. */
    attachCounter(textarea, output) {
      const max = Number(textarea.getAttribute("maxlength")) || 0;
      const update = () => {
        const left = max - textarea.value.length;
        output.textContent = left === 1 ? "1 character left" : left + " characters left";
        output.classList.toggle("is-near-limit", left <= Math.max(10, max * 0.1));
      };
      textarea.addEventListener("input", update);
      update();
      return update;
    }
  };

  /* ---------- Small utilities ---------- */
  H.el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([key, value]) => {
        if (value === null || value === undefined || value === false) return;
        if (key === "text") node.textContent = value;
        else if (key === "className") node.className = value;
        else if (key === "dataset") Object.assign(node.dataset, value);
        else node.setAttribute(key, value === true ? "" : value);
      });
    }
    (children || []).forEach((child) => {
      if (child) node.append(child);
    });
    return node;
  };

  H.formatNumber = (n) => new Intl.NumberFormat("en-GB").format(n);

  H.debounce = function (fn, wait) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  /* ---------- Start-up ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    const pick = H.savedPick();
    if (pick) H.applyPick(pick, false);
    initMenu();
    initLights();
    updateCountBadges();
  });
})();

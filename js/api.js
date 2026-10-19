/* =====================================================================
   Hueseum: API layer
   All network calls live here so the page scripts stay readable.

   1. Art Institute of Chicago API (https://api.artic.edu/docs/)
      - /artworks/search   search by colour, era, type, keywords
      - /artworks/{id}     full details for one work
      - /artworks?ids=     live "on view" check for many works
      - IIIF image server  the pictures themselves
   2. The Color API (https://www.thecolorapi.com/docs)
      - /id                a human name for a colour
      - /scheme            neighbouring colours to try
   3. Wikipedia REST API (https://en.wikipedia.org/api/rest_v1/)
      - /page/summary      a short artist biography
   ===================================================================== */
(function () {
  "use strict";

  const H = (window.Hueseum = window.Hueseum || {});
  const { colour } = H;

  const AIC = "https://api.artic.edu/api/v1";
  const IIIF_DEFAULT = "https://www.artic.edu/iiif/2";
  const COLOR_API = "https://www.thecolorapi.com";
  const WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/";

  const CARD_FIELDS = [
    "id", "title", "artist_title", "date_display", "date_start", "image_id",
    "color", "thumbnail", "artwork_type_title", "is_public_domain"
  ].join(",");

  const DETAIL_FIELDS = [
    "id", "title", "artist_title", "artist_display", "date_display", "date_start",
    "medium_display", "dimensions", "place_of_origin", "description", "short_description",
    "credit_line", "department_title", "artwork_type_title", "image_id", "thumbnail",
    "color", "is_on_view", "gallery_title", "is_public_domain"
  ].join(",");

  /** A friendly error that the pages can show directly to visitors. */
  class ApiError extends Error {
    constructor(message, cause) {
      super(message);
      this.name = "ApiError";
      this.cause = cause;
    }
  }

  /**
   * fetch() with a timeout, JSON parsing and readable error messages.
   * An external AbortSignal can also cancel the request (e.g. a newer search).
   */
  async function getJSON(url, { signal, timeout = 12000, service = "the service" } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeout);
    const onAbort = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new ApiError(service + " answered with an error (" + response.status + ").");
      }
      return await response.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (signal && signal.aborted) throw err; // cancelled on purpose: let the caller ignore it
      if (err && err.name === "TimeoutError") {
        throw new ApiError(service + " took too long to answer. Check your connection and try again.", err);
      }
      throw new ApiError("We couldn't reach " + service + ". Check your connection and try again.", err);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Turns a nested object into the bracket query-string style the AIC API reads:
   * { query: { range: { "color.h": { gte: 10 } } } }  ->  query[range][color.h][gte]=10
   */
  function toBracketParams(value, prefix, out) {
    out = out || [];
    if (value !== null && typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => {
        toBracketParams(child, prefix ? prefix + "[" + key + "]" : key, out);
      });
    } else if (value !== undefined) {
      out.push(encodeURIComponent(prefix) + "=" + encodeURIComponent(String(value)));
    }
    return out;
  }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** Builds the Elasticsearch-style query sent to the AIC search endpoint. */
  function buildColourQuery(options) {
    const target = colour.hexToHsl(options.hex);
    const must = [];

    if (colour.isNeutral(target)) {
      // Greys, blacks and whites: ignore hue, match on low saturation and similar lightness
      const spread = options.matchTone ? 18 : 32;
      must.push({ range: { "color.s": { lte: 20 } } });
      must.push({ range: { "color.l": { gte: clamp(target.l - spread, 0, 100), lte: clamp(target.l + spread, 0, 100) } } });
    } else {
      const tol = options.tolerance;
      const lo = target.h - tol;
      const hi = target.h + tol;
      if (lo < 0 || hi > 360) {
        // The range wraps past red (0/360 degrees), so ask for either side of the wrap
        must.push({
          bool: {
            should: [
              { range: { "color.h": { gte: (lo + 360) % 360, lte: 360 } } },
              { range: { "color.h": { gte: 0, lte: hi % 360 } } }
            ],
            minimum_should_match: 1
          }
        });
      } else {
        must.push({ range: { "color.h": { gte: lo, lte: hi } } });
      }

      if (options.matchTone) {
        must.push({ range: { "color.s": { gte: clamp(target.s - 30, 0, 100), lte: clamp(target.s + 30, 0, 100) } } });
        must.push({ range: { "color.l": { gte: clamp(target.l - 25, 0, 100), lte: clamp(target.l + 25, 0, 100) } } });
      } else {
        must.push({ range: { "color.s": { gte: 10 } } }); // skip near-greys whose hue is unreliable
      }
    }

    if (options.types && options.types.length) {
      must.push({
        bool: {
          should: options.types.map((type) => ({ match: { artwork_type_title: type } })),
          minimum_should_match: 1
        }
      });
    }

    if (Number.isFinite(options.from) || Number.isFinite(options.to)) {
      const range = {};
      if (Number.isFinite(options.from)) range.gte = options.from;
      if (Number.isFinite(options.to)) range.lte = options.to;
      must.push({ range: { date_start: range } });
    }

    if (options.publicDomain) {
      must.push({ term: { is_public_domain: true } });
    }

    return { bool: { must } };
  }

  const api = {
    ApiError,

    /** IIIF image URL. 843px wide is the size the museum caches, so it loads fastest. */
    imageUrl(imageId, width, base) {
      if (!imageId) return "";
      return (base || IIIF_DEFAULT) + "/" + imageId + "/full/" + (width || 843) + ",/0/default.jpg";
    },

    /**
     * Search the collection by colour.
     * options: { hex, tolerance, matchTone, q, from, to, types[], publicDomain, limit, page }
     * Returns { works, total, totalPages, page, iiif }
     */
    async searchByColour(options, signal) {
      const params = {
        query: buildColourQuery(options),
        fields: CARD_FIELDS,
        limit: options.limit || 12,
        page: options.page || 1
      };
      if (options.q) params.q = options.q;

      const url = AIC + "/artworks/search?" + toBracketParams(params).join("&");
      const data = await getJSON(url, { signal, service: "the Art Institute of Chicago" });

      const target = colour.hexToHsl(options.hex);
      const works = (data.data || [])
        .filter((w) => w.image_id) // only works we can show a picture of
        .map((w, index) => Object.assign(w, {
          relevance: index,
          score: colour.matchScore(target, w.color)
        }));

      return {
        works,
        total: (data.pagination && data.pagination.total) || 0,
        totalPages: (data.pagination && data.pagination.total_pages) || 1,
        page: (data.pagination && data.pagination.current_page) || 1,
        iiif: (data.config && data.config.iiif_url) || IIIF_DEFAULT
      };
    },

    /** Full record for one artwork. */
    async getArtwork(id, signal) {
      const url = AIC + "/artworks/" + encodeURIComponent(id) + "?fields=" + DETAIL_FIELDS;
      const data = await getJSON(url, { signal, service: "the Art Institute of Chicago" });
      return { work: data.data, iiif: (data.config && data.config.iiif_url) || IIIF_DEFAULT };
    },

    /** Live on-view status and gallery for a list of artwork ids. */
    async getOnViewStatus(ids, signal) {
      if (!ids.length) return [];
      const url = AIC + "/artworks?ids=" + ids.map(encodeURIComponent).join(",") +
        "&fields=id,title,is_on_view,gallery_title,gallery_id&limit=" + ids.length;
      const data = await getJSON(url, { signal, service: "the Art Institute of Chicago" });
      return data.data || [];
    },

    /** A human-friendly name for a colour, e.g. #2A3FC0 -> "Persian Blue". Cached. */
    colourName: (function () {
      const cache = new Map();
      return async function (hex, signal) {
        const clean = colour.normalise(hex);
        if (!clean) throw new ApiError("That isn't a valid colour.");
        if (cache.has(clean)) return cache.get(clean);
        const data = await getJSON(COLOR_API + "/id?hex=" + clean.slice(1), {
          signal, timeout: 8000, service: "The Color API"
        });
        const name = (data.name && data.name.value) || clean;
        cache.set(clean, name);
        return name;
      };
    })(),

    /** Neighbouring colours (analogous scheme) to suggest as the next search. */
    async colourNeighbours(hex, signal) {
      const clean = colour.normalise(hex);
      const data = await getJSON(COLOR_API + "/scheme?hex=" + clean.slice(1) + "&mode=analogic&count=5", {
        signal, timeout: 8000, service: "The Color API"
      });
      return (data.colors || [])
        .map((c) => ({ hex: colour.normalise(c.hex && c.hex.value), name: c.name && c.name.value }))
        .filter((c) => c.hex && c.hex !== clean);
    },

    /** Short Wikipedia biography for an artist. Returns null if there isn't a clear match. */
    async artistSummary(name, signal) {
      if (!name) return null;
      const title = encodeURIComponent(name.trim().replace(/\s+/g, "_"));
      try {
        const data = await getJSON(WIKI + title, { signal, timeout: 8000, service: "Wikipedia" });
        if (!data || data.type === "disambiguation" || !data.extract) return null;
        return {
          title: data.title,
          extract: data.extract,
          image: data.thumbnail && data.thumbnail.source,
          url: data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page
        };
      } catch (err) {
        return null; // a missing biography is not worth an error message
      }
    }
  };

  H.api = api;
})();

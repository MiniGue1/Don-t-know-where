// Icons from Tabler Icons (MIT, https://tabler.io/icons) — see vendor/tabler-icons-LICENSE.

const PATHS = {
  "run": `<path d="M11.007 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M4 17l5 1l.75 -1.5" /> <path d="M15 21v-4l-4 -3l1 -6" /> <path d="M7 12v-3l5 -1l3 3l3 1" />`,
  "walk": `<path d="M12 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M7 21l3 -4" /> <path d="M16 21l-2 -4l-3 -3l1 -6" /> <path d="M6 12l2 -3l4 -1l3 3l3 1" />`,
  "bike": `<path d="M2 18a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /> <path d="M16 18a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /> <path d="M12 19v-4l-3 -3l5 -4l2 3h3" /> <path d="M13.007 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />`,
  "motorbike": `<path d="M2 16a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /> <path d="M16 16a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /> <path d="M7.5 14h5l4 -4h-10.5m1.5 4l4 -4" /> <path d="M13 6h2l1.5 3l2 4" />`,
  "car": `<path d="M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M5 17h-2v-6l2 -5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6m-6 -6h15m-6 0v-5" />`,
  "compass": `<path d="M8 16l2 -6l6 -2l-2 6l-6 2" /> <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /> <path d="M12 3l0 2" /> <path d="M12 19l0 2" /> <path d="M3 12l2 0" /> <path d="M19 12l2 0" />`,
  "chart-line": `<path d="M4 19l16 0" /> <path d="M4 15l4 -6l4 2l4 -5l4 4" />`,
  "trophy": `<path d="M8 21l8 0" /> <path d="M12 17l0 4" /> <path d="M7 4l10 0" /> <path d="M17 4v8a5 5 0 0 1 -10 0v-8" /> <path d="M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />`,
  "user": `<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" /> <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />`,
  "stack-2": `<path d="M12 4l-8 4l8 4l8 -4l-8 -4" /> <path d="M4 12l8 4l8 -4" /> <path d="M4 16l8 4l8 -4" />`,
  "current-location": `<path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /> <path d="M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0" /> <path d="M12 2l0 2" /> <path d="M12 20l0 2" /> <path d="M20 12l2 0" /> <path d="M2 12l2 0" />`,
  "plus": `<path d="M12 5l0 14" /> <path d="M5 12l14 0" />`,
  "arrow-left": `<path d="M5 12l14 0" /> <path d="M5 12l6 6" /> <path d="M5 12l6 -6" />`,
  "trees": `<path d="M16 5l3 3l-2 1l4 4l-3 1l4 4h-9" /> <path d="M15 21l0 -3" /> <path d="M8 13l-2 -2" /> <path d="M8 12l2 -2" /> <path d="M8 21v-13" /> <path d="M5.824 16a3 3 0 0 1 -2.743 -3.69a3 3 0 0 1 .304 -4.833a3 3 0 0 1 4.615 -3.707a3 3 0 0 1 4.614 3.707a3 3 0 0 1 .305 4.833a3 3 0 0 1 -2.919 3.695h-4l-.176 -.005" />`,
  "mountain": `<path d="M3 20h18l-6.921 -14.612a2.3 2.3 0 0 0 -4.158 0l-6.921 14.612" /> <path d="M7.5 11l2 2.5l2.5 -2.5l2 3l2.5 -2" />`,
  "building-castle": `<path d="M15 19v-2a3 3 0 0 0 -6 0v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14h4v3h3v-3h4v3h3v-3h4v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1" /> <path d="M3 11l18 0" />`,
  "palette": `<path d="M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25" /> <path d="M7.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M11.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M15.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />`,
  "coffee": `<path d="M3 14c.83 .642 2.077 1.017 3.5 1c1.423 .017 2.67 -.358 3.5 -1c.83 -.642 2.077 -1.017 3.5 -1c1.423 -.017 2.67 .358 3.5 1" /> <path d="M8 3a2.4 2.4 0 0 0 -1 2a2.4 2.4 0 0 0 1 2" /> <path d="M12 3a2.4 2.4 0 0 0 -1 2a2.4 2.4 0 0 0 1 2" /> <path d="M3 10h14v5a6 6 0 0 1 -6 6h-2a6 6 0 0 1 -6 -6v-5" /> <path d="M16.746 16.726a3 3 0 1 0 .252 -5.555" />`,
  "sparkles": `<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6" />`,
  "map-pin-question": `<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /> <path d="M14.997 19.317l-1.583 1.583a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 13.657 -5.584" /> <path d="M19 22v.01" /> <path d="M19 19a2.003 2.003 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483" />`,
  "dice-5": `<path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14" /> <path d="M8 8.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" /> <path d="M15 8.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" /> <path d="M15 15.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" /> <path d="M8 15.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" /> <path d="M11.5 12a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" />`,
  "heart": `<path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />`,
  "share": `<path d="M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /> <path d="M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /> <path d="M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /> <path d="M8.7 10.7l6.6 -3.4" /> <path d="M8.7 13.3l6.6 3.4" />`,
  "download": `<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /> <path d="M7 11l5 5l5 -5" /> <path d="M12 4l0 12" />`,
  "trash": `<path d="M4 7l16 0" /> <path d="M10 11l0 6" /> <path d="M14 11l0 6" /> <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" /> <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />`,
  "map-pin-check": `<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /> <path d="M11.87 21.48a1.992 1.992 0 0 1 -1.283 -.58l-4.244 -4.243a8 8 0 1 1 13.355 -3.474" /> <path d="M15 19l2 2l4 -4" />`,
  "device-watch": `<path d="M6 9a3 3 0 0 1 3 -3h6a3 3 0 0 1 3 3v6a3 3 0 0 1 -3 3h-6a3 3 0 0 1 -3 -3v-6" /> <path d="M9 18v3h6v-3" /> <path d="M9 6v-3h6v3" />`,
  "flame": `<path d="M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.294 -2.333 5.588c0 3.704 3.134 6.706 7 6.706c3.866 0 7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235" />`,
  "x": `<path d="M18 6l-12 12" /> <path d="M6 6l12 12" />`,
  "chevron-right": `<path d="M9 6l6 6l-6 6" />`,
  "upload": `<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /> <path d="M7 9l5 -5l5 5" /> <path d="M12 4l0 12" />`,
  "route-2": `<path d="M3 19a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /> <path d="M19 7a2 2 0 1 0 0 -4a2 2 0 0 0 0 4" /> <path d="M14 5a2 2 0 0 0 -2 2v10a2 2 0 0 1 -2 2" />`,
  "flag": `<path d="M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0v-9" /> <path d="M5 21v-7" />`,
  "map-pin": `<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /> <path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0" />`,
  "search": `<path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /> <path d="M21 21l-6 -6" />`,
  "repeat": `<path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" /> <path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" />`,
  "arrow-narrow-right": `<path d="M5 12l14 0" /> <path d="M15 16l4 -4" /> <path d="M15 8l4 4" />`,
  "external-link": `<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" /> <path d="M11 13l9 -9" /> <path d="M15 4h5v5" />`,
};

/** Inline SVG icon. Inherits text colour; size via CSS (default 1em). */
export function icon(name, cls = "") {
  return `<svg class="i${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;
}

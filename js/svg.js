// =============================================================
// js/svg.js
// -------------------------------------------------------------
// A small helper shared by the viewscreens (system-map.js,
// industry-view.js, exploration-view.js): making SVG drawing
// elements from JavaScript.
// =============================================================

// SVG elements need this "namespace" when made from JavaScript,
// or the browser treats them as unknown HTML and draws nothing.
const SVG = "http://www.w3.org/2000/svg";

// -------------------------------------------------------------
// make(tag, attributes, parent)
// Makes one SVG element with its attributes and, if a parent is
// given, adds it to the parent. Gives back the new element.
//   make("circle", { cx: 10, cy: 10, r: 4 }, svg)
// -------------------------------------------------------------
export function make(tag, attributes, parent) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  if (parent) parent.appendChild(element);
  return element;
}

// -------------------------------------------------------------
// setText(element, text)
// Changes an element's words only if they're different. Setting
// the same text 60 times a second is wasted work for the browser.
// -------------------------------------------------------------
export function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

// Components of the extension's own pages (popup, key mapping window). These
// render into the light DOM so the page's stylesheet applies.

import { bindingLabel } from "../domain/binding.js";

export const SettingTag = Object.freeze({ SETTING: "svgp-setting", BINDINGS: "svgp-binding-table" });
export const SETTING_CHANGE = "setting-change";
export const ROW_SELECT = "row-select";

/** @param {{ HTMLElement: typeof HTMLElement, customElements: CustomElementRegistry, document: Document, CustomEvent: typeof CustomEvent }} win */
export function defineSettingsComponents(win) {
  const { document, CustomEvent } = win;

  /**
   * One setting: <svgp-setting key="volume" label="Volume" type="range" min="0" max="100" step="1"></svgp-setting>,
   * type="checkbox", or type="select" options="value:Label|…". Fires SETTING_CHANGE with { key, value }.
   */
  class Setting extends win.HTMLElement {
    connectedCallback() {
      if (this.input) return;
      const type = this.getAttribute("type") || "range";
      // An attribute, not the content: depending on the parser the element may
      // be connected before its children are.
      const text = this.getAttribute("label") || "";
      const label = document.createElement("label");
      let input;
      if (type === "select") {
        input = document.createElement("select");
        for (const opt of (this.getAttribute("options") || "").split("|")) {
          const [value, name] = opt.split(":");
          const o = document.createElement("option");
          o.value = value;
          o.textContent = name;
          input.appendChild(o);
        }
      } else {
        input = document.createElement("input");
        input.type = type;
        for (const a of ["min", "max", "step"]) if (this.hasAttribute(a)) input.setAttribute(a, this.getAttribute(a));
      }
      input.id = this.key;
      if (type === "checkbox") {
        label.className = "check";
        label.append(input, ` ${text}`);
      } else {
        const row = document.createElement("div");
        row.className = "row";
        const span = document.createElement("span");
        span.textContent = text;
        row.appendChild(span);
        if (type === "range") {
          this.output = document.createElement("output");
          row.appendChild(this.output);
        }
        label.append(row, input);
      }
      this.appendChild(label);
      this.input = input;
      input.addEventListener("input", () => {
        this.showValue();
        this.dispatchEvent(
          new CustomEvent(SETTING_CHANGE, { bubbles: true, detail: { key: this.key, value: this.value } }),
        );
      });
      if (this.pending !== undefined) this.value = this.pending;
    }

    get key() {
      return this.getAttribute("key");
    }

    get value() {
      const i = this.input;
      if (!i) return this.pending;
      if (i.type === "checkbox") return i.checked;
      return i.type === "range" ? Number(i.value) : i.value;
    }

    set value(v) {
      if (!this.input) {
        this.pending = v;
        return;
      }
      if (this.input.type === "checkbox") this.input.checked = !!v;
      else this.input.value = String(v);
      this.showValue();
    }

    showValue() {
      if (this.output) this.output.textContent = String(this.value);
    }
  }

  /** The key mapping table: one row per action with its binding. Fires ROW_SELECT with { index }. */
  class BindingTable extends win.HTMLElement {
    /** @param {{ label: string, binding: import("../domain/actions.js").BindingValue }[]} rows @param {number} current */
    render(rows, current) {
      if (!this.table) {
        this.table = document.createElement("table");
        this.appendChild(this.table);
      }
      this.table.textContent = "";
      rows.forEach((r, i) => {
        const tr = this.table.insertRow();
        tr.className = i === current ? "current" : "";
        tr.insertCell().textContent = r.label;
        const td = tr.insertCell();
        td.className = "btn";
        td.textContent = bindingLabel(r.binding);
        tr.addEventListener("click", () => this.dispatchEvent(new CustomEvent(ROW_SELECT, { detail: { index: i } })));
      });
    }

    get rows() {
      return this.table ? [...this.table.children] : [];
    }
  }

  for (const [tag, cls] of [
    [SettingTag.SETTING, Setting],
    [SettingTag.BINDINGS, BindingTable],
  ]) {
    if (!win.customElements.get(/** @type {string} */ (tag)))
      win.customElements.define(/** @type {string} */ (tag), /** @type {any} */ (cls));
  }
}

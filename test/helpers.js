// The extension scripts are plain browser scripts (no modules), so tests load them into a
// vm sandbox with stubbed browser globals and read back the declarations they make.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function load(file, globals = {}, exportNames = [], { wrap = false } = {}) {
  let src = fs.readFileSync(path.join(root, file), "utf8");
  const exportsLine = `globalThis.__exports = { ${exportNames.join(", ")} };\n`;
  if (wrap) {
    // inject.js is one IIFE: expose internals right before it closes.
    const end = src.lastIndexOf("})();");
    src = src.slice(0, end) + exportsLine + src.slice(end);
  } else if (exportNames.length) {
    // Top-level const/let/function declarations are not properties of the context object.
    src += "\n;" + exportsLine;
  }
  const context = vm.createContext({ console, ...globals });
  vm.runInContext(src, context, { filename: file });
  return context.__exports ?? context;
}

module.exports = { load, root };

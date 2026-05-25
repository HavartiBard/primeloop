"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.writeAtomicJson = writeAtomicJson;var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var path = _interopRequireWildcard(await jitiImport("node:path"));function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}

function writeAtomicJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
} /* v9-a57d5be965a4a6dd */

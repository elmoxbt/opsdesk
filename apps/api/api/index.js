// Vercel function: every /api/* request (see vercel.json) is handled by the compiled Nest app.
// The TypeScript is compiled by `nest build` (tsc, which keeps the decorator metadata Nest's
// dependency injection needs), so this file only loads the result.
module.exports = require("../dist/serverless.js").default;

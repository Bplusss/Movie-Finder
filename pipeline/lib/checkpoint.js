// pipeline/lib/checkpoint.js
"use strict";
const fs = require("fs");

function readCheckpoint(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (e) {
    return { offset: 0, failed: [], done: false };
  }
}

function writeCheckpoint(path, state) {
  fs.writeFileSync(path, JSON.stringify(state, null, 2));
}

module.exports = { readCheckpoint, writeCheckpoint };

const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let inputData = '';
rl.on('line', (line) => {
  inputData += line;
});

rl.on('close', () => {
  let payload = {};
  try {
    if (inputData.trim()) payload = JSON.parse(inputData);
  } catch (e) {}

  // @TODO: Triggered after a tool executes, containing the tool's result in the payload.
  // Idea: Use this to track which tools fail frequently. If a tool errors out, we can
  // log a "tool_error" semantic memory so future agents know to avoid certain arguments.

  console.log('{}');
  process.exit(0);
});

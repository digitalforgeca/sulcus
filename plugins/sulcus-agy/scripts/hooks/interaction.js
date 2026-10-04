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

  // @TODO: Triggered on user interaction events (like clicking a UI button or selecting an option).
  // Idea: Capture implicit user preferences based on what they click/select.

  console.log('{}');
  process.exit(0);
});

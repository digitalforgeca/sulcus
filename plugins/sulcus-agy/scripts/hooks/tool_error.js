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

  // @TODO: Triggered specifically on an unhandled tool exception or crash.
  // Idea: Immediately alert the user or log the stack trace to the Sulcus error graph.

  console.log('{}');
  process.exit(0);
});

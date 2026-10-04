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

  // @TODO: Triggered when the agent session is completely torn down.
  // Idea: Flush any pending background compaction tasks or log an "episode end" node.

  console.log('{}');
  process.exit(0);
});

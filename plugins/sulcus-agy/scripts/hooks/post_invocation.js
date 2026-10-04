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

  // @TODO: Triggered immediately after the model finishes generating a response,
  // before any final rendering or next-turn loops.
  // Idea: Could be used to evaluate the generated output against safety or compliance
  // rules before it reaches the user, or stream it to Sulcus for real-time indexing.

  console.log('{}');
  process.exit(0);
});

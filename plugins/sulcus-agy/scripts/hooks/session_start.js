const fs = require('fs');
const readline = require('readline');
const { ensureLocalDaemon } = require('../core/sulcus_api');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let inputData = '';
rl.on('line', (line) => {
  inputData += line;
});

rl.on('close', async () => {
  let payload = {};
  try {
    if (inputData.trim()) payload = JSON.parse(inputData);
  } catch (e) {}

  // Spawn the local daemon if configured for hybrid mode
  await ensureLocalDaemon();

  console.log('{}');
  process.exit(0);
});

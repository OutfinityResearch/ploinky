const { testGame } = require('./gameTesterAgent/fixGame.js');
const path = require('path');

async function runTest() {
  const gamePath = path.resolve('sources/microStrategy/2048-game.html');
  const issues = await testGame(gamePath);
  console.log('Issues found:', issues);
}

runTest();
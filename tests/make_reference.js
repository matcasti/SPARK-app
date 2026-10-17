// Writes the RR series used by the R-vs-JS equivalence test.
const E = require('../engine.js'); const fs = require('fs');
fs.mkdirSync(__dirname + '/data', { recursive: true });
fs.writeFileSync(__dirname + '/data/example400.json', JSON.stringify(E.genLegacyExampleRR(400)));      // earlier, highly variable example
fs.writeFileSync(__dirname + '/data/exercise525.json', JSON.stringify(E.genExampleSession().rr));       // the built-in 5-2-5 example
console.log('wrote tests/data/example400.json and exercise525.json');

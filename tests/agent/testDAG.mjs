import { generateWeightedDAG } from './helpers/graphGenerator.mjs';

console.log(generateWeightedDAG({ nodeCount: 6, seed: 42 }));

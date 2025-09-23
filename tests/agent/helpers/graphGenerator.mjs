function createRng(seed = 1) {
    let state = (seed >>> 0) || 1;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function pickUniqueIndices(rng, available, count) {
    const chosen = new Set();
    const pool = available.slice();
    while (chosen.size < count && pool.length) {
        const index = Math.floor(rng() * pool.length);
        const value = pool.splice(index, 1)[0];
        chosen.add(value);
    }
    return Array.from(chosen);
}

/**
 * Builds a reproducible weighted DAG suitable for longest-path style tests.
 */
export function generateWeightedDAG(options = {}) {
    const {
        nodeCount = 8,
        minParents = 1,
        maxParents = 3,
        minWeight = 1,
        maxWeight = 10,
        ensureBackbone = true,
        edgeDensity = 0.4,
        seed = 7,
    } = options;

    if (!Number.isInteger(nodeCount) || nodeCount < 2) {
        throw new Error('nodeCount must be an integer >= 2.');
    }
    if (minParents < 0 || maxParents < 0) {
        throw new Error('minParents and maxParents must be non-negative.');
    }
    if (minParents > maxParents) {
        throw new Error('minParents cannot exceed maxParents.');
    }
    if (minWeight > maxWeight) {
        throw new Error('minWeight cannot exceed maxWeight.');
    }
    if (edgeDensity < 0 || edgeDensity > 1) {
        throw new Error('edgeDensity must be between 0 and 1.');
    }

    const rng = createRng(seed);
    const nodes = Array.from({ length: nodeCount }, (_, index) => `node${index}`);
    const edges = [];

    for (let index = 1; index < nodeCount; index += 1) {
        const candidateParents = Array.from({ length: index }, (_, parentIndex) => parentIndex);
        let minimum = Math.min(minParents, candidateParents.length);
        const maximum = Math.min(Math.max(minimum, maxParents), candidateParents.length);

        const selectedParents = new Set();

        if (ensureBackbone) {
            selectedParents.add(index - 1);
            minimum = Math.min(Math.max(minimum, 1), candidateParents.length);
        }

        if (selectedParents.size < minimum) {
            const remaining = candidateParents.filter((value) => !selectedParents.has(value));
            const needed = minimum - selectedParents.size;
            pickUniqueIndices(rng, remaining, needed).forEach((value) => selectedParents.add(value));
        }

        const remainingParents = candidateParents.filter((value) => !selectedParents.has(value));
        const additionalCapacity = maximum - selectedParents.size;
        let additionalDesired = remainingParents.length * edgeDensity;
        let additionalCount = Math.floor(additionalDesired);
        const fractional = additionalDesired - additionalCount;
        if (fractional > 0 && rng() < fractional) {
            additionalCount += 1;
        }
        additionalCount = Math.min(additionalCapacity, additionalCount, remainingParents.length);
        pickUniqueIndices(rng, remainingParents, additionalCount).forEach((value) => selectedParents.add(value));

        selectedParents.forEach((parentIndex) => {
            const weight = minWeight + Math.floor(rng() * (maxWeight - minWeight + 1));
            edges.push({
                from: nodes[parentIndex],
                to: nodes[index],
                weight,
            });
        });
    }

    const adjacencyList = Object.fromEntries(nodes.map((node) => [node, []]));
    edges.forEach((edge) => {
        adjacencyList[edge.from].push({ to: edge.to, weight: edge.weight });
    });

    return {
        nodes,
        edges,
        adjacencyList,
        topologicalOrder: nodes.slice(),
    };
}

const MapBenchmark = require("./MapBenchmark.js");
const ShareableMap = require("./../dist/shared-memory-datastructures.js");

function generator() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// console.log("Performing performance measurements for default JS Map...");
// const defaultBench = new MapBenchmark(generator, generator);
// defaultBench.runBenchmark(() => new Map());

const keyValuePairs = [];

for (let i = 0; i < 1000000; i++) {
    keyValuePairs.push([generator(), generator()]);
}

const map = new ShareableMap.ShareableMap(keyValuePairs.length);
// const map = new Map();

for (const [key, value] of keyValuePairs) {
    map.set(key, value);
}

const startTime = new Date().getTime();

for (const [key, value] of keyValuePairs) {
    map.get(key);
}

const endTime = new Date().getTime();

console.log((endTime - startTime) + "ms");

// console.log("Performing performance measurement+s for default shared memory Map...");
// const sharedBench = new MapBenchmark(generator, generator, [1000, 10000, 50000]);
// sharedBench.runBenchmark(() => new ShareableMap.ShareableMap());

import {ShareableMap} from "../ShareableMap";

describe("ShareableMap", () => {
    // How many key, value pairs will be generated? Retrieve them again later to check whether the corresponding values
    // are correct.
    const pairAmount = 100000;
    const extraDuplicates = 500;

    const pairs: [string, string][] = [];
    const pairResults = new Map<string, string>();

    for (let i = 0; i < pairAmount; i++) {
        const key = generateRandomString();
        const value = generateRandomString();

        pairs.push([key, value]);
        pairResults.set(key, value);
    }

    // Select 500 random pairs to add as duplicates (only the keys should be the same, the values can be different)
    for (let i = 0; i < extraDuplicates; i++) {
        const randomIndex = Math.floor(Math.random() * pairAmount);
        const key = pairs[randomIndex][0];

        const randomValue = generateRandomString();

        pairs.push([key, randomValue]);
        pairResults.set(key, randomValue);
    }

    // Since a key could be generated (at random) multiple times, we need to count the amount of unique keys to use in
    // the tests.
    const uniqueKeysCount = new Set(pairs.map(pair => pair[0])).size;

    beforeAll(() => {
        const { TextEncoder, TextDecoder } = require("util");
        globalThis.TextEncoder = TextEncoder;
        globalThis.TextDecoder = TextDecoder;
    });

    it("should correctly add duplicate keys only once", () => {
        const map = new ShareableMap<string, number>();

        const keysToInsert = ["a", "b", "c", "a", "d", "a"];
        const valuesToInsert = [1, 2, 3, 4, 5, 6];

        // Some keys occur multiple times
        const expectedMapSize = 4;

        for (let i = 0; i < keysToInsert.length; i++) {
            map.set(keysToInsert[i], valuesToInsert[i]);
        }

        expect(map.size).toEqual(expectedMapSize);
    });

    it("should correctly return all values that are stored in the map", () => {
        const map = new ShareableMap<string, string>();

        for (const [key, value] of pairs) {
            map.set(key, value);
        }

        // Check that all these values are indeed present in the map
        expect(map.size).toEqual(uniqueKeysCount);

        for (const [key, value] of pairs) {
            expect(map.has(key)).toBeTruthy();
            const retrievedValue = map.get(key);
            expect(retrievedValue).toEqual(pairResults.get(key));
        }
    });

    it("should work with keys that are objects", () => {
        const map = new ShareableMap<{ firstName: string, lastName: string }, string>();

        const key1 = {
            firstName: "John",
            lastName: "Doe"
        }

        map.set(key1, "test");

        expect([...map.keys()]).toEqual([key1]);
        expect(map.get(key1)).toEqual("test");
    });

    it("should work with values that are objects", () => {
        const map = new ShareableMap<string, { firstName: string, lastName: string }>();

        const value1 = {
            firstName: "John",
            lastName: "Doe"
        };

        map.set("k1", value1);

        expect(map.get("k1")).toEqual(value1);
    });

    it("should work with keys that are numbers", () => {
        const map = new ShareableMap<number, string>();

        map.set(1, "test");
        map.set(12424, "test1");

        expect(map.get(1)).toEqual("test");
        expect(map.get(12424)).toEqual("test1");
    });

    it("should work with values that are numbers", () => {
        const map = new ShareableMap<string, number>();

        map.set("k1", 2341);
        map.set("k2", 23478);

        expect(map.get("k1")).toEqual(2341);
        expect(map.get("k2")).toEqual(23478);

        expect(typeof map.get("k1")).toEqual("number");
    });

    it("should clear all entries from the map", () => {
        const map = new ShareableMap<string, string>();
        map.set("key1", "value1");
        map.set("key2", "value2");

        map.clear();

        expect(map.size).toBe(0);
        expect(map.get("key1")).toBeUndefined();
        expect(map.get("key2")).toBeUndefined();
    });

    it("should delete specific entries from the map", () => {
        const map = new ShareableMap<string, string>();
        map.set("key1", "value1");
        map.set("key2", "value2");

        expect(map.delete("key1")).toBeTruthy();
        expect(map.delete("nonexistent")).toBeFalsy();

        expect(map.size).toBe(1);
        expect(map.get("key1")).toBeUndefined();
        expect(map.get("key2")).toBe("value2");
    });

    it("should iterate over all entries using forEach", () => {
        const map = new ShareableMap<string, number>();
        const entries: [string, number][] = [
            ["a", 1],
            ["b", 2],
            ["c", 3]
        ];

        entries.forEach(([key, value]) => map.set(key, value));

        const result: [string, number][] = [];
        map.forEach((value, key) => {
            result.push([key, value]);
        });

        expect(result.toSorted()).toEqual(entries.toSorted());
    });

    it("should handle forEach on empty map", () => {
        const map = new ShareableMap<string, number>();
        let iterationCount = 0;

        map.forEach(() => {
            iterationCount++;
        });

        expect(iterationCount).toBe(0);
    });

    it("should return correct size for empty map", () => {
        const map = new ShareableMap<string, string>();
        expect(map.size).toBe(0);
    });

    it("should correctly add keys and remove them", () => {
        const map = new ShareableMap<string, string>();

        for (const [key, value] of pairs) {
            map.set(key, value);
        }

        // Check that the length of the map is correct before deletion
        expect(map.size).toEqual(uniqueKeysCount);

        // Extract 5000 keys from the pairs and remove these from the map. Also count how many unique keys we've
        // selected
        const uniquesRemoved = new Set<string>();
        for (const [key, value] of pairs.slice(0, 5000)) {
            map.delete(key);
            uniquesRemoved.add(key);
        }

        expect(map.size).toEqual(uniqueKeysCount - uniquesRemoved.size);

        // Check that the removed keys are all gone from the map.
        for (const removedKey of uniquesRemoved) {
            expect(map.has(removedKey)).toBeFalsy();
        }
    });

    it("should correctly defragment the map if required", () => {
        const map = new ShareableMap<string, string>();

        // First we add a bunch of values
        for (const [key, value] of pairs) {
            map.set(key, value);
        }

        // Then we remove about 75% of the keys
        const removedPairs = pairs.slice(0, Math.floor(pairAmount * 0.90));
        for (const [key, _] of removedPairs) {
            map.delete(key);
        }

        // Check that defragmentation has not yet occurred (because it's only performed on setting a value)
        const transferableStateBefore = map.toTransferableState();
        const dataViewBefore = new DataView(transferableStateBefore.dataBuffer);

        // Size of data buffer before adding values again
        const dataBufferSizeBeforeSet = dataViewBefore.byteLength;

        // Add the removedPairs again, and check that the dataBuffer has not increased in size (which means that
        // defragmentation must have been triggered at some point).
        for (const [key, value] of removedPairs) {
            map.set(key, value);
        }

        const transferableStateAfter = map.toTransferableState();
        const dataViewAfter = new DataView(transferableStateAfter.dataBuffer);

        // Size of data buffer after adding values
        const dataBufferSizeAfterSet = dataViewAfter.byteLength;

        // The map should not have grown
        expect(dataBufferSizeAfterSet).toEqual(dataBufferSizeBeforeSet);

        // Check that all data is still available
        for (const [key, _]  of pairs) {
            expect(map.has(key)).toBeTruthy();
        }
    });
});

function generateRandomString() {
    return Math.random().toString(36).substring(7);
}

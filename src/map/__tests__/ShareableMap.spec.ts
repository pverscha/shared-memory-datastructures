import ShareableMap from "../ShareableMap";

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

        console.log([...map.keys()]);
        console.log([...map.values()]);

        expect(map.size).toEqual(expectedMapSize);
    });

    it("should correctly return all values that are stored in the map", () => {
        const map = new ShareableMap<string, string>(1000, 64);

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

    // it("should work with keys that are objects containing functions", () => {
    //     const map = new ShareableMap<{ firstName: string, lastName: string, testFunction: () => string }, string>();
    //
    //     const key1 = {
    //         firstName: "John",
    //         lastName: "Doe",
    //         testFunction: () => {
    //             return "something";
    //         }
    //     }
    //
    //     map.set(key1, "test");
    //
    //
    //     expect([...map.keys()]).toEqual([key1]);
    //     expect(map.get(key1)).toEqual("test");
    //     expect([...map.keys()][0].testFunction()).toEqual("something");
    // })
});

function generateRandomString() {
    return Math.random().toString(36).substring(7);
}

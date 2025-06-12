import {ShareableArray} from "../ShareableArray";

describe("ShareableArray", () => {
    const randomItemsAmount = 50000;

    const generatedData: string[] = [];

    for (let i = 0; i < randomItemsAmount; i++) {
        generatedData.push(generateRandomString());
    }

    beforeAll(() => {
        const { TextEncoder, TextDecoder } = require("util");
        globalThis.TextEncoder = TextEncoder;
        globalThis.TextDecoder = TextDecoder;
    });

    it("should correctly add items", () => {
        const array = new ShareableArray<string>();
        for (const item of generatedData) {
            array.push(item);
        }
        expect(array.length).toEqual(randomItemsAmount);
    });

    it("should correctly return the items that have been added before", () => {
        const array = new ShareableArray<string>();
        for (const item of generatedData) {
            array.push(item);
        }

        for (let idx = 0; idx < randomItemsAmount; idx++) {
            expect(array.at(idx)).toEqual(generatedData[idx]);
        }
    });
});

function generateRandomString() {
    return Math.random().toString(36).substring(7);
}

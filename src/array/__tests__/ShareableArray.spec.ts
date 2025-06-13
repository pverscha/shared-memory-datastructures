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

    it("should correctly concatenate two ShareableArrays", () => {
        const arrA = new ShareableArray<string>();
        const arrB = new ShareableArray<string>();

        const dummyData = ["a", "b", "c", "d", "e", "1", "2", "3", "4", "5"];

        // Fill the first array
        for (const item of dummyData.slice(0, 5)) {
            arrA.push(item);
        }

        // Fill the second array
        for (const item of dummyData.slice(5, 10)) {
            arrB.push(item);
        }

        const concatenated = arrA.concat(arrB);

        expect(concatenated.length).toEqual(dummyData.length);

        // Check if all items from the dummy data are present in the concatenated arrays
        for (const [idx, dummyItem] of dummyData.entries()) {
            expect(concatenated.at(idx)).toEqual(dummyItem);
        }
    });

    it("should correctly concatenate a ShareableArray with a normal array", () => {
        const arrA = new ShareableArray<string>();
        const arrB = [];

        const dummyData = ["a", "b", "c", "d", "e", "1", "2", "3", "4", "5"];

        // Fill the first array
        for (const item of dummyData.slice(0, 5)) {
            arrA.push(item);
        }

        // Fill the second array
        for (const item of dummyData.slice(5, 10)) {
            arrB.push(item);
        }

        const concatenated = arrA.concat(arrB);

        expect(concatenated.length).toEqual(dummyData.length);

        // Check if all items from the dummy data are present in the concatenated arrays
        for (const [idx, dummyItem] of dummyData.entries()) {
            expect(concatenated.at(idx)).toEqual(dummyItem);
        }
    });

    it("should correctly check if all elements satisfy a condition using every()", () => {
        const array = new ShareableArray<number>();
        [2, 4, 6, 8, 10].forEach(n => array.push(n));

        expect(array.every(num => num! % 2 === 0)).toBeTruthy();
        expect(array.every(num => num! > 5)).toBeFalsy();
    });

    it("should correctly filter elements using filter()", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(n => array.push(n));

        const filtered = array.filter(num => num! % 2 === 0);
        expect(filtered.length).toBe(5);
        expect([...filtered].every(num => num % 2 === 0)).toBeTruthy();
    });

    it("should correctly execute forEach() on all elements", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));

        const result: number[] = [];
        array.forEach(num => result.push(num! * 2));

        expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it("should correctly find element index using indexOf()", () => {
        const array = new ShareableArray<string>();
        ["apple", "banana", "orange", "banana", "grape"].forEach(item => array.push(item));

        expect(array.indexOf("banana")).toBe(1);
        expect(array.indexOf("grape")).toBe(4);
        expect(array.indexOf("mango")).toBe(-1);
        expect(array.indexOf("banana", 2)).toBe(3);
    });

    it("should correctly join elements with different delimiters", () => {
        const emptyArray = new ShareableArray<string>();
        const singleArray = new ShareableArray<string>();
        const multiArray = new ShareableArray<string>();

        singleArray.push("apple");
        ["apple", "banana", "orange"].forEach(item => multiArray.push(item));

        // Empty array
        expect(emptyArray.join()).toBe("");
        expect(emptyArray.join("|")).toBe("");
        expect(emptyArray.join(" and ")).toBe("");
        expect(emptyArray.join("")).toBe("");

        // Single element array
        expect(singleArray.join()).toBe("apple");
        expect(singleArray.join("|")).toBe("apple");
        expect(singleArray.join(" and ")).toBe("apple");
        expect(singleArray.join("")).toBe("apple");

        // Multiple elements array
        expect(multiArray.join()).toBe("apple,banana,orange");
        expect(multiArray.join("|")).toBe("apple|banana|orange");
        expect(multiArray.join(" and ")).toBe("apple and banana and orange");
        expect(multiArray.join("")).toBe("applebananaorange");
    });

    it("should correctly find last element index using lastIndexOf()", () => {
        const array = new ShareableArray<string>();
        ["apple", "banana", "orange", "banana", "grape"].forEach(item => array.push(item));

        expect(array.lastIndexOf("banana")).toBe(3);
        expect(array.lastIndexOf("grape")).toBe(4);
        expect(array.lastIndexOf("mango")).toBe(-1);
        expect(array.lastIndexOf("banana", 2)).toBe(1);
    });
});

function generateRandomString() {
    return Math.random().toString(36).substring(7);
}

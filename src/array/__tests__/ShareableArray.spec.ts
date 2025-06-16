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

    it("should correctly store and retrieve simple objects", () => {
        const array = new ShareableArray<{ id: number, name: string }>();
        const testObjects = [
            {id: 1, name: "first"},
            {id: 2, name: "second"},
            {id: 3, name: "third"}
        ];

        testObjects.forEach(obj => array.push(obj));

        for (let i = 0; i < testObjects.length; i++) {
            expect(array.at(i)).toEqual(testObjects[i]);
        }
    });

    it("should correctly store and retrieve nested objects", () => {
        const array = new ShareableArray<{ user: { id: number, details: { name: string } } }>();
        const testObjects = [
            {user: {id: 1, details: {name: "John"}}},
            {user: {id: 2, details: {name: "Jane"}}}
        ];

        testObjects.forEach(obj => array.push(obj));

        for (let i = 0; i < testObjects.length; i++) {
            expect(array.at(i)).toEqual(testObjects[i]);
        }
    });

    it("should correctly store and retrieve objects with array properties", () => {
        const array = new ShareableArray<{ id: number, tags: string[] }>();
        const testObjects = [
            {id: 1, tags: ["tag1", "tag2"]},
            {id: 2, tags: ["tag3", "tag4", "tag5"]}
        ];

        testObjects.forEach(obj => array.push(obj));

        for (let i = 0; i < testObjects.length; i++) {
            expect(array.at(i)).toEqual(testObjects[i]);
        }
    });

    it("should correctly store and retrieve complex nested objects", () => {
        type ComplexObject = {
            id: number,
            metadata: {
                created: string,
                tags: string[]
            },
            data: {
                user: {
                    details: {
                        name: string,
                        contacts: {
                            email: string,
                            phone?: string
                        }[]
                    }
                }
            }
        };

        const array = new ShareableArray<ComplexObject>();
        const testObjects: ComplexObject[] = [
            {
                id: 1,
                metadata: {
                    created: '2025-01-01',
                    tags: ["important", "user"]
                },
                data: {
                    user: {
                        details: {
                            name: "John Doe",
                            contacts: [
                                {email: "john@example.com", phone: "1234567"},
                                {email: "john.doe@example.com"}
                            ]
                        }
                    }
                }
            },
            {
                id: 2,
                metadata: {
                    created: '2025-01-02',
                    tags: ["regular"]
                },
                data: {
                    user: {
                        details: {
                            name: "Jane Doe",
                            contacts: [
                                {email: "jane@example.com"}
                            ]
                        }
                    }
                }
            }
        ];

        testObjects.forEach(obj => array.push(obj));

        for (let i = 0; i < testObjects.length; i++) {
            expect(array.at(i)).toEqual(testObjects[i]);
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

    it("should correctly pop elements from a non-empty array", () => {
        const array = new ShareableArray<string>();
        ["apple", "banana", "orange"].forEach(item => array.push(item));

        expect(array.pop()).toBe("orange");
        expect(array.pop()).toBe("banana");
        expect(array.pop()).toBe("apple");
    });

    it("should return undefined when popping from an empty array", () => {
        const array = new ShareableArray<string>();
        expect(array.pop()).toBeUndefined();
    });

    it("should correctly update length after pop operations", () => {
        const array = new ShareableArray<string>();
        ["apple", "banana", "orange"].forEach(item => array.push(item));

        expect(array.length).toBe(3);
        array.pop();
        expect(array.length).toBe(2);
        array.pop();
        expect(array.length).toBe(1);
        array.pop();
        expect(array.length).toBe(0);
    });

    it("should correctly reduce array of numbers", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));

        const sum = array.reduce((acc, curr) => acc! + curr!, 0);
        expect(sum).toBe(15);

        const emptyArray = new ShareableArray<number>();
        expect(emptyArray.reduce((acc, curr) => acc! + curr!, 0)).toBe(0);
    });

    it("should correctly reduce array of strings", () => {
        const array = new ShareableArray<string>();
        ["Hello", " ", "World", "!"].forEach(s => array.push(s));

        const concatenated = array.reduce((acc, curr) => acc! + curr!);
        expect(concatenated).toBe("Hello World!");

        const emptyArray = new ShareableArray<string>();
        expect(() => emptyArray.reduce((acc, curr) => acc! + curr!)).toThrow();
    });

    it("should correctly reduce with initial value", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3].forEach(n => array.push(n));

        const sumPlusTen = array.reduce((acc, curr) => acc + curr!, 10);
        expect(sumPlusTen).toBe(16);

        const emptyArray = new ShareableArray<number>();
        expect(emptyArray.reduce((acc, curr) => acc + curr!, 10)).toBe(10);
    });

    it("should correctly reduce right array of numbers", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));

        const result = array.reduceRight((acc, curr) => acc! - curr!);
        expect(result).toBe(-5);

        const emptyArray = new ShareableArray<number>();
        expect(() => emptyArray.reduceRight((acc, curr) => acc! - curr!)).toThrow();
    });

    it("should correctly reduce right with initial value", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3].forEach(n => array.push(n));

        const result = array.reduceRight((acc, curr) => acc - curr!, 10);
        expect(result).toBe(4);

        const emptyArray = new ShareableArray<number>();
        expect(emptyArray.reduceRight((acc, curr) => acc - curr!, 10)).toBe(10);
    });

    it("should correctly reverse non-empty array", () => {
        const array = new ShareableArray<string>();
        ["a", "b", "c", "d"].forEach(item => array.push(item));

        array.reverse();

        expect([...array]).toEqual(["d", "c", "b", "a"]);
    });

    it("should handle reverse on empty array", () => {
        const array = new ShareableArray<string>();
        array.reverse();
        expect(array.length).toBe(0);
    });

    it("should correctly shift elements from non-empty array", () => {
        const array = new ShareableArray<string>();
        ["apple", "banana", "orange"].forEach(item => array.push(item));

        expect(array.shift()).toBe("apple");
        expect(array.shift()).toBe("banana");
        expect(array.shift()).toBe("orange");
    });

    it("should return undefined when shifting from empty array", () => {
        const array = new ShareableArray<string>();
        expect(array.shift()).toBeUndefined();
    });

    it("should correctly update length after shift operations", () => {
        const array = new ShareableArray<string>();
        ["apple", "banana", "orange"].forEach(item => array.push(item));

        expect(array.length).toBe(3);
        array.shift();
        expect(array.length).toBe(2);
        array.shift();
        expect(array.length).toBe(1);
        array.shift();
        expect(array.length).toBe(0);
    });

    it("should correctly fill array with a number value", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));
        array.fill(0);
        expect([...array]).toEqual([0, 0, 0, 0, 0]);
    });

    it("should correctly fill array with a string value", () => {
        const array = new ShareableArray<string>();
        ["a", "b", "c"].forEach(s => array.push(s));
        array.fill("x");
        expect([...array]).toEqual(["x", "x", "x"]);
    });

    it("should correctly fill array with an object value", () => {
        const array = new ShareableArray<object>();
        [{id: 1}, {id: 2}, {id: 3}].forEach(obj => array.push(obj));
        const fillObj = {test: true};
        array.fill(fillObj);
        expect([...array]).toEqual([fillObj, fillObj, fillObj]);
    });

    it("should correctly fill array with start and end indexes", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));
        array.fill(0, 1, 4);
        expect([...array]).toEqual([1, 0, 0, 0, 5]);
    });

    it("should handle filling empty array", () => {
        const array = new ShareableArray<number>();
        array.fill(1);
        expect([...array]).toEqual([]);
    });

    it("should handle negative indexes when filling", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));
        array.fill(0, -3, -1);
        expect([...array]).toEqual([1, 2, 0, 0, 5]);
    });

    it("should handle out of bounds indexes when filling", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3].forEach(n => array.push(n));
        array.fill(0, -5, 10);
        expect([...array]).toEqual([0, 0, 0]);
    });

    it("should correctly find element using find()", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));

        const found = array.find(num => num! > 3);
        expect(found).toBe(4);

        const evenNumber = array.find(num => num! % 2 === 0);
        expect(evenNumber).toBe(2);
    });

    it("should return undefined when no element is found using find()", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));

        const notFound = array.find(num => num! > 10);
        expect(notFound).toBeUndefined();
    });

    it("should correctly find element index using findIndex()", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));

        const foundIndex = array.findIndex(num => num! > 3);
        expect(foundIndex).toBe(3);

        const evenNumberIndex = array.findIndex(num => num! % 2 === 0);
        expect(evenNumberIndex).toBe(1);
    });

    it("should return -1 when no element index is found using findIndex()", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));

        const notFoundIndex = array.findIndex(num => num! > 10);
        expect(notFoundIndex).toBe(-1);
    });

    it("should correctly find last element using findLast()", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5, 2, 4].forEach(n => array.push(n));

        const found = array.findLast(num => num! > 3);
        expect(found).toBe(4);

        const evenNumber = array.findLast(num => num! % 2 === 0);
        expect(evenNumber).toBe(4);
    });

    it("should return undefined when no element is found using findLast()", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));

        const notFound = array.findLast(num => num! > 10);
        expect(notFound).toBeUndefined();
    });

    it("should correctly find last element index using findLastIndex()", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5, 2, 4].forEach(n => array.push(n));

        const foundIndex = array.findLastIndex(num => num! > 3);
        expect(foundIndex).toBe(6);

        const evenNumberIndex = array.findLastIndex(num => num! % 2 === 0);
        expect(evenNumberIndex).toBe(6);
    });

    it("should return -1 when no element index is found using findLastIndex()", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3, 4, 5].forEach(n => array.push(n));

        const notFoundIndex = array.findLastIndex(num => num! > 10);
        expect(notFoundIndex).toBe(-1);
    });


    it("should correctly check if element exists using includes()", () => {
        const array = new ShareableArray<string>();
        ["apple", "banana", "orange"].forEach(item => array.push(item));

        expect(array.includes("banana")).toBeTruthy();
        expect(array.includes("grape")).toBeFalsy();
        // `fromIndex >= array.length` => The array should not be searched.
        expect(array.includes("banana", 2)).toBeFalsy();
        // Start searching after "apple" (which should thus not be found).
        expect(array.includes("apple", 1)).toBeFalsy();
    });

    it("should correctly return iterator for array keys()", () => {
        const array = new ShareableArray<string>();
        ["a", "b", "c"].forEach(item => array.push(item));

        const keys = [...array.keys()];
        expect(keys).toEqual([0, 1, 2]);
    });

    it("should correctly flatMap array elements", () => {
        const array = new ShareableArray<number>();
        [1, 2, 3].forEach(n => array.push(n));

        const result = array.flatMap(x => [x!, x! * 2]);
        expect([...result]).toEqual([1, 2, 2, 4, 3, 6]);
        expect(result).toBeInstanceOf(ShareableArray);
    });

    it("should correctly reverse array without modifying original using toReversed()", () => {
        const array = new ShareableArray<string>();
        ["a", "b", "c", "d"].forEach(item => array.push(item));

        const reversed = array.toReversed();

        expect([...reversed]).toEqual(["d", "c", "b", "a"]);
        expect([...array]).toEqual(["a", "b", "c", "d"]);
        expect(reversed).toBeInstanceOf(ShareableArray);
    });

    it("should correctly sort array without modifying original using toSorted()", () => {
        const array = new ShareableArray<number>();
        [3, 1, 4, 1, 5, 9, 2, 6].forEach(n => array.push(n));

        const sorted = array.toSorted();
        const customSorted = array.toSorted((a, b) => b! - a!);

        expect([...sorted]).toEqual([1, 1, 2, 3, 4, 5, 6, 9]);
        expect([...customSorted]).toEqual([9, 6, 5, 4, 3, 2, 1, 1]);
        expect([...array]).toEqual([3, 1, 4, 1, 5, 9, 2, 6]);
        expect(sorted).toBeInstanceOf(ShareableArray);
        expect(customSorted).toBeInstanceOf(ShareableArray);
    });
});

function generateRandomString() {
    return Math.random().toString(36).substring(7);
}

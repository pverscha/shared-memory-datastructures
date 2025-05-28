export class ShareableArray<T> implements Array<T> {
    [n: number]: T;

    get length(): number {

    }

    concat(...items: ConcatArray<T>[]): T[];
    concat(...items: (ConcatArray<T> | T)[]): T[];
    concat(...items: (ConcatArray<T> | T)[]): T[] {
        return [];
    }

    every<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): this is S[];
    every(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean;
    every(predicate, thisArg?: any): any {
    }

    filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[];
    filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T[];
    filter(predicate, thisArg?: any): any {
    }

    forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void {
    }

    indexOf(searchElement: T, fromIndex?: number): number {
        return 0;
    }

    join(separator?: string): string {
        return "";
    }

    lastIndexOf(searchElement: T, fromIndex?: number): number {
        return 0;
    }

    map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[] {
        return [];
    }

    pop(): T | undefined {
        return undefined;
    }

    push(...items: T[]): number {
        return 0;
    }

    reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
    reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
    reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
    reduce(callbackfn, initialValue?): any {
    }

    reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
    reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
    reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
    reduceRight(callbackfn, initialValue?): any {
    }

    reverse(): T[] {
        return [];
    }

    shift(): T | undefined {
        return undefined;
    }

    slice(start?: number, end?: number): T[] {
        return [];
    }

    some(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean {
        return false;
    }

    sort(compareFn?: (a: T, b: T) => number): this {
        return undefined;
    }

    splice(start: number, deleteCount?: number): T[];
    splice(start: number, deleteCount: number, ...items: T[]): T[];
    splice(start: number, deleteCount?: number, ...items: T[]): T[] {
        return [];
    }

    unshift(...items: T[]): number {
        return 0;
    }

}

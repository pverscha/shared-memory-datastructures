import ShareableArrayOptions from "./ShareableArrayOptions";
import {Serializable} from "../encoding";
import StringEncoder from "../encoding/StringEncoder";
import NumberEncoder from "../encoding/NumberEncoder";
import GeneralPurposeEncoder from "../encoding/GeneralPurposeEncoder";
import {TransferableState} from "../TransferableState";
import TransferableDataStructure from "../TransferableDataStructure";

export class ShareableArray<T> extends TransferableDataStructure {
    // One UInt32 per object that's stored in this array. This size here is expected to be in bytes (so 4 * initial
    // elements size). The index initially supports storage of 256 / 4 = 64 objects.
    private static readonly DEFAULT_INDEX_SIZE = 256;
    // Initial size of the data portion of the array. Is also expected to be reported in bytes.
    private static readonly DEFAULT_DATA_SIZE = 2048;

    // Minimum ratio of (used space / total space) in the data table. This ratio indicates what percentage of the
    // total space should be wasted, before we start to defragment the data table.
    private static readonly MIN_DEFRAG_FACTOR = 0.5;

    // Where do we keep the length of the array?
    private static readonly INDEX_SIZE_OFFSET = 0;
    // Where does the next free portion of space start in the data array?
    private static readonly INDEX_DATA_FREE_START_OFFSET = 4;
    // Where is the total amount of space used in the data buffer stored?
    private static readonly INDEX_TOTAL_USED_SPACE_OFFSET = 8;
    // From what index do we start keeping track of the items in the index?
    private static readonly INDEX_TABLE_OFFSET = 12;
    // How many bytes in the data object are reserved for metadata (value length, used encoder ID).
    private static readonly DATA_OBJECT_OFFSET = 8;

    // Since 1 will never be used as an index in the data table array, we can use it to indicate which values
    // are set to undefined in the array.
    private static readonly UNDEFINED_VALUE_IDENTIFIER = 1;

    private indexMem!: SharedArrayBuffer | ArrayBuffer;
    private dataMem!: SharedArrayBuffer | ArrayBuffer;

    private indexView!: DataView;
    private dataView!: DataView;

    private readonly stringEncoder = new StringEncoder();
    private readonly numberEncoder = new NumberEncoder();
    private readonly generalPurposeEncoder = new GeneralPurposeEncoder();

    private serializer: Serializable<T> | undefined;
    private originalOptions: ShareableArrayOptions<T>;

    private readonly defaultOptions: ShareableArrayOptions<T> = {
        // Empty for now
    };

    constructor(
        options?: ShareableArrayOptions<T>,
        ...items: T[]
    ) {
        super();

        this.originalOptions = {...this.defaultOptions, ...options};
        this.serializer = this.originalOptions?.serializer;

        this.reset();

        if (items) {
            this.push(...items);
        }
    }

    /**
     * Get the internal buffers that represent this array and that can be transferred without cost between threads.
     * Use fromState() to rebuild a ShareableArray after the buffers have been transferred.
     *
     * @returns An object containing the WebAssembly memory buffers that represent this array
     */
    public toTransferableState(): TransferableState {
        return {
            indexBuffer: this.indexMem,
            dataBuffer: this.dataMem,
            dataType: "array"
        };
    }


    /**
     * Creates a new ShareableArray from existing array state. The state should come from another ShareableArray instance
     * created beforehand. This state can be retrieved using `toState()` on that ShareableArray.
     *
     * Note that when the original ShareableArray used a custom serializer, the same type of serializer must also be
     * provided here.
     *
     * @param state Object containing the index and data buffers
     * @param options Configuration options for the array:
     *     - serializer: Optional custom serializer for value types
     * @returns A new ShareableArray instance constructed from the provided state
     */
    public static fromTransferableState<T>(
        {indexBuffer, dataBuffer, dataType}: TransferableState,
        options?: ShareableArrayOptions<T>
    ): ShareableArray<T> {
        if (dataType !== "array") {
            throw new TypeError("Invalid data type! Trying to revive array from non-array state.");
        }

        // Define default options
        const defaultOptions: ShareableArrayOptions<T> = {};

        const array = new ShareableArray<T>({...defaultOptions, ...options});
        array.setBuffers(indexBuffer, dataBuffer);
        return array;
    }

    /**
     * Set the internal buffers that represent this array and that can be transferred without cost between threads.
     *
     * @param indexBuffer Index table buffer that's used to keep track of which values are stored where in the
     * dataBuffer.
     * @param dataBuffer Portion of memory in which all the data itself is stored.
     */
    protected setBuffers(indexBuffer: SharedArrayBuffer | ArrayBuffer, dataBuffer: SharedArrayBuffer | ArrayBuffer) {
        this.indexMem = indexBuffer;
        this.indexView = new DataView(this.indexMem);
        this.dataMem = dataBuffer;
        this.dataView = new DataView(this.dataMem);
    }

    get length(): number {
        return this.indexView.getUint32(ShareableArray.INDEX_SIZE_OFFSET);
    }

    concat(items: (T[] | ShareableArray<T>)): ShareableArray<T> {
        // Copy buffer from this array (such that we don't need to manually copy all the items (and decode / encode them)
        const copyOfIndex = this.allocateMemory(this.indexMem.byteLength);
        const copyOfData = this.allocateMemory(this.dataMem.byteLength);
        new Uint8Array(copyOfIndex).set(new Uint8Array(this.indexMem));
        new Uint8Array(copyOfData).set(new Uint8Array(this.dataMem));

        // Create a new ShareableArray that contains these buffers
        const concatenatedArrays = ShareableArray.fromTransferableState(
            {
                indexBuffer: copyOfIndex,
                dataBuffer: copyOfData,
                dataType: "array"
            },
            this.originalOptions
        );

        // Now, add the items that have been provided to this function to the copied array
        for (const item of items) {
            if (Array.isArray(item)) {
                // If item is array-like (ConcatArray<T>), we need to add each element individually
                for (let i = 0; i < item.length; i++) {
                    concatenatedArrays.push(item[i]);
                }
            } else {
                // Otherwise, just add the single item
                concatenatedArrays.push(item as T);
            }
        }

        return concatenatedArrays;
    }

    every(predicate: (value: T | undefined, index: number, array: ShareableArray<T>) => unknown, thisArg?: any): boolean {
        // Bind the predicate function to thisArg if provided
        const boundPredicate = thisArg !== undefined
            ? predicate.bind(thisArg)
            : predicate;

        // Test each element against the predicate
        for (let i = 0; i < this.length; i++) {
            const value = this.at(i);
            // If the predicate returns a falsy value for any element, return false immediately
            if (!boundPredicate(value, i, this)) {
                return false;
            }
        }

        return true;
    }

    filter(predicate: (value: T | undefined, index: number, array: ShareableArray<T>) => unknown, thisArg?: any): ShareableArray<T> {
        // Bind the predicate function to thisArg if provided
        const boundPredicate = thisArg !== undefined
            ? predicate.bind(thisArg)
            : predicate;

        const outputArray = new ShareableArray(this.originalOptions);

        for (let i = 0; i < this.length; i++) {
            const value = this.at(i);
            if (boundPredicate(value, i, this)) {
                outputArray.push(value);
            }
        }

        return outputArray;
    }

    forEach(callbackfn: (value: T | undefined, index: number, array: ShareableArray<T>) => void, thisArg?: any): void {
        // Bind the predicate function to thisArg if provided
        const boundCallback = thisArg !== undefined
            ? callbackfn.bind(thisArg)
            : callbackfn;

        for (let i = 0; i < this.length; i++) {
            const value = this.at(i);
            boundCallback(value, i, this);
        }
    }

    indexOf(searchElement: T, fromIndex?: number): number {
        if (fromIndex === undefined || fromIndex < -this.length) {
            fromIndex = 0;
        }

        if (-this.length <= fromIndex && fromIndex < 0) {
            fromIndex += this.length;
        }

        if (fromIndex >= this.length) {
            return -1;
        }

        for (let i = fromIndex; i < this.length; i++) {
            if (this.at(i) === searchElement) {
                return i;
            }
        }

        return -1;
    }

    join(separator: string = ","): string {
        let output = "";

        for (let i = 0; i < this.length; i++) {
            output += String(this.at(i));

            if (i !== this.length - 1) {
                output += separator;
            }
        }

        return output;
    }

    lastIndexOf(searchElement: T, fromIndex?: number): number {
        if (fromIndex === undefined || fromIndex >= this.length) {
            fromIndex = this.length - 1;
        }

        if (-this.length <= fromIndex && fromIndex < 0) {
            fromIndex += this.length;
        }

        if (fromIndex < -this.length) {
            return -1;
        }

        for (let i = fromIndex; i >= 0; i--) {
            if (this.at(i) === searchElement) {
                return i;
            }
        }

        return -1;
    }

    map<U>(callbackfn: (value: T, index: number, array: ShareableArray<T>) => U, resultSerializer?: Serializable<U>, thisArg?: any): ShareableArray<U> {
        // Bind the predicate function to thisArg if provided
        const boundCallback = thisArg !== undefined
            ? callbackfn.bind(thisArg)
            : callbackfn;

        const mappedArray = new ShareableArray<U>({serializer: resultSerializer});

        for (let i = 0; i < this.length; i++) {
            mappedArray.push(boundCallback(this.at(i)!, i, this));
        }

        return mappedArray;
    }

    pop(): T | undefined {
        if (this.length <= 0) {
            return undefined;
        }

        const lastItem = this.at(this.length - 1);
        this.deleteItem(this.length - 1);
        return lastItem;
    }

    push(...items: (T | undefined)[]): number {
        let currentIdx = this.length;
        for (const item of items) {
            this.addOrSetItem(currentIdx, item);
            currentIdx++;
        }

        return this.length;
    }

    reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: ShareableArray<T>) => T): T;
    reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: ShareableArray<T>) => T, initialValue: T): T;
    reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: ShareableArray<T>) => U, initialValue: U): U;
    reduce(callbackfn: any, initialValue?: any): any {
        const length = this.length;

        // If array is empty and no initialValue is provided, throw TypeError
        if (length === 0 && initialValue === undefined) {
            throw new TypeError('Reduce of empty array with no initial value');
        }

        let accumulator;
        let startIndex;

        // If initialValue is provided, use it as the accumulator and start from index 0
        if (initialValue !== undefined) {
            accumulator = initialValue;
            startIndex = 0;
        } else {
            // Otherwise, use the first element as the accumulator and start from index 1
            accumulator = this.at(0);
            startIndex = 1;
        }

        // Iterate through the array, applying the callback function
        for (let i = startIndex; i < length; i++) {
            accumulator = callbackfn(accumulator, this.at(i), i, this);
        }

        return accumulator;
    }

    reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: ShareableArray<T>) => T): T;
    reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: ShareableArray<T>) => T, initialValue: T): T;
    reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: ShareableArray<T>) => U, initialValue: U): U;
    reduceRight(callbackfn: any, initialValue?: any): any {
        const length = this.length;

        // If array is empty and no initialValue is provided, throw TypeError
        if (length === 0 && initialValue === undefined) {
            throw new TypeError('Reduce of empty array with no initial value');
        }

        let accumulator;
        let startIndex;

        // If initialValue is provided, use it as the accumulator and start from the last element
        if (initialValue !== undefined) {
            accumulator = initialValue;
            startIndex = length - 1;
        } else {
            // Otherwise, use the last element as the accumulator and start from the second-to-last element
            accumulator = this.at(length - 1);
            startIndex = length - 2;
        }

        // Iterate through the array from right to left, applying the callback function
        for (let i = startIndex; i >= 0; i--) {
            accumulator = callbackfn(accumulator, this.at(i), i, this);
        }

        return accumulator;
    }

    reverse(): ShareableArray<T> {
        // For performance reasons, we only have to reverse the items in the index array
        for (let left = 0, right = this.length - 1; left < right; left++, right--) {
            const temp = this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * left);
            this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * left, this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * right));
            this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * right, temp);
        }

        // Reverse works in-place and should return a reference to itself when it's done.
        return this;
    }

    shift(): T | undefined {
        if (this.length <= 0) {
            return undefined;
        }

        const removedElement = this.at(0);
        this.deleteItem(0);
        return removedElement;
    }

    slice(start?: number, end?: number): ShareableArray<T> {
        const len = this.length;
        const result = new ShareableArray<T>(this.originalOptions);

        // Handle undefined start (default to 0)
        let relativeStart = start === undefined ? 0 : start;

        // Handle negative start (count from end)
        if (relativeStart < 0) {
            relativeStart = Math.max(len + relativeStart, 0);
        } else {
            relativeStart = Math.min(relativeStart, len);
        }

        // Handle undefined end (default to length)
        let relativeEnd = end === undefined ? len : end;

        // Handle negative end (count from end)
        if (relativeEnd < 0) {
            relativeEnd = Math.max(len + relativeEnd, 0);
        } else {
            relativeEnd = Math.min(relativeEnd, len);
        }

        // Calculate number of elements to extract
        const numElements = Math.max(relativeEnd - relativeStart, 0);

        // Extract elements into the new array
        for (let i = 0; i < numElements; i++) {
            const index = relativeStart + i;
            result.push(this.at(index)!);
        }

        return result;
    }

    some(predicate: (value: T | undefined, index: number, array: ShareableArray<T>) => unknown, thisArg?: any): boolean {
        // Bind the predicate function to thisArg if provided
        const boundPredicate = thisArg !== undefined
            ? predicate.bind(thisArg)
            : predicate;

        // Test each element against the predicate
        for (let i = 0; i < this.length; i++) {
            const value = this.at(i)!;
            // If the predicate returns a falsy value for any element, return false immediately
            if (boundPredicate(value, i, this)) {
                return true;
            }
        }

        return false;
    }

    sort(compareFn?: (a: T, b: T) => number): this {
        // TODO: improve efficiency of this implementation.

        // Create a temporary array to sort
        const tempArray: T[] = [...this];

        // Sort the temporary array
        tempArray.sort(compareFn);

        // Update the original array with the sorted values
        for (let i = 0; i < tempArray.length; i++) {
            this.addOrSetItem(i, tempArray[i]);
        }

        return this;
    }

    unshift(...items: T[]): number {
        if (items.length <= 0) {
            return this.length;
        }

        // Check if we've got enough space in the index array to keep track of this new item.
        // Check if we need to allocate more space in the index buffer first.
        // Items in the index table are always 4 bytes long (int's)

        // This needs to be a while loop because it's possible that a lot of items are added through this function and
        // we have to double the index storage more than once.
        while (ShareableArray.INDEX_TABLE_OFFSET + 4 * (this.length + items.length) >= this.indexMem.byteLength) {
            this.doubleIndexStorage();
        }

        // Push all items in the index array the required amount of positions to the right (to make room for the items
        // that should be added now)
        for (let i = this.length - 1; i >= 0; i--) {
            this.indexView.setUint32(
                ShareableArray.INDEX_TABLE_OFFSET + 4 * (i + items.length),
                this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * i)
            );
        }

        // Store undefined at the first positions (temporarily)
        for (let i = 0; i < items.length; i++) {
            this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * i, ShareableArray.UNDEFINED_VALUE_IDENTIFIER);
        }

        // Increase the size of the array
        const currentSize = this.indexView.getUint32(ShareableArray.INDEX_SIZE_OFFSET);
        this.indexView.setUint32(ShareableArray.INDEX_SIZE_OFFSET, currentSize + items.length);

        // Overwrite the undefined values with the actual values using the `addOrSetItem` function
        for (let i = 0; i < items.length; i++) {
            this.addOrSetItem(i, items[i]);
        }

        return this.length;
    }

    readonly [Symbol.unscopables]: {
        [K in number | typeof Symbol.iterator | typeof Symbol.unscopables | "length" | "toString" | "toLocaleString" | "pop" | "push" | "concat" | "join" | "reverse" | "shift" | "slice" | "sort" | "splice" | "unshift" | "indexOf" | "lastIndexOf" | "every" | "some" | "forEach" | "map" | "filter" | "reduce" | "reduceRight" | "find" | "findIndex" | "fill" | "copyWithin" | "entries" | "keys" | "values" | "includes" | "flatMap" | "flat" | "at" | "findLast" | "findLastIndex" | "toReversed" | "toSorted" | "toSpliced" | "with"]?: boolean
    } = {
        length: true,
        toString: true,
        toLocaleString: true,
        pop: true,
        push: true,
        concat: true,
        join: true,
        reverse: true,
        shift: true,
        slice: true,
        sort: true,
        splice: true,
        unshift: true,
        indexOf: true,
        lastIndexOf: true,
        every: true,
        some: true,
        forEach: true,
        map: true,
        filter: true,
        reduce: true,
        reduceRight: true,
        find: true,
        findIndex: true,
        fill: true,
        copyWithin: true,
        entries: true,
        keys: true,
        values: true,
        includes: true,
        flatMap: true,
        flat: true,
        at: true,
        findLast: true,
        findLastIndex: true,
        toReversed: true,
        toSorted: true,
        toSpliced: true,
        with: true,
        [Symbol.iterator]: true,
        [Symbol.unscopables]: true
    };

    * [Symbol.iterator](): ArrayIterator<T> {
        for (let currentIdx = 0; currentIdx < this.length; currentIdx++) {
            yield this.readItem(currentIdx)!;
        }
    }

    set(index: number, value: T | undefined): void {
        this.addOrSetItem(index, value);
    }

    at(index: number): T | undefined {
        return this.readItem(index);
    }

    * entries(): ArrayIterator<[number, T | undefined]> {
        for (let currentIdx = 0; currentIdx < this.length; currentIdx++) {
            const value = this.readItem(currentIdx)!;
            yield [currentIdx, value];
        }
    }

    fill(value: T, start?: number, end?: number): this {
        const size = this.length;
        let actualStart;
        if (start === undefined) {
            actualStart = 0;
        } else if (start < 0) {
            actualStart = Math.max(size + start, 0);
        } else {
            actualStart = Math.min(start, size);
        }

        let actualEnd;
        if (end === undefined) {
            actualEnd = size;
        } else if (end < 0) {
            actualEnd = Math.max(size + end, 0);
        } else {
            actualEnd = Math.min(end, size);
        }

        for (let i = actualStart; i < actualEnd; i++) {
            this.addOrSetItem(i, value);
        }
    
        return this;
    }

    find<S extends T>(predicate: { (value: T, index: number, obj: T[]): boolean }, thisArg?: any): S | undefined;
    find(predicate: { (value: T, index: number, obj: T[]): unknown }, thisArg?: any): T | undefined;
    find(predicate: { (value: T, index: number, obj: T[]): boolean } | {
        (value: T, index: number, obj: T[]): unknown
    }, thisArg?: any): any {
        // Bind the predicate function to thisArg if provided
        const boundPredicate = thisArg !== undefined
            ? predicate.bind(thisArg)
            : predicate;

        // Test each element against the predicate
        for (let i = 0; i < this.length; i++) {
            const value = this.at(i);
            if (value !== undefined && boundPredicate(value, i, Array.from(this))) {
                return value;
            }
        }
        
        return undefined;
    }

    findIndex(predicate: { (value: T, index: number, obj: T[]): unknown }, thisArg?: any): number {
        // Bind the predicate function to thisArg if provided
        const boundPredicate = thisArg !== undefined
            ? predicate.bind(thisArg)
            : predicate;

        // Test each element against the predicate
        for (let i = 0; i < this.length; i++) {
            const value = this.at(i);
            if (value !== undefined && boundPredicate(value, i, Array.from(this))) {
                return i;
            }
        }

        return -1;
    }

    findLast<S extends T>(predicate: { (value: T, index: number, array: T[]): boolean }, thisArg?: any): S | undefined;
    findLast(predicate: { (value: T, index: number, array: T[]): unknown }, thisArg?: any): T | undefined;
    findLast(predicate: { (value: T, index: number, array: T[]): boolean } | {
        (value: T, index: number, array: T[]): unknown
    }, thisArg?: any): any {
        // Bind the predicate function to thisArg if provided
        const boundPredicate = thisArg !== undefined
            ? predicate.bind(thisArg)
            : predicate;

        // Test each element against the predicate
        for (let i = this.length; i >= 0; i--) {
            const value = this.at(i);
            if (value !== undefined && boundPredicate(value, i, Array.from(this))) {
                return value;
            }
        }

        return undefined;
    }

    findLastIndex(predicate: { (value: T, index: number, array: T[]): unknown }, thisArg?: any): number {
        // Bind the predicate function to thisArg if provided
        const boundPredicate = thisArg !== undefined
            ? predicate.bind(thisArg)
            : predicate;

        // Test each element against the predicate
        for (let i = this.length; i >= 0; i--) {
            const value = this.at(i);
            if (value !== undefined && boundPredicate(value, i, Array.from(this))) {
                return i;
            }
        }

        return -1;
    }

    flatMap<U, This = undefined>(callback: {
        (value: T, index: number, array: T[]): (U | readonly U[])
    }, thisArg?: This): ShareableArray<U> {
        // Bind the callback function to thisArg if provided
        const boundCallback = thisArg !== undefined
            ? callback.bind(thisArg)
            : callback;

        const result: ShareableArray<U> = new ShareableArray<U>();

        // Iterate through array, apply callback and flatten results
        for (let i = 0; i < this.length; i++) {
            const value = this.at(i);
            if (value !== undefined) {
                const callbackResult = boundCallback(value, i, Array.from(this));
                if (Array.isArray(callbackResult)) {
                    result.push(...callbackResult);
                } else {
                    result.push(callbackResult as U);
                }
            }
        }

        return result;
    }

    includes(searchElement: T, fromIndex?: number): boolean {
        const len = this.length;
        let k = fromIndex || 0;

        // Handle negative fromIndex
        if (k < 0) {
            k = Math.max(len + k, 0);
        }

        // Check each element
        for (let i = k; i < len; i++) {
            const element = this.at(i);
            if (element === searchElement) {
                return true;
            }
        }
        return false;
    }

    * keys(): ArrayIterator<number> {
        let index = 0;
        const length = this.length;

        for (let i = 0; i < length; i++) {
            yield i;
        }
    }

    toReversed(): ShareableArray<T> {
        const result: ShareableArray<T> = new ShareableArray<T>(this.originalOptions);
        for (let i = this.length - 1; i >= 0; i--) {
            result.push(this.at(i)!);
        }
        return result;
    }

    toSorted(compareFn?: { (a: T, b: T): number }): ShareableArray<T> {
        const arr = new ShareableArray<T>(this.originalOptions);
        arr.push(...this);
        arr.sort(compareFn);
        return arr;
    }

    * values(): ArrayIterator<T> {
        for (let i = 0; i < this.length; i++) {
            yield this.readItem(i)!;
        }
    }

    toString(): string {
        return `ShareableArray(${this.length}) [${this.join(', ')}]`;
    }

    /**
     * At what position in the data-array does the next block of free space start? This position is returned as number
     * of bytes since the start of the array.
     */
    private get freeStart() {
        // At what position in the data table does the free space start?
        return this.indexView.getUint32(ShareableArray.INDEX_DATA_FREE_START_OFFSET);
    }

    private set freeStart(position: number) {
        this.indexView.setUint32(ShareableArray.INDEX_DATA_FREE_START_OFFSET, position);
    }

    private getEncoder(value: T): [Serializable<any>, number] {
        if (this.serializer) {
            return [this.serializer, 3];
        } else {
            if (typeof value === "number") {
                return [this.numberEncoder, 0];
            } else if (typeof value === "string") {
                return [this.stringEncoder, 1];
            } else {
                return [this.generalPurposeEncoder, 2];
            }
        }
    }

    private getEncoderById(id: number): Serializable<any> {
        return ([this.numberEncoder, this.stringEncoder, this.generalPurposeEncoder, this.serializer] as Serializable<any>[])[id];
    }

    private addOrSetItem(index: number, item: T | undefined) {
        // Check if we need to allocate more space in the index buffer first.
        // Items in the index table are always 4 bytes long (int's)
        if (ShareableArray.INDEX_TABLE_OFFSET + 4 * index >= this.indexMem.byteLength) {
            this.doubleIndexStorage();
        }

        if (index < this.length) {
            // There is already an item at this position in the array, we have to remove the value currently present
            // there and then update it with the new item we want to add.
            this.deleteItem(index);
        }

        if (item === undefined) {
            // We keep track of undefined values in the array by storing a zero at their position in the index buffer.
            this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * index, ShareableArray.UNDEFINED_VALUE_IDENTIFIER);

            // We don't have to update the space used in the data array, since this is not increasing by an undefined
            // value.
        } else {
            // Then, check if we need to allocate more space in the data buffer
            const [valueEncoder, valueEncoderId] = this.getEncoder(item);

            const maxValueLength = valueEncoder.maximumLength(item);

            const dataStart = this.indexView.getUint32(ShareableArray.INDEX_DATA_FREE_START_OFFSET);
            if (dataStart + (maxValueLength + ShareableArray.DATA_OBJECT_OFFSET) >= this.dataMem.byteLength) {
                // We don't have enough space left at the end of the data array. We should now consider if we should just
                // perform a defragmentation of the data array, or if we need to double the size of the array.
                const defragRatio = this.indexView.getUint32(ShareableArray.INDEX_TOTAL_USED_SPACE_OFFSET) / this.dataView.byteLength;

                if (
                    defragRatio < ShareableArray.MIN_DEFRAG_FACTOR &&
                    this.indexView.getUint32(ShareableArray.INDEX_TOTAL_USED_SPACE_OFFSET) + maxValueLength + ShareableArray.DATA_OBJECT_OFFSET < this.dataView.byteLength
                ) {
                    this.defragment();
                } else {
                    this.doubleDataStorage();
                }
            }

            // Now, encode this value into the data storage
            const exactValueLength = valueEncoder.encode(
                item,
                new Uint8Array(
                    this.dataMem,
                    this.freeStart + ShareableArray.DATA_OBJECT_OFFSET,
                    maxValueLength
                ),
            );

            // Keep track of the type of encoder that was used to store the values in the data array
            this.dataView.setUint32(this.freeStart, valueEncoderId);
            // Keep track of the exact length in bytes for this value object.
            this.dataView.setUint32(this.freeStart + 4, exactValueLength);

            // Check if the item we're trying to add is at the end of the array or not
            if (index === this.length) {
                // Set pointer in index array to the last position.
                this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * index, this.freeStart);
            } else {
                // Shift all items in the array to the right to make space for the new item
                const currentLength = this.length;
                for (let i = currentLength; i > index; i--) {
                    this.indexView.setUint32(
                        ShareableArray.INDEX_TABLE_OFFSET + 4 * i,
                        this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * (i - 1))
                    );
                }
                // Set the new item's position in the index array
                this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * index, this.freeStart);
            }

            // Increase the space used in the data array
            const usedSpace = this.indexView.getUint32(ShareableArray.INDEX_TOTAL_USED_SPACE_OFFSET);
            this.indexView.setUint32(ShareableArray.INDEX_TOTAL_USED_SPACE_OFFSET, usedSpace + exactValueLength + ShareableArray.DATA_OBJECT_OFFSET);

            // Finally, update the pointer to the next block of available space in the data array
            this.freeStart += exactValueLength + ShareableArray.DATA_OBJECT_OFFSET;
        }


        // Increase the size of the array
        const previousSize = this.indexView.getUint32(ShareableArray.INDEX_SIZE_OFFSET);
        this.indexView.setUint32(ShareableArray.INDEX_SIZE_OFFSET, previousSize + 1);
    }

    private readItem(index: number): T | undefined {
        const size = this.indexView.getUint32(ShareableArray.INDEX_SIZE_OFFSET);
        if (index < 0 || index >= size) {
            return undefined;
        }

        // Retrieve the position in the data array where this object is stored
        const dataPos = this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * index);

        if (dataPos === ShareableArray.UNDEFINED_VALUE_IDENTIFIER) {
            return undefined;
        }

        const valueEncoderId = this.dataView.getUint32(dataPos);
        const valueLength = this.dataView.getUint32(dataPos + 4);

        // Find the correct value encoder and decode the value at the requested position in the data array
        const encoder = this.getEncoderById(valueEncoderId);

        // Copy from shared memory to a temporary private buffer (since we cannot directly decode from shared memory)
        const sourceView = new Uint8Array(this.dataView.buffer, dataPos + ShareableArray.DATA_OBJECT_OFFSET, valueLength);

        const targetView = new Uint8Array(this.getFittingDecoderBuffer(valueLength), 0, valueLength);
        targetView.set(sourceView);


        return encoder.decode(targetView);
    }

    private deleteItem(index: number): void {
        const dataPos = this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * index);

        // Move the items in the index array that follow the removed index forward (such that the hole in the
        // index array is removed)
        for (let i = index; i < this.length; i++) {
            this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * i, this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * (i + 1)));
        }

        if (dataPos !== ShareableArray.UNDEFINED_VALUE_IDENTIFIER) {
            const valueLength = this.dataView.getUint32(dataPos + 4);

            // Free the space that was taken by the deleted item. It is not yet erased from memory, that will be
            // performed by a potential defragmentation task in the future
            const currentlyUsedSpace = this.indexView.getUint32(ShareableArray.INDEX_TOTAL_USED_SPACE_OFFSET);
            this.indexView.setUint32(ShareableArray.INDEX_TOTAL_USED_SPACE_OFFSET, currentlyUsedSpace - (valueLength + ShareableArray.DATA_OBJECT_OFFSET));
        }

        const previousSize = this.indexView.getUint32(ShareableArray.INDEX_SIZE_OFFSET);
        this.indexView.setUint32(ShareableArray.INDEX_SIZE_OFFSET, previousSize - 1);
    }

    private doubleIndexStorage() {
        const newIndexMem = this.allocateMemory(this.indexMem.byteLength * 2);
        const newIndexArray = new Uint8Array(newIndexMem);

        // Copy data from old index to new index
        newIndexArray.set(new Uint8Array(this.indexMem));

        this.indexMem = newIndexMem;
        this.indexView = new DataView(this.indexMem);
    }

    private doubleDataStorage() {
        const newDataMem = this.allocateMemory(this.dataMem.byteLength * 2);
        const newDataArray = new Uint8Array(newDataMem);

        // Copy data from old data buffer to new buffer
        newDataArray.set(new Uint8Array(this.dataMem));

        this.dataMem = newDataMem;
        this.dataView = new DataView(this.dataMem);
    }

    /**
     * Iterate over all objects in the index buffer and reposition them in the data buffer. All objects should be stored
     * contiguous in the data buffer. This is an expensive operation that involves allocating a new collection of bytes,
     * copying and moving data around and releasing this block again from memory.
     */
    private defragment() {
        const newData: ArrayBuffer = new ArrayBuffer(this.dataView.byteLength);
        const newView = new DataView(newData);

        let currentDataStart = 0;

        // Loop over all items that are currently stored in the array (by looking at what's in the index table)
        // and position them all directly following each other
        for (let i = 0; i < this.length; i++) {
            const currentDataPos = this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * i);
            const currentObjectLength = this.dataView.getUint32(currentDataPos + 4) + ShareableArray.DATA_OBJECT_OFFSET;

            // Copy all bytes to the new array
            for (let i = 0; i < currentObjectLength; i++) {
                newView.setUint8(currentDataStart + i, this.dataView.getUint8(currentDataPos + i));
            }

            // Update the position where this is stored in the index array
            this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * i, currentDataStart);

            // Update the starting position in the new defragmented array
            currentDataStart += currentObjectLength + ShareableArray.DATA_OBJECT_OFFSET;
        }

        // Replace the data from the old data array with the data in the array
        const oldArray = new Uint8Array(this.dataMem);
        oldArray.set(new Uint8Array(newData));

        // Update where the free space in the data array starts again
        this.freeStart = currentDataStart;
    }

    private reset() {
        this.indexMem = this.allocateMemory(ShareableArray.DEFAULT_INDEX_SIZE);
        this.indexView = new DataView(this.indexMem);

        this.dataMem = this.allocateMemory(ShareableArray.DEFAULT_DATA_SIZE);
        this.dataView = new DataView(this.dataMem);
    }
}

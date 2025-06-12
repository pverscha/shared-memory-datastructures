import ShareableArrayOptions from "./ShareableArrayOptions";
import {Serializable} from "../encoding";
import StringEncoder from "../encoding/StringEncoder";
import NumberEncoder from "../encoding/NumberEncoder";
import GeneralPurposeEncoder from "../encoding/GeneralPurposeEncoder";
import {TransferableState} from "../TransferableState";

export class ShareableArray<T> {
    // One UInt32 per object that's stored in this array. This size here is expected to be in bytes (so 4 * initial
    // elements size). The index initially supports storage of 256 / 4 = 64 objects.
    private static readonly DEFAULT_INDEX_SIZE = 256;
    // Initial size of the data portion of the array. Is also expected to be reported in bytes.
    private static readonly DEFAULT_DATA_SIZE = 2048;

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

    // Default size of the decoder buffer that's always reused (in bytes)
    private static readonly DECODER_BUFFER_SIZE = 16384;

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

    // This buffer can be reused to decode the keys of each pair in the map (and avoids us having to reallocate a new
    // block of memory for each `get` or `set` operation).
    private decoderBuffer: ArrayBuffer = new ArrayBuffer(ShareableArray.DECODER_BUFFER_SIZE);
    private currentDecoderBufferSize: number = ShareableArray.DECODER_BUFFER_SIZE;

    private readonly defaultOptions: ShareableArrayOptions<T> = {
        // Empty for now
    };

    constructor(
        options?: ShareableArrayOptions<T>,
        ...items: T[]
    ) {
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
            this.addItem(currentIdx, item);
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
            // Only call the callback for indexes that exist in the array
            if (i in this) {
                accumulator = callbackfn(accumulator, this.at(i), i, this);
            }
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
            // Only call the callback for indexes that exist in the array
            if (i in this) {
                accumulator = callbackfn(accumulator, this.at(i), i, this);
            }
        }

        return accumulator;
    }

    reverse(): ShareableArray<T> {
        const reversed = new ShareableArray(this.originalOptions);
        for (let i = this.length - 1; i >= 0; i--) {
            reversed.push(this.at(i)!)
        }
        return reversed;
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
            // Delete the original item and add the sorted item
            this.deleteItem(i);
            this.addItem(i, tempArray[i]);
        }

        return this;
    }

    // unshift(...items: T[]): number {
    //     // Add items to the front of the array
    //
    //     if (items.length <= 0) {
    //         return this.length;
    //     }
    //
    //     const [encoder, encoderId] = this.getEncoder(items[0]);
    //
    //     const estimatedRequiredSpace = items.reduce((acc, i) => acc + encoder.maximumLength(i), 0);
    //
    //     // First encode all of the objects that should be added into a temporary buffer.
    //     const tempBuffer = new ArrayBuffer(estimatedRequiredSpace);
    //     let totalExactSpace = 0;
    //
    //     // Also keep track of where these items start in the temp buffer (this information is required to reconstruct the index array further down-the-road).
    //     const startPositionsNewItems = [];
    //     for (const item of items) {
    //         startPositionsNewItems.push(totalExactSpace);
    //         const encoderArray = new Uint8Array(tempBuffer, totalExactSpace + ShareableArray.DATA_OBJECT_OFFSET, encoder.maximumLength(item));
    //         const exactSpaceForObject = encoder.encode(item, encoderArray);
    //         totalExactSpace += (ShareableArray.DATA_OBJECT_OFFSET + exactSpaceForObject);
    //     }
    //
    //     // Now that we've got this information, we should move the pre-existing data in the data array to the end of the array.
    //     // TODO: continue implementation here
    //
    //     return 0;
    // }

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

    at(index: number): T | undefined {
        return this.readItem(index);
    }

    * entries(): ArrayIterator<[number, T | undefined]> {
        for (let currentIdx = 0; currentIdx < this.length; currentIdx++) {
            const value = this.readItem(currentIdx)!;
            yield [currentIdx, value];
        }
    }

    // fill(value: T, start?: number, end?: number): this {
    // }
    //
    // find<S extends T>(predicate: { (value: T, index: number, obj: T[]): boolean }, thisArg?: any): S | undefined;
    // find(predicate: { (value: T, index: number, obj: T[]): unknown }, thisArg?: any): T | undefined;
    // find(predicate: { (value: T, index: number, obj: T[]): boolean } | {
    //     (value: T, index: number, obj: T[]): unknown
    // }, thisArg?: any): any {
    // }
    //
    // findIndex(predicate: { (value: T, index: number, obj: T[]): unknown }, thisArg?: any): number {
    //     return 0;
    // }
    //
    // findLast<S extends T>(predicate: { (value: T, index: number, array: T[]): boolean }, thisArg?: any): S | undefined;
    // findLast(predicate: { (value: T, index: number, array: T[]): unknown }, thisArg?: any): T | undefined;
    // findLast(predicate: { (value: T, index: number, array: T[]): boolean } | {
    //     (value: T, index: number, array: T[]): unknown
    // }, thisArg?: any): any {
    // }
    //
    // findLastIndex(predicate: { (value: T, index: number, array: T[]): unknown }, thisArg?: any): number {
    //     return 0;
    // }
    //
    // flat<A, D = 1 extends number>(depth?: D): any {
    // }
    //
    // flatMap<U, This = undefined>(callback: {
    //     (value: T, index: number, array: T[]): (U | readonly U[])
    // }, thisArg?: This): U[] {
    //     return undefined;
    // }
    //
    // includes(searchElement: T, fromIndex?: number): boolean {
    //     return false;
    // }
    //
    // keys(): ArrayIterator<number> {
    //     return undefined;
    // }
    //
    // toReversed(): T[] {
    //     return undefined;
    // }
    //
    // toSorted(compareFn?: { (a: T, b: T): number }): T[] {
    //     return undefined;
    // }
    //
    // toSpliced(start: number, deleteCount: number, ...items: T[]): T[];
    // toSpliced(start: number, deleteCount?: number): T[];
    // toSpliced(start: number, deleteCount?: number, ...items: T[]): T[] {
    //     return undefined;
    // }
    //
    // values(): ArrayIterator<T> {
    //     return undefined;
    // }
    //
    // with(index: number, value: T): T[] {
    //     return undefined;
    // }

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

    private getFittingDecoderBuffer(minimumSize: number): ArrayBuffer {
        if (this.currentDecoderBufferSize < minimumSize) {
            const nextPowerOfTwo = 2 ** Math.ceil(Math.log2(minimumSize));
            this.decoderBuffer = new ArrayBuffer(nextPowerOfTwo);
            this.currentDecoderBufferSize = nextPowerOfTwo;
        }

        return this.decoderBuffer;
    }

    private addItem(index: number, item: T | undefined) {
        // Check if we need to allocate more space in the index buffer first.
        // Items in the index table are always 4 bytes long (int's)
        if (ShareableArray.INDEX_TABLE_OFFSET + 4 * index >= this.indexMem.byteLength) {
            this.doubleIndexStorage();
        }

        if (item === undefined) {
            // We keep track of undefined values in the array by storing a zero at their position in the index buffer.
            this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * index, ShareableArray.UNDEFINED_VALUE_IDENTIFIER);
        } else {
            // Then, check if we need to allocate more space in the data buffer
            const [valueEncoder, valueEncoderId] = this.getEncoder(item);

            const maxValueLength = valueEncoder.maximumLength(item);

            const dataStart = this.indexView.getUint32(ShareableArray.INDEX_DATA_FREE_START_OFFSET);
            if (dataStart + (maxValueLength + ShareableArray.DATA_OBJECT_OFFSET) >= this.dataMem.byteLength) {
                this.doubleDataStorage();
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

            // Set pointer in index array to the last position.
            this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * index, this.freeStart);

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

        if (dataPos !== 0) {
            const valueEncoderId = this.dataView.getUint32(dataPos);
            const valueLength = this.dataView.getUint32(dataPos + 4);

            // Check if this is the last item in the data space
            if (index === this.length - 1) {
                // Simply free this part of memory
                this.freeStart -= (valueLength + ShareableArray.DATA_OBJECT_OFFSET);
            } else {
                // Since the object is situated in the middle of the array, we need to shift all data that's coming
                // after this object (in both the index and data buffers).

                const dataPointer = this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * index);
                const deletedObjectSize = valueLength + ShareableArray.DATA_OBJECT_OFFSET;

                // Move all bytes starting from the next encoded block forward in the data array
                for (let i = dataPointer + deletedObjectSize; i < this.dataMem.byteLength - 4; i += 4) {
                    this.dataView.setUint32(i - deletedObjectSize, this.dataView.getUint32(i + 4));
                }

                for (let i = index + 1; i < this.length - 1; i++) {
                    // Move the next 4 bytes into the previous 4 bytes of the index array
                    this.indexView.setUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * (i - 1), this.indexView.getUint32(ShareableArray.INDEX_TABLE_OFFSET + 4 * i));
                }
            }
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

    private reset() {
        this.indexMem = this.allocateMemory(ShareableArray.DEFAULT_INDEX_SIZE);
        this.indexView = new DataView(this.indexMem);

        this.dataMem = this.allocateMemory(ShareableArray.DEFAULT_DATA_SIZE);
        this.dataView = new DataView(this.dataMem);
    }

    private allocateMemory(byteSize: number): SharedArrayBuffer | ArrayBuffer {
        try {
            return new SharedArrayBuffer(byteSize);
        } catch (err) {
            try {
                // Fallback to non-shared memory
                console.warn("Shared memory is not supported by this browser. Falling back to non-shared memory.");
                return new ArrayBuffer(byteSize);
            } catch (e) {
                throw new Error(`Could not allocated memory. Tried to allocate ${byteSize} bytes.`);
            }
        }
    }
}

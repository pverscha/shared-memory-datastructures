import { fast1a32 } from "fnv-plus";
import Serializable from "./../encoding/Serializable";
import StringEncoder from "./../encoding/StringEncoder";
import NumberEncoder from "./../encoding/NumberEncoder";
import GeneralPurposeEncoder from "./../encoding/GeneralPurposeEncoder";
import ShareableMapOptions from "./ShareableMapOptions";
import {TransferableState} from "./TransferableState";

export class ShareableMap<K, V> {
    // The default load factor to which this map should adhere
    private static readonly LOAD_FACTOR = 0.75;
    // Minimum ratio of (used space / total space) in the data table. This ratio indicates what percentage of the
    // total space should be wasted, before we start to defragment the data table.
    private static readonly MIN_DEFRAG_FACTOR = 0.5;
    // How many bytes does one int use? (32 bits at this point)
    private static readonly INT_SIZE = 4;
    // We never use 0 as a valid index value, and thus this number is used to identify free space / unused blocks.
    private static readonly INVALID_VALUE = 0;
    // The first byte in the data array is never used
    private static readonly INITIAL_DATA_OFFSET = 4;
    // How many bytes for a data object are reserved for metadata? (e.g. pointer to next block, key length,
    // value length).
    private static readonly DATA_OBJECT_OFFSET = 20;
    private static readonly INDEX_TABLE_OFFSET = 24;

    // Offsets for the different metadata entries that are kept in the index table.
    private static readonly INDEX_SIZE_OFFSET = 0;
    private static readonly INDEX_USED_BUCKETS_OFFSET = 4;
    private static readonly INDEX_FREE_START_INDEX_OFFSET = 8;
    // Which position in the index array is used to check if the map is locked by other threads (=> UInt32)
    private static readonly INDEX_LOCK_OFFSET = 12;
    private static readonly INDEX_TOTAL_USED_SPACE_OFFSET = 16;
    // Which position in the index array is used to count the amount of held read locks (=> UInt32)
    private static readonly INDEX_READ_COUNT_OFFSET = 20;

    // Default size of the decoder buffer that's always reused (in bytes)
    private static readonly DECODER_BUFFER_SIZE = 16384;

    /**
     * Lock states for the ShareableMap
     */
    private static readonly LOCK_STATE = {
        UNLOCKED: 0,      // No locks held
        WRITE_LOCKED: 1,  // Exclusive write lock
        READ_LOCKED: 2    // One or more read locks
    };


    private indexMem!: SharedArrayBuffer | ArrayBuffer;
    private dataMem!: SharedArrayBuffer | ArrayBuffer;

    private indexView!: DataView;
    private dataView!: DataView;

    // This buffer can be reused to decode the keys of each pair in the map (and avoids us having to reallocate a new
    // block of memory for each `get` or `set` operation).
    private decoderBuffer: ArrayBuffer = new ArrayBuffer(ShareableMap.DECODER_BUFFER_SIZE);
    private currentDecoderBufferSize: number = ShareableMap.DECODER_BUFFER_SIZE;

    private textDecoder: TextDecoder = new TextDecoder();

    private readonly stringEncoder = new StringEncoder();
    private readonly numberEncoder = new NumberEncoder();
    private readonly generalPurposeEncoder = new GeneralPurposeEncoder();

    private serializer: Serializable<V> | undefined;
    private originalOptions: ShareableMapOptions<V>;

    private readonly defaultOptions: ShareableMapOptions<V> = {
        expectedSize: 1024,
        averageBytesPerValue: 256
    };

    /**
     * Construct a new ShareableMap.
     *
     * This map implementation uses ArrayBuffers internally for data storage, allowing efficient
     * transfer between threads with zero-copy cost. When SharedArrayBuffer is not supported,
     * it falls back to regular ArrayBuffers.
     *
     * @param options Configuration options for the map:
     *     - expectedSize: Expected number of elements to be stored (default: 1024)
     *     - averageBytesPerValue: Expected average size in bytes per value (default: 256)
     *     - serializer: Optional custom serializer for value types
     */
    constructor(
        options?: ShareableMapOptions<V>,
    ) {
        this.originalOptions = {...this.defaultOptions, ...options};

        this.serializer = this.originalOptions?.serializer;

        this.reset(
            this.originalOptions.expectedSize!,
            this.originalOptions.averageBytesPerValue!
        );

        this.initializeLockState();
    }

    /**
     * Creates a new ShareableMap from existing map state. The state should come from another ShareableMap instance
     * created beforehand. This state can be retrieved using `toState()` on that ShareableMap.
     *
     * Note that when the original ShareableMap used a custom serializer, the same type of serializer must also be
     * provided here.
     *
     * @param state Object containing the index and data buffers
     * @param options Configuration options for the map:
     *     - expectedSize: Expected number of elements to be stored (default: 1024)
     *     - averageBytesPerValue: Expected average size in bytes per value (default: 256)
     *     - serializer: Optional custom serializer for value types
     * @returns A new ShareableMap instance constructed from the provided state
     */
    public static fromTransferableState<K, V>(
        {indexBuffer, dataBuffer, dataType}: TransferableState,
        options?: ShareableMapOptions<V>
    ): ShareableMap<K, V> {
        if (dataType !== "map") {
            throw new TypeError("Invalid data type! Trying to revive map from non-map state.");
        }

        // Define default options
        const defaultOptions: ShareableMapOptions<V> = {
            expectedSize: 0,
            averageBytesPerValue: 0
        };

        const map = new ShareableMap<K, V>({...defaultOptions, ...options});
        map.setBuffers(indexBuffer, dataBuffer);
        return map;
    }

    /**
     * Get the internal buffers that represent this map and that can be transferred without cost between threads.
     * Use fromState() to rebuild a ShareableMap after the buffers have been transferred.
     *
     * @returns An object containing the WebAssembly memory buffers that represent this map
     */
    public toTransferableState(): TransferableState {
        return {
            indexBuffer: this.indexMem,
            dataBuffer: this.dataMem,
            dataType: "map"
        };
    }

    /**
     * Set the internal buffers that represent this map and that can be transferred without cost between threads.
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

    [Symbol.iterator](): MapIterator<[K, V]> {
        return this.entries();
    }

    * entries(): MapIterator<[K, V]> {
        for (let i = 0; i < this.buckets; i++) {
            let dataPointer = this.indexView.getUint32(ShareableMap.INDEX_TABLE_OFFSET + i * ShareableMap.INT_SIZE);
            while (dataPointer !== 0) {
                const key = this.readTypedKeyFromDataObject(dataPointer);
                const value = this.readValueFromDataObject(dataPointer);
                yield [key, value];
                dataPointer = this.dataView.getUint32(dataPointer);
            }
        }
    }

    * keys(): MapIterator<K> {
        for (let i = 0; i < this.buckets; i++) {
            let dataPointer = this.indexView.getUint32(ShareableMap.INDEX_TABLE_OFFSET + i * ShareableMap.INT_SIZE);
            while (dataPointer !== 0) {
                yield this.readTypedKeyFromDataObject(dataPointer);
                dataPointer = this.dataView.getUint32(dataPointer);
            }
        }
    }

    * values(): MapIterator<V> {
        for (let i = 0; i < this.buckets; i++) {
            let dataPointer = this.indexView.getUint32(ShareableMap.INDEX_TABLE_OFFSET + i * 4);
            while (dataPointer !== 0) {
                yield this.readValueFromDataObject(dataPointer);
                dataPointer = this.dataView.getUint32(dataPointer);
            }
        }
    }

    clear(): void {
        this.acquireWriteLock();
        // Reset the index buffer. We do not need to erase the data buffer since it will simply be marked as "free space"
        // by the index (and will be overwritten eventually anyways).
        for (let i = ShareableMap.INDEX_TABLE_OFFSET; i < this.indexView.byteLength; i += ShareableMap.INT_SIZE) {
            this.indexView.setUint32(i, 0);
        }

        // Also reset the settings that are stored in the index table
        this.indexView.setUint32(ShareableMap.INDEX_USED_BUCKETS_OFFSET, 0);
        this.indexView.setUint32(ShareableMap.INDEX_SIZE_OFFSET, 0);
        this.indexView.setUint32(ShareableMap.INDEX_TOTAL_USED_SPACE_OFFSET, 0);
        this.indexView.setUint32(ShareableMap.INDEX_FREE_START_INDEX_OFFSET, 0);

        this.releaseWriteLock();
    }

    delete(key: K): boolean {
        this.acquireWriteLock();
        const deleteResult = this.deleteItem(key);
        this.releaseWriteLock();
        return deleteResult
    }

    private deleteItem(key: K): boolean {
        const stringKey = this.stringifyElement<K>(key);
        const [hash, bucket] = this.computeHashAndBucket(stringKey);

        const bucketLink = this.indexView.getUint32(bucket + ShareableMap.INDEX_TABLE_OFFSET);
        const returnValue = this.findValue(bucketLink, stringKey, hash);

        if (!returnValue) {
            // The value that should be deleted was not found, and thus cannot be deleted.
            return false;
        }

        const [startPos, value] = returnValue;
        const keyLength = this.dataView.getUint32(startPos + 4);
        const valueLength = this.dataView.getUint32(startPos + 8);

        // Remove value from IndexArray
        const nextBlock = this.dataView.getUint32(startPos);
        // First check if the block that the bucket directly points to is already the block we are looking for
        if (bucketLink === startPos) {
            this.indexView.setUint32(bucket + ShareableMap.INDEX_TABLE_OFFSET, nextBlock);
        } else {
            let previousBlock = bucketLink;
            let currentBlock = this.dataView.getUint32(bucketLink);
            while (this.dataView.getUint32(currentBlock + 16) !== hash) {
                previousBlock = currentBlock;
                currentBlock = this.dataView.getUint32(currentBlock);
            }
            this.dataView.setUint32(previousBlock, nextBlock);
        }

        this.spaceUsedInDataPartition -= (ShareableMap.DATA_OBJECT_OFFSET + keyLength + valueLength);

        // One element has been removed from the map, thus we need to decrease the size of the map.
        this.decreaseSize();

        return true;
    }

    forEach(callbackfn: (value: V, key: K, map: ShareableMap<K, V>) => void, thisArg?: any): void {
        this.acquireReadLock();

        const boundCallback = thisArg !== undefined ? callbackfn.bind(thisArg) : callbackfn;

        for (let i = 0; i < this.buckets; i++) {
            let dataPointer = this.indexView.getUint32(ShareableMap.INDEX_TABLE_OFFSET + i * ShareableMap.INT_SIZE);
            while (dataPointer !== 0) {
                const key = this.readTypedKeyFromDataObject(dataPointer);
                const value = this.readValueFromDataObject(dataPointer);
                boundCallback(value, key, this);
                dataPointer = this.dataView.getUint32(dataPointer);
            }
        }
        this.releaseReadLock();
    }

    get(key: K): V | undefined {
        this.acquireReadLock();
        let stringKey = this.stringifyElement<K>(key);
        const [hash, bucket] = this.computeHashAndBucket(stringKey);

        const returnValue = this.findValue(
            this.indexView.getUint32(bucket + ShareableMap.INDEX_TABLE_OFFSET),
            stringKey,
            hash
        );

        this.releaseReadLock();
        if (returnValue) {
            return returnValue[1];
        }

        return undefined;
    }

    has(key: K): boolean {
        this.acquireReadLock();
        let stringKey = this.stringifyElement<K>(key);
        const [hash, bucket] = this.computeHashAndBucket(stringKey);

        const returnValue = this.findValue(
            this.indexView.getUint32(bucket + ShareableMap.INDEX_TABLE_OFFSET),
            stringKey,
            hash,
            false
        );

        this.releaseReadLock();
        return returnValue !== undefined;
    }

    set(key: K, value: V): this {
        this.acquireWriteLock();
        const keyString = this.stringifyElement<K>(key);
        const maxKeyLength = this.stringEncoder.maximumLength(keyString);

        const [valueEncoder, valueEncoderId] = this.getEncoder(value);
        const maxValueLength = valueEncoder.maximumLength(value);

        const [hash, bucket] = this.computeHashAndBucket(keyString);

        const returnValue = this.findValue(
            this.indexView.getUint32(bucket + ShareableMap.INDEX_TABLE_OFFSET),
            keyString,
            hash
        );

        let needsToBeStored = true;
        let startPos: number;

        if (returnValue) {
            const [foundPosition, foundValue] = returnValue;
            startPos = foundPosition;

            // We need to check if we need to allocate a new set of space for the object (and if we thus need to remove
            // the previous value or not).

            const previousKeyLength = this.dataView.getUint32(startPos + 4);
            const previousValueLength = this.dataView.getUint32(startPos + 8);

            if (valueEncoder.maximumLength(value) > previousValueLength) {
                this.deleteItem(key);
            } else {
                needsToBeStored = false;
                const exactValueLength = valueEncoder.encode(
                    value,
                    new Uint8Array(
                        this.dataMem,
                        ShareableMap.DATA_OBJECT_OFFSET + foundPosition + previousKeyLength,
                        maxValueLength
                    )
                );

                // Store value length
                this.dataView.setUint32(foundPosition + 8, exactValueLength);
                this.dataView.setUint16(foundPosition + 14, valueEncoderId);

                this.spaceUsedInDataPartition += (exactValueLength - previousValueLength);
            }
        }

        if (needsToBeStored) {
            // Determine if the data storage needs to be resized.
            if (maxKeyLength + maxValueLength + this.freeStart + ShareableMap.DATA_OBJECT_OFFSET > this.dataView.byteLength) {
                // We don't have enough space left at the end of the data array. We should now consider if we should just
                // perform a defragmentation of the data array, or if we need to double the size of the array.
                const defragRatio = this.spaceUsedInDataPartition / this.dataView.byteLength;

                if (
                    defragRatio < ShareableMap.MIN_DEFRAG_FACTOR &&
                    this.spaceUsedInDataPartition + maxKeyLength + maxValueLength + ShareableMap.DATA_OBJECT_OFFSET < this.dataView.byteLength
                ) {
                    this.defragment();
                } else {
                    this.doubleDataStorage();
                }

            }

            const exactKeyLength = this.stringEncoder.encode(
                keyString,
                new Uint8Array(
                    this.dataMem,
                    ShareableMap.DATA_OBJECT_OFFSET + this.freeStart,
                    maxKeyLength
                )
            );

            const exactValueLength = valueEncoder.encode(
                value,
                new Uint8Array(
                    this.dataMem,
                    ShareableMap.DATA_OBJECT_OFFSET + this.freeStart + exactKeyLength,
                    maxValueLength
                )
            );

            // Store key length
            this.dataView.setUint32(this.freeStart + 4, exactKeyLength);
            // Store value length
            this.dataView.setUint32(this.freeStart + 8, exactValueLength);
            // Keep track of key and value datatypes
            this.dataView.setUint16(this.freeStart + 12, typeof key === "string" ? 1 : 0);
            this.dataView.setUint16(this.freeStart + 14, valueEncoderId);
            this.dataView.setUint32(this.freeStart + 16, hash);

            this.spaceUsedInDataPartition += ShareableMap.DATA_OBJECT_OFFSET + exactKeyLength + exactValueLength;

            startPos = this.freeStart;
            this.freeStart += ShareableMap.DATA_OBJECT_OFFSET + exactKeyLength + exactValueLength;

            // Increase size of the map since we added a new element.
            this.increaseSize();

            const bucketPointer = this.indexView.getUint32(bucket + ShareableMap.INDEX_TABLE_OFFSET);
            if (bucketPointer === 0) {
                this.incrementBucketsInUse();
                this.indexView.setUint32(bucket + ShareableMap.INDEX_TABLE_OFFSET, startPos);
            } else {
                // Update linked list pointers
                this.updateLinkedPointer(bucketPointer, startPos, this.dataView);
            }

            // If the load factor exceeds the recommended value, we need to rehash the map to make sure performance stays
            // acceptable.
            if ((this.getBucketsInUse() / this.buckets) >= ShareableMap.LOAD_FACTOR) {
                this.doubleIndexStorage();
            }
        }

        this.releaseWriteLock();
        return this;
    }

    get size() {
        this.acquireReadLock();
        // Size is being stored in the first 4 bytes of the index table
        const value = this.indexView.getUint32(ShareableMap.INDEX_SIZE_OFFSET);
        this.releaseReadLock();
        return value;
    }

    /**
     * @return The amount of buckets that are currently available in this map (either taken or non-taken, the total
     * number of buckets is returned).
     */
    private get buckets() {
        return (this.indexView.byteLength - ShareableMap.INDEX_TABLE_OFFSET) / ShareableMap.INT_SIZE;
    }

    /**
     * @return The amount of buckets that currently point to a data object.
     */
    private getBucketsInUse() {
        return this.indexView.getUint32(ShareableMap.INDEX_USED_BUCKETS_OFFSET);
    }

    /**
     * Increase the amount of buckets that currently point to a data object by one.
     */
    private incrementBucketsInUse() {
        return this.indexView.setUint32(ShareableMap.INDEX_USED_BUCKETS_OFFSET, this.getBucketsInUse() + 1);
    }

    /**
     * At what position in the data-array does the next block of free space start? This position is returned as number
     * of bytes since the start of the array.
     */
    private get freeStart() {
        // At what position in the data table does the free space start?
        return this.indexView.getUint32(ShareableMap.INDEX_FREE_START_INDEX_OFFSET);
    }

    /**
     * Update the position where the next block of free space in the data array starts.
     *
     * @param position The new position that should be set. Must indicate the amount of bytes from the start of the
     * data array.
     */
    private set freeStart(position) {
        this.indexView.setUint32(ShareableMap.INDEX_FREE_START_INDEX_OFFSET, position);
    }

    /**
     * Increase the size counter by one. This counter keeps track of how many items are currently stored in this map.
     */
    private increaseSize() {
        this.indexView.setUint32(ShareableMap.INDEX_SIZE_OFFSET, this.indexView.getUint32(ShareableMap.INDEX_SIZE_OFFSET) + 1);
    }

    private decreaseSize() {
        this.indexView.setUint32(ShareableMap.INDEX_SIZE_OFFSET, this.indexView.getUint32(ShareableMap.INDEX_SIZE_OFFSET) - 1);
    }

    private get spaceUsedInDataPartition(): number {
        return this.indexView.getUint32(ShareableMap.INDEX_TOTAL_USED_SPACE_OFFSET);
    }

    /**
     * Update the amount of bytes in the data array that are currently in use. These can be used to detect whether we
     * need to perform a defragmentation step or not.
     *
     * @param size New amount of bytes from the data array that's currently in use.
     */
    private set spaceUsedInDataPartition(size: number) {
        this.indexView.setUint32(ShareableMap.INDEX_TOTAL_USED_SPACE_OFFSET, size);
    }

    /**
     * Convert a given element with type T to a string. If no custom serializer has been set for this map, the built-in
     * JSON.stringify function will be used.
     *
     * @param el The element that should be converted into a string.
     */
    private stringifyElement<T>(el: T): string {
        let stringVal: string;
        if (typeof el !== "string") {
            stringVal = JSON.stringify(el);
        } else {
            stringVal = el;
        }
        return stringVal;
    }

    private getFittingDecoderBuffer(minimumSize: number): ArrayBuffer {
        if (this.currentDecoderBufferSize < minimumSize) {
            const nextPowerOfTwo = 2 ** Math.ceil(Math.log2(minimumSize));
            this.decoderBuffer = new ArrayBuffer(nextPowerOfTwo);
            this.currentDecoderBufferSize = nextPowerOfTwo;
        }

        return this.decoderBuffer;
    }

    private computeHashAndBucket(key: string): [number, number] {
        const hash: number = fast1a32(key);
        // Bucket in which this value should be stored.
        const bucket = (hash % this.buckets) * ShareableMap.INT_SIZE;
        return [hash, bucket];
    }

    /**
     * Iterate over all objects in the index buffer and reposition them in the data buffer. All objects should be stored
     * contiguous in the data buffer. This is an expensive operation that involves allocating a new collection of bytes,
     * copying and moving data around and releasing this block again from memory.
     */
    private defragment() {
        const newData: ArrayBuffer = new ArrayBuffer(this.dataView.byteLength);
        const newView = new DataView(newData);

        let newOffset = ShareableMap.INITIAL_DATA_OFFSET;

        for (let bucket = 0; bucket < this.buckets; bucket++) {
            // Copy all objects associated with one bucket to a new data buffer.
            let dataPointer = this.indexView.getUint32(ShareableMap.INDEX_TABLE_OFFSET + bucket * ShareableMap.INT_SIZE);
            // This bucket is being set and thus the pointer in the indexview should be updated.
            this.indexView.setUint32(ShareableMap.INDEX_TABLE_OFFSET + bucket * ShareableMap.INT_SIZE, 0);

            while (dataPointer !== 0) {
                const keyLength = this.dataView.getUint32(dataPointer + 4);
                const valueLength = this.dataView.getUint32(dataPointer + 8);

                const totalLength = keyLength + valueLength + ShareableMap.DATA_OBJECT_OFFSET;

                for (let i = 0; i < totalLength; i++) {
                    newView.setUint8(newOffset + i, this.dataView.getUint8(dataPointer + i));
                }

                // Pointer to next block is zero
                newView.setUint32(newOffset, 0);

                const currentBucketLink = this.indexView.getUint32(ShareableMap.INDEX_TABLE_OFFSET + bucket * ShareableMap.INT_SIZE);
                if (currentBucketLink === 0) {
                    this.indexView.setUint32(ShareableMap.INDEX_TABLE_OFFSET + bucket * ShareableMap.INT_SIZE, newOffset);
                } else {
                    // We need to follow the links from the first block here and update those.
                    this.updateLinkedPointer(currentBucketLink, newOffset, newView);
                }

                newOffset += totalLength;
                dataPointer = this.dataView.getUint32(dataPointer);
            }
        }

        for (let i = 0; i < this.dataView.byteLength; i += 4) {
            this.dataView.setUint32(i, newView.getUint32(i));
        }
        this.freeStart = newOffset;
    }

    /**
     * Allocate a new ArrayBuffer that's twice the size of the previous buffer and copy all contents from the old to the
     * new buffer. This method should be called when not enough free space is available for elements to be stored.
     */
    private doubleDataStorage() {
        let newDataMem: SharedArrayBuffer | ArrayBuffer;
        if (this.dataMem.byteLength > 512 * 1024 * 1024) {
            // Increase linearly (instead of doubling) with the size of the data array if this is larger than 512MB.
            newDataMem = this.allocateMemory(this.dataView.byteLength + 256 * 1024 * 1024);
        } else {
            newDataMem = this.allocateMemory(this.dataMem.byteLength * 2);
        }

        // Copy the data from the old to the new buffer
        const newDataArray = new Uint8Array(newDataMem);
        newDataArray.set(new Uint8Array(this.dataMem));
        this.dataMem = newDataMem;
        this.dataView = new DataView(this.dataMem);
    }

    /**
     * Call this function if the effective load factor of the map is higher than the allowed load factor (default 0.75).
     * This method will double the amount of available buckets and make sure all pointers are placed in the correct
     * location.
     */
    private doubleIndexStorage() {
        const oldBuckets = this.buckets;
        const newIndex = this.allocateMemory(ShareableMap.INT_SIZE * oldBuckets * 2);
        const newIndexView = new DataView(newIndex);
        const newBuckets = (newIndexView.byteLength - ShareableMap.INDEX_TABLE_OFFSET) / ShareableMap.INT_SIZE;

        let bucketsInUse: number = 0;

        // Now, we need to rehash all previous values and recompute the bucket pointers
        for (let bucket = 0; bucket < oldBuckets; bucket++) {
            let startPos = this.indexView.getUint32(ShareableMap.INDEX_TABLE_OFFSET + bucket * 4);

            while (startPos !== 0) {
                // Rehash
                const hash: number = this.readHashFromDataObject(startPos);
                const newBucket = hash % newBuckets;

                const newBucketContent = newIndexView.getUint32(ShareableMap.INDEX_TABLE_OFFSET + newBucket * 4);
                // Should we directly update the bucket content or follow the links and update those?
                if (newBucketContent === 0) {
                    bucketsInUse++;
                    newIndexView.setUint32(ShareableMap.INDEX_TABLE_OFFSET + newBucket * 4, startPos);
                } else {
                    // The bucket already exists, add the new object to the end of the chain.
                    this.updateLinkedPointer(newBucketContent, startPos, this.dataView);
                }

                // Follow link in the chain and update its properties.
                const newStartPos = this.dataView.getUint32(startPos);
                this.dataView.setUint32(startPos, 0);
                startPos = newStartPos;
            }
        }

        // Copy metadata between the old and new buffer
        for (let i = 0; i < ShareableMap.INDEX_TABLE_OFFSET; i += 4) {
            newIndexView.setUint32(i, this.indexView.getUint32(i));
        }

        this.indexMem = newIndex;
        this.indexView = new DataView(this.indexMem);
        // The buckets that are currently in use is the only thing that did change for the new index table.
        this.indexView.setUint32(4, bucketsInUse);
    }

    private getEncoder(value: V): [Serializable<any>, number] {
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

    /**
     * Update a data object's pointer to the next object in a linked list.
     *
     * @param startPos The starting position of the data object whose "next"-pointer needs to be updated.
     * @param nextBlock Value of the "next"-pointer that either points to a valid starting position of a data object, or
     * a 0 if this is the last object in a linked chain of objects.
     * @param dataView The DataView object that should be updated and whose links should be followed.
     */
    private updateLinkedPointer(startPos: number, nextBlock: number, dataView: DataView) {
        while (dataView.getUint32(startPos) !== 0) {
            startPos = dataView.getUint32(startPos);
        }
        dataView.setUint32(startPos, nextBlock);
    }

    /**
     * Start looking for a specific key in a given link of data objects and return the associated value. The starting
     * position given to this function should point to the first data object in the link that's to be examined. If the
     * key is not found at this position, the pointer to the next data object is followed until either the key is found,
     * or no link to the following object exists.
     *
     * @param startPos Position of the first data object in the linked list that should be examined.
     * @param key The key that we're currently looking for.
     * @param hash The hash that corresponds to the key that we are currently investigating.
     * @param readValue Whether the value for this object should be decoded or not. If false, the second item in the
     * returned tuple will be undefined.
     * @return The starting position of the data object and value associated with the given key. If no such key was
     * found, undefined is returned.
     */
    private findValue(
        startPos: number,
        key: string,
        hash: number,
        readValue: boolean = true
    ): [number, V | undefined] | undefined {
        while (startPos !== 0) {
            const readHash = this.readHashFromDataObject(startPos);
            if (readHash === hash && key === this.readKeyFromDataObject(startPos)) {
                return [startPos, readValue ? this.readValueFromDataObject(startPos) : undefined];
            } else {
                startPos = this.dataView.getUint32(startPos);
            }
        }
        return undefined;
    }

    /**
     * Returns the hash associated with the data object starting at the given starting position.
     * @param startPos
     * @private
     */
    private readHashFromDataObject(startPos: number): number {
        return this.dataView.getUint32(startPos + 16);
    }

    /**
     * Returns the key associated with the data object starting at the given starting position.
     *
     * @param startPos The starting position of the data object from which the associated key should be extracted.
     */
    private readKeyFromDataObject(startPos: number): string {
        const keyLength = this.dataView.getUint32(startPos + 4);

        const sourceView = new Uint8Array(this.dataView.buffer, startPos + ShareableMap.DATA_OBJECT_OFFSET, keyLength);

        const targetView = new Uint8Array(this.getFittingDecoderBuffer(keyLength), 0, keyLength);
        targetView.set(sourceView);

        // Is not allowed to be performed directly from SharedArrayBuffer by browsers...
        // const dataView = new DataView(this.dataMem.buffer, startPos + ShareableMap.DATA_OBJECT_OFFSET, keyLength)
        return this.textDecoder.decode(targetView);
    }

    private readTypedKeyFromDataObject(startPos: number): K {
        const stringKey = this.readKeyFromDataObject(startPos);

        if (this.dataView.getUint16(startPos + 12) === 1) {
            return stringKey as unknown as K;
        } else {
            return JSON.parse(stringKey) as unknown as K;
        }
    }

    /**
     * Returns the value associated with the data object starting at the given starting position.
     *
     * @param startPos The starting position of the data object from which the associated value should be returned.
     */
    private readValueFromDataObject(startPos: number): V {
        const keyLength = this.dataView.getUint32(startPos + 4);
        const valueLength = this.dataView.getUint32(startPos + 8);

        const encoder = this.getEncoderById(this.dataView.getUint16(startPos + 14));

        // Copy from shared memory to a temporary private buffer (since we cannot directly decode from shared memory)
        const sourceView = new Uint8Array(this.dataView.buffer, startPos + ShareableMap.DATA_OBJECT_OFFSET + keyLength, valueLength);

        const targetView = new Uint8Array(this.getFittingDecoderBuffer(valueLength), 0, valueLength);
        targetView.set(sourceView);

        return encoder.decode(targetView);
    }

    /**
     * Clear all contents of this map and return to the initial configuration.
     *
     * @param expectedSize How many elements are expected to be stored in this map? Setting this value initially to a
     * good estimate could help with improving performance for this map.
     * @param averageBytesPerValue how large do we expect one value element to be on average. Setting this to a good
     * estimate can improve performance of this map.
     */
    private reset(expectedSize: number, averageBytesPerValue: number) {
        if (averageBytesPerValue % 4 !== 0) {
            throw new Error("Average bytes per value must be a multiple of 4.");
        }

        if (expectedSize == 0 && averageBytesPerValue == 0) {
            // Do not allocate memory, will be performed later...
            return;
        }

        // First 4 bytes are used to store the amount of items in the map.
        // Second 4 bytes keep track of how many buckets are currently being used.
        // Third set of 4 bytes is used to track where the free space in the data table starts.
        // Fourth set of 4 bytes keep tracks of the DataBuffer's length.
        // Fifth set of 4 bytes keeps track of the space that's being used in total (to track the defrag factor).
        // Rest of the index maps buckets onto their starting position in the data array.
        const buckets = Math.ceil(expectedSize / ShareableMap.LOAD_FACTOR)
        const indexSize = 5 * 4 + buckets * ShareableMap.INT_SIZE;

        this.indexMem = this.allocateMemory(indexSize);
        this.indexView = new DataView(this.indexMem);

        // Free space starts from position 1 in the data array (instead of 0, which we use to indicate the end).
        this.indexView.setUint32(ShareableMap.INDEX_FREE_START_INDEX_OFFSET, ShareableMap.INITIAL_DATA_OFFSET);

        // Size must be a multiple of 4
        const dataSize = averageBytesPerValue * expectedSize;

        this.dataMem = this.allocateMemory(dataSize);
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

    /**
     * Acquires a read lock on the map. Multiple readers can hold read locks simultaneously,
     * but no writers can access the map while any read locks are held.
     *
     * @param timeout Optional timeout in milliseconds. If not provided, will wait indefinitely.
     * @returns true if the lock was acquired, false if it timed out
     */
    private acquireReadLock(timeout: number = 500): boolean {
        if (!(this.indexMem instanceof SharedArrayBuffer)) {
            // Locking only works with SharedArrayBuffer
            return true;
        }

        const int32Array = new Int32Array(this.indexMem);

        // Wait until there are no write locks
        const startTime = Date.now();
        while (true) {
            // Check if there's a write lock
            const currentState = Atomics.load(int32Array, ShareableMap.INDEX_LOCK_OFFSET / 4);

            if (currentState !== ShareableMap.LOCK_STATE.WRITE_LOCKED) {
                // No write lock, try to update the state and increment read count
                const readCount = Atomics.add(int32Array, ShareableMap.INDEX_READ_COUNT_OFFSET / 4, 1) + 1;

                // If this is the first read lock, update the state
                if (readCount === 1) {
                    Atomics.store(int32Array, ShareableMap.INDEX_LOCK_OFFSET / 4, ShareableMap.LOCK_STATE.READ_LOCKED);
                }

                return true;
            }

            // If we have a timeout and it's expired, return false
            if (timeout !== undefined && (Date.now() - startTime) >= timeout) {
                throw new Error("ShareableMap: timeout expired while waiting for read lock.");
            }

            // Wait for a notification that the write lock might be released
            // We use "not-equal" because we want to wake up when the state changes from WRITE_LOCKED
            Atomics.wait(int32Array, ShareableMap.INDEX_LOCK_OFFSET / 4,
                ShareableMap.LOCK_STATE.WRITE_LOCKED,
                timeout === undefined ? Infinity : timeout - (Date.now() - startTime));
        }
    }

    /**
     * Releases a previously acquired read lock.
     */
    public releaseReadLock(): void {
        if (!(this.indexMem instanceof SharedArrayBuffer)) {
            return;
        }

        const int32Array = new Int32Array(this.indexMem);

        // Decrement the read count
        const readCount = Atomics.sub(int32Array, ShareableMap.INDEX_READ_COUNT_OFFSET / 4, 1) - 1;

        // If this was the last read lock, update the state and notify waiters
        if (readCount === 0) {
            Atomics.store(int32Array, ShareableMap.INDEX_LOCK_OFFSET / 4, ShareableMap.LOCK_STATE.UNLOCKED);
            // Notify all waiters that the state has changed
            Atomics.notify(int32Array, ShareableMap.INDEX_LOCK_OFFSET / 4, Infinity);
        }
    }

    /**
     * Acquires an exclusive write lock on the map. No other readers or writers can access
     * the map while a write lock is held.
     *
     * @param timeout Optional timeout in milliseconds. If not provided, will wait indefinitely.
     * @returns true if the lock was acquired, false if it timed out
     */
    public acquireWriteLock(timeout: number = 500): boolean {
        if (!(this.indexMem instanceof SharedArrayBuffer)) {
            // Locking only works with SharedArrayBuffer
            return true;
        }

        const int32Array = new Int32Array(this.indexMem);

        const startTime = Date.now();
        while (true) {
            // Check if the map is currently unlocked
            const currentState = Atomics.load(int32Array, ShareableMap.INDEX_LOCK_OFFSET / 4);

            if (currentState === ShareableMap.LOCK_STATE.UNLOCKED) {
                // Try to atomically change state from UNLOCKED to WRITE_LOCKED
                const exchangedValue = Atomics.compareExchange(
                    int32Array,
                    ShareableMap.INDEX_LOCK_OFFSET / 4,
                    ShareableMap.LOCK_STATE.UNLOCKED,
                    ShareableMap.LOCK_STATE.WRITE_LOCKED
                );

                // If exchangedValue is UNLOCKED, we got the lock
                if (exchangedValue === ShareableMap.LOCK_STATE.UNLOCKED) {
                    return true;
                }
            }

            // If we have a timeout and it's expired, return false
            if (timeout !== undefined && (Date.now() - startTime) >= timeout) {
                throw new Error("ShareableMap: timeout expired while waiting for write lock.");
            }

            // Wait for a notification that the lock state has changed
            Atomics.wait(
                int32Array,
                ShareableMap.INDEX_LOCK_OFFSET / 4,
                currentState,
                timeout === undefined ? Infinity : timeout - (Date.now() - startTime)
            );
        }
    }

    /**
     * Releases a previously acquired write lock.
     */
    public releaseWriteLock(): void {
        if (!(this.indexMem instanceof SharedArrayBuffer)) {
            return;
        }

        const int32Array = new Int32Array(this.indexMem);

        // Set the state to UNLOCKED
        Atomics.store(int32Array, ShareableMap.INDEX_LOCK_OFFSET / 4, ShareableMap.LOCK_STATE.UNLOCKED);

        // Notify all waiters that the lock has been released
        Atomics.notify(int32Array, ShareableMap.INDEX_LOCK_OFFSET / 4, Infinity);
    }

    /**
     * Initialize lock state in the reset method
     * Add this to your reset() method
     */
    private initializeLockState(): void {
        if (this.indexMem instanceof SharedArrayBuffer) {
            const int32Array = new Int32Array(this.indexMem);
            Atomics.store(int32Array, ShareableMap.INDEX_LOCK_OFFSET / 4, ShareableMap.LOCK_STATE.UNLOCKED);
            Atomics.store(int32Array, ShareableMap.INDEX_READ_COUNT_OFFSET / 4, 0);
        }
    }
}

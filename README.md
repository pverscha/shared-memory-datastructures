<p align="center">
    <img src="./docs/images/sharedcore_logo.png" alt="logo" height="200px" />
</p>

## Key features
High-performance, thread-safe data structures for JavaScript and TypeScript, powered by SharedArrayBuffer. 
Zero-copy, zero-hassle, shared memory at your core.

- **Zero-cost data sharing:** Avoid serialization and transfer overhead between Web Workers or threads.
- **Thread-safe by design:** Synchronization is handled internally — no locks, races, or guesswork.
- **Familiar API:** Drop-in replacements for JavaScript's native Map and Array, with full TypeScript support.
- **Built for performance:** Optimized for speed-critical, concurrent workloads.
- **Automatic memory management:** Resizes automatically when necessary.

## Introduction
This package is intended to speed up the communication time between different JavaScript threads by exposing data structures that internally use a `SharedArrayBuffer` to store all required information. 
`SharedArrayBuffers` can be used by multiple threads without an extra cost (they do not need to be transferred, nor does it require any serialization / deserialization), but can only contain binary data.

This library overcomes this issue by providing users with rich datastructures that follow the default JavaScript API (where possible) and that can be (more or less) transparently used. 
TypeScript typings are included with this library.

Unlike traditional JavaScript Maps or Arrays that need to be serialized and copied between workers, the datastructures provided by this library reside in shared memory, making them instantly accessible to all workers without any transfer cost.
This makes them particularly efficient for scenarios where large amounts of data need to be shared across multiple threads in your application.

A common use case for ShareableMap is when processing large datasets in a separate worker thread while maintaining UI responsiveness.
For example, when your application needs to fetch and process substantial amounts of data, this operation can be offloaded to a worker thread to keep the main thread (UI) responsive.
With traditional Maps, transferring the processed data back to the main thread for UI updates would require costly serialization and deserialization.
ShareableMap eliminates this overhead by providing instant access to the processed data from any thread, making it an ideal choice for data-intensive applications that require frequent updates between workers and the UI thread.

## Performance
_Coming soon_

## Installation
This package is available on npm and can be installed using

```
npm install shared-memory-datastructures
```

## Examples
### Creating a new `ShareableMap`
Creating a new `ShareableMap` is as simple as creating a normal `Map` in JavaScript:

```ts
import {ShareableMap} from "shared-memory-datastructures";

const sharedMap = new ShareableMap<string, number>();

sharedMap.set("x", 17);
console.log(`Set value is: ${sharedMap.get("x")}`);
```

### Sharing a `ShareableMap` between workers
The `ShareableMap` can be used by multiple workers at the same time.
Because it's not possible in JavaScript to send functions (or objects containing functions) from one worker to another, you need to manually send a `ShareableMap`'s internal state to another worker, and revive it over there.

**Main thread (or worker A):**
```ts
import {ShareableMap} from "shared-memory-datastructures";

const sharedMap = new ShareableMap<string, number>();

sharedMap.set("x", 45);
sharedMap.set("y", 68);

// Retrieve the binary memory representation of the ShareableMap
const transferableState = sharedMap.toTransferableState();

const workerB = new WorkerA();

// Send a reference to this block of shared memory to another worker.
workerB.postMessage({myMapState: transferableState});
```

**Worker B (inflating the Map again)**

```ts
import {ShareableMap} from "shared-memory-datastructures";

self.onmessage = async (event) => {
    const mapState = event.data.myMapState;
    
    // Create a new ShareableMap object that uses the same block of memory as the object in the main thread.
    const sharedMap = ShareableMap.fromTransferableState<string, number>(mapState);
    
    console.log(`Value for key "x" is: ${sharedMap.get("x")}`);
}
```

> [!NOTE] 
> Note that the map can still be updated by both workers at the same time.
> this library itself handles any required synchronization or thread-safety transparently.

# API

See our [API reference](#) for a detailed description of all functions, interfaces and classes supported by this library.

## `ShareableMap`
> [!NOTE]
> Since v1.0.0-alpha.1 overwriting existing keys with `set`, and removing keys with `delete` are also supported. This means that the `ShareableMap` now fully supports the `Map` interface as defined by JavaScript.

### Constructor
```typescript
constructor(options?: ShareableMapOptions<V>)
```
Creates a new ShareableMap instance.

**Parameters:**
- (optional): Configuration options for the map
    - `expectedSize`: Expected number of elements to be stored (default: 1024) 
    - `averageBytesPerValue`: Expected average size in bytes per value (default: 256) 
    - `serializer`: Optional custom serializer for value types

**Example:**
```typescript
const map = new ShareableMap<string, object>({
  expectedSize: 10000,
  averageBytesPerValue: 512
});
```

### set
```typescript
set(key: K, value: V): this
```

Sets a key-value pair in the map. If the key already exists, its value is updated.

**Parameters:**
- `key`: The key to set 
- `value`: The value to store

**Returns:** The map instance for chaining

**Example:**
```typescript
map.set('user', { id: 1, name: 'John' });
```

### get
```typescript
get(key: K): V | undefined
```
Retrieves a value from the map by its key.

**Parameters:**
- `key`: The key to look up 

**Returns:** The stored value or if the key doesn't exist `undefined`

**Example:**
```typescript
const user = map.get('user'); // { id: 1, name: 'John' } or undefined
```

### has
```typescript
has(key: K): boolean
```
Checks if a key exists in the map.

**Parameters:**
- `key`: The key to check for 

**Returns:** `true` if the key exists, `false` otherwise

**Example:**
```typescript
if (map.has('user')) {
  // Key exists
}
```

### toTransferableState
```typescript
toTransferableState(): TransferableState
```
Extracts the internal buffers representing the map for efficient transfer between threads.

**Returns:** An object containing:
- `indexBuffer`: ArrayBuffer containing the map's index data 
- `dataBuffer`: ArrayBuffer containing the map's values 
- `dataType`: String identifier (always "map") 

**Example:**
```typescript
const state = map.toTransferableState();
worker.postMessage({ state }, [state.indexBuffer, state.dataBuffer]);
```

### ShareableMap.fromTransferableState
``` typescript
static fromTransferableState<K, V>(
  state: TransferableState,
  options?: ShareableMapOptions<V>
): ShareableMap<K, V>
```
Creates a new ShareableMap from previously exported state.

**Parameters:**
- `state`: The state object returned by `toTransferableState()`
- `options` (optional): Configuration options (same as constructor) 

**Returns:** A new ShareableMap instance with the same data as the original

**Throws:** `TypeError` if the provided state is invalid for an array.

**Example:**
```typescript
// In a worker or after receiving the state
const map = ShareableMap.fromTransferableState(receivedState);
```

### Additional Information
- The map is thread-safe with internal read/write locking mechanisms
- Automatically handles memory management with defragmentation when needed
- Supports any serializable JavaScript value as keys and values
- Implements the standard Map interface methods (entries, keys, values, forEach)

For complete documentation and advanced usage, please refer to the [full documentation - coming soon](#).

## `ShareableArray`
> [!NOTE]
> Available since v1.0.0-alpha.10. The array implements almost all methods and functions provided by the standard JavaScript Array API (with the same type signatures). However, it does not implement the JavaScript `Array` interface because it cannot fully adhere to its semantics due to limitations in the JavaScript language.

### Constructor
```typescript
constructor(options?: ShareableArrayOptions<T>, ...items: T[])
```
Creates a new `ShareableArray` instance.  

**Parameters:**
- (optional): Configuration options:
  - `serializer`: Optional custom serializer for value types
- `items`: Initial values to populate the array with 

**Example:**
```typescript
// Create an empty array
const array = new ShareableArray<number>();

// Create an array with initial values
const arrayWithValues = new ShareableArray<string>(undefined, "apple", "banana", "cherry");

// Create an array with a custom serializer
const customArray = new ShareableArray<MyObject>({
  serializer: new MyObjectSerializer()
});
```

### set
```typescript
set(index: number, value: T | undefined): this
```
Sets the element at the specified index to the given value.  

**Parameters:**
- `index`: Zero-based index at which to set the value 
- `value`: The value to assign 

**Returns:** The array instance for chaining  

**Example:**
```typescript
const array = new ShareableArray<number>(undefined, 1, 2, 3);
array.set(1, 42); // array now contains [1, 42, 3]
```

### at
```typescript
at(index: number): T | undefined
```
Returns the element at the specified index. Supports negative indices, where -1 refers to the last element.  

**Parameters:**
- : Zero-based index of the element to retrieve `index`

**Returns:** The element at the specified position, or `undefined` if the index is out of bounds.

**Example:**
```typescript
const array = new ShareableArray<number>(undefined, 10, 20, 30);
array.at(1);  // Returns 20
array.at(-1); // Returns 30
array.at(5);  // Returns undefined
```

### delete
```typescript
delete(index: number): T | undefined
```
Removes the element at the specified index and returns the deleted value.  

**Parameters:**
- `index`: Zero-based index of the element to delete 

**Returns:** The deleted element, or `undefined` if the index was out of bounds.

**Example:**
```typescript
const array = new ShareableArray<string>(undefined, "apple", "banana", "cherry");
const deleted = array.delete(1); // Returns "banana", array now contains ["apple", "cherry"]
```

### splice
```typescript
splice(start: number, deleteCount: number, ...items: T[]): ShareableArray<T>
```
Changes the contents of the array by removing, replacing, or adding elements. 

**Parameters:**
- `start`: Index at which to start changing the array 
- `deleteCount`: Number of elements to remove from the array 
- `items`: Elements to add to the array beginning at the index

**Returns:** A new `ShareableArray` containing the deleted elements.

**Example:**
```typescript
const array = new ShareableArray<number>(undefined, 1, 2, 3, 4);
const removed = array.splice(1, 2, 5, 6); // array now contains [1, 5, 6, 4]
// removed contains [2, 3]
```

### slice
```typescript
slice(start?: number, end?: number): ShareableArray<T>
```
Creates a new array containing elements from the original array from the `start` index up to, but not including, `end`. 

**Parameters:**
- `start`: Zero-based index at which to begin extraction (default: 0) 
- `end`: Zero-based index at which to end extraction (default: array length) 

**Returns:** A new `ShareableArray` containing the extracted elements.

**Example:**
```typescript
const array = new ShareableArray<number>(undefined, 1, 2, 3, 4, 5);
const sliced = array.slice(1, 4); // Returns a new ShareableArray with [2, 3, 4]
```

### toTransferableState
```typescript
toTransferableState(): TransferableState
```
Extracts the internal buffers representing the array for efficient transfer between threads.

**Returns:** An object containing:
- `indexBuffer`: ArrayBuffer containing the array’s index data 
- `dataBuffer`: ArrayBuffer containing the array’s values 
- `dataType`: String identifier (always "array") 

**Example:**
```typescript
const array = new ShareableArray<number>(undefined, 1, 2, 3);
const state = array.toTransferableState();
worker.postMessage({ state }, [state.indexBuffer, state.dataBuffer]);
```

### ShareableArray.fromTransferableState
```typescript
static fromTransferableState<T>(
  state: TransferableState,
  options?: ShareableArrayOptions<T>
): ShareableArray<T>
```
Creates a new `ShareableArray` from previously exported state.

**Parameters:**
- `state`: The state object returned by `toTransferableState()`
- (optional): Configuration options:
  - `serializer`: Custom serializer for value types (must match the original)

**Returns:** A new `ShareableArray` instance with the same data as the original.

**Throws:** `TypeError` if the provided state is invalid for an array.

**Example:**
```typescript
// In thread 1:
const originalArray = new ShareableArray<string>(undefined, "hello", "world");
const state = originalArray.toTransferableState();
// Transfer state to another thread

// In thread 2:
const recreatedArray = ShareableArray.fromTransferableState<string>(state);
// recreatedArray now contains ["hello", "world"]
```

### Additional Information
- The array supports efficient memory management with automatic resizing and defragmentation.
- Any serializable JavaScript value can be stored as elements.
- Although it mimics the JavaScript Array API, it is not a true subclass of `Array` since it cannot 100% guarantee that the semantics remain consistent.
- For cross-thread communication, use `toTransferableState()` and `fromTransferableState()` to share the array without copying.

## Advanced information

See our [wiki](https://github.com/pverscha/shared-memory-datastructures/wiki) for an overview of implementation details and how the memory of this library is managed.


# Shared Memory Datastructures

## Key features
- Implemented on top of SharedArrayBuffers
- Zero-cost worker communication
- Maximum transparency
- Built for performance
- Thread-safe
- Automatic memory management (resizes automatically when required)

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

> [!NOTE] Note that the map can still be updated by both workers at the same time.
> this library itself handles any required synchronization or thread-safety transparently.

## API

See our [API reference](#) for a detailed description of all functions, interfaces and classes supported by this library.

### `ShareableMap`
> [!NOTE]
> Since v1.0.0-alpha.1 overwriting existing keys with `set`, and removing keys with `delete` are also supported.
> This means that the `ShareableMap` now fully supports the `Map` interface as defined by JavaScript.

_Coming soon_

### `ShareableArray`
> [!NOTE]
> Available since v1.0.0-alpha.10.
> The array implements almost all methods and functions that are provided by the default JavaScript API (with the same type signature).
> However, it does not implement the JavaScript Array interface, because it cannot 100% adhere to the semantics (because of limitations posed by the JavaScript programming language).

_Coming soon_

## Advanced information

See our [wiki](https://github.com/pverscha/shared-memory-datastructures/wiki) for an overview of implementation details and how the memory of this library is managed.

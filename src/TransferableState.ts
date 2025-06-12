export interface TransferableState {
    indexBuffer: SharedArrayBuffer | ArrayBuffer;
    dataBuffer: SharedArrayBuffer | ArrayBuffer;
    dataType: "map" | "array";
}

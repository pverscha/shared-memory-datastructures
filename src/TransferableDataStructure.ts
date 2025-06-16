export default abstract class TransferableDataStructure {
    // Default size of the decoder buffer that's always reused (in bytes)
    private static readonly DECODER_BUFFER_SIZE = 16384;

    // This buffer can be reused to decode the keys of each pair in the map (and avoids us having to reallocate a new
    // block of memory for each `get` or `set` operation).
    private decoderBuffer: ArrayBuffer = new ArrayBuffer(TransferableDataStructure.DECODER_BUFFER_SIZE);
    private currentDecoderBufferSize: number = TransferableDataStructure.DECODER_BUFFER_SIZE;

    protected allocateMemory(byteSize: number): SharedArrayBuffer | ArrayBuffer {
        try {
            return new SharedArrayBuffer(byteSize);
        } catch (err) {
            throw new Error(`Could not allocate memory. Tried to allocate ${byteSize} bytes.`);
        }
    }

    protected getFittingDecoderBuffer(minimumSize: number): ArrayBuffer {
        if (this.currentDecoderBufferSize < minimumSize) {
            const nextPowerOfTwo = 2 ** Math.ceil(Math.log2(minimumSize));
            this.decoderBuffer = new ArrayBuffer(nextPowerOfTwo);
            this.currentDecoderBufferSize = nextPowerOfTwo;
        }

        return this.decoderBuffer;
    }
}

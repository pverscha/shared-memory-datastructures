import Serializable from "./Serializable";

export default class StringEncoder implements Serializable<string> {
    private textEncoder = new TextEncoder();
    private textDecoder = new TextDecoder();

    decode(buffer: Uint8Array): string {
        return this.textDecoder.decode(buffer);
    }

    encode(stringValue: string, destination: Uint8Array): number {
        // Safari does not support the encodeInto function
        if (this.textEncoder.encodeInto !== undefined) {
            try {
                const writeResult = this.textEncoder.encodeInto(stringValue, destination);
                return writeResult.written ? writeResult.written : 0;
            } catch (error) {
                // Try again with a separate, non-shared arraybuffer (some browsers do not accept SharedArrayBuffers
                // for the encodeInto function yet).
                const buffer = new Uint8Array(new ArrayBuffer(stringValue.length * 2));
                const writeResult = this.textEncoder.encodeInto(stringValue, buffer);
                const writeLength = writeResult.written ? writeResult.written : 0;
                for (let i = 0; i < writeLength; i++) {
                    destination[i] = buffer[i];
                }
                return writeLength;
            }
        } else {
            const encodedString = this.textEncoder.encode(stringValue);
            for (let i = 0; i < encodedString.byteLength; i++) {
                destination[i] = encodedString[i];
            }
            return encodedString.byteLength;
        }
    }

    /**
     * An UTF-8 string that's encoded using the built-in TextEncoder will never occupy more than 3 * stringlength bytes.
     *
     * @param value The string value that should be encoded as a string with this StringEncoder.
     */
    maximumLength(value: string): number {
        return value.length * 3;
    }
}

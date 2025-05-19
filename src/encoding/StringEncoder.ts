import Serializable from "./Serializable";

export default class StringEncoder implements Serializable<string> {
    // Default size of the decoder buffer that's always reused (in bytes)
    private static readonly ENCODER_BUFFER_SIZE = 16384

    private textEncoder = new TextEncoder();
    private textDecoder = new TextDecoder();

    private encoderBuffer: ArrayBuffer = new ArrayBuffer(StringEncoder.ENCODER_BUFFER_SIZE);
    private encoderArray: Uint8Array = new Uint8Array(this.encoderBuffer);
    private currentDecoderBufferSize: number = StringEncoder.ENCODER_BUFFER_SIZE;

    decode(buffer: Uint8Array): string {
        return this.textDecoder.decode(buffer);
    }

    encode(stringValue: string, destination: Uint8Array): number {
        // Safari does not support the encodeInto function
        if (this.textEncoder.encodeInto !== undefined) {
            const maxStringLength = stringValue.length * 3;

            if (this.currentDecoderBufferSize < maxStringLength) {
                this.encoderBuffer = new ArrayBuffer(maxStringLength);
                this.encoderArray = new Uint8Array(this.encoderBuffer);
                this.currentDecoderBufferSize = maxStringLength;
            }

            const writeResult = this.textEncoder.encodeInto(stringValue, this.encoderArray);
            const writeLength = writeResult.written || 0;
            destination.set(this.encoderArray.subarray(0, writeLength));
            return writeLength;
        } else {
            const encodedString = this.textEncoder.encode(stringValue);
            destination.set(encodedString);
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

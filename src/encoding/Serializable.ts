export default interface Serializable<T> {
    /**
     * Encode the given object into the destination DataView and return the exact size in bytes that was used to store
     * this encoded object. It is guaranteed that enough free space is available in the destination DataView, according
     * the estimate provided by `maximumLength()`.
     *
     * @param object The object that needs to be serialized.
     * @param destination The destination to which the encoded object should be stored.
     * @return The exact amount of bytes that was required to encode the object.
     */
    encode(object: T, destination: Uint8Array): number;

    /**
     * Decode the object that's encoded in the given buffer.
     *
     * @param buffer The buffer that contains the encoded version of the object that needs to be retrieved.
     * @return A reconstructed, original version of the object itself.
     */
    decode(buffer: Uint8Array): T;

    /**
     * Return an estimate for the maximum amount of bytes required to encode the given object. Note that this should
     * always be a worst-case estimate (meaning that the final encoding should never use more bytes than returned by
     * this estimate). This estimate is being used to reserve enough space in the data buffer before it's passed onto
     * the encode function.
     *
     * @param object The object that should be encoded and for which an estimate of the maximum length should be
     * returned.
     * @return The maximum number of bytes that will be occupied by the given object in its encoded form.
     */
    maximumLength(object: T): number;
}

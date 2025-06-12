import {Serializable} from "../encoding";

export default interface ShareableArrayOptions<T> {
    /**
     * Custom serializer to convert the objects stored in this array as a value to an ArrayBuffer and vice-versa.
     * Providing your own implementation of a serializable for complex objects can drastically speed up real-world
     * performance of the ShareableArray.
     */
    serializer?: Serializable<T>;
}

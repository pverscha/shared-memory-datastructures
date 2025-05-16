import Serializable from "./Serializable";
import StringEncoder from "./StringEncoder";

export default class GeneralPurposeEncoder implements Serializable<Object> {
    private readonly stringEncoder = new StringEncoder();

    decode(buffer: Uint8Array): Object {
        const stringValue = this.stringEncoder.decode(buffer);
        return JSON.parse(stringValue);
    }

    encode(object: Object, destination: Uint8Array): number {
        const stringValue = JSON.stringify(object);
        return this.stringEncoder.encode(stringValue, destination);
    }

    maximumLength(object: Object): number {
        const stringValue = JSON.stringify(object);
        return this.stringEncoder.maximumLength(stringValue);
    }
}

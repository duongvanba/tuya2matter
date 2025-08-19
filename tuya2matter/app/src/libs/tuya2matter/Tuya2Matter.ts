import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { Tuya2MatterSwitch } from "./Tuya2MatterSwitch.js";
import { Tuya2MatterCover } from "./Tuya2MatterCover.js";
import { Tuya2MatterOccupancySensor } from "./Tuya2MatterOccupancySensor.js";
import { Tuya2MatterBinarySensor } from "./Tuya2MatterBinarySensor.js";
import { Tuya2MatterButton } from "./Tuya2MatterButton.js";



export class Tuya2Matter {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice 
    ) { }

    #getMapper() {
        if (['kg', 'tdq'].includes(this.tuya.category)) return new Tuya2MatterSwitch(this.aggregator, this.tuya)
        if (this.tuya.category == 'cl') return new Tuya2MatterCover(this.aggregator, this.tuya)
        if (this.tuya.category == 'hps') return new Tuya2MatterOccupancySensor(this.aggregator, this.tuya)
        if (this.tuya.category == 'mcs') return new Tuya2MatterBinarySensor(this.aggregator, this.tuya)
        if (this.tuya.category == 'wxkg') return new Tuya2MatterButton(this.aggregator, this.tuya) 
    }

    async init() {
        const device = this.#getMapper()
        if (device) await device.init()
    }


}
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { Tuya2MatterSwitch } from "./T2mSwitch.js";


export class Tuya2Matter {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    #getMapper(){
        if(this.tuya.category == 'pw') return new Tuya2MatterSwitch(this.aggregator, this.tuya)
    }

    async init() {
       const device = this.#getMapper()
       if(device) await device.init()
    }


}
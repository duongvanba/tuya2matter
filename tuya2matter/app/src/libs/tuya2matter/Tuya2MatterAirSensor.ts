import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint, MaybePromise } from "@matter/main";
import { ColorTemperatureLightDevice, TemperatureSensorDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors";
import { map, mergeMap } from "rxjs";
import { LevelControl } from "@matter/main/clusters";




export class Tuya2MatterAirSensor {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name.slice(0, 32) 

        const endpoint = new Endpoint(
            TemperatureSensorDevice.with(BridgedDeviceBasicInformationServer),
            {
                id: this.tuya.id,
                bridgedDeviceBasicInformation: {
                    nodeLabel: name,
                    productName: name,
                    productLabel: name,
                    serialNumber: this.tuya.config.uuid,
                    reachable: false,
                },
            }
        )

        const observable = this.tuya.$dps.pipe(
            map(d => d.last),
            mergeMap(async dps => {
            })
        )

        return {
            endpoint: endpoint as Endpoint,
            observable
        }




    }


}
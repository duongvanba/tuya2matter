import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { OccupancySensorDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, OccupancySensingBehavior } from "@matter/main/behaviors";
import { map, mergeMap } from "rxjs";

export class Tuya2MatterOccupancySensor {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name

        const endpoint = new Endpoint(
            OccupancySensorDevice.with(OccupancySensingBehavior).with(BridgedDeviceBasicInformationServer), {
            id: this.tuya.id,
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                  serialNumber: this.tuya.config.uuid,
                reachable: false,
            },
            occupancySensing: {
                occupancySensorType: 0x03,
                holdTime: 60,
                holdTimeLimits: { holdTimeDefault: 10, holdTimeMax: 10, holdTimeMin: 1 },
                pirUnoccupiedToOccupiedDelay: 10
            } as any
        })

        const observable = this.tuya.$dps.pipe(
            map(d => d.last),
            mergeMap(async dps => {
                const presence_state = dps.presence_state
                presence_state != undefined && endpoint.set({
                    occupancySensing: {
                        occupancy: { occupied: presence_state != 'none' }
                    }
                })
            })
        ) 

          return {
            endpoints: [endpoint],
            observable
        }


    }


}
import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { OccupancySensorDevice, LightSensorDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, OccupancySensingBehavior } from "@matter/main/behaviors";
import { map, mergeMap } from "rxjs";

export class Tuya2MatterOccupancySensor {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name.slice(0,32)

        const endpoint = new Endpoint(
            OccupancySensorDevice.with(
                OccupancySensingBehavior,
                BridgedDeviceBasicInformationServer
            ),
            {
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
                } as any,
                parts: [
                    {
                        id: 'light',
                        type: LightSensorDevice
                    }
                ]
            })

        const observable = this.tuya.$dps.pipe(
            map(d => d.state),
            mergeMap(async dps => {
                dps.presence_state != undefined && endpoint.set({
                    occupancySensing: {
                        occupancy: { occupied: dps.presence_state != 'none' }
                    }
                })

                dps.illuminance_value != undefined && (endpoint.parts.get('light')! as Endpoint<LightSensorDevice>).set({
                    illuminanceMeasurement: {
                        measuredValue: dps.illuminance_value
                    }
                })
            })
        )

        return {
            endpoint,
            observable
        }



    }


}
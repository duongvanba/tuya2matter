import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { ClusterBehavior, ClusterState, Endpoint, MaybePromise } from "@matter/main";
import { FanDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, FanControlServer } from "@matter/main/behaviors";
import { map, mergeMap } from "rxjs";
import { FanControl, LevelControl, TemperatureControl } from "@matter/main/clusters";
import { ClusterType } from "@matter/main/types";




export class Tuya2MatterFan {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name
        const tuya = this.tuya

        const endpoint = new Endpoint(
            FanDevice.with(BridgedDeviceBasicInformationServer),
            {
                id: this.tuya.id,
                bridgedDeviceBasicInformation: {
                    nodeLabel: name,
                    productName: name,
                    productLabel: name,
                    serialNumber: this.tuya.config.uuid,
                    reachable: false,
                },
                fanControl: {
                    fanMode: 0,
                    fanModeSequence: 0,
                    percentCurrent: 0,
                    percentSetting: 0
                }
            }
        )

        const observable = this.tuya.$dps.pipe(
            map(d => d.last),
            mergeMap(async ({ switch: _, fan_speed_percent }) => {
                endpoint.set({
                    fanControl: {
                        ..._ != undefined ? { fanMode: _ ? 4 : 0 } : {},
                        ...fan_speed_percent != undefined ? { percentCurrent: Math.round(Number(fan_speed_percent) / 5 * 100) } : {}
                    }
                })
            })
        )

        // endpoint.events.colorControl.colorTemperatureMireds$Changed.on(e => {
        //     const temp_value = Math.round((e-217) / 217 * 1000)
        //     console.log({sync_temp: temp_value })
        //     tuya.setDps({ temp_value })
        // })


        return {
            endpoints: [endpoint] as any as Endpoint[],
            observable
        }








    }


}
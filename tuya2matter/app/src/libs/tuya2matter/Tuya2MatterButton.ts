import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { GenericSwitchDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, SwitchServer, BasicInformationServer } from "@matter/main/behaviors";
import { EMPTY, mergeMap } from "rxjs";
import { PowerSourceBaseServer, } from "@matter/main/behaviors/power-source";
import { } from "@matter/main/behaviors/switch";


export class Tuya2MatterButton {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name

        const endpoint = new Endpoint(
            GenericSwitchDevice.with(BridgedDeviceBasicInformationServer).with(PowerSourceBaseServer), {
            id: this.tuya.id,
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                serialNumber: this.tuya.config.uuid,
                reachable: true,
            },
            powerSource: {
                status: 1,
                batPercentRemaining: 100,
                order: 3,
                description: "pin",
                batChargeLevel: 0,
                batReplacementNeeded: false,
                batReplaceability: 2,
                activeBatChargeFaults: [],
                activeBatFaults: [],
                batCapacity: 220,
                batChargeState: 2,
                batChargingCurrent: 0,
                batFunctionalWhileCharging: true,
                batPresent: true,
                batTimeRemaining: 4800,
                batTimeToFullCharge: 4800,
                batVoltage: 3
            },
            parts: [1, 2, 3, 4].map(n => {
                return {
                    id: `code${n}`,
                    type: GenericSwitchDevice.with(SwitchServer.with("MomentarySwitchMultiPress", "MomentarySwitchRelease", "MomentarySwitch"))

                }
            })
        })

        const observable = this.tuya.$dps.pipe(
            mergeMap(async dps => {
                const percent = dps.battery_percentage
                percent != undefined && endpoint.set({
                    powerSource: {
                        status: 1,
                        batPercentRemaining: Number(percent)
                    }
                })
                // console.log(dps)
                // if (dps.switch1_value) {
                //     endpoint.set({
                //         switch: {
                //             currentPosition: 1,
                //             rawPosition: 1
                //         }
                //     })

                //     await Bun.sleep(100)

                //     endpoint.set({
                //         switch: {
                //             currentPosition: 0,
                //             rawPosition: 0
                //         }
                //     })
                // }



            })
        )



        return { endpoint, observable }


    }


}
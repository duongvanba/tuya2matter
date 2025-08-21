import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { GenericSwitchDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, SwitchServer } from "@matter/main/behaviors";
import { filter, from, lastValueFrom, map, mergeMap, skip } from "rxjs";
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
            GenericSwitchDevice.with(BridgedDeviceBasicInformationServer).with(PowerSourceBaseServer).with(SwitchServer.with("MomentarySwitchMultiPress", "MomentarySwitchRelease", "MomentarySwitch")), {
            id: this.tuya.id,
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                serialNumber: this.tuya.config.uuid,
                reachable: false,
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
                    id: `switch${n}_value`,
                    type: GenericSwitchDevice.with(SwitchServer.with("MomentarySwitchMultiPress", "MomentarySwitchRelease", "MomentarySwitch")) 
                }
            }),

        })


        const observable = this.tuya.$dps.pipe(
            skip(2),
            map(d => d.last),
            mergeMap(async dps => {
                const percent = dps.battery_percentage
                percent != undefined && endpoint.set({
                    powerSource: {
                        status: 1,
                        batPercentRemaining: Number(percent)
                    }
                })

                await lastValueFrom(from(Object.entries(dps)).pipe(
                    filter(([name, value]) => ["single_click", "double_click", "long_press"].includes(`${value}`)),
                    mergeMap(async ([code, type]) => {
                        const target = endpoint.parts.get(code) as Endpoint<any>
                        if (!target) return

                        target.set({
                            switch: {
                                currentPosition: 1,
                                rawPosition: 1
                            }
                        })
                        await Bun.sleep(150)
                        target.set({
                            switch: {
                                currentPosition: 0,
                                rawPosition: 0
                            }
                        })
                        if (type != 'single_click') {
                            target.set({
                                switch: {
                                    currentPosition: 1,
                                    rawPosition: 1
                                }
                            } as any)
                            await Bun.sleep(150)
                            target.set({
                                switch: {
                                    currentPosition: 0,
                                    rawPosition: 0
                                }
                            })
                        }

                    })
                ), { defaultValue: [] })
            })
        )



        return {
            endpoints: [endpoint],
            observable
        }


    }


}
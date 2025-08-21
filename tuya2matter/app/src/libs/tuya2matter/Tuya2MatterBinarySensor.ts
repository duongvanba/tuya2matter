import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { ContactSensorDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors";
import { PowerSourceBaseServer } from "@matter/main/behaviors/power-source";
import { map, mergeMap } from "rxjs";



export class Tuya2MatterBinarySensor {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name

        const endpoint = new Endpoint(
            ContactSensorDevice.with(BridgedDeviceBasicInformationServer).with(PowerSourceBaseServer), {
            id: this.tuya.id,
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                serialNumber: this.tuya.config.uuid,
                reachable: false,
            },
            booleanState: { stateValue: true },
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
                batChargeState: 0,
                batChargingCurrent: 0,
                batFunctionalWhileCharging: true,
                batPresent: true,
                batTimeRemaining: 0xFFFFFFFF,
                batTimeToFullCharge: 0xFFFFFFFF,
                batVoltage: 3
            }
        })



        const observable = this.tuya.$dps.pipe(
            map(d => d.last),
            mergeMap(async dps => {
                const onoff = dps.doorcontact_state
                const percent = dps.battery_percentage
                endpoint.set({
                    ...onoff !== undefined ? {
                        booleanState: {
                            stateValue: !onoff,
                        }
                    } : {},
                    ...percent != undefined ? {
                        powerSource: {
                            status: 1,
                            batPercentRemaining: Number(percent)
                        }
                    } : {}
                })
            })
        ) 

         return {
            endpoints: [endpoint],
            observable
        }


    }


}
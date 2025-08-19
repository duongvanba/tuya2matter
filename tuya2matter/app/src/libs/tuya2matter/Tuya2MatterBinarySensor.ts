import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { BatteryStorageRequirements, ContactSensorDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors";
import { PowerSourceBaseServer, } from "@matter/main/behaviors/power-source";
import { mergeMap } from "rxjs";
import { BatteryStorageDevice } from "@matter/main/devices";
import { PowerSourceCluster, GroupsCluster } from "@matter/main/clusters";
import { percent } from "@matter/main/model";



export class Tuya2MatterBinarySensor {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    async init() {

        const name = this.tuya.name

        const door = new Endpoint(
            ContactSensorDevice.with(BridgedDeviceBasicInformationServer).with(PowerSourceBaseServer), {
            id: this.tuya.id,
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                serialNumber: `1`,
                reachable: true,
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



        this.tuya.$dps.pipe(
            mergeMap(async dps => {
                const onoff = dps.doorcontact_state
                const percent = dps.battery_percentage
                door.set({
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
        ).subscribe()

        await this.aggregator.add(door)


    }


}
import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { DoorLockDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, DoorLockServer } from "@matter/main/behaviors";
import { map, mergeMap } from "rxjs";




export class Tuya2MatterLock {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name.slice(0, 32)
        const tuya = this.tuya

        const endpoint = new Endpoint(
            DoorLockDevice.with(
                BridgedDeviceBasicInformationServer,
                class extends DoorLockServer {
                    override unlockDoor() {
                        console.log({ unlock: true })
                    }
                    override lockDoor() {
                        console.log({ lock: true })
                    }
                }
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
                doorLock: {
                    lockState: 1,
                    lockType: 1,
                    supportedOperatingModes: {
                        noRemoteLockUnlock: false,
                        normal: true,
                        alwaysSet: 2047,

                    },
                    actuatorEnabled: true,
                }
            }
        )

        const observable = this.tuya.$dps.pipe(
            map(d => d.last),
            mergeMap(async dps => {
                console.log({ dps })
                endpoint.set({
                    doorLock: {
                        ...dps.closed_opened != undefined ? {
                            lockState: dps.closed_opened == 'open' ? 2 : 1
                        } : {},
                    }
                })
            })
        )


        return {
            endpoint: endpoint as Endpoint,
            observable
        }


    }


}
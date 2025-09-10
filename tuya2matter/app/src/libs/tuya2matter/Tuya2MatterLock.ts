import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint, MaybePromise } from "@matter/main";
import { FanDevice, DoorLockDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, DoorLockServer } from "@matter/main/behaviors";
import { FanControl } from '@matter/main/clusters/fan-control'
import { map, merge, mergeMap, Observable } from "rxjs";




export class Tuya2MatterLock {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

       const name = this.tuya.name.slice(0,32)
        const tuya = this.tuya

        const endpoint = new Endpoint(
            DoorLockDevice.with(
                BridgedDeviceBasicInformationServer,
                class extends DoorLockServer {
                    override unlockDoor() {
                        tuya.setDps({ open_close: true })
                    }
                    override lockDoor() {
                        tuya.setDps({ open_close: false })
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
                    lockState: 0
                }
            }
        )

        const observable = this.tuya.$dps.pipe(
            map(d => d.last),
            mergeMap(async dps => {
                endpoint.set({
                    doorLock: {
                        ...dps.open_close != undefined ? { lockState: dps.open_close ? 2 : 1 } : {}
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
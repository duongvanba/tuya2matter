import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { GenericSwitchDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, SwitchServer } from "@matter/main/behaviors";
import { EMPTY } from "rxjs";



export class Tuya2MatterButton {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name

        const endpoint = new Endpoint(
            GenericSwitchDevice.with(BridgedDeviceBasicInformationServer).with(SwitchServer.with("MomentarySwitch")), {
            id: this.tuya.id,
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                serialNumber: `1`,
                reachable: true,
            },
            switch: {
                currentPosition: 1,
                debounceDelay: 500,
                longPressDelay: 500,
                momentaryNeutralPosition: 1,
                multiPressDelay: 1000,
                numberOfPositions: 4,
                rawPosition: 1
            }
        })

        const observable = EMPTY 

        // this.tuya.$dps.pipe(
        //     mergeMap(async dps => {
        //         const onoff = dps.doorcontact_state
        //         const percent = dps.battery_percentage
        //         door.set({
        //             ...onoff !== undefined ? {
        //                 booleanState: {
        //                     stateValue: !onoff,
        //                 }
        //             } : {},
        //             ...percent != undefined ? {
        //                 powerSource: {
        //                     status: 1,
        //                     batPercentRemaining: Number(percent)
        //                 }
        //             } : {}
        //         })
        //     })
        // ).subscribe()
        

        return { endpoint, observable }


    }


}
import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { WindowCoveringDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors";
import { MovementDirection, MovementType, WindowCoveringServer } from "@matter/main/behaviors";
import { mergeMap } from "rxjs";


const LiftingWindowCoveringServer = WindowCoveringServer.with("Lift", "PositionAwareLift", "AbsolutePosition");


export class Tuya2MatterCover {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name

        const tuya = this.tuya


        const endpoint = new Endpoint(
            WindowCoveringDevice.with(class extends LiftingWindowCoveringServer {
                override async handleMovement(
                    type: MovementType,
                    reversed: boolean,
                    direction: MovementDirection,
                    targetPercent100ths?: number,
                ) {
                    targetPercent100ths != undefined && tuya.setDps({
                        percent_control: targetPercent100ths / 100
                    })
                }
            }).with(BridgedDeviceBasicInformationServer), {
            id: this.tuya.id,
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                serialNumber: `1`,
                reachable: true,
            }
        })

        const observable = this.tuya.$dps.pipe(
            mergeMap(async dps => {
                if (dps.percent_control != undefined) {
                    const targetPositionLiftPercent100ths = Number(dps.percent_control) * 100
                    endpoint.set({ windowCovering: { targetPositionLiftPercent100ths } })
                }

                if (dps.percent_state != undefined) {
                    const currentPositionLiftPercent100ths = Number(dps.percent_state) * 100
                    endpoint.set({ windowCovering: { currentPositionLiftPercent100ths } })
                }
            })
        ) 

        return {
            endpoint: endpoint as any as Endpoint<any>,
            observable
        }








    }


}
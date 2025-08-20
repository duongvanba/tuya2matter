import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint, MaybePromise } from "@matter/main";
import { GenericSwitchDevice, GenericSwitchRequirements, OnOffPlugInUnitRequirements, OnOffPlugInUnitDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors";
import { tap } from "rxjs";



const SWITCH_CODES = ['switch_1', 'switch_2', 'switch_3', 'switch_4']

export class Tuya2MatterSwitch {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const switches = Object.entries(this.tuya.config.mapping).filter(
            ([k, v]) => SWITCH_CODES.includes(k)
        )

        const name = this.tuya.name

        const tuya = this.tuya


        const endpoint = new Endpoint(GenericSwitchDevice.with(BridgedDeviceBasicInformationServer), {
            id: this.tuya.id,
            parts: switches.map(([name, { code }], index) => {
                const type = OnOffPlugInUnitDevice.withBehaviors(class extends OnOffPlugInUnitRequirements.OnOffServer {
                    override initialize(): MaybePromise {
                        this.events.onOff$Changed.on(on => {
                            tuya.setDps({ [name]: on })
                        })
                    }
                })
                return {
                    id: code,
                    type,
                    onOff: { onOff: false },
                }
            }),
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                serialNumber: `1`,
                reachable: true,
            },

        })

        const observable = tuya.$dps.pipe(
            tap(dps => {
                Object.entries(dps).forEach(([key, on]) => {
                    if (SWITCH_CODES.includes(key)) {
                        const target = endpoint.parts.get(key) as Endpoint<OnOffPlugInUnitDevice>
                        target?.set({ onOff: { onOff: !!on } })
                    }
                })
            })
        ) 

        return { endpoint, observable }  

    }


}
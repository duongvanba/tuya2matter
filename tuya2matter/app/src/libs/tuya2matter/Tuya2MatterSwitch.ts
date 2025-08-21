import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint, MaybePromise } from "@matter/main";
import { GenericSwitchDevice, GenericSwitchRequirements, OnOffPlugInUnitRequirements, OnOffPlugInUnitDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors";
import { map, tap } from "rxjs";



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
                    override initialize(): MaybePromise { }
                    override on() {
                        tuya.setDps({ [code]: true })
                    }
                    override off() {
                        tuya.setDps({ [code]: false })
                    }
                })
                return {
                    id: code,
                    type,
                    onOff: { onOff: false },
                    name: code
                }
            }),
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                serialNumber: this.tuya.config.uuid,
                reachable: false 
            }
        })

        const observable = tuya.$dps.pipe(
            map(d => d.last),
            tap(dps => {
                Object.entries(dps).forEach(([key, on]) => {
                    if (SWITCH_CODES.includes(key)) {
                        const target = endpoint.parts.get(key) as Endpoint<OnOffPlugInUnitDevice>
                        target?.set({ onOff: { onOff: !!on } })
                    }
                })
            })
        )

        return {
            endpoints: [endpoint],
            observable
        }

    }


}
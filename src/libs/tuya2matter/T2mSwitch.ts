import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";


export class Tuya2MatterSwitch {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    async init() {
        for (const [key, value] of Object.entries(this.tuya.mapping)) {
            if (!key.startsWith('switch_')) continue
            const endpoint = new Endpoint(
                OnOffLightDevice.with(BridgedDeviceBasicInformationServer),
                {
                    id: this.tuya.device_id,
                    bridgedDeviceBasicInformation: {
                        nodeLabel: this.tuya.config.name, // Main end user name for the device
                        productName: this.tuya.config.name,
                        productLabel: this.tuya.config.name,
                        serialNumber: `tuya-${this.tuya.device_id}-${key}`,
                        reachable: true,
                    },
                },
            )
            await this.aggregator.add(endpoint)
            // endpoint.events.identify.startIdentifying.on(() => {
            //     console.log(`Run identify logic for ${name}, ideally blink a light every 0.5s ...`);
            // });

            // endpoint.events.identify.stopIdentifying.on(() => {
            //     console.log(`Stop identify logic for ${name} ...`);
            // });

            endpoint.events.onOff.onOff$Changed.on(value => {
                this.tuya.$dps.next({ [key]: value })
                console.log(`${this.tuya.config.name} is now ${value ? "ON" : "OFF"}`);
            })


        }

        // endpoint.set({ onOff: { onOff: false } })

        this.tuya.$dps.subscribe(dps => {

        })

    }


}
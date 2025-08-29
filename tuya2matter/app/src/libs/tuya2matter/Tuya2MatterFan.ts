import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { FanDevice, OnOffLightDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, FanControlServer, OnOffServer } from "@matter/main/behaviors";
import { map, mergeMap } from "rxjs";




export class Tuya2MatterFan {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name
        const tuya = this.tuya

        const endpoint = new Endpoint(
            FanDevice.with(
                BridgedDeviceBasicInformationServer,
                class extends OnOffServer {
                    override on() {
                        tuya.setDps({ switch: true })
                    }

                    override off() {
                        tuya.setDps({ switch: false })
                    }
                },
                class extends FanControlServer {
                    override initialize() {
                        this.reactTo(this.events.percentSetting$Changed, (v, o, { offline }) => {
                            if (offline) return
                            const percent = Math.ceil(Number(v) / 20)
                            tuya.setDps({
                                switch: v == 0 ? false : true,
                                fan_speed_percent: v == 0 ? '0' : `${percent}`
                            })
                        })
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
                fanControl: {
                    fanMode: 0,
                    fanModeSequence: 0,
                    percentCurrent: 0,
                    percentSetting: 0
                },
                parts: !this.tuya.mapping.light ? [] : [
                    {
                        id: 'light',
                        type: OnOffLightDevice.with(
                            class extends OnOffServer {
                                override on() {
                                    tuya.setDps({ light: true })
                                }
                                override off() {
                                    tuya.setDps({ light: false })
                                }
                            }
                        )
                    }
                ]
            }
        )

        const observable = this.tuya.$dps.pipe(
            map(d => d.last),
            mergeMap(async ({ switch: _, fan_speed_percent, light }) => {
                endpoint.set({
                    fanControl: {
                        ..._ != undefined ? { fanMode: _ ? 4 : 0 } : {},
                        ...fan_speed_percent != undefined ? { percentCurrent: Math.round(Number(fan_speed_percent) / 5 * 100) } : {}
                    }
                })
                if (light != undefined) {
                    const l = endpoint.parts.get('light') as Endpoint<OnOffLightDevice>
                    if (l) {
                        l.set({ onOff: { onOff: !!light } })
                    }
                }

            })
        )


        return {
            endpoints: [endpoint] as any as Endpoint[],
            observable
        }








    }


}
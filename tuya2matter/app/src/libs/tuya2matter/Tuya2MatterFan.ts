import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { FanDevice, OnOffLightDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, FanControlServer, OnOffServer } from "@matter/main/behaviors";
import { FanControl } from '@matter/main/clusters/fan-control'
import { map, merge, mergeMap, Observable } from "rxjs";




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
                },
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
            mergeMap(async dps => {
                const { switch: _, fan_speed_percent, light } = dps
                const fanControl = {
                    ..._ != undefined ? { fanMode: Math.round(3 * Number(_) / 5) } : {},
                    ...fan_speed_percent != undefined ? { percentCurrent: Math.round(Number(fan_speed_percent) / 5 * 100) } : {}
                }
                console.log({ dps, sync: fanControl })
                endpoint.set({ fanControl })
                if (light != undefined) {
                    const l = endpoint.parts.get('light') as Endpoint<OnOffLightDevice>
                    if (l) {
                        l.set({ onOff: { onOff: !!light } })
                    }
                }

            })
        )

        endpoint.events.fanControl.fanMode$Changed.on(fanMode => {
            console.log({ fanMode })
            fanMode == 0 && tuya.setDps({ switch: false })
            fanMode == 1 && tuya.setDps({ switch: true, fan_speed_percent: '1' })
            fanMode == 2 && tuya.setDps({ switch: true, fan_speed_percent: '3' })
            fanMode == 3 && tuya.setDps({ switch: true, fan_speed_percent: '5' })
        })


        return {
            endpoints: [endpoint] as any as Endpoint[],
            observable
        }








    }


}
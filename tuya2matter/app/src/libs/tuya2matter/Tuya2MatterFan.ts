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
                class extends FanControlServer.with('MultiSpeed') { }
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
                    percentSetting: 0,
                    speedCurrent: 0,
                    speedMax: 5,
                    speedSetting: 0
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
            map(d => d.state),
            mergeMap(async dps => {
                const { fan_speed, light } = dps

                dps.switch === false && endpoint.set({
                    fanControl: {
                        fanMode: 0,
                        percentCurrent: 0,
                        speedCurrent: 0
                    }
                })

                if (dps.switch != undefined && fan_speed != undefined) {
                    const speedCurrent = Number(fan_speed)
                    const fanMode = Math.round(speedCurrent / 5 * 3)
                    const percentCurrent = Math.round(speedCurrent / 5 * 100)
                    endpoint.set({
                        fanControl: {
                            fanMode,
                            percentCurrent,
                            speedCurrent
                        }
                    })
                }


                if (light != undefined) {
                    const l = endpoint.parts.get('light') as Endpoint<OnOffLightDevice>
                    if (l) {
                        l.set({ onOff: { onOff: !!light } })
                    }
                }

            })
        )

        endpoint.events.fanControl.fanMode$Changed.on((fanMode, _, { offline }) => {
            if (offline) return
            console.log({ control: { fanMode, offline } })
            fanMode == 0 && tuya.setDps({ switch: false })
            fanMode == 1 && tuya.setDps({ switch: true, fan_speed: "1" })
            fanMode == 2 && tuya.setDps({ switch: true, fan_speed: "3" })
            fanMode == 3 && tuya.setDps({ switch: true, fan_speed: "5" })
        })

        endpoint.events.fanControl.percentSetting$Changed.on((percent, _, { offline }) => {
            if (offline) return
            const fan_speed = `${Math.ceil(Number(percent) / 20)}`
            console.log({ control: { percent, offline, fan_speed } })
            tuya.setDps({
                switch: percent == 0 ? false : true,
                fan_speed
            })
        })

        return {
            endpoint: endpoint as Endpoint,
            observable
        }


    }


}
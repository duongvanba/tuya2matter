import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint, MaybePromise } from "@matter/main";
import { ColorTemperatureLightDevice, OnOffLightDevice, DimmableLightDevice, ColorDimmerSwitchDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, TemperatureControlServer, LevelControlServer, OnOffServer, ColorControlServer } from "@matter/main/behaviors";
import { map, mergeMap } from "rxjs";
import { LevelControl, TemperatureControl } from "@matter/main/clusters";




export class Tuya2MatterTemperatureLight {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name
        const tuya = this.tuya

        const endpoint = new Endpoint(
            ColorTemperatureLightDevice
                .with(BridgedDeviceBasicInformationServer)
                .with(class extends LevelControlServer {
                    override moveToLevelWithOnOff({ level }: LevelControl.MoveToLevelRequest): MaybePromise {
                        const bright_value = Math.max((level - 4) * 4, 1)
                        tuya.setDps({ bright_value })
                    }
                })
                .with(class extends OnOffServer {
                    override on() {
                        tuya.setDps({ switch_led: true })
                    }

                    override off() {
                        tuya.setDps({ switch_led: false })
                    }
                }),
            {
                id: this.tuya.id,
                bridgedDeviceBasicInformation: {
                    nodeLabel: name,
                    productName: name,
                    productLabel: name,
                    serialNumber: this.tuya.config.uuid,
                    reachable: false,
                },
                colorControl: {
                    colorCapabilities: { colorLoop: true, colorTemperature: true, enhancedHue: false, hueSaturation: false, xy: false },
                    colorMode: 2,
                    "colorTemperatureMireds": 370,
                    "colorTempPhysicalMinMireds": 153,
                    "colorTempPhysicalMaxMireds": 370,
                    "coupleColorTempToLevelMinMireds": 300,
                    "startUpColorTemperatureMireds": 370
                }
            }
        )

        const observable = this.tuya.$dps.pipe(
            map(d => d.last),
            mergeMap(async dps => {
                const temp_value = dps.temp_value
                const bright_value = dps.bright_value
                const onOff = dps.switch_led
                const value = {
                    ...temp_value != undefined ? { colorControl: { colorTemperatureMireds: Math.round(370 - 217 * temp_value / 1000) } } : {},
                    ...bright_value != undefined ? { levelControl: { currentLevel: Math.round(250 * bright_value / 1000 + 4) } } : {},
                    ...onOff != undefined ? { onOff: { onOff } } : {}
                }
                endpoint.set(value)

            })
        )

        endpoint.events.colorControl.colorTemperatureMireds$Changed.on((e, o, { offline }) => {
            const temp_value = Math.round((370 - e) / 217 * 1000)
            if (offline) return
            tuya.setDps({ temp_value })
        })


        return {
            endpoints: [endpoint] as any as Endpoint[],
            observable
        }








    }


}
import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Behavior, Endpoint, MaybePromise } from "@matter/main";
import { ColorTemperatureLightDevice, ExtendedColorLightDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, ColorControlServer, LevelControlServer, OnOffServer, ColorControlBaseServer } from "@matter/main/behaviors";
import { BehaviorSubject, debounceTime, map, merge, mergeMap, skip, Subject } from "rxjs";
import { LevelControl } from "@matter/main/clusters";




export class Tuya2MatterTemperatureLight {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {
        if (this.tuya.mapping.temp_value) return this.linkCctLight()
        if (this.tuya.mapping.colour_data) return this.linkRgbLight()
    }

    linkCctLight() {



        const name = this.tuya.name.slice(0, 32)
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
            map(d => d.state),
            mergeMap(async dps => {
                const temp_value = dps.temp_value
                const bright_value = dps.bright_value
                const onOff = !!dps.switch_led
                const value = {
                    ...temp_value != undefined ? { colorControl: { colorTemperatureMireds: Math.round(370 - 217 * temp_value / 1000) } } : {},
                    ...bright_value != undefined ? { levelControl: { currentLevel: Math.round(250 * bright_value / 1000 + 4) } } : {},
                    onOff: { onOff }
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
            endpoint: endpoint as Endpoint,
            observable
        }

    }

    linkRgbLight() {


        const name = this.tuya.name.slice(0, 32)
        const tuya = this.tuya

        const cmd$ = new BehaviorSubject({ hue: 0, sat: 0, level: 0 })

        const endpoint = new Endpoint(
            ExtendedColorLightDevice
                .with(BridgedDeviceBasicInformationServer)
                .with(class extends LevelControlServer {
                    override moveToLevelWithOnOff({ level }: LevelControl.MoveToLevelRequest): MaybePromise {
                        cmd$.next({ ...cmd$.value, level })
                        return
                    }
                })
                .with(class extends ColorControlBaseServer {
                    override moveToHueLogic(hue: number) {
                        cmd$.next({ ...cmd$.value, hue })
                    }

                    override moveToSaturationLogic(sat: number) {
                        cmd$.next({ ...cmd$.value, sat })
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
                    colorTemperatureMireds: 370,
                    colorTempPhysicalMinMireds: 153,
                    colorTempPhysicalMaxMireds: 370,
                    coupleColorTempToLevelMinMireds: 300,
                    startUpColorTemperatureMireds: 370,
                    colorCapabilities: {
                        colorLoop: true,
                        colorTemperature: true,
                        enhancedHue: true,
                        hueSaturation: true,
                        xy: true,
                    },
                    colorMode: 1,
                    currentHue: 1
                },


            }
        )


        const observable = merge(
            // Control
            cmd$.pipe(
                skip(1),
                debounceTime(500),
                mergeMap(async ({ hue, sat, level }) => {
                    try {
                        const hueHex = Math.round((hue / 254) * 360).toString(16).padStart(4, '0')
                        const satHex = Math.round((sat / 254) * 1000).toString(16).padStart(4, '0')
                        const valHex = Math.round((level / 254) * 1000).toString(16).padStart(4, '0')
                        const colour_data = `${hueHex}${satHex}${valHex}0000`
                        tuya.setDps({ colour_data })
                    } catch (e) {
                        console.error(`Can not set color data for Tuya device ${tuya.id}:`, e)
                    }
                })
            ),


            // Sync
            this.tuya.$dps.pipe(
                map(d => d.state),
                mergeMap(async ({ colour_data, switch_led }) => {
                    if (colour_data) {
                        const hue = parseInt(colour_data.slice(0, 4), 16)
                        const currentHue = Math.round((hue / 360) * 254)
                        const sat = parseInt(colour_data.slice(4, 8), 16)
                        const currentSaturation = Math.round((sat / 1000) * 254)
                        const val = parseInt(colour_data.slice(8, 12), 16)
                        const currentLevel = Math.max(1, Math.round((val / 1000) * 254))

                        endpoint.set({
                            colorControl: { currentHue, currentSaturation },
                            levelControl: { currentLevel }
                        })
                    }

                    if (switch_led != undefined) {
                        endpoint.set({ onOff: { onOff: !!switch_led } })
                    }
                })
            )
        )


        return {
            endpoint: endpoint as Endpoint,
            observable
        }
    }


}